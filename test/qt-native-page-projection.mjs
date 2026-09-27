import assert from "node:assert/strict";
import { executeQtNativePage } from "../dist/qt-native-page.js";
import { powershellCompactJson } from "../dist/qt-native-projections.js";
import { loadProductProfile } from "../dist/product-profiles.js";

// Direct Qt 'page' projection against synthetic trees: the happy paths pin the
// worker's exact result contract, the remaining cases pin every fail-closed guard.

const profile = loadProductProfile("2025");
const stats = { n: 0, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
  valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 };
const windowOf = (hwnd, title, size = { w: 1000, h: 700 }, extra = {}) => ({
  hwnd, pid: 99, class: "Qt692QWindowIcon", title, x: 0, y: 0, ...size, minimized: false, hung: false, ...extra,
});
const WERTE_INFO = "Werte-Info: Werte vergleichen - Was wäre wenn";

// Owned catalogued windows answer a snapshot by exact title: a small Werte-Info table, a tips line, an empty BelegManager.
const toolNode = (hwnd, i, type, name, x, y, extra = {}) => ({ i, p: -1, d: 0, type, name, aid: `tool.${hwnd}`, rid: `42.${hwnd}.4.${i + 1}`,
  x, y, w: 80, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
const TOOLS = {
  [WERTE_INFO]: { hwnd: 84, rect: { x: 0, y: 0, w: 400, h: 300 }, durationMs: 4,
    nodes: [toolNode(84, 0, "Header", "Aktuell", 20, 40), toolNode(84, 1, "DataItem", "1.000,00", 20, 70)] },
  "Steuer-Spar-Tipps": { hwnd: 85, rect: { x: 0, y: 0, w: 400, h: 300 }, durationMs: 6, nodes: [toolNode(85, 0, "Text", "Fahrtenbuch führen", 20, 40)] },
  BelegManager: { hwnd: 87, rect: { x: 0, y: 0, w: 1800, h: 1200 }, durationMs: 8, nodes: [] },
};

function makeClient(nodes, rect, windows, overrides = {}) {
  const operations = [];
  // The bridge lists and counts the bound process's windows; the product count spans every product process.
  const { snapshot: snapshotOverride = {}, tool: toolOverride = {},
    inventory = { ok: true, windows, visibleWindowCount: windows.length, productWindowCount: windows.length, untitledWindows: [] } } = overrides;
  const base = { ok: true, controllerBound: true, scope: "qt-accessibility-content", windowEnabled: true, modalBlocked: false, exactMatches: {} };
  const snapshot = { ...base, hwnd: 42, windowRect: rect, nodes, stats: { ...stats, n: nodes.length }, ...snapshotOverride };
  const answers = {
    accessibility_snapshot: args => {
      if (args.toolTitle === undefined) { assert.deepEqual(args, { maxNodes: 5000 }); return { durationMs: 3, result: snapshot }; }
      const tool = TOOLS[args.toolTitle];
      assert(tool, `unexpected tool snapshot for ${args.toolTitle}`);
      assert.deepEqual(args, { maxNodes: 5000, toolTitle: args.toolTitle });
      return { durationMs: tool.durationMs, result: { ...base, hwnd: tool.hwnd, windowRect: tool.rect, nodes: tool.nodes,
        stats: { ...stats, n: tool.nodes.length }, ...toolOverride } };
    },
    window_inventory: args => { assert.deepEqual(args, {}); return { durationMs: 2, result: inventory }; },
  };
  const client = { binding: { hwnd: 42, pid: 99, creationTime: "1" }, request: async (operation, args) => {
    operations.push(args?.toolTitle === undefined ? operation : `${operation}:${args.toolTitle}`);
    return answers[operation](args);
  } };
  return { client, operations };
}

function treeBuilder() {
  const nodes = [];
  const node = (type, name, x, y, extra = {}) => {
    const i = nodes.length;
    const { p = -1 } = extra;
    const { d: parentDepth = -1 } = nodes[p] ?? {};
    nodes.push({ i, p, d: parentDepth + 1, type, name, aid: "", rid: `42.42.4.${i + 1}`, x, y, w: 80, h: 20,
      on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
    return i;
  };
  return { nodes, node };
}

// --- Happy path: heading, labelled fields, table with a free row, deduplicated actions, checker, foreign window.
const full = treeBuilder();
const nav = full.node("Tree", "Navigation", 0, 60, { w: 200, h: 600 });
full.node("TreeItem", "Einnahmen", 10, 80, { p: nav, selected: true });
full.node("TreeItem", "Ausgaben", 10, 100, { p: nav, selected: false });
full.node("Button", "Eingabehilfe", 800, 200);
full.node("Button", "Speichern", 300, 10, { on: false, aid: "window.MainToolBar.tb_sichern" });
const header = full.node("Group", "", 220, 20, { w: 600, h: 30, aid: "window.ClientFrameSSE.ClientHeader" });
full.node("Text", "Synthetic heading", 220, 25, { p: header });
full.node("Text", "Navigation label", 100, 100);
full.node("Text", "Weit links", 210, 100);
full.node("Text", "Betrag", 300, 98);
const amount = full.node("Edit", "", 400, 104, { val: "12,00", ro: false, aid: "window.RedThreadContent.Betrag.Text" });
full.node("Text", "Hinweis", 220, 130);
const choice = full.node("ComboBox", "", 400, 130, { val: "", ro: false, aid: "window.RedThreadContent.Auswahl.Combobox" });
const option = full.node("CheckBox", "Option", 400, 160, { checked: true, aid: "window.RedThreadContent.Option" });
full.node("Text", "Wahl", 220, 190);
const radio = full.node("RadioButton", "Ja", 400, 190, { selected: false, aid: "window.RedThreadContent.Wahl.Ja" });
full.node("Edit", "", 900, 104, { val: "outside", ro: false, aid: "window.Help.Edit" });
full.node("Text", "Zu tief", 220, 205);
full.node("Header", "Datum", 220, 270, { w: 100 });
full.node("Header", "Betrag", 400, 270, { w: 100 });
full.node("Header", "", 500, 270, { w: 100 });
full.node("Header", "Leer", 600, 270, { w: 0 });
full.node("DataItem", "01.01.2025", 220, 300);
full.node("DataItem", "10,00", 400, 300);
const freeDate = full.node("DataItem", "", 220, 325);
const freeAmount = full.node("DataItem", "0,00", 400, 325);
full.node("DataItem", "", 220, 350);
full.node("DataItem", "0", 400, 358);
full.node("DataItem", "hidden", 500, 300, { w: 0 });
full.node("Hyperlink", "Erfassen", 600, 250);
full.node("Button", "Erfassen", 600, 250);
full.node("Button", "weiter", 650, 280);
full.node("Button", "Weiter", 600, 280);
full.node("Button", "ELSTER versenden", 600, 310);
full.node("Button", "", 600, 340);
full.node("Button", "Erfassen", 850, 250);
full.node("TreeItem", "Fehlende Angabe zur Anlage N", 820, 400);
full.node("TreeItem", "Fehlende Angabe zur Anlage N", 820, 420);
full.node("TreeItem", "Eingabehilfe", 820, 440);
full.node("TreeItem", "prüfer", 820, 460);
full.node("TreeItem", "x".repeat(90), 820, 480);
full.node("TreeItem", "fehlende angabe zur anlage n", 820, 500);
const foreign = full.node("Window", "Werte-Info", 300, 300, { w: 300, h: 200, aid: "window.WerteInfo", rid: "42.7" });
full.node("Header", "Fremd", 310, 320, { p: foreign, w: 50, rid: "42.7.4.1" });
full.node("DataItem", "99,99", 310, 340, { p: foreign, rid: "42.7.4.2" });
full.node("Text", "Fremdtext", 310, 360, { p: foreign, rid: "42.7.4.3" });
const fullRect = { x: 0, y: 0, w: 1000, h: 700 };
const twoWindows = [windowOf(42, "SteuerSparErklärung 2025"), windowOf(84, WERTE_INFO, { w: 400, h: 300 })];

const happy = makeClient(full.nodes, fullRect, twoWindows);
const page = await executeQtNativePage(happy.client, { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(happy.operations, ["window_inventory", "accessibility_snapshot", `accessibility_snapshot:${WERTE_INFO}`]);
assert.deepEqual(Object.keys(page), ["hinweis", "ok", "ueberschrift", "ueberschriftQuelle", "navigationAuswahl", "ausgeschlosseneFenster",
  "felder", "tabelle", "aktionen", "blockiert", "prueferMeldungen", "leerePflichtfelder", "dialoge", "offeneFenster", "stats",
  "backend", "nativeDurationMs"]);
assert.deepEqual(page, {
  hinweis: null,
  ok: true,
  ueberschrift: "Synthetic heading",
  ueberschriftQuelle: "clientHeader",
  navigationAuswahl: "Einnahmen",
  // The in-tree foreign window comes first, the owned Werte-Info read by title follows with the window's own facts.
  ausgeschlosseneFenster: [
    { rid: "42.7", name: "Werte-Info", aid: "window.WerteInfo", x: 300, y: 300, w: 300, h: 200, nodeCount: 4 },
    { rid: "42.84", name: WERTE_INFO, aid: "", x: 0, y: 0, w: 400, h: 300, nodeCount: 3 },
  ],
  felder: [
    { label: "Betrag", typ: "Edit", wert: "12,00", schreibgeschuetzt: false, aid: "Text", rid: `42.42.4.${amount + 1}`, y: 104 },
    { label: "Hinweis", typ: "ComboBox", wert: "", schreibgeschuetzt: false, aid: "Combobox", rid: `42.42.4.${choice + 1}`, y: 130 },
    { label: "Option", typ: "CheckBox", wert: true, schreibgeschuetzt: null, aid: "Option", rid: `42.42.4.${option + 1}`, y: 160 },
    { label: "Wahl", typ: "RadioButton", wert: false, schreibgeschuetzt: null, aid: "Ja", rid: `42.42.4.${radio + 1}`, y: 190 },
  ],
  tabelle: {
    kopf: ["Datum", "Betrag"],
    zeilen: ["01.01.2025", "10,00", "", "0,00", "", "0"],
    sichtbareZeilen: 3,
    ersteFreieZeile: [{ x: 220, rid: `42.42.4.${freeDate + 1}` }, { x: 400, rid: `42.42.4.${freeAmount + 1}` }],
    hinweis: "Nur die SICHTBAREN Zeilen. Bei mehr Zeilen sse_table_read benutzen.",
  },
  aktionen: [
    { name: "Speichern", typ: "Button", bereich: "werkzeugleiste", aktiviert: false, gesperrt: false, werkzeug: "sse_click" },
    { name: "Eingabehilfe", typ: "Button", bereich: "hilfespalte", aktiviert: true, gesperrt: false, werkzeug: "sse_click" },
    { name: "Erfassen", typ: "Hyperlink", bereich: "seite", aktiviert: true, gesperrt: false, werkzeug: "sse_click_point" },
    { name: "Erfassen", typ: "Button", bereich: "hilfespalte", aktiviert: true, gesperrt: false, werkzeug: "sse_click" },
    { name: "Weiter", typ: "Button", bereich: "seite", aktiviert: true, gesperrt: false, werkzeug: "sse_click" },
    { name: "ELSTER versenden", typ: "Button", bereich: "seite", aktiviert: true, gesperrt: true, werkzeug: "(gesperrt)" },
  ],
  blockiert: true,
  prueferMeldungen: ["Fehlende Angabe zur Anlage N", "fehlende angabe zur anlage n"],
  leerePflichtfelder: ["Hinweis"],
  dialoge: [],
  offeneFenster: 2,
  stats: { ...stats, n: full.nodes.length },
  backend: "qt",
  nativeDurationMs: 9,
});

// --- Collapsed navigation, no heading container, unlabelled fields, ambiguous selection, three windows.
const bare = treeBuilder();
bare.node("Tree", "Navigation", 100, 100, { w: 0, h: 600 });
const plain = bare.node("Edit", "", 400, 300, { ro: true });
const solo = bare.node("Edit", "", 500, 300, { val: "x", ro: false, aid: "Solo" });
bare.node("Text", "Caption", 50, 300);
bare.node("Button", "Ok", 400, 100);
bare.node("Button", "Senden", 400, 300);
bare.node("TreeItem", "Pick", 50, 400, { selected: true });
bare.node("TreeItem", "Pick2", 50, 420, { selected: true });
const bareRect = { x: 100, y: 50, w: 1000, h: 700 };
const threeWindows = [...twoWindows, windowOf(85, "Steuer-Spar-Tipps", { w: 400, h: 300 })];
const unlabelled = makeClient(bare.nodes, bareRect, threeWindows);
assert.deepEqual(await executeQtNativePage(unlabelled.client, { hwnd: 42 }, 5000, undefined, profile), {
  hinweis: "Kein Feld dieser Seite hat eine Beschriftung - die Beschriftungsspalte liegt ausserhalb des erkannten Inhaltsbereichs. "
    + "Felder hier nur ueber rid ansprechen; ein Zugriff ueber die Beschriftung scheitert mit bad-target. "
    + "Abhilfe: Navigationsspalte einblenden oder das Fenster maximieren.",
  ok: true,
  ueberschrift: null,
  ueberschriftQuelle: "nicht-gefunden",
  navigationAuswahl: null,
  ausgeschlosseneFenster: [
    { rid: "42.84", name: WERTE_INFO, aid: "", x: 0, y: 0, w: 400, h: 300, nodeCount: 3 },
    { rid: "42.85", name: "Steuer-Spar-Tipps", aid: "", x: 0, y: 0, w: 400, h: 300, nodeCount: 2 },
  ],
  felder: [
    { label: "", typ: "Edit", wert: null, schreibgeschuetzt: true, aid: "", rid: `42.42.4.${plain + 1}`, y: 300 },
    { label: "", typ: "Edit", wert: "x", schreibgeschuetzt: false, aid: "Solo", rid: `42.42.4.${solo + 1}`, y: 300 },
  ],
  tabelle: null,
  aktionen: [
    { name: "Ok", typ: "Button", bereich: "werkzeugleiste", aktiviert: true, gesperrt: false, werkzeug: "sse_click" },
    { name: "Senden", typ: "Button", bereich: "seite", aktiviert: true, gesperrt: true, werkzeug: "(gesperrt)" },
  ],
  blockiert: true,
  prueferMeldungen: [],
  leerePflichtfelder: [],
  dialoge: [],
  offeneFenster: 3,
  stats: { ...stats, n: bare.nodes.length },
  backend: "qt",
  nativeDurationMs: 15,
});
assert.deepEqual(unlabelled.operations, ["window_inventory", "accessibility_snapshot", `accessibility_snapshot:${WERTE_INFO}`,
  "accessibility_snapshot:Steuer-Spar-Tipps"]);

// --- Empty tree: the worker treats an empty bulk snapshot as a failed read, so nothing is projected from it.
const empty = makeClient([], fullRect, [twoWindows[0]]);
assert.deepEqual(await executeQtNativePage(empty.client, { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "native-incomplete", error: "Der native Seitenbaum ist leer; keine Seite ausgegeben." });
// --- A second case window of the process is no dialog for the worker either; only the window count sees it.
const secondCase = makeClient(full.nodes, fullRect, [twoWindows[0], windowOf(91, "SteuerSparErklärung 2025 - zweiter Fall", { w: 950, h: 600 })]);
const withSecondCase = await executeQtNativePage(secondCase.client, { hwnd: 42 }, 5000, undefined, profile);
assert.equal(withSecondCase.ok, true);
assert.equal(withSecondCase.offeneFenster, 2);
assert.deepEqual(secondCase.operations, ["window_inventory", "accessibility_snapshot"]);
// --- A system overlay and a Werte-Info of another process are neither owned nor read; only the overlay is counted.
const unowned = makeClient(full.nodes, fullRect, [twoWindows[0], windowOf(86, "UAC", { w: 40, h: 40 }, { class: "UAC_Overlay" }),
  { ...twoWindows[1], hwnd: 92, pid: 7 }]);
const withUnowned = await executeQtNativePage(unowned.client, { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(withUnowned.ausgeschlosseneFenster, page.ausgeschlosseneFenster.slice(0, 1));
assert.equal(withUnowned.offeneFenster, 3);
assert.deepEqual(unowned.operations, ["window_inventory", "accessibility_snapshot"]);
// --- An owned window that is blocked, disabled, truncated or answers under another handle ends the read.
const ownedBlocked = makeClient(full.nodes, fullRect, twoWindows, { tool: { modalBlocked: true } });
assert.deepEqual(await executeQtNativePage(ownedBlocked.client, { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt",
  kind: "dialog-open", error: "Ein modaler Dialog blockiert ein Nebenfenster der gebundenen Seite; Seite nicht gelesen." });
assert.deepEqual(ownedBlocked.operations, ["window_inventory", "accessibility_snapshot", `accessibility_snapshot:${WERTE_INFO}`]);
const ownedDisabled = makeClient(full.nodes, fullRect, twoWindows, { tool: { windowEnabled: false } });
assert.equal((await executeQtNativePage(ownedDisabled.client, { hwnd: 42 }, 5000, undefined, profile)).kind, "dialog-open");
const ownedTruncated = makeClient(full.nodes, fullRect, twoWindows, { tool: { stats: { ...stats, n: 2, truncated: true } } });
assert.deepEqual(await executeQtNativePage(ownedTruncated.client, { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt",
  kind: "native-incomplete", error: "Der native Baum eines Nebenfensters ueberschreitet die Lesegrenze; Seite nicht gelesen." });
const ownedMismatch = makeClient(full.nodes, fullRect, twoWindows, { tool: { hwnd: 85 } });
await assert.rejects(executeQtNativePage(ownedMismatch.client, { hwnd: 42 }, 5000, undefined, profile), { kind: "native-contract" });

// --- Fail closed: modal dialog, disabled window, truncated tree, foreign hwnd, missing profile, deadline, inventory faults.
const dialogOpen = { ok: false, backend: "qt", kind: "dialog-open",
  error: "Ein modaler Dialog blockiert die gebundene Seite; keine Werte ausgegeben. Dialoge mit sse_dialog_list lesen." };
const modal = makeClient(full.nodes, fullRect, twoWindows, { snapshot: { modalBlocked: true } });
assert.deepEqual(await executeQtNativePage(modal.client, { hwnd: 42 }, 5000, undefined, profile), dialogOpen);
assert.deepEqual(modal.operations, ["window_inventory", "accessibility_snapshot"]);
const disabled = makeClient(full.nodes, fullRect, twoWindows, { snapshot: { windowEnabled: false } });
assert.deepEqual(await executeQtNativePage(disabled.client, { hwnd: 42 }, 5000, undefined, profile), dialogOpen);
const truncated = makeClient(full.nodes, fullRect, twoWindows, { snapshot: { stats: { ...stats, n: full.nodes.length, truncated: true } } });
assert.deepEqual(await executeQtNativePage(truncated.client, { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt",
  kind: "native-incomplete", error: "Der native Seitenbaum ueberschreitet die Lesegrenze; keine unvollstaendige Seite ausgegeben." });
assert.deepEqual(truncated.operations, ["window_inventory", "accessibility_snapshot"]);
const deep = makeClient(full.nodes, fullRect, twoWindows, { snapshot: { stats: { ...stats, n: full.nodes.length, truncated: true, depthLimited: true } } });
assert.deepEqual(await executeQtNativePage(deep.client, { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt",
  kind: "native-incomplete", error: "Der native Seitenbaum ist tiefer als die Lesegrenze von 16 Ebenen; keine unvollstaendige Seite ausgegeben." });
const ownedDeep = makeClient(full.nodes, fullRect, twoWindows, { tool: { stats: { ...stats, n: 2, truncated: true, depthLimited: true } } });
assert.deepEqual(await executeQtNativePage(ownedDeep.client, { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt",
  kind: "native-incomplete", error: "Der native Baum eines Nebenfensters ist tiefer als die Lesegrenze von 16 Ebenen; Seite nicht gelesen." });
const foreignWindow = makeClient(full.nodes, fullRect, twoWindows);
await assert.rejects(executeQtNativePage(foreignWindow.client, { hwnd: 43 }, 5000, undefined, profile), { kind: "stale-window" });
assert.deepEqual(foreignWindow.operations, []);
const noProfile = makeClient(full.nodes, fullRect, twoWindows);
assert.deepEqual(await executeQtNativePage(noProfile.client, { hwnd: 42 }, 5000), { ok: false, backend: "qt", kind: "bad-args",
  error: "page requires a product profile." });
assert.deepEqual(noProfile.operations, []);
const exhausted = makeClient(full.nodes, fullRect, twoWindows);
await assert.rejects(executeQtNativePage(exhausted.client, { hwnd: 42 }, 0, undefined, profile), { kind: "native-timeout" });
assert.deepEqual(exhausted.operations, []);
// --- Fail closed on windows this path cannot describe: an unknown window, a minimized or vanished main window.
const unknownWindow = makeClient(full.nodes, fullRect, [...twoWindows, windowOf(86, "Datei öffnen", { w: 500, h: 400 }, { class: "#32770" })]);
assert.deepEqual(await executeQtNativePage(unknownWindow.client, { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt",
  kind: "dialog-open", error: "Ein nicht katalogisiertes Fenster des gebundenen Prozesses ist offen; Seite nicht gelesen. "
    + "Dialoge mit sse_dialog_list lesen und bewusst beantworten." });
assert.deepEqual(unknownWindow.operations, ["window_inventory"]);
// A catalogued nonmodal window stays known whatever its size, exactly like the worker's closable-window policy.
const oversizedTips = makeClient(full.nodes, fullRect, [...twoWindows, windowOf(85, "Steuer-Spar-Tipps", { w: 900, h: 700 })]);
assert.equal((await executeQtNativePage(oversizedTips.client, { hwnd: 42 }, 5000, undefined, profile)).ok, true);
// Untitled and shadow windows count for the worker's "more than two windows" rule but never appear in the list.
const untitledWindow = { hwnd: 90, pid: 99, class: "Qt692QWindow", x: 10, y: 10, w: 300, h: 200, minimized: false, hung: false };
const shadowed = makeClient(full.nodes, fullRect, twoWindows,
  { inventory: { ok: true, windows: twoWindows, visibleWindowCount: 3, productWindowCount: 3, untitledWindows: [] } });
const withShadow = await executeQtNativePage(shadowed.client, { hwnd: 42 }, 5000, undefined, profile);
assert.equal(withShadow.offeneFenster, 3);
assert.equal(withShadow.blockiert, true);
const undercounted = makeClient(full.nodes, fullRect, twoWindows,
  { inventory: { ok: true, windows: twoWindows, visibleWindowCount: 2, productWindowCount: 2, untitledWindows: [untitledWindow] } });
await assert.rejects(executeQtNativePage(undercounted.client, { hwnd: 42 }, 5000, undefined, profile), { kind: "native-contract" });
const underProduct = makeClient(full.nodes, fullRect, twoWindows,
  { inventory: { ok: true, windows: twoWindows, visibleWindowCount: 2, productWindowCount: 1, untitledWindows: [] } });
await assert.rejects(executeQtNativePage(underProduct.client, { hwnd: 42 }, 5000, undefined, profile), { kind: "native-contract" });
// Get-Windows 'SSE' spans every product process: a second instance raises the count and blocks the page like the
// worker, while only the bound process's windows are listed, classified or read.
const otherInstance = makeClient(full.nodes, fullRect, [twoWindows[0]],
  { inventory: { ok: true, windows: [twoWindows[0]], visibleWindowCount: 1, productWindowCount: 3, untitledWindows: [] } });
const withOtherInstance = await executeQtNativePage(otherInstance.client, { hwnd: 42 }, 5000, undefined, profile);
assert.equal(withOtherInstance.offeneFenster, 3);
assert.equal(withOtherInstance.blockiert, true);
assert.deepEqual(withOtherInstance.ausgeschlosseneFenster, page.ausgeschlosseneFenster.slice(0, 1));
assert.deepEqual(otherInstance.operations, ["window_inventory", "accessibility_snapshot"]);
// An untitled window that is no tooltip, shadow or popup can be a dialog the inventory cannot name.
const untitled = makeClient(full.nodes, fullRect, twoWindows,
  { inventory: { ok: true, windows: twoWindows, visibleWindowCount: 3, productWindowCount: 3, untitledWindows: [untitledWindow] } });
assert.equal((await executeQtNativePage(untitled.client, { hwnd: 42 }, 5000, undefined, profile)).kind, "dialog-open");
assert.deepEqual(untitled.operations, ["window_inventory"]);
// A null or scalar catalogue entry is skipped like the worker's [string]$definition.role of $null.
const brokenCatalogue = { ...profile, pageObjectsCatalog: { ...profile.pageObjectsCatalog,
  windows: { broken: null, scalar: "x", ...profile.pageObjectsCatalog.windows } } };
assert.equal((await executeQtNativePage(makeClient(full.nodes, fullRect, [...twoWindows, windowOf(87, "BelegManager", { w: 1800, h: 1200 })]).client,
  { hwnd: 42 }, 5000, undefined, brokenCatalogue)).ok, true);
// ConvertTo-Json -Compress escapes the HTML characters, the apostrophe, NEL and both Unicode line separators.
assert.equal(powershellCompactJson({ a: "x\u0085y\u2028z\u2029<&>'" }), '{"a":"x\\u0085y\\u2028z\\u2029\\u003c\\u0026\\u003e\\u0027"}');
// The worker's closable-window policy is case-sensitive on the catalogued title.
const caseVariant = makeClient(full.nodes, fullRect, [...twoWindows, windowOf(88, "belegmanager", { w: 1800, h: 1200 })]);
assert.equal((await executeQtNativePage(caseVariant.client, { hwnd: 42 }, 5000, undefined, profile)).kind, "dialog-open");
// --- Boundary constants copied from the worker: caption band, row band, toolbar band and checker name length.
const edge = treeBuilder();
edge.node("Tree", "Navigation", 0, 60, { w: 200, h: 600 });
edge.node("Button", "Eingabehilfe", 800, 200);
edge.node("Text", "Genau 14", 300, 86);
edge.node("Edit", "", 400, 100, { val: "a", ro: false, aid: "window.RedThreadContent.Genau.Text" });
edge.node("Text", "Genau 15", 300, 145);
edge.node("Edit", "", 400, 160, { val: "b", ro: false, aid: "window.RedThreadContent.Knapp.Text" });
edge.node("DataItem", "r1", 220, 300);
edge.node("DataItem", "r1b", 300, 310);
edge.node("DataItem", "r2", 220, 321);
edge.node("Button", "Leiste", 400, 159);
edge.node("Button", "Inhalt", 400, 160);
edge.node("TreeItem", "y".repeat(89), 820, 400);
edge.node("TreeItem", "z".repeat(90), 820, 420);
const edges = await executeQtNativePage(makeClient(edge.nodes, fullRect, [twoWindows[0]]).client, { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(edges.felder.map(field => field.label), ["Genau 14", ""]);
assert.deepEqual(edges.tabelle.zeilen, ["r1", "r1b", "r2"]);
assert.equal(edges.tabelle.sichtbareZeilen, 2);
assert.deepEqual(edges.aktionen.map(action => [action.name, action.bereich]),
  [["Leiste", "werkzeugleiste"], ["Inhalt", "seite"], ["Eingabehilfe", "hilfespalte"]]);
assert.deepEqual(edges.prueferMeldungen, ["y".repeat(89)]);
const catalogued = makeClient(full.nodes, fullRect, [...twoWindows, windowOf(87, "BelegManager", { w: 1800, h: 1200 })]);
const withManager = await executeQtNativePage(catalogued.client, { hwnd: 42 }, 5000, undefined, profile);
assert.equal(withManager.ok, true);
assert.equal(withManager.offeneFenster, 3);
assert.equal(withManager.blockiert, true);
const minimized = makeClient(full.nodes, fullRect, [windowOf(42, "SteuerSparErklärung 2025", undefined, { minimized: true }), twoWindows[1]]);
assert.deepEqual(await executeQtNativePage(minimized.client, { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt",
  kind: "minimized", error: "Das gebundene SSE-Hauptfenster ist minimiert; der direkte Qt-Pfad stellt es nicht wieder her." });
assert.deepEqual(minimized.operations, ["window_inventory"]);
const vanished = makeClient(full.nodes, fullRect, [twoWindows[1]]);
assert.deepEqual(await executeQtNativePage(vanished.client, { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt",
  kind: "stale-window", error: "Das angegebene hwnd ist kein aktuelles Hauptfenster." });
const otherProcess = makeClient(full.nodes, fullRect, [{ ...twoWindows[0], pid: 98 }]);
await assert.rejects(executeQtNativePage(otherProcess.client, { hwnd: 42 }, 5000, undefined, profile), { kind: "native-contract" });
const inventoryFailed = makeClient(full.nodes, fullRect, twoWindows, { inventory: { ok: false, error: "Synthetic inventory failure.", code: "native-read" } });
await assert.rejects(executeQtNativePage(inventoryFailed.client, { hwnd: 42 }, 5000, undefined, profile),
  { kind: "native-read", message: "Synthetic inventory failure." });
const inventoryInvalid = makeClient(full.nodes, fullRect, twoWindows,
  { inventory: { ok: true, windows: [{ hwnd: 42, title: "Ohne Prozess" }], visibleWindowCount: 1, productWindowCount: 1, untitledWindows: [] } });
await assert.rejects(executeQtNativePage(inventoryInvalid.client, { hwnd: 42 }, 5000, undefined, profile), { kind: "native-contract" });
const snapshotFailed = makeClient(full.nodes, fullRect, twoWindows, { snapshot: { ok: false, error: "Synthetic snapshot failure.", code: "native-read" } });
await assert.rejects(executeQtNativePage(snapshotFailed.client, { hwnd: 42 }, 5000, undefined, profile),
  { kind: "native-read", message: "Synthetic snapshot failure." });

console.log("qt-native-page-projection: 9 projections and 25 fail-closed guards pinned");
