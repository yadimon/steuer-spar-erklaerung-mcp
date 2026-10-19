# API/MCP-Stabilisierung: Fortschritt und Restarbeit

## Arbeitsstand und Ziel

`main` enthält den zuvor geprüften Stabilisierungsstand. Die Kernkorrekturen sind umgesetzt und gezielt geprüft.
Die vorgesehenen Offline-, Live-, Mega-, nativen, Last- und Paketprüfungen sind abgeschlossen. Die erneute native Mega-Reise besteht ebenfalls; ein früherer kontrollierter Abbruch bleibt in seiner Ursache ungeklärt. Eine Freigabe für Produktivinstallation oder Veröffentlichung wird daraus nicht vorweggenommen.

Ziel sind komfortable Low-Level-Operationen und überprüfte höhere Abläufe: Identität und Ausgangszustand lesen, Aktion gezielt ausführen, Ergebnis frisch lesen und prüfen.
Unbekannte Mutationsergebnisse werden zuerst abgeglichen. Ein Timeout erlaubt weder blindes Wiederholen noch einen alternativen Eingriff.

## Aktuelle Nacharbeit

Die private native Positionierung erhält einen eng begrenzten Abschluss nach
einer bestätigten ersten lokalen Ablehnung ohne Aktion. Explizite native
No-op-Metadaten, eine nachgewiesene Übernahme ohne Eingabe und unveränderte
Fenster-/Modell-/Eingabe-/Lease-Bindungen sind Voraussetzungen. Der Abschluss
behält den aktuellen Fokus und Cursor; normale Wiederherstellung behält ihren
eigenen Quellfokusnachweis. Eine unerwartete Wiederherstellung bleibt unbekannt.
Die ursprüngliche Positionierungsablehnung wird nicht als Erfolg umgedeutet.

Die neuen tatsächlichen Transaktions- und Worker-Lease-Verträge scheitern am
vorherigen Verhalten und bestehen mit der Änderung. Die vollständige
Offline-Suite besteht ebenfalls. Runtime, Plugin und natives Paket sind neu
gebaut; die zugehörige reale native Abnahme und Paketprüfung stehen noch aus.

Die Zustandsreise fordert den Cursor nun in beiden Backends ausdrücklich mit
`noKeys: false` an. Eine zusätzliche opt-in Regression erhält die direkte Folge
Add, passiver Readback, Update mit derselben Zellidentität und prüft danach
vollständige Inventare. Sie hat einen nativen Cursorfehler nach Update belegt:
Ein seitentitelabhängiger Pfad konnte den durch HOME geöffneten Nr.-Editor
nicht korrekt nachweisen. Nummerierte Tabellen wählen nun anhand ihrer
Struktur den vorhandenen Modell-Schrittweg; widersprüchliche Bindungen scheitern
vor jeder Aktion. Neue positive und negative Verträge bestehen nach der
Korrektur. Die erneute reale Abnahme steht noch aus.

Die Verzögerung beim ersten nativen Unicode-Schreiben ist erneut reproduziert:
Die feine Diagnose bindet sie an `QLineEdit::insert` vor dem `textEdited`-Signal.
Ein passiver Abgleich bestätigt den späteren einmaligen Commit; der fehlgeschlagene
Aufruf bleibt fehlgeschlagen und wird nicht wiederholt. Accessibility-Zustellung
und Font-/Layout-Initialisierung werden getrennt untersucht. Keine dieser
Ursachen ist bereits bewiesen oder behoben.

## Umgesetzt und belegt

- **Lebenszyklus und Cleanup:** Eigentümerschaft über kurzlebige Worker hinweg, tatsächliches Fallfenster beim Start, begrenztes Beenden und Schutz fremder Instanzen.
  Wrapper erhalten Primärfehler und Child-Exit-Code; frühe Fehler, asynchrone Cleanup-Fristen und überlebende Prozess-Peers sind regressionsgeprüft.
- **Standardcursor:** Vorhandenen gebundenen Fokus wiederverwenden oder vorab
  genau eine sichere Nr.-Zellenaktivierung wählen. Identität, GridItem,
  direkte Trefferfläche, Sichtbarkeit, Auswahl und unveränderte Werte bleiben
  Voraussetzungen. Ein schmaleres Feld innerhalb des exakten Headers ist erlaubt;
  verschobene, überstehende oder verdeckte Flächen werden abgewiesen.
  Für einen abgeschnittenen ursprünglichen Anker wird eine getrennte vollständig
  sichtbare Nr.-Zelle mit eindeutigem Rohzeilen-/Semantik- und Inhaltsnachweis
  gebunden. Ihre RID und echte Grid-Zeile bleiben über den Einzelklick fest;
  der ursprüngliche Leseanker wird nicht ersetzt. Der reale Übergang nach
  Werte-Info, Hilfe und Update besteht in der vollständigen Zustandsreise.
