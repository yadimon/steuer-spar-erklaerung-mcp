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
  SSE_MCP_COMPOSED_TOOL_OPERATIONS,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_MCP_TOOL_SCHEMAS,
  type SseMcpComposedToolName,
  type SseMcpDirectToolName,
  type SseMcpToolName,
} from "./operation-catalog.js";
import { operationAnnotations } from "./operation-traits.js";
import { SSE_API_RESULT_OUTPUT_SCHEMAS } from "./result-contract.js";
import { assertApiSingletonIdentity } from "./mcp-api-supervisor.js";

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

  async function callApiOperation(
    operation: SseApiOperation,
    args: Record<string, unknown> = {},
    timeoutMs?: number,
  ) {
    const signal = requestAbortSignal.getStore();
    const health = await assertApiSingletonIdentity();
    return callApiOperationDirect(operation, args, timeoutMs, {
      expectedInstanceId: health.instanceId,
      ...(signal ? { signal } : {}),
    });
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
  function registerToolWithOperations<Shape extends z.ZodRawShape>(
    name: SseMcpToolName,
    operations: readonly SseApiOperation[],
    config: {
      title?: string;
      description?: string;
      inputSchema: Shape;
      outputSchema?: z.ZodTypeAny;
    },
    callback: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
  ) {
    const firstOperation = operations[0];
    if (!firstOperation) throw new Error(`MCP-Werkzeug '${name}' besitzt keine API-Basisoperation.`);
    const traits = operations.map((operation) => operationAnnotations(operation));
    return server.registerTool(
      name,
      {
        ...config,
        inputSchema: z.object(config.inputSchema).strict(),
        annotations: {
          readOnlyHint: traits.every((entry) => entry.readOnlyHint),
          destructiveHint: traits.some((entry) => entry.destructiveHint),
          idempotentHint: traits.every((entry) => entry.idempotentHint),
          openWorldHint: false,
        },
      },
      (args, extra) => requestAbortSignal.run(extra.signal, async () => {
        let validationOperation = firstOperation;
        try {
          for (const operation of operations) {
            validationOperation = operation;
            assertApiArgumentBudget(operation, args);
            parseApiOperationArgs(operation, args);
          }
        } catch (error) {
          const message = error instanceof z.ZodError
            ? formatOperationArgumentError(error, validationOperation)
            : error instanceof Error ? error.message : String(error);
          return errorResult(`Ungueltige MCP-Argumente: ${message}`);
        }
        try {
          return await callback(args);
        } catch (error) {
          return caughtErrorResult(firstOperation, error);
        }
      }),
    );
  }

  function registerStrictTool<Shape extends z.ZodRawShape>(
    name: SseMcpDirectToolName,
    config: {
      title?: string;
      description?: string;
      inputSchema: Shape;
      outputSchema?: z.ZodTypeAny;
    },
    callback: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
  ) {
    return registerToolWithOperations(name, [SSE_MCP_TOOL_OPERATIONS[name]], config, callback);
  }

  function registerComposedTool<Shape extends z.ZodRawShape>(
    name: SseMcpComposedToolName,
    config: {
      title?: string;
      description?: string;
      inputSchema: Shape;
      outputSchema?: z.ZodTypeAny;
    },
    callback: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
  ) {
    return registerToolWithOperations(name, SSE_MCP_COMPOSED_TOOL_OPERATIONS[name], config, callback);
  }

  function registerApiTool(
    name: SseMcpDirectToolName,
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
    name: SseMcpDirectToolName,
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
    registerComposedTool,
    registerShapedApiTool,
    registerStrictTool,
    run,
  };
}

export type McpRegistry = ReturnType<typeof createMcpRegistry>;
