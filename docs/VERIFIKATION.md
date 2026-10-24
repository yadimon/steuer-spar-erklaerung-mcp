# Verifikationsstand

Dieses Dokument trennt, was die Testsuite beweist, von dem, was nur ein echter
Lauf gegen die installierte Anwendung beweisen kann. Ein grüner Vertragstest
belegt nicht automatisch, dass eine UI-Operation auf jeder Jahresversion
praktisch funktioniert.

## Nachweisstufen und Testauswahl

| Stufe | Was sie belegt | Was offen bleibt |
| --- | --- | --- |
| Quell- und Dokumentationsvertrag | Katalog, Ergebnisformen, Sperren und dokumentierte Struktur passen zusammen | tatsächliche Bedienung und Laufzeitverhalten |
| Synthetischer Ablauf | Produktionscode reagiert an kontrollierten Grenzen auf Erfolg, Fehler, Abbruch und unbekannte Ausgänge | Verhalten des ausgelieferten Produktprofils |
| Native Komponentenprüfung | tatsächliche DLL, Broker und Runtime arbeiten mit dem synthetischen Qt-Programm zusammen | Parität mit realen SSE-Seiten und Dialogen |
| Produktprüfung | Installation, Build und freigegebenes Profil passen zur Konfiguration | erfolgreicher fachlicher Bedienablauf |
| Live-Reise | die konkret geprüfte Folge funktioniert am unterstützten Produkt mit vollständigem Readback und Cleanup | andere Seiten, Zustände, Backends oder spätere Quellstände |

`npm run test:inventory` liest ausschließlich den deklarativen Suiteplan und
führt keine Tests aus. Für maschinenlesbare Ausgabe gilt
`npm run --silent test:inventory -- --json`. Die Spalte `fullPhase` bezeichnet
die Phase der vollständigen Suite, auch wenn ein Schritt zusätzlich im
Schnellplan läuft. Voraussetzungen und Mindestchecks stehen in
[CONTRIBUTING.md](../CONTRIBUTING.md).

`npm run test:fast` ist kein rein statischer Lauf; die Suite enthält neben dem
TypeScript-Build auch Windows-PowerShell- und Worker-Verträge. `npm test` baut
zusätzlich den C#-Helfer und prüft Controllergrenzen. Produkt-, native
Komponenten- und GUI-Prüfungen bleiben eigene Schritte. Ein Testname oder die
Endung `.mjs` beweist keine Nebenwirkungsfreiheit.

Die [Windows-CI](../.github/workflows/windows-ci.yml) prüft Offline-Verträge,
Produktionsabhängigkeiten ab Schwereklasse `high`, Plugin-Abgleich und saubere
Paketinstallation. Der erforderliche Check heißt
`Offline API/MCP and package gate`; er ersetzt weder das lokale Release-Gate
`npm run check` noch eine Produktreise. Pull Requests und wirksame Main-Regeln
werden gemäß [Contributor-Anleitung](../CONTRIBUTING.md) separat kontrolliert.

## Was die Testsuite beweist

Die Suite prüft Transport, Schemas, Zustandsmaschinen, Sperren und Fehlerwege
offline; die vollständige Suite setzt voraus, dass SSE geschlossen ist.
Das umfasst den vollständigen
Operationskatalog, die Abbruch- und Zeitgrenzen, die Redaktion privater Pfade
und Beträge sowie die fail-closed-Zusagen bei unbekannter Produktversion.

Was sie **nicht** beweist: dass ein Bedienschritt am realen Programm zum Ziel
führt. Dafür zählt allein der Live-Nachweis.

