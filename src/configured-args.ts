import type { SseApiServerConfig } from "./api-config.js";
import type { SseApiOperation } from "./api-contract.js";
import { join } from "node:path";
import { API_RESOURCE_BINDINGS } from "./api-resource-bindings.js";
import { ExecutorArgumentError } from "./executor-errors.js";
import { resolveReceiptManagerBulkReferences } from "./bulk-plan-executor.js";
import { resolveResourceReference, type ResourceArea, type ResourceRoots, type ResolvedResourceReference } from "./resources.js";

export interface ConfiguredArguments {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
}

export function resourceRoots(config: SseApiServerConfig): ResourceRoots {
  return {
    cases: config.caseDir,
    documents: config.documentsDir ?? join(config.workspaceDir, "documents"),
    workspace: config.workspaceDir,
    results: config.resultDir,
    backups: config.backupsDir ?? join(config.workspaceDir, "backups"),
  };
}

function resolveAlias(
  args: Record<string, unknown>,
  resourceRefs: Record<string, string>,
  roots: ResourceRoots,
  alias: string,
  legacy: string,
  allowedAreas: readonly ResourceArea[],
): void {
  if (args[alias] === undefined) return;
  if (args[legacy] !== undefined) {
    throw new ExecutorArgumentError(`'${alias}' und '${legacy}' duerfen nicht gemeinsam angegeben werden.`);
  }
  if (typeof args[alias] !== "string") throw new ExecutorArgumentError(`'${alias}' muss eine Ressourcenreferenz sein.`);
  let resolved: ResolvedResourceReference;
  try {
    resolved = resolveResourceReference(roots, args[alias], allowedAreas);
  } catch (error) {
    throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
  }
  delete args[alias];
  args[legacy] = resolved.path;
  resourceRefs[alias] = resolved.ref;
}

function resolveSaveCorrectionReferences(
  args: Record<string, unknown>,
  resourceRefs: Record<string, string>,
  roots: ResourceRoots,
): void {
  if (args.correction === undefined) return;
  if (!args.correction || typeof args.correction !== "object" || Array.isArray(args.correction)) {
    throw new ExecutorArgumentError("'correction' muss ein Objekt sein.");
  }
  const correction = { ...(args.correction as Record<string, unknown>) };
  const bindings = [
    ["sourceRef", "sourcePath", ["cases"]],
    ["backupRef", "backupPath", ["backups"]],
  ] as const;
  for (const [alias, workerField, allowedAreas] of bindings) {
    const value = correction[alias];
    if (typeof value !== "string") {
      throw new ExecutorArgumentError(`'correction.${alias}' muss eine Ressourcenreferenz sein.`);
    }
    let resolved: ResolvedResourceReference;
    try {
      resolved = resolveResourceReference(roots, value, allowedAreas);
    } catch (error) {
      throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
    }
    delete correction[alias];
    correction[workerField] = resolved.path;
    resourceRefs[`correction.${alias}`] = resolved.ref;
  }
  args.correction = correction;
}

export function configuredArgs(
  operation: SseApiOperation,
  args: Record<string, unknown>,
  config: SseApiServerConfig,
): ConfiguredArguments {
  const result = { ...args };
  const roots = resourceRoots(config);
  const resourceRefs: Record<string, string> = {};
  for (const binding of API_RESOURCE_BINDINGS[operation] ?? []) {
    resolveAlias(
      result,
      resourceRefs,
      roots,
      binding.alias,
      binding.workerField,
      binding.allowedAreas,
    );
  }
  if (operation === "save") resolveSaveCorrectionReferences(result, resourceRefs, roots);
  if (operation === "receipt_manager_bulk_upsert") {
    resolveReceiptManagerBulkReferences(result, resourceRefs, roots);
  }
  if (operation === "launch" || operation === "desktop_start") {
    if (result.exe !== undefined) {
      throw new ExecutorArgumentError("'exe' wird ausschliesslich in der lokalen API-Konfiguration festgelegt.");
    }
    if (config.sseExecutable) result.exe = config.sseExecutable;
  }
  if (
    (operation === "list_cases" || operation === "backup_cases" || operation === "archive_cases") &&
    result.dir === undefined &&
    config.caseDir
  ) {
    result.dir = config.caseDir;
  }
  return { args: result, resourceRefs };
}
