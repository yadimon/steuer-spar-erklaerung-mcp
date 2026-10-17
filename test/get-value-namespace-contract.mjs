import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";
import { callApiOperationEnvelope } from "../dist/api-client.js";
import { createMcpRegistry } from "../dist/mcp-registry.js";
import { registerUiTools } from "../dist/mcp-tools-ui.js";
import { parseApiOperationArgs, SSE_MCP_TOOL_SCHEMAS } from "../dist/operation-catalog.js";
import { executeQtNativeOperation } from "../dist/qt-native-executor.js";
import { executeQtNativeGetValue } from "../dist/qt-native-values.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-get-value-namespace-"));
const config = {
  host: "127.0.0.1", port: 1, configPath: join(temporary, "config.json"),
  workspaceDir: join(temporary, "workspace"), resultDir: join(temporary, "results"),
  documentsDir: join(temporary, "documents"), backupsDir: join(temporary, "backups"), caseDir: join(temporary, "cases"),
};
const binding = { pid: 1234, hwnd: 42, creationTime: "134000000000000000" };
const qtRid = `qt:${binding.pid}:${binding.creationTime}:${binding.hwnd}:2`;
const snapshotNode = {
  i: 0, p: -1, d: 0, type: "Edit", name: "Synthetic value", aid: "window.field", rid: "42.1234.4.-2147483647",
  x: 10, y: 20, w: 80, h: 25, on: true, val: "Snapshot value", ro: false, checked: null, selected: null, scroll: null,
};
const object = { id: 2, parentId: 100, class: "QLineEdit", kind: "lineEdit", name: "/.Connection.Text",
  value: "QObject value", visible: true, enabled: true, readOnly: false };
