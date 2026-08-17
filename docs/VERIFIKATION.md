# Verifikationsstand

Stand: 2026-08-13

Dieses Dokument trennt veröffentlichte Verträge, Mock-/Quelltests und echte
SSE-Läufe. Ein grüner Vertragstest beweist nicht automatisch, dass jede
UI-Operation auf jeder Jahresversion praktisch funktioniert.

## Produkt- und Supportmatrix

| Profil | Status | Verifizierter Build | Lesen/Navigation/Ergebnis | Prüfer | UStVA lesen | allgemeine Schreibpfade | profilierter Focusless-Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `2025` | `supported` | `31.0.1.0` | Live-Muster grün, 38 semantische Prüfungen | Live-Muster grün | Live-Muster grün | nur einzeln gebunden; keine vollständige Live-Matrix | nur mit bereitgestellter Fixture |
| `2024` | `experimental` | `30.0.127.0` | Opt-in-Live-Muster grün, 41 semantische Prüfungen | Opt-in-Live-Muster grün | Opt-in-Live-Muster grün | nicht freigegeben | keiner |

`experimental` bedeutet: Das Profil darf weder vom Setup angeboten noch wie
ein produktiv unterstütztes Jahr behandelt werden. Der Opt-in dient nur der
gezielten Verifikation. Er ist keine Nutzerfreigabe für unbewiesene
Steuerdatenänderungen. API und direkter Worker begrenzen den Opt-in auf
paritätsgetestete Kataloge für Lesen, Navigation, Prüfer/UStVA-Read sowie den
nötigen Wegwerfkopie-Lebenszyklus; Tabellen-, Steuerdaten-, Speicher-, Export-
und VaSt-Mutationen bleiben mit `profile-operation-unverified` gesperrt.
`dialog_answer` gehört nicht zum allgemeinen Katalog: Nur `OK` auf der exakt
titel-, text- und schaltergebundenen passiven Gewinnaktualisierungsnotiz darf
die Worker-Prüfung erreichen. Insbesondere eine Wiederherstellungsdatei wird
nie automatisch verworfen.

## Was die Tests beweisen

| Ebene | Befehl | Beweis | Nicht bewiesen |
| --- | --- | --- | --- |
| Schnell | `npm run test:fast` | Build, vollständiger Operations-/Toolkatalog, strikte Eingaben, Auth-/Transportgrenzen, Mock-Journeys, Sicherheits- und Quellverträge | reale SSE-UI |
| Vollständig offline | `npm test` | zusätzliche Packaging-, Worker-, Timeout-, Cleanup- und No-Console-Verträge sowie die Abdeckungsbilanz | reale SSE-UI; optionale Fixtures können fehlen |
| Striktes Live-Gate | `npm run test:live` | beide Profile nacheinander, jede vom Profil erlaubte Leseoperation, der profilierte Schreibweg, echter MCP→API→Worker-Weg, direkter HTTP↔kanonischer MCP-Vergleich, Hash- und Cleanup-Invarianten; fehlende Voraussetzungen sind Fehler | vollständige Mutationsmatrix |
| Einzelprofil-Live | `npm run test:live-muster` | gezielter profilabhängiger Musterlauf für Diagnose | das jeweils andere Profil |
| Focusless | `npm run test:hidden-focusless` | ein konkret profiliertes 2025-Feld mit Feld-/Summen-/Dirty-State-Readback; im strikten Gate enthalten | andere Felder; 2024; sichtbare Tabellen-/Combo-Pfade |

Der Laufzeitkatalog ist die Quelle für die aktuelle Anzahl und Benennung der
Operationen. Am genannten Stand enthält er 87 API-Operationen und 87
MCP-Werkzeugnamen. Das sind nicht 87 eindeutige Eins-zu-eins-Zuordnungen:
`sse_change_field` und `sse_change_known_field` rufen beide
`tracked_set_value` auf; `checker_detail` ist eine API-interne Komposition von
`sse_checker_open`.

Alle Operationen besitzen getestete Eingabeschemata und einen versionierten
`Result_<operation>`-Mindestvertrag. API, Discovery, OpenAPI und alle
MCP-`outputSchema`-Definitionen verwenden diesen Katalog; ein malformed
Worker-Ergebnis wird vor der Ausgabe mit `invalid-operation-result` gestoppt.
Die Schemas bleiben für zusätzliche Fachfelder offen. Deshalb ist „alle
Operationen transportseitig validiert“ weiterhin nicht mit „jede mögliche
UI-Ergebnisvariante live erzeugt“ gleichzusetzen.

