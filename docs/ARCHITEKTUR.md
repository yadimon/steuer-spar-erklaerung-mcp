# Produktarchitektur

Stand: 2026-08-04

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
- POST-Nutzdaten müssen `application/json` und gültiges UTF-8 sein; fehlerhafte
  Transportdaten erreichen weder Argumentparser noch Executor.
- Der API-Client liest nur JSON in gültigem UTF-8 und höchstens 40 MiB; ein
  optionales Screenshot-Bild wird vor Base64 auf höchstens 20 MiB begrenzt
  und nur mit gültiger PNG-Signatur als Bild ausgeliefert.
- Der Client folgt keinen HTTP-Redirects und akzeptiert Erfolgs- oder
  Fehlerhüllen nur mit passender API-Version und gültiger Request-ID; bei
  Erfolgen sind zusätzlich Operation und nichtnegative Dauer gebunden.
- Sie bindet ausschließlich an Loopback und verlangt ein lokales Token.
- Sie besitzt Operationen, Schemas, Queue, Abbruch, Dateiverwaltung,
  Szenarioausführung und Auflösung maschinenneutraler Ressourcen.
- Ihr authentifizierter Katalog `GET /v1/operations` veröffentlicht die 86
  Argumentverträge als JSON Schema Draft 7 zusammen mit Traits, Grenzen,
  Fallback-Planung und Sicherheitsstatus. Reine API-Clients brauchen MCP daher
  weder zur Discovery noch zur Wahl des sicheren generischen Folgeschritts.
- `GET /v1/operations/{operation}` liefert denselben Vertrag für eine einzelne
  Operation, damit ein Agent nicht für jeden unbekannten Aufruf den Gesamtkatalog
  übertragen und verarbeiten muss.
- `GET /v1/openapi.json` projiziert genau diese Laufzeitquelle zusätzlich auf
  OpenAPI 3.1. Neben den 86 Operationspfaden stehen dort auch Healthcheck,
  Gesamtkatalog und OpenAPI-Abruf selbst; es gibt keinen separat gepflegten
  oder permissiveren API-Vertrag.
- Der direkte CLI-Client akzeptiert komplexe Argumente nur aus einer begrenzten
  UTF-8-Datei oder aus begrenztem stdin, nie als Steuerwerte in Prozessargumenten.
- Direkte API-Aufrufe und MCP-Aufrufe derselben Operation liefern dieselbe
  kanonische Ergebnisstruktur. Transportmetadaten wie Request-ID und Dauer
  dürfen außerhalb dieses fachlichen Ergebnisses liegen.
- Nur die API kennt absolute Installations-, Fall-, Dokument-, Arbeits- und
  Ergebnisverzeichnisse.
- Konfiguration und Wizard verweigern überlappende Fall-, Dokument-, Ergebnis-
  und Backupbereiche. `documents`, `results` und `backups` dürfen als getrennte
  Unterordner im Workspace oder ganz außerhalb liegen; keiner darf den
  Workspace selbst enthalten oder ersetzen. Vorhandene Junctions/Symlinks und
  der reale nächste Vorfahr noch nicht angelegter Ziele fließen in denselben
  Vergleich ein; vorhandene Nicht-Ordner werden vor API-Start abgewiesen.
- Fachliche Kompositionen wie `ustva_*` liegen in der API. Der MCP veröffentlicht
  nur dasselbe Schema und reicht den Aufruf weiter; der Worker erhält daraus
  eng gebundene generische UI-Transaktionen.
- `capabilities` beschreibt ohne Worker- oder PC-Zugriff Selektoren,
  Klickmuster, Dialog-Button-Allowlist, Fallback-Stufen und harte
  Sicherheitsmerkmale. Agenten lesen diese Laufzeitquelle statt Methoden zu
  erraten.
- Fachliche Fehler bleiben als strukturierte, redigierte API-Ergebnisse bis
  zum MCP-Client erhalten. Ein `ok=false` darf nicht in einen unklassifizierten
  Textfehler umgewandelt werden.

### MCP

