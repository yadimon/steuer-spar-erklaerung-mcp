#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { installApiShutdown } from "../../dist/api-runtime.js";
import { createSseApiServer } from "../../dist/api-server.js";
import { localHttpFetch } from "../../dist/local-http-transport.js";
import { hasRunningSseProcess } from "../../dist/sse-process-guard.js";
import { runtimeFingerprint, sourceFingerprint } from "./performance-harness.mjs";
import {
  API_LOAD_BENCHMARK_ID,
  API_LOAD_CALLER_SHAPES,
  API_LOAD_CANONICAL_DURATION_MS,
  API_LOAD_CANONICAL_OPERATIONS,
  API_LOAD_CANONICAL_SAMPLE_MS,
  API_LOAD_SCHEMA_VERSION,
  createFairPlan,
  createSoakPlan,
  createSyntheticFindExecutor,
  evaluateApiLoadStability,
  sanitizeLoadRecord,
  sha256,
  sleepUntil,
  summarizeCompletionOrder,
  summarizeLoadRecords,
} from "./api-load-workload.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(here, "..", "..");
const OBSERVER = join(here, "windows-resource-observer.ps1");
const PROCESS_IDENTITY_HELPER = join(here, "owned-process-identity.ps1");
const MCP_SERVER = join(REPOSITORY_ROOT, "dist", "index.js");
const POWERSHELL = join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const HELP = `Product-free API/MCP arrival and soak workload

Usage:
  npm run perf:api-load-soak -- --output EXTERNAL_NEW_DIRECTORY

The canonical command is fixed at 1,008 mixed API/MCP soak operations over at
least 900,000 ms, plus raw and fair 1/4/8-caller phases. It never starts SSE.exe.
`;

function rounded(value) {
  return Number.isFinite(value) ? Math.round(value * 1_000) / 1_000 : value;
}

function optionValue(argv, index, name) {
  if (argv[index] === name) {
    if (argv[index + 1] === undefined) throw new Error(`${name} requires a value.`);
    return { value: argv[index + 1], consumed: 1 };
  }
  if (argv[index].startsWith(`${name}=`)) return { value: argv[index].slice(name.length + 1), consumed: 0 };
  return null;
}

export function parseApiLoadOptions(argv) {
  const result = { output: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (["--help", "-h"].includes(argv[index])) {
      result.help = true;
      continue;
    }
    const output = optionValue(argv, index, "--output");
    if (!output) throw new Error(`Unknown option: ${argv[index]}`);
    result.output = resolve(output.value);
    index += output.consumed;
  }
  if (!result.help && !result.output) throw new Error("--output is required.");
  return result;
}

function isStrictDescendant(parent, candidate) {
  const fromParent = relative(parent, candidate);
  return fromParent !== "" && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent);
}

function projectExternalNewDirectory(path) {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new Error("Output parent must already exist.");
  const realRepository = realpathSync(REPOSITORY_ROOT);
  const projected = resolve(realpathSync(parent), basename(absolute));
  if (projected.toLocaleLowerCase("en-US") === realRepository.toLocaleLowerCase("en-US") ||
      isStrictDescendant(realRepository, projected)) {
    throw new Error("Output must stay outside the repository.");
  }
  return projected;
}

function claimExternalNewDirectory(path, projected) {
  try {
    mkdirSync(path);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Output already exists.", { cause: error });
    throw error;
  }
  const realRoot = realpathSync(path);
  if (realRoot.toLocaleLowerCase("en-US") !== projected.toLocaleLowerCase("en-US")) {
    throw new Error("Output resolved to an unexpected location after creation.");
  }
  return realRoot;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function replaceJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "w" });
}

function writeJsonLines(path, values) {
  writeFileSync(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function filesBelow(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(root, path) : [{
      relativePath: relative(root, path).replaceAll("\\", "/"),
      bytes: statSync(path).size,
      sha256: sha256File(path),
    }];
  });
}

function assertDirectoryIdentity(path, expected) {
  const metadata = lstatSync(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      metadata.dev !== expected.dev || metadata.ino !== expected.ino) {
    throw new Error("External output directory identity changed.");
  }
  if (realpathSync(path).toLocaleLowerCase("en-US") !== resolve(path).toLocaleLowerCase("en-US")) {
    throw new Error("External output directory now resolves through an alias.");
  }
}

function removeOwnedScratch(outputRoot, outputIdentity, scratchRoot) {
  const expectedOutput = resolve(outputRoot);
  assertDirectoryIdentity(outputRoot, outputIdentity);
  if (realpathSync(outputRoot).toLocaleLowerCase("en-US") !== expectedOutput.toLocaleLowerCase("en-US")) {
    throw new Error("Output root identity changed before scratch cleanup.");
  }
  if (!existsSync(scratchRoot)) return;
  const scratchStat = lstatSync(scratchRoot);
  if (!scratchStat.isDirectory() || scratchStat.isSymbolicLink() ||
      realpathSync(scratchRoot).toLocaleLowerCase("en-US") !== resolve(scratchRoot).toLocaleLowerCase("en-US")) {
    throw new Error("Scratch identity changed before cleanup.");
  }
  const allowed = new Set(["observed-processes.jsonl", "stop-observer"]);
  const entries = readdirSync(scratchRoot, { withFileTypes: true });
  if (entries.some((entry) => !allowed.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error("Scratch contains an unowned entry; cleanup refused.");
  }
  for (const entry of entries) rmSync(join(scratchRoot, entry.name), { force: true });
  rmdirSync(scratchRoot);
}

function topLevelArtifactIndex(root, excluded) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && !excluded.has(entry.name))
    .map((entry) => {
      const path = join(root, entry.name);
      return { relativePath: entry.name, bytes: statSync(path).size, sha256: sha256File(path) };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function waitForCondition(predicate, timeoutMs, message, pollMs = 5) {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const check = async () => {
      try {
        const value = await predicate();
        if (value) {
          resolvePromise(value);
          return;
        }
        if (performance.now() >= deadline) {
          reject(new Error(message));
          return;
        }
        setTimeout(() => { void check(); }, pollMs);
      } catch (error) {
        reject(error);
      }
    };
    void check();
  });
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function validateProcessIdentity(identity) {
  if (!identity || typeof identity !== "object" ||
      !/^\d{10,20}$/u.test(identity.creationTimeUtcTicks ?? "") ||
      !/^[a-z0-9._-]{1,128}$/u.test(identity.imageNameLower ?? "") ||
      !/^[A-F0-9]{64}$/u.test(identity.imagePathTextSha256 ?? "")) {
    throw new Error("Windows process identity is incomplete or unsafe.");
  }
  return {
    creationTimeUtcTicks: identity.creationTimeUtcTicks,
    imageNameLower: identity.imageNameLower,
    imagePathTextSha256: identity.imagePathTextSha256,
  };
}

async function invokeProcessIdentityHelper(args) {
  const child = spawn(POWERSHELL, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", PROCESS_IDENTITY_HELPER,
    ...args,
  ], { cwd: REPOSITORY_ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (stdout.length + chunk.length > 16_384) child.kill();
    else stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 16_384) stderr += chunk;
  });
  const exited = new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolvePromise(code));
  });
  let code;
  try {
    code = await withTimeout(exited, 15_000, "Windows process-identity helper timed out.");
  } catch (error) {
    child.kill();
    try { await withTimeout(exited, 5_000, "Windows process-identity helper resisted cleanup."); } catch { /* preserve the original failure */ }
    throw error;
  }
  if (code !== 0) {
    throw new Error(`Windows process-identity helper failed (exit ${code}, ${stderr ? "stderr-present" : "no-stderr"}).`);
  }
  let result;
  try { result = JSON.parse(stdout.trim()); } catch (error) {
    throw new Error("Windows process-identity helper returned invalid JSON.", { cause: error });
  }
  if (!["running", "not-running", "identity-mismatch", "terminated"].includes(result?.outcome)) {
    throw new Error("Windows process-identity helper returned an unsafe outcome.");
  }
  if (result.outcome !== "not-running") validateProcessIdentity(result.identity);
  return result;
}

