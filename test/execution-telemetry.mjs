import assert from "node:assert/strict";
import { createExecutionTelemetry, sanitizeWorkerPerformance } from "../dist/execution-telemetry.js";

assert.deepEqual(sanitizeWorkerPerformance({
  workerProcessCount: 1, treeWalks: 4, treeWalkMs: 12.5, nativeMs: 3, error: "private", path: "C:\\private", arbitrary: 9,
}), { workerProcessCount: 1, treeWalks: 4, treeWalkMs: 12.5, nativeMs: 3 });
assert.deepEqual(sanitizeWorkerPerformance({ workerProcessCount: 1.2, treeWalks: -1, treeWalkMs: Infinity }), {});

const telemetry = createExecutionTelemetry({ enabled: true, maxCompletedTraces: 2, maxSpansPerTrace: 3 });
await telemetry.runApi("get_value", async () => {
  await telemetry.runCompositeChild("fill_fields", async () => {
    await Promise.resolve();
    await telemetry.runWorker("tracked_set_value", async () => {
      telemetry.recordWorkerPerformance({ workerProcessCount: 1, treeWalks: 2, treeWalkMs: 4, title: "do not retain" });
    });
  });
});
const [trace] = telemetry.consumeCompleted();
assert.equal(trace.operation, "get_value");
assert.equal(trace.durationSemantics, "inclusive");
assert.equal(trace.spans.length, 3);
assert.deepEqual(trace.spans.map(span => [span.id, span.parentId, span.phase, span.backend, span.operation]), [
  [1, null, "api", "node", "get_value"], [2, 1, "composite", "composite", "fill_fields"], [3, 2, "worker", "powershell-worker", "tracked_set_value"],
]);
assert.deepEqual(trace.spans[2].counters, { workerProcessCount: 1, treeWalks: 2, treeWalkMs: 4 });
for (const span of trace.spans) {
  assert.equal(span.durationSemantics, "inclusive");
  assert.ok(Number.isFinite(span.startedAtMs) && span.startedAtMs >= trace.startedAtMs);
  assert.equal(span.completion, "completed");
  assert.ok(Number.isFinite(span.durationMs) && span.durationMs >= 0);
}
assert.ok(trace.spans[0].durationMs >= trace.spans[1].durationMs, "parent duration is inclusive, never an exclusive sum");

await telemetry.runApi("health", () => telemetry.runQtNative(() => undefined));
await telemetry.runApi("help", () => telemetry.runNodeLocal("workspace_status", () => undefined));
await telemetry.runApi("capabilities", () => telemetry.runWorker(undefined, () => undefined));
const bounded = telemetry.consumeCompleted();
assert.deepEqual(bounded.map(entry => entry.operation), ["help", "capabilities"], "completed traces are bounded FIFO after overflow");

const concurrent = createExecutionTelemetry({ enabled: true });
let releaseLeft, releaseRight;
const leftGate = new Promise(resolve => { releaseLeft = resolve; });
const rightGate = new Promise(resolve => { releaseRight = resolve; });
const left = concurrent.runApi("get_value", async () => { await concurrent.runWorker("get_value", () => leftGate); });
const right = concurrent.runApi("table_read", async () => { await concurrent.runWorker("table_read", () => rightGate); });
await Promise.resolve();
releaseRight(); await right;
releaseLeft(); await left;
const concurrentTraces = concurrent.consumeCompleted();
assert.deepEqual(concurrentTraces.map(entry => entry.operation).sort(), ["get_value", "table_read"]);
for (const entry of concurrentTraces) assert.deepEqual(entry.spans.map(span => span.operation).filter(Boolean), [entry.operation, entry.operation]);

const expected = new Error("same object");
const failures = createExecutionTelemetry({ enabled: true });
await assert.rejects(failures.runApi("health", async () => { throw expected; }), error => error === expected);
assert.equal(failures.consumeCompleted()[0].operation, "health", "throwing task still emits a trace without storing its error");

const capped = createExecutionTelemetry({ enabled: true, maxSpansPerTrace: 2 });
await capped.runApi("health", () => capped.runCompositeChild("help", () => capped.runWorker("health", () => undefined)));
const cappedTrace = capped.consumeCompleted()[0];
assert.equal(cappedTrace.spans.length, 2);
assert.equal(cappedTrace.droppedSpanCount, 1);

const floating = createExecutionTelemetry({ enabled: true });
let releaseFloating;
const floatingGate = new Promise(resolve => { releaseFloating = resolve; });
let floatingTask;
await floating.runApi("health", async () => {
  floatingTask = floating.runWorker("health", () => floatingGate);
  await Promise.resolve();
});
const floatingTrace = floating.consumeCompleted()[0];
const unfinished = floatingTrace.spans.find(span => span.phase === "worker");
assert.equal(unfinished.completion, "unfinished");
assert.equal(unfinished.durationMs, null, "unfinished background work is not recorded as a completed zero-duration span");
releaseFloating(); await floatingTask;
assert.equal(unfinished.completion, "unfinished", "exported snapshot remains detached after late completion");

const disabled = createExecutionTelemetry();
let ran = false;
const sentinel = { unchanged: true };
const returned = await disabled.runApi("health", async () => { ran = true; await disabled.runWorker("health", () => undefined); return sentinel; });
assert.equal(ran, true);
assert.equal(returned, sentinel, "disabled telemetry preserves task result identity");
assert.deepEqual(disabled.consumeCompleted(), []);

const synchronous = createExecutionTelemetry({ enabled: true });
await synchronous.runApi("health", () => {
  const finish = synchronous.beginWorkerQueue();
  finish(); finish();
  assert.equal(synchronous.measureWorkerPreparation(() => sentinel), sentinel);
  assert.throws(() => synchronous.measureWorkerPreparation(() => { throw expected; }), error => error === expected);
});
const synchronousTrace = synchronous.consumeCompleted()[0];
assert.deepEqual(synchronousTrace.spans.map(span => span.phase),
  ["api", "worker-queue", "worker-prepare", "worker-prepare"]);
assert(synchronousTrace.spans.every(span => span.completion === "completed"));
const direct = () => sentinel;
assert.equal(disabled.bindContext(direct), direct);
assert.equal(disabled.measureWorkerPreparation(direct), sentinel);
disabled.beginWorkerQueue()();
assert.deepEqual(disabled.consumeCompleted(), []);

console.log("execution telemetry contract: passed");
