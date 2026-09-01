# Woher die steuerfachliche Begründung kommt

Gilt, sobald du eine betragsrelevante oder strittige Aussage machst. Ohne
Webzugriff gilt sie nicht — dann erklärst du die fachliche Bewertung
ausdrücklich für unterblieben, statt aus dem Gedächtnis zu begründen.

## Rangfolge

Zitiere in dieser Reihenfolge und nimm die erste Stufe, die die Frage trägt:

1. **Gesetz** — [gesetze-im-internet.de](https://www.gesetze-im-internet.de)
   (EStG, UStG, AO, SolzG, GewStG). Der Wortlaut schlägt jede Auslegung.
2. **Verwaltungsauffassung** — [BMF-Schreiben](https://www.bundesfinanzministerium.de/Web/DE/Service/Publikationen/BMF_Schreiben/bmf_schreiben.html).
   Für das Finanzamt bindend. **Achtung:** Das BMF nimmt ältere Schreiben von
   der Seite; verbindlich veröffentlicht sind sie im Bundessteuerblatt
   ([bstbl.de](https://www.bstbl.de)). „Nicht mehr auf der BMF-Seite" heißt
   also nicht „aufgehoben".
3. **Amtliche Anleitungen und Vordrucke** — [formulare-bfinv.de](https://www.formulare-bfinv.de)
   (Formular-Management-System der Bundesfinanzverwaltung) und
   [elster.de](https://www.elster.de). Die Anleitung zur jeweiligen Anlage
   erklärt, was in welche Zeile gehört.
4. **Rechtsprechung** — [bundesfinanzhof.de](https://www.bundesfinanzhof.de).
   Nur veröffentlichte BFH-Entscheidungen; ein Aktenzeichen ohne Fundstelle ist
   keine Belegstelle.
5. **Bundeszentralamt für Steuern** — [bzst.de](https://www.bzst.de) für
   Identifikationsnummer, Belegabruf/VaSt und Auslandssachverhalte.

Ratgeberseiten, Foren, Kanzleiblogs und KI-Zusammenfassungen sind **keine**
Belegstellen. Sie dürfen dich auf eine Fundstelle führen; zitiert wird die
Fundstelle.

## Drei Regeln, an denen Begründungen scheitern

- **Veranlagungszeitraum prüfen.** Pauschalen, Höchstbeträge und Prozentsätze
  ändern sich jährlich. Eine Fundstelle ohne passendes Jahr ist wertlos. Das
  Jahr des Falls steht in `product_info.taxYear` und im Fallkopf.
- **Herstellerhinweise sind keine Rechtsquelle.** Die Steuertipps im Programm
  (`sse_help`, rechte Spalte) und das Steuertipps-Center geben die Auffassung
  des Verlags für dieses Produktjahr wieder. Sie sind ein guter Einstieg und
  ein guter Hinweis darauf, *wo* etwas hingehört — als Begründung gegenüber dem
  Finanzamt taugen sie nicht.
- **Kein Zitat ohne gelesene Stelle.** Wenn du die Fundstelle nicht geöffnet
  hast, sag das. Eine erfundene Randnummer ist schlimmer als keine.

## Was das Programm selbst schon liefert

Vor der Websuche lohnt der Blick nach innen — das ist schneller und passt
sicher zum Falljahr:

| Werkzeug | Inhalt |
| --- | --- |
| `sse_help` | Eingabehilfe, Steuertipps und Prüferhinweise zur offenen Seite |
| `sse_check_page` / `sse_checker_results` | was der Steuerprüfer am Fall bemängelt |
| `sse_result_details` | wie sich das Ergebnis zusammensetzt |

Bei jeder fachlichen Aussage gilt unverändert: keine Steuerberatung im Sinne
des Steuerberatungsgesetzes, und KI-Aussagen sind vor der Abgabe zu prüfen.
