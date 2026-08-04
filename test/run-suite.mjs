import { exclusiveSteps, parallelSteps, serialBuildSteps } from "./suite-plan.mjs";
import { resolveConcurrency, runSeries, runWithConcurrency, runStep } from "./suite-runner.mjs";

await runSeries(serialBuildSteps, runStep);

const concurrency = resolveConcurrency(process.env.SSE_TEST_CONCURRENCY);
process.stdout.write(`\n> ${parallelSteps.length} konfliktfreie Tests mit maximal ${concurrency} Prozessen\n`);
await runWithConcurrency(parallelSteps, concurrency, runStep);

// Dieser Sentinel muss allein laufen: parallele Kindprozesse koennten sonst
// echte neu sichtbare Konsolenfenster nicht eindeutig dem MCP-Aufruf zuordnen.
await runSeries(exclusiveSteps, runStep);

process.stdout.write("\nAlle portable API-/MCP-Tests bestanden.\n");
