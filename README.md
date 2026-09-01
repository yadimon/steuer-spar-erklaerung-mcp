# Inoffizielle API und MCP für SteuerSparErklärung

[![Windows CI](https://github.com/yadimon/steuer-spar-erklaerung-mcp/actions/workflows/windows-ci.yml/badge.svg)](https://github.com/yadimon/steuer-spar-erklaerung-mcp/actions/workflows/windows-ci.yml)

Steuerfälle mit einem lokalen KI-Agenten prüfen, mit Belegen abgleichen und
nach Freigabe kontrolliert bearbeiten – über eine lokale API und einen
PC-blinden MCP-Server.

> **Öffentliche Beta für Windows x64.** Ergebnisse selbst prüfen und den
> aktuellen Dateistand vor der ersten Änderung privat sichern. Das Projekt ist
> keine Steuerberatung und übermittelt nichts an das Finanzamt.

## Was kann es?

- SteuerSparErklärung 2025 lesen, navigieren und mit dem Programm-Prüfer
  auswerten;
- Belege mit einem geöffneten Steuerfall abgleichen;
- freigegebene Felder und Tabellen gebunden ändern und sofort zurücklesen;
- Umsatzsteuer-Voranmeldungen vorbereiten, ohne sie zu übermitteln;
- den aktuellen Dateistand kontrolliert ändern, ohne automatisch zu speichern;
- 99 versionierte API-Operationen plus den MCP-Preflight `sse_preflight`
  bereitstellen.

Profil 2025 / Engine 31 ist freigegeben. Profil 2024 bleibt experimentell und
auf Verifikation begrenzt. `GewErfass2026` ist derzeit ausschließlich für den
belegten Leseweg freigegeben. Im BelegManager ist nur die focusless Leseliste
allgemein aktiv; die neun Vordergrundwege bleiben für API-CLI und MCP
gleichermaßen fail-closed gesperrt.

## Voraussetzungen und harte Grenzen

- Windows x64, Node.js 22 oder neuer mit npm;
- installierte SteuerSparErklärung 2025;
- Codex, Claude Code oder – best effort – OpenCode lokal auf demselben PC;
- für sichtbare Bedienung eine entsperrte, unbenutzte Windows-Sitzung.

Es gibt keinen ELSTER-Versand, kein automatisches Speichern und keine
ungebundene Steuerfallbearbeitung. Ein bereits eindeutig geöffneter Fall bleibt
der Arbeitsfall. Save As, Schließen, Verwerfen oder eine Arbeitskopie sind
keine impliziten Sicherheitsmaßnahmen.

Das MCP-Paket installiert die exakt passende API als normale npm-Dependency
und startet sie bei Bedarf unsichtbar. Eine bereits laufende kompatible API
wird wiederverwendet. Ein separates API-Terminal ist im Standardweg nicht
nötig.

## Installation

Es gibt zwei Wege. Weder Plugin noch `AGENTS.md` oder `CLAUDE.md` sind nötig.
Der Skill ist eine optionale Komfortschicht; MCP enthält Preflight und harte
Server-Instruktionen bereits selbst.

### Ich nix ITler

Diesen Prompt in einem **lokal laufenden** Codex, Claude Code oder OpenCode
einfügen:

```text
Richte SteuerSparErklärung API/MCP und optional den Skill vollständig lokal im
Ordner C:\mein-steuer-ai ein. Folge dabei genau dieser Anleitung:
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md

Erkenne meinen lokalen Client und ändere nur dessen Projektkonfiguration in
diesem Ordner. Installiere die API nicht separat; sie muss als exakt passende
Dependency des MCP-Pakets kommen. Setze SSE_API_CONFIG auf
C:\mein-steuer-ai\config.json. Vorhandene Konfiguration nur additiv mergen,
nichts global installieren und keine Anmeldedaten kopieren. Führe danach
--selftest mit genau diesem gesetzten SSE_API_CONFIG aus und sage mir klar, ob
ich den Client neu starten muss.
```

Nach dem verlangten Neustart zum Beispiel:

```text
Nutze das konfigurierte SteuerSparErklärung-MCP und prüfe meine
Einkommensteuererklärung 2025. Falls der optionale Skill installiert ist,
verwende zusätzlich $steuer-spar-erklaerung als Wizard.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER_ODER_KEINE_BELEGE>
Beginne mit sse_preflight. Speichere nichts und sende nichts über ELSTER.
```

### Ich bin ITler

Der gemeinsame projektlokale Teil in PowerShell:

```powershell
$Root = 'C:\mein-steuer-ai'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Set-Location $Root

npm.cmd init -y
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest

$Node = (Get-Command node).Source
$Mcp = Join-Path $Root 'node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js'
$ApiConfig = Join-Path $Root 'config.json'
$env:SSE_API_CONFIG = $ApiConfig
```

npm legt MCP und API beide unter `C:\mein-steuer-ai\node_modules\@yadimon`
ab. Arbeitsdaten liegen durch `SSE_API_CONFIG` ebenfalls im gewählten Ordner.
Ohne diese Variable verwendet die API ihren sicheren Standard unter
`%LOCALAPPDATA%`.
Die Zuweisung an `$env:SSE_API_CONFIG` gilt nur für die aktuelle
PowerShell-Sitzung und sorgt dafür, dass auch der Selftest denselben
Projekt-Singleton wie der Client prüft.

Der Skill ist optional. Genau einen Client einsetzen:

```powershell
$SkillAgent = 'codex' # Fuer Claude Code: claude-code; fuer OpenCode: opencode
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent $SkillAgent --copy --yes
```

Die [`skills`-CLI](https://www.skills.sh/docs/cli) schreibt ohne `--global` in
das aktuelle Projekt.

#### Codex

Codex liest in einem vertrauenswürdigen Projekt `.codex/config.toml`. Der
globale Befehl `codex mcp add` ist dafür nicht nötig. Die fertige additive
Konfiguration steht in der
[Installationsanleitung](docs/INSTALLATION.md#codex-projektlokal).

#### Claude Code

Aus `C:\mein-steuer-ai`:

```powershell
$Claude = Get-Command -Name 'claude.exe','claude.cmd' -CommandType Application `
  -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $Claude) { throw 'Claude Code CLI wurde nicht gefunden.' }

& $Claude mcp add --transport stdio --scope project `
  steuer-spar-erklaerung `
  --env "SSE_API_CONFIG=$ApiConfig" -- $Node $Mcp
```

Das erzeugt den projektlokalen Eintrag in `.mcp.json`.

#### OpenCode

OpenCode verwendet projektlokal `opencode.json`. Das aktuelle, kopierbare
JSON steht in der
[Installationsanleitung](docs/INSTALLATION.md#opencode-projektlokal).

Zum Schluss:

```powershell
& $Node $Mcp --selftest
```

Danach den Client einmal neu starten und das echte MCP-Tool `sse_preflight`
aufrufen. Ein Handshake oder ein Shell-Aufruf von `health` genügt nicht.

## Beispielaufträge

```text
Prüfe den bereits geöffneten Fall und liste Fehler, Warnungen und unklare
Angaben. Speichere und schließe ihn nicht.
```

```text
Nimm die Belege für August und bereite meine UStVA vor. Sichere den aktuellen
Dateistand einmal, speichere danach nicht und sende nichts über ELSTER.
```

```text
Ändere im bereits geöffneten Fall <FELD> auf <WERT>. Sichere den aktuellen
Dateistand vorher einmal, lies die Änderung zurück und speichere noch nicht.
```

## Architektur und Sicherheit

Die API ist der lokale Ausführungskern: Pfade, Allowlist, Prozesse und UI
Automation. MCP liefert die fachliche Orientierung, prüft beim Start die exakte
API-Identität und bündelt mit `sse_preflight` Arbeitsbereich, Produkt und
Laufzeit. Der optionale Skill führt als Wizard durch längere Abläufe.

Jeder API-Aufruf prüft weiterhin seine eigenen Bindungen und Grenzen. Der
Preflight ist keine Freigabe für spätere Mutationen. Lokale Pfade werden über
Ressourcen wie `cases:`, `documents:` und `results:` referenziert und an der
MCP-Grenze redigiert. `--case-dir` ist bei direkter API-Nutzung eine
Auflösungs- und Schwärzungsgrenze, keine Dateisystem-Sandbox.

Direkte API-Nutzung ohne MCP bleibt möglich und ist im
[API-Paket-README](packages/api/README.md) dokumentiert.

## Dokumentation

- [Installation, Updates und Fehlerbehebung](docs/INSTALLATION.md)
- [Dokumentationsindex](docs/README.md)
- [Produktarchitektur](docs/ARCHITEKTUR.md)
- [API-/MCP-Vertrag](docs/API-MCP-VERTRAG.md)
- [Umsatzsteuer-Voranmeldung](docs/UMSATZSTEUER-VORANMELDUNG.md)
- [Verifikationsstand](docs/VERIFIKATION.md)
- [Optionale Skill-Anleitung](skills/steuer-spar-erklaerung/SKILL.md)
- [Releases](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases)

## Mitwirken

```powershell
npm ci
npm run test:fast
npm test
```

Fehlerberichte und Pull Requests sind willkommen. Niemals echte Steuerfälle,
Belege, Namen, Steuer-IDs, Tokens, lokale Pfade oder ungeschwärzte Screenshots
öffentlich hochladen. Sicherheitsprobleme bitte privat über
[Report a vulnerability](SECURITY.md) melden.

Lizenz: [MIT](LICENSE)
