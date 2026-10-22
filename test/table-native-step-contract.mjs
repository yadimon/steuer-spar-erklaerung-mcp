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
  let model = copy(template), binding = copy(baseBinding), lease = copy(baseLease);
  options.initialize?.(model, binding);
  let selected = model.cursorFocusBinding?.selectedIndexes.length ? [`Synthetic.cell.${model.cursorFocusBinding.currentIndex[0]}`] : [];
  options.binding?.(binding);
  const phases = [], keys = [], focuses = [], positions = [], positionCheckpoints = [], releases = [], leases = [], requests = [], consumed = new Set();
  let positionReleased = false;
  const live = { inputEpoch: binding.inputEpoch, dirty: binding.dirty, windowFingerprint: binding.windowFingerprint, editorFree: true };
  const client = { binding: { hwnd: 111, pid: 7 }, request: async (op, args) => {
    requests.push(op);
    if (op === "ping") {
      const result = { ok: true, pid: 7, hwnd: 111, recoveryRequired: false,
        mutationAcknowledgmentRequired: false, capabilities: { tableFocusOnlyProtocol: 1, tablePositionNumberProtocol: 1 } };
      options.ping?.(result); return { result };
    }
    if (["objects", "accessibility_snapshot"].includes(op)) {
      const result = nativeGeometry(op, model, binding); options.geometry?.(result, op, positionReleased); return { result };
    }
    assert.equal(op, "table_snapshot");
    assert.equal(args.withCursorFocusBinding, true,
      "A private cursor transaction must explicitly request its unchanged focus/model binding.");
    if (positionReleased && !keys.length && options.postBootstrapReadThrows) throw new Error("Synthetic post-bootstrap model read lost");
    const value = copy(model); options.model?.(value, keys.length, focuses.length);
    if (positionCheckpoints.length && !positionReleased) options.afterPositionVerify?.();
    return { result: value };
  }, requestAcknowledged: async (op, args) => {
    if (op === "table_position_number") {
      positions.push(copy(args)); assert.equal(positions.length, 1, "Bootstrap positioning must never replay");
      assert.deepEqual(args.binding, model.cursorFocusBinding);
      assert.equal(args.expectedInputTick, binding.inputEpoch);
      const firstVisible = model.values.findIndex((_row, index) => !model.hiddenRows.includes(index));
      assert.equal(args.targetRow, firstVisible, "Bootstrap must bind the first visible raw model Nr. row");
      if (options.positionThrows) throw new Error("Synthetic unknown positioning transport outcome");
      model.cursorFocusBinding.currentIndex = [args.targetRow, 0];
      model.cursorFocusBinding.selectedIndexes = [[args.targetRow, 0]];
      selected = [`Synthetic.cell.${args.targetRow}`];
      if (options.positionUnknown) return { result: { ok: false, mutationAttempted: true,
        outcomeUnknown: true, code: "GUI_OPERATION_TIMEOUT" }, receiptAcknowledged: false };
      if (options.positionModelChanged) model.values[0][2].edit = "Synthetic position callback changed model";
      return { result: { ok: true, positioned: true, physicalInputUsed: false, mutationAttempted: true,
        numberEditorPending: false, inputTick: binding.inputEpoch, binding: copy(model.cursorFocusBinding) },
      receiptAcknowledged: !options.noPositionAck };
    }
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
    if (plan.phase === "native-acquire" || plan.phase === "native-position-acquire") {
      const acquired = { ok: true, cursorBinding: copy(binding), cursorLease: copy(lease), selectedRids: selected,
        activationSubmitted: false, physicalInputUsed: false, steps: 0 };
      if (plan.phase === "native-position-acquire") { options.positionAcquire?.(acquired); return acquired; }
      if (model.cursorFocusBinding.currentIndex.some(index => index < 0) || !model.cursorFocusBinding.selectedIndexes.length) {
        return { ok: false, kind: "cursor-proof-failed", error: "Synthetic own root Window has no current Nr. cell",
          activationSubmitted: false, physicalInputAttempted: false, physicalInputUsed: false, outcomeUnknown: false, steps: 0 };
      }
      options.acquire?.(acquired); return acquired;
    }
    if (plan.phase === "native-release") {
      assert.equal(timeout, 5000); assert.equal(signal, undefined);
      assert.equal(consumed.has(plan.lease.nonce), false, "A consumed nonce must never be imported for cleanup.");
      releases.push(plan.lease.nonce);
      if (positions.length && !positionReleased) {
        options.beforePositionRelease?.(live);
        if (live.inputEpoch !== plan.binding.inputEpoch || live.dirty !== plan.binding.dirty ||
            live.windowFingerprint !== plan.binding.windowFingerprint || !live.editorFree) return { ok: false, kind: "interference" };
        options.duringPositionRelease?.();
        if (options.positionReleaseThrows) throw new Error("Synthetic release lost");
        if (options.positionReleaseMissingReply) return undefined;
        if (options.positionReleaseReply) return copy(options.positionReleaseReply);
      }
      const unproven = options.releaseUnproven || (positionReleased && options.laterReleaseUnproven);
      if (positions.length && !positionReleased) {
        positionReleased = true; consumed.add(plan.lease.nonce);
        lease = { ...lease, nonce: randomUUID() };
        options.afterPositionRelease?.(model, binding);
      }
      return { ok: true, cursorLeaseReleased: true,
        focusTelemetry: { releasedByEmit: !unproven, foregroundRestored: !unproven } };
    }
    if (plan.phase === "native-position-checkpoint") {
      positionCheckpoints.push(copy(plan));
      assert.deepEqual(plan.lease, lease); assert.deepEqual(plan.binding, binding);
      assert.equal(plan.position.targetRow, positions[0].targetRow);
      assert.equal(plan.position.numberModel.length, model.rows);
      binding.snapshot.navigationBinding.contentSignature = "d".repeat(64);
      consumed.add(lease.nonce); lease = { ...lease, nonce: randomUUID() };
      return { ok: true, cursorBinding: copy(binding), cursorLease: copy(lease), cursorCheckpoint: true };
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
  const result = await executeTableCursorRead({ hwnd: 111, noKeys: false, sumLabel: "Summe" }, worker, { qtNativeClient: client }, 30000, options.signal);
  return { result, phases, keys, focuses, positions, positionCheckpoints, releases, leases, requests };
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
assert.equal(Object.hasOwn(success.result, "nativeCursorFocusEvidence"), false, "Successful result shape must remain unchanged.");
// A failed acquire must retain only the already observed native cursor indices,
// not claim that this pre-acquire observation is a completed focus action.
for (const manySelected of [false, true]) {
  let expectedFocus;
  const stopped = await run({ initialize: model => {
    if (manySelected) {
      model.rows = 5; model.readRows = 5;
      model.values.push(copy(model.values[0]), copy(model.values[0]));
      model.rowFingerprints.push("4".repeat(64), "5".repeat(64));
    }
    model.cursorFocusBinding.currentIndex = [2, 3];
    model.cursorFocusBinding.selectedIndexes = manySelected
      ? Array.from({ length: 40 }, (_, index) => [Math.floor(index / 8), index % 8]) : [[2, 3]];
    expectedFocus = copy(model.cursorFocusBinding);
  }, acquire: result => {
    result.ok = false; result.kind = "cursor-proof-failed"; result.error = "Synthetic acquire rejected";
    result.steps = 0; result.activationSubmitted = true; result.physicalInputAttempted = false;
    result.physicalInputUsed = false; result.outcomeUnknown = true;
    result.cursorActivation = { subphase: "native-semantic-selection-proof" };
  } });
  assert.equal(stopped.result.ok, false); assert.equal(stopped.result.error, "Synthetic acquire rejected");
  assert.equal(stopped.result.cursorActivation.subphase, "native-semantic-selection-proof");
  assert.equal(stopped.result.activationSubmitted, true); assert.equal(stopped.result.outcomeUnknown, true);
  assert.deepEqual(stopped.result.nativeCursorFocusEvidence, {
    currentIndex: [2, 3], selectedIndexCount: expectedFocus.selectedIndexes.length,
    selectedIndexes: expectedFocus.selectedIndexes.slice(0, 32), selectedIndexesTruncated: manySelected, focusActionVerified: false,
  }, "Acquire failure must preserve the existing pre-acquire observation, including non-Nr columns.");
  assert.deepEqual(stopped.phases, ["prebind", "native-acquire"]);
  assert.deepEqual(stopped.requests, ["table_snapshot", "ping", "accessibility_snapshot", "objects"], "Diagnostics must add no native read.");
  assert.deepEqual(stopped.keys, []); assert.deepEqual(stopped.focuses, []); assert.deepEqual(stopped.releases, []);
  for (const field of ["cursorBinding", "cursorLease", "selectedRids", "numberModel", "numberPolicy"]) {
    assert.equal(Object.hasOwn(stopped.result, field), false, "Acquire failure leaked private cursor authority.");
  }
  assert.deepEqual(Object.keys(stopped.result.nativeCursorFocusEvidence).sort(),
    ["currentIndex", "selectedIndexCount", "selectedIndexes", "selectedIndexesTruncated", "focusActionVerified"].sort());
}
// A native Add/Update leaves the current Nr. at the changed row. A following
// guarded read must not enter legacy resume, whose HOME can open an Nr. editor
// without the model-backed closure and selection proof before the first DOWN.
function bankAfterUpdate(model, binding) {
  const tableName = "/.Bankgebuehren.Tab";
  const tableAid = `Synthetic.RedThreadContent.DialogUI./.Bankgebuehren.${tableName}`;
  const visibleHeaders = ["Nr.", "Datum", "Bezeichnung", "Betrag", "N", "%", "Netto"];
  Object.assign(model, { rows: 4, readRows: 4, columns: visibleHeaders.length, headers: visibleHeaders,
    hiddenColumns: [], hiddenRows: [], summary: "20,64", summaries: [{ label: "Summe", vorkommen: 1, wert: "20,64" }],
    values: [["1", "05.08", "Synthetic bank fee", "15,34", "", "0", "15,34"],
      ["2", "05.09", "Synthetic card fee", "5,11", "", "0", "5,11"],
      ["", "", "", "0,19", "", "0", "0,19"],
      ["", "", "", "0,00", "", "0", "0,00"]].map(row => row.map((display, column) =>
        column === 4 ? { display, edit: display, flags: 49, checkState: 0 } : cell(display))),
    rowFingerprints: ["1", "2", "3", "4"].map(char => char.repeat(64)) });
  model.table.name = tableName;
  Object.assign(model.cursorFocusBinding, { tableName, tableAid, currentIndex: [2, 0], selectedIndexes: [[2, 0]] });
  binding.snapshot.kopf = [...visibleHeaders];
  Object.assign(binding.snapshot.navigationBinding, { heading: "Beiträge, Gebühren und Abgaben", tableRootAid: tableAid,
    summaryValue: "20,64", headers: visibleHeaders.map((name, column) =>
      ({ name, aid: `${tableAid}.${column}`, rid: `42.777.4.-${30 + column}` })) });
}
const bank = await run({ initialize: bankAfterUpdate });
assert.equal(bank.result.ok, true, "A bound numbered table after Update must use the model-backed step route.");
assert.equal(bank.result.cursorTransaction, "native-step-focus-only");
assert.equal(bank.result.vollstaendig, true); assert.equal(bank.result.nativeWholeModelUnchanged, true);
assert.equal(bank.result.lastRowFullyContained, true); assert.equal(bank.result.summe, "20,64");
assert.deepEqual(bank.keys, ["home", "down", "down", "down"]);
assert.deepEqual(bank.focuses[0].binding.currentIndex, [2, 0]);
assert.deepEqual(bank.phases, ["prebind", "native-acquire", "native-step", "native-step", "native-step", "native-step", "checkpoint", "native-release"]);
assert.deepEqual(bank.result.zeilen, [["1", "05.08", "Synthetic bank fee", "15,34", "", "0", "15,34"],
  ["2", "05.09", "Synthetic card fee", "5,11", "", "0", "5,11"], ["", "", "", "0,19", "", "0", "0,19"]]);
assert.deepEqual(bank.result.rowDetails.map(row => row.typedValues[4]), [false, false, false]);
assert.deepEqual(bank.result.rowDetails.map(row => row.checkboxStates[4]), ["Off", "Off", "Off"]);

// Leaving and returning to a page can preserve the whole model while clearing
// current/selection and leaving focus on its own root Window. Only this exact
// empty-cursor state may plan a native Nr. position before normal stepped read.
function bankWithoutCurrent(model, binding) {
  bankAfterUpdate(model, binding);
  Object.assign(model.cursorFocusBinding, { currentIndex: [-1, -1], selectedIndexes: [] });
}
const bootstrapped = await run({ initialize: bankWithoutCurrent });
assert.equal(bootstrapped.result.ok, true,
  "A returned page with exact empty current/selection must position once before stepped acquisition");
assert.deepEqual(bootstrapped.keys, bank.keys);
assert.equal(bootstrapped.positions.length, 1); assert.equal(bootstrapped.positions[0].targetRow, 0);
assert.deepEqual(bootstrapped.positions[0].binding.currentIndex, [-1, -1]);
assert.deepEqual(bootstrapped.positions[0].binding.selectedIndexes, []);
assert.equal(bootstrapped.positionCheckpoints.length, 1); assert.equal(bootstrapped.releases.length, 2);
assert.equal(new Set(bootstrapped.releases).size, 2, "Bootstrap and traversal must release independent authority");
assert.deepEqual(bootstrapped.phases, ["prebind", "native-position-acquire", "native-position-checkpoint", "native-release",
  "native-acquire", "native-step", "native-step", "native-step", "native-step", "checkpoint", "native-release"]);
assert.deepEqual(Object.keys(bootstrapped.result).sort(), Object.keys(bank.result).sort(),
  "Successful bootstrap must preserve the existing public result shape");
assert.deepEqual(bootstrapped.result.zeilen, bank.result.zeilen);
for (const field of ["cursorBinding", "cursorLease", "selectedRids", "numberPolicy", "bootstrap", "cursorStep"]) {
  assert.equal(Object.hasOwn(bootstrapped.result, field), false);
}
for (const [name, change] of [
  ["input epoch", live => { live.inputEpoch++; }],
  ["dirty state", live => { live.dirty = !live.dirty; }],
  ["window set", live => { live.windowFingerprint = "f".repeat(64); }],
  ["editor", live => { live.editorFree = false; }],
]) {
  const stopped = await run({ initialize: bankWithoutCurrent, beforePositionRelease: change });
  assert.equal(stopped.result.ok, false, name);
  assert.equal(stopped.result.cleanupRequired, true); assert.equal(stopped.result.reconciliationRequired, true);
  assert.equal(stopped.result.activationSubmitted, true);
  assert.deepEqual(stopped.keys, []); assert.equal(stopped.positions.length, 1); assert.equal(stopped.releases.length, 1);
  assert.deepEqual(stopped.phases, ["prebind", "native-position-acquire", "native-position-checkpoint", "native-release"],
    "Rejected bootstrap cleanup must never enter stepped acquisition or replay positioning.");
}
for (const failure of [
  { positionReleaseReply: { ok: false, cursorLeaseReleased: true, focusTelemetry: { releasedByEmit: true } } },
  { positionReleaseReply: { ok: true, cursorLeaseReleased: false, focusTelemetry: { releasedByEmit: true } } },
  { positionReleaseReply: { ok: true, focusTelemetry: { releasedByEmit: true } } },
  { positionReleaseReply: { ok: true, cursorLeaseReleased: true, focusTelemetry: {} } },
  { positionReleaseMissingReply: true },
  { positionReleaseThrows: true },
]) {
  const stopped = await run({ initialize: bankWithoutCurrent, ...failure });
  assert.equal(stopped.result.ok, false); assert.equal(stopped.result.cleanupRequired, true);
  assert.equal(stopped.result.reconciliationRequired, true);
  assert.equal(stopped.releases.length, 1); assert.deepEqual(stopped.keys, []);
  assert.equal(stopped.phases.includes("native-acquire"), false);
}
for (const when of ["afterPositionVerify", "duringPositionRelease"]) {
  const controller = new AbortController();
  const stopped = await run({ initialize: bankWithoutCurrent, signal: controller.signal, [when]: () => controller.abort() });
  assert.equal(controller.signal.aborted, true); assert.equal(stopped.result.ok, false);
  assert.equal(stopped.result.reconciliationRequired, true);
  assert.notEqual(stopped.result.cleanupRequired, true, "Cancellation must still complete the owned passive release.");
  assert.equal(stopped.releases.length, 1); assert.deepEqual(stopped.keys, []);
  assert.equal(stopped.phases.includes("native-acquire"), false, "Aborted cleanup never authorizes another acquisition.");
}

const hiddenFirst = await run({ initialize: (model, binding) => {
  bankWithoutCurrent(model, binding); model.hiddenRows = [0];
} });
assert.equal(hiddenFirst.result.ok, true); assert.equal(hiddenFirst.positions[0].targetRow, 1);
assert.deepEqual(hiddenFirst.keys, ["home", "down", "down"]);
for (const [currentIndex, selectedIndexes] of [[[-1, 0], []], [[0, -1], []], [[-1, -1], [[0, 0]]], [[1, 0], []]]) {
  const refused = await run({ initialize: (model, binding) => {
    bankWithoutCurrent(model, binding); Object.assign(model.cursorFocusBinding, { currentIndex, selectedIndexes });
  } });
  assert.equal(refused.result.ok, false); assert.deepEqual(refused.positions, []); assert.deepEqual(refused.keys, []);
  assert.deepEqual(refused.focuses, [], "Half-invalid or contradictory cursor state is not bootstrap authority");
}
for (const cursorFocusBinding of [undefined, null]) {
  const refused = await run({ initialize: (model, binding) => {
    bankWithoutCurrent(model, binding); model.cursorFocusBinding = cursorFocusBinding;
  } });
  assert.equal(refused.result.ok, false); assert.deepEqual(refused.positions, []); assert.deepEqual(refused.keys, []);
  assert.deepEqual(refused.focuses, [], "Missing native focus metadata is not proof of an empty cursor");
}
for (const capability of ["tableFocusOnlyProtocol", "tablePositionNumberProtocol"]) {
  for (const value of [undefined, 0, "1"]) {
    const refused = await run({ initialize: bankWithoutCurrent, ping: reply => { reply.capabilities[capability] = value; } });
    assert.equal(refused.result.ok, false); assert.deepEqual(refused.positions, []); assert.deepEqual(refused.keys, []);
    assert.deepEqual(refused.focuses, []);
    assert.deepEqual(refused.phases, ["prebind"], "Missing bootstrap capability must not enter legacy activation or acquire authority");
  }
}
const noVisible = await run({ initialize: (model, binding) => {
  bankWithoutCurrent(model, binding); model.hiddenRows = [0, 1, 2, 3];
} });
assert.equal(noVisible.result.ok, false); assert.deepEqual(noVisible.positions, []); assert.deepEqual(noVisible.keys, []);
const acquireRefused = await run({ initialize: bankWithoutCurrent, positionAcquire: reply => {
  Object.assign(reply, { ok: false, kind: "cursor-proof-failed", outcomeUnknown: false });
} });
assert.equal(acquireRefused.result.ok, false); assert.deepEqual(acquireRefused.positions, []);
assert.equal(acquireRefused.result.activationSubmitted, false); assert.equal(acquireRefused.result.outcomeUnknown, false);

for (const failure of [{ positionUnknown: true }, { noPositionAck: true }, { positionThrows: true }, { positionModelChanged: true }]) {
  const stopped = await run({ initialize: bankWithoutCurrent, ...failure });
  assert.equal(stopped.result.ok, false); assert.equal(stopped.positions.length, 1); assert.deepEqual(stopped.keys, []);
  assert.equal(stopped.phases.includes("native-acquire"), false, "An unknown or changed bootstrap must not start another transaction");
  assert.equal(stopped.result.activationSubmitted, true); assert.equal(stopped.result.outcomeUnknown, true);
  assert.equal(stopped.result.reconciliationRequired, true); assert.equal(stopped.result.retryable, false);
}
const changedAfterRelease = await run({ initialize: bankWithoutCurrent,
  afterPositionRelease: model => { model.values[0][4].checkState = 2; } });
assert.equal(changedAfterRelease.result.ok, false); assert.equal(changedAfterRelease.positions.length, 1);
assert.equal(changedAfterRelease.phases.includes("native-acquire"), false,
  "A fresh complete model must be identical before a second focus handover is acquired");
assert.equal(changedAfterRelease.result.activationSubmitted, true); assert.equal(changedAfterRelease.result.outcomeUnknown, true);
assert.equal(changedAfterRelease.result.reconciliationRequired, true); assert.deepEqual(changedAfterRelease.keys, []);
for (const [failure, nestedActivation] of [
  [{ postBootstrapReadThrows: true }, undefined],
  [{ geometry: (reply, op, released) => { if (released && op === "objects") reply.objects[0].nativeScreenRect[0] += 5; } }, true],
  [{ acquire: reply => Object.assign(reply, { ok: false, kind: "cursor-proof-failed", error: "Synthetic later acquire failed",
    activationSubmitted: false, physicalInputAttempted: false, outcomeUnknown: false, reconciliationRequired: false,
    cursorActivation: { activationAttempted: false, subphase: "native-acquire" } }) }, true],
]) {
  const stopped = await run({ initialize: bankWithoutCurrent, ...failure });
  assert.equal(stopped.result.ok, false); assert.equal(stopped.positions.length, 1); assert.deepEqual(stopped.keys, []);
  assert.equal(stopped.result.activationSubmitted, true, "A completed bootstrap action cannot be erased by a later pre-key failure");
  assert.equal(stopped.result.outcomeUnknown, true); assert.equal(stopped.result.reconciliationRequired, true);
  assert.equal(stopped.result.physicalInputAttempted, false); assert.equal(stopped.result.retryable, false);
  assert.equal(stopped.result.cursorActivation?.activationAttempted, nestedActivation,
    "Nested proof diagnostics must not falsely claim no action after bootstrap");
  assert.equal(stopped.releases.length, 1, "Already-released bootstrap authority must not be imported again after a later guard fails");
}
const laterCleanupLost = await run({ initialize: bankWithoutCurrent, laterReleaseUnproven: true });
assert.equal(laterCleanupLost.result.ok, false); assert.equal(laterCleanupLost.result.cleanupRequired, true);
assert.equal(laterCleanupLost.result.activationSubmitted, true); assert.equal(laterCleanupLost.result.outcomeUnknown, true);
assert.equal(laterCleanupLost.result.reconciliationRequired, true); assert.equal(laterCleanupLost.releases.length, 2);

const otherNumbered = await run({ initialize: (model, binding) => {
  bankAfterUpdate(model, binding);
  const name = "/.Synthetic.OtherNumbered", tableAid = `Synthetic.RedThreadContent.DialogUI.${name}`;
  model.table.name = name; Object.assign(model.cursorFocusBinding, { tableName: name, tableAid });
  binding.snapshot.navigationBinding.heading = "Synthetic unrelated heading";
  binding.snapshot.navigationBinding.tableRootAid = tableAid;
  binding.snapshot.navigationBinding.headers.forEach((header, column) => { header.aid = `${tableAid}.${column}`; });
} });
assert.equal(otherNumbered.result.ok, true, "Number policy must bind the table/model, not a heading allowlist.");
assert.deepEqual(otherNumbered.keys, bank.keys);
const shortNumberHeader = await run({ initialize: (model, binding) => {
  bankAfterUpdate(model, binding); model.headers[0] = "Nr"; binding.snapshot.kopf[0] = "Nr";
  binding.snapshot.navigationBinding.headers[0].name = "Nr";
} });
assert.equal(shortNumberHeader.result.ok, true); assert.deepEqual(shortNumberHeader.keys, bank.keys);
for (const [name, change] of [
  ["UIA Nr with non-Nr native header", model => { model.headers[0] = "Code"; }],
  ["native Nr with non-Nr UIA header", (_model, binding) => {
    binding.snapshot.kopf[0] = "Code"; binding.snapshot.navigationBinding.headers[0].name = "Code";
  }],
  ["non-string native header", model => { model.headers[0] = 17; }],
  ["hidden raw Nr column", model => { model.hiddenColumns = [0]; }],
  ["unselectable Nr cell", model => { model.values[0][0].flags = 1; }],
  ["checkable Nr cell", model => { model.values[0][0].flags = 49; model.values[0][0].checkState = 0; }],
  ["numeric Nr role", model => { model.values[0][0].display = 1; model.values[0][0].edit = 1; }],
  ["table name outside bound Aid", model => { model.table.name = "/.Synthetic.Foreign"; }],
]) {
  const stopped = await run({ initialize: (model, binding) => { bankAfterUpdate(model, binding); change(model, binding); } });
  assert.equal(stopped.result.ok, false, name);
  assert.deepEqual(stopped.phases, ["prebind"], `${name}: failed number proof must not fall back to resume or acquire focus.`);
  assert.deepEqual(stopped.keys, [], name); assert.deepEqual(stopped.focuses, [], name); assert.deepEqual(stopped.releases, [], name);
}
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
