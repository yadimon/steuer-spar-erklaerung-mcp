import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import { ZodError } from "zod";
import { callApiOperationEnvelope, clientSettings, readApiHealthz, type ApiClientOptions } from "./api-client.js";
import { ApiClientError } from "./api-client-error.js";
import { MAX_OPERATION_TIMEOUT_MS, isSseApiOperation, type OperationEnvelope, type WorkerResult } from "./api-contract.js";
import { formatOperationArgumentError, parseApiOperationArgs } from "./operation-catalog.js";
import { withCombinedAbortSignal } from "./abort.js";
import { MINIMUM_LAUNCH_TIMEOUT_MS } from "./launch-executor.js";

export interface BusyRetryOptions {
  maxAttempts?: number;
  delayMs?: number;
}

async function pinClient(options: ApiClientOptions, timeoutMs: number): Promise<ApiClientOptions> {
  options = clientSettings(options);
  if (options.signal?.aborted) throw new ApiClientError("Busy-Wiederholung wurde abgebrochen.", "aborted");
  if (options.expectedInstanceId) return { ...options };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const identity = await withCombinedAbortSignal([options.signal, controller.signal], signal => readApiHealthz({ ...options, signal }));
    return { ...options, expectedInstanceId: identity.instanceId };
  } catch (error) {
    if (options.signal?.aborted) throw new ApiClientError("Busy-Wiederholung wurde abgebrochen.", "aborted");
    if (controller.signal.aborted) {
      throw new ApiClientError("API-Identitaet wurde nicht rechtzeitig gebunden; keine Operation gestartet.", "not-dispatched");
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiClientError(`API-Identitaet konnte nicht gebunden werden; keine Operation gestartet: ${detail}`, "not-dispatched");
  } finally { clearTimeout(timer); }
}

/** Retry only a validated HTTP busy rejection, which never dispatched this request. */
export async function callApiOperationWithBusyRetryEnvelope(
  operation: string, args: Record<string, unknown> = {}, timeoutMs = 90_000,
  options: ApiClientOptions = {}, retry: BusyRetryOptions = {},
): Promise<OperationEnvelope> {
  const maxAttempts = retry.maxAttempts ?? 3, delayMs = retry.delayMs ?? 250;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3
    || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5_000) {
    throw new ApiClientError("Busy-Wiederholung braucht 1 bis 3 Versuche und 0 bis 5000 ms Pause.", "bad-args");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 200 || timeoutMs > MAX_OPERATION_TIMEOUT_MS) {
    throw new ApiClientError(`Zeitlimit muss zwischen 200 und ${MAX_OPERATION_TIMEOUT_MS} ms liegen.`, "timeout-argument");
  }
  if (!isSseApiOperation(operation)) throw new ApiClientError(`Operation '${operation}' ist nicht freigegeben.`, "operation");
  let stableArgs: Record<string, unknown>;
  try {
    parseApiOperationArgs(operation, args);
    stableArgs = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof ZodError ? formatOperationArgumentError(error, operation) : String(error);
    throw new ApiClientError(`Ungueltige Argumente fuer '${operation}': ${detail}`, "bad-args");
  }
  if (maxAttempts === 1) return callApiOperationEnvelope(operation, stableArgs, timeoutMs, options);
  const started = performance.now();
  const pinned = await pinClient(options, timeoutMs);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (pinned.signal?.aborted) throw new ApiClientError("Busy-Wiederholung wurde abgebrochen.", "aborted");
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    const minimum = operation === "launch" ? MINIMUM_LAUNCH_TIMEOUT_MS : 200;
    if (remaining < minimum) {
      throw new ApiClientError(`Gemeinsames Zeitbudget unterschreitet ${minimum} ms; keine Operation gestartet.`, "busy-budget-exhausted");
    }
    try {
      return await callApiOperationEnvelope(operation, stableArgs, remaining, pinned);
    } catch (error) {
      // HTTP-200 worker busy, stale guards, transport loss and unknown writes
      // are never replayed. Their result/exception returns to the caller.
      if (!(error instanceof ApiClientError) || error.kind !== "busy" || error.httpStatus !== 409) throw error;
      if (attempt === maxAttempts) {
        throw new ApiClientError(`SSE-API nach ${attempt} Versuchen weiterhin belegt: ${error.message}`, "busy", 409);
      }
      if (timeoutMs - (performance.now() - started) < delayMs + 200) {
        throw new ApiClientError("Gemeinsames Busy-/Operationszeitbudget reicht nicht fuer einen weiteren Versuch; keine Operation gestartet.", "busy-budget-exhausted");
      }
      try { await wait(delayMs, undefined, { signal: pinned.signal }); }
      catch (error) {
        if (pinned.signal?.aborted) throw new ApiClientError("Busy-Wiederholung wurde abgebrochen.", "aborted");
        throw error;
      }
    }
  }
  throw new ApiClientError("Busy-Wiederholung endete ohne Ergebnis.", "busy");
}

export async function callApiOperationWithBusyRetry(
  operation: string, args: Record<string, unknown> = {}, timeoutMs = 90_000,
  options: ApiClientOptions = {}, retry: BusyRetryOptions = {},
): Promise<WorkerResult> {
  return (await callApiOperationWithBusyRetryEnvelope(operation, args, timeoutMs, options, retry)).result;
}
