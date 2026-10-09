# Backlog: schnelle und nachvollziehbare Arbeitsabläufe

Dieses Backlog beschreibt geplante Verbesserungen an API, MCP und Tests.
Ein Eintrag ist keine Zusage, dass die Funktion bereits existiert oder ihre
Wirkung gemessen wurde. Umsetzung und Abschluss brauchen den angegebenen
Nachweis. Vorhandene Mechanismen werden erweitert; ihre Bindungs- und
Übermittlungsgrenzen bleiben bestehen.

## Aktueller Umsetzungsstand

Die [Native-Matrix](../NATIVE-COVERAGE.md) führt jede der 102 Operationen.
Die 22 dort als **Qt optional** markierten Operationen sind direkt an die
optionale Qt-Brücke angeschlossen. Die folgende Bilanz ergänzt die Aufgaben; vorhandene
Teilmechanismen erfüllen nicht automatisch deren gesamten Abnahmevertrag.
`desktop_status` und `desktop_start` besitzen zusätzlich direkte Win32-Pfade im
optionalen nativen Paket; `desktop_stop` nutzt dort Win32 und begrenztes COM-UIA.
Weitere Lebenszyklus-Kompositionen und Live-Varianten bleiben in N07 offen.

| Aufgabe | Bereits vorhanden | Noch erforderlich |
| --- | --- | --- |
| B03: semantisches Tabellenlesen | typisierte Checkboxzustände; Qt-Tabellenmodell mit sichtbarer Spaltenreihenfolge und Zeilenidentität | vollständige fachliche Projektion weiterer Zelltypen und Auswahlvarianten |
| B04: Vollständigkeit | begrenzter atomarer Qt-Modellsnapshot; Teilstände ausdrücklich markiert; Worker meldet blockierte vollständige Lesung als Fehler | breitere Größen-/Zustandsmatrix und vergleichbarer Gesamtablauf |
| B05: Datum | kalender- und jahresgenauer Vergleich einschließlich zulässiger Anzeigeverkürzung | kurze Eingabe anhand des gebundenen Falljahrs vervollständigen |
| B10: Navigation | nativer `goto`-Handler mit frischem Zielseitenbeweis; bereits erreichtes Ziel beendet die Schleife; abgelaufene Suchbereitschaft beendet den Auftrag vor weiteren Navigationsaktionen | kalte Suche und vollständiger normaler Ende-zu-Ende-Ablauf auf Herstellerfallkopien |
| B08: unbekannter Schreibausgang | nativer Transport erhält bekannte Antworten, quittiert sie und wiederholt keine Mutation | fachliche zeilengenaue Wiederherstellung; Quittung ist kein Readback |
| B01/B02/B06/B07/B09/B11 | einzelne bestehende Operationen und Bindungsregeln | vollständige Batch-, Duplikat-, Struktur- und Steuerwirkungsnachweise laut Aufgabe |

## Native-Integration: nächste Abnahmen

| ID | Aufgabe | Abschlussbedingung |
| --- | --- | --- |
| N01 | Seiten- und Orientierungslesung anbinden | öffentliches Ergebnisschema einschließlich Kindfenstern, Zuständen, Geometrie und eindeutigen Referenzen; unabhängige Live-Parität auf mehreren Seiten |
| N02 | Feldtransaktion nativ ausführen | Fall/Seite/Vorwert prüfen, normalen Commit auslösen, frischen Wert und geforderte Summen lesen; spätere Fokuswechsel dürfen nicht doppelt committen |
| N03 | Tabellenmutationen anbinden | Zellen sowie Anlage/Löschung getrennt prüfen; Zeilenidentität, unveränderte Nachbarn und unbekannte/teilweise Ausgänge belegen |
| N04 | Native Navigation vollständig abnehmen | `goto` ist angebunden; Auswahl, Aktivierung und fertig geladene richtige Seite getrennt nachweisen; kalte Suchbereitschaft und vollständige Reise prüfen, ohne Fehler durch längere Zeitlimits zu verdecken |
| N05 | Speichern anbinden | bestehende Pfad-/Hash-/Korrekturgrenzen erhalten; Datei und Abschluss statt fester Pause prüfen; Wiederöffnen als Persistenznachweis |
| N06 | BelegManager weiter abnehmen und anbinden | Liste, Detaillesen, reversible Aktionen, Update, Verknüpfung, Klassifikationsoptionen und Klassifikation sind Qt-gebunden; vollständige reale Reise mit Abschlussdaten, Duplikaten und unveränderten Nachbarn belegen; Import, Löschen und Bulk-Upsert behalten ihre bestehenden Wege |
| N07 | Lebenszyklus und weitere Kompositionen beschleunigen | Status und Start über Win32 sowie Stop über Win32/COM-UIA sind implementiert; weitere Start-/Dialogvarianten und verbleibende Workerwege messen |
| N08 | Vergleichbare Ende-zu-Ende-Matrix führen | Handler, Paket, Produkt, Erstbindung und warme Aufrufe kenntlich machen; nur verifizierten Abschluss als Erfolgsdauer zählen |

