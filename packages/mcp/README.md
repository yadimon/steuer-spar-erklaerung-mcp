# @yadimon/steuer-spar-erklaerung-mcp

> **Beta und inoffiziell.** Dieses Projekt ist nicht mit Wolters Kluwer
> verbunden. Es sendet keine Steuererklärung und ersetzt keine Steuerberatung.

PC-blinder MCP-Wrapper für SteuerSparErklärung über die lokale
SteuerSparErklärung-API. Das Paket spricht per stdio mit dem AI-Agenten und per
lokaler Loopback-Verbindung mit
`@yadimon/steuer-spar-erklaerung-api`. Es greift niemals selbst auf die
Desktop-Oberfläche oder lokale Steuerdateien zu.

## Architektur und Voraussetzungen

Das API-Paket ist die Ausführungsschicht auf dem Windows-PC; dieses MCP-Paket
übersetzt MCP-Aufrufe in deren versionierten HTTP-Vertrag. Für den
unterstützten Produktstand müssen API und MCP exakt dieselbe Paketversion
tragen. Die Laufzeit prüft zusätzlich den API-Protokollvertrag; eine bloß
protokollkompatible abweichende Paketversion ist trotzdem nicht freigegeben.

```text
AI-Agent -> MCP-Paket -> lokale API -> SteuerSparErklärung
```

```powershell
npm install --global @yadimon/steuer-spar-erklaerung-api
npm install --global @yadimon/steuer-spar-erklaerung-mcp
steuer-spar-erklaerung-mcp --help
```

Die [Installationsanleitung](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md)
beschreibt Installation, Versionsabgleich und Client-Konfiguration. Der
MCP-Servereintrag startet die absolute `node.exe` mit dem absoluten
`dist/index.js` dieses Pakets als einzigem Argument. Beim Standardport braucht
er keine Umgebungsvariable; für einen bewusst abweichenden API-Port wird
`SSE_API_URL` im Client-Eintrag gesetzt. Steuerfall-, Beleg- und Programmpfade
verbleiben im API-Prozess auf dem Steuer-PC.

## Vertrag

- 99 fachliche MCP-Toolnamen über den versionierten API-Katalog;
- strikte Eingabeschemata und deklarierte Ausgabeschemata;
- vollständiges `structuredContent` neben kompaktem Text;
- rekursive Redaction lokaler PC-Pfade;
- Cancellation bis zum lokalen API-Auftrag;
- Größenlimits und fail-closed Fehlerantworten.

Alle 99 Werkzeugnamen sind registriert. Im normalen öffentlichen Betrieb ist
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
