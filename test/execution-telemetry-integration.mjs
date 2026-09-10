import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { createExecutionTelemetry } from "../dist/execution-telemetry.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-execution-integration-"));
const config = { host: "127.0.0.1", port: 1, profileId: "2025",
  configPath: join(temporary, "config.json"), caseDir: join(temporary, "cases"),
  workspaceDir: join(temporary, "workspace"), resultDir: join(temporary, "results"),
  documentsDir: join(temporary, "documents"), backupsDir: join(temporary, "backups") };
const telemetry = createExecutionTelemetry({ enabled: true });
const calls = [];
const worker = async (operation, args) => {
  calls.push(operation);
  if (operation === "get_value") throw new Error("private-result-text");
  if (operation === "bulk_action") return { ok: false, kind: "fixture",
    performance: { workerProcessCount: 1, internalOperationCount: 3, private: "private-result-text" } };
  return { ok: true, treeWalks: 2, treeWalkMs: 3.5, private: "private-result-text",
    performance: { workerProcessCount: 1, nativeMs: 0.5 } };
};
const execute = createApiExecutor(config, worker, { telemetry });
const take = (operation) => {
  const traces = telemetry.consumeCompleted();
  assert.equal(traces.length, 1, "Exactly one root per external operation");
  assert.equal(traces[0].operation, operation);
  assert.equal(traces[0].spans.filter(span => span.phase === "api").length, 1);
  assert.equal(traces[0].droppedSpanCount, 0);
  assert(traces[0].spans.every(span => span.completion === "completed"));
  assert(!JSON.stringify(traces).includes("private-result-text"));
  return traces[0];
};
try {
  const status = await execute("workspace_status", {}, 5000);
  assert.equal(status.ok, true);
  assert(take("workspace_status").spans.some(span => span.phase === "node-local"));
  assert.equal(calls.length, 0);
  const result = await execute("health", {}, 5000);
  assert.equal(result.ok, true);
  const backend = take("health").spans.find(span => span.phase === "worker");
  assert.deepEqual(backend.counters, { treeWalks: 2, treeWalkMs: 3.5, workerProcessCount: 1, nativeMs: 0.5 });
  assert.equal(backend.operation, "health");
  assert.equal((await execute("get_value", { aid: "synthetic-field" }, 5000)).ok, false);
  assert(take("get_value").spans.some(span => span.phase === "worker"));
  await execute("ustva_read", {}, 5000);
  const nested = take("ustva_read");
  const child = nested.spans.find(span => span.phase === "composite");
  assert.equal(child.operation, "page");
  assert.equal(nested.spans.find(span => span.phase === "worker").parentId, child.id);

  await execute("fill_fields", { pageId: "gew.fahrzeug", fields: [
    { fieldId: "bezeichnung", expectedBefore: "Alt", value: "Neu", expectedAfter: "Neu" },
  ], expectedEpoch: "A".repeat(64), stopOnError: true, rollback: "best-effort", finalReadback: true, hwnd: 42 }, 5000);
  assert.equal(calls.at(-1), "bulk_action");
  const privateWorker = take("fill_fields").spans.find(span => span.phase === "worker");
  assert.equal(privateWorker.operation, undefined);
  assert.equal(privateWorker.counters.internalOperationCount, 3);
  const native = createApiExecutor(config, worker, { telemetry,
    nativeDesktopStatus: async () => ({ ok: true, backend: "win32", aktiv: false }),
    qtNativeClientFor: async () => { throw new QtNativeTransportError("private-result-text", "native-binding"); },
  });
  const workerCount = calls.length;
  await native("desktop_status", {}, 5000);
  assert(take("desktop_status").spans.some(span => span.phase === "win32"));
  await native("get_value", { aid: "synthetic-field" }, 5000);
  assert(take("get_value").spans.some(span => span.phase === "qt-native"));
  assert.equal(calls.length, workerCount, "Native failures must not fall back to a Worker");
  const disabled = createExecutionTelemetry();
  const plain = createApiExecutor(config, worker, { telemetry: disabled });
  assert.deepEqual(await plain("health", {}, 5000), result);
  assert.deepEqual(disabled.consumeCompleted(), []);

  // Exercise the actual benchmark wrapper and HTTP log correlation without SSE.
  const raw = join(temporary, "synthetic.raw.json");
  const probe = [
    "const base=process.env.SSE_API_URL;",
    "for(const operation of ['capabilities','workspace_status','health']) {",
    "const response=await fetch(base+'/v1/operations/'+operation,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:{}})});",
    "if(response.status!==200)throw Error('HTTP failed');",
    "const envelope=await response.json(); if(!envelope.result.ok)throw Error('Operation failed');",
    "if('executionTrace' in envelope || 'executionTrace' in envelope.result)throw Error('Public schema changed'); }",
  ].join("\n");
  const env = { ...process.env, SSE_MEGA_RAW_REPORT: raw };
  for (const key of ["SSE_TEST_NATIVE_PACKAGE", "SSE_TEST_NATIVE_MANIFEST_SHA256", "SSE_TEST_OPERATION_TRACE_DIR",
    "SSE_TEST_INTERACTIVE_RECEIPTS", "SSE_TEST_API_PREWARM"]) delete env[key];
  const wrapped = spawnSync(process.execPath, ["test/with-api.mjs", process.execPath, "--input-type=module", "-e", probe], {
    cwd: resolve("."), env, encoding: "utf8", windowsHide: true, timeout: 30000,
  });
  assert.equal(wrapped.status, 0, wrapped.stderr);
  const records = readFileSync(raw + ".execution.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => record.operation), ["capabilities", "workspace_status", "health"]);
  assert.equal(new Set(records.map(record => record.requestId)).size, 3);
  assert(records.every(record => record.trace.spans[0].phase === "api"));
  const healthSpans = records.find(record => record.operation === "health").trace.spans;
  const actualWorker = healthSpans.find(span => span.phase === "worker");
  assert(actualWorker, "The real HTTP benchmark wrapper must execute its worker");
  for (const phase of ["worker-queue", "worker-prepare"]) {
    const spans = healthSpans.filter(span => span.phase === phase);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].parentId, actualWorker.id);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log("Execution telemetry integration: passed");
