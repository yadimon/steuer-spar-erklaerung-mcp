# Vorlage: Steuerfall gegen externe Belegaufstellung abgleichen

Diese Vorlage enthält bewusst keine echten Personen, Firmen, Steuerdaten,
Beträge oder lokalen Pfade. Fallbezogene Ergebnisse gehören in einen privaten
Arbeitsordner, nicht in dieses Repository.

## Quellen und Schutz

- Steuerfall: `<OPEN_BOUND_CASE>`
- Gegenquelle: `<VERIFIED_LEDGER>`
- Originaldatei vor und nach der Arbeit per SHA256 prüfen.
- Den geöffneten Fall vor der ersten dirty-fähigen UI-Navigation oder Mutation
  einmal privat sichern; eine separate Arbeitskopie nur auf ausdrücklichen
  Wunsch anlegen.
- Übermittlungsstatus vor und nach der Arbeit lesen.
- Niemals ELSTER-, Abschluss- oder Versandaktionen auslösen.

## Summenabgleich

| Bereich | SSE | Gegenquelle | Abweichung | Belegstatus |
|---|---:|---:|---:|---|
| Betriebseinnahmen netto | `<BETRAG>` | `<BETRAG>` | `<BETRAG>` | `<STATUS>` |
| Umsatzsteuer | `<BETRAG>` | `<BETRAG>` | `<BETRAG>` | `<STATUS>` |
| Betriebsausgaben | `<BETRAG>` | `<BETRAG>` | `<BETRAG>` | `<STATUS>` |
| Gewinn/Überschuss | `<BETRAG>` | `<BETRAG>` | `<BETRAG>` | `<STATUS>` |

## Zeilenabgleich

| Externe ID | neutrale Bezeichnung | Datum | Betrag | SSE-Fund | Entscheidung |
|---|---|---|---:|---|---|
| `<ID-001>` | `<BELEGART>` | `<DATUM>` | `<BETRAG>` | ja/nein | `<ENTSCHEIDUNG>` |

Jede Abweichung getrennt klassifizieren:

- fehlender oder doppelter Beleg;
- Brutto/Netto-Verwechslung;
- falscher Steuersatz oder falsche Umsatzsteuer-Zeile;
- Zufluss/Abfluss im falschen Jahr;
- Privatanteil oder nicht abzugsfähiger Teil;
- fehlende Rechnung, Zahlung oder steuerliche Bescheinigung;
- ungeklärte Rechtsfrage, die nicht automatisch geändert werden darf.

## Schreibprotokoll

| Seite | Feld/Tabelle | vorher | beabsichtigt | zurückgelesen | Seitenprüfer |
|---|---|---|---|---|---|
| `<SEITE>` | `<FELD>` | `<ALT>` | `<NEU>` | `<IST>` | sauber/offen |

Nach jedem Schreibschritt:

1. den Wert oder die Tabellenzeile über MCP zurücklesen;
2. Summen und Zeilenzahl gegen die erwartete Änderung prüfen;
3. `sse_check_page` ausführen;
4. nur auf ausdrücklichen Speicherauftrag `sse_save` aufrufen;
5. dann die gespeicherte Datei erneut hashen;
6. andernfalls den In-Memory-Stand offen und klar als ungespeichert melden.

## Offene Punkte

Nur Fakten eintragen, keine Vermutungen:

| Frage | vorhandener Nachweis | fehlender Nachweis | Nutzerentscheidung nötig |
|---|---|---|---|
| `<FRAGE>` | `<DATEI/BELEGART>` | `<WAS FEHLT>` | ja/nein |

Die technischen Einzelheiten und bekannten SSE-Grenzen stehen in
[`docs/entwicklung/erfahrungen/sse-automation-erfahrungen.md`](entwicklung/erfahrungen/sse-automation-erfahrungen.md).
