# API/MCP-Stabilisierung: Fortschritt und Restarbeit

## Status dieses Branches

Dieser Branch enthält einen **unfertigen Arbeitsstand**. Die Umsetzung ist zu
groß für eine gemeinsame Abnahme; die folgenden Arbeitspakete werden einzeln
abgeschlossen. Ein implementierter Teil gilt erst nach den dazugehörigen
Regressionen und erforderlichen Live-Prüfungen als abgenommen.

Der Standard-Tabellencursor funktioniert noch nicht zuverlässig bei großen
Tabellen. Die aktuelle Footer-/TAB-Fokusroute ist ein erfolgloser Prototyp und
bleibt ein Blocker für die Übernahme. Der explizite Grid-Lesepfad ist kein
Ersatz für die Abnahme des Cursors oder der Schreiboperationen.

## Bereits umgesetzt

| Bereich | Umsetzung | Verbleibende Grenze |
| --- | --- | --- |
| Desktop-Lebenszyklus | Eigentümerschaft bleibt über kurzlebige Worker hinweg erhalten; Status und Stop beachten fremde Instanzen. Commit `3eac0da`. | Auf dem später integrierten Stand erneut prüfen. |
| Produktstart | Auf das tatsächliche Fallfenster warten und ursprüngliche UIA-Fehler erhalten. Commit `04cb5cf`. | Kein blindes erneutes Starten nach unbekanntem Ergebnis. |
| Native Beendigung | Begrenzte Beendigung, Eigentümerschaft bis zum bestätigten Prozessende erhalten. Commit `7501b77`. | Bestandteil der abschließenden Gesamtprüfung. |
| Testwrapper | Primärfehler und genauer Child-Exit-Code bleiben erhalten; Cleanup-Fehler werden getrennt gemeldet; Diagnose bleibt bei unbewiesenem Native-Cleanup erhalten. | Nie abgeschlossene Cleanup-Phasen und Fehler beim frühen Start sind noch offen. |
| Zustandsreise | Dokumentjahr, sichtbare Zeilen und vollständiges Modell getrennt prüfen; eindeutige synthetische Ziele und unveränderte übrige Zeilen nachweisen. | Die vollständige Standardreise hängt weiter am Cursorproblem. |
| Explizites Grid-Lesen | `table_read` mit `readMode: "grid"`: vollständige bereitgestellte UIA-Koordinaten, typisierte Werte, Rohzeilen einschließlich Eingabeslot; ohne Fokus-, Scroll- oder Schreibaktion. | Zwei gleiche Beobachtungen sind kein atomarer Snapshot und erteilen keine Schreibberechtigung. |
| Frische RAW-Auflösung | Gebundene RAW-Identitätsprüfung in C# mit bestehenden Identitäts-, Zyklus-, Knoten-, Tiefen- und Fristgrenzen. Native Build-/Loader-Prüfung um neue Typen erweitert. | Eine Beschleunigung des gesamten Tabellenablaufs ist damit nicht belegt. |
| Mehrdeutige Feldziele | Mehrere passende beschreibbare Direktziele werden vor der Zielauswahl abgewiesen. | Die größere Getter-/Selektor-Namespace-Arbeit ist separat offen. |
| Regressionen und Testinstallation | Neue Grid-, RAW-, Wrapper-, Zustandsreise- und Mehrdeutigkeitsverträge; deterministische Uhr im goto-Vertrag; echte C#-Klassengrenzen im Build-Cache-Test; Grid-Helfer in isolierte Worker-Fixtures aufgenommen. | Vollsuite auf dem gesamten aktuellen Stand muss noch vollständig grün werden. |
| API-/MCP-Vertrag | Grid-Option und Grenzen dokumentiert; Plugin-Runtime aus Quellen regeneriert. | Die jüngsten Cursoränderungen benötigen noch den abschließenden Doku-Abgleich. |

## Laufende Cursorarbeit: teilweise umgesetzt, nicht abgenommen

- [x] Vorhandenen, tatsächlich an Tabelle und Auswahl gebundenen Tastaturfokus
  wiederverwenden, ohne erneut `SetFocus` oder `Select` aufzurufen.
- [x] Einen exakt identifizierten, unveränderten Nummernzellen-Editor erkennen
  und den gezielten ESC-Abschluss mit frischem Readback versehen.
- [x] Bei nummerierten Tabellen nach jedem Zeilenschritt frisch prüfen.
- [x] Ein eigener Vertrag deckt Fokuswiederverwendung und den bisherigen
  einzelnen Fokusversuch ab.
