import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  closeSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, MAX_WORKSPACE_TEXT_BYTES } from "./api-contract.js";
import { readFileBounded } from "./bounded-files.js";

export const MAX_TEXT_FILE_BYTES = MAX_WORKSPACE_TEXT_BYTES;
export const MAX_LIST_HASH_BYTES = 16 * 1024 * 1024;
export const MAX_LIST_TOTAL_HASH_BYTES = 64 * 1024 * 1024;
export const MAX_LIST_DIRECTORIES = 5_000;

export interface TextFileInfo {
  ref: string;
  bytes: number;
  sha256: string;
}

export interface ListedFileInfo {
  ref: string;
  bytes: number;
  sha256: string | null;
  hashOmitted?: true;
}

export interface WorkspaceFileListResult {
  files: ListedFileInfo[];
  truncated: boolean;
}

export type WorkspaceListWorkKind = "entry" | "hash-chunk";

interface WorkspaceWalkItem {
  kind?: WorkspaceListWorkKind;
  file?: ListedFileInfo;
  truncated?: true;
}

export interface BoundedWorkspaceListOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxDirectories?: number;
  /** Interne Testgrenze fuer ein kleineres Gesamthashbudget. */
  maxTotalHashBytes?: number;
  /** Interne Testnaht nach einer vollstaendig gebundenen Laufeinheit. */
  afterWork?: (kind: WorkspaceListWorkKind) => void | Promise<void>;
  /** Interne Testuhr fuer deterministische Deadline-Vertraege. */
  now?: () => number;
}

export class WorkspaceListStoppedError extends Error {
  override readonly name = "WorkspaceListStoppedError";

  constructor(readonly kind: "aborted" | "timeout", message: string) {
    super(message);
  }
}

function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Textdatei ist kein gueltiges UTF-8.");
  }
}

interface WorkspaceHashBudget {
  remaining: number;
}

function* hashFile(
  path: string,
  bytes: number,
  budget: WorkspaceHashBudget,
): Generator<WorkspaceWalkItem, string | null> {
  if (bytes > MAX_LIST_HASH_BYTES) return null;
  const descriptor = openSync(path, "r");
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size !== bytes || opened.size > MAX_LIST_HASH_BYTES) return null;
    let total = 0;
    while (total < bytes) {
      const requested = Math.min(buffer.length, bytes - total, budget.remaining);
      if (requested <= 0) return null;
      const read = readSync(descriptor, buffer, 0, requested, null);
      if (read <= 0) return null;
      total += read;
      budget.remaining -= read;
      digest.update(buffer.subarray(0, read));
      yield { kind: "hash-chunk" };
    }
    const after = fstatSync(descriptor);
    if (!after.isFile() || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      return null;
    }
    return digest.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveWorkspacePath(root: string, ref: string, createParent = false): string {
  if (
    typeof ref !== "string" ||
    !ref.trim() ||
    ref.includes("\0") ||
    isAbsolute(ref) ||
    /^[A-Za-z]:/.test(ref)
  ) {
    throw new Error("Dateireferenz muss ein nicht leerer relativer Pfad sein.");
  }
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, ref);
  if (!inside(realRoot, candidate)) throw new Error("Dateireferenz verlaesst den konfigurierten Arbeitsbereich.");

  if (existsSync(candidate)) {
    const realCandidate = realpathSync(candidate);
    if (!inside(realRoot, realCandidate)) throw new Error("Dateireferenz folgt einem Link ausserhalb des Arbeitsbereichs.");
    return realCandidate;
  }

  const parent = dirname(candidate);
  if (createParent) {
    // Vor mkdirSync den naechsten existierenden Vorfahren real aufloesen.
    // Sonst koennte eine Junction wie link/a/b ausserhalb bereits Ordner
    // erzeugen, bevor der nachgelagerte Realpath-Test den Zugriff ablehnt.
    let ancestor = parent;
    while (!existsSync(ancestor)) {
      const next = dirname(ancestor);
      if (next === ancestor) throw new Error("Zielordner liegt ausserhalb des konfigurierten Arbeitsbereichs.");
      ancestor = next;
    }
    if (!inside(realRoot, realpathSync(ancestor))) {
      throw new Error("Zielordner liegt ausserhalb des konfigurierten Arbeitsbereichs.");
    }
    mkdirSync(parent, { recursive: true });
  }
  if (!existsSync(parent) || !inside(realRoot, realpathSync(parent))) {
    throw new Error("Zielordner liegt ausserhalb des konfigurierten Arbeitsbereichs.");
  }
  return candidate;
}

