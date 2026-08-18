import type { BigIntStats } from "node:fs";
import { lstat, mkdir, readdir, realpath, rmdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";
import type { WorkerResult } from "./api-contract.js";
import { sameFileIdentity } from "./file-identity.js";

type OpenFile = Awaited<ReturnType<typeof import("node:fs/promises").open>>;

export interface OwnedDirectory {
  path: string;
  identity?: BigIntStats;
}

export class LocalFileError extends Error {
  override readonly name = "LocalFileError";

  constructor(message: string, readonly kind: string) {
    super(message);
  }
}

export class LocalOperationStopped extends Error {
  override readonly name = "LocalOperationStopped";

  constructor(readonly result: WorkerResult) {
    super(result.error ?? result.kind ?? "Lokale Dateioperation gestoppt");
  }
}

export function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

export function isInside(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`));
}

export async function createOwnedDirectoryChain(options: {
  destination: string;
  sourceDirectory: string;
  created: OwnedDirectory[];
  destinationLabel: string;
  insideSourceMessage: string;
}): Promise<BigIntStats> {
  const { destination, sourceDirectory, created, destinationLabel, insideSourceMessage } = options;
  const missing: string[] = [];
  let existingAncestor = destination;
  while (true) {
    try {
      const state = await stat(existingAncestor, { bigint: true });
      if (!state.isDirectory()) {
        throw new LocalFileError(`Zielvorfahr ist kein Ordner: ${existingAncestor}`, "not-found");
      }
      break;
    } catch (error) {
      if (error instanceof LocalFileError) throw error;
      if (errorCode(error) !== "ENOENT") throw error;
      missing.push(existingAncestor);
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new LocalFileError(`${destinationLabel} hat keinen existierenden Zielvorfahren.`, "not-found");
      }
      existingAncestor = parent;
    }
  }

  const [realSource, realAncestor] = await Promise.all([realpath(sourceDirectory), realpath(existingAncestor)]);
  if (isInside(realSource, realAncestor)) {
    throw new LocalFileError(insideSourceMessage, "bad-args");
  }
  if (!missing.length) {
    throw new LocalFileError(`${destinationLabel} existiert bereits: ${destination}`, "precondition-failed");
  }

  for (const path of missing.reverse()) {
    try {
      await mkdir(path);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new LocalFileError(
          `${destinationLabel} erschien waehrend des Anlegens: ${path}`,
          "precondition-failed",
        );
      }
      throw error;
    }
    const owned: OwnedDirectory = { path };
    created.push(owned);
    const identity = await stat(path, { bigint: true });
    if (!identity.isDirectory()) {
      throw new LocalFileError(`${destinationLabel} wurde beim Anlegen ersetzt: ${path}`, "postcondition-failed");
    }
    owned.identity = identity;
  }

  const destinationIdentity = created.at(-1)?.identity;
  if (!destinationIdentity || created.at(-1)?.path !== destination) {
    throw new LocalFileError(
      `${destinationLabel} konnte nicht eindeutig neu gebunden werden.`,
      "postcondition-failed",
    );
  }
  return destinationIdentity;
}

export function withResourceIdentity(result: WorkerResult, refs: Record<string, string>): WorkerResult {
  return Object.keys(refs).length ? { ...result, resourceRefs: refs } : result;
}

export function csvManifest(hashes: readonly { file: string; sha256: string }[]): Buffer {
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const rows = [
    `${quote("file")},${quote("sha256")}`,
    ...hashes.map((entry) => `${quote(entry.file)},${quote(entry.sha256)}`),
  ];
  return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(`${rows.join("\r\n")}\r\n`, "utf8")]);
}

export async function handleContainsExactBytes(handle: OpenFile, expected: Buffer): Promise<boolean> {
  const actual = Buffer.alloc(expected.length);
  let position = 0;
  while (position < actual.length) {
    const { bytesRead } = await handle.read(actual, position, actual.length - position, position);
    if (bytesRead === 0) return false;
    position += bytesRead;
  }
  return actual.equals(expected);
}

export async function directoryStillOwned(path: string, identity: BigIntStats): Promise<boolean> {
  try {
    const current = await stat(path, { bigint: true });
    return current.isDirectory() && sameFileIdentity(identity, current);
  } catch {
    return false;
  }
}

export function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const expectedNames = new Set(expected);
  return actual.every((name) => expectedNames.has(name));
}

export async function directoryHasExactEntries(
  path: string,
  identity: BigIntStats,
  expectedNames: readonly string[],
): Promise<boolean> {
  if (!(await directoryStillOwned(path, identity))) return false;
  return sameNames(await readdir(path), expectedNames);
}

export async function removeOwnedEmptyDirectory(path: string, identity: BigIntStats): Promise<boolean> {
  try {
    if (!(await directoryStillOwned(path, identity))) return false;
    if ((await readdir(path)).length) return false;
    await rmdir(path);
    return !(await pathExists(path));
  } catch {
    return false;
  }
}
