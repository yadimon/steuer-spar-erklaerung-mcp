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
    text: "Verlinkte Zeile verlinkte zeile Punkt A Weiterlesen Nachtrag",
    zeilen: ["Verlinkte Zeile", "verlinkte zeile", "Punkt A", "Weiterlesen", "Nachtrag"],
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
const tipsNodes = [
  { i: 0, p: -1, d: 0, type: "Text", name: "Fahrtenbuch führen", aid: "tips.Text", rid: "42.85.4.1", x: 820, y: 110, w: 80, h: 20,
    on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
  { i: 1, p: -1, d: 0, type: "Hyperlink", name: "Mehr dazu", aid: "tips.Link", rid: "42.85.4.2", x: 820, y: 120, w: 80, h: 20,
    on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
];
const makeClient = (overrides = {}, windows = [MAIN_WINDOW], inventoryExtra = {}) => ({
  binding: { hwnd: 42, pid: 99, creationTime: "1" },
  request: async (operation, args) => {
    requests.push({ operation, args });
    const answers = {
      window_inventory: () => ({ durationMs: 1, result: { ok: true, windows, untitledWindows: [], visibleWindowCount: windows.length, ...inventoryExtra } }),
      accessibility_snapshot: () => args.toolTitle === undefined
        ? { durationMs: 7, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
          hwnd: 42, windowRect: rect, windowEnabled: true, modalBlocked: false, exactMatches: {}, nodes, stats, ...overrides } }
        : { durationMs: 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
          hwnd: overrides.toolHwnd ?? 85, windowRect: { x: 810, y: 100, w: 180, h: 120 }, windowEnabled: true, modalBlocked: false,
          exactMatches: {}, nodes: tipsNodes, stats: { ...stats, n: tipsNodes.length, truncated: overrides.toolTruncated === true } } },
    };
    return answers[operation]();
  },
});

