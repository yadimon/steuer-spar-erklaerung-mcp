---
name: steuer-spar-erklaerung-setup
description: Installiert oder repariert die lokale SteuerSparErklärung-Automation für ein vom Release unterstütztes Produktprofil unter Windows über vorhandenes Node.js/npm oder ein portables Release ohne globale Entwicklerwerkzeuge und bindet auf Wunsch den getrennten MCP-Wrapper an. Verwenden bei Erstinstallation, neuem PC, fehlender API-Verbindung, geändertem SSE-/Arbeitsordner oder gewünschter MCP-Anbindung für Codex, Claude Code und kompatible Agenten.
---

# SteuerSparErklärung einrichten

Führe den Wizard auf Deutsch und mit möglichst wenigen Systemänderungen aus.
Installiere Node.js/npm, Python oder PowerShell 7 nicht eigens für dieses
Produkt. Ist Node.js 22 oder neuer mit npm bereits vorhanden, darf der
bestätigte Standardplan die getrennten npm-Pakete verwenden. Sonst nutze das
portable Release mit gebündeltem `runtime/node.exe`. Beide Wege verwenden
Windows PowerShell 5.1.

## Vorprüfung

1. Prüfe Windows x64 mit Windows PowerShell 5.1. Unter Linux, macOS oder ARM64
   freundlich stoppen; eine neuere Windows-Version nicht allein wegen ihrer
   Versionsnummer ablehnen.
2. Suche eine vorhandene Konfiguration und teste API-Health. Erzeuge keine
   zweite Installation, wenn eine passende bereits funktioniert.
3. Wähle genau einen persistenten Distributionsweg:
   - **npm:** nur bei bereits funktionierendem Node.js 22+ mit npm; niemals
     direkt aus einem flüchtigen `npx`-Cache einrichten;
   - **Portable:** wenn Node/npm fehlt, ungeeignet oder vom Nutzer nicht für
     die Runtime gewünscht ist. Installiere Node/npm nicht als Voraussetzung.
4. Binde beide Wege an denselben vollständigen Release. Beim npm-Weg lies die
   `beta`-Version von `@yadimon/steuer-spar-erklaerung-api` und bei
   MCP-Wunsch zusätzlich `@yadimon/steuer-spar-erklaerung-mcp`; beide müssen
   gleich sein und zu einem vollständigen GitHub-Release mit ZIP und
   Prüfsumme gehören. Beim Portable-Weg lies `portable-manifest.json` und die
   veröffentlichte SHA-256-Prüfsumme. Parse das Manifest einmal als JSON und
   lies nur Version, Profilstatus und die für den Start nötigen Dateieinträge;
   gib niemals die vollständige Dateiliste oder das ganze Manifest aus und
   durchsuche `dist` nicht breit nach vermeintlichen Verträgen.
   Akzeptiere nur ein Profil mit `status=supported` und
   `operationAccess=full`; derzeit `2025` / Engine-Major `31`.
   Experimentelle oder `verification-only`-Profile werden weder angeboten noch
   über einen Setup-Opt-in freigeschaltet.
5. Die kanonische öffentliche Releasequelle ist
   `https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases`. Verwende
   das aktuellste dort veröffentlichte, nicht als Draft markierte Release oder
   Prerelease, das beide exakten Assets `steuer-spar-erklaerung.zip` und
   `steuer-spar-erklaerung.zip.sha256` enthält. Ermittle es über die direkte
   Release-Liste/API, nicht aus Suchtreffern oder gecachtem Seitentext.
   GitHub-Quellarchive (`Source code`) sind kein portables Release. Eine andere
   Quelle nur verwenden, wenn der Nutzer sie ausdrücklich nennt; nie eine URL
   oder Versionsnummer erfinden.
6. Fehlt ein fertiges portables Release, stoppe mit dieser konkreten Angabe.
   Fordere einen Laien nicht zum lokalen npm-Build auf.

## Einfacher Standardlauf

Wird Setup als Teil einer Steuerprüfung aufgerufen, lies zuerst den bereits
bestätigten First-Run-Plan des Hauptskills. Frage Steuerfall und Belegordner
nicht erneut. Der Hauptskill muss nach erfolgreichem Setup automatisch mit der
Prüfung fortfahren.

Ohne bestätigten First-Run-Plan zeige vor Änderungen einen kurzen Standardplan:

- funktionierende Konfiguration wiederverwenden; sonst bei vorhandenem
  Node.js/npm das passende API-Paket persistent mit `@beta` installieren,
  andernfalls das aktuellste passende veröffentlichte Portable-Release samt
  Prüfsumme installieren;
- `SSE.exe` automatisch erkennen; nur bei keinem oder mehreren Treffern fragen;
- LocalAppData-Arbeitsbereich, read-only Prüfung, Markdown-Tracking und direkte
  API verwenden;
- kein Connector, keine Agenten-Konfigurationsänderung und kein Autostart.

