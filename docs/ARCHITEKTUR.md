# Produktarchitektur

Stand: 2026-08-03

Dieses Dokument ist der überprüfbare Zielvertrag für API, MCP, Setup,
Steuerjahrprofile und öffentliche Skills. Es beschreibt das Produkt, nicht die
Entstehungsgeschichte einzelner UIA-Lösungen.

## Produktziel

Ein Windows-Nutzer soll die SteuerSparErklärung mit einem Agenten prüfen und
kontrolliert bearbeiten können, ohne Node.js, npm, Python oder PowerShell 7
global installieren zu müssen. Sichtbar bleibt die SteuerSparErklärung selbst;
API-, MCP- und Worker-Prozesse dürfen keine schwarzen Konsolenfenster öffnen.

Das Produkt besteht aus vier klaren Schichten:

```text
Agent oder eigenes Programm
        │
        ├── HTTP/JSON ───────────────┐
        │                            │
        └── MCP (dünner Wrapper) ────┤
                                     ▼
                              lokale SSE-API
                          Auth, Queue, Dateien,
                         Szenarien, Konfiguration
                                     │
                                     ▼
                         isolierter Windows-Worker
                         UIA, Win32, Dateiheader
                                     │
                                     ▼
                         SteuerSparErklärung UI
```

## Verbindliche Grenzen

### API

- Die lokale HTTP/JSON-API ist die einzige fachliche Ausführungsgrenze.
- Sie bindet ausschließlich an Loopback und verlangt ein lokales Token.
- Sie besitzt Operationen, Schemas, Queue, Abbruch, Dateiverwaltung,
  Szenarioausführung und Auflösung maschinenneutraler Ressourcen.
- Direkte API-Aufrufe und MCP-Aufrufe derselben Operation liefern dieselbe
  kanonische Ergebnisstruktur. Transportmetadaten wie Request-ID und Dauer
  dürfen außerhalb dieses fachlichen Ergebnisses liegen.
- Nur die API kennt absolute Installations-, Fall-, Dokument-, Arbeits- und
  Ergebnisverzeichnisse.

### MCP

- MCP ist ausschließlich ein Adapter zur laufenden API.
- MCP startet keine UI-Worker, durchsucht keinen PC und liest keine lokalen
  Dateien selbst.
- Öffentliche MCP-Schemas akzeptieren Ressourcenreferenzen wie
  `cases:arbeitsfall.Gew2025` oder `documents:rechnung.pdf`, keine absoluten
  PC-Pfade.
- Werkzeuge und fachliche Ergebnisse werden aus demselben API-Katalog
  abgeleitet. Ein getrennter MCP-Vertrag darf nicht driften.
- Ohne eingerichtete API liefert MCP eine kurze Setup-Diagnose statt lokaler
  Eigenlogik.

### Windows-Worker

- Jeder UIA-Aufruf läuft weiterhin in einem frischen Prozess. Das isoliert den
  bekannten Qt/UIA-Fehlerzustand, in dem spätere Reads still leer werden.
- Prozesse werden fensterlos gestartet, an eine Queue gebunden und bei
  Timeout oder API-Shutdown als eigener Prozessbaum beendet.
- UI-Mutationen bleiben an PID, HWND, Seite, Element, Vorwert und
  Nachbedingungen gebunden.
- Roh-Tastatur, generische Lösch- oder Versandwege sind keine öffentliche
  Operation.

### Harte Sicherheit

- ELSTER, Senden und sonstige Übermittlung ans Finanzamt bleiben immer
  gesperrt.
- Originale und übermittelte Fälle werden nicht gelöscht oder überschrieben.
- Fachliche Änderungen erfolgen nur an verifizierten Arbeitskopien und werden
  unmittelbar zurückgelesen.
- Ein fehlgeschlagener, abgebrochener oder unvollständiger Read gilt niemals
  als leerer Steuerstand.

## Ressourcen statt PC-Pfade

