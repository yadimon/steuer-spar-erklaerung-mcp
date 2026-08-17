# Mehrjahresprofile: strukturelle Bindung fuer 2024, 2025 und Folgejahre

Stand: 2026-08-06

## Umsetzungsstand 2026-08-11

Dieses Dokument bewahrt die damalige Designentscheidung. Mehrere Aussagen im
Futur beziehungsweise unter „Nicht im Umfang“ sind inzwischen historisch:

- `experimental` ist ladbar, 2024 bleibt aber weiterhin `experimental`;
- Fenstercontainer, Client-Header, Suche und Navigationsauswahl werden
  strukturell und profilneutral gebunden;
- `test/live-muster-cases.mjs` ist profilgetrieben und lief auf den
  Hersteller-Musterfällen von 2024 und 2025 erfolgreich;
- der Live-Sweep belegt inzwischen auch Gew2024, Ergebnisfenster,
  `checker_run/results/close`, UStVA-Read sowie mehrere Seiten- und
  Tabellenleser;
- der Live-Sweep ist opt-in und **nicht** Bestandteil von `npm test`;
- 2024 besitzt weiterhin keinen profilierten Focusless-Commit und keine
  allgemeine Schreibfreigabe. Ein grüner Lese-Sweep rechtfertigt daher keine
  Promotion auf `supported`;
- `operateExperimental` ist kein Generalschlüssel: Der aktuelle Quellstand
  öffnet damit ausschließlich einen expliziten, in TypeScript und PowerShell
  paritätsgetesteten Verifikationskatalog. Steuerdaten-, Tabellen-, Speicher-,
  Export- und VaSt-Mutationen bleiben gesperrt. Dialogantworten liegen außerhalb
  dieses Katalogs; nur eine exakt gebundene passive Gewinnaktualisierungsnotiz
  darf mit `OK` geschlossen werden. Recovery-Dateien werden nie automatisch
  verworfen;
- Profilstatus und Operationsfreigabe sind getrennt: 2025 ist
  `supported/full`, 2024 `experimental/verification-only`. Wizard und voller
  Betriebsraum verlangen beide Freigaben. Eine reine Status-Promotion öffnet
  daher weder Setup noch Schreiboperationen;
- bei Build-Drift bleiben Lesen, Diagnose und sicherer Cleanup verfügbar,
  UI-/Steuerfallmutationen stoppen aber in API und direktem Worker mit
  `build-drift`.

Der aktuelle Support- und Operationsstand ist normativ in
[../../VERIFIKATION.md](../../VERIFIKATION.md) beschrieben. Offene Checkboxen
im zugehörigen historischen Implementierungsplan sind kein Beleg dafür, dass
bereits umgesetzte Schritte fehlen.

## Ziel

Dieselbe API bedient mehrere Produktjahre der SteuerSparErklaerung in
gleicher Qualitaet und Geschwindigkeit. Ein neues Jahr wird als Profil
hinzugefuegt, nicht als zweiter Server und nicht als Sonderfall im
Dispatcher. Softwareupdates des Herstellers bleiben sichtbar, statt
unbemerkt die geprüfte Grundlage zu verschieben.

Umfang dieser Arbeit: Lesen und Navigieren auf 2024 auf dem Stand von 2025,
inklusive Tests. Schreiben auf 2024 bleibt bewusst fail-closed.

## Leitentscheidung: Struktur statt Geometrie

Bildschirmkoordinaten sind kein tragfaehiger Selektor. Fenstergroesse,
DPI, Schriftskalierung und verschobene oder eingeklappte Bereiche
unterscheiden sich je Nutzer und Sitzung. Ein Offset, der auf einem PC
stimmt, zeigt auf einem anderen auf den falschen Text.

Deshalb gilt: **Elemente werden ueber AutomationId, Containerzugehoerigkeit
und Steuerelementtyp gebunden, nie ueber absolute Pixelbaender.**
Relative Geometrie innerhalb einer bereits strukturell gebundenen Region
bleibt zulaessig, etwa die Zuordnung einer Beschriftung zum Feld rechts
daneben.

## Gemessene Ausgangslage

Alle Aussagen stammen aus Messungen am 2026-08-06 gegen beide installierten
Produkte, nicht aus Annahmen.

