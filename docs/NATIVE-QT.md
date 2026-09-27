# Optionaler Qt-Pfad

Die API kann `get_value`, `table_read`, `snapshot`, `find`, `read_page`,
`subpages`, `known_page_state`, `positions`, `ustva_read`,
`receipt_manager_list`, `receipt_manager_read`, `receipt_manager_action`,
`page`, `ui_state`, `help`, `read_table` und `checker_results`
über eine dauerhaft gebundene Qt-Verbindung ausführen. Der normale Runtime-Start aktiviert diesen Pfad nur,
wenn die Konfigurationsdatei `qtNativeRuntime` enthält. Dafür wird ein separates,
kompatibles natives Paket benötigt; die npm-Pakete enthalten diesen Qt-Helfer
noch nicht. Dasselbe Paket führt `desktop_status` und `desktop_start` direkt über Win32 aus;
`desktop_stop` verwendet einen externen C++-Helfer mit Win32 und COM-UIA.
Die übrigen Operationen behalten ihre bestehenden Ausführungspfade.

Nach einem erfolgreichen Prozess- oder Fallwechsel verwirft die Runtime die
betroffene native Bindung. `close` berücksichtigt die beendete PID; `save_as`
invalidiert die adressierte Fallbindung. Fehlt eine sichere Zielidentität,
werden die nicht mehr belegbaren Bindungen verworfen. Ein verifiziertes
`window_close`, das ausschließlich ein bekanntes Nebenfenster entfernt, erhält
dagegen die gesunde Hauptfensterverbindung. Fehler und unbekannte Ausgänge
erlauben keine automatische Neuverbindung oder Wiederholung.

Die [Native-Abdeckungsmatrix](NATIVE-COVERAGE.md) zählt alle 102 API-Operationen:
siebzehn direkte optionale Qt-Handler und 85 ohne direkten Qt-Pfad. Sie trennt
diesen Stand von funktionaler Live-Abdeckung und noch erforderlicher Integration.
`sse-native.dll` bezeichnet dagegen die bestehende C#-Worker-Hilfsbibliothek;
der hier beschriebene C++-Lesepfad verwendet `sse-qt-read.dll` in SSE.

`desktop_status` liefert `backend: "win32"`. Der gebundene Loader liest Prozessversion
und sichtbare Fenster ausschließlich für die markierte PID auf dem ausdrücklich
geöffneten Desktop. Er injiziert keine DLL, benötigt keinen UIA-Worker und verwendet
keinen Desktopwechsel. Der Marker wird vor und nach der Abfrage gelesen; geändertes
Eigentum, nicht lesbare Identität, Controller-Konflikte und ungültige Ergebnisse
scheitern ausdrücklich. Ohne Marker wird der inaktive Zustand direkt in Node
ermittelt. Alte Marker und Center-Testmarker bleiben diagnostizierbar. Der Status
belegt keinen gespeicherten Fall und ersetzt keine vollständige Startbereitschaft.

`desktop_start` verwendet ebenfalls `backend: "win32"`: Ressourcenreferenzen,
Programmpfad, Produkt-Pin, Startmodus und Falljahr werden vor dem Prozessstart geprüft.
Ein vorhandener Desktop wird nicht übernommen. Ein toter Marker darf nur entfernt
werden, wenn sein Desktop keine sichtbaren Fenster mehr enthält; fremde, lebende
und unklare Marker scheitern ausdrücklich. Der Controller-Lease umfasst den Start.

Der Prozess wird unter Windows 10 oder neuer atomar einem Job Object zugeordnet,
zunächst angehalten erstellt und erst danach fortgesetzt. Bis zum exklusiv
geschriebenen und zurückgelesenen Eigentumsmarker beendet ein Absturz des Helfers
seinen Prozessbaum. Danach bleibt die Instanz für weitere API-Aufrufe verfügbar.
Timeouts prüfen Prozessende und Markerabbau; ein unvollständiger Abschluss liefert
die Cleanup-Felder. Ein verlorener oder abgebrochener Antwortweg kann
`outcomeUnknown: true` liefern und wird nie automatisch wiederholt.
Vor einem weiteren Start ist dann `desktop_status` zu prüfen.

