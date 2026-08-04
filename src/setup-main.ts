#!/usr/bin/env node
import { parseSetupArguments, SETUP_USAGE } from "./setup-main-arguments.js";

async function main(args: readonly string[]): Promise<void> {
  const options = parseSetupArguments(args);
  if (options.help) {
    process.stdout.write(`${SETUP_USAGE}\n`);
    return;
  }
  const { runSetupMain } = await import("./setup-wizard.js");
  await runSetupMain(args);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Setup fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
