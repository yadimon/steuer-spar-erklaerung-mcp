import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
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

export function seedSyntheticCases(caseDir) {
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
  return {
    incomePath,
    freelancerPath,
    incomeHash: sha256File(incomePath),
    freelancerHash: sha256File(freelancerPath),
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
  let vast = null;
  let minimised = false;
  let desktopName = null;
  let verticalPercent = 0;
  let treeOffset = 0;
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
    if (args.expectedPage !== currentPage) {
      return { ok: false, kind: "precondition-failed", error: `Aktuelle Seite '${currentPage}', erwartet '${args.expectedPage}'.` };
    }

    const before = String(args.expectedBefore);
    const after = String(args.expectedAfter);
    const name = String(args.name ?? "");
    const aid = String(args.aid ?? "");
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
      epochNachher: epoch,
      ergebnisDiff: resultRows(caseState),
    };
  };

  const requireOpenCase = () => {
    const value = model.openCase();
    return value
      ? { value }
      : { error: { ok: false, kind: "not-found", error: "Kein Steuerfall offen." } };
  };

  const createVastDialog = () => ({
    mappingFingerprint: sha256("synthetic-vast-mapping"),
    rows: [{
      certificate: VAST_CERTIFICATE,
      occurrence: 1,
      expanded: false,
      localTarget: VAST_UNMAPPED,
      options: [VAST_UNMAPPED, VAST_TARGET],
      amountCents: 6_500_000,
    }],
  });

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
  const mutateTable = (args, change) => {
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
      return {
        ok: false,
        kind: "postcondition-failed",
        error: `Nachsumme '${after}', erwartet '${args.expectedAfter}'. Eigene Aenderung zurueckgerollt.`,
        sumBefore: before,
        sumAfter: after,
        rollback: { versucht: true, erfolgreich: true, summe: formatCents(tableSumCents(caseState)) },
      };
    }
    caseState.dirty = true;
    epoch += 1;
    return { ok: true, verified: true, sumBefore: before, sumAfter: after, rowCount: tableRows(caseState).length, ...outcome };
  };

  const worker = async (operation, args = {}) => {
    journal.push({ operation, args: clone(args) });
    switch (operation) {
      case "product_info":
        return { ok: true, taxYear: 2025, engineFileMajor: 31, profileId: "2025" };
      case "health":
        return { ok: true, running: openPath !== null, advice: "synthetic-healthy" };
      case "list_cases": {
        const files = readdirSync(args.dir ?? caseDir).filter((name) => /\.(?:ESt|Gew)2025$/u.test(name));
        return { ok: true, count: files.length, cases: files.map((name) => ({ name })) };
      }
      case "case_hash": {
        const path = resolve(String(args.path));
        if (!existsSync(path)) return { ok: false, kind: "not-found", error: "Falldatei fehlt." };
        const caseState = readCase(path);
        return {
          ok: true,
          path,
          exists: true,
          size: statSync(path).size,
          sha256: sha256File(path),
          header: { FileType: caseState.kind === "income_tax" ? "ESt" : "Gew", VJahr: caseState.taxYear },
          transmitted: false,
        };
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
        openPath = resolve(String(args.file));
        const caseState = readCase(openPath);
        currentPage = caseState.kind === "income_tax" ? "Arbeitnehmer" : "Einnahmen/Ausgaben";
        return { ok: true, pid, path: openPath, sha256: sha256File(openPath) };
      }
      case "windows": {
        if (!openPath) return { ok: true, windows: [] };
        const caseState = model.openCase();
        return { ok: true, windows: [{ pid, hwnd, title: caseTitle(caseState, openPath), w: 1200, h: 800, minimiert: minimised }] };
      }
      case "dialog_list":
        return { ok: true, count: dialogs.length, dialogs: clone(dialogs), windows: clone(dialogs) };
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
        const target = String(args.expectedPageAfter ?? "");
        if (target) currentPage = target;
        return { ok: true, beforePage: args.expectedPageBefore, afterPage: currentPage };
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
        return { ok: true, clicked: true };
      case "checker_reset":
        expandedChecker = [];
        return { ok: true, fragenWarnungen: checkerMessages(model.openCase()), aufgeklappt: [], konsistent: true };
      case "checker_detail":
        return {
          ok: true,
          meldung: args.name,
          text: "Bitte tragen Sie die fehlende Belegnummer ein.",
          leseweg: "synthetic-structured",
          bildBase64: Buffer.from("synthetic-control-image").toString("base64"),
        };
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
        const target = String(args.ziel);
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
        return { ok: true, erreicht: true, ueberschrift: currentPage, weg, schritte: weg.length - 1 };
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
        return { ok: true, oben: true, schritte: Number(args.steps ?? 1), offset: treeOffset };
      case "tree_scroll":
        treeOffset = Math.max(0, treeOffset + (args.direction === "up" ? -1 : 1) * Number(args.steps ?? 1));
        return { ok: true, richtung: args.direction ?? "down", offset: treeOffset };
      case "scroll": {
        if (args.mode === "percent") verticalPercent = Number(args.vPercent ?? 0);
        const nodes = pageElements(model);
        const treffer = args.mode === "intoview"
          ? nodes.filter((node) => matchesSelector(node, args)).length
          : 0;
        return { ok: true, mode: args.mode ?? "intoview", vPercent: verticalPercent, treffer };
      }
      case "scroll_page": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const scrollbar = pageElements(model).length > 8;
        if (args.mode === "percent") verticalPercent = Number(args.vPercent ?? 0);
        if (args.mode === "amount") {
          verticalPercent = Math.min(100, Math.max(0, verticalPercent + (args.direction === "up" ? -25 : 25)));
        }
        return { ok: true, scrollbar, vPercent: verticalPercent, mode: args.mode ?? "info" };
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
        const treffer = pageElements(model).filter((node) => matchesSelector(node, args));
        return {
          ok: true,
          count: treffer.length,
          incomplete: false,
          treffer: treffer.map(({ rid, aid, name, type, value }) => ({ rid, aid, name, type, value })),
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
        return { ok: true, name: node.name, wert: node.value, typ: node.type, aid: node.aid, rid: node.rid };
      }
      case "positions": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const nodes = pageElements(model);
        return {
          ok: true,
          aktion: "list",
          anzahl: nodes.length,
          positionen: nodes.map((node) => ({ name: node.name, typ: node.type, x: node.x, y: node.y, w: node.w, h: node.h })),
        };
      }
      case "help": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        return {
          ok: true,
          abschnitte: {
            [`Hilfe zu ${currentPage}`]: {
              zeilen: [`Synthetische Hilfe zur Seite ${currentPage}.`, "Alle Betraege sind erfunden."],
            },
          },
        };
      }
      case "check": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const leer = pageElements(model).filter((node) => node.type === "Edit" && node.value === "");
        return {
          ok: true,
          konsistent: leer.length === 0,
          ueberschrift: currentPage,
          leerePflichtfelder: leer.map((node) => node.name),
          befunde: [],
        };
      }
      case "page_objects": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        return {
          ok: true,
          pageId: args.pageId ?? null,
          anzahl: pageElements(model).length,
          objekte: pageElements(model).map(({ aid, name, type }) => ({ aid, name, type })),
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
        return mutateTable(args, (rows) => {
          const [, datum, text, betrag] = args.werte.map((value) => String(value ?? ""));
          const cents = parseGermanCents(betrag);
          if (cents === null) return { error: { ok: false, kind: "bad-args", error: `Betrag '${betrag}' ist kein deutscher Geldwert.` } };
          rows.push({ datum, text, betrag: cents });
          return { added: { datum, text, betrag: cents } };
        });
      case "table_update":
        return mutateTable(args, (rows) => {
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
        return mutateTable(args, (rows) => {
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
        const optionen = node.name === "Auswahl Monat" ? MONTHS : ["monatlich", "vierteljährlich", "jährlich"];
        return { ok: true, name: node.name, aktuell: node.value, anzahl: optionen.length, optionen };
      }
      case "set_value": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const node = pageElements(model).find((entry) => entry.rid === String(args.rid));
        if (!node) return { ok: false, kind: "not-found", error: `Element '${args.rid}' fehlt.` };
        if (node.value !== String(args.expectedBefore)) {
          return { ok: false, kind: "precondition-failed", error: `Vorwert '${node.value}', erwartet '${args.expectedBefore}'.` };
        }
        return applyTrackedValue({
          expectedPage: currentPage,
          name: node.name,
          expectedBefore: args.expectedBefore,
          value: args.value,
          expectedAfter: args.expectedAfter,
        });
      }
      case "menu": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        return {
          ok: true,
          geoeffnet: openMenu,
          menues: MENUS.map(({ name, eintraege }) => ({
            name,
            eintraege: eintraege.map((entry) => ({ name: entry.name, gesperrt: entry.blocked === true })),
          })),
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
        return { ok: true, clicked: name, menu: entry.menu, oeffnet: entry.opens ?? null };
      }
      case "menu_close":
        openMenu = null;
        return { ok: true, closed: true };
      case "dismiss":
        openMenu = null;
        fileDialog = null;
        return { ok: true, dismissed: true };

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
        return { ok: true, closed: true, hwnd: args.hwnd };
      }
      case "window_restore": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const title = caseTitle(caseState.value, openPath);
        if (String(args.titleFingerprint).toUpperCase() !== sha256(title)) {
          return { ok: false, kind: "stale", error: "Fenstertitel-Fingerprint stimmt nicht mehr." };
        }
        minimised = false;
        return { ok: true, restored: true, minimiert: minimised, hwnd: args.hwnd };
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
          node: { rid: node.rid, aid: node.aid, name: node.name, type: node.type },
          uia: {
            controlType: node.type,
            isEnabled: node.enabled,
            boundingRectangle: { x: node.x, y: node.y, w: node.w, h: node.h },
            patterns: args.includePatterns === true ? ["LegacyIAccessible"] : [],
          },
          rawDescendants: args.includeRaw === true ? [] : [],
          rawTruncated: false,
          msaa: args.includeMsaa === true ? { role: node.type } : null,
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
        return { ok: true, closed: true, warOffen: wasOpen };
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
        return { ok: true, saved: true, source, target, sha256: sha256File(target), verified: true };
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
        return { ok: true, selected: target, closed: true };
      }
      case "export_csv": {
        const caseState = requireOpenCase();
        if (caseState.error) return caseState.error;
        const directory = resolve(String(args.dir));
        mkdirSync(directory, { recursive: true });
        const rows = resultRows(caseState.value);
        const file = join(directory, "ergebnis.csv");
        writeFileSync(
          file,
          `Beobachteter Wert;Aktuell\n${rows.map((row) => `${row.beobachteterWert};${row.aktuell}`).join("\n")}\n`,
          "utf8",
        );
        return { ok: true, dir: directory, anzahl: 1, dateien: [{ name: basename(file), path: file, sha256: sha256File(file) }] };
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
        return { ok: true, anzahl: files.length, faelle: files.map((name) => ({ name })) };
      }
      case "center_refresh": {
        const directory = resolve(String(args.expectedDirectory));
        if (!existsSync(directory)) return { ok: false, kind: "not-found", error: "Fallordner fehlt." };
        return { ok: true, aktualisiert: true, directory, anzahl: readdirSync(directory).length };
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
          active: true,
          hwnd: vastHwnd,
          expectedMainHwnd: hwnd,
          mappingFingerprint: vast.mappingFingerprint,
          anzahl: vast.rows.length,
          zeilen: vast.rows.map((row) => ({
            certificate: row.certificate,
            occurrence: row.occurrence,
            betrag: formatCents(row.amountCents),
            localTarget: row.localTarget,
            expanded: row.expanded,
          })),
        };
      }
      case "vast_row_details": {
        const row = findVastRow(args);
        if (row.error) return row.error;
        return {
          ok: true,
          certificate: row.value.certificate,
          occurrence: row.value.occurrence,
          betrag: formatCents(row.value.amountCents),
          expanded: row.value.expanded,
          details: [{ label: "Bruttoarbeitslohn", wert: formatCents(row.value.amountCents) }],
        };
      }
      case "vast_row_set_expanded": {
        const row = findVastRow(args);
        if (row.error) return row.error;
        if (row.value.expanded !== args.expectedBefore) {
          return { ok: false, kind: "precondition-failed", error: `Zeile ist ${row.value.expanded ? "offen" : "zu"}.` };
        }
        row.value.expanded = args.expanded === true;
        return { ok: true, before: args.expectedBefore, after: row.value.expanded };
      }
      case "vast_mapping_options": {
        const row = findVastRow(args);
        if (row.error) return row.error;
        if (row.value.localTarget !== String(args.expectedCurrent)) {
          return { ok: false, kind: "precondition-failed", error: `Aktuelles Ziel ist '${row.value.localTarget}'.` };
        }
        return { ok: true, aktuell: row.value.localTarget, anzahl: row.value.options.length, optionen: row.value.options };
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
        row.value.localTarget = String(args.value);
        if (row.value.localTarget !== String(args.expectedAfter)) {
          return { ok: false, kind: "postcondition-failed", error: "Zuordnung entspricht nicht der Erwartung." };
        }
        return { ok: true, before: args.expectedCurrent, selected: args.value, after: row.value.localTarget };
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
        return { ok: true, applied, verified: true, ungespeichert: caseState.value.dirty, geschlossen: true };
      }
      default:
        return { ok: false, kind: "fixture", error: `Keine stateful Fixture fuer '${operation}'.` };
    }
  };

  return { worker, model };
}
