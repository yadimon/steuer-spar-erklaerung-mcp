/**
 * Schnelle fachliche API-Journeys mit einem zustandsbehafteten synthetischen
 * SSE-Worker. HTTP, API-Executor, Ressourcenbindung, Komposition, Workspace,
 * Szenario und (einmalig) MCP bleiben Produktionscode. Die Tests beweisen
 * nicht die proprietaere SSE-UIA-Schicht und verwenden weder LLM noch echte
 * Steuerfaelle.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { traceOperations } from "./operation-trace.mjs";
import { createSyntheticAkadCase } from "./synthetic-akad-fixture.mjs";
import {
  CHECKER_MESSAGE,
  MONTHS,
  TABLE_PAGE,
  TABLE_SUM_LABEL,
  VAST_TARGET,
  VAST_UNMAPPED,
  WARNING_TEXT,
  createStatefulSseWorker,
  seedSyntheticCases,
  sha256File,
} from "./mock/stateful-sse-worker.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

async function createHarness({ includeNextYearUstva = false } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "sse-tax-journeys-"));
  const caseDir = join(temporary, "cases");
  const workspaceDir = join(temporary, "workspace");
  const resultDir = join(temporary, "results");
  const backupsDir = join(temporary, "backups");
  const documentsDir = join(temporary, "documents");
  for (const path of [caseDir, workspaceDir, resultDir, backupsDir, documentsDir]) {
    mkdirSync(path, { recursive: true });
  }
  const seeded = seedSyntheticCases(caseDir, { includeNextYearUstva });
  const { worker, model } = createStatefulSseWorker({ caseDir });
  const config = {
    host: "127.0.0.1",
    port: 1,
    configPath: join(temporary, "config.json"),
    caseDir,
    workspaceDir,
    resultDir,
    documentsDir,
    backupsDir,
    documentsDir,
    sseExecutable: "C:\\Synthetic\\SSE.exe",
  };
  const execute = traceOperations("stateful-mock", createApiExecutor(
    config,
    worker,
    { archiveHasRunningSseProcess: async () => false },
  ));
  const server = createSseApiServer({ execute });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = { "content-type": "application/json" };

  const request = async (operation, args = {}, timeoutMs = 5_000) => {
    const response = await fetch(`${baseUrl}/v1/operations/${operation}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ args, timeoutMs }),
    });
    return { status: response.status, body: await response.json() };
  };
  const call = async (operation, args = {}, timeoutMs = 5_000) => {
    const response = await request(operation, args, timeoutMs);
    assert.equal(response.status, 200, `${operation}: ${JSON.stringify(response.body)}`);
    return response.body.result;
  };
  const close = async () => {
    await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    rmSync(temporary, { recursive: true, force: true });
  };
  return {
    temporary,
    caseDir,
    workspaceDir,
    resultDir,
    documentsDir,
    baseUrl,
    headers,
    seeded,
    model,
    request,
    call,
    close,
  };
}

async function withHarness(action, options = {}) {
  const harness = await createHarness(options);
  try {
    await action(harness);
  } finally {
    await harness.close();
  }
}

async function launchIncome(harness) {
  return harness.call("launch", { caseRef: "cases:synthetic.ESt2025", mode: "normal" }, 30_000);
}

async function launchFreelancer(harness) {
  return harness.call("launch", { caseRef: "cases:synthetic.Gew2025", mode: "einur" }, 30_000);
}

async function openUstva(harness) {
  await launchFreelancer(harness);
  return harness.call("click", {
    name: "UStVA",
    expectedPageBefore: "Einnahmen/Ausgaben",
    expectedPageAfter: "Umsatzsteuer-Voranmeldungen 2025",
  });
}

function rowByName(report, name) {
  return report.zeilen.find((row) => row.beobachteterWert === name);
}

test("01 discovery exposes the complete safe API without starting the worker", async () => {
  await withHarness(async (harness) => {
    const before = harness.model.journal.length;
    const listed = await fetch(`${harness.baseUrl}/v1/operations`, { headers: harness.headers });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).operations, SSE_API_OPERATIONS);
    const capabilities = await harness.call("capabilities");
    const workspace = await harness.call("workspace_status");
    assert.equal(capabilities.safety.elsterAndSubmissionBlocked, true);
    assert(!SSE_API_OPERATIONS.includes("keys"));
    assert.equal(workspace.ok, true);
    assert.equal(harness.model.journal.length, before, "API-interne Lesungen duerfen keinen UI-Worker starten");
  });
});

test("02 income-tax report returns stable semantic calculation rows", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const report = await harness.call("result_details", { hwnd: 4242 });
    assert.equal(report.vollstaendig, true);
    assert.equal(rowByName(report, "Zu versteuerndes Einkommen").aktuell, "47.000,00");
    assert.equal(rowByName(report, "Einkommensteuer").aktuell, "9.400,00");
    assert.equal(rowByName(report, "Solidaritätszuschlag").aktuell, "517,00");
    assert.equal(rowByName(report, "Nachzahlung").aktuell, "917,00");
    assert.match(rowByName(report, "Durchschnittssteuersatz").aktuell, /%$/u);
  });
});

test("03 income-tax field mutation changes calculation but not the unsaved file", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.ESt2025" })).sha256;
    const before = await harness.call("known_page_state", { pageId: "est.arbeitnehmer", hwnd: 4242 });
    assert.match(before.epoch, /^[A-F0-9]{64}$/u, "known_page_state liefert einen Inhaltsfingerprint, keinen Zaehler");
    const changed = await harness.call("tracked_set_value", {
      expectedPage: "Arbeitnehmer",
      name: "Werbungskosten",
      expectedBefore: "1.000,00",
      value: "2.000,00",
      expectedAfter: "2.000,00",
      expectedCaseRef: "cases:synthetic.ESt2025",
      expectedCaseHash: hash,
    });
    assert.equal(changed.verified, true);
    assert.equal(sha256File(harness.seeded.incomePath), hash, "ungespeicherte UI-Aenderung darf keine Datei schreiben");
    const state = await harness.call("known_page_state", { pageId: "est.arbeitnehmer", hwnd: 4242 });
    assert.equal(state.dirty, true);
    assert.notEqual(state.epoch, before.epoch, "Der Seitenfingerprint muss sich nach der Aenderung bewegen");
    assert.equal(state.fields.find((field) => field.label === "Werbungskosten").value, "2.000,00");
    const report = await harness.call("result_details", { hwnd: 4242 });
    assert.equal(rowByName(report, "Zu versteuerndes Einkommen").aktuell, "46.000,00");
    assert.equal(rowByName(report, "Nachzahlung").aktuell, "706,00");
  });
});

test("04 hash-bound save persists calculation state and repeat is a no-op", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const before = (await harness.call("case_hash", { ref: "cases:synthetic.ESt2025" })).sha256;
    await harness.call("tracked_set_value", {
      expectedPage: "Arbeitnehmer",
      name: "Werbungskosten",
      expectedBefore: "1.000,00",
      value: "2.000,00",
      expectedAfter: "2.000,00",
      expectedCaseRef: "cases:synthetic.ESt2025",
      expectedCaseHash: before,
    });
    const saved = await harness.call("save", {
      caseRef: "cases:synthetic.ESt2025",
      expectedHashBefore: before,
      hwnd: 4242,
    });
    assert.equal(saved.saved, true);
    assert.notEqual(saved.hashAfter, before);
    assert.equal(sha256File(harness.seeded.incomePath), saved.hashAfter);
    assert.equal(saved.path, "cases:synthetic.ESt2025");
    const state = await harness.call("known_page_state", { pageId: "est.arbeitnehmer", hwnd: 4242 });
    assert.equal(state.dirty, false);
    const repeated = await harness.call("save", {
      caseRef: "cases:synthetic.ESt2025",
      expectedHashBefore: saved.hashAfter,
      hwnd: 4242,
    });
    assert.equal(repeated.saved, false);
    assert.equal(repeated.noChanges, true);
    assert.equal(repeated.hashBefore, repeated.hashAfter);
  });
});

test("05 stale case hash blocks both write and save before mutation", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const originalHash = (await harness.call("case_hash", { ref: "cases:synthetic.ESt2025" })).sha256;
    appendFileSync(harness.seeded.incomePath, " ", "utf8");
    const externallyChangedHash = sha256File(harness.seeded.incomePath);
    const write = await harness.call("tracked_set_value", {
      expectedPage: "Arbeitnehmer",
      name: "Werbungskosten",
      expectedBefore: "1.000,00",
      value: "2.000,00",
      expectedAfter: "2.000,00",
      expectedCaseRef: "cases:synthetic.ESt2025",
      expectedCaseHash: originalHash,
    });
    assert.equal(write.ok, false);
    assert.equal(write.kind, "case-mismatch");
    const save = await harness.call("save", {
      caseRef: "cases:synthetic.ESt2025",
      expectedHashBefore: originalHash,
      hwnd: 4242,
    });
    assert.equal(save.ok, false);
    assert.equal(save.kind, "precondition-failed");
    assert.equal(sha256File(harness.seeded.incomePath), externallyChangedHash);
  });
});

test("06 wrong-page precondition fails without changing the result", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const before = await harness.call("result_details", { hwnd: 4242 });
    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.ESt2025" })).sha256;
    await harness.call("click", { name: "Vorsorge", expectedPageAfter: "Vorsorgeaufwendungen" });
    const rejected = await harness.call("tracked_set_value", {
      expectedPage: "Arbeitnehmer",
      name: "Werbungskosten",
      expectedBefore: "1.000,00",
      value: "2.000,00",
      expectedAfter: "2.000,00",
      expectedCaseRef: "cases:synthetic.ESt2025",
      expectedCaseHash: hash,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.kind, "precondition-failed");
    const after = await harness.call("result_details", { hwnd: 4242 });
    assert.deepEqual(after.zeilen, before.zeilen);
  });
});

test("07 freelancer report computes revenue minus expenses", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    const report = await harness.call("result_details", { hwnd: 4242 });
    assert.equal(rowByName(report, "Betriebseinnahmen").aktuell, "100.000,00");
    assert.equal(rowByName(report, "Betriebsausgaben").aktuell, "25.000,00");
    assert.equal(rowByName(report, "Gewinn/Verlust").aktuell, "75.000,00");
  });
});

test("08 freelancer mutations recompute profit and persist in one save", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.Gew2025" })).sha256;
    for (const change of [
      { name: "Betriebseinnahmen", before: "100.000,00", value: "120.000,00" },
      { name: "Betriebsausgaben", before: "25.000,00", value: "30.000,00" },
    ]) {
      const result = await harness.call("tracked_set_value", {
        expectedPage: "Einnahmen/Ausgaben",
        name: change.name,
        expectedBefore: change.before,
        value: change.value,
        expectedAfter: change.value,
        expectedCaseRef: "cases:synthetic.Gew2025",
        expectedCaseHash: hash,
      });
      assert.equal(result.verified, true);
    }
    const report = await harness.call("result_details", { hwnd: 4242 });
    assert.equal(rowByName(report, "Gewinn/Verlust").aktuell, "90.000,00");
    assert.equal(rowByName(report, "Gewinn/Verlust").differenz, "15.000,00");
    const saved = await harness.call("save", {
      caseRef: "cases:synthetic.Gew2025",
      expectedHashBefore: hash,
      hwnd: 4242,
    });
    assert.equal(saved.saved, true);
    assert.equal(sha256File(harness.seeded.freelancerPath), saved.hashAfter);
  });
});

test("09 UStVA HTTP read normalizes period, cents, settlement and ELSTER guard", async () => {
  await withHarness(async (harness) => {
    await openUstva(harness);
    const report = await harness.call("ustva_read", { hwnd: 4242 });
    assert.equal(report.taxYear, 2025);
    assert.deepEqual(report.period, {
      frequency: "monthly",
      frequencyDisplay: "monatlich",
      selector: "month",
      key: "june",
      display: "Juni",
    });
    assert.equal(report.amounts.taxable19.base.cents, 100_000);
    assert.equal(report.amounts.taxable19.tax.cents, 19_000);
    assert.equal(report.amounts.inputTax.cents, -2_000);
    assert.deepEqual(report.amounts.settlement, { kind: "payment", display: "170,00", cents: 17_000 });
    assert.equal(report.transmission.blockedByApi, true);
    assert.equal(report.transmission.uiGuardObserved, true);
    assert.equal(report.effects.submissionPerformed, false);
  });
});

test("10 UStVA manual amount is rejected without explicit confirmation", async () => {
  await withHarness(async (harness) => {
    await openUstva(harness);
    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.Gew2025" })).sha256;
    const beforeCalls = harness.model.journal.length;
    const rejected = await harness.request("ustva_change_value", {
      field: "taxable_19_base",
      expectedBefore: "1.000,00",
      value: "50,00",
      expectedAfter: "50,00",
      expectedCaseRef: "cases:synthetic.Gew2025",
      expectedCaseHash: hash,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.result.ok, false);
    assert.equal(rejected.body.result.kind, "bad-args");
    assert.equal(harness.model.journal.length, beforeCalls);
  });
});

test("11 UStVA manual flag gates mutation and settlement recomputation", async () => {
  await withHarness(async (harness) => {
    await openUstva(harness);
    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.Gew2025" })).sha256;
    const blocked = await harness.call("ustva_change_value", {
      field: "taxable_19_base",
      expectedBefore: "1.000,00",
      value: "50,00",
      expectedAfter: "50,00",
      manualInputConfirmed: true,
      expectedCaseRef: "cases:synthetic.Gew2025",
      expectedCaseHash: hash,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.kind, "manual-input-disabled");
    await harness.call("ustva_set_flag", {
      flag: "manual_input",
      expectedBefore: false,
      value: true,
      expectedAfter: true,
      expectedCaseRef: "cases:synthetic.Gew2025",
      expectedCaseHash: hash,
    });
    const changed = await harness.call("ustva_change_value", {
      field: "taxable_19_base",
      expectedBefore: "1.000,00",
      value: "50,00",
      expectedAfter: "50,00",
      manualInputConfirmed: true,
      expectedCaseRef: "cases:synthetic.Gew2025",
      expectedCaseHash: hash,
    });
    assert.equal(changed.ok, true);
    const report = await harness.call("ustva_read", { hwnd: 4242 });
    assert.equal(report.amounts.taxable19.base.cents, 5_000);
    assert.equal(report.amounts.taxable19.tax.cents, 950);
    assert.deepEqual(report.amounts.settlement, { kind: "refund", display: "10,50", cents: 1_050 });
  });
});

test("12 UStVA period mutation is visible through an independent read", async () => {
  await withHarness(async (harness) => {
    await openUstva(harness);
    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.Gew2025" })).sha256;
    const selected = await harness.call("ustva_select_period", {
      selector: "month",
      expectedCurrent: "june",
      value: "july",
      expectedCaseRef: "cases:synthetic.Gew2025",
      expectedCaseHash: hash,
    });
    assert.equal(selected.ustva.effects.taxDataChanged, true);
    const report = await harness.call("ustva_read", { hwnd: 4242 });
    assert.equal(report.period.key, "july");
    assert.equal(report.period.display, "Juli");
    const combo = harness.model.journal.findLast((entry) => entry.operation === "combo_select");
    assert.equal(combo.args.aid, ".AuswahlAnmeldezeitraum.AuswahlMonat.Combobox");
  });
});

test("13 Steuerpruefer warning can be opened, fixed and disappears", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const initial = await harness.call("checker_results", { hwnd: 4242 });
    assert.equal(initial.konsistent, true);
    assert.equal(initial.fragenWarnungen[0].text, CHECKER_MESSAGE);
    const detail = await harness.call("checker_open", { name: CHECKER_MESSAGE, hwnd: 4242 }, 10_000);
    assert.equal(detail.kontrollbildEnthalten, true);
    assert.match(detail.text, /Belegnummer/u);
    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.ESt2025" })).sha256;
    await harness.call("tracked_set_value", {
      expectedPage: "Arbeitnehmer",
      name: "Beleg-Nr.",
      expectedBefore: "",
      value: "R-2025-01",
      expectedAfter: "R-2025-01",
      expectedCaseRef: "cases:synthetic.ESt2025",
      expectedCaseHash: hash,
    });
    const after = await harness.call("checker_results", { hwnd: 4242 });
    assert.equal(after.fragenWarnungen.length, 0);
    assert.equal(after.gesamt, 0);
  });
});

test("14 warning popup blocks UStVA until a fingerprint-bound answer", async () => {
  await withHarness(async (harness) => {
    await openUstva(harness);
    harness.model.openWarning();
    const warning = await harness.call("warning_popup_read", { hwnd: 4242, ocr: false });
    assert.equal(warning.active, true);
    assert.equal(warning.text, WARNING_TEXT);
    const blockedRead = await harness.call("ustva_read", { hwnd: 4242 });
    assert.equal(blockedRead.ok, false);
    assert.equal(blockedRead.kind, "dialog-open");
    const refused = await harness.call("dialog_answer", {
      hwnd: warning.hwnd,
      fingerprint: warning.fingerprint,
      button: "Ja",
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.kind, "blocked");
    const answered = await harness.call("dialog_answer", {
      hwnd: warning.hwnd,
      fingerprint: warning.fingerprint,
      bodyFingerprint: warning.bodyFingerprint,
      button: "OK",
    });
    assert.equal(answered.closed, true);
    assert.equal((await harness.call("ustva_read", { hwnd: 4242 })).ok, true);
  });
});

test("15 saved semantic report is read back through the real workspace API", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const taxReport = await harness.call("result_details", { hwnd: 4242 });
    const semantic = {
      taxYear: 2025,
      declaration: "income_tax",
      taxableIncome: rowByName(taxReport, "Zu versteuerndes Einkommen").aktuell,
      incomeTax: rowByName(taxReport, "Einkommensteuer").aktuell,
      settlement: rowByName(taxReport, "Nachzahlung").aktuell,
    };
    const text = `${JSON.stringify(semantic, null, 2)}\n`;
    const written = await harness.call("workspace_file_write_text", {
      ref: "results:semantic-tax-report.json",
      text,
    });
    assert.equal(written.bytes, Buffer.byteLength(text));
    assert.equal(written.ref, "results:semantic-tax-report.json");
    const read = await harness.call("workspace_file_read_text", { ref: "results:semantic-tax-report.json" });
    assert.equal(read.text, text);
    assert.deepEqual(JSON.parse(read.text), semantic);
    assert.equal(read.sha256, written.sha256);
  });
});

test("16 one scenario processes Einkommensteuer, Freiberufler and UStVA and writes a report", async () => {
  await withHarness(async (harness) => {
    const scenario = {
      schemaVersion: 2,
      name: "synthetic full tax journey",
      resultFile: "full-tax-journey.json",
      steps: [
        { id: "est_launch", operation: "launch", timeoutMs: 30_000, args: { caseRef: "cases:synthetic.ESt2025", mode: "normal" }, expect: { ok: true } },
        { id: "est_hash", operation: "case_hash", args: { ref: "cases:synthetic.ESt2025" }, capture: ["sha256"], expect: { ok: true } },
        {
          id: "est_change",
          operation: "tracked_set_value",
          args: {
            expectedPage: "Arbeitnehmer", name: "Werbungskosten", expectedBefore: "1.000,00",
            value: "2.000,00", expectedAfter: "2.000,00", expectedCaseRef: "cases:synthetic.ESt2025",
            expectedCaseHash: "$steps.est_hash.result.sha256",
          },
          capture: ["verified"], expect: { verified: true },
        },
        { id: "est_result", operation: "result_details", args: { hwnd: 4242 }, capture: ["vollstaendig", "anzahl"], expect: { vollstaendig: true, anzahl: 5 } },
        {
          id: "est_save", operation: "save",
          args: { caseRef: "cases:synthetic.ESt2025", expectedHashBefore: "$steps.est_hash.result.sha256", hwnd: 4242 },
          capture: ["saved", "hashAfter"], expect: { saved: true },
        },
        { id: "est_close", operation: "close", args: { hwnd: 4242 }, expect: { closed: true } },
        { id: "gew_launch", operation: "launch", timeoutMs: 30_000, args: { caseRef: "cases:synthetic.Gew2025", mode: "einur" }, expect: { ok: true } },
        { id: "gew_hash", operation: "case_hash", args: { ref: "cases:synthetic.Gew2025" }, capture: ["sha256"], expect: { ok: true } },
        {
          id: "gew_change",
          operation: "tracked_set_value",
          args: {
            expectedPage: "Einnahmen/Ausgaben", name: "Betriebsausgaben", expectedBefore: "25.000,00",
            value: "30.000,00", expectedAfter: "30.000,00", expectedCaseRef: "cases:synthetic.Gew2025",
            expectedCaseHash: "$steps.gew_hash.result.sha256",
          },
          capture: ["verified"], expect: { verified: true },
        },
        { id: "gew_result", operation: "result_details", args: { hwnd: 4242 }, capture: ["vollstaendig", "anzahl"], expect: { vollstaendig: true, anzahl: 3 } },
        {
          id: "open_ustva", operation: "click",
          args: { name: "UStVA", expectedPageBefore: "Einnahmen/Ausgaben", expectedPageAfter: "Umsatzsteuer-Voranmeldungen 2025" },
          expect: { ok: true },
        },
        {
          id: "ustva_manual",
          operation: "ustva_set_flag",
          args: {
            flag: "manual_input", expectedBefore: false, value: true, expectedAfter: true,
            expectedCaseRef: "cases:synthetic.Gew2025", expectedCaseHash: "$steps.gew_hash.result.sha256",
          },
          capture: ["ustva.effects.taxDataChanged"], expect: { "ustva.effects.taxDataChanged": true },
        },
        {
          id: "ustva_change",
          operation: "ustva_change_value",
          args: {
            field: "taxable_19_base", expectedBefore: "1.000,00", value: "50,00", expectedAfter: "50,00",
            manualInputConfirmed: true, expectedCaseRef: "cases:synthetic.Gew2025",
            expectedCaseHash: "$steps.gew_hash.result.sha256",
          },
          capture: ["ustva.effects.taxDataChanged"], expect: { "ustva.effects.taxDataChanged": true },
        },
        { id: "ustva_result", operation: "ustva_read", args: { hwnd: 4242 }, capture: ["taxYear", "amounts.settlement.cents"], expect: { taxYear: 2025, "amounts.settlement.cents": 1050 } },
        {
          id: "gew_save", operation: "save",
          args: { caseRef: "cases:synthetic.Gew2025", expectedHashBefore: "$steps.gew_hash.result.sha256", hwnd: 4242 },
          capture: ["saved", "hashAfter"], expect: { saved: true },
        },
      ],
      finally: [{ id: "cleanup", operation: "close", args: { hwnd: 4242, discardChanges: true }, expect: { closed: true } }],
    };
    writeFileSync(join(harness.workspaceDir, "full-tax-journey.json"), JSON.stringify(scenario), "utf8");
    const result = await harness.call("scenario_run", {
      scenarioRef: "workspace:full-tax-journey.json",
      resultRef: "results:full-tax-journey.json",
    }, 90_000);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.mainOk, true);
    assert.equal(result.result.cleanupOk, true);
    assert.equal(result.result.steps.length, scenario.steps.length);
    const report = JSON.parse(readFileSync(join(harness.resultDir, "full-tax-journey.json"), "utf8"));
    assert.equal(report.status, "ok");
    assert.equal(report.steps.find((step) => step.id === "ustva_result").values["amounts.settlement.cents"], 1_050);
    assert.equal(report.steps.find((step) => step.id === "gew_save").values.saved, true);
  });
});

test("17 MCP reads the same UStVA result from the mock-backed real API", async () => {
  await withHarness(async (harness) => {
    await openUstva(harness);
    const direct = await harness.call("ustva_read", { hwnd: 4242 });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist", "index.js")],
      env: { ...process.env, SSE_API_URL: harness.baseUrl },
    });
    const client = new Client({ name: "tax-journey-parity", version: "1.0.0" });
    try {
      await client.connect(transport);
      const response = await client.callTool({ name: "sse_ustva_read", arguments: { hwnd: 4242 } });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      const text = response.content.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
      const throughMcp = JSON.parse(text);
      assert.equal(throughMcp.taxYear, direct.taxYear);
      assert.deepEqual(throughMcp.period, direct.period);
      assert.deepEqual(throughMcp.amounts, direct.amounts);
      assert(!text.includes(harness.temporary), "MCP darf keinen lokalen Temp-Pfad ausgeben");
    } finally {
      await client.close();
    }
  });
});

test("18 profile 2025 launches Gewinn-Erfassung 2026 and serves UStVA through HTTP and MCP", async () => {
  await withHarness(async (harness) => {
    const product = await harness.call("product_info");
    assert.deepEqual(product.supportedCaseYears, { einurvor: [2025, 2026] });
    assert.equal(product.defaultExecutable.supported, true);
    const productWithoutInstallation = await harness.call("product_info");
    assert.deepEqual(
      {
        currentBuild: productWithoutInstallation.buildDrift.current,
        exists: productWithoutInstallation.defaultExecutable.exists,
        supported: productWithoutInstallation.defaultExecutable.supported,
        reason: productWithoutInstallation.defaultExecutable.reason,
      },
      {
        currentBuild: "",
        exists: false,
        supported: false,
        reason: "Programmdatei existiert nicht.",
      },
      "Die portable Produktinfo muss eine fehlende Standardinstallation strukturiert darstellen.",
    );
    const cases = await harness.call("list_cases");
    assert(cases.cases.some((entry) => entry.name === "synthetic.GewErfass2026"));

    const wrongMode = await harness.call(
      "launch",
      { caseRef: "cases:synthetic.GewErfass2026", mode: "einur" },
      30_000,
    );
    assert.equal(wrongMode.ok, false);
    assert.equal(wrongMode.kind, "mode-mismatch");

    const launched = await harness.call(
      "launch",
      { caseRef: "cases:synthetic.GewErfass2026", mode: "einurvor" },
      30_000,
    );
    assert.deepEqual(
      { documentType: launched.case.documentType, taxYear: launched.case.taxYear, mode: launched.case.mode },
      { documentType: "GewErfass", taxYear: 2026, mode: "einurvor" },
    );
    await harness.call("click", {
      name: "UStVA",
      expectedPageBefore: "Einnahmen/Ausgaben",
      expectedPageAfter: "Umsatzsteuer-Voranmeldungen 2026",
    });
    const direct = await harness.call("ustva_read", { hwnd: 4242 });
    assert.equal(direct.taxYear, 2026);
    assert.equal(direct.page, "Umsatzsteuer-Voranmeldungen 2026");
    const caseHash = (await harness.call("case_hash", { ref: "cases:synthetic.GewErfass2026" })).sha256;
    const selected = await harness.call("ustva_select_period", {
      selector: "month",
      expectedCurrent: "june",
      value: "july",
      expectedCaseRef: "cases:synthetic.GewErfass2026",
      expectedCaseHash: caseHash,
    });
    assert.equal(selected.ustva.effects.taxDataChanged, true);
    const afterSelection = await harness.call("ustva_read", { hwnd: 4242 });
    assert.equal(afterSelection.taxYear, 2026);
    assert.equal(afterSelection.period.key, "july");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist", "index.js")],
      env: { ...process.env, SSE_API_URL: harness.baseUrl },
    });
    const client = new Client({ name: "next-year-ustva-parity", version: "1.0.0" });
    try {
      await client.connect(transport);
      const response = await client.callTool({ name: "sse_ustva_read", arguments: { hwnd: 4242 } });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      const throughMcp = response.structuredContent;
      assert.equal(throughMcp.taxYear, 2026);
      assert.deepEqual(throughMcp.period, afterSelection.period);
      assert.deepEqual(throughMcp.amounts, afterSelection.amounts);
    } finally {
      await client.close();
    }
    await harness.call("close", { hwnd: 4242, pid: 3131, force: true, discardChanges: true });
    assert.equal(
      sha256File(harness.seeded.nextYearUstvaPath),
      harness.seeded.nextYearUstvaHash,
      "Discard der synthetischen UStVA-2026-Aenderung darf die Falldatei nicht schreiben.",
    );
  }, { includeNextYearUstva: true });
});

test("19 navigation, page readers and the element tree agree on one page", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    const navigated = await harness.call("goto", { name: TABLE_PAGE, maxSteps: 20 });
    assert.equal(navigated.erreicht, true);
    assert.equal(navigated.ueberschrift, TABLE_PAGE);

    const stepwise = await harness.call("goto", { name: "Einnahmen/Ausgaben", useSearch: false, direction: "Zurück", maxSteps: 20 });
    assert.deepEqual(stepwise.weg, ["Einnahmen/Ausgaben", TABLE_PAGE]);
    await harness.call("goto", { name: TABLE_PAGE });

    const subpages = await harness.call("subpages", { hwnd: 4242 });
    assert.equal(subpages.unterseiten[0].name, "Umsatzsteuer-Voranmeldungen 2025");

    const page = await harness.call("page", { hwnd: 4242 });
    const readPage = await harness.call("read_page", { hwnd: 4242 });
    const readFull = await harness.call("read_full", { hwnd: 4242 });
    assert.equal(readPage.heading, page.ueberschrift);
    assert.equal(readFull.ueberschrift, page.ueberschrift);
    assert.equal(readFull.anzahl, readPage.lines.length, "read_full und read_page zaehlen dieselbe Seite");

    const found = await harness.call("find", { name: "Zinsertrag", contains: true, hwnd: 4242 });
    assert.equal(found.count, 1);
    assert.equal(found.incomplete, false);
    const value = await harness.call("get_value", { rid: found.hits[0].rid, hwnd: 4242 });
    assert.equal(value.value, "1,00");
    const positions = await harness.call("positions", { aktion: "list", hwnd: 4242 });
    assert.equal(positions.anzahl, readPage.lines.length);
    const summe = positions.positionen.find((entry) => entry.name === TABLE_SUM_LABEL);
    assert.equal(typeof summe.y, "number");

    // 'Einnahmen' trifft die Summenzeile und den Navigationseintrag; ein
    // mehrdeutiger Bezeichner darf keinen willkuerlichen Treffer liefern.
    const ambiguous = await harness.request("get_value", { name: "Einnahmen", contains: true, hwnd: 4242 });
    assert.equal(ambiguous.body.result.ok, false);
    assert.equal(ambiguous.body.result.kind, "ambiguous");

    const help = await harness.call("help", { hwnd: 4242 });
    assert.deepEqual(Object.keys(help.abschnitte), [`Hilfe zu ${TABLE_PAGE}`]);
    const checked = await harness.call("check", { hwnd: 4242 });
    assert.equal(checked.beanstandungsfrei, true);
    const catalog = loadProductProfile("2025").pageObjectsCatalog;
    const [catalogPageId, catalogPage] = Object.entries(catalog.pages)[0];
    const requestedPageId = catalogPageId.toUpperCase();
    const objects = await harness.call("page_objects", { pageId: requestedPageId });
    assert.equal(objects.pageId, requestedPageId);
    assert.equal(objects.page.heading, catalogPage.heading);
  });
});

test("20 scroll and tree state are reported instead of guessed", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    await harness.call("goto", { name: TABLE_PAGE });
    const info = await harness.call("scroll_page", { mode: "info", hwnd: 4242 });
    assert.equal(info.scrollbar, true);
    const scrolled = await harness.call("scroll_page", { mode: "amount", direction: "down", hwnd: 4242 });
    assert.equal(scrolled.nachher, 25);
    const positioned = await harness.call("scroll", { mode: "percent", vPercent: 60, hwnd: 4242 });
    assert.equal(positioned.vPercent, 60);
    const intoView = await harness.call("scroll", { mode: "intoview", name: TABLE_SUM_LABEL, hwnd: 4242 });
    assert.equal(intoView.scrolledTo, TABLE_SUM_LABEL);
    assert.equal((await harness.call("tree_scroll", { direction: "down", steps: 3, hwnd: 4242 })).gerollt, "down");
    assert.equal((await harness.call("tree_top", { hwnd: 4242 })).gerollt, "top");
    // Navigation setzt den Rollzustand zurueck; sonst laege ein spaeterer
    // Lesevorgang unbemerkt auf dem falschen Seitenausschnitt.
    await harness.call("goto", { name: "Abziehbare Vorsteuer" });
    assert.equal((await harness.call("scroll_page", { mode: "info", hwnd: 4242 })).vorher, 0);
  });
});

test("21 table add, update and delete are bound by page and sum", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    await harness.call("goto", { name: TABLE_PAGE });
    const before = await harness.call("table_read", { sumLabel: TABLE_SUM_LABEL, hwnd: 4242 });
    assert.equal(before.anzahl, 2);
    assert.equal(before.summe, "1,50");

    const added = await harness.call("table_add", {
      expectedPage: TABLE_PAGE,
      werte: ["", "01.03.2025", "Synthetische Einnahme", "0,50"],
      sumLabel: TABLE_SUM_LABEL,
      expectedBefore: "1,50",
      expectedAfter: "2,00",
    });
    assert.equal(added.verified, true);
    assert.equal(added.sumAfter, "2,00");

    const updated = await harness.call("table_update", {
      expectedPage: TABLE_PAGE,
      text: "Synthetische Einnahme",
      werte: [null, null, "1,50"],
      sumLabel: TABLE_SUM_LABEL,
      expectedBefore: "2,00",
      expectedAfter: "3,00",
    });
    assert.equal(updated.summeNachher, "3,00");

    const table = await harness.call("read_table", { hwnd: 4242 });
    assert.equal(table.rowCount, 3);
    assert.deepEqual(table.headers, ["Datum", "Text", "Betrag"]);
    assert.deepEqual(table.rows.at(-1), ["01.03.2025", "Synthetische Einnahme", "1,50"]);

    const deleted = await harness.call("table_delete", {
      expectedPage: TABLE_PAGE,
      text: "Synthetische Einnahme",
      sumLabel: TABLE_SUM_LABEL,
      expectedBefore: "3,00",
      expectedAfter: "1,50",
    });
    assert.equal(deleted.geloescht, true);
    assert.equal(deleted.target, "Synthetische Einnahme");
    assert.equal((await harness.call("table_read", { hwnd: 4242 })).summe, "1,50");
  });
});

test("22 a wrong expected sum rolls the table back completely", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    await harness.call("goto", { name: TABLE_PAGE });
    const failed = await harness.request("table_add", {
      expectedPage: TABLE_PAGE,
      werte: ["", "02.03.2025", "Darf nicht bleiben", "0,50"],
      sumLabel: TABLE_SUM_LABEL,
      expectedBefore: "1,50",
      expectedAfter: "999,99",
    });
    const result = failed.body.result;
    assert.equal(result.ok, false);
    assert.equal(result.kind, "postcondition-failed");
    assert.equal(result.rollback.erfolgreich, true);
    assert.equal(result.rollback.summe, "1,50");
    const after = await harness.call("read_table", { hwnd: 4242 });
    assert.equal(after.rowCount, 2, "Die zurueckgerollte Zeile darf nicht sichtbar bleiben");
    assert(!after.rows.some((row) => row[1] === "Darf nicht bleiben"));

    const wrongPage = await harness.request("table_delete", {
      expectedPage: "Einnahmen/Ausgaben",
      text: "Zinsertrag Tagesgeld",
      sumLabel: TABLE_SUM_LABEL,
      expectedBefore: "1,50",
      expectedAfter: "0,50",
    });
    assert.equal(wrongPage.body.result.kind, "precondition-failed");
    assert.equal((await harness.call("read_table", { hwnd: 4242 })).rowCount, 2);
  });
});

test("23 menu keeps ELSTER closed and opens only safe dialogs", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    const menu = await harness.call("menu", { hwnd: 4242 });
    const elster = menu.menues.find((entry) => entry.name === "ELSTER");
    assert(elster.eintraege.every((entry) => entry.gesperrt === true), "ELSTER-Eintraege muessen gesperrt bleiben");

    const blocked = await harness.request("menu_click", { name: "Anmeldungen versenden", acknowledgeDestructive: true });
    assert.equal(blocked.body.result.ok, false);
    assert.equal(blocked.body.result.kind, "blocked");

    const safe = await harness.call("menu_click", { name: "Roter Faden" });
    assert.equal(safe.ausgeloest, "Roter Faden");
    assert.equal((await harness.call("menu_close", { hwnd: 4242 })).verified, true);

    await harness.call("menu_click", { name: "Steuerfall öffnen..." });
    const selected = await harness.call("file_dialog_select", {
      expectedDialogTitle: "Steuerfall öffnen",
      resourceRef: "cases:synthetic.Gew2025",
      expectedHash: harness.seeded.freelancerHash,
    });
    assert.equal(selected.dialogClosed, true);
    assert.equal((await harness.call("dismiss", { hwnd: 4242 })).geschlossen, 1);
  });
});

test("23b receipt manager navigates, imports, reads and deletes with fresh bindings", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    const closed = await harness.request("receipt_manager_action", { actionId: "showAllReceipts" });
    assert.equal(closed.body.result.kind, "not-found");

    await harness.call("menu_click", { name: "BelegManager" });
    const wrongState = await harness.request("receipt_manager_list", {});
    assert.equal(wrongState.body.result.kind, "precondition-failed");
    const listed = await harness.call("receipt_manager_action", { actionId: "showAllReceipts", hwnd: 4242 });
    assert.equal(listed.stateBefore, "start");
    assert.equal(listed.stateAfter, "list");
    assert.equal(listed.windowSetUnchanged, true);
    assert.equal(listed.dirtyStateUnchanged, true);
    assert.equal(listed.verified, true);

    const receipts = await harness.call("receipt_manager_list", { hwnd: 4242 });
    assert.equal(receipts.count, 0);
    assert.equal(receipts.rowsComplete, true);
    assert.equal(receipts.physicalInputUsed, false);
    assert.match(receipts.listFingerprint, /^[A-Fa-f0-9]{64}$/u);

    const receiptPath = join(harness.documentsDir, "synthetic-receipt.pdf");
    writeFileSync(receiptPath, "%PDF-1.4 synthetic receipt\n", "utf8");
    const receiptHash = sha256File(receiptPath);
    const imported = await harness.call("receipt_manager_import", {
      resourceRef: "documents:synthetic-receipt.pdf",
      expectedHash: receiptHash,
      expectedListFingerprint: receipts.listFingerprint,
      expectedCountBefore: receipts.count,
      acknowledgeImport: true,
    });
    assert.equal(imported.countBefore, 0);
    assert.equal(imported.countAfter, 1);
    assert.equal(imported.previewChanged, true);
    assert.equal(imported.sourceHashStable, true);
    assert.equal(imported.cleanupRequired, false);
    assert.equal(imported.resourceRefs.resourceRef, "documents:synthetic-receipt.pdf");

    const afterImport = await harness.call("receipt_manager_list", { hwnd: 4242 });
    assert.equal(afterImport.count, 1);
    assert.equal(afterImport.draftCount, 1);
    const row = afterImport.rows[0];
    const read = await harness.call("receipt_manager_read", {
      rowRid: row.rowRid,
      rowFingerprint: row.rowFingerprint,
      expectedListFingerprint: afterImport.listFingerprint,
    });
    assert.equal(read.row.rowRid, row.rowRid);
    assert.equal(read.semanticListUnchanged, true);
    assert.equal(read.verified, true);

    const staleUpdate = await harness.call("receipt_manager_update", {
      rowRid: row.rowRid,
      rowFingerprint: row.rowFingerprint,
      expectedListFingerprint: afterImport.listFingerprint,
      expectedDetailFingerprint: "A".repeat(64),
      values: { title: "Amazon Testbeleg" },
      acknowledgeUpdate: true,
    });
    assert.equal(staleUpdate.kind, "stale");
    const updated = await harness.call("receipt_manager_update", {
      rowRid: row.rowRid,
      rowFingerprint: row.rowFingerprint,
      expectedListFingerprint: afterImport.listFingerprint,
      expectedDetailFingerprint: read.detailFingerprint,
      values: {
        title: "Amazon Testbeleg",
        date: "2026-01-25",
        documentNumber: "DE6RQH4WAEUD",
        amount: "75.00",
        vatRate: "19",
        net: false,
        note: "Amazon EU S.a r.l. - DJI Mic Mini",
      },
      acknowledgeUpdate: true,
    });
    assert.deepEqual(updated.changedFields.sort(), ["amount", "date", "documentNumber", "note", "title"].sort());
    assert.equal(updated.valuesAfter.amount, "75,00");
    assert.equal(updated.valuesAfter.date, "2026-01-25");
    assert.equal(updated.draftBefore, true);
    assert.equal(updated.draftAfter, false);
    assert.equal(updated.countUnchanged, true);
    assert.equal(updated.otherRowsUnchanged, true);
    assert.equal(updated.verified, true);

    const afterUpdate = await harness.call("receipt_manager_list", { hwnd: 4242 });
    assert.equal(afterUpdate.rows[0].draft, false);
    assert.notEqual(afterUpdate.rows[0].rowFingerprint, row.rowFingerprint);

    const staleDelete = await harness.call("receipt_manager_delete", {
      rowRid: afterUpdate.rows[0].rowRid,
      rowFingerprint: "A".repeat(64),
      expectedListFingerprint: afterUpdate.listFingerprint,
      expectedCountBefore: 1,
      acknowledgeDelete: true,
    });
    assert.equal(staleDelete.kind, "stale");
    const deleted = await harness.call("receipt_manager_delete", {
      rowRid: afterUpdate.rows[0].rowRid,
      rowFingerprint: afterUpdate.rows[0].rowFingerprint,
      expectedListFingerprint: afterUpdate.listFingerprint,
      expectedCountBefore: 1,
      acknowledgeDelete: true,
    });
    assert.equal(deleted.countBefore, 1);
    assert.equal(deleted.countAfter, 0);
    assert.equal(deleted.remainingRowsUnchanged, true);
    assert.equal(deleted.dialogClosed, true);
    assert.equal((await harness.call("receipt_manager_list", { hwnd: 4242 })).count, 0);

    const stale = await harness.request("receipt_manager_action", { actionId: "showAllReceipts" });
    assert.equal(stale.body.result.kind, "precondition-failed");
    const home = await harness.call("receipt_manager_action", { actionId: "goHome" });
    assert.equal(home.stateBefore, "list");
    assert.equal(home.stateAfter, "start");
    assert.notEqual(home.stateFingerprintBefore, home.stateFingerprintAfter);
  });
});

test("23c receipt API smoke queries, upserts and links with independent readback", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    await harness.call("menu_click", { name: "BelegManager" });
    await harness.call("receipt_manager_action", { actionId: "showAllReceipts", hwnd: 4242 });

    const receiptPath = join(harness.documentsDir, "api-smoke.pdf");
    writeFileSync(receiptPath, "%PDF-1.4 synthetic API smoke receipt\n", "utf8");
    const title = "API Smoke Invoice";
    const documentNumber = "API-SMOKE-1";
    const upsert = await harness.call("receipt_manager_bulk_upsert", {
      items: [{
        resourceRef: "documents:api-smoke.pdf",
        expectedHash: sha256File(receiptPath),
        identity: { exactTitle: title, documentNumber },
        values: {
          title, date: "2026-08-26", documentNumber, amount: "12.34",
          vatRate: "19", net: false, note: "one-call API smoke",
        },
      }],
      acknowledgeBulkUpsert: true,
      stopOnError: true,
      hwnd: 4242,
    }, 30_000);
    assert.equal(upsert.ok, true);
    assert.equal(upsert.completedCount, 1);
    assert.equal(upsert.items[0].action, "imported");
    assert.equal(upsert.items[0].verified, true);

    const queried = await harness.call("receipt_manager_list", {
      filter: { exactTitle: title, draft: false }, limit: 1, hwnd: 4242,
    });
    assert.equal(queried.matchedCount, 1);
    assert.equal(queried.matchesComplete, true);
    assert.equal(queried.matches[0].title, title);
    assert.equal(queried.matches[0].draft, false);

    const linked = await harness.call("receipt_manager_link", {
      items: [{
        expectedReceiptTitle: title,
        receiptContentFingerprint: queried.matches[0].contentFingerprint,
        linked: true,
      }],
      expectedTargetPage: "Einnahmen/Ausgaben",
      expectedLinkTarget: "Synthetisches Ziel",
      acknowledgeLinkChange: true,
      hwnd: 4242,
    }, 30_000);
    assert.equal(linked.changedCount, 1);
    assert.equal(linked.items[0].linkedAfter, true);
    assert.equal(linked.persistenceVerified, true);
    assert.equal(linked.verified, true);
  });
});

test("23d fill_fields writes two profiled vehicle fields in one worker plan", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    await harness.call("click", {
      name: "Fahrzeug",
      expectedPageBefore: "Einnahmen/Ausgaben",
      expectedPageAfter: "1. Fahrzeug",
    });
    const before = await harness.call("known_page_state", { pageId: "gew.fahrzeug", hwnd: 4242 });
    const filled = await harness.call("fill_fields", {
      pageId: "gew.fahrzeug",
      fields: [
        { fieldId: "bezeichnung", expectedBefore: "", value: "API Bulk Fahrzeug", expectedAfter: "API Bulk Fahrzeug" },
        { fieldId: "kennzeichen", expectedBefore: "", value: "B-ULK 2026", expectedAfter: "B-ULK 2026" },
      ],
      expectedEpoch: before.epoch,
      stopOnError: true,
      rollback: "best-effort",
      finalReadback: true,
      hwnd: 4242,
    }, 30_000);

    assert.equal(filled.ok, true);
    assert.equal(filled.resultingState, "completed-verified");
    assert.equal(filled.completed.length, 2);
    assert.equal(filled.performance.workerProcessCount, 1);
    assert.equal(filled.performance.internalOperationCount, 3);
    assert.equal(filled.finalReadbackVerified, true);
    assert.deepEqual(
      filled.finalReadback.fields.map((field) => [field.label, field.value]),
      [["Bezeichnung", "API Bulk Fahrzeug"], ["Kennzeichen", "B-ULK 2026"]],
    );
  });
});

test("24 window handles stay bound to the exact current title", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    const windows = await harness.call("windows", {});
    const target = windows.windows[0];
    assert.equal(target.minimiert, false);
    const fingerprint = createHash("sha256").update(target.title).digest("hex").toUpperCase();

    const stale = await harness.request("window_close", { pid: target.pid, hwnd: target.hwnd, expectedTitle: "Fremdes Fenster" });
    assert.equal(stale.body.result.kind, "stale");

    assert.equal((await harness.call("window_close", { pid: target.pid, hwnd: target.hwnd, titleFingerprint: fingerprint })).closed, true);
    assert.equal((await harness.call("windows", {})).windows[0].minimiert, true);
    assert.equal((await harness.call("window_restore", { pid: target.pid, hwnd: target.hwnd, titleFingerprint: fingerprint })).restored, true);
    assert.equal((await harness.call("windows", {})).windows[0].minimiert, false);
  });
});

test("24b open cases stay distinguishable by file, type and year", async () => {
  await withHarness(async (harness) => {
    const empty = await harness.call("instances", {});
    assert.equal(empty.count, 0);
    assert.deepEqual(empty.instances, []);

    await launchFreelancer(harness);
    const open = await harness.call("instances", {});
    assert.equal(open.count, 1);
    assert.equal(open.ambiguous, false);
    const [instance] = open.instances;
    // Der Fall muss ohne Rateschritt benannt sein: Pfadquelle, Typ und Jahr.
    assert.equal(instance.casePathSource, "title");
    assert.equal(instance.caseType, "Gew");
    assert.equal(instance.caseYear, 2025);
    assert.equal(instance.startMode, "einur");
    assert.equal(instance.recoveredState, false);
    // Genau diese Fenster-ID verlangen alle fallbezogenen Operationen.
    assert.equal(typeof instance.hwnd, "number");
    assert.equal((await harness.call("windows", {})).windows[0].hwnd, instance.hwnd);
  });
});

test("25 diagnostics bind snapshot, comparison and probe to the same element", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    await harness.call("goto", { name: TABLE_PAGE });
    const snapshot = await harness.call("snapshot", { namedOnly: true, maxNodes: 500, hwnd: 4242 });
    assert.equal(snapshot.count, snapshot.nodes.length);
    const compared = await harness.call("snapshot_compare", { repetitions: 3, hwnd: 4242 });
    assert.equal(compared.equivalent, true);
    assert.equal(compared.privateValuesReturned, false);
    assert.equal(compared.legacy.count, snapshot.count);

    const probe = await harness.call("accessibility_probe", {
      rid: snapshot.nodes[0].rid, maxDepth: 2, maxNodes: 50, includePatterns: true, includeRaw: true, hwnd: 4242,
    });
    assert.equal(probe.node.rid, snapshot.nodes[0].rid);
    assert.equal(probe.rawTruncated, false);

    const combos = await harness.request("combo_options", { name: "Auswahl Monat", hwnd: 4242 });
    assert.equal(combos.body.result.kind, "not-found", "Auf dieser Seite gibt es keine ComboBox");
    await harness.call("goto", { name: "Umsatzsteuer-Voranmeldungen 2025" });
    const options = await harness.call("combo_options", { name: "Auswahl Monat", hwnd: 4242 });
    assert.deepEqual(options.options, MONTHS);
    assert.equal(options.current, "Juni");
  });
});

test("26 screenshot, CSV dialog and collect stay bound to result refs", async () => {
  await withHarness(async (harness) => {
    await launchFreelancer(harness);
    const shot = await harness.call("screenshot", { resultRef: "results:kontrolle.png", includeImage: true, hwnd: 4242 });
    assert.equal(shot.shot.w, 1200);
    assert.equal(shot.shot.path, "results:kontrolle.png", "Der lokale Pfad darf die API nicht verlassen");
    assert.equal(existsSync(join(harness.resultDir, "kontrolle.png")), true);
    const repeated = await harness.request("screenshot", { resultRef: "results:kontrolle.png", hwnd: 4242 });
    assert.equal(repeated.body.result.kind, "bad-args", "Ein vorhandenes Kontrollbild darf nicht ueberschrieben werden");

    const exported = await harness.call("export_csv", { resultRef: "results:csv", hwnd: 4242 });
    assert.equal(exported.ausgeloest, "Export CSV");
    assert.equal(exported.offeneDialoge, 1);
    assert.equal(existsSync(join(harness.resultDir, "csv", "ergebnis.csv")), false,
      "Der echte Worker bestaetigt den Exportdialog nicht selbst und darf keine Mock-Datei vortaeuschen.");

    const collected = await harness.call("collect", { resultRef: "results:sammlung.json", maxPages: 2, hwnd: 4242 });
    assert.equal(collected.anzahl, 2);
    assert.deepEqual(collected.ueberschriften, ["Einnahmen/Ausgaben", TABLE_PAGE]);
    const report = JSON.parse(readFileSync(join(harness.resultDir, "sammlung.json"), "utf8"));
    assert.equal(report.seiten.length, 2);

    const files = await harness.call("workspace_file_list", { ref: ".", area: "results" });
    assert.deepEqual(
      files.files.map((file) => file.ref).sort(),
      ["results:kontrolle.png", "results:sammlung.json"],
    );
  });
});

test("27 backup and archive move cases only against a proven inventory", async () => {
  await withHarness(async (harness) => {
    writeFileSync(harness.seeded.freelancerPath, createSyntheticAkadCase({ fileType: "Gew", taxNumber: "freelancer" }));
    writeFileSync(harness.seeded.incomePath, createSyntheticAkadCase({ fileType: "ESt", taxNumber: "income" }));
    const freelancerHash = sha256File(harness.seeded.freelancerPath);
    const incomeHash = sha256File(harness.seeded.incomePath);
    const backup = await harness.call("backup_cases", { destinationRef: "backups:lauf-1" });
    assert.equal(backup.anzahl, 2);
    assert.equal(existsSync(join(harness.temporary, "backups", "lauf-1", "synthetic.Gew2025")), true);

    const stale = await harness.request("archive_cases", {
      destinationRef: "backups:archiv-1",
      cases: [{ name: "synthetic.Gew2025", expectedSha256: "0".repeat(64) }],
      expectedRemaining: [{ name: "synthetic.ESt2025", expectedSha256: incomeHash }],
    });
    assert.equal(stale.body.result.kind, "precondition-failed");
    assert.equal(existsSync(harness.seeded.freelancerPath), true, "Ein falscher Hash darf nichts verschieben");

    const archiveWorkerCallsBefore = harness.model.journal.filter((entry) => entry.operation === "archive_cases").length;
    const archived = await harness.call("archive_cases", {
      destinationRef: "backups:archiv-1",
      cases: [{ name: "synthetic.Gew2025", expectedSha256: freelancerHash }],
      expectedRemaining: [{ name: "synthetic.ESt2025", expectedSha256: incomeHash }],
    });
    assert.equal(archived.archived, 1);
    assert.equal(
      harness.model.journal.filter((entry) => entry.operation === "archive_cases").length,
      archiveWorkerCallsBefore,
      "archive_cases darf den synthetischen Worker nicht erreichen",
    );
    assert.equal(existsSync(harness.seeded.freelancerPath), false);
    assert.equal((await harness.call("list_cases", {})).count, 1);
    assert.equal((await harness.call("center_cases", { hwnd: 4242 })).faelle.length, 1);
    assert.equal((await harness.call("center_refresh", { hwnd: 4242, expectedDirectoryRef: "cases:." })).sucheUnveraendert, true);
  });
});

test("28 save_as and the private desktop keep the source case untouched", async () => {
  await withHarness(async (harness) => {
    const started = await harness.call("desktop_start", {
      caseRef: "cases:synthetic.Gew2025", mode: "einur", name: "SSESynthetic", timeoutSec: 45,
    }, 30_000);
    assert.equal(started.desktop, "SSESynthetic");
    assert.equal((await harness.call("desktop_status", {})).aktiv, true);

    const copied = await harness.call("save_as", {
      sourceRef: "cases:synthetic.Gew2025",
      expectedSourceHash: harness.seeded.freelancerHash,
      targetRef: "cases:kopie.Gew2025",
    });
    assert.equal(copied.targetHash, harness.seeded.freelancerHash);
    assert.equal(sha256File(harness.seeded.freelancerPath), harness.seeded.freelancerHash);
    assert.equal(copied.targetPath, "cases:kopie.Gew2025");

    const stopped = await harness.call("desktop_stop", { discardChanges: true }, 30_000);
    assert.equal(stopped.hartBeendet, false);
    assert.equal(stopped.desktopMarkeEntfernt, true);
    assert.equal((await harness.call("desktop_status", {})).aktiv, false);
  });
});

test("29 VaSt only merges an acknowledged plan that still matches the dialog", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.ESt2025" })).sha256;
    await harness.call("menu_click", { name: "Belege abrufen (VaSt)..." });
    const dialog = await harness.call("vast_dialog_read", { hwnd: 4242 });
    assert.equal(dialog.certificateCount, 1);
    const row = dialog.rows[0];
    assert.equal(row.localTarget, VAST_UNMAPPED);

    const binding = { mappingFingerprint: dialog.mappingFingerprint, certificate: row.certificate, occurrence: row.occurrence };
    assert.equal((await harness.call("vast_row_details", { ...binding, hwnd: 4242 })).detailLines[0], "65.000,00");
    assert.equal((await harness.call("vast_row_set_expanded", { ...binding, expectedBefore: false, expanded: true, hwnd: 4242 })).after, true);
    assert.deepEqual(
      (await harness.call("vast_mapping_options", { ...binding, expectedCurrent: VAST_UNMAPPED, hwnd: 4242 })).uiaOptions,
      [VAST_UNMAPPED, VAST_TARGET],
    );

    const unacknowledged = await harness.request("vast_apply", {
      hwnd: 8888, expectedMainHwnd: 4242, expectedCaseRef: "cases:synthetic.ESt2025", expectedCaseHash: hash,
      mappingFingerprint: dialog.mappingFingerprint, acknowledgeApply: false,
      plan: [{ certificate: row.certificate, occurrence: row.occurrence, localTarget: VAST_UNMAPPED }],
    });
    assert.equal(unacknowledged.status, 400, "acknowledgeApply=false darf das Schema nicht passieren");

    const mapped = await harness.call("vast_mapping_select", {
      ...binding, expectedCurrent: VAST_UNMAPPED, value: VAST_TARGET, expectedAfter: VAST_TARGET, hwnd: 4242,
    });
    const stalePlan = await harness.request("vast_apply", {
      hwnd: 8888, expectedMainHwnd: 4242, expectedCaseRef: "cases:synthetic.ESt2025", expectedCaseHash: hash,
      mappingFingerprint: mapped.mappingFingerprintAfter, acknowledgeApply: true,
      plan: [{ certificate: row.certificate, occurrence: row.occurrence, localTarget: VAST_UNMAPPED }],
    });
    assert.equal(stalePlan.body.result.kind, "stale");

    const applied = await harness.call("vast_apply", {
      hwnd: 8888, expectedMainHwnd: 4242, expectedCaseRef: "cases:synthetic.ESt2025", expectedCaseHash: hash,
      mappingFingerprint: mapped.mappingFingerprintAfter, acknowledgeApply: true,
      plan: [{ certificate: row.certificate, occurrence: row.occurrence, localTarget: VAST_TARGET }],
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.dirtyAfter, true);
    assert.equal(sha256File(harness.seeded.incomePath), hash, "Der Merge darf die Datei nicht ungefragt schreiben");
    const state = await harness.call("known_page_state", { pageId: "est.arbeitnehmer", hwnd: 4242 });
    assert.equal(state.fields.find((field) => field.label === "Bruttoarbeitslohn").value, "65.000,00");
  });
});

test("30 checker state and the bounded global search transaction stay readable", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    const run = await harness.call("checker_run", { hwnd: 4242 });
    assert.equal(run.konsistent, true);
    assert.equal(run.gesamt, 1);
    const closed = await harness.call("checker_close", { hwnd: 4242 });
    assert.equal(closed.alreadyClosed, false, "checker_close muss das zuvor geoeffnete Fenster kennen");
    assert.equal((await harness.call("checker_close", { hwnd: 4242 })).alreadyClosed, true);

    const hash = (await harness.call("case_hash", { ref: "cases:synthetic.ESt2025" })).sha256;
    const found = await harness.call("find", { name: "Globales Suchfeld", hwnd: 4242 });
    const written = await harness.call("set_value", {
      rid: found.hits[0].rid, expectedBefore: "", value: "Werbungskosten", expectedAfter: "Werbungskosten",
    });
    assert.equal(written.verified, true);
    assert.equal((await harness.call("get_value", { name: "Globales Suchfeld", hwnd: 4242 })).value, "Werbungskosten");
    assert.equal(sha256File(harness.seeded.incomePath), hash, "Die steuerneutrale Suche schreibt keine Falldatei");
  });
});

test("30b a verified safety copy lands in the backup area before any write", async () => {
  await withHarness(async (harness) => {
    // Vor einer Schreibaktion gehoert eine Sicherung in den Sicherungsbereich.
    // Es ist dieselbe hashgepruefte Kopie wie eine Arbeitskopie; nur der
    // Ablageort bestimmt den Zweck.
    const backup = await harness.call("make_working_copy", {
      sourceRef: "cases:synthetic.Gew2025",
      targetRef: "backups:vor-aenderung.Gew2025",
      expectedSourceHash: harness.seeded.freelancerHash,
    });
    assert.equal(backup.copied, true);
    assert.equal(backup.verified, true);
    assert.equal(backup.targetHash, harness.seeded.freelancerHash,
      "Die Sicherung muss bytegleich zur Quelle sein.");
    assert.deepEqual(backup.resourceRefs, {
      sourceRef: "cases:synthetic.Gew2025",
      targetRef: "backups:vor-aenderung.Gew2025",
    });

    // Das Original bleibt unberuehrt.
    assert.equal(sha256File(harness.seeded.freelancerPath), harness.seeded.freelancerHash);

    // Ein zweiter Lauf darf eine vorhandene Sicherung niemals ueberschreiben.
    const wiederholt = await harness.request("make_working_copy", {
      sourceRef: "cases:synthetic.Gew2025",
      targetRef: "backups:vor-aenderung.Gew2025",
      expectedSourceHash: harness.seeded.freelancerHash,
    });
    assert.equal(wiederholt.body.result.ok, false);
    assert.equal(wiederholt.body.result.kind, "exists");

    // Fremde Bereiche bleiben gesperrt: eine Sicherung gehoert nicht in den
    // Ergebnisordner, aus dem Berichte an Menschen gehen. Das scheitert schon
    // am Argumentschema, also VOR jedem Dateizugriff - deshalb kommt hier eine
    // Fehlerhuelle zurueck und kein Operationsergebnis.
    const fremd = await harness.request("make_working_copy", {
      sourceRef: "cases:synthetic.Gew2025",
      targetRef: "results:heimlich.Gew2025",
      expectedSourceHash: harness.seeded.freelancerHash,
    });
    assert.equal(fremd.status, 400);
    assert.equal(fremd.body.result, undefined,
      "Ein am Schema abgewiesenes Ziel darf keine Operation ausgeloest haben.");
  });
});

test("31 a working copy carries combo, toggle and lifecycle at the API boundary", async () => {
  await withHarness(async (harness) => {
    const copy = await harness.call("make_working_copy", {
      sourceRef: "cases:synthetic.Gew2025",
      targetRef: "cases:arbeitskopie.Gew2025",
      expectedSourceHash: harness.seeded.freelancerHash,
    });
    assert.equal(copy.targetHash, harness.seeded.freelancerHash);
    assert.equal(copy.copied, true);
    assert.deepEqual(copy.resourceRefs, {
      sourceRef: "cases:synthetic.Gew2025",
      targetRef: "cases:arbeitskopie.Gew2025",
    });

    await harness.call("launch", { caseRef: "cases:arbeitskopie.Gew2025", mode: "einur" }, 30_000);
    const state = await harness.call("ui_state", { hwnd: 4242 });
    assert.equal(state.running, true);
    assert.equal(state.instance.hwnd, 4242);
    assert.equal(state.ungespeichert, false);
    assert.equal((await harness.call("dialog_list", { pid: state.instance.pid })).count, 0);

    const page = "Umsatzsteuer-Voranmeldungen 2025";
    await harness.call("goto", { name: page });
    const hash = (await harness.call("case_hash", { ref: "cases:arbeitskopie.Gew2025" })).sha256;
    const binding = { expectedCaseRef: "cases:arbeitskopie.Gew2025", expectedCaseHash: hash };
    const toggled = await harness.call("toggle", {
      expectedPage: page, aid: ".RahmenWerteUebersicht.ManuelleEingabe",
      expectedBefore: false, value: true, expectedAfter: true, ...binding,
    });
    assert.equal(toggled.after, true);
    const selected = await harness.call("combo_select", {
      expectedPage: page, aid: ".AuswahlAnmeldezeitraum.AuswahlMonat.Combobox",
      expectedCurrent: "Juni", value: "Juli", expectedAfter: "Juli", ...binding,
    });
    assert.equal(selected.after, "Juli");
    assert.equal((await harness.call("ustva_read", { hwnd: 4242 })).period.key, "july");
    assert.equal((await harness.call("ui_state", { hwnd: 4242 })).ungespeichert, true);

    const closed = await harness.call("close", { hwnd: 4242, pid: 3131, force: true, discardChanges: true });
    assert.equal(closed.closed, true);
    assert.equal(closed.stillRunning, false);
    assert.equal(sha256File(join(harness.caseDir, "arbeitskopie.Gew2025")), hash, "Verwerfen darf nichts schreiben");
    assert.equal((await harness.call("ui_state", {})).running, false);
  });
});

test("32 the checker detail and reset are reachable without the composition", async () => {
  await withHarness(async (harness) => {
    await launchIncome(harness);
    assert.equal((await harness.call("checker_run", { hwnd: 4242 })).gesamt, 1);
    const clicked = await harness.call("click_point", {
      name: CHECKER_MESSAGE, type: "TreeItem", waitMs: 500, hwnd: 4242,
    });
    assert.equal(clicked.clicked, CHECKER_MESSAGE);
    const detail = await harness.call("checker_detail", { name: CHECKER_MESSAGE, hwnd: 4242 });
    assert.equal(detail.meldung, CHECKER_MESSAGE);
    assert(detail.text.length > 0);
    const reset = await harness.call("checker_reset", { hwnd: 4242 });
    assert.deepEqual(reset.aufgeklappt, []);
    assert.equal(reset.konsistent, true);
  });
});
