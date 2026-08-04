> Entwicklungsarchiv, keine Laufzeit-Anweisung. Dieser historische Skill- und
> Tool-Katalog bleibt nur für Refactorings, Regressionen und Ursachenanalyse
> erhalten. Öffentliche Agenten-Skills liegen unter `skills/` und dürfen diese
> Datei nicht als Betriebsanleitung laden.

---
name: steuer-spar-erklaerung
description: Deutsche Arbeitsanleitung zum Lesen, Prüfen und kontrollierten Bearbeiten einer Steuererklärung in der Windows-Desktopanwendung SteuerSparErklärung über die lokale SSE-API und ihren MCP-Wrapper. Verwenden, wenn Steuerfälle, UI-Seiten, Tabellen, Prüfer, Arbeitskopien oder reproduzierbare SSE-Szenarien bearbeitet werden; niemals für ELSTER-Versand oder andere Übermittlungen ans Finanzamt.
---

# SteuerSparErklärung bedienen

Betriebsanleitung für die Steuerung der SteuerSparErklärung über den
MCP-Server `steuer-spar-erklaerung`. Jede Regel hier ist durch eine Messung
am laufenden Programm belegt, nicht geraten.

Für Diagnose, Implementierung oder Erweiterung des MCP-Servers die vollständige
sanitisierte Erfahrungsreferenz lesen:
[`sse-automation-erfahrungen.md`](sse-automation-erfahrungen.md).
Sie dokumentiert auch gescheiterte Ansätze, Nachbedingungen, Recovery,
Tabellenverträge, Prüfergrenzen und den aktuellen Backlog.

## Zuerst API und Arbeitsbereich prüfen

Der MCP ist ausschließlich ein Wrapper der lokalen API. Er darf keine lokale
SSE-Installation, Fall- oder Ergebnisordner erraten. Zu Beginn
`sse_workspace_status` aufrufen; fehlen Einstellungen, den separaten Skill
`steuer-spar-erklaerung-setup` verwenden.

- Mit `sse_workspace_files` nur relative Referenzen samt Größe und SHA256
  auflisten.
- Mit `sse_workspace_read_text` Eingaben oder Ergebnisse lesen.
- Mit `sse_workspace_write_text` neue Texte unter neuen Referenzen schreiben;
  vorhandene Dateien nie ersetzen.
- Mit `sse_run_scenario` versionierte JSON-Abläufe seriell ausführen. Der
  direkte API-Aufruf und der MCP-Wrapper müssen dieselbe kanonische
  Ergebnisdatei samt SHA256 liefern.

Keine absoluten Pfade, Token, Benutzernamen oder echten Steuerwerte in Skill,
Szenario-Vorlagen oder Repository übernehmen. Lokale Eingabedateien bleiben im
von der API konfigurierten Arbeitsbereich.

## Die eine Regel, die nicht verhandelbar ist

**Niemals etwas ans Finanzamt übermitteln.** Ein Versand ist nicht
rückholbar.

Der Server sperrt diese Namen hart (`sse_click` und `sse_click_point`
verweigern sie, geprüft wird Beschriftung *und* AutomationId):

`ELSTER` · `Anmeldungen versenden` · `Jahreserklärungen abschließen` ·
`Belege nachreichen` · `Kommunikation mit dem Finanzamt per ELSTER` ·
`Senden` · `Senden & Drucken` · `Versenden` · `Übermitteln` · `Abschicken`

Der Vergleich läuft über eine Normalform (Auslassungspunkte, Satzzeichen,
Zugriffstasten-`&`, Umlaute werden entfernt) plus Wortstämme wie `elster`,
`versend`, `übermittl`, `abschließ`, `nachreich`. Damit greifen auch
`Jahreserklärungen abschließen…`, `&Senden` und `Versand per ELSTER`.

`sse_keys` ist vollständig aus der öffentlichen MCP-Oberfläche entfernt und
auch beim direkten Worker-Aufruf gesperrt. Eine Roh-Tastatur kann weder das
fokussierte Steuerelement noch den Empfängerprozess ausreichend binden und
könnte dadurch Steuerfelder, Löschbefehle oder sogar einen Versand auslösen.

Wenn eine dieser Sperren greift, ist das **kein Fehler, der zu umgehen
wäre**. Nicht nach Umwegen suchen, nicht per Roh-Tastatur nachhelfen, nicht
über die Menüzeile gehen. Dem Nutzer sagen, dass er den Versand selbst
auslösen muss.

## Harte Produktgrenze: nur Steuerjahr 2025

Dieser MCP steuert ausschließlich die SteuerSparErklärung 2025. Vor jeder
Prozessbindung werden `SSE.exe`, der Installationsordner `Steuerjahr 2025` und
die feste binäre Engine-Hauptversion 31 geprüft. `sse_product_info` zeigt die
verifizierte Standardinstallation sowie laufende unterstützte und ignorierte
SSE-Versionen. Ein gleicher Prozessname ist ausdrücklich kein Nachweis.

Bei einem Start mit Falldatei müssen Endungsjahr und Modul zusammenpassen,
beispielsweise `einur` mit `.Gew2025` oder `normal` mit `.ESt2025`. Andere
Jahre, freie Prozessnamen, Wildcards, unbekannte Modi und unlesbare
Prozesspfade sind fail-closed. Nicht umgehen und keine ältere Jahresversion
ersatzweise automatisieren.

Unbedenklich: lesen, blättern, Navigationsbaum, `Sichern`, `Ergebnis`,
`Prüfer`, `Formular`, `Drucken`.

**Auftragsscope bleibt verbindlich.** Wenn der Nutzer nur die
Jahreserklärung bearbeiten lassen will, dürfen Seiten der
Umsatzsteuer-Voranmeldungen höchstens read-only zur Plausibilitätskontrolle
geöffnet werden. Keine Quartalswerte ändern, keine Voranmeldung vorbereiten
und keine aus einer Jahreskorrektur abgeleitete Quartalsänderung automatisch
übernehmen.

## Vor jeder Sitzung: Gesundheit prüfen

```
sse_health
```

Interessant ist `canaryMs` — die Dauer der billigsten UIA-Abfrage.

| canaryMs | Bedeutung | Was tun |
|---|---|---|
| < 100 ms | gesund | arbeiten |
| 100–1500 ms | träge | vorsichtig, weniger Abfragen |
| > 1500 ms, Dialog gemeldet | modal blockiert UIA | `sse_dialog_list`, gezielt antworten; **nicht neu starten** |
| > 1500 ms, kein Dialog | überlastet | Zustand sichern, dann bewusster Neustart |

**Warum das zählt:** Bei überlastetem Programm liefert die UIA-Schnittstelle
nicht etwa Fehler, sondern still **„nichts gefunden"**. Ein Agent hält das
für eine leere Seite und meldet dem Nutzer falsche Steuerzahlen. Deshalb:

> **„Nicht gefunden" ist bei diesem Programm kein Befund, sondern ein
> Verdacht.** Immer erst `sse_health`, bevor man aus einem leeren Ergebnis
> eine Schlussfolgerung zieht.

Das Programm degradiert **kumulativ** unter Last. Nach etwa 60–80 gelesenen
Seiten wird es zäh. Dann neu starten — das ist normal, kein Defekt.

## Laufenden Zustand in einem Aufruf lesen

Zu Beginn einmal `sse_result_details` öffnen. Danach für die normale Arbeit
`sse_ui_state` verwenden. Es liest in einem einzigen Qt/UIA-Bulk-Snapshot:

