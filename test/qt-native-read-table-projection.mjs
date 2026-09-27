import assert from "node:assert/strict";
import {
  executeQtNativeReadTable, qtNativeTableCellSemantic, qtNativeTableProjection, qtNativeTableRowDetails,
} from "../dist/qt-native-read-table.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";

const profile = loadProductProfile("2025");

// Synthetic Qt item view: three header columns (x = 100, 300, 500), a duplicated
// header 6 px to the right of the first one, and rows that exercise every
// worker rule: X-based column assignment, the 10 px row band (a cell exactly
// 10 px below the row anchor stays in the row, 11 px opens the next one), a tie
// between two headers, a later cell overwriting an earlier one, unpositioned
// cells and the subtree of a foreign window carrying its own table.
const nodes = [];
const node = (type, name, x, y, extra = {}) => {
  const i = nodes.length;
  nodes.push({ i, p: -1, d: 0, type, name, aid: `fixture.${i}`, rid: `42.42.4.${i + 1}`,
    x, y, w: 80, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
  return i;
};
node("Text", "Seitenueberschrift", 100, 0);
node("Header", "Betrag", 300, 20);
node("Header", "Bezeichnung", 106, 20);
node("Header", "Bezeichnung", 100, 20);
node("Header", "Erledigt", 500, 20);
node("Header", "Unsichtbar", 700, 20, { w: 0 });
node("Header", "", 900, 20);
node("DataItem", "12,00", 305, 50);
node("DataItem", "Miete", 102, 50);
node("DataItem", "", 502, 52, { checked: true });
node("DataItem", "Nein", 300, 75, { checked: false });
node("DataItem", "Strom", 100, 75);
node("DataItem", "Mitte", 200, 100);
node("DataItem", "", 500, 108, { checked: "unbestimmt" });
node("DataItem", "Ueberschrieben", 101, 109);
node("DataItem", "Genau zehn", 300, 110);
node("DataItem", "Neue Zeile", 100, 111);
node("DataItem", "Ohne Ausdehnung", 300, 111, { w: 0 });
const foreign = node("Window", "Werte-Info", 600, 300, { aid: "fixture.WerteInfo", w: 400, h: 200 });
node("Header", "Fremd", 610, 320, { p: foreign, d: 1 });
node("DataItem", "Fremde Zelle", 610, 340, { p: foreign, d: 1 });
node("Button", "Weiter", 100, 400);
const rect = { x: 0, y: 0, w: 1000, h: 500 };
const stats = { n: nodes.length, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
  valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 };

// Process windows: the bound main window, the owned Werte-Info read through its title, a system overlay
// that is never read and a Werte-Info of another process that is not this window's.
const WERTE_INFO = "Werte-Info: Werte vergleichen - Was wäre wenn";
const windowOf = (hwnd, title, geometry, extra = {}) => ({ hwnd, pid: 99, class: "Qt692QWindow", title,
  x: geometry[0], y: geometry[1], w: geometry[2], h: geometry[3], minimized: false, hung: false, ...extra });
const MAIN_WINDOW = windowOf(42, "SteuerSparErklärung 2025", [0, 0, 1000, 500], { class: "Qt692QWindowIcon" });
const WERTE_INFO_WINDOW = windowOf(84, WERTE_INFO, [600, 300, 400, 200]);
const OVERLAY_WINDOW = windowOf(86, "UAC", [0, 0, 40, 40], { class: "UAC_Overlay" });
const FOREIGN_WERTE_INFO = windowOf(92, WERTE_INFO, [600, 300, 400, 200], { pid: 7 });
const werteInfoNodes = [
  { i: 0, p: -1, d: 0, type: "Table", name: "", aid: "tool.obj_Wertetabelle", rid: "42.84.4.1", x: 610, y: 340, w: 380, h: 100,
    on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
  { i: 1, p: 0, d: 1, type: "Header", name: "Aktuell", aid: "tool.obj_Wertetabelle", rid: "42.84.4.2", x: 700, y: 350, w: 90, h: 20,
    on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
  { i: 2, p: 0, d: 1, type: "DataItem", name: "1.000,00", aid: "tool.obj_Wertetabelle", rid: "42.84.4.3", x: 700, y: 380, w: 90, h: 20,
    on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
];
const werteInfoStats = { ...stats, n: werteInfoNodes.length };
const werteInfoRect = { x: 600, y: 300, w: 400, h: 200 };

const requests = [];
const makeClient = ({ windows = [MAIN_WINDOW], inventory = {}, snapshot = {}, tool = {} } = {}) => ({
  binding: { hwnd: 42, pid: 99, creationTime: "1" },
  request: async (operation, args) => {
    requests.push({ operation, args });
    if (operation === "window_inventory") {
      const reply = { ok: true, windows, untitledWindows: [], visibleWindowCount: windows.length, ...inventory };
      return { durationMs: 2, result: { ...reply, productWindowCount: inventory.productWindowCount ?? reply.visibleWindowCount } };
    }
    assert.equal(operation, "accessibility_snapshot");
    const base = { ok: true, controllerBound: true, scope: "qt-accessibility-content", windowEnabled: true, modalBlocked: false, exactMatches: {} };
    if (args.toolTitle !== undefined) {
      assert.equal(args.toolTitle, WERTE_INFO);
      return { durationMs: 4, result: { ...base, hwnd: 84, windowRect: werteInfoRect, nodes: werteInfoNodes, stats: werteInfoStats, ...tool } };
    }
    return { durationMs: 9, result: { ...base, hwnd: 42, windowRect: rect, nodes, stats, ...snapshot } };
  },
});
const read = (options, args = { hwnd: 42 }, timeoutMs = 5000) => executeQtNativeReadTable(makeClient(options), args, timeoutMs, undefined, profile);

const expectedRowDetails = [
  { rowIndex: 0, typedValues: ["Miete", "12,00", true], checkboxStates: [null, null, "On"], cellTypes: ["text", "text", "boolean"],
    semanticsComplete: true, semanticReadErrors: [] },
  { rowIndex: 1, typedValues: ["Strom", false, null], checkboxStates: [null, "Off", null], cellTypes: ["text", "boolean", "unknown"],
    semanticsComplete: false, semanticReadErrors: [{ column: 2, error: "Zelle nicht beobachtet." }] },
  { rowIndex: 2, typedValues: ["Ueberschrieben", "Genau zehn", null], checkboxStates: [null, null, "Indeterminate"], cellTypes: ["text", "text", "boolean"],
    semanticsComplete: true, semanticReadErrors: [] },
  { rowIndex: 3, typedValues: ["Neue Zeile", null, null], checkboxStates: [null, null, null], cellTypes: ["text", "unknown", "unknown"],
    semanticsComplete: false, semanticReadErrors: [{ column: 1, error: "Zelle nicht beobachtet." }, { column: 2, error: "Zelle nicht beobachtet." }] },
];
const inTreeForeign = { rid: "42.42.4.19", name: "Werte-Info", aid: "fixture.WerteInfo", x: 600, y: 300, w: 400, h: 200, nodeCount: 3 };
const NOTE_VISIBLE = "Nur die SICHTBAREN Zeilen. Qt virtualisiert Tabellen: mehr Zeilen erscheinen erst, wenn der Cursor sie in den Blick holt (Pfeiltaste).";

// Happy path: the full worker contract is pinned, including the '' for unobserved row slots.
const result = await read();
assert.deepEqual(result, {
  ok: true,
  headers: ["Bezeichnung", "Betrag", "Erledigt"],
  rows: [["Miete", "12,00", ""], ["Strom", "Nein", ""], ["Ueberschrieben", "Genau zehn", ""], ["Neue Zeile", "", ""]],
  rowCount: 4,
  rowDetails: expectedRowDetails,
  ausgeschlosseneFenster: [inTreeForeign],
  stats,
  incomplete: false,
  note: NOTE_VISIBLE,
  backend: "qt",
  nativeDurationMs: 11,
});
assert.deepEqual(requests, [{ operation: "window_inventory", args: {} },
  { operation: "accessibility_snapshot", args: { maxNodes: 4000, withCellStates: true } }]);

// An owned Werte-Info hangs under the main window in the worker's UIA tree and is listed, never projected:
// the Qt path reads it through its title and lists the same window facts. Overlays and other processes cost nothing.
requests.length = 0;
const withOwned = await read({ windows: [MAIN_WINDOW, WERTE_INFO_WINDOW, OVERLAY_WINDOW, FOREIGN_WERTE_INFO] });
assert.deepEqual(withOwned.rows, result.rows);
assert.deepEqual(withOwned.ausgeschlosseneFenster, [inTreeForeign,
  { rid: "42.84", name: WERTE_INFO, aid: "", x: 600, y: 300, w: 400, h: 200, nodeCount: 4 }]);
assert.equal(withOwned.nativeDurationMs, 15);
assert.deepEqual(requests.map(entry => entry.args), [{}, { maxNodes: 4000, withCellStates: true }, { maxNodes: 4000, toolTitle: WERTE_INFO }]);

// Without headers every cell is appended behind the worker's single null slot.
const headless = nodes.filter(entry => entry.type !== "Header" && entry.p === -1 && entry.type !== "Window");
assert.deepEqual(qtNativeTableProjection(headless), {
  headers: [],
  rows: [["", "Miete", "12,00", ""], ["", "Strom", "Nein"], ["", "Mitte", "", "Ueberschrieben", "Genau zehn"], ["", "Neue Zeile"]],
  rowCount: 4,
  rowDetails: [
    { rowIndex: 0, typedValues: [null, "Miete", "12,00", true], checkboxStates: [null, null, null, "On"], cellTypes: ["unknown", "text", "text", "boolean"],
      semanticsComplete: false, semanticReadErrors: [{ column: 0, error: "Zelle nicht beobachtet." }] },
    { rowIndex: 1, typedValues: [null, "Strom", false], checkboxStates: [null, null, "Off"], cellTypes: ["unknown", "text", "boolean"],
      semanticsComplete: false, semanticReadErrors: [{ column: 0, error: "Zelle nicht beobachtet." }] },
    { rowIndex: 2, typedValues: [null, "Mitte", null, "Ueberschrieben", "Genau zehn"], checkboxStates: [null, null, "Indeterminate", null, null],
      cellTypes: ["unknown", "text", "boolean", "text", "text"], semanticsComplete: false, semanticReadErrors: [{ column: 0, error: "Zelle nicht beobachtet." }] },
    { rowIndex: 3, typedValues: [null, "Neue Zeile"], checkboxStates: [null, null], cellTypes: ["unknown", "text"],
      semanticsComplete: false, semanticReadErrors: [{ column: 0, error: "Zelle nicht beobachtet." }] },
  ],
});

// Headers exactly 8 px apart merge; 9 px apart stay two columns. Type comparison is case-insensitive like -eq.
const header = (name, x) => ({ i: 0, p: -1, d: 0, type: "header", name, aid: "h", rid: `42.1.4.${x}`, x, y: 0, w: 50, h: 10,
  on: true, val: null, ro: null, checked: null, selected: null, scroll: null });
assert.deepEqual(qtNativeTableProjection([header("A", 100), header("B", 108)]).headers, ["A"]);
assert.deepEqual(qtNativeTableProjection([header("B", 109), header("A", 100)]).headers, ["A", "B"]);
assert.deepEqual(qtNativeTableProjection([]), { headers: [], rows: [], rowCount: 0, rowDetails: [] });

// Cell semantics: text keeps the (possibly empty) name; every checked state maps to the worker's TogglePattern words.
const cell = (name, checked) => ({ ...header(name, 0), type: "DataItem", checked });
assert.deepEqual(qtNativeTableCellSemantic(cell("", null)), { type: "text", value: "", checkboxState: null, ok: true, error: null });
assert.deepEqual(qtNativeTableCellSemantic(cell("x", true)), { type: "boolean", value: true, checkboxState: "On", ok: true, error: null });
assert.deepEqual(qtNativeTableCellSemantic(cell("x", false)), { type: "boolean", value: false, checkboxState: "Off", ok: true, error: null });
assert.deepEqual(qtNativeTableCellSemantic(cell("x", "unbestimmt")), { type: "boolean", value: null, checkboxState: "Indeterminate", ok: true, error: null });
assert.deepEqual(qtNativeTableRowDetails(7, [null]), { rowIndex: 7, typedValues: [null], checkboxStates: [null], cellTypes: ["unknown"],
  semanticsComplete: false, semanticReadErrors: [{ column: 0, error: "Zelle nicht beobachtet." }] });

// A truncated walk is still a result, flagged incomplete with the worker's note.
const truncated = await read({ snapshot: { stats: { ...stats, truncated: true } } });
assert.equal(truncated.ok, true);
assert.equal(truncated.incomplete, true);
assert.equal(truncated.note, "Baumlauf wurde abgeschnitten - es fehlen moeglicherweise Zeilen.");
assert.deepEqual(truncated.stats, { ...stats, truncated: true });
assert.equal(truncated.rowCount, 4);

// Fail closed: modal dialog and disabled window, an empty tree, and every window the path cannot describe.
const blocked = { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert die gebundene Seite; keine Tabelle ausgegeben." };
assert.deepEqual(await read({ snapshot: { modalBlocked: true } }), blocked);
assert.deepEqual(await read({ snapshot: { windowEnabled: false } }), blocked);
assert.deepEqual(await read({ snapshot: { nodes: [], stats: { ...stats, n: 0 } } }),
  { ok: false, backend: "qt", kind: "native-incomplete", error: "Der native Seitenbaum ist leer; keine Tabelle ausgegeben." });
requests.length = 0;
assert.deepEqual(await read({ windows: [MAIN_WINDOW, windowOf(88, "Datei öffnen", [10, 10, 500, 400], { class: "#32770" })] }),
  { ok: false, backend: "qt", kind: "dialog-open", error: "Ein nicht katalogisiertes Fenster des gebundenen Prozesses ist offen; Tabelle nicht gelesen. "
    + "Dialoge mit sse_dialog_list lesen und bewusst beantworten." });
assert.deepEqual(requests.map(entry => entry.operation), ["window_inventory"]);
const untitled = { hwnd: 90, pid: 99, class: "Qt692QWindow", x: 50, y: 50, w: 300, h: 200, minimized: false, hung: false };
assert.equal((await read({ inventory: { untitledWindows: [untitled], visibleWindowCount: 2 } })).kind, "dialog-open");
assert.deepEqual(await read({ windows: [{ ...MAIN_WINDOW, minimized: true }] }),
  { ok: false, backend: "qt", kind: "minimized", error: "Das gebundene SSE-Hauptfenster ist minimiert; der direkte Qt-Pfad stellt es nicht wieder her." });
assert.deepEqual(await read({ windows: [WERTE_INFO_WINDOW] }),
  { ok: false, backend: "qt", kind: "stale-window", error: "Das angegebene hwnd ist kein aktuelles Hauptfenster." });
const withWerteInfo = (tool) => ({ windows: [MAIN_WINDOW, WERTE_INFO_WINDOW], tool });
assert.deepEqual(await read(withWerteInfo({ modalBlocked: true })),
  { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert ein Nebenfenster der gebundenen Seite; Tabelle nicht gelesen." });
assert.deepEqual(await read(withWerteInfo({ windowEnabled: false })),
  { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert ein Nebenfenster der gebundenen Seite; Tabelle nicht gelesen." });
assert.deepEqual(await read(withWerteInfo({ stats: { ...werteInfoStats, truncated: true } })),
  { ok: false, backend: "qt", kind: "native-incomplete", error: "Der native Baum eines Nebenfensters ueberschreitet die Lesegrenze; Tabelle nicht gelesen." });
assert.deepEqual(await executeQtNativeReadTable(makeClient(), { hwnd: 42 }, 5000),
  { ok: false, backend: "qt", kind: "bad-args", error: "read_table requires a product profile." });

// Transport failures: a foreign hwnd never reaches the bridge; a snapshot of another window is a contract breach;
// so is a main window of another process or an owned window answering under a different handle.
const before = requests.length;
await assert.rejects(read({}, { hwnd: 43 }), error => error instanceof QtNativeTransportError && error.kind === "stale-window");
assert.equal(requests.length, before);
await assert.rejects(read({ snapshot: { hwnd: 84 } }), error => error instanceof QtNativeTransportError && error.kind === "native-contract");
await assert.rejects(read({ windows: [{ ...MAIN_WINDOW, pid: 98 }] }), error => error instanceof QtNativeTransportError && error.kind === "native-contract");
await assert.rejects(read(withWerteInfo({ hwnd: 85 })), error => error instanceof QtNativeTransportError && error.kind === "native-contract");
await assert.rejects(read({}, { hwnd: 42 }, 0), error => error instanceof QtNativeTransportError && error.kind === "native-timeout");

console.log("qt-native-read-table-projection: happy path, owned window listing, headless and header-merge projections, cell semantics, truncation, "
  + "11 fail-closed and 5 transport cases ok");
