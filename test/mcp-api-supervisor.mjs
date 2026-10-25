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
import { listenOnFetchablePort } from "./fetchable-port.mjs";
import { resolveWindowsPowerShell } from "../dist/windows-runtime.js";
import { probeFailureState, waitForOwnedApi } from "../dist/api-owned-readiness.js";
import { ApiClientError } from "../dist/api-client-error.js";
import { readApiHealthz } from "../dist/api-client.js";

// Dieselbe Aufloesung wie im Produkt: Windows PowerShell 5.1 aus dem
// Systemordner. Ein hart verdrahteter Aufruf von PowerShell 7 wuerde eine
// Installation verlangen, die das Produkt ausdruecklich nicht braucht, und
// das Gate auf einer frischen Windows-Maschine unlauffaehig machen.
const windowsPowerShell = resolveWindowsPowerShell();

assert.equal(process.platform, "win32", "MCP-Autostart ist ein Windows-Vertrag.");
assert.equal(process.arch, "x64", "MCP-Autostart ist ein Windows-x64-Vertrag.");

// Model the real startup policy without sleeping or creating a process.
function readinessModel(outcomes, requireOwnProcess = true) {
  const queue = [...outcomes], calls = [], sleeps = [];
  const state = { now: 0, exited: false, spawnError: undefined };
  const child = { pid: 4242, exited: () => state.exited, spawnError: () => state.spawnError };
  return { state, calls, sleeps, run: () => waitForOwnedApi({
    child, requireOwnProcess, now: () => state.now,
    sleep: async ms => { assert(ms > 0 && ms <= 100); sleeps.push(ms); state.now += ms; },
    probe: async timeoutMs => {
      assert(timeoutMs > 0 && timeoutMs <= 750 && timeoutMs <= 15000 - state.now);
      calls.push(timeoutMs);
      const next = queue.shift(); assert(next, "Unexpected extra readiness probe.");
      state.now += next.spendBudget ? timeoutMs : (next.elapsed ?? 0);
      state.exited = next.exited ?? state.exited;
      state.spawnError = next.spawnError ?? state.spawnError;
      return next.result;
    },
  }) };
}
const ownHealth = { processId: 4242 }, peerHealth = { processId: 4343 };
const localAbort = new ApiClientError("Synthetic local probe deadline.", "aborted");
const unresponsive = { state: "unresponsive", error: localAbort };
const absent = { state: "absent", error: new ApiClientError("Synthetic not-yet-listening endpoint.", "network") };
const compatible = { state: "compatible", health: ownHealth };
const delayedReady = readinessModel([{ result: unresponsive, spendBudget: true }, { result: compatible }]);
assert.equal(await delayedReady.run(), ownHealth);
assert.deepEqual(delayedReady.calls, [750, 750]); assert.deepEqual(delayedReady.sleeps, [100]);
assert.equal(delayedReady.state.now, 850);
const notYetListening = readinessModel([{ result: absent }, { result: absent }, { result: absent }, { result: compatible }]);
assert.equal(await notYetListening.run(), ownHealth); assert.equal(notYetListening.calls.length, 4);
const incompatibleError = new ApiClientError("Synthetic version/configuration mismatch.", "protocol");
const incompatibleReady = readinessModel([{ result: { state: "incompatible", error: incompatibleError } }]);
await assert.rejects(incompatibleReady.run(), error => error === incompatibleError);
assert.equal(incompatibleReady.calls.length, 1); assert.equal(incompatibleReady.sleeps.length, 0);
const replacementReady = readinessModel([{ result: { state: "compatible", health: peerHealth } }]);
await assert.rejects(replacementReady.run(), error => error.kind === "api-replaced");
assert.equal(replacementReady.calls.length, 1); assert.equal(replacementReady.sleeps.length, 0);
const initialWinner = readinessModel([{ result: unresponsive, exited: true, spendBudget: true },
  { result: { state: "compatible", health: peerHealth } }], false);
