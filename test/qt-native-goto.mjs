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
const dynamicPage = { ...page, headingPrefix: "Target page: " };
const dynamicNavigation = navigationPage();
dynamicNavigation[1].name = "Target page: Example";
const ambiguousNavigation = structuredClone(dynamicNavigation);
ambiguousNavigation.push({ ...ambiguousNavigation[1], i: 2, rid: "42.42.4.3", name: "Target page: Other", y: 175 });
navigation.push({ nodes: dynamicNavigation, target: "Target page: ", page: dynamicPage },
  { nodes: ambiguousNavigation, target: "Target page: ", page: dynamicPage },
  { nodes: ambiguousNavigation.map(node => node.i === 2 ? { ...node, on: false } : node), target: "Target page: ", page: dynamicPage },
  { nodes: ambiguousNavigation.map(node => node.i === 2 ? { ...node, y: 395 } : node), target: "Target page: ", page: dynamicPage },
  { nodes: dynamicNavigation, target: "Target page: " },
  { nodes: dynamicNavigation.map(node => node.i === 1 ? { ...node, on: false } : node), target: "Target page: ", page: dynamicPage },
  { nodes: dynamicNavigation.map(node => node.i === 1 ? { ...node, y: 395 } : node), target: "Target page: ", page: dynamicPage });
assert.equal(visibleNavigationItem(dynamicNavigation, "Target page: ", dynamicPage)?.rid, "42.42.4.2");
assert.equal(visibleNavigationItem(ambiguousNavigation, "Target page: ", dynamicPage), null);
assert.equal(visibleNavigationItem(navigation[5].nodes, "Target page: ", dynamicPage), null);
assert.equal(visibleNavigationItem(navigation[6].nodes, "Target page: ", dynamicPage), null);
assert.equal(visibleNavigationItem(dynamicNavigation, "Target page: "), null);
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
  assert.deepEqual(navigation.map(test => visibleNavigationItem(test.nodes, test.target, test.page)?.rid ?? null), expected.navigation);
  assert.deepEqual(sums.map(test => {
    const result = summaryFromNodes(snapshot(test.nodes), test.label, test.occurrence);
    return result ? { label: result.label, value: result.value, y: result.y } : null;
  }), expected.summaries);
} finally { rmSync(temporary, { recursive: true, force: true }); }