Die API-Testhülle erhält den ursprünglichen Fehler und den Exitcode ihres
Testprozesses. Unabhängige Aufräumschritte werden auch nach einem Fehler
versucht; zusätzliche Fehler tragen ihre eigene Phasenkennung. Ein erfolgreicher
Test mit fehlgeschlagener Bereinigung bleibt fehlgeschlagen. Die gezielte
Regression prüft diese Regeln an echten Kindprozessen und der tatsächlichen
Hülle, einschließlich der ausdrücklich angeforderten Diagnose-Sandbox.
Die Diagnose-Datei wird dabei über ihren kanonischen Elternpfad gebunden.
Gezielt abweichende Pfadschreibweisen müssen dieselbe Öffnung und genau einen
Abschluss beobachten; sonst könnte ein verfehlter Test-Hook zugleich die
Fehlerinjektion und ihre Kontrolle umgehen.

Die Getter-Regressionen `get-value-namespace-contract.mjs` und
`get-value-worker-namespace-contract.ps1` prüfen die explizite Wahl zwischen
UIA und QObject: Legacy-Namen mit und ohne Punkte, kanonische QObject-Namen,
frische Referenzen, widersprüchliche RID-Familien und fehlendes Backend.
Ungültige Kombinationen dürfen keine Provideraktion auslösen; ein
fehlgeschlagener Read darf den Backendpfad nicht wechseln. Der erste Test
führt den echten API-Executor sowie HTTP und den registrierten MCP-Handler
über einen InMemory-Transport aus; die Backendantworten sind synthetische
Vertragsdaten. Der Worker-Test führt den echten Dispatcher bis zu seiner
Fensterresolvergrenze aus. `qt-native-client.mjs` prüft zusätzlich die
framed Fake-Peer-Grenze. Diese Tests belegen weder reale Feldbedienung noch
eine allgemeine Gleichheit der QObject-Labelauflösung mit UIA-Schreibzielen.

`table-preparation-contract.ps1` prüft die tatsächlichen Vorbereitungs- und
Schließfunktionen mit synthetischen Fenster-/Providergrenzen: exakte eigene
nichtmodale Tips-Identität, fehlende Richtlinie, unbekannte oder zusätzliche
Fenster, aktive Editoren sowie Änderungen an Prozess, Eigentümer, Eingabe,
Vordergrund und vollständigem Seitenzustand. Fehler vor Dispatch müssen
ohne Close enden; fehlende Bestätigung nach Dispatch darf weder Replay noch
Tabellenmutation auslösen und muss den ungewissen Fokuskontext erhalten.
Die exakt bekannte zusätzliche Werte-Info benötigt einen eigenen unveränderten
nichtmodalen Root-, Eigentümer-, Inhalts- und Geometrienachweis. Sie darf kein
Vordergrundfenster sein. Gegenfälle umfassen doppelte oder falsche Peers,
späte Änderungen sowie ein nach dem Close verändertes Beobachterfenster;
entfernt werden darf ausschließlich das Tipps-Fenster.
`table-preparation-boundary-contract.ps1` prüft die echten Dispatcherpräfixe:
Vorbereitung nur vor öffentlichem Cursorlesen, erstem nativen `prebind` und
eigenständigen Mutationen; keine Vorbereitung für Grid, `noKeys: true`,
spätere private Cursorphasen oder geerbte Mutationsbindungen.

Diese Regressionen ersetzen keine reale GUI-Abnahme der neuen
Tabellenvorbereitung und Fokuswege. Insbesondere sind große Tabellen,
Nr.-Editorübergänge und das Zusammenwirken mit dem echten Hilfsfenster
über eine vollständig geprüfte Arbeitskopie mit unverändertem
unbeteiligtem Datenbestand und bestätigtem Abschluss zu verifizieren.
Für die Produktabnahme verlangen die vollständige Zustandsreise und die direkte
Mutations-/Cursorfolge zusätzlich vollständige Inventare, Falldatenintegrität
und bestätigtes Cleanup. Ihr Ergebnis gilt nur für den jeweils geprüften Stand.

