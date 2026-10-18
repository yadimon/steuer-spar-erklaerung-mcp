# API/MCP-Stabilisierung: Fortschritt und Restarbeit

## Status dieses Branches

Dieser Branch enthält einen **unfertigen Arbeitsstand**. Die Umsetzung ist zu
groß für eine gemeinsame Abnahme; die folgenden Arbeitspakete werden einzeln
abgeschlossen. Ein implementierter Teil gilt erst nach den dazugehörigen
Regressionen und erforderlichen Live-Prüfungen als abgenommen.

**Arbeit fortgesetzt; unfertiger Stand als Checkpoint gesichert.** Es gibt noch keine
Freigabe für Integration oder Veröffentlichung. Die vollständige Offline-Suite
einschließlich Ergebnis-/Abdeckungsbilanz und Doku-Abgleich besteht jetzt.
Die kleine und große Standard-Cursortabelle sind inzwischen funktional geprüft.
Alle sechs nativen Tests bestehen mit unveränderten Operationsfristen,
einschließlich tatsächlicher Unicode-Schreibvorgänge und getrenntem absichtlichem
Timeout. Die Ursache einer zuvor beobachteten sporadischen Erstverzögerung bleibt offen.

Der Standard-Tabellencursor liefert auch die große Tabelle vollständig.
Die erfolglose Footer-/TAB-Fokusroute ist entfernt. An ihre Stelle tritt eine
vorab gewählte einzelne Nr-Zellenaktivierung mit genauen Identitäts-, Quellen-,
Flächen- und Readback-Prüfungen. Ein vollständig innerhalb seines Headers
liegendes Nr.-Feld darf schmaler als der Header sein; überstehende, verschobene
oder verdeckte Flächen bleiben gesperrt. Verträge und reale Leseprüfung bestehen. Der
explizite Grid-Lesepfad ersetzt weiterhin keine Cursor- oder Schreibabnahme.

## Bereits umgesetzt

**Neue Gesamtprüfung:** Paketbau, Veröffentlichungs-Probelauf, saubere
Testinstallation und Standard-Mega-Reise bestehen. Die Mega-Reise mit nativer
Konfiguration bricht dagegen vor dem ersten Anhängen in der privaten
Tipps-Bindungsprüfung ab, noch vor Close oder Tabellenänderung. Der genaue
Vergleich war nicht sichtbar; ein gezielt geprüfter Diagnosezusatz nennt jetzt
feste Phasen und Feldklassen. Ursache und erneute Gesamtregression dieses
Zusatzes stehen noch aus. Die Instanz wurde kontrolliert geschlossen, Daten
und Konfiguration blieben unverändert.

