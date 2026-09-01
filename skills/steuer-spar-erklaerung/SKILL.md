---
name: steuer-spar-erklaerung
description: Prüft oder bearbeitet einen konkret geöffneten Steuerfall in einer vom lokalen Release unterstützten SteuerSparErklärung unter Windows, gleicht ihn mit Belegen ab oder richtet bei Bedarf die lokale Automation über npm ein. Verwenden bei „meine Steuererklärung prüfen“, SteuerSparErklärung/SSE bedienen, Belege abgleichen sowie API- oder MCP-Einrichtung; nicht für allgemeine Steuerfragen ohne lokalen SSE-Fall und niemals für ELSTER-Versand.
---

# SteuerSparErklärung sicher prüfen

Führe technisch unerfahrene Nutzer standardmäßig auf Deutsch und arbeite read-only,
bis eine konkrete Änderung freigegeben wurde. Ein bereits eindeutig geöffneter Fall ist der Arbeitsfall; öffne nicht still eine andere Datei.

## Nutzerziel zuerst erkennen

Ordne den Auftrag ohne technische Rückfrage einem sicheren Modus zu:

- „prüfen“, „Schnellcheck“ oder „Fehler finden“: ausschließlich read-only;
- „mit Belegen abgleichen“: read-only in Fall und freigegebenen Quellen;
- „korrigieren“ oder „ändern“: den eindeutig geöffneten Fall nach einmaliger
  Sicherung des aktuellen Dateistands ändern und sofort zurücklesen, aber nur
  auf ausdrücklichen Auftrag speichern;
- „UStVA“, „Umsatzsteuer-Voranmeldung“, Monat oder Quartal vorbereiten:
  UStVA-Modus; Zieljahr, gesetzliche Frequenz und vorhandene Übermittlung
  zuerst prüfen, nur bei ausdrücklichem Auftrag ändern;
- „einrichten“ oder „Verbindung reparieren“: Einrichtungsmodus, noch keine
  Steuerdaten lesen.

Bestätige den erkannten Modus in einem kurzen deutschen Satz. Erkläre API, MCP,
Hashes oder Dateiformate nur, wenn der Nutzer danach fragt oder eine konkrete
Entscheidung davon abhängt.

## Harte Grenzen

Diese Regeln gelten auch auf ausdrücklichen Wunsch:

- Sende, übermittle, bestätige oder schließe niemals über ELSTER ab. Bereite
  keinen Versandklick und keinen Umgehungsweg vor.
- Lösche oder überschreibe Originalfälle und übermittelte Falldateien nie auf
  Dateiebene, benenne sie nie um. Verschiebe Fälle im normalen Prüf- und
  Bearbeitungsablauf nicht. Die einzige enge Ausnahme ist ein ausdrücklich
  beauftragter Archivlauf für nachweislich nicht übermittelte Fälle über
  `sse_archive_cases`: vollständiges Inventar, Hashbindung und ausschließlich
  ein neues Ziel im konfigurierten Backupbereich sind Pflicht. Lies das
  Inventar mit `sse_list_cases` und `includeBackups: true`. Das Programm legt
  beim Speichern eine eigene `<Fallname>_Backup`-Datei daneben, und der
  Bestandsabgleich zählt sie mit; ein unvollständiger Restbestand wird mit
  `inventory-mismatch` gestoppt, ohne etwas zu verschieben.
  Bei `rolledBack: false`, `retainedTargets` oder `recoveryFiles` stoppe den
  Ablauf und lege dem Menschen genau diese strukturierten Pfade zur Klärung
  vor; starte keine zweite Archivierung und verschiebe Recovery-Dateien nicht
  automatisch.
- Behandle den geöffneten Fall, die einmalige Sicherung je Disk-Hash,
  Dateiwechsel und die strikte Trennung zwischen Ändern und Speichern nach
  [references/case-session.md](references/case-session.md). Eine Arbeits- oder
  Korrekturkopie ist kein Standard und braucht einen ausdrücklichen Auftrag.
  Sichere vor der ersten schreibenden BelegManager-Phase dessen getrennte
  Datenablage nach [references/belegmanager-backup.md](references/belegmanager-backup.md); Eine Falldatei-Sicherung ersetzt diese Sicherung nicht.
  Aktuell ist nur `sse_receipt_manager_list` freigegeben; umgehe die neun
  fail-closed gesperrten Vordergrundwerkzeuge nie per Maus, Tastatur, direktem Worker oder Retry.
