/**
 * Registriert den vollstaendigen MCP-Katalog in fachlich getrennten Gruppen.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAnalysisTools } from "./mcp-tools-analysis.js";
import { createMcpRegistry } from "./mcp-registry.js";
import { registerDesktopTools } from "./mcp-tools-desktop.js";
import { registerDiagnosticTools } from "./mcp-tools-diagnostics.js";
import { registerInteractionTools } from "./mcp-tools-interaction.js";
import { registerLifecycleTools } from "./mcp-tools-lifecycle.js";
import { registerReceiptTools } from "./mcp-tools-receipts.js";
import { registerUiTools } from "./mcp-tools-ui.js";

export function registerSseTools(server: McpServer) {
  const registry = createMcpRegistry(server);
  registerDiagnosticTools(registry);
  registerAnalysisTools(registry);
  registerDesktopTools(registry);
  registerUiTools(registry);
  registerReceiptTools(registry);
  registerInteractionTools(registry);
  registerLifecycleTools(registry);
  return registry;
}