- exakte SSE-PID und Hauptfenster-HWND;
- Seitenüberschrift und Dirty-State;
- fingerprintgebundene echte Dialoge, getrennt von Werte-Info,
  Steuer-Spar-Tipps und UAC-Overlays;
- unbekannte oder nicht lesbare SSE-Fenster als blockierenden Fehlerzustand;
- Seitenprüfer, Fehlerbaum, leere Pflichtfelder und globalen Prüfer;
- die vollständigen Werte aus der bereits offenen Werte-Info.

`stateFingerprint` beim nächsten Aufruf als `previousFingerprint` übergeben.
`changedSince=false` beweist, dass dieser logisch relevante UI-Zustand gleich
blieb; `true` verlangt eine neue Entscheidung. Der Fingerprint enthält keine
Fallwerte im Repository, sondern existiert nur in der MCP-Antwort. Ein
aktueller Messlauf brauchte median 2,128 s statt zusammen 6,187 s für die drei
separaten Lesungen Seitenprüfer, Globalprüfer und Werte-Info.
Sind mehrere SSE-2025-Hauptinstanzen sichtbar, brechen `sse_ui_state` und
`sse_result_details` ohne ein zuvor gelesenes eindeutiges `hwnd` ab; Fenster
anderer PIDs werden nie in den Zustand oder das Ergebnis desselben Falls
gemischt. `vollstaendig=true` bei Ergebniswerten verlangt vier positionierte
Spalten, keine virtualisierten 0×0-Zellen, keinen vertikal ausgeblendeten
Tabellenteil und eine stimmige Invariante
`Differenz = Aktuell − Festgehalten`.

Nach jeder fachlichen Mutation weiterhin deren eingebauten Vorher-/Nachher-
Diff auswerten und anschließend `sse_ui_state previousFingerprint="..."`
lesen. Ein unerwartet gleich gebliebener Fingerprint ist kein Erfolg einer
beabsichtigten Änderung; ein unerwartet geänderter Fingerprint ist ein Grund,
vor dem nächsten Klick neu zu lesen.

## Was das Programm besonders macht

Die SteuerSparErklärung ist eine **Qt-6-Anwendung**. Qts
Accessibility-Brücke ist lückenhaft, daraus folgen drei Eigenheiten:

1. **`FindAll` ist unbrauchbar** und vergiftet nach einem Fehlschlag die
   UIA-Verbindung des ganzen Prozesses. Der Server umgeht das mit einem
   frischen Prozess je Aufruf. Die Prozessisolation bleibt zwingend; die
   Win32-/MSAA-Typen kommen jedoch aus der beim Build erzeugten
   `sse-native.dll`. Ohne laufendes SSE wurden nach der Hashbindung intern etwa
   0,130–0,156 s statt 0,41–0,44 s gemessen. Fehlt die DLL, wird sichtbar und
   sicher aus `sse-native.cs` kompiliert. Ein SHA256-Sidecar verhindert, dass
   eine veraltete DLL zum Quelltext passt; der Hidden-Desktop-Launcher nutzt
   denselben Loader. Vier reale Lebenszyklusläufe lagen stabil bei
   36,50–37,04 s statt zuvor rund 43,5 s. `sse_product_info` meldet Modus,
   Hashbindung und Initialisierungszeit.
2. **Der Navigationsbaum ist eine flache Liste**, und `GetNextSibling` auf
   dem *ausgewählten* Eintrag liefert unbegrenzt ihn selbst. Folge: die
   Aufzählung bricht beim ausgewählten Eintrag ab — **alles darunter ist
   unsichtbar**. `sse_snapshot types=['TreeItem']` zeigt also nie den
   ganzen Baum.
3. **Werte stehen nicht im Namen.** Beträge in Formularfeldern liegen im
   `ValuePattern`, in Tabellenzellen dagegen im *Namen*. `sse_read_page`
   holt beides und schreibt `Beschriftung = Wert`. Wer nur Namen liest,
   liest eine Steuererklärung ohne Zahlen.
4. **Tabellen sind virtualisiert.** Nur die *sichtbaren* Zeilen stehen im
   UIA-Baum. Es gibt keinen scrollbaren Container, `ScrollPattern` findet
   nichts und `{PGDN}` bewirkt nichts. `sse_read_table` liefert deshalb
   stillschweigend eine *unvollständige* Tabelle — in einem realen Testfall
   waren nur 6 von 15 Zeilen sichtbar und die Teilsumme dadurch deutlich zu
   niedrig.

   **Vollständig lesen geht nur über den Cursor:** `sse_table_read` springt
   zuerst mit Strg+Pos1 an den Tabellenanfang, wandert mit der Pfeiltaste
   durch die virtualisierten Zeilen und führt die Lesungen zusammen. Die
   zurückgegebene Reihenfolge beginnt deshalb stabil oben. Nur wenn
   `vollstaendig=false` gemeldet wird, ist die Lesung als Teilergebnis zu
   behandeln. Gibt es mehrere Eingabetabellen, `sumLabel` und
   `sumOccurrence` für die gewünschte Summenregion angeben; ohne diese
   Bindung bleibt der Lauf bewusst unvollständig und fokussiert keine
   zufällige Tabelle. Nicht-modale Werte-Info-Tabellen sind keine
   Eingabetabellen und werden ausgeschlossen. Außerdem
   `ungespeichertVorher`, `ungespeichertNachher` und
   `ungespeichertEingefuehrt` beachten: Qt kann schon durch Cursorbewegungen
   einen Fall als geändert markieren. Ein reiner Lesevorgang darf dann nicht
   blind gespeichert werden.

   **Gegenprobe:** die Summenzeile der Seite mit der Summe der gelesenen
   Zeilen vergleichen. Stimmen sie nicht überein, fehlen Zeilen.

5. **VaSt ist eine Zuordnungsphase, kein automatischer Merge.** Im Dialog
   `Daten der vorausgefüllten Steuererklärung` muss jede FA-Bescheinigung einem
   lokalen Eingabefenster, einem neuen Datensatz oder `nicht übernehmen`
   zugeordnet werden. Zuerst `sse_vast_dialog_read`, für Quellwerte
   `sse_vast_row_details` und für mögliche lokale Ziele
   `sse_vast_mapping_options` verwenden. Eine eindeutige Zuordnung darf mit
   `sse_vast_mapping_select` geändert werden; das übernimmt noch keine Daten.
   Erst wenn alle Zeilen erneut gelesen, ungelöste und riskant doppelte Ziele
   ausgeschlossen sowie Steuerfall und Disk-Hash gesichert sind, darf
   `sse_vast_apply` mit dem vollständigen Plan in derselben Reihenfolge und
   `acknowledgeApply=true` aufgerufen werden. Das Werkzeug übernimmt genau
   diesen Plan, speichert nicht und beantwortet keine neuen Folgedialoge.
   Danach die betroffenen Felder und die Steuerberechnung erneut lesen.
   Der anschließende Hinweisdialog ist separat zu lesen und erst dann mit
   `sse_dialog_answer` fingerprintgebunden zu schließen. Der offizielle passive
   Satz, dass Wahlleistungen nicht immer per VaSt übermittelt werden, ist keine
   Versandaktion; ausschließlich für diesen exakten Hinweis und den Button
   `Schließen` gilt eine enge Ausnahme vom sonst breiten Versand-Guard.
   `sse_vast_row_set_expanded` ist nur für einen bewusst beibehaltenen
   Ansichtszustand gedacht; zum normalen Lesen klappt `sse_vast_row_details`
   selbst auf und stellt den Ausgangszustand wieder her.
   Der normale Dialog-Fingerprint ist nach dem Aufklappen wegen Qts virtuellem
   Accessibility-Baum instabil. Maßgeblich ist der `mappingFingerprint` der
   sichtbaren Zertifikat-Ziel-Paare. Mehrere Bescheinigungen derselben Art auf
   dasselbe lokale Ziel sind ein Konflikt. Ein geöffnetes Qt-Dropdown niemals
   durch einen zweiten Pfeilklick schließen: Das kann den ersten Eintrag
   auswählen. Escape ist nur nach unabhängig bestätigtem Popup zulässig.