function validateWorkspaceTextWrite(
  root: string,
  ref: string,
): void {
  const path = resolveWorkspacePath(root, ref, true);
  if (existsSync(path)) {
    throw new Error("Textdatei existiert bereits; eine neue Dateireferenz verwenden.");
  }
}

export function validateWorkspaceTextTarget(root: string, ref: string): void {
  const path = resolveWorkspacePath(root, ref, true);
  if (!existsSync(path)) return;
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error("Dateireferenz bezeichnet keine regulaere Datei.");
  if (stats.size > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
}

export function ensureWorkspace(root: string): void {
  mkdirSync(root, { recursive: true });
}

export function readWorkspaceText(root: string, ref: string): { info: TextFileInfo; text: string } {
  const path = resolveWorkspacePath(root, ref);
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error("Dateireferenz bezeichnet keine regulaere Datei.");
  if (stats.size > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
  const buffer = readFileBounded(path, MAX_TEXT_FILE_BYTES);
  if (resolveWorkspacePath(root, ref) !== path) {
    throw new Error("Dateireferenz wurde waehrend des Lesens ausgetauscht.");
  }
  return { info: { ref, bytes: buffer.length, sha256: hash(buffer) }, text: decodeUtf8(buffer) };
}

export function writeWorkspaceText(
  root: string,
  ref: string,
  text: string,
): TextFileInfo {
  if (typeof text !== "string") throw new Error("'text' muss eine Zeichenkette sein.");
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
  validateWorkspaceTextWrite(root, ref);
  const path = resolveWorkspacePath(root, ref, true);

  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, buffer, { flag: "wx" });
    // Der Hardlink erzeugt das Ziel auf demselben Volume atomar und exklusiv.
    // Er scheitert, falls waehrend des Temp-Writes eine fremde Datei erscheint;
    // anders als rename besitzt dieser Pfad keinerlei Overwrite-Semantik.
    linkSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { ref, bytes: buffer.length, sha256: hash(buffer) };
}

function isVanishedPathError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

function* walkWorkspaceFiles(
  root: string,
  ref: string,
  limit: number,
  includeHashes: boolean,
  maxDirectories: number,
  maxTotalHashBytes: number,
): Generator<WorkspaceWalkItem> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2_000) {
    throw new Error("Dateilimit muss eine ganze Zahl zwischen 1 und 2000 sein.");
  }
  if (!Number.isInteger(maxDirectories) || maxDirectories < 1 || maxDirectories > MAX_LIST_DIRECTORIES) {
    throw new Error(`Ordnerlimit muss eine ganze Zahl zwischen 1 und ${MAX_LIST_DIRECTORIES} sein.`);
  }
  if (!Number.isInteger(maxTotalHashBytes) || maxTotalHashBytes < 0 || maxTotalHashBytes > MAX_LIST_TOTAL_HASH_BYTES) {
    throw new Error(`Gesamthashlimit muss eine ganze Zahl zwischen 0 und ${MAX_LIST_TOTAL_HASH_BYTES} sein.`);
  }
  const start = ref === "." ? realpathSync(root) : resolveWorkspacePath(root, ref);
  if (!statSync(start).isDirectory()) throw new Error("Dateireferenz bezeichnet keinen Ordner.");
  const realRoot = realpathSync(root);
  const pending = [start];
  const hashBudget: WorkspaceHashBudget = { remaining: maxTotalHashBytes };
  let visitedDirectories = 0;
  let emittedFiles = 0;
  while (pending.length > 0) {
    let current: string;
    try {
      current = realpathSync(pending.pop()!);
    } catch (error) {
      if (!isVanishedPathError(error)) throw error;
      yield {};
      continue;
    }
    if (!inside(realRoot, current)) {
      throw new Error("Dateiliste folgt einem ausgetauschten Ordner ausserhalb des Arbeitsbereichs.");
    }
    visitedDirectories += 1;
    if (visitedDirectories > maxDirectories) {
      throw new Error(`Dateiliste ueberschreitet das Ordnerlimit von ${maxDirectories}.`);
    }
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "de"));
    } catch (error) {
      if (!isVanishedPathError(error)) throw error;
      yield {};
      continue;
    }
    // Auch ein leerer Ordner ist eine abgeschlossene Laufeinheit. Der
    // asynchrone Treiber kann genau hier Abbruch und Deadline beobachten.
    yield {};
    for (const entry of entries) {
      try {
        const path = resolve(current, entry.name);
        if (entry.isSymbolicLink()) {
          yield {};
          continue;
        }
        if (entry.isDirectory()) {
          const directory = realpathSync(path);
          if (!inside(realRoot, directory)) {
            throw new Error("Dateiliste folgt einem ausgetauschten Ordner ausserhalb des Arbeitsbereichs.");
          }
          pending.push(directory);
          yield {};
          continue;
        }
        if (!entry.isFile()) {
          yield {};
          continue;
        }
        const file = realpathSync(path);
        if (!inside(realRoot, file)) {
          throw new Error("Dateiliste folgt einer ausgetauschten Datei ausserhalb des Arbeitsbereichs.");
        }
        const bytes = statSync(file).size;
        if (emittedFiles >= limit) {
          yield { truncated: true };
          return;
        }
        const mayHash = includeHashes && bytes <= hashBudget.remaining;
        const sha256 = mayHash ? yield* hashFile(file, bytes, hashBudget) : null;
        if (realpathSync(path) !== file) {
          throw new Error("Dateireferenz wurde waehrend der Auflistung ausgetauscht.");
        }
        emittedFiles += 1;
        yield {
          file: {
            ref: relative(realRoot, file).replaceAll("\\", "/"),
            bytes,
            sha256,
            ...(sha256 === null ? { hashOmitted: true as const } : {}),
          },
        };
      } catch (error) {
        if (!isVanishedPathError(error)) throw error;
        yield {};
      }
    }
  }
}

