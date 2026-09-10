import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutionTelemetry } from "../../dist/execution-telemetry.js";
import { createExecutionTraceLog } from "../execution-trace-log.mjs";
import { attachMegaExecutionTraces } from "./api-mega-execution-traces.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sse-mega-trace-join-"));
const repositoryRoot = join(temporary, "repo"), outputPath = join(temporary, "trace.jsonl");
mkdirSync(repositoryRoot);
const calls = [
  { requestId: "11111111-1111-4111-8111-111111111111", operation: "health", envelopeDurationMs: 7, label: "first" },
  { requestId: "22222222-2222-4222-8222-222222222222", operation: "health", envelopeDurationMs: 9, label: "second" },
];
try {
  const telemetry = createExecutionTelemetry({ enabled: true });
  const writer = createExecutionTraceLog({ telemetry, repositoryRoot, outputPath });
  // Reverse order deliberately proves that equal operation names are not the key.
  for (const call of [...calls].reverse()) {
    await telemetry.runApi(call.operation, () => telemetry.runWorker(call.operation, () => undefined));
    writer.record({ event: "operation", requestId: call.requestId, operation: call.operation, durationMs: call.envelopeDurationMs });
  }
  writer.close();
  const joined = await attachMegaExecutionTraces(calls, outputPath);
  assert.equal(joined.evidence.count, 2);
  assert.equal(joined.calls[0].executionTrace.id, 2);
  assert.equal(joined.calls[1].executionTrace.id, 1);
  assert(!("executionTrace" in calls[0]), "Join must not mutate the original workload records");
  assert.equal(joined.evidence.sha256, createHash("sha256").update(readFileSync(outputPath)).digest("hex"));
  await assert.rejects(attachMegaExecutionTraces([...calls, calls[0]], outputPath), /Duplicate Mega/);
  await assert.rejects(attachMegaExecutionTraces([{ ...calls[0], requestId: null }], outputPath), /missing its HTTP/);
  await assert.rejects(attachMegaExecutionTraces([calls[0]], outputPath), /no matching Mega/);
  await assert.rejects(attachMegaExecutionTraces([{ ...calls[0], operation: "help" }, calls[1]], outputPath), /operation mismatch/);
  await assert.rejects(attachMegaExecutionTraces([{ ...calls[0], envelopeDurationMs: 8 }, calls[1]], outputPath), /timing mismatch/);
  const lines = readFileSync(outputPath, "utf8").trim().split("\n");
  const missing = join(temporary, "missing.jsonl");
  writeFileSync(missing, lines[0] + "\n");
  await assert.rejects(attachMegaExecutionTraces(calls, missing), /missing execution/);
  const duplicate = join(temporary, "duplicate.jsonl");
  writeFileSync(duplicate, lines.concat(lines[0]).join("\n") + "\n");
  await assert.rejects(attachMegaExecutionTraces(calls, duplicate), /Duplicate execution/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log("Mega execution trace correlation: passed");