assert.equal(await initialWinner.run(), peerHealth, "An initial losing contender must still await its verified winner.");
assert.equal(initialWinner.calls.length, 2);
const initialAbsentWinner = readinessModel([{ result: absent, exited: true }, { result: { state: "compatible", health: peerHealth } }], false);
assert.equal(await initialAbsentWinner.run(), peerHealth);
const exitedReady = readinessModel([{ result: unresponsive, exited: true, spendBudget: true }]);
await assert.rejects(exitedReady.run(), error => /endete/u.test(error.message) && error.cause === localAbort);
assert.equal(exitedReady.calls.length, 1); assert.equal(exitedReady.sleeps.length, 0);
const alreadyExited = readinessModel([]); alreadyExited.state.exited = true;
await assert.rejects(alreadyExited.run(), /endete/u); assert.equal(alreadyExited.calls.length, 0);
const exitedAfterReply = readinessModel([{ result: compatible, exited: true }]);
await assert.rejects(exitedAfterReply.run(), /endete/u); assert.equal(exitedAfterReply.calls.length, 1);
const failedSpawn = readinessModel([]); failedSpawn.state.spawnError = new Error("Synthetic spawn failure.");
await assert.rejects(failedSpawn.run(), error => /konnte nicht gestartet/u.test(error.message)
  && error.cause.message === "API-Prozessstart: UNKNOWN." && !JSON.stringify(error.cause).includes("Synthetic"));
assert.equal(failedSpawn.calls.length, 0);
const spawnFailure = Object.assign(new Error("Synthetic private installation path."), { code: "EACCES" });
const failedDuringProbe = readinessModel([{ result: unresponsive, elapsed: 15000, spawnError: spawnFailure }]);
await assert.rejects(failedDuringProbe.run(), error => /konnte nicht gestartet/u.test(error.message)
  && error.cause.message === "API-Prozessstart: EACCES." && error.cause !== spawnFailure);
assert.equal(failedDuringProbe.calls.length, 1); assert.equal(failedDuringProbe.sleeps.length, 0);
const exhaustedReady = readinessModel(Array.from({ length: 18 }, () => ({ result: unresponsive, spendBudget: true })));
await assert.rejects(exhaustedReady.run(), error => /nicht rechtzeitig/u.test(error.message) && error.cause === localAbort);
assert.equal(exhaustedReady.state.now, 15000); assert.equal(exhaustedReady.calls.length, 18);
assert.equal(exhaustedReady.calls.at(-1), 550); assert.equal(exhaustedReady.sleeps.length, 17);
const lateReady = readinessModel([{ result: compatible, elapsed: 15000 }]);
await assert.rejects(lateReady.run(), /nicht rechtzeitig/u); assert.equal(lateReady.calls.length, 1);
for (const scenario of [
  { kind: "aborted", timer: true, state: "unresponsive" },
  { kind: "aborted", timer: false, state: "incompatible" },
  { kind: "aborted", timer: true, status: 503, state: "incompatible" },
  { kind: "timeout", timer: false, state: "unresponsive" },
  { kind: "timeout", timer: true, status: 503, state: "incompatible" },
  { kind: "network", timer: false, state: "absent" },
  { kind: "network", timer: false, status: 503, state: "incompatible" },
  { kind: "protocol", timer: true, state: "incompatible" },
]) {
  assert.equal(probeFailureState(new ApiClientError("Synthetic probe classification.", scenario.kind, scenario.status), scenario.timer), scenario.state);
}
process.stdout.write("API-Readiness: begrenzte lokale Probe-Wiederholung, PID-Bindung, Startrace und Fehlerursachen bestanden\n");