export function listWorkspaceFiles(
  root: string,
  ref = ".",
  limit = 500,
  includeHashes = true,
  maxDirectories = MAX_LIST_DIRECTORIES,
): ListedFileInfo[] {
  const files: ListedFileInfo[] = [];
  for (const item of walkWorkspaceFiles(
    root,
    ref,
    limit,
    includeHashes,
    maxDirectories,
    MAX_LIST_TOTAL_HASH_BYTES,
  )) {
    if (item.file) files.push(item.file);
  }
  return files.sort((a, b) => a.ref.localeCompare(b.ref, "de"));
}

export async function listWorkspaceFilesBounded(
  root: string,
  ref = ".",
  limit = 500,
  includeHashes = true,
  options: BoundedWorkspaceListOptions = {},
): Promise<WorkspaceFileListResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("Zeitbudget fuer die Dateiliste muss eine nicht negative Zahl sein.");
  }
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const checkStopped = (): void => {
    if (options.signal?.aborted) {
      throw new WorkspaceListStoppedError("aborted", "API-Client hat die Workspace-Dateiliste abgebrochen.");
    }
    if (now() - startedAt >= timeoutMs) {
      throw new WorkspaceListStoppedError("timeout", "Zeitbudget der Workspace-Dateiliste ist aufgebraucht.");
    }
  };

  const files: ListedFileInfo[] = [];
  let truncated = false;
  const maxTotalHashBytes = options.maxTotalHashBytes ?? MAX_LIST_TOTAL_HASH_BYTES;
  const walker = walkWorkspaceFiles(
    root,
    ref,
    limit,
    includeHashes,
    options.maxDirectories ?? MAX_LIST_DIRECTORIES,
    maxTotalHashBytes,
  );
  try {
    while (true) {
      checkStopped();
      const next = walker.next();
      if (next.done) break;
      if (next.value.file) files.push(next.value.file);
      if (next.value.truncated) truncated = true;
      await options.afterWork?.(next.value.kind ?? "entry");
      // setImmediate statt einer reinen Promise-Microtask: Auch Socket-Abbruch,
      // HTTP-Healthchecks und Worker-Ausgabe erhalten zwischen Laufeinheiten
      // garantiert einen Eventloop-Turn.
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
      checkStopped();
    }
  } finally {
    walker.return(undefined);
  }
  return {
    files: files.sort((a, b) => a.ref.localeCompare(b.ref, "de")),
    truncated,
  };
}
