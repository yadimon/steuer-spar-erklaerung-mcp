import { z } from "zod";
import {
  SSE_START_MODE,
  RESOURCE_REF,
  CASE_REF,
  BACKUP_REF,
  SHA256,
  SSE_OPERATION_LIMITS,
  WINDOW_HANDLE,
  PROCESS_ID,
} from "./operation-schema-primitives.js";

export const SSE_MCP_LIFECYCLE_SCHEMAS = {
  "sse_launch": z.object({
    caseRef: CASE_REF().optional().describe(
      "Falldatei, z. B. cases:arbeitskopie.Gew2025 oder im Profil 2025 cases:ustva.GewErfass2026",
    ),
    mode: SSE_START_MODE
      .optional()
      .describe(
        "Startmodus: normal=Einkommensteuer, einur=Gewinnermittlung/EUER (Vorgabe), " +
        "einurvor=Gewinn-Erfassung des Folgejahres; bei einer .ESt-Datei immer normal explizit setzen",
      ),
    exe: z.never().optional().describe("Nicht zulaessig; wird ausschliesslich in der lokalen API konfiguriert"),
  }).strict(),
  "sse_save": z.object({
    caseRef: CASE_REF().describe("Exakte Referenz des aktuell geoeffneten Steuerfalls"),
    expectedHashBefore: SHA256().describe("SHA256 der Datei unmittelbar vor dem Speichern"),
    hwnd: WINDOW_HANDLE.optional().describe("Exaktes SSE-Hauptfenster; bei mehreren offenen Steuerfaellen Pflicht"),
    waitMs: z.number().int().min(800).max(30000).optional().describe("Wartezeit auf Datei- und Hash-Readback"),
  }).strict(),
  "sse_file_dialog_select": z.object({
    expectedDialogTitle: z.string().describe("Exakter Titel des bereits offenen nativen Windows-Dateidialogs"),
    resourceRef: RESOURCE_REF(),
    expectedHash: SHA256().optional().describe("Optionaler exakter SHA256 der auszuwaehlenden Datei"),
    waitMs: z.number().int().min(500).max(30000).optional().describe("Wartezeit auf Dialog- und Datei-Readback"),
  }).strict(),
  "sse_save_as": z.object({
    sourceRef: CASE_REF(),
    expectedSourceHash: SHA256(),
    targetRef: CASE_REF(),
    waitMs: z.number().int().min(800).max(30000).optional().describe("Wartezeit auf Ziel-, Hash- und Fenstertitel-Readback"),
  }).strict(),
  "sse_close": z.object({
    force: z.boolean().optional().describe("Nur die gebundene PID bei Haenger oder bewusstem Hart-Stopp beenden"),
    save: z.boolean().optional().describe("Veraltet und gesperrt: stattdessen zuerst sse_save hashgebunden aufrufen"),
    discardChanges: z.boolean().optional().describe("Explizite Erlaubnis, ungespeicherte Aenderungen zu verwerfen."),
    hwnd: WINDOW_HANDLE.optional().describe("Exaktes SSE-Hauptfenster; bei mehreren Instanzen Pflicht"),
    pid: PROCESS_ID.optional().describe("Exakte SSE-PID; bei mehreren Instanzen Pflicht"),
  }).strict(),
  "sse_list_cases": z.object({
    includeBackups: z.boolean().optional().describe("Backup-/Sicherungsdateien zusaetzlich auflisten; Vorgabe false"),
    verbose: z.boolean().optional().describe("Alle Kopffelder mitliefern (umfangreich)"),
  }).strict(),
  "sse_backup_cases": z.object({
    destinationRef: BACKUP_REF().describe("Neuer Sicherungsordner im lokal konfigurierten Backupbereich"),
  }).strict(),
  "sse_archive_cases": z.object({
    destinationRef: BACKUP_REF().describe("Neuer Archivordner im lokal konfigurierten Backupbereich"),
    cases: z.array(z.object({
      name: z.string().describe("Exakter Dateiname im aktiven Fallordner"), expectedSha256: SHA256(),
    }).strict()).min(1)
      .max(SSE_OPERATION_LIMITS.archiveCases).describe("Exakte zu verschiebende Fallnamen und aktuelle SHA256"),
    expectedRemaining: z.array(z.object({
      name: z.string().describe("Exakter Dateiname des erwarteten Restbestands"), expectedSha256: SHA256(),
    }).strict()).min(1)
      .max(SSE_OPERATION_LIMITS.archiveCases).describe("Vollstaendiger erwarteter Restbestand nach dem Archivieren"),
  }).strict(),
  "sse_make_working_copy": z.object({
    sourceRef: CASE_REF(),
    targetRef: CASE_REF(),
    expectedSourceHash: SHA256(),
  }).strict(),
} as const;
