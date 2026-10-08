import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import { QtNativeClient, QtNativeTransportError } from "../dist/qt-native-client.js";

const frame = value => {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
};
const protocolError = error => error instanceof QtNativeTransportError && error.kind === "native-protocol";

async function withBytePeer(handle, action) {
  const binding = { pipe: `\\\\.\\pipe\\sse-qt-read-${process.pid}-0000000000000000`,
    nonce: "a".repeat(64), pid: process.pid, hwnd: 42, creationTime: "134000000000000000" };
  const requests = [];
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      const request = JSON.parse(chunk.subarray(4)); requests.push(request);
      assert.equal(request.nonce, binding.nonce);
      queueMicrotask(() => {
        if (request.op === "ping") this.push(frame({ ok: true, id: request.id, pid: binding.pid,
          hwnd: binding.hwnd, creationTime: binding.creationTime, bridgeProtocol: 1, guiThread: true }));
        else handle(this, request);
      });
      callback();
    },
  });
  const client = await QtNativeClient.connectStream(binding, stream);
  try { await action(client, requests, stream); }
  finally { client.close(); assert.equal(stream.destroyed, true); }
}

export async function testNativeFrameBoundaries() {
  const value = "Büro – Україна 🚀";
  await withBytePeer((stream, request) => {
    const reply = frame({ ok: true, id: request.id, value });
    for (let offset = 0; offset < reply.length; offset++) stream.push(reply.subarray(offset, offset + 1));
  }, async client => {
    for (let index = 0; index < 2; index++) assert.equal((await client.request("objects")).result.value, value);
  });

  // Multiple replies may share a chunk and arrive in request-independent order.
  const requests = [];
  await withBytePeer((stream, request) => {
    requests.push(request);
    if (requests.length !== 3) return;
    const replies = Buffer.concat([requests[2], requests[0], requests[1]].map(entry =>
      frame({ ok: true, id: entry.id, operation: entry.op, value })));
    for (let offset = 0, width = 1; offset < replies.length; width = width % 11 + 1) {
      stream.push(replies.subarray(offset, offset + width)); offset += width;
    }
  }, async client => {
    const operations = ["objects", "windows", "accessibility_snapshot"];
    const replies = await Promise.all(operations.map(operation => client.request(operation)));
    assert.deepEqual(replies.map(reply => reply.result.operation), operations);
    assert(replies.every(reply => reply.result.value === value));
  });

  for (const length of [0, 16 * 1024 * 1024 + 1]) {
    await withBytePeer(stream => {
      const header = Buffer.alloc(4); header.writeUInt32LE(length);
      for (const byte of header) stream.push(Buffer.from([byte]));
    }, async client => {
      await assert.rejects(client.request("objects"), protocolError);
      await assert.rejects(client.request("objects"), protocolError);
    });
  }

  const repeatedRequests = [];
  await withBytePeer((stream, request) => {
    repeatedRequests.push(request);
    if (repeatedRequests.length !== 2) return;
    const reply = frame({ ok: true, id: repeatedRequests[0].id });
    stream.push(Buffer.concat([reply, reply]));
  }, async client => {
    const [first, second] = await Promise.allSettled([client.request("objects"), client.request("windows")]);
    assert.equal(first.status, "fulfilled");
    assert.equal(second.status, "rejected"); assert(protocolError(second.reason));
    await assert.rejects(client.request("objects"), protocolError);
  });

  const abort = new AbortController();
  await withBytePeer((stream, request) => {
    const reply = frame({ ok: true, id: request.id, value: "x".repeat(1000) });
    stream.push(reply.subarray(0, 7)); abort.abort();
  }, async (client, requests, stream) => {
    await assert.rejects(client.request("objects", {}, 1000, abort.signal), error =>
      error instanceof QtNativeTransportError && error.kind === "aborted" && error.outcomeUnknown);
    await assert.rejects(client.request("objects"), error => error.kind === "aborted");
    assert.equal(requests.length, 2, "A cancelled partial response must never replay its request.");
    assert.equal(stream.destroyed, true);
  });

  await withBytePeer((stream, request) => {
    const reply = frame({ ok: true, id: request.id, value: "x".repeat(1000) });
    stream.push(reply.subarray(0, 7));
  }, async (client, requests, stream) => {
    await assert.rejects(client.request("objects", {}, 25), error =>
      error instanceof QtNativeTransportError && error.kind === "native-timeout" && error.outcomeUnknown);
    assert.equal(stream.destroyed, true);
    await assert.rejects(client.request("objects"), error => error.kind === "native-timeout");
    assert.equal(requests.length, 2, "A timed-out partial response must never replay its request.");
  });

  const responseLimit = 16 * 1024 * 1024;
  const headerOnlyAbort = new AbortController();
  let headerDelivered;
  const headerReady = new Promise(resolve => { headerDelivered = resolve; });
  await withBytePeer(stream => {
    const header = Buffer.alloc(4); header.writeUInt32LE(responseLimit);
    stream.push(header); headerDelivered();
  }, async client => {
    const originalAlloc = Buffer.allocUnsafe;
    let allocatedBytes = 0;
    Buffer.allocUnsafe = function (size) { allocatedBytes += size; return originalAlloc.call(Buffer, size); };
    const rejected = assert.rejects(client.request("objects", {}, 1000, headerOnlyAbort.signal), error =>
      error instanceof QtNativeTransportError && error.kind === "aborted");
    try {
      await headerReady;
      assert(allocatedBytes < 16384, "A header alone must not allocate its declared response body.");
    } finally {
      Buffer.allocUnsafe = originalAlloc; headerOnlyAbort.abort(); await rejected;
    }
  });

  const maximumValue = "x".repeat(responseLimit - (frame({ ok: true, id: 2, value: "" }).length - 4));
  const maximumReply = frame({ ok: true, id: 2, value: maximumValue });
  assert.equal(maximumReply.length, responseLimit + 4);
  await withBytePeer(stream => stream.push(maximumReply), async client => {
    assert.equal((await client.request("objects")).result.value, maximumValue);
  });
  await withBytePeer(stream => stream.push(Buffer.concat([maximumReply, Buffer.from([1])])), async (client, _requests, stream) => {
    await assert.rejects(client.request("objects"), protocolError);
    assert.equal(stream.destroyed, true, "The aggregate receive bound must fail before accepting an over-limit chunk.");
  });

  // Count receive copying rather than asserting a machine-dependent deadline.
  // The same complete large reply must survive arbitrary fragmentation with
  // work proportional to its size, including the public client's JSON decode.
  const expected = { ok: true, id: 2, value: value.repeat(32768) };
  const reply = frame(expected);
  await withBytePeer(stream => {
    for (let offset = 0; offset < reply.length; offset += 4096) stream.push(reply.subarray(offset, offset + 4096));
  }, async client => {
    const originalConcat = Buffer.concat, originalCopy = Buffer.prototype.copy;
    let copiedBytes = 0;
    Buffer.concat = function (list, length) {
      copiedBytes += length ?? list.reduce((sum, part) => sum + part.length, 0);
      return originalConcat.call(Buffer, list, length);
    };
    Buffer.prototype.copy = function (...args) {
      const copied = originalCopy.apply(this, args); copiedBytes += copied; return copied;
    };
    try {
      assert.deepEqual((await client.request("objects")).result, expected);
      assert(copiedBytes < reply.length * 3, "Fragmented native receive copying must stay linear in reply size.");
    } finally { Buffer.concat = originalConcat; Buffer.prototype.copy = originalCopy; }
  });
}
