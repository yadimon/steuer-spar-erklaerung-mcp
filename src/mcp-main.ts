export type McpMainMode = "stdio" | "selftest" | "help";

/**
 * Die lokale API ist reine SSE-Steuerung und kennt keine Gespraechsregeln. MCP
 * dagegen spricht immer ueber einen Agenten mit einem Menschen, oft ohne dass
 * der Skill installiert ist. Deshalb tragen die Serverinstruktionen die
 * fachlichen Pflichten; die Tools bleiben duenne Weiterleitungen.
 */
const MCP_CONDUCT_INSTRUCTIONS = [
  "Diese Tools steuern eine lokal installierte SteuerSparErklaerung unter Windows.",
  "",
  "Harte Grenzen, auch auf ausdruecklichen Wunsch:",
  "- Niemals ueber ELSTER senden, uebermitteln, bestaetigen oder abschliessen.",
  "- Originalfaelle nie loeschen, umbenennen oder auf Dateiebene ueberschreiben;",
  "  uebermittelte Faelle nie speichern oder veraendern.",
  "- Ist genau ein Steuerfall bereits offen, ist er der Arbeitsfall. Nicht still",
  "  eine Arbeits-/Korrekturkopie erzeugen oder oeffnen, keinen anderen Fall",
  "  starten und den offenen Fall weder speichern noch schliessen.",
  "- Vor der ersten Aenderung oder einer UI-Navigation, die den Fall dirty machen",
  "  kann, den aktuellen Dateihash lesen und mit sse_make_working_copy genau eine",
  "  hashverifizierte Sicherung nach backups: erzeugen. Dieselbe Sicherung fuer",
  "  denselben Fall und unveraenderten Dateihash in der laufenden Aufgabe",
  "  wiederverwenden; nicht vor jedem Tool-Aufruf neu sichern. Nach einem",
  "  ausdruecklich beauftragten Speichern muss die naechste Aenderung den neuen",
  "  Dateistand erneut sichern. Eine backups:-Sicherung niemals oeffnen.",
  "- Aendern erlaubt kein Speichern. sse_save nur nach ausdruecklichem Auftrag zum",
  "  Speichern; sse_save_as oder eine cases:-Kopie nur, wenn der Mensch genau eine",
  "  neue Datei/Kopie verlangt. Muss fuer einen anderen Fall gewechselt werden und",
  "  der offene Fall ist ungespeichert, zuerst den Menschen fragen; nie still",
  "  speichern, verwerfen, schliessen oder wechseln.",
  "- Erfolg erst nach Readback behaupten; ein Exitcode genuegt nicht.",
  "",
  "Wenn du dem Menschen fachliche Ergebnisse mitteilst:",
  "- Belege strittige oder betragsrelevante Punkte an offiziellen deutschen",
  "  Quellen, sofern dir Websuche zur Verfuegung steht. Ohne Webzugriff erklaere",
  "  die steuerfachliche Bewertung ausdruecklich fuer unterblieben.",
  "  Rangfolge: Gesetz (gesetze-im-internet.de), dann BMF-Schreiben",
  "  (bundesfinanzministerium.de; aeltere nur noch im Bundessteuerblatt,",
  "  bstbl.de), dann amtliche Anleitungen (formulare-bfinv.de, elster.de),",
  "  dann BFH (bundesfinanzhof.de), dazu bzst.de fuer Belegabruf und",
  "  Auslandsfaelle. Ratgeberseiten und Foren sind keine Belegstellen.",
  "  Pruefe immer, ob die Fundstelle zum Veranlagungszeitraum des Falls passt.",
  "- Die Steuertipps im Programm (sse_help, rechte Spalte) und das",
  "  Steuertipps-Center geben die Auffassung des Herstellers fuer dieses",
  "  Produktjahr wieder. Guter Einstieg und guter Hinweis, wo etwas hingehoert",
  "  - aber keine Rechtsquelle. Vor der Websuche lohnt trotzdem der Blick",
  "  dorthin: schneller und sicher zum Falljahr passend.",
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
