---
name: steuer-spar-erklaerung
description: Prüft oder bearbeitet einen eindeutig geöffneten Steuerfall in SteuerSparErklärung unter Windows, gleicht Belege ab oder bereitet eine UStVA vor. Verwenden für konkrete lokale SSE-Fälle; nicht für allgemeine Steuerfragen ohne Fall und niemals für ELSTER-Versand.
---

# SteuerSparErklärung sicher bearbeiten

Arbeite mit technisch unerfahrenen Nutzern standardmäßig auf Deutsch. Merke
dir den ursprünglichen Auftrag und bleibe read-only, bis eine konkrete
Änderung ausdrücklich freigegeben wurde.

## Immer zuerst: MCP-Preflight

Beginne jeden Auftrag mit dem echten MCP-Tool `sse_preflight`. Es bündelt
Arbeitsbereich, Produktprofil und Laufzeit, startet aber weder einen Steuerfall
noch eine Fachoperation.

- Bei `ok=true` und `ready=true` mit `sse_instances` den Arbeitsfall binden.
- Bei einem stabilen Blocker genau dem angegebenen `nextTool` folgen. Keine
  Pfade, Prozesse oder Konfigurationen raten.
- Bei API-Startfehler keine zweite API starten und keinen Prozess nach Namen
  beenden. Fremde, alte oder unklare Portinhaber bleiben ein sicherer Stopp.
- Fehlt jedes `sse_*`-Tool, keine Steuerdaten lesen und nichts installieren
  oder am System ändern. Melde, dass Plugin/MCP in diesem Client nicht geladen
  ist, bitte um Neustart/Reload und verweise bei weiterem Fehler auf die
  [Installationsanleitung](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md).

Setze danach den ursprünglichen Auftrag fort. Ein bestandener Preflight ist
keine Freigabe für spätere Navigationen oder Mutationen; jeder API-Aufruf prüft
seine Bindungen erneut.

Direkte MCP-Werkzeuge über ihre Tooldefinitionen aufrufen; `ALL_TOOLS` enthält
nur verschachtelte Werkzeuge und belegt daher keine fehlenden direkten Tools.

## First run

Ist Fall oder Belegumfang noch unklar, lies
[references/first-run.md](references/first-run.md). Der kurze Wizard behält
den ursprünglichen Auftrag, stellt höchstens eine Frage pro Nachricht und
lässt einen eindeutig geöffneten Fall gewinnen. Andernfalls bestätigt er Fall
und vollständige Belegquellen. Sobald die wesentlichen Angaben und die
Freigabe feststehen, setzt er den ursprünglichen Auftrag fort.

Bereits beantwortete Fragen nicht erneut stellen. Der First run darf keine
Installerbefehle als Standardaktion ausführen, keine Clientkonfiguration
verändern und keine versteckte Systemänderung vornehmen.

## Auftrag, Originalfall und technische Grenzen

Der Originalfall ist der normale Arbeitsfall. Ein Übermittlungsvermerk allein
ist keine Schreibsperre: Eine Gewinn-Erfassung wird im selben Fall für weitere
Zeiträume fortgeführt. Ausdrücklich beauftragte Änderungen und `sse_save` sind
auch im Original erlaubt. Verlange dafür keine Arbeits- oder Korrekturkopie.
Einen bereits übermittelten **Zielzeitraum** nur mit einem ausdrücklichen
Korrekturauftrag bearbeiten; eine frühere Meldung eines anderen Zeitraums
blockiert den aktuellen Auftrag nicht.

Eine klare Freigabe gilt für alle beauftragten Teilschritte. Verwende sie in
der laufenden Aufgabe weiter, statt dieselbe Zustimmung erneut zu verlangen.
Frage nur nach fehlenden wesentlichen Entscheidungen oder einer Erweiterung
des Auftrags. Ein Auftrag darf Bearbeiten und Speichern gemeinsam freigeben.

- Niemals über ELSTER senden, übermitteln, bestätigen oder abschließen. Keinen
  Versandklick und keinen Umgehungsweg vorbereiten.
- Falldateien nicht außerhalb der Anwendung binär überschreiben und nicht
  ungefragt löschen, umbenennen oder verschieben. `sse_save` am gebundenen
  Original ist der normale Speicherweg. Archive sind nur über den ausdrücklich
  beauftragten, inventar- und hashgebundenen `sse_archive_cases`-Vertrag
  zulässig.
- Ein bereits eindeutig geöffneter Fall ist der Arbeitsfall. Nie still einen
  anderen öffnen. Bei mehreren offenen Fällen genau eine Auswahlfrage stellen.
- Eine Arbeitskopie, `save_as`, Schließen oder Verwerfen ist keine implizite
  Sicherheitsmaßnahme und braucht einen ausdrücklichen Auftrag.
