import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { qtNativeContentBounds, qtNativeHeading } from "./qt-native-pages.js";
import {
  auxiliaryWindowKind, checkerResultComplete, checkerResults, dirtyState, powershellCompactJson, psEquals,
  readProcessWindowInventory, resultDetailsFromNodes, splitWindowScope, textSha256, type QtProcessWindow,
} from "./qt-native-projections.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

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
const UNTITLED_MODAL_HINT = "Ein modaler Dialog ohne Fenstertitel blockiert das gebundene Hauptfenster; der direkte Qt-Pfad liest ihn nicht.";

interface UiStateWindow {
  hwnd: number; pid: number; cls: string; title: string; art: string;
  x: number; y: number; w: number; h: number;
  buttons: never[]; texte: never[]; fingerprint: null;
  uiaReadOk: boolean | null; uiaError: string | null; msaaReadOk: null; msaaError: null;
}

const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });
const unique = (values: string[]) => [...new Set(values)];

/** Resolve-SSEToolWindowKind plus the UAC overlay rule; a catalogued tool window or anything else is unreadable here. */
function windowKind(window: QtProcessWindow, profile: ProductProfile): string {
  const kind = auxiliaryWindowKind(window, profile);
  return kind === null || kind === "known-nonmodal" ? "nicht-lesbar" : kind;
}

function windowEntry(window: QtProcessWindow, art: string, uiaReadOk: boolean | null, uiaError: string | null): UiStateWindow {
  return {
    hwnd: window.hwnd, pid: window.pid, cls: window.class, title: window.title, art,
    x: window.x, y: window.y, w: window.w, h: window.h, buttons: [], texte: [], fingerprint: null,
    uiaReadOk, uiaError, msaaReadOk: null, msaaError: null,
  };
}

function untitledModalEntry(pid: number): UiStateWindow {
  return {
    hwnd: 0, pid, cls: "", title: "", art: "nicht-lesbar", x: 0, y: 0, w: 0, h: 0, buttons: [], texte: [], fingerprint: null,
    uiaReadOk: false, uiaError: UNTITLED_MODAL_HINT, msaaReadOk: null, msaaError: null,
  };
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

  // Only windows of the bound process may shape this case's state and fingerprint.
  const fenster: UiStateWindow[] = inventory.windows.filter(window => window.pid === main.pid).map(window => {
    if (window.hwnd === main.hwnd) return windowEntry(window, "hauptfenster", true, null);
    const art = windowKind(window, profile);
    return art === "nicht-lesbar" ? windowEntry(window, art, false, UNREADABLE_HINT) : windowEntry(window, art, null, null);
  });
  const obstructed = mainSnapshot.modalBlocked || !mainSnapshot.windowEnabled;
  if (obstructed && !fenster.some(window => window.art === "nicht-lesbar")) fenster.push(untitledModalEntry(main.pid));

  const werteInfo = fenster.filter(window => window.art === "werte-info");
  if (werteInfo.length > 1) return fail("ambiguous", "Werte-Info ist nicht eindeutig.");

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
    ergebnis = resultDetailsFromNodes(tool.nodes, tool.stats);
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
    fensterAnzahl: fenster.length,
    warnfensterAnzahl: 0,
    nichtmodaleFenster: nichtmodal,
    snapshot: { source: "qt", nodes: mainSnapshot.stats.n, truncated: mainSnapshot.stats.truncated, cycles: 0, snapshotMs: mainSnapshot.stats.snapshotMs },
    rat,
    backend: "qt",
    nativeDurationMs,
  };
}
