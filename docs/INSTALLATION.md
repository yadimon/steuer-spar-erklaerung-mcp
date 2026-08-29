# Installation für Menschen und AI-Agenten

Diese Anleitung ist der kanonische Einrichtungsvertrag. Ein Mensch kann die
Befehle selbst ausführen; ein lokaler AI-Agent darf denselben Ablauf nach einem
kurzen Plan übernehmen.

Es gibt **kein Setup-Programm**. Im Standardweg installierst du ein npm-Paket
und einen Skill und meldest den MCP-Server beim Client an. Das MCP-Paket bringt
die exakt passende API als normale npm-Dependency mit und startet sie bei
Bedarf; eine bereits laufende kompatible API wird wiederverwendet.

## Die ganze Installation

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai

npm i @yadimon/steuer-spar-erklaerung-mcp

npx -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent codex --copy --yes

codex mcp add steuer-spar-erklaerung -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js
```

Danach den Client einmal neu starten. Ein separates API-Terminal ist im
Standardweg nicht nötig.

Für Claude Code statt Codex `--agent claude-code` und
`claude mcp add --scope project steuer-spar-erklaerung -- <node.exe> <derselbe index.js>`.

Der Rest dieser Seite erklärt jeden Schritt, die Fallen und die Grenzen. Wer
nur prüfen lassen will, springt zu [Kopierbare Prompts](#kopierbare-prompts).

## Wo das läuft

Die Automation läuft immer auf dem Windows-PC. Sie wird nicht in Codex Cloud,
Claude Code on the web oder einem anderen Remote-Container eingerichtet.
Claude Cowork führt Code isoliert aus und ist deshalb kein Installer für die
host-lokale API- und MCP-Konfiguration. Als lokale Clients sind Codex, die
eigenständig angemeldete Claude Code CLI und OpenCode vorgesehen. OpenCode ist ein sekundärer, best-effort Client.

## Zielbild

```text
lokaler Agent -> Skill -> lokaler MCP-Server -> Loopback-API -> SteuerSparErklärung
                       \-> direkte API-CLI als Fallback
```

Die lokale API ist der Ausführungskern. Nur sie kennt `SSE.exe`, lokale Pfade,
Arbeitsbereich, Falldateien und UI Automation. MCP ist ein dünner, PC-blinder
Wrapper darüber. Unterstützt ein Client kein MCP, bleibt die mitgelieferte
API-CLI vollwertig.

So sieht der Ordner am Ende aus:

```text
C:\mein-steuer-ai\
  node_modules\            MCP und seine exakt passende API-Dependency
  .claude\skills\          der Skill bei --agent claude-code
  .agents\skills\          der Skill bei --agent codex
  skills-lock.json         welche Skillversion installiert ist
  .mcp.json                der MCP-Eintrag bei claude mcp add --scope project
  config.json              nur bei bewusst eigenem Arbeitsbereich
  workspace\               nur bei bewusst eigenem Arbeitsbereich
    settings.md            Belegquellen und Regeln in Prosa
    tracking.md            Belegprotokoll
    documents\ results\ backups\
