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

### Ordnergebunden

Dieser Weg hält Paket und Arbeitsbereich in `C:\mein-steuer-api`. Läuft am
gewählten Port bereits ein vom MCP gestarteter API-Singleton, beende ihn vorher
bewusst nach der Installationsanleitung oder trage in `config.json` einen
anderen Loopback-Port ein:

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

Das Terminal bleibt offen. Aus einem zweiten Terminal ruft die mitgelieferte
CLI die API auf:

```powershell
$Root = 'C:\mein-steuer-api'
$Node = (Get-Command node).Source
$Call = Join-Path $Root 'node_modules\@yadimon\steuer-spar-erklaerung-api\dist\api-cli.js'
$ApiConfig = Join-Path $Root 'config.json'
& $Node $Call discovery --config $ApiConfig
& $Node $Call health --config $ApiConfig
```

`Strg+C` beendet die API. Dieser direkte API-only-Weg registriert kein MCP.
Der absolute `--config`-Pfad bestimmt den Arbeitsbereich; die Datei selbst darf
beim ersten Start noch fehlen.

### Einmaliger NPX-Lauf

Ohne dauerhafte Paketinstallation geht derselbe direkte Modus auch über NPX:

```powershell
npx.cmd -y @yadimon/steuer-spar-erklaerung-api `
  --config "C:\mein-steuer-api\config.json"
```

Aus einem zweiten Terminal:

```powershell
npx.cmd -y -p @yadimon/steuer-spar-erklaerung-api `
  steuer-spar-erklaerung-call discovery `
  --config "C:\mein-steuer-api\config.json"
```

Dieser Lauf erzeugt keinen dauerhaften Launcher im NPX-Cache.

### Optional systemweit, nur API-only

Wer die direkte API bewusst systemweit statt projektlokal betreiben will, kann
die drei Befehle global verfügbar machen. Das gehört nicht zum MCP-Standardweg:

```powershell
npm.cmd install --global @yadimon/steuer-spar-erklaerung-api
steuer-spar-erklaerung-api.cmd --help
steuer-spar-erklaerung-call.cmd --help
```

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