- **Nr.-Editor und ESC:** Ein Nummerneditor darf die Navigation nur mit eigenem
  unverändertem ausgewähltem Zellnachweis tragen. ESC-Ausgang und spätere Navigation bleiben getrennt
  diagnostiziert; verlorene Ergebnisse erhalten auch öffentlich ihre Unsicherheit.
  `physicalInputAttempted` und `physicalInputUsed` unterscheiden Versuch,
  bestätigte Ausführung und unbekannten Ausgang. Kein automatisches Replay.
- **Auswahl nach HOME:** Der öffentliche Standardcursor gleicht nach dem eigenen
  Sprung zum Anfang bei Bedarf genau einmal die Auswahl mit der frisch bewiesenen
  unveränderten Nr.-Zelle auf Modellzeile 0 ab. Identität, RAW, Grid, Wert und
  Eingabe-/Fensterkontext bleiben Voraussetzungen. Bereits passende Auswahl
  benötigt keine Aktion; nach einer Auswahl folgen vollständiger unveränderter
  Roh-/Typ-/Checkbox-Readback und frischer Fokus-/Auswahlnachweis vor DOWN.
- **Fokus nach Seitenwechsel:** Die Nr.-Aktivierung erhält einen eigenen
  ausdrücklich profilierten Ausgangspunkt für das nicht editierbare
  Hilfe-Root-Dokument. Geladene Provider-Version, vollständige editorfreie
  Tabelle, genaue Quell-/Fensteridentität und erneute Prüfung vor dem
  bestehenden Einzelklick bleiben Voraussetzungen. Die allgemeine
  Dokument-/Editorfreigabe wird dadurch nicht erweitert.
- **Passive Quelle mit erhaltener Auswahl:** Nach der Werte-Info darf der
  bestehende Nachweis einer eigenen passiven Quelle die einmalige Aktivierung
  tragen. Eine vorhandene Auswahl benötigt zusätzlich frische sichtbare
  Zell-, Grid-, Container- und Zeilennachweise sowie eine identische erneute
  Prüfung vor dem Klick. Unbekannte Auswahl bleibt gesperrt; die bisherigen
  Positionsnamen- und Hilfedokument-Pfade bleiben unverändert begrenzt.
- **Tipps-Vorbereitung:** Nur das explizit profilierte, direkt eigene nicht modale
  Fenster vor der ersten Bindung schließen. Inhalte, Identitäten, Eingabe,
  Vordergrund, Prozess, Owner und Fensterbestand bleiben streng gebunden.
  Ausschließlich bei gleicher vollständiger Nicht-Geometrie-Signatur sowie
  unveränderter Seite und Dirty-Lage ist eine zusätzliche passive Bestätigung
  zulässig. Sie muss die neue Geometrie vollständig bestätigen; nach WM_CLOSE
  gilt der bestätigte Zustand ohne erneute Stabilisierung oder Close-Wiederholung.
  Eine zusätzliche genau katalogisierte Werte-Info darf ausschließlich als
  nicht im Vordergrund stehender, vollständig unveränderter Beobachter gebunden
  werden. Nur Tipps werden geschlossen; unbekannte Peers bleiben gesperrt.
- **Cursorleistung:** Beim bereits eigenen fokussierten Edit entfällt ein
  anschließend verworfener Tabellenlauf. Der Hinweis wählt nur den Prüfpfad;
  vollständiger frischer Tabellen-/Auswahl-, RAW-, Grid- und Wertnachweis bleiben.
  Fremder Fokus, Hint-Lesefehler, Fokuswechsel und private Phasen sind abgedeckt.
  Reale Vergleiche bestätigen vollständige gleiche Ergebnisse und weniger
  Doppelarbeit bei beibehaltenen RAW-Nachweisen und Navigationsschritten.
- **Grid-Lesen:** `table_read` mit `readMode: "grid"` liest explizit ohne Fokus-,
  Scroll- oder Schreibaktion. Rohzeilen, Eingabeslot, typisierte Werte und
  Checkboxzustände sind geprüft. Grid-Lesen ersetzt keine Cursor-/Schreibabnahme.
- **Getter:** Explizite Namensräume `uia` und `qt-object`, unverändertes
  Legacy-Routing und frühe Ablehnung widersprüchlicher Identitäten. HTTP/MCP-
  Getter-/Schreib-/Rücksetzreisen am selben UIA-Feld sowie echte native Getter
  über QObject-Namen und beobachtete Qt-Identität sind belegt.
