# Buchungswege in der Gewinn-Erfassung

Lies diese Referenz, bevor du eine Ausgabe, eine Einnahme oder einen
Reverse-Charge-Beleg in eine Gewinn-Erfassung einträgst. Sie hält fest, was am
laufenden Programm belegt ist — nicht, was plausibel klingt.

Auf dem entsperrten sichtbaren Desktop übernehmen `sse_table_add` und
`sse_table_update` den Fokus des exakt gebundenen Hauptfensters vor der
Änderung. Ein minimiertes Ziel wird über dasselbe HWND/PID wiederhergestellt.
Danach müssen Seite, Summe, Tabellenprofil, Zellbestand und unveränderte
Eingabe-Epoche frisch bestätigt sein. Fremder Fokus oder eine geänderte
Eingabe-Epoche stoppt weitere Klicks, Tasten und Zellschreibungen.

## Seitensummen addieren netto

Die Kontrollsumme einer Buchungsseite summiert die **Nettobeträge**, nicht die
Bruttobeträge. Ein Beleg über 12,34 € mit 19 % hebt eine Summe von 3,40 € auf
13,77 €, nicht auf 15,74 €.

Deshalb: `expectedAfter` bei `sse_table_add` weglassen. Ohne diese Angabe
genügt, dass die Kontrollsumme sich bewegt hat — das bindet die Zeile an die
richtige Tabelle, und jede Zelle wird ohnehin einzeln zurückgelesen. Wer die
Nachsumme doch angibt, muss SSEs Rundung selbst nachbilden und scheitert an
korrekt geschriebenen Zeilen.

`expectedBefore` bleibt Pflicht und ist billig: `sse_table_read` liefert es.

Bei gemischten Steuersätzen kann dieselbe Tabelle getrennte Teilsummen mit
und ohne Vorsteuerabzug führen. Eine 0-%-Zeile bewegt dann nur die Summe ohne
Vorsteuerabzug. Binde vor der Änderung die fachlich passende Summe **und**
ihre tatsächliche Tabellenregion frisch; der Labelwechsel allein genügt
nicht. Liegen mehrere Summen unter derselben Tabelle und schließt die
geometrische Regionsbindung die Zellen aus, ist dieser Schreibweg nicht
nachgewiesen. Stoppe statt eine unpassende Kontrollsumme zu verwenden.

Für die profilierte Seite `Sonstige Kfz-Kosten` bindet das Produktprofil die
Summen mit und ohne Vorsteuerabzug über ihre exakten Automation-IDs an
dieselbe Kostentabelle. Bei 0-%-Zeilen sind sechs Spalten, Datum, eindeutige
Bezeichnung und eine veränderte exakte `expectedAfter`-Summe Pflicht. Der
Nachweis der vollständigen Zeile verwendet ihre Werte; ihre Y-Position darf
sich beim Sortieren ändern. Ein fehlender oder mehrdeutiger Zeilennachweis
erlaubt keine Erfolgsmeldung oder ungebundene Rücksetzung.

Die sechs Argumentwerte für eine solche 0-%-Kostenzeile lauten
`["", Datum, Bezeichnung, Betrag, "0", ""]`: Die letzte Netto-Spalte bleibt
explizit leer, damit SSE sie berechnet. Fünf Werte sind kein vollständiger
Zeilenvertrag.

Ein fehlgeschlagener Nachsummen- oder Zeilenvergleich bedeutet nicht, dass
nichts geschrieben wurde. Lies den Teilstand vollständig zurück: exakt eine
neue Zeile mit Datum, Bezeichnung, Betrag, Steuersatz und Netto sowie alle
unveränderten Altzeilen und die passenden Teilsummen nachweisen. Ist die
Buchung bereits vorhanden, nicht erneut anlegen. Bleibt der Bestand unklar,
keine Wiederholung, kein blindes Löschen und kein Speichern.

## Eigene Einnahmenposition anlegen

Auf `Erlöse Lieferungen/Leistungen` legt `sse_position_create` eine leere
Einnahmenposition mit 19 % an. Vorher die gesamte sichtbare Übersicht mit
Namen und exakten Nettosummen lesen und als `expectedPositions` übergeben.
`hwnd`, `expectedCaseRef`, `expectedCaseHash` und die bytegleiche getrennte
Sicherung `backupRef` sind Pflicht. Ein bereits vorhandener Name wird
abgewiesen; zum Wiederverwenden die bestehende Position öffnen.

Der Befehl prüft nach dem Anlegen die neue leere Position und die unveränderten
Altpositionen. Erst bei `verified=true` mit `sse_table_add` die bestätigten
Buchungen erfassen. Andere Steuersätze und ganze Positionen löschen sind
hier nicht freigegeben. Bei `cleanupRequired=true` den Teilstand neu lesen:
keine blinde Wiederholung und keine automatische Löschung. Speichern bleibt
ein getrennter Auftrag.

## Reverse Charge erzeugt sich nicht aus der Ausgabenzeile

Ein EU-Beleg ohne ausgewiesene deutsche Umsatzsteuer als 0-%-Zeile in den
EDV-Kosten zu erfassen, ist **keine** § 13b-Buchung. Die Ausgabe steht dann in
der Gewinnermittlung, die Steuerschuld entsteht aber nicht; in der
Voranmeldung bleibt § 13b auf 0,00.

