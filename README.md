# Inoffizielle API und MCP für SteuerSparErklärung

Steuerfälle mit einem KI-Agenten prüfen, mit Belegen abgleichen und nach
Freigabe kontrolliert bearbeiten – über eine gemeinsame lokale API und einen
optionalen, PC-blinden MCP-Wrapper.

> **Öffentliche Beta für Windows x64.** Vor Änderungen eine Sicherungskopie
> anlegen und Ergebnisse selbst prüfen. Dieses Projekt ist keine
> Steuerberatung und übermittelt nichts an das Finanzamt.

## Was die Beta kann

- einen geöffneten Steuerfall strukturiert lesen und den Programm-Prüfer
  auswerten;
- Angaben mit freigegebenen Belegen und einem Tracking abgleichen;
- fehlende, widersprüchliche oder unklare Angaben als Report zusammenfassen;
- nach ausdrücklicher Freigabe einzelne Korrekturen ausschließlich in einer
  verifizierten Arbeitskopie durchführen und zurücklesen;
- UStVA-Zeiträume für 2025 sowie vorgesehene `GewErfass2026`-Fälle vorbereiten,
  ohne sie zu übermitteln;
- dieselben freigegebenen Funktionen über lokale HTTP-API oder optional MCP
  für Codex, Claude Code und kompatible Agenten bereitstellen.

Die Beta ersetzt weder SteuerSparErklärung noch eine fachliche Prüfung. Sie
automatisiert nachvollziehbare Arbeitsschritte in der installierten Anwendung.

## Voraussetzungen

- Windows x64 und eine installierte SteuerSparErklärung 2025;
- ein Agent mit Zugriff auf lokale Dateien und Programme, zum Beispiel Codex
  oder Claude Code;
- für sichtbare Bedienung eine entsperrte, währenddessen unbenutzte
  Windows-Sitzung.

Das portable Release benötigt kein global installiertes Node.js, npm, Python
oder PowerShell 7. Der optionale Weg über `npx skills` und die getrennten
npm-Runtimepakete setzt ein bereits vorhandenes Node.js 22+ mit npm voraus.

## Schnellstart

### Ohne npm

Gib einem Agenten mit GitHub- und lokalem Dateizugriff diesen Auftrag:

```text
Öffne https://github.com/yadimon/steuer-spar-erklaerung-mcp und lies
skills/steuer-spar-erklaerung/SKILL.md. Folge dem Skill auf Deutsch.
Prüfe meine Steuererklärung 2025 zunächst nur lesend. Finde zuerst den
wahrscheinlichen Steuerfall und die Belegordner und lass sie mich bestätigen.
Richte danach bei Bedarf alles mit sicheren Standardwerten ein.
```

Der Agent schlägt zuerst einen wahrscheinlichen Steuerfall oder wenige
plausible Kandidaten und die passenden Belegordner vor. Nach diesen beiden
Bestätigungen kann `OK`, `OK Standard` oder `OK Default` alle angezeigten
sicheren technischen Defaults gemeinsam übernehmen. Danach führt der Agent
durch das aktuellste passende veröffentlichte Portable-Release, Prüfsumme und
Einrichtung und setzt die read-only Prüfung automatisch fort. Das portable
Release bringt seine eigene Laufzeit mit; Node.js/npm, Python und PowerShell 7
müssen nicht global installiert werden. Wenn der Agent keine Programme starten
darf, kann das ZIP von der
[Release-Seite](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases)
manuell geladen und anschließend `sse-setup.cmd` gestartet werden.

### Mit `npx skills` (optional)

