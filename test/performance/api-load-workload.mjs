import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { summarizeDurations } from "./performance-statistics.mjs";

export const API_LOAD_SCHEMA_VERSION = 1;
export const API_LOAD_BENCHMARK_ID = "synthetic-api-mcp-arrival-soak";
export const API_LOAD_CALLER_SHAPES = Object.freeze([1, 4, 8]);
export const API_LOAD_CANONICAL_OPERATIONS = 1_008;
export const API_LOAD_CANONICAL_DURATION_MS = 900_000;
export const API_LOAD_CANONICAL_SAMPLE_MS = 5_000;

const TOKEN_PATTERN = /^load-[a-z0-9-]{1,96}$/u;
const RECORD_PHASE_PATTERN = /^[a-z][a-z0-9-]{0,47}$/u;
const RECORD_OUTCOME_PATTERN = /^[a-z][a-z0-9-]{0,47}$/u;
const ALLOWED_TRANSPORTS = new Set(["http", "mcp"]);

function rounded(value) {
  return Number.isFinite(value) ? Math.round(value * 1_000) / 1_000 : value;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

export function syntheticTokenDigest(token) {
  assertSyntheticToken(token);
  return sha256(token);
}

export function assertSyntheticToken(token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new Error("Synthetic load token must be a bounded path-free token.");
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortError() {
  return new DOMException("Synthetic operation aborted.", "AbortError");
}

async function waitForGate(released, signal) {
  if (signal?.aborted) throw abortError();
  let onAbort;
  try {
    await Promise.race([
      released,
      signal ? new Promise((_, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
      }) : new Promise(() => undefined),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function waitDelay(delayMs, signal) {
  if (delayMs <= 0) return;
  if (signal?.aborted) throw abortError();
  let timer;
  let onAbort;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(resolve, delayMs);
      if (signal) {
        onAbort = () => {
          clearTimeout(timer);
          reject(abortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function createSyntheticFindExecutor({ normalDelayMs = 0 } = {}) {
  if (!Number.isFinite(normalDelayMs) || normalDelayMs < 0 || normalDelayMs > 5_000) {
    throw new Error("normalDelayMs must be between 0 and 5000.");
  }
  let active = 0;
  let maximumActive = 0;
  let sequence = 0;
  let generation = 1;
  let nextGate = null;
  let failNext = false;
  const journal = [];
  const idleWaiters = new Set();

  const notifyIdle = () => {
    if (active !== 0) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const execute = async (operation, args, _timeoutMs, signal) => {
    if (operation !== "find") throw new Error("Synthetic load executor accepts only find.");
    const token = args?.name;
    assertSyntheticToken(token);
    const tokenDigest = syntheticTokenDigest(token);
    const entry = {
      sequence: ++sequence,
      operation: "find",
      tokenDigest,
      generation,
      outcome: "running",
      elapsedMs: null,
    };
    journal.push(entry);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const startedAt = performance.now();
    const gate = nextGate;
    if (gate) {
      nextGate = null;
      gate.started.resolve({ tokenDigest, generation });
    }
    try {
      if (gate) await waitForGate(gate.released.promise, signal);
      if (failNext) {
        failNext = false;
        throw new Error("Injected synthetic executor failure.");
      }
      await waitDelay(normalDelayMs, signal);
      entry.outcome = "ok";
      return { ok: true, count: 1, hits: [{ name: token }], incomplete: false };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        entry.outcome = "aborted";
        return { ok: false, kind: "aborted", error: "Synthetic operation aborted." };
      }
      entry.outcome = "failed";
      throw error;
    } finally {
      entry.elapsedMs = rounded(performance.now() - startedAt);
      active -= 1;
      notifyIdle();
    }
  };

  return {
    execute,
    holdNext() {
      if (nextGate) throw new Error("A synthetic hold is already armed.");
      const started = deferred();
      const released = deferred();
      nextGate = { started, released };
      let releasedOnce = false;
      return {
        started: started.promise,
        release() {
          if (releasedOnce) return;
          releasedOnce = true;
          released.resolve();
        },
      };
    },
    failFollowingCall() {
      if (failNext) throw new Error("A synthetic failure is already armed.");
      failNext = true;
    },
    recover() {
      if (active !== 0 || nextGate) throw new Error("Synthetic recovery requires an idle executor.");
      generation += 1;
      return generation;
    },
    async waitForIdle(timeoutMs = 5_000) {
      if (active === 0) return;
      const waiter = deferred();
      idleWaiters.add(waiter.resolve);
      let timer;
      try {
        await Promise.race([
          waiter.promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Synthetic executor did not become idle.")), timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        idleWaiters.delete(waiter.resolve);
      }
    },
    snapshot() {
      return {
        active,
        maximumActive,
        generation,
        armedGate: nextGate !== null,
        journal: journal.map((entry) => ({ ...entry })),
      };
    },
  };
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function createFairPlan({ callers, jobsPerCaller, phase = "fair-arrivals", sequenceStart = 1 }) {
  boundedInteger(callers, "callers", 1, 64);
  boundedInteger(jobsPerCaller, "jobsPerCaller", 1, 100_000);
  boundedInteger(sequenceStart, "sequenceStart", 1, 10_000_000);
  if (!RECORD_PHASE_PATTERN.test(phase)) throw new Error("Unsafe fair-plan phase.");
  const jobs = [];
  for (let round = 1; round <= jobsPerCaller; round += 1) {
    for (let caller = 1; caller <= callers; caller += 1) {
      const sequence = sequenceStart + jobs.length;
      jobs.push({
        sequence,
        caller,
        phase,
        transport: sequence % 2 === 0 ? "mcp" : "http",
        token: `load-${phase}-c${String(caller).padStart(2, "0")}-s${String(sequence).padStart(6, "0")}`,
      });
    }
  }
  return jobs;
}

export function createSoakPlan({ operationCount, durationMs, callers = 8 }) {
  boundedInteger(operationCount, "operationCount", 2, 100_000);
  boundedInteger(durationMs, "durationMs", 1, 86_400_000);
  boundedInteger(callers, "callers", 1, 64);
  return Array.from({ length: operationCount }, (_, index) => {
    const sequence = index + 1;
    return {
      sequence,
      caller: (index % callers) + 1,
      phase: index === 0 ? "synthetic-warming" : "steady-warm",
      transport: sequence % 2 === 0 ? "mcp" : "http",
      scheduledOffsetMs: durationMs * index / (operationCount - 1),
      token: `load-soak-c${String((index % callers) + 1).padStart(2, "0")}-s${String(sequence).padStart(6, "0")}`,
    };
  });
}

export function jainFairness(counts) {
  if (!Array.isArray(counts) || counts.length === 0 || counts.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Fairness counts must be a non-empty array of finite nonnegative numbers.");
  }
  const sum = counts.reduce((total, value) => total + value, 0);
  const squareSum = counts.reduce((total, value) => total + value * value, 0);
  return squareSum === 0 ? 1 : rounded((sum * sum) / (counts.length * squareSum));
}

export function sanitizeLoadRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Load record must be an object.");
  if (!RECORD_PHASE_PATTERN.test(record.phase)) throw new Error("Unsafe load-record phase.");
  if (!RECORD_PHASE_PATTERN.test(record.mode)) throw new Error("Unsafe load-record mode.");
  if (!RECORD_OUTCOME_PATTERN.test(record.outcome)) throw new Error("Unsafe load-record outcome.");
  if (!ALLOWED_TRANSPORTS.has(record.transport)) throw new Error("Unsafe load-record transport.");
  boundedInteger(record.sequence, "record sequence", 1, 10_000_000);
  boundedInteger(record.caller, "record caller", 1, 64);
  if (!API_LOAD_CALLER_SHAPES.includes(record.arrivalShape)) throw new Error("Unsafe load-record arrival shape.");
  for (const name of ["admitted", "executorReached", "successful", "busy", "identityMatched"]) {
    if (typeof record[name] !== "boolean") throw new Error(`${name} must be a boolean.`);
  }
  if (record.admitted !== record.executorReached) {
    throw new Error("Admission and executor reach must describe the same fail-fast boundary.");
  }
  if (record.terminalKind !== null &&
      (typeof record.terminalKind !== "string" || !RECORD_OUTCOME_PATTERN.test(record.terminalKind))) {
    throw new Error("Unsafe load-record terminal kind.");
  }
  for (const [name, value] of [
    ["clientQueueWaitMs", record.clientQueueWaitMs],
    ["transportTimeMs", record.transportTimeMs],
    ["endToEndMs", record.endToEndMs],
  ]) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative.`);
  }
  if (Math.abs(record.endToEndMs - (record.clientQueueWaitMs + record.transportTimeMs)) > 0.01) {
    throw new Error("endToEndMs must include client queue wait plus transport time.");
  }
  if (record.serviceTimeMs !== null && (!Number.isFinite(record.serviceTimeMs) || record.serviceTimeMs < 0)) {
    throw new Error("serviceTimeMs must be null or finite and nonnegative.");
  }
  if (record.apiDurationMs !== null && (!Number.isFinite(record.apiDurationMs) || record.apiDurationMs < 0)) {
    throw new Error("apiDurationMs must be null or finite and nonnegative.");
  }
  if (record.serverQueueWaitMs !== null) throw new Error("The fail-fast API has no server queue.");
  if (record.httpStatus !== null && record.httpStatus !== undefined &&
      (!Number.isSafeInteger(record.httpStatus) || record.httpStatus < 100 || record.httpStatus > 599)) {
    throw new Error("httpStatus must be null or a valid status code.");
  }
  const sanitized = {
    schemaVersion: API_LOAD_SCHEMA_VERSION,
    type: "operation",
    phase: record.phase,
    mode: record.mode,
    sequence: record.sequence,
    caller: record.caller,
    arrivalShape: record.arrivalShape,
    transport: record.transport,
    outcome: record.outcome,
    terminalKind: record.terminalKind,
    httpStatus: record.httpStatus ?? null,
    admitted: record.admitted,
    executorReached: record.executorReached,
    successful: record.successful,
    busy: record.busy,
    identityMatched: record.identityMatched,
    clientQueueWaitMs: rounded(record.clientQueueWaitMs),
    serverQueueWaitMs: null,
    serviceTimeMs: record.serviceTimeMs === null ? null : rounded(record.serviceTimeMs),
    apiDurationMs: record.apiDurationMs === null ? null : rounded(record.apiDurationMs),
    transportTimeMs: rounded(record.transportTimeMs),
    endToEndMs: rounded(record.endToEndMs),
  };
  const serialized = JSON.stringify(sanitized);
  if (/[A-Z]:\\|file:\/\/|\\\\|sse-lab|Users\\|https?:\/\//iu.test(serialized)) {
    throw new Error("Load record contains a local path or URL.");
  }
  return sanitized;
}

function groupCounts(records, key) {
  const result = new Map();
  for (const record of records) result.set(record[key], (result.get(record[key]) ?? 0) + 1);
  return Object.fromEntries([...result].sort(([left], [right]) => String(left).localeCompare(String(right))));
}

export function summarizeLoadRecords(records) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("Load summary requires operation records.");
  const safe = records.map(sanitizeLoadRecord);
  const callers = groupCounts(safe, "caller");
  const callerCounts = Object.values(callers);
  const admittedRecords = safe.filter((record) => record.admitted);
  const admittedByCaller = groupCounts(admittedRecords, "caller");
  const admittedCallerCounts = Object.keys(callers).map((caller) => admittedByCaller[caller] ?? 0);
  const firstQuartileLength = Math.max(1, Math.floor(safe.length / 4));
  const lastQuartileStart = Math.max(0, safe.length - firstQuartileLength);
  const durations = safe.map((record) => record.endToEndMs);
  const firstDurations = safe.slice(0, firstQuartileLength).map((record) => record.endToEndMs);
  const lastDurations = safe.slice(lastQuartileStart).map((record) => record.endToEndMs);
  const firstQueueWaits = safe.slice(0, firstQuartileLength).map((record) => record.clientQueueWaitMs);
  const lastQueueWaits = safe.slice(lastQuartileStart).map((record) => record.clientQueueWaitMs);
  const first = summarizeDurations(firstDurations);
  const last = summarizeDurations(lastDurations);
  return {
    count: safe.length,
    admitted: safe.filter((record) => record.admitted).length,
    executorReached: safe.filter((record) => record.executorReached).length,
    successful: safe.filter((record) => record.successful).length,
    busy: safe.filter((record) => record.busy).length,
    identityMatched: safe.filter((record) => record.identityMatched).length,
    outcomes: groupCounts(safe, "outcome"),
    transports: groupCounts(safe, "transport"),
    callers,
    completionFairness: {
      scope: "completed-record-counts-from-client-plan",
      jain: jainFairness(callerCounts),
      minimum: Math.min(...callerCounts),
      maximum: Math.max(...callerCounts),
    },
    admissionFairness: {
      scope: "executor-reached-counts",
      callers: admittedByCaller,
      jain: jainFairness(admittedCallerCounts),
      minimum: Math.min(...admittedCallerCounts),
      maximum: Math.max(...admittedCallerCounts),
    },
    endToEndMs: summarizeDurations(durations),
    clientQueueWaitMs: summarizeDurations(safe.map((record) => record.clientQueueWaitMs)),
    serviceTimeMs: summarizeDurations(safe.flatMap((record) => record.serviceTimeMs === null ? [] : [record.serviceTimeMs])),
    apiDurationMs: summarizeDurations(safe.flatMap((record) => record.apiDurationMs === null ? [] : [record.apiDurationMs])),
    transportTimeMs: summarizeDurations(safe.map((record) => record.transportTimeMs)),
    latencyDrift: {
      firstQuartileEndToEndMs: first,
      lastQuartileEndToEndMs: last,
      firstQuartileClientQueueWaitMs: summarizeDurations(firstQueueWaits),
      lastQuartileClientQueueWaitMs: summarizeDurations(lastQueueWaits),
      p95Ratio: first.p95 === 0 ? null : rounded(last.p95 / first.p95),
    },
  };
}

function requiredFinite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}

export function evaluateApiLoadStability({ soakSummary, resourceSummary, eventLoopSummary, observerIntervalMs }) {
  const firstLatency = soakSummary?.latencyDrift?.firstQuartileEndToEndMs;
  const lastLatency = soakSummary?.latencyDrift?.lastQuartileEndToEndMs;
  const firstQueue = soakSummary?.latencyDrift?.firstQuartileClientQueueWaitMs;
  const lastQueue = soakSummary?.latencyDrift?.lastQuartileClientQueueWaitMs;
  const overallQueue = soakSummary?.clientQueueWaitMs;
  const thresholds = {
    maximumObserverGapMs: requiredFinite(observerIntervalMs, "observerIntervalMs") * 1.5,
    maximumLatencyP95Ms: Math.max(
      requiredFinite(firstLatency?.p95, "first-quartile latency p95") * 4,
      firstLatency.p95 + 100,
    ),
    maximumLatencyP99Ms: Math.max(
      requiredFinite(firstLatency?.p99, "first-quartile latency p99") * 5,
      firstLatency.p99 + 250,
    ),
    maximumLastQuartileClientQueueP95Ms: Math.max(
      requiredFinite(firstQueue?.p95, "first-quartile client queue p95") * 4,
      firstQueue.p95 + 100,
    ),
    maximumClientQueueWaitMs: 1_000,
    maximumFinalWorkingSetGrowthBytes: 128 * 1024 * 1024,
    maximumFinalPrivateGrowthBytes: 128 * 1024 * 1024,
    maximumFinalHandleGrowth: 64,
    maximumEventLoopP99Ms: 250,
  };
  const observed = {
    observerGapMs: requiredFinite(resourceSummary?.observedGapMs?.maximum, "observer gap"),
    missedIntervals: requiredFinite(resourceSummary?.missedIntervalCount, "missed intervals"),
    lastQuartileLatencyP95Ms: requiredFinite(lastLatency?.p95, "last-quartile latency p95"),
    lastQuartileLatencyP99Ms: requiredFinite(lastLatency?.p99, "last-quartile latency p99"),
    lastQuartileClientQueueP95Ms: requiredFinite(lastQueue?.p95, "last-quartile client queue p95"),
    maximumClientQueueWaitMs: requiredFinite(overallQueue?.max, "maximum client queue wait"),
    finalWorkingSetGrowthBytes: requiredFinite(resourceSummary?.ownedTreeFinalDrift?.workingSetBytes, "working-set drift"),
    finalPrivateGrowthBytes: requiredFinite(resourceSummary?.ownedTreeFinalDrift?.privateBytes, "private-byte drift"),
    finalHandleGrowth: requiredFinite(resourceSummary?.ownedTreeFinalDrift?.handleCount, "handle drift"),
    eventLoopP99Ms: requiredFinite(eventLoopSummary?.p99Ms, "event-loop p99"),
  };
  const falsifiers = {
    observerGap: observed.observerGapMs > thresholds.maximumObserverGapMs,
    missedIntervals: observed.missedIntervals !== 0,
    latencyP95Drift: observed.lastQuartileLatencyP95Ms > thresholds.maximumLatencyP95Ms,
    latencyP99Drift: observed.lastQuartileLatencyP99Ms > thresholds.maximumLatencyP99Ms,
    clientQueueP95Drift: observed.lastQuartileClientQueueP95Ms > thresholds.maximumLastQuartileClientQueueP95Ms,
    clientQueueMaximum: observed.maximumClientQueueWaitMs > thresholds.maximumClientQueueWaitMs,
    workingSetGrowth: observed.finalWorkingSetGrowthBytes > thresholds.maximumFinalWorkingSetGrowthBytes,
    privateByteGrowth: observed.finalPrivateGrowthBytes > thresholds.maximumFinalPrivateGrowthBytes,
    handleGrowth: observed.finalHandleGrowth > thresholds.maximumFinalHandleGrowth,
    eventLoopP99: observed.eventLoopP99Ms > thresholds.maximumEventLoopP99Ms,
  };
  return { thresholds, observed, falsifiers, passed: !Object.values(falsifiers).some(Boolean) };
}

export function summarizeCompletionOrder(records, callerShape) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("Completion order requires records.");
  boundedInteger(callerShape, "callerShape", 1, 64);
  const actual = records.map((record) => record.caller);
  const expected = actual.map((_, index) => (index % callerShape) + 1);
  const positions = new Map();
  for (let index = 0; index < actual.length; index += 1) {
    const current = positions.get(actual[index]) ?? [];
    current.push(index);
    positions.set(actual[index], current);
  }
  let longestGap = 0;
  for (const callerPositions of positions.values()) {
    for (let index = 1; index < callerPositions.length; index += 1) {
      longestGap = Math.max(longestGap, callerPositions[index] - callerPositions[index - 1] - 1);
    }
  }
  return {
    exactRoundRobin: actual.every((caller, index) => caller === expected[index]),
    actualDigest: sha256(stableJson(actual)),
    expectedDigest: sha256(stableJson(expected)),
    longestCompletionGap: longestGap,
    starvationCount: Array.from({ length: callerShape }, (_, index) => index + 1)
      .filter((caller) => !positions.has(caller)).length,
  };
}

export async function sleepUntil(targetMs, signal) {
  while (true) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
    const remaining = targetMs - performance.now();
    if (remaining <= 0) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = () => finish(() => reject(signal.reason instanceof Error ? signal.reason : abortError()));
      const timer = setTimeout(() => finish(resolve), Math.min(remaining, 1_000));
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
    });
  }
}