- **Native Diagnose:** Begrenzte wertfreie Phasen für Erfolg und Timeout. Native Qt-Tests einschließlich mehrsprachiger Mutation,
  expliziter Getter und absichtlichem Commit-Timeout mit passivem Abgleich bestehen bei unveränderten Operationsfristen.
  Ein ungewisser Commit wird nicht erneut gesendet.
  Fehlgeschlagene native Positionierungen erhalten feste Ablehnungsgründe und
  getrennte boolesche Freigabenachweise. Die Mega-Berichte bewahren diese
  begrenzte Diagnose; der ursprüngliche Fehler bleibt erhalten.
- **Begrenzte Busy-Wiederholung:** Der optionale Client-/CLI-Helfer erlaubt höchstens drei Versuche nur für eine validierte HTTP-409-Ablehnung vor Dispatch. Instanzidentität und gemeinsames Zeitbudget bleiben gebunden. Workerfehler, verlorene Antworten und ungewisse Schreibausgänge werden nicht erneut gesendet.
- **Verträge:** Produktionsfunktionen und echte Dispatcher-/Finish-Abschnitte werden geprüft.
  Schema-, Ergebnis-, Privacy-, Plugin- und Dokumentationsgates behalten ihre Grenzen; das OpenAPI-Größenlimit wurde nicht angehoben.
- **Kompakte MCP-Tabellenantwort:** `sse_read_table` erhält die vorhandene
  Vollständigkeitsangabe `incomplete` auch im JSON-Text. `false`, `true` und
  fehlende Angabe bleiben unterscheidbar; das vollständige `structuredContent`
  bleibt unverändert.

## Reale Abdeckung und ihre Reichweite

Kleine und große gespeicherte Standard-Ausgangsfixtures stimmen vollständig mit unabhängigen Rohwert-, Typ- und Checkboxorakeln überein.
Tabellenende, sichtbare letzte Geschäftszeile, unverändertes Grid und unveränderte Falldaten sind geprüft.
Die jüngste kleine Regression bestätigt zusätzlich die tatsächliche ESC-Route samt Metadaten.

Die unmodifizierte Zustandsreise bestätigt vollständige Tabelleninventare
unmittelbar nach Anlegen, Ändern und Löschen sowie nach drei Seitenwechseln,
Werte-Info und Hilfelesen. Die geöffnet bleibende Werte-Info darf als exakt
gebundener unveränderter Beobachter neben Tipps bestehen. Die große direkte
Add-/Cursor-/Delete-/Cursorfolge bestätigt zusätzlich Rohwerte, typisierte
Werte, Checkboxzustände und unveränderte unbeteiligte Zeilen. Rückbau,
Falldatenintegrität und Cleanup sind in beiden Reisen bestätigt.

Add-/Update-/Delete-Reisen mit nativer Konfiguration, offenem Tipps-Fenster, Nullbetrag und Off→On→Off erhalten alle übrigen Zeilen einschließlich Rohfingerprints.
Tabellenänderungen bleiben hybrid: native Modell-/Positionierungsnachweise ergänzen den Worker-Schreibpfad; ein direkter Qt-DLL-Schreibhandler wird nicht behauptet.
Die kanonischen Standard- und nativen Mega-Reisen bestehen in ihrem jeweils deklarierten Operationsumfang mit Mutation-/Readback-Prüfungen.
Zulässige Dialog-Skips betreffen tatsächlich nicht vorhandene Startdialoge.
Eine frühere native Mega-Reise wurde beim Positionsnachweis vor einer Änderung
abgewiesen; zusätzlich konnte die Lease-Freigabe nicht vollständig bestätigt
werden. Eingabe und Mutation fanden dabei nicht statt. Der genaue native
Ablehnungsgrund fehlt im damaligen Bericht und ist noch ungeklärt. Die
vollständige Folgereise reproduziert diesen Abbruch nicht. Neue Berichte
erhalten feste Ablehnungsgründe und getrennte Freigabenachweise.
Positionsgruppen mit Speichern/Wiederöffnen und Steuerwissen mit tatsächlichem Artikelinhalt sind zusätzlich auf dem Entwicklungsstand geprüft.
Das Release-Evidenzregister bleibt ein gesondert gepflegter Snapshot.
Der kanonische produktfreie HTTP/MCP-Soak besteht seine Transport-, Last-,
Abbruch-, Neustart- und Bereinigungsprüfungen. Das belegt keine GUI-Latenz.

## Abschlussprüfungen und Restarbeit

Diese Tabelle beschreibt die abgeschlossene Abnahme des integrierten
Ausgangsstands. Die oben genannte Nacharbeit benötigt ihre eigenen noch offenen
nativen, Live- und Paketnachweise.

