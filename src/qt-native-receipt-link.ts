import { setTimeout as delay } from "node:timers/promises";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { SSE_API_RECEIPT_MANAGER_LINK_SCHEMA } from "./mcp-schemas-receipts.js";
import { QtNativeAcknowledgmentError, QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { qtNativeHeading } from "./qt-native-pages.js";
import { isSystemOverlay, readProcessWindowInventory } from "./qt-native-projections.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";
import { fail, receiptFingerprint, receiptState } from "./qt-native-receipts.js";
import { cancelKnownReceiptLinkTransfer } from "./qt-native-receipt-link-dialog.js";
import {
  checkedLinkRow, exactLinkControl, linkListIdentity, linkRowIdentity, linkStatesEqual, projectLinkMode,
  receiptLinkPolicySchema, ReceiptLinkError, resolveLinkRow, type LinkItem, type LinkMode, type LinkSnapshot,
} from "./qt-native-receipt-link-projection.js";

/** One exact Qt staging/apply/reopen cycle; a receipt acknowledgment never substitutes for persistence. */
export async function executeQtNativeReceiptManagerLink(
  client: QtNativeClient, input: Readonly<Record<string, unknown>>, timeoutMs: number,
  signal?: AbortSignal, profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsed = SSE_API_RECEIPT_MANAGER_LINK_SCHEMA.safeParse(input);
  if (!parsed.success) return fail("bad-args", parsed.error.message);
  const parsedPolicy = receiptLinkPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!profile || !parsedPolicy.success) return fail("invalid-catalog", "The active profile has no complete receipt-link policy.");
  const args = parsed.data, policy = parsedPolicy.data, activeProfile = profile;
  const link = policy.controls.linkManagement;
  const items: LinkItem[] = "items" in args ? args.items : [{
    expectedReceiptTitle: args.expectedReceiptTitle, expectedDocumentNumber: args.expectedDocumentNumber,
    receiptContentFingerprint: args.receiptContentFingerprint, linked: args.linked,
  }];
  const started = performance.now(), waitMs = args.waitMs ?? 4000;
  let nativeDurationMs = 0, mutationStarted = false, persistentApplyStarted = false, applied = false, outcomeUnknown = false;
  let managerCloseAcknowledged = false;
  let managerHwnd: number | null = null, lastMode: LinkMode | null = null, modeBefore: LinkMode | null = null;
  let dirtyBefore: boolean | null = null, dirtyAfter: boolean | null = null, windowIdentityBefore: string | null = null;
  let openClick: Record<string, unknown> | null = null, showClick: Record<string, unknown> | null = null;
  let applyClick: Record<string, unknown> | null = null, cancelClick: Record<string, unknown> | null = null;
  const toggleClicks: Record<string, unknown>[] = [];
  const budget = () => {
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Receipt-link deadline expired.", "native-timeout", mutationStarted);
    return remaining;
  };
  const measured = (durationMs: number) => { nativeDurationMs += durationMs; };
  const inventory = async () => {
    const value = await readProcessWindowInventory(client, budget(), signal); measured(value.durationMs); return value;
  };
  const windowIdentity = (value: Awaited<ReturnType<typeof inventory>>) => receiptFingerprint({
    // Applying links can change the main window's dirty title. Its immutable
    // native binding remains required; every other window's title stays bound.
    windows: value.windows.filter(window => !isSystemOverlay(window)).map(window => ({
      hwnd: window.hwnd, pid: window.pid, class: window.class, minimized: window.minimized, hung: window.hung,
      title: window.hwnd === client.binding.hwnd ? null : window.title,
    })).sort((left, right) => left.hwnd - right.hwnd),
    untitled: value.untitledWindows.filter(window => !isSystemOverlay(window)).map(window => ({
      hwnd: window.hwnd, pid: window.pid, class: window.class, minimized: window.minimized, hung: window.hung,
    })).sort((left, right) => left.hwnd - right.hwnd),
  });
  const mainRead = async () => {
    const snapshot = await readQtNativeSnapshot(client, { hwnd: args.hwnd, maxNodes: 5000,
      ...(managerHwnd === null ? {} : { allowedModalTitle: policy.title, allowedModalHwnd: managerHwnd }),
    }, budget(), signal);
    measured(snapshot.nativeDurationMs);
    if (!snapshot.windowEnabled || snapshot.modalBlocked || snapshot.stats.truncated)
      throw new ReceiptLinkError("The bound target page is obstructed or incomplete.", "window-obstructed", managerHwnd !== null);
    if (managerHwnd !== null && snapshot.activeModalHwnd !== 0 && snapshot.activeModalHwnd !== managerHwnd)
      throw new ReceiptLinkError("The target page's active modal window differs from the owned manager.", "stale-window", true);
    if (qtNativeHeading(snapshot.nodes, activeProfile) !== args.expectedTargetPage)
      throw new ReceiptLinkError("The bound target page changed; no further link action dispatched.", "stale", managerHwnd !== null);
    const save = snapshot.nodes.filter(node => node.type === "Button" && node.aid.endsWith(".MainToolBar.tb_sichern"));
    if (save.length !== 1) throw new ReceiptLinkError("The target page has no unique readable dirty state.", "precondition-failed");
    return { snapshot, dirty: save[0]!.on };
  };
  const toolRead = async () => {
    if (managerHwnd === null) throw new ReceiptLinkError("No exact receipt manager is owned by this transaction.", "stale-window");
    const snapshot = await readQtNativeSnapshot(client, { toolTitle: policy.title, maxNodes: 5000, withCellStates: true }, budget(), signal);
    measured(snapshot.nativeDurationMs);
    if (snapshot.hwnd !== managerHwnd)
      throw new ReceiptLinkError("The exact receipt link manager was recreated; no further action dispatched.", "stale-window", true);
    if (!snapshot.windowEnabled || snapshot.modalBlocked || snapshot.stats.truncated)
      throw new ReceiptLinkError("The exact receipt link manager is obstructed or incomplete.", "window-obstructed");
    return snapshot;
  };
  const dispatch = async (snapshot: LinkSnapshot, node: QtSnapshotNode, action: string,
    toolTitle?: string, extra: Record<string, unknown> = {}, persistent = false) => {
    let reply: Awaited<ReturnType<QtNativeClient["requestAcknowledged"]>>;
    try {
      reply = await client.requestAcknowledged("accessibility_action", {
        expectedRootHwnd: snapshot.hwnd, rid: node.rid, aid: node.aid, expectedName: node.name, action,
        ...(toolTitle === undefined ? {} : { toolTitle }), ...extra,
      }, budget(), signal);
    } catch (error) {
      if (error instanceof QtNativeAcknowledgmentError && error.mutationResult.mutationAttempted === true
        || error instanceof QtNativeTransportError && error.outcomeUnknown) {
        mutationStarted = true; persistentApplyStarted ||= persistent; outcomeUnknown = true;
      }
      throw error;
    }
    measured(reply.durationMs);
    mutationStarted ||= reply.result.mutationAttempted === true;
    persistentApplyStarted ||= persistent && reply.result.mutationAttempted === true;
    if (reply.result.ok !== true) throw new ReceiptLinkError(String(reply.result.error ?? "The exact Qt receipt-link action failed."),
      String(reply.result.code ?? "native-action"), reply.result.outcomeUnknown === true || reply.result.mutationAttempted === true);
    return { method: `qt-${action}`, hwnd: snapshot.hwnd, rid: node.rid, aid: node.aid, name: node.name,
      receiptAcknowledged: reply.receiptAcknowledged, mutationAckMs: reply.mutationAckMs };
  };
  const press = (snapshot: LinkSnapshot, node: QtSnapshotNode, toolTitle?: string, persistent = false) => {
    if (node.type !== "Button") throw new ReceiptLinkError("The exact link action is not a button.", "profile-contract");
    return dispatch(snapshot, node, "press", toolTitle, {}, persistent);
  };
  const poll = async <T>(read: () => Promise<T | null>, message: string): Promise<T> => {
    const deadline = performance.now() + Math.min(waitMs, budget());
    do {
      const value = await read();
      if (value !== null) return value;
      if (performance.now() >= deadline) break;
      await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal });
    } while (performance.now() < deadline);
    throw new ReceiptLinkError(message);
  };
  const readMode = async () => {
    const mode = projectLinkMode(await toolRead(), policy, args.expectedLinkTarget);
    if (mode) lastMode = mode;
    return mode;
  };
  const openMode = async () => {
    const beforeOpen = await inventory();
    if (beforeOpen.windows.some(window => window.pid === client.binding.pid && window.title === policy.title))
      throw new ReceiptLinkError("A receipt manager is already open; no additional manager dispatched.", "precondition-failed");
    const main = await mainRead();
    const open = exactLinkControl(main.snapshot.nodes, link.mainToolbarAutomationIdSuffix);
    const opened = await press(main.snapshot, open); openClick ??= opened;
    const window = await poll(async () => {
      const candidates = (await inventory()).windows.filter(candidate => candidate.pid === client.binding.pid && candidate.title === policy.title);
      if (candidates.length > 1) throw new ReceiptLinkError("The newly opened receipt link manager is ambiguous.", "ambiguous", true);
      return candidates[0] ?? null;
    }, "The receipt link manager did not open within its bound.");
    if (!new RegExp(policy.classPattern, "u").test(window.class) || window.minimized || window.hung)
      throw new ReceiptLinkError("The receipt link manager differs from its catalogue.", "stale-window", true);
    managerHwnd = window.hwnd;
    const start = await poll(async () => {
      const snapshot = await toolRead();
      const state = receiptState(snapshot.nodes, snapshot.hwnd, policy);
      return !state.error && state.state === "start" ? snapshot : null;
    }, "The receipt link manager did not reach its catalogue start state.");
    const target = exactLinkControl(start.nodes, link.startTargetAutomationIdSuffix);
    if (target.name !== `Belege mit "${args.expectedLinkTarget}" verknüpfen`)
      throw new ReceiptLinkError("The exact receipt link start target differs from the acknowledged target.", "stale");
    const show = policy.actions.showAllReceipts!;
    const shown = await press(start, exactLinkControl(start.nodes, show.automationIdSuffix, show.expectedName), policy.title); showClick ??= shown;
    return poll(readMode, "The receipt link manager did not expose a complete, counted link list.");
  };
  const closeMode = async (kind: "apply" | "cancel") => {
    const snapshot = await toolRead(), boundHwnd = snapshot.hwnd;
    const button = exactLinkControl(snapshot.nodes, kind === "apply" ? link.applyAutomationIdSuffix : link.cancelAutomationIdSuffix,
      kind === "apply" ? link.applyExpectedName : link.cancelExpectedName);
    const binding = await press(snapshot, button, policy.title, kind === "apply");
    managerCloseAcknowledged = true;
    if (kind === "cancel") cancelClick = binding;
    if (kind === "apply") applied = true;
    await poll(async () => {
      const windows = (await inventory()).windows;
      return !windows.some(window => window.hwnd === boundHwnd)
        && !windows.some(window => window.pid === client.binding.pid && window.title === policy.title) ? true : null;
    }, "The exact receipt link manager did not close after its acknowledged button; do not replay.");
    managerHwnd = null; lastMode = null; managerCloseAcknowledged = false;
    if (kind === "apply") {
      const transfer = await cancelKnownReceiptLinkTransfer(client, policy, waitMs, budget,
        (dialog, cancel, title) => press(dialog, cancel, title), measured, signal);
      return { applyClick: binding, ...transfer };
    }
    return binding;
  };
  const common = () => ({ backend: "qt", pid: client.binding.pid, hwnd: client.binding.hwnd, mainHwnd: client.binding.hwnd,
    managerHwnd: modeBefore?.snapshot.hwnd ?? managerHwnd, expectedTargetPage: args.expectedTargetPage, expectedLinkTarget: args.expectedLinkTarget,
    mutationStarted, persistentApplyStarted, applied, physicalInputUsed: false, foregroundLeaseUsed: false,
    ungespeichertVorher: dirtyBefore, ungespeichertNachher: dirtyAfter,
    openClick, showClick, toggleClicks, applyClick, cancelClick, nativeDurationMs });

  try {
    const initialMain = await mainRead(); dirtyBefore = initialMain.dirty;
    const initialWindows = await inventory(); windowIdentityBefore = windowIdentity(initialWindows);
    if (initialWindows.windows.some(window => window.pid === client.binding.pid && window.title === policy.title))
      return { ok: false, ...common(), kind: "precondition-failed", error: "Receipt manager is already open; no action dispatched.", cleanupRequired: false, verified: false };
    modeBefore = await openMode();
    const initialRows = items.map(item => resolveLinkRow(modeBefore!, item));
    if (new Set(initialRows.map(row => row.rowRid)).size !== initialRows.length)
      throw new ReceiptLinkError("Multiple receipt selectors resolve to the same row; no checkbox edit dispatched.", "ambiguous");
    const linkedBefore = initialRows.map(row => checkedLinkRow(row, policy));
    const changes = items.map((item, index) => linkedBefore[index] === item.linked ? -1 : index).filter(index => index >= 0);
    const identityBefore = linkListIdentity(modeBefore.list, policy);
    const expectedStates = new Map([...modeBefore.states].map(([identity, states]) => [identity, [...states]]));
    let expectedCount = modeBefore.footerCount, finalMode = modeBefore;
    if (changes.length === 0) {
      cancelClick = await closeMode("cancel");
      const main = await mainRead(); dirtyAfter = main.dirty;
      const windowsAfter = await inventory();
      const verified = dirtyAfter === dirtyBefore && windowIdentity(windowsAfter) === windowIdentityBefore;
      return { ok: verified, ...common(), ...(verified ? {} : { kind: "postcondition-failed", error: "Receipt-link no-op cleanup or dirty state changed; do not replay." }),
        receipt: initialRows[0], items: initialRows.map((receipt, index) => ({ receipt, expectedReceiptTitle: items[index]!.expectedReceiptTitle,
          linkedBefore: linkedBefore[index], linkedAfter: linkedBefore[index], changed: false, verified })),
        linkedBefore: linkedBefore[0], linkedAfter: linkedBefore[0], footerCountBefore: modeBefore.footerCount, footerCountAfter: modeBefore.footerCount,
        noChanges: true, changedCount: 0, persistenceVerified: verified, dirtyStateUnchangedBeforeApply: verified,
        windowIdentitiesUnchanged: verified, cleanupRequired: !verified, verified };
    }
    for (const index of changes) {
      const fresh = await readMode();
      if (!fresh || linkListIdentity(fresh.list, policy) !== identityBefore || !linkStatesEqual(fresh, expectedStates))
        throw new ReceiptLinkError("Receipt content or link states changed outside this transaction; no further edit dispatched.", "stale", true);
      const item = items[index]!, row = resolveLinkRow(fresh, item), cell = row.cells[link.rowToggleColumn]!;
      const targets = fresh.snapshot.nodes.filter(node => node.rid === cell.rid && node.type === "DataItem"
        && node.aid.endsWith(policy.list.tableAutomationIdSuffix) && node.on && node.w > 0 && node.h > 0);
      if (targets.length !== 1) throw new ReceiptLinkError("The exact receipt link cell is not unique and visible.", "stale");
      const previousStates = new Map([...expectedStates].map(([identity, states]) => [identity, [...states]]));
      const previousCount = expectedCount;
      toggleClicks.push(await dispatch(fresh.snapshot, targets[0]!, "set-table-check-state", policy.title, {
        expectedChecked: checkedLinkRow(row, policy), checked: item.linked,
        titleColumn: policy.list.primaryTextColumn, expectedRowTitle: item.expectedReceiptTitle,
      }));
      expectedStates.set(linkRowIdentity(row, policy), [item.linked]);
      expectedCount += item.linked ? 1 : -1;
      finalMode = await poll(async () => {
        const candidate = await readMode();
        if (!candidate) return null;
        if (linkListIdentity(candidate.list, policy) !== identityBefore)
          throw new ReceiptLinkError("Receipt content changed during the exact link checkbox commit.", "stale", true);
        if (candidate.footerCount === expectedCount && linkStatesEqual(candidate, expectedStates)) return candidate;
        if (candidate.footerCount === previousCount && linkStatesEqual(candidate, previousStates)) return null;
        throw new ReceiptLinkError("Other receipt link states changed during the exact checkbox commit; no further action dispatched.", "stale", true);
      }, "The exact receipt checkbox and footer did not reach the requested staged state; do not replay.");
    }
    const mainBeforeApply = await mainRead();
    if (mainBeforeApply.dirty !== dirtyBefore)
      throw new ReceiptLinkError("Main dirty state changed before applying the staged receipt links.", "stale", true);
    const beforeApply = await readMode();
    if (!beforeApply || linkListIdentity(beforeApply.list, policy) !== identityBefore
      || !linkStatesEqual(beforeApply, expectedStates) || beforeApply.footerCount !== expectedCount)
      throw new ReceiptLinkError("The final staged receipt link projection changed before applying.", "stale", true);
    applyClick = await closeMode("apply");
    await mainRead();
    finalMode = await openMode();
    const finalRows = items.map(item => resolveLinkRow(finalMode, item));
    const persistenceVerified = linkListIdentity(finalMode.list, policy) === identityBefore
      && linkStatesEqual(finalMode, expectedStates) && finalMode.footerCount === expectedCount;
    cancelClick = await closeMode("cancel");
    const finalMain = await mainRead(); dirtyAfter = finalMain.dirty;
    const windowIdentityAfter = windowIdentity(await inventory());
    const windowIdentitiesUnchanged = windowIdentityAfter === windowIdentityBefore;
    const verified = persistenceVerified && windowIdentitiesUnchanged;
    return { ok: verified, ...common(), ...(verified ? {} : { kind: "postcondition-failed", error: "Applied receipt links failed persistence or window cleanup proofs; do not replay." }),
      receipt: finalRows[0], items: finalRows.map((receipt, index) => ({ receipt, expectedReceiptTitle: items[index]!.expectedReceiptTitle,
        linkedBefore: linkedBefore[index], linkedAfter: checkedLinkRow(receipt, policy), changed: changes.includes(index),
        verified: persistenceVerified && checkedLinkRow(receipt, policy) === items[index]!.linked })),
      linkedBefore: linkedBefore[0], linkedAfter: checkedLinkRow(finalRows[0]!, policy),
      footerCountBefore: modeBefore.footerCount, footerCountAfter: expectedCount, noChanges: false, changedCount: changes.length,
      persistenceVerified, dirtyStateUnchangedBeforeApply: true, windowIdentitiesUnchanged,
      windowIdentityFingerprintBefore: windowIdentityBefore, windowIdentityFingerprintAfter: windowIdentityAfter,
      cleanupRequired: !verified, verified };
  } catch (error) {
    outcomeUnknown ||= managerCloseAcknowledged || signal?.aborted === true || error instanceof QtNativeTransportError
      || error instanceof ReceiptLinkError && error.outcomeUnknown;
    let cleanupVerified = false;
    // Cancel only an acknowledged, still-owned staging view. Never replay an
    // unknown action, apply a partial batch or write a compensating link change.
    if (!outcomeUnknown && !persistentApplyStarted && lastMode && managerHwnd !== null) {
      try {
        cancelClick = await closeMode("cancel");
        const main = await mainRead(); dirtyAfter = main.dirty;
        cleanupVerified = dirtyAfter === dirtyBefore && windowIdentity(await inventory()) === windowIdentityBefore;
      } catch { outcomeUnknown ||= managerCloseAcknowledged; cleanupVerified = false; }
    }
    return { ok: false, ...common(), kind: error instanceof QtNativeTransportError || error instanceof ReceiptLinkError ? error.kind : "native-contract",
      error: `${error instanceof Error ? error.message : String(error)} Do not replay.`, outcomeUnknown: outcomeUnknown && mutationStarted,
      resultingState: cleanupVerified ? "cancelled" : mutationStarted ? "unknown" : "unchanged",
      persistenceVerified: false, cleanupRequired: mutationStarted && !cleanupVerified, verified: false };
  }
}
