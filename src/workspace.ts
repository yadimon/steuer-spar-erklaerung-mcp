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
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { MAX_WORKSPACE_TEXT_BYTES } from "./api-contract.js";
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

function hashFile(path: string, bytes: number): string | null {
  if (bytes > MAX_LIST_HASH_BYTES) return null;
  const descriptor = openSync(path, "r");
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size !== bytes || opened.size > MAX_LIST_HASH_BYTES) return null;
    let total = 0;
    let read = 0;
    while ((read = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      total += read;
      if (total > bytes || total > MAX_LIST_HASH_BYTES) return null;
      digest.update(buffer.subarray(0, read));
    }
    if (total !== bytes) return null;
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

export function validateWorkspaceTextWrite(
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

export function listWorkspaceFiles(
  root: string,
  ref = ".",
  limit = 500,
  includeHashes = true,
  maxDirectories = MAX_LIST_DIRECTORIES,
): ListedFileInfo[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2_000) {
    throw new Error("Dateilimit muss eine ganze Zahl zwischen 1 und 2000 sein.");
  }
  if (!Number.isInteger(maxDirectories) || maxDirectories < 1 || maxDirectories > MAX_LIST_DIRECTORIES) {
    throw new Error(`Ordnerlimit muss eine ganze Zahl zwischen 1 und ${MAX_LIST_DIRECTORIES} sein.`);
  }
  const start = ref === "." ? realpathSync(root) : resolveWorkspacePath(root, ref);
  if (!statSync(start).isDirectory()) throw new Error("Dateireferenz bezeichnet keinen Ordner.");
  const realRoot = realpathSync(root);
  const files: ListedFileInfo[] = [];
  const pending = [start];
  let remainingHashBytes = MAX_LIST_TOTAL_HASH_BYTES;
  let visitedDirectories = 0;
  while (pending.length > 0) {
    const current = realpathSync(pending.pop()!);
    if (!inside(realRoot, current)) {
      throw new Error("Dateiliste folgt einem ausgetauschten Ordner ausserhalb des Arbeitsbereichs.");
    }
    visitedDirectories += 1;
    if (visitedDirectories > maxDirectories) {
      throw new Error(`Dateiliste ueberschreitet das Ordnerlimit von ${maxDirectories}.`);
    }
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "de"));
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const directory = realpathSync(path);
        if (!inside(realRoot, directory)) {
          throw new Error("Dateiliste folgt einem ausgetauschten Ordner ausserhalb des Arbeitsbereichs.");
        }
        pending.push(directory);
      }
      if (!entry.isFile()) continue;
      const file = realpathSync(path);
      if (!inside(realRoot, file)) {
        throw new Error("Dateiliste folgt einer ausgetauschten Datei ausserhalb des Arbeitsbereichs.");
      }
      const bytes = statSync(file).size;
      const mayHash = includeHashes && bytes <= remainingHashBytes;
      const sha256 = mayHash ? hashFile(file, bytes) : null;
      if (realpathSync(path) !== file) {
        throw new Error("Dateireferenz wurde waehrend der Auflistung ausgetauscht.");
      }
      if (sha256 !== null) remainingHashBytes -= bytes;
      files.push({
        ref: relative(realRoot, file).replaceAll("\\", "/"),
        bytes,
        sha256,
        ...(sha256 === null ? { hashOmitted: true as const } : {}),
      });
      if (files.length >= limit) return files.sort((a, b) => a.ref.localeCompare(b.ref, "de"));
    }
  }
  return files.sort((a, b) => a.ref.localeCompare(b.ref, "de"));
}