## Zwei Betriebsarten

### Versteckt — `sse_desktop_start`

Das Programm läuft auf einem eigenen Windows-Desktop-Objekt. Sein Fenster
**kann** auf dem sichtbaren Desktop nicht erscheinen — harte Grenze des
Fenstermanagers, keine Höflichkeitsregel. Der Nutzer arbeitet ungestört
weiter, auch beim Blättern.

Der Start wird direkt auf dem Ziel-Desktop verifiziert und wartet standardmäßig
höchstens 30 Sekunden (`timeoutSec`). `sse_desktop_status` muss danach das
eigene Fenster samt PID zeigen; eine aktive Marke mit leerer Fensterliste gilt
nicht als erfolgreicher Start. Ein zweiter Start überschreibt weder eine aktive
Marke noch übernimmt er ein älteres SSE-Fenster: Nur die PID des soeben mit
`CreateProcess` erzeugten Prozesses darf Eigentümer werden.

`sse_desktop_stop` arbeitet nur mit einer gültigen Marke aus Desktopname und
PID und verlangt zusätzlich ein Fenster genau dieser PID auf genau diesem
Desktop. Es übernimmt nie ersatzweise eine einzelne sichtbare SSE-Instanz.
Bekannte kompakte Hilfsfenster der exakt gebundenen PID (beobachtet:
»Die Prüfung hat ergeben …«, »Steuer-Spar-Tipps«, »Werte-Info«) darf es zuerst
schließen. Die zwei 50×50-UAC-Eingabeindikator-Overlays werden als harmlose
Systemfenster ignoriert und verschwinden mit dem Prozess; ein unbekanntes oder
ungewöhnlich großes gleichnamiges Fenster blockiert den Stop zur manuellen
Prüfung.
Danach schließt es das Hauptfenster und beantwortet eine echte
Speichern-Rückfrage nur bei explizitem `discardChanges=true` mit
Nein/Verwerfen. Speichern selbst erfolgt vorher über `sse_save` mit exaktem
Pfad und Vorher-Hash; `save=true` im Stop ist gesperrt. Ohne ausdrückliches
Verwerfen bleibt ein unerwartet dirtyer Fall samt Marke offen. Nur ein
expliziter Verwerf-Stop darf die eigene, weiterhin exakt gebundene Instanz nach
der Schonfrist hart beenden; das bleibt als `hartBeendet=true` sichtbar.

Gemessen: Seitenwechsel von »Beiträge, Gebühren und Abgaben« nach
»Versicherungen«, Vordergrundfenster des Nutzers durchgehend unverändert.

**Was dort geht — und was nicht:**

| Werkzeug | versteckt | sichtbar |
|---|---|---|
| `sse_page`, `sse_read_page`, `sse_snapshot`, `sse_find`, `sse_get_value` | ✓ | ✓ |
| `sse_ui_state` (PID/HWND, Dialoge, Prüfer, Dirty-State, offene Ergebniswerte) | ✓ | ✓ |
| `sse_center_cases` (Steuertipps-Center: Verzeichnis und Fallliste) | ✗ | ✓ |
| `sse_center_refresh` (nur Center-Ansicht aktualisieren) | ✗ | ✓ |
| `sse_screenshot` | ✓ | ✓ |
| `sse_set_value` (nur globales Suchfeld; Steuerfelder gesperrt) | ✓ | ✓ |
| `sse_change_known_field`, `sse_change_field` (echter Qt-Commit + Ergebnis-Diff) | ✗ | ✓ |
| `sse_click` (InvokePattern → Weiter, Zurück, Sichern) | ✓ | ✓ |
| `sse_goto` innerhalb eines bekannten Blätterpfads | ✓ | ✓ |
| `sse_table_add` bei bereits sichtbarer Leerzeile | ✓ | ✓ |
| `sse_table_update` für sichtbare bestehende Zeile | ✓ | ✓ |
| **`sse_click_point`** (nur Navigations-/Prüfer-TreeItems) | ✗ | ✓ |
| **`sse_table_read`** (braucht Pfeiltaste) | ✗ | ✓ |
| **`sse_table_delete`** (braucht Tastatur) | ✗ | ✓ |
| `sse_checker_results`, `sse_checker_run` | ✓ | ✓; bei `konsistent=false` ist der sichere UIA-Snapshot unvollständig |
| `sse_warning_popup_read` | ✓ | ✓; Titel/Aktionen per UIA, Fließtext lokal per OCR |
| `sse_dialog_answer` für »Als gelesen markieren«/»Jetzt ignorieren« | ✓ | ✓; nur mit aktuellem Fingerprint |
| **`sse_checker_open`** (braucht echten Baumklick) | ✗ | ✓ |
| `sse_combo_options` | ✓ | ✓ |
| `sse_combo_select` | nur wenn Qt `SelectionItem` wirklich übernimmt | ✓ |
| `sse_toggle` (echte CheckBox mit Seite/Vor-/Nachzustand) | ✓ | ✓ |

Für reproduzierbare Hidden-Tabellentests die Arbeitskopie bereits auf der
Zielseite speichern. `sse_table_add` und `sse_table_update` sind dort real mit
Summenbindung, absichtlich falscher Nachbedingung, vollständigem Rollback und
hashgleichem Verwerfen verifiziert. Die globale Qt-Suche kann den exakten
Treffer auf einem versteckten Desktop zwar lesen, aber nicht zuverlässig
aktivieren; niemals still auf einen sichtbaren Klick ausweichen. `sse_table_delete`
bleibt wegen exklusiver Zeilenauswahl plus `Strg+Umschalt+Entf` sichtbar und
bricht hidden vor jeder Mutation mit `kind="hidden-desktop"` ab.

### Vollständige Routing-Landkarte

Jedes angebotene Werkzeug muss hier mindestens einer Betriebsregel zugeordnet
sein. Diese Tabelle ist keine Aufforderung, Low-Level-Werkzeuge unnötig zu
verwenden; sie verhindert, dass ein Agent wegen einer Dokumentationslücke einen
unsicheren Ersatz erfindet.

