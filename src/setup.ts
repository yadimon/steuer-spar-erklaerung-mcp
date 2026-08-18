#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { isValidApiToken } from "./api-contract.js";
import { createTextFileExclusive, replaceTextFilesFromStaging } from "./atomic-files.js";
import { readFileBounded } from "./bounded-files.js";
import { assertApiResourceTopology } from "./api-config.js";
import { loadProductProfile } from "./product-profiles.js";
import {
  normalizeSetupPreferences,
  renderSettingsMarkdown,
  renderTrackingMarkdown,
  type SetupPreferenceValues,
} from "./setup-preferences.js";
import {
  assertPersistentProductRoot,
  probeWindowsPowerShell,
  resolveProductMcpEntry,
  resolveProductNode,
} from "./windows-runtime.js";

export { parseSetupArguments, SETUP_USAGE } from "./setup-main-arguments.js";
export { loadStoredSetupPreferences } from "./setup-preferences.js";
export { loadConfirmedSetupPlan } from "./setup-plan.js";

export interface SetupValues {
  repoRoot: string;
  profileId?: string;
  configPath: string;
  sseExecutable: string;
  caseDir?: string;
  documentsDir?: string;
  workspaceDir: string;
  resultDir: string;
  backupsDir?: string;
  port: number;
  token: string;
  preferences?: SetupPreferenceValues;
}

export interface SetupArtifacts {
  apiConfig: Record<string, unknown>;
  mcpConfig?: Record<string, unknown>;
  setupDecisions: Record<string, unknown>;
  setupDecisionsPath: string;
  settingsPath: string;
  settingsContent: string;
  trackingPath: string;
  trackingContent?: string;
  mcpConfigPath?: string;
  apiLauncherPath: string;
  apiLauncherContent: string;
}

export function setupArtifactTargetPaths(
  values: SetupValues,
  artifacts: SetupArtifacts = buildSetupArtifacts(values),
): readonly string[] {
  return [values.configPath, ...(artifacts.mcpConfigPath ? [artifacts.mcpConfigPath] : []), artifacts.apiLauncherPath,
    artifacts.setupDecisionsPath, artifacts.settingsPath];
}

export const MAX_SETUP_FILE_BYTES = 16 * 1024 * 1024;
function readSetupFile(path: string): Buffer {
  try {
    return readFileBounded(path, MAX_SETUP_FILE_BYTES);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Setup-Datei konnte nicht sicher gelesen werden: ${path}: ${detail}`);
  }
}

function readUtf8Strict(bytes: Buffer, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Setup-Datei ist kein gueltiges UTF-8: ${path}`);
  }
}

function backupMatches(path: string, expected: Buffer): boolean {
  try {
    return readFileBounded(path, Math.max(1, expected.length)).equals(expected);
  } catch {
    return false;
  }
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /^(?:token|SSE_API_TOKEN)$/i.test(key) ? "<redacted>" : redactSecrets(entry),
    ]),
  );
}