| Bereich | Umsetzung | Verbleibende Grenze |
| --- | --- | --- |
| Desktop-Lebenszyklus | Eigentümerschaft bleibt über kurzlebige Worker hinweg erhalten; Status und Stop beachten fremde Instanzen. Commit `3eac0da`. | Auf dem später integrierten Stand erneut prüfen. |
| Produktstart | Auf das tatsächliche Fallfenster warten und ursprüngliche UIA-Fehler erhalten. Commit `04cb5cf`. | Kein blindes erneutes Starten nach unbekanntem Ergebnis. |
| Native Beendigung | Begrenzte Beendigung, Eigentümerschaft bis zum bestätigten Prozessende erhalten. Commit `7501b77`. | Bestandteil der abschließenden Gesamtprüfung. |
| Testwrapper | Primärfehler und genauer Child-Exit-Code bleiben erhalten; asynchrone Cleanup-Phasen sind begrenzt; frühe Startfehler werden bereinigt; unbewiesenes Native-Cleanup erhält die Diagnose. Vertrag mit echten Subprozessen besteht in der grünen Vollsuite. | Ein Timer desselben Prozesses kann synchron blockierenden JS-/OS-Code nicht unterbrechen. |
| Zustandsreise | Dokumentjahr, sichtbare Zeilen und vollständiges Modell getrennt prüfen; eindeutige synthetische Ziele und unveränderte übrige Zeilen nachweisen. | Kanonische Reise mit Persistenz und weiteren Funktionen noch auf dem abschließenden Stand ausführen. |
| Explizites Grid-Lesen | `table_read` mit `readMode: "grid"`: vollständige bereitgestellte UIA-Koordinaten, typisierte Werte, Rohzeilen einschließlich Eingabeslot; ohne Fokus-, Scroll- oder Schreibaktion. | Zwei gleiche Beobachtungen sind kein atomarer Snapshot und erteilen keine Schreibberechtigung. |
| Frische RAW-Auflösung | Gebundene RAW-Identitätsprüfung in C# mit bestehenden Identitäts-, Zyklus-, Knoten-, Tiefen- und Fristgrenzen. Native Build-/Loader-Prüfung um neue Typen erweitert. | Eine Beschleunigung des gesamten Tabellenablaufs ist damit nicht belegt. |
| Mehrdeutige Feldziele | Mehrere passende beschreibbare Direktziele werden vor der Zielauswahl abgewiesen. | Die reale Zuordnung über Getter, Schreiben und erneutes Lesen bleibt separat offen. |
| Getter-Namensräume | Additives `selectorNamespace: "uia"` oder `"qt-object"`, unverändertes Legacy-Routing, kanonische explizite Qt-Identitäten und Ablehnung widersprüchlicher RID-Familien vor Dispatch. HTTP-/MCP-Lesen, Schreiben und verifizierte Rücksetzung desselben UIA-Suchfelds bestehen auch mit nativer Konfiguration. Explizite QObject-Getter über Name und beobachteten Qt-RID bestehen in der nativen Integration. | Ein Suchfeld beweist keine beliebige Steuerfeld-/Labelzuordnung oder Gleichheit von UIA- und QObject-Namensräumen. |
| Tipps-Vorbereitung | Exaktes eigenes nicht modales Profilfenster einmal vor erster Bindung schließen; Providerfehler ohne Legacy-Requery; späte Owner-/Peer-/PID-Wechsel blockieren; ungewisser Ausgang erhält den Fokuskontext. `IntPtr.Zero` beim Close wird korrekt als Timeout behandelt. Standardcursor sowie native erste `add`- und `update`-Mutation mit offenem Tipps-Fenster bestehen. | Gesamtreise auf dem abschließenden Stand erneut prüfen. |
| UIA-Snapshot und Klickfehler | Tiefenbegrenzung auch bei vollständigen Snapshots ausweisen; strenge Vorbereitung ohne Provider-Fallback; transaktionale Klickaufrufe können Fehler auffangen, ohne den Worker vorzeitig zu beenden. | Die Standardfehlerbehandlung anderer Aufrufer bleibt erhalten. |
| Ungewisse Lesereingaben | Versuch und bestätigte Navigation getrennt halten; verlorene Klick-/Tastaturergebnisse in beiden öffentlichen Fehlerausgaben erhalten, einschließlich `physicalInputUsed: null`. Neuer Vertrag prüft echte Dispatcher-/Finish-Abschnitte und JSON-Ausgabe. | Ein bestätigter früherer Input bleibt als erfolgt belegt, auch wenn eine spätere Taste ungewiss ist. |
| Regressionen und Testinstallation | Neue Grid-, RAW-, Wrapper-, Zustandsreise- und Mehrdeutigkeitsverträge; deterministische Uhr im goto-Vertrag; echte C#-Klassengrenzen im Build-Cache-Test; Helfer in isolierten Fixtures und tatsächlichen Ergebnisprüfungen gebunden. Vollsuite besteht. | Reale Abnahme der jüngsten UI-Änderungen bleibt separat erforderlich. |
| API-/MCP-Vertrag | Grid, Getter-Namensräume, Tipps-Vorbereitung und Grenzen dokumentiert; Plugin-Runtime aus Quellen regeneriert. OpenAPI-Größenvertrag bei unverändertem Limit grün. | Doku und Runtime bei jeder weiteren Korrektur erneut abgleichen. |

## Cursorarbeit: funktional geprüft, Laufzeit weiter offen

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
  Nr-Zellenaktivierung ist implementiert und synthetisch sowie real geprüft.
- [x] Nach bereits ausgelösten Fokus-/Tastaturaktionen einen ungewissen Ausgang
  ausdrücklich im Fehlerergebnis ausweisen und jeden automatischen
  Alternativversuch verhindern.
- [x] Positive und negative Regressionen für Nummerneditor, ESC-Abschluss,
  Positionsnamenfeld, geänderten Inhalt, fremden Fokus und Providerfehler ergänzen.
- [x] Kleine und große Standardtabelle einschließlich vollständiger Rohwerte,
  typisierter Werte und unveränderter Daten prüfen. Tabellenende und sichtbare
  letzte Geschäftszeile sind belegt; die öffentliche Antwort exportiert keine
  unabhängige Identität der abschließend ausgewählten Zeile.
- [x] Korrektur der verschachtelten ESC-Diagnose in Vollsuite und genau derselben
  realen Editorroute bestätigen. Die Aktivierungsdiagnose erhält den eigenen
  ESC-Ausgang, unabhängig von späterem HOME oder DOWN. Der öffentliche ungewisse
  Eingabeausgang bleibt korrekt.

