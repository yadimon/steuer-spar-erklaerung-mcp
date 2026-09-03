# API-Referenz

Diese Datei wird erzeugt: `node scripts/build-api-docs.mjs`. Sie von Hand zu
aendern hat keinen Bestand - der Suiteschritt `api-docs` ruft denselben
Generator mit `--check` auf und vergleicht Zeichen fuer Zeichen.

Quellen sind der MCP-Server selbst (Werkzeugnamen und Beschreibungen), die
Operationsmerkmale in `src/operation-traits.ts`, das Abdeckungsledger
`test/operation-coverage.json` und das OpenAPI-Dokument in `src/api-openapi.ts`.

## Zahlen

- Operationen insgesamt: **100**
- davon live belegt: **94**
- davon nur auf dem Fehlerpfad belegt: **6**
- als MCP-Werkzeug veroeffentlicht: **100**
- zusammengesetzte MCP-Werkzeuge: **1**
- nur lesend: **36**, destruktiv: **30**, Aufraeumen: **7**
- nach einem Produktupdate gesperrt, bis der Build neu verifiziert ist: **34**

## HTTP-Oberflaeche

OpenAPI 3.1.0, Titel „Unoffizielle lokale SteuerSparErklaerung API“.

| Pfad | Methode | Zweck |
| --- | --- | --- |
| `/healthz` | GET | Lokale API-Erreichbarkeit und Version |
| `/v1/operations` | GET | Vollstaendiger API-Katalog mit Schemas und Sicherheitsmerkmalen |
| `/v1/openapi.json` | GET | Diese generierte OpenAPI-3.1-Beschreibung |
| `/v1/operations/{operation}` | GET, POST | Schema und Sicherheitsmerkmale lesen beziehungsweise die Operation ausfuehren (200 Pfadeintraege fuer 100 Operationen) |

## Operationen

`Art` unterscheidet lesende, zustandsaendernde, destruktive und aufraeumende
Operationen. `Drift` markiert die Operationen, die nach einem Produktupdate
gesperrt sind, bis der neue Build live nachverifiziert wurde.

