# Installation und Client-Anbindung

**Codex: Plugin-Installation vorläufig nicht empfohlen.** Codex begrenzt die
Metadaten von MCP-Werkzeugen aus Agent Plugins auf insgesamt **64 000 Bytes**.
Bei beta55 wurde dadurch ein Katalog mit **26 von 104** verfügbaren Werkzeugen
reproduziert; auch `sse_preflight` kann fehlen. Die Empfehlung der
Plugin-Installation für Codex ist deshalb vorübergehend ausgesetzt.
Direkt registrierte npm-MCP-Verbindungen sind von diesem Plugin-Budget nicht
betroffen. Diese Grenze betrifft den Codex-Integrationsweg; sie belegt keinen
allgemeinen Fehler der API, des MCP oder anderer Clients. Siehe
[Codex-Quellcode](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_exposure.rs)
und [bekannte Meldung](https://github.com/openai/codex/issues/49758).

## Voraussetzungen

- Windows x64;
- Node.js 22 oder neuer;
- installierte SteuerSparErklärung 2025;
- lokal installierter Codex- oder Claude-Code-Client auf demselben PC;
- Git auf `PATH` zusätzlich für den Plugin-Installer `plugins@1.3.4`.

Python, PowerShell 7, eine globale npm-Paketinstallation und ein Windows-Dienst
sind keine Produktvoraussetzungen. Die Windows-Automation verwendet die
mitgelieferte Runtime und Windows PowerShell 5.1 als Systembestandteil.
Codex Cloud, Claude im Browser und entfernte Sandboxes können die lokale
Windows-Anwendung nicht bedienen. OpenCode gehört nicht zur dokumentierten
und geprüften Client-Matrix.

## Codex: direktes MCP + API aus npm

Installiere das MCP-Paket in einen eigenen Ordner auf einem lokalen, nicht
synchronisierten Laufwerk. npm installiert die API als exakt versionsgleiche
Dependency. Den Skill separat installieren oder einen vorhandenen passenden
Skill weiterverwenden.

Für eine von Desktop-App und normalem Terminal gemeinsam verwendete Runtime
einen Ordner außerhalb von `AppData` wählen. Windows kann neue Dateien einer
paketierten Desktop-App unter `AppData` in deren privaten `LocalCache`
umleiten. Die App sieht dann die Installation am scheinbar normalen Pfad,
während ein unabhängiger Codex-App-Server dort `MODULE_NOT_FOUND` meldet.
Der folgende Pfad unter `USERPROFILE` vermeidet diese Umleitung. Siehe
[Microsoft: AppData-Umleitung bei paketierten Apps](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes#appdata-operations-on-windows-10-version-1903-and-later).

### Neue Installation

Das Beispiel verwendet einen neuen Runtime-Ordner. Bei einer vorhandenen
Installation zuerst [deren Verbindung und Datenbindungen erhalten](#vorhandenes-codex-plugin-umstellen).

```powershell
$RuntimeRoot = Join-Path $env:USERPROFILE '.local\share\SteuerSparErklaerungMcp'
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
Set-Location $RuntimeRoot
npm.cmd init -y
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest

$Node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$Mcp = Join-Path $RuntimeRoot 'node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js'
$ApiConfig = Join-Path $RuntimeRoot 'sse-api-config.json'
codex mcp add steuer-spar-erklaerung --env "SSE_API_CONFIG=$ApiConfig" -- $Node $Mcp
```

Der MCP-Eintrag startet die absolute `node.exe` mit dem absoluten MCP-Skript.
Beim MCP-Start laufen weder npm noch npx und es ist kein Netzwerkzugriff nötig.
Der Supervisor startet die installierte API bei Bedarf unsichtbar im
Hintergrund. Der Start öffnet weder SteuerSparErklärung noch einen Steuerfall.

### API-Lebensdauer bei Codex unter Windows

Vor einem Fachauftrag ein Terminal außerhalb von Codex öffnen, etwa über das
Windows-Startmenü. Dort die projektlokale API starten und dieses Terminal offen
lassen. Ein zweiter Codex-Toolprozess kann weiterhin denselben Killjob erben:

```powershell
$Api = Join-Path $RuntimeRoot 'node_modules\@yadimon\steuer-spar-erklaerung-api\dist\api-main.js'
& $Node $Api --config $ApiConfig
```

Danach Codex in einem zweiten Terminal starten. Dieselbe vorhandene
API-Konfiguration verwenden; der MCP übernimmt nur die exakt passende
API-Version und Konfigurationsidentität. Diese Befehle starten noch keine SSE.

Codex 0.167.0 schließt lokale Windows-MCP-Prozessbäume beim Entladen einer
Verbindung in einem Job ohne Breakaway. Eine automatisch vom MCP gestartete
API und deren neue SSE können dadurch ebenfalls enden. Node `detached:true`
garantiert keine unabhängige Lebensdauer innerhalb eines solchen Jobs. Siehe
[Codex-Prozessverwaltung](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/rmcp-client/src/stdio_server_launcher.rs)
und [Microsoft: verschachtelte Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs).

Der sichtbare SSE-Start prüft deshalb die tatsächlich beobachtete
Jobvererbung vor dem Workerstart. Ein geerbter Kill-on-close-Job ohne stilles
Breakaway führt zu `launch-error` und `mutationStarted=false`; es startet
keine SSE. Eine kleine, hashgebundene native Leseprobe vermeidet dabei den
zusätzlichen libuv-Job normaler Node-Kindprozesse. Dies erkennt den genannten
Hostfall, beweist aber nicht die Lebensdauer jeder denkbaren äußeren Jobkette.
Der private Desktop-Start behält seinen vorhandenen expliziten Breakaway-Vertrag.

Läuft bereits eine automatisch gestartete API, keine zweite Instanz auf
demselben Port starten. Zuerst den gebundenen Status lesen. Einen offenen
Steuerfall vor dem Wechsel auf ausdrücklichen Auftrag speichern; danach nur
die bestätigte API-Instanz kontrolliert beenden und die separate API mit
derselben Konfiguration starten. Keine Prozesse nach Namen beenden und keine
Schutzprüfung durch wiederholte Starts umgehen.

### Skill separat installieren

Bitte Codex mit seinem Skill Installer, den Skill aus
[diesem Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp/tree/main/skills/steuer-spar-erklaerung)
zu installieren; der Repository-Pfad lautet `skills/steuer-spar-erklaerung`.
Für einen fest gebundenen Release den zugehörigen Git-Tag statt `main`
verwenden. Der Skill enthält die Referenzen für Fallbindung, Sicherung,
Belegbuchungen und Speichern. Das npm-Paket allein installiert keinen Skill.

### Vorhandenes Codex-Plugin umstellen

1. Die bisherige Verbindung in den Plugin-/MCP-Einstellungen lesen; bei einer
   direkten Registrierung hilft `codex mcp get steuer-spar-erklaerung --json`.
   Eine vorhandene API-Konfiguration und ihre Fall-, Beleg-, Ergebnis-
   und Backupbindungen sichern und erhalten. Bei Nutzung des API-Standards
   unter `%LOCALAPPDATA%\SteuerSparErklaerungApi` diesen nicht unbeabsichtigt
   durch eine neue leere Konfiguration ersetzen.
2. Das npm-MCP wie oben auf einem lokalen Laufwerk installieren.
3. Nur den MCP-Eintrag des Steuer-Plugins deaktivieren, bevor die direkte
   Verbindung mit demselben Namen registriert wird:

   ```toml
   [plugins."steuer-spar-erklaerung@plugins-cli".mcp_servers.steuer-spar-erklaerung]
   enabled = false
   ```

4. `codex mcp add` mit absoluten Node-/MCP-Pfaden und dem bisherigen
   `SSE_API_CONFIG`-Wert ausführen. Wurde bisher der API-Standard ohne diesen
   Wert benutzt, ihn auch bei der direkten Verbindung weglassen.
5. In einer neuen Sitzung die aktive Verbindung und den vollständigen
   Werkzeugkatalog wie unter [First run](#client-neu-laden-und-first-run) prüfen.

Der Plugin-Skill kann aktiviert bleiben. Alternativ den Skill separat
installieren und nur das Steuer-Plugin deaktivieren. Niemals die gesamte
Plugin-Funktion von Codex als Teil dieser Umstellung ausschalten. Die übrigen
Plugins und bestehende Steuerfälle bleiben erhalten. Eine daneben vorhandene
globale npm-Installation ist eine getrennte Installation; `npm uninstall -g`
repariert keine fehlenden Werkzeuge eines Servers aus dem Plugin-Verzeichnis.

## Daten und Runtime getrennt halten

`node_modules`, npm-Cache und ausführbare Paketdateien gehören auf ein lokales,
nicht synchronisiertes Laufwerk. Der Auftragsordner mit Fällen und Belegen
darf getrennt liegen; er muss nicht in den Runtime-Ordner verschoben werden.
Auf synchronisierten Ordnern und Netzlaufwerken kann npm beim Entpacken mit
`TAR_ENTRY_ERROR`/`EBADF` scheitern. Auch Exitcode 0 allein ist dort kein
Installationsnachweis.

Ein absoluter `SSE_API_CONFIG`-Pfad wählt die API-Konfiguration und damit die
Fall-, Dokument-, Arbeits-, Ergebnis- und Backupbereiche. Eine vorhandene
Konfiguration im Auftragsordner darf weiterverwendet werden; vor Änderungen
ihre bestätigten Datenbindungen sichern und lesen. Die Paketdateien bleiben
auf dem lokalen Laufwerk. `caseDir` öffnet keinen Fall und ist keine
automatische Fallauswahl.

Ohne eigenen Konfigurationspfad verwendet die API ihren privaten Standard
unter `%LOCALAPPDATA%\SteuerSparErklaerungApi`. Ein eigener Auftragsordner allein
bedeutet keine physische Projektisolation der API-Arbeitsdaten.
`SSE_API_URL` ist nur für eine bewusst separat verwaltete Loopback-API gedacht.
Beide Variablen dürfen nicht gleichzeitig gesetzt sein.

Bei synchronisierten Falldateien vor Öffnen, Hashen oder Speichern den
Dateiabgleich abwarten. Eine externe Änderung am Disk-Hash verlangt eine neue
Fallbindung; ein möglicherweise schon ausgeführter Schreibschritt darf nicht
blind wiederholt werden.

## Claude Code: Agent Plugin

Das Agent Plugin bleibt für Claude Code unterstützt. Es liefert Skill, MCP,
exakt passende API, Windows-PowerShell-/Native-Runtime, Profile und
JavaScript-Dependencies gemeinsam aus. Im Auftragsordner wird kein
`node_modules` benötigt. Der einmalige Installer darf das Repository mit Git
von GitHub klonen; die spätere Runtime benötigt keinen Netzwerkdownload.

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target claude-code --scope user --yes
claude plugin list
```

Die target-native Anzeige muss den Eintrag mit `Scope: user` als `enabled`
ausweisen. Claude Code benötigt keinen zusätzlichen Codex-Aktivierungsbefehl.
Der User-Scope ist absichtlich gewählt: Mit `plugins@1.3.4 --scope project`
ließ sich der Claude-Eintrag target-nativ nicht zuverlässig entfernen.

Die automatische Zielerkennung von `plugins@1` ist unter Windows nicht
zuverlässig. Deshalb `--target claude-code` ausdrücklich setzen. Für einen
eigenen API-Arbeitsbereich `SSE_API_CONFIG` in der Umgebung des MCP-Servers
konfigurieren. Die clientverwalteten Plugin-Dateien unter `${PLUGIN_ROOT}`
nicht patchen; eine spätere Installation kann diesen Cache ersetzen.

### Codex-Plugin: bestehende Installationen und Diagnose

Die folgenden Befehle beschreiben den bisherigen Plugin-Weg. Wegen des
Metadatenbudgets sind sie kein empfohlener Codex-Schnellstart:

```powershell
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target codex --scope project --yes
codex plugin add steuer-spar-erklaerung@plugins-cli --json
codex plugin list --json
```

Der externe Installer kann Cache und Marketplace registrieren, während der
Client noch `not installed` meldet. Erst die target-native Registrierung
liefert `installed, enabled`; auch dieser Zustand beweist noch keinen
vollständigen Modellkatalog. Ein Readback kann bei betroffenen Clientversionen
selbst Cache-/Konfigurationszustand materialisieren und ersetzt deshalb
keinen vorgesehenen Installationsschritt.

`plugins@1.3.4` ignoriert den Scope bei Codex vollständig. Der Installer
schreibt in clientverwaltete Benutzer-Caches beziehungsweise Konfiguration.
`--scope project` ist dort keine physische Projektisolation.

## Client neu laden und First run

Nach direkter MCP-Registrierung und Skill-Installation Codex neu starten oder
eine neue Sitzung im gewünschten Auftragsordner öffnen. Nach einer
Claude-Plugin-Installation dessen Aktivstatus zurücklesen und den Client neu
starten beziehungsweise seine Plugins neu laden. Ein bereits laufender Chat
übernimmt neue Skills und MCP-Werkzeuge nicht zuverlässig.

Die Einrichtung ist erst nach dem Nachweis im Client vollständig:

1. Die aktive Verbindung verwendet den vorgesehenen absoluten Runtime-Pfad
   und die bestätigte API-Konfiguration. Bei Codex zeigt
   `codex mcp get steuer-spar-erklaerung --json` die Konfiguration und `/mcp`
   im TUI die aktiven Server. Ausgaben können private Pfade enthalten und
   gehören nicht unverändert in öffentliche Issues.
2. Der vollständige Katalog ist der Modellinstanz tatsächlich zugänglich.
   Der aktuelle Release registriert 104 MCP-Werkzeuge, darunter
   `sse_preflight`, `sse_instances`, `sse_make_working_copy` und `sse_save`.
   Eine reine `tools/list`-Antwort beweist diese Verfügbarkeit noch nicht.
   Direkte Werkzeuge können außerhalb der verschachtelten Liste `ALL_TOOLS`
   liegen; ihre Tooldefinitionen ebenfalls beachten.
3. Das echte MCP-Tool `sse_preflight` antwortet strukturiert. Ein
   Installerausgang, MCP-Handshake oder Shell-Aufruf von `health` ersetzt
   diesen Nachweis nicht.

Ein passender erster Prompt:

```text
Prüfe nur die Einrichtung mit dem echten MCP-Tool sse_preflight.
Starte SteuerSparErklärung nicht und öffne oder ändere keinen Steuerfall.
Melde, ob die Einrichtung bereit ist und welche Laufzeitblocker noch bestehen.
```

Ist SSE geschlossen, kann der Preflight korrekt `ok=true`, `setupReady=true`
und `ready=false` mit `SSE_NOT_RUNNING` melden. Das ist kein Installationsfehler
und keine Erlaubnis, die Anwendung automatisch zu starten.

Beim späteren Fachauftrag merkt sich der Skill den ursprünglichen Auftrag,
stellt höchstens eine Frage pro Nachricht und bevorzugt einen bereits
eindeutig geöffneten Fall. Andernfalls werden Fall und vollständige
Belegquellen bestätigt. Klare Freigaben weiterverwenden; nur fehlende
wesentliche Entscheidungen klären. Sicherung, Readback und Speicherauftrag
bleiben erforderlich. Über ELSTER wird niemals gesendet.

## Lokaler API-Singleton

Der MCP-Supervisor verwendet nur eine Loopback-API mit passendem Paketnamen,
derselben exakten Releaseversion, passendem API-Vertrag und identischer
Ressourcenbindung. Ist der Port frei, startet er die installierte API
unsichtbar. Parallele MCP-Starts konvergieren auf dieselbe Instanz; sie darf
über das Ende eines Clients hinaus weiterlaufen. SSE und Steuerfälle werden
dabei nicht gestartet.

Ein fremder Portinhaber, eine alte API oder eine unklare Identität wird weder
beendet noch ersetzt oder umgangen. Der MCP-Start hält dann fail-closed an.
`SSE_API_URL` benennt eine autoritative separat verwaltete API und verhindert
Autostart. Bei `SSE_API_CONFIG` verwaltet der Supervisor die passende API.

## Update

### Direktes npm-MCP für Codex

Im bestehenden lokalen Runtime-Ordner aktualisieren:

```powershell
npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest
npm.cmd ls @yadimon/steuer-spar-erklaerung-mcp @yadimon/steuer-spar-erklaerung-api
```

MCP und API müssen exakt dieselbe Releaseversion haben. Datenbindungen und
MCP-Startpfad erhalten; bei einem neuen Runtime-Ordner den absoluten Pfad im
Client gezielt aktualisieren. Den Skill auf den passenden Release abgleichen.
Alte Client-Sitzungen vor der Umschaltung beenden. Eine noch laufende alte API
zuerst eindeutig identifizieren und nur bewusst nach dem folgenden Vertrag
stoppen. Anschließend eine neue Sitzung starten und den Client-Katalog sowie
`sse_preflight` erneut prüfen. Ein npm-Exitcode allein beweist kein fertiges
Client-Update.

### Claude-Code-Plugin und bestehende Codex-Plugins

`plugins@1.3.4` hat kein eigenes `update`-Kommando. Für Claude Code den
zielgenauen `plugins@1 add`-Aufruf mit `--target claude-code --scope user`
wiederholen und Version, Scope und Aktivstatus target-nativ zurücklesen.
Die Codex-Plugin-Empfehlung bleibt ausgesetzt; bestehende Nutzer auf den
direkten MCP-Weg umstellen. Ein erfolgreicher Installer-Exitcode allein
beweist keine Aktualisierung oder vollständige Werkzeugverfügbarkeit.

## Entfernung

Die direkte Codex-Verbindung wird mit
`codex mcp remove steuer-spar-erklaerung` entfernt. Einen separat installierten
Skill nur auf ausdrücklichen Wunsch ebenfalls entfernen. Der MCP-Eintrag und
die API-Arbeitsdaten sind getrennt.

Ein bestehendes Steuer-Plugin über den jeweiligen Client entfernen und den
Status danach zurücklesen:

```powershell
codex plugin remove steuer-spar-erklaerung@plugins-cli
codex plugin list --json
```

Bei Claude Code zunächst die tatsächliche Plugin-ID und den Scope prüfen:

```powershell
claude plugin list
claude plugin uninstall steuer-spar-erklaerung@steuer-spar-erklaerung --scope user
claude plugin list
```

Bei abweichender Clientversion die angezeigte ID und den Scope verwenden.
`plugins@1.3.4` besitzt kein `remove`-Kommando; keine nicht vorhandenen
`plugins remove`- oder `plugins uninstall`-Befehle verwenden.

Eine Entfernung ist erst bestätigt, wenn die exakte Verbindung beziehungsweise
Plugin-ID nicht mehr aktiviert oder installiert erscheint. Andere Plugins
bleiben erhalten. Falls eine manuelle Cache-Bereinigung erforderlich ist,
zuerst den vom Client referenzierten absoluten Zielpfad prüfen; keine
übergeordneten Plugin-, Cache- oder Benutzerordner rekursiv löschen.

Die Entfernung löscht bewusst nicht `%LOCALAPPDATA%\SteuerSparErklaerungApi`,
einen eigenen `SSE_API_CONFIG`-Arbeitsbereich, Fälle, Belege, Ergebnisse oder
Backups. Diese Nutzerdaten nur nach separater Prüfung und ausdrücklichem Auftrag
entfernen. Ein schon laufender API-Singleton braucht einen eigenen bewussten
Stopp nach dem folgenden Vertrag.

## API-Singleton bewusst beenden

Bevorzugt `sse_api_control` verwenden: erst `action=status`, dann für die
zurückgelesene `instanceId` bewusst `action=shutdown` mit `confirm=true`.
Annahme und Prozessende getrennt prüfen. Der API-Stopp schließt SSE und den
Steuerfall nicht. Ein Neustart braucht einen eigenen `action=start`-Auftrag;
nach einem bewussten Stopp erfolgt kein stiller Neustart.

Niemals Prozesse pauschal nach `node`, `SSE`, Fenstername oder Port beenden.
Ist MCP nicht erreichbar, zuerst `/healthz` am konfigurierten Loopback-Ziel
lesen und Paketname, exakte Version und `processId` prüfen. Genau diese PID
mit `Get-CimInstance Win32_Process` verifizieren. Die Kommandozeile muss auf
die API des erwarteten Pakets zeigen. Nur bei vollständiger Übereinstimmung:

```powershell
Stop-Process -Id <VERIFIZIERTE_PROCESS_ID>
```

Bei fehlender oder widersprüchlicher Identität nicht beenden. Nach einem
bewussten Stopp Client/MCP neu starten und `sse_preflight` wiederholen. Eine
möglicherweise unterbrochene Mutation niemals automatisch erneut ausführen;
zuerst den Zustand zurücklesen.

## Fehlerbehebung

- **Skill oder `sse_preflight` fehlt:** In einer neuen Client-Sitzung prüfen,
  ob der separate Skill und die direkte Verbindung geladen sind. Den
  konfigurierten Startpfad und die MCP-Statusanzeige kontrollieren. Bei einer
  Claude-Plugin-Installation das ausdrückliche Target prüfen.
- **Einige MCP-Werkzeuge sind sichtbar, andere fehlen:** Bei Codex-Agent-Plugins
  zuerst das 64-000-Bytes-Budget prüfen und zum direkten npm-MCP wechseln.
  Außerdem `enabled_tools` und `disabled_tools` in der wirksamen
  Clientkonfiguration prüfen. Serverregistrierung, vollständiger Handshake und
  Modellverfügbarkeit sind getrennte Nachweise. Bis `sse_preflight` im Client
  aufrufbar ist, keine Steuerdaten bearbeiten und keine Shell- oder
  UI-Ersatzwege verwenden. Eine globale npm-Deinstallation repariert diesen
  Plugin-Budgetfehler nicht.
- **MCP versucht npm, npx oder Netzwerk:** Der Runtime-Eintrag muss Node direkt
  gegen das installierte Skript starten. npm beziehungsweise der
  Plugin-Installer gehören nur in die Installation und Aktualisierung.
- **Paketdateien fehlen nach npm-Installation:** Den Runtime-Ordner auf ein
  lokales, nicht synchronisiertes Laufwerk legen. `TAR_ENTRY_ERROR`/`EBADF`
  nicht wegen eines erfolgreichen Exitcodes übergehen.
- **Port belegt oder Version falsch:** Fremde, alte oder nicht eindeutig
  identifizierbare API nicht beenden oder umgehen. Den Singleton-Vertrag
  anwenden und nur die exakte verifizierte eigene Instanz bewusst stoppen.
- **SSE ist nicht gestartet:** `SSE_NOT_RUNNING` ist ein Laufzeitblocker.
  Der Preflight selbst startet keine Anwendung; den ursprünglichen Auftrag
  und eine eventuell ausstehende Startfreigabe beachten.
- **SSE reagiert nicht mehr:** Große UI-Automation-Abfragen können die Anwendung
  lange blockieren, auch nach dem Abbruch des aufrufenden Programms. Fremde
  UI-Automation während der Arbeit vermeiden. Eine hängende SSE nicht blind
  beenden; ungesicherte Änderungen und Wiederherstellungszustand zuerst klären.

## Weitere standalone-Nutzung

- [Standalone MCP](../packages/mcp/README.md) — direkter Codex-Einstieg und
  eigener Clientbetrieb;
- [direkte API und CLI](../packages/api/README.md) — bewusst separat verwaltete
  HTTP-/CLI-Integration ohne MCP.

Die API beschreibt sich über `/v1/openapi.json`, `/v1/operations` und
`describe`. Sicherheits- und Fehlerverträge stehen im
[API-/MCP-Vertrag](API-MCP-VERTRAG.md).
