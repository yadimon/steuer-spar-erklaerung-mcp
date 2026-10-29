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

`table-native-mutation-contract.mjs` prüft die zusätzliche passive
Runtime-ID-Zuordnung bei gleichen Zeilentexten vor jeder Fokus- oder
Positionsaktion: ein Zuordnungsaufruf, weiterhin beide vollständigen
Zeilennachweise und höchstens ein Schreibaufruf. Zehn passende Modellzellen
benötigen keine wiederholten Worker-Versuche. Gegenfälle umfassen fehlende,
leere und falsche IDs, unzulässige Koordinaten, geänderte Modelle,
Abbruch, vollständig gleiche sichtbare Zeilen und private Ergebnisfelder.
Ausgeblendete, deaktivierte und Checkbox-Zellen liefern keine Zielautorität.
Löschfälle behalten eine andere gleich benannte Zeile bei und prüfen auch
eine falsch gelöschte Zeile, veränderte Restwerte und verlorene Endprüfungen.
Ein vorläufiges Worker-Ergebnis darf erst nach vollständigem Modellvergleich
als verifiziert erscheinen; interne Nachweisfelder bleiben verborgen.
Falsche Summen und Fehler nach begonnenem Schreibauftrag müssen einen
ungewissen Ausgang ohne Wiederholung melden. Private Nachweisargumente werden
in API und MCP abgewiesen; auch der Kompatibilitätspfad darf ein vorläufiges
natives Löschergebnis nicht als Erfolg ausgeben.

`table-mutation-target-contract.ps1` führt die tatsächliche
Lokalisierungsfunktion, private Planschemata und Ergebnisprojektion aus.
Der Raw-Resolver verlangt wie die kompilierte Grenze mindestens zwei
Zell-IDs; deshalb wird eine vollständige sichtbare Zeile aufgelöst.
Zusätzliche Auswahlgegenfälle prüfen die frische Löschbindung, einschließlich
fremder, doppelter, fehlender und inzwischen verschobener Auswahlzellen.
Der Tastaturfokus muss zur geprüften Zeile gehören. Für einen fokussierten
Tabellencontainer werden zusätzlich dessen Identität und genau eine aktuell
fokussierte Zeilenzelle geprüft; fremde, fehlende oder mehrere Fokuszellen
bleiben gesperrt.
Ein fokussierter Edit-Delegate bleibt auch bei gleichzeitigem Fokushinweis
der Datenzelle gesperrt. Der Vertrag prüft außerdem, dass der native Löschpfad
keinen zusätzlichen Zellklick und kein textbasiertes Rückgängigmachen ausführt.
Diese synthetischen Verträge ersetzen keinen Lauf gegen das reale Produkt.