| Operation | MCP-Werkzeug | Art | Drift | Stand |
| --- | --- | --- | --- | --- |
| `accessibility_probe` | `sse_accessibility_probe` | lesend | – | live belegt |
| `archive_cases` | `sse_archive_cases` | destruktiv | – | live belegt |
| `backup_cases` | `sse_backup_cases` | zustandsaendernd | – | live belegt |
| `capabilities` | `sse_capabilities` | lesend | – | live belegt |
| `case_create` | `sse_case_create` | destruktiv | ja | live belegt |
| `case_hash` | `sse_case_hash` | lesend | – | live belegt |
| `center_cases` | `sse_center_cases` | lesend | – | live belegt |
| `center_refresh` | `sse_center_refresh` | zustandsaendernd | – | live belegt |
| `check` | `sse_check_page` | zustandsaendernd | – | live belegt |
| `checker_close` | `sse_checker_close` | Aufraeumen | – | live belegt |
| `checker_detail` | – | zustandsaendernd | – | live belegt |
| `checker_open` | `sse_checker_open` | zustandsaendernd | – | live belegt |
| `checker_reset` | `sse_checker_reset` | Aufraeumen | – | live belegt |
| `checker_results` | `sse_checker_results` | lesend | – | live belegt |
| `checker_run` | `sse_checker_run` | zustandsaendernd | ja | live belegt |
| `click` | `sse_click` | destruktiv | ja | live belegt |
| `click_point` | `sse_click_point` | destruktiv | ja | live belegt |
| `close` | `sse_close` | Aufraeumen | – | live belegt |
| `collect` | `sse_collect` | zustandsaendernd | – | live belegt |
| `combo_options` | `sse_combo_options` | zustandsaendernd | – | live belegt |
| `combo_select` | `sse_combo_select` | destruktiv | ja | live belegt |
| `desktop_start` | `sse_desktop_start` | zustandsaendernd | – | live belegt |
| `desktop_status` | `sse_desktop_status` | zustandsaendernd | – | live belegt |
| `desktop_stop` | `sse_desktop_stop` | Aufraeumen | – | live belegt |
| `dialog_answer` | `sse_dialog_answer` | destruktiv | ja | live belegt |
| `dialog_list` | `sse_dialog_list` | lesend | – | live belegt |
| `dismiss` | `sse_dismiss` | Aufraeumen | – | live belegt |
| `export_csv` | `sse_export_csv` | zustandsaendernd | – | live belegt |
| `file_dialog_select` | `sse_file_dialog_select` | destruktiv | ja | live belegt |
| `fill_fields` | `sse_fill_fields` | destruktiv | ja | live belegt |
| `find` | `sse_find` | lesend | – | live belegt |
| `get_value` | `sse_get_value` | lesend | – | live belegt |
| `goto` | `sse_goto` | zustandsaendernd | ja | live belegt |
| `health` | `sse_health` | lesend | – | live belegt |
| `help` | `sse_help` | lesend | – | live belegt |
| `instances` | `sse_instances` | lesend | – | live belegt |
| `known_page_state` | `sse_page_state` | lesend | – | live belegt |
| `launch` | `sse_launch` | zustandsaendernd | – | live belegt |
| `list_cases` | `sse_list_cases` | lesend | – | live belegt |
| `make_working_copy` | `sse_make_working_copy` | zustandsaendernd | – | live belegt |
| `menu` | `sse_menu` | zustandsaendernd | – | live belegt |
| `menu_click` | `sse_menu_click` | destruktiv | ja | live belegt |
| `menu_close` | `sse_menu_close` | Aufraeumen | – | live belegt |
| `page` | `sse_page` | lesend | – | live belegt |
| `page_objects` | `sse_page_objects` | lesend | – | live belegt |
| `positions` | `sse_positions` | lesend | – | live belegt |
| `product_info` | `sse_product_info` | lesend | – | live belegt |
| `read_full` | `sse_read_full` | lesend | – | live belegt |
| `read_page` | `sse_read_page` | lesend | – | live belegt |
| `read_table` | `sse_read_table` | lesend | – | live belegt |
| `receipt_manager_action` | `sse_receipt_manager_action` | zustandsaendernd | ja | live belegt |
| `receipt_manager_bulk_upsert` | `sse_receipt_manager_bulk_upsert` | destruktiv | ja | live belegt |
| `receipt_manager_classification_options` | `sse_receipt_manager_classification_options` | zustandsaendernd | ja | live belegt |
| `receipt_manager_classify` | `sse_receipt_manager_classify` | destruktiv | ja | live belegt |
| `receipt_manager_delete` | `sse_receipt_manager_delete` | destruktiv | ja | live belegt |
| `receipt_manager_import` | `sse_receipt_manager_import` | destruktiv | ja | live belegt |
| `receipt_manager_link` | `sse_receipt_manager_link` | destruktiv | ja | live belegt |
| `receipt_manager_list` | `sse_receipt_manager_list` | lesend | – | live belegt |
| `receipt_manager_read` | `sse_receipt_manager_read` | zustandsaendernd | ja | live belegt |
| `receipt_manager_update` | `sse_receipt_manager_update` | destruktiv | ja | live belegt |
| `result_details` | `sse_result_details` | lesend | – | live belegt |
| `save` | `sse_save` | destruktiv | ja | live belegt |
| `save_as` | `sse_save_as` | destruktiv | ja | live belegt |
| `scenario_run` | `sse_run_scenario` | destruktiv | – | live belegt |
| `screenshot` | `sse_screenshot` | zustandsaendernd | – | live belegt |
| `scroll` | `sse_scroll` | zustandsaendernd | – | live belegt |
| `scroll_page` | `sse_scroll_page` | zustandsaendernd | – | live belegt |
| `set_value` | `sse_set_value` | zustandsaendernd | ja | live belegt |
| `snapshot` | `sse_snapshot` | lesend | – | live belegt |
| `snapshot_compare` | `sse_snapshot_compare` | lesend | – | live belegt |
| `subpages` | `sse_subpages` | lesend | – | live belegt |
| `table_add` | `sse_table_add` | destruktiv | ja | live belegt |
| `table_delete` | `sse_table_delete` | destruktiv | ja | live belegt |
| `table_read` | `sse_table_read` | zustandsaendernd | – | live belegt |
| `table_update` | `sse_table_update` | destruktiv | ja | live belegt |
| `toggle` | `sse_toggle` | destruktiv | ja | live belegt |
| `tracked_set_value` | `sse_change_known_field` | destruktiv | ja | live belegt |
| `tree_scroll` | `sse_tree_scroll` | zustandsaendernd | – | live belegt |
| `tree_top` | `sse_tree_top` | zustandsaendernd | – | live belegt |
| `ui_state` | `sse_ui_state` | lesend | – | live belegt |
| `ustva_change_value` | `sse_ustva_change_value` | destruktiv | ja | live belegt |
| `ustva_open_section` | `sse_ustva_open_section` | zustandsaendernd | ja | live belegt |
| `ustva_read` | `sse_ustva_read` | lesend | – | live belegt |
| `ustva_select_period` | `sse_ustva_select_period` | destruktiv | ja | live belegt |
| `ustva_set_flag` | `sse_ustva_set_flag` | destruktiv | ja | live belegt |
| `vast_apply` | `sse_vast_apply` | destruktiv | ja | nur Fehlerpfad belegt |
| `vast_dialog_read` | `sse_vast_dialog_read` | lesend | – | nur Fehlerpfad belegt |
| `vast_mapping_options` | `sse_vast_mapping_options` | lesend | – | nur Fehlerpfad belegt |
| `vast_mapping_select` | `sse_vast_mapping_select` | destruktiv | ja | nur Fehlerpfad belegt |
| `vast_row_details` | `sse_vast_row_details` | lesend | – | nur Fehlerpfad belegt |
| `vast_row_set_expanded` | `sse_vast_row_set_expanded` | zustandsaendernd | ja | nur Fehlerpfad belegt |
| `verify` | `sse_verify` | lesend | – | live belegt |
| `warning_popup_read` | `sse_warning_popup_read` | lesend | – | live belegt |
| `window_close` | `sse_window_close` | Aufraeumen | – | live belegt |
| `window_restore` | `sse_window_restore` | zustandsaendernd | – | live belegt |
| `windows` | `sse_windows` | lesend | – | live belegt |
| `workspace_file_list` | `sse_workspace_files` | lesend | – | live belegt |
| `workspace_file_read_text` | `sse_workspace_read_text` | lesend | – | live belegt |
| `workspace_file_write_text` | `sse_workspace_write_text` | zustandsaendernd | – | live belegt |
| `workspace_status` | `sse_workspace_status` | lesend | – | live belegt |

