import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { ZodError } from "zod";
import {
  MAX_API_BODY_BYTES,
  MAX_API_RESPONSE_BYTES,
  MAX_OPERATION_TIMEOUT_MS,
  SSE_API_VERSION,
  type ApiErrorEnvelope,
  type OperationEnvelope,
  type OperationRequest,
  type SseApiOperation,
  type WorkerResult,
  isSseApiOperation,
  safeTokenEqual,
} from "./api-contract.js";
import type { SseApiServerConfig } from "./api-config.js";
import { apiOperationDiscovery, SSE_API_DISCOVERY } from "./api-discovery.js";
import { SSE_OPENAPI_DOCUMENT } from "./api-openapi.js";
import { formatOperationArgumentError, parseApiOperationArgs } from "./operation-catalog.js";

export type OperationExecutor = (
  operation: SseApiOperation,
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
) => Promise<WorkerResult>;

export interface SseApiServerOptions {
  config: SseApiServerConfig;
  execute: OperationExecutor;
  log?: (record: Record<string, unknown>) => void;
}
type SendJsonOutcome = "sent" | "unavailable" | "too-large";

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: OutgoingHttpHeaders = {},
  beforeEnd?: () => void,
): SendJsonOutcome {
  if (response.writableEnded || response.destroyed) return "unavailable";
  const json = JSON.stringify(body);
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_API_RESPONSE_BYTES) return "too-large";
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes,
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  beforeEnd?.();
  response.end(json);
  return "sent";
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "bad-request",
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function apiError(requestId: string, code: string, message: string): ApiErrorEnvelope {
  return { apiVersion: SSE_API_VERSION, requestId, error: { code, message } };
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

function hasJsonContentType(request: IncomingMessage): boolean {
  const contentType = request.headers["content-type"];
  return typeof contentType === "string" &&
    contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const advertisedLength = request.headers["content-length"];
  if (
    typeof advertisedLength === "string" &&
    /^\d+$/.test(advertisedLength) &&
    Number(advertisedLength) > MAX_API_BODY_BYTES
  ) {
    throw new ApiRequestError(`Anfrage ist groesser als ${MAX_API_BODY_BYTES} Bytes.`, 413, "payload-too-large");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_API_BODY_BYTES) {
      throw new ApiRequestError(`Anfrage ist groesser als ${MAX_API_BODY_BYTES} Bytes.`, 413, "payload-too-large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new ApiRequestError("Anfragekoerper darf bei POST nicht leer sein.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ApiRequestError("Anfragekoerper muss gueltiges UTF-8 enthalten.");
  }
  return JSON.parse(text) as unknown;
}

function parseOperationRequest(value: unknown): OperationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError("Anfragekoerper muss ein JSON-Objekt sein.");
  }
  const body = value as Record<string, unknown>;
  const unknownFields = Object.keys(body).filter((key) => key !== "args" && key !== "timeoutMs");
  if (unknownFields.length) {
    throw new ApiRequestError(`Unbekanntes Anfragefeld: '${unknownFields.sort()[0]}'.`);
  }
  const args = body.args ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new ApiRequestError("'args' muss ein JSON-Objekt sein.");
  }
  const timeoutMs = body.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 200 || Number(timeoutMs) > MAX_OPERATION_TIMEOUT_MS)
  ) {
    throw new ApiRequestError(`'timeoutMs' muss zwischen 200 und ${MAX_OPERATION_TIMEOUT_MS} liegen.`);
  }
  return {
    args: args as Record<string, unknown>,
    ...(timeoutMs === undefined ? {} : { timeoutMs: timeoutMs as number }),
  };
}