## Abdeckungsbilanz aus echter Ausführung

`test/operation-coverage.json` ist keine handgepflegte Behauptung: Die
verhaltenstragenden Testharnische protokollieren jede Operation, die einen
echten API-Executor erreicht, und der letzte Schritt von `npm test` vergleicht
das Protokoll mit dem Katalog. Die Bilanz ist eine Ratsche in beide
Richtungen – verschwundene Abdeckung ist eine Regression, neue Abdeckung muss
mit `SSE_WRITE_OPERATION_COVERAGE=1` bewusst übernommen werden.

Gezählt wird nur der API-Rand. Operationen, die eine Komposition oder ein
Szenario intern aufruft, gelten damit nicht automatisch als geprüft; sie
brauchen einen eigenen Aufruf über die HTTP-Grenze.

Stand: alle 87 Operationen werden im Offline-Lauf mindestens einmal
erfolgreich ausgeführt – überwiegend gegen den zustandsbehafteten
synthetischen Worker, der Seitengraph, Elementbaum, Tabelle, Menü, VaSt-Dialog
und Fenster-/Desktopzustand modelliert. Das beweist Argumentbindung,
Ressourcenauflösung, Komposition, Ergebnisvertrag und Redaktion über die
gesamte Kette. Es beweist ausdrücklich **nicht** die proprietäre UIA-Schicht;
dafür zählt allein die Live-Spalte derselben Bilanz, die `npm run test:live`
gegen die installierte Anwendung füllt. Dort stehen derzeit 52 der 87
Operationen; zwei weitere (`collect`, `scroll`) sind live nur auf ihrem
dokumentierten Fehlerpfad belegt.

Die Bilanz berichtet außerdem die teuersten Operationen eines Laufs. Der
Befund ist eindeutig: Auch rein lokale Auskünfte zahlen den vollen Preis eines
frischen PowerShell-Prozesses – `case_hash` braucht rund 1,2 s je Aufruf, ohne
die Oberfläche überhaupt zu berühren. Wer viele Fälle prüft, sollte das
einplanen; die Zahl ist gemessen, nicht geschätzt.

## Aktueller Live-Muster-Sweep

Der Sweep startet ohne vorhandene SSE-Instanz. Er kopiert jeden offiziellen
Musterfall in den isolierten Test-Fallbereich, erzeugt daraus eine zweite
Arbeitskopie, bindet PID/HWND, liest ausschließlich, schließt mit Verwerfen,
prüft den unveränderten SHA-256 und entfernt nur die eigenen Testkopien.

Welche Operationen der Sweep versucht, entscheidet nicht der Test, sondern die
Fähigkeitsmatrix aus `sse_capabilities`. Alles, was das aktive Profil erlaubt
und keinen Steuerfall verändert, wird ausgeführt; alles andere muss die Matrix
ausdrücklich als gesperrt ausweisen. Ein stiller `SKIP` ist damit ausgeschlossen –
ein Profil kann keine Prüfung mehr dadurch verlieren, dass sie einfach ausbleibt.

Er umfasst derzeit unter anderem:

- Produkt-/Fallhash, Kopie, Start, Dialoginventar und gebundener Close;
- Fenster-/Seitenzustand, Ergebnisse, Seiten-, Vollseiten-, Hilfe- und
  Tabellenleser;
- Navigation, Unterseiten, Suche, Roll- und Baumzustand;
- katalogisierten Seitenzustand samt Inhaltsfingerprint, Einzelwertlesung,
  Positionen, Seitenprüfung und Auswahllisten;
- Prüferlauf, Prüferergebnis, gebundenes Öffnen einer Meldung, Reset und Close;
- UStVA-Zeitraum und Betragsreadback ohne Speichern oder Übermittlung;
- Element-Snapshot, Accessibility-Probe und Vergleich des sicheren
  TreeWalker-Pfads mit dem Bulk-Snapshot;
