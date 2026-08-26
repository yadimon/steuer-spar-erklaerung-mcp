import { z } from "zod";
import {
  CASE_REF,
  SHA256,
  SSE_OPERATION_LIMITS,
  WINDOW_HANDLE,
  PROCESS_ID,
  UI_WAIT_MS,
  UI_OCCURRENCE,
  USTVA_PERIOD_KEY,
  SSE_CLICK_PATTERNS,
} from "./operation-schema-primitives.js";

export const SSE_MCP_INTERACTION_SCHEMAS = {
  "sse_click": z.object({
    name: z.string().optional().describe("Beschriftung, z. B. 'Weiter'"),
    aid: z.string().optional().describe("AutomationId statt Beschriftung (Endstueck genuegt)"),
    rid: z.string().optional().describe("RuntimeId aus sse_snapshot - eindeutig"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    type: z.string().optional().describe("Optionaler UIA-Steuerelementtyp zur Eindeutigkeit"),
    pattern: z
      .enum(SSE_CLICK_PATTERNS)
      .optional()
      .describe(
        "Vorgabe 'invoke'. expand/collapse aendern nur den Tree-Zustand, nicht die Seite. " +
        "toggle ist fail-closed gesperrt; select nur mit exakter aid fuer einen RadioButton samt Gruppen-Readback.",
      ),
    acknowledgeDestructive: z.boolean().optional().describe(
      "Nur nach bewusstem Readback fuer lokale Loesch-/Import-/Uebernahme-/Zuruecksetzbefehle einmalig true setzen",
    ),
    expectedPageBefore: z.string().optional().describe(
      "Optionale exakte Seitenueberschrift unmittelbar vor dem Ausloesen; bei Abweichung wird nichts aktiviert",
    ),
    expectedPageAfter: z.string().optional().describe(
      "Optionale exakte Zielueberschrift fuer jede navigierende Schaltflaeche; wird im selben Worker rueckgelesen",
    ),
    waitMs: UI_WAIT_MS.optional().describe("Maximale Wartezeit auf die Nachbedingung; sonst 1200 ms, maximal 10 Sekunden"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_toggle": z.object({
    expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
    name: z.string().optional().describe("Exakte sichtbare Beschriftung"),
    aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
    rid: z.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    expectedBefore: z.boolean().describe("Exakt erwarteter aktueller Haken-Zustand"),
    value: z.boolean().describe("Gewuenschter Haken-Zustand"),
    expectedAfter: z.boolean().describe("Exakt erwarteter Zustand nach Toggle und Readback"),
    hwnd: WINDOW_HANDLE.optional(),
    pid: PROCESS_ID.optional(),
    expectedCaseRef: CASE_REF().optional(),
    expectedCaseHash: SHA256().optional(),
  }).strict(),
  "sse_click_point": z.object({
    name: z.string().optional().describe("Beschriftung, z. B. ein Eintrag im Navigationsbaum"),
    aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
    rid: z.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
    type: z.string().optional().describe("'TreeItem' oder fuer eine reine Detailnavigation 'Hyperlink'"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    double: z.boolean().optional().describe("Nur fuer einen nachweislich doppelklickbeduerftigen TreeItem-Pfad"),
    acknowledgeDestructive: z.boolean().optional().describe(
      "Nur nach bewusstem Readback fuer destruktiv benannte TreeItems einmalig true setzen",
    ),
    expectedPageBefore: z.string().optional().describe(
      "Optionale exakte Seitenueberschrift unmittelbar vor dem physischen Klick; bei Abweichung wird nicht geklickt",
    ),
    expectedPageAfter: z.string().optional().describe(
      "Optionale exakte Zielueberschrift; eine blosse Auswahl-/Fingerprint-Aenderung gilt dann nicht als Erfolg",
    ),
    waitMs: UI_WAIT_MS.optional().describe("Wartezeit auf den Navigations-Readback"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_set_value": z.object({
    rid: z.string().min(1).describe(
      "Frische RuntimeId des strukturell ueber seinen Container gebundenen globalen Suchfelds, " +
      "z. B. aus sse_get_value oder sse_snapshot; muss zum aktuell gebundenen Suchfeld passen",
    ),
    expectedBefore: z.string().describe("Exakter unmittelbar erwarteter Suchtext; leerer String ist erlaubt"),
    value: z.string().describe("Neuer Wert"),
    expectedAfter: z.string().describe("Exakter erwarteter Suchtext nach ValuePattern-Readback"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_change_field": z.object({
    expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift; verhindert Schreiben auf einer falschen Seite"),
    name: z.string().optional().describe("Beschriftung des Zielfelds"),
    aid: z.string().optional().describe("AutomationId des Zielfelds; fuer unbeschriftete oder mehrdeutige Felder"),
    rid: z.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Readback"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    expectedBefore: z.string().describe("Exakter erwarteter Vorwert"),
    value: z.string().describe("Zu setzender Wert"),
    expectedAfter: z.string().describe("Exakter erwarteter Wert nach Qt-Formatierung/Commit"),
    valueKind: z.enum(["text", "currency", "date"]).optional().describe(
      "Optionaler Formatvertrag; date akzeptiert ein von SSE bewusst ohne Jahr angezeigtes TT.MM",
    ),
    sumChecks: z.array(z.object({
      label: z.string().describe("Exakte Beschriftung der Kontrollsumme"),
      occurrence: UI_OCCURRENCE.optional(),
      before: z.string().describe("Exakter Summenwert vor dem Schreiben"),
      after: z.string().describe("Exakter Summenwert nach dem Schreiben"),
    }).strict()).max(SSE_OPERATION_LIMITS.readbackChecks).optional().describe("Optionale Seiten-Summenvertraege; jede Abweichung loest Rollback aus"),
    trackResults: z.boolean().optional().describe("Werte-Info vor/nach lesen; Vorgabe true"),
    resultLabels: z.array(z.string()).max(SSE_OPERATION_LIMITS.resultLabels).optional().describe(
      "Optional nur diese Ergebniszeilen vergleichen; sonst alle geaenderten",
    ),
    hwnd: WINDOW_HANDLE.optional(),
    pid: PROCESS_ID.optional(),
    expectedCaseRef: CASE_REF().optional().describe("Optional exakter geoeffneter Steuerfall; bei mehreren SSE-Instanzen empfohlen"),
    expectedCaseHash: SHA256().optional().describe("Optional SHA256 der Falldatei, nur zusammen mit expectedCaseRef"),
  }).strict(),
  "sse_change_known_field": z.object({
    pageId: z.string().describe("Stabile pageId aus sse_page_objects"),
    fieldId: z.string().describe("Stabile fieldId der katalogisierten Seite"),
    expectedBefore: z.string().describe("Exakter erwarteter Vorwert aus sse_page_state"),
    expectedEpoch: z.string().optional().describe("Epoche aus sse_page_state; verhindert Schreiben nach zwischenzeitlicher UI-Aenderung"),
    value: z.string().describe("Zu setzender fachlicher Wert"),
    expectedAfter: z.string().describe("Exakter erwarteter Wert nach Qt-Formatierung und Readback"),
    sumChecks: z.array(z.object({
      label: z.string().describe("Exakte Beschriftung der Kontrollsumme"),
      occurrence: UI_OCCURRENCE.optional(),
      before: z.string().describe("Exakter Summenwert vor dem Schreiben"),
      after: z.string().describe("Exakter Summenwert nach dem Schreiben"),
    }).strict()).max(SSE_OPERATION_LIMITS.readbackChecks).optional()
      .describe("Optionale Summenvertraege; jede Abweichung loest Rollback aus"),
    trackResults: z.boolean().optional().describe("Werte-Info vor/nach lesen; Vorgabe true"),
    resultLabels: z.array(z.string()).max(SSE_OPERATION_LIMITS.resultLabels).optional()
      .describe("Optional nur diese Werte-Info-Zeilen vergleichen"),
    hwnd: WINDOW_HANDLE.optional(),
    pid: PROCESS_ID.optional(),
    expectedCaseRef: CASE_REF().optional(),
    expectedCaseHash: SHA256().optional(),
  }).strict(),
  "sse_fill_fields": z.object({
    pageId: z.string().min(1).max(200).describe(
      "Stabile pageId der bereits geoeffneten katalogisierten Seite",
    ),
    fields: z.array(z.object({
      fieldId: z.string().min(1).max(200).describe("Stabile fieldId derselben Page-Object-Seite"),
      expectedBefore: z.string().describe("Exakter Vorwert dieses Feldes"),
      value: z.string().describe("Zu setzender fachlicher Wert"),
      expectedAfter: z.string().describe("Exakter Wert nach Qt-Commit und Readback"),
      sumChecks: z.array(z.object({
        label: z.string().describe("Exakte Beschriftung der Kontrollsumme"),
        occurrence: UI_OCCURRENCE.optional(),
        before: z.string().describe("Exakter Summenwert vor diesem Feld"),
        after: z.string().describe("Exakter Summenwert nach diesem Feld"),
      }).strict()).max(SSE_OPERATION_LIMITS.readbackChecks).optional().describe(
        "Optionale Summenvertraege fuer diesen einzelnen Feldschritt",
      ),
    }).strict()).min(1).max(20).refine(
      (fields) => new Set(fields.map((field) => field.fieldId)).size === fields.length,
      "Jede fieldId darf im Plan nur einmal vorkommen.",
    ).describe("Ein bis 20 katalogisierte Felder derselben bereits geoeffneten Seite"),
    expectedEpoch: SHA256().optional().describe(
      "Optionale Anfangsepoche aus sse_page_state; sie bindet den ersten Schritt, danach gelten dessen unmittelbare Readbacks",
    ),
    stopOnError: z.literal(true).optional().describe("Fail-fast ist fest; nach dem ersten Fehler folgen nur Rollback und Readback"),
    rollback: z.literal("best-effort").optional().describe("Erfolgreiche vorherige Feldschritte werden in umgekehrter Reihenfolge zurueckgesetzt"),
    finalReadback: z.literal(true).optional().describe("Vollstaendiger Page-Object-Readback ist verpflichtend"),
    trackResults: z.boolean().optional().describe("Werte-Info je Feld verfolgen; Vorgabe wie bei sse_change_known_field"),
    resultLabels: z.array(z.string()).max(SSE_OPERATION_LIMITS.resultLabels).optional().describe(
      "Optional nur diese Werte-Info-Zeilen bei jedem Feldschritt vergleichen",
    ),
    hwnd: WINDOW_HANDLE.optional(),
    pid: PROCESS_ID.optional(),
    expectedCaseRef: CASE_REF().optional(),
    expectedCaseHash: SHA256().optional(),
  }).strict(),
  "sse_combo_options": z.object({
    name: z.string().optional().describe("Exakte sichtbare Beschriftung des Dropdowns"),
    aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
    rid: z.string().optional().describe("RuntimeId aus sse_snapshot"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_combo_select": z.object({
    expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
    name: z.string().optional().describe("Exakte sichtbare Beschriftung des Dropdowns"),
    aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
    rid: z.string().optional().describe("RuntimeId aus sse_snapshot"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    hwnd: WINDOW_HANDLE.optional(),
    expectedCurrent: z.string().describe("Exakter aktuell erwarteter Wert, leerer String ist erlaubt"),
    value: z.string().describe("Exakte Optionsbeschriftung"),
    expectedAfter: z.string().describe("Exakter erwarteter Wert nach Auswahl und Qt-Readback"),
    pid: PROCESS_ID.optional(),
    expectedCaseRef: CASE_REF().optional(),
    expectedCaseHash: SHA256().optional(),
  }).strict(),
  "sse_ustva_read": z.object({
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_ustva_select_period": z.object({
    selector: z.enum(["frequency", "month", "quarter"]).describe("Zu aendernde Zeitraumdimension"),
    expectedCurrent: USTVA_PERIOD_KEY(),
    value: USTVA_PERIOD_KEY(),
    hwnd: WINDOW_HANDLE.optional(),
    pid: PROCESS_ID.optional(),
    expectedCaseRef: CASE_REF(),
    expectedCaseHash: SHA256(),
  }).strict(),
  "sse_ustva_set_flag": z.object({
    flag: z.enum(["corrected", "documents", "offset_request", "revoke_sepa", "additional_information", "manual_input"])
      .describe("Stabiles fachliches UStVA-Kennzeichen"),
    expectedBefore: z.boolean().describe("Exakt erwarteter aktueller Kennzeichenstatus"),
    value: z.boolean().describe("Gewuenschter Kennzeichenstatus"),
    expectedAfter: z.boolean().describe("Exakt erwarteter Status nach Readback"),
    hwnd: WINDOW_HANDLE.optional(),
    pid: PROCESS_ID.optional(),
    expectedCaseRef: CASE_REF(),
    expectedCaseHash: SHA256(),
  }).strict(),
  "sse_ustva_change_value": z.object({
    field: z.enum([
      "taxable_19_base", "taxable_7_base", "taxable_zero_base", "other_rates_base", "other_rates_tax",
      "reverse_charge_eu_base", "reverse_charge_eu_tax",
      "reverse_charge_foreign_services_base", "reverse_charge_foreign_services_tax",
      "input_tax_invoices", "input_tax_reverse_charge", "input_tax_import",
      "input_tax_adjustment", "special_advance_payment", "reduction_taxable_base", "reduction_input_tax",
    ]).describe("Stabiles fachliches UStVA-Betragsfeld"),
    expectedBefore: z.string().describe("Exakt erwarteter formatierter Vorwert"),
    value: z.string().describe("Neuer fachlicher Betragswert"),
    expectedAfter: z.string().describe("Exakt erwarteter formatierter Wert nach Readback"),
    manualInputConfirmed: z.literal(true).optional()
      .describe("Fuer manuelle Haupt-, §13b- und Vorsteuerwerte nur nach bewusster manueller Eingabeentscheidung true"),
    hwnd: WINDOW_HANDLE.optional(),
    pid: PROCESS_ID.optional(),
    expectedCaseRef: CASE_REF(),
    expectedCaseHash: SHA256(),
  }).strict(),
  "sse_ustva_open_section": z.object({
    section: z.enum(["reverse_charge", "input_tax", "small_business", "tax_exempt", "non_taxable"])
      .describe("Stabiler fachlicher UStVA-Unterbereich"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_scroll": z.object({
    mode: z.enum(["intoview", "percent", "list"]).optional().describe("Scrollmodus; Vorgabe intoview"),
    name: z.string().optional().describe("Element, das sichtbar werden soll (bei mode='intoview')"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    vPercent: z.number().min(0).max(100).optional().describe("Vertikale Zielposition in Prozent"),
    hPercent: z.number().min(0).max(100).optional().describe("Horizontale Zielposition in Prozent"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
} as const;
