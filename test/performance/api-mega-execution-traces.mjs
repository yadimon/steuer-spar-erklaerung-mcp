import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Join by the actual HTTP request identity, never by operation order or name. */
export async function attachMegaExecutionTraces(calls, sidecarPath) {
  assert(Array.isArray(calls), "Mega calls must be an array");
  assert(statSync(sidecarPath).size <= 64 * 1024 * 1024, "Execution sidecar exceeds its bounded evidence limit");
  const pending = new Map();
  for (const call of calls) {
    assert(UUID.test(call.requestId ?? ""), "Mega call is missing its HTTP request identity");
    assert(!pending.has(call.requestId), "Duplicate Mega request identity");
    pending.set(call.requestId, call);
  }
  const traces = new Map();
  const digest = createHash("sha256");
  const stream = createReadStream(sidecarPath);
  stream.on("data", chunk => digest.update(chunk));
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      assert(line.length > 0 && Buffer.byteLength(line) <= 4 * 1024 * 1024, "Malformed execution sidecar line");
      const record = JSON.parse(line);
      assert.equal(record.schemaVersion, 1);
      assert(UUID.test(record.requestId ?? ""), "Malformed execution request identity");
      assert(!traces.has(record.requestId), "Duplicate execution request identity");
      const call = pending.get(record.requestId);
      assert(call, "Execution trace has no matching Mega request");
      assert.equal(record.operation, call.operation, "Execution operation mismatch");
      assert.equal(record.serverDurationMs, call.envelopeDurationMs, "Execution server timing mismatch");
      assert.equal(record.trace?.operation, call.operation, "Execution trace operation mismatch");
      assert.equal(record.trace?.durationSemantics, "inclusive");
      assert.equal(record.trace?.droppedSpanCount, 0);
      assert(Array.isArray(record.trace?.spans) && record.trace.spans.length > 0, "Execution spans missing");
      assert(record.trace.spans.every(span => span.completion === "completed"), "Execution spans unfinished");
      traces.set(record.requestId, record.trace);
      pending.delete(record.requestId);
    }
    assert.equal(pending.size, 0, "Mega calls are missing execution traces");
  } finally {
    reader.close();
    stream.destroy();
  }
  return {
    calls: calls.map(call => ({ ...call, executionTrace: traces.get(call.requestId) })),
    evidence: { schemaVersion: 1, sidecar: basename(sidecarPath), sha256: digest.digest("hex"),
      count: traces.size, correlation: "HTTP requestId plus exact operation and server duration",
      durationSemantics: "inclusive; nested spans overlap and must not be summed",
      scope: "API orchestration, Worker calls, local work, Qt/Win32 dispatch and lazy discovery/bind; absent phases/counters are unmeasured, not zero" },
  };
}
