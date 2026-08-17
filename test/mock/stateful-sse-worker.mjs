import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

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
    values: { revenue: 10_000_000, expenses: 2_500_000 },
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
  let expandedChecker = [];
  let dialogs = [];
  const pid = 3131;
  const hwnd = 4242;

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
        return { ok: true, source, target, sha256: sha256File(target), verified: true };
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
        return { ok: true, windows: [{ pid, hwnd, title: caseTitle(caseState, openPath), w: 1200, h: 800, minimiert: false }] };
      }
      case "dialog_list":
        return { ok: true, count: dialogs.length, dialogs: clone(dialogs), windows: clone(dialogs) };
      case "known_page_state": {
        const caseState = model.openCase();
        return {
          ok: true,
          pageId: args.pageId,
          heading: currentPage,
          dirty: caseState?.dirty ?? null,
          epoch,
          fields: pageFields(model).map((field) => ({ id: field.aid, label: field.label, value: field.wert })),
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
      case "checker_run":
        checkerActive = true;
        return { ok: true, gestartet: true, bereitsAktiv: false, konsistent: true };
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
        return { ok: true, closed: true, saved: false };
      default:
        return { ok: false, kind: "fixture", error: `Keine stateful Fixture fuer '${operation}'.` };
    }
  };

  return { worker, model };
}