- Ändern ist nicht Speichern. `sse_save` oder `sse_save_as` brauchen einen
  ausdrücklichen Speicherauftrag für den exakt gebundenen Fall. „Ändere und
  speichere“ genügt; dafür keine zweite Bestätigung verlangen.
- Vor der ersten dirty-fähigen Navigation oder Mutation den aktuellen
  Dateistand einmal je unverändertem Disk-Hash privat sichern. Vor jedem
  Schreiben Fallreferenz, PID/HWND, Hash und Backupbindung erneut prüfen.
- Jede Fensterbindung muss den frisch gelesenen `HWND` des eindeutig
  gebundenen Falls verwenden; bei jeder Abweichung fail-closed stoppen.
- Erfolg nur nach strukturiertem Readback behaupten. Ein Exitcode, Klick oder
  sichtbarer Wert allein genügt nicht.
- API-Sperren nie mit freier Maus/Tastatur, Koordinaten, direktem Worker oder
  wiederholtem Probieren umgehen.
- Bei Hash-, Ziel-, Dialog-, Transport- oder Readback-Abweichung ohne Retry
  stoppen. Eine möglicherweise ausgeführte Mutation nie blind wiederholen.

Derzeit ist das Profil `2025` mit Engine-Major `31` freigegeben. Fahre nur bei
`status=supported` und `operationAccess=full` fort. Bei einem tatsächlichen
Build-Drift mit nichtleerem abweichendem `current` vor jeder Mutation stoppen.
Ein nicht laufendes Produkt mit leerem `current` beweist dagegen noch keine
installierte Versionsabweichung.

Im BelegManager ist nur `sse_receipt_manager_list` öffentlich freigegeben. Die
gesperrten Vordergrundwege niemals umgehen. Sollte ein späteres Release eine
BelegManager-Mutation ausdrücklich freigeben, ist vorher die getrennte
Datenbanksicherung nach
[references/belegmanager-backup.md](references/belegmanager-backup.md) Pflicht;
eine Falldatei-Sicherung ersetzt sie nicht.

## Werkzeugwahl: Hauptweg, Fallback, Diagnose

Bevorzuge strukturierte Leser wie `sse_read_page` und `sse_table_read` sowie
Feld-, Tabellen-, Navigations- und UStVA-Spezialoperationen. `sse_snapshot`,
`sse_find` und `sse_get_value` bleiben nützliche Leser für gezielte Nachweise.

Kompatibilitäts-/UI-Fallbacks nur bei fehlendem Hauptweg oder bewiesenem
UIA-Positionierungsbedarf: sichtbares `sse_read_table`, aktiver Tabellenlauf und
generische Klick-, Baum-, Scroll- oder Menüwege. Grund benennen und
[ui-fallback.md](references/ui-fallback.md) beachten. Die exakt gebundene
RadioButton-Auswahl mit `sse_click pattern=select` bleibt unterstützt.

`sse_screenshot`, `sse_snapshot_compare` und `sse_accessibility_probe` gezielt
zur Diagnose verwenden; sie ersetzen keinen strukturierten Readback. Bei
Fehlern stoppen und Zustand klären; kein automatischer Methoden-/Backendwechsel
und keine Lockerung durch Weglassen der RuntimeId oder Namensraumwechsel.

## Wiederverwendbarer Ablauf

1. **Binden:** Nach `sse_preflight` mit `sse_instances` den einen eindeutig
   geöffneten Fall, PID/HWND und aktuellen Disk-Hash lesen. Bei
   Wiederherstellungszustand stoppen; mit einem wiederhergestellten Fall nicht
   weiterarbeiten.
2. **Planen:** Auftrag als Prüfung, Belegabgleich, Änderung, UStVA oder
   Fallanlage erkennen. Nur die dafür nötigen Quellen und Operationen vorsehen.
   Offene fachliche Entscheidungen (Einkunftsart, Kleinunternehmer, Soll/Ist,
   Zuordnung strittiger Belege) mit einem begründeten Vorschlag klären,
   höchstens eine Frage pro Nachricht. Bereits beantwortete Angaben und
   erteilte Freigaben weiterverwenden; keine zusätzliche Modusfrage stellen.
   Buchungsregel: Ein-/Ausgaben in die Kostenarten der Gewinn-Erfassung
   buchen; Vorsteuer und UStVA leitet das Programm daraus ab. Direkte
   UStVA-Beträge sind nur ein begründeter Fallback auf ausdrücklichen Wunsch.
   Bei einem klaren Auftrag den Plan kurz nennen und im freigegebenen Umfang
   ausführen. Nur noch offene wesentliche Entscheidungen bestätigen lassen.
3. **Sichern:** Vor `sse_collect`, `sse_goto`, `sse_subpages`, navigierendem
   `sse_click_point`, Programm-Prüfer oder Mutation den unveränderten
   Dateistand genau einmal nach `backups:` sichern. Der vollständige
   Sitzungsvertrag steht in [case-session.md](references/case-session.md).