```

Eine `config.json` ist **optional**. Ohne sie gelten Loopback `127.0.0.1`, Port
`43127`, Profil `2025` und der sichere Arbeitsbereich unter `%LOCALAPPDATA%`.
Für einen eigenen Arbeitsbereich setzt du beim MCP-Server `SSE_API_CONFIG` auf
einen **absoluten** Konfigurationspfad. Die Datei darf beim ersten Start fehlen;
der benannte Ordner bestimmt dann Arbeitsbereich und Logs.

## Es gibt kein Token

Die API kennt keine Anmeldung. Sie lauscht nur auf Loopback, und jeder lokale
Prozess darf sie aufrufen — das ist dieselbe Vertrauensgrenze, in der auch die
Steuersoftware selbst läuft.

Wovor sie sich schützt, ist der eine Weg von außen: eine beliebige Webseite im
Browser des Nutzers erreicht `127.0.0.1` genauso. Deshalb weist die API jede
Anfrage mit **403** ab, die eine `Origin`- oder `Sec-Fetch-Site`-Kopfzeile
trägt oder deren `Host` kein Loopback-Name ist. Ein Browser sendet mindestens
eine davon zwingend und kann sie nicht fälschen; die letzte Regel schlägt
DNS-Rebinding. Ein lokaler Klient sendet keine davon.

Es gibt also nichts zu erzeugen, nichts zu speichern und nichts geheimzuhalten.
Ältere Betas schrieben ein `token` in die Konfiguration; steht es noch da,
nennt die API die Zeile beim Start und du löschst sie.

## Voraussetzungen

- Windows x64;
- eine installierte SteuerSparErklärung; freigegeben ist derzeit `2025` / Engine-Major `31`;
- **Node.js 22 oder neuer mit npm**;
- ein **lokal** laufender Agent mit Datei- und Programmzugriff;
- für sichtbare SSE-Bedienung eine entsperrte, unbenutzte Windows-Sitzung.

Nicht erforderlich sind Python, PowerShell 7 oder ein Repository-Checkout.
Windows PowerShell 5.1 gehört zu Windows und wird direkt aus dem Systemordner
gestartet.

Fehlt Node.js, installiere es **nicht ungefragt**. Nenne es als Voraussetzung
und lass den Menschen entscheiden; das ist eine Systemänderung, die keine
Prüfaufgabe rechtfertigt.

**Claude Code CLI unter Windows (nicht Cowork):** Führe die Installation aus
der eigenständig angemeldeten CLI oder einem lokalen Terminal aus. Claude
Cowork und eine in der Desktop-App eingebettete Binärdatei können Schreib-
zugriffe in das MSIX-Verzeichnis
`AppData\Local\Packages\Claude_*\LocalCache` virtualisieren; das ist keine PC-weite
Installation. Die native Windows-CLI setzt außerdem Git for Windows und eine
eigene Anmeldung in `claude` voraus — eine Anmeldung in Claude Desktop
authentifiziert sie nicht. Kopiere nie Binärdateien oder Anmeldedaten aus
`LocalCache` als Umgehung.

## 1. Ordner anlegen und MCP installieren

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai

npm i @yadimon/steuer-spar-erklaerung-mcp
```

Meckert PowerShell über blockierte Skripte, `npm.cmd` statt `npm` verwenden;
ändere dafür nicht die systemweite Execution Policy.

Die API nicht zusätzlich installieren: npm löst die exakte Dependency des
MCP-Pakets automatisch auf. Das MCP-Manifest und der Start prüfen denselben
Paketnamen und exakt dieselbe Releaseversion; `postinstall` und
Laufzeitinstallation gibt es nicht.

Die veröffentlichte MCP-Version lässt sich vorab so lesen:

```powershell
npm view @yadimon/steuer-spar-erklaerung-mcp version
```

## 2. Skill in den Ordner installieren

```powershell
npx -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent <codex|claude-code|opencode> --copy --yes
```

Ohne `--global` landet der Skill im
Ordner statt im Benutzerprofil. Danach den Agenten neu laden und prüfen, dass
der Skill lokal aufgelistet wird; eine Raw-Datei im Browser ist keine
installierte Skill-Version.

Ohne `npx skills` lädt der Agent das Repository-ZIP vom kanonischen Repository,
prüft Quelle und Commit und kopiert nur den vollständigen Ordner
`skills/steuer-spar-erklaerung` samt `references/`. Keine Spiegelquelle.

## 3. API-Lebenszyklus im Standardweg

Beim ersten MCP-Start wird zuerst die konfigurierte Loopback-Adresse geprüft.
Läuft dort bereits die exakt passende SSE-API, verwendet MCP diesen lokalen
Singleton. Ist der Port frei, startet MCP die mitinstallierte API unsichtbar,
wartet auf Readiness und hält stdout vollständig für das MCP-stdio-Protokoll
frei. Auch zwei gleichzeitige MCP-Starts hinterlassen höchstens diese eine API.

