import { readFileBounded } from "./bounded-files.js";

export const MAX_JSON_FILE_BYTES = 16 * 1024 * 1024;

export function parseJsonBytesStrict(bytes: Uint8Array, label: string, source?: string): unknown {
  const suffix = source ? `: ${source}` : "";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} ist kein gueltiges UTF-8${suffix}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} ist kein gueltiges JSON${suffix}`);
  }
}

export function readJsonFileStrict(path: string, label: string, maxBytes = MAX_JSON_FILE_BYTES): unknown {
  let bytes: Buffer;
  try {
    bytes = readFileBounded(path, maxBytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} konnte nicht sicher gelesen werden: ${detail}`);
  }

  return parseJsonBytesStrict(bytes, label, path);
}
