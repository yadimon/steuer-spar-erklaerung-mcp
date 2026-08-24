import { z } from "zod";
import {
  MAX_WORKSPACE_TEXT_BYTES,
  SSE_API_OPERATIONS,
  type SseApiOperation,
} from "./api-contract.js";
import { SSE_MCP_TOOL_SCHEMAS } from "./mcp-operation-schemas.js";
import {
  BARE_RESOURCE_REF,
  GOTO_MAX_STEPS,
  PROCESS_ID,
  RESOURCE_REF,
  RESULT_REF,
  SHA256,
  SSE_API_CLICK_PATTERNS,
  TEXT_WRITE_REF,
  WINDOW_HANDLE,
  WORKSPACE_REF,
} from "./operation-schema-primitives.js";

export {
  SSE_CLICK_PATTERNS,
  SSE_DIALOG_BUTTONS,
  SSE_OPERATION_LIMITS,
  SSE_START_MODES,
} from "./operation-schema-primitives.js";
export { SSE_MCP_TOOL_SCHEMAS } from "./mcp-operation-schemas.js";

export type SseMcpToolName = keyof typeof SSE_MCP_TOOL_SCHEMAS;

export const SSE_MCP_TOOL_OPERATIONS = {
  "sse_product_info": "product_info",
  "sse_capabilities": "capabilities",
  "sse_page_objects": "page_objects",
  "sse_page_state": "known_page_state",
  "sse_workspace_status": "workspace_status",
  "sse_workspace_files": "workspace_file_list",
  "sse_workspace_read_text": "workspace_file_read_text",
  "sse_workspace_write_text": "workspace_file_write_text",
  "sse_run_scenario": "scenario_run",
  "sse_health": "health",
  "sse_windows": "windows",
  "sse_instances": "instances",
  "sse_center_cases": "center_cases",
  "sse_center_refresh": "center_refresh",
  "sse_window_close": "window_close",
  "sse_window_restore": "window_restore",
  "sse_case_hash": "case_hash",
  "sse_dialog_list": "dialog_list",
  "sse_dialog_answer": "dialog_answer",
  "sse_warning_popup_read": "warning_popup_read",
  "sse_vast_dialog_read": "vast_dialog_read",
  "sse_vast_row_details": "vast_row_details",
  "sse_vast_row_set_expanded": "vast_row_set_expanded",
  "sse_vast_mapping_options": "vast_mapping_options",
  "sse_vast_mapping_select": "vast_mapping_select",
  "sse_vast_apply": "vast_apply",
  "sse_read_full": "read_full",
  "sse_scroll_page": "scroll_page",
  "sse_help": "help",
  "sse_subpages": "subpages",
  "sse_check_page": "check",
  "sse_result_details": "result_details",
  "sse_checker_results": "checker_results",
  "sse_checker_run": "checker_run",
  "sse_checker_reset": "checker_reset",
  "sse_checker_open": "checker_open",
  "sse_checker_close": "checker_close",
  "sse_desktop_start": "desktop_start",
  "sse_desktop_stop": "desktop_stop",
  "sse_desktop_status": "desktop_status",
  "sse_page": "page",
  "sse_positions": "positions",
  "sse_export_csv": "export_csv",
  "sse_collect": "collect",
  "sse_verify": "verify",
  "sse_tree_top": "tree_top",
  "sse_tree_scroll": "tree_scroll",
  "sse_goto": "goto",
  "sse_table_read": "table_read",
  "sse_table_add": "table_add",
  "sse_table_update": "table_update",
  "sse_table_delete": "table_delete",
  "sse_menu": "menu",
  "sse_menu_click": "menu_click",
  "sse_menu_close": "menu_close",
  "sse_receipt_manager_action": "receipt_manager_action",
  "sse_receipt_manager_delete": "receipt_manager_delete",
  "sse_receipt_manager_import": "receipt_manager_import",
  "sse_receipt_manager_list": "receipt_manager_list",
  "sse_receipt_manager_read": "receipt_manager_read",
  "sse_ui_state": "ui_state",
  "sse_dismiss": "dismiss",
  "sse_screenshot": "screenshot",
  "sse_read_page": "read_page",
  "sse_read_table": "read_table",
  "sse_snapshot": "snapshot",
  "sse_snapshot_compare": "snapshot_compare",
  "sse_accessibility_probe": "accessibility_probe",
  "sse_find": "find",
  "sse_get_value": "get_value",
  "sse_click": "click",
  "sse_toggle": "toggle",
  "sse_click_point": "click_point",
  "sse_set_value": "set_value",
  "sse_change_field": "tracked_set_value",
  "sse_change_known_field": "tracked_set_value",
  "sse_combo_options": "combo_options",
  "sse_combo_select": "combo_select",
  "sse_ustva_read": "ustva_read",
  "sse_ustva_select_period": "ustva_select_period",
  "sse_ustva_set_flag": "ustva_set_flag",
  "sse_ustva_change_value": "ustva_change_value",
  "sse_ustva_open_section": "ustva_open_section",
  "sse_scroll": "scroll",
  "sse_launch": "launch",
  "sse_save": "save",
  "sse_file_dialog_select": "file_dialog_select",
  "sse_save_as": "save_as",
  "sse_close": "close",
  "sse_list_cases": "list_cases",
  "sse_backup_cases": "backup_cases",
  "sse_archive_cases": "archive_cases",
  "sse_make_working_copy": "make_working_copy",
} as const satisfies Record<SseMcpToolName, SseApiOperation>;

