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
übersetzt MCP-Aufrufe in deren versionierten HTTP-Vertrag. API und MCP müssen
exakt dieselbe Version tragen. Ohne laufende, passend versionierte API ist der
Wrapper absichtlich nicht nutzbar.

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
MCP-Servereintrag ist eine einzige ausführbare Datei ohne Argumente und ohne
Umgebungsvariablen; der Wrapper findet die lokale API über `SSE_API_URL`
beziehungsweise den Standardport. Steuerfall-, Beleg- und Programmpfade
verbleiben im API-Prozess auf dem Steuer-PC.

## Vertrag

- 98 fachliche MCP-Toolnamen über den versionierten API-Katalog;
- strikte Eingabeschemata und deklarierte Ausgabeschemata;
- vollständiges `structuredContent` neben kompaktem Text;
- rekursive Redaction lokaler PC-Pfade;
- Cancellation bis zum lokalen API-Auftrag;
- Größenlimits und fail-closed Fehlerantworten.

## Sicherheitsgrenzen

- MCP erhält keine Steuerfall-, Dokument- oder Programmpfade;
- die API kennt keine Anmeldung und weist Anfragen mit `Origin`,
  `Sec-Fetch-Site` oder fremdem `Host` mit `403` ab;
- die API darf nicht über Netzwerk-Proxys oder öffentliche Gateways
  exponiert werden;
- Originalfälle werden nicht überschrieben;
- ELSTER, Versand und sonstige Übermittlung ans Finanzamt sind gesperrt.

Vollständiger Schnellstart, Anleitung und Verifikation stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp#readme).
Sicherheitsprobleme bitte nach
[`SECURITY.md`](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/SECURITY.md)
melden.
