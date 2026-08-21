import { asArray, type WorkerResult } from "./api-contract.js";
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
  try {
    while (Date.now() < deadline) {
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

      const remainingMs = deadline - Date.now();
      if (remainingMs < 1_000) break;
      let observed: WorkerResult;
      try {
        observed = await worker("windows", {}, Math.min(15_000, Math.max(1_000, remainingMs)), signal);
      } catch (error) {
        lastProbeError = `windows: ${error instanceof Error ? error.message : String(error)}`;
        probeFailures += 1;
        if (!signal?.aborted) await waitForNextProbe();
        continue;
      }
      if (observed.ok === false) {
        lastProbeError = `windows: ${String(observed.error ?? observed.kind ?? "Fensterinventur fehlgeschlagen.")}`;
        probeFailures += 1;
        await waitForNextProbe();
        continue;
      }

      const windows = asArray<Record<string, unknown>>(observed.windows)
        .filter((window) => Number(window.pid) === pid && Number(window.hwnd) > 0);
      const hasCase = typeof args.file === "string" && args.file.length > 0;
      const mainCandidates = windows
        .filter((window) => {
          const title = String(window.title ?? "");
          if (hasCase) return title.includes("SteuerSparErklärung");
          return title.includes("SteuerSparErklärung") ||
            (title === "Steuerprogramm" && (Number(window.w) >= 900 || window.minimiert === true));
        })
        .sort((left, right) => Number(right.w) * Number(right.h) - Number(left.w) * Number(left.h));

      let dialogs: Record<string, unknown>[] = [];
      if (windows.length > 0) {
        let dialogResult: WorkerResult;
        try {
          dialogResult = await worker(
            "dialog_list",
            { pid },
            Math.min(30_000, Math.max(1_000, deadline - Date.now())),
            signal,
          );
        } catch (error) {
          lastProbeError = `dialog_list: ${error instanceof Error ? error.message : String(error)}`;
          probeFailures += 1;
          if (!signal?.aborted) await waitForNextProbe();
          continue;
        }
        if (dialogResult.ok === false) {
          lastProbeError = `dialog_list: ${String(dialogResult.error ?? dialogResult.kind ?? "Dialoginventur fehlgeschlagen.")}`;
          probeFailures += 1;
          await waitForNextProbe();
          continue;
        }
        dialogs = asArray<Record<string, unknown>>(dialogResult.dialogs)
          .filter((dialog) => Number(dialog.pid) === pid && ["native-dialog", "qt-dialog"].includes(String(dialog.kind)));
      }

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
      await waitForNextProbe();
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
