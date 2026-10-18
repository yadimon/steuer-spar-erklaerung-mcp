import assert from "node:assert/strict";
import { inspectNativeEditPhases, nativeEditPhaseNames } from "./qt-native-edit-phases.mjs";

const successful = { id: 17, ok: true, nativeEditTrace: {
  schemaVersion: 1, capacity: 32, clock: "request-relative-steady-microseconds", capturedAtUs: 200,
  captureComplete: true, overflow: false,
  records: nativeEditPhaseNames.map((phase, index) => ({ sequence: index + 1, phase, monotonicUs: index * 10, threadId: 42 })),
} };
const inspectSuccess = reply => inspectNativeEditPhases(reply, { complete: true, successfulLineEdit: true });
const valid = inspectSuccess(successful);
assert.equal(valid.valid, true);
assert.equal(valid.intervals.length, nativeEditPhaseNames.length - 1);
assert(valid.intervals.every(interval => interval.durationUs === 10));

const partial = structuredClone(successful);
partial.ok = false; partial.code = "GUI_OPERATION_TIMEOUT"; partial.outcomeUnknown = true;
partial.nativeEditTrace.captureComplete = false;
partial.nativeEditTrace.records = partial.nativeEditTrace.records.slice(0, nativeEditPhaseNames.indexOf("commit.before") + 1);
const inspectPartial = reply => inspectNativeEditPhases(reply, { complete: false, activePhase: "commit.before" });
assert.equal(inspectPartial(partial).valid, true);
assert.equal(inspectSuccess(partial).valid, false, "A partial timeout must never satisfy completed edit coverage.");
assert.equal(inspectPartial(successful).valid, false);

const invalid = mutate => {
  const reply = structuredClone(successful); mutate(reply);
  assert.equal(inspectSuccess(reply).valid, false);
};
invalid(reply => { delete reply.nativeEditTrace; });
invalid(reply => { reply.id = "17"; });
invalid(reply => { delete reply.ok; });
invalid(reply => { reply.nativeEditTrace.value = "Must never appear in diagnostics"; });
invalid(reply => { reply.nativeEditTrace.clock = "fixture-relative"; });
invalid(reply => { reply.nativeEditTrace.capacity = 256; });
invalid(reply => { reply.nativeEditTrace.overflow = true; });
invalid(reply => { reply.nativeEditTrace.captureComplete = false; });
invalid(reply => { reply.nativeEditTrace.records[2].rid = "Must never appear"; });
invalid(reply => { reply.nativeEditTrace.records[2].phase = "untrusted private field"; });
invalid(reply => { reply.nativeEditTrace.records[2].threadId++; });
invalid(reply => { reply.nativeEditTrace.records[2].monotonicUs = -1; });
invalid(reply => { reply.nativeEditTrace.records[2].monotonicUs = 201; });
invalid(reply => { reply.nativeEditTrace.records[2].monotonicUs = 0; });
invalid(reply => { reply.nativeEditTrace.records[2].sequence++; });
invalid(reply => { reply.nativeEditTrace.records.splice(2, 1); });
invalid(reply => { reply.nativeEditTrace.records.push(structuredClone(reply.nativeEditTrace.records.at(-1))); });
invalid(reply => { reply.nativeEditTrace.records = Array.from({ length: 33 }, () => reply.nativeEditTrace.records[0]); });
const cancelled = structuredClone(partial);
cancelled.nativeEditTrace.records = [];
assert.equal(inspectNativeEditPhases(cancelled, { complete: false }).valid, true,
  "A request cancelled before GUI dispatch has a valid empty published prefix.");
assert.equal(inspectNativeEditPhases(cancelled, { complete: false, activePhase: "commit.before" }).valid, false);
const inconsistentCompletion = structuredClone(successful); inconsistentCompletion.nativeEditTrace.captureComplete = false;
assert.equal(inspectNativeEditPhases(inconsistentCompletion, { complete: false }).valid, false);
assert.equal(inspectNativeEditPhases({ id: 1, nativeEditTrace: { records: [null] } }).valid, false);
console.log("PASS native edit phase diagnostic shape, immutable prefixes, ordering, privacy and independent clock semantics");
