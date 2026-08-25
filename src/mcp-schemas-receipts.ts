import { z } from "zod";
import {
  RESOURCE_REF,
  SHA256,
  UI_WAIT_MS,
  WINDOW_HANDLE,
} from "./operation-schema-primitives.js";

const RECEIPT_AMOUNT = z.string().regex(
  /^(?:0|[1-9]\d{0,8})(?:[.,]\d{1,2})?$/u,
  "Betrag als positive Dezimalzahl mit hoechstens zwei Nachkommastellen erwartet",
);
const RECEIPT_DATE = z.string().regex(
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u,
  "Datum im Format YYYY-MM-DD erwartet",
);
const RECEIPT_UPDATE_VALUES = z.object({
  title: z.string().trim().min(1).max(200).optional().describe("Bezeichnung des Belegs"),
  date: RECEIPT_DATE.optional().describe("Belegdatum im Format YYYY-MM-DD"),
  documentNumber: z.string().trim().max(128).optional().describe("Rechnungs- oder Belegnummer; leer zum Entfernen"),
  amount: RECEIPT_AMOUNT.optional().describe("Bruttobetrag, sofern net=false; sonst Nettobetrag"),
  vatRate: z.enum(["0", "7", "19"]).optional().describe("Umsatzsteuersatz in Prozent"),
  net: z.boolean().optional().describe("Ob der eingegebene Betrag als Nettobetrag behandelt wird"),
  note: z.string().max(2000).optional().describe("Optionale Belegnotiz; leer zum Entfernen"),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Mindestens ein Belegfeld muss gesetzt werden.",
});
const RECEIPT_CLASSIFICATION_VALUES = z.object({
  categories: z.array(z.string().trim().min(1).max(120)).max(50).optional().describe(
    "Exakte, vollstaendige Zielmenge vorhandener BelegManager-Kategorien; leere Liste entfernt alle Kategorien",
  ),
  persons: z.array(z.string().trim().min(1).max(160)).max(50).optional().describe(
    "Exakte, vollstaendige Zielmenge vorhandener BelegManager-Personen; leere Liste entfernt alle Personen",
  ),
}).strict().refine((value) => value.categories !== undefined || value.persons !== undefined, {
  message: "Mindestens categories oder persons muss angegeben werden.",
}).refine(
  (value) => [value.categories, value.persons].every(
    (items) => items === undefined || new Set(items).size === items.length,
  ),
  { message: "Kategorie- und Personenlisten duerfen keine Duplikate enthalten." },
);
const RECEIPT_BULK_ITEM = z.object({
  resourceRef: RESOURCE_REF().describe("Vorhandene Belegdatei im documents:-Bereich"),
  expectedHash: SHA256().describe("SHA-256 der unveraenderten Quelldatei"),
  values: RECEIPT_UPDATE_VALUES.describe("Nach dem Import vollstaendig rueckzulesende Belegfelder"),
  classification: RECEIPT_CLASSIFICATION_VALUES.optional().describe(
    "Optionale, exakt aus vorhandenen Dialogoptionen gesetzte Kategorien und Personen",
  ),
}).strict();

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
  "sse_receipt_manager_update": z.object({
    rowRid: z.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
    rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
    expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
    expectedDetailFingerprint: SHA256().describe("Fingerprint der zuletzt mit sse_receipt_manager_read gelesenen Detailfelder"),
    values: RECEIPT_UPDATE_VALUES.describe("Gemeinsam und gebunden zu setzende Belegfelder"),
    acknowledgeUpdate: z.literal(true).describe("Bestaetigt die gebundene Aenderung genau dieses Belegs"),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je Feld und fuer den abschliessenden Readback; Vorgabe 3500 ms"),
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
  "sse_receipt_manager_classification_options": z.object({
    rowRid: z.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
    rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
    expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
    expectedDetailFingerprint: SHA256().describe("Fingerprint der zuletzt gelesenen Belegdetails"),
    kind: z.enum(["categories", "persons"]).describe("Zu lesender, profilierter Auswahldialog"),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit fuer Dialog und sicheren Abbruch; Vorgabe 3000 ms"),
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
  "sse_receipt_manager_classify": z.object({
    rowRid: z.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
    rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
    expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
    expectedDetailFingerprint: SHA256().describe("Fingerprint der zuletzt gelesenen Belegdetails"),
    values: RECEIPT_CLASSIFICATION_VALUES.describe("Vollstaendige Zielmenge fuer categories und/oder persons"),
    acknowledgeClassification: z.literal(true).describe("Bestaetigt die exakten Kategorie-/Personen-Zielmengen fuer diesen Beleg"),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je Auswahldialog; Vorgabe 3500 ms"),
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
  "sse_receipt_manager_link": z.object({
    receiptContentFingerprint: SHA256().describe("Fensteruebergreifend stabiler Inhaltsfingerprint des exakt gemeinten Belegs"),
    expectedReceiptTitle: z.string().trim().min(1).max(200).describe("Exakte Bezeichnung des Belegs als zusaetzliche sichtbare Bindung"),
    expectedTargetPage: z.string().trim().min(1).max(300).describe("Exakte aktuelle Steuerseite, von der der Verknuepfungsmodus gestartet wird"),
    expectedLinkTarget: z.string().trim().min(1).max(200).describe("Exakter Zieltext im BelegManager, zum Beispiel Lotterie"),
    linked: z.boolean().describe("true verknuepft den Beleg mit dem Ziel, false entfernt genau diese Verknuepfung"),
    acknowledgeLinkChange: z.literal(true).describe("Bestaetigt die ziel-, seiten- und beleggebundene Verknuepfungsaenderung"),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je UI-Phase; Vorgabe 4000 ms"),
    hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen"),
  }).strict(),
  "sse_receipt_manager_bulk_upsert": z.object({
    items: z.array(RECEIPT_BULK_ITEM).min(1).max(20).refine(
      (items) => new Set(items.map((item) => item.resourceRef)).size === items.length,
      "Jede resourceRef darf in einem Batch nur einmal vorkommen.",
    ).describe("Ein bis 20 Belege; jeder Beleg wird importiert, befuellt, optional klassifiziert und rueckgelesen"),
    acknowledgeBulkUpsert: z.literal(true).describe("Bestaetigt den gebundenen Import aller aufgefuehrten Dateien"),
    stopOnError: z.literal(true).optional().describe("Fail-closed ist fest: beim ersten unklaren Beleg wird gestoppt"),
    waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je UI-Phase; Vorgabe 3500 ms"),
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
