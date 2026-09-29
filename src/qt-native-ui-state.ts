import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { qtNativeContentBounds, qtNativeHeading } from "./qt-native-pages.js";
import {
  auxiliaryWindowKind, byWindowArea, checkerResultComplete, checkerResults, dirtyState, isSystemOverlay, powershellCompactJson, psEquals,
  readProcessWindowInventory, resultDetailsFromNodes, splitWindowScope, textSha256, TIPS_TITLE, WERTE_INFO_TITLE,
  type QtProcessWindow, type QtUntitledWindow,
} from "./qt-native-projections.js";
import { nativeTreeBoundReason, readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

/**
 * Direct Qt port of the worker's 'ui_state' branch. One window inventory and
 * one content snapshot of the bound main window replace the UIA walk; an open
 * Werte-Info is read through its own tool snapshot. Foreign dialogs are never
 * fingerprinted here: a window this path cannot classify is reported as
 * unreadable, which keeps the state blocked exactly as the worker would.
 */

// The worker's -notin list; compared case-insensitively like PowerShell.
const PRUEFER_EXCLUDED = ["Eingabehilfe", "Steuertipps", "Prüfer", "Mehr Details", "Steuer-Spar-Tipps", "Zurzeit keine Hinweise zu diesem Dialog."]
  .map(name => name.toLowerCase());
const UNREADABLE_HINT = "Der direkte Qt-Pfad liest fremde Dialoge und unbekannte Fenster nicht; mit sse_dialog_list oder sse_windows pruefen.";
const UNTITLED_WINDOW_HINT = "Ein namenloses Fenster des gebundenen Prozesses ist sichtbar; der direkte Qt-Pfad liest es nicht.";

interface UiStateWindow {
  hwnd: number; pid: number; cls: string; title: string; art: string;
  x: number; y: number; w: number; h: number;
  buttons: never[]; texte: never[]; fingerprint: null;
  uiaReadOk: boolean | null; uiaError: string | null; msaaReadOk: boolean | null; msaaError: null;
}

const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });
const unique = (values: string[]) => [...new Set(values)];

function windowEntry(
  window: QtUntitledWindow & { title?: string }, art: string,
  uiaReadOk: boolean | null, uiaError: string | null, msaaReadOk: boolean | null,
): UiStateWindow {
  return {
    hwnd: window.hwnd, pid: window.pid, cls: window.class, title: window.title ?? "", art,
    x: window.x, y: window.y, w: window.w, h: window.h, buttons: [], texte: [], fingerprint: null,
    uiaReadOk, uiaError, msaaReadOk, msaaError: null,
  };
}

/**
 * The worker's classification of an auxiliary window: Resolve-SSEToolWindowKind first, then the
 * descriptor kinds it decides without a UIA/MSAA read ('main' for a second wide case window,
 * 'tips' by title, 'known-nonmodal' from the catalogue; all art 'unbekannt' or 'steuer-tipps'),
 * and finally everything this path cannot describe as unreadable.
 */
function classifiedEntry(window: QtProcessWindow, profile: ProductProfile): UiStateWindow {
  const kind = auxiliaryWindowKind(window, profile);
  if (kind === "werte-info" || kind === "steuer-tipps" || kind === "system-overlay") return windowEntry(window, kind, null, null, null);
  if (kind === "case-window") return windowEntry(window, "unbekannt", false, null, false);
  if (psEquals(window.title, TIPS_TITLE)) return windowEntry(window, "steuer-tipps", false, null, false);
  if (kind === "known-nonmodal") return windowEntry(window, "unbekannt", false, null, false);
  return windowEntry(window, "nicht-lesbar", false, UNREADABLE_HINT, null);
}

// Sort-Object y, aid: numeric y, then a culture-aware case-insensitive string order.
const byRequiredField = (a: { y: number; aid: string }, b: { y: number; aid: string }) =>
  a.y - b.y || a.aid.localeCompare(b.aid, "de", { sensitivity: "accent" });

