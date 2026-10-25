import assert from "node:assert/strict";
import { once } from "node:events";
import { createMcpRegistry } from "../dist/mcp-registry.js";
import { createSseApiServer } from "../dist/api-server.js";
import { ApiClientError } from "../dist/api-client-error.js";
import { callApiOperation } from "../dist/api-client.js";
import { MAX_API_ARGUMENT_STRING_BYTES, SSE_MCP_TOOL_SCHEMAS } from "../dist/operation-catalog.js";

let registered;
const fakeServer = {
  registerTool(name, config, callback) {
    registered = { name, config, callback };
    return { name };
  },
};
const registry = createMcpRegistry(fakeServer);
let callbackCalls = 0;
registry.registerStrictTool(
  "sse_find",
  {
    description: "Synthetischer Registry-Vertrag",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_find.shape,
  },
  async () => {
    callbackCalls += 1;
    throw new Error(
      "Interner Fehler bei file:///C:/Privat/steuerfall.ESt2025:42, C:\\Privat\\steuerfall.ESt2025 " +
      "und file:///home/person/steuerfall.ESt2025 sowie /home/person/steuerfall.ESt2025",
    );
  },
);

assert.equal(registered.name, "sse_find");
const extra = { signal: new AbortController().signal };
const unexpected = await registered.callback({ name: "Einkommen" }, extra);
const unexpectedText = unexpected.content.map((entry) => entry.text ?? "").join("\n");
assert.equal(unexpected.isError, true);
assert.equal(callbackCalls, 1);
assert(!unexpectedText.includes("Privat") && !unexpectedText.includes("file:///") &&
  !unexpectedText.includes("/home/person") && unexpectedText.includes("Lokaler PC-Pfad"),
  "Unerwartete Handlerfehler muessen an der MCP-Grenze redigiert werden.");

const oversized = await registered.callback({ name: "x".repeat(MAX_API_ARGUMENT_STRING_BYTES + 1) }, extra);
const oversizedText = oversized.content.map((entry) => entry.text ?? "").join("\n");
assert.equal(oversized.isError, true);
assert.match(oversizedText, /Ungueltige MCP-Argumente/);
assert.equal(callbackCalls, 1, "Budgetfehler duerfen den Tool-Handler nicht erreichen.");

const missingSelector = await registered.callback({}, extra);
const missingSelectorText = missingSelector.content.map((entry) => entry.text ?? "").join("\n");
assert.equal(missingSelector.isError, true);
assert.match(missingSelectorText, /name, aid, type/);
assert.equal(callbackCalls, 1, "Semantisch ungueltige MCP-Argumente duerfen den Tool-Handler nicht erreichen.");

process.stdout.write("MCP-Registry: globale Handlerfehler, Pfadredaktion und Argumentbudget bestanden\n");

for (const tool of ["sse_change_field", "sse_change_known_field", "sse_fill_fields"]) {
  const labels = SSE_MCP_TOOL_SCHEMAS[tool].shape.resultLabels;
  for (const blank of ["", " ", "\t\n"]) {
    assert.equal(labels.safeParse([blank]).success, false, `${tool} accepted a blank result label.`);
  }
  assert.equal(labels.safeParse(undefined).success, true);
  assert.equal(labels.safeParse([]).success, true);
  assert.deepEqual(labels.parse(["New tax"]), ["New tax"]);
}

