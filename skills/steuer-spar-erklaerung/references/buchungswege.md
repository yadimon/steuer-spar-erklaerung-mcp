# Buchungswege in der Gewinn-Erfassung

Lies diese Referenz, bevor du eine Ausgabe, eine Einnahme oder einen
Reverse-Charge-Beleg in eine Gewinn-Erfassung einträgst. Sie hält fest, was am
laufenden Programm belegt ist — nicht, was plausibel klingt.

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

## Reverse Charge erzeugt sich nicht aus der Ausgabenzeile

Ein EU-Beleg ohne ausgewiesene deutsche Umsatzsteuer als 0-%-Zeile in den
EDV-Kosten zu erfassen, ist **keine** § 13b-Buchung. Die Ausgabe steht dann in
der Gewinnermittlung, die Steuerschuld entsteht aber nicht; in der
Voranmeldung bleibt § 13b auf 0,00.

Die Bemessung entsteht auf der Seite `Innergem. Erwerb, § 13b UStG und
Einfuhr`. Sie führt drei Tabellen; die zweite (`sumLabel` = `Summe`,
`sumOccurrence` = 2) hat die Spalten Nr., Datum, Bezeichnung, **Kategorie**, %,
Netto. Die Spalte Kategorie ist eine typisierte Auswahl; das Produktprofil
kennt dort `Sonst. Leistung EU`. Der eingetragene Betrag ist der **Netto**wert,
also bei Reverse Charge der Rechnungsbetrag.

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
