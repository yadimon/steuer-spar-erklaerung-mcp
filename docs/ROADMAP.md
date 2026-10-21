# Was die API kann, was fehlt, und auf welchem Weg

Diese Datei beantwortet drei Fragen: Was ist fertig, was fehlt, und **womit**
liesse sich das Fehlende bauen. Sie ergaenzt zwei erzeugte Dateien und
wiederholt sie nicht:

- **[API-REFERENZ.md](API-REFERENZ.md)** listet alle Operationen, ihre
  MCP-Werkzeuge, ihre Art und ihren Verifikationsstand. Sie wird aus den Quellen
  erzeugt; `npm run docs:build -- --check` erkennt einen veralteten Stand.
- **`test/operation-coverage.json`** haelt fest, welche Operation live belegt
  ist und wo die Grenze der Aussage liegt.

Die [Native-Matrix](NATIVE-COVERAGE.md) ergänzt den Ausführungsstand jeder
Operation. Funktionale Live-Abdeckung und Umstellung auf die Qt-DLL sind
getrennte Zahlen. Hier stehen zusätzlich die Absicht und offene Lücken.

Wer stattdessen eine einzelne Tafel sucht, auf der jede bekannte Faehigkeit mit
ihrem Stand steht - fertig, teils, offen oder bewusst zu -, findet sie in der
[Statustafel](entwicklung/status.md).

Konkrete Aufgaben für Batch-Buchungen, semantisches Tabellenlesen,
Unterbrechungen und reproduzierbare Tests stehen im
[Automations-Backlog](entwicklung/automations-backlog.md), jeweils mit
Abnahmekriterien. Die dort geplanten Funktionen sind noch keine zusätzliche
API-Abdeckung.

## 1. Stand in Zahlen

102 Operationen sind katalogisiert. 94 davon sind in der Live-Suite belegt,
sechs nur auf ihrem Fehlerpfad, zwei ohne automatisierten Live-Suiteschritt.
Dazu gibt es 102 direkte MCP-Werkzeugnamen, ein zusammengesetztes für den
Einstieg und ein API-Lebenszykluswerkzeug, zusammen 104. Die direkten Werkzeuge decken 101 Operationen
ab: `checker_detail` hat kein eigenes Werkzeug, und `tracked_set_value` traegt
deren zwei (`sse_change_field`, `sse_change_known_field`).

Die [Native-Matrix](NATIVE-COVERAGE.md) nennt für jede Operation den direkten
optionalen Qt-DLL-Pfad und seine Grenzen. Dateioperationen brauchen häufig
keine DLL in SSE; die Anzahl nativer Handler ist deshalb kein gewichteter
Fertigstellungsgrad. Der Qt-Pfad verlangt explizite Konfiguration und ein
separates kompatibles Paket. Begrenzte Belegänderungen und Navigation sind
angeschlossen; allgemeine Schreibzugriffe und Speichern bleiben auf den
bestehenden Transaktionswegen.

### Warum die Qt-Umstellung schrittweise erfolgt

Die Qt-Brücke liest QObject-, Accessibility- und Tabellenmodelldaten direkt im
Produktprozess. Das kann zusätzliche Worker-Aufrufe, UIA-Baumläufe und
Cursoraktionen vermeiden. Ziel sind besser begrenzte Abläufe und weniger
Kommunikationsschritte bei gleichbleibender Ergebnisqualität. Eine direkte
Abfrage ist aber weder automatisch schneller noch eine vollständige
Transaktion: Zielbindung, GUI-Thread, Fristen und unbekannte Ausgänge bleiben
zu prüfen. Dateioperationen brauchen dafür häufig überhaupt keine Qt-DLL.

Die vorhandene C#-Bibliothek `sse-native.dll` ist ein Worker-Helfer. Die neue
C++-Brücke `sse-qt-read.dll` arbeitet im Produktprozess; direkte native
Lebenszyklushelfer verwenden wiederum Win32 beziehungsweise COM-UIA. Diese
Wege getrennt zu benennen verhindert, dass ein nativer Build fälschlich als
vollständige Qt-Umstellung gilt.

Für jede weitere Operation gilt derselbe Ablauf:

1. **Vertrag festhalten:** Eingaben, Zielidentität, Vollständigkeit, Seiteneffekte
   und Fehler des bisherigen öffentlichen Wegs benennen. Lese- und Schreibpfade
   getrennt bewerten.