| Merkmal | 2025 | 2024 |
| --- | --- | --- |
| Engine-Hauptversion | 31 | 30 |
| Installationsordner | `Steuerjahr 2025` | `Steuerjahr 2024` |
| Qt-Fensterklasse | `Qt692QWindow` | `Qt673QWindow` |
| AutomationId-Wurzel | `SSE_Application.AAV4GLEngineWindow31` | `AAV4GLEngineWindow30` |

Ein zweites, gleichnamiges Produkt `Akademische Arbeitsgemeinschaft\
SteuerSparErklaerung 2024` traegt Engine-Hauptversion 29 und ist ein
anderes Produkt. Es wird nie bedient. Die Zuordnung erfolgt ueber den
Dateikopf des Steuerfalls (`FileSavedBy`), nicht ueber den Produktnamen.

### Der entscheidende Befund

In Engine 30 fehlen AutomationIds an einzelnen Blattknoten, die Engine 31
noch beschriftet. Die **Containerhierarchie ist jedoch in beiden Engines
identisch beschriftet**:

```text
Ueberschrift
  2025: … > Group[…RedThreadContent.ClientFrameSSE.ClientHeader] > Text[…ClientHeader.QLabel]
  2024: … > Group[…RedThreadContent.ClientFrameSSE.ClientHeader] > Text[ohne AutomationId]

Suchfeld
  2025: ToolBar[…MainToolBar] > Group[…MainToolBar.QWidget] > Group[…QWidget.SearchSSE] > Edit[…SearchSSE.QLineEdit]
  2024: ToolBar[…MainToolBar] > Group[ohne AutomationId]    > Group[…SearchSSE]        > Edit[ohne AutomationId]
```

Damit traegt eine einzige, engine-unabhaengige Regel beide Jahre. Eine
jahresspezifische Geometrie ist nicht noetig und waere zudem nutzerabhaengig
falsch.

Zusaetzlich gilt in beiden Engines: genau ein `TreeItem` des
Navigationsbaums meldet `SelectionItem.IsSelected = true`, und sein Name
entspricht auf Hauptseiten der Seitenueberschrift.

### Keine verbleibende Jahresabweichung

`TreeItem`-Knoten tragen in Engine 30 durchgaengig keine AutomationId
(0 von 6, 0 von 14, 0 von 14 auf drei geprueften Seiten). Das ist fuer die
Navigation folgenlos: `goto` bindet einen Baumzweig ueber den **Namen** des
`TreeItem` und klickt ihn per `Click-VerifiedPoint`; eine AutomationId wird
dabei nie verlangt. `pattern=select` ist laut Werkzeugvertrag ausschliesslich
fuer einen per AutomationId gebundenen `RadioButton` zulaessig und war nie
der Weg der Baumnavigation.

Damit bleibt nach den Messungen **keine** Jahresabweichung uebrig, die ein
eigenes Verhalten braeuchte. Beide Jahre laufen vollstaendig durch dieselben
Regeln; das Profil traegt nur noch Stammdaten und Selektorendungen.

## Architektur

### Profilaufbau

```text
profiles/
  2024/
    profile.json           Manifest: Jahr, Status, Operationszugang,
                           Engine-Hauptversion, verifizierter Build,
                           Installationsmerkmale und Startmodi
    page-objects.json      UI-Katalog inkl. Containerselektoren
    fixtures/              aufgezeichnete Knotenbaeume fuer Offline-Tests
    tests/expectations.json  Musterfaelle und erwartete Werte fuer den Live-Smoke
  2025/  gleiche Form
```

Es gibt **kein** `strategies.ps1` und keinen Jahrescode. Beide Jahre laufen
durch dieselben Funktionen.

### Gemeinsame Strukturregeln

| Zweck | Regel | Ergebnis bei Nichttreffer |
| --- | --- | --- |
| Seitenueberschrift | Text-Kind des Containers, dessen AutomationId auf `.ClientFrameSSE.ClientHeader` endet | `ueberschrift = null`, `ueberschriftQuelle = "nicht-gefunden"` |
| Suchfeld | Edit innerhalb des Containers, dessen AutomationId auf `SearchSSE` endet | Suchweg entfaellt, `goto` meldet das ausdruecklich |

