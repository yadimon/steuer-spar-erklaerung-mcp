# Umsatzsteuer-Voranmeldung

Lies diese Referenz nur bei einem ausdrücklichen Auftrag zu UStVA,
Umsatzsteuer-Voranmeldung, Gewinn-Erfassung oder dem Folgejahr-Fall 2026.
Eine Jahreserklärung oder allgemeine Fallprüfung autorisiert keine
UStVA-Änderung.

1. Bestimme zuerst Zieljahr und Zielzeitraum. Das Profil 2025 darf zusätzlich
   genau den vom Hersteller vorgesehenen Folgejahr-Fall `*.GewErfass2026`
   bedienen. Verwende diese Ausnahme nur für Gewinn-Erfassung/UStVA 2026;
   andere 2026er Fallarten und spätere Jahre bleiben gesperrt.
2. Lies Fallkopf, Übermittlungsprotokolle und UStVA-Zustand. Ist der Zeitraum
   bereits übermittelt, bereite keinen zweiten Fall und keine Berichtigung ohne
   einen neuen ausdrücklichen Auftrag vor.
3. Erstelle vor jeder Betragseingabe ein vollständiges Periodeninventar der
   freigegebenen Ein- und Ausgangsrechnungen. Rechnungen sind die führende
   Quelle für Betrag, Leistungsbezug, ausgewiesene Umsatzsteuer und
   Rechnungsaussteller; Kontoauszüge ersetzen keine fehlende Rechnung. Halte
   Zahlungsstatus und Zahlungsdatum getrennt fest. Fehlt dieser Abgleich,
   kennzeichne die Buchung und das Ergebnis als **vorläufig - Zahlungsabgleich
   ausstehend**; behaupte weder einen abschließenden EÜR-Zeitpunkt noch einen
   abschließenden Zeitpunkt bei Istversteuerung.
4. Erfasse oder korrigiere die belegten Einnahmen und Ausgaben zuerst in den
   fachlich passenden Buchungsseiten der Gewinn-Erfassung. Trenne dabei
   deutsche Umsatzsteuer, EU-/Drittlands-§13b, nicht abziehbare oder
   korrekturbedürftig ausgewiesene ausländische Umsatzsteuer sowie nicht
   steuerbare EU-Ausgangsleistungen. Lies jede Zeile, die Seitensumme, die
   Betriebseinnahmen/-ausgaben-Übersicht und die Vorsteuer-Übersicht zurück.
   Verwechsle Kostenart und Umsatzsteuerbehandlung nicht: Ein Software-Abo oder
   Online-Dienst ist wirtschaftlich eine EDV-Ausgabe, kann aber bei einem
   ausländischen Anbieter zugleich eine sonstige Leistung nach § 13b UStG
   sein. In der SSE-Version 2025 bietet die Buchungsseite `EDV-Kosten` keine
   §13b-Unterseite. Erfasse eine solche Rechnung deshalb **einmal** unter
   `Fremdleistungen -> Rechnungen nach § 13b UStG` und wähle anhand des
   Anbietersitzes `Sonst. Leistung EU` oder `Sonst. Leistung Drittland`.
   Erfasse denselben Nettobetrag nicht zusätzlich unter `EDV-Kosten`, weil das
   die Betriebsausgabe verdoppeln würde. Inländische Software-Rechnungen mit
   deutscher Umsatzsteuer und ausländische Rechnungen ohne §13b verbleiben in
   der fachlich passenden EDV-Kostenzeile.
   Eine Rechnung aus einem bereits übermittelten Zeitraum wird nicht still in
   den aktuellen Zeitraum verschoben; dokumentiere stattdessen den möglichen
   Berichtigungsbedarf.
5. Behalte die belegte Meldefrequenz bei. „Juli“ allein ist keine Erlaubnis,
   von vierteljährlich auf monatlich umzustellen. Bei fachlicher Unsicherheit
   aktuelle Primärquellen prüfen und stoppen.
6. Verwende `sse_ustva_read` vor und nach der Arbeit. Wähle Frequenz und
   Monat/Quartal mit getrennten `sse_ustva_select_period`-Aufrufen, jeweils mit
   Arbeitskopie, aktuellem Hash, PID/HWND sowie exaktem Vorwert.
7. Verwende `sse_ustva_open_section` statt generischer Klicks. Öffne damit auch
   die Detailbereiche `reverse_charge` und `input_tax`; EU-/Drittlandsleistungen
   und normale/§13b-Vorsteuer müssen getrennt rückgelesen werden. Mehrere gleich
   benannte Schaltflächen sind nachweislich mehrdeutig.
8. Vergleiche die automatisch aus den Buchungen erzeugte UStVA mit dem
   Periodeninventar. `manual_input` ist nur ein begründeter Fallback, wenn eine
   belegte Position trotz korrekter Buchung nicht fachlich abbildbar ist.
   Aktiviere es und ändere manuelle Hauptbeträge nur nach ausdrücklicher
   Freigabe; dokumentiere Ursache sowie jeden Vor-/Nachwert. Eine unvollständig
   vorgefüllte Gewinn-Erfassung darf nicht durch bloßes Übertragen von Summen in
   die UStVA kaschiert werden.
9. Speichere nur nach vollständigem Readback und gesonderter Freigabe mit dem
   hashgebundenen Speicherbefehl. ELSTER, Senden und Übermittlung bleiben auch
   dann gesperrt.
