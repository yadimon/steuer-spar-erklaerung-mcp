import assert from "node:assert/strict";
import { executeQtNativeOperation } from "../dist/qt-native-executor.js";
import { QtNativeAcknowledgmentError } from "../dist/qt-native-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { detailBindingFingerprint, receiptList } from "../dist/qt-native-receipts.js";
import { classificationPolicySchema } from "../dist/qt-native-classification-projection.js";
import { receiptLinkDialogFingerprint } from "../dist/qt-native-receipt-link-dialog.js";
export const profile = loadProductProfile("2025"), policy = classificationPolicySchema.parse(profile.pageObjectsCatalog.windows.receiptManager);
const values = { title: "Synthetic receipt", date: "2025-01-01", documentNumber: "DOC-1", amount: "12,34",
  vatRate: "19", net: false, note: "Original note" };
// A shared transport fixture, not evidence of the installed application's speed.
export function fixture(options = {}) {
  let kind = options.kind ?? "categories", dlg = policy.classificationDialogs[kind], chooser = policy.controls.classification[kind];
  let open = Boolean(options.alreadyOpen), modal = false, cancelled = false, closed = false;
  const actions = [], countFor = kind => kind === "persons" ? options.personCount ?? options.count ?? 40 : options.count ?? 40;
  const namesFor = kind => Array.from({ length: countFor(kind) }, (_, index) => options.names?.[index] ?? `Option ${index}`);
  const persisted = Object.fromEntries(["categories", "persons"].map(kind => [kind,
    namesFor(kind).map((_, index) => (options.initialSelected?.[kind] ?? [countFor(kind) - 1]).includes(index))]));
  let staged = [...persisted[kind]], toggles = 0, saves = 0, modalOpens = 0, notified = false, saveReads = 0;
  const selectedNames = kind => namesFor(kind).filter((_, index) => persisted[kind][index]);
  const nodes = () => {
    const result = [];
    const add = (type, name, aid, extra = {}) => {
      const i = result.length;
      result.push({ i, p: i ? 0 : -1, d: i ? 1 : 0, type, name, aid, rid: i ? `42.84.4.${i + 1}` : "42.84",
        x: 100, y: 20 + i, w: 80, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
    };
    add("Group", "", "receipt");
    for (const suffix of policy.states.list.requiredAutomationIdSuffixes) add("Button", "Catalogue control", "receipt" + suffix);
    add("Table", "", "receipt" + policy.list.tableAutomationIdSuffix, { x: 0, y: 100, w: 900, h: 300 });
    add("Text", "MEINE BELEGE (2)", "receipt" + policy.list.countLabelAutomationIdSuffixes[0]);
    add("Edit", "", "receipt" + policy.list.searchAutomationIdSuffix, { val: "" });
    for (const [rowIndex, title, document] of [[0, values.title, values.documentNumber], [1, "Other receipt", "OTHER-1"]]) {
      for (let col = 0; col < 9; col++) add("DataItem", col === 2 ? options.otherRowDrift && closed && rowIndex === 1
        ? "Foreign receipt" : title : col === 8 ? document : rowIndex === 0 && col === 5 ? selectedNames("categories").join("; ")
          : rowIndex === 0 && col === 6 ? selectedNames("persons").join("; ") : "", "receipt" + policy.list.tableAutomationIdSuffix,
      { x: col * 80, y: 140 + rowIndex * 30 });
    }
    if (open) {
      for (const [field, definition] of Object.entries(policy.controls.editableFields)) {
        const value = field === "date" ? "01.01.2025" : field === "vatRate" ? "19 %"
          : (options.fieldDrift && cancelled || options.foreignFieldAfterSave && saves) && field === "note" ? "Foreign note" : values[field];
        add(definition.controlType, field === "net" ? "Netto" : "", "receipt.widget_detailPanel" + definition.automationIdSuffix,
          field === "net" ? { checked: value } : { val: value, ro: false });
      }
      for (const key of ["categories", "persons"]) {
        const control = policy.controls.classification[key];
        add("Button", control.chooserExpectedName, "receipt.widget_detailPanel" + control.chooserAutomationIdSuffix);
        for (const name of selectedNames(key)) add("ListItem", name,
          "receipt.widget_detailPanel" + control.listAutomationIdSuffix);
      }
      add("Button", policy.controls.detailClose.expectedName, "receipt.widget_detailPanel" + policy.controls.detailClose.automationIdSuffix);
    }
    return result;
  };
  const modalNodes = () => [
    { type: "Button", name: "Abbrechen", aid: dlg.cancelAutomationId },
    { type: "Button", name: "Speichern", aid: dlg.saveAutomationId,
      on: notified && staged.some((value, index) => value !== persisted[kind][index]) && !options.neverEnableSave
        && (!options.saveLagReads || saveReads++ >= options.saveLagReads) },
    { type: "Button", name: dlg.manageExpectedName, aid: dlg.manageAutomationId },
  ].map((node, i) => ({ i, p: -1, d: 0, rid: `42.120.4.${i + 1}`, x: 100, y: i * 30, w: 80, h: 20,
    on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...node,
    ...((options.unknownFingerprint || options.unknownAfterToggle && toggles) && i === 2 ? { name: "Foreign decision" } : {}) }));
  const expectedDialogs = {};
  for (const key of ["categories", "persons"]) {
    kind = key; dlg = policy.classificationDialogs[kind]; staged = [...persisted[kind]];
    expectedDialogs[key] = { ...dlg, fingerprint: options.unknownFingerprint ? "A".repeat(64) : receiptLinkDialogFingerprint(dlg.title, modalNodes()) };
  }
  kind = options.kind ?? "categories"; dlg = policy.classificationDialogs[kind]; chooser = policy.controls.classification[kind]; staged = [...persisted[kind]];
  const activeProfile = { ...profile, pageObjectsCatalog: { ...profile.pageObjectsCatalog, windows: {
    ...profile.pageObjectsCatalog.windows, receiptManager: { ...policy, classificationDialogs: expectedDialogs } } } };
  const before = receiptList(nodes(), policy); assert(!("error" in before));
  const args = { rowRid: before.rows[0].rowRid, rowFingerprint: before.rows[0].rowFingerprint,
    expectedListFingerprint: before.listFingerprint, expectedDetailFingerprint: detailBindingFingerprint(values), kind, waitMs: 300 };
  const descriptor = (hwnd, title) => ({ hwnd, title, pid: 99, class: "Qt692QWindow", order: hwnd,
    x: 0, y: 0, w: 1000, h: 600, minimized: false, hung: false });
  const client = { binding: { hwnd: 42, pid: 99 }, request: async (operation, request) => {
    if (operation === "window_inventory") {
      const windows = [descriptor(42, "Synthetic case"), descriptor(84, policy.title)];
      if (modal) windows.push(descriptor(120, dlg.title));
      if (options.windowDrift && closed) windows.push(descriptor(130, "Foreign window"));
      return { durationMs: 1, result: { ok: true, windows, visibleWindowCount: windows.length, productWindowCount: windows.length, untitledWindows: [] } };
    }
    if (operation === "accessibility_table_options") {
      assert(modal); assert.equal(request.expectedRootHwnd, 120); assert.equal(request.tableAid, dlg.tableAutomationId);
      const count = countFor(kind);
      return { durationMs: 1, result: { ok: true, hwnd: 120, tableAid: dlg.tableAutomationId, rowCount: count, columnCount: 3,
        complete: !options.incomplete, canFetchMore: false, options: Array.from({ length: count }, (_, index) => ({ index,
          name: options.duplicates ? "Duplicate" : namesFor(kind)[index],
          selected: options.foreignGridAfterToggle && toggles && index === count - 1 ? !staged[index] : staged[index],
          toggleRid: `42.120.4.${100 + index}`, toggleAid: dlg.tableAutomationId, toggleName: "", enabled: true, visible: index < 6 })) } };
    }
    assert.equal(operation, "accessibility_snapshot");
    const tool = request.toolTitle === policy.title, dialog = request.toolTitle === dlg.title;
    const tree = tool ? nodes() : dialog ? modalNodes() : [{ i: 0, p: -1, d: 0, type: "Button", name: "Speichern",
      aid: "main.MainToolBar.tb_sichern", rid: "42.42.4.1", x: 0, y: 0, w: 50, h: 20, on: Boolean(options.dirtyDrift && closed),
      val: null, ro: null, checked: null, selected: null, scroll: null }];
    return { durationMs: 1, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
      hwnd: tool ? options.managerDrift && cancelled ? 85 : 84 : dialog ? 120 : 42,
      root: { aid: dialog ? dlg.rootAutomationId : "receipt", name: "" }, windowEnabled: true, modalBlocked: tool && modal,
      nodes: tree, windowRect: { x: 0, y: 0, w: 1000, h: 600 }, exactMatches: {}, stats: { n: tree.length, err: 0, cyc: 0,
        cycleRid: "", cycleName: "", truncated: false, depthLimited: false, valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 } } };
  }, requestAcknowledged: async (operation, request) => {
    assert.equal(operation, "accessibility_action");
    const toggleIndex = request.action === "set-table-check-state" ? Number(request.rid.split(".").at(-1)) - 100 : null;
    const target = toggleIndex === null ? (modal ? modalNodes() : nodes()).find(node => node.rid === request.rid && node.aid === request.aid)
      : { rid: request.rid, aid: dlg.tableAutomationId, name: "" };
    assert(target); assert.equal(request.expectedName, target.name); assert.equal(request.expectedRootHwnd, modal ? 120 : 84);
    actions.push({ ...request });
    if (request.action === "set-table-check-state") {
      assert(modal); assert.equal(request.expectedChecked, staged[toggleIndex]); assert.equal(request.expectedRowTitle, namesFor(kind)[toggleIndex]);
      assert.equal(request.titleColumn, dlg.labelColumn);
      assert.equal(request.notifyClicked, true); assert.equal(request.expectedRootAid, dlg.rootAutomationId);
      assert.equal(request.expectedTableAid, dlg.tableAutomationId);
      if (options.rejectToggleName === request.expectedRowTitle && (!options.rejectToggleKind || options.rejectToggleKind === kind)) return { durationMs: 1, mutationAckMs: 0, receiptAcknowledged: false,
        result: { ok: false, mutationAttempted: false, code: "stale", error: "Known exact option rejection" } };
      staged[toggleIndex] = request.checked; toggles++; notified = !options.notificationMissing;
      if (options.lostToggleAck) throw new QtNativeAcknowledgmentError("Lost checkbox acknowledgment", "native-ack", { ok: true, id: 1, mutationAttempted: true });
    }
    else if (request.action === "activate-table-cell") open = true;
    else if (target.aid === dlg.cancelAutomationId) { modal = false; cancelled = true; }
    else if (target.aid === dlg.saveAutomationId) {
      assert(modal); if (!options.losePersistence) persisted[kind] = [...staged]; saves++; modal = false;
      if (options.lostSaveAck) throw new QtNativeAcknowledgmentError("Lost save acknowledgment", "native-ack", { ok: true, id: 1, mutationAttempted: true });
    }
    else if (["categories", "persons"].some(key => target.aid.endsWith(policy.controls.classification[key].chooserAutomationIdSuffix))) {
      kind = ["categories", "persons"].find(key => target.aid.endsWith(policy.controls.classification[key].chooserAutomationIdSuffix));
      dlg = policy.classificationDialogs[kind]; chooser = policy.controls.classification[kind]; staged = [...persisted[kind]];
      notified = false; saveReads = 0; modalOpens++;
      modal = modalOpens !== options.acknowledgedMissingOpenAt;
    }
    else { assert(target.aid.endsWith(policy.controls.detailClose.automationIdSuffix)); open = false; closed = true; }
    if (options.lostAck === target.name) throw new QtNativeAcknowledgmentError("Lost acknowledgment", "native-ack",
      { ok: true, id: 1, mutationAttempted: true });
    return { durationMs: 1, mutationAckMs: 1, receiptAcknowledged: true,
      result: { ok: true, mutationAttempted: true, notificationDispatched: request.action === "set-table-check-state" && !options.notificationMissing } };
  } };
  const classifyArgs = { ...args, values: { categories: ["Option 0"] }, acknowledgeClassification: true }; delete classifyArgs.kind;
  return { args, actions, persisted, modalOpens: () => modalOpens,
    read: overrides => executeQtNativeOperation("receipt_manager_classification_options", { ...args, ...overrides },
      { qtNativeClient: client }, 5000, undefined, activeProfile),
    classify: overrides => executeQtNativeOperation("receipt_manager_classify", { ...classifyArgs, ...overrides },
      { qtNativeClient: client }, 5000, undefined, activeProfile) };
}
