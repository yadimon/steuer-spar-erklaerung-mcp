import { z } from "zod";

export const SSE_START_MODES = [
  "einur", "normal", "einurvor", "fest", "ermaess", "vorweg",
] as const;
export const SSE_CLICK_PATTERNS = ["invoke", "select", "expand", "collapse"] as const;
export const SSE_API_CLICK_PATTERNS = [...SSE_CLICK_PATTERNS, "toggle"] as const;
export const SSE_DIALOG_BUTTONS = [
  "OK", "Ja", "Nein", "Abbrechen", "Schließen", "Schliessen", "Übernehmen", "Uebernehmen",
  "Speichern", "Nicht speichern", "Verwerfen", "Wiederholen", "Ignorieren",
  "Als gelesen markieren", "Jetzt ignorieren", "Wiederherstellen", "Datei neu zuordnen",
  "Klicken Sie hier, um Ihre Daten zu exportieren",
] as const;
export const SSE_START_MODE = z.enum(SSE_START_MODES).describe("Fachlicher SSE-Startmodus");
const WINDOWS_DEVICE_SEGMENT =
  "(?!(?:[^/]+/)*(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|" +
  "[Cc][Oo][Mm][1-9]|[Ll][Pp][Tt][1-9])(?:\\.[^/]*)?(?:/|$))";
const RESOURCE_PATH = WINDOWS_DEVICE_SEGMENT +
  "(?!(?:[\\\\/]|[A-Za-z]:))(?!\\.\\.(?:/|$))(?!.*\\/\\.\\.(?:/|$))[^\\\\:*?\"<>|\\x00-\\x1f]+";
export const RESOURCE_REF = () => z.string().regex(
  new RegExp(`^(?:cases|documents|workspace|results|backups):${RESOURCE_PATH}$`),
  "Ressourcenreferenz im Format bereich:relativer/pfad erwartet",
).describe("Maschinenneutrale Referenz bereich:relativer/pfad; kein PC-Pfad");
export const CASE_REF = () => z.string().regex(
  new RegExp(`^cases:${RESOURCE_PATH}$`),
  "Fallreferenz im Format cases:relativer/pfad erwartet",
).describe("Maschinenneutrale Falldateireferenz im Bereich cases:");
/**
 * Ziel einer verifizierten Falldateikopie.
 *
 * Zwei Zwecke, dieselbe gepruefte Mechanik: eine Arbeitskopie neben dem
 * Original in cases:, oder eine SICHERUNG in backups: vor einer Schreibaktion.
 * Der Bereich entscheidet die Rolle, nicht ein zweiter Codepfad.
 */
export const CASE_COPY_TARGET_REF = () => z.string().regex(
  new RegExp(`^(?:cases|backups):${RESOURCE_PATH}$`),
  "Zielreferenz im Format cases:relativer/pfad oder backups:relativer/pfad erwartet",
).describe("Ziel der verifizierten Kopie: cases: fuer eine Arbeitskopie, backups: fuer eine Sicherung");
export const RESULT_REF = () => z.string().regex(
  new RegExp(`^results:${RESOURCE_PATH}$`),
  "Ergebnisreferenz im Format results:relativer/pfad erwartet",
).describe("Maschinenneutrale Ergebnisreferenz im Bereich results:");
export const WORKSPACE_REF = () => z.string().regex(
  new RegExp(`^workspace:${RESOURCE_PATH}$`),
  "Arbeitsreferenz im Format workspace:relativer/pfad erwartet",
).describe("Maschinenneutrale Arbeitsreferenz im Bereich workspace:");
export const TEXT_WRITE_REF = () => z.string().regex(
  new RegExp(`^(?:workspace|results):${RESOURCE_PATH}$`),
  "Schreibreferenz im Bereich workspace: oder results: erwartet",
).describe("Neue Textdateireferenz im Bereich workspace: oder results:");
export const BACKUP_REF = () => z.string().regex(
  new RegExp(`^backups:${RESOURCE_PATH}$`),
  "Sicherungsreferenz im Format backups:relativer/pfad erwartet",
).describe("Maschinenneutrale Sicherungsreferenz im Bereich backups:");
export const BARE_RESOURCE_REF = () => z.string().regex(
  new RegExp(`^${RESOURCE_PATH}$`),
  "Normalisierter relativer Ressourcenpfad ohne Bereich erwartet",
).describe("Relativer Ressourcenpfad ohne Bereich und ohne PC-Bezug");
export const VERIFY_SOURCE_REF = () => z.string().regex(
  new RegExp(`^(?:results|workspace):${RESOURCE_PATH}$`),
  "Quellreferenz im Bereich results: oder workspace: erwartet",
).describe("Referenz einer vorhandenen JSON-Quelle unter results: oder workspace:");
export const SHA256 = () => z.string()
  .regex(/^[A-Fa-f0-9]{64}$/, "64-stelliger SHA256 in Hexadezimalform erwartet")
  .describe("64-stelliger SHA256-Fingerprint in Hexadezimalform");