| Bereich | Werkzeuge | Betriebsregel |
|---|---|---|
| Fensterlage und Aufräumen | `sse_windows`, `sse_center_cases`, `sse_center_refresh`, `sse_ui_state`, `sse_dismiss`, `sse_close` | Erst Lage lesen. `sse_center_cases` liest ausschließlich das sichtbare Steuertipps-Center-Verzeichnis und gleicht es mit primären ESt-/Gew-Falldateien ab; es öffnet oder ändert keinen Fall. `sse_center_refresh` darf nur nach diesem Readback mit exaktem `hwnd`/Ordner die Center-Ansicht neu laden. `sse_dismiss` schließt nur bekannte nicht-modale Helfer; `sse_close` erst nach hashgebundenem `sse_save` oder ausdrücklich mit `discardChanges=true`. |
| Lange Seiten und Hilfetext | `sse_read_full`, `sse_scroll_page`, `sse_scroll`, `sse_help`, `sse_subpages` | `sse_read_full` bevorzugen; manuelles Scrollen nur zur Diagnose. Rechte Eingabehilfe und Unterseiten vor fachlich unsicherer Eingabe lesen. Exponiert Qt dieselbe Unterseite als Hyperlink und Button, bevorzugt `sse_subpages` den verifizierten Hyperlink-Punktklick; reine/unbeschriftete Buttons über den gelieferten `rid` öffnen. |
| Versionierte UI-Metadaten | `sse_page_objects`, `sse_page_state`, `sse_snapshot_compare` | Katalogisierte Felder bevorzugen. Den Bulk-Snapshot auf neuen Qt-Zuständen read-only gegen den sicheren Altpfad vergleichen. |
| Positionsstruktur | `sse_positions` | Ausschließlich `list` ist zugelassen. Struktur manuell anlegen, bis ein eigener Seiten-/Feld-/Summen-/Dialogvertrag mit Readback und Rollback implementiert ist. |
| Menüs | `sse_menu`, `sse_menu_click`, `sse_menu_close` | Menü zuerst lesen. `destruktiv=true` nur nach bewusster Prüfung einmalig mit `acknowledgeDestructive=true` auslösen; Dirty-State danach lesen. Versandpfade bleiben immer gesperrt. Danach ohne Escape über `sse_menu_close` schließen. |
| Segmentaufnahme und Abgleich | `sse_collect`, `sse_verify`, `sse_export_csv` | Nur als kleine Diagnose in einer ungestörten Sitzung: maximal 5 Seiten, Vorgabe 3, mit Memory-/Kanarienguard pro Seite. Im Live-Dialog direkte Tree-/Page-Object-Sprünge verwenden. `sse_export_csv` ist eine unabhängige lokale Gegenprobe und liefert den ersten Dialog direkt fingerprintgebunden; ihn nur mit demselben `hwnd`/`fingerprint` und dem exakten `sse_dialog_answer`-Button `Klicken Sie hier, um Ihre Daten zu exportieren` beantworten. Export- und Ordnerdialog nacheinander, niemals als Kette, bestätigen. |

`sse_collect` ist kein Ersatz für den interaktiven kontrollierten Durchgang:
es blättert segmentweise durch die Erklärung und kann Prüfhinweise oder Sackgassen
finden. Dialog, wirkungsloses Weiter, Zyklus, UIA-Abbau, Seitenlimit oder eine
sichtbare fremde Eingabe liefern `collection-incomplete` mit
`vollstaendig=false`, `stopKind`, `stopReason` und einem fortsetzbaren
Teilstand. Bei einem Prüfhinweis nicht erneut Weiter auslösen: Dialog
fingerprintgebunden beantworten, dann `sse_ui_state` lesen. Bestehende
Teilstandsdateien nicht ersetzen; jedes Segment in eine neue Ergebnisreferenz schreiben;
`dateiHash` danach zurückprüfen. Export- und Erfassungsdateien enthalten echte
Steuerwerte und gehören niemals in dieses Repository. Nie durch Erhöhen des
Limits eine „Vollaufnahme“ erzwingen: lange Monolithläufe können SSE kumulativ
überlasten. Nach jedem Segment Health, Dialoge, Dirty-State und Ergebniswerte
prüfen; zum Fortsetzen eine neue Datei verwenden.

`sse_verify` immer mit `from` **und** dem von `sse_collect` zurückgegebenen
`expectedSourceHash` aufrufen. Ohne `vollstaendig=true` verweigert es ein
Gesamturteil; `allowIncompleteSource=true` bedeutet ausdrücklich nur
Teilstandsprüfung. Exakte Namen haben Vorrang, Teilstrings sind literal und
müssen eindeutig sein. Bei `Seite mehrdeutig` oder `Feld mehrdeutig` zuerst
die gelieferten Kandidaten kontrollieren und nur dann die 1-basierte
`seiteOccurrence`/`labelOccurrence` setzen. `vergleichOk=false` ist ein
erfolgreich ausgeführter Vergleich mit fachlichen Abweichungen — alle
Ergebniszeilen auswerten, nicht als MCP-Ausfall behandeln.

Grund: auf einem versteckten Desktop gibt es weder Eingabewarteschlange noch
physischen Mauszeiger. Die betroffenen Werkzeuge **melden das jetzt als Fehler**
(`kind: "hidden-desktop"`) statt stillschweigend nichts zu tun — bei
`sse_click_point` über eine Gegenprobe der Überschrift.

**Arbeitsteilung, die sich daraus ergibt:** versteckt alles Lesen und Prüfen
sowie diagnostisches ValuePattern; belastbare Feldtransaktionen mit internem
Qt-Rechenmodell, virtualisierte Tabellenzeilen, Löschen und Tastatur sichtbar.

### Sichtbar — normal gestartet

Qt-Tastatur-/Mausaktionen funktionieren nur, wenn das gebundene SSE-HWND
tatsächlich vorne liegt. MCP versucht `SetForegroundWindow` plus gebundene
Input-Queues, glaubt aber keinem API-Erfolg: `WindowFromPoint`, exaktes
Vordergrund-HWND und Feldfokus werden unmittelbar neu geprüft. Bleibt etwa das
Codex-Fenster davor, endet die Aktion rollbackfrei mit `kind="interference"`
und `commit="epoch-obstructed"`; SSE einmal manuell nach vorn holen und den
Zustand neu lesen. **Jeder erfolgreiche Seitenwechsel holt das Fenster nach
vorn.**

## Der Vordergrund: gemessen, nicht vermutet

**Jeder Seitenwechsel holt das Programm nach vorn.** Das macht die
SteuerSparErklärung selbst — sie aktiviert ihr Fenster, sobald der Dialog
wechselt. Kein Aufruf von außen unterdrückt das.

Sauber gemessen an einem einzelnen `Invoke` auf »Weiter«:

```
Vordergrund vorher : 198528    (fremdes Fenster)
Vordergrund nachher: 4525750   (SSE)
```

Die Trennlinie ist deshalb **nicht**, welches Werkzeug man nimmt, sondern
**ob sich die Seite ändert**:

| Vorgang | Fokus |
|---|---|
| Lesen, Bildschirmfoto, `sse_page`, `sse_snapshot`, `sse_find` | bleibt beim Nutzer |
| Feld beschreiben ohne Seitenwechsel | bleibt beim Nutzer |
| **Jeder Seitenwechsel** — Weiter, Zurück, Verlauf, Baumeintrag | **Programm kommt nach vorn** |

**Folge für die Arbeitsweise:** Route vorher planen, auf jeder Seite *alles
in einem Durchgang* lesen, nicht hin- und herwandern. Ein Lauf über 80
Seiten reißt den Nutzer 80-mal aus seiner Arbeit — genau das ist passiert.

Wer wirklich parallel arbeiten will, betreibt das Programm in einer
**eigenen Windows-Sitzung** (zweites Benutzerkonto oder getrennte
RDP-Sitzung). Ein zweiter virtueller Desktop genügt nicht: beim
Selbstaktivieren wechselt Windows dorthin.

### Diese Umwege sind gemessen und gescheitert — nicht erneut versuchen

| Weg | Ergebnis |
|---|---|
| `PostMessage` / `SendMessage` mit Mausnachrichten | Qt ignoriert sie — Haupt- wie Kindfenster, synchron wie asynchron |
| UIA `Invoke` / `Select` / `Expand` auf Baumknoten | melden Erfolg, navigieren nicht |
| `SetFocus()` | stiehlt den Fokus **und** navigiert nicht |
| MSAA pauschal für die Hauptoberfläche | unvollständig; nur als eng begrenzter Fallback für Qt-Modal-Dialoge verwenden |