Diese vollständigen Abnahmen bleiben offen; vorhandene Handler sind Teilumsetzungen.
Die öffentliche Qt-Brücke enthält begrenzte, gebundene Belegmutationen und
Navigation. Allgemeine Feld-/Tabellenschreibzugriffe und Speichern bleiben auf
den bestehenden Transaktionswegen. Handlerzahl und bestandene Offline-Verträge
ersetzen keinen vollständigen nativen Live-Lauf.

## Priorität 1: Tabellen und Belege

| ID | Aufgabe | Abnahmekriterium |
| --- | --- | --- |
| B01 | Mehrere Rechnungszeilen in einem begrenzten Auftrag erfassen | Ein Ausgangsinventar und eine Fallbindung für den Auftrag; jede Zeile erhält eine stabile Zuordnung und einen Readback. Ergebnis nennt bestätigte, fehlgeschlagene und nicht begonnene Zeilen sowie die Endsumme. Eine passende Endsumme allein genügt nicht. |
| B02 | Wiederaufnahme ohne doppelte Buchungen | Wiederholter Auftrag wird anhand der Belegidentität und des aktuellen Zielzustands geprüft. Nach Antwortverlust zuerst den Zustand feststellen; weder eine zweite Zeile anlegen noch einen fremd veränderten Stand zurückrollen. |
| B03 | Tabellenwerte semantisch lesen | Neben Anzeigetexten auch Checkbox- und Auswahlzustände zurückgeben. Insbesondere Nettoeingabe und USt-Kennzeichen dürfen nicht als leere Texte verschwinden. Unbekannter Zustand wird ausdrücklich unbekannt, nicht `false`. |
| B04 | Sichtbare und vollständige Tabellenlesung unterscheiden | Bestehende Batch-Lesung um eindeutigen Vollständigkeitsnachweis, Zeilenidentitäten und messbare Baumdurchläufe ergänzen. Virtualisierte Tabellen, identische Texte und wechselnde Scrollpositionen müssen erkennbar bleiben. |
| B05 | Datumseingaben fachlich normalisieren | Kurzes Datum und vom Produkt ergänztes Jahr werden nur bei passendem Falljahr als gleich behandelt. Tatsächliche Datumsänderungen, ungültige Daten und Jahreswechsel bleiben Fehler. Eine reine Formatänderung ist keine Fremdeingabe. |
| B06 | Benanntes Telefonkonto mit mehreren Rechnungen als Gesamtszenario prüfen | Anlegen beziehungsweise eindeutiges Wiederverwenden, gemischte Netto-/Bruttoeingabe, USt-Kennzeichen, Privatquote und Übersichtssummen gemeinsam prüfen. Das Profil benennt, ob eine Kontrollsumme brutto oder netto ist. |
| B07 | Mehrere Dateien durch den BelegManager führen | Bestehende Import- und Bulk-Upsert-Wege zu einem nachvollziehbaren Gesamtauftrag verbinden. Je Datei Importstatus, Duplikatprüfung, Klassifikation und Verknüpfung zum Zielbeleg prüfen. Inhaltsgleichheit und Rechnungsidentität getrennt behandeln. |

Für B01 ist ein eigener Batch-Vertrag zu entwerfen. Ein vorgeschlagener
Werkzeugname darf erst nach Implementierung in Operationskatalog oder
API-Referenz erscheinen. Die API serialisiert UI-Mutationen weiterhin;
Batch-Verarbeitung bedeutet nicht parallele Klicks auf dasselbe Fenster.

## Priorität 1: eindeutige Ergebnisse nach Störungen

| ID | Aufgabe | Abnahmekriterium |
| --- | --- | --- |
| B08 | Ergebnis einer unterbrochenen Tabellenmutation feststellen | Bei passender Fall- und Seitenbindung einen begrenzten Readback ermöglichen. Zwischen vollständig angewendet, teilweise angewendet, nicht angewendet und nicht feststellbar unterscheiden. Der ursprüngliche Interference-Befund bleibt erhalten; eine inzwischen andere Zielinstanz wird nicht gelesen oder beschrieben. |
| B09 | Unvollständigen Rollback strukturell erklären | Nach einem fehlgeschlagenen Append zwischen zurückgesetzten Feldern, verbliebener leerer Zeile und unbekanntem Zustand unterscheiden. Nur die eindeutig vom Auftrag erzeugte Struktur darf korrigiert werden. Fremde Änderungen dürfen nicht verschwinden. |
| B10 | Navigation am erreichten Ziel beenden | Nach jedem Navigationsschritt die gebundene Zielüberschrift beziehungsweise pageId prüfen. Ein bereits erreichtes Ziel beendet die Suche; spätere Schritte dürfen daraus kein `not-found` machen. Gleichnamige Seiten benötigen weiterhin eindeutige Bindung. |
| B11 | Steuerwirkung einer Buchung nachvollziehbar machen | Im Ergebnis Brutto, Netto, ausgewiesene Steuer, Kontrollsummen und den tatsächlich von SSE berechneten Folgezustand getrennt ausweisen. Rechnungs-Vorsteuer, zeitlich verteilter Aufwand und Umsatzsteuer auf Privatnutzung dürfen nicht verwechselt werden. Keine steuerrechtliche Entscheidung aus einer Summe ableiten. |

