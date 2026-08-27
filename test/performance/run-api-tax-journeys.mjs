#!/usr/bin/env node
import { HELP, parseOptions, runBenchmark } from "./performance-harness.mjs";

try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
  } else {
    const result = await runBenchmark(options);
    process.stdout.write(`summary: ${result.summaryPath}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
