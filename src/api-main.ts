#!/usr/bin/env node
import { API_MAIN_USAGE, parseApiMainArguments } from "./api-main-arguments.js";

/**
 * Ein belegter Port ist der einzige Startfehler, der still in die falsche API
 * fuehren kann: ein Agent wuerde sonst weiter ueber eine bereits laufende,
 * anders konfigurierte Instanz arbeiten. Deshalb wird er eindeutig benannt.
 */
function describePortConflict(error: unknown): unknown {
  const listen = error as { code?: unknown; address?: unknown; port?: unknown };
  if (listen?.code !== "EADDRINUSE") return error;
  const address = typeof listen.address === "string" ? listen.address : "127.0.0.1";
  const port = typeof listen.port === "number" ? listen.port : 0;
  return new Error(
    `Auf ${address}:${port} laeuft bereits eine SSE-API. ` +
    "Nicht fortfahren: die laufende Instanz kann anders konfiguriert sein. " +
    "Entweder diese Instanz weiterverwenden oder sie zuerst mit Strg+C beenden.",
  );
}

async function main(): Promise<void> {
  const args = parseApiMainArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${API_MAIN_USAGE}\n`);
    return;
  }
  const { assertForegroundCaseDirectory, ensureForegroundApiFirstRun } = await import("./api-first-run.js");
  if (args.caseDir) assertForegroundCaseDirectory(args.caseDir);
  const firstRun = ensureForegroundApiFirstRun(args.configPath);
  const { runApiRuntime } = await import("./api-runtime.js");
  const ready = await runApiRuntime(args.configPath, args.caseDir ? { caseDir: args.caseDir } : {})
    .catch((error: unknown) => { throw describePortConflict(error); });
  if (firstRun.created) process.stdout.write(`Lokale Standardkonfiguration erstellt: ${firstRun.configPath}\n`);
  process.stdout.write(
    `SSE-API bereit: ${ready.baseUrl} (${args.caseDir ? "Fallordner fuer diesen Lauf gebunden" : "kein Fallordner gebunden"}).\n` +
    "Dieses Terminal offen lassen; Strg+C beendet die API.\n",
  );
}

process.on("unhandledRejection", (error) => {
  process.stderr.write(`Unbehandelte Promise-Ablehnung: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

main().catch((error: unknown) => {
  process.stderr.write(`SSE-API-Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