export async function inspectWindowsProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Unsafe process PID.");
  const result = await invokeProcessIdentityHelper(["-Mode", "Inspect", "-TargetProcessId", String(pid)]);
  return result.outcome === "not-running" ? null : validateProcessIdentity(result.identity);
}

function sameProcessIdentity(left, right) {
  return left !== null && right !== null &&
    left.creationTimeUtcTicks === right.creationTimeUtcTicks &&
    left.imageNameLower === right.imageNameLower &&
    left.imagePathTextSha256 === right.imagePathTextSha256;
}

async function expectedProcessIsAlive(pid, expectedIdentity) {
  return sameProcessIdentity(await inspectWindowsProcessIdentity(pid), expectedIdentity);
}

async function waitForExpectedProcessExit(pid, expectedIdentity, timeoutMs = 10_000) {
  await waitForCondition(
    async () => !await expectedProcessIsAlive(pid, expectedIdentity),
    timeoutMs,
    `Identity-bound MCP process ${pid} did not exit.`,
    100,
  );
}

export async function terminateIdentityBoundProcess(pid, expectedIdentity) {
  const identity = validateProcessIdentity(expectedIdentity);
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Unsafe process PID.");
  const result = await invokeProcessIdentityHelper([
    "-Mode", "Terminate",
    "-TargetProcessId", String(pid),
    "-ExpectedCreationTimeUtcTicks", identity.creationTimeUtcTicks,
    "-ExpectedImageNameLower", identity.imageNameLower,
    "-ExpectedImagePathTextSha256", identity.imagePathTextSha256,
  ]);
  if (await expectedProcessIsAlive(pid, identity)) {
    throw new Error("Identity-bound process remained alive after cleanup attempt.");
  }
  return result.outcome;
}

