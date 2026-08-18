#!/usr/bin/env node
import { API_MAIN_USAGE, parseApiMainArguments } from "./api-main-arguments.js";

async function main(): Promise<void> {
  const args = parseApiMainArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${API_MAIN_USAGE}\n`);
    return;
  }
  const { runApiRuntime } = await import("./api-runtime.js");
  await runApiRuntime(args.configPath);
}

process.on("unhandledRejection", (error) => {
  process.stderr.write(`Unbehandelte Promise-Ablehnung: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

main().catch((error: unknown) => {
  process.stderr.write(`SSE-API-Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
