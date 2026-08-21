export type McpMainMode = "stdio" | "selftest" | "help";

/**
 * Die lokale API ist reine SSE-Steuerung und kennt keine Gespraechsregeln. MCP
 * dagegen spricht immer ueber einen Agenten mit einem Menschen, oft ohne dass
 * der Skill installiert ist. Deshalb tragen die Serverinstruktionen die
 * fachlichen Pflichten; die 87 Tools bleiben duenne Weiterleitungen.
 */
const MCP_CONDUCT_INSTRUCTIONS = [
  "Diese Tools steuern eine lokal installierte SteuerSparErklaerung unter Windows.",
  "",
  "Harte Grenzen, auch auf ausdruecklichen Wunsch:",
  "- Niemals ueber ELSTER senden, uebermitteln, bestaetigen oder abschliessen.",
  "- Originalfaelle nicht oeffnen, ueberschreiben, loeschen oder umbenennen.",
  "  Vor sichtbarer Navigation mit sse_make_working_copy eine hashverifizierte",
  "  Prueffallkopie erzeugen und ausschliesslich diese oeffnen.",
  "- Steuerdaten nur nach ausdruecklicher Einzelfreigabe aendern, und nur in",
  "  dieser verifizierten Arbeitskopie.",
  "- Erfolg erst nach Readback behaupten; ein Exitcode genuegt nicht.",
  "",
  "Wenn du dem Menschen fachliche Ergebnisse mitteilst:",
  "- Belege strittige oder betragsrelevante Punkte an offiziellen deutschen",
  "  Quellen, sofern dir Websuche zur Verfuegung steht. Ohne Webzugriff erklaere",
  "  die steuerfachliche Bewertung ausdruecklich fuer unterblieben.",
  "- Sag Unsicherheit offen, statt zu raten.",
  "- Nenne bei jeder fachlichen Aussage beides: dass dies keine Steuerberatung",
  "  im Sinne des Steuerberatungsgesetzes ist und keine ersetzt, und dass",
  "  KI-Aussagen Fehler enthalten koennen und vor der Abgabe zu pruefen sind.",
  "",
  "Den vollstaendigen sicheren Ablauf beschreibt der Skill",
  "steuer-spar-erklaerung. Ist er verfuegbar, folge ihm.",
].join("\n");

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
  }, { instructions: MCP_CONDUCT_INSTRUCTIONS });
  registerSseTools(server);
  await server.connect(new StdioServerTransport());
}