`table-footer-focus-contract.ps1` bindet die tatsächlichen Worker-Helfer für
Nummerneditor, Zeilenauswahl und Tastaturziel. Nach dem Sprung zum Anfang
werden aktueller Eintrag und bisherige Auswahl ausdrücklich als verschiedene
Zellen modelliert. Nur eine frisch bewiesene unveränderte Nr.-Zelle auf
Modellzeile 0 darf einmal ausgewählt werden; bereits passende Auswahl,
veränderte oder fremde Editoren, falsche Gridzeilen, Kontextwechsel und
ungewisser Aktionsausgang erhalten getrennte Gegenfälle.
`table-read-public-input-contract.ps1` prüft die echten Dispatcherabschnitte
und ihre Reihenfolge vor der ersten Abwärtstaste. Die unmodifizierte
`npm run test:live-state`-Reise fordert zusätzlich Cursorlesen unmittelbar
nach verifiziertem Anlegen, Ändern und Löschen. Ein passiver Readback allein
ersetzt diese Zustandsübergänge nicht.

`table-number-click-contract.ps1` prüft außerdem den ausdrücklich profilierten
Hilfe-Root als Ausgangspunkt derselben einmaligen Nr.-Zellenaktivierung.
Provider-Version, tatsächliche Quellbindung und fehlendes TextPattern müssen
zusammenpassen. Andere Dokumente, editierbare oder geänderte Quellen, fehlende
Profilfreigabe und Fehler bleiben gesperrt. Die vollständige Zustandsreise
prüft zusätzlich die Tabellennutzung nach Seitenwechseln im echten Produkt.
Passive eigene Quellen und eine erhaltene Zeilenauswahl werden getrennt
modelliert. Die direkten Produktionshelfer müssen eine eindeutig gebundene
Auswahl vor dem Klick unverändert wiedererkennen. Gegenfälle umfassen fremde
Container, mehrere Zeilen, fehlende oder doppelte Identitäten, unbekannte
Auswahlzustände und Änderungen unmittelbar vor dem Klick. Der erfolgreiche
Klick darf die Auswahl und die alte Fokusquelle anschließend ändern; der
frische vollständige Tabellenabgleich bleibt erforderlich.
Die Sichtbarkeit des Aktivierungsziels muss unabhängig vom Provider-Flag gelten:
Eine oberhalb des Headers oder unten abgeschnittene Nr.-Zelle darf keinen Klick
erhalten. Eine getrennte vollständig sichtbare Zelle benötigt eindeutige
Rohzeilen-/Semantikzuordnung und Inhalt außerhalb der Nr.-Spalte. Tests müssen
leere oder unvollständige Alternativen sowie Änderungen von Ziel, Grid-Zeile
und Geometrie vor der Aktion abweisen; nach der Zielwahl gibt es kein Ausweichen.

`mcp-wrapper-all-tools.mjs` prüft die kompakte Tabellenantwort über tatsächliches
HTTP und den MCP-Stdio-Adapter mit `incomplete: false`, `incomplete: true` und
fehlendem Flag. Das vollständige `structuredContent` bleibt erhalten; eine
fehlende Vollständigkeitsangabe darf nicht als erfolgreicher vollständiger
Baumlauf ausgegeben werden.

Der optionale native `desktop_start` hat zusätzlich einen realen Win32-Test mit
einem eigenen synthetischen Prozess. Er prüft Hauptfenster und Startdialog,
vorhandene Desktops, fremde und beschädigte Marker, Startup-Timeout, frühen
Prozessausstieg, Abbruch des nativen Helfers und den öffentlichen HTTP-Weg mit
Ressourcenreferenz. Die produktive Helferdatei akzeptiert keine synthetische
Startidentität; dafür wird ein gesondertes, nicht verpacktes Testprogramm gebaut.
Das belegt die Prozess-/Desktopgrenzen, ersetzt aber keinen Herstellerfall-Lauf.

## Live-Abdeckung

Der maßgebliche Stand steht maschinenlesbar in `test/operation-coverage.json`;
ein Vertragstest hält dieses Dokument dagegen. Dort stehen 96 der 102
Operationen als live-funktional.