`ready` bezeichnet wie bisher ein eindeutig erkanntes Hauptfenster; Startdialoge
werden separat zurückgegeben. Das ist keine Zusage, dass der komplette Fall bereits
geladen ist. Der Messweg trennt Helferstart, SSE-Ladezeit und Antwortabschluss.
Die native Startintegration ist durch synthetische Prozess-/Desktop- und öffentliche
HTTP-Tests geprüft. Eine zusätzliche Serie mit einer Hersteller-Musterfallkopie
prüft Start, frischen Qt-Seiten-Readback und normales Beenden in jedem Zyklus.
Das belegt noch nicht alle Startmodi oder Dialogzustände.

`desktop_stop` liefert `backend: "win32-uia"`. Der Helfer bindet seinen Thread an
den markierten Desktop, prüft das gepinnte Programm und hält Prozessobjekt,
Eigentumsmarker und Controller-Lease bis zum bestätigten Ende. Er fragt den exakten
Speichern-Button ab und stellt `WM_CLOSE` einmal in die Nachrichtenwarteschlange.
Ein normaler erfolgreicher Stop benötigt keine festen Nachlaufpausen.

`save: true` bleibt gesperrt; Speichern erfolgt vorher über die hashgebundene
Speicheroperation. Unsichere oder ungespeicherte Zustände benötigen eine ausdrückliche
Entscheidung. Nur `discardChanges: true` erlaubt einen eindeutigen aktiven Button
`Nein`, `Nicht speichern` oder `Verwerfen` und gegebenenfalls das Beenden des exakt
gehaltenen Prozesses. Vorhandene unbekannte Fenster müssen separat behandelt werden.
Dialoge mit Übermittlungsbezug, unvollständige Bäume, fehlende Invoke-Muster und
veränderte Inhalte scheitern ausdrücklich; es gibt keinen Maus- oder Worker-Fallback.

COM-Verbindungs- und Transaktionsaufrufe sowie Baumgröße, Tiefe und Gesamtdauer sind
begrenzt. API und Helfer verwenden einen gemeinsamen absoluten Deadline-Wert;
Start, Hashprüfung und Hilfsfenster verbrauchen dasselbe Budget. Vor jeder Änderung
muss genug Zeit für die anschließende Prozessbeobachtung verbleiben.
Vor dem Invoke werden der vollständige Baum, die Fensteridentität und die
gewählte Schaltfläche erneut geprüft. Die erneute Inventarprüfung vergleicht
dieselben relevanten Fenster wie die Auswahl; bereits ausgeschlossene kleine
Systemindikatoren und Schattenfenster verändern diese Menge nicht. Neue echte
Dialoge oder veränderte relevante Fenster blockieren weiterhin jede Änderung. Ein verlorener Antwortweg oder ein unterbrochener
Invoke wird nicht wiederholt. `outcomeUnknown` verlangt eine frische Statusprüfung.
Der API-Timeout muss das Budget für Providerprüfung und bestätigtes Prozessende
enthalten; ein kurzer durchschnittlicher Aufruf ist keine garantierte Höchstdauer.

Die Stop-Tests verwenden ein separates Qt-Programm auf einem nicht aktiven Desktop.
Sie prüfen normale und erzwungene Ausgänge, Dirty-State, Dialogantworten, doppelte
Schaltflächen, Übermittlungssperren und Lesegrenzen. Eine zusätzliche Serie mit einer
unveränderten Herstellerfallkopie prüft drei öffentliche HTTP-Zyklen mit frischem
Qt-Seiten-Readback, normalem Prozessende und Markerabbau. Die Prüfung tatsächlicher
SSE-Speicherdialoge und Hilfsfenster ist eine eigene Live-Abnahme.

`snapshot` liest den Qt-Accessibility-Baum im GUI-Thread. Es liefert die bestehenden
Knotenfelder und UIA-kompatible `rid`-Referenzen, auch an nativen Kindfenstergrenzen.
`get_value` kann diese Referenzen durch einen frischen nativen Baum auflösen;
die bisherigen `qt:`-Referenzen bleiben ebenfalls gültig. `types` und `namedOnly`
filtern nach dem begrenzten Baumlauf, ohne Knoten- oder Elternindizes umzunummerieren.
Katalogisierte nichtmodale `toolWindow`-Ziele werden innerhalb derselben gebundenen
PID anhand ihres exakten Titels gelesen; fehlende und mehrdeutige Fenster scheitern.

