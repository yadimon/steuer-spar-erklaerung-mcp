import { setTimeout as delay } from "node:timers/promises";
import { QtNativeAcknowledgmentError, QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";
import { readProcessWindowInventory } from "./qt-native-projections.js";
import { receiptLinkDialogFingerprint } from "./qt-native-receipt-link-dialog.js";
import { ClassificationError, sameClassificationGrid, validateClassificationGrid,
  type ClassificationGrid, type ClassificationKind, type ClassificationPolicy } from "./qt-native-classification-projection.js";
import { detailBindingFingerprint, detailIdentityMatches, exactDetailClose, receiptDetailSnapshot,
  receiptDirtyState, receiptEditableValues, receiptList, receiptState, receiptWindowSet, sameSemanticRow,
  type ReceiptListProjection, type ReceiptRow } from "./qt-native-receipts.js";
import type { WorkerResult } from "./api-contract.js";

type Detail = Awaited<ReturnType<typeof receiptDetailSnapshot>>;
export interface ClassificationArguments {
  rowRid: string; rowFingerprint: string; expectedListFingerprint: string; expectedDetailFingerprint: string;
  waitMs?: number | undefined; hwnd?: number | undefined;
}
interface OwnedModal {
  kind: ClassificationKind; hwnd: number; fingerprint: string; verified: boolean;
  closeStarted: boolean; saveOn: boolean; staged: boolean; expected: ClassificationGrid | null;
}

/** Shared exact receipt/dialog lease. No action is retried after an unknown acknowledgment. */
export class ReceiptClassificationSession {
  readonly started = performance.now();
  nativeDurationMs = 0;
  mutationStarted = false;
  outcomeUnknown = false;
  managerHwnd: number | null = null;
  row!: ReceiptRow;
  listBefore!: ReceiptListProjection;
  selectionBinding: Record<string, unknown> = { method: "already-open-detail", clickCount: 0 };
  chooserBinding: Record<string, unknown> | null = null;
  detailCloseBinding: Record<string, unknown> | null = null;
  lastActionBinding: Record<string, unknown> | null = null;
  private modal: OwnedModal | null = null;
  private windowsBefore!: Awaited<ReturnType<typeof receiptWindowSet>>;
  private dirtyBefore!: Awaited<ReturnType<typeof receiptDirtyState>>;
  readonly waitMs: number;
  constructor(readonly client: QtNativeClient, readonly args: ClassificationArguments, readonly policy: ClassificationPolicy,
    readonly timeoutMs: number, readonly signal?: AbortSignal) { this.waitMs = args.waitMs ?? 3000; }
  get hasModal() { return this.modal !== null; }
  get closingModal() { return this.modal?.closeStarted === true; }
  get dialogFingerprint() { return this.modal?.fingerprint ?? null; }
  budget() {
    const value = Math.floor(this.timeoutMs - (performance.now() - this.started));
    if (value < 1) throw new QtNativeTransportError("Classification deadline expired.", "native-timeout", this.mutationStarted);
    return value;
  }
  markError(error: unknown) {
    this.outcomeUnknown ||= error instanceof QtNativeTransportError && error.outcomeUnknown
      || error instanceof ClassificationError && error.outcomeUnknown || this.mutationStarted && this.signal?.aborted === true;
  }
  private error(message: string, kind = "postcondition-failed", unknown = false): never {
    this.outcomeUnknown ||= unknown; throw new ClassificationError(message, kind, unknown);
  }
  async action(hwnd: number, title: string, node: Pick<QtSnapshotNode, "rid" | "aid" | "name">,
    method: "press" | "activate-table-cell" | "set-table-check-state", extra: Record<string, unknown> = {}) {
    this.lastActionBinding = { method: `qt-${method}`, rid: node.rid, aid: node.aid, name: node.name, hwnd };
    let reply: Awaited<ReturnType<QtNativeClient["requestAcknowledged"]>>;
    try {
      reply = await this.client.requestAcknowledged("accessibility_action", { toolTitle: title, expectedRootHwnd: hwnd,
        action: method, rid: node.rid, aid: node.aid, expectedName: node.name, ...extra }, this.budget(), this.signal);
    } catch (error) {
      if (error instanceof QtNativeAcknowledgmentError && error.mutationResult.mutationAttempted === true
        || error instanceof QtNativeTransportError && error.outcomeUnknown) {
        this.mutationStarted = true; this.outcomeUnknown = true;
      }
      throw error;
    }
    this.mutationStarted ||= reply.result.mutationAttempted === true;
    this.nativeDurationMs += reply.durationMs;
    this.lastActionBinding = { ...this.lastActionBinding, receiptAcknowledged: reply.receiptAcknowledged,
      mutationAckMs: reply.mutationAckMs, mutationAttempted: reply.result.mutationAttempted };
    if (reply.result.ok !== true) this.error(String(reply.result.error ?? "The exact Qt action was rejected."),
      String(reply.result.code ?? "native-action"), reply.result.outcomeUnknown === true || reply.result.mutationAttempted === true);
    if (extra.notifyClicked === true && reply.result.notificationDispatched !== true)
      this.error("The required typed checkbox business notification was not confirmed; update the native package.", "native-contract", true);
    return this.lastActionBinding;
  }
  async detailRead() {
    const detail = await receiptDetailSnapshot(this.client, this.policy, this.budget(), this.signal);
    this.nativeDurationMs += detail.nativeDurationMs;
    if (this.managerHwnd !== null && detail.hwnd !== this.managerHwnd) this.error("The exact receipt manager was replaced.", "stale-window");
    this.managerHwnd = detail.hwnd;
    if (!detail.windowEnabled || detail.modalBlocked || detail.stats.truncated)
      this.error("The receipt manager is obstructed or incomplete.", "window-obstructed");
    return detail;
  }
  private boundDetail(detail: Detail) {
    const editable = receiptEditableValues(detail.nodes, this.policy);
    return editable.complete && detailIdentityMatches(editable.values, this.row, this.policy)
      && detailBindingFingerprint(editable.values) === this.args.expectedDetailFingerprint.toUpperCase();
  }
  private listIdentity(list: ReceiptListProjection) {
    if (!list.rowsComplete || list.count !== this.listBefore.count) return false;
    const target = list.rows.filter(row => row.primaryText === this.row.primaryText && row.documentNumber === this.row.documentNumber);
    if (target.length !== 1) return false;
    const remaining = list.rows.filter(row => row !== target[0]);
    for (const before of this.listBefore.rows.filter(row => row !== this.row)) {
      const index = remaining.findIndex(row => sameSemanticRow(row, before));
      if (index < 0) return false; remaining.splice(index, 1);
    }
    return remaining.length === 0;
  }
  async guardedDetail() {
    const detail = await this.detailRead(), list = receiptList(detail.nodes, this.policy);
    if (!this.boundDetail(detail) || "error" in list || !this.listIdentity(list))
      this.error("The seven detail fields, target identity or other complete receipt rows changed.", "stale", this.mutationStarted);
    return detail;
  }
  async prepare() {
    let detail = await this.detailRead();
    const state = receiptState(detail.nodes, detail.hwnd, this.policy);
    if (state.error) this.error(String(state.error.error), String(state.error.kind));
    if (state.state !== "list") this.error("Classification requires the complete receipt list.", "precondition-failed");
    const list = receiptList(detail.nodes, this.policy);
    if ("error" in list) this.error(String(list.error.error), String(list.error.kind));
    if (!list.rowsComplete || list.listFingerprint !== this.args.expectedListFingerprint.toUpperCase())
      this.error("The complete receipt list differs from its fresh binding.", "stale");
    this.listBefore = list;
    const rows = list.rows.filter(row => row.rowRid === this.args.rowRid && row.rowFingerprint === this.args.rowFingerprint.toUpperCase());
    if (rows.length !== 1) this.error("The exact receipt row is not unique.", "stale");
    this.row = rows[0]!;
    if (!this.listIdentity(list)) this.error("The target's title/document identity is ambiguous.", "stale");
    this.windowsBefore = await receiptWindowSet(this.client, this.budget(), this.signal);
    if (this.windowsBefore.error) this.error(String(this.windowsBefore.error.error), String(this.windowsBefore.error.kind));
    this.dirtyBefore = await receiptDirtyState(this.client, this.args.hwnd, this.policy.title, this.budget(), this.signal);
    if (this.dirtyBefore.error) this.error(String(this.dirtyBefore.error.error), String(this.dirtyBefore.error.kind));
    this.nativeDurationMs += this.windowsBefore.durationMs! + this.dirtyBefore.durationMs!;
    if (!this.boundDetail(detail)) {
      const targets = detail.nodes.filter(node => node.rid === this.row.rowRid && node.type === "DataItem"
        && node.aid.endsWith(this.policy.list.tableAutomationIdSuffix) && node.on && node.w > 0 && node.h > 0);
      if (targets.length !== 1) this.error("The live bound receipt cell is not unique.", "stale");
      this.selectionBinding = await this.action(detail.hwnd, this.policy.title, targets[0]!, "activate-table-cell");
      const deadline = performance.now() + Math.min(this.waitMs, this.budget());
      do {
        detail = await this.detailRead(); if (this.boundDetail(detail)) break;
        await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal: this.signal });
      } while (performance.now() < deadline);
    }
    const selected = receiptList(detail.nodes, this.policy);
    if (!this.boundDetail(detail) || "error" in selected || selected.listFingerprint !== list.listFingerprint)
      this.error("The complete detail/list binding changed before opening the chooser.", "stale");
  }
  private async presence(kind: ClassificationKind, wanted: boolean, hwnd?: number) {
    const policy = this.policy.classificationDialogs[kind], deadline = performance.now() + Math.min(this.waitMs, this.budget());
    do {
      const inventory = await readProcessWindowInventory(this.client, this.budget(), this.signal); this.nativeDurationMs += inventory.durationMs;
      const matches = inventory.windows.filter(window => window.pid === this.client.binding.pid && window.title === policy.title);
      if (matches.length > 1) this.error("The exact classification dialog is ambiguous.", "ambiguous");
      const window = matches[0];
      if (wanted && window) {
        if (!new RegExp(policy.classPattern, "u").test(window.class) || window.minimized || window.hung)
          this.error("The classification window differs from the catalogue.", "stale-window");
        return window;
      }
      if (!wanted && !window && !inventory.windows.some(window => window.hwnd === hwnd)) return null;
      await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal: this.signal });
    } while (performance.now() < deadline);
    this.error("The classification window did not reach its required presence state.", "postcondition-failed", this.modal?.closeStarted === true);
  }
  private async modalRead() {
    const modal = this.modal; if (!modal) this.error("No owned classification dialog is open.", "stale");
    const policy = this.policy.classificationDialogs[modal.kind];
    const snapshot = await readQtNativeSnapshot(this.client, { toolTitle: policy.title, maxNodes: 5000 }, this.budget(), this.signal);
    this.nativeDurationMs += snapshot.nativeDurationMs;
    if (snapshot.hwnd !== modal.hwnd || snapshot.root?.aid !== policy.rootAutomationId || !snapshot.windowEnabled
      || snapshot.modalBlocked || snapshot.stats.truncated)
      this.error("The complete exact classification dialog is not readable.", "window-obstructed", modal.staged);
    const nodes = modal.verified && modal.staged
      ? snapshot.nodes.map(node => node.type === "Button" && node.aid === policy.saveAutomationId ? { ...node, on: modal.saveOn } : node)
      : snapshot.nodes;
    const fingerprint = receiptLinkDialogFingerprint(policy.title, nodes);
    if (fingerprint !== policy.fingerprint.toUpperCase())
      this.error("The classification decision fingerprint is unknown.", "fingerprint-mismatch", modal.staged);
    return { snapshot, fingerprint };
  }
  async open(kind: ClassificationKind) {
    if (this.modal || this.outcomeUnknown) this.error("An active or unknown classification action prevents another dialog.", "outcome-unknown", true);
    const detail = await this.guardedDetail(), chooser = this.policy.controls.classification[kind];
    const buttons = detail.nodes.filter(node => node.type === "Button" && node.aid.endsWith(chooser.chooserAutomationIdSuffix)
      && node.name === chooser.chooserExpectedName && node.on && node.w > 0 && node.h > 0);
    if (buttons.length !== 1) this.error("The exact classification chooser is not unique.", "stale");
    this.chooserBinding = await this.action(detail.hwnd, this.policy.title, buttons[0]!, "press");
    let window: Awaited<ReturnType<ReceiptClassificationSession["presence"]>>;
    try { window = await this.presence(kind, true); }
    catch (error) {
      // The chooser was acknowledged; a missing or unreadable window cannot
      // prove that its queued action has finished. Never dispatch another one.
      this.outcomeUnknown = true;
      throw error;
    }
    if (!window) this.error("The acknowledged chooser has no proved dialog.", "outcome-unknown", true);
    this.modal = { kind, hwnd: window.hwnd, fingerprint: "", verified: false, closeStarted: false, saveOn: false, staged: false, expected: null };
    const read = await this.modalRead(), policy = this.policy.classificationDialogs[kind];
    const saves = read.snapshot.nodes.filter(node => node.type === "Button" && node.aid === policy.saveAutomationId && node.name === "Speichern");
    if (saves.length !== 1) this.error("The exact classification save control is not unique.", "stale");
    this.modal.fingerprint = read.fingerprint; this.modal.saveOn = saves[0]!.on; this.modal.verified = true;
    return this.readGrid();
  }
  async readGrid() {
    const modal = this.modal; if (!modal?.verified) this.error("The exact modal decision is not verified.", "stale");
    const policy = this.policy.classificationDialogs[modal.kind];
    const reply = await this.client.request("accessibility_table_options", { toolTitle: policy.title, expectedRootHwnd: modal.hwnd,
      tableAid: policy.tableAutomationId, toggleColumn: policy.toggleColumn, labelColumn: policy.labelColumn }, this.budget(), this.signal);
    this.nativeDurationMs += reply.durationMs;
    const grid = validateClassificationGrid(reply.result, modal.hwnd, policy);
    modal.expected ??= grid; return grid;
  }
  async toggle(name: string, wanted: boolean) {
    const modal = this.modal; if (!modal?.verified || !modal.expected) this.error("The exact option grid is not bound.", "stale");
    const current = await this.readGrid();
    if (!sameClassificationGrid(current, modal.expected)) this.error("Option names or states changed outside this transaction.", "stale", true);
    const option = current.options.find(value => value.name === name);
    if (!option || !option.enabled || !option.visible) this.error("The exact option is not enabled and visible.", "stale");
    if (option.selected === wanted) return;
    const previous = modal.expected;
    modal.expected = { ...current, options: current.options.map(value => value.name === name ? { ...value, selected: wanted } : value) };
    const policy = this.policy.classificationDialogs[modal.kind];
    try {
      await this.action(modal.hwnd, policy.title, { rid: option.toggleRid, aid: option.toggleAid, name: option.toggleName },
        "set-table-check-state", { expectedChecked: option.selected, checked: wanted, expectedRowTitle: name, titleColumn: policy.labelColumn,
          notifyClicked: true, expectedRootAid: policy.rootAutomationId, expectedTableAid: policy.tableAutomationId });
    } catch (error) {
      if (this.lastActionBinding?.mutationAttempted === false && !this.outcomeUnknown) modal.expected = previous;
      throw error;
    }
    modal.staged = true;
    const after = await this.readGrid();
    if (!sameClassificationGrid(after, modal.expected)) this.error("The exact checkbox commit changed an unexpected option state.", "stale", true);
  }
  async closeModal(save: boolean) {
    const modal = this.modal;
    if (!modal?.verified || modal.closeStarted || this.outcomeUnknown)
      this.error("No verified unreplayed classification close action is available.", "outcome-unknown", true);
    const policy = this.policy.classificationDialogs[modal.kind];
    const name = save ? "Speichern" : "Abbrechen", aid = save ? policy.saveAutomationId : policy.cancelAutomationId;
    const deadline = performance.now() + Math.min(this.waitMs, this.budget());
    let snapshot: Awaited<ReturnType<typeof readQtNativeSnapshot>>, button: QtSnapshotNode;
    while (true) {
      snapshot = (await this.modalRead()).snapshot;
      if (modal.staged && (!modal.expected || !sameClassificationGrid(await this.readGrid(), modal.expected)))
        this.error("Staged option states changed before dialog completion.", "stale", true);
      const buttons = snapshot.nodes.filter(node => node.type === "Button" && node.aid === aid && node.name === name && node.w > 0 && node.h > 0);
      if (buttons.length !== 1) this.error("The exact dialog completion button is not unique.", "stale");
      if (buttons[0]!.on) { button = buttons[0]!; break; }
      if (!save || performance.now() >= deadline) this.error("The exact dialog completion button did not become enabled.", "button-not-ready");
      await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal: this.signal });
    }
    modal.closeStarted = true; await this.action(snapshot.hwnd, policy.title, button, "press");
    await this.presence(modal.kind, false, modal.hwnd); this.modal = null;
  }
  async finish(requireExactList: boolean, requireUnchangedTarget = false) {
    let detail = await this.guardedDetail();
    const closers = exactDetailClose(detail.nodes, this.policy);
    if (closers.length !== 1) this.error("The exact detail close action is not unique.", "stale");
    this.detailCloseBinding = await this.action(detail.hwnd, this.policy.title, closers[0]!, "press");
    const deadline = performance.now() + Math.min(this.waitMs, this.budget());
    do {
      detail = await this.detailRead(); if (exactDetailClose(detail.nodes, this.policy).length === 0) break;
      await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal: this.signal });
    } while (performance.now() < deadline);
    const list = receiptList(detail.nodes, this.policy);
    const windows = await receiptWindowSet(this.client, this.budget(), this.signal);
    if (windows.error) this.error(String(windows.error.error));
    const dirty = await receiptDirtyState(this.client, this.args.hwnd, this.policy.title, this.budget(), this.signal);
    if (dirty.error) this.error(String(dirty.error.error));
    this.nativeDurationMs += windows.durationMs! + dirty.durationMs!;
    if ("error" in list || !this.listIdentity(list) || requireExactList && list.listFingerprint !== this.listBefore.listFingerprint
      || requireUnchangedTarget && !list.rows.some(row => sameSemanticRow(row, this.row))
      || exactDetailClose(detail.nodes, this.policy).length || windows.fingerprint !== this.windowsBefore.fingerprint
      || dirty.dirty !== this.dirtyBefore.dirty)
      this.error("The complete receipt list, other rows, window set and dirty state were not restored.");
    return { list, ungespeichertVorher: this.dirtyBefore.dirty, ungespeichertNachher: dirty.dirty,
      dirtyStateUnchanged: true, countUnchanged: true, otherRowsUnchanged: true, windowSetUnchanged: true, detailClosed: true };
  }
  failure(error: unknown, cleanupError: string | null = null): WorkerResult {
    this.markError(error);
    return { ok: false, kind: error instanceof ClassificationError || error instanceof QtNativeTransportError
      ? error.kind : "native-contract", error: error instanceof Error ? error.message : String(error),
      outcomeUnknown: this.outcomeUnknown, mutationStarted: this.mutationStarted, cleanupRequired: this.mutationStarted, cleanupError,
      verified: false, ...this.bindings() };
  }
  bindings() {
    return { backend: "qt", pid: this.client.binding.pid, hwnd: this.managerHwnd, mainHwnd: this.client.binding.hwnd,
      managerHwnd: this.managerHwnd, selectionBinding: this.selectionBinding, chooserBinding: this.chooserBinding,
      detailCloseBinding: this.detailCloseBinding, lastActionBinding: this.lastActionBinding,
      physicalInputUsed: false, foregroundLeaseUsed: false, nativeDurationMs: this.nativeDurationMs };
  }
}
