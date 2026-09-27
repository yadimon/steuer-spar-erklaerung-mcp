import assert from "node:assert/strict";
import { executeQtNativeCheckerResults } from "../dist/qt-native-checker.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";

const profile = loadProductProfile("2025");

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

const MAIN_WINDOW = { hwnd: 42, pid: 99, class: "Qt692QWindowIcon", title: "SteuerSparErklärung 2025", x: 0, y: 0, w: 1600, h: 900,
  minimized: false, hung: false };
function fakeClient(nodes, overrides = {}, requests = [], windows = [MAIN_WINDOW]) {
  return { binding: { hwnd: 42, pid: 99, creationTime: "1" }, request: async (operation, args) => {
    requests.push({ operation, args });
    if (operation === "window_inventory") {
      return { durationMs: 2, result: { ok: true, windows, untitledWindows: [], visibleWindowCount: windows.length, productWindowCount: windows.length } };
    }
    return { durationMs: 7, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 42,
      windowEnabled: true, modalBlocked: false, foreground: true, windowRect: { x: 0, y: 0, w: 1600, h: 900 },
      nodes, exactMatches: {}, stats: { ...stats, n: nodes.length }, ...overrides } };
  } };
}
const run = (client, args = { hwnd: 42 }, timeoutMs = 5000) => executeQtNativeCheckerResults(client, args, timeoutMs, undefined, profile);

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
  const result = await run(fakeClient(activeNodes, {}, requests), { hwnd: 42 }, 5000);
  assert.deepEqual(requests, [{ operation: "window_inventory", args: {} }, { operation: "accessibility_snapshot", args: { maxNodes: 5000 } }]);
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
    nativeDurationMs: 9,
  });
}

// Boundaries copied from the worker: a card of exactly 70 px is expanded, an item exactly 6 px right of the
// left edge is still a top-level item, group headers match case-insensitively (-match), an item is expanded by a
// card whose name differs only in case (-eq), and the expanded list is de-duplicated case-sensitively (-Unique).
{
  const boundary = buildNodes([
    activeSpecs[0], activeSpecs[2],
    { p: 1, type: "TreeItem", name: "2 FRAGEN ODER WARNUNGEN", aid: TREE_AID, x: 300, y: 150 },
    { p: 1, type: "TreeItem", name: "Genau siebzig", aid: TREE_AID, x: 300, y: 180 },
    { p: 1, type: "TreeItem", name: "Genau siebzig", aid: TREE_AID, x: 340, y: 200, w: 800, h: 70 },
    { p: 1, type: "TreeItem", name: "Randfall", aid: TREE_AID, x: 306, y: 300, w: 800, h: 90 },
    { p: 1, type: "TreeItem", name: "1 tipps oder zusatzinformationen", aid: TREE_AID, x: 300, y: 400 },
    { p: 1, type: "TreeItem", name: "Karte", aid: TREE_AID, x: 300, y: 420 },
    { p: 1, type: "TreeItem", name: "KARTE", aid: TREE_AID, x: 340, y: 440, w: 800, h: 100 },
    { p: 1, type: "TreeItem", name: "Karte", aid: TREE_AID, x: 340, y: 560, w: 800, h: 100 },
    { p: 1, type: "TreeItem", name: "Karte", aid: TREE_AID, x: 340, y: 680, w: 800, h: 100 },
  ]);
  const result = await run(fakeClient(boundary));
  assert.equal(result.konsistent, true);
  assert.deepEqual([result.fragenWarnungenAngekuendigt, result.tippsAngekuendigt], [2, 1]);
  assert.deepEqual(result.fragenWarnungen.map(item => [item.text, item.aufgeklappt]), [["Genau siebzig", true], ["Randfall", false]]);
  assert.deepEqual(result.tippsZusatzinfos.map(item => [item.text, item.aufgeklappt]), [["Karte", true]]);
  assert.deepEqual(result.sonstige, []);
  assert.deepEqual(result.aufgeklappt, ["Genau siebzig", "KARTE", "Karte"]);
}

// PowerShell -match uses .NET `$`, which also matches before one trailing newline in a header name.
{
  const trailing = buildNodes([
    activeSpecs[0], activeSpecs[2],
    { p: 1, type: "TreeItem", name: "1 Fragen oder Warnungen\n", aid: TREE_AID, x: 300, y: 150 },
    { p: 1, type: "TreeItem", name: "Frage", aid: TREE_AID, x: 300, y: 180 },
    { p: 1, type: "TreeItem", name: "0 Tipps oder Zusatzinformationen\n", aid: TREE_AID, x: 300, y: 200 },
  ]);
  const result = await run(fakeClient(trailing));
  assert.deepEqual([result.fragenWarnungenAngekuendigt, result.tippsAngekuendigt, result.konsistent], [1, 0, true]);
  assert.deepEqual(result.fragenWarnungen.map(item => item.text), ["Frage"]);
  assert.deepEqual(result.sonstige, []);
}

