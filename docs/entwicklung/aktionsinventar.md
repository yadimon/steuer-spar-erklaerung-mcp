# Aktionsinventar: was das Programm anbietet und was die API davon kann

Dieses Dokument geht die Oberflaeche von SteuerSparErklaerung durch und haelt
fest, welche Aktionen es gibt und zu welchen es bei uns eine Operation gibt.
Es ist Entwicklungswissen, keine Nutzerdokumentation: Es benennt Luecken, ohne
zu versprechen, dass sie geschlossen werden.

## Herkunft der Daten

Die Menuestruktur ist am 2026-09-03 in der Forschungs-VM aus dem laufenden
Programm ausgelesen worden (SSE `31.0.2.0`, Titel `[31.31]`, geoeffneter
Musterfall `MusterSteuer1.ESt2025`). Jedes Menue wurde ueber UIA aufgeklappt,
seine Eintraege samt Aktivierungszustand gelesen und wieder geschlossen; es
wurde kein Eintrag geklickt. Rohdaten: `menu-inventar.json` im Laborordner,
Job `40-menu-inventar.ps1`; beides liegt ausserhalb von Git.

**7 Menues, 64 Eintraege.** Der Aktivierungszustand gilt fuer genau diesen
Zustand (Einkommensteuerfall, nichts markiert, nichts geaendert) und ist
deshalb nur ein Hinweis, keine Zusicherung.

Die Zuordnung zu unseren Operationen ist meine Einschaetzung anhand der
Operationsliste, nicht gemessen. Wo ich unsicher bin, steht das dabei.

## Datei

| Eintrag | Kuerzel | Bei uns |
| --- | --- | --- |
| Neu | Strg+N | `case_create` |
| Öffnen… | Strg+O | `launch` mit Falldatei; der Dialog selbst ueber `file_dialog_select` |
| Zuletzt verwendete Dateien | | **fehlt** – wir listen ueber `list_cases`/`center_cases` aus dem Dateisystem, nicht aus der Programmhistorie |
| Speichern | Strg+S | `save` |
| Speichern unter… | Strg+Alt+S | `save_as`, `make_working_copy` |
| Sicherungskopie erstellen | | **teilweise** – `backup_cases` kopiert und hasht auf Dateiebene; die programmeigene Sicherung ist etwas anderes |
| Passwort setzen/aufheben… | Strg+Alt+P | **fehlt** |
| Datenübernahme starten | | **fehlt** – Uebernahme aus dem Vorjahr |
| Import | | **fehlt** – nur VaSt ist profiliert, und das nur auf dem Fehlerpfad |
| Drucken… | Strg+P | **fehlt** – siehe ROADMAP, „Ausgabe ausser CSV" |
| Elektronische Steuererklärung (ELSTER) | | **dauerhaft gesperrt**, mit Absicht |
| Beenden | Alt+F4 | `close` |

## Bearbeiten

| Eintrag | Kuerzel | Bei uns |
| --- | --- | --- |
| Rückgängig | Strg+Z | **fehlt** – es gibt kein Undo ueber die API |
| Wiederherstellen | Strg+Y | **fehlt** |
| Ausschneiden / Kopieren / Einfügen | Strg+X/C/V | **fehlt** – Werte werden ueber `set_value` gesetzt, nicht ueber die Zwischenablage |
| Löschen | Strg+Entf | **teilweise** – `table_delete` loescht Tabellenzeilen; ein allgemeines Loeschen fehlt |
| Dialogdaten | | **fehlt** |
| Erläuterung | Strg+E | **fehlt** |
| Notiz | Strg+T | **fehlt** |
| Belege verknüpfen | | `receipt_manager_link` |
| Belege entknüpfen | | **fehlt** – auffaellige Asymmetrie: wir koennen verknuepfen, aber nicht loesen |
| Suchen | Strg+F | **indirekt** – `goto` benutzt die Suche intern, es gibt keine eigene Suchoperation |

## Ansicht

| Eintrag | Kuerzel | Bei uns |
| --- | --- | --- |
| Anlage | Umschalt+F7 | **fehlt** |
| Formular | Strg+F7 | **fehlt** – die Formularansicht ist nicht profiliert |
| Ergebnis | F8 | **teilweise** – das Fenster `resultComparison` ist profiliert, `result_details` liest es |
| Roter Faden | | **teilweise** – der rote Faden ist der Inhaltsbereich, den wir lesen; als Ansichtsumschaltung nicht bedienbar |
| Gehe zu | | `goto` |
| Darstellung | | **fehlt** |
| Symbolleiste einblenden | | **fehlt** |

