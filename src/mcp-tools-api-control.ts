import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClientError } from "./api-client-error.js";
import { controlApiSingleton, type ApiControlRequest } from "./mcp-api-supervisor.js";
import { apiErrorResult, apiSuccessResult } from "./mcp-response.js";
import { parseApiControlRequest, SSE_MCP_API_CONTROL_OUTPUT_SCHEMA, SSE_MCP_API_CONTROL_SCHEMAS } from "./mcp-schemas-api-control.js";

/** Prozesssteuerung ist keine Steuerfalloperation und erreicht keinen Worker. */
export function registerApiControlTools(server: McpServer): void {
  const schema = SSE_MCP_API_CONTROL_SCHEMAS.sse_api_control;
  server.registerTool("sse_api_control", {
    title: "Lokale API steuern",
    description: "Liest den API-Status oder beendet die gebundene, auftragsfreie API und startet sie auf ausdruecklichen Auftrag erneut. " +
      "shutdown/start verlangen confirm=true und die instanceId aus status. Annahme und Prozessende werden getrennt gemeldet. " +
      "SSE und Steuerfaelle bleiben offen; MCP bleibt erreichbar. Nach Stopp kein stiller Neustart. " +
      "start verwendet ausschliesslich die unveraenderte urspruengliche API-Konfiguration; bei reiner SSE_API_URL ist kein Start moeglich.",
    inputSchema: schema,
    outputSchema: SSE_MCP_API_CONTROL_OUTPUT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (raw) => {
    try {
      const args = parseApiControlRequest(raw);
      const request: ApiControlRequest = args.action === "status"
        ? { action: "status" }
        : { action: args.action, confirm: true, instanceId: args.instanceId! };
      const result = await controlApiSingleton(request);
      return result.ok === false ? apiErrorResult("api_control", result) : apiSuccessResult(result, result);
    } catch (error) {
      return apiErrorResult("api_control", {
        ok: false, kind: error instanceof ApiClientError ? error.kind : "bad-args",
        error: error instanceof Error ? error.message : "API-Steuerung fehlgeschlagen.",
      });
    }
  });
}
