import type { WorkerResult } from "./api-contract.js";

export class ExecutorArgumentError extends Error {
  override readonly name = "ExecutorArgumentError";
}

export function operationError(error: string, kind = "operation"): WorkerResult {
  return { ok: false, kind, error };
}
