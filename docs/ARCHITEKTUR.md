# Produktarchitektur

Stand: 2026-08-16

Dieses Dokument ist der überprüfbare Zielvertrag für API, MCP, Setup,
Steuerjahrprofile und öffentliche Skills. Es beschreibt das Produkt, nicht die
Entstehungsgeschichte einzelner UIA-Lösungen.

> **Statushinweis:** Dieses Dokument enthält auch Zielverträge, die noch nicht
> vollständig erreicht sind. Der aktuell belegte Produktstand und offene Gates
> stehen in [VERIFIKATION.md](VERIFIKATION.md); Transportdetails stehen in
> [API-MCP-VERTRAG.md](API-MCP-VERTRAG.md).

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
                       Auth, Queue, Dateien/Hash,
                         Szenarien, Konfiguration
                                     │
                                     ▼
                         isolierter Windows-Worker
                              UIA, Win32
                                     │
                                     ▼
                         SteuerSparErklärung UI
```

## Verbindliche Grenzen

### API

- Die lokale HTTP/JSON-API ist die einzige fachliche Ausführungsgrenze.
- POST-Nutzdaten müssen `application/json` und gültiges UTF-8 sein; fehlerhafte
  Transportdaten erreichen weder Argumentparser noch Executor.
- Der API-Client hält Aufruferabbruch und eigene Frist bis zum letzten Byte
  des begrenzten Antwortkörpers aktiv und liest nur JSON in gültigem UTF-8
  und höchstens 40 MiB; ein
  optionales Screenshot-Bild wird vor Base64 auf höchstens 20 MiB begrenzt
  und nur mit gültiger PNG-Signatur als Bild ausgeliefert.
- Frühe Client-Protokollabbrüche wie ein falscher Response-`Content-Type`
  canceln den ungenutzten Body, bevor sie den Fehler liefern. Streaming-Body
  und Keep-alive-Socket bleiben dadurch nicht im lokalen Prozess gebunden.
- Der produktive Defaulttransport nutzt direkt Nodes Loopback-HTTP-Client und
  besitzt keine zusätzliche 300-Sekunden-`fetch`-/Undici-Frist. Damit bleibt
  das zwölfsekündige Prozessbaum-Cleanup-Fenster auch nach einer maximalen
  Fünf-Minuten-Operation erhalten. Injizierte Test-/Alternativtransporte mit
  eindeutigen Header-/Body-Timeoutcodes werden weiterhin als `timeout` mit
  unbekanntem Operationszustand behandelt, niemals als `network`.
- Direkte Node- und verschachtelte Undici-Fehlercodes werden gleich
  ausgewertet. Verbindungsabbrüche während eines Operations-POSTs liefern
  `transport-unknown` samt verpflichtendem Zustands-Readback; ein sicher
  verweigerter Verbindungsaufbau bleibt `network`.
- HTTP 204, 205 und 304 werden als gültige Antworten ohne Body-Stream
  konstruiert; die strengere Redirect-Sperre des API-Clients bleibt davon
  unberührt.
- Der Client folgt keinen HTTP-Redirects und akzeptiert Erfolgs- oder
  Fehlerhüllen nur mit passender API-Version und gültiger Request-ID; bei
  Erfolgen sind zusätzlich Operation und nichtnegative Dauer gebunden.
- Sie bindet ausschließlich an Loopback und verlangt ein lokales Token.
- Sie besitzt Operationen, Schemas, Queue, Abbruch, Dateiverwaltung,
  Szenarioausführung und Auflösung maschinenneutraler Ressourcen.
- Ihr authentifizierter Katalog `GET /v1/operations` veröffentlicht alle
  Argumentverträge und die versionierten `Result_<operation>`-Mindestverträge
  als JSON Schema Draft 7 zusammen mit Traits, Grenzen, Fallback-Planung und
  Sicherheitsstatus. Reine API-Clients brauchen MCP daher weder zur Discovery
  noch zur Wahl des sicheren generischen Folgeschritts.
- `GET /v1/operations/{operation}` liefert denselben Vertrag für eine einzelne
  Operation, damit ein Agent nicht für jeden unbekannten Aufruf den Gesamtkatalog
  übertragen und verarbeiten muss.
- `GET /v1/openapi.json` projiziert genau diese Laufzeitquelle zusätzlich auf
  OpenAPI 3.1. Neben den Operationspfaden stehen dort auch Healthcheck,
  Gesamtkatalog und OpenAPI-Abruf selbst; es gibt keinen separat gepflegten
  oder permissiveren API-Vertrag. Wiederkehrende Blattverträge wie optionaler
  Text, Flag, SHA-256 und Guard-Objekt werden dort als gemeinsame Komponenten
  referenziert. Auch der für alle 87 Operationen identische
  `ok/kind/error/ms`-Umschlag liegt einmal als `OperationResultEnvelope` vor;
  jedes `Result_<operation>` ergänzt per `allOf` seine eigenen Fachfelder. Das
  hält die vollständiger gewordenen Result-Schemas unter dem Größenbudget,
  ohne Discovery oder Laufzeitvalidierung abzuschwächen.
- Der direkte CLI-Client akzeptiert komplexe Argumente nur aus einer begrenzten
  UTF-8-Datei oder aus begrenztem stdin, nie als Steuerwerte in Prozessargumenten.
  Mehrzeilige oder nicht-ASCII Nutzdaten verwenden immer die Datei: Eine
  Windows-PowerShell-Pipeline kann gültiges JSON erzeugen und dabei trotzdem
  Umlaute durch `?` ersetzen. Stdin bleibt kleinen, im selben Prozess
  erzeugten ASCII-Objekten vorbehalten.
- Direkte API-Aufrufe liefern das vollständige Executor-/Worker-/Kompositionsergebnis.
  Dieses wird vor der HTTP-Ausgabe gegen den operationsspezifischen
  Ergebnisvertrag geprüft; malformed Ergebnisse werden redigiert als
  `invalid-operation-result` gestoppt.
  Die gemeinsamen MCP-Registrierer veröffentlichen dieses Ergebnis zusätzlich
  PC-pfad-redigiert und ohne bereits als Bildblock übertragene Base64-Bytes als
  `structuredContent`; kompakte Textprojektionen bleiben vorerst aus
  Kompatibilitätsgründen bestehen. Auch die spezialisierten Bild-,
  Prüfer-, Workspace- und Navigationshandler nutzen dieselbe Strukturgrenze.
  Transportmetadaten
  wie Request-ID und Dauer liegen außerhalb des fachlichen Ergebnisses.
- Nur die API kennt absolute Installations-, Fall-, Dokument-, Arbeits- und
  Ergebnisverzeichnisse.
- `case_hash` hasht und liest den begrenzten AKAD-Kopf direkt im API-Prozess;
  das nicht-ausführliche `list_cases` liest denselben Kopf lokal für alle
  profilkonformen Fälle. `verbose: true` und ein lokal nicht sicher lesbarer
  AKAD-Kopf fallen auf den kompatiblen Worker zurück. Das opt-in Live-Gate
  vergleicht beide Implementierungen auf jedem Profil feldgenau. Die API
  verwirft lokale Ergebnisse, wenn eine Datei während des Lesens geändert oder
  ersetzt wird. Versteckte/System-Falldateien gehören dabei ausdrücklich zum
  Bestand; Liste, Sicherung und Archiv-Inventar verwenden dieselbe Regel.
  Dateiöffnung, Stream und ein eventueller Worker-Fallback verbrauchen ein
  gemeinsames Abbruch-/Timeout-Budget statt die Client-Frist neu zu starten.
  Unter zwei Sekunden Rest startet die API keinen neuen PowerShell-Fallback.
- `page_objects` liefert den öffentlichen, profilierten UI-Metadatenkatalog
  ebenfalls direkt aus der API. Manifest und Katalog werden pro Aufruf neu
  gelesen und gemeinsam validiert; ein Startzeit-Cache wäre während der
  schrittweisen Profilentwicklung veraltet. Exakte und eindeutig
  case-insensitive IDs entsprechen der PowerShell-Auflösung; IDs, die sich nur
  in Groß-/Kleinschreibung unterscheiden, sind bereits im Profilschema
  ungültig. Lokaler Profildrift fällt mit demselben Restbudget auf den Worker
  zurück. Ein eigener Offline-Paritätstest vergleicht beide Pfade auf jedem
  ausgelieferten Profil und beweist Reload, Timeout sowie Fallback separat.
- `verify` prüft den strikt UTF-8-/JSON- und SHA-256-gebundenen `collect`-Stand
  direkt im API-Prozess. Der Dateihandle ist auf 16 MiB begrenzt; Hash,
  Dateigröße, Geräte-/Dateiidentität und Zeitstempel werden vor und nach der
  Auswertung stabil gebunden. Fehlender Seiten-Array oder ein nicht-boolesches
  `vollstaendig` sind fail-closed. Der reine Vergleich bildet deutsche und
  invariante Zahlenformate mit exakter Dezimalarithmetik und Banker's-Rounding
  ab. Unicode-/Quelltypen außerhalb der nachgewiesenen PowerShell-Parität
  fallen mit demselben Restbudget auf den Worker zurück, statt lokal einen
  möglicherweise großzügigeren Treffer zu bestätigen.
- `make_working_copy` kopiert profilkonforme Falldateien direkt im API-Prozess
  in ein atomar neues `cases:`-Ziel. Quelle und Ziel bleiben bis zum
  vollständigen Doppel-Readback geöffnet; SHA-256, Geräte-/Dateiidentität,
  Größe und Zeitstempel müssen konsistent bleiben. Abort/Timeout räumt nur
  nach erneut bewiesener Eigentümerschaft auf, fremder Zielinhalt wird nie
  blind gelöscht, und nach begonnener Mutation existiert kein Worker-Fallback.
  Der Node-Dateihandle kann die exklusiven Windows-Share-Modi des Workers nicht
  ausdrücken: Konkurrenz wird daher erkannt statt präventiv ausgeschlossen.
  Auch der sichere Rollback besitzt ohne `DELETE_ON_CLOSE` ein kleines
  Restfenster zwischen letzter Identitätsprüfung und `unlink`; dieser
  Unterschied ist Teil des veröffentlichten Betriebsvertrags. Dateiöffnungen
  sind deadlinegebunden und ein spät erzeugtes leeres Ziel wird nachgeräumt;
  die nicht abbrechbaren Node-`FileHandle`-Operationen prüfen kooperativ
  zwischen 1-MiB-Blöcken. Ein einzelner hängender Kernel-/Netzlaufwerkaufruf
  kann das Zeitbudget daher überschreiten, während eigentumsgeprüftes Cleanup
  absichtlich nicht mitten im Sicherheitsnachweis abgebrochen wird.
- `backup_cases` komponiert dieselbe verifizierte Einzelkopie ebenfalls im
  API-Prozess und startet über API oder MCP keinen PowerShell-Worker. Das Ziel
  und bei Bedarf seine verschachtelte Elternkette entstehen komponentenweise
  exklusiv neu; vor jeder Kopie sowie vor dem Manifest müssen Quell-
  Fallinventar, Zielinventar und Verzeichnisidentitäten exakt zum erwarteten
  Stand passen. Nach dem Manifest werden Quelle sowie Zielinventar und
  Zielidentität erneut geprüft. Jede Datei wird vor und nach der Kopie gehasht,
  das CSV-Manifest bleibt bytekompatibel zum direkten Worker. Bei Abort,
  Timeout oder Interferenz entfernt der Rollback nur Dateien mit weiterhin
  passender Identität, Größe und Eigenhash. Ein partielles Eigenmanifest gilt
  nur bei unveränderter Identität und exaktem Präfix der beabsichtigten Bytes
  als löschbar. Fremde oder veränderte Ziele bleiben erhalten und werden als
  `retainedTargets` gemeldet. Die für `make_working_copy`
  dokumentierten Windows-Share- und Rollback-TOCTOU-Grenzen gelten auch hier;
  der direkte Worker bleibt Kompatibilitätsschnittstelle und Paritätsreferenz.
- `archive_cases` bindet über API und MCP den vollständigen aktiven
  Fallbestand einschließlich profilkonformer `_Backup`-Dateien, alle
  erwarteten Hashes und den sicher falschen Übermittlungsstatus, ohne einen
  Worker zu starten. `SSE.exe` wird per fail-closed Prozessprobe vor dem
  Preflight und nochmals direkt vor jeder Quellentfernung ausgeschlossen. Jede
  Archivdatei entsteht mit `wx+`, wird vollständig verifiziert und erst dann
  vom Quellpfad entfernt; ein überschreibendes Node-`rename` wird bewusst nicht
  verwendet. Offene Quell-Handles bleiben bis zur Endfreigabe oder zum
  Rollback erhalten, sodass selbst ein nachträglich fremd verändertes
  Archivziel nicht als Rücksicherungsquelle vertraut werden muss. Bei
  gleichzeitig fremd belegtem Quell- und Zielpfad bewahrt eine exklusive,
  hashgeprüfte `.sse-recovery-*`-Datei die Originalbytes im identitätsgebundenen
  Fallordner. Manifest, verschachtelte Zielkette, Abort/Timeout und fremde
  Einträge folgen denselben Eigentums- und Cleanup-Regeln wie die lokale
  Fallsicherung. Dateisysteme ohne sichere Namensentfernung bei offenem Handle
  enden fail-closed mit einer erhaltenen, gemeldeten Archivkopie. Der direkte
  Worker bleibt für direkte Aufrufer und als
  Paritätsreferenz bestehen.
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
  Klickmuster, Dialog-Button-Allowlist, Fallback-Stufen, harte
  Sicherheitsmerkmale, die vollständige profilabhängige Operationsmatrix und
  eine releasegebundene, rein informative Live-Evidenz je Operation. Agenten
  lesen diese Laufzeitquelle statt Methoden oder Verifikationsstand zu
  erraten; `liveEvidence` verändert niemals `operationPolicy` und steht auch
  in der direkten API-Discovery ohne MCP bereit.
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
- Werkzeugnamen, API-Zuordnung, Eingaben und versionierte
  Ergebnismindestverträge werden aus gemeinsamen Katalogen abgeleitet. Alle 87
  Werkzeuge deklarieren das operationsspezifische `outputSchema` und liefern
  das vollständige, pfadredigierte nicht-binäre Ergebnis als
  `structuredContent`. Bereits als MCP-Bildblock gelieferte Base64-Bytes werden
  nicht dupliziert. Die offenen Zusatzfelder halten neue fachliche Readbacks
  kompatibel; sie ersetzen keine Live-Evidenz für noch ungetestete
  UI-Varianten.
- Jede veröffentlichte Eingabeeigenschaft muss auch verschachtelt eine eigene
  Agentenbeschreibung tragen; der echte MCP-Katalog wird darauf geprüft.
- Standardisierte MCP-Annotations und `capabilities` beziehen read-only-,
  nicht-destruktiv-zustandsbehaftete und potenziell destruktive Gruppen aus
  derselben typisierten Quelle. Beide Partitionen sind lückenlos.
- Der Prozesseinstieg bleibt minimal; Werkzeugdefinitionen liegen exakt einmal
  in sechs fachlichen Modulen. Ein Quellvertrag begrenzt jedes Modul auf
  24 KiB, ohne den gemeinsamen Laufzeitkatalog zu duplizieren.
- Ohne eingerichtete API liefert MCP eine kurze Setup-Diagnose statt lokaler
  Eigenlogik.
- Spezialwerkzeuge werden bevorzugt. Fehlen sie für ein Control, führt die
  veröffentlichte Fallback-Leiter von einem frischen Zustand über rein lesende
  Entdeckung zu genau einer gebundenen Interaktion samt Readback.

### Windows-Worker

- Jeder UIA-Aufruf läuft weiterhin in einem frischen Prozess. Das isoliert den
  bekannten Qt/UIA-Fehlerzustand, in dem spätere Reads still leer werden.
- Was dieser Schnitt kostet, ist gemessen und nicht geschätzt. Ein weiterhin
  nötiger Workeraufruf braucht rund 1,1 s Wanduhrzeit, davon etwa 130 ms für den
  PowerShell-Start, **rund 560 ms allein für das Übersetzen des über 700 KB
  großen Workerskripts**, 40 ms für die UIA-Assemblies, 36 ms für den
  vorkompilierten Interop und den Rest für die Operation selbst. Die
  naheliegende Vermutung, die UIA-Schicht sei der Engpass, ist damit widerlegt.
- Reine Datei-/Metadatenoperationen werden nach feldgenauer Parität in den
  API-Prozess gezogen. Für verbleibende UI-Operationen lässt sich dieser Boden
  nur durch eine fachliche Skriptaufteilung senken, sodass ein Aufruf weniger
  Code übersetzt – nicht durch einen langlebigen UIA-Prozess. Letzteres
  verbietet der oben genannte Qt/UIA-Fehlerzustand.
- Sichtbare physische Eingabe ist in einer verschachtelbaren Vordergrund-Lease
  gekapselt. Innerhalb einer atomaren Action wird dasselbe SSE-Fenster nur
  einmal angehoben. Erfolg, Fachfehler und globaler Trap laufen vor der
  Ergebnisserialisierung durch denselben Cleanup: alle vom Worker gesetzten
  TOPMOST-Zustände werden entfernt; bei unveränderter Windows-Input-Epoche
  werden vorheriges Vordergrundfenster und eigener Mauszeiger best effort
  wiederhergestellt. `focusTelemetry` macht Raise-Zahl, Haltezeit und Restore
  in API und MCP messbar.
- Prozesse werden fensterlos gestartet, an eine Queue gebunden und bei
  Timeout oder API-Shutdown als eigener Prozessbaum beendet. Ein Exitcode des
  direkten Parents genügt nicht als Cleanup-Beweis: Erst Nodes `close` nach
  geschlossenen stdout/stderr-Handles gilt als regulärer Abschluss. Bleibt
  dieses Lifecycle-Signal auch nach beiden Cleanup-Wächtern aus, wird der
  aktuelle Platz nur im global verriegelten Zustand freigegeben;
  `worker-isolation-lost` sperrt alle weiteren Workerstarts bis zum API-Neustart.
- Operationsargumente liegen in einer exklusiven, auf 8 MiB begrenzten
  UTF-8-Tempdatei. Dadurch gelten weder Windows' Kommandozeilenlimit noch
  Base64-Steuerwerte in der Prozessliste; die Node-Brücke entfernt die Datei
  nach Erfolg, Fehler, Timeout oder Abbruch.
- Die Queue ist auf 32 tatsächlich laufende/wartende Aufträge begrenzt.
  Vorab abgebrochene Aufträge werden nicht aufgenommen; ein abgebrochener
  wartender Auftrag gibt seinen Platz sofort frei und startet später keinen
  Worker. Nur echte Überlast liefert `busy`.
- Auch der direkte Worker besitzt keinen Versand-Freischalter. stdout/stderr
  sind begrenzt und werden als striktes UTF-8 dekodiert.
- Die vorkompilierte native Brücke wird vor dem Laden gegen getrennte SHA256-
  Werte für C#-Quelle und DLL-Bytes geprüft. Die Hashes werden begrenzt
  gestreamt; Quelle, DLL und Manifest besitzen eigene Größenlimits. Jede
  Abweichung wechselt vor `Add-Type` auf den getesteten Quelltext-Fallback.
- Der Build verwendet die vorhandene DLL nur bei strikt gültigem Manifest,
  passendem aktuellen Quellhash, passendem tatsächlichen DLL-Hash und
  vollständiger Typ-/Methodenoberfläche wieder.
  Das verhindert unnötigen Binärdrift bei wiederholten Paket-Builds. Der
  Windows-PowerShell-5.1-Compiler selbst verspricht für zwei frische Builds
  keine byteidentische Ausgabe; Integrität und Archive binden daher die
  tatsächlich erzeugten Bytes statt compilerübergreifende Reproduzierbarkeit
  zu behaupten.
- UI-Mutationen bleiben an PID, HWND, Seite, Element, Vorwert und
  Nachbedingungen gebunden.
- Weicht der installierte Minor-/Patch-Build vom `verifiedBuild` des Profils
  ab, stoppen API und direkter Worker die in
  `capabilities.operationPolicy[*].blockedOnBuildDrift` ausgewiesenen
  UI-/Steuerfallmutationen mit `build-drift`. Lese-, Diagnose- und sichere
  Cleanup-Operationen bleiben zur Ursachenklärung verfügbar. Fehlende oder
  grundsätzlich fremde Binaries behalten ihre präzisere
  Launch-/Versionsfehlerart.
- Die Interaktionsart ist explizit: reine UIA-Leser laufen im Hintergrund;
  Focusless-Schreiben ist nur für profilierte Feldpfade mit Feld-, Summen- und
  Dirty-State-Readback erlaubt; nicht strukturiert bedienbare Qt-Controls
  benötigen eine sichtbare Vordergrund-Lease und Nutzerzustimmung. Ein privater
  Desktop ist Fokus-/UX-Isolation, keine Security-Sandbox.
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
- UI-Navigation erfolgt auch für reine Prüfungen ausschließlich auf einer
  hashverifizierten Prüffallkopie. SSE kann bereits beim Wechsel zwischen
  Seiten `ungespeichert=true` setzen, obwohl kein Steuerwert eingegeben wurde.
  Das Original bleibt deshalb auf dateibasierte Hash-/Inventarleser begrenzt;
  ein reiner Navigationszustand wird nach ausdrücklicher Bestätigung verworfen,
  nie gespeichert.
- UStVA-Frequenz, Monat/Quartal, Kennzeichen und Betragsfelder sind
  semantisch katalogisiert. Gleich benannte UI-Aktionen dürfen nicht generisch
  erraten werden; ein bereits übermittelter Zeitraum wird nie still dupliziert.
  Der vorgeschaltete Seiten-Read und jede Folgeaktion verbrauchen dieselbe
  absolute Deadline; unter zwei Sekunden Rest beginnt keine Folgeaktion.
- Ein fehlgeschlagener, abgebrochener oder unvollständiger Read gilt niemals
  als leerer Steuerstand.
- Wenn SSE nicht läuft, ist der aktuelle Build nicht messbar. Health bleibt
  mit leerem `buildDrift.current` und `drifted=true` fail-closed; das bedeutet
  „unbekannt“, nicht den Nachweis einer abweichend installierten Version. Nach
  dem Launch liefert `product_info` den eigentlichen Buildvergleich.

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

Es gibt zwei gleich versionierte Distributionswege. Eine vorhandene passende
Installation wird wiederverwendet. Mit bereits vorhandenem Node.js 22+ und npm
kann der Setup-Skill die veröffentlichten `@beta`-Pakete persistent
installieren; andernfalls bleibt das portable GitHub Release der vollständige
Weg ohne globale Entwicklerwerkzeuge.

- Portable wird entpackt statt installiert und braucht keine
  Administratorrechte, Dienste, geplanten Aufgaben oder PATH-Änderungen;
- die äußere SHA-256-Prüfung erfolgt vor dem Entpacken in einen neuen leeren
  Ordner. Windows-`tar.exe` ist der Standardpfad; ein Timeout oder partielles
  `Expand-Archive` ist keine lauffähige Installation;
- Start nur für die aktuelle Arbeit und kontrollierter Shutdown danach;
- das Root-Manifest bleibt ein privater Build-Workspace. Das Windows-x64-
  Paket `@yadimon/steuer-spar-erklaerung-api` enthält API, CLI, Setup,
  PowerShell-/Native-Runtime und Profile; das plattformneutrale Paket
  `@yadimon/steuer-spar-erklaerung-mcp` enthält nur den PC-blinden
  Clientgraphen;
- der native PDF-Helfer läuft als eigener Windows-PowerShell-Prozess. Er
  flusht das kompakte JSON vor dem direkten Prozessabschluss, damit ein auf
  einzelnen Windows-Builds beobachteter WinRT-Restcode einen erfolgreichen
  Render nicht als Fehler maskiert;
- beide npm-Pakete werden aus derselben TypeScript-Quelle mit getrennten
  Einstieggraphen gebaut. Ein generischer OpenAPI-Proxy oder ein dupliziertes
  drittes Contract-Paket ist nicht Teil der Architektur;
- vor TypeScript-Builds werden nur quelllose Compilerartefakte unter dem
  gebundenen `dist`-Ordner entfernt; unbekannte Dateien oder Links stoppen den
  Build. npm- und Portable-Paketierung validieren danach erneut jedes
  JavaScript-/Source-Map-Artefakt gegen seine TypeScript-Quelle und verlangen
  alle dokumentierten CLI-Einstiege;
- das fertige Portable-ZIP wird vor seiner äußeren SHA256-Datei erneut unter
  Windows PowerShell 5.1 geöffnet. Es darf nur eine gebundene Wurzel, sichere
  kollisionsfreie Windows-Pfade und exakt die Manifestdateien enthalten;
  Produkt/Version, Bytezahl und Datei-SHA256 werden aus den komprimierten
  Streams geprüft. Ein ungültiges neu erzeugtes ZIP wird entfernt und der
  Build stoppt;
- Python wird aus dem Produkt entfernt;
- eine benötigte Node-Laufzeit wird gebündelt oder das gebaute Programm als
  ausführbares Artefakt ausgeliefert;
- Windows PowerShell 5.1 wird nach vollständiger Kompatibilitätsprüfung als
  Windows-Systembestandteil genutzt. Die portable Testmatrix prüft Parser,
  Worker, native DLL und Source-Fallback unter genau dieser Laufzeit. Ein
  privates oder globales PowerShell 7 gehört nicht zum Produkt.

Der npm-Weg ist nicht der einzige Installationsweg und baut keinen Quellcode
auf dem Nutzer-PC. Ein Setup aus dem flüchtigen `_npx`-Cache wird verweigert,
weil API-Starter und MCP-Konfiguration dauerhafte absolute Pfade benötigen.

### Betriebsarten

1. **Standard:** API bei Bedarf fensterlos starten, Aufgabe ausführen, sauber
   beenden.
2. **MCP-Komfort:** Agentkonfiguration verweist direkt auf den portablen oder
   separat installierten MCP-Einstieg; dieser spricht mit derselben API und
   kennt nur URL und Token.
3. **Dauerbetrieb (opt-in):** Autostart oder geplante Aufgabe nur nach
   ausdrücklicher Zustimmung des Nutzers.

## Steuerjahrprofile

API, MCP, Queue, Ressourcen und Sicherheitsverträge bleiben gemeinsam. Nur
produktabhängige Daten liegen in einem Jahresprofil:

```text
profiles/
  2024/
    profile.json
    page-objects.json
    fixtures/
    tests/
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