Sechzehn Ledger-Einträge verwenden einen übernommenen separaten Nachweis statt
der laufenden Live-Trace-Prüfung: neun BelegManager-Operationen, `instances` und
die sechs VaSt-Operationen. Davon sind zehn funktional und sechs ausschließlich
auf dem Fehlerpfad belegt. `receipt_manager_update` gehört dagegen zum regulären
Live-Nachweis. Ein übernommener Eintrag beweist keinen erneuten Lauf auf dem
aktuellen Quellstand.

„Funktional“ bewertet den registrierten Operationsvertrag: Das kann ein
erfolgreicher Ablauf oder ein vollständig geprüfter, beabsichtigter globaler
Policy-Block sein. Insbesondere bedeutet BelegManager-Abdeckung keine
öffentliche Freigabe der gesperrten Vordergrundwege. Allgemeine Fehler zählen
weiterhin nur als Fehlerpfad. Die Einteilung stammt aus
`test/operation-coverage-contract.mjs` und darf nicht als Erfolg jeder Mutation
gelesen werden.

Noch 6 der 102 Operationen sind nicht live-funktional belegt.
Diese Bilanz bezieht sich auf den aggregierten Release-Snapshot und ersetzt
keinen erneuten Nachweis pro Paketversion, Backend und API-/MCP-Zugang.

Positive funktionale Nachweise fehlen für `vast_apply`, `vast_dialog_read`,
`vast_mapping_options`, `vast_mapping_select`, `vast_row_details` und
`vast_row_set_expanded`.

Die Bilanz zählt ausschließlich die dort registrierten Suite-Belege.
Erfolgreiche automatische Positions- und Steuerwissen-Prüfungen sind darin
registriert. Ein zusätzlicher Lauf ändert die Bilanz erst durch die reguläre
Ledger-Regeneration. Manuelle Stichproben ersetzen keinen automatisierten
Nachweis. Die weiteren Freigabekriterien stehen in der
[Stable-Abnahme](entwicklung/stable-freigabe.md).

`position_create` wird durch
`node test/with-api.mjs node test/live-income-positions.mjs` geprüft: eine separate,
optionale Live-Prüfung mit einem vollständig neuen synthetischen Folgejahresfall.
Sie prüft die erste und eine weitere Einnahmenposition, das genaue Inventar,
Speichern und Wiederöffnen. Sie benötigt eine freie sichtbare Windows-Sitzung.
Der Lauf verwendet die gewählte Backend-Konfiguration und überspringt keine
Schritte; seine Einzelbelege ersetzen keine umfassende Paketabnahme.

`npm run test:live-tax-knowledge` prüft `tax_knowledge_search` über API und MCP.
Vorher müssen `SSE_KNOWLEDGE_SOURCE_FILE` auf eine kompatible Hersteller-
Musterdatei (`.ESt2025`) und `SSE_CASE_DIR` auf einen neuen Testordner außerhalb
des Repositorys gesetzt sein. Alle SSE-/Steuerwissen-Fenster müssen geschlossen
und die sichtbare Windows-Sitzung frei sein. Der Test kopiert die Musterdatei,
prüft Treffer, bestätigte Nulltreffer und eine falsche Fensterbindung und
beweist die Zugehörigkeit des gestarteten Helfers über ein Windows Job Object.
Er schließt nur die eigenen Prozesse normal und vergleicht die Dateihashes.
Mehrfenster-/Interferenz- und Leistungsabnahme bleiben eigene Prüffälle.

`node test/with-api.mjs node test/live-income-table.mjs --rows=60` prüft eine
weitere neue Einnahmenposition mit vielen synthetischen Buchungen. Nach jeder
Anlage müssen sämtliche Zeilen, Netto-/Bruttobeträge und die Summe stimmen.
Danach folgen ein absichtlich fehlgeschlagenes Update mit Rollback, ein
erfolgreiches Update, die Löschung einer nicht sichtbaren Zeile sowie
Speichern/Wiederöffnen und unveränderte Backup-Hashes. Der normale Lauf nutzt
den vollständigen Cursorread. Mit ausdrücklich konfiguriertem nativen
Testbackend wählt `--model-read` den vollständigen Qt-Modellread; beide Wege
verlangen denselben vollständigen Inventarnachweis und überspringen keine
Mutationen. Ein fehlgeschlagener Lauf bleibt ein fehlgeschlagener Live-Nachweis.