let objects = [object, { ...object, id: 3, name: "Dotless", value: "Dotless value" }];
const nativeCalls = [], workerCalls = [], providerCalls = [];
let nativeFailure = false, workerFailure = false;
const native = { binding, request: async operation => {
  nativeCalls.push(operation);
  if (nativeFailure) return { durationMs: 1, result: { ok: false, code: "synthetic-read-failed", error: "Read failed." } };
  if (operation === "objects") return { durationMs: 1, result: {
    ok: true, complete: true, controllerBound: true, projection: "values", visibleOnly: true,
    windowEnabled: true, modalBlocked: false, objects,
  } };
  assert.equal(operation, "accessibility_snapshot");
  return { durationMs: 1, result: {
    ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: binding.hwnd,
    windowRect: { x: 0, y: 0, w: 1000, h: 500 }, exactMatches: {}, windowEnabled: true, modalBlocked: false,
    nodes: [snapshotNode], stats: { n: 1, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false,
      depthLimited: false, valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 },
  } };
} };
const worker = async (operation, args) => {
  workerCalls.push({ operation, args });
  assert.equal(operation, "get_value");
  return workerFailure ? { ok: false, kind: "not-found", error: "No UIA value." }
    : { ok: true, value: "UIA value", readOnly: false, aufgeloestUeber: "selektor",
      node: { aid: "window.field", rid: snapshotNode.rid, type: "Edit" } };
};
const dependencies = { qtNativeClientFor: async args => { providerCalls.push(args); return native; } };
const execute = createApiExecutor(config, worker, dependencies);
const withoutNative = createApiExecutor(config, worker);
const counters = () => [nativeCalls.length, workerCalls.length, providerCalls.length];
const invalid = [
  { selectorNamespace: "uia", rid: qtRid },
  { selectorNamespace: "uia", rid: "unknown:1" },
  { selectorNamespace: "qt-object", rid: snapshotNode.rid },
  { selectorNamespace: "qt-object", rid: "unknown:1" },
  { selectorNamespace: "qt-object", name: "Synthetic label" },
  { selectorNamespace: "other", aid: "/.Connection.Text" },
  { selectorNamespace: "uia" },
  { selectorNamespace: "uia", aid: "field", contains: true },
];
const api = createSseApiServer({ execute });
const mcp = new McpServer({ name: "get-value-namespace-contract", version: "1.0.0" });
const client = new Client({ name: "get-value-namespace-contract", version: "1.0.0" });
const previousUrl = process.env.SSE_API_URL;
const previousConfig = process.env.SSE_API_CONFIG;
try {
  assert.deepEqual(SSE_MCP_TOOL_SCHEMAS.sse_get_value.shape.selectorNamespace.parse("uia"), "uia");
  for (const args of invalid) {
    assert.throws(() => parseApiOperationArgs("get_value", args));
    const before = counters();
    assert.equal((await execute("get_value", args)).kind, "bad-args");
    assert.deepEqual(counters(), before, "Invalid namespaces must not acquire or dispatch either backend.");
  }
  for (const args of [{ aid: "/.Connection.Text" }, { rid: qtRid }]) {
    const before = counters();
    assert.equal((await withoutNative("get_value", { ...args, selectorNamespace: "qt-object" })).kind, "bad-args");
    assert.deepEqual(counters(), before, "An unavailable explicit Qt backend must not select the UIA worker.");
  }
  for (const args of [{ aid: "Connection.Text" }, { aid: "Window/Dialog/.Connection.Text" },
    { aid: "WrongParent/.Connection.Text" }, { aid: "Dotless" }, { rid: qtRid }]) {
    const before = counters();
    const result = await execute("get_value", args);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(nativeCalls.at(-1), "objects");
    assert.deepEqual(counters(), [before[0] + 1, before[1], before[2] + 1]);
  }
  const legacySnapshot = await execute("get_value", { rid: snapshotNode.rid });
  assert.equal(legacySnapshot.value, "Snapshot value");
  assert.equal(nativeCalls.at(-1), "accessibility_snapshot");
  const plainWorkerBefore = counters();
  assert.equal((await withoutNative("get_value", { aid: "Connection.Text" })).value, "UIA value");
  assert.deepEqual(counters(), [plainWorkerBefore[0], plainWorkerBefore[1] + 1, plainWorkerBefore[2]]);

  for (const args of [{ aid: "field" }, { aid: "Dotless" }, { name: "Synthetic label" }, { rid: snapshotNode.rid }]) {
    const before = counters();
    assert.equal((await execute("get_value", { ...args, selectorNamespace: "uia" })).value, "UIA value");
    assert.deepEqual(counters(), [before[0], before[1] + 1, before[2]], "UIA is the primary route, even with native configuration.");
    assert.equal(workerCalls.at(-1).args.selectorNamespace, "uia");
  }
  for (const args of [{ aid: object.name }, { rid: qtRid }, { aid: object.name, rid: qtRid, name: object.value, type: "Edit" }]) {
    const result = await execute("get_value", { ...args, selectorNamespace: "qt-object" });
    assert.equal(result.value, "QObject value");
    assert.equal(result.node.aid, object.name);
    assert.equal(result.node.rid, qtRid);
  }
  for (const args of [{ aid: "Connection.Text" }, { aid: "Window/Dialog/.Connection.Text" },
    { aid: "WrongParent/.Connection.Text" }, { aid: object.name, name: "Other" },
    { aid: object.name, type: "ComboBox" }, { aid: object.name, rid: qtRid + "0" },
    { rid: qtRid.replace("qt:1234:", "qt:1235:") }]) {
    const before = counters();
    assert.equal((await execute("get_value", { ...args, selectorNamespace: "qt-object" })).kind, "not-found");
    assert.deepEqual(counters(), [before[0] + 1, before[1], before[2] + 1], "A failed QObject selection must never switch backend.");
  }
  const beforeWrongWindow = counters();
  assert.equal((await execute("get_value", { selectorNamespace: "qt-object", aid: object.name, hwnd: 43 })).kind, "stale-window");
  assert.deepEqual(counters(), [beforeWrongWindow[0], beforeWrongWindow[1], beforeWrongWindow[2] + 1]);
  objects.push({ ...object, id: 4 });
  assert.equal((await execute("get_value", { selectorNamespace: "qt-object", aid: object.name })).kind, "ambiguous");
  objects = objects.filter(node => node.id !== 4);
  objects[0] = { ...object, value: "Fresh QObject value" };
  assert.equal((await execute("get_value", { selectorNamespace: "qt-object", rid: qtRid })).value, "Fresh QObject value");
  objects = objects.filter(node => node.id !== 2);
  assert.equal((await execute("get_value", { selectorNamespace: "qt-object", rid: qtRid })).kind, "not-found");
  objects.unshift(object);

  nativeFailure = true;
  const beforeNativeError = counters();
  assert.equal((await execute("get_value", { selectorNamespace: "qt-object", aid: object.name })).kind, "synthetic-read-failed");
  assert.deepEqual(counters(), [beforeNativeError[0] + 1, beforeNativeError[1], beforeNativeError[2] + 1]);
  nativeFailure = false;
  workerFailure = true;
  const beforeWorkerError = counters();
  assert.equal((await execute("get_value", { selectorNamespace: "uia", aid: "field" })).kind, "not-found");
  assert.deepEqual(counters(), [beforeWorkerError[0], beforeWorkerError[1] + 1, beforeWorkerError[2]]);
  workerFailure = false;
  for (const args of [{ selectorNamespace: "uia", aid: "field" },
    { selectorNamespace: "qt-object", rid: snapshotNode.rid }, { selectorNamespace: "qt-object", name: "Label" }]) {
    const before = counters();
    assert.equal((await executeQtNativeOperation("get_value", args, dependencies)).kind, "bad-args");
    assert.equal((await executeQtNativeGetValue(native, args)).kind, "bad-args");
    assert.deepEqual(counters(), before, "Native internal boundaries must reject conflicting namespaces before acquisition or reads.");
  }
  assert.equal((await executeQtNativeOperation("get_value", { selectorNamespace: "qt-object", aid: object.name }, {})).kind, "bad-args");

  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const baseUrl = `http://127.0.0.1:${api.address().port}`;
  process.env.SSE_API_URL = baseUrl;
  delete process.env.SSE_API_CONFIG;
  registerUiTools(createMcpRegistry(mcp));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  const getter = (await client.listTools()).tools.find(tool => tool.name === "sse_get_value");
  assert.deepEqual(getter.inputSchema.properties.selectorNamespace.enum, ["uia", "qt-object"]);
  for (const [args, expected, route] of [
    [{ selectorNamespace: "uia", aid: "field" }, "UIA value", "worker"],
    [{ selectorNamespace: "qt-object", aid: object.name }, "QObject value", "objects"],
    [{ aid: "Connection.Text" }, "QObject value", "objects"],
    [{ rid: snapshotNode.rid }, "Snapshot value", "accessibility_snapshot"],
  ]) {
    const beforeApi = counters();
    const result = (await callApiOperationEnvelope("get_value", args, 5000, { baseUrl })).result;
    assert.equal(result.value, expected);
    assert.deepEqual(counters(), [beforeApi[0] + Number(route !== "worker"), beforeApi[1] + Number(route === "worker"),
      beforeApi[2] + Number(route !== "worker")]);
    const beforeMcp = counters();
    const response = await client.callTool({ name: "sse_get_value", arguments: args });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    assert.equal(response.structuredContent.value, expected);
    assert.deepEqual(counters(), [beforeMcp[0] + Number(route !== "worker"), beforeMcp[1] + Number(route === "worker"),
      beforeMcp[2] + Number(route !== "worker")]);
  }
  for (const args of invalid) {
    const before = counters();
    await assert.rejects(callApiOperationEnvelope("get_value", args, 5000, { baseUrl }), error => error.kind === "bad-args");
    assert.equal((await client.callTool({ name: "sse_get_value", arguments: args })).isError, true);
    assert.deepEqual(counters(), before, "HTTP and MCP validation must reject invalid selectors without backend work.");
  }
  console.log("Getter namespaces: parser, primary routing, legacy names, canonical QObject identity, errors and actual HTTP/MCP passed");
} finally {
  await client.close();
  await mcp.close();
  await new Promise(resolveClose => api.close(resolveClose));
  if (previousUrl === undefined) delete process.env.SSE_API_URL;
  else process.env.SSE_API_URL = previousUrl;
  if (previousConfig === undefined) delete process.env.SSE_API_CONFIG;
  else process.env.SSE_API_CONFIG = previousConfig;
  assert.equal(dirname(resolve(temporary)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  rmSync(temporary, { recursive: true, force: true });
}
