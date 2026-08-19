import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  MAX_API_BODY_BYTES,
  MAX_API_RESPONSE_BYTES,
  MAX_OPERATION_TIMEOUT_MS,
  SSE_API_OPERATIONS,
  SSE_API_VERSION,
  isSseApiOperation,
  isValidApiToken,
  type SseApiOperation,
  type WorkerResult,
} from "./api-contract.js";
import { withCombinedAbortSignal } from "./abort.js";
import { ZodError } from "zod";
import { ApiClientError } from "./api-client-error.js";
import { localHttpFetch } from "./local-http-transport.js";
import { formatOperationArgumentError, parseApiOperationArgs } from "./operation-catalog.js";
import { parseApiOperationResult, SSE_API_RESULT_SCHEMA_VERSION } from "./result-contract.js";

export { asArray, type WorkerResult } from "./api-contract.js";
export { ApiClientError } from "./api-client-error.js";

export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface ApiDiscoveryDocument {
  schemaVersion: number;
  apiVersion: string;
  operations: readonly string[];
  argumentSchemas: Readonly<Record<string, unknown>>;
  resultSchemaVersion: number;
  resultSchemas: Readonly<Record<string, unknown>>;
  operationTraits: Readonly<Record<string, unknown>>;
  planning: Readonly<Record<string, unknown>>;
  limits: Readonly<Record<string, unknown>>;
  safety: Readonly<Record<string, unknown>>;
}

export interface ApiOperationDiscoveryDocument {
  schemaVersion: number;
  apiVersion: string;
  operation: SseApiOperation;
  argumentSchema: Readonly<Record<string, unknown>>;
  resultSchemaVersion: number;
  resultSchema: Readonly<Record<string, unknown>>;
  operationTraits: Readonly<Record<string, unknown>>;
  planning: Readonly<Record<string, unknown>>;
  limits: Readonly<Record<string, unknown>>;
  safety: Readonly<Record<string, unknown>>;
}

export interface OpenApiDocument {
  openapi: string;
  info: Readonly<Record<string, unknown>>;
  paths: Readonly<Record<string, unknown>>;
  components: Readonly<Record<string, unknown>>;
}

interface ApiClientSettings {
  baseUrl: string;
  token: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}

function clientSettings(options: ApiClientOptions = {}): ApiClientSettings {
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
  if (
    parsedUrl.username ||
    parsedUrl.password ||
    (parsedUrl.pathname !== "/" && parsedUrl.pathname !== "") ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new ApiClientError("SSE_API_URL darf nur aus Loopback-Host und Port bestehen.", "setup");
  }
  const token = options.token ?? process.env.SSE_API_TOKEN ?? "";
  if (!token || !isValidApiToken(token)) {
    throw new ApiClientError(
      "SSE_API_TOKEN fehlt oder ist ungueltig. Zuerst den deutschen Setup-Wizard ausfuehren und den erzeugten tokenfreien MCP-Bootstrap verwenden.",
      "setup",
    );
  }
  return {
    baseUrl: parsedUrl.origin,
    token,
    fetchImpl: options.fetchImpl ?? localHttpFetch,
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasValidRequestMetadata(payload: Record<string, unknown>): boolean {
  return typeof payload.requestId === "string" && UUID_V4.test(payload.requestId) &&
    Number.isInteger(payload.durationMs) && Number(payload.durationMs) >= 0;
}

function hasValidErrorEnvelope(payload: Record<string, unknown>): boolean {
  return payload.apiVersion === SSE_API_VERSION &&
    typeof payload.requestId === "string" && UUID_V4.test(payload.requestId) &&
    isRecord(payload.error) &&
    typeof payload.error.code === "string" && payload.error.code.length > 0 &&
    typeof payload.error.message === "string";
}

function isPublishedArgumentSchema(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || value.$schema !== "http://json-schema.org/draft-07/schema#") return false;
  return ["type", "anyOf", "oneOf", "allOf", "$ref"].some((key) => Object.hasOwn(value, key));
}

function isPublishedOperationTraits(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    typeof value.readOnlyHint === "boolean" &&
    typeof value.destructiveHint === "boolean" &&
    typeof value.idempotentHint === "boolean" &&
    value.openWorldHint === false;
}

function hasExactOperationKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === SSE_API_OPERATIONS.length && SSE_API_OPERATIONS.every((operation) => Object.hasOwn(value, operation));
}