Eine fremde, nicht eindeutig identifizierbare oder anders versionierte API auf
dem Port ist ein klarer Startfehler. MCP beendet oder ersetzt sie nie. Die
automatisch gestartete API darf nach dem Ende eines MCP-Clients weiterlaufen
und wird beim nächsten Start wiederverwendet.

`SSE_API_URL` ist autoritativ: Ist sie ausdrücklich gesetzt, wird genau diese
Loopback-URL übernommen oder der Start bricht ab. Es gibt dann keinen stillen
Fallback auf Port `43127` und keinen Autostart an einer anderen Adresse.

Für direkte API-Nutzung bleibt das API-Paket separat installierbar. Dieser
bewusste Vordergrundweg und der NPX-Kurzweg stehen im
[API-Paket-README](../packages/api/README.md); einen MCP-Eintrag nie auf den
flüchtigen `_npx`-Cache richten.

## 4. MCP an den Client binden

Der MCP-Eintrag besteht aus der absoluten `node.exe` und dem absoluten Pfad zu
`dist/index.js` des MCP-Pakets — ohne weitere Argumente. Am Standardport
`43127` braucht er keine Umgebungsvariable. Optional erhält er genau eine der
beiden Einstellungen:

- `SSE_API_CONFIG=C:\mein-steuer-ai\config.json` wählt einen absoluten
  Konfigurationspfad für die automatisch gestartete API;
- `SSE_API_URL=http://127.0.0.1:<port>` bindet autoritativ eine bewusst separat
  verwaltete API und deaktiviert jeden MCP-Autostart.

Ein minimales optionales `C:\mein-steuer-ai\config.json` für einen eigenen
Arbeitsbereich sieht so aus; nicht genannte Dokument-, Ergebnis- und
Backupordner liegen getrennt unter `workspaceDir`:

```json
{
  "profileId": "2025",
  "host": "127.0.0.1",
  "port": 43127,
  "workspaceDir": "C:\\mein-steuer-ai\\workspace"
}
```

Die Einstellung wird direkt am stdio-Eintrag übergeben. Für Codex lautet die
Variante des unten stehenden Befehls:

```powershell
codex mcp add --env SSE_API_CONFIG=C:\mein-steuer-ai\config.json steuer-spar-erklaerung -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js
```

Für Claude Code:

```powershell
claude.cmd mcp add --scope project steuer-spar-erklaerung -e SSE_API_CONFIG=C:\mein-steuer-ai\config.json -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js
```

Für eine bewusst separat verwaltete API kann in denselben Befehlen stattdessen
`SSE_API_URL=http://127.0.0.1:<port>` stehen. Nie beide Einstellungen
gleichzeitig verwenden.

**Nicht den `.cmd`-Shim aus `node_modules\.bin` eintragen.** Seit Node 20
verweigert `spawn` das Starten von `.cmd`- und `.bat`-Dateien ohne Shell
(Absicherung gegen CVE-2024-27980); ein MCP-Client bekommt dabei nur `EINVAL`
und meldet den Server als nicht startbar. Gemessen: über den Shim scheitert
der Start, über `node` plus `index.js` antwortet der Server normal. Aus
demselben Grund gehören auch `npx` und andere Wrapper nicht in den Eintrag.
Den Pfad der Laufzeit liefert `(Get-Command node).Source`.

Vor jeder Clientänderung den Dateipfad und einen Diff zeigen und Zustimmung
einholen. Eine im Auftrag bereits enthaltene bedingte Zustimmung reicht, wenn
der Diff ausschließlich den einen Server `steuer-spar-erklaerung` additiv
mergt und keine anderen Einträge löscht. Niemals die ganze Datei ersetzen.

- **Claude Code:**

  ```powershell
  claude mcp add --scope project steuer-spar-erklaerung -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js
  ```

  Das schreibt eine `.mcp.json` in den Ordner. Achtung: Der von npm erzeugte
  PowerShell-Shim `claude.ps1` verschluckt den `--`-Trenner; den Aufruf deshalb
  über `claude.cmd` oder Git Bash absetzen und mit `claude mcp list` beweisen.

