# Geöffneten Steuerfall in einer Arbeitssitzung behandeln

Lies diese Referenz vor jeder UI-Navigation oder Änderung an einem Steuerfall.
Sie bildet den normalen Nutzerfall ab: Der Mensch hat seinen einen Steuerfall
bereits geöffnet und arbeitet gemeinsam mit dem Agenten daran.

## Der offene Fall ist maßgeblich

1. Lies `sse_instances` und den frischen UI-Zustand. Ist genau ein eindeutig
   gebundener Steuerfall offen, ist er der Arbeitsfall. Suche, erzeuge oder
   öffne keine Arbeits-, Prüf- oder Korrekturkopie und starte keinen anderen
   Fall.
2. Sind mehrere Fälle offen, rate nicht anhand von Fenstertitel, Änderungszeit
   oder Dateiname. Lass den Menschen den Arbeitsfall bestimmen und binde danach
   jedes fallbezogene Werkzeug an dessen `hwnd`.
3. Nennt der Mensch ausdrücklich einen anderen Fall als den geöffneten, lies
   zuerst den Dirty-/Dialogzustand des offenen Falls. Bei ungespeicherten
   Änderungen oder unbekanntem Zustand frage, ob er gespeichert, verworfen oder
   offen gelassen werden soll. Die Bitte, den anderen Fall zu bearbeiten, ist
   keine Erlaubnis für eine dieser drei Entscheidungen.
4. Im bereits offenen Arbeitsfall sind vorhandene ungespeicherte Eingaben kein
   Grund, ihn zu ersetzen. Ändere nur den beauftragten Wert, speichere und
   schließe nicht und behaupte nicht, die Sicherung enthalte ältere
   In-Memory-Eingaben.
5. Ein ausdrücklich isolierter Prüflauf ist die Ausnahme: Vor dem Erzeugen oder
   Starten seiner Prüffallkopie muss `sse_instances` leer sein. Ist ein Fall
   offen, frage, ob stattdessen in-place gelesen oder der offene Fall zuerst
   geschlossen werden soll. Der isolierte Prüfauftrag erlaubt weder das
   Schließen noch das Öffnen einer zweiten SSE-Instanz.

## Eine Sicherung je unverändertem Dateistand

Vor der ersten UI-Navigation, die SSE als ungespeichert markieren kann, oder
vor der ersten fachlichen Mutation in der laufenden Aufgabe:

Behandle lineare Navigation vorsorglich immer als dirty-fähig. Dazu zählen
insbesondere `sse_collect`, `sse_goto`, `sse_subpages` und ein
`sse_click_point` auf Navigationsknoten sowie das Öffnen/Ausführen des
Programm-Prüfers. Status- und Identitätsleser wie `sse_instances`,
`sse_case_hash`, `sse_list_cases` und `sse_capabilities` benötigen für sich
allein noch keine Sicherung.

1. Ermittle die exakte `caseRef`, `hwnd` und den aktuellen Disk-SHA-256 mit
   `sse_case_hash`.
2. Merke für die laufende Aufgabe das Tupel `caseRef`, `sourceHash`,
   `backupRef`, `verified=true`.
3. Fehlt dieses Tupel, erstelle mit `sse_make_working_copy` eine neue
   bytegleiche Sicherung im privaten Bereich `backups:` und prüfe
   `sourceHash == targetHash` sowie `verified=true`. Öffne diese Sicherung nie.
4. Existiert in derselben Aufgabe bereits ein erfolgreich geprüftes Tupel für
   exakt dieselbe `caseRef` und denselben aktuellen Disk-Hash, verwende es
   weiter. Erzeuge weder pro MCP/API-Aufruf noch pro Feld, Tabellenzeile,
   Beleg oder Teilschritt eine neue Falldateisicherung.
   Nach Verlust dieses verifizierten Aufgabenkontexts genügt ein gleicher Hash
   in einer Dateiliste nicht als Herkunftsnachweis; beginne eine neue Aufgabe
   mit einer neuen Sicherung, statt irgendeine alte Datei still zu übernehmen.
5. Nach einem ausdrücklich beauftragten und erfolgreich verifizierten
   `sse_save` ist der Disk-Hash ein neuer Zustand. Verwirf das gemerkte Tupel;
   vor einer späteren Mutation entsteht eine neue Sicherung. Ohne Speichern
   und bei unverändertem Disk-Hash bleibt die bisherige Sicherung gültig, auch
   bei einer direkten Folgefrage des Menschen.
6. Ändert sich der Disk-Hash außerhalb des eigenen bestätigten Speicherns,
   stoppe und kläre die Fallbindung neu. Verwende die alte Sicherung nicht als
   Schutz des neuen Zustands.

Der Backupbereich ist privater Runtime-/Temp-Speicher außerhalb von Fallordner
und Git. Der aktuelle Release besitzt keine automatische Backup-Bereinigung;
führe deshalb keine Löschung ein oder aus. Falls später eine ausdrücklich
freigegebene Retention existiert, muss sie mindestens die neuesten zehn
Sicherungen behalten und darf nur darüber hinausgehende Sicherungen löschen,
die älter als sieben Tage sind.

Der BelegManager persistiert getrennt. Für ihn gilt zusätzlich
[belegmanager-backup.md](belegmanager-backup.md); auch dort reicht in einem
zusammenhängenden Auftrag eine Sicherung des unveränderten Ausgangsstands.

## Ändern ist nicht Speichern

- „Ändere“, „trage ein“, „korrigiere“ oder eine bestätigte Batch-Aufgabe erlaubt
  die In-Memory-Änderung und den Readback, aber weder `sse_save` noch
  `sse_save_as`.
- Nur ein ausdrücklicher Auftrag wie „ändere und speichere“ oder „speichere
  jetzt“ erlaubt `sse_save` für den exakt gebundenen Fall. Lies Hash, Wert,
  Summen und Dirty-State davor und danach zurück.
- `sse_save_as` und ein `cases:`-Ziel von `sse_make_working_copy` sind nur
  erlaubt, wenn der Mensch ausdrücklich eine neue Datei, Arbeitskopie,
  Prüfkopie, Korrektur oder Berichtigung verlangt. Eine Bitte um Sicherheit,
  Backup oder Korrektur eines Wertes ist keine solche Freigabe.
- Ist ein Fall bereits übermittelt oder serverseitig nicht sicher in-place
  speicherbar, speichere nicht und erzeuge nicht automatisch eine
  Korrekturkopie. Erkläre den Stopp und frage, ob der Mensch ausdrücklich eine
  separat benannte Korrektur-/Berichtigungsdatei anlegen lassen will.
- Beende eine normale Änderung mit Readback und lass den Arbeitsfall offen.
  Sage knapp, ob die Änderung nur im geöffneten Programm steht oder auf
  ausdrücklichen Wunsch gespeichert wurde. Erzeuge keinen separaten
  Ergebnisbericht, außer ein bestätigter Plan umfasst ihn ausdrücklich oder der
  Mensch verlangt eine Datei.

Eine explizit beauftragte isolierte Prüfung darf weiterhin eine neue
Prüffallkopie verwenden. Diese Ausnahme muss im bestätigten Auftrag oder im
zuvor gezeigten Plan stehen; sie ist nie der stillschweigende Standard für den
bereits geöffneten persönlichen Steuerfall.