- [ ] Den neuen UIA-Nummerneditor-Proof im `readNavigationGuard` auf den
  öffentlichen Standardpfad begrenzen. Private native Cursorphasen müssen
  ihre strengeren Voraussetzungen behalten.
- [ ] Die erfolglose Footer-/TAB-Route entfernen oder durch eine tatsächlich
  nachgewiesene, eng gebundene Aktivierung ersetzen. Vorwärts-TAB landet in
  einem Umsatzsteuer-Editor; Shift-TAB vom Footer im Hilfe-Document.
- [ ] Nach bereits ausgelösten Fokus-/Tastaturaktionen einen ungewissen Ausgang
  ausdrücklich im Fehlerergebnis ausweisen und jeden automatischen
  Alternativversuch verhindern.
- [ ] Positive und negative Regressionen für Nummerneditor, ESC-Abschluss,
  Positionsnamenfeld, geänderten Inhalt, fremden Fokus und Providerfehler ergänzen.
- [ ] Kleine und große Standardtabelle einschließlich vollständiger Rohwerte,
  typisierter Werte, unveränderter Daten und zugesagter Endposition prüfen.

## Nächste Schritte, jeweils getrennt umsetzen und abnehmen

1. **Cursorgrenzen absichern.** Native/private Phasen vom neuen Standard-Proof
   trennen und die erfolglose Fokusroute bereinigen. Zuerst die fokussierten
   Verträge ausführen. Den roten Vertrag `table-read-obstruction` zur genauen
   Aktivierungsdiagnose aufklären: Testbindung und produktiven Fehlerpfad
   getrennt prüfen. Keine zusätzlichen Fokusstrategien nach einer bereits
   ausgelösten Aktion anhängen.
2. **Standardcursor fertigstellen.** Den Anfangsfokus reproduzierbar an die
   konkrete Tabelle binden. Kleine und große Tabelle müssen vollständig gelesen
   werden; unbekannte Editoren oder Dialoge führen zum erklärten Abbruch.
   Grid-Lesen darf einen fehlschlagenden Cursortest nicht ersetzen.
3. **Bekanntes Tipps-Fenster vorbereiten.** Vor der ersten Tabellenbindung nur
   das profilierte, exakt zur eigenen Instanz gehörende, nicht modale
   Tipps-Fenster kontrolliert schließen. Anschließend Identität und Daten neu
   binden. Unbekannte Dialoge bleiben unangetastet. Die Vorbereitung ist noch
   nicht produktiv implementiert. Abnahme: Standard- und Native-Pfad,
   Nullwert-Umschaltung hin und zurück sowie unveränderte übrige Zeilen;
   negative Eigentümer-, Dialog-, Eingabe- und Timeoutfälle ohne Datenänderung.
4. **Wrapper-Cleanup abschließen.** Jede nie endende Cleanup-Phase begrenzen,
   auch `server.close`; frühe Startfehler in denselben Ressourcenabschluss
   aufnehmen. Primärfehler, genaue Exit-Codes und erhaltene Diagnose mit echten
   Subprozessen prüfen. Keine fremden Prozesse beenden.
5. **Getter und Selektoren vereinheitlichen.** UIA-AutomationId und Qt-Objektname
   ausdrücklich auseinanderhalten; Punkte in gültigen Objektnamen dürfen keine
   Routingheuristik sein. Eindeutigkeit und dieselbe Feldidentität beim Lesen
   und Schreiben prüfen. Bereits vorhandene Änderungen vor einer Übernahme
   einzeln vergleichen.
6. **Tabellenlaufzeit gezielt verbessern.** Gemeinsame Bindungs-, Proof- und
   Readback-Phasen messen; nur nachgewiesene Doppelarbeit entfernen. Unveränderte
   Arbeitslast und Sicherheitsprüfungen beibehalten. Erst gleiche vollständige
   Abläufe vergleichen, dann eine Leistungsverbesserung behaupten.
7. **Gesamtstand abnehmen und integrieren.** Vollsuite, Produktreisen,
   kanonischer Mega-Lauf, Paket- und Installationsprüfungen auf genau demselben
   Quellstand ausführen. Vorhandene Änderungen des Zielbranches getrennt
   abgleichen; nach der Integration erneut bauen und prüfen. Dokumentation und
   erzeugte Runtime müssen dem integrierten Stand entsprechen.

Pro Schritt: Fehler reproduzieren, kleinste passende Änderung umsetzen,
relevante Regressionen ausführen, Verhalten und Dokumentation abgleichen,
abgenommenen Teil separat committen. Bei einer Pause hier den Status und die
nächste konkrete Aktion aktualisieren.

