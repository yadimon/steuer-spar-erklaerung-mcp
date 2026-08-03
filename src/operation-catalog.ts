import { z } from "zod";
import { SSE_API_OPERATIONS, type SseApiOperation } from "./api-contract.js";

const SSE_START_MODE = z.enum([
  "einur", "normal", "einurvor", "fest", "ermaess", "zulage", "KonsUst", "NVBescheinigung", "vorweg",
]);
const RESOURCE_PATH = "(?!(?:[\\\\/]|[A-Za-z]:))(?!\\.\\.(?:/|$))(?!.*\\/\\.\\.(?:/|$))[^\\\\:*?\"<>|\\x00-\\x1f]+";
const RESOURCE_REF = () => z.string().regex(
  new RegExp(`^(?:cases|documents|workspace|results|backups):${RESOURCE_PATH}$`),
  "Ressourcenreferenz im Format bereich:relativer/pfad erwartet",
);
const CASE_REF = () => z.string().regex(
  new RegExp(`^cases:${RESOURCE_PATH}$`),
  "Fallreferenz im Format cases:relativer/pfad erwartet",
);
const RESULT_REF = () => z.string().regex(
  new RegExp(`^results:${RESOURCE_PATH}$`),
  "Ergebnisreferenz im Format results:relativer/pfad erwartet",
);
const WORKSPACE_REF = () => z.string().regex(
  new RegExp(`^workspace:${RESOURCE_PATH}$`),
  "Arbeitsreferenz im Format workspace:relativer/pfad erwartet",
);
const TEXT_WRITE_REF = () => z.string().regex(
  new RegExp(`^(?:workspace|results):${RESOURCE_PATH}$`),
  "Schreibreferenz im Bereich workspace: oder results: erwartet",
);
const BACKUP_REF = () => z.string().regex(
  new RegExp(`^backups:${RESOURCE_PATH}$`),
  "Sicherungsreferenz im Format backups:relativer/pfad erwartet",
);
const BARE_RESOURCE_REF = () => z.string().regex(
  new RegExp(`^${RESOURCE_PATH}$`),
  "Normalisierter relativer Ressourcenpfad ohne Bereich erwartet",
);
const VERIFY_SOURCE_REF = () => z.string().regex(
  new RegExp(`^(?:results|workspace):${RESOURCE_PATH}$`),
  "Quellreferenz im Bereich results: oder workspace: erwartet",
);
const SHA256 = () => z.string().regex(/^[A-Fa-f0-9]{64}$/, "64-stelliger SHA256 in Hexadezimalform erwartet");

