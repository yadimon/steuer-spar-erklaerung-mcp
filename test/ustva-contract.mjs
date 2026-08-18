import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { executeUstvaOperation } from "../dist/ustva-executor.js";
import { traceOperations } from "./operation-trace.mjs";
import {
  USTVA_FLAGS,
  USTVA_PERIOD_SELECTORS,
  USTVA_SECTIONS,
  USTVA_VALUE_FIELDS,
} from "../dist/ustva.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-ustva-contract-"));
const cases = join(temporary, "cases");
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
mkdirSync(cases, { recursive: true });
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });
writeFileSync(join(cases, "arbeit.Gew2025"), "fixture");

const hash = "a".repeat(64);
const calls = [];
let pageDialogs = [];
let currentHeading = "Umsatzsteuer-Voranmeldungen 2025";
const fields = [
  { label: "Voranmeldezeitraum", typ: "ComboBox", wert: "monatlich", aid: "Combobox" },
  { label: "Auswahl Monat", typ: "ComboBox", wert: "Juli", aid: "Combobox" },
  { label: "Berichtigte Voranmeldung", typ: "CheckBox", wert: false, aid: "Berichtigt" },
  { label: "Belege", typ: "CheckBox", wert: false, aid: "Belege" },
  { label: "Verrechnungswunsch", typ: "CheckBox", wert: false, aid: "Verrech" },
  { label: "Widerruf SEPA-Lastschriftmandat", typ: "CheckBox", wert: false, aid: "Widerruf" },
  { label: "Ergänzende Angaben zur Umsatzsteuer-Voranmeldung", typ: "CheckBox", wert: false, aid: "WeitereAngaben" },
  { label: "Beträge für die Umsatzsteuer-Voranmeldung manuell erfassen", typ: "CheckBox", wert: false, aid: "ManuelleEingabe" },
  { label: "Lieferungen/\u200bLeistungen zu 19%", typ: "Edit", wert: "1.234,00", aid: "Wert" },
  { label: "Lieferungen/\u200bLeistungen zu 19%", typ: "Edit", wert: "234,46", aid: "WertUSt" },
  { label: "Vorsteuer", typ: "Edit", wert: "-12,34", aid: "Wert" },
  { label: "Umsatzsteuerzahllast", typ: "Edit", wert: "222,12", aid: "Wert" },
];
const reverseChargeFields = [
  { label: "Sonst. Leistungen ausländ. Unternehmer EU", typ: "Edit", wert: "181,58", aid: "Wert" },
  { label: "Sonst. Leistungen ausländ. Unternehmer EU", typ: "Edit", wert: "34,50", aid: "Wert2" },
  { label: "Werklieferungen ausländ. Unternehmer", typ: "Edit", wert: "0,00", aid: "Wert" },
  { label: "Werklieferungen ausländ. Unternehmer", typ: "Edit", wert: "0,00", aid: "Wert2" },
  { label: "Sonst. Leistungen ausländ. Unternehmer", typ: "Edit", wert: "180,00", aid: "Wert" },
  { label: "Sonst. Leistungen ausländ. Unternehmer", typ: "Edit", wert: "34,20", aid: "Wert2" },
  { label: "Umsatzsteuer als Leistungsempfänger nach § 13b UStG", typ: "Edit", wert: "361,58", aid: "Wert" },
  { label: "Umsatzsteuer als Leistungsempfänger nach § 13b UStG", typ: "Edit", wert: "68,70", aid: "Wert2" },
];
const inputTaxFields = [
  { label: "Vorsteuer aus Rechnungen von anderen Unternehmern", typ: "Edit", wert: "2,62", aid: "BetragManuell" },
  { label: "Vorsteuer als Steuerschuldner nach § 13b UStG", typ: "Edit", wert: "68,70", aid: "BetragEigen" },
  { label: "Vorsteuer aus innergemeinschaftlichen Erwerben", typ: "Edit", wert: "0,00", aid: "Wert" },
  { label: "Entrichtete Einfuhrumsatzsteuer", typ: "Edit", wert: "0,00", aid: "BetragManuell" },
  { label: "Vorsteuer aus innergemeinschaftl. Dreiecksgeschäften", typ: "Edit", wert: "0,00", aid: "Wert" },
  { label: "Summe der abziehbaren Vorsteuerbeträge", typ: "Edit", wert: "71,32", aid: "Wert" },
];

function fieldsForCurrentPage() {
  if (currentHeading === "Steuerschuldnerschaft nach § 13b UStG") return reverseChargeFields;
  if (currentHeading === "Abziehbare Vorsteuer") return inputTaxFields;
  return fields;
}

