import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  MAX_API_BODY_BYTES,
  MAX_OPERATION_TIMEOUT_MS,
  SSE_API_OPERATIONS,
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
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(json);
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

async function readJson(request: IncomingMessage): Promise<unknown> {
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
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function parseOperationRequest(value: unknown): OperationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError("Anfragekoerper muss ein JSON-Objekt sein.");
  }
  const body = value as Record<string, unknown>;
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
  return { args: args as Record<string, unknown>, timeoutMs: timeoutMs as number | undefined };
}

export function createSseApiServer(options: SseApiServerOptions): Server {
  const { config, execute } = options;
  const log = options.log ?? (() => undefined);

  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = Date.now();
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      sendJson(response, 400, apiError(requestId, "bad-request", "Ungueltiger Anfragepfad."));
      return;
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true, apiVersion: SSE_API_VERSION });
      return;
    }

    if (!safeTokenEqual(bearerToken(request), config.token)) {
      sendJson(response, 401, apiError(requestId, "unauthorized", "Gueltiges Bearer-Token erforderlich."));
      return;
    }

    if (request.method === "GET" && url.pathname === `/${SSE_API_VERSION}/operations`) {
      sendJson(response, 200, { apiVersion: SSE_API_VERSION, operations: SSE_API_OPERATIONS });
      return;
    }

    const match = new RegExp(`^/${SSE_API_VERSION}/operations/([a-z_]+)$`).exec(url.pathname);
    if (request.method !== "POST" || !match) {
      sendJson(response, 404, apiError(requestId, "not-found", "API-Endpunkt nicht gefunden."));
      return;
    }

    const operationName = match[1];
    if (!isSseApiOperation(operationName)) {
      sendJson(response, 404, apiError(requestId, "operation-not-allowed", "Operation ist nicht freigegeben."));
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
      log({
        event: "operation",
        requestId,
        operation: operationName,
        durationMs: envelope.durationMs,
        ok: result.ok,
        ...(result.kind ? { kind: result.kind } : {}),
      });
      sendJson(response, 200, envelope);
    } catch (error) {
      const requestError = error instanceof ApiRequestError ? error : undefined;
      const status = requestError?.status ?? 502;
      const code = requestError?.code ?? "worker-failed";
      log({
        event: "operation-error",
        requestId,
        operation: operationName,
        durationMs: Date.now() - started,
        code,
        errorName: error instanceof Error ? error.name : "Error",
        ...(requestError ? { message: requestError.message } : {}),
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
}

export async function listenSseApiServer(server: Server, host: string, port: number): Promise<void> {
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
