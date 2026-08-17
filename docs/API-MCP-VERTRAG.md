# API-/MCP-Vertrag

Stand: 2026-08-11

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

Die API validiert jedes Worker- und Kompositionsergebnis vor der HTTP-Ausgabe.
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

Die API serialisiert UI-Aufträge. Ein MCP-Abbruch wird über den HTTP-Client an
die API weitergereicht. Timeout oder Abbruch bedeutet bei einer Mutation nicht
„nicht ausgeführt“: Vor jeder Wiederholung muss der Zustand neu gelesen werden.
Kann ein gestarteter Worker-Prozessbaum nicht sicher beendet werden, sperrt die
API weitere Worker-Aufrufe bis zum Neustart.

## Ergebnisgrenze und Evidenz

Der gemeinsame Ergebnisvertrag ist technisch an allen Transportgrenzen
durchgesetzt:

- das Worker-/Kompositionsergebnis am API-Rand validieren;
- in Discovery und OpenAPI referenziert werden;
- im MCP-Katalog als `outputSchema` erscheinen;
- das kanonische, pfadredigierte `structuredContent` validieren;
- synthetische Erfolgs-, Fachfehler- und Malformed-result-Tests bestehen.

Davon getrennt bleibt die fachliche Live-Evidenz: Ein Schema beweist weder die
Erreichbarkeit jedes UI-Zustands noch alle Schreib-, Rollback- und
Wiederöffnungsvarianten. Doku und Release Notes dürfen daher vollständige
Transportparität, aber keine vollständige praktische UI-Abdeckung aller
Operationen behaupten. Der genaue Stand steht in
[VERIFIKATION.md](VERIFIKATION.md).