// Exercise the real registry callback and HTTP boundary after a committed
// synthetic write. No product process or real case is involved.
async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Synthetic registry barrier timed out.")), 5000);
    })]);
  } finally { clearTimeout(timer); }
}
let mode = "shape", posts = 0, commits = 0, entered, observedAbort, readEntered, heldRead;
const api = createSseApiServer({ execute: async (_operation, _args, _timeout, signal) => {
  if (mode === "hold-read" && _operation === "health") { readEntered(); await heldRead; return { ok: true }; }
  commits += 1;
  if (mode === "invalid-result") return { ok: "invalid synthetic result after commit" };
  if (mode === "abort") {
    entered();
    await new Promise(resolve => signal.addEventListener("abort", () => { observedAbort(); resolve(); }, { once: true }));
  }
  return { ok: true };
} });
api.on("request", request => { if (request.method === "POST") posts += 1; });
api.listen(0, "127.0.0.1");
await once(api, "listening");
const originalUrl = process.env.SSE_API_URL;
const originalConfig = process.env.SSE_API_CONFIG;
delete process.env.SSE_API_CONFIG;
process.env.SSE_API_URL = `http://127.0.0.1:${api.address().port}`;
try {
  let callback, shaperCalls = 0;
  const boundary = createMcpRegistry({ registerTool(_name, _config, handler) { callback = handler; } });
  boundary.registerShapedApiTool("sse_click", { description: "Synthetic write and failing MCP shaper" },
    () => { shaperCalls += 1; throw new TypeError("Synthetic post-response shaping failure."); });
  const shaped = await callback({ name: "Synthetic committed write" }, { signal: new AbortController().signal });
  assert.equal(shaped.isError, true);
  assert.equal(shaperCalls, 1, "The regression must reach the shaper after a valid HTTP result.");
  assert.equal(shaped.structuredContent?.kind, "protocol");
  assert.match(shaped.structuredContent?.error, /MCP-Aufbereitung fehlgeschlagen/u);
  assert.equal(shaped.structuredContent?.outcomeUnknown, true, "A failed shaper cannot turn a completed write into a known rejection.");
  assert.equal(shaped.structuredContent?.reconciliationRequired, true);
  assert.equal(shaped.structuredContent?.retryable, false);
  assert.match(shaped.structuredContent?.hint, /keine automatische Schreibwiederholung/u);
  assert.equal(posts, 1); assert.equal(commits, 1);

  mode = "abort";
  boundary.registerApiTool("sse_click", { description: "Synthetic write interrupted after dispatch" });
  const started = new Promise(resolve => { entered = resolve; });
  const aborted = new Promise(resolve => { observedAbort = resolve; });
  const controller = new AbortController();
  const pending = callback({ name: "Synthetic interrupted write" }, { signal: controller.signal });
  let timer;
  try {
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic POST barrier timed out.")), 5000); });
    await Promise.race([started, deadline]);
    controller.abort();
    const result = await pending;
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.kind, "aborted");
    assert.equal(result.structuredContent?.outcomeUnknown, true);
    assert.equal(result.structuredContent?.reconciliationRequired, true);
    assert.equal(result.structuredContent?.retryable, false);
    await Promise.race([aborted, deadline]);
    assert.equal(posts, 2); assert.equal(commits, 2, "Cancellation must not replay a committed POST.");
  } finally { clearTimeout(timer); controller.abort(); await pending; }

  mode = "strict";
  for (const failure of [
    { error: new TypeError("Synthetic strict callback failed after its write."), kind: "protocol", message: /MCP-Aufbereitung fehlgeschlagen/u },
    { error: new ApiClientError("Synthetic later probe failed.", "not-dispatched"), kind: "not-dispatched", message: /Synthetic later probe/u },
    { error: new ApiClientError("Synthetic later admission rejected.", "busy", 409), kind: "busy", message: /Synthetic later admission/u },
  ]) {
    const before = { posts, commits };
    boundary.registerStrictTool("sse_click", { inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_click.shape }, async args => {
      await boundary.callApiOperation("click", args);
      throw failure.error;
    });
    const strict = await callback({ name: "Synthetic strict committed write" }, { signal: new AbortController().signal });
    assert.equal(strict.isError, true);
    assert.equal(strict.structuredContent?.kind, failure.kind);
    assert.match(strict.structuredContent?.error, failure.message);
    assert.match(strict.structuredContent?.hint, /keine automatische Schreibwiederholung/u);
    assert.equal(strict.structuredContent?.outcomeUnknown, true, "A custom callback must preserve the same post-write uncertainty.");
    assert.equal(strict.structuredContent?.reconciliationRequired, true);
    assert.equal(strict.structuredContent?.retryable, false);
    assert.equal(posts - before.posts, 1); assert.equal(commits - before.commits, 1, "A strict callback must not replay its committed POST.");
  }
  const beforeUnstarted = { posts, commits };
  boundary.registerStrictTool("sse_click", { inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_click.shape }, async () => {
    throw new ApiClientError("Synthetic probe failed before this request's write.", "not-dispatched");
  });
  const unstarted = await callback({ name: "Synthetic next independent request" }, { signal: new AbortController().signal });
  assert.equal(unstarted.structuredContent?.kind, "not-dispatched");
  assert.equal(unstarted.structuredContent?.outcomeUnknown, undefined, "Prior requests must not taint a fresh unstarted request.");
  assert.equal(posts, beforeUnstarted.posts); assert.equal(commits, beforeUnstarted.commits);

  mode = "invalid-result";
  const beforeSwallowed = { posts, commits };
  let swallowed = 0;
  boundary.registerStrictTool("sse_click", { inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_click.shape }, async args => {
    try { await boundary.callApiOperation("click", args); }
    catch (error) {
      swallowed += 1;
      assert.equal(error.kind, "invalid-operation-result");
      assert.equal(error.operationResponseReceived, true);
    }
    throw new TypeError("Synthetic later failure after an uncertain write.");
  });
  const swallowedResult = await callback({ name: "Synthetic uncertain committed write" }, { signal: new AbortController().signal });
  assert.equal(swallowed, 1, "The regression must swallow the original received server error.");
  assert.equal(swallowedResult.structuredContent?.outcomeUnknown, true, "Later errors must retain uncertainty from a failed write.");
  assert.equal(swallowedResult.structuredContent?.reconciliationRequired, true);
  assert.equal(swallowedResult.structuredContent?.retryable, false);
  assert.equal(posts - beforeSwallowed.posts, 1); assert.equal(commits - beforeSwallowed.commits, 1);

  mode = "strict";
  const beforeOverlap = { posts, commits };
  let writeEntered, releaseWrite;
  const writeReady = new Promise(resolve => { writeEntered = resolve; });
  const finishWrite = new Promise(resolve => { releaseWrite = resolve; });
  boundary.registerStrictTool("sse_click", { inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_click.shape }, async args => {
    if (args.name === "Synthetic concurrent B") throw new ApiClientError("Synthetic independent probe failed.", "not-dispatched");
    await boundary.callApiOperation("click", args);
    writeEntered(); await finishWrite;
    throw new TypeError("Synthetic concurrent A failed after its write.");
  });
  const requestA = callback({ name: "Synthetic concurrent A" }, { signal: new AbortController().signal });
  try {
    await within(writeReady);
    const requestB = await callback({ name: "Synthetic concurrent B" }, { signal: new AbortController().signal });
    assert.equal(requestB.structuredContent?.kind, "not-dispatched");
    assert.equal(requestB.structuredContent?.outcomeUnknown, undefined, "Overlapping requests must not share write state.");
    assert.equal(posts - beforeOverlap.posts, 1); assert.equal(commits - beforeOverlap.commits, 1);
  } finally { releaseWrite(); await requestA; }
  const finishedA = await requestA;
  assert.equal(finishedA.structuredContent?.kind, "protocol");
  assert.equal(finishedA.structuredContent?.outcomeUnknown, true, "The overlapping independent request must not clear A's write state.");
  assert.equal(finishedA.structuredContent?.retryable, false);
  assert.equal(posts - beforeOverlap.posts, 1); assert.equal(commits - beforeOverlap.commits, 1);

  mode = "hold-read";
  let releaseRead, holderError;
  heldRead = new Promise(resolve => { releaseRead = resolve; });
  const readReady = new Promise(resolve => { readEntered = resolve; });
  const holder = callApiOperation("health", {}, 5000, { baseUrl: process.env.SSE_API_URL })
    .catch(error => { holderError = error; });
  let rejected = 0;
  try {
    await within(Promise.race([readReady, holder.then(() => { throw new Error("Read holder ended before its barrier."); })]));
    const beforeRejected = { posts, commits };
    boundary.registerStrictTool("sse_click", { inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_click.shape }, async args => {
      try { await boundary.callApiOperation("click", args); }
      catch (error) { rejected += 1; assert.equal(error.kind, "busy"); assert.equal(error.httpStatus, 409); }
      throw new TypeError("Synthetic later failure after a known rejection.");
    });
    const result = await callback({ name: "Synthetic rejected write" }, { signal: new AbortController().signal });
    assert.equal(rejected, 1);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.outcomeUnknown, undefined, "A known HTTP409 rejection must not taint later errors.");
    assert.equal(posts - beforeRejected.posts, 1); assert.equal(commits, beforeRejected.commits, "A rejected write must never execute.");
  } finally { releaseRead(); await holder; }
  assert.equal(holderError, undefined);
} finally {
  if (originalUrl === undefined) delete process.env.SSE_API_URL;
  else process.env.SSE_API_URL = originalUrl;
  if (originalConfig !== undefined) process.env.SSE_API_CONFIG = originalConfig;
  api.closeAllConnections();
  await new Promise(resolve => api.close(resolve));
}
process.stdout.write("MCP-Registry: Nachbearbeitungsfehler und Abbruch nach genau einem HTTP-Schreibauftrag bleiben ungewiss\n");
for (const scenario of [
  { kind: "response-too-large", status: 200, received: true, unknown: true },
  { kind: "unexpected-reader", received: true, unknown: true },
  { kind: "busy", status: 409, received: true },
  { kind: "api-instance-mismatch", status: 409, received: true },
  { kind: "protocol", status: 409, received: true, unknown: true },
  { kind: "network", received: false },
]) {
  const response = registry.caughtErrorResult("click", new ApiClientError("Synthetic phase boundary", scenario.kind, scenario.status, scenario.received));
  assert.equal(response.structuredContent.kind, scenario.kind);
  assert.equal(response.structuredContent.outcomeUnknown, scenario.unknown);
  assert.equal(response.structuredContent.reconciliationRequired, scenario.unknown);
  assert.equal(response.structuredContent.retryable, scenario.unknown ? false : undefined);
}
