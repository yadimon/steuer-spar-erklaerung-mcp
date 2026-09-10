import assert from "node:assert/strict";
import fs, { symlinkSync, unlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createSseApiServer } from "../dist/api-server.js";
import { createExecutionTelemetry } from "../dist/execution-telemetry.js";
import { createExecutionTraceLog } from "./execution-trace-log.mjs";
const temporary = mkdtempSync(join(tmpdir(), "sse-execution-trace-log-contract-"));
function cleanup() { assert.match(basename(temporary), /^sse-execution-trace-log-contract-[a-zA-Z0-9]{6}$/u); rmSync(temporary, { recursive: true, force: true }); }
process.once("exit", cleanup);
function fixture(name) {
  const repositoryRoot = join(temporary, name, "repository"), reports = join(temporary, name, "reports");
  mkdirSync(repositoryRoot, { recursive: true }); mkdirSync(reports, { recursive: true });
  return { repositoryRoot, reports, outputPath: join(reports, "trace.jsonl") };
}
function entries(path) { return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }
async function requestRejected(server) {
  const address = server.address();
  return await new Promise((resolve, reject) => {
    const client = request({ host: "127.0.0.1", port: address.port, method: "POST", path: "/v1/operations/health", headers: { "content-type": "application/json" } }, (response) => { response.resume(); response.once("end", () => resolve(response.statusCode)); });
    client.once("error", reject); client.end(JSON.stringify({ args: {} }));
  });
}
const graph = fixture("graph"), telemetry = createExecutionTelemetry({ enabled: true }), sidecar = createExecutionTraceLog({ telemetry, ...graph });
await telemetry.runApi("health", () => telemetry.runCompositeChild("help", () => telemetry.runWorker("health", () => telemetry.recordWorkerPerformance({ workerProcessCount: 1, treeWalks: 2, treeWalkMs: 3, secret: "synthetic-private" }))));
sidecar.record({ event: "operation", requestId: "11111111-1111-4111-8111-111111111111", operation: "health", durationMs: 7, result: { private: "ignore" } });
sidecar.close();
const [line] = entries(graph.outputPath);
assert.deepEqual(Object.keys(line).sort(), ["operation", "requestId", "schemaVersion", "serverDurationMs", "trace"]);
assert.equal(line.trace.startedAtMs, 0); assert.equal(line.trace.durationSemantics, "inclusive");
assert.deepEqual(line.trace.spans.map((span) => [span.id, span.parentId, span.phase, span.backend]), [[1, null, "api", "node"], [2, 1, "composite", "composite"], [3, 2, "worker", "powershell-worker"]]);
assert.deepEqual(line.trace.spans[2].counters, { workerProcessCount: 1, treeWalks: 2, treeWalkMs: 3 });
assert.equal(JSON.stringify(line).includes("synthetic-private"), false);
const pre = fixture("pre"), noTrace = createExecutionTraceLog({ telemetry: createExecutionTelemetry({ enabled: true }), ...pre });
noTrace.record({ event: "operation-error", requestId: "11111111-1111-4111-8111-111111111111", operation: "health", durationMs: 0 });
noTrace.close(); assert.equal(readFileSync(pre.outputPath, "utf8"), "");
const rejected = fixture("rejected"), rejectedTelemetry = createExecutionTelemetry({ enabled: true }), rejectedLog = createExecutionTraceLog({ telemetry: rejectedTelemetry, ...rejected });
const server = createSseApiServer({ execute: (operation) => rejectedTelemetry.runApi(operation, () => { throw new Error("synthetic rejection"); }), log: rejectedLog.record });
server.listen(0, "127.0.0.1"); await once(server, "listening"); assert.equal(await requestRejected(server), 502);
await new Promise((resolve) => server.close(resolve)); rejectedLog.close(); assert.equal(entries(rejected.outputPath)[0].operation, "health");
for (const [name, setup, record] of [
  ["wrong", async (t) => t.runApi("health", () => undefined), { event: "operation", requestId: "11111111-1111-4111-8111-111111111111", operation: "help", durationMs: 1 }],
  ["multiple", async (t) => { await t.runApi("health", () => undefined); await t.runApi("health", () => undefined); }, { event: "operation", requestId: "11111111-1111-4111-8111-111111111111", operation: "health", durationMs: 1 }],
  ["malformed", async (t) => t.runApi("health", () => undefined), { event: "operation", requestId: "bad", operation: "health", durationMs: -1 }],
]) {
  const paths = fixture(name), t = createExecutionTelemetry({ enabled: true }), log = createExecutionTraceLog({ telemetry: t, ...paths });
  await setup(t); log.record(record); assert.throws(() => log.close(), /Execution trace log instrumentation failed/u); assert.throws(() => log.close(), /Execution trace log instrumentation failed/u);
}
const containment = fixture("containment");
assert.throws(() => createExecutionTraceLog({ telemetry: createExecutionTelemetry({ enabled: true }), outputPath: join(containment.repositoryRoot, "trace.jsonl"), repositoryRoot: containment.repositoryRoot }), /outside repositoryRoot/u);
writeFileSync(join(containment.reports, "existing.jsonl"), "old");
assert.throws(() => createExecutionTraceLog({ telemetry: createExecutionTelemetry({ enabled: true }), outputPath: join(containment.reports, "existing.jsonl"), repositoryRoot: containment.repositoryRoot }), /exclusively/u);
assert.throws(() => createExecutionTraceLog({ telemetry: createExecutionTelemetry({ enabled: true }), outputPath: join(containment.reports, "missing", "trace.jsonl"), repositoryRoot: containment.repositoryRoot }), /must already exist/u);
const capped = fixture("capped"), cappedTelemetry = createExecutionTelemetry({ enabled: true, maxSpansPerTrace: 1 }), cappedLog = createExecutionTraceLog({ telemetry: cappedTelemetry, ...capped });
await cappedTelemetry.runApi("health", () => cappedTelemetry.runWorker("health", () => undefined));
cappedLog.record({ event: "operation", requestId: "11111111-1111-4111-8111-111111111111", operation: "health", durationMs: 1 });
assert.throws(() => cappedLog.close(), /Execution trace log instrumentation failed/u);