// Sort by y then x: the group header wins over an item on the same row with a larger x.
{
  const shuffled = buildNodes([
    activeSpecs[0], activeSpecs[2],
    { p: 1, type: "TreeItem", name: "Erst spaeter", aid: TREE_AID, x: 302, y: 150 },
    { p: 1, type: "TreeItem", name: "1 Fragen oder Warnungen", aid: TREE_AID, x: 300, y: 150 },
    { p: 1, type: "TreeItem", name: "0 Tipps oder Zusatzinformationen", aid: TREE_AID, x: 300, y: 200 },
  ]);
  const result = await run(fakeClient(shuffled), { hwnd: 42 }, 5000);
  assert.equal(result.konsistent, true);
  assert.deepEqual(result.fragenWarnungen.map(item => item.text), ["Erst spaeter"]);
  assert.deepEqual(result.sonstige, []);
  assert.equal(result.ungespeichert, null);
}

// Empty checker: a uniquely bound tree without any item is a finished null result.
{
  const empty = buildNodes([activeSpecs[0], activeSpecs[1], activeSpecs[2]]);
  const result = await run(fakeClient(empty), { hwnd: 42 }, 5000);
  assert.deepEqual(result, {
    ok: true, aktiv: true, fragenWarnungenAngekuendigt: 0, tippsAngekuendigt: 0,
    fragenWarnungenGruppeGesehen: false, tippsGruppeGesehen: false,
    fragenWarnungen: [], tippsZusatzinfos: [], sonstige: [], gesamt: 0, aufgeklappt: [], konsistent: true,
    navigationSchritte: 0, fokusVerwendet: false, technischeFokusKarten: [], zyklen: [],
    ungespeichert: true, hinweis: ACTIVE_HINT, backend: "qt", nativeDurationMs: 9,
  });
}

// Unnamed items only: the checker is open but the result is deliberately inconsistent.
{
  const unnamed = buildNodes([activeSpecs[0], activeSpecs[2], { p: 1, type: "TreeItem", name: "", aid: TREE_AID, x: 300, y: 120 }]);
  const result = await run(fakeClient(unnamed), { hwnd: 42 }, 5000);
  assert.equal(result.aktiv, true);
  assert.equal(result.gesamt, 0);
  assert.equal(result.konsistent, false);
  assert.equal(result.hinweis, ACTIVE_HINT);
}

// Closed checker: no tree binds, the save button reports the dirty state.
{
  const closed = buildNodes([activeSpecs[0], { ...activeSpecs[1], on: false }, { p: 0, type: "Text", name: "Startseite", x: 400, y: 100 }]);
  const result = await run(fakeClient(closed), { hwnd: 42 }, 5000);
  assert.deepEqual(result, {
    ok: true, aktiv: false, fragenWarnungenAngekuendigt: 0, tippsAngekuendigt: 0,
    fragenWarnungenGruppeGesehen: false, tippsGruppeGesehen: false,
    fragenWarnungen: [], tippsZusatzinfos: [], sonstige: [], gesamt: 0, aufgeklappt: [], konsistent: false,
    navigationSchritte: 0, fokusVerwendet: false, technischeFokusKarten: [], zyklen: [],
    ungespeichert: false, hinweis: CLOSED_HINT, backend: "qt", nativeDurationMs: 9,
  });
}

// Two trees with the checker suffix: the binding is ambiguous, nothing is guessed.
{
  const ambiguous = buildNodes([...activeSpecs, { p: 0, type: "Tree", aid: `other.${TREE_AID}`, x: 1200, y: 100, w: 300, h: 300 }]);
  const result = await run(fakeClient(ambiguous), { hwnd: 42 }, 5000);
  assert.equal(result.aktiv, false);
  assert.equal(result.konsistent, false);
  assert.equal(result.hinweis, CLOSED_HINT);
}

// Declared count differs from the visible items: active but inconsistent.
{
  const inconsistent = activeNodes.map(node => node.name === "2 Fragen oder Warnungen" ? { ...node, name: "3 Fragen oder Warnungen" } : node);
  const result = await run(fakeClient(inconsistent), { hwnd: 42 }, 5000);
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
  const result = await run(fakeClient(missingTips), { hwnd: 42 }, 5000);
  assert.equal(result.tippsGruppeGesehen, false);
  assert.deepEqual(result.fragenWarnungen.map(item => item.text),
    ["Kirchensteuer pruefen", "Riester-Vertrag unvollstaendig", "Homeoffice-Pauschale moeglich"]);
  assert.equal(result.konsistent, false);
}

