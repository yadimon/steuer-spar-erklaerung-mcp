import assert from "node:assert/strict";
import { executeQtNativeCheckerResults } from "../dist/qt-native-checker.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";

// Pins the direct Qt projection of the worker's 'checker_results' branch on
// synthetic accessibility snapshots: the full contract for an open checker,
// the empty/closed/inconsistent variants and every fail-closed guard.

const TREE_AID = "window.CentralWidget.PrueferWidgetSSE.SteuerPruefer";
const SAVE_AID = "window.MainToolBar.tb_sichern";
const ACTIVE_HINT = "Fragen/Warnungen und Tipps sind getrennt. Ein Eintrag ist nicht automatisch ein Steuerfehler; mit sse_checker_open den Wortlaut oeffnen.";
const CLOSED_HINT = "Der globale Steuerpruefer ist nicht offen. Zu 'Pruefen und Abgeben' und dann 'Steuererklaerung pruefen' navigieren; dort sse_checker_run aufrufen.";

function buildNodes(specs) {
  const nodes = [];
  for (const [i, spec] of specs.entries()) {
    nodes.push({
      i, p: spec.p, d: spec.p < 0 ? 0 : nodes[spec.p].d + 1, type: spec.type, name: spec.name ?? "", aid: spec.aid ?? "",
      rid: `42.${1000 + i}`, x: spec.x ?? 0, y: spec.y ?? 0, w: spec.w ?? 100, h: spec.h ?? 20, on: spec.on ?? true,
      val: null, ro: null, checked: null, selected: null, scroll: null,
    });
  }
  return nodes;
}

const stats = { n: 0, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
  valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 3 };

function fakeClient(nodes, overrides = {}, requests = []) {
  return { binding: { hwnd: 42, pid: 99, creationTime: "1" }, request: async (operation, args) => {
    requests.push({ operation, args });
    return { durationMs: 7, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 42,
      windowEnabled: true, modalBlocked: false, foreground: true, windowRect: { x: 0, y: 0, w: 1600, h: 900 },
      nodes, exactMatches: {}, stats: { ...stats, n: nodes.length }, ...overrides } };
  } };
}

// Layout: item titles sit at the tree's left edge; an expanded card is a wide
// TreeItem indented to the right with a tall (>= 70 px) body, named like its title.
const activeSpecs = [
  { p: -1, type: "Group", aid: "window.CentralWidget", x: 0, y: 0, w: 1600, h: 900 },
  { p: 0, type: "Button", name: "Speichern", aid: SAVE_AID, x: 10, y: 10, w: 40, h: 20, on: true },
  { p: 0, type: "Tree", aid: TREE_AID, x: 300, y: 100, w: 900, h: 700 },
  { p: 2, type: "TreeItem", name: "Hinweis ohne Gruppe", aid: TREE_AID, x: 304, y: 120 },
  { p: 2, type: "TreeItem", name: "2 Fragen oder Warnungen", aid: TREE_AID, x: 300, y: 150 },
  { p: 2, type: "TreeItem", name: "Kirchensteuer pruefen", aid: TREE_AID, x: 302, y: 180, on: false },
  { p: 5, type: "TreeItem", name: "kirchensteuer PRUEFEN", aid: TREE_AID, x: 340, y: 205, w: 800, h: 120 },
  { p: 2, type: "TreeItem", name: "Riester-Vertrag unvollstaendig", aid: TREE_AID, x: 300, y: 340 },
  { p: 2, type: "TreeItem", name: "1 Tipps oder Zusatzinformationen", aid: TREE_AID, x: 300, y: 380 },
  { p: 2, type: "TreeItem", name: "Homeoffice-Pauschale moeglich", aid: TREE_AID, x: 306, y: 410 },
  { p: 9, type: "TreeItem", name: "Kurzer Klapptext", aid: TREE_AID, x: 340, y: 435, w: 800, h: 40 },
  { p: 2, type: "TreeItem", name: "", aid: TREE_AID, x: 300, y: 500 },
  { p: 0, type: "TreeItem", name: "Navigationseintrag", aid: "window.NavTree", x: 20, y: 200 },
];
const activeNodes = buildNodes(activeSpecs);

