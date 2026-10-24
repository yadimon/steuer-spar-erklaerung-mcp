/**
 * Opt-in live journey: two own income positions in a newly created synthetic
 * next-year case, with save/reopen and exact inventory readback. Run under
 * test/with-api.mjs; no existing case or manufacturer sample is used.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { callApiOperationEnvelope, readApiHealthz } from "../dist/api-client.js";

assert(process.env.SSE_API_URL && process.env.SSE_TEST_CASE_DIR,
  "This live journey must run under test/with-api.mjs.");
const client = { baseUrl: process.env.SSE_API_URL };
client.expectedInstanceId = (await readApiHealthz(client)).instanceId;
const caseName = "synthetic-income-positions.GewErfass2026";
const caseRef = `cases:${caseName}`;
const backupRef = "backups:synthetic-income-positions-before.GewErfass2026";
const names = ["Synthetic income A", "Synthetic income B"];
const overviewHeading = "Erlöse Lieferungen/Leistungen";
let instance, primaryFailure;
let closeAttempted = false;
let calls = 0;
const reportPath = join(process.env.SSE_TEST_CASE_DIR, "income-positions-report.json");
assert(!existsSync(reportPath), "A fresh income-position report is required.");
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), outcome: "running", calls: [], closes: [] };
function persist() { writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: existsSync(reportPath) ? "w" : "wx" }); }
persist();

async function call(operation, args = {}, timeoutMs = 120_000, expectedOk = true) {
  const result = (await callApiOperationEnvelope(operation, args, timeoutMs, client)).result;
  calls++;
  report.calls.push({ sequence: calls, operation, args, result });
  persist();
  if (["case_create", "launch"].includes(operation) && Number.isInteger(result.pid) && result.pid > 0 &&
      result.processStillRunning !== false) {
    instance = { pid: result.pid, hwnd: result.hwnd ?? result.instance?.hwnd };
    closeAttempted = false;
  }
  assert.equal(result.ok, expectedOk, `${operation}: ${JSON.stringify(result)}`);
  return result;
}

async function closeOwnedInstance() {
  assert(instance && Number.isInteger(instance.pid) && instance.pid > 0, "An owned process is required for close.");
  assert.equal(closeAttempted, false, "An uncertain close must not be replayed.");
  closeAttempted = true;
  const closed = await call("close", { ...instance, discardChanges: true });
  assert.equal(closed.stillRunning, false, "The owned process must exit normally.");
  assert.notEqual(closed.killed, true, "The income journey must not force termination.");
  report.closes.push({ ...instance, stillRunning: closed.stillRunning, killed: closed.killed === true });
  instance = undefined;
  persist();
}

try {
  assert.equal((await call("instances")).count, 0, "An existing SSE instance prevents the live journey.");
  assert.equal((await call("desktop_status")).aktiv, false);
  assert(!existsSync(join(process.env.SSE_TEST_CASE_DIR, caseName)), "A fresh case is required.");
  const created = await call("case_create", { targetRef: caseRef, mode: "einurvor" }, 300_000);
  instance = { hwnd: created.hwnd, pid: created.pid };
  const originalHash = (await call("case_hash", { ref: caseRef })).sha256;
  report.initialDiskHash = originalHash;
  assert.equal(originalHash, created.sha256);
  assert.equal((await call("make_working_copy", {
    sourceRef: caseRef, targetRef: backupRef, expectedSourceHash: originalHash,
  })).verified, true);
  const binding = { ...instance, expectedCaseRef: caseRef, expectedCaseHash: originalHash };
  await call("fill_fields", {
    ...binding, pageId: "gew_erfass.allgemeine_angaben_unternehmen", fields: [
      { fieldId: "name_unternehmer", expectedBefore: "", value: "Muster", expectedAfter: "Muster" },
      { fieldId: "vorname_unternehmer", expectedBefore: "", value: "Test", expectedAfter: "Test" },
    ],
  }, 180_000);
  await call("combo_select", {
    ...binding, expectedPage: "Allgemeine Angaben zum Unternehmen",
    aid: ".AngabenUnternehmen.GruppeNichtInModusKonsUSt.Einkunftsart.Combobox",
    expectedCurrent: "", value: "Gewerbebetrieb", expectedAfter: "Gewerbebetrieb",
  });
  const overview = await call("goto", { hwnd: instance.hwnd, pageId: "gew_erfass.einnahmen_ausgaben" });
  assert.equal(overview.ueberschrift, "Gewinnermittlung");
  await call("goto", { hwnd: instance.hwnd, name: overviewHeading, useSearch: true, maxSteps: 100 });

  const inventory = [];
  assert.deepEqual((await call("positions", { hwnd: instance.hwnd })).positionen, []);
  const rejectedHash = await call("position_create", {
    hwnd: instance.hwnd, expectedCaseRef: caseRef, expectedCaseHash: "0".repeat(64),
    backupRef, name: "Must not exist", expectedPositions: [],
  }, 120_000, false);
  assert.equal(rejectedHash.kind, "precondition-failed");
  assert.deepEqual((await call("positions", { hwnd: instance.hwnd })).positionen, []);
  for (const name of names) {
    const position = await call("position_create", {
      hwnd: instance.hwnd, expectedCaseRef: caseRef, expectedCaseHash: originalHash,
      backupRef, name, expectedPositions: inventory,
    });
    assert.equal(position.verified, true);
    assert.equal(position.mutationStarted, true);
    assert.equal(position.cleanupRequired, false);
    assert.equal(position.page, `Einnahmen: ${name}`);
    assert.deepEqual(position.beforePositions, inventory);
    inventory.push({ name, net: "0,00" });
    assert.deepEqual(position.afterPositions, inventory);
    const table = await call("table_read", {
      hwnd: instance.hwnd, sumLabel: "Summe der Einnahmen (netto)", sumOccurrence: 1, noKeys: true,
    });
    assert.equal(table.summe, "0,00");
    assert.deepEqual(table.zeilen, []);
    await call("click", {
      hwnd: instance.hwnd, name: "Zurück", expectedPageBefore: position.page,
      expectedPageAfter: overviewHeading, waitMs: 3_000,
    });
    assert.deepEqual((await call("positions", { hwnd: instance.hwnd })).positionen, inventory.map(row => row.name));
    const rejectedDuplicate = await call("position_create", {
      hwnd: instance.hwnd, expectedCaseRef: caseRef, expectedCaseHash: originalHash,
      backupRef, name, expectedPositions: inventory,
    }, 120_000, false);
    assert.equal(rejectedDuplicate.kind, "precondition-failed");
    assert.deepEqual((await call("positions", { hwnd: instance.hwnd })).positionen, inventory.map(row => row.name));
  }

  await call("save", { hwnd: instance.hwnd, caseRef, expectedHashBefore: originalHash });
  const savedHash = (await call("case_hash", { ref: caseRef })).sha256;
  assert.notEqual(savedHash, originalHash, "Saving the two positions must change the file.");
  report.savedDiskHash = savedHash;
  const backups = await call("workspace_file_list", { ref: "backups:.", includeHashes: true });
  const backupHash = backups.files.find(file => file.ref === backupRef)?.sha256;
  assert.match(backupHash, /^[a-f0-9]{64}$/i, "The backup must have a complete SHA-256 hash.");
  assert.equal(backupHash.toLowerCase(), originalHash.toLowerCase());
  report.backupHash = backupHash;
  await closeOwnedInstance();
  assert.equal((await call("instances")).count, 0);

  const reopened = await call("launch", { caseRef, mode: "einurvor" }, 180_000);
  instance = { hwnd: reopened.instance.hwnd, pid: reopened.pid };
  await call("goto", { hwnd: instance.hwnd, name: overviewHeading, useSearch: true, maxSteps: 100 });
  assert.deepEqual((await call("positions", { hwnd: instance.hwnd })).positionen, names);
  assert.equal((await call("case_hash", { ref: caseRef })).sha256, savedHash);
  await closeOwnedInstance();
  assert.equal((await call("instances")).count, 0);
  assert.equal((await call("case_hash", { ref: caseRef })).sha256, savedHash);
  report.finalDiskHash = createHash("sha256").update(readFileSync(join(process.env.SSE_TEST_CASE_DIR, caseName))).digest("hex");
  assert.equal(report.finalDiskHash, savedHash.toLowerCase());
} catch (error) {
  primaryFailure = error;
} finally {
  if (instance && !closeAttempted) {
    try { await closeOwnedInstance(); }
    catch (cleanupError) {
      primaryFailure = primaryFailure
        ? new AggregateError([primaryFailure, cleanupError], "Income-position journey and owned cleanup failed.")
        : cleanupError;
    }
  }
  report.finishedAt = new Date().toISOString();
  report.outcome = primaryFailure ? "failed" : "passed";
  report.ownerUnresolved = Boolean(instance);
  report.failure = primaryFailure ? String(primaryFailure.stack ?? primaryFailure) : null;
  report.failureDetails = primaryFailure instanceof AggregateError
    ? primaryFailure.errors.map(error => String(error.stack ?? error)) : [];
  persist();
}
if (primaryFailure) throw primaryFailure;
process.stdout.write(`Live income positions: first and further position, inventory, save/reopen passed (${calls} API calls).\n`);