function startResourceObserver({ scratchRoot, intervalMs, beforeStopSignal }) {
  const registryPath = join(scratchRoot, "observed-processes.jsonl");
  const stopPath = join(scratchRoot, "stop-observer");
  writeFileSync(registryPath, `${JSON.stringify({ pid: process.pid, role: "runner" })}\n`, { encoding: "utf8", flag: "wx" });
  const child = spawn(POWERSHELL, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", OBSERVER,
    "-RootPid", String(process.pid),
    "-RegistryPath", registryPath,
    "-StopPath", stopPath,
    "-IntervalMs", String(intervalMs),
  ], { cwd: REPOSITORY_ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const samples = [];
  const parseErrors = [];
  let stdoutBuffer = "";
  let stderr = "";
  let closed = false;
  let exitCode = null;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const acceptLine = (line) => {
    if (!line.trim()) return;
    try {
      const value = JSON.parse(line);
      if (value?.type === "windows-resource-sample") samples.push(value);
      else parseErrors.push(value?.type ?? "unknown-record");
    } catch (error) {
      parseErrors.push(error instanceof Error ? error.name : "parse-error");
    }
  };
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    while (true) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      acceptLine(stdoutBuffer.slice(0, newline).replace(/\r$/u, ""));
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
    }
  });
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 16_384) stderr += chunk;
  });
  const exited = new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (stdoutBuffer) acceptLine(stdoutBuffer.replace(/\r?\n$/u, ""));
      closed = true;
      exitCode = code;
      resolvePromise(code);
    });
  });
  return {
    samples,
    parseErrors,
    register(pid, role) {
      if (!Number.isSafeInteger(pid) || pid < 1 || !/^[a-z][a-z0-9-]{0,31}$/u.test(role)) {
        throw new Error("Unsafe observed-process registration.");
      }
      appendFileSync(registryPath, `${JSON.stringify({ pid, role })}\n`, "utf8");
    },
    async waitForSample(predicate, timeoutMs = Math.max(15_000, intervalMs * 4), minimumSequence = 0) {
      return await waitForCondition(
        () => samples.findLast((sample) => sample.sequence > minimumSequence && predicate(sample)),
        timeoutMs,
        `Windows resource observer did not produce the required sample (${stderr ? "stderr-present" : "no-stderr"}).`,
        Math.min(50, intervalMs),
      );
    },
    async stop() {
      let timer;
      let code;
      try {
        if (!closed) {
          try {
            beforeStopSignal?.();
            writeFileSync(stopPath, "stop\n", { encoding: "utf8", flag: "wx" });
          } catch (signalError) {
            child.kill();
            try {
              await withTimeout(exited, 10_000, "Windows resource observer resisted cleanup after stop-signal failure.");
            } catch (cleanupError) {
              throw new AggregateError([signalError, cleanupError], "Observer stop signaling and exact-child cleanup failed.");
            }
            throw signalError;
          }
        }
        code = await Promise.race([
          exited,
          new Promise((resolvePromise) => {
            timer = setTimeout(() => resolvePromise("timeout"), intervalMs + 10_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (code === "timeout") {
        child.kill();
        await withTimeout(exited, 10_000, "Windows resource observer resisted forced cleanup.");
        throw new Error("Windows resource observer did not stop on request.");
      }
      if (exitCode !== 0 || parseErrors.length) {
        throw new Error(`Windows resource observer failed (exit ${exitCode}, parse errors ${parseErrors.length}).`);
      }
    },
    get stopped() { return closed; },
  };
}

function sampleHasCleanOwnedState(sample) {
  if (!sample || sample.sseProcessCount !== 0 || sample.sampleErrorCount !== 0) return false;
  const runner = sample.tracked.find((entry) => entry.role === "runner");
  if (!runner?.alive) return false;
  if (sample.tracked.some((entry) => entry.role !== "runner" && entry.alive)) return false;
  return sample.tracked.every((entry) => !entry.alive || entry.windows?.visible === 0);
}

function compactQuiescenceSample(sample) {
  if (!sample) return null;
  return {
    sequence: sample.sequence,
    monotonicMs: sample.monotonicMs,
    sseProcessCount: sample.sseProcessCount,
    sampleErrorCount: sample.sampleErrorCount,
    liveOwnedChildren: sample.tracked.filter((entry) => entry.role !== "runner" && entry.alive).length,
    visibleOwnedWindows: sample.tracked.filter((entry) => entry.alive)
      .reduce((sum, entry) => sum + (entry.windows?.visible ?? 0), 0),
  };
}

function summarizeResourceSamples(samples, { expectedIntervalMs }) {
  if (!Array.isArray(samples) || samples.length < 2) throw new Error("At least two Windows resource samples are required.");
  const gaps = [];
  for (let index = 1; index < samples.length; index += 1) {
    if (!(samples[index].monotonicMs > samples[index - 1].monotonicMs)) {
      throw new Error("Windows resource samples are not strictly monotonic.");
    }
    gaps.push(samples[index].monotonicMs - samples[index - 1].monotonicMs);
  }
  const alive = samples.flatMap((sample) => sample.tracked.filter((entry) => entry.alive));
  for (const entry of alive) {
    if (!/^\d{10,20}$/u.test(entry.identity?.creationTimeUtcTicks ?? "") ||
        !/^[A-F0-9]{64}$/u.test(entry.identity?.imagePathTextSha256 ?? "") ||
        typeof entry.identity?.imageNameLower !== "string" || !entry.identity.imageNameLower) {
      throw new Error("Windows resource sample has no immutable process identity.");
    }
  }
  for (const sample of samples) {
    if (![sample.scheduledMs, sample.captureStartedMs, sample.captureDurationMs, sample.latenessMs]
      .every((value) => Number.isFinite(value) && value >= 0) ||
      !Number.isSafeInteger(sample.missedIntervals) || sample.missedIntervals < 0) {
      throw new Error("Windows resource sample has invalid cadence telemetry.");
    }
  }
  const metric = (name) => alive.map((entry) => entry[name]).filter(Number.isFinite);
  const windowMetric = (name) => alive.map((entry) => entry.windows?.[name]).filter(Number.isFinite);
  const cpuByIdentity = new Map();
  for (const sample of samples) {
    for (const entry of sample.tracked.filter((candidate) => candidate.alive && Number.isFinite(candidate.cpuTotalMs))) {
      const identity = `${entry.pid}:${entry.identity?.creationTimeUtcTicks ?? "unknown"}`;
      const current = cpuByIdentity.get(identity) ?? { minimum: entry.cpuTotalMs, maximum: entry.cpuTotalMs };
      current.minimum = Math.min(current.minimum, entry.cpuTotalMs);
      current.maximum = Math.max(current.maximum, entry.cpuTotalMs);
      cpuByIdentity.set(identity, current);
    }
  }
  const cpuUsedMs = [...cpuByIdentity.values()].reduce((sum, value) => sum + value.maximum - value.minimum, 0);
  const observedDurationMs = samples.at(-1).monotonicMs - samples[0].monotonicMs;
  const firstRunner = samples[0].tracked.find((entry) => entry.role === "runner" && entry.alive);
  const lastRunner = samples.at(-1).tracked.find((entry) => entry.role === "runner" && entry.alive);
  const lastByRole = Object.fromEntries(samples.at(-1).tracked.map((entry) => [entry.role, entry.alive]));
  const aggregateSamples = samples.map((sample) => {
    const current = sample.tracked.filter((entry) => entry.alive);
    return {
      workingSetBytes: current.reduce((sum, entry) => sum + (entry.workingSetBytes ?? 0), 0),
      privateBytes: current.reduce((sum, entry) => sum + (entry.privateBytes ?? 0), 0),
      handleCount: current.reduce((sum, entry) => sum + (entry.handleCount ?? 0), 0),
    };
  });
  const maximumAggregate = (name) => Math.max(...aggregateSamples.map((sample) => sample[name]));
  const firstAggregate = aggregateSamples[0];
  const lastAggregate = aggregateSamples.at(-1);
  return {
    sampleCount: samples.length,
    expectedIntervalMs,
    observedGapMs: {
      minimum: rounded(Math.min(...gaps)),
      maximum: rounded(Math.max(...gaps)),
    },
    maximumSampleLatenessMs: Math.max(...samples.map((sample) => sample.latenessMs)),
    maximumCaptureDurationMs: Math.max(...samples.map((sample) => sample.captureDurationMs)),
    missedIntervalCount: Math.max(...samples.map((sample) => sample.missedIntervals)),
    perProcessMaximum: {
      workingSetBytes: Math.max(...metric("workingSetBytes")),
      privateBytes: Math.max(...metric("privateBytes")),
      handleCount: Math.max(...metric("handleCount")),
    },
    ownedTreeMaximum: {
      workingSetBytes: maximumAggregate("workingSetBytes"),
      privateBytes: maximumAggregate("privateBytes"),
      handleCount: maximumAggregate("handleCount"),
    },
    observedCpuLowerBoundMs: rounded(cpuUsedMs),
    observedAverageCpuPercentOneCoreLowerBound: observedDurationMs > 0
      ? rounded(cpuUsedMs / observedDurationMs * 100)
      : null,
    ownedTreeFinalDrift: {
      workingSetBytes: lastAggregate.workingSetBytes - firstAggregate.workingSetBytes,
      privateBytes: lastAggregate.privateBytes - firstAggregate.privateBytes,
      handleCount: lastAggregate.handleCount - firstAggregate.handleCount,
    },
    runnerDrift: {
      workingSetBytes: (lastRunner?.workingSetBytes ?? 0) - (firstRunner?.workingSetBytes ?? 0),
      privateBytes: (lastRunner?.privateBytes ?? 0) - (firstRunner?.privateBytes ?? 0),
      handleCount: (lastRunner?.handleCount ?? 0) - (firstRunner?.handleCount ?? 0),
    },
    maximumTrackedAlive: Math.max(...samples.map((sample) => sample.tracked.filter((entry) => entry.alive).length)),
    maximumSseProcessCount: Math.max(...samples.map((sample) => sample.sseProcessCount)),
    maximumVisibleOwnedWindows: Math.max(...windowMetric("visible")),
    maximumOwnedModalCandidates: Math.max(...windowMetric("modalCandidates")),
    sampleErrorCount: samples.reduce((sum, sample) => sum + sample.sampleErrorCount, 0),
    desktopScope: samples.at(-1).desktopScope,
    finalAliveByRole: lastByRole,
    finalTracked: samples.at(-1).tracked.map((entry) => ({ pid: entry.pid, role: entry.role, alive: entry.alive })),
  };
}

function resultToken(response) {
  return response?.result?.hits?.[0]?.name ?? response?.structuredContent?.hits?.[0]?.name;
}

function requestOutcome({ status, body, token }) {
  if (status === 200) {
    const matched = resultToken(body) === token;
    return {
      outcome: matched ? "ok" : "identity-mismatch",
      terminalKind: matched ? null : "identity-mismatch",
      successful: matched,
      busy: false,
      identityMatched: matched,
    };
  }
  if (status === 409 && body?.error?.code === "busy") {
    return { outcome: "busy", terminalKind: "busy", successful: false, busy: true, identityMatched: false };
  }
  const terminalKind = body?.error?.code === "worker-failed" ? "worker-failed" : "unexpected-error";
  return {
    outcome: terminalKind,
    terminalKind,
    successful: false,
    busy: false,
    identityMatched: false,
  };
}

async function httpFind(baseUrl, job, { clientQueueWaitMs = 0, signal } = {}) {
  const startedAt = performance.now();
  const response = await localHttpFetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { name: job.token } }),
    ...(signal ? { signal } : {}),
  });
  const body = await response.json();
  const classified = requestOutcome({ status: response.status, body, token: job.token });
  const transportTimeMs = performance.now() - startedAt;
  return {
    phase: job.phase,
    mode: job.mode,
    sequence: job.sequence,
    caller: job.caller,
    arrivalShape: job.arrivalShape,
    transport: "http",
    ...classified,
    httpStatus: response.status,
    admitted: false,
    executorReached: false,
    clientQueueWaitMs,
    serverQueueWaitMs: null,
    serviceTimeMs: null,
    apiDurationMs: Number.isFinite(body.durationMs) ? body.durationMs : null,
    transportTimeMs,
    endToEndMs: clientQueueWaitMs + transportTimeMs,
  };
}

async function mcpFind(client, job, { clientQueueWaitMs = 0 } = {}) {
  const startedAt = performance.now();
  const response = await client.callTool({ name: "sse_find", arguments: { name: job.token } });
  const transportTimeMs = performance.now() - startedAt;
  const matched = response.isError !== true && resultToken(response) === job.token;
  const outcome = response.isError === true ? "mcp-error" : matched ? "ok" : "identity-mismatch";
  return {
    phase: job.phase,
    mode: job.mode,
    sequence: job.sequence,
    caller: job.caller,
    arrivalShape: job.arrivalShape,
    transport: "mcp",
    outcome,
    terminalKind: outcome === "ok" ? null : outcome,
    httpStatus: null,
    admitted: false,
    executorReached: false,
    successful: outcome === "ok",
    busy: response.structuredContent?.kind === "busy",
    identityMatched: matched,
    clientQueueWaitMs,
    serverQueueWaitMs: null,
    serviceTimeMs: null,
    apiDurationMs: null,
    transportTimeMs,
    endToEndMs: clientQueueWaitMs + transportTimeMs,
  };
}

function assertSuccessfulRecord(record, label) {
  if (record.outcome !== "ok" || !record.admitted || !record.executorReached ||
      !record.successful || record.busy || !record.identityMatched) {
    throw new Error(`${label} failed semantic identity or admission checks.`);
  }
}

async function healthIsIdle(baseUrl) {
  const response = await localHttpFetch(`${baseUrl}/healthz`, { method: "GET" });
  if (response.status !== 200) return false;
  const body = await response.json();
  return body.inFlight === null;
}

function summarizeEventLoop(histogram) {
  const nsToMs = (value) => rounded(value / 1_000_000);
  return {
    minMs: nsToMs(histogram.min),
    maxMs: nsToMs(histogram.max),
    meanMs: nsToMs(histogram.mean),
    p50Ms: nsToMs(histogram.percentile(50)),
    p95Ms: nsToMs(histogram.percentile(95)),
    p99Ms: nsToMs(histogram.percentile(99)),
  };
}

function lifecycleRecord(sequence, phase, outcome, { generation } = {}) {
  if (!/^[a-z][a-z0-9-]{0,47}$/u.test(phase) || !/^[a-z][a-z0-9-]{0,47}$/u.test(outcome)) {
    throw new Error("Unsafe lifecycle record token.");
  }
  if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 1)) {
    throw new Error("Unsafe lifecycle generation.");
  }
  return {
    schemaVersion: API_LOAD_SCHEMA_VERSION,
    type: "lifecycle",
    sequence,
    phase,
    outcome,
    ...(generation === undefined ? {} : { generation }),
  };
}