`table-uia-delete-contract.ps1` führt den tatsächlichen UIA-Transaktionsablauf
gegen rein synthetische Provider- und Eingabegrenzen aus. Er prüft unter
anderem Nullbeträge, falsche oder mehrere entfernte Zeilen, veränderte
Restwerte, fehlendes Nachlesen, Eingabe-/Fokusverlust und genau einen
abgesicherten Undo. Eine ausbleibende beobachtete Wirkung bleibt ungewiss
und darf kein Undo oder Replay auslösen. Die eigentlichen Fokus-, Raw- und
Editorprüfungen erhalten zusätzliche Gegenfälle: aktiver Editor außerhalb
der abwärts enumerierten Kinder, fremde oder zusätzliche Editoren,
abweichender Wert, verborgene und Checkbox-Ziele, angeschnittene Zellen und
ein anderer tatsächlicher Punkttreffer. Der Raw-Leser wird außerdem mit mehr
als 2048 synthetischen Zellen geprüft. Die API-Verträge prüfen den echten
Executor ohne Qt-Backend und verwerfen unbewiesene Erfolgs-/Rollbackangaben.
Die vollständige reale Abnahme benötigt eigene Fallkopien und muss den
Restbestand, übrige Felder sowie Speichern und Wiederöffnen einbeziehen.
Weitere Gegenfälle ändern die Eingabe-Epoche während der letzten UIA-Prüfung
vor Klick, Löschen, Undo oder Escape. Danach darf kein Eingriff mehr erfolgen.
Die Tests führen auch die neue Editorphase nach einer Löschung im gesamten
Transaktionsablauf aus und verweigern falsche Modellunterschiede sowie
fehlende oder mehrdeutige Zellen. Die Budgetprüfung berücksichtigt die
gemessenen Lesezeiten vor der Mutation. Bei wiederhergestellten Werten
prüfen Worker und API zudem separat alle Dirty-Zustandsübergänge; eine nach
der eigenen Löschung verbleibende Markierung wird sichtbar gemeldet und
weder automatisch gelöscht noch gespeichert.

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
Zusätzliche Gegenfälle prüfen die Vorbereitung auf einem ausdrücklich
isolierten Desktop ohne sichtbare Eingabeepoche: Prozesswiederverwendung,
Eigentümer-, Peer-, Feld- und Rootänderungen sowie eine veränderte
Desktopbindung bleiben gesperrt. Eine lediglich gesetzte Desktopkennung ohne
positiven Windows-Nachweis reicht nicht; ein Verlust der Isolation nach dem
Close bleibt ein ungewisser Ausgang. Der passive Beobachter wird auch auf dem
isolierten Desktop vollständig geprüft. Fehlende Eingabe- oder Vordergrunddaten auf
dem sichtbaren Desktop bleiben Fehler. Der Dialogvertrag prüft außerdem,
dass bereits bekannte kleine Systemoverlays keine blockierenden Dialoge
werden; unbekannte oder zu große Fenster behalten ihre Schutzgrenzen.
`desktop-isolation-contract.ps1` prüft die echte Interop-Signatur und lehnt
fehlende, bereits zerstörte oder zu einem anderen Desktop gehörende eigene
Testfenster ab. Das Testfenster besitzt keine sichtbare Fläche. Ein positiver
Isolationsnachweis mit tatsächlichen Tabellenänderungen benötigt zusätzlich
den opt-in Lauf gegen einen eigenen Fall auf dem versteckten Desktop.
Der zusätzliche opt-in Gegenfall
`powershell.exe -NoLogo -NoProfile -File test/desktop-isolation-input-desktop.ps1`
verlangt einen lesbaren Eingabedesktop und prüft dort mit einem eigenen
unsichtbaren Testfenster: Gleiche Worker- und Fensterkennung bedeuten noch
keine Isolation. Er wechselt keinen Desktop und führt keine Eingabe aus.
Diese Voraussetzung gehört bewusst nicht zum portablen Offline-Gate;
fehlende Voraussetzungen führen beim ausdrücklichen Aufruf zum Fehler.
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

