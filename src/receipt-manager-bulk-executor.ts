import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { operationError } from "./executor-errors.js";

const MIN_NESTED_OPERATION_TIMEOUT_MS = 2_000;

type NestedExecutor = (
  operation: SseApiOperation,
  args: Record<string, unknown>,
  timeoutMs?: number,
  signal?: AbortSignal,
) => Promise<WorkerResult>;

interface BulkItem {
  resourceRef: string;
  expectedHash: string;
  values: Record<string, unknown>;
  classification?: Record<string, unknown>;
}

function remainingTimeoutMs(timeoutMs: number, startedAt: number): number {
  return Math.max(0, timeoutMs - Math.ceil(performance.now() - startedAt));
}

/** Compose guarded BelegManager mutations into one fail-fast batch. */
export async function executeReceiptManagerBulkUpsert(
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  executeOperation: NestedExecutor,
): Promise<WorkerResult> {
  const items = args.items as BulkItem[];
  const hwnd = typeof args.hwnd === "number" ? args.hwnd : undefined;
  const waitMs = typeof args.waitMs === "number" ? args.waitMs : undefined;
  const effectiveTimeoutMs = timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const bulkStartedAt = performance.now();
  const completed: WorkerResult[] = [];
  let currentList = await executeOperation(
    "receipt_manager_list",
    hwnd === undefined ? {} : { hwnd },
    remainingTimeoutMs(effectiveTimeoutMs, bulkStartedAt),
    signal,
  );
  if (currentList.ok !== true) {
    return {
      ok: false,
      kind: currentList.kind ?? "precondition-failed",
      error: "BelegManager-Batch konnte die vollstaendige Ausgangsliste nicht lesen.",
      requestedCount: items.length,
      completedCount: 0,
      failedIndex: 0,
      items: [],
      failure: currentList,
      cleanupRequired: false,
      verified: false,
    };
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const remaining = (): number => remainingTimeoutMs(effectiveTimeoutMs, bulkStartedAt);
    const common = hwnd === undefined ? {} : { hwnd };
    const fail = (stage: string, failure: WorkerResult, cleanupRequired: boolean): WorkerResult => ({
      ok: false,
      kind: failure.kind ?? "postcondition-failed",
      error: `BelegManager-Batch stoppte bei Eintrag ${index + 1} in Phase '${stage}'.`,
      requestedCount: items.length,
      completedCount: completed.length,
      failedIndex: index,
      items: completed,
      failure: { stage, resourceRef: item.resourceRef, result: failure },
      cleanupRequired,
      verified: false,
    });
    if (remaining() < MIN_NESTED_OPERATION_TIMEOUT_MS) {
      return fail("timeout", operationError("Batch-Zeitbudget ist erschoepft.", "timeout"), false);
    }

    const imported = await executeOperation("receipt_manager_import", {
      ...common,
      ...(waitMs === undefined ? {} : { waitMs }),
      resourceRef: item.resourceRef,
      expectedHash: item.expectedHash,
      expectedListFingerprint: currentList.listFingerprint,
      expectedCountBefore: currentList.count,
      acknowledgeImport: true,
    }, remaining(), signal);
    // A failed import may already have created a draft and opened the file
    // dialog, so cleanup is conservatively required.
    if (imported.ok !== true) return fail("import", imported, true);

    const importedRow = imported.importedRow as Record<string, unknown> | undefined;
    if (!importedRow || typeof importedRow.rowRid !== "string" || typeof importedRow.rowFingerprint !== "string") {
      return fail("import-readback", operationError("Import lieferte keine frische Zeilenbindung."), true);
    }
    let read = await executeOperation("receipt_manager_read", {
      ...common,
      ...(waitMs === undefined ? {} : { waitMs }),
      rowRid: importedRow.rowRid,
      rowFingerprint: importedRow.rowFingerprint,
      expectedListFingerprint: imported.listFingerprintAfter,
    }, remaining(), signal);
    if (read.ok !== true) return fail("read-after-import", read, true);

    const updated = await executeOperation("receipt_manager_update", {
      ...common,
      ...(waitMs === undefined ? {} : { waitMs }),
      rowRid: importedRow.rowRid,
      rowFingerprint: importedRow.rowFingerprint,
      expectedListFingerprint: read.listFingerprint,
      expectedDetailFingerprint: read.detailFingerprint,
      values: item.values,
      acknowledgeUpdate: true,
    }, remaining(), signal);
    if (updated.ok !== true) return fail("update", updated, true);

    let row = updated.rowAfter as Record<string, unknown> | undefined;
    let listFingerprint = updated.listFingerprintAfter;
    let classification: WorkerResult | undefined;
    if (item.classification !== undefined) {
      if (!row || typeof row.rowRid !== "string" || typeof row.rowFingerprint !== "string") {
        return fail("update-readback", operationError("Update lieferte keine frische Zeilenbindung."), true);
      }
      read = await executeOperation("receipt_manager_read", {
        ...common,
        ...(waitMs === undefined ? {} : { waitMs }),
        rowRid: row.rowRid,
        rowFingerprint: row.rowFingerprint,
        expectedListFingerprint: listFingerprint,
      }, remaining(), signal);
      if (read.ok !== true) return fail("read-before-classify", read, true);
      classification = await executeOperation("receipt_manager_classify", {
        ...common,
        ...(waitMs === undefined ? {} : { waitMs }),
        rowRid: row.rowRid,
        rowFingerprint: row.rowFingerprint,
        expectedListFingerprint: read.listFingerprint,
        expectedDetailFingerprint: read.detailFingerprint,
        values: item.classification,
        acknowledgeClassification: true,
      }, remaining(), signal);
      if (classification.ok !== true) {
        return fail("classify", classification, classification.cleanupRequired === true);
      }
      row = classification.rowAfter as Record<string, unknown> | undefined;
      listFingerprint = classification.listFingerprintAfter;
    }

    if (!row || typeof row.rowRid !== "string" || typeof row.rowFingerprint !== "string") {
      return fail("final-binding", operationError("Finale Zeilenbindung fehlt."), true);
    }
    const finalRead = await executeOperation("receipt_manager_read", {
      ...common,
      ...(waitMs === undefined ? {} : { waitMs }),
      rowRid: row.rowRid,
      rowFingerprint: row.rowFingerprint,
      expectedListFingerprint: listFingerprint,
    }, remaining(), signal);
    if (finalRead.ok !== true) return fail("final-read", finalRead, true);
    completed.push({
      ok: true,
      index,
      resourceRef: item.resourceRef,
      sha256: item.expectedHash,
      import: imported,
      update: updated,
      ...(classification === undefined ? {} : { classification }),
      finalRead,
      verified: true,
    });
    currentList = await executeOperation("receipt_manager_list", common, remaining(), signal);
    if (currentList.ok !== true) return fail("list-between-items", currentList, false);
  }

  return {
    ok: true,
    pid: currentList.pid,
    hwnd: currentList.hwnd,
    requestedCount: items.length,
    completedCount: completed.length,
    failedIndex: null,
    items: completed,
    failure: null,
    cleanupRequired: false,
    verified: true,
  };
}
