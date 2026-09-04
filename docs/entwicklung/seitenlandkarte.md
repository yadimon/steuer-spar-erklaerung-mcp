# Seitenlandkarte der Einkommensteuer

Gemessen am 2026-09-04 an einem geoeffneten
Herstellermusterfall, SSE `31.0.2.0`. Die Seitenfolge stammt aus einem linearen
`goto`-Durchlauf, die Bauart aus einem `snapshot` je Seite.

**Wozu:** Wer eine Seite profilieren will, soll nicht raten muessen, ob sich das
lohnt. Ein Seitenobjekt bringt nur bei einer **Feldseite** etwas.
Tabellenseiten bedienen `table_add`/`table_update`/`table_delete` ohne
Katalog, Uebersichten haben nichts zu schreiben, und Auswahlseiten bleiben
bewusst `click pattern=select` ueberlassen.

**Verteilung:** 31 Feldseite, 14 Uebersicht, 7 Tabellenseite, 3 Auswahlseite
(von 58 angesteuerten Seiten wurden 55 erreicht).

**Grenzen der Zahlen.** Die Spalte *Felder* zaehlt nicht schreibgeschuetzte
`Edit`-, `ComboBox`- und `CheckBox`-Knoten im Inhaltsbereich. Sie ist eine
**Obergrenze**: Eine ComboBox meldet UIA zweimal, und `ro=false` heisst
"nicht schreibgeschuetzt", nicht "Benutzereingabe" - auf Ergebnisseiten ist das
nicht dasselbe. RadioButtons stehen in *Felder* absichtlich nicht; sie sind im
Profilvertrag kein `fields`-Eintrag. Gemessen wurde **ein** Musterfall; welche
Seiten ueberhaupt erscheinen, entscheiden dessen Themenfilter.

Personennamen des Musterfalls sind durch `<Person>` ersetzt.

**Die Spalte *im Katalog* gilt nur fuer diese Liste.** Sie markiert Seiten, die
in diesem Durchlauf lagen *und* ein Seitenobjekt haben. Katalogisierte Seiten
ausserhalb des Durchlaufs fehlen hier ganz - derzeit 5:
`Haushaltsnahe Ausgaben`, `Private Kranken- und Pflegeversicherung`, `Sonstige Werbungskosten/Fahrten`, `Spenden für steuerbegünstigte Zwecke`, `Spenden und Mitgliedsbeiträge`.

