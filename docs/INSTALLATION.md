# Installation für Menschen und AI-Agenten

Diese Anleitung ist der kanonische Einrichtungsvertrag. Ein Mensch kann die
Befehle selbst ausführen; ein lokaler AI-Agent darf denselben Ablauf nach einem
kurzen Plan übernehmen.

Es gibt **kein Setup-Programm**. Installieren heißt: zwei npm-Pakete und einen
Skill in einen Ordner legen, die API starten, den MCP-Server beim Client
anmelden.

## Die ganze Installation

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai

npm i @yadimon/steuer-spar-erklaerung-api
npm i @yadimon/steuer-spar-erklaerung-mcp

npx -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent codex --copy --yes

codex mcp add steuer-spar-erklaerung -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js

.\node_modules\.bin\steuer-spar-erklaerung-api.cmd --config C:\mein-steuer-ai\config.json
```

Der letzte Befehl bleibt im Vordergrund; das Terminal offen lassen. Danach den
Client einmal neu starten, damit er den MCP-Server lädt.

Für Claude Code statt Codex `--agent claude-code` und
`claude mcp add --scope project steuer-spar-erklaerung -- <node.exe> <derselbe index.js>`.

Der Rest dieser Seite erklärt jeden Schritt, die Fallen und die Grenzen. Wer
nur prüfen lassen will, springt zu [Kopierbare Prompts](#kopierbare-prompts).

## Wo das läuft

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
  .claude\skills\          der Skill bei --agent claude-code
  .agents\skills\          der Skill bei --agent codex
  skills-lock.json         welche Skillversion installiert ist
  .mcp.json                der MCP-Eintrag bei claude mcp add --scope project
  logs\                    API-Protokoll
  workspace\
    settings.md            Belegquellen und Regeln in Prosa
    tracking.md            Belegprotokoll
    documents\ results\ backups\
```

Eine `config.json` ist **optional**. Ohne sie gelten die Standardwerte:
Loopback `127.0.0.1`, Port `43127`, Profil `2025`, Arbeitsbereich neben dem mit
`--config` benannten Pfad. Nötig wird die Datei erst für einen abweichenden
Port, ein festgepinntes `sseExecutable` oder einen festen `caseDir`.

## Es gibt kein Token

Die API kennt keine Anmeldung. Sie lauscht nur auf Loopback, und jeder lokale
Prozess darf sie aufrufen — das ist dieselbe Vertrauensgrenze, in der auch die
Steuersoftware selbst läuft.

Wovor sie sich schützt, ist der eine Weg von außen: eine beliebige Webseite im
Browser des Nutzers erreicht `127.0.0.1` genauso. Deshalb weist die API jede
Anfrage mit **403** ab, die eine `Origin`- oder `Sec-Fetch-Site`-Kopfzeile
trägt oder deren `Host` kein Loopback-Name ist. Ein Browser sendet mindestens
eine davon zwingend und kann sie nicht fälschen; die letzte Regel schlägt
DNS-Rebinding. Ein lokaler Klient sendet keine davon.

Es gibt also nichts zu erzeugen, nichts zu speichern und nichts geheimzuhalten.
Ältere Betas schrieben ein `token` in die Konfiguration; steht es noch da,
nennt die API die Zeile beim Start und du löschst sie.

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

## 3. API starten

```powershell
.\node_modules\.bin\steuer-spar-erklaerung-api.cmd --config C:\mein-steuer-ai\config.json
```