Die Wurzel wird wie beim Worker nicht ausgegeben. Vorgabe sind 4000 Knoten,
Maximum 5000 und Tiefe 16; `stats.truncated` meldet eine überschrittene Grenze.
Zeit-, Zyklus-, Text- und Ausgabebegrenzungen scheitern ausdrücklich. Passwortwerte
bleiben verborgen. `stats.source: "qt"` und `responsivenessCheck: "bounded-gui-thread"`
kennzeichnen den neuen Messweg; `canaryMs` ist `null`, da kein UIA-Kanarienaufruf
stattfindet. Ein über die Snapshot-ID gelesener Wert benötigt einen vollständigen Baum.
Der Umfang ist Qt-Inhalt, kein allgemeiner Ersatz für native Windows-Dialoge oder
nicht von Qt bereitgestellte Fensterdekoration.

`find`, `read_page` und `subpages` verwenden denselben frischen Qt-Baum ohne
PowerShell-Prozess. `find` liest keine Feldwerte; Namens-/Typvergleich und
AutomationId-Endungen behalten die Suchsemantik des Workers einschließlich
Wildcard-Zeichen und Backtick-Escapes. Exakte Vergleiche laufen über die
invariante Windows-Zeichenfolgenordnung; die Wildcard-Auswertung ist begrenzt
und scheitert bei überschrittenem Budget ausdrücklich.

`read_page` behält Inhaltsgrenzen, den kataloggebundenen Überschriftencontainer
und die gegen den Zeilenanker berechnete Textgruppierung. `subpages` bindet
Beschriftung und Wert über direkte Geschwister, filtert Übermittlungsaktionen
und entfernt doppelt exponierte Verweise. Ein abgeschnittener Unterseitenbaum
scheitert mit `native-incomplete`; `find` meldet wie bisher `incomplete` und
`stats.truncated`. `positions` liest die sichtbaren, eindeutig formatierten
`»…« bearbeiten`-Verweise als read-only-Projektion; Anlegen und Löschen bleiben
gesperrt. `ustva_read` projiziert einen einzelnen gebundenen GUI-Thread-Snapshot
in dasselbe fachliche UStVA-Modell wie der bisherige Worker-Pfad. Ein modaler
Dialog oder ein abgeschnittener Baum bricht die Lesung fail-closed ab; die
Übermittlung bleibt gesperrt. Die übrigen Seiten- und UStVA-Operationen, etwa
`page`, `read_full` und die UStVA-Schreibwege, benutzen weiterhin ihre bestehenden
Pfade. `receipt_manager_list` liest das katalogisierte nichtmodale BelegManager-
Fenster und den Dirty-State des gebundenen Hauptfensters direkt aus zwei
begrenzten Qt-Snapshots. Runtime-IDs und Fingerprints bleiben mit den bestehenden
quittierten Belegmutationen kompatibel; eine nicht vollständig exponierte Liste
wird als unvollständig markiert und nicht als sichere Mutationsgrundlage ausgegeben.