export const SSE_OPERATION_LIMITS = Object.freeze({
  windowHandleMax: Number.MAX_SAFE_INTEGER,
  processIdMax: 2_147_483_647,
  uiWaitMs: Object.freeze({ min: 100, max: 10_000 }),
  occurrence: 1_000,
  coordinateAbsolute: 1_000_000,
  gotoSteps: 200,
  tableRows: 1_000,
  snapshotNodes: 5_000,
  snapshotTypes: 50,
  tableValues: 100,
  verifyExpectations: 500,
  vastPlan: 500,
  readbackChecks: 100,
  resultLabels: 500,
  archiveCases: 2_000,
});
export const WINDOW_HANDLE = z.number().int("hwnd muss eine ganze Zahl sein.").positive()
  .max(SSE_OPERATION_LIMITS.windowHandleMax).describe("Exaktes Windows-Fensterhandle aus einem frischen SSE-Readback");
export const PROCESS_ID = z.number().int("pid muss eine ganze Zahl sein.").positive()
  .max(SSE_OPERATION_LIMITS.processIdMax).describe("Exakte SSE-Prozess-ID aus einem frischen Start- oder Fenster-Readback");
export const UI_WAIT_MS = z.number().int("Wartezeit muss eine ganze Zahl sein.")
  .min(SSE_OPERATION_LIMITS.uiWaitMs.min).max(SSE_OPERATION_LIMITS.uiWaitMs.max)
  .describe("Wartezeit nach der UI-Aktion in Millisekunden");
export const UI_OCCURRENCE = z.number().int("Vorkommen muss eine ganze Zahl sein.").min(1)
  .max(SSE_OPERATION_LIMITS.occurrence).describe("1-basierte Position bei mehreren gleich benannten Treffern");
export const UI_COORDINATE = z.number().int("Koordinate muss eine ganze Zahl sein.")
  .min(-SSE_OPERATION_LIMITS.coordinateAbsolute).max(SSE_OPERATION_LIMITS.coordinateAbsolute)
  .describe("Absolute virtuelle Windows-Bildschirmkoordinate");
export const GOTO_MAX_STEPS = z.number().int("maxSteps muss eine ganze Zahl sein.").min(1)
  .max(SSE_OPERATION_LIMITS.gotoSteps).describe("Harte Obergrenze der Navigationsschritte");
export const TABLE_MAX_ROWS = z.number().int("maxRows muss eine ganze Zahl sein.").min(1)
  .max(SSE_OPERATION_LIMITS.tableRows).describe("Harte Obergrenze der zu lesenden Tabellenzeilen");
export const SNAPSHOT_MAX_NODES = z.number().int("maxNodes muss eine ganze Zahl sein.").min(1)
  .max(SSE_OPERATION_LIMITS.snapshotNodes).describe("Harte Obergrenze der UIA-Knoten im Snapshot");
export const USTVA_PERIOD_KEY = () => z.enum([
  "monthly", "quarterly",
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
  "q1", "q2", "q3", "q4",
]).describe("UStVA-Frequenz, Monat oder Quartal als stabiler semantischer Schluessel");
