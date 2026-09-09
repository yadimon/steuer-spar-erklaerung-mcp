# Optionaler Qt-Lesepfad

Die API kann `get_value` und `table_read` über eine dauerhaft gebundene
Qt-Verbindung ausführen. Der normale Runtime-Start aktiviert diesen Pfad nur,
wenn die Konfigurationsdatei `qtNativeRuntime` enthält. Dafür wird ein separates,
kompatibles natives Paket benötigt; die npm-Pakete enthalten diesen Qt-Helfer
noch nicht. Andere Operationen behalten ihre bestehenden Ausführungspfade.

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

Beim ersten nativen Leseaufruf prüft der bestehende Worker die Fensterauswahl
und Desktop-Eigentümerschaft. Erst danach startet die API den fensterlosen
Helfer. Dieser muss Produkt-, Prozess-, HWND-, DLL- und Pipe-Server-Identität
bestätigen. Die API prüft außerdem, dass der Helfer selbst der Sitzungsbesitzer
ist. Der Start und alle folgenden Schritte teilen die Frist des API-Aufrufs.

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
Ergebnisform, Bindungswiederverwendung, Mehrdeutigkeit, Abbruch und Lifecycle.
Diese Offline-Prüfung lädt keine DLL in eine installierte SSE und ersetzt
keine reale Prüfung eines konkreten nativen Pakets mit dem unterstützten
Produkt. Leistung wird mit dem tatsächlichen Aufrufweg gemessen; ein kurzer
Pipe-Rundlauf allein belegt keine entsprechende Ende-zu-Ende-Laufzeit.