Die Bemessung entsteht durch die passende §13b-Buchung. Lies zuerst, ob die
Kostenart eine eigene Unterseite `Rechnungen nach § 13b UStG` anbietet. Fehlt
sie etwa bei EDV-Kosten, führt der belegte Weg über `Fremdleistungen` zu dieser
Unterseite. Erfasse denselben Nettobetrag nur einmal; eine zusätzliche
0-%-EDV-Zeile würde die Betriebsausgabe verdoppeln.

Die Überschrift `Innergem. Erwerb, § 13b UStG und Einfuhr` allein bindet keine
Tabelle: Je nach Navigationsweg stehen dort eine oder mehrere Tabellen.
Lies `sumLabel`, `sumOccurrence`, Spalten und Automation-ID-Abschnitt frisch
mit `sse_table_read`; übernimm kein universelles zweites Summenvorkommen.
Die Kategorie-Tabelle der Kostenart kann `Summe`, Vorkommen 1 sein, während
der Materialbereich dieselbe Kategorie-Tabelle an Vorkommen 2 enthält.
Die Spalten Nr., Datum, Bezeichnung, **Kategorie**, %, Netto müssen zur
gebundenen Tabelle passen. Kategorie ist eine typisierte Auswahl: Übernimm
den exakten Vorwert aus dem Readback und wähle die belegte EU- oder
Drittlandsleistung anhand des Anbietersitzes. Der eingetragene Betrag ist
der **Netto**wert, bei Reverse Charge der Rechnungsbetrag.

Eine ansonsten leere zweite §13b-Tabelle kann bereits `Sonst. Leistung EU`
als Kategorie zeigen. Nur beim exakt gebundenen Profil darf der ausdrücklich
gleiche `comboExpectedBefore` diesen bestätigten Default als freie Anlegezeile
einordnen; Datum und Bezeichnung müssen leer und der Nettobetrag 0 sein.

Eine Kategorieauswahl kann die Anlegezeile materialisieren und ihre
Y-Position verschieben. Die API bindet dann nur genau eine vollständige
frische Zeile mit der gewünschten Kategorie und identischen übrigen Werten.
Eine neue Zeilennummer darf ausschließlich bei der zuvor bestätigten leeren
Anlegezeile entstehen. Alle vorbereiteten Textzellen werden an diese Zeile
neu gebunden; fehlende oder mehrdeutige Nachweise stoppen weitere Änderungen.

Die § 13b-Felder auf `Steuerschuldnerschaft nach § 13b UStG` sind
**schreibgeschützt**: SSE rechnet sie aus den Buchungen. Ein Schreibversuch
dort scheitert mit `readonly`; das ist kein Fehler, sondern die Bauart.

## Übermittelte Fälle

Der Fallkopf hält **eine** Übermittlung fest, nicht den Zustand des Jahres.
Eine Gewinn-Erfassung läuft über das ganze Jahr und ist die Vorbefüllung der
nächsten Voranmeldung. `sse_save` speichert deshalb auch dann, gibt aber
`transmittedCaseWarning` mit dem Übermittlungszeitpunkt zurück.

Diese Warnung ernst nehmen: Ein bereits übermittelter **Zeitraum** wird nicht
still geändert. Für dessen Berichtigung gibt es den `correction`-Weg mit
Arbeitskopie, Sicherung, Zeitraum und Grund.

## Wo einzelne Belegarten hingehören

- **Ladestrom** für ein betriebliches Fahrzeug: `Sonstige Kfz-Kosten` des
  Fahrzeugs, Tabelle `Summe der sonstigen Kfz-Kosten mit Vorsteuerabzug`. Die
  Seite führt daneben eine eigene Summe `Ladestromkosten netto`; prüfe vor dem
  Eintragen, in welcher der beiden die vorhandenen Ladungen stehen, und bleibe
  konsistent.
- **Kfz-Steuer** und **Kfz-Versicherung**: `Steuern, Versicherungen und Maut`
  des Fahrzeugs. Beide ohne Vorsteuer — eine Versicherung ist
  umsatzsteuerfrei, die enthaltene Versicherungsteuer ist keine Vorsteuer.
- **Werbung**: `Werbung und Reklame`, nicht „Werbekosten"; die Seite trennt
  Inland von innergemeinschaftlichem Erwerb.
- **Cloud-, KI- und Softwaredienste**: wirtschaftlich EDV-Kosten. Kostenart und
  Umsatzsteuerbehandlung getrennt beurteilen.

## Zahlungszeitpunkt

Bei der Einnahmenüberschussrechnung zählt der Abfluss. Eine am 26.08.
ausgestellte, am 02.09. abgebuchte Versicherung gehört unter das **Zahldatum**.
Prüfe, welcher Konvention der geöffnete Fall folgt, statt sie zu setzen.

Eine Ausgangsrechnung ohne nachgewiesene Zahlung wird nicht als Einnahme
gebucht. Ein Dateiname wie `…_NOT_PAID_YET.pdf` ist ein Hinweis, kein Nachweis
— entscheidend bleibt der Kontoauszug.

## Zwei Bedienheiten

`sse_goto` braucht die exakte Seitenüberschrift. Trifft der Name nicht, nennt
die Fehlermeldung naheliegende Kandidaten; nimm einen davon, statt Namen zu
raten.

In langen Tabellen liegt die Anlegezeile außerhalb des Sichtbereichs. Die API
holt sie selbst in den Blick und meldet das als
`freeRowSearch.retriedAfterTableWalk`; ein vorgeschalteter Lesevorgang ist
dafür nicht nötig.
