/** Tax-neutral WM_CHAR go/no-go probe on the hidden global search QLineEdit. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const server = join(repo, "dist", "index.js");
const launcher = join(repo, "powershell", "run-on-desktop.ps1");
const watcherScript = join(here, "visible-foreground-watch.ps1");
const resultDir = process.env.SSE_TEST_RESULT_DIR;
assert(resultDir, "SSE_TEST_RESULT_DIR fehlt.");
const client = new Client({ name: "sse-hidden-focusless-search-probe", version: "1.0.0" });
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const call = async (name, args = {}, timeout = 120_000) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout });
  if (result?.isError) throw new Error(`${name}: ${fullText(result)}`);
  return JSON.parse(fullText(result));
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function startForegroundWatcher(targetProcessId, forbiddenDesktopName) {
  const nonce = `${process.pid}-${Date.now()}`;
  const readyPath = join(resultDir, `focusless-watch-${nonce}.ready`);
  const stopPath = join(resultDir, `focusless-watch-${nonce}.stop`);
  const child = spawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", watcherScript,
    "-TargetProcessId", String(targetProcessId), "-ReadyPath", readyPath, "-StopPath", stopPath,
    "-ForbiddenDesktopName", forbiddenDesktopName,
    "-TimeoutMs", "120000", "-SampleMs", "10",
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 500 && !existsSync(readyPath); attempt++) {
    assert.equal(child.exitCode, null, `Watcher endete vor Bereitschaft: ${stderr || stdout}`);
    await wait(20);
  }
  assert(existsSync(readyPath), "Watcher wurde nicht bereit.");
  return async () => {
    writeFileSync(stopPath, "stop", "utf8");
    const [code, signal] = await once(child, "exit");
    try {
      assert.equal(signal, null);
      assert.equal(code, 0, stderr);
      return JSON.parse(stdout);
    } finally {
      for (const path of [readyPath, stopPath]) if (existsSync(path)) unlinkSync(path);
    }
  };
}

function runPrivateProbe(desktop, hwnd) {
  const args = Buffer.from(JSON.stringify({ hwnd, expectedBefore: "", value: "SSEWM42" }), "utf8").toString("base64");
  const child = spawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", launcher,
    "-Op", "focusless_write_probe", "-B64", args, "-Desktop", desktop, "-TimeoutSec", "60",
  ], {
    cwd: repo,
    windowsHide: true,
    env: { ...process.env, SSE_MCP_EXPERIMENT_FOCUSLESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return once(child, "exit").then(([code, signal]) => {
    assert.equal(signal, null);
    assert.equal(code, 0, stderr);
    return JSON.parse(stdout.trim());
  });
}

const desktop = `SSEFocusless${process.pid}`;
let started = false;
let stopWatcher = null;
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } }));
try {
  assert.equal((await call("sse_desktop_status")).aktiv, false, "Vorhandener MCP-Desktop wird nicht angefasst.");
  const launch = await call("sse_desktop_start", { mode: "einur", name: desktop, timeoutSec: 20 });
  started = true;
  assert(Number.isInteger(launch.instance?.hwnd), "Hidden-Start meldet kein eindeutiges Hauptfenster.");
  const health = await call("sse_health");
  assert.equal(health.canaryOk, true, `Hidden-SSE ist nach Start nicht gesund: ${JSON.stringify(health)}`);
  const ui = await call("sse_ui_state");
  assert.equal(ui.instance?.pid, launch.pid, "Aktueller Hidden-Snapshot ist nicht an die Start-PID gebunden.");
  assert(Number.isInteger(ui.instance?.hwnd), "Aktueller Hidden-Snapshot meldet kein HWND.");
  stopWatcher = await startForegroundWatcher(launch.pid, desktop);
  const probe = await runPrivateProbe(desktop, ui.instance.hwnd);
  const foreground = await stopWatcher();
  stopWatcher = null;
  assert.equal(foreground.targetSeen, false, `Hidden PID wurde sichtbar foreground: ${JSON.stringify(foreground)}`);
  assert.equal(foreground.forbiddenDesktopSeen, false, `Hidden Desktop wurde Input-Desktop: ${JSON.stringify(foreground)}`);
  assert.equal(probe.verified, true, `WM_CHAR-Go/No-Go scheiterte: ${JSON.stringify(probe)}`);
  assert.equal(probe.observed, "SSEWM42");
  assert.equal(probe.restored, "");
  assert.equal(probe.postedCharacters, 7);
  assert.equal(probe.foregroundLeaseUsed, false);
  assert.equal(probe.physicalInputUsed, false);
  assert.equal(Object.hasOwn(probe, "focusTelemetry"), false, "Probe beruehrte die sichtbare Foreground-Lease.");
  process.stdout.write(`${JSON.stringify({ ok: true, probe, foreground }, null, 2)}\n`);
} finally {
  if (stopWatcher) try { await stopWatcher(); } catch { }
  if (started) try { await call("sse_desktop_stop", { discardChanges: true }); } catch { }
  await client.close();
}
