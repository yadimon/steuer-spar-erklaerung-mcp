# Installation für Menschen und AI-Agenten

Diese Anleitung ist der kanonische Einrichtungsvertrag. Ein Mensch kann die
Befehle selbst ausführen; ein lokaler AI-Agent darf denselben Ablauf nach einem
kurzen Plan übernehmen. Die SteuerSparErklärung-Automation läuft immer auf dem
Windows-PC. Sie wird nicht in Codex Cloud, Claude Code on the web oder einem
anderen Remote-Container eingerichtet. Claude Cowork führt Code in einer
isolierten Umgebung aus und ist deshalb kein Installer für die host-lokale API-
und MCP-Konfiguration. Verwende dafür die eigenständig angemeldete Claude Code
CLI oder einen anderen lokalen Agenten mit echtem Host-PowerShell-Zugriff.

## Zielbild

```text
lokaler Agent -> installierter Skill -> lokaler MCP-Server -> Loopback-API -> SteuerSparErklärung
                                      \-> direkte API-CLI als Fallback
```

Die lokale API ist der Ausführungskern. MCP verbindet den Agenten mit dieser
API, greift aber nicht selbst auf Steuerdateien oder die Desktop-Oberfläche zu.
Das Standardsetup für Codex, Claude Code und OpenCode installiert beide Skills,
API und MCP. Falls der Client keinen lokalen MCP unterstützt, bleibt die
mitgelieferte API-CLI vollwertig nutzbar.

## Was mindestens vorhanden sein muss

- Windows x64;
- eine installierte SteuerSparErklärung 2025 / Engine-Major 31;
- ein **lokal** laufender Agent mit Datei- und Programmzugriff;
- Internetzugriff während Download und Installation;
- für sichtbare SSE-Bedienung eine entsperrte, unbenutzte Windows-Sitzung.

Für die native Claude Code CLI unter Windows müssen außerdem Git for Windows
und eine eigene Anmeldung in `claude` vorhanden sein. Eine Anmeldung in Claude
Desktop oder Cowork authentifiziert die eigenständige CLI nicht. Verwende nie
eine eingebettete Claude-Binärdatei oder Anmeldedaten aus
`AppData\Local\Packages\Claude_*\LocalCache` als Umgehung.

Nicht allgemein erforderlich sind Python, PowerShell 7, Docker oder ein
Repository-Checkout. Windows PowerShell 5.1 gehört zu Windows und wird von der
Automation direkt aus dem Systemordner gestartet.

Es gibt genau zwei unterstützte Installationswege:

| Weg | Zusätzlich vorhanden | Geeignet für |
| --- | --- | --- |
| npm | Node.js 22+ mit npm | kürzeste Installation und einfache Updates |
| Portable | nichts Zusätzliches | PCs ohne Node.js/npm |

Für OpenCode ist der npm-Weg der einfache Standard, sobald `node --version`
mindestens 22 meldet und `npm.cmd --version` funktioniert. Dann nicht parallel
das Portable-Release herunterladen. Fehlt Node/npm, bleibt Portable unterstützt;
Node.js wird nicht nur für dieses Produkt nachinstalliert. Verwende unter
Windows in PowerShell `npm.cmd` und `npx.cmd`; ändere nicht die systemweite
Execution Policy, nur weil die parallelen `npm.ps1`-/`npx.ps1`-Shims blockiert
sind.

OpenCode ist ein sekundärer, best-effort Client. Verwende dort einen Agenten,
der PowerShell-Anweisungen zuverlässig ausführt. Für ein technisches Setup ohne
Steuerfallbindung nach der Paketinstallation exakt
`steuer-spar-erklaerung-setup --defaults --with-mcp` ausführen: den
interaktiven Wizard nicht starten und niemals Antworten über `stdin` zuführen.

OpenCode darf die rohe API-Datei `config.json` weder öffnen, lesen noch parsen
und die API nicht mit selbst gebauten HTTP-Aufrufen prüfen. Setup-CLI und
MCP-Bootstrap laden das Token intern; für die Prüfung genügen `--check`, die
MCP-Serverliste und der echte MCP-Aufruf `sse_health`.

