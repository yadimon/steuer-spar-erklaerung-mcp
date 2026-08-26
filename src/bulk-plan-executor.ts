import type { SseApiOperation, WorkerResult } from "./api-contract.js";
import { ExecutorArgumentError } from "./executor-errors.js";
import { parseApiOperationArgs } from "./operation-catalog.js";
import {
  resolvePageObjectDefinition,
  type PageObjectsCatalog,
} from "./product-profiles.js";
import type { ScenarioExecutor } from "./scenario.js";
import {
  resolveResourceReference,
  type ResourceRoots,
} from "./resources.js";

export interface ConfiguredBulkArguments {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
}

interface BulkPlanDependencies {
  pageObjectsCatalog: PageObjectsCatalog;
  configure: (operation: SseApiOperation, args: Record<string, unknown>) => ConfiguredBulkArguments;
  worker: ScenarioExecutor;
  finish: (result: WorkerResult, resourceRefs: Record<string, string>) => WorkerResult;
  executionError: (operation: SseApiOperation, error: unknown) => WorkerResult;
}

export function resolveReceiptManagerBulkReferences(
  args: Record<string, unknown>,
  resourceRefs: Record<string, string>,
  roots: ResourceRoots,
): void {
  if (!Array.isArray(args.items)) return;
  args.items = args.items.map((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new ExecutorArgumentError(`'items.${index}' muss ein Objekt sein.`);
    }
    const item = { ...(rawItem as Record<string, unknown>) };
    if (typeof item.resourceRef !== "string") {
      throw new ExecutorArgumentError(`'items.${index}.resourceRef' muss eine Ressourcenreferenz sein.`);
    }
    try {
      const resolved = resolveResourceReference(roots, item.resourceRef, ["documents"]);
      item.expectedPath = resolved.path;
      resourceRefs[`items.${index}.resourceRef`] = resolved.ref;
    } catch (error) {
      throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
    }
    return item;
  });
}

export async function executeFillFieldsPlan(
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  dependencies: BulkPlanDependencies,
): Promise<WorkerResult> {
  const pageId = String(args.pageId);
  const resolvedPage = resolvePageObjectDefinition(dependencies.pageObjectsCatalog, pageId);
  if (resolvedPage.status !== "found") {
    throw new ExecutorArgumentError(
      resolvedPage.status === "ambiguous"
        ? `Page-Object-ID '${pageId}' ist bei Gross-/Kleinschreibung mehrdeutig.`
        : `Unbekannte Page-Object-ID '${pageId}'.`,
    );
  }
  const fields = args.fields as Array<Record<string, unknown>>;
  const pageFields = resolvedPage.page.fields ?? {};
  const resourceRefs: Record<string, string> = {};
  const sharedKeys = [
    "trackResults", "resultLabels", "hwnd", "pid", "expectedCaseRef", "expectedCaseHash",
  ] as const;
  const actions = fields.map((field, index) => {
    const fieldId = String(field.fieldId);
    if (!Object.hasOwn(pageFields, fieldId)) {
      throw new ExecutorArgumentError(`Unbekannte fieldId '${fieldId}' auf Page-Object '${pageId}'.`);
    }
    const child: Record<string, unknown> = {
      pageId,
      fieldId,
      expectedBefore: field.expectedBefore,
      value: field.value,
      expectedAfter: field.expectedAfter,
      ...(field.sumChecks === undefined ? {} : { sumChecks: field.sumChecks }),
      ...(index === 0 && args.expectedEpoch !== undefined ? { expectedEpoch: args.expectedEpoch } : {}),
    };
    for (const key of sharedKeys) {
      if (args[key] !== undefined) child[key] = args[key];
    }
    const parsedChild = parseApiOperationArgs("tracked_set_value", child);
    const configuredChild = dependencies.configure("tracked_set_value", parsedChild);
    Object.assign(resourceRefs, configuredChild.resourceRefs);
    return {
      id: `field-${String(index + 1).padStart(2, "0")}`,
      operation: "tracked_set_value",
      args: configuredChild.args,
    };
  });
  const finalReadbackArgs: Record<string, unknown> = { pageId };
  for (const key of ["hwnd", "pid"] as const) {
    if (args[key] !== undefined) finalReadbackArgs[key] = args[key];
  }
  const plan = {
    schemaVersion: 1,
    planKind: "fill-fields",
    actions,
    stopOnError: true,
    rollback: "best-effort",
    finalReadback: true,
    finalReadbackPlan: { operation: "known_page_state", args: finalReadbackArgs },
  };
  try {
    const result = await dependencies.worker("bulk_action" as SseApiOperation, plan, timeoutMs, signal);
    return dependencies.finish(result, resourceRefs);
  } catch (error) {
    const failed = dependencies.executionError("fill_fields", error);
    return dependencies.finish({
      ...failed,
      schemaVersion: 1,
      planKind: "fill-fields",
      completed: [],
      failedAction: null,
      failedIndex: null,
      skipped: actions.map((action, index) => ({ ...action, index, status: "skipped" })),
      rollback: { mode: "best-effort", attempted: false, ok: null, entries: [] },
      cleanupRequired: true,
      finalReadback: null,
      finalReadbackVerified: false,
      resultingState: "unknown",
      verified: false,
      performance: { workerProcessCount: 1 },
    }, resourceRefs);
  }
}

export async function executeReceiptManagerBulkPlan(
  args: Record<string, unknown>,
  configured: ConfiguredBulkArguments,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  dependencies: Pick<BulkPlanDependencies, "worker" | "finish" | "executionError">,
): Promise<WorkerResult> {
  try {
    const result = await dependencies.worker("receipt_manager_bulk_upsert", configured.args, timeoutMs, signal);
    return dependencies.finish(result, configured.resourceRefs);
  } catch (error) {
    const failed = dependencies.executionError("receipt_manager_bulk_upsert", error);
    const items = Array.isArray(args.items) ? args.items : [];
    return dependencies.finish({
      ...failed,
      schemaVersion: 1,
      planKind: "receipt-manager-bulk-upsert",
      requestedCount: items.length,
      completedCount: 0,
      completed: [],
      failedIndex: null,
      failedAction: null,
      skipped: items.map((item, index) => ({ index, item, status: "skipped" })),
      rollback: { mode: "best-effort", attempted: false, ok: null, entries: [] },
      cleanupRequired: true,
      finalReadback: null,
      finalReadbackVerified: false,
      resultingState: "unknown",
      verified: false,
      performance: { workerProcessCount: 1 },
    }, configured.resourceRefs);
  }
}
