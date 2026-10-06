import { z } from "zod";
import type { QtSnapshotNode } from "./qt-native-snapshot.js";
import { readQtNativeSnapshot } from "./qt-native-snapshot.js";
import { receiptFingerprint, receiptList, receiptPolicySchema, receiptState, type ReceiptListProjection, type ReceiptRow } from "./qt-native-receipts.js";

export const receiptLinkPolicySchema = receiptPolicySchema.extend({
  classPattern: z.string().min(1).max(256),
  controls: receiptPolicySchema.shape.controls.extend({
    linkManagement: z.object({
      mainToolbarAutomationIdSuffix: z.string().min(1), startTargetAutomationIdSuffix: z.string().min(1),
      rowToggleColumn: z.number().int().nonnegative().max(32),
      footerCountAutomationIdSuffix: z.string().min(1), footerTextAutomationIdSuffix: z.string().min(1),
      cancelAutomationIdSuffix: z.string().min(1), cancelExpectedName: z.string().min(1),
      applyAutomationIdSuffix: z.string().min(1), applyExpectedName: z.string().min(1),
    }).passthrough(),
  }),
  linkValueTransferDialog: z.object({
    title: z.string().min(1), classPattern: z.string().min(1).max(256), cancelButton: z.literal("Abbrechen"),
    fingerprints: z.array(z.string().regex(/^[A-Fa-f0-9]{64}$/u)).min(1),
  }).passthrough(),
});
export type ReceiptLinkPolicy = z.infer<typeof receiptLinkPolicySchema>;
export type LinkSnapshot = Awaited<ReturnType<typeof readQtNativeSnapshot>>;
export type LinkItem = { expectedReceiptTitle: string; expectedDocumentNumber?: string | undefined; receiptContentFingerprint?: string | undefined; linked: boolean };
export type LinkMode = { snapshot: LinkSnapshot; list: ReceiptListProjection; footerCount: number; states: Map<string, boolean[]> };

export class ReceiptLinkError extends Error {
  constructor(message: string, readonly kind = "postcondition-failed", readonly outcomeUnknown = false) { super(message); }
}

export function exactLinkControl(nodes: QtSnapshotNode[], suffix: string, name?: string): QtSnapshotNode {
  const matches = nodes.filter(node => node.aid.endsWith(suffix) && node.w > 0 && node.h > 0 && node.on
    && (name === undefined || node.name === name));
  if (matches.length !== 1) throw new ReceiptLinkError("The exact catalogue-bound link control is not unique and enabled.", "stale");
  return matches[0]!;
}

export function checkedLinkRow(row: ReceiptRow, policy: ReceiptLinkPolicy): boolean {
  const cell = row.cells[policy.controls.linkManagement.rowToggleColumn];
  if (!cell || !["On", "Off"].includes(cell.toggleState ?? ""))
    throw new ReceiptLinkError("The exact receipt link cell has no readable binary state.", "profile-contract");
  return cell.toggleState === "On";
}

export function linkRowIdentity(row: ReceiptRow, policy: ReceiptLinkPolicy): string {
  // Selection and the link checkbox are the allowed changes. All receipt
  // content columns, including duplicate identity occurrences, remain bound.
  return receiptFingerprint({ title: row.primaryText, documentNumber: row.documentNumber, draft: row.draft,
    cells: row.cells.filter((_, index) => index !== policy.controls.linkManagement.rowToggleColumn).map(cell => cell.name) });
}

export function linkListIdentity(list: ReceiptListProjection, policy: ReceiptLinkPolicy): string {
  return receiptFingerprint({ count: list.count, rows: list.rows.map(row => linkRowIdentity(row, policy)).sort() });
}

export function resolveLinkRow(mode: LinkMode, item: LinkItem): ReceiptRow {
  const matches = mode.list.rows.filter(row => row.primaryText === item.expectedReceiptTitle
    && (item.expectedDocumentNumber === undefined || row.documentNumber === item.expectedDocumentNumber)
    && (item.receiptContentFingerprint === undefined || row.contentFingerprint === item.receiptContentFingerprint.toUpperCase()));
  if (matches.length !== 1) throw new ReceiptLinkError("The exact receipt title/document/content selector is missing or ambiguous.", matches.length ? "ambiguous" : "stale");
  return matches[0]!;
}

export function projectLinkMode(snapshot: LinkSnapshot, policy: ReceiptLinkPolicy, target: string): LinkMode | null {
  if (!snapshot.windowEnabled || snapshot.modalBlocked || snapshot.stats.truncated)
    throw new ReceiptLinkError("The bound receipt link window is obstructed or incomplete.", "window-obstructed");
  const state = receiptState(snapshot.nodes, snapshot.hwnd, policy);
  if (state.error || state.state !== "list") return null;
  const list = receiptList(snapshot.nodes, policy);
  if ("error" in list || !list.rowsComplete) return null;
  if (list.draftCount !== 0) throw new ReceiptLinkError("Receipt linking requires a complete list without drafts.", "precondition-failed");
  const link = policy.controls.linkManagement;
  const countNode = exactLinkControl(snapshot.nodes, link.footerCountAutomationIdSuffix);
  if (!/^\d+$/u.test(countNode.name)) throw new ReceiptLinkError("The exact receipt link footer count is unreadable.", "profile-contract");
  const footerCount = Number(countNode.name);
  if (!Number.isSafeInteger(footerCount) || footerCount < 0 || footerCount > list.count)
    throw new ReceiptLinkError("The receipt link footer count exceeds the complete list.", "profile-contract");
  const footer = exactLinkControl(snapshot.nodes, link.footerTextAutomationIdSuffix);
  const expectedFooter = `${footerCount === 1 ? "Beleg" : "Belege"} mit "${target}" verknüpft`;
  if (footer.name.normalize("NFC") !== expectedFooter.normalize("NFC"))
    throw new ReceiptLinkError("The receipt link footer differs from the acknowledged target and count.", "stale");
  const states = new Map<string, boolean[]>();
  for (const row of list.rows) {
    const identity = linkRowIdentity(row, policy);
    const values = states.get(identity) ?? [];
    values.push(checkedLinkRow(row, policy)); states.set(identity, values);
  }
  // Qt can publish a checkbox and its footer in separate queued callbacks.
  // A caller may only keep reading within its bound; no action uses this view.
  if ([...states.values()].flat().filter(Boolean).length !== footerCount) return null;
  return { snapshot, list, footerCount, states };
}

export function linkStatesEqual(mode: LinkMode, expected: Map<string, boolean[]>): boolean {
  return mode.states.size === expected.size && [...expected].every(([identity, linked]) => {
    const actual = mode.states.get(identity);
    return actual?.length === linked.length && actual.filter(Boolean).length === linked.filter(Boolean).length;
  });
}