## MCP-Werkzeuge

Der Server meldet 101 Werkzeuge.

### `sse_accessibility_probe`

**Qt-Accessibility eines Elements untersuchen**

Rein lesende Tiefenpruefung fuer ein exakt adressiertes UI-Element.

Operation: `accessibility_probe` (lesend).

### `sse_archive_cases`

**Alte Steuerfaelle sicher archivieren**

Verschiebt eine exakt benannte und SHA256-gebundene Menge nicht uebermittelter Falldateien aus dem aktiven Fallordner in einen neuen Archivordner.

Operation: `archive_cases` (destruktiv).

### `sse_backup_cases`

**Steuerfaelle sichern**

Kopiert alle Falldateien in einen Sicherungsordner und schreibt SHA256-Pruefsummen.

Operation: `backup_cases` (zustandsaendernd).

### `sse_capabilities`

**SSE-API-/MCP-Faehigkeiten und sichere Fallbacks lesen**

Liefert PC-blind die verfuegbaren Selektoren, Klickmuster, Dialogantworten und die sichere generische Fallback-Leiter.

Operation: `capabilities` (lesend).

### `sse_case_create`

**Neuen Steuerfall anlegen**

Legt einen neuen, leeren Steuerfall an: startet die SteuerSparErklaerung ohne Datei auf dem SICHTBAREN Desktop, fuehrt den echten Startassistenten (Jetzt beginnen -> Navigator-Modus -> Weiter) bis zur ersten Stammdatenseite und speichert den Fall sofort ueber den Programmdialog 'Speichern unter' unter targetRef.

Operation: `case_create` (destruktiv, drift-gesperrt).

### `sse_case_hash`

**Steuerfall pruefen und hashen**

Liest eine Falldatei ohne die SteuerSparErklaerung zu oeffnen.

Operation: `case_hash` (lesend).

### `sse_center_cases`

**Fallliste im Steuertipps-Center lesen**

Liest den Hauptbildschirm des Steuertipps-Centers in den Modi 'Verzeichnis' und 'Zuletzt verwendet'.

Operation: `center_cases` (lesend).

### `sse_center_refresh`

**Fallliste im Steuertipps-Center aktualisieren**

Aktualisiert ausschliesslich die fingerprintgebundene Center-Fallliste, indem kurz in den jeweils anderen Modus und danach in den gelesenen Ausgangsmodus zurueckgeschaltet wird.

Operation: `center_refresh` (zustandsaendernd).

### `sse_change_field`

**Feld atomar aendern und Steuerwirkung verfolgen**

Bevorzugter schneller Schreibweg fuer ein einzelnes Feld.

Operation: `tracked_set_value` (destruktiv, drift-gesperrt).

### `sse_change_known_field`

**Bekanntes Page-Object-Feld atomar aendern**

Schneller, stabiler Schreibweg fuer ein im Page-Object-Katalog definiertes Feld.

Operation: `tracked_set_value` (destruktiv, drift-gesperrt).

### `sse_check_page`

**Seite pruefen**