const orphan = fixture("orphan"), orphanTelemetry = createExecutionTelemetry({ enabled: true });
const orphanLog = createExecutionTraceLog({ telemetry: orphanTelemetry, ...orphan });
await orphanTelemetry.runApi("health", () => undefined);
assert.throws(() => orphanLog.close(), /remained unconsumed/u);
const overflow = fixture("overflow"), overflowTelemetry = createExecutionTelemetry({ enabled: true, maxCompletedTraces: 1 });
const overflowLog = createExecutionTraceLog({ telemetry: overflowTelemetry, ...overflow });
await overflowTelemetry.runApi("health", () => undefined);
await overflowTelemetry.runApi("health", () => undefined);
overflowLog.record({ event: "operation", requestId: "11111111-1111-4111-8111-111111111111", operation: "health", durationMs: 1 });
assert.throws(() => overflowLog.close(), /dropped/u);

const unfinished = fixture("unfinished"), unfinishedTelemetry = createExecutionTelemetry({ enabled: true });
const unfinishedLog = createExecutionTraceLog({ telemetry: unfinishedTelemetry, ...unfinished });
let release, nestedTask;
const pending = new Promise(resolve => { release = resolve; });
await unfinishedTelemetry.runApi("health", async () => {
  nestedTask = unfinishedTelemetry.runWorker("health", () => pending);
  await Promise.resolve();
});
unfinishedLog.record({ event: "operation", requestId: "11111111-1111-4111-8111-111111111111", operation: "health", durationMs: 1 });
release(); await nestedTask;
assert.throws(() => unfinishedLog.close(), /incomplete/u);

const linked = fixture("linked");
const link = join(linked.reports, "repository-link");
symlinkSync(linked.repositoryRoot, link, "junction");
assert.throws(() => createExecutionTraceLog({ telemetry: createExecutionTelemetry({ enabled: true }),
  repositoryRoot: linked.repositoryRoot, outputPath: join(link, "trace.jsonl") }), /outside repositoryRoot/u);
// Remove only the directory link before the fixture cleanup; never recurse into it.
unlinkSync(link);

for (const name of ["self-parent", "future-parent", "child-outside", "root-outside"]) {
  const paths = fixture(name), real = createExecutionTelemetry({ enabled: true });
  await real.runApi("health", () => real.runWorker("health", () => undefined));
  const trace = real.consumeCompleted()[0];
  const changes = {
    "self-parent": () => { trace.spans[1].parentId = trace.spans[1].id; },
    "future-parent": () => { trace.spans[1].parentId = 999; },
    "child-outside": () => { trace.spans[1].durationMs = trace.durationMs + 1; },
    "root-outside": () => { trace.spans[0].durationMs = trace.durationMs + 1; },
  };
  changes[name]();
  let ready = [trace];
  const log = createExecutionTraceLog({ telemetry: { consumeCompleted: () => { const result = ready; ready = []; return result; } }, ...paths });
  log.record({ event: "operation", requestId: "11111111-1111-4111-8111-111111111111", operation: "health", durationMs: 1 });
  assert.throws(() => log.close(), /instrumentation failed/u);
}

const originalWrite = fs.writeSync, originalClose = fs.closeSync;
for (const name of ["zero-write", "throw-write", "throw-close", "partial-write"]) {
  const paths = fixture(name), t = createExecutionTelemetry({ enabled: true });
  const log = createExecutionTraceLog({ telemetry: t, ...paths });
  await t.runApi("health", () => undefined);
  const replacements = {
    "zero-write": () => { fs.writeSync = () => 0; },
    "throw-write": () => { fs.writeSync = () => { throw new Error("private-I/O-error"); }; },
    "throw-close": () => { fs.closeSync = descriptor => { originalClose(descriptor); throw new Error("private-I/O-error"); }; },
    "partial-write": () => { fs.writeSync = (descriptor, bytes, offset, length, position) =>
      originalWrite(descriptor, bytes, offset, Math.min(length, 11), position); },
  };
  try {
    replacements[name](); syncBuiltinESMExports();
    assert.doesNotThrow(() => log.record({ event: "operation", requestId: "11111111-1111-4111-8111-111111111111", operation: "health", durationMs: 1 }));
    const expectations = {
      "zero-write": () => assert.throws(() => log.close(), /no progress/u),
      "throw-write": () => assert.throws(() => log.close(), /sidecar write failed/u),
      "throw-close": () => assert.throws(() => log.close(), /could not be closed/u),
      "partial-write": () => { log.close(); assert.equal(entries(paths.outputPath).length, 1); },
    };
    expectations[name]();
  } finally {
    fs.writeSync = originalWrite; fs.closeSync = originalClose; syncBuiltinESMExports();
  }
}

console.log("execution trace log contract: passed");
