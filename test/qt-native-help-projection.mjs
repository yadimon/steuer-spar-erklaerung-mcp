import assert from "node:assert/strict";
import { executeQtNativeHelp, qtNativeHelpProjection } from "../dist/qt-native-help.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";

const profile = loadProductProfile("2025");

// Synthetic page: navigation tree on the left (0..200), content in the middle,
// help column on the right of the 'Eingabehilfe' heading (maxX = 800 - 10 = 790).
const nodes = [];
const node = (type, name, x, y, extra = {}) => {
  const i = nodes.length;
  nodes.push({ i, p: -1, d: 0, type, name, aid: `fixture.${i}`, rid: `42.42.4.${i + 1}`,
    x, y, w: 80, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
  return i;
};
node("Tree", "Navigation", 0, 0, { w: 200 });
node("Text", "Später im Inhalt", 300, 40);
node("Text", "Seitenueberschrift", 250, 10);
node("Edit", "", 400, 10, { val: "12,00", ro: false });
node("Button", "Allgemeiner Hinweis", 820, 5);
node("Text", "Zweite Zeile", 900, 5);
node("Text", "Erste Zeile", 810, 5);
node("Text", "Mehr Details", 820, 8);
node("Text", "", 850, 9);
node("Text", "Eingabehilfe", 800, 20);
node("Text", "Verlinkte Zeile", 820, 30);
node("Hyperlink", "Verlinkte Zeile", 820, 32);
node("Text", "verlinkte zeile", 820, 34);
node("Edit", "Nur Eingabe", 820, 36, { val: "x", ro: true });
node("Text", "Details", 820, 38);
node("Group", "Gruppe", 820, 39);
node("TreeItem", "Punkt A", 820, 40);
node("Button", "Weiterlesen", 820, 42);
node("Text", "Verlinkte Zeile", 820, 44);
node("Text", "steuertipps", 800, 50);
node("Text", "PRÜFER", 800, 60);
node("Hyperlink", "Pruefer-Link", 820, 62);
node("Text", "Steuer-Spar-Tipps", 800, 70);
node("Text", "prüfer", 800, 80);
node("Text", "Spaeter Prueferhinweis", 820, 82);
node("Text", "Eingabehilfe", 800, 90);
node("Text", "Nachtrag", 820, 92);
node("Text", "Nachtrag", 820, 92);
node("Text", "Ganz unten", 100, 400);
node("Edit", "Betrag", 400, 4, { val: "12,00", ro: false });
const rect = { x: 0, y: 0, w: 1000, h: 500 };
const stats = { n: nodes.length, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
  valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 };

const expectedSections = {
  Allgemein: {
    text: "Erste Zeile Allgemeiner Hinweis Zweite Zeile",
    zeilen: ["Erste Zeile", "Allgemeiner Hinweis", "Zweite Zeile"],
    verweise: [],
  },
  Eingabehilfe: {
    // Only an immediate repeat collapses; the later "Verlinkte Zeile" is a second statement.
    text: "Verlinkte Zeile verlinkte zeile Punkt A Weiterlesen Verlinkte Zeile Nachtrag",
    zeilen: ["Verlinkte Zeile", "verlinkte zeile", "Punkt A", "Weiterlesen", "Verlinkte Zeile", "Nachtrag"],
    verweise: ["Verlinkte Zeile"],
  },
  steuertipps: { text: "", zeilen: [], verweise: [] },
  "PRÜFER": {
    text: "Pruefer-Link Spaeter Prueferhinweis",
    zeilen: ["Pruefer-Link", "Spaeter Prueferhinweis"],
    verweise: ["Pruefer-Link"],
  },
  "Steuer-Spar-Tipps": { text: "", zeilen: [], verweise: [] },
};

const requests = [];
const windowOf = (hwnd, title, geometry, extra = {}) => ({ hwnd, pid: 99, class: "Qt692QWindowIcon", title,
  x: geometry[0], y: geometry[1], w: geometry[2], h: geometry[3], minimized: false, hung: false, ...extra });
const MAIN_WINDOW = windowOf(42, "SteuerSparErklärung 2025", [0, 0, 1000, 500]);
const TIPS_WINDOW = windowOf(85, "Steuer-Spar-Tipps", [810, 100, 180, 120]);
const SECOND_CASE = windowOf(91, "SteuerSparErklärung 2025 - zweiter Fall", [0, 0, 950, 500]);
const tipsNodes = [
  { i: 0, p: -1, d: 0, type: "Text", name: "Fahrtenbuch führen", aid: "tips.Text", rid: "42.85.4.1", x: 820, y: 110, w: 80, h: 20,
    on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
  { i: 1, p: -1, d: 0, type: "Hyperlink", name: "Mehr dazu", aid: "tips.Link", rid: "42.85.4.2", x: 820, y: 120, w: 80, h: 20,
    on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
];
const tipsStats = { ...stats, n: tipsNodes.length };
const snapshotReply = (spec, extra = {}) => ({ ok: true, controllerBound: true, scope: "qt-accessibility-content", exactMatches: {},
  windowEnabled: true, modalBlocked: false, ...spec, ...extra });
const mainReply = extra => snapshotReply({ hwnd: 42, windowRect: rect, nodes, stats }, extra);
const tipsReply = extra => snapshotReply({ hwnd: 85, windowRect: { x: 810, y: 100, w: 180, h: 120 }, nodes: tipsNodes, stats: tipsStats }, extra);
const inventoryReply = (windows, extra = {}) => ({ ok: true, windows, untitledWindows: [], visibleWindowCount: windows.length, ...extra });
// Each scenario names its replies: the fake only looks them up by request shape, it decides nothing.
const makeClient = (replies) => ({
  binding: { hwnd: 42, pid: 99, creationTime: "1" },
  request: async (operation, args) => {
    requests.push({ operation, args });
    const key = `${operation}:${args.toolTitle ?? ""}`;
    const durations = { "window_inventory:": 1, "accessibility_snapshot:": 7, "accessibility_snapshot:Steuer-Spar-Tipps": 2,
      "accessibility_snapshot:Werte-Info: Werte vergleichen - Was wäre wenn": 3 };
    return { durationMs: durations[key], result: replies[key] };
  },
});
// A system overlay is never read and a tips window of another process is not this window's; neither costs a snapshot.
const OVERLAY_WINDOW = windowOf(86, "UAC", [0, 0, 40, 40], { class: "UAC_Overlay" });
const FOREIGN_TIPS = windowOf(92, "Steuer-Spar-Tipps", [810, 100, 180, 120], { pid: 7 });
const plain = extra => ({ "window_inventory:": inventoryReply([MAIN_WINDOW, OVERLAY_WINDOW, FOREIGN_TIPS]), "accessibility_snapshot:": mainReply(extra) });
const withTipsWindow = (mainExtra = {}, tipsExtra = {}) => ({
  "window_inventory:": inventoryReply([MAIN_WINDOW, TIPS_WINDOW]),
  "accessibility_snapshot:": mainReply(mainExtra),
  "accessibility_snapshot:Steuer-Spar-Tipps": tipsReply(tipsExtra),
});

// Happy path: the full worker contract is pinned, including section key order and spelling.
const result = await executeQtNativeHelp(makeClient(plain()), { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(result, {
  ok: true,
  seite: "Seitenueberschrift",
  abschnitte: expectedSections,
  hinweis: "Die Hilfe wechselt mit dem angewaehlten Feld. Fuer feldbezogene Hilfe erst das Feld anwaehlen.",
  backend: "qt",
  nativeDurationMs: 8,
});
assert.deepEqual(Object.keys(result.abschnitte), ["Allgemein", "Eingabehilfe", "steuertipps", "PRÜFER", "Steuer-Spar-Tipps"]);
assert.deepEqual(requests, [{ operation: "window_inventory", args: {} }, { operation: "accessibility_snapshot", args: { maxNodes: 5000 } }]);

// An open Steuer-Spar-Tipps window hangs under the main window in the worker's tree: its title node opens the
// section and its lines follow, exactly as UIA would list the owned window.
requests.length = 0;
const withTips = await executeQtNativeHelp(makeClient(withTipsWindow()), { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(withTips.abschnitte, { ...expectedSections,
  "Steuer-Spar-Tipps": { text: "Fahrtenbuch führen Mehr dazu", zeilen: ["Fahrtenbuch führen", "Mehr dazu"], verweise: ["Mehr dazu"] } });
assert.equal(withTips.nativeDurationMs, 10);
assert.deepEqual(requests.map(entry => entry.args), [{}, { maxNodes: 5000 }, { maxNodes: 5000, toolTitle: "Steuer-Spar-Tipps" }]);
// A Werte-Info window is owned as well: the worker's tree lists its window node and its cells in the help column,
// so its text right of the content edge continues the last section exactly like the tips lines do, while the
// Window and DataItem entries are no text types and stay out of the lines.
requests.length = 0;
const WERTE_INFO_WINDOW = windowOf(84, "Werte-Info: Werte vergleichen - Was wäre wenn", [810, 150, 180, 120]);
const werteInfoNodes = [{ ...tipsNodes[0], name: "Aktuell", rid: "42.84.4.1", y: 160 },
  { ...tipsNodes[0], i: 1, type: "DataItem", name: "1.000,00", rid: "42.84.4.2", y: 170 }];
const withWerteInfo = await executeQtNativeHelp(makeClient({
  "window_inventory:": inventoryReply([MAIN_WINDOW, WERTE_INFO_WINDOW]),
  "accessibility_snapshot:": mainReply(),
  "accessibility_snapshot:Werte-Info: Werte vergleichen - Was wäre wenn": snapshotReply({ hwnd: 84, windowRect: { x: 810, y: 150, w: 180, h: 120 },
    nodes: werteInfoNodes, stats: { ...stats, n: werteInfoNodes.length } }),
}), { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(withWerteInfo.abschnitte, { ...expectedSections,
  Eingabehilfe: { text: "Verlinkte Zeile verlinkte zeile Punkt A Weiterlesen Verlinkte Zeile Nachtrag Aktuell",
    zeilen: [...expectedSections.Eingabehilfe.zeilen, "Aktuell"], verweise: ["Verlinkte Zeile"] } });
assert.deepEqual(requests.map(entry => entry.args), [{}, { maxNodes: 5000 }, { maxNodes: 5000, toolTitle: "Werte-Info: Werte vergleichen - Was wäre wenn" }]);
// A second case window of the process is not owned by this one: it is tolerated and never merged.
requests.length = 0;
const secondCase = await executeQtNativeHelp(makeClient({ "window_inventory:": inventoryReply([MAIN_WINDOW, SECOND_CASE]),
  "accessibility_snapshot:": mainReply() }), { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(secondCase.abschnitte, expectedSections);
assert.deepEqual(requests.map(entry => entry.operation), ["window_inventory", "accessibility_snapshot"]);
// Owned windows this path cannot describe fail closed before any tree is read.
requests.length = 0;
const foreignDialog = windowOf(86, "Datei öffnen", [10, 10, 500, 400], { class: "#32770" });
assert.deepEqual(await executeQtNativeHelp(makeClient({ "window_inventory:": inventoryReply([MAIN_WINDOW, foreignDialog]) }),
  { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt", kind: "dialog-open",
  error: "Ein nicht katalogisiertes Fenster des gebundenen Prozesses ist offen; Hilfe nicht gelesen. "
    + "Dialoge mit sse_dialog_list lesen und bewusst beantworten." });
assert.deepEqual(requests.map(entry => entry.operation), ["window_inventory"]);
const untitled = { hwnd: 90, pid: 99, class: "Qt692QWindow", x: 50, y: 50, w: 300, h: 200, minimized: false, hung: false };
assert.equal((await executeQtNativeHelp(makeClient({ "window_inventory:": inventoryReply([MAIN_WINDOW],
  { untitledWindows: [untitled], visibleWindowCount: 2 }) }), { hwnd: 42 }, 5000, undefined, profile)).kind, "dialog-open");
assert.deepEqual(await executeQtNativeHelp(makeClient({ "window_inventory:": inventoryReply([{ ...MAIN_WINDOW, minimized: true }]) }),
  { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "minimized", error: "Das gebundene SSE-Hauptfenster ist minimiert; der direkte Qt-Pfad stellt es nicht wieder her." });
assert.deepEqual(await executeQtNativeHelp(makeClient({ "window_inventory:": inventoryReply([TIPS_WINDOW]) }), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "stale-window", error: "Das angegebene hwnd ist kein aktuelles Hauptfenster." });
assert.deepEqual(await executeQtNativeHelp(makeClient(withTipsWindow({}, { stats: { ...tipsStats, truncated: true } })),
  { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt", kind: "native-incomplete",
  error: "Der native Baum eines Nebenfensters ueberschreitet die Lesegrenze; Hilfe nicht gelesen." });
const ownedBlocked = { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert ein Nebenfenster der gebundenen Seite; Hilfe nicht gelesen." };
assert.deepEqual(await executeQtNativeHelp(makeClient(withTipsWindow({}, { modalBlocked: true })), { hwnd: 42 }, 5000, undefined, profile), ownedBlocked);
assert.deepEqual(await executeQtNativeHelp(makeClient(withTipsWindow({}, { windowEnabled: false })), { hwnd: 42 }, 5000, undefined, profile), ownedBlocked);
assert.deepEqual(await executeQtNativeHelp(makeClient(plain({ nodes: [], stats: { ...stats, n: 0 } })), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "native-incomplete", error: "Der native Seitenbaum ist leer; keine Hilfe ausgegeben." });
await assert.rejects(executeQtNativeHelp(makeClient(withTipsWindow({}, { hwnd: 86 })), { hwnd: 42 }, 5000, undefined, profile),
  error => error instanceof QtNativeTransportError && error.kind === "native-contract");
assert.deepEqual(await executeQtNativeHelp(makeClient(plain()), { hwnd: 42 }, 5000), { ok: false, backend: "qt", kind: "bad-args",
  error: "help requires a product profile." });

// Pure projection: no heading in the content column yields null, an empty column yields no sections.
assert.deepEqual(qtNativeHelpProjection([], rect), { seite: null, abschnitte: {} });
const emptyHeading = [nodes[0], { ...nodes[1], name: "" }, { ...nodes[2], name: "" }, ...nodes.slice(3)];
assert.equal(qtNativeHelpProjection(emptyHeading, rect).seite, "");

// Without a help heading the right border falls back to 79 % of the window width (790 here as well).
const noHeadings = nodes.filter(entry => !["Eingabehilfe", "steuertipps"].includes(entry.name));
assert.deepEqual(Object.keys(qtNativeHelpProjection(noHeadings, rect).abschnitte), ["Allgemein", "PRÜFER", "Steuer-Spar-Tipps"]);

// Fail closed: modal dialog, disabled window, truncated tree.
assert.deepEqual(await executeQtNativeHelp(makeClient(plain({ modalBlocked: true })), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert die gebundene Seite; keine Hilfe ausgegeben." });
assert.deepEqual(await executeQtNativeHelp(makeClient(plain({ windowEnabled: false })), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert die gebundene Seite; keine Hilfe ausgegeben." });
assert.deepEqual(await executeQtNativeHelp(makeClient(plain({ stats: { ...stats, truncated: true } })), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "native-incomplete",
    error: "Der native Seitenbaum ueberschreitet die Lesegrenze; keine unvollstaendige Hilfe ausgegeben." });
assert.deepEqual(await executeQtNativeHelp(makeClient(plain({ stats: { ...stats, truncated: true, depthLimited: true } })), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "native-incomplete",
    error: "Der native Seitenbaum ist tiefer als die Lesegrenze von 16 Ebenen; keine unvollstaendige Hilfe ausgegeben." });

// Transport failures: foreign hwnd never reaches the bridge; a snapshot of another window is a contract breach.
const before = requests.length;
await assert.rejects(executeQtNativeHelp(makeClient(plain()), { hwnd: 43 }, 5000, undefined, profile),
  error => error instanceof QtNativeTransportError && error.kind === "stale-window");
assert.equal(requests.length, before);
await assert.rejects(executeQtNativeHelp(makeClient(plain({ hwnd: 84 })), { hwnd: 42 }, 5000, undefined, profile),
  error => error instanceof QtNativeTransportError && error.kind === "native-contract");

console.log("qt-native-help-projection: happy path, owned tips and Werte-Info windows, second case window, projection edge cases, 12 fail-closed and 3 transport cases ok");