/** API-Operationen, die nur als interner Schritt eines MCP-Fachwerkzeugs erreichbar sind. */
export const SSE_MCP_COMPOSITION_ONLY_OPERATIONS = [
  "checker_detail",
] as const satisfies readonly SseApiOperation[];

const RESOURCE_AREA = z.enum(["cases", "documents", "workspace", "results", "backups"])
  .describe("Lokal konfigurierter Ressourcenbereich fuer einen relativen ref-Wert");
const API_TEXT_WRITE_AREA = z.enum(["workspace", "results"])
  .describe(
    "Schreibbarer lokaler Ressourcenbereich fuer einen relativen ref-Wert; " +
    "den Bereich nicht zusaetzlich als ersten Pfadteil in ref wiederholen",
  );
const API_LOCAL_PATH = z.string().min(1).refine(
  (value) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\x00-\x1f*?"<>|]/.test(value),
  "Absoluter lokaler Windows-Pfad ohne Platzhalter erwartet",
).describe("API-only Kompatibilitaetspfad auf dem lokalen Windows-PC; Ressourcenreferenz bevorzugen");
type AnyOperationSchema = z.ZodType<Record<string, unknown>>;

function withLegacyAlias(schema: z.AnyZodObject, alias: string, legacy: string): AnyOperationSchema {
  const shape: z.ZodRawShape = { ...schema.shape };
  shape[alias] = (shape[alias] as z.ZodTypeAny).optional();
  shape[legacy] = API_LOCAL_PATH.optional();
  return z.object(shape).strict().superRefine((value, context) => {
    const hasAlias = value[alias] !== undefined;
    const hasLegacy = value[legacy] !== undefined;
    if (hasAlias === hasLegacy) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Genau eines von '${alias}' oder '${legacy}' muss angegeben werden.`,
      });
    }
  });
}

function optionalAliasWithLegacy(schema: z.AnyZodObject, alias: string, legacy: string): AnyOperationSchema {
  const shape: z.ZodRawShape = { ...schema.shape };
  shape[alias] = (shape[alias] as z.ZodTypeAny).optional();
  shape[legacy] = API_LOCAL_PATH.optional();
  return z.object(shape).strict().superRefine((value, context) => {
    if (value[alias] !== undefined && value[legacy] !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `'${alias}' und '${legacy}' duerfen nicht gemeinsam angegeben werden.`,
      });
    }
  });
}

function withLegacyAliases(
  schema: z.AnyZodObject,
  pairs: ReadonlyArray<readonly [alias: string, legacy: string]>,
): AnyOperationSchema {
  const shape: z.ZodRawShape = { ...schema.shape };
  for (const [alias, legacy] of pairs) {
    shape[alias] = (shape[alias] as z.ZodTypeAny).optional();
    shape[legacy] = API_LOCAL_PATH.optional();
  }
  return z.object(shape).strict().superRefine((value, context) => {
    for (const [alias, legacy] of pairs) {
      if ((value[alias] !== undefined) === (value[legacy] !== undefined)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Genau eines von '${alias}' oder '${legacy}' muss angegeben werden.`,
        });
      }
    }
  });
}

