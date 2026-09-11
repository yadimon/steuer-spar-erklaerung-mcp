# Native-Abdeckung je API-Operation

Diese Matrix zählt den implementierten Qt-DLL-Pfad getrennt vom funktionalen
Live-Stand. Maßgeblich sind [Operationskatalog](../src/api-contract.ts),
[Executor](../src/api-executor.ts) und [Testledger](../test/operation-coverage.json).
Der Live-Stand stammt aus bestehenden Tests; er belegt keinen Wechsel des Backends.

| Kennzahl | Anzahl |
| --- | ---: |
| API-Operationen | 102 |
| Direkt an den optionalen Qt-DLL-Pfad angeschlossen | 10 |
| Ohne direkten Qt-DLL-Pfad | 92 |
| Zusätzliche direkte Win32-Operationen im optionalen nativen Paket | 2 |
| Zusätzliche Win32-/COM-UIA-Operationen im optionalen nativen Paket | 1 |
| Funktional live belegt, unabhängig vom Backend | 94 |
| Live nur auf dem Fehlerpfad belegt | 6 |
| Live ungetestet | 2 |

**Qt optional** bedeutet: Der normale Runtime-Pfad ist implementiert, wird aber
nur mit `qtNativeRuntime` und einem separat gebauten kompatiblen Paket aktiv.
Ohne diese Konfiguration gilt der bestehende Ausführungspfad. **Nicht umgestellt**
bedeutet ausschließlich, dass kein direkter Qt-DLL-Handler angeschlossen ist;
die Operation kann über Node, den Worker oder eine Komposition bereits funktionieren.
**Win32 optional** bezeichnet `desktop_status` und `desktop_start`: direkte
Systemoperationen ohne PowerShell, UIA oder DLL-Injektion. Der Status prüft Marker,
Prozessversion und Desktopfenster. Der Start prüft Profil/Fall, bindet den Prozess
atomar an ein Job Object und übergibt ihn nach exklusivem Marker-Readback.
Startdialoge und unbekannte Ausgänge bleiben explizit. Die Startintegration ist
synthetisch samt öffentlichem HTTP-Pfad und zusätzlich mit einer Herstellerfallkopie,
frischem Qt-Seiten-Readback und normalem Beenden geprüft. Weitere Startmodi und
Dialogzustände benötigen eigene Nachweise. Diese Win32-Pfade zählen separat.
**Win32/UIA optional** bezeichnet `desktop_stop`: ein externer C++-Helfer
liest den Speichern-Zustand und begrenzte Dialogbäume über COM-UIA, schließt ohne
physische Eingabe und beobachtet das gehaltene Prozessobjekt bis zum Ende.
Er speichert nie. Explizites Verwerfen, eindeutige Schaltflächen, Übermittlungssperren
und der exklusive Eigentumsmarker bleiben erforderlich. Die neue Stop-Integration
hat eigene synthetische Tests und drei öffentliche HTTP-Zyklen auf einer unveränderten
Herstellerfallkopie. Tatsächliche SSE-Speicherdialoge benötigen getrennte Live-Nachweise.
Sie ist keine zusätzliche Qt-DLL-Operation.
Insbesondere Dateioperationen benötigen keine DLL in SSE. Die Zahlen sind keine
gewichtete Fortschritts- oder Produktabdeckung und keine Laufzeitzusage.

Die vorhandene C#-Hilfsbibliothek `sse-native.dll` gehört zum Worker. Sie ist
nicht die neue C++-Qt-Brücke `sse-qt-read.dll` im SSE-Prozess. Ihre bisherigen
UIA-/Win32-Funktionen zählen hier nicht als Qt-Umstellung. Auch native Discovery,
Broker und Transportquittungen sind Infrastruktur, keine zusätzlichen API-Kommandos.

## Vollständiger Katalog

