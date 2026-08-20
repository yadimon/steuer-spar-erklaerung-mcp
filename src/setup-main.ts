#!/usr/bin/env node
import { parseSetupArguments, SETUP_USAGE } from "./setup-main-arguments.js";

async function main(args: readonly string[]): Promise<void> {
  const options = parseSetupArguments(args);
  if (options.help) {
    process.stdout.write(`${SETUP_USAGE}\n`);
    return;
  }
  if (options.check) {
    const { runSetupCheck } = await import("./setup-check.js");
    // Ein unvollstaendiges NPX-Setup meldet sich als JSON-Status auf stdout und
    // bleibt trotzdem ungleich Erfolg; ein Defekt wirft weiterhin.
    if (!await runSetupCheck(options.configPath)) process.exitCode = 1;
    return;
  }
  const { runSetupMain } = await import("./setup-wizard.js");
  await runSetupMain(args);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Setup fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
