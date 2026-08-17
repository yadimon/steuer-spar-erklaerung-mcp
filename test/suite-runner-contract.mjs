import assert from "node:assert/strict";
import {
  exclusiveSteps,
  fastBuildSteps,
  fastSteps,
  finalSteps,
  parallelSteps,
  serialBuildSteps,
} from "./suite-plan.mjs";
import {
  DEFAULT_FAILURE_OUTPUT_LIMIT_BYTES,
  DEFAULT_STEP_OUTPUT_LIMIT_BYTES,
  DEFAULT_STEP_TIMEOUT_MS,
  resolveConcurrency,
  resolveVerboseOutput,
  runSeries,
  runStep,
  runWithConcurrency,
} from "./suite-runner.mjs";

const expectedNames = [
  "dist-prune", "native-build", "typescript-build", "suite-runner-contract", "public-skills", "repository-privacy", "repository-links", "github-workflow", "javascript-syntax", "powershell-syntax", "product-profiles", "page-objects-parity", "product-profile-status", "profile-operation-policy",
  "akad-parser", "case-file", "setup-wizard", "atomic-files", "jsonl-logger", "dist-artifacts", "release-metadata", "native-build-cache", "portable-package", "npm-package", "portable-zip", "portable-archive-verification", "portable-release-verification", "workspace-containment", "workspace-file-cancellation",
  "resource-references", "live-script-resource-contract", "backup-cases-contract", "backup-local-parity", "archive-cases-synthetic", "archive-local-parity", "sse-process-guard", "setup-task", "api-contract", "api-static-documents", "api-client-body-abort", "api-client-transport-timeout", "api-local-http-transport", "checker-open-contract", "api-discovery-contract", "api-openapi-contract", "api-cli-contract", "api-config-contract", "api-all-operations", "launch-orchestration", "operation-schema-catalog", "operation-coverage-merge", "verification-doc-coverage", "operation-result-shape-merge", "operation-trace", "live-profile-read-coverage", "operation-live-evidence", "live-core-read-contract", "result-contract", "result-field-worker-guard", "source-architecture", "no-year-conditionals", "mcp-module-boundaries", "mcp-main-contract",
  "mcp-registry-contract", "mcp-response-contract", "capabilities-contract", "ustva-contract", "api-tax-journeys", "api-main-smoke", "abort-contract", "wrapper-boundary", "mcp-wrapper-catalog", "mcp-api-all-operations", "mcp-cancellation",
  "worker-timeout", "worker-inherited-pipe", "worker-progress-contract", "worker-output-file-contract", "worker-input-file-contract", "direct-worker-guard", "direct-worker-experimental-guard", "experimental-dialog-policy", "startup-dialog-policy", "direct-worker-resource-guard", "direct-worker-identity-guard", "direct-worker-collection-guard", "direct-worker-file-guard", "direct-worker-native-guard", "scenario-parity", "scenario-control-flow", "mcp-selftest", "table-region",
  "product-gate", "verify-collect", "verify-local-parity", "working-copy-local-parity", "file-operations-worker", "archive-cases", "table-values", "table-add-rollback-contract", "table-delete-rebinding", "table-window-scope", "tracked-date-rollback", "desktop-enumeration", "desktop-marker-contract", "desktop-marker-write-contract", "window-restore-contract", "window-scope", "structure-binding", "snapshot-runtime-id", "checker-zero-results", "build-drift", "foreground-lease-contract", "focusless-commit-contract", "no-console-window", "operation-coverage", "operation-result-shape",
];
const allSteps = [...serialBuildSteps, ...parallelSteps, ...exclusiveSteps, ...finalSteps];
assert.deepEqual(allSteps.map((step) => step.name).sort(), expectedNames.sort());
assert.equal(new Set(allSteps.map((step) => step.name)).size, allSteps.length, "Testnamen muessen eindeutig sein.");
assert.deepEqual(exclusiveSteps.map((step) => step.name), ["no-console-window"]);
assert(!parallelSteps.some((step) => step.name === "no-console-window"));
// Die Abdeckungsbilanz wertet das Protokoll aller anderen Schritte aus und
// darf deshalb weder parallel noch vor ihnen laufen.
assert.deepEqual(finalSteps.map((step) => step.name), ["operation-coverage", "operation-result-shape"]);
assert(!parallelSteps.some((step) => step.name === "operation-coverage"));
assert(!fastSteps.some((step) => step.name === "operation-coverage"));
assert(!parallelSteps.some((step) => step.name === "operation-result-shape"));
assert(!fastSteps.some((step) => step.name === "operation-result-shape"));
assert.deepEqual(fastBuildSteps.map((step) => step.name), ["dist-prune", "typescript-build"]);
assert(fastSteps.length >= 20, "Der schnelle Lauf muss die breite API-/MCP-Vertragsflaeche behalten.");
assert(fastSteps.every((step) => parallelSteps.includes(step)), "Schnelle Schritte muessen aus dem Vollplan stammen.");
for (const heavyweight of [
  "portable-package", "portable-zip", "direct-worker-guard", "product-gate", "no-console-window",
  "file-operations-worker",
]) {
  assert(!fastSteps.some((step) => step.name === heavyweight), `${heavyweight} gehoert nur in den Volltest.`);
}
for (const required of [
  "api-contract", "api-discovery-contract", "api-openapi-contract", "api-cli-contract", "api-all-operations", "mcp-wrapper-catalog", "github-workflow",
  "mcp-api-all-operations", "api-tax-journeys", "operation-schema-catalog", "verification-doc-coverage", "operation-live-evidence", "live-core-read-contract", "result-contract", "result-field-worker-guard", "source-architecture", "mcp-module-boundaries", "mcp-main-contract", "repository-privacy", "repository-links", "javascript-syntax", "powershell-syntax",
  "foreground-lease-contract", "focusless-commit-contract", "desktop-enumeration", "desktop-marker-contract", "desktop-marker-write-contract", "checker-zero-results", "snapshot-runtime-id", "experimental-dialog-policy", "startup-dialog-policy", "table-delete-rebinding", "table-window-scope", "profile-operation-policy",
  "case-file", "live-script-resource-contract", "sse-process-guard", "workspace-file-cancellation", "api-static-documents", "api-client-body-abort", "api-client-transport-timeout", "api-local-http-transport", "dist-artifacts", "release-metadata", "portable-archive-verification", "portable-release-verification",
]) {
  assert(fastSteps.some((step) => step.name === required), `${required} fehlt im schnellen Sicherheitsnetz.`);
}

