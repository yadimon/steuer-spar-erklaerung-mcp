import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import type { ScenarioExecutor } from "./scenario.js";
import type { QtNativeClient } from "./qt-native-client.js";
import type { QtNativeExecutorDependencies } from "./qt-native-executor.js";
import { QT_TABLE_FOCUS_BINDING, projectQtNativeCompleteTable, readQtNativeCompleteTable } from "./qt-native-tables.js";
import { executeNativeTargetPosition } from "./table-cursor-position.js";
import { bindingSchema, leaseSchema, nativeFocusBinding, publicCursorResult, rejectProof, sameContext,
  tableCursorModelFingerprint, bindNativeViewport, cursorProofActivation, CursorProofFailure,
  type CursorBinding, type CursorLease, type CursorPhase, type CompleteModel } from "./table-cursor-proofs.js";
import { executeNativeSteppedCursor } from "./table-cursor-step.js";
export { tableCursorModelFingerprint } from "./table-cursor-proofs.js";
export { executeTableCursorMutation } from "./table-cursor-mutation.js";

function cursorFailureEvidence(result: WorkerResult | undefined, modelUnchanged = false): Partial<WorkerResult> {
  const source: Partial<WorkerResult> = result ? publicCursorResult(result) : {};
  const evidence: Partial<WorkerResult> = {};
  const keys = ["kind", "steps", "schritte", "cursorActivation", "navigationEvidence", "focusTelemetry",
    "physicalInputAttempted", "physicalInputUsed", "activationSubmitted", "cleanupRequired"];
  if (modelUnchanged) keys.push("kopf", "zeilen", "rowDetails", "summe", "summen", "anzahl");
  for (const key of keys) {
    if (Object.hasOwn(source, key)) evidence[key] = source[key];
  }
  return evidence;
}

