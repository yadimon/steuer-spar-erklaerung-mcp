import { fastBuildSteps, fastSteps } from "./suite-plan.mjs";
import { resolveConcurrency, runSeries, runStep, runWithConcurrency } from "./suite-runner.mjs";

await runSeries(fastBuildSteps, runStep);

const concurrency = resolveConcurrency(process.env.SSE_TEST_CONCURRENCY);
process.stdout.write(`\n> ${fastSteps.length} schnelle Vertraege mit maximal ${concurrency} Prozessen\n`);
await runWithConcurrency(fastSteps, concurrency, runStep);

process.stdout.write("\nSchnelle API-/MCP-Vertraege bestanden; die echten Worker-Gates bleiben Aufgabe von npm test.\n");
