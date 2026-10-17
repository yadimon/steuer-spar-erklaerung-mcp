# API/MCP-Stabilisierung: Fortschritt und Restarbeit

## Status dieses Branches

Dieser Branch enthält einen **unfertigen Arbeitsstand**. Die Umsetzung ist zu
groß für eine gemeinsame Abnahme; die folgenden Arbeitspakete werden einzeln
abgeschlossen. Ein implementierter Teil gilt erst nach den dazugehörigen
Regressionen und erforderlichen Live-Prüfungen als abgenommen.

**Übergabe: pausiert und als Checkpoint gesichert.** Es gibt noch keine
Freigabe für Integration oder Veröffentlichung. Die nächste konkrete Aufgabe
ist der rote OpenAPI-Größenvertrag; danach folgt eine vollständige Offline-Suite.
Den Größenwächter dabei nicht lediglich lockern, sondern die erzeugte
Beschreibung und mögliche Dopplungen prüfen.

Der Standard-Tabellencursor ist bei großen Tabellen noch nicht real abgenommen.
Die erfolglose Footer-/TAB-Fokusroute ist entfernt. An ihre Stelle tritt eine
vorab gewählte einzelne Nr-Zellenaktivierung mit genauen Identitäts-, Quellen-,
Flächen- und Readback-Prüfungen; deren synthetische Verträge bestehen. Der
explizite Grid-Lesepfad ersetzt weiterhin keine Cursor- oder Schreibabnahme.

## Bereits umgesetzt

| Bereich | Umsetzung | Verbleibende Grenze |
| --- | --- | --- |
| Desktop-Lebenszyklus | Eigentümerschaft bleibt über kurzlebige Worker hinweg erhalten; Status und Stop beachten fremde Instanzen. Commit `3eac0da`. | Auf dem später integrierten Stand erneut prüfen. |
| Produktstart | Auf das tatsächliche Fallfenster warten und ursprüngliche UIA-Fehler erhalten. Commit `04cb5cf`. | Kein blindes erneutes Starten nach unbekanntem Ergebnis. |
| Native Beendigung | Begrenzte Beendigung, Eigentümerschaft bis zum bestätigten Prozessende erhalten. Commit `7501b77`. | Bestandteil der abschließenden Gesamtprüfung. |
| Testwrapper | Primärfehler und genauer Child-Exit-Code bleiben erhalten; asynchrone Cleanup-Phasen sind begrenzt; frühe Startfehler werden bereinigt; unbewiesenes Native-Cleanup erhält die Diagnose. Vertrag mit echten Subprozessen besteht auch innerhalb der jüngsten Vollsuite. | Ein Timer desselben Prozesses kann synchron blockierenden JS-/OS-Code nicht unterbrechen. Die gesamte Suite ist noch rot. |
| Zustandsreise | Dokumentjahr, sichtbare Zeilen und vollständiges Modell getrennt prüfen; eindeutige synthetische Ziele und unveränderte übrige Zeilen nachweisen. | Die vollständige Standardreise hängt weiter am Cursorproblem. |
| Explizites Grid-Lesen | `table_read` mit `readMode: "grid"`: vollständige bereitgestellte UIA-Koordinaten, typisierte Werte, Rohzeilen einschließlich Eingabeslot; ohne Fokus-, Scroll- oder Schreibaktion. | Zwei gleiche Beobachtungen sind kein atomarer Snapshot und erteilen keine Schreibberechtigung. |
| Frische RAW-Auflösung | Gebundene RAW-Identitätsprüfung in C# mit bestehenden Identitäts-, Zyklus-, Knoten-, Tiefen- und Fristgrenzen. Native Build-/Loader-Prüfung um neue Typen erweitert. | Eine Beschleunigung des gesamten Tabellenablaufs ist damit nicht belegt. |
| Mehrdeutige Feldziele | Mehrere passende beschreibbare Direktziele werden vor der Zielauswahl abgewiesen. | Die reale Zuordnung über Getter, Schreiben und erneutes Lesen bleibt separat offen. |
| Getter-Namensräume | Additives `selectorNamespace: "uia"` oder `"qt-object"`, unverändertes Legacy-Routing, kanonische explizite Qt-Identitäten und Ablehnung widersprüchlicher RID-Familien vor Dispatch. | Reale Getter/Schreiben/Getter-Reisen und verschachtelte Labelzuordnung bleiben separat zu prüfen. |
| Tipps-Vorbereitung | Exaktes eigenes nicht modales Profilfenster einmal vor erster Bindung schließen; Providerfehler ohne Legacy-Requery; späte Owner-/Peer-/PID-Wechsel blockieren; ungewisser Ausgang erhält den Fokuskontext. `IntPtr.Zero` beim Close wird korrekt als Timeout behandelt. | Reale Standard-/Native-Abnahme einschließlich Nullwert-Umschaltung steht aus. |
| UIA-Snapshot und Klickfehler | Tiefenbegrenzung auch bei vollständigen Snapshots ausweisen; strenge Vorbereitung ohne Provider-Fallback; transaktionale Klickaufrufe können Fehler auffangen, ohne den Worker vorzeitig zu beenden. | Die Standardfehlerbehandlung anderer Aufrufer bleibt erhalten; reale Cursorabnahme steht aus. |
| Regressionen und Testinstallation | Neue Grid-, RAW-, Wrapper-, Zustandsreise- und Mehrdeutigkeitsverträge; deterministische Uhr im goto-Vertrag; echte C#-Klassengrenzen im Build-Cache-Test; Grid-Helfer in isolierte Worker-Fixtures aufgenommen. | Vollsuite auf dem gesamten aktuellen Stand muss noch vollständig grün werden. |
| API-/MCP-Vertrag | Grid, Getter-Namensräume, Tipps-Vorbereitung und Grenzen dokumentiert; Plugin-Runtime aus Quellen regeneriert. | Doku und Runtime bei jeder weiteren Korrektur erneut abgleichen; der OpenAPI-Größenvertrag ist noch rot. |

