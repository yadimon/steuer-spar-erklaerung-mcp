import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateOperationTraces,
  parseOptions,
  percentile,
  runtimeFingerprint,
  summarizeDurations,
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
  assert.equal(percentile([4, 1, 3, 2], 0.50), 2);
  assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.deepEqual(summarizeDurations([1, 2, 3, 4]), {
    count: 4, min: 1, max: 4, mean: 2.5, p50: 2, p95: 4, p99: 4,
  });
  assert.deepEqual(summarizeDurations([]), {
    count: 0, min: null, max: null, mean: null, p50: null, p95: null, p99: null,
  });
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
  assert.deepEqual(aggregate.operations.find((operation) => operation.operation === "launch")?.durationMs, {
    count: 2, min: 10, max: 20, mean: 15, p50: 10, p95: 20, p99: 20,
  });
  assert(!JSON.stringify(aggregate).includes("path"));
});

test("runtime fingerprint is path-free and internally consistent", () => {
  const runtime = runtimeFingerprint();
  assert.match(runtime.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(runtime.executable.includes("\\"), false);
  assert.equal(runtime.executable.includes("/"), false);
  assert.equal(Object.hasOwn(runtime, "hostname"), false);
});
