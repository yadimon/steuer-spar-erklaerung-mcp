> Entwicklungswissen, keine Laufzeit-Anweisung. Enthält auch verworfene oder
> gescheiterte Ansätze und wird nicht von den öffentlichen Skills geladen.

# SSE-Automation: verifizierte Erfahrungen und Grenzen

Diese Referenz enthält ausschließlich wiederverwendbares Wissen über die
SteuerSparErklärung (SSE), den MCP-Server und die Windows-Automation. Sie darf
keine echten Namen, Steuerdaten, Beträge, Belegtexte, Zertifikatspfade,
Screenshots oder Fallpfade enthalten.

## Inhalt

1. [Datenschutz und Falltrennung](#datenschutz-und-falltrennung)
2. [Sicherheitsgrenze](#sicherheitsgrenze)
3. [Arbeitsmodell](#arbeitsmodell)
4. [Gesundheit und Fenster](#gesundheit-und-fenster)
5. [Dialoge und Wiederherstellung](#dialoge-und-wiederherstellung)
6. [Lesen und Navigieren](#lesen-und-navigieren)
7. [Felder, Auswahl und Tabellen](#felder-auswahl-und-tabellen)
8. [Speichern, Kopien und Hashes](#speichern-kopien-und-hashes)
9. [Prüfer, Hinweise und OCR](#prüfer-hinweise-und-ocr)
10. [Bekannte Fehlwege](#bekannte-fehlwege)
11. [Verifikationsmuster](#verifikationsmuster)
12. [Backlog](#backlog)

## Datenschutz und Falltrennung

- Im Repository nur neutrale Platzhalter wie `<CASE_DIR>`, `<CASE_FILE>`,
  `<EXPECTED_VALUE>` und `<ROW_TEXT>` verwenden.
- Roh-Screenshots, OCR-Ausgaben, UI-Snapshots, Exporte und temporäre MCP-
  Aufrufskripte ausschließlich unter `.tmp/` erzeugen. `.tmp/` ist ignoriert.
- Keine echten Namen, Anschriften, Steuernummern, USt-IdNr., Konten,
  Zertifikatspfade, Belegtexte oder Beträge in Tests und Dokumentation ablegen.
- Tests mit Datenbedarf müssen synthetische Fixtures verwenden. Ein privater
  Live-Fall ist nur ein lokaler manueller Test und kein eincheckbares Fixture.
- Fallordner explizit als Werkzeugargument übergeben oder lokal über
  `SSE_CASE_DIR` konfigurieren. Niemals einen privaten Pfad als Codevorgabe
  einbauen.
- Prüferbilder und OCR-Crops nach dem Test löschen. Fehlerberichte nur mit
  redigierten Ausschnitten weitergeben.

## Sicherheitsgrenze

- ELSTER, Senden, Übermitteln, Abschließen und vergleichbare Aktionen bleiben
  hart gesperrt. Eine Umformulierung oder ein Menüweg darf die Sperre nicht
  umgehen.
- Das Lesen eines Hinweises, der das Wort „ELSTER“ enthält, ist nur als exakt
  verifizierter Prüfer-TreeItem zulässig; ein gleich benannter Versandknopf
  bleibt gesperrt.
- `Enter`, Leertaste, `Alt` und `F10` nie ohne engen Kontext senden. Sie können
  den fokussierten Schalter oder die Menüzeile aktivieren.
- USt-Voranmeldungen nur bearbeiten, wenn der Auftrag das ausdrücklich
  umfasst. Eine Jahreserklärung autorisiert keine Quartalsänderungen.
- Originalfälle nicht verändern. Zuerst Hash, Übermittlungsstatus, Sicherung
  und Arbeitskopie herstellen.

### UStVA-spezifische Erkenntnisse

- Die Übersichtsseite kann mehrere Schaltflächen mit exakt demselben sichtbaren
  Namen `Erfassen` enthalten. Ein generischer Namensklick wählte im realen
  Test den falschen Unterbereich. Fachliche Bereiche deshalb über stabile
  AutomationId-Suffixe und die erwartete Zielüberschrift binden.
- `Voranmeldezeitraum`, `Auswahl Monat` und `Auswahl Quartal` sind getrennte,
  dynamisch materialisierte ComboBoxen. Frequenz und konkreten Zeitraum in
  getrennten Transaktionen mit Vor-/Nachwert setzen.
- Eine Umstellung von vierteljährlich auf monatlich verändert sofort den
  UStVA-Zustand und die berechneten Beträge. Das ist keine neutrale Navigation;
  nur in einer Wegwerf- oder verifizierten Arbeitskopie und nie allein aus dem
  Wort „Juli“ ableiten.
- Die Übersicht berechnet Kernbeträge standardmäßig aus den Buchungen. Direkte
  manuelle Hauptbeträge sind ein eigener bewusster Modus; Korrekturfelder wie
  Sondervorauszahlung oder §15a-Berichtigung bleiben davon getrennt.
- Nach jedem Erkundungslauf Änderungen verwerfen und Original-/Kopienhash
  erneut vergleichen. Reale Fallwerte, Steuerdaten und Screenshots bleiben in
  ignorierten lokalen Artefakten.

## Arbeitsmodell

Die zuverlässige Schleife lautet:

1. `sse_health` und `sse_dialog_list` ausführen.
2. Seite mit `sse_page`, `sse_read_page` und bei Zweifel `sse_screenshot`
   erfassen.
3. Erwarteten Ist-Wert lesen.
4. Genau eine kleine Änderung ausführen.
5. Wert, Summen, Zeilenzahl und Prüfermeldung zurücklesen.
6. Nur bei erfüllter Nachbedingung fortfahren.
7. Speichern und Dateihash außerhalb der UI gegenprüfen.

Nicht mehrere Seiten oder Tabellenänderungen blind stapeln. SSE degradiert
unter vielen UIA-Abfragen und kann dann leere oder unvollständige Ergebnisse
liefern, ohne einen klaren Fehler zu melden.

## Gesundheit und Fenster

### Kanarienabfrage

`sse_health` misst eine billige UIA-Abfrage:

- schnell: normal arbeiten;
- langsam und Dialog vorhanden: zuerst Dialog behandeln;
- langsam ohne Dialog: Zustand sichern und kontrolliert neu starten;
- `not found` bei träger UI ist kein Beweis für ein leeres Feld.

Ein gestarteter Prozess ohne verifiziertes Haupt- oder Dialogfenster ist kein
erfolgreicher Programmstart. Nach Ablauf der Startfrist ausschließlich die beim
Start erzeugte PID beenden, die Desktop-Marke entfernen und `startup-timeout`
melden.

### Fensterklassifikation

- Das Hauptfenster ist ein großes SSE-Fenster, nicht einfach das erste Fenster
  in der Enum-Reihenfolge.
- Beim Programmstart kann ausschließlich ein kleiner Wiederherstellungsdialog
  existieren. Ein einzelnes Fenster unterhalb der Hauptfenstergröße darf daher
  nicht als Hauptfenster fehlklassifiziert werden.
- Dialoge, Helferfenster und Ergebnis-/Druckfenster getrennt behandeln.
- Fremde Fenster vor physischen Klicks über HWND und Prozess-ID ausschließen.
- Die Desktop-Marke muss Desktopname und die beim Start erzeugte SSE-PID
  enthalten. Beim Beenden niemals `Stop-Process` nur nach Prozessnamen nutzen;
  sonst würde eine parallele sichtbare SSE-Instanz des Nutzers mitbeendet.
- Beim Schließen alle kleinen Fenster der eigenen PID auf die erwartete
  Speicherantwort prüfen. Ein nicht-modales Werte-Info-Fenster kann sonst vor
  dem eigentlichen Speicherdialog in der Enum-Reihenfolge stehen.
- Nach `Weiter`/`Zurück` kann außerdem das kompakte Fenster »Die Prüfung hat
  ergeben …« offen bleiben. Es ist kein Speicherdialog, blockiert aber
  `WM_CLOSE` des Hauptfensters. Beim Stop der gebundenen versteckten Instanz
  deshalb kompakte Hilfsfenster derselben PID zuerst normal schließen und erst
  danach das Hauptfenster. Der Regressionstest verlangt anschließend
  `hartBeendet=false` und einen unveränderten Falldatei-Hash.

### Sichtbarer und versteckter Desktop

- Ein bereits auf dem sichtbaren Desktop gestarteter PowerShell-Worker kann
  nach dem Erzeugen eines Fensters nicht zuverlässig per `SetThreadDesktop`
  wechseln (Win32-Fehler 170). Den ersten SSE-Start deshalb mit
  `EnumDesktopWindows` direkt auf dem Ziel-Desktop verifizieren. Alle späteren
  Lese-, Status- und Stop-Worker müssen bereits auf diesem Desktop geboren
  werden.
- ValuePattern, Lesen, Screenshots und viele InvokePattern-Schalter können auf
  einem eigenen Desktop funktionieren.
- Sichtbare Tabellenzellen sind `DataItem`-Elemente mit `ValuePattern`. Sie
  lassen sich auf dem versteckten Desktop schreiben und zurücklesen. Auch eine
  bereits sichtbare freie Zeile kann so angelegt werden.
- Das Materialisieren virtualisierter Tabellenzeilen, echtes Löschen, physische
  Maus, Tastatur, Qt-Suchtreffer und Qt-Baumknoten brauchen einen sichtbaren
  interaktiven Desktop.
- Ein normaler Windows-Virtual-Desktop verhindert nicht, dass SSE beim
  Seitenwechsel in den Vordergrund kommt. Echte Parallelität braucht eine
  getrennte Windows-Sitzung.

## Dialoge und Wiederherstellung

### Dialogvertrag

1. `sse_dialog_list` liefert Text, erlaubte Schalter und Fingerprint.
2. Die Entscheidung fachlich treffen.
3. `sse_dialog_answer` mit demselben HWND und Fingerprint aufrufen.
4. Folgedialog erneut lesen; niemals automatisch durch eine Dialogkette
   bestätigen.

Der Fingerprint verhindert, dass ein inzwischen ausgetauschter Dialog mit
einer veralteten Antwort bedient wird.

- Vor der Antwort zusätzlich die Owner-/Popup-Kette prüfen. Nur der tiefste
  aktive Popup darf beantwortet werden. Beim CSV-Export bleibt das
  Export-Elternfenster offen, während darüber ein nativer Ordnerdialog liegt;
  ein Klick auf den verdeckten Eltern-Dialog kann SSE destabilisieren.
- Für die Antwort nicht jedes Qt-Nebenfenster erneut vollständig per UIA/MSAA
  inventarisieren. Zielfenster vor dem Klick tief beschreiben, danach zunächst
  nur die schnelle Fensterliste lesen und ausschließlich neue bzw. noch offene
  Dialoge tief beschreiben. Das bewahrt Fingerprint- und Dirty-State-Nachweise,
  ohne Werte-Info und Tipps jedes Mal teuer erneut zu lesen.
- Der Export-Schalter ist ein absichtlicher Sonderfall der Nachbedingung: Das
  Elternfenster darf offen bleiben, wenn genau ein neuer, oberster,
  fingerprintgebundener Ordnerdialog erscheint. Das ist Fortschritt zu einem
  Folgedialog, kein wirkungsloser Klick.
- Eingeschränkte Produktprofile und automatische Live-Testhelfer beantworten
  ausschließlich die exakt betitelte passive Gewinnnotiz mit genau einem
  `OK`: Der Text muss case-sensitiv dem belegten Satz mit `»Betriebsname«`
  entsprechen. Recovery- und Importdialoge bleiben auch bei einer
  Wegwerfkopie unangetastet, solange keine explizite Eigentumsbindung an genau
  diesen Startvorgang existiert.

### Wiederherstellungsdatei

- Nach hartem Prozessabbruch kann beim nächsten Start ein Dialog zur
  Wiederherstellungsdatei erscheinen.
- Vor „Ja“ oder „Nein“ regulär gespeicherte Datei, Änderungszeit und SHA256
  prüfen.
- Ist die reguläre Datei nachweislich aktuell und vollständig, kann die alte
  Wiederherstellung verworfen werden. Bei Unsicherheit nicht antworten, sondern
  beide Zustände sichern und den Nutzer fragen.
- Wird bewusst eine geprüfte Arbeitskopie geöffnet und der reguläre Dateihash
  stimmt, darf eine ältere Recovery-Datei mit fingerprintgebundenem „Nein“
  verworfen werden. Danach immer beweisen, dass der Dialog geschlossen ist.
- `sse_close` zuerst normal mit bewusster Speicherentscheidung verwenden.
  `force=true` nur für einen nachgewiesenen Hänger; ein Force-Kill erzeugt mit
  hoher Wahrscheinlichkeit den nächsten Recovery-Dialog.

## Lesen und Navigieren

### Seiten lesen

- `sse_page` liefert strukturierte Felder, Tabellen, Aktionen und Überschrift.
- `sse_read_page` bildet sichtbare Inhalte zeilenweise ab. Beschriftung und
  Wert müssen anhand Y-Überlappung, nicht transitiver Nachbarschaft, verbunden
  werden.
- `sse_snapshot` ist Diagnosewerkzeug. Ein TreeWalker-Zyklus muss in `stats`
  sichtbar bleiben; nie still als vollständiger Baum ausgeben.
- `sse_screenshot` ist der unabhängige visuelle Kontrollweg und funktioniert
  oft auch dann, wenn UIA unvollständig ist.

### Navigation

- Normale Schalter wie „Weiter“, „Zurück“ und „Sichern“ bevorzugt per
  InvokePattern bedienen.
- Qt-Navigationsbaum: UIA `Invoke`, `Select` und `SetFocus` können Erfolg
  melden, ohne die Seite zu wechseln. Hier ist ein gegen PID und exaktes
  `GA_ROOT`-Hauptfenster verifizierter physischer Klick nötig.
- Dasselbe gilt für die Ergebnisliste der globalen Suche. Auf einem versteckten
  Desktop sind Treffer und Pfad vollständig lesbar, aber weder UIA-Pattern noch
  `PostMessage`, `SendMessage`, WinForms-/COM-SendKeys oder Client-Mausnachrichten
  aktivieren die Seite. `sse_goto useSearch=false` muss dann linear blättern;
  eine Zweiggrenze erfordert einmal sichtbar den Baumklick.
- Nach jedem Baumklick die Überschrift erneut lesen. Ein erfolgreicher Klick
  ist keine erfolgreiche Navigation.
- Für lange Bäume zuerst an den Anfang rollen, dann in kleinen Schritten
  scrollen. Nicht zwanzig Seiten ohne Zwischenprüfung abfahren.
- Menü-Popups explizit lesen und schließen. Keine globalen Tastenkürzel als
  Ersatz für eine unbekannte Menüstruktur verwenden.
- Übersichtszeilen können in Qt als gemeinsame Gruppe aus `Caption`,
  schreibgeschütztem `Wert` und unbeschriftetem `Button` exponiert werden.
  `sse_subpages` ordnet diese direkten Geschwister generisch über denselben
  UIA-Parent und die offizielle `RedThreadContent`-Struktur zu und gibt `rid`,
  `aid`, Beschriftung und aktuellen Anzeigewert zurück. Keine konkrete
  Gegenstandsseite oder private Fallbezeichnung als Page Object speichern.

## Felder, Auswahl und Tabellen

### Texte und Zahlen

- Vor dem Schreiben den Feldknoten über AutomationId oder RuntimeId eindeutig
  auflösen.
- ValuePattern verwenden, danach denselben Wert über einen neuen Snapshot
  zurücklesen.
- Zahlenformat der Oberfläche respektieren. Anzeigeformat und interne
  Berechnung können sich unterscheiden; zusätzlich Summen prüfen.
- Ein nicht beschreibbares oder ausgeblendetes Feld nie über Koordinaten
  „erraten“.
- Boolesche Zellen innerhalb einer Qt-Tabelle erscheinen als `DataItem` mit
  `TogglePattern`, nicht als normale `CheckBox`. `sse_table_update` behandelt
  dafür ausschließlich die expliziten Werte `"true"`/`"false"` als Toggle,
  bindet alle Zellen derselben Zeile gemeinsam und rollt Toggle und Wertzellen
  in umgekehrter Spaltenreihenfolge zurück. Zahlen wie `0`/`1` bleiben normale
  Tabellenwerte und werden nicht als boolesch geraten.
- Qts `TogglePattern` kann bei solchen `DataItem`-Zellen wirkungslos bleiben.
  Nur im sichtbaren Modus darf dann nach unverändertem Toggle-Readback ein
  PID-/Root-verifizierter Klick auf das frisch gelesene Zellrechteck folgen.
  Die eigene Eingabeepoche wird danach neu gebunden; ein späterer Rollback muss
  dieselbe Methode in umgekehrter Reihenfolge verwenden. Auf einem versteckten
  Desktop bricht der Vorgang stattdessen ab.

### Checkboxen, Radio und Comboboxen

- Checkbox-/Radio-Zustand im Snapshot aus Toggle-/SelectionPattern ausgeben.
- Nach `toggle` den Zustand erneut lesen; ein erfolgreicher Pattern-Aufruf
  genügt nicht.
- Generisches `click pattern=toggle` darf keine fachlichen Zustände ändern.
  Echte CheckBoxen brauchen eine Transaktion aus exakter Seite,
  eindeutigem Knoten, booleschem Vor-/Ziel-/Nachzustand sowie Eingabe- und
  Fenster-Epoche. RadioButtons sind über `click pattern=select` nur mit exakter
  AutomationId sicher schreibbar, wenn die gesamte Gruppe mit genau einer
  vorher/nachher ausgewählten Option sowie Eingabe-, Fenster- und Seitenepoche
  gebunden wird.
- Combobox-Optionen zuerst auflisten, dann exakt auswählen und zurücklesen.
- Lange Qt-Comboboxen materialisieren im UIA-Baum oft nur den sichtbaren
  Ausschnitt. Auf dem sichtbaren Desktop die eindeutig gebundene Liste mit
  `Home` und einem PID-/Root-verifizierten Mausradpunkt seitenweise
  materialisieren und erst den echten, exakt benannten `ListItem` anklicken.
  `PageDown` reicht bei editierbaren Qt-Comboboxen nicht, weil der Fokus am
  Edit-Kind bleibt. Weder das
  `ValuePattern` der Liste noch das `Edit`-Kind auswählen lassen: Beide zeigen
  den Text zwar an, erzeugen aber nur eine von SSE als „Fehlerhafte Eingabe“
  markierte Scheinwahl.
- Qt kann SelectionPattern bestätigen, ohne die sichtbare Auswahl zu ändern.
  Bei RadioButtons kann sogar der sichtbare UIA-Zustand wechseln, ohne dass die
  fachliche Abhängigkeit neu berechnet wird. Deshalb auf dem sichtbaren Desktop
  den exakt gebundenen Mittelpunkt PID-/Root-verifiziert klicken; auf einem
  versteckten Desktop bleibt die Mutation gesperrt.
- Auch eine Dropdown-Auswahl ist eine fachliche Transaktion: exakte Seite,
  eindeutige ComboBox, AutomationId-Präfix der Optionen, Vor-/Nachwert sowie
  Eingabe- und Fenster-Epoche gemeinsam binden. Einen eigenen
  Nachbedingungsfehler nur zurückrollen, wenn die ComboBox noch exakt den
  selbst gewählten Wert zeigt; nach einem dritten Wert oder Interferenz nicht
  blind die alte Option überschreiben.
- Die neutrale Gewinn-Fixture öffnet auf einer Seite ohne ComboBox. In dieser
  Konstellation sind Schema, Fail-Closed-Guards und Quellinvarianten testbar,
  ein echter Auswahl-/Rollback-Lauf aber erst mit einer ausdrücklich neutralen
  Fixture möglich, die auf einer ComboBox-Seite startet. Dies nicht als real
  getesteten Erfolg ausgeben.

### Tabellen lesen

- Qt virtualisiert Zeilen. „Sichtbare Zeilen“ sind nicht automatisch die ganze
  Tabelle.
- Tabellenleser müssen Zeilen materialisieren, deduplizieren und angeben, ob
  sie vollständig oder nur sichtbar gelesen haben.
- Vor Datenänderungen Spaltenreihenfolge, aktuelle Zeilenzahl und relevante
  Summen erfassen.

### Tabellen hinzufügen

1. Freie Zeile eindeutig bestimmen.
   Auf Seiten mit mehreren Tabellen die Zielregion geometrisch zwischen der
   ausdrücklich gewählten Summenzeile und der vorhergehenden Summenzeile
   begrenzen; die letzte freie Zeile innerhalb dieser Region verwenden.
2. Werte in Spaltenreihenfolge setzen.
3. Jede Zelle zurücklesen.
4. Zeilenzahl und Summen gegen die erwartete Differenz prüfen.
5. Seitenprüfer ausführen.

Ist die freie Zeile sichtbar, darf `sse_table_add` ausschließlich ValuePattern
verwenden und funktioniert auch versteckt. Ist sie virtualisiert, muss das
Werkzeug auf dem versteckten Desktop mit `hidden-desktop` abbrechen statt eine
Tastatureingabe zu versuchen.

Eine globale Suche nach der ersten freien `DataItem`-Zeile ist unsicher: Auf
„Kapitalerträge und sonstige Einnahmen“ wurde damit die Leerzeile der ersten
Tabelle beschrieben, obwohl `Summe Sonstige Einnahmen` als Kontrollsumme
angegeben war. Die abweichende Nachsumme löste zwar den vollständigen Rollback
aus, die falsche Mutation muss aber bereits durch die regionale Vorbedingung
verhindert werden.

### Tabellen aktualisieren

- Eine bestehende sichtbare Zeile über einen eindeutigen Zelltext finden.
- Exakte Seite und die zum Summenlabel gehörende Tabellenregion binden; Treffer
  außerhalb dieser Region ignorieren beziehungsweise als Fehler behandeln.
- Zellen rein per ValuePattern aktualisieren; `null` bedeutet „Spalte nicht
  verändern“.
- Vor- und Nachsumme sind Pflicht. Bei einer Abweichung jede bereits
  beschriebene eigene Zelle auf ihren vorher gelesenen Wert zurücksetzen.
- Vor dem ersten Schreiben alle Zielzellen gemeinsam auf ValuePattern,
  Schreibschutz und aktuellen Vorwert prüfen. Vor Rollback wiederum alle
  geänderten Zellen gemeinsam prüfen; ein fremder Wert verhindert den gesamten
  Rollback, bevor eine Zelle überschrieben wird.
- Nach fremder Benutzereingabe, Fenster-/Seitenwechsel oder fremdem Zellwert
  keinen blinden Rollback und kein Speichern auslösen.
- Dafür `sse_table_update` verwenden. Das ist der sichere versteckte Ersatz
  für „Zeile löschen und neu anlegen“, wenn eine Null-/Ersatzzeile fachlich
  vertretbar ist.

### Tabellen löschen

- Zeile über eindeutigen Text beziehungsweise RuntimeId auswählen.
- Exakte Seite und Summenregion vor der Suche binden; nur Zellen zwischen der
  ausgewählten Summenzeile und der vorherigen Summenzeile dürfen Ziel sein.
- Vorher eine erwartete Summe angeben, wenn ein falscher Kontext finanziell
  relevant wäre.
- Nach dem Löschen beweisen: Zielzeile fehlt, Zeilenzahl ist um eins kleiner,
  Summe entspricht der erwarteten Nachsumme.
- Haben mehrere Abschnitte dieselbe Summenbeschriftung und denselben Wert,
  eine explizite `sumOccurrence` (von oben gezählt) verlangen. Nie den ersten
  Treffer raten.
- Scheitert eine Nachbedingung, Ergebnis als Fehler mit Rollback-Information
  zurückgeben; generische Fehlermeldungen dürfen diese Daten nicht verschlucken.
- Zwischen exklusiver Auswahl und Löschbefehl Seite, Ziel-RuntimeId,
  Kontrollsumme, Fensterfingerprint und Benutzereingabe erneut prüfen.
- Nach fremder Eingabe, Fenster- oder Seitenwechsel kein blindes `Strg+Z`: Der
  Undo-Stack könnte inzwischen eine Nutzeraktion enthalten. Zustand melden,
  nicht speichern und neu synchronisieren.

## Speichern, Kopien und Hashes

### Arbeitskopie

- Quellhash vor dem Kopieren prüfen.
- Ziel darf nicht existieren und muss dieselbe Fallendung haben.
- Nach dem Kopieren Quellhash erneut lesen und Zielhash mit der Quelle
  vergleichen.
- Bei abweichendem Ziel die neu erzeugte Kopie entfernen und den Rollback
  melden.

### Fallbereinigung

- Alte Test- und Zwischenfälle nicht per Wildcard oder UI-Liste löschen.
- Den kompletten aktiven Bestand in zwei hashgebundene Mengen aufteilen:
  archivieren und behalten. Unbekannte dritte Dateien müssen die Aktion stoppen.
- Bereits übermittelte oder nicht sicher lesbare Fälle niemals automatisch
  archivieren.
- Das Archiv außerhalb des aktiven Fallordners neu anlegen, jede verschobene
  Datei erneut hashen und den Restbestand vollständig prüfen.
- Bei jeder Abweichung alle bereits bewegten Dateien zurückstellen. Ein
  Prüfsummenmanifest im Archiv erhält die Wiederherstellbarkeit.

### Speichern

- Vor `sse_save` erwarteten Pfad und optional Vorhash angeben.
- Nach dem Speichern Pfad, Änderungszeit und Hash prüfen.
- Eine offene Suchansicht blendet in Qt die normale Hauptsymbolleiste und
  damit „Sichern“ aus. `sse_save` schließt ausschließlich die exakt erkannte
  Suchansicht im bereits pfadgebundenen Hauptfenster und liest den Baum danach
  neu; ein allgemeiner Escape-/Tastatur-Fallback wäre zu mehrdeutig.
- Liefert der Arbeitsprozess nach ausgelöstem Speichern ausnahmsweise kein
  JSON, ist der Zustand unbestimmt: niemals mit dem alten Vorhash erneut
  speichern. Erst die Falldatei neu hashen. Ist der Hash gewechselt, mit dem
  neuen Hash einen reinen `sse_save`-Nachcheck verlangen; nur
  `noChanges=true`, deaktiviertes „Sichern“ und stabile Kopfdaten belegen dann
  den gespeicherten Zustand.
- Ein aktivierter Sicherungsbutton ist ein Hinweis, aber kein alleiniger
  Beweis für steuerliche Änderungen: Navigation oder Prüferansicht kann den
  UI-Zustand ebenfalls „dirty“ erscheinen lassen.
- Bei reinem Prüfer-/Navigationszustand normal schließen und im Speicherdialog
  bewusst „Nein“ wählen, wenn die zuvor gespeicherte Datei per Hash feststeht.

### Speichern unter / Dateidialoge

- Dateidialog separat lesen. Pfad und Dateiname über die dafür vorgesehenen
  Felder setzen, nicht per unkontrollierter Tastaturfolge.
- Überschreibdialoge nie automatisch bestätigen.
- Nach `Save As` prüfen, dass das Ziel existiert, den erwarteten Header hat und
  das Original unverändert blieb.

### Übermittlungsstatus

- `ElsterTransferTime` aus dem Dateikopf ist dreiwertig zu behandeln:
  `true`, `false` oder `unknown` bei Parserfehler.
- Ein Parserfehler darf niemals in `transmitted=false` umgedeutet werden.
- Status nach jeder Sitzung erneut prüfen.

## Prüfer, Hinweise und OCR

### Automatisches Warnfenster

- »Die Prüfung hat ergeben …« ist ein eigenes `OpenWarningsDlg`, nicht die
  globale Prüferseite und nicht die rechte Eingabehilfe.
- UIA exponiert Meldungstitel, die Aktionen »Als gelesen markieren«, »Jetzt
  ignorieren« und »Hilfe« sowie den Schließen-Schalter. Der erklärende
  Fließtext liegt dagegen nur gerendert im großen TreeItem.
- `TextPattern`, `ValuePattern`, RawView und begrenzte MSAA-Punkte lieferten im
  realen 2025-Test nur den Titel »Steuerfreie Umsätze?«, nicht die Begründung.
  Windows-OCR des exakt verifizierten 489×327-Fensters las den vollständigen
  Hinweis. `sse_warning_popup_read` kapselt diesen Hybridweg.
- »Als gelesen markieren« und »Jetzt ignorieren« sind Dialogaktionen, keine
  Steuerfelder. Trotzdem ausschließlich nach aktuellem Fingerprint über
  `sse_dialog_answer` auslösen. »Jetzt ignorieren« wurde auf einer
  Wegwerfkopie mit geschlossenem Fenster und unverändertem Dateihash geprüft.

### Seitenprüfer

- `sse_check_page` betrifft die aktuelle Eingabeseite.
- Meldungen, rote Baumfehler und leere Pflichtfelder getrennt ausgeben.
- Hinweise sind nicht automatisch Fehler. Fachliche Bedeutung anhand der
  Quelldaten prüfen.

### Globaler Prüfer

- Der globale Prüfer ersetzt links den Navigationsbaum durch zwei Gruppen:
  Fragen/Warnungen und Tipps/Zusatzinformationen.
- Aufgeklappte Detailkarten erscheinen als zweiter, eingerückter TreeItem mit
  demselben Namen und dürfen nicht als zusätzliche Meldung gezählt werden.
- Qt liefert am letzten Warnungsknoten in beobachteten Versionen einen
  `GetNextSibling`-Zyklus. Serien aus Zeilenklick plus Pfeiltaste öffnen Karten
  wiederholt, dauern lange und stören den Nutzer. Dieser Ansatz ist deaktiviert.
- `konsistent=false` bedeutet fail-closed: der sichere Einzelsnapshot ist
  unvollständig. Nie `0 Tipps` als fachlichen Befund melden, wenn der zweite
  Gruppenkopf nicht gesehen wurde.
- Bei inkonsistentem Baum Screenshot verwenden. Eine exakt benannte Meldung
  darf nur geöffnet werden, wenn sie im aktuellen sicheren Snapshot selbst
  sichtbar ist; niemals per Pfeiltasten danach suchen.
- Nach dem Zuklappen aller Karten kann der TreeWalker-Baum unvollständig sein,
  obwohl die komplette Liste im Screenshot sichtbar bleibt. Der erste exakte
  Klick setzt in diesem Zustand gelegentlich nur den Qt-Fokus; erst ein zweiter
  exakter Klick klappt die Karte auf. Jeder Versuch braucht die Nachbedingung
  `aufgeklappt`.
- Mehrere Karten können gleichzeitig offen sein. Das Zuklappen einer älteren
  Karte kann auch jüngere Karten schließen. Deshalb Detail zuerst lesen und
  das automatische „nur diese Karte offen lassen“ nicht als kritischen
  Standard verwenden.
- `sse_checker_reset` schließt Karten gezielt, garantiert aber wegen des
  Provider-Zyklus keinen anschließend konsistenten UIA-Baum. Danach Screenshot
  und Snapshot erneut prüfen.
- Das Verbreitern, vollständige scrollende Zusammenführen und Abhaken der
  Tipps bleibt Backlog.
- Der Toolbar-Schalter „Prüfer“ ersetzt nicht den fallweiten Prüflauf.
  `sse_checker_run` ist nur auf der Seite „Steuererklärung prüfen“ belastbar;
  ein Toggle-Pattern ohne erneuten Zustands-Readback ist kein Öffnungsbeweis.

### OCR

- Vor OCR `TextPattern`, `ValuePattern`, `LegacyIAccessiblePattern`, RawView
  und eine begrenzte MSAA-Punktabfrage prüfen. Beobachtet wurden bei
  Prüfer-Detailkarten zwar Invoke-/Value-/GridItem-/SelectionItem-/TableItem-
  Muster, aber kein TextPattern und keine RawView-Kinder; der Fließtext blieb
  strukturell unsichtbar. Dann nur die exakt verifizierte Kartenfläche
  fotografieren und lokal OCR ausführen.
- Einen rekursiven MSAA-Baum der Qt-Hauptoberfläche nicht laufen lassen: Der
  native Provider kann den isolierten Arbeitsprozess beenden. Punktabfragen
  innerhalb des bereits verifizierten Rechtecks sind der sichere Diagnoseweg.
- OCR-Ausgabe immer zusammen mit dem Kontrollbild bewerten. Umlaute, Zahlen
  und abgeschnittene letzte Zeilen manuell prüfen.
- Lange Karten vor dem Crop kontrolliert in den sichtbaren Bereich rollen.
- OCR und Bilddatei nur temporär speichern und anschließend löschen. Warn- und
  Prüferbilder werden im selben Worker-Aufruf gelesen, optional als Base64 in
  die MCP-Antwort aufgenommen und im `finally` entfernt; zwischen Worker und
  Node wird kein privater Temp-Pfad mehr weitergereicht. Die Löschung wird mit
  `Test-Path` nachgemessen; ein verbleibendes Bild ist ein Fehler, kein Erfolg.
- `StandardOutput` und `StandardError` eines OCR-Helfers gleichzeitig asynchron
  leeren. Zwei serielle `ReadToEnd()`-Aufrufe können sich bei gefülltem
  Fehlerkanal gegenseitig blockieren.
- Für schnelle reine Zustandskontrollen darf `sse_warning_popup_read ocr=false`
  nur die strukturierten Titel und Aktionen lesen. Für die fachliche Bewertung
  bleibt der Fließtext Pflicht.
- Der Launcher erstellt den versteckten Worker zunächst suspendiert, ordnet ihn
  einem Windows-Job mit `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` zu und setzt ihn
  erst danach fort. Stirbt der Launcher oder läuft sein Timeout ab, werden auch
  OCR-Kinder beendet; ein normaler `finally` bleibt trotzdem der primäre
  Dateiaufräumpfad.
- Bei automatischen Warnfenstern bindet der UIA-Fingerprint nicht den nur per
  OCR sichtbaren Fließtext. Deshalb ist dessen `bodyFingerprint` bei der
  Antwort Pflicht und wird unmittelbar vor dem Klick neu erzeugt.

### Eigentum am versteckten Desktop und Dialoge

- Ein Desktopname ist kein ausreichender Eigentumsnachweis. Der aktuelle
  Marker-Vertrag enthält Schemaversion, Owner, validierten ASCII-Namen und die
  PID genau des Prozesses, den der MCP selbst mit `CreateProcess` gestartet
  hat. Alte Name-/Name+PID-Marker bleiben nur lesbar, nicht neu erzeugbar.
- Nur eine wirklich fehlende Markerdatei bedeutet sichtbaren Desktop. Leere,
  zu große, nicht streng UTF-8-lesbare, syntaktisch defekte oder unerwartet
  erweiterte Marker stoppen Node und PowerShell mit
  `desktop-marker-invalid`; stiller sichtbarer Fallback wäre ein
  Sicherheitsfehler.
- Beim Start nur Fenster dieser neuen PID akzeptieren. Die größte oder einzige
  SSE-Instanz zu übernehmen kann eine ältere Sitzung adoptieren und den neuen
  Prozess verwaisen lassen.
- Eine aktive Marke wird niemals überschrieben: neue Marker entstehen mit
  `CreateNew`. Ist ihr Prozess tot, darf sie erst entfernt werden, wenn der
  markierte Desktop nachweislich kein SSE-Fenster mehr enthält und
  Owner/Name/PID unmittelbar vor dem Cleanup noch übereinstimmen.
  PowerShell kann Vergleich und Löschen nicht als eine atomare Dateisystem-
  Operation ausdrücken; das kleine verbleibende Read→Delete-Fenster wird durch
  exklusives `CreateNew` und die einzige freigegebene Writer-Grenze minimiert,
  aber nicht als mathematisch ausgeschlossen behauptet.
- Das test-only Eigentum `center-test` wird nur mit explizitem
  `SSE_CENTER_LIVE_TEST=1` und ausschließlich für `center_cases` sowie
  `center_refresh` akzeptiert. Der Center-Launcher hält einen
  Kill-on-close-Job offen; beendet sich der Test oder seine Pipe, endet nur
  der exakt gestartete Center-Prozessbaum. Absolute Center-Pfade bleiben im
  Testprozess und erscheinen weder im API-Ergebnis noch im wertfreien Trace.
- Qt-Schalter im Center können gleichzeitig `TogglePattern` und
  `InvokePattern` anbieten. `TogglePattern` änderte live nur den zugänglichen
  Haken, ohne die Fallansicht umzuschalten; erst `InvokePattern` erzeugte die
  Pfadzeile der Verzeichnisansicht. Deshalb nach jeder Aktivierung die
  semantischen Seitenknoten begrenzt pollen und den ursprünglichen Modus erneut
  nachweisen, nicht nur den Toggle-State.
- Ein liegengebliebener `center-test`-Marker sperrt alle normalen Aktionen,
  darf aber über `desktop_status` read-only als `markeVeraltet` diagnostiziert
  werden. Nur der Test entfernt ihn bei exakt gleichem Owner/Name/PID; sonst
  ist manuelle Prüfung Pflicht.
- Umgekehrt besitzt ein normaler SSE-Marker keinen Center-Prozess:
  `center_cases`/`center_refresh` stoppen dann mit `desktop-marker-owner`, statt
  den Center irreführend auf dem privaten SSE-Desktop zu suchen.
- `desktop_status` darf nicht über den markierten Desktop-Launcher geroutet
  werden: Ist dieser Desktop nach einem Crash verschwunden, könnte dort gerade
  kein Worker mehr starten. Status läuft sichtbar, öffnet das Desktop-Objekt
  read-only und kann so `markeVeraltet=true` sowie
  `desktopErreichbar=false` zuverlässig melden.
- Stop verlangt drei übereinstimmende Beweise: gültige Marke, lebendes
  Prozessobjekt mit Name `SSE` und Fenster dieser PID auf dem markierten
  Desktop. Fehlt einer, nichts schließen oder beenden.
- Vor dem Hauptfenster nur ausdrücklich bekannte Hilfsfenster schließen.
  Unbekannte Qt-/native/sonstige Fenster zuerst vollständig beschreiben und
  fingerprintgebunden bearbeiten; nie pauschal `WM_CLOSE` senden.
- Close-/Stop-Werkzeuge speichern nicht über ungebundene Dialogantworten.
  Zuerst `sse_save` mit exaktem Pfad und Vorher-Hash, danach schließen.
  `save=true` ist dort gesperrt.
- Auch der sichtbare `sse_close` bindet genau ein HWND/eine PID. Ein Hänger
  rechtfertigt keinen impliziten Datenverlust: Hard-Kill nur mit
  `discardChanges=true`; `force=true` und `save=true` sind unvereinbar.
- Für einen physischen Dialogklick reichen gleiche PID und alte Koordinaten
  nicht. Direkt vorher müssen `WindowFromPoint`, `GetAncestor(..., GA_ROOT)`,
  Ziel-HWND sowie bei MSAA Name, Rolle `PushButton` und aktuelles Rechteck
  erneut übereinstimmen.
- `Get-DialogDescriptor` darf UIA-/MSAA-Ausnahmen nicht verschlucken. Ein
  aktives Warnfenster mit unlesbarem Baum ist ein Fehlerzustand, kein leerer
  erfolgreicher Befund.
- Dialogaktionen können einen Fall dirty machen, auch wenn sie keine Zahl
  ändern. Deshalb `ungespeichert` vor und nach der Aktion melden.

### Ergebnisanzeige und Was-wäre-wenn

- Der Knopf rechts unten öffnet das nicht-modale Fenster „Werte-Info“. Seine
  Tabelle ist im Gegensatz zu Prüfer-Detailkarten vollständig per UIA lesbar;
  OCR ist dafür unnötig.
- Jede sichtbare Zeile besteht aus vier `DataItem`-Zellen: beobachteter Wert,
  aktuell, festgehaltener Vergleichswert und Differenz. Die UIA-Kopfzeile kann
  „Differenz“ optisch einer Nachbarspalte zuordnen; die Semantik deshalb aus
  Zellposition und den Vergleichswerten normalisieren.
- `sse_result_details` darf Werte-Info bei Bedarf öffnen und muss
  `vollstaendig` melden. Es setzt keinen Vergleichsstand und ändert keine
  Steuerdaten. `vollstaendig=true` verlangt vier positionierte Spalten, keine
  0×0-/virtualisierten Zellen, keinen nur teilweise sichtbaren Scrollbereich
  und eine numerisch stimmige Beziehung
  `Differenz = Aktuell − Festgehalten`. Negative Bildschirmkoordinaten allein
  sind auf Mehrmonitor-Systemen kein Fehler.
- Vor jeder Ergebnislesung genau ein SSE-Hauptfenster binden. Ist mehr als ein
  2025-Fall sichtbar, ist `hwnd` Pflicht; ein bereits offenes Werte-Info-Fenster
  einer anderen PID darf niemals ersatzweise gelesen werden.
- „Werte festhalten“ ist ein eigener UI-Zustandswechsel. Erst nach bewusster
  Entscheidung auslösen; für reine Ergebnislesung nicht erforderlich.

## Produkt-, Jahres- und Prozessgrenze

- Alle installierten Jahresversionen heißen `SSE.exe` und laufen als Prozess
  `SSE`. Prozessname und Fenstertitel unterscheiden alte Fälle deshalb nicht
  sicher. Für Steuerjahr 2025 müssen zusätzlich der Ordnername
  `Steuerjahr 2025` und `FileVersionInfo.FileMajorPart = 31` stimmen.
- Die feste binäre `FileMajorPart` ist maßgeblich. Den frei formatierten Text
  `FileVersion` nur als Diagnose und höchstens als Fallback verwenden; Präfixe
  oder andere Trennzeichen dürfen den Server nicht versehentlich lahmlegen.
- `sse_product_info` meldet unterstützte und ignorierte laufende Prozesse.
  Prozesse mit abweichender oder unlesbarer Identität dürfen in keiner
  Fenster-, Close- oder Stop-Action auftauchen.
- Freie Prozessnamen sind keine Diagnosehilfe, sondern eine Privacy- und
  Zukunftsgefahr: `Get-Process -Name` akzeptiert Wildcards und könnte fremde
  Fenstertitel ausgeben. Nur exakt `SSE` und für die Fallauswahl
  `SteuertippsCenter` erlauben; Steueraktionen zielen immer fest auf SSE 2025.
- Den Startmodus auch ohne Falldatei im Worker validieren. Eine MCP-Enum allein
  genügt nicht, weil der Worker auch direkt aufrufbar ist und der Modus in die
  native Kommandozeile eingeht.
- Bei Falldateien Jahr und Dokumenttyp vor Existenz und vor Prozessstart an den
  Modus binden: `einur` → `Gew`, `normal` → `ESt`, `einurvor` → `GewErfass`
  usw. Eine `.Gew2024` oder `.ESt2025` mit `einur` ist kein zulässiger Start.
- Auch ein sichtbarer Start braucht Eigentumsnachsorge: Erzeugt die eigene PID
  innerhalb der Frist kein verifiziertes Fenster, genau dieses Prozessobjekt
  beenden und den Erfolg melden. Sonst bleibt eine später mehrdeutige,
  steuerbare Instanz zurück.
- `Get-SSE2025Processes` soll Prozessobjekte in einer Enumeration prüfen und
  weiterreichen. Identitäten zu IDs reduzieren und dieselben PIDs erneut
  öffnen kostet unnötig Zeit und vergrößert das TOCTOU-Fenster.
- Regressionen nicht nur durch das MCP-Schema testen. Ein direkter Worker-Test
  muss freie Prozessnamen und manipulierte Modi ablehnen; vor/nach dem Test
  sind SSE-PID-Menge und Desktop-Marker identisch. Katalogjahr und Engine-Major
  müssen zusätzlich mit `sse_product_info` übereinstimmen.

## Schnelle Page-Objects und atomare Feldtransaktionen

- Der MCP-Server selbst läuft dauerhaft; aus Stabilitätsgründen startet jede
  fachliche Action weiterhin einen frischen PowerShell-/UIA-Worker. Nach einem
  harten nativen Qt-UIA-Fehler kann ein Prozess sonst nur noch leere Treffer
  liefern. Große Actions bündeln deshalb Vorzustand, Eingabe, Readback,
  Ergebnis-Diff und gegebenenfalls Rollback in **einem** Worker.
- Drei getrennte `Add-Type`-Kompilierungen für Desktop-, Fenster- und
  MSAA-Interop kosteten zusammen median rund 0,30 s je frischem Worker. Ein
  bloßes Zusammenlegen in eine C#-Quelldatei sparte nur etwa 30–50 ms. Der
  wirksame Weg ist eine beim `npm run build` einmalig erzeugte
  `sse-native.dll`; der Worker lädt sie in rund 20 ms und behält
  `sse-native.cs` als getesteten Fallback.
- Eine geladene DLL kann nicht allein an ihrem Typnamen als aktuell erkannt
  werden. Der Build schreibt deshalb die SHA256-Werte des exakten C#-Quelltexts
  und der tatsächlichen DLL-Bytes in ein striktes Sidecar; Worker und
  Hidden-Desktop-Launcher laden die DLL nur bei doppelter Übereinstimmung. Bei
  Quell- oder Binärdrift bleibt die DLL unangetastet, wird aber nicht verwendet.
  Tests simulieren beide Fälle in einer isolierten Kopie.
- DLL und Sidecar lassen sich nicht als Paar atomar austauschen. Die DLL wird
  auf demselben Volume atomar ersetzt, danach das Sidecar. Im kurzen
  Zwischenzustand ist der Hashvertrag falsch und neue Worker fallen sicher auf
  den Quelltext zurück. Der Build prüft Typen und kritische DSK-Methoden aus
  den Assembly-Bytes vor dem Ersetzen.
- Auch `run-on-desktop.ps1` ist ein frischer Prozess je Hidden-Action. Eine
  eigene `Add-Type`-Definition dort kostete gemessen etwa 0,24–0,41 s und wurde
  durch denselben gemeinsamen Loader ersetzt. Das Kill-on-close-Jobobjekt und
  die suspende/resume-Startlogik bleiben unverändert.
- Gemessene Leerlauf-Mediane auf demselben Rechner nach der Hashbindung:
  Worker intern 0,130–0,156 s statt 0,41–0,44 s; kompletter MCP-Aufruf
  0,857–0,890 s statt 1,24–1,30 s. Das reduziert die Initialisierung um etwa
  70 %, ohne den
  UIA-Prozess wiederzuverwenden. Formular-, OCR- und Dialoglaufzeit kommt
  zusätzlich hinzu.
- Vier vollständige reale Hidden-Lifecycle-Läufe mit der vorkompilierten
  Worker- und Launcher-Brücke lagen bei 36,50–37,04 s (Median 36,92 s). Der
  einzelne Altwert von rund 43,5 s dient nur als grobe Vorherreferenz; die
  stabilere Aussage ist die per Action gemessene Initialisierungsersparnis.
- `sse_product_info.workerInitializationMs` nennt `precompiled-dll` oder
  `source-fallback`. Tests müssen beide Wege ausführen. Eine fehlende oder
  inkompatible DLL darf nie zum stillen Funktionsverlust führen.
- Bei Qt darf `GetUpdatedCache(TreeScope.Subtree)` nicht für den ganzen
  Formularbaum verwendet werden: Ein zyklischer Provider ließ den SSE-Prozess
  dabei bis auf mehrere Gigabyte wachsen und blockierte ihn. Der sichere
  Schnellpfad nutzt einen elementweisen Cache-TreeWalker; RuntimeIds werden
  zwischen Provider-Aufrufen zyklusgeschützt. Das ist UIA, kein OCR.
- Der Vergleich von TreeWalker- und Bulk-Snapshot paart zuerst stabile
  RuntimeIds. Metadaten binden dabei die gehashte semantische Elternlinie und
  die Tiefe; ein Reparenting bleibt damit auch bei stabiler RuntimeId sichtbar.
  Nur ungepaarte Knoten dürfen über denselben privaten Vollfingerprint als
  RuntimeId-Churn versöhnt werden. Rohe Lauf-/Elternindizes sind kein
  Identitätsmerkmal, weil ein kurz sichtbarer Qt-Geschwisterknoten sie
  verschieben kann.
- Eine leere Tabellenzeile kann im USt-Satz-Feld bereits den Default `7/19`
  anzeigen. Die Freizeilenerkennung behandelt ausschließlich diesen Default
  als neutral; sonstige vorbelegte Zellen bleiben belegt.
- Physische Detailnavigation bleibt auf eindeutig gebundene TreeItems sowie
  Hyperlinks mit exaktem Suffix `erfassen` oder `bearbeiten` begrenzt. Ein
  semantischer UI-Fingerprint muss auch einen Detailwechsel bei unverändertem
  Seitenkopf belegen.
- `sse-page-objects.json` enthält ausschließlich öffentliche UI-Metadaten:
  stabile Page-/Field-IDs, relative AutomationIds, Typen und fachliche
  Abhängigkeiten. Keine Namen aus dem Steuerfall, Beträge, Steuer-IDs,
  Dateipfade, RuntimeIds oder Ergebniswerte speichern.
- Manche Detailseiten ersetzen ihren generischen Seitenkopf nach Eingabe der
  Bezeichnung durch `Nummer + Bezeichnung`. Ein katalogisierter `headingPrefix`
  ist nur zusammen mit der Anwesenheit aller exakt adressierten Seitenfelder
  als Seitenbindung zulässig; der Präfix allein wäre zu breit.
- `sse_page_state` liest bekannte Felder direkt und bildet eine kurzlebige
  Epoche aus HWND, Seitenkopf, Dirty-State, Feldwerten und Feldpositionen.
  `sse_change_known_field` kann diese Epoche als Vorbedingung verlangen.
- Direkt vor der Eingabe werden exaktes SSE-Hauptfenster/PID, Seite, Vorwert,
  Bounding Rectangle, Fenster unter dem Klickpunkt, Vordergrund-HWND und
  `FocusedElement` erneut geprüft. Ein Scrollen, Seitenwechsel oder Fokusklau
  führt vor der Eingabe zum Abbruch. Nach der Eingabe werden Feld, optionale
  abhängige Summen und die vollständige Werte-Info neu gelesen.
- Zwischen den eigenen Maus-/Tastatureingaben bindet `GetLastInputInfo` den
  letzten Eingabe-Tick. Zusätzlich wird vor/nach dem Commit der Satz logisch
  blockierender SSE-Fenster gehasht; erwartete Tipps, Werte-Info, Qt-Schatten
  und winzige UAC-Overlays zählen nicht. Fremde Eingabe oder ein neuer Dialog
  ergibt `kind=interference`. In diesem Zustand wird der Feldwert nur gelesen
  und bewusst nicht blind zurückgerollt oder gespeichert.
- Rollback ist selbst eine Mutation. Ist der ursprüngliche Feldwert noch
  vorhanden, wird deshalb **nicht** erneut geschrieben. Ein echter Rollback
  erfolgt nur, wenn das Feld noch den von der Action gesetzten Wert trägt;
  anschließend wird der alte Wert erneut gelesen.
- Katalogisierte Metadaten liest der persistente Node-Server direkt. Der
  vollständige 2025-Katalog brauchte am 16.08.2026 im Executor-Mittel über
  1.000 Aufrufe 2,957 ms ohne Transport und UIA-Worker statt rund einer Sekunde
  im frischen Worker. Eine vollständige katalogisierte Feldaktion
  einschließlich 14-zeiligem Werte-Info-Vorher/Nachher-Vergleich brauchte auf
  der Testkopie rund 6,5 s statt zuvor etwa 15 s.
- Der persistente Server darf den Page-Object-Katalog nicht nur beim Start
  einlesen. Während einer gemeinsamen Formularsitzung werden bestätigte Seiten
  schrittweise ergänzt; `sse_page_objects` lädt die öffentliche JSON-Datei
  deshalb pro Aufruf neu. Sonst kann `sse_page_state` die neue Seite bereits
  bedienen, während der Katalog-Endpunkt fälschlich „unbekannt“ meldet.
- Auf der globalen Abschreibungsseite sind `GWG-Sofortabschreibung` und
  `GWG-Sammelposten` eine exklusive Radio-Gruppe. Für die vollständige
  Computerabschreibung im Anschaffungsjahr muss zuerst global
  `GWG-Sofortabschreibung` aktiv sein und anschließend beim einzelnen
  Wirtschaftsgut `Sofortabschreibung`. Ist der Sammelposten aktiv, ordnet SSE
  das Wirtschaftsgut dem Fünfjahrespool zu und deaktiviert die passende
  Einzelwahl. Nach beiden Schritten immer Kaufpreis, Vorsteuer,
  Jahresabschreibung, Werte-Info und Seitenprüfer zurücklesen.
- Die Detailseite eines Wirtschaftsguts kann ihren Kopf von `1. Wirtschaftsgut`
  zu `1. <Bezeichnung>` ändern. Das Page Object
  `gew.anlagevermoegen_wirtschaftsgut` bindet diesen dynamischen Kopf zusätzlich
  an alle exakten Feld-AutomationIds; bekannte Werte werden niemals im Katalog
  gespeichert.
- `sse_ui_state` nutzt denselben Bulk-Snapshot gleichzeitig für Seite,
  Dirty-State, Dialoglage, Seiten-/Globalprüfer und die bereits offene
  Werte-Info-Tabelle. Drei identische Testläufe lagen bei 2,114/2,128/2,193 s.
  Sie lieferten denselben Zustandsfingerprint.
  Die vorher getrennten Lesungen `sse_check_page`, `sse_checker_results` und
  offene `sse_result_details` brauchten zusammen 6,187 s: rund 66 % weniger
  Roundtrip-Zeit. Das erstmalige Öffnen von Werte-Info bleibt separat.
- Der Zustandsfingerprint enthält PID/HWND, Seite, Dirty-/Blockierzustand,
  Dialogfingerprints, Fensterarten, Prüferzähler und den Fingerprint der
  Ergebniszeilen. Flüchtige HWNDs nicht-modaler Hilfsfenster bleiben bewusst
  draußen, damit Schließen/Öffnen mit identischem Inhalt stabil vergleichbar
  ist. `previousFingerprint` liefert `changedSince` ohne alten Zustand erneut
  zu übertragen.

## Lange Gates und dauerhafte Evidenz

- Ein Hintergrund-Gate kann nach dem Ende oder Rate-Limit der steuernden
  Agentensitzung korrekt fertiglaufen. Weder die letzte Chatnachricht noch eine
  bloße »Task completed«-Meldung beweist den Produktstand. Verbindlich wird der
  Lauf erst, wenn Exitcode, fehlende Rest-SSE-Prozesse und die eigentliche
  Testzusammenfassung gelesen, die Abdeckungsbilanz regeneriert und beides in
  einem Commit festgehalten wurde. Genau so wurde der erfolgreiche strikte
  Zwei-Profil-Lauf vom 14.08.2026 nachträglich dauerhaft übernommen.
- Zwischenstände aus einem laufenden Gate altern sofort. Eine im Chat genannte
  Operationszahl darf deshalb nie in spätere Berichte kopiert werden; normativ
  bleiben Laufzeitkatalog und `test/operation-coverage.json` des aktuellen
  Commits.
- Mehrstufige Ausführung darf ein Client-Zeitbudget nicht pro Stufe neu
  gewähren. Ein schneller lokaler Versuch und sein Worker-Fallback teilen eine
  Deadline; der Worker erhält nur die verbleibende Frist. Reichen weniger als
  zwei Sekunden für den Prozessstart, scheitert der Aufruf ohne einen sicher
  aussichtslosen PowerShell-Prozess zu erzeugen. Auch ein noch laufendes Datei-
  `open` muss den Abbruch früh an den Aufrufer zurückgeben und ein verspätet
  geöffnetes Handle anschließend schließen.

## Focusless: Navigation, Messung und offene Grenze

- `EnumDesktopWindows` meldet für einen Desktop ohne Top-Level-Fenster `FALSE`
  und lässt den Thread-Fehler unangetastet. Der versteckte Start ruft die
  Enumeration in der ersten Poll-Runde auf, wenn der frisch erzeugte Desktop
  normalerweise noch leer ist. Ein Restfehler des Threads (beobachtet: 203,
  `ERROR_ENVVAR_NOT_FOUND`) erschien dadurch als Startfehler. Vor dem Aufruf den
  Thread-Fehler löschen und nur bei echtem Fehler werfen; ein ungültiges Handle
  bleibt fail-closed.
- Ein Fall speichert seine zuletzt geöffnete Seite in der Datei. Eine Fixture
  öffnet deshalb nicht zwangsläufig dort, wo ein älterer Test sie erwartet.
  Live-Tests dürfen die Startseite nicht als Konstante annehmen; sie sollen die
  profilierte Seite aus dem Katalog binden und ihre Erwartungswerte aus der
  gelesenen Seite ableiten.
- Focusless-Navigation zwischen Seiten funktioniert: `sse_goto useSearch=false`
  blättert linear auch auf dem versteckten Desktop. Qt kann das mit dem
  automatischen Prüffenster »Die Prüfung hat ergeben …« unterbrechen. Der Ablauf
  `sse_goto` → `sse_warning_popup_read ocr=true` → `sse_dialog_answer` mit
  UIA-Fingerprint **und** `bodyFingerprint` → `sse_goto` erreichte die Zielseite
  in 17 Blätterschritten in rund 57–62 s. Der Dirty-State blieb dabei
  unverändert; ohne `bodyFingerprint` verweigert die Antwort korrekt.
- `sse_save_as` braucht den sichtbaren Desktop (nativer Dateidialog).
  `sse_save` läuft versteckt und schreibt die Datei; seine strenge
  Nachbedingung (Hashwechsel, deaktivierter Sichern-Schalter und Dialogfreiheit
  gemeinsam) kann dabei trotzdem `postcondition-failed` melden. Die Datei ist
  dann geschrieben, der Zustand aber nicht bewiesen: erneut hashen statt mit dem
  alten Vorhash weiterzuarbeiten.
- Gemessene Phasen einer erfolgreichen versteckten Feldtransaktion
  (`zeitmessung`): gesamt 12,3 s, davon Commit 9,0 s (73 %), Fensterbindung
  1,5 s, die drei vollständigen Walk-Tree-Läufe zusammen nur 1,35 s (11 %). Die
  naheliegende Optimierung „weniger Baumläufe“ lohnt sich also nicht; der
  Commit ist der einzige relevante Kostenblock.
- Offene Grenze: der Focusless-Commit bindet den Qt-Fokus nur, wenn der Fall
  bereits auf der profilierten Seite geöffnet wurde. Nach linearer Navigation
  meldet er `focus-mismatch`. Auch bei direkt geöffneter Seite war er nicht
  reproduzierbar: ein Lauf gelang, alle späteren meldeten `focus-mismatch` mit
  `hasKeyboardFocus=false` auf Zelle **und** Tabelle, obwohl beide
  `keyboardFocusable=true` sind. In diesem Zustand wird nichts mutiert und nicht
  blind zurückgerollt. Ein längeres Fokus-Zeitbudget und das gemeinsame Pollen
  beider Fokusbeweise änderten nichts; die Ursache liegt vermutlich darin, dass
  das SSE-Fenster auf dem privaten Desktop kein aktives Fenster hat. Solange das
  nicht bewiesen gelöst ist, bleibt der Pfad fail-closed.

## Bekannte Fehlwege

| Ansatz | Beobachtung | Konsequenz |
|---|---|---|
| `PostMessage`/`SendMessage` für Qt-Mausklicks | wird ignoriert | physischen, PID-geprüften Klick verwenden |
| PowerShell-Katalogzugriff naiv als case-sensitive JavaScript-Index nachbauen | `PSObject.Properties[$PageId]` löst IDs case-insensitive auf und echo't trotzdem die vom Aufrufer gelieferte Schreibweise | IDs mit reiner Case-Kollision bereits im Profilschema abweisen; sonst zuerst exakt, danach nur einen eindeutig case-insensitiven Treffer akzeptieren und die Aufrufer-ID unverändert zurückgeben |
| WinForms-/COM-SendKeys auf verstecktem Desktop | keine nutzbare Eingabewarteschlange; kann mit irreführendem Systemtext scheitern | nie als versteckten Fallback verwenden |
| öffentliche Roh-Tastatur mit Sperrliste | unbekannter Fokus kann Steuerfelder, Löschen oder Versand auslösen; fehlender Vordergrund kann sogar eine fremde Anwendung treffen | `sse_keys` nicht registrieren und direkten Worker-Pfad blockieren; Tasten nur intern in ziel-/seiten-/summengebundenen Spezialwerkzeugen |
| öffentlichen PID-geprüften Klick auf beliebige UIA-Typen erlauben | Checkboxen, Radios, Dropdowns, Tabellenzellen und Dialogknöpfe umgehen ihre Vor-/Nachzustands- oder Fingerprintverträge | `sse_click_point` auf Navigations-/Prüfer-TreeItems begrenzen; andere Typen nur über Spezialwerkzeuge |
| UIA `Invoke`/`Select` auf Qt-Baum | meldet Erfolg ohne Wechsel | Überschrift als Nachbedingung |
| `SetFocus()` plus Pfeiltaste im globalen Prüfer | Fokus lügt oder öffnet dieselbe Karte wieder | keine Seriennavigation |
| `FindAll(Descendants)` als Zyklus-Fallback | kann über eine Minute laufen und trotzdem nur einen Teil des sichtbaren Prüferbaums liefern | nicht als Live-Standard verwenden |
| ältere Prüferkarte automatisch schließen | kann auch die neuere Zielkarte schließen | Detail zuerst lesen; Schließen nur best effort |
| rekursives MSAA auf der Qt-Hauptoberfläche | kann den isolierten Arbeitsprozess nativ beenden | nur begrenzte Punktabfragen |
| viele elementweise UIA-Abfragen am Stück | SSE wird kumulativ träge | Bulk-Snapshot, Kanarienabfrage und expliziter TreeWalker-Fallback |
| drei C#-Interop-Blöcke in jedem frischen Worker kompilieren | rund 0,30 s vermeidbarer Startaufwand je Action | einmalige Build-DLL laden; geprüften Source-Fallback behalten |
| nur prüfen, ob eine DLL die Klasse `DSK` enthält | veraltete DLL wird still bevorzugt und kann erst mitten in einer Action scheitern | SHA256 des exakten C#-Quelltexts binden und erwartete Methoden vor dem Build-Austausch prüfen |
| Worker optimieren, aber Hidden-Desktop-Launcher weiter per `Add-Type` kompilieren | bevorzugter versteckter Pfad behält rund 0,24–0,41 s Extraaufwand je Action | denselben hashgebundenen Loader und dieselbe DSK-Oberfläche verwenden |
| für jeden Diagnoseaufruf einen neuen MCP-Client starten | zusätzlicher Prozess- und Handshake-Aufwand; kleine Arbeitsfolgen wirken unnötig langsam | zusammengehörige Aufrufe mit `test/call-tools.mjs` in einer MCP-Sitzung ausführen |
| Suchtreffer nur per UIA `Invoke`/`SelectionItem` aktivieren | Qt meldet Erfolg, wechselt aber nicht oder öffnet nur die Themenauswahl | sichtbaren Treffer PID-geprüft doppelklicken; bei Themenauswahl Suche schließen und das exakte TreeItem anklicken |
| „nicht gefunden“ bei träger UI | falsches leeres Ergebnis | erst Gesundheit prüfen |
| Force-Kill als normaler Abschluss | erzeugt Recovery-Zustand | normal schließen, Force nur bei Hänger |
| einzelne sichtbare SSE-PID als Ersatz für fehlende Desktop-Marke übernehmen | kann eine Benutzersitzung schließen | ohne Name+PID+Desktopfenster fail-closed abbrechen |
| jedes kleine Zusatzfenster als Warnung/Dialog behandeln | Werte-Info und zwei 50×50-UAC-Overlays erzeugen Fehlalarm; Stop blockiert trotz sauberem Fall | echte Dialoge per Descriptor/Fingerprint, Werte-Info/Tipps als bekannte kompakte Hilfsfenster klassifizieren; UAC-Overlays ignorieren |
| unbekannte oder nicht lesbare Fenster als allgemeinen „Helfer“ melden | Agent erhält `frei`, obwohl ein modal blockierender Qt-Zustand möglich ist | `blockiert=true`, technische Lesefehler ausgeben, Screenshot/manuelle Klärung verlangen |
| Ergebnisfenster nur nach Titel suchen | bei zwei SSE-2025-PIDs können Zahlen des falschen Falls gelesen werden | zuerst eindeutiges Haupt-HWND/PID binden, Werte-Info strikt auf diese PID filtern |
| Ergebniszellen nur mit `y >= 0` zählen | negative Monitorpositionen fallen weg; 0×0-Zellen bleiben als stille Unvollständigkeit ungezählt | Rechteckgröße statt Vorzeichen prüfen, nicht positionierte Zellen zählen und `vollstaendig=false` setzen |
| absolute Feld-Y-Koordinaten in Zustandsfingerprint aufnehmen | Fensterbewegung/DPI-Wechsel wirkt wie fachliche Änderung | Koordinaten nur anzeigen; im Fingerprint stabile Feld-IDs mit Reihenfolge/Anzahl verwenden |
| beliebigen Prozessnamen an Fensterfunktionen durchreichen | Wildcards lesen fremde Fenstertitel; eine spätere Schemaerweiterung könnte die Produktgrenze umgehen | nur `SSE`/`SteuertippsCenter` erlauben; Steueraktionen fest auf SSE 2025 binden |
| Startmodus nur im MCP-Schema prüfen | direkter Worker-Aufruf kann zusätzliche Kommandozeilenargumente einschleusen | Modus im Worker immer vor Prozess-/Desktopstart validieren |
| sichtbaren Start-Timeout nur melden | eigene SSE-PID bleibt verwaist und macht spätere Aktionen mehrdeutig | exakt gestartetes Prozessobjekt beenden und Cleanup verifizieren |
| `SetForegroundWindow=true` als Beweis nehmen | Codex/Electron kann trotzdem vorne bleiben; der Zielpunkt gehört einer fremden PID | API-Rückgabe ignorieren, exaktes Vordergrund-HWND und `WindowFromPoint` prüfen; `epoch-obstructed` rollbackfrei als `interference` melden |
| Frische UIA-Koordinate als sichtbaren Klickpunkt behandeln | Ein sichtbarer Qt-Baum kann auf einem nicht klickbaren Windows-/Virtual-Desktop liegen; im realen Test traf der frische Zellmittelpunkt den Explorer-Desktop statt SSE | BoundingRectangle nach Restore frisch lesen, gegen Hauptfensterrechteck prüfen und zusätzlich exakte PID plus Root-HWND mit `WindowFromPoint` verlangen; bei Explorer/fremdem Desktop abbrechen und SSE manuell aktivieren |
| `LockApp` bei `WindowFromPoint` pauschal ignorieren, weil der Prozess suspendiert oder optisch unsichtbar wirkt | USER32 kann Lock-Screen-/Shell-Fenster weiter hit-testen; UIA beweist nur Auswahl, nicht den Qt-`currentIndex`, und bindet `SendKeys` nicht an die Zielzeile | Blockierer als `lockscreen-shell` diagnostizieren, aber PID-/Root-Prüfung nicht lockern; vor Mutation abbrechen und auf sichtbar aktiver Sitzung erneut ausführen |
| bei mehrfacher Qt-AutomationId zuerst nach Aid auflösen | leere Tabellenzelle wird zum großen Tabellencontainer; falsches Rechteck | unmittelbar gelesene RuntimeId/Element-Cache vor Aid priorisieren; Position weiter auf 3 px binden |
| Speichern im Close-Dialog nur aus Button-Invoke ableiten | Dateiänderung ist nicht bewiesen | vorher hashgebunden `sse_save`, Close/Stop speichert nicht |
| MSAA-Schaltfläche nur über PID und alte Koordinate klicken | anderes SSE-Fenster oder verschobenes Element kann getroffen werden | Top-Level-HWND, Rolle, Name und Rechteck unmittelbar neu prüfen |
| Positionen mit einem generischen Klick und dem ersten beschreibbaren Feld anlegen oder löschen | falsches Fenster/Feld kann geändert und Pattern-Erfolg ohne sichtbaren Readback gemeldet werden | `sse_positions` nur read-only betreiben; Struktur erst nach eigenem Seiten-/Feld-/Summen-/Dialogvertrag automatisieren |
| bei mehreren offenen, bytegleichen SSE-Fällen das größte Fenster verwenden | Seite, Feldwerte und Summen unterscheiden Original und Arbeitskopie nicht | jede schreibende oder navigierende Aktion an ein eindeutiges Hauptfenster binden; ohne `hwnd` bei Mehrdeutigkeit abbrechen |
| generischen Menü-/Invoke-Befehl für Datenübernahme, Import, Löschen oder Zurücksetzen direkt auslösen | große lokale Falländerung ist kein ELSTER-Versand und passiert ohne fachliche Nachbedingung | destruktive Beschriftungen separat sperren, bewusste Einmalbestätigung verlangen und Dirty-State vor/nach melden |
| sichtbare Tabellenzeilen als vollständig behandeln | virtualisierte Zeilen fehlen | Vollständigkeit explizit nachweisen |
| Pattern-Erfolg beim Toolbar-Prüfer als „Prüfer offen“ werten | Toggle kann wirkungslos bleiben | `sse_checker_results.aktiv` und richtige Prüfseite verlangen |
| nur Pattern-Erfolg prüfen | Qt-Zustand bleibt unverändert | sichtbaren Wert neu lesen |
| `Invoke` auf `Weiter`/`Zurück` als Seitenwechsel werten | Qt kann nur einen Prüfhinweis öffnen; der eigentliche Wechsel wartet bis zur Antwort, ein Wiederholungsklick überspringt danach eine Seite | Überschrift intern vor/nach lesen, `navigation-blocked` samt Dialog melden, Dialog beantworten und danach Zustand neu lesen |
| Mehrseiten-Erfassung nach Dialog oder gleicher Überschrift weiterlaufen lassen | dieselbe Seite erscheint mehrfach und ein Teilstand sieht wie eine vollständige Erklärung aus | beim ersten Dialog, Zyklus, Stillstand, Kanarienfehler oder Nutzereingriff `collection-incomplete` liefern; Teilstand und Stopgrund erhalten |
| Seitentitel allein als Zyklus-ID verwenden | SSE nutzt dieselbe Überschrift für legitime §13b-Unterseiten hinter Material, Fremdleistungen und weiteren Kosten; der Collector stoppt falsch | gerichteten Weg `Vorgänger -> Überschrift` als Zyklus-ID verwenden; gleicher Titel aus anderem Vorgänger ist ein eigenes Vorkommen |
| Mehr als wenige große Qt-Seiten in einem Collector-Prozess erzwingen | Schon 12 Seiten konnten nach mehreren Minuten auf über 3 GB wachsen und SSE blockieren; das Abschlussartefakt fehlte | Vorgabe 3, hart maximal 5 Seiten; Memory-/Kanarienguard auf jeder Seite. Live-Arbeit ausschließlich über direkte Tree-/Page-Object-Sprünge |
| bestehenden Erfassungs-JSON-Pfad überschreiben, auch hashgebunden | zwischen langer UI-Erfassung und Ersetzen bleibt ein Fremdänderungsfenster | jedes Segment in eine neue, exklusiv erzeugte Ergebnisdatei schreiben; vorhandene Ziele nie ersetzen und neuen SHA256 zurücklesen |
| unvollständigen Collect-Stand als vollständige Prüfquelle verwenden | alle vorhandenen Erwartungen können stimmen, obwohl andere Seiten fehlen | `vollstaendig=true` verlangen; Teilstand nur bewusst mit `allowIncompleteSource` und ohne Gesamtaussage prüfen |
| bei Seiten-/Feldteilstring den ersten Treffer wählen | gleichnamige Summen oder ähnliche Seiten werden verwechselt | exakte Treffer priorisieren, Teilstrings literal und eindeutig verlangen, Mehrdeutigkeit mit Kandidaten melden |
| fachliche Soll/Ist-Abweichung als `ok=false` transportieren | MCP-Schicht ersetzt die Detailzeilen durch „Unbekannter Fehler“ | Werkzeugausführung `ok=true`, fachliches Ergebnis getrennt als `vergleichOk` melden |
| Speichern nur über Buttonstatus prüfen | Navigation kann dirty wirken | Dateihash und Änderungszeit |
| rohe Fall-Snapshots in `docs/` speichern | private Daten landen im Repo | ausschließlich `.tmp/`, danach löschen |

### Ergebnisverträge und Testharnische

- Ein grüner Mock ist keine Evidenz, wenn er andere Ergebnisfelder als der
  Worker erfindet. Feldnamen für API, OpenAPI und MCP deshalb von den realen
  `Emit`-Objekten ableiten; eine Suche im ganzen Operationsblock reicht nicht,
  weil verschachtelte `binding.rid`- oder `rollback.grund`-Properties sonst
  fälschlich wie Top-Level-Felder wirken.
- `set_value` ist kein allgemeiner Schreibpfad. Es darf ausschließlich das
  globale steuerneutrale Suchfeld über dessen frische Runtime-ID ändern und
  muss Vorwert, Read-back, Eingabe-/Fensterguard und gegebenenfalls Rollback
  melden. Steuerfelder gehören zu `tracked_set_value` beziehungsweise den
  fachlichen Tabellen-, Toggle- und Combo-Operationen.
- `export_csv` bestätigt nur den gebundenen Exportdialog und dessen
  Folgezustand. Eine Harnisch darf nicht schon eine CSV-Datei erfinden; die
  Auswahl des Zielordners und der tatsächliche Dateiabschluss bleiben ein
  eigener Dialog-/Nachbedingungsvertrag.
- UIA-Scrollprozent kann `-1` als `NoScroll`-Sentinel liefern. Ein
  nichtnegatives Ergebnisschema würde einen korrekten Worker-Read in einen
  HTTP-502-Fehler verwandeln; Prozentfelder brauchen deshalb einen endlichen,
  aber nicht zwingend nichtnegativen Zahlenvertrag.

## Verifikationsmuster

### Leseoperation

- Gesundheit okay;
- keine blockierenden Dialoge;
- strukturierte Lesung plus Screenshot bei Risiko;
- Vollständigkeitsflag auswerten;
- keine Schlussfolgerung aus einem abgebrochenen Baum.

### Schreiboperation

- eindeutiger Zielknoten;
- Vorwert und erwartete Änderung;
- unmittelbares Read-back;
- Summen-/Zeilenzahl-Nachbedingung;
- Seitenprüfer;
- Speichern;
- Dateihash und Originalschutz.

### Dialogoperation

- Dialog lesen;
- Fingerprint binden;
- genau eine erlaubte Antwort;
- Folgezustand neu lesen;
- keine Dialogkette blind bestätigen.

### Release-Prüfung des MCP-Servers

- PowerShell-Dateien parsen;
- TypeScript bauen;
- `git diff --check`;
- Werkzeugliste per echtem MCP-Protokoll prüfen;
- Sicherheits-Sperrtests ausführen;
- harmlose Live-Lesewege gegen einen lokalen Testfall prüfen;
- schreibende Live-Tests nur auf einer wegwerfbaren Arbeitskopie;
- Repository nach privaten Namen, Pfaden und Rohartefakten durchsuchen.

Client-, Server- und Aufrufer-Timeouts müssen zusammenpassen. Ein Segment darf
dennoch nicht einfach vergrößert werden: lange Läufe können SSE selbst
überlasten. Kleine atomare Segmente liefern früher einen hashgebundenen
Teilstand und lassen sich zwischen den Abschnitten per Health kontrollieren.

## Backlog

- Den Page-Object-Katalog während echter Formulararbeit schrittweise auf alle
  geprüften Seiten, Felder, Tabellen, Menüs und Dialoge erweitern. Nur
  manuell bestätigte öffentliche Metadaten übernehmen.
- Prüferspalte über den Splitter kontrolliert verbreitern und per Screenshot
  nachprüfen.
- Beide Prüfergruppen ohne Fokus-/Pfeiltasten-Serien scrollend erfassen und
  anhand der Gruppenzähler zusammenführen.
- Tipps erst nach fachlicher Entscheidung abhaken; jeden Zustandswechsel
  visuell und durch erneuten Prüferlauf prüfen.
- Den globalen Prüfer auf einer Wegwerfkopie mit dem Bulk-Snapshot erneut auf
  Vollständigkeit prüfen; nie aus einem kurzen Baum still „alles sauber“
  folgern.
- Synthetische UI-Fixtures für Dialog-, Tabellen- und Prüferzustände ergänzen,
  damit keine privaten Live-Fälle als Tests benötigt werden.
