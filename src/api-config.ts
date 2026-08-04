import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DEFAULT_API_HOST, DEFAULT_API_PORT, isValidApiToken } from "./api-contract.js";
import { loadProductProfile } from "./product-profiles.js";
import { readJsonFileStrict } from "./json-files.js";

export const MAX_API_CONFIG_BYTES = 1024 * 1024;

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

const CONFIG_FIELDS = new Set<keyof ConfigFile>([
  "profileId", "host", "port", "token", "caseDir", "documentsDir",
  "workspaceDir", "resultDir", "backupsDir", "sseExecutable",
]);
const STRING_CONFIG_FIELDS = [...CONFIG_FIELDS].filter((field) => field !== "port");

export const SSE_API_CONFIG_ENVIRONMENT_KEYS = Object.freeze([
  "SSE_API_CONFIG",
  "SSE_API_HOST",
  "SSE_API_PORT",
  "SSE_API_TOKEN",
  "SSE_API_URL",
  "SSE_PROFILE_ID",
  "SSE_CASE_DIR",
  "SSE_DOCUMENTS_DIR",
  "SSE_WORKSPACE_DIR",
  "SSE_RESULT_DIR",
  "SSE_BACKUPS_DIR",
  "SSE_EXECUTABLE",
] as const);

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function absolutePath(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (!isAbsolute(value) || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} muss ein absoluter Windows-Pfad ohne Steuerzeichen sein.`);
  }
  return resolve(value);
}

export interface ApiResourceTopology {
  caseDir?: string;
  documentsDir: string;
  workspaceDir: string;
  resultDir: string;
  backupsDir: string;
}

function pathInside(parent: string, candidate: string): boolean {
  const rel = relative(canonicalTopologyPath(parent), canonicalTopologyPath(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function canonicalTopologyPath(path: string): string {
  const absolute = resolve(path);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return absolute;
    ancestor = parent;
  }
  const tail = relative(ancestor, absolute);
  return resolve(realpathSync(ancestor), tail);
}

function assertDisjoint(
  leftName: string,
  left: string,
  rightName: string,
  right: string,
): void {
  if (pathInside(left, right) || pathInside(right, left)) {
    throw new Error(`Ressourcenbereiche '${leftName}' und '${rightName}' duerfen sich nicht ueberlappen.`);
  }
}

export function assertApiResourceTopology(topology: ApiResourceTopology): void {
  const children = [
    ["documents", topology.documentsDir],
    ["results", topology.resultDir],
    ["backups", topology.backupsDir],
  ] as const;
  for (const [name, path] of [
    ["workspace", topology.workspaceDir],
    ...children,
    ...(topology.caseDir ? [["cases", topology.caseDir] as const] : []),
  ] as const) {
    if (existsSync(path) && !statSync(path).isDirectory()) {
      throw new Error(`Ressourcenbereich '${name}' muss ein Ordner sein.`);
    }
  }
  for (const [name, path] of children) {
    if (pathInside(path, topology.workspaceDir)) {
      throw new Error(`Ressourcenbereich '${name}' darf den Bereich 'workspace' weder enthalten noch ersetzen.`);
    }
  }
  for (let index = 0; index < children.length; index++) {
    for (let other = index + 1; other < children.length; other++) {
      assertDisjoint(children[index]![0], children[index]![1], children[other]![0], children[other]![1]);
    }
  }
  if (topology.caseDir) {
    assertDisjoint("cases", topology.caseDir, "workspace", topology.workspaceDir);
    for (const [name, path] of children) assertDisjoint("cases", topology.caseDir, name, path);
  }
}

export function defaultApiConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA ?? env.APPDATA ?? join(homedir(), "AppData", "Local");
  return join(base, "SteuerSparErklaerungApi", "config.json");
}

/**
 * Eine ausdruecklich benannte Konfiguration ist autoritativ. Geerbte SSE_*
 * Werte duerfen weder Server noch CLI unbemerkt auf einen anderen Port, Token
 * oder Arbeitsbereich umlenken.
 */
export function environmentForExplicitApiConfig(
  configPath: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of SSE_API_CONFIG_ENVIRONMENT_KEYS) delete env[key];
  env.SSE_API_CONFIG = resolve(configPath);
  return env;
}

export function loadApiServerConfig(env: NodeJS.ProcessEnv = process.env): SseApiServerConfig {
  const configPath = resolve(env.SSE_API_CONFIG ?? defaultApiConfigPath(env));
  let file: ConfigFile = {};
  if (existsSync(configPath)) {
    const parsed = readJsonFileStrict(configPath, "API-Konfiguration", MAX_API_CONFIG_BYTES);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`API-Konfiguration ist kein JSON-Objekt: ${configPath}`);
    }
    file = parsed as ConfigFile;
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
  if (!token || !isValidApiToken(token)) {
    throw new Error(
      `API-Token fehlt oder ist ungueltig. '${configPath}' mit dem deutschen Setup-Wizard erzeugen ` +
        "oder SSE_API_TOKEN mit 24 bis 512 transportierbaren Token-Zeichen setzen.",
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
  assertApiResourceTopology({
    ...(caseDir ? { caseDir } : {}),
    documentsDir,
    workspaceDir,
    resultDir,
    backupsDir,
  });

  return {
    profileId,
    host,
    port,
    token,
    configPath,
    ...(caseDir ? { caseDir } : {}),
    documentsDir,
    workspaceDir,
    resultDir,
    backupsDir,
    ...(sseExecutable ? { sseExecutable } : {}),
  };
}
