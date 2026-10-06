import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { executeQtNativeGetValue } from "./qt-native-values.js";
import { executeQtNativeTableRead } from "./qt-native-tables.js";
import { executeQtNativeSnapshot, executeQtSnapshotGetValue, qtSnapshotArguments } from "./qt-native-snapshot.js";
import type { ProductProfile } from "./product-profiles.js";
import { executeQtNativeKnownPageState, executeQtNativePositions, executeQtNativeReadPage, executeQtNativeSubpages } from "./qt-native-pages.js";
import { executeQtNativeFind } from "./qt-native-find.js";
import { executeQtNativeUstvaRead } from "./qt-native-ustva.js";
import { executeQtNativeReceiptManagerRead } from "./qt-native-receipt-read.js";
import { executeQtNativeReceiptManagerUpdate } from "./qt-native-receipt-update.js";
import { executeQtNativeReceiptManagerLink } from "./qt-native-receipt-link.js";
import { executeQtNativeReceiptManagerAction } from "./qt-native-receipt-action.js";
import { executeQtNativeReceiptManagerList } from "./qt-native-receipts.js";
import { executeQtNativePage } from "./qt-native-page.js";
import { executeQtNativeUiState } from "./qt-native-ui-state.js";
import { executeQtNativeHelp } from "./qt-native-help.js";
import { executeQtNativeReadTable } from "./qt-native-read-table.js";
import { executeQtNativeCheckerResults } from "./qt-native-checker.js";
import { executeQtNativeGoto } from "./qt-native-goto.js";
import { executeQtNativeClassificationOptions } from "./qt-native-classification-options.js";
import { executeQtNativeClassify } from "./qt-native-classify.js";

export const QT_NATIVE_OPERATIONS = [
  "get_value", "table_read", "snapshot", "find", "read_page", "subpages", "known_page_state", "positions", "ustva_read",
  "receipt_manager_list", "receipt_manager_read", "receipt_manager_action", "receipt_manager_update", "receipt_manager_link",
  "page", "ui_state", "help", "read_table", "checker_results", "goto", "receipt_manager_classification_options", "receipt_manager_classify",
] as const;
type QtNativeOperation = typeof QT_NATIVE_OPERATIONS[number];
export function isQtNativeOperation(operation: string): operation is QtNativeOperation {
  return QT_NATIVE_OPERATIONS.some(value => value === operation);
}

export interface QtNativeExecutorDependencies {
  /** An explicitly bound session, or its managed lazy provider. */
  qtNativeClient?: QtNativeClient;
  qtNativeClientFor?: (args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal) => Promise<QtNativeClient>;
}

export async function executeQtNativeOperation(
  operation: QtNativeOperation, args: Readonly<Record<string, unknown>>, dependencies: QtNativeExecutorDependencies,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS, signal?: AbortSignal, profile?: ProductProfile,
): Promise<WorkerResult> {
  try {
    const started = performance.now();
    if (operation === "snapshot" && profile) args = qtSnapshotArguments(args, profile);
    const client = dependencies.qtNativeClient ?? await dependencies.qtNativeClientFor!(args, timeoutMs, signal);
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native operation deadline exceeded before dispatch.", "native-timeout");
    const execute = operation === "goto" ? executeQtNativeGoto : operation === "known_page_state" ? executeQtNativeKnownPageState
      : operation === "page" ? executeQtNativePage
      : operation === "ui_state" ? executeQtNativeUiState
      : operation === "help" ? executeQtNativeHelp
      : operation === "read_table" ? executeQtNativeReadTable
      : operation === "checker_results" ? executeQtNativeCheckerResults
      : operation === "positions" ? executeQtNativePositions
      : operation === "ustva_read" ? executeQtNativeUstvaRead
      : operation === "receipt_manager_action" ? executeQtNativeReceiptManagerAction
      : operation === "receipt_manager_read" ? executeQtNativeReceiptManagerRead
      : operation === "receipt_manager_update" ? executeQtNativeReceiptManagerUpdate
      : operation === "receipt_manager_link" ? executeQtNativeReceiptManagerLink
      : operation === "receipt_manager_classification_options" ? executeQtNativeClassificationOptions
      : operation === "receipt_manager_classify" ? executeQtNativeClassify
      : operation === "receipt_manager_list" ? executeQtNativeReceiptManagerList
      : operation === "read_page" ? executeQtNativeReadPage : operation === "subpages" ? executeQtNativeSubpages
      : operation === "find" ? executeQtNativeFind : operation === "snapshot" ? executeQtNativeSnapshot : operation === "table_read" ? executeQtNativeTableRead
      : typeof args.rid === "string" && args.rid.startsWith("42.") ? executeQtSnapshotGetValue : executeQtNativeGetValue;
    return await execute(client, args, remaining, signal, profile);
  } catch (error) {
    return {
      ok: false, backend: "qt",
      kind: error instanceof QtNativeTransportError ? error.kind : "native-contract",
      outcomeUnknown: error instanceof QtNativeTransportError && error.outcomeUnknown,
      error: error instanceof Error ? error.message : "Invalid native runtime response.",
    };
  }
}