function fixture(options = {}) {
  let current = options.start ?? "Start page", searchOpen = false, term = "", reads = 0, targetReads = 0, incompleteNativeReads = 0;
  let pendingReadObserved = false, pageGeneration = 0, queuedSearchReads = 0;
  const actions = [], trace = [], route = [...(options.landings ?? ["Target page"])];
  const readyHeading = options.readyHeading ?? "Target page";
  const nodes = () => {
    const { nodes: value, add } = builder();
    const header = add("Group", "", "main.ClientFrameSSE.ClientHeader");
    if (!searchOpen || current === readyHeading) add("Text", current, "main.ClientFrameSSE.ClientHeader.QLabel", header);
    const nav = add("Tree", "", "main.NavWidgetSSE", -1, { x: 10, y: 100, w: 240, h: 500 });
    if (options.visibleTarget) add("TreeItem", options.navigationName ?? "Target page", "main.NavWidgetSSE", nav, { x: 20, y: 150 });
    if (current === readyHeading) {
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
        if (!options.noHit) (options.searchRows ?? ["Target page"]).forEach((title, index) =>
          add("DataItem", title, "main.DialogSearchResultsTableView", table, { x: 80, y: 200 + index * 25 }));
      }
    }
    if (options.rematerializePages) value.forEach(node => { node.rid = `42.42.4.${pageGeneration * 1000 + node.i + 1}`; });
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
      if (options.snapshotHeadings) current = options.snapshotHeadings[Math.min(reads - 1, options.snapshotHeadings.length - 1)];
      trace.push({ event: "read", heading: current, actionCount: actions.length });
      if (searchOpen && queuedSearchReads < (options.queuedSearchReads ?? 0)) {
        queuedSearchReads++;
        return { durationMs: 2000, result: { ok: false, code: "GUI_QUEUE_TIMEOUT", error: "Read cancelled before dispatch",
          mutationAttempted: false, outcomeUnknown: false } };
      }
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
      trace.push({ event: "action", name: target.name });
      if (options.rejectAction) return { durationMs: 1, receiptAcknowledged: false,
        result: { ok: false, mutationAttempted: false, code: "stale", error: "Stale target" } };
      if (args.action === "replace-edit-text") { assert.equal(args.expectedValue, term); term = args.value; }
      else if (args.action === "activate-navigation-item" || args.action === "activate-table-cell") current = options.noActivation ? current : options.activationHeading ?? "Target page";
      else if (target.aid.endsWith("searchButton")) searchOpen = true;
      else if (target.name === "Suche schließen") searchOpen = false;
      else { assert(["Weiter", "Zurück"].includes(target.name)); current = route.shift() ?? current; pageGeneration++; }
      if (options.lostAcknowledgment) throw new QtNativeAcknowledgmentError("Acknowledgment lost", "native-ack",
        { ok: true, mutationAttempted: true });
      return { durationMs: 1, receiptAcknowledged: true, mutationAckMs: 1, result: { ok: true, mutationAttempted: true } };
    },
  };
  return { actions, trace, get reads() { return reads; }, run: args => executeQtNativeOperation("goto",
    { pageId: "synthetic.target", hwnd: 42, ...args }, { qtNativeClient: client }, options.timeoutMs ?? 8000, undefined, options.profile ?? knownProfile) };
}
assert(isQtNativeOperation("goto"));
const already = fixture({ start: "Target page" });
assert.equal((await already.run()).erreicht, true); assert.equal(already.actions.length, 0);
const delayed = fixture({ start: "Target page", incompleteReads: 2 });
assert.equal((await delayed.run()).erreicht, true); assert.equal(delayed.actions.length, 0);
// Seeing the exact target starts a bounded readiness proof, never another
// navigation strategy when the target disappears before that proof completes.
const targetDriftCases = [
  { name: "initial target drift", headings: ["Target page", "Other page"], visibleTarget: true, actions: [], phase: "precondition" },
  { name: "pre-loop target drift", headings: ["Start page", "Target page", "Other page"], actions: [], phase: "paging" },
  { name: "post-step target drift", headings: ["Start page", "Start page", "Target page", "Other page"], actions: ["Weiter"], phase: "paging" },
  { name: "unchanged incomplete target", headings: ["Target page"], visibleTarget: true, actions: [], phase: "precondition" },
];
const targetDriftResults = [];
for (const test of targetDriftCases) {
  const subject = fixture({ snapshotHeadings: test.headings, visibleTarget: test.visibleTarget, incompleteReads: Infinity });
  const result = await subject.run({ useSearch: false, maxSteps: 2 });
  targetDriftResults.push({ name: test.name, ok: result.ok, kind: result.kind, phase: result.phase,
    mutationAttempted: result.mutationAttempted, outcomeUnknown: result.outcomeUnknown,
    actions: subject.actions.map(action => action.expectedName), trace: subject.trace, error: result.error });
}
assert.deepEqual(targetDriftResults.map(({ name, ok, kind, phase, mutationAttempted, outcomeUnknown, actions }) =>
  ({ name, ok, kind, phase, mutationAttempted, outcomeUnknown, actions })), targetDriftCases.map(test =>
  ({ name: test.name, ok: false, kind: "navigation-blocked", phase: test.phase,
    mutationAttempted: test.actions.length > 0, outcomeUnknown: test.actions.length > 0, actions: test.actions })),
JSON.stringify(targetDriftResults));
for (const result of targetDriftResults) {
  const firstTarget = result.trace.findIndex(entry => entry.event === "read" && entry.heading === "Target page");
  assert(firstTarget >= 0, result.name);
  assert.equal(result.trace.slice(firstTarget + 1).filter(entry => entry.event === "action").length, 0,
    `${result.name}: no further dispatch after the exact target is seen`);
  assert.match(result.error, /no further navigation dispatched/i, result.name);
}
const tree = fixture({ visibleTarget: true });
assert.equal((await tree.run()).richtung, "Navigationsbaum"); assert.equal(tree.actions.length, 1);
assert.equal(tree.actions[0].action, "activate-navigation-item");
const dynamicProfile = { ...knownProfile, pageObjectsCatalog: { ...knownProfile.pageObjectsCatalog,
  pages: { ...knownProfile.pageObjectsCatalog.pages, "synthetic.target": dynamicPage } } };
