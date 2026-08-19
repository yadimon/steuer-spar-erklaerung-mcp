import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseMcpLauncherArguments } from "../dist/api-mcp-bootstrap.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-mcp-launcher-"));
try {
  const configPath = join(temporary, "config.json");
  const entryPath = join(temporary, "server.mjs");
  const outputPath = join(temporary, "environment.json");
  const workspace = join(temporary, "workspace");
  const sseExecutable = join(temporary, "Steuertipps", "Steuerjahr 2025", "SSE.exe");
  mkdirSync(join(sseExecutable, ".."), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  writeFileSync(sseExecutable, "fixture", "utf8");
  writeFileSync(configPath, JSON.stringify({
    profileId: "2025",
    host: "127.0.0.1",
    port: 43127,
    token: "launcher-test-token-with-at-least-24-characters",
    sseExecutable,
    workspaceDir: workspace,
    documentsDir: join(workspace, "documents"),
    resultDir: join(workspace, "results"),
    backupsDir: join(workspace, "backups"),
  }), "utf8");
  writeFileSync(entryPath, `
    import { writeFileSync } from "node:fs";
    writeFileSync(process.env.SSE_LAUNCHER_TEST_OUTPUT, JSON.stringify({
      url: process.env.SSE_API_URL,
      token: process.env.SSE_API_TOKEN,
      config: process.env.SSE_API_CONFIG ?? null,
      caseDir: process.env.SSE_CASE_DIR ?? null
    }));
  `, "utf8");

  assert.deepEqual(
    parseMcpLauncherArguments(["--config", configPath, "--mcp-entry", entryPath]),
    { configPath, mcpEntry: entryPath },
  );
  assert.throws(() => parseMcpLauncherArguments(["--config", configPath]), /Erwartet/);
  assert.throws(() => parseMcpLauncherArguments(["--config", "relative.json", "--mcp-entry", entryPath]), /absoluter Pfad/);

  const launched = spawnSync(process.execPath, [
    "dist/api-mcp-bootstrap.js", "--config", configPath, "--mcp-entry", entryPath,
  ], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      SSE_LAUNCHER_TEST_OUTPUT: outputPath,
      SSE_API_TOKEN: "must-be-replaced",
      SSE_API_CONFIG: "must-be-removed",
      SSE_CASE_DIR: "must-be-removed",
    },
  });
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(launched.stdout, "", "Bootstrap darf das MCP-stdio-Protokoll nicht verunreinigen.");
  const observed = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.deepEqual(observed, {
    url: "http://127.0.0.1:43127",
    token: "launcher-test-token-with-at-least-24-characters",
    config: null,
    caseDir: null,
  });
  assert(!launched.stderr.includes(observed.token), "Bootstrap darf Token nicht ausgeben.");
  process.stdout.write("MCP-Bootstrap: tokenfreie Client-Konfiguration und interne Token-Uebergabe bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