## Native-Integration getrennt zählen

Die [Native-Matrix](NATIVE-COVERAGE.md) führt für jede der 102 Operationen
den Qt-DLL-Status neben dem bestehenden Live-Stand. Gegenwärtig sind 22
Operationen direkt integriert: `get_value`, `table_read`, `snapshot`, `find`,
`read_page`, `subpages`, `known_page_state`, `positions`, `ustva_read`,
`receipt_manager_list`, `receipt_manager_read`, `receipt_manager_action`,
`page`, `ui_state`, `help`, `read_table`, `checker_results`, `goto`,
`receipt_manager_update`, `receipt_manager_link`,
`receipt_manager_classification_options` und `receipt_manager_classify`.
Sie werden nur mit expliziter Konfiguration aktiviert.
Die native Qt-Prüfung vergleicht Suchtreffer, Seitenzeilen und Unterseiten mit
den tatsächlichen Worker-Projektionsfunktionen über unabhängig gelesene UIA-Knoten
und Win32-Fenstergrenzen. Die Offline-Suite prüft zusätzlich Wildcards,
Zeilenanker, mehrdeutige Überschriftencontainer und Übermittlungsfilter sowie
die Seiten-, Hilfe-, Tabellen-, Prüfer- und Zustandsprojektionen der fünf
zuletzt angeschlossenen Lesepfade gegen synthetische Qt-Bäume; unter Windows
führt der Differenzorakel-Test dieselben Worker-Zweige über denselben
Knotenbestand aus.
Die Zahl 96 funktional live belegter Operationen ist keine Qt-Abdeckung.
Zweck und schrittweise Abnahme der Umstellung stehen in der
[Roadmap](ROADMAP.md); technische Bindung und Ausführung beschreibt
[NATIVE-QT.md](NATIVE-QT.md). Keine Nachweisstufe wird allein durch einen
implementierten Handler oder eine schnellere Teilstrecke erreicht.

`table-native-mutation-contract.mjs` prüft den echten Positionierer an
synthetischen nativen Ablehnungen und erfolgreichen, unbestätigten oder
fehlschlagenden Lease-Freigaben. `api-mega-contract.mjs` prüft die tatsächliche
Berichtsgrenze, erhaltene Primärfehler und die wertfreie Projektion.
Die vollständige native Mega-Reise ist ein separater Produktnachweis; eine
erfolgreiche Folgereise klärt frühere sporadische Ablehnungen nicht automatisch.

Der native CTest-Lauf prüft reale DLL, Broker, Discovery und HTTP-Runtime mit
einem synthetischen Qt-Programm. Er ersetzt weder SSE-Live-Parität noch einen
vollständigen Lauf mit dem ausgelieferten Produktprofil. Ein statisch gefundenes
Symbol, ein privater Prototyp und ein integrierter Handler sind unterschiedliche
Nachweisstufen. Die öffentliche Qt-Brücke führt begrenzte, quittierte
Belegmutationen und Navigation aus. Allgemeine Feld-/Tabellenmutationen und
Speichern behalten ihre bestehenden Transaktionswege.

Der atomare Texteingriffs-Permit hat eigene native Zustands- und
Verschachtelungsverträge: Abbruch vor Permit verhindert jeden späteren Einstieg,
Gewinnt der Permit und überschreitet die noch laufende Ausführung danach die
Antwortfrist, bleibt ihr Ausgang unbekannt. Eine zusätzliche frische
Qt-Fixture verzögert einen tatsächlich gelesenen Accessible-Namen vor der
ersten Auswahl. Nach bestätigtem Abbruch und Drain müssen Text, Modell,
Auswahl, Cursor, Fokus und Signalzähler unverändert bleiben; anschließend muss
ein frischer quittierter Edit genau einmal im Modell ankommen. Die ursprüngliche
erste Unicode-Insertion und die Zeitgrenzen bleiben erhalten. Eine absichtlich
zu langsame Anwendungskommitierung bleibt dagegen unbekannt; ein späterer
Schreibversuch muss gesperrt sein. Ein erfolgreicher späterer Lauf klärt einen
früheren sporadischen Timeout nicht automatisch.

