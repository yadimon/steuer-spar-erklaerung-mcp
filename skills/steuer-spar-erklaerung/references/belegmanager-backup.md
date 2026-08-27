# BelegManager-Daten sicher sichern

Der BelegManager speichert seine Daten getrennt von der Steuerfalldatei. Eine
Sicherung unter `backups:` schützt daher den Fall, aber nicht automatisch die
BelegManager-Datenbank oder die dort abgelegten Dokumentkopien.

## Wann diese Sicherung Pflicht ist

Lege unmittelbar vor jedem Import, Update, Löschen, Klassifizieren oder
Verknüpfen von Belegen eine neue Sicherung an. Das gilt besonders für
Sammeloperationen. Bei fallbezogener Arbeit sind zwei getrennte Sicherungen
Pflicht:

1. die hashverifizierte Steuerfalldatei nach dem normalen Fallvertrag;
2. die vollständige BelegManager-Datenablage nach dieser Referenz.

Ein unveränderter Hash der Falldatei beweist nicht, dass der BelegManager
unverändert ist. Seine Daten können separat persistieren.

## Datenablage ermitteln

Rate den Pfad nicht. Ermittle zuerst die zum installierten SSE-Major passende
Benutzerkonfiguration:

```text
%LOCALAPPDATA%\Steuertipps\SSE\<major>\SSEKonf.user.ini
```

Lies dort ausschließlich den Eintrag `DataDir` im Abschnitt `[BelegManager]`.
Ein Wert kann als laufwerkswurzelbezogener Windows-Pfad wie
`\Users\<user>\Documents\BelegManager-Daten` gespeichert sein. Löse ihn dann
gegen das Systemlaufwerk auf, normalisiere den absoluten Pfad und bestätige,
dass er außerhalb des Repositorys liegt. Fehlt der Eintrag, ist er mehrdeutig
oder zeigt er auf ein unerwartetes Ziel, stoppe ohne Belegmutation.

Typischerweise enthält die Ablage:

- `BelegManager.db4`, eine SQLite-3-Datenbank;
- vom BelegManager verwaltete Dokumentkopien beziehungsweise Anhänge.

Dateiname und Format sind vor der Sicherung am gefundenen Bestand zu prüfen;
die Beschreibung ist keine Erlaubnis, einen fehlenden Pfad anzunehmen oder neu
anzulegen.

## Konsistente Sicherung

Verwende immer ein neues, privates und datumseindeutiges Ziel außerhalb des
Repositorys. Überschreibe keine frühere Sicherung.

1. Bestätige den SQLite-Header und öffne die Quelldatenbank read-only.
2. Sichere eine laufende Datenbank mit der SQLite-Online-Backup-API oder einer
   gleichwertigen konsistenten SQLite-Sicherung. Kopiere eine geöffnete
   `BelegManager.db4` nicht blind als normale Datei.
3. Kopiere alle übrigen Dateien aus der Datenablage unter Beibehaltung ihrer
   relativen Pfade. Folge keinen Reparse Points oder Links aus der Ablage
   heraus.
4. Erzeuge im Ziel ein Manifest mit relativem Pfad, Bytezahl und SHA-256 für
   jede gesicherte Datei. Das Manifest selbst enthält keine Quellpfade.
5. Vergleiche Anzahl, Größen und Hashes mit dem unmittelbar zuvor gelesenen
   Quellbestand.
6. Führe auf der gesicherten Datenbank `PRAGMA integrity_check` aus. Nur das
   exakte Ergebnis `ok` gilt als bestanden.

Ändert sich der Quellbestand während Inventar, Datenbanksicherung oder
Anhangkopie, gilt die Sicherung nicht als verifiziert. Starte in diesem Fall
keine Belegmutation. Wiederhole die Sicherung erst nach frischem Readback und
einem stabilen Bestand.

## Datenschutz und Abschlussnachweis

BelegManager-Daten sind privat. Nimm weder Datenbank noch Anhänge, Manifest,
absolute Pfade, Belegtitel, Beträge oder Steuerfalldaten in Git, npm-Pakete,
Logs oder öffentliche Berichte auf. Temporäre Hilfsdateien bleiben in einem
ignorierten privaten Bereich.

Dokumentiere im privaten Ergebnisbericht nur:

- dass Fall- und BelegManager-Sicherung getrennt erstellt wurden;
- die private Zielreferenz, soweit der Nutzer sie zur Wiederherstellung braucht;
- Dateianzahl und Manifest-Hash;
- das bestandene Datenbankergebnis `integrity_check=ok`.

Erst danach darf die ausdrücklich freigegebene BelegManager-Operation beginnen.
