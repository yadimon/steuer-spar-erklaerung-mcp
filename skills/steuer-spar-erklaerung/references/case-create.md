# Neuen Steuerfall anlegen

Lies diese Referenz nur, wenn der Nutzer ausdrücklich einen **neuen** Fall
verlangt oder `sse_instances` und der bestätigte Fallordner keinen passenden
Fall enthalten. Ein bereits geöffneter Fall bleibt der Arbeitsfall; ein neuer
Fall ersetzt ihn nie still.

## Was `sse_case_create` tut

Es startet das Programm ohne Datei auf dem sichtbaren Desktop, führt den echten
Startassistenten (`Jetzt beginnen` → Navigator-Modus → `Weiter`) bis zur
ersten Stammdatenseite und speichert den leeren Fall sofort über den
Programmdialog „Speichern unter“ unter `targetRef`. Danach bleibt der Fall
geöffnet; das Ergebnis liefert `pid`, `hwnd`, `caseRef` und `sha256`.

Derzeit ist nur `mode: "einurvor"` freigegeben: die Gewinn-Erfassung des vom
Profil freigegebenen Folgejahres, Zieldatei `cases:<name>.GewErfass2026`. Eine
Einkommensteuer-Datei für ein anderes Jahr legt das Produkt 2025 nicht an.

## Voraussetzungen, die du vorher prüfst

1. `sse_instances` meldet `count=0`. Sonst zuerst den offenen Fall bewusst
   sichern oder auf ausdrücklichen Auftrag schließen.
2. `sse_desktop_status` meldet `aktiv=false`. Der Assistent braucht den
   sichtbaren Desktop; der erste Klick ist auf dem versteckten Desktop gesperrt.
3. Der Zielname ist neu, trägt die passende Endung und enthält keine privaten
   Daten wie Steuernummern. Ein vorhandenes Ziel wird niemals überschrieben.
4. Der Nutzer hat die Fallanlage in dieser Aufgabe ausdrücklich verlangt.

## Klärungsrunde vor der Anlage

Stelle die fachlichen Fragen **gebündelt in einer Nachricht**, jeweils mit
einem begründeten Vorschlag, und warte auf die Antwort:

- Dateiname des Falls;
- Einkunftsart (`Gewerbebetrieb`, `selbstständige Tätigkeit`,
  `Land- u. Forstwirtschaft`) und Rechtsform;
- Kleinunternehmer nach § 19 UStG ja/nein;
- Soll- oder Istversteuerung — das ist eine Steuerentscheidung, kein Vorgabewert;
- Meldezeitraum der UStVA, sofern bekannt;
- gewünschter Modus: **betreut** (jeder Schritt wird vor der Ausführung
  bestätigt) oder **selbstständig** (du arbeitest den bestätigten Plan ab und
  meldest am Ende Lücken und Zweifelsfälle). Ohne Antwort gilt betreut.

## Ablauf nach der Anlage

1. Ergebnis lesen: `created=true`, `sha256`, `hwnd`, `pid`. Bei `created=false`
   wurde die gestartete Instanz ohne Speichern beendet; bei
   `postcondition-failed` mit `created=true` existiert die Datei, der Zustand
   ist mit `sse_instances` zu klären.
2. Den frischen Dateistand einmal mit `sse_make_working_copy` nach `backups:`
   sichern (Quellhash = `sha256` der Anlage).
3. Stammdaten über die katalogisierten Seiten schreiben; das Werkzeug richtet
   sich nach dem `controlType` des Felds:
   - Text- und Datumsfelder (`Edit`) mit `sse_fill_fields`, Auswahlfelder
     (`ComboBox`, z. B. `rechtsform`, `einkunftsart`) mit `sse_combo_select`
     und exakter `aid` aus dem Katalog, Kontrollkästchen (`CheckBox`) mit
     `sse_toggle`. Alle drei verlangen Fallreferenz, aktuellen Hash und Vorwert.
     `sse_page_state` liefert den Haken eines Kontrollkästchens als Text
     `True`/`False`; daraus den booleschen `expectedBefore` für `sse_toggle`
     ableiten.
   - `gew_erfass.allgemeine_angaben_unternehmen`: Name, Vorname, Firmenname,
     Art des Unternehmens, Adresse, Kontakt, `rechtsform`, `einkunftsart`,
     `gruendungsdatum`. Die Postleitzahl füllt den Ort automatisch; danach
     `ort` nicht mit `expectedBefore: ""` schreiben. Die `einkunftsart` vor dem
     Verlassen der Seite setzen: Sonst zeigt der Programm-Prüfer den Hinweis
     „ELSTER: Einkunftsart fehlt!“, und ein Hinweis mit ELSTER im Text ist für
     `sse_dialog_answer` gesperrt.
   - Über `sse_click aid=AngabenUnternehmen.Steuerarten.Button` zur Seite
     `gew_erfass.themenfilter_umsatzsteuer`: Kontrollkästchen der
     Themen (Umsatzsteuer, Zusammenfassende Meldung, Gewerbesteuer,
     Lohnsteuer), `umsatz_vorjahr`, Daten der Unternehmereigenschaft.
   - RadioButtons haben kein Page-Object-Feld. Kleinunternehmer,
     Besteuerungsart (`Nein` = Istversteuerung) und Umsatzsteuersatz-Änderung
     nur mit `sse_click pattern=select` und exakter `aid` aus den
     `notes.radioButtons` des Katalogs setzen und die Gruppe zurücklesen.
4. Steuernummer, Finanzamt und mitwirkende Person liegen auf eigenen Unterseiten
   hinter den Schaltern `AngabenUnternehmen.GotosFAundMitwirk.*.Button`; nur auf
   Auftrag und nach Readback der Seite.
5. Speichern bleibt ein getrennter, ausdrücklich freigegebener `sse_save` mit
   dem aktuellen Hash. Bis dahin ist alles nur im Programm.

## Wenn der Start scheitert

Stirbt das Programm vor dem ersten Speichern, fragt der nächste Start nach
einer Wiederherstellungsdatei. Für diesen Prozess gibt es keine reguläre Datei:
`sse_dialog_answer` mit `button: "Nein"` und `discardUnsavedRecovery: true`
verwirft sie, sofern die Kommandozeile der PID beweist, dass kein Fall geladen
war. Eine markierte versteckte Instanz ohne Hauptfenster beendet
`sse_desktop_stop` nur mit `discardChanges: true`. Beides niemals für einen
Prozess mit gebundener Falldatei verwenden.