| Operation | Bereich | Direkter nativer Pfad | Funktionaler Live-Stand |
| --- | --- | --- | --- |
| `accessibility_probe` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `archive_cases` | Dateien und API | Nicht umgestellt | funktional belegt |
| `backup_cases` | Dateien und API | Nicht umgestellt | funktional belegt |
| `capabilities` | Dateien und API | Nicht umgestellt | funktional belegt |
| `case_create` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `case_hash` | Dateien und API | Nicht umgestellt | funktional belegt |
| `center_cases` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `center_refresh` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `check` | Prüfen und Steuerwissen | Nicht umgestellt | funktional belegt |
| `checker_close` | Prüfen und Steuerwissen | Nicht umgestellt | funktional belegt |
| `checker_detail` | Prüfen und Steuerwissen | Nicht umgestellt | funktional belegt |
| `checker_open` | Prüfen und Steuerwissen | Nicht umgestellt | funktional belegt |
| `checker_reset` | Prüfen und Steuerwissen | Nicht umgestellt | funktional belegt |
| `checker_results` | Prüfen und Steuerwissen | Nicht umgestellt | funktional belegt |
| `checker_run` | Prüfen und Steuerwissen | Nicht umgestellt | funktional belegt |
| `click` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `click_point` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `close` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `collect` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `combo_options` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `combo_select` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `desktop_start` | Programm und Fenster | **Win32 optional** | funktional belegt |
| `desktop_status` | Programm und Fenster | **Win32 optional** | funktional belegt |
| `desktop_stop` | Programm und Fenster | **Win32/UIA optional** | funktional belegt |
| `dialog_answer` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `dialog_list` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `dismiss` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `export_csv` | Dateien und API | Nicht umgestellt | funktional belegt |
| `file_dialog_select` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `fill_fields` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `find` | Seite und Navigation | **Qt optional** | funktional belegt |
| `get_value` | Felder und Bedienung | **Qt optional** | funktional belegt |
| `goto` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `health` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `help` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `instances` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `known_page_state` | Seite und Navigation | **Qt optional** | funktional belegt |
| `launch` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `list_cases` | Dateien und API | Nicht umgestellt | funktional belegt |
| `make_working_copy` | Dateien und API | Nicht umgestellt | funktional belegt |
| `menu` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `menu_click` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `menu_close` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `page` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `page_objects` | Dateien und API | Nicht umgestellt | funktional belegt |
| `position_create` | Felder und Bedienung | Nicht umgestellt | ungetestet |
| `positions` | Seite und Navigation | **Qt optional** | funktional belegt |
| `product_info` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `read_full` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `read_page` | Seite und Navigation | **Qt optional** | funktional belegt |
| `read_table` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `receipt_manager_action` | Belege | Nicht umgestellt | funktional belegt |
| `receipt_manager_bulk_upsert` | Belege | Nicht umgestellt | funktional belegt |
| `receipt_manager_classification_options` | Belege | Nicht umgestellt | funktional belegt |
| `receipt_manager_classify` | Belege | Nicht umgestellt | funktional belegt |
| `receipt_manager_delete` | Belege | Nicht umgestellt | funktional belegt |
| `receipt_manager_import` | Belege | Nicht umgestellt | funktional belegt |
| `receipt_manager_link` | Belege | Nicht umgestellt | funktional belegt |
| `receipt_manager_list` | Belege | **Qt optional** | funktional belegt |
| `receipt_manager_read` | Belege | Nicht umgestellt | funktional belegt |
| `receipt_manager_update` | Belege | Nicht umgestellt | funktional belegt |
| `result_details` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `save` | Speichern | Nicht umgestellt | funktional belegt |
| `save_as` | Speichern | Nicht umgestellt | funktional belegt |
| `scenario_run` | Dateien und API | Nicht umgestellt | funktional belegt |
| `screenshot` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `scroll` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `scroll_page` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `set_value` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `snapshot` | Seite und Navigation | **Qt optional** | funktional belegt |
| `snapshot_compare` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `subpages` | Seite und Navigation | **Qt optional** | funktional belegt |
| `table_add` | Tabellen | Nicht umgestellt | funktional belegt |
| `table_delete` | Tabellen | Nicht umgestellt | funktional belegt |
| `table_read` | Tabellen | **Qt optional** | funktional belegt |
| `table_update` | Tabellen | Nicht umgestellt | funktional belegt |
| `tax_knowledge_search` | Prüfen und Steuerwissen | Nicht umgestellt | ungetestet |
| `toggle` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `tracked_set_value` | Felder und Bedienung | Nicht umgestellt | funktional belegt |
| `tree_scroll` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `tree_top` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `ui_state` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `ustva_change_value` | UStVA | Nicht umgestellt | funktional belegt |
| `ustva_open_section` | UStVA | Nicht umgestellt | funktional belegt |
| `ustva_read` | UStVA | **Qt optional** | funktional belegt |
| `ustva_select_period` | UStVA | Nicht umgestellt | funktional belegt |
| `ustva_set_flag` | UStVA | Nicht umgestellt | funktional belegt |
| `vast_apply` | VaSt | Nicht umgestellt | nur Fehlerpfad |
| `vast_dialog_read` | VaSt | Nicht umgestellt | nur Fehlerpfad |
| `vast_mapping_options` | VaSt | Nicht umgestellt | nur Fehlerpfad |
| `vast_mapping_select` | VaSt | Nicht umgestellt | nur Fehlerpfad |
| `vast_row_details` | VaSt | Nicht umgestellt | nur Fehlerpfad |
| `vast_row_set_expanded` | VaSt | Nicht umgestellt | nur Fehlerpfad |
| `verify` | Dateien und API | Nicht umgestellt | funktional belegt |
| `warning_popup_read` | Seite und Navigation | Nicht umgestellt | funktional belegt |
| `window_close` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `window_restore` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `windows` | Programm und Fenster | Nicht umgestellt | funktional belegt |
| `workspace_file_list` | Dateien und API | Nicht umgestellt | funktional belegt |
| `workspace_file_read_text` | Dateien und API | Nicht umgestellt | funktional belegt |
| `workspace_file_write_text` | Dateien und API | Nicht umgestellt | funktional belegt |
| `workspace_status` | Dateien und API | Nicht umgestellt | funktional belegt |

