import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exclusiveSteps, finalSteps, parallelSteps, serialBuildSteps } from "./suite-plan.mjs";
import { OPERATION_TRACE_DIRECTORY_KEY } from "./operation-trace.mjs";
import { resolveConcurrency, runSeries, runWithConcurrency, runStep } from "./suite-runner.mjs";

await runSeries(serialBuildSteps, runStep);

// Jeder instrumentierte Harnisch legt hier seine eigene Protokolldatei ab.
// Der letzte Schritt vergleicht das Ergebnis mit der Abdeckungsbilanz.
const traceDirectory = mkdtempSync(join(tmpdir(), "sse-operation-trace-"));
process.env[OPERATION_TRACE_DIRECTORY_KEY] = traceDirectory;
process.env.SSE_TEST_COVERAGE_SCOPE = "offline";

try {
  const concurrency = resolveConcurrency(process.env.SSE_TEST_CONCURRENCY);
  process.stdout.write(`\n> ${parallelSteps.length} konfliktfreie Tests mit maximal ${concurrency} Prozessen\n`);
  await runWithConcurrency(parallelSteps, concurrency, runStep);

  // Dieser Sentinel muss allein laufen: parallele Kindprozesse koennten sonst
  // echte neu sichtbare Konsolenfenster nicht eindeutig dem MCP-Aufruf zuordnen.
  await runSeries(exclusiveSteps, runStep);
  await runSeries(finalSteps, runStep);
} finally {
  rmSync(traceDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

process.stdout.write("\nAlle portable API-/MCP-Tests bestanden.\n");