2. **Begrenzt anbinden:** kompatibles Produkt-/Qt-Paket verifizieren und genau
   einen Ausführungspfad wählen. Ein Fehler erlaubt keinen automatischen
   Backendwechsel oder zweiten Schreibversuch.
3. **Synthetisch absichern:** tatsächlichen Dispatcher und Ergebnisprojektion
   auf Erfolg, Mehrdeutigkeit, Zustandswechsel, Fristende und Antwortverlust
   prüfen. Native Komponentenprüfungen müssen zusätzlich reale DLL, Broker
   und Runtime mit dem eigenen Qt-Testprogramm verbinden.
4. **Am Produkt abnehmen:** denselben Ablauf auf Wegwerfkopien prüfen.
   Bei Änderungen gehören vorheriger Zustand, Commit, frischer vollständiger
   Readback, unbeteiligte Daten und bestätigtes Cleanup zusammen. Speichern und
   Wiederöffnen benötigen einen eigenen Persistenznachweis.
5. **Ende zu Ende vergleichen:** dieselbe Methode und denselben Backendmodus
   mehrfach vor und nach der Änderung messen. Kalte Vorbereitung, eigentliche
   Operation und Bereinigung unterscheiden; keine Frist erhöhen, um einen
   Leistungsgewinn vorzutäuschen.
6. **Stand synchronisieren:** erst nach passenden Nachweisen Referenz, Matrix
   und Dokumentation anpassen. Ein implementierter Handler, eine synthetische
   Prüfung und eine erfolgreiche Produktreise bleiben getrennte Aussagen.

Die Schritte sind Abnahmekriterien für weitere Arbeit, keine Behauptung, dass
bereits jede Operation alle Stufen erfüllt. Der [Projektstand](../PROGRESS.md)
nennt verbleibende Grenzen; [VERIFIKATION.md](VERIFIKATION.md) erklärt die
Nachweisarten und [NATIVE-QT.md](NATIVE-QT.md) die technische Einbindung.

Das ist keine Vollstaendigkeit gegenueber dem Produkt, und die Gesamtzahl ist
irrefuehrend, wenn man sie allein liest. **Operationen sind Mechanismen, keine
Flaeche.**

Wichtig ist, was der Seitenkatalog tatsaechlich absperrt – naemlich sehr wenig.
Vom gesamten Operationskatalog verlangen genau **zwei** einen Katalogeintrag:
`fill_fields` (geplante Feldtransaktion mit Rollback) und `known_page_state`
(Vergleich gegen einen hinterlegten Sollzustand). Die folgenden generischen
Mechanismen brauchen keinen Katalogeintrag; damit ist die Bedienbarkeit
aller 672 Seiten noch nicht nachgewiesen:

- **Lesen** ist durchgehend generisch – `page`, `read_page`, `table_read`,
  `positions`, `collect`, `snapshot`.
- **Schreiben** geht auch ohne Katalog: `tracked_set_value` nimmt statt
  `pageId`/`fieldId` auch `name`, `aid` oder `rid`; der Aufrufer liefert dann
  Seitenueberschrift und Erwartungswerte selbst.
- **Tabellen** kennen gar keine `pageId`: `table_add`, `table_update` und
  `table_delete` binden ueber `expectedPage` als Zeichenkette.

`set_value` ist die Ausnahme in die andere Richtung: absichtlich auf das globale
Suchfeld beschraenkt, weil ein direkter ValuePattern-Write Qt-Commit,
Ergebnis-Diff und Seitenobjekte umgehen wuerde.

**Nicht jede Seite profitiert von einem Katalogeintrag.** Ein linearer
Durchlauf eines ESt-Musterfalls lässt sich mit `goto` und `snapshot`
klassifizieren. Die Seitenlandkarte ordnet 55 von 58 Seiten ein:

| Bauart | Anzahl | Bringt ein Seitenobjekt etwas? |
| --- | --- | --- |
| **Feldseite** – beschreibbare Einzelfelder | 31 | ja, genau dafuer ist der Katalog da |
| **Uebersicht** – nur Rechenfelder und Text | 14 | nein, es gibt nichts zu schreiben |
| **Tabellenseite** – Daten in Zellen | 7 | nein, `table_add`/`table_update`/`table_delete` binden ueber die Ueberschrift |
| **Auswahlseite** – nur RadioButtons | 3 | nein, RadioButtons bleiben Hinweis fuer `click pattern=select` |

Rund **die Haelfte** der Seiten ist also Feldseite. Die Luecke zwischen zweiundzwanzig
katalogisierten und dem Bestand ist damit real - anders als eine erste,
kleinere Stichprobe nahelegte.

