# Installation für Menschen und AI-Agenten

Diese Anleitung ist der kanonische Einrichtungsvertrag. Ein Mensch kann die
Befehle selbst ausführen; ein lokaler AI-Agent darf denselben Ablauf nach einem
kurzen Plan übernehmen. Die SteuerSparErklärung-Automation läuft immer auf dem
Windows-PC. Sie wird nicht in Codex Cloud, Claude Code on the web oder einem
anderen Remote-Container eingerichtet.

## Zielbild

```text
lokaler Agent -> installierter Skill -> lokaler MCP-Server -> Loopback-API -> SteuerSparErklärung
                                      \-> direkte API-CLI als Fallback
```

Die lokale API ist der Ausführungskern. MCP verbindet den Agenten mit dieser
API, greift aber nicht selbst auf Steuerdateien oder die Desktop-Oberfläche zu.
Das Standardsetup für Codex, Claude Code und OpenCode installiert beide Skills,
API und MCP. Falls der Client keinen lokalen MCP unterstützt, bleibt die
mitgelieferte API-CLI vollwertig nutzbar.

## Was mindestens vorhanden sein muss

- Windows x64;
- eine installierte SteuerSparErklärung 2025 / Engine-Major 31;
- ein **lokal** laufender Agent mit Datei- und Programmzugriff;
- Internetzugriff während Download und Installation;
- für sichtbare SSE-Bedienung eine entsperrte, unbenutzte Windows-Sitzung.

Nicht allgemein erforderlich sind Python, PowerShell 7, Docker oder ein
Repository-Checkout. Windows PowerShell 5.1 gehört zu Windows und wird von der
Automation direkt aus dem Systemordner gestartet.

Es gibt genau zwei unterstützte Installationswege:

| Weg | Zusätzlich vorhanden | Geeignet für |
| --- | --- | --- |
| npm | Node.js 22+ mit npm | kürzeste Installation und einfache Updates |
| Portable | nichts Zusätzliches | PCs ohne Node.js/npm |

`npx skills` selbst benötigt Node.js/npm. Git ist keine Produktvoraussetzung:
ohne funktionierenden Skill-Installer darf der Agent die beiden Skillordner aus
dem aktuellen Repository-ZIP kopieren oder die Skills aus dem verifizierten
Portable-Release verwenden.

## 1. Beide Skills installieren

Der Agent muss `steuer-spar-erklaerung-setup` **und**
`steuer-spar-erklaerung` installieren. Nur der Setup-Skill richtet die Technik
ein; nur der Hauptskill darf anschließend einen Steuerfall prüfen.

Mit vorhandenem Node.js 22+ und npm:

```powershell
npx -y skills add yadimon/steuer-spar-erklaerung-mcp --list
npx -y skills add yadimon/steuer-spar-erklaerung-mcp `
  --skill steuer-spar-erklaerung --skill steuer-spar-erklaerung-setup `
  --agent <codex|claude-code|opencode> --global --copy --yes
```

Danach den Agenten neu laden und prüfen, dass beide Skills lokal aufgelistet
werden. Eine Raw-Datei im Browser oder gecachter Webtext ist keine installierte
Skill-Version.

Ohne `npx skills` lädt der Agent das aktuelle Repository-ZIP direkt vom
kanonischen Repository, prüft Quelle und Commit und kopiert ausschließlich die
beiden vollständigen Ordner unter `skills/` in das Skillverzeichnis des lokalen
Clients. Relative Dateien unter `references/` und `agents/` müssen mitkopiert
werden. Keine unbekannte Spiegelquelle verwenden.

## 2. Runtime installieren

### Weg A: npm

Vor der Installation beide Registry-Versionen lesen. Sie müssen gleich sein
und zu einem vollständigen GitHub-Release mit Portable-ZIP und Sidecar-Hash
gehören:

```powershell
npm view @yadimon/steuer-spar-erklaerung-api@beta version
npm view @yadimon/steuer-spar-erklaerung-mcp@beta version
npm install --global @yadimon/steuer-spar-erklaerung-api@beta @yadimon/steuer-spar-erklaerung-mcp@beta
```

Setup nie direkt aus `npx` starten: dessen `_npx`-Cache ist flüchtig und darf
nicht in dauerhaften API- oder MCP-Startpfaden landen.

### Weg B: Portable

Ermittle das aktuellste nicht als Draft markierte Release über die direkte
GitHub-Release-Liste des kanonischen Repositorys. Es muss exakt
`steuer-spar-erklaerung.zip` und
`steuer-spar-erklaerung.zip.sha256` enthalten. GitHub-Quellarchive sind nicht
das Portable-Produkt.

Vergleiche die Sidecar-Prüfsumme, entpacke erst danach in einen neuen leeren
Ordner und verwende bevorzugt das Windows-eigene
`$env:SystemRoot\System32\tar.exe`. Ein Timeout oder Teilordner ist kein
Erfolg; nicht in denselben Ordner nachentpacken. Parse danach
`portable-manifest.json` als JSON und prüfe Version, unterstütztes Profil und
die benötigten Startdateien. Gib weder das vollständige Manifest noch seine
Dateiliste in den Agentenkontext aus.

Der PDF-Helper muss als eigener
`powershell.exe -NoProfile -NonInteractive -File powershell/render-pdf.ps1`
Prozess laufen. Erfolg verlangt Exitcode 0, `ok=true` und lesbare create-only
PNG-Dateien; ein fremder WinRT-Restcode darf nicht als Erfolg umgedeutet
werden.

## 3. Lokale API und MCP vorbereiten

Interaktiv:

```powershell
steuer-spar-erklaerung-setup --with-mcp
```

Beim Portable-Weg:

```powershell
.\sse-setup.cmd --with-mcp
```

