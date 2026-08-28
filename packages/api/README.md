# @yadimon/steuer-spar-erklaerung-api

> **Beta und inoffiziell.** Dieses Projekt ist nicht mit Wolters Kluwer
> verbunden. Es sendet keine Steuererklärung und ersetzt keine Steuerberatung.

Lokaler Windows-x64-API-Wrapper für SteuerSparErklärung. Das Paket stellt die
installierte Desktop-Anwendung über eine ausschließlich an `127.0.0.1`
gebundene HTTP-API und eine direkte CLI bereit.

## Rolle des Pakets

Dieses Paket ist die lokale Ausführungsschicht:

- HTTP-API und direkte API-CLI;
- Windows-PowerShell-5.1- und Native-Runtime;
- versionierte Produktprofile für geprüfte SteuerSparErklärung-Builds;
- private Backups, ausdrücklich verlangte Arbeitskopien, read-only Analyse und
  freigegebene UI-Automation.

Ein Einrichtungsprogramm enthält dieses Paket nicht und braucht es nicht: Der
erste Start legt die Arbeitsordner an, eine Konfigurationsdatei ist optional.
Den Ablauf beschreibt die
[Installationsanleitung](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md).
Der MCP-Server ist bewusst **nicht** enthalten; er liegt im getrennten Paket
[`@yadimon/steuer-spar-erklaerung-mcp`](https://www.npmjs.com/package/@yadimon/steuer-spar-erklaerung-mcp).

## Voraussetzungen

- Windows x64;
- installierte SteuerSparErklärung 2025 / Engine-Major 31;
- Node.js 22 oder neuer für diesen npm-Installationsweg.

## Installation und direkte API-Nutzung

Für einen einzelnen Lauf ist keine globale Paketinstallation nötig. Der erste
Foreground-Start legt die Arbeitsordner an, falls sie noch fehlen. Der
Fallordner gilt nur für diesen Prozess:

```powershell
npx.cmd -y @yadimon/steuer-spar-erklaerung-api --case-dir "C:\Pfad\zum\Fallordner"
```

Das Terminal bleibt offen. Aus einem zweiten Terminal ruft die mitgelieferte
CLI die API auf:

```powershell
npx.cmd -y -p @yadimon/steuer-spar-erklaerung-api steuer-spar-erklaerung-call discovery
npx.cmd -y -p @yadimon/steuer-spar-erklaerung-api steuer-spar-erklaerung-call health
```

`Strg+C` beendet die API. Dieser kurze Weg registriert kein MCP und erzeugt
keinen dauerhaften Launcher im NPX-Cache.

Für eine dauerhafte Installation bleiben die drei Befehle global verfügbar:

```powershell
npm install --global @yadimon/steuer-spar-erklaerung-api
steuer-spar-erklaerung-api --help
steuer-spar-erklaerung-call --help
```

Für eine ordnergebundene Installation `npm i` ohne `--global` verwenden und die
API mit einem absoluten `--config`-Pfad in diesem Ordner starten; die
Anleitung führt einen Agenten Schritt für Schritt durch Steuerfall,
Belegordner und MCP-Anmeldung.

## Sicherheitsgrenzen

- API nur auf Loopback; Anfragen mit `Origin`, `Sec-Fetch-Site` oder
  fremdem `Host` werden mit `403` abgewiesen, damit keine Webseite im
  Browser die Steuersoftware steuern kann;
- lokale Pfade und Steuerdaten bleiben auf dem Windows-PC;
- Originalfälle werden auf Dateiebene nicht überschrieben;
- der eindeutig geöffnete Fall kann nach privater, hashverifizierter Sicherung
  kontrolliert geändert werden; Persistieren ist ein separater Auftrag;
- Arbeitskopie und `save_as` nur auf ausdrücklichen Wunsch, nie automatisch;
- ELSTER, Versand und sonstige Übermittlung ans Finanzamt sind gesperrt;
- Profil 2024 bleibt experimentell und ist für Nutzer nicht freigegeben.

Vollständiger Schnellstart, Skill-Installation, unterstützte Operationen und
Verifikation stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp#readme).
Sicherheitsprobleme bitte nach
[`SECURITY.md`](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/SECURITY.md)
melden.
