import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { extname } from "node:path";
import { performance } from "node:perf_hooks";
import { abortable, abortError } from "./abortable.js";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import { compareCollectExpectations } from "./collect-verification.js";
import { operationError } from "./executor-errors.js";
import { sameFileState } from "./file-identity.js";
import { MAX_JSON_FILE_BYTES, parseJsonBytesStrict } from "./json-files.js";

export interface LocalVerifyOptions {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
  timeoutMs: number | undefined;
  signal?: AbortSignal;
  redactPaths: <T>(value: T) => T;
  /** Interne Testnaht fuer eine deterministische Aenderung zwischen beiden Hashlaeufen. */
  afterSourceRead?: () => void | Promise<void>;
}

export type LocalVerifyOutcome =
  | { kind: "result"; result: WorkerResult }
  | { kind: "worker-fallback"; effectiveTimeoutMs: number; localStartedAt: number };

interface StableRead {
  bytes: Buffer | undefined;
  hash: string;
  state: BigIntStats;
}

class VerifyFileError extends Error {
  override readonly name = "VerifyFileError";

  constructor(message: string, readonly kind: string) {
    super(message);
  }
}

async function readStableJsonFile(
  path: string,
  signal: AbortSignal,
  includeBytes: boolean,
): Promise<StableRead> {
  if (signal.aborted) throw abortError();
  const opening = open(path, "r");
  const handle = await abortable(opening, signal, (lateHandle) => lateHandle.close().catch(() => undefined));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new VerifyFileError("from muss eine existierende .json-Datei sein.", "bad-args");
    if (before.size > BigInt(MAX_JSON_FILE_BYTES)) {
      throw new VerifyFileError(`Collect-JSON ist nicht lesbar: Datei ist groesser als ${MAX_JSON_FILE_BYTES} Bytes.`, "invalid-source");
    }
    const chunks: Buffer[] = [];
    const digest = createHash("sha256");
    let total = 0;
    const stream = handle.createReadStream({ autoClose: false, signal });
    stream.on("error", () => undefined);
    for await (const entry of stream) {
      const chunk = Buffer.isBuffer(entry) ? entry : Buffer.from(entry);
      total += chunk.length;
      if (total > MAX_JSON_FILE_BYTES) {
        throw new VerifyFileError(`Collect-JSON ist nicht lesbar: Datei ist groesser als ${MAX_JSON_FILE_BYTES} Bytes.`, "invalid-source");
      }
      if (includeBytes) chunks.push(chunk);
      digest.update(chunk);
    }
    const afterHandle = await handle.stat({ bigint: true });
    let afterPath: BigIntStats;
    try {
      afterPath = await stat(path, { bigint: true });
    } catch {
      throw new VerifyFileError("Collect-JSON wurde waehrend des Lesens geaendert; kein Vergleich ausgefuehrt.", "verification-source-changed");
    }
    if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
      throw new VerifyFileError("Collect-JSON wurde waehrend des Lesens geaendert; kein Vergleich ausgefuehrt.", "verification-source-changed");
    }
    return {
      bytes: includeBytes ? Buffer.concat(chunks, total) : undefined,
      hash: digest.digest("hex").toUpperCase(),
      state: before,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function withResourceIdentity(
  result: WorkerResult,
  resourceRefs: Record<string, string>,
): WorkerResult {
  return Object.keys(resourceRefs).length ? { ...result, resourceRefs } : result;
}

export async function executeLocalVerify(options: LocalVerifyOptions): Promise<LocalVerifyOutcome> {
  const effectiveTimeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const localStartedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(0, effectiveTimeoutMs));
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  const stopped = (): WorkerResult | undefined => {
    if (options.signal?.aborted) return operationError("API-Client hat die Collect-Verifikation abgebrochen.", "aborted");
    if (timedOut || performance.now() - localStartedAt >= effectiveTimeoutMs) {
      return operationError("Zeitbudget beim lokalen Pruefen des Collect-Stands aufgebraucht.", "timeout");
    }
    return undefined;
  };
  const localResult = (result: WorkerResult): LocalVerifyOutcome => {
    const beforeRedaction = stopped();
    const redacted = options.redactPaths(withResourceIdentity(beforeRedaction ?? result, options.resourceRefs));
    const afterRedaction = stopped();
    return {
      kind: "result",
      result: afterRedaction
        ? options.redactPaths(withResourceIdentity(afterRedaction, options.resourceRefs))
        : redacted,
    };
  };

  try {
    const path = options.args.from;
    const expectedHash = options.args.expectedSourceHash;
    const expectations = options.args.erwartungen;
    if (typeof path !== "string" || extname(path).toLowerCase() !== ".json") {
      return localResult(operationError("from muss eine existierende .json-Datei sein.", "bad-args"));
    }
    if (typeof expectedHash !== "string" || !/^[A-Fa-f0-9]{64}$/u.test(expectedHash) || !Array.isArray(expectations)) {
      return localResult(operationError("Ungueltige Verify-Argumente.", "bad-args"));
    }
    const beforeRead = stopped();
    if (beforeRead) return localResult(beforeRead);

    const sourceBefore = await readStableJsonFile(path, controller.signal, true);
    const normalizedExpectedHash = expectedHash.toUpperCase();
    if (sourceBefore.hash !== normalizedExpectedHash) {
      return localResult(operationError(
        `Quellstand hat SHA256 ${sourceBefore.hash} statt ${normalizedExpectedHash}; nicht geprueft.`,
        "precondition-failed",
      ));
    }
    let document: unknown;
    try {
      const sourceBytes = sourceBefore.bytes!;
      if (sourceBytes.length >= 3 && sourceBytes[0] === 0xEF && sourceBytes[1] === 0xBB && sourceBytes[2] === 0xBF) {
        return localResult(operationError("Collect-JSON ist nicht lesbar: UTF-8-BOM ist nicht erlaubt.", "invalid-source"));
      }
      document = parseJsonBytesStrict(sourceBytes, "Collect-JSON");
      sourceBefore.bytes = undefined;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return localResult(operationError(`Collect-JSON ist nicht lesbar: ${detail}`, "invalid-source"));
    }
    await options.afterSourceRead?.();
    const sourceAfter = await readStableJsonFile(path, controller.signal, false);
    if (sourceAfter.hash !== sourceBefore.hash || !sameFileState(sourceBefore.state, sourceAfter.state)) {
      return localResult({
        ok: false,
        kind: "verification-source-changed",
        error: "Collect-JSON wurde waehrend des Lesens geaendert; kein Vergleich ausgefuehrt.",
        sourceHashBefore: sourceBefore.hash,
        sourceHashAfter: sourceAfter.hash,
      });
    }
    const comparison = compareCollectExpectations(
      document,
      expectations,
      options.args.allowIncompleteSource === true,
      sourceAfter.hash,
    );
    const afterComparison = stopped();
    if (afterComparison) return localResult(afterComparison);
    if (comparison.kind === "worker-fallback") {
      return { kind: "worker-fallback", effectiveTimeoutMs, localStartedAt };
    }
    return localResult(comparison.result);
  } catch (error) {
    const stopResult = stopped();
    if (stopResult) return localResult(stopResult);
    if (error instanceof VerifyFileError) return localResult(operationError(error.message, error.kind));
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      return localResult(operationError("from muss eine existierende .json-Datei sein.", "bad-args"));
    }
    return localResult(operationError(
      `Collect-JSON ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`,
      "invalid-source",
    ));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