Die offene [`skills`-CLI](https://www.skills.sh/docs/cli) erkennt beide
[Repository-Skills](skills/). Für Codex werden sie unter Windows so
benutzerweit und ohne Rückfragen als Kopie installiert:

```powershell
npx skills add yadimon/steuer-spar-erklaerung-mcp --list
npx skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --skill steuer-spar-erklaerung-setup `
  --agent codex --global --copy --yes
```

Für Claude Code ist nur der Agentname anders:

```powershell
npx skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --skill steuer-spar-erklaerung-setup `
  --agent claude-code --global --copy --yes
```

Danach genügt zum Beispiel:

```text
Prüfe meine Steuererklärung in SteuerSparErklärung 2025. Gleiche sie mit
meinen Belegen ab und ändere nichts ohne meine ausdrückliche Freigabe.
```

`npx skills` installiert nur die geprüften Agentenanweisungen. Ist Node.js 22+
mit npm bereits vorhanden, kann der Skill anschließend das API-Paket und auf
Wunsch den getrennten MCP-Wrapper persistent installieren. Sonst führt er
durch Download, Prüfsumme und Einrichtung des portablen Releases. Vor der Installation kann der
[Haupt-Skill](skills/steuer-spar-erklaerung/SKILL.md) vollständig gelesen
werden.

### Runtime mit npm (optional)

Die npm-Pakete sind getrennt: API, Setup und CLI bleiben im Windows-Paket;
der PC-blinde MCP-Wrapper kann unabhängig installiert werden. Der normale
Skill-Wizard übernimmt diese Befehle nach Bestätigung. Manuell lautet der
API-only-Weg:

```powershell
npm install --global @yadimon/steuer-spar-erklaerung-api@beta
steuer-spar-erklaerung-setup
```

Nur wenn der Agent MCP verwenden soll, kommt das zweite Paket dazu:

```powershell
npm install --global @yadimon/steuer-spar-erklaerung-mcp@beta
steuer-spar-erklaerung-setup
```

Setup nie direkt aus `npx` starten: Der temporäre `_npx`-Cache ist kein
stabiler Ort für dauerhafte API-/MCP-Startpfade. Für Nutzer ohne Node/npm ist
der Portable-Weg unten vollständig gleichwertig.

## Beispiel

![Ein Agent bedient einen Musterfall über die lokale API und den MCP-Wrapper](docs/assets/demo/steuer-spar-erklaerung-demo.gif)

## Typische Aufgaben

| Ziel | Auftrag an den Agenten | Standard |
| --- | --- | --- |
| Steuerfall prüfen | „Prüfe den geöffneten Fall und liste Fehler, Warnungen und unklare Angaben.“ | Nur lesen |
| Belege abgleichen | „Vergleiche den Fall mit den Belegen in diesem Ordner.“ | Originale unverändert lassen |
| Korrektur vorbereiten | „Schlage Korrekturen vor und ändere nach meiner Freigabe eine Arbeitskopie.“ | Vorher/nachher zurücklesen |
| UStVA vorbereiten | „Bereite die UStVA für Juli vor und sende sie nicht ab.“ | Zeitraum und vorhandene Übermittlungen zuerst prüfen |
| Nur einrichten | „Richte die lokale API ein und verwende empfohlene Antworten.“ | npm oder Portable; direkte API, MCP optional |

Die Automation unterscheidet drei Betriebsarten:

1. strukturierte UIA-Lesewege ohne Vordergrundwechsel;
2. wenige ausdrücklich profilierte Focusless-Transaktionen mit Feld-, Summen-
   und Dirty-State-Readback;
3. sichtbare Vordergrund-Leases für Controls, die Qt nicht sicher im
   Hintergrund bedienbar macht.

Für sichtbare Bedienung muss Windows entsperrt bleiben. Während der Agent
klickt oder schreibt, nicht gleichzeitig Maus oder Tastatur verwenden. Der
Worker gibt das zuvor aktive Fenster und den Mauszeiger best effort zurück,
sofern keine fremde Eingabe erkannt wurde. Die Sicherheits-Telemetrie bleibt
im vollständigen API-Ergebnis und bei den gemeinsamen API-Werkzeugen im
kanonischen MCP-Strukturergebnis erhalten.
Bei einem vom Profil abweichenden Minor-/Patch-Build bleiben Lesen, Diagnose
und sicherer Cleanup erreichbar. Die in
`capabilities.operationPolicy[*].blockedOnBuildDrift` ausgewiesenen
UI-/Steuerfallmutationen stoppen serverseitig mit `build-drift`, bis der neue
Build live verifiziert wurde.
`capabilities.liveEvidence.operationStatus` trennt zusätzlich je Operation
den releasegebundenen Live-Nachweis von bloßer Offline-Abdeckung. Diese Matrix
ist informativ (`affectsAvailability=false`); nur `operationPolicy` entscheidet
über die tatsächliche Laufzeitfreigabe. Reine API-Clients erhalten denselben
Snapshot auch über die authentifizierte Operations-Discovery.

## Was enthalten ist

- eine lokale, token-geschützte HTTP-API als Kern;
- ein optionaler MCP-Wrapper, der ausschließlich die API aufruft;
- ein portables Windows-x64-Paket mit eigener Node-Laufzeit;
- getrennte npm-Pakete für Windows-API und PC-blinden MCP-Wrapper;
- ein deutscher Setup-Wizard mit fensterlosem API-Start;
- öffentliche Skills für Prüfung und Einrichtung;
- versionierte Produktprofile und gemeinsame API-/MCP-Vertragstests.

| Profil | Status | Aktuell belegter Umfang |
| --- | --- | --- |
| `2025` / Engine 31 | `supported` / `full` | Lesen, Navigation, Ergebnis und Prüfer live geprüft; UStVA-Read für 2025 sowie `GewErfass2026` live geprüft; Schreibpfade nur einzeln freigegeben |
| `2024` / Engine 30 | `experimental` / `verification-only` | derselbe read-only Muster-Sweep nur mit bewusstem Entwickler-Opt-in; keine allgemeine Schreibfreigabe und kein Focusless-Commit |

Der veröffentlichte Beta-Release unterstützt weiterhin Profil `2025`. Der
Quellstand enthält zusätzlich das experimentelle Profil `2024`; der Wizard
bietet es nicht produktiv an. Details und genaue Testgrenzen stehen im
[Verifikationsstand](docs/VERIFIKATION.md). Das Projekt ist unabhängig und
weder mit Wolters Kluwer, Steuertipps noch der Akademischen
Arbeitsgemeinschaft verbunden.

## Einrichtung

### npm-Pakete

`@yadimon/steuer-spar-erklaerung-api@beta` enthält API, Setup-Wizard, direkte
CLI, Profile und die Windows-/Native-Runtime. Es enthält keinen MCP-Server.
`@yadimon/steuer-spar-erklaerung-mcp@beta` enthält nur den MCP-Clientgraphen
und kennt weiterhin ausschließlich API-URL und Token. Beide Pakete müssen
dieselbe Version tragen und zum vollständigen GitHub-Release gehören.

### Portables Release

1. Von der [Release-Seite](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases)
   `steuer-spar-erklaerung.zip` und die zugehörige `.sha256`-Datei laden.
2. SHA-256 prüfen und das ZIP in einen lokalen Ordner entpacken.
3. `sse-setup.cmd` starten oder den
   [Setup-Skill](skills/steuer-spar-erklaerung-setup/SKILL.md) verwenden.
4. Die vorgeschlagenen sicheren Standardwerte übernehmen oder Pfade und
   Arbeitsweise einzeln festlegen.

Die Prüfsumme lässt sich im Downloadordner mit Windows PowerShell vergleichen:

```powershell
$actual = (Get-FileHash -Algorithm SHA256 '.\steuer-spar-erklaerung.zip').Hash.ToLowerInvariant()
$expected = ((Get-Content '.\steuer-spar-erklaerung.zip.sha256' -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
if ($actual -ne $expected) { throw 'SHA-256 stimmt nicht. ZIP nicht verwenden.' }
"SHA-256 stimmt: $actual"
```

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

Für `*.GewErfass2026` wird weiterhin die installierte Anwendung für das
Steuerjahr 2025 verwendet, aber der Fall muss mit `mode=einurvor` gestartet
werden. `product_info`/`sse_product_info` nennt die freigegebenen Folgejahre
unter `supportedCaseYears`; die UStVA-Lesung gibt den tatsächlichen Formularjahrgang
separat als `taxYear=2026` zurück.

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
npm run test:live
npm run package:portable
npm run pack
npm run publish:dry-run
npm run test:npm-clean-install
```

Jeder Build entfernt ausschließlich veraltete `dist/*.js`- und
`dist/*.js.map`-Dateien ohne passende TypeScript-Quelle. Unbekannte Dateien
oder Links im Buildordner stoppen fail-closed. Die beiden npm-Paketverträge
prüfen zusätzlich, dass kein quellloses Artefakt ausgeliefert wird, die API
keinen MCP-Server enthält und der MCP-Tarball weder PowerShell noch Profile
kennt. `package:portable` öffnet das erzeugte
ZIP vor dem Schreiben der äußeren Prüfsumme erneut: Pfade, Windows-Kollisionen,
Produkt/Version, Dateizahl, Bytezahl und SHA-256 jeder manifestierten Datei
müssen exakt stimmen; Extra-Dateien stoppen den Build.

Der Native-Build verwendet eine vorhandene `sse-native.dll` nur wieder, wenn
striktes Manifest, aktueller C#-Quellhash, tatsächlicher DLL-Hash und die
vollständige erwartete Typ-/Methodenoberfläche gemeinsam passen. Dadurch bleibt
das erneut geprüfte Artefakt bei unveränderter Quelle stabil; Änderung,
Beschädigung oder ein inkompatibles Compilerartefakt erzwingt einen
vollständigen Neubau. Der mit
Windows PowerShell 5.1 verfügbare .NET-Framework-Compiler garantiert für zwei
frische Builds jedoch keine byteidentische DLL. Das Manifest bindet deshalb
immer die konkret ausgelieferten Bytes, nicht ein angenommenes Build-Ergebnis.

`npm test` prüft unter anderem API-/MCP-Verträge, Argumentgrenzen, Backups,
Skills, Links und Repository-Datenschutz, startet aber keine echte SSE-UI. Das
strikte opt-in Live-Gate verwendet ausschließlich herstellereigene
Wegwerfkopien, prüft beide Profile nacheinander und lässt fehlende
Voraussetzungen nicht als grünen SKIP gelten:

```powershell
npm run test:live
```

Private Steuerfälle gehören nicht in das Repository. Welche Operationen nur
ein Schema/Mock, einen echten Leseweg oder eine Mutation belegen, ist in
[Verifikation](docs/VERIFIKATION.md) getrennt aufgeführt.

Beide Läufe schließen mit zwei Laufzeitbilanzen ab: Jede Operation, die
während der Suite einen echten API-Executor erreicht, wird protokolliert und
gegen `test/operation-coverage.json` geprüft. Verschwundene Abdeckung ist eine
Regression, neu entstandene muss bewusst übernommen werden
(`SSE_WRITE_OPERATION_COVERAGE=1`). Parallel hält
`test/operation-result-shape.json` ausschließlich Ergebnisfeldnamen und
wertfreie JSON-Typklassen fest. Bei einem Objektfeld werden zusätzlich dessen
sichere direkte Schlüsselnamen und Typklassen erfasst – niemals Steuerwerte,
Pfade oder tiefer verschachtelte Inhalte. Neue
Felder oder Typvarianten brauchen `SSE_WRITE_OPERATION_SHAPE=1`. Die Bilanzen
sind damit die verbindliche Antwort auf „welche API-Funktion und Ergebnisform
ist wirklich belegt?" – Prosa ist es nicht.

Alle 87 API-Operationen veröffentlichen mindestens ein eigenes fachliches
Ergebnisfeld. Die Schemas bleiben trotzdem vorwärtskompatible
Mindestverträge: Nicht jedes optionale Worker-Feld und nicht jeder UI-Zustand
ist bereits durch einen echten Live-Lauf erzeugt.

Das Live-Gate braucht eine unbenutzte Windows-Sitzung: Navigation läuft über
echte Mausklicks, und Windows verweigert den Vordergrundwechsel, solange
nebenher gearbeitet wird.

Weitere Unterlagen:

- [Abgleichvorlage](docs/ABGLEICH-BEISPIEL.md)
- [Produktarchitektur](docs/ARCHITEKTUR.md)
- [API-/MCP-Vertrag](docs/API-MCP-VERTRAG.md)
- [Verifikationsstand](docs/VERIFIKATION.md)
- [Release-Prozess](docs/RELEASE.md)
- [Release Notes v0.1.0-beta.4](docs/releases/v0.1.0-beta.4.md)
- [Entwicklungswissen](docs/entwicklung/README.md)
- [Mitwirken](CONTRIBUTING.md)
- [Haupt-Skill](skills/steuer-spar-erklaerung/SKILL.md)
- [Setup-Skill](skills/steuer-spar-erklaerung-setup/SKILL.md)

## Feedback und Beiträge

Fehlerberichte und Pull Requests sind willkommen. Niemals echte Steuerfälle,
Belege, Namen, Steuer-IDs, Tokens, lokale Pfade oder ungeschwärzte Screenshots
öffentlich hochladen. Der [Beitragsleitfaden](CONTRIBUTING.md) beschreibt
Entwicklungsumgebung, Tests und Datenschutz; Sicherheitsprobleme gehören in
den privaten GitHub-Bereich **Report a vulnerability**.

## Lizenz

[MIT](LICENSE)