function hasPublishedPlanning(payload: Record<string, unknown>): boolean {
  if (!isRecord(payload.planning)) return false;
  const { fallbackStages, selectors, click, dialogs } = payload.planning;
  return Array.isArray(fallbackStages) && fallbackStages.length >= 4 && fallbackStages.every((stage) =>
    isRecord(stage) &&
    typeof stage.intent === "string" && stage.intent.length > 0 &&
    typeof stage.rule === "string" && stage.rule.length > 0 &&
    Array.isArray(stage.operations) && stage.operations.length > 0 && stage.operations.every((operation) =>
      typeof operation === "string" && isSseApiOperation(operation))) &&
    isRecord(selectors) && Array.isArray(selectors.preferred) && selectors.preferred.length > 0 &&
    isRecord(click) && Array.isArray(click.patterns) && click.genericToggleBlocked === true &&
    isRecord(dialogs) && Array.isArray(dialogs.allowedButtons) && dialogs.requiresWindowAndFingerprint === true;
}

function hasPublishedSafetyAndLimits(payload: Record<string, unknown>): boolean {
  return hasPublishedPlanning(payload) &&
    isRecord(payload.limits) &&
    typeof payload.limits.apiRequestBytes === "number" &&
    isRecord(payload.limits.operation) &&
    isRecord(payload.safety) &&
    payload.safety.elsterAndSubmissionBlocked === true &&
    payload.safety.localPathsHiddenFromMcp === true;
}

function apiResponseError(payload: Record<string, unknown>, status: number): ApiClientError {
  const error = isRecord(payload.error) ? payload.error : undefined;
  const message = typeof error?.message === "string" ? error.message : `HTTP ${status}`;
  const kind = typeof error?.code === "string" ? error.code : "http";
  return new ApiClientError(`SSE-API: ${message}`, kind);
}

const HTTP_TRANSPORT_TIMEOUT_CODES = new Set([
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
    if (!isRecord(value) || typeof value.code !== "string") return undefined;
    return /^[A-Z][A-Z0-9_]{1,63}$/u.test(value.code) ? value.code : undefined;
  } catch {
    return undefined;
  }
}

function transportFailureCode(error: unknown): string | undefined {
  const directCode = transportCodeFrom(error);
  if (directCode) return directCode;
  try {
    const cause = error instanceof Error
      ? (error as Error & { cause?: unknown }).cause
      : undefined;
    return transportCodeFrom(cause);
  } catch {
    // Fehlerobjekte stammen von der Transportgrenze und koennen fremde
    // Getter besitzen. Deren Diagnose darf den eigentlichen Fehler nicht
    // durch einen zweiten Ausnahmefehler verdecken.
    return undefined;
  }
}

