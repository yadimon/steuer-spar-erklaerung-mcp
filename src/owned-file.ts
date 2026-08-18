import type { BigIntStats } from "node:fs";
import { lstat, open, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sameFileIdentity, sameFileState } from "./file-identity.js";

const HASH_CHUNK_BYTES = 1024 * 1024;
type OpenFile = Awaited<ReturnType<typeof open>>;

export interface OwnedFileRemoval {
  stillOwned: boolean;
  removed: boolean;
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

async function hashHandle(handle: OpenFile): Promise<string> {
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

async function readHandle(handle: OpenFile, bytes: number): Promise<Buffer | undefined> {
  const content = Buffer.alloc(bytes);
  let position = 0;
  while (position < bytes) {
    const { bytesRead } = await handle.read(content, position, bytes - position, position);
    if (bytesRead === 0) return undefined;
    position += bytesRead;
  }
  return content;
}

async function removeVerifiedOwnedFile(
  path: string,
  identity: BigIntStats,
  verifyContent: (handle: OpenFile, state: BigIntStats) => Promise<boolean>,
): Promise<OwnedFileRemoval> {
  let handle: OpenFile | undefined;
  try {
    handle = await open(path, "r");
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFileIdentity(identity, before) || !(await verifyContent(handle, before))) {
      return { stillOwned: false, removed: false };
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat(path, { bigint: true });
    if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
      return { stillOwned: false, removed: false };
    }
    await handle.close();
    handle = undefined;
    try {
      await unlink(path);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return { stillOwned: true, removed: false };
    }
    return { stillOwned: true, removed: !(await pathExists(path)) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { stillOwned: false, removed: true };
    return { stillOwned: false, removed: false };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Entfernt nur einen Pfad, der unmittelbar vor unlink noch dieselbe Datei mit
 * exakt dem erwarteten Eigeninhalt ist. Ohne Windows DELETE_ON_CLOSE bleibt
 * zwischen letzter Identitaetspruefung und unlink ein dokumentiertes
 * Restfenster; unbekannte oder veraenderte Ziele werden nie geloescht.
 */
export async function removeOwnedFile(
  path: string,
  identity: BigIntStats,
  expectedBytes: number,
  expectedHash: string,
): Promise<OwnedFileRemoval> {
  return await removeVerifiedOwnedFile(path, identity, async (handle, state) =>
    state.size === BigInt(expectedBytes) && await hashHandle(handle) === expectedHash);
}

/**
 * Entfernt ein selbst erzeugtes Teilziel nur, wenn sein stabiler Inhalt ein
 * exaktes Praefix der beabsichtigten Bytes ist. Das bindet Schreibfehler nach
 * einem exklusiven wx+-Open, ohne fremde oder nachtraeglich veraenderte Daten
 * als eigenen Stand zu behandeln.
 */
export async function removeOwnedFilePrefix(
  path: string,
  identity: BigIntStats,
  intendedContent: Buffer,
): Promise<OwnedFileRemoval> {
  return await removeVerifiedOwnedFile(path, identity, async (handle, state) => {
    if (state.size > BigInt(intendedContent.length)) return false;
    const bytes = Number(state.size);
    const actual = await readHandle(handle, bytes);
    return actual !== undefined && actual.equals(intendedContent.subarray(0, bytes));
  });
}
