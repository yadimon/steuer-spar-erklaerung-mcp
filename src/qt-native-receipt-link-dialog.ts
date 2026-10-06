import { setTimeout as delay } from "node:timers/promises";
import { SSE_DIALOG_BUTTONS } from "./operation-schema-primitives.js";
import { readProcessWindowInventory, textSha256 } from "./qt-native-projections.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { ReceiptLinkError, type LinkSnapshot, type ReceiptLinkPolicy } from "./qt-native-receipt-link-projection.js";

const normalized = (text: string) => text.replace(/[\s\u0085]+/gu, " ").trim();
const sorted = (values: string[]) => [...values].sort((left, right) => left.localeCompare(right, "de", { sensitivity: "accent" }));

/** Same four-part, NUL-separated decision fingerprint as the worker. */
export function receiptLinkDialogFingerprint(title: string, nodes: QtSnapshotNode[]): string {
  const observed = [...new Set(nodes.filter(node => ["Button", "Pane"].includes(node.type) && node.name).map(node => normalized(node.name)))];
  const canonical = (name: string) => SSE_DIALOG_BUTTONS.find(button => button.toLowerCase() === name.toLowerCase());
  const buttons = nodes.filter(node => ["Button", "Pane"].includes(node.type) && canonical(node.name))
    .map(node => `${canonical(node.name)}=${node.on ? 1 : 0}`);
  const unsupported = observed.filter(name => !canonical(name));
  const texts = [...new Set(nodes.filter(node => ["Text", "TreeItem"].includes(node.type) && node.name)
    .map(node => normalized(node.name)).filter(Boolean))];
  return textSha256([normalized(title), sorted(buttons).join("|"), sorted(unsupported).join("|"), sorted(texts).join("|")].join("\0"));
}

type Press = (snapshot: LinkSnapshot, target: QtSnapshotNode, toolTitle: string) => Promise<Record<string, unknown>>;

/** Retain the worker's optional-dialog observation bound and exact cancellation policy. */
export async function cancelKnownReceiptLinkTransfer(
  client: QtNativeClient, policy: ReceiptLinkPolicy, waitMs: number, budget: () => number,
  press: Press, measured: (durationMs: number) => void, signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const transfer = policy.linkValueTransferDialog;
  const deadline = performance.now() + Math.min(waitMs, 1500, budget());
  let observed: Awaited<ReturnType<typeof readProcessWindowInventory>>["windows"][number] | undefined;
  do {
    const inventory = await readProcessWindowInventory(client, budget(), signal); measured(inventory.durationMs);
    const candidates = inventory.windows.filter(window => window.pid === client.binding.pid && window.title === transfer.title);
    if (candidates.length > 1) throw new ReceiptLinkError("The receipt value-transfer dialog is ambiguous.", "ambiguous", true);
    if (candidates.length === 1) { observed = candidates[0]!; break; }
    if (performance.now() >= deadline) break;
    await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal });
  } while (performance.now() < deadline);
  if (!observed) return { transferDialogObserved: false, valueTransferCancelled: false };
  if (!new RegExp(transfer.classPattern, "u").test(observed.class) || observed.minimized || observed.hung)
    throw new ReceiptLinkError("The receipt value-transfer window differs from its catalogue.", "stale-window", true);
  const snapshot = await readQtNativeSnapshot(client, { toolTitle: transfer.title, maxNodes: 1200 }, budget(), signal);
  measured(snapshot.nativeDurationMs);
  if (snapshot.hwnd !== observed.hwnd || !snapshot.windowEnabled || snapshot.modalBlocked || snapshot.stats.truncated)
    throw new ReceiptLinkError("The receipt value-transfer dialog cannot be completely and exactly read.", "window-obstructed", true);
  const fingerprint = receiptLinkDialogFingerprint(transfer.title, snapshot.nodes);
  if (!transfer.fingerprints.some(allowed => allowed.toUpperCase() === fingerprint))
    throw new ReceiptLinkError("The receipt value-transfer dialog has an unknown decision fingerprint; no button dispatched.", "fingerprint-mismatch", true);
  const buttons = snapshot.nodes.filter(node => node.type === "Button" && node.name === transfer.cancelButton
    && node.on && node.w > 0 && node.h > 0);
  if (buttons.length !== 1) throw new ReceiptLinkError("The exact receipt value-transfer cancel button is not unique.", "stale", true);
  const cancelBinding = await press(snapshot, buttons[0]!, transfer.title);
  const closeDeadline = performance.now() + Math.min(waitMs, budget());
  do {
    const inventory = await readProcessWindowInventory(client, budget(), signal); measured(inventory.durationMs);
    if (!inventory.windows.some(window => window.hwnd === observed!.hwnd)
      && !inventory.windows.some(window => window.pid === client.binding.pid && window.title === transfer.title))
      return { transferDialogObserved: true, valueTransferCancelled: true, transferDialogFingerprint: fingerprint, transferCancelClick: cancelBinding };
    await delay(Math.min(25, Math.max(1, closeDeadline - performance.now())), undefined, { signal });
  } while (performance.now() < closeDeadline);
  throw new ReceiptLinkError("The exact receipt value-transfer dialog remained open after cancellation; do not replay.", "postcondition-failed", true);
}
