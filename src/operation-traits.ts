import { SSE_API_OPERATIONS, type SseApiOperation } from "./api-contract.js";

export const SSE_READ_ONLY_OPERATIONS = [
  "accessibility_probe",
  "capabilities",
  "case_hash",
  "center_cases",
  "checker_results",
  "dialog_list",
  "find",
  "get_value",
  "health",
  "help",
  "instances",
  "known_page_state",
  "list_cases",
  "page",
  "page_objects",
  "positions",
  "product_info",
  "read_full",
  "read_page",
  "read_table",
  "receipt_manager_list",
  "result_details",
  "snapshot",
  "snapshot_compare",
  "subpages",
  "ui_state",
  "ustva_read",
  "vast_dialog_read",
  "vast_mapping_options",
  "vast_row_details",
  "verify",
  "warning_popup_read",
  "windows",
  "workspace_file_list",
  "workspace_file_read_text",
  "workspace_status",
] as const satisfies readonly SseApiOperation[];

export const SSE_DESTRUCTIVE_OPERATIONS = [
  "archive_cases",
  "click",
  "click_point",
  "close",
  "combo_select",
  "desktop_stop",
  "dialog_answer",
  "file_dialog_select",
  "menu_click",
  "receipt_manager_delete",
  "receipt_manager_bulk_upsert",
  "receipt_manager_classify",
  "receipt_manager_link",
  "receipt_manager_import",
  "receipt_manager_update",
  "save",
  "save_as",
  "scenario_run",
  "table_add",
  "table_delete",
  "table_update",
  "toggle",
  "tracked_set_value",
  "ustva_change_value",
  "ustva_select_period",
  "ustva_set_flag",
  "vast_apply",
  "vast_mapping_select",
] as const satisfies readonly SseApiOperation[];

const READ_ONLY_SET = new Set<SseApiOperation>(SSE_READ_ONLY_OPERATIONS);
const DESTRUCTIVE_SET = new Set<SseApiOperation>(SSE_DESTRUCTIVE_OPERATIONS);

/** Alle Operationen mit lokalem Prozess-, UI- oder Dateiseiteneffekt. */
export const SSE_STATEFUL_OPERATIONS = Object.freeze(
  SSE_API_OPERATIONS.filter((operation) => !READ_ONLY_SET.has(operation)),
);

/** Zustandsbehaftete Operationen ohne destruktive Wirkung nach MCP-Semantik. */
export const SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS = Object.freeze(
  SSE_STATEFUL_OPERATIONS.filter((operation) => !DESTRUCTIVE_SET.has(operation)),
);

export const SSE_CLEANUP_OPERATIONS = [
  "checker_close",
  "checker_reset",
  "close",
  "desktop_stop",
  "dismiss",
  "menu_close",
  "window_close",
] as const satisfies readonly SseApiOperation[];

/** UI-/Steuerfallmutationen, die bei einem nicht erneut verifizierten SSE-Build fail-closed stoppen. */
export const SSE_BUILD_DRIFT_BLOCKED_OPERATIONS = [
  "checker_run",
  "click",
  "click_point",
  "combo_select",
  "dialog_answer",
  "file_dialog_select",
  "goto",
  "menu_click",
  "receipt_manager_action",
  "receipt_manager_bulk_upsert",
  "receipt_manager_classification_options",
  "receipt_manager_classify",
  "receipt_manager_link",
  "receipt_manager_delete",
  "receipt_manager_import",
  "receipt_manager_read",
  "receipt_manager_update",
  "save",
  "save_as",
  "set_value",
  "table_add",
  "table_delete",
  "table_update",
  "toggle",
  "tracked_set_value",
  "ustva_change_value",
  "ustva_open_section",
  "ustva_select_period",
  "ustva_set_flag",
  "vast_apply",
  "vast_mapping_select",
  "vast_row_set_expanded",
] as const satisfies readonly SseApiOperation[];

export function operationAnnotations(operation: SseApiOperation): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
} {
  const readOnly = READ_ONLY_SET.has(operation);
  return {
    readOnlyHint: readOnly,
    destructiveHint: DESTRUCTIVE_SET.has(operation),
    idempotentHint: readOnly,
    openWorldHint: false,
  };
}