## Laufende Cursorarbeit: teilweise umgesetzt, nicht abgenommen

- [x] Vorhandenen, tatsächlich an Tabelle und Auswahl gebundenen Tastaturfokus
  wiederverwenden, ohne erneut `SetFocus` oder `Select` aufzurufen.
- [x] Einen exakt identifizierten, unveränderten Nummernzellen-Editor erkennen
  und den gezielten ESC-Abschluss mit frischem Readback versehen.
- [x] Bei nummerierten Tabellen nach jedem Zeilenschritt frisch prüfen.
- [x] Ein eigener Vertrag deckt Fokuswiederverwendung und den bisherigen
  einzelnen Fokusversuch ab.
- [x] Den neuen UIA-Nummerneditor-Proof im `readNavigationGuard` auf den
  öffentlichen Standardpfad begrenzen. Private native Cursorphasen müssen
  ihre strengeren Voraussetzungen behalten.
- [x] Die erfolglose Footer-/TAB-Route entfernen. Die neue einzelne
  Nr-Zellenaktivierung wurde implementiert und synthetisch geprüft; die reale
  Abnahme bleibt offen.
- [x] Nach bereits ausgelösten Fokus-/Tastaturaktionen einen ungewissen Ausgang
  ausdrücklich im Fehlerergebnis ausweisen und jeden automatischen
  Alternativversuch verhindern.
- [x] Positive und negative Regressionen für Nummerneditor, ESC-Abschluss,
  Positionsnamenfeld, geänderten Inhalt, fremden Fokus und Providerfehler ergänzen.
- [ ] Kleine und große Standardtabelle einschließlich vollständiger Rohwerte,
  typisierter Werte, unveränderter Daten und zugesagter Endposition prüfen.

## Nächste Schritte, jeweils getrennt umsetzen und abnehmen

1. **OpenAPI-Vertrag und integrierte Offline-Suite abschließen.** Die alten
   Helferbindungen in `table-read-obstruction` und `window-wait` sind korrigiert;
   beide Verträge bestehen in der jüngsten Vollsuite. Diese stoppt jetzt bei
   `api-openapi-contract`: Das erzeugte Dokument überschreitet die bestehende
   Größenratsche. Beschreibung beziehungsweise Dopplungen gezielt prüfen,
   Vertrag erhalten, fokussiert testen und anschließend `npm test` vollständig
   grün abschließen. Keine spätere Prüfung als bestanden ausgeben, wenn sie
   wegen des Abbruchs noch nicht ausgeführt wurde.