Profil `2025` ist produktiv unterstützt. Profil `2024` ist experimentell: Der
aktuelle Opt-in-Sweep belegt Lesen, Navigation, Ergebnisse, Prüfer und UStVA-
Read auf Build `30.0.127.0`, aber keine allgemeine Schreibfreigabe und keinen
Focusless-Commit. Der Setup-Wizard bietet ausschließlich `supported`-Profile
an. Seine Dialogantwort ist zusätzlich auf eine exakt gebundene passive
Gewinnaktualisierungsnotiz mit `OK` beschränkt; Recovery-Dateien werden nicht
automatisch verworfen. Das Manifest trennt `status` von `operationAccess`:
2025 trägt `full`, 2024 `verification-only`. Setup und voller Betriebsraum
öffnen sich nur bei `supported` **und** `full`; eine reine Status-Promotion
bleibt daher fail-closed. `capabilities.operationPolicy` klassifiziert alle 87
Operationen als Lesen, Navigation, bedingtes Focusless-Schreiben, Mutation,
destruktiv oder Cleanup und nennt Opt-in- sowie Build-Drift-Gates. Ein zweiter
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

Nach dem fachlichen Zwei-Fragen-First-run kann der Agent die bereits
bestätigten Werte über `--plan-file` statt über simulierte Terminaleingabe
übergeben. Schema 1 akzeptiert ausschließlich Profil, absoluten Fallordner,
höchstens 32 absolute Quellordner und optional die eindeutig erkannte SSE-
Executable. Der höchstens 64 KiB große UTF-8-Plan kann weder Token noch
Schreibmodus, Connector, MCP-Merge, Autostart oder ELSTER-Autorität setzen.
Relative, unbekannte oder fehlende Pfade sowie Widersprüche zu einer
vorhandenen Konfiguration stoppen fail-closed. Planläufe erzwingen direkte API,
read-only, Reference-only, Markdown-Tracking und eine erste read-only Prüfung.

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
ersetzt aber nicht den explizit freigegebenen realen Fixture-Test. Der
gegenwärtige automatisierte Paritätstest ist noch mockbasiert; der reale
zweifache Fixture-Lauf ist ein offenes Release-Gate.

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

