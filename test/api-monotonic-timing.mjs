import assert from "node:assert/strict";
import { once } from "node:events";
import { promisify } from "node:util";
import { createSseApiServer } from "../dist/api-server.js";
import { localHttpFetch } from "../dist/local-http-transport.js";

const wallNow = Date.now;
const shift = 2 * 24 * 60 * 60 * 1000;
const assertElapsed = (value) => {
  assert(Number.isInteger(value) && value >= 0 && value < shift / 2,
    "Elapsed API timing must remain valid across a wall-clock correction.");
};

// Only the JavaScript wall clock changes. No system clock or product process is touched.
for (const adjustment of [-shift, shift]) {
  let release, markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const logs = [];
  const before = wallNow();
  const server = createSseApiServer({
    log: (record) => logs.push(record),
    execute: async () => {
      Date.now = () => wallNow() + adjustment;
      markStarted();
      await gate;
      return { ok: true, running: false };
    },
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = () => localHttpFetch(`${url}/v1/operations/health`, {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"args":{}}',
  });
  const pending = post();
  try {
    await started;
    const health = await (await localHttpFetch(`${url}/healthz`, { method: "GET" })).json();
    assertElapsed(health.inFlight.elapsedMs);
    assert.deepEqual(Object.keys(health.inFlight).sort(), ["elapsedMs", "operation", "requestId", "startedAt"]);
    assert(health.inFlight.startedAt >= before && health.inFlight.startedAt <= wallNow(),
      "startedAt must remain an epoch timestamp recorded before the correction.");
    const busy = await post();
    assert.equal(busy.status, 409);
    assertElapsed((await busy.json()).inFlight.elapsedMs);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assertElapsed(envelope.durationMs);
    assert.match(envelope.requestId, /^[a-f0-9-]{36}$/u);
    assert.equal(envelope.result.ok, true);
    assertElapsed(logs.find((record) => record.event === "operation").durationMs);
  } finally {
    Date.now = wallNow;
    release();
    await pending;
    await promisify(server.close).call(server);
  }
}

const failureLogs = [];
const failureServer = createSseApiServer({
  log: (record) => failureLogs.push(record),
  execute: async () => {
    Date.now = () => wallNow() - shift;
    throw new Error("Synthetic executor failure after a clock correction");
  },
});
const failureListening = once(failureServer, "listening");
failureServer.listen(0, "127.0.0.1");
await failureListening;
try {
  const response = await localHttpFetch(`http://127.0.0.1:${failureServer.address().port}/v1/operations/health`, {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"args":{}}',
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "worker-failed");
  assertElapsed(failureLogs.find((record) => record.event === "operation-error").durationMs);
} finally {
  Date.now = wallNow;
  await promisify(failureServer.close).call(failureServer);
}
console.log("api-monotonic-timing: PASS");
