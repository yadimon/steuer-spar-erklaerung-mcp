# @yadimon/steuer-spar-erklaerung-mcp

> **Beta und inoffiziell.** Dieses Projekt ist nicht mit Wolters Kluwer
> verbunden. Es sendet keine Steuererklärung und ersetzt keine Steuerberatung.

PC-blinder MCP-Wrapper für Windows x64 und SteuerSparErklärung 2025. Er spricht
per stdio mit dem Agenten und über die lokale SteuerSparErklärung-API;
Steuerfall- und Dokumentpfade bleiben im API-Prozess.

## Empfohlener Weg: Agent Plugin

Das Agent Plugin enthält Skill, MCP, exakt passende API,
PowerShell-/Native-Runtime, Profile und JavaScript-Dependencies. Im
Auftragsordner entsteht kein `node_modules`; beim MCP-Start laufen weder npm
noch npx und es ist kein Netzwerkzugriff nötig.

`plugins@1.3.4` benötigt Git auf `PATH`, weil es das Plugin-Repository einmalig
klont. Danach bleibt Node.js 22+ die einzige zusätzliche Plugin-Runtime.

Für Codex:

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target codex --scope project --yes
codex plugin add steuer-spar-erklaerung@plugins-cli --json
```

Der erste Befehl allein erzeugte mit `plugins@1.3.4` und Codex CLI 0.151 zwar
Cache-, Marketplace- und Konfigurationseinträge, blieb laut Status-Readback
`codex plugin list --json` aber `not installed`. Der zweite, target-native Befehl ist
daher zwingend; erst `installed, enabled` ist ein erfolgreicher Codex-Stand.
Danach `codex plugin list --json` als Status-Readback verwenden, nicht als
vorgesehenen Installationsschritt. Die beobachtete Codex-0.151-Alpha kann bei
diesem Readback dennoch Cache-/Konfigurationszustand materialisieren.

Für Claude Code genügt der eine zielgenaue Installeraufruf:

```powershell
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target claude-code --scope user --yes
```

Der Windows-VM-Lauf mit Claude Code 2.1.252 zeigte den Eintrag danach mit
`Scope: user` als `enabled` und bestätigte die target-native Entfernung.
Anschließend den jeweiligen Client neu starten beziehungsweise seine Plugins
neu laden und das echte Tool `sse_preflight` aufrufen. Die automatische
Target-Erkennung wird unter Windows nicht empfohlen.

`plugins@1.3.4` ignoriert den Scope bei Codex. Claude Code verwendet bewusst
den VM-verifizierten User-Scope; beide Ziele schreiben in clientverwaltete
Benutzer-Caches/config und bedeuten daher keine physische Projektisolation.
Details zu getrennten Arbeitsdaten, Update und sicherer Entfernung stehen in der
[Installationsanleitung](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md).

## Vertrag

- versionsgebundener Operationskatalog plus komponierter MCP-Preflight
  `sse_preflight`;
- strikte Eingabe- und deklarierte Ausgabeschemata;
- vollständiges `structuredContent` neben kompaktem Text;
- rekursive Redaction lokaler PC-Pfade;
- Cancellation bis zum lokalen API-Auftrag;
- Größenlimits, protokollreines stdout und fail-closed Fehlerantworten.

Der Katalog umfasst **100 fachliche API-Toolnamen plus den komponierten MCP-Preflight**.
Alle 101 MCP-Werkzeugnamen werden aus dem versionierten Vertrag abgeleitet und
als strukturierte Werkzeuge registriert.

Vor der ersten Facharbeit bündelt `sse_preflight` nacheinander
`workspace_status`, `product_info` und `health`. Er startet keinen Steuerfall
und erteilt keine Mutationsfreigabe. Der Skill ergänzt einen kurzen Wizard;
harte Grenzen liegen zusätzlich in den MCP-Server-Instruktionen.

## API-Singleton

Der Supervisor übernimmt nur eine Loopback-API mit passendem Paketnamen,
derselben exakten Releaseversion, passendem API-Vertrag und bei verwalteter
Konfiguration identischer Ressourcenbindung. Ist der Port frei, startet er die
mitgelieferte API unsichtbar und wartet auf Readiness. Parallele MCP-Starts
konvergieren auf dieselbe PID.

Ein fremder Dienst, eine alte Version oder eine unklare Identität stoppt den
Start. Nichts wird automatisch beendet oder ersetzt. `SSE_API_URL` ist eine
autoritative, bewusst separat verwaltete Loopback-API und verhindert Fallback
und Autostart. `SSE_API_CONFIG` wählt optional einen absoluten eigenen
Arbeitsbereich. Beide Variablen dürfen nicht gleichzeitig gesetzt sein.

## Fortgeschritten: standalone npm-MCP

Dieser Weg ist für eigene Clientkonfigurationen und Diagnosen gedacht, nicht
für den normalen Plugin-Einstieg:

```powershell
$Root = 'C:\mein-steuer-mcp-standalone'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Set-Location $Root
npm.cmd init -y
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest

$Node = (Get-Command node).Source
$Mcp = Join-Path $Root 'node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js'
$ApiConfig = Join-Path $Root 'sse-api-config.json'
$env:SSE_API_CONFIG = $ApiConfig
& $Node $Mcp --selftest
```

npm installiert die exakt passende API als normale Dependency; das MCP-Paket
bindet dabei exakt dieselbe Paketversion. Es gibt kein `postinstall` und keine
Installation zur Laufzeit. Der target-native
MCP-Eintrag muss die absolute `node.exe` mit dem absoluten `dist\index.js` als
einzigem Skriptargument starten und denselben optionalen
`SSE_API_CONFIG`-Wert erhalten. Ein Runtime-`npx`-Befehl ist nicht unterstützt.

## Sicherheitsgrenzen

- MCP erhält keine Steuerfall-, Dokument- oder Programmpfade;
- Die API kennt keine Anmeldung und bleibt deshalb strikt auf Loopback; sie
  weist Browserherkunft beziehungsweise
  fremden `Host` mit `403` ab;
- Originale und übermittelte Fälle werden nicht still ersetzt oder gelöscht;
- vor dirty-fähiger Navigation oder Mutation wird der aktuelle Dateistand
  einmal je unverändertem Hash privat gesichert;
- `save` und `save_as` brauchen einen separaten ausdrücklichen Auftrag;
- jede Änderung braucht unmittelbaren Readback;
- ELSTER, Versand und sonstige Übermittlung ans Finanzamt sind gesperrt.

Vollständiger Schnellstart und Verifikation stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp#readme).
Sicherheitsprobleme bitte nach
[`SECURITY.md`](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/SECURITY.md)
melden.