| Seite | Bauart | Felder | Zellen | rechnend | im Katalog |
| --- | --- | ---: | ---: | ---: | --- |
| Sonstige Kapitalerträge | Uebersicht | 0 | 0 | 0 |  |
| Steuer zu anderen Einkünften | Uebersicht | 0 | 0 | 0 |  |
| Beteiligungen | Uebersicht | 0 | 0 | 0 |  |
| Ausländische Investmenterträge ohne inländischen Steuerabzug | Uebersicht | 0 | 0 | 0 |  |
| Verlustvorträge aus Kapitaleinkünften | Feldseite | 8 | 0 | 0 | ja |
| Restfreibetrag für bestandsgeschützte Alt-Anteile | Feldseite | 2 | 0 | 0 |  |
| Kapitalerträge, ermäßigt besteuert | Feldseite | 8 | 0 | 0 |  |
| Ehrenämter und Aufwandsentschädigungen <Person> | Feldseite | 8 | 0 | 1 |  |
| Betreuerfreibetrag <Person> | Feldseite | 1 | 4 | 4 |  |
| Sonstige Leistungen <Person> | Feldseite | 6 | 0 | 4 |  |
| Sonstige Leistungen: Verlustverrechnung | Feldseite | 4 | 0 | 8 |  |
| Nebenkosten-/Hausgeldabrechnung | Tabellenseite | 0 | 24 | 3 |  |
| Handwerker und Dienstleistungen im Haushalt | Uebersicht | 0 | 0 | 0 |  |
| Rechnung Anschlusskosten Kabelanschluss | Feldseite | 6 | 4 | 3 |  |
| Reparatur Waschmaschine | Feldseite | 6 | 4 | 3 |  |
| Haushaltsnahe Dienst- und Handwerkerleistungen | Feldseite | 2 | 0 | 14 |  |
| Riester-Rente: Voraussetzungen für die Förderung | Feldseite | 28 | 0 | 0 | ja |
| 1. Riester-Vertrag (Banksparplan Sparkasse) | Feldseite | 5 | 0 | 0 |  |
| Wichtige Angaben zur Krankenversicherung | Uebersicht | 0 | 0 | 2 |  |
| Gesetzliche Kranken- und Pflegeversicherung | Uebersicht | 0 | 0 | 0 |  |
| Kinder: Übernommene Beiträge zur KV/PV | Uebersicht | 0 | 0 | 0 |  |
| Außergewöhnliche Belastungen | Feldseite | 8 | 0 | 0 | ja |
| Fahrtkosten | Tabellenseite | 0 | 13 | 9 |  |
| Sonstige außergew. Belastungen: Sonstige Reisekosten | Tabellenseite | 0 | 3 | 1 |  |
| Steuern und andere Themen | Feldseite | 18 | 0 | 0 |  |
| Steuerberatungskosten: Übersicht | Uebersicht | 0 | 0 | 5 |  |
| Fachliteratur, PC-Software, etc. | Tabellenseite | 0 | 6 | 4 |  |
| Rechnungen von Steuerberatern | Uebersicht | 0 | 0 | 0 |  |
| Fahrtkosten zur Steuerberatung | Tabellenseite | 0 | 8 | 5 |  |
| Unfallkosten bei Steuerberatung | Feldseite | 1 | 0 | 5 |  |
| Kirchensteuer: Zahlungen und Erstattungen | Tabellenseite | 0 | 9 | 16 |  |
| Tatsächliche Fahrzeugkosten | Auswahlseite | 0 | 0 | 0 |  |
| Zusatzangaben zur Steuererklärung | Feldseite | 3 | 0 | 0 | ja |
| Veranlagungscheck und Zusatzangaben | Feldseite | 2 | 0 | 0 |  |
| Belege prüfen und nachreichen | Uebersicht | 0 | 0 | 0 |  |
| Datensicherung | Uebersicht | 0 | 0 | 0 |  |
| Bescheiddaten | Uebersicht | 0 | 0 | 0 |  |
| Arbeitslohn/Werbungskosten <Person> | Feldseite | 12 | 0 | 22 |  |
| Arbeitslohn/Werbungskosten <Person> | Feldseite | 12 | 0 | 22 |  |
| Gewinneinkünfte <Person> | Feldseite | 10 | 0 | 16 |  |
| Sonstige Einkünfte | Feldseite | 10 | 0 | 10 |  |
| Sonderausgaben | Feldseite | 12 | 0 | 12 |  |
| Sonstige Abzugsbeträge | Feldseite | 10 | 0 | 10 |  |
| Berechnung der Einkommensteuer | Feldseite | 14 | 0 | 16 |  |
| Solidaritätszuschlag und Kirchensteuer | Feldseite | 6 | 0 | 10 |  |
| Sonstige Steuerfestsetzungen | Feldseite | 14 | 0 | 14 |  |
| Bescheidvergleich | Tabellenseite | 0 | 92 | 0 |  |
| Grunddaten | Feldseite | 37 | 0 | 0 | ja |
| ELSTER-Einstellungen | Auswahlseite | 0 | 0 | 0 |  |
| Antrag auf Fristverlängerung | Feldseite | 14 | 3 | 1 |  |
| Antrag auf Anpassung der Vorauszahlungen | Feldseite | 14 | 3 | 1 |  |
| Änderung der Adresse | Feldseite | 15 | 0 | 0 |  |
| Änderung der Bankverbindung | Feldseite | 10 | 0 | 0 |  |
| Fragebogen zur steuerlichen Erfassung | Auswahlseite | 0 | 0 | 0 |  |
| Meine Steuerdokumente | Uebersicht | 0 | 0 | 0 |  |

Die Wege zum Seitenobjekt und die Fallen dabei stehen im
[Funktionskatalog](funktionskatalog.md); der Stand je Faehigkeit in der
[Statustafel](status.md).
