# Installation für Menschen und AI-Agenten

Diese Seite beschreibt den einen projektlokalen Runtime-Weg. Das MCP-Paket
bringt die exakt passende API als normale npm-Dependency mit und startet sie
bei Bedarf. Plugin, globales MCP, `AGENTS.md`, `CLAUDE.md` und ein dauerhaft
offenes API-Terminal sind nicht erforderlich.

## Voraussetzungen

- Windows x64;
- Node.js 22 oder neuer mit npm;
- installierte SteuerSparErklärung 2025;
- ein lokal laufender Client: Codex, Claude Code oder best effort OpenCode.

Codex Cloud, Claude im Browser und andere entfernte Sandboxes können eine
Windows-Anwendung auf dem Host nicht bedienen. Claude Code unter Windows
benötigt zusätzlich Git for Windows und eine eigene Anmeldung. Anmeldedaten
werden nicht zwischen Clients oder aus dem Host in eine VM kopiert.

Die Beispiele verwenden `npm.cmd` und `npx.cmd`, damit PowerShell keine
Änderung der Execution Policy verlangt.

## Ich nix ITler

Diesen Prompt in einem lokal laufenden Agenten einfügen:

```text
Richte SteuerSparErklärung API/MCP und optional den Skill vollständig lokal im
Ordner C:\mein-steuer-ai ein. Folge dabei genau dieser Anleitung:
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md

Erkenne meinen lokalen Client und ändere nur dessen Projektkonfiguration in
diesem Ordner. Installiere die API nicht separat; sie muss als exakt passende
Dependency des MCP-Pakets kommen. Setze SSE_API_CONFIG auf
C:\mein-steuer-ai\config.json. Vorhandene Konfiguration nur additiv mergen,
nichts global installieren und keine Anmeldedaten kopieren. Führe danach
--selftest aus und sage mir klar, ob ich den Client neu starten muss.
```

Der Agent darf innerhalb dieses Auftrags den Ordner anlegen, das veröffentlichte
npm-Paket laden und die gewählte Projektkonfiguration additiv ergänzen. Er darf
keine vorhandene Konfigurationsdatei ersetzen. Vor weiteren Systemänderungen,
globalen Installationen oder einem zweiten Server muss er stoppen.

Nach der Installation den Client einmal neu starten. Dann zum Beispiel:

```text
Nutze das konfigurierte SteuerSparErklärung-MCP und prüfe meine
Einkommensteuererklärung 2025. Falls der optionale Skill installiert ist,
verwende zusätzlich $steuer-spar-erklaerung als Wizard.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER_ODER_KEINE_BELEGE>
Beginne mit sse_preflight. Speichere nichts und sende nichts über ELSTER.
```

## Ich bin ITler

### 1. Paket und optionalen Skill lokal installieren

```powershell
$Root = 'C:\mein-steuer-ai'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Set-Location $Root

npm.cmd init -y
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest

$Node = (Get-Command node).Source
$Mcp = Join-Path $Root 'node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js'
$ApiConfig = Join-Path $Root 'config.json'
```

npm installiert unter `node_modules\@yadimon` sowohl MCP als auch dessen
exakte API-Dependency. Es gibt kein `postinstall` und keine Installation zur
Laufzeit.

Der MCP funktioniert ohne Skill. Der Skill ist der bequemere Wizard für
längere Steuerfall- und Belegabläufe. Genau den verwendeten Client wählen:

```powershell
$SkillAgent = 'codex' # Fuer Claude Code: claude-code; fuer OpenCode: opencode
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent $SkillAgent --copy --yes
```

