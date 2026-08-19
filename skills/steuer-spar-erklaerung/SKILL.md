---
name: steuer-spar-erklaerung
description: Prüft einen konkreten Steuerfall in einer vom lokalen Release unterstützten SteuerSparErklärung unter Windows, gleicht ihn mit Belegen ab, richtet bei Bedarf die lokale Automation über npm oder ein portables Release ein oder bearbeitet nach Freigabe eine verifizierte Arbeitskopie. Verwenden bei „meine Steuererklärung prüfen“, SteuerSparErklärung/SSE bedienen, Belege abgleichen sowie API- oder MCP-Einrichtung; nicht für allgemeine Steuerfragen ohne lokalen SSE-Fall und niemals für ELSTER-Versand.
---

# SteuerSparErklärung sicher prüfen

Führe technisch unerfahrene Nutzer standardmäßig auf Deutsch. Arbeite
read-only, bis eine konkrete Änderung an einer verifizierten Arbeitskopie
separat freigegeben wurde.

## Nutzerziel zuerst erkennen

Ordne den Auftrag ohne technische Rückfrage einem sicheren Modus zu:

- „prüfen“, „Schnellcheck“ oder „Fehler finden“: ausschließlich read-only;
- „mit Belegen abgleichen“: read-only in Fall und freigegebenen Quellen;
- „korrigieren“ oder „ändern“: zuerst Vorschläge, dann nur eine verifizierte
  Arbeitskopie und jede einzelne Freigabe;
- „UStVA“, „Umsatzsteuer-Voranmeldung“, Monat oder Quartal vorbereiten:
  UStVA-Modus; Zieljahr, gesetzliche Frequenz und vorhandene Übermittlung
  zuerst prüfen, nur bei ausdrücklichem Auftrag in einer Arbeitskopie ändern;
- „einrichten“ oder „Verbindung reparieren“: Setup-Modus, noch keine
  Steuerdaten lesen.

Bestätige den erkannten Modus in einem kurzen deutschen Satz. Erkläre API, MCP,
Hashes oder Dateiformate nur, wenn der Nutzer danach fragt oder eine konkrete
Entscheidung davon abhängt.

## Harte Grenzen

Diese Regeln gelten auch auf ausdrücklichen Wunsch:

- Sende, übermittle, bestätige oder schließe niemals über ELSTER ab. Bereite
  keinen Versandklick und keinen Umgehungsweg vor.
- Lösche, überschreibe oder benenne niemals Originalfälle oder bereits
  übermittelte Falldateien um. Verschiebe Fälle im normalen Prüf- und
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
- Ändere Steuerdaten nur in einer zuvor bytegleich verifizierten Arbeitskopie.
- Öffne auch für eine UI-gebundene reine Prüfung niemals den Originalfall.
  SSE kann schon beim Navigieren die zuletzt besuchte Seite als ungespeicherte
  In-Memory-Änderung markieren. Erzeuge daher vor der ersten UI-Navigation mit
  `sse_make_working_copy` eine neue hashverifizierte Prüffallkopie im
  konfigurierten Fallbereich und öffne ausschließlich diese. Ein Original darf
  nur über dateibasierte Operationen wie Hash, Kopf und Inventar gelesen werden.
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

## Architektur richtig verwenden

Die lokale HTTP-API auf Loopback ist der universelle Kern. Nur sie kennt
`SSE.exe`, lokale Pfade, Arbeitsbereich, Falldateien und UI Automation.

MCP ist ein optionaler dünner Wrapper. Sein Prozess kennt nur API-URL und
Token; die Client-Konfiguration selbst bleibt tokenfrei und startet den lokalen
Bootstrap. Fehlt
MCP oder unterstützt der Agent kein MCP, verwende dieselben Operationen direkt
über die API. Wechsel während einer möglicherweise begonnenen Schreiboperation
nie still den Transport; bei unklarem Zustand stoppen.