4. **Lesen:** Verfügbare Werkzeuge und Grenzen aus `sse_capabilities`, der
   API-Selbstbeschreibung und dem installierten API-Vertrag ableiten. Belege nur
   aus bestätigten Quellen inventarisieren; Screenshots sind ergänzende Evidenz.
   Felder mit `sse_read_page`, Buchungszeilen mit `sse_table_read` lesen. MCP setzt
   fehlendes `noKeys` auf `true`: Qt liest das Modell passiv, UIA nur Sichtbares.
   Für vollständiges passives UIA-Lesen `readMode: "grid"` wählen und
   `vollstaendig`, `limitReached`, `rowDetails` sowie leere Eingabeslots beachten.
   `noKeys: false` nur für bewiesenen Cursorbedarf oder Diagnose verwenden;
   ein voller Lauf zeigt das Tabellenende. Spaltenköpfe und Kontrollsummen
   frisch binden; Details stehen in [buchungswege.md](references/buchungswege.md).
5. **Ändern:** Nur genau eine eng gebundene Änderung oder einen bestätigten
   Batch ausführen. Für Tabellen den frisch gelesenen Vorwert beziehungsweise
   `expectedBefore` verwenden. Wert, Summe, Hash und Dirty-State sofort
   zurücklesen. Native Tabellenänderungen positionieren die gebundene Zielzeile
   selbst; kein vorheriger voller Cursorlauf. UIA-Update braucht eine frisch
   bewiesene sichtbare Zielzeile; ein vollständiger Gridread macht sie nicht
   sichtbar. Interne Add-/Delete-Positionierung bleibt unverändert. Ein Inventar ist keine
   Mutationsfreigabe. Die Werte in `werte` stehen in Spaltenreihenfolge ab der
   ersten Spalte — führende Spalten wie eine automatische „Nr." gehören leer dazu,
   sonst rutscht jeder Wert eine Spalte nach links.
6. **Prüfen:** Nach einer vollständigen Bearbeitung den Programm-Prüfer mit
   `sse_checker_run` starten und mit `sse_checker_results` lesen. Die Fallart
   bestimmt den profilierten Startweg; im Einkommensteuerfall muss die
   Prüfseite geöffnet sein. Meldungen mit `sse_checker_open` exakt öffnen.
   Automatische Prüfhinweise mit `sse_warning_popup_read` lesen und nur
   fingerprintgebunden über `sse_dialog_answer` beantworten; danach
   `sse_ui_state` neu lesen, keinen Navigationsklick wiederholen. Bei einem
   gesperrten ELSTER-Hinweis die Ursache beheben, statt ihn wegzuklicken.
7. **Abschließen:** Fall offen lassen. Knapp sagen, was gelesen oder geändert
   wurde und ob auf Auftrag gespeichert oder nur im Programm geändert wurde.
   Übermittlung hat nicht stattgefunden. Berichte nur auf Auftrag als Datei
   anlegen und diese samt Hash zurücklesen.

MCP ist der Standardtransport und bleibt PC-blind; die lokale API führt die
Windows-Arbeit aus. Direkte API-Nutzung ist nur ein vom Nutzer ausdrücklich
gewählter Expertenmodus. Während einer möglicherweise begonnenen Mutation nie
still den Transport wechseln.

## Spezielle Referenzen

Lies nur die Referenz, die der aktuelle Auftrag tatsächlich braucht:

- [first-run.md](references/first-run.md) — Fall oder Belegumfang noch unbestätigt;
- [case-session.md](references/case-session.md) — jede dirty-fähige Navigation,
  Mutation, Sicherung, Arbeitskopie oder Speicherung;
- [ustva.md](references/ustva.md) — nur bei UStVA, Gewinn-Erfassung oder dem
  belegten Folgejahrweg;
- [case-create.md](references/case-create.md) — nur bei ausdrücklich beauftragter Fallanlage;
- [buchungswege.md](references/buchungswege.md) — bevor eine Ausgabe, Einnahme
  oder ein Reverse-Charge-Beleg eingetragen wird;
- [steuerquellen.md](references/steuerquellen.md) — betragsrelevante oder
  strittige steuerfachliche Begründung;
- [ui-fallback.md](references/ui-fallback.md) — fehlender Hauptweg,
  belegter UIA-Positionierungsbedarf oder gezielte Kompatibilitätsdiagnose;
- [belegmanager-backup.md](references/belegmanager-backup.md) — nur für eine
  in einem späteren Release ausdrücklich freigegebene BelegManager-Mutation.

Erfinde keine Releaseversion, Pfade, Werkzeuge, Felder oder Clientbefehle aus
Modellwissen. Der installierte Vertrag bleibt autoritativ.
