import assert from "node:assert/strict";
import { executeTableCursorRead } from "../dist/table-cursor-executor.js";

// All workers/native transports are synthetic. No desktop or process call.
const copy = value => structuredClone(value);
const aid = "Synthetic.RedThreadContent.DialogUI./.Synthetic.Table";
const focus = { tableId: 9, modelId: 10, tableAid: aid, tableName: "/.Synthetic.Table",
  currentIndex: [0, 0], selectedIndexes: [[0, 0]], modelFingerprint: "c".repeat(64) };
const model = { ok: true, controllerBound: true, windowEnabled: true, modalBlocked: false,
  rows: 2, readRows: 2, columns: 2, headers: ["Nr.", "Text"],
  values: [["", "Example"], ["", ""]].map(row => row.map(display => ({ display, edit: display, checkState: null, flags: 35 }))),
  rowFingerprints: ["1".repeat(64), "2".repeat(64)], hiddenColumns: [], hiddenRows: [], complete: true,
  canFetchMore: false, tableCount: 1, table: { id: 9, name: "/.Synthetic.Table", class: "DialogUITable", visible: true },
  summary: "4,00", binding: {}, summaries: [{ label: "Summe", vorkommen: 1, wert: "4,00" }], cursorFocusBinding: focus };
const binding = { hwnd: 111, pid: 7, inputEpoch: 123, dirty: true, dpi: 144, clientOrigin: [1000, 200],
  windowTitle: "Synthetic window", windowFingerprint: "a".repeat(64),
  snapshot: { kopf: ["Nr.", "Text"], navigationBinding: { complete: true, editorFree: true, heading: "Synthetic",
    tableRootAid: aid, tableRootRid: "42.777.4.-20", contentSignature: "b".repeat(64),
    headers: ["Nr.", "Text"].map((name, index) => ({ name, aid: `${aid}.${index}`, rid: `42.777.4.-${30 + index}` })) } } };
const lease = { schemaVersion: 1, nonce: "d50d2d7b-cc3c-4b89-ab78-9d0415b79077", rootHwnd: 111, targetPid: 7,
  inputEpoch: 123, previous: { hwnd: 222, pid: 8, start: "133000000000000001", class: "SyntheticCaller" }, previousCursor: null };

async function run(options = {}) {
  const calls = [], native = [];
  const controller = new AbortController();
  let reads = 0;
  const client = { binding: { hwnd: 111, pid: 7 }, request: async op => {
    native.push(op);
    if (op === "ping") {
      const result = { ok: true, pid: 7, hwnd: 111, recoveryRequired: false, mutationAcknowledgmentRequired: false,
        capabilities: { tableFocusOnlyProtocol: 1 } };
      options.ping?.(result);
      return { result };
    }
    assert.equal(op, "table_snapshot", "Native focus must not require viewport/cell-click geometry.");
    const result = copy(model);
    options.model?.(result, ++reads);
    return { result };
  }, requestAcknowledged: async (op, args) => {
    native.push(op);
    assert.equal(op, "table_focus_only");
    assert.equal(args.expectedWindowTitle, binding.windowTitle);
    assert.equal(args.expectedInputTick, 123);
    assert.deepEqual(args.binding, focus);
    if (options.abortFocus) { controller.abort(); throw new Error("Synthetic abort"); }
    if (options.throwFocus) throw new Error("Synthetic unknown transport");
    const result = { ok: true, focused: true, physicalInputUsed: false, inputTick: 123,
      mutationAttempted: true, binding: copy(focus) };
    options.focus?.(result);
    return { result, receiptAcknowledged: !options.noAck };
  } };
  const worker = async (op, args, timeout, signal) => {
    assert.equal(op, "table_read");
    const plan = args.__tableCursorPlan; calls.push(plan.phase);
    if (plan.phase === "prebind") return { ok: true, cursorBinding: copy(binding) };
    if (plan.phase === "native-acquire") {
      assert.equal(plan.binding.inputEpoch, 123);
      const acquired = { ok: true, cursorBinding: copy(binding), cursorLease: copy(lease), selectedRids: ["42.777.4.-23"] };
      options.acquire?.(acquired);
      return acquired;
    }
    if (plan.phase === "native-release") {
      assert.equal(timeout, 5000);
      assert.equal(signal, undefined, "A cancelled request must not cancel passive guarded cleanup.");
      assert.deepEqual(plan.lease, lease);
      assert.equal(plan.binding.inputEpoch, 123, "Release must not erase intervening input with a fresh baseline.");
      return options.releaseFails ? { ok: false } : { ok: true, cursorLeaseReleased: true };
    }
    if (plan.phase === "resume") {
      assert.equal(plan.binding.inputEpoch, 123);
      assert.deepEqual(plan.lease, lease);
      assert.deepEqual(plan.selectedRids, ["42.777.4.-23"]);
      const final = copy(binding); final.inputEpoch = 128;
      const resumed = { ok: true, cursorBinding: final, focusTelemetry: { releasedByEmit: true }, steps: 4, vollstaendig: true };
      options.resume?.(resumed);
      return resumed;
    }
    assert.equal(plan.phase, "checkpoint");
    assert.equal(plan.binding.inputEpoch, 128);
    return options.finalEpochChanged ? { ok: false } : { ok: true, cursorCheckpoint: true };
  };
  return { result: await executeTableCursorRead({ hwnd: 111, noKeys: false, sumLabel: "Summe" }, worker,
    { qtNativeClient: client }, 10000, controller.signal), calls, native };
}
const success = await run();
assert.equal(success.result.ok, true);
assert.equal(success.result.cursorTransaction, "native-focus-only");
assert.deepEqual(success.calls, ["prebind", "native-acquire", "resume", "checkpoint"]);
assert.equal(success.native.filter(op => op === "table_focus_only").length, 1);
assert.equal(JSON.stringify(success.result).includes("SyntheticCaller"), false);
assert.equal(JSON.stringify(success.result).includes("windowTitle"), false);

