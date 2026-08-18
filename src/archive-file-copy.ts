import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { open, stat, unlink, utimes } from "node:fs/promises";
import { operationError } from "./executor-errors.js";
import { sameFileIdentity, sameFileState } from "./file-identity.js";
import { LocalFileError, LocalOperationStopped, pathExists } from "./local-file-transaction.js";

const HASH_CHUNK_BYTES = 1024 * 1024;
export type OpenFile = Awaited<ReturnType<typeof open>>;

export async function hashOpenFile(handle: OpenFile): Promise<string> {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex").toUpperCase();
}

export async function hashFilePath(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    return await hashOpenFile(handle);
  } finally {
    await handle.close();
  }
}

export async function openFileMatchesPath(
  handle: OpenFile,
  path: string,
  identity: BigIntStats,
  expectedHash: string,
  requireOriginalState = true,
): Promise<boolean> {
  try {
    const [handleBefore, pathBefore] = await Promise.all([
      handle.stat({ bigint: true }),
      stat(path, { bigint: true }),
    ]);
    const bound = requireOriginalState
      ? sameFileState(identity, handleBefore)
      : sameFileIdentity(identity, handleBefore);
    if (!bound || !sameFileState(handleBefore, pathBefore)) return false;
    const actualHash = await hashOpenFile(handle);
    const [handleAfter, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      stat(path, { bigint: true }),
    ]);
    return actualHash === expectedHash && sameFileState(handleBefore, handleAfter) &&
      sameFileState(handleAfter, pathAfter);
  } catch {
    return false;
  }
}

export async function filePathMatchesIdentityAndHash(
  path: string,
  identity: BigIntStats,
  expectedHash: string,
): Promise<boolean> {
  let handle: OpenFile | undefined;
  try {
    handle = await open(path, "r");
    return await openFileMatchesPath(handle, path, identity, expectedHash, false);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function removeOwnedCopyPrefix(
  path: string,
  identity: BigIntStats,
  source: OpenFile,
  writtenBytes: number,
): Promise<boolean> {
  let handle: OpenFile | undefined;
  try {
    handle = await open(path, "r");
    const before = await handle.stat({ bigint: true });
    if (!sameFileIdentity(identity, before) || before.size > BigInt(writtenBytes)) return false;
    const sourceBuffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    const targetBuffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let position = 0;
    const targetBytes = Number(before.size);
    while (position < targetBytes) {
      const length = Math.min(HASH_CHUNK_BYTES, targetBytes - position);
      const [sourceRead, targetRead] = await Promise.all([
        source.read(sourceBuffer, 0, length, position),
        handle.read(targetBuffer, 0, length, position),
      ]);
      if (
        sourceRead.bytesRead !== length || targetRead.bytesRead !== length ||
        !sourceBuffer.subarray(0, length).equals(targetBuffer.subarray(0, length))
      ) return false;
      position += length;
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat(path, { bigint: true });
    if (!sameFileState(before, afterHandle) || !sameFileState(afterHandle, afterPath)) return false;
    await handle.close();
    handle = undefined;
    await unlink(path);
    return !(await pathExists(path));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Kopiert einen bereits identitaetsgebundenen Quell-Handle exklusiv in einen
 * neuen Pfad. Ein Teilziel wird nur entfernt, wenn es noch exakt dem bereits
 * geschriebenen Quellpraefix entspricht.
 */
export async function copyOpenFileToArchive(
  source: OpenFile,
  target: string,
  expectedHash: string,
  expectedBytes: number,
  signal?: AbortSignal,
  timestamps?: Pick<BigIntStats, "atime" | "mtime">,
): Promise<{ handle: OpenFile; identity: BigIntStats }> {
  let targetHandle: OpenFile | undefined;
  let targetIdentity: BigIntStats | undefined;
  let writtenBytes = 0;
  const intended = createHash("sha256");
  try {
    targetHandle = await open(target, "wx+");
    targetIdentity = await targetHandle.stat({ bigint: true });
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let position = 0;
    while (position < expectedBytes) {
      if (signal?.aborted) {
        throw new LocalOperationStopped(operationError("API-Client hat die Fallarchivierung abgebrochen.", "aborted"));
      }
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, expectedBytes - position), position);
      if (bytesRead === 0) {
        throw new LocalFileError("Quellfall endete waehrend der Archivkopie vorzeitig.", "postcondition-failed");
      }
      intended.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await targetHandle.write(buffer, written, bytesRead - written, position + written);
        if (result.bytesWritten === 0) {
          throw new LocalFileError("Archivkopie konnte nicht vollstaendig geschrieben werden.", "postcondition-failed");
        }
        written += result.bytesWritten;
        writtenBytes += result.bytesWritten;
      }
      position += bytesRead;
    }
    if (intended.digest("hex").toUpperCase() !== expectedHash) {
      throw new LocalFileError("Quellfall wich waehrend der Archivkopie vom erwarteten Hash ab.", "postcondition-failed");
    }
    await targetHandle.sync();
    if (timestamps) await utimes(target, timestamps.atime, timestamps.mtime);
    const before = await targetHandle.stat({ bigint: true });
    const pathState = await stat(target, { bigint: true });
    const targetHash = await hashOpenFile(targetHandle);
    const after = await targetHandle.stat({ bigint: true });
    const pathAfter = await stat(target, { bigint: true });
    if (
      !sameFileIdentity(targetIdentity, before) || !sameFileState(before, after) ||
      !sameFileState(after, pathState) || !sameFileState(after, pathAfter) ||
      after.size !== BigInt(expectedBytes) || targetHash !== expectedHash
    ) {
      throw new LocalFileError("Archivkopie wurde waehrend der Verifikation veraendert.", "postcondition-failed");
    }
    return { handle: targetHandle, identity: targetIdentity };
  } catch (error) {
    await targetHandle?.close().catch(() => undefined);
    if (targetIdentity) await removeOwnedCopyPrefix(target, targetIdentity, source, writtenBytes);
    throw error;
  }
}