- MCP ist ausschließlich ein Adapter zur laufenden API.
- Ein MCP-Abbruch wird über den HTTP-Client zur API propagiert, damit deren
  Abort-/Prozessbaum-Cleanup greift; der nächste mutierende Versuch verlangt
  erneut einen gezielten Zustands-Readback.
- MCP startet keine UI-Worker, durchsucht keinen PC und liest keine lokalen
  Dateien selbst.
- Der Grenzvertrag verfolgt alle transitiven Importe der 17 `mcp-*.ts`-Module.
  Er erlaubt aus der PC-Umgebung ausschließlich `SSE_API_URL` und
  `SSE_API_TOKEN`; Worker-, Workspace-, Setup- und Produktpfadmodule sind von
  dieser Abhängigkeitsfläche ausgeschlossen.
- Öffentliche MCP-Schemas akzeptieren Ressourcenreferenzen wie
  `cases:arbeitsfall.Gew2025` oder `documents:rechnung.pdf`, keine absoluten
  PC-Pfade.
- Die letzte MCP-Ausgabegrenze redigiert zusätzlich nicht konfigurierte
  Windows-/UNC-/Datei-URLs und typische POSIX-Systempfade. Normale HTTPS-URLs
  bleiben unverändert, damit ein separat installierter Wrapper weder Details
  des API-Rechners noch seines eigenen Hosts preisgibt.
- Werkzeuge und fachliche Ergebnisse werden aus demselben API-Katalog
  abgeleitet. Ein getrennter MCP-Vertrag darf nicht driften.
- Jede veröffentlichte Eingabeeigenschaft muss auch verschachtelt eine eigene
  Agentenbeschreibung tragen; der echte MCP-Katalog wird darauf geprüft.
- Standardisierte MCP-Annotations und `capabilities` beziehen read-only-,
  nicht-destruktiv-zustandsbehaftete und potenziell destruktive Gruppen aus
  derselben typisierten Quelle. Beide Partitionen sind lückenlos.
- Der Prozesseinstieg bleibt minimal; 86 Werkzeugdefinitionen liegen exakt
  einmal in sechs fachlichen Modulen. Ein Quellvertrag begrenzt jedes Modul auf
  24 KiB, ohne den gemeinsamen Laufzeitkatalog zu duplizieren.
- Ohne eingerichtete API liefert MCP eine kurze Setup-Diagnose statt lokaler
  Eigenlogik.
- Spezialwerkzeuge werden bevorzugt. Fehlen sie für ein Control, führt die
  veröffentlichte Fallback-Leiter von einem frischen Zustand über rein lesende
  Entdeckung zu genau einer gebundenen Interaktion samt Readback.

### Windows-Worker

- Jeder UIA-Aufruf läuft weiterhin in einem frischen Prozess. Das isoliert den
  bekannten Qt/UIA-Fehlerzustand, in dem spätere Reads still leer werden.
- Prozesse werden fensterlos gestartet, an eine Queue gebunden und bei
  Timeout oder API-Shutdown als eigener Prozessbaum beendet.
- Operationsargumente liegen in einer exklusiven, auf 8 MiB begrenzten
  UTF-8-Tempdatei. Dadurch gelten weder Windows' Kommandozeilenlimit noch
  Base64-Steuerwerte in der Prozessliste; die Node-Brücke entfernt die Datei
  nach Erfolg, Fehler, Timeout oder Abbruch.
- Die Queue ist auf 32 laufende/wartende Aufträge begrenzt; ein abgebrochener
  wartender Auftrag startet später keinen Worker, und Überlast liefert `busy`.
- Auch der direkte Worker besitzt keinen Versand-Freischalter. stdout/stderr
  sind begrenzt und werden als striktes UTF-8 dekodiert.
- Die vorkompilierte native Brücke wird vor dem Laden gegen getrennte SHA256-
  Werte für C#-Quelle und DLL-Bytes geprüft. Die Hashes werden begrenzt
  gestreamt; Quelle, DLL und Manifest besitzen eigene Größenlimits. Jede
  Abweichung wechselt vor `Add-Type` auf den getesteten Quelltext-Fallback.
