# Statustafel: alles, was es gibt, mit Stand

Eine Tafel statt vier Dokumente. Jede bekannte Faehigkeit von
SteuerSparErklaerung mit dem Stand bei uns, dem Beleg und dem Weg, auf dem sie
zu bauen waere.

**Stand: 2026-09-03**, SSE `31.0.2.0` / `[31.31]`, API `0.1.0-beta.36`.
Diese Tafel ist von Hand gepflegt und veraltet zwangslaeufig. Die erzeugte
[API-Referenz](../API-REFERENZ.md) ist immer aktuell; sie sagt aber nur, was da
ist, nicht was fehlt.

## Legende

| Zeichen | Bedeutung |
| --- | --- |
| **fertig** | live belegt, im Ergebnisvertrag, in der Suite |
| **teils** | erreichbar, aber eingeschraenkt - Detail steht in der Zeile |
| **offen** | keine Operation, kein Profil |
| **zu** | bewusst dauerhaft geschlossen, keine Luecke |

## Die grossen Zahlen

| | Produkt | Bei uns |
| --- | --- | --- |
| Module (Fallarten) | 7 | 3 angefasst, davon 2 live gefahren |
| Seiten (`.dialog`-Dateien) | 672 | **alle lesbar**, mit sichtbarem Vordergrund auch beschreibbar; 17 katalogisiert – siehe unten |
| Menueeintraege | 64 | 11 fertig, 9 teils, 4 zu |
| Formularvorlagen (`.frb`) | 994 | 0 |
| Operationen | – | 100, davon 94 live belegt |

## Was „17 katalogisierte Seiten" wirklich heisst

Diese Zahl wird leicht falsch gelesen. Der Seitenkatalog ist **keine
Zugangsschranke**, sondern eine Bequemlichkeits- und Sicherheitsschicht.

Von hundert Operationen brauchen genau **zwei** einen Katalogeintrag:

| Operation | warum |
| --- | --- |
| `fill_fields` | plant eine Feldtransaktion ueber `pageId` und `fieldId` und rollt bei verletzten Nachbedingungen zurueck |
| `known_page_state` | vergleicht gegen einen hinterlegten Sollzustand |

Alles Uebrige arbeitet auf **jeder** der 672 Seiten:

- **Lesen** ist durchgehend generisch: `page`, `read_page`, `table_read`,
  `positions`, `collect`, `snapshot`.
- **Schreiben** geht auch ohne Katalog: `tracked_set_value` nimmt statt
  `pageId`/`fieldId` auch `name`, `aid` oder `rid` - der Aufrufer liefert dann
  Erwartungswerte und Seitenueberschrift selbst und traegt die Verantwortung
  fuer die Bindung.
- **Tabellen** kennen gar keine `pageId`: `table_add`, `table_update` und
  `table_delete` binden ueber `expectedPage` als Zeichenkette.

**Eine Grenze bleibt, und sie ist wichtig:** Das gilt fuer Schreibwege mit
sichtbarem Vordergrund. Auf einem privaten Desktop laesst der Worker nur
profilierte Focusless-Pfade zu - heute genau **einen** - und stoppt sonst
fail-closed mit `hidden-desktop`. Und dass jede der 672 Seiten per `goto`
erreichbar ist, folgt aus der Bauart, ist aber nicht gemessen: `goto`
navigiert ueber die Programmsuche, und was nicht im Stichwortverzeichnis
steht, ist unbelegt.

Ein Katalogeintrag bringt also: benannte, stabile `pageId`/`fieldId` statt
selbst gebauter Selektoren, hinterlegte Beschriftung, Wertart und Ueberschrift,
Zustandsvergleiche und den geplanten Mehrfeld-Schreibweg mit Rollback.

`set_value` ist die eine Ausnahme in die andere Richtung: absichtlich auf das
globale Suchfeld beschraenkt, weil ein direkter Schreibzugriff Qt-Commit,
Ergebnis-Diff und Seitenobjekte umgehen wuerde.

## Module

