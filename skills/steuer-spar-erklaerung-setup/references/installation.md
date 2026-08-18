# Portable Installation und Client-Anbindung

## Releaseinhalt

Verifiziere mindestens:

- `portable-manifest.json`
- `runtime/node.exe`
- `dist/api-main.js`, `dist/index.js` und `dist/setup-main.js`
- `profiles/<id>/profile.json` und dessen Page-Objects
- `powershell/sse-worker.ps1` samt nativen Hilfsdateien
- `sse-setup.cmd`

Nutze die neben dem ZIP veröffentlichte `.sha256`-Datei. Prüfe danach die
Dateihashes des internen Manifests, falls das Release dafür eine Prüfroutine
bereitstellt.

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
Als `command` immer den absoluten Pfad zur ausgelieferten `runtime/node.exe`
übernehmen. Niemals `node`, `node.cmd`, `npx`, eine Volta-/npm-Shimdatei oder
einen Batch-Wrapper eintragen; solche Zwischenstufen können zusätzliche
`cmd.exe`-Prozesse und sichtbare schwarze Fenster erzeugen.

## Manuelle Agentenaktion

Kann der Agent seine Konfiguration nicht selbst ändern, zeige die vollständige
Mergevorlage und bitte um genau eine Aktion:

> Bitte mergen Sie den gezeigten Servereintrag in die genannte
> Agenten-Konfiguration, speichern Sie die Datei, laden Sie den Agenten neu und
> antworten Sie „Fertig“. Empfohlene Antwort danach: Fertig.

Erst danach Serverliste und Health prüfen. Die bloße Existenz der JSON-Datei
beweist keine geladene MCP-Verbindung.
