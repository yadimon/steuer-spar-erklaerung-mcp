import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Agent, createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCombinedAbortSignal } from "../dist/abort.js";
import { attachScreenshotImage, installApiShutdown } from "../dist/api-main.js";

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
const screenshotBytes = Buffer.from("synthetic-png-fixture", "utf8");
writeFileSync(screenshotPath, screenshotBytes);
const screenshotResult = { ok: true, shot: { path: screenshotPath, w: 10, h: 20 } };
const attached = attachScreenshotImage(resultDir, "screenshot", { includeImage: true }, screenshotResult);
assert.equal(attached.imageBase64, screenshotBytes.toString("base64"));
assert.deepEqual(attached.shot, screenshotResult.shot);

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

process.stdout.write("API-Main-Smoke: Bild-Fallback, Keep-alive-Shutdown, Abort-Fan-out, Start, Auth und Log bestanden\n");