## Noch erforderliche Integration

- Seiten- und Orientierungsoperationen benötigen eine vollständige Ergebnisprojektion,
  eindeutige Referenzen und eigene Live-Paritätsprüfungen. `snapshot` hat einen
  Qt-Accessibility-Handler mit UIA-kompatiblen Referenzen; `find`, `read_page`
  und `subpages` verwenden ihn bereits. Weitere Seitenoperationen bleiben offen.
  `read_table` ist nicht `table_read`.
- Schreiboperationen benötigen Fall-/Seiten-/Vorwertbindung, normalen SSE-Commit,
  frischen Readback und die jeweils geforderten Summen-/Ergebnisprüfungen.
  `set_value` bleibt auf das globale Suchfeld begrenzt.
- Navigation muss die tatsächlich erreichte Seite bestätigen; eine Auswahl oder
  ein ausgelöstes Signal reicht nicht. Speichern muss Datei und Abschluss prüfen.
- Tabellenanlage/-löschung und Belege benötigen zusätzlich Struktur-, Identitäts-,
  Duplikat- und Wiederherstellungsregeln. Ein einzelner Zellschreibpfad deckt sie nicht ab.
- Ende, Dateien und zusammengesetzte Abläufe werden gesondert optimiert;
  eine schnelle Teiloperation belegt nicht den vollständigen Ablauf.

Die ausgelieferte Qt-Brücke aktiviert keine experimentellen Schreib-, Navigations-
oder Speicheroperationen. `known_page_state`, die read-only-Listenansicht
`positions`, `ustva_read` und `receipt_manager_list` sind dabei katalog- bzw. snapshotgebundene Pfade.
Sie lesen den persistenten Qt-Accessibility-Snapshot und bilden katalogisierte
Felder, Epoch-Bindung beziehungsweise das bestehende fachliche UStVA-Modell ab;
die Belegliste wird dabei an das exakte nichtmodale Tool-Fenster gebunden. Sie
führen keine Mutation aus. Ein Prototyp oder ein statisch gefundenes Herstellersymbol
ändert den Status dieser Matrix erst nach Integration und passendem Nachweis.

## Nachweise und Pflege

Paketbindung, Konfiguration und Prüfgrenzen stehen in [NATIVE-QT.md](NATIVE-QT.md).
[VERIFIKATION.md](VERIFIKATION.md) trennt Offline-, Live- und Leistungsnachweise;
der [Backlog](entwicklung/automations-backlog.md) nennt die offenen Abnahmekriterien.
Laufzeiten werden über `npm run perf:api-mega` und passende Einzelszenarien gemessen,
mit Erstbindung, warmen Aufrufen und verifiziertem Abschluss getrennt.

Bei Änderungen an Katalog, Dispatch oder Testledger diese Matrix einschließlich
aller Summen abgleichen. Prototypen dürfen weder den Live-Testledger hochstufen
noch als ausgelieferte Operation gezählt werden. `npm run docs:check` prüft die
bisherigen Handdokumente, aber nicht automatisch die Vollständigkeit dieser Matrix.
