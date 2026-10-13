import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeTableCursorRead } from "../dist/table-cursor-executor.js";

// Synthetic broker/workers only. No desktop, API, transport or native process.
const copy = value => structuredClone(value);
const aid = "Synthetic.RedThreadContent.DialogUI./.grpEmpf13b./.grpEmpf13b.Empf13b";
const headers = ["Nr.", "Datum", "Bezeichnung", "Hidden1", "Hidden2", "Kategorie", "MwSt", "Netto"];
const cell = display => ({ display, edit: display, flags: 35, checkState: null });
const template = { ok: true, controllerBound: true, windowEnabled: true, modalBlocked: false,
  rows: 3, readRows: 3, columns: 8, headers,
  values: [["", "01.01", "Example", "", "", "Drittland", "19", "10,00"],
    ["", "02.01", "Example 2", "", "", "EU", "19", "20,00"],
    ["", "", "", "", "", "EU", "19", "0,00"]].map(row => row.map(cell)),
  rowFingerprints: ["1", "2", "3"].map(char => char.repeat(64)), hiddenColumns: [3, 4], hiddenRows: [],
  complete: true, canFetchMore: false, tableCount: 1,
  table: { id: 9, name: "/.grpEmpf13b.Empf13b", class: "DialogUITable", visible: true },
  summary: "30,00", binding: {}, summaries: [{ label: "Summe", vorkommen: 1, wert: "30,00" }],
  cursorFocusBinding: { tableId: 9, modelId: 10, tableName: "/.grpEmpf13b.Empf13b", tableAid: aid,
    currentIndex: [1, 0], selectedIndexes: [[1, 0]], modelFingerprint: "c".repeat(64) } };
const baseBinding = { hwnd: 111, pid: 7, inputEpoch: 123, dirty: true, dpi: 96, clientOrigin: [100, 200],
  windowTitle: "Synthetic case", windowFingerprint: "a".repeat(64), snapshot: {
    kopf: headers.filter((_, column) => ![3, 4].includes(column)), navigationBinding: {
      complete: true, editorFree: true, heading: "Synthetic", tableRootAid: aid, tableRootRid: "42.777.4.-20",
      contentSignature: "b".repeat(64), scopePrefix: "Synthetic.Scope", selectionMethod: "synthetic",
      summaryIdentity: "Synthetic.Sum", summaryValue: "30,00", summaryRid: "42.777.4.-21", summaryAid: "Synthetic.Sum",
      headers: headers.filter((_, column) => ![3, 4].includes(column)).map((name, column) => ({ name, aid: `${aid}.${column}`, rid: `42.777.4.-${30 + column}` })) } } };
const baseLease = { schemaVersion: 1, nonce: randomUUID(), rootHwnd: 111, targetPid: 7, inputEpoch: 123,
  previous: { hwnd: 222, pid: 8, start: "133000000000000001", class: "SyntheticCaller" }, previousCursor: { x: 10, y: 20 } };
function nativeGeometry(op, model, binding) {
  const node = (value, index) => ({ i: index, p: index ? 0 : -1, d: index ? 1 : 0, name: "", on: true,
    val: null, ro: null, checked: null, selected: null, scroll: null, ...value });
  const expected = binding.snapshot.navigationBinding;
  if (op === "objects") return { ok: true, complete: true, windowEnabled: true, modalBlocked: false, objects: [
    { id: model.table.id, parentId: 0, name: model.table.name, class: "DialogUITable", visible: true, enabled: true,
      rootRect: [0, 0, 600, 240], nativeScreenRect: [100, 200, 600, 240] },
    { id: 11, parentId: model.table.id, name: "qt_scrollarea_viewport", class: "QWidget", visible: true, enabled: true,
      rootRect: [4, 24, 592, 212], nativeScreenRect: [104, 224, 592, 212] },
  ] };
  const nodes = [node({ type: "Table", rid: expected.tableRootRid, aid: expected.tableRootAid, x: 100, y: 200, w: 600, h: 240 }, 0),
    ...expected.headers.map((header, column) => node({ ...header, type: "Header", x: 100 + 80 * column, y: 200, w: 80, h: 24 }, column + 1))];
  return { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 111, windowEnabled: true, modalBlocked: false, nodes,
    windowRect: { x: 100, y: 200, w: 800, h: 600 }, exactMatches: {}, stats: { n: nodes.length, err: 0, cyc: 0, cycleRid: "", cycleName: "",
      truncated: false, depthLimited: false, valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 } };
}