function extendStrict(schema: z.AnyZodObject, extension: z.ZodRawShape): z.AnyZodObject {
  return z.object({ ...schema.shape, ...extension }).strict();
}

function requireCaseHashBinding(schema: AnyOperationSchema): AnyOperationSchema {
  return schema.superRefine((value, context) => {
    const hasCase = value.expectedCaseRef !== undefined || value.expectedCasePath !== undefined;
    const hasHash = value.expectedCaseHash !== undefined;
    if (hasCase !== hasHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Steuerfallreferenz/-pfad und expectedCaseHash muessen gemeinsam angegeben werden.",
      });
    }
  });
}

function requireSelector(
  schema: AnyOperationSchema,
  operation: string,
  selectors: readonly string[],
  containsRequiresName = false,
): AnyOperationSchema {
  return schema.superRefine((value, context) => {
    if (!selectors.some((selector) => typeof value[selector] === "string" && value[selector] !== "")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${operation} braucht einen Bezeichner: ${selectors.join(", ")}.`,
      });
    }
    if (containsRequiresName && value.contains === true && !value.name) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contains"],
        message: "contains=true ist nur zusammen mit 'name' erlaubt.",
      });
    }
  });
}

const schemasByOperation: Partial<Record<SseApiOperation, AnyOperationSchema>> = {};
for (const [toolName, operation] of Object.entries(SSE_MCP_TOOL_OPERATIONS) as Array<[SseMcpToolName, SseApiOperation]>) {
  schemasByOperation[operation] ??= SSE_MCP_TOOL_SCHEMAS[toolName] as AnyOperationSchema;
}

schemasByOperation.tracked_set_value = requireCaseHashBinding(z.union([
  requireSelector(
    optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_change_field, "expectedCaseRef", "expectedCasePath"),
    "sse_change_field",
    ["name", "aid", "rid"],
    true,
  ),
  optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_change_known_field, "expectedCaseRef", "expectedCasePath"),
]) as AnyOperationSchema);
schemasByOperation.combo_select = requireCaseHashBinding(requireSelector(
  optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_combo_select, "expectedCaseRef", "expectedCasePath"),
  "sse_combo_select",
  ["name", "aid", "rid"],
  true,
));
schemasByOperation.toggle = requireCaseHashBinding(requireSelector(
  optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_toggle, "expectedCaseRef", "expectedCasePath"),
  "sse_toggle",
  ["name", "aid", "rid"],
  true,
));
schemasByOperation.find = requireSelector(SSE_MCP_TOOL_SCHEMAS.sse_find, "sse_find", ["name", "aid", "type"], true);
schemasByOperation.get_value = requireSelector(
  SSE_MCP_TOOL_SCHEMAS.sse_get_value, "sse_get_value", ["name", "aid", "rid"], true,
);
schemasByOperation.combo_options = requireSelector(
  SSE_MCP_TOOL_SCHEMAS.sse_combo_options, "sse_combo_options", ["name", "aid", "rid"], true,
);
schemasByOperation.vast_apply = withLegacyAlias(
  SSE_MCP_TOOL_SCHEMAS.sse_vast_apply,
  "expectedCaseRef",
  "expectedCasePath",
);
schemasByOperation.checker_detail = z.object({
  name: z.string().min(1).describe("Exakter Prueferhinweis aus checker_results"),
  hwnd: WINDOW_HANDLE.optional(),
}).strict();
schemasByOperation.click = z.object({
  ...SSE_MCP_TOOL_SCHEMAS.sse_click.shape,
  // Nur die direkte API versteht den historischen Wert noch, um ihn mit
  // einer klaren Migrationsmeldung abzuweisen. MCP bewirbt ihn nicht mehr.
  pattern: z.enum(SSE_API_CLICK_PATTERNS).optional().describe(
    "UIA-Aktionsmuster; toggle wird nur fuer eine klare Migrationsmeldung akzeptiert und danach gesperrt",
  ),
}).strict().superRefine((value, context) => {
  if (!value.name && !value.aid && !value.rid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sse_click braucht einen Bezeichner: name, aid oder rid.",
    });
  }
  if (value.pattern === "toggle") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pattern"],
      message: "Direktes TogglePattern ist gesperrt; Checkboxen mit sse_toggle setzen.",
    });
  }
  if (value.pattern === "select" && !value.aid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aid"],
      message: "pattern='select' verlangt eine exakte AutomationId (aid).",
    });
  }
});
schemasByOperation.click_point = SSE_MCP_TOOL_SCHEMAS.sse_click_point.superRefine((value, context) => {
  if (!value.name && !value.aid && !value.rid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sse_click_point braucht einen Bezeichner: name, aid oder rid.",
    });
  }
});
schemasByOperation.read_page = SSE_MCP_TOOL_SCHEMAS.sse_read_page.superRefine((value, context) => {
  if (value.minX !== undefined && value.maxX !== undefined && value.minX > value.maxX) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxX"],
      message: "maxX muss groesser oder gleich minX sein.",
    });
  }
});
const checkerReadOnlyClickSchema = extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_click_point, {
  checkerReadOnly: z.literal(true),
});
schemasByOperation.goto = z.object({
  name: z.string().optional().describe("Moderner Alias fuer die exakte Zielseitenueberschrift"),
  ziel: z.string().optional().describe("Exakte Zielseitenueberschrift; historischer API-Name"),
  maxSteps: GOTO_MAX_STEPS.optional(),
  direction: z.enum(["Weiter", "Zurück"]).optional().describe("Explizite lineare Suchrichtung"),
  useSearch: z.boolean().optional().describe("Moderne Option fuer die globale Qt-Suche; Vorgabe true"),
  viaSuche: z.boolean().optional().describe("Historischer Alias fuer useSearch"),
  hwnd: WINDOW_HANDLE.optional(),
}).strict().superRefine((value, context) => {
  if (value.name === undefined && value.ziel === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "'name' oder 'ziel' ist erforderlich." });
  }
  if (value.name !== undefined && value.ziel !== undefined && value.name !== value.ziel) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "'name' und 'ziel' widersprechen sich." });
  }
  if (value.useSearch !== undefined && value.viaSuche !== undefined && value.useSearch !== value.viaSuche) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "'useSearch' und 'viaSuche' widersprechen sich." });
  }
}).transform(({ name, useSearch, ...value }) => ({
  ...value,
  ziel: value.ziel ?? name,
  ...(value.viaSuche === undefined && useSearch !== undefined ? { viaSuche: useSearch } : {}),
})) as AnyOperationSchema;

schemasByOperation.workspace_file_list = z.object({
  ref: z.union([RESOURCE_REF(), BARE_RESOURCE_REF()]).optional()
    .describe("Bereichsreferenz oder relativer Pfad innerhalb von area"),
  area: RESOURCE_AREA.optional(),
  limit: z.number().int("'limit' muss eine ganze Zahl sein.").min(1).max(2000).optional()
    .describe("Maximale Zahl gelisteter Dateien; Vorgabe 500, Maximum 2000"),
  includeHashes: z.boolean().optional().describe("SHA256 berechnen; Vorgabe true"),
}).strict();
schemasByOperation.workspace_file_read_text = z.object({
  ref: z.union([RESOURCE_REF(), BARE_RESOURCE_REF()])
    .describe("Bereichsreferenz oder relativer Textdateipfad innerhalb von area"),
  area: RESOURCE_AREA.optional(),
}).strict();
schemasByOperation.workspace_file_write_text = z.object({
  ref: z.union([TEXT_WRITE_REF(), BARE_RESOURCE_REF()])
    .describe(
      "Neue Textdateireferenz (z. B. results:bericht.md) oder relativer Pfad innerhalb von area; " +
      "bei area='results' also 'bericht.md', nicht 'results/bericht.md'",
    ),
  area: API_TEXT_WRITE_AREA.optional(),
  text: z.string().describe("Vollstaendiger UTF-8-Inhalt der exklusiv neu anzulegenden Datei"),
}).strict();
schemasByOperation.scenario_run = z.object({
  scenarioRef: z.union([WORKSPACE_REF(), BARE_RESOURCE_REF()])
    .describe("Szenariodatei unter workspace: oder relativer Workspace-Pfad"),
  resultRef: z.union([RESULT_REF(), BARE_RESOURCE_REF()]).optional()
    .describe("Neue Ergebnisreferenz unter results: oder relativer Ergebnispfad"),
}).strict();

schemasByOperation.case_hash = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_case_hash, "ref", "path");
schemasByOperation.center_refresh = withLegacyAlias(
  SSE_MCP_TOOL_SCHEMAS.sse_center_refresh,
  "expectedDirectoryRef",
  "expectedDirectory",
);
schemasByOperation.window_close = z.object({
  pid: PROCESS_ID,
  hwnd: WINDOW_HANDLE,
  titleFingerprint: SHA256().optional(),
  expectedTitle: z.string().min(1).optional().describe("API-only exakter aktueller Fenstertitel statt Fingerprint"),
  waitMs: z.number().int().min(300).max(10000).optional().describe("Wartezeit auf das Schliessen in Millisekunden"),
}).strict().superRefine((value, context) => {
  if ((value.titleFingerprint === undefined) === (value.expectedTitle === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Genau eines von 'titleFingerprint' oder 'expectedTitle' muss angegeben werden.",
    });
  }
});
schemasByOperation.desktop_start = optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_desktop_start, "caseRef", "file");
schemasByOperation.launch = optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_launch, "caseRef", "file");
schemasByOperation.collect = optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_collect, "resultRef", "path");
schemasByOperation.export_csv = optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_export_csv, "resultRef", "dir");
schemasByOperation.verify = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_verify, "sourceRef", "from");
schemasByOperation.screenshot = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_screenshot, "resultRef", "path");
schemasByOperation.save = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_save, "caseRef", "expectedPath");
schemasByOperation.file_dialog_select = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_file_dialog_select, "resourceRef", "expectedPath");
schemasByOperation.receipt_manager_import = withLegacyAlias(
  SSE_MCP_TOOL_SCHEMAS.sse_receipt_manager_import,
  "resourceRef",
  "expectedPath",
);
schemasByOperation.save_as = withLegacyAliases(SSE_MCP_TOOL_SCHEMAS.sse_save_as, [
  ["sourceRef", "expectedSourcePath"], ["targetRef", "targetPath"],
]);
schemasByOperation.make_working_copy = withLegacyAliases(SSE_MCP_TOOL_SCHEMAS.sse_make_working_copy, [
  ["sourceRef", "source"], ["targetRef", "target"],
]);
schemasByOperation.backup_cases = withLegacyAlias(
  extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_backup_cases, { dir: API_LOCAL_PATH.optional() }),
  "destinationRef",
  "dest",
);
schemasByOperation.archive_cases = withLegacyAlias(
  extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_archive_cases, { dir: API_LOCAL_PATH.optional() }),
  "destinationRef",
  "dest",
);
schemasByOperation.list_cases = extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_list_cases, { dir: API_LOCAL_PATH.optional() });

for (const operation of SSE_API_OPERATIONS) {
  if (!schemasByOperation[operation]) throw new Error(`Kein API-Argumentschema fuer '${operation}'.`);
}

export const SSE_API_OPERATION_SCHEMAS = Object.freeze(
  schemasByOperation as Record<SseApiOperation, AnyOperationSchema>,
);

export const MAX_API_ARGUMENT_STRING_BYTES = 64 * 1024;
export const MAX_API_ARGUMENT_COLLECTION_ITEMS = 2_000;
export const MAX_API_ARGUMENT_DEPTH = 32;
export const MAX_API_ARGUMENT_NODES = 50_000;

function argumentLimitError(path: Array<string | number>, message: string): never {
  throw new z.ZodError([{ code: z.ZodIssueCode.custom, path, message }]);
}

export function assertApiArgumentBudget(
  operation: SseApiOperation,
  args: unknown,
  initialPath: Array<string | number> = [],
): void {
  let nodes = 0;
  const visit = (value: unknown, path: Array<string | number>, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_API_ARGUMENT_NODES) {
      argumentLimitError(path, `Operationsargumente duerfen hoechstens ${MAX_API_ARGUMENT_NODES} Werte enthalten.`);
    }
    if (depth > MAX_API_ARGUMENT_DEPTH) {
      argumentLimitError(path, `Operationsargumente duerfen hoechstens ${MAX_API_ARGUMENT_DEPTH} Ebenen tief sein.`);
    }
    if (typeof value === "string") {
      const limit = operation === "workspace_file_write_text" && path.length === 1 && path[0] === "text"
        ? MAX_WORKSPACE_TEXT_BYTES
        : MAX_API_ARGUMENT_STRING_BYTES;
      if (Buffer.byteLength(value) > limit) {
        argumentLimitError(path, `Zeichenkette ist groesser als ${limit} UTF-8-Bytes.`);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_API_ARGUMENT_COLLECTION_ITEMS) {
        argumentLimitError(path, `Liste darf hoechstens ${MAX_API_ARGUMENT_COLLECTION_ITEMS} Eintraege enthalten.`);
      }
      value.forEach((entry, index) => visit(entry, [...path, index], depth + 1));
      return;
    }
    if (!value || typeof value !== "object") return;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_API_ARGUMENT_COLLECTION_ITEMS) {
      argumentLimitError(path, `Objekt darf hoechstens ${MAX_API_ARGUMENT_COLLECTION_ITEMS} Felder enthalten.`);
    }
    entries.forEach(([key, entry]) => visit(entry, [...path, key], depth + 1));
  };
  visit(args, initialPath, initialPath.length);
}

export function parseApiOperationArgs(operation: SseApiOperation, args: Record<string, unknown>): Record<string, unknown> {
  const parsed = SSE_API_OPERATION_SCHEMAS[operation].parse(args);
  assertApiArgumentBudget(operation, parsed);
  return parsed;
}

export function parseCheckerReadOnlyClickArgs(args: Record<string, unknown>): Record<string, unknown> {
  const parsed = checkerReadOnlyClickSchema.parse(args);
  assertApiArgumentBudget("click_point", parsed);
  return parsed;
}

/** Alle Argumentnamen einer Operation, auch ueber Union-Zweige hinweg. */
function acceptedArgumentKeys(schema: unknown, keys = new Set<string>()): Set<string> {
  const def = (schema as { _def?: Record<string, unknown> } | undefined)?._def;
  if (!def) return keys;
  if (def.typeName === "ZodObject") {
    for (const key of Object.keys((schema as z.AnyZodObject).shape)) keys.add(key);
  } else if (def.typeName === "ZodUnion") {
    for (const option of def.options as unknown[]) acceptedArgumentKeys(option, keys);
  } else if (def.typeName === "ZodEffects") {
    acceptedArgumentKeys(def.schema, keys);
  } else if (def.typeName === "ZodIntersection") {
    acceptedArgumentKeys(def.left, keys);
    acceptedArgumentKeys(def.right, keys);
  }
  return keys;
}

function hasUnrecognizedKey(issues: readonly z.ZodIssue[]): boolean {
  return issues.some((issue) =>
    issue.code === z.ZodIssueCode.unrecognized_keys ||
    (issue.code === z.ZodIssueCode.invalid_union && issue.unionErrors.some((entry) => hasUnrecognizedKey(entry.issues))));
}

/**
 * Mit `operation` nennt die Meldung bei einem unbekannten Feld gleich die
 * erlaubten Namen. Ohne das kostet jeder Tippfehler eine zusaetzliche Runde
 * ueber `describe`, und genau diese Runde dreht ein Agent nicht immer.
 */
export function formatOperationArgumentError(error: z.ZodError, operation?: SseApiOperation): string {
  const containsCustomIssue = (issues: z.ZodIssue[]): boolean => issues.some((issue) =>
    issue.code === z.ZodIssueCode.custom ||
    (issue.code === z.ZodIssueCode.invalid_union && issue.unionErrors.some((entry) => containsCustomIssue(entry.issues))));
  const formatIssue = (issue: z.ZodIssue): string[] => {
    if (issue.code === z.ZodIssueCode.invalid_union) {
      const candidates = issue.unionErrors.map((unionError) => ({
        custom: containsCustomIssue(unionError.issues),
        messages: unionError.issues.flatMap(formatIssue),
      }));
      const preferred = candidates.some((candidate) => candidate.custom)
        ? candidates.filter((candidate) => candidate.custom)
        : candidates;
      const alternatives = preferred
        .map((candidate) => candidate.messages)
        .sort((left, right) => left.length - right.length || left.join("; ").length - right.join("; ").length);
      return alternatives[0] ?? [issue.message];
    }
    const path = issue.path.length ? `'${issue.path.join(".")}' ` : "";
    return [`${path}${issue.message}`];
  };
  const message = [...new Set(error.issues.flatMap(formatIssue))].join("; ");
  if (!operation || !hasUnrecognizedKey(error.issues)) return message;
  const erlaubt = [...acceptedArgumentKeys(SSE_API_OPERATION_SCHEMAS[operation])].sort();
  if (!erlaubt.length) return message;
  return `${message.replace(/\.$/u, "")}. Erlaubt sind: ${erlaubt.join(", ")}`;
}
