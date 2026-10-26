import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { normalizeUiaTableDeleteResult } from "../dist/table-uia-delete-result.js";
import { parseApiOperationResult } from "../dist/result-contract.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-grid-api-"));
const calls = [];
let nativeCalls = 0;
const observation = { ok: true, kopf: ["Text"], zeilen: [[""]], anzahl: 1,
  vollstaendig: true, steps: 0, physicalInputUsed: false,
  gridRead: { method: "uia-grid", consistency: "two-equal-observations", atomic: false,
    modelRows: 1, readModelRows: 1, modelColumns: 1, visibleColumns: [0], rowFilter: "none", inputSlotsIncluded: true } };
const config = {
  host: "127.0.0.1", port: 1, configPath: join(temporary, "config.json"),
  workspaceDir: join(temporary, "workspace"), resultDir: join(temporary, "results"),
  documentsDir: join(temporary, "documents"), backupsDir: join(temporary, "backups"), caseDir: join(temporary, "cases"),
};
const execute = createApiExecutor(config, async (operation, args) => {
  calls.push({ operation, args });
  return observation;
}, { qtNativeClientFor: async () => { nativeCalls++; throw new Error("Grid mode must never select the native client."); } });

try {
  const first = await execute("table_read", { hwnd: 42, readMode: "grid", sumLabel: "Summe" });
  assert.equal(first.ok, true);
  assert.deepEqual(first.gridRead, observation.gridRead);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "table_read");
  assert.equal(calls[0].args.readMode, "grid");
  assert.equal(calls[0].args.noKeys, undefined);
  assert.equal(nativeCalls, 0);

  assert.equal((await execute("table_read", { hwnd: 42, readMode: "grid", noKeys: true })).ok, true);
  assert.equal(calls.length, 2);
  assert.equal(nativeCalls, 0);

  const invalid = await execute("table_read", { hwnd: 42, readMode: "grid", noKeys: false });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.kind, "bad-args");
  assert.equal(calls.length, 2, "Conflicting read strategies must fail before any provider dispatch.");
  assert.equal(nativeCalls, 0);

  Object.assign(observation, { ok: false, kind: "grid-read-unavailable", error: "Provider ended." });
  const failed = await execute("table_read", { hwnd: 42, readMode: "grid" });
  assert.equal(failed.ok, false);
  assert.equal(failed.kind, "grid-read-unavailable");
  assert.equal(calls.length, 3, "A failed Grid read must never dispatch a second backend or cursor attempt.");
  assert.equal(nativeCalls, 0);
  const deleteArgs = { hwnd: 42, expectedPage: "Synthetic page", text: "Duplicate", sumLabel: "Summe", expectedBefore: "100,00", expectedAfter: "90,00" };
  const proof = { schemaVersion: 1, method: "uia-grid-logical-model", outcome: "deleted-exact",
    removedRow: 1, rowsBefore: 3, rowsAfter: 2, beforeFingerprint: "a".repeat(64), afterFingerprint: "b".repeat(64),
    inputEpoch: 123, dirtyBefore: false, dirtyAfter: true, dirtyAfterDelete: true };
  const deleted = { ok: true, verified: true, mutationStarted: true, outcomeUnknown: false, resultingState: "changed",
    geloescht: true, nochVorhanden: false, before: "100,00", after: "90,00", mutationPostProof: proof };
  assert.equal(normalizeUiaTableDeleteResult(deleteArgs, deleted).ok, true);
  assert.equal(Object.hasOwn(normalizeUiaTableDeleteResult(deleteArgs, deleted), "mutationPostProof"), false);
  const zeroArgs = { ...deleteArgs, expectedBefore: "0,00", expectedAfter: "0,00" };
  assert.equal(normalizeUiaTableDeleteResult(zeroArgs, { ...deleted, before: "0,00", after: "0,00" }).ok, true,
    "A zero-value deletion still requires and accepts exactly one removed row.");
  const unchanged = { ...deleted, ok: false, kind: "delete-ineffective", verified: false, resultingState: "unchanged",
    geloescht: false, nochVorhanden: true, after: "100,00", mutationPostProof: { ...proof, outcome: "unchanged", rowsAfter: 3,
      afterFingerprint: proof.beforeFingerprint, dirtyAfter: false } };
  const knownUnchanged = normalizeUiaTableDeleteResult(deleteArgs, unchanged);
  assert.equal(knownUnchanged.outcomeUnknown, true); assert.equal(knownUnchanged.resultingState, "unknown");
  assert.equal(knownUnchanged.geloescht, null); assert.equal(knownUnchanged.nochVorhanden, null);
  const restored = { ...unchanged, resultingState: "restored", kind: "postcondition-failed", error: "Erwartete Nachsumme abweichend; Werte wiederhergestellt.", after: "90,00",
    rolledBack: true, rollbackAttempted: true, rollbackValue: "100,00", ungespeichertVorher: false, ungespeichertNachher: false, dirtyStateUnchanged: true,
    mutationPostProof: { ...unchanged.mutationPostProof, outcome: "restored" } };
  assert.equal(normalizeUiaTableDeleteResult({ ...deleteArgs, expectedAfter: "80,00" }, restored).rolledBack, true);
  const restoredDirty = { ...restored, ungespeichertNachher: true, dirtyStateUnchanged: false,
    mutationPostProof: { ...restored.mutationPostProof, dirtyAfter: true } };
  const knownDirtyRestore = normalizeUiaTableDeleteResult({ ...deleteArgs, expectedAfter: "80,00" }, restoredDirty);
  assert.equal(knownDirtyRestore.rolledBack, true); assert.equal(knownDirtyRestore.outcomeUnknown, false);
  assert.equal(knownDirtyRestore.ungespeichertNachher, true); assert.equal(knownDirtyRestore.dirtyStateUnchanged, false);
  assert.deepEqual(parseApiOperationResult("table_delete", knownDirtyRestore), knownDirtyRestore,
    "Known restored dirty-state fields must survive the published result schema.");
  for (const field of ["ungespeichertVorher", "ungespeichertNachher", "dirtyStateUnchanged"]) {
    assert.throws(() => parseApiOperationResult("table_delete", { ...knownDirtyRestore, [field]: "true" }),
      "Dirty-state result fields must be typed booleans in the public schema.");
  }
  const unknownDirtyRestore = normalizeUiaTableDeleteResult(deleteArgs, { ...restoredDirty, ungespeichertNachher: false });
  assert.deepEqual(parseApiOperationResult("table_delete", unknownDirtyRestore), unknownDirtyRestore,
    "Unknown outcome and null dirty-state fields must survive the actual public result schema.");
  for (const field of ["ungespeichertVorher", "ungespeichertNachher", "dirtyStateUnchanged", "rolledBack", "geloescht", "nochVorhanden"]) {
    assert.equal(unknownDirtyRestore[field], null);
  }
  const malformed = [
    { ...deleted, mutationPostProof: undefined }, { ...deleted, mutationPostProof: { ...proof, nativeVerificationPending: true } },
    { ...deleted, mutationPostProof: { ...proof, removedRow: 3 } }, { ...deleted, mutationPostProof: { ...proof, rowsAfter: 3 } },
    { ...deleted, mutationPostProof: { ...proof, afterFingerprint: proof.beforeFingerprint } },
    { ...deleted, after: "80,00" }, { ...deleted, before: "80,00" }, { ...deleted, outcomeUnknown: true },
    { ...unchanged, mutationPostProof: { ...unchanged.mutationPostProof, dirtyAfter: true } },
    { ...restored, mutationPostProof: { ...restored.mutationPostProof, afterFingerprint: "b".repeat(64) } },
    { ...restored, rollbackValue: "90,00" }, { ...restored, rollbackAttempted: false },
    { ok: false, kind: "postcondition-failed", mutationStarted: true, geloescht: false, nochVorhanden: true, rolledBack: true },
    { ok: false, kind: "interference" }, { ok: true, verified: true, geloescht: true, nochVorhanden: false },
    { ...deleted, mutationPostProof: { ...proof, dirtyAfterDelete: undefined } },
    { ...deleted, mutationPostProof: { ...proof, dirtyAfterDelete: false } },
    { ...restoredDirty, mutationPostProof: { ...restoredDirty.mutationPostProof, dirtyAfterDelete: false } },
    { ...restoredDirty, ungespeichertNachher: false }, { ...restoredDirty, dirtyStateUnchanged: true },
    { ...restored, ungespeichertVorher: true, dirtyStateUnchanged: false,
      mutationPostProof: { ...restored.mutationPostProof, dirtyBefore: true } },
    { ...deleted, rolledBack: true }, { ...deleted, rollbackAttempted: true },
    { ...deleted, ungespeichertVorher: true }, { ...deleted, ungespeichertNachher: false }, { ...deleted, dirtyStateUnchanged: true },
    { ...deleted, before: ["100,00"] }, { ...deleted, after: ["90,00"] },
    { ...restored, after: "not-an-amount" }, restored,
  ];
  for (const reply of malformed) {
    const failure = normalizeUiaTableDeleteResult(deleteArgs, reply);
    assert.equal(failure.ok, false); assert.equal(failure.outcomeUnknown, true); assert.equal(failure.reconciliationRequired, true);
    assert.equal(failure.resultingState, "unknown"); assert.equal(failure.geloescht, null); assert.equal(failure.nochVorhanden, null);
    assert.equal(failure.retryable, false); assert.equal(Object.hasOwn(failure, "mutationPostProof"), false);
    if (Object.hasOwn(reply, "rolledBack")) assert.equal(failure.rolledBack, null);
  }
  const early = { ok: false, kind: "stale", mutationStarted: false, outcomeUnknown: false, resultingState: "unchanged" };
  assert.equal(normalizeUiaTableDeleteResult(deleteArgs, early).outcomeUnknown, false);
  assert.equal(normalizeUiaTableDeleteResult(deleteArgs, { ...early, outcomeUnknown: undefined }).outcomeUnknown, true);
  let deleteCalls = 0, workerReply = deleted;
  const legacyExecute = createApiExecutor(config, async (operation) => { assert.equal(operation, "table_delete"); deleteCalls++; return workerReply; });
  assert.equal((await legacyExecute("table_delete", deleteArgs)).ok, true);
  workerReply = malformed[12];
  const realBoundary = await legacyExecute("table_delete", deleteArgs);
  assert.equal(realBoundary.ok, false); assert.equal(realBoundary.outcomeUnknown, true); assert.equal(realBoundary.rolledBack, null);
  assert.equal(realBoundary.geloescht, null); assert.equal(realBoundary.nochVorhanden, null); assert.equal(deleteCalls, 2);
  console.log("Grid API: explicit read routing, no fallback and strict full-model UIA delete result boundaries passed");
} finally {
  assert.equal(dirname(resolve(temporary)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  rmSync(temporary, { recursive: true, force: true });
}