async function run(options = {}) {
  let model = copy(template), binding = copy(baseBinding), lease = copy(baseLease), selected = ["Synthetic.cell.1"];
  options.binding?.(binding);
  const phases = [], keys = [], focuses = [], releases = [], leases = [], consumed = new Set();
  const client = { binding: { hwnd: 111, pid: 7 }, request: async (op, args) => {
    if (op === "ping") return { result: { ok: true, pid: 7, hwnd: 111, recoveryRequired: false,
      mutationAcknowledgmentRequired: false, capabilities: { tableFocusOnlyProtocol: 1 } } };
    if (["objects", "accessibility_snapshot"].includes(op)) {
      const result = nativeGeometry(op, model, binding); options.geometry?.(result, op); return { result };
    }
    assert.equal(op, "table_snapshot");
    assert.equal(args.withCursorFocusBinding, true,
      "A private cursor transaction must explicitly request its unchanged focus/model binding.");
    const value = copy(model); options.model?.(value, keys.length, focuses.length);
    return { result: value };
  }, requestAcknowledged: async (op, args) => {
    assert.equal(op, "table_focus_only");
    focuses.push(copy(args)); assert.equal(args.expectedInputTick, binding.inputEpoch);
    assert.deepEqual(args.binding, model.cursorFocusBinding);
    const result = { ok: true, focused: true, physicalInputUsed: false, mutationAttempted: true,
      inputTick: binding.inputEpoch, binding: copy(model.cursorFocusBinding) };
    options.focus?.(result, focuses.length);
    return { result, receiptAcknowledged: !options.noAck };
  } };
  const worker = async (op, args, timeout, signal) => {
    assert.equal(op, "table_read"); const plan = args.__tableCursorPlan; phases.push(plan.phase);
    if (plan.phase === "prebind") return { ok: true, cursorBinding: copy(binding) };
    if (plan.phase === "native-acquire") {
      const acquired = { ok: true, cursorBinding: copy(binding), cursorLease: copy(lease), selectedRids: selected };
      options.acquire?.(acquired); return acquired;
    }
    if (plan.phase === "native-release") {
      assert.equal(timeout, 5000); assert.equal(signal, undefined);
      assert.equal(consumed.has(plan.lease.nonce), false, "A consumed nonce must never be imported for cleanup.");
      releases.push(plan.lease.nonce); return { ok: true, cursorLeaseReleased: true,
        focusTelemetry: { releasedByEmit: !options.releaseUnproven, foregroundRestored: !options.releaseUnproven } };
    }
    if (plan.phase === "checkpoint") return options.checkpointFails ? { ok: false } : { ok: true, cursorCheckpoint: true };
    assert.equal(plan.phase, "native-step", "The legacy resume must not reset HOME or rebuild progress.");
    assert.deepEqual(plan.binding, binding); assert.deepEqual(plan.lease, lease);
    assert.deepEqual(plan.selectedRids, selected);
    assert.equal(consumed.has(plan.lease.nonce), false); consumed.add(plan.lease.nonce);
    assert.equal(plan.step.parentLeaseNonce, plan.lease.nonce);
    assert.deepEqual(plan.step.currentIndex, model.cursorFocusBinding.currentIndex);
    assert.deepEqual(plan.step.numberModel, model.values.map(row => ({ display: row[0].display, edit: row[0].edit, flags: row[0].flags })));
    assert.equal(plan.step.sequence, keys.length); assert.equal(plan.step.key, keys.length === 0 ? "home" : "down");
    assert.deepEqual(plan.step.geometry, options.expectedGeometry ?? { coordinateSpace: "qt-native-screen",
      tableRect: [0, 0, 600, 240], viewportRect: [4, 24, 592, 212], nativeTableRect: [100, 200, 600, 240], nativeViewportRect: [104, 224, 592, 212] });
    if (options.resumeRejected) return { ok: false, kind: "cursor-proof-failed", steps: 0,
      physicalInputAttempted: false, physicalInputUsed: false, outcomeUnknown: false,
      cursorActivation: { subphase: "step-resume-proof" },
      cursorResumeProof: { sameSelection: false, liveInputOk: true, expectedSelectionCount: 1, observedSelectionCount: 1,
        expectedSelectionSignature: "a".repeat(64), observedSelectionSignature: "b".repeat(64),
        expectedCurrentIndex: [...plan.step.currentIndex], expectedNumberFlags: 35,
        liveInput: { reason: "exact-table-without-editor", editorClosed: true, focusedType: "DataItem" },
        numberCell: { ok: true, reason: "exact-current-grid-number-cell", row: plan.step.currentIndex[0], column: 0, rowFullyContained: true } },
      focusTelemetry: { releasedByEmit: true, foregroundRestored: true } };
    keys.push(plan.step.key); leases.push(lease.nonce);
    if (options.throwStep) throw new Error("Synthetic transport outcome unknown");
    if (options.workerFails && keys.length === options.workerFails) return { ok: false, kind: "interference", steps: 0,
      error: "Synthetic foreign epoch/non-Nr editor", focusTelemetry: { releasedByEmit: true } };
    const target = plan.step.expectedRow;
    model.cursorFocusBinding.currentIndex = [target, 0]; model.cursorFocusBinding.selectedIndexes = [[target, 0]];
    binding.inputEpoch++;
    binding.snapshot.navigationBinding.contentSignature = String(target + 1).repeat(64);
    lease = { ...lease, nonce: randomUUID(), inputEpoch: binding.inputEpoch }; selected = [`Synthetic.cell.${target}`];
    const stepped = { ok: true, steps: 1, cursorBinding: copy(binding), cursorLease: copy(lease), selectedRids: selected,
      cursorStep: { transactionNonce: plan.step.transactionNonce, stepNonce: plan.step.stepNonce,
        parentLeaseNonce: plan.step.parentLeaseNonce, sequence: plan.step.sequence, key: plan.step.key,
        modelFingerprint: plan.step.modelFingerprint, row: target, column: 0, rowFullyContained: !options.clippedLast } };
    options.step?.(stepped, keys.length, model); return stepped;
  };
  const result = await executeTableCursorRead({ hwnd: 111, noKeys: false, sumLabel: "Summe" }, worker, { qtNativeClient: client }, 30000);
  return { result, phases, keys, focuses, releases, leases };
}
const success = await run();
assert.equal(success.result.ok, true); assert.equal(success.result.vollstaendig, true);
assert.equal(success.result.lastRowFullyContained, true); assert.equal(success.result.steps, 3);
assert.deepEqual(success.keys, ["home", "down", "down"]);
assert.equal(success.focuses.length, 3); assert.equal(success.releases.length, 1);
assert.equal(success.result.zeilen.length, 3, "Complete model projection must preserve the final blank category row.");
for (const field of ["cursorBinding", "cursorLease", "cursorStep", "selectedRids", "transactionNonce", "stepNonce", "previous"]) {
  assert.equal(Object.hasOwn(success.result, field), false);
}
assert.equal(JSON.stringify(success.result).includes("SyntheticCaller"), false);
for (const geometry of [
  (result, op) => { if (op === "objects") result.objects[1].rootRect = [4, 24, 700, 212]; },
  (result, op) => { if (op === "objects") result.objects[1].parentId = 99; },
  (result, op) => { if (op === "accessibility_snapshot") result.nodes[0].rid = "42.777.4.-999"; },
  (result, op) => { if (op === "accessibility_snapshot") result.nodes[1].name = "Wrong header"; },
]) {
  const stopped = await run({ geometry }); assert.equal(stopped.result.ok, false);
  assert.deepEqual(stopped.keys, []); assert.deepEqual(stopped.focuses, []); assert.deepEqual(stopped.releases, []);
  assert.equal(stopped.phases.includes("native-acquire"), false, "Unbound native viewport must fail before acquiring focus authority.");
}
// The producer, not Windows DPI, binds Qt root coordinates to native screen
// pixels. An effective Qt scale may agree with or differ from Windows scaling.
const offsetGeometry = { coordinateSpace: "qt-native-screen", tableRect: [40, 80, 600, 240], viewportRect: [44, 104, 592, 212],
  nativeTableRect: [-1140, 190, 900, 360], nativeViewportRect: [-1134, 226, 888, 318] };
