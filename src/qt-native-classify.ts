import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { SSE_MCP_RECEIPT_SCHEMAS } from "./mcp-schemas-receipts.js";
import { fail } from "./qt-native-receipts.js";
import { classificationPolicySchema, ClassificationError, sameClassificationDomain,
  sameClassificationSet, selectedClassification, type ClassificationGrid, type ClassificationKind } from "./qt-native-classification-projection.js";
import { ReceiptClassificationSession } from "./qt-native-classification-session.js";

interface Transaction {
  kind: ClassificationKind; before: string[]; after: string[]; changed: string[];
  initialGrid: ClassificationGrid; persisted: boolean;
}

/** Bound CheckStateRole commits with independent reopen proofs and guarded reverse rollback. */
export async function executeQtNativeClassify(
  client: QtNativeClient, rawArgs: Readonly<Record<string, unknown>>, timeoutMs: number,
  signal?: AbortSignal, profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsed = SSE_MCP_RECEIPT_SCHEMAS.sse_receipt_manager_classify.safeParse(rawArgs);
  if (!parsed.success) return fail("bad-args", parsed.error.message);
  const policy = classificationPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!policy.success) return fail("invalid-catalog", "The complete classification policy is required.");
  const args = parsed.data, session = new ReceiptClassificationSession(client, { ...args, waitMs: args.waitMs ?? 3500 }, policy.data, timeoutMs, signal);
  const transactions: Transaction[] = [];
  let finishing = false, prepared = false;
  const setOpen = async (grid: ClassificationGrid, desired: readonly string[]) => {
    const known = grid.options.map(option => option.name);
    if (desired.some(name => !known.includes(name))) throw new ClassificationError("The requested classification contains an unknown option.", "bad-args");
    const changed: string[] = [];
    for (const option of grid.options) {
      const wanted = desired.includes(option.name);
      if (option.selected !== wanted) { await session.toggle(option.name, wanted); changed.push(option.name); }
    }
    const after = await session.readGrid();
    if (!sameClassificationDomain(grid, after) || !sameClassificationSet(selectedClassification(after), desired))
      throw new ClassificationError("The complete staged option set differs from its exact requested set.", "postcondition-failed", changed.length > 0);
    await session.closeModal(changed.length > 0);
    return { after: selectedClassification(after), changed };
  };
  const provePersisted = async (kind: ClassificationKind, initial: ClassificationGrid, expected: readonly string[]) => {
    const fresh = await session.open(kind);
    if (!sameClassificationDomain(fresh, initial) || !sameClassificationSet(selectedClassification(fresh), expected))
      throw new ClassificationError("Reopening did not prove the exact saved classification and option domain.", "postcondition-failed");
    await session.closeModal(false);
    return selectedClassification(fresh);
  };
  try {
    await session.prepare();
    prepared = true;
    for (const kind of ["categories", "persons"] as const) {
      const desired = args.values[kind]; if (desired === undefined) continue;
      const initialGrid = await session.open(kind), before = selectedClassification(initialGrid);
      const result = await setOpen(initialGrid, desired);
      const transaction = { kind, initialGrid, before, after: result.after, changed: result.changed, persisted: false };
      transactions.push(transaction);
      transaction.after = await provePersisted(kind, initialGrid, desired); transaction.persisted = true;
    }
    finishing = true;
    const { list, ...proof } = await session.finish(false);
    const rowAfter = list.rows.find(row => row.primaryText === session.row.primaryText && row.documentNumber === session.row.documentNumber)!;
    return { ok: true, ...session.bindings(), ...proof, rowBefore: session.row, rowAfter,
      requestedValues: args.values, valuesBefore: Object.fromEntries(transactions.map(value => [value.kind, value.before])),
      valuesAfter: Object.fromEntries(transactions.map(value => [value.kind, value.after])),
      changedKinds: transactions.filter(value => value.changed.length).map(value => value.kind), persistenceVerified: transactions.every(value => value.persisted),
      listFingerprintBefore: session.listBefore.listFingerprint, listFingerprintAfter: list.listFingerprint,
      detailFingerprintBefore: args.expectedDetailFingerprint.toUpperCase(), detailFingerprintAfter: args.expectedDetailFingerprint.toUpperCase(),
      rollback: { attempted: false, ok: null, entries: [] }, cleanupRequired: false, verified: true };
  } catch (error) {
    session.markError(error);
    let cleanupError: string | null = null;
    if (session.hasModal && !session.closingModal && !session.outcomeUnknown) {
      try { await session.closeModal(false); } catch (cleanup) {
        session.markError(cleanup); cleanupError = cleanup instanceof Error ? cleanup.message : String(cleanup);
      }
    }
    const entries: Array<Record<string, unknown>> = [];
    let restored = false;
    if (prepared && !finishing && !session.outcomeUnknown && !session.hasModal) {
      try {
        for (const transaction of [...transactions].reverse()) {
          const current = await session.open(transaction.kind);
          if (!sameClassificationDomain(current, transaction.initialGrid) || !sameClassificationSet(selectedClassification(current), transaction.after))
            throw new ClassificationError("Rollback cannot prove the current exact state belongs to this transaction.", "stale", true);
          await setOpen(current, transaction.before);
          const before = await provePersisted(transaction.kind, transaction.initialGrid, transaction.before);
          entries.push({ kind: transaction.kind, ok: true, restored: before });
        }
        await session.finish(false, true); restored = true;
      } catch (rollbackError) {
        session.markError(rollbackError);
        entries.push({ ok: false, error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) });
        cleanupError ??= rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      }
    }
    return { ...session.failure(error, cleanupError), rowBefore: session.row ?? null,
      listFingerprintBefore: args.expectedListFingerprint.toUpperCase(), detailFingerprintBefore: args.expectedDetailFingerprint.toUpperCase(),
      rollback: { attempted: entries.length > 0, ok: restored ? true : entries.length ? false : null, entries },
      persistenceVerified: false, cleanupRequired: !restored && session.mutationStarted };
  }
}