Die Containerendungen stehen in `page-objects.json` unter `windows.main`,
damit ein kuenftiges Jahr sie ohne Codeaenderung verschieben kann:

```json
"headingContainerAutomationIdSuffix": ".ClientFrameSSE.ClientHeader",
"searchContainerAutomationIdSuffix": "SearchSSE"
```

Beide Jahre tragen dieselben Werte. Das bisherige Feld
`headingAutomationIdSuffix`, das auf den Blattknoten `…ClientHeader.QLabel`
zeigt, entfaellt; es beschreibt nur Engine 31 und traegt 2024 nicht.

**Kein Geometrie-Rueckfall.** Findet die Regel nichts, wird nichts geraten.
Eine geratene Ueberschrift ist schaedlicher als eine fehlende, weil sie in
Segmentaufnahmen als Seitenidentitaet weiterverwendet wird. Das bisherige
Y-Band entfaellt ersatzlos, auch fuer 2025.

Die Navigationsauswahl wird als **eigenes Feld** `navigationAuswahl`
gemeldet, nicht als Ersatzueberschrift. Sie ist eine unabhaengige
Gegenprobe; auf Unterseiten kann sie bewusst von der Ueberschrift abweichen.

### Ehrlicher Profilstatus

`loadProductProfile` lädt `supported` und `experimental`, damit ein noch nicht
freigegebenes Jahr sichtbar und überprüfbar bleibt. Das Manifest trennt
`status` von `operationAccess`. Nur `supported/full` gilt als Releaseprofil;
`experimental/verification-only` erlaubt ohne Opt-in ausschließlich den
Basiskatalog. Die Trennung verhindert, dass eine Statusänderung allein Setup
oder Mutationen öffnet.

2024 trägt `experimental/verification-only`, bis nicht nur der Lese-Smoke,
sondern auch die ausdrücklich gewünschte Operationsfläche live belegt ist.

Verifikationslaeufe brauchen genau die gesperrten Operationen; ohne einen
bewussten Ausweg liesse sich ein experimentelles Jahr nie verifizieren.
Dafuer gibt es das Konfigurationsfeld `operateExperimental: true`. Der
Setup-Wizard schreibt es nie; es ist ausschliesslich fuer Jahresverifikation
und Fixture-Aufnahme gedacht. Die Sperrmeldung nennt das Feld, damit der
Weg sichtbar ist, aber nie stillschweigend beschritten wird.

### Keine Jahresbedingungen im gemeinsamen Code

Ein Vertragstest liest den AST von `powershell/*.ps1` und `src/*.ts` und
verweigert **jahresabhaengiges Verhalten** im gemeinsamen Code: Vergleiche
gegen `profileId`, `SSE_PROFILE_ID` oder `engineFileMajor`, die den
Kontrollfluss verzweigen, sowie Engine-Literale wie
`AAV4GLEngineWindow30/31`. Jahresabhaengiges Verhalten muss aus dem Profil
stammen.

Nicht verboten sind Jahreszahlen, die keinen Kontrollfluss verzweigen. Der
Test fuehrt dafuer eine kurze, begruendete Ausnahmeliste, heute:

- Wertebereiche in Schemata (`taxYear` zwischen 2000 und 2200);
- der dokumentierte Vorgabewert der Profil-ID in `loadProductProfile`;
- Zeichenketten in Meldungen und Tests.

Jede weitere Ausnahme muss im Test begruendet eingetragen werden; das macht
eine neue Jahresverzweigung zu einer bewussten, sichtbaren Entscheidung.

Damit bleibt die Jahresdifferenz an genau einer Stelle sichtbar und kann
nicht unbemerkt in den Dispatcher sickern. Das Repository verwendet dieselbe
AST-Technik bereits im Syntaxvertrag.

### Kuenftige Erweiterung

