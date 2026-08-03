import { spawn } from "node:child_process";
import { join } from "node:path";

const powershell = process.env.SSE_POWERSHELL_EXE ??
  join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const steps = [
  [powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "powershell/build-native.ps1"]],
  [process.execPath, ["node_modules/typescript/bin/tsc"]],
  [process.execPath, ["test/public-skills.mjs"]],
  [process.execPath, ["test/product-profiles.mjs"]],
  [powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "test/akad-parser-contract.ps1"]],
  [process.execPath, ["test/setup-wizard.mjs"]],
  [process.execPath, ["test/portable-package.mjs"]],
  [process.execPath, ["test/portable-zip-contract.mjs"]],
  [process.execPath, ["test/workspace-containment.mjs"]],
  [process.execPath, ["test/resource-references.mjs"]],
  [powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "test/setup-task-contract.ps1"]],
  [process.execPath, ["test/api-contract.mjs"]],
  [process.execPath, ["test/launch-orchestration.mjs"]],
  [process.execPath, ["test/operation-schema-catalog.mjs"]],
  [process.execPath, ["test/api-main-smoke.mjs"]],
  [process.execPath, ["test/abort-contract.mjs"]],
  [process.execPath, ["test/wrapper-boundary.mjs"]],
  [process.execPath, ["test/mcp-wrapper-all-tools.mjs"]],
  [process.execPath, ["test/with-api.mjs", process.execPath, "test/no-console-window.mjs"]],
  [process.execPath, ["test/worker-timeout.mjs"]],
  [process.execPath, ["test/scenario-parity.mjs"]],
  [process.execPath, ["test/scenario-control-flow.mjs"]],
  [process.execPath, ["test/with-api.mjs", process.execPath, "dist/index.js", "--selftest"]],
  [powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "test/table-region-contract.ps1"]],
  [process.execPath, ["test/with-api.mjs", process.execPath, "test/product-gate.mjs"]],
  [process.execPath, ["test/with-api.mjs", process.execPath, "test/verify-collect.mjs"]],
  [process.execPath, ["test/with-api.mjs", process.execPath, "test/archive-cases.mjs"]],
];

for (const [command, args] of steps) {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "inherit",
    windowsHide: true,
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.signal || result.code !== 0) {
    throw new Error(`Testsuite stoppte bei ${command} (Exit ${result.code}, Signal ${result.signal ?? "-"}).`);
  }
}

process.stdout.write("\nAlle portable API-/MCP-Tests bestanden.\n");
