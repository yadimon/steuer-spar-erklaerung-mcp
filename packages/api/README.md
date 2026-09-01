# @yadimon/steuer-spar-erklaerung-api

> **Beta und inoffiziell.** Dieses Projekt ist nicht mit Wolters Kluwer
> verbunden. Es sendet keine Steuererklärung und ersetzt keine Steuerberatung.

Lokaler Windows-x64-API-Wrapper für SteuerSparErklärung 2025. Das Paket stellt
die Desktop-Anwendung über eine ausschließlich an Loopback gebundene HTTP-API
und eine direkte CLI bereit.

## Nutzerstandard ist das Agent Plugin

Normale Codex-/Claude-Code-Nutzer installieren nicht dieses Paket separat. Das
[Agent Plugin](https://github.com/yadimon/steuer-spar-erklaerung-mcp#schnellstart)
enthält Skill, MCP, exakt diese API-Version, PowerShell-/Native-Runtime,
Profile und alle JavaScript-Dependencies. Es startet die API als geprüften
lokalen Singleton, ohne separates Terminal, Runtime-npm/npx oder
Netzwerkdownload.

`plugins@1.3.4` benötigt Git auf `PATH`, weil es das Plugin-Repository einmalig
klont; danach bleibt Node.js 22+ die einzige zusätzliche Plugin-Runtime.
Bei Codex umfasst die Installation zusätzlich den target-nativen
`codex plugin add steuer-spar-erklaerung@plugins-cli --json`-Schritt; der
externe Installer allein registriert das Plugin dort derzeit nicht als
installiert. Der vollständige, überprüfbare Ablauf steht im
[Quickstart](https://github.com/yadimon/steuer-spar-erklaerung-mcp#schnellstart).

Dieses npm-Paket bleibt für eigene HTTP-/CLI-Integrationen und tiefe Diagnosen
separat unterstützt.

## Rolle des Pakets

- lokale HTTP-API und direkte API-CLI;
- Windows-PowerShell-5.1- und Native-Runtime;
- versionierte Profile für geprüfte SteuerSparErklärung-Builds;
- private Backups, ausdrücklich verlangte Arbeitskopien, read-only Analyse und
  freigegebene UI-Automation.

Der MCP-Server ist bewusst **nicht** enthalten. Der getrennte MCP-Wrapper liegt in
[`@yadimon/steuer-spar-erklaerung-mcp`](https://www.npmjs.com/package/@yadimon/steuer-spar-erklaerung-mcp)
und hängt exakt von derselben API-Releaseversion ab.

## Voraussetzungen

- Windows x64;
- installierte SteuerSparErklärung 2025 / Engine-Major 31;
- Node.js 22 oder neuer für die standalone npm-Nutzung.

## Fortgeschritten: direkte API und CLI

Dieser bewusste API-only-Weg hält Paket und Arbeitsbereich in einem eigenen
Ordner. Läuft am Zielport bereits ein API-Singleton, diesen nicht nach Namen
beenden; zuerst dessen `/healthz`-Identität prüfen oder einen anderen
Loopback-Port konfigurieren.

```powershell
$Root = 'C:\mein-steuer-api'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Set-Location $Root

npm.cmd init -y
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-api@latest

$Node = (Get-Command node).Source
$Api = Join-Path $Root 'node_modules\@yadimon\steuer-spar-erklaerung-api\dist\api-main.js'
$ApiConfig = Join-Path $Root 'config.json'
& $Node $Api --config $ApiConfig
```

Dieses ausdrücklich gestartete API-Terminal bleibt für den standalone
API-only-Modus offen. Aus einem zweiten Terminal:

```powershell
$Root = 'C:\mein-steuer-api'
$Node = (Get-Command node).Source
$Call = Join-Path $Root 'node_modules\@yadimon\steuer-spar-erklaerung-api\dist\api-cli.js'
$ApiConfig = Join-Path $Root 'config.json'
& $Node $Call discovery --config $ApiConfig
& $Node $Call health --config $ApiConfig
```

`Strg+C` beendet diese bewusst gestartete standalone API. Der absolute
`--config`-Pfad bestimmt den Arbeitsbereich; die Datei darf beim ersten Start
noch fehlen. Ohne Konfigurationspfad verwendet die API ihren sicheren Standard
unter `%LOCALAPPDATA%\SteuerSparErklaerungApi`.

`--case-dir` öffnet keinen Steuerfall und wählt keinen Fall automatisch. Der
Wert bestimmt nur die Auflösung und Redaction relativer `cases:`-Referenzen. Er
ist keine Dateisystem-Sandbox. Jede tatsächliche Lese- oder Schreibaktion
braucht danach eine ausdrücklich aufgerufene, streng gebundene Operation.

### Wiederherstellungsfrage

Nach einem unsauberen SSE-Ende kann `launch` früh mit `ready=false` und
`blockedByDialog=true` zurückkehren. `dialog_list` beschreibt die exakt erkannte
Frage dann mit `recoveryPrompt=true`, `requiresCaseBinding=true`, HWND, PID,
Texten, Schaltern und Fingerprint. Sie wird nie automatisch beantwortet.

Zum bewussten Verwerfen der alten Recovery-Datei zuerst die reguläre
`cases:`-Datei mit `case_hash` prüfen. Danach akzeptiert `dialog_answer`
ausschließlich `button="Nein"` zusammen mit demselben Dialog-Fingerprint,
`expectedCaseRef` und `expectedCaseHash`. Unmittelbar vor dem Klick werden
PID/Command-Line und Dateihash erneut gebunden; danach müssen genau ein
reguläres, nicht als wiederhergestellt markiertes Fallfenster und derselbe
Dateihash sichtbar sein. `Ja` bleibt gesperrt.

## Identität und Singleton

`/healthz` liefert API-Version, Paketname, exakte Paketversion,
Prozess-/Instanz-ID und einen pfadfreien Fingerprint der Ressourcenbindung. Der
MCP-Supervisor verwendet diese Felder zur sicheren Wiederverwendung. Eine
anders versionierte oder nicht eindeutig erkennbare API wird nie übernommen,
beendet oder ersetzt.

Zum bewussten Stopp eines Hintergrund-Singletons zuerst diese Identität lesen
und danach die exakte `processId` mit `Get-CimInstance Win32_Process`
verifizieren. Die Kommandozeile muss auf das erwartete `api-main.js` zeigen.
Nur dann die genaue PID stoppen; niemals einen Prozessname-Sweep ausführen.

## Sicherheitsgrenzen

- API nur auf `127.0.0.1` beziehungsweise `::1`;
- Anfragen mit `Origin`, fremdem `Host` oder unpassendem `Sec-Fetch-Site`
  werden mit `403` abgewiesen;
- lokale Pfade und Steuerdaten bleiben auf dem Windows-PC;
- Originale und übermittelte Fälle werden nicht still überschrieben,
  verschoben oder gelöscht;
- der eindeutig geöffnete Fall kann nur nach privater hashverifizierter
  Sicherung kontrolliert geändert werden;
- Persistieren, Arbeitskopie und `save_as` brauchen einen separaten
  ausdrücklichen Auftrag und unmittelbaren Readback;
- ELSTER, Versand und sonstige Übermittlung ans Finanzamt sind gesperrt;
- Profil 2024 bleibt experimentell und ist für Nutzer nicht freigegeben.

Installation des Agent Plugins steht in der
[Installationsanleitung](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md);
unterstützte Operationen und Verifikation stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp#readme).
Sicherheitsprobleme bitte nach
[`SECURITY.md`](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/SECURITY.md)
melden.
