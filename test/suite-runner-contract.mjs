import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  "dist-prune", "native-build", "typescript-build", "npm-package-build", "agent-plugin-build", "api-docs", "docs-consistency", "suite-runner-contract", "public-skills", "repository-privacy", "repository-links", "readme-contract", "github-workflow", "javascript-syntax", "powershell-syntax", "product-profiles", "page-objects-parity", "product-profile-status", "profile-operation-policy", "receipt-interaction-policy", "belegmanager-config-isolation", "api-mega-contract",
  "akad-parser", "table-combobox-contract", "table-combobox-guard", "case-file", "pdf-render-helper", "atomic-files", "jsonl-logger", "dist-artifacts", "release-metadata", "agent-plugin-contract", "native-build-cache", "npm-package", "workspace-containment", "workspace-file-cancellation",
  "resource-references", "live-script-resource-contract", "backup-cases-contract", "backup-local-parity", "archive-cases-synthetic", "archive-local-parity", "sse-process-guard", "desktop-launcher", "api-contract", "api-static-documents", "api-client-body-abort", "api-client-transport-timeout", "api-local-http-transport", "api-single-flight", "checker-open-contract", "api-discovery-contract", "api-openapi-contract", "api-cli-contract", "api-config-contract", "api-all-operations", "launch-orchestration", "case-create-contract", "operation-schema-catalog", "operation-coverage-merge", "verification-doc-coverage", "operation-result-shape-merge", "operation-trace", "live-profile-read-coverage", "operation-live-evidence", "live-core-read-contract", "result-contract", "result-field-worker-guard", "source-architecture", "no-year-conditionals", "mcp-module-boundaries", "mcp-main-contract", "mcp-preflight",
  "mcp-registry-contract", "mcp-response-contract", "capabilities-contract", "ustva-contract", "api-tax-journeys", "api-main-smoke", "abort-contract", "wrapper-boundary", "mcp-wrapper-catalog", "mcp-api-all-operations", "mcp-cancellation",
  "worker-timeout", "worker-inherited-pipe", "worker-prewarm", "worker-progress-contract", "worker-output-file-contract", "worker-input-file-contract", "direct-worker-guard", "direct-worker-experimental-guard", "experimental-dialog-policy", "startup-dialog-policy", "direct-worker-resource-guard", "direct-worker-identity-guard", "direct-worker-collection-guard", "direct-worker-file-guard", "direct-worker-native-guard", "scenario-parity", "scenario-control-flow", "mcp-selftest", "table-region",
  "product-gate", "verify-collect", "verify-local-parity", "working-copy-local-parity", "file-operations-worker", "archive-cases", "table-values", "instance-identity", "table-add-rollback-contract", "table-delete-rebinding", "table-window-scope", "dirty-state-binding", "tracked-date-rollback", "value-info-window", "write-window-binding", "case-binding", "recovery-answer-policy", "update-prompt", "heading-cache", "desktop-stop-policy", "process-command-line", "process-exit-wait", "describe-point-basic", "dialog-fingerprint", "content-bounds", "aside-corners", "uia-proxy-state", "tool-window-close", "tool-window-read", "receipt-manager-action", "bulk-action-executor", "bulk-action-worker-contract", "desktop-enumeration", "desktop-marker-contract", "desktop-marker-write-contract", "window-restore-contract", "window-scope", "structure-binding", "snapshot-runtime-id", "checker-zero-results", "build-drift", "foreground-lease-contract", "focusless-commit-contract", "file-dialog-folder-contract", "worker-controller-lock", "mcp-api-supervisor", "agent-plugin-runtime", "no-console-window", "operation-coverage", "operation-result-shape",
];
const allSteps = [...serialBuildSteps, ...parallelSteps, ...exclusiveSteps, ...finalSteps];
assert.deepEqual(allSteps.map((step) => step.name).sort(), expectedNames.sort());
assert.equal(new Set(allSteps.map((step) => step.name)).size, allSteps.length, "Testnamen muessen eindeutig sein.");
const offlineProductGate = parallelSteps.find((step) => step.name === "product-gate");
assert(offlineProductGate && !offlineProductGate.args.includes("--require-installed"),
  "Der Offline-Volltest darf keine lokal installierte SSE voraussetzen.");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
