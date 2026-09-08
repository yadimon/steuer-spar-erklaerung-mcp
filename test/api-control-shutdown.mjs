import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createSseApiServer } from "../dist/api-server.js";
import { requestApiShutdown } from "../dist/api-control-client.js";
import { listenOnFetchablePort } from "./fetchable-port.mjs";

const instanceId = "44444444-4444-4444-8444-444444444444";
const otherId = "55555555-5555-4555-8555-555555555555";
const path = "/v1/control/shutdown";
const headers = { "content-type": "application/json", "x-sse-api-instance-id": instanceId };
const body = { confirm: true, instanceId };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const started = deferred();
const release = deferred();
let executions = 0;
let shutdownRequests = 0;
let operationSignal;
const server = createSseApiServer({
  instanceId,
  execute: async (_operation, _args, _timeout, signal) => {
    executions += 1;
    operationSignal = signal;
    started.resolve();
    await release.promise;
    return { ok: true, windows: [] };
  },
  requestShutdown: () => { shutdownRequests += 1; },
});
const port = await listenOnFetchablePort(server);
const baseUrl = `http://127.0.0.1:${port}`;
async function post(value, requestHeaders = headers) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST", headers: requestHeaders, body: JSON.stringify(value),
  });
  return { status: response.status, payload: await response.json() };
}
async function close(target) {
  target.closeAllConnections();
  await new Promise((done) => target.close(done));
}
try {
  assert.equal((await post(body, { "content-type": "application/json" })).status, 409);
  assert.equal((await post(body, { ...headers, "x-sse-api-instance-id": otherId })).status, 409);
  assert.equal((await post({ ...body, instanceId: otherId })).status, 409);
  assert.equal((await post({ ...body, confirm: false })).status, 400);
  assert.equal((await post({ ...body, force: true })).status, 400);
  assert.equal((await post(body, { ...headers, origin: "https://example.invalid" })).status, 403);
  assert.equal((await post(body, { ...headers, "content-type": "text/plain" })).status, 415);
  const get = await fetch(`${baseUrl}${path}`);
  assert.equal(get.status, 405);
  await get.arrayBuffer();
  assert.equal(shutdownRequests, 0, "Rejected requests must not stop the runtime.");

  const active = fetch(`${baseUrl}/v1/operations/windows`, {
    method: "POST", headers, body: JSON.stringify({ args: {} }),
  });
  await started.promise;
  const busy = await post(body);
  assert.equal(busy.status, 409);
  assert.equal(busy.payload.error.code, "busy");
  assert.equal(busy.payload.inFlight.operation, "windows");
  assert.equal(operationSignal.aborted, false, "Shutdown must not abort an active operation.");
  assert.equal(shutdownRequests, 0);
  release.resolve();
  const finished = await active;
  assert.equal(finished.status, 200);
  await finished.arrayBuffer();

  // This request has reached the real server before shutdown, but its body
  // finishes afterwards. It must not pass the acceptance lock after its await.
  const arrived = deferred();
  server.once("request", () => arrived.resolve());
  const delayedBody = JSON.stringify({ args: {} });
  const delayedResult = deferred();
  const delayed = httpRequest(`${baseUrl}/v1/operations/windows`, {
    method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(delayedBody) },
  }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => delayedResult.resolve({ status: response.statusCode, payload: JSON.parse(Buffer.concat(chunks)) }));
  });
  delayed.write(delayedBody.slice(0, 1));
  await arrived.promise;
  const accepted = await requestApiShutdown(body, { baseUrl, expectedInstanceId: instanceId });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.processId, process.pid);
  assert.equal(accepted.processExited, false, "Acceptance is not proof of process exit.");
  delayed.end(delayedBody.slice(1));
  const rejectedAfterRead = await delayedResult.promise;
  assert.equal(rejectedAfterRead.status, 409);
  assert.equal(rejectedAfterRead.payload.error.code, "api-stopping");
  const repeated = await post(body);
  assert.equal(repeated.status, 409);
  assert.equal(repeated.payload.error.code, "api-stopping");
  await nextTurn();
  assert.equal(shutdownRequests, 1, "Only one shutdown callback may be accepted.");
  assert.equal(executions, 1, "No pending or new operation may execute after acceptance.");
} finally {
  release.resolve();
  await close(server);
}

let lostResponseStops = 0;
const lossServer = createSseApiServer({
  instanceId, execute: async () => { assert.fail("Control must not invoke a worker."); },
  requestShutdown: () => { lostResponseStops += 1; },
});
const lossPort = await listenOnFetchablePort(lossServer);
try {
  let posts = 0;
  await assert.rejects(requestApiShutdown(body, {
    baseUrl: `http://127.0.0.1:${lossPort}`, expectedInstanceId: instanceId,
    fetchImpl: async (...args) => {
      posts += 1;
      const response = await fetch(...args);
      await response.arrayBuffer();
      throw new Error("Synthetic response loss after the real server accepted shutdown.");
    },
  }), (error) => error.kind === "shutdown-unknown");
  await nextTurn();
  assert.equal(posts, 1, "An uncertain shutdown request must never be replayed.");
  assert.equal(lostResponseStops, 1, "Lost response must not undo an accepted shutdown.");
} finally {
  await close(lossServer);
}
console.log("api-control-shutdown: PASS");
