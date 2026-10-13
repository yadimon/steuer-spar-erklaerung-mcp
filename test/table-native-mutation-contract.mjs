import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mock } from "node:test";
import { executeTableCursorMutation, executeTableCursorRead } from "../dist/table-cursor-executor.js";
import { QtNativeAcknowledgmentError } from "../dist/qt-native-client.js";

// Synthetic complete Qt model and workers; no API, process or desktop.
const copy = value => structuredClone(value);
const headers = ["Nr.", "Datum", "Bezeichnung", "Betrag", "N", "%", "Netto"];
const name = "/.Synthetic.Expenses", aid = `Synthetic.RedThreadContent.DialogUI.${name}`;
const scalar = display => ({ display, edit: display, flags: 35, checkState: null });
const base = { ok: true, controllerBound: true, windowEnabled: true, modalBlocked: false,
  rows: 10, readRows: 10, columns: 7, headers,
  values: Array.from({ length: 10 }, (_, row) => ["", "01.01", row === 7 ? "Target" : `Synthetic ${row}`, "10,00", "", "0", "10,00"]
    .map((value, column) => column === 4 ? { display: "", edit: false, flags: 49, checkState: 0 }
      : column === 6 ? { ...scalar(value), flags: 1 } : scalar(value))),
  rowFingerprints: Array.from({ length: 10 }, (_, row) => String(row).repeat(64)), hiddenColumns: [], hiddenRows: [],
  complete: true, canFetchMore: false, tableCount: 1, table: { id: 9, name, class: "DialogUITable", visible: true, rows: 10, columns: 7 },
  summary: "100,00", binding: {}, summaries: [{ label: "Summe", vorkommen: 1, wert: "100,00" }],
  cursorFocusBinding: { tableId: 9, modelId: 10, tableName: name, tableAid: aid,
    currentIndex: [2, 0], selectedIndexes: [[2, 0]], modelFingerprint: "c".repeat(64) } };
const baseBinding = { hwnd: 111, pid: 7, inputEpoch: 123, dirty: true, dpi: 96, clientOrigin: [100, 200],
  windowTitle: "Synthetic case", windowFingerprint: "a".repeat(64), snapshot: { kopf: headers, navigationBinding: {
    complete: true, editorFree: true, heading: "EDV-Kosten", tableRootAid: aid, tableRootRid: "42.777.4.-20",
    contentSignature: "b".repeat(64), scopePrefix: "Synthetic.Scope", selectionMethod: "synthetic",
    summaryIdentity: "Synthetic.Sum", summaryValue: "100,00", summaryRid: "42.777.4.-21", summaryAid: "Synthetic.Sum",
    headers: headers.map((name, column) => ({ name, aid: `${aid}.${column}`, rid: `42.777.4.-${30 + column}` })) } } };
const originalArgs = { hwnd: 111, expectedPage: "EDV-Kosten", text: "Target", sumLabel: "Summe", expectedBefore: "100,00",
  expectedAfter: "100,00", werte: [null, null, "Updated", null, null, null, null] };
const enumCatalog = { pages: { synthetic: { tables: { exact: {
  automationIdSection: "grpEmpf13b", sumLabel: "Summe", sumOccurrence: 1, columns: [
    { index: 3, header: "Kategorie", controlType: "ComboBox", valueKind: "enum", writePolicy: "typed-selection-required" },
  ],
} } } } };
function nativeGeometry(op, model, binding) {
  const node = (value, index) => ({ i: index, p: index ? 0 : -1, d: index ? 1 : 0, name: "", on: true,
    val: null, ro: null, checked: null, selected: null, scroll: null, ...value });
  const expected = binding.snapshot.navigationBinding;
  if (op === "objects") return { ok: true, complete: true, windowEnabled: true, modalBlocked: false, objects: [
    { id: model.table.id, parentId: 0, name: model.table.name, class: "DialogUITable", visible: true, enabled: true,
      rootRect: [0, 0, 700, 240], nativeScreenRect: [100, 200, 700, 240] },
    { id: 11, parentId: model.table.id, name: "qt_scrollarea_viewport", class: "QWidget", visible: true, enabled: true,
      rootRect: [4, 24, 692, 212], nativeScreenRect: [104, 224, 692, 212] },
  ] };
  const nodes = [node({ type: "Table", rid: expected.tableRootRid, aid: expected.tableRootAid, x: 100, y: 200, w: 700, h: 240 }, 0),
    ...expected.headers.map((header, column) => node({ ...header, type: "Header", x: 100 + 80 * column, y: 200, w: 80, h: 24 }, column + 1))];
  return { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 111, windowEnabled: true, modalBlocked: false, nodes,
    windowRect: { x: 100, y: 200, w: 900, h: 600 }, exactMatches: {}, stats: { n: nodes.length, err: 0, cyc: 0, cycleRid: "", cycleName: "",
      truncated: false, depthLimited: false, valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 } };
}