## Navigation: welches Werkzeug wofür

| Ziel | Werkzeug | Bemerkung |
|---|---|---|
| nächste/vorige Seite | `sse_click name="Weiter" expectedPageBefore="…"` / `"Zurück"` | interner Vor-/Nachseiten-Readback; optional `expectedPageAfter` |
| Sackgassenseite verlassen | Verlaufspfeil nur mit Readback testen | UIA-Invoke kann Erfolg melden, ohne die Seite zu wechseln |
| weiter unten liegenden Baumknoten sichtbar machen | `sse_tree_top`, dann `sse_tree_scroll direction="down"` | rollt nur; aktiviert keinen Knoten |
| Zweig im Navigationsbaum | **`sse_click_point`** | `sse_click` reicht **nicht** |
| Detailseite über »… erfassen/bearbeiten« | `sse_click_point type="Hyperlink"` | nur diese eng benannten, nicht mutierenden Hyperlinks sind physisch freigegeben; danach Seite/Felder rücklesen |
| Schaltfläche auf der Seite | `sse_click` | |
| Steuerberechnung/Druckvorschau schließen | `sse_window_close` | exakte Fenster-ID und exakter Titel sind Pflicht; Hauptfall/Dialoge bleiben gesperrt |
| Ergebnis und Was-wäre-wenn-Werte lesen | `sse_result_details` | Qt-Tabelle; kein OCR nötig; `festgehalten` ist der Vergleichsstand; bei mehreren Fällen `hwnd` Pflicht |
| Kontrollkästchen | `sse_toggle` | `Prüfer`, `Roter Faden` und fachliche CheckBoxen nur mit exakter Seite/Vor-/Nachzustand |
| globaler Fallcheck | `sse_checker_run`, dann `sse_checker_results` | nur auf »Steuererklärung prüfen«; schließt nichts ab |
| Prüfermeldung mit Begründung | `sse_checker_open name="..."` | exakter Meldungstext; Accessibility zuerst, lokale OCR plus Kontrollbild nur als Fallback |
| automatischer Prüfhinweis | `sse_warning_popup_read` | liest »Die Prüfung hat ergeben …«; Antwort erst danach fingerprintgebunden über `sse_dialog_answer` |
| aufgeklappte Prüferkarten schließen | `sse_checker_reset` | gezielt unten nach oben; keine Seriennavigation |
| gesamte Prüfer-Ergebnisleiste schließen | `sse_checker_close` | exakte offizielle Schaltfläche; Seite und Dirty-State müssen invariant bleiben |
| Qt-Textzugänglichkeit diagnostizieren | `sse_accessibility_probe rid="..."` | rein lesend; UIA/RawView, MSAA nur begrenzt |

**Warum `sse_click_point` für den Baum:** Qt verdrahtet dort weder
`InvokePattern` noch `SelectionItemPattern` mit der Aktivierung. Beide
melden `ok`, aber die Seite wechselt nicht. Nur ein echter Mausklick
navigiert. `sse_click_point` nimmt die Koordinaten aus dem Element selbst,
hebt das Fenster kurz nach oben und prüft vor dem Klick, dass dort wirklich
ein Fenster des Programms liegt — sonst bricht es ab.

Nach `sse_click_point` **immer** `sse_read_page` und Überschrift/Felder prüfen.
Bei Detailseiten kann die Überschrift gleich bleiben; dann beweist erst die
geänderte Feldstruktur, dass die Navigation gegriffen hat.

Bei `Weiter`/`Zurück` übernimmt `sse_click` diese Gegenprobe bereits selbst.
`navigation-blocked` mit einem Dialog bedeutet nicht zwingend, dass der Klick
verloren ist: Qt kann den Seitenwechsel hinter dem Prüfhinweis anhalten. Den
Hinweis fingerprintgebunden beantworten, dann `sse_ui_state` neu lesen und
**nicht blind erneut klicken**. Ein bereits offener modaler Dialog blockiert
einen weiteren Navigationsversuch noch vor dem Invoke.

### Seiten ohne Blätterschalter

- `Gewinnermittlung beginnen` — Startseite, Sackgasse: weder `Weiter` noch
  `Zurück`. `Jetzt beginnen` navigiert ebenfalls nicht. Nur per
  `sse_click_point` auf einen Baumeintrag wieder herauskommen.
- `ELSTER-Anmeldeinformation`, `Grunddaten` — Nebenseiten, haben nur
  `Zurück zum letzten Dialog`.

### Suchfunktion

Das Suchfeld hat den stabilen AutomationId-Endpfad
`.MainToolBar.QWidget.SearchSSE.QLineEdit`; Qt kann davor einen internen
Fensterpräfix setzen. MCP akzeptiert als Aufruf ausschließlich diesen
bekannten Endpfad und bindet danach den vollständigen realen UIA-Knoten.

```
sse_goto name="Bewirtung"
```

`sse_goto` kapselt Suchtext, Aktivierung, Trefferprüfung und den linearen
Blätter-Fallback. Für Diagnose darf der Suchtext separat mit `sse_get_value`
und dem auf diesen Endpfad begrenzten `sse_set_value` gesetzt werden; die
frühere öffentliche Roh-Eingabetaste ist nicht mehr verfügbar.

## Die Falle: „Steuer-Spar-Tipps"

Sobald eine Tabellenzelle den Fokus bekommt, öffnet das Programm ein
**nicht-modales** Vorschlagsfenster (~480×330) mit der Aufschrift
*„Steuer-Spar-Tipp zum Einfügen in ein Feld der Tabelle ziehen"*.

Das ist **kein Dialog**. Der Server zielt deshalb immer auf das *größte*
Fenster. Wer stattdessen das kleinste nimmt, liest leere Seiten. Für echte
Dialoge (Rückfragen beim Start) `dialog=true` setzen — beim Start existiert
das Hauptfenster noch nicht, dann ist der Dialog ohnehin das größte.

## Programm starten und Fälle öffnen

```
sse_product_info                    # zuerst Produkt-/Jahresgrenze prüfen
sse_list_cases                      # ohne das Programm zu öffnen
sse_launch mode="einur" file="G:/.../freiberufler.Gew2025"
```

`sse_launch` und `sse_desktop_start` prüfen Produkt, Modus und Falldatei vor
dem Erzeugen eines Prozesses bzw. Desktop-Objekts. Erzeugt ein sichtbarer Start
kein verifiziertes Fenster, wird genau die neu gestartete PID wieder beendet;
ein späterer Aufruf darf keinen verwaisten Prozess übernehmen.
Liefert `sse_launch.instance` ein `hwnd`, dieses sofort für alle Folgeaktionen
weiterreichen. Das bindet den gerade gestarteten Fall auch dann stabil, wenn
SSE kurz danach ein zweites Haupt-/Hilfsfenster erzeugt. Fehlt `instance`, erst
Startdialoge lesen und danach mit `sse_ui_state` eindeutig synchronisieren.
Dasselbe gilt für `sse_desktop_start.instance`; bei `ready=false` und
`blockedByDialog=true` zuerst den Startdialog auf dem markierten Desktop lesen
und beantworten. Beide Startwege warten bei einer Falldatei auf den konkret
betitelten geladenen Fall statt ein kurzlebiges generisches Startfenster als
fertige Instanz auszugeben.