- Arbeite nie mit einem wiederhergestellten Fall weiter. Hat SteuerSparErklärung
  nach einem unsauberen Ende eine Wiederherstellungsdatei geladen, stoppt
  `launch` mit `kind="recovered-state"`. Der geöffnete Inhalt entspricht dann
  nicht mehr der Datei, deren Hash du verifiziert hast, und jeder Report daraus
  wäre fachlich falsch. Schließe den Fall ohne Speichern, lass den Nutzer die
  Wiederherstellung im Programm verwerfen und öffne danach erneut.
- Nutze einen bereits geöffneten Fall auch für UI-gebundene Leseaufträge, ohne
  ihn anschließend zu speichern oder zu schließen. Für einen ausdrücklich
  isolierten Audit darf der bestätigte Plan stattdessen eine hashverifizierte
  Prüffallkopie vorsehen; Details stehen in references/case-session.md.
- Umgehe API-Sperren nie mit Roh-Tastatur, freien Koordinaten oder
  ungebundenen generischen Klicks.
- Installiere nichts still. Ändere weder Autostart noch Agenten-Konfiguration,
  Connector-Zugriff oder Belegablage ohne die jeweils nötige Zustimmung.
- Erfinde keine Releasequelle, Pfade, Befehle, API-Felder, MCP-Konfigurationen
  oder Szenarioschemata. Lies sie aus dem installierten Release.
- Behaupte Erfolg nur nach Readback. Ein Exitcode oder sichtbarer Klick reicht
  nicht als Nachweis.

Unterstütze ausschließlich Windows x64 mit Windows PowerShell 5.1 und ein im
installierten Release als `supported` ausgewiesenes Produktprofil. Derzeit ist
das Profil `2025` mit Engine-Major `31` freigegeben. Automatisiere keine andere
Version ersatzweise. Akzeptiere nur `status=supported` zusammen mit
`operationAccess=full`. Meldet `product_info.buildDrift.drifted=true`, stoppe
vor jeder Mutation, bis der installierte Build gezielt verifiziert wurde; API
und direkter Worker erzwingen diese Mutationssperre zusätzlich.
Bei `health.running=false` und leerem `buildDrift.current` bedeutet
`drifted=true` nur: aktuell ist kein laufender Build messbar. Behaupte daraus
keine installierte Versionsabweichung. Nach einem erlaubten Launch muss
`product_info` den laufenden Build erneut bestimmen; erst dessen nichtleerer
`current`-Wert ist ein echter Gleich-/Driftnachweis.

## Zuerst im MCP-Modus: MCP-Preflight

Beginne jeden Auftrag im MCP-Modus mit `sse_preflight`. Er bündelt
Arbeitsbereich, Produktprofil und Laufzeit PC-blind und entscheidet den
weiteren Weg ohne technische Rückfrage:

1. **`ok=true` und `ready=true`** — arbeite normal weiter und binde mit
   `sse_instances` den eindeutig geöffneten Fall.
2. **`ok=true`, aber Blocker vorhanden** — folge dem stabilen `nextTool` und
   rate weder Pfade noch Prozesse. Ein nicht konfigurierter Fallordner ist nur
   ein Hinweis, solange genau ein Fall bereits eindeutig geöffnet ist.
3. **MCP-Tool existiert, meldet aber einen API-Startfehler** — MCP übernimmt oder startet seine exakte API-Dependency selbst. Melde den redigierten Fehler.
   Starte keine zweite API und beende keinen Prozess anhand seines Namens. Bei autoritativem `SSE_API_URL` gibt es keinen Fallback.
4. **Es gibt gar kein `sse_*`-Tool** — der MCP-Server ist beim Client nicht
   angemeldet. Wechsle in den Einrichtungsmodus, arbeite die kanonische Anleitung `https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md`
   ab und komm danach hierher zurück. Lies in diesem Zustand keine Steuerdaten.

Nach einer frischen MCP-Anmeldung lädt der laufende Client den Server nicht
nach. Melde dann „Technisches Setup bereit; Client-Verifikation nach Neustart
offen." und verlange genau einen Neustart, statt einen Tool-Erfolg zu behaupten.

## Architektur richtig verwenden
Die lokale HTTP-API auf Loopback ist der universelle Kern. Nur sie kennt
`SSE.exe`, lokale Pfade, Arbeitsbereich, Falldateien und UI Automation.