`bulk-action-interruption-contract.ps1` führt den tatsächlichen
Mehrfeld-Planexecutor mit synthetischen Kindgrenzen aus. Gewöhnliche
Vor-/Nachbedingungsfehler müssen eine weiterhin gebundene Rücknahme erlauben.
Erkannte Eingabe-/Fensterinterferenz, eine vom Kind verweigerte Rücknahme,
unbekannte Ausgänge und unlesbare oder neue Fehlerarten dürfen keine weitere
Schreiboperation auslösen. Der passive Abschlussreadback bleibt erforderlich.
Auch ein Fehler während der umgekehrten Rücknahmefolge muss deren weitere
Schritte beenden. Selbst wieder sichtbar gewordene ursprüngliche Werte heben
einen erkannten Kontextverlust nicht auf. Der Vertrag ist Teil des Voll- und
Schnellplans und startet kein Produkt und keine Eingabe.
Die tatsächliche Kindhülle und der tatsächliche Eingabevergleich prüfen zudem
Markenwechsel zwischen Vorwärts- und Rücknahmeschritten, innere Kindrücknahmen,
gültige Nullmarken, DWORD-Überlauf, unlesbare Marken und Kontextverlust beim
Abschlusslesen. Ein Kindfehler und eine Exception müssen den internen Kontext
zuverlässig freigeben. Die nativen Textverträge ergänzen die übernommene Marke
vor und während der Fokusübernahme; der tatsächliche Feldaufrufer wird bis zur
Commit-Grenze geprüft. Das Öffnen der Werte-Info reicht nur die gespeicherte
Marke seiner bestätigten eigenen Vorbereitung weiter und wiederholt eine
bereits begonnene oder ungewisse Aktion nicht.
Ein Fehler vor dem Klick und eine Interferenz nach dem Klick werden getrennt
geprüft, bis zum tatsächlichen Feldfehler-Resultat. Eine mögliche Öffnung bleibt
unbekannt und der bereits gesendete Klick wird nicht als ungesendet ausgegeben.
Ein eigener Invoke darf seinen unmittelbar erfassten Kandidaten erst nach
eindeutiger Fensterbestätigung und erhaltener Marke weitergeben. Die Fälle
trennen fehlende, verspätete und mehrdeutige Fenster, unlesbare Kandidaten,
Invoke-Fehler nach Aktionsbeginn und eine saubere Ablehnung vor Dispatch.
Ein gefangener terminaler Emit-Sentinel darf nicht überschrieben werden.
Der bestehende Invoke-Zugriff außerhalb des Plans und die Knopfbindung des
Klickwegs bleiben eigene Kontrollfälle.
`verified-point-failure-contract.ps1` führt die produktiven Cursorhelfer bei
verweigerter Positionierung, unlesbarer Position und Drift vor dem Dispatch aus.
Der Transaktionspfad
behält die Information, dass kein Klick gesendet wurde; der direkte Aufruf
behält seinen terminalen Fehlervertrag. Auch eine normal zurückkehrende
Fehlerroutine kann diese Schutzprüfung nicht aufheben.
In `value-info-window-contract.ps1` durchläuft die Vorbereitung auch die
tatsächliche Tracking-Hülle sowie Markenwechsel während Baumlesung und
Fokusvorbereitung, ausgetauschte Knöpfe und ungebundene vorhandene Fenster.
Er führt außerdem den tatsächlichen globalen Worker-Trap mit einem
synthetischen Fehler aus. Der Executor-Vertrag prüft dessen strukturierte
Antwort und eine abgewiesene Worker-Promise getrennt bis zu Ergebnisschema
und MCP-Fehlerhülle: unbekannter Ausgang, kein erfundener Readback und genau
ein Workeraufruf.

`tracked-rollback-display-contract.ps1` führt den tatsächlichen
`tracked_set_value`-Handler mit zustandsbehafteten, produktfreien
Providergrenzen aus. Er prüft leere und konstante Edit-Namen, unveränderte
Rohwerte, streng gleiche Namen, unbewiesene Commit-Methoden sowie fehlende
Nachher- und Rücknahme-Lesungen. Auch ein leerer Ausgangs-/Sollwert darf eine
fehlende Probe nicht als Erfolg erscheinen lassen. Ein gültiger
Vorwärtserfolg über den UIA-Namen bleibt erhalten, wenn dessen Rohwert eine
andere Darstellung liefert. Datumsantworten werden aus der tatsächlich
angeforderten Eingabe abgeleitet; eine Rücknahme mit leerem Raw und leerer
Anzeige bleibt ausdrücklich unbewiesen. Der Vertrag gehört zum Voll- und
Schnellplan und ersetzt keine reale Feld- oder Datumsabnahme. Abgewiesenes
Leeren darf bei unverändertem Rohwert keinen Erfolg melden; ein dritter
Rohwert bleibt vor einer Rücknahme erhalten. Textunterschiede allein in
Groß-/Kleinschreibung oder Leerzeichen dürfen nicht als Wiederherstellung
verschwinden. Edit-Beschriftungen und leere DataItem-Raw-Platzhalter werden
auch bei der Vorbedingung vom tatsächlichen Feldwert unterschieden.
Ein vorhandenes ValuePattern mit `null` als Wert zählt ebenfalls als fehlende
Probe; die Typumwandlung in einen leeren Text darf daraus keinen Erfolg machen.
Zusätzlich werden Formatvertrags-Schreibweisen, Datums-/Dezimalverwechslungen,
widersprechende ausdrücklich gelesene Jahre und passive Interferenzproben
mit fehlenden beziehungsweise alternativ dargestellten Werten geprüft.
Das schließt Jahreswidersprüche bei einer Vorgabe ohne Jahr und veraltete
DataItem-Namen im allgemeinen Feldzugriff ein: Die Störungsprobe muss einen
frischen Namen lesen, ohne eine weitere Eingabe auszulösen.
Die Handlerprüfung verlangt außerdem den unverändert weitergereichten
Formatvertrag für Vorwärts- und Rücknahmeeingaben, auch an der fokuslosen
Providergrenze. Widersprüchliche lesbare Zahlenwerte in Raw und Name dürfen
keine Währungsvorbedingung bestätigen; übereinstimmende Zahlenformate und
ausdrückliche Jahre bei einer Vorgabe ohne Jahr bleiben als Positivfälle erhalten.

