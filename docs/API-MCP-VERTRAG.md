# API-/MCP-Vertrag

## Inhalt

- [Rollen](#rollen)
- [Erreichbarkeit und Browser-Schutz](#erreichbarkeit-und-browser-schutz)
- [HTTP-Hüllen](#http-hüllen)
- [Dauerhaftes CLI-Journal](#dauerhaftes-cli-journal)
- [MCP-Abbildung](#mcp-abbildung)
- [Aliase und Kompositionen](#aliase-und-kompositionen)
- [Queue, Abbruch und Timeout](#queue-abbruch-und-timeout)
- [Ergebnisgrenze und Evidenz](#ergebnisgrenze-und-evidenz)

## Rollen

Die lokale HTTP-API ist der ausführende Kern. Sie besitzt Konfiguration,
Ressourcenauflösung, Queue, Szenarien und den Windows-Worker. MCP ist ein
PC-blinder fachlicher Adapter: Er ruft für ein Werkzeug genau die zugeordnete
API-Operation oder eine dokumentierte API-Komposition auf. Nur sein Supervisor
kennt Loopback-URL, optionale absolute `SSE_API_CONFIG` und die eigene exakte
API-Dependency. Für die Identitätsprüfung liest er aus der begrenzten
Konfigurationsdatei auch die Ressourcenpfade und hasht sie; Inhalte aus
Steuerfällen, Belegen oder Arbeitsbereichen liest er nicht und gibt die Pfade
nicht über MCP aus.

Die normativen Laufzeitquellen sind:

- `GET /v1/operations` und `GET /v1/operations/{operation}` für
  Argument- und Ergebnisverträge, Traits, Grenzen und Sicherheitsplanung;
- `GET /v1/openapi.json` für dieselben HTTP-Verträge als OpenAPI 3.1;
- der MCP-Werkzeugkatalog für strikte agententaugliche Eingaben.

Handgepflegte Operationszahlen in Prosa sind nicht normativ.

## Erreichbarkeit und Browser-Schutz

- Die API bindet ausschließlich an `127.0.0.1` oder `::1`.
- `GET /healthz` ist ohne Anmeldung erreichbar und gibt nur technischen
  Zustand sowie `packageName`, `packageVersion`, `processId`, die zufällige
  `instanceId` und den pfadfreien `configurationFingerprint` für die strikte
  lokale Singleton-Identität aus. MCP sendet die geprüfte `instanceId` bei
  jedem Operations-POST mit; eine inzwischen ausgetauschte API lehnt den
  Auftrag vor dem Executor ab.
  Bei einem verwalteten `SSE_API_CONFIG` muss auch dieser Fingerprint exakt zur
  erwarteten Ressourcenbindung passen.
- Es gibt keine Anmeldung und kein Token. Discovery, OpenAPI und jede
  Operation sind für jeden lokalen Prozess erreichbar. Aufrufe aus einem
  Browser werden anhand von `Origin`, `Sec-Fetch-Site` und `Host` mit `403`
  abgewiesen.
- Jeder lokale Prozess, der die API erreicht, hat die volle Autorität der vom
  aktiven Profil zugelassenen Operationen. Eine Nutzerfreigabe im Agenten-Skill
  ist keine serverseitige Approval-Sitzung.
- Loopback darf nicht über Proxy, Tunnel oder Portweiterleitung veröffentlicht
  werden.

## HTTP-Hüllen

Ein erfolgreicher HTTP-Aufruf liefert Transportmetadaten und das fachliche
Ergebnis getrennt:

```json
{
  "apiVersion": "v1",
  "requestId": "UUID",
  "operation": "page",
  "durationMs": 123,
  "result": { "ok": true }
}
```

Ein fachlich erwartbarer Fehlschlag kann als gültige Operationsantwort mit
`result.ok=false`, `kind`, `error` und Readback-/Recovery-Feldern erscheinen.
Fehler vor der Ausführung, etwa Herkunftsschutz, unbekannte Operation oder
ungültige Argumente, verwenden eine HTTP-Fehlerhülle.

## Dauerhaftes CLI-Journal

Die ausgelieferte CLI kann mit `--journal-file <neue.jsonl>` einen
absturzlesbaren Aufrufernachweis erzeugen. Sie reserviert den Pfad exklusiv und
überschreibt nie. Noch vor Konfigurationslesen oder API-Aufruf schreibt und
flush't sie einen Eintrag mit `schemaVersion=1`, `invocationId` und
`status=pending`. Nach der Antwort folgt vor stdout ein ebenfalls synchronisierter
Eintrag `complete` mit `exitCode` und dem vollständigen Ergebnis. Ein lokaler
Clientfehler endet nach Möglichkeit mit `status=error`.

`complete` beschreibt den abgeschlossenen CLI-/API-Roundtrip, nicht zwingend
fachlichen Erfolg. Bei `result.ok=false` ist `exitCode=1` beabsichtigt; der
Aufrufer muss `kind`, `error` und mögliche Teilstands-/Recovery-Felder lesen.
Insbesondere bleibt ein durch sein Seitenlimit beendetes `collect`
`collection-incomplete`, auch wenn es verwertbare gelesene Seiten enthält.

Ein alleiniger `pending`-Eintrag beweist weder Erfolg noch Fehlschlag. Die
Operation kann serverseitig begonnen worden sein, während Aufrufer, Pipe oder
Transport abbrachen. Eine solche Operation darf nicht blind wiederholt werden;
zuerst ist ihr fachlicher Zustand über eine neue, read-only API-Abfrage zu
ermitteln. Das Journal ist bewusst eine optionale CLI-Aufruferfunktion und kein
zweites serverseitiges Transaktionsprotokoll.

Argumente erreichen die CLI auf zwei Wegen: einzeln als `--<name> <wert>` oder
als JSON-Objekt über `--args-file`. Beides zusammen ist erlaubt; die Datei ist
die Grundlage, einzelne Werte gewinnen darüber. Ein einzelner Wert wird als JSON
gelesen, wenn er sich als JSON lesen lässt, sonst als Zeichenkette — `--hwnd 123`
ist also eine Zahl, `--name Spenden` eine Zeichenkette.

Eine Zeichenkette, die wie eine Zahl aussieht, lässt sich **nicht shellneutral**
erzwingen. Gemessen auf derselben Maschine: Windows PowerShell 5.1 entfernt die
Anführungszeichen aus `--pageId '"2024"'` und übergibt `2024`, PowerShell 7
reicht `"2024"` unverändert durch; die jeweils andere Schreibweise `'\"2024\"'`
verhält sich spiegelbildlich. Es gibt keine Form, die in beiden Editionen
funktioniert. Wer einen Typ sicher erzwingen will, nimmt `--args-file`.

Für den Weg über die Kommandozeile gelten zwei weitere Einschränkungen, die
keine Verbote sind, sondern Eigenschaften der Umgebung: Werte landen im
dauerhaften Verlauf der Shell, und nicht-ASCII geht durch deren Codepage. Für
Umlaute und für alles, was nicht im Verlauf stehen soll, bleibt `--args-file`
der verlässliche Weg.

Für `--args-file` gilt zusätzlich ein Bytevertrag: Mehrzeilige oder
nicht-ASCII Nutzdaten werden als neue UTF-8-JSON-Datei ohne BOM erzeugt,
zurückgeparst und über ihren Pfad übergeben. Eine Windows-PowerShell-Pipeline
vor `--args-file -` ist dafür ungeeignet, weil ihre implizite Codepage
beispielsweise Umlaute durch `?` ersetzen kann, ohne dass JSON ungültig wird.
Stdin bleibt auf kleine, im selben Prozess erzeugte ASCII-Objekte begrenzt.
Create-only Textresultate werden nach dem Schreiben über die API zurückgelesen;
API-Hash, physischer Hash und Hash des zurückgelesenen UTF-8-Texts müssen
übereinstimmen. Ein bereits kodierungsbeschädigtes Ziel wird nicht
überschrieben, sondern durch einen neuen, ausdrücklich korrigierenden Snapshot
ersetzt.

### Wiederherstellungsdialog

Eine exakt erkannte SSE-Wiederherstellungsfrage erscheint in `dialog_list` mit
`recoveryPrompt=true` und `requiresCaseBinding=true`. Ihr Fingerprint allein
reicht nicht: `dialog_answer` akzeptiert nur `Nein` sowie `expectedCaseRef` und
`expectedCaseHash`. API und MCP lösen die Referenz innerhalb des konfigurierten
`cases:`-Bereichs auf; der Worker bindet dieselbe Datei erneut an PID und
Command-Line, prüft SHA256 und Parser, klickt fingerprintgebunden und verifiziert
anschließend reguläres Fallfenster und unveränderten Hash. `Ja`, unvollständige
Bindings, abweichende Texte/Schalter oder ein nachträglich veränderter Dialog
enden ohne Klick.

Für einen Prozess, der ohne Falldatei gestartet wurde (etwa ein nie gespeicherter
neuer Fall), gibt es keine reguläre Datei, an die sich `Nein` binden ließe.
`dialog_answer` akzeptiert dann `Nein` mit `discardUnsavedRecovery=true`: Der
Worker beweist über die Prozess-Kommandozeile, dass keine Falldatei geladen war,
verlangt nach dem Klick genau ein reguläres, nicht wiederhergestelltes Fallfenster
und meldet `caseBindingModeAfter=file-less-start` sowie
`startedWithoutCaseFile=true`. Das Flag ist mit `expectedCaseRef` und
`expectedCaseHash` unvereinbar und außerhalb der Wiederherstellungsfrage
verboten; ein mit Falldatei gestarteter Prozess wird mit `case-mismatch`
abgewiesen.

## MCP-Abbildung

Vor dieser Abbildung übernimmt der MCP-Start ausschließlich eine exakt passende
API-Identität oder startet bei freiem Ziel seine installierte Dependency. Eine
explizite `SSE_API_URL` deaktiviert Start und Fallback. Parallelstarts
konvergieren über das Port-Rennen; fremde oder unklare Prozesse werden nie
beendet oder ersetzt. `SSE_API_URL` und `SSE_API_CONFIG` gemeinsam sind als
mehrdeutige Wahl gesperrt. API-stdio bleibt vollständig vom MCP-stdout getrennt.

- MCP validiert unbekannte, falsch typisierte und zu große Argumente vor dem
  API-Aufruf. Nennt eine Meldung einen unbekannten Feldnamen, listet sie die
  erlaubten Namen der Operation gleich mit.
- Fehlertexte des Arbeitsprozesses nennen **MCP-Werkzeugnamen** (`sse_…`), auch
  wenn der Aufruf über die API oder die CLI kam. Ein Werkzeugname trägt dort
  teils mehr Information als der Operationsname: `sse_change_field` und
  `sse_change_known_field` sind beide `tracked_set_value`. Die vollständige
  direkte Zuordnung steht maschinenlesbar in
  `capabilities.transport.mcpToolOperations`; komponierte Werkzeuge stehen mit
  ihren geordneten API-Basisoperationen daneben in
  `capabilities.transport.mcpComposedToolOperations`.
- API-Fehlerfelder werden nicht durch eine Fehler-Allowlist abgeschnitten;
  MCP markiert sie mit `isError=true`.
- Erfolgreiche Antworten bleiben als JSON-Text verfügbar. Einige Werkzeuge
  erzeugen darin aus Kompatibilitätsgründen eine kompakte Projektion. Alle 101
  MCP-Werkzeuge veröffentlichen parallel ein vollständiges, redigiertes
  `structuredContent` mit einem deklarierten `outputSchema`. Bei den 100
  direkten Werkzeugen ist es das API-Ergebnis; `sse_preflight` besitzt einen
  eigenen PC-blinden Kompositionsvertrag.
- Lokale Windows-, UNC-, Datei-URL- und typische POSIX-Pfade werden an der
  MCP-Ausgabegrenze redigiert. Deshalb kann die öffentliche MCP-Antwort nicht
  bytegleich mit einem unredigierten lokalen API-Objekt sein.
- Bilder werden als MCP-Bildinhalt geliefert, wenn Operation und Argumente dies
  erlauben. Die zugehörigen API-Metadaten bleiben im kanonischen
  `structuredContent`; die bereits als Bildinhalt übertragenen Base64-Bytes
  (`imageBase64`/`bildBase64`) werden dort nicht dupliziert.

Alle 100 Operationen besitzen ein eigenes `Result_<operation>`-Schema der
Ergebnisvertragsversion 1. Diese Schemata typisieren die stabile
Transportfläche und ausgewählte fachliche Kernfelder, bleiben aber mit
Zusatzfeldern vorwärtskompatibel. Sie sind deshalb ein versionierter
Mindestvertrag und keine Behauptung, dass jede UI-bedingte Erfolgsvariante
bereits live erzeugt wurde.

Keine Operation fällt mehr auf einen reinen `ok/kind/error/ms`-Umschlag
zurück. Auch Lese-, Diagnose-, Navigation-, Cleanup- und der ausschließlich
auf das globale steuerneutrale Suchfeld begrenzte `set_value`-Pfad nennen ihre
stabilen Fach-, Guard- oder Recovery-Felder. Der statische Worker-Guard prüft
dabei nur Top-Level-Felder realer `Emit`-Objekte; gleichnamige Properties in
verschachtelten Bindungs- oder Rollbackobjekten gelten nicht als Beleg. Eine
berechnete `ok`-Ausgabe muss zusätzlich `kind` und `error` für ihren
möglichen Fehlerzweig besitzen; damit wird ein fachliches `ok=false` nicht
erst an der API-Grenze in einen HTTP-502-Vertragsfehler verwandelt.

Alle 30 als destruktiv annotierten Operationen veröffentlichen inzwischen
fachliche Erfolgs-, Guard- oder Recovery-Felder statt nur
`ok/kind/error/ms`. Gemeinsame Zod-Bausteine verhindern dabei abweichende
Typentscheidungen für Flag, Hash, Rollback und Fenster-/Eingabe-Guard. OpenAPI
referenziert die häufigsten Blattbausteine und den gemeinsamen
`OperationResultEnvelope` als Komponenten; die operationsspezifischen
Result-Schemas bleiben semantisch identisch.

Die API validiert jedes lokale Executor-, Worker- und Kompositionsergebnis vor
der HTTP-Ausgabe.
Ein strukturell ungültiges Ergebnis endet als redigierter HTTP-502-Fehler
`invalid-operation-result`. Discovery veröffentlicht Versionsnummer und
Schemas; OpenAPI referenziert sie pro Operationspfad; jedes MCP-Werkzeug nutzt
das zugehörige Schema als `outputSchema` und liefert das vollständige Ergebnis
als `structuredContent`.

Gesamt-Discovery und OpenAPI werden beim Serverstart einmal innerhalb des
Antwortlimits als UTF-8-Bytes serialisiert. Wiederholte GETs übertragen diesen
byteidentischen Snapshot, statt die rund 200–270 KiB großen Vertragsbäume pro
Request erneut zu durchlaufen. Die kleine Einzeloperations-Discovery bleibt
dynamisch, weil ihre Serialisierung im gemessenen Pfad vernachlässigbar ist.

Der Operationsvertrag trennt Registrierung von aktueller Interaktionsfreigabe.
Beim BelegManager ist nur `receipt_manager_list` als `focusless-read` erlaubt.
Die neun weiteren registrierten Operationen melden in
`capabilities.operationPolicy` `foreground-required`/`blocked` und liefern bei
gueltigen Aufrufen denselben nicht wiederholbaren strukturierten Block ueber
HTTP und MCP. Die Pruefung liegt nach der Argumentschema-Validierung, aber vor
Ressourcenaufloesung, Workerstart und UI; auch der direkte Worker besitzt den
identischen Guard.

Die MCP-Eingaben dürfen strenger sein als die der lokalen API, nie
großzügiger. Bekannt und gewollt:

- Die Ressourcenwerkzeuge `sse_workspace_files`, `sse_workspace_read_text` und
  `sse_workspace_write_text` verlangen die eindeutige Form `bereich:pfad`.
  Der zusätzliche `area`-Parameter mit bloßem Relativpfad bleibt der lokalen
  HTTP-API und der CLI vorbehalten.
- Die historischen `*Path`-/`dir`-Argumente mit absolutem Windows-Pfad sind
  ebenfalls API-only; MCP kennt ausschließlich Ressourcenreferenzen.
  Insbesondere bleibt `case_hash.path` für vertrauenswürdige lokale
  Bestandsclients kompatibel und darf eine profilkonform benannte Falldatei
  auch außerhalb des konfigurierten Fallordners lesen. Für neue Aufrufer ist
  `cases:` die begrenzte, PC-blinde Form. Die API darf deshalb ausschließlich
  lokalen, vollständig vertrauenswürdigen Prozessen zugänglich bleiben.

API-/MCP-Parität bedeutet damit:

1. derselbe Operationsvertrag und dieselbe Ausdrucksstärke der Eingaben, wobei
   MCP auf die eindeutige Referenzform beschränkt bleibt;
2. genau ein API-Aufruf je einfachem MCP-Werkzeug;
3. keine verlorenen fachlichen Erfolgs- oder Fehlerfelder an der kanonischen
   MCP-Ergebnisgrenze;
4. dokumentierte Aliase und Kompositionen;
5. Pfadredaktion und die Auslagerung von Base64-Bildbytes in MCP-Bildblöcke als
   einzige beabsichtigte inhaltliche Transportdifferenzen.

## Aliase und Kompositionen

Die Zahl der Werkzeugnamen ist nicht die Zahl eindeutiger API-Ziele.
Beispielsweise bilden zwei Feldwerkzeuge auf `tracked_set_value` ab.
`sse_preflight` bildet bewusst nicht auf eine erfundene API-Operation ab: Es
ruft sequenziell `workspace_status`, `product_info` und `health` auf, stoppt bei
einem Komponentenfehler und gibt ansonsten nur stabile Bereitschaftsflags und
Blockercodes aus. Es startet oder konfiguriert nichts und gilt nicht als
Mutationsfreigabe. `ready=true` verlangt sowohl für die geprüfte Installation
als auch für den tatsächlich laufenden Prozess einen expliziten
`buildDrift.drifted=false`-Nachweis; fehlende oder abweichende Runtime-Evidenz
endet mit `SSE_BUILD_DRIFT`.
`checker_open` komponiert intern Prüferlesen und einen eng gebundenen
read-only Detailklick. UStVA-Werkzeuge komponieren profilierte Seiten- und
Feldoperationen in der API, nicht im MCP-Prozess. Ihr Seiten-Read und die
nachfolgende gebundene UI-Aktion teilen eine absolute Aufruferdeadline. Unter
zwei Sekunden Rest startet keine UStVA-Mutation oder Bereichsnavigation mehr.
`case_create` komponiert in der API den Startassistenten eines neuen Falls:
`launch` ohne Datei, `instances`/`ui_state` bis zur Startseite, `subpages` und
`click` bis zur ersten Stammdatenseite, `menu`/`menu_click` „Speichern
unter…“, `dialog_list` und `file_dialog_select` im Modus `save-new` sowie den
`instances`-Readback. Vor dem Speichern beendet jeder Fehler die exakt
gestartete PID ohne Speichern; nach dem Speichern wird nie gelöscht. Die
Operation verlangt eine leere Instanzliste, keinen aktiven versteckten Desktop,
ein neues Ziel mit modusgerechter Endung und ist auf live verifizierte
Startmodi begrenzt. Kann der Worker nach dem Speichern keinen Dateihash
liefern, weil der Prozess ohne Datei gestartet wurde und der Titel gekürzt ist,
prüft die API den Dateihash lokal gegen den Dialog-Readback
(`caseHashSource=local-file`).

Jede neue Ausnahme braucht einen Vertragstest, der API-Ziel, Argumente,
Fehlerweitergabe und Ergebnisfelder nachweist.

## Queue, Abbruch und Timeout

Der HTTP-Client hält das kombinierte MCP-/Aufrufersignal und seine eigene
Frist nicht nur bis zu den Antwortheadern, sondern bis zum vollständigen,
größenbegrenzten JSON-Body aktiv. Das gilt für Operationen ebenso wie für
Discovery und OpenAPI; ein nach den Headern hängender Body bleibt damit
abbrechbar. Lehnt der Client eine Antwort schon wegen eines falschen
`Content-Type` ab, cancelt er den ungenutzten Body vor dem Protokollfehler;
dadurch bleiben weder ein Streaming-Body noch sein Keep-alive-Socket aktiv.
Der produktive Defaultpfad verwendet direkt `node:http` auf Loopback und hat
keine zusätzliche 300-Sekunden-`fetch`-/Undici-Frist. Dadurch bleibt das
zusätzliche Cleanup-Fenster auch nach einer maximalen Fünf-Minuten-Operation
erreichbar. Injizierte Test-/Alternativtransporte können weiterhin
`UND_ERR_HEADERS_TIMEOUT` oder `UND_ERR_BODY_TIMEOUT` liefern; beide werden als
`timeout` mit unbekanntem Operationszustand klassifiziert und dürfen keine
blinde Wiederholung auslösen.
Node-HTTP-Fehlercodes werden sowohl direkt am Fehler als auch in einer
Transportursache gelesen. Bricht eine bereits aufgebaute Verbindung während
eines Operations-POSTs mit `ECONNRESET`, `ECONNABORTED`, `EPIPE`,
`ERR_STREAM_PREMATURE_CLOSE` oder `UND_ERR_SOCKET` ab, lautet die Fehlerart
`transport-unknown`: Der Auftrag kann bereits ausgeführt worden sein und darf
erst nach einem gezielten Zustands-Readback wiederholt werden. Ein verweigerter
Verbindungsaufbau (`ECONNREFUSED`) bleibt dagegen `network`.
Die gültigen HTTP-Nullbody-Statuscodes 204, 205 und 304 werden ohne
synthetischen Web-Stream abgebildet; 304 bleibt bei `redirect=error` dennoch
vorher gesperrt. Dadurch entstehen an dieser Adaptergrenze keine internen
WHATWG-`Response`-Konstruktorfehler.

Der MCP-Abbruchvertrag wartet im Integrationstest nicht auf eine zufällig
langsame Datei oder einen Virenscanner. Eine deterministische Executor-Barriere
beweist nacheinander, dass der MCP-Client lokal abbricht, der bereits
angekommene HTTP-Auftrag sein API-`AbortSignal` sieht, der Workspace-Executor
`kind=aborted` liefert, die getrennte Antwort als `delivered=false` geloggt
wird und ein zweiter Auftrag danach vollständig gelingt. Der kooperative
Abbruch während eines echten 64-KiB-Hashblocks bleibt davon getrennt im
Workspace-Dateivertrag geprüft.

Die API serialisiert Windows-Worker- und damit UI-Aufträge. Rein lokale,
read-only Pfade wie `case_hash`, das nicht-ausführliche `list_cases`, der
öffentliche Profilkatalog `page_objects` und die hashgebundene
`verify`-Auswertung laufen ohne PowerShell-Prozess und beachten denselben
Abbruch und Timeout.
Diese API-Sperre ist pro Prozess. Ein zweiter API-Prozess auf einem anderen
Loopback-Port oder ein direkter Worker wird deshalb zusaetzlich fuer jeden
lock-pflichtigen PowerShell-Workerabschnitt ueber einen festen Windows-
Sitzungsmutex koordiniert. Der Versuch wartet nicht:
`kind=busy`, `reason=session-controller-busy`, `retryable=true`,
`waited=false`, `mutationStarted=false` und `resultingState=unchanged` kommen im
normalen HTTP-200-Operationsergebnis zurueck. Das unterscheidet sich vom
prozesslokalen HTTP-409-Single-Flight. Nur `page_objects` und `product_info`
umgehen den Mutex; vorgewaermte Reserveworker halten ihn erst ab ihrem Auftrag.
Bei einem gültigen SSE-Privatdesktop-Marker dürfen genau diese zwei
desktopunabhängigen Reads eine bereits bereite Reserve verwenden. Node und
Worker prüfen den Marker trotzdem jeweils selbst; ein fremder Center-Marker
bleibt gesperrt, und ohne bereite Reserve gilt weiterhin der markierte
Kaltstart.
`unchanged` bedeutet hier ausschliesslich: Der abgewiesene Aufruf selbst hat
nichts mutiert. Der laufende Besitzer kann den gemeinsamen Produktzustand
waehrenddessen aendern; ein spaeterer Retry braucht deshalb frische Bindungen.
Lokale API-Pfade halten den Mutex nicht. Eine zusammengesetzte API-Operation mit
mehreren Workeraufrufen erwirbt ihn fuer jeden Schritt neu und kann dazwischen
mit einem anderen Prozess verzahnt werden; frische Bindungen und Postconditions
lassen einen solchen Schritt weiterhin fail-closed abbrechen. Dies ist daher
eine Serialisierung der SSE-/UIA-Kritischen Abschnitte, keine sitzungsweite
Transaktion um einen vollstaendigen API-Aufruf.
Eine beobachtete Aufgabe oder eine nicht sicher bind-/freigebbare Sperre liefert
`worker-isolation-lost` und unbekannten Zustand. Der Mutex speichert einen
bereits beendeten Crash nicht dauerhaft; Abbruch-/Timeout- und Readbackregeln
bleiben deshalb unveraendert.
Die Worker-Queue zählt höchstens 32 tatsächlich laufende oder noch wartende
Aufträge. Ein bereits abgebrochener Aufruf wird nicht eingereiht; ein erst in
der Queue abgebrochener Aufruf gibt seinen Kapazitätsplatz sofort frei und
wird vollständig aus der Warteliste entfernt, ohne einen Worker zu starten.
Nur ein bereits gestarteter Worker behält den Platz bis zum nachgewiesenen
Prozessbaum-Cleanup. `busy` bezeichnet dadurch echte laufende/wartende Last,
nicht zurückgelassene Clientabbrüche.
Die lokale Workspace-Dateiliste gibt den Eventloop zwischen vollständig
containment-geprüften Laufeinheiten sowie zwischen höchstens 64 KiB großen
Hashblöcken frei und liefert bei Abbruch oder Deadline keine Teilliste. Pro
Datei werden höchstens 16 MiB, pro Liste höchstens 64 MiB gehasht; tatsächlich
gelesene Bytes belasten dieses Gesamtbudget auch dann dauerhaft, wenn eine
währenddessen veränderte Datei keinen Hash erhält. Bei einem fachlichen
Dateilimit prüft die Liste genau einen weiteren
Treffer und kennzeichnet die ansonsten gültige Teilliste mit `truncated=true`;
ein vollständig durchlaufenes Verzeichnis liefert `truncated=false`.
Die auf 1 MiB begrenzten Textoperationen prüfen beides vor dem
Dateizugriff; ein bereits exklusiv begonnenes synchrones Schreiben wird zu
Ende geführt und nicht nachträglich als fehlgeschlagen ausgegeben.
Auch `make_working_copy` läuft im API-Prozess: Quelle und atomar neu erzeugtes
Ziel bleiben über denselben Aufruf geöffnet, werden vollständig gehasht und an
Dateiidentität, Größe sowie Zeitstempel gebunden. Ein Abbruch oder Timeout
entfernt eine Teilkopie nur, wenn Identität, Bytezahl und Teilhash weiterhin
den eigenen Schreibstand beweisen; ein fremd verändertes Ziel bleibt erhalten.
Nach dem Erzeugen eines Ziels gibt es niemals einen Worker-Fallback.
Für einen ausdrücklich isolierten UI-Audit ist diese Operation auch ohne
geplante fachliche Mutation die Sicherheitsgrenze: Erst Originalhash lesen,
dann eine neue bytegleiche Prüffallkopie erstellen und ausschließlich deren
`targetRef` starten. SSE kann reine Seitennavigation als
`ungespeichert=true` markieren. Der normale Agentenauftrag verwendet dagegen
den bereits eindeutig geöffneten Fall, sichert dessen aktuellen Disk-Hash
einmal nach `backups:` und speichert den Navigationszustand nicht automatisch.
Die beiden potenziell langsamen Dateiöffnungen sind an Clientabbruch und
Deadline gebunden; ein spät erfolgreicher Ziel-Open schließt und entfernt sein
leeres Eigenziel nachträglich. `FileHandle.read/write/stat/unlink` besitzen in
Node dagegen kein sicher abbrechbares Windows-API: Der Kopierpfad prüft die
Deadline zwischen höchstens 1 MiB großen Blöcken, ein einzelner hängender
Kernel-/Netzlaufwerkaufruf kann sie aber überschreiten. Eigentumsgeprüftes
Cleanup läuft bewusst zu Ende, auch wenn das Antwortbudget bereits abgelaufen
ist. Der direkte Worker bleibt durch Prozessbaum-Abbruch härter begrenzbar.

Node kann unter Windows nicht dieselben Share-Modi wie der direkte Worker
anfordern: Der Worker verhindert konkurrierende Schreiber während seiner
offenen Handles, der API-Pfad erkennt sie fail-closed beim Readback. Deshalb
werden Quelle, Ziel und Pfadidentität nach dem Kopieren erneut verglichen. Da
Node außerdem kein `DELETE_ON_CLOSE` für diesen Pfad bereitstellt, bleibt beim
Rollback zwischen letzter Identitätsprüfung und `unlink` ein kleines
Dateisystem-TOCTOU-Restfenster. Der direkte Worker bleibt für kompatible lokale
Aufrufer und als Paritätsreferenz erhalten.
`backup_cases` läuft über API und MCP ebenfalls vollständig im API-Prozess.
Es verwendet für jede Falldatei den verifizierten Einzelkopierpfad, teilt ein
gemeinsames Client-Zeitbudget und prüft zusätzlich den exakten Quell- und
Zielbestand. Das Zielverzeichnis, fehlende verschachtelte Eltern und jede
Zieldatei müssen komponentenweise exklusiv neu sein;
erst nach einem zweiten vollständigen Readback wird das bytekompatible
Prüfsummenmanifest exklusiv geschrieben. Abort, Timeout oder Bestandsänderung
rollen nur nachweislich eigene Dateien zurück. Unbekannte oder fremd veränderte
Ziele werden nie gelöscht, sondern in `retainedTargets` zur manuellen Klärung
ausgewiesen. Ein partiell geschriebenes Manifest wird nur bei unveränderter
Dateiidentität und exaktem Präfix der beabsichtigten Bytes als eigener Stand
entfernt. Nach dem ersten `mkdir` gibt es auch hier keinen Worker-Fallback.

Der MCP-Ablauf unterscheidet Backup und Arbeitskopie trotz desselben
Kopierprimitivs: `backups:` ist die normale private Sicherung des aktuellen
Dateistands; ein `cases:`-Ziel entsteht nur auf ausdrücklichen Wunsch nach einer
separaten Datei. Der Agent merkt in der laufenden Aufgabe Fallreferenz,
Quellhash und verifizierte Backupreferenz und kopiert bei unverändertem Hash
nicht vor jedem Tool-Aufruf neu. Nach einem ausdrücklich beauftragten
`save`-Hashwechsel muss die nächste Mutationsphase neu sichern. Der Release
besitzt keine automatische Backup-Retention und löscht deshalb nichts.

`archive_cases` läuft über API und MCP ebenfalls lokal, während der direkte
PowerShell-Aufruf als Kompatibilitäts- und Paritätsreferenz bestehen bleibt.
Vor der ersten Mutation müssen `cases` plus `expectedRemaining` den
vollständigen profilkonformen Bestand einschließlich `<Fall>_Backup` bilden;
alle Hashes werden über dauerhaft offene Handles gebunden und jeder zu
archivierende Fall muss sicher als nicht übermittelt lesbar sein. Eine
fail-closed `tasklist.exe`-Prüfung blockiert bei laufender `SSE.exe` sowohl vor
dem Datei-Preflight als auch unmittelbar vor der ersten Bewegung.

Die lokale Bewegung ist absichtlich kein Node-`rename`: `rename` könnte unter
Windows ein gleichzeitig erschienenes Ziel ersetzen. Stattdessen wird jede
Datei per `wx+` exklusiv neu kopiert, vollständig über Hash, Dateiidentität und
Pfadzustand verifiziert und erst danach am Quellpfad entfernt. Der offene
Quell-Handle bleibt bis Commit oder Rollback erhalten; Änderungs- und
Zugriffszeit werden auf das Archivziel übertragen. Dieser Copy/Delete-Vertrag
gilt gleich für Ziele auf demselben oder einem anderen Volume. Vor jeder
einzelnen Quellentfernung wird der SSE-Prozessstatus erneut geprüft. Kann ein
Dateisystem einen Namen bei offenem Quell-Handle nicht sicher entfernen,
endet die Operation fail-closed und behält das verifizierte Archivziel als
strukturiert gemeldeten Wiederherstellungspunkt; sie behauptet keinen Erfolg.
Das
bytekompatible CSV-Manifest entsteht verifiziert vor der ersten Bewegung.
Abbruch oder Timeout nach einer Bewegung beendet nicht den Sicherheitsnachweis,
sondern löst den vollständigen eigentumsgeprüften Rollback aus. Bei einem
harten Prozess- oder Stromausfall kann dieses vorab geschriebene Manifest
deshalb bereits alle vorgesehenen Dateien nennen, obwohl noch nicht alle
Quellnamen entfernt wurden. Für eine manuelle Wiederaufnahme sind immer
Manifest und aktueller Quell-/Zielbestand samt Hash zu vergleichen.

Ist das Archivziel fremd verändert, schreibt der Rollback die Originalbytes
aus dem offenen Quell-Handle zurück und erhält das fremde Ziel. Ist zugleich
der alte Quellpfad fremd belegt, bleibt eine intakte Archivkopie unangetastet;
sind beide Pfade fremd, wird zusätzlich eine exklusive, hashverifizierte
`.sse-recovery-*`-Datei im weiterhin identitätsgebundenen `cases:`-Ordner
angelegt. `rollbackFiles`, `recoveryFiles`, `retainedTargets` und
`recoverable` machen diesen Zustand strukturiert sichtbar. Nach der ersten
Zielerstellung gibt es keinen Worker-Fallback.
`list_cases` bleibt bei `verbose: true` oder einem nicht sicher lesbaren
AKAD-Kopf auf dem Worker-Kompatibilitätspfad. `page_objects` lädt und validiert
Manifest und Katalog pro Aufruf neu; bei lokaler Profilinkonsistenz bleibt der
echte Worker der Kompatibilitätspfad. Lokaler Versuch und Worker-Fallback
teilen dabei dasselbe Client-Zeitbudget; der Fallback erhält nur die
verbleibende Frist und startet bei weniger als zwei Sekunden Rest keinen neuen
PowerShell-Prozess. `verify` fällt nur bei Quell- oder Unicode-Werten außerhalb
der nachgewiesenen Node-/PowerShell-Parität zurück; Hashabweichung, ungültiges
UTF-8/JSON, unvollständige Quelle, Abbruch und Timeout bleiben lokale,
fail-closed Ergebnisse. Das lokale 16-MiB-Limit hat vor einem Hashvergleich
Vorrang: Eine größere Quelle endet als `invalid-source`, ohne durch
unbegrenztes Hashen Arbeit erzwingen zu können. Auch das Öffnen einer Falldatei ist an Abbruch und
Timeout gebunden. Ein MCP-Abbruch wird über den HTTP-Client an die API
weitergereicht.
Timeout oder Abbruch bedeutet bei einer Mutation nicht
„nicht ausgeführt“: Vor jeder Wiederholung muss der Zustand neu gelesen werden.
Kann ein gestarteter Worker-Prozessbaum nicht sicher beendet werden, sperrt die
API weitere Worker-Aufrufe bis zum Neustart. Ein beendeter direkter Parent ist
dabei kein ausreichender Nachweis: Hält ein entkoppelter Enkel geerbte
stdout/stderr-Handles offen und verhindert dadurch Nodes `close`, verriegelt
der äußere Cleanup-Wächter die Worker-Laufzeit fail-closed.

## Ergebnisgrenze und Evidenz

Der gemeinsame Ergebnisvertrag ist technisch an allen Transportgrenzen
durchgesetzt:

- das lokale Executor-/Worker-/Kompositionsergebnis am API-Rand validieren;
- in Discovery und OpenAPI referenziert werden;
- im MCP-Katalog als `outputSchema` erscheinen;
- das kanonische, pfadredigierte `structuredContent` validieren;
- synthetische Erfolgs-, Fachfehler- und Malformed-result-Tests bestehen.

Zusätzlich vergleicht `test/operation-result-shape.json` die veröffentlichten
Schemas mit den tatsächlich beobachteten Ergebnisformen. Die Trace-Dateien
enthalten nur sichere Feldnamen, wertfreie JSON-Typklassen, Profil, Herkunft
und Ergebnisart. Bei Objektfeldern kommen sichere direkte Schlüsselnamen und
deren Typklassen hinzu; Werte und tiefer verschachtelte Inhalte werden nie
persistiert. Neue
Felder oder Typvarianten sind eine bewusste Vertragsänderung; beobachtete
Typen, die das Schema nicht akzeptiert, brechen den Lauf.

Davon getrennt bleibt die fachliche Live-Evidenz: Ein Schema beweist weder die
Erreichbarkeit jedes UI-Zustands noch alle Schreib-, Rollback- und
Wiederöffnungsvarianten. Doku und Release Notes dürfen daher vollständige
Transportparität, aber keine vollständige praktische UI-Abdeckung aller
Operationen behaupten. Der genaue Stand steht in
[VERIFIKATION.md](VERIFIKATION.md).