- Sammellauf, hashgebundenen Soll/Ist-Abgleich, Kontrollbild und Fallsicherung
  in die isolierten Test-Ressourcenbereiche;
- einen zweistufigen, rein lesenden Szenariolauf samt Abschlussschritt und
  hashgebundenem Ergebnisbericht.

Genau dieser Sweep hat drei Operationen aufgedeckt, die gegen die echte
Anwendung nie funktioniert haben: `backup_cases`, `known_page_state` und
`goto` auf die bereits offene Seite endeten jedes Mal mit
`invalid-operation-result`, weil ihr veröffentlichter Ergebnisvertrag einen
anderen Typ versprach als der Worker lieferte – eine Anzahl statt einer Liste,
ein Fingerprint statt einer Zahl, ein Text statt einer Liste. Alle drei waren
zuvor grün, aber eben nur schematisch geprüft. Ein Ergebnisschema ohne echten
Aufruf ist deshalb keine Zusicherung.

Ebenfalls belegt: Der Sprung über die globale Suche aktiviert den Treffer im
Vorbereitungszweig reproduzierbar nicht – der Doppelklick verpufft und `goto`
meldet korrekt `not-found`. Der gleichnamige Eintrag im Navigationsbaum führt
dagegen zuverlässig zum Ziel. Der Sweep nimmt deshalb diesen Weg; er ist damit
zugleich der einzige Live-Beleg für `click_point`.

`snapshot_compare` bleibt auf Engine 30 gelegentlich rot, auch über drei
unmittelbar benachbarte Messpaare hinweg: Der Bulk-Snapshot sieht dann zwei
unbenannte `Text`-Knoten, die der sichere TreeWalker nicht liefert. Das ist
genau der Befund, für den das Werkzeug gebaut wurde – er bleibt fail-closed und
wird nicht weichgestellt. Wiederholt sich das systematisch, gehört der
Unterschied untersucht, nicht toleriert.

Ein weiterer Engine-Unterschied ist damit belegt: `combo_options` bindet die
Auswahleinträge an die AutomationId der ComboBox. Engine 31 liefert so eine
vollständige Liste; Engine 30 hängt die Popup-Einträge nicht darunter und der
Leser meldet ehrlich `not-found`, statt eine womöglich fremde Liste zu
behaupten. Der Live-Sweep akzeptiert genau diese beiden Ausgänge – eine dritte,
stillschweigend geratene Liste wäre der Fehler.

## Profilierter Schreibweg

Der einzige Mutationspfad mit echter Live-Evidenz ist der profilierte
Focusless-Commit: eine gebundene Tabellenzelle auf einem privaten
Windows-Desktop, mit laufendem Vordergrundwächter. Bewiesen werden
Feld-Readback, abhängige Seitensumme, `ungespeichert`, das Ausbleiben jeder
physischen Eingabe und dass die Arbeitskopie nicht auf die Platte geschrieben
wird. Das strikte Gate führt ihn aus, sobald `SSE_FOCUSLESS_FIXTURE` auf einen
geeigneten Gew-Testfall zeigt.

Warum nicht automatisch aus dem Musterfall? Auf dem privaten Desktop ist ein
echter Mausklick technisch ausgeschlossen, es bleibt der lineare Blätterweg –
und der offizielle Musterfall öffnet auf einer Seite, die gar kein „Weiter"
anbietet. Ein Fall, der sich die profilierte Seite bereits merkt, ist deshalb
Voraussetzung. Ohne ihn bleibt der Schreibweg ungeprüft; die Live-Spalte der
Abdeckungsbilanz weist genau das aus, statt es zu überspielen.

Ein Vorbehalt gehört dazu: Erscheint beim Start eine Wiederherstellungsfrage,
beantwortet dieser Schritt sie gebunden mit „Nein". Das verwirft die
Autosave-Daten einer zuvor abgestürzten SSE-Sitzung – auch wenn diese zu einem
ganz anderen Steuerfall gehört. Das Gate startet deshalb nur ohne laufende
SSE-Instanz; wer eine offene Wiederherstellung erwartet, klärt sie vorher
selbst in der Anwendung.

