import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createSseApiServer } from "../dist/api-server.js";
import { readApiHealthz } from "../dist/api-client.js";
import { requestApiShutdown } from "../dist/api-control-client.js";
import { listenOnFetchablePort } from "./fetchable-port.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sse-mcp-api-control-"));
const runtime = resolve("plugin/steuer-spar-erklaerung/runtime");
const lock = JSON.parse(readFileSync(join(runtime, "runtime-lock.json"), "utf8"));
const mcpEntry = resolve(runtime, lock.entries.mcp);
const apiEntry = resolve(runtime, lock.entries.api);
assert(mcpEntry.startsWith(`${runtime}\\`) && apiEntry.startsWith(`${runtime}\\`));
const powershell = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const identityHelper = resolve("test/performance/owned-process-identity.ps1");
const ownedApis = [];

async function freePort() {
  const server = createServer();
  const port = await listenOnFetchablePort(server);
  await new Promise((done) => server.close(done));
  return port;
}
async function connect(settings) {
  const env = { ...process.env };
  for (const key of Object.keys(env).filter((key) => key.startsWith("SSE_"))) delete env[key];
  Object.assign(env, settings);
  const transport = new StdioClientTransport({ command: process.execPath, args: [mcpEntry], env, stderr: "pipe" });
  let diagnostic = "";
  transport.stderr.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-64 * 1024); });
  const client = new Client({ name: "sse-mcp-api-control-test", version: "1.0.0" });
  try { await client.connect(transport); }
  catch (error) { await transport.close(); throw new Error(`${error.message}: ${diagnostic}`); }
  return { client, transport };
}
const control = (client, args) => client.callTool({ name: "sse_api_control", arguments: args });
const state = (result) => result.structuredContent;
function isGone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { assert.equal(error.code, "ESRCH"); return true; }
}
function recordOwnedApi(health, configPath, mcpPid) {
  const ownershipScript = [
    "$ErrorActionPreference='Stop'",
    "$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$env:SSE_TEST_TARGET_PID)",
    "$owned=$p -and $p.ParentProcessId -eq [int]$env:SSE_TEST_PARENT_PID -and $p.Name -eq 'node.exe' -and $p.CommandLine.Contains($env:SSE_TEST_CONFIG_PATH) -and $p.CommandLine.Contains($env:SSE_TEST_API_ENTRY)",
    "[Console]::Out.WriteLine(([bool]$owned | ConvertTo-Json -Compress))",
  ].join("\n");
  const owned = JSON.parse(execFileSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ownershipScript], {
    env: { ...process.env, SSE_TEST_TARGET_PID: String(health.processId), SSE_TEST_PARENT_PID: String(mcpPid),
      SSE_TEST_CONFIG_PATH: configPath, SSE_TEST_API_ENTRY: apiEntry },
    encoding: "utf8", windowsHide: true, timeout: 15_000,
  }));
  assert.equal(owned, true, "Only the API created by this MCP/config/runtime may be stopped.");
  const observed = JSON.parse(execFileSync(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", identityHelper,
    "-Mode", "Inspect", "-TargetProcessId", String(health.processId),
  ], { encoding: "utf8", windowsHide: true, timeout: 15_000 }));
  assert.equal(observed.outcome, "running");
  ownedApis.push({ pid: health.processId, identity: observed.identity });
}
async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}

