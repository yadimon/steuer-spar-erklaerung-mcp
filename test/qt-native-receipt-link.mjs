import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeQtNativeOperation, isQtNativeOperation } from "../dist/qt-native-executor.js";
import { QtNativeAcknowledgmentError } from "../dist/qt-native-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { receiptList } from "../dist/qt-native-receipts.js";
import { receiptLinkPolicySchema } from "../dist/qt-native-receipt-link-projection.js";
import { receiptLinkDialogFingerprint } from "../dist/qt-native-receipt-link-dialog.js";

const profile = loadProductProfile("2025");
const policy = receiptLinkPolicySchema.parse(profile.pageObjectsCatalog.windows.receiptManager);
const link = policy.controls.linkManagement;
const target = "Synthetic target", heading = "Synthetic bound page";

const dialogCases = [
  { title: " Belegwerte\nübernehmen ", nodes: [
    { type: "Text", name: "  Werte  aus\nBelegen übernehmen? ", on: true },
    { type: "Button", name: "Abbrechen", on: true }, { type: "Button", name: "Übernehmen", on: false },
  ] },
  { title: "Belegwerte übernehmen", nodes: [
    { type: "TreeItem", name: "ä Ä z Z alpha\u0085beta", on: true },
    { type: "Text", name: "Zebra" }, { type: "Text", name: "äpfel" }, { type: "Text", name: "Äpfel" },
    { type: "Pane", name: "ja", on: true }, { type: "Button", name: "Nein", on: false },
    { type: "Button", name: "Weiter", on: true }, { type: "Pane", name: "Weiter", on: true },
  ] },
];
dialogCases.push({ ...dialogCases[0], nodes: [...dialogCases[0].nodes].reverse() });
dialogCases.push({ ...dialogCases[0], nodes: dialogCases[0].nodes.map(node => node.name === "Übernehmen" ? { ...node, on: true } : node) });
const oracleDirectory = mkdtempSync(join(tmpdir(), "sse-link-dialog-oracle-"));
try {
  const input = join(oracleDirectory, "input.json"), output = join(oracleDirectory, "output.json");
  writeFileSync(input, JSON.stringify(dialogCases));
  const oracle = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    fileURLToPath(new URL("./qt-native-receipt-link-dialog-oracle.ps1", import.meta.url)), "-InputPath", input, "-OutputPath", output],
  { windowsHide: true, encoding: "utf8", timeout: 60_000 });
  assert.equal(oracle.status, 0, oracle.stderr);
  const expected = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(dialogCases.map(test => receiptLinkDialogFingerprint(test.title, test.nodes)), expected,
    "Native decision fingerprints must match actual worker projection and fingerprint bodies");
  assert.equal(expected[0], expected[2]); assert.notEqual(expected[0], expected[3]);
} finally { rmSync(oracleDirectory, { recursive: true, force: true }); }

