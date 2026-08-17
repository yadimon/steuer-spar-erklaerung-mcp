import { z } from "zod";
import { SSE_API_OPERATIONS, type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { MUTATION_OPERATION_RESULT_FIELDS } from "./result-mutation-fields.js";
import { UTILITY_OPERATION_RESULT_FIELDS } from "./result-utility-fields.js";
import {
  CLICK_RESULT_FIELDS,
  OPTIONAL_ARRAY,
  OPTIONAL_BOOLEAN,
  OPTIONAL_CASE_LIST,
  OPTIONAL_NON_NEGATIVE_NUMBER,
  OPTIONAL_OBJECT,
  OPTIONAL_SHA256,
  OPTIONAL_STRING,
  OPTIONAL_STRING_ARRAY,
  OPTIONAL_STRING_OR_BOOLEAN,
  OPTIONAL_TRANSMISSION_STATE,
} from "./result-schema-types.js";

export const SSE_API_RESULT_SCHEMA_VERSION = 1;

/**
 * Typisiert bewusst stabile, transportrelevante Felder. Die Worker-Antworten
 * bleiben erweiterbar; neue fachliche Felder gehen daher nicht verloren.
 * Jedes Feld ist optional, weil erfolgreiche No-op-/Nicht-laufend-Zustaende
 * je Operation kleinere, aber weiterhin gueltige Varianten besitzen koennen.
 */
const CORE_OPERATION_RESULT_FIELDS = {
  capabilities: {
    transport: OPTIONAL_OBJECT,
    safety: OPTIONAL_OBJECT,
    profile: OPTIONAL_OBJECT,
    operationPolicy: OPTIONAL_OBJECT,
    buildDriftPolicy: OPTIONAL_STRING,
  },
  product_info: {
    profileId: OPTIONAL_STRING,
    profileStatus: OPTIONAL_STRING,
    operationAccess: OPTIONAL_STRING,
    product: OPTIONAL_STRING,
    taxYear: OPTIONAL_NON_NEGATIVE_NUMBER,
    buildDrift: OPTIONAL_OBJECT,
  },
  health: { running: OPTIONAL_BOOLEAN, buildDrift: OPTIONAL_OBJECT, windows: OPTIONAL_ARRAY },
  windows: { windows: OPTIONAL_ARRAY },
  list_cases: {
    dir: OPTIONAL_STRING,
    cases: OPTIONAL_CASE_LIST,
    count: OPTIONAL_NON_NEGATIVE_NUMBER,
    parserError: OPTIONAL_STRING,
  },
  case_hash: {
    path: OPTIONAL_STRING,
    exists: OPTIONAL_BOOLEAN,
    size: OPTIONAL_NON_NEGATIVE_NUMBER,
    mtimeUtc: OPTIONAL_STRING,
    sha256: OPTIONAL_SHA256,
    header: OPTIONAL_OBJECT,
    transmitted: OPTIONAL_TRANSMISSION_STATE,
    transmittedReason: OPTIONAL_STRING,
  },
  workspace_status: {
    profileId: OPTIONAL_STRING,
    configurationFingerprint: OPTIONAL_STRING,
    workspaceReady: OPTIONAL_BOOLEAN,
    resultAreaReady: OPTIONAL_BOOLEAN,
    caseDirectoryConfigured: OPTIONAL_BOOLEAN,
    caseDirectoryReady: OPTIONAL_BOOLEAN,
    documentAreaReady: OPTIONAL_BOOLEAN,
    backupAreaReady: OPTIONAL_BOOLEAN,
    sseExecutableConfigured: OPTIONAL_BOOLEAN,
  },
  workspace_file_list: { files: OPTIONAL_ARRAY },
  workspace_file_read_text: { text: OPTIONAL_STRING, sha256: OPTIONAL_STRING },
  workspace_file_write_text: { ref: OPTIONAL_STRING, sha256: OPTIONAL_STRING, bytes: OPTIONAL_NON_NEGATIVE_NUMBER },
  page: { ueberschrift: OPTIONAL_STRING },
  known_page_state: {
    pageId: OPTIONAL_STRING,
    expectedHeading: OPTIONAL_STRING,
    onExpectedPage: OPTIONAL_BOOLEAN,
    heading: OPTIONAL_STRING,
    dirty: OPTIONAL_BOOLEAN,
    fields: OPTIONAL_ARRAY,
    // Inhaltsfingerprint der gelesenen Seite, kein Zaehler: Er wechselt genau
    // dann, wenn sich Ueberschrift, Feldwerte oder Aenderungszustand bewegen.
    epoch: OPTIONAL_STRING,
    privateValuesPersisted: OPTIONAL_BOOLEAN,
  },
  read_page: { heading: OPTIONAL_STRING, bounds: OPTIONAL_OBJECT, lines: OPTIONAL_ARRAY, stats: OPTIONAL_OBJECT },
  read_full: {
    ueberschrift: OPTIONAL_STRING,
    gerollt: OPTIONAL_BOOLEAN,
    stufen: OPTIONAL_NON_NEGATIVE_NUMBER,
    anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
    zeilen: OPTIONAL_ARRAY,
  },
  read_table: {
    headers: OPTIONAL_ARRAY,
    rows: OPTIONAL_ARRAY,
    rowCount: OPTIONAL_NON_NEGATIVE_NUMBER,
    ausgeschlosseneFenster: OPTIONAL_ARRAY,
    stats: OPTIONAL_OBJECT,
    incomplete: OPTIONAL_BOOLEAN,
  },
  collect: {
    vollstaendig: OPTIONAL_BOOLEAN,
    stopKind: OPTIONAL_STRING,
    stopReason: OPTIONAL_STRING,
    anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
    ueberschriften: OPTIONAL_ARRAY,
    seiten: OPTIONAL_ARRAY,
    currentHeadingAfter: OPTIONAL_STRING,
    advancedAfterLastCaptured: OPTIONAL_BOOLEAN,
  },
  verify: {
    vergleichOk: OPTIONAL_BOOLEAN,
    sourceHash: OPTIONAL_SHA256,
    sourceHashBefore: OPTIONAL_SHA256,
    sourceHashAfter: OPTIONAL_SHA256,
    sourceVollstaendig: OPTIONAL_BOOLEAN,
    sourceStopKind: OPTIONAL_STRING,
    sourceStopReason: OPTIONAL_STRING,
    geprueft: OPTIONAL_NON_NEGATIVE_NUMBER,
    abweichungen: OPTIONAL_NON_NEGATIVE_NUMBER,
    ergebnis: OPTIONAL_ARRAY,
    zusammenfassung: OPTIONAL_STRING,
  },
  // 'summe' ist der gelesene Wert der gebundenen Kontrollsumme. Ohne ihn
  // koennte ein Aufrufer die Pflichtangaben expectedBefore/expectedAfter der
  // Tabellenmutationen nicht ermitteln; er bleibt null, wenn kein sumLabel
  // angegeben wurde.
  table_read: {
    zeilen: OPTIONAL_ARRAY,
    vollstaendig: OPTIONAL_BOOLEAN,
    anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
    summe: OPTIONAL_STRING,
  },
  result_details: { zeilen: OPTIONAL_ARRAY, vollstaendig: OPTIONAL_BOOLEAN, anzahl: OPTIONAL_NON_NEGATIVE_NUMBER },
  snapshot: { nodes: OPTIONAL_ARRAY, count: OPTIONAL_NON_NEGATIVE_NUMBER, stats: OPTIONAL_OBJECT },
  snapshot_compare: {
    equivalent: OPTIONAL_BOOLEAN,
    runtimeIdChurnCount: OPTIONAL_NON_NEGATIVE_NUMBER,
    missingCount: OPTIONAL_NON_NEGATIVE_NUMBER,
    extraCount: OPTIONAL_NON_NEGATIVE_NUMBER,
    metadataMismatchCount: OPTIONAL_NON_NEGATIVE_NUMBER,
    valueMismatchCount: OPTIONAL_NON_NEGATIVE_NUMBER,
  },
  checker_results: {
    aktiv: OPTIONAL_BOOLEAN,
    konsistent: OPTIONAL_BOOLEAN,
    gesamt: OPTIONAL_NON_NEGATIVE_NUMBER,
    fragenWarnungen: OPTIONAL_ARRAY,
    tippsZusatzinfos: OPTIONAL_ARRAY,
    sonstige: OPTIONAL_ARRAY,
    aufgeklappt: OPTIONAL_ARRAY,
  },
  checker_run: { gesamt: OPTIONAL_NON_NEGATIVE_NUMBER, konsistent: OPTIONAL_BOOLEAN },
  click: CLICK_RESULT_FIELDS,
  checker_open: { meldung: OPTIONAL_STRING, text: OPTIONAL_STRING, ocrOk: OPTIONAL_BOOLEAN },
  warning_popup_read: { active: OPTIONAL_BOOLEAN, title: OPTIONAL_STRING, text: OPTIONAL_STRING },
  screenshot: {
    shot: z.object({
      path: z.string().describe("Maschinenlokale Ergebnisreferenz oder interner Pfad"),
      w: z.number().finite().nonnegative().describe("Bildbreite"),
      h: z.number().finite().nonnegative().describe("Bildhoehe"),
    }).passthrough().nullable().optional().describe("Metadaten des erzeugten Kontrollbilds"),
  },
  goto: { erreicht: OPTIONAL_BOOLEAN, ueberschrift: OPTIONAL_STRING, weg: OPTIONAL_ARRAY },
  launch: { pid: OPTIONAL_NON_NEGATIVE_NUMBER, instance: OPTIONAL_OBJECT, ready: OPTIONAL_BOOLEAN },
  close: { stillRunning: OPTIONAL_BOOLEAN, killed: OPTIONAL_BOOLEAN },
  desktop_start: { pid: OPTIONAL_NON_NEGATIVE_NUMBER, desktop: OPTIONAL_STRING },
  desktop_status: {
    aktiv: OPTIONAL_BOOLEAN,
    desktop: OPTIONAL_STRING,
    sseLaeuft: OPTIONAL_BOOLEAN,
    markeVeraltet: OPTIONAL_BOOLEAN,
  },
  desktop_stop: { hartBeendet: OPTIONAL_BOOLEAN, desktopMarkeEntfernt: OPTIONAL_BOOLEAN },
  dialog_list: { dialogs: OPTIONAL_ARRAY, windows: OPTIONAL_ARRAY, count: OPTIONAL_NON_NEGATIVE_NUMBER },
  dialog_answer: { closed: OPTIONAL_BOOLEAN, answered: OPTIONAL_STRING_OR_BOOLEAN },
  ui_state: { running: OPTIONAL_BOOLEAN, heading: OPTIONAL_STRING, blockiert: OPTIONAL_BOOLEAN },
  ustva_read: { page: OPTIONAL_STRING, periods: OPTIONAL_ARRAY },
  scenario_run: { steps: OPTIONAL_ARRAY, resultRef: OPTIONAL_STRING, sha256: OPTIONAL_STRING },
  make_working_copy: {
    copied: OPTIONAL_BOOLEAN,
    source: OPTIONAL_STRING,
    target: OPTIONAL_STRING,
    sourceHash: OPTIONAL_SHA256,
    targetHash: OPTIONAL_SHA256,
    verified: OPTIONAL_BOOLEAN,
    header: OPTIONAL_OBJECT,
    transmitted: OPTIONAL_TRANSMISSION_STATE,
    sourceBefore: OPTIONAL_SHA256,
    sourceAfter: OPTIONAL_SHA256,
    targetStillOwned: OPTIONAL_BOOLEAN,
    rolledBack: OPTIONAL_BOOLEAN,
  },
  backup_cases: {
    dest: OPTIONAL_STRING,
    anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
    files: OPTIONAL_ARRAY,
    hashes: OPTIONAL_ARRAY,
    manifest: OPTIONAL_STRING,
    verified: OPTIONAL_BOOLEAN,
    copiedBeforeFailure: OPTIONAL_NON_NEGATIVE_NUMBER,
    rolledBack: OPTIONAL_BOOLEAN,
    retainedTargets: OPTIONAL_STRING_ARRAY,
    backupStillExists: OPTIONAL_BOOLEAN,
  },
  archive_cases: {
    archived: OPTIONAL_NON_NEGATIVE_NUMBER,
    dest: OPTIONAL_STRING,
    files: OPTIONAL_ARRAY,
    remaining: OPTIONAL_ARRAY,
    manifest: OPTIONAL_STRING,
    verified: OPTIONAL_BOOLEAN,
    recoverable: OPTIONAL_BOOLEAN,
    movedBeforeFailure: OPTIONAL_NON_NEGATIVE_NUMBER,
    rolledBack: OPTIONAL_BOOLEAN,
    rollbackFiles: OPTIONAL_ARRAY,
    recoveryFiles: OPTIONAL_STRING_ARRAY,
    retainedTargets: OPTIONAL_STRING_ARRAY,
    archiveStillExists: OPTIONAL_BOOLEAN,
  },
} as const satisfies Partial<Record<SseApiOperation, z.ZodRawShape>>;

const RESULT_FIELD_TABLES = [
  CORE_OPERATION_RESULT_FIELDS,
  MUTATION_OPERATION_RESULT_FIELDS,
  UTILITY_OPERATION_RESULT_FIELDS,
] as const;
const duplicateOperations = RESULT_FIELD_TABLES
  .flatMap((table) => Object.keys(table))
  .filter((operation, index, operations) => operations.indexOf(operation) !== index);
if (duplicateOperations.length > 0) {
  throw new Error(`Doppelte Operations-Ergebnisvertraege: ${[...new Set(duplicateOperations)].join(", ")}`);
}
const OPERATION_RESULT_FIELDS = Object.freeze(Object.assign({}, ...RESULT_FIELD_TABLES)) as
  Partial<Record<SseApiOperation, z.ZodRawShape>>;

function createOperationResultOutputSchema(operation: SseApiOperation): z.AnyZodObject {
  const operationFields = OPERATION_RESULT_FIELDS[operation as keyof typeof OPERATION_RESULT_FIELDS] ?? {};
  return z.object({
    ok: z.boolean().describe("Operation erfolgreich"),
    kind: z.string().min(1).nullable().optional().describe("Fehlerart"),
    error: z.string().min(1).nullable().optional().describe("Fehlermeldung"),
    ms: z.number().finite().nonnegative().nullable().optional().describe("Worker-Laufzeit in ms"),
    ...operationFields,
  }).passthrough().describe(`Result_${operation} Version ${SSE_API_RESULT_SCHEMA_VERSION}`);
}

export const SSE_API_RESULT_OUTPUT_SCHEMAS = Object.freeze(Object.fromEntries(
  SSE_API_OPERATIONS.map((operation) => [operation, createOperationResultOutputSchema(operation)]),
) as Record<SseApiOperation, z.AnyZodObject>);

function createOperationResultSchema(operation: SseApiOperation): z.ZodType<WorkerResult> {
  return SSE_API_RESULT_OUTPUT_SCHEMAS[operation].superRefine((result, context) => {
    if (result.ok === false) {
      if (typeof result.kind !== "string" || !result.kind) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "Fehlerergebnis braucht kind." });
      }
      if (typeof result.error !== "string" || !result.error) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "Fehlerergebnis braucht error." });
      }
    }
  }) as unknown as z.ZodType<WorkerResult>;
}

export const SSE_API_RESULT_SCHEMAS = Object.freeze(Object.fromEntries(
  SSE_API_OPERATIONS.map((operation) => [operation, createOperationResultSchema(operation)]),
) as Record<SseApiOperation, z.ZodType<WorkerResult>>);

export function parseApiOperationResult(operation: SseApiOperation, value: unknown): WorkerResult {
  return SSE_API_RESULT_SCHEMAS[operation].parse(value);
}
