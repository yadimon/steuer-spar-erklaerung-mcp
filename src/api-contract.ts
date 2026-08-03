import { timingSafeEqual } from "node:crypto";

export const SSE_API_VERSION = "v1";
export const DEFAULT_API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 43127;
export const DEFAULT_OPERATION_TIMEOUT_MS = 90_000;
export const MAX_OPERATION_TIMEOUT_MS = 300_000;
// Eine UTF-8-Textdatei darf 1 MiB gross sein. JSON-Escaping kann einzelne
// Zeichen bis auf sechs Bytes aufblasen; 8 MiB lassen diesen legitimen Fall
// zu, ohne unbeschraenkte Request-Bodies zu akzeptieren.
export const MAX_API_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Explizite API-Grenze. Nur bereits vom MCP angebotene, fachlich gebundene
 * Operationen duerfen den PowerShell-Worker erreichen. Insbesondere fehlen
 * freie Tastatureingaben (`keys`) absichtlich.
 */
export const SSE_API_OPERATIONS = [
  "accessibility_probe",
  "archive_cases",
  "backup_cases",
  "case_hash",
  "center_cases",
  "center_refresh",
  "check",
  "checker_close",
  "checker_detail",
  "checker_open",
  "checker_reset",
  "checker_results",
  "checker_run",
  "click",
  "click_point",
  "close",
  "collect",
  "combo_options",
  "combo_select",
  "desktop_start",
  "desktop_status",
  "desktop_stop",
  "dialog_answer",
  "dialog_list",
  "dismiss",
  "export_csv",
  "file_dialog_select",
  "find",
  "get_value",
  "goto",
  "health",
  "help",
  "known_page_state",
  "launch",
  "list_cases",
  "make_working_copy",
  "menu",
  "menu_click",
  "menu_close",
  "page",
  "page_objects",
  "positions",
  "product_info",
  "read_full",
  "read_page",
  "read_table",
  "result_details",
  "save",
  "save_as",
  "scenario_run",
  "screenshot",
  "scroll",
  "scroll_page",
  "set_value",
  "snapshot",
  "snapshot_compare",
  "subpages",
  "table_add",
  "table_delete",
  "table_read",
  "table_update",
  "toggle",
  "tracked_set_value",
  "tree_scroll",
  "tree_top",
  "ui_state",
  "vast_apply",
  "vast_dialog_read",
  "vast_mapping_options",
  "vast_mapping_select",
  "vast_row_details",
  "vast_row_set_expanded",
  "verify",
  "warning_popup_read",
  "workspace_file_list",
  "workspace_file_read_text",
  "workspace_file_write_text",
  "workspace_status",
  "window_close",
  "windows",
] as const;

export type SseApiOperation = (typeof SSE_API_OPERATIONS)[number];
const OPERATION_SET = new Set<string>(SSE_API_OPERATIONS);

export interface WorkerResult {
  ok: boolean;
  kind?: string;
  error?: string;
  ms?: number;
  [key: string]: unknown;
}
export interface OperationRequest {
  args?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface OperationEnvelope {
  apiVersion: typeof SSE_API_VERSION;
  requestId: string;
  operation: SseApiOperation;
  durationMs: number;
  result: WorkerResult;
}

export interface ApiErrorEnvelope {
  apiVersion: typeof SSE_API_VERSION;
  requestId: string;
  error: {
    code: string;
    message: string;
  };
}

export function isSseApiOperation(value: string): value is SseApiOperation {
  return OPERATION_SET.has(value);
}

export function asArray<T>(value: unknown): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

export function safeTokenEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
