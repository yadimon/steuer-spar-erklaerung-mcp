# Verifikationsstand

Stand: 2026-08-16

Dieses Dokument trennt veröffentlichte Verträge, Mock-/Quelltests und echte
SSE-Läufe. Ein grüner Vertragstest beweist nicht automatisch, dass jede
UI-Operation auf jeder Jahresversion praktisch funktioniert.

## Produkt- und Supportmatrix

| Profil | Status | Verifizierter Build | aktuelle Kern-Leseevidenz | vollständige Navigation/Prüfer/UStVA | allgemeine Schreibpfade | profilierter Focusless-Commit |
| --- | --- | --- | --- | --- | --- | --- |
| `2025` | `supported` | `31.0.1.0` | striktes Live-Gate grün: beide offiziellen Musterfälle, 47 semantische Prüfungen und 38 geforderte Operationen | Navigation, Prüfer und UStVA im strikten Gate grün | fünf getrennte Mutationstests plus große Schreibreise grün; keine vollständige VaSt-/Center-Matrix | profilierter Commit im strikten Gate grün |
| `2024` | `experimental` | `30.0.127.0` | Opt-in-Live-Gate grün: beide offiziellen Musterfälle, 43 semantische Prüfungen und 38 geforderte Operationen | Navigation, Prüfer und UStVA-Read im strikten Gate grün; daraus folgt keine Freigabe | nicht freigegeben und im Gate als gesperrt geprüft | keiner |

`experimental` bedeutet: Das Profil darf weder vom Setup angeboten noch wie
ein produktiv unterstütztes Jahr behandelt werden. Der Opt-in dient nur der
gezielten Verifikation. Er ist keine Nutzerfreigabe für unbewiesene
Steuerdatenänderungen. API und direkter Worker begrenzen den Opt-in auf
paritätsgetestete Kataloge für Lesen, Navigation, Prüfer/UStVA-Read sowie den
nötigen Wegwerfkopie-Lebenszyklus; Tabellen-, Steuerdaten-, Speicher-, Export-
und VaSt-Mutationen bleiben mit `profile-operation-unverified` gesperrt.
`dialog_answer` gehört nicht zum allgemeinen Katalog: Nur `OK` auf der exakt
titel-, text- und schaltergebundenen passiven Gewinnaktualisierungsnotiz darf
die Worker-Prüfung erreichen. Insbesondere eine Wiederherstellungsdatei wird
nie automatisch verworfen.

## Was die Tests beweisen

| Ebene | Befehl | Beweis | Nicht bewiesen |
| --- | --- | --- | --- |
| Schnell | `npm run test:fast` | Build, vollständiger Operations-/Toolkatalog, strikte Eingaben, Auth-/Transportgrenzen, Mock-Journeys, Sicherheits- und Quellverträge | reale SSE-UI |
| Vollständig offline | `npm test` | zusätzliche Packaging-, Worker-, Timeout-, Cleanup- und No-Console-Verträge sowie die Abdeckungsbilanz | reale SSE-UI; optionale Fixtures können fehlen |
| Core-Read-Live-Gate | `npm run test:live-core-read` | beide Profile und ihre offiziellen Musterfälle über MCP→API→Worker: Produkt-/Arbeitsbereich, Hash/Arbeitskopie, Start/PID/HWND, Ergebnislesen, HTTP↔kanonisches-MCP, Seiten-/Hilfe-/Tabellen-/Snapshot-/Accessibility-Leser und gebundener Discard-Close | physische Bereichsnavigation, Prüfer, UStVA, Tiefensweep und Steuerfall-Schreibwege |
| Striktes Live-Gate | `npm run test:live` | beide Profile nacheinander, jede vom Profil erlaubte Leseoperation, der profilierte Schreibweg, die große Schreibreise, echter MCP→API→Worker-Weg, direkter HTTP↔kanonischer MCP-Vergleich, Hash- und Cleanup-Invarianten; fehlende Voraussetzungen sind Fehler | vollständige Mutationsmatrix |
| Große Schreibreise | `npm run test:live-journey` | eine zusammenhängende Reise auf einer Wegwerfkopie: Tabellenschreibzyklus mit Kontrollsummen-Readback, hashgebundenes Speichern mit Datei- und Neustart-Persistenzbeweis, UStVA-Schreibquartett mit Zahllast-Kontrolle, CSV-Export bis zur Datei, Menü-/Fenster-/Dialogverwaltung, Speichern unter und Archiv | VaSt-Dialogwege, Steuertipps-Center |
| Einzelprofil-Live | `npm run test:live-muster` | gezielter profilabhängiger Musterlauf für Diagnose | das jeweils andere Profil |
| Focusless | `npm run test:hidden-focusless` | ein konkret profiliertes 2025-Feld mit Feld-/Summen-/Dirty-State-Readback; im strikten Gate enthalten | andere Felder; 2024; sichtbare Tabellen-/Combo-Pfade |