function cleanupOwnedApis(knownPids, discover, stop, remove) {
  const failures = [];
  const stopAll = pids => {
    for (const pid of new Set(pids)) {
      try { stop(pid); } catch (error) { failures.push(error); }
    }
  };
  stopAll(knownPids);
  try { stopAll(discover()); } catch (error) { failures.push(error); }
  try { remove(); } catch (error) { failures.push(error); }
  return failures;
}
const cleanupOrder = [], inventoryFailure = new Error("Synthetic inventory failure.");
assert.deepEqual(cleanupOwnedApis([1, 1, 2], () => { cleanupOrder.push("discover"); throw inventoryFailure; },
  pid => cleanupOrder.push(`stop:${pid}`), () => cleanupOrder.push("remove")), [inventoryFailure]);
assert.deepEqual(cleanupOrder, ["stop:1", "stop:2", "discover", "remove"]);
const stopFailure = new Error("Synthetic stop failure."), removeFailure = new Error("Synthetic removal failure.");
const stopped = [];
assert.deepEqual(cleanupOwnedApis([1], () => [2, 2, 3], pid => {
  stopped.push(pid); if (pid === 2) throw stopFailure;
}, () => { throw removeFailure; }), [stopFailure, removeFailure]);
assert.deepEqual(stopped, [1, 2, 3]);

const temporary = mkdtempSync(join(tmpdir(), "sse-mcp-api-supervisor-"));
const ownedApiPids = new Set();

