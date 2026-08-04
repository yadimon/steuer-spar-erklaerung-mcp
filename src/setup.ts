#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_API_PORT, isValidApiToken } from "./api-contract.js";
import { replaceTextFilesFromStaging } from "./atomic-files.js";
import { readFileBounded } from "./bounded-files.js";
import { assertApiResourceTopology, defaultApiConfigPath } from "./api-config.js";
import { listProductProfileIds, loadProductProfile } from "./product-profiles.js";
import { probeWindowsPowerShell, resolveProductNode } from "./windows-runtime.js";
import { parseSetupArguments, SETUP_USAGE } from "./setup-main-arguments.js";

export { parseSetupArguments, SETUP_USAGE } from "./setup-main-arguments.js";

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
}

export interface SetupArtifacts {
  apiConfig: Record<string, unknown>;
  mcpConfig: Record<string, unknown>;
  setupDecisions: Record<string, unknown>;
  setupDecisionsPath: string;
  mcpConfigPath: string;
  apiLauncherPath: string;
  apiLauncherContent: string;
}

export function setupArtifactTargetPaths(
  values: SetupValues,
  artifacts: SetupArtifacts = buildSetupArtifacts(values),
): readonly string[] {
  return [values.configPath, artifacts.mcpConfigPath, artifacts.apiLauncherPath, artifacts.setupDecisionsPath];
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
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], systemProgramFiles]
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
  const apiUrl = `http://127.0.0.1:${values.port}`;
  const configStem = basename(values.configPath, extname(values.configPath)) || "config";
  const mcpConfigPath = join(dirname(values.configPath), `mcp-client.${configStem}.json`);
  const apiLauncherPath = join(dirname(values.configPath), `start-sse-api.${configStem}.hidden.vbs`);
  const setupDecisionsPath = join(values.workspaceDir, "setup-decisions.json");
  const nodeExecutable = resolveProductNode(values.repoRoot);
  const apiMain = join(values.repoRoot, "dist", "api-main.js");
  const command = `"${nodeExecutable}" "${apiMain}" --config "${values.configPath}"`;
  const apiLauncherContent =
    `CreateObject("WScript.Shell").Run "${command.replaceAll('"', '""')}", 0, False\r\n`;
  const documentsDir = values.documentsDir ?? join(values.workspaceDir, "documents");
  const backupsDir = values.backupsDir ?? join(values.workspaceDir, "backups");
  assertApiResourceTopology({
    ...(values.caseDir ? { caseDir: values.caseDir } : {}),
    documentsDir,
    workspaceDir: values.workspaceDir,
    resultDir: values.resultDir,
    backupsDir,
  });
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
    mcpConfig: {
      mcpServers: {
        "steuer-spar-erklaerung": {
          command: nodeExecutable,
          args: [join(values.repoRoot, "dist", "index.js")],
          env: { SSE_API_URL: apiUrl, SSE_API_TOKEN: values.token },
        },
      },
    },
    setupDecisions: {
      schemaVersion: 1,
      profileId,
      requestedMode: "not-asked",
      documentCollection: "not-asked",
      connectorAccess: "not-asked",
      copyPolicy: "copy-only-after-consent",
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
    mcpConfigPath,
    apiLauncherPath,
    apiLauncherContent,
  };
}

export function writeSetupArtifacts(
  values: SetupValues,
  allowOverwrite: boolean,
): { apiConfigPath: string; mcpConfigPath: string; apiLauncherPath: string; setupDecisionsPath: string; backups: string[] } {
  const artifacts = buildSetupArtifacts(values);
  const targets = setupArtifactTargetPaths(values, artifacts);
  const normalizedTargets = targets.map((target) => resolve(target).toLocaleLowerCase("de-DE"));
  if (new Set(normalizedTargets).size !== normalizedTargets.length) {
    throw new Error("Setup-Zieldateien muessen unterschiedliche Pfade verwenden.");
  }
  const existing = targets.filter(existsSync);
  if (existing.length && !allowOverwrite) {
    throw new Error(`Konfiguration existiert bereits: ${existing.join(", ")}`);
  }
  mkdirSync(dirname(values.configPath), { recursive: true });
  mkdirSync(values.workspaceDir, { recursive: true });
  mkdirSync(values.resultDir, { recursive: true });
  mkdirSync(values.documentsDir ?? join(values.workspaceDir, "documents"), { recursive: true });
  mkdirSync(values.backupsDir ?? join(values.workspaceDir, "backups"), { recursive: true });
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
      // Ein paralleler identischer Setup-Lauf darf exakt dasselbe deterministische
      // Backup gewonnen haben. Abweichende oder unlesbare Dateien bleiben hart
      // gesperrt und werden niemals ueberschrieben.
      const wonByOtherProcess =
        error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EEXIST";
      if (!wonByOtherProcess || !backupMatches(backup, expected)) throw error;
    }
  }
  const backups = backupPlans.map((plan) => plan.backup);
  replaceTextFilesFromStaging([
    { path: values.configPath, content: `${JSON.stringify(artifacts.apiConfig, null, 2)}\n`, mode: 0o600 },
    { path: artifacts.mcpConfigPath, content: `${JSON.stringify(artifacts.mcpConfig, null, 2)}\n`, mode: 0o600 },
    { path: artifacts.apiLauncherPath, content: artifacts.apiLauncherContent, mode: 0o600 },
    {
      path: artifacts.setupDecisionsPath,
      content: `${JSON.stringify(artifacts.setupDecisions, null, 2)}\n`,
      mode: 0o600,
    },
  ]);
  return {
    apiConfigPath: values.configPath,
    mcpConfigPath: artifacts.mcpConfigPath,
    apiLauncherPath: artifacts.apiLauncherPath,
    setupDecisionsPath: artifacts.setupDecisionsPath,
    backups,
  };
}

