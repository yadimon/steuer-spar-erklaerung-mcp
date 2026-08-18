---
name: steuer-spar-erklaerung
description: Prüft einen konkreten Steuerfall in einer vom lokalen Release unterstützten SteuerSparErklärung unter Windows, gleicht ihn mit Belegen ab, richtet bei Bedarf die portable lokale Automation ein oder bearbeitet nach Freigabe eine verifizierte Arbeitskopie. Verwenden bei „meine Steuererklärung prüfen“, SteuerSparErklärung/SSE bedienen, Belege abgleichen sowie API- oder MCP-Einrichtung; nicht für allgemeine Steuerfragen ohne lokalen SSE-Fall und niemals für ELSTER-Versand.
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

## Architektur richtig verwenden

Die lokale HTTP-API auf Loopback ist der universelle Kern. Nur sie kennt
`SSE.exe`, lokale Pfade, Arbeitsbereich, Falldateien und UI Automation.

MCP ist ein optionaler dünner Wrapper. Er kennt nur API-URL und Token. Fehlt
MCP oder unterstützt der Agent kein MCP, verwende dieselben Operationen direkt
über die API. Wechsel während einer möglicherweise begonnenen Schreiboperation
nie still den Transport; bei unklarem Zustand stoppen.

Für direkte API-Aufrufe bevorzuge die ausgelieferte
`steuer-spar-erklaerung-call`-CLI beziehungsweise im portablen Ordner
`runtime/node.exe dist/api-cli.js`. Beginne bei einer bekannten Einzelaktion
mit `describe <operation>` und nur bei einer breiten Planung mit `discovery`; für komplexe
Argumente eine neue begrenzte UTF-8-JSON-Datei per `--args-file` oder einen
kurzlebigen stdin-Datenstrom per `--args-file -` verwenden. Schreibe Steuerwerte nie als Inline-JSON in die Kommandozeile oder
Prozessliste. Ist ein eigener Client sinnvoller, lies `openapi` und verwende
ausschließlich die dort aktuell veröffentlichten Bearer-geschützten Verträge.
Leite Anzahl und Namen immer aus der Laufzeitquelle ab.

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
PowerShell 7. Das portable Release enthält `runtime/node.exe` und verwendet
Windows PowerShell 5.1. Solche Werkzeuge dürfen nur als Entwicklerabhängigkeiten
bezeichnet werden.

## Einstieg und Wizard

Prüfe zuerst nur nicht geheime Setup-Metadaten: Betriebssystem, Architektur,
vorhandenes Release, Konfiguration, API-Health, Produktprofil und
Arbeitsbereich. Lies danach `setup-decisions.json` und `settings.md` aus diesem
Arbeitsbereich. Lies noch keine Belege, Connector-Inhalte oder Steuerdaten.
Fehlt eine dieser Setup-Dateien, führe den Setup-Skill aus, statt Annahmen über
Pfade oder Präferenzen zu treffen.

Lies anschließend das in den Entscheidungen benannte Tracking. Mit direktem,
freigegebenem Dateizugriff darf Markdown nach Hashprüfung und Backup aktualisiert
werden. Über API/MCP sind Textdateien absichtlich create-only: lies den letzten
Stand und schreibe einen neuen datierten Snapshot unter `workspace:tracking/`,
statt eine Datei zu überschreiben. Bei einer vorhandenen `.xlsx`-Datei verwende
eine verfügbare Tabellenkalkulations-Fähigkeit und erhalte ihre Struktur; die
lokale API selbst liest oder schreibt XLSX nicht. Ist das nicht zuverlässig
möglich, frage, ob zusätzlich Markdown-Snapshots angelegt werden dürfen.
Ersetze Excel niemals still.

Biete sofort an:

> Sie können „alles mit Standardwerten“ antworten. Dann verwende ich die
> sicheren Empfehlungen. Zustimmungen zum Installieren, Lesen eines
> Connectors, Kopieren von Dateien, Ändern von Steuerdaten oder Bearbeiten
> einer Agenten-Konfiguration frage ich trotzdem einzeln ab.