assert.equal(resolveConcurrency("1"), 1);
assert.equal(resolveConcurrency("16"), 16);
assert.equal(resolveConcurrency(undefined, 12), 8);
assert.equal(resolveConcurrency(undefined, 3), 3);
assert.throws(() => resolveConcurrency("0"), /zwischen 1 und 16/);
assert.throws(() => resolveConcurrency("viel"), /zwischen 1 und 16/);
assert.equal(DEFAULT_STEP_TIMEOUT_MS, 300_000);
assert.equal(DEFAULT_STEP_OUTPUT_LIMIT_BYTES, 8 * 1024 * 1024);
assert.equal(DEFAULT_FAILURE_OUTPUT_LIMIT_BYTES, 64 * 1024);
assert.equal(resolveVerboseOutput(undefined), false);
assert.equal(resolveVerboseOutput("0"), false);
assert.equal(resolveVerboseOutput("1"), true);
assert.equal(resolveVerboseOutput("true"), false);

const captureProcessOutput = async (action) => {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    await action();
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
  return { stdout, stderr };
};

const previousVerbose = process.env.SSE_TEST_VERBOSE;
delete process.env.SSE_TEST_VERBOSE;
try {
  const compact = await captureProcessOutput(() => runStep({
    name: "synthetisch-kompakt",
    command: process.execPath,
    args: ["-e", "process.stdout.write('ERFOLGSDETAIL')"],
  }));
  assert(!compact.stdout.includes("ERFOLGSDETAIL"), "Erfolgsdetails muessen standardmaessig verborgen bleiben.");
  assert(compact.stdout.includes("✓ synthetisch-kompakt"));

  process.env.SSE_TEST_VERBOSE = "1";
  const verbose = await captureProcessOutput(() => runStep({
    name: "synthetisch-ausfuehrlich",
    command: process.execPath,
    args: ["-e", "process.stdout.write('ERFOLGSDETAIL')"],
  }));
  assert(verbose.stdout.includes("ERFOLGSDETAIL"), "Verbose-Modus muss erfolgreiche Unterausgabe zeigen.");

  delete process.env.SSE_TEST_VERBOSE;
  const failed = await captureProcessOutput(() => assert.rejects(
    runStep({
      name: "synthetisch-fehlerausgabe",
      command: process.execPath,
      args: ["-e", "process.stderr.write('FEHLERDETAIL'); process.exit(7)"],
    }),
    /synthetisch-fehlerausgabe.*Exit 7/,
  ));
  assert(failed.stderr.includes("FEHLERDETAIL"), "Fehlerdetails muessen auch im kompakten Modus sichtbar bleiben.");
} finally {
  if (previousVerbose === undefined) delete process.env.SSE_TEST_VERBOSE;
  else process.env.SSE_TEST_VERBOSE = previousVerbose;
}

let active = 0;
let maximumActive = 0;
const completed = [];
await runWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
  active += 1;
  maximumActive = Math.max(maximumActive, active);
  await new Promise((resolve) => setTimeout(resolve, 10));
  completed.push(value);
  active -= 1;
});
assert.equal(maximumActive, 3);
assert.deepEqual(completed.sort(), [1, 2, 3, 4, 5, 6]);

const visited = [];
await assert.rejects(
  runWithConcurrency([1, 2, 3], 1, async (value) => {
    visited.push(value);
    if (value === 2) throw new Error("synthetischer Fehler");
  }),
  /synthetischer Fehler/,
);
assert.deepEqual(visited, [1, 2], "Nach einem Fehler duerfen keine neuen seriellen Schritte starten.");

const serial = [];
await runSeries(["a", "b", "c"], async (value) => { serial.push(value); });
assert.deepEqual(serial, ["a", "b", "c"]);

await assert.rejects(
  runStep({
    name: "synthetischer-timeout",
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 200,
  }),
  /Timeout.*synthetischer-timeout.*200 ms/,
);
await assert.rejects(
  runStep({ name: "ungueltiger-timeout", command: process.execPath, args: [], timeoutMs: 0 }),
  /Ungueltiger Testtimeout/,
);
await assert.rejects(
  runStep({
    name: "synthetisches-ausgabelimit",
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)"],
    timeoutMs: 5_000,
    maxOutputBytes: 128,
  }),
  /Ausgabelimit 128 Bytes/,
);
await assert.rejects(
  runStep({ name: "ungueltiges-ausgabelimit", command: process.execPath, args: [], maxOutputBytes: 0 }),
  /Ungueltiges Ausgabelimit/,
);

process.stdout.write(
  "Testsuite-Runner: vollstaendiger Plan, exklusive Sentinel-Grenze, Timeout, Ausgabelimit und begrenzte Parallelitaet bestanden\n",
);
