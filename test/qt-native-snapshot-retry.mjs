import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readQtNativeSnapshot } from "../dist/qt-native-snapshot.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";

const cancelled = { ok: false, code: "GUI_QUEUE_TIMEOUT", error: "Read cancelled before GUI dispatch",
  mutationAttempted: false, outcomeUnknown: false };
const successful = { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 42,
  windowEnabled: true, modalBlocked: false, nodes: [], exactMatches: {},
  windowRect: { x: 0, y: 0, w: 800, h: 600 },
  stats: { n: 0, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
    valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 } };
function fixture(replies, hook = async () => {}) {
  const calls = [];
  const client = { binding: Object.freeze({ hwnd: 42, pid: 7 }),
    requestAcknowledged: async () => { throw new Error("A snapshot retry must never submit a mutation."); },
    request: async (operation, args, timeout, signal) => {
      calls.push({ operation, args, timeout, signal });
      await hook(calls.length);
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return { result: reply, durationMs: reply.ok ? 1 : 2000 };
    } };
  return { calls, run: (timeout = 5000, signal) => readQtNativeSnapshot(client, { hwnd: 42, maxNodes: 100 }, timeout, signal) };
}

const ordinary = fixture([successful]);
assert.equal((await ordinary.run()).nativeDurationMs, 1);
assert.equal(ordinary.calls.length, 1);
const busy = fixture([cancelled, cancelled, successful]);
const unchangedSignal = new AbortController();
const observed = await busy.run(5000, unchangedSignal.signal);
assert.equal(observed.hwnd, 42);
assert.equal(observed.nativeDurationMs, 4001, "The cancelled reads must remain in the measurement.");
assert.equal(busy.calls.length, 3);
assert.deepEqual(busy.calls.map(call => call.operation), Array(3).fill("accessibility_snapshot"));
assert(busy.calls.every(call => call.args.hwnd === undefined && call.args.maxNodes === 100));
assert(busy.calls.every(call => call.args === busy.calls[0].args && call.signal === unchangedSignal.signal));
assert(busy.calls[1].timeout < busy.calls[0].timeout && busy.calls[2].timeout < busy.calls[1].timeout,
  "Retry must consume the original deadline, never reset it.");

const exhausted = fixture([cancelled]);
await assert.rejects(exhausted.run(), error => error instanceof QtNativeTransportError && error.kind === "GUI_QUEUE_TIMEOUT" && !error.outcomeUnknown);
assert.equal(exhausted.calls.length, 3);
for (const reply of [
  { ...cancelled, mutationAttempted: true },
  { ...cancelled, mutationAttempted: undefined },
  { ...cancelled, outcomeUnknown: true },
  { ...cancelled, outcomeUnknown: undefined },
  { ...cancelled, mutationAttempted: "false" },
  { ...cancelled, code: "GUI_OPERATION_TIMEOUT" },
  { ...cancelled, code: "SESSION_OWNER_GONE" },
]) {
  const unsafe = fixture([reply, successful]);
  await assert.rejects(unsafe.run(), QtNativeTransportError);
  assert.equal(unsafe.calls.length, 1, "Uncertain, malformed or different failures must not be retried.");
}
const transportError = new QtNativeTransportError("Connection outcome is unknown", "native-connection", true);
const broken = fixture([transportError, successful]);
await assert.rejects(broken.run(), error => error === transportError);
assert.equal(broken.calls.length, 1);
const deadline = fixture([cancelled, successful], () => delay(5));
await assert.rejects(deadline.run(1), error => error.kind === "GUI_QUEUE_TIMEOUT");
assert.equal(deadline.calls.length, 1, "An expired overall deadline must prevent another read.");
const tight = fixture([cancelled, successful]);
await assert.rejects(tight.run(2400), error => error.kind === "GUI_QUEUE_TIMEOUT" && !error.outcomeUnknown);
assert.equal(tight.calls.length, 1, "Retry must leave the complete GUI queue/reply margin inside the original deadline.");
const abort = new AbortController();
const interrupted = fixture([cancelled, successful], async () => { abort.abort(); });
await assert.rejects(interrupted.run(5000, abort.signal), error => error.kind === "aborted");
assert.equal(interrupted.calls.length, 1);
const duringDelay = new AbortController();
const waiting = fixture([cancelled, successful], async () => { setTimeout(() => duringDelay.abort(), 5); });
await assert.rejects(waiting.run(5000, duringDelay.signal), error => error.kind === "aborted" && !error.outcomeUnknown);
assert.equal(waiting.calls.length, 1);
const wrongWindow = fixture([{ ...successful, hwnd: 43 }, successful]);
await assert.rejects(wrongWindow.run(), error => error.kind === "native-contract");
assert.equal(wrongWindow.calls.length, 1, "A binding/contract mismatch must fail immediately.");
process.stdout.write("Native snapshot: at most three proven queued-read retries, same binding/deadline, no mutation/transport replay.\n");