| Modul | Endung | Rubriken | Stand | Weg |
| --- | --- | --- | --- | --- |
| Einkommensteuer | `.ESt2025` | 9 | **teils** – Hauptmodul der Live-Reisen, 9 Seitenobjekte | Seiten profilieren |
| Gewinnermittlung | `.Gew2025` | 15 | **teils** – 6 Seitenobjekte, UStVA ausgebaut | Seiten profilieren |
| Gewinn-Erfassung | `.GewErfass2026` | 12 | **teils** – 2 Seitenobjekte, live gefahren (`case_create`, Folgejahr-UStVA) | Seiten profilieren |
| Gesonderte Feststellung | `.GesondFest2025` | 11 | **offen** | Profil, dann Seiten |
| Lohnsteuer-Ermaessigung | `.Freib2026` | 14 | **offen** | Profil, dann Seiten |
| Prognose | `.EStProg2026` | 4 | **offen** | Profil, dann Seiten |
| Konsolidierte Umsatzsteuer | `.KonsUSt2025` | – | **offen** – laesst sich per Dateiargument gar nicht oeffnen („Ungueltiger Modus") | erst den Startweg klaeren |

Die 672 Seiten liegen in **einem** flachen Ordner, nicht je Modul getrennt; die
sieben Module sind sieben Datenmodelle ueber demselben Seitenvorrat. „Ein Modul
profilieren" ist deshalb keine sinnvolle Einheit - profiliert wird eine Seite.
Belege in der [Seitenlandkarte](funktionskatalog.md).

## Fall und Datei

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Fall anlegen | **fertig** | `case_create` |
| Fall oeffnen | **fertig** | `launch`, Dateidialog ueber `file_dialog_select` |
| Zuletzt verwendete Dateien | **offen** | wir listen aus dem Dateisystem, nicht aus der Programmhistorie |
| Speichern / Speichern unter | **fertig** | `save`, `save_as`, `make_working_copy` |
| Fall schliessen | **fertig** | `close` |
| Falldatei hashen und binden | **fertig** | `case_hash`, `list_cases` |
| Sicherung, Archiv | **teils** | `backup_cases`, `archive_cases` arbeiten auf Dateiebene; die programmeigene Sicherungskopie ist etwas anderes |
| Passwortschutz | **offen** | Menue „Passwort setzen/aufheben…"; `setPassword`/`checkPassword` im Datenmodell |
| Autosave und Wiederherstellung | **zu** | nur die Rueckfrage wird beantwortet, und dort ausschliesslich `Nein` |
| Anonymisierter Export | **offen** | `writeAnonymizedDataFile` im Datenmodell; im Handbuch nicht genannt |

## Navigieren und Lesen

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Zu einer Seite navigieren | **fertig** | `goto` – ueber Suchfeld und Doppelklick, weil die UIA-Muster des Baums nicht wirken |
| Seite lesen | **fertig** | `page`, `read_page`, `known_page_state`, `ui_state` |
| Tabellen lesen | **fertig** | `table_read`, `read_table`, `positions` |
| Unterseiten finden | **fertig** | `subpages` – „Erfassen"-Verweise sind echte Schaltflaechen |
| Baum blaettern | **teils** | `tree_top`, `tree_scroll` – Aufzaehlen der Seiten geht darueber nicht |
| Suche als eigene Operation | **offen** | `goto` nutzt die Suche intern; es gibt keinen direkten Zugriff |
| Einzelwerte und Elemente lesen | **fertig** | `find`, `get_value`, `read_full`, `accessibility_probe` |
| Rollen und Bildschirmfoto | **fertig** | `scroll`, `scroll_page`, `screenshot` |
| Seitenkatalog abfragen | **fertig** | `page_objects` – gibt aus, welche Seiten und Felder benannt sind |
| Ansicht umschalten (Anlage, Formular, Darstellung) | **offen** | Menue Ansicht |

## Schreiben

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Felder schreiben | **fertig** | `tracked_set_value` auf jeder Seite ueber `name`/`aid`/`rid`; `fill_fields` nur auf katalogisierten Seiten. Fokusloses Schreiben ist fuer **einen** Feldpfad profiliert. `set_value` bleibt auf das Suchfeld beschraenkt |
| Tabellenzeilen fuehren | **fertig** | `table_add`, `table_update`, `table_delete` |
| Auswahlfelder | **fertig** | `combo_options`, `combo_select`, `toggle` |
| Klicken | **fertig** | `click`, `click_point` – mit sichtbarer Vordergrund-Lease |
| Rueckgaengig / Wiederherstellen | **offen** | es gibt kein Undo ueber die API |
| Zwischenablage | **offen** | Ausschneiden, Kopieren, Einfuegen |
| Erlaeuterung, Notiz | **offen** | Menue Bearbeiten |
| Direkt ins Datenmodell schreiben | **zu** | `WriteToDM` existiert im Programm; wir schreiben nur ueber profilierte Feldpfade mit Readback |

## Belege

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Belege auflisten | **fertig** | `receipt_manager_list` – der einzige fokuslose Weg |
| Lesen, Aendern, Klassifizieren, Importieren, Loeschen, Verknuepfen, Massenpflege | **teils** | `receipt_manager_*` – neun weitere Operationen, alle nur mit sichtbarem Vordergrund |
| Belege entknuepfen | **offen** | Gegenrichtung zu `receipt_manager_link` fehlt |
| Belegempfehler und Checkliste | **offen** | gehoert zum Druckweg |

## Umsatzsteuer und Selbstaendige

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Umsatzsteuer-Voranmeldung | **fertig** | fuenf `ustva_*`-Operationen |
| Anlagevermoegen, Fahrzeugkosten | **teils** | Seitenobjekte vorhanden |
| Umsatzsteuer-Jahreserklaerung | **offen** | eigene Rubrik der Gewinnermittlung |
| Gewerbesteuererklaerung | **offen** | eigene Rubrik der Gewinnermittlung |
| Lohnsteuer-Anmeldung | **offen** | eigene Rubrik der Gewinn-Erfassung |
| Dauerfristverlaengerung | **offen** | vom Hersteller genannt |

## Pruefen

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Eingabepruefung | **fertig** | `check` |
| Steuerpruefer | **fertig** | sechs `checker_*`-Operationen |
| Ergebnis und Vergleich | **teils** | `result_details`, Fenster `resultComparison` profiliert |
| Steuer-Spar-Tipps | **teils** | Fenster `taxTips` nur lesend |
| Sollwerte abgleichen | **fertig** | `verify`, `snapshot_compare` |
| Automatische Pruefhinweise | **fertig** | `warning_popup_read` |
| Sparpotenzial | **offen** | vermutet Teil des Ergebnisbereichs, nicht gemessen |
| Szenarien „Was waere wenn" | **offen** | **Namensfalle:** unser `scenario_run` ist ein Arbeitsbereichs-Skriptlauf, nicht diese Funktion |

## Bescheid

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Bescheiddaten abholen | **offen** | eigene Rubrik im Navigationsbaum |
| Steuerbescheidpruefung | **offen** | lesende Funktion, faellt **nicht** unter die ELSTER-Sperre |
| Einspruchs-Generator | **offen** | eigene Rubrik im Navigationsbaum |

## Import und Uebernahme

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Datenuebernahme aus dem Vorjahr | **offen** | eigene Rubrik und Menueeintrag |
| VaSt-Abruf | **teils** | sechs `vast_*`-Operationen, live nur auf dem Fehlerpfad – ohne Zertifikat-PIN kam kein Datensatz |
| Fremdformate (SSX, QIF, CSV, SDI) | **offen** | Menue „Import" |
| Daten des Ehepartners | **offen** | `isSpouseVisible` im Datenmodell |
| VLH-Import und -Export | **offen** | `vlhImport`, `vlhExport` im Datenmodell; im Handbuch nicht genannt |

## Ausgabe

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| GoBD-CSV-Export | **fertig** | `export_csv` – die **einzige** Ausgabe, die wir haben |
| Drucken, Druckfilter, Druckvorschau | **offen** | 994 Formularvorlagen im Programm |
| Formulardruck in amtliche Formulare | **offen** | |
| Ausgabe als PDF oder RTF | **offen** | |
| Musterbriefe (neun Vorlagentypen) | **offen** | vollstaendig leeres Menue |

## Programm und Umgebung

| Faehigkeit | Stand | Beleg / Detail |
| --- | --- | --- |
| Instanzen, Fenster, Dialoge | **fertig** | `instances`, `windows`, `dialog_list`, `dialog_answer`, `dismiss`, `window_close`, `window_restore` |
| Steuertipps-Center | **fertig** | `center_cases`, `center_refresh` |
| Diagnose, Arbeitsbereich | **fertig** | `health`, `product_info`, `capabilities`, `workspace_*` |
| Privater Desktop | **fertig** | `desktop_start`, `desktop_status`, `desktop_stop` |
| Menuezeile bedienen | **fertig** | `menu`, `menu_click`, `menu_close` |
| Update-Angebot erkennen | **fertig** | `updatePrompt` am Dialog – ausloesen bleibt gesperrt |
| Optionen und Einstellungen | **offen** | Menue Extras |
| Steuerrechner, Steuertabellen, Kalender | **offen** | Menue Extras |
| Hilfe, Steuerwissen, KI-Assistent | **teils** | `help` liest die Hilfespalte; alles Uebrige offen |

## Dauerhaft geschlossen

| Faehigkeit | Warum |
| --- | --- |
| ELSTER und jede Uebermittlung | Grenze des Projekts |
| Automatisches Speichern | der Zeitpunkt bleibt beim Benutzer |
| Freischaltcode, Lizenzierung | fassen wir nicht an |
| Online-Zugang, Fernwartung (TeamViewer) | gehoert nicht in eine Automatisierung |
| Umgehen der Build-Sperre | nach einem Produktupdate bleiben Mutationen gesperrt, bis der Build live nachverifiziert ist |
| Steuerberatung | die API bedient ein Programm, sie beurteilt nichts |

## Woher die Angaben stammen

| Quelle | Was daraus kommt |
| --- | --- |
| Messung in der Forschungs-VM, 2026-09-03 | Module und Rubriken, Menueinventar, Dateizaehlung, das Verhalten der UIA-Muster |
| Programmdateien der Installation | 672 Seiten, 994 Vorlagen, 7 Datenmodelle, 2 Stichwortverzeichnisse |
| Statische Analyse (im Repository) | Kommandonamen, `DMSession`-Methoden |
| Herstellerhandbuch | Funktionsgruppen – oeffentlich nur Jahrgang **2023**, fuer 2025 nicht belegt |
| Unser Repository | Operationsliste, Seitenkatalog, Verifikationsstand |

Details und Belege: [Funktionskatalog](funktionskatalog.md),
[Aktionsinventar](aktionsinventar.md), [Roadmap](../ROADMAP.md).