Lies oder parse `config.json` niemals, um das API-Token selbst zu extrahieren.
Verwende für authentifizierte direkte Aufrufe ausschließlich die ausgelieferte
CLI, die das Token intern lädt; baue keinen `curl`-, `Invoke-RestMethod`- oder
eigenen HTTP-Befehl mit Bearer-Token. Nur `/healthz` darf ohne Token direkt
geprüft werden.

Für direkte API-Aufrufe bevorzuge die ausgelieferte
`steuer-spar-erklaerung-call`-CLI beziehungsweise im portablen Ordner
`runtime/node.exe dist/api-cli.js`. Beginne bei einer bekannten Einzelaktion
mit `describe <operation>` und nur bei einer breiten Planung mit `discovery`; für komplexe
Argumente bevorzugt eine neue begrenzte UTF-8-JSON-Datei per `--args-file`
verwenden. `--args-file -` ist nur für kleine, im selben Prozess erzeugte
ASCII-Objekte geeignet. Mehrzeiligen Text oder Nicht-ASCII-Zeichen niemals
durch eine Windows-PowerShell-Pipeline an stdin reichen: deren implizite
Codepage kann Umlaute unbemerkt durch `?` ersetzen. Dafür JSON UTF-8 ohne BOM
in eine private Datei schreiben, diese zurückparsen und ihren Pfad an
`--args-file` übergeben. Schreibe Steuerwerte nie als Inline-JSON in die
Kommandozeile oder Prozessliste. Ist ein eigener Client sinnvoller, lies `openapi` und verwende
ausschließlich die dort aktuell veröffentlichten Bearer-geschützten Verträge.
Leite Anzahl und Namen immer aus der Laufzeitquelle ab.

Lege bei direkten Laufzeit- und UI-Aufrufen mit `--journal-file
<neue-private-datei.jsonl>` immer eine neue Journaldatei im privaten
Arbeitsbereich des Agenten an. Die CLI schreibt vor dem API-Aufruf dauerhaft
einen JSONL-Eintrag mit `status="pending"`, `command`, `invocationId` und
`startedAt` und danach `status="complete"`, `exitCode` und vollständigem
`result` oder `status="error"` samt Fehlertext.
Existierende Dateien werden nie überschrieben. `pending`, ein fehlender
Abschlusseintrag oder leerer stdout bedeuten einen unbekannten Zustand: lies
zuerst das Journal und danach frischen API-Zustand, starte dieselbe Aktion aber
nicht erneut. Vermische eigene Diagnoseausgaben nicht mit dem JSON-stdout der
CLI; lies das Journal in einem getrennten Schritt. Verwende für `launch`, `windows`, `collect`, `ui_state`, `close`
und `health` auf langsamen PCs kein künstlich verkürztes Transportlimit; die
CLI-Vorgabe beträgt 90 Sekunden.
Ein synchronisierter `complete`-Eintrag mit `exitCode=1` ist kein
Transportfehler: lies `result`. Bei `result.ok=false` ist die fachliche
Operation nachweislich fehlgeschlagen oder absichtlich unvollständig. Ein
`collect` mit `kind="collection-incomplete"` und `stopKind="limit-reached"`
darf seine gelesenen Seiten als klar begrenzten Teilstand liefern, aber niemals
als vollständige Prüfung gelten.

Eine Agentensandbox darf die API-Wahrheit nicht durch lokale Prozessproben
ersetzen. Unterdrücktes oder verweigertes `Get-CimInstance`, `Get-Process` oder
`tasklist` beweist keine beendete SSE-PID. Melden `close` nicht gleichzeitig
`ok=true` und `stillRunning=false`, bleibt nur die Aussage: „Meine Automation
ist beendet; SSE kann noch geöffnet sein.“ Behaupte „SSE ist geschlossen“ erst
nach diesem positiven Close-Readback und einer frischen API-Abfrage von
`windows` oder `health`, in der die gebundene PID/HWND nicht mehr läuft.

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

