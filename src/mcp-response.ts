import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type Content =
  | { type: "text"; text: string; }
  | { type: "image"; data: string; mimeType: string; };

export const LOCAL_PATH_REDACTION = "[Lokaler PC-Pfad von der MCP-Ausgabe entfernt.]";
const LOCAL_FILE_URL = /file:\/\/[^;,\)\]\}"'<>|\r\n]*/gi;
const ENCODED_WINDOWS_LOCAL_PATH = /(^|[^A-Za-z0-9])([A-Za-z]%3A(?:%2F|%5C)[^;,\)\]\}"'<>|\r\n]*)/gi;
const WINDOWS_LOCAL_PATH = /(^|[^A-Za-z0-9:/])((?:[A-Za-z]:[\\/]|\\\\(?:\?\\)?)[^;,\)\]\}"'<>|\r\n]*)/g;
const POSIX_ROOTS = "home|root|Users|tmp|var|private|opt|mnt|Volumes|usr|etc|run|srv|app|workspace|workspaces|Library|Applications|System";
const POSIX_FILE_URL = new RegExp(`file:\/\/\/(?:${POSIX_ROOTS})(?:\/[^;,\\)\\]\\}\\"'<>|\\r\\n]*)?`, "g");
const POSIX_LOCAL_PATH = new RegExp(
  `(^|[^A-Za-z0-9:/])((?:\/(?:${POSIX_ROOTS}))(?:\/[^;,\\)\\]\\}\\"'<>|\\r\\n]*)?)`,
  "g",
);

export function redactLocalPathText(value: string): string {
  return value
    .replace(LOCAL_FILE_URL, LOCAL_PATH_REDACTION)
    .replace(ENCODED_WINDOWS_LOCAL_PATH, (_match, prefix: string) => `${prefix}${LOCAL_PATH_REDACTION}`)
    .replace(POSIX_FILE_URL, LOCAL_PATH_REDACTION)
    .replace(WINDOWS_LOCAL_PATH, (_match, prefix: string) => `${prefix}${LOCAL_PATH_REDACTION}`)
    .replace(POSIX_LOCAL_PATH, (_match, prefix: string) => `${prefix}${LOCAL_PATH_REDACTION}`);
}

export function redactPcLocalPaths(value: unknown): unknown {
  if (typeof value === "string") return redactLocalPathText(value);
  if (Array.isArray(value)) return value.map(redactPcLocalPaths);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const reservedKeys = new Set(entries
    .map(([key]) => key)
    .filter((key) => redactLocalPathText(key) === key));
  const output: Array<[string, unknown]> = [];
  const outputKeys = new Set<string>();
  let redactedIndex = 1;
  for (const [key, entry] of entries) {
    let safeKey = key;
    if (redactLocalPathText(key) !== key) {
      do {
        safeKey = `lokalerPfadEntfernt${redactedIndex}`;
        redactedIndex += 1;
      } while (reservedKeys.has(safeKey) || outputKeys.has(safeKey));
    }
    outputKeys.add(safeKey);
    output.push([safeKey, redactPcLocalPaths(entry)]);
  }
  return Object.fromEntries(output);
}

export function textResult(value: unknown, extra: Content[] = []): CallToolResult {
  const redacted = redactPcLocalPaths(value);
  const text = typeof redacted === "string" ? redacted : JSON.stringify(redacted, null, 2);
  return { content: [{ type: "text", text }, ...extra] };
}

const MCP_BINARY_RESULT_KEYS = new Set(["imageBase64", "bildBase64"]);

function omitMcpBinaryPayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitMcpBinaryPayloads);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !MCP_BINARY_RESULT_KEYS.has(key))
    .map(([key, entry]) => [key, omitMcpBinaryPayloads(entry)]));
}

/**
 * Bewahrt die kompakte, ggf. geformte Textantwort fuer bestehende MCP-Clients
 * und liefert parallel das vollstaendige API-Ergebnis fuer strukturierte
 * Clients. Beide Darstellungen durchlaufen dieselbe PC-Pfad-Redaktion.
 */
export function apiSuccessResult(
  textValue: unknown,
  apiResult: Record<string, unknown>,
  extra: Content[] = [],
): CallToolResult {
  // Bildbytes liegen bereits als MCP-image-Contentblock vor. Eine zweite
  // Base64-Kopie im JSON kann die Antwort sonst um viele MiB verdoppeln.
  const structuredContent = redactPcLocalPaths(omitMcpBinaryPayloads(apiResult));
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    throw new TypeError("Das strukturierte MCP-Ergebnis muss ein JSON-Objekt sein.");
  }
  return {
    ...textResult(textValue, extra),
    structuredContent: structuredContent as Record<string, unknown>,
  };
}

export function errorResult(message: string): CallToolResult {
  return { ...textResult(message), isError: true };
}

export function apiErrorResult(operation: string, result: Record<string, unknown>): CallToolResult {
  // Alle API-Fehler bleiben strukturiert. So gehen neue Guard-, Dialog-,
  // Rollback- oder Readback-Felder nicht durch eine Kind-Allowlist verloren.
  const hint = apiErrorHint(operation, result);
  const details = { ...result, ...(hint ? { hint } : {}) };
  const structuredContent = redactPcLocalPaths(omitMcpBinaryPayloads(details));
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    throw new TypeError("Das strukturierte MCP-Fehlerergebnis muss ein JSON-Objekt sein.");
  }
  return {
    ...textResult(details),
    structuredContent: structuredContent as Record<string, unknown>,
    isError: true,
  };
}

function apiErrorHint(operation: string, result: Record<string, unknown>): string | undefined {
  if (result.kind === "degraded") {
    return "Zuerst sse_dialog_list pruefen. Einen modalen Dialog gezielt beantworten; nur ohne Dialog sse_health und einen bewussten Neustart erwägen.";
  }
  if (result.kind === "not-found") {
    return "Bei traegem Programm kann 'nicht gefunden' eine Falschmeldung sein. Erst sse_health pruefen.";
  }
  if (result.kind === "worker-isolation-lost") {
    return "API-Prozess neu starten und vorher laufende SSE-/PowerShell-Prozesse sowie den sichtbaren Fallzustand kontrollieren; nicht blind wiederholen.";
  }
  if (result.kind === "blocked" && ["click", "click_point", "keys", "menu_click"].includes(operation)) {
    return "Das ist beabsichtigt: Dieser Server uebermittelt nichts ans Finanzamt.";
  }
  return undefined;
}