Der Laufzeitkatalog ist die Quelle für die aktuelle Anzahl und Benennung der
Operationen. Am genannten Stand enthält er 87 API-Operationen und 87
MCP-Werkzeugnamen. Das sind nicht 87 eindeutige Eins-zu-eins-Zuordnungen:
`sse_change_field` und `sse_change_known_field` rufen beide
`tracked_set_value` auf; `checker_detail` ist eine API-interne Komposition von
`sse_checker_open`.

Alle Operationen besitzen getestete Eingabeschemata und einen versionierten
`Result_<operation>`-Mindestvertrag. API, Discovery, OpenAPI und alle
MCP-`outputSchema`-Definitionen verwenden diesen Katalog; ein malformed
Worker-Ergebnis wird vor der Ausgabe mit `invalid-operation-result` gestoppt.
Die Schemas bleiben für zusätzliche Fachfelder offen. Deshalb ist „alle
Operationen transportseitig validiert“ weiterhin nicht mit „jede mögliche
UI-Ergebnisvariante live erzeugt“ gleichzusetzen.

## Abdeckungsbilanz aus echter Ausführung

`test/operation-coverage.json` ist keine handgepflegte Behauptung: Die
verhaltenstragenden Testharnische protokollieren jede Operation, die einen
echten API-Executor erreicht, und der letzte Schritt von `npm test` vergleicht
das Protokoll mit dem Katalog. Die Bilanz ist eine Ratsche in beide
Richtungen – verschwundene Abdeckung ist eine Regression, neue Abdeckung muss
mit `SSE_WRITE_OPERATION_COVERAGE=1` bewusst übernommen werden.

Gezählt wird nur der API-Rand. Operationen, die eine Komposition oder ein
Szenario intern aufruft, gelten damit nicht automatisch als geprüft; sie
brauchen einen eigenen Aufruf über die HTTP-Grenze.

Stand: alle 87 Operationen werden im Offline-Lauf mindestens einmal
erfolgreich ausgeführt – überwiegend gegen den zustandsbehafteten
synthetischen Worker, der Seitengraph, Elementbaum, Tabelle, Menü, VaSt-Dialog
und Fenster-/Desktopzustand modelliert. Das beweist Argumentbindung,
Ressourcenauflösung, Komposition, Ergebnisvertrag und Redaktion über die
gesamte Kette. Es beweist ausdrücklich **nicht** die proprietäre UIA-Schicht;
dafür zählt allein die Live-Spalte derselben Bilanz, die `npm run test:live`
gegen die installierte Anwendung füllt. Dort stehen seit dem strikten Lauf vom
2026-08-16 78 der 87 Operationen. `collect` ist zusätzlich live auf seinem
dokumentierten, dateischreibenden `collection-incomplete`-Fehlerpfad belegt.
Die acht noch nie erfolgreich live aufgerufenen Operationen sind
`center_cases`, `center_refresh` sowie die sechs VaSt-Wege `vast_apply`,
`vast_dialog_read`, `vast_mapping_options`, `vast_mapping_select`,
`vast_row_details` und `vast_row_set_expanded`.

### Die Freigabepolitik liest die Live-Bilanz nicht

Das gehört ausdrücklich hierher, weil es leicht zu überschätzen ist: Die
Abdeckungsbilanz ist **Dokumentation, keine Laufzeitsperre**. Ein Profil mit
`status=supported` und `operationAccess=full` gibt alle Operationen frei –
unabhängig davon, ob sie jemals erfolgreich gegen die echte Anwendung
gelaufen sind. Gemessen am 2026-08-16 sind noch 9 der 87 Operationen nicht
live-funktional belegt: der genannte `collect`-Fehlerpfad und acht ungetestete
Wege. Zwei davon (`vast_apply`, `vast_mapping_select`) fallen in die Klasse
`destructive`.

