import { resolve } from "node:path";
import {
  defaultApiConfigPath,
  optionalConfigString,
  resolveApiConfigValues,
  type ApiConfigValues,
} from "./api-config-file.js";
export {
  defaultApiConfigPath,
  MAX_API_CONFIG_BYTES,
  type ApiConfigValues,
} from "./api-config-file.js";

export const SSE_API_CONFIG_ENVIRONMENT_KEYS = Object.freeze([
  "SSE_API_CONFIG",
  "SSE_API_HOST",
  "SSE_API_PORT",
  "SSE_API_URL",
  "SSE_PROFILE_ID",
  "SSE_CASE_DIR",
  "SSE_DOCUMENTS_DIR",
  "SSE_WORKSPACE_DIR",
  "SSE_RESULT_DIR",
  "SSE_BACKUPS_DIR",
  "SSE_EXECUTABLE",
] as const);

/**
 * Eine ausdruecklich benannte Konfiguration ist autoritativ. Geerbte SSE_*
 * Werte duerfen weder Server noch CLI unbemerkt auf einen anderen Port oder
 * Arbeitsbereich umlenken.
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

export function loadApiConfigValues(env: NodeJS.ProcessEnv = process.env): ApiConfigValues {
  const configPath = resolve(env.SSE_API_CONFIG ?? defaultApiConfigPath(env));
  const profileId = optionalConfigString(env.SSE_PROFILE_ID);
  const host = optionalConfigString(env.SSE_API_HOST);
  const port = optionalConfigString(env.SSE_API_PORT);
  const caseDir = optionalConfigString(env.SSE_CASE_DIR);
  const documentsDir = optionalConfigString(env.SSE_DOCUMENTS_DIR);
  const workspaceDir = optionalConfigString(env.SSE_WORKSPACE_DIR);
  const resultDir = optionalConfigString(env.SSE_RESULT_DIR);
  const backupsDir = optionalConfigString(env.SSE_BACKUPS_DIR);
  const sseExecutable = optionalConfigString(env.SSE_EXECUTABLE);
  return resolveApiConfigValues(configPath, {
    ...(profileId ? { profileId } : {}),
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(caseDir ? { caseDir } : {}),
    ...(documentsDir ? { documentsDir } : {}),
    ...(workspaceDir ? { workspaceDir } : {}),
    ...(resultDir ? { resultDir } : {}),
    ...(backupsDir ? { backupsDir } : {}),
    ...(sseExecutable ? { sseExecutable } : {}),
  });
}