Der Endnutzer braucht kein globales Node.js/npm, kein Python und kein
PowerShell 7. Ist Node.js/npm schon vorhanden, darf der Setup-Skill die
veröffentlichten npm-Pakete verwenden; andernfalls enthält das portable
Release `runtime/node.exe`. Beide Wege verwenden Windows PowerShell 5.1.

## Einstieg und Wizard

Prüfe zuerst nur nicht geheime Setup-Metadaten: Betriebssystem, Architektur,
vorhandenes Release, Konfiguration, API-Health, Produktprofil und
Arbeitsbereich. Lies danach `setup-decisions.json` und `settings.md` aus diesem
Arbeitsbereich. Lies noch keine Belege, Connector-Inhalte oder Steuerdaten.
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
erneut ab.

Fehlt eine funktionierende Einrichtung, verwende anschließend
`steuer-spar-erklaerung-setup`. Ist dieser Skill nicht installiert, installiere
beide öffentlichen Skills nach dessen kanonischer
`references/installation.md`, statt die Einrichtung frei zu improvisieren.
Verlange nach Setup ein grünes `steuer-spar-erklaerung-setup --check` und bei
MCP zusätzlich Serverliste plus echten Aufruf von `sse_health` mit
strukturiertem `ok=true`; „connected“ oder ein Handshake allein genügt nicht.
Kehre danach automatisch
zum ursprünglichen Prüfauftrag zurück; ein Auftrag wie „Prüfe meine
Steuererklärung“ ist nicht schon durch die Einrichtung erfüllt. Bereits
bestätigte Pfade und Entscheidungen nicht erneut erfragen.
Lehnt der Setup-Wizard einen `--plan-file`-Lauf oder den kontrollierten
Neustart ab, ändere `config.json`, `setup-decisions.json`, Runtime-Dateien oder
Prozesse niemals manuell als Umgehung. Melde den konkreten sicheren Stopp.

Lies anschließend das in den Entscheidungen benannte Tracking. Mit direktem,
freigegebenem Dateizugriff darf Markdown nach Hashprüfung und Backup aktualisiert
werden. Über API/MCP sind Textdateien absichtlich create-only: lies den letzten
Stand und schreibe einen neuen datierten Snapshot unter `workspace:tracking/`,
statt eine Datei zu überschreiben. Bei einer vorhandenen `.xlsx`-Datei verwende
eine verfügbare Tabellenkalkulations-Fähigkeit und erhalte ihre Struktur; die
lokale API selbst liest oder schreibt XLSX nicht. Ist das nicht zuverlässig
möglich, frage, ob zusätzlich Markdown-Snapshots angelegt werden dürfen.
Ersetze Excel niemals still.

## Verbindlicher Ablauf

1. Lies die gespeicherten Nutzerprioritäten und das Tracking, dann
   `capabilities` und den versionsgebundenen Operationskatalog aus der
   API-Selbstbeschreibung. Verifiziere danach API-Health, aktives Profil,
   Engine-Major und Arbeitsbereich.
2. Inventarisiere freigegebene Quellen. Speichere für Dateien Quelle,
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
3. Empfehle Kopien unter `documents`. Bei Ablehnung nur Quelle und Entscheidung
   dokumentieren; Originale nicht verändern.
4. Identifiziere den Originalfall dateibasiert read-only. Vor jeder UI-
   Navigation – auch bei einer reinen Prüfung – Hash berechnen, eine eindeutig
   neu benannte Prüffallkopie unter `cases` erzeugen, beide Hashes vergleichen
   und vor dem Öffnen Bytegleichheit bestätigen. Öffne den Originalfall nicht.
   Starte eine Einkommensteuerdatei `.ESt<jahr>` immer explizit mit
   `mode="normal"`; verlasse dich dafür nicht auf die `einur`-Vorgabe für
   Gewinnermittlungsdateien.
   Die Prüffallkopie bleibt bis zu einem später ausdrücklich beauftragten,
   inventargebundenen Archiv- oder Bereinigungsschritt bestehen; lösche sie
   nicht mit Roh-Dateibefehlen.
