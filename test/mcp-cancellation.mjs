import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-mcp-cancellation-"));
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
mkdirSync(workspaceDir);
mkdirSync(resultDir);
writeFileSync(join(workspaceDir, "large.bin"), Buffer.alloc(16 * 1024 * 1024, 0x4d));

const config = {
  host: "127.0.0.1",
  port: 1,
  configPath: join(temporary, "config.json"),
  workspaceDir,
  resultDir,
};
const baseExecute = createApiExecutor(config, async () => ({ ok: true }));
let requestCount = 0;
let resolveFirstStarted;
let resolveAbortedLog;
const firstStarted = new Promise((resolve) => { resolveFirstStarted = resolve; });
const abortedLog = new Promise((resolve) => { resolveAbortedLog = resolve; });
const logs = [];

const execute = async (operation, args, timeoutMs, signal) => {
  if (operation === "workspace_file_list") {
    requestCount += 1;
    if (requestCount === 1) resolveFirstStarted();
  }
  return await baseExecute(operation, args, timeoutMs, signal);
};

const api = createSseApiServer({
  execute,
  log: (record) => {
    logs.push(record);
    if (record.event === "operation" && record.operation === "workspace_file_list" && record.kind === "aborted") {
      resolveAbortedLog(record);
    }
  },
});

// Blockiert ein synchroner Lesezugriff (etwa durch einen Virenscanner auf dem
// CI-Runner) den Eventloop, kann weder der Abbruch noch das Log eintreffen.
// Die groesste gemessene Verzoegerung macht diesen Fall im Fehlertext sichtbar.
let maxLoopLagMs = 0;
let lagProbeAt = Date.now();
const lagProbe = setInterval(() => {
  const now = Date.now();
  maxLoopLagMs = Math.max(maxLoopLagMs, now - lagProbeAt - 50);
  lagProbeAt = now;
}, 50);
lagProbe.unref();

async function waitForWithin(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
const client = new Client({ name: "sse-mcp-cancellation", version: "1.0.0" });

try {
  await client.connect(transport);
  const controller = new AbortController();
  const cancelled = client.callTool(
    { name: "sse_workspace_files", arguments: { ref: "workspace:.", limit: 2_000, includeHashes: true } },
    undefined,
    { signal: controller.signal, timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  await waitForWithin(firstStarted, 5_000, "MCP-Workspace-Anfrage erreichte die echte API nicht");
  controller.abort();
  await assert.rejects(cancelled, /abort/i);

  const cancelledRecord = await waitForWithin(
    abortedLog,
    5_000,
    `API-Executor meldete nach MCP-Abbruch kein aborted-Ergebnis: ${JSON.stringify(logs)} ` +
      `(groesste Eventloop-Verzoegerung ${maxLoopLagMs} ms)`,
  );
  assert.equal(cancelledRecord.ok, false);
  assert.equal(cancelledRecord.kind, "aborted");
  assert.equal(cancelledRecord.delivered, false,
    "Das abgebrochene Executor-Ergebnis darf nicht als an den getrennten MCP-Client zugestellt gelten");

  const recovered = await client.callTool(
    { name: "sse_workspace_files", arguments: { ref: "workspace:.", limit: 2_000, includeHashes: false } },
    undefined,
    { timeout: 5_000, maxTotalTimeout: 5_000 },
  );
  assert.notEqual(recovered.isError, true);
  assert.equal(recovered.structuredContent?.ok, true);
  assert.equal(recovered.structuredContent?.truncated, false);
  assert.deepEqual(recovered.structuredContent?.files?.map((file) => file.ref), ["workspace:large.bin"]);
  assert.equal(requestCount, 2);
  process.stdout.write("MCP-Abbruch: echter Workspace-Auftrag beendet und Folgeaufruf erfolgreich\n");
} finally {
  await client.close();
  await new Promise((resolve, reject) => api.close((error) => (error ? reject(error) : resolve())));
  rmSync(temporary, { recursive: true, force: true });
}
