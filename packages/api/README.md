# @yadimon/steuer-spar-erklaerung-api

> **Beta und inoffiziell.** Dieses Projekt ist nicht mit Wolters Kluwer
> verbunden. Es sendet keine Steuererklärung und ersetzt keine Steuerberatung.

Lokaler Windows-x64-API-Wrapper für SteuerSparErklärung. Das Paket stellt die
installierte Desktop-Anwendung über eine ausschließlich an Loopback
(`127.0.0.1` oder `::1`) gebundene HTTP-API und eine direkte CLI bereit.

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
Dieses MCP-Paket hängt exakt von derselben API-Releaseversion ab, installiert
sie automatisch und startet sie bei Bedarf als lokalen Singleton. Für die hier
beschriebene direkte API-Nutzung bleibt die separate Installation vollständig
unterstützt.

## Voraussetzungen

- Windows x64;
- installierte SteuerSparErklärung 2025 / Engine-Major 31;
- Node.js 22 oder neuer für diesen npm-Installationsweg.

## Installation und direkte API-Nutzung

Für einen einzelnen Lauf ist keine globale Paketinstallation nötig. Der erste
Foreground-Start legt die Arbeitsordner an, falls sie noch fehlen. Der
Fallordner gilt nur für diesen Prozess. Läuft am gewählten Port bereits ein
vom MCP gestarteter API-Singleton, beende ihn vorher bewusst nach der Installationsanleitung oder
wähle per absolutem `--config` einen anderen Loopback-Port:

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
npm.cmd install --global @yadimon/steuer-spar-erklaerung-api
steuer-spar-erklaerung-api.cmd --help
steuer-spar-erklaerung-call.cmd --help
```

Für eine ordnergebundene Installation `npm i` ohne `--global` verwenden und die
API mit einem absoluten `--config`-Pfad in diesem Ordner starten; die
Anleitung zeigt dafür einen getrennten API-only-Weg.

`--case-dir` öffnet keinen Steuerfall und wählt auch keinen Fall automatisch.
Der Wert bestimmt ausschließlich, gegen welchen bestätigten Ordner relative
`cases:`-Referenzen aufgelöst und in Antworten redigiert werden. Er ist keine
Dateisystem-Sandbox; geöffnet oder geändert wird nur über einen danach
ausdrücklich aufgerufenen, streng gebundenen API-Befehl.

`/healthz` liefert neben API-Version und Betriebszustand den Paketnamen, die
exakte Paketversion, die Prozess-/Instanz-ID und einen pfadfreien Fingerprint der
wirksamen Ressourcenbindung. MCP verwendet diese Identität für die sichere
Wiederverwendung. Bei einer von MCP verwalteten/default Konfiguration muss der
Fingerprint exakt passen; bei autoritativem `SSE_API_URL` kann MCP nur seine
syntaktische Gültigkeit prüfen. Eine anders versionierte oder nicht eindeutig
erkennbare API wird nie übernommen oder beendet.

## Sicherheitsgrenzen

- API nur auf Loopback; Anfragen mit `Origin`, `Sec-Fetch-Site` oder
  fremdem `Host` werden mit `403` abgewiesen, damit keine Webseite im
  Browser die Steuersoftware steuern kann;
- lokale Pfade und Steuerdaten bleiben auf dem Windows-PC;
- Dateioperationen für Kopien, Backups und Archive überschreiben keine
  vorhandenen Ziele; ein ausdrücklich beauftragtes `save` darf dagegen den
  exakt gebundenen geöffneten Fall über SteuerSparErklärung speichern;
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