function assertSetupPath(value: string | undefined, name: string, optional = false): void {
  if (optional && !value) return;
  if (!value || !isAbsolute(value) || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} muss ein absoluter Pfad ohne Steuerzeichen sein.`);
  }
}

export function detectSseExecutables(profileId = "2025", env: NodeJS.ProcessEnv = process.env): string[] {
  const profile = loadProductProfile(profileId);
  const systemDrive = (env.SystemDrive ?? "C:").replace(/[\\/]+$/u, "");
  const systemProgramFiles = resolve(`${systemDrive}\\`, "Program Files");
  const explicitRoots = env.SSE_SETUP_PROGRAM_FILES_ROOTS?.split(";").map((entry) => entry.trim()).filter(Boolean) ?? [];
  const configuredRoots = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean);
  const roots = (explicitRoots.length ? explicitRoots : [...configuredRoots, ...(configuredRoots.length ? [] : [systemProgramFiles])])
    .filter((entry): entry is string => Boolean(entry));
  const candidates = roots.map((root) =>
    join(root, ...profile.executable.defaultRelativePath.split("/")),
  );
  return [...new Set(candidates.map((path) => resolve(path)))].filter((path) => {
    try { return statSync(path).isFile(); } catch { return false; }
  });
}

export function validateSseExecutable(path: string, profileId = "2025"): string {
  const profile = loadProductProfile(profileId);
  const absolute = resolve(path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`${profile.executable.name} wurde nicht als regulaere Datei gefunden: ${absolute}`);
  }
  const parentFolderName = basename(dirname(absolute));
  if (
    basename(absolute).toLowerCase() !== profile.executable.name.toLowerCase() ||
    parentFolderName.toLocaleLowerCase("de-DE") !== profile.executable.installationFolderName.toLocaleLowerCase("de-DE")
  ) {
    throw new Error(
      `Erwartet wird ${profile.executable.name} im Installationsordner '${profile.executable.installationFolderName}'.`,
    );
  }
  return absolute;
}

export function assertWindowsPowerShell(): void {
  probeWindowsPowerShell();
}

export function buildSetupArtifacts(values: SetupValues): SetupArtifacts {
  const profileId = values.profileId ?? "2025";
  loadProductProfile(profileId);
  if (!Number.isInteger(values.port) || values.port < 1 || values.port > 65_535) {
    throw new Error("Port muss zwischen 1 und 65535 liegen.");
  }
  if (!isValidApiToken(values.token)) {
    throw new Error("API-Token muss 24 bis 512 transportierbare Token-Zeichen enthalten.");
  }
  for (const [name, value, optional] of [
    ["repoRoot", values.repoRoot, false],
    ["configPath", values.configPath, false],
    ["sseExecutable", values.sseExecutable, false],
    ["caseDir", values.caseDir, true],
    ["documentsDir", values.documentsDir, true],
    ["workspaceDir", values.workspaceDir, false],
    ["resultDir", values.resultDir, false],
    ["backupsDir", values.backupsDir, true],
  ] as const) {
    assertSetupPath(value, name, optional);
  }
  assertPersistentProductRoot(values.repoRoot);
  const apiUrl = `http://127.0.0.1:${values.port}`;
  const configStem = basename(values.configPath, extname(values.configPath)) || "config";
  const apiLauncherPath = join(dirname(values.configPath), `start-sse-api.${configStem}.hidden.vbs`);
  const setupDecisionsPath = join(values.workspaceDir, "setup-decisions.json");
  const nodeExecutable = resolveProductNode(values.repoRoot);
  const apiMain = join(values.repoRoot, "dist", "api-main.js");
  const command = `"${nodeExecutable}" "${apiMain}" --config "${values.configPath}"`;
  const apiLauncherContent =
    `CreateObject("WScript.Shell").Run "${command.replaceAll('"', '""')}", 0, False\r\n`;
  const documentsDir = values.documentsDir ?? join(values.workspaceDir, "documents");
  const backupsDir = values.backupsDir ?? join(values.workspaceDir, "backups");
  const preferences = normalizeSetupPreferences(values.workspaceDir, values.preferences);
  const mcpConfigPath = preferences.transport === "api-and-mcp"
    ? join(dirname(values.configPath), `mcp-client.${configStem}.json`)
    : undefined;
  const mcpEntry = preferences.transport === "api-and-mcp"
    ? resolveProductMcpEntry(values.repoRoot)
    : undefined;
  for (const [index, path] of preferences.sourceFolders.entries()) {
    assertSetupPath(path, `sourceFolders[${index}]`);
  }
  assertSetupPath(preferences.tracking.path, "trackingPath");
  assertApiResourceTopology({
    ...(values.caseDir ? { caseDir: values.caseDir } : {}),
    documentsDir,
    workspaceDir: values.workspaceDir,
    resultDir: values.resultDir,
    backupsDir,
  });
  for (const sourceFolder of preferences.sourceFolders) {
    assertApiResourceTopology({
      caseDir: sourceFolder,
      documentsDir,
      workspaceDir: values.workspaceDir,
      resultDir: values.resultDir,
      backupsDir,
    });
  }
  return {
    apiConfig: {
      profileId,
      host: "127.0.0.1",
      port: values.port,
      token: values.token,
      sseExecutable: values.sseExecutable,
      ...(values.caseDir ? { caseDir: values.caseDir } : {}),
      documentsDir,
      workspaceDir: values.workspaceDir,
      resultDir: values.resultDir,
      backupsDir,
    },
    ...(mcpConfigPath && mcpEntry ? {
      mcpConfig: {
        mcpServers: {
          "steuer-spar-erklaerung": {
            command: nodeExecutable,
            args: [mcpEntry],
            env: { SSE_API_URL: apiUrl, SSE_API_TOKEN: values.token },
          },
        },
      },
      mcpConfigPath,
    } : {}),
    setupDecisions: {
      schemaVersion: 2,
      profileId,
      requestedMode: preferences.mode,
      transport: preferences.transport,
      useSafeDefaults: preferences.useSafeDefaults,
      initialReadOnlyCheck: preferences.initialReadOnlyCheck,
      documentCollection: preferences.documentCollection,
      sourceFolders: preferences.sourceFolders,
      connectors: preferences.connectors,
      tracking: preferences.tracking,
      priorities: preferences.priorities,
      copyPolicy: "copy-only-after-source-confirmation",
      caseDirectoryConfigured: Boolean(values.caseDir),
      areas: {
        documents: "documents",
        results: "results",
        backups: "backups",
      },
      safety: {
        elsterTransmission: "blocked",
        originals: "never-overwrite-or-delete",
      },
    },
    setupDecisionsPath,
    settingsPath: preferences.settingsPath,
    settingsContent: renderSettingsMarkdown(preferences),
    trackingPath: preferences.tracking.path,
    ...(preferences.tracking.format === "markdown" ? { trackingContent: renderTrackingMarkdown() } : {}),
    apiLauncherPath,
    apiLauncherContent,
  };
}