`page`, `help`, `read_table` und `checker_results` projizieren jeweils einen
frischen, gebundenen GUI-Thread-Snapshot in genau die Ergebnisform des bisherigen
Worker-Zweigs: Beschriftungen, Felder, sichtbare Tabellenzeilen, Aktionen mit
Übermittlungssperre, Hilfeabschnitte, Kopfspalten mit typisierten Zellzuständen
und die gruppierte Prüferliste. Fremde Fensterteilbäume werden wie bisher als
`ausgeschlosseneFenster` ausgewiesen. Ein modaler Dialog bricht `page`, `help`,
`read_table` und `checker_results` fail-closed mit `dialog-open` ab, weil der
Qt-Pfad fremde Dialoge nicht beschreibt; `page` prüft davor das Win32-Fensterinventar
des gebundenen Prozesses und scheitert ebenso mit `dialog-open`, sobald ein
Fenster offen ist, das weder Werte-Info, Steuer-Spar-Tipps, ein Systemoverlay
noch ein katalogisiertes nichtmodales Werkzeugfenster mit exakt gleichem Titel
ist, oder ein namenloses Fenster sichtbar ist, das weder Schatten- noch
Tooltip-Fenster ist; ein
minimiertes Hauptfenster scheitert mit `minimized`, ein zweites Fallfenster
desselben Prozesses wird wie beim Worker geduldet. `help` prüft das Inventar
genauso und liest offene katalogisierte Nebenfenster wie die Steuer-Spar-Tipps
über ihren Titel mit, weil der Worker-Baum sie unter dem Hauptfenster enthält. `page`, `help` und `checker_results`
scheitern zusätzlich bei abgeschnittenem Baum mit `native-incomplete`, wobei
die Meldung benennt, ob die Knotengrenze oder die Tiefengrenze von 16 Ebenen
erreicht wurde; `read_table` meldet wie der Worker `incomplete`. `checker_results`
prüft vorher nur, ob das gebundene Hauptfenster noch besteht und nicht
minimiert ist, weil der Worker es vor dem Lesen wiederherstellt; weitere
Fenster lässt es wie der Worker unbeachtet. Unsichtbare
Teilbäume lässt die Bridge aus, genau wie Qt sie der UIA-Steuerungsansicht
vorenthält; beide Pfade sehen von einer Liste deshalb nur die Zeilen im
Sichtbereich, und `konsistent` vergleicht auf beiden Pfaden dieselben Zeilen
mit der angekündigten Anzahl. `page` zählt in `offeneFenster` wie
`Get-Windows` beim Worker jedes sichtbare Fenster aller Prozesse, deren
Programmdatei und Installationsordner denselben Namen tragen, auch namenlose
und Schattenfenster; gelistet, klassifiziert und
gelesen werden nur Fenster des gebundenen Prozesses. `dialoge` bleibt dort
immer leer, weil ein unbekanntes Fenster die Lesung bereits beendet hat. `page`, `help` und `checker_results`
lesen bis zu 5000 statt 4000 Knoten, damit eine große Seite vollständig statt
abgeschnitten gelesen wird, und ein leerer Baum gilt wie beim Worker als
fehlgeschlagene Lesung; `read_table` behält die Grenze von 4000 Knoten und
meldet Abschneidung, scheitert bei leerem Baum aber ebenso mit
`native-incomplete`.
Besessene Nebenfenster hängen im Qt-Accessibility-Baum nicht unter dem
Hauptfenster; `page` und `read_table` lesen offene katalogisierte Nebenfenster
deshalb über ihren Titel und führen sie mit Fensterkennung, Name, AutomationId,
Geometrie und Knotenzahl unter `ausgeschlosseneFenster`; Name und AutomationId
der Fensterwurzel meldet der Snapshot des Nebenfensters selbst. `read_table` prüft das Fensterinventar wie
`page` und scheitert bei nicht katalogisierten Fenstern mit `dialog-open`.
Ein Nebenfenster, das selbst modal blockiert oder deaktiviert ist, beendet
die Lesung mit `dialog-open`, ein Nebenfenster über der Lesegrenze mit
`native-incomplete`; ein Systemoverlay und ein zweites Fallfenster werden nur
gezählt, nie gelesen.

`ui_state` liest Hauptfensterbaum und Win32-Fensterinventar des gebundenen
Prozesses direkt; eine geöffnete Werte-Info wird unabhängig von ihrer Größe
über ihren exakten Titel als zweiter Snapshot gelesen und in dasselbe
`ergebnis`-Modell projiziert. Das Inventar belegt dabei das Fenster: Ein Baum
ohne die Wertetabelle meldet die Werte-Info als offen, aber nicht lesbar, nie
als geschlossen. Ein leerer Hauptfensterbaum scheitert wie bei den anderen
Lesungen mit `native-incomplete`.
Dialoge, unbekannte oder namenlose Fenster werden nicht beschrieben, sondern
mit ihrer Fensterkennung als `nicht-lesbar` unter `unsichereFenster` geführt;
katalogisierte nichtmodale Werkzeugfenster wie der BelegManager gelten wie beim
Worker als `unbekannt`. Der Zustand gilt dann als blockiert, und
`sse_dialog_list` bleibt der Weg zum fingerprintgebundenen Dialog. Die
Fensterliste ist wie beim Worker nach Fläche absteigend und bei gleicher
Fläche in Aufzählungsreihenfolge geordnet, und
`fensterAnzahl` zählt jedes sichtbare Fenster des Prozesses; nur Fenster mit
einer Schattenklasse fehlen wie beim Worker in der Liste. Ein minimiertes Hauptfenster stellt dieser Lesepfad nicht wieder her,
sondern scheitert mit `minimized`; zwei gleichzeitig offene Werte-Info-Fenster
scheitern mit `ambiguous`. Der `stateFingerprint` verwendet dieselbe
Feldreihenfolge und dieselben JSON-Bytes wie der Worker, damit
`previousFingerprint` backendübergreifend vergleichbar bleibt, solange kein
fremdes Fenster offen ist; `dialoge` bleibt auf diesem Pfad immer leer.

