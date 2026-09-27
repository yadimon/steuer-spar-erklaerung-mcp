import assert from "node:assert/strict";
import {
  executeQtNativeReadTable, qtNativeTableCellSemantic, qtNativeTableProjection, qtNativeTableRowDetails,
} from "../dist/qt-native-read-table.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";

// Synthetic Qt item view: three header columns (x = 100, 300, 500), a duplicated
// header 6 px to the right of the first one, and rows that exercise every
// worker rule: X-based column assignment, the 10 px row band, a tie between two
// headers, a later cell overwriting an earlier one, unpositioned cells and the
// subtree of a foreign window carrying its own table.
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
node("DataItem", "Neue Zeile", 100, 111);
node("DataItem", "Ohne Ausdehnung", 300, 111, { w: 0 });
const foreign = node("Window", "Werte-Info", 600, 300, { aid: "fixture.WerteInfo", w: 400, h: 200 });
node("Header", "Fremd", 610, 320, { p: foreign, d: 1 });
node("DataItem", "Fremde Zelle", 610, 340, { p: foreign, d: 1 });
node("Button", "Weiter", 100, 400);
const rect = { x: 0, y: 0, w: 1000, h: 500 };
const stats = { n: nodes.length, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
  valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 };

const requests = [];
const makeClient = (overrides = {}) => ({
  binding: { hwnd: 42, pid: 99, creationTime: "1" },
  request: async (operation, args) => {
    requests.push({ operation, args });
    assert.equal(operation, "accessibility_snapshot");
    return { durationMs: 9, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
      hwnd: 42, windowRect: rect, windowEnabled: true, modalBlocked: false, exactMatches: {}, nodes, stats, ...overrides } };
  },
});

const expectedRowDetails = [
  { rowIndex: 0, typedValues: ["Miete", "12,00", true], checkboxStates: [null, null, "On"], cellTypes: ["text", "text", "boolean"],
    semanticsComplete: true, semanticReadErrors: [] },
  { rowIndex: 1, typedValues: ["Strom", false, null], checkboxStates: [null, "Off", null], cellTypes: ["text", "boolean", "unknown"],
    semanticsComplete: false, semanticReadErrors: [{ column: 2, error: "Zelle nicht beobachtet." }] },
  { rowIndex: 2, typedValues: ["Ueberschrieben", null, null], checkboxStates: [null, null, "Indeterminate"], cellTypes: ["text", "unknown", "boolean"],
    semanticsComplete: false, semanticReadErrors: [{ column: 1, error: "Zelle nicht beobachtet." }] },
  { rowIndex: 3, typedValues: ["Neue Zeile", null, null], checkboxStates: [null, null, null], cellTypes: ["text", "unknown", "unknown"],
    semanticsComplete: false, semanticReadErrors: [{ column: 1, error: "Zelle nicht beobachtet." }, { column: 2, error: "Zelle nicht beobachtet." }] },
];

// Happy path: the full worker contract is pinned, including the '' for unobserved row slots.
const result = await executeQtNativeReadTable(makeClient(), { hwnd: 42 }, 5000);
assert.deepEqual(result, {
  ok: true,
  headers: ["Bezeichnung", "Betrag", "Erledigt"],
  rows: [["Miete", "12,00", ""], ["Strom", "Nein", ""], ["Ueberschrieben", "", ""], ["Neue Zeile", "", ""]],
  rowCount: 4,
  rowDetails: expectedRowDetails,
  ausgeschlosseneFenster: [{ rid: "42.42.4.18", name: "Werte-Info", aid: "fixture.WerteInfo", x: 600, y: 300, w: 400, h: 200, nodeCount: 3 }],
  stats,
  incomplete: false,
  note: "Nur die SICHTBAREN Zeilen. Qt virtualisiert Tabellen: mehr Zeilen erscheinen erst, wenn der Cursor sie in den Blick holt (Pfeiltaste).",
  backend: "qt",
  nativeDurationMs: 9,
});
assert.deepEqual(requests, [{ operation: "accessibility_snapshot", args: { maxNodes: 4000, withCellStates: true } }]);

// Without headers every cell is appended behind the worker's single null slot.
const headless = nodes.filter(entry => entry.type !== "Header" && entry.p === -1 && entry.type !== "Window");
assert.deepEqual(qtNativeTableProjection(headless), {
  headers: [],
  rows: [["", "Miete", "12,00", ""], ["", "Strom", "Nein"], ["", "Mitte", "", "Ueberschrieben"], ["", "Neue Zeile"]],
  rowCount: 4,
  rowDetails: [
    { rowIndex: 0, typedValues: [null, "Miete", "12,00", true], checkboxStates: [null, null, null, "On"], cellTypes: ["unknown", "text", "text", "boolean"],
      semanticsComplete: false, semanticReadErrors: [{ column: 0, error: "Zelle nicht beobachtet." }] },
    { rowIndex: 1, typedValues: [null, "Strom", false], checkboxStates: [null, null, "Off"], cellTypes: ["unknown", "text", "boolean"],
      semanticsComplete: false, semanticReadErrors: [{ column: 0, error: "Zelle nicht beobachtet." }] },
    { rowIndex: 2, typedValues: [null, "Mitte", null, "Ueberschrieben"], checkboxStates: [null, null, "Indeterminate", null],
      cellTypes: ["unknown", "text", "boolean", "text"], semanticsComplete: false, semanticReadErrors: [{ column: 0, error: "Zelle nicht beobachtet." }] },
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
const truncated = await executeQtNativeReadTable(makeClient({ stats: { ...stats, truncated: true } }), { hwnd: 42 }, 5000);
assert.equal(truncated.ok, true);
assert.equal(truncated.incomplete, true);
assert.equal(truncated.note, "Baumlauf wurde abgeschnitten - es fehlen moeglicherweise Zeilen.");
assert.deepEqual(truncated.stats, { ...stats, truncated: true });
assert.equal(truncated.rowCount, 4);

// Fail closed: modal dialog and disabled window.
const blocked = { ok: false, backend: "qt", kind: "dialog-open", error: "Ein modaler Dialog blockiert die gebundene Seite; keine Tabelle ausgegeben." };
assert.deepEqual(await executeQtNativeReadTable(makeClient({ modalBlocked: true }), { hwnd: 42 }, 5000), blocked);
assert.deepEqual(await executeQtNativeReadTable(makeClient({ windowEnabled: false }), { hwnd: 42 }, 5000), blocked);

// Transport failures: a foreign hwnd never reaches the bridge; a snapshot of another window is a contract breach.
const before = requests.length;
await assert.rejects(executeQtNativeReadTable(makeClient(), { hwnd: 43 }, 5000),
  error => error instanceof QtNativeTransportError && error.kind === "stale-window");
assert.equal(requests.length, before);
await assert.rejects(executeQtNativeReadTable(makeClient({ hwnd: 84 }), { hwnd: 42 }, 5000),
  error => error instanceof QtNativeTransportError && error.kind === "native-contract");

console.log("qt-native-read-table-projection: happy path, headless and header-merge projections, cell semantics, truncation, 2 fail-closed and 2 transport cases ok");
