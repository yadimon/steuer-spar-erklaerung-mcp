# Installation für Menschen und AI-Agenten

Diese Anleitung ist der kanonische Einrichtungsvertrag. Ein Mensch kann die
Befehle selbst ausführen; ein lokaler AI-Agent darf denselben Ablauf nach einem
kurzen Plan übernehmen.

Alles landet in **einem Ordner**. Danach ist jede Installation gleich
aufgebaut, egal wer sie gemacht hat.

Die Automation läuft immer auf dem Windows-PC. Sie wird nicht in Codex Cloud,
Claude Code on the web oder einem anderen Remote-Container eingerichtet.
Claude Cowork führt Code isoliert aus und ist deshalb kein Installer für die
host-lokale API- und MCP-Konfiguration. Als lokale Clients sind Codex, die
eigenständig angemeldete Claude Code CLI und OpenCode vorgesehen. OpenCode ist ein sekundärer, best-effort Client.

## Zielbild

```text
lokaler Agent -> Skill -> lokaler MCP-Server -> Loopback-API -> SteuerSparErklärung
                       \-> direkte API-CLI als Fallback
```

Die lokale API ist der Ausführungskern. Nur sie kennt `SSE.exe`, lokale Pfade,
Arbeitsbereich, Falldateien und UI Automation. MCP ist ein dünner, PC-blinder
Wrapper darüber. Unterstützt ein Client kein MCP, bleibt die mitgelieferte
API-CLI vollwertig.

So sieht der Ordner am Ende aus:

```text
C:\mein-steuer-ai\
  node_modules\            API und MCP
  config.json              Token, Port, Pfade
  mcp-client.config.json   fertiger tokenfreier MCP-Eintrag
  workspace\
    settings.md            Belegquellen und Regeln in Prosa
    tracking.md            Belegprotokoll
    documents\ results\ backups\
```

## Voraussetzungen

- Windows x64;
- eine installierte SteuerSparErklärung; freigegeben ist derzeit `2025` / Engine-Major `31`;
- **Node.js 22 oder neuer mit npm**;
- ein **lokal** laufender Agent mit Datei- und Programmzugriff;
- für sichtbare SSE-Bedienung eine entsperrte, unbenutzte Windows-Sitzung.

Nicht erforderlich sind Python, PowerShell 7 oder ein Repository-Checkout.
Windows PowerShell 5.1 gehört zu Windows und wird direkt aus dem Systemordner
gestartet.

Fehlt Node.js, installiere es **nicht ungefragt**. Nenne es als Voraussetzung
und lass den Menschen entscheiden; das ist eine Systemänderung, die keine
Prüfaufgabe rechtfertigt.

**Claude Code CLI unter Windows (nicht Cowork):** Führe die Installation aus
der eigenständig angemeldeten CLI oder einem lokalen Terminal aus. Claude
Cowork und eine in der Desktop-App eingebettete Binärdatei können Schreib-
zugriffe in das MSIX-Verzeichnis
`AppData\Local\Packages\Claude_*\LocalCache` virtualisieren; das ist keine PC-weite
Installation. Die native Windows-CLI setzt außerdem Git for Windows und eine
eigene Anmeldung in `claude` voraus — eine Anmeldung in Claude Desktop
authentifiziert sie nicht. Kopiere nie Binärdateien oder Anmeldedaten aus
`LocalCache` als Umgehung.

## 1. Ordner anlegen und Runtime installieren

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai

npm i @yadimon/steuer-spar-erklaerung-api
npm i @yadimon/steuer-spar-erklaerung-mcp
```

Meckert PowerShell über blockierte Skripte, `npm.cmd` statt `npm` verwenden;
ändere dafür nicht die systemweite Execution Policy.

Vor der Installation beide Registry-Versionen lesen — sie müssen gleich sein:

```powershell
npm view @yadimon/steuer-spar-erklaerung-api version
npm view @yadimon/steuer-spar-erklaerung-mcp version
```

## 2. Skill in den Ordner installieren

```powershell
npx -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent <codex|claude-code|opencode> --copy --yes
```

Ohne `--global` landet der Skill im
Ordner statt im Benutzerprofil. Danach den Agenten neu laden und prüfen, dass
der Skill lokal aufgelistet wird; eine Raw-Datei im Browser ist keine
installierte Skill-Version.

Ohne `npx skills` lädt der Agent das Repository-ZIP vom kanonischen Repository,
prüft Quelle und Commit und kopiert nur den vollständigen Ordner
`skills/steuer-spar-erklaerung` samt `references/`. Keine Spiegelquelle.

## 3. Einrichten

```powershell
.\node_modules\.bin\steuer-spar-erklaerung-setup.cmd --config C:\mein-steuer-ai\config.json --with-mcp
```

`--config` verlangt einen **absoluten** Pfad; der Pfad landet im MCP-Eintrag
und würde relativ brechen, sobald der Agent aus einem anderen Verzeichnis
startet. Ohne `--config` schreibt das Setup in den Standardort unter
`%LOCALAPPDATA%` — dann ist der Ordner nicht mehr eigenständig.

Das Setup erzeugt Token, findet `SSE.exe`, legt Arbeitsordner an und schreibt
die MCP-Mergevorlage. Weitere Schalter:

- `--defaults` für ein technisches Setup ohne Fall- und Belegbindung. Für
  OpenCode exakt `steuer-spar-erklaerung-setup --defaults --with-mcp`
  ausführen: den interaktiven Wizard dort nicht starten und
  niemals Antworten über `stdin` zuführen;
- `--plan-file <json>` für einen bereits bestätigten First-run-Plan;
- `--no-start` erzeugt Dateien, startet die API aber nicht;
- `--check` prüft ein bestehendes Setup ohne Änderung.

Das Setup nie über `npx` aus dem flüchtigen `_npx`-Cache starten: dessen Pfade
landen sonst in dauerhaften Startpunkten und zeigen später ins Leere.

Die erzeugte `mcp-client.config.json` enthält **kein Token**: Sie startet einen
lokalen Bootstrap, der das Token erst im Prozess aus `config.json` lädt.
`config.json` niemals öffnen, lesen oder parsen; die Datei und ihr Token
niemals in Chat, Log, Diff, Prozessargument oder einen eigenen `curl`-Aufruf
übernehmen. Authentifizierte Prüfungen ausschließlich über Setup-CLI,
API-CLI oder MCP.

## 4. MCP an den Client binden

Vor jeder Clientänderung den Dateipfad und einen tokenfreien Diff zeigen und
Zustimmung einholen. Eine im Auftrag bereits enthaltene bedingte Zustimmung
reicht, wenn der Diff ausschließlich den einen Server `steuer-spar-erklaerung`
additiv mergt und keine anderen Einträge löscht. Niemals die ganze Datei
ersetzen. `command` und `args` unverändert aus der Mergevorlage übernehmen.

- **Claude Code:** `claude mcp add --scope project steuer-spar-erklaerung --
  <command> <args...>` schreibt eine `.mcp.json` in den Ordner. Achtung: Der
  von npm erzeugte PowerShell-Shim `claude.ps1` verschluckt den `--`-Trenner;
  den Aufruf deshalb über `claude.cmd` oder Git Bash absetzen und mit
  `claude mcp list` beweisen.
- **Codex:** `codex mcp add steuer-spar-erklaerung -- <command> <args...>`.
  Codex kennt nur eine globale Konfiguration. Wer den Eintrag nur im Ordner
  aktiv haben will, setzt in `~/.codex/config.toml` `enabled = false` und
  startet im Ordner mit
  `codex -c mcp_servers.steuer-spar-erklaerung.enabled=true "…"`.

  Ergänze in derselben TOML-Tabelle `required`, `startup_timeout_sec`,
  `tool_timeout_sec` und `enabled_tools` mit einer begrenzten Kernliste.
  Aktuelle Codex-Versionen blenden einen großen unbeschränkten MCP-Katalog
  sonst vollständig aus dem Modellkontext aus. Die Kernliste deckt den
  Standard-Prüflauf ab; alle übrigen Operationen bleiben über die API-CLI
  erreichbar.

  ```toml
  required = true
  startup_timeout_sec = 30
  tool_timeout_sec = 300
  enabled_tools = [
    "sse_health", "sse_capabilities", "sse_product_info",
    "sse_workspace_status", "sse_workspace_files",
    "sse_workspace_read_text", "sse_workspace_write_text",
    "sse_list_cases", "sse_case_hash", "sse_make_working_copy",
    "sse_launch", "sse_windows", "sse_instances", "sse_dialog_list",
    "sse_dialog_answer", "sse_warning_popup_read", "sse_page",
    "sse_page_state", "sse_page_objects", "sse_ui_state", "sse_collect",
    "sse_goto", "sse_checker_results", "sse_checker_run", "sse_checker_open",
    "sse_checker_close", "sse_screenshot", "sse_subpages",
    "sse_table_read", "sse_find", "sse_positions", "sse_click",
    "sse_click_point", "sse_read_full", "sse_result_details", "sse_close"
  ]
  ```

Direkt gesetzte `node`, `node.cmd`, `npx` oder Batch-Wrapper sind falsch. Der
Client muss die absolute `node.exe` und den Bootstrap aus der Vorlage starten.
Die bloße Existenz einer JSON-Datei beweist keine geladene MCP-Verbindung.

## 5. Installation beweisen

```powershell
.\node_modules\.bin\steuer-spar-erklaerung-setup.cmd --config C:\mein-steuer-ai\config.json --check
```

Erfolg verlangt `ok=true`, das erwartete Produktprofil, einen bereiten
Workspace und `containsToken: false`. Ein nicht laufendes SSE mit
`running=false` ist für den technischen Test zulässig.

Nach einer neuen oder geänderten Skill-/MCP-Installation kann die laufende
Agentensession den Server nicht als echtes Tool beweisen. Beende den Lauf mit
**„Technisches Setup bereit; Client-Verifikation nach Neustart offen."** und
fordere genau einen Clientneustart an; Prompt 2 übernimmt danach die reale
Verifikation. Behaupte in der alten Sitzung weder `connected` noch einen
erfolgreichen Tool-Aufruf.

Der neu geladene Client prüft zuerst die Serverliste und ruft dann das echte
MCP-Tools `sse_health` als `mcp_tool_call` auf. Erfolg verlangt das
strukturierte Resultat mit `ok=true`; ein Servereintrag, Status „connected"
oder ein erfolgreicher Handshake genügt nicht. Ein direkter
API-CLI-Aufruf `health` ist kein Ersatz — er beweist die API, nicht MCP.

## 6. Belegquellen festlegen

`workspace\settings.md` ist der Ort für Regeln, die eine Pfadliste nicht
ausdrücken kann — der Hauptskill liest sie bei jedem Lauf:

```text
## Quellen
- <ABSOLUTER_ORDNER>\Rechnungen — vollständig
- <ABSOLUTER_ORDNER>\Scans — nur Unterordner 2025, "Privat" nicht lesen
- <ABSOLUTER_ORDNER>\Bank — nur Kontoauszüge, für den Zahlungsabgleich
```

Die harte Grenze bleibt `config.json`: Was dort nicht als Quelle steht, liest
die API gar nicht. `settings.md` verfeinert innerhalb des Erlaubten und kann
nichts zusätzlich freischalten.

## Kopierbare Prompts

### Ein Prompt: installieren und prüfen

```text
Nutze https://github.com/yadimon/steuer-spar-erklaerung-mcp
Prüfe meine Einkommensteuer 2025.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER_ODER_KEINE_BELEGE>
Standard-Einrichtung und Prüflauf ausführen.
```

`Standard-Einrichtung und Prüflauf ausführen` steht für beides zugleich:
`Standard-Setup ausführen` mit dem Transport „lokale API plus MCP" und
`Standard-Prüflauf ausführen`. Letzteres bestätigt den sicheren Prüfvertrag
des Hauptskills: hashverifizierte Kopie, sichtbare rein lesende Navigation,
Report sowie kein Speichern und kein ELSTER. Es bestätigt den oben beschriebenen sicheren
Plan einschließlich Download, Installation in den Ordner und des bedingten
tokenfreien additiven MCP-Merges. Der Agent zeigt Plan und Diff weiterhin an,
fragt innerhalb dieser Grenzen aber nicht erneut. Bei Löschungen, weiteren
Servern, Token oder einem anderen Befehl stoppt er.

Weil MCP-Werkzeuge erst nach einem Clientneustart geladen werden, läuft die
Prüfung in derselben Sitzung über die lokale API-CLI; die MCP-Verifikation
holt der nächste Start nach. Fehlen absolute Pfade, gilt die Formel nur für
das Setup, und der Hauptskill stellt seine beiden fachlichen Fragen.

### Nur installieren

```text
Richte SteuerSparErklärung vollständig lokal nach
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md
ein. Installiere oder aktualisiere den Skill und verwende die neueste
veröffentlichte Version.
Standard-Setup ausführen: lokale API plus MCP.
```

### Nur prüfen, wenn schon eingerichtet

```text
Nutze $steuer-spar-erklaerung und prüfe meine Einkommensteuererklärung 2025.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER>
Standard-Prüflauf ausführen.
```

## Stopps

Stoppe bei inkompatiblem System, unbekannter Releasequelle, unfreigegebenem
Profil, fehlender Zustimmung, uneindeutiger Agenten-Konfiguration oder nicht
erreichbarer API nach einem Erstversuch und höchstens zwei Wiederholungen im
Abstand von je zwei Sekunden.

Lehnt `--plan-file` eine vorhandene Bindung ab, arbeite nicht darum herum:
`config.json`, `setup-decisions.json`, Runtime-Dateien und Prozesse weder
manuell ändern noch beenden. Melde den Fehler als sicheren Stopp.

Es gibt genau einen zugelassenen Reparaturweg, und er ändert keine Datei von
Hand: Stammt die Konfiguration aus einem NPX-Foreground-Start, ist sie
unvollständig statt kaputt. `--check` meldet das als `ok=false` mit
`kind="foreground-only-config"`. Dann zuerst die laufende Foreground-API vom
Nutzer mit Strg+C beenden lassen und danach `--defaults` ausführen; das Token
bleibt erhalten. Läuft die Foreground-API noch, lehnt sie die Neubindung mit
HTTP 409 ab — erwartetes Verhalten, kein Grund für manuelle Eingriffe.

Berichte konkrete Datei, letzten gelesenen Zustand, erzeugte Dateien und genau
eine nächste sichere Aktion. Lösche Konfigurationen niemals ungefragt.

## FAQ

**Systemweit statt im Ordner?** Geht mit `npm i --global` und `--global` beim
Skill-Installer. Dann gilt dieselbe Anleitung, nur ohne Ordnerbindung; eine
eigene Anweisung dafür gibt es nicht.

**Codex vollständig isolieren?** `CODEX_HOME=C:\mein-steuer-ai\.codex` gibt
Codex eine eigene Konfiguration im Ordner. Kostet aber eine eigene Anmeldung,
weil `auth.json` ebenfalls im CODEX_HOME liegt. Anmeldedaten nicht kopieren.

**Mehrere Ordner?** Möglich; jeder braucht eine eigene `config.json` mit
eigenem Port. Es läuft trotzdem immer nur eine Operation je API.

**Kein Node.js?** Dann ist dieses Produkt derzeit nicht installierbar. Node.js
wird nicht eigens dafür installiert; das entscheidet der Mensch.