assert.match(packageJson.scripts?.["test:product"] ?? "", /product-gate\.mjs --require-installed$/u,
  "Der explizite lokale Produkt-Test muss eine installierte SSE verlangen.");
const suiteRunnerSource = readFileSync("test/run-suite.mjs", "utf8");
assert.doesNotMatch(suiteRunnerSource, /^import .*operation-trace\.mjs.*$/mu,
  "Der Volltest darf das dist-abhaengige Operation-Trace-Modul nicht vor dem Build importieren.");
assert(suiteRunnerSource.indexOf("await runSeries(serialBuildSteps, runStep);") <
  suiteRunnerSource.indexOf('await import("./operation-trace.mjs")'),
"Der Operation-Trace muss erst nach dem seriellen Build geladen werden.");
const liveRunner = readFileSync("test/run-live-suite.mjs", "utf8");
assert.doesNotMatch(liveRunner, /live-receipt-manager/u,
  "Der benutzerspezifische BelegManager-Zyklus gehoert in das private VM-Gate, nicht auf den lokalen PC.");
const coverage = JSON.parse(readFileSync("test/operation-coverage.json", "utf8"));
const externalLiveOperations = Object.entries(coverage.operations ?? {})
  .filter(([, value]) => value.liveEvidence === "snapshot-vm")
  .map(([name]) => name)
  .sort();
