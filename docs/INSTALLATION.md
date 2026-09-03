# Agent Plugin installieren

Der normale Nutzerweg installiert ein selbstenthaltenes Agent Plugin. Es
liefert gemeinsam und versionsgleich aus:

- den Skill `steuer-spar-erklaerung`;
- den MCP-Server und seine JavaScript-Dependencies;
- die lokale API samt CLI;
- Windows-PowerShell-/Native-Runtime, Produktprofile und Hilfsassets.

Im Arbeitsordner wird kein `node_modules` benötigt. Beim späteren MCP-Start
laufen weder npm noch npx, es gibt keinen Netzwerkdownload und kein separates
API-Terminal.

## Voraussetzungen

- Windows x64;
- Node.js 22 oder neuer;
- Git auf `PATH` für das einmalige Klonen durch `plugins@1.3.4`;
- installierte SteuerSparErklärung 2025;
- lokal installierter und angemeldeter Codex- oder Claude-Code-Client.

Git ist Installationswerkzeug, nicht Plugin-Runtime. Nach dem erfolgreichen
Klonen ist neben dem gewählten Agenten und SteuerSparErklärung Node.js 22+ die
einzige zusätzliche Laufzeitvoraussetzung. Python, PowerShell 7, eine globale
npm-Paketinstallation und ein Windows-Dienst sind nicht nötig.

Codex Cloud, Claude im Browser und entfernte Sandboxes können die lokale
Windows-Anwendung nicht bedienen. OpenCode ist nicht Teil der derzeit
dokumentierten und getesteten Plugin-Matrix.

## Installieren

Die automatische Zielerkennung von `plugins@1` ist unter Windows nicht
zuverlässig genug für den Hauptweg. Gib deshalb immer `--target codex` oder
`--target claude-code` an.

### Codex

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target codex --scope project --yes
codex plugin add steuer-spar-erklaerung@plugins-cli --json
```

Beide Installationsbefehle sind für Codex derzeit zwingend. Ein isolierter Lauf
mit `plugins@1.3.4` und Codex CLI 0.151 zeigte nach dem ersten Befehl zwar
Cache-, Marketplace- und Konfigurationseinträge, aber im Status-Readback
`codex plugin list --json`
noch `not installed`. Erst das target-native
`codex plugin add steuer-spar-erklaerung@plugins-cli --json` registrierte
Version und Status als `installed, enabled`. Nur dieser zurückgelesene Zustand
ist ein erfolgreicher Codex-Installationsnachweis.

Danach den Status zurücklesen; dies ist nicht der vorgesehene
Installationsschritt:

```powershell
codex plugin list --json
```

Bei der beobachteten Codex-0.151-Alpha konnte selbst dieser Readback in einem
älteren Probe-Home nativen Cache-/Konfigurationszustand materialisieren. Der
Probe-Home wurde als Evidenz verworfen. Verlass dich deshalb für die
Installation auf den ausdrücklichen target-nativen `codex plugin add`-Schritt
und bewerte Statusausgaben nur in einem bekannten Ausgangszustand.

### Claude Code

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target claude-code --scope user --yes
```

Claude Code benötigt keinen zusätzlichen Codex-Befehl. Dort muss die
target-native Pluginanzeige nach dem einen `plugins@1 add` den Eintrag mit
`Scope: user` als `enabled` ausweisen. Der User-Scope ist absichtlich: Mit
`plugins@1.3.4 --scope project` zeigte Claude Code 2.1.252 zwar einen
`project`-Eintrag, konnte ihn aber weder aus dem Installationsordner noch aus
dem Benutzerprofil target-nativ entfernen. Die Wiederholung mit `--scope user`
ließ sich eindeutig lesen und wieder entfernen.

Der Installationsaufruf darf GitHub erreichen und verwendet Git auf `PATH`, um
das Repository zu klonen. Danach ist der MCP-Start offline: `mcp.json` startet
Node direkt gegen einen Pfad unter `${PLUGIN_ROOT}`. Ein Runtime-Eintrag mit
`npx @yadimon/steuer-spar-erklaerung-mcp`, `npm install` oder einem
Postinstall-Download ist fehlerhaft.

### Was die Scopes hier bedeuten

