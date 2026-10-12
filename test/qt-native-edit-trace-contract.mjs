import assert from "node:assert/strict";
import { firstEditTraceCoverage } from "./qt-native-edit-trace-coverage.mjs";

export function testNativeEditTraceCoverage() {
  const phases = ["metaCall.enter", "textEdited.enter", "textEdited.leave", "commit.enter", "delay.before",
    "delay.after", "modelSet.before", "modelSet.after", "commit.leave", "metaCall.leave", "firstEditWindow.complete"];
  const events = [{ phase: "firstEditWindow.arm", sequence: 1, monotonicUs: 1, threadId: 42, callId: 1 },
    ...phases.map((phase, index) => ({ phase, sequence: index + 2, monotonicUs: 10 + index,
      threadId: 42, delayMs: 0, callId: 7, utcMs: 1000 + index }))];
  const measurement = { request: { id: 9, startedAt: "2025-01-01T00:00:00.000Z" },
    response: { completedAt: "2025-01-01T00:00:01.000Z" } };
  const window = { acknowledgment: "trace-first-edit-arm", nativeClockBefore: { monotonicUs: 9, threadId: 42 },
    nativeClockAfter: { monotonicUs: 21, threadId: 42 } };
  const inspect = (records = events, bounds = window, footer = {}) => firstEditTraceCoverage({
    text: records.map(record => "SSE_FIXTURE_EDIT_PHASE " + JSON.stringify(record)).join("\n")
      + "\nSSE_FIXTURE_EDIT_JOURNAL " + JSON.stringify({ exportComplete: true, records: records.length, overflow: false, ...footer }),
    stderrDrained: true, exitCode: 0, signalCode: null, truncated: false,
  }, measurement, bounds);
  assert.equal(inspect().complete, true, "Causal same-thread monotonic bounds do not assume matching UTC clock precision.");
  for (const invalid of [
    { ...window, nativeClockBefore: undefined },
    { ...window, nativeClockAfter: { monotonicUs: 21, threadId: 43 } },
    { ...window, nativeClockBefore: { monotonicUs: 11, threadId: 42 } },
    { ...window, nativeClockAfter: { monotonicUs: 19, threadId: 42 } },
    { ...window, nativeClockAfter: { monotonicUs: 8, threadId: 42 } },
  ]) assert.equal(inspect(events, invalid).complete, false);
  const wrongThread = structuredClone(events); wrongThread[3].threadId++;
  assert.equal(inspect(wrongThread).complete, false);
  assert.equal(inspect(events.slice(1)).complete, false);
  assert.equal(inspect(events.slice(0, -1)).complete, false);
  assert.equal(inspect([...events, events[events.length - 1]]).complete, false);
  assert.equal(inspect(events, window, { overflow: true }).complete, false);
  assert.equal(inspect(events, window, { records: 1 }).complete, false);
}