// Happy path: the full worker contract is pinned, including section key order and spelling.
const result = await executeQtNativeHelp(makeClient(), { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(result, {
  ok: true,
  seite: "Seitenueberschrift",
  abschnitte: expectedSections,
  hinweis: "Die Hilfe wechselt mit dem angewaehlten Feld. Fuer feldbezogene Hilfe erst das Feld anwaehlen.",
  backend: "qt",
  nativeDurationMs: 8,
});
assert.deepEqual(Object.keys(result.abschnitte), ["Allgemein", "Eingabehilfe", "steuertipps", "PRÜFER", "Steuer-Spar-Tipps"]);
assert.deepEqual(requests, [{ operation: "window_inventory", args: {} }, { operation: "accessibility_snapshot", args: { maxNodes: 4000 } }]);

// An open Steuer-Spar-Tipps window hangs under the main window in the worker's tree: its title node opens the
// section and its lines follow, exactly as UIA would list the owned window.
requests.length = 0;
const withTips = await executeQtNativeHelp(makeClient({}, [MAIN_WINDOW, TIPS_WINDOW]), { hwnd: 42 }, 5000, undefined, profile);
assert.deepEqual(withTips.abschnitte, { ...expectedSections,
  "Steuer-Spar-Tipps": { text: "Fahrtenbuch führen Mehr dazu", zeilen: ["Fahrtenbuch führen", "Mehr dazu"], verweise: ["Mehr dazu"] } });
assert.equal(withTips.nativeDurationMs, 10);
assert.deepEqual(requests.map(entry => entry.args), [{}, { maxNodes: 4000 }, { maxNodes: 4000, toolTitle: "Steuer-Spar-Tipps" }]);
// Owned windows this path cannot describe fail closed before any tree is read.
requests.length = 0;
assert.deepEqual(await executeQtNativeHelp(makeClient({}, [MAIN_WINDOW, windowOf(86, "Datei öffnen", [10, 10, 500, 400], { class: "#32770" })]),
  { hwnd: 42 }, 5000, undefined, profile), { ok: false, backend: "qt", kind: "dialog-open",
  error: "Ein nicht katalogisiertes Fenster des gebundenen Prozesses ist offen; Hilfe nicht gelesen. "
    + "Dialoge mit sse_dialog_list lesen und bewusst beantworten." });
assert.deepEqual(requests.map(entry => entry.operation), ["window_inventory"]);
const untitled = { hwnd: 90, pid: 99, class: "Qt692QWindow", x: 50, y: 50, w: 300, h: 200, minimized: false, hung: false };
assert.equal((await executeQtNativeHelp(makeClient({}, [MAIN_WINDOW], { untitledWindows: [untitled], visibleWindowCount: 2 }),
  { hwnd: 42 }, 5000, undefined, profile)).kind, "dialog-open");
assert.deepEqual(await executeQtNativeHelp(makeClient({}, [{ ...MAIN_WINDOW, minimized: true }]), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "minimized", error: "Das gebundene SSE-Hauptfenster ist minimiert; der direkte Qt-Pfad stellt es nicht wieder her." });
assert.deepEqual(await executeQtNativeHelp(makeClient({}, [TIPS_WINDOW]), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "stale-window", error: "Das angegebene hwnd ist kein aktuelles Hauptfenster." });
assert.deepEqual(await executeQtNativeHelp(makeClient({ toolTruncated: true }, [MAIN_WINDOW, TIPS_WINDOW]), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "native-incomplete",
    error: "Der native Baum eines Nebenfensters ueberschreitet die Lesegrenze; keine unvollstaendige Hilfe ausgegeben." });
await assert.rejects(executeQtNativeHelp(makeClient({ toolHwnd: 86 }, [MAIN_WINDOW, TIPS_WINDOW]), { hwnd: 42 }, 5000, undefined, profile),
  error => error instanceof QtNativeTransportError && error.kind === "native-contract");
assert.deepEqual(await executeQtNativeHelp(makeClient(), { hwnd: 42 }, 5000), { ok: false, backend: "qt", kind: "bad-args",
  error: "help requires a product profile." });

// Pure projection: no heading in the content column yields null, an empty column yields no sections.
assert.deepEqual(qtNativeHelpProjection([], rect), { seite: null, abschnitte: {} });
const emptyHeading = nodes.map(entry => ({ ...entry, name: entry.type === "Text" && entry.x >= 205 && entry.x <= 790 ? "" : entry.name }));
assert.equal(qtNativeHelpProjection(emptyHeading, rect).seite, "");

// Without a help heading the right border falls back to 79 % of the window width (790 here as well).
const noHeadings = nodes.filter(entry => !["Eingabehilfe", "steuertipps"].includes(entry.name));
assert.deepEqual(Object.keys(qtNativeHelpProjection(noHeadings, rect).abschnitte), ["Allgemein", "PRÜFER", "Steuer-Spar-Tipps"]);

// Fail closed: modal dialog, disabled window, truncated tree.
assert.deepEqual(await executeQtNativeHelp(makeClient({ modalBlocked: true }), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert die gebundene Seite; keine Hilfe ausgegeben." });
assert.deepEqual(await executeQtNativeHelp(makeClient({ windowEnabled: false }), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert die gebundene Seite; keine Hilfe ausgegeben." });
assert.deepEqual(await executeQtNativeHelp(makeClient({ stats: { ...stats, truncated: true } }), { hwnd: 42 }, 5000, undefined, profile),
  { ok: false, backend: "qt", kind: "native-incomplete",
    error: "Der native Seitenbaum ueberschreitet die Lesegrenze; keine unvollstaendige Hilfe ausgegeben." });

// Transport failures: foreign hwnd never reaches the bridge; a snapshot of another window is a contract breach.
const before = requests.length;
await assert.rejects(executeQtNativeHelp(makeClient(), { hwnd: 43 }, 5000, undefined, profile),
  error => error instanceof QtNativeTransportError && error.kind === "stale-window");
assert.equal(requests.length, before);
await assert.rejects(executeQtNativeHelp(makeClient({ hwnd: 84 }), { hwnd: 42 }, 5000, undefined, profile),
  error => error instanceof QtNativeTransportError && error.kind === "native-contract");

console.log("qt-native-help-projection: happy path, owned tips window, projection edge cases, 8 fail-closed and 3 transport cases ok");