Startmodi (aus dem Programmcode gelesen):

| Modus | Modul |
|---|---|
| `einur` | Gewinnermittlung / EÜR |
| `normal` | Einkommensteuererklärung |
| `einurvor` | Gewinn-Erfassung Folgejahr |
| `fest` | Feststellungserklärung |
| `ermaess` | Lohnsteuer-Ermäßigung |
| `KonsUst` | Konsolidierte Umsatzsteuer |
| `vorweg` | Prognose / Vorweg-Erfassung |

**Nach dem Start** kann die Rückfrage *„Es wurde eine Wiederherstellungsdatei
gefunden"* erscheinen. Mit `sse_dialog_list` lesen und ausschließlich mit
dem dort gelieferten `hwnd` plus `fingerprint` über `sse_dialog_answer`
beantworten. Empfehlung: **Ja** — annehmen
ist umkehrbar (ohne Speichern schließen), ablehnen verwirft die Datei
endgültig. Achtung: nach dem Wiederherstellen hängt der Fall **nicht mehr am
Dateipfad**; der Titel zeigt `(Wiederhergestellt)`. Zurückschreiben nur mit
ausdrücklicher Zustimmung des Nutzers.

Öffnet eine SSE-Schaltfläche einen nativen Windows-Dateidialog, diesen nicht
mit allgemeinen Tastendrücken oder mehrdeutigen Listenklicks bedienen.
`sse_file_dialog_select` verlangt exakten Dialogtitel und Dateipfad, prüft
optional den SHA256 und bestätigt danach, dass genau dieser Dialog
geschlossen wurde. Anschließend den übernommenen Pfad auf der SSE-Seite
noch einmal zurücklesen.

## Daten ändern

**Immer zuerst sichern:**

```
sse_case_hash path=".../arbeitskopie.Gew2025"
sse_backup_cases
```

- Beträge im deutschen Format, Komma als Dezimaltrennzeichen.
- **Graue Felder sind berechnet** und schreibgeschützt. Ein `readonly`-Fehler
  dort ist richtig, kein Grund für Umwege.
- Fachliche Einzelfelder nur über `sse_change_known_field` beziehungsweise
  `sse_change_field`, Tabellen über `sse_table_add`/`sse_table_update` und
  Auswahllisten über `sse_combo_select` ändern. Diese Wege binden Seite,
  Vor-/Nachwert und Readback; Tabellen zusätzlich ihre Summenregion.
- Bei mehreren offenen SSE-2025-Fällen ist `hwnd` für **jede** schreibende
  Aktion Pflicht. Eine bytegleiche Arbeitskopie ist allein über Seite, Feldwert
  oder Summe nicht vom Original zu unterscheiden; ohne eindeutige
  Hauptfensterbindung brechen die Werkzeuge fail-closed ab.
- Dasselbe gilt für konsistente Lese-, Prüfer-, Scroll- und
  Navigationsaktionen: Ohne `hwnd` werden mehrere Hauptfenster niemals nach
  Größe geraten oder zu einem Mischzustand zusammengeführt. `sse_windows`
  beziehungsweise `sse_ui_state` mit eindeutigem Fenster zuerst verwenden.
- Generische `sse_click`-/`sse_menu_click`-Wege mit Löschen, Import,
  Datenübernahme, Ersetzen, Verwerfen oder Zurücksetzen sind ohne
  `acknowledgeDestructive=true` gesperrt. Vorher den exakten Knoten bzw.
  Menüeintrag lesen; danach `ungespeichertVorher` und
  `ungespeichertNachher` auswerten. Eine Versandaktion wird dadurch nie
  freigeschaltet.
- Unbeschriftete Felder lassen sich per `sse_get_value` über `aid` oder `rid`
  eindeutig lesen — vorher bei Bedarf `sse_snapshot types=['Edit']`.
- Geschrieben wird nur in den Arbeitsspeicher. Dauerhaft ausschließlich mit
  `sse_save expectedPath="..." expectedHashBefore="..."`. Bei mehreren
  offenen Fällen zusätzlich das zuvor gelesene exakte `hwnd` übergeben. Das Werkzeug
  bindet Fenster/Prozess an den erwarteten Fall und prüft danach Hashwechsel,
  Änderungszeit, deaktiviertes „Sichern", unveränderte Kopfdaten und offene
  Dialoge. Ist noch die nicht-modale Suchansicht offen, schließt `sse_save`
  sie gezielt im bereits pfadgebundenen Fall, weil Qt dort die normale
  Hauptsymbolleiste samt „Sichern" ausblendet.
- `sse_set_value` ist aus Kompatibilitätsgründen nur noch für die exakte
  AutomationId des **steuerneutralen globalen Suchfelds** vorhanden. Exakter
  `expectedBefore`-/`expectedAfter`-Readback und Interference-Guard sind
  Pflicht; jeder Versuch auf Steuer-, Formular- oder Tabellenfelder wird
  bereits vor dem Schreiben blockiert.
- Für fachliche Änderungen `sse_page_state` und danach
  `sse_change_known_field` bevorzugen. Die kurzlebige `epoch` bindet Seite,
  Feldwerte, Dirty-State und Feldposition. Vor der Tastatureingabe werden
  exaktes SSE-HWND/PID, Vordergrund, Ziel-Fokus und Vorwert erneut geprüft;
  danach folgen Feld-Readback und optional der vollständige Werte-Info-Diff.
  Zwischen den eigenen Eingabeschritten bindet `GetLastInputInfo` den letzten
  Eingabe-Tick; zusätzlich wird die logisch blockierende SSE-Fensterlage
  gehasht. Fremde Eingabe oder ein neuer Dialog ergibt `kind="interference"`:
  sichtbaren Feldwert bestmöglich lesen, aber weder blind zurückrollen noch
  speichern, sondern zuerst mit `sse_ui_state` neu synchronisieren.
  Page-Objects enthalten nur öffentliche UI-Metadaten, niemals Fallwerte oder
  Pfade. Ein Katalog-Miss ist ein Anlass zur manuellen UI-Prüfung, kein Grund
  für blindes Schreiben.
- Ist nachweislich `LockApp` der Vordergrund, dürfen ausschließlich reine,
  summen- und readbackgebundene UIA-`ValuePattern`-Transaktionen von
  `sse_table_add`/`sse_table_update` den dadurch verursachten globalen
  Input-Tick isolieren (`lockScreenIsolation=true`). Verschwindet der
  Sperrbildschirm währenddessen, folgt ein Interference-Stopp. Physische
  Klicks, Tastaturpfade und `sse_table_delete` bleiben gesperrt.
- Häkchen in Tabellenspalten sind **keine CheckBox-Elemente**, sondern
  Zellen. Der öffentliche physische Klick darf sie nicht mehr ungebunden
  setzen. Ohne spezialisiertes Werkzeug mit exakter Seite, Zeile, Spalte und
  Summen-/Readback-Vertrag bleiben solche Zellen unverändert bzw. werden
  manuell mit dem Nutzer geklärt.
- Echte CheckBox- und RadioButton-Zustände liest `sse_page` als booleschen
  `wert`. Echte Checkboxen ausschließlich mit `sse_toggle`, exakter
  `expectedPage` sowie `expectedBefore`/`value`/`expectedAfter` setzen. Das
  generische `sse_click pattern="toggle"` ist gesperrt. RadioButtons dürfen
  mit `sse_click pattern="select"` nur über die exakte `aid` gesetzt werden.
  Das Werkzeug bindet die ganze Gruppe, aktiviert auf dem sichtbaren Desktop
  den PID-/Root-verifizierten Mittelpunkt (Qt kann reine UIA-Auswahl ohne
  Fachereignis anzeigen), verlangt vorher und nachher genau eine ausgewählte
  Option und rollt nur einen eindeutig eigenen Fehler ohne
  erkannte Benutzer-/Fenster-/Seiteninterferenz zurück. Nie allein aus einem
  Namen wie Ja/Nein auf die Zieloption schließen.
