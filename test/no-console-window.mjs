import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const monitorScript = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$names=@('pwsh','powershell','cmd','conhost','wscript')",
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

const monitor = spawn(
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
  env: { ...process.env },
});
const client = new Client({ name: "sse-no-console-window", version: "1.0.0" });

try {
  await client.connect(transport);
  const response = await client.callTool(
    { name: "sse_health", arguments: {} },
    undefined,
    { timeout: 30_000, maxTotalTimeout: 30_000 },
  );
  const text = response.content?.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n") ?? "";
  assert.notEqual(response.isError, true, `sse_health scheiterte: ${text}`);
} finally {
  await client.close();
}

const [monitorCode, monitorSignal] = await monitorExit;
assert.equal(monitorSignal, null, `Fenstermonitor endete durch ${monitorSignal}`);
assert.equal(monitorCode, 0, `Fenstermonitor Exit ${monitorCode}: ${monitorError}`);
const lines = monitorOutput.trim().split(/\r?\n/);
assert.equal(lines[0], "READY");
const windows = lines[1] ? JSON.parse(lines[1]) : [];
const visibleWindows = Array.isArray(windows) ? windows : windows ? [windows] : [];
assert.deepEqual(visibleWindows, [], `Neue sichtbare Konsolenfenster erkannt: ${JSON.stringify(visibleWindows)}`);
process.stdout.write("Konsolenfenster-Sentinel: echter MCP/API/PowerShell-Aufruf blieb vollstaendig fensterlos\n");
