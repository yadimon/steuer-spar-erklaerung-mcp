import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeQtNativeOperation, isQtNativeOperation } from "../dist/qt-native-executor.js";
import { classificationOptionsFingerprint } from "../dist/qt-native-classification-projection.js";
import { fixture, policy } from "./qt-native-classification-fixture.mjs";
const oracleCases = [[], [{ index: 0, name: "äÖß Україна 🚀 <>&'", selected: true }],
  [{ index: 0, name: "A", selected: false }, { index: 1, name: "Ω\nLine", selected: true }]];
const oracleDirectory = mkdtempSync(join(tmpdir(), "sse-options-oracle-"));
try {
  const input = join(oracleDirectory, "input.json"), output = join(oracleDirectory, "output.json");
  writeFileSync(input, JSON.stringify(oracleCases));
  const oracle = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    fileURLToPath(new URL("./qt-native-classification-options-oracle.ps1", import.meta.url)), "-InputPath", input, "-OutputPath", output],
    { windowsHide: true, encoding: "utf8", timeout: 60_000 });
  assert.equal(oracle.status, 0, oracle.stderr);
  assert.deepEqual(oracleCases.map(classificationOptionsFingerprint), JSON.parse(readFileSync(output, "utf8")));
} finally { rmSync(oracleDirectory, { recursive: true, force: true }); }

// A transport fixture exercises transaction failures. Real Qt/UIA grid equality
// and binary model states are independently covered by the native integration.
assert(isQtNativeOperation("receipt_manager_classification_options"));
for (const count of [0, 1, 40]) for (const kind of ["categories", "persons"]) {
  const test = fixture({ count, kind }), result = await test.read();
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.verified, true); assert.equal(result.options.length, count);
  assert.deepEqual(result.selected, count ? [`Option ${count - 1}`] : []);
  assert.equal(result.physicalInputUsed, false); assert.equal(result.dirtyStateUnchanged, true); assert.equal(result.dialogClosed, true);
  assert.deepEqual(test.actions.map(action => action.action), ["activate-table-cell", "press", "press", "press"]);
}
const already = fixture({ alreadyOpen: true }); assert.equal((await already.read()).ok, true);
assert.equal(already.actions.filter(action => action.action === "activate-table-cell").length, 0);
for (const guard of ["rowFingerprint", "expectedListFingerprint", "expectedDetailFingerprint"]) {
  const test = fixture(), result = await test.read({ [guard]: "A".repeat(64) }); assert.equal(result.ok, false);
  assert.equal(test.actions.filter(action => action.expectedName === policy.controls.classification.categories.chooserExpectedName).length, 0);
}
for (const option of ["incomplete", "duplicates", "unknownFingerprint", "fieldDrift", "otherRowDrift", "windowDrift", "dirtyDrift", "managerDrift"]) {
  const test = fixture({ [option]: true }), result = await test.read(); assert.equal(result.ok, false, option);
  assert.equal(test.actions.filter(action => action.expectedName === "Speichern").length, 0);
  assert(test.actions.filter(action => action.expectedName === "Abbrechen").length <= 1, "Never replay cancellation");
}
for (const lostAck of [policy.controls.classification.categories.chooserExpectedName, "Abbrechen"]) {
  const test = fixture({ lostAck }), result = await test.read(); assert.equal(result.ok, false); assert.equal(result.outcomeUnknown, true);
  assert.equal(test.actions.filter(action => action.expectedName === lostAck).length, 1);
  assert.equal(test.actions.filter(action => action.expectedName === policy.controls.detailClose.expectedName).length, 0);
}
console.log("PASS complete classification option transactions, worker hash parity and unreplayed failures");
