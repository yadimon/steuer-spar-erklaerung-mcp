import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, "..");
export const worker = join(root, "powershell", "sse-worker.ps1");
export const powershell = join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const markerPath = join(tmpdir(), "sse-mcp-desktop.txt");

export const directWorker = (operation, args, env = {}, workerPath = worker) => {
  const b64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  const output = execFileSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", workerPath, "-Op", operation, "-B64", b64],
    { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } },
  );
  return JSON.parse(output.trim());
};

export const directWorkerBase64 = (operation, b64) => {
  const output = execFileSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", worker, "-Op", operation, "-B64", b64],
    { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env } },
  );
  return JSON.parse(output.trim());
};

export const ssePids = () => execFileSync(
  powershell,
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();

export const desktopMarkerState = () => existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null;
