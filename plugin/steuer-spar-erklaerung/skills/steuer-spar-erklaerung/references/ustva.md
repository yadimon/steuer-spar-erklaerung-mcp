# Umsatzsteuer-Voranmeldung

Lies diese Referenz nur bei einem ausdrücklichen Auftrag zu UStVA,
Umsatzsteuer-Voranmeldung, Gewinn-Erfassung oder dem Folgejahr-Fall 2026.
Eine Jahreserklärung oder allgemeine Fallprüfung autorisiert keine
UStVA-Änderung.

1. Binde zuerst den nach case-session.md eindeutig geöffneten Fall und sichere
   seinen aktuellen Disk-Hash vor jeder UStVA-Lesung oder Navigation einmal
   nach `backups:`. Ohne dieses verifizierte Backup keine UStVA-Arbeit beginnen.
2. Bestimme Zieljahr und Zielzeitraum. Das Profil 2025 darf zusätzlich
   genau den vom Hersteller vorgesehenen Folgejahr-Fall `*.GewErfass2026`
   bedienen. Verwende diese Ausnahme nur für Gewinn-Erfassung/UStVA 2026;
   andere 2026er Fallarten und spätere Jahre bleiben gesperrt.
3. Lies Fallkopf, Übermittlungsprotokolle und UStVA-Zustand. Ist der Zeitraum
   bereits übermittelt, bereite keinen zweiten Fall und keine Berichtigung ohne
   einen neuen ausdrücklichen Auftrag vor.
4. Erstelle vor jeder Betragseingabe ein vollständiges Periodeninventar der
   freigegebenen Ein- und Ausgangsrechnungen. Rechnungen sind die führende
   Quelle für Betrag, Leistungsbezug, ausgewiesene Umsatzsteuer und
   Rechnungsaussteller; Kontoauszüge ersetzen keine fehlende Rechnung. Halte
   Zahlungsstatus und Zahlungsdatum getrennt fest. Fehlt dieser Abgleich,
   kennzeichne die Buchung und das Ergebnis als **vorläufig - Zahlungsabgleich
   ausstehend**; behaupte weder einen abschließenden EÜR-Zeitpunkt noch einen
   abschließenden Zeitpunkt bei Istversteuerung.
