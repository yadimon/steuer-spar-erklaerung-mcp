import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSE_API_PACKAGE_NAME, SSE_PACKAGE_VERSION } from "../dist/version.js";

assert.equal(process.platform, "win32", "MCP-Autostart ist ein Windows-Vertrag.");
assert.equal(process.arch, "x64", "MCP-Autostart ist ein Windows-x64-Vertrag.");

const temporary = mkdtempSync(join(tmpdir(), "sse-mcp-api-supervisor-"));
const ownedApiPids = new Set();

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}

function configFor(name, port) {
  const path = resolve(temporary, `${name}.json`);
  writeFileSync(path, `${JSON.stringify({ profileId: "2025", host: "127.0.0.1", port }, null, 2)}\n`, "utf8");
  return path;
}

async function health(port) {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.packageName, SSE_API_PACKAGE_NAME);
  assert.equal(payload.packageVersion, SSE_PACKAGE_VERSION);
  assert(Number.isInteger(payload.processId) && payload.processId > 0);
  assert.match(payload.instanceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
  assert.match(payload.configurationFingerprint, /^[0-9a-f]{64}$/u);
  return payload;
}

async function connectMcp(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/index.js")],
    env,
  });
  const client = new Client({ name: "sse-api-supervisor-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function runMcp(args, env) {
  const child = spawn(process.execPath, [resolve("dist/index.js"), ...args], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const [code, signal] = await once(child, "exit");
  return { code, signal, stdout, stderr };
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolveClose) => server.close(resolveClose));
}

function discoverOwnedApiPids() {
  const script = [
    "$root=$env:SSE_TEST_CONFIG_ROOT",
    "$pids=@(Get-CimInstance Win32_Process | Where-Object {",
    "  $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine.Contains('api-main.js')",
    "} | Select-Object -ExpandProperty ProcessId)",
    "[Console]::Out.WriteLine(($pids | ConvertTo-Json -Compress))",
  ].join("\n");
  const result = spawnSync("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, SSE_TEST_CONFIG_ROOT: temporary },
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(Number.isInteger);
  } catch {
    return [];
  }
}

function identityServer(
  packageVersion,
  counters = { operations: 0 },
  processId = process.pid,
  instanceId = "55555555-5555-4555-8555-555555555555",
) {
  return createServer(async (request, response) => {
    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        apiVersion: "v1",
        packageName: SSE_API_PACKAGE_NAME,
        packageVersion,
        processId,
        instanceId,
        configurationFingerprint: "0".repeat(64),
        inFlight: null,
        prewarm: null,
      }));
      return;
    }
    counters.operations += 1;
    for await (const _chunk of request) { /* request body intentionally discarded */ }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      apiVersion: "v1",
      requestId: "00000000-0000-4000-8000-000000000000",
      operation: "health",
      durationMs: 1,
      result: { ok: true },
    }));
  });
}

