# Produktarchitektur

Dieses Dokument ist der überprüfbare Zielvertrag für API, MCP,
Steuerjahrprofile und öffentliche Skills. Es beschreibt das Produkt, nicht die
Entstehungsgeschichte einzelner UIA-Lösungen.

> **Statushinweis:** Dieses Dokument enthält auch Zielverträge, die noch nicht
> vollständig erreicht sind. Der aktuell belegte Produktstand und offene Gates
> stehen in [VERIFIKATION.md](VERIFIKATION.md); Transportdetails stehen in
> [API-MCP-VERTRAG.md](API-MCP-VERTRAG.md).

## Inhalt

- [Produktziel](#produktziel)
- [Verbindliche Grenzen](#verbindliche-grenzen)
- [Nebenfenster](#nebenfenster-allgemein-lesbar-nur-rollenbezogen-bedienbar)
- [Inhaltsbereich einer Seite](#der-inhaltsbereich-einer-seite-gemessen-oder-geraten)
- [Ressourcen statt PC-Pfade](#ressourcen-statt-pc-pfade)
- [Laufzeit und Installation](#laufzeit-und-installation)
- [Steuerjahrprofile](#steuerjahrprofile)
- [Erster Start](#erster-start-statt-einrichtungsprogramm)
- [Öffentliche Skills](#öffentliche-skills)
- [Szenario- und Paritätsvertrag](#szenario--und-paritätsvertrag)
- [Testsuite](#testsuite)
- [Definition of Done](#definition-of-done-ziel-noch-nicht-vollständig-erreicht)

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
                       Herkunftsschutz, Queue, Dateien/Hash,
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
- Sie bindet ausschließlich an Loopback und weist Aufrufe aus einem Browser
  anhand von `Origin`, `Sec-Fetch-Site` und `Host` mit `403` ab. Eine
  Anmeldung gibt es nicht; siehe [SECURITY.md](../SECURITY.md).
- Sie besitzt Operationen, Schemas, Queue, Abbruch, Dateiverwaltung,
  Szenarioausführung und Auflösung maschinenneutraler Ressourcen.
- Ihr lokaler Katalog `GET /v1/operations` veröffentlicht alle
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
  referenziert. Auch der für alle 99 Operationen identische
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
  in ein atomar neues `cases:`- oder `backups:`-Ziel. Der Bereich entscheidet
  zwischen ausdrücklich verlangter Arbeitskopie und privater Sicherung. Quelle
  und Ziel bleiben bis zum
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

- MCP ist fachlich ausschließlich Adapter zur API. Sein eng begrenzter
  Supervisor darf jedoch die eigene, exakt gepinnte API-Dependency auflösen,
  identifizieren und bei freiem Loopback-Port starten.
- Ein MCP-Abbruch wird über den HTTP-Client zur API propagiert, damit deren
  Abort-/Prozessbaum-Cleanup greift; der nächste mutierende Versuch verlangt
  erneut einen gezielten Zustands-Readback.
- MCP startet keine UI-Worker, durchsucht keinen PC und liest keine Steuerfall-
  oder Arbeitsinhalte. Nur `mcp-api-supervisor.ts` darf das eigene API-Manifest
  sowie eine ausdrücklich benannte, begrenzte `SSE_API_CONFIG` lesen. Deren
  Ressourcenpfade werden ausschließlich für den pfadfreien
  Konfigurationsfingerprint verarbeitet und nie als MCP-Ergebnis ausgegeben.
- Der Grenzvertrag verfolgt alle transitiven Importe der 17 `mcp-*.ts`-Module.
  Er erlaubt aus der PC-Umgebung ausschließlich `SSE_API_URL` und
  `SSE_API_CONFIG`; Worker-, Workspace- und Produktpfadmodule sind von
  dieser Abhängigkeitsfläche ausgeschlossen.
- Öffentliche MCP-Schemas akzeptieren Ressourcenreferenzen wie
  `cases:arbeitsfall.Gew2025` oder `documents:rechnung.pdf`, keine absoluten
  PC-Pfade.
- Die letzte MCP-Ausgabegrenze redigiert zusätzlich nicht konfigurierte
  Windows-/UNC-/Datei-URLs und typische POSIX-Systempfade. Normale HTTPS-URLs
  bleiben unverändert, damit ein separat installierter Wrapper weder Details
  des API-Rechners noch seines eigenen Hosts preisgibt.
- Werkzeugnamen, API-Zuordnung, Eingaben und versionierte
  Ergebnismindestverträge werden aus gemeinsamen Katalogen abgeleitet. Alle 99
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
- Vor dem stdio-Handshake, bei `--selftest` und vor jedem späteren API-Aufruf
  prüft MCP `/healthz` auf exakten Paketnamen, Releaseversion, API-Version,
  Prozess-/Instanz-ID und eine syntaktisch gültige Konfigurationsidentität.
  Jeder POST trägt die unmittelbar geprüfte Instanz-ID, die der Server noch
  vor dem Executor vergleicht. Bei einer
  von MCP verwalteten Konfiguration muss deren pfadfreier Fingerprint außerdem
  exakt zur erwarteten Ressourcenbindung passen. Ist die
  Standardadresse frei, startet er die Dependency direkt mit `node`,
  `detached`, `windowsHide` und vollständig ignoriertem stdio. Der Port ist die
  Rennentscheidung: Ein paralleler Verlierer wartet auf den Sieger und übernimmt
  ihn. MCP beendet niemals einen Prozess, weder anhand eines Namens noch nach
  einem verlorenen Rennen.
- Ein erreichbarer fremder Dienst, eine nicht eindeutige Health-Antwort oder
  eine andere Paketversion stoppt redigiert und fail-closed. Eine ausdrücklich
  gesetzte `SSE_API_URL` ist autoritativ und deaktiviert Autostart und Fallback.
- Spezialwerkzeuge werden bevorzugt. Fehlen sie für ein Control, führt die
  veröffentlichte Fallback-Leiter von einem frischen Zustand über rein lesende
  Entdeckung zu genau einer gebundenen Interaktion samt Readback.

### Windows-Worker

- Jeder UIA-Aufruf läuft weiterhin in einem frischen Prozess. Das isoliert den
  bekannten Qt/UIA-Fehlerzustand, in dem spätere Reads still leer werden.
- Der dauerhafte API-Server hält standardmäßig zwei vollständig initialisierte,
  aber noch UIA-unbenutzte Reserveprozesse. Jeder davon übernimmt weiterhin
  genau einen Auftrag und endet danach; die Prozessisolation wird also nicht
  aufgeweicht. `SSE_WORKER_PREWARM_POOL_SIZE` begrenzt den Vorrat auf 1 bis 4.
  Zwei sind der gemessene allgemeine Kompromiss; drei vermeiden auf einem
  schnellen Host zusätzliche Kaltstarts bei Aufrufen ohne Denkpause, benötigen
  dafür aber einen weiteren wartenden PowerShell-Prozess.
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
- API-Single-Flight bleibt pro Node-Prozess. Zusaetzlich erwirbt jeder
  lock-pflichtige aeussere Worker einen festen `Local\`-Mutex der Windows-
  Sitzung ueber den vorab integritaetsgeprueften nativen Helfer mit
  `WaitForSingleObject(..., 0)`, bevor Desktopmarker, Build/PID/HWND und Dispatcher
  beruehrt werden. Damit koennen ein zweiter API-Prozess und ein direkter Worker
  nicht gleichzeitig SSE/UIA steuern. Lokale API-Arbeit liegt ausserhalb; auch
  zwischen mehreren aeusseren Worker-Schritten einer zusammengesetzten
  API-Operation besteht keine sitzungsweite Transaktion. Jeder Schritt bindet
  deshalb den Produktzustand frisch. Interne Planoperationen im selben Worker
  erben den Lease; wartende Reserveworker halten ihn nicht. Nur `page_objects`
  und `product_info` umgehen ihn. Belegung liefert sofort strukturiertes `busy`
  statt einer zweiten Queue. Beobachtete Mutex-Aufgabe stoppt als
  `worker-isolation-lost`; sie ist kein dauerhaftes Crashgedaechtnis, weil ein
  Kernelobjekt nach dem letzten geschlossenen Handle verschwinden kann.
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
- Fuer den BelegManager gilt eine engere aktuelle Laufzeitgrenze: Nur
  `receipt_manager_list` ist als `focusless-read` freigegeben. Alle neun Wege,
  die Detailauswahl, Navigation oder Mutation ueber sichtbaren Vordergrund
  beziehungsweise globale physische Eingabe benoetigen, stoppen nach der
  oeffentlichen Argumentpruefung, aber vor Ressourcenaufloesung, Workerstart,
  Buildpruefung und UIA. Derselbe Katalog und Block liegen zusaetzlich direkt
  im Worker; ein direkter Aufruf oder eine Komposition kann die API-Grenze
  daher nicht umgehen.
- Feld-, Tabellen- und UStVA-Beträge werden mit gemeinsam getesteter deutscher
  Gruppierung und exakter Dezimalgleichheit zurückgelesen. Präfixe sowie
  mehrdeutige Punktfolgen gelten nicht als Übereinstimmung.
- Roh-Tastatur, generische Lösch- oder Versandwege sind keine öffentliche
  Operation.
- Unbekannte Dialogbuttons werden inventarisiert und als nicht unterstützt
  gemeldet. Nur die gemeinsame feste Allowlist ist ausführbar; ein Agent kann
  die Sperre nicht durch frei formulierten Buttontext umgehen.

### Semantische Seitennavigation

`goto` akzeptiert bevorzugt dieselbe stabile `pageId` wie
`known_page_state`; die exakte Überschrift bleibt als kompatibler API-Pfad
erhalten. Für eine katalogisierte Seite leitet der Worker den Suchbegriff aus
dem Page Object ab und erkennt das Ziel über dessen Überschriftenvertrag plus
alle profilierten Pflichtfelder. Damit bleibt beispielsweise
`1. Fahrzeug: Chevrolet Camaro` an `gew.fahrzeug` gebunden, obwohl der
fallabhängige Zusatz nicht vorher bekannt ist. Eine bloß ähnlich benannte
Seite oder eine andere Fahrzeug-Unterseite mit derselben Überschrift reicht
nicht aus.

Der semantische Pfad liest Überschrift und Pflichtfelder direkt über ihre
vollständigen AutomationIds. Er vermeidet den generischen 400-Knoten-Baum bei
der Start-, Warte- und Zielprüfung, behält aber Suche, linearen Fallback,
Dialogstopp und Schrittlimit unverändert. Im lokalen Wegwerffall sank der
vollständige Sprung von `Beiträge, Gebühren und Abgaben` zum Fahrzeug von
19,916 s mit einem falschen `not-found` auf 12,724 s mit verifiziertem Erfolg;
auf der bereits geöffneten Zielseite benötigte der Nullschritt 1,956 s.

### Typisierte Ein-Worker-Pläne

`fill_fields` validiert den vollständigen Plan bereits im API-Prozess gegen
das aktive Page-Object-Profil. Zugelassen sind ein bis 20 eindeutige
`pageId`/`fieldId`-Felder derselben bereits geöffneten Seite. Das API kompiliert
sie ausschließlich in bestehende `tracked_set_value`-Operationen und genau
einen abschließenden `known_page_state`-Readback. Erst danach startet ein
frischer Worker. Der interne Name `bulk_action` ist weder ein frei befüllbares
PowerShell- noch ein Selektor-API; der Worker akzeptiert nur diese Planform,
einen geschlossenen Operationskatalog und exakte Argumentfelder.

Innerhalb des Workers fängt der Planexecutor die kanonischen strukturierten
Ergebnisse bestehender Operationen ab, statt nach jedem `Emit` den Prozess zu
beenden. Jeder Feldschritt behält Vorwert-, Page-Object-, Build-, Case- und
Nachwert-Guards. Nach dem ersten Fehler folgen keine weiteren Mutationen:
restliche Schritte werden `skipped`, reversible Feldänderungen laufen in
umgekehrter Reihenfolge best effort zurück, und ein vollständiger Readback
bestimmt `unchanged`, `completed-verified`, `rolled-back-verified`,
`partially-mutated-verified` oder `unknown`. Timeout und Cancellation werden
immer als `unknown` ohne automatischen Retry zurückgegeben.

`receipt_manager_bulk_upsert` nutzt denselben Ein-Prozess-Grundsatz für
vollständige Liste, fachliche Identitätsprüfung, Import oder Update, optionale
Klassifikation und Abschlussreadback. Die API löst alle `documents:`-Ressourcen
und SHA-256-Bindungen vor dem Workerstart auf. Weil Qt die Tabelle erst nach
Freigabe einer sichtbaren Foreground-Lease endgültig stabilisieren kann, folgt
auf einen ansonsten exakten Detailread bei Bedarf ein weiterer reiner
Listenread im selben Prozess. Nur ein vollständiges, hashgleiches semantisches
Zeilen-Multiset hebt diesen Zwischenzustand auf; der öffentliche Einzelread
bleibt unverändert fail-closed.

Auf dem Entwicklungsrechner lag ein kalter API→PowerShell-Aufruf in fünf
Messungen bei p50 2,112 s, davon p50 0,717 s im Worker und rund 1,395 s
Prozess-/Transport-Overhead. Damit spart ein Fünf-Feld-Plan gegenüber fünf
Einzelworkern allein etwa 5,6 s Startoverhead. Ein Beleg ohne Klassifikation
benötigte zuvor drei Worker, fünf Belege 15; der neue Plan startet jeweils
genau einen. Der reale Zwei-Feld-Plan benötigte auf dem Entwicklungsrechner
8,753 s Planzeit bei 8,735 s Worker-Aktionszeit. Der reale Beleg-Import in der
Snapshot-VM benötigte trotz nur eines Workers 98,561 s; dort dominierte die
sichtbare Qt-Interaktion und Stabilisierung.

Eine kontrollierte Vorher-/Nachher-Messung auf demselben lokalen Wegwerffall
mit 21 vorhandenen Belegen verkürzte Import, sieben Feldwerte und unabhängigen
Abschlussreadback von 37,531 auf 25,568 s (−31,9 %). Dafür liest
`receipt_manager_update` zwischen den drei vollständigen Bindungs-/Abschluss-
Snapshots jedes bereits gebundene Feld direkt über dessen exakte AutomationId
und pollt den tatsächlichen Wert, statt vor und nach jedem Feld erneut bis zu
800 UIA-Knoten zu projizieren. Der Update-Anteil benötigte noch 6,609 s.
`performance.internalTimings` erklärt jede interne Operation einzeln; im
erfolgreichen Nachlauf entfielen 10,203 s auf den nativen Importdialog,
4,799 s auf den unabhängigen Detailreadback und zusammen 2,520 s auf die zwei
vollständigen Listenreads. Diese Sicherheitsnachweise zu Liste, Dialogen,
Fenstern und Dirty-State bleiben absichtlich erhalten. Ein separater
langlebiger Worker oder C#-Bulk-Prozess ist nach diesen Messungen nicht
gerechtfertigt.

### Harte Sicherheit

- ELSTER, Senden und sonstige Übermittlung ans Finanzamt bleiben immer
  gesperrt.
- Originale und übermittelte Fälle werden nie gelöscht, umbenannt oder auf
  Dateiebene überschrieben; übermittelte Fälle werden nie verändert.
- Ein eindeutig geöffneter Fall ist der normale Arbeitsfall. Vor der ersten
  Mutation oder UI-Navigation mit möglichem Dirty-State wird sein aktueller
  Disk-Hash einmal als bytegleiche Sicherung im privaten Backupbereich
  geschützt; dieselbe Sicherung wird für denselben Fall und unveränderten Hash
  innerhalb der laufenden Aufgabe wiederverwendet.
- Mutation, Persistenz und Dateiauswahl sind getrennte Freigaben. Ohne
  ausdrücklichen Speicherauftrag bleibt der geänderte Fall offen und
  ungespeichert; Arbeits-/Korrekturkopie, `save_as`, Schließen, Verwerfen oder
  Wechseln sind keine automatischen Sicherheitswege.
- Eine hashverifizierte Prüffallkopie bleibt für einen ausdrücklich isolierten
  Audit verfügbar. Sie ist nicht der Standard für den bereits geöffneten Fall.
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

## Nebenfenster: allgemein lesbar, nur rollenbezogen bedienbar

SteuerSparErklärung hostet in **einem** Prozess mehrere Fenster: das
Hauptfenster mit dem Fall, die Werte-Info, Dialoge, den BelegManager, den
Einwilligungsdialog beim ersten Start — und ELSTER-, Versand-, Speicher- und
Dateidialoge.

Deshalb gilt: Nebenfenster desselben verifizierten Prozesses dürfen **gelesen**
werden (`windows`, `dialog_list`, `snapshot`). Die allgemeinen Interaktions-
operationen binden weiterhin ausschließlich an ein echtes Hauptfenster.
„Gleiche PID" ist keine Berechtigung, und Breite allein ist keine
Rollenprüfung: Der BelegManager ist 963 px breit, die
Wiederherstellungsfrage trägt den Produktnamen im Titel. Die allgemeine Bindung
verlangt daher Rolle **und** Geometrie (`Get-SSEMainWindowCandidates` plus
Breitenschwelle), im Lese- wie im Schreibpfad. Nur eine eigene, profilierte
Rollenoperation darf davon abweichen.

### Öffnen und Schließen sind davon nicht betroffen

Nicht bedienbar heißt nicht lebenszykluslos. Ein Nebenfenster, das die API
öffnen kann, muss sie auch wieder schließen können — sonst gelingt eine
Operation und lässt den Aufrufer in einer Sackgasse zurück. Genau das passierte
mit dem BelegManager: `menu_click` öffnete ihn, aber Qt führt ihn als Dialog
ohne einen einzigen Schalter, sodass weder `dialog_answer` noch `window_close`
griffen und `close` dauerhaft mit `dialog-open` verweigerte.

Ein Nebenfenster, dessen Öffnen die API anbietet, gehört deshalb in den
Profilkatalog — mit exaktem Titel und `closePolicy`. Die Rolle
`nonmodal-tool-window` steht für ein eigenes Programmfenster, das die
allgemeinen Werkzeuge nur öffnen, lesen und schließen dürfen. Seine Freigabe
hängt allein am exakten, gross-/kleinschreibungsgenauen Titel, nicht an einer
Größenschranke: Ein Werkzeugfenster wächst mit dem Bildschirm.

Der BelegManager wird **nicht** durch eine gelockerte allgemeine Bindung
bedienbar — ein „Klick auf ein beliebiges Fenster derselben PID" würde denselben
Weg für Versand- und Speicherdialoge öffnen. Stattdessen besitzt er zehn
spezialisierte Operationen: `receipt_manager_action` für zwei reversible
Navigationen, `receipt_manager_list`, `receipt_manager_read`,
`receipt_manager_update`, `receipt_manager_import`, `receipt_manager_delete`,
die beiden Klassifikationsoperationen, `receipt_manager_link` und
`receipt_manager_bulk_upsert`. Auf einer frischen
Installation lässt sich der Einwilligungsdialog weiterhin nicht beantworten.

**Aktuelle Verfuegbarkeit:** Von diesen zehn Operationen ist ausschließlich
`receipt_manager_list` aktiv. Die neun anderen Implementierungen bleiben als
historisch verifizierter, statisch gepruefter Vertrag im Worker erhalten, sind
aber unerreichbar: API und Worker liefern
`reason=foreground-required-operation-disabled`, `retryable=false`,
`mutationStarted=false` und `resultingState=unchanged`, bevor ein Fenster
gelesen oder veraendert wird. Die folgenden Abschnitte beschreiben diesen
dormanten Vertrag und seine damaligen Bindungs-/Readback-Invarianten; sie sind
keine aktuelle Freigabe.

Der vorgesehene Weg sind stattdessen eigene, eng gefasste Operationen je
katalogisierter Fensterrolle. Eine solche Operation braucht mindestens:
Prozessbindung an das profilierte Produkt, eine im Profil katalogisierte
Fensterrolle mit Titel, Klasse und Pflichtsteuerelementen, eine vom Aufrufer
benannte katalogisierte `actionId` statt eines freien Selektors, einen
Zustandsfingerprint samt Aktivierungs- und Auswahlzuständen, Dialogfreiheit im
Prozess, die vorhandene Klickprüfung unmittelbar vor der Eingabe und eine
semantische Nachbedingung. Ohne all das entsteht kein neuer Pfad.

`receipt_manager_action` setzt diesen Vertrag für die zwei reversiblen
Zustandswechsel `showAllReceipts` (`start` → `list`) und `goHome`
(`list` → `start`) um. `receipt_manager_list` projiziert die vollständige
sichtbare Liste und erzeugt Zeilen- und Listenfingerprints. Optional liefert
dieselbe Operation ohne zusätzlichen UI-Durchlauf eine begrenzte, kompakte
Treffermenge nach exaktem Titel, Titelbestandteil und Entwurfsstatus; die
Mutation bleibt trotzdem an die vollständige Liste gebunden. `read` und `delete`
akzeptieren nur solche frischen Zeilenbindungen; `delete` verlangt zusätzlich
eine ausdrückliche Bestätigung und den exakt profilierten Löschdialog.
`receipt_manager_update` verlangt zusätzlich den frischen Detailfingerprint
und `acknowledgeUpdate=true`. Ein Aufruf kann Titel, Datum, Belegnummer,
Betrag, Umsatzsteuersatz, Netto-Kennzeichen und Notiz gemeinsam setzen. Er
verwendet ausschließlich profilierte AutomationIds, prüft jeden Feldwert nach
dem Commit am exakt gebundenen Live-Element und rollt bereits geänderte Felder
bei einer eindeutigen normalen Nachbedingungsverletzung rückwärts zurück. Drei
vollständige UIA-Projektionen bleiben als Ausgangs-, ausgewählte Detail- und
Abschlussbindung erhalten; die wiederholten Vollbaum-Reads je Feld sind durch
einen Quellvertrag gesperrt.
`receipt_manager_import` lehnt nicht profilierte Dateiendungen und Dateien ohne
PDF-Header bereits vor jeder UI-Bindung ab. Erst danach legt die Operation bei
vollständiger Liste ohne vorhandenen Entwurf einen neuen Beleg an, bindet die
Quelle an `documents:` plus SHA-256,
verifiziert den nativen Öffnen-Dialog und verlangt eine geänderte visuelle
Vorschau bei unverändertem Quellhash. Der Profilkatalog nennt die exakten
AutomationId-Suffixe, Dialogtexte und Fingerprints. Haupt- und Werkzeugfenster,
Dialogfreiheit, physischer Klick, Top-Level-Fenstersatz und Dirty-State werden
vor und nach jeder Mutation geprüft. Alle übrigen BelegManager-Schalter bleiben
unerreichbar.

`receipt_manager_bulk_upsert` verwendet deshalb nicht nur den Dateipfad als
Identität. Exakter Titel plus Belegnummer oder exakter Titel plus Datum und
Betrag entscheiden, ob aktualisiert, übersprungen oder neu importiert wird.
Mehrere exakte Treffer stoppen ohne `force`. Import, Update und Klassifikation
liefern jeweils eine frische Bindung; überflüssige Zwischenlesungen entfallen.
`receipt_manager_link` kann ein bis 20 exakte Titel auf der aktuellen
Steuerseite auflösen, schaltet alle Zielzustände in einem geöffneten Manager,
übernimmt einmal und öffnet einmal für den Persistenz-Readback. Erst nach dem
Auflösen aller Selektoren beginnt die Mutation. Die davon getrennte
Werteübernahme in Steuerzeilen wird weiterhin abgebrochen, weil dafür noch kein
seiten- und tabellenspezifischer Buchungsvertrag nachgewiesen ist.

## Der Inhaltsbereich einer Seite: gemessen oder geraten

Jede Seitenlesung grenzt links die Navigationsspalte und rechts die Hilfespalte
ab. Links wird die Grenze **gemessen**, wenn ein Navigationsbaum gefunden wird,
und sonst auf einen Anteil der Fensterbreite **geraten**. Der Unterschied ist
kein Detail: Eine eingeklappte Navigationsspalte erscheint als Baum der Breite
0, wird nicht erkannt, und die geratene Grenze schnitt dann die
Beschriftungsspalte ab — mit der Folge, dass Seiten ohne Beschriftungen
zurückkamen, `get_value` still leere Werte lieferte und jeder Schreibweg
`bad-target` meldete.

Daraus folgen zwei Invarianten, die `Get-CaptionMinX` festhält und
`test/content-bounds-contract.ps1` prüft:

- Wo die Grenze **gemessen** ist, bleibt sie bindend. Navigationseinträge sind
  keine Beschriftungen und dürfen nie in die Beschriftungssuche geraten.
- Wo sie **geraten** ist, darf die Beschriftungssuche nach links ausweichen,
  denn dort steht dann keine Navigation.

Die Zuordnung Beschriftung → Feld bleibt dabei additiv: Sie nimmt den nächsten
Text links vom Feld. Ein weiter links stehender Text kann einen bereits
gefundenen näheren nie verdrängen, also behalten beschriftete Felder genau ihre
Beschriftung. Lesepfad und Schreibpfad benutzen dieselbe Grenze; liefen sie
auseinander, bedeutete derselbe Feldname beim Lesen und beim Schreiben
Verschiedenes.

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

Für Fallbezüge gilt eine wichtige Einschränkung: Der Bereich `cases` und damit
auch `--case-dir` ist die Auflösungs- und Schwärzungsgrenze für
`cases:`-Referenzen sowie der Vorgabeordner für `list_cases`, `backup_cases`
und `archive_cases`. Er ist **keine** Zugriffssperre der direkten lokalen API:
Fallbezogene Operationen akzeptieren weiterhin ausdrücklich benannte absolute
Windows-Pfade. Ohne konfigurierten `cases`-Bereich entfällt zusätzlich die
Pfadschwärzung, sodass ein direkter API-Client übergebene absolute Pfade
ungeschwärzt zurückerhält. Der MCP-Wrapper ist davon nicht betroffen; er kennt
grundsätzlich keine Pfadfelder. Die Zusage „nur der bestätigte Fall, Original
nie geöffnet“ ist deshalb eine Ablaufzusage der Skills, keine API-Sperre.

## Laufzeit und Installation

### Nutzerstandard

Es gibt genau einen MCP-Standardweg: Das MCP-Paket besitzt eine normale exakte
Dependency auf dieselbe Releaseversion des API-Pakets. npm installiert beides
in einem Schritt; es gibt weder `postinstall` noch Laufzeitinstallation. Eine
vorhandene passende API-Instanz wird wiederverwendet.
Node.js 22+ mit npm ist damit Voraussetzung; eine fehlende Laufzeit wird nicht
ungefragt nachinstalliert.

- installiert wird ohne Administratorrechte, Dienste, geplante Aufgaben oder
  PATH-Änderungen — bevorzugt in einen eigenen Ordner je Einrichtung;
- die automatisch gestartete API bleibt als lokaler Singleton über das Ende
  eines MCP-Clients hinaus wiederverwendbar; bewusster Shutdown erfolgt nur
  nach Paket-/Versions- und Kommandozeilenprüfung über die exakte Health-PID;
- das Root-Manifest bleibt ein privater Build-Workspace. Das Windows-x64-
  Paket `@yadimon/steuer-spar-erklaerung-api` enthält API, CLI,
  PowerShell-/Native-Runtime und Profile. Da das MCP-Paket genau davon abhängt,
  ist auch `@yadimon/steuer-spar-erklaerung-mcp` auf Windows x64 begrenzt; sein
  fachlicher Toolgraph bleibt PC-blind;
- der native PDF-Helfer läuft als eigener Windows-PowerShell-Prozess. Er
  flusht das kompakte JSON vor dem direkten Prozessabschluss, damit ein auf
  einzelnen Windows-Builds beobachteter WinRT-Restcode einen erfolgreichen
  Render nicht als Fehler maskiert;
- beide npm-Pakete werden aus derselben TypeScript-Quelle mit getrennten
  Einstieggraphen gebaut. Ein generischer OpenAPI-Proxy oder ein dupliziertes
  drittes Contract-Paket ist nicht Teil der Architektur;
- vor TypeScript-Builds werden nur quelllose Compilerartefakte unter dem
  gebundenen `dist`-Ordner entfernt; unbekannte Dateien oder Links stoppen den
  Build. Die npm-Paketierung validiert danach erneut jedes
  JavaScript-/Source-Map-Artefakt gegen seine TypeScript-Quelle und verlangt
  alle dokumentierten CLI-Einstiege;
- Python wird aus dem Produkt entfernt;
- Windows PowerShell 5.1 wird nach vollständiger Kompatibilitätsprüfung als
  Windows-Systembestandteil genutzt. Die Testmatrix prüft Parser,
  Worker, native DLL und Source-Fallback unter genau dieser Laufzeit. Ein
  privates oder globales PowerShell 7 gehört nicht zum Produkt.

Der npm-Weg baut keinen Quellcode auf dem Nutzer-PC. Eine dauerhafte Anmeldung
aus dem flüchtigen `_npx`-Cache wäre falsch, weil ein MCP-Eintrag dauerhafte
absolute Pfade braucht. Davon getrennt darf die API für einen einzelnen
Auftrag direkt über NPX im Vordergrund laufen: Sie legt nur Arbeitsordner an,
bindet den bestätigten Fallordner an den Prozess und schreibt keinen Launcher
in den Paketcache.

Der MCP-Eintrag beim Client startet die absolute `node.exe` mit dem absoluten
`dist/index.js` des MCP-Pakets als einzigem Argument. Beim Standardport braucht
der Eintrag keine Umgebungsvariable. `SSE_API_CONFIG` ist ein optionaler
absoluter Pfad für einen eigenen Arbeitsbereich. `SSE_API_URL` benennt dagegen
eine autoritative, separat verwaltete Loopback-API und verhindert jeden
Autostart. Der Supervisor sieht Pfadwerte aus `SSE_API_CONFIG` nur für die
Identitätsbildung; Steuerfall- und Dokumentinhalte bleiben ausschließlich im
API-Prozess.

### Betriebsarten

1. **NPX-Kurzweg:** API ohne globale Runtime-Installation im Vordergrund
   starten, direkte CLI verwenden und nach dem Auftrag beenden; kein MCP.
2. **MCP-Standard:** Agentkonfiguration verweist auf den installierten
   MCP-Einstieg. Er übernimmt eine exakt passende API oder startet seine eigene
   Dependency unsichtbar und wartet auf Readiness.
3. **Direkte API:** Das API-Paket separat installieren, bewusst im Vordergrund
   starten und CLI/HTTP ohne MCP verwenden.

Der Singleton ist kein Windows-Dienst, keine geplante Aufgabe und kein
allgemeiner Autostart: Er entsteht nur beim MCP-/Selftest-Start, lauscht nur auf
Loopback und startet weder SteuerSparErklärung noch eine fachliche Operation von
sich aus. VBS-Launcher und `install-api-task.ps1` bleiben entfernt.

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
Focusless-Commit. Produktiv angeboten werden ausschließlich `supported`-Profile.
Die Dialogantwort der Automation ist zusätzlich auf eine exakt gebundene passive
Gewinnaktualisierungsnotiz mit `OK` beschränkt; Recovery-Dateien werden nicht
automatisch verworfen. Das Manifest trennt `status` von `operationAccess`:
2025 trägt `full`, 2024 `verification-only`. Freigabe und voller Betriebsraum
öffnen sich nur bei `supported` **und** `full`; eine reine Status-Promotion
bleibt daher fail-closed. `capabilities.operationPolicy` klassifiziert alle 99
Operationen als Lesen, Navigation, bedingtes Focusless-Schreiben, Mutation,
destruktiv oder Cleanup und nennt Opt-in- sowie Build-Drift-Gates. Ein zweiter
MCP-Server pro Jahr ist nicht vorgesehen, solange sich nur Profildaten ändern.
Erst eine nachgewiesene, grundlegende UI-/Protokollabweichung rechtfertigt
einen separaten Worker-Adapter.

## Erster Start statt Einrichtungsprogramm

Es gibt kein Setup-Programm. Beim Start liest die API ihre Konfiguration aus
`--config` beziehungsweise dem Standardort, ergänzt jedes fehlende Feld durch
einen Standardwert und legt die vier Ressourcenbereiche sowie das Logverzeichnis
an. Fehlt die Datei vollständig, ist das kein Fehler, sondern der Normalfall:
Ohne Token bleibt nichts Geheimes zu erzeugen, und alle übrigen Werte haben
sichere Vorgaben. Eine ausdrücklich benannte Datei wird nie stillschweigend
erfunden oder ersetzt.

Eine ältere Betakonfiguration mit `token` wird beim Laden nicht ignoriert,
sondern mit einer Meldung abgelehnt, die die zu löschende Zeile nennt. Eine
stillschweigend akzeptierte tote Einstellung wäre der schlechtere Weg.

Die einzige verbleibende Erkennung ist die Suche nach `SSE.exe` in beiden
Programmordnern; sie greift nur, wenn keine Executable konfiguriert ist.
API-Konfigurationen, Produktprofile und Workspace-Texte werden strikt als UTF-8
und mit festen Größenlimits gelesen; ein während des Lesens wachsendes Ziel kann
diese Grenzen nicht überlaufen.

## Öffentliche Skills

Öffentliche Skills liegen im von `npx skills` auffindbaren Layout
`skills/<name>/SKILL.md`. Namen und Verzeichnis stimmen überein, verwenden nur
Kleinbuchstaben/Ziffern/Bindestriche und tragen den eindeutigen Präfix
`steuer-spar-erklaerung-`.

Der veröffentlichte Standard installiert genau einen Skill:
`steuer-spar-erklaerung`. Er prüft zuerst über `sse_health`, ob überhaupt ein
Transport da ist, stellt bei fehlendem MCP den Installationsstand nach der
kanonischen öffentlichen Anleitung her und bindet danach den bereits geöffneten
Arbeitsfall; nur ein ausdrücklich isolierter Audit öffnet eine hashverifizierte
Prüffallkopie. Agent-spezifische Metadaten sind
optional; die eigentliche Anleitung bleibt mit Codex, Claude Code und anderen
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

Ein Szenario muss dynamische Ausgaben vorheriger Schritte referenzieren und
garantierte Cleanup-Schritte besitzen. Der komplexe Test-Referenzfall umfasst
mindestens:

1. Eingabedateien inventarisieren und hashen;
2. eine ausdrücklich als Testfixture vorgesehene Arbeitskopie erzeugen;
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
laufen seriell, voneinander unabhängige Vertragstests mit begrenzter
Parallelität und globale Sentinels exklusiv. Schritte, die einen echten
lock-pflichtigen Worker starten, teilen im parallelen Scheduler einen
Konfliktschlüssel; untereinander laufen sie seriell, während reine Quell- und
lokale Tests weiter parallel bleiben. Der Controller-Mutex-Vertrag und der
No-Console-Test laufen exklusiv. Jeder Schritt behält eigenen Namen, Dauer,
begrenzte Diagnoseausgabe und
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

Der Gesamtstand ist erst produktiv, wenn die schnelle Testsuite, alle
verfügbaren Real-Fixture-Tests, die Skill-Validierung, Datenschutzprüfung und
der abschließende Anforderungsabgleich grün sind. Externe Reviews sind
zusätzliche Evidenz und ersetzen diese Prüfungen nicht.