export const SSE_MCP_TOOL_SCHEMAS = {
  "sse_product_info": z.object({}).strict(),
  "sse_page_objects": z.object({
      pageId: z.string().optional(),
    }).strict(),
  "sse_page_state": z.object({
      pageId: z.string(),
      hwnd: z.number().optional(),
      pid: z.number().int().positive().optional(),
    }).strict(),
  "sse_workspace_status": z.object({}).strict(),
  "sse_workspace_files": z.object({
      ref: RESOURCE_REF().optional().describe("Bereich und Unterordner; Vorgabe workspace:."),
      limit: z.number().int("'limit' muss eine ganze Zahl sein.").min(1).max(2000).optional(),
      includeHashes: z.boolean().optional().describe("SHA256 berechnen; Vorgabe true, false fuer besonders schnelle Listen"),
    }).strict(),
  "sse_workspace_read_text": z.object({
      ref: RESOURCE_REF(),
    }).strict(),
  "sse_workspace_write_text": z.object({
      ref: TEXT_WRITE_REF(),
      text: z.string(),
      expectedSha256: SHA256().optional(),
    }).strict(),
  "sse_run_scenario": z.object({
      scenarioRef: WORKSPACE_REF(),
      resultRef: RESULT_REF().optional(),
      expectedResultSha256: SHA256().optional(),
    }).strict(),
  "sse_health": z.object({}).strict(),
  "sse_windows": z.object({
      process: z.enum(["SSE", "SteuertippsCenter"]).optional().describe("Vorgabe 'SSE'; optional 'SteuertippsCenter' fuer die Fallauswahl"),
    }).strict(),
  "sse_center_cases": z.object({
      hwnd: z.number().optional().describe("Exaktes Fenster des Steuertipps-Centers; bei mehreren Fenstern Pflicht"),
    }).strict(),
  "sse_center_refresh": z.object({
      hwnd: z.number(),
      expectedDirectoryRef: CASE_REF().describe("Vom vorigen sse_center_cases gelieferte verzeichnisRef"),
    }).strict(),
  "sse_window_close": z.object({
      hwnd: z.number(),
      titleFingerprint: SHA256().describe("Vom vorigen sse_windows gelieferter Fingerprint des exakten Titels"),
      waitMs: z.number().min(300).max(10000).optional(),
    }).strict(),
  "sse_case_hash": z.object({ ref: CASE_REF().describe("Falldatei innerhalb des lokal konfigurierten Fallbereichs") }).strict(),
  "sse_dialog_list": z.object({}).strict(),
  "sse_dialog_answer": z.object({
      hwnd: z.number(),
      fingerprint: SHA256(),
      bodyFingerprint: SHA256().optional().describe("Bei automatischen Pruefhinweisen Pflicht; bindet auch den OCR-Fliesstext"),
      button: z.enum([
        "OK", "Ja", "Nein", "Abbrechen", "Schließen", "Schliessen", "Übernehmen", "Uebernehmen",
        "Speichern", "Nicht speichern", "Verwerfen", "Wiederholen", "Ignorieren",
        "Als gelesen markieren", "Jetzt ignorieren", "Wiederherstellen", "Datei neu zuordnen",
        "Klicken Sie hier, um Ihre Daten zu exportieren",
      ]),
      waitMs: z.number().min(200).max(10000).optional(),
    }).strict(),
  "sse_warning_popup_read": z.object({
      hwnd: z.number().optional().describe("Optionales SSE-Hauptfenster zur PID-Bindung oder exaktes Warnfenster"),
      ocr: z.boolean().optional().describe("Fliesstext per lokaler Windows-OCR lesen; Vorgabe true"),
      includeImage: z.boolean().optional().describe("Kontrollbild mitsenden; Vorgabe false"),
    }).strict(),
  "sse_vast_dialog_read": z.object({ hwnd: z.number().optional().describe("Exaktes VaSt-Dialogfenster; bei Eindeutigkeit optional") }).strict(),
  "sse_vast_row_details": z.object({
      hwnd: z.number().optional(),
      mappingFingerprint: SHA256(),
      certificate: z.string(),
      occurrence: z.number().int().min(1).optional(),
    }).strict(),
  "sse_vast_row_set_expanded": z.object({
      hwnd: z.number().optional(), mappingFingerprint: SHA256(), certificate: z.string(),
      occurrence: z.number().int().min(1).optional(), expectedBefore: z.boolean(), expanded: z.boolean(),
    }).strict(),
  "sse_vast_mapping_options": z.object({
      hwnd: z.number().optional(), mappingFingerprint: SHA256(), certificate: z.string(),
      occurrence: z.number().int().min(1).optional(), expectedCurrent: z.string(),
    }).strict(),
  "sse_vast_mapping_select": z.object({
      hwnd: z.number().optional(), mappingFingerprint: SHA256(), certificate: z.string(),
      occurrence: z.number().int().min(1).optional(), expectedCurrent: z.string(), value: z.string(),
      optionText: z.string().optional().describe("Nur falls OCR den sichtbaren Listentext anders liest als UIA, z. B. 1/l"),
      expectedAfter: z.string().describe("Exakter OCR-Readback nach der Auswahl"),
    }).strict(),
  "sse_vast_apply": z.object({
      hwnd: z.number().describe("Exaktes VaSt-Dialog-HWND"),
      expectedMainHwnd: z.number().describe("Exaktes zugehöriges SSE-Hauptfenster"),
      expectedCaseRef: CASE_REF().describe("Exakte Referenz des geöffneten Steuerfalls"),
      expectedCaseHash: SHA256().describe("Aktueller Disk-SHA256 vor dem ungespeicherten Merge"),
      mappingFingerprint: SHA256(),
      plan: z.array(z.object({
        certificate: z.string(), occurrence: z.number().int().min(1), localTarget: z.string(),
      })).min(1).describe("Alle sichtbaren Zeilen in exakt der von sse_vast_dialog_read gelieferten Reihenfolge"),
      acknowledgeApply: z.literal(true).describe("Einmalige Bestätigung für genau diesen lokalen Merge"),
      waitMs: z.number().int().min(500).max(15000).optional(),
    }).strict(),
  "sse_read_full": z.object({
      hwnd: z.number().optional(),
    }).strict(),
  "sse_scroll_page": z.object({
      mode: z.enum(["info", "percent", "amount"]).optional(),
      vPercent: z.number().min(0).max(100).optional(),
      direction: z.enum(["up", "down"]).optional(),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_help": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_subpages": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_check_page": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_result_details": z.object({
      openIfNeeded: z.boolean().optional().describe("Werte-Info bei Bedarf oeffnen; Vorgabe true"),
      hwnd: z.number().optional().describe("SSE-Hauptfenster, zu dessen Prozess die Werte-Info gehoert"),
    }).strict(),
  "sse_checker_results": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_checker_run": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_checker_reset": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_checker_open": z.object({
      name: z.string().min(1).describe("Exakter Text aus sse_checker_results"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_checker_close": z.object({ hwnd: z.number().optional(), waitMs: z.number().int().min(300).max(3000).optional() }).strict(),
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
  "sse_page": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_positions": z.object({
      aktion: z.literal("list").optional().describe("Vorgabe und einzig zugelassene Aktion: 'list'"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_export_csv": z.object({
      resultRef: RESULT_REF().optional().describe("Neuer oder vorhandener leerer Ergebnisordner fuer den CSV-Export"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_collect": z.object({
      resultRef: RESULT_REF().optional().describe("Zieldatei .json; ohne Angabe kommt alles in die Antwort"),
      expectedOutputHashBefore: SHA256().optional().describe(
        "Pflicht, wenn path bereits existiert; verhindert das Ueberschreiben eines geaenderten Teilstands",
      ),
      maxPages: z.number().int().min(1).max(5).optional().describe("Hoechstzahl des Diagnose-Segments, Vorgabe 3, Maximum 5"),
      hwnd: z.number().optional(),
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
          seite: z.string(),
          label: z.string(),
          wert: z.string(),
          seiteOccurrence: z.number().int().min(1).optional(),
          labelOccurrence: z.number().int().min(1).optional(),
        }))
        .describe("Sollwerte; Occurrence nur verwenden, wenn der vorige Lauf konkrete Mehrdeutigkeit meldete"),
    }).strict(),
  "sse_tree_top": z.object({
      steps: z.number().min(1).max(80).optional().describe("Mausradschritte nach oben, Vorgabe 40"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_tree_scroll": z.object({
      direction: z.enum(["up", "down"]).optional().describe("Vorgabe 'down'"),
      steps: z.number().min(1).max(80).optional().describe("Mausradschritte, Vorgabe 8"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_goto": z.object({
      name: z.string().describe("Ueberschrift der Zielseite, z. B. 'Einnahmen: Freiberufler'"),
      maxSteps: z.number().optional().describe("Hoechstzahl der Blaetterschritte, Vorgabe 40"),
      direction: z.enum(["Weiter", "Zurück"]).optional().describe(
        "Bei unbekannten Seiten die Suchrichtung fest vorgeben; verhindert einen langen Lauf in die falsche Richtung",
      ),
      useSearch: z.boolean().optional().describe(
        "Globale Qt-Suche zuerst versuchen; Vorgabe true. Auf verstecktem Desktop fuer einen rein linearen Lauf false setzen.",
      ),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_table_read": z.object({
      maxRows: z.number().optional().describe("Obergrenze der Pfeiltastenschritte, Vorgabe 200"),
      noKeys: z.boolean().optional().describe("Nur sichtbare Zeilen, ohne Fenster nach vorn zu holen"),
      sumLabel: z.string().optional().describe("Bei mehreren Tabellen: Beschriftung der zugehoerigen Kontrollsumme"),
      sumOccurrence: z.number().int().min(1).optional().describe("1-basierte Position der Kontrollsumme; Vorgabe 1"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_table_add": z.object({
      expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
      werte: z.array(z.string()).min(1).describe("Werte in Spaltenreihenfolge, z. B. ['', '30.11.2025', 'Bezeichnung', '1.234,56']"),
      sumLabel: z.string().describe("Beschriftung der eindeutigen Kontrollsumme"),
      sumOccurrence: z.number().int().min(1).optional().describe("1-basierte Position bei mehrfacher Summenbeschriftung; Vorgabe 1"),
      expectedBefore: z.string().describe("Exakter Summenwert vor dem Anlegen"),
      expectedAfter: z.string().describe("Exakter Summenwert nach dem Anlegen"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_table_update": z.object({
      expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
      text: z.string().describe("Eindeutiger vorhandener Zelltext der Zielzeile"),
      werte: z.array(z.string().nullable()).describe(
        "Neue Werte in sichtbarer Spaltenreihenfolge; null ueberspringt die Spalte, true/false setzt Toggle-Zellen",
      ),
      sumLabel: z.string().describe("Beschriftung der Kontrollsumme, z. B. 'Summe'"),
      sumOccurrence: z.number().int().min(1).optional().describe(
        "1-basierte Position von oben, falls das Summenlabel mehrfach vorkommt; Vorgabe 1",
      ),
      expectedBefore: z.string().describe("Exakter Summenwert vor der Aktualisierung"),
      expectedAfter: z.string().describe("Exakter Summenwert nach der Aktualisierung"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_table_delete": z.object({
      expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
      text: z.string().describe("Eindeutiger Text einer Zelle der zu loeschenden Zeile"),
      sumLabel: z.string().describe("Beschriftung der Kontrollsumme, z. B. 'Summe der Einnahmen'"),
      sumOccurrence: z.number().int().min(1).optional().describe(
        "1-basierte Position von oben, falls dasselbe Summenlabel mehrfach vorkommt",
      ),
      expectedBefore: z.string().describe("Exakter Wert der Kontrollsumme vor dem Loeschen, z. B. '89.340,00'"),
      expectedAfter: z.string().describe("Exakter Wert der Kontrollsumme nach dem Loeschen, z. B. '83.940,00'"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_menu": z.object({ name: z.string().optional().describe("z. B. 'Extras'"), hwnd: z.number().optional() }).strict(),
  "sse_menu_click": z.object({
      name: z.string(),
      waitMs: z.number().optional(),
      acknowledgeDestructive: z.boolean().optional(),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_menu_close": z.object({
      name: z.string().optional().describe("Optional das geoeffnete Hauptmenue, z. B. 'Datei'"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_ui_state": z.object({
      hwnd: z.number().optional(),
      previousFingerprint: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional().describe(
        "stateFingerprint des vorherigen sse_ui_state; liefert changedSince ohne den alten Zustand erneut zu uebertragen",
      ),
    }).strict(),
  "sse_dismiss": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_screenshot": z.object({
      hwnd: z.number().optional().describe("Fensterhandle; ohne Angabe wird automatisch gewaehlt (Dialog vor Hauptfenster)"),
      resultRef: RESULT_REF().describe("Zieldatei .png im konfigurierten Ergebnisbereich"),
      includeImage: z.boolean().optional().describe("Bild zusaetzlich als Base64 mitliefern (Vorgabe: nein)"),
    }).strict(),
  "sse_read_page": z.object({
      hwnd: z.number().optional(),
      minX: z.number().optional().describe("Linke Grenze ueberschreiben (sonst automatisch: rechts vom Navigationsbaum)"),
      maxX: z.number().optional().describe("Rechte Grenze ueberschreiben (sonst automatisch: links von der Hilfespalte)"),
    }).strict(),
  "sse_read_table": z.object({ hwnd: z.number().optional() }).strict(),
  "sse_snapshot": z.object({
      hwnd: z.number().optional(),
      types: z.array(z.string()).optional().describe("Nur diese Steuerelementtypen, z. B. ['Button','Edit']"),
      namedOnly: z.boolean().optional().describe("Nur Elemente mit Beschriftung"),
      maxNodes: z.number().optional(),
    }).strict(),
  "sse_snapshot_compare": z.object({
      hwnd: z.number().optional(),
      repetitions: z.number().int().min(1).max(10).optional().describe("Bulk-Snapshot-Wiederholungen im selben Worker; Vorgabe 3"),
    }).strict(),
  "sse_accessibility_probe": z.object({
      hwnd: z.number().optional(),
      rid: z.string().optional(),
      aid: z.string().optional(),
      name: z.string().optional(),
      contains: z.boolean().optional(),
      type: z.string().optional(),
      maxDepth: z.number().min(1).max(10).optional(),
      maxNodes: z.number().min(1).max(500).optional(),
      includePatterns: z.boolean().optional(),
      includeRaw: z.boolean().optional(),
      includeMsaa: z.boolean().optional(),
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
      hwnd: z.number().optional(),
    }).strict(),
  "sse_get_value": z.object({
      name: z.string().optional(),
      aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
      rid: z.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
      type: z.string().optional().describe("Optionaler UIA-Steuerelementtyp, z. B. 'Edit'"),
      contains: z.boolean().optional(),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_click": z.object({
      name: z.string().optional().describe("Beschriftung, z. B. 'Weiter'"),
      aid: z.string().optional().describe("AutomationId statt Beschriftung (Endstueck genuegt)"),
      rid: z.string().optional().describe("RuntimeId aus sse_snapshot - eindeutig"),
      contains: z.boolean().optional(),
      type: z.string().optional(),
      pattern: z
        .enum(["invoke", "toggle", "select", "expand", "collapse"])
        .optional()
        .describe(
          "Vorgabe 'invoke'. toggle ist fail-closed gesperrt; select nur mit exakter aid fuer einen RadioButton samt exklusivem Gruppen-Readback.",
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
      waitMs: z.number().optional().describe("Maximale Wartezeit auf die Nachbedingung; sonst 1200 ms"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_toggle": z.object({
      expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
      name: z.string().optional().describe("Exakte sichtbare Beschriftung"),
      aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
      rid: z.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
      contains: z.boolean().optional(),
      expectedBefore: z.boolean().describe("Exakt erwarteter aktueller Haken-Zustand"),
      value: z.boolean().describe("Gewuenschter Haken-Zustand"),
      expectedAfter: z.boolean().describe("Exakt erwarteter Zustand nach Toggle und Readback"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_click_point": z.object({
      name: z.string().optional().describe("Beschriftung, z. B. ein Eintrag im Navigationsbaum"),
      aid: z.string().optional(),
      rid: z.string().optional(),
      type: z.string().optional().describe("'TreeItem' oder fuer eine reine Detailnavigation 'Hyperlink'"),
      contains: z.boolean().optional(),
      double: z.boolean().optional().describe("Nur fuer einen nachweislich doppelklickbeduerftigen TreeItem-Pfad"),
      acknowledgeDestructive: z.boolean().optional().describe(
        "Nur nach bewusstem Readback fuer destruktiv benannte TreeItems einmalig true setzen",
      ),
      waitMs: z.number().optional(),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_set_value": z.object({
      aid: z.literal(".MainToolBar.QWidget.SearchSSE.QLineEdit"),
      expectedBefore: z.string().describe("Exakter unmittelbar erwarteter Suchtext; leerer String ist erlaubt"),
      value: z.string().describe("Neuer Wert"),
      expectedAfter: z.string().describe("Exakter erwarteter Suchtext nach ValuePattern-Readback"),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_change_field": z.object({
      expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift; verhindert Schreiben auf einer falschen Seite"),
      name: z.string().optional().describe("Beschriftung des Zielfelds"),
      aid: z.string().optional().describe("AutomationId des Zielfelds; fuer unbeschriftete oder mehrdeutige Felder"),
      rid: z.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Readback"),
      contains: z.boolean().optional(),
      expectedBefore: z.string().describe("Exakter erwarteter Vorwert"),
      value: z.string().describe("Zu setzender Wert"),
      expectedAfter: z.string().describe("Exakter erwarteter Wert nach Qt-Formatierung/Commit"),
      sumChecks: z.array(z.object({
        label: z.string(),
        occurrence: z.number().int().min(1).optional(),
        before: z.string(),
        after: z.string(),
      })).optional().describe("Optionale Seiten-Summenvertraege; jede Abweichung loest Rollback aus"),
      trackResults: z.boolean().optional().describe("Werte-Info vor/nach lesen; Vorgabe true"),
      resultLabels: z.array(z.string()).optional().describe("Optional nur diese Ergebniszeilen vergleichen; sonst alle geaenderten"),
      hwnd: z.number().optional(),
      pid: z.number().int().positive().optional(),
      expectedCaseRef: CASE_REF().optional().describe("Optional exakter geoeffneter Steuerfall; bei mehreren SSE-Instanzen empfohlen"),
      expectedCaseHash: SHA256().optional().describe("Optional SHA256 der Falldatei, nur zusammen mit expectedCaseRef"),
    }).strict(),
  "sse_change_known_field": z.object({
      pageId: z.string(),
      fieldId: z.string(),
      expectedBefore: z.string(),
      expectedEpoch: z.string().optional().describe("Epoche aus sse_page_state; verhindert Schreiben nach zwischenzeitlicher UI-Aenderung"),
      value: z.string(),
      expectedAfter: z.string(),
      sumChecks: z.array(z.object({
        label: z.string(),
        occurrence: z.number().int().min(1).optional(),
        before: z.string(),
        after: z.string(),
      })).optional(),
      trackResults: z.boolean().optional().describe("Werte-Info vor/nach lesen; Vorgabe true"),
      resultLabels: z.array(z.string()).optional(),
      hwnd: z.number().optional(),
      pid: z.number().int().positive().optional(),
      expectedCaseRef: CASE_REF().optional(),
      expectedCaseHash: SHA256().optional(),
    }).strict(),
  "sse_combo_options": z.object({
      name: z.string().optional(),
      aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
      rid: z.string().optional().describe("RuntimeId aus sse_snapshot"),
      contains: z.boolean().optional(),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_combo_select": z.object({
      expectedPage: z.string().describe("Exakte aktuelle Seitenueberschrift"),
      name: z.string().optional(),
      aid: z.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
      rid: z.string().optional().describe("RuntimeId aus sse_snapshot"),
      contains: z.boolean().optional(),
      hwnd: z.number().optional(),
      expectedCurrent: z.string().describe("Exakter aktuell erwarteter Wert, leerer String ist erlaubt"),
      value: z.string().describe("Exakte Optionsbeschriftung"),
      expectedAfter: z.string().describe("Exakter erwarteter Wert nach Auswahl und Qt-Readback"),
    }).strict(),
  "sse_scroll": z.object({
      mode: z.enum(["intoview", "percent", "list"]).optional(),
      name: z.string().optional().describe("Element, das sichtbar werden soll (bei mode='intoview')"),
      contains: z.boolean().optional(),
      vPercent: z.number().min(0).max(100).optional(),
      hPercent: z.number().min(0).max(100).optional(),
      hwnd: z.number().optional(),
    }).strict(),
  "sse_launch": z.object({
      caseRef: CASE_REF().optional().describe("Falldatei, z. B. cases:arbeitskopie.Gew2025"),
      mode: SSE_START_MODE
        .optional()
        .describe("Vorgabe 'einur'"),
      exe: z.never().optional().describe("Nicht zulaessig; wird ausschliesslich in der lokalen API konfiguriert"),
    }).strict(),
  "sse_save": z.object({
      caseRef: CASE_REF().describe("Exakte Referenz des aktuell geoeffneten Steuerfalls"),
      expectedHashBefore: SHA256().describe("SHA256 der Datei unmittelbar vor dem Speichern"),
      hwnd: z.number().optional().describe("Exaktes SSE-Hauptfenster; bei mehreren offenen Steuerfaellen Pflicht"),
      waitMs: z.number().min(800).max(30000).optional(),
    }).strict(),
  "sse_file_dialog_select": z.object({
      expectedDialogTitle: z.string(),
      resourceRef: RESOURCE_REF(),
      expectedHash: SHA256().optional().describe("Optionaler exakter SHA256 der auszuwaehlenden Datei"),
      waitMs: z.number().min(500).max(30000).optional(),
    }).strict(),
  "sse_save_as": z.object({
      sourceRef: CASE_REF(),
      expectedSourceHash: SHA256(),
      targetRef: CASE_REF(),
      allowOverwrite: z.boolean().optional(),
      expectedTargetHash: SHA256().optional(),
      waitMs: z.number().min(800).max(30000).optional(),
    }).strict(),
  "sse_close": z.object({
      force: z.boolean().optional(),
      save: z.boolean().optional().describe("Veraltet und gesperrt: stattdessen zuerst sse_save hashgebunden aufrufen"),
      discardChanges: z.boolean().optional().describe("Explizite Erlaubnis, ungespeicherte Aenderungen zu verwerfen."),
      hwnd: z.number().optional().describe("Exaktes SSE-Hauptfenster; bei mehreren Instanzen Pflicht"),
      pid: z.number().int().positive().optional().describe("Exakte SSE-PID; bei mehreren Instanzen Pflicht"),
    }).strict(),
  "sse_list_cases": z.object({
      includeBackups: z.boolean().optional(),
      verbose: z.boolean().optional().describe("Alle Kopffelder mitliefern (umfangreich)"),
    }).strict(),
  "sse_backup_cases": z.object({
      destinationRef: BACKUP_REF().describe("Neuer Sicherungsordner im lokal konfigurierten Backupbereich"),
    }).strict(),
  "sse_archive_cases": z.object({
      destinationRef: BACKUP_REF().describe("Neuer Archivordner im lokal konfigurierten Backupbereich"),
      cases: z.array(z.object({ name: z.string(), expectedSha256: SHA256() }).strict()).min(1),
      expectedRemaining: z.array(z.object({ name: z.string(), expectedSha256: SHA256() }).strict()).min(1),
    }).strict(),
  "sse_make_working_copy": z.object({
      sourceRef: CASE_REF(),
      targetRef: CASE_REF(),
      expectedSourceHash: SHA256(),
    }).strict(),
} as const;

export type SseMcpToolName = keyof typeof SSE_MCP_TOOL_SCHEMAS;

export const SSE_MCP_TOOL_OPERATIONS = {
  "sse_product_info": "product_info",
  "sse_page_objects": "page_objects",
  "sse_page_state": "known_page_state",
  "sse_workspace_status": "workspace_status",
  "sse_workspace_files": "workspace_file_list",
  "sse_workspace_read_text": "workspace_file_read_text",
  "sse_workspace_write_text": "workspace_file_write_text",
  "sse_run_scenario": "scenario_run",
  "sse_health": "health",
  "sse_windows": "windows",
  "sse_center_cases": "center_cases",
  "sse_center_refresh": "center_refresh",
  "sse_window_close": "window_close",
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

const RESOURCE_AREA = z.enum(["cases", "documents", "workspace", "results", "backups"]);
const API_TEXT_WRITE_AREA = z.enum(["workspace", "results"]);
const API_LOCAL_PATH = z.string().min(1).refine(
  (value) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\x00-\x1f*?"<>|]/.test(value),
  "Absoluter lokaler Windows-Pfad ohne Platzhalter erwartet",
);
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

const schemasByOperation: Partial<Record<SseApiOperation, AnyOperationSchema>> = {};
for (const [toolName, operation] of Object.entries(SSE_MCP_TOOL_OPERATIONS) as Array<[SseMcpToolName, SseApiOperation]>) {
  schemasByOperation[operation] ??= SSE_MCP_TOOL_SCHEMAS[toolName] as AnyOperationSchema;
}

schemasByOperation.tracked_set_value = requireCaseHashBinding(z.union([
  optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_change_field, "expectedCaseRef", "expectedCasePath"),
  optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_change_known_field, "expectedCaseRef", "expectedCasePath"),
]) as AnyOperationSchema);
schemasByOperation.vast_apply = withLegacyAlias(
  SSE_MCP_TOOL_SCHEMAS.sse_vast_apply,
  "expectedCaseRef",
  "expectedCasePath",
);
schemasByOperation.checker_detail = z.object({ name: z.string().min(1), hwnd: z.number().optional() }).strict();
const checkerReadOnlyClickSchema = extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_click_point, {
  checkerReadOnly: z.literal(true),
});
schemasByOperation.goto = z.object({
  name: z.string().optional(),
  ziel: z.string().optional(),
  maxSteps: z.number().optional(),
  direction: z.enum(["Weiter", "Zurück"]).optional(),
  useSearch: z.boolean().optional(),
  viaSuche: z.boolean().optional(),
  hwnd: z.number().optional(),
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
  ref: z.union([RESOURCE_REF(), BARE_RESOURCE_REF()]).optional(), area: RESOURCE_AREA.optional(),
  limit: z.number().int("'limit' muss eine ganze Zahl sein.").min(1).max(2000).optional(), includeHashes: z.boolean().optional(),
}).strict();
schemasByOperation.workspace_file_read_text = z.object({
  ref: z.union([RESOURCE_REF(), BARE_RESOURCE_REF()]), area: RESOURCE_AREA.optional(),
}).strict();
schemasByOperation.workspace_file_write_text = z.object({
  ref: z.union([TEXT_WRITE_REF(), BARE_RESOURCE_REF()]), area: API_TEXT_WRITE_AREA.optional(), text: z.string(),
  expectedSha256: SHA256().optional(),
}).strict();
schemasByOperation.scenario_run = z.object({
  scenarioRef: z.union([WORKSPACE_REF(), BARE_RESOURCE_REF()]),
  resultRef: z.union([RESULT_REF(), BARE_RESOURCE_REF()]).optional(),
  expectedResultSha256: SHA256().optional(),
}).strict();

schemasByOperation.case_hash = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_case_hash, "ref", "path");
schemasByOperation.center_refresh = withLegacyAlias(
  SSE_MCP_TOOL_SCHEMAS.sse_center_refresh,
  "expectedDirectoryRef",
  "expectedDirectory",
);
schemasByOperation.window_close = z.object({
  hwnd: z.number(),
  titleFingerprint: SHA256().optional(),
  expectedTitle: z.string().min(1).optional(),
  waitMs: z.number().min(300).max(10000).optional(),
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

export function parseApiOperationArgs(operation: SseApiOperation, args: Record<string, unknown>): Record<string, unknown> {
  return SSE_API_OPERATION_SCHEMAS[operation].parse(args);
}

export function parseCheckerReadOnlyClickArgs(args: Record<string, unknown>): Record<string, unknown> {
  return checkerReadOnlyClickSchema.parse(args);
}

export function formatOperationArgumentError(error: z.ZodError): string {
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
  return [...new Set(error.issues.flatMap(formatIssue))].join("; ");
}