Prueferlage der aktuellen Seite: Meldungen des Eingabepruefers, rot markierte Fehler im Navigationsbaum, leere Pflicht-Auswahlfelder und der angezeigte Ergebniswert (Gewinn bzw.

Operation: `check` (zustandsaendernd).

### `sse_checker_close`

**Steuerpruefer-Ergebnisleiste schliessen**

Schliesst genau die linke Ergebnisleiste des globalen Steuerpruefers über ihre offizielle Automation-ID.

Operation: `checker_close` (Aufraeumen).

### `sse_checker_open`

**Steuerpruefer-Meldung oeffnen und lesen**

Oeffnet genau eine Meldung aus sse_checker_results und liest ihre aufgeklappte Detailkarte.

Operation: `checker_open` (zustandsaendernd).

### `sse_checker_reset`

**Steuerpruefer-Detailkarten sicher schliessen**

Schliesst alle aufgeklappten Detailkarten im globalen Steuerpruefer von unten nach oben mit gezielten Klicks.

Operation: `checker_reset` (Aufraeumen).

### `sse_checker_results`

**Globale Steuerpruefer-Ergebnisse lesen**

Liest den aktuell sicher per UIA erreichbaren Ergebnisbaum des globalen Steuerpruefers ohne Serienklicks oder Tastaturnavigation.

Operation: `checker_results` (lesend).

### `sse_checker_run`

**Globalen Steuerpruefer starten**

Startet auf der Seite 'Steuererklaerung pruefen' den fallweiten Software-Pruefer und liefert die sicher erreichbaren Fragen/Warnungen und Tipps samt Konsistenzstatus.

Operation: `checker_run` (zustandsaendernd, drift-gesperrt).

### `sse_click`

**Element ausloesen**

Loest ein Bedienelement ueber UI Automation aus - NICHT ueber Bildschirmkoordinaten.

Operation: `click` (destruktiv, drift-gesperrt).

### `sse_click_point`

**Element wirklich anklicken**

Echter, PID- und Root-verifizierter Mausklick, fail-closed auf TreeItems des Navigationsbaums, eng benannte Erfassen-/Bearbeiten-Hyperlinks sowie den intern fingerprintgebundenen read-only Prueferpfad begrenzt.

Operation: `click_point` (destruktiv, drift-gesperrt).

### `sse_close`

**Programm beenden**

Beendet das Programm nur nach einem ausdruecklichen menschlichen Auftrag zum Schliessen.

Operation: `close` (Aufraeumen).

### `sse_collect`

**Erklaerung segmentweise erfassen**

Kontrollierter, auf hoechstens 5 Seiten begrenzter Diagnose-Snapshot ab der aktuellen Seite.

Operation: `collect` (zustandsaendernd).

### `sse_combo_options`

**Dropdown-Optionen sicher lesen**

Oeffnet genau eine ComboBox ueber ExpandCollapsePattern, liest die aktuell materialisierten, ihr zugeordneten Optionen und schliesst sie danach wieder ohne Auswahl.

Operation: `combo_options` (zustandsaendernd).

### `sse_combo_select`

**Dropdown-Option verifiziert waehlen**

Waehlt eine exakt beschriftete Option aus genau einer ComboBox.

Operation: `combo_select` (destruktiv, drift-gesperrt).

### `sse_desktop_start`

**Programm unsichtbar starten**

Startet die SteuerSparErklaerung auf einem EIGENEN, unsichtbaren Windows-Desktop.

Operation: `desktop_start` (zustandsaendernd).

### `sse_desktop_status`

**Laeuft die Instanz versteckt?**

Prueft die markierte eigene PID und meldet auch eine veraltete oder unvollstaendige Desktop-Marke.

Operation: `desktop_status` (zustandsaendernd).

### `sse_desktop_stop`

**Unsichtbare Instanz beenden**

Beendet die Instanz auf dem versteckten Desktop und raeumt ihn auf.

Operation: `desktop_stop` (Aufraeumen).

### `sse_dialog_answer`

**Dialog sicher beantworten**

Beantwortet genau einen zuvor gelesenen Dialog.

Operation: `dialog_answer` (destruktiv, drift-gesperrt).

### `sse_dialog_list`

**Dialoge sicher lesen**

Listet alle SSE-Fenster, klassifiziert native und Qt-Dialoge und liefert Texte, erlaubte Antwortschaltflaechen sowie einen SHA256-Fingerprint.

Operation: `dialog_list` (lesend).

### `sse_dismiss`

**Warnfenster schliessen**

Schliesst nur bekannte kompakte, nicht-modale Fenster: Steuer-Spar-Tipps, Werte-Info und Schatten-Popups.

Operation: `dismiss` (Aufraeumen).

### `sse_export_csv`

**CSV-Export ausloesen**

Loest 'Datei > Export fuer das Finanzamt (CSV-Dateien)' aus.

Operation: `export_csv` (zustandsaendernd).

### `sse_file_dialog_select`

**Datei oder Ordner im offenen Windows-Dialog sicher waehlen**

Bedient genau einen bereits offenen nativen Oeffnen-, Speichern- oder Ordnerauswahl-Dialog.

Operation: `file_dialog_select` (destruktiv, drift-gesperrt).

### `sse_fill_fields`

**Mehrere bekannte Felder in einem Worker befuellen**

Befuellt ein bis 20 katalogisierte pageId/fieldId-Felder derselben bereits geoeffneten Seite in genau einem frischen PowerShell-Worker.

Operation: `fill_fields` (destruktiv, drift-gesperrt).

### `sse_find`

**Element suchen**

Sucht Bedienelemente nach Beschriftung.

Operation: `find` (lesend).

### `sse_get_value`

**Feldwert lesen**

Liest den Inhalt genau eines Eingabefeldes samt Schreibschutz-Kennzeichen.

Operation: `get_value` (lesend).

### `sse_goto`

**Seite ansteuern**

Navigiert bevorzugt ueber eine stabile pageId, alternativ ueber die exakte Ueberschrift.

Operation: `goto` (zustandsaendernd, drift-gesperrt).

### `sse_health`

**Zustand pruefen**

Prueft, ob die SteuerSparErklaerung laeuft und ansprechbar ist.

Operation: `health` (lesend).

### `sse_help`

**Hilfespalte lesen**

Liest die rechte Spalte: Eingabehilfe, Steuertipps und Prueferhinweise zur aktuellen Seite.

Operation: `help` (lesend).

### `sse_instances`

**Offene Steuerfaelle unterscheiden**

Nennt jeden offenen Steuerfall mit Fenster-ID, Falldatei, Falltyp (z.

Operation: `instances` (lesend).

### `sse_launch`

**Programm starten**

Startet die SteuerSparErklaerung, optional direkt mit einer Falldatei.

Operation: `launch` (zustandsaendernd).

### `sse_list_cases`

**Steuerfaelle auflisten**

Listet die Falldateien eines Ordners und liest ihren Klartext-Kopf: Modul, Jahr, Steuernummer, und vor allem ElsterTransferTime - daran erkennt man OHNE das Programm zu oeffnen, ob eine Erklaerung bereits ans Finanzamt uebermittelt wurde.

Operation: `list_cases` (lesend).

### `sse_make_working_copy`

**Verifizierte Kopie einer Steuerfalldatei**

Erstellt eine neue, bytegleiche Kopie einer Steuerfalldatei ohne UI, Tastatur oder Dialog.

Operation: `make_working_copy` (zustandsaendernd).

### `sse_menu`

**Menue oeffnen und lesen**

Ohne name: listet die Menuezeile (Datei, Bearbeiten, Ansicht, Extras, Musterbriefe, Service, ?).

Operation: `menu` (zustandsaendernd).

### `sse_menu_click`

**Menueeintrag ausloesen**

Loest einen zuvor mit sse_menu ermittelten Menueeintrag aus.

Operation: `menu_click` (destruktiv, drift-gesperrt).

### `sse_menu_close`

**Menue sicher schliessen**

Schliesst ein offenes Menue ueber dessen ExpandCollapsePattern und prueft, dass keine Popup-/Schattenfenster mehr vorhanden sind.

Operation: `menu_close` (Aufraeumen).

### `sse_page`

**Seite vollstaendig erfassen**

DAS HAUPTWERKZEUG.

Operation: `page` (lesend).

### `sse_page_objects`

**Bekannte SSE-Seiten und Felder lesen**

Liest den versionierten Page-Object-Katalog mit stabilen Seiten-, Fenster- und Feld-IDs.

Operation: `page_objects` (lesend).

### `sse_page_state`

**Bekannte Seite schnell und versionsfest lesen**

Liest eine katalogisierte Seite ueber exakte relative AutomationIds statt einer freien Volltextsuche.

Operation: `known_page_state` (lesend).

### `sse_positions`

**Positionen auflisten**

Listet die auf der aktuellen Uebersichtsseite sichtbaren Einnahmen-/Ausgabenpositionen.

Operation: `positions` (lesend).

### `sse_preflight`

**Installation und Laufzeit in einem Schritt pruefen**

Fuehrt vor der ersten fachlichen Arbeit genau einmal die drei read-only Pruefungen sse_workspace_status, sse_product_info und sse_health in dieser Reihenfolge aus.

Setzt sich zusammen aus: `workspace_status`, `product_info`, `health`.

### `sse_product_info`

**Aktive SSE-Produktgrenze pruefen**

Liest die erwartete Steuerjahres-/Engine-Identitaet des von der API konfigurierten Produktprofils, prueft die installierte Standarddatei und listet laufende verifizierte bzw.

Operation: `product_info` (lesend).

### `sse_read_full`

**Seite vollstaendig lesen (mit Rollen)**

Liest eine LANGE Seite vollstaendig: rollt den Inhaltsbereich stufenweise durch und fuegt die Ergebnisse zusammen.

Operation: `read_full` (lesend).

### `sse_read_page`

**Seite lesen**

Liest die aktuell angezeigte Eingabeseite als Zeilen 'Beschriftung = Wert'.

Operation: `read_page` (lesend).

### `sse_read_table`

**Tabelle lesen**

Liest die Eingabetabelle der aktuellen Seite (z.

Operation: `read_table` (lesend).

### `sse_receipt_manager_action`

**BelegManager-Navigation (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_action` (zustandsaendernd, drift-gesperrt).

### `sse_receipt_manager_bulk_upsert`

**Belege gesammelt importieren (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_bulk_upsert` (destruktiv, drift-gesperrt).

### `sse_receipt_manager_classification_options`

**BelegManager-Klassifikation waehlen (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_classification_options` (zustandsaendernd, drift-gesperrt).

### `sse_receipt_manager_classify`

**Beleg klassifizieren (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_classify` (destruktiv, drift-gesperrt).

### `sse_receipt_manager_delete`

**Beleg loeschen (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_delete` (destruktiv, drift-gesperrt).

### `sse_receipt_manager_import`

**Belegdatei importieren (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_import` (destruktiv, drift-gesperrt).

### `sse_receipt_manager_link`

**Beleg mit Steuerseite verknuepfen (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_link` (destruktiv, drift-gesperrt).

### `sse_receipt_manager_list`

**Belege strukturiert lesen**

Liest die bereits geoeffnete BelegManager-Listenansicht ohne Klick und ohne Fokuswechsel.

Operation: `receipt_manager_list` (lesend).

### `sse_receipt_manager_read`

**Belegdetails auswaehlen (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_read` (zustandsaendernd, drift-gesperrt).

### `sse_receipt_manager_update`

**Belegfelder befuellen (gesperrt)**

Dieses Werkzeug ist im aktuellen Hintergrundbetrieb gesperrt, weil sein verifizierter BelegManager-Weg das sichtbare Fenster oder globale physische Eingabe benoetigt.

Operation: `receipt_manager_update` (destruktiv, drift-gesperrt).

### `sse_result_details`

**Steuerergebnis und Auswirkungen lesen**

Liest die ausklappbare Ergebnisanzeige rechts unten als strukturierte Qt-Tabelle: Nachzahlung/Erstattung, Einkuenfte, Vorsorgeaufwendungen, Steuer, Soli, Steuersatz und weitere konfigurierte Werte.

Operation: `result_details` (lesend).

### `sse_run_scenario`

**SSE-Szenario reproduzierbar ausfuehren**

Fuehrt eine versionierte JSON-Szenariodatei aus dem API-Arbeitsbereich seriell aus.

Operation: `scenario_run` (destruktiv).

### `sse_save`

**Steuerfall sicher speichern**

Speichert nur den bereits geoeffneten, referenzierten Steuerfall.

Operation: `save` (destruktiv, drift-gesperrt).

### `sse_save_as`

**Steuerfall sicher speichern unter**

Oeffnet den echten SSE-Dialog 'Speichern unter...' mit Strg+Alt+S, setzt den Zielpfad ueber UI Automation und prueft anschliessend Zieldatei, SHA256 und Fenstertitel.

Operation: `save_as` (destruktiv, drift-gesperrt).

### `sse_screenshot`

**Bildschirmfoto**

Fotografiert das Fenster (PrintWindow).

Operation: `screenshot` (zustandsaendernd).

### `sse_scroll`

**Scrollen**

Rollt den Inhalt.

Operation: `scroll` (zustandsaendernd).

### `sse_scroll_page`

**Inhaltsbereich rollen**

Rollt den Inhaltsbereich der Seite (nicht Tabellen - dafuer sse_table_read).

Operation: `scroll_page` (zustandsaendernd).

### `sse_set_value`

**Globales Suchfeld transaktional setzen**

Kompatibler Low-Level-Name fuer genau das bekannte, steuerneutrale globale SSE-Suchfeld.

Operation: `set_value` (zustandsaendernd, drift-gesperrt).

### `sse_snapshot`

**Elementbaum**

Vollstaendiger Elementbaum des Fensters (schneller UIA-Bulk-Cache mit explizitem TreeWalker-Fallback).

Operation: `snapshot` (lesend).

### `sse_snapshot_compare`

**Bulk-Snapshot gegen sicheren Altpfad vergleichen**

Read-only A/B-Diagnose: liest denselben SSE-Zustand einmal mit dem zyklusgeschuetzten TreeWalker und einmal mit dem schnellen UIA-Bulk-Cache.

Operation: `snapshot_compare` (lesend).

### `sse_subpages`

**Unterseiten auflisten**

Listet die weiterfuehrenden Schalter der Seite ('Erfassen', 'Bearbeiten', 'Position erfassen' ...) samt der Beschriftung links davon - also wozu jeder fuehrt.

Operation: `subpages` (lesend).

### `sse_table_add`

**Tabellenzeile anlegen**

Legt eine neue Tabellenzeile als gepruefte Transaktion an.

Operation: `table_add` (destruktiv, drift-gesperrt).

### `sse_table_delete`

**Tabellenzeile loeschen**

Loescht genau eine Tabellenzeile.

Operation: `table_delete` (destruktiv, drift-gesperrt).

### `sse_table_read`

**Tabelle vollstaendig lesen**

Liest eine Eingabetabelle VOLLSTAENDIG - im Gegensatz zu sse_read_table, das nur die sichtbaren Zeilen liefert.

Operation: `table_read` (zustandsaendernd).

### `sse_table_update`

**Sichtbare Tabellenzeile sicher aktualisieren**

Aktualisiert eine eindeutig ueber einen vorhandenen Zelltext gefundene, sichtbare Tabellenzeile ueber Qt-ValuePattern sowie fuer boolesche Tabellenzellen ueber TogglePattern und funktioniert deshalb auch auf dem versteckten Desktop.

Operation: `table_update` (destruktiv, drift-gesperrt).

### `sse_toggle`

**Checkbox transaktional setzen**

Setzt genau eine echte UIA-CheckBox auf einen erwarteten booleschen Zustand.

Operation: `toggle` (destruktiv, drift-gesperrt).

### `sse_tree_scroll`

**Navigationsbaum kontrolliert rollen**

Rollt den virtualisierten Qt-Navigationsbaum nach oben oder unten, ohne einen Knoten zu aktivieren.

Operation: `tree_scroll` (zustandsaendernd).

### `sse_tree_top`

**Navigationsbaum nach oben rollen**

Rollt den virtualisierten Qt-Navigationsbaum per sicher positioniertem Mausrad an den Anfang.

Operation: `tree_top` (zustandsaendernd).

### `sse_ui_state`

**Lagebeurteilung**

Schneller, konsistenter Read-only-Snapshot fuer die laufende SSE-Instanz.

Operation: `ui_state` (lesend).

### `sse_ustva_change_value`

**UStVA-Wert transaktional aendern**

Aendert ein katalogisiertes UStVA-Betrags- oder Korrekturfeld im gebundenen, zuvor hashverifiziert gesicherten Arbeitsfall mit exaktem Vorwert, Qt-Commit und Readback.

Operation: `ustva_change_value` (destruktiv, drift-gesperrt).

### `sse_ustva_open_section`

**Eindeutigen UStVA-Unterbereich oeffnen**

Oeffnet einen UStVA-Unterbereich ueber dessen stabile AutomationId und verifiziert die exakte Zielseite.

Operation: `ustva_open_section` (zustandsaendernd, drift-gesperrt).

### `sse_ustva_read`

**Umsatzsteuer-Voranmeldung strukturiert lesen**

Liest die UStVA-Uebersicht sowie die gebundenen §13b- und Vorsteuer-Detailseiten 2025/2026 als stabile Fachstruktur: Zeitraum, Kennzeichen, Bemessungsgrundlagen, Steuerbetraege, Vorsteuer und Zahllast/Erstattung.

Operation: `ustva_read` (lesend).

### `sse_ustva_select_period`

**UStVA-Zeitraum sicher auswaehlen**

Waehlt genau EIN UStVA-Dropdown ueber stabile semantische Schluessel: frequency, month oder quarter.

Operation: `ustva_select_period` (destruktiv, drift-gesperrt).

### `sse_ustva_set_flag`

**UStVA-Kennzeichen sicher setzen**

Setzt genau ein fachlich benanntes UStVA-Kennzeichen mit Vor-/Nachzustand, Fenster-, Fall- und Hashbindung.

Operation: `ustva_set_flag` (destruktiv, drift-gesperrt).

### `sse_vast_apply`

**VaSt-Zuordnungsplan übernehmen**

Übernimmt genau den zuvor vollständig gelesenen VaSt-Zuordnungsplan in den offenen Steuerfall.

Operation: `vast_apply` (destruktiv, drift-gesperrt).

### `sse_vast_dialog_read`

**VaSt-Zuordnungen sicher lesen**

Liest den offiziellen Dialog 'Daten der vorausgefüllten Steuererklärung' als sieben bzw.

Operation: `vast_dialog_read` (lesend).

### `sse_vast_mapping_options`

**VaSt-Zuordnungsziele lesen**

Öffnet nur das Dropdown einer exakt gebundenen VaSt-Zeile, liest dessen Ziele aus dem sichtbaren Qt-Popup und schließt es ausschließlich nach bestätigtem Popup per Escape.

Operation: `vast_mapping_options` (lesend).

### `sse_vast_mapping_select`

**Eine VaSt-Zuordnung ändern**

Wählt genau ein zuvor gelesenes lokales Ziel für eine FA-Bescheinigung.

Operation: `vast_mapping_select` (destruktiv, drift-gesperrt).

### `sse_vast_row_details`

**Eine VaSt-Bescheinigung lesen**

Klappt genau eine durch certificate+occurrence adressierte VaSt-Zeile kurz auf, liest die FA-Werte strukturiert mit OCR-Rückfall und stellt anschließend denselben mappingFingerprint und Aufklappzustand wieder her.

Operation: `vast_row_details` (lesend).

### `sse_vast_row_set_expanded`

**VaSt-Zeile kontrolliert auf- oder zuklappen**

Ändert nur den Ansichtszustand einer exakt fingerprintgebundenen VaSt-Zeile.

Operation: `vast_row_set_expanded` (zustandsaendernd, drift-gesperrt).

### `sse_verify`

**Sollwerte abgleichen**

Vergleicht erwartete Werte gegen einen exakt SHA256-gebundenen sse_collect-JSON-Stand und meldet jede Abweichung mit Soll, Ist und Differenz.

Operation: `verify` (lesend).

### `sse_warning_popup_read`

**Automatische Pruefhinweise lesen**

Liest das offene Qt-Fenster 'Die Pruefung hat ergeben ...' vollstaendig.

Operation: `warning_popup_read` (lesend).

### `sse_window_close`

**Nebenfenster sicher schliessen**

Schliesst nur ein im Produktprofil freigegebenes nicht-modales Hilfe- oder Ergebnisfenster.

Operation: `window_close` (Aufraeumen).

### `sse_window_restore`

**Minimiertes Hauptfenster sicher wiederherstellen**

Stellt ausschliesslich ein von sse_windows frisch gelesenes, verifiziertes SSE-Hauptfenster aus dem minimierten Zustand wieder her.

Operation: `window_restore` (zustandsaendernd).

### `sse_windows`

**Fenster auflisten**

Listet alle sichtbaren Fenster des aktiven, verifizierten SSE-Produktprofils oder des SteuertippsCenters samt Groesse und Haenge-Status.

Operation: `windows` (lesend).

### `sse_workspace_files`

**SSE-Arbeitsdateien auflisten**

Listet maschinenneutrale Dateireferenzen, Groesse und SHA256 in einem konfigurierten API-Ressourcenbereich.

Operation: `workspace_file_list` (lesend).

### `sse_workspace_read_text`

**SSE-Textdatei lesen**

Liest hoechstens 1 MiB UTF-8-Text aus einer maschinenneutralen Ressourcenreferenz und liefert SHA256.

Operation: `workspace_file_read_text` (lesend).

### `sse_workspace_status`

**SSE-Arbeitsbereich pruefen**

Prueft ueber die API, ob Arbeits-/Ergebnisbereich, Fallordner und optionaler SSE-Programmpfad eingerichtet sind.

Operation: `workspace_status` (lesend).

### `sse_workspace_write_text`

**SSE-Textdatei sicher schreiben**

Schreibt hoechstens 1 MiB UTF-8-Text exklusiv in eine neue relative Dateireferenz.

Operation: `workspace_file_write_text` (zustandsaendernd).

## Serveranweisung

Der MCP-Server gibt Clients diese Anweisung mit:

> Diese Tools steuern eine lokal installierte SteuerSparErklaerung unter Windows.
> Als ersten fachlichen Tool-Aufruf sse_preflight verwenden und
> dessen Blocker befolgen. Nur bei ready=true danach mit sse_instances den Arbeitsfall binden.
>
> Harte Grenzen, auch auf ausdruecklichen Wunsch:
> - Niemals ueber ELSTER senden, uebermitteln, bestaetigen oder abschliessen.
> - Originalfaelle nie loeschen, umbenennen oder auf Dateiebene ueberschreiben;
>   uebermittelte Faelle nie speichern oder veraendern.
> - Ist genau ein Steuerfall bereits offen, ist er der Arbeitsfall. Nicht still
>   eine Arbeits-/Korrekturkopie erzeugen oder oeffnen, keinen anderen Fall
>   starten und den offenen Fall weder speichern noch schliessen.
> - Vor der ersten Aenderung oder einer UI-Navigation, die den Fall dirty machen
>   kann, den aktuellen Dateihash lesen und mit sse_make_working_copy genau eine
>   hashverifizierte Sicherung nach backups: erzeugen. Dieselbe Sicherung fuer
>   denselben Fall und unveraenderten Dateihash in der laufenden Aufgabe
>   wiederverwenden; nicht vor jedem Tool-Aufruf neu sichern. Nach einem
>   ausdruecklich beauftragten Speichern muss die naechste Aenderung den neuen
>   Dateistand erneut sichern. Eine backups:-Sicherung niemals oeffnen.
> - Aendern erlaubt kein Speichern. sse_save nur nach ausdruecklichem Auftrag zum
>   Speichern; sse_save_as oder eine cases:-Kopie nur, wenn der Mensch genau eine
>   neue Datei/Kopie verlangt. Muss fuer einen anderen Fall gewechselt werden und
>   der offene Fall ist ungespeichert, zuerst den Menschen fragen; nie still
>   speichern, verwerfen, schliessen oder wechseln.
> - Erfolg erst nach Readback behaupten; ein Exitcode genuegt nicht.
>
> Wenn du dem Menschen fachliche Ergebnisse mitteilst:
> - Belege strittige oder betragsrelevante Punkte an offiziellen deutschen
>   Quellen, sofern dir Websuche zur Verfuegung steht. Ohne Webzugriff erklaere
>   die steuerfachliche Bewertung ausdruecklich fuer unterblieben.
>   Rangfolge: Gesetz (gesetze-im-internet.de), dann BMF-Schreiben
>   (bundesfinanzministerium.de; aeltere nur noch im Bundessteuerblatt,
>   bstbl.de), dann amtliche Anleitungen (formulare-bfinv.de, elster.de),
>   dann BFH (bundesfinanzhof.de), dazu bzst.de fuer Belegabruf und
>   Auslandsfaelle. Ratgeberseiten und Foren sind keine Belegstellen.
>   Pruefe immer, ob die Fundstelle zum Veranlagungszeitraum des Falls passt.
> - Die Steuertipps im Programm (sse_help, rechte Spalte) und das
>   Steuertipps-Center geben die Auffassung des Herstellers fuer dieses
>   Produktjahr wieder. Guter Einstieg und guter Hinweis, wo etwas hingehoert
>   - aber keine Rechtsquelle. Vor der Websuche lohnt trotzdem der Blick
>   dorthin: schneller und sicher zum Falljahr passend.
> - Sag Unsicherheit offen, statt zu raten.
> - Nenne bei jeder fachlichen Aussage beides: dass dies keine Steuerberatung
>   im Sinne des Steuerberatungsgesetzes ist und keine ersetzt, und dass
>   KI-Aussagen Fehler enthalten koennen und vor der Abgabe zu pruefen sind.
>
> Den vollstaendigen sicheren Ablauf beschreibt der Skill
> steuer-spar-erklaerung. Ist er verfuegbar, folge ihm.