`plugins@1.3.4` ignoriert den Scope bei Codex vollständig. `--scope project`
ist dort derzeit **keine physische Projektisolation**; der Installer schreibt in
clientverwaltete Benutzer-Caches beziehungsweise Benutzerkonfiguration. Bei
Claude Code wird deshalb der tatsächlich funktionierende `--scope user`
dokumentiert. Beide Wege sind benutzerweit verwaltet; nur der Claude-Weg lässt
sich mit demselben zurückgelesenen Scope target-nativ entfernen.

Trennung entsteht auf zwei anderen Ebenen:

1. Der Agent wird im gewählten Auftragsordner geöffnet und erhält damit dessen
   Projekt-/Kontextgrenze.
2. Strikt getrennte API-Arbeitsdaten verwenden einen eigenen absoluten
   `SSE_API_CONFIG`-Pfad.

Ohne zweite Maßnahme teilen Installationen desselben Windows-Benutzers den
sicheren API-Standard unter `%LOCALAPPDATA%\SteuerSparErklaerungApi`. Das ist
lokal und privat, aber nicht projektisoliert.

## Strikt getrennten Arbeitsbereich wählen

Für einen eigenen Auftrag kann der Client aus einer PowerShell gestartet
werden, die den absoluten Konfigurationspfad an das Plugin vererbt:

```powershell
$Root = 'C:\mein-steuer-ai'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$env:SSE_API_CONFIG = Join-Path $Root 'sse-api-config.json'
Set-Location $Root

# Danach genau den bereits installierten Zielclient aus dieser Sitzung starten.
# Beispiel CLI: codex oder claude
```

Alternativ kann derselbe absolute Wert target-nativ in die Umgebung des
installierten MCP-Servers eingetragen werden. Eine vorhandene Clientdatei nur
additiv ändern und nie pauschal ersetzen. Die Plugin-Dateien unter
`${PLUGIN_ROOT}` selbst nicht patchen: Eine erneute Installation darf diesen
Cache ersetzen.

`SSE_API_CONFIG` wählt die Konfigurationsdatei und damit Ressourcen wie
`documents`, `results` und `backups`. `SSE_API_URL` ist nur für eine bewusst
separat verwaltete Loopback-API. Beide Variablen dürfen nicht gleichzeitig
gesetzt sein.

## Client neu laden und First run

Erst nach vollständiger target-nativer Registrierung den Client neu starten
oder seine Plugins neu laden. Bei Codex heißt das: beide Installationsbefehle
ausführen und `installed, enabled` zurücklesen. Ein bereits laufender Client
übernimmt neue Skills und MCP-Server nicht zuverlässig während derselben
Sitzung.

Der erste Auftrag soll keine zweite Installation auslösen. Der Skill:

1. merkt sich den ursprünglichen Auftrag;
2. ruft das echte MCP-Tool `sse_preflight` auf;
3. stellt höchstens eine Frage pro Nachricht;
4. verwendet einen bereits eindeutig geöffneten Fall, andernfalls lässt er
   Fall und vollständige Belegquellen bestätigen;
5. zeigt einen sicheren Plan und setzt nach dessen Bestätigung den
   ursprünglichen Auftrag fort.

Ein passender erster Prompt ist:

```text
Prüfe meinen bereits geöffneten Steuerfall 2025 zunächst nur lesend. Beginne
mit sse_preflight, frage höchstens eine Sache pro Nachricht und speichere,
schließe oder sende nichts über ELSTER.
```

Technischer Erfolg verlangt, dass der Client den Skill und Server tatsächlich
auflistet und der echte Tool-Aufruf `sse_preflight` strukturiert antwortet. Ein
Installerausgang, ein MCP-Handshake oder ein Shell-Aufruf von `health` ersetzt
diesen Nachweis nicht. Ist SteuerSparErklärung nicht gestartet, kann der
Preflight korrekt mit einem verständlichen Runtime-Blocker antworten; das ist
kein Installationsfehler.

## Lokaler API-Singleton

Der MCP-Supervisor prüft vor dem stdio-Handshake die Loopback-API. Er verwendet
nur eine Instanz mit passendem Paketnamen, derselben exakten Releaseversion,
passendem API-Vertrag und passender Ressourcenidentität. Ist der Port frei,
startet er die im Plugin enthaltene API unsichtbar und lässt sie für spätere
Clients weiterlaufen. Parallele MCP-Starts konvergieren auf eine Instanz.

