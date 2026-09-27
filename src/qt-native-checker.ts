import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { readMainWindowBinding } from "./qt-native-owned-windows.js";
import { checkerResultComplete, checkerResults, dirtyState } from "./qt-native-projections.js";
import { nativeTreeBoundReason, readQtNativeSnapshot } from "./qt-native-snapshot.js";

/**
 * Direct Qt port of the worker's 'checker_results' branch (Read-CheckerComplete
 * over one tree). One content snapshot of the bound main window replaces the
 * UIA walk; the grouped list projection is shared with the ui_state handler.
 * The result stays a pure read: no focus navigation, no card is ever expanded,
 * so the interactive bookkeeping fields are the constants the worker reports.
 * The worker's Resolve-Window restores a minimized main window first because
 * its geometry is unusable; this path fails closed on it instead. Other windows
 * of the process are left alone, exactly as the worker's branch ignores them.
 */

const ACTIVE_HINT = "Fragen/Warnungen und Tipps sind getrennt. Ein Eintrag ist nicht automatisch ein Steuerfehler; mit sse_checker_open den Wortlaut oeffnen.";
const CLOSED_HINT = "Der globale Steuerpruefer ist nicht offen. Zu 'Pruefen und Abgeben' und dann 'Steuererklaerung pruefen' navigieren; dort sse_checker_run aufrufen.";

const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });

export async function executeQtNativeCheckerResults(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  if (!profile) return fail("bad-args", "checker_results requires a product profile.");
  if (args.hwnd !== undefined && args.hwnd !== client.binding.hwnd) {
    throw new QtNativeTransportError("Requested window differs from the verified native session.", "stale-window");
  }
  const started = performance.now();
  const budget = () => {
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native checker_results deadline exceeded before reading.", "native-timeout");
    return remaining;
  };
  const bound = await readMainWindowBinding(client, budget, signal);
  if (bound.failure) return bound.failure;
  const snapshot = await readQtNativeSnapshot(client, { hwnd: args.hwnd, maxNodes: 5000 }, budget(), signal);
  if (!snapshot.windowEnabled || snapshot.modalBlocked) {
    return fail("dialog-open", "Ein modaler Dialog blockiert die gebundene Seite; kein Prueferergebnis ausgegeben.");
  }
  if (snapshot.stats.truncated) {
    return fail("native-incomplete", `${nativeTreeBoundReason(snapshot.stats)}; kein unvollstaendiges Prueferergebnis ausgegeben.`);
  }
  // The worker treats an empty bulk snapshot as a failed read, never as a closed checker.
  if (!snapshot.nodes.length) return fail("native-incomplete", "Der native Seitenbaum ist leer; kein Prueferergebnis ausgegeben.");
  const result = checkerResults(snapshot.nodes);
  return {
    ok: true,
    aktiv: result.aktiv,
    fragenWarnungenAngekuendigt: result.fragenWarnungenAngekuendigt,
    tippsAngekuendigt: result.tippsAngekuendigt,
    fragenWarnungenGruppeGesehen: result.fragenWarnungenGruppeGesehen,
    tippsGruppeGesehen: result.tippsGruppeGesehen,
    fragenWarnungen: result.fragenWarnungen,
    tippsZusatzinfos: result.tippsZusatzinfos,
    sonstige: result.sonstige,
    gesamt: result.gesamt,
    aufgeklappt: result.aufgeklappt,
    konsistent: checkerResultComplete(result),
    navigationSchritte: 0,
    fokusVerwendet: false,
    technischeFokusKarten: [],
    zyklen: [],
    ungespeichert: dirtyState(snapshot.nodes),
    hinweis: result.aktiv ? ACTIVE_HINT : CLOSED_HINT,
    backend: "qt",
    nativeDurationMs: bound.binding.inventory.durationMs + snapshot.nativeDurationMs,
  };
}