Stelle nur eine Frage pro Nachricht. Überspringe sicher beantwortete Fragen.
Jede Frage nennt eine empfohlene Antwort, zum Beispiel „Wenn Sie unsicher sind,
antworten Sie Nein.“

Kläre in dieser Reihenfolge:

1. Nur Setup, Prüfung ohne Falländerung oder kontrollierte Bearbeitung?
   Standard: **Prüfung ohne Falländerung**.
2. Vorhandenen Arbeitsbereich wiederverwenden? Standard: **Ja**, sonst den vom
   Setup vorgeschlagenen LocalAppData-Ordner.
3. Wo liegen Belege: lokaler Ordner, bereits verbundener Connector oder
   manuelle Bereitstellung? Standard: **lokaler Ordner**.
   Erfasse außerdem, welche Belege aktuell als vollständig gelten. Standard
   für die laufende Vorbereitung: **vorhandene Ein- und Ausgangsrechnungen als
   führendes Beleginventar; Zahlungen separat als noch abzugleichend markieren**.
4. Darf ein konkret benannter Connector gelesen werden? Standard bei
   Unsicherheit: **Nein**.
5. Dürfen ausgewählte Dateien als Kopien gesammelt werden? Standard: **Ja**;
   Originale unverändert lassen.
6. Direkte API oder nachweislich vorhandenes MCP? Standard: **direkte API,
   wenn MCP nicht bereits funktioniert**.
7. Nur bei Bearbeitung: Darf eine verifizierte Arbeitskopie entstehen?
   Standard: **Ja**.
8. Nur bei Bearbeitung: Sind die anschließend einzeln aufgelisteten Änderungen
   freigegeben? Standard: **erst nach Prüfung der Liste Ja**.
9. Nur bei sichtbarer Bedienung: Darf SSE jetzt gesteuert werden? Standard:
   **Ja, wenn der PC frei bleibt**.

Fehlt eine funktionierende Einrichtung, verwende
`steuer-spar-erklaerung-setup`. Ist dieser Skill nicht installiert, führe
dessen sichere Schritte inline aus und frage nur bei einer erforderlichen
Nutzerentscheidung.

## Verbindlicher Ablauf

1. Lies die gespeicherten Nutzerprioritäten und das Tracking, dann
   `capabilities` und den versionsgebundenen Operationskatalog aus der
   API-Selbstbeschreibung. Verifiziere danach API-Health, aktives Profil,
   Engine-Major und Arbeitsbereich.
2. Inventarisiere freigegebene Quellen. Speichere für Dateien Quelle,
   Dateiname, Größe, Änderungszeit soweit verfügbar, SHA-256 und relative
   Zielreferenz. Connectoren erst nach Zustimmung lesen.
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
3. Empfehle Kopien unter `documents`. Bei Ablehnung nur Quelle und Entscheidung
   dokumentieren; Originale nicht verändern.
4. Identifiziere den Originalfall read-only. Für Schreibarbeit Hash berechnen,
   neue Kopie unter `cases` erzeugen, beide Hashes vergleichen und vor dem
   Öffnen Bytegleichheit bestätigen.
5. Lies unmittelbar vor jeder Änderung Fallreferenz, Zustand, Fensterbindung
   (`HWND`) und Hash neu. Führe genau eine eng gebundene Änderung aus und lies
   Wert sowie Zustand sofort zurück. Für eine Tabellenzeile liefert
   `sse_table_read` mit `sumLabel` die aktuelle Kontrollsumme als `summe`;
   genau dieser Wert gehört unverändert als `expectedBefore` in
   `sse_table_add`, `sse_table_update` oder `sse_table_delete`. Rate ihn nie.
6. Stoppe bei Hash-, Ziel-, Dialog- oder Readback-Abweichung ohne Wiederholung.
   Die read-only Prüfung darf weiterlaufen, wenn sie den unsicheren Zustand
   klar ausgrenzt.
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

