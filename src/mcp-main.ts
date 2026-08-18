export type McpMainMode = "stdio" | "selftest" | "help";

export function mcpMainUsage(): string {
  return [
    "SteuerSparErklaerung MCP-Wrapper",
    "",
    "Aufruf:",
    "  steuer-spar-erklaerung-mcp             MCP ueber stdio starten",
    "  steuer-spar-erklaerung-mcp --selftest  API-Verbindung pruefen",
    "  steuer-spar-erklaerung-mcp --help      Diese Hilfe anzeigen",
    "",
  ].join("\n");
}

export function parseMcpMainArguments(args: readonly string[]): McpMainMode {
  if (args.length === 0) return "stdio";
  if (args.length === 1 && args[0] === "--selftest") return "selftest";
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) return "help";
  throw new Error(`Ungueltige MCP-Argumente. Erlaubt sind keine Argumente, --selftest, --help oder -h.`);
}

export async function runMcpMain(args: readonly string[]): Promise<void> {
  const mode = parseMcpMainArguments(args);
  if (mode === "help") {
    process.stdout.write(mcpMainUsage());
    return;
  }

  if (mode === "selftest") {
    const [{ callApiOperation }, responseBoundary] = await Promise.all([
      import("./api-client.js"),
      import("./mcp-response.js"),
    ]);
    const result = await callApiOperation("health");
    process.stdout.write(`${JSON.stringify(responseBoundary.redactPcLocalPaths(result), null, 2)}\n`);
    return;
  }

  const [{ McpServer }, { StdioServerTransport }, { registerSseTools }, version] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("./mcp-tools.js"),
    import("./version.js"),
  ]);
  const server = new McpServer({
    name: version.SSE_PACKAGE_NAME,
    version: version.SSE_PACKAGE_VERSION,
  });
  registerSseTools(server);
  await server.connect(new StdioServerTransport());
}