// Transport-boundary fixture: persistence is a separate store from the staged
// table. The native integration test independently proves real Qt model writes.
function fixture(options = {}) {
  const rows = options.rows ?? [
    { title: "Synthetic receipt", document: "DOC-1", linked: false },
    { title: "Other receipt", document: "OTHER-1", linked: true },
  ];
  const persisted = rows.map(row => row.linked), actions = [];
  let staged = [...persisted], managerHwnd = options.alreadyOpen ? 84 : null;
  let opens = 0, state = "start", dirty = false, edited = false, applied = false, transfer = false;
  let footerLag = false, readCount = 0;
  const nodeBuilder = hwnd => {
    const nodes = [];
    const add = (type, name, aid, extra = {}) => {
      const i = nodes.length;
      nodes.push({ i, p: i ? 0 : -1, d: i ? 1 : 0, type, name, aid, rid: `42.${hwnd}.4.${i + 1}`,
        x: 100, y: 20 + i, w: 80, h: 20, on: true, val: null, ro: null, checked: null,
        selected: null, scroll: null, ...extra });
      return i;
    };
    return { nodes, add };
  };
  const mainNodes = () => {
    const { nodes, add } = nodeBuilder(42);
    add("Group", "", "main" + profile.pageObjectsCatalog.windows.main.headingContainerAutomationIdSuffix);
    add("Text", options.wrongHeading || options.headingDrift && edited ? "Foreign page" : heading, "main.heading");
    add("Button", "Speichern", "main.MainToolBar.tb_sichern", { on: dirty || Boolean(options.dirtyDrift && edited) });
    add("Button", "Belege verknüpfen", "main" + link.mainToolbarAutomationIdSuffix);
    return nodes;
  };
  const toolNodes = () => {
    const { nodes, add } = nodeBuilder(managerHwnd ?? 84);
    add("Group", "", "receipt");
    for (const suffix of policy.states[state].requiredAutomationIdSuffixes)
      add("Button", suffix === policy.actions.showAllReceipts.automationIdSuffix
        ? policy.actions.showAllReceipts.expectedName : "Catalogue control", "receipt" + suffix);
    add("Text", `Belege mit "${options.wrongStart ? "Foreign target" : target}" verknüpfen`, "receipt" + link.startTargetAutomationIdSuffix);
    if (state === "list") {
      add("Table", "", "receipt" + policy.list.tableAutomationIdSuffix, { x: 0, y: 100, w: 900, h: 300 });
      add("Text", `MEINE BELEGE (${rows.length + (options.incomplete ? 1 : 0)})`, "receipt" + policy.list.countLabelAutomationIdSuffixes[0]);
      add("Edit", "", "receipt" + policy.list.searchAutomationIdSuffix, { val: "" });
      rows.forEach((row, rowIndex) => {
        for (let column = 0; column < 9; column++) {
          const title = options.contentDrift && edited && rowIndex === 1 ? "Foreign receipt" : row.title;
          add("DataItem", column === 2 ? title + (options.draft ? "*" : "") : column === 8 ? row.document : "",
            "receipt" + policy.list.tableAutomationIdSuffix, { x: column * 80, y: 140 + rowIndex * 30,
              checked: column === link.rowToggleColumn ? staged[rowIndex] : null });
        }
      });
      const count = (footerLag ? persisted : staged).filter(Boolean).length;
      add("Text", String(count), "receipt" + link.footerCountAutomationIdSuffix);
      add("Text", `${count === 1 ? "Beleg" : "Belege"} mit "${options.wrongFooter ? "Foreign target" : target}" verknüpft`,
        "receipt" + link.footerTextAutomationIdSuffix);
      footerLag = false;
    }
    add("Button", link.applyExpectedName, "receipt" + link.applyAutomationIdSuffix);
    add("Button", link.cancelExpectedName, "receipt" + link.cancelAutomationIdSuffix);
    return nodes;
  };
  const dialogNodes = () => {
    const { nodes, add } = nodeBuilder(120);
    add("Group", "", "dialog"); add("Text", "Synthetic transfer question", "dialog.question");
    add("Button", "Abbrechen", "dialog.cancel");
    return nodes;
  };
  const activeProfile = options.transfer === "known" ? { ...profile, pageObjectsCatalog: { ...profile.pageObjectsCatalog,
    windows: { ...profile.pageObjectsCatalog.windows, receiptManager: { ...policy, linkValueTransferDialog: {
      ...policy.linkValueTransferDialog, fingerprints: [receiptLinkDialogFingerprint(policy.linkValueTransferDialog.title, dialogNodes())],
    } } } } } : profile;
  const inventory = () => {
    const descriptor = (hwnd, title) => ({ hwnd, title, pid: 99, class: "Qt692QWindow", order: hwnd,
      x: 0, y: 0, w: 1000, h: 600, minimized: false, hung: false });
    const windows = [descriptor(42, dirty ? "Synthetic case *" : "Synthetic case")];
    if (managerHwnd !== null) windows.push(descriptor(managerHwnd, policy.title));
    if (transfer) windows.push(descriptor(120, policy.linkValueTransferDialog.title));
    if (options.windowDrift && applied) windows.push(descriptor(130, "Foreign window"));
    return { ok: true, windows, visibleWindowCount: windows.length, productWindowCount: windows.length, untitledWindows: [] };
  };
  const client = { binding: { hwnd: 42, pid: 99 },
    request: async (operation, args) => {
      readCount++;
      if (operation === "window_inventory") return { durationMs: 1, result: inventory() };
      assert.equal(operation, "accessibility_snapshot");
      const tool = args.toolTitle === policy.title, dialog = args.toolTitle === policy.linkValueTransferDialog.title;
      if (tool && options.recreated && edited) managerHwnd += 1;
      const hwnd = tool ? managerHwnd : dialog ? 120 : 42;
      assert(hwnd !== null, "The transaction must not read a closed owned manager");
      const nodes = tool ? toolNodes() : dialog ? dialogNodes() : mainNodes();
      const activeModalHwnd = options.foreignModal && edited ? 131 : managerHwnd ?? (transfer ? 120 : 0);
      const modalBlocked = !tool && !dialog && activeModalHwnd !== 0
        && (args.allowedModalTitle !== policy.title || args.allowedModalHwnd !== activeModalHwnd);
      return { durationMs: 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd,
        windowEnabled: true, modalBlocked, activeModalHwnd, nodes, windowRect: { x: 0, y: 0, w: 1000, h: 600 }, exactMatches: {},
        stats: { n: nodes.length, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
          valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 } } };
    },
    requestAcknowledged: async (operation, args) => {
      assert.equal(operation, "accessibility_action");
      const tool = args.toolTitle === policy.title, dialog = args.toolTitle === policy.linkValueTransferDialog.title;
      const nodes = tool ? toolNodes() : dialog ? dialogNodes() : mainNodes();
      const selected = nodes.find(node => node.rid === args.rid && node.aid === args.aid);
      assert(selected); assert.equal(selected.name, args.expectedName);
      assert.equal(args.expectedRootHwnd, tool ? managerHwnd : dialog ? 120 : 42);
      actions.push({ ...args });
      if (!tool && !dialog) {
        assert.equal(args.action, "press"); assert.equal(managerHwnd, null);
        managerHwnd = 84 + opens++; state = "start"; staged = [...persisted];
      } else if (dialog) {
        assert.equal(selected.name, "Abbrechen"); transfer = false;
      } else if (args.action === "set-table-check-state") {
        const rowIndex = Math.round((selected.y - 140) / 30);
        assert.equal(args.titleColumn, policy.list.primaryTextColumn); assert.equal(args.expectedRowTitle, rows[rowIndex].title);
        assert.equal(args.expectedChecked, staged[rowIndex]);
        if (options.rejectEdit) return { durationMs: 1, receiptAcknowledged: false, mutationAckMs: 0,
          result: { ok: false, mutationAttempted: false, code: "stale", error: "Old state rejected" } };
        staged[rowIndex] = args.checked; edited = true; footerLag = Boolean(options.footerLag);
        if (options.foreignState) staged[1] = !staged[1];
        if (options.lostAcknowledgment) throw new QtNativeAcknowledgmentError("Acknowledgment lost", "native-ack",
          { ok: true, id: 1, mutationAttempted: true });
      } else if (selected.aid.endsWith(policy.actions.showAllReceipts.automationIdSuffix)) state = "list";
      else if (selected.aid.endsWith(link.applyAutomationIdSuffix)) {
        if (!options.applyNoEffect) persisted.splice(0, persisted.length, ...staged);
        applied = true; dirty = true; managerHwnd = null; transfer = Boolean(options.transfer);
      } else {
        assert(selected.aid.endsWith(link.cancelAutomationIdSuffix));
        if (!options.cancelNoEffect) { managerHwnd = null; staged = [...persisted]; }
      }
      return { durationMs: 3, receiptAcknowledged: true, mutationAckMs: 1, result: { ok: true, mutationAttempted: true } };
    },
  };
  const args = { hwnd: 42, expectedTargetPage: heading, expectedLinkTarget: target, acknowledgeLinkChange: true, waitMs: 100,
    items: [{ expectedReceiptTitle: rows[0].title, expectedDocumentNumber: rows[0].document, linked: !rows[0].linked }] };
  return { actions, persisted, args, get managerHwnd() { return managerHwnd; }, get readCount() { return readCount; },
    list: () => { const previous = state; state = "list"; const list = receiptList(toolNodes(), policy); state = previous; return list; },
    run: overrides => {
      const input = { ...args, ...overrides }; if (input.items === undefined) delete input.items;
      return executeQtNativeOperation("receipt_manager_link", input, { qtNativeClient: client }, 5000, undefined, activeProfile);
    } };
}