function overviewWorkerPage() {
  return {
    ok: true,
    ueberschrift: "Umsatzsteuer-Voranmeldungen 2025",
    felder: fields,
    aktionen: [{ name: "ELSTER", gesperrt: true }],
    dialoge: [],
    prueferMeldungen: [],
    blockiert: false,
  };
}

const execute = traceOperations("ustva-mock", createApiExecutor({
  host: "127.0.0.1",
  port: 1,
  token: "ustva-contract-token-with-at-least-24-characters",
  configPath: join(temporary, "config.json"),
  caseDir: cases,
  workspaceDir,
  resultDir,
}, async (operation, args) => {
  calls.push({ operation, args });
  if (operation === "page") {
    return {
      ok: true,
      ueberschrift: currentHeading,
      felder: fieldsForCurrentPage(),
      aktionen: [{ name: "ELSTER", gesperrt: true }],
      dialoge: pageDialogs,
      prueferMeldungen: [],
      blockiert: false,
    };
  }
  if (operation === "click") {
    const before = currentHeading;
    currentHeading = String(args.expectedPageAfter ?? currentHeading);
    return {
      ok: true,
      clicked: String(args.aid ?? args.name ?? "synthetic-click"),
      pattern: "invoke",
      method: "synthetic-bound-action",
      kandidaten: 1,
      ueberschriftVorher: before,
      ueberschriftNachher: currentHeading,
      navigiert: before !== currentHeading,
      verified: true,
    };
  }
  if (operation === "combo_select") {
    return {
      ok: true,
      before: args.expectedCurrent,
      after: args.expectedAfter,
      expectedAfter: args.expectedAfter,
      page: args.expectedPage,
      selected: args.value,
      method: "synthetic-bound-action",
      verified: true,
    };
  }
  if (operation === "toggle") {
    return {
      ok: true,
      before: args.expectedBefore,
      wanted: args.value,
      after: args.expectedAfter,
      expectedAfter: args.expectedAfter,
      page: args.expectedPage,
      method: "synthetic-bound-action",
      verified: true,
    };
  }
  if (operation === "tracked_set_value") {
    return {
      ok: true,
      verified: true,
      seite: args.expectedPage,
      bindung: String(args.aid ?? args.name ?? "synthetic-field"),
      ungespeichert: true,
      epochVorher: "A".repeat(64),
      epochNachher: "B".repeat(64),
    };
  }
  throw new Error(`Unerwartete UStVA-Mock-Operation '${operation}'.`);
}));