## Nächste Schritte, jeweils getrennt umsetzen und abnehmen

1. **Offline-Gate abgeschlossen.** Redundante OpenAPI-Beschreibung gekürzt,
   gültige Selektorkontexte für neue Namespace-Enumvarianten ergänzt und
   Produkt-/Ergebnisprüfer an die tatsächlich geladenen Helfer gebunden.
   Negative Fälle, Größenlimit und Ergebnisnachweis bleiben erhalten.
   `npm test` ist einschließlich abschließender Bilanzen vollständig grün.
2. **Standardcursor funktional bestätigt.** Anfangsfokus, vollständiges kleines
   und großes Inventar sowie unveränderte Daten sind geprüft. Die jüngste
   Diagnosekorrektur besteht in Vollsuite und realer Editorroute. Grid-Lesen ersetzt keine
   Cursorabnahme; der explizite Cursorlauf ist weiterhin ein Leistungsproblem.
3. **Bekanntes Tipps-Fenster vorbereiten.** Vor der ersten Tabellenbindung nur
   das profilierte, exakt zur eigenen Instanz gehörende, nicht modale
   Tipps-Fenster kontrolliert schließen. Die Vorbereitung ist implementiert;
   anschließend werden Identität und Daten neu gebunden. Unbekannte Dialoge
   bleiben unangetastet. Reale Standard-Cursorvorbereitung und native erste
   Add-/Update-Vorbereitung sind bestätigt. Nullbetrag, Off→On→Off und Löschen
   bestehen mit unveränderten übrigen Zeilen einschließlich Rohfingerprints.
   Negative Eigentümer-, Dialog-, Eingabe- und Timeoutverträge bleiben erhalten.
4. **Wrapper-Cleanup im Gesamtstand bestätigen.** Asynchrone Phasenfristen und
   früher Ressourcenabschluss sind implementiert. Die gezielten Verträge mit
   echten Subprozessen einschließlich eines unabhängigen überlebenden Peers
   bestehen auch innerhalb der jüngsten Vollsuite. Die Grenze synchron
   blockierter Aufrufe ausdrücklich erhalten und den Gesamtstand abschließen.
5. **Getter und Selektoren vereinheitlichen.** UIA-AutomationId und Qt-Objektname
   werden jetzt ausdrücklich auseinandergehalten; Punkte sind keine neue
   Routingheuristik. Parser-, Executor-, Worker-, HTTP-, MCP- und Fake-Peer-
   Verträge bestehen. Eindeutigkeit und tatsächliche Feldidentität über
   Getter/Schreiben/Getter sind am selben UIA-Suchfeld über HTTP und MCP real
   bestätigt. Beliebige Labelzuordnung bleibt offen. Legacy-Aliase sind kein vollständiger
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
| A: Offline-Gate | Abgeschlossen: OpenAPI-Beschreibung, gültige Enum-Kontexte und tatsächliche Helferproduzenten | Größenvertrag und vollständiges `npm test` bestehen. |
| B: Standardcursor | Einzelne Nr-Zellenaktivierung, Fehlerausgang und Fokusgrenzen | Funktional bestanden: kleine und große Tabelle, vollständiges Roh-/Typinventar, unveränderte Daten, gemeldetes Ende und sichtbare letzte Geschäftszeile. ESC-Diagnose durch Vollsuite und eigene Produktprüfung bestätigt. |
| C: Tipps und Mutationen | Vorbereitung vor erster Bindung und native Nullwert-Umschaltung | Reale Standard-Cursorvorbereitung sowie native erste Add-/Update-Vorbereitung, Off→On→Off und Löschen bestanden; übrige Zeilen und zurückgesetzte Originalfingerprints unverändert. Abschließenden Gesamtstand erneut prüfen. |
| D: Getter-Identität | Tatsächliche UIA-/Qt-Identität über API und MCP | UIA-Suchfeldreise HTTP/MCP in beiden Backendkonfigurationen bestanden. Explizite native Getter über QObject-Namen und tatsächlich beobachteten Qt-RID in der Integration bestanden; beliebige Label-/Feldzuordnung bleibt separat. |
| E: Leistung | Zunächst getrennte Zeiten gemeinsamer Proofphasen, danach belegte Doppelarbeit | Gleiche vollständige Arbeitslast bei gleichen Sicherheitsprüfungen vergleichen; keine Beschleunigung allein aus isolierten Helferzeiten ableiten. |
| F: Integration | Dokumentation, Runtime, Produktreisen, Mega-/Soak- und Paketprüfungen | Alle vorgesehenen Gates auf demselben endgültigen Quellstand bestehen; vorhandene Änderungen des Zielbranches sind separat abgeglichen. |