function offsetTransport(result, op) {
  if (op === "objects") {
    result.objects[0].rootRect = copy(offsetGeometry.tableRect); result.objects[1].rootRect = copy(offsetGeometry.viewportRect);
    result.objects[0].nativeScreenRect = copy(offsetGeometry.nativeTableRect); result.objects[1].nativeScreenRect = copy(offsetGeometry.nativeViewportRect);
  } else {
    Object.assign(result.nodes[0], { x: -1140, y: 190, w: 900, h: 360 });
    result.nodes.slice(1).forEach((header, column) => Object.assign(header, { x: -1140 + 120 * column, y: 190, w: 120, h: 36 }));
    result.windowRect = { x: -1200, y: 40, w: 1500, h: 1000 };
  }
}
const offsetOptions = { binding: value => { value.dpi = 144; value.clientOrigin = [-1200, 70]; },
  expectedGeometry: offsetGeometry, geometry: offsetTransport };
const offsetSuccess = await run(offsetOptions);
assert.equal(offsetSuccess.result.ok, true); assert.deepEqual(offsetSuccess.keys, ["home", "down", "down"]);
assert.equal(Object.hasOwn(offsetSuccess.result, "cursorActivation"), false, "Passing geometry must not claim an activation diagnostic.");
const roundedGeometry = await run({ ...offsetOptions, geometry: (result, op) => {
  offsetTransport(result, op); if (op === "accessibility_snapshot") { result.nodes[0].x++; result.nodes[0].w--; }
} });
assert.equal(roundedGeometry.result.ok, true, "The existing one-pixel native rounding bound must remain unchanged.");
const qtUnscaled = await run({ binding: value => { value.dpi = 120; } });
assert.equal(qtUnscaled.result.ok, true, "Windows 125% must not double-scale producer-verified Qt native pixels.");
assert.deepEqual(qtUnscaled.keys, ["home", "down", "down"]);
const mixedScale = await run({ ...offsetOptions, binding: value => { value.dpi = 120; value.clientOrigin = [-1200, 70]; } });
assert.equal(mixedScale.result.ok, true, "The same model must use its explicit Qt producer mapping on a mixed-scale screen.");
const fractional = await run({ binding: value => { value.dpi = 120; },
  expectedGeometry: { coordinateSpace: "qt-native-screen", tableRect: [0, 0, 600, 240], viewportRect: [4, 24, 592, 212],
    nativeTableRect: [100, 200, 600, 240], nativeViewportRect: [105, 225, 590, 210] },
  geometry: (result, op) => {
    if (op === "objects") {
      result.objects[0].nativeScreenRect = [100.5, 200.25, 600.75, 240.5];
      result.objects[1].nativeScreenRect = [104.25, 224.5, 591.5, 211.25];
    }
  } });
