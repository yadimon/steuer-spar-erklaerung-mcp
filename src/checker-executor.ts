import type { WorkerResult } from "./api-contract.js";

export const CHECKER_OPEN_WORKER_OPERATION = "checker_open_plan" as const;
export const CHECKER_OPEN_PLAN_KIND = "checker-open" as const;

export interface CheckerOpenWorkerPlan extends Record<string, unknown> {
  schemaVersion: 1;
  planKind: typeof CHECKER_OPEN_PLAN_KIND;
  name: string;
  hwnd?: number;
}

type CheckerPlanWorker = (
  operation: typeof CHECKER_OPEN_WORKER_OPERATION,
  args: CheckerOpenWorkerPlan,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<WorkerResult>;

function errorKind(error: unknown): string {
  return error && typeof error === "object" && typeof (error as { kind?: unknown }).kind === "string"
    ? String((error as { kind: string }).kind)
    : "worker";
}

function failedPlan(error: string, kind: string, workerProcessCount: 0 | 1): WorkerResult {
  return {
    ok: false,
    kind,
    error,
    schemaVersion: 1,
    planKind: CHECKER_OPEN_PLAN_KIND,
    resultingState: workerProcessCount === 0 ? "unchanged" : "unknown",
    cleanupRequired: workerProcessCount === 1,
    performance: {
      workerProcessCount,
      internalOperationCount: 0,
      internalTimings: [],
      reusedReadbackCount: 0,
    },
  };
}

/**
 * Kompiliert den oeffentlichen checker_open-Aufruf in genau einen privaten,
 * streng typisierten Workerplan. Der Worker besitzt die UI-Zustandsmaschine;
 * hier gibt es weder frei waehlbare Teiloperationen noch automatische Retries.
 */
export async function executeCheckerOpen(
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  worker: CheckerPlanWorker,
): Promise<WorkerResult> {
  if (typeof args.name !== "string" || !args.name.trim()) throw new Error("'name' fehlt.");
  if (
    args.hwnd !== undefined &&
    (typeof args.hwnd !== "number" || !Number.isSafeInteger(args.hwnd) || args.hwnd < 1)
  ) {
    throw new Error("'hwnd' muss eine positive sichere Ganzzahl sein.");
  }
  if (signal?.aborted) {
    return failedPlan(
      "API-Client hat den Aufruf vor dem Workerstart abgebrochen; kein UI-Zustand wurde geaendert.",
      "aborted",
      0,
    );
  }
  const plan: CheckerOpenWorkerPlan = {
    schemaVersion: 1,
    planKind: CHECKER_OPEN_PLAN_KIND,
    name: args.name,
    ...(args.hwnd === undefined ? {} : { hwnd: args.hwnd }),
  };
  try {
    const result = await worker(
      CHECKER_OPEN_WORKER_OPERATION,
      plan,
      Math.min(timeoutMs ?? 300_000, 300_000),
      signal,
    );
    const performance = result.performance && typeof result.performance === "object" && !Array.isArray(result.performance)
      ? result.performance as Record<string, unknown>
      : {};
    return {
      ...result,
      schemaVersion: 1,
      planKind: CHECKER_OPEN_PLAN_KIND,
      resultingState: typeof result.resultingState === "string"
        ? result.resultingState
        : result.ok === true ? "detail-verified" : "unknown",
      cleanupRequired: typeof result.cleanupRequired === "boolean"
        ? result.cleanupRequired
        : result.ok !== true,
      performance: { ...performance, workerProcessCount: 1 },
      ...(result.ok === true
        ? { kontrollbildEnthalten: typeof result.bildBase64 === "string" && result.bildBase64.length > 0 }
        : {}),
    };
  } catch (error) {
    return failedPlan(
      error instanceof Error ? error.message : String(error),
      errorKind(error),
      1,
    );
  }
}