assert(isQtNativeOperation("receipt_manager_link"));
for (const options of [{}, { footerLag: true }, { rows: [
  { title: "Synthetic receipt", document: "DOC-1", linked: true },
  { title: "Other receipt", document: "OTHER-1", linked: false },
] }, { rows: [
  { title: "Synthetic receipt", document: "DOC-1", linked: false },
  { title: "Duplicate other", document: "OTHER-1", linked: false },
  { title: "Duplicate other", document: "OTHER-1", linked: true },
] }, { transfer: "known" }]) {
  const test = fixture(options), before = [...test.persisted];
  const result = await test.run();
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.verified, true);
  assert.equal(result.persistenceVerified, true); assert.equal(result.applied, true); assert.equal(result.cleanupRequired, false);
  assert.equal(result.dirtyStateUnchangedBeforeApply, true); assert.equal(result.windowIdentitiesUnchanged, true);
  assert.equal(result.physicalInputUsed, false); assert.equal(result.foregroundLeaseUsed, false);
  assert.equal(result.changedCount, 1); assert.equal(test.managerHwnd, null);
  assert.deepEqual(test.persisted, [!before[0], ...before.slice(1)], "Only the requested persisted receipt may change");
  assert.equal(test.actions.filter(action => action.action === "set-table-check-state").length, 1);
  assert.equal(test.actions.filter(action => action.aid.endsWith(link.applyAutomationIdSuffix)).length, 1);
  assert.equal(test.actions.filter(action => action.aid.endsWith(link.cancelAutomationIdSuffix)).length, 1);
  if (options.transfer) assert.equal(result.applyClick.valueTransferCancelled, true);
}

