export const SETUP_USAGE = [
  "SSE-API und MCP einrichten (deutsche Standardwerte)",
  "",
  "Aufruf:",
  "  steuer-spar-erklaerung-setup         Interaktiven Assistenten starten",
  "  steuer-spar-erklaerung-setup --help  Diese Hilfe anzeigen",
].join("\n");

export function parseSetupArguments(args: readonly string[]): { help: boolean } {
  if (args.length === 0) return { help: false };
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) return { help: true };
  throw new Error("Ungueltige Setup-Argumente. Erlaubt sind keine Argumente, --help oder -h.");
}