## Fallback bei unbekannten Controls

Fehlt eine Spezialoperation, darf die Arbeit kontrolliert weitergehen:

1. Lies zuerst `sse_page_state` oder `sse_ui_state`.
2. Entdecke das Control ausschließlich lesend mit `sse_snapshot`, `sse_find`
   und bei Bedarf `sse_accessibility_probe`.
3. Übernimm AutomationId oder RuntimeId nur aus diesem frischen Zustand. Für
   eine Aktion ist der Name oder die AutomationId die bessere Bindung: Ältere
   Programmversionen vergeben zwischen zwei Aufrufen neue RuntimeIds, und die
   Aktion endet dann mit `not-found` auf einem leeren Bezeichner.
4. Verwende für Checkboxen `sse_toggle`, für Listen `sse_combo_options` plus
   `sse_combo_select` und für Textfelder eine gebundene Schreiboperation.
5. Verwende `sse_click` nur, wenn Ziel, Seite, Fenster und Nachbedingung
   eindeutig sind. Nutze niemals einen generischen Toggle-Klick.
6. Lies nach jeder Interaktion den Zustand neu. Bei Mehrdeutigkeit oder
   Abweichung stoppen; nicht auf eine andere Methode durchprobieren.

Ein unbekannter Dialogbutton wird in `unsupportedButtons` gemeldet, bleibt aber
gesperrt. Zeige ihn dem Nutzer und stoppe. Erweitere die Allowlist nicht zur
Laufzeit und bestätige keine Dialogkette blind.

## Umsatzsteuer-Voranmeldung

Eine Jahreserklärung oder allgemeine Fallprüfung autorisiert keine
UStVA-Änderung. Bei einem ausdrücklichen UStVA-Auftrag:

1. Bestimme zuerst Zieljahr und Zielzeitraum. Das Profil 2025 darf zusätzlich
   genau den vom Hersteller vorgesehenen Folgejahr-Fall `*.GewErfass2026`
   bedienen. Verwende diese Ausnahme nur für Gewinn-Erfassung/UStVA 2026;
   andere 2026er Fallarten und spätere Jahre bleiben gesperrt.
2. Lies Fallkopf, Übermittlungsprotokolle und UStVA-Zustand. Ist der Zeitraum
   bereits übermittelt, bereite keinen zweiten Fall und keine Berichtigung ohne
   einen neuen ausdrücklichen Auftrag vor.
3. Erstelle vor jeder Betragseingabe ein vollständiges Periodeninventar der
   freigegebenen Ein- und Ausgangsrechnungen. Rechnungen sind die führende
   Quelle für Betrag, Leistungsbezug, ausgewiesene Umsatzsteuer und
   Rechnungsaussteller; Kontoauszüge ersetzen keine fehlende Rechnung. Halte
   Zahlungsstatus und Zahlungsdatum getrennt fest. Fehlt dieser Abgleich,
   kennzeichne die Buchung und das Ergebnis als **vorläufig - Zahlungsabgleich
   ausstehend**; behaupte weder einen abschließenden EÜR-Zeitpunkt noch einen
   abschließenden Zeitpunkt bei Istversteuerung.