Das ist kein Widerspruch zu den Sicherheitszusagen: Jede dieser Operationen
trägt weiterhin ihre eigenen Vor- und Nachbedingungen, die Hash-, Fenster-
und Readback-Bindung sowie die Versandsperre. Es heißt aber, dass „vom Profil
freigegeben" und „live bewiesen" zwei verschiedene Aussagen sind. Wer die
Live-Spalte als Freigabeliste liest, liest sie falsch. Eine Kopplung beider
Ebenen wäre möglich – sie ist bewusst noch nicht gebaut, weil eine
Laufzeitsperre auf Basis einer Testdatei den umgekehrten Fehler erzeugen kann:
eine funktionierende Operation zu blockieren, weil das Gate zuletzt an einer
fremden Benutzereingabe gescheitert ist.

Der aggregierte Wert ersetzt keinen Jahresnachweis: Das strikte Live-Gate
fordert zusätzlich für **jedes** Profil 37 erfolgreiche, profilmarkierte
Worker-Aufrufe aus dem expliziten Lese-/Navigationsvertrag – darunter
Ergebnislesen, Snapshot/Accessibility, Prüfer, UStVA sowie die hashgebundene
Wegwerfkopie. Eine erfolgreiche Ausführung des jeweils anderen Jahres kann
diese Pflicht nicht erfüllen.

Die Bilanz berichtet außerdem die teuersten Operationen eines Laufs. Der
Befund ist eindeutig: Auch rein lokale Auskünfte zahlen den vollen Preis eines
frischen PowerShell-Prozesses – `case_hash` braucht rund 1,2 s je Aufruf, ohne
die Oberfläche überhaupt zu berühren. Wer viele Fälle prüft, sollte das
einplanen; die Zahl ist gemessen, nicht geschätzt.

## Aktuelle Live-Muster-Evidenz

`npm run test:live-core-read` ist der reproduzierbare, fallunverändernde
Basisnachweis. Am 2026-08-14 lief er erfolgreich für 2025 und 2024 (bei 2024
mit dem engen Verifikations-Opt-in), jeweils gegen beide offiziellen
Musterfälle. Pro Profil prüfte er 21 semantische Aussagen und beendete alle
gestarteten SSE-Instanzen. Er überspringt nicht still: Sein JSON-Ergebnis
nennt die vier bewusst nicht enthaltenen Bereiche
`cross-section-navigation`, `ustva-read`, `checker` und `deep-read-sweep`.

Das strikte `npm run test:live` bleibt der weitergehende Nachweis für diese
vier Bereiche und die profilierten Mutationsfixtures. Es wird nicht durch das
Core-Read-Gate ersetzt. Am 2026-08-16 bestand es für beide Profile ohne SKIP
und ohne verbleibende SSE-Instanz. Die Foreground-Lease funktionierte in
diesem Lauf. Wird sie durch Benutzereingabe oder einen fremden
Vordergrundprozess verloren, meldet der Worker weiterhin `interference`
**vor** Mausinput; ein möglicherweise wirkungsloser Klick kann damit nicht als
erfolgreiche Navigation gelten.

## Strikter Live-Muster-Sweep

Der Sweep startet ohne vorhandene SSE-Instanz. Er kopiert jeden offiziellen
Musterfall in den isolierten Test-Fallbereich, erzeugt daraus eine zweite
Arbeitskopie, bindet PID/HWND, liest ausschließlich, schließt mit Verwerfen
und prüft den unveränderten SHA-256. Testkopien werden erst nach bestätigtem
Prozessende entfernt. Bleibt ein PID-gebundener Schließvorgang nach seinem
Client-Timeout noch aktiv, wartet der Sweep auf den Abschluss; bei weiterhin
unklarem Zustand erhält der Live-Runner seine isolierte Sandbox als
Diagnoseartefakt statt sie still zu löschen.

Welche Operationen der Sweep versucht, entscheidet nicht der Test, sondern die
Fähigkeitsmatrix aus `sse_capabilities`. Alles, was das aktive Profil erlaubt
und keinen Steuerfall verändert, wird ausgeführt; alles andere muss die Matrix
ausdrücklich als gesperrt ausweisen. Ein stiller `SKIP` ist damit ausgeschlossen –
ein Profil kann keine Prüfung mehr dadurch verlieren, dass sie einfach ausbleibt.