Hat der Hauptskill Steuerfall und Belegordner bereits bestätigen lassen,
schreibt er eine kurze private JSON-Datei mit ausschließlich
`schemaVersion: 1`, `profileId`, absolutem `caseDir`, absoluten
`sourceFolders` und optional einem eindeutig erkannten `sseExecutable`.
Dann gilt:

```powershell
steuer-spar-erklaerung-setup --plan-file <absoluter-planpfad> --with-mcp
```

`--plan-file` akzeptiert keine Tokens, Connectoren, Schreibrechte, Autostarts
oder ELSTER-Autorität. `--defaults` ist nur für bereits gespeicherte Pfade oder
ein bewusst technisches Setup ohne Fall-/Belegbindung gedacht. `--no-start`
erzeugt Dateien, prüft die laufende API aber nicht.

Der Wizard erzeugt außerhalb des Produkts eine Loopback-Konfiguration, einen
fensterlosen API-Starter, `setup-decisions.json`, `settings.md`, Tracking und
eine MCP-Mergevorlage. Die MCP-Vorlage enthält **kein Token**: Sie startet einen
lokalen Bootstrap, der das Token erst im Prozess aus `config.json` lädt.
`config.json` und ihr Token niemals in Chat, Log, Diff, Prozessargument oder
eigenen `curl`-/`Invoke-RestMethod`-Aufruf übernehmen.

## 4. MCP an den lokalen Client binden

Vor jeder Clientänderung vorhandene Konfiguration sichern, den konkreten
Dateipfad und einen tokenfreien Diff zeigen und Zustimmung einholen. Niemals
die ganze Datei ersetzen. Verwende `command` und `args` unverändert aus dem
Serverobjekt `steuer-spar-erklaerung` der erzeugten Mergevorlage.

- **Codex:** bevorzugt `codex mcp add ... -- <command> <args...>` verwenden,
  danach `codex mcp list`; Codex Desktop/CLI neu starten und `/mcp` prüfen.
- **Claude Code:** `claude mcp add --transport stdio --scope user ... --
  <command> <args...>` verwenden, danach `claude mcp list` und `/mcp`.
- **OpenCode:** zuerst `opencode mcp --help` lesen. Unterstützt die installierte
  Version den nichtinteraktiven `mcp add`-Befehl, ihn verwenden; sonst den
  tokenfreien Server in das bestehende lokale/global verwendete JSON-Schema
  mergen. Danach `opencode mcp list` beziehungsweise `opencode mcp ls`.

Direkt gesetzte `node`, `node.cmd`, `npx` oder Batch-Wrapper sind falsch. Der
Client muss die vom Wizard ausgegebene absolute `node.exe` und den dauerhaften
Bootstrap starten. Die bloße Existenz einer JSON-Datei beweist keine geladene
MCP-Verbindung.

## 5. Installation beweisen

Zuerst die produktseitige Prüfung ausführen:

```powershell
steuer-spar-erklaerung-setup --check
```

Beim Portable-Weg:

```powershell
.\sse-setup.cmd --check
```

Erfolg verlangt `ok: true`, die veröffentlichte Version, freigegebenes Profil,
API-Health, Discovery mit Operationszahl, passenden
Konfigurationsfingerprint, bereiten Workspace und `containsToken: false` für
die MCP-Vorlage. `clientVerificationRequired: true` bedeutet bewusst, dass
anschließend noch der tatsächliche Client geprüft werden muss.

Danach im neu geladenen Client:

1. Serverliste zeigt `steuer-spar-erklaerung` als verbunden;
2. ein realer MCP-Health-Aufruf liefert `ok=true`;
3. keine Ausgabe enthält Token, Steuerwerte oder lokale Steuerdateipfade.

Erst diese drei Ebenen zusammen sind ein erfolgreiches Setup. Der Setup-Skill
öffnet keinen Steuerfall. Für eine Prüfung muss er an den installierten
Hauptskill übergeben; dieser erzeugt vor jeder UI-Navigation eine
hashverifizierte Arbeitskopie und öffnet niemals den Originalfall.

## Zwei kopierbare Prompts

### Prompt 1: installieren

```text
Richte SteuerSparErklärung vollständig lokal auf diesem Windows-PC nach
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/skills/steuer-spar-erklaerung-setup/references/installation.md
ein. Installiere oder aktualisiere beide Skills für diesen lokalen Agenten und
verwende das neueste vollständige Release. Richte lokale API plus MCP ein;
zeige vor der Client-Konfigurationsänderung den tokenfreien Diff. Prüfe danach
mit `steuer-spar-erklaerung-setup --check`, der MCP-Serverliste des Clients und
einem echten MCP-Health-Aufruf. Nicht in einer Cloud-Umgebung ausführen und
noch keinen Steuerfall öffnen.
```

### Prompt 2: Steuerfall nur lesend prüfen

```text
Nutze $steuer-spar-erklaerung und prüfe meine Einkommensteuererklärung 2025
nur lesend. Steuerfall: <ABSOLUTER_PFAD_ZUM_FALL>. Belege:
<ABSOLUTE_BELEGORDNER>. Erzeuge zuerst eine hashverifizierte Arbeitskopie,
gleiche Fall, Belege und SSE-Prüfer ab und schreibe einen Report in den
konfigurierten Ergebnisordner. Ändere nichts ohne meine ausdrückliche Freigabe
und führe keine ELSTER-Übermittlung aus.
```

Die im Kalenderjahr 2026 abgegebene Einkommensteuererklärung betrifft in
diesem Release das unterstützte Steuerjahr 2025. Ein Einkommensteuerfall 2026
darf nicht durch bloße Umbenennung des Prompts als unterstützt behandelt
werden.
