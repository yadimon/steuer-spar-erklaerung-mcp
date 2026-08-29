import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { Agent, createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { withCombinedAbortSignal } from "../dist/abort.js";
import { assertForegroundCaseDirectory, ensureForegroundApiFirstRun } from "../dist/api-first-run.js";
import { configurationFingerprint } from "../dist/workspace-status.js";
import { API_MAIN_USAGE, parseApiMainArguments } from "../dist/api-main-arguments.js";
import { SSE_API_OPERATIONS, SSE_API_VERSION } from "../dist/api-contract.js";
import { attachScreenshotImage, installApiShutdown, MAX_SCREENSHOT_IMAGE_BYTES } from "../dist/api-runtime.js";
import { readFileBounded } from "../dist/bounded-files.js";
import {
  SSE_EXPECTED_API_BASE_URL,
  SSE_EXPECTED_API_CONFIGURATION_FINGERPRINT,
} from "../dist/api-supervisor-contract.js";

const reservePort = async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

assert.deepEqual(parseApiMainArguments([]), { help: false });
assert.deepEqual(parseApiMainArguments(["--help"]), { help: true });
assert.deepEqual(parseApiMainArguments(["--config", "C:\\config.json"]), {
  help: false,
  configPath: "C:\\config.json",
});
assert.deepEqual(parseApiMainArguments(["--case-dir", "C:\\Steuerfaelle"]), {
  help: false,
  caseDir: "C:\\Steuerfaelle",
});
assert.deepEqual(parseApiMainArguments([
  "--case-dir", "C:\\Steuerfaelle", "--config", "C:\\config.json",
]), {
  help: false,
  configPath: "C:\\config.json",
  caseDir: "C:\\Steuerfaelle",
});
assert.throws(() => parseApiMainArguments(["--config"]), /Ungueltige API-Startargumente/);
assert.throws(() => parseApiMainArguments(["--config", "relativ.json"]), /absoluter Pfad/);
assert.throws(() => parseApiMainArguments(["--case-dir", "relativ"]), /absoluter Pfad/);
assert.throws(
  () => parseApiMainArguments(["--case-dir", "C:\\a", "--case-dir", "C:\\b"]),
  /nur einmal/,
);

const firstRunProbeRoot = mkdtempSync(join(tmpdir(), "sse-api-first-run-probe-"));
try {
  const validCaseDir = join(firstRunProbeRoot, "cases");
  mkdirSync(validCaseDir, { recursive: true });
  assert.doesNotThrow(() => assertForegroundCaseDirectory(validCaseDir));
  assert.throws(() => assertForegroundCaseDirectory(join(firstRunProbeRoot, "missing")), /fehlt oder ist kein Ordner/);
  const caseFile = join(firstRunProbeRoot, "case-file.txt");
  writeFileSync(caseFile, "kein Ordner", "utf8");
  assert.throws(() => assertForegroundCaseDirectory(caseFile), /fehlt oder ist kein Ordner/);
  const namedConfig = join(firstRunProbeRoot, "named", "config.json");
  const named = ensureForegroundApiFirstRun(undefined, {
    LOCALAPPDATA: join(firstRunProbeRoot, "unused"),
    SSE_API_CONFIG: namedConfig,
  });
  assert.equal(named.created, false, "Benannte fehlende Konfiguration darf nicht automatisch erzeugt werden.");
  assert.equal(named.configPath, namedConfig);
  assert.equal(existsSync(namedConfig), false);
} finally {
  rmSync(firstRunProbeRoot, { recursive: true, force: true });
}

assert.throws(() => parseApiMainArguments(["--config", "a.json", "extra"]), /Ungueltige API-Startargumente/);
assert.throws(() => parseApiMainArguments(["--unknown"]), /Ungueltige API-Startargumente/);

const helpStartedAt = performance.now();
const helpChild = spawn(process.execPath, ["dist/api-main.js", "--help"], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let helpStdout = "";
let helpStderr = "";
helpChild.stdout.on("data", (chunk) => { helpStdout += chunk.toString("utf8"); });
helpChild.stderr.on("data", (chunk) => { helpStderr += chunk.toString("utf8"); });
const [helpCode] = await once(helpChild, "exit");
const helpMs = performance.now() - helpStartedAt;
assert.equal(helpCode, 0, helpStderr);
assert.equal(helpStdout.trim(), API_MAIN_USAGE);
assert(helpMs < 2_500, `API-Hilfe lud zu viel Laufzeitcode (${helpMs.toFixed(0)} ms).`);

const invalidMain = spawnSync(process.execPath, ["dist/api-main.js", "--unknown"], {
  cwd: process.cwd(),
  windowsHide: true,
  encoding: "utf8",
  timeout: 15_000,
});
assert.equal(invalidMain.status, 1);
assert.match(invalidMain.stderr, /SSE-API-Start fehlgeschlagen: Ungueltige API-Startargumente/);
assert(!invalidMain.stderr.includes(process.cwd()), "Argumentfehler darf keinen lokalen Quellpfad ausgeben.");

const quickRoot = mkdtempSync(join(tmpdir(), "sse-api-npx-quick-"));
const quickLocalAppData = join(quickRoot, "local-app-data");
const quickCaseDir = join(quickRoot, "cases");
mkdirSync(quickCaseDir, { recursive: true });
const quickPort = await reservePort();
const quickEnvironment = {
  ...process.env,
  LOCALAPPDATA: quickLocalAppData,
  SSE_API_PORT: String(quickPort),
};
for (const key of ["SSE_API_CONFIG", "SSE_CASE_DIR", "SSE_WORKSPACE_DIR"]) {
  delete quickEnvironment[key];
}
const quickChild = spawn(process.execPath, ["dist/api-main.js", "--case-dir", quickCaseDir], {
  cwd: process.cwd(),
  windowsHide: true,
  env: quickEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
});
let quickStdout = "";
let quickStderr = "";
quickChild.stdout.on("data", (chunk) => { quickStdout += chunk.toString("utf8"); });
quickChild.stderr.on("data", (chunk) => { quickStderr += chunk.toString("utf8"); });
try {
  const quickBaseUrl = `http://127.0.0.1:${quickPort}`;
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${quickBaseUrl}/healthz`);
      healthy = response.ok;
      await response.body?.cancel();
      if (healthy) break;
    } catch {
      // Foreground-API startet noch.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.equal(healthy, true, `NPX-Kurzstart wurde nicht gesund: ${quickStderr}`);

  const quickConfigPath = join(quickLocalAppData, "SteuerSparErklaerungApi", "config.json");
  const quickConfig = JSON.parse(readFileSync(quickConfigPath, "utf8"));
  assert.equal(quickConfig.caseDir, undefined, "Kurzstart darf die laufzeitgebundene Fallfreigabe nicht persistieren.");
  for (const path of [quickConfig.workspaceDir, quickConfig.documentsDir, quickConfig.resultDir, quickConfig.backupsDir]) {
    assert.equal(existsSync(path), true, `First Run hat Ressourcenbereich nicht erzeugt: ${path}`);
  }
  assert.equal(
    readdirSync(join(quickLocalAppData, "SteuerSparErklaerungApi"), { recursive: true })
      .some((entry) => String(entry).toLowerCase().endsWith(".vbs")),
    false,
    "Foreground-NPX-Start darf keinen dauerhaften Launcher in den Paketcache binden.",
  );

  const discovery = spawnSync(process.execPath, ["dist/api-cli.js", "discovery"], {
    cwd: process.cwd(),
    windowsHide: true,
    env: quickEnvironment,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(discovery.status, 0, discovery.stderr || discovery.stdout);
  assert.equal(JSON.parse(discovery.stdout).operations.length, SSE_API_OPERATIONS.length);

  // Ein belegter Port muss eindeutig benannt werden, damit kein Agent still
  // ueber eine bereits laufende, anders konfigurierte API weiterarbeitet.
  const portConflict = spawnSync(process.execPath, ["dist/api-main.js"], {
    cwd: process.cwd(),
    windowsHide: true,
    env: quickEnvironment,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(portConflict.status, 1, portConflict.stderr || portConflict.stdout);
  assert.match(portConflict.stderr, /laeuft bereits eine SSE-API/);
  assert(
    portConflict.stderr.includes(`127.0.0.1:${quickPort}`),
    `Portkonflikt muss Host und Port nennen: ${portConflict.stderr}`,
  );
  assert.match(portConflict.stderr, /Nicht fortfahren/);
  assert(!portConflict.stderr.includes("EADDRINUSE"), "Portkonflikt darf nicht als roher Node-Fehler erscheinen.");

} finally {
  quickChild.kill("SIGTERM");
  const [quickCode, quickSignal] = await once(quickChild, "exit");
  assert(
    quickCode === 0 || (process.platform === "win32" && quickSignal === "SIGTERM"),
    `NPX-Kurzstart beendete sich unerwartet (Exit ${quickCode}, Signal ${quickSignal}): ${quickStderr}`,
  );
  assert.match(quickStdout, /Lokale Standardkonfiguration erstellt/);
  assert.match(quickStdout, /SSE-API bereit/);
  assert.match(quickStdout, /Strg\+C beendet die API/);
  rmSync(quickRoot, { recursive: true, force: true });
}

const temporary = mkdtempSync(join(tmpdir(), "sse-api-main-smoke-"));
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
const configPath = join(temporary, "config.json");
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });
const port = await reservePort();
writeFileSync(
  configPath,
  `${JSON.stringify({ host: "127.0.0.1", port, workspaceDir, resultDir }, null, 2)}\n`,
  "utf8",
);

const screenshotPath = join(resultDir, "kontrolle.png");
const screenshotBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("synthetic-png-fixture", "utf8"),
]);
writeFileSync(screenshotPath, screenshotBytes);
const screenshotResult = { ok: true, shot: { path: screenshotPath, w: 10, h: 20 } };
const attached = attachScreenshotImage(resultDir, "screenshot", { includeImage: true }, screenshotResult);
assert.equal(attached.imageBase64, screenshotBytes.toString("base64"));
assert.deepEqual(attached.shot, screenshotResult.shot);

const invalidPngPath = join(resultDir, "kein-png.png");
writeFileSync(invalidPngPath, "not-a-png", "utf8");
const invalidPng = attachScreenshotImage(
  resultDir,
  "screenshot",
  { includeImage: true },
  { ok: true, shot: { path: invalidPngPath, w: 10, h: 20 } },
);
assert.match(invalidPng.imageReadError, /PNG-Signatur/);
assert.equal(invalidPng.imageBase64, undefined);

const vanishedPath = join(resultDir, "schon-entfernt.png");
const vanished = attachScreenshotImage(
  resultDir,
  "screenshot",
  { includeImage: true },
  { ok: true, shot: { path: vanishedPath, w: 10, h: 20 } },
);
assert.equal(vanished.ok, true, "Verschwundenes Bild darf einen erfolgreichen Worker-Aufruf nicht verwerfen");
assert.deepEqual(vanished.shot, { path: vanishedPath, w: 10, h: 20 });
assert.match(vanished.imageReadError, /Ergebnis bleibt erhalten/);
assert.equal(vanished.imageBase64, undefined);

const outside = attachScreenshotImage(
  resultDir,
  "screenshot",
  { includeImage: true },
  { ok: true, shot: { path: configPath, w: 10, h: 20 } },
);
assert.equal(outside.ok, true);
assert.match(outside.imageReadError, /ausserhalb des konfigurierten Ergebnisbereichs/);
assert.equal(outside.imageBase64, undefined);

const oversizedPath = join(resultDir, "zu-gross.png");
writeFileSync(oversizedPath, "x", "utf8");
truncateSync(oversizedPath, MAX_SCREENSHOT_IMAGE_BYTES + 1);
const oversized = attachScreenshotImage(
  resultDir,
  "screenshot",
  { includeImage: true },
  { ok: true, shot: { path: oversizedPath, w: 10, h: 20 } },
);
assert.equal(oversized.ok, true);
assert.match(oversized.imageReadError, /Ergebnis bleibt erhalten/);
assert.equal(oversized.imageBase64, undefined);
assert.throws(() => readFileBounded(screenshotPath, 4), /groesser als 4 Bytes/);

const lifecycleServer = createHttpServer((_request, response) => response.end("ok"));
lifecycleServer.listen(0, "127.0.0.1");
await once(lifecycleServer, "listening");
const lifecycleAddress = lifecycleServer.address();
assert(lifecycleAddress && typeof lifecycleAddress === "object");
const keepAliveAgent = new Agent({ keepAlive: true, maxSockets: 1 });
await new Promise((resolveRequest, rejectRequest) => {
  const request = httpRequest(
    { host: "127.0.0.1", port: lifecycleAddress.port, path: "/", agent: keepAliveAgent },
    (response) => {
      response.resume();
      response.once("end", resolveRequest);
    },
  );
  request.once("error", rejectRequest);
  request.end();
});
const idleSockets = Object.values(keepAliveAgent.freeSockets).reduce((count, sockets) => count + sockets.length, 0);
assert(idleSockets > 0, "Test braucht vor dem Shutdown eine echte inaktive Keep-alive-Verbindung");

const shutdownController = new AbortController();
const lifecycleEvents = [];
const warnings = [];
const onWarning = (warning) => warnings.push(warning);
process.on("warning", onWarning);
const lifecycle = installApiShutdown(
  lifecycleServer,
  shutdownController,
  (record) => lifecycleEvents.push(record),
  { forceAfterMs: 1_000, registerProcessSignals: false },
);
const activeReasons = Array.from({ length: 25 }, () => {
  const requestController = new AbortController();
  return withCombinedAbortSignal(
    [requestController.signal, shutdownController.signal],
    (signal) => new Promise((resolveAbort) => {
      if (signal.aborted) resolveAbort(signal.reason);
      else signal.addEventListener("abort", () => resolveAbort(signal.reason), { once: true });
    }),
  );
});
lifecycle.requestShutdown();
const observedReasons = await Promise.all(activeReasons);
await lifecycle.closed;
await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
lifecycle.dispose();
keepAliveAgent.destroy();
process.off("warning", onWarning);
assert(observedReasons.every((reason) => reason === observedReasons[0]));
assert.match(observedReasons[0].message, /kontrolliert beendet/);
assert.equal(warnings.some((warning) => warning.name === "MaxListenersExceededWarning"), false);
assert(lifecycleEvents.some((event) => event.event === "shutdown-requested"));
assert(lifecycleEvents.some((event) => event.event === "shutdown-complete"));
assert(!lifecycleEvents.some((event) => event.event === "shutdown-forced"));

const logFailureServer = createHttpServer((_request, response) => response.end("ok"));
logFailureServer.listen(0, "127.0.0.1");
await once(logFailureServer, "listening");
const logFailureLifecycle = installApiShutdown(
  logFailureServer,
  new AbortController(),
  () => { throw new Error("synthetischer Shutdown-Logfehler"); },
  { forceAfterMs: 100, registerProcessSignals: false },
);
logFailureLifecycle.requestShutdown();
await logFailureLifecycle.closed;
logFailureLifecycle.dispose();

let acceptHangingRequest;
const hangingRequestAccepted = new Promise((resolveAccepted) => { acceptHangingRequest = resolveAccepted; });
const forceServer = createHttpServer(() => acceptHangingRequest());
forceServer.listen(0, "127.0.0.1");
await once(forceServer, "listening");
const forceAddress = forceServer.address();
assert(forceAddress && typeof forceAddress === "object");
const forceEvents = [];
const forceLifecycle = installApiShutdown(
  forceServer,
  new AbortController(),
  (record) => forceEvents.push(record),
  { forceAfterMs: 50, registerProcessSignals: false },
);
const hangingRequest = httpRequest({ host: "127.0.0.1", port: forceAddress.port, path: "/" });
const hangingClosed = new Promise((resolveClosed) => {
  hangingRequest.once("error", resolveClosed);
  hangingRequest.once("close", resolveClosed);
});
hangingRequest.end();
await hangingRequestAccepted;
forceLifecycle.requestShutdown();
await forceLifecycle.closed;
await hangingClosed;
forceLifecycle.dispose();
assert(forceEvents.some((event) => event.event === "shutdown-forced"));
assert(forceEvents.some((event) => event.event === "shutdown-complete"));

const rejectedSupervisorContract = spawnSync(process.execPath, ["dist/api-main.js", "--config", configPath], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
  timeout: 15_000,
  env: {
    ...process.env,
    [SSE_EXPECTED_API_BASE_URL]: `http://127.0.0.1:${port}`,
    [SSE_EXPECTED_API_CONFIGURATION_FINGERPRINT]: "a".repeat(64),
  },
});
assert.equal(rejectedSupervisorContract.status, 1);
assert.match(rejectedSupervisorContract.stderr, /Supervisor-Startvertrag/iu);
await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`),
  "API lauschte trotz abweichendem Supervisor-Konfigurationsvertrag.");

const child = spawn(process.execPath, ["dist/api-main.js", "--config", configPath], {
  cwd: process.cwd(),
  windowsHide: true,
  env: {
    ...process.env,
    SSE_API_PORT: "9",
    SSE_WORKSPACE_DIR: join(temporary, "stale-workspace"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      healthy = response.ok;
      if (healthy) break;
    } catch {
      // API startet noch.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(healthy, true, `Produktiver API-Entry-Point wurde nicht gesund: ${stderr}`);

  const expectedConfigurationFingerprint = configurationFingerprint({
    profileId: "2025",
    documentsDir: join(workspaceDir, "documents"),
    workspaceDir,
    resultDir,
    backupsDir: join(workspaceDir, "backups"),
  });
  const actualOpenApiResponse = await fetch(`${baseUrl}/v1/openapi.json`);
  assert.equal(actualOpenApiResponse.status, 200);
  const actualOpenApi = await actualOpenApiResponse.json();
  assert.equal(actualOpenApi.openapi, "3.1.0");
  assert.equal(Object.keys(actualOpenApi.paths).length, SSE_API_OPERATIONS.length + 3);
  assert(actualOpenApi.paths["/healthz"]?.get);
  assert(actualOpenApi.paths[`/${SSE_API_VERSION}/operations`]?.get);
  assert(actualOpenApi.paths[`/${SSE_API_VERSION}/openapi.json`]?.get);

  // Der produktive Prozess weist einen Browseraufruf ab, nicht nur der Testserver.
  const fromBrowser = await fetch(`${baseUrl}/v1/operations/workspace_status`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://boese.example" },
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(fromBrowser.status, 403);

  const status = await fetch(`${baseUrl}/v1/operations/workspace_status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: {}, timeoutMs: 1_000 }),
  });
  assert.equal(status.status, 200);
  const envelope = await status.json();
  assert.equal(envelope.result.workspaceReady, true);
  assert.equal(envelope.result.resultAreaReady, true);
  assert.equal(envelope.result.documentAreaReady, true);
  assert.equal(envelope.result.backupAreaReady, true);
  assert.equal(envelope.result.profileId, "2025");
  assert.equal(envelope.result.configurationFingerprint, expectedConfigurationFingerprint);

  rmSync(resultDir, { recursive: true, force: true });
  writeFileSync(resultDir, "kein-ergebnisordner", "utf8");
  const brokenStatus = await fetch(`${baseUrl}/v1/operations/workspace_status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: {}, timeoutMs: 1_000 }),
  });
  assert.equal(brokenStatus.status, 200);
  assert.equal((await brokenStatus.json()).result.resultAreaReady, false);
  rmSync(resultDir, { force: true });
  mkdirSync(resultDir, { recursive: true });
} finally {
  child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit");
  assert(
    code === 0 || (process.platform === "win32" && signal === "SIGTERM"),
    `API beendete sich unerwartet (Exit ${code}, Signal ${signal}): ${stderr}`,
  );
  const log = readFileSync(join(temporary, "logs", "api.jsonl"), "utf8");
  assert.match(log, /"event":"ready"/);
  assert.match(log, /"operation":"workspace_status"/);
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write(`API-Main-Smoke: Hilfe in ${helpMs.toFixed(0)} ms, Bild, Shutdown, Abort, Start und Log bestanden\n`);