Er umfasst derzeit unter anderem:

- Produkt-/Fallhash, Kopie, Start, Dialoginventar und gebundener Close;
- Fenster-/Seitenzustand, Ergebnisse, Seiten-, Vollseiten-, Hilfe- und
  Tabellenleser;
- Navigation, Unterseiten, Suche, Roll- und Baumzustand;
- katalogisierten Seitenzustand samt Inhaltsfingerprint, Einzelwertlesung,
  Positionen, Seitenprüfung und Auswahllisten;
- Prüferlauf, Prüferergebnis, gebundenes Öffnen einer Meldung, Reset und Close;
- UStVA-Zeitraum und Betragsreadback ohne Speichern oder Übermittlung;
- Element-Snapshot, Accessibility-Probe und Vergleich des sicheren
  TreeWalker-Pfads mit dem Bulk-Snapshot;
- Sammellauf, hashgebundenen Soll/Ist-Abgleich, Kontrollbild und Fallsicherung
  in die isolierten Test-Ressourcenbereiche;
- einen zweistufigen, rein lesenden Szenariolauf samt Abschlussschritt und
  hashgebundenem Ergebnisbericht.

Genau dieser Sweep hat drei Operationen aufgedeckt, die gegen die echte
Anwendung nie funktioniert haben: `backup_cases`, `known_page_state` und
`goto` auf die bereits offene Seite endeten jedes Mal mit
`invalid-operation-result`, weil ihr veröffentlichter Ergebnisvertrag einen
anderen Typ versprach als der Worker lieferte – eine Anzahl statt einer Liste,
ein Fingerprint statt einer Zahl, ein Text statt einer Liste. Alle drei waren
zuvor grün, aber eben nur schematisch geprüft. Ein Ergebnisschema ohne echten
Aufruf ist deshalb keine Zusicherung.

Ebenfalls belegt: Der Sprung über die globale Suche aktiviert den Treffer im
Vorbereitungszweig reproduzierbar nicht – der Doppelklick verpufft und `goto`
meldet korrekt `not-found`. Der gleichnamige Eintrag im Navigationsbaum führt
dagegen zuverlässig zum Ziel. Der Sweep nimmt deshalb diesen Weg; er ist damit
zugleich der einzige Live-Beleg für `click_point`.

`snapshot_compare` kann auf Engine 30 über unmittelbar benachbarte
Messpaare hinweg einen echten Leserunterschied melden. Das Profil verwendet
deshalb fünf statt drei Wiederholungen. Im Lauf vom 2026-08-14
fehlten dem Bulk-Snapshot fünf unbenannte TreeWalker-Knoten (`Button`, `Custom`
und `Hyperlink`); es gab keine zusätzlichen Knoten, Metadaten- oder
Wertabweichungen. Das 2024-Profil erlaubt deshalb ausschließlich diesen
fehlende-Knoten-Diagnoseausgang. Jede zusätzliche Struktur-, Metadaten- oder
Wertabweichung bleibt rot. Der Vergleich wird also nicht weichgestellt, sondern
liefert für diese bekannte Engine-Grenze weiterhin seinen fail-closed Befund.

Ein weiterer Engine-Unterschied ist damit belegt: `combo_options` bindet die
Auswahleinträge an die AutomationId der ComboBox. Engine 31 liefert so eine
vollständige Liste; Engine 30 hängt die Popup-Einträge nicht darunter und der
Leser meldet ehrlich `not-found`, statt eine womöglich fremde Liste zu
behaupten. Der Live-Sweep akzeptiert genau diese beiden Ausgänge – eine dritte,
stillschweigend geratene Liste wäre der Fehler.

## Wegwerfkopien statt privater Fixtures

Die Einzeltransaktionen brauchen einen Steuerfall, den sie verändern dürfen.
Bisher musste der von außen kommen: Jedes Skript verlangte eine eigene
Umgebungsvariable auf eine „neutrale Kopie", und ohne sie beendete es sich mit
`SKIP` und Rückgabewert 0. Genau so verschwanden sie aus jedem Gate.

Das Gate stellt die Kopie inzwischen selbst her: Es kopiert den offiziellen
Gewinnermittlungs-Musterfall in ein frisches Temp-Verzeichnis, richtet den
Fallbereich der Test-API darauf, führt das Skript aus und löscht das
Verzeichnis wieder. Danach prüft es dreierlei – Exit 0, unveränderter SHA-256
des Originalmusterfalls und null verbliebene SSE-Prozesse. Die Kopie ist damit
kein Vorrecht des Entwicklerrechners mehr, sondern Teil des Laufs.

