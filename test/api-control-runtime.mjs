import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { readApiHealthz } from "../dist/api-client.js";
import { requestApiShutdown } from "../dist/api-control-client.js";
import { listenOnFetchablePort } from "./fetchable-port.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sse-api-control-runtime-"));
const powershell = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const identityHelper = resolve("test/performance/owned-process-identity.ps1");
const probe = createServer();
const port = await listenOnFetchablePort(probe);
await new Promise((done) => probe.close(done));
const configPath = join(temporary, "api.json");
writeFileSync(configPath, JSON.stringify({ profileId: "2025", host: "127.0.0.1", port }));
const env = { ...process.env };
for (const name of Object.keys(env).filter((name) => name.startsWith("SSE_"))) delete env[name];
Object.assign(env, { SSE_WORKER_PREWARM: "1", SSE_WORKER_PREWARM_POOL_SIZE: "1" });
const child = spawn(process.execPath, [resolve("dist/api-main.js"), "--config", configPath], {
  env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-64 * 1024); });
child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-64 * 1024); });
const exited = once(child, "exit");
const baseUrl = `http://127.0.0.1:${port}`;
const ownedSpares = [];
async function waitUntil(check, message, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  assert.fail(`${message}: ${output}`);
}
function inspect(pid) {
  return JSON.parse(execFileSync(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", identityHelper,
    "-Mode", "Inspect", "-TargetProcessId", String(pid),
  ], { encoding: "utf8", windowsHide: true, timeout: 15_000 }));
}
function gone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { assert.equal(error.code, "ESRCH"); return true; }
}
try {
  const health = await waitUntil(async () => {
    assert.equal(child.exitCode, null, "The owned API exited before readiness.");
    let result;
    try { result = await readApiHealthz({ baseUrl, signal: AbortSignal.timeout(1_000) }); }
    catch { return false; }
    return result.prewarm?.ready === true && result;
  }, "Owned API and its real reserve worker did not become ready");
  assert.equal(health.processId, child.pid);
  const childrenScript = [
    "$ErrorActionPreference='Stop'",
    "$items=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$env:SSE_TEST_OWNED_PARENT) | Select-Object ProcessId,Name)",
    "ConvertTo-Json -InputObject $items -Compress",
  ].join("\n");
  const children = JSON.parse(execFileSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", childrenScript], {
    env: { ...process.env, SSE_TEST_OWNED_PARENT: String(child.pid) },
    encoding: "utf8", windowsHide: true, timeout: 15_000,
  }));
  const spares = children.filter((entry) => entry.Name.toLowerCase() === "powershell.exe");
  assert.equal(spares.length, 1, "The owned API must have exactly one real reserve worker.");
  for (const spare of spares) {
    const observed = inspect(spare.ProcessId);
    assert.equal(observed.outcome, "running");
    ownedSpares.push({ pid: spare.ProcessId, identity: observed.identity });
  }
  const accepted = await requestApiShutdown({ confirm: true, instanceId: health.instanceId }, {
    baseUrl, expectedInstanceId: health.instanceId,
  });
  assert.equal(accepted.processId, child.pid);
  assert.equal(accepted.processExited, false);
  let exitTimer;
  const [code, signal] = await Promise.race([
    exited,
    new Promise((_done, reject) => {
      exitTimer = setTimeout(() => reject(new Error("Owned API did not exit after acceptance.")), 15_000);
    }),
  ]).finally(() => clearTimeout(exitTimer));
  assert.equal(code, 0, output);
  assert.equal(signal, null);
  await waitUntil(() => gone(child.pid), "Owned API PID remained present", 5_000);
  for (const spare of ownedSpares) {
    await waitUntil(() => gone(spare.pid), "An owned reserve worker survived API shutdown", 10_000);
  }
  const log = readFileSync(join(temporary, "logs", "api.jsonl"), "utf8")
    .trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  const events = log.map((entry) => entry.event);
  assert(events.indexOf("shutdown-accepted") >= 0);
  assert(events.indexOf("shutdown-requested") > events.indexOf("shutdown-accepted"));
  assert(events.indexOf("shutdown-complete") > events.indexOf("shutdown-requested"));
  assert(!events.includes("shutdown-forced"), "Normal shutdown needed forced socket cleanup.");
  await assert.rejects(readApiHealthz({ baseUrl, signal: AbortSignal.timeout(1_000) }), (error) => error.kind === "network");
} finally {
  // Only handles/identities created and recorded above are eligible for cleanup.
  child.kill();
  for (const spare of ownedSpares) {
    const result = JSON.parse(execFileSync(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", identityHelper,
      "-Mode", "Terminate", "-TargetProcessId", String(spare.pid),
      "-ExpectedCreationTimeUtcTicks", spare.identity.creationTimeUtcTicks,
      "-ExpectedImageNameLower", spare.identity.imageNameLower,
      "-ExpectedImagePathTextSha256", spare.identity.imagePathTextSha256,
    ], { encoding: "utf8", windowsHide: true, timeout: 15_000 }));
    assert(["not-running", "terminated", "identity-mismatch"].includes(result.outcome));
  }
  rmSync(temporary, { recursive: true, force: true });
}
console.log("api-control-runtime: PASS");
