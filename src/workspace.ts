import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
export const MAX_LIST_HASH_BYTES = 16 * 1024 * 1024;
export const MAX_LIST_TOTAL_HASH_BYTES = 64 * 1024 * 1024;

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

function hashFile(path: string, bytes: number): string | null {
  if (bytes > MAX_LIST_HASH_BYTES) return null;
  const descriptor = openSync(path, "r");
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let read = 0;
    while ((read = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, read));
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

export function validateWorkspaceTextWrite(
  root: string,
  ref: string,
  expectedSha256?: string,
): void {
  const path = resolveWorkspacePath(root, ref, true);
  if (existsSync(path)) {
    if (!expectedSha256) throw new Error("Vorhandene Datei verlangt expectedSha256.");
    const stats = statSync(path);
    if (!stats.isFile()) throw new Error("Dateireferenz bezeichnet keine regulaere Datei.");
    if (stats.size > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
    if (hash(readFileSync(path)) !== expectedSha256.toLowerCase()) {
      throw new Error("expectedSha256 stimmt nicht mit der Zieldatei ueberein.");
    }
  } else if (expectedSha256) {
    throw new Error("expectedSha256 wurde angegeben, aber die Zieldatei existiert nicht.");
  }
}

export function ensureWorkspace(root: string): void {
  mkdirSync(root, { recursive: true });
}

export function readWorkspaceText(root: string, ref: string): { info: TextFileInfo; text: string } {
  const path = resolveWorkspacePath(root, ref);
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error("Dateireferenz bezeichnet keine regulaere Datei.");
  if (stats.size > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
  const buffer = readFileSync(path);
  return { info: { ref, bytes: buffer.length, sha256: hash(buffer) }, text: buffer.toString("utf8") };
}

export function writeWorkspaceText(
  root: string,
  ref: string,
  text: string,
  expectedSha256?: string,
): TextFileInfo {
  if (typeof text !== "string") throw new Error("'text' muss eine Zeichenkette sein.");
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
  validateWorkspaceTextWrite(root, ref, expectedSha256);
  const path = resolveWorkspacePath(root, ref, true);

  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, buffer, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { ref, bytes: buffer.length, sha256: hash(buffer) };
}

export function listWorkspaceFiles(root: string, ref = ".", limit = 500, includeHashes = true): ListedFileInfo[] {
  const start = ref === "." ? realpathSync(root) : resolveWorkspacePath(root, ref);
  if (!statSync(start).isDirectory()) throw new Error("Dateireferenz bezeichnet keinen Ordner.");
  const realRoot = realpathSync(root);
  const files: ListedFileInfo[] = [];
  const pending = [start];
  let remainingHashBytes = MAX_LIST_TOTAL_HASH_BYTES;
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "de"));
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(path);
      if (!entry.isFile()) continue;
      const bytes = statSync(path).size;
      const mayHash = includeHashes && bytes <= remainingHashBytes;
      const sha256 = mayHash ? hashFile(path, bytes) : null;
      if (sha256 !== null) remainingHashBytes -= bytes;
      files.push({
        ref: relative(realRoot, path).replaceAll("\\", "/"),
        bytes,
        sha256,
        ...(sha256 === null ? { hashOmitted: true as const } : {}),
      });
      if (files.length >= limit) return files.sort((a, b) => a.ref.localeCompare(b.ref, "de"));
    }
  }
  return files.sort((a, b) => a.ref.localeCompare(b.ref, "de"));
}