- UI-Mutationen bleiben an PID, HWND, Seite, Element, Vorwert und
  Nachbedingungen gebunden.
- Feld-, Tabellen- und UStVA-Beträge werden mit gemeinsam getesteter deutscher
  Gruppierung und exakter Dezimalgleichheit zurückgelesen. Präfixe sowie
  mehrdeutige Punktfolgen gelten nicht als Übereinstimmung.
- Roh-Tastatur, generische Lösch- oder Versandwege sind keine öffentliche
  Operation.
- Unbekannte Dialogbuttons werden inventarisiert und als nicht unterstützt
  gemeldet. Nur die gemeinsame feste Allowlist ist ausführbar; ein Agent kann
  die Sperre nicht durch frei formulierten Buttontext umgehen.

### Harte Sicherheit

- ELSTER, Senden und sonstige Übermittlung ans Finanzamt bleiben immer
  gesperrt.
- Originale und übermittelte Fälle werden nicht gelöscht oder überschrieben.
- Fachliche Änderungen erfolgen nur an verifizierten Arbeitskopien und werden
  unmittelbar zurückgelesen.
- UStVA-Frequenz, Monat/Quartal, Kennzeichen und Betragsfelder sind
  semantisch katalogisiert. Gleich benannte UI-Aktionen dürfen nicht generisch
  erraten werden; ein bereits übermittelter Zeitraum wird nie still dupliziert.
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

Vor einem Überschreiben werden redigierte Backups inhaltlich verifiziert. Alle
neuen Setup-Inhalte werden zuerst vollständig in exklusiven Nachbardateien
geschrieben und erst danach pro Datei atomar umbenannt; ein Stagingfehler lässt
sämtliche bisherigen Ziele unverändert. API-Konfigurationen, Produktprofile,
vorhandene Setup-Dateien und Workspace-Texte werden strikt als UTF-8 und mit
festen Größenlimits gelesen; ein während des Lesens wachsendes Ziel kann diese
Grenzen nicht überlaufen.

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

`continueOnError` ist nur für ausdrücklich katalogisierte read-only Schritte
zulässig. Danach darf im Hauptlauf keine Mutation folgen. `finally` akzeptiert
nur denselben Read-only-Katalog plus sieben explizite Cleanup-Operationen und
kein `continueOnError`. Alle Operationsnamen werden vor dem ersten UI-Schritt
geprüft. Szenario-Rekursion und direkte Textschreiboperationen bleiben gesperrt.
Unbekannte Szenario-/Schrittfelder werden strikt abgelehnt. Capture- und
Erwartungsdetails sind begrenzt; ein Bericht über 1 MiB wird deterministisch auf
Status, Bytezahl und SHA-256 der ausgelassenen Details verdichtet, damit nach
bereits ausgeführten UI-Schritten weiterhin eine Ergebnisdatei entsteht.

## Testsuite

Der Suite-Plan enthält drei Phasen: Builds laufen seriell, voneinander
unabhängige Vertragstests mit begrenzter Parallelität und globale Sentinels
exklusiv. Der No-Console-Test darf nie parallel zu Prozessen anderer Tests
laufen. Jeder Schritt behält eigenen Namen, Dauer, begrenzte Diagnoseausgabe und
Fehlerzuordnung. Erfolgreiche Unterausgabe ist nur mit `SSE_TEST_VERBOSE=1`
sichtbar; Fehler liefern stets einen kompakten Auszug.
`SSE_TEST_CONCURRENCY` darf die Parallelität für Diagnose oder
schwächere Rechner reduzieren, aber keine Prüfung aus dem Plan entfernen. Eine
harte Schrittfrist und ein begrenzter Ausgabepuffer beenden Hänger oder
Log-Stürme samt exakt gestartetem Prozessbaum.
Kann selbst nach dem harten Wachhund kein Prozessende nachgewiesen werden,
sperrt der API-Prozess alle weiteren Worker-Aufrufe bis zum Neustart. So kann
kein möglicherweise verwaister UI-Worker mit einem Folgeauftrag konkurrieren.

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
