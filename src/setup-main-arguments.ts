export const SETUP_USAGE = [
  "SSE-API und MCP einrichten (deutsche Standardwerte)",
  "",
  "Aufruf:",
  "  steuer-spar-erklaerung-setup         Interaktiven Assistenten starten",
  "  steuer-spar-erklaerung-setup --defaults  Sichere Defaults ohne optionale Rueckfragen verwenden",
  "  steuer-spar-erklaerung-setup --plan-file <json>  Bestaetigten First-run-Plan ohne Prompts anwenden",
  "  steuer-spar-erklaerung-setup --with-mcp  Zusaetzlich eine tokenfreie MCP-Clientvorlage erzeugen",
  "  steuer-spar-erklaerung-setup --no-start  Dateien erzeugen, API aber noch nicht starten",
  "  steuer-spar-erklaerung-setup --check  Bestehendes lokales Setup ohne Aenderungen pruefen",
  "  steuer-spar-erklaerung-setup --help  Diese Hilfe anzeigen",
].join("\n");

export interface SetupArguments {
  help: boolean;
  defaults: boolean;
  startApi: boolean;
  check: boolean;
  withMcp: boolean;
  planFile?: string;
}

export function parseSetupArguments(args: readonly string[]): SetupArguments {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    return { help: true, defaults: false, startApi: false, check: false, withMcp: false };
  }
  if (args.length === 1 && args[0] === "--check") {
    return { help: false, defaults: false, startApi: false, check: true, withMcp: false };
  }
  let planFile: string | undefined;
  let defaults = false;
  let startApi = true;
  let withMcp = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--defaults") {
      if (defaults) throw new Error("--defaults darf nur einmal angegeben werden.");
      defaults = true;
      continue;
    }
    if (argument === "--no-start") {
      if (!startApi) throw new Error("--no-start darf nur einmal angegeben werden.");
      startApi = false;
      continue;
    }
    if (argument === "--with-mcp") {
      if (withMcp) throw new Error("--with-mcp darf nur einmal angegeben werden.");
      withMcp = true;
      continue;
    }
    if (argument === "--plan-file") {
      if (planFile !== undefined) throw new Error("--plan-file darf nur einmal angegeben werden.");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Wert fuer --plan-file fehlt.");
      planFile = value;
      index += 1;
      continue;
    }
    throw new Error(
      "Ungueltige Setup-Argumente. Erlaubt sind --defaults, --plan-file <json>, --with-mcp, --no-start, --check, --help oder -h.",
    );
  }
  if (defaults && planFile) throw new Error("--defaults und --plan-file duerfen nicht zusammen verwendet werden.");
  return {
    help: false,
    defaults,
    startApi,
    check: false,
    withMcp,
    ...(planFile ? { planFile } : {}),
  };
}
