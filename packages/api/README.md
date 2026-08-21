# @yadimon/steuer-spar-erklaerung-api

> **Beta und inoffiziell.** Dieses Projekt ist nicht mit Wolters Kluwer
> verbunden. Es sendet keine Steuererklärung und ersetzt keine Steuerberatung.

Lokaler Windows-x64-API-Wrapper für SteuerSparErklärung. Das Paket stellt die
installierte Desktop-Anwendung über eine ausschließlich an `127.0.0.1`
gebundene, token-geschützte HTTP-API und eine direkte CLI bereit.

## Rolle des Pakets

Dieses Paket ist die lokale Ausführungsschicht:

- HTTP-API und direkte API-CLI;
- Windows-PowerShell-5.1- und Native-Runtime;
- versionierte Produktprofile für geprüfte SteuerSparErklärung-Builds;
- Arbeitskopien, Backups, read-only Analyse und freigegebene UI-Automation;
- technischer Konfigurationshelfer für den öffentlichen Setup-Skill.

Der geführte Einrichtungs-Wizard ist der
[`steuer-spar-erklaerung-setup`-Skill](https://github.com/yadimon/steuer-spar-erklaerung-mcp/tree/main/skills/steuer-spar-erklaerung-setup),
nicht die Produktrolle dieses npm-Pakets.
Der MCP-Server ist bewusst **nicht** enthalten; er liegt im getrennten Paket
[`@yadimon/steuer-spar-erklaerung-mcp`](https://www.npmjs.com/package/@yadimon/steuer-spar-erklaerung-mcp).

## Voraussetzungen

- Windows x64;
- installierte SteuerSparErklärung 2025 / Engine-Major 31;
- Node.js 22 oder neuer für diesen npm-Installationsweg.

Ohne Node.js/npm kann stattdessen das vollständige portable Windows-Release
aus den [GitHub Releases](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases)
verwendet werden.

## Installation und direkte API-Nutzung

Für einen einzelnen Lauf ist keine globale Paketinstallation nötig. Der erste
Foreground-Start erzeugt eine lokale Standardkonfiguration, falls noch keine
vorhanden ist. Der Fallordner gilt nur für diesen Prozess:

```powershell
npx.cmd -y @yadimon/steuer-spar-erklaerung-api --case-dir "C:\Pfad\zum\Fallordner"
```

Das Terminal bleibt offen. Aus einem zweiten Terminal ruft die mitgelieferte
CLI die API auf, ohne das lokale Token anzuzeigen:

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
steuer-spar-erklaerung-setup --check
```

Für die geführte Einrichtung sollte ein Agent den Setup-Skill verwenden. Er
bestätigt Steuerfall und Belegordner, installiert bei Bedarf API und MCP in
derselben Version und ruft den technischen Konfigurationshelfer dieses Pakets
auf. Dadurch bleiben Nutzerführung und API-Runtime klar getrennt.

## Sicherheitsgrenzen

- API nur auf Loopback mit Bearer-Token;
- lokale Pfade und Steuerdaten bleiben auf dem Windows-PC;
- Originalfälle werden nicht überschrieben;
- Änderungen nur an gebundenen Arbeitskopien und mit Readback;
- ELSTER, Versand und sonstige Übermittlung ans Finanzamt sind gesperrt;
- Profil 2024 bleibt experimentell und ist im Nutzer-Setup nicht freigegeben.

Vollständiger Schnellstart, Skill-Installation, unterstützte Operationen und
Verifikation stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp#readme).
Sicherheitsprobleme bitte nach
[`SECURITY.md`](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/SECURITY.md)
melden.
