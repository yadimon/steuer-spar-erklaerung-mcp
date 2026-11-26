import type { SseApiOperation } from "./api-contract.js";

/**
 * Worker-Operationen, deren Klausel den Vordergrund holen oder die systemweite
 * Eingabe-Epoche lesen kann. Solange eine davon laeuft, stoppt eine Eingabe
 * des Menschen den Auftrag mit kind 'interference'. Die Liste enthaelt auch
 * interne Worker-Operationen; test/user-input-policy-contract.mjs rechnet sie
 * am Syntaxbaum des Workers nach.
 */
export const SSE_INPUT_GUARDED_WORKER_OPERATIONS = [
  "bulk_action", "checker_detail", "checker_open_plan", "checker_reset", "click", "click_point", "collect",
  "combo_select", "desktop_stop", "dialog_answer", "export_csv", "file_dialog_select", "goto", "goto_tree",
  "menu", "menu_click", "position_create", "receipt_manager_action", "receipt_manager_bulk_upsert",
  "receipt_manager_classification_options", "receipt_manager_classify", "receipt_manager_delete",
  "receipt_manager_import", "receipt_manager_link", "receipt_manager_read", "receipt_manager_update",
  "result_details", "save_as", "set_value", "table_add", "table_add_rows", "table_delete", "table_read",
  "table_update", "tax_knowledge_search", "toggle", "tracked_set_value", "tree_scroll", "tree_top",
  "vast_apply", "vast_mapping_options", "vast_mapping_select", "vast_row_details", "vast_row_set_expanded",
] as const;

/** Liest die Eingabe-Epoche nur zur Auskunft, nie als Waechter. */
export const SSE_INPUT_EPOCH_REPORT_ONLY_WORKER_OPERATIONS = ["product_info"] as const;

/** API-Operationen ohne eigene Worker-Klausel, deren Executor solche Worker-Operationen ausloest. */
export const SSE_INPUT_GUARDED_COMPOSED_OPERATIONS = [
  "case_create", "checker_open", "fill_fields", "scenario_run",
  "ustva_change_value", "ustva_open_section", "ustva_select_period", "ustva_set_flag",
] as const satisfies readonly SseApiOperation[];

/** API-Operationen ohne eigene Worker-Klausel, die nur lesen oder gar keinen Worker brauchen. */
export const SSE_INPUT_FREE_COMPOSED_OPERATIONS = [
  "capabilities", "ustva_read", "workspace_file_list", "workspace_file_read_text",
  "workspace_file_write_text", "workspace_status",
] as const satisfies readonly SseApiOperation[];

export const SSE_USER_INPUT_POLICIES = ["free", "hands-off", "hands-off-with-cursor-run"] as const;
export type SseUserInputPolicy = typeof SSE_USER_INPUT_POLICIES[number];

const GUARDED = new Set<string>([
  ...SSE_INPUT_GUARDED_WORKER_OPERATIONS,
  ...SSE_INPUT_GUARDED_COMPOSED_OPERATIONS,
]);

export function userInputPolicy(operation: SseApiOperation): SseUserInputPolicy {
  // Nur der ausdruecklich angeforderte Cursorlauf bedient das Fenster.
  if (operation === "table_read") return "hands-off-with-cursor-run";
  return GUARDED.has(operation) ? "hands-off" : "free";
}

const DESCRIPTION_TAGS: Record<Exclude<SseUserInputPolicy, "free">, string> = {
  "hands-off": "[Eingabepause]",
  "hands-off-with-cursor-run": "[Eingabepause nur bei noKeys:false]",
};

/** Marke fuer die Beschreibung eines MCP-Werkzeugs; die strengste Regel seiner Operationen gilt. */
export function userInputDescriptionTag(operations: readonly SseApiOperation[]): string | undefined {
  const policies = new Set(operations.map((operation) => userInputPolicy(operation)));
  for (const policy of ["hands-off", "hands-off-with-cursor-run"] as const) {
    if (policies.has(policy)) return DESCRIPTION_TAGS[policy];
  }
  return undefined;
}

export const SSE_USER_INPUT = Object.freeze({
  interferenceKind: "interference",
  policyField: "operationPolicy.<operation>.userInput",
  policies: {
    free: "Der Mensch darf Maus und Tastatur weiter benutzen. Die Operation sendet keine Eingabe und holt kein Fenster nach vorn.",
    "hands-off": "Holt das Programmfenster nach vorn und bedient es mit Zeiger und Tasten oder ueberwacht fremde Eingaben. " +
      "Solange der Aufruf laeuft, darf der Mensch Maus und Tastatur nicht benutzen.",
    "hands-off-with-cursor-run": "Die passive Lesung stoert nicht. Nur der ausdruecklich angeforderte Cursorlauf " +
      "(noKeys:false) bedient das Fenster und braucht die Eingabepause.",
  },
  rule: "Vor einem Aufruf mit Eingabepause den Menschen darauf hinweisen. kind 'interference' heisst: Eine Eingabe oder ein " +
    "Fensterwechsel hat den Auftrag gestoppt. Nur bei retryable:true ist der gemeldete Zustand belegt und der fehlende Teil " +
    "darf mit den gemeldeten Werten erneut angefordert werden; sonst zuerst lesend abgleichen.",
});