Die lokale Konfiguration ordnet logische Bereiche absoluten Verzeichnissen zu:

| Bereich | Inhalt | Schreibregel |
|---|---|---|
| `cases` | aktive Fälle und Arbeitskopien | hashgebunden |
| `documents` | Rechnungen, Belege, Exporte | standardmäßig nur lesen/kopieren |
| `workspace` | Szenarien, Text- und JSON-Eingaben | neue Datei oder Expected-SHA256 |
| `results` | kanonische Ergebnisdateien | neue Datei oder Expected-SHA256 |
| `backups` | Sicherungen und Archive | nur neue Ziele |

Eine Referenz besteht aus Bereich und relativem, normalisiertem Pfad. Die API
blockiert `..`, absolute Pfade, Junction-/Symlink-Ausbrüche und unerwartete
Dateitypen. In API-Antworten wird die stabile Referenz zurückgegeben; absolute
Pfade bleiben lokal und werden nicht in MCP-Ergebnisse oder Szenarioartefakte
übernommen.

## Laufzeit und Installation

### Nutzerstandard

Der Standard ist ein portable GitHub Release:

- entpacken statt installieren;
- keine Administratorrechte, Dienste, geplanten Aufgaben oder PATH-Änderungen;
- Start nur für die aktuelle Arbeit und kontrollierter Shutdown danach;
- npm bleibt ausschließlich Build-/CI-Werkzeug;
- Python wird aus dem Produkt entfernt;
- eine benötigte Node-Laufzeit wird gebündelt oder das gebaute Programm als
  ausführbares Artefakt ausgeliefert;
- Windows PowerShell 5.1 wird nach vollständiger Kompatibilitätsprüfung als
  Windows-Systembestandteil genutzt. Die portable Testmatrix prüft Parser,
  Worker, native DLL und Source-Fallback unter genau dieser Laufzeit. Ein
  privates oder globales PowerShell 7 gehört nicht zum Produkt.

Ein kleiner Online-Bootstrap darf später zusätzlich angeboten werden. Er ist
nicht der einzige Installationsweg und lädt ausschließlich gepinnte offizielle
Artefakte mit SHA256-Prüfung in den lokalen Arbeitsbereich.

### Betriebsarten

1. **Standard:** API bei Bedarf fensterlos starten, Aufgabe ausführen, sauber
   beenden.
2. **MCP-Komfort:** Agentkonfiguration verweist direkt auf den portable
   MCP-Launcher; dieser spricht mit derselben API.
3. **Dauerbetrieb (opt-in):** Autostart oder geplante Aufgabe nur nach
   ausdrücklicher Zustimmung des Nutzers.

## Steuerjahrprofile

API, MCP, Queue, Ressourcen und Sicherheitsverträge bleiben gemeinsam. Nur
produktabhängige Daten liegen in einem Jahresprofil:

```text
profiles/
  2025/
    profile.json
    page-objects.json
    fixtures/
    tests/
```

Ein Profil definiert mindestens Steuerjahr, unterstützte Engine-Hauptversion,
Installationsmerkmale, Dateiendungen, Startmodi und Page Objects. Eine
Jahresversion gilt erst dann als unterstützt, wenn Build, Vertragsprüfungen und
ein realer read-only Smoke für dieses Profil bestanden sind.

Aktuell ist ausschließlich 2025 produktiv unterstützt. Andere installierte
Jahre werden erkannt und angezeigt, aber fail-closed nicht bedient. Ein zweiter
MCP-Server pro Jahr ist nicht vorgesehen, solange sich nur Profildaten ändern.
Erst eine nachgewiesene, grundlegende UI-/Protokollabweichung rechtfertigt
einen separaten Worker-Adapter.

## Setup-Wizard

Der Wizard ist deutsch, stellt jeweils nur eine Frage und nennt immer die
empfohlene Standardantwort. Er prüft zunächst selbst und fragt nur, was nicht
sicher erkannt oder automatisch innerhalb der Berechtigungsgrenze erledigt
werden kann.