try {
  const singletonPort = await freePort();
  const singletonConfig = configFor("singleton", singletonPort);
  const singletonEnv = {
    ...process.env,
    SSE_API_URL: "",
    SSE_API_CONFIG: singletonConfig,
  };

  const firstClient = await connectMcp(singletonEnv);
  const firstHealth = await health(singletonPort);
  ownedApiPids.add(firstHealth.processId);
  await firstClient.close();

  const afterClientExit = await health(singletonPort);
  assert.equal(afterClientExit.processId, firstHealth.processId,
    "Automatisch gestartete API ueberlebte den ersten MCP-Client nicht.");

  const secondClient = await connectMcp(singletonEnv);
  const reusedHealth = await health(singletonPort);
  assert.equal(reusedHealth.processId, firstHealth.processId,
    "Zweiter MCP-Start ersetzte den kompatiblen Singleton.");
  await secondClient.close();

  const conflictingConfig = resolve(temporary, "singleton-conflict.json");
  writeFileSync(conflictingConfig, `${JSON.stringify({
    profileId: "2025",
    host: "127.0.0.1",
    port: singletonPort,
    workspaceDir: resolve(temporary, "different-workspace"),
  }, null, 2)}\n`, "utf8");
  const conflictingResult = await runMcp(["--selftest"], {
    ...process.env,
    SSE_API_URL: "",
    SSE_API_CONFIG: conflictingConfig,
  });
  assert.equal(conflictingResult.code, 1);
  assert.equal(conflictingResult.stdout, "");
  assert.match(conflictingResult.stderr, /andere Konfiguration/iu);
  assert.equal((await health(singletonPort)).processId, firstHealth.processId,
    "Konfigurationskonflikt ersetzte oder beendete die bereits laufende API.");

  const defaultPort = await freePort();
  const isolatedLocalAppData = resolve(temporary, "local-app-data");
  const defaultConfigDirectory = resolve(isolatedLocalAppData, "SteuerSparErklaerungApi");
  mkdirSync(defaultConfigDirectory, { recursive: true });
  writeFileSync(resolve(defaultConfigDirectory, "config.json"), `${JSON.stringify({
    profileId: "2025",
    host: "127.0.0.1",
    port: defaultPort,
  }, null, 2)}\n`, "utf8");
  const defaultClient = await connectMcp({
    ...process.env,
    LOCALAPPDATA: isolatedLocalAppData,
    SSE_API_URL: "",
    SSE_API_CONFIG: "",
  });
  const defaultHealth = await health(defaultPort);
  ownedApiPids.add(defaultHealth.processId);
  await defaultClient.close();

  const racePort = await freePort();
  const raceConfig = configFor("race", racePort);
  const raceEnv = { ...process.env, SSE_API_URL: "", SSE_API_CONFIG: raceConfig };
  const [raceClientA, raceClientB] = await Promise.all([connectMcp(raceEnv), connectMcp(raceEnv)]);
  const raceHealth = await health(racePort);
  ownedApiPids.add(raceHealth.processId);
  await Promise.all([raceClientA.close(), raceClientB.close()]);
  assert.equal((await health(racePort)).processId, raceHealth.processId,
    "Race hinterliess keinen stabil wiederverwendbaren API-Singleton.");

  const foreign = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("not-the-sse-api");
  });
  foreign.listen(0, "127.0.0.1");
  await once(foreign, "listening");
  const foreignAddress = foreign.address();
  assert(foreignAddress && typeof foreignAddress === "object");
  const foreignResult = await runMcp(["--selftest"], {
    ...process.env,
    SSE_API_CONFIG: "",
    SSE_API_URL: `http://127.0.0.1:${foreignAddress.port}`,
  });
  assert.equal(foreignResult.code, 1);
  assert.equal(foreignResult.stdout, "");
  assert.match(foreignResult.stderr, /inkompatibel|gueltiges JSON|Content-Type application\/json/iu);
  await closeServer(foreign);

  const incompatible = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      apiVersion: "v1",
      packageName: SSE_API_PACKAGE_NAME,
      packageVersion: "0.1.0-beta.1",
      processId: process.pid,
      instanceId: "66666666-6666-4666-8666-666666666666",
      configurationFingerprint: "0".repeat(64),
      inFlight: null,
      prewarm: null,
    }));
  });
  incompatible.listen(0, "127.0.0.1");
  await once(incompatible, "listening");
  const incompatibleAddress = incompatible.address();
  assert(incompatibleAddress && typeof incompatibleAddress === "object");
  const incompatibleResult = await runMcp(["--selftest"], {
    ...process.env,
    SSE_API_CONFIG: "",
    SSE_API_URL: `http://127.0.0.1:${incompatibleAddress.port}`,
  });
  assert.equal(incompatibleResult.code, 1);
  assert.equal(incompatibleResult.stdout, "");
  assert.match(incompatibleResult.stderr, /erwartet .*@.*erhalten .*beta\.1/iu);
  await closeServer(incompatible);

  const unsafePid = identityServer(SSE_PACKAGE_VERSION, { operations: 0 }, 1e100);
  unsafePid.listen(0, "127.0.0.1");
  await once(unsafePid, "listening");
  const unsafePidAddress = unsafePid.address();
  assert(unsafePidAddress && typeof unsafePidAddress === "object");
  const unsafePidResult = await runMcp(["--selftest"], {
    ...process.env,
    SSE_API_CONFIG: "",
    SSE_API_URL: `http://127.0.0.1:${unsafePidAddress.port}`,
  });
  assert.equal(unsafePidResult.code, 1);
  assert.equal(unsafePidResult.stdout, "");
  assert.match(unsafePidResult.stderr, /inkompatibel/iu);
  await closeServer(unsafePid);

  const replacementPort = await freePort();
  const compatibleCounters = { operations: 0 };
  const compatible = identityServer(
    SSE_PACKAGE_VERSION,
    compatibleCounters,
    10101,
    "77777777-7777-4777-8777-777777777777",
  );
  compatible.listen(replacementPort, "127.0.0.1");
  await once(compatible, "listening");
  const replacementClient = await connectMcp({
    ...process.env,
    SSE_API_CONFIG: "",
    SSE_API_URL: `http://127.0.0.1:${replacementPort}`,
  });
  await closeServer(compatible);
  const replacementCounters = { operations: 0 };
  const replacement = identityServer(
    SSE_PACKAGE_VERSION,
    replacementCounters,
    20202,
    "88888888-8888-4888-8888-888888888888",
  );
  replacement.listen(replacementPort, "127.0.0.1");
  await once(replacement, "listening");
  try {
    const replacementResult = await replacementClient.callTool({ name: "sse_health", arguments: {} });
    const replacementText = replacementResult.content
      ?.filter((entry) => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n") ?? "";
    assert.equal(replacementResult.isError, true,
      "Ein nach dem Handshake ausgetauschter API-Prozess wurde weiterverwendet.");
    assert.match(replacementText, /ausgetauscht|inkompatibel/iu);
    assert.equal(replacementCounters.operations, 0,
      "MCP rief eine Operation auf dem nach dem Handshake inkompatiblen Prozess auf.");
  } finally {
    await replacementClient.close();
    await closeServer(replacement);
  }

  const noFallbackPort = await freePort();
  const untouchedConfigPort = await freePort();
  const explicitResult = await runMcp(["--selftest"], {
    ...process.env,
    SSE_API_CONFIG: configFor("must-not-start", untouchedConfigPort),
    SSE_API_URL: `http://127.0.0.1:${noFallbackPort}`,
  });
  assert.equal(explicitResult.code, 1);
  assert.equal(explicitResult.stdout, "");
  assert.match(explicitResult.stderr, /ausdruecklich konfigurierte SSE_API_URL.*keine API auf dem Standardport/isu);
  await assert.rejects(fetch(`http://127.0.0.1:${untouchedConfigPort}/healthz`),
    "Explizite unerreichbare SSE_API_URL startete unerwartet die konfigurierte API.");

  const invalidConfigResult = await runMcp(["--selftest"], {
    ...process.env,
    SSE_API_URL: "",
    SSE_API_CONFIG: temporary,
  });
  assert.equal(invalidConfigResult.code, 1);
  assert.equal(invalidConfigResult.stdout, "");
  assert.match(invalidConfigResult.stderr, /API-Konfiguration konnte nicht sicher gelesen werden.*keine regulaere Datei/iu);
  assert(!invalidConfigResult.stderr.includes(temporary),
    "API-Konfigurationsfehler gab den lokalen Testpfad aus.");

  process.stdout.write(
    "MCP-API-Supervisor: Autostart, Wiederverwendung, Config-Identitaet, Default-Config-Port, Zwei-Start-Race, Fremddienst, Versionsdrift, Prozesswechsel und URL-No-Fallback bestanden\n",
  );
} finally {
  for (const pid of new Set([...ownedApiPids, ...discoverOwnedApiPids()])) {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
  rmSync(resolve(temporary), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
