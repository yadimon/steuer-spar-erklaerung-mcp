/**
 * Diagnose-Client fuer mehrere MCP-Aufrufe in genau einer Server-Sitzung.
 *
 * Das vermeidet den Prozess- und Initialisierungsaufwand von call-tool.mjs,
 * wenn eine UI-Arbeitsfolge mehrere kleine, voneinander abhaengige Schritte
 * benoetigt. Die Aufrufe werden absichtlich seriell ausgefuehrt, weil sie
 * denselben SSE-Fensterzustand lesen oder veraendern.
 *
 * Beispiel:
 *   node test/call-tools.mjs '[{"name":"sse_health","arguments":{}},{"name":"sse_page","arguments":{}}]'
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [, , rawCalls] = process.argv;
if (!rawCalls) {
  process.stderr.write("Aufruf: node test/call-tools.mjs '<json-array>'\n");
  process.exit(2);
}

let calls;
try {
  calls = JSON.parse(rawCalls);
} catch (error) {
  process.stderr.write(`Ungueltiges JSON: ${error.message}\n`);
  process.exit(2);
}

if (!Array.isArray(calls) || calls.length === 0) {
  process.stderr.write("Erwartet wird ein nicht leeres JSON-Array.\n");
  process.exit(2);
}

for (const [index, call] of calls.entries()) {
  if (!call || typeof call.name !== "string" || !call.name) {
    process.stderr.write(`Aufruf ${index + 1}: 'name' fehlt.\n`);
    process.exit(2);
  }
  if (call.arguments !== undefined && (call.arguments === null || typeof call.arguments !== "object" || Array.isArray(call.arguments))) {
    process.stderr.write(`Aufruf ${index + 1}: 'arguments' muss ein Objekt sein.\n`);
    process.exit(2);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-call-tools", version: "1.0.0" });
const results = [];

try {
  await client.connect(transport);
  for (const [index, call] of calls.entries()) {
    const started = Date.now();
    const result = await client.callTool(
      { name: call.name, arguments: call.arguments ?? {} },
      undefined,
      { timeout: 300_000, maxTotalTimeout: 300_000 },
    );
    results.push({
      index: index + 1,
      name: call.name,
      durationMs: Date.now() - started,
      result,
    });
    if (result.isError && call.continueOnError !== true) break;
  }
  process.stdout.write(`${JSON.stringify({ ok: results.every(({ result }) => !result.isError), results }, null, 2)}\n`);
  process.exitCode = results.some(({ result }) => result.isError) ? 1 : 0;
} finally {
  await client.close();
}