async function run(options = {}) {
  const model = copy(base), binding = copy(baseBinding), keys = [], positions = [], mutations = [], focuses = [], probes = [], releases = [], preparations = [];
  const activeHeaders = options.category ? ["Nr.", "Datum", "Bezeichnung", "Kategorie", "%", "Netto"] : headers;
  if (options.category) {
    model.columns = 6; model.headers = activeHeaders; model.table.name = "/.grpEmpf13b.Empf13b";
    binding.snapshot.kopf = activeHeaders; binding.snapshot.navigationBinding.heading = "Synthetic category page";
    const categoryAid = `Synthetic.RedThreadContent.DialogUI.${model.table.name}`;
    binding.snapshot.navigationBinding.tableRootAid = categoryAid;
    binding.snapshot.navigationBinding.headers = activeHeaders.map((name, column) => ({ name, aid: `${categoryAid}.${column}`, rid: `42.777.4.-${30 + column}` }));
    model.cursorFocusBinding.tableName = model.table.name; model.cursorFocusBinding.tableAid = categoryAid;
    model.values = model.values.map((cells, row) => [cells[0], cells[1], cells[2],
      { ...scalar(row === 0 ? "Sonst. Leistung Drittland" : "Sonst. Leistung EU"), edit: row === 0 ? 2 : 1 }, scalar("19"), { ...scalar("10,00"), flags: 1 }]);
    if (options.enumUnknown) model.values[0][3] = { ...scalar("Sonst. Leistung EU"), edit: 1 };
    if (options.enumAmbiguous) model.values[1][3] = { ...scalar("Sonst. Leistung Drittland"), edit: "2" };
  }
  let lease = { schemaVersion: 1, nonce: randomUUID(), rootHwnd: 111, targetPid: 7, inputEpoch: 123,
    previous: { hwnd: 222, pid: 8, start: "133000000000000001", class: "SyntheticCaller" }, previousCursor: null };
  const initialNonce = lease.nonce;
  const selected = () => [`Synthetic.cell.${model.cursorFocusBinding.currentIndex[0]}`];
  if (options.hiddenColumn) {
    model.columns = 8; model.headers = [...headers, "Hidden metadata"]; model.hiddenColumns = [7];
    for (const row of model.values) row.push(scalar("Unchanged hidden metadata"));
  }
  options.initial?.(model, binding);
  const positionRow = options.appendSeek
    ? Array.from({ length: model.rows }, (_, row) => row).filter(row => !model.hiddenRows.includes(row)).at(-1) : 7;
  const client = { binding: { hwnd: 111, pid: 7 }, request: async op => {
    if (op === "ping") return { result: { ok: true, pid: 7, hwnd: 111, recoveryRequired: false,
      mutationAcknowledgmentRequired: false, capabilities: { tableFocusOnlyProtocol: 1, tablePositionNumberProtocol: options.noPositionProtocol ? 0 : 1 } } };
    if (["objects", "accessibility_snapshot"].includes(op)) {
      const result = nativeGeometry(op, model, binding);
      options.geometryDone?.(op, positions.length, focuses.length);
      return { result };
    }
    assert.equal(op, "table_snapshot");
    const value = copy(model); options.read?.(value, keys.length, mutations.length, probes.length);
    return { result: value };
  }, requestAcknowledged: async (op, args) => {
    if (op === "table_position_number") {
      positions.push(copy(args)); assert.equal(positions.length, 1, "Direct positioning must never replay.");
      assert.equal(args.targetRow, positionRow); assert.deepEqual(args.binding, model.cursorFocusBinding);
      assert.equal(args.expectedInputTick, 123, "Positioning must retain the original input epoch.");
      if (options.positionThrows) throw new Error("Synthetic unknown positioning transport outcome");
      if (options.positionAckThrows) throw new QtNativeAcknowledgmentError("Do not project raw transport messages", "native-mutation-receipt",
        { id: 4, ok: true, positioned: true, mutationAttempted: true, mutationReceipt: "987654321", physicalInputUsed: false,
          inputTick: 123, numberEditorPending: false, binding: copy(model.cursorFocusBinding) });
      if (options.positionRejects) return { result: { ok: false, mutationAttempted: false }, receiptAcknowledged: false };
      model.cursorFocusBinding.currentIndex = [options.wrongPosition ? positionRow - 1 : positionRow, 0];
      model.cursorFocusBinding.selectedIndexes = [[positionRow, options.wrongSelection ? 1 : 0]];
      if (options.positionUnknown) return { result: { ok: false, mutationAttempted: true, outcomeUnknown: true,
        code: options.nativeCode ?? "position-outcome-unknown",
        error: options.nativeReason ?? "The fresh Nr. delegate has no exact profiled accessible identity",
        ...(options.nativePayload ?? {}) }, receiptAcknowledged: false };
      if (options.positionModelChanged) model.values[0][2].edit = "Synthetic callback changed model";
      if (options.positionFlagsChanged) model.values[0][4].checkState = 2;
      return { result: { ok: true, positioned: !options.positionNoop, physicalInputUsed: false, mutationAttempted: true,
        numberEditorPending: options.freshNumberEditor === true,
        inputTick: options.positionEpochChanged ? 124 : binding.inputEpoch, binding: copy(model.cursorFocusBinding) }, receiptAcknowledged: !options.noPositionAck };
    }
    assert.equal(op, "table_focus_only"); focuses.push(copy(args));
    assert.deepEqual(args.binding, model.cursorFocusBinding);
    return { result: { ok: true, focused: !options.focusNoop, physicalInputUsed: false, mutationAttempted: true,
      inputTick: binding.inputEpoch, binding: copy(model.cursorFocusBinding) }, receiptAcknowledged: true };
  } };
  const worker = async (op, args) => {
    if (op !== "table_read") {
      mutations.push({ op, args: copy(args) });
      assert.equal(mutations.length, 1, "Only one mutation worker may be submitted.");
      assert.equal(args.__tableCursorPlan, undefined);
      assert.equal(args.__tableMutationBinding.operation, op);
      assert.equal(args.__tableMutationBinding.target.row, 7);
      assert.equal(args.__tableMutationBinding.target.column, 2);
      assert.equal(args.__tableMutationBinding.target.cells.length, activeHeaders.length);
      assert.equal(args.targetRid, options.targetRid ?? "Synthetic.target.7");
      assert.deepEqual(args.__tableMutationBinding.binding, binding);
      if (options.workerFails) return { ok: false, mutationStarted: true, kind: "interference" };
      if (options.workerThrows) throw new Error("Synthetic unknown mutation outcome");
      if (op === "table_update") {
        if (options.category) model.values[7][3] = { ...scalar("Sonst. Leistung Drittland"),
          edit: options.enumWrongRole === "type" ? "2" : options.enumWrongRole ? 9 : 2 };
        else if (options.date) model.values[7][1] = { ...scalar(options.date), edit: options.dateWrongRole ? "Unexpected date edit" : model.values[0][1].edit };
        else if (options.numeric) model.values[7][3] = { ...scalar("10,00"), edit: 10 };
        else if (options.checkbox) model.values[7][4] = { display: "", edit: true, flags: 49, checkState: 2 };
        else model.values[7][2] = scalar("Updated");
      }
      else {
        model.values.splice(7, 1); model.rowFingerprints.splice(7, 1); model.rows--; model.readRows--;
        if (Object.hasOwn(model.table, "rows")) model.table.rows--;
        model.summary = "90,00"; model.summaries[0].wert = "90,00";
      }
      if (options.otherRowChanged) model.values[0][2].edit = "Unexpected other row";
      if (options.tableIdentityChanged) model.table.id++;
      if (options.tableRowsChanged) model.table.rows++;
      if (options.tableRowsRemoved) delete model.table.rows;
      if (options.tableRowsAdded) model.table.rows = model.rows;
      if (options.targetChanged) model.values[7][2] = scalar("Unexpected target");
      if (options.targetEditChanged) model.values[7][2].edit = "Unexpected target edit";
      if (options.targetOtherColumnChanged) model.values[7][1] = scalar("02.01");
      if (options.targetHiddenChanged) model.values[7][7].edit = "Changed hidden metadata";
      return { ok: true, verified: !options.unverified, mutationStarted: true,
        mutationPostProof: { inputEpoch: binding.inputEpoch, dirty: true } };
    }
    const plan = args.__tableCursorPlan;
    if (plan.phase === "prebind") return { ok: true, cursorBinding: copy(binding) };
    if (plan.phase === "mutation-target") {
      probes.push(copy(plan));
      if (options.probeFails || (plan.targetRid && options.staleRid)) return { ok: false, kind: "stale" };
      assert.equal(plan.target.row, 7); assert.equal(plan.target.column, 2); assert.equal(plan.target.cells.length, activeHeaders.length);
      return { ok: true, mutationTarget: { row: 7, column: 2, targetRid: plan.targetRid ?? "Synthetic.target.7" } };
    }
    if (plan.phase === "native-acquire" || plan.phase === "native-position-acquire") {
      assert.deepEqual(plan.numberPolicy, { tableName: model.table.name, headers: activeHeaders });
      if (options.acquireFocusFails) return { ok: false, kind: "cursor-proof-failed", outcomeUnknown: false,
        cursorActivation: { footerFocus: { focusAttempted: true } } };
      return { ok: true, cursorBinding: copy(binding), cursorLease: copy(lease), selectedRids: selected() };
    }
    if (plan.phase === "native-release") {
      releases.push(plan.lease.nonce);
      return { ok: true, cursorLeaseReleased: true, focusTelemetry: { releasedByEmit: true } };
    }
    if (plan.phase === "checkpoint") return { ok: true, cursorCheckpoint: true };
    if (plan.phase === "native-position-prepare") {
      preparations.push(copy(plan)); assert.equal(preparations.length, 1);
      assert.equal(options.freshNumberEditor, true); assert.equal(plan.position.targetRow, positionRow);
      assert.equal(plan.binding.inputEpoch, 123); assert.equal(plan.lease.nonce, lease.nonce);
      assert.equal(focuses.length, 0, "No focus-only operation may close the fresh Nr. delegate before its proof.");
      if (options.numberClosureFails) return { ok: false, kind: "interference" };
      binding.snapshot.navigationBinding.contentSignature = "e".repeat(64);
      lease = { ...lease, nonce: options.replayedNumberLease ? lease.nonce : randomUUID() };
      return { ok: true, cursorBinding: copy(binding), cursorLease: copy(lease), cursorCheckpoint: true };
    }
    if (plan.phase === "native-position-checkpoint") {
      assert.equal(plan.position.targetRow, positionRow); assert.equal(plan.position.numberModel.length, 10);
      assert.equal(plan.binding.inputEpoch, 123); assert.equal(plan.lease.nonce, lease.nonce);
      if (options.positionCheckpointFails || options.clipped) return { ok: false, kind: "interference", cursorActivation: {positionCheckpoint: {
        reason: "target-proof", proofReason: options.clipped ? "current-number-row-outside-native-viewport" : "current-number-cell-not-selected", targetProven: false,
        desktop: null, inputEpoch: null, foreground: null, windowSet: null, dirtyState: null,
        leaseImported: null, leasePublished: null, nonce: "synthetic-private-checkpoint-authority",
      } } };
      binding.snapshot.navigationBinding.contentSignature = "d".repeat(64);
      if (options.positionCheckpointEpochChanged) binding.inputEpoch++;
      lease = { ...lease, nonce: options.replayedPositionInitialLease ? initialNonce : options.replayedPositionLease ? lease.nonce : randomUUID(),
        inputEpoch: binding.inputEpoch };
      return { ok: true, cursorBinding: copy(binding), cursorLease: copy(lease), cursorCheckpoint: true };
    }
    if (plan.phase === "mutation-checkpoint") {
      assert.equal(plan.binding.inputEpoch, binding.inputEpoch);
      assert.equal(plan.binding.snapshot.navigationBinding.summaryValue, model.summary);
      return { ok: !options.finalEpochChanged, cursorCheckpoint: !options.finalEpochChanged };
    }
    assert.equal(plan.phase, "native-step", "No old resume/HOME reset or arbitrary input fallback.");
    assert.deepEqual(plan.step.numberPolicy, { tableName: model.table.name, headers: activeHeaders });
    assert.equal(plan.step.numberModel.length, 10);
    assert.equal(plan.step.currentIndex[1], 0);
    keys.push(plan.step.key);
    if (options.stepFails && keys.length === options.stepFails) return { ok: false, steps: 0, kind: "interference", focusTelemetry: { releasedByEmit: true } };
    const row = plan.step.expectedRow;
    model.cursorFocusBinding.currentIndex = [row, 0]; model.cursorFocusBinding.selectedIndexes = [[row, 0]];
    binding.inputEpoch++; binding.snapshot.navigationBinding.contentSignature = String(row).repeat(64);
    lease = { ...lease, nonce: randomUUID(), inputEpoch: binding.inputEpoch };
    return { ok: true, steps: 1, cursorBinding: copy(binding), cursorLease: copy(lease), selectedRids: selected(), cursorStep: {
      transactionNonce: plan.step.transactionNonce, stepNonce: plan.step.stepNonce, parentLeaseNonce: plan.step.parentLeaseNonce,
      sequence: plan.step.sequence, key: plan.step.key, modelFingerprint: plan.step.modelFingerprint,
      row, column: 0, rowFullyContained: !options.clipped } };
  };
  const operation = options.operation ?? "table_update", args = { ...originalArgs,
    ...(operation === "table_delete" ? { expectedAfter: "90,00" } : {}),
    ...(options.targetRid ? { targetRid: options.targetRid } : {}),
    ...(options.category ? { expectedPage: "Synthetic category page", werte: [null, null, null, "Sonst. Leistung Drittland", null, null] } : {}),
    ...(options.date ? { werte: [null, options.date, null, null, null, null, null] } : {}),
    ...(options.numeric ? { werte: [null, null, null, "10.00", null, null, null] } : {}),
    ...(options.checkbox ? { werte: [null, null, null, null, "true", null, null] } : {}),
    ...(options.callerCatalog ? { pageObjectsCatalog: copy(enumCatalog) } : {}) };
  const catalog = options.catalogMissing ? undefined : copy(enumCatalog);
  if (options.profileWrongSection) catalog.pages.synthetic.tables.exact.automationIdSection = "OtherSection";
  if (options.profileWrongOccurrence) catalog.pages.synthetic.tables.exact.sumOccurrence = 2;
  if (options.profileAmbiguous) catalog.pages.synthetic.tables.duplicate = copy(catalog.pages.synthetic.tables.exact);
  const result = options.publicRead || options.appendSeek
    ? await executeTableCursorRead({ hwnd: 111, noKeys: false, sumLabel: "Summe" }, worker, { qtNativeClient: client }, 30000, undefined, options.appendSeek === true)
    : await executeTableCursorMutation(operation, args, worker, { qtNativeClient: client }, 30000, undefined, catalog);
  return { result, keys, positions, mutations, focuses, probes, releases, preparations };
}
for (const operation of ["table_update", "table_delete"]) {
  const result = await run({ operation });
  assert.equal(result.result.ok, true); assert.equal(result.result.nativeUntouchedRowsVerified, true);
  assert.deepEqual(result.keys, []); assert.equal(result.positions.length, 1); assert.equal(result.focuses.length, 1); assert.equal(result.mutations.length, 1);
  assert.equal(result.releases.length, 1); assert.equal(result.probes.length, 1);
  assert.equal(JSON.stringify(result.result).includes("SyntheticCaller"), false);
  for (const field of ["cursorBinding", "mutationTarget", "__tableMutationBinding", "__tableTransportCapability"]) assert.equal(Object.hasOwn(result.result, field), false);
}
for (const operation of ["table_update", "table_delete"]) {
  const unselected = await run({ operation, initial: model => {
    model.cursorFocusBinding.currentIndex = [-1, -1]; model.cursorFocusBinding.selectedIndexes = [];
  } });
  assert.equal(unselected.result.ok, true);
  assert.equal(unselected.positions.length, 1);
  assert.equal(unselected.mutations.length, 1);
  const acquired = await run({ operation, acquireFocusFails: true });
  assert.equal(acquired.result.outcomeUnknown, true);
  assert.equal(acquired.result.activationSubmitted, true);
  assert.equal(acquired.result.mutationStarted, null);
  assert.equal(acquired.result.resultingState, "unknown");
  assert.equal(acquired.positions.length, 0);
  assert.equal(acquired.mutations.length, 0);
}
const rejectedCheckpoint = await run({ positionCheckpointFails: true });
assert.equal(rejectedCheckpoint.result.outcomeUnknown, true);
assert.equal(rejectedCheckpoint.result.activationSubmitted, true);
assert.equal(rejectedCheckpoint.result.phase, "native-position-checkpoint");
assert.equal(rejectedCheckpoint.result.proofCheck, "native-position-checkpoint-worker-result");
assert.equal(rejectedCheckpoint.result.cursorActivation.nativePosition.operation, "table_focus_only");
assert.equal(rejectedCheckpoint.result.cursorActivation.positionCheckpoint.reason, "target-proof");
assert.equal(rejectedCheckpoint.result.cursorActivation.positionCheckpoint.proofReason, "current-number-cell-not-selected");
assert.equal(rejectedCheckpoint.result.cursorActivation.positionCheckpoint.targetProven, false);
assert.equal(JSON.stringify(rejectedCheckpoint.result).includes("synthetic-private-checkpoint-authority"), false);
assert.equal(rejectedCheckpoint.result.mutationStarted, null);
assert.equal(rejectedCheckpoint.positions.length, 1);
assert.equal(rejectedCheckpoint.mutations.length, 0);
const clippedCheckpoint = await run({ clipped: true });
assert.equal(clippedCheckpoint.result.cursorActivation.positionCheckpoint.proofReason, "current-number-row-outside-native-viewport");
for (const operation of ["table_update", "table_delete"]) {
  const changedIdentity = await run({ operation, tableIdentityChanged: true });
  assert.equal(changedIdentity.result.ok, false);
  assert.equal(changedIdentity.result.proofCheck, "mutation-native-structure-summary");
  assert.equal(changedIdentity.result.outcomeUnknown, true);
  assert.equal(changedIdentity.mutations.length, 1);
  const badRowCount = await run({ operation, tableRowsChanged: true });
  assert.equal(badRowCount.result.ok, false);
  assert.equal(badRowCount.result.proofCheck, "mutation-native-table-row-count");
  const absent = await run({ operation, initial: model => { delete model.table.rows; } });
  assert.equal(absent.result.ok, true);
  for (const drift of [
    { tableRowsRemoved: true },
    { tableRowsAdded: true, initial: model => { delete model.table.rows; } },
  ]) {
    const presenceChanged = await run({ operation, ...drift });
    assert.equal(presenceChanged.result.ok, false);
    assert.equal(presenceChanged.result.proofCheck, "mutation-native-table-row-count");
    assert.equal(presenceChanged.mutations.length, 1);
  }
  const priorMismatch = await run({ operation, initial: model => { model.table.rows++; } });
  assert.equal(priorMismatch.result.ok, false);
  assert.equal(priorMismatch.result.proofCheck, "mutation-native-table-row-count");
  assert.equal(priorMismatch.result.outcomeUnknown, false);
  assert.equal(priorMismatch.result.mutationStarted, false);
  assert.equal(priorMismatch.positions.length, 0);
  assert.equal(priorMismatch.mutations.length, 0);
}
const profiledRead = await run({ publicRead: true });
assert.equal(profiledRead.result.ok, true); assert.deepEqual(profiledRead.keys, ["home", ...Array(9).fill("down")]);
assert.equal(profiledRead.mutations.length, 0);
for (const options of [{ positionModelChanged: true }, { wrongSelection: true }]) {
  const append = await run({ ...options, appendSeek: true });
  assert.equal(append.result.ok, false);
  assert.equal(append.result.outcomeUnknown, true, "A dispatched position with failed model/selection proof cannot retain the initial unchanged claim.");
  assert.equal(append.result.reconciliationRequired, true);
  assert.equal(append.mutations.length, 0);
  const mutation = await run(options);
  assert.equal(mutation.result.ok, false);
  assert.equal(mutation.result.outcomeUnknown, true);
  assert.equal(mutation.result.mutationStarted, null, "An unknown cursor outcome must not claim globally that no mutation occurred.");
  assert.equal(mutation.mutations.length, 0);
}
const unknownCursorMutation = await run({ positionUnknown: true });
assert.equal(unknownCursorMutation.result.outcomeUnknown, true);
assert.equal(unknownCursorMutation.result.mutationStarted, null);
for (const expireAt of [2, 3]) {
  let now = 0, reads = 0;
  mock.method(performance, "now", () => now);
  try {
    const expired = await run({ appendSeek: true, read: () => { if (++reads === expireAt) now = 30_000; } });
    assert.equal(expired.result.ok, false);
    assert.equal(expired.positions.length, expireAt === 2 ? 0 : 1);
    assert.equal(expired.focuses.length, 0);
    assert.equal(expired.releases.length, 1, "A budget rejected before dispatch must release its owned passive lease.");
    assert.notEqual(expired.result.cleanupRequired, true);
    assert.equal(expired.result.activationSubmitted, expireAt !== 2);
    assert.equal(expired.result.outcomeUnknown, expireAt !== 2);
  } finally { mock.restoreAll(); }
}
for (const appendSeek of [true, false]) {
  let now = 0;
  mock.method(performance, "now", () => now);
  try {
    const expired = await run({ appendSeek, geometryDone: (op, positionCount, focusCount) => {
      if (op === "objects" && positionCount === 1 && focusCount === 1) now = 30_000;
    } });
    assert.equal(expired.result.ok, false);
    assert.equal(expired.result.phase, "native-position-checkpoint");
    assert.equal(expired.positions.length, 1); assert.equal(expired.focuses.length, 1);
    assert.equal(expired.releases.length, 1, "A checkpoint not dispatched because of the deadline must retain and release its own lease.");
    assert.notEqual(expired.result.cleanupRequired, true);
  } finally { mock.restoreAll(); }
}
for (const options of [{}, { freshNumberEditor: true }, { initial: model => { model.hiddenRows = [9]; } },
  { initial: model => { model.cursorFocusBinding.currentIndex = [-1, -1]; model.cursorFocusBinding.selectedIndexes = []; } }]) {
  const append = await run({ ...options, appendSeek: true });
  assert.equal(append.result.ok, true);
  assert.equal(append.result.vollstaendig, true);
  assert.equal(append.result.nativeWholeModelUnchanged, true);
  assert.equal(append.result.physicalInputUsed, false);
  assert.deepEqual(append.keys, []);
  assert.equal(append.positions.length, 1);
  assert.equal(append.probes.length, 0);
  assert.equal(append.mutations.length, 0);
  assert.equal(append.releases.length, 1);
  for (const field of ["cursorBinding", "cursorLease", "numberModel", "numberPolicy"]) {
    assert.equal(Object.hasOwn(append.result, field), false);
  }
}
for (const options of [{ noPositionProtocol: true }, { noPositionAck: true }, { wrongPosition: true },
  { positionModelChanged: true }, { clipped: true }, { freshNumberEditor: true, numberClosureFails: true }]) {
  const failedAppend = await run({ ...options, appendSeek: true });
  assert.equal(failedAppend.result.ok, false);
  assert.deepEqual(failedAppend.keys, []);
  assert.equal(failedAppend.mutations.length, 0);
}
const freshNumber = await run({ freshNumberEditor: true });
assert.equal(freshNumber.result.ok, true); assert.equal(freshNumber.preparations.length, 1);
assert.equal(freshNumber.positions.length, 1); assert.equal(freshNumber.focuses.length, 1); assert.equal(freshNumber.mutations.length, 1);
assert.deepEqual(freshNumber.keys, []); assert.equal(freshNumber.releases.length, 1);
for (const options of [{ freshNumberEditor: true, numberClosureFails: true }, { freshNumberEditor: true, replayedNumberLease: true }]) {
  const failedNumber = await run(options); assert.equal(failedNumber.result.ok, false);
  assert.equal(failedNumber.focuses.length, 0); assert.equal(failedNumber.mutations.length, 0); assert.equal(failedNumber.releases.length, 0);
  assert.equal(failedNumber.result.cleanupRequired, true); assert.deepEqual(failedNumber.keys, []);
}
const pendingChangedModel = await run({ freshNumberEditor: true, positionModelChanged: true });
assert.equal(pendingChangedModel.result.ok, false); assert.equal(pendingChangedModel.releases.length, 0);
assert.equal(pendingChangedModel.mutations.length, 0); assert.equal(pendingChangedModel.result.cleanupRequired, true);
const replayedOldAuthority = await run({ freshNumberEditor: true, replayedPositionInitialLease: true });
assert.equal(replayedOldAuthority.result.ok, false); assert.equal(replayedOldAuthority.mutations.length, 0);
assert.equal(replayedOldAuthority.result.cleanupRequired, true); assert.deepEqual(replayedOldAuthority.keys, []);
const nativeUnknown = await run({ positionUnknown: true });
assert.equal(nativeUnknown.result.proofCheck, "native-position-acknowledgment");
assert.equal(nativeUnknown.result.outcomeUnknown, true);
assert.equal(nativeUnknown.result.cursorActivation.activationAttempted, true);
const nativeProof = nativeUnknown.result.cursorActivation.nativePosition;
assert.equal(nativeProof.operation, "table_position_number");
assert.equal(nativeProof.replyReceived, true); assert.equal(nativeProof.code, "position-outcome-unknown");
assert.equal(nativeProof.reason, "new-number-accessible-identity");
assert.equal(nativeProof.mutationAttempted, true); assert.equal(nativeProof.outcomeUnknown, true);
assert.equal(nativeProof.receiptPresent, false); assert.equal(nativeProof.receiptAcknowledged, false);
assert.equal(nativeProof.ok, false); assert.equal(nativeProof.completed, null);
assert.equal(nativeProof.inputEpochMatches, null); assert.equal(nativeProof.numberEditorPending, null);
assert.equal(nativeUnknown.positions.length, 1); assert.equal(nativeUnknown.focuses.length, 0);
assert.equal(nativeUnknown.mutations.length, 0); assert.equal(nativeUnknown.releases.length, 0); assert.deepEqual(nativeUnknown.keys, []);
const nativeTimeout = await run({ positionUnknown: true, nativeCode: "GUI_OPERATION_TIMEOUT",
  nativeReason: "Operation is still executing on the GUI thread; verify its outcome before retry" });
