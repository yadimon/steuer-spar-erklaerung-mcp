import { closeSync, openSync, realpathSync, statSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { EXECUTION_TELEMETRY_BACKENDS, EXECUTION_TELEMETRY_PHASES, WORKER_PERFORMANCE_COUNTERS } from "../dist/execution-telemetry.js";
import { isSseApiOperation } from "../dist/api-contract.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PHASES = new Set(EXECUTION_TELEMETRY_PHASES);
const BACKENDS = new Set(EXECUTION_TELEMETRY_BACKENDS);
class TraceLogError extends Error {}
function invalid(message) { throw new TraceLogError(message); }
function canonicalDirectory(value, name) {
  if (typeof value !== "string" || value.length === 0) invalid(name + " must be a non-empty path.");
  let canonical;
  try { canonical = realpathSync.native(value); } catch { invalid(name + " must already exist."); }
  let details;
  try { details = statSync(canonical); } catch { invalid(name + " could not be inspected."); }
  if (!details.isDirectory()) invalid(name + " must be a directory.");
  return canonical;
}
function isWithin(child, parent) {
  const remainder = relative(parent, child);
  return remainder === "" || (!remainder.startsWith(".." + sep) && remainder !== ".." && !isAbsolute(remainder));
}
function nonNegativeNumber(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function safeCounters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("trace counter metadata is malformed.");
  const source = value;
  const counters = {};
  for (const name of WORKER_PERFORMANCE_COUNTERS) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
    const counter = source[name];
    if (!nonNegativeNumber(counter) || ((name.endsWith("Count") || name === "treeWalks") && !Number.isInteger(counter))) invalid("trace counter metadata is malformed.");
    counters[name] = counter;
  }
  return counters;
}
function safeTrace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("completed trace metadata is malformed.");
  const trace = value;
  if (!positiveInteger(trace.id) || typeof trace.operation !== "string" || !isSseApiOperation(trace.operation) || !nonNegativeNumber(trace.startedAtMs) || !nonNegativeNumber(trace.durationMs) || trace.durationSemantics !== "inclusive" || trace.droppedSpanCount !== 0 || !Array.isArray(trace.spans) || !trace.spans.length) invalid("completed trace is incomplete or malformed.");
  const ids = new Set();
  const originalSpans = new Map();
  const timingToleranceMs = 0.001;
  let roots = 0;
  const spans = trace.spans.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("trace span metadata is malformed.");
    const span = value;
    if (!positiveInteger(span.id) || ids.has(span.id) || !(span.parentId === null || positiveInteger(span.parentId)) || !PHASES.has(span.phase) || !BACKENDS.has(span.backend) || !nonNegativeNumber(span.startedAtMs) || span.startedAtMs < trace.startedAtMs || !nonNegativeNumber(span.durationMs) || span.completion !== "completed" || span.durationSemantics !== "inclusive") invalid("trace span metadata is malformed or incomplete.");
    const end = span.startedAtMs + span.durationMs;
    if (end > trace.startedAtMs + trace.durationMs + timingToleranceMs) invalid("span exceeds its API trace.");
    if (span.parentId !== null) {
      const parent = originalSpans.get(span.parentId);
      if (!parent) invalid("trace parent must precede its child.");
      if (span.startedAtMs < parent.startedAtMs ||
          end > parent.startedAtMs + parent.durationMs + timingToleranceMs) invalid("span exceeds its parent.");
    }
    originalSpans.set(span.id, span);
    ids.add(span.id);
    if (span.parentId === null) roots += 1;
    if (span.operation !== undefined && (typeof span.operation !== "string" || !isSseApiOperation(span.operation))) invalid("trace span operation is malformed.");
    return { id: span.id, parentId: span.parentId, phase: span.phase, backend: span.backend, ...(span.operation === undefined ? {} : { operation: span.operation }), startedAtMs: span.startedAtMs - trace.startedAtMs, durationMs: span.durationMs, completion: "completed", durationSemantics: "inclusive", counters: safeCounters(span.counters) };
  });
  if (roots !== 1 || spans[0].parentId !== null || spans[0].phase !== "api" || spans[0].backend !== "node" || spans[0].operation !== trace.operation) invalid("trace hierarchy does not contain the API root.");
  for (const span of spans) if (span.parentId !== null && !ids.has(span.parentId)) invalid("trace hierarchy has an unknown parent.");
  return { id: trace.id, operation: trace.operation, startedAtMs: 0, durationMs: trace.durationMs, durationSemantics: "inclusive", droppedSpanCount: 0, spans };
}
function safeServerRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) invalid("server log metadata is malformed.");
  const event = record.event;
  if (event !== "operation" && event !== "operation-error") return null;
  if (typeof record.requestId !== "string" || !UUID.test(record.requestId)) invalid("server request identity is malformed.");
  if (typeof record.operation !== "string" || !isSseApiOperation(record.operation)) invalid("server operation is malformed.");
  if (!Number.isSafeInteger(record.durationMs) || record.durationMs < 0) invalid("server duration is malformed.");
  return { operation: record.operation, requestId: record.requestId, durationMs: record.durationMs };
}
export function createExecutionTraceLog({ telemetry, outputPath, repositoryRoot }) {
  if (!telemetry || typeof telemetry.consumeCompleted !== "function") invalid("telemetry must provide consumeCompleted().");
  if (typeof outputPath !== "string" || outputPath.length === 0) invalid("outputPath must be a non-empty path.");
  const repository = canonicalDirectory(repositoryRoot, "repositoryRoot");
  const requested = resolve(outputPath);
  const parent = canonicalDirectory(dirname(requested), "outputPath parent");
  const destination = resolve(parent, basename(requested));
  if (isWithin(destination, repository)) invalid("outputPath must be outside repositoryRoot.");
  let descriptor;
  try { descriptor = openSync(destination, "wx", 0o600); } catch { invalid("output sidecar could not be created exclusively."); }
  let closed = false;
  let failure = null;
  const latch = (message) => { if (!failure) failure = new Error("Execution trace log instrumentation failed: " + message); };
  const assertHealthy = () => { if (failure) throw failure; };
  const record = (serverLog) => {
    if (closed) { latch("record was called after close."); return; }
    try {
      if (!serverLog || typeof serverLog !== "object" || Array.isArray(serverLog)) return;
      if (serverLog.event !== "operation" && serverLog.event !== "operation-error") return;
      if (telemetry.droppedTraceCount > 0) invalid("completed traces were dropped before correlation.");
      const completed = telemetry.consumeCompleted();
      if (!Array.isArray(completed)) invalid("telemetry completed-trace buffer is malformed.");
      if (completed.length === 0) return;
      if (completed.length !== 1) invalid("server log did not correlate to exactly one completed trace.");
      const server = safeServerRecord(serverLog);
      const trace = safeTrace(completed[0]);
      if (!server || trace.operation !== server.operation) invalid("server operation did not match completed trace.");
      const line = Buffer.from(JSON.stringify({ schemaVersion: 1, requestId: server.requestId, operation: server.operation, serverDurationMs: server.durationMs, trace }) + "\n", "utf8");
      let offset = 0;
      while (offset < line.length) {
        const written = writeSync(descriptor, line, offset, line.length - offset, null);
        if (!Number.isSafeInteger(written) || written <= 0 || written > line.length - offset) invalid("output sidecar write made no progress.");
        offset += written;
      }
    } catch (error) { latch(error instanceof TraceLogError ? error.message : "sidecar write failed."); }
  };
  const close = () => {
    if (!closed) {
      closed = true;
      if (telemetry.droppedTraceCount > 0) latch("completed traces were dropped before close.");
      try { const completed = telemetry.consumeCompleted(); if (!Array.isArray(completed) || completed.length !== 0) latch("completed traces remained unconsumed at close."); } catch { latch("completed traces could not be checked at close."); }
      try { closeSync(descriptor); } catch { latch("output sidecar could not be closed."); }
    }
    assertHealthy();
  };
  return { record, close, assertHealthy };
}