- Dropdowns zuerst read-only mit `sse_combo_options` erfassen. Eine Auswahl
  ausschließlich mit `sse_combo_select`, exakter `expectedPage`, exaktem
  Optionsnamen sowie `expectedCurrent`/`expectedAfter`; das Werkzeug bindet
  genau eine ComboBox, liest den neuen Wert zurück und rollt einen eindeutig
  eigenen Nachbedingungsfehler per `SelectionItemPattern` zurück. Nach fremder
  Eingabe, Fenster-, Seiten- oder Binding-Wechsel wird bewusst nicht blind
  zurückgesetzt. Fehlt der ComboBox eine AutomationId, bricht es absichtlich
  ab, weil die geöffnete Optionsliste sonst nicht sicher zugeordnet werden kann.

Tabellen legen automatisch eine neue Zeile an, sobald die letzte gefüllt ist.
`sse_table_add` beschreibt eine sichtbare Leerzeile per ValuePattern und liest
jede Zelle zurück. `sumLabel` bindet dabei nicht nur die Nachbedingung, sondern
auch die Zielregion: beschrieben wird ausschließlich die letzte freie Zeile
zwischen dieser Summenzeile und der vorhergehenden Summenzeile. Das ist auf
Seiten mit mehreren Tabellen zwingend; nie eine global gefundene Leerzeile
verwenden. Eine virtualisierte Leerzeile am Tabellenende kann es nur
im sichtbaren Modus per Tastatur materialisieren. `sse_table_update` ändert eine
eindeutig identifizierte sichtbare Zeile auch versteckt, verlangt exakte Seite,
Summenregion und Vor-/Nachsumme und setzt eigene normale Abweichungen
transaktional zurück. Für echte boolesche Tabellenzellen setzt ein `werte`-
Eintrag `"true"` oder `"false"` das UIA-TogglePattern; alle anderen Werte laufen
über ValuePattern. Toggle-Ausgangs- und Endzustand werden ebenso rückgelesen und
gemeinsam mit Wertzellen zurückgerollt. Nach fremdem Zellwert, Eingabe, Fenster- oder
Seitenwechsel stoppt es ohne blinden Rollback. **Zeilen niemals per roher
Tastenkombination Strg+Umschalt+Entf löschen**: dieser Weg ist gesperrt, weil Qt bei alter
Mehrfachauswahl mehrere Zeilen löscht. Ausschließlich `sse_table_delete` mit
`expectedPage`, eindeutigem Zelltext sowie `sumLabel`, `expectedBefore` und
`expectedAfter` verwenden. Zielsuche und Navigation bleiben auf die zu dieser
Summenzeile gehörende Tabellenregion begrenzt. Bei abweichender Nachsumme führt
das Werkzeug nur ohne fremde Eingabe/Fensteränderung Strg+Z aus und verifiziert
die Wiederherstellung; nach Interferenz niemals selbst Undo oder Speichern
auslösen, sondern mit `sse_ui_state` neu synchronisieren. Liegt am frischen
Zellmittelpunkt nicht exakt das gebundene Hauptfenster, bricht das Werkzeug vor
Auswahl und Tastenkombination ab. `obstruction.blockerKind` unterscheidet
`lockscreen-shell`, `foreign-app` und `other-sse-window`. Auch ein suspendiertes,
optisch unsichtbares Windows-`LockApp` bleibt dabei fail-closed: UIA kann zwar
die Auswahl, aber nicht den Qt-`currentIndex` und damit nicht sicher das Ziel
von `SendKeys` beweisen. SSE sichtbar aktivieren und neu versuchen; den
PID-/Root-Vertrag niemals umgehen.

## Seitenlandkarte (Modul Gewinnermittlung 2025)

Der Blätterpfad `Weiter` läuft in dieser Reihenfolge, 78 Seiten:

```
Voreinstellungen und ELSTER-Anmeldeinformation
  ELSTER-Anmeldeinformation · Beginn der Datenbearbeitung
  Detailerfassung/Summenerfassung
Allgemeine Angaben zum Unternehmen
Fahrzeuge (n)
Einnahmen/Ausgaben
  Umsatzsteuerzahlungen/-Erstattungen
  Übersicht Betriebseinnahmen
    Erlöse Lieferungen/Leistungen → Einnahmen: Freiberufler   ← Umsatz
    Erlöse aus Anlagenverkäufen
    Kapitalerträge und sonstige Einnahmen
    Private Nutzungen: Sonstiges
    Unberechtigt ausgewiesene Umsatzsteuer
  Betriebsausgaben
    Material-/Wareneinkauf · Fremdleistungen · Personalkosten
    Abschreibung · Investitionsabzugsbeträge
    Raum- und Grundstückskosten/Homeoffice · Arbeitszimmer
    Schuldzinsen · Beiträge/Gebühren/Abgaben · Versicherungen
    Reisekosten (je Reise: Verkehrsmittel, Verpflegung, Übernachtung)
    Geschenke bis 50 € · Bewirtungskosten
    Wege zum Betrieb (Entfernungspauschale)
    Portokosten · Telefon/Mobilfunk/Internet · Bürobedarf
    Fachliteratur · Fortbildungskosten · Rechts- und Beratungskosten
    Miete/Leasing · Werbung und Reklame
    Sonstige Betriebsausgaben · Werkzeuge und Kleingeräte · EDV-Kosten
    Vorsteuer (Übersicht) · Sonstige Vorsteuerbeträge
  Journal und BWA
  Zusatzangaben zur Anlage EÜR → Entnahmen/Einlagen
Umsatzsteuererklärung 2025
  Lieferungen/Leistungen zu 19% / 7% · Unentgeltliche Wertabgaben
  Warenbezug aus dem EU-Ausland · Steuerschuldner § 13b UStG
  Abziehbare Vorsteuer · Vorsteuerberichtigungen
  Steuerfreie Umsätze · Meldepflichtige Umsätze
Umsatzsteuer-Voranmeldungen 2025            (je Quartal)
Anmeldungen versenden            ← GESPERRT
Jahreserklärungen abschließen    ← GESPERRT
Belege nachreichen               ← GESPERRT
Kommunikation mit dem Finanzamt per ELSTER  ← GESPERRT
Meine Steuerdokumente
```

Mehrfach auftauchende Überschriften (`Innergem. Erwerb, § 13b UStG und
Einfuhr`, `Erlöse Lieferungen/Leistungen`) gehören zu verschiedenen
Ausgabenkategorien — allein an der Überschrift sind sie nicht
unterscheidbar. Reihenfolge im Durchlauf mitführen.

## Ein Durchlauf, der funktioniert

```
sse_health                                   → canaryMs prüfen
sse_click_point name="Einnahmen/Ausgaben" type="TreeItem"
sse_read_page                                → Überschrift bestätigen
  Schleife:
    sse_read_page                            → Zeilen sichern
    sse_read_table                           → falls Tabelle vorhanden
    sse_click name="Weiter"
    alle ~15 Seiten: sse_health
```

Faustregeln:

