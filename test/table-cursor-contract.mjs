import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executeTableCursorRead, tableCursorModelFingerprint } from "../dist/table-cursor-executor.js";
import { SSE_MCP_UI_SCHEMAS } from "../dist/mcp-schemas-ui.js";

// Synthetic clients only: no process, transport, real Worker or physical input.
const copy = value => structuredClone(value);
const aid = "Synthetic.RedThreadContent.DialogUI./.Synthetic.Table";
const cell = display => ({ display, edit: display, checkState: null, flags: 35 });
const model = {
  ok: true, controllerBound: true, windowEnabled: true, modalBlocked: false,
  rows: 3, readRows: 3, columns: 2, headers: ["Nr.", "Text"],
  values: [[cell(""), cell("Example")], [cell(""), cell("Hidden")], [cell(""), cell("")]],
  rowFingerprints: ["1".repeat(64), "2".repeat(64), "3".repeat(64)],
  hiddenColumns: [], hiddenRows: [1], complete: true, canFetchMore: false, tableCount: 1,
  table: { id: 9, name: "/.Synthetic.Table", class: "DialogUITable", visible: true },
  summary: "4,00", binding: { section: "Synthetic" }, summaries: [{ label: "Summe", vorkommen: 1, wert: "4,00" }],
};
const node = (i, p, type, name, x, width) => ({
  i, p, d: p < 0 ? 0 : 1, type, name, aid: i === 0 ? aid : `${aid}.${i}`, rid: `42.777.4.-${20 + i}`,
  x, y: 200, w: width, h: i === 0 ? 300 : 30, on: true,
  val: null, ro: null, checked: null, selected: null, scroll: null,
});
const snapshot = {
  ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 111,
  windowEnabled: true, modalBlocked: false, windowRect: { x: 900, y: 100, w: 1000, h: 800 }, exactMatches: {},
  nodes: [node(0, -1, "Table", "", 1000, 600), node(1, 0, "Header", "Nr.", 1000, 80), node(2, 0, "Header", "Text", 1080, 520)],
  stats: { n: 3, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
    valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 },
};
const objects = {
  ok: true, complete: true, windowEnabled: true, modalBlocked: false,
  objects: [
    { id: 9, parentId: 0, name: "/.Synthetic.Table", class: "DialogUITable", visible: true, enabled: true,
      rootRect: [0, 0, 400, 200], nativeScreenRect: [1000, 200, 600, 300] },
    { id: 10, parentId: 9, name: "qt_scrollarea_viewport", class: "QWidget", visible: true, enabled: true,
      rootRect: [4, 30, 392, 166], nativeScreenRect: [1006, 245, 588, 249] },
  ],
};
const binding = {
  hwnd: 111, pid: 7, inputEpoch: 123, dirty: true, dpi: 144, clientOrigin: [1000, 200], windowTitle: "Synthetic window",
  windowFingerprint: "a".repeat(64),
  snapshot: { kopf: ["Nr.", "Text"], tabelleAnzahl: 1, error: null,
    navigationBinding: { complete: true, editorFree: true, heading: "Synthetic", tableRootAid: aid,
      headers: snapshot.nodes.slice(1).map(value => ({ rid: value.rid, aid: value.aid, name: value.name })),
      tableRootRid: "42.777.4.-20", contentSignature: "b".repeat(64) } },
};
for (const privateField of ["__tableCursorPlan", "inputEpoch", "geometry", "selectedRids", "clientOrigin"]) {
  assert.equal(SSE_MCP_UI_SCHEMAS.sse_table_read.safeParse({ noKeys: false, [privateField]: {} }).success, false,
    "A public caller must not supply internal cursor authority.");
}