Ohne `--global` schreibt die [`skills`-CLI](https://www.skills.sh/docs/cli)
projektlokal nach `.agents\skills` beziehungsweise `.claude\skills` und legt
`skills-lock.json` daneben an.

### 2. Genau einen Client projektlokal anbinden

#### Codex projektlokal

Codex unterstützt in einem als vertrauenswürdig bestätigten Projekt
`.codex/config.toml`. `codex mcp add` schreibt dagegen in die
Benutzerkonfiguration und ist für diesen isolierten Weg nicht nötig.

Der folgende Block legt die Datei nur dann neu an. Ist sie schon vorhanden,
den gezeigten Serverblock additiv mergen; das Skript überschreibt sie nicht:

```powershell
$CodexDir = Join-Path $Root '.codex'
$CodexConfig = Join-Path $CodexDir 'config.toml'
New-Item -ItemType Directory -Force -Path $CodexDir | Out-Null

if ($Node.Contains("'") -or $Mcp.Contains("'") -or $ApiConfig.Contains("'")) {
  throw 'Ein Pfad mit einfachem Anführungszeichen muss manuell als TOML escaped werden.'
}

if (Test-Path -LiteralPath $CodexConfig) {
  throw "Vorhandene Datei additiv mergen, nicht überschreiben: $CodexConfig"
}

@"
[mcp_servers.steuer-spar-erklaerung]
command = '$Node'
args = ['$Mcp']
required = true
startup_timeout_sec = 30
tool_timeout_sec = 300

[mcp_servers.steuer-spar-erklaerung.env]
SSE_API_CONFIG = '$ApiConfig'
"@ | Set-Content -LiteralPath $CodexConfig -Encoding utf8
```

Öffne danach `C:\mein-steuer-ai` in Codex und bestätige das Projekt als
vertrauenswürdig. Codex Desktop, CLI und IDE-Erweiterung verwenden auf
demselben Host dieselbe Codex-Konfigurationslogik.

#### Claude Code projektlokal

Aus `C:\mein-steuer-ai`:

```powershell
$Claude = Get-Command -Name 'claude.exe','claude.cmd' -CommandType Application `
  -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $Claude) { throw 'Claude Code CLI wurde nicht gefunden.' }

& $Claude mcp add --transport stdio --scope project `
  steuer-spar-erklaerung `
  --env "SSE_API_CONFIG=$ApiConfig" -- $Node $Mcp

& $Claude mcp get steuer-spar-erklaerung
```

`--scope project` schreibt den Server nach `.mcp.json`. Dies ist eine Anleitung für die eigenständig
angemeldete Claude Code CLI, nicht für Claude im Browser oder einen
cloud-only Cowork-Lauf.

#### OpenCode projektlokal

OpenCode verwendet im hier best-effort unterstützten stabilen
Konfigurationsschema `opencode.json`. Bei vorhandener Datei den folgenden
Server **additiv** unter `mcp` mergen, nicht die Datei ersetzen. Für eine
abweichende V2-/Preview-Syntax zuerst die zum installierten Client gehörende
Dokumentation prüfen:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "steuer-spar-erklaerung": {
      "type": "local",
      "command": [
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\mein-steuer-ai\\node_modules\\@yadimon\\steuer-spar-erklaerung-mcp\\dist\\index.js"
      ],
      "environment": {
        "SSE_API_CONFIG": "C:\\mein-steuer-ai\\config.json"
      },
      "enabled": true,
      "timeout": 300000
    }
  }
}
```

Den Node-Pfad an die Ausgabe von `(Get-Command node).Source` anpassen. Danach
`opencode mcp list` aus dem Projektordner ausführen.

### 3. Installation beweisen

Zuerst Paketauflösung und technischer MCP-/API-Start:

```powershell
npm.cmd ls @yadimon/steuer-spar-erklaerung-mcp @yadimon/steuer-spar-erklaerung-api
& $Node $Mcp --selftest
```

Erfolg verlangt:

- beide Pakete haben exakt dieselbe Releaseversion;
- `--selftest` endet mit Exitcode 0 und strukturiertem `ok=true`;
- stdout enthält beim normalen MCP-Start ausschließlich das MCP-stdio-Protokoll;
- es erscheint kein separates API-Konsolenfenster.

Danach den Client einmal neu starten und dort das echte MCP-Tool
`sse_preflight` aufrufen. Der Preflight liest nacheinander Arbeitsbereich,
Produktprofil und Laufzeit. Ein Servereintrag, `connected`, Handshake oder
direkter API-CLI-Aufruf `health` ist kein Ersatz für diesen Tool-Aufruf.

Ein gestopptes SteuerSparErklärung ist ein verständlicher Runtime-Blocker und
kein kaputtes npm-Setup. Ein grüner Preflight benötigt zusätzlich die passende
installierte Anwendung und eine gesunde laufende Instanz.

## Wo liegen die Daten?

Mit dem oben gesetzten absoluten `SSE_API_CONFIG`:

```text
C:\mein-steuer-ai\
  package.json
  node_modules\              MCP und exakte API-Dependency
  .codex\config.toml         nur Codex
  .mcp.json                  nur Claude Code
  opencode.json              nur OpenCode
  .agents\skills\           optionaler Codex-/OpenCode-Skill
  .claude\skills\           optionaler Claude-Skill
  config.json                darf beim ersten Start noch fehlen
  workspace\
    documents\
    results\
    backups\
```

Fehlt `SSE_API_CONFIG`, verwendet die automatisch gestartete API ihren sicheren
Standard unter `%LOCALAPPDATA%\SteuerSparErklaerungApi`. Der Paketordner und
der API-Arbeitsbereich sind zwei getrennte Dinge.

