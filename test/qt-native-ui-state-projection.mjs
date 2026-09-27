import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeQtNativeUiState } from "../dist/qt-native-ui-state.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";

// Offline contract of the direct Qt ui_state projection: synthetic trees and a
// fake bridge client, no window, no worker. Every assertion pins the worker's
// field names and strings; the fingerprint is pinned through its exact bytes.

const profile = loadProductProfile("2025");
const WERTE_INFO_TITLE = "Werte-Info: Werte vergleichen - Was wäre wenn";
const UNREADABLE_HINT = "Der direkte Qt-Pfad liest fremde Dialoge und unbekannte Fenster nicht; mit sse_dialog_list oder sse_windows pruefen.";
const UNTITLED_MODAL_HINT = "Ein modaler Dialog ohne Fenstertitel blockiert das gebundene Hauptfenster; der direkte Qt-Pfad liest ihn nicht.";
const UNTITLED_WINDOW_HINT = "Ein namenloses Fenster des gebundenen Prozesses ist sichtbar; der direkte Qt-Pfad liest es nicht.";
const sha256 = text => createHash("sha256").update(text, "utf8").digest("hex").toUpperCase();
const stats = n => ({ n, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
  valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 7 });

function treeBuilder(host) {
  const nodes = [];
  const add = (type, name, x, y, extra = {}) => {
    const i = nodes.length;
    nodes.push({ i, p: -1, d: 0, type, name, aid: `window.Node${i}`, rid: `42.${host}.4.${i + 1}`, x, y, w: 80, h: 20,
      on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
    return i;
  };
  return { nodes, add };
}

// names.navError / names.prueferItem switch the page-checker evidence between the two happy paths.
function mainTree(names) {
  const { nodes, add } = treeBuilder(42);
  const nav = add("Tree", "Navigation", 0, 0, { w: 200, h: 500, aid: "window.NavTree" });
  add("TreeItem", "Allgemein", 20, 30, { p: nav, d: 1, aid: "window.NavTree.item" });
  add("TreeItem", names.navError, 20, 50, { p: nav, d: 1, aid: "window.NavTree.item" });
  add("TreeItem", names.navError, 20, 70, { p: nav, d: 1, aid: "window.NavTree.item" });
  const checker = add("Tree", "", 20, 200, { w: 180, h: 200, aid: "window.PrueferWidgetSSE.SteuerPruefer" });
  const checkerItem = (name, x, y, extra = {}) => add("TreeItem", name, x, y, { p: checker, d: 1, aid: "window.PrueferWidgetSSE.SteuerPruefer.item", ...extra });
  checkerItem("2 Fragen oder Warnungen", 20, 210);
  checkerItem("Frage A!", 20, 230);
  checkerItem("Frage B", 20, 250);
  checkerItem("1 Tipps oder Zusatzinformationen", 20, 270);
  checkerItem("Tipp C", 20, 290);
  checkerItem("Frage A!", 40, 310, { h: 80 });
  const header = add("Group", "", 220, 0, { w: 700, h: 40, aid: "window.ClientFrameSSE.ClientHeader" });
  add("Text", "Synthetic heading", 220, 10, { p: header, d: 1, aid: "window.ClientFrameSSE.ClientHeader.QLabel" });
  add("Button", "Speichern", 10, 10, { w: 40, aid: "window.MainToolBar.tb_sichern" });
  add("Button", "Eingabehilfe", 800, 0);
  add("TreeItem", names.prueferItem, 850, 100, { aid: "window.PrueferSeite.item" });
  add("TreeItem", names.prueferItem, 850, 120, { aid: "window.PrueferSeite.item" });
  add("TreeItem", "prüfer", 850, 140, { aid: "window.PrueferSeite.item" });
  add("TreeItem", "Steuer-Spar-Tipps", 850, 160, { aid: "window.PrueferSeite.item" });
  add("TreeItem", "x".repeat(90), 850, 180, { aid: "window.PrueferSeite.item" });
  add("TreeItem", "Zurzeit keine Hinweise zu diesem Dialog.", 850, 200, { aid: "window.PrueferSeite.item" });
  add("ComboBox", "", 300, 120, { val: "", ro: false, aid: "window.RedThreadContent.Anrede.cb_Anrede" });
  add("ComboBox", "", 300, 100, { val: "  ", ro: false, aid: "window.RedThreadContent.Titel.cb_Titel" });
  add("ComboBox", "", 300, 140, { val: "Deutschland", ro: false, aid: "window.RedThreadContent.Land.cb_Land" });
  add("ComboBox", "", 50, 160, { val: "", ro: false, aid: "window.Left.cb_Links" });
  const foreign = add("Window", "Fremd", 300, 300, { w: 300, h: 200, aid: "window.Fremd" });
  add("TreeItem", "Fremd !", 20, 320, { p: foreign, d: 1, aid: "window.Fremd.item" });
  add("ComboBox", "", 300, 330, { p: foreign, d: 1, val: "", ro: false, aid: "window.Fremd.cb_Fremd" });
  add("Table", "", 300, 340, { p: foreign, d: 1, w: 200, h: 100, aid: "window.Fremd.obj_Wertetabelle" });
  return nodes;
}

function werteInfoTree() {
  const { nodes, add } = treeBuilder(84);
  const table = add("Table", "", 110, 150, { w: 500, h: 300, aid: "werteinfo.obj_Wertetabelle" });
  const cell = (type, name, column, y) => add(type, name, 120 + column * 120, y, { p: table, d: 1, w: 100, aid: "werteinfo.obj_Wertetabelle" });
  ["Beobachteter Wert", "Aktuell", "Festgehalten", "Differenz"].forEach((name, column) => cell("Header", name, column, 150));
  ["Einkommensteuer", "1.000,00", "800,00", "200,00"].forEach((name, column) => cell("DataItem", name, column, 180));
  ["Soli & Kirche", "55,00", "44,00", "11,00"].forEach((name, column) => cell("DataItem", name, column, 200));
  return nodes;
}

const MAIN_RECT = { x: 0, y: 0, w: 1000, h: 600 };
const WERTE_RECT = { x: 100, y: 100, w: 600, h: 400 };
const window = (hwnd, title, geometry, extra = {}) => ({ hwnd, pid: 99, class: "Qt692QWindowIcon", title,
  x: geometry[0], y: geometry[1], w: geometry[2], h: geometry[3], minimized: false, hung: false, ...extra });
const MAIN_WINDOW = window(42, "SteuerSparErklärung 2025", [0, 0, 1000, 600]);
const WERTE_WINDOW = window(84, WERTE_INFO_TITLE, [100, 100, 600, 400]);
const TIPS_WINDOW = window(85, "steuer-spar-tipps", [200, 200, 700, 500]);
const OVERLAY_WINDOW = window(86, "UAC", [0, 0, 40, 40], { class: "UAC_Overlay" });
const RECEIPT_WINDOW = window(87, "BelegManager", [100, 100, 800, 500]);

const snapshotReply = spec => ({ durationMs: spec.durationMs, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
  hwnd: spec.hwnd, windowEnabled: true, modalBlocked: false, windowRect: spec.rect, nodes: spec.nodes,
  stats: spec.stats, exactMatches: {}, ...spec.overrides } });
const mainSpec = (nodes, overrides = {}) => ({ durationMs: 2, hwnd: 42, rect: MAIN_RECT, nodes, stats: stats(nodes.length), overrides });
const werteSpec = (overrides = {}) => ({ durationMs: 3, hwnd: 84, rect: WERTE_RECT, nodes: werteInfoTree(), stats: stats(13), overrides });

function fakeClient(windows, main, tools = [], inventoryExtra = {}) {
  const log = [];
  const snapshots = new Map([[undefined, main], ...tools]);
  const answers = {
    window_inventory: () => ({ durationMs: 1,
      result: { ok: true, windows, visibleWindowCount: windows.length, untitledWindows: [], ...inventoryExtra } }),
    accessibility_snapshot: args => snapshotReply(snapshots.get(args.toolTitle)),
  };
  const client = { binding: { hwnd: 42, pid: 99, creationTime: "1" }, request: async (operation, args) => {
    log.push({ operation, args });
    return answers[operation](args);
  } };
  return { client, log };
}

const blockedNames = { navError: "Kinder !", prueferItem: "Bitte Anrede angeben" };
const cleanNames = { navError: "Kinder", prueferItem: "Prüfer" };
const checkerExpected = {
  aktiv: true, leer: false, fragenWarnungenAngekuendigt: 2, tippsAngekuendigt: 1,
  fragenWarnungenGruppeGesehen: true, tippsGruppeGesehen: true,
  fragenWarnungen: [
    { text: "Frage A!", rid: "42.42.4.7", y: 230, aktiviert: true, aufgeklappt: true },
    { text: "Frage B", rid: "42.42.4.8", y: 250, aktiviert: true, aufgeklappt: false },
  ],
  tippsZusatzinfos: [{ text: "Tipp C", rid: "42.42.4.10", y: 290, aktiviert: true, aufgeklappt: false }],
  sonstige: [], gesamt: 3, aufgeklappt: ["Frage A!"], konsistent: true,
};
const werteInfoEntry = { hwnd: 84, pid: 99, cls: "Qt692QWindowIcon", title: WERTE_INFO_TITLE, art: "werte-info",
  x: 100, y: 100, w: 600, h: 400, buttons: [], texte: [], fingerprint: null, uiaReadOk: null, uiaError: null, msaaReadOk: null, msaaError: null };
const tipsEntry = { hwnd: 85, pid: 99, cls: "Qt692QWindowIcon", title: "steuer-spar-tipps", art: "steuer-tipps",
  x: 200, y: 200, w: 700, h: 500, buttons: [], texte: [], fingerprint: null, uiaReadOk: null, uiaError: null, msaaReadOk: null, msaaError: null };
const rows = [
  { beobachteterWert: "Einkommensteuer", aktuell: "1.000,00", festgehalten: "800,00", differenz: "200,00" },
  { beobachteterWert: "Soli & Kirche", aktuell: "55,00", festgehalten: "44,00", differenz: "11,00" },
];
// Windows PowerShell 5.1 ConvertTo-Json writes '&' as a six-character unicode escape; these are the worker's exact fingerprint bytes.
const ergebnisFingerprint = sha256('[{"beobachteterWert":"Einkommensteuer","aktuell":"1.000,00","festgehalten":"800,00","differenz":"200,00"},'
  + '{"beobachteterWert":"Soli \\u0026 Kirche","aktuell":"55,00","festgehalten":"44,00","differenz":"11,00"}]');
const blockedFingerprint = sha256('{"instance":{"pid":99,"hwnd":42},"heading":"Synthetic heading","dirty":true,"blockiert":true,"dialogs":[],'
  + '"uncertain":[],"windowKinds":["hauptfenster","steuer-tipps","werte-info"],"pruefer":["Bitte Anrede angeben"],"baumfehler":["Kinder !"],'
  + '"leerePflicht":["cb_Titel","cb_Anrede"],"checker":{"aktiv":true,"fragen":2,"tipps":1,"konsistent":true},'
  + `"ergebnisFingerprint":"${ergebnisFingerprint}"}`);

// Happy path with an open Werte-Info, page-checker evidence and a case-insensitive previous fingerprint.
{
  const { client, log } = fakeClient([MAIN_WINDOW, WERTE_WINDOW, TIPS_WINDOW, OVERLAY_WINDOW], mainSpec(mainTree(blockedNames)),
    [[WERTE_INFO_TITLE, werteSpec()]]);
  const result = await executeQtNativeUiState(client, { hwnd: 42, previousFingerprint: blockedFingerprint.toLowerCase() }, 5000, undefined, profile);
  assert.deepEqual(result, {
    ok: true,
    running: true,
    instance: { pid: 99, hwnd: 42, title: "SteuerSparErklärung 2025" },
    stateFingerprint: blockedFingerprint,
    changedSince: false,
    heading: "Synthetic heading",
    blockiert: true,
    dialoge: [],
    unsichereFenster: [],
    prueferMeldungen: ["Bitte Anrede angeben"],
    baumFehler: ["Kinder !"],
    leerePflichtfelder: [{ y: 120, aid: "cb_Anrede", rid: "42.42.4.22" }, { y: 100, aid: "cb_Titel", rid: "42.42.4.23" }],
    steuerpruefer: checkerExpected,
    ungespeichert: true,
    ergebnis: {
      verfuegbar: true, fensterOffen: true, anzahl: 2, vollstaendig: true, zeilen: rows, unvollstaendigeZeilen: [],
      nichtPositionierteZellenAnzahl: 0, uiaKopfzeilen: ["Beobachteter Wert", "Aktuell", "Festgehalten", "Differenz"], kopfVollstaendig: true,
      vergleichsInvariantGeprueft: 2, vergleichsInvariantFehler: [], vertikalUnvollstaendig: false, fingerprint: ergebnisFingerprint,
      hinweis: "Aktuell ist der gegenwaertige Wert; festgehalten ist der Vergleichsstand; Differenz ist die Wirkung gegen diesen Stand.",
    },
    fensterAnzahl: 4,
    warnfensterAnzahl: 0,
    // Get-Windows lists the larger window first.
    nichtmodaleFenster: [tipsEntry, werteInfoEntry],
    snapshot: { source: "qt", nodes: 29, truncated: false, cycles: 0, snapshotMs: 7 },
    rat: "Der Seitenpruefer verlangt Angaben: Bitte Anrede angeben; Kinder !. Erst klaeren, dann navigieren.",
    backend: "qt",
    nativeDurationMs: 6,
  });
  assert.deepEqual(log, [
    { operation: "window_inventory", args: {} },
    { operation: "accessibility_snapshot", args: { maxNodes: 5000 } },
    { operation: "accessibility_snapshot", args: { maxNodes: 5000, toolTitle: WERTE_INFO_TITLE } },
  ]);
}

// Clean page without Werte-Info: the foreign window subtree never counts as page content or result table.
const cleanFingerprint = sha256('{"instance":{"pid":99,"hwnd":42},"heading":"Synthetic heading","dirty":true,"blockiert":false,"dialogs":[],'
  + '"uncertain":[],"windowKinds":["hauptfenster"],"pruefer":[],"baumfehler":[],"leerePflicht":["cb_Titel","cb_Anrede"],'
  + '"checker":{"aktiv":true,"fragen":2,"tipps":1,"konsistent":true},"ergebnisFingerprint":null}');
{
  const { client, log } = fakeClient([MAIN_WINDOW, OVERLAY_WINDOW], mainSpec(mainTree(cleanNames)));
  const result = await executeQtNativeUiState(client, {}, 5000, undefined, profile);
  assert.equal(result.ok, true);
  assert.equal(result.stateFingerprint, cleanFingerprint);
  assert.equal(result.changedSince, null);
  assert.equal(result.blockiert, false);
  assert.deepEqual(result.prueferMeldungen, []);
  assert.deepEqual(result.baumFehler, []);
  assert.deepEqual(result.unsichereFenster, []);
  assert.deepEqual(result.nichtmodaleFenster, []);
  assert.equal(result.fensterAnzahl, 2);
  assert.deepEqual(result.ergebnis, {
    verfuegbar: false, fensterOffen: false, anzahl: 0, vollstaendig: false, zeilen: [], unvollstaendigeZeilen: [],
    nichtPositionierteZellenAnzahl: 0, uiaKopfzeilen: [], kopfVollstaendig: false, vergleichsInvariantGeprueft: 0,
    vergleichsInvariantFehler: [], vertikalUnvollstaendig: false, fingerprint: null,
    hinweis: "Werte-Info ist nicht offen. Einmal sse_result_details aufrufen; danach liest sse_ui_state die Werte ohne weiteren Fensterwechsel mit.",
  });
  assert.equal(result.rat, "Globaler Steuerpruefer aktiv: 2 Fragen/Warnungen und 1 Tipps.");
  assert.equal(result.nativeDurationMs, 3);
  assert.equal(log.length, 2);
  const changed = await executeQtNativeUiState(client, { previousFingerprint: "ABC" }, 5000, undefined, profile);
  assert.equal(changed.changedSince, true);
}

// An untitled modal dialog is invisible to the inventory: the blocked main window yields one synthetic unreadable entry.
{
  const { client } = fakeClient([MAIN_WINDOW, OVERLAY_WINDOW], mainSpec(mainTree(cleanNames), { modalBlocked: true }));
  const result = await executeQtNativeUiState(client, { hwnd: 42 }, 5000, undefined, profile);
  assert.equal(result.ok, true);
  assert.equal(result.blockiert, true);
  assert.deepEqual(result.unsichereFenster, [{ hwnd: 0, pid: 99, cls: "", title: "", art: "nicht-lesbar", x: 0, y: 0, w: 0, h: 0, buttons: [], texte: [],
    fingerprint: null, uiaReadOk: false, uiaError: UNTITLED_MODAL_HINT, msaaReadOk: null, msaaError: null }]);
  assert.equal(result.fensterAnzahl, 2);
  assert.equal(result.rat, "Mindestens ein unbekanntes oder nicht lesbares SSE-Fenster ist offen. Zustand gilt als blockiert; per Screenshot/manuell klaeren.");
  assert.notEqual(result.stateFingerprint, cleanFingerprint);
  assert.deepEqual(result.dialoge, []);
}

// A catalogued nonmodal tool window is the worker's 'unbekannt' kind without a UIA/MSAA read; a disabled main
// window beside it still points at a modal this path cannot name, so the synthetic entry follows.
const receiptEntry = { hwnd: 87, pid: 99, cls: "Qt692QWindowIcon", title: "BelegManager", art: "unbekannt",
  x: 100, y: 100, w: 800, h: 500, buttons: [], texte: [], fingerprint: null, uiaReadOk: false, uiaError: null, msaaReadOk: false, msaaError: null };
{
  const { client } = fakeClient([MAIN_WINDOW, RECEIPT_WINDOW], mainSpec(mainTree(cleanNames), { windowEnabled: false }));
  const result = await executeQtNativeUiState(client, {}, 5000, undefined, profile);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unsichereFenster, [receiptEntry, { hwnd: 0, pid: 99, cls: "", title: "", art: "nicht-lesbar", x: 0, y: 0, w: 0, h: 0,
    buttons: [], texte: [], fingerprint: null, uiaReadOk: false, uiaError: UNTITLED_MODAL_HINT, msaaReadOk: null, msaaError: null }]);
  assert.equal(result.fensterAnzahl, 2);
  assert.equal(result.blockiert, true);
}
// A titled window outside the catalogue is unreadable; an untitled non-transient window keeps its real identity.
{
  const untitledWindow = { hwnd: 90, pid: 99, class: "Qt692QWindow", x: 50, y: 50, w: 300, h: 200, minimized: false, hung: false };
  const { client } = fakeClient([MAIN_WINDOW, RECEIPT_WINDOW, window(89, "Datei öffnen", [10, 10, 500, 400], { class: "#32770" })],
    mainSpec(mainTree(cleanNames)), [], { visibleWindowCount: 6, untitledWindows: [untitledWindow] });
  const result = await executeQtNativeUiState(client, {}, 5000, undefined, profile);
  assert.equal(result.ok, true);
  assert.equal(result.blockiert, true);
  assert.equal(result.fensterAnzahl, 6);
  assert.deepEqual(result.unsichereFenster, [
    receiptEntry,
    { hwnd: 89, pid: 99, cls: "#32770", title: "Datei öffnen", art: "nicht-lesbar", x: 10, y: 10, w: 500, h: 400, buttons: [], texte: [],
      fingerprint: null, uiaReadOk: false, uiaError: UNREADABLE_HINT, msaaReadOk: null, msaaError: null },
    { hwnd: 90, pid: 99, cls: "Qt692QWindow", title: "", art: "nicht-lesbar", x: 50, y: 50, w: 300, h: 200, buttons: [], texte: [],
      fingerprint: null, uiaReadOk: false, uiaError: UNTITLED_WINDOW_HINT, msaaReadOk: null, msaaError: null },
  ]);
}
// A Steuer-Spar-Tipps window beyond the tool-window bound keeps its kind by title alone, exactly like Get-DialogDescriptor.
{
  const { client } = fakeClient([MAIN_WINDOW, window(85, "Steuer-Spar-Tipps", [0, 0, 900, 700])], mainSpec(mainTree(cleanNames)));
  const result = await executeQtNativeUiState(client, {}, 5000, undefined, profile);
  assert.equal(result.blockiert, false);
  assert.deepEqual(result.nichtmodaleFenster.map(entry => [entry.art, entry.uiaReadOk, entry.uiaError, entry.msaaReadOk]),
    [["steuer-tipps", false, null, false]]);
}