Der Plan nennt vor der Bestätigung ausdrücklich den gewählten npm- oder
Portable-Weg und ob nur API oder zusätzlich MCP installiert wird. Der Nutzer
kann diesen konkret gezeigten Plan mit `OK`, `OK Standard` oder
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

1. Prüfe Version, Tag und Distributionsartefakt erst nach bestätigtem
   Standardplan oder einer gleichwertigen ausdrücklichen Zustimmung:
   - npm: installiere `@yadimon/steuer-spar-erklaerung-api@beta` persistent
     mit `npm install --global`; installiere
     `@yadimon/steuer-spar-erklaerung-mcp@beta` nur bei bestätigtem
     MCP-Wunsch. Verwende weder `npx` noch einen temporären Paketcache zum
     Start des Setup-Wizards.
   - Portable: prüfe Release-Hash und Tag, entpacke danach mit dem eingebauten
     Windows-`tar.exe` in einen neuen leeren Zielordner und prüfe erst dort das
     Manifest. `Expand-Archive` kann bei den vielen kleinen Release-Dateien
     mehrere Minuten dauern; ein Agent-Timeout ist kein abgeschlossenes
     Entpacken und der Teilordner darf nicht gestartet werden.
2. Starte den Setup-Wizard des gewählten Wegs. Sind Fall und Belegordner im
   First-Run bereits bestätigt, übergib ausschließlich dessen kurze private
   JSON-Datei mit `--plan-file <absoluter-planpfad>`. Sie darf nur
   `schemaVersion`, `profileId`, `caseDir`, `sourceFolders` und optional den
   eindeutig erkannten `sseExecutable` enthalten. Der Plan erzwingt direkte
   API, read-only, Reference-only, Markdown-Tracking, keine Connectoren und
   keine interaktiven Prompts; automatisiere `stdin` dafür nicht. Verwende
   `--defaults` nur, wenn diese Pfade bereits gespeichert sind oder ausdrücklich
   kein Fall-/Quellordner gebunden werden soll, und frage den Nutzer nicht erneut.
   `--no-start` nur auf Wunsch.
   Führe keinen Build auf dem Nutzer-PC aus. Beim Portable-Weg keinen globalen
   `node`- oder `npm`-Befehl verwenden; beim npm-Weg ausschließlich die
   veröffentlichten `@beta`-Pakete installieren, niemals Git-Quellcode bauen.
3. Lass ein starkes Token und lokale Dateien außerhalb des Repositorys
   erzeugen. Dazu gehören `setup-decisions.json`, `settings.md` und ein neues
   `tracking.md` oder die Referenz auf eine vorhandene `.xlsx`-Datei. Token
   niemals in Chat, Log oder Git wiedergeben.
4. Sichere vorhandene Konfiguration. Merge nur, wenn der Nutzer Dateipfad und
   Diff bestätigt hat; ersetze niemals die komplette Datei.
   Repariere einen alten Eintrag mit `command = "node"`, `node.cmd`, `npx` oder
   einem Batch-Wrapper: MCP muss die vom Wizard ausgegebene absolute
   `node.exe` direkt starten – portable die mitgelieferte `runtime/node.exe`,
   beim npm-Weg die tatsächlich laufende Node-Datei. Die Argumente müssen auf
   den dauerhaften MCP-Paketeinstieg zeigen. Sonst können Shim-Prozessketten,
   ungültige Cachepfade und schwarze `cmd.exe`-Fenster entstehen.
5. Starte die API mit dem erzeugten fensterlosen Launcher. Registriere eine
   geplante Aufgabe nur nach separater Zustimmung.
   Antwortet auf demselben Port bereits eine API mit einem abweichenden Konfigurationsfingerprint,
   starte keine zweite API neben einer alten API.
   Beende die eindeutig gebundene alte API kontrolliert oder verwende ihre
   bestätigte Konfiguration, und verifiziere erst danach genau einen Neustart.
   Ein beliebiger Portprozess darf niemals pauschal beendet werden.
6. Prüfe `/healthz`, Discovery, Produktprofil, Engine, Workspace und read-only
   Zustand. Lies danach `settings.md`, `setup-decisions.json` und das gewählte
   Tracking zurück. Vorhandene Nutzerdateien dürfen bei einem Default-Lauf
   nicht still ersetzt werden.
   Ohne MCP verwende die ausgelieferte CLI. Beim npm-Weg lautet sie
   `steuer-spar-erklaerung-call`; im portablen Ordner lautet der Health-Aufruf
   `runtime/node.exe dist/api-cli.js health --config <config.json>
   --journal-file <neue-private-datei.jsonl>`. Lies danach `discovery`;
   Argumentwerte nie direkt in die Kommandozeile schreiben. Schreibe eigene
   Diagnosezeilen niemals in stdout eines CLI-Aufrufs, dessen stdout als JSON
   geparst wird; lies das Journal getrennt.
7. Bei MCP-Wunsch: verwende das vollständige Serverobjekt der Setup-Ausgabe,
   prüfe darin nochmals den absoluten `node.exe`-Befehl und dauerhaften
   MCP-Einstieg, lade den Client
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