export function createSseApiServer(options: SseApiServerOptions): Server {
  const { config, execute } = options;
  const log = options.log ?? (() => undefined);
  const safeLog = (record: Record<string, unknown>): void => {
    try { log(record); } catch { /* Diagnose darf niemals API-Antworten verhindern. */ }
  };

  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = Date.now();
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      sendJson(response, 400, apiError(requestId, "bad-request", "Ungueltiger Anfragepfad."));
      return;
    }
    if (url.search) {
      sendJson(response, 400, apiError(requestId, "bad-request", "Query-Parameter sind fuer die lokale SSE-API nicht erlaubt."));
      return;
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true, apiVersion: SSE_API_VERSION });
      return;
    }

    if (!safeTokenEqual(bearerToken(request), config.token)) {
      sendJson(
        response,
        401,
        apiError(requestId, "unauthorized", "Gueltiges Bearer-Token erforderlich."),
        { "www-authenticate": 'Bearer realm="steuer-spar-erklaerung-api"' },
      );
      return;
    }

    if (request.method === "GET" && url.pathname === `/${SSE_API_VERSION}/operations`) {
      sendJson(response, 200, SSE_API_DISCOVERY);
      return;
    }

    if (request.method === "GET" && url.pathname === `/${SSE_API_VERSION}/openapi.json`) {
      sendJson(response, 200, SSE_OPENAPI_DOCUMENT);
      return;
    }

    const match = new RegExp(`^/${SSE_API_VERSION}/operations/([a-z_]+)$`).exec(url.pathname);
    if (!match) {
      sendJson(response, 404, apiError(requestId, "not-found", "API-Endpunkt nicht gefunden."));
      return;
    }

    const operationName = match[1]!;
    if (!isSseApiOperation(operationName)) {
      sendJson(response, 404, apiError(requestId, "operation-not-allowed", "Operation ist nicht freigegeben."));
      return;
    }
    if (request.method === "GET") {
      sendJson(response, 200, apiOperationDiscovery(operationName));
      return;
    }
    if (request.method !== "POST") {
      sendJson(
        response,
        405,
        apiError(requestId, "method-not-allowed", "Fuer diese Route sind nur GET und POST erlaubt."),
        { allow: "GET, POST" },
      );
      return;
    }
    if (!hasJsonContentType(request)) {
      sendJson(
        response,
        415,
        apiError(requestId, "unsupported-media-type", "POST-Anfragen muessen Content-Type application/json verwenden."),
      );
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortOnClosedResponse = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once("aborted", abort);
    response.once("close", abortOnClosedResponse);
    try {
      let decoded: unknown;
      try {
        decoded = await readJson(request);
      } catch (error) {
        if (error instanceof SyntaxError) throw new ApiRequestError("Anfragekoerper ist kein gueltiges JSON.");
        throw error;
      }
      const body = parseOperationRequest(decoded);
      let args: Record<string, unknown>;
      try {
        args = parseApiOperationArgs(operationName, body.args ?? {});
      } catch (error) {
        if (error instanceof ZodError) {
          throw new ApiRequestError(formatOperationArgumentError(error), 400, "bad-args");
        }
        throw error;
      }
      const result = await execute(operationName, args, body.timeoutMs, controller.signal);
      const envelope: OperationEnvelope = {
        apiVersion: SSE_API_VERSION,
        requestId,
        operation: operationName,
        durationMs: Date.now() - started,
        result,
      };
      const operationLog = {
        event: "operation",
        requestId,
        operation: operationName,
        durationMs: envelope.durationMs,
        ok: result.ok,
        ...(result.kind ? { kind: result.kind } : {}),
      };
      const sendOutcome = sendJson(response, 200, envelope, {}, () => safeLog(operationLog));
      if (sendOutcome === "unavailable") return;
      if (sendOutcome === "too-large") {
        safeLog({
          event: "operation-error",
          requestId,
          operation: operationName,
          durationMs: envelope.durationMs,
          code: "response-too-large",
        });
        sendJson(
          response,
          502,
          apiError(
            requestId,
            "response-too-large",
            `SSE-API-Ergebnis ist groesser als ${MAX_API_RESPONSE_BYTES} Bytes und wurde nicht uebertragen.`,
          ),
        );
        return;
      }
    } catch (error) {
      const requestError = error instanceof ApiRequestError ? error : undefined;
      const status = requestError?.status ?? 502;
      const code = requestError?.code ?? "worker-failed";
      safeLog({
        event: "operation-error",
        requestId,
        operation: operationName,
        durationMs: Date.now() - started,
        code,
        errorName: error instanceof Error ? error.name : "Error",
      });
      sendJson(
        response,
        status,
        apiError(requestId, code, requestError?.message ?? "SSE-Arbeitsprozess ist fehlgeschlagen."),
      );
    } finally {
      request.off("aborted", abort);
      response.off("close", abortOnClosedResponse);
    }
  });
  // Die fachliche Operation darf bis zu fuenf Minuten laufen; Header und
  // Request-Body einer lokalen JSON-Anfrage muessen dagegen zeitnah vollstaendig
  // eintreffen. Das verhindert haengende Slow-Body-Verbindungen vor dem Executor.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}

export async function listenSseApiServer(server: Server, host: string, port: number): Promise<void> {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("SSE-API darf nur an einen Loopback-Host gebunden werden.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SSE-API-Port muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
