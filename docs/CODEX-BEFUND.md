# Historischer Sicherheitsbefund vor der Härtung

> **Nicht der aktuelle Produktstatus.** Dieses Dokument bewahrt den damaligen
> Audit-Befund und seine Begründungen als Entwicklungsnachweis. Die aktuelle
> Implementierung entfernt unter anderem Roh-Tastatur, Versand-Freischalter und
> ungebundene Schreibwege; die ausführbaren Produkt-, Wrapper- und Privacy-Gates
> sind maßgeblich. Aktuelle Grenzen stehen in [Sicherheit](../README.md#sicherheit)
> und [Architektur](ARCHITEKTUR.md#harte-sicherheit).

Der damalige Prüfauftrag ergab: Die zugesicherte harte Versandsperre war zu
diesem Zeitpunkt nicht erfüllt. Gefunden wurden 4 kritische, 7 ernste, 2
mittlere und 1 geringe Schwachstelle.

## Kritische Befunde

### 1. `sse_keys` umgeht die Versandsperre vollständig

**Status:** behoben; `sse_keys` ist nicht mehr als MCP-Werkzeug registriert
und der gleichnamige direkte Worker-Pfad bricht vor jeder Tastatureingabe
fail-closed ab. Notwendige Tasten liegen nur noch innerhalb gebundener
Spezialwerkzeuge.

- **Schwere:** kritisch
- **Historische Fundstellen:** `powershell/sse-worker.ps1:699–708`, `src/index.ts:324–339`
- **Konkreter Auslösepfad:** Wenn „Senden“, „Übermitteln“ oder eine entsprechende Standardschaltfläche fokussiert ist:
  `sse_keys({"keys":"{ENTER}"})`.
  
  Ebenso kann SendKeys mit `%` ein Alt-Menü öffnen, mit `{TAB}` navigieren und mit `{ENTER}` auslösen. Die konkrete Menü-Mnemonik ist aus dem Quellcode nicht bestimmbar.
- **Folge:** Ein Versand kann ohne jede Prüfung von `Test-Versand` ausgelöst werden. Außerdem wird das Ergebnis von `SetForegroundWindow` nicht geprüft; die Tasten können deshalb sogar in einer anderen Anwendung landen.
- **Vorschlag:** `sse_keys` für den Produktionsserver entfernen. Eine Sperrliste einzelner Tastenkombinationen reicht für die Zusicherung „niemals versenden“ nicht aus. Falls Tasten zwingend nötig sind, nur eng definierte nicht-aktivierende Sequenzen zulassen und zusätzlich den Versand auf Anwendung-/Netzwerkebene deaktivieren.

### 2. Die namensbasierte Sperre lässt realistische Varianten und generische Bestätigungen durch

- **Schwere:** kritisch
- **Historische Fundstellen:** `powershell/sse-worker.ps1:93–104`, `:485–510`, `:632–649`
- **Konkrete Auslösepfade:**
  - `sse_click({"name":"Elektronische Steuererklärung (ELSTER)…"})`
  - `sse_click_point({"name":"Jahreserklärungen abschließen…"})`
  - `sse_click({"name":"Belege nachreichen…"})`
  - `sse_click({"name":"Versand per ELSTER"})`
  
  Diese Namen passen weder exakt noch auf die Verben im regulären Ausdruck. Dagegen bleiben `Anmeldungen versenden…` und `Senden & Drucken...` wegen der unscharfen Regeln gesperrt.
  
  Ein weiterer architektonischer Pfad wäre ein Versanddialog mit generischen Schaltflächen:
  `sse_windows({})`, danach `sse_click({"hwnd":<Dialog-HWND>,"name":"Ja"})` oder `"Weiter"`. Ob die aktuelle SSE-Version auf der letzten Versandseite tatsächlich so beschriftet ist, konnte ich ohne Betreten des Versandwegs nicht sicher feststellen.
- **Folge:** Versandseiten können geöffnet und generisch beschriftete Bestätigungen ausgelöst werden. Die Sperre kennt weder aktuellen Dialog noch Elternknoten oder Seitenkontext.
- **Vorschlag:** Mindestens Unicode-Auslassungspunkte und Satzzeichen normalisieren sowie Begriffe wie `ELSTER`, `Versand`, `Übermittlung`, `Abgabe`, `abschließen` und `nachreichen` abdecken. Für eine echte Garantie ist aber eine Positivliste sicherer Aktionen bzw. eine technische Deaktivierung der ELSTER-Kommunikation notwendig.

**Aid/Rid-Ergebnis:** Bei einem erkannten Namen greifen beide Nachprüfungen auch bei `aid` oder `rid` korrekt. Ein exaktes Element „Senden“ kann dadurch nicht einfach per RuntimeId umgangen werden. Ist der UIA-Name jedoch leer oder eine nicht erkannte Variante, helfen die Nachprüfungen nicht:

` sse_snapshot(...)` → RuntimeId des Elements → `sse_click({"rid":"..."})`.

### 3. `sse_click_point({})` darf ein beliebiges unbeschriftetes Element anklicken

- **Schwere:** kritisch
- **Historische Fundstellen:** `powershell/sse-worker.ps1:616–649`, verglichen mit `:485–488`
- **Konkreter Auslösepfad:**
  - `sse_click_point({})`
  - `sse_click_point({"type":"Button"})`
  
  Alle Identifikatoren sind im MCP-Schema optional. Ohne `name`, `aid` und `rid` sucht `Resolve-Nodes` nach leerem Namen. Die Sortierung bevorzugt Buttons; anschließend wird der erste sichtbare Treffer physisch angeklickt.
- **Folge:** Ein unbeschrifteter Button oder ein von Qt schlecht zugänglich gemachtes Element wird ohne Versandprüfung ausgelöst. Das kann jede beliebige UI-Aktion sein.
- **Vorschlag:** Genau einen nichtleeren Identifikator verlangen. Leere Namen für physische Klicks ablehnen. Unbeschriftete Elemente nur anhand einer explizit gepflegten sicheren AutomationId erlauben.

### 4. Parserfehler werden als „nicht übermittelt“ ausgegeben

- **Schwere:** kritisch
- **Historische Fundstellen:** `powershell/akad-parse.py:42–77`, `:131–135`, `powershell/sse-worker.ps1:762–780`
- **Konkrete Auslösepfade:**
  - `sse_list_cases({"dir":"C:\\Faelle"})`, wenn dort eine `fremd.ESt2025` ohne AKAD-Kopf liegt. Der Parser liefert ein `error`-Feld; der Worker ignoriert es und setzt `transmitted=false`.
  - Dasselbe Werkzeug bei einer Falldatei, deren Kopf vor `ElsterTransferTime` beschädigt ist. Die Schleife bricht still ab und setzt anschließend ebenfalls `transmitted=false`.
  - Eine kurze Datei, die nur mit `AKAD` beginnt, löst beim `unpack_from` in Zeile 49 eine Ausnahme aus. Weil alle Dateien in einem Python-Aufruf verarbeitet werden und der Worker den Fehler verschluckt, können anschließend sämtliche Fälle als nicht übermittelt erscheinen.
  - Mehr als 400 Kopfsätze vor `ElsterTransferTime` führen ebenfalls still zu `false`.
- **Folge:** Eine bereits versandte Erklärung kann als „nicht übermittelt“ angezeigt werden. Genau die sicherheitskritische Aussage aus der Werkzeugbeschreibung ist damit nicht belastbar.
- **Vorschlag:** Dreistufigen Status verwenden: `true`, `false`, `unknown`. `false` nur zurückgeben, wenn ein vollständig validierter Kopf `ElsterTransferTime` eindeutig leer enthält. Parserfehler pro Datei isolieren und sichtbar ausgeben; niemals einen fehlenden Parserwert in `false` umwandeln.

## Ernste Befunde

### 5. Die 12-Pixel-Gruppierung kann Beträge der falschen Beschriftung zuordnen

- **Schwere:** ernst
- **Historische Fundstelle:** `powershell/sse-worker.ps1:420–441`
- **Konkreter Auslösepfad:** `sse_read_page({})` bei Knoten mit Y-Werten:
  - `Fahrtkosten`, Y=100
  - zweite Beschriftungszeile, Y=111
  - `Spenden = 500,00`, Y=122
  
  Weil immer nur mit dem vorherigen Element verglichen wird, verbinden die Abstände 11+11 alle drei Elemente transitiv zu einer Zeile.
- **Folge:** Ausgabe etwa `Fahrtkosten :: Fortsetzung :: Spenden = 500,00`; ein Nutzer oder Agent kann 500 Euro den Fahrtkosten zuordnen. Liegen zwei Beschriftungszeilen mehr als 12 Pixel auseinander, wird umgekehrt die erste Zeile abgetrennt und nur die zweite mit dem Wert verbunden.
- **Vorschlag:** Nicht transitiv zum letzten Element gruppieren. Zeilenanker bzw. überlappende vertikale Rechtecke verwenden, Elterncontainer und X-Spalten berücksichtigen und mehrzeilige Beschriftungen vor der Feldzuordnung zusammensetzen. Mehrdeutige Zuordnungen ausdrücklich markieren.

### 6. `Get-ContentBounds` kann Felder still ausschließen oder fremde Inhalte aufnehmen

- **Schwere:** ernst
- **Historische Fundstellen:** `powershell/sse-worker.ps1:261–271`, `:414–423`
- **Konkreter Auslösepfad:** `sse_read_page({})` auf einer Seite mit einem zusätzlichen `Tree` im Formular oder einer formularinternen Schaltfläche namens „Eingabehilfe“. Der erste passende Knoten bestimmt dann `minX` beziehungsweise `maxX`, ohne Prüfung von Elternknoten, AutomationId oder Seitenrolle.
- **Folge:** Labels oder Beträge verschwinden aus der Ausgabe. Beim Rückfall auf 28/79 Prozent können bei geändertem DPI, eingeklappter Navigation oder anderer Seitenleiste entweder rechte Felder abgeschnitten oder Navigation/Hilfe als Steuerdaten aufgenommen werden.
- **Vorschlag:** Navigations- und Hilfebereich über stabile AutomationIds/Elternpfade identifizieren. Grenzen auf Fensterlage, sinnvolle Breite und enthaltene Feldanzahl validieren; bei unplausiblen Grenzen mit `incomplete` abbrechen.

### 7. Leere Tabellenzellen verschieben die Spalten

- **Schwere:** ernst
- **Historische Fundstellen:** `powershell/sse-worker.ps1:451–466`, `src/index.ts:154–169`
- **Konkreter Auslösepfad:** `sse_read_table({})` bei den Spalten `Datum | Text | Betrag`, wenn Qt für eine leere Textzelle überhaupt kein `DataItem` liefert. Ausgegeben wird beispielsweise `["31.07.2026","100,00"]`.
- **Folge:** Der Betrag erscheint positionsmäßig unter `Text`; alle nachfolgenden Spalten sind verschoben. Liefert UIA dagegen ein leeres `DataItem`, bleibt die leere Zeichenkette erhalten – der Fehler hängt daher vom Qt-Provider ab.
- **Vorschlag:** Zellen über `GridPattern`/`TablePattern` oder anhand ihrer X-Position den Header-Spalten zuordnen und fehlende Zellen als `null` einsetzen. Abweichende Spaltenanzahlen nicht ungeprüft zurückgeben.

### 8. UIA-Fehler und abgeschnittene Bäume werden als erfolgreiche Ergebnisse behandelt

- **Schwere:** ernst
- **Historische Fundstelle:** `powershell/sse-worker.ps1:194–255`, insbesondere damalige leere Catches in `:211–229`
- **Konkrete Auslösepfade:**
  - `sse_read_page({})`, wenn das `ValuePattern` eines Betragsfeldes eine Ausnahme wirft. Der Wert wird `null`; bei einem unbeschrifteten Feld verschwindet das ganze Feld.
  - `sse_find({"name":"Steuernummer"})`, wenn der Baumlauf vorher wegen Fehler, 4.000 Knoten oder Zeitlimit abbricht. Das Werkzeug meldet regulär `count: 0`.
  - `sse_read_table({})` bei einem partiellen TreeWalker-Ergebnis; es meldet dennoch `ok:true`.
- **Folge:** „Kein Treffer“ oder ein fehlender Betrag sieht wie ein echtes Ergebnis aus. Die inneren Value-/Scroll-Fehler erhöhen nicht einmal `stats.err`.
- **Vorschlag:** Jeden UIA-Fehler nach Phase erfassen. `truncated`, Zyklen oder fehlgeschlagene Wertabfragen müssen `ok:false`, `kind:"incomplete"` ergeben. `find` und `read_table` müssen die Baumstatistik mitliefern und auswerten.

### 9. Gleichzeitige MCP-Aufrufe sind nicht serialisiert

- **Schwere:** ernst
- **Historische Fundstellen:** `src/worker.ts:42–56`, `powershell/sse-worker.ps1:319–337`, `:616–690`
- **Konkrete Auslösepfade:**
  - Client A: `sse_read_page({})`; gleichzeitig Client B: `sse_click({"name":"Weiter"})`. A kann einen Mischzustand aus zwei Seiten lesen.
  - Historischer Auslösepfad (inzwischen blockiert): `sse_set_value({"rid":"<RuntimeId>","value":"500,00"})`; B scrollt oder wechselt die Seite zwischen dem ersten Baumlauf und `Get-LiveElement`.
  - Zwei parallele `sse_click_point`-Aufrufe verändern denselben globalen Mauszeiger und denselben Vordergrundstatus.
- **Folge:** Falsches Feld, falsche Seite, verlorene Änderung oder Klick auf ein Element, das inzwischen an der alten Koordinate liegt. `click_point` prüft nur die Prozess-ID unter der Koordinate, nicht die Identität des Elements oder selbst das exakte Fenster.
- **Vorschlag:** Einen serverweiten exklusiven Mutex pro SSE-Instanz einführen. Lesen und Schreiben dürfen nicht gleichzeitig laufen. Vor jeder Mutation Fenster-, Seiten- und Elementidentität erneut prüfen.

Bei `Get-LiveElement` ist eine falsche Zuordnung nur möglich, wenn Qt eine RuntimeId nach einer Änderung wiederverwendet. Das konnte ich statisch nicht bestätigen. Ohne Wiederverwendung wird korrekt kein Element gefunden. Der Code validiert einen gefundenen Live-Knoten jedoch nicht erneut gegen Name, AutomationId und Typ.

### 10. `set_value` meldet Erfolg auch ohne erfolgreiche Verifikation

**Status:** behoben; der Name ist heute auf das steuerneutrale globale
Suchfeld begrenzt und verlangt exakten Vor-/Nachwert sowie Interference-Guard.
Fachliche Felder werden vor jeder Mutation blockiert.

- **Schwere:** ernst
- **Historische Fundstelle:** `powershell/sse-worker.ps1:555–560`
- **Konkreter Auslösepfad:** `sse_set_value({"name":"Betrag","value":"2.340,00"})`, wenn die anschließende Wertabfrage scheitert oder einen abweichend interpretierten Wert liefert.
- **Folge:** Die Antwort enthält weiterhin `ok:true`, selbst bei `after:null` oder `after` ungleich `requested`. Ein Agent kann danach den Fall speichern, obwohl die Änderung nicht bestätigt wurde.
- **Vorschlag:** Fehlende oder nicht äquivalente Rücklesung als `verification-failed` behandeln. Das Element neu auflösen und den normalisierten tatsächlichen Wert zwingend vergleichen.

### 11. Die Parserheuristik kann bei beschädigten oder fremden Dateien eine falsche Deutung akzeptieren

- **Schwere:** ernst
- **Historische Fundstellen:** `powershell/akad-parse.py:26–39`, `:55–63`, `:80–109`
- **Konkreter Auslösepfad:** `sse_list_cases({"dir":"C:\\BeschaedigteFaelle"})`, wenn ein Längenwert in einen Datenbereich zeigt, der zufällig wie `<kleine Länge><druckbarer ASCII-Name>\0` aussieht.
- **Folge:** `_plausible_record` prüft nur den nächsten Namen, nicht dessen Typ, Wert und restliche Satzkette. Bei mehreren plausiblen Varianten gewinnt stets die erste. Falls gar keine Variante einen Folgesatz ergibt, wird trotzdem `variants[0]` akzeptiert. Dadurch kann insbesondere `ElsterTransferTime` falsch leer oder nichtleer werden; doppelte Namen überschreiben zudem frühere Metadaten.
- **Vorschlag:** Bekannte Typen deterministisch dekodieren. Unbekannte Typen nur akzeptieren, wenn genau eine Interpretation eine vollständig gültige Folgekette ergibt. Mehrdeutigkeit, Duplikate und unvollständige letzte Sätze als Fehler behandeln.

Für eine intakte Datei mit genau der dokumentierten Typkodierung fand ich keinen Gegenbeweis: Typ 5 und 6 probieren die korrekte feste Länge zuerst, andere Typen die Längenpräfix-Variante. Das Risiko betrifft Beschädigungen, fremde Formate und neue/abweichende Typen.

## Mittlere Befunde

### 12. Die Zyklus- und Zeitsperren sind nur teilweise hart

- **Schwere:** mittel
- **Historische Fundstellen:** `powershell/sse-worker.ps1:177–255`, `:319–337`, `src/worker.ts:62–73`
- **Konkreter Auslösepfad:** `sse_click({"rid":"<RuntimeId>"})`, wenn Qt bei `Get-LiveElement` denselben Geschwisterknoten wiederholt und dessen RuntimeId nicht lesbar ist.
- **Folge:** `Walk-Tree` selbst terminiert algorithmisch durch Knotenlimit/Zeitprüfung, sofern keine einzelne UIA-Funktion blockiert. `Get-LiveElement` besitzt dagegen weder Knoten- noch Zeitlimit; es läuft bis zum äußeren 90-Sekunden-Timeout. Ein blockierender COM/UIA-Aufruf kann auch das interne `TimeoutSec` von `Walk-Tree` umgehen.
- **Vorschlag:** Harte Maximalzahl, Deadline und Identitätsfallback auch in `Get-LiveElement`. Wiederholte Knoten ohne RuntimeId über zusätzliche Identitätsmerkmale erkennen. Einen festgestellten Zyklus als unvollständiges Ergebnis behandeln.

### 13. Der Parser liest die komplette Datei ohne Größenlimit

- **Schwere:** mittel
- **Historische Fundstelle:** `powershell/akad-parse.py:42–50`
- **Konkreter Auslösepfad:** `sse_list_cases({"dir":"C:\\Faelle"})` mit einer sehr großen Datei, deren Name auf `.ESt2025` oder eine andere akzeptierte Endung passt.
- **Folge:** `fh.read()`, große UUID-Slices, Wertdekodierung und JSON-Ausgabe können den Python-Prozess mehrfach in Dateigröße Speicher verbrauchen. Ein Absturz führt anschließend wiederum zum kritischen `transmitted=false`-Fehlermodus. Eine Endlosschleife im Python-Parser besteht dagegen nicht: maximal 400 Iterationen, und gewählte Varianten bewegen den Offset vorwärts.
- **Vorschlag:** Dateigröße begrenzen und nur den Klartextkopf bis `svCrypted` streamen. UUID-, Namen- und Wertlängen vor dem Kopieren strikt begrenzen.

## Geringer Befund

### 14. `sse_health.windows` wechselt bei genau einem Fenster von Liste zu Objekt

- **Schwere:** gering
- **Historische Fundstellen:** `powershell/sse-worker.ps1:367–375`, `src/index.ts:67–78`; damalige Normalisierung in `src/worker.ts:36–40`
- **Konkreter Auslösepfad:** `sse_health({})`, wenn genau ein sichtbares SSE-Fenster existiert.
- **Folge:** Durch PowerShell-Pipeline-Entpackung wird `windows` ein Einzelobjekt statt eines Arrays. Ein Aufrufer mit `windows.length` oder Arrayiteration liegt falsch. `sse_windows`, `snapshot`, `find` und `list_cases` normalisieren ihre Listen bereits mit `asArray`.
- **Vorschlag:** Im Worker `windows = @($wins)` setzen oder auch `sse_health` im TypeScript-Adapter über `asArray` formen.

## Weitere Prüfergebnisse

- Keine weiteren problematischen Parameterzugriffe über `.count`, `.keys`, `.values`, `.clone`, `.item` oder `.length` gefunden. Die verbleibenden `.Count`-Zugriffe betreffen echte Collections; `sse_keys` benutzt sicher `Arg`.
- Die Nachprüfung des aufgelösten Knotennamens existiert in `click` und `click_point` und schützt erkannte Versandnamen auch bei `aid`/`rid`.
- Der frühere direkte Worker-Ausweg über `allowSend` und `confirmSend` wurde
  entfernt. Ein statischer Produkt-Gate-Test verhindert seine Wiedereinführung;
  Versand-/ELSTER-Aktionen bleiben auch bei direktem Worker-Aufruf gesperrt.
- Der TypeScript-Code wurde ohne Ausgabe kompiliert geprüft: 2 Quelldateien, 0 Diagnosen.
- Die Versandvarianten sowie die Y-/Tabellengruppierung wurden mit isolierten, quellcodegleichen Modellen reproduziert.
- Ich habe die reale Steueranwendung, Versanddialoge und Steuerfalldateien bewusst nicht bedient. Der vorhandene Smoke-Test klickt echte UI-Elemente und prüft nur drei exakte `sse_click`-Namen; er deckt `keys`, `click_point`, Varianten, `aid/rid` und Parserfehler nicht ab.
- Es wurden keine Dateien verändert.