MCP ist ein dünner Wrapper darüber. Nur sein Supervisor kennt die eigene exakte
API-Dependency und `SSE_API_CONFIG`; Pfade daraus hasht er nur zur Identität.
Er liest keine Ressourceninhalte und gibt die Pfade nicht über MCP aus.
Fehlt MCP oder unterstützt der Agent kein MCP, stoppe zunächst. Verwende
dieselben Operationen nur dann direkt über die API-CLI, wenn der Nutzer diesen
separaten Modus ausdrücklich gewählt hat. Wechsel während einer möglicherweise
begonnenen Schreiboperation nie still den Transport; bei unklarem Zustand stoppen.

Die API kennt keine Anmeldung; es gibt kein Token zu lesen oder zu schützen.
Sie weist stattdessen jede Anfrage mit `Origin`, `Sec-Fetch-Site` oder einem
fremden `Host` mit 403 ab, damit keine Webseite im Browser des Nutzers die
Steuersoftware steuern kann. Verwende trotzdem die ausgelieferte CLI statt
eigener HTTP-Befehle: sie kennt Argumentschemata, Grenzen und Ergebnisverträge.

Der MCP-Eintrag enthält keinen `--config`-Parameter. Für einen eigenen Arbeitsbereich erhält er einen absoluten `SSE_API_CONFIG`-Pfad;
`SSE_API_URL` ist nur für eine separat verwaltete Loopback-API und bleibt autoritativ. Setze beide Variablen niemals gleichzeitig. Erfinde keinen Konfigurationspfad;
lies stattdessen `sse_preflight`.

### Direkte API nur als bewusster Fallback

Der Skill ist eine Komfortschicht. Fehlt MCP und hat der Nutzer ausdrücklich direkte API-Nutzung gewählt, folge
der [API-Paketdokumentation](https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/packages/api/README.md) und dem installierten
`discovery`-/`describe`-Vertrag. Wechsle während einer möglicherweise
begonnenen Mutation nie still den Transport. Ein fehlender oder fremder
Loopback-Dienst bleibt ein sicherer Stopp; beende niemals Prozesse anhand
eines bloßen Namens. Steuerwerte gehören nicht als Inline-JSON in die
Prozessliste.

Rufe nach erfolgreicher Verbindung zuerst `sse_capabilities` beziehungsweise
die API-Operation `capabilities` auf. Diese PC-neutrale Selbstbeschreibung ist
die verbindliche Quelle für verfügbare Selektoren, Klickmuster, erlaubte
Dialogantworten und die sichere Fallback-Leiter; erfinde keine Methode aus
Modellwissen. Prüfe zusätzlich `liveEvidence.operationStatus` vor UI- oder
Steuerdatenaktionen. `untested` bedeutet, dass dieser Weg im Release noch nie
erfolgreich an der echten Anwendung belegt wurde: nicht als bewiesen
darstellen und nur mit ausdrücklicher, passender Fixture-Voraussetzung
erproben. `error-path-only` belegt ausschließlich ein echtes strukturiertes
Fehlerergebnis, aber noch keinen erfolgreichen Fachweg. Der Status ist über
alle Jahresprofile aggregiert und kein Nachweis für das aktuell gebundene
`profile.id`. `liveEvidence.affectsAvailability=false` ist absichtlich rein
informativ; die tatsächliche Serversperre steht weiterhin ausschließlich in
`operationPolicy`.

Im ausdrücklich gewählten direkten API-Modus ersetzt die read-only Folge
`workspace_status`, `product_info`, `health` den MCP-Preflight. Fahre nur fort,
wenn sie eindeutig dasselbe freigegebene Profil und Steuerjahr belegen, der
laufende Build keinen Drift meldet und kein Dialog offen ist; danach
`capabilities` lesen.

## Einstieg

