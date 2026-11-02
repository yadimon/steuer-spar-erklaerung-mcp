import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeQtNativeOperation, isQtNativeOperation } from "../dist/qt-native-executor.js";
import { classificationOptionsFingerprint } from "../dist/qt-native-classification-projection.js";
import { fixture, policy } from "./qt-native-classification-fixture.mjs";
import { receiptList } from "../dist/qt-native-receipts.js";
import { readQtNativeSnapshot, validateQtReceiptTableProof } from "../dist/qt-native-snapshot.js";
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
const cropped = fixture({ detailHidesColumns: true });
assert.equal((await cropped.read()).ok, true,
  "Opening receipt details must not replace the full model binding with a cropped viewport.");

const gridNode = (type, name, aid, i, rid = `42.84.4.${i + 1}`) => ({
  i, p: -1, d: 0, type, name, aid, rid, x: 10, y: 100, w: 100, h: 20,
  on: true, val: null, ro: null, checked: null, selected: null, scroll: null,
});
const tableAid = "receipt" + policy.list.tableAutomationIdSuffix;
const modelProof = { tableAid, tableRid: "42.84.4.1", rowCount: 1, columnCount: 9,
  complete: true, canFetchMore: false, incompleteReason: null, headers: Array(9).fill(""),
  hiddenColumns: [8], hiddenRows: [], rows: [{ row: 0,
    names: ["", "", "Synthetic receipt", "", "", "", "", "", "HIDDEN-DOC"],
    rids: Array.from({ length: 9 }, (_, i) => `42.84.4.${100 + i}`) }] };
const viewport = [gridNode("Table", "", tableAid, 0),
  gridNode("Text", "MEINE BELEGE (1)", "receipt" + policy.list.countLabelAutomationIdSuffixes[0], 1),
  gridNode("DataItem", "Synthetic receipt", tableAid, 2, modelProof.rows[0].rids[2])];
const completeList = receiptList(viewport, policy, modelProof);
assert(!("error" in completeList)); assert.equal(completeList.rowsComplete, true);
assert.equal(completeList.rows[0].documentNumber, "HIDDEN-DOC");
assert.equal(completeList.rows[0].cells.length, 9);
const leadingMetadata = structuredClone(modelProof); leadingMetadata.rows[0].names[0] = "Hidden metadata*";
leadingMetadata.hiddenColumns.push(0);
const withMetadata = receiptList(viewport, policy, leadingMetadata);
assert.equal(withMetadata.rows[0].primaryText, "Synthetic receipt");
assert.equal(withMetadata.rows[0].rowRid, modelProof.rows[0].rids[2]);
assert.equal(withMetadata.rows[0].draft, false, "Hidden metadata cannot turn a receipt into a draft");
const changedHidden = structuredClone(modelProof); changedHidden.rows[0].names[8] = "CHANGED-DOC";
assert.notEqual(receiptList(viewport, policy, changedHidden).listFingerprint, completeList.listFingerprint,
  "A hidden model value must remain part of the stale-write guard");
for (const proof of [null, undefined, { ...modelProof, tableRid: "42.84.4.999" }, { ...modelProof, tableAid: tableAid + "other" }])
  assert.equal(receiptList(viewport, policy, proof).error.kind, "native-contract");
assert.equal(receiptList(viewport.map(node => node.type === "DataItem" ? { ...node, name: "Foreign value" } : node),
  policy, modelProof).error.kind, "native-contract");
for (const change of [proof => proof.rows[0].rids[1] = proof.rows[0].rids[0],
  proof => proof.rows[0].rids[0] = proof.tableRid,
  proof => proof.rows[0].row = 1, proof => proof.rows[0].names.pop(), proof => proof.headers.pop(),
  proof => proof.canFetchMore = true, proof => proof.hiddenColumns = [8, 8],
  proof => proof.hiddenRows = [1], proof => proof.columnCount = 65]) {
  const proof = structuredClone(modelProof); change(proof);
  assert.throws(() => validateQtReceiptTableProof(proof), /incomplete or contradictory/u);
}
const incompleteProof = { ...modelProof, complete: false, canFetchMore: true, incompleteReason: "model-can-fetch-more", rows: [] };
const missingColumn = structuredClone(modelProof);
missingColumn.columnCount = 8; missingColumn.headers.pop(); missingColumn.hiddenColumns = [];
missingColumn.rows[0].names.pop(); missingColumn.rows[0].rids.pop();
assert.equal(receiptList(viewport, policy, missingColumn).error.kind, "profile-contract");
assert.equal(receiptList(viewport, policy, incompleteProof).rowsComplete, false);
assert.equal(receiptList(viewport, policy, { ...modelProof, hiddenRows: [0] }).rowsComplete, false);
const snapshotResponse = { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 84,
  windowEnabled: true, modalBlocked: false, nodes: viewport, exactMatches: {}, windowRect: { x: 0, y: 0, w: 900, h: 600 },
  stats: { n: viewport.length, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
    valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 } };
const snapshotClient = result => ({ binding: { hwnd: 84 }, request: async () => ({ durationMs: 1, result }) });
await assert.rejects(readQtNativeSnapshot(snapshotClient(snapshotResponse), { toolTitle: policy.title }, 5000, undefined,
  { tableProofAidSuffix: policy.list.tableAutomationIdSuffix }), /rebuild or update/u);
await assert.rejects(readQtNativeSnapshot(snapshotClient({ ...snapshotResponse, tableProof: modelProof }), {}, 5000), /unrequested/u);
assert.deepEqual((await readQtNativeSnapshot(snapshotClient({ ...snapshotResponse, tableProof: modelProof }),
  { toolTitle: policy.title }, 5000, undefined, { tableProofAidSuffix: policy.list.tableAutomationIdSuffix })).tableProof, modelProof);
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
