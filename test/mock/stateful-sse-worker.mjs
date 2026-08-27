import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const CHECKER_MESSAGE = "Beleg-Nr. fehlt bei den Werbungskosten";
export const WARNING_TEXT = "Bitte pruefen Sie die Angaben vor dem Speichern.";

const sha256 = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();
export const sha256File = (path) => sha256(readFileSync(path));

function clone(value) {
  return structuredClone(value);
}

function canonicalCase(caseState) {
  return `${JSON.stringify({
    schemaVersion: 1,
    kind: caseState.kind,
    taxYear: caseState.taxYear,
    values: caseState.values,
    ustva: caseState.ustva,
  }, null, 2)}\n`;
}

function writeCanonicalCase(path, caseState) {
  writeFileSync(path, canonicalCase(caseState), "utf8");
}

function parseGermanCents(value) {
  if (typeof value !== "string" || !/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/u.test(value)) {
    return null;
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [euros, decimals = ""] = unsigned.split(",", 2);
  const cents = Number(BigInt(euros.replaceAll(".", "")) * 100n + BigInt(decimals.padEnd(2, "0") || "0"));
  return negative ? -cents : cents;
}

export function formatCents(cents) {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const euros = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  return `${negative ? "-" : ""}${euros},${String(absolute % 100).padStart(2, "0")}`;
}

function incomeTax(values) {
  const taxableIncome = Math.max(0, values.grossIncome - values.expenses - 1_200_000);
  const tax = Math.round(taxableIncome * 0.2);
  const solidarity = Math.round(tax * 0.055);
  const settlement = tax + solidarity - values.prepaidTax;
  return { taxableIncome, tax, solidarity, settlement };
}

function freelancerResult(values) {
  return { profit: values.revenue - values.expenses };
}

function resultRows(caseState) {
  if (caseState.kind === "income_tax") {
    const current = incomeTax(caseState.values);
    const held = incomeTax(caseState.baseline.values);
    const row = (label, key) => ({
      beobachteterWert: label,
      aktuell: formatCents(current[key]),
      festgehalten: formatCents(held[key]),
      differenz: formatCents(current[key] - held[key]),
    });
    const rateCurrent = current.taxableIncome ? Math.round((current.tax / current.taxableIncome) * 10_000) / 100 : 0;
    const rateHeld = held.taxableIncome ? Math.round((held.tax / held.taxableIncome) * 10_000) / 100 : 0;
    return [
      row("Zu versteuerndes Einkommen", "taxableIncome"),
      row("Einkommensteuer", "tax"),
      row("Solidaritätszuschlag", "solidarity"),
      row(current.settlement >= 0 ? "Nachzahlung" : "Erstattung", "settlement"),
      {
        beobachteterWert: "Durchschnittssteuersatz",
        aktuell: `${String(rateCurrent).replace(".", ",")} %`,
        festgehalten: `${String(rateHeld).replace(".", ",")} %`,
        differenz: `${String(Math.round((rateCurrent - rateHeld) * 100) / 100).replace(".", ",")} %`,
      },
    ];
  }
  const current = freelancerResult(caseState.values);
  const held = freelancerResult(caseState.baseline.values);
  return [
    {
      beobachteterWert: "Betriebseinnahmen",
      aktuell: formatCents(caseState.values.revenue),
      festgehalten: formatCents(caseState.baseline.values.revenue),
      differenz: formatCents(caseState.values.revenue - caseState.baseline.values.revenue),
    },
    {
      beobachteterWert: "Betriebsausgaben",
      aktuell: formatCents(caseState.values.expenses),
      festgehalten: formatCents(caseState.baseline.values.expenses),
      differenz: formatCents(caseState.values.expenses - caseState.baseline.values.expenses),
    },
    {
      beobachteterWert: "Gewinn/Verlust",
      aktuell: formatCents(current.profit),
      festgehalten: formatCents(held.profit),
      differenz: formatCents(current.profit - held.profit),
    },
  ];
}

function resultDetails(caseState) {
  const zeilen = resultRows(caseState);
  return {
    verfuegbar: true,
    fensterOffen: true,
    anzahl: zeilen.length,
    vollstaendig: true,
    zeilen,
    unvollstaendigeZeilen: [],
    nichtPositionierteZellenAnzahl: 0,
    uiaKopfzeilen: ["Beobachteter Wert", "Aktuell", "Festgehalten", "Differenz"],
    kopfVollstaendig: true,
    vergleichsInvariantGeprueft: zeilen.length - 1,
    vergleichsInvariantFehler: [],
    vertikalUnvollstaendig: false,
    fingerprint: sha256(JSON.stringify(zeilen)),
  };
}

function caseTitle(caseState, path) {
  const product = caseState.kind === "income_tax" ? "Einkommensteuer" : "Gewinnermittlung";
  return `${product} ${caseState.taxYear}: SteuerSparErklärung für das Steuerjahr ${caseState.taxYear} - ${basename(path)}`;
}

function pageFields(model) {
  const caseState = model.openCase();
  if (!caseState) return [];
  if (model.currentPage === `Umsatzsteuer-Voranmeldungen ${caseState.taxYear}`) {
    const ustva = caseState.ustva;
    return [
      { label: "Voranmeldezeitraum", typ: "ComboBox", wert: ustva.frequency, aid: "Combobox" },
      { label: "Auswahl Monat", typ: "ComboBox", wert: ustva.month, aid: "Combobox" },
      {
        label: "Beträge für die Umsatzsteuer-Voranmeldung manuell erfassen",
        typ: "CheckBox",
        wert: ustva.manualInput,
        aid: "ManuelleEingabe",
      },
      { label: "Lieferungen/Leistungen zu 19%", typ: "Edit", wert: formatCents(ustva.taxable19Base), aid: "Wert" },
      { label: "Lieferungen/Leistungen zu 19%", typ: "Edit", wert: formatCents(ustva.taxable19Tax), aid: "WertUSt" },
      { label: "Vorsteuer", typ: "Edit", wert: formatCents(-ustva.inputTax), aid: "Wert" },
      {
        label: ustva.settlement >= 0 ? "Umsatzsteuerzahllast" : "Umsatzsteuererstattung",
        typ: "Edit",
        wert: formatCents(Math.abs(ustva.settlement)),
        aid: "Wert",
      },
    ];
  }
  if (model.currentPage === "Steuerschuldnerschaft nach § 13b UStG") {
    return [
      { label: "Sonst. Leistungen ausländ. Unternehmer EU", typ: "Edit", wert: "100,00", aid: "Wert" },
      { label: "Sonst. Leistungen ausländ. Unternehmer EU", typ: "Edit", wert: "19,00", aid: "Wert2" },
      { label: "Umsatzsteuer als Leistungsempfänger nach § 13b UStG", typ: "Edit", wert: "100,00", aid: "Wert" },
      { label: "Umsatzsteuer als Leistungsempfänger nach § 13b UStG", typ: "Edit", wert: "19,00", aid: "Wert2" },
    ];
  }
  if (model.currentPage === "Abziehbare Vorsteuer") {
    return [
      { label: "Vorsteuer aus Rechnungen von anderen Unternehmern", typ: "Edit", wert: formatCents(caseState.ustva.inputTax), aid: "Wert" },
      { label: "Vorsteuer als Steuerschuldner nach § 13b UStG", typ: "Edit", wert: "19,00", aid: "Wert" },
      { label: "Summe der abziehbaren Vorsteuerbeträge", typ: "Edit", wert: formatCents(caseState.ustva.inputTax + 1_900), aid: "Wert" },
    ];
  }
  if (caseState.kind === "freelancer" && model.currentPage === "1. Fahrzeug") {
    return [
      { label: "Bezeichnung", typ: "Edit", wert: String(caseState.values.vehicleDescription ?? ""), aid: "FahrzeugTyp.Text" },
      { label: "Kennzeichen", typ: "Edit", wert: String(caseState.values.vehicleLicensePlate ?? ""), aid: "Kennzeichen.Text" },
    ];
  }
  if (caseState.kind === "income_tax") {
    return [
      { label: "Bruttoarbeitslohn", typ: "Edit", wert: formatCents(caseState.values.grossIncome), aid: "Brutto" },
      { label: "Werbungskosten", typ: "Edit", wert: formatCents(caseState.values.expenses), aid: "Werbungskosten" },
      { label: "Beleg-Nr.", typ: "Edit", wert: caseState.values.receiptNumber, aid: "BelegNr" },
    ];
  }
  return [
    { label: "Betriebseinnahmen", typ: "Edit", wert: formatCents(caseState.values.revenue), aid: "Einnahmen" },
    { label: "Betriebsausgaben", typ: "Edit", wert: formatCents(caseState.values.expenses), aid: "Ausgaben" },
  ];
}

function checkerMessages(caseState) {
  return caseState?.kind === "income_tax" && !caseState.values.receiptNumber
    ? [{ text: CHECKER_MESSAGE, gruppe: "Fragen und Warnungen" }]
    : [];
}

export const TABLE_PAGE = "Kapitalerträge und sonstige Einnahmen";
export const TABLE_SUM_LABEL = "Summe Sonstige Einnahmen";
export const VAST_CERTIFICATE = "Lohnsteuerbescheinigung 2025";
export const VAST_UNMAPPED = "(nicht zuordnen)";
export const VAST_TARGET = "Arbeitnehmer: Bruttoarbeitslohn";

/** Lineare Seitenfolge je Fallart; sie traegt Navigation, Sammeln und Unterseiten. */
function pageSequence(caseState) {
  if (caseState.kind === "income_tax") {
    return ["Arbeitnehmer", "Sonderausgaben", "Prüfen und Abgeben"];
  }
  return [
    "Einnahmen/Ausgaben",
    TABLE_PAGE,
    `Umsatzsteuer-Voranmeldungen ${caseState.taxYear}`,
    "Steuerschuldnerschaft nach § 13b UStG",
    "Abziehbare Vorsteuer",
    "Prüfen und Abgeben",
  ];
}

function tableRows(caseState) {
  return caseState.kind === "freelancer" ? caseState.values.sonstigeEinnahmen : [];
}

function tableSumCents(caseState) {
  return tableRows(caseState).reduce((total, row) => total + row.betrag, 0);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

/**
 * Synthetischer UIA-Baum der aktuellen Seite. Er traegt Suche, Snapshot,
 * Accessibility-Probe, Einzelwertlesung und Positionen aus derselben Quelle,
 * damit diese Operationen sich nie widersprechen koennen.
 */
function pageElements(model) {
  const caseState = model.openCase();
  if (!caseState) return [];
  const page = model.currentPage;
  const nodes = pageFields(model).map((field, index) => ({
    rid: `rid.${slug(page)}.feld.${index}`,
    aid: `.Seite.${field.aid}`,
    name: field.label,
    type: field.typ,
    value: String(field.wert),
    x: 220,
    y: 120 + index * 28,
    w: 260,
    h: 24,
    enabled: true,
  }));
  nodes.unshift({
    rid: "rid.global.search",
    aid: "",
    name: "Globales Suchfeld",
    type: "Edit",
    value: model.searchValue,
    x: 620,
    y: 40,
    w: 240,
    h: 24,
    enabled: true,
  });
  if (page === TABLE_PAGE) {
    tableRows(caseState).forEach((row, index) => {
      nodes.push({
        rid: `rid.${slug(page)}.zeile.${index}`,
        aid: `.Tabelle.Zeile${index}`,
        name: row.text,
        type: "DataItem",
        value: formatCents(row.betrag),
        x: 220,
        y: 320 + index * 22,
        w: 420,
        h: 20,
        enabled: true,
      });
    });
    nodes.push({
      rid: `rid.${slug(page)}.summe`,
      aid: ".Tabelle.Summe",
      name: TABLE_SUM_LABEL,
      type: "Text",
      value: formatCents(tableSumCents(caseState)),
      x: 220,
      y: 320 + tableRows(caseState).length * 22,
      w: 420,
      h: 20,
      enabled: true,
    });
  }
  for (const [index, target] of pageSequence(caseState).entries()) {
    nodes.push({
      rid: `rid.navigation.${slug(target)}`,
      aid: `.Navigation.${slug(target)}`,
      name: target,
      type: "TreeItem",
      value: "",
      x: 40,
      y: 120 + index * 24,
      w: 160,
      h: 20,
      enabled: true,
    });
  }
  nodes.push({
    rid: "rid.toolbar.elster",
    aid: ".MainToolBar.tb_elster",
    name: "ELSTER",
    type: "Button",
    value: "",
    x: 900,
    y: 40,
    w: 80,
    h: 28,
    enabled: false,
  });
  return nodes;
}

export const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Menuemodell. Alles rund um ELSTER bleibt bewusst gesperrt. */
const MENUS = [
  {
    name: "Datei",
    eintraege: [
      { menu: "Datei", name: "Steuerfall öffnen...", opens: "file-dialog" },
      { menu: "Datei", name: "Belege abrufen (VaSt)...", opens: "vast" },
    ],
  },
  {
    name: "Ansicht",
    eintraege: [{ menu: "Ansicht", name: "Roter Faden" }],
  },
  {
    name: "Extras",
    eintraege: [{ menu: "Extras", name: "BelegManager", opens: "receipt-manager" }],
  },
  {
    name: "ELSTER",
    eintraege: [
      { menu: "ELSTER", name: "Anmeldungen versenden", blocked: true },
      { menu: "ELSTER", name: "Jahreserklärungen abschließen", blocked: true },
    ],
  },
];

function matchesSelector(node, args) {
  if (typeof args.rid === "string" && args.rid) return node.rid === args.rid;
  if (typeof args.aid === "string" && args.aid) return node.aid.endsWith(args.aid);
  if (typeof args.type === "string" && args.type && node.type !== args.type) return false;
  if (typeof args.name === "string" && args.name) {
    return args.contains === true ? node.name.includes(args.name) : node.name === args.name;
  }
  return typeof args.type === "string" && args.type !== "";
}

export function seedSyntheticCases(caseDir, { includeNextYearUstva = false } = {}) {
  mkdirSync(caseDir, { recursive: true });
  const incomePath = join(caseDir, "synthetic.ESt2025");
  const freelancerPath = join(caseDir, "synthetic.Gew2025");
  const income = {
    kind: "income_tax",
    taxYear: 2025,
    values: { grossIncome: 6_000_000, expenses: 100_000, prepaidTax: 900_000, receiptNumber: "" },
    ustva: null,
  };
  const freelancer = {
    kind: "freelancer",
    taxYear: 2025,
    values: {
      revenue: 10_000_000,
      expenses: 2_500_000,
      // Eigenstaendige Tabellenseite: ihre Summe fliesst bewusst nicht in den
      // Gewinn, damit Tabellenvertraege die Ergebnisrechnung nicht verschieben.
      sonstigeEinnahmen: [
        { datum: "05.01.2025", text: "Zinsertrag Tagesgeld", betrag: 100 },
        { datum: "12.02.2025", text: "Erstattung Vorjahr", betrag: 50 },
      ],
    },
    ustva: {
      frequency: "monatlich",
      month: "Juni",
      manualInput: false,
      taxable19Base: 100_000,
      taxable19Tax: 19_000,
      inputTax: 2_000,
      settlement: 17_000,
    },
  };
  writeCanonicalCase(incomePath, income);
  writeCanonicalCase(freelancerPath, freelancer);
  const nextYearUstvaPath = join(caseDir, "synthetic.GewErfass2026");
  if (includeNextYearUstva) {
    writeCanonicalCase(nextYearUstvaPath, { ...clone(freelancer), taxYear: 2026 });
  }
  return {
    incomePath,
    freelancerPath,
    incomeHash: sha256File(incomePath),
    freelancerHash: sha256File(freelancerPath),
    ...(includeNextYearUstva ? {
      nextYearUstvaPath,
      nextYearUstvaHash: sha256File(nextYearUstvaPath),
    } : {}),
  };
}

export function createStatefulSseWorker({ caseDir }) {
  const journal = [];
  const cases = new Map();
  let openPath = null;
  let currentPage = null;
  let epoch = 0;
  let checkerActive = true;
  let checkerWindowOpen = false;
  let expandedChecker = [];
  let dialogs = [];
  let openMenu = null;
  let fileDialog = null;
  let receiptManagerOpen = false;
  let receiptManagerState = "start";
  let receiptRows = [];
  let nextReceiptId = 1;
  const receiptLinks = new Map();
  let vast = null;
  let minimised = false;
  let desktopName = null;
  let verticalPercent = 0;
  let treeOffset = 0;
  let searchValue = "";
  let productInfoCalls = 0;
  const pid = 3131;
  const hwnd = 4242;
  const vastHwnd = 8888;

  const readCase = (path) => {
    const absolute = resolve(path);
    if (!cases.has(absolute)) {
      const saved = JSON.parse(readFileSync(absolute, "utf8"));
      cases.set(absolute, {
        path: absolute,
        kind: saved.kind,
        taxYear: saved.taxYear,
        values: clone(saved.values),
        ustva: clone(saved.ustva),
        baseline: clone(saved),
        dirty: false,
      });
    }
    return cases.get(absolute);
  };

  const model = {
    journal,
    cases,
    get currentPage() { return currentPage; },
    get openPath() { return openPath; },
    get searchValue() { return searchValue; },
    get dialogs() { return dialogs; },
    openCase: () => openPath ? readCase(openPath) : null,
    openWarning() {
      dialogs = [{
        hwnd: 7777,
        pid,
        title: "Die Prüfung hat ergeben - Warnung",
        kind: "qt-dialog",
        fingerprint: sha256("synthetic-warning-dialog"),
        buttons: ["OK"],
      }];
    },
  };

  const requireCaseBinding = (args, caseState) => {
    if (args.expectedCasePath !== undefined && resolve(String(args.expectedCasePath)) !== caseState.path) {
      return { ok: false, kind: "case-mismatch", error: "Steuerfall stimmt nicht mit der erwarteten Arbeitskopie ueberein." };
    }
    if (args.expectedCaseHash !== undefined && String(args.expectedCaseHash).toUpperCase() !== sha256File(caseState.path)) {
      return { ok: false, kind: "case-mismatch", error: "Steuerfall-Hash stimmt vor der Schreibaktion nicht mehr." };
    }
    return null;
  };

  const applyTrackedValue = (args) => {
    const caseState = model.openCase();
    if (!caseState) return { ok: false, kind: "not-found", error: "Kein Steuerfall offen." };
    if (dialogs.length) return { ok: false, kind: "precondition-failed", error: "Ein Dialog ist offen; nichts geschrieben." };
    const bindingError = requireCaseBinding(args, caseState);
    if (bindingError) return bindingError;
    const knownField = args.pageId === "gew.fahrzeug"
      ? {
        expectedPage: "1. Fahrzeug",
        name: args.fieldId === "bezeichnung" ? "Bezeichnung" : args.fieldId === "kennzeichen" ? "Kennzeichen" : "",
        aid: args.fieldId === "bezeichnung" ? ".Fahrzeug.FahrzeugTyp.Text" : args.fieldId === "kennzeichen" ? ".Fahrzeug.Kennzeichen.Text" : "",
      }
      : null;
    const expectedPage = String(args.expectedPage ?? knownField?.expectedPage ?? "");
    if (expectedPage !== currentPage) {
      return { ok: false, kind: "precondition-failed", error: `Aktuelle Seite '${currentPage}', erwartet '${expectedPage}'.` };
    }

    const before = String(args.expectedBefore);
    const after = String(args.expectedAfter);
    const name = String(args.name ?? knownField?.name ?? "");
    const aid = String(args.aid ?? knownField?.aid ?? "");
    let actualBefore;
    let assign;
    if (caseState.kind === "income_tax" && name === "Werbungskosten") {
      actualBefore = formatCents(caseState.values.expenses);
      assign = () => { caseState.values.expenses = parseGermanCents(String(args.value)); };
    } else if (caseState.kind === "income_tax" && name === "Bruttoarbeitslohn") {
      actualBefore = formatCents(caseState.values.grossIncome);
      assign = () => { caseState.values.grossIncome = parseGermanCents(String(args.value)); };
    } else if (caseState.kind === "income_tax" && name === "Beleg-Nr.") {
      actualBefore = caseState.values.receiptNumber;
      assign = () => { caseState.values.receiptNumber = String(args.value); };
    } else if (caseState.kind === "freelancer" && name === "Betriebseinnahmen") {
      actualBefore = formatCents(caseState.values.revenue);
      assign = () => { caseState.values.revenue = parseGermanCents(String(args.value)); };
    } else if (caseState.kind === "freelancer" && name === "Betriebsausgaben") {
      actualBefore = formatCents(caseState.values.expenses);
      assign = () => { caseState.values.expenses = parseGermanCents(String(args.value)); };
    } else if (caseState.kind === "freelancer" && currentPage === "1. Fahrzeug" && name === "Bezeichnung") {
      actualBefore = String(caseState.values.vehicleDescription ?? "");
      assign = () => { caseState.values.vehicleDescription = String(args.value); };
    } else if (caseState.kind === "freelancer" && currentPage === "1. Fahrzeug" && name === "Kennzeichen") {
      actualBefore = String(caseState.values.vehicleLicensePlate ?? "");
      assign = () => { caseState.values.vehicleLicensePlate = String(args.value); };
    } else if (aid === ".RahmenWerteUebersicht.LieferungNorm.BetragEigen") {
      actualBefore = formatCents(caseState.ustva.taxable19Base);
      assign = () => {
        caseState.ustva.taxable19Base = parseGermanCents(String(args.value));
        caseState.ustva.taxable19Tax = Math.round(caseState.ustva.taxable19Base * 0.19);
        caseState.ustva.settlement = caseState.ustva.taxable19Tax - caseState.ustva.inputTax;
      };
    } else {
      return { ok: false, kind: "not-found", error: `Synthetisches Feld '${name || aid}' ist nicht definiert.` };
    }
    if (actualBefore !== before) {
      return { ok: false, kind: "precondition-failed", error: `Vorwert '${actualBefore}', erwartet '${before}'.` };
    }
    assign();
    const actualAfter = name === "Beleg-Nr." ? caseState.values.receiptNumber : after;
    caseState.dirty = true;
    epoch += 1;
    return {
      ok: true,
      verified: true,
      feld: { vorher: actualBefore, nachher: actualAfter, ok: actualAfter === after },
      epochNachher: sha256(String(epoch)),
      ergebnisDiff: resultRows(caseState),
    };
  };

  const requireOpenCase = () => {
    const value = model.openCase();
    return value
      ? { value }
      : { error: { ok: false, kind: "not-found", error: "Kein Steuerfall offen." } };
  };

  const vastMappingFingerprint = (rows) => sha256(JSON.stringify(rows.map((row) => ({
    certificate: row.certificate,
    occurrence: row.occurrence,
    localTarget: row.localTarget,
  }))));
  const createVastDialog = () => {
    const rows = [{
      certificate: VAST_CERTIFICATE,
      occurrence: 1,
      expanded: false,
      localTarget: VAST_UNMAPPED,
      options: [VAST_UNMAPPED, VAST_TARGET],
      amountCents: 6_500_000,
    }];
    return { mappingFingerprint: vastMappingFingerprint(rows), rows };
  };

  const findVastRow = (args) => {
    if (!vast) return { error: { ok: false, kind: "not-found", error: "Kein VaSt-Dialog offen." } };
    if (String(args.mappingFingerprint).toUpperCase() !== vast.mappingFingerprint) {
      return { error: { ok: false, kind: "stale", error: "Zuordnungstabelle hat sich geaendert." } };
    }
    const occurrence = Number(args.occurrence ?? 1);
    const value = vast.rows.find((row) => row.certificate === String(args.certificate) && row.occurrence === occurrence);
    return value ? { value } : { error: { ok: false, kind: "not-found", error: "VaSt-Zeile fehlt." } };
  };

  /**
   * Gemeinsamer Vertrag aller Tabellenmutationen: Seite, Vor- und Nachsumme
   * binden die Aktion. Eine verletzte Nachsumme rollt die eigene Aenderung
   * vollstaendig zurueck, statt eine halb geschriebene Tabelle zu hinterlassen.
   */
  const mutateTable = (operation, args, change) => {
    const caseState = model.openCase();
    if (!caseState) return { ok: false, kind: "not-found", error: "Kein Steuerfall offen." };
    if (currentPage !== String(args.expectedPage)) {
      return { ok: false, kind: "precondition-failed", error: `Aktuelle Seite '${currentPage}', erwartet '${args.expectedPage}'.` };
    }
    if (String(args.sumLabel) !== TABLE_SUM_LABEL) {
      return { ok: false, kind: "not-found", error: `Summenzeile '${args.sumLabel}' fehlt auf dieser Seite.` };
    }
    const before = formatCents(tableSumCents(caseState));
    if (before !== String(args.expectedBefore)) {
      return { ok: false, kind: "precondition-failed", error: `Vorsumme '${before}', erwartet '${args.expectedBefore}'.` };
    }
    const backup = clone(caseState.values.sonstigeEinnahmen);
    const outcome = change(caseState.values.sonstigeEinnahmen);
    if (outcome.error) {
      caseState.values.sonstigeEinnahmen = backup;
      return outcome.error;
    }
    const after = formatCents(tableSumCents(caseState));
    if (after !== String(args.expectedAfter)) {
      caseState.values.sonstigeEinnahmen = backup;
      const sums = operation === "table_update"
        ? { summeVorher: before, summeNachher: after }
        : operation === "table_delete"
          ? { before, after, target: String(args.text), rolledBack: true }
          : { sumBefore: before, sumAfter: after };
      return {
        ok: false,
        kind: "postcondition-failed",
        error: `Nachsumme '${after}', erwartet '${args.expectedAfter}'. Eigene Aenderung zurueckgerollt.`,
        ...sums,
        rollback: { versucht: true, erfolgreich: true, summe: formatCents(tableSumCents(caseState)) },
      };
    }
    caseState.dirty = true;
    epoch += 1;
    if (operation === "table_update") {
      return {
        ok: true,
        verified: true,
        ziel: String(args.text),
        summeVorher: before,
        summeNachher: after,
        zellen: [outcome.updated],
      };
    }
    if (operation === "table_delete") {
      return {
        ok: true,
        verified: true,
        geloescht: true,
        target: String(args.text),
        before,
        after,
        nochVorhanden: false,
      };
    }
    return {
      ok: true,
      verified: true,
      sumBefore: before,
      sumAfter: after,
      zellen: [outcome.added],
    };
  };

  const worker = async (operation, args = {}) => {
    journal.push({ operation, args: clone(args) });
    switch (operation) {
      case "product_info": {
        const installationFound = productInfoCalls++ % 2 === 0;
        return {
          ok: true,
          taxYear: 2025,
          engineFileMajor: 31,
          profileId: "2025",
          supportedCaseYears: { einurvor: [2025, 2026] },
          buildDrift: {
            current: installationFound ? "31.0.1.0" : "",
            verified: "31.0.1.0",
            drifted: false,
          },
          defaultExecutable: installationFound
            ? {
                path: "C:\\Synthetic\\Steuerjahr 2025\\SSE.exe",
                exists: true,
                supported: true,
                reason: "Synthetische Produktidentitaet verifiziert.",
                taxYear: 2025,
                expectedFileMajor: 31,
                fileMajor: 31,
                fileMajorSource: "FileMajorPart",
                fileVersion: "31.0.1.0",
                productName: "Synthetische SteuerSparErklaerung",
                companyName: "Synthetischer Hersteller",
                folder: "Steuerjahr 2025",
              }
            : {
                path: "C:\\Synthetic\\Fehlt\\SSE.exe",
                exists: false,
                supported: false,
                reason: "Programmdatei existiert nicht.",
              },
        };
      }
      case "health":
        return { ok: true, running: openPath !== null, advice: "synthetic-healthy" };
      case "list_cases": {
        const files = readdirSync(args.dir ?? caseDir)
          .filter((name) => /\.(?:(?:ESt|Gew)2025|GewErfass2026)$/u.test(name));
        return { ok: true, count: files.length, cases: files.map((name) => ({ name })) };
      }
      case "make_working_copy": {
        const source = resolve(String(args.source));
        const target = resolve(String(args.target));
        if (sha256File(source) !== String(args.expectedSourceHash).toUpperCase()) {
          return { ok: false, kind: "precondition-failed", error: "Quellhash stimmt nicht." };
        }
        copyFileSync(source, target);
        cases.delete(target);
        return {
          ok: true,
          copied: true,
          source,
          target,
          sourceHash: sha256File(source),
          targetHash: sha256File(target),
          verified: true,
        };
      }
      case "launch": {
        if (!args.file || !existsSync(args.file)) return { ok: false, kind: "not-found", error: "Falldatei fehlt." };
        const fileName = basename(String(args.file));
        const expectedMode = fileName.endsWith(".ESt2025")
          ? "normal"
          : fileName.endsWith(".Gew2025")
            ? "einur"
            : fileName.endsWith(".GewErfass2026")
              ? "einurvor"
              : null;
        if (expectedMode === null) {
          return { ok: false, kind: "unsupported-case", error: "Falldatei gehoert nicht zum synthetischen Profil." };
        }
        if (String(args.mode ?? "einur") !== expectedMode) {
          return { ok: false, kind: "mode-mismatch", error: `Startmodus muss fuer diesen Fall '${expectedMode}' sein.` };
        }
        openPath = resolve(String(args.file));
        const caseState = readCase(openPath);
        currentPage = caseState.kind === "income_tax" ? "Arbeitnehmer" : "Einnahmen/Ausgaben";
        return {
          ok: true,
          pid,
          path: openPath,
          sha256: sha256File(openPath),
          case: {
            path: openPath,
            documentType: expectedMode === "einurvor" ? "GewErfass" : expectedMode === "normal" ? "ESt" : "Gew",
            taxYear: caseState.taxYear,
            mode: expectedMode,
            supported: true,
          },
        };
      }
      case "windows": {
        if (!openPath) return { ok: true, windows: [] };
        const caseState = model.openCase();
        return { ok: true, windows: [{ pid, hwnd, title: caseTitle(caseState, openPath), w: 1200, h: 800, minimiert: minimised }] };
      }
      case "launch_probe": {
        if (!openPath) return { ok: true, outcome: "deadline", windows: [], dialogs: [] };
        const caseState = model.openCase();
        return {
          ok: true,
          outcome: "observed",
          windows: [{ pid, hwnd, title: caseTitle(caseState, openPath), w: 1200, h: 800, minimiert: minimised }],
          dialogs: [],
        };
      }
      case "instances": {
        if (!openPath) {
          return {
            ok: true, count: 0, instances: [], ambiguous: false, foregroundHwnd: null,
            advice: "Keine steuerbare Instanz von 'SteuerSparErklaerung 2025' offen.",
          };
        }
        const caseState = model.openCase();
        const title = caseTitle(caseState, openPath);
        // Wie im echten Worker aus dem Dateinamen abgeleitet, nicht aus dem
        // Startmodus geraten.
        const suffix = /\.(?<type>[A-Za-z]+)(?<year>\d{4})(?:_Backup)?$/u.exec(basename(openPath));
        const caseType = suffix ? suffix.groups.type : null;
        const startMode = caseType === "ESt" ? "normal" : caseType === "GewErfass" ? "einurvor" : caseType === "Gew" ? "einur" : null;
        return {
          ok: true, count: 1, ambiguous: false, foregroundHwnd: hwnd,
          instances: [{
            hwnd, pid, title, titleFingerprint: sha256(title).toUpperCase(),
            x: 0, y: 0, w: 1200, h: 800,
            minimized: minimised, hung: false, foreground: !minimised,
            casePath: openPath, caseName: basename(openPath), casePathSource: "title",
            casePathFromTitle: openPath, casePathFromCommandLine: openPath,
            caseType, caseYear: suffix ? Number(suffix.groups.year) : null, startMode,
            caseSha256: null, caseFileMissing: false, recoveredState: false, titleTruncated: false,
          }],
          hashesIncluded: args.includeHash === true,
          advice: "Genau ein Steuerfall ist offen; hwnd ist optional, schadet aber nie.",
        };
      }
      case "dialog_list":
        return { ok: true, count: dialogs.length, dialogs: clone(dialogs), windows: clone(dialogs) };
      case "bulk_action": {
        const actions = Array.isArray(args.actions) ? args.actions : [];
        const completed = [];
        let failedAction = null;
        for (let index = 0; index < actions.length; index += 1) {
          const action = actions[index];
          const result = action?.operation === "tracked_set_value"
            ? applyTrackedValue(action.args ?? {})
            : { ok: false, kind: "operation-not-allowed", error: "Synthetischer Bulk akzeptiert nur tracked_set_value." };
          if (result.ok !== true) {
            failedAction = { index, id: action?.id, operation: action?.operation, result };
            break;
          }
          completed.push({ index, id: action.id, operation: action.operation, result });
        }
        const skipped = failedAction === null
          ? []
          : actions.slice(failedAction.index + 1).map((action, offset) => ({
            index: failedAction.index + 1 + offset,
            id: action.id,
            operation: action.operation,
            status: "skipped",
          }));
        const rollbackEntries = [];
        if (failedAction !== null) {
          for (const entry of [...completed].reverse()) {
            const original = actions[entry.index].args;
            const rollbackResult = applyTrackedValue({
              ...original,
              expectedBefore: original.expectedAfter,
              value: original.expectedBefore,
              expectedAfter: original.expectedBefore,
              expectedEpoch: undefined,
            });
            rollbackEntries.push({ index: entry.index, attempted: true, ok: rollbackResult.ok === true, result: rollbackResult });
          }
        }
        const caseState = model.openCase();
        const fields = pageFields(model).map((field) => ({ id: field.aid, label: field.label, value: field.wert }));
        const dirty = caseState?.dirty ?? null;
        const finalReadback = {
          ok: true,
          pageId: args.finalReadbackPlan?.args?.pageId,
          heading: currentPage,
          dirty,
          epoch: sha256(JSON.stringify({ hwnd, heading: currentPage, dirty, fields })),
          fields,
          privateValuesPersisted: false,
        };
        const rollbackOk = rollbackEntries.every((entry) => entry.ok);
        const resultingState = failedAction === null
          ? "completed-verified"
          : rollbackOk ? "rolled-back-verified" : "unknown";
        return {
          ok: failedAction === null,
          schemaVersion: 1,
          planKind: "fill-fields",
          completed,
          failedAction,
          failedIndex: failedAction?.index ?? null,
          skipped,
          rollback: {
            mode: "best-effort",
            attempted: rollbackEntries.length > 0,
            ok: rollbackEntries.length ? rollbackOk : null,
            entries: rollbackEntries,
          },
          cleanupRequired: resultingState === "unknown",
          finalReadback,
          finalReadbackVerified: true,
          resultingState,
          verified: resultingState !== "unknown",
          performance: {
            workerProcessCount: 1,
            internalOperationCount: completed.length + (failedAction === null ? 1 : 2 + rollbackEntries.length),
            fullUiReadbackCount: 1,
          },
        };
      }
      case "known_page_state": {
        const caseState = model.openCase();
        const fields = pageFields(model).map((field) => ({ id: field.aid, label: field.label, value: field.wert }));
        const dirty = caseState?.dirty ?? null;
        return {
          ok: true,
          pageId: args.pageId,
          heading: currentPage,
          dirty,
          // Wie der echte Worker ein Inhaltsfingerprint, kein Zaehler.
          epoch: sha256(JSON.stringify({ hwnd, heading: currentPage, dirty, fields })),
          fields,
          privateValuesPersisted: false,
        };
      }
      case "page": {
        const caseState = model.openCase();
        if (!caseState) return { ok: false, kind: "not-found", error: "Kein Steuerfall offen." };
        return {
          ok: true,
          ueberschrift: currentPage,
          felder: pageFields(model),
          aktionen: [{ name: "ELSTER", gesperrt: true }],
          dialoge: clone(dialogs),
          prueferMeldungen: checkerMessages(caseState).map((entry) => entry.text),
          blockiert: dialogs.length > 0,
        };
      }
      case "ui_state": {
        const caseState = model.openCase();
        if (!caseState) return { ok: true, running: false, instance: null, stateFingerprint: null };
        const messages = checkerMessages(caseState);
        const ergebnis = resultDetails(caseState);
        return {
          ok: true,
          running: true,
          instance: { pid, hwnd, title: caseTitle(caseState, openPath) },
          stateFingerprint: sha256(JSON.stringify({ epoch, currentPage, dialogs, messages, dirty: caseState.dirty })),
          heading: currentPage,
          blockiert: dialogs.length > 0 || messages.length > 0,
          dialoge: clone(dialogs),
          prueferMeldungen: messages.map((entry) => entry.text),
          baumFehler: [],
          leerePflichtfelder: [],
          steuerpruefer: { aktiv: checkerActive, konsistent: true, fragenWarnungenAngekuendigt: messages.length },
          ungespeichert: caseState.dirty,
          ergebnis,
        };
      }
      case "result_details": {
        const caseState = model.openCase();
        if (!caseState) return { ok: false, kind: "not-found", error: "Kein Steuerfall offen." };
        return {
          ok: true,
          geoeffnet: true,
          fenster: { hwnd: 4343, title: "Werte-Info: Werte vergleichen - Was wäre wenn", w: 800, h: 600 },
          spalten: { beobachteterWert: "Beobachteter Wert", aktuell: "Aktuell", festgehalten: "Festgehalten", differenz: "Differenz" },
          ...resultDetails(caseState),
        };
      }
      case "tracked_set_value":
        return applyTrackedValue(args);
      case "combo_select": {
        const caseState = model.openCase();
        const bindingError = requireCaseBinding(args, caseState);
        if (bindingError) return bindingError;
        if (args.aid === ".AuswahlAnmeldezeitraum.AuswahlMonat.Combobox") caseState.ustva.month = String(args.value);
        caseState.dirty = true;
        epoch += 1;
        return { ok: true, before: args.expectedCurrent, selected: args.value, after: args.expectedAfter };
      }
      case "toggle": {
        const caseState = model.openCase();
        const bindingError = requireCaseBinding(args, caseState);
        if (bindingError) return bindingError;
        if (args.aid === ".RahmenWerteUebersicht.ManuelleEingabe") caseState.ustva.manualInput = Boolean(args.value);
        caseState.dirty = args.expectedBefore !== args.expectedAfter || caseState.dirty;
        epoch += 1;
        return { ok: true, before: args.expectedBefore, after: args.expectedAfter };
      }
      case "click": {
        const before = currentPage;
        const target = String(args.expectedPageAfter ?? "");
        if (target) currentPage = target;
        return {
          ok: true,
          clicked: String(args.name ?? args.aid ?? "synthetic-click"),
          pattern: String(args.pattern ?? "invoke"),
          method: "synthetic-bound-action",
          kandidaten: 1,
          ueberschriftVorher: before,
          ueberschriftNachher: currentPage,
          navigiert: before !== currentPage,
          verified: true,
        };
      }
      case "save": {
        const caseState = model.openCase();
        const expectedPath = resolve(String(args.expectedPath));
        if (!caseState || expectedPath !== caseState.path) {
          return { ok: false, kind: "precondition-failed", error: "Pfadvertrag verletzt. NICHT gespeichert." };
        }
        const before = sha256File(expectedPath);
        if (before !== String(args.expectedHashBefore).toUpperCase()) {
          return { ok: false, kind: "precondition-failed", error: "Hashvertrag verletzt. NICHT gespeichert." };
        }
        if (!caseState.dirty) {
          return { ok: true, saved: false, noChanges: true, path: expectedPath, hashBefore: before, hashAfter: before, verified: true };
        }
        writeCanonicalCase(expectedPath, caseState);
        const after = sha256File(expectedPath);
        caseState.dirty = false;
        return { ok: true, saved: true, noChanges: false, path: expectedPath, hashBefore: before, hashAfter: after, verified: true };
      }
      case "checker_open_plan": {
        const expectedKeys = args.hwnd === undefined
          ? ["name", "planKind", "schemaVersion"]
          : ["hwnd", "name", "planKind", "schemaVersion"];
        if (JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(expectedKeys) ||
            args.schemaVersion !== 1 || args.planKind !== "checker-open" ||
            typeof args.name !== "string" || !args.name.trim()) {
          return { ok: false, kind: "bad-args", error: "Privater synthetischer Checkerplan ist ungueltig." };
        }
        const timings = [];
        let reusedReadbackCount = 0;
        const initial = await worker("checker_results", args.hwnd === undefined ? {} : { hwnd: args.hwnd });
        timings.push({ operation: "checker_results", ms: 0 });
        let current = initial;
        if (current.aktiv !== true) {
          const page = await worker("page", args.hwnd === undefined ? {} : { hwnd: args.hwnd });
          timings.push({ operation: "page", ms: 0 });
          if (page.ueberschrift === "Prüfen und Abgeben") {
            await worker("click", {
              name: "Weiter", type: "Button", expectedPageBefore: "Prüfen und Abgeben",
              expectedPageAfter: "Steuererklärung prüfen", waitMs: 900,
            });
            timings.push({ operation: "click", ms: 0 });
          }
          const started = await worker("checker_run", args.hwnd === undefined ? {} : { hwnd: args.hwnd });
          timings.push({ operation: "checker_run", ms: 0 });
          current = {
            ...started,
            aktiv: true,
            aufgeklappt: [],
            fragenWarnungen: checkerMessages(model.openCase()),
            tippsZusatzinfos: [],
            sonstige: [],
          };
          reusedReadbackCount += 1;
        }
        const messages = [
          ...(current.fragenWarnungen ?? []),
          ...(current.tippsZusatzinfos ?? []),
          ...(current.sonstige ?? []),
        ];
        if (!messages.some((message) => message.text === args.name)) {
          return {
            ok: false, kind: "checker-message", error: `Meldung nicht exakt gefunden: '${args.name}'`,
            schemaVersion: 1, planKind: "checker-open", resultingState: "checker-active", cleanupRequired: false,
            performance: { workerProcessCount: 1, internalOperationCount: timings.length, internalTimings: timings, reusedReadbackCount },
          };
        }
        if (!(current.aufgeklappt ?? []).includes(args.name)) {
          await worker("click_point", { name: args.name, type: "TreeItem", waitMs: 1200, checkerReadOnly: true });
          timings.push({ operation: "click_point", ms: 0 });
        }
        const verified = await worker("checker_results", args.hwnd === undefined ? {} : { hwnd: args.hwnd });
        timings.push({ operation: "checker_results", ms: 0 });
        if (!verified.aufgeklappt.includes(args.name)) {
          return {
            ok: false, kind: "checker-message", error: "Meldung wurde nicht geoeffnet.",
            schemaVersion: 1, planKind: "checker-open", resultingState: "unknown", cleanupRequired: true,
            performance: { workerProcessCount: 1, internalOperationCount: timings.length, internalTimings: timings, reusedReadbackCount },
          };
        }
        const detail = await worker("checker_detail", { name: args.name, ...(args.hwnd === undefined ? {} : { hwnd: args.hwnd }) });
        timings.push({ operation: "checker_detail", ms: 0 });
        return {
          ...detail,
          schemaVersion: 1,
          planKind: "checker-open",
          resultingState: "detail-verified",
          cleanupRequired: false,
          performance: {
            workerProcessCount: 1,
            internalOperationCount: timings.length,
            internalTimings: timings,
            reusedReadbackCount,
          },
        };
      }
      case "checker_results": {
        const messages = checkerMessages(model.openCase());
        return {
          ok: true,
          aktiv: checkerActive,
          fragenWarnungenAngekuendigt: messages.length,
          tippsAngekuendigt: 0,
          fragenWarnungen: messages,
          tippsZusatzinfos: [],
          sonstige: [],
          gesamt: messages.length,
          aufgeklappt: clone(expandedChecker),
          konsistent: true,
          ungespeichert: model.openCase()?.dirty ?? false,
        };
      }
      case "checker_run": {
        const wasActive = checkerWindowOpen;
        checkerActive = true;
        checkerWindowOpen = true;
        return {
          ok: true,
          gestartet: true,
          bereitsAktiv: wasActive,
          konsistent: true,
          gesamt: checkerMessages(model.openCase()).length,
        };
      }
      case "click_point":
        if (args.checkerReadOnly === true) expandedChecker = [String(args.name)];
        return { ok: true, clicked: String(args.name ?? ""), verified: true };
      case "checker_reset":
        expandedChecker = [];
        return {
          ok: true,
          geschlossen: [],
          anzahlGeschlossen: 0,
          konsistent: true,
          fragenWarnungenAngekuendigt: checkerMessages(model.openCase()).length,
          tippsAngekuendigt: 0,
          fragenWarnungen: checkerMessages(model.openCase()),
          tippsZusatzinfos: [],
          sonstige: [],
          aufgeklappt: [],
          technischeFokusKarten: [],
          nichtGeschlossen: [],
          navigationSchritte: 0,
          fokusVerwendet: false,
          ohneOffeneKarten: true,
          ungespeichert: model.openCase()?.dirty ?? null,
          hinweis: "Synthetischer Prueferbaum ist geschlossen.",
        };
      case "checker_detail": {
        const text = "Bitte tragen Sie die fehlende Belegnummer ein.";
        return {
          ok: true,
          meldung: args.name,
          text,
          leseweg: "synthetic-structured",
          bildBase64: Buffer.from("synthetic-control-image").toString("base64"),
          strukturiertOk: true,
          ocrVerwendet: false,
          ocrOk: null,
          strukturQuellen: ["synthetic-tree"],
          sprache: "deu",
          zeilen: 1,
          ocrFehler: null,
          inAnsichtGerollt: false,
          ungespeichert: model.openCase()?.dirty ?? null,
        };
      }
      case "warning_popup_read": {
        const dialog = dialogs[0];
        if (!dialog) return { ok: true, active: false, warnings: [], actions: [], text: "" };
        return {
          ok: true,
          active: true,
          hwnd: dialog.hwnd,
          pid,
          title: dialog.title,
          fingerprint: dialog.fingerprint,
          warnings: ["Synthetischer Pruefhinweis"],
          actions: dialog.buttons,
          text: WARNING_TEXT,
          bodyFingerprint: sha256(WARNING_TEXT),
          ocrVerwendet: false,
        };
      }
      case "dialog_answer": {
        const dialog = dialogs.find((entry) => entry.hwnd === args.hwnd);
        if (!dialog || dialog.fingerprint !== args.fingerprint) {
          return { ok: false, kind: "stale", error: "Dialogbindung ist nicht mehr aktuell." };
        }
        if (!dialog.buttons.includes(args.button)) {
          return { ok: false, kind: "blocked", error: "Dialogaktion ist nicht freigegeben." };
        }
        dialogs = dialogs.filter((entry) => entry !== dialog);
        return { ok: true, answered: true, closed: true, button: args.button };
      }
      case "close":
        openPath = null;
        currentPage = null;
        dialogs = [];
        vast = null;
        openMenu = null;
        fileDialog = null;
        checkerWindowOpen = false;
        return { ok: true, closed: true, saved: false, stillRunning: false, killed: false };

      // ---------------------------------------------------------- Navigation
      case "goto": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const pageIdTargets = { "gew.fahrzeug": "1. Fahrzeug" };
        const target = args.pageId ? pageIdTargets[String(args.pageId)] : String(args.ziel);
        if (!target) {
          return { ok: false, kind: "unknown-page-object", error: `Unbekannte Page-Object-ID '${String(args.pageId)}'.` };
        }
        if (currentPage === target) {
          return { ok: true, erreicht: true, pageId: args.pageId, ueberschrift: currentPage, weg: ["schon dort"], schritte: 0 };
        }
        const sequence = pageSequence(caseState.value);
        const targetIndex = sequence.indexOf(target);
        if (targetIndex < 0) {
          return { ok: false, kind: "not-found", error: `Seite '${target}' gehoert nicht zu diesem Steuerfall.` };
        }
        const startIndex = sequence.indexOf(currentPage);
        const weg = args.viaSuche === false
          ? sequence.slice(Math.min(startIndex, targetIndex), Math.max(startIndex, targetIndex) + 1)
          : [target];
        const maxSteps = Number(args.maxSteps ?? 200);
        if (weg.length - 1 > maxSteps) {
          return { ok: false, kind: "precondition-failed", error: `Ziel liegt weiter als ${maxSteps} Schritte entfernt.` };
        }
        currentPage = target;
        verticalPercent = 0;
        return { ok: true, erreicht: true, pageId: args.pageId, ueberschrift: currentPage, weg, schritte: weg.length - 1 };
      }
      case "subpages": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const sequence = pageSequence(caseState.value);
        const unterseiten = sequence.slice(sequence.indexOf(currentPage) + 1)
          .map((name, index) => ({ name, ebene: index + 1 }));
        return { ok: true, anzahl: unterseiten.length, unterseiten };
      }
      case "tree_top":
        treeOffset = 0;
        return {
          ok: true,
          gerollt: "top",
          schritte: Number(args.steps ?? 1),
          ersterKnoten: pageSequence(model.openCase())[0],
          sichtbareKnoten: pageSequence(model.openCase()).slice(0, 4),
        };
      case "tree_scroll":
        treeOffset = Math.max(0, treeOffset + (args.direction === "up" ? -1 : 1) * Number(args.steps ?? 1));
        return {
          ok: true,
          gerollt: String(args.direction ?? "down"),
          schritte: Number(args.steps ?? 1),
          ersterKnoten: pageSequence(model.openCase())[treeOffset] ?? null,
          letzterKnoten: pageSequence(model.openCase()).at(-1) ?? null,
          sichtbareKnoten: pageSequence(model.openCase()).slice(treeOffset, treeOffset + 4),
        };
      case "scroll": {
        if (args.mode === "percent") verticalPercent = Number(args.vPercent ?? 0);
        const nodes = pageElements(model);
        if (args.mode === "intoview") {
          const target = nodes.find((node) => matchesSelector(node, args));
          return { ok: true, mode: "intoview", scrolledTo: target?.name ?? null };
        }
        if (args.mode === "list") {
          return { ok: true, count: 1, scrollables: [{ name: currentPage, vPercent: verticalPercent }] };
        }
        return { ok: true, mode: "percent", target: currentPage, vPercent: verticalPercent };
      }
      case "scroll_page": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const scrollbar = pageElements(model).length > 8;
        const before = verticalPercent;
        if (args.mode === "percent") verticalPercent = Number(args.vPercent ?? 0);
        if (args.mode === "amount") {
          verticalPercent = Math.min(100, Math.max(0, verticalPercent + (args.direction === "up" ? -25 : 25)));
        }
        if (!scrollbar) {
          return {
            ok: true,
            scrollbar: false,
            position: -1,
            sichtbarerAnteil: 100,
            hinweis: "Kein rollbarer Inhaltsbereich.",
          };
        }
        return {
          ok: true,
          scrollbar: true,
          vorher: before,
          nachher: verticalPercent,
          bereich: String(args.direction ?? args.mode ?? "info"),
          bewegt: args.mode !== "info",
        };
      }

      // ------------------------------------------------------------- Lesen
      case "read_page": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const nodes = pageElements(model)
          .filter((node) => args.minX === undefined || node.x >= Number(args.minX))
          .filter((node) => args.maxX === undefined || node.x <= Number(args.maxX));
        return {
          ok: true,
          heading: currentPage,
          bounds: { x: 0, y: 0, w: 1200, h: 800 },
          lines: nodes.map((node) => (node.value ? `${node.name}\t${node.value}` : node.name)),
          stats: { knoten: nodes.length, gefiltert: pageElements(model).length - nodes.length },
        };
      }
      case "read_full": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const zeilen = pageElements(model).map((node) => (node.value ? `${node.name}\t${node.value}` : node.name));
        return { ok: true, ueberschrift: currentPage, gerollt: zeilen.length > 8, stufen: 1, anzahl: zeilen.length, zeilen };
      }
      case "find": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const hits = pageElements(model).filter((node) => matchesSelector(node, args));
        return {
          ok: true,
          count: hits.length,
          incomplete: false,
          hits: hits.map(({ rid, aid, name, type, value }) => ({ rid, aid, name, type, value })),
          stats: { visited: pageElements(model).length },
          note: null,
        };
      }
      case "get_value": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const treffer = pageElements(model).filter((node) => matchesSelector(node, args));
        if (!treffer.length) return { ok: false, kind: "not-found", error: "Kein Element passt zum Bezeichner." };
        if (treffer.length > 1) {
          return { ok: false, kind: "ambiguous", error: `Bezeichner trifft ${treffer.length} Elemente.` };
        }
        const [node] = treffer;
        return {
          ok: true,
          node: { name: node.name, type: node.type, aid: node.aid, rid: node.rid },
          value: node.value,
          readOnly: node.type !== "Edit",
        };
      }
      case "positions": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const nodes = pageElements(model);
        return {
          ok: true,
          anzahl: nodes.length,
          positionen: nodes.map((node) => ({ name: node.name, typ: node.type, x: node.x, y: node.y, w: node.w, h: node.h })),
          hinweis: null,
        };
      }
      case "help": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        return {
          ok: true,
          seite: currentPage,
          abschnitte: {
            [`Hilfe zu ${currentPage}`]: {
              zeilen: [`Synthetische Hilfe zur Seite ${currentPage}.`, "Alle Betraege sind erfunden."],
            },
          },
          hinweis: null,
        };
      }
      case "check": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const leer = pageElements(model).filter((node) =>
          node.rid !== "rid.global.search" && node.type === "Edit" && node.value === "");
        return {
          ok: true,
          beanstandungsfrei: leer.length === 0,
          seite: currentPage,
          prueferMeldungen: checkerMessages(caseState.value),
          baumFehler: [],
          leerePflichtfelder: leer.map((node) => node.name),
          ergebnisAnzeige: "synthetisch",
          steuerpruefer: { aktiv: checkerActive },
          urteil: leer.length === 0 ? "beanstandungsfrei" : "pruefen",
        };
      }
      case "collect": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const sequence = pageSequence(caseState.value);
        const startIndex = sequence.indexOf(currentPage);
        const maxPages = Number(args.maxPages ?? 3);
        const besucht = sequence.slice(startIndex, startIndex + maxPages);
        const seiten = besucht.map((name) => {
          currentPage = name;
          return { ueberschrift: name, felder: pageFields(model).map((field) => ({ label: field.label, wert: String(field.wert) })) };
        });
        const payload = {
          ok: true,
          vollstaendig: besucht.length === sequence.length - startIndex,
          stopKind: "ende",
          stopReason: "Alle angeforderten Seiten gelesen.",
          anzahl: seiten.length,
          ueberschriften: besucht,
          seiten,
          currentHeadingAfter: currentPage,
          advancedAfterLastCaptured: false,
        };
        if (typeof args.path === "string") {
          mkdirSync(dirname(resolve(args.path)), { recursive: true });
          const text = `${JSON.stringify(payload, null, 2)}\n`;
          writeFileSync(resolve(args.path), text, "utf8");
          return { ...payload, path: resolve(args.path), dateiHash: sha256(text) };
        }
        return payload;
      }

      // ------------------------------------------------------------ Tabelle
      case "read_table": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const rows = tableRows(caseState.value);
        return {
          ok: true,
          headers: ["Datum", "Text", "Betrag"],
          rows: rows.map((row) => [row.datum, row.text, formatCents(row.betrag)]),
          rowCount: rows.length,
          ausgeschlosseneFenster: [],
          stats: { fenster: 1, tabellen: currentPage === TABLE_PAGE ? 1 : 0 },
          incomplete: false,
        };
      }
      case "table_read": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const rows = tableRows(caseState.value).slice(0, Number(args.maxRows ?? 200));
        return {
          ok: true,
          anzahl: rows.length,
          vollstaendig: rows.length === tableRows(caseState.value).length,
          summe: formatCents(tableSumCents(caseState.value)),
          sumLabel: args.sumLabel ?? TABLE_SUM_LABEL,
          zeilen: rows.map((row) => ({ datum: row.datum, text: row.text, betrag: formatCents(row.betrag) })),
        };
      }
      case "table_add":
        return mutateTable("table_add", args, (rows) => {
          const [, datum, text, betrag] = args.werte.map((value) => String(value ?? ""));
          const cents = parseGermanCents(betrag);
          if (cents === null) return { error: { ok: false, kind: "bad-args", error: `Betrag '${betrag}' ist kein deutscher Geldwert.` } };
          rows.push({ datum, text, betrag: cents });
          return { added: { datum, text, betrag: cents } };
        });
      case "table_update":
        return mutateTable("table_update", args, (rows) => {
          const index = rows.findIndex((row) => row.text === String(args.text));
          if (index < 0) return { error: { ok: false, kind: "not-found", error: `Zeile '${args.text}' fehlt.` } };
          const [datum, text, betrag] = args.werte.map((value) => (value === null ? null : String(value)));
          if (datum !== null) rows[index].datum = datum;
          if (text !== null) rows[index].text = text;
          if (betrag !== null) {
            const cents = parseGermanCents(betrag);
            if (cents === null) return { error: { ok: false, kind: "bad-args", error: `Betrag '${betrag}' ist kein deutscher Geldwert.` } };
            rows[index].betrag = cents;
          }
          return { updated: clone(rows[index]) };
        });
      case "table_delete":
        return mutateTable("table_delete", args, (rows) => {
          const index = rows.findIndex((row) => row.text === String(args.text));
          if (index < 0) return { error: { ok: false, kind: "not-found", error: `Zeile '${args.text}' fehlt.` } };
          const [removed] = rows.splice(index, 1);
          return { deleted: clone(removed) };
        });

      // --------------------------------------------------- Auswahl und Menue
      case "combo_options": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const treffer = pageElements(model).filter((node) => node.type === "ComboBox" && matchesSelector(node, args));
        if (!treffer.length) return { ok: false, kind: "not-found", error: "Keine ComboBox passt zum Bezeichner." };
        const [node] = treffer;
        const options = node.name === "Auswahl Monat" ? MONTHS : ["monatlich", "vierteljährlich", "jährlich"];
        return {
          ok: true,
          current: node.value,
          combo: { rid: node.rid, aid: node.aid },
          options,
          collapsedAfterRead: true,
        };
      }
      case "set_value": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (String(args.rid) !== "rid.global.search") {
          return { ok: false, kind: "blocked", error: "set_value ist nur fuer das globale Suchfeld zugelassen." };
        }
        const before = searchValue;
        const requested = String(args.value);
        const expectedAfter = String(args.expectedAfter);
        if (before !== String(args.expectedBefore)) {
          return { ok: false, kind: "precondition-failed", error: `Vorwert '${before}', erwartet '${args.expectedBefore}'.` };
        }
        searchValue = requested;
        const windowFingerprint = sha256(JSON.stringify({ hwnd, pid, dialogs: dialogs.length }));
        if (searchValue !== expectedAfter) {
          searchValue = before;
          return {
            ok: false,
            kind: "postcondition-failed",
            error: `Suchfeld zeigt '${requested}', erwartet '${expectedAfter}'.`,
            before,
            requested,
            after: requested,
            expectedAfter,
            verified: false,
            page: currentPage,
            binding: { rid: "rid.global.search" },
            rollback: { versucht: true, erfolgreich: true, ist: searchValue, erwartet: before, grund: null },
          };
        }
        return {
          ok: true,
          verified: true,
          before,
          requested,
          after: searchValue,
          expectedAfter,
          page: currentPage,
          binding: { rid: "rid.global.search" },
          inputGuard: { aktiv: false, baseline: null, beobachtet: null, eingriffErkannt: false },
          windowGuard: { vorher: windowFingerprint, nachher: windowFingerprint, geaendert: false },
        };
      }
      case "menu": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        return {
          ok: true,
          menues: MENUS.map(({ name, eintraege }) => ({
            name,
            eintraege: eintraege.map((entry) => ({ name: entry.name, gesperrt: entry.blocked === true })),
          })),
          hinweis: null,
        };
      }
      case "menu_click": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const name = String(args.name);
        const entry = MENUS.flatMap((menu) => menu.eintraege).find((candidate) => candidate.name === name);
        if (!entry) return { ok: false, kind: "not-found", error: `Menueeintrag '${name}' fehlt.` };
        if (entry.blocked) {
          return { ok: false, kind: "blocked", error: `Menueeintrag '${name}' ist gesperrt; dieser Server uebermittelt nichts.` };
        }
        openMenu = entry.menu;
        if (entry.opens === "file-dialog") {
          fileDialog = { hwnd: 6161, title: "Steuerfall öffnen", fingerprint: sha256("synthetic-file-dialog") };
        }
        if (entry.opens === "vast") vast = createVastDialog();
        if (entry.opens === "receipt-manager") receiptManagerOpen = true;
        return {
          ok: true,
          ausgeloest: name,
          angefordert: name,
          method: "synthetic-bound-action",
          fenster: fileDialog || vast ? 2 : 1,
          ungespeichertVorher: caseState.value.dirty,
          ungespeichertNachher: caseState.value.dirty,
        };
      }
      case "menu_close":
        openMenu = null;
        return { ok: true, collapsed: ["synthetic-menu"], popupCountBefore: 1, popupCountAfter: 0, verified: true, warning: null };
      case "receipt_manager_action": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (!receiptManagerOpen) return { ok: false, kind: "not-found", error: "BelegManager ist nicht offen." };
        const actionId = String(args.actionId);
        const transition = actionId === "showAllReceipts"
          ? { from: "start", to: "list", aid: ".btn_alleBelegeAnzeigen", name: "Alle Belege anzeigen" }
          : actionId === "goHome"
            ? { from: "list", to: "start", aid: ".pushButton_home", name: "" }
            : null;
        if (!transition) return { ok: false, kind: "bad-args", error: "Unbekannte actionId." };
        if (receiptManagerState !== transition.from) {
          return { ok: false, kind: "precondition-failed", error: `Erwartet ${transition.from}, aktuell ${receiptManagerState}.` };
        }
        const stateBefore = receiptManagerState;
        receiptManagerState = transition.to;
        const windowSetFingerprint = sha256("synthetic-receipt-window-set");
        return {
          ok: true,
          actionId,
          pid,
          hwnd: 5252,
          controlAutomationId: `SSE_Application.BMMainWindow${transition.aid}`,
          controlName: transition.name,
          stateBefore,
          stateAfter: receiptManagerState,
          stateFingerprintBefore: sha256(`receipt-${stateBefore}`),
          stateFingerprintAfter: sha256(`receipt-${receiptManagerState}`),
          windowSetFingerprintBefore: windowSetFingerprint,
          windowSetFingerprintAfter: windowSetFingerprint,
          windowSetUnchanged: true,
          ungespeichertVorher: caseState.value.dirty,
          ungespeichertNachher: caseState.value.dirty,
          dirtyStateUnchanged: true,
          physicalInputUsed: true,
          foregroundLeaseUsed: true,
          verified: true,
          clickBinding: { x: 1, y: 1 },
        };
      }
      case "receipt_manager_bulk_upsert": {
        const startedAt = Date.now();
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (!receiptManagerOpen || receiptManagerState !== "list") {
          return { ok: false, kind: "precondition-failed", error: "Belegliste ist nicht offen." };
        }
        if (args.acknowledgeBulkUpsert !== true || !Array.isArray(args.items) || args.items.length === 0) {
          return { ok: false, kind: "bad-args", error: "Ein bestaetigter, nicht leerer Belegplan ist erforderlich." };
        }

        const originalRows = clone(receiptRows);
        const completed = [];
        const skipped = [];
        let failedAction = null;
        const normalizedAmount = (value) => String(value ?? "").replace(",", ".");
        const matchesIdentity = (row, identity) => {
          if (row.title !== identity.exactTitle) return false;
          if (identity.documentNumber !== undefined) return row.documentNumber === identity.documentNumber;
          return row.date === identity.date && normalizedAmount(row.amount) === normalizedAmount(identity.amount);
        };

        for (let index = 0; index < args.items.length; index += 1) {
          const item = args.items[index];
          const matches = receiptRows.filter((row) => matchesIdentity(row, item.identity ?? {}));
          if (matches.length > 1) {
            failedAction = { index, kind: "ambiguous", error: "Die fachliche Belegidentitaet ist nicht eindeutig." };
            break;
          }
          if (matches.length === 1 && (item.onExisting ?? "update") === "error") {
            failedAction = { index, kind: "already-exists", error: "Der Beleg ist bereits vorhanden." };
            break;
          }
          if (matches.length === 1 && item.onExisting === "skip") {
            const result = { index, action: "skipped", rowRid: matches[0].rowRid, verified: true };
            completed.push(result);
            skipped.push(result);
            continue;
          }

          const action = matches.length === 1 ? "updated" : "imported";
          const row = matches[0] ?? {
            rowRid: `42.5252.4.${nextReceiptId++}`,
            title: "Neuer Beleg*",
            draft: true,
            date: "",
            documentNumber: "",
            amount: "0,00",
            vatRate: "19",
            net: false,
            note: "",
          };
          if (matches.length === 0) receiptRows.push(row);
          for (const [name, raw] of Object.entries(item.values ?? {})) {
            row[name] = name === "amount" ? String(raw).replace(".", ",") : raw;
          }
          if (Object.prototype.hasOwnProperty.call(item.values ?? {}, "title")) row.draft = false;
          completed.push({ index, action, rowRid: row.rowRid, values: clone(item.values ?? {}), verified: true });
        }

        let rollback = { attempted: false, ok: true, actions: [] };
        if (failedAction && completed.some((item) => item.action !== "skipped")) {
          receiptRows = originalRows;
          rollback = {
            attempted: true,
            ok: true,
            actions: completed.filter((item) => item.action !== "skipped").map((item) => ({ index: item.index, ok: true })),
          };
        }
        const rolledBack = Boolean(failedAction && rollback.attempted && rollback.ok);
        const finalItems = args.items.map((item, index) => {
          const matches = receiptRows.filter((row) => matchesIdentity(row, item.identity ?? {}));
          return { index, matchedCount: matches.length, verified: rolledBack ? matches.length === 0 : matches.length === 1 };
        });
        const finalReadbackVerified = finalItems.every((item) => item.verified);
        const ok = failedAction === null && finalReadbackVerified;
        return {
          ok,
          kind: ok ? undefined : failedAction?.kind ?? "verification-failed",
          error: ok ? undefined : failedAction?.error ?? "Der abschliessende Beleg-Readback ist fehlgeschlagen.",
          schemaVersion: 1,
          planKind: "receipt-manager-bulk-upsert",
          pid,
          hwnd: 5252,
          mainHwnd: 4242,
          managerHwnd: 5252,
          requestedCount: args.items.length,
          completedCount: completed.length,
          completed,
          items: completed,
          failedAction,
          failedIndex: failedAction?.index,
          failure: failedAction,
          skipped,
          rollback,
          cleanupRequired: !ok && !rolledBack,
          finalReadback: { items: finalItems },
          finalReadbackVerified,
          resultingState: ok ? "completed-verified" : rolledBack ? "rolled-back-verified" : "unknown",
          performance: {
            workerProcessCount: 1,
            internalOperationCount: 2 + completed.length,
            durationMs: Date.now() - startedAt,
          },
          verified: finalReadbackVerified,
        };
      }
      case "receipt_manager_list": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (!receiptManagerOpen) return { ok: false, kind: "not-found", error: "BelegManager ist nicht offen." };
        if (receiptManagerState !== "list") {
          return { ok: false, kind: "precondition-failed", error: `Erwartet list, aktuell ${receiptManagerState}.` };
        }
        const rows = receiptRows.map((row, index) => ({
          index: index + 1,
          rowRid: row.rowRid,
          rowFingerprint: sha256(`${index + 1}:${row.rowRid}:${row.title}`),
          contentFingerprint: sha256(row.title),
          primaryText: row.title,
          cells: [{ name: row.title, rid: row.rowRid, selected: false, x: 1, y: index + 1, w: 1, h: 1 }],
          draft: row.draft,
          selected: false,
        }));
        let matches = rows;
        if (args.filter?.exactTitle !== undefined) matches = matches.filter((row) => row.primaryText === args.filter.exactTitle);
        if (args.filter?.titleContains !== undefined) {
          const needle = String(args.filter.titleContains).toLocaleLowerCase("de-DE");
          matches = matches.filter((row) => row.primaryText.toLocaleLowerCase("de-DE").includes(needle));
        }
        if (args.filter?.draft !== undefined) matches = matches.filter((row) => row.draft === args.filter.draft);
        const limit = Number(args.limit ?? 50);
        return {
          ok: true,
          pid,
          hwnd: 5252,
          mainHwnd: 4242,
          managerHwnd: 5252,
          state: "list",
          stateFingerprint: sha256("receipt-list"),
          count: rows.length,
          countSource: "info-label",
          headers: ["Bezeichnung", "Betrag"],
          rows,
          draftCount: rows.filter((row) => row.draft).length,
          listFingerprint: sha256(JSON.stringify({ count: rows.length, rows: rows.map((row) => row.rowFingerprint) })),
          rowsComplete: true,
          matchedCount: matches.length,
          matches: matches.slice(0, limit).map((row) => ({
            index: row.index, title: row.primaryText, draft: row.draft, rowRid: row.rowRid,
            rowFingerprint: row.rowFingerprint, contentFingerprint: row.contentFingerprint,
          })),
          matchesComplete: matches.length <= limit,
          ungespeichert: caseState.value.dirty,
          physicalInputUsed: false,
          hinweis: "Alle vom BelegManager gezaehlten Zeilen sind im UIA-Baum enthalten.",
        };
      }
      case "receipt_manager_link": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (currentPage !== String(args.expectedTargetPage)) {
          return { ok: false, kind: "stale", error: "Steuerseite stimmt nicht mehr." };
        }
        const items = Array.isArray(args.items) ? args.items : [{
          expectedReceiptTitle: args.expectedReceiptTitle,
          receiptContentFingerprint: args.receiptContentFingerprint,
          linked: args.linked,
        }];
        const resolved = [];
        for (const item of items) {
          const expectedFingerprint = item.receiptContentFingerprint
            ? String(item.receiptContentFingerprint).toUpperCase()
            : null;
          const matches = receiptRows.map((row, index) => ({ row, index })).filter(({ row }) => (
            row.title === item.expectedReceiptTitle
            && (!expectedFingerprint || sha256(row.title) === expectedFingerprint)
          ));
          if (matches.length !== 1) {
            return { ok: false, kind: matches.length ? "ambiguous" : "stale", error: "Beleg ist nicht eindeutig." };
          }
          resolved.push({ item, ...matches[0] });
        }
        const beforeCount = [...receiptLinks.values()].filter(Boolean).length;
        let changedCount = 0;
        const resultItems = resolved.map(({ item, row, index }) => {
          const linkedBefore = receiptLinks.get(row.rowRid) === true;
          const linkedAfter = Boolean(item.linked);
          if (linkedBefore !== linkedAfter) changedCount += 1;
          receiptLinks.set(row.rowRid, linkedAfter);
          return {
            receipt: {
              index: index + 1,
              rowRid: row.rowRid,
              rowFingerprint: sha256(`${index + 1}:${row.rowRid}:${row.title}`),
              contentFingerprint: sha256(row.title),
              primaryText: row.title,
              draft: row.draft,
            },
            expectedReceiptTitle: item.expectedReceiptTitle,
            linkedBefore,
            linkedAfter,
            changed: linkedBefore !== linkedAfter,
            verified: true,
          };
        });
        const afterCount = [...receiptLinks.values()].filter(Boolean).length;
        return {
          ok: true, pid, hwnd: 4242, mainHwnd: 4242, managerHwnd: 5252,
          receipt: resultItems[0].receipt, items: resultItems,
          expectedTargetPage: args.expectedTargetPage, expectedLinkTarget: args.expectedLinkTarget,
          linkedBefore: resultItems[0].linkedBefore, linkedAfter: resultItems[0].linkedAfter,
          footerCountBefore: beforeCount, footerCountAfter: afterCount,
          noChanges: changedCount === 0, changedCount, applied: changedCount > 0,
          persistenceVerified: true, cleanupRequired: false,
          dirtyStateUnchangedBeforeApply: true, physicalInputUsed: true,
          foregroundLeaseUsed: true, verified: true,
        };
      }
      case "receipt_manager_read": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (!receiptManagerOpen || receiptManagerState !== "list") {
          return { ok: false, kind: "precondition-failed", error: "Belegliste ist nicht offen." };
        }
        const rows = receiptRows.map((row, index) => ({
          index: index + 1,
          rowRid: row.rowRid,
          rowFingerprint: sha256(`${index + 1}:${row.rowRid}:${row.title}`),
          contentFingerprint: sha256(row.title),
          cells: [{ name: row.title }],
          draft: row.draft,
        }));
        const listFingerprint = sha256(JSON.stringify({ count: rows.length, rows: rows.map((row) => row.rowFingerprint) }));
        const row = rows.find((entry) => entry.rowRid === args.rowRid && entry.rowFingerprint === String(args.rowFingerprint).toUpperCase());
        if (String(args.expectedListFingerprint).toUpperCase() !== listFingerprint || !row) {
          return { ok: false, kind: "stale", error: "Belegbindung ist veraltet." };
        }
        const sourceRow = receiptRows.find((entry) => entry.rowRid === row.rowRid);
        const fields = [
          { automationId: ".lineEdit_detailsTitle", name: "", type: "Edit", value: sourceRow.title },
          { automationId: ".dateEdit_datum.AAVDateLineEdit", name: "", type: "Edit", value: sourceRow.date },
          { automationId: ".lineEdit_belegNummer", name: "", type: "Edit", value: sourceRow.documentNumber },
          { automationId: ".lineEdit_betrag", name: "", type: "Edit", value: sourceRow.amount },
          { automationId: ".comboBox_umsatzsteuer.QLineEdit", name: "", type: "Edit", value: sourceRow.vatRate },
          { automationId: ".checkBox_netto", name: "", type: "CheckBox", value: sourceRow.net },
          { automationId: ".textEdit_notiz", name: "", type: "Edit", value: sourceRow.note },
        ];
        return {
          ok: true, pid, hwnd: 5252, mainHwnd: 4242, managerHwnd: 5252, row, fields,
          values: {
            title: sourceRow.title, date: sourceRow.date, documentNumber: sourceRow.documentNumber,
            amount: sourceRow.amount, vatRate: sourceRow.vatRate, net: sourceRow.net, note: sourceRow.note,
          },
          valuesComplete: true, listFingerprint, listFingerprintBefore: listFingerprint,
          detailFingerprint: sha256(JSON.stringify(fields)), semanticListUnchanged: true,
          windowSetUnchanged: true, ungespeichertVorher: caseState.value.dirty,
          ungespeichertNachher: caseState.value.dirty, dirtyStateUnchanged: true,
          physicalInputUsed: true, foregroundLeaseUsed: true, verified: true,
        };
      }
      case "receipt_manager_import": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (!receiptManagerOpen || receiptManagerState !== "list") {
          return { ok: false, kind: "precondition-failed", error: "Belegliste ist nicht offen." };
        }
        const beforeRows = receiptRows.map((row, index) => sha256(`${index + 1}:${row.rowRid}:${row.title}`));
        const beforeFingerprint = sha256(JSON.stringify({ count: receiptRows.length, rows: beforeRows }));
        if (args.acknowledgeImport !== true) return { ok: false, kind: "acknowledgement-required", error: "Bestaetigung fehlt." };
        if (Number(args.expectedCountBefore) !== receiptRows.length || String(args.expectedListFingerprint).toUpperCase() !== beforeFingerprint) {
          return { ok: false, kind: "stale", error: "Belegliste ist veraltet." };
        }
        if (receiptRows.some((row) => row.draft)) return { ok: false, kind: "draft-exists", error: "Entwurf vorhanden." };
        const row = {
          rowRid: `42.5252.4.${nextReceiptId++}`, title: "Neuer Beleg*", draft: true,
          date: "", documentNumber: "", amount: "0,00", vatRate: "19", net: false, note: "",
        };
        receiptRows.push(row);
        const afterRows = receiptRows.map((entry, index) => sha256(`${index + 1}:${entry.rowRid}:${entry.title}`));
        const afterFingerprint = sha256(JSON.stringify({ count: receiptRows.length, rows: afterRows }));
        const fields = [
          { automationId: ".lineEdit_detailsTitle", name: "", type: "Edit", value: row.title },
          { automationId: ".dateEdit_datum.AAVDateLineEdit", name: "", type: "Edit", value: row.date },
          { automationId: ".lineEdit_belegNummer", name: "", type: "Edit", value: row.documentNumber },
          { automationId: ".lineEdit_betrag", name: "", type: "Edit", value: row.amount },
          { automationId: ".comboBox_umsatzsteuer.QLineEdit", name: "", type: "Edit", value: row.vatRate },
          { automationId: ".checkBox_netto", name: "", type: "CheckBox", value: row.net },
          { automationId: ".textEdit_notiz", name: "", type: "Edit", value: row.note },
        ];
        return {
          ok: true, pid, hwnd: 5252, mainHwnd: 4242, managerHwnd: 5252,
          selected: args.expectedPath, sha256: String(args.expectedHash).toUpperCase(),
          countBefore: receiptRows.length - 1, countAfter: receiptRows.length,
          listFingerprintBefore: beforeFingerprint, listFingerprintAfter: afterFingerprint,
          importedRow: { index: receiptRows.length, rowRid: row.rowRid, rowFingerprint: afterRows.at(-1), draft: true },
          detailFingerprint: sha256(JSON.stringify(fields)), fields,
          previewFingerprintBefore: sha256("blank-preview"), previewFingerprintAfter: sha256("attached-preview"),
          previewChanged: true, sourceHashStable: true, existingRowsUnchanged: true, dialogClosed: true,
          windowSetUnchanged: true, cleanupRequired: false, ungespeichertVorher: caseState.value.dirty,
          ungespeichertNachher: caseState.value.dirty, dirtyStateUnchanged: true,
          physicalInputUsed: true, foregroundLeaseUsed: true, verified: true,
        };
      }
      case "receipt_manager_update": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (!receiptManagerOpen || receiptManagerState !== "list") {
          return { ok: false, kind: "precondition-failed", error: "Belegliste ist nicht offen." };
        }
        const projectRows = () => receiptRows.map((entry, index) => ({
          index: index + 1,
          rowRid: entry.rowRid,
          rowFingerprint: sha256(`${index + 1}:${entry.rowRid}:${entry.title}`),
          contentFingerprint: sha256(entry.title),
          draft: entry.draft,
        }));
        const projectFields = (entry) => [
          { automationId: ".lineEdit_detailsTitle", name: "", type: "Edit", value: entry.title },
          { automationId: ".dateEdit_datum.AAVDateLineEdit", name: "", type: "Edit", value: entry.date },
          { automationId: ".lineEdit_belegNummer", name: "", type: "Edit", value: entry.documentNumber },
          { automationId: ".lineEdit_betrag", name: "", type: "Edit", value: entry.amount },
          { automationId: ".comboBox_umsatzsteuer.QLineEdit", name: "", type: "Edit", value: entry.vatRate },
          { automationId: ".checkBox_netto", name: "", type: "CheckBox", value: entry.net },
          { automationId: ".textEdit_notiz", name: "", type: "Edit", value: entry.note },
        ];
        const rowsBefore = projectRows();
        const listFingerprintBefore = sha256(JSON.stringify({ count: rowsBefore.length, rows: rowsBefore.map((entry) => entry.rowFingerprint) }));
        const index = rowsBefore.findIndex((entry) => entry.rowRid === args.rowRid && entry.rowFingerprint === String(args.rowFingerprint).toUpperCase());
        if (args.acknowledgeUpdate !== true) return { ok: false, kind: "acknowledgement-required", error: "Bestaetigung fehlt." };
        if (String(args.expectedListFingerprint).toUpperCase() !== listFingerprintBefore || index < 0) {
          return { ok: false, kind: "stale", error: "Belegbindung ist veraltet." };
        }
        const target = receiptRows[index];
        const fieldsBefore = projectFields(target);
        const detailFingerprintBefore = sha256(JSON.stringify(fieldsBefore));
        if (String(args.expectedDetailFingerprint).toUpperCase() !== detailFingerprintBefore) {
          return { ok: false, kind: "stale", error: "Detailbindung ist veraltet." };
        }
        const valuesBefore = {};
        const requestedValues = {};
        const changedFields = [];
        for (const [name, raw] of Object.entries(args.values ?? {})) {
          valuesBefore[name] = target[name];
          const requested = name === "amount" ? String(raw).replace(".", ",") : raw;
          requestedValues[name] = requested;
          if (target[name] !== requested) changedFields.push(name);
          target[name] = requested;
        }
        if (Object.prototype.hasOwnProperty.call(args.values ?? {}, "title")) target.draft = false;
        const rowsAfter = projectRows();
        const listFingerprintAfter = sha256(JSON.stringify({ count: rowsAfter.length, rows: rowsAfter.map((entry) => entry.rowFingerprint) }));
        const fieldsAfter = projectFields(target);
        return {
          ok: true, pid, hwnd: 5252, mainHwnd: 4242, managerHwnd: 5252,
          rowBefore: rowsBefore[index], rowAfter: rowsAfter[index],
          valuesBefore, valuesAfter: requestedValues, requestedValues, changedFields,
          draftBefore: rowsBefore[index].draft, draftAfter: rowsAfter[index].draft,
          listFingerprintBefore, listFingerprintAfter,
          detailFingerprintBefore, detailFingerprintAfter: sha256(JSON.stringify(fieldsAfter)),
          countUnchanged: true, otherRowsUnchanged: true, windowSetUnchanged: true,
          ungespeichertVorher: caseState.value.dirty, ungespeichertNachher: caseState.value.dirty,
          dirtyStateUnchanged: true, rollback: { attempted: false, ok: true },
          physicalInputUsed: true, foregroundLeaseUsed: true, verified: true,
        };
      }
      case "receipt_manager_delete": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (!receiptManagerOpen || receiptManagerState !== "list") {
          return { ok: false, kind: "precondition-failed", error: "Belegliste ist nicht offen." };
        }
        const rows = receiptRows.map((row, index) => ({
          index: index + 1, rowRid: row.rowRid,
          rowFingerprint: sha256(`${index + 1}:${row.rowRid}:${row.title}`),
          contentFingerprint: sha256(row.title), draft: row.draft,
        }));
        const beforeFingerprint = sha256(JSON.stringify({ count: rows.length, rows: rows.map((row) => row.rowFingerprint) }));
        if (args.acknowledgeDelete !== true) return { ok: false, kind: "acknowledgement-required", error: "Bestaetigung fehlt." };
        const index = rows.findIndex((row) => row.rowRid === args.rowRid && row.rowFingerprint === String(args.rowFingerprint).toUpperCase());
        if (Number(args.expectedCountBefore) !== rows.length || String(args.expectedListFingerprint).toUpperCase() !== beforeFingerprint || index < 0) {
          return { ok: false, kind: "stale", error: "Belegbindung ist veraltet." };
        }
        const [deletedRow] = rows.splice(index, 1);
        receiptRows.splice(index, 1);
        const afterRows = receiptRows.map((row, rowIndex) => sha256(`${rowIndex + 1}:${row.rowRid}:${row.title}`));
        return {
          ok: true, pid, hwnd: 5252, deletedRow, countBefore: rows.length + 1, countAfter: rows.length,
          listFingerprintBefore: beforeFingerprint,
          listFingerprintAfter: sha256(JSON.stringify({ count: rows.length, rows: afterRows })),
          confirmationFingerprint: sha256("delete-confirmation"), confirmationMethod: "invoke",
          dialogClosed: true, remainingRowsUnchanged: true, windowSetUnchanged: true,
          ungespeichertVorher: caseState.value.dirty, ungespeichertNachher: caseState.value.dirty,
          dirtyStateUnchanged: true, physicalInputUsed: true, foregroundLeaseUsed: true, verified: true,
        };
      }
      case "dismiss":
        openMenu = null;
        fileDialog = null;
        return { ok: true, geschlossen: 1, systemOverlaysIgnoriert: 0, stehenGelassen: [], verbleibend: 0, note: null };

      // ------------------------------------------------------------- Fenster
      case "window_close": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const title = caseTitle(caseState.value, openPath);
        if (args.expectedTitle !== undefined && args.expectedTitle !== title) {
          return { ok: false, kind: "stale", error: "Fenstertitel stimmt nicht mehr." };
        }
        if (args.titleFingerprint !== undefined && String(args.titleFingerprint).toUpperCase() !== sha256(title)) {
          return { ok: false, kind: "stale", error: "Fenstertitel-Fingerprint stimmt nicht mehr." };
        }
        minimised = true;
        return {
          ok: true,
          closed: true,
          hwnd: Number(args.hwnd),
          pid,
          titleFingerprint: sha256(title),
          windowId: "main",
          windowRole: "main",
          onlyTargetRemoved: true,
          verified: true,
          newWindows: [],
          missingOrChangedPeers: [],
          newDialogs: [],
        };
      }
      case "window_restore": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const title = caseTitle(caseState.value, openPath);
        if (String(args.titleFingerprint).toUpperCase() !== sha256(title)) {
          return { ok: false, kind: "stale", error: "Fenstertitel-Fingerprint stimmt nicht mehr." };
        }
        const wasMinimised = minimised;
        minimised = false;
        const peerFingerprint = sha256(JSON.stringify([]));
        return {
          ok: true,
          restored: wasMinimised,
          alreadyRestored: !wasMinimised,
          minimizedBefore: wasMinimised,
          minimizedAfter: false,
          targetUnchanged: true,
          peerWindowsUnchanged: true,
          verified: true,
          method: wasMinimised ? "restore" : "already-visible",
          hwnd: Number(args.hwnd),
          pid,
          titleFingerprint: sha256(title),
          peerWindowCount: 0,
          peerWindowCountBefore: 0,
          peerWindowCountAfter: 0,
          peerFingerprintBefore: peerFingerprint,
          peerFingerprintAfter: peerFingerprint,
        };
      }

      // ------------------------------------------------------------ Diagnose
      case "snapshot": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const types = Array.isArray(args.types) ? args.types.map(String) : null;
        const nodes = pageElements(model)
          .filter((node) => !types || types.includes(node.type))
          .filter((node) => args.namedOnly !== true || node.name !== "")
          .slice(0, Number(args.maxNodes ?? 5000));
        return { ok: true, count: nodes.length, nodes, stats: { gesamt: pageElements(model).length } };
      }
      case "snapshot_compare": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const count = pageElements(model).length;
        return {
          ok: true,
          equivalent: true,
          legacy: { count },
          bulk: { count },
          runtimeIdChurnCount: 0,
          missingCount: 0,
          extraCount: 0,
          metadataMismatchCount: 0,
          valueMismatchCount: 0,
          privateValuesReturned: false,
          canaryAfter: { ok: true },
          versuche: Number(args.repetitions ?? 1),
          samples: [],
        };
      }
      case "accessibility_probe": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const node = pageElements(model).find((entry) => matchesSelector(entry, args));
        if (!node) return { ok: false, kind: "not-found", error: "Kein Element passt zum Bezeichner." };
        return {
          ok: true,
          hwnd,
          node: { rid: node.rid, aid: node.aid, name: node.name, type: node.type },
          uia: {
            controlType: node.type,
            isEnabled: node.enabled,
            boundingRectangle: { x: node.x, y: node.y, w: node.w, h: node.h },
            patterns: args.includePatterns === true ? ["LegacyIAccessible"] : [],
          },
          rawDescendants: args.includeRaw === true ? [] : [],
          rawTruncated: false,
          msaaOverlaps: args.includeMsaa === true ? [{ role: node.type }] : [],
          textCandidates: [node.name],
          fazit: "Synthetischer Accessibility-Abgleich.",
        };
      }
      case "screenshot": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const target = resolve(String(args.path));
        mkdirSync(dirname(target), { recursive: true });
        const png = Buffer.from("89504e470d0a1a0a", "hex");
        writeFileSync(target, png);
        return {
          ok: true,
          shot: { path: target, w: 1200, h: 800, bytes: png.length },
          ...(args.includeImage === true ? { imageBase64: png.toString("base64") } : {}),
        };
      }

      // ------------------------------------------------------------- Pruefer
      case "checker_close": {
        const wasOpen = checkerWindowOpen;
        checkerWindowOpen = false;
        return wasOpen
          ? {
              ok: true,
              closed: true,
              alreadyClosed: false,
              verified: true,
              headingBefore: "Steuerpruefer",
              headingAfter: currentPage,
              dirtyBefore: model.openCase()?.dirty ?? null,
              dirtyAfter: model.openCase()?.dirty ?? null,
              closeButtonRemaining: 0,
              note: null,
            }
          : {
              ok: true,
              closed: false,
              alreadyClosed: true,
              verified: true,
              heading: currentPage,
              ungespeichert: model.openCase()?.dirty ?? null,
              note: null,
            };
      }

      // -------------------------------------------------------- Dateiaktionen
      case "save_as": {
        const source = resolve(String(args.expectedSourcePath));
        const target = resolve(String(args.targetPath));
        if (sha256File(source) !== String(args.expectedSourceHash).toUpperCase()) {
          return { ok: false, kind: "precondition-failed", error: "Quellhash stimmt nicht; NICHT gespeichert." };
        }
        if (existsSync(target)) return { ok: false, kind: "precondition-failed", error: "Ziel existiert bereits." };
        copyFileSync(source, target);
        openPath = target;
        cases.delete(target);
        return {
          ok: true,
          savedAs: true,
          sourcePath: source,
          sourceHash: sha256File(source),
          targetPath: target,
          targetHash: sha256File(target),
          attachedPath: target,
          verified: true,
        };
      }
      case "file_dialog_select": {
        if (!fileDialog) return { ok: false, kind: "not-found", error: "Kein Dateidialog offen." };
        if (fileDialog.title !== String(args.expectedDialogTitle)) {
          return { ok: false, kind: "stale", error: "Dialogtitel stimmt nicht mehr." };
        }
        const target = resolve(String(args.expectedPath));
        if (!existsSync(target)) return { ok: false, kind: "not-found", error: "Ausgewaehlte Datei fehlt." };
        if (args.expectedHash !== undefined && sha256File(target) !== String(args.expectedHash).toUpperCase()) {
          return { ok: false, kind: "precondition-failed", error: "Dateihash stimmt nicht mehr." };
        }
        fileDialog = null;
        return { ok: true, selected: target, dialogClosed: true, verified: true };
      }
      case "export_csv": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const directory = resolve(String(args.dir));
        mkdirSync(directory, { recursive: true });
        return {
          ok: true,
          ausgeloest: "Export CSV",
          invokeReportedError: null,
          dialog: { title: "CSV-Export", directory },
          offeneDialoge: 1,
          dateienVorher: readdirSync(directory).length,
          hinweis: "Der Exportdialog ist offen; es wurde noch keine Datei bestaetigt.",
        };
      }
      case "backup_cases": {
        const source = resolve(String(args.dir ?? caseDir));
        const destination = resolve(String(args.dest));
        if (existsSync(destination)) {
          return { ok: false, kind: "precondition-failed", error: "Sicherungsziel existiert bereits." };
        }
        mkdirSync(destination, { recursive: true });
        const names = readdirSync(source).filter((name) => /\.(?:ESt|Gew)2025$/u.test(name));
        for (const name of names) copyFileSync(join(source, name), join(destination, name));
        const files = names.map((name) => ({ name, sha256: sha256File(join(destination, name)) }));
        return {
          ok: true,
          dest: destination,
          anzahl: files.length,
          files,
          hashes: files.map((entry) => ({ file: entry.name, sha256: entry.sha256 })),
          manifest: join(destination, "pruefsummen.csv"),
          verified: true,
        };
      }
      case "archive_cases": {
        const source = resolve(String(args.dir ?? caseDir));
        const destination = resolve(String(args.dest));
        for (const entry of args.cases) {
          const path = join(source, entry.name);
          if (!existsSync(path)) return { ok: false, kind: "not-found", error: `Fall '${entry.name}' fehlt.` };
          if (sha256File(path) !== String(entry.expectedSha256).toUpperCase()) {
            return { ok: false, kind: "precondition-failed", error: `Fall '${entry.name}' hat sich geaendert; nichts verschoben.` };
          }
        }
        for (const entry of args.expectedRemaining) {
          const path = join(source, entry.name);
          if (!existsSync(path) || sha256File(path) !== String(entry.expectedSha256).toUpperCase()) {
            return { ok: false, kind: "precondition-failed", error: `Restbestand '${entry.name}' stimmt nicht; nichts verschoben.` };
          }
        }
        mkdirSync(destination, { recursive: true });
        const files = [];
        for (const entry of args.cases) {
          renameSync(join(source, entry.name), join(destination, entry.name));
          cases.delete(resolve(join(source, entry.name)));
          files.push({ name: entry.name, sha256: entry.expectedSha256.toUpperCase() });
        }
        return {
          ok: true,
          archived: files.length,
          dest: destination,
          files,
          remaining: args.expectedRemaining.map((entry) => ({
            name: entry.name,
            sha256: entry.expectedSha256.toUpperCase(),
          })),
          manifest: join(destination, "pruefsummen.csv"),
          verified: true,
          recoverable: true,
        };
      }
      case "center_cases": {
        const files = readdirSync(caseDir).filter((name) => /\.(?:ESt|Gew)2025$/u.test(name));
        return {
          ok: true,
          hwnd,
          canaryMs: 1,
          modus: "center",
          verzeichnis: caseDir,
          suche: "",
          sortierung: "Name",
          ansicht: "Liste",
          faelle: files.map((name) => ({ name })),
          dateisystemFaelle: files.map((name) => ({ name })),
          nurImCenter: [],
          nurImDateisystem: [],
          konsistent: true,
          snapshot: { count: files.length },
          hinweis: null,
        };
      }
      case "center_refresh": {
        const directory = resolve(String(args.expectedDirectory));
        if (!existsSync(directory)) return { ok: false, kind: "not-found", error: "Fallordner fehlt." };
        const files = readdirSync(directory).sort();
        return {
          ok: true,
          hwnd,
          verzeichnis: directory,
          vorher: files,
          nachher: files,
          entfernt: [],
          hinzugekommen: [],
          sucheUnveraendert: true,
          sortierungUnveraendert: true,
          hinweis: null,
        };
      }

      // ------------------------------------------------------- Eigener Desktop
      case "desktop_start": {
        if (!args.file || !existsSync(args.file)) return { ok: false, kind: "not-found", error: "Falldatei fehlt." };
        desktopName = String(args.name ?? "SSESynthetic");
        openPath = resolve(String(args.file));
        const started = readCase(openPath);
        currentPage = pageSequence(started)[0];
        return {
          ok: true,
          pid,
          desktop: desktopName,
          instance: { pid, hwnd, title: caseTitle(started, openPath) },
          product: { taxYear: started.taxYear },
          case: { taxYear: started.taxYear },
        };
      }
      case "desktop_status":
        return {
          ok: true,
          aktiv: desktopName !== null && openPath !== null,
          desktop: desktopName,
          sseLaeuft: openPath !== null,
          markeVeraltet: false,
        };
      case "desktop_stop": {
        if (!desktopName) return { ok: false, kind: "not-found", error: "Kein eigener Desktop markiert." };
        const caseState = model.openCase();
        if (args.save === true && caseState?.dirty) {
          writeCanonicalCase(caseState.path, caseState);
          caseState.dirty = false;
        }
        desktopName = null;
        openPath = null;
        currentPage = null;
        dialogs = [];
        return { ok: true, hartBeendet: false, desktopMarkeEntfernt: true, discardChanges: args.discardChanges === true };
      }

      // ---------------------------------------------------------------- VaSt
      case "vast_dialog_read": {
        if (!vast) return { ok: false, kind: "not-found", error: "Kein VaSt-Dialog offen." };
        return {
          ok: true,
          hwnd: vastHwnd,
          pid,
          title: "Vorausgefuellte Steuererklaerung",
          dialogFingerprint: sha256("synthetic-vast-dialog"),
          mappingFingerprint: vast.mappingFingerprint,
          certificateCount: vast.rows.length,
          unresolvedCount: vast.rows.filter((row) => row.localTarget === VAST_UNMAPPED).length,
          rows: vast.rows.map((row) => ({
            certificate: row.certificate,
            occurrence: row.occurrence,
            betrag: formatCents(row.amountCents),
            localTarget: row.localTarget,
            expanded: row.expanded,
          })),
          duplicateTargets: [],
          riskyDuplicateTargets: [],
          safeToApply: vast.rows.every((row) => row.localTarget !== VAST_UNMAPPED),
          ocr: { used: false },
          note: null,
        };
      }
      case "vast_row_details": {
        const row = findVastRow(args);
        if (row.error) return row.error;
        return {
          ok: true,
          hwnd: vastHwnd,
          mappingFingerprint: vast.mappingFingerprint,
          expectedMappingFingerprint: vast.mappingFingerprint,
          actualMappingFingerprint: vast.mappingFingerprint,
          certificate: row.value.certificate,
          occurrence: row.value.occurrence,
          initialExpanded: row.value.expanded,
          expandedByTool: false,
          restored: true,
          expectedExpanded: row.value.expanded,
          actualExpanded: row.value.expanded,
          comparisons: [{ label: "Bruttoarbeitslohn", wert: formatCents(row.value.amountCents) }],
          structuredLines: ["Bruttoarbeitslohn"],
          detailLines: [formatCents(row.value.amountCents)],
          ocr: { used: false },
          interactionMethod: "synthetic-tree",
          processingError: null,
          note: null,
        };
      }
      case "vast_row_set_expanded": {
        const row = findVastRow(args);
        if (row.error) return row.error;
        if (row.value.expanded !== args.expectedBefore) {
          return { ok: false, kind: "precondition-failed", error: `Zeile ist ${row.value.expanded ? "offen" : "zu"}.` };
        }
        const before = row.value.expanded;
        row.value.expanded = args.expanded === true;
        return {
          ok: true,
          hwnd: vastHwnd,
          certificate: row.value.certificate,
          occurrence: row.value.occurrence,
          before,
          after: row.value.expanded,
          requested: args.expanded === true,
          clicked: before !== row.value.expanded,
          selectedTargetBefore: row.value.localTarget,
          selectedTargetAfter: row.value.localTarget,
          beforeViewFingerprint: sha256(JSON.stringify({ before })),
          afterViewFingerprint: sha256(JSON.stringify({ after: row.value.expanded })),
          expectedMappingFingerprint: vast.mappingFingerprint,
          actualMappingFingerprint: vast.mappingFingerprint,
          note: null,
        };
      }
      case "vast_mapping_options": {
        const row = findVastRow(args);
        if (row.error) return row.error;
        if (row.value.localTarget !== String(args.expectedCurrent)) {
          return { ok: false, kind: "precondition-failed", error: `Aktuelles Ziel ist '${row.value.localTarget}'.` };
        }
        return {
          ok: true,
          hwnd: vastHwnd,
          mappingFingerprint: vast.mappingFingerprint,
          expectedMappingFingerprint: vast.mappingFingerprint,
          actualMappingFingerprint: vast.mappingFingerprint,
          certificate: row.value.certificate,
          occurrence: row.value.occurrence,
          current: row.value.localTarget,
          uiaOptions: row.value.options,
          newOcrLines: [],
          opened: true,
          popupConfirmed: true,
          closed: true,
          restored: true,
          processingError: null,
          note: null,
        };
      }
      case "vast_mapping_select": {
        const row = findVastRow(args);
        if (row.error) return row.error;
        if (row.value.localTarget !== String(args.expectedCurrent)) {
          return { ok: false, kind: "precondition-failed", error: `Aktuelles Ziel ist '${row.value.localTarget}'.` };
        }
        if (!row.value.options.includes(String(args.value))) {
          return { ok: false, kind: "not-found", error: `Option '${args.value}' fehlt.` };
        }
        const before = row.value.localTarget;
        const fingerprintBefore = vast.mappingFingerprint;
        row.value.localTarget = String(args.value);
        if (row.value.localTarget !== String(args.expectedAfter)) {
          return { ok: false, kind: "postcondition-failed", error: "Zuordnung entspricht nicht der Erwartung." };
        }
        vast.mappingFingerprint = vastMappingFingerprint(vast.rows);
        return {
          ok: true,
          changed: before !== row.value.localTarget,
          hwnd: Number(args.hwnd),
          certificate: row.value.certificate,
          occurrence: row.value.occurrence,
          before,
          after: row.value.localTarget,
          changes: [{ certificate: row.value.certificate, occurrence: row.value.occurrence, before, after: row.value.localTarget }],
          mappingFingerprintBefore: fingerprintBefore,
          mappingFingerprintAfter: vast.mappingFingerprint,
        };
      }
      case "vast_apply": {
        if (!vast) return { ok: false, kind: "not-found", error: "Kein VaSt-Dialog offen." };
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        if (args.acknowledgeApply !== true) {
          return { ok: false, kind: "blocked", error: "Der lokale Merge braucht eine ausdrueckliche Bestaetigung." };
        }
        if (String(args.mappingFingerprint).toUpperCase() !== vast.mappingFingerprint) {
          return { ok: false, kind: "stale", error: "Zuordnungstabelle hat sich geaendert." };
        }
        const bindingError = requireCaseBinding(args, caseState.value);
        if (bindingError) return bindingError;
        if (args.plan.length !== vast.rows.length) {
          return { ok: false, kind: "precondition-failed", error: "Plan deckt nicht alle sichtbaren Zeilen ab." };
        }
        let applied = 0;
        for (const [index, planned] of args.plan.entries()) {
          const row = vast.rows[index];
          if (row.certificate !== planned.certificate || row.occurrence !== planned.occurrence ||
              row.localTarget !== planned.localTarget) {
            return { ok: false, kind: "stale", error: `Planzeile ${index + 1} weicht vom Dialog ab.` };
          }
          if (row.localTarget === VAST_TARGET) {
            caseState.value.values.grossIncome = row.amountCents;
            applied += 1;
          }
        }
        caseState.value.dirty = applied > 0;
        epoch += 1;
        vast = null;
        return {
          ok: true,
          applied: true,
          saved: false,
          dialogClosed: true,
          appliedPlan: args.plan,
          dirtyAfter: caseState.value.dirty,
        };
      }
      default:
        return { ok: false, kind: "fixture", error: `Keine stateful Fixture fuer '${operation}'.` };
    }
  };

  return { worker, model };
}
