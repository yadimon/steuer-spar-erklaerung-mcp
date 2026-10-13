import { performance } from "node:perf_hooks";
import { z } from "zod";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import type { ScenarioExecutor } from "./scenario.js";
import type { QtNativeExecutorDependencies } from "./qt-native-executor.js";
import type { PageObjectsCatalog } from "./product-profiles.js";
import { findQtNativeTableTarget, readQtNativeCompleteTable } from "./qt-native-tables.js";
import { bindingSchema, numberPolicy, publicCursorResult, rejectProof, tableCursorModelFingerprint, CursorProofFailure,
  type CursorPhase, type CompleteModel } from "./table-cursor-proofs.js";
import { executeNativeTargetPosition } from "./table-cursor-position.js";
import { amountEqual, bindRequestedNativeEditRoles } from "./table-cursor-edit-roles.js";
import { TABLE_WRITE_MINIMUM_BUDGET_MS, TABLE_NATIVE_POSTCONDITION_RESERVE_MS, TABLE_TARGET_SEEK_ALLOWANCE_MS } from "./table-write-budget.js";

/** Server-private row seek before exactly one existing mutation worker. */
export async function executeTableCursorMutation(operation: "table_update" | "table_delete", args: Record<string, unknown>,
  worker: ScenarioExecutor, dependencies: QtNativeExecutorDependencies,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS, signal?: AbortSignal, pageObjectsCatalog?: PageObjectsCatalog): Promise<WorkerResult> {
  if (!dependencies.qtNativeClient && !dependencies.qtNativeClientFor) return publicCursorResult(await worker(operation, args, timeoutMs, signal));
  const started = performance.now();
  const remaining = () => {
    const value = Math.floor(timeoutMs - (performance.now() - started));
    if (signal?.aborted || value < 1) throw new Error("Table target transaction expired.");
    return value;
  };
  const readArgs = { hwnd: args.hwnd, noKeys: false, sumLabel: args.sumLabel, sumOccurrence: args.sumOccurrence ?? 1, maxRows: 1000 };
  const phase: CursorPhase = (name, binding, extra = {}) => worker("table_read", {
    ...readArgs, ...(binding ? { hwnd: binding.hwnd, pid: binding.pid } : {}),
    __tableCursorPlan: { schemaVersion: 1, phase: name, ...(binding ? { binding } : {}), ...extra },
  }, remaining(), signal);
  const release: CursorPhase = (name, binding, extra = {}) => worker("table_read", {
    ...readArgs, hwnd: binding!.hwnd, pid: binding!.pid,
    __tableCursorPlan: { schemaVersion: 1, phase: name, binding, ...extra },
  }, 5_000);
  let mutationSubmitted = false, cursorAttempted = false, stage = "mutation-prebind";
  let cursorResult: WorkerResult | undefined;
  if (signal?.aborted || timeoutMs < TABLE_WRITE_MINIMUM_BUDGET_MS + TABLE_TARGET_SEEK_ALLOWANCE_MS) {
    return { ok: false, kind: signal?.aborted ? "aborted" : "timeout", phase: stage, proofCheck: "mutation-deadline-reserve",
      error: "Restbudget reicht nicht fuer Zielsuche, Tabellenmutation und Nachweis.",
      mutationStarted: false, outcomeUnknown: false, resultingState: "unchanged", retryable: false };
  }
  try {
    const prebound = await phase("prebind");
    if (!prebound.ok) return { ...publicCursorResult(prebound), mutationStarted: false, retryable: false };
    let binding = bindingSchema.parse(prebound.cursorBinding);
    if (binding.snapshot.navigationBinding.heading !== args.expectedPage
      || !amountEqual(binding.snapshot.navigationBinding.summaryValue, args.expectedBefore)) rejectProof("mutation-page-summary-before");
    const client = dependencies.qtNativeClient ?? await dependencies.qtNativeClientFor!({ hwnd: binding.hwnd }, remaining(), signal);
    if (client.binding.hwnd !== binding.hwnd || client.binding.pid !== binding.pid) rejectProof("mutation-native-session");
    const nativeArgs = { ...readArgs, hwnd: binding.hwnd };
    const before = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (Object.hasOwn(before.table, "rows") && before.table.rows !== before.rows) rejectProof("mutation-native-table-row-count");
    if (!amountEqual(before.summary, args.expectedBefore)) rejectProof("mutation-native-summary-before");
    const matched = findQtNativeTableTarget(before, String(args.text)) ?? rejectProof("mutation-unique-native-target");
    const fingerprint = tableCursorModelFingerprint(before);
    const columns = Array.from({ length: before.columns }, (_, column) => column).filter(column => !before.hiddenColumns.includes(column));
    stage = "mutation-requested-role-preflight";
    const requestedRoles = operation === "table_update"
      ? bindRequestedNativeEditRoles(before, matched.row, columns, args, binding.snapshot.navigationBinding.tableRootAid, pageObjectsCatalog) : new Map();
    const target = { ...matched, text: args.text, tableAid: binding.snapshot.navigationBinding.tableRootAid,
      tableRid: binding.snapshot.navigationBinding.tableRootRid, modelFingerprint: fingerprint,
      headers: columns.map(column => String(before.headers[column] ?? "")),
      cells: columns.map(nativeColumn => ({ nativeColumn, ...before.values[matched.row]![nativeColumn]! })) };
    numberPolicy(before, binding);
    // A supplied RuntimeId must be proven before navigation. It is neither
    // discarded nor substituted when a caller's cell is already stale.
    if (args.targetRid !== undefined) {
      const supplied = await phase("mutation-target", binding, { target, targetRid: args.targetRid });
      if (!supplied.ok) return { ...publicCursorResult(supplied), mutationStarted: false, retryable: false };
      const proof = z.object({ row: z.literal(matched.row), column: z.literal(matched.column), targetRid: z.literal(String(args.targetRid)) }).strict();
      proof.parse(supplied.mutationTarget);
    }
    const ping = await client.request("ping", {}, remaining(), signal);
    if (ping.result.ok !== true || ping.result.pid !== binding.pid || ping.result.hwnd !== binding.hwnd
      || ping.result.recoveryRequired !== false || ping.result.mutationAcknowledgmentRequired !== false
      || !ping.result.capabilities || typeof ping.result.capabilities !== "object"
      || (ping.result.capabilities as Record<string, unknown>).tableFocusOnlyProtocol !== 1
      || (ping.result.capabilities as Record<string, unknown>).tablePositionNumberProtocol !== 1) rejectProof("mutation-native-position-protocol");
    stage = "mutation-target-seek"; cursorAttempted = true;
    cursorResult = await executeNativeTargetPosition(client, phase, readArgs, binding, before, remaining, release, matched.row, signal);
    if (!cursorResult.ok) {
      const unknown = cursorResult.outcomeUnknown === true || cursorResult.cleanupRequired === true;
      return { ...publicCursorResult(cursorResult), mutationStarted: unknown ? null : false,
        ...(unknown ? { resultingState: "unknown" } : {}), retryable: false };
    }
    binding = bindingSchema.parse(cursorResult.cursorBinding);
    stage = "mutation-target-readback";
    const afterSeek = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (tableCursorModelFingerprint(afterSeek) !== fingerprint) rejectProof("mutation-seek-whole-model");
    const fresh = await phase("mutation-target", binding, { target, ...(args.targetRid === undefined ? {} : { targetRid: args.targetRid }) });
    if (!fresh.ok) return { ...publicCursorResult(fresh), mutationStarted: false, retryable: false };
    const proof = z.object({ row: z.literal(matched.row), column: z.literal(matched.column), targetRid: z.string().min(1) }).strict().parse(fresh.mutationTarget);
    // Last complete atomic model check after the UIA proof, before one write.
    if (tableCursorModelFingerprint(await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal)) !== fingerprint) {
      rejectProof("mutation-final-whole-model");
    }
    const available = Math.floor(timeoutMs - (performance.now() - started));
    if (signal?.aborted || available < TABLE_WRITE_MINIMUM_BUDGET_MS) return { ok: false, kind: signal?.aborted ? "aborted" : "timeout", phase: "mutation-worker",
      proofCheck: "mutation-deadline-reserve", error: "Restbudget reicht nicht fuer Tabellenmutation und anschliessenden Nachweis.",
      mutationStarted: false, outcomeUnknown: false, resultingState: "unchanged", cursorSteps: cursorResult.steps,
      cursorTransaction: "native-target-position", retryable: false };
    const mutationTimeout = available - TABLE_NATIVE_POSTCONDITION_RESERVE_MS;
    stage = "mutation-worker"; mutationSubmitted = true;
    const result = await worker(operation, { ...args, hwnd: binding.hwnd, pid: binding.pid,
      targetRid: args.targetRid ?? proof.targetRid,
      __tableMutationBinding: { schemaVersion: 1, operation, binding, target },
    }, mutationTimeout, signal);
    if (!result.ok) return { ...publicCursorResult(result), retryable: false };
    if (result.verified !== true) rejectProof("mutation-worker-verified-readback");
    const postProof = z.object({ inputEpoch: z.number().int().min(0).max(0xffff_ffff), dirty: z.boolean() }).strict().parse(result.mutationPostProof);
    stage = "mutation-native-postcondition";
    const after = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (Object.hasOwn(before.table, "rows") !== Object.hasOwn(after.table, "rows")
      || (Object.hasOwn(before.table, "rows") && after.table.rows !== after.rows)) {
      rejectProof("mutation-native-table-row-count");
    }
    const structure = (model: CompleteModel) => {
      // Row deletion changes the descriptor's row count as well as model.rows.
      // Its exact expected change is checked below; every other table property
      // and the complete inventory must still retain their original identity.
      const { rows: _rows, ...table } = model.table;
      return JSON.stringify({ table, columns: model.columns, headers: model.headers,
        hiddenColumns: model.hiddenColumns, tableCount: model.tableCount, windowEnabled: model.windowEnabled, modalBlocked: model.modalBlocked });
    };
    if (structure(before) !== structure(after) || !amountEqual(after.summary, args.expectedAfter)) rejectProof("mutation-native-structure-summary");
    const untouched = before.values.filter((_, row) => row !== matched.row);
    const actual = operation === "table_update" ? after.values.filter((_, row) => row !== matched.row) : after.values;
    if (after.rows !== before.rows - (operation === "table_delete" ? 1 : 0)
      || JSON.stringify(untouched) !== JSON.stringify(actual)
      || JSON.stringify(after.hiddenRows) !== JSON.stringify(before.hiddenRows.filter(row => row !== matched.row)
        .map(row => operation === "table_delete" && row > matched.row ? row - 1 : row))) rejectProof("mutation-native-untouched-rows");
    if (operation === "table_update") {
      for (let visible = 0; visible < columns.length; visible++) {
        const column = columns[visible]!, prior = before.values[matched.row]![column]!, current = after.values[matched.row]![column]!;
        const requested = requestedRoles.get(column);
        if (prior.flags !== current.flags) rejectProof("mutation-native-target-flags");
        if (requested) {
          const { wanted } = requested;
          if (requested.mode === "checkbox") {
            if (!["true", "false"].includes(wanted) || current.checkState !== (wanted === "true" ? 2 : 0)) rejectProof("mutation-native-target-checkbox");
            if (current.edit !== requested.edit) rejectProof("mutation-native-target-requested-edit");
          } else {
            const numeric = requested.mode === "numeric";
            if (String(current.display ?? "") !== wanted && !(numeric && amountEqual(current.display, wanted))) {
              rejectProof("mutation-native-target-requested");
            }
            if (current.edit !== requested.edit && !(numeric && ["string", "number"].includes(typeof current.edit) && amountEqual(current.edit, wanted))) {
              rejectProof("mutation-native-target-requested-edit");
            }
          }
        } else if ((prior.flags & 2) !== 0 || (prior.flags & 16) !== 0 || prior.checkState !== null) {
          if (JSON.stringify(prior) !== JSON.stringify(current)) rejectProof("mutation-native-target-unrequested");
        }
      }
      for (const column of before.hiddenColumns) {
        if (JSON.stringify(before.values[matched.row]![column]) !== JSON.stringify(after.values[matched.row]![column])) {
          rejectProof("mutation-native-target-hidden-cell");
        }
      }
    }
    stage = "mutation-passive-final-checkpoint";
    const finalBinding = { ...binding, ...postProof, snapshot: { ...binding.snapshot, navigationBinding: {
      ...binding.snapshot.navigationBinding, summaryValue: String(after.summary),
    } } };
    const finalCheckpoint = await phase("mutation-checkpoint", finalBinding);
    if (!finalCheckpoint.ok || finalCheckpoint.cursorCheckpoint !== true) rejectProof("mutation-final-epoch-window");
    return { ...publicCursorResult(result), nativeTargetRowVerified: true,
      nativeUntouchedRowsVerified: true, cursorSteps: cursorResult.steps, retryable: false };
  } catch (error) {
    return { ok: false, kind: "cursor-proof-failed", phase: stage,
      proofCheck: error instanceof CursorProofFailure ? error.proofCheck : "mutation-target-contract",
      error: "Native Zielzeile verlor ihren Nachweis; frisch abgleichen, Mutation nicht wiederholen.",
      mutationStarted: mutationSubmitted || cursorAttempted ? null : false, outcomeUnknown: mutationSubmitted || cursorAttempted,
      ...(mutationSubmitted || cursorAttempted ? { resultingState: "unknown" } : {}),
      reconciliationRequired: cursorAttempted || mutationSubmitted, retryable: false,
      ...(cursorResult ? { cursorSteps: cursorResult.steps } : {}) };
  }
}
