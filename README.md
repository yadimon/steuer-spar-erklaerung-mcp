# SteuerSparErklärung für lokale AI-Agenten

[![Windows CI](https://github.com/yadimon/steuer-spar-erklaerung-mcp/actions/workflows/windows-ci.yml/badge.svg)](https://github.com/yadimon/steuer-spar-erklaerung-mcp/actions/workflows/windows-ci.yml)

Das inoffizielle Agent Plugin lässt Codex oder Claude Code eine lokal geöffnete
SteuerSparErklärung 2025 prüfen, mit Belegen abgleichen und nach ausdrücklicher
Freigabe kontrolliert bearbeiten. Skill, MCP, API, PowerShell-/Native-Runtime,
Profile und JavaScript-Dependencies kommen gemeinsam in einer
versionsgleichen Installation.

> **Öffentliche Beta für Windows x64.** Das Projekt ist keine Steuerberatung.
> Ergebnisse selbst prüfen und den aktuellen Dateistand vor der ersten
> Änderung privat sichern.

## Was kann es?

- den eindeutig geöffneten Fall in SteuerSparErklärung 2025 lesen und mit dem
  Programm-Prüfer untersuchen;
- bestätigte Belegquellen inventarisieren und mit dem Fall abgleichen;
- Felder und Tabellen eng gebunden ändern und unmittelbar zurücklesen;
- Umsatzsteuer-Voranmeldungen vorbereiten, ohne sie zu übermitteln;
- Berichte, private Backups und ausdrücklich verlangte Arbeitskopien im lokalen
  Arbeitsbereich erzeugen;
- über `sse_preflight` Arbeitsbereich, Produktprofil und Laufzeit prüfen, bevor
  Steuerdaten gelesen werden;
- einen neuen Gewinn-Erfassungsfall des freigegebenen Folgejahres über den
  echten Startassistenten anlegen (`sse_case_create`) und dessen Stammdaten
  über katalogisierte Seiten füllen.

Profil 2025 / Engine 31 ist freigegeben. Profil 2024 bleibt experimentell und
auf Verifikation begrenzt. `GewErfass2026` ist ausschließlich für den belegten
Folgejahr-Leseweg und die neu angelegte Gewinn-Erfassung freigegeben. Im BelegManager ist aktuell nur die focusless
Leseliste allgemein aktiv; die Vordergrundwege bleiben fail-closed gesperrt.

## Voraussetzungen und harte Grenzen

- Windows x64, Node.js 22 oder neuer, Git auf `PATH` für das einmalige Klonen
  des Plugin-Repositories durch `plugins@1.3.4` und eine installierte
  SteuerSparErklärung 2025;
- ein lokal laufender Codex- oder Claude-Code-Client auf demselben PC;
- für sichtbare Bedienung eine entsperrte, unbenutzte Windows-Sitzung.

Der Agent sendet nichts über ELSTER, speichert nie automatisch und bearbeitet
keinen unklaren Fall. Ein bereits eindeutig geöffneter Fall gewinnt. Originale
und übermittelte Fälle werden nicht still ersetzt, verschoben oder gelöscht.
Save As und Arbeitskopien sind keine impliziten Sicherheitsmaßnahmen. Vor der
ersten dirty-fähigen Navigation oder Änderung wird der aktuelle Dateistand
hashgebunden gesichert; jede Änderung braucht Readback und Speichern einen
eigenen ausdrücklichen Auftrag.

## Schnellstart

Erstelle einen leeren Auftragsordner und verwende genau die Strecke für deinen
Client. Die automatische Clienterkennung von `plugins@1` wird unter Windows
nicht empfohlen.

### Codex

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target codex --scope project --yes
codex plugin add steuer-spar-erklaerung@plugins-cli --json
```

Beide Codex-Befehle sind derzeit erforderlich: `plugins@1.3.4` registriert
Cache und Marketplace, aber Codex CLI 0.151 meldete das Plugin danach noch als
`not installed`. Erst der target-native zweite Befehl machte es
`installed, enabled`. Lies den Zustand danach mit
`codex plugin list --json` zurück. Dieser Befehl ist hier als Status-Readback,
nicht als vorgesehener Installationsschritt dokumentiert; die beobachtete
Codex-Alpha kann beim Readback dennoch Cache-/Konfigurationszustand
materialisieren.

### Claude Code

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target claude-code --scope user --yes
```

Claude Code benötigt keinen zusätzlichen Codex-Befehl; der Windows-VM-Lauf mit
Claude Code 2.1.252 zeigte den Eintrag nach diesem einen Installeraufruf als
`enabled` und bestätigte die target-native Entfernung mit demselben User-Scope.
Danach den gewählten Client in `C:\mein-steuer-ai` neu starten oder
seine Plugins neu laden. Git wird nur vom einmaligen Installer zum Klonen
benötigt. Zur Laufzeit ist Node.js 22+ die einzige zusätzliche Voraussetzung:
Es ist kein `npm install`, kein separates API-Terminal und kein weiterer
Runtime-Download nötig. Beim MCP-Start laufen weder npm noch npx und es wird
kein Netzwerkzugriff benötigt.

`plugins@1.3.4` ignoriert den Scope bei Codex und schreibt bei beiden Zielen in
clientverwaltete Benutzer-Caches beziehungsweise Benutzerkonfiguration. Beim
Claude-Code-Ziel ist `--scope user` absichtlich gewählt: Der VM-Test zeigte,
dass der vom Installer als `project` registrierte Zustand target-nativ nicht
entfernbar war, während `user` vollständig gelesen und entfernt werden konnte.
Damit gibt es keine physische Projektisolation. Der geöffnete Ordner begrenzt
weiterhin den Auftragskontext; für strikt getrennte Arbeitsdaten wird
zusätzlich ein eigener absoluter `SSE_API_CONFIG`-Pfad konfiguriert. Details,
Update und sichere Entfernung stehen in der
[Installationsanleitung](docs/INSTALLATION.md).

## Erster Auftrag

Der Plugin-Skill führt als kurzer First-run-Wizard durch den Start:

1. Er merkt sich den ursprünglichen Auftrag und ruft `sse_preflight` auf.
2. Er stellt höchstens eine Frage pro Nachricht. Ein bereits eindeutig
   geöffneter Fall wird nicht erneut ausgewählt; andernfalls bestätigt der
   Nutzer Fall und vollständige Belegquellen.
3. Der Agent zeigt einen sicheren Plan: zunächst lesen, vor dirty-fähiger
   Bedienung einmal sichern, Änderungen zurücklesen, nicht speichern und nie
   über ELSTER senden.
4. Nach der Bestätigung setzt er den ursprünglichen Auftrag fort.

Zum Beispiel:

```text
Prüfe den bereits geöffneten Steuerfall und erkläre Fehler, Warnungen und
unklare Angaben. Speichere und schließe ihn nicht.
```

```text
Vergleiche den geöffneten Fall mit allen Belegen in C:\MeineBelege\2025.
Frage nach, falls diese Quellen nicht vollständig erscheinen.
```

```text
Ändere im geöffneten Fall <FELD> auf <WERT>. Sichere den aktuellen Dateistand
vorher einmal, lies die Änderung zurück und speichere noch nicht.
```

```text
Bereite meine UStVA für <ZEITRAUM> aus den bestätigten Rechnungen vor.
Speichere nicht und sende nichts über ELSTER.
```

## Komponenten

```text
Codex / Claude Code
        │
        ├── Skill: sicherer Dialog und wiederverwendbare Arbeitsabläufe
        │
        └── MCP (stdio): Preflight, Schemas und Pfadredaktion
                         │
                         ▼
                 lokale API (Singleton auf Loopback)
                         │
                         ▼
             PowerShell/Native Worker → SteuerSparErklärung
```

Der MCP-Supervisor übernimmt nur eine exakt passende API-Identität oder startet
die mitgelieferte API unsichtbar. Fremde Dienste, alte Versionen und unklare
Portinhaber stoppen fail-closed und werden nie automatisch beendet.

Die direkte Installation der
[`@yadimon/steuer-spar-erklaerung-api`](packages/api/README.md) oder des
[`@yadimon/steuer-spar-erklaerung-mcp`](packages/mcp/README.md) bleibt als
fortgeschrittener npm-Weg verfügbar, ist aber nicht der Nutzerstandard.

## Dokumentation

- [Installation, First run, Update und Entfernung](docs/INSTALLATION.md)
- [Dokumentationsindex](docs/README.md)
- [Produktarchitektur](docs/ARCHITEKTUR.md)
- [API-/MCP-Vertrag](docs/API-MCP-VERTRAG.md)
- [Umsatzsteuer-Voranmeldung](docs/UMSATZSTEUER-VORANMELDUNG.md)
- [Verifikationsstand und offene VM-Matrix](docs/VERIFIKATION.md)
- [Skill-Vertrag](skills/steuer-spar-erklaerung/SKILL.md)
- [Releases](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases)

## Mitwirken

```powershell
npm ci
npm run test:fast
npm test
```

Niemals echte Steuerfälle, Belege, Namen, Steuer-IDs, Tokens, lokale Pfade oder
ungeschwärzte Screenshots veröffentlichen. Sicherheitsprobleme bitte privat
über [Report a vulnerability](SECURITY.md) melden.

Lizenz: [MIT](LICENSE)