## Interne Laufzeitmessung

Der kanonische Mega-Lauf erzeugt zusätzlich einen create-only JSONL-Sidecar
außerhalb des Repositorys. Jede ausgeführte API-Operation wird über ihre echte
HTTP-`requestId`, den Operationsnamen und die Serverdauer mit dem Bericht
verbunden. Die öffentlichen API-Antworten und Argumentschemata bleiben unverändert.

Die Traces enthalten nur katalogisierte Operationsnamen, numerische Zeiten,
Backend-/Phasennamen, Elternbeziehungen und explizit zugelassene Zähler.
Argumente, Feldwerte, Fehlermeldungen, Fenstertitel und Dateipfade werden nicht
übernommen. Erfasst werden API-Orchestrierung, Workeraufrufe, instrumentierte
lokale Arbeit, Qt-/Win32-Aufrufe sowie erstmalige Suche und Bindung.
Nicht vorhandene Phasen oder Zähler sind **nicht gemessen**, nicht null.
Die Zeiten sind inklusiv: Eltern enthalten ihre Kinder; verschachtelte
Spans dürfen nicht als exklusive Gesamtzeit addiert werden.
`worker-queue` misst die tatsächliche Wartezeit bis zur Übergabe oder zum Abbruch.
Die Zuordnung bleibt auch beim Start aus der Fortsetzung eines anderen Aufrufs
an den ursprünglichen Trace gebunden. `worker-prepare` misst ausschließlich die
synchrone Node-Vorbereitung: Marker, Argumentdatei, Prozessstart beziehungsweise
Übergabe an einen Reservearbeiter. PowerShell-Parsing, dessen Initialisierung
und UI-Ausführung sind darin nicht enthalten.

Unvollständige Traces, Pufferverluste, widersprüchliche Zuordnungen und
Schreibfehler lassen die Benchmark-Verifikation scheitern, ohne eine
ausgeführte Steueroperation zu wiederholen. Die Erfassung ist eine interne
Testabhängigkeit und im regulären API-Start nicht aktiviert.

## Natives Paket selbst bauen

Die C++-Quellen und der Paketbau liegen unter [native/qt](../native/qt/CMakeLists.txt).
Voraussetzungen sind Windows x64, MSVC, CMake ab 3.24, Node.js und das Qt-6.9.2-SDK
für MSVC x64 einschließlich privater Gui-Header. Der normale npm-Build benötigt dieses zusätzliche SDK nicht.
In einem x64-Entwicklerterminal von Visual Studio aus dem Projektverzeichnis:

```powershell
npm run build
cmake -S native/qt -B artifacts/qt-native -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="C:\Qt\6.9.2\msvc2022_64" -DSSE_QT_BUILD_TESTS=ON
cmake --build artifacts/qt-native --config Release
npm run test:qt-native
```

Passe den Qt-SDK-Pfad an die eigene Installation an. Der Build verlangt exakt
Qt 6.9.2 und die Release-Konfiguration. Er lädt keine Abhängigkeiten herunter.
Die verwendeten Drittanbieterquellen und Hinweise stehen in
[THIRD_PARTY.md](../native/qt/THIRD_PARTY.md).

Nach erfolgreichem Build enthält `artifacts/qt-native/native-package.json` das
fertige `qtNativeRuntime`-Objekt für die API-Konfiguration. Das zugehörige
Verzeichnis unter `artifacts/qt-native/packages/` enthält Loader, DLL, Manifest
und Lizenzhinweise. Sein Name ist der Manifest-Hash. Gleiche Binärdateien
verwenden dasselbe geprüfte Verzeichnis; veränderte Builds erzeugen ein neues.
Beim Verschieben des vollständigen Pakets muss nur `directory` angepasst werden.

