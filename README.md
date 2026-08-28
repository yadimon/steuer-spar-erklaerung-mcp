# Inoffizielle API und MCP für SteuerSparErklärung

[![Windows CI](https://github.com/yadimon/steuer-spar-erklaerung-mcp/actions/workflows/windows-ci.yml/badge.svg)](https://github.com/yadimon/steuer-spar-erklaerung-mcp/actions/workflows/windows-ci.yml)

Steuerfälle mit einem KI-Agenten prüfen, mit Belegen abgleichen und nach
Freigabe kontrolliert bearbeiten – über eine gemeinsame lokale API und einen
optionalen, PC-blinden MCP-Wrapper.

> **Öffentliche Beta für Windows x64.** Vor der ersten Änderung den aktuellen
> Dateistand einmal privat sichern und Ergebnisse selbst prüfen. Dieses Projekt ist keine
> Steuerberatung und übermittelt nichts an das Finanzamt.

## Features

- SteuerSparErklärung 2025 / Engine 31: einen geöffneten Steuerfall
  strukturiert lesen, navigieren und den Programm-Prüfer auswerten;
- ein bis 20 katalogisierte Felder derselben geöffneten Seite mit
  `fill_fields` in einem frischen Worker sequenziell schreiben, unmittelbar
  prüfen, bei Fehler best effort zurückrollen und gemeinsam zurücklesen;
- BelegManager: eine bereits geoeffnete Belegliste focusless und strukturiert
  lesen; die neun katalogisierten Wege fuer Navigation, Detailauswahl, Import,
  Bearbeitung, Klassifikation, Verknuepfung und Loeschen sind im aktuellen
  Hintergrundbetrieb fail-closed gesperrt, weil ihre verifizierte Umsetzung
  sichtbaren Vordergrund oder globale physische Eingabe benoetigt;
- Angaben mit freigegebenen Belegen und einem Tracking abgleichen;
- fehlende, widersprüchliche oder unklare Angaben als Report zusammenfassen;
- den eindeutig geöffneten Fall nach einer hashverifizierten Sicherung des
  aktuellen Dateistands kontrolliert ändern und zurücklesen, ohne ihn
  automatisch zu speichern oder durch eine Arbeitskopie zu ersetzen;
- Umsatzsteuer-Voranmeldung: UStVA-Zeiträume für 2025 sowie vorgesehene
  `GewErfass2026`-Fälle vorbereiten, ohne sie zu übermitteln;
- 99 versionierte Operationen über lokale HTTP-API oder optional über den
  PC-blinden MCP-Wrapper für Codex, Claude Code und kompatible Agenten.

Die Beta ersetzt weder SteuerSparErklärung noch eine fachliche Prüfung. Sie
automatisiert nachvollziehbare Arbeitsschritte in der installierten Anwendung.

## Voraussetzungen

- Windows x64 und eine installierte SteuerSparErklärung 2025;
- ein **lokal** laufender Agent mit Zugriff auf lokale Dateien und Programme,
  zum Beispiel Codex, die eigenständig angemeldete Claude Code CLI oder
  OpenCode; Claude Cowork ist für dieses host-lokale Setup nicht geeignet;
- für sichtbare Bedienung eine entsperrte, währenddessen unbenutzte
  Windows-Sitzung.

Installiert wird ausschließlich aus der npm-Registry; das setzt Node.js 22+
mit npm voraus. Python, PowerShell 7, Docker und ein Repository-Checkout sind
nicht erforderlich. Alle Voraussetzungen, der Installationsweg,
Client-Anbindung und Erfolgskriterien stehen in der
[Installationsanleitung für Menschen und AI-Agenten](docs/INSTALLATION.md).
Die native Claude Code CLI unter Windows benötigt zusätzlich Git for Windows
und eine eigene Anmeldung in `claude`; eine Anmeldung in Claude Desktop oder
Cowork ersetzt diese CLI-Anmeldung nicht.

## Prompts

### Bereits geöffneten Fall bearbeiten

Der normale Alltag braucht keine zusätzliche Falldatei:

```text
Ändere im bereits geöffneten Steuerfall <WERT/FELD>. Sichere den aktuellen
Dateistand vorher einmal privat. Lass den Fall geöffnet und speichere ihn nicht.
```

Ist genau ein Fall offen, bleibt er der Arbeitsfall. Die Sicherung liegt im
privaten `backups:`-Bereich und wird nie geöffnet. Solange der Dateihash in
dieser Aufgabe unverändert bleibt, wird sie auch für mehrere Felder oder
Folgeaufrufe wiederverwendet. Erst ein ausdrücklich beauftragtes und geprüftes
Speichern erzeugt einen neuen Dateistand, der vor einer späteren Änderung neu
gesichert wird. `Save As`, eine Arbeits-/Korrekturkopie, Schließen, Verwerfen
oder ein Dateiwechsel sind keine impliziten Sicherheitsmaßnahmen.

### Basic Prompt

Für die normale lokale Einrichtung mit API und MCP reichen Ziel und Pfade:

```text
Nutze https://github.com/yadimon/steuer-spar-erklaerung-mcp und prüfe meine
Einkommensteuererklärung 2025.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER_ODER_KEINE_BELEGE>
Standard-Einrichtung und Prüflauf ausführen. Nichts über ELSTER senden.
```

`Standard-Einrichtung und Prüflauf ausführen` bestätigt Einrichtung (lokale
API plus MCP) und Prüflauf zugleich. Die Prüfung läuft in derselben Sitzung
über die lokale API; MCP wird nach dem nächsten Start des Agenten verifiziert.
Ist bereits ein Fall offen, startet der isolierte Prüflauf keine zweite
Instanz: Der Agent fragt zuerst, ob er den offenen Fall in-place lesen oder ihn
auf ausdrücklichen Wunsch schließen soll.

### Robuster isolierter Prüflauf

Wenn SteuerSparErklärung, Node.js 22+ und der lokale Agent schon installiert
sind, verwendet dieser strengere Prompt nur eine temporäre NPX-API ohne MCP,
globale Installation oder dauerhaften Launcher:

```text
Arbeite ausschließlich nach diesen Referenzen:
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/skills/steuer-spar-erklaerung/SKILL.md
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md

Führe einen isolierten, temporären Nur-Lese-Prüflauf für
SteuerSparErklärung 2025 aus. Starte die lokale API im Vordergrund über npx.
Kein MCP, keine globale Installation und keine dauerhafte Konfiguration.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER_ODER_KEINE_BELEGE>

Prüfe zuerst health, product_info und capabilities. Erzeuge vor sichtbarer
Navigation eine neue SHA-256-verifizierte Arbeitskopie; öffne oder ändere nie
den Originalfall. Führe Standard-Prüflauf, Belegabgleich und Programm-Prüfer
aus. Nicht speichern und nichts über ELSTER senden. Bei unklarer Identität,
Version, Bindung oder Beleglage fail-closed stoppen.

Danach die Arbeitskopie ohne Speichern schließen, bestätigen, dass keine
SteuerSparErklärung-Instanz offen ist, und die NPX-API beenden. Berichte die
ausgeführten Prüfungen und verbleibenden Grenzen ohne private Pfade oder
Steuerdaten auszugeben.
```

Dieser isolierte Prompt setzt voraus, dass `sse_instances` leer ist. Bei einem
bereits offenen Fall muss der Agent vor Kopie, Schließen oder Dateiwechsel
fragen und darf keine zweite SSE-Instanz öffnen.

`Standard-Prüflauf ausführen` bestätigt dabei zugleich, dass die genannten
Belegpfade vollständig sind.

Der Agent startet `@yadimon/steuer-spar-erklaerung-api` im Vordergrund,
bindet den bestätigten Fallordner nur an diesen Prozess und verwendet die
enthaltene CLI aus demselben Paket. Beim ersten Lauf entstehen nur
private Arbeitsordner im lokalen Benutzerprofil, aber keine globale Paketinstallation
und kein dauerhafter Startpfad in den NPX-Cache.
Nach dem Report beendet der Agent die API wieder.
MCP und ein Agenten-Neustart sind für diesen Weg nicht nötig.

Läuft bereits eine dauerhaft installierte API auf demselben Loopback-Port,
muss sie zuerst beendet werden; der npx-Start meldet den belegten Port dann
ausdrücklich und arbeitet nicht still über die andere Instanz weiter. Soll aus
diesem Kurzweg später eine dauerhafte Installation im Ordner werden, zuerst
die npx-API mit Strg+C beenden.

Der isolierte Prüflauf isoliert Installation und Steuerfalländerungen, braucht
aber weiterhin einen lokal auf Windows laufenden Agenten. Eine entfernte
Sandbox ohne Zugriff auf die installierte Desktop-Anwendung kann ihn nicht
ausführen.

### Referenzdokumente

- [Installation und Erfolgskriterien](docs/INSTALLATION.md)
- [Haupt-Skill und sicherer Standardablauf](skills/steuer-spar-erklaerung/SKILL.md)
- [Produktarchitektur](docs/ARCHITEKTUR.md)
- [Versionierter API-/MCP-Vertrag](docs/API-MCP-VERTRAG.md)
- [Umsatzsteuer-Voranmeldung](docs/UMSATZSTEUER-VORANMELDUNG.md)
- [Verifikationsstand und Grenzen](docs/VERIFIKATION.md)

## Dauerhaftes Setup mit zwei Prompts

### 1. Lokal installieren

Gib einem **lokalen** Agenten diesen Auftrag. Er installiert Skill, API und
MCP in einen eigenen Ordner:

```text
Richte SteuerSparErklärung vollständig lokal nach
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md
ein. Installiere oder aktualisiere den Skill und verwende die neueste
veröffentlichte Version.
Standard-Setup ausführen: lokale API plus MCP.
```

`Standard-Setup ausführen` bestätigt den eng begrenzten sicheren Plan der
verlinkten Anleitung einschließlich Download, Installation in den Ordner und
des bedingten additiven MCP-Merges. Der Agent zeigt Plan und Diff
weiterhin an, fragt innerhalb dieser Grenzen aber nicht erneut. Die
Einrichtung verändert keinen Steuerfall.

Nach einer neuen oder geänderten Skill-/MCP-Installation endet der erste Lauf
mit einem grünen `health` und dem Status, dass die Client-Verifikation nach
einem Neustart noch offen ist. Starte den lokalen Agenten dann einmal neu und verwende
Prompt 2. Der neu geladene Agent prüft Serverliste und das echte MCP-Tool
`sse_health` mit `ok=true`, bevor er den Steuerfall bearbeitet. So bleiben es
zwei Prompts; „connected“ oder ein Handshake allein gelten nicht als Nachweis.
Für Codex begrenzt die Installationsanleitung den Modellkatalog auf die
Kernwerkzeuge des Standard-Prüflaufs; alle 99 Operationen bleiben über die
lokale API-CLI verfügbar. Das verhindert, dass aktuelle Codex-Versionen den
großen unbeschränkten MCP-Katalog vollständig ausblenden.

### 2. Steuerfall prüfen

Danach genügt ein fachlicher Prompt mit den echten Pfaden:

```text
Nutze $steuer-spar-erklaerung und prüfe meine Einkommensteuererklärung 2025.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER>
Standard-Prüflauf ausführen.
```

`Standard-Prüflauf ausführen` steht im Skill bereits für die
hashverifizierte Prüffallkopie, sichtbare rein lesende Navigation, den Report
und das Schließen genau dieser Prüffallkopie ohne Speichern sowie den Stopp ohne
ELSTER. Diese Sicherheitsdetails müssen nicht in jedem Prompt wiederholt werden.

Eine im Kalenderjahr 2026 abgegebene Einkommensteuererklärung ist hier der
unterstützte Steuerfall **2025**. Das Produktprofil 2026 ist nicht freigegeben.
Nur dieser ausdrücklich isolierte Standard-Prüflauf erzeugt vor sichtbarer
Navigation eine SHA-256-verifizierte Prüffallkopie. Normale Aufträge am bereits
geöffneten Fall erzeugen keine Kopie und speichern ihn nicht automatisch.

### Skills manuell mit `npx` installieren

Die offene [`skills`-CLI](https://www.skills.sh/docs/cli) erkennt den
[Repository-Skill](skills/). Ersetze `<agent>` durch `codex`, `claude-code`
oder `opencode`:

```powershell
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp --list
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent <agent> --global --copy --yes
```

Die vollständigen nichtinteraktiven Varianten bleiben explizit dokumentiert:

```powershell
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp --skill steuer-spar-erklaerung --agent codex --global --copy --yes
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp --skill steuer-spar-erklaerung --agent claude-code --global --copy --yes
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp --skill steuer-spar-erklaerung --agent opencode --global --copy --yes
```

OpenCode bleibt ein sekundärer, best-effort Client. Mit bereits vorhandenem
Node.js/npm ist sein kurzer Runtime-Weg nach der Skill-Installation:

```powershell
npm.cmd install --global @yadimon/steuer-spar-erklaerung-api @yadimon/steuer-spar-erklaerung-mcp
```

Für den empfohlenen Standardweg sind Codex oder die eigenständig angemeldete Claude
Code CLI die belastbarer geprüften Clients. Cowork ist wegen seiner isolierten
Ausführungsumgebung kein Host-Installer für lokale API und MCP.

Eine nur geöffnete oder gecachte Webansicht ist keine lokale Skill-
Installation; nach dem Kopieren den Agenten neu laden und den Skill
auflisten.

`npx skills` installiert nur die geprüften Agentenanweisungen und setzt Node.js 22+ mit npm voraus.
Danach installiert der Agent API und MCP nach der Anleitung persistent in den
Ordner. Fehlt Node.js, nennt er es als Voraussetzung und stoppt.

### Runtime mit npm

Die npm-Pakete sind getrennt: API und CLI bleiben im Windows-Paket;
der PC-blinde MCP-Wrapper kann unabhängig installiert werden. Der empfohlene
Weg installiert beide Pakete in exakt derselben Version in einen Ordner:

```powershell
npm.cmd install @yadimon/steuer-spar-erklaerung-api @yadimon/steuer-spar-erklaerung-mcp
.\node_modules\.bin\steuer-spar-erklaerung-api.cmd --config <ABSOLUTER_ORDNER>\config.json
```

Ein Einrichtungsprogramm gibt es nicht: Der erste Start legt die Arbeitsordner
an, und die Konfigurationsdatei ist optional. Die
kanonische
[Installationsanleitung](docs/INSTALLATION.md)
enthält die kopierbaren PowerShell-Befehle. Pfade unter
`AppData\Local\Packages\Claude_*\LocalCache` sind kein clientübergreifend
belastbarer MCP-Setup-Erfolg und dürfen nicht aus Cowork oder der Desktop-App
als Host-Installation übernommen werden.

Für einen bewusst später ergänzten MCP-Transport ist auch
`npm.cmd install @yadimon/steuer-spar-erklaerung-mcp` zulässig; seine Version
muss exakt zum API-Paket passen.

Die dauerhafte Installation nie direkt aus `npx` anmelden: Der temporäre
`_npx`-Cache ist kein stabiler Ort für API-/MCP-Startpfade. Der oben beschriebene
Foreground-NPX-Start ist davon getrennt: Er schreibt keinen Launcher und endet
mit dem Terminalprozess. Ohne Node/npm ist das Produkt nicht installierbar; der Weg unten
vollständig gleichwertig.

Die Windows-Beispiele verwenden bewusst `npm.cmd` und `npx.cmd`. Damit bleibt
eine frische PowerShell-Execution-Policy unverändert, auch wenn sie die parallel
installierten Shim-Dateien `npm.ps1` oder `npx.ps1` blockiert.

## Beispiel

![Ein Agent bedient einen Musterfall über die lokale API und den MCP-Wrapper](docs/assets/demo/steuer-spar-erklaerung-demo.gif)

## Typische Aufgaben

| Ziel | Auftrag an den Agenten | Standard |
| --- | --- | --- |
| Steuerfall prüfen | „Prüfe den geöffneten Fall und liste Fehler, Warnungen und unklare Angaben.“ | Nur lesen |
| Belege abgleichen | „Vergleiche den Fall mit den Belegen in diesem Ordner.“ | Originale unverändert lassen |
| Geöffneten Fall ändern | „Ändere diese Werte im geöffneten Fall, aber speichere noch nicht.“ | Einmal sichern, ändern, zurücklesen, offen lassen |
| Separate Korrekturdatei | „Erzeuge ausdrücklich eine Korrekturkopie und ändere sie.“ | Neue Datei nur auf diesen Auftrag |
| UStVA vorbereiten | „Bereite die UStVA für Juli vor und sende sie nicht ab.“ | Zeitraum und vorhandene Übermittlungen zuerst prüfen |
| Nur API einrichten | „Richte nur die lokale API ein und verwende empfohlene Antworten.“ | npm-Installation; kein MCP-Merge |
| Vollständiges Agenten-Setup | „Richte lokale API plus MCP vollständig ein.“ | npm-Installation; additiver MCP-Merge |

Die Automation unterscheidet drei Betriebsarten:

Für einen bereits übermittelten Fall erzeugt der Agent **nicht automatisch**
eine Korrekturdatei. Er erklärt die Sperre und wartet auf den ausdrücklichen
Auftrag, eine separat als `Korrektur` oder `Berichtigung` benannte Datei
anzulegen. `sse_save` akzeptiert diesen Stand nur mit
ausdrücklicher Freigabe, exaktem Zeitraum und Grund sowie den erwarteten SHA256
von Original und Sicherung. Ein allgemeines `force` existiert bewusst nicht.
Bei einer UStVA-Berichtigung wird zusätzlich im ausgewählten Zeitraum
`sse_ustva_set_flag` mit `flag="corrected"` gesetzt und zurückgelesen. Keine
dieser Operationen übermittelt Daten an ELSTER.

1. strukturierte UIA-Lesewege ohne Vordergrundwechsel;
2. wenige ausdrücklich profilierte Focusless-Transaktionen mit Feld-, Summen-
   und Dirty-State-Readback;
3. sichtbare Vordergrund-Leases für Controls, die Qt nicht sicher im
   Hintergrund bedienbar macht.

Die dritte Betriebsart ist kein Freischalter fuer den BelegManager: Dort ist
nur `receipt_manager_list` als `focusless-read` verfuegbar. Die neun uebrigen
BelegManager-Operationen bleiben registriert, werden aber in
`capabilities.operationPolicy` als `foreground-required` und `blocked`
ausgewiesen und enden vor Workerstart und UI-Aenderung. Es gibt dafuer weder
API- noch MCP-Opt-in und ein solcher Fehler darf nicht automatisch wiederholt
oder durch Maus-/Tastaturautomation umgangen werden.

Für sichtbare Bedienung muss Windows entsperrt bleiben. Während der Agent
klickt oder schreibt, nicht gleichzeitig Maus oder Tastatur verwenden. Der
Worker gibt das zuvor aktive Fenster und den Mauszeiger best effort zurück,
sofern keine fremde Eingabe erkannt wurde. Die Sicherheits-Telemetrie bleibt
im vollständigen API-Ergebnis und bei den gemeinsamen API-Werkzeugen im
kanonischen MCP-Strukturergebnis erhalten.

Lock-pflichtige PowerShell-Worker mehrerer API-Prozesse oder direkte Worker in
derselben Windows-Sitzung teilen zusätzlich genau einen SSE-/UIA-Controller. Ein
konkurrierender Workerabschnitt wartet nicht, sondern liefert strukturiert
`busy`/`session-controller-busy`; erst nach Abschluss mit frischen Bindungen
wiederholen. Lokale API-Pfade und die Lücken zwischen mehreren Worker-Schritten
einer zusammengesetzten Operation sind nicht von diesem Mutex umfasst.
`product_info` und `page_objects` umgehen ihn, weil sie keine Produktfenster
oder UIA berühren. Diese technische Serialisierung ersetzt nicht die Eingabe-,
Vordergrund- und Interferenzwächter gegenüber einem Menschen.
Bei einem vom Profil abweichenden Minor-/Patch-Build bleiben Lesen, Diagnose
und sicherer Cleanup erreichbar. Die in
`capabilities.operationPolicy[*].blockedOnBuildDrift` ausgewiesenen
UI-/Steuerfallmutationen stoppen serverseitig mit `build-drift`, bis der neue
Build live verifiziert wurde.
`capabilities.liveEvidence.operationStatus` trennt zusätzlich je Operation
den releasegebundenen Live-Nachweis von bloßer Offline-Abdeckung. Diese Matrix
ist informativ (`affectsAvailability=false`); nur `operationPolicy` entscheidet
über die tatsächliche Laufzeitfreigabe. Reine API-Clients erhalten denselben
Snapshot auch über die Operations-Discovery.

## Was enthalten ist

- eine lokale HTTP-API auf Loopback als Kern, ohne Anmeldung und mit
  Herkunftsprüfung gegen Aufrufe aus dem Browser;
- ein optionaler MCP-Wrapper, der ausschließlich die API aufruft;
- lokale PDF-zu-PNG- und Bild-OCR-Helfer ohne Python-/Poppler-Pflicht;
- getrennte npm-Pakete für Windows-API und PC-blinden MCP-Wrapper;
- ein deutscher Skill für Prüfung und Einrichtung;
- versionierte Produktprofile und gemeinsame API-/MCP-Vertragstests.

| Profil | Status | Aktuell belegter Umfang |
| --- | --- | --- |
| `2025` / Engine 31 | `supported` / `full` | Lesen, Navigation, Ergebnis und Prüfer live geprüft; UStVA-Read für 2025 sowie `GewErfass2026` live geprüft; Schreibpfade nur einzeln freigegeben |
| `2024` / Engine 30 | `experimental` / `verification-only` | derselbe read-only Muster-Sweep nur mit bewusstem Entwickler-Opt-in; keine allgemeine Schreibfreigabe und kein Focusless-Commit |

Der veröffentlichte Beta-Release unterstützt weiterhin Profil `2025`. Der
Quellstand enthält zusätzlich das experimentelle Profil `2024`; der Skill
bietet es nicht produktiv an. Details und genaue Testgrenzen stehen im
[Verifikationsstand](docs/VERIFIKATION.md). Das Projekt ist unabhängig und
weder mit Wolters Kluwer, Steuertipps noch der Akademischen
Arbeitsgemeinschaft verbunden.

## Einrichtung

### npm-Pakete

`@yadimon/steuer-spar-erklaerung-api` ist der lokale Windows-x64-
API-Wrapper für SteuerSparErklärung. Er enthält HTTP-API, direkte CLI, Profile,
Windows-/Native-Runtime; er enthält keinen MCP-Server.
`@yadimon/steuer-spar-erklaerung-mcp` ist der PC-blinde MCP-Wrapper für
SteuerSparErklärung über dieses API-Paket. Er kennt ausschließlich die API-URL
und automatisiert die Oberfläche nicht selbst. Beide Pakete müssen
dieselbe Version tragen und zum vollständigen GitHub-Release gehören.
Die npm-Seiten besitzen eigene Einstiege für das
[API-Paket](packages/api/README.md) und den
[MCP-Wrapper](packages/mcp/README.md); diese erklären Voraussetzungen,
Paketgrenzen und Sicherheitsregeln ohne einen lokalen Repository-Checkout.

Ein Einrichtungsprogramm gibt es nicht. Der erste API-Start legt neben dem
angegebenen `--config`-Pfad an:

- getrennte Ordner für Dokumentkopien, Ergebnisse und Backups;
- ein `logs`-Verzeichnis für das API-Protokoll.

Die Konfigurationsdatei selbst ist **optional** und wird nur für einen
abweichenden Port, ein festgepinntes `sseExecutable` oder einen festen
`caseDir` gebraucht. `settings.md` für persönliche Prioritäten und Quellen
sowie `tracking.md` legt der Nutzer beziehungsweise der Agent im Arbeitsbereich
an. Die API kann Markdown-Fortschritte als neue datierte Snapshots anlegen,
ersetzt aber keine vorhandene Trackingdatei. Eine referenzierte XLSX-Datei wird nur über
eine separat verfügbare Tabellen-Fähigkeit des Agenten gelesen oder geändert.

### Aus dem Quellcode

Nur Entwicklung und Ausführung direkt aus dem Repository benötigen Node.js 22
oder neuer mit npm:

```powershell
npm ci
npm run build
npm run start:api
```

Python und PowerShell 7 sind nicht erforderlich. Die Windows-Automation nutzt
Windows PowerShell 5.1.

## API verwenden

Die API bindet ausschließlich an Loopback (`127.0.0.1` oder `::1`) und kennt
keine Anmeldung: Jeder lokale Prozess darf sie aufrufen, ein Browser nicht.
Anfragen mit `Origin` oder `Sec-Fetch-Site` sowie mit einem `Host` außerhalb
von Loopback beantwortet sie mit `403`. Genau das trennt einen lokalen Klienten
von einer Webseite, die dieselbe Adresse erreichen kann; die `Host`-Regel
schlägt zusätzlich DNS-Rebinding.

Sie beschreibt ihre freigegebenen Operationen selbst:

```powershell
steuer-spar-erklaerung-call health
steuer-spar-erklaerung-call discovery
steuer-spar-erklaerung-call describe workspace_status
steuer-spar-erklaerung-call workspace_status
```

Komplexe Argumente werden bevorzugt über eine begrenzte UTF-8-JSON-Datei
übergeben, damit Pfade und Nutzdaten nicht in der sichtbaren
Prozesskommandozeile erscheinen. Mehrzeilige oder nicht-ASCII Texte gehören
immer in diese Datei; eine Windows-PowerShell-stdin-Pipeline kann Umlaute durch
`?` ersetzen. Für kleine ASCII-Objekte bleibt `--args-file -` verfügbar. Für
eigene Clients stehen zur Verfügung:

- `GET /healthz`
- `GET /v1/operations`
- `GET /v1/operations/{operation}`
- `GET /v1/openapi.json`
- `POST /v1/operations/{operation}`

Operationen verwenden logische Ressourcen wie `cases:`, `documents:` und
`results:`. Dadurch müssen API-Clients keine lokalen PC-Pfade kennen.

## MCP als optionale Produktfunktion anbinden

MCP ist ein dünner Wrapper über dieselbe API. Sein Prozess kennt nur die
API-URL; SSE-, Fall- und Dokumentpfade bleiben in der lokalen API. Ein reines
API-Setup braucht MCP nicht. Der oben dokumentierte vollständige
Agenten-Standard enthält MCP, weil Prompt 1 ausdrücklich „lokale API plus MCP“
beauftragt.

Der Servereintrag besteht aus der absoluten `node.exe` und dem MCP-Einstieg,
ohne weitere Argumente und ohne Umgebungsvariablen — der Wrapper findet die
API über den Standardport:

```json
{
  "mcpServers": {
    "steuer-spar-erklaerung": {
      "command": "<ABSOLUTE>/node.exe",
      "args": ["<ORDNER>/node_modules/@yadimon/steuer-spar-erklaerung-mcp/dist/index.js"]
    }
  }
}
```

Kein `.cmd`-Shim, kein `npx`: Seit Node 20 verweigert `spawn` Batchdateien ohne
Shell, und der Client meldet dann nur `EINVAL`.

Eine vorhandene Client-Konfiguration nie vollständig ersetzen; nur den
bestätigten Servereintrag mergen. Danach die Serverliste des neu geladenen
Clients und einen echten Aufruf des MCP-Tools `sse_health` mit `ok=true`
prüfen. Ein bloßes „connected“ oder ein Handshake genügt nicht.

## Sicherheitsmodell

Die lokale API erzwingt technisch:

- ELSTER-, Versand- und Übermittlungsaktionen sind im Katalog gesperrt.
- Die API ist nur über Loopback erreichbar und weist Anfragen aus einem
  Browser anhand von `Origin`, `Sec-Fetch-Site` und `Host` ab.
- Schreiboperationen arbeiten mit PID/HWND, erwarteter Seite und
  Vorher-/Nachher-Prüfung.
- Arbeitskopien, Backups und Archive entstehen nur an neuen Zielen: ein
  vorhandenes Ziel wird nie überschrieben, und die Kopie wird byteweise
  zurückgelesen.
- Speichern ist an den erwarteten Pfad und den erwarteten Hash gebunden.
- Mehrdeutige SSE-Fenster brechen ab statt zu raten.
- API-Logs enthalten keine Argumente und keine Ergebnisse.
- MCP gibt keine lokalen PC-Pfade an den Client weiter.

Der Prüfablauf der Skills garantiert zusätzlich:

- Lesen ist der Standard; Änderungen brauchen eine ausdrückliche Freigabe.
- Ein eindeutig geöffneter Fall bleibt der Arbeitsfall. Vor der ersten
  potenziell dirty-machenden Navigation oder Mutation wird sein aktueller
  Disk-Hash einmal nach `backups:` gesichert; dieselbe Sicherung gilt für
  denselben unveränderten Dateistand der laufenden Aufgabe.
- Ändern ist keine Speicherfreigabe. `sse_save`, `sse_save_as`, Schließen,
  Verwerfen, Dateiwechsel und eine `cases:`-Kopie brauchen jeweils den dazu
  passenden ausdrücklichen Auftrag.
- Routineänderungen hinterlassen keine zusätzliche Report- oder Falldatei;
  isolierte Prüfläufe und ausdrücklich bestellte Reports bleiben möglich.

Diese zweite Liste ist Ablaufdisziplin, keine technische Sperre der API: Die
direkte lokale API kann jede ausdrücklich benannte Datei öffnen und speichern.
Ebenso ist `--case-dir` die Auflösungs- und Schwärzungsgrenze für
`cases:`-Referenzen und keine Zugriffssperre der direkten API.

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
Bereite meine Umsatzsteuer-Voranmeldung für Juli im bereits geöffneten Fall
vor. Sichere den aktuellen Dateistand einmal, speichere danach nicht. Prüfe
zuerst Jahr, Meldezeitraum, vorhandene Übermittlungen und Belege. Zeige jede
Änderung und sende nichts über ELSTER ab.
```

Der vollständige Ablauf ist unter
[Umsatzsteuer-Voranmeldung](docs/UMSATZSTEUER-VORANMELDUNG.md) beschrieben.

## Entwicklung und Tests

Jeder Push und Pull Request läuft durch das read-only Windows-Gate
`Offline API/MCP and package gate`: gesperrte Installation, Produktions-Audit,
komplette Offline-Suite und saubere Installation beider erzeugten npm-Pakete.
Live-UI-Tests bleiben bewusst opt-in, weil sie eine installierte Anwendung und
eine unbenutzte Windows-Sitzung benötigen.

```powershell
npm ci
npm run test:fast
npm test
npm run test:live
npm run pack
npm run publish:dry-run
npm run test:npm-clean-install
npm run smoke:published
```

Maintainer können sämtliche lokalen Release-Gates mit `npm run check`
zusammenfassen. `npm run release:current` ist absichtlich stärker: Es darf nur
auf einem sauberen, releasefertig versionierten `main` laufen, erstellt und
prüft Tag sowie GitHub-Prerelease, startet anschließend Trusted Publishing und
installiert zum Schluss beide exakten Registry-Pakete für einen realen Smoke.

Jeder Build entfernt ausschließlich veraltete `dist/*.js`- und
`dist/*.js.map`-Dateien ohne passende TypeScript-Quelle. Unbekannte Dateien
oder Links im Buildordner stoppen fail-closed. Die beiden npm-Paketverträge
prüfen zusätzlich, dass kein quellloses Artefakt ausgeliefert wird, die API
keinen MCP-Server enthält und der MCP-Tarball weder PowerShell noch Profile
kennt.

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

Alle 99 API-Operationen veröffentlichen mindestens ein eigenes fachliches
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
- [Release Notes v0.1.0-beta.19](docs/releases/v0.1.0-beta.19.md)
- [Entwicklungswissen](docs/entwicklung/README.md)
- [Mitwirken](CONTRIBUTING.md)
- [Haupt-Skill](skills/steuer-spar-erklaerung/SKILL.md)
- [Installationsanleitung](docs/INSTALLATION.md)

## Feedback und Beiträge

Fehlerberichte und Pull Requests sind willkommen. Niemals echte Steuerfälle,
Belege, Namen, Steuer-IDs, Tokens, lokale Pfade oder ungeschwärzte Screenshots
öffentlich hochladen. Der [Beitragsleitfaden](CONTRIBUTING.md) beschreibt
Entwicklungsumgebung, Tests und Datenschutz; Sicherheitsprobleme gehören in
den privaten GitHub-Bereich **Report a vulnerability**.

## Lizenz

[MIT](LICENSE)