| Prüfbereich | Status |
| --- | --- |
| Vollständiges `npm test` einschließlich Abschlussbilanzen | **PASS** – normale Suite einschließlich jüngster Diagnoseänderung, ohne Schreiboptionen für Referenzkataloge |
| Direkte Zustandsreise und große Add-/Delete-Cursorfolge | **PASS** – vollständige Standardcursor-/Modellorakel und Cleanup |
| Vollständiges `npm run test:live` | **PASS** – beide Profile, alle vorgesehenen Funktionsphasen und Abschlussbilanzen |
| Kanonischer API/MCP-Soak mit voller Mindestdauer | **PASS** – synthetischer Executor, volle Last- und Cleanup-Prüfung |
| Abschließende Standard-Mega-Reise | **PASS** – deklarierter Operationsumfang |
| Native Mega-Reise | **PASS** – vollständige Folgereise; Ursache des früheren Abbruchs bleibt offen |
| Native Integration und installierte Produktprüfung | **PASS** – getrennte Komponenten- und Produktgrenzen |
| Paketbau, Publish-Probelauf und saubere Testinstallation | **PASS** – Paketinhalt und isoliert installierter API-/MCP-Vertrag |
| Finaler Doku-/Runtime-Abgleich | **PASS** – Dokumentation und erzeugtes Plugin synchron |

Bereits bestandene Prüfungen früherer Quellstände ersetzen diese Abschlussgates nicht. Nach Codeänderungen die betroffenen Nachweise erneut ausführen.
Die abschließende Diagnoseänderung ist zusätzlich durch die normale vollständige
Offline-Suite und eine eigene native Mega-Reise geprüft. Die Standardbedienungs-
und Transportpfade der übrigen Funktionsnachweise sind unverändert.
Der Stabilisierungsbranch ist nach `main` integriert. Produktivinstallation und Veröffentlichung bleiben getrennte Schritte.
Es wurden keine Veröffentlichung, kein Push und keine Produktivinstallation vorgenommen.

## Grenzen und nächste Entscheidungen

- Cursorlesen und native Positionsnachweise bleiben aufwendig; der explizite Grid-Pfad ist die schnelle
  Leseoption, sofern seine Voraussetzungen und Vollständigkeitsgrenzen passen.
  Die Vergleiche begründen keine allgemeine Latenz- oder Durchsatzgarantie.
- Die Ursache einer früheren sporadischen Verzögerung beim ersten nativen
  Unicode-Schreiben ist offen. Spätere erfolgreiche Läufe beweisen keine Behebung.
- Der frühere native Positionsabbruch bleibt ungeklärt. Die erfolgreiche
  Folgereise beweist keine Behebung seiner Ursache. Bei erneutem Auftreten die
  erhaltene Ablehnungsdiagnose und die Freigabeflags auswerten; kein Replay.
- Beliebige Steuerfeld-/Labelzuordnungen sind nicht vollständig belegt.
  Ein positiver VaST-Ende-zu-Ende-Ablauf ist mangels externer Voraussetzungen nicht ausgeführt.
- Profil 2024 bleibt experimentell mit `operationAccess: "verification-only"`.
  Es wird keine allgemeine Schreibfreigabe behauptet; andere Produktfreigaben gelten ausschließlich innerhalb ihrer dokumentierten Profilrichtlinien.
- Zwei gleiche Beobachtungen sind kein atomarer Snapshot. Ein gemeldetes
  Tabellenende exportiert keine unabhängige Identität der letzten Auswahl.
- Synchron blockierender JS-/OS-Code kann nicht durch einen Timer desselben
  Prozesses unterbrochen werden. Unbewiesenes Cleanup bleibt fail-closed.

## Reproduzierbare Abschlussprüfung

Aus dem Repository-Stamm, mit den dokumentierten Produktvoraussetzungen und Wegwerfkopien; alle GUI-/Controller-Versuche seriell ausführen:

```powershell
npm test
npm run test:qt-native
npm run test:product
npm run test:live
npm run perf:api-mega -- --classification=cold
$soakEvidence = Join-Path ([IO.Path]::GetTempPath()) ('sse-api-load-' + [guid]::NewGuid().ToString('N'))
npm run perf:api-load-soak -- --output $soakEvidence
npm run docs:check
npm run check:plugin
npm run pack
npm run publish:dry-run
npm run test:npm-clean-install
```

Die Mega-Reise getrennt mit dokumentierter Standard- und verifizierter nativer Backendkonfiguration prüfen.
Der kanonische Soak benötigt mindestens 15 Minuten; sein neuer Ausgabeordner bleibt außerhalb des Repositorys.
Vor Veröffentlichung gilt zusätzlich `npm run check` als vollständiges Release-Gate.

Die Abschlussgates prüfen die jeweils betroffenen Quell-/Runtimebereiche;
Cleanup, Datenintegrität und Doku-/Runtime-Abgleich sind bestätigt.
Offene externe Abdeckung und ungeklärte Fehlerursachen bleiben auch dann ausdrücklich benannt.
