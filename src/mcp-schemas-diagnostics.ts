import { z } from "zod";
import {
  RESOURCE_REF,
  CASE_REF,
  RESULT_REF,
  WORKSPACE_REF,
  TEXT_WRITE_REF,
  SHA256,
  SSE_OPERATION_LIMITS,
  WINDOW_HANDLE,
  PROCESS_ID,
  UI_OCCURRENCE,
  SSE_DIALOG_BUTTONS,
} from "./operation-schema-primitives.js";

export const SSE_MCP_DIAGNOSTIC_SCHEMAS = {
  "sse_product_info": z.object({}).strict(),
  "sse_capabilities": z.object({}).strict(),
  "sse_page_objects": z.object({
    pageId: z.string().optional().describe("Stabile pageId aus dem Page-Object-Katalog; ohne Angabe alle Seiten"),
  }).strict(),
  "sse_page_state": z.object({
    pageId: z.string().describe("Stabile pageId der erwarteten katalogisierten Seite"),
    hwnd: WINDOW_HANDLE.optional(),
    pid: PROCESS_ID.optional(),
  }).strict(),
  "sse_workspace_status": z.object({}).strict(),
  "sse_workspace_files": z.object({
    ref: RESOURCE_REF().optional().describe("Bereich und Unterordner; Vorgabe workspace:."),
    limit: z.number().int("'limit' muss eine ganze Zahl sein.").min(1).max(2000).optional()
      .describe("Maximale Zahl gelisteter Dateien; Vorgabe 500, Maximum 2000"),
    includeHashes: z.boolean().optional().describe("SHA256 berechnen; Vorgabe true, false fuer besonders schnelle Listen"),
  }).strict(),
  "sse_workspace_read_text": z.object({
    ref: RESOURCE_REF(),
  }).strict(),
  "sse_workspace_write_text": z.object({
    ref: TEXT_WRITE_REF(),
    text: z.string().describe("Vollstaendiger UTF-8-Inhalt der exklusiv neu anzulegenden Textdatei"),
  }).strict(),
  "sse_run_scenario": z.object({
    scenarioRef: WORKSPACE_REF(),
    resultRef: RESULT_REF().optional(),
  }).strict(),
  "sse_health": z.object({}).strict(),
  "sse_instances": z.object({
    includeHash: z.boolean().optional()
      .describe("SHA256 jeder gebundenen Falldatei mitlesen; Vorgabe false, weil es zusaetzliche Datei-E/A kostet"),
  }).strict(),
  "sse_windows": z.object({
    process: z.enum(["SSE", "SteuertippsCenter"]).optional().describe("Vorgabe 'SSE'; optional 'SteuertippsCenter' fuer die Fallauswahl"),
  }).strict(),
  "sse_center_cases": z.object({
    hwnd: WINDOW_HANDLE.optional().describe("Exaktes Fenster des Steuertipps-Centers; bei mehreren Fenstern Pflicht"),
  }).strict(),
  "sse_center_refresh": z.object({
    hwnd: WINDOW_HANDLE,
    expectedDirectoryRef: CASE_REF().optional()
      .describe("Im Modus 'Verzeichnis': vom vorigen sse_center_cases gelieferte verzeichnisRef"),
    expectedMode: z.literal("Zuletzt verwendet").optional()
      .describe("Im Modus 'Zuletzt verwendet': exakt dieser vom vorigen sse_center_cases gelieferte Modus"),
  }).strict(),
  "sse_window_close": z.object({
    pid: PROCESS_ID.describe("Vom vorigen sse_windows gelieferte PID desselben SSE-Fensters"),
    hwnd: WINDOW_HANDLE,
    titleFingerprint: SHA256().describe("Vom vorigen sse_windows gelieferter Fingerprint des exakten Titels"),
    waitMs: z.number().int().min(300).max(10000).optional().describe("Wartezeit auf das Schliessen in Millisekunden"),
  }).strict(),
  "sse_window_restore": z.object({
    pid: PROCESS_ID.describe("Vom vorigen sse_windows gelieferte PID des minimierten SSE-Hauptfensters"),
    hwnd: WINDOW_HANDLE.describe("Vom vorigen sse_windows geliefertes exaktes SSE-Hauptfenster"),
    titleFingerprint: SHA256().describe("Vom vorigen sse_windows gelieferter Fingerprint des exakten Hauptfenstertitels"),
    waitMs: z.number().int().min(300).max(10000).optional().describe("Wartezeit auf den nicht-minimierten Readback in Millisekunden"),
  }).strict(),
  "sse_case_hash": z.object({ ref: CASE_REF().describe("Falldatei innerhalb des lokal konfigurierten Fallbereichs") }).strict(),
  "sse_dialog_list": z.object({
    pid: PROCESS_ID.optional().describe("Optional nur Fenster der zuvor gestarteten SSE-PID inventarisieren"),
  }).strict(),
  "sse_dialog_answer": z.object({
    hwnd: WINDOW_HANDLE,
    fingerprint: SHA256(),
    bodyFingerprint: SHA256().optional().describe("Bei automatischen Pruefhinweisen Pflicht; bindet auch den OCR-Fliesstext"),
    button: z.enum(SSE_DIALOG_BUTTONS).describe("Exakter freigegebener Buttonname aus sse_dialog_list"),
    waitMs: z.number().int().min(200).max(10000).optional().describe("Wartezeit auf den Dialog-Readback in Millisekunden"),
  }).strict(),
  "sse_warning_popup_read": z.object({
    hwnd: WINDOW_HANDLE.optional().describe("Optionales SSE-Hauptfenster zur PID-Bindung oder exaktes Warnfenster"),
    ocr: z.boolean().optional().describe("Fliesstext per lokaler Windows-OCR lesen; Vorgabe true"),
    includeImage: z.boolean().optional().describe("Kontrollbild mitsenden; Vorgabe false"),
  }).strict(),
  "sse_vast_dialog_read": z.object({ hwnd: WINDOW_HANDLE.optional().describe("Exaktes VaSt-Dialogfenster; bei Eindeutigkeit optional") }).strict(),
  "sse_vast_row_details": z.object({
    hwnd: WINDOW_HANDLE.optional(),
    mappingFingerprint: SHA256(),
    certificate: z.string().describe("Exakte Bescheinigungsbeschriftung aus sse_vast_dialog_read"),
    occurrence: UI_OCCURRENCE.optional(),
  }).strict(),
  "sse_vast_row_set_expanded": z.object({
    hwnd: WINDOW_HANDLE.optional(), mappingFingerprint: SHA256(),
    certificate: z.string().describe("Exakte Bescheinigungsbeschriftung"),
    occurrence: UI_OCCURRENCE.optional(),
    expectedBefore: z.boolean().describe("Exakt erwarteter aktueller Aufklappzustand"),
    expanded: z.boolean().describe("Gewuenschter Aufklappzustand"),
  }).strict(),
  "sse_vast_mapping_options": z.object({
    hwnd: WINDOW_HANDLE.optional(), mappingFingerprint: SHA256(),
    certificate: z.string().describe("Exakte Bescheinigungsbeschriftung"),
    occurrence: UI_OCCURRENCE.optional(),
    expectedCurrent: z.string().describe("Exakt erwartetes aktuelles lokales Zuordnungsziel"),
  }).strict(),
  "sse_vast_mapping_select": z.object({
    hwnd: WINDOW_HANDLE.optional(), mappingFingerprint: SHA256(),
    certificate: z.string().describe("Exakte Bescheinigungsbeschriftung"),
    occurrence: UI_OCCURRENCE.optional(),
    expectedCurrent: z.string().describe("Exakt erwartetes aktuelles lokales Zuordnungsziel"),
    value: z.string().describe("Stabiler Wert des neu auszuwaehlenden lokalen Zuordnungsziels"),
    optionText: z.string().optional().describe("Nur falls OCR den sichtbaren Listentext anders liest als UIA, z. B. 1/l"),
    expectedAfter: z.string().describe("Exakter OCR-Readback nach der Auswahl"),
  }).strict(),
  "sse_vast_apply": z.object({
    hwnd: WINDOW_HANDLE.describe("Exaktes VaSt-Dialog-HWND"),
    expectedMainHwnd: WINDOW_HANDLE.describe("Exaktes zugehöriges SSE-Hauptfenster"),
    expectedCaseRef: CASE_REF().describe("Exakte Referenz des geöffneten Steuerfalls"),
    expectedCaseHash: SHA256().describe("Aktueller Disk-SHA256 vor dem ungespeicherten Merge"),
    mappingFingerprint: SHA256(),
    plan: z.array(z.object({
      certificate: z.string().describe("Exakte Bescheinigungsbeschriftung der Zeile"),
      occurrence: UI_OCCURRENCE,
      localTarget: z.string().describe("Exaktes lokales Ziel aus dem gebundenen Mapping-Readback"),
    }).strict()).min(1).max(SSE_OPERATION_LIMITS.vastPlan).describe("Alle sichtbaren Zeilen in exakt der von sse_vast_dialog_read gelieferten Reihenfolge"),
    acknowledgeApply: z.literal(true).describe("Einmalige Bestätigung für genau diesen lokalen Merge"),
    waitMs: z.number().int().min(500).max(15000).optional().describe("Wartezeit auf den VaSt-Merge-Readback in Millisekunden"),
  }).strict(),
} as const;