const dynamicTree = fixture({ visibleTarget: true, navigationName: "Target page: Example", profile: dynamicProfile });
assert.equal((await dynamicTree.run()).richtung, "Navigationsbaum");
assert.deepEqual(dynamicTree.actions.map(action => action.expectedName), ["Target page: Example"]);
const unreadyDynamicTree = fixture({ visibleTarget: true, navigationName: "Target page: Example",
  profile: dynamicProfile, activationHeading: "Target page: Other" });
assert.equal((await unreadyDynamicTree.run()).ok, false);
assert.equal(unreadyDynamicTree.actions.length, 1, "A dynamic caption cannot replace the exact field readiness proof");
const wrongTree = fixture({ visibleTarget: true, activationHeading: "Other page" });
const wrongTreeFailure = await wrongTree.run();
assert.equal(wrongTreeFailure.ok, false);
assert.equal(wrongTreeFailure.kind, "not-found");
assert.equal(wrongTreeFailure.ueberschrift, "Other page");
assert.equal(wrongTreeFailure.outcomeUnknown, true);
assert.match(wrongTreeFailure.error, /exact page heading or a catalogued pageId/);
assert.deepEqual(wrongTree.actions.map(action => action.action), ["activate-navigation-item"],
  "A wrong tree landing reports the actual page without starting search or paging");
const groupedProfile = { ...knownProfile, pageObjectsCatalog: { ...knownProfile.pageObjectsCatalog,
  pages: { ...knownProfile.pageObjectsCatalog.pages,
    "synthetic.target": { ...page, navigationTreeItemName: "Target group" } } } };
const groupedTree = fixture({ visibleTarget: true, navigationName: "Target group", profile: groupedProfile });
const groupedTreeResult = await groupedTree.run();
assert.equal(groupedTreeResult.erreicht, true);
assert.equal(groupedTreeResult.ueberschrift, "Target page");
assert.deepEqual(groupedTree.actions.map(action => action.expectedName), ["Target group"],
  "A catalogued group label remains valid when the exact target page is verified");
const absentGroup = fixture({ visibleTarget: true, navigationName: "Target page: Example", profile: groupedProfile });
await absentGroup.run();
assert.equal(absentGroup.actions.filter(action => action.action === "activate-navigation-item").length, 0,
  "An explicit catalogue tree name cannot be replaced by a dynamic page caption");
const ordinalProfile = { ...knownProfile, pageObjectsCatalog: { ...knownProfile.pageObjectsCatalog,
  pages: { ...knownProfile.pageObjectsCatalog.pages, "synthetic.target": {
    ...page, heading: "1. Wirtschaftsgut", headingPrefix: "1. " } } } };
const ordinalTree = fixture({ visibleTarget: true, navigationName: "1. Reise", profile: ordinalProfile, noHit: true });
await ordinalTree.run({ maxSteps: 1 });
assert.equal(ordinalTree.actions.filter(action => action.action === "activate-navigation-item").length, 0,
  "A bare ordinal prefix must not select a tree item of another page kind");