**Diese Zahl hat Grenzen, und sie gehoeren dazu:**

- Eine erste Stichprobe von 20 Seiten kam auf nur vier Feldseiten. Sie lief
  durch eine tabellenlastige Region des Dokuments; wer wenige Seiten am Stueck
  misst, misst die Nachbarschaft, nicht das Ganze.
- ComboBoxen zaehlen doppelt: UIA meldet die Box und ein inneres `Edit`. Die
  Feldzahl je Seite ist daher eine Obergrenze.
- `ro=false` heisst „nicht schreibgeschuetzt", nicht „Benutzereingabe". Auf
  Ergebnisseiten wie der Steuerberechnung ist unbelegt, ob die gezaehlten
  Felder wirklich Eingaben sind. Stichprobe `Grunddaten` (Identnummer, Anrede,
  Name, Telefon, Geburtsdatum, Adresse) war dagegen eindeutig echt.
- Gemessen wurde **ein** Musterfall. Welche Seiten ueberhaupt erscheinen,
  entscheiden dessen Themenfilter.

**Und die Module sind verschieden gebaut.** Dieselbe Messung an der
Gewinnermittlung (30 Seiten ab `Beitraege, Gebuehren und Abgaben`) kehrt das
Verhaeltnis um:

| Bauart | Einkommensteuer | Gewinnermittlung |
| --- | ---: | ---: |
| Tabellenseite | 7 von 55 | **20 von 30** |
| Feldseite | **31 von 55** | 3 von 30 |
| Uebersicht | 14 | 6 |
| Auswahlseite | 3 | 1 |

Betriebsausgaben sind Belegzeilen, keine Einzelfelder. Ein Seitenobjekt ist in
der Gewinnermittlung deshalb ein **schwacher** Hebel - dort arbeiten
`table_add`, `table_update` und `table_delete` schon ohne Katalog. Wer Aufwand
in Seitenobjekte steckt, sollte ihn in die Einkommensteuer stecken. Die
vollstaendigen Listen stehen in der
[Seitenlandkarte](entwicklung/seitenlandkarte.md).

Die Klassifikation selbst ist billig und wiederholbar: ein `snapshot` mit
`types: ["Edit","ComboBox","CheckBox","DataItem","RadioButton"]`, getrennt nach
Steuerelementtyp und `ro`-Kennzeichen. Eine Falle steckt darin: **RadioButtons
duerfen nicht als Felder zaehlen.** Sie sind im Profilvertrag ausdruecklich kein
`fields`-Eintrag, sondern ein Hinweis fuer `sse_click pattern=select`; wer sie
mitzaehlt, haelt jede Auswahlseite faelschlich fuer eine Feldseite.

Der Katalog ist trotzdem klein. `profiles/2025/page-objects.json` enthaelt heute
**zweiundzwanzig Seiten und fuenf Fenster**: dreizehn aus der Einkommensteuer
(Vorsorge, Spenden, Kapitalverluste, Werbungskosten-Fahrten, Riester,
Zusatzangaben, drei Themenfilter und vier ELSTER-Seiten von den Grunddaten bis
zum Antrag auf Anpassung der Vorauszahlungen), sieben aus der Gewinnermittlung
- darunter neu die Umsatzsteuer-Jahreserklaerung -, zwei aus der
Gewinn-Erfassung. Es gibt genau
**einen** profilierten fokuslosen Schreibpfad.

Wer also fragt „koennen wir SSE vollstaendig steuern?", bekommt eine
zweigeteilte Antwort: Die *Reichweite* ist nicht auf katalogisierte Seiten
beschränkt; jede konkrete Bindung muss trotzdem stimmen. Auf einem privaten Desktop
schreibt dagegen nur der eine profilierte Focusless-Pfad; alles andere stoppt
dort fail-closed mit `hidden-desktop`. Was fehlt, ist *hinterlegtes Wissen ueber die Oberflaeche*:
stabile Namen, Beschriftungen, Wertarten, Sollzustaende und der geplante
Mehrfeld-Schreibweg. Ein Katalogeintrag verwandelt „der Aufrufer muss die
Seite kennen" in „die API kennt sie".

## 2. Die Bauwege

Jede neue Faehigkeit muss einen dieser Wege nehmen. Die Wahl bestimmt Kosten,
Risiko und ob der Benutzer dabei zusehen muss.

