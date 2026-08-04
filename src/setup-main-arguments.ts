export const SETUP_USAGE = [
  "SSE-API und MCP einrichten (deutsche Standardwerte)",
  "",
  "Aufruf:",
  "  steuer-spar-erklaerung-setup         Interaktiven Assistenten starten",
  "  steuer-spar-erklaerung-setup --defaults  Sichere Defaults ohne optionale Rueckfragen verwenden",
  "  steuer-spar-erklaerung-setup --no-start  Dateien erzeugen, API aber noch nicht starten",
  "  steuer-spar-erklaerung-setup --help  Diese Hilfe anzeigen",
].join("\n");

export interface SetupArguments {
  help: boolean;
  defaults: boolean;
  startApi: boolean;
}

export function parseSetupArguments(args: readonly string[]): SetupArguments {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    return { help: true, defaults: false, startApi: false };
  }
  const allowed = new Set(["--defaults", "--no-start"]);
  const unknown = args.filter((argument) => !allowed.has(argument));
  if (unknown.length || new Set(args).size !== args.length) {
    throw new Error(
      "Ungueltige Setup-Argumente. Erlaubt sind --defaults, --no-start, --help oder -h.",
    );
  }
  return {
    help: false,
    defaults: args.includes("--defaults"),
    startApi: !args.includes("--no-start"),
  };
}