Der Suite-Plan enthält drei Phasen: quellgebundenes `dist`-Pruning und Builds
laufen seriell, voneinander
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

`npm run test:fast` und `npm test` starten absichtlich keine reale SSE-UI.
`npm run test:live-core-read` belegt für beide Profile die auf der offenen
Herstellermusterseite möglichen, fallunverändernden Leseverträge; sein Ergebnis
weist die nicht enthaltene Bereichsnavigation, Prüfer, UStVA und den
Tiefensweep ausdrücklich aus. `npm run test:live` ist weiterhin das strikte,
weitergehende opt-in Gate für 2025 und 2024: fehlende Voraussetzungen oder
verbliebene SSE-Prozesse sind Fehler, kein grüner SKIP.

Beide vollständigen Läufe enden mit der Abdeckungsbilanz aus echter
Ausführung (`test/operation-coverage.json`). Sie unterscheidet, was gegen den
synthetischen Worker und was gegen die installierte Anwendung belegt ist, und
verhindert als Ratsche, dass Abdeckung unbemerkt verschwindet oder unbemerkt
entsteht.
Daneben führt `test/operation-result-shape.json` eine wertfreie Bilanz der
tatsächlich gesehenen Top-Level-Feldnamen, JSON-Typklassen, Herkunftsmarken und
Ergebnisarten. Für ein Objektfeld erfasst sie außerdem die sicheren direkten
Schlüsselnamen und deren Typklassen, damit beispielsweise ein Screenshotobjekt
mit `path`, `w` und `h` wirklich gegen seinen Mindestvertrag geprüft wird. Das
Laufzeitprotokoll speichert keine Werte und keine tiefer verschachtelten
Inhalte. Neue Feld- oder Typvarianten stoppen den Test bis zur bewussten
Übernahme; die Schemas müssen jede belegte Variante akzeptieren.
Der statische Worker-Feldguard bleibt ergänzend bestehen, weil optionale
Fehler- und Recovery-Felder nicht in jedem deterministischen Lauf erscheinen.
Profilierte Live-Läufe verwenden ausschließlich Wegwerfkopien und werden mit
Voraussetzungen und belegtem Umfang in
[VERIFIKATION.md](VERIFIKATION.md) geführt.

## Definition of Done (Ziel, noch nicht vollständig erreicht)

Eine Funktion gilt nur als lauffähig, wenn:

- sie im gemeinsamen API-Katalog mit Eingabe- und konkretem Ergebnisschema
  steht;
- direkte API- und MCP-Aufrufe denselben fachlichen Vertrag erfüllen;
- Abbruch, Timeout und Prozesscleanup getestet sind;
- kein sichtbares Konsolenfenster entsteht;
- Sicherheits- und Ressourcenbegrenzungen fail-closed getestet sind;
- bei UI- oder Steuerdatenbezug ein readback-orientierter Realtest oder eine
  ausdrücklich benannte Fixture-Voraussetzung existiert.

Der Gesamtstand ist erst produktiv, wenn die schnelle portable Testsuite, alle
verfügbaren Real-Fixture-Tests, die Skill-Validierung, Datenschutzprüfung und
der abschließende Anforderungsabgleich grün sind. Externe Reviews sind
zusätzliche Evidenz und ersetzen diese Prüfungen nicht.
