import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-grid-api-"));
const calls = [];
let nativeCalls = 0;
const observation = { ok: true, kopf: ["Text"], zeilen: [[""]], anzahl: 1,
  vollstaendig: true, steps: 0, physicalInputUsed: false,
  gridRead: { method: "uia-grid", consistency: "two-equal-observations", atomic: false,
    modelRows: 1, readModelRows: 1, modelColumns: 1, visibleColumns: [0], rowFilter: "none", inputSlotsIncluded: true } };
const execute = createApiExecutor({
  host: "127.0.0.1", port: 1, configPath: join(temporary, "config.json"),
  workspaceDir: join(temporary, "workspace"), resultDir: join(temporary, "results"),
  documentsDir: join(temporary, "documents"), backupsDir: join(temporary, "backups"), caseDir: join(temporary, "cases"),
}, async (operation, args) => {
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
  console.log("Grid API: explicit routing, no native dispatch, conflicting input rejected and no error fallback passed");
} finally {
  assert.equal(dirname(resolve(temporary)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  rmSync(temporary, { recursive: true, force: true });
}
