import { ApiClientError } from "./api-client-error.js";
import { HttpResponseRejectedError } from "./local-http-transport.js";

export const HTTP_TRANSPORT_TIMEOUT_CODES = new Set([
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const HTTP_TRANSPORT_STATE_UNKNOWN_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
]);

function transportCodeFrom(value: unknown): string | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.code !== "string") return undefined;
    return /^[A-Z][A-Z0-9_]{1,63}$/u.test(record.code) ? record.code : undefined;
  } catch {
    return undefined;
  }
}

export function transportFailureCode(error: unknown): string | undefined {
  const directCode = transportCodeFrom(error);
  if (directCode) return directCode;
  try {
    const cause = error instanceof Error
      ? (error as Error & { cause?: unknown }).cause
      : undefined;
    return transportCodeFrom(cause);
  } catch {
    // Fremde Fehler-Getter duerfen die urspruengliche Diagnose nicht verdecken.
    return undefined;
  }
}

export function networkErrorMessage(prefix: string, error: unknown, code?: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${prefix}${code ? ` (${code})` : ""}: ${detail}`;
}

export function isUnknownOperationTransportCode(code: string): boolean {
  // HPE_* proves a response parser failure; it does not prove whether a
  // possibly accepted operation was applied. Never replay it automatically.
  return HTTP_TRANSPORT_STATE_UNKNOWN_CODES.has(code) || /^HPE_[A-Z0-9_]+$/u.test(code);
}

export function operationResponseRejection(error: unknown): ApiClientError | undefined {
  if (!(error instanceof HttpResponseRejectedError)) return undefined;
  return new ApiClientError(
    `SSE-API-Antwort ist ungueltig: ${error.message}`,
    "protocol",
    error.status,
    true,
  );
}