assert.equal(fractional.result.ok, true, "Fractional native pixels must conservatively contain the viewport and match accessible integer rounding.");
assert.deepEqual(fractional.keys, ["home", "down", "down"]);
const subpixelViewport = await run({ geometry: (result, op) => {
  if (op === "objects") result.objects[1].nativeScreenRect = [104.2, 224.2, 0.6, 0.6];
} });
assert.equal(subpixelViewport.result.ok, false); assert.deepEqual(subpixelViewport.keys, []); assert.deepEqual(subpixelViewport.focuses, []);
assert.equal(subpixelViewport.result.cursorActivation.nativeViewport.checks.nativeViewportPositiveBounds, false);
for (const [failedCheck, change] of [
  ["xMatch", (result, op) => { if (op === "accessibility_snapshot") result.nodes[0].x += 3; }],
  ["yMatch", (result, op) => { if (op === "accessibility_snapshot") result.nodes[0].y -= 3; }],
  ["widthMatch", (result, op) => { if (op === "accessibility_snapshot") result.nodes[0].w += 3; }],
  ["heightMatch", (result, op) => { if (op === "accessibility_snapshot") result.nodes[0].h -= 3; }],
  ["viewportLeftInside", (result, op) => { if (op === "objects") result.objects[1].rootRect[0] = 39; }],
  ["viewportTopInside", (result, op) => { if (op === "objects") result.objects[1].rootRect[1] = 79; }],
  ["viewportRightInside", (result, op) => { if (op === "objects") result.objects[1].rootRect[2] = 597; }],
  ["viewportBottomInside", (result, op) => { if (op === "objects") result.objects[1].rootRect[3] = 217; }],
  ["viewportPositiveBounds", (result, op) => { if (op === "objects") result.objects[1].rootRect[2] = 0; }],
  ["nativeViewportLeftInside", (result, op) => { if (op === "objects") result.objects[1].nativeScreenRect[0] = -1141; }],
  ["nativeViewportTopInside", (result, op) => { if (op === "objects") result.objects[1].nativeScreenRect[1] = 189; }],
  ["nativeViewportRightInside", (result, op) => { if (op === "objects") result.objects[1].nativeScreenRect[2] = 895; }],
  ["nativeViewportBottomInside", (result, op) => { if (op === "objects") result.objects[1].nativeScreenRect[3] = 325; }],
  ["nativeViewportPositiveBounds", (result, op) => { if (op === "objects") result.objects[1].nativeScreenRect[2] = 0; }],
]) {
  const stopped = await run({ ...offsetOptions, geometry: (result, op) => { offsetTransport(result, op); change(result, op); } });
  assert.equal(stopped.result.ok, false); assert.equal(stopped.result.proofCheck, "native-viewport-dpi-geometry");
  assert.equal(stopped.result.phase, "native-preproof", "A passive geometry rejection must not claim an acquisition phase.");
  assert.equal(stopped.result.activationSubmitted, false); assert.equal(stopped.result.physicalInputAttempted, false);
  assert.equal(stopped.result.outcomeUnknown, false); assert.equal(stopped.result.reconciliationRequired, false);
  assert.deepEqual(stopped.keys, []); assert.deepEqual(stopped.focuses, []); assert.deepEqual(stopped.releases, []);
  assert.deepEqual(stopped.phases, ["prebind"]);
  const activation = stopped.result.cursorActivation, evidence = activation.nativeViewport;
  assert.equal(activation.activationAttempted, false); assert.equal(activation.source, "qt-native");
  assert.equal(activation.subphase, "native-viewport-dpi-geometry");
  assert.deepEqual(evidence.expectedPhysicalRect, [-1140, 190, 900, 360]);
  assert.deepEqual(evidence.clientOrigin, [-1200, 70]); assert.equal(evidence.dpi, 144);
  assert.deepEqual(Object.entries(evidence.checks).filter(([, value]) => !value).map(([key]) => key), [failedCheck]);
  assert.deepEqual(Object.keys(evidence).sort(), ["accessibleTableRect", "checks", "clientOrigin", "dpi", "expectedPhysicalRect",
    "nativeTableRect", "nativeViewportRect", "tableRect", "viewportRect"]);
  for (const forbidden of ["windowTitle", "tableAid", "rid", "nonce", "model", "inputEpoch", "Synthetic case", "Example", "30,00"]) {
    assert.equal(JSON.stringify(evidence).includes(forbidden), false, "Geometry rejection must not leak UI values or private cursor authority.");
  }
}
for (const change of [
  value => { delete value.objects[0].nativeScreenRect; }, value => { delete value.objects[1].nativeScreenRect; },
  value => { value.objects[0].nativeScreenRect = null; }, value => { value.objects[1].nativeScreenRect = [1, 2, 3]; },
  value => { value.objects[1].nativeScreenRect[0] = "104"; }, value => { value.objects[1].nativeScreenRect[2] = -1; },
]) {
  const stopped = await run({ geometry: (result, op) => { if (op === "objects") change(result); } });
  assert.equal(stopped.result.ok, false); assert.deepEqual(stopped.phases, ["prebind"]);
  assert.deepEqual(stopped.keys, []); assert.deepEqual(stopped.focuses, []);
  assert.equal(stopped.result.activationSubmitted, false, "Missing native producer geometry must not use a DPI-derived fallback.");
}
const rejectedResume = await run({ resumeRejected: true });
assert.equal(rejectedResume.result.ok, false); assert.equal(rejectedResume.result.phase, "native-step-home");
assert.equal(rejectedResume.result.cursorActivation.subphase, "step-resume-proof");
assert.equal(rejectedResume.result.cursorResumeProof.sameSelection, false);
assert.equal(rejectedResume.result.cursorResumeProof.numberCell.ok, true);
assert.deepEqual(rejectedResume.result.nativeCursorFocusEvidence, { currentIndex: [1, 0], selectedIndexCount: 1,
  selectedIndexes: [[1, 0]], selectedIndexesTruncated: false, focusActionVerified: true });
