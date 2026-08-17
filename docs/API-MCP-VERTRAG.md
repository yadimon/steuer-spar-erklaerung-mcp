# API-/MCP-Vertrag

Stand: 2026-08-16

## Rollen

Die lokale HTTP-API ist der ausführende Kern. Sie besitzt Konfiguration,
Ressourcenauflösung, Queue, Szenarien und den Windows-Worker. MCP ist ein
PC-blinder Adapter: Er kennt nur Loopback-URL und Token und ruft für ein
Werkzeug genau die zugeordnete API-Operation oder eine dokumentierte
API-Komposition auf.

Die normativen Laufzeitquellen sind:

- `GET /v1/operations` und `GET /v1/operations/{operation}` für
  Argument- und Ergebnisverträge, Traits, Grenzen und Sicherheitsplanung;
- `GET /v1/openapi.json` für dieselben HTTP-Verträge als OpenAPI 3.1;
- der MCP-Werkzeugkatalog für strikte agententaugliche Eingaben.

Handgepflegte Operationszahlen in Prosa sind nicht normativ.

## Authentifizierung und Erreichbarkeit

- Die API bindet ausschließlich an `127.0.0.1` oder `::1`.
- `GET /healthz` ist absichtlich ohne Token erreichbar und gibt nur
  technischen Zustand aus.
- Discovery, OpenAPI und jede Operation benötigen das lokale Bearer-Token.
- Das Token gewährt volle Autorität der vom aktiven Profil zugelassenen API.
  Eine Nutzerfreigabe im Agenten-Skill ist keine serverseitige Approval-
  Sitzung.
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
Fehler vor der Ausführung, etwa Authentifizierung, unbekannte Operation oder
ungültige Argumente, verwenden eine HTTP-Fehlerhülle.

## MCP-Abbildung

- MCP validiert unbekannte, falsch typisierte und zu große Argumente vor dem
  API-Aufruf.
- API-Fehlerfelder werden nicht durch eine Fehler-Allowlist abgeschnitten;
  MCP markiert sie mit `isError=true`.
- Erfolgreiche Antworten bleiben als JSON-Text verfügbar. Einige Werkzeuge
  erzeugen darin aus Kompatibilitätsgründen eine kompakte Projektion. Alle 87
  MCP-Werkzeuge veröffentlichen parallel das vollständige, redigierte
  nicht-binäre API-Ergebnis als `structuredContent` mit einem deklarierten
  `outputSchema`.
- Lokale Windows-, UNC-, Datei-URL- und typische POSIX-Pfade werden an der
  MCP-Ausgabegrenze redigiert. Deshalb kann die öffentliche MCP-Antwort nicht
  bytegleich mit einem unredigierten lokalen API-Objekt sein.
- Bilder werden als MCP-Bildinhalt geliefert, wenn Operation und Argumente dies
  erlauben. Die zugehörigen API-Metadaten bleiben im kanonischen
  `structuredContent`; die bereits als Bildinhalt übertragenen Base64-Bytes
  (`imageBase64`/`bildBase64`) werden dort nicht dupliziert.

Alle 87 Operationen besitzen ein eigenes `Result_<operation>`-Schema der
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

Alle 23 als destruktiv annotierten Operationen veröffentlichen inzwischen
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
  `cases:` die begrenzte und portable Form; das Bearer-Token darf deshalb nie
  an nicht vollständig vertrauenswürdige lokale Prozesse weitergegeben werden.

API-/MCP-Parität bedeutet damit:

1. derselbe Operationsvertrag und dieselbe Ausdrucksstärke der Eingaben, wobei
   MCP auf die eindeutige Referenzform beschränkt bleibt;
2. genau ein authentifizierter API-Aufruf je einfachem MCP-Werkzeug;
3. keine verlorenen fachlichen Erfolgs- oder Fehlerfelder an der kanonischen
   MCP-Ergebnisgrenze;
4. dokumentierte Aliase und Kompositionen;
5. Pfadredaktion und die Auslagerung von Base64-Bildbytes in MCP-Bildblöcke als
   einzige beabsichtigte inhaltliche Transportdifferenzen.

## Aliase und Kompositionen

Die Zahl der Werkzeugnamen ist nicht die Zahl eindeutiger API-Ziele.
Beispielsweise bilden zwei Feldwerkzeuge auf `tracked_set_value` ab.
`checker_open` komponiert intern Prüferlesen und einen eng gebundenen
read-only Detailklick. UStVA-Werkzeuge komponieren profilierte Seiten- und
Feldoperationen in der API, nicht im MCP-Prozess.

Jede neue Ausnahme braucht einen Vertragstest, der API-Ziel, Argumente,
Fehlerweitergabe und Ergebnisfelder nachweist.

## Queue, Abbruch und Timeout

Die API serialisiert Windows-Worker- und damit UI-Aufträge. Rein lokale,
read-only Pfade wie `case_hash`, das nicht-ausführliche `list_cases`, der
öffentliche Profilkatalog `page_objects` und die hashgebundene
`verify`-Auswertung laufen ohne PowerShell-Prozess und beachten denselben
Abbruch und Timeout.
Auch `make_working_copy` läuft im API-Prozess: Quelle und atomar neu erzeugtes
Ziel bleiben über denselben Aufruf geöffnet, werden vollständig gehasht und an
Dateiidentität, Größe sowie Zeitstempel gebunden. Ein Abbruch oder Timeout
entfernt eine Teilkopie nur, wenn Identität, Bytezahl und Teilhash weiterhin
den eigenen Schreibstand beweisen; ein fremd verändertes Ziel bleibt erhalten.
Nach dem Erzeugen eines Ziels gibt es niemals einen Worker-Fallback.
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
Es verwendet für jede Falldatei den verifizierten Arbeitskopiepfad, teilt ein
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
API weitere Worker-Aufrufe bis zum Neustart.

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