async function executeNativeCursorFocus(client: QtNativeClient, phase: CursorPhase, args: Record<string, unknown>,
  initial: CursorBinding, before: CompleteModel, remaining: () => number, release: CursorPhase,
  signal?: AbortSignal): Promise<WorkerResult> {
  nativeFocusBinding(before, initial);
  const fingerprint = tableCursorModelFingerprint(before);
  const nativeArgs = { ...args, hwnd: initial.hwnd };
  let binding = initial, lease: CursorLease | undefined, consumed = false, submitted = false;
  let physicalInputAttempted: boolean | null = false;
  let currentPhase = "native-acquire", cleanupRequired = false, handoverReported = false;
  let resumeResult: WorkerResult | undefined, nativeWholeModelUnchanged = false;
  let nativeFocusEvidence: Record<string, unknown> | undefined;
  let result: WorkerResult;
  try {
    const acquired = await phase("native-acquire", binding);
    if (!acquired.ok) return { ...publicCursorResult(acquired), retryable: false,
      ...(acquired.kind === "worker-isolation-lost" ? { cleanupRequired: true, reconciliationRequired: true } : {}) };
    handoverReported = true;
    lease = leaseSchema.parse(acquired.cursorLease);
    const acquiredBinding = bindingSchema.parse(acquired.cursorBinding);
    if (!sameContext(binding, acquiredBinding) || acquiredBinding.inputEpoch !== binding.inputEpoch
      || lease.rootHwnd !== binding.hwnd || lease.targetPid !== binding.pid || lease.inputEpoch !== binding.inputEpoch) {
      rejectProof("native-focus-lease-context");
    }
    binding = acquiredBinding;
    currentPhase = "native-focus-preproof";
    const prepared = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (tableCursorModelFingerprint(prepared) !== fingerprint) rejectProof("native-focus-pre-model");
    const focus = nativeFocusBinding(prepared, binding, true);
    nativeFocusEvidence = { currentIndex: [...focus.currentIndex], selectedIndexCount: focus.selectedIndexes.length,
      selectedIndexes: focus.selectedIndexes.slice(0, 32).map(index => [...index]),
      selectedIndexesTruncated: focus.selectedIndexes.length > 32, focusActionVerified: false };
    currentPhase = "native-focus-only";
    submitted = true;
    const focused = await client.requestAcknowledged("table_focus_only", {
      objectId: focus.tableId, binding: focus, expectedRootHwnd: binding.hwnd,
      expectedPid: binding.pid, expectedInputTick: binding.inputEpoch, expectedWindowTitle: binding.windowTitle,
    }, remaining(), signal);
    if (focused.result.ok !== true || focused.result.focused !== true || focused.result.physicalInputUsed !== false
      || focused.result.inputTick !== binding.inputEpoch || focused.result.outcomeUnknown === true
      || typeof focused.result.mutationAttempted !== "boolean"
      || (focused.result.mutationAttempted && !focused.receiptAcknowledged)
      || JSON.stringify(QT_TABLE_FOCUS_BINDING.parse(focused.result.binding)) !== JSON.stringify(focus)) {
      rejectProof("native-focus-acknowledged-postcondition");
    }
    currentPhase = "native-focus-readback";
    const post = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (tableCursorModelFingerprint(post) !== fingerprint
      || JSON.stringify(nativeFocusBinding(post, binding, true)) !== JSON.stringify(focus)) rejectProof("native-focus-post-model-selection");
    nativeFocusEvidence.focusActionVerified = true;
    currentPhase = "cursor-resume";
    physicalInputAttempted = null;
    const resumed = await phase("resume", binding, { lease, selectedRids: acquired.selectedRids });
    resumeResult = publicCursorResult(resumed);
    physicalInputAttempted = typeof resumed.steps === "number" ? resumed.steps > 0 : null;
    // Emit has already consumed the imported lease, even when restoration was
    // deliberately skipped for changed input. Never reacquire it after that.
    consumed = Boolean(resumed.focusTelemetry && typeof resumed.focusTelemetry === "object"
      && (resumed.focusTelemetry as Record<string, unknown>).releasedByEmit === true);
    if (!resumed.ok) {
      // A rejected cursor proof is different from an unconsumed lease. Keep
      // the worker's public diagnosis while finally enforces cleanup itself.
      currentPhase = "native-final-readback";
      const final = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
      if (tableCursorModelFingerprint(final) !== fingerprint) rejectProof("native-focus-final-model");
      nativeWholeModelUnchanged = true;
      currentPhase = "cursor-resume";
      rejectProof("native-focus-resume-worker-result");
    }
    if (!consumed) rejectProof("native-focus-resume-lease-completion");
    binding = bindingSchema.parse(resumed.cursorBinding);
    currentPhase = "native-final-readback";
    const final = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (tableCursorModelFingerprint(final) !== fingerprint) rejectProof("native-focus-final-model");
    currentPhase = "passive-final-checkpoint";
    const checkpoint = await phase("checkpoint", binding);
    if (!checkpoint.ok || checkpoint.cursorCheckpoint !== true) rejectProof("native-focus-final-epoch");
    result = { ...publicCursorResult(resumed), nativeWholeModelUnchanged: true, cursorTransaction: "native-focus-only", retryable: false };
  } catch (error) {
    result = { ...cursorFailureEvidence(resumeResult, nativeWholeModelUnchanged), ok: false,
      kind: resumeResult?.kind ?? "cursor-proof-failed", phase: currentPhase,
      proofCheck: error instanceof CursorProofFailure ? error.proofCheck : "native-or-worker-contract",
      error: nativeWholeModelUnchanged && resumeResult?.error ? resumeResult.error
        : "Nativer Tabellenfokus hat seinen vollstaendigen Nachweis verloren; frisch abgleichen, nicht wiederholen.",
      ...(nativeWholeModelUnchanged ? { nativeWholeModelUnchanged: true } : {}),
      activationSubmitted: submitted, physicalInputAttempted, outcomeUnknown: submitted || handoverReported,
      ...(nativeFocusEvidence ? { nativeCursorFocusEvidence: nativeFocusEvidence } : {}),
      reconciliationRequired: submitted || handoverReported, retryable: false, vollstaendig: false };
  } finally {
    if (lease && !consumed) {
      // A passive release can restore only the previously proven caller. It
      // gets no fresh epoch and may never raise/reacquire SSE after interference.
      try {
        const released = await release("native-release", binding, { lease });
        cleanupRequired = released.ok !== true || released.cursorLeaseReleased !== true;
      } catch { cleanupRequired = true; }
    }
    if (handoverReported && !lease) cleanupRequired = true;
  }
  return { ...result!, ...(cleanupRequired ? { cleanupRequired: true, reconciliationRequired: true } : {}) };
}

