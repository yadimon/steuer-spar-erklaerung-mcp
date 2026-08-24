import { z } from "zod";
import {
  RESOURCE_REF,
  SHA256,
  UI_WAIT_MS,
  WINDOW_HANDLE,
} from "./operation-schema-primitives.js";

export const SSE_MCP_RECEIPT_SCHEMAS = {
  "sse_receipt_manager_action": z.object({
    actionId: z.enum(["showAllReceipts", "goHome"]).describe(
      "Katalogisierte, reversible BelegManager-Navigation: 'showAllReceipts' von der Startseite zur Liste oder 'goHome' von der Liste zur Startseite",
    ),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit fuer den semantischen Zustandswechsel; Vorgabe 2500 ms"),
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
  "sse_receipt_manager_list": z.object({
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
  "sse_receipt_manager_read": z.object({
    rowRid: z.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
    rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
    expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit fuer die Detailansicht; Vorgabe 2500 ms"),
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
  "sse_receipt_manager_import": z.object({
    resourceRef: RESOURCE_REF().describe("Vorhandene Belegdatei im documents:-Bereich"),
    expectedHash: SHA256().describe("SHA-256 der unveraenderten Quelldatei"),
    expectedListFingerprint: SHA256().describe("Frischer Fingerprint der Belegliste aus sse_receipt_manager_list"),
    expectedCountBefore: z.number().int().min(0).max(100000).describe("Frischer Gesamtzaehler aus sse_receipt_manager_list"),
    acknowledgeImport: z.literal(true).describe("Bestaetigt genau diesen lokalen, dateihashgebundenen Import als neuen Beleg"),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je Importphase; Vorgabe 3500 ms"),
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
  "sse_receipt_manager_delete": z.object({
    rowRid: z.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
    rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
    expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
    expectedCountBefore: z.number().int().min(1).max(100000).describe("Frischer Gesamtzaehler aus sse_receipt_manager_list"),
    acknowledgeDelete: z.literal(true).describe("Bestaetigt die unwiderrufliche Loeschung genau des gebundenen Belegs"),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit fuer Auswahl, Dialog und Listen-Readback; Vorgabe 3500 ms"),
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
} as const;