`SSE_API_URL` ist nur für eine bewusst separat verwaltete Loopback-API. Die URL
bleibt autoritativ; ist sie nicht erreichbar, startet MCP nicht still auf dem
Standardport. `SSE_API_URL` und `SSE_API_CONFIG` dürfen nicht gleichzeitig
gesetzt sein.

## Update

Im Installationsordner:

```powershell
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest
& $Node $Mcp --selftest
```

Nur wenn der optionale Skill verwendet wird, ihn ebenfalls aktualisieren:

```powershell
$SkillAgent = 'codex' # Fuer Claude Code: claude-code; fuer OpenCode: opencode
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent $SkillAgent --copy --yes
```

npm ersetzt die API-Dependency automatisch durch die exakt zum neuen MCP
passende Version. Anschließend den Client neu starten und `sse_preflight`
aufrufen.

## Deinstallation

Im Projektordner `npm.cmd uninstall @yadimon/steuer-spar-erklaerung-mcp`
ausführen und nur den eigenen Serverblock aus `.codex/config.toml`, `.mcp.json`
oder `opencode.json` entfernen. Skillordner und `skills-lock.json` nur über die
verwendete Skills-CLI oder nach genauer Prüfung der Einträge entfernen.

Den Projektordner nicht pauschal löschen: `workspace`, Belege, Reports und
Backups können Nutzerdaten enthalten.

## API-Singleton bewusst beenden

Die vom MCP gestartete API darf nach dem Ende eines Clients weiterlaufen. Das
beschleunigt den nächsten Start. Niemals `node`, `SSE` oder andere Prozesse
anhand eines bloßen Namens beenden.

Zum bewussten Stopp zuerst `/healthz` lesen und Paketname, exakte
Releaseversion sowie `processId` prüfen. Dann genau diesen PID über
`Get-CimInstance Win32_Process` verifizieren: Die Kommandozeile muss auf das
installierte `@yadimon\steuer-spar-erklaerung-api\dist\api-main.js` zeigen.
Nur dann:

```powershell
Stop-Process -Id <VERIFIZIERTE_PROCESS_ID>
```

Bei fehlender oder widersprüchlicher Identität nicht beenden.

## Direkte API-Nutzung (separat)

Für eigene HTTP-/CLI-Clients bleibt die API separat installierbar. Die kurze
Installations- und Startanleitung sowie die genaue `--case-dir`-/`--config`-
Semantik stehen im [API-Paket-README](../packages/api/README.md). Das ist kein
dritter MCP-Installationsweg. Beispielauftrag an einen lokalen Agenten:

```text
Nutze die direkte SteuerSparErklärung-API aus C:\mein-steuer-api. Prüfe zuerst
discovery, workspace_status, product_info und health. Füge danach die Rechnung
<DATEI> nur dem ausdrücklich geöffneten freiberuflichen Steuerfall hinzu,
lies das Ergebnis zurück, speichere nicht und sende nichts über ELSTER.
```

## Fehlerbehebung

- **`sse_preflight` fehlt:** Client nach der Projektkonfiguration neu starten
  und prüfen, ob wirklich der gewählte Projektordner geöffnet ist.
- **MCP startet nicht:** absoluten `node.exe`- und `dist\index.js`-Pfad prüfen.
  Nicht den `.cmd`-Shim als dauerhaftes stdio-Programm konfigurieren.
- **Port belegt oder Version falsch:** fremde, alte oder nicht eindeutig
  identifizierbare API niemals beenden, ersetzen oder übergehen. Der
  fail-closed Startfehler ist beabsichtigt.
- **Explizite URL unerreichbar:** `SSE_API_URL` korrigieren oder bewusst aus der
  Projektkonfiguration entfernen. Es gibt keinen stillen Fallback.
- **Arbeitsdaten landen unter `%LOCALAPPDATA%`:** prüfen, ob der Client den
  absoluten `SSE_API_CONFIG`-Wert wirklich an den MCP-Prozess übergibt.
- **Claude startet einen `.ps1`-Shim nicht:** die dokumentierten `npm.cmd` und
  `npx.cmd` sowie den über `Get-Command` ermittelten `claude.exe`- oder
  `claude.cmd`-Einstieg verwenden; dafür ist keine Änderung der Execution
  Policy nötig.

Die API selbst dokumentiert sich nach dem Start über `/v1/openapi.json`,
`/v1/operations` und `describe`. Sicherheitsgrenzen und Fehlerarten stehen im
[API-/MCP-Vertrag](API-MCP-VERTRAG.md).