`npx skills` selbst benötigt Node.js/npm und kann je nach Installationsweg Git
verwenden. Git ist keine Voraussetzung der SteuerSparErklärung-Automation oder
des Portable-Releases; die native Claude Code CLI unter Windows benötigt Git
for Windows jedoch selbst. Ohne funktionierenden Skill-Installer darf der Agent
die beiden Skillordner aus dem aktuellen Repository-ZIP kopieren oder die
Skills aus dem verifizierten Portable-Release verwenden.

## 1. Beide Skills installieren

Der Agent muss `steuer-spar-erklaerung-setup` **und**
`steuer-spar-erklaerung` installieren. Nur der Setup-Skill richtet die Technik
ein; nur der Hauptskill darf anschließend einen Steuerfall prüfen.

Mit vorhandenem Node.js 22+ und npm:

```powershell
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp --list
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --skill steuer-spar-erklaerung-setup `
  --agent <codex|claude-code|opencode> --global --copy --yes
```

Danach den Agenten neu laden und prüfen, dass beide Skills lokal aufgelistet
werden. Eine Raw-Datei im Browser oder gecachter Webtext ist keine installierte
Skill-Version.

Ohne `npx skills` lädt der Agent das aktuelle Repository-ZIP direkt vom
kanonischen Repository, prüft Quelle und Commit und kopiert ausschließlich die
beiden vollständigen Ordner unter `skills/` in das Skillverzeichnis des lokalen
Clients. Relative Dateien unter `references/` und `agents/` müssen mitkopiert
werden. Keine unbekannte Spiegelquelle verwenden.

## 2. Runtime installieren

### Weg A: npm

Vor der Installation beide Registry-Versionen lesen. Sie müssen gleich sein
und zu einem vollständigen GitHub-Release mit Portable-ZIP und Sidecar-Hash
gehören:

```powershell
npm.cmd view @yadimon/steuer-spar-erklaerung-api@beta version
npm.cmd view @yadimon/steuer-spar-erklaerung-mcp@beta version
npm.cmd install --global @yadimon/steuer-spar-erklaerung-api@beta @yadimon/steuer-spar-erklaerung-mcp@beta
```

Setup nie direkt aus `npx` starten: dessen `_npx`-Cache ist flüchtig und darf
nicht in dauerhaften API- oder MCP-Startpfaden landen.

**Claude Code CLI unter Windows (nicht Cowork):** Führe diesen Weg aus der
eigenständig angemeldeten CLI oder einem lokalen Terminal aus. Cowork und eine
in der Claude-Desktop-App eingebettete Binärdatei können Schreibzugriffe unter
`AppData` in das MSIX-Verzeichnis `Packages\Claude_*\LocalCache` virtualisieren;
das ist keine PC-weite Host-Installation. Verwende deshalb einen dauerhaften
Ordner direkt im Benutzerprofil und eine explizite Konfiguration:

```powershell
$sseLocalRoot = Join-Path $env:USERPROFILE '.steuer-spar-erklaerung'
$sseRuntimeRoot = Join-Path $sseLocalRoot 'npm'
$sseConfigPath = Join-Path $sseLocalRoot 'config.json'
npm.cmd install --global --prefix $sseRuntimeRoot `
  @yadimon/steuer-spar-erklaerung-api@beta `
  @yadimon/steuer-spar-erklaerung-mcp@beta
& (Join-Path $sseRuntimeRoot 'steuer-spar-erklaerung-setup.cmd') `
  --config $sseConfigPath --defaults --with-mcp
```

Nutze für einen bestätigten First-run-Plan an derselben Stelle `--plan-file`
statt `--defaults`. Auch `--check` muss bei diesem Weg denselben absoluten
`--config`-Pfad erhalten. Akzeptiere den Setup-Erfolg nur, wenn `command`,
Bootstrap, MCP-Einstieg und Konfigurationspfad aus der tokenfreien Vorlage
außerhalb von `AppData\Local\Packages\Claude_*\LocalCache` liegen und als reale
Dateien existieren. Lies `config.json` dafür nicht. Eine bereits virtualisierte
Beta-Installation gilt nicht als clientverifiziert; richte sie über diesen
Benutzerprofil-Pfad neu ein, statt virtuelle Dateien manuell zu verschieben.