Der Paketbau bindet beide Binärdateien an die aktuelle Quellenidentität und
prüft PE-Format, x64-Architektur sowie die Übereinstimmung des nativen Profils
mit dem öffentlichen Produktprofil. Zur Laufzeit prüft der Loader zusätzlich
die Produkt- und Qt-Binärdateien gegen `native/qt/compatibility.json`.
Die privaten Accessibility-/DPI-Schnittstellen binden zusätzlich `Qt6Gui.dll`
an den hinterlegten Hash; eine abweichende Qt-Binärdatei wird vor dem Laden abgelehnt.

Der explizite CTest-Lauf erstellt eine eigene, nicht aktive Windows-Arbeitsfläche
und startet dort synthetische Qt-Fenster. Er verwendet das gebaute Paket und den
regulären API-Prozess, mit einer ausdrücklich synthetischen Testabhängigkeit für
die Profilauswahl. Das Fensterinventar wird tatsächlich über Win32 gelesen.
Geprüft werden frische HTTP-Lesewerte,
Tabellen, Fenster-/Objektlebensdauer, Passwortfelder und Helfer-Shutdown. Das ist
kein Funktionsnachweis an einer installierten SSE. Die ausgelieferte DLL führt
keine experimentellen Feld-, Tabellen-, Navigations- oder Speichermutationen aus.

## Konfiguration und Paketvertrag

`qtNativeRuntime` hat genau zwei Felder: `directory` ist ein absoluter lokaler
Windows-Verzeichnispfad, `manifestSha256` der SHA256-Hash der exakten Bytes von
`manifest.json` in diesem Verzeichnis, als 64 kleine Hexadezimalzeichen. Das
Profil muss unterstützt sein, vollen Operationszugriff besitzen und eine
`nativeQtVersion` festlegen. `sseExecutable` bestimmt die Produktinstallation;
ohne diese Angabe muss genau eine Standardinstallation erkannt werden.

Das Manifest hat folgende Struktur; die Platzhalter sind durch tatsächliche
Werte des kompatiblen Pakets zu ersetzen:

```json
{
  "schemaVersion": 1,
  "startupAbi": 2,
  "bridgeProtocol": 1,
  "discoveryProtocol": 1,
  "buildIdentity": "SSE_NATIVE_BRIDGE_V2:<64 kleine Hexadezimalzeichen>",
  "profile": {
    "id": "2025",
    "taxYear": 2025,
    "engineFileMajor": 31,
    "verifiedBuild": "31.0.2.0",
    "qtVersion": "6.9.2"
  },
  "loader": { "file": "bridge-load.exe", "sha256": "<SHA256 des Helfers>" },
  "bridge": { "file": "sse-qt-read.dll", "sha256": "<SHA256 der DLL>" }
}
```

Der API-Start prüft Manifest-Pin, Schema, Profilzuordnung und beide Binärdateien,
bevor ein Helfer gestartet werden kann. Zusätzliche Felder, abweichende
Dateinamen und symbolische Dateiverknüpfungen werden abgelehnt. Manifest und
Binärdateien werden begrenzt gelesen. Diese Integritätsprüfung ersetzt keine
Signaturprüfung und ist keine Sicherheitsgrenze gegen Änderungen durch
denselben Windows-Benutzer. Verzeichnis und Manifest-Pin fließen in den
Konfigurationsfingerprint ein; es gibt keine zusätzliche Umgebungsvariable zum
Aktivieren dieses Pfades.

## Bindung, Fehler und Laufzeit

Beim ersten nativen Leseaufruf liest Node den bestehenden Desktop-Marker mit
demselben strengen Parser wie der Worker. Ein beschädigter oder fremder Marker
führt zum Abbruch. Ein eigener, rein lesender Win32-Helfer findet auf dieser
Arbeitsfläche das Hauptfenster der konfigurierten Installation und bestätigt
Produkt-, Prozess-, HWND- und Erstellungszeit-Identität. Ein markierter Prozess
muss zur Auswahl passen. Ohne explizites `hwnd` muss die Auswahl eindeutig sein;
ein Markerwechsel während der Erkennung verhindert die Anbindung.

