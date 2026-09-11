import { setTimeout as delay } from "node:timers/promises";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeAcknowledgmentError, QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import type { QtSnapshotNode } from "./qt-native-snapshot.js";
import {
  detailBindingFingerprint,
  detailIdentityMatches,
  exactDetailClose,
  fail,
  receiptDetailFields,
  receiptDetailSnapshot,
  receiptDirtyState,
  receiptEditableValues,
  receiptList,
  receiptPolicySchema,
  receiptState,
  receiptToolSnapshot,
  receiptWindowSet,
  sameSemanticRow,
  type ReceiptListProjection,
} from "./qt-native-receipts.js";

/** Read one exact receipt detail through acknowledged in-process Qt cell/close actions. */
export async function executeQtNativeReceiptManagerRead(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsedPolicy = receiptPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!parsedPolicy.success) return fail("invalid-catalog", "The active profile has no complete receipt-manager detail policy.");
  const rowRid = typeof args.rowRid === "string" ? args.rowRid : "";
  const rowFingerprint = typeof args.rowFingerprint === "string" ? args.rowFingerprint.toUpperCase() : "";
  const expectedListFingerprint = typeof args.expectedListFingerprint === "string"
    ? args.expectedListFingerprint.toUpperCase() : "";
  const waitMs = args.waitMs === undefined ? 2500 : Number(args.waitMs);
  if (!rowRid || !/^[A-F0-9]{64}$/u.test(rowFingerprint) || !/^[A-F0-9]{64}$/u.test(expectedListFingerprint)) {
    return fail("bad-args", "rowRid, rowFingerprint and expectedListFingerprint are required.");
  }
  if (!Number.isSafeInteger(waitMs) || waitMs < 100 || waitMs > 10_000) {
    return fail("bad-args", "waitMs must be an integer from 100 through 10000.");
  }
  const policy = parsedPolicy.data;
  const started = performance.now();
  const remaining = () => Math.floor(timeoutMs - (performance.now() - started));
  let mutationDispatched = false;
  let clickBinding: Record<string, unknown> = { method: "already-open-detail", clickCount: 0 };
  let closeBinding: Record<string, unknown> | null = null;
  let lastActionBinding: Record<string, unknown> | null = null;
  const budget = () => {
    const value = remaining();
    if (value < 1) throw new QtNativeTransportError(
      "Native receipt deadline expired before postcondition verification.", "native-timeout", mutationDispatched);
    return value;
  };
  let nativeDurationMs = 0;
  const before = await receiptDetailSnapshot(client, policy, budget(), signal);
  nativeDurationMs += before.nativeDurationMs;
  if (!before.windowEnabled || before.modalBlocked || before.stats.truncated) {
    return fail("window-obstructed", "The receipt manager is unavailable, obstructed or incomplete.");
  }
  const stateBefore = receiptState(before.nodes, before.hwnd, policy);
  if (stateBefore.error) return stateBefore.error;
  if (stateBefore.state !== "list") return fail("precondition-failed", `Receipt detail requires state 'list', current state is '${stateBefore.state}'.`);
  const listBefore = receiptList(before.nodes, policy);
  if ("error" in listBefore) return listBefore.error;
  if (listBefore.listFingerprint !== expectedListFingerprint) {
    return fail("stale", "The receipt list changed since receipt_manager_list; no native action was dispatched.");
  }
  const boundRows = listBefore.rows.filter(row => row.rowRid === rowRid && row.rowFingerprint === rowFingerprint);
  if (boundRows.length !== 1) return fail("stale", `${boundRows.length} exact bound receipt rows found; no native action was dispatched.`);
  const rowBefore = boundRows[0]!;
  const dirtyBefore = await receiptDirtyState(client, args.hwnd, policy.title, budget(), signal);
  if (dirtyBefore.error) return dirtyBefore.error;
  nativeDurationMs += dirtyBefore.durationMs!;
  const windowSetBefore = await receiptWindowSet(client, budget(), signal);
  if (windowSetBefore.error) return windowSetBefore.error;
  nativeDurationMs += windowSetBefore.durationMs!;

  const action = async (node: QtSnapshotNode, kind: "press" | "activate-table-cell", method: string) => {
    lastActionBinding = { method, rid: node.rid, aid: node.aid, name: node.name };
    let reply: Awaited<ReturnType<QtNativeClient["requestAcknowledged"]>>;
    try {
      reply = await client.requestAcknowledged("accessibility_action", {
        toolTitle: policy.title,
        rid: node.rid,
        aid: node.aid,
        expectedName: node.name,
        action: kind,
      }, budget(), signal);
      mutationDispatched ||= reply.result.mutationAttempted === true;
    } catch (error) {
      if (error instanceof QtNativeAcknowledgmentError && error.mutationResult.mutationAttempted === true) {
        mutationDispatched = true;
      }
      throw error;
    }
    nativeDurationMs += reply.durationMs;
    const binding = { method, rid: node.rid, aid: node.aid, name: node.name,
      receiptAcknowledged: reply.receiptAcknowledged, mutationAckMs: reply.mutationAckMs };
    lastActionBinding = binding;
    return { reply, binding };
  };

  try {
  let detail = before;
  let fields = receiptDetailFields(detail.nodes);
  let editable = receiptEditableValues(detail.nodes, policy);
  let identityMatches = editable.complete && detailIdentityMatches(editable.values, rowBefore, policy)
    && listBefore.listFingerprint === expectedListFingerprint;
  let rowVisibilityAttempts = 0;
  if (!identityMatches) {
    const targets = rowBefore.cells.filter(cell => cell.rid === rowBefore.rowRid && cell.name);
    if (targets.length !== 1) return fail("stale", `${targets.length} exact native receipt cells found; no action was dispatched.`);
    const target = before.nodes.filter(node => node.rid === targets[0]!.rid && node.aid.endsWith(policy.list.tableAutomationIdSuffix)
      && node.name === targets[0]!.name && node.type === "DataItem");
    if (target.length !== 1) return fail("stale", `${target.length} live exact native receipt cells found; no action was dispatched.`);
    const opened = await action(target[0]!, "activate-table-cell", "qt-table-cell-activate");
    clickBinding = opened.binding;
    rowVisibilityAttempts = 1;
    if (opened.reply.result.ok !== true) {
      return { ok: false, backend: "qt", kind: String(opened.reply.result.code ?? "native-action"),
        error: String(opened.reply.result.error ?? "The exact native receipt cell could not be activated; do not replay."),
        physicalInputUsed: false, foregroundLeaseUsed: false, clickBinding, nativeDurationMs };
    }
    const openDeadline = Math.min(started + timeoutMs, performance.now() + waitMs);
    do {
      await delay(Math.min(100, Math.max(1, openDeadline - performance.now())));
      detail = await receiptDetailSnapshot(client, policy, budget(), signal);
      nativeDurationMs += detail.nativeDurationMs;
      fields = receiptDetailFields(detail.nodes);
      editable = receiptEditableValues(detail.nodes, policy);
      identityMatches = editable.complete && detailIdentityMatches(editable.values, rowBefore, policy);
      if (fields.length && identityMatches && exactDetailClose(detail.nodes, policy).length === 1) break;
    } while (performance.now() < openDeadline && remaining() > 0);
  }

  const detailFingerprint = editable.complete ? detailBindingFingerprint(editable.values) : null;
  const closeTargets = exactDetailClose(detail.nodes, policy);
  let listAfter: ReceiptListProjection | null = null;
  let restored: Awaited<ReturnType<typeof receiptToolSnapshot>> | null = null;
  if (closeTargets.length === 1) {
    const closed = await action(closeTargets[0]!, "press", "qt-accessibility-press");
    closeBinding = closed.binding;
    if (closed.reply.result.ok === true) {
      const restoreDeadline = Math.min(started + timeoutMs, performance.now() + waitMs);
      const expectedSemanticRows = listBefore.rows.map(row => row.contentFingerprint).sort();
      do {
        await delay(Math.min(100, Math.max(1, restoreDeadline - performance.now())));
        restored = await receiptToolSnapshot(client, policy, budget(), signal);
        nativeDurationMs += restored.nativeDurationMs;
        const candidate = receiptList(restored.nodes, policy);
        if (!("error" in candidate)) {
          listAfter = candidate;
          const actual = candidate.rows.map(row => row.contentFingerprint).sort();
          if (candidate.rowsComplete && candidate.count === listBefore.count
            && JSON.stringify(actual) === JSON.stringify(expectedSemanticRows)) break;
        }
      } while (performance.now() < restoreDeadline && remaining() > 0);
    }
  }

  const dirtyAfter = await receiptDirtyState(client, args.hwnd, policy.title, budget(), signal);
  if (dirtyAfter.error) throw new QtNativeTransportError(
    String(dirtyAfter.error.error ?? "Dirty-state postcondition failed."),
    String(dirtyAfter.error.kind ?? "postcondition-failed"), true);
  nativeDurationMs += dirtyAfter.durationMs!;
  const windowSetAfter = await receiptWindowSet(client, budget(), signal);
  if (windowSetAfter.error) throw new QtNativeTransportError(
    String(windowSetAfter.error.error ?? "Window-set postcondition failed."),
    String(windowSetAfter.error.kind ?? "postcondition-failed"), true);
  nativeDurationMs += windowSetAfter.durationMs!;
  const expectedSemanticRows = listBefore.rows.map(row => row.contentFingerprint).sort();
  const actualSemanticRows = listAfter ? listAfter.rows.map(row => row.contentFingerprint).sort() : [];
  const exactRowsAfter = listAfter
    ? listAfter.rows.filter(row => row.rowRid === rowBefore.rowRid && row.rowFingerprint === rowBefore.rowFingerprint) : [];
  const semanticRowsAfter = listAfter
    ? listAfter.rows.filter(row => sameSemanticRow(row, rowBefore)) : [];
  const semanticListUnchanged = Boolean(listAfter && listAfter.rowsComplete
    && listAfter.count === listBefore.count && JSON.stringify(actualSemanticRows) === JSON.stringify(expectedSemanticRows)
    && semanticRowsAfter.length === 1);
  const windowSetUnchanged = windowSetAfter.fingerprint === windowSetBefore.fingerprint;
  const dialogFreeAfter = Boolean(restored && restored.windowEnabled && !restored.modalBlocked);
  const dirtyStateUnchanged = dirtyAfter.dirty === dirtyBefore.dirty;
  const verified = Boolean(fields.length && detailFingerprint && editable.complete && identityMatches
    && semanticListUnchanged && windowSetUnchanged && dialogFreeAfter && dirtyStateUnchanged && closeBinding);
  const common = {
    backend: "qt",
    pid: client.binding.pid,
    hwnd: before.hwnd,
    mainHwnd: client.binding.hwnd,
    managerHwnd: before.hwnd,
    row: semanticRowsAfter.length === 1 ? semanticRowsAfter[0] : rowBefore,
    fields,
    values: editable.values,
    valuesComplete: editable.complete,
    listFingerprint: listAfter ? listAfter.listFingerprint : null,
    detailFingerprint,
    listFingerprintBefore: expectedListFingerprint,
    semanticListUnchanged,
    targetRowRebound: exactRowsAfter.length === 1,
    rowAfter: exactRowsAfter.length === 1 ? exactRowsAfter[0] : null,
    targetSemanticRebound: semanticRowsAfter.length === 1,
    semanticRowAfter: semanticRowsAfter.length === 1 ? semanticRowsAfter[0] : null,
    detailIdentityMatchesTarget: identityMatches,
    dialogFreeAfter,
    windowSetFingerprintBefore: windowSetBefore.fingerprint,
    windowSetFingerprintAfter: windowSetAfter.fingerprint,
    windowSetUnchanged,
    ungespeichertVorher: dirtyBefore.dirty,
    ungespeichertNachher: dirtyAfter.dirty,
    dirtyStateUnchanged,
    physicalInputUsed: false,
    foregroundLeaseUsed: false,
    rowVisibilityMethod: rowVisibilityAttempts ? "qt-table-cell-activate" : "already-open-detail",
    rowVisibilityAttempts,
    verified,
    clickBinding,
    closeBinding,
    nativeDurationMs,
  };
  if (verified) return { ok: true, ...common };
  const openConditions = [
    ...(!fields.length ? ["detail-fields-missing"] : []),
    ...(!identityMatches ? ["detail-identity-mismatch"] : []),
    ...(!semanticListUnchanged ? ["semantic-list-drift"] : []),
    ...(!windowSetUnchanged ? ["window-set-drift"] : []),
    ...(!dialogFreeAfter ? ["blocking-dialog"] : []),
    ...(!dirtyStateUnchanged ? ["dirty-state-drift"] : []),
    ...(!closeBinding ? ["detail-close-missing"] : []),
  ];
  return { ok: false, kind: "postcondition-failed",
    error: `The exact native receipt detail transaction was not fully proven (${openConditions.join(", ")}); do not replay.`,
    offeneBedingungen: openConditions, ...common };
  } catch (error) {
    if (!mutationDispatched) throw error;
    const kind = error instanceof QtNativeTransportError ? error.kind : "postcondition-failed";
    return {
      ok: false,
      backend: "qt",
      kind,
      error: `The acknowledged native receipt detail action could not complete its postcondition checks: ${error instanceof Error ? error.message : String(error)} Do not replay.`,
      outcomeUnknown: true,
      mutationStarted: true,
      resultingState: "unknown",
      cleanupRequired: true,
      pid: client.binding.pid,
      hwnd: before.hwnd,
      mainHwnd: client.binding.hwnd,
      managerHwnd: before.hwnd,
      row: rowBefore,
      listFingerprintBefore: expectedListFingerprint,
      ungespeichertVorher: dirtyBefore.dirty,
      physicalInputUsed: false,
      foregroundLeaseUsed: false,
      clickBinding,
      closeBinding,
      lastActionBinding,
      nativeDurationMs,
      verified: false,
    };
  }
}
