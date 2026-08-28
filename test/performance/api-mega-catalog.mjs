/**
 * Durable scope declaration for the live direct-API mega journey.
 *
 * `covered` means the canonical journey calls the public HTTP operation and
 * asserts a useful happy-path result. The other classes are explicit design
 * exclusions; they are not failed coverage and must never be presented as
 * happy-path eligible merely to inflate a percentage.
 */

const groups = [
  {
    classification: "covered",
    subclassification: "canonical-direct-api-happy-path",
    reason: "Called through the loopback HTTP API with a journey-specific assertion.",
    operations: [
      "accessibility_probe", "backup_cases", "capabilities", "case_hash", "click", "close", "collect",
      "combo_options", "dialog_answer", "dialog_list", "export_csv", "file_dialog_select",
      "fill_fields", "find", "get_value", "goto", "health", "help", "instances",
      "known_page_state", "launch", "list_cases", "make_working_copy", "menu", "menu_click",
      "menu_close", "page", "page_objects", "positions", "product_info", "read_full", "read_page",
      "read_table", "receipt_manager_action", "receipt_manager_bulk_upsert",
      "receipt_manager_classification_options", "receipt_manager_classify", "receipt_manager_delete",
      "receipt_manager_import", "receipt_manager_link", "receipt_manager_list", "receipt_manager_read",
      "receipt_manager_update", "result_details", "save", "screenshot", "snapshot", "snapshot_compare",
      "subpages", "table_add", "table_delete", "table_read", "table_update", "ui_state",
      "ustva_change_value", "ustva_open_section", "ustva_read", "ustva_select_period", "ustva_set_flag",
      "verify", "warning_popup_read", "window_close", "windows", "workspace_file_list",
      "workspace_file_read_text", "workspace_file_write_text", "workspace_status",
    ],
  },
  {
    classification: "safely-skipped-read-only",
    subclassification: "redundant-navigation-read",
    reason: "Safe but redundant UI navigation/read coverage; omitted to keep one journey representative rather than repetitive.",
    operations: ["scroll", "scroll_page", "tree_scroll", "tree_top"],
  },
  {
    classification: "requires-external-state",
    subclassification: "account-certificate-or-service",
    reason: "Needs a separate application, account, certificate, or service state that the disposable offline journey must not assume.",
    operations: [
      "center_cases", "center_refresh", "vast_apply", "vast_dialog_read", "vast_mapping_options",
      "vast_mapping_select", "vast_row_details", "vast_row_set_expanded",
    ],
  },
  {
    classification: "destructive-non-happy-path",
    subclassification: "diagnostic-or-failure-path",
    reason: "Checker and validation flows intentionally exercise diagnostic or failure behavior rather than the canonical mutation happy path.",
    operations: ["check", "checker_close", "checker_detail", "checker_open", "checker_reset", "checker_results", "checker_run"],
  },
  {
    classification: "destructive-non-happy-path",
    subclassification: "incompatible-controller-mode",
    reason: "Desktop-controller operations are incompatible with the visible-session receipt lease and the one-controller direct-API benchmark.",
    operations: ["desktop_start", "desktop_status", "desktop_stop"],
  },
  {
    classification: "destructive-non-happy-path",
    subclassification: "generic-physical-input",
    reason: "Generic coordinate, selector, toggle, and raw value paths are excluded in favor of typed state-bound operations.",
    operations: ["click_point", "combo_select", "set_value", "toggle", "tracked_set_value", "window_restore"],
  },
  {
    classification: "destructive-non-happy-path",
    subclassification: "alternate-file-lifecycle",
    reason: "Archive and save-as change file topology and duplicate the safer working-copy, save, reopen, and hash lifecycle already measured.",
    operations: ["archive_cases", "save_as"],
  },
  {
    classification: "destructive-non-happy-path",
    subclassification: "alternate-orchestration",
    reason: "Scenario orchestration would introduce a second controller above the canonical serialized direct-API journey.",
    operations: ["scenario_run"],
  },
  {
    classification: "destructive-non-happy-path",
    subclassification: "generic-dismissal",
    reason: "Generic dismissal cannot prove the exact window or dialog transition required by this fail-closed happy path.",
    operations: [
      "dismiss",
    ],
  },
];

export const MEGA_OPERATION_CATALOG = Object.freeze(groups.flatMap((group) =>
  group.operations.map((operation) => Object.freeze({
    operation,
    classification: group.classification,
    subclassification: group.subclassification,
    reason: group.reason,
  })),
));

