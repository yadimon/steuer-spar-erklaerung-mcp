# Optionaler Qt-Lesepfad

Die API kann `get_value` und `table_read` über eine dauerhaft gebundene
Qt-Verbindung ausführen. Der normale Runtime-Start aktiviert diesen Pfad nur,
wenn die Konfigurationsdatei `qtNativeRuntime` enthält. Dafür wird ein separates,
kompatibles natives Paket benötigt; die npm-Pakete enthalten diesen Qt-Helfer
noch nicht. Andere Operationen behalten ihre bestehenden Ausführungspfade.

## Natives Paket selbst bauen

Die C++-Quellen und der Paketbau liegen unter [native/qt](../native/qt/CMakeLists.txt).
Voraussetzungen sind Windows x64, MSVC, CMake ab 3.24, Node.js und das Qt-6.9.2-SDK
für MSVC x64. Der normale npm-Build benötigt dieses zusätzliche SDK nicht.
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