const noOp = fixture();
const noOpResult = await noOp.run({ items: [{ expectedReceiptTitle: "Synthetic receipt", linked: false }] });
assert.equal(noOpResult.ok, true, JSON.stringify(noOpResult)); assert.equal(noOpResult.noChanges, true);
assert.equal(noOpResult.applied, false); assert.equal(noOpResult.ungespeichertNachher, false);
assert(!noOp.actions.some(action => action.action === "set-table-check-state" || action.aid.endsWith(link.applyAutomationIdSuffix)));

for (const options of [{ cancelNoEffect: true }, { cancelNoEffect: true, rejectEdit: true }]) {
  const test = fixture(options);
  const result = await test.run(options.rejectEdit ? { waitMs: 100 } : {
    waitMs: 100, items: [{ expectedReceiptTitle: "Synthetic receipt", linked: false }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.cleanupRequired, true);
  assert.equal(result.resultingState, "unknown");
  assert.equal(test.actions.filter(action => action.aid.endsWith(link.cancelAutomationIdSuffix)).length, 1,
    "An acknowledged cancel with an unproved close must never be replayed, including during cleanup");
  assert.equal(test.actions.filter(action => action.aid.endsWith(link.applyAutomationIdSuffix)).length, 0);
  assert.deepEqual(test.persisted, [false, true]);
}

const batch = fixture();
assert.equal((await batch.run({ items: [
  { expectedReceiptTitle: "Synthetic receipt", linked: true }, { expectedReceiptTitle: "Other receipt", linked: false },
] })).ok, true);
assert.deepEqual(batch.persisted, [true, false]);
assert.equal(batch.actions.filter(action => action.action === "set-table-check-state").length, 2);
assert.equal(batch.actions.filter(action => action.aid.endsWith(link.applyAutomationIdSuffix)).length, 1);

const legacy = fixture();
const legacyArgs = { ...legacy.args }; delete legacyArgs.items;
const list = legacy.list(); assert(!("error" in list));
assert.equal((await legacy.run({ items: undefined, ...legacyArgs, receiptContentFingerprint: list.rows[0].contentFingerprint,
  expectedReceiptTitle: "Synthetic receipt", linked: true })).ok, true);

for (const options of [{ wrongHeading: true }, { alreadyOpen: true }]) {
  const test = fixture(options); assert.equal((await test.run()).ok, false); assert.equal(test.actions.length, 0);
}
for (const overrides of [{ acknowledgeLinkChange: false }, { hwnd: 43 },
  { items: [{ expectedReceiptTitle: "Synthetic receipt", linked: true }, { expectedReceiptTitle: "Synthetic receipt", linked: false }] }]) {
  const test = fixture(); assert.equal((await test.run(overrides)).ok, false); assert.equal(test.actions.length, 0);
}
for (const options of [{ wrongStart: true }, { incomplete: true }, { draft: true }, { wrongFooter: true }]) {
  const test = fixture(options); const result = await test.run(); assert.equal(result.ok, false, JSON.stringify(result));
  assert(!test.actions.some(action => action.action === "set-table-check-state" || action.aid.endsWith(link.applyAutomationIdSuffix)));
  assert.deepEqual(test.persisted, [false, true]);
}
const ambiguous = fixture({ rows: [
  { title: "Synthetic receipt", document: "DOC-1", linked: false },
  { title: "Synthetic receipt", document: "DOC-2", linked: false },
] });
assert.equal((await ambiguous.run({ items: [{ expectedReceiptTitle: "Synthetic receipt", linked: true }] })).kind, "ambiguous");
assert(!ambiguous.actions.some(action => action.action === "set-table-check-state"));
const sameRow = fixture();
assert.equal((await sameRow.run({ items: [{ expectedReceiptTitle: "Synthetic receipt", linked: true },
  { expectedReceiptTitle: "Synthetic receipt", expectedDocumentNumber: "DOC-1", linked: true }] })).kind, "ambiguous");
assert(!sameRow.actions.some(action => action.action === "set-table-check-state"));

const rejected = fixture({ rejectEdit: true });
const rejectedResult = await rejected.run();
assert.equal(rejectedResult.ok, false); assert.equal(rejectedResult.resultingState, "cancelled");
assert.equal(rejectedResult.cleanupRequired, false); assert.equal(rejectedResult.persistentApplyStarted, false);
assert.equal(rejected.managerHwnd, null); assert.deepEqual(rejected.persisted, [false, true]);

for (const options of [{ lostAcknowledgment: true }, { foreignState: true }, { contentDrift: true },
  { dirtyDrift: true }, { recreated: true }, { foreignModal: true }, { headingDrift: true }]) {
  const test = fixture(options); const result = await test.run();
  assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.cleanupRequired, true);
  assert.equal(result.outcomeUnknown, true); assert.equal(result.persistentApplyStarted, false);
  assert.equal(test.actions.filter(action => action.action === "set-table-check-state").length, 1);
  assert(!test.actions.some(action => action.aid.endsWith(link.applyAutomationIdSuffix)
    || action.aid.endsWith(link.cancelAutomationIdSuffix)), "Do not apply, replay or cancel an unknown staging state");
  assert.deepEqual(test.persisted, [false, true]);
}
for (const options of [{ applyNoEffect: true }, { windowDrift: true }]) {
  const test = fixture(options), result = await test.run();
  assert.equal(result.ok, false); assert.equal(result.verified, false); assert.equal(result.cleanupRequired, true);
  assert.equal(result.persistentApplyStarted, true);
  assert.equal(test.actions.filter(action => action.action === "set-table-check-state").length, 1,
    "Failed persistence must never cause a compensating or repeated checkbox write");
}
const unknownTransfer = fixture({ transfer: "unknown" });
const unknownResult = await unknownTransfer.run();
assert.equal(unknownResult.kind, "fingerprint-mismatch"); assert.equal(unknownResult.cleanupRequired, true);
assert(!unknownTransfer.actions.some(action => action.toolTitle === policy.linkValueTransferDialog.title));

console.log("Native receipt links prove batch/legacy/no-op persistence, exact modal ownership, complete list and other-row guards, known-dialog policy and no replay after uncertainty.");