| Weg | Was er kann | Was er kostet | Wo er heute traegt |
| --- | --- | --- | --- |
| **Fokusloses UIA-Lesen** | Baum und Einzelwerte lesen, ohne den Vordergrund anzufassen | ein Baumlauf ist teuer, gezielte Bindung ueber AutomationId ist billig | Seitenlesen, Tabellen, Pruefer, Fallbindung |
| **Fokusloses Schreiben** | Werte in ausdrücklich profilierten Feldpfaden schreiben, mit Commit und Readback | auf privatem Desktop nur für freigegebene Focusless-Pfade; generische Selektoren erweitern diese Freigabe nicht | ein profilierter Feldpfad; `tracked_set_value` und `fill_fields` behalten ihre Grenzen |
| **Vordergrund-Lease mit physischer Eingabe** | Qt-Steuerelemente bedienen, die kein brauchbares UIA-Muster anbieten | braucht eine ausdrückliche Freigabe und eine unbenutzte Sitzung; öffentlich gesperrte Wege bleiben gesperrt | `click`, `combo_select`; neun BelegManager-Wege sind nur über die interne Test-Lease erreichbar |
| **C#-Worker-Helfer (`sse-native.dll`)** | Fensteraufzaehlung, Prozesskommandozeile, MSAA-Punktprobe, UIA-Baumlauf, Controller-Lease | bleibt Teil des bisherigen Worker-Pfads; nicht die Qt-Brücke in SSE | bestehende UIA-/Win32-Operationen |
| **C++-Qt-Brücke (`sse-qt-read.dll`)** | frische QObject-Werte, begrenzte Tabellenmodelle und Qt-Accessibility-Bäume im SSE-Prozess | exakte Produkt-/Qt-Bindung, GUI-Thread, Controller-Lease und dauerhaft gebundener Transport | optional die direkt angeschlossenen Operationen der [vollständigen Matrix](NATIVE-COVERAGE.md) |
| **Direkte native Lebenszyklushelfer** | Desktopstatus und eigentumsgebundener Prozessstart über Win32; Stop über Win32 und begrenztes COM-UIA | Produkt-/Markerprüfung, atomare Prozesszuordnung, verifizierte Bereinigung; reale Dialogvarianten brauchen eigene Nachweise | optional `desktop_status`, `desktop_start`, `desktop_stop` |
| **Dateiebene** | Falldateien hashen, sichern, archivieren, Kopien binden | keine UI noetig, aber auch kein Blick in den Inhalt | `case_hash`, `backup_cases`, `archive_cases` |
| **OCR** (`Windows.Media.Ocr`) | Text aus Bildern lesen | Erkennungsqualitaet ist nicht zusicherbar | Belegbilder |
| **PDF-Aufbereitung** (`render-pdf.ps1`) | PDF-Seiten rendern und lesen | eigener Prozess, eigene Grenzen | Belegdokumente |
| **Hersteller-IPC** | direkte, typisierte Kommandos statt Oberflaechenbedienung | **derzeit geschlossen**, siehe Abschnitt 4 | – |

## 3. Offene Luecken

Jede Zeile nennt, warum sie offen ist und welcher Weg sie schliessen wuerde.
Was hier fehlt, ist bewusst nicht erfunden: die Liste enthaelt nur Luecken, die
im Repository belegt sind.