try {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const configPath = join(temporary, "owned.json");
  const config = { profileId: "2025", host: "127.0.0.1", port };
  writeFileSync(configPath, JSON.stringify(config));
  const { client, transport } = await connect({ SSE_API_CONFIG: configPath });
  try {
    const firstHealth = await readApiHealthz({ baseUrl });
    recordOwnedApi(firstHealth, configPath, transport.pid);
    const metadata = (await client.listTools()).tools.find((tool) => tool.name === "sse_api_control");
    assert(metadata?.outputSchema, "Lifecycle control must publish its output contract.");
    assert.equal(metadata.inputSchema.additionalProperties, false);
    const initial = state(await control(client, { action: "status" }));
    assert.equal(initial.state, "running");
    assert.equal(firstHealth.instanceId, initial.instanceId);
    assert.equal(firstHealth.processId, initial.processId);
    for (const invalid of [
      { action: "shutdown", instanceId: initial.instanceId },
      { action: "shutdown", confirm: true, instanceId: initial.instanceId, force: true },
      { action: "status", confirm: true },
      { action: "unknown", confirm: true, instanceId: initial.instanceId },
    ]) {
      assert.equal((await control(client, invalid)).isError, true, "Invalid control arguments were accepted.");
    }
    const mismatch = await control(client, { action: "shutdown", confirm: true, instanceId: "55555555-5555-4555-8555-555555555555" });
    assert.equal(mismatch.isError, true);
    assert.equal(state(mismatch).kind, "api-instance-mismatch");
    assert.equal((await readApiHealthz({ baseUrl })).instanceId, initial.instanceId);

    const stopArgs = { action: "shutdown", confirm: true, instanceId: initial.instanceId };
    const concurrent = await Promise.all([control(client, stopArgs), control(client, stopArgs)]);
    assert.equal(concurrent.filter((result) => result.isError !== true).length, 1);
    assert.equal(concurrent.filter((result) => result.isError === true).length, 1);
    const stopped = state(concurrent.find((result) => result.isError !== true));
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.accepted, true);
    assert.equal(stopped.processExited, true);
    assert.equal(isGone(initial.processId), true);
    assert.equal(isGone(transport.pid), false, "MCP must remain alive after stopping its API.");
    const blocked = await client.callTool({ name: "sse_product_info", arguments: {} });
    assert.equal(blocked.isError, true);
    assert.equal(state(blocked).kind, "api-stopped");
    assert.equal(state(await control(client, { action: "status" })).state, "stopped");
    await assert.rejects(readApiHealthz({ baseUrl }), (error) => error.kind === "network");

    const changedPort = await freePort();
    writeFileSync(configPath, JSON.stringify({ ...config, port: changedPort }));
    const changed = await control(client, { action: "start", confirm: true, instanceId: initial.instanceId });
    assert.equal(changed.isError, true);
    assert.equal(state(changed).kind, "api-configuration-changed");
    await assert.rejects(readApiHealthz({ baseUrl: `http://127.0.0.1:${changedPort}` }), (error) => error.kind === "network");
    writeFileSync(configPath, JSON.stringify(config));
    const restarted = await control(client, { action: "start", confirm: true, instanceId: initial.instanceId });
    assert.notEqual(restarted.isError, true, JSON.stringify(restarted));
    assert.equal(state(restarted).state, "running");
    assert.notEqual(state(restarted).instanceId, initial.instanceId);
    const secondHealth = await readApiHealthz({ baseUrl });
    assert.equal(secondHealth.instanceId, state(restarted).instanceId);
    assert.equal(secondHealth.configurationFingerprint, firstHealth.configurationFingerprint);
    recordOwnedApi(secondHealth, configPath, transport.pid);
    assert.notEqual((await client.callTool({ name: "sse_product_info", arguments: {} })).isError, true);
    const secondStop = await control(client, { action: "shutdown", confirm: true, instanceId: secondHealth.instanceId });
    assert.equal(state(secondStop).state, "stopped");
    assert.equal(isGone(secondHealth.processId), true);

    let replacementStops = 0;
    const replacement = createSseApiServer({
      configurationFingerprint: firstHealth.configurationFingerprint,
      execute: async () => { assert.fail("Replacement must never receive an operation."); },
      requestShutdown: () => { replacementStops += 1; },
    });
    await new Promise((done, reject) => { replacement.once("error", reject); replacement.listen(port, "127.0.0.1", done); });
    try {
      const refused = await control(client, { action: "start", confirm: true, instanceId: secondHealth.instanceId });
      assert.equal(refused.isError, true);
      assert.equal(state(refused).kind, "api-replaced");
      assert.equal(replacementStops, 0);
      assert.equal((await readApiHealthz({ baseUrl })).processId, process.pid);
    } finally { await closeServer(replacement); }
  } finally { await client.close(); }
} finally {
  // Also cover failure before the first status/ownership assertion. A unique
  // test config directory and the exact built entry identify only our APIs;
  // their children must additionally match the exact bundled worker path.
  const discoverScript = [
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'",
    "$all=@(Get-CimInstance Win32_Process)",
    "$apis=@($all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($env:SSE_TEST_CONFIG_ROOT) -and $_.CommandLine.Contains($env:SSE_TEST_API_ENTRY) })",
    "$ids=@($apis.ProcessId)",
    "$spares=@($all | Where-Object { $_.Name -eq 'powershell.exe' -and $ids -contains $_.ParentProcessId -and $_.CommandLine -and $_.CommandLine.Contains($env:SSE_TEST_WORKER_ENTRY) })",
    "$owned=@(@($apis)+@($spares) | Select-Object ProcessId)",
    "ConvertTo-Json -InputObject $owned -Compress",
  ].join("\n");
  const remaining = JSON.parse(execFileSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", discoverScript], {
    env: { ...process.env, SSE_TEST_CONFIG_ROOT: temporary, SSE_TEST_API_ENTRY: apiEntry,
      SSE_TEST_WORKER_ENTRY: join(runtime, "powershell", "sse-worker.ps1") },
    encoding: "utf8", windowsHide: true, timeout: 15_000,
  }));
  for (const candidate of remaining) {
    const observed = JSON.parse(execFileSync(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", identityHelper,
      "-Mode", "Inspect", "-TargetProcessId", String(candidate.ProcessId),
    ], { encoding: "utf8", windowsHide: true, timeout: 15_000 }));
    assert(["running", "not-running"].includes(observed.outcome));
    if (observed.outcome === "running") ownedApis.push({ pid: candidate.ProcessId, identity: observed.identity });
  }
  for (const api of ownedApis) {
    const outcome = JSON.parse(execFileSync(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", identityHelper,
      "-Mode", "Terminate", "-TargetProcessId", String(api.pid),
      "-ExpectedCreationTimeUtcTicks", api.identity.creationTimeUtcTicks,
      "-ExpectedImageNameLower", api.identity.imageNameLower,
      "-ExpectedImagePathTextSha256", api.identity.imagePathTextSha256,
    ], { encoding: "utf8", windowsHide: true, timeout: 15_000 }));
    assert(["not-running", "terminated", "identity-mismatch"].includes(outcome.outcome));
  }
  rmSync(temporary, { recursive: true, force: true });
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const entered = deferred();
const release = deferred();
let busyStops = 0;
let runningSignal;
const busyServer = createSseApiServer({
  execute: async (_operation, _args, _timeout, signal) => {
    runningSignal = signal;
    entered.resolve();
    await release.promise;
    return { ok: true, windows: [] };
  },
  requestShutdown: () => { busyStops += 1; },
});
const busyUrl = `http://127.0.0.1:${await listenOnFetchablePort(busyServer)}`;
const busyMcp = await connect({ SSE_API_URL: busyUrl });
try {
  const initial = state(await control(busyMcp.client, { action: "status" }));
  const operation = busyMcp.client.callTool({ name: "sse_windows", arguments: {} });
  await entered.promise;
  const rejected = await control(busyMcp.client, { action: "shutdown", confirm: true, instanceId: initial.instanceId });
  assert.equal(rejected.isError, true);
  assert.equal(state(rejected).kind, "busy");
  assert.equal(state(rejected).state, "running");
  assert.equal(state(rejected).accepted, false);
  assert.equal(runningSignal.aborted, false);
  assert.equal(busyStops, 0);
  release.resolve();
  assert.notEqual((await operation).isError, true);
} finally {
  release.resolve();
  await busyMcp.client.close();
  await closeServer(busyServer);
}

