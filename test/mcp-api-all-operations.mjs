import assert from "node:assert/strict";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createSseApiServer } from "../dist/api-server.js";
import { SSE_MCP_TOOL_OPERATIONS } from "../dist/operation-catalog.js";
import { sampleJsonSchema } from "./json-schema-samples.mjs";

const expectedToolCount = Object.keys(SSE_MCP_TOOL_OPERATIONS).length;
const calls = [];
const api = createSseApiServer({
  execute: async (operation, args) => {
    calls.push({ operation, args });
    return {
      ok: true,
      operation,
      args,
      shot: { path: "C:\\Synthetisch\\kontrolle.png", w: 100, h: 50 },
      windows: [],
      dialogs: [],
      files: [],
      cases: [],
      rows: [],
      fields: [],
      items: [],
      options: [],
      results: [],
      pages: [],
      fragenWarnungen: [],
      tippsZusatzinfos: [],
      sonstige: [],
      aufgeklappt: [],
      text: "Synthetischer lokaler Pfad C:\\Privat\\beleg.txt",
    };
  },
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
  },
});
const client = new Client({ name: "sse-mcp-api-all", version: "1.0.0" });

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, expectedToolCount);
  for (const tool of tools) {
    const args = sampleJsonSchema(tool.inputSchema, tool.name);
    const before = calls.length;
    const result = await client.callTool(
      { name: tool.name, arguments: args },
      undefined,
      { timeout: 10_000, maxTotalTimeout: 10_000 },
    );
    const text = result.content?.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n") ?? "";
    assert.notEqual(result.isError, true, `${tool.name}: ${text}`);
    assert.equal(calls.length, before + 1, `${tool.name} erreichte den API-Executor nicht genau einmal.`);
    assert.equal(calls.at(-1).operation, SSE_MCP_TOOL_OPERATIONS[tool.name]);
    assert(!text.includes("C:\\Privat") && !text.includes("C:\\Synthetisch"), `${tool.name} gab einen PC-Pfad aus.`);
    assert(tool.outputSchema, `${tool.name} veroeffentlicht kein MCP-outputSchema.`);
    assert.equal(result.structuredContent?.ok, true, `${tool.name} verlor das kanonische API-Ergebnis.`);
    assert.equal(result.structuredContent?.operation, SSE_MCP_TOOL_OPERATIONS[tool.name],
      `${tool.name} verlor ein API-Feld im structuredContent.`);
    const structuredText = JSON.stringify(result.structuredContent);
    assert(!structuredText.includes("C:\\Privat") && !structuredText.includes("C:\\Synthetisch"),
      `${tool.name} gab einen PC-Pfad im structuredContent aus.`);

    const beforeUnknown = calls.length;
    const unknown = await client.callTool(
      { name: tool.name, arguments: { ...args, nichtImVertrag: true } },
      undefined,
      { timeout: 10_000, maxTotalTimeout: 10_000 },
    );
    assert.equal(unknown.isError, true, `${tool.name} akzeptierte ein unbekanntes MCP-Argument.`);
    assert.equal(calls.length, beforeUnknown, `${tool.name} leitete ein unbekanntes Argument zur API.`);
  }
  assert.equal(calls.length, tools.length);
  process.stdout.write(`MCP/API-End-to-End-Matrix: ${expectedToolCount} Werkzeuge validiert, redigiert und ausgefuehrt\n`);
} finally {
  await client.close();
  await new Promise((resolve, reject) => api.close((error) => (error ? reject(error) : resolve())));
}
