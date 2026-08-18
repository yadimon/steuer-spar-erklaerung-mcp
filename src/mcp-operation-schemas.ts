import { SSE_MCP_ANALYSIS_SCHEMAS } from "./mcp-schemas-analysis.js";
import { SSE_MCP_DESKTOP_SCHEMAS } from "./mcp-schemas-desktop.js";
import { SSE_MCP_DIAGNOSTIC_SCHEMAS } from "./mcp-schemas-diagnostics.js";
import { SSE_MCP_INTERACTION_SCHEMAS } from "./mcp-schemas-interaction.js";
import { SSE_MCP_LIFECYCLE_SCHEMAS } from "./mcp-schemas-lifecycle.js";
import { SSE_MCP_UI_SCHEMAS } from "./mcp-schemas-ui.js";

export const SSE_MCP_TOOL_SCHEMAS = {
  ...SSE_MCP_DIAGNOSTIC_SCHEMAS,
  ...SSE_MCP_ANALYSIS_SCHEMAS,
  ...SSE_MCP_DESKTOP_SCHEMAS,
  ...SSE_MCP_UI_SCHEMAS,
  ...SSE_MCP_INTERACTION_SCHEMAS,
  ...SSE_MCP_LIFECYCLE_SCHEMAS,
} as const;
