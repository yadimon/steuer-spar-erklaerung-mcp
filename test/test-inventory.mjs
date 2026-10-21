import { getTestInventory } from "./suite-plan.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
  throw new Error("Usage: npm run --silent test:inventory -- [--json]");
}

const testInventory = getTestInventory();
const output = args[0] === "--json"
  ? JSON.stringify({ schemaVersion: 1, steps: testInventory }, null, 2)
  : [
    "Test plan: full and fast suites. Phase is the full-suite phase. This command runs no tests.",
    "name\tfull-phase\tsuites\truntime\tconflict\tcommand",
    ...testInventory.map((step) => [
      step.name, step.fullPhase, step.suites.join(","), step.runtime, step.conflictKey ?? "-",
      [step.command, ...step.args].join(" "),
    ].join("\t")),
  ].join("\n");
process.stdout.write(output + "\n");