5. Erfasse oder korrigiere die belegten Einnahmen und Ausgaben zuerst in den
   fachlich passenden Buchungsseiten der Gewinn-Erfassung. Trenne dabei
   deutsche Umsatzsteuer, EU-/Drittlands-§13b, nicht abziehbare oder
   korrekturbedürftig ausgewiesene ausländische Umsatzsteuer sowie nicht
   steuerbare EU-Ausgangsleistungen. Lies jede Zeile, die Seitensumme, die
   Betriebseinnahmen/-ausgaben-Übersicht und die Vorsteuer-Übersicht zurück.
   Verwechsle Kostenart und Umsatzsteuerbehandlung nicht: Eine Rechnung gehört
   wirtschaftlich in eine gewöhnliche Kostenart und kann bei einem
   ausländischen Anbieter zugleich eine sonstige Leistung nach § 13b UStG sein.
   Lies dann im geöffneten Fall, ob die fachlich passende Buchungsseite selbst
   eine §13b-Erfassung anbietet. Fehlt sie dort, erfasse die Rechnung
   **einmal** auf der Seite, die §13b abbildet, und wähle die Leistungsart
   anhand des Anbietersitzes (EU oder Drittland). Erfasse denselben Nettobetrag
   nicht zusätzlich auf der Kostenseite, weil das die Betriebsausgabe
   verdoppeln würde. Rechnungen mit deutscher Umsatzsteuer und ausländische
   Rechnungen ohne §13b verbleiben in der fachlich passenden Kostenzeile.
   Beispiel: In der SSE-Version 2025 hat `EDV-Kosten` keine §13b-Unterseite,
   ein Software-Abo eines ausländischen Anbieters gehört dort unter
   `Fremdleistungen -> Rechnungen nach § 13b UStG`. Verlasse dich nicht auf
   dieses Beispiel, sondern auf die tatsächlich vorhandenen Seiten.
   Eine Rechnung aus einem bereits übermittelten Zeitraum wird nicht still in
   den aktuellen Zeitraum verschoben; dokumentiere stattdessen den möglichen
   Berichtigungsbedarf.
   Beachte in der Gewinn-Erfassung diese belegten Eigenheiten:
   - Nur Einnahmen-**Positionen** (Erlöse → „Position erfassen“ → Seite
     `Einnahmen: <Bezeichnung>`) sind periodenwirksam und erscheinen in der
     UStVA. Die jahresbezogene Tabelle „Weitere Erlöse zu 19%“ ist es nicht.
   - Ausgaben gehören in die Kostenart; Vorsteuer und UStVA entstehen daraus.
     Tabellen „(Steuersatz manuell)“ haben eine freie Prozentspalte, Tabellen
     „(Steuersatzauswahl)“ eine typisierte Auswahl (0/7/19). `Reisekosten` ist
     ein Formular je Reise, keine flache Tabelle.
   - `sse_table_add` schreibt höchstens sechs Zeilen je Tabelle. Danach eine
     weitere Position beziehungsweise Tabelle anlegen, nicht scrollen.
   - Seitensummen der Vorsteuerseite tragen den gewählten Zeitraum im Label
     („… »2. Vierteljahr«“) und sind dann gefiltert: `sumLabel` vor jedem
     `sse_table_add`/`sse_table_delete` frisch aus `sse_read_page` nehmen.
   - Das Programm rundet Netto aus Brutto teils anders als der Kassenbon
     (18,42 / 1,07 = 17,21 statt 17,22). Kontrollsummen aus dem
     Programm-Readback ableiten und die Abweichung dokumentieren.
6. Behalte die belegte Meldefrequenz bei. Ein im Auftrag genannter Monat oder
   ein genanntes Quartal benennt nur den Zielzeitraum und erlaubt keinen
   Frequenzwechsel, weder von vierteljährlich auf monatlich noch umgekehrt.
   Stelle die Frequenz nur mit einer belegten Grundlage um. Bei fachlicher
   Unsicherheit aktuelle Primärquellen prüfen und stoppen.
7. Verwende `sse_ustva_read` vor und nach der Arbeit. Wähle Frequenz und
   Monat/Quartal mit getrennten `sse_ustva_select_period`-Aufrufen, jeweils mit
   gebundenem, nach case-session.md gesichertem Arbeitsfall, aktuellem Hash,
   PID/HWND sowie exaktem Vorwert.
8. Verwende `sse_ustva_open_section` statt generischer Klicks. Öffne damit auch
   die Detailbereiche `reverse_charge` und `input_tax`; EU-/Drittlandsleistungen
   und normale/§13b-Vorsteuer müssen getrennt rückgelesen werden. Mehrere gleich
   benannte Schaltflächen sind nachweislich mehrdeutig.
9. Vergleiche die automatisch aus den Buchungen erzeugte UStVA mit dem
   Periodeninventar. `manual_input` ist nur ein begründeter Fallback, wenn eine
   belegte Position trotz korrekter Buchung nicht fachlich abbildbar ist.
   Aktiviere es und ändere manuelle Hauptbeträge nur nach ausdrücklicher
   Freigabe; dokumentiere Ursache sowie jeden Vor-/Nachwert. Eine unvollständig
   vorgefüllte Gewinn-Erfassung darf nicht durch bloßes Übertragen von Summen in
   die UStVA kaschiert werden.
10. Speichere nur nach vollständigem Readback und gesonderter Freigabe mit dem
   hashgebundenen Speicherbefehl. ELSTER, Senden und Übermittlung bleiben auch
   dann gesperrt.
