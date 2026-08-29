import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { mcpMainUsage, parseMcpMainArguments } from "../dist/mcp-main.js";
import { SSE_API_PACKAGE_NAME, SSE_PACKAGE_VERSION } from "../dist/version.js";

assert.equal(parseMcpMainArguments([]), "stdio");
assert.equal(parseMcpMainArguments(["--selftest"]), "selftest");
assert.equal(parseMcpMainArguments(["--help"]), "help");
assert.equal(parseMcpMainArguments(["-h"]), "help");
for (const args of [["--unknown"], ["--selftest", "extra"], ["--help", "extra"]]) {
  assert.throws(() => parseMcpMainArguments(args), /Ungueltige MCP-Argumente/);
}
assert.match(mcpMainUsage(), /MCP ueber stdio starten/);

const helpStartedAt = performance.now();
const help = spawnSync(process.execPath, ["dist/index.js", "--help"], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
  timeout: 15_000,
});
const helpMs = performance.now() - helpStartedAt;
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /--selftest/);
assert.equal(help.stderr, "");
assert(helpMs < 2_500, `MCP-Hilfe lud zu viel Laufzeitcode (${helpMs.toFixed(0)} ms).`);

for (const args of [["--unknown"], ["--selftest", "extra"]]) {
  const rejected = spawnSync(process.execPath, ["dist/index.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Start fehlgeschlagen:.*Ungueltige MCP-Argumente/s);
  assert(!rejected.stderr.includes(process.cwd()), "MCP-Argumentfehler darf keinen lokalen Quellpfad ausgeben.");
  assert.equal(rejected.stdout, "", "Ungueltige Argumente duerfen keine API-Antwort erzeugen.");
}

let selftestFails = false;
const selftestApi = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      apiVersion: "v1",
      packageName: SSE_API_PACKAGE_NAME,
      packageVersion: SSE_PACKAGE_VERSION,
      processId: process.pid,
      instanceId: "33333333-3333-4333-8333-333333333333",
      configurationFingerprint: "0".repeat(64),
      inFlight: null,
      prewarm: null,
    }));
    return;
  }
  if (selftestFails) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({
      apiVersion: "v1",
      requestId: randomUUID(),
      error: { code: "worker-failed", message: "Diagnose C:\\PrivateFixture\\failure.log" },
    }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    apiVersion: "v1",
    requestId: randomUUID(),
    operation: "health",
    durationMs: 1,
    result: {
      ok: true,
      running: false,
      installPath: "C:\\PrivateFixture\\SSE.exe",
      posixPath: "/home/person/sse.log",
    },
  }));
});
selftestApi.listen(0, "127.0.0.1");
await once(selftestApi, "listening");
const selftestAddress = selftestApi.address();
assert(selftestAddress && typeof selftestAddress === "object");
const selftestStartedAt = performance.now();
const selftest = spawn(process.execPath, ["dist/index.js", "--selftest"], {
  cwd: process.cwd(),
  env: { ...process.env, SSE_API_URL: `http://127.0.0.1:${selftestAddress.port}` },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let selftestStdout = "";
let selftestStderr = "";
selftest.stdout.on("data", (chunk) => { selftestStdout += chunk.toString("utf8"); });
selftest.stderr.on("data", (chunk) => { selftestStderr += chunk.toString("utf8"); });
const [selftestCode] = await once(selftest, "exit");
const selftestMs = performance.now() - selftestStartedAt;
assert.equal(selftestCode, 0, selftestStderr);
assert(!selftestStdout.includes("PrivateFixture") && !selftestStdout.includes("/home/person"));
assert.match(selftestStdout, /Lokaler PC-Pfad/);
assert(selftestMs < 2_500, `MCP-Selftest lud unnoetigen Server-/Werkzeugcode (${selftestMs.toFixed(0)} ms).`);

selftestFails = true;
const failedSelftest = spawn(process.execPath, ["dist/index.js", "--selftest"], {
  cwd: process.cwd(),
  env: { ...process.env, SSE_API_URL: `http://127.0.0.1:${selftestAddress.port}` },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let failedStdout = "";
let failedStderr = "";
failedSelftest.stdout.on("data", (chunk) => { failedStdout += chunk.toString("utf8"); });
failedSelftest.stderr.on("data", (chunk) => { failedStderr += chunk.toString("utf8"); });
const [failedCode] = await once(failedSelftest, "exit");
await new Promise((resolveClose) => selftestApi.close(resolveClose));
assert.equal(failedCode, 1);
assert.equal(failedStdout, "");
assert(!failedStderr.includes("PrivateFixture") && !failedStderr.includes(process.cwd()));
assert.match(failedStderr, /Lokaler PC-Pfad/);

process.stdout.write(`MCP-Startvertrag: stdio, strikte Argumente, Pfadschutz, Hilfe ${helpMs.toFixed(0)} ms, Selftest ${selftestMs.toFixed(0)} ms\n`);