assert.deepEqual(externalLiveOperations, [
  "instances",
  "receipt_manager_action",
  "receipt_manager_bulk_upsert",
  "receipt_manager_classification_options",
  "receipt_manager_classify",
  "receipt_manager_delete",
  "receipt_manager_import",
  "receipt_manager_link",
  "receipt_manager_list",
  "receipt_manager_read",
  "vast_apply",
  "vast_dialog_read",
  "vast_mapping_options",
  "vast_mapping_select",
  "vast_row_details",
  "vast_row_set_expanded",
], "Nur BelegManager, instances und VaSt duerfen auf den privaten Snapshot-VM-Nachweis angewiesen sein.");
assert.deepEqual(exclusiveSteps.map((step) => step.name), [
  "worker-controller-lock", "mcp-api-supervisor", "agent-plugin-runtime", "no-console-window",
]);
assert.equal(exclusiveSteps[0].timeoutMs, 420_000);
const controllerConflictSteps = parallelSteps.filter((step) => step.conflictKey !== undefined);
assert.deepEqual(controllerConflictSteps.map((step) => step.name).sort(), [
  "archive-cases", "archive-cases-synthetic", "archive-local-parity",
  "backup-cases-contract", "backup-local-parity", "bulk-action-worker-contract",
  "case-file", "checker-open-contract", "desktop-marker-contract",
  "direct-worker-collection-guard", "direct-worker-experimental-guard",
  "direct-worker-file-guard", "direct-worker-guard", "direct-worker-identity-guard",
  "direct-worker-resource-guard", "file-operations-worker", "launch-orchestration",
  "mcp-selftest", "product-gate", "verify-collect", "verify-local-parity",
  "worker-inherited-pipe", "worker-input-file-contract", "worker-output-file-contract",
  "worker-timeout", "working-copy-local-parity",
].sort(), "Der vollstaendige aktuelle Katalog lock-pflichtiger Worker-Tests muss explizit bleiben.");
assert(controllerConflictSteps.every((step) => step.conflictKey === "windows-session-worker-controller"));
assert(!parallelSteps.some((step) => step.name === "no-console-window"));
assert(!parallelSteps.some((step) => step.name === "mcp-api-supervisor"));
assert(!parallelSteps.some((step) => step.name === "agent-plugin-runtime"));
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
  "direct-worker-guard", "product-gate", "mcp-api-supervisor", "no-console-window",
  "file-operations-worker",
]) {
  assert(!fastSteps.some((step) => step.name === heavyweight), `${heavyweight} gehoert nur in den Volltest.`);
}
for (const required of [
  "api-contract", "api-discovery-contract", "api-openapi-contract", "api-cli-contract", "api-all-operations", "mcp-wrapper-catalog", "github-workflow",
  "mcp-api-all-operations", "api-tax-journeys", "case-create-contract", "operation-schema-catalog", "verification-doc-coverage", "operation-live-evidence", "live-core-read-contract", "result-contract", "result-field-worker-guard", "source-architecture", "mcp-module-boundaries", "mcp-main-contract", "mcp-preflight", "repository-privacy", "repository-links", "readme-contract", "javascript-syntax", "powershell-syntax",
  "foreground-lease-contract", "focusless-commit-contract", "file-dialog-folder-contract", "desktop-enumeration", "desktop-marker-contract", "desktop-marker-write-contract", "checker-zero-results", "snapshot-runtime-id", "experimental-dialog-policy", "startup-dialog-policy", "table-delete-rebinding", "table-window-scope", "dirty-state-binding", "profile-operation-policy", "receipt-interaction-policy", "belegmanager-config-isolation", "api-mega-contract", "receipt-manager-action", "bulk-action-executor", "bulk-action-worker-contract",
  "case-binding", "recovery-answer-policy", "desktop-stop-policy", "process-exit-wait", "describe-point-basic", "case-file", "live-script-resource-contract", "sse-process-guard", "workspace-file-cancellation", "api-static-documents", "api-client-body-abort", "api-client-transport-timeout", "api-local-http-transport", "api-single-flight", "dist-artifacts", "release-metadata", "agent-plugin-contract",
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

let keyedActive = 0;
let maximumKeyedActive = 0;
let otherOverlapped = false;
await runWithConcurrency([
  { id: "controller-1", conflictKey: "worker-controller" },
  { id: "controller-2", conflictKey: "worker-controller" },
  { id: "other-1", conflictKey: "other" },
  { id: "free" },
], 3, async (item) => {
  if (item.conflictKey === "worker-controller") {
    keyedActive += 1;
    maximumKeyedActive = Math.max(maximumKeyedActive, keyedActive);
  } else if (keyedActive > 0) {
    otherOverlapped = true;
  }
  await new Promise((resolve) => setTimeout(resolve, 15));
  if (item.conflictKey === "worker-controller") keyedActive -= 1;
});
assert.equal(maximumKeyedActive, 1, "Gleiche Konfliktressourcen duerfen nie ueberlappen.");
assert.equal(otherOverlapped, true, "Unabhaengige Arbeit soll die Konfliktressource weiterhin ueberlappen.");
await assert.rejects(
  runWithConcurrency([{ conflictKey: "" }], 1, async () => undefined),
  /conflictKey.*nichtleere Zeichenfolge/,
);

const visited = [];
await assert.rejects(
  runWithConcurrency([1, 2, 3], 1, async (value) => {
    visited.push(value);
    if (value === 2) throw new Error("synthetischer Fehler");
  }),
  /synthetischer Fehler/,
);
assert.deepEqual(visited, [1, 2], "Nach einem Fehler duerfen keine neuen seriellen Schritte starten.");

let falsyFailureObserved = false;
try {
  await runWithConcurrency([1, 2], 1, async () => Promise.reject(undefined));
} catch (error) {
  falsyFailureObserved = true;
  assert.equal(error, undefined, "Der erste Ablehnungswert muss auch dann unveraendert bleiben, wenn er falsy ist.");
}
assert.equal(falsyFailureObserved, true, "Eine Promise-Ablehnung mit undefined darf nicht als Erfolg gelten.");

const keyedOrder = [];
await runWithConcurrency([1, 2, 3].map((id) => ({ id, conflictKey: "fifo" })), 3, async ({ id }) => {
  keyedOrder.push(id);
  await new Promise((resolve) => setTimeout(resolve, 5));
});
assert.deepEqual(keyedOrder, [1, 2, 3], "Schritte derselben Konfliktressource muessen FIFO starten.");

const drained = [];
await assert.rejects(
  runWithConcurrency([1, 2, 3], 2, async (value) => {
    if (value === 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("erster paralleler Fehler");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    drained.push(value);
    if (value === 2) throw new Error("spaeter paralleler Fehler");
  }),
  /erster paralleler Fehler/,
);
assert.deepEqual(drained, [2], "Bereits gestartete Arbeit muss ablaufen; nach Fehler darf Schritt 3 nicht starten.");
await runWithConcurrency([], 8, async () => { throw new Error("Leere Eingabe darf nichts starten."); });

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
  "Testsuite-Runner: vollstaendiger Plan, Konfliktressourcen, exklusive Sentinel-Grenze, Timeout, Ausgabelimit und begrenzte Parallelitaet bestanden\n",
);