Prüfe zuerst nur Metadaten: Betriebssystem, Architektur, vorhandenes Release,
API-Health, Produktprofil und Arbeitsbereich. Lies danach `settings.md` aus
diesem Arbeitsbereich. Lies noch keine Belege, Connector-Inhalte oder
Steuerdaten.
Ist die Einrichtung unvollständig oder sind Fall und Belegquellen noch nicht
sicher bestätigt, lies
[references/first-run.md](references/first-run.md) und führe den dortigen
einfachen First-Run-Wizard aus. Er stellt vor der technischen Einrichtung nur
die zwei entscheidenden fachlichen Fragen: richtiger Steuerfall und
vollständige Belegordner. Erst danach kann der Nutzer alle gezeigten sicheren
technischen Defaults gemeinsam mit `OK Standard` bestätigen.
Enthält der aktuelle Auftrag bereits absolute Pfade, deren
Vollständigkeitsbestätigung und ausdrücklich `OK Standard` samt den dort
definierten engen read-only Schritten, frage weder Pfade noch Standardplan
erneut ab. `Standard-Prüflauf ausführen` oder `Standard-Einrichtung und Prüflauf ausführen` ist bei genau
einem absoluten Steuerfallpfad und genannten absoluten Belegpfaden eine
gleichwertige Bestätigung dieses engen Vertrags und bestätigt zugleich, dass
diese Belegangabe vollständig ist; „keine Belege“ zählt als vollständige
Angabe. Ein zusätzlicher Satz zur Vollständigkeit ist dann nicht nötig. Fehlt
jede Belegangabe, stelle die zweite fachliche Frage trotzdem.

Fehlt eine funktionierende Einrichtung, arbeite die kanonische Anleitung
`https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md`
ab, statt die Einrichtung frei zu improvisieren. Es gibt kein Setup-Programm:
Ordner anlegen, MCP samt exakter API-Dependency und optional den Skill installieren,
MCP beim Client anmelden. Ein API-Terminal gehört nicht zum Standardweg.
Verlange danach einen grünen `--selftest` mit demselben gesetzten
`SSE_API_CONFIG` wie im Client, zusätzlich Serverliste plus echten Aufruf von `sse_preflight` mit
strukturiertem `ok=true`; „connected“ oder ein Handshake allein genügt nicht.
Dieser Nachweis muss im MCP-Modus ein tatsächlicher MCP-Tool-Aufruf sein.
`health` über Shell oder direkte API-CLI ist dort kein Ersatz. Ist `sse_preflight`
im neu gestarteten MCP-Client nicht als Tool verfügbar, stoppe vor jeder
Facharbeit in diesem MCP-Auftrag und melde die fehlende Client-Verifikation.
Wurden Skills oder MCP im aktuellen Lauf neu installiert oder geändert, melde
statt eines vorgetäuschten Tool-Erfolgs „Technisches Setup bereit;
Client-Verifikation nach Neustart offen.“ Fordere genau einen Client-Neustart
an. Der danach gestartete Prüfauftrag führt Serverliste und genau einmal den
echten MCP-Aufruf `sse_preflight` aus und setzt bei Erfolg
ohne neue Bestätigungsfrage fort.
Kehre danach automatisch
zum ursprünglichen Prüfauftrag zurück; ein Auftrag wie „Prüfe meine
Steuererklärung“ ist nicht schon durch die Einrichtung erfüllt. Bereits
bestätigte Pfade und Entscheidungen nicht erneut erfragen.
Scheitert der Start, ändere `config.json`, Runtime-Dateien oder Prozesse
niemals manuell als Umgehung. Melde den konkreten sicheren Stopp.

Lies anschließend das in `settings.md` benannte Tracking. Ohne solche Angabe
gibt es kein implizit freigegebenes Tracking; verwende nur eine im aktuellen
Auftrag ausdrücklich genannte Datei. Mit direktem, freigegebenem Dateizugriff darf Markdown nach
Hashprüfung und Backup aktualisiert werden. Über API/MCP sind Textdateien
absichtlich create-only: lies den letzten Stand und schreibe einen neuen
datierten Snapshot unter `workspace:tracking/`, statt eine Datei zu
überschreiben. Bei einer vorhandenen `.xlsx`-Datei verwende
eine verfügbare Tabellenkalkulations-Fähigkeit und erhalte ihre Struktur; die
lokale API selbst liest oder schreibt XLSX nicht. Ist das nicht zuverlässig
möglich, frage, ob zusätzlich Markdown-Snapshots angelegt werden dürfen.
Ersetze Excel niemals still.

## Verbindlicher Ablauf

1. Lies die gespeicherten Nutzerprioritäten und das Tracking, dann
   `capabilities` und den versionsgebundenen Operationskatalog aus der
   API-Selbstbeschreibung. Verifiziere danach API-Health, aktives Profil,
   Engine-Major und Arbeitsbereich.