export const MEGA_EXCLUDED_DOMAINS = Object.freeze([
  {
    domain: "VaSt/ELSTER account and certificate",
    reason: "Requires user-owned ELSTER account/certificate state; the benchmark never logs in or supplies a PIN.",
  },
  {
    domain: "Steuertipps Center and external services",
    reason: "Separate process/service state is not part of the single visible SSE controller journey.",
  },
  {
    domain: "Transmission and submission",
    reason: "Sending, submitting, or transmitting tax data is categorically outside the offline happy path.",
  },
  {
    domain: "Activation and licensing",
    reason: "The benchmark neither bypasses nor automates product activation or licensing.",
  },
  {
    domain: "Arbitrary physical input",
    reason: "Free selectors, coordinates, keyboard input, and generic click_point paths remain excluded; only typed operations may own input.",
  },
]);

const mutation = (id, phase, operation, readbackOperation, assertion) => Object.freeze({
  id, phase, operation, readbackOperation, assertion,
});

/**
 * Every state-changing step the implementation may execute. Runtime records
 * copy these declarations and add mutation/readback timings plus pass/fail.
 */
export const MEGA_MUTATION_READBACKS = Object.freeze([
  mutation("backup-cases", "safety", "backup_cases", "workspace_file_list", "backup manifest and both staged official fixtures are listed"),
  mutation("copy-gew", "safety", "make_working_copy", "case_hash", "Gew working-copy hash equals its staged official source hash"),
  mutation("copy-est", "safety", "make_working_copy", "case_hash", "ESt working-copy hash equals its staged official source hash"),
  mutation("workspace-marker", "safety", "workspace_file_write_text", "workspace_file_read_text", "create-only marker text round-trips exactly"),
  mutation("launch-gew", "launch-and-reads", "launch", "dialog_list", "launched Gew PID is ready with a bound main HWND and has no unknown startup dialog"),
  mutation("launch-gew-startup-dialog", "launch-and-reads", "dialog_answer", "dialog_list", "the exact passive startup dialog is gone"),
  mutation("goto-table", "table-and-persistence", "goto", "table_read", "profiled table heading and original sum are bound"),
  mutation("table-add", "table-and-persistence", "table_add", "table_read", "added marker and expected sum are visible"),
  mutation("table-update", "table-and-persistence", "table_update", "table_read", "corrected marker and expected sum are visible"),
  mutation("save-table", "table-and-persistence", "save", "case_hash", "working-copy file hash changed after save"),
  mutation("close-after-save", "table-and-persistence", "close", "health", "owned SSE process is no longer running"),
  mutation("reopen-gew", "table-and-persistence", "launch", "dialog_list", "reopened Gew PID is ready with a bound main HWND and has no unknown startup dialog"),
  mutation("reopen-gew-startup-dialog", "table-and-persistence", "dialog_answer", "dialog_list", "the exact passive reopen dialog is gone"),
  mutation("goto-persisted-table", "table-and-persistence", "goto", "table_read", "saved corrected marker persisted across reopen"),
  mutation("table-delete", "table-and-persistence", "table_delete", "table_read", "marker is absent and original sum restored"),
  mutation("save-table-clean", "table-and-persistence", "save", "case_hash", "delete produced a second persisted file hash"),
  mutation("goto-ustva", "ustva", "goto", "ustva_read", "UStVA overview and original period are bound"),
  mutation("ustva-period-change", "ustva", "ustva_select_period", "ustva_read", "alternate period is selected"),
  mutation("ustva-period-restore", "ustva", "ustva_select_period", "ustva_read", "original period and settlement are restored"),
  mutation("ustva-flag-change", "ustva", "ustva_set_flag", "ustva_read", "documents flag is toggled"),
  mutation("ustva-flag-restore", "ustva", "ustva_set_flag", "ustva_read", "documents flag equals its original value"),
  mutation("ustva-value-change", "ustva", "ustva_change_value", "ustva_read", "special advance payment and settlement changed exactly"),
  mutation("ustva-value-restore", "ustva", "ustva_change_value", "ustva_read", "special advance payment and settlement are restored"),
  mutation("ustva-section-open", "ustva", "ustva_open_section", "ustva_read", "requested section page is reported"),
  mutation("ustva-section-restore", "ustva", "click", "ustva_read", "overview is restored with original values"),
  mutation("collect-result", "artifacts", "collect", "workspace_file_read_text", "hash-bound collect JSON is readable and structurally valid"),
  mutation("screenshot-result", "artifacts", "screenshot", "workspace_file_list", "new PNG result is listed with a hash"),
  mutation("export-open", "artifacts", "export_csv", "dialog_list", "the profiled export dialog is explicitly listed"),
  mutation("export-trigger", "artifacts", "dialog_answer", "dialog_list", "the profiled native folder dialog is explicitly listed"),
  mutation("export-folder", "artifacts", "file_dialog_select", "dialog_list", "the native folder dialog is closed after the bound selection"),
  mutation("export-dialog-cleanup", "artifacts", "dialog_answer", "dialog_list", "the exact unchanged export window is closed, or its absence is recorded as a skip"),
  mutation("result-details-open", "artifacts", "result_details", "windows", "Werte-Info tool window is explicitly listed"),
  mutation("result-details-close", "artifacts", "window_close", "windows", "the bound Werte-Info tool window is absent"),
  mutation("artifact-menu-open", "artifacts", "menu", "windows", "open File menu popup is explicitly present and contains the profiled CSV export entry"),
  mutation("artifact-menu-close", "artifacts", "menu_close", "windows", "the exact popup HWND from the menu readback is absent"),
  mutation("close-gew", "known-fields", "close", "health", "owned Gew process is no longer running before changing product mode"),
  mutation("launch-est", "known-fields", "launch", "dialog_list", "launched ESt PID is ready with a bound main HWND and has no unknown startup dialog"),
  mutation("launch-est-startup-dialog", "known-fields", "dialog_answer", "dialog_list", "the exact passive ESt startup dialog is gone"),
  mutation("goto-known-field", "known-fields", "goto", "known_page_state", "dynamic person-bound ESt pageId is current"),
  mutation("known-field-write", "known-fields", "fill_fields", "known_page_state", "profiled currency field equals the temporary value"),
  mutation("known-field-correction", "known-fields", "fill_fields", "known_page_state", "corrected profiled currency value is visible"),
  mutation("known-field-restore", "known-fields", "fill_fields", "known_page_state", "profiled currency field equals its original value"),
  mutation("menu-open", "receipts", "menu", "windows", "open Extras menu popup is explicitly present and contains the exact BelegManager entry"),
  mutation("receipt-manager-open", "receipts", "menu_click", "windows", "the profiled BelegManager tool window is listed"),
  mutation("receipt-go-home", "receipts", "receipt_manager_action", "snapshot", "receipt manager start state is visible"),
  mutation("receipt-show-list", "receipts", "receipt_manager_action", "receipt_manager_list", "complete expected baseline list is visible"),
  mutation("receipt-import", "receipts", "receipt_manager_import", "receipt_manager_list", "exactly one synthetic draft was added"),
  mutation("receipt-update", "receipts", "receipt_manager_update", "receipt_manager_read", "typed synthetic metadata values round-trip"),
  mutation("receipt-classify", "receipts", "receipt_manager_classify", "receipt_manager_list", "classification removes draft state and preserves one unique synthetic receipt"),
  mutation("receipt-upsert-idempotence", "receipts", "receipt_manager_bulk_upsert", "receipt_manager_list", "skip-on-existing keeps the count and semantic identity unique"),
  mutation("receipt-manager-close-before-link", "receipts", "window_close", "windows", "BelegManager is closed before target-page linking"),
  mutation("goto-receipt-link-target", "receipts", "goto", "page", "known ESt link target page is current"),
  mutation("receipt-link", "receipts", "receipt_manager_link", "receipt_manager_link", "a fresh idempotent API verifier observes linked=true without applying another change"),
  mutation("receipt-menu-open-after-link", "receipts", "menu", "windows", "Extras menu popup is bound before link readback"),
  mutation("receipt-manager-open-after-link", "receipts", "menu_click", "receipt_manager_list", "synthetic receipt remains unique after link"),
  mutation("receipt-manager-close-before-unlink", "receipts", "window_close", "windows", "BelegManager is closed before unlink"),
  mutation("receipt-unlink", "receipts", "receipt_manager_link", "receipt_manager_link", "a fresh idempotent API verifier observes linked=false without applying another change"),
  mutation("receipt-menu-open-after-unlink", "receipts", "menu", "windows", "Extras menu popup is bound before unlink readback"),
  mutation("receipt-manager-open-after-unlink", "receipts", "menu_click", "receipt_manager_list", "synthetic receipt remains unique after unlink"),
  mutation("receipt-delete", "receipts", "receipt_manager_delete", "receipt_manager_list", "synthetic receipt is absent and baseline list restored"),
  mutation("receipt-manager-final-close", "receipts", "window_close", "windows", "BelegManager is absent after final empty-list proof"),
  mutation("close-est", "cleanup", "close", "health", "owned ESt process is no longer running"),
]);