assert.deepEqual(rejectedResume.keys, []); assert.equal(rejectedResume.focuses.length, 1); assert.deepEqual(rejectedResume.releases, []);
assert.equal(rejectedResume.result.physicalInputAttempted, false); assert.equal(rejectedResume.result.physicalInputUsed, false);
assert.equal(rejectedResume.result.outcomeUnknown, true); assert.equal(rejectedResume.result.retryable, false);
for (const key of ["tableName", "tableAid", "modelFingerprint", "windowTitle", "nonce", "rootHwnd"]) {
  assert.equal(Object.hasOwn(rejectedResume.result.nativeCursorFocusEvidence, key), false);
}
for (const key of ["cursorBinding", "cursorLease", "selectedRids", "numberModel", "numberPolicy"]) {
  assert.equal(Object.hasOwn(rejectedResume.result, key), false, "A rejected resume must preserve diagnostics without private authority.");
}

for (const options of [{ noAck: true }, { focus: result => { result.focused = false; } },
  { focus: result => { result.inputTick++; } }, { focus: result => { result.binding.currentIndex = [2, 0]; } }]) {
  const stopped = await run(options); assert.equal(stopped.result.ok, false); assert.deepEqual(stopped.keys, []);
  assert.equal(stopped.result.outcomeUnknown, true, "An unacknowledged or unproven dispatched native focus cannot claim a known unchanged model.");
  assert.equal(stopped.focuses.length, 1); assert.equal(stopped.releases.length, 1);
}
const focusModelDrift = await run({ model: (value, keyCount, focusCount) => {
  if (focusCount === 1) value.values[0][2].edit = "Synthetic focus callback changed the model";
} });
assert.equal(focusModelDrift.result.ok, false);
assert.equal(focusModelDrift.result.proofCheck, "native-step-whole-model");
assert.equal(focusModelDrift.result.outcomeUnknown, true);
assert.deepEqual(focusModelDrift.keys, []);
assert.equal(focusModelDrift.releases.length, 1);
for (const options of [
  { step: (result, count) => { if (count === 1) result.cursorBinding.dirty = false; } },
  { step: (result, count) => { if (count === 1) result.cursorBinding.windowFingerprint = "d".repeat(64); } },
  { step: (result, count) => { if (count === 1) result.cursorLease.inputEpoch++; } },
  { step: (result, count) => { if (count === 1) result.cursorStep.parentLeaseNonce = randomUUID(); } },
  { step: (result, count) => { if (count === 1) result.cursorStep.sequence++; } },
  { step: (result, count) => { if (count === 1) result.cursorStep.row++; } },
  { step: (result, count) => { if (count === 1) result.cursorLease.nonce = baseLease.nonce; } },
  { step: (result, count, model) => { if (count === 1) model.values[2][0].edit = "Mutated Nr"; } },
  { step: (result, count, model) => { if (count === 1) model.values[2][3].flags = 1; } },
  { step: (result, count, model) => { if (count === 1) model.cursorFocusBinding.selectedIndexes = [[2, 0]]; } },
  { workerFails: 1 }, { throwStep: true },
]) {
  const stopped = await run(options); assert.equal(stopped.result.ok, false);
  assert.deepEqual(stopped.keys, ["home"], "A rejected step must never replay HOME or issue the next DOWN.");
  assert.equal(stopped.focuses.length, 1);
}
const malformedLease = await run({ step: result => { result.cursorLease.nonce = "malformed"; } });
assert.equal(malformedLease.result.cleanupRequired, true); assert.equal(malformedLease.releases.length, 0);
const malformedAcquire = await run({ acquire: result => { result.cursorLease.nonce = "malformed"; } });
assert.equal(malformedAcquire.result.cleanupRequired, true); assert.deepEqual(malformedAcquire.keys, []);
const malformedCheckpoint = await run({ step: result => { delete result.cursorStep; } });
assert.equal(malformedCheckpoint.releases.length, 1, "A valid fresh handover must still be released after malformed progress.");
assert.equal(malformedCheckpoint.leases.includes(malformedCheckpoint.releases[0]), false);
const reusedOldLease = await run({ step: (result, count) => { if (count === 2) result.cursorLease.nonce = baseLease.nonce; } });
assert.equal(reusedOldLease.result.ok, false); assert.deepEqual(reusedOldLease.keys, ["home", "down"]);
assert.equal(reusedOldLease.result.cleanupRequired, true); assert.equal(reusedOldLease.releases.length, 0);
const clipped = await run({ clippedLast: true });
assert.equal(clipped.result.ok, false); assert.equal(clipped.result.proofCheck, "native-step-last-row-clipped");
assert.deepEqual(clipped.keys, ["home", "down", "down"], "A clipped last model index is not proof of a visible end and must not send an extra key.");
const finalEpoch = await run({ checkpointFails: true });
assert.equal(finalEpoch.result.ok, false); assert.equal(finalEpoch.releases.length, 1);
const badRelease = await run({ releaseUnproven: true });
assert.equal(badRelease.result.ok, false); assert.equal(badRelease.result.cleanupRequired, true);
assert.equal(badRelease.result.vollstaendig, false);
const downFailure = await run({ workerFails: 2 });
assert.deepEqual(downFailure.keys, ["home", "down"]); assert.equal(downFailure.result.ok, false);
console.log("table-native-step-contract: one-key progress, fresh nonce, complete model, strict focus/epoch/end and no replay passed");