/** A consistent read-only state snapshot of the bound main window without a PowerShell worker. */
export async function executeQtNativeUiState(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  if (!profile) return fail("bad-args", "ui_state requires a product profile.");
  if (args.hwnd !== undefined && args.hwnd !== client.binding.hwnd) {
    throw new QtNativeTransportError("Requested window differs from the verified native session.", "stale-window");
  }
  const started = performance.now();
  const budget = () => {
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native ui_state deadline expired before reading.", "native-timeout");
    return remaining;
  };
  const inventory = await readProcessWindowInventory(client, budget(), signal);
  let nativeDurationMs = inventory.durationMs;
  const main = inventory.windows.find(window => window.hwnd === client.binding.hwnd);
  if (!main) return fail("stale-window", "Das angegebene hwnd ist kein aktuelles Hauptfenster.");
  if (main.pid !== client.binding.pid) throw new QtNativeTransportError("The bound main window belongs to another process.", "native-contract");
  // The worker restores a minimized main window before reading; this read-only path never moves a window.
  if (main.minimized) return fail("minimized", "Das gebundene SSE-Hauptfenster ist minimiert; der direkte Qt-Pfad stellt es nicht wieder her.");

  const mainSnapshot = await readQtNativeSnapshot(client, { hwnd: client.binding.hwnd, maxNodes: 5000 }, budget(), signal);
  nativeDurationMs += mainSnapshot.nativeDurationMs;
  // The worker treats an empty bulk snapshot as a failed read, never as a free window.
  if (!mainSnapshot.nodes.length) return fail("native-incomplete", "Der native Seitenbaum ist leer; kein Zustand ausgegeben.");
  // Qt's depth bound is lower than the worker's checker walk. No successful
  // state or decision fingerprint may be derived from a partial native tree.
  if (mainSnapshot.stats.truncated) {
    return fail("native-incomplete", `${nativeTreeBoundReason(mainSnapshot.stats)}; kein Zustand ausgegeben.`);
  }

  // Only windows of the bound process may shape this case's state and fingerprint; the worker's
  // enumerator lists them largest first, and an untitled window is one it would read but this path cannot.
  type ProcessWindowRef = { window: QtProcessWindow; untitled: false } | { window: QtUntitledWindow; untitled: true };
  const processWindows: ProcessWindowRef[] = [
    ...inventory.windows.filter(window => window.pid === main.pid).map(window => ({ window, untitled: false as const })),
    ...inventory.untitledWindows.filter(window => window.pid === main.pid).map(window => ({ window, untitled: true as const })),
  ].sort((left, right) => byWindowArea(left.window, right.window));
  const fenster: UiStateWindow[] = processWindows.map(entry => entry.untitled
    ? isSystemOverlay(entry.window) ? windowEntry(entry.window, "system-overlay", null, null, null)
      : windowEntry(entry.window, "nicht-lesbar", false, UNTITLED_WINDOW_HINT, null)
    : entry.window.hwnd === main.hwnd ? windowEntry(entry.window, "hauptfenster", true, null, null) : classifiedEntry(entry.window, profile));
  const obstructed = mainSnapshot.modalBlocked || !mainSnapshot.windowEnabled;
  // The worker only ever lists enumerated windows. A blocked main window without any listed unreadable or
  // unknown window means a modal this inventory cannot see; nothing is invented for it.
  if (obstructed && !fenster.some(window => window.art === "nicht-lesbar" || window.art === "unbekannt")) {
    return fail("dialog-open", "Das gebundene Hauptfenster ist durch einen nicht inventarisierten modalen Dialog blockiert; der direkte Qt-Pfad liest ihn nicht.");
  }

  // The worker reads the Werte-Info table from its UIA walk whatever the window's size; the
  // descriptor kind only names the window, so the window to read is chosen by its exact title.
  const werteInfo = inventory.windows.filter(window => window.pid === main.pid && psEquals(window.title, WERTE_INFO_TITLE));
  if (werteInfo.length > 1) return fail("ambiguous", "Werte-Info ist nicht eindeutig.");

  // The worker's UIA walk also contains owned nonmodal windows; the Qt tree of the main window does
  // not, so page checker, tree errors and empty mandatory fields are read from the main window only.
  const own: QtSnapshotNode[] = splitWindowScope(mainSnapshot.nodes).own;
  const bounds = qtNativeContentBounds(own, mainSnapshot.windowRect);
  const heading = qtNativeHeading(own, profile);
  const checker = checkerResults(own);
  const steuerpruefer = { ...checker, konsistent: checkerResultComplete(checker) };
  const pruefer = unique(own
    .filter(node => node.type === "TreeItem" && node.name && node.x > bounds.maxX && node.name.length < 90)
    .map(node => node.name)
    .filter(name => !PRUEFER_EXCLUDED.includes(name.toLowerCase())));
  const baumfehler = unique(own
    .filter(node => node.type === "TreeItem" && node.name && node.x < bounds.minX && /!\s*$/u.test(node.name)
      && !node.aid.toLowerCase().includes("prueferwidgetsse"))
    .map(node => node.name));
  const leerePflicht = own
    .filter(node => node.type === "ComboBox" && node.x >= bounds.minX && node.x <= bounds.maxX && !(node.val ?? "").trim())
    .map(node => ({ y: node.y, aid: node.aid.split(".").at(-1) ?? "", rid: node.rid }));
  const dirty = dirtyState(own);

  let ergebnis = resultDetailsFromNodes(own, mainSnapshot.stats);
  if (werteInfo.length === 1) {
    const tool = await readQtNativeSnapshot(client, { maxNodes: 5000, toolTitle: werteInfo[0]!.title }, budget(), signal);
    nativeDurationMs += tool.nativeDurationMs;
    if (tool.hwnd !== werteInfo[0]!.hwnd) throw new QtNativeTransportError("The Werte-Info snapshot returned another window.", "native-contract");
    // The inventory proves the window; a tree without its table is 'open but unreadable', never 'not open'.
    ergebnis = resultDetailsFromNodes(tool.nodes, tool.stats, true);
  }

  // This path never fingerprints a foreign dialog, so 'dialog'/'warnung' cannot occur here.
  const dialoge: UiStateWindow[] = [];
  const unsicher = fenster.filter(window => window.art === "unbekannt" || window.art === "nicht-lesbar");
  const nichtmodal = fenster.filter(window => window.art === "werte-info" || window.art === "steuer-tipps");
  const blockiert = unsicher.length > 0 || pruefer.length > 0 || baumfehler.length > 0;

  // Key order mirrors the worker's $stateCore exactly; the fingerprint hashes these bytes.
  const stateCore = {
    instance: { pid: main.pid, hwnd: main.hwnd },
    heading, dirty, blockiert,
    dialogs: [],
    uncertain: unsicher.map(window => ({
      hwnd: window.hwnd, cls: window.cls, title: window.title, art: window.art,
      uiaReadOk: window.uiaReadOk, uiaError: window.uiaError, msaaReadOk: window.msaaReadOk, msaaError: window.msaaError,
    })),
    windowKinds: fenster.filter(window => window.art !== "system-overlay" && window.art !== "shadow").map(window => window.art).sort(),
    pruefer, baumfehler,
    leerePflicht: [...leerePflicht].sort(byRequiredField).map(field => field.aid),
    checker: {
      aktiv: checker.aktiv, fragen: checker.fragenWarnungenAngekuendigt, tipps: checker.tippsAngekuendigt, konsistent: steuerpruefer.konsistent,
    },
    ergebnisFingerprint: ergebnis.fingerprint,
  };
  const stateFingerprint = textSha256(powershellCompactJson(stateCore));
  const previous = args.previousFingerprint === undefined || args.previousFingerprint === null ? "" : String(args.previousFingerprint);
  const changedSince = previous ? !psEquals(previous, stateFingerprint) : null;

  const rat = unsicher.length
    ? "Mindestens ein unbekanntes oder nicht lesbares SSE-Fenster ist offen. Zustand gilt als blockiert; per Screenshot/manuell klaeren."
    : pruefer.length || baumfehler.length
      ? `Der Seitenpruefer verlangt Angaben: ${[...pruefer, ...baumfehler].join("; ")}. Erst klaeren, dann navigieren.`
      : checker.aktiv && steuerpruefer.konsistent
        ? `Globaler Steuerpruefer aktiv: ${checker.fragenWarnungenAngekuendigt} Fragen/Warnungen und ${checker.tippsAngekuendigt} Tipps.`
        : checker.aktiv
          ? "Globaler Steuerpruefer aktiv, aber Qt liefert keinen vollstaendigen konsistenten Baum; gezielt oder per Screenshot kontrollieren."
          : !ergebnis.verfuegbar
            ? "frei; fuer Ergebniswerte einmal sse_result_details oeffnen, danach kommen sie in jedem sse_ui_state mit."
            : "frei";

  return {
    ok: true,
    running: true,
    instance: { pid: main.pid, hwnd: main.hwnd, title: main.title },
    stateFingerprint,
    changedSince,
    heading,
    blockiert,
    dialoge,
    unsichereFenster: unsicher,
    prueferMeldungen: pruefer,
    baumFehler: baumfehler,
    leerePflichtfelder: leerePflicht,
    steuerpruefer,
    ungespeichert: dirty,
    ergebnis,
    // Get-Windows counts every visible window of the process, shadows and tooltips included.
    fensterAnzahl: inventory.visibleWindowCount,
    warnfensterAnzahl: 0,
    nichtmodaleFenster: nichtmodal,
    snapshot: { source: "qt", nodes: mainSnapshot.stats.n, truncated: mainSnapshot.stats.truncated, cycles: 0, snapshotMs: mainSnapshot.stats.snapshotMs },
    rat,
    backend: "qt",
    nativeDurationMs,
  };
}