function classifyExpectedMcpRejection(error, expected) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const matches = expected === "cancelled" ? /abort|cancel/iu.test(text) : /timed?\s*out|timeout/iu.test(text);
  if (!matches) throw new Error(`MCP ${expected} control returned an unexpected rejection class.`);
  return expected;
}

function compactExecutorJournal(entries) {
  return entries.map((entry) => ({
    schemaVersion: API_LOAD_SCHEMA_VERSION,
    type: "executor-call",
    sequence: entry.sequence,
    operation: entry.operation,
    tokenDigest: entry.tokenDigest,
    generation: entry.generation,
    outcome: entry.outcome,
    elapsedMs: entry.elapsedMs,
  }));
}

export async function runApiLoadWorkload(options, testOnly = {}) {
  const canonical = testOnly.allowNonCanonical !== true;
  const settings = {
    arrivalRounds: testOnly.arrivalRounds ?? 20,
    fairJobsPerCaller: testOnly.fairJobsPerCaller ?? 16,
    soakOperations: testOnly.soakOperations ?? API_LOAD_CANONICAL_OPERATIONS,
    soakDurationMs: testOnly.soakDurationMs ?? API_LOAD_CANONICAL_DURATION_MS,
    observerIntervalMs: testOnly.observerIntervalMs ?? API_LOAD_CANONICAL_SAMPLE_MS,
    quiescenceGapMs: testOnly.quiescenceGapMs ?? API_LOAD_CANONICAL_SAMPLE_MS,
    normalDelayMs: testOnly.normalDelayMs ?? 2,
    controlTimeoutMs: testOnly.controlTimeoutMs ?? 250,
  };
  if (canonical && (
    settings.soakOperations !== API_LOAD_CANONICAL_OPERATIONS ||
    settings.soakDurationMs !== API_LOAD_CANONICAL_DURATION_MS ||
    settings.observerIntervalMs !== API_LOAD_CANONICAL_SAMPLE_MS ||
    settings.quiescenceGapMs < API_LOAD_CANONICAL_SAMPLE_MS
  )) throw new Error("Canonical API load settings cannot be weakened.");
  if (!Number.isSafeInteger(settings.arrivalRounds) || settings.arrivalRounds < 1 || settings.arrivalRounds > 1_000 ||
      !Number.isSafeInteger(settings.fairJobsPerCaller) || settings.fairJobsPerCaller < 1 || settings.fairJobsPerCaller > 1_000 ||
      !Number.isSafeInteger(settings.controlTimeoutMs) || settings.controlTimeoutMs < 25 || settings.controlTimeoutMs > 5_000) {
    throw new Error("Invalid API load settings.");
  }
  const projectedOutput = projectExternalNewDirectory(options.output);
  const outputRoot = claimExternalNewDirectory(options.output, projectedOutput);
  const outputIdentity = lstatSync(outputRoot, { bigint: true });
  const scratchRoot = join(outputRoot, ".scratch");
  mkdirSync(scratchRoot);
  const source = sourceFingerprint();
  const runtime = runtimeFingerprint();
  const generatedAt = new Date().toISOString();
  const operationRecords = [];
  const lifecycleRecords = [];
  const rawSummaries = [];
  const fairSummaries = [];
  const ownedMcpPids = [];
  const ownedMcpBindings = [];
  const apiLogs = [];
  const executor = createSyntheticFindExecutor({ normalDelayMs: settings.normalDelayMs });
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  const runAbort = new AbortController();
  let interruptedSignal = null;
  const interrupt = (signalName) => {
    interruptedSignal = signalName;
    runAbort.abort(new Error(`API load workload interrupted by ${signalName}.`));
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  let observer;
  let api = null;
  let mcp = null;
  let baseUrl = "";
  let fixedPort = 0;
  let lifecycleSequence = 0;
  let operationSequence = 0;
  let primaryError;
  let failureStage = "preflight";
  let summary;
  let finalQuiescence = null;
  let lastObserverState = null;
  let failApiCloseOnce = testOnly.failBeforeApiCloseOnce === true;
  let failMcpCloseOnce = testOnly.failBeforeMcpCloseOnce === true;
  let failObserverStopSignalOnce = testOnly.failBeforeObserverStopSignalOnce === true;
  const nextLifecycle = (phase, outcome, extra) => {
    const record = lifecycleRecord(++lifecycleSequence, phase, outcome, extra);
    lifecycleRecords.push(record);
    return record;
  };
  const nextJob = (phase, mode, caller = 1, transport = "http", arrivalShape = 1) => {
    operationSequence += 1;
    return {
      phase,
      mode,
      caller,
      arrivalShape,
      transport,
      sequence: operationSequence,
      token: `load-${phase}-c${String(caller).padStart(2, "0")}-s${String(operationSequence).padStart(6, "0")}`,
    };
  };
  const finalizeExecutionRecord = (record, job) => {
    const tokenDigest = sha256(job.token);
    const execution = executor.snapshot().journal.findLast((entry) => entry.tokenDigest === tokenDigest);
    const reached = execution !== undefined;
    return {
      ...record,
      admitted: reached,
      executorReached: reached,
      serviceTimeMs: reached ? execution.elapsedMs : null,
    };
  };
  const startApi = async (requestedPort = 0) => {
    if (api) throw new Error("API is already running.");
    const server = createSseApiServer({ execute: executor.execute, log: (record) => apiLogs.push(record) });
    const shutdown = new AbortController();
    const lifecycle = installApiShutdown(server, shutdown, () => undefined, {
      registerProcessSignals: false,
      forceAfterMs: 5_000,
    });
    api = { server, lifecycle };
    try {
      server.listen(requestedPort, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("API did not expose a TCP address.");
      fixedPort = address.port;
      baseUrl = `http://127.0.0.1:${fixedPort}`;
    } catch (error) {
      lifecycle.requestShutdown();
      await lifecycle.closed;
      lifecycle.dispose();
      if (!server.listening) api = null;
      throw error;
    }
  };
  const stopApi = async () => {
    if (!api) return;
    const current = api;
    if (failApiCloseOnce) {
      failApiCloseOnce = false;
      throw new Error("Injected API close failure before ownership release.");
    }
    current.lifecycle.requestShutdown();
    await current.lifecycle.closed;
    current.lifecycle.dispose();
    if (current.server.listening) throw new Error("API remained listening after shutdown.");
    api = null;
  };
  const startMcp = async () => {
    if (mcp) throw new Error("MCP is already running.");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_SERVER],
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, SSE_API_URL: baseUrl },
      stderr: "pipe",
    });
    const client = new Client({ name: "sse-api-load-workload", version: "1.0.0" });
    const role = `mcp-${String(ownedMcpPids.length + 1).padStart(2, "0")}`;
    let stderrBytes = 0;
    transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
    mcp = { client, transport, pid: null, identity: null, role, get stderrBytes() { return stderrBytes; } };
    try {
      await client.connect(transport);
      const pid = transport.pid;
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("MCP transport exposed no child PID.");
      mcp.pid = pid;
      mcp.identity = await inspectWindowsProcessIdentity(pid);
      if (!mcp.identity) throw new Error("MCP child exited before immutable identity binding.");
      mcp.binding = { pid, identity: mcp.identity, identityMatchedAlive: true };
      ownedMcpPids.push(pid);
      ownedMcpBindings.push(mcp.binding);
      observer.register(pid, role);
      const floor = observer.samples.at(-1)?.sequence ?? 0;
      await observer.waitForSample(
        (sample) => sample.tracked.some((entry) => (
          entry.pid === pid && entry.alive && sameProcessIdentity(entry.identity, mcp.identity)
        )),
        undefined,
        floor,
      );
    } catch (error) {
      const current = mcp;
      const pid = current.pid ?? transport.pid;
      if (Number.isSafeInteger(pid) && pid > 0 && !ownedMcpPids.includes(pid)) {
        ownedMcpPids.push(pid);
        try { observer.register(pid, role); } catch { /* cleanup still owns the exact transport PID */ }
      }
      const cleanupErrors = [];
      try { await client.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      try { await transport.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      if (Number.isSafeInteger(pid) && pid > 0 && current.identity) {
        try { await terminateIdentityBoundProcess(pid, current.identity); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      const identityMatchedAlive = Number.isSafeInteger(pid) && pid > 0 && current.identity
        ? await expectedProcessIsAlive(pid, current.identity)
        : null;
      if (current.binding) current.binding.identityMatchedAlive = identityMatchedAlive === true;
      if (!Number.isSafeInteger(pid) || pid < 1 ||
          (current.identity ? !identityMatchedAlive : !pidExists(pid))) mcp = null;
      throw cleanupErrors.length ? new AggregateError([error, ...cleanupErrors], "MCP startup and cleanup failed.") : error;
    }
  };
  const stopMcp = async () => {
    if (!mcp) return;
    const current = mcp;
    if (failMcpCloseOnce) {
      failMcpCloseOnce = false;
      throw new Error("Injected MCP close failure before ownership release.");
    }
    const errors = [];
    let clientClosed = false;
    try {
      await current.client.close();
      clientClosed = true;
    } catch (error) { errors.push(error); }
    if (!clientClosed || (Number.isSafeInteger(current.pid) && current.pid > 0 && pidExists(current.pid))) {
      try { await current.transport.close(); } catch (error) { errors.push(error); }
    }
    if (Number.isSafeInteger(current.pid) && current.pid > 0 && current.identity &&
        await expectedProcessIsAlive(current.pid, current.identity)) {
      try { await waitForExpectedProcessExit(current.pid, current.identity, 2_000); } catch (error) {
        errors.push(error);
        try { await terminateIdentityBoundProcess(current.pid, current.identity); } catch (forceError) { errors.push(forceError); }
      }
    } else if (Number.isSafeInteger(current.pid) && current.pid > 0 && !current.identity && pidExists(current.pid)) {
      errors.push(new Error("MCP process remained alive without an immutable identity; forced cleanup was refused."));
    }
    const identityMatchedAlive = Number.isSafeInteger(current.pid) && current.pid > 0 && current.identity
      ? await expectedProcessIsAlive(current.pid, current.identity)
      : null;
    if (current.binding) current.binding.identityMatchedAlive = identityMatchedAlive === true;
    if (!Number.isSafeInteger(current.pid) || current.pid < 1 ||
        (current.identity ? !identityMatchedAlive : !pidExists(current.pid))) mcp = null;
    if (errors.length) throw new AggregateError(errors, "MCP close required cleanup recovery.");
  };
  const dispatch = async (job, clientQueueWaitMs = 0) => {
    const rawRecord = job.transport === "http"
      ? await httpFind(baseUrl, job, { clientQueueWaitMs })
      : await mcpFind(mcp.client, job, { clientQueueWaitMs });
    const safe = sanitizeLoadRecord(finalizeExecutionRecord(rawRecord, job));
    operationRecords.push(safe);
    return safe;
  };

  try {
    if (await hasRunningSseProcess()) throw new Error("SSE.exe must be closed for the product-free load workload.");
    writeJson(join(outputRoot, "run.json"), {
      schemaVersion: API_LOAD_SCHEMA_VERSION,
      benchmark: API_LOAD_BENCHMARK_ID,
      command: "npm run perf:api-load-soak",
      generatedAt,
      canonical,
      settings,
      source,
      runtime,
      productFree: true,
      sseStarted: false,
      installedProductMutationAttempted: false,
      serverQueueSemantics: "fail-fast-no-queue",
    });
    failureStage = "observer-start";
    observer = startResourceObserver({
      scratchRoot,
      intervalMs: settings.observerIntervalMs,
      beforeStopSignal: () => {
        if (failObserverStopSignalOnce) {
          failObserverStopSignalOnce = false;
          throw new Error("Injected observer stop-signal failure before ownership release.");
        }
      },
    });
    await observer.waitForSample((sample) => sample.tracked.some((entry) => entry.role === "runner" && entry.alive));
    eventLoop.enable();
    failureStage = "api-mcp-start";
    await startApi();
    await startMcp();
    nextLifecycle("synthetic-cold", "started");

    const cold = await dispatch(nextJob("synthetic-cold", "control", 1, "http"));
    assertSuccessfulRecord(cold, "Synthetic cold probe");
    nextLifecycle("synthetic-warming", "started");
    const warming = await dispatch(nextJob("synthetic-warming", "control", 1, "mcp"));
    assertSuccessfulRecord(warming, "Synthetic warming probe");

    failureStage = "raw-arrivals";
    for (const callers of API_LOAD_CALLER_SHAPES) {
      const shapeStartedAt = performance.now();
      const shapeRecords = [];
      for (let round = 1; round <= settings.arrivalRounds; round += 1) {
        const beforeCalls = executor.snapshot().journal.length;
        const gate = executor.holdNext();
        let settled = 0;
        const attempts = Array.from({ length: callers }, (_, index) => {
          const job = nextJob(
            `raw-c${String(callers).padStart(2, "0")}`,
            "raw-burst",
            index + 1,
            "http",
            callers,
          );
          const promise = httpFind(baseUrl, job).finally(() => { settled += 1; });
          return { job, promise };
        });
        const all = Promise.all(attempts.map((attempt) => attempt.promise));
        void all.catch(() => undefined);
        try {
          await withTimeout(gate.started, 5_000, `Raw ${callers}-caller burst never reached the executor.`);
          await waitForCondition(
            () => settled >= callers - 1,
            5_000,
            `Raw ${callers}-caller burst did not return all busy peers while the admitted call was held.`,
          );
        } finally {
          gate.release();
        }
        const results = await all;
        const safe = results.map((record, index) => sanitizeLoadRecord(
          finalizeExecutionRecord(record, attempts[index].job),
        ));
        operationRecords.push(...safe);
        shapeRecords.push(...safe);
        const admitted = safe.filter((record) => record.admitted);
        const busy = safe.filter((record) => record.busy);
        if (admitted.length !== 1 || busy.length !== callers - 1 ||
            admitted[0].outcome !== "ok" || !admitted[0].identityMatched) {
          throw new Error(`Raw ${callers}-caller admission contract failed at round ${round}.`);
        }
        if (executor.snapshot().journal.length !== beforeCalls + 1) {
          throw new Error(`Raw ${callers}-caller busy work reached the executor.`);
        }
      }
      const shapeElapsedMs = performance.now() - shapeStartedAt;
      rawSummaries.push({
        callerShape: callers,
        rounds: settings.arrivalRounds,
        elapsedMs: rounded(shapeElapsedMs),
        throughputRequestsPerSecond: rounded(shapeRecords.length / (shapeElapsedMs / 1_000)),
        ...summarizeLoadRecords(shapeRecords),
      });
    }

    failureStage = "fair-arrivals";
    for (const callers of API_LOAD_CALLER_SHAPES) {
      const plan = createFairPlan({ callers, jobsPerCaller: settings.fairJobsPerCaller, phase: `fair-c${String(callers).padStart(2, "0")}` });
      const offeredAt = performance.now();
      const shapeRecords = [];
      for (const planned of plan) {
        const job = nextJob(planned.phase, "fair-client-queue", planned.caller, planned.transport, callers);
        const record = await dispatch(job, performance.now() - offeredAt);
        assertSuccessfulRecord(record, `Fair ${callers}-caller job`);
        shapeRecords.push(record);
      }
      const summaryForShape = summarizeLoadRecords(shapeRecords);
      const completionOrder = summarizeCompletionOrder(shapeRecords, callers);
      if (summaryForShape.busy !== 0 || summaryForShape.completionFairness.jain !== 1 ||
          summaryForShape.completionFairness.minimum !== settings.fairJobsPerCaller ||
          summaryForShape.completionFairness.maximum !== settings.fairJobsPerCaller ||
          !completionOrder.exactRoundRobin || completionOrder.actualDigest !== completionOrder.expectedDigest ||
          completionOrder.longestCompletionGap > callers - 1 || completionOrder.starvationCount !== 0) {
        throw new Error(`Fair ${callers}-caller queue contract failed.`);
      }
      const shapeElapsedMs = performance.now() - offeredAt;
      fairSummaries.push({
        callerShape: callers,
        jobsPerCaller: settings.fairJobsPerCaller,
        elapsedMs: rounded(shapeElapsedMs),
        throughputOperationsPerSecond: rounded(shapeRecords.length / (shapeElapsedMs / 1_000)),
        ...summaryForShape,
        completionOrder,
      });
    }

    failureStage = "cancellation-control";
    const cancellationGate = executor.holdNext();
    const cancellationController = new AbortController();
    const cancellationJob = nextJob("cancellation", "control", 1, "mcp");
    const cancellationStartedAt = performance.now();
    const cancellationLogStart = apiLogs.length;
    const cancellation = mcp.client.callTool(
      { name: "sse_find", arguments: { name: cancellationJob.token } },
      undefined,
      { signal: cancellationController.signal, timeout: 10_000, maxTotalTimeout: 10_000 },
    );
    void cancellation.catch(() => undefined);
    let cancellationError;
    try {
      await withTimeout(cancellationGate.started, 5_000, "MCP cancellation control never reached the executor.");
      cancellationController.abort();
      try { await cancellation; } catch (error) { cancellationError = error; }
      await waitForCondition(
        () => executor.snapshot().journal.at(-1)?.outcome === "aborted",
        5_000,
        "MCP cancellation did not reach the admitted executor call.",
        10,
      );
    } finally {
      cancellationController.abort();
      cancellationGate.release();
    }
    await executor.waitForIdle();
    await waitForCondition(() => healthIsIdle(baseUrl), 5_000, "API did not clear inFlight after MCP cancellation.", 20);
    await waitForCondition(
      () => apiLogs.slice(cancellationLogStart).some((record) => (
        record.event === "operation" && record.kind === "aborted" && record.delivered === false
      )),
      5_000,
      "API did not record an undelivered aborted cancellation result.",
      10,
    );
    if (!cancellationError || executor.snapshot().journal.at(-1)?.outcome !== "aborted") {
      throw new Error("MCP cancellation did not abort the admitted executor call.");
    }
    const cancellationKind = classifyExpectedMcpRejection(cancellationError, "cancelled");
    const cancellationTransportTimeMs = performance.now() - cancellationStartedAt;
    operationRecords.push(sanitizeLoadRecord(finalizeExecutionRecord({
      phase: cancellationJob.phase,
      mode: cancellationJob.mode,
      sequence: cancellationJob.sequence,
      caller: cancellationJob.caller,
      arrivalShape: cancellationJob.arrivalShape,
      transport: "mcp",
      outcome: cancellationKind,
      terminalKind: cancellationKind,
      httpStatus: null,
      admitted: false,
      executorReached: false,
      successful: false,
      busy: false,
      identityMatched: false,
      clientQueueWaitMs: 0,
      serverQueueWaitMs: null,
      serviceTimeMs: null,
      apiDurationMs: null,
      transportTimeMs: cancellationTransportTimeMs,
      endToEndMs: cancellationTransportTimeMs,
    }, cancellationJob)));
    nextLifecycle("cancellation", "observed");
    assertSuccessfulRecord(await dispatch(nextJob("cancellation-recovery", "control", 1, "http")), "Cancellation recovery");

    failureStage = "timeout-control";
    const timeoutGate = executor.holdNext();
    const timeoutJob = nextJob("timeout", "control", 1, "mcp");
    const timeoutStartedAt = performance.now();
    const timeoutLogStart = apiLogs.length;
    const timed = mcp.client.callTool(
      { name: "sse_find", arguments: { name: timeoutJob.token } },
      undefined,
      { timeout: settings.controlTimeoutMs, maxTotalTimeout: settings.controlTimeoutMs },
    );
    void timed.catch(() => undefined);
    let timeoutError;
    try {
      await withTimeout(timeoutGate.started, 5_000, "MCP timeout control never reached the executor.");
      try { await timed; } catch (error) { timeoutError = error; }
      await waitForCondition(
        () => executor.snapshot().journal.at(-1)?.outcome === "aborted",
        5_000,
        "MCP timeout did not reach the admitted executor call.",
        10,
      );
    } finally {
      timeoutGate.release();
    }
    await executor.waitForIdle();
    await waitForCondition(() => healthIsIdle(baseUrl), 5_000, "API did not clear inFlight after MCP timeout.", 20);
    await waitForCondition(
      () => apiLogs.slice(timeoutLogStart).some((record) => (
        record.event === "operation" && record.kind === "aborted" && record.delivered === false
      )),
      5_000,
      "API did not record an undelivered aborted timeout result.",
      10,
    );
    if (!timeoutError || executor.snapshot().journal.at(-1)?.outcome !== "aborted") {
      throw new Error("MCP timeout did not abort the admitted executor call.");
    }
    const timeoutKind = classifyExpectedMcpRejection(timeoutError, "timed-out");
    const timeoutTransportTimeMs = performance.now() - timeoutStartedAt;
    operationRecords.push(sanitizeLoadRecord(finalizeExecutionRecord({
      phase: timeoutJob.phase,
      mode: timeoutJob.mode,
      sequence: timeoutJob.sequence,
      caller: timeoutJob.caller,
      arrivalShape: timeoutJob.arrivalShape,
      transport: "mcp",
      outcome: timeoutKind,
      terminalKind: timeoutKind,
      httpStatus: null,
      admitted: false,
      executorReached: false,
      successful: false,
      busy: false,
      identityMatched: false,
      clientQueueWaitMs: 0,
      serverQueueWaitMs: null,
      serviceTimeMs: null,
      apiDurationMs: null,
      transportTimeMs: timeoutTransportTimeMs,
      endToEndMs: timeoutTransportTimeMs,
    }, timeoutJob)));
    nextLifecycle("timeout", "observed");
    assertSuccessfulRecord(await dispatch(nextJob("timeout-recovery", "control", 1, "mcp")), "Timeout recovery");

    failureStage = "synthetic-recovery-control";
    executor.failFollowingCall();
    const failure = await dispatch(nextJob("executor-failure", "control", 1, "http"));
    if (failure.outcome !== "worker-failed" || failure.httpStatus !== 502) {
      throw new Error("Injected executor failure did not cross the real HTTP error boundary.");
    }
    const recoveredGeneration = executor.recover();
    nextLifecycle("synthetic-recovery", "generation-advanced", { generation: recoveredGeneration });
    assertSuccessfulRecord(await dispatch(nextJob("executor-recovery", "control", 1, "mcp")), "Executor recovery");

    failureStage = "api-restart-control";
    await stopApi();
    await startApi(fixedPort);
    nextLifecycle("api-restart", "same-port-restored");
    assertSuccessfulRecord(await dispatch(nextJob("api-restart", "control", 1, "mcp")), "Same-port API restart");

    failureStage = "mcp-restart-control";
    await stopMcp();
    await startMcp();
    nextLifecycle("mcp-restart", "child-replaced");
    assertSuccessfulRecord(await dispatch(nextJob("mcp-restart", "control", 1, "mcp")), "MCP restart");

    failureStage = "soak";
    const soakPlan = createSoakPlan({
      operationCount: settings.soakOperations,
      durationMs: settings.soakDurationMs,
      callers: 8,
    });
    const soakObserverStartSequence = observer.samples.at(-1)?.sequence ?? 0;
    const soakStartedAt = performance.now();
    const soakRecords = [];
    for (let index = 0; index < soakPlan.length; index += 1) {
      const planned = soakPlan[index];
      const scheduledAt = soakStartedAt + planned.scheduledOffsetMs;
      await sleepUntil(scheduledAt, runAbort.signal);
      const job = nextJob(planned.phase, "scheduled-soak", planned.caller, planned.transport, 8);
      const record = await dispatch(job, Math.max(0, performance.now() - scheduledAt));
      assertSuccessfulRecord(record, `Soak operation ${index + 1}`);
      soakRecords.push(record);
      if (!testOnly.silent && ((index + 1) % 64 === 0 || index + 1 === soakPlan.length)) {
        process.stdout.write(`${JSON.stringify({ type: "progress", completed: index + 1, total: soakPlan.length })}\n`);
      }
    }
    const soakElapsedMs = performance.now() - soakStartedAt;
    const soakObserverEndSequence = observer.samples.at(-1)?.sequence ?? soakObserverStartSequence;
    const soakResourceSampleCount = observer.samples.filter((sample) => (
      sample.sequence > soakObserverStartSequence && sample.sequence <= soakObserverEndSequence
    )).length;
    if (soakElapsedMs < settings.soakDurationMs) throw new Error("Soak ended before its final scheduled arrival.");
    const soakOrder = summarizeCompletionOrder(soakRecords, 8);
    const soakSummary = {
      elapsedMs: rounded(soakElapsedMs),
      throughputOperationsPerSecond: rounded(soakRecords.length / (soakElapsedMs / 1_000)),
      resourceSampleCount: soakResourceSampleCount,
      ...summarizeLoadRecords(soakRecords),
      completionOrder: soakOrder,
    };
    if (soakSummary.count !== settings.soakOperations || soakSummary.admitted !== settings.soakOperations ||
        soakSummary.identityMatched !== settings.soakOperations || soakSummary.busy !== 0 ||
        soakSummary.completionFairness.jain !== 1 || !soakOrder.exactRoundRobin ||
        soakOrder.actualDigest !== soakOrder.expectedDigest || soakOrder.longestCompletionGap > 7 ||
        soakOrder.starvationCount !== 0 || executor.snapshot().maximumActive !== 1) {
      throw new Error("Soak correctness, fairness, or single-flight contract failed.");
    }
    if (canonical && (soakSummary.count < API_LOAD_CANONICAL_OPERATIONS || soakSummary.elapsedMs < API_LOAD_CANONICAL_DURATION_MS)) {
      throw new Error("Canonical soak minima were not met.");
    }
    if (canonical && soakResourceSampleCount < Math.max(1, Math.floor(settings.soakDurationMs / settings.observerIntervalMs) - 2)) {
      throw new Error("Canonical soak did not retain continuous resource-sample coverage.");
    }

    failureStage = "owned-cleanup";
    await stopMcp();
    await stopApi();
    await executor.waitForIdle();
    nextLifecycle("clean-shutdown", "owned-roots-closed");
    eventLoop.disable();
    const quietFloorSequence = observer.samples.at(-1)?.sequence ?? 0;
    const firstQuiet = await observer.waitForSample(
      sampleHasCleanOwnedState,
      undefined,
      quietFloorSequence,
    );
    const secondQuiet = await observer.waitForSample((sample) => (
      sampleHasCleanOwnedState(sample) && sample.monotonicMs - firstQuiet.monotonicMs >= settings.quiescenceGapMs
    ), Math.max(15_000, settings.quiescenceGapMs + settings.observerIntervalMs * 3), firstQuiet.sequence);
    finalQuiescence = {
      floorSequence: quietFloorSequence,
      first: compactQuiescenceSample(firstQuiet),
      second: compactQuiescenceSample(secondQuiet),
      gapMs: rounded(secondQuiet.monotonicMs - firstQuiet.monotonicMs),
    };
    await observer.stop();
    const resourceSummary = summarizeResourceSamples(observer.samples, { expectedIntervalMs: settings.observerIntervalMs });
    if (resourceSummary.maximumSseProcessCount !== 0 || resourceSummary.sampleErrorCount !== 0 ||
        resourceSummary.maximumVisibleOwnedWindows !== 0 || resourceSummary.maximumOwnedModalCandidates !== 0 ||
        finalQuiescence.first.liveOwnedChildren !== 0 || finalQuiescence.second.liveOwnedChildren !== 0 ||
        finalQuiescence.first.sseProcessCount !== 0 || finalQuiescence.second.sseProcessCount !== 0 ||
        finalQuiescence.first.visibleOwnedWindows !== 0 || finalQuiescence.second.visibleOwnedWindows !== 0) {
      throw new Error(`Windows resource or final quiescence contract failed: ${JSON.stringify({
        maximumSseProcessCount: resourceSummary.maximumSseProcessCount,
        sampleErrorCount: resourceSummary.sampleErrorCount,
        maximumVisibleOwnedWindows: resourceSummary.maximumVisibleOwnedWindows,
        maximumOwnedModalCandidates: resourceSummary.maximumOwnedModalCandidates,
        finalQuiescence,
      })}`);
    }
    const minimumCanonicalSamples = Math.floor(settings.soakDurationMs / settings.observerIntervalMs) + 2;
    if (canonical && resourceSummary.sampleCount < minimumCanonicalSamples) {
      throw new Error(`Canonical observer produced only ${resourceSummary.sampleCount} samples.`);
    }
    const eventLoopSummary = summarizeEventLoop(eventLoop);
    const stabilityGate = evaluateApiLoadStability({
      soakSummary,
      resourceSummary,
      eventLoopSummary,
      observerIntervalMs: settings.observerIntervalMs,
    });
    if (canonical && !stabilityGate.passed) throw new Error("Canonical stability falsifier was reached.");
    const executorSnapshot = executor.snapshot();
    if (executorSnapshot.active !== 0 || executorSnapshot.armedGate || executorSnapshot.maximumActive !== 1) {
      throw new Error("Synthetic executor cleanup or single-flight invariant failed.");
    }
    const cancelledCalls = executorSnapshot.journal.filter((entry) => entry.outcome === "aborted").length;
    const failedCalls = executorSnapshot.journal.filter((entry) => entry.outcome === "failed").length;
    if (cancelledCalls !== 2 || failedCalls !== 1) throw new Error("Lifecycle injection accounting failed.");
    const lifecycleCounts = Object.fromEntries([
      "cancellation", "timeout", "synthetic-recovery", "api-restart", "mcp-restart", "clean-shutdown",
    ].map((phase) => [phase, lifecycleRecords.filter((record) => record.phase === phase).length]));
    if (lifecycleCounts.cancellation !== 1 || lifecycleCounts.timeout !== 1 ||
        lifecycleCounts["synthetic-recovery"] !== 1 || lifecycleCounts["api-restart"] !== 1 ||
        lifecycleCounts["mcp-restart"] !== 1 || lifecycleCounts["clean-shutdown"] !== 1) {
      throw new Error("Lifecycle evidence records do not match the injected controls.");
    }
    summary = {
      schemaVersion: API_LOAD_SCHEMA_VERSION,
      type: "summary",
      benchmark: API_LOAD_BENCHMARK_ID,
      command: "npm run perf:api-load-soak",
      generatedAt,
      canonical,
      settings,
      source,
      runtime,
      productFree: true,
      installedProductMutationClaim: false,
      installedProductPerformanceClaim: false,
      concurrencyClaim: "real-loopback-http-fail-fast-plus-client-owned-fair-queue",
      serverQueueWaitMetric: null,
      rawArrivals: rawSummaries,
      fairArrivals: fairSummaries,
      lifecycle: {
        cancellationCount: lifecycleCounts.cancellation,
        timeoutCount: lifecycleCounts.timeout,
        injectedExecutorFailureCount: failedCalls,
        syntheticGeneration: executorSnapshot.generation,
        apiRestartCount: lifecycleCounts["api-restart"],
        mcpRestartCount: lifecycleCounts["mcp-restart"],
        cleanShutdownCount: lifecycleCounts["clean-shutdown"],
        records: lifecycleRecords.length,
        placement: "controls-complete-before-scheduled-soak",
      },
      soak: {
        ...soakSummary,
        operationMix: { find: soakSummary.count },
        scope: "single-operation-real-http-mcp-transport-soak",
      },
      allOperations: summarizeLoadRecords(operationRecords),
      executor: {
        calls: executorSnapshot.journal.length,
        maximumActive: executorSnapshot.maximumActive,
        activeAtEnd: executorSnapshot.active,
        aborted: cancelledCalls,
        failed: failedCalls,
      },
      resources: resourceSummary,
      eventLoopDelay: eventLoopSummary,
      stabilityGate,
      cleanup: finalQuiescence,
      artifacts: {
        run: "run.json",
        operations: "operations.jsonl",
        lifecycle: "lifecycle.jsonl",
        executorCalls: "executor-calls.jsonl",
        windowsResources: "windows-resources.jsonl",
        summary: "summary.json",
        cleanup: "cleanup.json",
        hashes: "artifacts.json",
        hashCoverage: "run/operations/lifecycle/executor-calls/windows-resources/summary; cleanup is finalized afterward",
      },
    };
    failureStage = "result-artifacts";
    assertDirectoryIdentity(outputRoot, outputIdentity);
    writeJsonLines(join(outputRoot, "operations.jsonl"), operationRecords);
    writeJsonLines(join(outputRoot, "lifecycle.jsonl"), lifecycleRecords);
    writeJsonLines(join(outputRoot, "executor-calls.jsonl"), compactExecutorJournal(executorSnapshot.journal));
    writeJsonLines(join(outputRoot, "windows-resources.jsonl"), observer.samples);
    writeJson(join(outputRoot, "summary.json"), summary);
  } catch (error) {
    primaryError = error;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    eventLoop.disable();
    try { await stopMcp(); } catch (error) {
      primaryError = primaryError ? new AggregateError([primaryError, error], "Load workload and MCP cleanup failed.") : error;
      failureStage = "mcp-cleanup";
    }
    try { await stopApi(); } catch (error) {
      primaryError = primaryError ? new AggregateError([primaryError, error], "Load workload and API cleanup failed.") : error;
      failureStage = "api-cleanup";
    }
    if (observer && !observer.stopped) {
      try { await observer.stop(); } catch (error) {
        primaryError = primaryError ? new AggregateError([primaryError, error], "Load workload and observer cleanup failed.") : error;
        failureStage = "observer-cleanup";
      }
    }
    lastObserverState = compactQuiescenceSample(observer?.samples.at(-1));
    try {
      assertDirectoryIdentity(outputRoot, outputIdentity);
      if (!existsSync(join(outputRoot, "operations.jsonl"))) {
        writeJsonLines(join(outputRoot, "operations.jsonl"), operationRecords);
      }
      if (!existsSync(join(outputRoot, "lifecycle.jsonl"))) {
        writeJsonLines(join(outputRoot, "lifecycle.jsonl"), lifecycleRecords);
      }
      if (!existsSync(join(outputRoot, "executor-calls.jsonl"))) {
        writeJsonLines(join(outputRoot, "executor-calls.jsonl"), compactExecutorJournal(executor.snapshot().journal));
      }
      if (observer && !existsSync(join(outputRoot, "windows-resources.jsonl"))) {
        writeJsonLines(join(outputRoot, "windows-resources.jsonl"), observer.samples);
      }
    } catch (error) {
      primaryError = primaryError ? new AggregateError([primaryError, error], "Load workload and partial evidence persistence failed.") : error;
      failureStage = "partial-evidence";
    }
    try {
      removeOwnedScratch(outputRoot, outputIdentity, scratchRoot);
    } catch (error) {
      primaryError = primaryError ? new AggregateError([primaryError, error], "Load workload and scratch cleanup failed.") : error;
      failureStage = "scratch-cleanup";
    }
  }

  const cleanupRecord = (status, stage) => ({
    schemaVersion: API_LOAD_SCHEMA_VERSION,
    completionStatus: status,
    ...(stage ? { failureStage: stage } : {}),
    scratchRemoved: !existsSync(scratchRoot),
    apiOwnershipRetained: api !== null,
    apiListening: api?.server?.listening === true,
    mcpOwnershipRetained: mcp !== null,
    mcpClientActive: mcp !== null,
    executorActive: executor.snapshot().active,
    observerStopped: observer?.stopped === true,
    ownedMcpPids,
    ownedMcpProcessStates: ownedMcpBindings.map((binding) => ({
      pid: binding.pid,
      identityBound: true,
      identityMatchedAlive: binding.identityMatchedAlive,
    })),
    unboundMcpPidOccupancies: ownedMcpPids
      .filter((pid) => !ownedMcpBindings.some((binding) => binding.pid === pid))
      .map((pid) => ({ pid, pidOccupied: pidExists(pid) })),
    identityBoundMcpAliveCount: ownedMcpBindings.filter((binding) => binding.identityMatchedAlive).length,
    ownedDescendantAliveCount: lastObserverState?.liveOwnedChildren ?? null,
    finalQuiescence,
    lastObserverState,
    sseStarted: false,
    installedProductMutationAttempted: false,
    interruptedSignal,
  });
  const cleanupPath = join(outputRoot, "cleanup.json");
  if (primaryError) {
    try {
      assertDirectoryIdentity(outputRoot, outputIdentity);
    } catch (identityError) {
      throw new AggregateError([primaryError, identityError], "Load failed and external output ownership was lost.");
    }
    try {
      writeJson(join(outputRoot, "failure-artifacts.json"), topLevelArtifactIndex(
        outputRoot,
        new Set(["cleanup.json", "failure-artifacts.json", "artifacts.json"]),
      ));
    } catch (error) {
      primaryError = new AggregateError([primaryError, error], "Load failure and failure-artifact indexing failed.");
      failureStage = "failure-artifact-index";
    }
    writeJson(cleanupPath, cleanupRecord("failed", failureStage));
    throw primaryError;
  }
  assertDirectoryIdentity(outputRoot, outputIdentity);
  writeJson(cleanupPath, cleanupRecord("pending-artifact-index"));
  try {
    testOnly.beforeArtifactIndex?.();
    assertDirectoryIdentity(outputRoot, outputIdentity);
    writeJson(join(outputRoot, "artifacts.json"), filesBelow(outputRoot)
      .filter((entry) => !["artifacts.json", "cleanup.json"].includes(entry.relativePath))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)));
    assertDirectoryIdentity(outputRoot, outputIdentity);
    replaceJson(cleanupPath, cleanupRecord("passed"));
  } catch (error) {
    try {
      assertDirectoryIdentity(outputRoot, outputIdentity);
      rmSync(join(outputRoot, "artifacts.json"), { force: true });
      replaceJson(cleanupPath, cleanupRecord("failed", "artifact-index"));
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Artifact indexing failed after output ownership changed.");
    }
    throw error;
  }
  return summary;
}

async function main() {
  const options = parseApiLoadOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const summary = await runApiLoadWorkload(options);
  process.stdout.write(`${JSON.stringify({
    benchmark: summary.benchmark,
    operations: summary.soak.count,
    elapsedMs: summary.soak.elapsedMs,
    p50Ms: summary.soak.endToEndMs.p50,
    p95Ms: summary.soak.endToEndMs.p95,
    p99Ms: summary.soak.endToEndMs.p99,
    cleanup: summary.cleanup,
  })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
