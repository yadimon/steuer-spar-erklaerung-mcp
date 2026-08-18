# npm-/Portable-Installation und Client-Anbindung

## Weg wählen

Eine funktionierende vorhandene Installation wird immer wiederverwendet.
Andernfalls gilt:

- Ist Node.js 22 oder neuer mit npm bereits vorhanden, darf nach bestätigtem
  Plan `@yadimon/steuer-spar-erklaerung-api@beta` persistent installiert
  werden. Das getrennte Paket
  `@yadimon/steuer-spar-erklaerung-mcp@beta` kommt nur bei bestätigtem
  MCP-Wunsch dazu.
- Fehlt eine passende Node/npm-Laufzeit, verwende das Portable-Release. Node,
  npm, Python oder PowerShell 7 werden nicht eigens installiert.

Der npm-Weg ist kein Quellbuild. Lies vor der Installation beide Registry-
Versionen, sofern MCP gewünscht ist, und verlange dieselbe Version sowie den
gleichnamigen vollständigen GitHub-Release. Starte Setup nie direkt aus
`npx`: dessen `_npx`-Cache ist flüchtig und ungeeignet für dauerhafte API- und
MCP-Startpfade.

## Releaseinhalt

Ermittle das aktuellste veröffentlichte, nicht als Draft markierte Release oder
Prerelease über die direkte GitHub-Release-Liste des kanonischen Repositorys.
Akzeptiere nur einen Eintrag, der beide exakten Assets
`steuer-spar-erklaerung.zip` und `steuer-spar-erklaerung.zip.sha256` enthält.
Verlasse dich weder auf Suchtreffer noch auf gecachten Seitentext und kodiere
keine konkrete Beta- oder Versionsnummer in den Ablauf.

Verifiziere mindestens:

- `portable-manifest.json`
- `runtime/node.exe`
- `dist/api-main.js`, `dist/index.js` und `dist/setup-main.js`
- `profiles/<id>/profile.json` und dessen Page-Objects
- `powershell/sse-worker.ps1` samt nativen Hilfsdateien
- `sse-setup.cmd`

Nutze die neben dem ZIP im selben Release veröffentlichte `.sha256`-Datei.
Prüfe, dass Sidecar, ZIP, Release-Tag und `portable-manifest.json` zueinander
gehören. Prüfe danach die Dateihashes des internen Manifests, falls das Release
dafür eine Prüfroutine bereitstellt.

## Setup-Ausgabe

Der Wizard erzeugt außerhalb des Releaseordners:

- eine lokale API-Konfiguration mit Loopback-Host, Token, Profil und Pfaden,
- eine vollständige MCP-Mergevorlage,
- einen fensterlosen VBS-Starter für genau diese Konfiguration,
- `setup-decisions.json` mit Modus, Quellen, Connector-Freigaben und
  Tracking-Entscheidung,
- `settings.md` mit den lesbaren Nutzerprioritäten,
- ein neues `tracking.md` oder die unveränderte Referenz auf eine vorhandene
  `.xlsx`-Trackingdatei,
- bei bestätigtem Ersetzen redigierte Backups vorhandener Setup-Dateien.

Verwende die ausgegebenen echten Dateinamen. Keine Namen oder JSON-Felder
hinzuerfinden. Der MCP-Eintrag darf nur API-URL und Token als PC-bezogene
Betriebswerte benötigen; lokale SSE-/Fall-/Workspace-Pfade gehören allein in
die API-Konfiguration.
Als `command` immer den vom Wizard ausgegebenen absoluten Pfad zur echten
`node.exe` übernehmen. Beim Portable-Weg ist das die ausgelieferte
`runtime/node.exe`; beim npm-Weg die Node-Datei, mit der der persistente
Setup-Wizard läuft. Niemals `node`, `node.cmd`, `npx`, eine Volta-/npm-
Shimdatei oder einen Batch-Wrapper eintragen; solche Zwischenstufen können
zusätzliche `cmd.exe`-Prozesse und sichtbare schwarze Fenster erzeugen. Die
MCP-Argumentdatei muss beim npm-Weg innerhalb des dauerhaft installierten
`@yadimon/steuer-spar-erklaerung-mcp` liegen, niemals unter `_npx`.

## Manuelle Agentenaktion

Kann der Agent seine Konfiguration nicht selbst ändern, zeige die vollständige
Mergevorlage und bitte um genau eine Aktion:

> Bitte mergen Sie den gezeigten Servereintrag in die genannte
> Agenten-Konfiguration, speichern Sie die Datei, laden Sie den Agenten neu und
> antworten Sie „Fertig“. Empfohlene Antwort danach: Fertig.

Erst danach Serverliste und Health prüfen. Die bloße Existenz der JSON-Datei
beweist keine geladene MCP-Verbindung.
