import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeQtNativeOperation, isQtNativeOperation } from "../dist/qt-native-executor.js";
import { QtNativeAcknowledgmentError } from "../dist/qt-native-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { gotoLanding, gotoRoute, gotoTargetState, pagingOrder, repeatedPagingTitles, selectSearchHit,
  summaryFromNodes, visibleNavigationItem } from "../dist/qt-native-goto-projection.js";

const profile = loadProductProfile("2025");
const page = { heading: "Target page", headingAutomationIdRelative: ".ClientFrameSSE.ClientHeader.QLabel",
  fields: { required: { automationIdRelative: ".requiredField", controlType: "Edit" } } };
const knownProfile = { ...profile, pageObjectsCatalog: { ...profile.pageObjectsCatalog,
  pages: { ...profile.pageObjectsCatalog.pages, "synthetic.target": page } } };
const rect = { x: 0, y: 0, w: 1800, h: 1000 };
const stats = { n: 0, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
  valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 };
function builder() {
  const nodes = [];
  const add = (type, name, aid, p = -1, extra = {}) => {
    const i = nodes.length;
    nodes.push({ i, p, d: p < 0 ? 0 : nodes[p].d + 1, type, name, aid, rid: `42.42.4.${i + 1}`,
      x: 300, y: 100 + i * 25, w: 200, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
    return i;
  };
  return { nodes, add };
}
const snapshot = nodes => ({ ok: true, controllerBound: true, hwnd: 42, windowEnabled: true, modalBlocked: false,
  scope: "qt-accessibility-content", nodes, exactMatches: {}, windowRect: rect, stats: { ...stats, n: nodes.length }, nativeDurationMs: 1 });
const searchPage = rows => {
  const { nodes, add } = builder();
  const table = add("Table", "", "main.DialogSearchResultsTableView");
  rows.forEach((row, index) => row.forEach((title, column) => {
    const cell = add("DataItem", typeof title === "string" ? title : "", "main.DialogSearchResultsTableView", table,
      { x: 80 + column * 240, y: 200 + index * 25 });
    if (typeof title === "object") add("Text", title.text, "main.titleText", cell, { x: 82, y: 200 + index * 25 });
  }));
  add("Text", "Target page", "main.unrelated");
  return nodes;
};
const navigationPage = options => {
  const { nodes, add } = builder();
  const tree = add("Tree", "", "main.NavWidgetSSE", -1, { x: 10, y: 100, w: 240, h: 300 });
  add("TreeItem", "Target page", "main.NavWidgetSSE", tree, { x: 20, y: options?.y ?? 150, ...options });
  return nodes;
};
const sumPage = () => {
  const { nodes, add } = builder();
  add("Tree", "", "main.NavWidgetSSE", -1, { x: 0, w: 200 });
  for (const [label, value, y] of [["Summe", "1,00", 300], ["Summe im Zeitraum", "2,00", 350], ["Summe", "3,00", 400]]) {
    add("Text", label, "main.sumCaption", -1, { x: 400, y });
    add("Edit", "", "main.sumValue", -1, { x: 600, y, val: value, ro: true });
  }
  return nodes;
};

// Differential oracle uses the actual pure worker helpers, including stable
// label geometry, title-column binding, repeated pages and back-history rules.
const routes = [
  { start: "Bürobedarf", target: "Umsatzsteuererklärung 2025", landings: [{ position: 34, from: "Bürobedarf", heading: repeatedPagingTitles[0] }, { position: 34, from: "Bürobedarf", heading: "Fachliteratur" }] },
  { start: "Umsatzsteuer-Voranmeldungen 2025", target: "Umsatzsteuererklärung 2025", landings: [{ position: 62, from: "Umsatzsteuer-Voranmeldungen 2025", heading: "Fremde Seite" }, { position: 62, from: "Umsatzsteuer-Voranmeldungen 2025", heading: repeatedPagingTitles[0] }] },
  { start: "Unknown start", target: "Bürobedarf", maxSteps: 3, landings: [] },
  { start: "Bürobedarf", target: "Bürobedarf", direction: "Weiter", landings: [] },
  { start: "Bürobedarf", target: "Fachliteratur", landings: [{ position: 34, from: "Bürobedarf", heading: "Fortbildungskosten" }] },
  { start: repeatedPagingTitles[0], target: "Missing target", direction: "Zurück", maxSteps: 1,
    landings: [{ position: -1, from: repeatedPagingTitles[0], heading: "Bürobedarf" }] },
];
const searches = [
  { nodes: searchPage([["Other", "Target page"], ["Target page", "path"]]), target: "Target page" },
  { nodes: searchPage([["", "Target page"]]), target: "Target page" },
  { nodes: searchPage([["Target page"], ["Target page"]]), target: "Target page" },
  { nodes: searchPage([[{ text: "Target page" }, "Other"]]), target: "Target page" },
  { nodes: searchPage([["Target page: Person A"], ["Target page: Person B"]]), target: "Target page:", page: { heading: "Target page", headingPrefix: "Target page:" } },
];
const navigation = [{ nodes: navigationPage(), target: "Target page" },
  { nodes: navigationPage({ on: false }), target: "Target page" }, { nodes: navigationPage({ y: 395 }), target: "Target page" }];
const sums = [1, 2, 3].map(occurrence => ({ nodes: sumPage(), bounds: { minX: 205, maxX: 1422 }, label: "Summe", occurrence }));
const temporary = mkdtempSync(join(tmpdir(), "sse-goto-oracle-"));
try {
  const input = join(temporary, "input.json"), output = join(temporary, "output.json");
  writeFileSync(input, JSON.stringify({ year: 2025, routes, search: searches, navigation, summaries: sums }));
  const oracle = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    fileURLToPath(new URL("./qt-native-goto-oracle.ps1", import.meta.url)), "-InputPath", input, "-OutputPath", output],
  { windowsHide: true, encoding: "utf8", timeout: 60_000 });
  assert.equal(oracle.status, 0, oracle.stderr);
  const expected = JSON.parse(readFileSync(output, "utf8"));
  const order = pagingOrder(2025);
  assert.deepEqual(order, expected.order); assert.deepEqual(repeatedPagingTitles, expected.repeated);
  assert.deepEqual(routes.map(test => gotoRoute(order, test.start, test.target, test.direction, test.maxSteps)), expected.routes);
  assert.deepEqual(routes.flatMap(test => test.landings.map(landing => gotoLanding(gotoRoute(order, test.start, test.target, test.direction, test.maxSteps),
    order, landing.position, landing.heading))), expected.landings);
  assert.deepEqual(searches.map(test => selectSearchHit(test.nodes, test.target, test.page)?.rid ?? null), expected.hits);
  assert.deepEqual(navigation.map(test => visibleNavigationItem(test.nodes, test.target)?.rid ?? null), expected.navigation);
  assert.deepEqual(sums.map(test => {
    const result = summaryFromNodes(snapshot(test.nodes), test.label, test.occurrence);
    return result ? { label: result.label, value: result.value, y: result.y } : null;
  }), expected.summaries);
} finally { rmSync(temporary, { recursive: true, force: true }); }

