import assert from "node:assert/strict";
import { createMcpRegistry } from "../dist/mcp-registry.js";
import { MAX_API_ARGUMENT_STRING_BYTES, SSE_MCP_TOOL_SCHEMAS } from "../dist/operation-catalog.js";

let registered;
const fakeServer = {
  registerTool(name, config, callback) {
    registered = { name, config, callback };
    return { name };
  },
};
const registry = createMcpRegistry(fakeServer);
let callbackCalls = 0;
registry.registerStrictTool(
  "sse_find",
  {
    description: "Synthetischer Registry-Vertrag",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_find.shape,
  },
  async () => {
    callbackCalls += 1;
    throw new Error(
      "Interner Fehler bei file:///C:/Privat/steuerfall.ESt2025:42, C:\\Privat\\steuerfall.ESt2025 " +
      "und file:///home/person/steuerfall.ESt2025 sowie /home/person/steuerfall.ESt2025",
    );
  },
);

assert.equal(registered.name, "sse_find");
const extra = { signal: new AbortController().signal };
const unexpected = await registered.callback({ name: "Einkommen" }, extra);
const unexpectedText = unexpected.content.map((entry) => entry.text ?? "").join("\n");
assert.equal(unexpected.isError, true);
assert.equal(callbackCalls, 1);
assert(!unexpectedText.includes("Privat") && !unexpectedText.includes("file:///") &&
  !unexpectedText.includes("/home/person") && unexpectedText.includes("Lokaler PC-Pfad"),
  "Unerwartete Handlerfehler muessen an der MCP-Grenze redigiert werden.");

const oversized = await registered.callback({ name: "x".repeat(MAX_API_ARGUMENT_STRING_BYTES + 1) }, extra);
const oversizedText = oversized.content.map((entry) => entry.text ?? "").join("\n");
assert.equal(oversized.isError, true);
assert.match(oversizedText, /Ungueltige MCP-Argumente/);
assert.equal(callbackCalls, 1, "Budgetfehler duerfen den Tool-Handler nicht erreichen.");

const missingSelector = await registered.callback({}, extra);
const missingSelectorText = missingSelector.content.map((entry) => entry.text ?? "").join("\n");
assert.equal(missingSelector.isError, true);
assert.match(missingSelectorText, /name, aid, type/);
assert.equal(callbackCalls, 1, "Semantisch ungueltige MCP-Argumente duerfen den Tool-Handler nicht erreichen.");

process.stdout.write("MCP-Registry: globale Handlerfehler, Pfadredaktion und Argumentbudget bestanden\n");
