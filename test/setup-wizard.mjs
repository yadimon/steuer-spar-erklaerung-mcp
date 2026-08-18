import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  assertWindowsPowerShell,
  buildSetupArtifacts,
  loadConfirmedSetupPlan,
  loadStoredSetupPreferences,
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
  assert.deepEqual(parseSetupArguments([]), { help: false, defaults: false, startApi: true });
  assert.deepEqual(parseSetupArguments(["--defaults"]), { help: false, defaults: true, startApi: true });
  assert.deepEqual(parseSetupArguments(["--no-start"]), { help: false, defaults: false, startApi: false });
  assert.deepEqual(parseSetupArguments(["--defaults", "--no-start"]), {
    help: false,
    defaults: true,
    startApi: false,
  });
  assert.deepEqual(parseSetupArguments(["--plan-file", "C:\\private\\setup-plan.json", "--no-start"]), {
    help: false,
    defaults: false,
    startApi: false,
    planFile: "C:\\private\\setup-plan.json",
  });
  assert.deepEqual(parseSetupArguments(["--help"]), { help: true, defaults: false, startApi: false });
  assert.deepEqual(parseSetupArguments(["-h"]), { help: true, defaults: false, startApi: false });
  assert.throws(() => parseSetupArguments(["--unbekannt"]), /Ungueltige Setup-Argumente/);
  assert.throws(() => parseSetupArguments(["--plan-file"]), /Wert.*--plan-file/);
  assert.throws(() => parseSetupArguments(["--plan-file", "a.json", "--plan-file", "b.json"]), /nur einmal/);
  assert.throws(() => parseSetupArguments(["--defaults", "--plan-file", "a.json"]), /nicht zusammen/);
  const helpStartedAt = performance.now();
  const help = spawnSync(process.execPath, ["dist/setup-main.js", "--help"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 2_000,
  });
  const helpMs = performance.now() - helpStartedAt;
  assert.equal(help.status, 0, help.stderr);
  assert.equal(help.stdout, `${SETUP_USAGE}\n`);
  assert.match(help.stdout, /--defaults/);
  assert.match(help.stdout, /--no-start/);
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

  const defaultsRoot = join(temporary, "defaults-e2e");
  const defaultsProgramFiles = join(defaultsRoot, "Program Files");
  const defaultsSse = join(
    defaultsProgramFiles,
    "Steuertipps",
    "SteuerSparErklaerung",
    "Steuerjahr 2025",
    "SSE.exe",
  );
  mkdirSync(join(defaultsSse, ".."), { recursive: true });
  writeFileSync(defaultsSse, "default-sse-fixture", "utf8");
  const defaultsEnvironment = {
    ...process.env,
    LOCALAPPDATA: join(defaultsRoot, "LocalAppData"),
    ProgramFiles: defaultsProgramFiles,
    "ProgramFiles(x86)": defaultsProgramFiles,
    SSE_SETUP_PROGRAM_FILES_ROOTS: defaultsProgramFiles,
  };
  const firstDefaults = spawnSync(process.execPath, ["dist/setup-main.js", "--defaults", "--no-start"], {
    encoding: "utf8",
    env: defaultsEnvironment,
    windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(firstDefaults.status, 0, firstDefaults.stderr);
  assert.match(firstDefaults.stdout, /API noch nicht gestartet/);
  const defaultsConfigPath = join(defaultsEnvironment.LOCALAPPDATA, "SteuerSparErklaerungApi", "config.json");
  const defaultsConfigBefore = JSON.parse(readFileSync(defaultsConfigPath, "utf8"));
  const defaultsSettingsPath = join(defaultsConfigBefore.workspaceDir, "settings.md");
  writeFileSync(defaultsSettingsPath, "# Eigene Default-Einstellung\n", "utf8");
  const secondDefaults = spawnSync(process.execPath, ["dist/setup-main.js", "--defaults", "--no-start"], {
    encoding: "utf8",
    env: defaultsEnvironment,
    windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(secondDefaults.status, 0, secondDefaults.stderr);
  const defaultsConfigAfter = JSON.parse(readFileSync(defaultsConfigPath, "utf8"));
  assert.equal(defaultsConfigAfter.token, defaultsConfigBefore.token, "Default-Reparatur darf das Token nicht rotieren.");
  assert.equal(readFileSync(defaultsSettingsPath, "utf8"), "# Eigene Default-Einstellung\n");

  const planRoot = join(temporary, "plan-e2e");
  const planCaseDir = join(planRoot, "Steuerfaelle", "2025");
  const planSourceDir = join(planRoot, "Belege", "2025");
  mkdirSync(planCaseDir, { recursive: true });
  mkdirSync(planSourceDir, { recursive: true });
  const planPath = join(planRoot, "confirmed-setup-plan.json");
  writeFileSync(planPath, JSON.stringify({
    schemaVersion: 1,
    profileId: "2025",
    caseDir: planCaseDir,
    sourceFolders: [planSourceDir],
  }), "utf8");
  assert.deepEqual(loadConfirmedSetupPlan(planPath), {
    schemaVersion: 1,
    profileId: "2025",
    caseDir: planCaseDir,
    sourceFolders: [planSourceDir],
  });
  const planEnvironment = {
    ...defaultsEnvironment,
    LOCALAPPDATA: join(planRoot, "LocalAppData"),
  };
  const plannedSetup = spawnSync(
    process.execPath,
    ["dist/setup-main.js", "--plan-file", planPath, "--no-start"],
    { encoding: "utf8", env: planEnvironment, windowsHide: true, timeout: 15_000 },
  );
  assert.equal(plannedSetup.status, 0, plannedSetup.stderr);
  assert(!plannedSetup.stdout.includes("(ja/nein)"), "Bestaetigter Plan darf keine Eingabepromenade starten.");
  const planConfigPath = join(planEnvironment.LOCALAPPDATA, "SteuerSparErklaerungApi", "config.json");
  const planConfig = JSON.parse(readFileSync(planConfigPath, "utf8"));
  const planDecisions = JSON.parse(readFileSync(join(planConfig.workspaceDir, "setup-decisions.json"), "utf8"));
  assert.equal(planConfig.profileId, "2025");
  assert.equal(planConfig.caseDir, planCaseDir);
  assert.deepEqual(planDecisions.sourceFolders, [planSourceDir]);
  assert.equal(planDecisions.requestedMode, "read-only-check");
  assert.equal(planDecisions.transport, "api");
  assert.equal(planDecisions.documentCollection, "reference-only");
  assert.equal(planDecisions.useSafeDefaults, true);
  assert.throws(() => loadConfirmedSetupPlan("relative-plan.json"), /--plan-file muss ein absoluter Pfad/);
  const changedPlanSource = join(planRoot, "Belege", "andere");
  mkdirSync(changedPlanSource, { recursive: true });
  const changedPlanPath = join(planRoot, "changed-setup-plan.json");
  writeFileSync(changedPlanPath, JSON.stringify({
    schemaVersion: 1,
    profileId: "2025",
    caseDir: planCaseDir,
    sourceFolders: [changedPlanSource],
  }), "utf8");
  const mismatchedPlan = spawnSync(
    process.execPath,
    ["dist/setup-main.js", "--plan-file", changedPlanPath, "--no-start"],
    { encoding: "utf8", env: planEnvironment, windowsHide: true, timeout: 15_000 },
  );
  assert.notEqual(mismatchedPlan.status, 0);
  assert.match(mismatchedPlan.stderr, /weicht von der vorhandenen Konfiguration ab/);
  assert.deepEqual(JSON.parse(readFileSync(planConfigPath, "utf8")), planConfig);

  const invalidPlanPath = join(planRoot, "invalid-plan.json");
  writeFileSync(invalidPlanPath, JSON.stringify({
    schemaVersion: 1,
    profileId: "2025",
    caseDir: planCaseDir,
    sourceFolders: [],
    token: "must-not-be-accepted",
  }), "utf8");
  assert.throws(() => loadConfirmedSetupPlan(invalidPlanPath), /Unbekanntes Feld 'token'/);
  const missingSourcePlanPath = join(planRoot, "missing-source-plan.json");
  writeFileSync(missingSourcePlanPath, JSON.stringify({
    schemaVersion: 1,
    profileId: "2025",
    caseDir: planCaseDir,
    sourceFolders: [join(planRoot, "fehlt")],
  }), "utf8");
  assert.throws(() => loadConfirmedSetupPlan(missingSourcePlanPath), /Quellordner.*kein Ordner/);

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
  const sourceDir = join(temporary, "belege");
  mkdirSync(sseDir, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(join(repoRoot, "runtime"), { recursive: true });
  mkdirSync(join(repoRoot, "dist"), { recursive: true });
  writeFileSync(sseExecutable, "fixture", "utf8");
  writeFileSync(portableNode, "portable-node-fixture", "utf8");
  writeFileSync(join(repoRoot, "dist", "index.js"), "// mcp fixture\n", "utf8");
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
    preferences: {
      mode: "read-only-check",
      transport: "api-and-mcp",
      documentCollection: "reference-only",
      sourceFolders: [sourceDir],
      connectors: [
        { name: "Gmail", access: "approved" },
        { name: "Drive", access: "not-approved" },
      ],
      tracking: { format: "markdown", path: join(workspaceDir, "tracking.md") },
      initialReadOnlyCheck: true,
      priorities: ["Rechnungen zuerst pruefen."],
    },
  };
  const preview = buildSetupArtifacts(values);
  assert.equal(preview.mcpConfigPath, join(temporary, "local-config", "mcp-client.config.json"));
  assert.equal(preview.apiLauncherPath, join(temporary, "local-config", "start-sse-api.config.hidden.vbs"));
  assert.equal(preview.setupDecisionsPath, join(workspaceDir, "setup-decisions.json"));
  assert.equal(preview.settingsPath, join(workspaceDir, "settings.md"));
  assert.equal(preview.trackingPath, join(workspaceDir, "tracking.md"));
  assert.deepEqual(setupArtifactTargetPaths(values), [
    configPath,
    preview.mcpConfigPath,
    preview.apiLauncherPath,
    preview.setupDecisionsPath,
    preview.settingsPath,
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
    () => buildSetupArtifacts({
      ...values,
      repoRoot: join(temporary, "npm-cache", "_npx", "1234abcd", "node_modules", "steuer-spar-erklaerung-mcp"),
    }),
    /fluechtigen npx-Cache.*npm install --global.*@beta.*portable Release/,
  );
  const apiOnlyRoot = join(temporary, "api-only-package");
  mkdirSync(join(apiOnlyRoot, "dist"), { recursive: true });
  const apiOnly = buildSetupArtifacts({
    ...values,
    repoRoot: apiOnlyRoot,
    preferences: { ...values.preferences, transport: "api" },
  });
  assert.equal(apiOnly.mcpConfig, undefined);
  assert.equal(apiOnly.mcpConfigPath, undefined);
  assert(!setupArtifactTargetPaths({
    ...values,
    repoRoot: apiOnlyRoot,
    preferences: { ...values.preferences, transport: "api" },
  }).some((path) => path.includes("mcp-client")));
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
  const settings = readFileSync(first.settingsPath, "utf8");
  const tracking = readFileSync(first.trackingPath, "utf8");
  assert.equal(apiConfig.sseExecutable, sseExecutable);
  assert.equal(apiConfig.profileId, "2025");
  assert.equal(apiConfig.caseDir, values.caseDir);
  assert.equal(mcpConfig.mcpServers["steuer-spar-erklaerung"].env.SSE_API_TOKEN, values.token);
  assert(apiLauncher.includes(`""${portableNode}""`) && apiLauncher.includes(`--config ""${configPath}""`));
  assert.equal(setupDecisions.profileId, "2025");
  assert.equal(setupDecisions.schemaVersion, 2);
  assert.equal(setupDecisions.requestedMode, "read-only-check");
  assert.equal(setupDecisions.transport, "api-and-mcp");
  assert.equal(setupDecisions.documentCollection, "reference-only");
  assert.deepEqual(setupDecisions.sourceFolders, [sourceDir]);
  assert.deepEqual(setupDecisions.connectors, [
    { name: "Gmail", access: "approved" },
    { name: "Drive", access: "not-approved" },
  ]);
  assert.equal(setupDecisions.copyPolicy, "copy-only-after-source-confirmation");
  assert.equal(setupDecisions.safety.elsterTransmission, "blocked");
  assert(!JSON.stringify(setupDecisions).includes(values.token));
  assert.match(settings, /Rechnungen zuerst pruefen/);
  assert.match(settings, /Gmail: Lesen freigegeben/);
  assert(!settings.includes(values.token));
  assert.match(tracking, /Beleg- und Quellen-Tracking/);
  const storedPreferences = loadStoredSetupPreferences(workspaceDir);
  assert.equal(storedPreferences.mode, "read-only-check");
  assert.equal(storedPreferences.transport, "api-and-mcp");
  assert.deepEqual(storedPreferences.sourceFolders, [sourceDir]);
  assert.equal(storedPreferences.tracking.path, first.trackingPath);
  const loaded = loadApiServerConfig({ SSE_API_CONFIG: first.apiConfigPath });
  assert.equal(loaded.workspaceDir, workspaceDir);
  assert.equal(loaded.profileId, "2025");
  assert.equal(loaded.sseExecutable, sseExecutable);
  assert.throws(() => writeSetupArtifacts(values, false), /existiert bereits/);

  writeFileSync(first.trackingPath, `${tracking}\nManueller Tracking-Eintrag bleibt erhalten.\n`, "utf8");
  const changed = { ...values, port: 43128 };
  const second = writeSetupArtifacts(changed, true);
  assert.equal(second.backups.length, 5);
  assert.equal(second.trackingCreated, false);
  assert.match(readFileSync(second.trackingPath, "utf8"), /Manueller Tracking-Eintrag bleibt erhalten/);
  let redactedJsonBackups = 0;
  for (const backup of second.backups) {
    const backupText = readFileSync(backup, "utf8");
    assert(!backupText.includes(values.token), "Redigiertes Backup enthaelt weiterhin ein API-Token");
    if (backup.toLowerCase().includes(".json.") && backupText.includes("<redacted>")) redactedJsonBackups += 1;
  }
  assert.equal(redactedJsonBackups, 2, "API- und MCP-JSON-Backup wurden nicht redigiert.");
  assert(second.backups.some((backup) => backup.endsWith(".vbs")), "VBS-Backup traegt keine ausfuehrbare Dateiendung.");
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).port, 43128);
  writeFileSync(second.settingsPath, "# Eigene Einstellungen\n\nNicht ersetzen.\n", "utf8");
  const reused = writeSetupArtifacts(changed, true, { preserveExistingSettings: true });
  assert.equal(reused.backups.length, 4);
  assert.equal(readFileSync(reused.settingsPath, "utf8"), "# Eigene Einstellungen\n\nNicht ersetzen.\n");

  const excelTracking = join(temporary, "bestehend.xlsx");
  writeFileSync(excelTracking, "private-excel-fixture", "utf8");
  const excelValues = {
    ...values,
    configPath: join(temporary, "excel-config", "config.json"),
    workspaceDir: join(temporary, "excel-workspace"),
    resultDir: join(temporary, "excel-workspace", "results"),
    preferences: { ...values.preferences, tracking: { format: "xlsx", path: excelTracking } },
  };
  const excelWrite = writeSetupArtifacts(excelValues, false);
  assert.equal(excelWrite.trackingCreated, false);
  assert.equal(readFileSync(excelTracking, "utf8"), "private-excel-fixture");
  assert.throws(
    () => buildSetupArtifacts({
      ...values,
      preferences: { ...values.preferences, tracking: { format: "markdown", path: join(temporary, "outside.md") } },
    }),
    /innerhalb des privaten Arbeitsbereichs/,
  );
  assert.throws(
    () => buildSetupArtifacts({ ...values, preferences: { ...values.preferences, mode: "unknown" } }),
    /Unbekannter Setup-Modus/,
  );
  assert.throws(
    () => buildSetupArtifacts({
      ...values,
      preferences: {
        ...values.preferences,
        sourceFolders: Array.from({ length: 33 }, (_, index) => join(temporary, `source-${index}`)),
      },
    }),
    /Hoechstens 32/,
  );
  assert.throws(
    () => buildSetupArtifacts({
      ...values,
      preferences: { ...values.preferences, sourceFolders: [workspaceDir] },
    }),
    /'cases'.*'workspace'/,
  );
  assert.throws(
    () => writeSetupArtifacts({
      ...values,
      configPath: join(temporary, "missing-source", "config.json"),
      workspaceDir: join(temporary, "missing-source", "workspace"),
      resultDir: join(temporary, "missing-source", "workspace", "results"),
      preferences: {
        ...values.preferences,
        sourceFolders: [join(temporary, "nicht-vorhanden")],
        tracking: { format: "markdown", path: join(temporary, "missing-source", "workspace", "tracking.md") },
      },
    }, false),
    /Quellordner fehlt/,
  );
  const invalidDecisionWorkspace = join(temporary, "invalid-decisions");
  mkdirSync(invalidDecisionWorkspace, { recursive: true });
  writeFileSync(
    join(invalidDecisionWorkspace, "setup-decisions.json"),
    JSON.stringify({ ...setupDecisions, connectors: "Gmail" }),
    "utf8",
  );
  assert.throws(() => loadStoredSetupPreferences(invalidDecisionWorkspace), /Connector-Entscheidungen/);
  const stableBackups = writeSetupArtifacts(changed, true).backups;
  writeFileSync(stableBackups[0], "manipuliertes-backup\n", "utf8");
  assert.throws(() => writeSetupArtifacts(changed, true), /Backup weicht.*erwarteten Inhalt/);
  process.stdout.write(`Setup-Wizard: Hilfe in ${helpMs.toFixed(0)} ms, Einstellungen, Tracking, Backups und MCP-Mergevorlage bestanden\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
