import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { executeQtNativeGetValue } from "./qt-native-values.js";
import { executeQtNativeTableRead } from "./qt-native-tables.js";

export interface QtNativeExecutorDependencies {
  /** An explicitly bound session, or its managed lazy provider. */
  qtNativeClient?: QtNativeClient;
  qtNativeClientFor?: (args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal) => Promise<QtNativeClient>;
}

export async function executeQtNativeRead(
  operation: "get_value" | "table_read", args: Readonly<Record<string, unknown>>, dependencies: QtNativeExecutorDependencies,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS, signal?: AbortSignal,
): Promise<WorkerResult> {
  try {
    const started = performance.now();
    const client = dependencies.qtNativeClient ?? await dependencies.qtNativeClientFor!(args, timeoutMs, signal);
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native operation deadline exceeded before reading.", "native-timeout");
    return await (operation === "get_value" ? executeQtNativeGetValue : executeQtNativeTableRead)(client, args, remaining, signal);
  } catch (error) {
    return {
      ok: false, backend: "qt",
      kind: error instanceof QtNativeTransportError ? error.kind : "native-contract",
      outcomeUnknown: error instanceof QtNativeTransportError && error.outcomeUnknown,
      error: error instanceof Error ? error.message : "Invalid native runtime response.",
    };
  }
}