### Weg B: Portable

Ermittle das aktuellste nicht als Draft markierte Release über die direkte
GitHub-Release-Liste des kanonischen Repositorys. Es muss exakt
`steuer-spar-erklaerung.zip` und
`steuer-spar-erklaerung.zip.sha256` enthalten. GitHub-Quellarchive sind nicht
das Portable-Produkt.

Vergleiche die Sidecar-Prüfsumme, entpacke erst danach in einen neuen leeren
Ordner und verwende bevorzugt das Windows-eigene
`$env:SystemRoot\System32\tar.exe`. Ein Timeout oder Teilordner ist kein
Erfolg; nicht in denselben Ordner nachentpacken. Parse danach
`portable-manifest.json` als JSON und prüfe Version, unterstütztes Profil und
die benötigten Startdateien. Gib weder das vollständige Manifest noch seine
Dateiliste in den Agentenkontext aus.

Der PDF-Helper muss als eigener
`powershell.exe -NoProfile -NonInteractive -File powershell/render-pdf.ps1`
Prozess laufen. Erfolg verlangt Exitcode 0, `ok=true` und lesbare create-only
PNG-Dateien; ein fremder WinRT-Restcode darf nicht als Erfolg umgedeutet
werden.

## 3. Lokale API und MCP vorbereiten

Interaktiv:

```powershell
steuer-spar-erklaerung-setup --with-mcp
```

`--config <absoluter-pfad>` bindet Setup, API-Launcher und tokenfreie
MCP-Vorlage an eine ausdrücklich gewählte dauerhafte Konfiguration. Verwende
denselben Parameter bei `--check` und bei direkten API-CLI-Aufrufen. Für Claude
Desktop ist der oben gezeigte Benutzerprofil-Pfad Pflicht; der allgemeine
Standard unter `LocalAppData` bleibt für nicht virtualisierte Clients zulässig.

Beim Portable-Weg:

```powershell
.\sse-setup.cmd --with-mcp
```

Hat der Hauptskill Steuerfall und Belegordner bereits bestätigen lassen,
schreibt er eine kurze private JSON-Datei mit ausschließlich
`schemaVersion: 1`, `profileId`, absolutem `caseDir`, absoluten
`sourceFolders` und optional einem eindeutig erkannten `sseExecutable`.
Dann gilt:

```powershell
steuer-spar-erklaerung-setup --plan-file <absoluter-planpfad> --with-mcp
```

`--plan-file` akzeptiert keine Tokens, Connectoren, Schreibrechte, Autostarts
oder ELSTER-Autorität. `--defaults` ist nur für bereits gespeicherte Pfade oder
ein bewusst technisches Setup ohne Fall-/Belegbindung gedacht. `--no-start`
erzeugt Dateien, prüft die laufende API aber nicht.

Bei einer vorhandenen technischen Konfiguration darf ein bestätigter Plan
genau einmal zuvor leere `caseDir`-/`sourceFolders`-Bindungen ergänzen. Der
Wizard behält Token, MCP-Transport und alle übrigen Einstellungen bei, fordert
eine exakt per Token und Fingerprint gebundene laufende API kontrolliert zum
Shutdown auf, sichert die bisherigen Dateien und startet sie neu. Bereits
nicht leere Bindungen werden weiterhin abgelehnt. Nach einer Ablehnung niemals
`config.json`, `setup-decisions.json`, Runtime-Dateien oder Prozesse manuell
als Umgehung ändern.