2. Lies `sse_instances` vor jeder UI-Navigation. Binde den einen eindeutig
   geöffneten Fall; starte keinen zweiten. Wenn die nächsten Schritte eine
   dirty-fähige UI-Navigation oder Mutation brauchen, lies jetzt Fallreferenz,
   `hwnd` und Disk-Hash und sichere diesen Stand genau einmal nach `backups:`
   gemäß [references/case-session.md](references/case-session.md). Insbesondere
   `sse_collect`, `sse_goto`, `sse_subpages`, navigierendes `sse_click_point`
   und der Programm-Prüfer gelten bereits als dirty-fähig.
3. Inventarisiere freigegebene Quellen. Speichere für Dateien Quelle,
   Dateiname, Größe, Änderungszeit soweit verfügbar, SHA-256 und relative
   Zielreferenz. Connectoren erst nach Zustimmung lesen.
   Für PDF-Belege verwende zuerst eine bereits verfügbare PDF-Fähigkeit. Fehlt
   sie, installiere weder Python noch Poppler, sondern rendere gezielt nur die
   für Zieljahr/-zeitraum plausiblen Dateien mit dem ausgelieferten
   `powershell/render-pdf.ps1` in einen neuen privaten Temp-Ordner. Der Helper
   begrenzt Breite und Seitenzahl, überschreibt keine PNG-Datei und liefert
   kompaktes JSON. Starte ihn immer als eigenen Prozess mit
   `powershell.exe -NoProfile -NonInteractive -File`; die WinRT-Runtime mancher
   Windows-Builds kann sonst beim Prozessabbau einen fremden Restcode liefern.
   Erfolg verlangt zugleich Exitcode 0, `ok=true` und den PNG-Readback. OCR
   erfolgt danach bei Bedarf lokal mit `ocr-image.ps1`.
   Rendere nicht vorsorglich Belegordner anderer Jahre vollständig.
   Für eine vollständige SSE-Bestandsaufnahme bevorzuge kurze
   `sse_collect`-Segmente entlang des linearen `Weiter`-Pfads. Lies pro Seite
   Überschrift, Felder und sichtbare Tabellen und kontrolliere Dialog,
   Seitenwechsel, Zyklus sowie Ressourcenlimit. Verwende `sse_table_read` nur
   für eine erkannte lange Tabelle, deren Zeilen virtualisiert sind. Die globale
   Suche dient danach nur zum gezielten Rücksprung auf eine bereits kartierte
   Seite; ein angezeigter Suchtreffer allein beweist keine Navigation. Ist die
   Seite, Tabellenzuordnung oder ein von Qt nicht strukturiert exponiertes
   Bedienelement trotzdem unklar, erfasse zusätzlich mit `sse_screenshot` ein
   Fensterbild im Ergebnisbereich. Nutze es zur visuellen Zustands- und
   Layoutprüfung; Beträge, Auswahlwerte und Vollständigkeit müssen weiterhin
   durch strukturierte Felder, Tabellen und Summen belegt werden.
   Kann die Agentensandbox lokale Ergebnisdateien nicht direkt öffnen, schwäche
   keine ACL. Fordere das Bild mit `includeImage: true` an und lies Textresultate
   über `sse_workspace_read_text` beziehungsweise `workspace_file_read_text`.
   Den globalen Steuerprüfer deterministisch öffnen: zuerst den Navigationsknoten
   `Prüfen und Abgeben`, dann per `goto` ohne Suche mit `direction="Weiter"` die
   Seite `Steuererklärung prüfen`, danach genau einmal `checker_run`. Details
   ausschließlich mit `checker_open` öffnen und lesen; `checker_detail` nicht
   vorher probeweise auf eingeklappte Karten anwenden.
   Auf dynamischen Übersichts- und Listenbereichen zuerst `subpages` verwenden.
   Meldet `table_read` dort `stopKind="no-table"`, ist das kein Grund für freie
   Suche nach Kindüberschriften: wähle einen nicht destruktiven, unmittelbar
   zuvor gelesenen Hyperlink über seine frische `rid` und `click_point`. Vor dem
   nächsten Geschwistereintrag über eine frisch gelesene, nicht destruktive
   Zurück-/Historienaktion oder eine bereits kartierte übergeordnete Übersicht
   zur exakten Liste zurückkehren. Suche nie direkt nach der Listen- oder
   Geschwisterüberschrift; danach deren `subpages` neu lesen. Fehlt ein
   eindeutig gebundener Rückweg, sicher stoppen. Verwerfe das Ergebnis einer
   Navigationsoperation niemals mit `Out-Null`; prüfe `ok` und die erwartete
   Überschrift, bevor der Ablauf fortgesetzt wird.