assert.equal(nativeTimeout.result.cursorActivation.nativePosition.reason, "gui-operation-running");
assert.equal(nativeTimeout.result.cursorActivation.nativePosition.code, "GUI_OPERATION_TIMEOUT");
assert.equal(nativeTimeout.positions.length, 1); assert.equal(nativeTimeout.releases.length, 0);
const untrustedNative = await run({ positionUnknown: true, nativeCode: "Synthetic private code", nativeReason: "Synthetic private text",
  nativePayload: { nonce: "Synthetic authority", mutationReceipt: "987654321", binding: copy(base.cursorFocusBinding),
    values: ["Synthetic private value"], positioned: "true", inputTick: "123", physicalInputUsed: "false" } });
const untrustedProof = untrustedNative.result.cursorActivation.nativePosition;
assert.equal(untrustedProof.code, "unrecognized"); assert.equal(untrustedProof.reason, "unrecognized");
assert.equal(untrustedProof.completed, null); assert.equal(untrustedProof.inputEpochMatches, null); assert.equal(untrustedProof.physicalInputUsed, null);
assert.equal(untrustedProof.receiptPresent, true); assert.equal(untrustedProof.receiptFormatValid, true);
assert.deepEqual(Object.keys(untrustedProof).sort(), ["operation", "replyReceived", "code", "reason", "ok", "completed", "physicalInputUsed",
  "inputEpochMatches", "mutationAttempted", "outcomeUnknown", "receiptPresent", "receiptFormatValid", "receiptAcknowledged",
  "numberEditorPending", "transportKind"].sort());