Der Wizard erzeugt außerhalb des Produkts eine Loopback-Konfiguration, einen
fensterlosen API-Starter, `setup-decisions.json`, `settings.md`, Tracking und
eine MCP-Mergevorlage. Die MCP-Vorlage enthält **kein Token**: Sie startet einen
lokalen Bootstrap, der das Token erst im Prozess aus `config.json` lädt.
`config.json` niemals öffnen, lesen oder parsen. Die Datei und ihr Token niemals
in Chat, Log, Diff, Prozessargument oder eigenen `curl`-/`Invoke-RestMethod`-
Aufruf übernehmen. Authentifizierte Prüfungen ausschließlich über Setup-CLI,
ausgelieferte API-CLI oder MCP ausführen; diese laden das Token intern.

## 4. MCP an den lokalen Client binden

Vor jeder Clientänderung vorhandene Konfiguration sichern, den konkreten
Dateipfad und einen tokenfreien Diff zeigen und Zustimmung einholen. Eine im
aktuellen Auftrag bereits enthaltene bedingte Zustimmung reicht, wenn der
gezeigte Diff ausschließlich den einen Server `steuer-spar-erklaerung` additiv
mergt oder aktualisiert und keine anderen Einträge löscht oder ersetzt. Niemals
die ganze Datei ersetzen. Verwende `command` und `args` unverändert aus dem
Serverobjekt `steuer-spar-erklaerung` der erzeugten Mergevorlage.

- **Codex:** bevorzugt `codex mcp add ... -- <command> <args...>` verwenden.
  Ergänze danach in genau derselben TOML-Tabelle die folgenden
  client-spezifischen, tokenfreien Kontrollen. Aktuelle Codex-Versionen können
  einen großen unbeschränkten MCP-Katalog sonst vollständig aus dem
  Modellkontext ausblenden. Die begrenzte Kernliste deckt den Standard-Prüflauf
  ab; alle übrigen veröffentlichten Operationen bleiben über die ausgelieferte
  API-CLI erreichbar.

  ```toml
  required = true
  startup_timeout_sec = 30
  tool_timeout_sec = 300
  enabled_tools = [
    "sse_health", "sse_capabilities", "sse_product_info",
    "sse_workspace_status", "sse_workspace_files",
    "sse_workspace_read_text", "sse_workspace_write_text",
    "sse_list_cases", "sse_case_hash", "sse_make_working_copy",
    "sse_launch", "sse_windows", "sse_dialog_list", "sse_dialog_answer",
    "sse_warning_popup_read", "sse_page", "sse_page_state",
    "sse_page_objects", "sse_ui_state", "sse_collect", "sse_goto",
    "sse_checker_results", "sse_checker_run", "sse_checker_open",
    "sse_checker_close", "sse_screenshot", "sse_subpages",
    "sse_table_read", "sse_find", "sse_positions", "sse_click",
    "sse_click_point", "sse_read_full", "sse_result_details", "sse_close"
  ]
  ```

  Diese vier Felder sind Bestandteil des bestätigten Codex-Standard-Merges;
  `command` und `args` bleiben trotzdem unverändert aus der Setup-Vorlage.
  Danach `codex mcp list`; Codex Desktop/CLI neu starten und `/mcp` prüfen.
- **Claude Code:** `claude mcp add --transport stdio --scope user ... --
  <command> <args...>` verwenden, danach `claude mcp list` und `/mcp`.
- **OpenCode:** zuerst `opencode mcp --help` lesen. Unterstützt die installierte
  Version den nichtinteraktiven `mcp add`-Befehl, ihn verwenden; sonst den
  tokenfreien Server in das bestehende lokale/global verwendete JSON-Schema
  mergen. Danach `opencode mcp list` beziehungsweise `opencode mcp ls`.

Direkt gesetzte `node`, `node.cmd`, `npx` oder Batch-Wrapper sind falsch. Der
Client muss die vom Wizard ausgegebene absolute `node.exe` und den dauerhaften
Bootstrap starten. Die bloße Existenz einer JSON-Datei beweist keine geladene
MCP-Verbindung.

## 5. Installation beweisen

Zuerst die produktseitige Prüfung ausführen:

```powershell
steuer-spar-erklaerung-setup --check
```

Beim expliziten Claude-Pfad:

```powershell
& (Join-Path $sseRuntimeRoot 'steuer-spar-erklaerung-setup.cmd') `
  --config $sseConfigPath --check
```

Beim Portable-Weg:

```powershell
.\sse-setup.cmd --check
```

Erfolg verlangt `ok: true`, die veröffentlichte Version, freigegebenes Profil,
API-Health, Discovery mit Operationszahl, passenden
Konfigurationsfingerprint, bereiten Workspace und `containsToken: false` für
die MCP-Vorlage. `clientVerificationRequired: true` bedeutet bewusst, dass
anschließend noch der tatsächliche Client geprüft werden muss. Der Agent meldet
dann präzise: **Technisches Setup bereit; Client-Verifikation nach Neustart
offen.** Er behauptet in der alten Session keinen erfolgreichen MCP-Toolaufruf.

Nach genau einem Neustart des lokalen Clients prüft der nächste Auftrag vor der
Facharbeit:

1. Serverliste zeigt `steuer-spar-erklaerung` als verbunden;
2. ein realer Aufruf des MCP-Tools `sse_health` liefert strukturiert `ok=true`;
3. keine Ausgabe enthält Token, Steuerwerte oder lokale Steuerdateipfade.

„Connected“, ein erfolgreicher Handshake oder nur die Serverliste ersetzen
den Tool-Aufruf nicht. Auch der direkte API-CLI-Aufruf `health` ist kein Ersatz
für dieses einmalige Client-Signal; im Codex-JSONL-Nachweis erscheint dafür ein
`mcp_tool_call` des Servers `steuer-spar-erklaerung`.

Erst diese drei Ebenen zusammen sind die abgeschlossene Client-Verifikation.
Der zweite kopierbare Prompt unten übernimmt sie automatisch und fährt bei
Erfolg mit der Fachprüfung fort; eine dritte Bestätigungsfrage ist nicht nötig.
Der Setup-Skill öffnet keinen Steuerfall. Der Hauptskill erzeugt vor jeder
UI-Navigation eine hashverifizierte Arbeitskopie und öffnet niemals den
Originalfall.

## Zwei kopierbare Prompts

### Prompt 1: installieren

```text
Richte SteuerSparErklärung vollständig lokal nach
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/skills/steuer-spar-erklaerung-setup/references/installation.md
ein. Installiere oder aktualisiere beide Skills und verwende das neueste
vollständige Release.
Standard-Setup ausführen: lokale API plus MCP.
```

`Standard-Setup ausführen` bestätigt den oben beschriebenen sicheren Plan
einschließlich Download, persistenter Installation und des bedingten
tokenfreien additiven MCP-Merges. Der Agent zeigt Plan und Diff weiterhin an,
fragt innerhalb dieser Grenzen aber nicht erneut. Bei Löschungen, weiteren
Servern, Token oder einem anderen Befehl stoppt er. Nach einer neuen oder
geänderten Skill-/MCP-Installation fordert er genau einen Client-Neustart an;
Prompt 2 übernimmt danach die reale Client-Verifikation.

### Prompt 2: Steuerfall nur lesend prüfen

```text
Nutze $steuer-spar-erklaerung und prüfe meine Einkommensteuererklärung 2025.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER>
Diese Pfade sind vollständig.
Standard-Prüflauf ausführen.
```

`Standard-Prüflauf ausführen` bestätigt bei vollständigen absoluten
Pfaden den sicheren Prüfvertrag des Hauptskills: hashverifizierte Kopie,
sichtbare rein lesende Navigation, Report sowie kein Speichern und kein ELSTER.
Der neu geladene Agent prüft zuvor bei konfiguriertem MCP Serverliste und den
echten Aufruf `sse_health` mit `ok=true`. Er fragt innerhalb dieses Vertrags
nicht erneut.

Die im Kalenderjahr 2026 abgegebene Einkommensteuererklärung betrifft in
diesem Release das unterstützte Steuerjahr 2025. Ein Einkommensteuerfall 2026
darf nicht durch bloße Umbenennung des Prompts als unterstützt behandelt
werden.
