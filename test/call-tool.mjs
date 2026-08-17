/**
 * Kleiner Diagnose-Client fuer genau einen Aufruf ueber das echte MCP-Protokoll.
 *
 * Beispiele:
 *   node test/call-tool.mjs sse_health
 *   node test/call-tool.mjs sse_dialog_list '{}'
 *   node test/call-tool.mjs sse_case_hash '{"ref":"cases:fall.Gew2025"}'
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [, , name, rawArgs = "{}"] = process.argv;
if (!name) {
  process.stderr.write("Aufruf: node test/call-tool.mjs <werkzeug> [json-argumente]\n");
  process.exit(2);
}

let args;
try {
  args = JSON.parse(rawArgs);
} catch (error) {
  process.stderr.write(`Ungueltiges JSON: ${error.message}\n`);
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-call-tool", version: "1.0.0" });

try {
  await client.connect(transport);
  // Several real SSE operations intentionally take longer than the SDK's
  // generic 60-second default (for example collecting 15+ Qt pages). Keep the
  // probe aligned with the server/Codex registration timeout instead of
  // reporting a false transport failure while the worker is still healthy.
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 300_000, maxTotalTimeout: 300_000 },
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.isError ? 1 : 0;
} finally {
  await client.close();
}
