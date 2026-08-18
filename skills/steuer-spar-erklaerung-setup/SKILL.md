---
name: steuer-spar-erklaerung-setup
description: Installiert oder repariert die portable lokale SteuerSparErklärung-Automation für ein vom Release unterstütztes Produktprofil unter Windows ohne globales Node.js/npm, Python oder PowerShell 7 und bindet auf Wunsch den optionalen MCP-Wrapper an. Verwenden bei Erstinstallation, neuem PC, fehlender API-Verbindung, geändertem SSE-/Arbeitsordner oder gewünschter MCP-Anbindung für Codex, Claude Code und kompatible Agenten.
---

# SteuerSparErklärung einrichten

Führe den Wizard auf Deutsch und mit möglichst wenigen Systemänderungen aus.
Der Endnutzer braucht kein globales Node.js/npm, kein Python und kein
PowerShell 7. Nutze das im Release gebündelte `runtime/node.exe` sowie Windows
PowerShell 5.1.

## Vorprüfung

1. Prüfe Windows x64 mit Windows PowerShell 5.1. Unter Linux, macOS oder ARM64
   freundlich stoppen; eine neuere Windows-Version nicht allein wegen ihrer
   Versionsnummer ablehnen.
2. Suche eine vorhandene Konfiguration und teste API-Health. Erzeuge keine
   zweite Installation, wenn eine passende bereits funktioniert.
3. Lies `portable-manifest.json` und die veröffentlichte SHA-256-Prüfsumme.
   Akzeptiere nur ein Profil mit `status=supported` und
   `operationAccess=full`; derzeit `2025` / Engine-Major `31`.
   Experimentelle oder `verification-only`-Profile werden weder angeboten noch
   über einen Setup-Opt-in freigeschaltet.
4. Die kanonische öffentliche Releasequelle ist
   `https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases`. Verwende
   das aktuellste dort veröffentlichte, nicht als Draft markierte Release oder
   Prerelease, das beide exakten Assets `steuer-spar-erklaerung.zip` und
   `steuer-spar-erklaerung.zip.sha256` enthält. Ermittle es über die direkte
   Release-Liste/API, nicht aus Suchtreffern oder gecachtem Seitentext.
   GitHub-Quellarchive (`Source code`) sind kein portables Release. Eine andere
   Quelle nur verwenden, wenn der Nutzer sie ausdrücklich nennt; nie eine URL
   oder Versionsnummer erfinden.
5. Fehlt ein fertiges portables Release, stoppe mit dieser konkreten Angabe.
   Fordere einen Laien nicht zum lokalen npm-Build auf.

## Einfacher Standardlauf

Wird Setup als Teil einer Steuerprüfung aufgerufen, lies zuerst den bereits
bestätigten First-Run-Plan des Hauptskills. Frage Steuerfall und Belegordner
nicht erneut. Der Hauptskill muss nach erfolgreichem Setup automatisch mit der
Prüfung fortfahren.

Ohne bestätigten First-Run-Plan zeige vor Änderungen einen kurzen Standardplan:

- funktionierende Konfiguration wiederverwenden, sonst das aktuellste passende
  veröffentlichte Portable-Release samt Prüfsumme installieren;
- `SSE.exe` automatisch erkennen; nur bei keinem oder mehreren Treffern fragen;
- LocalAppData-Arbeitsbereich, read-only Prüfung, Markdown-Tracking und direkte
  API verwenden;
- kein Connector, keine Agenten-Konfigurationsänderung und kein Autostart.

Der Nutzer kann diesen konkret gezeigten Plan mit `OK`, `OK Standard` oder
`OK Default` gemeinsam bestätigen. Das autorisiert genau den genannten
Download und die lokalen Standard-Setup-Dateien, aber keine
Steuerdatenänderung, keinen Connector, keinen MCP-Konfigurations-Merge, keinen
Autostart und keine ELSTER-Aktion.
Frage nur bei einer echten Abweichung weiter, etwa mehreren SSE-Installationen,
einer widersprüchlichen vorhandenen Konfiguration oder einem zu ersetzenden
Ziel ohne verifizierbares Backup.

