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
- `powershell/render-pdf.ps1` und `powershell/ocr-image.ps1`
- `sse-setup.cmd`

Nutze die neben dem ZIP im selben Release veröffentlichte `.sha256`-Datei.
Prüfe, dass Sidecar, ZIP, Release-Tag und `portable-manifest.json` zueinander
gehören. Entpacke erst nach erfolgreicher äußerer Hashprüfung in einen neuen,
leeren Zielordner. Bevorzuge das in Windows enthaltene
`$env:SystemRoot\System32\tar.exe -xf <zip> -C <ziel>`; es verarbeitet das
Portable-Release mit seinen vielen kleinen Dateien wesentlich schneller als
`Expand-Archive`. Warte den Prozessabschluss ab und verlange Exitcode 0. Ein
Timeout oder ein bereits teilweise gefülltes Ziel ist kein Erfolg: nicht
fortsetzen und nicht in denselben Ordner nachentpacken. Prüfe danach die
Dateihashes des internen Manifests, falls das Release
dafür eine Prüfroutine bereitstellt. Parse `portable-manifest.json` dabei als
JSON und vergleiche gezielt nur die benötigten Pfade. Drucke weder das
vollständige Manifest noch dessen gesamte Dateiliste in den Agentenkontext und
verwende keine breite Quelltextsuche als Ersatz für die veröffentlichte
Selbstbeschreibung.

Der PDF-Helper muss als eigener
`powershell.exe -NoProfile -NonInteractive -File powershell/render-pdf.ps1`
Prozess laufen. Erfolg verlangt Exitcode 0, `ok=true` im kompakten JSON und
lesbare create-only PNG-Dateien. Das schützt auch Windows-Builds, deren WinRT-
PDF-Runtime beim normalen Prozessabbau sonst einen fremden Restcode setzt.

## Bestätigten First-run-Plan anwenden

Nach den zwei Nutzerbestätigungen und `OK Standard` erzeugt der Hauptskill eine
kurze private JSON-Datei mit `schemaVersion: 1`, `profileId`, dem absoluten
`caseDir`, den absoluten `sourceFolders` und optional einem eindeutig erkannten
`sseExecutable`. Starte den Wizard mit `--plan-file <absoluter-planpfad>`.
Andere Felder, relative oder fehlende Ordner und widersprüchliche bestehende
Konfigurationen werden fail-closed abgelehnt. Insbesondere kann der Plan weder
Token noch Schreibmodus, Connectorzugriff, MCP-Merge, Autostart oder ELSTER-
Autorität setzen. Verwende dafür keine simulierte Prompt-Eingabe.

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