`tracked-native-text-contract.ps1` lädt den tatsächlichen Zahlenvergleich statt
eines strengeren Testersatzes. Der echte Commit-Code muss Änderungen von
Text, Großschreibung, Leerzeichen, Satzzeichen und Zahlenwert sowie fehlende
Roh- oder Vorwerte vor der Texteingabe abweisen. Das gilt vor dem Fokus und
nach UIA- oder Klickfokus. Beim fokuslosen Ablauf wird zusätzlich nach der
Fokusvorbereitung vor `SetValue` geprüft. Der zustandsbehaftete Provider hält
echtes `null` von lesbarem leerem Text getrennt und simuliert erfolgreiche
sowie verweigerte Klickfokuswechsel. Positive Währungs- und Datumsformatierung
darf die Vorwertprüfung weiterhin passieren. Die tatsächlichen Beleg-Commit-
und Rücknahmeblöcke müssen ihren Formatvertrag ebenfalls weitergeben.
Für DataItems werden Raw, Name und fachliche Vorgabe gemeinsam bis zur letzten
Vorwertprüfung gebunden. Eigene Auswahl- und Tabellenprovider führen den
fokuslosen DataItem-Pfad vollständig aus, sowohl mit exakt fokussierter Zelle
als auch mit ausgewählter Zelle in einer fokussierten Tabelle. Änderungen nach
Auswahl, UIA-Fokus oder Klick, widersprüchliche Jahre, fehlender Rohwert und
nachträglicher Schreibschutz dürfen keine Werteingabe auslösen. Positive
Währungsformatierung, leere Datums-/Währungsfelder und Nullbeträge bleiben
prüfbar; leer und null Euro sind dabei keine austauschbaren Vorwerte. Ein
Währungssuffix im Namen verdeckt keinen lesbaren numerischen Rohwert.
Nicht bestätigte Auswahl und fehlender Tabellenfokus stoppen ebenfalls vor
`SetValue`. Der Handlervertrag prüft vollständige Namen unabhängig von einer
vereinheitlichten Baumdarstellung und verweigert `null` bei Vorher-, Nachher-
oder Rücknahmenamen. Ein leerer oder unlesbarer DataItem-Rohwert darf bei der
Rücknahme keine Platzhaltereingabe anstelle des bestätigten ursprünglichen
Anzeigenamens erzeugen. Der
Rohwertnachweis bleibt auch dann streng, wenn die Anzeige bereits wieder stimmt.
Der tatsächliche Beleg-Schreib- und Rücknahmekontrollfluss hält die typisierte
USt-Auswahl vom Texttransport getrennt.
Datumstests verschieben ein ausdrücklich sichtbares Jahr zwischen Raw und Name,
während die fachliche Vorgabe kein Jahr nennt. Alle ausdrücklich erfassten und
frisch gelesenen Jahre müssen gemeinsam übereinstimmen. Eine erstmals sichtbare
einzelne Jahresangabe ohne frühere Jahresbindung bleibt ein eigener Positivfall.
Die passive Störungsprobe darf bei fehlendem Namen keinen unveränderten
Leerwert erfinden. Ein Edit-Vorwertobjekt ohne optionalen Namen wird außerdem
unter PowerShell-StrictMode geprüft.
An den Ein- und Austrittsgrenzen des tatsächlichen Texthelfers wird außerdem
jeweils eine einzelne fremde Eingabemarke simuliert, ohne eigene Eingabe
hinzuzufügen. Der Commit muss vor dem ersten Textblock beziehungsweise vor
TAB stoppen und den tatsächlichen Änderungsbeginn melden. Eine lesbare
Nullmarke nach einem DWORD-Überlauf bleibt als positiver Gegenfall gültig.
Dabei wird der tatsächliche Markervergleich geladen; eine fremde Marke darf
auch nicht als eigene Marke in der Vordergrundbindung gespeichert werden.
Ein zusätzlicher Gegenfall mit gepufferten Unicode-Blöcken verlangt die
letzte eigene Blockmarke und verhindert TAB nach der erkannten Störung.
`tracked-native-text-contract.ps1` führt außerdem die tatsächlichen Commit-
und Diagnosefunktionen mit frisch gelesenen Vor-TAB-Werten und veränderten
Nachwerten aus. Westliche Zeichen, BMP-/Surrogat-Ersetzung, vorhandene
Fragezeichen, andere Längen oder Suffixe, ASCII-Abweichungen sowie unlesbare
oder fehlende Vor-TAB-Nachweise werden getrennt geprüft. ASCII- und DataItem-
Gegenfälle bestätigen, dass sie die zusätzliche Lesung auslassen.
Ein echter CLR-Nullwert nach TAB
darf nicht als bestätigter Leerwert erscheinen; Fremdeingabe während der
Diagnoselesung verhindert TAB. `tracked-rollback-display-contract.ps1` führt
das echte Feldkommando mit diesem Diagnosehinweis aus: Ein abweichender
Drittwert erlaubt weiterhin keine Rücknahme und bleibt abgleichpflichtig.
Die tatsächlichen BelegManager-Reader werden zusätzlich im PowerShell-Vertrag
und in `qt-native-receipt-update.mjs` geprüft: unbekannte Rohwerte, echte
Leerwerte, gültige und ungültige USt-Darstellungen sowie typisierte und
unbestimmte Checkboxzustände. Ein gemeinsamer synthetischer Prüfvektor bindet
den unveränderten Fingerprint lesbarer Werte beider Backends. Die native
Update-Komposition muss bei einem unlesbaren Nachbarfeld auch mit leerer
beziehungsweise Nullsatz-Vorgabe vor jeder fachlichen Änderung stoppen.
Lesbare schreibgeschützte Felder bleiben für No-op- und Nachwertnachweise
verwendbar. Unbestätigte Details bleiben abgleichpflichtig und erlauben keinen
automatischen Schließschritt.
Bereits geöffnete unlesbare Details erlauben auch keine Zeilenaktivierung;
die Komposition prüft das mit und ohne sichtbaren Schließknopf.
Die tatsächlichen USt-Clear-Helfer und ihre
Ergebnisübergabe werden zusätzlich mit ausgeführter Eingabe, verweigerter
Eingabe und unlesbarem Nachwert geprüft; ein Nullwert bestätigt keinen Nullsatz
und löscht keinen bereits begonnenen Eingriff aus dem Ergebnis.
`receipt-vat-precondition-contract.ps1` führt den tatsächlichen USt-Helfer
mit seinen produktiven Wertvergleichen und der Live-Warteschleife aus:
falscher No-op bei veraltetem oder unbekanntem Wert, ersetzte Feldbindung
vor dem Eingriff und beim Rücklesen,
lesbarer leerer Nullsatz und genau ein Clear mit geprüftem Rohwert. Native
Lesefehler bleiben Fehler; der tatsächliche interne `Emit`-Sentinel samt
erfasstem Ergebnis muss unverändert weitergereicht werden.
Diese Fälle prüfen den produktiven Kontrollfluss an Testgrenzen; sie belegen
keine Zustellung echter Betriebssystemeingaben.
Alle dabei verwendeten Fenster-, Eingabe- und Nachrichtenmethoden sind
produktfreie Testgrenzen; diese Regressionen ersetzen keine reale Abnahme.

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
Speichern und Wiederöffnen. Falscher Dateihash, fehlendes Backup, ein anderer
Fall, doppelte Namen und abweichende erwartete Nettobeträge müssen vor einer
weiteren Anlage abgewiesen werden. Dabei bleiben Inventar und Dateien
unverändert. Sie benötigt eine freie sichtbare Windows-Sitzung.
Der Lauf verwendet die gewählte Backend-Konfiguration und überspringt keine
Schritte; seine Einzelbelege ersetzen keine umfassende Paketabnahme.

