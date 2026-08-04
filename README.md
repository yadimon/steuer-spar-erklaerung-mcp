# Inoffizielle API und MCP für SteuerSparErklärung 2025

Steuerfälle mit einem KI-Agenten prüfen, mit Belegen abgleichen und nach
Freigabe kontrolliert bearbeiten – lokal in SteuerSparErklärung 2025.

> **Öffentliche Beta für Windows x64.** Vor Änderungen eine Sicherungskopie
> anlegen und Ergebnisse selbst prüfen. Dieses Projekt ist keine
> Steuerberatung und übermittelt nichts an das Finanzamt.

## Schnellstart

### Ohne npm

Gib einem Agenten mit GitHub- und lokalem Dateizugriff diesen Auftrag:

```text
Öffne https://github.com/yadimon/steuer-spar-erklaerung-mcp und lies
skills/steuer-spar-erklaerung/SKILL.md. Folge dem Skill auf Deutsch.
Richte die portable lokale API mit sicheren Standardwerten ein und prüfe
meinen Steuerfall zunächst nur lesend. Ändere nichts ohne meine Freigabe.
```

Der Agent führt durch Download, Prüfsumme und Einrichtung. Das portable Release
bringt seine eigene Laufzeit mit; Node.js/npm, Python und PowerShell 7 müssen
nicht global installiert werden. Wenn der Agent keine Programme starten darf,
kann das ZIP von der [Release-Seite](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases)
manuell geladen und anschließend `sse-setup.cmd` gestartet werden.

### Mit `npx skills`

```powershell
npx skills add yadimon/steuer-spar-erklaerung-mcp --list
npx skills add yadimon/steuer-spar-erklaerung-mcp --skill steuer-spar-erklaerung
```

Danach genügt zum Beispiel:

```text
Prüfe meine Steuererklärung in SteuerSparErklärung 2025. Gleiche sie mit
meinen Belegen ab und ändere nichts ohne meine ausdrückliche Freigabe.
```

`npx` installiert hier nur den Agenten-Skill. Die Automation selbst kann
weiterhin aus dem portablen Release laufen.

## Beispiel

![Ein Agent bedient einen Musterfall über die lokale API und den MCP-Wrapper](docs/assets/demo/steuer-spar-erklaerung-demo.gif)

## Typische Aufgaben

| Ziel | Auftrag an den Agenten | Standard |
| --- | --- | --- |
| Steuerfall prüfen | „Prüfe den geöffneten Fall und liste Fehler, Warnungen und unklare Angaben.“ | Nur lesen |
| Belege abgleichen | „Vergleiche den Fall mit den Belegen in diesem Ordner.“ | Originale unverändert lassen |
| Korrektur vorbereiten | „Schlage Korrekturen vor und ändere nach meiner Freigabe eine Arbeitskopie.“ | Vorher/nachher zurücklesen |
| UStVA vorbereiten | „Bereite die UStVA für Juli vor und sende sie nicht ab.“ | Zeitraum und vorhandene Übermittlungen zuerst prüfen |
| Nur einrichten | „Richte die portable API ein und verwende empfohlene Antworten.“ | Direkte API, MCP optional |

Bei sichtbarer UI-Automation muss Windows entsperrt bleiben. Während der Agent
klickt oder schreibt, nicht gleichzeitig Maus oder Tastatur verwenden.

## Was enthalten ist

- eine lokale, token-geschützte HTTP-API als Kern;
- ein optionaler MCP-Wrapper, der ausschließlich die API aufruft;
- ein portables Windows-x64-Paket mit eigener Node-Laufzeit;
- ein deutscher Setup-Wizard mit fensterlosem API-Start;
- öffentliche Skills für Prüfung und Einrichtung;
- versionierte Produktprofile und gemeinsame API-/MCP-Vertragstests.

Aktuell ist Profil `2025` mit Engine-Hauptversion 31 freigegeben. Andere
Produktversionen werden nicht automatisch bedient. Das Projekt ist unabhängig
und weder mit Wolters Kluwer, Steuertipps noch der Akademischen
Arbeitsgemeinschaft verbunden.

## Einrichtung

### Portables Release

1. Von der [Release-Seite](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases)
   `steuer-spar-erklaerung.zip` und die zugehörige `.sha256`-Datei laden.
2. SHA-256 prüfen und das ZIP in einen lokalen Ordner entpacken.
3. `sse-setup.cmd` starten oder den
   [Setup-Skill](skills/steuer-spar-erklaerung-setup/SKILL.md) verwenden.
4. Die vorgeschlagenen sicheren Standardwerte übernehmen oder Pfade und
   Arbeitsweise einzeln festlegen.

Der Wizard erkennt eine vorhandene Konfiguration am Standardpfad, erzeugt bei
Bedarf ein lokales Token und legt außerhalb des Repositorys an:

- API-Konfiguration und fensterlosen Starter;
- eine optionale MCP-Mergevorlage;
- `setup-decisions.json` für maschinenlesbare Entscheidungen;
- `settings.md` für persönliche Prioritäten und Quellen;
- `tracking.md` oder eine Referenz auf eine vorhandene `.xlsx`-Datei;
- getrennte Ordner für Dokumentkopien, Ergebnisse und Backups.

Mit `--defaults` läuft die technische Einrichtung mit sicheren Vorgaben.
`--no-start` erzeugt nur die Dateien. Sonst fragt der Wizard, ob er die API
jetzt fensterlos starten und Health, Discovery sowie Arbeitsbereich prüfen darf.
Die API kann Markdown-Fortschritte als neue datierte Snapshots anlegen, ersetzt
aber keine vorhandene Trackingdatei. Eine referenzierte XLSX-Datei wird nur über
eine separat verfügbare Tabellen-Fähigkeit des Agenten gelesen oder geändert.