export function writeSetupArtifacts(
  values: SetupValues,
  allowOverwrite: boolean,
  options: { preserveExistingSettings?: boolean } = {},
) {
  const artifacts = buildSetupArtifacts(values);
  const targets = setupArtifactTargetPaths(values, artifacts);
  const normalizedTargets = targets.map((target) => resolve(target).toLocaleLowerCase("de-DE"));
  if (new Set(normalizedTargets).size !== normalizedTargets.length) {
    throw new Error("Setup-Zieldateien muessen unterschiedliche Pfade verwenden.");
  }
  const settingsAlreadyExists = existsSync(artifacts.settingsPath);
  const preservedTargets = options.preserveExistingSettings && settingsAlreadyExists
    ? new Set([resolve(artifacts.settingsPath).toLocaleLowerCase("de-DE")])
    : new Set<string>();
  const existing = targets.filter(existsSync).filter(
    (target) => !preservedTargets.has(resolve(target).toLocaleLowerCase("de-DE")),
  );
  if (existing.length && !allowOverwrite) {
    throw new Error(`Konfiguration existiert bereits: ${existing.join(", ")}`);
  }
  mkdirSync(dirname(values.configPath), { recursive: true });
  mkdirSync(values.workspaceDir, { recursive: true });
  mkdirSync(values.resultDir, { recursive: true });
  mkdirSync(values.documentsDir ?? join(values.workspaceDir, "documents"), { recursive: true });
  mkdirSync(values.backupsDir ?? join(values.workspaceDir, "backups"), { recursive: true });
  const preferences = normalizeSetupPreferences(values.workspaceDir, values.preferences);
  for (const sourceFolder of preferences.sourceFolders) {
    if (!existsSync(sourceFolder) || !statSync(sourceFolder).isDirectory()) {
      throw new Error(`Freigegebener Quellordner fehlt oder ist kein Ordner: ${sourceFolder}`);
    }
  }
  if (preferences.tracking.format === "xlsx") {
    if (!existsSync(preferences.tracking.path) || !statSync(preferences.tracking.path).isFile()) {
      throw new Error(`Ausgewaehltes Excel-Tracking fehlt oder ist keine Datei: ${preferences.tracking.path}`);
    }
  }
  const backupPlans = existing.map((target) => {
    const bytes = readSetupFile(target);
    const backupExtension = extname(target) || ".bak";
    const digest = createHash("sha256").update(bytes).digest("hex");
    const backup = `${target}.redacted-backup-${digest.slice(0, 12)}${backupExtension}`;
    const text = readUtf8Strict(bytes, target);
    const content = target.toLowerCase().endsWith(".json")
      ? `${JSON.stringify(redactSecrets(JSON.parse(text) as unknown), null, 2)}\n`
      : text;
    return { backup, content, expected: Buffer.from(content, "utf8") };
  });
  for (const { backup, expected } of backupPlans) {
    if (existsSync(backup) && !backupMatches(backup, expected)) {
      throw new Error(`Vorhandenes redigiertes Backup weicht vom erwarteten Inhalt ab: ${backup}`);
    }
  }
  for (const { backup, content, expected } of backupPlans) {
    if (existsSync(backup)) continue;
    try {
      writeFileSync(backup, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      const wonByOtherProcess =
        error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EEXIST";
      if (!wonByOtherProcess || !backupMatches(backup, expected)) throw error;
    }
  }
  const backups = backupPlans.map((plan) => plan.backup);
  const trackingCreated = artifacts.trackingContent
    ? createTextFileExclusive({ path: artifacts.trackingPath, content: artifacts.trackingContent, mode: 0o600 })
    : false;
  replaceTextFilesFromStaging([
    { path: values.configPath, content: `${JSON.stringify(artifacts.apiConfig, null, 2)}\n`, mode: 0o600 },
    ...(artifacts.mcpConfigPath && artifacts.mcpConfig
      ? [{ path: artifacts.mcpConfigPath, content: `${JSON.stringify(artifacts.mcpConfig, null, 2)}\n`, mode: 0o600 }]
      : []),
    { path: artifacts.apiLauncherPath, content: artifacts.apiLauncherContent, mode: 0o600 },
    {
      path: artifacts.setupDecisionsPath,
      content: `${JSON.stringify(artifacts.setupDecisions, null, 2)}\n`,
      mode: 0o600,
    },
    ...(!settingsAlreadyExists || !options.preserveExistingSettings
      ? [{ path: artifacts.settingsPath, content: artifacts.settingsContent, mode: 0o600 }]
      : []),
  ]);
  return {
    apiConfigPath: values.configPath,
    ...(artifacts.mcpConfigPath ? { mcpConfigPath: artifacts.mcpConfigPath } : {}),
    apiLauncherPath: artifacts.apiLauncherPath,
    setupDecisionsPath: artifacts.setupDecisionsPath,
    settingsPath: artifacts.settingsPath,
    trackingPath: artifacts.trackingPath,
    trackingCreated,
    backups,
  };
}