5. Lies unmittelbar vor jeder Änderung Fallreferenz, Zustand, Fensterbindung
   (`HWND`) und Hash neu. Führe genau eine eng gebundene Änderung aus und lies
   Wert sowie Zustand sofort zurück. Für eine Tabellenzeile liefert
   `sse_table_read` mit `sumLabel` die aktuelle Kontrollsumme als `summe`;
   genau dieser Wert gehört unverändert als `expectedBefore` in
   `sse_table_add`, `sse_table_update` oder `sse_table_delete`. Rate ihn nie.
6. Stoppe bei Hash-, Ziel-, Dialog- oder Readback-Abweichung ohne Wiederholung.
   Die read-only Prüfung darf weiterlaufen, wenn sie den unsicheren Zustand
   klar ausgrenzt. Meldet die Prüffallkopie nach Navigation
   `ungespeichert=true`, navigiere nicht weiter. Schließe nur nach ausdrücklicher
   Bestätigung mit `discardChanges=true`, lies `stillRunning=false`, Fenster,
   Health sowie Hash von Original und Kopie zurück und speichere niemals diesen
   reinen Navigationszustand. Wurde entgegen dieser Regel der Originalfall
   geöffnet, ist für das Verwerfen eine eigene Nutzerbestätigung Pflicht.
7. Verwende für wiederholbare Mehrschrittaufgaben ein versioniertes Szenario
   aus dem installierten API-Vertrag: relative Workspace-Referenzen, eindeutige
   Schritt-IDs, dynamische `$steps.<id>.result...`-Referenzen und obligatorisches
   `finally`. Verwende `continueOnError` nur für rein lesende Diagnosen; danach
   darf keine Hauptmutation folgen.
8. Prüfe steuerliche Werte nur bei einem fachlichen Prüfauftrag gegen aktuelle
   deutsche Primärquellen und Herstellerhinweise. Markiere Unsicherheit und
   empfehle bei hohem Risiko eine befugte Steuerfachperson.
9. Schreibe immer einen Ergebnis- oder Stoppreport unter `results` und lies ihn
   abschließend zurück.

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
dritte Rückfrage, wenn sie genau den bestätigten Fall, eine hashverifizierte
Prüffallkopie und sichtbare read-only UI-Navigation in der entsperrten Sitzung
nennt. Kündige die sichtbare Navigation trotzdem mit obigem Hinweis an und
beginne dann. Eine allgemeine Bitte „prüfen“ reicht dafür nicht. Stoppe bei
Nutzerinteraktion, unbekanntem Dialog, Fensterwechsel oder Sperrbildschirm.

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
Connector-Anmeldung, ungeprüfter Arbeitskopie, abweichender Bindung, paralleler
Nutzerinteraktion, ausgeschöpftem Retry-Budget oder fachlicher Unsicherheit.

Berichte bei jedem Stopp:

1. blockierende Bedingung,
2. letzten verifizierten Zustand,
3. ob und welche Dateien oder Arbeitskopien bereits verändert sein können,
4. genau eine nächste sichere Nutzeraktion.

## Ergebnis

Schreibe UTF-8-Markdown nach
`results/YYYY-MM-DD_HH-mm-ss_<kurzer-zweck>.md`. Der Report enthält Auftrag,
Modus, Profil, Engine, Fallreferenz, Quelleninventar, geprüfte Punkte,
Abweichungen, Änderungen mit Vorher/Nachher/Readback, Hashes, Transportwechsel,
fachliche Quellen, Unsicherheiten, Stopps und manuelle Schritte. Entferne Token,
Zugangsdaten und unnötige personenbezogene Daten.

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

Beende mit dem zurückgelesenen relativen Reportpfad und dem ausdrücklichen
Hinweis, dass keine ELSTER-Übermittlung durchgeführt wurde.