{
  const requests = [];
  const result = await executeQtNativeCheckerResults(fakeClient(activeNodes, {}, requests), { hwnd: 42 }, 5000);
  assert.deepEqual(requests, [{ operation: "accessibility_snapshot", args: { maxNodes: 5000 } }]);
  assert.deepEqual(result, {
    ok: true,
    aktiv: true,
    fragenWarnungenAngekuendigt: 2,
    tippsAngekuendigt: 1,
    fragenWarnungenGruppeGesehen: true,
    tippsGruppeGesehen: true,
    fragenWarnungen: [
      { text: "Kirchensteuer pruefen", rid: "42.1005", y: 180, aktiviert: false, aufgeklappt: true },
      { text: "Riester-Vertrag unvollstaendig", rid: "42.1007", y: 340, aktiviert: true, aufgeklappt: false },
    ],
    tippsZusatzinfos: [
      { text: "Homeoffice-Pauschale moeglich", rid: "42.1009", y: 410, aktiviert: true, aufgeklappt: false },
    ],
    sonstige: [
      { text: "Hinweis ohne Gruppe", rid: "42.1003", y: 120, aktiviert: true, aufgeklappt: false },
    ],
    gesamt: 4,
    aufgeklappt: ["kirchensteuer PRUEFEN"],
    konsistent: true,
    navigationSchritte: 0,
    fokusVerwendet: false,
    technischeFokusKarten: [],
    zyklen: [],
    ungespeichert: true,
    hinweis: ACTIVE_HINT,
    backend: "qt",
    nativeDurationMs: 7,
  });
}

// Sort by y then x: the group header wins over an item on the same row with a larger x.
{
  const shuffled = buildNodes([
    activeSpecs[0], activeSpecs[2],
    { p: 1, type: "TreeItem", name: "Erst spaeter", aid: TREE_AID, x: 302, y: 150 },
    { p: 1, type: "TreeItem", name: "1 Fragen oder Warnungen", aid: TREE_AID, x: 300, y: 150 },
    { p: 1, type: "TreeItem", name: "0 Tipps oder Zusatzinformationen", aid: TREE_AID, x: 300, y: 200 },
  ]);
  const result = await executeQtNativeCheckerResults(fakeClient(shuffled), { hwnd: 42 }, 5000);
  assert.equal(result.konsistent, true);
  assert.deepEqual(result.fragenWarnungen.map(item => item.text), ["Erst spaeter"]);
  assert.deepEqual(result.sonstige, []);
  assert.equal(result.ungespeichert, null);
}

// Empty checker: a uniquely bound tree without any item is a finished null result.
{
  const empty = buildNodes([activeSpecs[0], activeSpecs[1], activeSpecs[2]]);
  const result = await executeQtNativeCheckerResults(fakeClient(empty), { hwnd: 42 }, 5000);
  assert.deepEqual(result, {
    ok: true, aktiv: true, fragenWarnungenAngekuendigt: 0, tippsAngekuendigt: 0,
    fragenWarnungenGruppeGesehen: false, tippsGruppeGesehen: false,
    fragenWarnungen: [], tippsZusatzinfos: [], sonstige: [], gesamt: 0, aufgeklappt: [], konsistent: true,
    navigationSchritte: 0, fokusVerwendet: false, technischeFokusKarten: [], zyklen: [],
    ungespeichert: true, hinweis: ACTIVE_HINT, backend: "qt", nativeDurationMs: 7,
  });
}

// Unnamed items only: the checker is open but the result is deliberately inconsistent.
{
  const unnamed = buildNodes([activeSpecs[0], activeSpecs[2], { p: 1, type: "TreeItem", name: "", aid: TREE_AID, x: 300, y: 120 }]);
  const result = await executeQtNativeCheckerResults(fakeClient(unnamed), { hwnd: 42 }, 5000);
  assert.equal(result.aktiv, true);
  assert.equal(result.gesamt, 0);
  assert.equal(result.konsistent, false);
  assert.equal(result.hinweis, ACTIVE_HINT);
}

