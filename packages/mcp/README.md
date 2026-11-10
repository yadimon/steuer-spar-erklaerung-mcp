# @yadimon/steuer-spar-erklaerung-mcp

> **Beta und inoffiziell.** Dieses Projekt ist nicht mit Wolters Kluwer
> verbunden. Es sendet keine Steuererklärung und ersetzt keine Steuerberatung.

PC-blinder MCP-Wrapper für Windows x64 und SteuerSparErklärung 2025. Er spricht
per stdio mit dem Agenten und über die lokale SteuerSparErklärung-API;
Steuerfall- und Dokumentpfade bleiben im API-Prozess.

## Empfohlener Codex-Weg: direktes npm-MCP

**Codex: Plugin-Installation vorläufig nicht empfohlen.** Codex begrenzt die
Metadaten von MCP-Werkzeugen aus Agent Plugins auf insgesamt **64 000 Bytes**.
Bei beta55 wurde dadurch ein Katalog mit **26 von 104** verfügbaren Werkzeugen
reproduziert; auch `sse_preflight` kann fehlen. Die Empfehlung der
Plugin-Installation für Codex ist deshalb vorübergehend ausgesetzt.
Direkt registrierte npm-MCP-Verbindungen sind von diesem Plugin-Budget nicht
betroffen. Das ist eine Grenze dieses Codex-Integrationswegs, keine allgemeine
Aussage über API, MCP oder andere Clients. Siehe
[Codex-Quellcode](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_exposure.rs)
und [bekannte Meldung](https://github.com/openai/codex/issues/49758).

Für Codex ist das direkte npm-MCP mit automatisch installierter API derselben
Version derzeit der empfohlene Weg. Installiere die Runtime auf einem lokalen,
nicht synchronisierten Laufwerk; der Auftragsordner mit den Belegen darf
getrennt liegen.

Bei einer vorhandenen Plugin-Installation zuerst den
[Umstellungsweg](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md#vorhandenes-codex-plugin-umstellen)
anwenden und die bestehenden API-Datenbindungen erhalten. Das folgende
Beispiel richtet eine neue Installation ein.

```powershell
$RuntimeRoot = Join-Path $env:USERPROFILE '.local\share\SteuerSparErklaerungMcp'
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
Set-Location $RuntimeRoot
npm.cmd init -y
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest

$Node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$Mcp = Join-Path $RuntimeRoot 'node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js'
$ApiConfig = Join-Path $RuntimeRoot 'sse-api-config.json'
codex mcp add steuer-spar-erklaerung --env "SSE_API_CONFIG=$ApiConfig" -- $Node $Mcp
```

npm installiert die API als exakt versionsgleiche Dependency. Der MCP startet
sie bei Bedarf im Hintergrund. Für Codex unter Windows die API vor dem
Fachauftrag in einem eigenen Terminal starten; die
[Installationsanleitung](../../docs/INSTALLATION.md#api-lebensdauer-bei-codex-unter-windows)
beschreibt den vom MCP unabhängigen Prozessstart.
Beim MCP-Start laufen weder npm noch npx und es ist kein Netzwerkzugriff nötig.
Vorhandene Datenbindungen in einer bestehenden API-Konfiguration beibehalten.

Installiere den [Skill](https://github.com/yadimon/steuer-spar-erklaerung-mcp/tree/main/skills/steuer-spar-erklaerung) separat über den
Skill Installer von Codex aus diesem Repository (Pfad
`skills/steuer-spar-erklaerung`). Starte danach eine neue Sitzung im
gewünschten Auftragsordner und prüfe den echten Aufruf von `sse_preflight`
sowie die Verfügbarkeit von `sse_instances` und des vollständigen Katalogs.
Die [Installationsanleitung](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md) beschreibt Datenablage,
Skill-Installation und die Umstellung eines vorhandenen Plugins.

Für Claude Code bleibt das selbstenthaltene Agent Plugin unterstützt:

```powershell
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target claude-code --scope user --yes
```

## Vertrag

- versionsgebundener Operationskatalog plus komponierter MCP-Preflight
  `sse_preflight`;
- strikte Eingabe- und deklarierte Ausgabeschemata;
- vollständiges `structuredContent` neben kompaktem Text;
- rekursive Redaction lokaler PC-Pfade;
- Cancellation bis zum lokalen API-Auftrag;
- Größenlimits, protokollreines stdout und fail-closed Fehlerantworten.

Der aktuelle Katalog umfasst **102 direkte API-Toolnamen**. Hinzu kommen der
komponierte Preflight `sse_preflight` und das getrennte
API-Lebenszykluswerkzeug `sse_api_control`.
Alle 104 MCP-Werkzeugnamen werden als strukturierte Werkzeuge registriert.
Die Zuordnung ist im versionierten Operationskatalog festgelegt. Die Anzahl
der Werkzeugnamen ist getrennt von der Anzahl der API-Operationen zu lesen:
Zwei Änderungswerkzeuge verwenden dieselbe API-Operation.

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

## Standalone npm-MCP und eigene Konfiguration

Der direkte npm-Weg ist für Codex empfohlen. Das folgende Beispiel hält die
Runtime in einem ausdrücklich gewählten lokalen, nicht synchronisierten Ordner:

```powershell
$Root = 'C:\mein-steuer-mcp-standalone'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Set-Location $Root
npm.cmd init -y
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest

$Node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
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
- `save` und `save_as` brauchen einen ausdrücklichen Auftrag, auch gemeinsam
  mit der Änderung; dafür ist keine zweite Bestätigung nötig;
- jede Änderung braucht unmittelbaren Readback;
- ELSTER, Versand und sonstige Übermittlung ans Finanzamt sind gesperrt.

Vollständiger Schnellstart und Verifikation stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp#readme).
Sicherheitsprobleme bitte nach
[`SECURITY.md`](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/SECURITY.md)
melden.
