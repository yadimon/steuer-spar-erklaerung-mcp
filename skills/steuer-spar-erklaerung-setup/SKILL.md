---
name: steuer-spar-erklaerung-setup
description: Installiert oder repariert die lokale SteuerSparErklärung-Automation für ein vom Release unterstütztes Produktprofil unter Windows über vorhandenes Node.js/npm oder ein portables Release ohne globale Entwicklerwerkzeuge und bindet auf Wunsch den getrennten MCP-Wrapper an. Verwenden bei Erstinstallation, neuem PC, fehlender API-Verbindung, geändertem SSE-/Arbeitsordner oder gewünschter MCP-Anbindung für Codex, Claude Code und kompatible Agenten.
---

# SteuerSparErklärung einrichten

Führe den Wizard auf Deutsch und mit möglichst wenigen Systemänderungen aus.
Dieser Skill folgt dem kanonischen Vertrag unter
[references/installation.md](references/installation.md) und richtet das
Produkt ausschließlich auf dem lokalen Windows-PC ein, nie in einem Cloud-
oder Remote-Agentencontainer. Claude Cowork und der Desktop-`local-agent-mode`
sind wegen ihrer isolierten Ausführung keine Host-Installer für lokale API und
MCP. Verwende bei Claude die eigenständig angemeldete Claude Code CLI mit
echtem Host-PowerShell-Zugriff. Die native Windows-CLI setzt Git for Windows
voraus; fehlt es, nenne diese Client-Voraussetzung und stoppe. Kopiere oder
verschiebe nie Binärdateien oder Anmeldedaten aus
`AppData\Local\Packages\Claude_*\LocalCache` als Umgehung.
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
   Prüfe außerdem, dass `steuer-spar-erklaerung-setup` und der Hauptskill
   `steuer-spar-erklaerung` für den aktuellen lokalen Client installiert sind.
   Ohne Hauptskill darf nach Setup keine Fachprüfung improvisiert werden.
3. Wähle genau einen persistenten Distributionsweg:
   - **npm:** nur bei bereits funktionierendem Node.js 22+ mit npm; niemals
     direkt aus einem flüchtigen `npx`-Cache einrichten;
   - **Portable:** wenn Node/npm fehlt, ungeeignet oder vom Nutzer nicht für
     die Runtime gewünscht ist. Installiere Node/npm nicht als Voraussetzung.
   Bei OpenCode mit bereits funktionierendem Node.js 22+ und npm ist npm der
   kurze Standardweg; prüfe dann nicht zusätzlich den Portable-Weg und lade
   nicht beide Distributionen herunter.
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
  Node.js/npm das passende API-Paket persistent installieren,
  andernfalls das aktuellste passende veröffentlichte Portable-Release samt
  Prüfsumme installieren;
- `SSE.exe` automatisch erkennen; nur bei keinem oder mehreren Treffern fragen;
- LocalAppData-Arbeitsbereich, read-only Prüfung, Markdown-Tracking und direkte
   API verwenden; bei einem ausdrücklich gewünschten vollständigen lokalen
   Agenten-Setup API plus MCP verwenden;
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

Verweist der aktuelle Auftrag auf die kanonische Installationsreferenz und
enthält `Standard-Setup ausführen` samt dem gewünschten Transport, gilt der dort
vollständig beschriebene Standardplan als gezeigt und gleichwertig mit
`OK Standard` bestätigt. Das autorisiert Download, persistente Installation
und bei ausdrücklich gewünschtem MCP den unten definierten tokenfreien
additiven Merge. Zeige Plan und Diff weiterhin, frage innerhalb dieser Grenzen
aber nicht erneut.

MCP ist eine optionale Produktfunktion: Die lokale API bedient die
SteuerSparErklärung, MCP verbindet einen kompatiblen Agenten damit. Ein reines
API-Setup richtet MCP nicht ein. Ein ausdrücklich beauftragter vollständiger
lokaler Standard mit „API plus MCP“ enthält MCP nach gezeigtem Datei-Diff.
Eine bereits im aktuellen Auftrag enthaltene bedingte Zustimmung gilt ohne
dritte Rückfrage, wenn sie ausschließlich Backup plus additiven Merge oder
Update des einen tokenfreien Eintrags `steuer-spar-erklaerung` erlaubt und der
gezeigte Diff genau diese Grenzen einhält. Bei Löschung, Ersetzung der ganzen
Datei, weiteren Servern, Token oder anderem Befehl stoppe stattdessen.

## Einrichten

Lies vor der Ausführung
[references/installation.md](references/installation.md).

