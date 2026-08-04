# Umsatzsteuer-Voranmeldung sicher vorbereiten

Stand: 2026-08-04

Dieses Projekt kann eine Umsatzsteuer-Voranmeldung (UStVA) in
SteuerSparErklärung lesen und in einer verifizierten Arbeitskopie vorbereiten.
Das Produktprofil 2025 unterstützt dabei neben 2025 ausdrücklich den vom
Hersteller vorgesehenen Folgejahr-Fall `*.GewErfass2026`; andere 2026er
Fallarten bleiben gesperrt. Es speichert nur nach einem getrennten,
hashgebundenen Auftrag und übermittelt niemals an das Finanzamt.

## Fachliche Grenze

Der Voranmeldungszeitraum darf nicht aus dem gewünschten Monatsnamen erraten
werden. Nach [§ 18 UStG](https://www.gesetze-im-internet.de/ustg_1980/__18.html)
hängt die monatliche oder vierteljährliche Abgabe unter anderem von der Steuer
des Vorjahres und Sonderfällen ab. Eine vorhandene, belegte Programmeinstellung
wird deshalb beibehalten, bis gegenteilige Primärunterlagen vorliegen.

Für Feldbezeichnungen und das 2026er Formular ist das
[BMF-Schreiben zu den Vordrucken im Umsatzsteuer-Voranmeldungs- und
Vorauszahlungsverfahren 2026](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/2025-12-29-vordruckmuster-USt-voranmeldung-2026.pdf?__blob=publicationFile&v=7)
die maßgebliche technische Referenz. Dieses Open-Source-Projekt ersetzt keine
Steuerberatung.

## Sicherer Ablauf

1. Zieljahr, Fallart, Fallhash und vorhandenen Übermittlungsstatus read-only
   feststellen.
2. Alle freigegebenen Ein- und Ausgangsrechnungen des Zeitraums inventarisieren.
   Sie sind die führende Quelle für Betrag, Leistungsbezug, Aussteller und
   ausgewiesene Umsatzsteuer. Zahlungsstatus und Zahlungsdatum bleiben davon
   getrennte Merkmale. Fehlt der Zahlungsabgleich, lautet der Status
   `vorläufig - Zahlungsabgleich ausstehend`; insbesondere EÜR- und
   Istversteuerungs-Zeitpunkte gelten dann noch nicht als abschließend geprüft.
3. Für Änderungen eine neue Arbeitskopie erzeugen und Bytegleichheit zum
   Ausgangsfall bestätigen.
4. Belegte Einnahmen und Ausgaben zuerst in den fachlich passenden Tabellen der
   Gewinn-Erfassung erfassen. Deutsche Vorsteuer, EU-/Drittlands-§13b,
   korrekturbedürftig ausgewiesene ausländische Umsatzsteuer und nicht
   steuerbare EU-Ausgangsleistungen getrennt behandeln. Jede Zeile sowie
   Seiten-, Einnahmen-/Ausgaben- und Vorsteuer-Summen zurücklesen. Eine Position
   aus einem bereits übermittelten Zeitraum nicht still in den aktuellen Monat
   verschieben, sondern als möglichen Berichtigungsfall dokumentieren.
   Kostenart und Umsatzsteuerbehandlung getrennt beurteilen: Ein Software-Abo
   oder Online-Dienst ist wirtschaftlich eine EDV-Ausgabe. Bei einem
   ausländischen Anbieter kann es zugleich eine sonstige Leistung nach § 13b
   UStG sein. Die SSE-Version 2025 hat unter `EDV-Kosten` keine
   §13b-Unterseite; solche Rechnungen deshalb einmal unter
   `Fremdleistungen -> Rechnungen nach § 13b UStG` als EU- oder
   Drittlandsleistung erfassen. Nicht zusätzlich unter `EDV-Kosten` buchen,
   weil das den Aufwand doppelt erfassen würde. Inländische Software mit
   deutscher Umsatzsteuer bleibt in der EDV-Kostenzeile.
   Für die anfängliche Bestandskarte kurze `collect`-/`sse_collect`-Segmente mit
   dem linearen `Weiter`-Pfad verwenden. Nur erkannte lange Tabellen zusätzlich
   mit `table_read`/`sse_table_read` vollständig lesen. Die globale Suche ist
   ein Rücksprungmechanismus, kein Vollständigkeitsnachweis. Wenn Qt eine
   sichtbare Seite, Tabellenzuordnung oder Auswahl nicht strukturiert über UIA
   liefert, zusätzlich `screenshot`/`sse_screenshot` in eine neue
   Ergebnisreferenz schreiben und das Layout visuell prüfen. Das Bild ergänzt
   den Feld-, Tabellen- und Summen-Readback, ersetzt ihn aber nicht.
5. Erst danach die UStVA-Seite öffnen und mit `ustva_read` beziehungsweise
   `sse_ustva_read` den automatisch erzeugten Ausgangszustand lesen und gegen
   das Rechnungsinventar abgleichen.
6. Frequenz und Monat/Quartal bei Bedarf mit einzelnen
   `ustva_select_period`-Aufrufen ändern. Jeder Aufruf verlangt Vorwert,
   Fallreferenz, SHA-256 und möglichst PID/HWND.
7. Kennzeichen mit `ustva_set_flag` und katalogisierte Beträge mit
   `ustva_change_value` nur als begründeten Fallback ändern. Für § 13b und
   Vorsteuer zuerst die gebundenen Detailbereiche `reverse_charge`
   beziehungsweise `input_tax` öffnen. EU- und Drittlandsleistungen sowie
   normale und §13b-Vorsteuer bleiben getrennt. Berechnete Buchungswerte haben
   Vorrang; manuelle Summen dürfen eine unvollständige Gewinn-Erfassung nicht
   verdecken.
8. UStVA vollständig zurücklesen, gegen Belege und das amtliche Feldschema
   prüfen und einen Ergebnisbericht schreiben.
9. Nicht senden. Ein eventuelles Speichern ist ein eigener, ausdrücklich
   freigegebener API-Aufruf; ELSTER bleibt technisch blockiert.

## API und MCP

Die HTTP-API ist der ausführende Kern. MCP ist nur ein PC-blinder Wrapper mit
denselben fünf Operationen:

| API | MCP | Wirkung |
| --- | --- | --- |
| `ustva_read` | `sse_ustva_read` | strukturierter, read-only UStVA-Snapshot |
| `ustva_select_period` | `sse_ustva_select_period` | genau ein Dropdown transaktional auswählen |
| `ustva_set_flag` | `sse_ustva_set_flag` | genau ein Kennzeichen transaktional setzen |
| `ustva_change_value` | `sse_ustva_change_value` | katalogisiertes Betragsfeld mit Readback ändern |
| `ustva_open_section` | `sse_ustva_open_section` | eindeutigen Unterbereich öffnen |

Die API nimmt semantische Schlüssel wie `month` + `july` oder `quarter` + `q3`
entgegen und übersetzt sie erst lokal in die deutsche Oberfläche. Absolute
Pfade gelangen nicht in den MCP-Vertrag.

## Bewusste Stopps

- Falljahr, Fallart oder Produktprofil ist nicht ausdrücklich unterstützt; im
  Profil 2025 ist die einzige Folgejahr-Ausnahme `*.GewErfass2026`.
- Der gewünschte Zeitraum ist bereits übermittelt und es gibt keinen
  ausdrücklichen Auftrag für eine Berichtigung.
- Meldefrequenz oder Beleglage ist unklar.
- Das Rechnungsinventar ist unvollständig oder die automatisch erzeugte UStVA
  lässt sich nicht auf die zuvor zurückgelesenen Buchungen zurückführen.
- Original statt Arbeitskopie, Hashabweichung, falsche Seite, unbekannter
  Dialog, fremde Nutzereingabe oder fehlgeschlagener Readback.
- Ein Schritt würde ELSTER, Senden, Abschließen oder eine andere Übermittlung
  auslösen.
