/**
 * Schnelle fachliche API-Journeys mit einem zustandsbehafteten synthetischen
 * SSE-Worker. HTTP, API-Executor, Ressourcenbindung, Komposition, Workspace,
 * Szenario und (einmalig) MCP bleiben Produktionscode. Die Tests beweisen
 * nicht die proprietaere SSE-UIA-Schicht und verwenden weder LLM noch echte
 * Steuerfaelle.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  appendFileSync,
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
import {
  CHECKER_MESSAGE,
  WARNING_TEXT,
  createStatefulSseWorker,
  seedSyntheticCases,
  sha256File,
} from "./mock/stateful-sse-worker.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const token = "tax-journey-token-with-at-least-24-characters";

async function createHarness() {
  const temporary = mkdtempSync(join(tmpdir(), "sse-tax-journeys-"));
  const caseDir = join(temporary, "cases");
  const workspaceDir = join(temporary, "workspace");
  const resultDir = join(temporary, "results");
  const backupsDir = join(temporary, "backups");
  const documentsDir = join(temporary, "documents");
  for (const path of [caseDir, workspaceDir, resultDir, backupsDir, documentsDir]) {
    mkdirSync(path, { recursive: true });
  }
  const seeded = seedSyntheticCases(caseDir);
  const { worker, model } = createStatefulSseWorker({ caseDir });
  const config = {
    host: "127.0.0.1",
    port: 1,
    token,
    configPath: join(temporary, "config.json"),
    caseDir,
    workspaceDir,
    resultDir,
    backupsDir,
    documentsDir,
    sseExecutable: "C:\\Synthetic\\SSE.exe",
  };
  const execute = createApiExecutor(config, worker);
  const server = createSseApiServer({ config, execute });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

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
    baseUrl,
    headers,
    seeded,
    model,
    request,
    call,
    close,
  };
}

async function withHarness(action) {
  const harness = await createHarness();
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
      env: { ...process.env, SSE_API_URL: harness.baseUrl, SSE_API_TOKEN: token },
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
