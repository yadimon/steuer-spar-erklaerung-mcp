# API/MCP-Stabilisierung: Fortschritt und Restarbeit

## Arbeitsstand und Ziel

Die Änderungen liegen im Arbeitsbranch `fix/api-stability-20261017`. Die Kernkorrekturen sind umgesetzt und gezielt geprüft.
Die abschließende Gesamtabnahme des jüngsten Quellstands läuft noch; eine Integrations- oder Veröffentlichungsfreigabe wird daraus nicht vorweggenommen.

Ziel sind komfortable Low-Level-Operationen und überprüfte höhere Abläufe: Identität und Ausgangszustand lesen, Aktion gezielt ausführen, Ergebnis frisch lesen und prüfen.
Unbekannte Mutationsergebnisse werden zuerst abgeglichen. Ein Timeout erlaubt weder blindes Wiederholen noch einen alternativen Eingriff.

## Umgesetzt und belegt

- **Lebenszyklus und Cleanup:** Eigentümerschaft über kurzlebige Worker hinweg, tatsächliches Fallfenster beim Start, begrenztes Beenden und Schutz fremder Instanzen.
  Wrapper erhalten Primärfehler und Child-Exit-Code; frühe Fehler, asynchrone Cleanup-Fristen und überlebende Prozess-Peers sind regressionsgeprüft.
- **Standardcursor:** Vorhandenen gebundenen Fokus wiederverwenden oder vorab
  genau eine sichere Nr.-Zellenaktivierung wählen. Identität, GridItem,
  direkte Trefferfläche, Sichtbarkeit, Auswahl und unveränderte Werte bleiben
  Voraussetzungen. Ein schmaleres Feld innerhalb des exakten Headers ist erlaubt;
  verschobene, überstehende oder verdeckte Flächen werden abgewiesen.
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
  Die reale Abschlussabnahme dieser Korrektur steht noch aus.
- **Fokus nach Seitenwechsel:** Die Nr.-Aktivierung erhält einen eigenen
  ausdrücklich profilierten Ausgangspunkt für das nicht editierbare
  Hilfe-Root-Dokument. Geladene Provider-Version, vollständige editorfreie
  Tabelle, genaue Quell-/Fensteridentität und erneute Prüfung vor dem
  bestehenden Einzelklick bleiben Voraussetzungen. Die allgemeine
  Dokument-/Editorfreigabe wird dadurch nicht erweitert. Die reale
  Zustandsreise auf dem gemeinsamen Endstand steht noch aus.
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

Die korrigierte Auswahl nach HOME überwindet den ursprünglichen Übergangsfehler:
Die unmodifizierte Zustandsreise legt mehrere Zeilen an und bestätigt jede
unmittelbar per vollständigem Cursorread. Der folgende Abbruch betraf die
fehlende Vollständigkeitsangabe der kompakten MCP-Tabellenantwort; deren
Projektion ist gezielt korrigiert. Ein weiterer Abbruch nach dem Seitenwechsel
zeigte die fehlende Fokusübernahme vom eigenen Hilfe-Dokument. Diese Freigabe
überwindet den Seitenwechsel und das folgende Anlegen mit vollständigem
Readback. Nach der Werte-Info fand die Reise noch eine passive Schaltfläche
mit erhaltener Zeilenauswahl; der ergänzte Nachweis muss die vollständige Reise
auf dem gemeinsamen Endstand noch bestehen. Die große unmittelbare
Add-/Delete-Cursorfolge besteht bereits für den vorherigen Stand; sie wird auf
dem gemeinsamen Endstand erneut geprüft.
Frühere passive Readbacks ersetzen diese Nachweise nicht.

Add-/Update-/Delete-Reisen mit nativer Konfiguration, offenem Tipps-Fenster, Nullbetrag und Off→On→Off erhalten alle übrigen Zeilen einschließlich Rohfingerprints.
Tabellenänderungen bleiben hybrid: native Modell-/Positionierungsnachweise ergänzen den Worker-Schreibpfad; ein direkter Qt-DLL-Schreibhandler wird nicht behauptet.
Die kanonische Mega-Reise mit nativer Konfiguration besteht nach der Geometriekorrektur für ihren Quellstand mit allen vorgesehenen Operationen und Mutation-/Readback-Prüfungen.
Zulässige Dialog-Skips betreffen tatsächlich nicht vorhandene Startdialoge.
Positionsgruppen mit Speichern/Wiederöffnen und Steuerwissen mit tatsächlichem Artikelinhalt sind zusätzlich auf dem Entwicklungsstand geprüft.
Das Release-Evidenzregister bleibt ein gesondert gepflegter Snapshot.

## Noch abzuschließen

| Prüfung auf dem endgültigen Quellstand | Status |
| --- | --- |
| Vollständiges `npm test` einschließlich Abschlussbilanzen | **PENDING** – nach jüngster Korrektur erneut ausführen |
| Direkte Zustandsreise und große Add-/Delete-Cursorfolge | **PENDING** – auf neuer Korrektur prüfen |
| Vollständiges `npm run test:live` | **PENDING** – nach jüngster Korrektur erneut ausführen |
| Kanonischer API/MCP-Soak mit voller Mindestdauer | **PENDING** |
| Abschließende Standard- und native Mega-Reise | **PENDING** |
| Paketbau, Publish-Probelauf und saubere Testinstallation | **PENDING** |
| Finaler Doku-/Runtime-Abgleich und Integrationsentscheidung | **PENDING** |

Bereits bestandene Prüfungen früherer Quellstände ersetzen diese Abschlussgates nicht. Nach Codeänderungen die betroffenen Nachweise erneut ausführen.
Der ursprüngliche Checkout bleibt unangetastet; der Arbeitsbranch ist der Prüfstand. Integration muss bestehende Änderungen ausdrücklich abgleichen.
Es wurden keine Veröffentlichung, kein Push und keine Produktivinstallation vorgenommen.

## Grenzen und nächste Entscheidungen

- Cursorlesen bleibt aufwendig; der explizite Grid-Pfad ist die schnelle
  Leseoption, sofern seine Voraussetzungen und Vollständigkeitsgrenzen passen.
  Die Vergleiche begründen keine allgemeine Latenz- oder Durchsatzgarantie.
- Die Ursache einer früheren sporadischen Verzögerung beim ersten nativen
  Unicode-Schreiben ist offen. Spätere erfolgreiche Läufe beweisen keine Behebung.
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

Abgeschlossen ist diese Arbeit, wenn alle vorgesehenen Abschlussgates auf demselben Quell-/Runtime-Stand bestehen,
Cleanup und Datenintegrität bestätigt sind und Dokumentation sowie erzeugte Runtime übereinstimmen.
Offene externe Abdeckung und ungeklärte Fehlerursachen bleiben auch dann ausdrücklich benannt.