for (const forbidden of ["Synthetic private", "Synthetic authority", "987654321", "modelFingerprint", "selectedIndexes", "currentIndex"])
  assert.equal(JSON.stringify(untrustedNative.result).includes(forbidden), false, "Raw result values or authority must never enter the diagnostic.");
const lostNativeAck = await run({ positionAckThrows: true });
const lostProof = lostNativeAck.result.cursorActivation.nativePosition;
assert.equal(lostProof.replyReceived, true); assert.equal(lostProof.receiptAcknowledged, null);
assert.equal(lostProof.receiptPresent, true); assert.equal(lostProof.receiptFormatValid, true);
assert.equal(lostProof.transportKind, "native-mutation-receipt"); assert.equal(lostProof.inputEpochMatches, true);
assert.equal(lostNativeAck.result.outcomeUnknown, true); assert.equal(lostNativeAck.positions.length, 1);
assert.equal(lostNativeAck.releases.length, 0); assert.equal(lostNativeAck.mutations.length, 0);
assert.equal(JSON.stringify(lostNativeAck.result).includes("987654321"), false);
const rid = await run({ targetRid: "Caller.exact.rid" });
assert.equal(rid.result.ok, true); assert.equal(rid.probes.length, 2);
assert.equal(rid.mutations[0].args.targetRid, "Caller.exact.rid", "A supplied RID is never discarded or substituted.");
const hidden = await run({ hiddenColumn: true });
assert.equal(hidden.result.ok, true); assert.equal(hidden.result.nativeTargetRowVerified, true);
assert.equal(hidden.mutations.length, 1, "An unchanged hidden target cell remains part of the complete model proof.");
const category = await run({ category: true });
assert.equal(category.result.ok, true, "Known typed category numeric EditRole is bound before writing.");
assert.equal(category.mutations.length, 1);
const date = await run({ date: "02.01", initial: model => { model.values[0][1] = { ...scalar("02.01"), edit: "2026-01-02" }; } });
assert.equal(date.result.ok, true, "A concrete existing native date display/edit pair is preserved exactly.");
assert.equal(date.mutations.length, 1);
assert.equal((await run({ numeric: true })).result.ok, true, "Proven native amount roles retain numeric equivalence.");
assert.equal((await run({ checkbox: true })).result.ok, true, "Requested checkbox state and native bool role are both proven.");
for (const options of [
  { category: true, enumUnknown: true }, { category: true, enumAmbiguous: true }, { category: true, catalogMissing: true },
  { category: true, profileWrongSection: true }, { category: true, profileWrongOccurrence: true }, { category: true, profileAmbiguous: true },
  { category: true, catalogMissing: true, callerCatalog: true },
  { date: "03.01" }, { date: "02.01", initial: model => {
    model.values[0][1] = { ...scalar("02.01"), edit: "2026-01-02" }; model.values[1][1] = { ...scalar("02.01"), edit: "Other role" };
  } }, { initial: model => { model.values[7][2].edit = 99; } },
]) {
  const failure = await run(options); assert.equal(failure.result.ok, false);
  assert.equal(failure.result.phase, "mutation-requested-role-preflight");
  assert.deepEqual(failure.keys, []); assert.equal(failure.focuses.length, 0); assert.equal(failure.mutations.length, 0);
  assert.equal(failure.result.outcomeUnknown, false, "Missing format authority is rejected before any write.");
}
for (const options of [
  { initial: model => { model.values[1][2] = scalar("Target"); } },
  { initial: model => { model.hiddenRows = [7]; } },
  { targetRid: "Caller.stale.rid", staleRid: true },
  { initial: (model, binding) => { binding.snapshot.navigationBinding.heading = "Other page"; } },
  { initial: model => { model.summary = "101,00"; } },
]) {
  const failure = await run(options); assert.equal(failure.result.ok, false); assert.deepEqual(failure.keys, []);
  assert.equal(failure.mutations.length, 0);
}
for (const options of [{ focusNoop: true }, { clipped: true }, { probeFails: true }, { noPositionProtocol: true },
  { positionNoop: true }, { positionRejects: true }, { noPositionAck: true }, { positionThrows: true },
  { wrongPosition: true }, { wrongSelection: true }, { positionEpochChanged: true }, { positionModelChanged: true },
  { positionFlagsChanged: true }, { positionCheckpointFails: true }, { positionCheckpointEpochChanged: true }, { replayedPositionLease: true }]) {
  const failure = await run(options); assert.equal(failure.result.ok, false); assert.equal(failure.mutations.length, 0);
  assert.deepEqual(failure.keys, [], "Positioning has no physical-key or stepped-reader fallback.");
  assert.ok(failure.positions.length <= 1, "No positioning replay after failed proof.");
  if (options.positionThrows) {
    assert.equal(failure.releases.length, 0, "Unknown native completion must not trigger focus restore.");
    assert.equal(failure.result.cleanupRequired, true); assert.equal(failure.result.outcomeUnknown, true);
  }
}
for (const options of [{ workerFails: true }, { workerThrows: true }, { otherRowChanged: true },
  { targetChanged: true }, { targetEditChanged: true }, { targetOtherColumnChanged: true },
  { hiddenColumn: true, targetHiddenChanged: true }, { unverified: true }, { finalEpochChanged: true }]) {
  const failure = await run(options); assert.equal(failure.result.ok, false); assert.equal(failure.mutations.length, 1);
  assert.equal(failure.result.retryable, false);
}
for (const options of [{ category: true, enumWrongRole: true }, { category: true, enumWrongRole: "type" }, { date: "01.01", dateWrongRole: true }]) {
  const failure = await run(options); assert.equal(failure.result.ok, false); assert.equal(failure.mutations.length, 1);
  assert.equal(failure.result.proofCheck, "mutation-native-target-requested-edit"); assert.equal(failure.result.retryable, false);
}
console.log("table-native-mutation-contract: EDV7 exact native seek, immutable model, caller RID, one mutation and no retry passed");
