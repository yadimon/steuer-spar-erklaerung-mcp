import { z } from "zod";
import {
  RESULT_REF,
  SSE_OPERATION_LIMITS,
  WINDOW_HANDLE,
  UI_WAIT_MS,
  UI_OCCURRENCE,
  UI_COORDINATE,
  GOTO_MAX_STEPS,
  TABLE_MAX_ROWS,
  SNAPSHOT_MAX_NODES,
} from "./operation-schema-primitives.js";

const TABLE_COMBO_EXPECTED_BEFORE = z.record(
  z.string().regex(/^(?:0|[1-9][0-9]{0,2})$/u),
  z.string(),
).refine(
  (value) => Object.keys(value).length <= SSE_OPERATION_LIMITS.tableValues,
  `Hoechstens ${SSE_OPERATION_LIMITS.tableValues} ComboBox-Vorwerte`,
).describe(
  "Erwarteter semantischer Vorwert je 0-basierter ComboBox-Spalte, z. B. {'3':'Noch nicht zugeordnet'}; fuer jede im Produktprofil typisierte und geaenderte ComboBox Pflicht",
);

export const SSE_MCP_UI_SCHEMAS = {
  "sse_tree_top": z.object({
    steps: z.number().int().min(1).max(80).optional().describe("Mausradschritte nach oben, Vorgabe 40"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_tree_scroll": z.object({
    direction: z.enum(["up", "down"]).optional().describe("Vorgabe 'down'"),
    steps: z.number().int().min(1).max(80).optional().describe("Mausradschritte, Vorgabe 8"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_goto": z.object({
    name: z.string().describe("Ueberschrift der Zielseite, z. B. 'Einnahmen: Freiberufler'"),
    maxSteps: GOTO_MAX_STEPS.optional().describe("Hoechstzahl der Blaetterschritte, Vorgabe automatisch, maximal 200"),
    direction: z.enum(["Weiter", "Zurück"]).optional().describe(
      "Bei unbekannten Seiten die Suchrichtung fest vorgeben; verhindert einen langen Lauf in die falsche Richtung",
    ),
    useSearch: z.boolean().optional().describe(
      "Globale Qt-Suche zuerst versuchen; Vorgabe true. Auf verstecktem Desktop fuer einen rein linearen Lauf false setzen.",
    ),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_table_read": z.object({
    maxRows: TABLE_MAX_ROWS.optional().describe("Obergrenze der Pfeiltastenschritte, Vorgabe 200, maximal 1000"),
    noKeys: z.boolean().optional().describe(
      "Nur sichtbare Zeilen, ohne Fenster nach vorn zu holen. Damit entfaellt der Cursorlauf, "
      + "und der Vollstaendigkeitsbeweis ist unmoeglich: vollstaendig bleibt false und stopKind "
      + "visible-only, auch wenn zufaellig alle Zeilen sichtbar waren. Fuer einen belastbaren "
      + "Tabellenstand weglassen.",
    ),
    sumLabel: z.string().optional().describe("Bei mehreren Tabellen: Beschriftung der zugehoerigen Kontrollsumme"),
    sumOccurrence: UI_OCCURRENCE.optional().describe("1-basierte Position der Kontrollsumme; Vorgabe 1"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_table_add": z.object({
    expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
    werte: z.array(z.string()).min(1).max(SSE_OPERATION_LIMITS.tableValues).describe(
      "Werte in Spaltenreihenfolge, maximal 100 Spalten; eine im Produktprofil typisierte ComboBox wird auch " +
      "als UIA-DataItem nur ueber eine exakt popupgebundene SelectionItem-Option gesetzt, niemals per ValuePattern-Text",
    ),
    comboExpectedBefore: TABLE_COMBO_EXPECTED_BEFORE.optional(),
    sumLabel: z.string().describe("Beschriftung der eindeutigen Kontrollsumme"),
    sumOccurrence: UI_OCCURRENCE.optional().describe("1-basierte Position bei mehrfacher Summenbeschriftung; Vorgabe 1"),
    expectedBefore: z.string().describe("Exakter Summenwert vor dem Anlegen"),
    expectedAfter: z.string().describe("Exakter Summenwert nach dem Anlegen"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_table_update": z.object({
    expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
    text: z.string().describe("Eindeutiger vorhandener Zelltext der Zielzeile"),
    targetRid: z.string().optional().describe(
      "Frische Runtime-ID der Zielzelle aus sse_table_add oder sse_table_update; bindet bei gleichem Text exakt",
    ),
    werte: z.array(z.string().nullable()).min(1).max(SSE_OPERATION_LIMITS.tableValues).describe(
      "Neue Werte in sichtbarer Spaltenreihenfolge; null ueberspringt, true/false setzt Toggle-Zellen; " +
      "profilierte Tabellen-ComboBoxen werden auch als UIA-DataItem nur ueber eine exakt popupgebundene " +
      "SelectionItem-Option gesetzt",
    ),
    comboExpectedBefore: TABLE_COMBO_EXPECTED_BEFORE.optional(),
    sumLabel: z.string().describe("Beschriftung der Kontrollsumme, z. B. 'Summe'"),
    sumOccurrence: UI_OCCURRENCE.optional().describe(
      "1-basierte Position von oben, falls das Summenlabel mehrfach vorkommt; Vorgabe 1",
    ),
    expectedBefore: z.string().describe("Exakter Summenwert vor der Aktualisierung"),
    expectedAfter: z.string().describe("Exakter Summenwert nach der Aktualisierung"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_table_delete": z.object({
    expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
    text: z.string().describe("Eindeutiger Text einer Zelle der zu loeschenden Zeile"),
    targetRid: z.string().optional().describe(
      "Frische Runtime-ID der Zielzelle aus sse_table_update; bindet bei gleichem Text exakt",
    ),
    sumLabel: z.string().describe("Beschriftung der Kontrollsumme, z. B. 'Summe der Einnahmen'"),
    sumOccurrence: UI_OCCURRENCE.optional().describe(
      "1-basierte Position von oben, falls dasselbe Summenlabel mehrfach vorkommt",
    ),
    expectedBefore: z.string().describe("Exakter Wert der Kontrollsumme vor dem Loeschen, z. B. '89.340,00'"),
    expectedAfter: z.string().describe("Exakter Wert der Kontrollsumme nach dem Loeschen, z. B. '83.940,00'"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_menu": z.object({ name: z.string().optional().describe("z. B. 'Extras'"), hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_menu_click": z.object({
    name: z.string().describe("Exakter sichtbarer Menueeintrag aus sse_menu"),
    waitMs: UI_WAIT_MS.optional(),
    acknowledgeDestructive: z.boolean().optional().describe("Fuer einen lokal destruktiv benannten Menueeintrag bewusst einmalig true"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_menu_close": z.object({
    name: z.string().optional().describe("Optional das geoeffnete Hauptmenue, z. B. 'Datei'"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_ui_state": z.object({
    hwnd: WINDOW_HANDLE.optional(),
    previousFingerprint: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional().describe(
      "stateFingerprint des vorherigen sse_ui_state; liefert changedSince ohne den alten Zustand erneut zu uebertragen",
    ),
  }).strict(),
  "sse_dismiss": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_screenshot": z.object({
    hwnd: WINDOW_HANDLE.optional().describe("Fensterhandle; ohne Angabe wird automatisch gewaehlt (Dialog vor Hauptfenster)"),
    resultRef: RESULT_REF().describe("Zieldatei .png im konfigurierten Ergebnisbereich"),
    includeImage: z.boolean().optional().describe("Bild zusaetzlich als Base64 mitliefern (Vorgabe: nein)"),
  }).strict(),
  "sse_read_page": z.object({
    hwnd: WINDOW_HANDLE.optional(),
    minX: UI_COORDINATE.optional().describe("Linke Grenze ueberschreiben (sonst automatisch: rechts vom Navigationsbaum)"),
    maxX: UI_COORDINATE.optional().describe("Rechte Grenze ueberschreiben (sonst automatisch: links von der Hilfespalte)"),
  }).strict(),
  "sse_read_table": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_snapshot": z.object({
    hwnd: WINDOW_HANDLE.optional(),
    toolWindow: z.string().min(1).max(64).optional().describe(
      "Statt des Hauptfensters ein katalogisiertes nichtmodales Nebenfenster lesen: 'receiptManager' (BelegManager), "
      + "'taxTips' (Steuer-Spar-Tipps) oder 'resultComparison' (Werte-Info). Nur lesen - diese Fenster lassen sich "
      + "nicht bedienen. Ohne diese Angabe haengt es von Fenstergroesse und Knotenbudget ab, wie viel von ihrem "
      + "Teilbaum ueberhaupt ankommt; beim BelegManager blieb auf einem Rechner nur der Titel uebrig.",
    ),
    types: z.array(z.string()).max(SSE_OPERATION_LIMITS.snapshotTypes).optional().describe("Nur diese Steuerelementtypen, z. B. ['Button','Edit']; maximal 50"),
    namedOnly: z.boolean().optional().describe("Nur Elemente mit Beschriftung"),
    maxNodes: SNAPSHOT_MAX_NODES.optional().describe("Maximale Knotenzahl; Vorgabe 2000, Maximum 5000"),
  }).strict(),
  "sse_snapshot_compare": z.object({
    hwnd: WINDOW_HANDLE.optional(),
    repetitions: z.number().int().min(1).max(10).optional().describe(
      "Unmittelbare Legacy/Bulk-Vergleichspaare im selben Worker; Vorgabe 3, mindestens ein exaktes Paar ist fuer Paritaet erforderlich",
    ),
  }).strict(),
  "sse_accessibility_probe": z.object({
    hwnd: WINDOW_HANDLE.optional(),
    rid: z.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
    aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
    name: z.string().optional().describe("Exakte sichtbare Beschriftung"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    type: z.string().optional().describe("Optionaler UIA-Steuerelementtyp"),
    maxDepth: z.number().int().min(1).max(10).optional().describe("Maximale RawView-Tiefe; hoechstens 10"),
    maxNodes: z.number().int().min(1).max(500).optional().describe("Maximale Zahl untersuchter RawView-Knoten"),
    includePatterns: z.boolean().optional().describe("Unterstuetzte UIA-Muster mitliefern"),
    includeRaw: z.boolean().optional().describe("Begrenzten UIA-RawView-Unterbaum mitliefern"),
    includeMsaa: z.boolean().optional().describe("Begrenzte MSAA-Punktprobe mitliefern"),
  }).strict(),
  "sse_find": z.object({
    name: z.string().optional().describe("Beschriftung des Elements"),
    aid: z
      .string()
      .optional()
      .describe(
        "AutomationId, z. B. '.MainToolBar.QWidget.SearchSSE.QLineEdit'. Stabiler als der Name; " +
        "Endstueck genuegt. Unbeschriftete Felder sind nur so adressierbar.",
      ),
    contains: z.boolean().optional().describe("Teilstringsuche statt exakt"),
    type: z.string().optional().describe("Auf Steuerelementtyp einschraenken, z. B. 'Button'"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_get_value": z.object({
    name: z.string().optional().describe("Exakte sichtbare Beschriftung des Zielfelds"),
    aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
    rid: z.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
    type: z.string().optional().describe("Optionaler UIA-Steuerelementtyp, z. B. 'Edit'"),
    contains: z.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
} as const;
