#!/usr/bin/env node
/**
 * MCP-Server fuer die SteuerSparErklaerung (Akademische Arbeitsgemeinschaft).
 *
 * HARTE GRENZE: Dieser Server uebermittelt NIEMALS etwas ans Finanzamt.
 * Alle ELSTER-/Versandwege sind im Worker gesperrt.
 */
import { runMcpMain } from "./mcp-main.js";
import { redactLocalPathText } from "./mcp-response.js";

runMcpMain(process.argv.slice(2)).catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Start fehlgeschlagen: ${redactLocalPathText(detail)}\n`);
  process.exitCode = 1;
});