2. **Standardcursor fertigstellen.** Den Anfangsfokus reproduzierbar an die
   konkrete Tabelle binden. Kleine und große Tabelle müssen vollständig gelesen
   werden; unbekannte Editoren oder Dialoge führen zum erklärten Abbruch.
   Grid-Lesen darf einen fehlschlagenden Cursortest nicht ersetzen.
3. **Bekanntes Tipps-Fenster vorbereiten.** Vor der ersten Tabellenbindung nur
   das profilierte, exakt zur eigenen Instanz gehörende, nicht modale
   Tipps-Fenster kontrolliert schließen. Die Vorbereitung ist implementiert;
   anschließend werden Identität und Daten neu gebunden. Unbekannte Dialoge
   bleiben unangetastet. Noch erforderliche reale Abnahme: Standard- und Native-Pfad,
   Nullwert-Umschaltung hin und zurück sowie unveränderte übrige Zeilen;
   negative Eigentümer-, Dialog-, Eingabe- und Timeoutfälle ohne Datenänderung.
4. **Wrapper-Cleanup im Gesamtstand bestätigen.** Asynchrone Phasenfristen und
   früher Ressourcenabschluss sind implementiert. Die gezielten Verträge mit
   echten Subprozessen einschließlich eines unabhängigen überlebenden Peers
   bestehen auch innerhalb der jüngsten Vollsuite. Die Grenze synchron
   blockierter Aufrufe ausdrücklich erhalten und den Gesamtstand abschließen.
5. **Getter und Selektoren vereinheitlichen.** UIA-AutomationId und Qt-Objektname
   werden jetzt ausdrücklich auseinandergehalten; Punkte sind keine neue
   Routingheuristik. Parser-, Executor-, Worker-, HTTP-, MCP- und Fake-Peer-
   Verträge bestehen. Noch Eindeutigkeit und tatsächliche Feldidentität über
   Getter/Schreiben/Getter real prüfen. Legacy-Aliase sind kein vollständiger
   Pfadbeweis und Qt-Objektreferenzen keine UIA-Schreibidentität.
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

### Zuschnitt der nächsten Änderungen

| Paket | Eigener Umfang | Fertig, wenn |
| --- | --- | --- |
| A: Offline-Gate | OpenAPI-Beschreibung beziehungsweise Schema-Dopplung und passende Regression | Größenvertrag und vollständiges `npm test` bestehen. |
| B: Standardcursor | Einzelne Nr-Zellenaktivierung, Fehlerausgang und Fokusgrenzen | Kleine und große Tabelle stimmen vollständig mit Rohmodell und typisierten Werten überein; Daten bleiben unverändert; Endposition stimmt. Zusätzlich erreicht ein ungewisser Klickausgang unverändert das öffentliche Fehlerergebnis. |
| C: Tipps und Mutationen | Vorbereitung vor erster Bindung und native Nullwert-Umschaltung | Eigenes Tipps-Fenster kontrolliert vorbereitet; Off→On→Off und Löschen gelingen; alle übrigen Zeilen bleiben einschließlich versteckter Werte unverändert. Vorbereitung bei `add` und bei `update` getrennt belegen. |
| D: Getter-Identität | Tatsächliche UIA-/Qt-Identität über API und MCP | Getter→Schreiben→Getter trifft eindeutig dasselbe Feld; widersprüchliche Selektoren scheitern vor Dispatch. |
| E: Leistung | Zunächst getrennte Zeiten gemeinsamer Proofphasen, danach belegte Doppelarbeit | Gleiche vollständige Arbeitslast bei gleichen Sicherheitsprüfungen vergleichen; keine Beschleunigung allein aus isolierten Helferzeiten ableiten. |
| F: Integration | Dokumentation, Runtime, Produktreisen, Mega-/Soak- und Paketprüfungen | Alle vorgesehenen Gates auf demselben endgültigen Quellstand bestehen; vorhandene Änderungen des Zielbranches sind separat abgeglichen. |