Dabei kam heraus, warum diese Skripte nicht nur ungenutzt, sondern **defekt**
waren: Acht von ihnen übergaben `sse_desktop_start` bzw. `sse_launch` einen
absoluten Windows-Pfad als `file`. Seit der Pfadredaktion kennt die
MCP-Schicht nur noch `caseRef` im konfigurierten Fallbereich, und ihr striktes
Schema weist alles andere ab. Jedes dieser Skripte scheiterte deshalb im
allerersten Aufruf – unbemerkt, weil niemand sie mehr startete. Die Umrechnung
liegt jetzt in `test/fixture-case-ref.mjs` an einer Stelle.

Zwei weitere Annahmen dieser Skripte hielten der frischen Kopie nicht stand:

- Sie erwarteten feste Beträge („1,50" → „1,51"). Die stammten aus der privaten
  Arbeitskopie ihres Autors. Die Zieltabelle kommt jetzt aus dem Produktprofil,
  jeder erwartete Betrag aus der laufenden Anwendung.
- Sie erwarteten eine Startseite mit „Weiter". Der offizielle Musterfall öffnet
  auf einer Übersichtsseite ganz ohne diesen Schalter; der Test scheiterte mit
  `not-found` statt der erwarteten blockierten Navigation.

Der zweite Punkt ist mehr als ein Testdetail. Gemessen wurde: Von dieser
Startseite führt **kein** fokusfreier Weg weiter. `Invoke` auf „Jetzt beginnen"
wird ausgeführt und wechselt die Seite nicht; linear blättern geht nicht, weil
es kein „Weiter" gibt; und der Navigationsbaum braucht einen echten Mausklick,
der auf dem privaten Desktop technisch ausgeschlossen ist. Jeder versteckte
Lauf war dort gefangen. Das Gate stellt die Vorlage deshalb einmal **sichtbar**
auf die profilierte Formularseite und speichert – die Anwendung merkt sich die
Seite in der Datei, und alle folgenden Läufe öffnen direkt dort, auch versteckt.

### Was dieser Weg an echten Fehlern freigelegt hat

Erst dieser Lauf gegen den Herstellermusterfall hat vier Defekte gezeigt, die
gegen den synthetischen Worker alle grün waren:

1. **`sse_save` meldete jedes erfolgreiche Speichern als Fehlschlag.** Zwei
   Nachbedingungen waren zu streng. Erstens verlangte sie eine *fortgeschrittene*
   Schreibzeit; SSE speichert aber über eine temporäre Datei und benennt um,
   und Windows überträgt dabei per File Tunneling die alten Zeitstempel –
   gemessen: identischer `LastWriteTimeUtc` bei geändertem Hash. Zweitens
   verglich sie `ElsterTransferTime` wörtlich, das der Build beim Speichern von
   „-" auf leer normalisiert. Der Hashwechsel bleibt der eigentliche Beweis.
2. **Der Kopfparser meldete den Musterfall als übermittelt.** `-` ist der
   Platzhalter für „nie versendet"; der frühere Test „nicht leer und nicht 0"
   machte daraus `transmitted = true`, Begründung „übermittelt am -". Für ein
   Werkzeug, dessen erste Regel „niemals versenden" ist, ist eine falsche
   Übermittlungsauskunft der schlechteste denkbare Fehler. Jetzt gilt: leer,
   `0` und `-` heißen nicht übermittelt, ein Wert mit Ziffern heißt übermittelt,
   und alles andere bleibt ausdrücklich `unknown` statt geraten – ein
   irrtümlich zweiter Versand wäre der teurere Fehler.
3. **`table_read`, `read_table` und `collect` lieferten keine Tabellenzeilen.**
   Windows PowerShell 5.1 serialisiert ein verschachteltes `object[]` als
   `{"value":[…],"Count":n}`. Jeder Aufrufer bekam also Hüllobjekte statt
   Zeilen. Der synthetische Worker baut seine Zeilen in JavaScript und konnte
   das nie zeigen.