Diese Erkennung startet keine PowerShell und lädt noch keine DLL in das Ziel.
Danach startet die API den dauerhaften Helfer mit der bereits geprüften
Prozess-/Fensterbindung. Er bestätigt Produkt-, DLL- und Pipe-Server-Identität
erneut. Die API prüft außerdem den Sitzungsbesitzer. Erkennung, Anbindung und
Lesezugriff teilen die Frist des API-Aufrufs. `discoveryProtocol: 1` ist im
nativen Manifest erforderlich; ältere Pakete ohne diesen Vertrag müssen mit
den aktuellen Quellen neu gebaut und mit dem neuen Manifest-Pin konfiguriert
werden. Es gibt keinen Wechsel zurück zu einer PowerShell-Erkennung.

Weitere Leseaufrufe verwenden dieselbe Verbindung. Sie prüfen den aktuellen
nativen Hauptfensterkontext und lesen frische Qt-Werte oder einen begrenzten
Modellschnappschuss. Werte werden nicht zwischen Aufrufen gespeichert.
Ein zweites Hauptfenster derselben Installation verlangt ein explizites
`hwnd`; ein nicht mehr gültiges gebundenes Fenster wird abgelehnt. Bis zu vier
Prozesse können gebunden sein, jeweils mit einem Hauptfenster. Die erstmalige
Erkennung bleibt teurer als ein Aufruf über eine bestehende Verbindung.

Erfolgreiche Worker-Operationen `launch`, `window_close`, `desktop_start` und
`desktop_stop` verwerfen bestehende Bindungen und verhindern, dass eine ältere
laufende Anbindung danach veröffentlicht wird. API-Shutdown schließt eigene
Helfer. Ein Transportfehler löst weder einen automatischen Neustart noch eine
Wiederholung oder einen Wechsel zum Worker aus. Ein späterer expliziter
Lifecycle-Aufruf oder API-Neustart kann die fehlerhafte Bindung aufheben.

Dieser Pfad erweitert keine Schreib- oder Belegfreigaben. Native Ergebnisse
kennzeichnet `backend: "qt"`; nach einem unsicheren Transportende bleibt
`outcomeUnknown` erhalten. Die internen TypeScript-Testabhängigkeiten sind
weder per Konfiguration noch über HTTP setzbar.

## Prüfung

Für interne native Schreibpfade bietet `QtNativeClient.requestAcknowledged`
eine zusammenhängende Anfrage samt Empfangsbestätigung an. Beide Schritte
teilen eine Frist; andere Aufrufe auf derselben Verbindung werden währenddessen
abgelehnt. Eine bekannte versuchte Mutation verlangt eine gültige, exakt
bestätigte Quittung. Auch ein fachlich fehlgeschlagener Schreibversuch kann
quittiert werden; sein Ergebnis bleibt dabei unverändert. Eine explizit
unbekannte Ausführung wird nicht quittiert. Der native Server behält die
Wiederherstellungsanforderung; Lesezugriff kann weiterhin möglich sein.

Fehlt die Bestätigung, wird die Verbindung geschlossen und die Mutation nie
wiederholt. `QtNativeAcknowledgmentError.mutationResult` erhält die bereits
empfangene Schreibantwort zur Auswertung. Die Quittung bestätigt den Empfang
durch den Transportbesitzer, weder fachlichen Erfolg noch Speichern auf Platte
oder Zustellung einer HTTP-Antwort. Diese interne Funktion aktiviert keine
zusätzliche öffentliche Schreiboperation.

`npm test` prüft Konfiguration, Dateiintegrität, Profilgrenzen, Framing,
Ergebnisform, Markerwechsel, Bindungswiederverwendung, Mehrdeutigkeit, Abbruch
und Lifecycle.
Diese Offline-Prüfung lädt keine DLL in eine installierte SSE und ersetzt
keine reale Prüfung eines konkreten nativen Pakets mit dem unterstützten
Produkt. Leistung wird mit dem tatsächlichen Aufrufweg gemessen; ein kurzer
Pipe-Rundlauf allein belegt keine entsprechende Ende-zu-Ende-Laufzeit.