## Prüfstand und noch erforderliche Abnahme

Gezielte Verträge für Wrapper, Zustandsreise, Grid, RAW-Auflösung und
Feldmehrdeutigkeit wurden geprüft. Für Grid liegen außerdem Prüfungen mit
kleinen und großen synthetischen Tabellen sowie mit nativer Konfiguration vor.
Die kleine Standard-Cursortabelle wurde vollständig mit unverändertem Rohmodell
gelesen; die große Standardtabelle scheitert weiter an der Fokusübernahme.
Frühere grüne Prüfungen gelten für ihren jeweiligen Quellstand und ersetzen
keine Abnahme der jüngsten Cursoränderungen.

**Der vollständige aktuelle Stand ist noch nicht grün abgenommen.** Frühere
Vollsuiten stoppten nacheinander bei goto-Testzeit, Native-Build-Cache und
fehlendem Grid-Helfer in isolierten Produktprofil-Fixtures. Die jeweiligen
Korrekturen bestanden gezielt; das allein ist keine grüne Gesamtprüfung.

Ergebnis der Prüfungen für diesen Sicherungsstand:

| Prüfung | Ergebnis | Konsequenz |
| --- | --- | --- |
| `npm test` | **ROT**, Abbruch bei `table-read-obstruction`: Der Vertrag meldet den Verlust der genauen Aktivierungsdiagnose bei fehlgeschlagenem vollständigem Cursorlesen. | Fehlerursache und Testbindung zuerst aufklären; noch keine vollständige Offline-Abnahme. |
| Neue fokussierte Verträge innerhalb der Vollsuite | Grid-API/-Reader, bestehender Cursor, RAW-Resolver, Wrapper-Cleanup, Zustandsreise und direkte Feldauflösung bestanden. | Belegt diese begrenzten Verträge; nach dem Abbruch nicht ausgeführte Prüfungen bleiben offen. |
| Syntax- und Repository-Privacy-Verträge innerhalb der Vollsuite | Bestanden. | Kein Ersatz für die Verhaltensabnahme. |
| `npm run docs:check` | Bestanden. | Maschineller Doku-Abgleich; die Beschreibung der unfertigen Cursorarbeit bleibt zusätzlich erforderlich. |
| `npm run check:plugin` | Bestanden. | Erzeugte Plugin-Runtime stimmt mit den Quellen überein. |

Dieser Commit sichert bewusst den unfertigen Stand einschließlich des roten
Vertrags und der erfolglosen Fokusroute. Er ist keine Freigabe zur Integration
oder Veröffentlichung. Zusätzliche Live-Läufe und erneute Paketprüfungen auf
diesem Stand stehen aus.

Reproduzierbare Prüfwege:

```powershell
npm test
npm run docs:check
npm run check:plugin
npm run test:product
npm run test:live-state
npm run perf:api-mega
npm run pack
npm run publish:dry-run
npm run test:npm-clean-install
```

Produkt- und Live-Prüfungen benötigen die dokumentierten Voraussetzungen und
synthetische Wegwerfkopien. GUI-/Controller-Versuche seriell ausführen. Bei
Änderungen am optionalen C++-Qt-Pfad zusätzlich den nativen Build und
`npm run test:qt-native` ausführen. Vor einer Veröffentlichung gilt
`npm run check` als vollständiges Gate.

## Unveränderte Sicherheits- und Qualitätsziele

- Low-Level-Lesen und -Schreiben sowie höherwertige Abläufe mit gebundener
  Identität und Vorher-/Nachher-Readback anbieten.
- Nur nachweislich sichere, begrenzte Wiederholungen zulassen. Bei unbekanntem
  Mutationsergebnis zunächst lesen und abgleichen, niemals blind erneut schreiben.
- Fehler mit Ursache, Phase und verwertbarem Zustand zurückgeben; keine
  Endlosschleifen, stillen Alternativwege oder selbstüberspringenden Tests.
- Ein alter nativer Änderungs-Timeout mit später sichtbar gewordenem Ergebnis
  bleibt hinsichtlich seiner Ursache offen; die Ergebnisabstimmung darf bei
  weiteren Optimierungen nicht verloren gehen.
- Die experimentelle Produktunterstützung und externe Voraussetzungen für
  bestimmte Konten-/Zertifikatsfunktionen nicht als vollständig geprüft ausgeben.
- Private Rohbelege, Fallkopien, Sitzungsprotokolle und Messungen außerhalb
  dieses Repositorys halten. Hier stehen Codezustand, Grenzen und Prüfwege.
