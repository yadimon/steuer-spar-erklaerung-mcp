import type { WorkerResult } from "./api-contract.js";
import { QtNativeAcknowledgmentError, QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { QT_TABLE_FOCUS_BINDING, readQtNativeCompleteTable } from "./qt-native-tables.js";
import { bindingSchema, leaseSchema, nativeFocusBinding, numberPolicy, publicCursorResult, rejectProof,
  bindNativeViewport, sameContext, tableCursorModelFingerprint, CursorProofFailure,
  type CursorBinding, type CursorLease, type CursorPhase, type CompleteModel } from "./table-cursor-proofs.js";
import { sameSteppedContext } from "./table-cursor-step.js";

// Native replies can contain application values and transport authority. Only
// fixed producer reasons and scalar proof outcomes may leave this transaction.
const nativeCodes = new Set(["unrecognized", "INVALID_POSITION_TARGET", "window-obstructed", "precondition-failed", "position-outcome-unknown", "stale-window", "stale",
  "editor-open", "worker-isolation-lost", "busy", "NATIVE_OPERATION_FAILED", "GUI_DISPATCH_FAILED", "GUI_QUEUE_TIMEOUT",
  "GUI_OPERATION_TIMEOUT", "NO_QT_APPLICATION", "SESSION_OWNER_GONE", "UNAUTHORIZED", "SESSION_RELEASING", "RECOVERY_REQUIRED",
  "MUTATION_ACK_REQUIRED", "INVALID_REQUEST", "INVALID_MUTATION_RECEIPT"]);
const nativeReasons = new Map([
  ["The bound window is disabled or blocked by a modal dialog", "window-disabled-or-modal"],
  ["The exact root, foreground, title or original input epoch changed", "root-or-input-epoch"],
  ["The exact complete table/model/current-selection binding changed", "prior-complete-binding"],
  ["The new viewport editor is not the exact current Nr. delegate", "new-number-delegate"],
  ["The fresh Nr. delegate has no exact profiled accessible identity", "new-number-accessible-identity"],
  ["The final exact model, target or original input epoch changed", "final-model-target-or-epoch"],
  ["The exact table is unavailable or blocked by a modal/popup", "table-unavailable-or-modal"],
  ["The exact table has no directly focusable flat model", "table-flat-focus-model"],
  ["The currently focused widget is not a proven owned passive focus source", "focused-source-not-passive"],
  ["The exact table editor inventory exceeds its bound", "editor-inventory-bound"],
  ["The exact table contains an unproven visible viewport widget", "other-visible-viewport-widget"],
  ["The exact table model is not completely bounded", "model-size-bound"],
  ["The exact table has no already bound current model index", "missing-current-index"],
  ["The exact table contains an invalid model index", "invalid-model-index"],
  ["The exact table contains a live index widget", "live-index-widget"],
  ["The exact target Nr. index is hidden or outside its flat model", "hidden-or-outside-target"],
  ["The exact target Nr. index is not an enabled plain selectable cell", "target-number-flags"],
  ["The complete model or exact target identity changed before positioning", "prior-model-or-target-identity"],
  ["The exact model, root or index changed during Nr. selection", "selection-object-lifetime"],
  ["The exact target Nr. cell did not retain current index and sole selection", "target-current-and-selection"],
  ["Nr. selection changed the complete raw model", "selection-changed-model"],
  ["The exact model, root or index changed during target scrolling", "scroll-object-lifetime"],
  ["The exact sole target Nr. selection is not fully contained in its genuine viewport", "target-not-contained"],
  ["Target scrolling changed the complete raw model", "scroll-changed-model"],
  ["Operation is still executing on the GUI thread; verify its outcome before retry", "gui-operation-running"],
  ["Operation cancelled before GUI dispatch", "gui-queue-cancelled"],
  ["The previous controller ended without releasing its lease", "prior-controller-abandoned"],
  ["Session controller lease could not be released", "controller-release"],
]);
const nativeTransportKinds = new Set(["unrecognized", "native-mutation-receipt", "native-timeout", "native-connection", "native-protocol",
  "native-closed", "native-transaction-busy", "native-request", "native-request-size", "native-queue-full", "aborted"]);
// Completed, current-request pre-action rejections only. A global recovery,
// draining session or competing controller is not a clean table no-op.
const nativeNoopRejectionCodes = new Set(["INVALID_POSITION_TARGET", "window-obstructed", "precondition-failed",
  "stale-window", "stale", "editor-open"]);
const checkpointReasons = new Set(["phase-precondition", "inherited-context", "target-proof", "desktop", "inputEpoch",
  "foreground", "windowSet", "dirtyState", "lease-import", "lease-publication"]);
const checkpointProofReasons = new Set(["native-position-checkpoint-plan", "native-position-checkpoint-viewport", "native-position-checkpoint-live-input",
  "native-position-checkpoint-selection-count", "native-position-checkpoint-proof-exception", "exact-native-position-current-selected-contained",
  "current-number-cell-unbound", "current-number-snapshot-unbound", "current-number-policy-unbound", "current-number-native-viewport-unbound",
  "current-number-focused-source-unbound", "current-number-selected-grid-pattern-unbound", "current-number-selected-grid-container-unbound",
  "current-number-focused-type-unbound", "current-number-focused-node-not-unique", "current-number-cell-metadata-unbound",
  "current-number-cell-not-fresh", "current-number-cell-live-metadata-changed", "current-number-cell-pattern-unbound",
  "current-number-cell-not-selected", "current-number-cell-grid-unbound", "current-number-cell-prior-native-value-unbound",
  "current-number-row-outside-native-viewport", "current-number-cell-proof-exception", "exact-current-grid-number-cell"]);

export function sanitizePositionCheckpoint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const code = (key: string, allowed: Set<string>) => typeof source[key] === "string"
    ? allowed.has(source[key]) ? source[key] : "unrecognized" : null;
  return { reason: code("reason", checkpointReasons), proofReason: code("proofReason", checkpointProofReasons),
    ...Object.fromEntries(["targetProven", "desktop", "inputEpoch", "foreground", "windowSet", "dirtyState", "leaseImported", "leasePublished"]
      .map(key => [key, typeof source[key] === "boolean" ? source[key] : null])) };
}