// Fail-closed guards.
{
  const modal = await run(fakeClient(activeNodes, { modalBlocked: true }), { hwnd: 42 }, 5000);
  assert.deepEqual(modal, { ok: false, backend: "qt", kind: "dialog-open",
    error: "Ein modaler Dialog blockiert die gebundene Seite; kein Prueferergebnis ausgegeben." });
  const disabled = await run(fakeClient(activeNodes, { windowEnabled: false }), { hwnd: 42 }, 5000);
  assert.deepEqual(disabled, modal);
  const deep = await run(
    fakeClient(activeNodes, { stats: { ...stats, n: activeNodes.length, truncated: true, depthLimited: true } }), { hwnd: 42 }, 5000);
  assert.deepEqual(deep, { ok: false, backend: "qt", kind: "native-incomplete",
    error: "Der native Seitenbaum ist tiefer als die Lesegrenze von 16 Ebenen; kein unvollstaendiges Prueferergebnis ausgegeben." });
  // An empty bulk snapshot is a failed read for the worker, never a closed checker.
  assert.deepEqual(await run(fakeClient([]), { hwnd: 42 }, 5000), { ok: false, backend: "qt",
    kind: "native-incomplete", error: "Der native Seitenbaum ist leer; kein Prueferergebnis ausgegeben." });
  const truncated = await run(
    fakeClient(activeNodes, { stats: { ...stats, n: activeNodes.length, truncated: true } }), { hwnd: 42 }, 5000);
  assert.deepEqual(truncated, { ok: false, backend: "qt", kind: "native-incomplete",
    error: "Der native Seitenbaum ueberschreitet die Lesegrenze; kein unvollstaendiges Prueferergebnis ausgegeben." });
  // The worker restores a minimized main window before reading; the direct path never moves it and reads nothing.
  const minimizedRequests = [];
  assert.deepEqual(await run(fakeClient(activeNodes, {}, minimizedRequests, [{ ...MAIN_WINDOW, minimized: true }])), { ok: false, backend: "qt",
    kind: "minimized", error: "Das gebundene SSE-Hauptfenster ist minimiert; der direkte Qt-Pfad stellt es nicht wieder her." });
  assert.deepEqual(minimizedRequests.map(entry => entry.operation), ["window_inventory"]);
  assert.deepEqual(await run(fakeClient(activeNodes, {}, [], [])), { ok: false, backend: "qt",
    kind: "stale-window", error: "Das angegebene hwnd ist kein aktuelles Hauptfenster." });
  await assert.rejects(run(fakeClient(activeNodes, {}, [], [{ ...MAIN_WINDOW, pid: 98 }])),
    error => error instanceof QtNativeTransportError && error.kind === "native-contract");
  // Other windows of the process are left alone, exactly as the worker's branch ignores them.
  const dialog = { hwnd: 88, pid: 99, class: "#32770", title: "Datei öffnen", x: 10, y: 10, w: 500, h: 400, minimized: false, hung: false };
  assert.equal((await run(fakeClient(activeNodes, {}, [], [MAIN_WINDOW, dialog]))).konsistent, true);
  assert.deepEqual(await executeQtNativeCheckerResults(fakeClient(activeNodes), { hwnd: 42 }, 5000), { ok: false, backend: "qt",
    kind: "bad-args", error: "checker_results requires a product profile." });
  await assert.rejects(run(fakeClient(activeNodes), { hwnd: 42 }, 0), error => error instanceof QtNativeTransportError && error.kind === "native-timeout");
  await assert.rejects(run(fakeClient(activeNodes), { hwnd: 43 }, 5000),
    error => error instanceof QtNativeTransportError && error.kind === "stale-window");
  await assert.rejects(run(fakeClient(activeNodes, { hwnd: 43 }), { hwnd: 42 }, 5000),
    error => error instanceof QtNativeTransportError && error.kind === "native-contract");
  const failing = { binding: { hwnd: 42, pid: 99, creationTime: "1" },
    request: async () => ({ durationMs: 1, result: { ok: false, code: "window-gone", error: "Fenster verloren." } }) };
  await assert.rejects(run(failing, { hwnd: 42 }, 5000),
    error => error instanceof QtNativeTransportError && error.kind === "window-gone" && error.message === "Fenster verloren.");
}

console.log("qt-native-checker-projection: 23 checker_results projection cases passed");
