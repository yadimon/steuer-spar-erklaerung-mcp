import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertWindowsPowerShell, buildSetupArtifacts, validateSseExecutable, writeSetupArtifacts } from "../dist/setup.js";
import { loadApiServerConfig } from "../dist/api-config.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-setup-test-"));
try {
  assertWindowsPowerShell();
  const repoRoot = join(temporary, "portable-checkout");
  const portableNode = join(repoRoot, "runtime", "node.exe");
  const sseDir = join(temporary, "Programme", "Steuertipps", "Steuerjahr 2025");
  const sseExecutable = join(sseDir, "SSE.exe");
  const configPath = join(temporary, "local-config", "config.json");
  const workspaceDir = join(temporary, "workspace");
  const resultDir = join(workspaceDir, "results");
  mkdirSync(sseDir, { recursive: true });
  mkdirSync(join(repoRoot, "runtime"), { recursive: true });
  writeFileSync(sseExecutable, "fixture", "utf8");
  writeFileSync(portableNode, "portable-node-fixture", "utf8");

  const values = {
    repoRoot,
    profileId: "2025",
    configPath,
    sseExecutable: validateSseExecutable(sseExecutable),
    caseDir: join(temporary, "cases"),
    workspaceDir,
    resultDir,
    port: 43127,
    token: "setup-test-token-with-at-least-24-characters",
  };
  const preview = buildSetupArtifacts(values);
  assert.equal(preview.mcpConfigPath, join(temporary, "local-config", "mcp-client.config.json"));
  assert.equal(preview.apiLauncherPath, join(temporary, "local-config", "start-sse-api.config.hidden.vbs"));
  assert.equal(preview.setupDecisionsPath, join(workspaceDir, "setup-decisions.json"));
  assert.equal(preview.apiConfig.host, "127.0.0.1");
  assert.equal(preview.apiConfig.profileId, "2025");
  assert.equal(preview.mcpConfig.mcpServers["steuer-spar-erklaerung"].env.SSE_API_URL, "http://127.0.0.1:43127");
  assert.equal(preview.mcpConfig.mcpServers["steuer-spar-erklaerung"].command, portableNode);
  assert(preview.apiLauncherContent.includes(`""${portableNode}""`));
  assert(preview.apiLauncherContent.includes(`--config ""${configPath}""`));
  assert(!JSON.stringify(preview.mcpConfig).includes(sseExecutable), "MCP-Konfiguration darf SSE.exe nicht kennen");
  assert(!JSON.stringify(preview.mcpConfig).includes(values.caseDir), "MCP-Konfiguration darf Fallordner nicht kennen");

  const alternate = buildSetupArtifacts({ ...values, configPath: join(temporary, "local-config", "zweiter.json") });
  assert.notEqual(alternate.mcpConfigPath, preview.mcpConfigPath);
  assert.notEqual(alternate.apiLauncherPath, preview.apiLauncherPath);

  const first = writeSetupArtifacts(values, false);
  const apiConfig = JSON.parse(readFileSync(first.apiConfigPath, "utf8"));
  const mcpConfig = JSON.parse(readFileSync(first.mcpConfigPath, "utf8"));
  const apiLauncher = readFileSync(first.apiLauncherPath, "utf8");
  const setupDecisions = JSON.parse(readFileSync(first.setupDecisionsPath, "utf8"));
  assert.equal(apiConfig.sseExecutable, sseExecutable);
  assert.equal(apiConfig.profileId, "2025");
  assert.equal(apiConfig.caseDir, values.caseDir);
  assert.equal(mcpConfig.mcpServers["steuer-spar-erklaerung"].env.SSE_API_TOKEN, values.token);
  assert(apiLauncher.includes(`""${portableNode}""`) && apiLauncher.includes(`--config ""${configPath}""`));
  assert.equal(setupDecisions.profileId, "2025");
  assert.equal(setupDecisions.copyPolicy, "copy-only-after-consent");
  assert.equal(setupDecisions.safety.elsterTransmission, "blocked");
  assert(!JSON.stringify(setupDecisions).includes(values.token));
  const loaded = loadApiServerConfig({ SSE_API_CONFIG: first.apiConfigPath });
  assert.equal(loaded.workspaceDir, workspaceDir);
  assert.equal(loaded.profileId, "2025");
  assert.equal(loaded.sseExecutable, sseExecutable);
  assert.throws(() => writeSetupArtifacts(values, false), /existiert bereits/);

  const changed = { ...values, port: 43128 };
  const second = writeSetupArtifacts(changed, true);
  assert.equal(second.backups.length, 4);
  let redactedJsonBackups = 0;
  for (const backup of second.backups) {
    const backupText = readFileSync(backup, "utf8");
    assert(!backupText.includes(values.token), "Redigiertes Backup enthaelt weiterhin ein API-Token");
    if (backup.toLowerCase().includes(".json.") && backupText.includes("<redacted>")) redactedJsonBackups += 1;
  }
  assert.equal(redactedJsonBackups, 2, "API- und MCP-JSON-Backup wurden nicht redigiert.");
  assert(second.backups.some((backup) => backup.endsWith(".vbs")), "VBS-Backup traegt keine ausfuehrbare Dateiendung.");
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).port, 43128);
  process.stdout.write("Setup-Wizard: portable Pfadtrennung, Backup und MCP-Mergevorlage bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
