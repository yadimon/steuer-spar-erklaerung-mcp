import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QtNativeClient, QtNativeTransportError } from "../dist/qt-native-client.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";
import { callApiOperationEnvelope } from "../dist/api-client.js";

const frame = value => {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
};
const nativeError = kind => error => error instanceof QtNativeTransportError && error.kind === kind;

async function withPeer(handler, action, handshake = {}) {
  const binding = {
    pipe: `\\\\.\\pipe\\sse-qt-read-${process.pid}-${randomBytes(8).toString("hex")}`,
    nonce: randomBytes(32).toString("hex"), pid: process.pid, hwnd: 42, creationTime: "134000000000000000",
  };
  const connections = new Set();
  const requests = [];
  const server = createServer(socket => {
    connections.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => connections.delete(socket));
    let input = Buffer.alloc(0);
    socket.on("data", data => {
      input = Buffer.concat([input, data]);
      while (input.length >= 4 && input.length >= 4 + input.readUInt32LE(0)) {
        const length = input.readUInt32LE(0);
        const request = JSON.parse(input.subarray(4, length + 4));
        input = input.subarray(length + 4);
        requests.push(request);
        assert.equal(request.nonce, binding.nonce);
        if (request.op === "ping") {
          socket.write(frame({ ok: true, id: request.id, pid: binding.pid, hwnd: binding.hwnd,
            creationTime: binding.creationTime, bridgeProtocol: 1, guiThread: true, ...handshake }));
        } else {
          Promise.resolve(handler(socket, request)).catch(error => socket.destroy(error));
        }
      }
    });
  });
  server.listen(binding.pipe);
  await once(server, "listening");
  try { await action(binding, requests); }
  finally {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

await withPeer(async (socket, request) => {
  const reply = frame({ ok: true, id: request.id, value: "Büro – проверка", rowCount: 500 });
  for (let offset = 0; offset < reply.length; offset += 5) {
    socket.write(reply.subarray(offset, offset + 5));
    await nextTurn();
  }
}, async (binding, requests) => {
  const client = await QtNativeClient.connect(binding);
  const reply = await client.request("objects");
  assert.equal(reply.result.value, "Büro – проверка");
  assert.equal(reply.result.rowCount, 500);
  assert(reply.durationMs >= 0);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(client.request("table_set_cell", {}, 1000, stopped.signal), error => nativeError("aborted")(error) && !error.outcomeUnknown);
  await assert.rejects(client.request("objects", { nonce: "override" }), nativeError("native-request"));
  await assert.rejects(client.request("objects", { text: "a".repeat(1024 * 1024) }), nativeError("native-request-size"));
  assert.equal(requests.length, 2, "Rejected requests must not reach the pipe.");
  client.close();
});

await withPeer(() => {}, async binding => {
  await assert.rejects(QtNativeClient.connect(binding), nativeError("native-peer"));
}, { creationTime: "134000000000000001" });

await withPeer((socket, request) => socket.write(frame({ ok: true, id: request.id + 100 })), async binding => {
  const client = await QtNativeClient.connect(binding);
  await assert.rejects(client.request("objects"), nativeError("native-protocol"));
  await assert.rejects(client.request("objects"), nativeError("native-protocol"));
});

await withPeer(socket => {
  const header = Buffer.alloc(4); header.writeUInt32LE(16 * 1024 * 1024 + 1); socket.write(header);
}, async binding => {
  const client = await QtNativeClient.connect(binding);
  await assert.rejects(client.request("objects"), nativeError("native-protocol"));
});

await withPeer((socket, request) => {
  const body = Buffer.concat([Buffer.from(`{"ok":true,"id":${request.id},"value":"`), Buffer.from([0xff]), Buffer.from('"}')]);
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(Buffer.concat([header, body]));
}, async binding => {
  const client = await QtNativeClient.connect(binding);
  await assert.rejects(client.request("objects"), nativeError("native-protocol"));
});

await withPeer(() => {}, async (binding, requests) => {
  const client = await QtNativeClient.connect(binding);
  await assert.rejects(client.request("table_set_cell", { value: "123,45" }, 25), error => nativeError("native-timeout")(error) && error.outcomeUnknown);
  await assert.rejects(client.request("table_set_cell"), nativeError("native-timeout"));
  assert.equal(requests.filter(request => request.op === "table_set_cell").length, 1, "A timed-out write must not be replayed.");
});

await withPeer(() => {}, async (binding, requests) => {
  const client = await QtNativeClient.connect(binding);
  const signal = new AbortController();
  const response = client.request("table_set_cell", { value: "123,45" }, 1000, signal.signal);
  signal.abort();
  await assert.rejects(response, error => nativeError("aborted")(error) && error.outcomeUnknown);
  assert(requests.length <= 2);
});

const fixture = mkdtempSync(join(tmpdir(), "sse-qt-values-"));
try {
  const config = {
    host: "127.0.0.1", port: 1, configPath: join(fixture, "config.json"),
    caseDir: join(fixture, "cases"), workspaceDir: join(fixture, "workspace"), resultDir: join(fixture, "results"),
  };
  const node = (id, name, value, extra = {}) => ({
    id, parentId: 100, class: "QLineEdit", kind: "lineEdit", name, value, visible: true, enabled: true, readOnly: false, ...extra,
  });
  let objects = [
    node(1, "/.Connection.Caption", "Anschluss", { kind: "label", class: "QLabel" }),
    node(2, "/.Connection.Text", "Büro – проверка"),
    node(3, "/.Password.Text", "", { parentId: 101, sensitive: true }),
    node(4, "/.Other.Text", "Secondary", { parentId: 102 }),
    node(5, "/.Hidden.Text", "Hidden", { parentId: 103, visible: false }),
  ];
  let windowState = { controllerBound: true, windowEnabled: true, modalBlocked: false };
  await withPeer((socket, request) => {
    assert.equal(request.op, "objects");
    assert.equal(request.projection, "values");
    assert.equal(request.visibleOnly, true);
    socket.write(frame({ ok: true, id: request.id, complete: true, objects, projection: "values", visibleOnly: true, ...windowState }));
  }, async (binding, requests) => {
    const client = await QtNativeClient.connect(binding);
    let workerCalls = 0;
    const worker = async () => { workerCalls += 1; assert.fail("A bound native read must not fall back to UIA."); };
    const execute = createApiExecutor(config, worker, { qtNativeClient: client });
    const server = createSseApiServer({ execute });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const read = async args => (await callApiOperationEnvelope("get_value", args, 5000, { baseUrl })).result;
    try {
      const byFullId = await read({ aid: "Window/Dialog/.Connection.Text", hwnd: binding.hwnd });
      assert.equal(byFullId.ok, true);
      assert.equal(byFullId.value, "Büro – проверка");
      assert.equal(byFullId.backend, "qt");
      assert.equal(byFullId.readOnly, false);
      const bySuffix = await read({ aid: "Connection.Text", type: "Edit" });
      assert.equal(bySuffix.value, byFullId.value);
      const byRuntimeId = await read({ rid: byFullId.node.rid });
      assert.equal(byRuntimeId.value, byFullId.value);
      const byLabel = await read({ name: "schluss", contains: true });
      assert.equal(byLabel.value, byFullId.value);
      assert.equal(byLabel.aufgeloestUeber, "beschriftung");
      objects[1].value = "Changed after the first read";
      assert.equal((await read({ aid: "Connection.Text" })).value, objects[1].value, "A subsequent read must not return a cached value.");
      assert.equal((await read({ aid: ".Text" })).kind, "ambiguous");
      assert.equal((await read({ aid: "Connection.Text", type: "ComboBox" })).kind, "not-found");
      assert.equal((await read({ aid: "Connection.Text", rid: byFullId.node.rid + "0" })).kind, "not-found");
      assert.equal((await read({ aid: "Hidden.Text" })).kind, "not-found");
      assert.equal((await read({ aid: "Password.Text" })).kind, "no-readable-value");
      assert.equal((await read({ aid: "Connection.Caption" })).kind, "no-readable-value");
      const requestsBeforeRejection = requests.length;
      assert.equal((await read({ aid: "Connection.Text", hwnd: binding.hwnd + 1 })).kind, "stale-window");
      await assert.rejects(read({}), error => error.kind === "bad-args");
      assert.equal((await execute("get_value", { aid: "Connection.Text", unexpected: true }, 5000)).kind, "bad-args");
      const experimental = createApiExecutor({ ...config, profileId: "2024" }, worker, { qtNativeClient: client });
      assert.equal((await experimental("get_value", { aid: "Connection.Text" }, 5000)).kind, "profile-unverified");
      assert.equal(requests.length, requestsBeforeRejection, "Rejected selectors and profile gates must not call the native bridge.");
      objects.push(node(6, "/.Connection.Second", "Second sibling"));
      assert.equal((await read({ name: "Anschluss" })).kind, "ambiguous");
      objects = objects.filter(item => item.id !== 2);
      assert.equal((await read({ rid: byFullId.node.rid })).kind, "not-found", "A destroyed native object must not resolve from a prior tree.");
      windowState.modalBlocked = true;
      assert.equal((await read({ aid: "Other.Text" })).kind, "window-obstructed");
      windowState.modalBlocked = false;
      windowState.windowEnabled = false;
      assert.equal((await read({ aid: "Other.Text" })).kind, "window-obstructed");
      windowState.windowEnabled = true;
      windowState.controllerBound = false;
      assert.equal((await read({ aid: "Other.Text" })).kind, "native-contract");
      assert.equal(workerCalls, 0);
    } finally {
      client.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
  const cell = (display, checkState = null) => ({ display, edit: display, checkState, flags: checkState === null ? 35 : 63 });
  const record = (label, amount, check) => [cell(""), cell(label), cell(amount), cell(null, check)];
  const completeTable = {
    ok: true, controllerBound: true, windowEnabled: true, modalBlocked: false,
    rows: 5, readRows: 5, columns: 4, headers: ["Nr.", "Text", "Betrag", "Flag"],
    values: [record("Duplicate", "1,00", 2), record("Duplicate", "1,00", 2), record("Hidden", "3,00", 0),
      record("Third", "2,00", 1), record("", "0,00", 0)],
    rowFingerprints: Array.from({ length: 5 }, (_, index) => String(index).repeat(64)),
    hiddenColumns: [0], hiddenRows: [2], complete: true, canFetchMore: false, tableCount: 1,
    table: { id: 9, name: "/.Synthetic.Table", class: "DialogUITable", visible: true },
    summary: "4,00", binding: { sumLabel: "Summe", sumOccurrence: 1, coordinateSpace: "qt-root" },
    summaries: [{ label: "Summe", vorkommen: 1, wert: "4,00" }],
  };
  let tableReply = structuredClone(completeTable);
  await withPeer((socket, request) => {
    assert.equal(request.op, "table_snapshot");
    assert.equal(request.noKeys, undefined, "Native table reads must not dispatch physical-input options.");
    socket.write(frame({ ...tableReply, id: request.id }));
  }, async (binding, requests) => {
    const client = await QtNativeClient.connect(binding);
    const execute = createApiExecutor(config, async () => { assert.fail("Native table read fell back to UIA."); }, { qtNativeClient: client });
    const server = createSseApiServer({ execute });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const read = async args => (await callApiOperationEnvelope("table_read", args, 5000, { baseUrl })).result;
    try {
      const result = await read({ noKeys: true, sumLabel: "Summe", sumOccurrence: 1 });
      assert.equal(result.ok, true); assert.equal(result.vollstaendig, true); assert.equal(result.physicalInputUsed, false);
      assert.equal(result.anzahl, 3); assert.equal(result.summe, "4,00");
      assert.deepEqual(result.kopf, ["Text", "Betrag", "Flag"]);
      assert.deepEqual(result.zeilen, [["Duplicate", "1,00", ""], ["Duplicate", "1,00", ""], ["Third", "2,00", ""]]);
      assert.deepEqual(result.rowDetails.map(row => row.modelRowIndex), [0, 1, 3]);
      assert.deepEqual(result.rowDetails[0].typedValues, ["Duplicate", "1,00", true]);
      assert.deepEqual(result.rowDetails[2].checkboxStates, [null, null, "Indeterminate"]);
      assert.equal(result.rowDetails[2].typedValues[2], null);
      assert(result.rowDetails.every(row => row.semanticsComplete));
      const beforeRejected = requests.length;
      assert.equal((await read({ hwnd: binding.hwnd + 1 })).kind, "stale-window");
      assert.equal(requests.length, beforeRejected);
      tableReply.readRows = 3; tableReply.values = tableReply.values.slice(0, 3);
      tableReply.rowFingerprints = tableReply.rowFingerprints.slice(0, 3); tableReply.complete = false;
      const partial = await read({ maxRows: 2 });
      assert.equal(partial.anzahl, 2); assert.equal(partial.vollstaendig, false);
      assert.equal(partial.limitReached, true); assert.equal(partial.stopKind, "max-rows");
      tableReply.complete = true;
      assert.equal((await read({ maxRows: 2 })).kind, "native-contract", "Partial model data must not claim completeness.");
      tableReply = structuredClone(completeTable); tableReply.hiddenColumns = [4];
      assert.equal((await read({})).kind, "native-contract");
      tableReply = structuredClone(completeTable); tableReply.values[0][3].checkState = 7;
      const uncertain = await read({});
      assert.equal(uncertain.rowDetails[0].semanticsComplete, false);
      assert.equal(uncertain.rowDetails[0].cellTypes[2], "unknown");
      tableReply = structuredClone(completeTable); tableReply.modalBlocked = true;
      assert.equal((await read({})).kind, "window-obstructed");
      tableReply = { ok: false, code: "busy", error: "Controller occupied", mutationAttempted: false };
      assert.equal((await read({})).kind, "busy");
    } finally {
      client.close(); await new Promise(resolve => server.close(resolve));
    }
  });
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log("OK: native pipe binding, cancellation, no write replay, fresh HTTP values and typed table reads with limits and duplicate rows preserved.");