async function run(options = {}) {
  const calls = [], native = [];
  let reads = 0;
  const client = {
    binding: { hwnd: 111, pid: options.foreignPid ? 8 : 7 },
    request: async (op, args) => {
      native.push(op);
      let result;
      if (op === "table_snapshot") {
        result = copy(model);
        options.model?.(result, ++reads);
        assert.equal(args.maxRows, 1000);
      } else if (op === "ping") {
        result = { ok: true, pid: 7, hwnd: 111, recoveryRequired: false, mutationAcknowledgmentRequired: false };
      } else if (op === "accessibility_snapshot") {
        result = copy(snapshot); options.snapshot?.(result);
      } else if (op === "objects") {
        result = copy(objects); options.objects?.(result);
      } else throw new Error(`Unexpected synthetic request ${op}`);
      return { result, durationMs: 1 };
    },
  };
  const worker = async (op, args) => {
    assert.equal(op, "table_read");
    assert.equal(args.noKeys, false);
    const plan = args.__tableCursorPlan;
    calls.push(plan.phase);
    if (plan.phase === "prebind") {
      const current = copy(binding); options.binding?.(current);
      return { ok: true, cursorBinding: current, physicalInputUsed: false };
    }
    if (plan.phase === "activate") {
      assert.equal(plan.binding.inputEpoch, 123, "Native proof must not reset the original input epoch.");
      assert.deepEqual(plan.geometry, { coordinateSpace: "qt-native-screen", tableRect: [0, 0, 400, 200], viewportRect: [4, 30, 392, 166],
        nativeTableRect: [1000, 200, 600, 300], nativeViewportRect: [1006, 245, 588, 249] });
      if (options.noSpace) return { ok: false, kind: "cursor-unavailable", physicalInputUsed: false, steps: 0, vollstaendig: false };
      if (options.inputChanged) return { ok: false, kind: "interference", physicalInputAttempted: false, steps: 0 };
      const after = copy(binding); after.inputEpoch = 124;
      options.afterBinding?.(after);
      return { ok: true, cursorBinding: after, selectedRids: ["42.777.4.-23"], physicalInputUsed: true };
    }
    if (plan.phase === "checkpoint") {
      assert.equal(plan.binding.inputEpoch, 128, "Final checkpoint must inherit the last own key epoch.");
      return options.finalInputChanged ? { ok: false, kind: "interference" } : { ok: true, cursorCheckpoint: true };
    }
    assert.equal(plan.phase, "resume");
    assert.equal(plan.binding.inputEpoch, 124, "Cursor must inherit exactly the proven own click epoch.");
    assert.deepEqual(plan.selectedRids, ["42.777.4.-23"]);
    const finalBinding = copy(binding); finalBinding.inputEpoch = 128;
    return { ok: true, cursorBinding: finalBinding, vollstaendig: true, steps: 4, zeilen: [["", "Example"]] };
  };
  const result = await executeTableCursorRead({ hwnd: 111, noKeys: false, sumLabel: "Summe", sumOccurrence: 1 }, worker,
    { qtNativeClient: client }, 10_000);
  return { result, calls, native };
}

const success = await run();
assert.equal(success.result.ok, true);
assert.equal(success.result.nativeWholeModelUnchanged, true);
assert.deepEqual(success.calls, ["prebind", "activate", "resume", "checkpoint"]);
assert.deepEqual(success.native, ["table_snapshot", "ping", "accessibility_snapshot", "objects", "table_snapshot", "table_snapshot"]);
assert.equal(JSON.stringify(success.result).includes("inputEpoch"), false, "Private authority must not escape.");

for (const change of [
  value => { value.values[2][1].display = "Changed blank"; },
  value => { value.values[1][1].edit = "Changed hidden"; },
  value => { value.values[0][0].flags = 1; },
  value => { value.hiddenRows = []; },
  value => { value.values[0][0].checkState = 2; },
  value => { value.summary = "5,00"; },
]) {
  const changed = copy(model); change(changed);
  assert.notEqual(tableCursorModelFingerprint(changed), tableCursorModelFingerprint(model));
  const stopped = await run({ model: (value, count) => { if (count >= 2) change(value); } });
  assert.equal(stopped.result.ok, false);
  assert.deepEqual(stopped.calls, ["prebind", "activate"], "Changed full model must never reach cursor keys.");
  assert.equal(stopped.result.reconciliationRequired, true);
}
const finalChange = await run({ model: (value, count) => { if (count === 3) value.values[2][1].display = "Changed final blank"; } });
assert.equal(finalChange.result.ok, false);
assert.equal(finalChange.result.phase, "native-final-readback");

