import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS } from "./api-contract.js";
import { QtNativeTransportError } from "./qt-native-client.js";
import type { QtNativeRuntime } from "./qt-native-runtime.js";
import type { ScenarioExecutor } from "./scenario.js";

/** Keep worker mutations behind retained broker ownership without masking a proven worker result. */
export function withQtNativeLifecycle(worker: ScenarioExecutor, native: QtNativeRuntime): ScenarioExecutor {
  let active = false;
  return async (operation, args, timeoutMs, signal) => {
    if (active) return { ok: false, kind: "busy", error: "A native-managed worker operation is already running.",
      outcomeUnknown: false, mutationStarted: false, resultingState: "unchanged" };
    active = true;
    try {
      const budget = timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
      const started = performance.now();
      let remaining: number;
      try {
        await native.beforeWorker(budget, signal);
        remaining = Math.floor(budget - (performance.now() - started));
        if (remaining < 1) throw new QtNativeTransportError("Worker deadline exceeded before submission.", "native-timeout");
      } catch (error) {
        return { ok: false, backend: "qt", outcomeUnknown: false,
          kind: error instanceof QtNativeTransportError ? error.kind : "native-retirement-unproven",
          error: error instanceof QtNativeTransportError ? error.message : "Native cleanup failed before worker submission." };
      }
      const result = await worker(operation, args, remaining, signal);
      await native.afterWorker(operation, result, args);
      return result;
    } finally { active = false; }
  };
}
