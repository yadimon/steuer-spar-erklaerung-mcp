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

## First run

Ist Fall oder Belegumfang noch unklar, lies
[references/first-run.md](references/first-run.md). Der kurze Wizard:

1. behält den ursprünglichen Auftrag;
2. stellt höchstens eine Frage pro Nachricht;
3. lässt einen bereits eindeutig geöffneten Fall gewinnen;
4. bestätigt andernfalls Fall und vollständige Belegquellen;
5. zeigt einen sicheren Plan und setzt nach Bestätigung den ursprünglichen
   Auftrag fort.

Bereits beantwortete Fragen nicht erneut stellen. Der First run darf keine
Installerbefehle als Standardaktion ausführen, keine Clientkonfiguration
verändern und keine versteckte Systemänderung vornehmen.

## Harte Grenzen

Diese Regeln gelten auch auf ausdrücklichen Wunsch:

- Niemals über ELSTER senden, übermitteln, bestätigen oder abschließen. Keinen
  Versandklick und keinen Umgehungsweg vorbereiten.
- Originale und übermittelte Falldateien niemals löschen, überschreiben,
  umbenennen oder verschieben. Archive sind nur über den ausdrücklich
  beauftragten, inventar- und hashgebundenen `sse_archive_cases`-Vertrag
  zulässig.
- Ein bereits eindeutig geöffneter Fall ist der Arbeitsfall. Nie still einen
  anderen öffnen. Bei mehreren offenen Fällen genau eine Auswahlfrage stellen.
- Eine Arbeitskopie, `save_as`, Schließen oder Verwerfen ist keine implizite
  Sicherheitsmaßnahme und braucht einen ausdrücklichen Auftrag.
- Ändern ist nicht Speichern. `sse_save` oder `sse_save_as` nur nach einem
  getrennten ausdrücklichen Speicherauftrag für den exakt gebundenen Fall.
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

## Wiederverwendbarer Ablauf

1. **Binden:** Nach `sse_preflight` mit `sse_instances` den einen eindeutig
   geöffneten Fall, PID/HWND und aktuellen Disk-Hash lesen. Bei
   Wiederherstellungszustand stoppen; mit einem wiederhergestellten Fall nicht
   weiterarbeiten.
2. **Planen:** Auftrag als Prüfung, Belegabgleich, Änderung, UStVA oder
   Fallanlage erkennen. Nur die dafür nötigen Quellen und Operationen vorsehen.
   Offene fachliche Entscheidungen (Einkunftsart, Kleinunternehmer, Soll/Ist,
   Zuordnung strittiger Belege) in **einer Klärungsrunde** gebündelt mit je
   einem begründeten Vorschlag stellen; dabei fragen, ob der Nutzer den
   **betreuten Modus** (jeder Schritt bestätigt) oder den **selbstständigen
   Modus** (bestätigter Plan, Lücken am Ende) will. Ohne Antwort gilt betreut.
   Buchungsregel: Ein-/Ausgaben in die Kostenarten der Gewinn-Erfassung
   buchen; Vorsteuer und UStVA leitet das Programm daraus ab. Direkte
   UStVA-Beträge sind nur ein begründeter Fallback auf ausdrücklichen Wunsch.
   Den sicheren Plan kurz bestätigen lassen, wenn er Navigation, Dateien oder
   Mutationen umfasst.
3. **Sichern:** Vor `sse_collect`, `sse_goto`, `sse_subpages`, navigierendem
   `sse_click_point`, Programm-Prüfer oder Mutation den unveränderten
   Dateistand genau einmal nach `backups:` sichern. Der vollständige
   Sitzungsvertrag steht in
   [references/case-session.md](references/case-session.md).
4. **Lesen:** Verfügbare Werkzeuge und Grenzen aus `sse_capabilities`, der
   API-Selbstbeschreibung und dem installierten API-Vertrag ableiten. Belege
   nur aus bestätigten Quellen inventarisieren. Ergebnisse strukturiert lesen;
   Screenshots sind nur ergänzende Evidenz.
5. **Ändern:** Nur genau eine eng gebundene Änderung oder einen bestätigten
   Batch ausführen. Für Tabellen den frisch gelesenen Vorwert beziehungsweise
   `expectedBefore` verwenden. Wert, Summe, Hash und Dirty-State sofort
   zurücklesen.
6. **Prüfen:** Nach einer vollständigen Bearbeitung den Programm-Prüfer mit
   `sse_checker_open` laufen lassen und jede Meldung mit Fundstelle und einem
   Vorschlag auflisten, statt sie still zu übergehen. Erscheint beim Navigieren
   der automatische Hinweis „Die Prüfung hat ergeben …“, mit
   `sse_warning_popup_read` lesen und nur fingerprintgebunden über
   `sse_dialog_answer` („Jetzt ignorieren“ oder „Als gelesen markieren“)
   beantworten; den Navigationsklick nicht wiederholen, sondern
   `sse_ui_state` neu lesen. Nennt der Hinweistext ELSTER (etwa „ELSTER:
   Einkunftsart fehlt!“), bleibt er gesperrt: dann die Ursache beheben, also
   das fehlende Feld füllen, statt den Hinweis wegzuklicken.
7. **Abschließen:** Fall offen lassen. Knapp sagen, was gelesen oder geändert
   wurde, ob die Änderung nur im Programm steht und dass nicht gespeichert
   beziehungsweise nicht übermittelt wurde. Einen Bericht nur auf Auftrag
   anlegen und dessen Ergebnisdatei samt Hash zurücklesen.

MCP ist der Standardtransport und bleibt PC-blind; die lokale API führt die
Windows-Arbeit aus. Direkte API-Nutzung ist nur ein vom Nutzer ausdrücklich
gewählter Expertenmodus. Während einer möglicherweise begonnenen Mutation nie
still den Transport wechseln.

## Spezielle Referenzen

Lies nur die Referenz, die der aktuelle Auftrag tatsächlich braucht:

- [first-run.md](references/first-run.md) — Fall oder Belegumfang ist noch
  nicht eindeutig bestätigt;
- [case-session.md](references/case-session.md) — jede dirty-fähige Navigation,
  Mutation, Sicherung, Arbeitskopie oder Speicherung;
- [ustva.md](references/ustva.md) — nur bei UStVA, Gewinn-Erfassung oder dem
  belegten Folgejahrweg;
- [case-create.md](references/case-create.md) — nur wenn ausdrücklich ein
  neuer Fall angelegt werden soll oder kein passender Fall existiert;
- [steuerquellen.md](references/steuerquellen.md) — betragsrelevante oder
  strittige steuerfachliche Begründung;
- [ui-fallback.md](references/ui-fallback.md) — nur wenn für ein benötigtes
  Control keine Spezialoperation existiert;
- [belegmanager-backup.md](references/belegmanager-backup.md) — nur für eine
  in einem späteren Release ausdrücklich freigegebene BelegManager-Mutation.

Erfinde keine Releaseversion, Pfade, Werkzeuge, Felder oder Clientbefehle aus
Modellwissen. Der installierte Vertrag bleibt autoritativ.
