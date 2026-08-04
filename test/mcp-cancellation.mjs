import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const token = "mcp-cancellation-token-with-24-characters";
let requestCount = 0;
let resolveFirstStarted;
let resolveFirstClosed;
const firstStarted = new Promise((resolve) => { resolveFirstStarted = resolve; });
const firstClosed = new Promise((resolve) => { resolveFirstClosed = resolve; });

async function waitForWithin(promise, timeoutMs, message) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const api = createServer(async (request, response) => {
  for await (const _chunk of request) {
    // Consume the complete request before deliberately holding the response.
  }
  requestCount += 1;
  if (requestCount === 1) {
    response.once("close", resolveFirstClosed);
    resolveFirstStarted();
    return;
  }
  const envelope = {
    apiVersion: "v1",
    requestId: randomUUID(),
    operation: "health",
    durationMs: 0,
    result: { ok: true, running: false, windows: [] },
  };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(envelope));
});

api.listen(0, "127.0.0.1");
await once(api, "listening");
const address = api.address();
assert(address && typeof address === "object");
const here = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: {
    ...process.env,
    SSE_API_URL: `http://127.0.0.1:${address.port}`,
    SSE_API_TOKEN: token,
  },
});
const client = new Client({ name: "sse-mcp-cancellation", version: "1.0.0" });

try {
  await client.connect(transport);
  const controller = new AbortController();
  const cancelled = client.callTool(
    { name: "sse_health", arguments: {} },
    undefined,
    { signal: controller.signal, timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  await waitForWithin(firstStarted, 5_000, "MCP-Anfrage erreichte die API nicht");
  controller.abort();
  await assert.rejects(cancelled, /abort/i);
  await waitForWithin(firstClosed, 5_000, "MCP-Abbruch schloss die API-Anfrage nicht");

  const recovered = await client.callTool(
    { name: "sse_health", arguments: {} },
    undefined,
    { timeout: 2_000, maxTotalTimeout: 2_000 },
  );
  assert.notEqual(recovered.isError, true);
  assert.equal(requestCount, 2);
  process.stdout.write("MCP-Abbruch: HTTP-Auftrag beendet und Folgeaufruf erfolgreich\n");
} finally {
  await client.close();
  await new Promise((resolve, reject) => api.close((error) => (error ? reject(error) : resolve())));
}