// Closed checker: no tree binds, the save button reports the dirty state.
{
  const closed = buildNodes([activeSpecs[0], { ...activeSpecs[1], on: false }, { p: 0, type: "Text", name: "Startseite", x: 400, y: 100 }]);
  const result = await executeQtNativeCheckerResults(fakeClient(closed), { hwnd: 42 }, 5000);
  assert.deepEqual(result, {
    ok: true, aktiv: false, fragenWarnungenAngekuendigt: 0, tippsAngekuendigt: 0,
    fragenWarnungenGruppeGesehen: false, tippsGruppeGesehen: false,
    fragenWarnungen: [], tippsZusatzinfos: [], sonstige: [], gesamt: 0, aufgeklappt: [], konsistent: false,
    navigationSchritte: 0, fokusVerwendet: false, technischeFokusKarten: [], zyklen: [],
    ungespeichert: false, hinweis: CLOSED_HINT, backend: "qt", nativeDurationMs: 7,
  });
}

// Two trees with the checker suffix: the binding is ambiguous, nothing is guessed.
{
  const ambiguous = buildNodes([...activeSpecs, { p: 0, type: "Tree", aid: `other.${TREE_AID}`, x: 1200, y: 100, w: 300, h: 300 }]);
  const result = await executeQtNativeCheckerResults(fakeClient(ambiguous), { hwnd: 42 }, 5000);
  assert.equal(result.aktiv, false);
  assert.equal(result.konsistent, false);
  assert.equal(result.hinweis, CLOSED_HINT);
}

// Declared count differs from the visible items: active but inconsistent.
{
  const inconsistent = activeNodes.map(node => node.name === "2 Fragen oder Warnungen" ? { ...node, name: "3 Fragen oder Warnungen" } : node);
  const result = await executeQtNativeCheckerResults(fakeClient(inconsistent), { hwnd: 42 }, 5000);
  assert.equal(result.ok, true);
  assert.equal(result.aktiv, true);
  assert.equal(result.fragenWarnungenAngekuendigt, 3);
  assert.equal(result.fragenWarnungen.length, 2);
  assert.equal(result.gesamt, 4);
  assert.equal(result.konsistent, false);
}

// One group header missing (unnamed row instead): the other group is still read, the result stays inconsistent.
{
  const missingTips = activeNodes.map(node => node.name === "1 Tipps oder Zusatzinformationen" ? { ...node, name: "" } : node);
  const result = await executeQtNativeCheckerResults(fakeClient(missingTips), { hwnd: 42 }, 5000);
  assert.equal(result.tippsGruppeGesehen, false);
  assert.deepEqual(result.fragenWarnungen.map(item => item.text),
    ["Kirchensteuer pruefen", "Riester-Vertrag unvollstaendig", "Homeoffice-Pauschale moeglich"]);
  assert.equal(result.konsistent, false);
}

// Fail-closed guards.
{
  const modal = await executeQtNativeCheckerResults(fakeClient(activeNodes, { modalBlocked: true }), { hwnd: 42 }, 5000);
  assert.deepEqual(modal, { ok: false, backend: "qt", kind: "dialog-open",
    error: "Ein modaler Dialog blockiert die gebundene Seite; kein Prueferergebnis ausgegeben." });
  const disabled = await executeQtNativeCheckerResults(fakeClient(activeNodes, { windowEnabled: false }), { hwnd: 42 }, 5000);
  assert.deepEqual(disabled, modal);
  const truncated = await executeQtNativeCheckerResults(
    fakeClient(activeNodes, { stats: { ...stats, n: activeNodes.length, truncated: true } }), { hwnd: 42 }, 5000);
  assert.deepEqual(truncated, { ok: false, backend: "qt", kind: "native-incomplete",
    error: "Der native Seitenbaum ueberschreitet die Lesegrenze; kein unvollstaendiges Prueferergebnis ausgegeben." });
  await assert.rejects(executeQtNativeCheckerResults(fakeClient(activeNodes), { hwnd: 43 }, 5000),
    error => error instanceof QtNativeTransportError && error.kind === "stale-window");
  await assert.rejects(executeQtNativeCheckerResults(fakeClient(activeNodes, { hwnd: 43 }), { hwnd: 42 }, 5000),
    error => error instanceof QtNativeTransportError && error.kind === "native-contract");
  const failing = { binding: { hwnd: 42, pid: 99, creationTime: "1" },
    request: async () => ({ durationMs: 1, result: { ok: false, code: "window-gone", error: "Fenster verloren." } }) };
  await assert.rejects(executeQtNativeCheckerResults(failing, { hwnd: 42 }, 5000),
    error => error instanceof QtNativeTransportError && error.kind === "window-gone" && error.message === "Fenster verloren.");
}

console.log("qt-native-checker-projection: 13 checker_results projection cases passed");