### Aus dem Quellcode

Nur Entwicklung und Ausführung direkt aus dem Repository benötigen Node.js 22
oder neuer mit npm:

```powershell
npm ci
npm run build
npm run setup -- --no-start
```

Python und PowerShell 7 sind nicht erforderlich. Die Windows-Automation nutzt
Windows PowerShell 5.1.

## API verwenden

Die API bindet ausschließlich an Loopback (`127.0.0.1` oder `::1`) und verlangt
ein Bearer-Token. Sie beschreibt ihre freigegebenen Operationen selbst:

```powershell
steuer-spar-erklaerung-call health
steuer-spar-erklaerung-call discovery
steuer-spar-erklaerung-call describe workspace_status
steuer-spar-erklaerung-call workspace_status
```

Komplexe Argumente werden über eine begrenzte UTF-8-JSON-Datei oder stdin
übergeben, damit Token, Pfade und Nutzdaten nicht in der sichtbaren
Prozesskommandozeile erscheinen. Für eigene Clients stehen zur Verfügung:

- `GET /healthz`
- `GET /v1/operations`
- `GET /v1/operations/{operation}`
- `GET /v1/openapi.json`
- `POST /v1/operations/{operation}`

Beispiel für einen direkten Aufruf:

```powershell
$body = @{ args = @{}; timeoutMs = 5000 } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:43127/v1/operations/workspace_status' `
  -Headers @{ Authorization = 'Bearer <LOKALES_TOKEN>' } `
  -ContentType 'application/json' -Body $body
```

Operationen verwenden logische Ressourcen wie `cases:`, `documents:` und
`results:`. Dadurch müssen API-Clients keine lokalen PC-Pfade kennen.

## MCP optional anbinden

MCP ist ein dünner Wrapper über dieselbe API. Der Wrapper kennt nur URL und
Token; SSE-, Fall- und Dokumentpfade bleiben in der lokalen API-Konfiguration.
Die vom Setup erzeugte Servervorlage wird nach Prüfung in die Konfiguration des
jeweiligen Clients gemergt:

```json
{
  "mcpServers": {
    "steuer-spar-erklaerung": {
      "command": "<PORTABLE>/runtime/node.exe",
      "args": ["<PORTABLE>/dist/index.js"],
      "env": {
        "SSE_API_URL": "http://127.0.0.1:43127",
        "SSE_API_TOKEN": "<LOKALES_TOKEN>"
      }
    }
  }
}
```

`command` soll direkt auf die portable `runtime/node.exe` zeigen. So werden
zusätzliche Batch-/Shim-Prozesse und unnötige Konsolenfenster vermieden. Eine
vorhandene Client-Konfiguration nie vollständig ersetzen; nur den bestätigten
Servereintrag mergen.

## Sicherheitsmodell

- ELSTER-, Versand- und Übermittlungsaktionen sind im Katalog gesperrt.
- Lesen ist der Standard; Änderungen brauchen eine ausdrückliche Freigabe.
- Schreiboperationen arbeiten mit PID/HWND, erwarteter Seite und
  Vorher-/Nachher-Prüfung.
- Steuerdateien werden nur als hashgebundene Arbeitskopien bearbeitet.
- Originale werden weder überschrieben noch gelöscht.
- API-Logs enthalten keine Argumente, Ergebnisse oder Tokens.
- MCP gibt keine lokalen PC-Pfade an den Client weiter.

Die Automation kann fachliche Fehler nicht ausschließen. Vor einer Abgabe sind
Steuerfall, Belege und Programmprüfung selbst zu kontrollieren. Details stehen
in der [Produktarchitektur](docs/ARCHITEKTUR.md) und im
[Betriebsvertrag](skills/steuer-spar-erklaerung/references/betriebsvertrag.md).

## Umsatzsteuer-Voranmeldung

Die UStVA-Werkzeuge wählen Zeitraum und Formularabschnitt über stabile
Fachschlüssel. Sie prüfen vorhandene Übermittlungen, lesen Werte zurück und
speichern oder senden nicht automatisch.

```text
Bereite meine Umsatzsteuer-Voranmeldung für Juli in einer verifizierten
Arbeitskopie vor. Prüfe zuerst Jahr, Meldezeitraum, vorhandene Übermittlungen
und Belege. Zeige jede Änderung und sende nichts über ELSTER ab.
```

Der vollständige Ablauf ist unter
[Umsatzsteuer-Voranmeldung](docs/UMSATZSTEUER-VORANMELDUNG.md) beschrieben.

## Entwicklung und Tests

```powershell
npm ci
npm run test:fast
npm test
npm run package:portable
```

`npm test` prüft unter anderem API-/MCP-Parität, Argumentverträge,
Sicherheitsgrenzen, Backups, Skills, Links und Repository-Datenschutz. Echte
UI-Tests benötigen eine ausdrücklich konfigurierte neutrale Testdatei; private
Steuerfälle gehören nicht in das Repository.

Weitere Unterlagen:

- [Abgleichvorlage](docs/ABGLEICH-BEISPIEL.md)
- [Produktarchitektur](docs/ARCHITEKTUR.md)
- [Entwicklungswissen](docs/entwicklung/README.md)
- [Haupt-Skill](skills/steuer-spar-erklaerung/SKILL.md)
- [Setup-Skill](skills/steuer-spar-erklaerung-setup/SKILL.md)

## Lizenz

[MIT](LICENSE)