4. **Die Kontrollsumme war gar nicht lesbar.** `table_add`, `table_update` und
   `table_delete` verlangen `expectedBefore` zwingend, aber keine einzige
   Leseoperation lieferte den Wert – ein Aufrufer hätte ihn raten müssen.
   `sse_table_read` meldet ihn jetzt als `summe`. Dass er zunächst leer blieb,
   lag daran, dass der Leser den Baum ohne Werte lief; Qt gibt die Summenzelle
   nur mit `-WithValues` heraus.

Dazu kommt eine Diagnoseverbesserung: `sse_save` nennt bei `postcondition-failed`
jetzt in `offeneBedingungen`, welche Bedingung gerissen ist. Vorher stand dort
nur eine Sammelmeldung, und genau diese Sammelmeldung hat den obigen Befund
jahrelang verdeckt.

Für ein Jahr ohne volle Freigabe laufen diese Transaktionen nicht. Das ist kein
stiller SKIP: Das Gate prüft stattdessen, dass die Policy jede der sieben
Steuerfallmutationen mit genanntem Grund sperrt – auch mit gesetztem
Experimental-Opt-in.

## Profilierter Schreibweg

Der profilierte Focusless-Commit schreibt eine gebundene Tabellenzelle auf
einem privaten Windows-Desktop, mit laufendem Vordergrundwächter. Bewiesen
werden Feld-Readback, abhängige Seitensumme, `ungespeichert`, das Ausbleiben
jeder physischen Eingabe und dass die Arbeitskopie nicht auf die Platte
geschrieben wird.

Er brauchte früher eine von außen gestellte Fixture, weil ein Fall nötig ist,
der sich die profilierte Seite bereits merkt. Diesen Fall stellt das Gate
inzwischen selbst her (siehe oben); eine Umgebungsvariable ist nicht mehr
Voraussetzung.

Eine Tabellenzeile **löschen** geht dagegen nur sichtbar: Qt verlangt dafür
Strg+Umschalt+Entf, und der Worker sperrt `sse_table_delete` auf dem privaten
Desktop ausdrücklich ab. Der Tabellen-Lebenszyklus läuft deshalb bewusst
sichtbar – das Gate verlangt ohnehin eine unbenutzte Maschine.

Ein Vorbehalt gehört dazu: Erscheint beim Start eine Wiederherstellungsfrage,
beantwortet dieser Schritt sie gebunden mit „Nein". Das verwirft die
Autosave-Daten einer zuvor abgestürzten SSE-Sitzung – auch wenn diese zu einem
ganz anderen Steuerfall gehört. Das Gate startet deshalb nur ohne laufende
SSE-Instanz; wer eine offene Wiederherstellung erwartet, klärt sie vorher
selbst in der Anwendung.

## Große Schreibreise

`test/live-write-journey.mjs` ist die eine lange, streng lineare Reise über
die Schreib- und Dateiwege: lesen, Kontrollsumme prüfen, schreiben,
Kontrollsumme erneut prüfen – und für jedes Speichern der Beweis auf der
Platte. Sie läuft im strikten Live-Gate nach den Einzeltransaktionen und
zusätzlich eigenständig über `npm run test:live-journey`. Anders als die
Einzeltransaktionen **speichert sie ihre Wegwerfkopie mit Absicht**; ihr
Runner erwartet deshalb den Hashwechsel der Kopie und weiterhin den
byteidentischen Musterfall.

Ihre Beweiskette in einer Ausführung:

- Tabellenzeile anlegen, Kontrollsumme aus der Anwendung gegenlesen,
  hashgebunden speichern (Datei ändert sich nachweislich), Anwendung
  schließen, **neu starten und die Zeile erneut vorfinden** – erst der
  Neustart trennt „im Fenster sichtbar" von „in der Datei gespeichert";
- Zeile löschen, Summe exakt zurück auf dem Ausgangswert, zweites
  hashgebundenes Speichern;
- UStVA-Quartett auf der Übersicht: Zeitraum q1→q2 direkt per `combo_select`
  und zurück über `ustva_select_period`, Belege-Kennzeichen hin und zurück,
  Sondervorauszahlung 100,00 mit exakt um 10.000 Cent sinkender Zahllast und
  vollständiger Rücknahme, Vorsteuerbereich öffnen und zurück – alles ohne
  Speichern, die Datei bleibt nachweislich auf dem Stand des letzten Saves;
