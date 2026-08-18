import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { callApiOperation, readApiDiscovery } from "../dist/api-client.js";
import { MAX_OPERATION_TIMEOUT_MS } from "../dist/api-contract.js";

const token = "transport-timeout-token-at-least-24-characters";
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
      token,
      fetchImpl: failedFetch(code),
    }),
    (error) => error?.kind === "timeout" &&
      error.message.includes(code) &&
      /Zustand ist unbekannt/u.test(error.message),
    `${code} muss als zustandsunklare Operations-Zeitueberschreitung gelten.`,
  );
}

await assert.rejects(
  readApiDiscovery({ baseUrl, token, fetchImpl: failedFetch("UND_ERR_HEADERS_TIMEOUT") }),
  (error) => error?.kind === "timeout" && error.message.includes("UND_ERR_HEADERS_TIMEOUT"),
  "Discovery muss denselben Transporttimeout eindeutig klassifizieren.",
);

await assert.rejects(
  callApiOperation("health", {}, 90_000, {
    baseUrl,
    token,
    fetchImpl: failedFetch("ECONNREFUSED"),
  }),
  (error) => error?.kind === "network" && error.message.includes("ECONNREFUSED"),
  "Ein echter Verbindungsfehler muss network bleiben und seinen sicheren Fehlercode nennen.",
);

let resetOperationReceived = false;
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
  callApiOperation("click", { name: "synthetische Mutation" }, 1_000, { baseUrl: resetBaseUrl, token }),
  (error) => error?.kind === "transport-unknown" &&
    error.message.includes("ECONNRESET") &&
    /Zustand ist unbekannt/u.test(error.message),
  "Ein Antwortabbruch nach empfangenem POST muss als zustandsunklar statt als Unerreichbarkeit gelten.",
);
assert.equal(resetOperationReceived, true, "Der Reset-Test muss den POST nachweislich empfangen haben.");
resetServer.close();
await once(resetServer, "close");

await assert.rejects(
  callApiOperation("health", {}, 1_000, { baseUrl: resetBaseUrl, token }),
  (error) => error?.kind === "network" && error.message.includes("ECONNREFUSED"),
  "Der Defaulttransport muss einen echten Verbindungsfehler samt direktem Node-Fehlercode melden.",
);

process.stdout.write("API-Client-Transport: Timeouts, Reset nach POST und Verbindungsfehler eindeutig klassifiziert\n");
