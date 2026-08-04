---
name: steuer-spar-erklaerung-setup
description: Installiert oder repariert die portable lokale SteuerSparErklärung-2025-Automation unter Windows ohne globales Node.js/npm, Python oder PowerShell 7 und bindet auf Wunsch den optionalen MCP-Wrapper an. Verwenden bei Erstinstallation, neuem PC, fehlender API-Verbindung, geändertem SSE-/Arbeitsordner oder gewünschter MCP-Anbindung für Codex, Claude Code und kompatible Agenten.
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
   Akzeptiere nur ein als `supported` markiertes Profil; derzeit `2025` /
   Engine-Major `31`.
4. Die kanonische öffentliche Releasequelle ist
   `https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases`. Verwende
   ausschließlich ein dort veröffentlichtes Asset namens
   `steuer-spar-erklaerung.zip` zusammen mit der gleichnamigen `.sha256`-Datei.
   GitHub-Quellarchive (`Source code`) sind kein portables Release. Eine andere
   Quelle nur verwenden, wenn der Nutzer sie ausdrücklich nennt; nie eine URL
   erfinden.
5. Fehlt ein fertiges portables Release, stoppe mit dieser konkreten Angabe.
   Fordere einen Laien nicht zum lokalen npm-Build auf.

## Fragen mit Standardantwort

Stelle eine Frage pro Nachricht und überspringe bereits sicher erkannte Werte.
Erkläre jeweils: „Wenn Sie unsicher sind, antworten Sie …“

1. Darf das geprüfte portable Release heruntergeladen und in einen genannten
   lokalen Ordner entpackt werden? Standard: **Ja**.
2. Wo liegt `SSE.exe`? Standard: automatisch erkannte Installation des aktiven
   Profils; bei mehreren Treffern den Nutzer wählen lassen.
3. Welcher Arbeitsbereich soll gelten? Standard: vom Setup vorgeschlagener
   LocalAppData-Pfad, außerhalb jedes Git-Repositorys.
4. Soll ein vorhandener Fallordner als Quelle eingetragen werden? Standard:
   **leer lassen**, wenn keiner sicher bekannt ist.
5. Soll nur die direkte API eingerichtet werden oder zusätzlich MCP?
   Standard: **direkte API; MCP nur bei Wunsch oder bereits passendem Client**.
6. Darf bei MCP-Wunsch genau der neue Servereintrag in eine vorhandene
   Agenten-Konfiguration gemergt werden? Standard: **Nein, bis Dateipfad und
   Diff gezeigt wurden**.
7. Soll ein Start bei Anmeldung eingerichtet werden? Standard: **Nein**.

„Alles mit Standardwerten“ beantwortet keine Zustimmung zu Download,
Konfigurationsänderung oder Autostart. Diese Zustimmungen weiterhin einzeln
einholen.

## Einrichten

Lies vor der Ausführung
[references/installation.md](references/installation.md).

1. Prüfe Release-Hash und entpacke erst nach Zustimmung.
2. Starte den mitgelieferten Setup-Wizard. Verwende keinen globalen `node`-
   oder `npm`-Befehl und führe keinen Build auf dem Nutzer-PC aus.
3. Lass ein starkes Token und lokale Dateien außerhalb des Repositorys
   erzeugen. Token niemals in Chat, Log oder Git wiedergeben.
4. Sichere vorhandene Konfiguration. Merge nur, wenn der Nutzer Dateipfad und
   Diff bestätigt hat; ersetze niemals die komplette Datei.
   Repariere einen alten Eintrag mit `command = "node"`, `node.cmd`, `npx` oder
   einem Batch-Wrapper: MCP muss die absolute mitgelieferte
   `runtime/node.exe` direkt starten. Sonst können Shim-Prozessketten und
   schwarze `cmd.exe`-Fenster entstehen.
5. Starte die API mit dem erzeugten fensterlosen Launcher. Registriere eine
   geplante Aufgabe nur nach separater Zustimmung.
6. Prüfe `/healthz`, Produktprofil, Engine, Workspace und read-only Zustand.
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