function networkErrorMessage(prefix: string, error: unknown, code?: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${prefix}${code ? ` (${code})` : ""}: ${detail}`;
}

function hasJsonContentType(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Die Protokollverletzung bleibt die relevante Diagnose. Ein bereits
    // fehlerhafter Stream darf sie beim Best-effort-Cancel nicht verdecken.
  }
}

export async function readApiJsonResponse(
  response: Response,
  maxBytes = MAX_API_RESPONSE_BYTES,
): Promise<unknown> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new ApiClientError("Internes API-Antwortlimit ist ungueltig.", "protocol");
  }
  if (!hasJsonContentType(response)) {
    await cancelResponseBody(response);
    throw new ApiClientError("SSE-API-Antwort muss Content-Type application/json verwenden.", "protocol");
  }
  const advertisedLength = response.headers.get("content-length");
  if (advertisedLength && /^\d+$/.test(advertisedLength) && Number(advertisedLength) > maxBytes) {
    await cancelResponseBody(response);
    throw new ApiClientError(`SSE-API-Antwort ist groesser als ${maxBytes} Bytes.`, "protocol");
  }
  if (!response.body) {
    throw new ApiClientError("SSE-API lieferte keinen Antwortkoerper.", "protocol");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        try { await reader.cancel(); } catch { /* Protokollfehler unten behalten. */ }
        throw new ApiClientError(`SSE-API-Antwort ist groesser als ${maxBytes} Bytes.`, "protocol");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ApiClientError("SSE-API lieferte kein gueltiges UTF-8.", "protocol");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiClientError("SSE-API lieferte kein gueltiges JSON.", "protocol");
  }
}

const MAX_API_DOCUMENT_BYTES = 1024 * 1024;
const API_DOCUMENT_TIMEOUT_MS = 10_000;

async function readAuthenticatedApiDocument(
  path: string,
  options: ApiClientOptions,
): Promise<Record<string, unknown>> {
  const settings = clientSettings(options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_DOCUMENT_TIMEOUT_MS);
  try {
    const { response, payload } = await withCombinedAbortSignal(
      [controller.signal, settings.signal],
      async (signal) => {
        const response = await settings.fetchImpl(`${settings.baseUrl}/${SSE_API_VERSION}/${path}`, {
          method: "GET",
          headers: { accept: "application/json", authorization: `Bearer ${settings.token}` },
          redirect: "error",
          signal,
        });
        return {
          response,
          payload: await readApiJsonResponse(response, MAX_API_DOCUMENT_BYTES),
        };
      },
    );
    if (!isRecord(payload)) {
      throw new ApiClientError("SSE-API-Dokument ist kein JSON-Objekt.", "protocol");
    }
    if (!response.ok) {
      if (!hasValidErrorEnvelope(payload)) {
        throw new ApiClientError("SSE-API-Fehlerantwort hat keine gueltige Antworthuelle.", "protocol");
      }
      throw apiResponseError(payload, response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (settings.signal?.aborted) {
      throw new ApiClientError("Lesen des SSE-API-Dokuments wurde abgebrochen.", "aborted");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiClientError(
        `SSE-API-Dokument antwortete nicht innerhalb von ${API_DOCUMENT_TIMEOUT_MS} ms.`,
        "timeout",
      );
    }
    const transportCode = transportFailureCode(error);
    if (transportCode && HTTP_TRANSPORT_TIMEOUT_CODES.has(transportCode)) {
      throw new ApiClientError(
        `SSE-API-Dokument ueberschritt das HTTP-Transportlimit (${transportCode}).`,
        "timeout",
      );
    }
    throw new ApiClientError(
      networkErrorMessage("SSE-API-Dokument nicht erreichbar", error, transportCode),
      "network",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function readApiDiscovery(options: ApiClientOptions = {}): Promise<ApiDiscoveryDocument> {
  const payload = await readAuthenticatedApiDocument("operations", options);
  const operations = Array.isArray(payload.operations) ? payload.operations : [];
  const argumentSchemas = isRecord(payload.argumentSchemas) ? payload.argumentSchemas : {};
  const resultSchemas = isRecord(payload.resultSchemas) ? payload.resultSchemas : {};
  const operationTraits = isRecord(payload.operationTraits) ? payload.operationTraits : {};
  const exactOperations = operations.length === SSE_API_OPERATIONS.length &&
    operations.every((operation, index) => operation === SSE_API_OPERATIONS[index]);
  if (
    payload.schemaVersion !== 1 ||
    payload.apiVersion !== SSE_API_VERSION ||
    !exactOperations ||
    !hasExactOperationKeys(argumentSchemas) ||
    payload.resultSchemaVersion !== SSE_API_RESULT_SCHEMA_VERSION ||
    !hasExactOperationKeys(resultSchemas) ||
    !hasExactOperationKeys(operationTraits) ||
    !hasPublishedSafetyAndLimits(payload) ||
    !SSE_API_OPERATIONS.every((operation) =>
      isPublishedArgumentSchema(argumentSchemas[operation]) &&
      isPublishedArgumentSchema(resultSchemas[operation]) &&
      isPublishedOperationTraits(operationTraits[operation]))
  ) {
    throw new ApiClientError("SSE-API-Discovery hat nicht die erwartete Struktur oder Version.", "protocol");
  }
  return payload as unknown as ApiDiscoveryDocument;
}

export async function readApiOperationDiscovery(
  operation: string,
  options: ApiClientOptions = {},
): Promise<ApiOperationDiscoveryDocument> {
  if (!isSseApiOperation(operation)) {
    throw new ApiClientError(`Operation '${operation}' ist nicht Teil der freigegebenen SSE-API.`, "operation");
  }
  const payload = await readAuthenticatedApiDocument(`operations/${operation}`, options);
  if (
    payload.schemaVersion !== 1 ||
    payload.apiVersion !== SSE_API_VERSION ||
    payload.operation !== operation ||
    !isPublishedArgumentSchema(payload.argumentSchema) ||
    payload.resultSchemaVersion !== SSE_API_RESULT_SCHEMA_VERSION ||
    !isPublishedArgumentSchema(payload.resultSchema) ||
    !isPublishedOperationTraits(payload.operationTraits) ||
    !hasPublishedSafetyAndLimits(payload)
  ) {
    throw new ApiClientError("SSE-API-Einzel-Discovery hat nicht die erwartete Struktur oder Version.", "protocol");
  }
  return payload as unknown as ApiOperationDiscoveryDocument;
}

export async function readOpenApiDocument(options: ApiClientOptions = {}): Promise<OpenApiDocument> {
  const payload = await readAuthenticatedApiDocument("openapi.json", options);
  const info = isRecord(payload.info) ? payload.info : {};
  const paths = isRecord(payload.paths) ? payload.paths : {};
  const components = isRecord(payload.components) ? payload.components : {};
  const schemas = isRecord(components.schemas) ? components.schemas : {};
  const securitySchemes = isRecord(components.securitySchemes) ? components.securitySchemes : {};
  const bearerAuth = isRecord(securitySchemes.bearerAuth) ? securitySchemes.bearerAuth : {};
  const operationPaths = SSE_API_OPERATIONS.map((operation) => `/${SSE_API_VERSION}/operations/${operation}`);
  const metadataPaths = ["/healthz", `/${SSE_API_VERSION}/operations`, `/${SSE_API_VERSION}/openapi.json`];
  const exactPaths = Object.keys(paths).length === operationPaths.length + metadataPaths.length &&
    operationPaths.every((path) => {
      const pathItem = paths[path];
      return isRecord(pathItem) && isRecord(pathItem.get) && isRecord(pathItem.post);
    }) && metadataPaths.every((path) => {
      const pathItem = paths[path];
      return isRecord(pathItem) && isRecord(pathItem.get) && !Object.hasOwn(pathItem, "post");
    });
  if (
    payload.openapi !== "3.1.0" ||
    info.version !== SSE_API_VERSION ||
    !exactPaths ||
    !SSE_API_OPERATIONS.every((operation) => isRecord(schemas[`Result_${operation}`])) ||
    bearerAuth.type !== "http" ||
    bearerAuth.scheme !== "bearer"
  ) {
    throw new ApiClientError("SSE-OpenAPI-Dokument hat nicht die erwartete 3.1-Struktur.", "protocol");
  }
  return payload as unknown as OpenApiDocument;
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
  if (!Number.isInteger(timeoutMs) || timeoutMs < 200 || timeoutMs > MAX_OPERATION_TIMEOUT_MS) {
    throw new ApiClientError(
      `Zeitlimit muss eine ganze Zahl zwischen 200 und ${MAX_OPERATION_TIMEOUT_MS} ms sein.`,
      "timeout-argument",
    );
  }
  const settings = clientSettings(options);
  try {
    parseApiOperationArgs(operation, args);
  } catch (error) {
    const message = error instanceof ZodError ? formatOperationArgumentError(error) : String(error);
    throw new ApiClientError(`Ungueltige Argumente fuer '${operation}': ${message}`, "bad-args");
  }
  // Die validierte Originalform bleibt auf dem Draht erhalten. Aliasfelder
  // werden erst an der Servergrenze kanonisiert; so aendert lokale
  // Vorvalidierung nicht unbemerkt das beobachtbare Clientprotokoll.
  const requestBody = JSON.stringify({ args, timeoutMs });
  if (Buffer.byteLength(requestBody) > MAX_API_BODY_BYTES) {
    throw new ApiClientError(`SSE-API-Anfrage ist groesser als ${MAX_API_BODY_BYTES} Bytes.`, "payload-too-large");
  }
  const controller = new AbortController();
  // Der Server braucht nach Ablauf der fachlichen Frist noch Zeit, um den
  // PowerShell-Prozessbaum sicher zu beenden und eine eindeutige Timeout-
  // Antwort zu liefern. Erst danach wird die HTTP-Verbindung abgebrochen.
  const clientTimeoutMs = timeoutMs + 12_000;
  const timer = setTimeout(() => controller.abort(), clientTimeoutMs);
  try {
    const { response, payload } = await withCombinedAbortSignal(
      [controller.signal, settings.signal],
      async (signal) => {
        const response = await settings.fetchImpl(
          `${settings.baseUrl}/${SSE_API_VERSION}/operations/${operation}`,
          {
            method: "POST",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${settings.token}`,
              "content-type": "application/json",
            },
            body: requestBody,
            redirect: "error",
            signal,
          },
        );
        return { response, payload: await readApiJsonResponse(response) };
      },
    );
    if (!isRecord(payload)) {
      throw new ApiClientError("SSE-API lieferte keine gueltige Antworthuelle.", "protocol");
    }
    if (!response.ok) {
      if (!hasValidErrorEnvelope(payload)) {
        throw new ApiClientError("SSE-API-Fehlerantwort hat keine gueltige Antworthuelle.", "protocol");
      }
      throw apiResponseError(payload, response.status);
    }
    if (payload.apiVersion !== SSE_API_VERSION) {
      throw new ApiClientError("SSE-API-Version stimmt nicht mit diesem Client ueberein.", "protocol");
    }
    if (payload.operation !== operation) {
      throw new ApiClientError("SSE-API antwortete fuer eine andere Operation.", "protocol");
    }
    if (!hasValidRequestMetadata(payload)) {
      throw new ApiClientError("SSE-API-Antwort hat keine gueltige requestId oder durationMs.", "protocol");
    }
    if (!isRecord(payload.result) || typeof payload.result.ok !== "boolean") {
      throw new ApiClientError("SSE-API-Ergebnis hat keinen gueltigen ok-Status.", "protocol");
    }
    try {
      return parseApiOperationResult(operation, payload.result);
    } catch {
      throw new ApiClientError(
        `SSE-API-Ergebnis fuer '${operation}' verletzt den versionierten Ergebnisvertrag.`,
        "protocol",
      );
    }
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (settings.signal?.aborted) {
      throw new ApiClientError(
        "MCP-Anfrage wurde abgebrochen. Der lokale Auftrag wird gestoppt; vor einer Wiederholung Zustand lesen.",
        "aborted",
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiClientError(
        `SSE-API antwortete nicht innerhalb von ${clientTimeoutMs} ms. Der Zustand ist unbekannt; ` +
          "vor jeder Wiederholung zuerst gezielt lesen.",
        "timeout",
      );
    }
    const transportCode = transportFailureCode(error);
    if (transportCode && HTTP_TRANSPORT_TIMEOUT_CODES.has(transportCode)) {
      throw new ApiClientError(
        `SSE-API antwortete nicht innerhalb des HTTP-Transportlimits (${transportCode}). ` +
          "Der Zustand ist unbekannt; vor jeder Wiederholung zuerst gezielt lesen.",
        "timeout",
      );
    }
    if (transportCode && HTTP_TRANSPORT_STATE_UNKNOWN_CODES.has(transportCode)) {
      throw new ApiClientError(
        networkErrorMessage("SSE-API-Verbindung brach waehrend des Operationsaufrufs ab", error, transportCode) +
          " Der Zustand ist unbekannt; vor jeder Wiederholung zuerst gezielt lesen.",
        "transport-unknown",
      );
    }
    throw new ApiClientError(networkErrorMessage("SSE-API nicht erreichbar", error, transportCode), "network");
  } finally {
    clearTimeout(timer);
  }
}
