# Inoffizielle API und MCP für SteuerSparErklärung

[![Windows CI](https://github.com/yadimon/steuer-spar-erklaerung-mcp/actions/workflows/windows-ci.yml/badge.svg)](https://github.com/yadimon/steuer-spar-erklaerung-mcp/actions/workflows/windows-ci.yml)

Steuerfälle mit einem lokalen KI-Agenten prüfen, mit Belegen abgleichen und
nach Freigabe kontrolliert bearbeiten – über eine lokale API und einen
optionalen, PC-blinden MCP-Wrapper.

> **Öffentliche Beta für Windows x64.** Vor der ersten Änderung den aktuellen
> Dateistand einmal privat sichern und Ergebnisse selbst prüfen. Dieses Projekt
> ist keine Steuerberatung und übermittelt nichts an das Finanzamt.

## Status heute

| Profil | Status | Aktuell belegter Umfang |
| --- | --- | --- |
| `2025` / Engine 31 | `supported` / `full` | Lesen, Navigation, Ergebnis und Prüfer live geprüft; UStVA-Read für 2025 sowie `GewErfass2026` live geprüft; Schreibpfade nur einzeln freigegeben |
| `2024` / Engine 30 | `experimental` / `verification-only` | derselbe read-only Muster-Sweep nur mit bewusstem Entwickler-Opt-in; keine allgemeine Schreibfreigabe und kein Focusless-Commit |

- **ELSTER, Versand und jede Übermittlung ans Finanzamt sind gesperrt.**
- **BelegManager:** Freigegeben ist allein `receipt_manager_list` als
  `focusless-read`. Die neun übrigen Wege für Navigation, Detailauswahl,
  Import, Bearbeitung, Klassifikation, Verknüpfung und Löschen sind im
  normalen Hintergrundbetrieb fail-closed gesperrt. Es gibt keinen Opt-in über
  Konfiguration, API oder MCP und keinen zulässigen Maus-/Tastatur-Workaround.
- **Ändern ist keine Speicherfreigabe.** Der geöffnete Fall wird nie
  automatisch gespeichert, geschlossen oder durch eine Kopie ersetzt.
- Das Projekt ist unabhängig und weder mit Wolters Kluwer, Steuertipps noch
  der Akademischen Arbeitsgemeinschaft verbunden.

## Features

- einen geöffneten Steuerfall in SteuerSparErklärung 2025 strukturiert lesen,
  navigieren und mit dem Programm-Prüfer auswerten;
- freigegebene Felder und Tabellen gebunden ändern und unmittelbar
  zurücklesen;
- Belege und Tracking mit den Angaben im Steuerfall abgleichen;
- fehlende, widersprüchliche oder unklare Angaben als Report zusammenfassen;
- den geöffneten Fall nach hashverifizierter Sicherung des aktuellen Dateistands kontrolliert ändern,
  ohne ihn automatisch zu speichern;
- Umsatzsteuer-Voranmeldungen für 2025 vorbereiten, ohne sie zu übermitteln;
  vorgesehene `GewErfass2026`-Fälle ausschließlich lesen;
- 99 versionierte Operationen über die lokale HTTP-API oder optional über den
  PC-blinden MCP-Wrapper. Die aktuelle Verfügbarkeit jeder Operation steht
  maschinenlesbar in `capabilities.operationPolicy`.

Die Beta ersetzt weder SteuerSparErklärung noch eine fachliche Prüfung. Sie
automatisiert nachvollziehbare Arbeitsschritte in der installierten Anwendung.

## Beispiel

![Ein Agent bedient einen Musterfall über die lokale API und den MCP-Wrapper](docs/assets/demo/steuer-spar-erklaerung-demo.gif)

## Voraussetzungen

- Windows x64 mit installierter SteuerSparErklärung 2025;
- Node.js 22 oder neuer mit npm;
- ein lokal laufender Agent mit Datei- und Programmzugriff, bevorzugt Codex
  oder die eigenständig angemeldete Claude Code CLI;
- für sichtbare Bedienung eine entsperrte, währenddessen unbenutzte
  Windows-Sitzung.

Claude Cowork und andere entfernte Sandboxes können die host-lokale Anwendung
nicht bedienen. Die native Claude Code CLI benötigt unter Windows zusätzlich
Git for Windows und eine eigene Anmeldung. OpenCode bleibt ein sekundärer, best-effort Client.
Python, PowerShell 7, Docker und ein Repository-Checkout sind nicht erforderlich.

Die vollständigen Voraussetzungen und Erfolgskriterien stehen in der
[Installationsanleitung für Menschen und AI-Agenten](docs/INSTALLATION.md).

## Prompts

| Situation | Weg | Ergebnis |
| --- | --- | --- |
| Regelmäßig mit Steuerfällen arbeiten | [Dauerhaftes Setup](#dauerhaftes-setup-mit-zwei-prompts) **(empfohlen)** | Skill, API und MCP in einem festen Ordner; einmaliger Client-Neustart |
| Einmalig isoliert prüfen | [NPX-Prüflauf](#robuster-isolierter-prüflauf) | temporäre API im Vordergrund; kein MCP und keine dauerhafte Installation |
| Einen bereits geöffneten Fall ändern | [Geöffneten Fall bearbeiten](#bereits-geöffneten-fall-bearbeiten) | einmal sichern, ändern, zurücklesen und offen lassen |

### Dauerhaftes Setup mit zwei Prompts

#### 1. Lokal installieren

```text
Richte SteuerSparErklärung vollständig lokal nach
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md
ein. Installiere oder aktualisiere den Skill und verwende die neueste
veröffentlichte Version.
Standard-Setup ausführen: lokale API plus MCP.
```

`Standard-Setup ausführen` bestätigt den Plan einschließlich des Downloads, der
Installation in den Ordner und des bedingten additiven MCP-Merges. Der Agent
zeigt Plan und Diff weiterhin an. Der erste Lauf endet mit einem grünen
`health`; die Client-Verifikation bleibt bis zum Neustart offen. Starte den
lokalen Agenten dann einmal neu.

Für Codex konfiguriert die Installationsanleitung eine begrenzte Kernliste, die
den Standard-Prüflauf abdeckt. Der vollständige Katalog mit 99 Operationen
bleibt in `discovery` und `describe` sichtbar; aktuelle Laufzeitsperren wie die
neun Vordergrundwege des BelegManagers gelten für API-CLI und MCP gleichermaßen.

#### 2. Steuerfall prüfen

```text
Nutze $steuer-spar-erklaerung und prüfe meine Einkommensteuererklärung 2025.
Steuerfall: <ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>
Belege: <ABSOLUTE_BELEGORDNER>
Standard-Prüflauf ausführen.
```

Der neu geladene Agent prüft zuerst Serverliste und das echte MCP-Tool
`sse_health` mit `ok=true`. Der Standard-Prüflauf umfasst Prüffallkopie,
rein lesende Navigation, Report und das Schließen genau dieser Prüffallkopie
ohne Speichern sowie den Stopp ohne ELSTER.

Eine im Kalenderjahr 2026 abgegebene Einkommensteuererklärung bleibt hier der
unterstützte Steuerfall **2025**. Das Produktprofil 2026 ist nicht freigegeben.

<details>
<summary>Manuelle Installation ohne Agent</summary>

Ein Einrichtungsprogramm gibt es nicht. Der kanonische Weg steht vollständig
in [docs/INSTALLATION.md](docs/INSTALLATION.md); hier die kurze lokale Variante.
Im Zielordner zuerst prüfen, dass beide Registry-Versionen gleich sind:

```powershell
npm.cmd view @yadimon/steuer-spar-erklaerung-api version
npm.cmd view @yadimon/steuer-spar-erklaerung-mcp version
```

Dann beide Pakete lokal installieren und bei der offenen
[`skills`-CLI](https://www.skills.sh/docs/cli) genau den verwendeten Agenten wählen:
Eine nur geöffnete oder gecachte Webansicht ist keine installierte Skill-Version.

```powershell
npm.cmd install @yadimon/steuer-spar-erklaerung-api@latest @yadimon/steuer-spar-erklaerung-mcp@latest
npx.cmd -y skills add yadimon/steuer-spar-erklaerung-mcp --skill steuer-spar-erklaerung --agent <codex|claude-code|opencode> --copy --yes
.\node_modules\.bin\steuer-spar-erklaerung-api.cmd --config <ABSOLUTER_ORDNER>\config.json
```

Die Windows-Beispiele verwenden bewusst `npm.cmd` und `npx.cmd`, damit keine
Änderung der PowerShell-Execution-Policy nötig ist. Den dauerhaften MCP-Eintrag
nie auf einen flüchtigen `_npx`-Cache oder einen `.cmd`-Shim richten.

</details>

### Bereits geöffneten Fall bearbeiten

```text
Ändere im bereits geöffneten Steuerfall <WERT/FELD>. Sichere den aktuellen
Dateistand vorher einmal privat. Lass den Fall geöffnet und speichere ihn nicht.
```

Ist genau ein Fall offen, bleibt er der Arbeitsfall. Solange der Dateihash in
dieser Aufgabe unverändert bleibt, wird die verifizierte Sicherung auch für
mehrere Felder oder Folgeaufrufe wiederverwendet. Erst ein ausdrücklich
beauftragtes und geprüftes Speichern erzeugt einen neuen Dateistand.
`Save As`, eine Arbeits-/Korrekturkopie, Schließen, Verwerfen oder ein
Dateiwechsel sind keine impliziten Sicherheitsmaßnahmen.

### Robuster isolierter Prüflauf

Für eine einmalige Nur-Lese-Prüfung ohne dauerhaftes Setup. Der NPX-Weg läuft
ohne MCP und endet zusammen mit dem Vordergrund-Terminal:

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
den Originalfall. Standard-Prüflauf ausführen. Gleiche die Belege ab und führe
den Programm-Prüfer aus. Nicht speichern und nichts über ELSTER senden. Bei unklarer Identität,
Version, Bindung oder Beleglage fail-closed stoppen.

Danach die Arbeitskopie ohne Speichern schließen, bestätigen, dass keine
SteuerSparErklärung-Instanz offen ist, und die NPX-API beenden. Berichte die
ausgeführten Prüfungen und verbleibenden Grenzen ohne private Pfade oder
Steuerdaten auszugeben.
```

Dieser Weg setzt voraus, dass kein anderer Fall geöffnet ist. Es entsteht
keine globale Paketinstallation. Im NPX-Cache bleibt kein dauerhafter Startpfad.
Die API bleibt nur im Vordergrund-Terminal aktiv und wird nach dem Report beendet.
`Standard-Prüflauf ausführen` bestätigt zugleich, dass die genannten
Belegpfade vollständig sind.

## Typische Aufgaben

| Ziel | Auftrag an den Agenten | Standard |
| --- | --- | --- |
| Steuerfall prüfen | „Prüfe den geöffneten Fall und liste Fehler, Warnungen und unklare Angaben.“ | Nur lesen |
| Belege abgleichen | „Vergleiche den Fall mit den Belegen in diesem Ordner.“ | Originale unverändert lassen |
| Geöffneten Fall ändern | „Ändere diese Werte im geöffneten Fall, aber speichere noch nicht.“ | Einmal sichern, ändern, zurücklesen, offen lassen |
| Separate Korrekturdatei | „Erzeuge ausdrücklich eine Korrekturkopie und ändere sie.“ | Neue Datei nur auf diesen Auftrag |
| UStVA vorbereiten | „Bereite die UStVA für Juli vor und sende sie nicht ab.“ | Zeitraum und vorhandene Übermittlungen zuerst prüfen |

Für bereits übermittelte Fälle wird nicht automatisch eine Korrekturdatei
erzeugt. Eine separat benannte Korrektur oder Berichtigung braucht eine eigene
Freigabe; ein allgemeines `force` existiert nicht.

## Sicherheitsmodell

Die lokale API erzwingt technisch:

- ausschließlich Loopback; Browserherkunft und fremde Hosts werden abgewiesen;
- gesperrte ELSTER-, Versand- und Übermittlungsaktionen;
- gebundene Schreiboperationen mit Vorher-/Nachher-Prüfung;
- neue Ziele für Kopien, Backups und Archive statt Überschreiben vorhandener
  Dateien;
- hash- und pfadgebundenes Speichern;
- pfadfreie MCP-Antworten und argumentfreie API-Logs.

Der Prüfablauf der Skills garantiert zusätzlich:

- Lesen ist der Standard; Änderungen brauchen einen ausdrücklichen Auftrag;
- vor der ersten dirty-fähigen Navigation oder Mutation wird der aktuelle
  Dateistand einmal privat gesichert;
- Ändern erlaubt weder `sse_save` noch `sse_save_as`, Schließen oder Verwerfen;
- isolierte Prüfläufe verwenden eine verifizierte Kopie und schließen nur
  diese ohne Speichern.

Diese Ablaufdisziplin ist keine technische Sperre der API: Ein direkter lokaler
API-Client kann ausdrücklich benannte Dateien öffnen und speichern.
`--case-dir` ist die Auflösungs- und Schwärzungsgrenze für `cases:` und keine Zugriffssperre der direkten API.

Für sichtbare Bedienung muss Windows entsperrt und unbenutzt bleiben. Bei
unklarer Fenster-, Datei-, Dialog- oder Feldbindung stoppt die Automation,
statt zu raten. Details stehen in der
[Produktarchitektur](docs/ARCHITEKTUR.md) und im
[Betriebsvertrag](skills/steuer-spar-erklaerung/references/betriebsvertrag.md).

## Umsatzsteuer-Voranmeldung

Die UStVA-Werkzeuge wählen Zeitraum und Formularabschnitt über stabile
Fachschlüssel. Sie prüfen vorhandene Übermittlungen, lesen Werte zurück und
speichern oder senden nicht automatisch.

```text
Bereite meine Umsatzsteuer-Voranmeldung für Juli im bereits geöffneten Fall
vor. Sichere den aktuellen Dateistand einmal, speichere danach nicht. Prüfe
zuerst Jahr, Meldezeitraum, vorhandene Übermittlungen und Belege. Zeige jede
Änderung und sende nichts über ELSTER ab.
```

Für `*.GewErfass2026` wird die installierte Anwendung für das Steuerjahr 2025
mit `mode=einurvor` verwendet. Dafür ist derzeit nur der gebundene Leseweg bis
`ustva_read` live belegt; Änderungen, Speichern und Übermittlung für 2026 sind
nicht freigegeben. Der vollständige Ablauf steht unter
[Umsatzsteuer-Voranmeldung](docs/UMSATZSTEUER-VORANMELDUNG.md).

## MCP als optionale Produktfunktion anbinden

MCP ist ein dünner, PC-blinder Wrapper über dieselbe lokale API. Ein reines
API-Setup braucht MCP nicht; der oben beschriebene Agenten-Standard enthält MCP,
weil Prompt 1 ausdrücklich „lokale API plus MCP“ beauftragt.

Servereintrag, `.cmd`-Falle, begrenzter Codex-Katalog und additiver Merge stehen
in der [Installationsanleitung](docs/INSTALLATION.md). Ein Servereintrag oder
Handshake genügt nicht: Erfolg verlangt nach dem Client-Neustart einen echten
Aufruf von `sse_health` mit `ok=true`.

## API verwenden

Die API bindet ausschließlich an Loopback und beschreibt ihren Vertrag selbst:

```powershell
steuer-spar-erklaerung-call health
steuer-spar-erklaerung-call discovery
steuer-spar-erklaerung-call describe workspace_status
```

Argument- und Ergebnisschemata, Queue, Abbruch, Timeouts und Ressourcen stehen
im [API-/MCP-Vertrag](docs/API-MCP-VERTRAG.md). Lokale Pfade werden über
Ressourcen wie `cases:`, `documents:` und `results:` referenziert.

## Referenzdokumente

- [Dokumentationsindex](docs/README.md) — alle aktuellen Nutzer-, Vertrags-
  und Maintainer-Dokumente;
- [Installation und Erfolgskriterien](docs/INSTALLATION.md);
- [Haupt-Skill und sicherer Standardablauf](skills/steuer-spar-erklaerung/SKILL.md);
- [Release Notes](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases);
- [Sicherheitsprobleme privat melden](SECURITY.md).

## Mitwirken und Lizenz

Für Entwicklung aus dem Quellcode:

```powershell
npm ci
npm run test:fast
npm test
```

Live-UI-Tests bleiben opt-in und benötigen herstellereigene Wegwerfkopien und
eine unbenutzte Windows-Sitzung. Details stehen im
[Beitragsleitfaden](CONTRIBUTING.md) und im
[Verifikationsstand](docs/VERIFIKATION.md).

Fehlerberichte und Pull Requests sind willkommen. Niemals echte Steuerfälle,
Belege, Namen, Steuer-IDs, Tokens, lokale Pfade oder ungeschwärzte Screenshots
öffentlich hochladen. Sicherheitsprobleme gehören in GitHubs privaten Bereich
**Report a vulnerability**.

Lizenz: [MIT](LICENSE)
