import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Duplex } from "node:stream";
import { QtNativeAcknowledgmentError, QtNativeClient, QtNativeTransportError } from "../dist/qt-native-client.js";

const frame = value => {
  const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4);
  header.writeUInt32LE(body.length); return Buffer.concat([header, body]);
};

/** Logical time proves the shared deadline without racing OS scheduling of two delayed pipe replies. */
export async function testNativeAcknowledgmentDeadline() {
  const binding = { pipe: `\\\\.\\pipe\\sse-qt-read-${process.pid}-${randomBytes(8).toString("hex")}`,
    nonce: randomBytes(32).toString("hex"), pid: process.pid, hwnd: 42, creationTime: "134000000000000000" };
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
  const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
  const timers = new Map(), requests = [];
  let now = 0, nextTimer = 0, client, mutationRequest, mutationEntered, acknowledgmentEntered, settled = false;
  const mutationSeen = new Promise(resolve => { mutationEntered = resolve; });
  const acknowledgmentSeen = new Promise(resolve => { acknowledgmentEntered = resolve; });
  const peer = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      const request = JSON.parse(chunk.subarray(4)); requests.push(request);
      if (request.op === "ping") {
        this.push(frame({ ok: true, id: request.id, pid: binding.pid, hwnd: binding.hwnd,
          creationTime: binding.creationTime, bridgeProtocol: 1, guiThread: true }));
      } else if (request.op === "table_set_cell") {
        mutationRequest = request; mutationEntered();
      } else if (request.op === "mutation_ack") acknowledgmentEntered();
      else throw new Error("Unexpected synthetic operation");
      callback();
    },
  });
  const advance = value => {
    now = value;
    for (const [id, timer] of [...timers]) if (timer.due <= now) {
      timers.delete(id); timer.callback();
    }
  };
  try {
    Object.defineProperty(performance, "now", { configurable: true, value: () => now });
    globalThis.setTimeout = (callback, delay) => {
      const id = ++nextTimer; timers.set(id, { callback, delay, due: now + delay }); return id;
    };
    globalThis.clearTimeout = id => { timers.delete(id); };
    client = await QtNativeClient.connectStream(binding, peer);
    const completed = client.requestAcknowledged("table_set_cell", {}, 200).then(
      result => { settled = true; return { result }; },
      error => { settled = true; return { error }; },
    );
    await mutationSeen;
    advance(120);
    peer.push(frame({ ok: true, id: mutationRequest.id, mutationAttempted: true,
      mutationReceipt: "9", after: "known-received-value" }));
    await acknowledgmentSeen;
    assert.deepEqual([...timers.values()].map(timer => ({ delay: timer.delay, due: timer.due })),
      [{ delay: 80, due: 200 }], "Acknowledgment receives only the remaining original budget");
    advance(199); assert.equal(settled, false);
    advance(200);
    const { error } = await completed;
    assert(error instanceof QtNativeAcknowledgmentError);
    assert.equal(error.kind, "native-timeout"); assert.equal(error.outcomeUnknown, true);
    assert.equal(error.mutationResult.after, "known-received-value");
    assert.deepEqual(requests.slice(1).map(request => request.op), ["table_set_cell", "mutation_ack"]);
    await assert.rejects(client.requestAcknowledged("table_set_cell"), failure =>
      failure instanceof QtNativeTransportError && failure.kind === "native-timeout");
    assert.equal(requests.length, 3, "The mutation must not be replayed after a lost acknowledgment");
    assert.equal(timers.size, 0);
  } finally {
    client?.close(); peer.destroy();
    globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout;
    if (originalNow) Object.defineProperty(performance, "now", originalNow);
    else delete performance.now;
  }
}