Sollte ein Jahr abweichen, ohne sich als Profildatum ausdruecken zu lassen,
ist der vereinbarte Weg ein Jahresmodul `profiles/<jahr>/strategies.ps1`
mit einem festen, **rein lesenden** Hooksatz: Hooks erhalten einen bereits
gelesenen Knotenbestand und geben Daten zurueck; UIA-Zugriff, Schreiben,
Dateien, Netzwerk und Prozessstart bleiben ihnen verwehrt, geprueft durch
einen AST-Faehigkeitsvertrag. Die Sicherheitsverträge bleiben auch dann
ausnahmslos im gemeinsamen Dispatcher.

Dieser Weg wird erst gebaut, wenn eine solche Abweichung nachgewiesen ist.
Die Erfahrung aus dieser Analyse spricht dagegen, die Hookform vorab zu
raten: die zuerst vermutete Form (jahresspezifische Geometrieoffsets) war
nach der Messung genau die falsche.

## Softwareupdates

`profile.json` erhaelt `verifiedBuild` mit der Produktversion, gegen die die
Tests dieses Profils zuletzt erfolgreich liefen, zum Beispiel `30.0.127.0`
fuer 2024 und `31.0.1.0` fuer 2025.

Die Produkterkennung hängt weiterhin an der **Hauptversion**; ein Minor-Update
bleibt für Lesen, Diagnose und sicheren Cleanup erreichbar. UI- und
Steuerfallmutationen stoppen dagegen fail-closed, bis der Build erneut geprüft
ist. `health` und `product_info` melden:

```json
"buildDrift": { "verified": "30.0.127.0", "current": "30.0.140.0", "drifted": true }
```

Damit wird ein Update wie das beobachtete 30.0.106 auf 30.0.127 sichtbar.
Nach einem Drift ist der Live-Smoke des Jahres erneut zu fahren und
`verifiedBuild` fortzuschreiben.

## Tests

| Schicht | Quelle | Braucht SSE | Suite |
| --- | --- | --- | --- |
| Strukturregeln auf aufgezeichneten Baeumen beider Engines | `profiles/<jahr>/fixtures/` | nein | schnelle Suite |
| Vertrag „keine Jahresbedingungen im gemeinsamen Code“ | AST von `powershell/`, `src/` | nein | schnelle Suite |
| Live-Smoke auf Musterfaellen | `profiles/<jahr>/tests/expectations.json` | ja, opt-in | `npm run test:live` |

Die Fixtures enthalten je Engine mindestens eine Seite **mit** und eine
**ohne** Ueberschriftscontainer, damit sowohl der Treffer als auch das
ausdrueckliche `nicht-gefunden` gebunden sind. Sie werden aus echten
Baumlaeufen gewonnen und enthalten nur oeffentliche UI-Metadaten, keine
Steuerwerte.

Die Musterfaelle liefert der Hersteller mit jeder Installation
(`musterfaelle/`), fuer 2024 unter anderem fuenf `.ESt2024` und drei
`.Gew2024`. Private Steuerfaelle bleiben ausserhalb des Repositorys.

`test/live-muster-cases.mjs` verdrahtet heute Pfad, Dateinamen und erwartete
Betraege fuer 2025 fest. Diese Angaben ziehen nach
`profiles/<jahr>/tests/expectations.json` um, wodurch derselbe Test jedes
Jahr bedient.

Ein Jahr gilt erst als `supported`, wenn alle drei Schichten bestanden sind.
Das entspricht dem bestehenden Vertrag in `docs/ARCHITEKTUR.md`.

## Leistung

Die Strukturregeln laufen ueber denselben, bereits gelesenen Knotenbestand
wie das bisherige Geometrieband; zusaetzliche Aufrufkosten entstehen nicht.
Es wird kein Jahrescode geladen.

Die separat gemessene Kompilierzeit des Dispatchers von rund 775 ms je
Aufruf bleibt ein eigenstaendiger, offener Punkt ausserhalb dieser Arbeit.

## Nicht im Umfang

- Schreiben auf 2024. Der `focuslessCommits`-Katalog fuer Engine 30 bleibt
  leer, Schreiboperationen scheitern dort fail-closed.
- Jahresmodule `strategies.ps1`. Beschriebener, aber ungebauter Weg.
- Aufteilung des Dispatchers zur Senkung der Aufrufkosten.
- `checker_*`, `collect`, `ustva_*`, `table_*` und Gew2024 auf 2024. Sie
  werden erst geprueft, wenn die Navigation dort traegt.
