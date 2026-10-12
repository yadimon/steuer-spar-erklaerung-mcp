/**
 * Opt-in live journey: two own income positions in a newly created synthetic
 * next-year case, with save/reopen and exact inventory readback. Run under
 * test/with-api.mjs; no existing case or manufacturer sample is used.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
let instance;
let calls = 0;

async function call(operation, args = {}, timeoutMs = 120_000) {
  const result = (await callApiOperationEnvelope(operation, args, timeoutMs, client)).result;
  calls++;
  if (["case_create", "launch"].includes(operation) && Number.isInteger(result.pid) && result.pid > 0 &&
      result.processStillRunning !== false) {
    instance = { pid: result.pid, hwnd: result.hwnd ?? result.instance?.hwnd };
  }
  assert.equal(result.ok, true, `${operation}: ${JSON.stringify(result)}`);
  return result;
}

try {
  assert.equal((await call("instances")).count, 0, "An existing SSE instance prevents the live journey.");
  assert.equal((await call("desktop_status")).aktiv, false);
  assert(!existsSync(join(process.env.SSE_TEST_CASE_DIR, caseName)), "A fresh case is required.");
  const created = await call("case_create", { targetRef: caseRef, mode: "einurvor" }, 300_000);
  instance = { hwnd: created.hwnd, pid: created.pid };
  const originalHash = (await call("case_hash", { ref: caseRef })).sha256;
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
  }

  await call("save", { hwnd: instance.hwnd, caseRef, expectedHashBefore: originalHash });
  const savedHash = (await call("case_hash", { ref: caseRef })).sha256;
  assert.notEqual(savedHash, originalHash, "Saving the two positions must change the file.");
  const backups = await call("workspace_file_list", { ref: "backups:.", includeHashes: true });
  assert.equal(backups.files.find(file => file.ref === backupRef)?.sha256, originalHash);
  await call("close", { ...instance, discardChanges: true });
  instance = undefined;
  assert.equal((await call("instances")).count, 0);

  const reopened = await call("launch", { caseRef, mode: "einurvor" }, 180_000);
  instance = { hwnd: reopened.instance.hwnd, pid: reopened.pid };
  await call("goto", { hwnd: instance.hwnd, name: overviewHeading, useSearch: true, maxSteps: 100 });
  assert.deepEqual((await call("positions", { hwnd: instance.hwnd })).positionen, names);
  assert.equal((await call("case_hash", { ref: caseRef })).sha256, savedHash);
  await call("close", { ...instance, discardChanges: true });
  instance = undefined;
  assert.equal((await call("instances")).count, 0);
  assert.equal((await call("case_hash", { ref: caseRef })).sha256, savedHash);
} finally {
  if (instance) {
    await call("close", { ...instance, discardChanges: true, force: true });
  }
}
process.stdout.write(`Live income positions: first and further position, inventory, save/reopen passed (${calls} API calls).\n`);
