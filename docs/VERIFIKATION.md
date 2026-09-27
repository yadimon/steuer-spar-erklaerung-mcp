# Verifikationsstand

Dieses Dokument trennt, was die Testsuite beweist, von dem, was nur ein echter
Lauf gegen die installierte Anwendung beweisen kann. Ein grüner Vertragstest
belegt nicht automatisch, dass eine UI-Operation auf jeder Jahresversion
praktisch funktioniert.

## Was die Testsuite beweist

Die Suite prüft Transport, Schemas, Zustandsmaschinen, Sperren und Fehlerwege
offline und ohne die Produktanwendung. Das umfasst den vollständigen
Operationskatalog, die Abbruch- und Zeitgrenzen, die Redaktion privater Pfade
und Beträge sowie die fail-closed-Zusagen bei unbekannter Produktversion.

Was sie **nicht** beweist: dass ein Bedienschritt am realen Programm zum Ziel
führt. Dafür zählt allein der Live-Nachweis.

Der optionale native `desktop_start` hat zusätzlich einen realen Win32-Test mit
einem eigenen synthetischen Prozess. Er prüft Hauptfenster und Startdialog,
vorhandene Desktops, fremde und beschädigte Marker, Startup-Timeout, frühen
Prozessausstieg, Abbruch des nativen Helfers und den öffentlichen HTTP-Weg mit
Ressourcenreferenz. Die produktive Helferdatei akzeptiert keine synthetische
Startidentität; dafür wird ein gesondertes, nicht verpacktes Testprogramm gebaut.
Das belegt die Prozess-/Desktopgrenzen, ersetzt aber keinen Herstellerfall-Lauf.

## Live-Abdeckung

Der maßgebliche Stand steht maschinenlesbar in `test/operation-coverage.json`;
ein Vertragstest hält dieses Dokument dagegen. Dort stehen 94 der 102
Operationen als live-funktional.

Sechzehn davon sind in einer abgeschotteten Prüfumgebung belegt statt im
regulären Live-Lauf: der gesamte BelegManager, `instances` und die
VaSt-Operationen. Diese Trennung bleibt bewusst sichtbar, weil ein Nachweis aus
einer abgeschotteten Umgebung weniger wiegt als einer aus dem Alltagsbetrieb.

Noch 8 der 102 Operationen sind nicht live-funktional belegt.

Von keinem automatisierten Suitelauf funktional ausgeübt wurden
`position_create`, `tax_knowledge_search`, `vast_apply`, `vast_dialog_read`,
`vast_mapping_options`, `vast_mapping_select`, `vast_row_details` und
`vast_row_set_expanded`.

Die Bilanz zählt ausschließlich, was ein Suitelauf selbst protokolliert.
Manuelle Stichproben ersetzen den fehlenden automatisierten Nachweis für
`tax_knowledge_search` nicht.

## Native-Integration getrennt zählen

Die [Native-Matrix](NATIVE-COVERAGE.md) führt für jede der 102 Operationen
den Qt-DLL-Status neben dem bestehenden Live-Stand. Gegenwärtig sind siebzehn
Operationen direkt integriert: `get_value`, `table_read`, `snapshot`, `find`,
`read_page`, `subpages`, `known_page_state`, `positions`, `ustva_read`,
`receipt_manager_list`, `receipt_manager_read`, `receipt_manager_action`,
`page`, `ui_state`, `help`, `read_table` und `checker_results`.
Sie werden nur mit expliziter Konfiguration aktiviert.
Die native Qt-Prüfung vergleicht Suchtreffer, Seitenzeilen und Unterseiten mit
den tatsächlichen Worker-Projektionsfunktionen über unabhängig gelesene UIA-Knoten
und Win32-Fenstergrenzen. Die Offline-Suite prüft zusätzlich Wildcards,
Zeilenanker, mehrdeutige Überschriftencontainer und Übermittlungsfilter sowie
die Seiten-, Hilfe-, Tabellen-, Prüfer- und Zustandsprojektionen der fünf
zuletzt angeschlossenen Lesepfade gegen synthetische Qt-Bäume; unter Windows
führt der Differenzorakel-Test dieselben Worker-Zweige über denselben
Knotenbestand aus.
Die Zahl 94 funktional live belegter Operationen ist keine Qt-Abdeckung.

Der native CTest-Lauf prüft reale DLL, Broker, Discovery und HTTP-Runtime mit
einem synthetischen Qt-Programm. Er ersetzt weder SSE-Live-Parität noch einen
vollständigen Lauf mit dem ausgelieferten Produktprofil. Ein statisch gefundenes
Symbol, ein privater Prototyp und ein integrierter Handler sind unterschiedliche
Nachweisstufen. Die öffentliche Qt-Brücke aktiviert keine Mutation.

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

```bash
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
Ein vor dem ersten Aufruf fehlgeschlagener Lauf liefert keine Gesamtlatenz der Reise.

Für produktfreie Teilstrecken stehen `npm run perf:tax-journeys`,
`npm run perf:receipt-workload` und `npm run perf:api-load-soak` bereit; der
Rahmen dazu ist in [`test/performance/README.md`](../test/performance/README.md)
beschrieben.