## Extras

| Eintrag | Kuerzel | Bei uns |
| --- | --- | --- |
| Steuerprüfer | | `checker_open`, `checker_run`, `checker_results`, `checker_detail`, `checker_reset`, `checker_close` |
| Themen-Filter | | **teilweise** – eine Themenfilterseite ist profiliert (`gew_erfass.themenfilter_umsatzsteuer`), die Funktion als solche nicht |
| BelegManager | | `receipt_manager_*`, zehn Wege – aber nur `receipt_manager_list` ohne sichtbaren Vordergrund |
| Werte-Info | Strg+F8 | **teilweise** – das Fenster ist bekannt und wird beim Lesen bewusst ausgeschlossen; es wird nicht bedient |
| Kalender 2025 | | **fehlt** |
| Steuerterminkalender 2026 | | **fehlt** |
| Taschenrechner | Strg+F9 | **fehlt** – und vermutlich nicht sinnvoll |
| Steuerrechner | | **fehlt** – fachlich interessant |
| Steuertabellen… | | **fehlt** |
| Freischaltcode eingeben/ändern… | | **fehlt, und soll fehlen** – Lizenzierung fassen wir nicht an |
| Optionen… | | **fehlt** – Programmeinstellungen |

## Musterbriefe

Neun Eintraege: Übersendung, Änderungsantrag, Einspruch, Antrag,
Steuerzahlung, Vorauszahlung, Widerruf, Sonstige Schreiben, Eigene
Musterbrief-Vorlagen.

**Keiner davon ist abgedeckt.** Das ist der groesste zusammenhaengende weisse
Fleck: ein ganzes Menue ohne jede Operation. Musterbriefe erzeugen Dokumente
aus Falldaten, waeren also ein natuerlicher Ausgabeweg neben `export_csv`.

## Service

| Eintrag | Bei uns |
| --- | --- |
| Support | **fehlt**, und soll fehlen |
| Online-Update | **fehlt** – wir *erkennen* das Update-Angebot seit `updatePrompt`, loesen es aber nie aus |
| Online-Zugang konfigurieren | **fehlt**, und soll fehlen |
| TeamViewer / TeamViewer-Anleitung | **fehlt**, und soll fehlen – Fernwartung gehoert nicht in eine Automatisierung |
| ELSTER-Infos | **fehlt** |

## Hilfe (`?`)

Anleitung (F1), Musterfälle, Datenschutzerklärung, Lizenzbedingungen,
Steuer-News, Steuertipps Steuer-Newsletter, Info.

**Keiner davon ist abgedeckt.** Die Operation `help` liest die Hilfespalte des
Hauptfensters, nicht dieses Menue. „Musterfälle" waere fuer Tests interessant,
weil es die mitgelieferten Beispielfaelle oeffnet.

## Was daraus folgt

Von 64 Menueeintraegen sind **elf** durch eine Operation abgedeckt, **neun**
teilweise, und **vier** bleiben mit Absicht zu (ELSTER, Freischaltcode,
Online-Zugang, Fernwartung). Die restlichen rund vierzig sind offen.

Das relativiert die Zahl der hundert Operationen noch einmal anders als die
Roadmap: Die API ist tief, wo sie etwas kann – Steuerpruefer, BelegManager,
Tabellen, UStVA sind mit vielen Operationen ausgearbeitet – und vollstaendig
leer bei ganzen Menues.

Die drei Luecken, die mir am ehesten lohnend erscheinen:

1. **Drucken und Musterbriefe** – der einzige Ausgabeweg ist heute `export_csv`.
2. **Belege entknüpfen** – die fehlende Gegenrichtung zu `receipt_manager_link`;
   klein, und die Asymmetrie ist schwer zu erklaeren.
3. **Datenübernahme aus dem Vorjahr** – erspart einem Benutzer beim
   Jahreswechsel sehr viel Arbeit.

Ohne Anspruch, dass jemand sie angeht. Das Inventar sagt, was da ist.