- CSV-Export über den echten Dialogweg (`export_csv` → `dialog_answer` →
  nativer Ordnerdialog per `file_dialog_select`) bis zu tatsächlich
  geschriebenen CSV-Dateien im Ergebnisbereich, danach derselbe Exportdialog
  noch einmal über `menu`/`menu_click`;
- Werte-Info als bekanntes Nebenfenster öffnen und per `window_close` exakt
  fingerprintgebunden schließen; Hauptfenster echt minimieren und per
  `window_restore` verifiziert zurückholen;
- `save_as` auf eine Zweitdatei samt nachgewiesener Fensterumbindung,
  Bestandskontrolle über `list_cases`/`case_hash` und hashgebundenes
  Verschieben der Zweitdatei per `archive_cases`.

### Was die Reise bereits an Wirklichkeit freigelegt hat

Vier Annahmen hielten dem echten Programm nicht stand. Alle vier sind
Produktverhalten, nicht Testfehler – und alle vier wären mit einer weniger
strengen Prüfung unbemerkt geblieben:

1. **Die profilierte Gebührentabelle spiegelt den Betrag in eine zweite,
   berechnete Spalte derselben Zeile.** Eine Zeilenbindung allein über den
   Text ist dort deshalb grundsätzlich mehrdeutig; `sse_table_delete` weist
   das korrekt mit `ambiguous` ab. Nach einem Neustart existiert keine
   Runtime-ID aus der Mutation mehr, die Reise leitet sie deshalb neu aus der
   laufenden Anwendung ab und prüft strukturelle gegen geometrische Sicht.
   Für Aufrufer heißt das: Eine Tabellenzeile über einen Betrag zu adressieren
   ist auf gespiegelten Tabellen nicht eindeutig – `targetRid` ist Pflicht.
2. **Der CSV-Export schreibt eine Datei je Ausgabekategorie, und Kategorien
   ohne Daten ergeben eine leere Datei.** Am Musterfall ist das
   `GWGVerzeichnis.csv` – der Fall hat keine geringwertigen Wirtschaftsgüter.
   Eine leere Exportdatei ist damit korrektes Verhalten; beweiskräftig ist,
   dass überhaupt Inhalt geschrieben wurde.
3. **Der abgeschlossene Export legt eine weitere Meldung über das
   Exportfenster.** `sse_dialog_answer` verweigert die Antwort auf einen
   verdeckten Dialog mit `non-topmost-dialog`. Die Reise räumt die Kette
   deshalb von oben nach unten ab und benutzt genau dieses strukturierte
   Urteil als Reihenfolgequelle, statt eine Reihenfolge zu raten.
4. **SteuerSparErklärung legt beim Speichern eine eigene Sicherungsdatei
   `<Fallname>_Backup` neben den Fall**, und der Bestandsabgleich von
   `sse_archive_cases` zählt sie mit. Ein Archivlauf, der nur die sichtbaren
   Falldateien kennt, wird deshalb korrekt mit `inventory-mismatch` gestoppt –
   die Operation verlangt den vollständigen Restbestand, nicht den vermuteten.
   Für Aufrufer heißt das: `sse_list_cases` mit `includeBackups: true` ist vor
   einem Archivlauf Pflicht.

Zwei Grenzen bleiben bewusst außerhalb der Reise und damit live unbelegt:
Die sechs `vast_*`-Operationen brauchen den echten VaSt-Belegabruf-Dialog
eines ELSTER-Kontos, und `center_cases`/`center_refresh` brauchen das
separate Steuertipps-Center mit der realen Nutzerkonfiguration. Beide sind
offline gegen den zustandsbehafteten synthetischen Worker belegt; ein
Live-Nachweis ohne diese Voraussetzungen wäre gespielt statt bewiesen.

Die Reise braucht eine entsperrte, unbenutzte Windows-Sitzung: Zwei Versuche
am Vormittag des 2026-08-14 endeten reproduzierbar fail-closed mit
`interference`, weil während der ersten Zellschreibung echte Benutzereingaben
eintrafen – bei gesperrtem Bildschirm scheitern dagegen die
SendInput-Dialogwege. Ihr erster vollständiger Lauf gehört deshalb in das
unbeaufsichtigte Zeitfenster des geplanten Gesamtlaufs; erst mit dessen
Abdeckungsbilanz wandern die neuen Operationen in die Live-Spalte.

