import assert from "node:assert/strict";
import { once } from "node:events";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "sse-api-mcp-parity-"));
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });
cpSync(join(here, "scenarios"), join(workspaceDir, "scenarios"), { recursive: true });

const token = "parity-token-with-at-least-24-characters";
const config = {
  host: "127.0.0.1",
  port: 1,
  token,
  configPath: join(temporary, "config.json"),
  workspaceDir,
  resultDir,
  caseDir: join(temporary, "cases"),
};

let workerCalls = 0;
const worker = async (operation, args) => {
  workerCalls += 1;
  const fixtures = {
    product_info: { ok: true, taxYear: 2025, engineFileMajor: 31 },
    launch: {
      ok: true,
      instance: { pid: 3131, hwnd: 4242 },
      caseRef: "cases:arbeitskopie.Gew2025",
      sha256: "a".repeat(64),
    },
    health: { ok: true, running: true, advice: "gesund", canaryMs: 17 },
    page_objects: {
      ok: true,
      pageId: args.pageId,
      page: { heading: "Betriebseinnahmen", localMachinePath: "must-not-be-captured" },
    },
    list_cases: { ok: true, count: 2, cases: ["A", "B"] },
    click: { ok: true, beforePage: "Start", afterPage: "Betriebseinnahmen", screenPoint: [10, 20] },
    read_page: { ok: true, heading: "Betriebseinnahmen", fieldCount: 4, boundHwnd: args.hwnd, fields: [1, 2, 3, 4] },
    close: { ok: true, closed: true, saved: false, hwnd: args.hwnd },
  };
  return fixtures[operation] ?? { ok: false, kind: "fixture", error: `Keine Fixture fuer ${operation}` };
};

const execute = createApiExecutor(config, worker);
const server = createSseApiServer({ config, execute });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

let client;
try {
  const directResponse = await fetch(`${baseUrl}/v1/operations/scenario_run`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      args: {
        scenarioRef: "workspace:scenarios/complex-wrapper/scenario.json",
        resultRef: "results:direct.json",
      },
      timeoutMs: 300_000,
    }),
  });
  assert.equal(directResponse.status, 200);
  const directEnvelope = await directResponse.json();
  assert.equal(directEnvelope.result.ok, true, JSON.stringify(directEnvelope.result));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(here, "..", "dist", "index.js")],
    env: { ...process.env, SSE_API_URL: baseUrl, SSE_API_TOKEN: token },
  });
  client = new Client({ name: "sse-scenario-parity", version: "1.0.0" });
  await client.connect(transport);
  const mcpResponse = await client.callTool(
    {
      name: "sse_run_scenario",
      arguments: {
        scenarioRef: "workspace:scenarios/complex-wrapper/scenario.json",
        resultRef: "results:mcp.json",
      },
    },
    undefined,
    { timeout: 300_000, maxTotalTimeout: 300_000 },
  );
  assert.equal(mcpResponse.isError, undefined, JSON.stringify(mcpResponse));
  const mcpResult = JSON.parse(mcpResponse.content.find((item) => item.type === "text").text);
  assert.equal(mcpResult.ok, true, JSON.stringify(mcpResult));
  assert.equal(mcpResult.sha256, directEnvelope.result.sha256);

  const directBytes = readFileSync(join(resultDir, "direct.json"));
  const mcpBytes = readFileSync(join(resultDir, "mcp.json"));
  const expectedBytes = readFileSync(join(here, "scenarios", "complex-wrapper", "expected-result.json"));
  if (process.env.SSE_SCENARIO_PRINT === "1") process.stdout.write(directBytes.toString("utf8"));
  assert.deepEqual(mcpBytes, directBytes, "API und MCP muessen bytegleiche Ergebnisdateien schreiben");
  assert.deepEqual(directBytes, expectedBytes, "API/MCP-Ergebnis muss der versionierten Ergebnisdatei entsprechen");
  assert(!directBytes.toString("utf8").includes("localMachinePath"));
  assert(!directBytes.toString("utf8").includes("canaryMs"));

  const callsBeforeConflict = workerCalls;
  const overwriteWithoutHash = await fetch(`${baseUrl}/v1/operations/scenario_run`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      args: { scenarioRef: "workspace:scenarios/complex-wrapper/scenario.json", resultRef: "results:direct.json" },
      timeoutMs: 300_000,
    }),
  });
  assert.equal((await overwriteWithoutHash.json()).result.ok, false);
  assert.equal(workerCalls, callsBeforeConflict, "Ergebnisziel-Konflikt muss vor jedem Szenarioschritt scheitern");

  const overwriteWithHash = await fetch(`${baseUrl}/v1/operations/scenario_run`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      args: {
        scenarioRef: "workspace:scenarios/complex-wrapper/scenario.json",
        resultRef: "results:direct.json",
        expectedResultSha256: directEnvelope.result.sha256,
      },
      timeoutMs: 300_000,
    }),
  });
  const overwritten = await overwriteWithHash.json();
  assert.equal(overwritten.result.sha256, directEnvelope.result.sha256);
  process.stdout.write(`Szenario-Paritaet: ${directEnvelope.result.sha256} (${directBytes.length} Bytes)\n`);
} finally {
  if (client) await client.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  rmSync(temporary, { recursive: true, force: true });
}