4. Empfehle Kopien unter `documents`. Bei Ablehnung nur Quelle und Entscheidung
   dokumentieren; Originale nicht verändern.
5. Prüfe unmittelbar vor jeder Änderung, dass Fallreferenz, Zustand,
   Fensterbindung (`HWND`) und
   Disk-Hash weiterhin zum verifizierten Backup-Tupel passen. Eine neu zu
   startende Einkommensteuerdatei `.ESt<jahr>` verwendet `mode="normal"`.
   Führe genau eine eng gebundene Änderung aus und lies
   Wert sowie Zustand sofort zurück. Für eine Tabellenzeile liefert
   `sse_table_read` mit `sumLabel` die aktuelle Kontrollsumme als `summe`;
   genau dieser Wert gehört unverändert als `expectedBefore` in
   `sse_table_add`, `sse_table_update` oder `sse_table_delete`. Rate ihn nie.
6. Stoppe bei Hash-, Ziel-, Dialog- oder Readback-Abweichung ohne Wiederholung.
   Speichere, schließe oder verwirf den geöffneten Fall nicht implizit. Nur bei
   einer ausdrücklich isolierten Prüffallkopie gilt der in first-run.md
   bestätigte Close-/Discard-Ablauf.
7. Verwende für wiederholbare Mehrschrittaufgaben ein versioniertes Szenario
   aus dem installierten API-Vertrag: relative Workspace-Referenzen, eindeutige
   Schritt-IDs, dynamische `$steps.<id>.result...`-Referenzen und obligatorisches
   `finally`. Verwende `continueOnError` nur für rein lesende Diagnosen; danach
   darf keine Hauptmutation folgen.
8. Bringe bei einem fachlichen Prüfauftrag dein Steuerwissen aktiv ein: benenne
   Auffälligkeiten und schlage konkrete Verbesserungen vor, wenn du sicher bist.
   Belege strittige oder betragsrelevante Punkte per Websuche an offiziellen
   deutschen Quellen; Rangfolge, Fundstellen und Fallstricke stehen in
   [references/steuerquellen.md](references/steuerquellen.md).
   Ohne Webzugriff bleiben Prüferauswertung und Belegabgleich; die
   steuerfachliche Bewertung erklärst du dann ausdrücklich für unterblieben,
   statt sie still auf Erinnerungswissen zu stützen. Sag Unsicherheit offen und
   empfiehl bei hohem Risiko eine befugte Steuerfachperson.
9. Nur wenn der bestätigte Standard-Prüflauf bereits einen Report umfasst oder
   der Mensch ausdrücklich eine Datei verlangt, schreibe unter `results`.
   Sonst antworte im Chat mit Readback und Speicherstatus.

## Bedarfsreferenzen

Fehlt für ein benötigtes Control eine Spezialoperation, lies erst dann
[references/ui-fallback.md](references/ui-fallback.md). Bei einem ausdrücklichen
UStVA-, Umsatzsteuer-Voranmeldungs-, Gewinn-Erfassungs- oder Folgejahr-Auftrag
lies vor der Facharbeit
[references/ustva.md](references/ustva.md). Für eine normale Einkommensteuer-
Prüfung werden diese Detailreferenzen nicht benötigt.

Lies [references/betriebsvertrag.md](references/betriebsvertrag.md), bevor du
API/MCP einrichtest, einen Fall öffnest oder einen Report erzeugst.

## Sichtbare UI Automation

Kündige vor dem ersten sichtbaren Schritt an:

> SteuerSparErklärung wird nun sichtbar bedient. Bitte lassen Sie den PC
> entsperrt und SSE sichtbar. Klicken oder tippen Sie während der angekündigten
> Schritte nicht und sperren Sie den Rechner nicht. Ich sage ausdrücklich
> Bescheid, wenn die Bedienung beendet ist. Schwarze Konsolenfenster sind kein
> normaler Betriebszustand.

