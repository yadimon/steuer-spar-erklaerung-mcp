import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { QT_TABLE_FOCUS_BINDING, projectQtNativeCompleteTable, readQtNativeCompleteTable } from "./qt-native-tables.js";
import { bindingSchema, leaseSchema, nativeFocusBinding, numberPolicy, publicCursorResult, rejectProof,
  bindNativeViewport, cursorProofActivation, sameContext, tableCursorModelFingerprint, CursorProofFailure,
  type CursorBinding, type CursorLease, type CursorPhase, type CompleteModel } from "./table-cursor-proofs.js";

export function sameSteppedContext(before: CursorBinding, after: CursorBinding) {
  const a = before.snapshot.navigationBinding, b = after.snapshot.navigationBinding;
  return after.hwnd === before.hwnd && after.pid === before.pid && after.dpi === before.dpi
    && after.dirty === before.dirty && after.windowTitle === before.windowTitle
    && after.windowFingerprint === before.windowFingerprint
    && JSON.stringify(after.clientOrigin) === JSON.stringify(before.clientOrigin)
    && JSON.stringify(before.snapshot.kopf) === JSON.stringify(after.snapshot.kopf)
    && a.heading === b.heading && a.tableRootAid === b.tableRootAid && a.tableRootRid === b.tableRootRid
    && JSON.stringify(a.headers) === JSON.stringify(b.headers)
    && ["scopePrefix", "selectionMethod", "summaryIdentity", "summaryValue", "summaryRid", "summaryAid"]
      .every(key => a[key] === b[key]);
}

const stepCheckpointSchema = z.object({
  transactionNonce: z.string().uuid(), stepNonce: z.string().uuid(), parentLeaseNonce: z.string().uuid(),
  sequence: z.number().int().nonnegative(), key: z.enum(["home", "down"]),
  modelFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  row: z.number().int().nonnegative(), column: z.literal(0), rowFullyContained: z.boolean(),
}).strict();
const stepSelectionSchema = z.array(z.string().min(1)).min(1).max(32).refine(value => new Set(value).size === value.length);

