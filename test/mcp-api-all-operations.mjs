import assert from "node:assert/strict";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createSseApiServer } from "../dist/api-server.js";
import {
  SSE_MCP_COMPOSED_TOOL_OPERATIONS,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_MCP_TOOL_SCHEMAS,
} from "../dist/operation-catalog.js";
import { sampleJsonSchema } from "./json-schema-samples.mjs";

const expectedToolCount = Object.keys(SSE_MCP_TOOL_SCHEMAS).length;
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
  const instructions = client.getInstructions() ?? "";
  assert.match(instructions, /Als ersten fachlichen Tool-Aufruf sse_preflight/u);
  assert.match(instructions, /Niemals ueber ELSTER/u);
  assert.match(instructions, /hashverifizierte Sicherung nach backups:/u);
  assert.match(instructions, /Aendern erlaubt kein Speichern/u);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, expectedToolCount);
  const directTools = tools.filter((tool) => tool.name in SSE_MCP_TOOL_OPERATIONS);
  assert.equal(directTools.length, Object.keys(SSE_MCP_TOOL_OPERATIONS).length);
  for (const tool of directTools) {
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
  const beforePreflight = calls.length;
  const preflight = await client.callTool({ name: "sse_preflight", arguments: {} });
  assert.notEqual(preflight.isError, true);
  assert.equal(preflight.structuredContent?.ok, true);
  assert.deepEqual(
    calls.slice(beforePreflight).map((entry) => entry.operation),
    [...SSE_MCP_COMPOSED_TOOL_OPERATIONS.sse_preflight],
    "Preflight muss genau seine drei read-only API-Operationen in Reihenfolge ausfuehren.",
  );
  assert(!JSON.stringify(preflight.structuredContent).includes("C:\\Privat"));
  const beforeUnknownPreflight = calls.length;
  const unknownPreflight = await client.callTool({
    name: "sse_preflight",
    arguments: { nichtImVertrag: true },
  });
  assert.equal(unknownPreflight.isError, true);
  assert.equal(calls.length, beforeUnknownPreflight);
  assert.equal(calls.length, directTools.length + SSE_MCP_COMPOSED_TOOL_OPERATIONS.sse_preflight.length);
  process.stdout.write(`MCP/API-End-to-End-Matrix: ${expectedToolCount} Werkzeuge validiert, redigiert und ausgefuehrt\n`);
} finally {
  await client.close();
  await new Promise((resolve, reject) => api.close((error) => (error ? reject(error) : resolve())));
}