Für `snapshot` vergleicht der native Test alle Knoten mit einem unabhängig
gestarteten Windows-UIA-Client, einschließlich nativer Kindfenster, Runtime-IDs,
Eltern, Typen, Geometrie und Werten. Passwortwerte werden ausdrücklich nicht
ausgegeben. Begrenzungen, Filter und frischer `get_value`-Readback über die
Snapshot-ID werden gesondert geprüft. Weitere SSE-Seiten und Nebenfenster
benötigen eigene Paritätsnachweise; ein synthetisches Fenster deckt sie nicht ab.

Bei Schreibwegen sind vorangehende Bindung, Commit, frischer Readback und
gegebenenfalls Summen-/Ergebnisprüfung zu unterscheiden. Eine Transportquittung
bestätigt nur den Empfang der Antwort. Speichern braucht einen eigenen
Datei-/Abschlussnachweis; ein Wiederöffnen prüft zusätzlich die Persistenz.
Ein unbekannter Ausgang darf nicht als Erfolg oder als Erlaubnis zur blinden
Wiederholung gezählt werden.

## Ausdrücklich nicht belegt

- Jahresversionen außerhalb des freigegebenen Produktprofils. Eine unbekannte
  Version wird fail-closed abgewiesen, nicht geraten.
- Jede Übermittlung ans Finanzamt. ELSTER ist gesperrt und bleibt es.
- Vollständige praktische UI-Abdeckung aller Operationen. Transportparität
  bedeutet nicht Bedienbarkeit jedes Zustands.

## Leistung selbst messen

Leistungszahlen hängen so stark von der Maschine ab, dass eine hier
abgedruckte Zahl mehr verspricht, als sie halten kann. Wer sie braucht, misst
sie selbst — die Messwege liegen bei:

```powershell
npm run perf:api-mega
```

Der Lauf führt eine vollständige Referenzreise gegen die installierte Anwendung
aus und meldet die Gesamtzeit sowie die Zeit je Aufruf. Wer eine Änderung
bewertet, misst davor und danach auf **derselben** Maschine, abwechselnd und
mehrfach; eine einzelne Messung trägt keine Aussage.

Für den optionalen nativen Modus müssen `SSE_TEST_NATIVE_PACKAGE` und
`SSE_TEST_NATIVE_MANIFEST_SHA256` gemeinsam auf ein kompatibles, separat gebautes
Paket zeigen. Der Bericht nennt den Ausführungsmodus und die Manifestidentität.
Die Prüfung der interaktiven Sitzung verwendet dann den verifizierten
Win32-Helfer ohne PowerShell-Kompilierung. Ohne diese beiden Einstellungen
misst der Test den Worker-Pfad. Native Messungen ändern das Worker-Coverage-Ledger nicht.
Der Bereitschaftstest übernimmt `SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS` aus der
Pool-Konfiguration; eine längere erlaubte Vorbereitung ist keine schnellere API-Operation.
Ohne eigene Einstellung beträgt das begrenzte Startbudget 30 Sekunden; es gilt
für das Vorwärmen im Hintergrund und verändert kein Operationszeitlimit.
Ein vor dem ersten Aufruf fehlgeschlagener Lauf liefert keine Gesamtlatenz der Reise.

Für produktfreie Teilstrecken stehen `npm run perf:tax-journeys`,
`npm run perf:receipt-workload` und `npm run perf:api-load-soak` bereit; der
Rahmen dazu ist in [`test/performance/README.md`](../test/performance/README.md)
beschrieben.