Engine 30 vergibt bei einzelnen semantisch identischen, unbenannten Qt-Knoten
zwischen zwei unmittelbar folgenden Läufen neue Runtime-IDs. Der Vergleich
weist diese als `runtimeIdChurnCount` aus und paart sie nur im identischen
Traversal-Slot mit identischem Elternindex und gleicher Tiefe, wenn außerdem
Typ, Name, AutomationId, Geometrie, Zustand und privater Wert intern exakt
identisch sind. Die privaten Vergleichsdaten verlassen den Worker nicht; echte
Struktur- oder Wertabweichungen bleiben ein Fehler.

Praktische Folge für Aufrufer: Eine Runtime-ID aus einem vorherigen Aufruf ist
auf Engine 30 keine tragfähige Bindung für eine Aktion – der Klick endet dann
mit `not-found` auf einem leeren Bezeichner. Für Aktionen binden Name oder
AutomationId; die Eindeutigkeit wird vorher lesend geprüft.

Strikte Ausführung beider Profile in PowerShell:

```powershell
npm run test:live
```

Der Runner entfernt eine eventuell gesetzte Fallauswahl, startet nur ohne
vorhandene SSE-Instanz, prüft `2025` und danach `2024` vollständig und verlangt
nach jedem Profil wieder null SSE-Prozesse. Für 2024 setzt er den eng begrenzten
Verifikations-Opt-in selbst. Im Lauf werden ein Dateihash und ein stabiler
Ergebnisreadback jeweils direkt per HTTP und über das kanonische MCP-
`structuredContent` verglichen.

Fehlende Installation, Musterdatei oder Testvoraussetzung darf in einem
verpflichtenden Live-Gate nicht als grüner `SKIP` gelten. Vor und nach dem Lauf
muss geprüft werden, dass keine fremde SSE-Instanz übernommen oder beendet
wurde.

Während des Laufs darf der Rechner nicht nebenher bedient werden. Navigation
läuft über echte, positionsgeprüfte Mausklicks; Windows verweigert den
Vordergrundwechsel, solange ein anderes Programm die Eingabe hält, und der
Klick landet dann nicht in der Anwendung. Beobachtete Folge: `sse_goto` bzw.
`sse_click_point` melden reproduzierbar `not-found` oder
`postcondition-failed`, obwohl das Ziel sichtbar ist. Der Worker wartet nach
dem Klick inzwischen aktiv auf den Seitenaufbau statt nach fester Frist einmal
nachzusehen, und der Sweep wiederholt den wiederholbaren Baumklick begrenzt –
gegen dauerhafte Fremdbedienung hilft beides nicht, und die Fehlermeldung sagt
das inzwischen ausdrücklich.

## Noch nicht freigegeben

Für „jede praktische SSE-Aktion vollständig geprüft“ fehlen insbesondere:

1. ein gepflegter Live-Runner für Combo/Toggle, Tabellen-Add/Update/Delete,
   UStVA-Schreiben sowie Speichern, Schließen und erneutes Öffnen. Diese
   Operationen sind offline gegen den synthetischen Worker vollständig
   abgedeckt – gegen die echte Anwendung bleiben sie unbewiesen. Live belegt
   ist bisher allein der profilierte Focusless-Commit, und der speichert
   bewusst nicht. Der Lesesweep zeigt, wie so ein Runner aussehen müsste: Er
   fragt die Fähigkeitsmatrix, führt jede erlaubte Operation aus und verlangt
   für jede ausgelassene einen genannten Sperrgrund;
2. ein vollständiger HTTP-gegen-MCP-Szenariolauf auf zwei unabhängigen frischen
   Wegwerfkopien einschließlich der freigegebenen Mutationen; der aktuelle
   Live-Lauf belegt bereits die echte Transportparität für Hash und Ergebnisreadback;
3. eine ausdrücklich bereitgestellte neutrale VaSt-Fixture für Mapping und
   Apply. Ohne diese Fixture bleibt VaSt-Apply unbewiesen und gesperrt.

Die Live-Spalte der Abdeckungsbilanz ist die verbindliche Antwort darauf,
welche Operationen die echte Anwendung schon bedient hat. Prosa in dieser Datei
darf ihr nie widersprechen.

Eine Jahresprofil-Promotion ist erst zulässig, wenn diese Freigaben nicht
pauschal über den Profilstatus erfolgen und alle für das Jahr erlaubten
Operationsklassen mit passender Live-Evidenz hinterlegt sind.
