import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  aggregateOperationTraces,
  parseOptions,
  percentile,
  runBenchmark,
  runtimeFingerprint,
  sanitizeOperationTraceRecord,
  summarizeDurations,
  summarizeOutcomes,
} from "./performance-harness.mjs";

test("CLI defaults and explicit CLI values are deterministic", () => {
  assert.deepEqual(parseOptions([], {}), { warmup: 1, iterations: 5, output: "", help: false });
  const parsed = parseOptions(["--warmup", "2", "--iterations=7", "--output", ".tmp/perf-test"], {});
  assert.equal(parsed.warmup, 2);
  assert.equal(parsed.iterations, 7);
  assert(parsed.output.endsWith(".tmp\\perf-test") || parsed.output.endsWith(".tmp/perf-test"));
  assert.equal(parsed.help, false);
});

test("environment values are overridden by CLI and invalid bounds fail", () => {
  assert.deepEqual(
    parseOptions(["--warmup=0", "--iterations", "3"], { SSE_PERF_WARMUP: "4", SSE_PERF_ITERATIONS: "9" }),
    { warmup: 0, iterations: 3, output: "", help: false },
  );
  assert.throws(() => parseOptions(["--iterations", "0"], {}), /zwischen 1 und 1000/u);
  assert.throws(() => parseOptions(["--warmup", "1.5"], {}), /ganze Zahl/u);
  assert.throws(() => parseOptions(["--unknown"], {}), /Unbekannte Option/u);
});

test("nearest-rank percentiles and summary are stable", () => {
  const input = [4, 1, 3, 2];
  const before = [...input];
  assert.equal(percentile(input, 0.50), 2);
  assert.deepEqual(input, before);
  assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.90), 9);
  assert.deepEqual(summarizeDurations([1, 2, 3, 4]), {
    count: 4, min: 1, max: 4, mean: 2.5, p50: 2, p90: 4, p95: 4, p99: 4,
  });
  assert.deepEqual(summarizeDurations([]), {
    count: 0, min: null, max: null, mean: null, p50: null, p90: null, p95: null, p99: null,
  });
  assert.throws(() => summarizeDurations([1, Number.NaN]), /finite nonnegative/u);
  assert.throws(() => summarizeDurations([1, Number.POSITIVE_INFINITY]), /finite nonnegative/u);
  assert.throws(() => summarizeDurations([1, -1]), /finite nonnegative/u);
  assert.throws(() => summarizeDurations([1, undefined]), /finite nonnegative/u);
  assert.throws(() => summarizeDurations(new Array(1)), /finite nonnegative/u);
  assert.throws(() => summarizeDurations("1,2"), /must be an array/u);
  assert.throws(() => percentile([1, 2], 0), /must be in/u);
  assert.throws(() => percentile([1, 2], 1.01), /must be in/u);
  assert.throws(() => percentile([1, 2], Number.NaN), /must be in/u);
  assert.throws(() => percentile(new Array(1), 0.5), /finite numbers/u);
  const large = Number.MAX_VALUE / 2;
  assert.equal(summarizeDurations([large, large]).mean, large);
});

test("operation traces are aggregated without values or filesystem paths", () => {
  const aggregate = aggregateOperationTraces([
    { label: "stateful-mock", operation: "launch", ok: true, ms: 10, fields: { path: "string-other" } },
    { label: "stateful-mock", operation: "launch", ok: true, ms: 20, fields: { path: "string-other" } },
    { label: "stateful-mock", operation: "save", ok: false, threw: true, ms: 5 },
  ]);
  assert.deepEqual(aggregate.labels, { "stateful-mock": 3 });
  assert.equal(aggregate.recordCount, 3);
  assert.equal(aggregate.distinctOperationCount, 2);
  assert.equal(aggregate.okCount, 2);
  assert.equal(aggregate.threwCount, 1);
  assert.deepEqual(aggregate.outcomes, {
    ok: 2, nonOk: 1, threw: 1, kinds: {},
  });
  assert.deepEqual(aggregate.operations.find((operation) => operation.operation === "launch")?.durationMs, {
    count: 2, min: 10, max: 20, mean: 15, p50: 10, p90: 20, p95: 20, p99: 20,
  });
  assert(!JSON.stringify(aggregate).includes("path"));
});

