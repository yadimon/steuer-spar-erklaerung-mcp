import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAbsolute, win32 } from "node:path";
import { runInNewContext } from "node:vm";
import {
  exclusiveSteps,
  fastBuildSteps,
  fastSteps,
  finalSteps,
  parallelSteps,
  serialBuildSteps,
  getTestInventory,
} from "./suite-plan.mjs";

const phases = [
  ["build", serialBuildSteps],
  ["parallel", parallelSteps],
  ["exclusive", exclusiveSteps],
  ["final", finalSteps],
];
const allSteps = phases.flatMap(([, steps]) => steps);
const snapshotPlan = () => allSteps.map((step) => ({
  command: step.command, args: [...step.args], conflictKey: step.conflictKey,
}));
const originalPlan = snapshotPlan();
const testInventory = getTestInventory();
assert.deepEqual(snapshotPlan(), originalPlan, "Deriving the inventory must not mutate the executable plan.");
const aliases = new Map([
  [serialBuildSteps.find((step) => step.name === "native-build").command, "powershell.exe"],
  [process.execPath, "node"],
]);
const runtimeByCommand = new Map([["node", "node"], ["powershell.exe", "windows-powershell"]]);
const fastNames = new Set([...fastBuildSteps, ...fastSteps].map((step) => step.name));

assert(Object.isFrozen(testInventory));
assert.deepEqual(testInventory.map((step) => step.name), allSteps.map((step) => step.name));
assert.equal(new Set(testInventory.map((step) => step.name)).size, allSteps.length);
assert.deepEqual(
  testInventory.filter((step) => step.suites.includes("fast")).map((step) => step.name),
  [...fastBuildSteps, ...fastSteps].map((step) => step.name),
  "Fast membership and order must come from the existing execution plan.",
);

let offset = 0;
for (const [phase, steps] of phases) {
  for (const step of steps) {
    const record = testInventory[offset++];
    const command = aliases.get(step.command);
    assert(command, "Every inventory command must have a reviewed executable alias.");
    assert(Object.isFrozen(record) && Object.isFrozen(record.args) && Object.isFrozen(record.suites));
    assert.deepEqual(Object.keys(record).sort(),
      ["name", "fullPhase", "suites", "runtime", "command", "args", "conflictKey"].sort());
    assert.equal(record.name, step.name);
    assert.equal(record.fullPhase, phase);
    assert.equal(record.command, command);
    assert.equal(record.runtime, runtimeByCommand.get(command));
    assert.deepEqual(record.args, step.args.map((value) => aliases.get(value) ?? value));
    assert.equal(record.conflictKey, step.conflictKey ?? null);
    assert.deepEqual(record.suites, fastNames.has(step.name) ? ["full", "fast"] : ["full"]);
    for (const value of [record.command, ...record.args]) {
      assert.equal(typeof value, "string");
      assert.equal(isAbsolute(value) || win32.isAbsolute(value), false,
        "Inventory output must not expose executable or argument paths from the host.");
    }
  }
}
assert.equal(offset, testInventory.length);
assert.deepEqual(snapshotPlan(), originalPlan, "Inventory must not rewrite commands, arguments or conflicts.");
assert.deepEqual(
  testInventory.filter((step) => step.conflictKey !== null).map((step) => [step.name, step.conflictKey]),
  allSteps.filter((step) => step.conflictKey !== undefined).map((step) => [step.name, step.conflictKey]),
);
assert.deepEqual(
  testInventory.filter((step) => step.fullPhase === "exclusive").map((step) => step.name),
  exclusiveSteps.map((step) => step.name),
);

const cliSource = readFileSync(new URL("./test-inventory.mjs", import.meta.url), "utf8");
const importStatement = 'import { getTestInventory } from "./suite-plan.mjs";';
assert.deepEqual([...cliSource.matchAll(/^import[^\n]*$/gmu)].map((match) => match[0]), [importStatement]);
assert.doesNotMatch(cliSource,
  /\bimport\s*\(|\b(?:spawn|exec|execFile|execSync|fetch|require)\s*\(|process\.(?:env|exit|kill)/u,
  "The inventory CLI may only format the imported plan and write stdout.");
const cliBody = cliSource.replace(importStatement, "");
function renderCli(args) {
  const chunks = [];
  runInNewContext(cliBody, {
    getTestInventory,
    process: Object.freeze({
      argv: Object.freeze(["node", "test/test-inventory.mjs", ...args]),
      stdout: Object.freeze({ write: (value) => { chunks.push(String(value)); return true; } }),
    }),
  }, { timeout: 1_000, contextCodeGeneration: { strings: false, wasm: false } });
  return chunks.join("");
}

const text = renderCli([]);
assert.equal(text, renderCli([]), "The display order must be stable.");
const lines = text.trimEnd().split("\n");
assert.equal(lines[0], "Test plan: full and fast suites. Phase is the full-suite phase. This command runs no tests.");
assert.equal(lines[1], "name\tfull-phase\tsuites\truntime\tconflict\tcommand");
assert.deepEqual(lines.slice(2).map((line) => line.split("\t")[0]), allSteps.map((step) => step.name));
const json = renderCli(["--json"]);
assert.equal(json, renderCli(["--json"]));
assert.deepEqual(JSON.parse(json), { schemaVersion: 1, steps: testInventory });
assert.throws(() => renderCli(["--run"]), /Usage:/u);
assert.throws(() => renderCli(["--json", "--run"]), /Usage:/u);
const originalCommand = allSteps[0].command;
try {
  allSteps[0].command = "synthetic-unreviewed-executable";
  assert.throws(() => getTestInventory(), /Unreviewed executable in test inventory step:/u);
} finally {
  allSteps[0].command = originalCommand;
}
assert.deepEqual(snapshotPlan(), originalPlan, "CLI formatting and rejected aliases must preserve the executable plan.");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.scripts["test:inventory"], "node test/test-inventory.mjs");
assert.equal(Object.hasOwn(packageJson.scripts, "pretest:inventory"), false,
  "The print-only inventory command must not acquire an npm pre-hook.");
assert.equal(Object.hasOwn(packageJson.scripts, "posttest:inventory"), false,
  "The print-only inventory command must not acquire an npm post-hook.");

process.stdout.write("Test inventory: canonical order, fast membership, conflicts, path aliases and print-only CLI passed.\n");