try {
  const read = await execute("ustva_read", { hwnd: 42 }, 5_000);
  assert.equal(read.ok, true);
  assert.equal(read.taxYear, 2025);
  assert.deepEqual(read.period, {
    frequency: "monthly", frequencyDisplay: "monatlich", selector: "month", key: "july", display: "Juli",
  });
  assert.equal(read.amounts.taxable19.base.cents, 123_400);
  assert.equal(read.amounts.taxable19.tax.cents, 23_446);
  assert.equal(read.amounts.inputTax.cents, -1_234);
  assert.equal(read.amounts.settlement.kind, "payment");
  assert.equal(read.transmission.blockedByApi, true);
  assert.equal(read.transmission.uiGuardObserved, true);
  assert.equal(read.transmission.existingSubmissionStatus, "not-read");
  assert.deepEqual(read.effects, { savePerformed: false, submissionPerformed: false });

  currentHeading = "Steuerschuldnerschaft nach § 13b UStG";
  const reverseChargeRead = await execute("ustva_read", { hwnd: 42 }, 5_000);
  assert.equal(reverseChargeRead.pageKind, "reverse_charge");
  assert.equal(reverseChargeRead.amounts.euServices.base.cents, 18_158);
  assert.equal(reverseChargeRead.amounts.foreignServices.tax.cents, 3_420);
  assert.equal(reverseChargeRead.amounts.total.tax.cents, 6_870);

  currentHeading = "Abziehbare Vorsteuer";
  const inputTaxRead = await execute("ustva_read", { hwnd: 42 }, 5_000);
  assert.equal(inputTaxRead.pageKind, "input_tax");
  assert.equal(inputTaxRead.amounts.invoices.cents, 262);
  assert.equal(inputTaxRead.amounts.reverseCharge.cents, 6_870);
  assert.equal(inputTaxRead.amounts.total.cents, 7_132);
  currentHeading = "Umsatzsteuer-Voranmeldungen 2025";

  const heading2025 = fields;
  fields.push();
  const read2026 = await createApiExecutor({
    host: "127.0.0.1", port: 1, token: "ustva-contract-token-with-at-least-24-characters",
    configPath: join(temporary, "config-2026.json"), caseDir: cases, workspaceDir, resultDir,
  }, async (operation, args) => {
    if (operation === "page") return {
      ok: true, ueberschrift: "Umsatzsteuer-Voranmeldungen 2026", felder: heading2025,
      aktionen: [{ name: "ELSTER", gesperrt: true }], dialoge: [], prueferMeldungen: [], blockiert: false,
    };
    return { ok: true, operation, ...args };
  })("ustva_read", { hwnd: 43 }, 5_000);
  assert.equal(read2026.ok, true);
  assert.equal(read2026.taxYear, 2026);
  assert.equal(read2026.page, "Umsatzsteuer-Voranmeldungen 2026");

  const taxable19Base = fields.find((field) => field.label === "Lieferungen/\u200bLeistungen zu 19%" && field.aid === "Wert");
  taxable19Base.wert = "1.234.567,89";
  assert.equal((await execute("ustva_read", { hwnd: 42 }, 5_000)).amounts.taxable19.base.cents, 123_456_789);
  taxable19Base.wert = "1234,5";
  assert.equal((await execute("ustva_read", { hwnd: 42 }, 5_000)).amounts.taxable19.base.cents, 123_450);
  for (const ambiguous of ["1.2", "12.34", "1.234.56", "9".repeat(65)]) {
    taxable19Base.wert = ambiguous;
    assert.equal(
      (await execute("ustva_read", { hwnd: 42 }, 5_000)).amounts.taxable19.base.cents,
      null,
      `Mehrdeutiger UStVA-Betrag '${ambiguous}' darf nicht numerisch interpretiert werden.`,
    );
  }
  taxable19Base.wert = "1.234,00";

  pageDialogs = [{ hwnd: 77, title: "Warnung", fingerprint: "f".repeat(64), buttons: [] }];
  const blockedRead = await execute("ustva_read", { hwnd: 42 }, 5_000);
  assert.equal(blockedRead.ok, false);
  assert.equal(blockedRead.kind, "dialog-open");
  assert.equal(blockedRead.dialogs[0].hwnd, 77);
  pageDialogs = [];

  const select = await execute("ustva_select_period", {
    selector: "month",
    expectedCurrent: "june",
    value: "july",
    hwnd: 42,
    pid: 99,
    expectedCaseRef: "cases:arbeit.Gew2025",
    expectedCaseHash: hash,
  }, 5_000);
  assert.equal(select.ok, true);
  const combo = calls.at(-1);
  assert.equal(combo.operation, "combo_select");
  assert.equal(combo.args.aid, ".AuswahlAnmeldezeitraum.AuswahlMonat.Combobox");
  assert.equal(combo.args.expectedCurrent, "Juni");
  assert.equal(combo.args.value, "Juli");
  assert.equal(combo.args.expectedCasePath, join(cases, "arbeit.Gew2025"));
  assert.deepEqual(select.resourceRefs, { expectedCaseRef: "cases:arbeit.Gew2025" });
  assert.equal(select.ustva.effects.taxDataChanged, true);

  const beforeMixed = calls.length;
  const mixed = await execute("ustva_select_period", {
    selector: "month", expectedCurrent: "q2", value: "july",
    expectedCaseRef: "cases:arbeit.Gew2025", expectedCaseHash: hash,
  }, 5_000);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.kind, "bad-args");
  assert.equal(calls.length, beforeMixed);

  const flag = await execute("ustva_set_flag", {
    flag: "corrected", expectedBefore: false, value: true, expectedAfter: true,
    expectedCaseRef: "cases:arbeit.Gew2025", expectedCaseHash: hash,
  }, 5_000);
  assert.equal(flag.ok, true);
  assert.equal(calls.at(-1).operation, "toggle");
  assert.equal(calls.at(-1).args.aid, ".AngabenZurVoranmeldung.Berichtigt");
  assert.equal(flag.ustva.effects.taxDataChanged, true);

  const manualFlag = await execute("ustva_set_flag", {
    flag: "manual_input", expectedBefore: false, value: false, expectedAfter: false,
    expectedCaseRef: "cases:arbeit.Gew2025", expectedCaseHash: hash,
  }, 5_000);
  assert.equal(manualFlag.ok, true);
  assert.equal(calls.at(-1).args.aid, ".RahmenWerteUebersicht.ManuelleEingabe");
  assert.equal(manualFlag.ustva.effects.taxDataChanged, false);

  const beforeManual = calls.length;
  const refusedManual = await execute("ustva_change_value", {
    field: "taxable_19_base", expectedBefore: "0,00", value: "100,00", expectedAfter: "100,00",
    expectedCaseRef: "cases:arbeit.Gew2025", expectedCaseHash: hash,
  }, 5_000);
  assert.equal(refusedManual.ok, false);
  assert.equal(refusedManual.kind, "bad-args");
  assert.equal(calls.length, beforeManual);

  const blockedManual = await execute("ustva_change_value", {
    field: "taxable_19_base", expectedBefore: "0,00", value: "100,00", expectedAfter: "100,00",
    manualInputConfirmed: true,
    expectedCaseRef: "cases:arbeit.Gew2025", expectedCaseHash: hash,
  }, 5_000);
  assert.equal(blockedManual.ok, false);
  assert.equal(blockedManual.kind, "manual-input-disabled");
  assert.equal(calls.at(-1).operation, "page");

  fields.find((field) => field.aid === "ManuelleEingabe").wert = true;
  const manualChange = await execute("ustva_change_value", {
    field: "taxable_19_base", expectedBefore: "0,00", value: "100,00", expectedAfter: "100,00",
    manualInputConfirmed: true,
    expectedCaseRef: "cases:arbeit.Gew2025", expectedCaseHash: hash,
  }, 5_000);
  assert.equal(manualChange.ok, true);
  assert.equal(calls.at(-1).operation, "tracked_set_value");
  assert.equal(calls.at(-1).args.aid, ".RahmenWerteUebersicht.LieferungNorm.BetragEigen");
  assert.equal(manualChange.ustva.effects.taxDataChanged, true);
  fields.find((field) => field.aid === "ManuelleEingabe").wert = false;

  const adjusted = await execute("ustva_change_value", {
    field: "input_tax_adjustment", expectedBefore: "0,00", value: "1,00", expectedAfter: "1,00",
    expectedCaseRef: "cases:arbeit.Gew2025", expectedCaseHash: hash,
  }, 5_000);
  assert.equal(adjusted.ok, true);
  assert.equal(calls.at(-1).operation, "tracked_set_value");
  assert.equal(calls.at(-1).args.aid, ".RahmenWerteUebersicht.VStBerichtigung.Wert");
  assert.equal(calls.at(-1).args.trackResults, false);
  assert.equal(adjusted.ustva.effects.taxDataChanged, true);

  const section = await execute("ustva_open_section", { section: "tax_exempt", hwnd: 42 }, 5_000);
  assert.equal(section.ok, true);
  assert.equal(calls.at(-1).operation, "click");
  assert.equal(calls.at(-1).args.aid, ".RahmenSteuerfreiUndNichtSteuerbar.Stfr.Button");
  assert.equal(calls.at(-1).args.expectedPageAfter, "Steuerfreie Umsätze");
  currentHeading = "Umsatzsteuer-Voranmeldungen 2025";

  let periodVariants = 0;
  for (const [selector, definition] of Object.entries(USTVA_PERIOD_SELECTORS)) {
    for (const [key, display] of Object.entries(definition.values)) {
      const mapped = await execute("ustva_select_period", {
        selector,
        expectedCurrent: key,
        value: key,
        expectedCaseRef: "cases:arbeit.Gew2025",
        expectedCaseHash: hash,
      }, 5_000);
      assert.equal(mapped.ok, true);
      assert.equal(calls.at(-1).operation, "combo_select");
      assert.equal(calls.at(-1).args.aid, definition.aid);
      assert.equal(calls.at(-1).args.expectedCurrent, display);
      assert.equal(calls.at(-1).args.value, display);
      assert.equal(mapped.ustva.effects.taxDataChanged, false);
      periodVariants += 1;
    }
  }
  assert.equal(periodVariants, 18, "Frequenz, alle 12 Monate und alle 4 Quartale muessen abgedeckt sein");

  for (const [flagName, aid] of Object.entries(USTVA_FLAGS)) {
    const mapped = await execute("ustva_set_flag", {
      flag: flagName,
      expectedBefore: false,
      value: false,
      expectedAfter: false,
      expectedCaseRef: "cases:arbeit.Gew2025",
      expectedCaseHash: hash,
    }, 5_000);
    assert.equal(mapped.ok, true);
    assert.equal(calls.at(-1).operation, "toggle");
    assert.equal(calls.at(-1).args.aid, aid);
    assert.equal(mapped.ustva.effects.taxDataChanged, false);
  }

  fields.find((field) => field.aid === "ManuelleEingabe").wert = true;
  for (const [fieldName, definition] of Object.entries(USTVA_VALUE_FIELDS)) {
    currentHeading = definition.page === "reverse_charge"
      ? "Steuerschuldnerschaft nach § 13b UStG"
      : definition.page === "input_tax"
        ? "Abziehbare Vorsteuer"
        : "Umsatzsteuer-Voranmeldungen 2025";
    const mapped = await execute("ustva_change_value", {
      field: fieldName,
      expectedBefore: "0,00",
      value: "0,00",
      expectedAfter: "0,00",
      ...(definition.manualOnly ? { manualInputConfirmed: true } : {}),
      expectedCaseRef: "cases:arbeit.Gew2025",
      expectedCaseHash: hash,
    }, 5_000);
    assert.equal(mapped.ok, true, fieldName);
    assert.equal(calls.at(-1).operation, "tracked_set_value");
    assert.equal(calls.at(-1).args.aid, definition.aid);
    assert.equal(mapped.ustva.manualOnly, definition.manualOnly);
    assert.equal(mapped.ustva.effects.submissionPerformed, false);
    assert.equal(mapped.ustva.effects.taxDataChanged, false);
  }
  currentHeading = "Umsatzsteuer-Voranmeldungen 2025";
  fields.find((field) => field.aid === "ManuelleEingabe").wert = false;

  for (const [sectionName, definition] of Object.entries(USTVA_SECTIONS)) {
    currentHeading = "Umsatzsteuer-Voranmeldungen 2025";
    const mapped = await execute("ustva_open_section", { section: sectionName, hwnd: 42 }, 5_000);
    assert.equal(mapped.ok, true);
    assert.equal(calls.at(-1).operation, "click");
    assert.equal(calls.at(-1).args.aid, definition.aid);
    assert.equal(calls.at(-1).args.expectedPageAfter, definition.targetPage);
    assert.equal(mapped.ustva.effects.taxDataChanged, false);
  }

  const budgetScenarios = [
    ["ustva_select_period", { selector: "month", expectedCurrent: "june", value: "july" }, "combo_select"],
    ["ustva_set_flag", { flag: "corrected", expectedBefore: false, value: true, expectedAfter: true }, "toggle"],
    ["ustva_change_value", {
      field: "input_tax_adjustment", expectedBefore: "0,00", value: "1,00", expectedAfter: "1,00",
    }, "tracked_set_value"],
    ["ustva_open_section", { section: "tax_exempt" }, "click"],
  ];
  for (const [operation, args, expectedFollowup] of budgetScenarios) {
    let budgetNow = 10_000;
    const budgetCalls = [];
    const budgeted = await executeUstvaOperation(
      operation,
      args,
      10_000,
      undefined,
      async (nestedOperation, _nestedArgs, nestedTimeoutMs) => {
        budgetCalls.push({ operation: nestedOperation, timeoutMs: nestedTimeoutMs });
        if (nestedOperation === "page") {
          budgetNow += 137;
          return overviewWorkerPage();
        }
        return { ok: true, verified: true };
      },
      { now: () => budgetNow },
    );
    assert.equal(budgeted.ok, true, operation);
    assert.deepEqual(budgetCalls, [
      { operation: "page", timeoutMs: 10_000 },
      { operation: expectedFollowup, timeoutMs: 9_863 },
    ], `${operation}: Seitenread und Folgeaktion muessen dieselbe absolute Deadline teilen.`);
  }

  let exhaustedNow = 20_000;
  const exhaustedCalls = [];
  const exhausted = await executeUstvaOperation(
    "ustva_set_flag",
    { flag: "corrected", expectedBefore: false, value: true, expectedAfter: true },
    500,
    undefined,
    async (operation, _args, nestedTimeoutMs) => {
      exhaustedCalls.push({ operation, timeoutMs: nestedTimeoutMs });
      exhaustedNow += 500;
      return overviewWorkerPage();
    },
    { now: () => exhaustedNow },
  );
  assert.deepEqual(exhaustedCalls, [{ operation: "page", timeoutMs: 500 }]);
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.kind, "timeout");

  const alreadyAborted = new AbortController();
  alreadyAborted.abort(new Error("synthetischer UStVA-Abbruch"));
  const abortedCalls = [];
  const aborted = await executeUstvaOperation(
    "ustva_read",
    {},
    5_000,
    alreadyAborted.signal,
    async (operation) => {
      abortedCalls.push(operation);
      return overviewWorkerPage();
    },
  );
  assert.deepEqual(abortedCalls, [], "Vorab-Abbruch darf keinen UStVA-Worker mehr starten.");
  assert.equal(aborted.ok, false);
  assert.equal(aborted.kind, "aborted");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write(
  "UStVA-Vertrag: Reads, 18 Zeitwerte, 6 Flags, 16 Betragsfelder, 5 Bereiche, Fallbindung und gemeinsames Zeitbudget\n",
);
