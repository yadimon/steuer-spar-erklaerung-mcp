import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  SSE_API_VERSION,
  asArray,
  isSseApiOperation,
  type ApiErrorEnvelope,
  type OperationEnvelope,
  type WorkerResult,
} from "./api-contract.js";

export { asArray, type WorkerResult } from "./api-contract.js";

export class ApiClientError extends Error {
  constructor(message: string, readonly kind: string = "api") {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

function clientSettings(options: ApiClientOptions = {}): Required<ApiClientOptions> {
  const baseUrl = (options.baseUrl ?? process.env.SSE_API_URL ?? `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`).replace(/\/$/, "");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new ApiClientError("SSE_API_URL ist keine gueltige URL.", "setup");
  }
  if (parsedUrl.protocol !== "http:" || !["127.0.0.1", "[::1]", "::1"].includes(parsedUrl.hostname)) {
    throw new ApiClientError("SSE_API_URL muss eine lokale HTTP-Loopback-URL sein.", "setup");
  }
  const token = options.token ?? process.env.SSE_API_TOKEN ?? "";
  if (!token) {
    throw new ApiClientError(
      "SSE_API_TOKEN fehlt. Zuerst den deutschen Setup-Wizard ausfuehren und URL/Token im MCP-Client setzen.",
      "setup",
    );
  }
  return { baseUrl, token, fetchImpl: options.fetchImpl ?? fetch };
}

export async function callApiOperation(
  operation: string,
  args: Record<string, unknown> = {},
  timeoutMs = 90_000,
  options: ApiClientOptions = {},
): Promise<WorkerResult> {
  if (!isSseApiOperation(operation)) {
    throw new ApiClientError(`Operation '${operation}' ist nicht Teil der freigegebenen SSE-API.`, "operation");
  }
  const settings = clientSettings(options);
  const controller = new AbortController();
  // Der Server braucht nach Ablauf der fachlichen Frist noch Zeit, um den
  // PowerShell-Prozessbaum sicher zu beenden und eine eindeutige Timeout-
  // Antwort zu liefern. Erst danach wird die HTTP-Verbindung abgebrochen.
  const clientTimeoutMs = timeoutMs + 12_000;
  const timer = setTimeout(() => controller.abort(), clientTimeoutMs);
  try {
    const response = await settings.fetchImpl(`${settings.baseUrl}/${SSE_API_VERSION}/operations/${operation}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ args, timeoutMs }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OperationEnvelope | ApiErrorEnvelope;
    if (!response.ok || !("result" in payload)) {
      const message = "error" in payload ? payload.error.message : `HTTP ${response.status}`;
      const kind = "error" in payload ? payload.error.code : "http";
      throw new ApiClientError(`SSE-API: ${message}`, kind);
    }
    return payload.result;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiClientError(
        `SSE-API antwortete nicht innerhalb von ${clientTimeoutMs} ms. Der Zustand ist unbekannt; ` +
          "vor jeder Wiederholung zuerst gezielt lesen.",
        "timeout",
      );
    }
    throw new ApiClientError(`SSE-API nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

// Bewusst exportiert: bestehende MCP-Formatierer koennen Einzelelemente ohne
// Abhaengigkeit vom lokalen Worker normalisieren.
void asArray;
