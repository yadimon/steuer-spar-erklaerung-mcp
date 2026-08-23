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
const MCP_BINARY_RESULT_KEYS = new Set(["imageBase64", "bildBase64"]);

export function redactLocalPathText(value: string): string {
  if (!value.includes("/") && !value.includes("\\") && !value.includes("%")) return value;
  return value
    .replace(LOCAL_FILE_URL, LOCAL_PATH_REDACTION)
    .replace(ENCODED_WINDOWS_LOCAL_PATH, (_match, prefix: string) => `${prefix}${LOCAL_PATH_REDACTION}`)
    .replace(POSIX_FILE_URL, LOCAL_PATH_REDACTION)
    .replace(WINDOWS_LOCAL_PATH, (_match, prefix: string) => `${prefix}${LOCAL_PATH_REDACTION}`)
    .replace(POSIX_LOCAL_PATH, (_match, prefix: string) => `${prefix}${LOCAL_PATH_REDACTION}`);
}

interface RedactedValue {
  value: unknown;
  omittedBinaryPayload: boolean;
}

function redactValue(value: unknown, omitBinaryPayloads: boolean): RedactedValue {
  if (typeof value === "string") return { value: redactLocalPathText(value), omittedBinaryPayload: false };
  if (Array.isArray(value)) {
    const redacted: unknown[] = [];
    let omittedBinaryPayload = false;
    for (const entry of value) {
      const redactedEntry = redactValue(entry, omitBinaryPayloads);
      omittedBinaryPayload ||= redactedEntry.omittedBinaryPayload;
      redacted.push(redactedEntry.value);
    }
    return { value: redacted, omittedBinaryPayload };
  }
  if (!value || typeof value !== "object") return { value, omittedBinaryPayload: false };
  const allEntries = Object.entries(value as Record<string, unknown>);
  const entries = omitBinaryPayloads
    ? allEntries.filter(([key]) => !MCP_BINARY_RESULT_KEYS.has(key))
    : allEntries;
  const reservedKeys = new Set(entries
    .map(([key]) => key)
    .filter((key) => redactLocalPathText(key) === key));
  const output: Array<[string, unknown]> = [];
  const outputKeys = new Set<string>();
  let omittedBinaryPayload = entries.length !== allEntries.length;
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
    const redactedEntry = redactValue(entry, omitBinaryPayloads);
    omittedBinaryPayload ||= redactedEntry.omittedBinaryPayload;
    output.push([safeKey, redactedEntry.value]);
  }
  return { value: Object.fromEntries(output), omittedBinaryPayload };
}

export function redactPcLocalPaths(value: unknown): unknown {
  return redactValue(value, false).value;
}

function contentFromRedacted(value: unknown, extra: Content[] = []): Content[] {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return [{ type: "text", text }, ...extra];
}

export function textResult(value: unknown, extra: Content[] = []): CallToolResult {
  const redacted = redactPcLocalPaths(value);
  return { content: contentFromRedacted(redacted, extra) };
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
  const redactedResult = redactValue(apiResult, true);
  const structuredContent = redactedResult.value;
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    throw new TypeError("Das strukturierte MCP-Ergebnis muss ein JSON-Objekt sein.");
  }
  const content = textValue === apiResult && !redactedResult.omittedBinaryPayload
    ? contentFromRedacted(structuredContent, extra)
    : textResult(textValue, extra).content;
  return {
    content,
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
  const redactedDetails = redactValue(details, true);
  const structuredContent = redactedDetails.value;
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    throw new TypeError("Das strukturierte MCP-Fehlerergebnis muss ein JSON-Objekt sein.");
  }
  return {
    content: redactedDetails.omittedBinaryPayload
      ? textResult(details).content
      : contentFromRedacted(structuredContent),
    structuredContent: structuredContent as Record<string, unknown>,
    isError: true,
  };
}

function apiErrorHint(operation: string, result: Record<string, unknown>): string | undefined {
  if (result.kind === "network") {
    // Der haeufigste Erstkontakt-Fehler: MCP ist eingerichtet, die lokale API
    // laeuft aber nicht. Ohne diesen Satz bleibt dem Agenten nur ECONNREFUSED.
    return "Die lokale SSE-API laeuft nicht. Im Arbeitsordner in einem eigenen Terminal " +
      "'steuer-spar-erklaerung-api --config <ordner>\\config.json' starten und offen lassen, " +
      "danach sse_health erneut aufrufen. Bleibt es dabei, der Installationsanleitung folgen.";
  }
  if (result.kind === "setup") {
    return "Die konfigurierte API-Adresse ist unbrauchbar. SSE_API_URL muss eine reine " +
      "Loopback-Adresse sein; sonst der Installationsanleitung folgen.";
  }
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