- **Codex:**

  ```powershell
  codex mcp add steuer-spar-erklaerung -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js
  ```

  Codex kennt nur eine globale Konfiguration. Wer den Eintrag nur im Ordner
  aktiv haben will, setzt in `~/.codex/config.toml` `enabled = false` und
  startet im Ordner mit
  `codex -c mcp_servers.steuer-spar-erklaerung.enabled=true "…"`.

  Ergänze in derselben TOML-Tabelle `required`, `startup_timeout_sec`,
  `tool_timeout_sec` und `enabled_tools` mit einer begrenzten Kernliste.
  Aktuelle Codex-Versionen blenden einen großen unbeschränkten MCP-Katalog
  sonst vollständig aus dem Modellkontext aus. Die Kernliste deckt den
  Standard-Prüflauf ab; alle übrigen Operationen bleiben über die API-CLI
  erreichbar.

  ```toml
  required = true
  startup_timeout_sec = 30
  tool_timeout_sec = 300
  enabled_tools = [
    "sse_health", "sse_capabilities", "sse_product_info",
    "sse_workspace_status", "sse_workspace_files",
    "sse_workspace_read_text", "sse_workspace_write_text",
    "sse_list_cases", "sse_case_hash", "sse_make_working_copy",
    "sse_launch", "sse_windows", "sse_instances", "sse_dialog_list",
    "sse_dialog_answer", "sse_warning_popup_read", "sse_page",
    "sse_page_state", "sse_page_objects", "sse_ui_state", "sse_collect",
    "sse_goto", "sse_checker_results", "sse_checker_run", "sse_checker_open",
    "sse_checker_close", "sse_screenshot", "sse_snapshot", "sse_subpages",
    "sse_table_read", "sse_find", "sse_positions", "sse_click",
    "sse_click_point", "sse_read_full", "sse_result_details",
    "sse_menu", "sse_menu_click", "sse_receipt_manager_list",
    "sse_window_close", "sse_close"
  ]
  ```

Die neun BelegManager-Werkzeuge ausser `sse_receipt_manager_list` gehören
bewusst nicht in diese Kernliste. Aus Vertrags- und Discovery-Kompatibilität
bleiben sie im vollständigen Katalog sichtbar. Im aktuellen Hintergrundbetrieb
weist `sse_capabilities` sie als
`interactionRequirement="foreground-required"` und `availability="blocked"`
aus. Sie stoppen vor Workerstart und UI-Änderung; es gibt keinen Opt-in und
keinen zulässigen Maus-/Tastatur-Workaround.

Die bloße Existenz einer JSON-Datei beweist keine geladene MCP-Verbindung.

## 5. Installation beweisen

`--selftest` verwendet denselben Singleton-Pfad wie ein normaler MCP-Start: Es
übernimmt die exakt passende API oder startet sie bei Bedarf und prüft danach
deren Health-Vertrag.

```powershell
node .\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js --selftest
```

Nach einer neuen oder geänderten Skill-/MCP-Installation kann die laufende
Agentensession den Server nicht als echtes Tool beweisen. Beende den Lauf mit
**„Technisches Setup bereit; Client-Verifikation nach Neustart offen."** und
fordere genau einen Clientneustart an; Prompt 2 übernimmt danach die reale
Verifikation. Behaupte in der alten Sitzung weder `connected` noch einen
erfolgreichen Tool-Aufruf.

Der neu geladene Client prüft zuerst die Serverliste und ruft dann das echte
MCP-Tool `sse_health` als `mcp_tool_call` auf. Erfolg verlangt das
strukturierte Resultat mit `ok=true`; ein Servereintrag, Status „connected"
oder ein erfolgreicher Handshake genügt nicht. Ein direkter
API-CLI-Aufruf `health` ist kein Ersatz — er beweist die API, nicht MCP.

## 6. Belegquellen festlegen