// Truncation is reported, not hidden, exactly as the worker does.
{
  const truncatedNodes = mainTree(cleanNames);
  const { client } = fakeClient([MAIN_WINDOW], { ...mainSpec(truncatedNodes), stats: { ...stats(truncatedNodes.length), truncated: true } });
  const result = await executeQtNativeUiState(client, {}, 5000, undefined, profile);
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot, { source: "qt", nodes: 29, truncated: true, cycles: 0, snapshotMs: 7 });
}

// Fail-closed guards.
{
  const { client, log } = fakeClient([WERTE_WINDOW], mainSpec(mainTree(cleanNames)));
  assert.deepEqual(await executeQtNativeUiState(client, {}, 5000, undefined, profile),
    { ok: false, backend: "qt", kind: "stale-window", error: "Das angegebene hwnd ist kein aktuelles Hauptfenster." });
  assert.deepEqual(log.map(entry => entry.operation), ["window_inventory"]);
}
{
  const { client, log } = fakeClient([MAIN_WINDOW], mainSpec(mainTree(cleanNames)));
  await assert.rejects(executeQtNativeUiState(client, { hwnd: 43 }, 5000, undefined, profile),
    error => error instanceof QtNativeTransportError && error.kind === "stale-window");
  assert.deepEqual(log, []);
  assert.deepEqual(await executeQtNativeUiState(client, {}, 5000, undefined, undefined),
    { ok: false, backend: "qt", kind: "bad-args", error: "ui_state requires a product profile." });
  assert.deepEqual(log, []);
}
{
  const { client, log } = fakeClient([{ ...MAIN_WINDOW, minimized: true }], mainSpec(mainTree(cleanNames)));
  assert.deepEqual(await executeQtNativeUiState(client, {}, 5000, undefined, profile), { ok: false, backend: "qt", kind: "minimized",
    error: "Das gebundene SSE-Hauptfenster ist minimiert; der direkte Qt-Pfad stellt es nicht wieder her." });
  assert.deepEqual(log.map(entry => entry.operation), ["window_inventory"]);
}
{
  const { client } = fakeClient([{ ...MAIN_WINDOW, pid: 98 }], mainSpec(mainTree(cleanNames)));
  await assert.rejects(executeQtNativeUiState(client, {}, 5000, undefined, profile),
    error => error instanceof QtNativeTransportError && error.kind === "native-contract");
}
{
  const { client, log } = fakeClient([MAIN_WINDOW, WERTE_WINDOW, { ...WERTE_WINDOW, hwnd: 88 }], mainSpec(mainTree(cleanNames)),
    [[WERTE_INFO_TITLE, werteSpec()]]);
  assert.deepEqual(await executeQtNativeUiState(client, {}, 5000, undefined, profile),
    { ok: false, backend: "qt", kind: "ambiguous", error: "Werte-Info ist nicht eindeutig." });
  assert.deepEqual(log.map(entry => entry.operation), ["window_inventory", "accessibility_snapshot"]);
}
{
  const { client } = fakeClient([MAIN_WINDOW, WERTE_WINDOW], mainSpec(mainTree(cleanNames)), [[WERTE_INFO_TITLE, { ...werteSpec(), hwnd: 85 }]]);
  await assert.rejects(executeQtNativeUiState(client, {}, 5000, undefined, profile),
    error => error instanceof QtNativeTransportError && error.kind === "native-contract");
}
{
  const { client } = fakeClient([MAIN_WINDOW, WERTE_WINDOW], mainSpec(mainTree(cleanNames)), [[WERTE_INFO_TITLE, werteSpec()]]);
  await assert.rejects(executeQtNativeUiState(client, {}, 0, undefined, profile),
    error => error instanceof QtNativeTransportError && error.kind === "native-timeout");
}
// A Werte-Info wider than the tool-window bound is no tool window; the catalogue makes it the worker's 'unbekannt' kind.
{
  const { client, log } = fakeClient([MAIN_WINDOW, { ...WERTE_WINDOW, w: 901 }], mainSpec(mainTree(cleanNames)));
  const result = await executeQtNativeUiState(client, {}, 5000, undefined, profile);
  assert.equal(result.ok, true);
  assert.equal(result.blockiert, true);
  assert.deepEqual(result.unsichereFenster.map(entry => [entry.hwnd, entry.art, entry.uiaError, entry.msaaReadOk]), [[84, "unbekannt", null, false]]);
  assert.equal(result.ergebnis.fensterOffen, false);
  assert.deepEqual(log.map(entry => entry.operation), ["window_inventory", "accessibility_snapshot"]);
}

console.log("qt-native-ui-state-projection: 15 scenarios passed");