function fixture(options = {}) {
  let current = options.start ?? "Start page", searchOpen = false, term = "", reads = 0, targetReads = 0, incompleteNativeReads = 0;
  let pendingReadObserved = false;
  const actions = [], route = [...(options.landings ?? ["Target page"])];
  const nodes = () => {
    const { nodes: value, add } = builder();
    const header = add("Group", "", "main.ClientFrameSSE.ClientHeader");
    if (!searchOpen || current === "Target page") add("Text", current, "main.ClientFrameSSE.ClientHeader.QLabel", header);
    const nav = add("Tree", "", "main.NavWidgetSSE", -1, { x: 10, y: 100, w: 240, h: 500 });
    if (options.visibleTarget) add("TreeItem", "Target page", "main.NavWidgetSSE", nav, { x: 20, y: 150 });
    if (current === "Target page") {
      targetReads++;
      if (targetReads > (options.incompleteReads ?? 0)) add("Edit", "", "main.requiredField", -1, { val: "17,00", ro: false });
    }
    add("Button", "Weiter", "main.next", -1, { on: !options.deadEnd });
    add("Button", "Zurück", "main.back", -1, { on: !options.deadEnd });
    const search = add("Group", "", "main.SearchSSE");
    add("Edit", "", "main.SearchSSE.field", search, { x: 600, y: 50, val: term, ro: false });
    add("Button", "", "main.SearchSSE.searchButton", search, { x: 810, y: 50 });
    if (searchOpen) {
      add("Button", "Suche schließen", "main.searchClose");
      if (!options.pendingSearch) {
        const table = add("Table", "", "main.DialogSearchResultsTableView");
        if (!options.noHit) add("DataItem", "Target page", "main.DialogSearchResultsTableView", table, { x: 80, y: 200 });
      }
    }
    return value;
  };
  const inventory = () => ({ ok: true, windows: options.warning ? [{ hwnd: 84, order: 0, pid: 7, title: "Die Prüfung hat ergeben...",
    class: "Qt6QWindow", x: 10, y: 10, w: 400, h: 200, minimized: false, hung: false }] : [],
    untitledWindows: [], visibleWindowCount: options.warning ? 1 : 0, productWindowCount: options.warning ? 1 : 0 });
  const client = {
    binding: { hwnd: 42, pid: 7 },
    request: async operation => {
      if (operation === "window_inventory") return { durationMs: 1, result: inventory() };
      assert.equal(operation, "accessibility_snapshot"); reads++;
      if (actions.at(-1)?.expectedName === "Suche schließen" && incompleteNativeReads < (options.incompleteNativeReads ?? 0)) {
        incompleteNativeReads++;
        return { durationMs: 1, result: { ok: false, code: "NATIVE_ACCESSIBILITY_INCOMPLETE", error: "Validation preview rebuilding" } };
      }
      if (searchOpen && options.pendingSearch && !pendingReadObserved) {
        pendingReadObserved = true; options.onPendingRead();
      }
      const result = snapshot(nodes());
      result.stats.truncated = Boolean(options.truncated || options.depthLimited);
      result.stats.depthLimited = Boolean(options.depthLimited);
      if (options.modal || options.warning && actions.length) { result.modalBlocked = true; result.windowEnabled = false; }
      return { durationMs: 1, result };
    },
    requestAcknowledged: async (operation, args) => {
      assert.equal(operation, "accessibility_action"); assert.equal(args.expectedRootHwnd, 42);
      const target = nodes().find(node => node.rid === args.rid && node.aid === args.aid);
      assert(target); assert.equal(args.expectedName, target.name);
      actions.push(args);
      if (options.rejectAction) return { durationMs: 1, receiptAcknowledged: false,
        result: { ok: false, mutationAttempted: false, code: "stale", error: "Stale target" } };
      if (args.action === "replace-edit-text") { assert.equal(args.expectedValue, term); term = args.value; }
      else if (args.action === "activate-navigation-item" || args.action === "activate-table-cell") current = options.noActivation ? current : "Target page";
      else if (target.aid.endsWith("searchButton")) searchOpen = true;
      else if (target.name === "Suche schließen") searchOpen = false;
      else { assert(["Weiter", "Zurück"].includes(target.name)); current = route.shift() ?? current; }
      if (options.lostAcknowledgment) throw new QtNativeAcknowledgmentError("Acknowledgment lost", "native-ack",
        { ok: true, mutationAttempted: true });
      return { durationMs: 1, receiptAcknowledged: true, mutationAckMs: 1, result: { ok: true, mutationAttempted: true } };
    },
  };
  return { actions, get reads() { return reads; }, run: args => executeQtNativeOperation("goto",
    { pageId: "synthetic.target", hwnd: 42, ...args }, { qtNativeClient: client }, options.timeoutMs ?? 8000, undefined, knownProfile) };
}
assert(isQtNativeOperation("goto"));
const already = fixture({ start: "Target page" });
assert.equal((await already.run()).erreicht, true); assert.equal(already.actions.length, 0);
const delayed = fixture({ start: "Target page", incompleteReads: 2 });
assert.equal((await delayed.run()).erreicht, true); assert.equal(delayed.actions.length, 0);
const tree = fixture({ visibleTarget: true });
assert.equal((await tree.run()).richtung, "Navigationsbaum"); assert.equal(tree.actions.length, 1);
assert.equal(tree.actions[0].action, "activate-navigation-item");
const unchangedTree = fixture({ visibleTarget: true, noActivation: true });
const treeFailure = await unchangedTree.run();
assert.equal(treeFailure.ok, false); assert.equal(treeFailure.outcomeUnknown, true);
assert.equal(unchangedTree.actions.length, 1, "An unproved tree activation cannot start a search or be replayed");
const search = fixture();
assert.equal((await search.run()).richtung, "Suche");
assert.deepEqual(search.actions.map(action => action.action), ["replace-edit-text", "press", "activate-table-cell", "press"]);
const unchangedSearch = fixture({ noActivation: true });
const searchFailure = await unchangedSearch.run();
assert.equal(searchFailure.ok, false); assert.equal(searchFailure.outcomeUnknown, true);
assert.deepEqual(unchangedSearch.actions.map(action => action.action), ["replace-edit-text", "press", "activate-table-cell", "press"],
  "An unproved search activation closes its own search without starting form navigation or replaying the hit");
