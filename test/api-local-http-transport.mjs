import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { callApiOperation, readApiDiscovery } from "../dist/api-client.js";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { createSseApiServer } from "../dist/api-server.js";
import { localHttpFetch } from "../dist/local-http-transport.js";

const token = "local-http-transport-token-at-least-24-characters";
const server = createSseApiServer({
  config: { host: "127.0.0.1", port: 1, token },
  execute: async () => ({ ok: true, running: false }),
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let globalFetchCalls = 0;
globalThis.fetch = async () => {
  globalFetchCalls += 1;
  throw new Error("Globales fetch darf nicht der produktive SSE-Transport sein.");
};
try {
  const result = await callApiOperation("health", {}, 1_000, { baseUrl, token });
  assert.equal(result.ok, true);
  const discovery = await readApiDiscovery({ baseUrl, token });
  assert.deepEqual(discovery.operations, [...SSE_API_OPERATIONS]);
  assert.equal(globalFetchCalls, 0, "API-Client verwendete weiterhin globales fetch.");
} finally {
  globalThis.fetch = originalFetch;
  server.close();
  await once(server, "close");
}

let markDelayedClosed;
const delayedClosed = new Promise((resolve) => { markDelayedClosed = resolve; });
const rawServer = createHttpServer(async (request, response) => {
  if (request.url === "/echo") {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const payload = JSON.stringify({ authorization: request.headers.authorization, body });
    response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
    response.end(payload);
    return;
  }
  if (request.url === "/redirect") {
    response.writeHead(302, { location: "/echo" });
    response.end();
    return;
  }
  if (request.url === "/delayed-body") {
    const payload = JSON.stringify({ ok: true });
    const timer = setTimeout(() => {
      if (!response.destroyed) response.end(payload);
    }, 250);
    response.once("close", () => {
      clearTimeout(timer);
      markDelayedClosed();
    });
    response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
    response.flushHeaders();
    return;
  }
  const nullBodyStatus = /^\/status-(204|205|304)$/u.exec(request.url ?? "");
  if (nullBodyStatus) {
    response.writeHead(Number(nullBodyStatus[1]));
    response.end();
    return;
  }
  response.writeHead(404).end();
});
rawServer.listen(0, "127.0.0.1");
await once(rawServer, "listening");
const rawAddress = rawServer.address();
assert(rawAddress && typeof rawAddress === "object");
const rawBaseUrl = `http://127.0.0.1:${rawAddress.port}`;
try {
  const echo = await localHttpFetch(`${rawBaseUrl}/echo`, {
    method: "POST",
    headers: { authorization: "Bearer transport-secret", "content-type": "application/json" },
    body: '{"probe":true}',
    redirect: "error",
  });
  assert.equal(echo.status, 200);
  assert.deepEqual(await echo.json(), {
    authorization: "Bearer transport-secret",
    body: '{"probe":true}',
  });

  await assert.rejects(
    localHttpFetch(`${rawBaseUrl}/redirect`, { redirect: "error" }),
    /verweigert Redirectstatus 302/u,
  );
  await assert.rejects(localHttpFetch("http://192.0.2.10:43127/"), /ausschliesslich fuer Loopback/u);
  await assert.rejects(localHttpFetch(`http://user:secret@127.0.0.1:${rawAddress.port}/echo`), /keine URL-Zugangsdaten/u);
  await assert.rejects(localHttpFetch(`${rawBaseUrl}/echo`, { method: "DELETE" }), /nur GET und POST/u);
  await assert.rejects(
    localHttpFetch(`${rawBaseUrl}/echo`, { method: "POST", body: Buffer.from("nicht erlaubt") }),
    /nur UTF-8-String-Bodies/u,
  );

  for (const status of [204, 205, 304]) {
    const nullBody = await localHttpFetch(`${rawBaseUrl}/status-${status}`);
    assert.equal(nullBody.status, status);
    assert.equal(nullBody.body, null, `HTTP ${status} darf keinen synthetischen Response-Body erhalten.`);
    assert.equal(await nullBody.text(), "");
  }

  const controller = new AbortController();
  const delayed = await localHttpFetch(`${rawBaseUrl}/delayed-body`, { signal: controller.signal });
  const pendingBody = delayed.text();
  controller.abort(new Error("synthetischer Body-Abbruch"));
  await assert.rejects(pendingBody);
  await delayedClosed;
} finally {
  rawServer.close();
  await once(rawServer, "close");
}

process.stdout.write(
  "API-Loopback-Transport: Defaultpfad, POST, Grenzen, Nullbody, Redirect und Body-Abbruch bestanden\n",
);
