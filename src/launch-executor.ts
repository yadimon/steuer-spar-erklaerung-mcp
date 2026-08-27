import { asArray, type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { operationError } from "./executor-errors.js";
import type { ScenarioExecutor } from "./scenario.js";

const MINIMUM_LAUNCH_TIMEOUT_MS = 30_000;
// Der Skill empfiehlt fuer den ersten sichtbaren Start auf langsamen PCs und in
// VMs ausdruecklich 280 Sekunden. Eine Obergrenze darunter haette diesen Wert
// stillschweigend gekappt und den dokumentierten Weg unerreichbar gemacht.
const MAXIMUM_LAUNCH_TIMEOUT_MS = 300_000;

/**
 * SteuerSparErklaerung haengt nach einem unsauberen Ende `(Wiederhergestellt)`
 * an den Fenstertitel, sobald es eine Wiederherstellungsdatei geladen hat.
 */
const RECOVERED_STATE_TITLE = /\(Wiederhergestellt\)/iu;
/**
 * Ein Fallfenster ist breit. Schmaler als das ist entweder der Startbildschirm
 * oder ein Qt-Meldungsfenster - beide tragen denselben Programmtitel wie ein
 * Fallfenster und duerfen deshalb nie als Hauptfenster gebunden werden.
 * Live gemessen: Startbildschirm 854 Pixel, Wiederherstellungsfrage 518 Pixel,
 * Fallfenster 2062 Pixel.
 */
const MIN_MAIN_WINDOW_WIDTH = 900;

interface LaunchProbePlan {
  schemaVersion: 1;
  planKind: "launch-readiness";
  pid: number;
  hasCase: boolean;
  deadlineUnixMs: number;
}

/** Interne Worker-Oberflaeche; launch_probe ist absichtlich keine API-Operation. */
type LaunchWorkerExecutor = (
  operation: SseApiOperation | "launch_probe",
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
) => Promise<WorkerResult>;

export async function executeLaunchOperation(
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  worker: ScenarioExecutor,
): Promise<WorkerResult> {
  if (timeoutMs !== undefined && timeoutMs < MINIMUM_LAUNCH_TIMEOUT_MS) {
    return operationError(
      `SSE-Start verlangt timeoutMs >= ${MINIMUM_LAUNCH_TIMEOUT_MS}, damit nach dem Prozessstart eine PID- und Fensterbindung moeglich bleibt.`,
      "bad-args",
    );
  }

  const startedAt = Date.now();
  const launchBudgetMs = Math.min(timeoutMs ?? MAXIMUM_LAUNCH_TIMEOUT_MS, MAXIMUM_LAUNCH_TIMEOUT_MS);
  const deadline = startedAt + launchBudgetMs;
  const started = await worker("launch", args, MINIMUM_LAUNCH_TIMEOUT_MS, signal);
  if (started.ok === false) return started;

  const pid = Number(started.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return operationError(
      "SSE-Start lieferte keine verifizierbare PID; Zustand vor Wiederholung manuell pruefen.",
      "startup-pid",
    );
  }

  const cleanupStartedProcess = async (): Promise<{
    cleanup: WorkerResult;
    stillRunning: boolean;
    cleanupError?: string;
  }> => {
    let cleanup: WorkerResult = { ok: false, kind: "cleanup-not-run", error: "Cleanup wurde nicht ausgefuehrt." };
    const errors: string[] = [];
    try {
      cleanup = await worker("close", { pid, force: true, discardChanges: true }, 30_000);
    } catch (error) {
      errors.push(`close: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Unbekannter Status gilt fail-closed als weiterhin laufend. Erst beide
    // realen product_info-Listen mit garantiert fehlender PID beweisen Cleanup.
    let stillRunning = true;
    try {
      const status = await worker("product_info", {}, 30_000);
      if (
        status.ok === true &&
        Object.hasOwn(status, "supportedRunning") &&
        Object.hasOwn(status, "ignoredRunning")
      ) {
        const running = [
          ...asArray<Record<string, unknown>>(status.supportedRunning),
          ...asArray<Record<string, unknown>>(status.ignoredRunning),
        ];
        stillRunning = running.some((entry) => Number(entry.pid) === pid);
      } else {
        errors.push("product_info: Prozessstatus war unvollstaendig.");
      }
    } catch (error) {
      errors.push(`product_info: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      cleanup,
      stillRunning,
      ...(errors.length ? { cleanupError: errors.join(" ") } : {}),
    };
  };

  let lastProbeError: string | undefined;
  let probeFailures = 0;
  let lastStartupPrompts: Record<string, unknown>[] = [];
  try {
    if (signal?.aborted) {
      const cleanupState = await cleanupStartedProcess();
      return {
        ok: false,
        kind: cleanupState.stillRunning ? "startup-abort-cleanup" : "aborted",
        error: cleanupState.stillRunning
          ? `API-Client brach den Start ab; die exakt gestartete SSE-PID ${pid} laeuft trotz Cleanup noch.`
          : "API-Client hat den Start abgebrochen; die exakt gestartete SSE-PID wurde ohne Speichern beendet.",
        pid,
        processStillRunning: cleanupState.stillRunning,
        cleanup: cleanupState.cleanup,
        cleanupError: cleanupState.cleanupError,
        effectiveTimeoutMs: launchBudgetMs,
      };
    }

    let observed: WorkerResult = { ok: true, outcome: "deadline", windows: [], dialogs: [] };
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1_000) break;
      const launchProbePlan = {
        schemaVersion: 1,
        planKind: "launch-readiness",
        pid,
        hasCase: typeof args.file === "string" && args.file.length > 0,
        deadlineUnixMs: deadline,
      } satisfies LaunchProbePlan;
      // launch_probe ist ein privater Worker-Vertrag und deshalb bewusst kein
      // SseApiOperation. Der Cast bleibt an genau dieser internen Grenze.
      observed = await (worker as LaunchWorkerExecutor)("launch_probe", launchProbePlan, remainingMs, signal);
      if (observed.ok === false) {
        lastProbeError = `launch_probe: ${String(observed.error ?? observed.kind ?? "Startinventur fehlgeschlagen.")}`;
        probeFailures += 1;
        break;
      }
      const reportedFailures = Number(observed.probeFailures);
      if (Number.isSafeInteger(reportedFailures) && reportedFailures >= 0) probeFailures += reportedFailures;
      if (typeof observed.lastProbeError === "string" && observed.lastProbeError.length > 0) {
        lastProbeError = observed.lastProbeError;
      }
      if (observed.outcome === "observed" || observed.outcome === "deadline") break;
      if (observed.outcome !== "retry-fresh") {
        lastProbeError = "launch_probe: Worker lieferte keinen bekannten Probe-Ausgang.";
        probeFailures += 1;
        observed = { ok: false, kind: "launch-probe-contract", error: lastProbeError };
        break;
      }

      // Nach einer UIA-Ausnahme gilt auch eine rein lesende Verbindung als
      // vergiftet. Der Worker beendet sich deshalb selbst und nur ein neuer
      // launch_probe darf innerhalb derselben absoluten Frist weiterpollten.
      if (observed.windowProbeSucceeded === true) {
        lastStartupPrompts = asArray<Record<string, unknown>>(observed.startupPrompts)
          .filter((window) => Number(window.pid) === pid && Number(window.hwnd) > 0);
      }
      if (!signal?.aborted) await waitForNextProbe();
    }

    const terminalProbeResult = observed.ok === true && ["observed", "deadline"].includes(String(observed.outcome));
    const windows = (terminalProbeResult ? asArray<Record<string, unknown>>(observed.windows) : [])
      .filter((window) => Number(window.pid) === pid && Number(window.hwnd) > 0);
    const hasCase = typeof args.file === "string" && args.file.length > 0;
    const titledLikeSse = windows.filter((window) => {
      const title = String(window.title ?? "");
      return title.includes("SteuerSparErklärung") || (!hasCase && title === "Steuerprogramm");
    });
    // Qts Meldungsfenster tragen denselben Programmtitel wie das Fallfenster.
    // Die Startrueckfrage nach einer Wiederherstellungsdatei ist rund 520
    // Pixel breit; ein Fallfenster ist es nie. Ohne diese Groessenpruefung
    // band der Start diese Box als Hauptfenster und meldete ready=true,
    // waehrend die Frage noch offen stand - genau der Zustand, vor dem der
    // Skill warnt, denn ein 'Ja' laedt Daten, die zum geprueften Hash nicht
    // mehr passen.
    const mainCandidates = titledLikeSse
      .filter((window) => Number(window.w) >= MIN_MAIN_WINDOW_WIDTH || window.minimiert === true)
      .sort((left, right) => Number(right.w) * Number(right.h) - Number(left.w) * Number(left.h));
    // Der Startbildschirm verschwindet von selbst, eine Rueckfrage nicht.
    // Beide sehen bis dahin gleich aus, deshalb wird hier nur gemerkt statt
    // geraten; entschieden wird erst, wenn das Startbudget abgelaufen ist.
    if (terminalProbeResult) {
      lastStartupPrompts = titledLikeSse.filter((window) => !mainCandidates.includes(window));
    }

    const dialogs = (terminalProbeResult ? asArray<Record<string, unknown>>(observed.dialogs) : [])
      .filter((dialog) => Number(dialog.pid) === pid && ["native-dialog", "qt-dialog"].includes(String(dialog.kind)));

    if (mainCandidates.length > 0 || dialogs.length > 0) {
      const mainCandidate = mainCandidates[0];
      const instance = mainCandidates.length === 1
        ? {
            pid,
            hwnd: Number(mainCandidate!.hwnd),
            title: String(mainCandidate!.title ?? ""),
            bindingMode: "launch-window",
          }
        : null;
      // Laedt SteuerSparErklaerung nach einem unsauberen Ende eine
      // Wiederherstellungsdatei, markiert es das im Fenstertitel. Der
      // geoeffnete Inhalt entspricht dann nicht mehr der zuvor per Hash
      // verifizierten Datei, und ein Report daraus waere fachlich falsch.
      // Deshalb hier fail-closed statt ready=true.
      if (instance && RECOVERED_STATE_TITLE.test(instance.title)) {
        return {
          ok: false,
          kind: "recovered-state",
          error:
            "SteuerSparErklaerung hat eine Wiederherstellungsdatei geladen; der geoeffnete Fall entspricht " +
            "nicht mehr der verifizierten Datei. Fall ohne Speichern schliessen, die Wiederherstellung im " +
            "Programm verwerfen und danach erneut oeffnen.",
          pid,
          windows,
          instance,
          dialogs,
          effectiveTimeoutMs: launchBudgetMs,
          probeFailures,
        };
      }
      return {
        ...started,
        waitedSec: Math.round((Date.now() - startedAt) / 100) / 10,
        windows,
        instance,
        ready: instance !== null,
        blockedByDialog: dialogs.length > 0,
        dialogs,
        effectiveTimeoutMs: launchBudgetMs,
        probeFailures,
      };
    }

    // Blieb bis zuletzt nur ein schmales Fenster stehen, wartet SteuerSpar-
    // Erklaerung auf eine Antwort - fast immer die Startfrage nach einer
    // Wiederherstellungsdatei nach einem unsauberen Ende. Diesen Prozess zu
    // beenden waere das Schlimmste: der harte Abbruch erzeugt die naechste
    // Wiederherstellungsdatei, und der naechste Start endet genauso.
    if (lastStartupPrompts.length > 0) {
      return {
        ok: false,
        kind: "startup-question",
        error:
          "SteuerSparErklaerung zeigt statt des Fallfensters ein schmales Fenster und wartet auf eine Antwort. " +
          "Meist ist das die Startfrage nach einer Wiederherstellungsdatei nach einem unsauberen Ende. Diese Frage " +
          "im Programm beantworten - eine Wiederherstellung gehoert verworfen, weil ihr Inhalt nicht mehr zur " +
          "geprueften Falldatei passt - und danach erneut oeffnen. Der gestartete Prozess laeuft absichtlich " +
          "weiter; ihn hier zu beenden erzeugte die naechste Wiederherstellungsdatei.",
        pid,
        processStillRunning: true,
        windows: lastStartupPrompts,
        startupPrompts: lastStartupPrompts,
        instance: null,
        ready: false,
        effectiveTimeoutMs: launchBudgetMs,
        lastProbeError,
        probeFailures,
      };
    }

    const cleanupState = await cleanupStartedProcess();
    return {
      ok: false,
      kind: cleanupState.stillRunning ? "startup-timeout-cleanup" : "startup-timeout",
      error: cleanupState.stillRunning
        ? `SSE-PID ${pid} erzeugte kein verifiziertes Fallfenster und konnte nicht sicher beendet werden.`
        : `SSE-PID ${pid} erzeugte innerhalb von ${Math.round((Date.now() - startedAt) / 100) / 10} Sekunden kein verifiziertes Fallfenster; der gestartete Prozess wurde beendet.`,
      pid,
      processStillRunning: cleanupState.stillRunning,
      cleanup: cleanupState.cleanup,
      cleanupError: cleanupState.cleanupError,
      effectiveTimeoutMs: launchBudgetMs,
      lastProbeError,
      probeFailures,
    };
  } catch (error) {
    const cleanupState = await cleanupStartedProcess();
    const kind = error && typeof error === "object" && typeof (error as { kind?: unknown }).kind === "string"
      ? String((error as { kind: string }).kind)
      : "startup-probe";
    if (signal?.aborted || kind === "aborted") {
      return {
        ok: false,
        kind: cleanupState.stillRunning ? "startup-abort-cleanup" : "aborted",
        error: cleanupState.stillRunning
          ? `API-Client brach den Start ab; die exakt gestartete SSE-PID ${pid} laeuft trotz Cleanup noch.`
          : "API-Client hat den Start abgebrochen; die exakt gestartete SSE-PID wurde ohne Speichern beendet.",
        pid,
        processStillRunning: cleanupState.stillRunning,
        cleanup: cleanupState.cleanup,
        cleanupError: cleanupState.cleanupError,
        effectiveTimeoutMs: launchBudgetMs,
      };
    }
    return {
      ok: false,
      kind: cleanupState.stillRunning ? "startup-probe-cleanup" : kind,
      error: cleanupState.stillRunning
        ? `${error instanceof Error ? error.message : String(error)} Die exakt gestartete PID ${pid} laeuft trotz Cleanup noch.`
        : `${error instanceof Error ? error.message : String(error)} Die exakt gestartete PID wurde ohne Speichern beendet.`,
      pid,
      processStillRunning: cleanupState.stillRunning,
      cleanup: cleanupState.cleanup,
      cleanupError: cleanupState.cleanupError,
      effectiveTimeoutMs: launchBudgetMs,
      lastProbeError,
      probeFailures,
    };
  }
}

function waitForNextProbe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250));
}