Die drei Nachweise sind getrennt zu bewerten: `test:live` prüft die installierte
Anwendung über seine deklarierten Live-Schritte; `perf:api-mega` prüft eine
zusammenhängende HTTP-Reise im ausdrücklich gewählten Backend; der produktfreie
HTTP/MCP-Soak verwendet einen synthetischen Executor. Ein grüner Worker-Lauf
oder Soak beweist keine vollständige native Qt-Reise. Ein abgebrochener
Mega-Lauf mit erfolgreicher Bereinigung bleibt ein fehlgeschlagener Lauf und
ist keine Gesamtzeit-Baseline.

### Zustandsübergänge getrennt prüfen

`npm run test:live-state` fordert den geschützten Cursor ausdrücklich mit
`noKeys: false` an, auch bei nativer Konfiguration. Die Mega-Reise behält ihren
getrennten passiven Modell-Readback mit `noKeys: true`.

`test:live-native-add-update` prüft unmittelbar `table_add` → passives
`table_read` → `table_update` mit der von Add gelieferten Zellidentität.
Zwischen diesen Aufrufen bereitet kein weiterer Fokus- oder Cursoraufruf den
Zustand vor. Jeder Durchlauf verwendet eine neue Herstellerfallkopie und einen
frischen Produktprozess. Vollständige Werte, Zelltypen, Checkboxzustände und
unveränderte andere Zeilen werden geprüft. Eine fehlgeschlagene Mutation wird
nicht wiederholt; die erste Abweichung beendet die Serie.

Nach dem Update prüft jeder Durchlauf einen geschützten Cursorlauf, wechselt
auf die zum Dokument passende profilierte Jahreserklärungsseite und zurück
und prüft erneut den geschützten Cursor. Passive vollständige Modellabgleiche
vor und nach diesem zweiten Cursor vergleichen Werte, Typen, Checkboxzustände,
Summe und Zeilenfingerprints. Der Seitenwechsel liegt nach der unmittelbaren
Add-/Read-/Update-Folge; die Reise speichert keine Änderungen.

Nach einem kompatiblen nativen Build, ohne vorhandene SSE-Instanz und in einer
unbenutzten entsperrten Windows-Sitzung:

```powershell
$nativePackage = (Get-Content -Raw -LiteralPath artifacts/qt-native/native-package.json | ConvertFrom-Json).qtNativeRuntime
$env:SSE_TEST_NATIVE_PACKAGE = $nativePackage.directory
$env:SSE_TEST_NATIVE_MANIFEST_SHA256 = $nativePackage.manifestSha256
$env:SSE_TEST_API_PREWARM = '1'
$env:SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE = '1'
$env:SSE_NATIVE_ADD_UPDATE_REPORT = Join-Path ([IO.Path]::GetTempPath()) ('sse-native-transition-' + [guid]::NewGuid().ToString('N') + '.json')
npm run test:live-native-add-update -- --cycles=3
```

Bericht und `.calls.jsonl` bleiben außerhalb des Repositorys. Nach dem Lauf die
gesetzten Testvariablen aus der Sitzung entfernen. Alle GUI-/Controller-Läufe
bleiben seriell. Der vollständige native Mega-Lauf bleibt ein eigener Nachweis;
eine erfolgreiche Wiederholung beweist keine Reparatur einer früheren
sporadischen Ablehnung. Diese Live-Prüfung bleibt ausdrücklich opt-in.

`test:privacy` prüft Arbeitsbaum, nicht ignorierte neue Textdateien und die
Git-Historie aller Referenzen auf private Daten und verbotene Pfade. Die eng
geprüfte Ausnahme für eine unveränderte Herstellerbibliothek bindet Pfad und
SHA-256. Historische Treffer werden über Git-Blob-Identitäten geprüft; derselbe
unveränderliche Blob wird innerhalb eines Laufs nur einmal gehasht. Alle
Revisionen und Suchregeln bleiben geprüft; unbekannte oder beschädigte
Blob-Metadaten führen zum Fehler.