4. Erfasse oder korrigiere die belegten Einnahmen und Ausgaben zuerst in den
   fachlich passenden Buchungsseiten der Gewinn-Erfassung. Trenne dabei
   deutsche Umsatzsteuer, EU-/Drittlands-§13b, nicht abziehbare oder
   korrekturbedürftig ausgewiesene ausländische Umsatzsteuer sowie nicht
   steuerbare EU-Ausgangsleistungen. Lies jede Zeile, die Seitensumme, die
   Betriebseinnahmen/-ausgaben-Übersicht und die Vorsteuer-Übersicht zurück.
   Verwechsle Kostenart und Umsatzsteuerbehandlung nicht: Ein Software-Abo oder
   Online-Dienst ist wirtschaftlich eine EDV-Ausgabe, kann aber bei einem
   ausländischen Anbieter zugleich eine sonstige Leistung nach § 13b UStG
   sein. In der SSE-Version 2025 bietet die Buchungsseite `EDV-Kosten` keine
   §13b-Unterseite. Erfasse eine solche Rechnung deshalb **einmal** unter
   `Fremdleistungen -> Rechnungen nach § 13b UStG` und wähle anhand des
   Anbietersitzes `Sonst. Leistung EU` oder `Sonst. Leistung Drittland`.
   Erfasse denselben Nettobetrag nicht zusätzlich unter `EDV-Kosten`, weil das
   die Betriebsausgabe verdoppeln würde. Inländische Software-Rechnungen mit
   deutscher Umsatzsteuer und ausländische Rechnungen ohne §13b verbleiben in
   der fachlich passenden EDV-Kostenzeile.
   Eine Rechnung aus einem bereits übermittelten Zeitraum wird nicht still in
   den aktuellen Zeitraum verschoben; dokumentiere stattdessen den möglichen
   Berichtigungsbedarf.
5. Behalte die belegte Meldefrequenz bei. „Juli“ allein ist keine Erlaubnis,
   von vierteljährlich auf monatlich umzustellen. Bei fachlicher Unsicherheit
   aktuelle Primärquellen prüfen und stoppen.
6. Verwende `sse_ustva_read` vor und nach der Arbeit. Wähle Frequenz und
   Monat/Quartal mit getrennten `sse_ustva_select_period`-Aufrufen, jeweils mit
   Arbeitskopie, aktuellem Hash, PID/HWND sowie exaktem Vorwert.
7. Verwende `sse_ustva_open_section` statt generischer Klicks. Öffne damit auch
   die Detailbereiche `reverse_charge` und `input_tax`; EU-/Drittlandsleistungen
   und normale/§13b-Vorsteuer müssen getrennt rückgelesen werden. Mehrere gleich
   benannte Schaltflächen sind nachweislich mehrdeutig.
8. Vergleiche die automatisch aus den Buchungen erzeugte UStVA mit dem
   Periodeninventar. `manual_input` ist nur ein begründeter Fallback, wenn eine
   belegte Position trotz korrekter Buchung nicht fachlich abbildbar ist.
   Aktiviere es und ändere manuelle Hauptbeträge nur nach ausdrücklicher
   Freigabe; dokumentiere Ursache sowie jeden Vor-/Nachwert. Eine unvollständig
   vorgefüllte Gewinn-Erfassung darf nicht durch bloßes Übertragen von Summen in
   die UStVA kaschiert werden.
9. Speichere nur nach vollständigem Readback und gesonderter Freigabe mit dem
   hashgebundenen Speicherbefehl. ELSTER, Senden und Übermittlung bleiben auch
   dann gesperrt.

Lies [references/betriebsvertrag.md](references/betriebsvertrag.md), bevor du
API/MCP einrichtest, einen Fall öffnest oder einen Report erzeugst.

## Sichtbare UI Automation

Kündige vor dem ersten sichtbaren Schritt an:

> SteuerSparErklärung wird nun sichtbar bedient. Bitte lassen Sie den PC
> entsperrt und SSE sichtbar. Klicken oder tippen Sie während der angekündigten
> Schritte nicht und sperren Sie den Rechner nicht. Ich sage ausdrücklich
> Bescheid, wenn die Bedienung beendet ist. Schwarze Konsolenfenster sind kein
> normaler Betriebszustand.

Beginne erst nach Zustimmung. Stoppe bei Nutzerinteraktion, unbekanntem Dialog,
Fensterwechsel oder Sperrbildschirm.

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

Beende mit dem zurückgelesenen relativen Reportpfad und dem ausdrücklichen
Hinweis, dass keine ELSTER-Übermittlung durchgeführt wurde.