Ohne Antworten verwendet er sichere Defaults. Er speichert auch die
Entscheidung „nichts kopieren“ in einem persistenten Arbeitsbereich. Er darf
automatisch read-only prüfen, lokale Ordner anlegen, neue Arbeitskopien
erzeugen und repo-/portable-eigene Dateien schreiben. Vor externen
Kontoverbindungen, Massenkopien, globalen Installationen, Agentkonfiguration,
Autostart oder Steuerdatenänderungen ist eine passende Bestätigung notwendig.

## Öffentliche Skills

Öffentliche Skills liegen im von `npx skills` auffindbaren Layout
`skills/<name>/SKILL.md`. Namen und Verzeichnis stimmen überein, verwenden nur
Kleinbuchstaben/Ziffern/Bindestriche und tragen den eindeutigen Präfix
`steuer-spar-erklaerung-`.

Der Einstieg `steuer-spar-erklaerung` bleibt allein installierbar und enthält
genug Setup- und Laufzeitlogik für den Standardfall. Zusätzliche direkte
Einstiege, etwa `steuer-spar-erklaerung-setup`, sind Komfortoberflächen, keine
zwingenden Abhängigkeiten. Agent-spezifische Metadaten sind optional; die
eigentliche Anleitung bleibt mit Codex, Claude Code und anderen
Agent-Skills-kompatiblen Agenten verwendbar.

Skills enthalten nur Nutzer- und Laufzeitwissen:

- Erkennen, einrichten und verbinden;
- Berechtigungs- und Sicherheitsgrenzen;
- Arbeitsablauf und Rückleseverträge;
- verständliche Fragen mit deutschen Defaults;
- Fehlerdiagnose und sichere Recovery.

Gescheiterte Entwicklungsversuche, historische Bugs, Messprotokolle und
Refactoring-Entscheidungen gehören nicht in installierte Skills.

## Szenario- und Paritätsvertrag

Ein produktiver Szenariolauf muss dynamische Ausgaben vorheriger Schritte
referenzieren und garantierte Cleanup-Schritte besitzen. Der komplexe
Referenzfall umfasst mindestens:

1. Eingabedateien inventarisieren und hashen;
2. eine neue Arbeitskopie erzeugen;
3. Fall und SSE-Version verifizieren;
4. SSE starten und PID/HWND binden;
5. aktuellen Zustand lesen;
6. eine explizit erlaubte Änderung auf der Wegwerfkopie ausführen;
7. Feld und abhängige Summe/Prüferzustand zurücklesen;
8. hashgebunden speichern;
9. Ergebnis und Kopie erneut hashen;
10. garantiert schließen oder einen eindeutig dokumentierten offenen Zustand
    zurückgeben.

Der gleiche Fall wird einmal direkt über HTTP und einmal über MCP ausgeführt.
Beide Wege müssen byteidentische kanonische Ergebnisdateien und denselben
SHA256 liefern. Ein Mock-Test bleibt als schneller Vertragstest erhalten,
ersetzt aber nicht den explizit freigegebenen realen Fixture-Test.

## Definition of Done

Eine Funktion gilt nur als lauffähig, wenn:

- sie im gemeinsamen API-Katalog mit Eingabe- und Ergebnisschema steht;
- direkte API- und MCP-Aufrufe denselben fachlichen Vertrag erfüllen;
- Abbruch, Timeout und Prozesscleanup getestet sind;
- kein sichtbares Konsolenfenster entsteht;
- Sicherheits- und Ressourcenbegrenzungen fail-closed getestet sind;
- bei UI- oder Steuerdatenbezug ein readback-orientierter Realtest oder eine
  ausdrücklich benannte Fixture-Voraussetzung existiert.

Der Gesamtstand ist erst produktiv, wenn die schnelle portable Testsuite, alle
verfügbaren Real-Fixture-Tests, die Skill-Validierung, ein unabhängiger
Claude-Review und der abschließende Anforderungsabgleich grün sind.