const rebuilding = fixture({ incompleteNativeReads: 2 });
const rebuilt = await rebuilding.run();
assert.equal(rebuilt.ok, false); assert.equal(rebuilt.kind, "NATIVE_ACCESSIBILITY_INCOMPLETE");
assert.equal(rebuilt.outcomeUnknown, true);
assert.deepEqual(rebuilding.actions.map(action => action.action), ["replace-edit-text", "press", "activate-table-cell", "press"],
  "An incomplete read refuses completion without retrying or dispatching further actions");
const linear = fixture({ landings: ["Intermediate page", "Target page"] });
assert.equal((await linear.run({ useSearch: false, maxSteps: 2 })).erreicht, true);
assert.deepEqual(linear.actions.map(action => action.expectedName), ["Weiter", "Weiter"]);
const noHit = fixture({ noHit: true });
assert.equal((await noHit.run({ maxSteps: 1 })).erreicht, true);
assert.equal(noHit.actions.filter(action => action.action === "activate-table-cell").length, 0);
const dead = fixture({ deadEnd: true });
assert.equal((await dead.run({ useSearch: false })).kind, "dead-end"); assert.equal(dead.actions.length, 0);
const warning = fixture({ warning: true });
assert.equal((await warning.run({ useSearch: false })).kind, "warning-dialog"); assert.equal(warning.actions.length, 1);
const truncated = fixture({ truncated: true });
assert.equal((await truncated.run()).kind, "native-incomplete"); assert.equal(truncated.actions.length, 0);
const depthLimited = fixture({ depthLimited: true });
assert.equal((await depthLimited.run()).kind, "native-incomplete"); assert.equal(depthLimited.actions.length, 0);
const modal = fixture({ modal: true });
assert.equal((await modal.run()).kind, "window-obstructed"); assert.equal(modal.actions.length, 0);
const lost = fixture({ visibleTarget: true, lostAcknowledgment: true });
assert.equal((await lost.run()).outcomeUnknown, true); assert.equal(lost.actions.length, 1);
const stale = fixture({ visibleTarget: true, rejectAction: true });
assert.equal((await stale.run()).kind, "stale"); assert.equal(stale.actions.length, 1);
// Expiry during a readiness wait must not close search or dispatch form navigation.
const actualPerformance = globalThis.performance;
let clockOffset = 0, clockValue = 0, clockAdvancing = false, clockTimer;
const pendingSearch = fixture({ pendingSearch: true, timeoutMs: 20_000,
  onPendingRead() {
    clockValue = 9_995;
    clockTimer = setTimeout(() => {
      clockOffset = 10_005 - actualPerformance.now(); clockAdvancing = true;
    }, 1);
  } });