1. Prüfe Version, Tag und Distributionsartefakt erst nach bestätigtem
   Standardplan oder einer gleichwertigen ausdrücklichen Zustimmung:
   - npm: installiere `@yadimon/steuer-spar-erklaerung-api` persistent
     unter Windows mit `npm.cmd install --global`; installiere
     `@yadimon/steuer-spar-erklaerung-mcp` nur bei bestätigtem
     MCP-Wunsch. Verwende in PowerShell auch für den Skill-Installer `npx.cmd`,
     statt die Execution Policy für blockierte `.ps1`-Shims zu lockern.
     Verwende weder `npx` noch einen temporären Paketcache zum Start des
     Setup-Wizards.
     Läuft die eigenständig angemeldete Claude Code CLI, verwende den in der
     Installationsreferenz definierten npm-Präfix direkt unter
     `%USERPROFILE%\.steuer-spar-erklaerung` und `--config` auf denselben
     dauerhaften Benutzerprofil-Baum. Cowork, eingebettete Desktop-Binärdateien
     und MSIX-Pfade unter
     `AppData\Local\Packages\Claude_*\LocalCache` sind keine PC-weit
     belastbare Runtime- oder MCP-Bindung und dürfen nicht übernommen werden.
   - Portable: prüfe Release-Hash und Tag, entpacke danach mit dem eingebauten
     Windows-`tar.exe` in einen neuen leeren Zielordner und prüfe erst dort das
     Manifest. `Expand-Archive` kann bei den vielen kleinen Release-Dateien
     mehrere Minuten dauern; ein Agent-Timeout ist kein abgeschlossenes
     Entpacken und der Teilordner darf nicht gestartet werden.
2. Starte den Setup-Wizard des gewählten Wegs. Sind Fall und Belegordner im
   First-Run bereits bestätigt, übergib ausschließlich dessen kurze private
   JSON-Datei mit `--plan-file <absoluter-planpfad>`. Sie darf nur
   `schemaVersion`, `profileId`, `caseDir`, `sourceFolders` und optional den
   eindeutig erkannten `sseExecutable` enthalten. Bei einer neuen Einrichtung
   setzt der Plan read-only, Reference-only, Markdown-Tracking und keine
   Connectoren. Bei einer vorhandenen technischen Einrichtung darf er genau
   einmal zuvor leere Fall-/Quellbindungen ergänzen; vorhandenen Transport und
   sonstige Einstellungen behält der Wizard dabei bei. Bereits nicht leere
   Bindungen darf der Plan niemals ersetzen. Er startet keine interaktiven
   Prompts; automatisiere `stdin` dafür nicht. Bei bestätigtem MCP
   `--with-mcp` ergänzen. `--defaults` nur, wenn diese Pfade bereits gespeichert sind oder ausdrücklich
   kein Fall-/Quellordner gebunden werden soll, und frage den Nutzer nicht erneut.
   `--no-start` nur auf Wunsch.
   Führe keinen Build auf dem Nutzer-PC aus. Beim Portable-Weg keinen globalen
   `node`- oder `npm`-Befehl verwenden; beim npm-Weg ausschließlich die
   veröffentlichten npm-Pakete installieren, niemals Git-Quellcode bauen.
3. Lass ein starkes Token und lokale Dateien außerhalb des Repositorys
   erzeugen. Dazu gehören `setup-decisions.json`, `settings.md` und ein neues
   `tracking.md` oder die Referenz auf eine vorhandene `.xlsx`-Datei. Token
   niemals in Chat, Log oder Git wiedergeben.
   Lies oder parse `config.json` niemals, um das Token selbst zu extrahieren.
   Verwende für authentifizierte Prüfungen ausschließlich die ausgelieferte
   CLI, die das Token intern lädt; baue keinen `curl`-, `Invoke-RestMethod`-
   oder eigenen HTTP-Befehl mit Bearer-Token. Nur `/healthz` darf ohne Token
   direkt geprüft werden. Die erzeugte MCP-Mergevorlage muss tokenfrei sein:
   Sie darf nur die absolute `node.exe` und den lokalen Bootstrap samt
   `--config`-/`--mcp-entry`-Argumenten enthalten. Der Bootstrap lädt das Token
   erst im Prozess; ein `env`-Objekt mit `SSE_API_TOKEN` ist eine veraltete,
   unsichere Vorlage und muss durch erneutes Setup ersetzt werden.
4. Sichere vorhandene Konfiguration. Merge nur, wenn der Nutzer Dateipfad und
   Diff bestätigt hat oder der aktuelle Auftrag die oben beschriebene enge
   bedingte Zustimmung bereits enthält; ersetze niemals die komplette Datei.
   Repariere einen alten Eintrag mit `command = "node"`, `node.cmd`, `npx` oder
   einem Batch-Wrapper: MCP muss die vom Wizard ausgegebene absolute
   `node.exe` direkt starten – portable die mitgelieferte `runtime/node.exe`,
   beim npm-Weg die tatsächlich laufende Node-Datei. Die Argumente müssen auf
   den dauerhaften MCP-Paketeinstieg zeigen. Sonst können Shim-Prozessketten,
   ungültige Cachepfade und schwarze `cmd.exe`-Fenster entstehen.
   Ergänze bei Codex zusätzlich exakt die tokenfreien Felder `required`,
   `startup_timeout_sec`, `tool_timeout_sec` und `enabled_tools` aus der
   Installationsreferenz in derselben Server-Tabelle. Sie gehören zum
   bestätigten Codex-Standard-Merge und begrenzen den Modellkatalog auf die
   dort dokumentierten Kernwerkzeuge; erfinde keine eigene Allowlist. Bei
   Claude Code und OpenCode diese Codex-TOML-Felder nicht ergänzen.