// A local test relay forwards one real stop to the actual server, consumes
// its acceptance, then drops the caller's socket instead of forwarding it.
let targetStops = 0;
let forwardedStops = 0;
let unexpectedRequests = 0;
const lossTarget = createSseApiServer({
  execute: async () => { assert.fail("Uncertain lifecycle must block ordinary operations."); },
  requestShutdown: () => { targetStops += 1; },
});
const targetUrl = `http://127.0.0.1:${await listenOnFetchablePort(lossTarget)}`;
const relay = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      const health = await readApiHealthz({ baseUrl: targetUrl });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(health));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/control/shutdown") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      forwardedStops += 1;
      await requestApiShutdown(body, { baseUrl: targetUrl, expectedInstanceId: body.instanceId });
      request.socket.destroy();
      return;
    }
    unexpectedRequests += 1;
    response.writeHead(404);
    response.end();
  } catch (error) { response.destroy(error); }
});
const relayUrl = `http://127.0.0.1:${await listenOnFetchablePort(relay)}`;
const lossMcp = await connect({ SSE_API_URL: relayUrl });
try {
  const initial = state(await control(lossMcp.client, { action: "status" }));
  const stopArgs = { action: "shutdown", confirm: true, instanceId: initial.instanceId };
  const lost = await control(lossMcp.client, stopArgs);
  assert.equal(lost.isError, true);
  assert.equal(state(lost).kind, "shutdown-unknown");
  assert.equal(state(lost).state, "unknown");
  assert.equal(state(lost).accepted, null);
  assert.equal(state(lost).processExited, false);
  const status = state(await control(lossMcp.client, { action: "status" }));
  assert.equal(status.state, "unknown");
  assert.equal(status.accepted, null);
  const ordinary = await lossMcp.client.callTool({ name: "sse_product_info", arguments: {} });
  assert.equal(ordinary.isError, true);
  assert.equal(state(ordinary).kind, "api-lifecycle-pending");
  assert.equal((await control(lossMcp.client, stopArgs)).isError, true);
  assert.equal((await control(lossMcp.client, { action: "start", confirm: true, instanceId: initial.instanceId })).isError, true);
  assert.equal(forwardedStops, 1, "MCP must not repeat an uncertain shutdown.");
  assert.equal(targetStops, 1);
  assert.equal(unexpectedRequests, 0, "Ordinary work reached an API after uncertain stop.");
} finally {
  await lossMcp.client.close();
  await closeServer(relay);
  await closeServer(lossTarget);
}

console.log("mcp-api-control: lifecycle, busy, response loss PASS");