/** Re-project an already bounded diagnosis; never trust extra producer fields. */
export function sanitizeNativePositionDiagnostic(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.operation !== "table_position_number" && source.operation !== "table_focus_only") return undefined;
  const bool = (key: string) => typeof source[key] === "boolean" ? source[key] : null;
  return { operation: source.operation, code: typeof source.code === "string" && nativeCodes.has(source.code) ? source.code : null,
    reason: typeof source.reason === "string" && (source.reason === "unrecognized" || [...nativeReasons.values()].includes(source.reason)) ? source.reason : null,
    transportKind: typeof source.transportKind === "string" && nativeTransportKinds.has(source.transportKind) ? source.transportKind : null,
    ...Object.fromEntries(["replyReceived", "ok", "completed", "physicalInputUsed", "inputEpochMatches", "mutationAttempted",
      "outcomeUnknown", "receiptPresent", "receiptFormatValid", "receiptAcknowledged", "numberEditorPending"].map(key => [key, bool(key)])) };
}

function nativePositionDiagnostic(operation: string, epoch: number, result?: Record<string, unknown>, acknowledged?: boolean, transportKind?: string) {
  const bool = (value: unknown) => typeof value === "boolean" ? value : null;
  const receipt = result?.mutationReceipt;
  return { operation, replyReceived: result !== undefined, code: typeof result?.code === "string"
    ? nativeCodes.has(result.code) ? result.code : "unrecognized" : null,
    reason: typeof result?.error === "string" ? nativeReasons.get(result.error) ?? "unrecognized" : null,
    ok: bool(result?.ok), completed: bool(result?.[operation === "table_position_number" ? "positioned" : "focused"]),
    physicalInputUsed: bool(result?.physicalInputUsed), inputEpochMatches: Number.isInteger(result?.inputTick) ? result?.inputTick === epoch : null,
    mutationAttempted: bool(result?.mutationAttempted), outcomeUnknown: bool(result?.outcomeUnknown),
    receiptPresent: result !== undefined && Object.hasOwn(result, "mutationReceipt"),
    receiptFormatValid: typeof receipt === "string" && /^[1-9][0-9]{0,19}$/u.test(receipt) && BigInt(receipt) <= 0xffffffffffffffffn,
    receiptAcknowledged: bool(acknowledged), numberEditorPending: bool(result?.numberEditorPending),
    transportKind: transportKind === undefined ? null : nativeTransportKinds.has(transportKind) ? transportKind : "unrecognized" };
}