MCP bleibt optional. Erkläre bei Nachfrage kurz, dass die lokale API die
SteuerSparErklärung bedient und MCP einen kompatiblen Agenten damit verbindet.
Richte MCP nur auf ausdrücklichen Wunsch und nach gezeigtem Datei-Diff ein.

## Einrichten

Lies vor der Ausführung
[references/installation.md](references/installation.md).

1. Prüfe Release-Hash, Tag und Manifest und entpacke erst nach bestätigtem
   Standardplan oder einer gleichwertigen ausdrücklichen Zustimmung.
2. Starte den mitgelieferten Setup-Wizard. Sind bestätigter Fall- oder
   Belegordner noch nicht in einer wiederverwendeten Konfiguration gespeichert,
   führe ihn interaktiv aus und beantworte seine technischen Rückfragen selbst
   aus dem bestätigten Standardplan; frage den Nutzer nicht erneut. Verwende
   `--defaults` nur, wenn diese Pfade bereits gespeichert sind oder ausdrücklich
   kein Fall-/Quellordner gebunden werden soll. `--no-start` nur auf Wunsch.
   Verwende keinen globalen `node`- oder `npm`-Befehl und führe keinen Build auf
   dem Nutzer-PC aus.
3. Lass ein starkes Token und lokale Dateien außerhalb des Repositorys
   erzeugen. Dazu gehören `setup-decisions.json`, `settings.md` und ein neues
   `tracking.md` oder die Referenz auf eine vorhandene `.xlsx`-Datei. Token
   niemals in Chat, Log oder Git wiedergeben.
4. Sichere vorhandene Konfiguration. Merge nur, wenn der Nutzer Dateipfad und
   Diff bestätigt hat; ersetze niemals die komplette Datei.
   Repariere einen alten Eintrag mit `command = "node"`, `node.cmd`, `npx` oder
   einem Batch-Wrapper: MCP muss die absolute mitgelieferte
   `runtime/node.exe` direkt starten. Sonst können Shim-Prozessketten und
   schwarze `cmd.exe`-Fenster entstehen.
5. Starte die API mit dem erzeugten fensterlosen Launcher. Registriere eine
   geplante Aufgabe nur nach separater Zustimmung.
6. Prüfe `/healthz`, Discovery, Produktprofil, Engine, Workspace und read-only
   Zustand. Lies danach `settings.md`, `setup-decisions.json` und das gewählte
   Tracking zurück. Vorhandene Nutzerdateien dürfen bei einem Default-Lauf
   nicht still ersetzt werden.
   Ohne MCP verwende die ausgelieferte CLI; im portablen Ordner lautet der
   Health-Aufruf `runtime/node.exe dist/api-cli.js health --config <config.json>`.
   Lies danach `discovery`; Argumentwerte nie direkt in die Kommandozeile schreiben.
7. Bei MCP-Wunsch: verwende das vollständige Serverobjekt der Setup-Ausgabe,
   prüfe darin nochmals den absoluten `runtime/node.exe`-Befehl, lade den Client
   neu, liste den Server und führe einen realen Health-Aufruf aus. Bleibt das
   unmöglich, direkte API als vollwertigen Fallback anbieten.

## Erfolg und Stopps

Erfolg erst melden, wenn API, Profil und Workspace zurückgelesen wurden. Ein
nicht laufendes SSE mit `running=false` ist für den technischen Setup-Test
zulässig.

Stoppe bei inkompatiblem System, unbekannter Releasequelle, Hashfehler,
unfreigegebenem Profil, fehlender Nutzerzustimmung, uneindeutiger
Agenten-Konfiguration oder nicht erreichbarer API nach einem Erstversuch und
höchstens zwei Wiederholungen im Abstand von je 2 Sekunden.

Berichte konkrete Datei, letzten gelesenen Zustand, bereits erzeugte Dateien
und genau eine nächste sichere Aktion. Lösche Konfigurationen oder geplante
Aufgaben niemals ungefragt.
