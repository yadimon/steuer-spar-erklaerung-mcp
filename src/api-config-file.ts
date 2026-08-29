import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_API_HOST, DEFAULT_API_PORT } from "./api-contract.js";
import { readJsonFileStrict } from "./json-files.js";

export const MAX_API_CONFIG_BYTES = 1024 * 1024;

export interface ApiConfigValues {
  profileId: string;
  host: string;
  port: number;
  configPath: string;
  caseDir?: string;
  documentsDir: string;
  workspaceDir: string;
  resultDir: string;
  backupsDir: string;
  sseExecutable?: string;
  operateExperimental?: boolean;
}

export interface ApiConfigOverrides {
  profileId?: string;
  host?: string;
  port?: string | number;
  caseDir?: string;
  documentsDir?: string;
  workspaceDir?: string;
  resultDir?: string;
  backupsDir?: string;
  sseExecutable?: string;
}

interface ConfigFile {
  profileId?: unknown;
  host?: unknown;
  port?: unknown;
  caseDir?: unknown;
  documentsDir?: unknown;
  workspaceDir?: unknown;
  resultDir?: unknown;
  backupsDir?: unknown;
  sseExecutable?: unknown;
  operateExperimental?: unknown;
}

const CONFIG_FIELDS = new Set<keyof ConfigFile>([
  "profileId", "host", "port", "caseDir", "documentsDir",
  "workspaceDir", "resultDir", "backupsDir", "sseExecutable", "operateExperimental",
]);
const STRING_CONFIG_FIELDS = [...CONFIG_FIELDS].filter(
  (field) => field !== "port" && field !== "operateExperimental",
);

export function optionalConfigString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function absolutePath(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (!isAbsolute(value) || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${name} muss ein absoluter Windows-Pfad ohne Steuerzeichen sein.`);
  }
  return resolve(value);
}

export function defaultApiConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredBase = [env.LOCALAPPDATA, env.APPDATA]
    .map((entry) => optionalConfigString(entry))
    .find((entry) => entry !== undefined && isAbsolute(entry) && !/[\u0000-\u001f]/u.test(entry));
  const base = configuredBase ?? join(homedir(), "AppData", "Local");
  if (!isAbsolute(base) || /[\u0000-\u001f]/u.test(base)) {
    throw new Error("Sicherer lokaler Standardpfad fuer die API-Konfiguration fehlt.");
  }
  return join(base, "SteuerSparErklaerungApi", "config.json");
}

function readApiConfigFile(configPath: string): ConfigFile {
  if (!existsSync(configPath)) return {};
  const parsed = readJsonFileStrict(configPath, "API-Konfiguration", MAX_API_CONFIG_BYTES);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`API-Konfiguration ist kein JSON-Objekt: ${configPath}`);
  }
  const file = parsed as ConfigFile;
  if ("token" in file) {
    throw new Error(
      `API-Konfiguration enthaelt das entfallene Feld 'token': ${configPath}. ` +
        "Zeile loeschen - die API braucht kein Token mehr.",
    );
  }
  const unknownFields = Object.keys(file).filter((field) => !CONFIG_FIELDS.has(field as keyof ConfigFile));
  if (unknownFields.length) {
    throw new Error(`Unbekanntes Feld in API-Konfiguration: '${unknownFields.sort()[0]}'.`);
  }
  for (const field of STRING_CONFIG_FIELDS) {
    if (file[field] !== undefined && typeof file[field] !== "string") {
      throw new Error(`API-Konfigurationsfeld '${field}' muss eine Zeichenkette sein.`);
    }
  }
  if (file.port !== undefined && typeof file.port !== "number") {
    throw new Error("API-Konfigurationsfeld 'port' muss eine Zahl sein.");
  }
  if (file.operateExperimental !== undefined && typeof file.operateExperimental !== "boolean") {
    throw new Error("API-Konfigurationsfeld 'operateExperimental' muss ein Wahrheitswert sein.");
  }
  return file;
}

export function resolveApiConfigValues(
  configPath: string,
  overrides: ApiConfigOverrides = {},
): ApiConfigValues {
  const absoluteConfig = resolve(configPath);
  const file = readApiConfigFile(absoluteConfig);
  const host = overrides.host ?? optionalConfigString(file.host) ?? DEFAULT_API_HOST;
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("SSE-API darf aus Sicherheitsgruenden nur an Loopback gebunden werden.");
  }
  const rawPort = overrides.port ?? file.port ?? DEFAULT_API_PORT;
  const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SSE_API_PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }

  const profileId = overrides.profileId ?? optionalConfigString(file.profileId) ?? "2025";
  const caseDir = absolutePath(overrides.caseDir ?? optionalConfigString(file.caseDir), "caseDir");
  const workspaceDir = absolutePath(
    overrides.workspaceDir ?? optionalConfigString(file.workspaceDir),
    "workspaceDir",
  ) ?? join(dirname(absoluteConfig), "workspace");
  const documentsDir = absolutePath(
    overrides.documentsDir ?? optionalConfigString(file.documentsDir),
    "documentsDir",
  ) ?? join(workspaceDir, "documents");
  const resultDir = absolutePath(
    overrides.resultDir ?? optionalConfigString(file.resultDir),
    "resultDir",
  ) ?? join(workspaceDir, "results");
  const backupsDir = absolutePath(
    overrides.backupsDir ?? optionalConfigString(file.backupsDir),
    "backupsDir",
  ) ?? join(workspaceDir, "backups");
  const sseExecutable = absolutePath(
    overrides.sseExecutable ?? optionalConfigString(file.sseExecutable),
    "sseExecutable",
  );
  const operateExperimental = file.operateExperimental === true ? true : undefined;

  return {
    profileId,
    host,
    port,
    configPath: absoluteConfig,
    ...(caseDir ? { caseDir } : {}),
    documentsDir,
    workspaceDir,
    resultDir,
    backupsDir,
    ...(sseExecutable ? { sseExecutable } : {}),
    ...(operateExperimental ? { operateExperimental } : {}),
  };
}