Die eigenen Einnahmenpositionen lassen sich bereits mit
[`sse_position_create`](../API-REFERENZ.md) anlegen.
Offen bleibt dafür ein automatisierter Live-Suiteschritt mit leerem und
vorhandenem Inventar, Duplikatversuch, Abbruch und vollständigem Readback.
Die [Live-Bilanz](../VERIFIKATION.md) führt diese Lücke ausdrücklich.

## Priorität 2: Tests und Messungen

| ID | Aufgabe | Abnahmekriterium |
| --- | --- | --- |
| T01 | Voraussetzungen des schnellen Testlaufs früh prüfen | Tests, die ausdrücklich kein SSE-Fenster erwarten, müssen vor ihrem ersten Worker-Aufruf eine klare Vorbedingung erhalten. Der Runner meldet eine ungeeignete Umgebung vor dem Lauf. Keine Tests still überspringen, keine offene Anwendung schließen und keinen fachlichen Assertion-Fehler als Ersatz für die Vorbedingung verwenden. |
| T02 | Den vollständigen ausgeführten Build nachweisen | Tests beziehen Quellstand, Worker, Helper, Paket und Produktprofil auf einen konsistenten Build. Ein einzelner kopierter Worker in einem älteren Paket ist kein Paketnachweis. Saubere Installation und vollständiger Szenariolauf gehören zur Freigabe. |
| T03 | Prozessausgabe und Prozessende getrennt prüfen | Ein `PASS` im Ausgabestrom genügt nicht. Der Harnisch benötigt einen belegten Exitcode, vollständige Ausgabe, Deadline und Nachweis für die Bereinigung eigener Prozesse. Ein Harnischfehler bleibt als solcher sichtbar, auch wenn eine innere Assertion erfolgreich war. |
| T05 | Architekturvarianten am vollständigen Ablauf vergleichen | Datei-/Exportlesung, begrenzte UIA-Komposition, weniger Baumdurchläufe und ein anderer Executor werden nach beseitigtem Aufwand und Integrationskosten verglichen. Wechsel zu C# oder einem langlebigen Worker ist eine Hypothese, kein Geschwindigkeitsnachweis. |
| T06 | Agentenaufwand neben API-Latenz messen | Zusätzlich zu p50/p95 die Anzahl der Aufrufe, Ausgabevolumen, erfolgreiche Abschlüsse und notwendige Nachprüfungen erfassen. API-Zeit und gesamter Agentenablauf erhalten getrennte Messreihen. |

Prüfbare Tabellenzellen sind im nativen Qt-Fixture abgedeckt: Der
Integrationstest vergleicht den Snapshot mit Zellzuständen und den öffentlichen
`read_table`-Aufruf mit einer unabhängigen UIA-TogglePattern-Lesung derselben
Laufzeitkennungen. Angekreuzte und nicht angekreuzte Zellen liefern `true` und
`false`; gewöhnliche Tabellenzellen und der Standard-Snapshot behalten
`checked: null`. Eine teilweise angekreuzte Modellzelle wird ebenfalls gegen
den tatsächlichen UIA-Zustand geprüft. Der Seiten-Oracle benennt die
ersetzte Betriebssystem-Lesung von `Read-SSETableCellSemantic` als Grenze.

Die Testmatrix für Tabellen umfasst 1, 10 und 100 synthetische Rechnungen,
gemischte Steuersätze, gleiche Beschriftungen, wiederholte Aufträge,
virtualisierte Zeilen, Fremdeingabe zwischen zwei Änderungen, Antwortverlust,
Abbruch und unveränderte Nachbarpositionen. Für UI-Läufe zusätzlich kleine
und große Fenster sowie ein- und ausgeklappte Navigation prüfen.

Messungen zerlegen den Ablauf in Bindung, Worker-Start, UIA-Lesung,
Navigation, Schreiben und Readback. Kalte und vorgewärmte Zustände sowie
verschiedene Eingabepausen werden getrennt verglichen. Eine Verbesserung
eines Einzelschritts muss sich auch im gesamten Szenario zeigen. CPU- und
Speicheraufwand gehören zum Vergleich; ausgelagerte Arbeit ist weiterhin
Arbeit.

Vorhandene reproduzierbare Einstiegspunkte sind `npm run perf:api-mega`,
`npm run perf:tax-journeys` und `npm run perf:receipt-workload`. Ihre heutige
Abdeckung ist in den jeweiligen Katalogen beschrieben; sie beweisen noch
keinen der hier geplanten neuen Batch-Verträge. Die passenden Prüfungen
stehen in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Lebenszyklus

Kontrolliertes API-Shutdown und der ausdrückliche Neustart über
`sse_api_control` sind in der [Roadmap](../ROADMAP.md#api-und-mcp-shutdown)
beschrieben. Die API lehnt einen Stopp während laufender Aufträge ab;
Steuerfälle werden dabei weder gespeichert noch geschlossen oder verworfen.