Das ist der ganze Einrichtungsschritt. Beim ersten Start legt die API
`workspace\` mit `documents\`, `results\`, `backups\` sowie `logs\` an und ist
sofort erreichbar. Die Datei `config.json` muss dabei **nicht existieren** —
`--config` benennt nur, wo der Ordner liegt, und verlangt einen **absoluten**
Pfad. Ohne `--config` liegt der Arbeitsbereich unter `%LOCALAPPDATA%`, und der
Ordner wäre nicht mehr eigenständig.

Das Terminal bleibt offen; Strg+C beendet die API. Für einen bestimmten
Steuerfall zusätzlich `--case-dir <absoluter Ordner>` anhängen.

Die API nie über `npx` aus dem flüchtigen `_npx`-Cache dauerhaft anmelden:
dessen Pfade landen sonst in Startpunkten und zeigen später ins Leere.

## 4. MCP an den Client binden

Der MCP-Eintrag besteht aus der absoluten `node.exe` und dem absoluten Pfad zu
`dist/index.js` des MCP-Pakets — ohne weitere Argumente und ohne
Umgebungsvariablen. Der Wrapper findet die API über den Standardport.

**Nicht den `.cmd`-Shim aus `node_modules\.bin` eintragen.** Seit Node 20
verweigert `spawn` das Starten von `.cmd`- und `.bat`-Dateien ohne Shell
(Absicherung gegen CVE-2024-27980); ein MCP-Client bekommt dabei nur `EINVAL`
und meldet den Server als nicht startbar. Gemessen: über den Shim scheitert
der Start, über `node` plus `index.js` antwortet der Server normal. Aus
demselben Grund gehören auch `npx` und andere Wrapper nicht in den Eintrag.
Den Pfad der Laufzeit liefert `(Get-Command node).Source`.

Vor jeder Clientänderung den Dateipfad und einen Diff zeigen und Zustimmung
einholen. Eine im Auftrag bereits enthaltene bedingte Zustimmung reicht, wenn
der Diff ausschließlich den einen Server `steuer-spar-erklaerung` additiv
mergt und keine anderen Einträge löscht. Niemals die ganze Datei ersetzen.

- **Claude Code:**

  ```powershell
  claude mcp add --scope project steuer-spar-erklaerung -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js
  ```

  Das schreibt eine `.mcp.json` in den Ordner. Achtung: Der von npm erzeugte
  PowerShell-Shim `claude.ps1` verschluckt den `--`-Trenner; den Aufruf deshalb
  über `claude.cmd` oder Git Bash absetzen und mit `claude mcp list` beweisen.

- **Codex:**

  ```powershell
  codex mcp add steuer-spar-erklaerung -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js
  ```

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
    "sse_checker_close", "sse_screenshot", "sse_snapshot", "sse_subpages",
    "sse_table_read", "sse_find", "sse_positions", "sse_click",
    "sse_click_point", "sse_read_full", "sse_result_details",
    "sse_menu", "sse_menu_click", "sse_receipt_manager_action",
    "sse_receipt_manager_list", "sse_receipt_manager_read",
    "sse_receipt_manager_update", "sse_receipt_manager_import",
    "sse_receipt_manager_classification_options",
    "sse_receipt_manager_classify", "sse_receipt_manager_bulk_upsert",
    "sse_receipt_manager_link", "sse_receipt_manager_delete",
    "sse_window_close", "sse_close"
  ]
  ```

Die bloße Existenz einer JSON-Datei beweist keine geladene MCP-Verbindung.

## 5. Installation beweisen

Solange die API läuft, beweist ein Aufruf sie sofort:

```powershell
.\node_modules\.bin\steuer-spar-erklaerung-call.cmd health
```

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

Die harte Grenze bleibt die Ressourcentopologie der API: Was nicht als Quelle
freigegeben ist, liest die API gar nicht. `settings.md` verfeinert innerhalb
des Erlaubten und kann nichts zusätzlich freischalten.

## Die API selbst dokumentiert sich

Die laufende API beschreibt ihren eigenen Vertrag. Daraus lassen sich Klienten
generieren; eine gepflegte Zweitbeschreibung gibt es bewusst nicht.

```powershell
curl.exe http://127.0.0.1:43127/v1/openapi.json      # OpenAPI 3.1, alle Operationen
curl.exe http://127.0.0.1:43127/v1/operations        # Argument- und Ergebnisschemata
curl.exe http://127.0.0.1:43127/healthz              # Lebendigkeit und laufende Operation
```

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
additiven MCP-Merges. Der Agent zeigt Plan und Diff weiterhin an,
fragt innerhalb dieser Grenzen aber nicht erneut. Bei Löschungen, weiteren
Servern oder einem anderen Befehl stoppt er.

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

Meldet der Start `Es laeuft bereits eine SSE-API`, läuft eine zweite Instanz
auf demselben Port — vielleicht mit anderem Arbeitsbereich. Nicht fortfahren
und nicht auf gut Glück beenden: erst klären, welche Instanz gemeint ist.

Konfigurationen niemals ungefragt löschen. Berichte konkrete Datei, letzten
gelesenen Zustand, erzeugte Dateien und genau eine nächste sichere Aktion.

## FAQ

**Systemweit statt im Ordner?** Geht mit `npm i --global` und `--global` beim
Skill-Installer. Dann gilt dieselbe Anleitung, nur ohne Ordnerbindung; eine
eigene Anweisung dafür gibt es nicht.

**Codex vollständig isolieren?** `CODEX_HOME=C:\mein-steuer-ai\.codex` gibt
Codex eine eigene Konfiguration im Ordner. Kostet aber eine eigene Anmeldung,
weil `auth.json` ebenfalls im CODEX_HOME liegt. Anmeldedaten nicht kopieren.

**Mehrere Ordner?** Möglich; jeder braucht eine eigene `config.json` mit
eigenem Port und ein passendes `SSE_API_URL` im MCP-Eintrag. Es läuft trotzdem
immer nur eine Operation je API.

**Kein Node.js?** Dann ist dieses Produkt derzeit nicht installierbar. Node.js
wird nicht eigens dafür installiert; das entscheidet der Mensch.