Die Pakete getrennt abnehmen. Die realen Prüfungen von B und C ersetzen keine
Gesamtprüfung späterer Änderungen. Unbekannte Mutationsergebnisse zuerst durch
Lesen abgleichen, niemals blind erneut senden.

## Prüfstand und noch erforderliche Abnahme

Gezielte Verträge für Wrapper, Zustandsreise, Grid, RAW-Auflösung und
Feldmehrdeutigkeit wurden geprüft. Für Grid liegen außerdem Prüfungen mit
kleinen und großen synthetischen Tabellen sowie mit nativer Konfiguration vor.
Die kleine und große Standard-Cursortabelle stimmen vollständig mit ihren
unabhängigen Rohwert-/Typorakeln überein. Die große Tabelle verwendet die neue
Nr-Zellenaktivierung. Die kleine Tabelle besteht zusätzlich mit anfangs offenem
Tipps-Fenster und automatischer Vorbereitung. Frühere grüne Prüfungen gelten
für ihren jeweiligen Quellstand. Die jüngsten Diagnoseänderungen bestehen
in erneuter Vollsuite und passenden nativen beziehungsweise Standard-Produktläufen.

**Die Offline-Suite ist grün; die gesamte Produktabnahme bleibt offen.**
Frühere Abbrüche bei Zeitsteuerung, Helferbindung, Enum-Kontext und
Ergebnisextraktion sind korrigiert und durch die vollständige Suite bestätigt.

Prüfstand des aktuellen Checkpoints:

| Prüfung | Ergebnis | Konsequenz |
| --- | --- | --- |
| Jüngstes `npm test` | **GRÜN**, einschließlich exklusiver Lebenszyklusprüfungen, Abdeckungs-/Ergebnisbilanz und Doku-Abgleich. | Reale Produktreisen und Paketprüfungen bleiben erforderlich. |
| Allgemeine API-/MCP- und Produktverträge | Neue Getter-Enums mit gültigen Kontexten geprüft; Ergebnis- und Produkt-Gates folgen tatsächlichen Grid-/Close-Helfern. | Keine gelockerten Produktionsselektoren oder lediglich übersprungenen Prüfungen. |
| Neue Verträge innerhalb der jüngsten Vollsuite | Getter-Namensräume über Parser/Executor/HTTP/MCP und Worker, Nr-Zellenaktivierung, Keyboard-Grenzen, Klickfehler, UIA-Tiefenbegrenzung, Tipps-Vorbereitung samt Dispatchergrenzen und Close-Helfer sowie Wrapper-Cleanup bestanden. | Kontrollierte Regressionen; reale GUI-Abnahme und nach dem Abbruch nicht ausgeführte Tests bleiben offen. |
| Bereits geprüfte begrenzte Verträge | Grid-API/-Reader, bestehender Cursor, RAW-Resolver, Zustandsreise und direkte Feldauflösung bestanden. | Ersetzen keine vollständige aktuelle Produktreise. |
| Syntax- und Repository-Privacy-Verträge | Innerhalb der Vollsuite bestanden; Repository-Privacy beim Checkpoint erneut bestanden. | Kein Ersatz für die Verhaltensabnahme. |
| Build und gezielte Prüfungen | Build einschließlich C#-Helfer, TypeScript und Plugin-Erzeugung sowie gezielte neue Verträge bestanden. | Kein Ersatz für Vollsuite, reale Produktläufe und Paketabnahme. |
| `npm run docs:check` und `npm run check:plugin` | Beim aktuellen Checkpoint erneut bestanden; erzeugte Runtime ohne Drift. | Maschineller Abgleich ergänzt die ausdrücklich dokumentierten offenen Verhaltensprüfungen. |
| Getrennte native Qt-Tests | Alle sechs Tests bestanden. Der erste mehrsprachige Texteingriff, explizite Qt-Getter, erfolgreiche Phasenerfassung und getrennter absichtlicher Commit-Timeout samt passivem Abgleich sind geprüft; Operationsfristen unverändert. | Ein früherer Lauf reproduzierte eine sporadische Erstverzögerung mit genau einer späteren Übernahme. Ihre Ursache bleibt offen; neue Phasen grenzen künftige Vorkommen ein. Keine Mutation wiederholen oder Frist blind erhöhen. |

Die Sicherungscommits bewahren bewusst den unfertigen Stand. Die
anschließenden Korrekturen sind keine Veröffentlichungsfreigabe. Passende
Live-Läufe und Paketprüfungen auf dem integrierten Stand
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