test("outcomes retain explicit kinds without result values", () => {
  const records = [
    { label: "worker", operation: "save", ok: false, kind: "timeout", threw: true, ms: 8 },
    { label: "stateful-mock", operation: "launch", ok: true, ms: 2 },
    { label: "stateful-mock", operation: "save", ok: false, kind: "busy", ms: -1 },
    { label: "worker", operation: "save", ok: false, kind: "cancelled", ms: 4 },
  ];
  assert.deepEqual(summarizeOutcomes(records), {
    ok: 1, nonOk: 3, threw: 1, kinds: { busy: 1, cancelled: 1, timeout: 1 },
  });
  const aggregate = aggregateOperationTraces(records);
  assert.deepEqual(aggregate.labels, { "stateful-mock": 2, worker: 2 });
  assert.deepEqual(aggregate.outcomes, {
    ok: 1, nonOk: 3, threw: 1, kinds: { busy: 1, cancelled: 1, timeout: 1 },
  });
  assert.deepEqual(aggregate.operations.map(({ operation }) => operation), ["launch", "save"]);
  assert.equal(aggregate.operations.find(({ operation }) => operation === "save")?.durationMs.count, 2);
  assert.deepEqual(summarizeOutcomes([]), { ok: 0, nonOk: 0, threw: 0, kinds: {} });
});

test("raw operation records are exact, path-free and fail closed", () => {
  const raw = {
    label: "stateful-mock",
    operation: "receipt_manager_list",
    profileId: "2025",
    ok: false,
    kind: "stale-fingerprint",
    ms: 12.3456,
    fields: { path: "string-other", ok: "boolean" },
    privateValue: "C:\\portable-fixture\\receipt.pdf",
  };
  const safe = sanitizeOperationTraceRecord(raw, { phase: "measurement", index: 2, sequence: 7 });
  assert.deepEqual(safe, {
    schemaVersion: 1,
    type: "operation",
    benchmark: "synthetic-api-tax-journeys",
    phase: "measurement",
    runIndex: 2,
    sequence: 7,
    label: "stateful-mock",
    operation: "receipt_manager_list",
    ok: false,
    kind: "stale-fingerprint",
    ms: 12.346,
  });
  assert(!JSON.stringify(safe).includes("Private"));
  assert.equal(raw.privateValue, "C:\\portable-fixture\\receipt.pdf");
  assert.throws(
    () => sanitizeOperationTraceRecord({ ...raw, operation: "C:\\private" }, { phase: "measurement", index: 1, sequence: 1 }),
    /Unsafe operation/u,
  );
  assert.throws(
    () => sanitizeOperationTraceRecord({ ...raw, ms: Number.POSITIVE_INFINITY }, { phase: "measurement", index: 1, sequence: 1 }),
    /finite and nonnegative/u,
  );
  assert.throws(
    () => sanitizeOperationTraceRecord({ ...raw, kind: "unsafe_kind" }, { phase: "measurement", index: 1, sequence: 1 }),
    /Unsafe kind/u,
  );
  assert.throws(
    () => sanitizeOperationTraceRecord(raw, { phase: "profile", index: 1, sequence: 1 }),
    /Unsafe phase/u,
  );
  assert.throws(
    () => sanitizeOperationTraceRecord({ ...raw, label: "private" }, { phase: "measurement", index: 1, sequence: 1 }),
    /Unknown operation trace label/u,
  );
  assert.throws(
    () => sanitizeOperationTraceRecord(raw, { phase: "measurement", index: 0, sequence: 1 }),
    /positive integers/u,
  );
  const thrown = sanitizeOperationTraceRecord(
    { ...raw, threw: true },
    { phase: "warmup", index: 1, sequence: 1 },
  );
  assert.equal(thrown.threw, true);
  assert.equal(thrown.phase, "warmup");
  const largestFinite = sanitizeOperationTraceRecord(
    { ...raw, ms: Number.MAX_VALUE },
    { phase: "measurement", index: 1, sequence: 1 },
  );
  assert.equal(largestFinite.ms, Number.MAX_VALUE);
  assert(!JSON.stringify(largestFinite).includes("null"));
  assert.equal(Object.hasOwn(safe, "fields"), false);
  assert.equal(Object.hasOwn(safe, "profileId"), false);
});

test("pre-existing trace evidence is rejected and preserved", async (context) => {
  const root = join(tmpdir(), `sse-perf-collision-${process.pid}-${Date.now()}`);
  const output = join(root, "output");
  const traceRoot = join(output, ".trace");
  const sentinel = join(traceRoot, "foreign-sentinel.txt");
  mkdirSync(traceRoot, { recursive: true });
  writeFileSync(sentinel, "must remain byte-identical\n", "utf8");
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    runBenchmark({ output, warmup: 0, iterations: 1 }),
    /enthaelt bereits Performance-Ergebnisse/u,
  );
  assert.equal(readFileSync(sentinel, "utf8"), "must remain byte-identical\n");
  assert.equal(existsSync(join(output, "samples.jsonl")), false);
  assert.equal(existsSync(join(output, "operations.jsonl")), false);
  assert.equal(existsSync(join(output, "summary.json")), false);
});

test("runtime fingerprint is path-free and internally consistent", () => {
  const runtime = runtimeFingerprint();
  assert.match(runtime.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(runtime.executable.includes("\\"), false);
  assert.equal(runtime.executable.includes("/"), false);
  assert.equal(Object.hasOwn(runtime, "hostname"), false);
});