globalThis.performance = { now: () => clockAdvancing ? actualPerformance.now() + clockOffset : clockValue };
let pendingResult;
try { pendingResult = await pendingSearch.run(); }
finally { clearTimeout(clockTimer); globalThis.performance = actualPerformance; }
assert.equal(pendingResult.kind, "navigation-blocked", "Expiry between polls must remain a search readiness failure");
assert.equal(pendingResult.phase, "search-results");
assert.equal(pendingResult.outcomeUnknown, true);
assert.deepEqual(pendingSearch.actions.map(action => action.action), ["replace-edit-text", "press"],
  "An unready search cannot close search or start another navigation strategy after its deadline");
const wrongWindow = fixture();
assert.equal((await wrongWindow.run({ hwnd: 43 })).kind, "stale-window"); assert.equal(wrongWindow.actions.length, 0);
const forbidden = fixture();
assert.equal((await forbidden.run({ pageId: undefined, name: "Steuerdaten versenden" })).kind, "blocked");
assert.equal(forbidden.reads, 0); assert.equal(forbidden.actions.length, 0);
const targetSnapshot = (() => {
  const { nodes, add } = builder();
  const heading = add("Group", "", "main.ClientFrameSSE.ClientHeader");
  add("Text", "Target page", "main.ClientFrameSSE.ClientHeader.QLabel", heading);
  add("Edit", "", "main.requiredField", -1, { val: "17,00", ro: false });
  return snapshot(nodes);
})();
assert.equal(gotoTargetState(targetSnapshot, knownProfile, "Target page", page).ready, true);
assert.equal(gotoTargetState({ ...targetSnapshot, nodes: targetSnapshot.nodes.slice(0, 2) }, knownProfile, "Target page", page).ready, false);
const tableProfile = { ...knownProfile, pageObjectsCatalog: { ...knownProfile.pageObjectsCatalog,
  focuslessCommits: { synthetic: { heading: "Target page", controlType: "DataItem", automationIdSuffix: ".requiredTable",
    requiredSumChecks: [{ label: "Summe", occurrence: 1 }, { label: "Summe", occurrence: 2 }] } } } };