Beginne erst nach Zustimmung. Eine Zustimmung im aktuellen Auftrag zählt ohne
dritte Rückfrage, wenn sie genau den geöffneten/bestätigten Fall und sichtbare
UI-Navigation in der entsperrten Sitzung nennt. Eine ausdrücklich isolierte
Prüfung nennt zusätzlich die Prüffallkopie. Kündige die sichtbare Navigation
trotzdem mit obigem Hinweis an und beginne dann. Stoppe bei
Nutzerinteraktion, unbekanntem Dialog, Fensterwechsel oder Sperrbildschirm.
Die definierte Formulierung `Standard-Prüflauf ausführen` zählt hier als
diese Zustimmung, wenn der Auftrag zugleich genau einen absoluten Fallpfad und
die vollständigen absoluten Belegpfade nennt.

## Wiederholungsgrenzen

| Situation | Grenze |
|---|---|
| API-Health | Ein erster Versuch plus höchstens zwei Wiederholungen nach je 2 Sekunden und erneutem Lesen der Konfiguration |
| UI-/Fensterbindung | Eine Wiederholung erst nach frischem Fall-, Fenster-, Zustands- und Hash-Readback |
| MCP-Registrierung durch Nutzer | Ein erneuter Hinweis, dann direkte API anbieten |
| Gleiche unbeantwortete Frage | Höchstens zweimal stellen, dann sicher stoppen |
| Hash-, Ziel-, unbekannter Dialog oder Readback abweichend | Keine Wiederholung und keine weitere Änderung |
| Abgebrochener MCP-/API-Aufruf | Zustand ist unbekannt; erst frischen Zustand lesen, dann bewusst entscheiden |
| API-/HTTP-Transporttimeout oder `transport-unknown` | Zustand kann nach bereits gestarteter Operation unbekannt sein; nicht als Unerreichbarkeit behandeln, erst frischen Zustand lesen |

## Stoppen und ehrlich berichten

Stoppe insbesondere bei inkompatiblem OS/Profil, fehlender Vertragsquelle,
unklarem API-Zugang, unsicherem Arbeitsbereich, fehlender Zustimmung,
Connector-Anmeldung, ungeprüftem Backup, abweichender Bindung, paralleler
Nutzerinteraktion, ausgeschöpftem Retry-Budget oder fachlicher Unsicherheit.

Berichte bei jedem Stopp:

1. blockierende Bedingung,
2. letzten verifizierten Zustand,
3. ob der offene Fall oder Dateien bereits verändert sein können,
4. genau eine nächste sichere Nutzeraktion.

## Ergebnisdatei nur im bestätigten Plan oder auf Wunsch

Schreibe nur dann UTF-8-Markdown nach `results/YYYY-MM-DD_HH-mm-ss_<zweck>.md`.
Der Report enthält Auftrag, Fallreferenz, Quellen, Änderungen/Readback, Hashes,
Unsicherheiten und Stopps, aber keine Zugangsdaten oder unnötigen Personendaten.

Enthält der Bericht fachliche Aussagen oder Vorschläge, schließe ihn genau so ab:

> Dies ist keine Steuerberatung im Sinne des Steuerberatungsgesetzes und ersetzt
> keine Beratung durch eine befugte Person. Diese Auswertung wurde mit KI
> erstellt und kann Fehler enthalten; prüfen Sie alles vor der Abgabe selbst.

Übergib einen mehrzeiligen Bericht ausschließlich über eine neue UTF-8-
Argumentdatei an `workspace_file_write_text`, nie über eine PowerShell-stdin-
Pipeline. Lies die Datei über die API zurück und vergleiche API-, physische und
aus dem UTF-8-Text berechnete SHA-256-Bytes. Prüfe zusätzlich, dass erwartete
Umlaute erhalten und keine Ersatzfragezeichen entstanden sind. Ist ein
create-only Bericht inhaltlich kodierungsbeschädigt, überschreibe ihn nicht:
markiere ihn in einem neuen korrekt kodierten Bericht ausdrücklich als
verworfen.
Verwende entweder eine vollständige Referenz wie `results:bericht.md` oder
`area="results"` mit `ref="bericht.md"`; kombiniere `area="results"` nie mit
`ref="results/bericht.md"`, weil das einen doppelten Unterordner erzeugt.

Beende dann mit dem zurückgelesenen relativen Reportpfad und dem Hinweis, dass
keine ELSTER-Übermittlung durchgeführt wurde.
