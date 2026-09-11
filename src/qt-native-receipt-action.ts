import { setTimeout as delay } from "node:timers/promises";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import {
  QtNativeAcknowledgmentError,
  QtNativeTransportError,
  type QtNativeClient,
} from "./qt-native-client.js";
import {
  fail,
  receiptDirtyState,
  receiptPolicySchema,
  receiptState,
  receiptToolSnapshot,
  receiptWindowSet,
} from "./qt-native-receipts.js";

/** Execute one catalogue-bound BelegManager navigation through an acknowledged in-process Qt action. */
export async function executeQtNativeReceiptManagerAction(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsedPolicy = receiptPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!parsedPolicy.success) return fail("invalid-catalog", "The active profile has no complete receipt-manager action policy.");
  const actionId = typeof args.actionId === "string" ? args.actionId : "";
  const action = Object.hasOwn(parsedPolicy.data.actions, actionId) ? parsedPolicy.data.actions[actionId] : undefined;
  if (!action) return fail("bad-args", `Unknown receipt-manager actionId '${actionId}'.`);
  const waitMs = args.waitMs === undefined ? 2500 : Number(args.waitMs);
  if (!Number.isSafeInteger(waitMs) || waitMs < 100 || waitMs > 10_000) {
    return fail("bad-args", "waitMs must be an integer from 100 through 10000.");
  }
  const started = performance.now();
  const remaining = () => Math.floor(timeoutMs - (performance.now() - started));
  let mutationDispatched = false;
  const budget = () => {
    const value = remaining();
    if (value < 1) {
      throw new QtNativeTransportError(
        "Native receipt deadline expired before postcondition verification.",
        "native-timeout",
        mutationDispatched,
      );
    }
    return value;
  };
  const before = await receiptToolSnapshot(client, parsedPolicy.data, budget(), signal);
  if (!before.windowEnabled || before.modalBlocked || before.stats.truncated) {
    return fail("window-obstructed", "The receipt manager is unavailable or obstructed.");
  }
  const stateBefore = receiptState(before.nodes, before.hwnd, parsedPolicy.data);
  if (stateBefore.error) return stateBefore.error;
  if (stateBefore.state !== action.fromState) {
    return fail(
      "precondition-failed",
      `Receipt-manager action '${actionId}' requires state '${action.fromState}', current state is '${stateBefore.state}'.`,
    );
  }
  const targets = before.nodes.filter(
    (node) => node.w > 0 && node.h > 0 && node.on && node.aid.endsWith(action.automationIdSuffix),
  );
  if (targets.length !== 1 || (action.expectedName && targets[0]!.name !== action.expectedName)) {
    return fail("precondition-failed", `The catalogue-bound receipt-manager target '${action.automationIdSuffix}' is not unique and exact.`);
  }
  const dirtyBefore = await receiptDirtyState(client, args.hwnd, parsedPolicy.data.title, budget(), signal);
  if (dirtyBefore.error) return dirtyBefore.error;
  const windowSetBefore = await receiptWindowSet(client, budget(), signal);
  if (windowSetBefore.error) return windowSetBefore.error;
  const target = targets[0]!;
  const clickBinding = { method: "qt-accessibility-press", rid: target.rid, aid: target.aid, name: target.name };
  let actionReply: Awaited<ReturnType<QtNativeClient["requestAcknowledged"]>>;
  let after: Awaited<ReturnType<typeof receiptToolSnapshot>> | undefined;
  let stateAfter: ReturnType<typeof receiptState> | undefined;
  try {
    try {
      actionReply = await client.requestAcknowledged("accessibility_action", {
        toolTitle: parsedPolicy.data.title,
        rid: target.rid,
        aid: target.aid,
        ...(action.expectedName ? { expectedName: action.expectedName } : {}),
        action: "press",
      }, budget(), signal);
      mutationDispatched = actionReply.result.mutationAttempted === true;
    } catch (error) {
      if (error instanceof QtNativeAcknowledgmentError && error.mutationResult.mutationAttempted === true) {
        mutationDispatched = true;
      }
      throw error;
    }
    if (actionReply.result.ok !== true) {
      return {
        ok: false,
        backend: "qt",
        kind: String(actionReply.result.code ?? "native-action"),
        error: String(actionReply.result.error ?? "Native receipt-manager action failed; do not replay."),
        mutationStarted: mutationDispatched,
        resultingState: mutationDispatched ? "unknown" : "unchanged",
        cleanupRequired: mutationDispatched,
        physicalInputUsed: false,
        foregroundLeaseUsed: false,
        clickBinding: {
          ...clickBinding,
          receiptAcknowledged: actionReply.receiptAcknowledged,
          mutationAckMs: actionReply.mutationAckMs,
        },
      };
    }
    const postconditionDeadline = Math.min(started + timeoutMs, performance.now() + waitMs);
    do {
      if (signal?.aborted) {
        throw new QtNativeTransportError(
          "Native receipt-manager action was cancelled after its acknowledged effect.",
          "aborted",
          true,
        );
      }
      await delay(Math.min(100, Math.max(1, postconditionDeadline - performance.now())));
      after = await receiptToolSnapshot(client, parsedPolicy.data, budget(), signal);
      stateAfter = receiptState(after.nodes, after.hwnd, parsedPolicy.data);
      if (!stateAfter.error && stateAfter.state === action.toState) break;
    } while (performance.now() < postconditionDeadline && remaining() > 0);
    const dirtyAfter = await receiptDirtyState(client, args.hwnd, parsedPolicy.data.title, budget(), signal);
    if (dirtyAfter.error) {
      throw new QtNativeTransportError(
        String(dirtyAfter.error.error ?? "Dirty-state postcondition failed."),
        String(dirtyAfter.error.kind ?? "postcondition-failed"),
        true,
      );
    }
    const windowSetAfter = await receiptWindowSet(client, budget(), signal);
    if (windowSetAfter.error) {
      throw new QtNativeTransportError(
        String(windowSetAfter.error.error ?? "Window-set postcondition failed."),
        String(windowSetAfter.error.kind ?? "postcondition-failed"),
        true,
      );
    }
    const windowSetUnchanged = windowSetAfter.fingerprint === windowSetBefore.fingerprint;
    const verified = Boolean(
      after
      && stateAfter
      && !stateAfter.error
      && stateAfter.state === action.toState
      && after.hwnd === before.hwnd
      && after.windowEnabled
      && !after.modalBlocked
      && !after.stats.truncated
      && dirtyAfter.dirty === dirtyBefore.dirty
      && windowSetUnchanged,
    );
    const common = {
      backend: "qt",
      actionId,
      pid: client.binding.pid,
      hwnd: before.hwnd,
      controlAutomationId: target.aid,
      controlName: target.name,
      stateBefore: stateBefore.state,
      stateAfter: stateAfter && !stateAfter.error ? stateAfter.state : null,
      stateFingerprintBefore: stateBefore.fingerprint,
      stateFingerprintAfter: stateAfter && !stateAfter.error ? stateAfter.fingerprint : null,
      windowSetFingerprintBefore: windowSetBefore.fingerprint,
      windowSetFingerprintAfter: windowSetAfter.fingerprint,
      windowSetUnchanged,
      ungespeichertVorher: dirtyBefore.dirty,
      ungespeichertNachher: dirtyAfter.dirty,
      dirtyStateUnchanged: dirtyAfter.dirty === dirtyBefore.dirty,
      physicalInputUsed: false,
      foregroundLeaseUsed: false,
      verified,
      clickBinding: {
        ...clickBinding,
        receiptAcknowledged: actionReply.receiptAcknowledged,
        mutationAckMs: actionReply.mutationAckMs,
      },
      nativeDurationMs: before.nativeDurationMs
        + dirtyBefore.durationMs!
        + windowSetBefore.durationMs!
        + (after?.nativeDurationMs ?? 0)
        + dirtyAfter.durationMs!
        + windowSetAfter.durationMs!
        + actionReply.durationMs,
    };
    return verified
      ? { ok: true, ...common }
      : {
          ok: false,
          kind: "postcondition-failed",
          error: "The acknowledged native receipt-manager action did not reach its exact catalogued state without dirty-state drift; do not replay.",
          ...common,
        };
  } catch (error) {
    if (!mutationDispatched) throw error;
    return {
      ok: false,
      backend: "qt",
      kind: error instanceof QtNativeTransportError ? error.kind : "postcondition-failed",
      error: `The acknowledged native receipt-manager action could not complete its postcondition checks: ${error instanceof Error ? error.message : String(error)} Do not replay.`,
      outcomeUnknown: true,
      mutationStarted: true,
      resultingState: "unknown",
      cleanupRequired: true,
      actionId,
      pid: client.binding.pid,
      hwnd: before.hwnd,
      controlAutomationId: target.aid,
      controlName: target.name,
      stateBefore: stateBefore.state,
      stateAfter: stateAfter && !stateAfter.error ? stateAfter.state : null,
      stateFingerprintBefore: stateBefore.fingerprint,
      stateFingerprintAfter: stateAfter && !stateAfter.error ? stateAfter.fingerprint : null,
      windowSetFingerprintBefore: windowSetBefore.fingerprint,
      ungespeichertVorher: dirtyBefore.dirty,
      physicalInputUsed: false,
      foregroundLeaseUsed: false,
      clickBinding,
      verified: false,
    };
  }
}
