import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { closeSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runStep } from "../suite-runner.mjs";
import {
  API_LOAD_CALLER_SHAPES,
  createFairPlan,
  createSoakPlan,
  evaluateApiLoadStability,
  jainFairness,
  sanitizeLoadRecord,
  sha256,
  summarizeCompletionOrder,
  summarizeLoadRecords,
} from "./api-load-workload.mjs";
import {
  inspectWindowsProcessIdentity,
  parseApiLoadOptions,
  runApiLoadWorkload,
  terminateIdentityBoundProcess,
} from "./run-api-load-workload.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..", "..");

test("resource observation retains exact handles, refreshes metrics and refuses stale identity", { timeout: 45_000 }, async () => {
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await runStep({
    name: "windows-resource-observer-contract",
    command: powershell,
    args: [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", join(here, "windows-resource-observer-contract.ps1"), "-NodeExecutable", process.execPath,
    ],
    timeoutMs: 40_000,
    maxOutputBytes: 1024 * 1024,
  });
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonLines(path) {
  return readFileSync(path, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function statSize(path) {
  return readFileSync(path).length;
}

function assertFailedWorkloadResources(output, quiescenceGapMs) {
  const cleanup = readJson(join(output, "cleanup.json"));
  assert.equal(cleanup.completionStatus, "failed");
  assert.match(cleanup.primaryFailureStage, /^[a-z][a-z0-9-]+$/u);
  assert.match(cleanup.primaryErrorName, /^[A-Za-z][A-Za-z0-9]{0,63}$/u);
  assert(Array.isArray(cleanup.cleanupFailureStages));
  assert(cleanup.cleanupFailureStages.every(stage => /^[a-z][a-z0-9-]+$/u.test(stage)));
  assert.equal(cleanup.scratchRemoved, true);
  assert.equal(cleanup.apiOwnershipRetained, false);
  assert.equal(cleanup.apiListening, false);
  assert(["not-needed", "released"].includes(cleanup.apiForcedRelease));
  assert.equal(cleanup.mcpOwnershipRetained, false);
  assert.equal(cleanup.mcpClientActive, false);
  assert(["not-needed", "released"].includes(cleanup.mcpForcedRelease));
  assert.equal(cleanup.executorActive, 0);
  assert.equal(cleanup.observerStopped, true);
  assert.equal(cleanup.identityBoundMcpAliveCount, 0);
  assert.equal(cleanup.ownedDescendantAliveCount, 0);
  assert(cleanup.ownedMcpProcessStates.every(entry => entry.identityBound && entry.identityMatchedAlive === false));
  assert.deepEqual(cleanup.unboundMcpPidOccupancies, []);
  assert(cleanup.finalQuiescence, "Failure cleanup needs fresh owned-process quiescence evidence.");
  assert(cleanup.finalQuiescence.first.sequence > cleanup.finalQuiescence.floorSequence);
  assert(cleanup.finalQuiescence.second.sequence > cleanup.finalQuiescence.first.sequence);
  assert(cleanup.finalQuiescence.gapMs >= quiescenceGapMs);
  assert.equal(cleanup.finalQuiescence.first.liveOwnedChildren, 0);
  assert.equal(cleanup.finalQuiescence.second.liveOwnedChildren, 0);
  assert.equal(cleanup.lastObserverState.liveOwnedChildren, 0);
  assert.equal(cleanup.lastObserverState.sseProcessCount, 0);
  assert.equal(existsSync(join(output, ".scratch")), false);
  assert(!/[A-Z]:\\|file:\/\/|\\\\|sse-lab|Users\\|https?:\/\//iu.test(JSON.stringify(cleanup)));
  return cleanup;
}

function assertFailedWorkloadClean(output, quiescenceGapMs) {
  const cleanup = assertFailedWorkloadResources(output, quiescenceGapMs);
  const failureIndex = readJson(join(output, "failure-artifacts.json"));
  assert.deepEqual(failureIndex.map(entry => entry.relativePath), [
    "executor-calls.jsonl", "lifecycle.jsonl", "operations.jsonl", "run.json", "windows-resources.jsonl",
  ]);
  for (const entry of failureIndex) {
    const artifactPath = join(output, entry.relativePath);
    assert.equal(statSize(artifactPath), entry.bytes);
    assert.equal(sha256File(artifactPath), entry.sha256);
  }
  const failureEvidence = JSON.stringify({
    indexed: Object.fromEntries(failureIndex.map(entry => [entry.relativePath, readFileSync(join(output, entry.relativePath), "utf8")])),
    cleanup,
    failureIndex,
  });
  assert(!/[A-Z]:\\|file:\/\/|\\\\|sse-lab|Users\\|https?:\/\//iu.test(failureEvidence));
  return cleanup;
}

test("arrival and soak plans are deterministic, fair and explicitly client-scheduled", () => {
  for (const callers of API_LOAD_CALLER_SHAPES) {
    const plan = createFairPlan({ callers, jobsPerCaller: 3, phase: `fair-c${String(callers).padStart(2, "0")}` });
    assert.deepEqual(plan, createFairPlan({ callers, jobsPerCaller: 3, phase: `fair-c${String(callers).padStart(2, "0")}` }));
    assert.equal(plan.length, callers * 3);
    assert.deepEqual(plan.slice(0, callers).map((job) => job.caller), Array.from({ length: callers }, (_, index) => index + 1));
    assert.equal(jainFairness(Array(callers).fill(3)), 1);
    assert(plan.every((job) => job.transport === (job.sequence % 2 === 0 ? "mcp" : "http")));
    const order = summarizeCompletionOrder(plan, callers);
    assert.equal(order.exactRoundRobin, true);
    assert.equal(order.actualDigest, order.expectedDigest);
    assert.equal(order.longestCompletionGap, callers - 1);
    assert.equal(order.starvationCount, 0);
  }
  const soak = createSoakPlan({ operationCount: 1_008, durationMs: 900_000, callers: 8 });
  assert.equal(soak.length, 1_008);
  assert.equal(soak[0].scheduledOffsetMs, 0);
  assert.equal(soak.at(-1).scheduledOffsetMs, 900_000);
  assert.equal(new Set(soak.map((job) => job.token)).size, soak.length);
  assert.equal(soak.filter((job) => job.transport === "http").length, 504);
  assert.equal(soak.filter((job) => job.transport === "mcp").length, 504);
  assert.deepEqual(
    Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index + 1, soak.filter((job) => job.caller === index + 1).length])),
    { 1: 126, 2: 126, 3: 126, 4: 126, 5: 126, 6: 126, 7: 126, 8: 126 },
  );
  assert.throws(() => createSoakPlan({ operationCount: 1, durationMs: 900_000 }), /operationCount/u);
  assert.throws(() => createFairPlan({ callers: 0, jobsPerCaller: 1 }), /callers/u);
});

test("raw load records contain only explicit timing, identity and admission metadata", () => {
  const record = sanitizeLoadRecord({
    phase: "steady-warm",
    mode: "scheduled-soak",
    sequence: 1,
    caller: 1,
    arrivalShape: 8,
    transport: "http",
    outcome: "ok",
    terminalKind: null,
    httpStatus: 200,
    admitted: true,
    executorReached: true,
    successful: true,
    busy: false,
    identityMatched: true,
    clientQueueWaitMs: 50.12549,
    serverQueueWaitMs: null,
    serviceTimeMs: 1,
    apiDurationMs: 1.5,
    transportTimeMs: 2.0004,
    endToEndMs: 52.12589,
    args: { name: "must-not-survive" },
    result: { hits: [{ name: "must-not-survive" }] },
  });
  assert.deepEqual(Object.keys(record), [
    "schemaVersion", "type", "phase", "mode", "sequence", "caller", "arrivalShape", "transport", "outcome",
    "terminalKind", "httpStatus", "admitted", "executorReached", "successful", "busy", "identityMatched",
    "clientQueueWaitMs", "serverQueueWaitMs", "serviceTimeMs", "apiDurationMs", "transportTimeMs", "endToEndMs",
  ]);
  assert.equal(record.clientQueueWaitMs, 50.125);
  assert.equal(record.transportTimeMs, 2);
  assert.equal(record.endToEndMs, 52.126);
  assert.equal(JSON.stringify(record).includes("must-not-survive"), false);
  const summary = summarizeLoadRecords([record]);
  assert.equal(summary.completionFairness.jain, 1);
  assert.equal(summary.admissionFairness.jain, 1);
  assert.equal(summary.endToEndMs.p99, 52.126);
  assert.equal(summary.transportTimeMs.p99, 2);
  assert.throws(() => sanitizeLoadRecord({ ...record, serverQueueWaitMs: 0 }), /no server queue/u);
  assert.throws(() => sanitizeLoadRecord({ ...record, mode: "C:\\private" }), /mode/u);
  assert.throws(() => sanitizeLoadRecord({ ...record, executorReached: undefined }), /executorReached/u);
  assert.throws(() => sanitizeLoadRecord({ ...record, admitted: false }), /Admission and executor reach/u);
  assert.throws(() => sanitizeLoadRecord({ ...record, endToEndMs: 2 }), /must include client queue wait/u);
  assert.equal(sha256("deterministic"), sha256("deterministic"));
});

test("canonical CLI accepts only a mandatory new external output", () => {
  const parsed = parseApiLoadOptions(["--output", "C:\\external\\new-run"]);
  assert.equal(parsed.output, resolve("C:\\external\\new-run"));
  assert.equal(parseApiLoadOptions(["--help"]).help, true);
  assert.throws(() => parseApiLoadOptions([]), /--output is required/u);
  assert.throws(() => parseApiLoadOptions(["--operations", "8"]), /Unknown option/u);
});

test("stability evaluation includes client queue backlog and exposes falsifier state", () => {
  const input = {
    soakSummary: {
      clientQueueWaitMs: { max: 10 },
      latencyDrift: {
        firstQuartileEndToEndMs: { p95: 5, p99: 7 },
        lastQuartileEndToEndMs: { p95: 6, p99: 8 },
        firstQuartileClientQueueWaitMs: { p95: 1 },
        lastQuartileClientQueueWaitMs: { p95: 2 },
      },
    },
    resourceSummary: {
      observedGapMs: { maximum: 5_010 },
      missedIntervalCount: 0,
      ownedTreeFinalDrift: { workingSetBytes: 1, privateBytes: 2, handleCount: 3 },
    },
    eventLoopSummary: { p99Ms: 20 },
    observerIntervalMs: 5_000,
  };
  const passed = evaluateApiLoadStability(input);
  assert.equal(passed.passed, true);
  assert(Object.values(passed.falsifiers).every((value) => value === false));

  for (const [name, mutate] of [
    ["observerGap", (value) => { value.resourceSummary.observedGapMs.maximum = 7_501; }],
    ["missedIntervals", (value) => { value.resourceSummary.missedIntervalCount = 1; }],
    ["latencyP95Drift", (value) => { value.soakSummary.latencyDrift.lastQuartileEndToEndMs.p95 = 106; }],
    ["latencyP99Drift", (value) => { value.soakSummary.latencyDrift.lastQuartileEndToEndMs.p99 = 258; }],
    ["clientQueueP95Drift", (value) => { value.soakSummary.latencyDrift.lastQuartileClientQueueWaitMs.p95 = 102; }],
    ["clientQueueMaximum", (value) => { value.soakSummary.clientQueueWaitMs.max = 1_001; }],
    ["workingSetGrowth", (value) => { value.resourceSummary.ownedTreeFinalDrift.workingSetBytes = 128 * 1024 * 1024 + 1; }],
    ["privateByteGrowth", (value) => { value.resourceSummary.ownedTreeFinalDrift.privateBytes = 128 * 1024 * 1024 + 1; }],
    ["handleGrowth", (value) => { value.resourceSummary.ownedTreeFinalDrift.handleCount = 65; }],
    ["eventLoopP99", (value) => { value.eventLoopSummary.p99Ms = 251; }],
  ]) {
    const falsified = structuredClone(input);
    mutate(falsified);
    const failed = evaluateApiLoadStability(falsified);
    assert.equal(failed.passed, false, `${name} must fail the gate`);
    assert.equal(failed.falsifiers[name], true, `${name} must be explicit`);
  }
});

test("forced helper cleanup refuses PID identity mismatch and terminates only the bound process", { timeout: 30_000 }, async (context) => {
  const sleeper = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  const closed = once(sleeper, "close");
  context.after(() => {
    if (sleeper.exitCode === null) sleeper.kill();
  });
  assert(Number.isSafeInteger(sleeper.pid) && sleeper.pid > 0);
  const identity = await inspectWindowsProcessIdentity(sleeper.pid);
  assert(identity);
  const wrongIdentity = {
    ...identity,
    creationTimeUtcTicks: String(BigInt(identity.creationTimeUtcTicks) + 1n),
  };
  assert.equal(await terminateIdentityBoundProcess(sleeper.pid, wrongIdentity), "identity-mismatch");
  assert.deepEqual(await inspectWindowsProcessIdentity(sleeper.pid), identity);
  assert.equal(await terminateIdentityBoundProcess(sleeper.pid, identity), "terminated");
  await closed;
  assert.equal(await inspectWindowsProcessIdentity(sleeper.pid), null);
});

test("compact real HTTP/MCP workload proves arrivals, lifecycle, telemetry and cleanup", { timeout: 60_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-contract-"));
  const output = join(parent, "run");
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const summary = await runApiLoadWorkload({ output }, {
    allowNonCanonical: true,
    arrivalRounds: 1,
    fairJobsPerCaller: 2,
    soakOperations: 32,
    soakDurationMs: 1_500,
    observerIntervalMs: 2_000,
    quiescenceGapMs: 1_000,
    normalDelayMs: 1,
    controlTimeoutMs: 100,
    silent: true,
  });

  assert.equal(summary.canonical, false);
  assert.equal(summary.productFree, true);
  assert.equal(summary.installedProductMutationClaim, false);
  assert.equal(summary.installedProductPerformanceClaim, false);
  assert.equal(summary.serverQueueWaitMetric, null);
  assert.deepEqual(summary.rawArrivals.map((shape) => ({
    callerShape: shape.callerShape,
    admitted: shape.admitted,
    busy: shape.busy,
  })), [
    { callerShape: 1, admitted: 1, busy: 0 },
    { callerShape: 4, admitted: 1, busy: 3 },
    { callerShape: 8, admitted: 1, busy: 7 },
  ]);
  assert(summary.fairArrivals.every((shape) => (
    shape.busy === 0 && shape.completionFairness.jain === 1 &&
    shape.completionFairness.minimum === 2 && shape.completionFairness.maximum === 2 &&
    shape.completionOrder.exactRoundRobin &&
    shape.completionOrder.actualDigest === shape.completionOrder.expectedDigest &&
    shape.completionOrder.longestCompletionGap <= shape.callerShape - 1 &&
    shape.completionOrder.starvationCount === 0
  )));
  assert.equal(summary.soak.count, 32);
  assert.equal(summary.soak.admitted, 32);
  assert.equal(summary.soak.identityMatched, 32);
  assert.equal(summary.soak.busy, 0);
  assert.equal(summary.soak.completionFairness.jain, 1);
  assert.equal(summary.soak.completionOrder.exactRoundRobin, true);
  assert(summary.soak.elapsedMs >= 1_500);
  assert(summary.soak.throughputOperationsPerSecond > 0);
  assert.equal(summary.soak.serviceTimeMs.count, 32);
  assert.equal(summary.soak.apiDurationMs.count, 16);
  assert.equal(summary.soak.transportTimeMs.count, 32);
  assert.deepEqual(summary.soak.operationMix, { find: 32 });
  assert.equal(summary.soak.scope, "single-operation-real-http-mcp-transport-soak");
  assert.deepEqual(summary.soak.transports, { http: 16, mcp: 16 });
  assert.equal(summary.executor.maximumActive, 1);
  assert.equal(summary.executor.activeAtEnd, 0);
  assert.equal(summary.executor.aborted, 2);
  assert.equal(summary.executor.failed, 1);
  assert.deepEqual(summary.lifecycle, {
    cancellationCount: 1,
    timeoutCount: 1,
    injectedExecutorFailureCount: 1,
    syntheticGeneration: 2,
    apiRestartCount: 1,
    mcpRestartCount: 1,
    cleanShutdownCount: 1,
    records: 8,
    placement: "controls-complete-before-scheduled-soak",
  });
  assert(summary.resources.sampleCount >= 2);
  assert.equal(summary.resources.maximumSseProcessCount, 0);
  assert.equal(summary.resources.maximumVisibleOwnedWindows, 0);
  assert.equal(summary.resources.maximumOwnedModalCandidates, 0);
  assert.equal(summary.resources.sampleErrorCount, 0);
  assert.equal(summary.resources.finalAliveByRole.runner, true);
  assert.equal(summary.resources.finalAliveByRole["mcp-01"], false);
  assert.equal(summary.resources.finalAliveByRole["mcp-02"], false);
  assert(Number.isFinite(summary.resources.perProcessMaximum.handleCount));
  assert(Number.isFinite(summary.resources.ownedTreeMaximum.handleCount));
  assert(summary.resources.ownedTreeMaximum.handleCount >= summary.resources.perProcessMaximum.handleCount);
  assert(Number.isFinite(summary.resources.observedCpuLowerBoundMs));
  assert.equal(summary.resources.desktopScope, "current-process-window-station-default-enumwindows");
  assert(summary.resources.finalTracked.every((entry) => entry.role === "runner" || entry.alive === false));
  assert.equal(
    summary.stabilityGate.passed,
    true,
    `unexpected compact workload stability falsifiers: ${JSON.stringify(summary.stabilityGate.falsifiers)}`,
  );
  assert(Object.values(summary.stabilityGate.falsifiers).every((value) => value === false));
  assert(Number.isFinite(summary.stabilityGate.observed.maximumClientQueueWaitMs));
  assert.equal(summary.stabilityGate.thresholds.maximumClientQueueWaitMs, 1_000);
  assert(summary.cleanup.gapMs >= 1_000);
  assert(summary.cleanup.first.sequence > summary.cleanup.floorSequence);
  assert(summary.cleanup.second.sequence > summary.cleanup.first.sequence);
  for (const quiet of [summary.cleanup.first, summary.cleanup.second]) {
    assert.equal(quiet.liveOwnedChildren, 0);
    assert.equal(quiet.sseProcessCount, 0);
    assert.equal(quiet.visibleOwnedWindows, 0);
    assert.equal(quiet.sampleErrorCount, 0);
  }

  const cleanup = readJson(join(output, "cleanup.json"));
  assert.equal(cleanup.completionStatus, "passed");
  assert.equal(cleanup.apiForcedRelease, "not-needed");
  assert.equal(cleanup.mcpForcedRelease, "not-needed");
  assert.equal(cleanup.scratchRemoved, true);
  assert.equal(cleanup.apiOwnershipRetained, false);
  assert.equal(cleanup.apiListening, false);
  assert.equal(cleanup.mcpOwnershipRetained, false);
  assert.equal(cleanup.mcpClientActive, false);
  assert.equal(cleanup.executorActive, 0);
  assert.equal(cleanup.observerStopped, true);
  assert.equal(cleanup.identityBoundMcpAliveCount, 0);
  assert.equal(cleanup.ownedDescendantAliveCount, 0);
  assert(cleanup.ownedMcpProcessStates.every((entry) => entry.identityBound && entry.identityMatchedAlive === false));
  assert.deepEqual(cleanup.unboundMcpPidOccupancies, []);
  assert.equal(cleanup.lastObserverState.liveOwnedChildren, 0);
  assert.equal(existsSync(join(output, ".scratch")), false);

  const operations = readJsonLines(join(output, "operations.jsonl"));
  const executorCalls = readJsonLines(join(output, "executor-calls.jsonl"));
  const resources = readJsonLines(join(output, "windows-resources.jsonl"));
  assert.equal(operations.length, summary.allOperations.count);
  assert.equal(executorCalls.length, summary.executor.calls);
  assert.equal(resources.length, summary.resources.sampleCount);
  assert.equal(operations.filter((entry) => entry.outcome === "cancelled").length, 1);
  assert.equal(operations.filter((entry) => entry.outcome === "timed-out").length, 1);
  assert.equal(operations.filter((entry) => entry.outcome === "worker-failed" && entry.admitted).length, 1);
  assert(operations.filter((entry) => ["cancelled", "timed-out"].includes(entry.outcome))
    .every((entry) => entry.admitted && entry.executorReached && !entry.successful));
  assert(operations.every((entry) => entry.admitted === entry.executorReached));
  assert(operations.every((entry) => Math.abs(
    entry.endToEndMs - (entry.clientQueueWaitMs + entry.transportTimeMs)
  ) <= 0.002));
  assert(resources.some((sample) => sample.tracked.some((entry) => entry.role === "owned-descendant" && entry.alive)),
    "Observer must discover an unregistered descendant such as the hidden console host.");
  assert(executorCalls.every((entry) => /^[A-F0-9]{64}$/u.test(entry.tokenDigest)));

  const artifactIndex = readJson(join(output, "artifacts.json"));
  assert.deepEqual(artifactIndex.map((entry) => entry.relativePath), [
    "executor-calls.jsonl", "lifecycle.jsonl", "operations.jsonl", "run.json", "summary.json", "windows-resources.jsonl",
  ]);
  for (const entry of artifactIndex) {
    const artifactPath = join(output, ...entry.relativePath.split("/"));
    assert.equal(statSize(artifactPath), entry.bytes);
    assert.equal(sha256File(artifactPath), entry.sha256);
  }
  const allEvidence = {
    indexed: Object.fromEntries(artifactIndex.map((entry) => [entry.relativePath, readFileSync(join(output, entry.relativePath), "utf8")])),
    cleanup,
    artifactIndex,
  };
  const serializedEvidence = JSON.stringify(allEvidence);
  assert(!/[A-Z]:\\|file:\/\/|\\\\|sse-lab|Users\\|https?:\/\//iu.test(serializedEvidence));
  assert(!serializedEvidence.includes("load-steady-warm"), "Synthetic request values must not survive in evidence.");

  await assert.rejects(
    runApiLoadWorkload({ output }, { allowNonCanonical: true }),
    /already exists/u,
  );
  const repositoryOutput = join(repositoryRoot, "test", "must-not-create-api-load-output");
  await assert.rejects(
    runApiLoadWorkload({ output: repositoryOutput }, { allowNonCanonical: true }),
    /outside the repository/u,
  );
  assert.equal(existsSync(repositoryOutput), false);
});

test("injected API, MCP and observer close failures retain ownership, retry cleanup and preserve telemetry", { timeout: 60_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-close-failure-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const common = {
    allowNonCanonical: true,
    arrivalRounds: 1,
    fairJobsPerCaller: 1,
    soakOperations: 8,
    soakDurationMs: 50,
    observerIntervalMs: 1_000,
    quiescenceGapMs: 1_000,
    normalDelayMs: 1,
    controlTimeoutMs: 100,
    silent: true,
  };
  for (const [name, injection, expected] of [
    ["api", { failBeforeApiCloseOnce: true }, /Injected API close failure/u],
    ["mcp", { failBeforeMcpCloseOnce: true }, /Injected MCP close failure/u],
    ["observer", { failBeforeObserverStopSignalOnce: true }, /Injected observer stop-signal failure/u],
    ["startup-api-close", { failAfterApiStartOnce: true, failBeforeApiCloseOnce: true }, /Load workload and API cleanup failed/u],
  ]) {
    const output = join(parent, name);
    await assert.rejects(
      runApiLoadWorkload({ output }, { ...common, ...injection }),
      expected,
    );
    assertFailedWorkloadClean(output, common.quiescenceGapMs);
  }
  const startupCleanup = readJson(join(parent, "startup-api-close", "cleanup.json"));
  assert.equal(startupCleanup.primaryFailureStage, "api-mcp-start");
  assert.deepEqual(startupCleanup.cleanupFailureStages, ["api-cleanup"]);
});

test("primary failure plus MCP cleanup failure keeps the cause and ends owned helpers", { timeout: 45_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-primary-close-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run");
  let failure;
  await assert.rejects(async () => {
    try {
      await runApiLoadWorkload({ output }, {
        allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
        soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
        quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
        failAfterMcpStartOnce: true, failBeforeMcpCloseOnce: true,
      });
    } catch (error) { failure = error; throw error; }
  }, /Load workload and MCP cleanup failed/u);
  assert(failure instanceof AggregateError);
  assert.equal(failure.errors[0].message, "Injected MCP workload startup failure.");
  assert.equal(failure.errors[1].message, "Injected MCP close failure before ownership release.");
  const cleanup = assertFailedWorkloadClean(output, 1_000);
  assert.equal(cleanup.primaryFailureStage, "api-mcp-start");
  assert.equal(cleanup.primaryErrorName, "Error");
  assert.deepEqual(cleanup.cleanupFailureStages, ["mcp-cleanup"]);
  assert.equal(cleanup.mcpForcedRelease, "not-needed");
});

for (const [transport, hook, prefix] of [["MCP", "beforeMcpClose", "mcp"], ["API", "beforeApiClose", "api"]]) {
test(`repeated ${transport} close failures release owned helpers and let the outer process exit naturally`, { timeout: 45_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), `sse-api-load-repeated-${prefix}-close-`));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run");
  const driver = `
    import assert from "node:assert/strict";
    import { runApiLoadWorkload } from ${JSON.stringify(new URL("./run-api-load-workload.mjs", import.meta.url).href)};
    let calls = 0;
    let failure;
    try {
      await runApiLoadWorkload({ output: process.argv[1] }, {
        allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
        soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
        quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
        failAfterMcpStartOnce: true,
        ${hook}: () => { calls++; throw new Error("Injected repeated ${transport} close failure."); },
      });
    } catch (error) { failure = error; }
    assert.equal(calls, 2);
    assert(failure instanceof AggregateError);
    assert.equal(failure.message, "${transport} cleanup recovery failed.");
    assert.equal(failure.errors[0].errors[0].message, "Injected MCP workload startup failure.");
    assert.equal(failure.errors[0].errors[1].message, "Injected repeated ${transport} close failure.");
    assert.equal(failure.errors[1].message, "Injected repeated ${transport} close failure.");
  `;
  await runStep({ name: `repeated-${prefix}-close-natural-exit`, command: process.execPath,
    args: ["--input-type=module", "-e", driver, output], timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
  const cleanup = assertFailedWorkloadClean(output, 1_000);
  assert.equal(cleanup.primaryFailureStage, "api-mcp-start");
  assert.equal(cleanup.failureStage, `${prefix}-cleanup`);
  assert.equal(cleanup.primaryErrorName, "Error");
  assert.deepEqual(cleanup.cleanupFailureStages, [`${prefix}-cleanup`, `${prefix}-cleanup-retry`]);
  assert.equal(cleanup[`${prefix}ForcedRelease`], "released");
});
}

test("failure artifact indexing preserves the primary cause and later failure stage", { timeout: 30_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-failure-index-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run");
  let failure;
  await assert.rejects(async () => {
    try {
      await runApiLoadWorkload({ output }, {
        allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
        soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
        quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
        failAfterMcpStartOnce: true,
        beforeFailureArtifactIndex: () => { throw new Error("Injected failure-artifact index failure."); },
      });
    } catch (error) { failure = error; throw error; }
  }, /Load failure and failure-artifact indexing failed/u);
  assert(failure instanceof AggregateError);
  assert.equal(failure.errors[0].message, "Injected MCP workload startup failure.");
  assert.equal(failure.errors[1].message, "Injected failure-artifact index failure.");
  const cleanup = assertFailedWorkloadResources(output, 1_000);
  assert.equal(cleanup.failureStage, "failure-artifact-index");
  assert.equal(cleanup.primaryFailureStage, "api-mcp-start");
  assert.equal(cleanup.primaryErrorName, "Error");
  assert.deepEqual(cleanup.cleanupFailureStages, ["failure-artifact-index"]);
  assert.equal(existsSync(join(output, "failure-artifacts.json")), false);
  assert.equal(readJson(join(output, "run.json")).productFree, true);
  assert(readJsonLines(join(output, "windows-resources.jsonl")).length >= 2);
});

test("final artifact indexing failure retains a complete failed-report identity", { timeout: 30_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-final-index-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run");
  await assert.rejects(runApiLoadWorkload({ output }, {
    allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
    soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
    quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
    beforeArtifactIndex: () => { throw new TypeError("Injected final artifact index failure."); },
  }), /Injected final artifact index failure/u);
  const cleanup = assertFailedWorkloadResources(output, 1_000);
  assert.equal(cleanup.failureStage, "artifact-index");
  assert.equal(cleanup.primaryFailureStage, "artifact-index");
  assert.equal(cleanup.primaryErrorName, "TypeError");
  assert.deepEqual(cleanup.cleanupFailureStages, []);
  assert.equal(existsSync(join(output, "artifacts.json")), false);
  assert.equal(readJson(join(output, "summary.json")).productFree, true);
});

test("failure cleanup record write errors preserve the original cause and existing bytes", { timeout: 30_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-cleanup-record-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run"), sentinel = "existing cleanup record\n";
  await assert.rejects(runApiLoadWorkload({ output }, {
    allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
    soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
    quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
    failAfterMcpStartOnce: true,
    beforeFailureArtifactIndex: () => writeFileSync(join(output, "cleanup.json"), sentinel, { flag: "wx" }),
  }), error => {
    assert(error instanceof AggregateError);
    assert.equal(error.message, "Load failed and failure cleanup record could not be written.");
    assert.equal(error.errors[0].message, "Injected MCP workload startup failure.");
    assert.equal(error.errors[1].code, "EEXIST");
    return true;
  });
  assert.equal(readFileSync(join(output, "cleanup.json"), "utf8"), sentinel);
  const samples = readJsonLines(join(output, "windows-resources.jsonl"));
  assert(samples.at(-1).tracked.every(entry => entry.role === "runner" || entry.alive === false));
  assert.equal(existsSync(join(output, ".scratch")), false);
});

test("partial failure artifact writes remove only their own incomplete index", { timeout: 30_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-partial-index-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run");
  await assert.rejects(runApiLoadWorkload({ output }, {
    allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
    soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
    quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
    failAfterMcpStartOnce: true,
    beforeFailureArtifactIndexWrite: descriptor => {
      writeFileSync(descriptor, "{", "utf8");
      throw new Error("Injected partial failure-artifact write failure.");
    },
  }), /Load failure and failure-artifact indexing failed/u);
  const cleanup = assertFailedWorkloadResources(output, 1_000);
  assert.deepEqual(cleanup.cleanupFailureStages, ["failure-artifact-index"]);
  assert.equal(existsSync(join(output, "failure-artifacts.json")), false);
});

test("pre-existing failure artifacts survive an index creation collision", { timeout: 30_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-existing-index-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run"), sentinel = "existing failure index\n";
  await assert.rejects(runApiLoadWorkload({ output }, {
    allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
    soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
    quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
    failAfterMcpStartOnce: true,
    beforeFailureArtifactIndex: () => writeFileSync(join(output, "failure-artifacts.json"), sentinel, { flag: "wx" }),
  }), /Load failure and failure-artifact indexing failed/u);
  const cleanup = assertFailedWorkloadResources(output, 1_000);
  assert.deepEqual(cleanup.cleanupFailureStages, ["failure-artifact-index"]);
  assert.equal(readFileSync(join(output, "failure-artifacts.json"), "utf8"), sentinel);
});

test("pre-existing success artifacts survive an index creation collision", { timeout: 30_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-existing-success-index-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run"), sentinel = "existing success index\n";
  await assert.rejects(runApiLoadWorkload({ output }, {
    allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
    soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
    quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
    beforeArtifactIndex: () => writeFileSync(join(output, "artifacts.json"), sentinel, { flag: "wx" }),
  }), { code: "EEXIST" });
  const cleanup = assertFailedWorkloadResources(output, 1_000);
  assert.equal(cleanup.primaryFailureStage, "artifact-index");
  assert.deepEqual(cleanup.cleanupFailureStages, []);
  assert.equal(readFileSync(join(output, "artifacts.json"), "utf8"), sentinel);
});

test("replaced failure artifacts retain replacement bytes and report refused cleanup", { timeout: 30_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-replaced-index-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run"), sentinel = "replacement failure index\n";
  await assert.rejects(runApiLoadWorkload({ output }, {
    allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
    soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
    quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
    failAfterMcpStartOnce: true,
    beforeFailureArtifactIndexWrite: descriptor => {
      writeFileSync(descriptor, "{", "utf8");
      renameSync(join(output, "failure-artifacts.json"), join(output, "partial-index-retained.json"));
      writeFileSync(join(output, "failure-artifacts.json"), sentinel, { flag: "wx" });
      throw new Error("Injected failure after index replacement.");
    },
  }), /Failure index cleanup was refused or failed/u);
  const cleanup = assertFailedWorkloadResources(output, 1_000);
  assert.equal(cleanup.primaryFailureStage, "api-mcp-start");
  assert.equal(cleanup.failureStage, "failure-artifact-cleanup");
  assert.deepEqual(cleanup.cleanupFailureStages, ["failure-artifact-index", "failure-artifact-cleanup"]);
  assert.equal(readFileSync(join(output, "failure-artifacts.json"), "utf8"), sentinel);
  assert.equal(readFileSync(join(output, "partial-index-retained.json"), "utf8"), "{");
});

test("index write and descriptor cleanup failures retain both causes", { timeout: 30_000 }, async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-api-load-index-descriptor-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const output = join(parent, "run");
  await assert.rejects(runApiLoadWorkload({ output }, {
    allowNonCanonical: true, arrivalRounds: 1, fairJobsPerCaller: 1,
    soakOperations: 8, soakDurationMs: 50, observerIntervalMs: 1_000,
    quiescenceGapMs: 1_000, normalDelayMs: 1, controlTimeoutMs: 100, silent: true,
    failAfterMcpStartOnce: true,
    beforeFailureArtifactIndexWrite: descriptor => {
      writeFileSync(descriptor, "{", "utf8"); closeSync(descriptor);
      throw new Error("Injected index write and descriptor cleanup failure.");
    },
  }), error => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors[0].message, "Injected MCP workload startup failure.");
    assert(error.errors[1] instanceof AggregateError);
    assert.equal(error.errors[1].errors[0].message, "Injected index write and descriptor cleanup failure.");
    assert.equal(error.errors[1].errors[1].code, "EBADF");
    return true;
  });
  assertFailedWorkloadResources(output, 1_000);
  assert.equal(existsSync(join(output, "failure-artifacts.json")), false);
});
