import assert from "node:assert/strict";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createSseApiServer } from "../dist/api-server.js";
import { callApiOperation } from "../dist/api-client.js";
import { callApiOperationWithBusyRetry } from "../dist/api-busy-retry.js";
import { MAX_API_RESPONSE_BYTES } from "../dist/api-contract.js";
import { MCP_PREFLIGHT_OUTPUT_SCHEMA } from "../dist/mcp-preflight.js";
import {
  SSE_MCP_COMPOSED_TOOL_OPERATIONS,
  SSE_MCP_CONTROL_TOOL_ACTIONS,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_MCP_TOOL_SCHEMAS,
} from "../dist/operation-catalog.js";
import { sampleJsonSchema } from "./json-schema-samples.mjs";

const expectedToolCount = Object.keys(SSE_MCP_TOOL_SCHEMAS).length;
const calls = [];
let postExecutionFailure;
let committedWrites = 0;
let receivedPosts = 0;
const api = createSseApiServer({
  execute: async (operation, args) => {
    calls.push({ operation, args });
    if (postExecutionFailure) {
      committedWrites += 1;
      if (postExecutionFailure === "worker-failed") throw new Error("Synthetic failure after commit.");
      if (postExecutionFailure === "response-too-large") return { ok: true, value: "x".repeat(MAX_API_RESPONSE_BYTES) };
      return { ok: "invalid worker result" };
    }
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
api.on("request", (request) => { if (request.method === "POST") receivedPosts += 1; });
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
  const preflightTool = tools.find((tool) => tool.name === "sse_preflight");
  assert(preflightTool?.outputSchema, "sse_preflight muss ein deklariertes outputSchema veroeffentlichen.");
  const preflight = await client.callTool({ name: "sse_preflight", arguments: {} });
  assert.notEqual(preflight.isError, true);
  assert.equal(preflight.structuredContent?.ok, true);
  MCP_PREFLIGHT_OUTPUT_SCHEMA.parse(preflight.structuredContent);
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
  const controlTools = tools.filter((tool) => tool.name in SSE_MCP_CONTROL_TOOL_ACTIONS);
  assert.equal(controlTools.length, Object.keys(SSE_MCP_CONTROL_TOOL_ACTIONS).length);
  for (const tool of controlTools) {
    const beforeControl = calls.length;
    const status = await client.callTool({ name: tool.name, arguments: { action: "status" } });
    assert.notEqual(status.isError, true);
    assert.equal(status.structuredContent?.state, "running");
    assert.equal(status.structuredContent?.processId, process.pid);
    const unknown = await client.callTool({ name: tool.name, arguments: { action: "status", nichtImVertrag: true } });
    assert.equal(unknown.isError, true);
    assert.equal(calls.length, beforeControl, "API-Steuerung darf keinen Worker-Auftrag erzeugen.");
  }
  assert.equal(directTools.length + Object.keys(SSE_MCP_COMPOSED_TOOL_OPERATIONS).length + controlTools.length, tools.length);
  assert.equal(calls.length, directTools.length + SSE_MCP_COMPOSED_TOOL_OPERATIONS.sse_preflight.length);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const writeArgs = { name: "Synthetic post-execution failure" };
  for (const kind of ["invalid-operation-result", "worker-failed", "response-too-large"]) {
    postExecutionFailure = kind;
    for (const call of [callApiOperation, callApiOperationWithBusyRetry]) {
      const before = { posts: receivedPosts, executions: calls.length, commits: committedWrites };
      await assert.rejects(call("click", writeArgs, 2_000, { baseUrl }), (error) => {
        assert.equal(error.kind, kind);
        assert.equal(error.httpStatus, 502);
        assert.equal(error.operationResponseReceived, true, `${kind}: the operation response was received.`);
        return true;
      });
      assert.equal(receivedPosts - before.posts, 1, `${kind}: no POST replay, including the busy-retry client.`);
      assert.equal(calls.length - before.executions, 1);
      assert.equal(committedWrites - before.commits, 1);
    }
    const before = { posts: receivedPosts, executions: calls.length, commits: committedWrites };
    const result = await client.callTool({ name: "sse_click", arguments: writeArgs });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.kind, kind);
    assert.equal(result.structuredContent?.outcomeUnknown, true);
    assert.equal(result.structuredContent?.reconciliationRequired, true);
    assert.equal(result.structuredContent?.retryable, false);
    assert.match(result.structuredContent?.hint, /keine automatische Schreibwiederholung/u);
    assert.equal(receivedPosts - before.posts, 1);
    assert.equal(calls.length - before.executions, 1);
    assert.equal(committedWrites - before.commits, 1);
  }
  process.stdout.write(`MCP/API-End-to-End-Matrix: ${expectedToolCount} Werkzeuge validiert, redigiert und ausgefuehrt\n`);
} finally {
  await client.close();
  await new Promise((resolve, reject) => api.close((error) => (error ? reject(error) : resolve())));
}