Die Pakete nacheinander bearbeiten. Für B und C sind private Prüfskripte
vorbereitet; deren Syntaxprüfung ist noch kein realer Produktlauf. Unbekannte
Mutationsergebnisse zuerst durch Lesen abgleichen, niemals blind erneut senden.

## Prüfstand und noch erforderliche Abnahme

Gezielte Verträge für Wrapper, Zustandsreise, Grid, RAW-Auflösung und
Feldmehrdeutigkeit wurden geprüft. Für Grid liegen außerdem Prüfungen mit
kleinen und großen synthetischen Tabellen sowie mit nativer Konfiguration vor.
Eine frühere kleine Standard-Cursortabelle wurde vollständig mit unverändertem
Rohmodell gelesen; bei der großen Tabelle scheiterte die frühere Fokusroute.
Die neue Nr-Zellenaktivierung ist auf dem aktuellen Stand noch nicht real
geprüft. Frühere grüne Prüfungen gelten für ihren jeweiligen Quellstand und
ersetzen keine Abnahme der jüngsten Cursoränderungen.

**Der vollständige aktuelle Stand ist noch nicht grün abgenommen.** Frühere
Vollsuiten stoppten nacheinander bei goto-Testzeit, Native-Build-Cache und
fehlendem Grid-Helfer in isolierten Produktprofil-Fixtures. Die jeweiligen
Korrekturen bestanden gezielt; das allein ist keine grüne Gesamtprüfung.

Prüfstand des aktuellen Checkpoints:

| Prüfung | Ergebnis | Konsequenz |
| --- | --- | --- |
| Jüngstes `npm test` | **ROT**, Abbruch bei `api-openapi-contract`: Größenlimit des erzeugten Dokuments überschritten. | Größenursache beheben und vollständige Offline-Suite erneut ausführen. |
| Vorheriger integrierter Volltest | **ROT** bei `window-wait`, da der Vertrag die Close-Schleife noch im Worker statt im ausgelagerten Helfer suchte. | Vertrag an den tatsächlich aufgerufenen Helfer gebunden; besteht im jüngsten Volltest. |
| Neue Verträge innerhalb der jüngsten Vollsuite | Getter-Namensräume über Parser/Executor/HTTP/MCP und Worker, Nr-Zellenaktivierung, Keyboard-Grenzen, Klickfehler, UIA-Tiefenbegrenzung, Tipps-Vorbereitung samt Dispatchergrenzen und Close-Helfer sowie Wrapper-Cleanup bestanden. | Kontrollierte Regressionen; reale GUI-Abnahme und nach dem Abbruch nicht ausgeführte Tests bleiben offen. |
| Bereits geprüfte begrenzte Verträge | Grid-API/-Reader, bestehender Cursor, RAW-Resolver, Zustandsreise und direkte Feldauflösung bestanden. | Ersetzen keine vollständige aktuelle Produktreise. |
| Syntax- und Repository-Privacy-Verträge | Innerhalb der Vollsuite bestanden; Repository-Privacy beim Checkpoint erneut bestanden. | Kein Ersatz für die Verhaltensabnahme. |
| Build und gezielte Prüfungen | Build einschließlich C#-Helfer, TypeScript und Plugin-Erzeugung sowie gezielte neue Verträge bestanden. | Kein Ersatz für Vollsuite, reale Produktläufe und Paketabnahme. |
| `npm run docs:check` und `npm run check:plugin` | Beim aktuellen Checkpoint erneut bestanden; erzeugte Runtime ohne Drift. | Maschineller Abgleich ergänzt die ausdrücklich dokumentierten offenen Verhaltensprüfungen. |

Die Sicherungscommits bewahren bewusst den unfertigen Stand. Die
anschließenden Korrekturen sind keine Veröffentlichungsfreigabe. Erneute
Vollsuite, passende Live-Läufe und Paketprüfungen auf dem integrierten Stand
stehen aus. Messdaten belegen bisher keine wesentliche Beschleunigung der
gesamten nativen Update-/Delete-Reise; weitere Optimierung braucht genauere
Zeiten der gemeinsamen Proofphasen statt gestrichener Sicherheitsprüfungen.

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
