import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { Agent, createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { withCombinedAbortSignal } from "../dist/abort.js";
import { API_MAIN_USAGE, parseApiMainArguments } from "../dist/api-main-arguments.js";
import { SSE_API_OPERATIONS, SSE_API_VERSION } from "../dist/api-contract.js";
import { attachScreenshotImage, installApiShutdown, MAX_SCREENSHOT_IMAGE_BYTES } from "../dist/api-runtime.js";
import { readFileBounded } from "../dist/bounded-files.js";

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
assert.throws(() => parseApiMainArguments(["--config"]), /Ungueltige API-Startargumente/);
assert.throws(() => parseApiMainArguments(["--config", "a.json", "extra"]), /Ungueltige API-Startargumente/);
assert.throws(() => parseApiMainArguments(["--unknown"]), /Ungueltige API-Startargumente/);

const helpStartedAt = performance.now();
const helpChild = spawn(process.execPath, ["dist/api-main.js", "--help"], {
  cwd: process.cwd(),
  windowsHide: true,
  env: { ...process.env, SSE_API_TOKEN: "" },
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

const temporary = mkdtempSync(join(tmpdir(), "sse-api-main-smoke-"));
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
const configPath = join(temporary, "config.json");
const token = "api-main-smoke-token-with-at-least-24-characters";
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });
const port = await reservePort();
writeFileSync(
  configPath,
  `${JSON.stringify({ host: "127.0.0.1", port, token, workspaceDir, resultDir }, null, 2)}\n`,
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

const child = spawn(process.execPath, ["dist/api-main.js", "--config", configPath], {
  cwd: process.cwd(),
  windowsHide: true,
  env: {
    ...process.env,
    SSE_API_TOKEN: "stale-api-main-token-with-at-least-24-characters",
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

  const actualOpenApiResponse = await fetch(`${baseUrl}/v1/openapi.json`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(actualOpenApiResponse.status, 200);
  const actualOpenApi = await actualOpenApiResponse.json();
  assert.equal(actualOpenApi.openapi, "3.1.0");
  assert.equal(Object.keys(actualOpenApi.paths).length, SSE_API_OPERATIONS.length + 3);
  assert(actualOpenApi.paths["/healthz"]?.get);
  assert(actualOpenApi.paths[`/${SSE_API_VERSION}/operations`]?.get);
  assert(actualOpenApi.paths[`/${SSE_API_VERSION}/openapi.json`]?.get);

  const unauthorized = await fetch(`${baseUrl}/v1/operations/workspace_status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(unauthorized.status, 401);

  const status = await fetch(`${baseUrl}/v1/operations/workspace_status`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: {}, timeoutMs: 1_000 }),
  });
  assert.equal(status.status, 200);
  const envelope = await status.json();
  assert.equal(envelope.result.workspaceReady, true);
  assert.equal(envelope.result.resultAreaReady, true);
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
  assert(!log.includes(token), "API-Log darf das Bearer-Token nicht enthalten");
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write(`API-Main-Smoke: Hilfe in ${helpMs.toFixed(0)} ms, Bild, Shutdown, Abort, Start, Auth und Log bestanden\n`);
