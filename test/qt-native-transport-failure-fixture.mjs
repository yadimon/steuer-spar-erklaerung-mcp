import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { getEventListeners, once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { QtNativeAcknowledgmentError, QtNativeClient, QtNativeTransportError } from "../dist/qt-native-client.js";
import { createApiExecutor } from "../dist/api-executor.js";

// Short enough to survive the JSON parser's abbreviated diagnostic excerpt.
const privateDetail = "SYNTH42";
const binding = () => ({
  pipe: `\\\\.\\pipe\\sse-qt-read-${process.pid}-${randomBytes(8).toString("hex")}`,
  nonce: "a".repeat(64), pid: process.pid, hwnd: 42, creationTime: "134000000000000000",
});
const frame = value => {
  const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
};
const failedSubmission = error => {
  assert(error instanceof QtNativeTransportError);
  assert.equal(error.kind, "native-connection");
  assert.equal(error.outcomeUnknown, true);
  assert.equal(error.message.includes(privateDetail), false);
  return true;
};

async function withFaultPeer(handle, action, failPing = false) {
  const peer = binding(), requests = [];
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      const request = JSON.parse(chunk.subarray(4)); requests.push(request);
      if (request.op === "ping" && !failPing) {
        callback();
        queueMicrotask(() => this.push(frame({ ok: true, id: request.id, pid: peer.pid,
          hwnd: peer.hwnd, creationTime: peer.creationTime, bridgeProtocol: 1, guiThread: true })));
      } else handle(this, request, callback);
    },
  });
  let client;
  try {
    client = await QtNativeClient.connectStream(peer, stream);
    await action(client, requests, stream);
  } finally { client?.close(); stream.destroy(); }
}

export async function testNativeTransportFailures() {
  await assert.rejects(QtNativeClient.connect(binding(), 1000), error => {
    assert(error instanceof QtNativeTransportError);
    assert.equal(error.kind, "native-connection");
    assert.equal(error.outcomeUnknown, false, "A connection failure cannot have submitted an application request.");
    assert.equal(error.message.includes("sse-qt-read-"), false, "OS diagnostics must not disclose the pipe binding.");
    return true;
  });

  const throwWrite = () => { throw new Error(privateDetail); };
  const callbackError = (_stream, _request, callback) => callback(new Error(privateDetail));
  for (const failWrite of [throwWrite, callbackError]) {
    await assert.rejects(withFaultPeer(failWrite, () => assert.fail("A failed ping must not establish a client."), true), failedSubmission);
    await withFaultPeer(failWrite, async (client, requests, stream) => {
      const abort = new AbortController();
      await assert.rejects(client.request("table_set_cell", { value: "123,45" }, 1000, abort.signal), failedSubmission);
      assert.equal(stream.destroyed, true);
      assert.equal(getEventListeners(abort.signal, "abort").length, 0, "Terminal send failure must release the caller's abort listener.");
      await assert.rejects(client.request("table_set_cell"), failedSubmission);
      assert.deepEqual(requests.map(request => request.op), ["ping", "table_set_cell"], "A failed send must never be replayed.");
    });
  }

  await withFaultPeer((stream, request, callback) => {
    queueMicrotask(() => stream.push(frame({ ok: true, id: request.id, value: "known-before-stream-error" })));
    setImmediate(() => callback(new Error(privateDetail)));
  }, async (client, requests, stream) => {
    const failure = once(stream, "error");
    assert.equal((await client.request("objects")).result.value, "known-before-stream-error");
    await failure;
    await assert.rejects(client.request("objects"), error => {
      assert(error instanceof QtNativeTransportError); assert.equal(error.kind, "native-connection");
      assert.equal(error.outcomeUnknown, false, "A later stream error must retain the completed request's known result.");
      assert.equal(error.message.includes(privateDetail), false);
      return true;
    });
    assert.deepEqual(requests.map(request => request.op), ["ping", "objects"]);
  });

  await withFaultPeer((_stream, request, callback) => {
    if (request.op === "objects") callback();
    else throwWrite();
  }, async (client, requests) => {
    const results = await Promise.allSettled([client.request("objects"), client.request("table_set_cell")]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert(failedSubmission(result.reason));
    }
    assert.equal(results[0].reason, results[1].reason, "All pending callers must observe the same terminal failure.");
    assert.deepEqual(requests.map(request => request.op), ["ping", "objects", "table_set_cell"]);
  });

  await withFaultPeer((stream, request, callback) => {
    if (request.op === "mutation_ack") throwWrite();
    callback();
    queueMicrotask(() => stream.push(frame({ ok: true, id: request.id, mutationAttempted: true,
      mutationReceipt: "7", after: "synthetic-committed-value" })));
  }, async (client, requests) => {
    await assert.rejects(client.requestAcknowledged("table_set_cell"), error => {
      assert(error instanceof QtNativeAcknowledgmentError);
      assert(failedSubmission(error));
      assert.equal(error.mutationResult.after, "synthetic-committed-value");
      return true;
    });
    assert.deepEqual(requests.map(request => request.op), ["ping", "table_set_cell", "mutation_ack"]);
  });

  await withFaultPeer((stream, _request, callback) => {
    callback();
    const body = Buffer.from(privateDetail), header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    queueMicrotask(() => stream.push(Buffer.concat([header, body])));
  }, async client => {
    await assert.rejects(client.request("objects"), error => {
      assert(error instanceof QtNativeTransportError);
      assert.equal(error.kind, "native-protocol");
      assert.equal(error.outcomeUnknown, true);
      assert.equal(error.message.includes(privateDetail), false, "Parser diagnostics must not echo response bytes.");
      return true;
    });
  });

  await withFaultPeer(throwWrite, async client => {
    const fixture = mkdtempSync(join(tmpdir(), "sse-native-transport-fixture-"));
    try {
      const config = { host: "127.0.0.1", port: 1, configPath: join(fixture, "config.json"),
        caseDir: join(fixture, "cases"), workspaceDir: join(fixture, "workspace"), resultDir: join(fixture, "results") };
      const execute = createApiExecutor(config, async () => assert.fail("A native send failure must not invoke the worker."), { qtNativeClient: client });
      const result = await execute("get_value", { aid: "Synthetic.Text" }, 1000);
      assert.equal(result.ok, false); assert.equal(result.backend, "qt");
      assert.equal(result.kind, "native-connection"); assert.equal(result.outcomeUnknown, true);
      assert.equal(result.error.includes(privateDetail), false);
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
}