5. Starte die API mit dem erzeugten fensterlosen Launcher. Registriere eine
   geplante Aufgabe nur nach separater Zustimmung.
   Für die einmalige Ergänzung zuvor leerer Fall-/Quellbindungen fordert der
   Wizard die laufende API selbst über ihren internen Loopback-Setup-Endpunkt
   mit Token und exaktem bisherigen Konfigurationsfingerprint zum kontrollierten
   Shutdown auf, schreibt redigierte Backups und startet genau diese API neu.
   Antwortet auf demselben Port eine andere, alte oder nicht eindeutig
   gebundene API, stoppe. Ein beliebiger Port- oder Node-Prozess darf niemals
   pauschal beendet werden.
6. Führe nach dem Start `steuer-spar-erklaerung-setup --check` aus; bei einer
   expliziten Konfiguration denselben absoluten `--config`-Pfad ergänzen; beim
   Portable-Weg `sse-setup.cmd --check`. Prüfe damit `/healthz`, Discovery,
   Produktprofil, Engine, Workspace und read-only
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
7. Bei MCP-Wunsch: verwende das vollständige **tokenfreie** Serverobjekt der
   Setup-Ausgabe und prüfe darin nochmals den absoluten `node.exe`-Befehl und
   dauerhaften MCP-Einstieg. Nach einer neuen oder geänderten Skill-/MCP-
   Installation kann die laufende Agentensession den neuen Server nicht als
   echtes Tool beweisen. Beende diesen Lauf nach grünem `--check` mit
   **„Technisches Setup bereit; Client-Verifikation nach Neustart offen.“** und
   fordere genau einen Neustart des lokalen Clients an. Behaupte in der alten
   Session weder `connected` noch einen erfolgreichen Tool-Aufruf.
8. Im neu geladenen Client prüft der nächste Fachauftrag zuerst die Serverliste
   und führt `sse_health` real aus. Erfolg verlangt das strukturierte Resultat
   mit `ok=true`; ein Servereintrag, Status „connected“ oder erfolgreicher
   Handshake ist kein Ersatz. Ein direkter API-CLI-Aufruf von `health` beweist
   die API, aber nicht MCP, und darf diesen einen Tool-Aufruf nicht ersetzen.
   Für Codex `codex mcp list`, für Claude Code
   `claude mcp list`, für OpenCode `opencode mcp list` beziehungsweise
   `opencode mcp ls` verwenden. Scheitert die Client-Verifikation, melde den
   konkreten Stopp; nutze die direkte API nur, wenn der Nutzer kein MCP verlangt
   oder sie ausdrücklich als Fallback akzeptiert.

## Erfolg und Stopps

Erfolg erst melden, wenn API, Profil und Workspace zurückgelesen wurden. Ein
nicht laufendes SSE mit `running=false` ist für den technischen Setup-Test
zulässig.

Dieser Setup-Skill öffnet nie selbst einen Steuerfall. War das Setup Teil einer
Steuerprüfung, übergib danach an den Hauptskill `steuer-spar-erklaerung`; erst
dessen hashverifizierte Prüffallkopie und ausdrückliche UI-Freigabe erlauben
sichtbare Navigation. Ist der Hauptskill nicht verfügbar, stoppe nach dem
technischen Setup und fordere ihn an, statt die Fachprüfung zu improvisieren.

Stoppe bei inkompatiblem System, unbekannter Releasequelle, Hashfehler,
unfreigegebenem Profil, fehlender Nutzerzustimmung, uneindeutiger
Agenten-Konfiguration oder nicht erreichbarer API nach einem Erstversuch und
höchstens zwei Wiederholungen im Abstand von je 2 Sekunden.

Lehnt `--plan-file` eine vorhandene Bindung oder den kontrollierten Neustart
ab, arbeite nicht darum herum: `config.json`, `setup-decisions.json`,
installierte Runtime-Dateien und Prozesse weder lesen noch manuell ändern oder
beenden. Melde den Wizard-Fehler als sicheren Stopp.

Es gibt genau einen zugelassenen Reparaturweg, und er ändert keine Datei von
Hand: Stammt die vorhandene Konfiguration aus einem NPX-Foreground-Start, ist
sie unvollständig statt kaputt. `steuer-spar-erklaerung-setup --check` meldet
das als `ok=false` mit `kind="foreground-only-config"`. Lasse dann zuerst die
laufende Foreground-API vom Nutzer mit Strg+C beenden und führe danach
`steuer-spar-erklaerung-setup --defaults` aus; das Token bleibt erhalten.
Erst danach ist `--plan-file` wieder der richtige Weg. Läuft die Foreground-API
noch, lehnt sie die sichere Neubindung wegen abweichendem
Konfigurationsfingerprint mit HTTP 409 ab — das ist erwartetes Verhalten und
kein Grund, etwas manuell zu erzwingen.

Berichte konkrete Datei, letzten gelesenen Zustand, bereits erzeugte Dateien
und genau eine nächste sichere Aktion. Lösche Konfigurationen oder geplante
Aufgaben niemals ungefragt.
