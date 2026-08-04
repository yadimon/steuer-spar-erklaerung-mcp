import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  assertWindowsPowerShell,
  buildSetupArtifacts,
  MAX_SETUP_FILE_BYTES,
  parseSetupArguments,
  SETUP_USAGE,
  setupArtifactTargetPaths,
  validateSseExecutable,
  writeSetupArtifacts,
} from "../dist/setup.js";
import { loadApiServerConfig } from "../dist/api-config.js";
import { probeWindowsPowerShell } from "../dist/windows-runtime.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-setup-test-"));
try {
  assert.deepEqual(parseSetupArguments([]), { help: false });
  assert.deepEqual(parseSetupArguments(["--help"]), { help: true });
  assert.deepEqual(parseSetupArguments(["-h"]), { help: true });
  assert.throws(() => parseSetupArguments(["--unbekannt"]), /Ungueltige Setup-Argumente/);
  const helpStartedAt = performance.now();
  const help = spawnSync(process.execPath, ["dist/setup-main.js", "--help"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 2_000,
  });
  const helpMs = performance.now() - helpStartedAt;
  assert.equal(help.status, 0, help.stderr);
  assert.equal(help.stdout, `${SETUP_USAGE}\n`);
  assert(!help.stdout.includes("Steuerjahr/Produktprofil"), "--help darf keinen interaktiven Prompt starten.");
  assert(helpMs < 2_500, `Setup-Hilfe lud zu viel Laufzeitcode (${helpMs.toFixed(0)} ms).`);
  const invalid = spawnSync(process.execPath, ["dist/setup-main.js", "--unbekannt"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 2_000,
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Ungueltige Setup-Argumente/);
  assert(!invalid.stdout.includes("Steuerjahr/Produktprofil"), "Ungueltige Argumente duerfen keinen Prompt starten.");
  assertWindowsPowerShell();
  const powershellRuntime = probeWindowsPowerShell();
  assert.equal(powershellRuntime.major, 5);
  assert(powershellRuntime.minor >= 1);
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
  const fakeSseDirectory = join(temporary, "Falsche Programme", "Steuertipps", "Steuerjahr 2025", "SSE.exe");
  mkdirSync(fakeSseDirectory, { recursive: true });
  assert.throws(() => validateSseExecutable(fakeSseDirectory), /regulaere Datei/);

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
  assert.deepEqual(setupArtifactTargetPaths(values), [
    configPath,
    preview.mcpConfigPath,
    preview.apiLauncherPath,
    preview.setupDecisionsPath,
  ]);
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
  assert.throws(() => buildSetupArtifacts({ ...values, port: 0 }), /Port muss/);
  assert.throws(() => buildSetupArtifacts({ ...values, token: "nicht transportierbar mit leerzeichen" }), /API-Token/);
  assert.throws(() => buildSetupArtifacts({ ...values, configPath: "relative-config.json" }), /configPath.*absoluter Pfad/);
  assert.throws(() => buildSetupArtifacts({ ...values, workspaceDir: `${workspaceDir}\nzweite-zeile` }), /Steuerzeichen/);
  assert.throws(() => buildSetupArtifacts({ ...values, resultDir: values.caseDir }), /Ressourcenbereiche/);
  assert.throws(() => buildSetupArtifacts({ ...values, resultDir: workspaceDir }), /Ressourcenbereich/);
  assert.throws(
    () => writeSetupArtifacts({ ...values, configPath: join(workspaceDir, "setup-decisions.json") }, false),
    /unterschiedliche Pfade/,
  );
  const oversizedConfigPath = join(temporary, "oversized", "config.json");
  mkdirSync(join(temporary, "oversized"), { recursive: true });
  writeFileSync(oversizedConfigPath, "x", "utf8");
  truncateSync(oversizedConfigPath, MAX_SETUP_FILE_BYTES + 1);
  assert.throws(
    () => writeSetupArtifacts({ ...values, configPath: oversizedConfigPath }, true),
    /Setup-Datei konnte nicht sicher gelesen werden.*groesser/,
  );

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
  const stableBackups = writeSetupArtifacts(changed, true).backups;
  writeFileSync(stableBackups[0], "manipuliertes-backup\n", "utf8");
  assert.throws(() => writeSetupArtifacts(changed, true), /Backup weicht.*erwarteten Inhalt/);
  process.stdout.write(`Setup-Wizard: schnelle Hilfe in ${helpMs.toFixed(0)} ms, portable Pfadtrennung, Dateilimit, Backup und MCP-Mergevorlage bestanden\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