`npm run test:live-tax-knowledge` prüft `tax_knowledge_search` über API und MCP.
Vorher müssen `SSE_KNOWLEDGE_SOURCE_FILE` auf eine kompatible Hersteller-
Musterdatei (`.ESt2025`) und `SSE_CASE_DIR` auf einen neuen Testordner außerhalb
des Repositorys gesetzt sein. Alle SSE-/Steuerwissen-Fenster müssen geschlossen
und die sichtbare Windows-Sitzung frei sein. Der Test kopiert die Musterdatei,
prüft Treffer, wiederholte Suchbegriffe, bestätigte und wiederholte Nulltreffer,
den Wechsel zurück zu Treffern sowie eine falsche Fensterbindung und
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

Der produktfreie Lasttest prüft auch einen frühen Testfehler zusammen mit einem
Fehler beim Schließen der eigenen API oder des MCP-Prozesses. Im Fehlerabschluss wird ein
fehlgeschlagenes Schließen einmal erneut versucht. Scheitern beide Versuche,
führt der Abschluss die bestehende Freigabe der eigenen API oder des Transports direkt aus.
Die Prüfungen der Prozessidentität und bestätigten Ruhephasen bleiben bestehen;
`apiForcedRelease` und `mcpForcedRelease` kennzeichnen diese zusätzliche Freigabe
getrennt. Eigene Prozessregressionen prüfen auch das natürliche Ende des äußeren Prüfers.
Fehlerberichte behalten in `primaryFailureStage` und `primaryErrorName` die
ursprüngliche Fehlerstelle und Fehlerklasse. `cleanupFailureStages` hält die
Bereinigungsfehler einschließlich Wiederholungsfehlern und Fehlern beim Anlegen
des Fehlerindexes fest. Ein Fehler im abschließenden Erfolgsindex
(`artifact-index`) ist selbst die ursprüngliche Fehlerstelle und erscheint
deshalb nicht zusätzlich unter `cleanupFailureStages`.
Ist die Bereinigung selbst der erste Fehler, steht ihre Stelle auch als
ursprüngliche Fehlerstelle im Bericht. Das bisherige `failureStage` behält bei
einem gescheiterten Schließversuch samt Wiederholung die gemeinsame
Bereinigungsphase. Eine erfolgreiche Bereinigung macht den fehlgeschlagenen
Test nicht erfolgreich. Auch ein gescheiterter Abschlussbericht erhält die
ursprüngliche Ursache in der geworfenen Fehlerkette. Ein selbst angelegter,
unvollständiger Fehlerindex wird nur nach erneuter Verzeichnis- und Dateibindung
entfernt; eine bereits vor dem Schreibversuch vorhandene Datei bleibt erhalten.
Derselbe Dateischutz gilt für den Erfolgsindex. Auch ein Fehler beim Schließen
des Index-Dateihandles darf einen vorherigen Schreibfehler nicht verdecken.

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

Anschließend folgt eine zweite Folge mit Bezeichnung und Betrag:
Add → passives Lesen → Update → passives Lesen → Delete. Sie prüft den
natürlichen Fokuszustand nach einer Texteingabe, der auch auf der eingebetteten
Hilfe liegen kann. Kein zusätzlicher Fokusaufruf bereitet das Update vor.
Nach dem Löschen muss der vollständige vorherige Tabellenbestand wieder
übereinstimmen. Der native Schreibpfad darf den Fokus nur von der exakt
profilierten, nicht editierbaren Hilfe mit geprüfter Qt-Provider-Version auf
den gebundenen Weiter-Button setzen. Dabei wird der Button nicht ausgelöst.
Fremde oder veränderte Dokumente erhalten diese Berechtigung nicht. Eine
fehlgeschlagene Help-Prüfung beendet den Versuch vor jeder Fokusaktion; sie
wird nicht als allgemeine native Fokusquelle weitergereicht.

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
