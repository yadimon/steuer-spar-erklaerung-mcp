import type { SseApiOperation, WorkerResult } from "./api-contract.js";
import { parseApiOperationArgs } from "./operation-catalog.js";

export const SSE_RECEIPT_MANAGER_OPERATIONS = [
  "receipt_manager_action",
  "receipt_manager_bulk_upsert",
  "receipt_manager_classification_options",
  "receipt_manager_classify",
  "receipt_manager_delete",
  "receipt_manager_import",
  "receipt_manager_link",
  "receipt_manager_list",
  "receipt_manager_read",
  "receipt_manager_update",
] as const satisfies readonly SseApiOperation[];

export const SSE_FOCUSLESS_RECEIPT_OPERATIONS = [
  "receipt_manager_list",
] as const satisfies readonly SseApiOperation[];

export const SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS = [
  "receipt_manager_action",
  "receipt_manager_bulk_upsert",
  "receipt_manager_classification_options",
  "receipt_manager_classify",
  "receipt_manager_delete",
  "receipt_manager_import",
  "receipt_manager_link",
  "receipt_manager_read",
  "receipt_manager_update",
] as const satisfies readonly SseApiOperation[];

export type ReceiptInteractionRequirement = "focusless-read" | "foreground-required";

const FOCUSLESS = new Set<SseApiOperation>(SSE_FOCUSLESS_RECEIPT_OPERATIONS);
const FOREGROUND_REQUIRED = new Set<SseApiOperation>(SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS);

export const RECEIPT_FOREGROUND_BLOCK_REASON = "foreground-required-operation-disabled";
export const RECEIPT_FOREGROUND_BLOCK_DESCRIPTION =
  "Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg " +
  "das sichtbare Fenster oder globale physische Eingabe benoetigt. Der Aufruf endet vor jeder UI-Aenderung " +
  "und darf nicht automatisch wiederholt werden. ";

export function receiptInteractionRequirement(
  operation: SseApiOperation,
): ReceiptInteractionRequirement | null {
  if (FOCUSLESS.has(operation)) return "focusless-read";
  if (FOREGROUND_REQUIRED.has(operation)) return "foreground-required";
  return null;
}

export function receiptBlock(
  operation: SseApiOperation,
  args: Record<string, unknown>,
): WorkerResult | null {
  if (receiptInteractionRequirement(operation) !== "foreground-required") return null;
  parseApiOperationArgs(operation, args);
  return {
    ok: false,
    kind: "blocked",
    error:
      `Operation '${operation}' ist im Hintergrund gesperrt, weil der verifizierte BelegManager-Weg ` +
      "Vordergrund- oder globale physische Eingabe benoetigt. Keine UI wurde geaendert; nicht automatisch wiederholen.",
    reason: RECEIPT_FOREGROUND_BLOCK_REASON,
    retryable: false,
    interactionRequirement: "foreground-required",
    mutationStarted: false,
    resultingState: "unchanged",
    cleanupRequired: false,
    physicalInputUsed: false,
    foregroundLeaseUsed: false,
  };
}
