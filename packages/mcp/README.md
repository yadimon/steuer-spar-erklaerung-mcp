# @yadimon/steuer-spar-erklaerung-mcp

> **Beta und inoffiziell.** Dieses Projekt ist nicht mit Wolters Kluwer
> verbunden. Es sendet keine Steuererklärung und ersetzt keine Steuerberatung.

PC-blinder MCP-Wrapper für Windows x64 und SteuerSparErklärung über die lokale
SteuerSparErklärung-API. Das Paket spricht per stdio mit dem AI-Agenten und per
lokaler Loopback-Verbindung mit
`@yadimon/steuer-spar-erklaerung-api`. Es greift niemals selbst auf die
Desktop-Oberfläche oder lokale Steuerdateien zu.

## Architektur und Voraussetzungen

Das API-Paket ist die Ausführungsschicht auf dem Windows-PC; dieses MCP-Paket
übersetzt MCP-Aufrufe in deren versionierten HTTP-Vertrag. Es besitzt eine
normale, exakte Dependency auf dieselbe Releaseversion der API. npm installiert
sie automatisch, ohne `postinstall` und ohne Installation zur Laufzeit. Weil
die Dependency Windows-x64-nativ ist, ist auch dieses MCP-Paket auf Windows x64
begrenzt.
API und MCP tragen dadurch exakt dieselbe Paketversion.

```text
AI-Agent -> MCP-Paket -> lokale API -> SteuerSparErklärung
```

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npm.cmd init -y
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest
$ApiConfig = Join-Path (Get-Location).Path 'config.json'
$env:SSE_API_CONFIG = $ApiConfig
node .\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js --selftest
```

Die Umgebungsvariable gilt nur in dieser PowerShell-Sitzung. Ein eigener
Arbeitsbereich muss beim Selftest und im späteren Client denselben absoluten
`SSE_API_CONFIG`-Wert erhalten.

Beim Start prüft MCP zuerst die konfigurierte Loopback-Adresse. Eine bereits
laufende API wird nur bei exakt passendem Paketnamen, Release, API-Vertrag und
bei verwalteter Konfiguration identischer Ressourcenbindung als Singleton
übernommen. Ist der Port frei, startet MCP die mitinstallierte
API unsichtbar, wartet auf Readiness und lässt sie für spätere MCP-Clients
weiterlaufen. Parallelstarts konvergieren auf genau eine API. Ein fremder
Dienst oder eine unklare/abweichende API führt fail-closed zum Startabbruch und
wird niemals beendet oder ersetzt.

Die [Installationsanleitung](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md)
beschreibt Installation, Versionsabgleich und Client-Konfiguration. Der
MCP-Servereintrag startet die absolute `node.exe` mit dem absoluten
`dist/index.js` dieses Pakets als einzigem Argument. Beim Standardport braucht
er keine Umgebungsvariable. `SSE_API_CONFIG` darf auf eine absolute
Konfigurationsdatei für einen eigenen API-Arbeitsbereich zeigen.
`SSE_API_URL` bindet dagegen autoritativ eine bewusst separat verwaltete
Loopback-API: Ist sie nicht erreichbar oder inkompatibel, gibt es keinen
Fallback und keinen Autostart am Standardport. Steuerfall-, Beleg- und
Programmpfade verbleiben im API-Prozess auf dem Steuer-PC. `SSE_API_URL` und
`SSE_API_CONFIG` dürfen nicht gleichzeitig gesetzt sein.

## Vertrag

- 99 fachliche API-Toolnamen plus den komponierten MCP-Preflight
  `sse_preflight`;
- strikte Eingabeschemata und deklarierte Ausgabeschemata;
- vollständiges `structuredContent` neben kompaktem Text;
- rekursive Redaction lokaler PC-Pfade;
- Cancellation bis zum lokalen API-Auftrag;
- Größenlimits und fail-closed Fehlerantworten.

API-Ausgaben sind vom MCP-stdout getrennt; der Hintergrundprozess erhält keine
sichtbare Konsole. `--selftest` verwendet denselben Singleton- und
Identitätsprüfpfad wie der normale stdio-Start. Vor jedem späteren
API-Werkzeugaufruf wird die Identität erneut geprüft, sodass ein am Port
ausgetauschter oder umkonfigurierter Prozess fail-closed gestoppt wird.

Vor der ersten Facharbeit bündelt `sse_preflight` nacheinander
`workspace_status`, `product_info` und `health` zu stabilen Blockercodes. Er
startet keinen Steuerfall und ist keine Freigabe für spätere Mutationen. Die
Installation und der tatsächlich laufende Build müssen beide explizit ohne
Build-Drift belegt sein. Die
MCP-Server-Instruktionen tragen diesen Ablauf auch ohne installierten Skill;
der Skill bleibt eine optionale Komfortschicht für längere Wizards.

Alle 100 MCP-Werkzeugnamen sind registriert. Im normalen öffentlichen Betrieb ist
von den zehn BelegManager-Werkzeugen nur `sse_receipt_manager_list` aktiv; die
neun Vordergrundwege stoppen vor Workerstart und UI-Änderung strukturiert als
`foreground-required-operation-disabled`.

## Sicherheitsgrenzen

- MCP erhält keine Steuerfall-, Dokument- oder Programmpfade;
- die API kennt keine Anmeldung und weist Anfragen mit `Origin`,
  `Sec-Fetch-Site` oder fremdem `Host` mit `403` ab;
- die API darf nicht über Netzwerk-Proxys oder öffentliche Gateways
  exponiert werden;
- Kopien, Backups und Archive überschreiben keine vorhandenen Ziele; ein
  ausdrücklich beauftragtes `save` kann den exakt gebundenen geöffneten Fall
  über SteuerSparErklärung speichern;
- ein bereits geöffneter Fall bleibt der Arbeitsfall; eine Arbeitskopie,
  `save` oder `save_as` wird nie still als Sicherheitsmaßnahme ausgelöst;
- vor der ersten dirty-fähigen UI-Navigation oder Mutation sichert der Agent
  den aktuellen Dateistand einmal im privaten Backupbereich und verwendet ihn
  bei unverändertem Hash weiter;
- ELSTER, Versand und sonstige Übermittlung ans Finanzamt sind gesperrt.

Vollständiger Schnellstart, Anleitung und Verifikation stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp#readme).
Sicherheitsprobleme bitte nach
[`SECURITY.md`](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/SECURITY.md)
melden.
