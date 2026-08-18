import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { callApiOperation as callApiOperationDirect } from "./api-client.js";
import { ApiClientError } from "./api-client-error.js";
import type { SseApiOperation } from "./api-contract.js";
import { apiErrorResult, apiSuccessResult, errorResult } from "./mcp-response.js";
import {
  assertApiArgumentBudget,
  formatOperationArgumentError,
  parseApiOperationArgs,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_MCP_TOOL_SCHEMAS,
  type SseMcpToolName,
} from "./operation-catalog.js";
import { operationAnnotations } from "./operation-traits.js";
import { SSE_API_RESULT_OUTPUT_SCHEMAS } from "./result-contract.js";

type ToolConfig = { title: string; description: string; };
type ApiResultShape = (result: Record<string, unknown>) => unknown;

export function apiResultOutputSchema(operation: SseApiOperation): z.ZodTypeAny {
  return SSE_API_RESULT_OUTPUT_SCHEMAS[operation];
}

/**
 * Kapselt die gesamte MCP-Transportgrenze: strikte Schemas, Groessenbudgets,
 * Request-Abbruch und die einheitliche Uebersetzung von API-Antworten.
 */
export function createMcpRegistry(server: McpServer) {
  const requestAbortSignal = new AsyncLocalStorage<AbortSignal>();

  function callApiOperation(
    operation: SseApiOperation,
    args: Record<string, unknown> = {},
    timeoutMs?: number,
  ) {
    const signal = requestAbortSignal.getStore();
    return callApiOperationDirect(operation, args, timeoutMs, signal ? { signal } : {});
  }

  function caughtErrorResult(operation: SseApiOperation, error: unknown): CallToolResult {
    if (error instanceof ApiClientError) {
      return apiErrorResult(operation, { ok: false, kind: error.kind, error: error.message });
    }
    return errorResult(String(error));
  }

  async function run(
    operation: SseApiOperation,
    args: Record<string, unknown> = {},
    shape?: ApiResultShape,
    timeoutMs?: number,
  ): Promise<CallToolResult> {
    try {
      const result = await callApiOperation(operation, args, timeoutMs);
      if (result.ok === false) return apiErrorResult(operation, result);
      const shaped = shape ? shape(result) : result;
      // Focus-Telemetrie gehoert zum Sicherheits-/Performancevertrag jeder
      // physischen Action. Auch kompakt geformte MCP-Antworten duerfen sie
      // nicht verlieren; read-only Ergebnisse enthalten das Feld gar nicht.
      const payload = shape && result.focusTelemetry && shaped && typeof shaped === "object" && !Array.isArray(shaped)
        ? { ...shaped, focusTelemetry: result.focusTelemetry }
        : shaped;
      return apiSuccessResult(payload, result);
    } catch (error) {
      return caughtErrorResult(operation, error);
    }
  }

  /**
   * Der SDK-Pfad fuer ein rohes Zod-Shape entfernt unbekannte Argumente zur
   * Laufzeit still. Das strikte Objekt verhindert dadurch riskante Defaults.
   */
  function registerStrictTool<Shape extends z.ZodRawShape>(
    name: SseMcpToolName,
    config: {
      title?: string;
      description?: string;
      inputSchema: Shape;
      outputSchema?: z.ZodTypeAny;
    },
    callback: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
  ) {
    return server.registerTool(
      name,
      {
        ...config,
        inputSchema: z.object(config.inputSchema).strict(),
        annotations: operationAnnotations(SSE_MCP_TOOL_OPERATIONS[name]),
      },
      (args, extra) => requestAbortSignal.run(extra.signal, async () => {
        try {
          assertApiArgumentBudget(SSE_MCP_TOOL_OPERATIONS[name], args);
          parseApiOperationArgs(SSE_MCP_TOOL_OPERATIONS[name], args);
        } catch (error) {
          const message = error instanceof z.ZodError
            ? formatOperationArgumentError(error)
            : error instanceof Error ? error.message : String(error);
          return errorResult(`Ungueltige MCP-Argumente: ${message}`);
        }
        try {
          return await callback(args);
        } catch (error) {
          return caughtErrorResult(SSE_MCP_TOOL_OPERATIONS[name], error);
        }
      }),
    );
  }

  function registerApiTool(
    name: SseMcpToolName,
    config: ToolConfig,
    options: { timeoutMs?: number; } = {},
  ) {
    const schema = SSE_MCP_TOOL_SCHEMAS[name] as z.AnyZodObject;
    return registerStrictTool(
      name,
      { ...config, inputSchema: schema.shape, outputSchema: apiResultOutputSchema(SSE_MCP_TOOL_OPERATIONS[name]) },
      async (args) => run(SSE_MCP_TOOL_OPERATIONS[name], args, undefined, options.timeoutMs),
    );
  }

  function registerShapedApiTool(
    name: SseMcpToolName,
    config: ToolConfig,
    shape: ApiResultShape,
    options: { timeoutMs?: number; } = {},
  ) {
    const schema = SSE_MCP_TOOL_SCHEMAS[name] as z.AnyZodObject;
    return registerStrictTool(
      name,
      { ...config, inputSchema: schema.shape, outputSchema: apiResultOutputSchema(SSE_MCP_TOOL_OPERATIONS[name]) },
      async (args) => run(SSE_MCP_TOOL_OPERATIONS[name], args, shape, options.timeoutMs),
    );
  }

  return {
    callApiOperation,
    caughtErrorResult,
    registerApiTool,
    registerShapedApiTool,
    registerStrictTool,
    run,
  };
}

export type McpRegistry = ReturnType<typeof createMcpRegistry>;