async function freePort() {
  const server = createServer();
  const address = { port: await listenOnFetchablePort(server) };
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

async function waitForPortClosed(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/healthz`);
    } catch {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  assert.fail(`Port ${port} blieb nach dem exakten Prozessstopp erreichbar.`);
}

// Der Test will wissen, ob der Prozess danach tot ist - nicht, welchen Code
// das Hilfswerkzeug geliefert hat. taskkill meldet 128, wenn der Prozess im
// Moment des Aufrufs schon weg war, und auf einem ausgelasteten Runner auch
// 255; beides ist kein Fehlschlag, solange die Nachbedingung eintritt. Genau
// diese Verwechslung hat den Publish-Workflow mehrfach abgebrochen.
async function waitForProcessGone(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal(error.code, "ESRCH", `PID ${pid} war nicht pruefbar: ${error.code}`);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  assert.fail(`Der exakt identifizierte Test-API-Prozess ${pid} lief nach dem Stopp weiter.`);
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

function discoverOwnedApiPids(configRoot = temporary) {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$root=$env:SSE_TEST_CONFIG_ROOT",
    "$pids=@(Get-CimInstance Win32_Process | Where-Object {",
    "  $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine.Contains('api-main.js')",
    "} | Select-Object -ExpandProperty ProcessId)",
    "[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($pids) -Compress))",
  ].join("\n");
  const result = spawnSync(windowsPowerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, SSE_TEST_CONFIG_ROOT: configRoot },
  });
  assert.equal(result.error, undefined, "Owned-process discovery could not start.");
  assert.equal(result.status, 0, "Owned-process discovery failed.");
  const parsed = JSON.parse(result.stdout);
  assert(Array.isArray(parsed) && parsed.every(pid => Number.isInteger(pid) && pid > 0),
    "Owned-process discovery returned an invalid inventory.");
  return parsed;
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

let primaryFailure;
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
  assert(discoverOwnedApiPids(singletonConfig).includes(firstHealth.processId),
    "Owned-process discovery must find a real API before its empty result can be trusted.");
  await firstClient.close();

  const afterClientExit = await health(singletonPort);
  assert.equal(afterClientExit.processId, firstHealth.processId,
    "Automatisch gestartete API ueberlebte den ersten MCP-Client nicht.");

  const secondClient = await connectMcp(singletonEnv);
  const reusedHealth = await health(singletonPort);
  assert.equal(reusedHealth.processId, firstHealth.processId,
    "Zweiter MCP-Start ersetzte den kompatiblen Singleton.");
  await secondClient.close();

  const deathPort = await freePort();
  const deathConfig = configFor("mid-session-death", deathPort);
  const deathClient = await connectMcp({
    ...process.env,
    SSE_API_URL: "",
    SSE_API_CONFIG: deathConfig,
  });
  const deathHealth = await health(deathPort);
  ownedApiPids.add(deathHealth.processId);
  spawnSync("taskkill.exe", ["/PID", String(deathHealth.processId), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await waitForProcessGone(deathHealth.processId);
  ownedApiPids.delete(deathHealth.processId);
  await waitForPortClosed(deathPort);
  const deathResult = await deathClient.callTool({ name: "sse_health", arguments: {} });
  const deathText = deathResult.content
    ?.filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n") ?? "";
  assert.equal(deathResult.isError, true, "Ein API-Tod waehrend der Sitzung muss fail-closed stoppen.");
  assert.equal(deathResult.structuredContent?.kind, "network");
  assert.match(deathText, /sse_api_control mit action=status/u);
  assert.match(deathText, /Nur wenn der Status stopped/u);
  assert.match(deathText, /ausdruecklich action=start/u);
  assert.doesNotMatch(deathText, /MCP-Server ueber den Client neu starten/u);
  await assert.rejects(fetch(`http://127.0.0.1:${deathPort}/healthz`),
    "Ein API-Tod waehrend der Sitzung startete unerwartet einen Ersatzprozess.");
  await deathClient.close();

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

  const stalledRequests = [];
  const stalledEndpoint = createServer((request) => {
    stalledRequests.push(request.url);
  });
  const stalledPort = await listenOnFetchablePort(stalledEndpoint);
  const stalledConfig = configFor("occupied-unresponsive", stalledPort);
  try {
    const controller = new AbortController();
    const accepted = once(stalledEndpoint, "request", { signal: AbortSignal.timeout(5000) });
    const abortedHealth = assert.rejects(readApiHealthz({
      baseUrl: `http://127.0.0.1:${stalledPort}`, signal: controller.signal,
    }), error => error instanceof ApiClientError && error.kind === "aborted"
      && error.httpStatus === undefined && probeFailureState(error, controller.signal.aborted) === "unresponsive");
    try { await accepted; } finally { controller.abort(); await abortedHealth; }
    assert.deepEqual(stalledRequests, ["/healthz"], "The real local abort must have reached Healthz exactly once.");
    const blocked = await runMcp(["--selftest"], { ...process.env, SSE_API_URL: "", SSE_API_CONFIG: stalledConfig });
    assert.equal(blocked.code, 1); assert.equal(blocked.stdout, "");
    assert.match(blocked.stderr, /API-Endpunkt hat innerhalb der Vorpruefungsfrist nicht geantwortet; keine weitere API wurde gestartet/u);
    assert.deepEqual(stalledRequests, ["/healthz", "/healthz"], "An unresponsive pre-spawn endpoint must not enter owned-child readiness.");
    assert.deepEqual(discoverOwnedApiPids(stalledConfig), [], "An occupied unresponsive endpoint must never authorize another API.");
  } finally { await closeServer(stalledEndpoint); }

  const foreign = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("not-the-sse-api");
  });
  const foreignAddress = { port: await listenOnFetchablePort(foreign) };
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
  const incompatibleAddress = { port: await listenOnFetchablePort(incompatible) };
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
  const unsafePidAddress = { port: await listenOnFetchablePort(unsafePid) };
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
    assert.match(replacementText, /MCP-Verbindung neu starten und sse_preflight erneut aufrufen/u,
      "Nach einer API-Auswechslung fehlt der sichere Wiederaufnahmeweg.");
    assert.equal(replacementCounters.operations, 0,
      "MCP rief eine Operation auf dem nach dem Handshake inkompatiblen Prozess auf.");
  } finally {
    await replacementClient.close();
    await closeServer(replacement);
  }

  // Ein abgerissener Transport ist KEINE Aussage darueber, wer am Port lauscht.
  // Genau das passiert beim Austausch eines API-Prozesses: Die
  // wiederverwendete Verbindung stirbt, und die Identitaetsabfrage scheitert
  // am Socket, bevor sie die neue Identitaet sehen kann. Wird der
  // Transportfehler als Befund durchgereicht, meldet der MCP "nicht
  // erreichbar" statt "ausgetauscht" - und verschluckt damit den Hinweis, den
  // der Benutzer braucht.
  //
  // Der Ablauf ist hier bewusst deterministisch und nicht zeitabhaengig: Die
  // erste Abfrage nach dem Handshake wird abgerissen, die zweite antwortet mit
  // einer anderen Instanz.
  const abrissPort = await freePort();
  let abrissAbfragen = 0;
  const abrissZaehler = { operations: 0 };
  const abriss = createServer((request, response) => {
    if (request.url === "/healthz") {
      abrissAbfragen += 1;
      if (abrissAbfragen === 2) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        apiVersion: "v1",
        packageName: SSE_API_PACKAGE_NAME,
        packageVersion: SSE_PACKAGE_VERSION,
        processId: 10101,
        // Ab der dritten Abfrage eine ANDERE Instanz - der Austausch.
        instanceId: abrissAbfragen >= 3
          ? "99999999-9999-4999-8999-999999999999"
          : "77777777-7777-4777-8777-777777777777",
        configurationFingerprint: "0".repeat(64),
        inFlight: null,
        prewarm: null,
      }));
      return;
    }
    abrissZaehler.operations += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  abriss.listen(abrissPort, "127.0.0.1");
  await once(abriss, "listening");
  const abrissClient = await connectMcp({
    ...process.env,
    SSE_API_CONFIG: "",
    SSE_API_URL: `http://127.0.0.1:${abrissPort}`,
  });
  try {
    const abrissErgebnis = await abrissClient.callTool({ name: "sse_health", arguments: {} });
    const abrissText = abrissErgebnis.content
      ?.filter((entry) => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n") ?? "";
    assert.equal(abrissErgebnis.isError, true,
      "Ein ausgetauschter API-Prozess wurde trotz abgerissener Verbindung weiterverwendet.");
    assert.match(abrissText, /ausgetauscht|inkompatibel/iu,
      "Nach einem abgerissenen Transport meldet der MCP den Netzwerkfehler statt des Austauschs; " +
      "die Identitaetsabfrage muss genau einmal frisch nachfragen.");
    assert.equal(abrissZaehler.operations, 0,
      "MCP rief eine Operation auf dem ausgetauschten Prozess auf.");
  } finally {
    await abrissClient.close();
    await closeServer(abriss);
  }

  const noFallbackPort = await freePort();
  const untouchedConfigPort = await freePort();
  const ambiguousResult = await runMcp(["--selftest"], {
    ...process.env,
    SSE_API_CONFIG: configFor("ambiguous", untouchedConfigPort),
    SSE_API_URL: `http://127.0.0.1:${noFallbackPort}`,
  });
  assert.equal(ambiguousResult.code, 1);
  assert.equal(ambiguousResult.stdout, "");
  assert.match(ambiguousResult.stderr, /SSE_API_URL und SSE_API_CONFIG duerfen nicht gleichzeitig/iu);

  const explicitResult = await runMcp(["--selftest"], {
    ...process.env,
    SSE_API_CONFIG: "",
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
    "MCP-API-Supervisor: Autostart, Wiederverwendung, Config-Identitaet, eindeutige Umgebungswahl, Default-Config-Port, Zwei-Start-Race, API-Tod, Fremddienst, Versionsdrift, Prozesswechsel und URL-No-Fallback bestanden\n",
  );
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  const failures = cleanupOwnedApis(ownedApiPids, discoverOwnedApiPids, pid => {
    const stopped = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (stopped.error) throw stopped.error;
  }, () => rmSync(resolve(temporary), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  if (failures.length) throw new AggregateError(primaryFailure ? [primaryFailure, ...failures] : failures,
    "Owned test-API cleanup failed; all known processes and scratch removal were attempted.");
}
