# Kompatibilität, UI-Fallback und Diagnose

Lies diese Referenz, wenn für eine benötigte Aufgabe kein geeigneter
strukturierter Hauptweg verfügbar ist, eine benötigte UIA-Positionierung
frisch nachgewiesen wurde oder eine gezielte Diagnose nötig ist.
Ein Fehler eines Hauptwegs allein ist keine Erlaubnis zum Methodenwechsel.

| Gruppe | Einsatz |
| --- | --- |
| Hauptweg | Fachliche Leser und Spezialoperationen, insbesondere `sse_read_page`, `sse_table_read`, gebundene Feldänderungen und Tabellen-/UStVA-Werkzeuge. `sse_snapshot`, `sse_find` und `sse_get_value` ergänzen gezielt die Zustands- und Identitätsprüfung. |
| Kompatibilität/UI-Fallback | Sichtbares `sse_read_table`, ausdrücklich aktives `sse_table_read` mit `noKeys: false`, generische Klick-, Baum-, Scroll- und Menüwege nur bei fehlendem geeigneten Hauptweg oder frisch belegtem UIA-Positionierungsbedarf. `sse_set_value` bleibt ausschließlich für das globale steuerneutrale Suchfeld zulässig. |
| Diagnose | `sse_screenshot`, `sse_snapshot_compare`, `sse_accessibility_probe`; begrenzt einsetzen und keine Schreibbestätigung daraus ableiten. |

Für Tabellen zuerst den passiven Modellbestand des verifizierten Qt-Backends
nutzen. Ohne dieses Backend liefert gewöhnliches UIA mit `noKeys: true` nur
sichtbare Zeilen; für ein vollständiges passives Inventar vorab
`readMode: "grid"` wählen und Vollständigkeit prüfen. Ein vollständiger
Gridbestand beweist Daten, aber keine Sichtbarkeit oder Materialisierung einer
UIA-Schreibzelle. Lies Ziel und Sichtbarkeit zuerst frisch; wähle erst dann
bewusst die erforderliche UIA-Vorbereitung. Im nichtnativen Pfad verlangt
`sse_table_update` und `sse_table_delete` bereits sichtbare Zielzeilen und
führen keinen eigenen Zeilensuchlauf aus. `sse_table_add` besitzt seinen
eigenen einmaligen bewachten Suchlauf. Die UIA-Löschung prüft den vollständigen
ausgelesenen Gridbestand vor und nach genau einem Löschbefehl; gleiche Texte
oder eine unveränderte Summe allein belegen keinen Erfolg. Bei ungewissem
Ausgang frisch abgleichen und den Auftrag nicht automatisch wiederholen.
Ein bestätigter Daten-Rollback kann die Änderungsmarkierung gesetzt lassen.
`ungespeichertVorher`, `ungespeichertNachher` und `dirtyStateUnchanged`
auswerten; daraus keine Erlaubnis zum Speichern oder Verwerfen ableiten.

Den aktiven Cursorlauf mit `noKeys: false` nur ausdrücklich für fehlende
vollständige passive Lesepfade, belegte UIA-Positionierung/Materialisierung
oder gezielte GUI-Diagnose wählen. Die Positionsausnahme gilt auch bei einem
vollständigen Gridread. Ein vollständiger Cursorlauf macht das Tabellenende
sichtbar; er positioniert keine beliebige Zielzeile. Er hilft daher nur, wenn
das Ende nachweislich die benötigte Position ist. Eine andere Zielzeile braucht
einen dafür geeigneten gebundenen Weg; ohne frischen Zielnachweis stoppen.
Ein nativer Tabellenänderungsweg braucht keinen vorherigen vollen Cursorlauf.
Nach einem Fehler keine automatische Methoden- oder Backendwahl und nach
ungewissem Mutationsausgang keine blinde Wiederholung oder Vorbereitung.

Ist eine generische UI-Aktion erforderlich:

1. Benenne den fehlenden Hauptweg oder nachgewiesenen UIA-Positionsbedarf
   und lies frisch `sse_page_state` oder `sse_ui_state`.
2. Entdecke das Control ausschließlich lesend mit `sse_snapshot`, `sse_find`
   und bei Bedarf `sse_accessibility_probe`.
3. Übernimm Selektoren samt Namensraum aus diesem frischen Zustand. Eine
   veraltete RuntimeId verlangt eine neue Beobachtung desselben gebundenen
   Ziels. Die RuntimeId nicht weglassen, durch einen ähnlichen Namen ersetzen
   oder den Namensraum wechseln, um einen fehlgeschlagenen Aufruf zu erzwingen.
4. Verwende für Checkboxen `sse_toggle`, für Listen `sse_combo_options` plus
   `sse_combo_select` und für Textfelder `sse_change_known_field` oder
   `sse_change_field` mit deren Vorbedingungen.
5. Verwende `sse_click` nur, wenn Ziel, Seite, Fenster und Nachbedingung
   eindeutig sind. Nutze niemals einen generischen Toggle-Klick. Für einen
   unterstützten RadioButton ohne Fachwerkzeug ist `sse_click pattern=select`
   mit exakter AutomationId und anschließender Gruppenprüfung zulässig.
6. Physische Eingabe und Koordinaten nur innerhalb des dafür vorgesehenen,
   frisch gebundenen API-Vertrags verwenden. Keine freie Maus/Tastatur und
   keine Klick-, Scroll- oder Menüfolge zum Umgehen einer Sperre.
7. Lies nach jeder Interaktion den Zustand neu. Bei Mehrdeutigkeit,
   veralteter Bindung, Hashabweichung, unerwartetem Dialog, Fremdeingabe,
   Recovery-Zustand, Transportfehler, ungewisser Mutation oder fehlgeschlagenem
   Readback stoppen und den Zustand klären. Ein neuer Versuch braucht frische
   Nachweise; nicht automatisch eine andere Methode oder ein anderes Backend
   durchprobieren und eine möglicherweise ausgeführte Mutation nicht
   wiederholen.

Ein unbekannter Dialogbutton wird in `unsupportedButtons` gemeldet, bleibt aber
gesperrt. Zeige ihn dem Nutzer und stoppe. Erweitere die Allowlist nicht zur
Laufzeit und bestätige keine Dialogkette blind.