/** One exact broker navigation; never calls cell activation, keys or a replay route. */
export async function executeNativeTargetPosition(client: QtNativeClient, phase: CursorPhase, args: Record<string, unknown>,
  initial: CursorBinding, before: CompleteModel, remaining: () => number, release: CursorPhase,
  targetRow: number, signal?: AbortSignal): Promise<WorkerResult> {
  const fingerprint = tableCursorModelFingerprint(before), policy = numberPolicy(before, initial);
  if (!Number.isInteger(targetRow) || targetRow < 0 || targetRow >= before.rows || before.rows > 1000
    || before.hiddenRows.includes(targetRow) || before.hiddenColumns.includes(0)) rejectProof("native-position-target-row");
  const numberModel = before.values.map(row => ({ display: row[0]!.display, edit: row[0]!.edit, flags: row[0]!.flags }));
  if (before.values.some(row => (row[0]!.flags & 33) !== 33 || (row[0]!.flags & 16) !== 0 || row[0]!.checkState !== null
    || (row[0]!.display !== null && typeof row[0]!.display !== "string")
    || (row[0]!.edit !== null && typeof row[0]!.edit !== "string"))) rejectProof("native-position-number-model");
  let binding = initial, lease: CursorLease | undefined, unknownAuthority = false, nativeQuiescent = true;
  const issuedNonces = new Set<string>();
  let submitted = false, positioned = false, stage = "native-position-preproof", result: WorkerResult;
  // A no-op rejection can revoke the handed-over lease without moving focus.
  // This is never authority to restore the caller across an unproven editor.
  let acquisitionNoActionProved = false, provenInitialNoop = false;
  let nativeDiagnostic: ReturnType<typeof nativePositionDiagnostic> | undefined;
  const nativeRelease: { attempted: boolean; workerOk: boolean | null; leaseReleased: boolean | null;
    releasedByEmit: boolean | null; threw: boolean } = {
    attempted: false, workerOk: null, leaseReleased: null, releasedByEmit: null, threw: false,
  };
  const verify = async () => {
    const model = await readQtNativeCompleteTable(client, { ...args, hwnd: binding.hwnd }, remaining(), signal);
    if (tableCursorModelFingerprint(model) !== fingerprint) rejectProof("native-position-whole-model");
    return model;
  };
  const acknowledged = async (op: string, expected: ReturnType<typeof nativeFocusBinding>, extra: Record<string, unknown> = {}) => {
    const budget = remaining();
    const priorSubmitted = submitted;
    submitted = true; nativeQuiescent = false;
    nativeDiagnostic = nativePositionDiagnostic(op, binding.inputEpoch);
    let reply: Awaited<ReturnType<QtNativeClient["requestAcknowledged"]>>;
    try {
      reply = await client.requestAcknowledged(op, { objectId: expected.tableId, binding: expected,
        expectedRootHwnd: binding.hwnd, expectedPid: binding.pid, expectedInputTick: binding.inputEpoch,
        expectedWindowTitle: binding.windowTitle, ...extra }, budget, signal);
    } catch (error) {
      nativeDiagnostic = nativePositionDiagnostic(op, binding.inputEpoch,
        error instanceof QtNativeAcknowledgmentError ? error.mutationResult : undefined, undefined,
        error instanceof QtNativeTransportError ? error.kind : "unrecognized");
      throw error;
    }
    nativeDiagnostic = nativePositionDiagnostic(op, binding.inputEpoch, reply.result, reply.receiptAcknowledged);
    nativeQuiescent = reply.result.outcomeUnknown !== true && typeof reply.result.mutationAttempted === "boolean"
      && (!reply.result.mutationAttempted || reply.receiptAcknowledged);
    // A first, explicitly rejected native dispatch is a proven no-op. A lost
    // reply, a receipt, or any earlier footer/position action stays unknown.
    if (!priorSubmitted && !positioned && op === "table_position_number" && reply.result.ok === false
      && reply.result.mutationAttempted === false && reply.result.outcomeUnknown !== true
      && !Object.hasOwn(reply.result, "mutationReceipt") && reply.receiptAcknowledged === false) {
      submitted = false;
      provenInitialNoop = acquisitionNoActionProved && reply.result.outcomeUnknown === false
        && reply.result.controllerBound === true && typeof reply.result.code === "string"
        && nativeNoopRejectionCodes.has(reply.result.code) && reply.result.positioned !== true
        && reply.result.numberEditorPending !== true && reply.result.physicalInputUsed !== true;
    }
    if (reply.result.ok !== true || reply.result[op === "table_position_number" ? "positioned" : "focused"] !== true
      || reply.result.physicalInputUsed !== false || reply.result.inputTick !== binding.inputEpoch
      || reply.result.outcomeUnknown === true || typeof reply.result.mutationAttempted !== "boolean"
      || (reply.result.mutationAttempted && !reply.receiptAcknowledged)) rejectProof("native-position-acknowledgment");
    if (op === "table_position_number" && typeof reply.result.numberEditorPending !== "boolean") rejectProof("native-position-editor-inventory");
    if (reply.result.numberEditorPending === true) nativeQuiescent = false;
    return { focus: QT_TABLE_FOCUS_BINDING.parse(reply.result.binding), numberEditorPending: reply.result.numberEditorPending === true };
  };
  const adopt = (checkpoint: WorkerResult, parent: CursorLease) => {
    const next = leaseSchema.parse(checkpoint.cursorLease), nextBinding = bindingSchema.parse(checkpoint.cursorBinding);
    if (issuedNonces.has(next.nonce) || next.nonce === parent.nonce || next.rootHwnd !== parent.rootHwnd || next.targetPid !== parent.targetPid
      || next.inputEpoch !== initial.inputEpoch || nextBinding.inputEpoch !== initial.inputEpoch
      || JSON.stringify(next.previous) !== JSON.stringify(parent.previous) || JSON.stringify(next.previousCursor) !== JSON.stringify(parent.previousCursor)
      || !sameSteppedContext(binding, nextBinding) || checkpoint.cursorCheckpoint !== true) rejectProof("native-position-checkpoint-context");
    issuedNonces.add(next.nonce); lease = next; binding = nextBinding; unknownAuthority = false;
  };
  try {
    await bindNativeViewport(client, initial, before, remaining, signal);
    stage = "native-position-acquire";
    const acquired = await phase("native-position-acquire", binding, { numberPolicy: policy, numberModel });
    const acquireActivation = acquired.cursorActivation as { footerFocus?: { focusAttempted?: unknown } } | undefined;
    const footerFocusAttempted = acquireActivation?.footerFocus?.focusAttempted === true || acquired.activationSubmitted === true;
    if (!acquired.ok) return { ...publicCursorResult(acquired), phase: stage,
      ...(footerFocusAttempted ? { activationSubmitted: true, outcomeUnknown: true, reconciliationRequired: true } : {}),
      proofCheck: "native-position-acquire-worker-result", retryable: false };
    submitted = footerFocusAttempted;
    unknownAuthority = true; lease = leaseSchema.parse(acquired.cursorLease);
    issuedNonces.add(lease.nonce);
    const fresh = bindingSchema.parse(acquired.cursorBinding);
    if (!sameContext(binding, fresh) || lease.rootHwnd !== binding.hwnd || lease.targetPid !== binding.pid
      || lease.inputEpoch !== binding.inputEpoch || fresh.inputEpoch !== binding.inputEpoch) rejectProof("native-position-acquire-context");
    binding = fresh; unknownAuthority = false;
    // The successful acquire producer explicitly emits these three no-action
    // fields even when it reuses existing table focus without a footer call.
    // Missing, mistyped or contradictory evidence is not no-op authority.
    acquisitionNoActionProved = acquired.ok === true && acquired.activationSubmitted === false
      && acquired.physicalInputUsed === false && acquired.steps === 0;
    let model = await verify(), focus = nativeFocusBinding(model, binding);
    stage = "native-position-dispatch";
    const positionReply = await acknowledged("table_position_number", focus, { targetRow }), afterPosition = positionReply.focus;
    positioned = true;
    if (afterPosition.tableId !== focus.tableId || afterPosition.modelId !== focus.modelId || afterPosition.tableAid !== focus.tableAid
      || afterPosition.tableName !== focus.tableName || afterPosition.modelFingerprint !== focus.modelFingerprint
      || JSON.stringify(afterPosition.currentIndex) !== JSON.stringify([targetRow, 0])
      || JSON.stringify(afterPosition.selectedIndexes) !== JSON.stringify([[targetRow, 0]])) rejectProof("native-position-target-selection");
    model = await verify(); focus = nativeFocusBinding(model, binding, true);
    if (JSON.stringify(focus) !== JSON.stringify(afterPosition)) rejectProof("native-position-current-model-readback");
    if (positionReply.numberEditorPending) {
      // Native never closes a delegate. The independent UIA preparation phase
      // consumes this lease, proves the exact unchanged target Nr. and hands
      // over fresh authority only after its profiled footer closure is proven.
      nativeQuiescent = false; stage = "native-position-number-preparation";
      const geometry = await bindNativeViewport(client, binding, model, remaining, signal);
      const parent = lease;
      const preparation = phase("native-position-prepare", binding, { lease: parent,
        position: { targetRow, numberModel, numberPolicy: policy, geometry } });
      lease = undefined; unknownAuthority = true;
      const prepared = await preparation;
      if (!prepared.ok) rejectProof("native-position-number-closure");
      adopt(prepared, parent); nativeQuiescent = true;
      model = await verify();
      if (JSON.stringify(nativeFocusBinding(model, binding, true)) !== JSON.stringify(focus)) rejectProof("native-position-number-closure-model");
    }
    stage = "native-position-focus-only";
    const afterFocus = (await acknowledged("table_focus_only", focus)).focus;
    if (JSON.stringify(afterFocus) !== JSON.stringify(focus)) rejectProof("native-position-focus-binding");
    model = await verify();
    if (JSON.stringify(nativeFocusBinding(model, binding, true)) !== JSON.stringify(focus)) rejectProof("native-position-focus-current-selection");
    const geometry = await bindNativeViewport(client, binding, model, remaining, signal);
    stage = "native-position-checkpoint";
    if (!lease) rejectProof("native-position-missing-checkpoint-authority");
    const parent = leaseSchema.parse(lease);
    const checking = phase("native-position-checkpoint", binding, { lease: parent,
      position: { targetRow, numberModel, numberPolicy: policy, geometry } });
    lease = undefined; unknownAuthority = true;
    const checkpoint = await checking;
    if (!checkpoint.ok) {
      const checkpointActivation = checkpoint.cursorActivation;
      const positionCheckpoint = sanitizePositionCheckpoint(checkpointActivation && typeof checkpointActivation === "object"
        ? (checkpointActivation as Record<string, unknown>).positionCheckpoint : undefined);
      result = { ...publicCursorResult(checkpoint), ok: false, phase: stage, proofCheck: "native-position-checkpoint-worker-result",
        activationSubmitted: submitted, outcomeUnknown: true, cleanupRequired: true, reconciliationRequired: true, retryable: false,
        physicalInputUsed: false, physicalInputAttempted: false, steps: 0,
        ...(nativeDiagnostic ? { cursorActivation: { source: "qt-native", subphase: stage, activationAttempted: submitted,
          nativePosition: nativeDiagnostic, ...(positionCheckpoint ? { positionCheckpoint } : {}) } } : {}) };
    } else {
      adopt(checkpoint, parent);
      await verify();
      // Mandatory native-release repeats the passive context checks before
      // importing this lease. Keep the removed phase's local cancellation gate.
      remaining();
      result = { ok: true, cursorBinding: binding, physicalInputUsed: false, steps: 0, nativeWholeModelUnchanged: true,
        lastRowFullyContained: true, cursorTransaction: "native-target-position", retryable: false };
    }
  } catch (error) {
    result = { ok: false, kind: "cursor-proof-failed", phase: stage,
      proofCheck: error instanceof CursorProofFailure ? error.proofCheck : "native-position-contract",
      error: "Native Zielpositionierung verlor ihren Nachweis; frisch abgleichen, nicht wiederholen.",
      physicalInputAttempted: false, physicalInputUsed: false, steps: 0, activationSubmitted: submitted,
      ...(nativeDiagnostic ? { cursorActivation: { source: "qt-native", subphase: stage, activationAttempted: submitted,
        nativePosition: nativeDiagnostic } } : {}),
      outcomeUnknown: submitted || !nativeQuiescent, reconciliationRequired: submitted || positioned || unknownAuthority,
      retryable: false, vollstaendig: false };
  } finally {
    if (lease && nativeQuiescent) {
      nativeRelease.attempted = true;
      try {
        const released = await release(provenInitialNoop ? "native-revoke-noop" : "native-release", binding, { lease });
        const telemetry = released.focusTelemetry;
        const marker = provenInitialNoop ? released.cursorLeaseRevoked : released.cursorLeaseReleased;
        const details = telemetry && typeof telemetry === "object" ? telemetry as Record<string, unknown> : undefined;
        const foreground = details?.foreground && typeof details.foreground === "object"
          ? details.foreground as Record<string, unknown> : undefined;
        const preserved = details?.foregroundRestored === false && details?.cursorRestored === false
          && details?.restoreSkippedReason === "cursor-source-not-proven-editor-free"
          && foreground?.afterRestoreHwnd === binding.hwnd;
        unknownAuthority = released.ok !== true || marker !== true || details?.releasedByEmit !== true
          || (provenInitialNoop && (!preserved || released.cursorLeaseReleased === true));
        if (provenInitialNoop && (details?.foregroundRestored === true || details?.cursorRestored === true
          || (typeof details?.restoreSkippedReason === "string" && details.restoreSkippedReason !== "cursor-source-not-proven-editor-free")
          || (typeof foreground?.afterRestoreHwnd === "number" && foreground.afterRestoreHwnd !== binding.hwnd))) {
          result = { ...result!, outcomeUnknown: true, cleanupRequired: true, reconciliationRequired: true };
        }
        try {
          nativeRelease.workerOk = typeof released.ok === "boolean" ? released.ok : null;
          nativeRelease.leaseReleased = typeof marker === "boolean" ? marker : null;
          const releasedByEmit = telemetry && typeof telemetry === "object"
            ? (telemetry as Record<string, unknown>).releasedByEmit : undefined;
          nativeRelease.releasedByEmit = typeof releasedByEmit === "boolean" ? releasedByEmit : null;
        } catch { /* Local diagnostics cannot change the existing release proof. */ }
        if (!unknownAuthority) result = { ...result!, focusTelemetry: telemetry };
      } catch { nativeRelease.threw = true; unknownAuthority = true; }
    } else if (lease) unknownAuthority = true;
  }
  return { ...result!, ...(nativeDiagnostic && (result!.ok === false || unknownAuthority) ? {
    cursorActivation: { ...(result!.cursorActivation as Record<string, unknown> | undefined), nativeRelease },
  } : {}), ...(unknownAuthority ? { ok: false, cleanupRequired: true, reconciliationRequired: true } : {}) };
}
