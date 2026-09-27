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
import { executeQtNativeReceiptManagerAction } from "./qt-native-receipt-action.js";
import { executeQtNativeReceiptManagerList } from "./qt-native-receipts.js";
import { executeQtNativePage } from "./qt-native-page.js";
import { executeQtNativeUiState } from "./qt-native-ui-state.js";

export const QT_NATIVE_READ_OPERATIONS = [
  "get_value", "table_read", "snapshot", "find", "read_page", "subpages", "known_page_state", "positions", "ustva_read",
  "receipt_manager_list", "receipt_manager_read", "receipt_manager_action",
  "page", "ui_state",
] as const;
type QtNativeReadOperation = typeof QT_NATIVE_READ_OPERATIONS[number];
export function isQtNativeReadOperation(operation: string): operation is QtNativeReadOperation {
  return QT_NATIVE_READ_OPERATIONS.some(value => value === operation);
}

export interface QtNativeExecutorDependencies {
  /** An explicitly bound session, or its managed lazy provider. */
  qtNativeClient?: QtNativeClient;
  qtNativeClientFor?: (args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal) => Promise<QtNativeClient>;
}

export async function executeQtNativeRead(
  operation: QtNativeReadOperation, args: Readonly<Record<string, unknown>>, dependencies: QtNativeExecutorDependencies,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS, signal?: AbortSignal, profile?: ProductProfile,
): Promise<WorkerResult> {
  try {
    const started = performance.now();
    if (operation === "snapshot" && profile) args = qtSnapshotArguments(args, profile);
    const client = dependencies.qtNativeClient ?? await dependencies.qtNativeClientFor!(args, timeoutMs, signal);
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native operation deadline exceeded before reading.", "native-timeout");
    const execute = operation === "known_page_state" ? executeQtNativeKnownPageState
      : operation === "page" ? executeQtNativePage
      : operation === "ui_state" ? executeQtNativeUiState
      : operation === "positions" ? executeQtNativePositions
      : operation === "ustva_read" ? executeQtNativeUstvaRead
      : operation === "receipt_manager_action" ? executeQtNativeReceiptManagerAction
      : operation === "receipt_manager_read" ? executeQtNativeReceiptManagerRead
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