for (const options of [
  { noAck: true }, { throwFocus: true }, { focus: value => { value.inputTick++; } },
  { focus: value => { value.binding.currentIndex = [1, 0]; } },
  { focus: value => { value.physicalInputUsed = true; } },
  { focus: value => { value.focused = false; } },
  { model: (value, count) => { if (count === 3) value.values[1][1].display = "Changed blank"; } },
  { model: (value, count) => { if (count === 3) value.cursorFocusBinding.selectedIndexes = [[1, 0]]; } },
]) {
  const stopped = await run(options);
  assert.equal(stopped.result.ok, false);
  assert.equal(stopped.calls.includes("resume"), false, "Unknown/changed focus proof must never issue cursor keys.");
  assert.equal(stopped.calls.at(-1), "native-release", "Known handover must attempt only a passive, guarded release.");
  assert.equal(stopped.native.filter(op => op === "table_focus_only").length, 1, "Never replay a focus action.");
}
for (const options of [
  { model: value => { delete value.cursorFocusBinding; } },
  { model: value => { value.cursorFocusBinding.tableAid += ".Foreign"; } },
]) {
  const stopped = await run(options);
  assert.equal(stopped.result.ok, false);
  assert.deepEqual(stopped.calls, ["prebind"]);
  assert.equal(stopped.result.activationSubmitted, false);
}
const changedBefore = await run({ model: (value, count) => { if (count === 2) value.values[1][1].edit = "Changed hidden"; } });
assert.equal(changedBefore.result.ok, false);
assert.equal(changedBefore.native.includes("table_focus_only"), false);
const mismatchedCursor = await run({ model: value => { value.cursorFocusBinding.currentIndex = [1, 0]; } });
assert.equal(mismatchedCursor.result.ok, false);
assert.equal(mismatchedCursor.result.proofCheck, "native-focus-current-selection-alignment");
assert.equal(mismatchedCursor.native.includes("table_focus_only"), false, "Unselected native currentIndex must fail before focus or resume.");
assert.equal(mismatchedCursor.calls.includes("resume"), false);
const cleanup = await run({ throwFocus: true, releaseFails: true });
assert.equal(cleanup.result.cleanupRequired, true);
const finalEpoch = await run({ finalEpochChanged: true });
assert.equal(finalEpoch.result.ok, false);
assert.equal(finalEpoch.result.proofCheck, "native-focus-final-epoch");
assert.equal(finalEpoch.calls.includes("native-release"), false, "Consumed lease is never reacquired after input interference.");
for (const released of [true, false]) {
  const failure = await run({ resume: value => {
    value.ok = false; value.kind = "interference"; value.error = "Synthetic cursor selection changed.";
    value.steps = 0; value.focusTelemetry.releasedByEmit = released;
    value.cursorActivation = { phase: "resume-before-keys", reason: "cursor-activation-exception",
      subphase: "resume-selection-proof", exceptionMessage: "Synthetic selection is no longer bound.",
      resumeProof: { liveInputOk: false, selectionIdentical: false, navigationGuardPassed: null,
        liveInput: { reason: "keyboard-focus-is-not-table-or-cell", keyboardEvidence: { focusedSource: { type: "Edit", processId: 7 } } } } };
    value.navigationEvidence = { phase: "resume-before-keys", keyboardAndSummaryBound: false };
    value.cursorLease = copy(lease); value.selectedRids = ["42.777.4.-23"];
  } });
  assert.equal(failure.result.ok, false);
  assert.equal(failure.result.kind, "interference", "Actual worker rejection must not be relabelled as failed lease consumption.");
  assert.equal(failure.result.error, "Synthetic cursor selection changed.");
  assert.equal(failure.result.proofCheck, "native-focus-resume-worker-result");
  assert.equal(failure.result.cursorActivation.subphase, "resume-selection-proof");
  assert.equal(failure.result.navigationEvidence.keyboardAndSummaryBound, false);
  assert.equal(failure.result.cursorActivation.resumeProof.liveInput.keyboardEvidence.focusedSource.type, "Edit");
  assert.deepEqual(failure.result.nativeCursorFocusEvidence, { currentIndex: [0, 0], selectedIndexCount: 1,
    selectedIndexes: [[0, 0]], selectedIndexesTruncated: false, focusActionVerified: true });
  for (const key of ["tableName", "tableAid", "modelFingerprint", "windowTitle", "nonce", "rootHwnd"]) {
    assert.equal(Object.hasOwn(failure.result.nativeCursorFocusEvidence, key), false, "Native diagnostics must expose only bounded model cursor coordinates.");
  }
  assert.equal(failure.result.reconciliationRequired, true);
  assert.equal(failure.result.retryable, false);
  assert.equal(failure.calls.includes("checkpoint"), false, "A rejected resume cannot reach final success checks.");
  assert.equal(failure.calls.includes("native-release"), !released, "Worker rejection does not remove the independent lease cleanup requirement.");
  for (const key of ["cursorBinding", "cursorLease", "selectedRids", "cursorInputEpoch"]) {
    assert.equal(Object.hasOwn(failure.result, key), false, "Private handover authority must not escape in failure diagnostics.");
  }
}
const unreleased = await run({ resume: value => { value.focusTelemetry.releasedByEmit = false; } });
assert.equal(unreleased.result.ok, false);
assert.equal(unreleased.result.proofCheck, "native-focus-resume-lease-completion");
assert.equal(unreleased.calls.at(-1), "native-release", "A successful worker cannot bypass the required Emit release proof.");
const aborted = await run({ abortFocus: true });
assert.equal(aborted.result.ok, false);
assert.equal(aborted.calls.at(-1), "native-release");
for (const change of [value => {value.recoveryRequired = true;}, value => {value.mutationAcknowledgmentRequired = true;},
  value => {value.hwnd = 222;}, value => {value.pid = 8;}]) {
  const blocked = await run({ ping: change });
  assert.equal(blocked.result.ok, false);
  assert.equal(blocked.result.proofCheck, "native-session-not-ready");
  assert.deepEqual(blocked.calls, ["prebind"], "Blocked native session must not prepare focus or fall back.");
}
const isolation = await run({ acquire: value => {value.ok = false; value.kind = "worker-isolation-lost"; delete value.cursorLease;} });
assert.equal(isolation.result.cleanupRequired, true);
assert.equal(isolation.native.includes("table_focus_only"), false);
console.log("table-native-focus-contract: private handover/ack/full-model/epoch/no-replay checks passed");