| Luecke | Warum offen | Weg | Was dafuer noetig ist |
| --- | --- | --- | --- |
| **VaSt vollständig** – die sechs Wege `vast_apply`, `vast_dialog_read`, `vast_mapping_options`, `vast_mapping_select`, `vast_row_details`, `vast_row_set_expanded` | das Live-Ledger belegt ausschließlich Fehlerpfade, keinen erfolgreichen Datenabruf | bestehender gebundener Produktweg | ein eigener zulässiger Ende-zu-Ende-Nachweis mit kontrollierten Voraussetzungen; Zugangsdaten und Abrufdaten bleiben außerhalb von Git |
| **BelegManager ohne Vordergrund** – neun der zehn Wege | öffentlich ist nur `receipt_manager_list` freigegeben; ein nativer Handler hebt die globale Vordergrundsperre nicht auf | Qt-/Modellzugriff mit eigenem Interaktionsvertrag | Nachweis stabiler Auswahl, Detailbindung, Commit und Readback ohne globale Eingabe sowie eine ausdrücklich geprüfte Freigabeänderung |
| **Steuerjahr 2024 im Vollbetrieb** | Profil steht auf `experimental` mit `verification-only`; nur mit ausdruecklichem Opt-in erreichbar | vorhandene Wege, neues Profil | vollstaendige Live-Verifikation gegen Engine 30, wie sie fuer 2025 vorliegt |
| **Steuerjahr 2026** | im Repository gibt es kein freigegebenes Profil | vorhandene Wege, neues Profil | Produkt-/Buildbindung, Katalog und eigene Live-Verifikation; das Vorhandensein eines Herstellerprodukts allein ist keine Freigabe |
| **Ausgabe ausser CSV** | es gibt genau `export_csv` | Vordergrund-Lease fuer den Druckdialog, danach PDF-Aufbereitung | Entscheidung, ob ein Druck-nach-PDF-Weg die Mutationsgrenze beruehrt |
| **Weitere schnelle native Operationen** | Qt-Pfade und drei direkte native Lebenszykluspfade gemäß aktueller Matrix vorhanden; weitere öffentliche Handler fehlen | Qt-Brücke für UI/Modell, direkte Systemzugriffe für Dateien/Lebenszyklus | vollständige Ergebnisparität, Commit/Readback, unbekannte Ausgänge und Ende-zu-Ende-Messung; siehe [Native-Matrix](NATIVE-COVERAGE.md) |
| **`headingPrefix` trägt zwei Rollen** – Suchbegriff für `goto` und Präfix für die Seitenbindung können unterschiedliche Werte benötigen; ähnliche Überschriften können die Suche auf einen Nachbartreffer führen | beide Rollen wollen verschiedene Werte | Bindungsregel | ein eigenes Feld für das Navigationsziel, getrennt vom Bindungspräfix |
| **Kaltes `goto` per `pageId` kann in der Gewinnermittlung scheitern** – ein verifiziertes Zwischenziel kann erforderlich sein | ungeklärt, ob Fallaufbau, Suchtreffer oder Blättertiefe die Ursache sind; die Feldbindung selbst ist davon nicht betroffen | Messung, dann Navigationsweg | Erreichbarkeit auf weiteren Herstellermusterfällen prüfen und erforderliche Zwischenziele im Profil festhalten |
| **Seiten, deren Felder sich nicht eindeutig adressieren lassen** – etwa `Kapitalertraege, ermaessigt besteuert`: Die Felder beider Ehepartner tragen im adressierbaren Endstueck denselben Pfad, unterschieden werden sie erst weiter oben im Baum | ein Seitenobjekt braucht je Feld genau einen Treffer; hier waeren es zwei | UI, aber zuerst die Bindungsregel | entweder laengere Pfade im Seitenobjekt zulassen oder die Bindung um eine Positionsangabe erweitern |
| **Seiten mit Nummer in der Mitte der Ueberschrift** – etwa die Verpflegungspauschbetraege einer Fortbildungsreise (`Fortbildung <Name>: <N>. Reise (Verpflegung)`, zehn beschreibbare Felder) | die Bindung kennt zwei Muster: `headingNumberedLabel` erwartet ein fuehrendes `N. Label`, `headingPrefix` einen festen Anfang. Hier steht die Nummer in der Mitte und der Personenname davor; ein Praefix `Fortbildung ` wuerde jede Fortbildungsseite jeder Person treffen | UI, aber zuerst die Bindungsregel | ein drittes Muster fuer Ueberschriften mit Platzhaltern an beliebiger Stelle - und der Nachweis, dass es nicht versehentlich die Nachbarseite bindet |

### API und MCP: Shutdown

`POST /v1/control/shutdown` beendet ausschliesslich die gebundene API und ihre
Reservearbeiter. Der Aufruf verlangt `Content-Type: application/json`,
`x-sse-api-instance-id` aus `/healthz` und den Koerper
`{"confirm":true,"instanceId":"<instanceId aus healthz>"}`. Paket, Version und
Konfiguration vor dem Stopp pruefen. Loopback- und Browser-Sperren gelten auch
hier. Bei einem laufenden Auftrag kommt `busy`; eine Tabellenmutation wird
nicht abgebrochen. Annahme und Sperre weiterer Auftraege sind atomar.

HTTP 202 meldet `accepted=true` und `processExited=false`: Die Annahme allein
beweist noch kein Prozessende. Ein verlorener Antwortkanal bedeutet einen
unbekannten Ausgang und erlaubt keinen blinden zweiten Stoppauftrag. SSE und
Steuerfaelle bleiben offen; Speichern, Verwerfen und Schliessen sind kein Teil
dieses Kommandos.

