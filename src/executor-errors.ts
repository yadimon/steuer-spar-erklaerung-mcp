import type { SseApiOperation, WorkerResult } from "./api-contract.js";
import { ZodError } from "zod";

export class ExecutorArgumentError extends Error {
  override readonly name = "ExecutorArgumentError";
}

export function operationError(error: string, kind = "operation"): WorkerResult {
  return { ok: false, kind, error };
}

export function executionError(operation: SseApiOperation, error: unknown): WorkerResult {
  const explicitKind =
    error && typeof error === "object" && typeof (error as { kind?: unknown }).kind === "string"
      ? String((error as { kind: string }).kind)
      : undefined;
  return {
    ok: false,
    kind:
      explicitKind ??
      (error instanceof ZodError || error instanceof ExecutorArgumentError
        ? "bad-args"
        : operation.startsWith("workspace_") || operation === "scenario_run"
          ? "workspace"
          : "worker"),
    error: error instanceof Error ? error.message : String(error),
  };
}