`workspace\settings.md` ist der Ort für Regeln, die eine Pfadliste nicht
ausdrücken kann — der Hauptskill liest sie bei jedem Lauf:

```text
## Quellen
- <ABSOLUTER_ORDNER>\Rechnungen — vollständig
- <ABSOLUTER_ORDNER>\Scans — nur Unterordner 2025, "Privat" nicht lesen
- <ABSOLUTER_ORDNER>\Bank — nur Kontoauszüge, für den Zahlungsabgleich
```

Die harte Grenze bleibt die Ressourcentopologie der API: Was nicht als Quelle
freigegeben ist, liest die API gar nicht. `settings.md` verfeinert innerhalb
des Erlaubten und kann nichts zusätzlich freischalten.

## Aktualisieren

Beende eine laufende Singleton-API bewusst wie unten beschrieben. Aktualisiere
danach im Installationsordner nur das MCP-Paket; npm ersetzt seine exakt
gepinnten API-Dependency automatisch:

```powershell
npm.cmd view @yadimon/steuer-spar-erklaerung-mcp version
npm.cmd install @yadimon/steuer-spar-erklaerung-mcp@latest
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --agent <codex|claude-code|opencode> --copy --yes
```

Anschließend den Client neu starten und die Nachweise aus
[Installation beweisen](#5-installation-beweisen) wiederholen. Der absolute
MCP-Pfad bleibt bei einer lokalen Installation stabil; vor einer Änderung
des Client-Eintrags trotzdem den tatsächlichen Pfad prüfen.

## Entfernen

Zuerst die Singleton-API bewusst beenden. Dann den Server
`steuer-spar-erklaerung` mit der
aktuellen Remove-Funktion des jeweiligen Clients entfernen und den erzeugten
Diff prüfen: Andere MCP-Server müssen unverändert bleiben. Anschließend können
MCP-Paket im Installationsordner entfernt werden; npm entfernt die API-
Dependency, wenn kein anderes Paket sie benötigt:

```powershell
npm.cmd uninstall @yadimon/steuer-spar-erklaerung-mcp
```

Den Installationsordner nicht pauschal löschen. `workspace\`, `logs\`,
`config.json`, Reports und Backups sind Nutzerdaten; sie bleiben erhalten,
bis der Mensch ihre gesicherte oder endgültige Entfernung ausdrücklich
beauftragt. Ein global installierter Skill wird separat über den verwendeten
Skill-Manager entfernt.

## Die API selbst dokumentiert sich

Die laufende API beschreibt ihren eigenen Vertrag. Daraus lassen sich Klienten
generieren; eine gepflegte Zweitbeschreibung gibt es bewusst nicht.

```powershell
curl.exe http://127.0.0.1:43127/v1/openapi.json      # OpenAPI 3.1, alle Operationen
curl.exe http://127.0.0.1:43127/v1/operations        # Argument- und Ergebnisschemata
curl.exe http://127.0.0.1:43127/healthz              # Lebendigkeit und laufende Operation
```

`/healthz` nennt zusätzlich den exakten Paketnamen, die Paketversion, die
Prozess-ID, eine zufällige Instanz-ID und einen pfadfreien Fingerprint der
wirksamen API-Konfiguration. MCP bindet jeden Operations-POST an diese
Instanz-ID, damit ein Prozesswechsel zwischen Prüfung und Auftrag fail-closed
endet.
Der Singleton wird nur bei identischem Release und – sofern MCP ihn über eine
Konfigurationsdatei verwaltet – identischem Arbeitsbereich übernommen. Eine
geänderte Konfiguration erfordert das bewusste Beenden der alten API und einen
neuen MCP-Start.

## Singleton-API bewusst beenden

Beende nie Prozesse anhand eines bloßen Namens wie `node` oder `SSE`. Lies
zuerst `/healthz`, prüfe dort Paketname und erwartete Releaseversion und notiere
`processId`. Prüfe anschließend genau diesen PID über
`Get-CimInstance Win32_Process` und verifiziere, dass seine Kommandozeile auf
das installierte `@yadimon/steuer-spar-erklaerung-api\dist\api-main.js` zeigt.
Erst danach ist der gezielte Befehl zulässig:

```powershell
Stop-Process -Id <VERIFIZIERTE_PROCESS_ID>
```

Bei fehlender oder widersprüchlicher Identität nicht beenden. Ein direkt im
Vordergrund gestartetes API-Terminal wird stattdessen mit Strg+C beendet.

## Kopierbare Prompts

### Ein Prompt: installieren und prüfen

```text
Nutze https://github.com/yadimon/steuer-spar-erklaerung-mcp
Prüfe meine Einkommensteuer 2025.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER_ODER_KEINE_BELEGE>
Standard-Einrichtung und Prüflauf ausführen.
```

`Standard-Einrichtung und Prüflauf ausführen` steht für beides zugleich:
`Standard-Setup ausführen` mit dem Transport „MCP mit automatisch verwalteter
lokaler API" und
`Standard-Prüflauf ausführen`. Letzteres bestätigt den sicheren Prüfvertrag
des Hauptskills: hashverifizierte Kopie, sichtbare rein lesende Navigation,
Report sowie kein Speichern und kein ELSTER. Es bestätigt den oben beschriebenen sicheren
Plan einschließlich des Downloads, der Installation in den Ordner und des
bedingten additiven MCP-Merges. Der Agent zeigt Plan und Diff weiterhin an,
fragt innerhalb dieser Grenzen aber nicht erneut. Bei Löschungen, weiteren
Servern oder einem anderen Befehl stoppt er.

Weil MCP-Werkzeuge erst nach einem Clientneustart geladen werden, läuft die
Prüfung in derselben Sitzung über die lokale API-CLI; die MCP-Verifikation
holt der nächste Start nach. Fehlen absolute Pfade, gilt die Formel nur für
das Setup, und der Hauptskill stellt seine beiden fachlichen Fragen.

### Nur installieren

```text
Richte SteuerSparErklärung vollständig lokal nach
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md
ein. Installiere oder aktualisiere den Skill und verwende die neueste
veröffentlichte Version.
Standard-Setup ausführen: MCP mit automatisch verwalteter lokaler API.
```

### Nur prüfen, wenn schon eingerichtet

```text
Nutze $steuer-spar-erklaerung und prüfe meine Einkommensteuererklärung 2025.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER>
Standard-Prüflauf ausführen.
```

## Stopps

Stoppe bei inkompatiblem System, unbekannter Releasequelle, unfreigegebenem
Profil, fehlender Zustimmung, uneindeutiger Agenten-Konfiguration oder einem
redigierten Identitäts-/Versionsfehler. Eine fremde API oder einen fremden
Portinhaber niemals beenden, ersetzen oder übergehen.

Konfigurationen niemals ungefragt löschen. Berichte konkrete Datei, letzten
gelesenen Zustand, erzeugte Dateien und genau eine nächste sichere Aktion.

## FAQ

**Systemweit statt im Ordner?** Geht mit `npm i --global` und `--global` beim
Skill-Installer. Dann gilt dieselbe Anleitung, nur ohne Ordnerbindung; eine
eigene Anweisung dafür gibt es nicht.

**Codex vollständig isolieren?** `CODEX_HOME=C:\mein-steuer-ai\.codex` gibt
Codex eine eigene Konfiguration im Ordner. Kostet aber eine eigene Anmeldung,
weil `auth.json` ebenfalls im CODEX_HOME liegt. Anmeldedaten nicht kopieren.

**Mehrere Ordner?** Möglich; jeder braucht eine absolute `SSE_API_CONFIG` mit
eigenem Port. `SSE_API_URL` ist nur für eine bewusst separat gestartete API und
schaltet den Autostart aus. Es läuft trotzdem immer nur eine Operation je API.

**Kein Node.js?** Dann ist dieses Produkt derzeit nicht installierbar. Node.js
wird nicht eigens dafür installiert; das entscheidet der Mensch.
