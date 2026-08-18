import { z } from "zod";
import {
  SSE_START_MODE,
  CASE_REF,
  RESULT_REF,
  VERIFY_SOURCE_REF,
  SHA256,
  SSE_OPERATION_LIMITS,
  WINDOW_HANDLE,
  UI_OCCURRENCE,
} from "./operation-schema-primitives.js";

export const SSE_MCP_DESKTOP_SCHEMAS = {
  "sse_desktop_start": z.object({
    caseRef: CASE_REF().optional().describe("Falldatei innerhalb des lokal konfigurierten Fallbereichs"),
    mode: SSE_START_MODE.optional().describe("Startmodus, Vorgabe 'einur' (Gewinnermittlung)"),
    name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().describe("Desktopname aus ASCII-Buchstaben, Ziffern, _ oder -, Vorgabe 'SSEAuto'"),
    timeoutSec: z.number().int().min(3).max(90).optional().describe("Startwartezeit in Sekunden, Vorgabe 30"),
    exe: z.never().optional().describe("Nicht zulaessig; wird ausschliesslich in der lokalen API konfiguriert"),
  }).strict(),
  "sse_desktop_stop": z.object({
    save: z.boolean().optional().describe("Veraltet und gesperrt: stattdessen zuerst sse_save hashgebunden aufrufen"),
    discardChanges: z.boolean().optional().describe("Explizite Erlaubnis, ungespeicherte Aenderungen zu verwerfen und notfalls die eigene PID hart zu beenden"),
  }).strict(),
  "sse_desktop_status": z.object({}).strict(),
  "sse_page": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_positions": z.object({
    aktion: z.literal("list").optional().describe("Vorgabe und einzig zugelassene Aktion: 'list'"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_export_csv": z.object({
    resultRef: RESULT_REF().optional().describe("Neuer oder vorhandener leerer Ergebnisordner fuer den CSV-Export"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_collect": z.object({
    resultRef: RESULT_REF().optional().describe("Zieldatei .json; ohne Angabe kommt alles in die Antwort"),
    maxPages: z.number().int().min(1).max(5).optional().describe("Hoechstzahl des Diagnose-Segments, Vorgabe 3, Maximum 5"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_verify": z.object({
    sourceRef: VERIFY_SOURCE_REF().describe("Referenz der mit sse_collect erzeugten JSON-Datei"),
    expectedSourceHash: SHA256().describe(
      "Exakter dateiHash aus sse_collect; bindet den geprueften Inhalt gegen parallele Aenderungen",
    ),
    allowIncompleteSource: z.boolean().optional().describe(
      "Vorgabe false. True erlaubt nur einen klar gekennzeichneten Teilstandsabgleich ohne Gesamturteil.",
    ),
    erwartungen: z
      .array(z.object({
        seite: z.string().describe("Exakte Seitenueberschrift im gesammelten Teilstand"),
        label: z.string().describe("Exakte Feld- oder Zeilenbeschriftung"),
        wert: z.string().describe("Exakt erwarteter formatierter Wert"),
        seiteOccurrence: UI_OCCURRENCE.optional(),
        labelOccurrence: UI_OCCURRENCE.optional(),
      }).strict()).min(1).max(SSE_OPERATION_LIMITS.verifyExpectations)
      .describe("Sollwerte; Occurrence nur verwenden, wenn der vorige Lauf konkrete Mehrdeutigkeit meldete"),
  }).strict(),
} as const;
