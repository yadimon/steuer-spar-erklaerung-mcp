import { createHash, type Hash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { abortable } from "./abortable.js";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import {
  AKAD_MAX_HEADER_BYTES,
  isProfileCaseFileName,
  parseAkadCaseSummary,
} from "./case-file.js";
import { operationError } from "./executor-errors.js";
import { sameFileIdentity, sameFileState } from "./file-identity.js";
import { removeOwnedFile, type OwnedFileRemoval } from "./owned-file.js";
import type { ProductProfile } from "./product-profiles.js";

const COPY_CHUNK_BYTES = 1024 * 1024;
const EMPTY_SHA256 = createHash("sha256").digest("hex").toUpperCase();

type OpenFile = Awaited<ReturnType<typeof open>>;

export interface LocalWorkingCopyOptions {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
  profile: ProductProfile;
  timeoutMs: number | undefined;
  signal?: AbortSignal;
  redactPaths: <T>(value: T) => T;
  /** Interne Testnaht direkt nach der vollstaendigen, synchronisierten Kopie. */
  afterCopy?: () => void | Promise<void>;
  /** Interne Testnaht nach einem vollstaendig geschriebenen Kopierblock. */
  afterChunk?: (bytesCopied: number) => void | Promise<void>;
  /** Interne Testnaht fuer deadlinegebundene, spaet aufloesende Datei-Opens. */
  openFile?: (path: string, flags: "r" | "wx+") => Promise<OpenFile>;
  /** Interne Kompositionsgrenze: verifizierte Zielidentitaet vor der Erfolgsfreigabe. */
  afterVerifiedTarget?: (identity: BigIntStats) => void | Promise<void>;
}

interface StableHash {
  hash: string;
  state: BigIntStats;
}

class WorkingCopyFileError extends Error {
  override readonly name = "WorkingCopyFileError";

  constructor(message: string, readonly kind: string) {
    super(message);
  }
}

class WorkingCopyStopped extends Error {
  override readonly name = "WorkingCopyStopped";

  constructor(readonly result: WorkerResult) {
    super(result.error ?? result.kind ?? "Arbeitskopie gestoppt");
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function hashHandle(handle: OpenFile, checkStopped: () => void): Promise<string> {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  let position = 0;
  while (true) {
    checkStopped();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    checkStopped();
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex").toUpperCase();
}

async function stableHash(
  handle: OpenFile,
  path: string,
  checkStopped: () => void,
): Promise<StableHash> {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile()) throw new WorkingCopyFileError(`Falldatei fehlt: ${path}`, "not-found");
  const hash = await hashHandle(handle, checkStopped);
  const afterHandle = await handle.stat({ bigint: true });
  let afterPath: BigIntStats;
  try {
    afterPath = await stat(path, { bigint: true });
  } catch {
    throw new WorkingCopyFileError(
      `Falldatei wurde waehrend des Lesens veraendert oder ersetzt: ${path}`,
      "resource-changed",
    );
  }
  if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
    throw new WorkingCopyFileError(
      `Falldatei wurde waehrend des Lesens veraendert oder ersetzt: ${path}`,
      "resource-changed",
    );
  }
  return { hash, state: before };
}

async function cleanupLateTargetOpen(handle: OpenFile, path: string): Promise<void> {
  let identity: BigIntStats | undefined;
  try {
    identity = await handle.stat({ bigint: true });
  } catch {
    // Ohne Handleidentitaet gibt es keinen sicheren Delete-Beweis.
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (identity) await removeOwnedFile(path, identity, 0, EMPTY_SHA256);
}

function postconditionMessage(ownership: OwnedFileRemoval): string {
  if (ownership.removed) return "Arbeitskopie wich von der Quelle ab; eigenes Ziel wurde entfernt.";
  if (ownership.stillOwned) {
    return "Arbeitskopie wich von der Quelle ab; eigenes Ziel konnte nicht entfernt werden und blieb zur manuellen Klaerung erhalten.";
  }
  return "Arbeitskopie wurde nach dem Erstellen veraendert; unbekanntes Ziel blieb zur manuellen Klaerung erhalten.";
}

function withCleanupStatus(result: WorkerResult, ownership: OwnedFileRemoval | undefined): WorkerResult {
  if (!ownership) return result;
  const cleanupDetail = ownership.removed
    ? ""
    : ownership.stillOwned
      ? " Eigenes Arbeitskopieziel konnte nicht entfernt werden."
      : " Arbeitskopieziel ist nicht mehr eindeutig als eigener Schreibstand gebunden und blieb erhalten.";
  return {
    ...result,
    ...(cleanupDetail ? { error: `${result.error ?? "Arbeitskopie fehlgeschlagen."}${cleanupDetail}` } : {}),
    targetStillOwned: ownership.stillOwned,
    rolledBack: ownership.removed,
  };
}

function withResourceIdentity(
  result: WorkerResult,
  resourceRefs: Record<string, string>,
): WorkerResult {
  return Object.keys(resourceRefs).length ? { ...result, resourceRefs } : result;
}

function appendHeaderBytes(chunks: Buffer[], chunk: Buffer, currentBytes: number): number {
  if (currentBytes >= AKAD_MAX_HEADER_BYTES) return currentBytes;
  const slice = chunk.subarray(0, AKAD_MAX_HEADER_BYTES - currentBytes);
  if (slice.length) chunks.push(Buffer.from(slice));
  return currentBytes + slice.length;
}

export async function executeLocalWorkingCopy(options: LocalWorkingCopyOptions): Promise<WorkerResult> {
  const effectiveTimeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const startedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  const stopped = (): WorkerResult | undefined => {
    if (options.signal?.aborted) return operationError("API-Client hat die Arbeitskopie abgebrochen.", "aborted");
    if (timedOut || performance.now() - startedAt >= effectiveTimeoutMs) {
      return operationError("Zeitbudget beim lokalen Erstellen der Arbeitskopie aufgebraucht.", "timeout");
    }
    return undefined;
  };
  const checkStopped = (): void => {
    const result = stopped();
    if (result) throw new WorkingCopyStopped(result);
  };
  const localResult = (result: WorkerResult): WorkerResult =>
    options.redactPaths(withResourceIdentity(result, options.resourceRefs));
  const openFile = options.openFile ?? open;

  let sourceHandle: OpenFile | undefined;
  let targetHandle: OpenFile | undefined;
  let targetIdentity: BigIntStats | undefined;
  let sourcePath: string | undefined;
  let targetPath: string | undefined;
  let targetCreated = false;
  let bytesWritten = 0;
  const writtenDigest: Hash = createHash("sha256");
  try {
    const sourceRaw = options.args.source;
    const targetRaw = options.args.target;
    const expectedHashRaw = options.args.expectedSourceHash;
    if (
      typeof sourceRaw !== "string" || !sourceRaw ||
      typeof targetRaw !== "string" || !targetRaw ||
      typeof expectedHashRaw !== "string" || !/^[A-Fa-f0-9]{64}$/u.test(expectedHashRaw)
    ) {
      return localResult(operationError("source, target und expectedSourceHash sind Pflicht.", "bad-args"));
    }
    sourcePath = resolve(sourceRaw);
    targetPath = resolve(targetRaw);
    const expectedHash = expectedHashRaw.toUpperCase();

    checkStopped();
    try {
      sourceHandle = await abortable(
        openFile(sourcePath, "r"),
        controller.signal,
        (lateHandle) => lateHandle.close().catch(() => undefined),
      );
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes(errorCode(error))) {
        return localResult(operationError(`Quelldatei fehlt: ${sourcePath}`, "not-found"));
      }
      throw error;
    }
    const sourceInitialState = await sourceHandle.stat({ bigint: true });
    if (!sourceInitialState.isFile()) {
      return localResult(operationError(`Quelldatei fehlt: ${sourcePath}`, "not-found"));
    }
    if (await pathExists(targetPath)) {
      return localResult(operationError(`Ziel existiert bereits: ${targetPath}`, "exists"));
    }
    if (
      !isProfileCaseFileName(sourcePath, options.profile, true) ||
      !isProfileCaseFileName(targetPath, options.profile, true)
    ) {
      return localResult(operationError(
        `Quelle und Ziel muessen Falldateien des Profils '${options.profile.id}' sein.`,
        "unsupported-case",
      ));
    }
    if (extname(sourcePath).toUpperCase() !== extname(targetPath).toUpperCase()) {
      return localResult(operationError("Quelle und Ziel muessen dieselbe Steuerfall-Endung haben.", "bad-args"));
    }
    let targetDirectoryState: BigIntStats;
    try {
      targetDirectoryState = await stat(dirname(targetPath), { bigint: true });
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(errorCode(error))) {
        return localResult(operationError(`Zielordner fehlt: ${dirname(targetPath)}`, "not-found"));
      }
      throw error;
    }
    if (!targetDirectoryState.isDirectory()) {
      return localResult(operationError(`Zielordner fehlt: ${dirname(targetPath)}`, "not-found"));
    }

    const sourceBefore = await stableHash(sourceHandle, sourcePath, checkStopped);
    if (sourceBefore.hash !== expectedHash) {
      return localResult(operationError("Quell-Hash stimmt nicht; NICHT kopiert.", "precondition-failed"));
    }
    checkStopped();
    try {
      // 'wx+' bindet den Pfad atomar an eine neue Datei und erlaubt denselben
      // Handle fuer das nachfolgende Readback. Anders als FileShare.Read im
      // Worker kann Node konkurrierende Windows-Schreiber nicht aussperren;
      // Identitaet, Zustand und Hash werden deshalb nach dem Kopieren erneut
      // fail-closed geprueft.
      targetHandle = await abortable(
        openFile(targetPath, "wx+"),
        controller.signal,
        (lateHandle) => cleanupLateTargetOpen(lateHandle, targetPath!),
      );
      targetCreated = true;
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        return localResult(operationError(`Ziel existiert bereits: ${targetPath}`, "exists"));
      }
      throw error;
    }
    targetIdentity = await targetHandle.stat({ bigint: true });
    const targetPathIdentity = await stat(targetPath, { bigint: true });
    if (!sameFileIdentity(targetIdentity, targetPathIdentity)) {
      throw new WorkingCopyFileError(
        "Arbeitskopieziel wurde unmittelbar nach dem Erstellen ersetzt.",
        "postcondition-failed",
      );
    }

    const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
    const headerChunks: Buffer[] = [];
    let headerBytes = 0;
    let sourcePosition = 0;
    while (true) {
      checkStopped();
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, sourcePosition);
      checkStopped();
      if (bytesRead === 0) break;
      sourcePosition += bytesRead;
      let chunkOffset = 0;
      while (chunkOffset < bytesRead) {
        checkStopped();
        const { bytesWritten: written } = await targetHandle.write(
          buffer,
          chunkOffset,
          bytesRead - chunkOffset,
          bytesWritten,
        );
        if (written <= 0) throw new Error("Arbeitskopie konnte keinen weiteren Dateiblock schreiben.");
        const writtenSlice = buffer.subarray(chunkOffset, chunkOffset + written);
        writtenDigest.update(writtenSlice);
        headerBytes = appendHeaderBytes(headerChunks, writtenSlice, headerBytes);
        chunkOffset += written;
        bytesWritten += written;
      }
      await options.afterChunk?.(bytesWritten);
      checkStopped();
    }
    await targetHandle.sync();
    checkStopped();
    await options.afterCopy?.();
    checkStopped();

    const sourceAfter = await stableHash(sourceHandle, sourcePath, checkStopped);
    const targetAfter = await stableHash(targetHandle, targetPath, checkStopped);
    const sourceHandleState = await sourceHandle.stat({ bigint: true });
    const sourcePathState = await stat(sourcePath, { bigint: true });
    const targetHandleState = await targetHandle.stat({ bigint: true });
    const targetPathState = await stat(targetPath, { bigint: true });
    const copiedHash = writtenDigest.copy().digest("hex").toUpperCase();
    const verified =
      sourceAfter.hash === sourceBefore.hash &&
      sameFileState(sourceBefore.state, sourceAfter.state) &&
      sameFileState(sourceAfter.state, sourceHandleState) &&
      sameFileState(sourceAfter.state, sourcePathState) &&
      copiedHash === sourceBefore.hash &&
      targetAfter.hash === sourceBefore.hash &&
      sameFileIdentity(targetIdentity, targetAfter.state) &&
      sameFileState(targetAfter.state, targetHandleState) &&
      sameFileState(targetAfter.state, targetPathState);
    if (!verified) {
      await targetHandle.close().catch(() => undefined);
      targetHandle = undefined;
      const ownership = await removeOwnedFile(targetPath, targetIdentity, bytesWritten, sourceBefore.hash);
      return localResult({
        ok: false,
        kind: "postcondition-failed",
        error: postconditionMessage(ownership),
        source: sourcePath,
        target: targetPath,
        sourceBefore: sourceBefore.hash,
        sourceAfter: sourceAfter.hash,
        targetHash: targetAfter.hash,
        targetStillOwned: ownership.stillOwned,
        rolledBack: ownership.removed,
      });
    }

    await options.afterVerifiedTarget?.(targetAfter.state);
    checkStopped();

    const summary = parseAkadCaseSummary(Buffer.concat(headerChunks, headerBytes));
    return localResult({
      ok: true,
      copied: true,
      source: sourcePath,
      target: targetPath,
      sourceHash: sourceBefore.hash,
      targetHash: targetAfter.hash,
      verified: true,
      header: summary.header,
      transmitted: summary.transmitted,
    });
  } catch (error) {
    if (targetCreated && !targetIdentity && targetHandle) {
      try {
        targetIdentity = await targetHandle.stat({ bigint: true });
      } catch {
        // Ohne Identitaet bleibt das Ziel fail-closed zur manuellen Klaerung.
      }
    }
    await targetHandle?.close().catch(() => undefined);
    targetHandle = undefined;
    let ownership: OwnedFileRemoval | undefined;
    if (targetCreated && targetPath && targetIdentity) {
      const partialHash = bytesWritten > 0
        ? writtenDigest.copy().digest("hex").toUpperCase()
        : EMPTY_SHA256;
      ownership = await removeOwnedFile(targetPath, targetIdentity, bytesWritten, partialHash);
    } else if (targetCreated) {
      ownership = { stillOwned: false, removed: false };
    }
    const failedResult = (result: WorkerResult): WorkerResult => withCleanupStatus(
      targetCreated && sourcePath && targetPath ? { ...result, source: sourcePath, target: targetPath } : result,
      ownership,
    );
    if (error instanceof WorkingCopyStopped) return localResult(failedResult(error.result));
    if (error instanceof WorkingCopyFileError) {
      const kind = targetCreated ? "postcondition-failed" : error.kind;
      return localResult(failedResult(operationError(error.message, kind)));
    }
    const stopResult = stopped();
    if (stopResult) return localResult(failedResult(stopResult));
    if (errorCode(error) === "ENOENT") {
      return localResult(failedResult(
        operationError("Quelle oder Zielpfad wurde waehrend der Arbeitskopie entfernt.", "postcondition-failed"),
      ));
    }
    return localResult(failedResult(
      operationError(
        `Arbeitskopie konnte nicht erstellt werden: ${error instanceof Error ? error.message : String(error)}`,
        "worker",
      ),
    ));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    await targetHandle?.close().catch(() => undefined);
    await sourceHandle?.close().catch(() => undefined);
  }
}
