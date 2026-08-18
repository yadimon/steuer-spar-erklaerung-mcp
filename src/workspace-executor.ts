import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { ExecutorArgumentError, operationError } from "./executor-errors.js";
import {
  assertResourceWriteBoundary,
  formatResourceReference,
  resolveResourceReference,
  type ResourceArea,
  type ResourceRoots,
  type ResolvedResourceReference,
} from "./resources.js";
import { runScenario, type ScenarioExecutor } from "./scenario.js";
import { listWorkspaceFilesBounded, readWorkspaceText, writeWorkspaceText } from "./workspace.js";

const WORKSPACE_EXECUTOR_OPERATIONS = [
  "workspace_file_list",
  "workspace_file_read_text",
  "workspace_file_write_text",
  "scenario_run",
] as const satisfies readonly SseApiOperation[];
type WorkspaceExecutorOperation = typeof WORKSPACE_EXECUTOR_OPERATIONS[number];

export function isWorkspaceExecutorOperation(
  operation: SseApiOperation,
): operation is WorkspaceExecutorOperation {
  return (WORKSPACE_EXECUTOR_OPERATIONS as readonly SseApiOperation[]).includes(operation);
}

function resourceArgument(
  roots: ResourceRoots,
  ref: string,
  area: unknown,
  defaultArea: ResourceArea,
  allowedAreas: readonly ResourceArea[],
): ResolvedResourceReference {
  if (ref.includes(":")) {
    if (area !== undefined) {
      throw new ExecutorArgumentError("'area' darf nicht zusammen mit einer vollstaendigen Ressourcenreferenz stehen.");
    }
    return resolveResourceReference(roots, ref, allowedAreas);
  }
  const selectedArea = area === undefined ? defaultArea : String(area);
  if (!allowedAreas.includes(selectedArea as ResourceArea)) {
    throw new ExecutorArgumentError(`Ressourcenbereich '${selectedArea}' ist fuer diesen Aufruf nicht erlaubt.`);
  }
  return resolveResourceReference(roots, formatResourceReference(selectedArea as ResourceArea, ref), allowedAreas);
}

export interface WorkspaceExecutorContext {
  roots: ResourceRoots;
  workspaceDir: string;
  resultDir: string;
  timeoutMs: number | undefined;
  signal?: AbortSignal;
  execute: ScenarioExecutor;
  redactPaths: <T>(value: T) => T;
  /** Interne Testuhr fuer deterministische synchrone Deadline-Grenzen. */
  now?: () => number;
}

export async function executeWorkspaceOperation(
  operation: WorkspaceExecutorOperation,
  args: Record<string, unknown>,
  context: WorkspaceExecutorContext,
): Promise<WorkerResult> {
  const { roots, workspaceDir, resultDir, timeoutMs, signal, execute, redactPaths } = context;
  const now = context.now ?? (() => performance.now());
  const effectiveTimeoutMs = timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const startedAt = now();
  const stopped = (activity: string): WorkerResult | undefined => {
    if (signal?.aborted) return operationError(`API-Client hat ${activity} abgebrochen.`, "aborted");
    if (now() - startedAt >= effectiveTimeoutMs) {
      return operationError(`Zeitbudget fuer ${activity} ist aufgebraucht.`, "timeout");
    }
    return undefined;
  };
  switch (operation) {
    case "workspace_file_list": {
      const ref = typeof args.ref === "string" ? args.ref : "workspace:.";
      const limit = args.limit === undefined ? 500 : Number(args.limit);
      const beforeList = stopped("die Workspace-Dateiliste");
      if (beforeList) return redactPaths(beforeList);
      const resource = resourceArgument(roots, ref, args.area, "workspace", [
        "cases", "documents", "workspace", "results", "backups",
      ]);
      const remainingTimeoutMs = Math.max(0, effectiveTimeoutMs - (now() - startedAt));
      const listing = await listWorkspaceFilesBounded(
        resource.root,
        resource.relativePath,
        limit,
        args.includeHashes !== false,
        { timeoutMs: remainingTimeoutMs, ...(signal ? { signal } : {}) },
      );
      return redactPaths({
        ok: true,
        ref: resource.ref,
        files: listing.files.map((file) => ({
          ...file,
          ref: formatResourceReference(resource.area, file.ref),
        })),
        truncated: listing.truncated,
      });
    }
    case "workspace_file_read_text": {
      const beforeRead = stopped("das Lesen der Workspace-Textdatei");
      if (beforeRead) return redactPaths(beforeRead);
      const resource = resourceArgument(roots, String(args.ref), args.area, "workspace", [
        "cases", "documents", "workspace", "results", "backups",
      ]);
      const file = readWorkspaceText(resource.root, resource.relativePath);
      const afterRead = stopped("das Lesen der Workspace-Textdatei");
      if (afterRead) return redactPaths(afterRead);
      return { ...redactPaths({ ok: true, ...file.info, ref: resource.ref }), text: file.text };
    }
    case "workspace_file_write_text": {
      // Der exklusive Schreibpfad ist auf 1 MiB begrenzt und derzeit
      // synchron. Vor dem ersten Dateizugriff wird deshalb sicher gestoppt;
      // nach einem angelegten Ziel darf kein spaeter Timeout einen Retry nahelegen.
      const beforeWrite = stopped("das Schreiben der Workspace-Textdatei");
      if (beforeWrite) return redactPaths(beforeWrite);
      const resource = resourceArgument(roots, String(args.ref), args.area, "workspace", ["workspace", "results"]);
      assertResourceWriteBoundary(roots, resource);
      const info = writeWorkspaceText(resource.root, resource.relativePath, String(args.text));
      return redactPaths({ ok: true, ...info, ref: resource.ref });
    }
    case "scenario_run": {
      const scenarioResource = resourceArgument(roots, String(args.scenarioRef), undefined, "workspace", ["workspace"]);
      const resultResource = typeof args.resultRef === "string"
        ? resourceArgument(roots, args.resultRef, undefined, "results", ["results"])
        : undefined;
      const scenarioResult = await runScenario(
        workspaceDir,
        resultDir,
        scenarioResource.relativePath,
        resultResource?.relativePath,
        timeoutMs,
        signal,
        execute,
      );
      const stableResultRef = resultResource?.ref ??
        (typeof scenarioResult.resultRef === "string"
          ? formatResourceReference("results", scenarioResult.resultRef)
          : undefined);
      return redactPaths({
        ...scenarioResult,
        scenarioRef: scenarioResource.ref,
        ...(stableResultRef ? { resultRef: stableResultRef } : {}),
      });
    }
  }
}