const assetPageId = "gew.anlagevermoegen_wirtschaftsgut";
const catalogAsset = profile.pageObjectsCatalog.pages[assetPageId];
assert.equal(catalogAsset.headingPrefix, "1. ");
assert(Object.keys(catalogAsset.fields).length > 0, "The real asset page requires a semantic field binding");
const ordinalSearchResults = [];
for (const wrongTitle of ["1. Reise", "1. Fahrzeug"]) {
  const subject = fixture({ profile, searchRows: [wrongTitle], activationHeading: wrongTitle, deadEnd: true });
  const result = await subject.run({ pageId: assetPageId, maxSteps: 1 });
  ordinalSearchResults.push({ title: wrongTitle, ok: result.ok, kind: result.kind,
    actions: subject.actions.map(action => ({ action: action.action, name: action.expectedName })), trace: subject.trace });
}
assert.deepEqual(ordinalSearchResults.map(result => result.actions.filter(action => action.action === "activate-table-cell")),
  [[], []], `A bare ordinal must not activate another page kind: ${JSON.stringify(ordinalSearchResults)}`);
for (const result of ordinalSearchResults) {
  assert.equal(result.ok, false, result.title);
  assert.equal(result.kind, "dead-end", result.title);
  assert.deepEqual(result.actions, [{ action: "replace-edit-text", name: "" }, { action: "press", name: "" },
    { action: "press", name: "Suche schließen" }], `${result.title}: the search must run and close without selecting a foreign title`);
}
const exactOrdinalSearch = fixture({ profile, searchRows: ["1. "], activationHeading: "1. ", deadEnd: true });
const exactOrdinalResult = await exactOrdinalSearch.run({ pageId: assetPageId, maxSteps: 1 });
assert.equal(exactOrdinalResult.ok, false);
assert.equal(exactOrdinalResult.kind, "navigation-blocked", "An exact search row alone cannot replace the asset field readiness proof");
assert.deepEqual(exactOrdinalSearch.actions.map(action => ({ action: action.action, name: action.expectedName })),
  [{ action: "replace-edit-text", name: "" }, { action: "press", name: "" },
    { action: "activate-table-cell", name: "1. " }, { action: "press", name: "Suche schließen" }],
  "The exact literal row remains selectable once; unproved page readiness cannot replay it or start paging");
const exactSearch = fixture({ searchRows: ["Other page", "Target page"] });
assert.equal((await exactSearch.run()).erreicht, true);
assert.deepEqual(exactSearch.actions.filter(action => action.action === "activate-table-cell").map(action => action.expectedName), ["Target page"],
  "The unique exact title remains bound to its own search row");
const namedDynamicSearchProfile = { ...dynamicProfile, pageObjectsCatalog: { ...dynamicProfile.pageObjectsCatalog,
  pages: { ...dynamicProfile.pageObjectsCatalog.pages,
    "synthetic.target": { ...dynamicPage, navigationTreeItemName: "Target group" } } } };
const dynamicSearch = fixture({ profile: namedDynamicSearchProfile, searchRows: ["Target page: Example"],
  activationHeading: "Target page: Example", readyHeading: "Target page: Example" });
assert.equal((await dynamicSearch.run()).erreicht, true);
assert.deepEqual(dynamicSearch.actions.filter(action => action.action === "activate-table-cell").map(action => action.expectedName), ["Target page: Example"],
  "A nonordinal dynamic search family remains valid even with a different explicit tree label");
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
// Numbered assets legitimately repeat the same detail-form transition. The
// last complete numbered heading is stable context; transient runtime IDs are not.
const assetDetails = ["Weitere Kosten zur Anschaffung", "Einlage oder Ausscheiden des Wirtschaftsguts"];
const assets = fixture({ start: "1. Synthetic desk", rematerializePages: true,
  landings: [...assetDetails, "Investitionsabzugsbetrag oder Sonderabschreibung", "Änderung der Restnutzungsdauer",
    "2. Synthetic chair", ...assetDetails, "Target page"] });
