import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { setTimeout as delay } from "node:timers/promises";
import { callApiOperation, readApiDiscovery } from "../dist/api-client.js";
import { SSE_API_DISCOVERY } from "../dist/api-discovery.js";

const token = "body-abort-token-with-at-least-24-characters";
const baseUrl = "http://127.0.0.1:43127";

function delayedJsonFetch(payload) {
  let markHeadersDelivered;
  let markBodyAbortObserved;
  const headersDelivered = new Promise((resolve) => { markHeadersDelivered = resolve; });
  const bodyAbortObserved = new Promise((resolve) => { markBodyAbortObserved = resolve; });

  const fetchImpl = async (_url, init) => {
    const signal = init.signal;
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const stream = new ReadableStream({
      start(controller) {
        const finish = () => {
          signal.removeEventListener("abort", abort);
          controller.enqueue(bytes);
          controller.close();
        };
        const timer = setTimeout(finish, 250);
        const abort = () => {
          clearTimeout(timer);
          markBodyAbortObserved();
          controller.error(signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      },
    });
    markHeadersDelivered();
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetchImpl, headersDelivered, bodyAbortObserved };
}

async function assertAbortAfterHeaders(action, label) {
  const controller = new AbortController();
  const transport = action(controller.signal);
  await transport.headersDelivered;
  // Der Fetch-Promise muss sich bereits aufgeloest haben. So prueft der Test
  // nicht den vorhandenen Header-Abbruch, sondern gezielt den laufenden Body.
  await waitForImmediate();
  controller.abort(new Error(`${label}: synthetischer Aufruferabbruch`));

  await assert.rejects(transport.pending, (error) => error?.kind === "aborted", label);
  await transport.bodyAbortObserved;
}

await assertAbortAfterHeaders((signal) => {
  const transport = delayedJsonFetch({
    apiVersion: "v1",
    requestId: randomUUID(),
    operation: "health",
    durationMs: 0,
    result: { ok: true, running: false },
  });
  return {
    ...transport,
    pending: callApiOperation("health", {}, 1_000, {
      baseUrl,
      token,
      signal,
      fetchImpl: transport.fetchImpl,
    }),
  };
}, "Operationsantwort muss nach Headern abbrechbar bleiben");

await assertAbortAfterHeaders((signal) => {
  const transport = delayedJsonFetch(SSE_API_DISCOVERY);
  return {
    ...transport,
    pending: readApiDiscovery({ baseUrl, token, signal, fetchImpl: transport.fetchImpl }),
  };
}, "Discovery-Antwort muss nach Headern abbrechbar bleiben");

let streamTimer;
let markProtocolSocketClosed;
const protocolSocketClosed = new Promise((resolve) => { markProtocolSocketClosed = resolve; });
const wrongContentTypeServer = createServer((request, response) => {
  request.resume();
  request.once("end", () => {
    response.once("close", () => {
      clearInterval(streamTimer);
      markProtocolSocketClosed();
    });
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-length": String(64 * 1024 * 1024),
    });
    response.flushHeaders();
    streamTimer = setInterval(() => response.write(Buffer.alloc(16 * 1024)), 5);
  });
});
wrongContentTypeServer.listen(0, "127.0.0.1");
await once(wrongContentTypeServer, "listening");
const wrongContentTypeAddress = wrongContentTypeServer.address();
assert(wrongContentTypeAddress && typeof wrongContentTypeAddress === "object");
const wrongContentTypeBaseUrl = `http://127.0.0.1:${wrongContentTypeAddress.port}`;
await assert.rejects(
  callApiOperation("health", {}, 1_000, { baseUrl: wrongContentTypeBaseUrl, token }),
  (error) => error?.kind === "protocol" && /Content-Type application\/json/u.test(error.message),
  "Falscher Content-Type muss ein Protokollfehler bleiben.",
);
const protocolSocketClosedQuickly = await Promise.race([
  protocolSocketClosed.then(() => true),
  delay(500, false),
]);
clearInterval(streamTimer);
wrongContentTypeServer.closeAllConnections();
wrongContentTypeServer.close();
await once(wrongContentTypeServer, "close");
assert.equal(
  protocolSocketClosedQuickly,
  true,
  "Der Client muss einen nicht konsumierten Nicht-JSON-Body zeitnah abbrechen.",
);

process.stdout.write("API-Client-Body: Body-Abbruch und Nicht-JSON-Socket-Cancel bestanden\n");