for (const options of [
  { foreignPid: true },
  { model: value => { value.complete = false; } },
  { snapshot: value => { value.stats.truncated = true; } },
  { snapshot: value => { value.nodes[0].aid += ".Foreign"; } },
  { snapshot: value => { value.nodes[1].name = "Wrong header"; } },
  { snapshot: value => { value.nodes[0].w = 400; } },
  { snapshot: value => { value.nodes[0].x += 20; } },
  { objects: value => { value.objects[1].parentId = 8; } },
  { objects: value => { value.objects.push({ ...value.objects[1], id: 11 }); } },
  { objects: value => { value.objects.push({ ...value.objects[0], id: 12 }); } },
  { objects: value => { value.objects[1].rootRect = [4, 30, 500, 166]; } },
  { binding: value => { value.snapshot.navigationBinding.editorFree = false; } },
]) {
  const stopped = await run(options);
  assert.equal(stopped.result.ok, false);
  assert.deepEqual(stopped.calls, ["prebind"], "Invalid native binding must stop before focus/input.");
  assert.equal(stopped.result.outcomeUnknown, false);
}
for (const options of [{ noSpace: true }, { inputChanged: true }]) {
  const stopped = await run(options);
  assert.equal(stopped.result.ok, false);
  assert.deepEqual(stopped.calls, ["prebind", "activate"]);
  assert.equal(stopped.result.steps, 0);
  assert.equal(stopped.result.nativeWholeModelUnchanged, true);
}
const changedContext = await run({ afterBinding: value => { value.dirty = false; } });
assert.equal(changedContext.result.ok, false);
assert.deepEqual(changedContext.calls, ["prebind", "activate"]);
const finalInputChanged = await run({ finalInputChanged: true });
assert.equal(finalInputChanged.result.ok, false);
assert.equal(finalInputChanged.result.phase, "passive-final-checkpoint");
assert.equal(finalInputChanged.result.reconciliationRequired, true);
const rowHeaders = await run({ snapshot: value => {
  for (let i = 3; i < 30; i++) value.nodes.push(node(i, 0, "Header", "", 1000, 2));
  value.stats.n = value.nodes.length;
} });
assert.equal(rowHeaders.result.ok, true, "Empty row headers must not replace exact prebound column headers.");
const wrongHeader = await run({ snapshot: value => { value.nodes[1].name = "Wrong"; } });
assert.equal(wrongHeader.result.proofCheck, "native-column-header-identity");
const geometryFailure = await run({ snapshot: value => { value.nodes[0].x += 3; } });
assert.deepEqual(geometryFailure.calls, ["prebind"]);
assert.equal(geometryFailure.result.activationSubmitted, false); assert.equal(geometryFailure.result.physicalInputAttempted, false);
assert.equal(geometryFailure.result.cursorActivation.activationAttempted, false);
assert.equal(geometryFailure.result.cursorActivation.nativeViewport.checks.xMatch, false);
assert.deepEqual(geometryFailure.result.cursorActivation.nativeViewport.expectedPhysicalRect, [1000, 200, 600, 300]);

const workerText = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");
const compositeText = readFileSync(new URL("../src/table-cursor-executor.ts", import.meta.url), "utf8");
const bridgeText = readFileSync(new URL("../native/qt/bridge.cpp", import.meta.url), "utf8");
const producer = bridgeText.split("static Json nativeWidgetScreenRect(QWidget *widget) {")[1]?.split("\nstatic Json execute(")[0];
assert.ok(producer, "The producer must have one concrete native-screen implementation.");
assert.match(producer, /belongsTo\(widget, boundRoot\)[\s\S]*QAccessible::queryAccessibleInterface\(widget\)[\s\S]*accessibleWindow\(iface\)/);
assert.match(producer, /window->handle\(\)[\s\S]*window->winId\(\)[\s\S]*pid != GetCurrentProcessId\(\)/);
assert.match(producer, /widget->mapToGlobal\(QPoint\(0, 0\)\)[\s\S]*QHighDpi::toNativePixels\(QRectF\(QPointF\(global\), QSizeF\(widget->size\(\)\)\), window\)/);
assert.doesNotMatch(producer, /GetDpiForWindow|SetFocus|SetForegroundWindow|createWinId|\/\s*96/);
assert.match(bridgeText, /qobject_cast<QTableView\*>\(widget\)[\s\S]*qt_scrollarea_viewport[\s\S]*qobject_cast<QTableView\*>\(widget->parentWidget\(\)\)[\s\S]*nativeScreenRect/);
assert.match(workerText, /Test-SSELastInputUnchanged \$inherited\.inputEpoch/);
assert.match(workerText, /Test-SSETableReadViewportPoint/);
assert.match(compositeText, /readQtNativeCompleteTable[\s\S]*phase\("activate"[\s\S]*readQtNativeCompleteTable[\s\S]*phase\("resume"/);
console.log("table-cursor-contract: synthetic composite/full-model/private-epoch checks passed");
