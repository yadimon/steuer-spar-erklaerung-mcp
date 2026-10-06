import assert from "node:assert/strict";
import { executeQtNativeOperation, isQtNativeOperation } from "../dist/qt-native-executor.js";
import { detailBindingFingerprint, receiptList, receiptPolicySchema } from "../dist/qt-native-receipts.js";
import { QtNativeAcknowledgmentError } from "../dist/qt-native-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";

const profile = loadProductProfile("2025");
const policy = receiptPolicySchema.parse(profile.pageObjectsCatalog.windows.receiptManager);
const initial = { title: "Synthetic receipt", date: "2025-01-01", documentNumber: "DOC-1", amount: "12,34",
  vatRate: "19", net: false, note: "Original note" };
const requested = { title: "Literal +^%~(){}[] äÖß Україна 🚀", date: "2025-01-15", documentNumber: "DOC-2",
  amount: "13.4", vatRate: "7", net: true, note: "Ελληνικά 🚀\nSecond line" };

function fixture(options = {}) {
  const beforeValues = { ...initial, ...options.initialValues };
  const values = { ...beforeValues }, actions = [];
  let open = false, closed = false;
  const makeNodes = () => {
    const nodes = [];
    const add = (type, name, aid, extra = {}) => {
      const i = nodes.length;
      nodes.push({ i, p: i ? 0 : -1, d: i ? 1 : 0, type, name, aid,
        rid: i ? `42.84.4.${i + 1}` : "42.84", x: 100, y: 20 + i, w: 80, h: 20,
        on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
    };
    add("Group", "", "receipt", { w: 1000, h: 600 });
    add("Button", "Neuer Beleg", "receipt.btn_new");
    add("Button", "Mehrere Belege", "receipt.btn_newPopup");
    add("Button", "Home", "receipt.pushButton_home");
    add("Table", "", "receipt.tableWidget_mainTabel", { x: 0, y: 100, w: 900, h: 300 });
    add("Text", `MEINE BELEGE (${options.incomplete ? 3 : 2})`, "receipt.label_infoText1");
    add("Edit", "", "receipt.widget_mainWindowInfoBar.frame_container.lineEdit_suche", { val: "" });
    for (const [rowIndex, title, documentNumber] of [[0, values.title, values.documentNumber],
      [1, options.otherRowDrift && closed ? "Foreign change" : "Other receipt", "OTHER-1"]]) {
      for (let column = 0; column < 9; column++) {
        add("DataItem", column === 2 ? title + "*" : column === 8 && !options.omitDocumentNumber ? documentNumber : "",
          "receipt.tableWidget_mainTabel", { x: column * 80, y: 140 + rowIndex * 30, selected: column === 2 });
      }
    }
    if (open) {
      for (const [field, definition] of Object.entries(policy.controls.editableFields)) {
        const value = field === "date" ? values.date.split("-").reverse().join(".")
          : field === "vatRate" ? values.vatRate === "0" ? "" : values.vatRate + " %" : values[field];
        add(definition.controlType, field === "net" ? "Netto" : "", "receipt.widget_detailPanel" + definition.automationIdSuffix,
          field === "net" ? { checked: value } : { val: value, ro: options.readOnlyField === field });
      }
      add("Button", policy.controls.detailClose.expectedName, "receipt.widget_detailPanel" + policy.controls.detailClose.automationIdSuffix);
    }
    return nodes;
  };
  const before = receiptList(makeNodes(), policy);
  assert(!("error" in before));
  const args = { rowRid: before.rows[0].rowRid, rowFingerprint: before.rows[0].rowFingerprint,
    expectedListFingerprint: before.listFingerprint, expectedDetailFingerprint: detailBindingFingerprint(beforeValues),
    values: requested, acknowledgeUpdate: true, waitMs: 100 };
  const client = { binding: { hwnd: 42, pid: 99 },
    request: async (operation, args) => {
      if (operation === "window_inventory") {
        const windows = [
          { hwnd: 42, order: 0, pid: 99, class: "Qt692QWindowIcon", title: "SteuerSparErklärung 2025",
            x: 0, y: 0, w: 1000, h: 600, minimized: false, hung: false },
          { hwnd: 84, order: 1, pid: 99, class: "Qt692QWindowIcon", title: "BelegManager",
            x: 100, y: 100, w: 800, h: 500, minimized: false, hung: false },
        ];
        if (options.windowDrift && closed) windows[1].title = "Foreign title";
        return { durationMs: 1, result: { ok: true, windows, visibleWindowCount: windows.length,
          productWindowCount: windows.length, untitledWindows: [] } };
      }
      assert.equal(operation, "accessibility_snapshot");
      const tool = args.toolTitle === policy.title;
      const nodes = tool ? makeNodes() : [{ i: 0, p: -1, d: 0, type: "Button", name: "Speichern",
        aid: "main.MainToolBar.tb_sichern", rid: "42.42.4.1", x: 0, y: 0, w: 50, h: 20,
        on: Boolean(options.dirtyDrift && closed), val: null, ro: null, checked: null, selected: null, scroll: null }];
      return { durationMs: 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
        hwnd: tool ? options.managerWindowDrift && open ? 85 : 84 : 42,
        windowRect: { x: 0, y: 0, w: 1000, h: 600 }, windowEnabled: true,
        modalBlocked: Boolean(options.modalAfterClose && closed || options.modalAfterEdit && actions.some(item => item.action === "replace-edit-text")),
        exactMatches: {}, nodes, stats: { n: nodes.length, err: 0, cyc: 0, cycleRid: "", cycleName: "",
          truncated: false, depthLimited: false, valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 } } };
    },
    requestAcknowledged: async (operation, args) => {
      assert.equal(operation, "accessibility_action");
      assert.equal(args.toolTitle, policy.title);
      assert.equal(args.expectedRootHwnd, 84, "Every action must retain the originally bound manager window");
      const nodes = makeNodes();
      const target = nodes.find(node => node.rid === args.rid && node.aid === args.aid);
      assert(target, "Every write must bind a freshly observed exact node");
      assert.equal(args.expectedName, target.name);
      actions.push({ ...args });
      if (args.action === "activate-table-cell") {
        assert.equal(target.name, values.title + "*"); open = true;
      } else if (args.action === "press") {
        assert.equal(target.name, policy.controls.detailClose.expectedName);
        if (!options.closeNeverCompletes) { open = false; closed = true; }
      } else {
        assert(open);
        const field = Object.keys(policy.controls.editableFields).find(name => target.aid.endsWith(policy.controls.editableFields[name].automationIdSuffix));
        assert(field);
        if (options.rejectField === field) return { durationMs: 1, mutationAckMs: 0, receiptAcknowledged: false,
          result: { ok: false, mutationAttempted: false, code: "stale", error: "Exact old value rejected" } };
        if (field === "net") {
          assert.equal(args.action, "toggle-check-box"); assert.equal(args.expectedChecked, values.net);
          values.net = args.checked;
        } else {
          assert.equal(args.expectedValue, target.val);
          if (field === "vatRate") { assert.equal(args.action, "select-combo-value"); values.vatRate = args.value; }
          else {
            assert.equal(args.action, "replace-edit-text");
            values[field] = field === "date" ? args.value.split(".").reverse().join("-") : args.value;
          }
        }
        if (options.lostAcknowledgment === field) throw new QtNativeAcknowledgmentError("Mutation acknowledgment lost", "native-ack", { ok: true, id: 1, mutationAttempted: true });
        if (options.foreignFieldAfterEdit === field) values.note = "Foreign note";
      }
      return { durationMs: 3, mutationAckMs: 1, receiptAcknowledged: true, result: { ok: true, mutationAttempted: true } };
    },
  };
  return { args, actions, values, update: overrides => executeQtNativeOperation("receipt_manager_update",
    { ...args, ...overrides }, { qtNativeClient: client }, 5000, undefined, profile) };
}

assert(isQtNativeOperation("receipt_manager_update"));
const success = fixture();
const result = await success.update();
assert.equal(result.ok, true, JSON.stringify(result));
assert.equal(result.verified, true);
assert.equal(result.physicalInputUsed, false);
assert.equal(result.foregroundLeaseUsed, false);
assert.equal(result.cleanupRequired, false);
assert.equal(result.detailClosed, true);
assert.equal(result.otherRowsUnchanged, true);
assert.equal(result.countUnchanged, true);
assert.equal(result.windowSetUnchanged, true);
assert.equal(result.dirtyStateUnchanged, true);
assert.deepEqual(result.valuesAfter, { ...requested, date: "15.01.2025", amount: "13,40", vatRate: "7 %" });
assert.deepEqual(result.requestedValues, { ...requested, date: "15.01.2025", amount: "13,40", vatRate: "7 %" });
assert.equal(result.rollback.ok, true);
assert.deepEqual(success.actions.map(action => action.action), ["activate-table-cell", "replace-edit-text", "replace-edit-text",
  "replace-edit-text", "replace-edit-text", "toggle-check-box", "select-combo-value", "replace-edit-text", "press"]);

for (const [values, options] of [[{ title: initial.title }, {}], [{ vatRate: "0", note: "", documentNumber: "" }, {}],
  [{ title: "Updated", documentNumber: "DOC-2" }, { omitDocumentNumber: true }], [{ amount: "0.01" }, {}],
  [{ title: "Updated" }, { initialValues: { amount: "" } }],
  [{ title: "Updated", amount: "1000,01" }, { initialValues: { amount: "1.000,01" } }]]) {
  const test = fixture(options);
  const result = await test.update({ values });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.equal(result.identityProjectionComplete, true);
}

for (const overrides of [{ expectedListFingerprint: "0".repeat(64) }, { rowFingerprint: "0".repeat(64) },
  { acknowledgeUpdate: false }, { values: { date: "2025-02-31" } }, { values: { date: "0000-01-01" } },
  { values: { amount: "999999999.99" } }]) {
  const test = fixture();
  assert.equal((await test.update(overrides)).ok, false);
  assert.equal(test.actions.length, 0, "Invalid or stale preconditions must dispatch no action");
}
const incomplete = fixture({ incomplete: true });
assert.equal((await incomplete.update()).kind, "native-incomplete");
assert.equal(incomplete.actions.length, 0);
const staleDetail = fixture();
const stale = await staleDetail.update({ expectedDetailFingerprint: "0".repeat(64) });
assert.equal(stale.ok, false);
assert.equal(stale.kind, "stale");
assert.equal(stale.persistentMutationStarted, false);
assert.equal(stale.detailClosed, true);
assert.deepEqual(staleDetail.actions.map(action => action.action), ["activate-table-cell", "press"]);

const rejected = fixture({ rejectField: "documentNumber" });
const rollback = await rejected.update();
assert.equal(rollback.ok, false);
assert.equal(rollback.rollback.attempted, true);
assert.equal(rollback.rollback.complete, true, JSON.stringify(rollback));
assert.equal(rollback.resultingState, "restored");
assert.equal(rollback.cleanupRequired, false);
assert.deepEqual(rejected.values, initial);

const lost = fixture({ lostAcknowledgment: "title" });
const unknown = await lost.update();
assert.equal(unknown.ok, false);
assert.equal(unknown.outcomeUnknown, true);
assert.equal(unknown.cleanupRequired, true);
assert.equal(unknown.rollback.attempted, false);
assert.equal(unknown.persistentMutationStarted, true);
assert.equal(lost.actions.length, 2, "An unacknowledged write must never be replayed or rolled back blindly");

const foreign = fixture({ foreignFieldAfterEdit: "title" });
const drift = await foreign.update();
assert.equal(drift.ok, false);
assert.equal(drift.outcomeUnknown, true);
assert.equal(drift.rollback.attempted, false);
assert.equal(foreign.values.note, "Foreign note");
assert.equal(foreign.actions.length, 2);
const recreatedManager = fixture({ managerWindowDrift: true });
const recreated = await recreatedManager.update();
assert.equal(recreated.ok, false);
assert.equal(recreated.kind, "stale-window");
assert.equal(recreated.persistentMutationStarted, false);
assert.equal(recreated.cleanupRequired, true);
assert.equal(recreatedManager.actions.length, 1, "A newly opened manager must receive no receipt edit");
for (const option of ["otherRowDrift", "windowDrift", "dirtyDrift"]) {
  const test = fixture({ [option]: true });
  const failure = await test.update({ values: { title: "Updated" } });
  assert.equal(failure.ok, false, option);
  assert.equal(failure.verified, false);
  assert.equal(failure.cleanupRequired, true);
  assert.equal(failure.rollback.attempted, false);
}
const readOnly = fixture({ readOnlyField: "title" });
const refused = await readOnly.update();
assert.equal(refused.ok, false);
assert.equal(refused.persistentMutationStarted, false);
assert.equal(readOnly.actions.filter(action => action.action === "replace-edit-text").length, 0);
const modal = fixture({ modalAfterEdit: true });
const obstructed = await modal.update();
assert.equal(obstructed.ok, false);
assert.equal(obstructed.cleanupRequired, true);
assert.equal(modal.actions.length, 2);
for (const option of ["closeNeverCompletes", "modalAfterClose"]) {
  const pendingClose = fixture({ [option]: true });
  const failure = await pendingClose.update({ values: { title: "Updated" }, waitMs: 100 });
  assert.equal(failure.ok, false, option);
  assert.equal(failure.outcomeUnknown, true, JSON.stringify(failure));
  assert.equal(failure.cleanupRequired, true);
  assert.equal(failure.rollback.attempted, false, "An unresolved acknowledged close must block reverse writes");
  assert.equal(pendingClose.actions.filter(action => action.action === "press").length, 1,
    "A close with an unresolved result must never be pressed again");
  assert.equal(pendingClose.actions.filter(action => action.action === "replace-edit-text").length, 1);
  assert.equal(pendingClose.values.title, "Updated", "The verified edit must not be overwritten after close dispatch");
}
console.log("Native receipt update: exact bindings, typed model commits, independent postconditions and truthful failure cleanup passed.");
