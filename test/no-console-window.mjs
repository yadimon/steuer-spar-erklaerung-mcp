import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const monitorScript = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$names=@('node','pwsh','powershell','cmd','conhost','wscript')",
  "$baseline=@{}",
  "foreach($p in Get-Process -Name $names){if($p.MainWindowHandle -ne 0){$baseline[\"$($p.Id):$([int64]$p.MainWindowHandle)\"]=$true}}",
  "$seen=@{}",
  "[Console]::Out.WriteLine('READY')",
  "$sw=[Diagnostics.Stopwatch]::StartNew()",
  "while($sw.ElapsedMilliseconds -lt 5000){",
  " foreach($p in Get-Process -Name $names){",
  "  if($p.MainWindowHandle -ne 0){",
  "   $key=\"$($p.Id):$([int64]$p.MainWindowHandle)\"",
  "   if(-not $baseline.ContainsKey($key)){$seen[$key]=[pscustomobject]@{pid=$p.Id;process=$p.ProcessName;hwnd=[int64]$p.MainWindowHandle;title=$p.MainWindowTitle}}",
  "  }",
  " }",
  " Start-Sleep -Milliseconds 20",
  "}",
  "[Console]::Out.WriteLine((@($seen.Values)|ConvertTo-Json -Compress))",
].join("\n");

const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const portAddress = portProbe.address();
assert(portAddress && typeof portAddress === "object");
await new Promise((resolveClose) => portProbe.close(resolveClose));
const temporary = mkdtempSync(join(tmpdir(), "sse-no-console-window-"));
const configPath = resolve(temporary, "config.json");
writeFileSync(configPath, `${JSON.stringify({ profileId: "2025", host: "127.0.0.1", port: portAddress.port })}\n`);
let apiPid;
let monitor;
let client;
let clientClosed = false;

function discoverOwnedApiPids() {
  const script = [
    "$target=$env:SSE_TEST_CONFIG_PATH",
    "$pids=@(Get-CimInstance Win32_Process | Where-Object {",
    "  $_.CommandLine -and $_.CommandLine.Contains($target) -and $_.CommandLine.Contains('api-main.js')",
    "} | Select-Object -ExpandProperty ProcessId)",
    "[Console]::Out.WriteLine(($pids | ConvertTo-Json -Compress))",
  ].join("\n");
  const result = spawnSync("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, SSE_TEST_CONFIG_PATH: configPath },
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(Number.isInteger);
  } catch {
    return [];
  }
}

try {
  monitor = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", monitorScript],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const monitorExit = once(monitor, "exit");
  let monitorOutput = "";
  let monitorError = "";
  monitor.stdout.on("data", (chunk) => { monitorOutput += chunk.toString("utf8"); });
  monitor.stderr.on("data", (chunk) => { monitorError += chunk.toString("utf8"); });
  while (!monitorOutput.includes("READY\n") && !monitorOutput.includes("READY\r\n")) {
    if (monitor.exitCode !== null) throw new Error(`Fenstermonitor endete vor READY: ${monitorError}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(here, "..", "dist", "index.js")],
    env: { ...process.env, SSE_API_URL: "", SSE_API_CONFIG: configPath },
  });
  client = new Client({ name: "sse-no-console-window", version: "1.0.0" });
  await client.connect(transport);
  const health = await fetch(`http://127.0.0.1:${portAddress.port}/healthz`).then((response) => response.json());
  assert(Number.isInteger(health.processId) && health.processId > 0);
  apiPid = health.processId;
  const response = await client.callTool(
    { name: "sse_health", arguments: {} },
    undefined,
    { timeout: 30_000, maxTotalTimeout: 30_000 },
  );
  const text = response.content?.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n") ?? "";
  assert.notEqual(response.isError, true, `sse_health scheiterte: ${text}`);
  await client.close();
  clientClosed = true;

  const [monitorCode, monitorSignal] = await monitorExit;
  assert.equal(monitorSignal, null, `Fenstermonitor endete durch ${monitorSignal}`);
  assert.equal(monitorCode, 0, `Fenstermonitor Exit ${monitorCode}: ${monitorError}`);
  const lines = monitorOutput.trim().split(/\r?\n/);
  assert.equal(lines[0], "READY");
  const windows = lines[1] ? JSON.parse(lines[1]) : [];
  const visibleWindows = Array.isArray(windows) ? windows : windows ? [windows] : [];
  assert.deepEqual(visibleWindows, [], `Neue sichtbare Konsolenfenster erkannt: ${JSON.stringify(visibleWindows)}`);
  process.stdout.write("Konsolenfenster-Sentinel: echter MCP/API/PowerShell-Aufruf blieb vollstaendig fensterlos\n");
} finally {
  if (client && !clientClosed) await client.close().catch(() => {});
  if (monitor?.exitCode === null) monitor.kill();
  for (const pid of new Set([...(apiPid ? [apiPid] : []), ...discoverOwnedApiPids()])) {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
  rmSync(resolve(temporary), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
