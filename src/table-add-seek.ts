import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import type { ScenarioExecutor } from "./scenario.js";
import type { QtNativeExecutorDependencies } from "./qt-native-executor.js";
import { executeTableCursorRead } from "./table-cursor-executor.js";
import { tableAddCursorFailure } from "./table-add-cursor-result.js";

/** One guarded seek and one write, sharing the original append deadline. */
export async function executeTableAddSeek(original: WorkerResult, args: Record<string, unknown>,
  readArgs: Record<string, unknown>, worker: ScenarioExecutor, dependencies: QtNativeExecutorDependencies,
  timeoutMs: number | undefined, startedAt: number, signal?: AbortSignal): Promise<WorkerResult> {
  if (original.mutationStarted !== false || original.outcomeUnknown === true
    || original.reconciliationRequired === true || original.cleanupRequired === true) {
    return tableAddCursorFailure(original, { ok: false, kind: "cursor-proof-failed",
      phase: "prebind", proofCheck: "append-no-mutation-proof",
      outcomeUnknown: original.mutationStarted !== false || original.outcomeUnknown === true || original.cleanupRequired === true });
  }
  const remaining = () => Math.max(0, Math.floor((timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS) - (performance.now() - startedAt)));
  const deadline = (phase: string, cursor?: WorkerResult) => tableAddCursorFailure(original, {
    ...(cursor ?? { cleanupRequired: false, physicalInputAttempted: false, physicalInputUsed: false }),
    ok: false, kind: signal?.aborted ? "aborted" : "timeout", phase, proofCheck: "cursor-deadline", outcomeUnknown: false,
  });
  const cursorBudget = remaining();
  if (cursorBudget < 1 || signal?.aborted) return deadline("prebind");
  const scrolled = await executeTableCursorRead(readArgs, worker, dependencies, cursorBudget, signal, true)
    .catch((): WorkerResult => ({ ok: false, kind: "cursor-proof-failed", proofCheck: "cursor-transport-error",
      outcomeUnknown: true, reconciliationRequired: true, cleanupRequired: true }));
  if (scrolled.ok !== true || scrolled.vollstaendig !== true || scrolled.outcomeUnknown === true
    || scrolled.reconciliationRequired === true || scrolled.cleanupRequired === true) {
    return tableAddCursorFailure(original, scrolled);
  }
  const appendBudget = remaining();
  if (appendBudget < 1 || signal?.aborted) return deadline("passive-final-checkpoint", scrolled);
  const retried = await worker("table_add", args, appendBudget, signal);
  const inputSources = [original, scrolled, retried];
  const cursorKeysUsed = typeof scrolled.steps === "number" && scrolled.steps > 0;
  const inputFlag = (key: string) => {
    if (cursorKeysUsed || inputSources.some(source => source[key] === true)
      || key === "physicalInputAttempted" && inputSources.some(source => source.physicalInputUsed === true)) return true;
    return inputSources.every(source => source[key] === false) ? false : null;
  };
  return { ...retried, physicalInputUsed: inputFlag("physicalInputUsed"), physicalInputAttempted: inputFlag("physicalInputAttempted"),
    freeRowSearch: { retriedAfterTableWalk: true, rowsWalked: scrolled.anzahl ?? null } };
}