const completeTable = options => {
  const { nodes, add } = builder();
  add("Tree", "", "main.NavWidgetSSE", -1, { x: 0, w: 200 });
  const heading = add("Group", "", "main.ClientFrameSSE.ClientHeader");
  add("Text", "Target page", "main.ClientFrameSSE.ClientHeader.QLabel", heading);
  add("Edit", "", "main.requiredField", -1, { val: "17,00", ro: false });
  add("Table", "", "main.requiredTable", -1, options?.table ?? {});
  if (options?.duplicateTable) add("Table", "", "other.requiredTable");
  for (const [index, y] of [400, 450].entries()) {
    if (index === 1 && options?.missingSecond) continue;
    add("Text", index === 1 && options?.wrongCase ? "summe" : "Summe", "main.caption", -1, { x: 400, y });
    add("Edit", "", "main.total", -1, { x: 600, y, val: index === 1 && options?.blankSecond ? " " : "0,00", ro: true });
  }
  return snapshot(nodes);
};
assert.equal(gotoTargetState(completeTable(), tableProfile, "Target page", page).ready, true);
for (const options of [{ table: { on: false } }, { table: { w: 0 } }, { duplicateTable: true },
  { missingSecond: true }, { wrongCase: true }, { blankSecond: true }]) {
  assert.equal(gotoTargetState(completeTable(options), tableProfile, "Target page", page).ready, false, JSON.stringify(options));
}
console.log("Native goto: actual-worker route/search/navigation/summary parity and bounded transaction, full target, warning, stale, unknown-ack and no-replay boundaries passed.");
