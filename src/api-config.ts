import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_API_HOST, DEFAULT_API_PORT } from "./api-contract.js";
import { loadProductProfile } from "./product-profiles.js";

export interface SseApiServerConfig {
  profileId: string;
  host: string;
  port: number;
  token: string;
  configPath: string;
  caseDir?: string;
  documentsDir: string;
  workspaceDir: string;
  resultDir: string;
  backupsDir: string;
  sseExecutable?: string;
}
interface ConfigFile {
  profileId?: unknown;
  host?: unknown;
  port?: unknown;
  token?: unknown;
  caseDir?: unknown;
  documentsDir?: unknown;
  workspaceDir?: unknown;
  resultDir?: unknown;
  backupsDir?: unknown;
  sseExecutable?: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function absolutePath(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (!isAbsolute(value)) throw new Error(`${name} muss ein absoluter Windows-Pfad sein.`);
  return resolve(value);
}

export function defaultApiConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA ?? env.APPDATA ?? join(homedir(), "AppData", "Local");
  return join(base, "SteuerSparErklaerungApi", "config.json");
}

export function loadApiServerConfig(env: NodeJS.ProcessEnv = process.env): SseApiServerConfig {
  const configPath = resolve(env.SSE_API_CONFIG ?? defaultApiConfigPath(env));
  let file: ConfigFile = {};
  if (existsSync(configPath)) {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`API-Konfiguration ist kein JSON-Objekt: ${configPath}`);
    }
    file = parsed as ConfigFile;
  }

  const host = optionalString(env.SSE_API_HOST) ?? optionalString(file.host) ?? DEFAULT_API_HOST;
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("SSE-API darf aus Sicherheitsgruenden nur an Loopback gebunden werden.");
  }

  const rawPort = optionalString(env.SSE_API_PORT) ?? file.port ?? DEFAULT_API_PORT;
  const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SSE_API_PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }

  const token = optionalString(env.SSE_API_TOKEN) ?? optionalString(file.token);
  if (!token || token.length < 24) {
    throw new Error(
      `API-Token fehlt oder ist zu kurz. '${configPath}' mit dem deutschen Setup-Wizard erzeugen ` +
        "oder SSE_API_TOKEN mit mindestens 24 Zeichen setzen.",
    );
  }

  const profileId = optionalString(env.SSE_PROFILE_ID) ?? optionalString(file.profileId) ?? "2025";
  loadProductProfile(profileId);

  const caseDir = absolutePath(optionalString(env.SSE_CASE_DIR) ?? optionalString(file.caseDir), "caseDir");
  const configuredWorkspaceDir = optionalString(env.SSE_WORKSPACE_DIR) ?? optionalString(file.workspaceDir);
  const workspaceDir =
    absolutePath(configuredWorkspaceDir, "workspaceDir") ?? join(dirname(configPath), "workspace");
  const configuredDocumentsDir = optionalString(env.SSE_DOCUMENTS_DIR) ?? optionalString(file.documentsDir);
  const documentsDir = absolutePath(configuredDocumentsDir, "documentsDir") ?? join(workspaceDir, "documents");
  const configuredResultDir = optionalString(env.SSE_RESULT_DIR) ?? optionalString(file.resultDir);
  const resultDir = absolutePath(configuredResultDir, "resultDir") ?? join(workspaceDir, "results");
  const configuredBackupsDir = optionalString(env.SSE_BACKUPS_DIR) ?? optionalString(file.backupsDir);
  const backupsDir = absolutePath(configuredBackupsDir, "backupsDir") ?? join(workspaceDir, "backups");
  const sseExecutable = absolutePath(
    optionalString(env.SSE_EXECUTABLE) ?? optionalString(file.sseExecutable),
    "sseExecutable",
  );

  return {
    profileId,
    host,
    port,
    token,
    configPath,
    caseDir,
    documentsDir,
    workspaceDir,
    resultDir,
    backupsDir,
    sseExecutable,
  };
}