const assetsResult = await assets.run({ useSearch: false, maxSteps: 8 });
assert.equal(assetsResult.ok, true, "Different numbered assets must not turn their shared detail forms into a cycle.");
assert.equal(assetsResult.erreicht, true); assert.equal(assetsResult.schritte, 8);
assert.deepEqual(assets.actions.map(action => action.expectedName), Array(8).fill("Weiter"));
const sameOrdinal = fixture({ start: "1. Synthetic desk",
  landings: [...assetDetails, "1. Synthetic chair", ...assetDetails, "Target page"] });
const sameOrdinalResult = await sameOrdinal.run({ useSearch: false, maxSteps: 6 });
assert.equal(sameOrdinalResult.ok, true, "Entry context must retain the full heading, not only its ordinal.");
assert.equal(sameOrdinal.actions.length, 6);
for (const start of ["Start page", "1. Synthetic desk"]) {
  const cycle = fixture({ start, rematerializePages: true,
    landings: [...assetDetails, ...assetDetails, "Target page"] });
  const result = await cycle.run({ useSearch: false, maxSteps: 5 });
  assert.equal(result.ok, false); assert.equal(result.kind, "no-progress");
  assert.match(result.error, /directed navigation transition repeated/);
  assert.equal(result.phase, "paging"); assert.equal(result.schritte, 4);
  assert.equal(result.outcomeUnknown, true); assert.equal(result.mutationAttempted, true);
  assert.equal(cycle.actions.length, 4, "A real cycle must stop before another action, even when all runtime IDs change.");
}
const previousAsset = fixture({ start: "1. Synthetic desk",
  landings: [...assetDetails, "2. Synthetic chair", ...assetDetails, "1. Synthetic desk", ...assetDetails, "Target page"] });
const previousAssetResult = await previousAsset.run({ useSearch: false, maxSteps: 9 });
assert.equal(previousAssetResult.kind, "no-progress");
assert.equal(previousAssetResult.schritte, 7); assert.equal(previousAsset.actions.length, 7,
  "Changing entry context must not erase transitions already seen in an earlier asset.");
// A different entry context permits genuine progress, never repeated presses
// on one unchanged page. Keep this boundary independent of wall-clock delays.
const stationaryPerformance = globalThis.performance;
let stationaryClock = 0;
globalThis.performance = { now: () => (stationaryClock += 1000) };
let stationaryResult, stationary;
try {
  stationary = fixture({ start: "Unmoving page", landings: [], timeoutMs: 300_000, rematerializePages: true });
  stationaryResult = await stationary.run({ useSearch: false, maxSteps: 10 });
} finally { globalThis.performance = stationaryPerformance; }
assert.equal(stationaryResult.kind, "no-progress");
assert.match(stationaryResult.error, /Five bounded paging attempts/);
assert.equal(stationaryResult.schritte, 5); assert.equal(stationary.actions.length, 5);
assert.equal(stationaryResult.outcomeUnknown, true);
const noHit = fixture({ noHit: true });
assert.equal((await noHit.run({ maxSteps: 1 })).erreicht, true);
assert.equal(noHit.actions.filter(action => action.action === "activate-table-cell").length, 0);
const busySearch = fixture({ queuedSearchReads: 2 });
assert.equal((await busySearch.run()).erreicht, true);
assert.deepEqual(busySearch.actions.map(action => action.action),
  ["replace-edit-text", "press", "activate-table-cell", "press"], "Busy read recovery must not replay a search or activation.");
const blockedSearch = fixture({ queuedSearchReads: 10 });
assert.equal((await blockedSearch.run()).kind, "GUI_QUEUE_TIMEOUT");
assert.equal(blockedSearch.reads, 5, "The queued search read must stop after three attempts.");
assert.deepEqual(blockedSearch.actions.map(action => action.action), ["replace-edit-text", "press"]);
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
