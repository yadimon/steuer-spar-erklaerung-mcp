import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { callApiOperation, readApiDiscovery, readApiHealthz } from "../dist/api-client.js";
import { MAX_OPERATION_TIMEOUT_MS } from "../dist/api-contract.js";

const baseUrl = "http://127.0.0.1:43127";

function failedFetch(code) {
  return async () => {
    const cause = Object.assign(new Error(`${code}: synthetischer Transportfehler`), { code });
    throw new TypeError("fetch failed", { cause });
  };
}

assert(
  MAX_OPERATION_TIMEOUT_MS + 12_000 > 300_000,
  "Die fachliche Maximalfrist samt Cleanup-Fenster muss den Node-Transportfall tatsaechlich erreichen.",
);

for (const code of ["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]) {
  await assert.rejects(
    callApiOperation("health", {}, MAX_OPERATION_TIMEOUT_MS, {
      baseUrl,
      fetchImpl: failedFetch(code),
    }),
    (error) => error?.kind === "timeout" &&
      error.message.includes(code) &&
      /Zustand ist unbekannt/u.test(error.message),
    `${code} muss als zustandsunklare Operations-Zeitueberschreitung gelten.`,
  );
}

await assert.rejects(
  readApiDiscovery({ baseUrl, fetchImpl: failedFetch("UND_ERR_HEADERS_TIMEOUT") }),
  (error) => error?.kind === "timeout" && error.message.includes("UND_ERR_HEADERS_TIMEOUT"),
  "Discovery muss denselben Transporttimeout eindeutig klassifizieren.",
);

await assert.rejects(
  callApiOperation("health", {}, 90_000, {
    baseUrl,
    fetchImpl: failedFetch("ECONNREFUSED"),
  }),
  (error) => error?.kind === "network" && error.operationResponseReceived === false && error.message.includes("ECONNREFUSED"),
  "Ein echter Verbindungsfehler muss network bleiben und seinen sicheren Fehlercode nennen.",
);

let resetOperationReceived = false;
let brokenBodyAttempts = 0;
await assert.rejects(callApiOperation("click", { name: "Synthetic body failure after headers" }, 1_000, {
  baseUrl,
  fetchImpl: async () => {
    brokenBodyAttempts += 1;
    return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("Synthetic response reader failure.")); } }),
      { headers: { "content-type": "application/json" } });
  },
}), error => error?.kind === "transport-unknown" && error.operationResponseReceived === true,
"An unclassified body-read error after received headers cannot claim the endpoint was never reached.");
assert.equal(brokenBodyAttempts, 1, "The client must not replay an operation after response-reader failure.");
const resetServer = createServer((request, response) => {
  request.resume();
  request.once("end", () => {
    resetOperationReceived = true;
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "512",
    });
    response.flushHeaders();
    setImmediate(() => response.socket?.destroy());
  });
});
resetServer.listen(0, "127.0.0.1");
await once(resetServer, "listening");
const resetAddress = resetServer.address();
assert(resetAddress && typeof resetAddress === "object");
const resetBaseUrl = `http://127.0.0.1:${resetAddress.port}`;
await assert.rejects(
  callApiOperation("click", { name: "synthetische Mutation" }, 1_000, { baseUrl: resetBaseUrl }),
  (error) => error?.kind === "transport-unknown" &&
    error.operationResponseReceived === true &&
    error.message.includes("ECONNRESET") &&
    /Zustand ist unbekannt/u.test(error.message),
  "Ein Antwortabbruch nach empfangenem POST muss als zustandsunklar statt als Unerreichbarkeit gelten.",
);
assert.equal(resetOperationReceived, true, "Der Reset-Test muss den POST nachweislich empfangen haben.");
resetServer.close();
await once(resetServer, "close");

await assert.rejects(
  callApiOperation("health", {}, 1_000, { baseUrl: resetBaseUrl }),
  (error) => error?.kind === "network" && error.operationResponseReceived === false && error.message.includes("ECONNREFUSED"),
  "Der Defaulttransport muss einen echten Verbindungsfehler samt direktem Node-Fehlercode melden.",
);

// Each response is sent only after the synthetic operation body was consumed.
// Parser failures have no valid HTTP status; receiving bytes still rules out a
// claim that the endpoint simply could not be reached.
const responseCases = [
  { name: "redirect", response: 302, kind: "protocol", status: 302, received: true, message: /Redirectstatus 302/u },
  { name: "not-modified", response: 304, kind: "protocol", status: 304, received: true, message: /Redirectstatus 304/u },
  { name: "invalid-status", response: 601, kind: "protocol", status: 601, received: true, message: /ungueltigen Status 601/u },
  { name: "bad-header", kind: "transport-unknown", message: /HPE_INVALID_HEADER_TOKEN/u,
    response: "HTTP/1.1 200 OK\r\nBad Header: value\r\nContent-Length: 0\r\n\r\n" },
  { name: "bad-status-line", kind: "transport-unknown", message: /HPE_INVALID_STATUS/u,
    response: "HTTP/1.1 XXX Bad\r\nContent-Length: 0\r\n\r\n" },
  { name: "bad-version", kind: "transport-unknown", message: /HPE_INVALID_VERSION/u,
    response: "HTTP/1.2 200 OK\r\nContent-Length: 0\r\n\r\n" },
  { name: "bad-chunk", kind: "transport-unknown", received: true, message: /ECONNRESET/u,
    response: "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\nZZZ\r\n" },
];
for (const scenario of responseCases) {
  let receivedPosts = 0, followedRequests = 0;
  const responseServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.url === "/must-not-follow") {
      followedRequests += 1;
      response.writeHead(500).end();
      return;
    }
    if (request.method === "POST") {
      receivedPosts += 1;
      assert.equal(request.url, "/v1/operations/click");
      assert.equal(JSON.parse(Buffer.concat(chunks).toString("utf8")).args.name, "synthetic response boundary");
    }
    if (typeof scenario.response === "number") {
      response.writeHead(scenario.response, { location: "/must-not-follow" }).end();
    } else {
      response.socket.end(scenario.response);
    }
  });
  responseServer.listen(0, "127.0.0.1");
  await once(responseServer, "listening");
  const responseAddress = responseServer.address();
  assert(responseAddress && typeof responseAddress === "object");
  const responseUrl = `http://127.0.0.1:${responseAddress.port}`;
  try {
    await assert.rejects(
      callApiOperation("click", { name: "synthetic response boundary" }, 1_000, { baseUrl: responseUrl }),
      error => error?.kind === scenario.kind && scenario.message.test(error.message) &&
        error.httpStatus === scenario.status && error.operationResponseReceived === (scenario.received ?? false),
      scenario.name,
    );
    assert.equal(receivedPosts, 1, `${scenario.name}: received POST must not be replayed.`);
    await assert.rejects(readApiHealthz({ baseUrl: responseUrl }),
      error => error?.kind === "network" && error.operationResponseReceived === false,
      `${scenario.name}: a failed metadata GET must not imply an executed operation.`);
    assert.equal(receivedPosts, 1);
    assert.equal(followedRequests, 0, "Redirect targets must never be followed.");
  } finally {
    responseServer.closeAllConnections();
    await new Promise(resolve => responseServer.close(resolve));
  }
}

process.stdout.write("API-Client-Transport: Timeouts, Reset, abgewiesene Antworten, Parserfehler und Verbindungsfehler klassifiziert\n");