/** Public noKeys:false compiles private phases; callers cannot supply proof, coordinates or an epoch. */
export async function executeTableCursorRead(args: Record<string, unknown>, worker: ScenarioExecutor,
  dependencies: QtNativeExecutorDependencies, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS, signal?: AbortSignal,
  seekToEnd = false): Promise<WorkerResult> {
  if (!dependencies.qtNativeClient && !dependencies.qtNativeClientFor) return worker("table_read", args, timeoutMs, signal);
  const started = performance.now();
  const remaining = () => {
    const value = Math.floor(timeoutMs - (performance.now() - started));
    if (signal?.aborted || value < 1) throw new Error(signal?.aborted ? "Cursor transaction aborted." : "Cursor transaction deadline exceeded.");
    return value;
  };
  const phase = (name: string, binding?: CursorBinding, extra: Record<string, unknown> = {}) => worker("table_read", {
    ...args, noKeys: false, ...(binding ? { hwnd: binding.hwnd, pid: binding.pid } : {}),
    __tableCursorPlan: { schemaVersion: 1, phase: name, ...(binding ? { binding } : {}), ...extra },
  }, remaining(), signal);
  const release: CursorPhase = (name, binding, extra = {}) => worker("table_read", {
    ...args, noKeys: false, hwnd: binding!.hwnd, pid: binding!.pid,
    __tableCursorPlan: { schemaVersion: 1, phase: name, binding, ...extra },
  }, 5_000); // Independent, bounded passive cleanup; no aborted request signal.
  let activationSubmitted = false;
  let physicalInputAttempted: boolean | null = false;
  let currentPhase = "prebind";
  let traversalResult: WorkerResult | undefined;
  try {
    const prebind = await phase("prebind");
    if (!prebind.ok) return prebind;
    const binding = bindingSchema.parse(prebind.cursorBinding);
    const client = dependencies.qtNativeClient ?? await dependencies.qtNativeClientFor!({ hwnd: binding.hwnd }, remaining(), signal);
    if (client.binding.hwnd !== binding.hwnd || client.binding.pid !== binding.pid) throw new Error("Native session differs from the prebound process/window.");
    currentPhase = "native-preproof";
    const nativeArgs = { ...args, hwnd: binding.hwnd };
    const before = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    const ping = await client.request("ping", {}, remaining(), signal);
    if (ping.result.ok !== true || ping.result.pid !== binding.pid || ping.result.hwnd !== binding.hwnd
      || ping.result.recoveryRequired !== false || ping.result.mutationAcknowledgmentRequired !== false) {
      rejectProof("native-session-not-ready");
    }
    const capabilities = ping.result.capabilities;
    if (seekToEnd) {
      if (!capabilities || typeof capabilities !== "object"
        || (capabilities as Record<string, unknown>).tableFocusOnlyProtocol !== 1
        || (capabilities as Record<string, unknown>).tablePositionNumberProtocol !== 1) {
        rejectProof("native-append-position-protocol");
      }
      const targetRow = Array.from({ length: before.rows }, (_, row) => row)
        .filter(row => !before.hiddenRows.includes(row)).at(-1);
      if (targetRow === undefined) return rejectProof("native-append-position-empty-model");
      const positioned = await executeNativeTargetPosition(client, phase, args, binding, before, remaining, release, targetRow, signal);
      if (!positioned.ok) return publicCursorResult(positioned);
      return { ...projectQtNativeCompleteTable(before, Number(args.maxRows) || 400), ...publicCursorResult(positioned) };
    }
    if (capabilities && typeof capabilities === "object"
      && (capabilities as Record<string, unknown>).tableFocusOnlyProtocol === 1) {
      const nativeFirstHeader = before.headers[0];
      // Either observation of Nr. requires the strict shared number policy.
      // A disagreement must fail there before input, never enter legacy resume.
      if (/^Nr\.?$/u.test(binding.snapshot.kopf[0] ?? "")
        || (typeof nativeFirstHeader === "string" && /^Nr\.?$/u.test(nativeFirstHeader))) {
        return await executeNativeSteppedCursor(client, phase, args, binding, before, remaining, release, signal);
      }
      return await executeNativeCursorFocus(client, phase, args, binding, before, remaining, release, signal);
    }
    const fingerprint = tableCursorModelFingerprint(before);
    const geometry = await bindNativeViewport(client, binding, before, remaining, signal);
    // Probe reads can invalidate caches; the activation worker rebinds every own UIA target and verifies the inherited epoch.
    currentPhase = "viewport-activation";
    activationSubmitted = true;
    physicalInputAttempted = null;
    const activated = await phase("activate", binding, { geometry });
    physicalInputAttempted = activated.physicalInputUsed === true || activated.physicalInputAttempted === true ? true
      : activated.physicalInputUsed === false || activated.physicalInputAttempted === false ? false : null;
    currentPhase = "native-activation-readback";
    const post = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (tableCursorModelFingerprint(post) !== fingerprint) throw new Error("Table model changed during viewport activation; no cursor key is allowed.");
    if (!activated.ok) return { ...publicCursorResult(activated), nativeWholeModelUnchanged: true, retryable: false };
    const afterBinding = bindingSchema.parse(activated.cursorBinding);
    if (!sameContext(binding, afterBinding)) {
      throw new Error("Cursor activation changed its bound page/model context.");
    }
    currentPhase = "cursor-resume";
    const result = await phase("resume", afterBinding, { selectedRids: activated.selectedRids });
    traversalResult = publicCursorResult(result);
    if (typeof result.steps === "number" && result.steps > 0) physicalInputAttempted = true;
    currentPhase = "native-final-readback";
    const final = await readQtNativeCompleteTable(client, nativeArgs, remaining(), signal);
    if (tableCursorModelFingerprint(final) !== fingerprint) throw new Error("Table model changed during cursor traversal; do not repeat.");
    if (result.ok) {
      currentPhase = "passive-final-checkpoint";
      const checkpoint = await phase("checkpoint", bindingSchema.parse(result.cursorBinding));
      if (!checkpoint.ok || checkpoint.cursorCheckpoint !== true) throw new Error("Final native read lost the inherited input/window checkpoint.");
    }
    return { ...publicCursorResult(result), physicalInputAttempted,
      ...(!result.ok ? { outcomeUnknown: activationSubmitted, reconciliationRequired: activationSubmitted } : {}),
      nativeWholeModelUnchanged: true, cursorTransaction: "guarded-table-viewport", retryable: false };
  } catch (error) {
    return { ...cursorFailureEvidence(traversalResult), ok: false, kind: traversalResult?.kind ?? "cursor-proof-failed",
      error: "Geschuetzter Tabellenlauf konnte seinen vollstaendigen Zustandsnachweis nicht halten; frisch abgleichen, nicht wiederholen.",
      phase: currentPhase, proofCheck: error instanceof CursorProofFailure ? error.proofCheck : "native-or-worker-contract",
      ...cursorProofActivation(error),
      activationSubmitted, physicalInputAttempted, outcomeUnknown: activationSubmitted,
      reconciliationRequired: activationSubmitted, retryable: false, vollstaendig: false };
  }
}
