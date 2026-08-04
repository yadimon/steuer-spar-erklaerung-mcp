import type { SseApiServerConfig } from "./api-config.js";
import { existsSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { ZodError } from "zod";
import { SSE_CAPABILITIES } from "./capabilities.js";
import { executeCheckerOpen } from "./checker-executor.js";
import { ExecutorArgumentError } from "./executor-errors.js";
import { executeLaunchOperation } from "./launch-executor.js";
import { parseApiOperationArgs, parseCheckerReadOnlyClickArgs } from "./operation-catalog.js";
import type { ScenarioExecutor } from "./scenario.js";
import { executeUstvaOperation, isUstvaOperation } from "./ustva-executor.js";
import {
  createResourcePathRedactor,
  resolveResourceReference,
  type ResourceArea,
  type ResourceRoots,
  type ResolvedResourceReference,
} from "./resources.js";
import { ensureWorkspace } from "./workspace.js";
import { executeWorkspaceOperation, isWorkspaceExecutorOperation } from "./workspace-executor.js";
import { readWorkspaceStatus } from "./workspace-status.js";

interface ConfiguredArguments {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
}

type ResourceBinding = {
  alias: string;
  workerField: string;
  allowedAreas: readonly ResourceArea[];
};

export const API_RESOURCE_BINDINGS: Readonly<Partial<Record<SseApiOperation, readonly ResourceBinding[]>>> = Object.freeze({
  case_hash: [{ alias: "ref", workerField: "path", allowedAreas: ["cases"] }],
  center_refresh: [{ alias: "expectedDirectoryRef", workerField: "expectedDirectory", allowedAreas: ["cases"] }],
  launch: [{ alias: "caseRef", workerField: "file", allowedAreas: ["cases"] }],
  desktop_start: [{ alias: "caseRef", workerField: "file", allowedAreas: ["cases"] }],
  collect: [{ alias: "resultRef", workerField: "path", allowedAreas: ["results"] }],
  export_csv: [{ alias: "resultRef", workerField: "dir", allowedAreas: ["results"] }],
  verify: [{ alias: "sourceRef", workerField: "from", allowedAreas: ["results", "workspace"] }],
  screenshot: [{ alias: "resultRef", workerField: "path", allowedAreas: ["results"] }],
  save: [{ alias: "caseRef", workerField: "expectedPath", allowedAreas: ["cases"] }],
  file_dialog_select: [{
    alias: "resourceRef",
    workerField: "expectedPath",
    allowedAreas: ["cases", "documents", "workspace", "results", "backups"],
  }],
  vast_apply: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  tracked_set_value: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  combo_select: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  toggle: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  save_as: [
    { alias: "sourceRef", workerField: "expectedSourcePath", allowedAreas: ["cases"] },
    { alias: "targetRef", workerField: "targetPath", allowedAreas: ["cases"] },
  ],
  make_working_copy: [
    { alias: "sourceRef", workerField: "source", allowedAreas: ["cases"] },
    { alias: "targetRef", workerField: "target", allowedAreas: ["cases"] },
  ],
  backup_cases: [{ alias: "destinationRef", workerField: "dest", allowedAreas: ["backups"] }],
  archive_cases: [{ alias: "destinationRef", workerField: "dest", allowedAreas: ["backups"] }],
} satisfies Partial<Record<SseApiOperation, readonly ResourceBinding[]>>);

function resourceRoots(config: SseApiServerConfig): ResourceRoots {
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

function configuredArgs(
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

function withResourceIdentity(
  redactPaths: <T>(value: T) => T,
  result: WorkerResult,
  resourceRefs: Record<string, string> = {},
): WorkerResult {
  const redacted = redactPaths(result);
  if (!Object.keys(resourceRefs).length) return redacted;
  return { ...redacted, resourceRefs };
}

export function createApiExecutor(config: SseApiServerConfig, worker: ScenarioExecutor): ScenarioExecutor {
  const roots = resourceRoots(config);
  ensureWorkspace(config.workspaceDir);
  ensureWorkspace(config.resultDir);
  ensureWorkspace(roots.documents!);
  ensureWorkspace(roots.backups!);
  const redactPaths = createResourcePathRedactor(roots);

  const executeOperation = async (
    operation: SseApiOperation,
    args: Record<string, unknown>,
    timeoutMs: number | undefined,
    signal?: AbortSignal,
    internalCheckerClick = false,
  ): Promise<WorkerResult> => {
    try {
      // HTTP-Aufrufe wurden bereits am Serverrand geprueft. Dieser zweite
      // Einstieg ist absichtlich noetig, weil Szenarien und komponierte
      // Operationen den Executor direkt aufrufen.
      args = internalCheckerClick
        ? parseCheckerReadOnlyClickArgs(args)
        : parseApiOperationArgs(operation, args);
      if (operation === "capabilities") {
        return { ok: true, ...SSE_CAPABILITIES };
      }
      if (operation === "workspace_status") {
        return readWorkspaceStatus({
          ...config,
          profileId: config.profileId ?? "2025",
          documentsDir: roots.documents!,
          backupsDir: roots.backups!,
        });
      }
      if (isWorkspaceExecutorOperation(operation)) {
        return await executeWorkspaceOperation(operation, args, {
          roots,
          workspaceDir: config.workspaceDir,
          resultDir: config.resultDir,
          timeoutMs,
          ...(signal ? { signal } : {}),
          execute,
          redactPaths,
        });
      }
      if (operation === "checker_open") {
        return await executeCheckerOpen(args, timeoutMs, signal, async (
          nestedOperation,
          nestedArgs,
          nestedTimeoutMs,
          nestedSignal,
        ) => {
          const checkerClick = nestedOperation === "click_point" && nestedArgs.checkerReadOnly === true;
          return await executeOperation(
            nestedOperation,
            nestedArgs,
            nestedTimeoutMs,
            nestedSignal,
            checkerClick,
          );
        });
      }
      if (isUstvaOperation(operation)) {
        return await executeUstvaOperation(operation, args, timeoutMs, signal, executeOperation);
      }
      const configured = configuredArgs(operation, args, config);
      if (
        operation === "screenshot" &&
        typeof configured.args.path === "string" &&
        existsSync(configured.args.path)
      ) {
        throw new ExecutorArgumentError(
          "Screenshot-Zieldatei existiert bereits; fuer Kontrollbilder immer eine neue results:-Referenz verwenden.",
        );
      }
      if (operation === "launch") {
        const result = await executeLaunchOperation(configured.args, timeoutMs, signal, worker);
        return withResourceIdentity(redactPaths, result, configured.resourceRefs);
      }
      let createdExportDirectory: string | undefined;
      if (
        operation === "export_csv" &&
        typeof configured.args.dir === "string" &&
        configured.resourceRefs.resultRef?.startsWith("results:") &&
        !existsSync(configured.args.dir)
      ) {
        const firstCreatedDirectory = mkdirSync(configured.args.dir, { recursive: true });
        if (firstCreatedDirectory === undefined) {
          throw new ExecutorArgumentError(
            "CSV-Ergebnisordner erschien waehrend des Preflights; fremdes Ziel wird nicht verwendet.",
          );
        }
        createdExportDirectory = configured.args.dir;
      }
      let result: WorkerResult | undefined;
      try {
        result = await worker(operation, configured.args, timeoutMs, signal);
      } finally {
        if (createdExportDirectory && result?.ok !== true) {
          try {
            if (existsSync(createdExportDirectory) && readdirSync(createdExportDirectory).length === 0) {
              rmdirSync(createdExportDirectory);
            }
          } catch {
            // Best-effort-Aufraeumen darf weder den strukturierten Workerfehler
            // verdecken noch eine zwischenzeitlich extern angelegte Datei
            // entfernen. Der leere Ordner kann beim naechsten Lauf bleiben.
          }
        }
      }
      return withResourceIdentity(redactPaths, result, configured.resourceRefs);
    } catch (error) {
      const explicitKind =
        error && typeof error === "object" && typeof (error as { kind?: unknown }).kind === "string"
          ? String((error as { kind: string }).kind)
          : undefined;
      return {
        ok: false,
        kind:
          explicitKind ??
          (error instanceof ZodError || error instanceof ExecutorArgumentError
            ? "bad-args"
            : operation.startsWith("workspace_") || operation === "scenario_run"
              ? "workspace"
              : "worker"),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const execute: ScenarioExecutor = (operation, args, timeoutMs, signal) =>
    executeOperation(operation, args, timeoutMs, signal, false);
  return execute;
}
