import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  loadApiConfigValues,
  type ApiConfigValues,
} from "./api-config-values.js";
export {
  defaultApiConfigPath,
  environmentForExplicitApiConfig,
  MAX_API_CONFIG_BYTES,
  SSE_API_CONFIG_ENVIRONMENT_KEYS,
} from "./api-config-values.js";
import { loadProductProfile } from "./product-profiles.js";

export interface SseApiServerConfig extends ApiConfigValues {
  /**
   * Ephemeral test-runner capability. It is deliberately absent from
   * ConfigFile and loadApiServerConfig, so installed/background API servers
   * cannot enable foreground receipt operations through configuration.
   */
  interactiveReceiptLeaseToken?: string;
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

export function loadApiServerConfig(env: NodeJS.ProcessEnv = process.env): SseApiServerConfig {
  const config = loadApiConfigValues(env);
  loadProductProfile(config.profileId);
  assertApiResourceTopology(config);
  return config;
}