- **Eine Seite je Schritt.** Nicht zwanzig Seiten in einer Schleife ohne
  Zwischenprüfung — genau so wurde das Programm bei der Entwicklung lahmgelegt.
- `sse_screenshot` ist das verlässlichste Werkzeug überhaupt und funktioniert
  auch im Hintergrund. Bei jedem Zweifel: hinsehen.
- Bei Widersprüchen zwischen zwei Lesungen: `sse_health`, dann erneut lesen.

## Globalen Steuerprüfer sicher nutzen

Die rechte Eingabehilfe und `sse_check_page` prüfen die **aktuelle Seite**.
Der fallweite Lauf ist getrennt:

1. per MCP zu `Prüfen und Abgeben` und `Steuererklärung prüfen` navigieren;
2. `sse_checker_run` ausführen;
3. `sse_checker_results` aufrufen. Nur bei `konsistent=true` sind beide
   angekündigten Gruppenzahlen technisch vollständig gelesen;
4. bei `konsistent=false` **keine** automatische Pfeil-/Klickserie starten:
   mit `sse_screenshot` die linke Prüferliste manuell kontrollieren;
5. `sse_checker_open` bei konsistentem Baum verwenden. Bei
   `konsistent=false` darf es nur eine **exakt benannte und im sicheren
   Snapshot sichtbare** Meldung öffnen; keine Suche per Pfeiltasten. Den
   gemeldeten Leseweg prüfen und OCR-Text am Kontrollbild kontrollieren;
6. nach Korrekturen den globalen Lauf wiederholen.

Qt liefert am letzten Warnungsknoten gelegentlich denselben `GetNextSibling`
endlos zurück, obwohl die Tipps sichtbar darunter stehen. MCP bricht diesen
Zyklus fail-closed ab und meldet `konsistent=false`; es klickt oder blättert
nicht mehr serienweise durch dieselben Karten. Das komfortable Verbreitern der
Prüferspalte, sichere scrollende Zusammenführen aller Tipps sowie gezieltes
Öffnen/Schließen/Abhaken bleibt teilweise dokumentierter Backlog. Mehrere
Karten können gleichzeitig offen bleiben; das automatische Zuklappen einer
älteren Karte ist nicht zuverlässig, weil Qt dabei auch jüngere Karten
schließen kann. Ein Hinweistext mit dem
Wort »ELSTER« darf nur über `sse_checker_open` als exakt verifizierter
Prüfer-`TreeItem` gelesen werden; Versandknöpfe und Abgabewege bleiben
weiterhin gesperrt.

»Fragen oder Warnungen« sind nicht automatisch Fehler, »Tipps oder
Zusatzinformationen« erst recht nicht. Sie werden fachlich bewertet. Der
Schalter `Steuererklärung abschließen` bleibt ebenso wie ELSTER gesperrt.

### Automatisches Fenster »Die Prüfung hat ergeben …«

Dieses kompakte Qt-Fenster ist vom fallweiten Steuerprüfer zu unterscheiden.
`sse_warning_popup_read` liest Meldungstitel und die Aktionen »Als gelesen
markieren«/»Jetzt ignorieren« strukturiert. Der erklärende Fließtext wird von
Qt weder über UIA, RawView noch begrenztes MSAA exponiert; nur dafür verwendet
das Werkzeug lokale Windows-OCR und kann auf Wunsch ein Kontrollbild
mitsenden. Das Bild wird im Worker direkt als MCP-Inhalt kodiert und die lokale
Temporärdatei noch vor der Antwort gelöscht und die Löschung nachgeprüft. Ein
Kill-on-close-Windows-Job bindet Worker und OCR-Kind, damit auch ein harter
Timeout keinen OCR-Prozess verwaist. Mit `ocr=false` lassen sich für
schnelle Zustandskontrollen nur Titel und Aktionen lesen. Ist das Fenster aktiv,
aber UIA oder der angeforderte Fließtext unlesbar, meldet das Werkzeug einen
Fehler statt eines leeren Erfolgs. Erst fachlich bewerten, dann den gelieferten
`hwnd`, `fingerprint` und `bodyFingerprint` mit `sse_dialog_answer` verwenden.
Der Fließtext wird unmittelbar vor dem Klick erneut per OCR gehasht. Die
Antwort meldet zusätzlich den Dirty-State des Hauptfalls vorher und nachher. Im realen Test
schloss »Jetzt ignorieren« das Fenster per InvokePattern, ohne den Hash der
Arbeitskopie zu ändern.

## Falldateien ohne das Programm

`sse_list_cases` liest den Klartext-Kopf der `.Gew2025`/`.ESt2025`-Dateien:
Modul, Jahr, Steuernummer, Erstellungsdatum, Übernahmehistorie — und
`elsterTransferTime`.

**Daran erkennt man, ob eine Erklärung schon übermittelt wurde**, ohne
irgendetwas zu öffnen. Das Feld `transmitted` ist **dreiwertig**:

| Wert | Bedeutung |
|---|---|
| `true` | übermittelt, `elsterTransferTime` nennt den Zeitpunkt |
| `false` | Kopf sauber gelesen, Feld nachweislich leer |
| `"unknown"` | Kopf nicht lesbar — **keine Aussage**, nicht als „nicht übermittelt" behandeln |

Der dritte Wert ist wichtig: ein Parserfehler wurde früher zu `false`, und
damit hätte das Werkzeug für eine *bereits abgegebene* Erklärung behauptet,
sie sei noch offen. `transmittedReason` nennt jeweils den Grund.

Die Steuerdaten selbst liegen hinter dem Marker `svCrypted` verschlüsselt
(Entropie 8,00/8,0) und sind nur über die Oberfläche lesbar.

`sse_case_hash` liest zusätzlich SHA256, Größe, Änderungszeit und zentrale
Kopfdaten einer einzelnen Datei read-only. Eine neue Arbeitskopie mit
`sse_make_working_copy` und dem gerade gelesenen Quell-Hash erstellen: das
Ziel muss neu sein, Quelle und Ziel werden bytegleich per Hash geprüft.
`sse_save_as` ist dagegen für einen bereits im Arbeitsspeicher veränderten
Fall vorgesehen und bedient den echten Windows-Dateidialog mit Pfad-Readback.

Alte Test- und Zwischenfälle ausschließlich mit `sse_archive_cases` aus dem
aktiven Ordner entfernen. Das Werkzeug verlangt SHA256 für jede archivierte
und jede verbleibende Datei, sperrt übermittelte Fälle, prüft den vollständigen
Vorher-/Nachher-Bestand und rollt bei Abweichungen zurück. Es löscht nicht
irreversibel; der neue Archivordner bleibt als Wiederherstellungspunkt erhalten.

## Wenn etwas klemmt

| Beobachtung | Ursache | Abhilfe |
|---|---|---|
| alles „nicht gefunden" | UIA überlastet oder modaler Dialog | `sse_health`, dann zuerst `sse_dialog_list` |
| Seite leer / ohne Überschrift | Vorschlagsfenster im Weg | größtes Fenster nehmen (Vorgabe) |
| Klick ok, Seite wechselt nicht | Baumeintrag per UIA geklickt | `sse_click_point` |
| „Nicht unterstütztes Muster" | Hyperlink statt Button getroffen | `type="Button"` angeben |
| `obstructed` bei click_point | fremdes Fenster darüber | Programm sichtbar machen |
| Fenster reagiert nicht | Dialog oder echter Hänger | Dialog zuerst lesen; harter Abbruch nur PID-gebunden mit `discardChanges=true`; `force=true` plus `save=true` ist gesperrt |