Engine 30 vergibt bei einzelnen semantisch identischen, unbenannten Qt-Knoten
zwischen zwei unmittelbar folgenden Läufen neue Runtime-IDs. Der Vergleich
weist diese als `runtimeIdChurnCount` aus und paart sie nur im identischen
Traversal-Slot mit identischem Elternindex und gleicher Tiefe, wenn außerdem
Typ, Name, AutomationId, Geometrie, Zustand und privater Wert intern exakt
identisch sind. Die privaten Vergleichsdaten verlassen den Worker nicht; echte
Struktur- oder Wertabweichungen bleiben ein Fehler.

Praktische Folge für Aufrufer: Eine Runtime-ID aus einem vorherigen Aufruf ist
auf Engine 30 keine tragfähige Bindung für eine Aktion – der Klick endet dann
mit `not-found` auf einem leeren Bezeichner. Für Aktionen binden Name oder
AutomationId; die Eindeutigkeit wird vorher lesend geprüft.

Strikte Ausführung beider Profile in PowerShell:

```powershell
npm run test:live
```

Der Runner entfernt eine eventuell gesetzte Fallauswahl, startet nur ohne
vorhandene SSE-Instanz, prüft `2025` und danach `2024` vollständig und verlangt
nach jedem Profil wieder null SSE-Prozesse. Für 2024 setzt er den eng begrenzten
Verifikations-Opt-in selbst. Im Lauf werden ein Dateihash und ein stabiler
Ergebnisreadback jeweils direkt per HTTP und über das kanonische MCP-
`structuredContent` verglichen.

Fehlende Installation, Musterdatei oder Testvoraussetzung darf in einem
verpflichtenden Live-Gate nicht als grüner `SKIP` gelten. Vor und nach dem Lauf
muss geprüft werden, dass keine fremde SSE-Instanz übernommen oder beendet
wurde.

Während des Laufs darf der Rechner nicht nebenher bedient werden. Vor jedem
echten Baumklick bindet der Worker den aktuellen Windows-Eingabetick sowie den
exakten SSE-PID-/Root an der Zielposition; fremde Eingabe oder Überdeckung
stoppt deshalb vor dem Input. Ein physischer Baumklick verlangt zusätzlich,
dass genau dieses SSE-HWND unmittelbar vor dem Mausinput im Vordergrund ist.
Verweigert Windows die Aktivierung, meldet `sse_click_point` `interference`
und führt keinen Klick aus. Nur bei Vordergrund-, Root- und Input-Bindung kann
ein wirkungsloser Qt-Klick noch als `postcondition-failed` erscheinen. Der
Sweep wiederholt ausschließlich diesen lesenden Zweigklick begrenzt und gibt
pro Versuch Fokus- und Klick-Bindungsdaten aus; damit ist eine ruhige sichtbare
Sitzung prüfbar, ohne Fremdbedienung pauschal als Ursache zu behaupten.

## Noch nicht freigegeben

Für „jede praktische SSE-Aktion vollständig geprüft“ fehlen insbesondere:

1. das UStVA-Schreiben, `save_as`, `export_csv` und `file_dialog_select`. Diese
   Operationen sind offline gegen den synthetischen Worker vollständig
   abgedeckt – gegen die echte Anwendung bleiben sie unbewiesen. Combo/Toggle,
   Tabellen-Add/Update/Delete und `save` laufen inzwischen im Gate gegen
   Wegwerfkopien; `combo_select` fehlt weiterhin, weil die profilierte
   ComboBox-Tabelle nur auf Engine 31 bindbar ist;
2. ein vollständiger HTTP-gegen-MCP-Szenariolauf auf zwei unabhängigen frischen
   Wegwerfkopien einschließlich der freigegebenen Mutationen; der aktuelle
   Live-Lauf belegt bereits die echte Transportparität für Hash und Ergebnisreadback;
3. eine ausdrücklich bereitgestellte neutrale VaSt-Fixture für Mapping und
   Apply. Ohne diese Fixture bleibt VaSt-Apply unbewiesen und gesperrt.

Die Live-Spalte der Abdeckungsbilanz ist die verbindliche Antwort darauf,
welche Operationen die echte Anwendung schon bedient hat. Prosa in dieser Datei
darf ihr nie widersprechen.

Eine Jahresprofil-Promotion ist erst zulässig, wenn diese Freigaben nicht
pauschal über den Profilstatus erfolgen und alle für das Jahr erlaubten
Operationsklassen mit passender Live-Evidenz hinterlegt sind.