Ein fremder Portinhaber, eine alte API oder eine unklare Identität wird nicht
beendet, ersetzt oder umgangen. Der MCP-Start stoppt fail-closed. Nach einem
Plugin-Update deshalb zuerst alle alten Client-Sitzungen schließen, den alten
API-Prozess nur nach der unten beschriebenen Identitätsprüfung beenden und den
Client neu starten.

## Update

`plugins@1.3.4` stellt `add`, `discover` und `targets` bereit, aber kein eigenes
`update`-Kommando. Für Codex zuerst denselben externen `add`-Aufruf wiederholen
und anschließend den target-nativen Zustand zurücklesen:

```powershell
cd C:\mein-steuer-ai
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target codex --scope project --yes
```

Danach den Status zurücklesen, nicht als vorgesehenen Installationsschritt:

```powershell
codex plugin list --json
```

Zeigt Codex danach die erwartete Version nicht als `installed, enabled`, den
target-nativen Schritt erneut ausführen und nochmals zurücklesen:

```powershell
codex plugin add steuer-spar-erklaerung@plugins-cli --json
```

Anschließend erneut den Status zurücklesen:

```powershell
codex plugin list --json
```

Für Claude Code stattdessen wieder den einzelnen `plugins@1 add`-Befehl mit
`--target claude-code --scope user` verwenden und dessen target-native Anzeige
zurücklesen. Der VM-Lauf belegt die idempotente Wiederholung derselben
beta.33; ein Update über zwei Plugin-Versionen ist für diesen ersten
Agent-Plugin-Release nicht möglich und wird erstmals beim Nachfolger geprüft.
Ein erfolgreicher Installer-Exitcode allein beweist kein Update. Danach den
Client neu starten und `sse_preflight` erneut aufrufen.
Nicht gleichzeitig alte und neue Client-Sitzungen offen lassen; eine alte
API-Version am Port bleibt absichtlich ein sicherer Stopp.

## Entfernung

`plugins@1.3.4` besitzt kein `remove`-Kommando. Diese Anleitung erfindet daher
keinen `plugins remove`- oder `plugins uninstall`-Befehl.

Für den verifizierten Codex-Eintrag ist der konkrete target-native Weg:

```powershell
codex plugin remove steuer-spar-erklaerung@plugins-cli
```

Danach den verbliebenen Status zurücklesen:

```powershell
codex plugin list --json
```

Die Entfernung ist erst bestätigt, wenn `codex plugin list --json` genau diesen
Eintrag nicht mehr als installiert oder aktiviert ausweist. Für den in der VM
mit Claude Code 2.1.252 zurückgelesenen Eintrag gilt:

```powershell
cd C:\mein-steuer-ai
claude plugin list
claude plugin uninstall steuer-spar-erklaerung@steuer-spar-erklaerung --scope user
claude plugin list
```

Der erste Readback muss Version, `Scope: user` und `Status: enabled` zeigen;
der zweite darf die Plugin-ID nicht mehr aufführen. Den Befehl im zugehörigen
Auftragsordner ausführen und bei einer anderen Clientversion ID und Scope
erneut target-nativ zurücklesen.

Bietet die installierte Clientversion für den zurückgelesenen Eintrag keine
Entfernung an, beende den Client und entferne manuell nur:

1. ausschließlich die vom Client beziehungsweise Installationsdatensatz
   zurückgelesene exakte Plugin-ID aus seiner Clientverwaltung;
2. den von diesem Eintrag referenzierten exakten Plugin-Cache;
3. optional den zugehörigen MCP-Eintrag, falls der Client ihn separat führt.

Cachepfade nicht aus dieser Anleitung raten: Der Installer beziehungsweise der
Client ist für deren reale Lage maßgeblich. Vor jeder manuellen Entfernung den
aufgelösten absoluten Zielpfad prüfen; keine übergeordneten Cache-, Plugin- oder
Benutzerordner rekursiv löschen. Nach einem Neustart müssen Skill und
`sse_preflight` verschwunden sein.

