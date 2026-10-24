/** Opt-in synthetic income table journey; run under test/with-api.mjs. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { callApiOperationEnvelope, readApiHealthz } from "../dist/api-client.js";

assert(process.env.SSE_API_URL && process.env.SSE_TEST_CASE_DIR,
  "The income journey requires an isolated test API.");
const modelRead = process.argv.includes("--model-read");
assert(!modelRead || process.env.SSE_TEST_NATIVE_PACKAGE, "Model reads require the native test runtime.");
const rowCount = Number(process.argv.find(arg => arg.startsWith("--rows="))?.slice(7) ?? 60);
assert(Number.isInteger(rowCount) && rowCount >= 8 && rowCount <= 100);
const client = { baseUrl: process.env.SSE_API_URL };
const apiIdentity = await readApiHealthz(client);
client.expectedInstanceId = apiIdentity.instanceId;
const caseName = "synthetic-income-table.GewErfass2026";
const caseRef = `cases:${caseName}`;
const backupRef = "backups:synthetic-income-table-before.GewErfass2026";
const positionName = "Synthetic commissions";
const heading = `Einnahmen: ${positionName}`;
const headers = ["Nr.", "Datum", "Bezeichnung", "Betrag", "N", "Netto"];
let instance, originalHash, primaryFailure, calls = 0;
let closeAttempted = false;
const expectedRows = [];
const reportPath = join(process.env.SSE_TEST_CASE_DIR, "income-table-report.json");
assert(!existsSync(reportPath), "A fresh income-table report is required.");
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), outcome: "running", modelRead, rowCount,
  apiIdentity, nodeVersion: process.version, nativeManifestSha256: process.env.SSE_TEST_NATIVE_MANIFEST_SHA256 ?? null,
  calls: [], closes: [], expectedRows,
  sourceFiles: Object.fromEntries(["../dist/qt-native-snapshot.js", "../powershell/sse-worker.ps1", "../powershell/sse-native.dll"]
    .map(file => [file, createHash("sha256").update(readFileSync(new URL(file, import.meta.url))).digest("hex")])) };
function persist() { writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); }
persist();
const euros = cents => {
  assert(Number.isSafeInteger(cents) && cents >= 0);
  return `${String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${String(cents % 100).padStart(2, "0")}`;
};
const cents = value => {
  assert.match(value, /^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/u);
  const [whole, fraction] = value.replaceAll(".", "").split(",");
  return Number(whole) * 100 + Number(fraction);
};
const total = () => expectedRows.reduce((sum, row) => sum + row.net, 0);

async function call(operation, args = {}, timeoutMs = 120_000, expectedOk = true) {
  const started = performance.now();
  const result = (await callApiOperationEnvelope(operation, args, timeoutMs, client)).result;
  report.calls.push({ sequence: ++calls, operation, args, result, elapsedMs: performance.now() - started });
  persist();
  if (["case_create", "launch"].includes(operation) && Number.isInteger(result.pid) && result.pid > 0 &&
      result.processStillRunning !== false) {
    instance = { pid: result.pid, hwnd: result.hwnd ?? result.instance?.hwnd };
    closeAttempted = false;
  }
  process.stdout.write(`${calls}: ${operation}: ${result.ok ? "ok" : result.kind}\n`);
  assert.equal(result.ok, expectedOk, `${operation}: ${JSON.stringify(result)}`);
  return result;
}
async function closeOwnedInstance() {
  assert(instance && Number.isInteger(instance.pid) && instance.pid > 0, "An owned process is required for close.");
  assert.equal(closeAttempted, false, "An uncertain close must not be replayed.");
  closeAttempted = true;
  const closed = await call("close", { ...instance, discardChanges: true });
  assert.equal(closed.stillRunning, false, "The owned table-test process must exit normally.");
  assert.notEqual(closed.killed, true, "The table journey must not force termination.");
  report.closes.push({ ...instance, stillRunning: closed.stillRunning, killed: closed.killed === true });
  instance = undefined;
  persist();
}
const tableArgs = () => ({ hwnd: instance.hwnd, sumLabel: "Summe der Einnahmen (netto)", sumOccurrence: 1 });
async function assertTable() {
  const table = await call("table_read", { ...tableArgs(), noKeys: modelRead, maxRows: 200 }, 180_000);
  assert.equal(table.vollstaendig, true, `Visible rows alone cannot prove the inventory: ${JSON.stringify(table)}`);
  assert.deepEqual(table.kopf, headers);
  assert.equal(cents(table.summe), total());
  assert.equal(table.rowDetails?.length, expectedRows.length, "Every row requires typed readback.");
  assert.deepEqual(table.zeilen.map((row, index) => {
    assert.equal(row.length, headers.length);
    const details = table.rowDetails[index];
    assert.equal(details.semanticsComplete, true);
    assert.equal(details.cellTypes[4], "boolean");
    assert.equal(details.checkboxStates[4], expectedRows[index].amountIsNet ? "On" : "Off");
    return { date: row[1], name: row[2], amount: cents(row[3]), net: cents(row[5]), amountIsNet: details.typedValues[4] };
  }), expectedRows);
  return table;
}
async function assertBackup() {
  const files = await call("workspace_file_list", { ref: "backups:.", includeHashes: true });
  const hash = files.files.find(file => file.ref === backupRef)?.sha256;
  assert.match(hash, /^[a-f0-9]{64}$/iu);
  assert.equal(hash.toLowerCase(), originalHash.toLowerCase());
  report.backupHash = hash;
}

try {
  assert.equal((await call("instances")).count, 0);
  assert.equal((await call("desktop_status")).aktiv, false);
  const created = await call("case_create", { targetRef: caseRef, mode: "einurvor" }, 300_000);
  instance = { hwnd: created.hwnd, pid: created.pid };
  originalHash = (await call("case_hash", { ref: caseRef })).sha256;
  report.initialDiskHash = originalHash;
  assert.equal(originalHash, created.sha256);
  assert.equal((await call("make_working_copy", {
    sourceRef: caseRef, targetRef: backupRef, expectedSourceHash: originalHash,
  })).verified, true);
  const binding = { hwnd: instance.hwnd, expectedCaseRef: caseRef, expectedCaseHash: originalHash };
  await call("fill_fields", { ...binding, pageId: "gew_erfass.allgemeine_angaben_unternehmen", fields: [
    { fieldId: "name_unternehmer", expectedBefore: "", value: "Muster", expectedAfter: "Muster" },
    { fieldId: "vorname_unternehmer", expectedBefore: "", value: "Test", expectedAfter: "Test" },
  ] }, 180_000);
  await call("combo_select", { ...binding, expectedPage: "Allgemeine Angaben zum Unternehmen",
    aid: ".AngabenUnternehmen.GruppeNichtInModusKonsUSt.Einkunftsart.Combobox",
    expectedCurrent: "", value: "Gewerbebetrieb", expectedAfter: "Gewerbebetrieb" });
  await call("goto", { hwnd: instance.hwnd, pageId: "gew_erfass.einnahmen_ausgaben" });
  await call("goto", { hwnd: instance.hwnd, name: "Erlöse Lieferungen/Leistungen", useSearch: true, maxSteps: 100 });
  assert.deepEqual((await call("positions", { hwnd: instance.hwnd })).positionen, []);
  const position = await call("position_create", { ...binding, backupRef, name: positionName, expectedPositions: [] });
  assert.equal(position.verified, true);
  assert.equal(position.page, heading);
  await assertTable();

  for (let index = 0; index < rowCount; index++) {
    const row = {
      date: `${String(index % 28 + 1).padStart(2, "0")}.${String(Math.floor(index / 28) + 1).padStart(2, "0")}`,
      name: `Synthetic commission ${String(index + 1).padStart(3, "0")}`,
      amount: index % 2 ? 10000 + 100 * index : 11900 + 119 * index,
      net: 10000 + 100 * index, amountIsNet: index % 2 === 1,
    };
    if (index === 2) { row.amount = 11901; row.net = 10001; }
    const before = total();
    const added = await call("table_add", { ...tableArgs(), expectedPage: heading,
      werte: ["", row.date, row.name, euros(row.amount), String(row.amountIsNet), ""],
      expectedBefore: euros(before), expectedAfter: euros(before + row.net) }, 180_000);
    assert.equal(added.verified, true);
    assert.equal(added.zellen.find(cell => cell.spalte === 4)?.ist, String(row.amountIsNet));
    expectedRows.push(row);
    await assertTable();
  }

  const last = expectedRows.at(-1);
  const changedNet = last.net + 500;
  const changedIsNet = !last.amountIsNet;
  const changedAmount = changedIsNet ? changedNet : Math.round(changedNet * 119 / 100);
  const updateArgs = { ...tableArgs(), expectedPage: heading, text: last.name,
    werte: [null, null, `${last.name} corrected`, euros(changedAmount), String(changedIsNet), null],
    expectedBefore: euros(total()) };
  const rolledBack = await call("table_update", { ...updateArgs, expectedAfter: euros(total() + 1) }, 180_000, false);
  assert.equal(rolledBack.kind, "postcondition-failed", JSON.stringify(rolledBack));
  assert.equal(rolledBack.rollback?.versucht, true);
  assert.equal(rolledBack.rollback?.erfolgreich, true);
  await assertTable();
  assert.equal((await call("table_update", { ...updateArgs, expectedAfter: euros(total() + 500) }, 180_000)).verified, true);
  last.name += " corrected"; last.amount = changedAmount; last.net = changedNet; last.amountIsNet = changedIsNet;
  await assertTable();

  const first = expectedRows[0];
  const visible = await call("read_table", { hwnd: instance.hwnd });
  assert.equal(visible.incomplete, false, "Deletion visibility needs a complete viewport snapshot.");
  assert.deepEqual(visible.headers, headers);
  report.deletionTargetVisible = visible.rows.some(row => row[2] === first.name);
  assert.equal(report.deletionTargetVisible, false, "The deletion target must actually be off-screen; use more rows for this viewport.");
  assert.equal((await call("table_delete", { ...tableArgs(), expectedPage: heading, text: first.name,
    expectedBefore: euros(total()), expectedAfter: euros(total() - first.net) }, 180_000)).verified, true);
  expectedRows.shift();
  await assertTable();
  assert.equal((await call("ui_state", { hwnd: instance.hwnd })).ungespeichert, true);
  assert.equal((await call("save", { hwnd: instance.hwnd, caseRef, expectedHashBefore: originalHash })).verified, true);
  const savedHash = (await call("case_hash", { ref: caseRef })).sha256;
  report.savedDiskHash = savedHash;
  assert.notEqual(savedHash, originalHash);
  assert.equal((await call("ui_state", { hwnd: instance.hwnd })).ungespeichert, false);
  await assertBackup();
  await closeOwnedInstance();
  assert.equal((await call("instances")).count, 0);

  const reopened = await call("launch", { caseRef, mode: "einurvor" }, 180_000);
  instance = { hwnd: reopened.instance.hwnd, pid: reopened.pid };
  await call("goto", { hwnd: instance.hwnd, name: heading, useSearch: true, maxSteps: 100 });
  await assertTable();
  assert.equal((await call("case_hash", { ref: caseRef })).sha256, savedHash);
  await assertBackup();
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
        ? new AggregateError([primaryFailure, cleanupError], "Income-table journey and owned cleanup failed.")
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
process.stdout.write(`Synthetic income table: ${rowCount} additions, rollback, update, offscreen deletion and persistence passed (${calls} API calls).\n`);