MCP bietet dafuer `sse_api_control`:

1. `{"action":"status"}` liefert Zustand, Instanz und Prozesskennung.
2. Nach ausdruecklichem Stoppauftrag
   `{"action":"shutdown","confirm":true,"instanceId":"<gelesene Instanz>"}`
   senden. `accepted` und `processExited` getrennt auswerten. Bei `unknown`
   oder `stopping` zuerst wieder `status` lesen.
3. MCP bleibt erreichbar. Normale Werkzeuge melden nach absichtlichem Stopp
   `api-stopped`, ohne die API neu zu starten.
4. Ein eigener Neustartauftrag verwendet
   `{"action":"start","confirm":true,"instanceId":"<gestoppte Instanz>"}`.
   Erst nach bewiesenem Prozessende wird die urspruengliche, unveraenderte
   Konfiguration verwendet und eine neue Instanz gebunden. Eine Ersatzinstanz
   am Port wird weder uebernommen noch beendet. Bei ausschliesslicher Bindung
   ueber `SSE_API_URL` ist die Startkonfiguration unbekannt; die separat
   verwaltete API muss mit ihrer eigenen Konfiguration gestartet werden.

Die Umsetzung liegt in [`src/api-server.ts`](../src/api-server.ts),
[`src/api-runtime.ts`](../src/api-runtime.ts) und
[`src/mcp-api-supervisor.ts`](../src/mcp-api-supervisor.ts). `npm test` enthaelt
die HTTP-, Prozess- und MCP-Vertraege: falsche Identitaet, laufende Auftraege,
konkurrierende Stopps, Antwortverlust, Reservearbeiter-Cleanup und ausdruecklichen
Neustart. Diese Tests verwenden ausschliesslich eigene API-Prozesse.

### 3.1 Produktumfang und öffentliche API

Herstellerfunktionen, interne Kommandonamen und öffentlich ausführbare
API-Operationen sind unterschiedliche Dinge. Nur Operationskatalog, Dispatcher
und Ergebnisvertrag zeigen, was dieser Adapter tatsächlich anbietet. Ein im
Produkt gefundener Symbolname oder ein interner Testpfad ist keine öffentliche
Freigabe.

Die [Statustafel](entwicklung/status.md), das
[Aktionsinventar](entwicklung/aktionsinventar.md) und der
[Funktionskatalog](entwicklung/funktionskatalog.md) ordnen weitere Produktbereiche
ein. Beispiele sind Druckdialoge, Datenübernahme, Passwortdialoge und zusätzliche
Steuermodule. Vor einer Erweiterung braucht jeder Bereich einen eindeutigen
Ziel- und Interaktionsvertrag sowie eigene Nachweise. Allgemeine Operationen
wie `menu` oder `snapshot` belegen noch keinen sicheren fachlichen Ablauf in
jedem dieser Bereiche.

## 4. Der Hersteller-IPC-Weg und warum er zu ist

Die öffentliche Runtime bietet kein Hersteller-IPC-Backend an. Interne
Kommandonamen oder mögliche Nachrichtenprotokolle sind deshalb kein
unterstützter Zugriffspfad und kein automatischer Ersatz bei einem Fehler.
Eine spätere Herstellerintegration müsste als eigener Vertrag mit nachweisbarer
Produktkompatibilität, Zielbindung und Ergebnisprüfung entstehen.

Der eigene optionale [Qt-Pfad](NATIVE-QT.md) ist davon unabhängig: Er verwendet
die implementierte Brücke und das separat gebaute, kompatible Paket. Seine
Handler und verbleibenden Lücken stehen in der
[Native-Matrix](NATIVE-COVERAGE.md).

## 5. Dauerhaft geschlossen

Diese Punkte sind keine Luecken, sondern Grenzen. Sie werden nicht geoeffnet.

- **ELSTER und jede andere Uebermittlung ans Finanzamt.** Es gibt keine
  Operation dafuer, und es soll keine geben.
- **Automatisches Speichern.** Aendern erlaubt kein Speichern; der Zeitpunkt
  bleibt beim Benutzer.
- **Arbeiten am Originalfall ohne bestaetigte Bindung und hashverifizierte
  Sicherung.**
- **Umgehen der Build-Sperre.** Nach einem Produktupdate bleiben die
  mutierenden Operationen gesperrt, bis der neue Build live nachverifiziert
  ist. Es gibt bewusst keinen Schalter dagegen.
- **Steuerberatung.** Die API bedient ein Programm; sie beurteilt nichts.