Die Entfernung löscht bewusst **nicht** `%LOCALAPPDATA%\SteuerSparErklaerungApi`,
einen eigenen `SSE_API_CONFIG`-Arbeitsbereich, Belege, Berichte oder Backups.
Diese Nutzerdaten nur nach separater Prüfung und ausdrücklichem Auftrag
entfernen.

## API-Singleton bewusst beenden

Niemals Prozesse pauschal nach `node`, `SSE`, Fenstername oder Port beenden.
Lies zuerst `/healthz` am konfigurierten Loopback-Ziel und prüfe Paketname,
exakte Version und `processId`. Verifiziere dann genau diese PID mit
`Get-CimInstance Win32_Process`: Die Kommandozeile muss auf die API innerhalb
des erwarteten Plugin- oder standalone-Pakets zeigen. Nur bei vollständiger
Übereinstimmung:

```powershell
Stop-Process -Id <VERIFIZIERTE_PROCESS_ID>
```

Bei fehlender oder widersprüchlicher Identität nicht beenden. Nach einem
bewussten Stopp Client/MCP neu starten, `sse_preflight` wiederholen und eine
möglicherweise unterbrochene Mutation niemals automatisch erneut ausführen;
zuerst den Zustand zurücklesen.

## Cloud-synchronisierte und Netzlaufwerke

Ein Paketordner mit `node_modules` gehört auf ein lokales Laufwerk. Auf
cloud-synchronisierten Ordnern und Netzlaufwerken scheitert `npm install`
regelmäßig beim Entpacken (Exit 13, `TAR_ENTRY_ERROR`/`EBADF`), weil der
Synchronisationsdienst Dateien während des Schreibens sperrt. Der Plugin-Weg
ist davon nicht betroffen, weil er weder npm noch npx benötigt.

Sollen Fall- oder Belegordner trotzdem in einem synchronisierten Ordner liegen,
den Arbeitsbereich lokal anlegen und nur die Fall-, Beleg- und Ergebnisordner
über `SSE_API_CONFIG` auf den synchronisierten Ort zeigen lassen. Eine
Falldatei, die der Synchronisationsdienst gerade schreibt, kann beim Öffnen,
Hashen oder Speichern zu `precondition-failed` führen; dann den Abgleich
abwarten und den Hash erneut lesen.

## Fehlerbehebung

- **Skill oder `sse_preflight` fehlt:** Client vollständig neu starten und
  prüfen, ob beim Installieren das Ziel explizit `codex` oder `claude-code`
  war. Nicht mit automatischer Erkennung wiederholen.
- **MCP versucht npm, npx oder Netzwerk:** Der installierte Runtime-Eintrag ist
  nicht der Agent-Plugin-1.0-Vertrag. Er muss Node direkt gegen einen
  `${PLUGIN_ROOT}`-Pfad starten.
- **Workspace enthält kein `node_modules`:** Das ist im Plugin-Weg korrekt.
- **Port belegt oder Version falsch:** fremde, alte oder nicht eindeutig
  identifizierbare API niemals beenden oder übergehen. Alte Clients schließen,
  Identität prüfen und nur die exakte eigene PID bewusst stoppen.
- **Arbeitsdaten liegen unter `%LOCALAPPDATA%`:** Das ist der sichere Default.
  Für physische Trennung einen absoluten `SSE_API_CONFIG`-Pfad an den
  Clientprozess beziehungsweise dessen MCP-Umgebung geben.
- **SSE ist nicht gestartet:** Dem stabilen `nextTool` aus `sse_preflight`
  folgen. Der Preflight selbst startet keinen Steuerfall.

## Fortgeschrittene standalone-Nutzung

Eigene HTTP-/CLI-Programme können die API weiterhin separat über npm
installieren; ein selbst verwalteter MCP kann das MCP-Paket direkt installieren.
Diese Wege benötigen einen bewussten Paketordner mit `node_modules` und sind
nicht der Plugin-Quickstart:

- [direkte API und CLI](../packages/api/README.md)
- [standalone MCP](../packages/mcp/README.md)

Die API beschreibt sich nach dem Start über `/v1/openapi.json`,
`/v1/operations` und `describe`. Sicherheits- und Fehlerverträge stehen im
[API-/MCP-Vertrag](API-MCP-VERTRAG.md).