export async function runSetupMain(args: readonly string[]): Promise<void> {
  const options = parseSetupArguments(args);
  if (options.help) {
    stdout.write(`${SETUP_USAGE}\n`);
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const defaultsPath = defaultApiConfigPath();
  const prompt = createInterface({ input: stdin, output: stdout });
  const ask = async (label: string, defaultValue = ""): Promise<string> => {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await prompt.question(`${label}${suffix}: `)).trim();
    return answer || defaultValue;
  };

  try {
    stdout.write(`${SETUP_USAGE.split("\n")[0]}\n\n`);
    assertWindowsPowerShell();
    const supportedProfiles = listProductProfileIds().filter((id) => {
      try { loadProductProfile(id); return true; } catch { return false; }
    });
    if (!supportedProfiles.length) throw new Error("Kein produktiv freigegebenes SSE-Profil ist enthalten.");
    const profileId = await ask(
      `Steuerjahr/Produktprofil (${supportedProfiles.join(", ")})`,
      supportedProfiles.includes("2025") ? "2025" : supportedProfiles[0],
    );
    if (!supportedProfiles.includes(profileId)) throw new Error(`Produktprofil '${profileId}' ist nicht freigegeben.`);
    const profile = loadProductProfile(profileId);
    const detected = detectSseExecutables(profileId);
    const sseExecutable = validateSseExecutable(
      await ask(`Pfad zu ${profile.executable.name} (${profile.executable.installationFolderName})`, detected.length === 1 ? detected[0] : ""),
      profileId,
    );
    const caseDirInput = await ask("Optionaler Fallordner (leer lassen erlaubt)");
    const configPath = resolve(await ask("Lokale API-Konfiguration", defaultsPath));
    const workspaceDir = resolve(
      await ask("Arbeitsbereich fuer Szenarioeingaben", join(dirname(configPath), "workspace")),
    );
    const documentsDir = resolve(await ask("Dokumentenordner", join(workspaceDir, "documents")));
    const resultDir = resolve(await ask("Ergebnisordner", join(workspaceDir, "results")));
    const backupsDir = resolve(await ask("Sicherungsordner", join(workspaceDir, "backups")));
    const port = Number(await ask("Lokaler API-Port", String(DEFAULT_API_PORT)));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Port muss zwischen 1 und 65535 liegen.");
    const token = randomBytes(32).toString("base64url");
    const values: SetupValues = {
      repoRoot,
      profileId,
      configPath,
      sseExecutable,
      ...(caseDirInput ? { caseDir: resolve(caseDirInput) } : {}),
      documentsDir,
      workspaceDir,
      resultDir,
      backupsDir,
      port,
      token,
    };
    const existingTargets = setupArtifactTargetPaths(values).filter(existsSync);
    const overwrite = existingTargets.length
      ? /^(j|ja|y|yes)$/i.test(await ask(
          `${existingTargets.length} vorhandene Setup-Datei(en) nach redigiertem Backup ersetzen? (ja/nein)`,
          "nein",
        ))
      : false;
    const written = writeSetupArtifacts(values, overwrite);
    stdout.write(`\nAPI-Konfiguration: ${written.apiConfigPath}\n`);
    stdout.write(`MCP-Mergevorlage: ${written.mcpConfigPath}\n`);
    stdout.write(`Fensterloser API-Starter: ${written.apiLauncherPath}\n`);
    stdout.write(`Setup-Entscheidungen: ${written.setupDecisionsPath}\n`);
    if (written.backups.length) stdout.write(`Backups: ${written.backups.join(", ")}\n`);
    stdout.write("Token wurde nur in den lokalen Konfigurationsdateien gespeichert.\n");
    stdout.write(`API direkt starten: "${resolveProductNode(repoRoot)}" "${join(repoRoot, "dist", "api-main.js")}" --config "${configPath}"\n`);
    stdout.write("Nach Token- oder Pfadaenderungen eine laufende API bzw. die geplante Aufgabe neu starten.\n");
  } finally {
    prompt.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runSetupMain(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Setup fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