/** Each worker consumes one lease and one key. A fresh broker proof is required before the next key. */
export async function executeNativeSteppedCursor(client: QtNativeClient, phase: CursorPhase, args: Record<string, unknown>,
  initial: CursorBinding, before: CompleteModel, remaining: () => number, release: CursorPhase,
  signal?: AbortSignal, targetRow?: number): Promise<WorkerResult> {
  const fingerprint = tableCursorModelFingerprint(before), transactionNonce = randomUUID();
  const visibleRows = Array.from({ length: before.rows }, (_, row) => row).filter(row => !before.hiddenRows.includes(row));
  if (targetRow !== undefined && !visibleRows.includes(targetRow)) rejectProof("native-seek-target-row");
  const rows = targetRow === undefined ? visibleRows : visibleRows.slice(0, visibleRows.indexOf(targetRow) + 1);
  const policy = numberPolicy(before, initial);
  if (!rows.length || before.hiddenColumns.includes(0) || !/^Nr\.?$/u.test(String(before.headers[0])) || before.rows > 1000
    || before.values.some(row => (row[0]!.flags & 33) !== 33 || (row[0]!.flags & 16) !== 0 || row[0]!.checkState !== null
      || (row[0]!.display !== null && typeof row[0]!.display !== "string")
      || (row[0]!.edit !== null && typeof row[0]!.edit !== "string"))) {
    rejectProof("native-step-number-model");
  }
  const numberModel = before.values.map(row => ({ display: row[0]!.display, edit: row[0]!.edit, flags: row[0]!.flags }));
  const nativeArgs = { ...args, hwnd: initial.hwnd }, spent = new Set<string>();
  let binding = initial, heldLease: CursorLease | undefined, selection: unknown;
  let currentPhase = "native-preproof", steps = 0, submitted = false, cleanupRequired = false;
  let physicalInputAttempted: boolean | null = false;
  let nativeCursorFocusEvidence: Record<string, unknown> | undefined;
  let workerFailure: WorkerResult | undefined, final: CompleteModel = before;
  let result: WorkerResult;
  const verifyModel = async () => {
    const model = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (tableCursorModelFingerprint(model) !== fingerprint) rejectProof("native-step-whole-model");
    return model;
  };
  const focusOnce = async (model: CompleteModel) => {
    const focus = nativeFocusBinding(model, binding, true);
    nativeCursorFocusEvidence = { currentIndex: [...focus.currentIndex], selectedIndexCount: focus.selectedIndexes.length,
      selectedIndexes: focus.selectedIndexes.slice(0, 32).map(index => [...index]),
      selectedIndexesTruncated: focus.selectedIndexes.length > 32, focusActionVerified: false };
    currentPhase = "native-step-focus-only"; submitted = true;
    const reply = await client.requestAcknowledged("table_focus_only", {
      objectId: focus.tableId, binding: focus, expectedRootHwnd: binding.hwnd, expectedPid: binding.pid,
      expectedInputTick: binding.inputEpoch, expectedWindowTitle: binding.windowTitle,
    }, remaining(), signal);
    if (reply.result.ok !== true || reply.result.focused !== true || reply.result.physicalInputUsed !== false
      || reply.result.inputTick !== binding.inputEpoch || reply.result.outcomeUnknown === true
      || typeof reply.result.mutationAttempted !== "boolean"
      || (reply.result.mutationAttempted && !reply.receiptAcknowledged)
      || JSON.stringify(QT_TABLE_FOCUS_BINDING.parse(reply.result.binding)) !== JSON.stringify(focus)) {
      rejectProof("native-step-focus-acknowledged-postcondition");
    }
    const after = await verifyModel();
    if (JSON.stringify(nativeFocusBinding(after, binding, true)) !== JSON.stringify(focus)) rejectProof("native-step-focus-current-selection");
    nativeCursorFocusEvidence.focusActionVerified = true;
    return after;
  };
  try {
    nativeFocusBinding(before, binding);
    const geometry = await bindNativeViewport(client, binding, before, remaining, signal);
    currentPhase = "native-acquire";
    const acquired = await phase("native-acquire", binding, { numberPolicy: policy, numberModel });
    if (!acquired.ok) return { ...publicCursorResult(acquired), retryable: false };
    cleanupRequired = true; // A reported handover exists even when its schema is malformed.
    heldLease = leaseSchema.parse(acquired.cursorLease);
    const acquiredBinding = bindingSchema.parse(acquired.cursorBinding);
    if (!sameContext(binding, acquiredBinding) || heldLease.rootHwnd !== binding.hwnd || heldLease.targetPid !== binding.pid
      || heldLease.inputEpoch !== binding.inputEpoch || acquiredBinding.inputEpoch !== binding.inputEpoch) rejectProof("native-step-acquire-context");
    binding = acquiredBinding; selection = stepSelectionSchema.parse(acquired.selectedRids); cleanupRequired = false;
    let model = await verifyModel();
    model = await focusOnce(model);
    for (let sequence = 0; sequence <= rows.length; sequence++) {
      // Reserve a bounded release and complete model read. No key is issued when the request cannot afford its checkpoint.
      if (remaining() < 1500) rejectProof("native-step-deadline-reserve");
      const parent = heldLease!;
      if (spent.has(parent.nonce)) rejectProof("native-step-lease-replay");
      const focus = nativeFocusBinding(model, binding, true);
      if (focus.currentIndex[1] !== 0) rejectProof("native-step-number-current-column");
      const key = sequence === 0 ? "home" : "down", stepNonce = randomUUID();
      const expectedRow = sequence === 0 ? rows[0]! : rows[sequence]!;
      if (expectedRow === undefined) rejectProof("native-step-row-budget");
      currentPhase = `native-step-${key}`;
      spent.add(parent.nonce); heldLease = undefined; cleanupRequired = true; physicalInputAttempted = steps > 0 ? true : null;
      const stepped = await phase("native-step", binding, { lease: parent, selectedRids: selection, step: {
        transactionNonce, stepNonce, parentLeaseNonce: parent.nonce, sequence, key, modelFingerprint: fingerprint,
        currentIndex: focus.currentIndex, expectedRow, numberModel, numberPolicy: policy, geometry,
      } });
      if (typeof stepped.steps === "number") { steps += stepped.steps; physicalInputAttempted = steps > 0; }
      if (!stepped.ok) {
        workerFailure = publicCursorResult(stepped);
        cleanupRequired = stepped.cleanupRequired === true || !(stepped.focusTelemetry && typeof stepped.focusTelemetry === "object"
          && (stepped.focusTelemetry as Record<string, unknown>).releasedByEmit === true);
        rejectProof("native-step-worker-result");
      }
      const nextBinding = bindingSchema.parse(stepped.cursorBinding), nextLease = leaseSchema.parse(stepped.cursorLease);
      if (nextLease.nonce === parent.nonce || spent.has(nextLease.nonce) || nextLease.rootHwnd !== binding.hwnd
        || nextLease.targetPid !== binding.pid || nextLease.inputEpoch !== nextBinding.inputEpoch
        || !sameSteppedContext(binding, nextBinding) || JSON.stringify(nextLease.previous) !== JSON.stringify(parent.previous)
        || JSON.stringify(nextLease.previousCursor) !== JSON.stringify(parent.previousCursor)) rejectProof("native-step-handover-context");
      heldLease = nextLease; binding = nextBinding; selection = stepSelectionSchema.parse(stepped.selectedRids); cleanupRequired = false;
      const checkpoint = stepCheckpointSchema.parse(stepped.cursorStep);
      if (checkpoint.transactionNonce !== transactionNonce || checkpoint.stepNonce !== stepNonce
        || checkpoint.parentLeaseNonce !== parent.nonce || checkpoint.sequence !== sequence || checkpoint.key !== key
        || checkpoint.modelFingerprint !== fingerprint || checkpoint.row !== expectedRow || stepped.steps !== 1) {
        rejectProof("native-step-checkpoint-progress");
      }
      currentPhase = "native-step-model-readback";
      model = await verifyModel();
      const current = nativeFocusBinding(model, binding, true);
      if (current.currentIndex[0] !== checkpoint.row || current.currentIndex[1] !== checkpoint.column) rejectProof("native-step-model-current-index");
      if (checkpoint.row === rows.at(-1)) {
        if (!checkpoint.rowFullyContained) rejectProof(targetRow === undefined ? "native-step-last-row-clipped" : "native-seek-target-row-clipped");
        final = model;
        const lastCheckpoint = await phase("checkpoint", binding);
        if (!lastCheckpoint.ok || lastCheckpoint.cursorCheckpoint !== true) rejectProof("native-step-final-epoch");
        const maxRows = typeof args.maxRows === "number" ? args.maxRows : 1000;
        result = { ...projectQtNativeCompleteTable(final, maxRows), steps, schritte: steps, physicalInputUsed: true,
          nativeWholeModelUnchanged: true, lastRowFullyContained: true, cursorTransaction: "native-step-focus-only", retryable: false,
          ...(targetRow === undefined ? {} : { cursorBinding: binding }) };
        break;
      }
      model = await focusOnce(model);
    }
    if (!result!) rejectProof("native-step-row-budget");
  } catch (error) {
    result = { ...workerFailure, ok: false, kind: workerFailure?.kind ?? "cursor-proof-failed", phase: currentPhase,
      proofCheck: error instanceof CursorProofFailure ? error.proofCheck : "native-step-contract",
      error: workerFailure?.error ?? "Tabellen-Cursorschritt verlor seinen Nachweis; frisch abgleichen, keine Taste wiederholen.",
      ...cursorProofActivation(error),
      steps, schritte: steps, physicalInputAttempted, activationSubmitted: submitted,
      outcomeUnknown: steps > 0 || cleanupRequired, reconciliationRequired: submitted || steps > 0,
      ...(nativeCursorFocusEvidence ? { nativeCursorFocusEvidence } : {}),
      retryable: false, vollstaendig: false };
  } finally {
    if (heldLease) {
      try {
        spent.add(heldLease.nonce);
        const released = await release("native-release", binding, { lease: heldLease });
        const telemetry = released.focusTelemetry;
        cleanupRequired = released.ok !== true || released.cursorLeaseReleased !== true
          || !telemetry || typeof telemetry !== "object" || (telemetry as Record<string, unknown>).releasedByEmit !== true;
        if (!cleanupRequired) result = { ...result!, focusTelemetry: telemetry };
      } catch { cleanupRequired = true; }
    }
  }
  return { ...result!, ...(cleanupRequired ? { ok: false, vollstaendig: false,
    cleanupRequired: true, reconciliationRequired: true } : {}) };
}
