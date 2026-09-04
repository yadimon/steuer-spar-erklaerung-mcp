# Was die API kann, was fehlt, und auf welchem Weg

Diese Datei beantwortet drei Fragen: Was ist fertig, was fehlt, und **womit**
liesse sich das Fehlende bauen. Sie ergaenzt zwei erzeugte Dateien und
wiederholt sie nicht:

- **[API-REFERENZ.md](API-REFERENZ.md)** listet alle Operationen, ihre
  MCP-Werkzeuge, ihre Art und ihren Verifikationsstand. Sie wird aus den Quellen
  erzeugt und kann nicht veralten.
- **[VERIFIKATION.md](VERIFIKATION.md)** haelt fest, womit jede Zusicherung
  belegt ist und wo die Grenze der Aussage liegt.

Hier steht nur, was sich daraus **nicht** ablesen laesst: die Absicht.

Wer stattdessen eine einzelne Tafel sucht, auf der jede bekannte Faehigkeit mit
ihrem Stand steht - fertig, teils, offen oder bewusst zu -, findet sie in der
[Statustafel](entwicklung/status.md).

## 1. Stand in Zahlen

100 Operationen sind katalogisiert. 94 davon sind live belegt, sechs nur auf
ihrem Fehlerpfad. Dazu gibt es 100 direkte MCP-Werkzeugnamen und ein
zusammengesetztes fuer den Einstieg, zusammen 101. Sie decken 99 Operationen
ab: `checker_detail` hat kein eigenes Werkzeug, und `tracked_set_value` traegt
deren zwei (`sse_change_field`, `sse_change_known_field`).

Das ist keine Vollstaendigkeit gegenueber dem Produkt, und die Zahl 100 ist
irrefuehrend, wenn man sie allein liest. **Operationen sind Mechanismen, keine
Flaeche.**

Wichtig ist, was der Seitenkatalog tatsaechlich absperrt – naemlich sehr wenig.
Von hundert Operationen verlangen genau **zwei** einen Katalogeintrag:
`fill_fields` (geplante Feldtransaktion mit Rollback) und `known_page_state`
(Vergleich gegen einen hinterlegten Sollzustand). Alles andere arbeitet auf
jeder der 672 Seiten:

- **Lesen** ist durchgehend generisch – `page`, `read_page`, `table_read`,
  `positions`, `collect`, `snapshot`.
- **Schreiben** geht auch ohne Katalog: `tracked_set_value` nimmt statt
  `pageId`/`fieldId` auch `name`, `aid` oder `rid`; der Aufrufer liefert dann
  Seitenueberschrift und Erwartungswerte selbst.
- **Tabellen** kennen gar keine `pageId`: `table_add`, `table_update` und
  `table_delete` binden ueber `expectedPage` als Zeichenkette.

`set_value` ist die Ausnahme in die andere Richtung: absichtlich auf das globale
Suchfeld beschraenkt, weil ein direkter ValuePattern-Write Qt-Commit,
Ergebnis-Diff und Seitenobjekte umgehen wuerde.

**Nicht jede Seite profitiert von einem Katalogeintrag.** Ein linearer
Durchlauf des ESt-Musterfalls, am 2026-09-04 ueber `goto` und `snapshot`
klassifiziert, erreichte 55 von 58 Seiten:

| Bauart | Anzahl | Bringt ein Seitenobjekt etwas? |
| --- | --- | --- |
| **Feldseite** – beschreibbare Einzelfelder | 31 | ja, genau dafuer ist der Katalog da |
| **Uebersicht** – nur Rechenfelder und Text | 14 | nein, es gibt nichts zu schreiben |
| **Tabellenseite** – Daten in Zellen | 7 | nein, `table_add`/`table_update`/`table_delete` binden ueber die Ueberschrift |
| **Auswahlseite** – nur RadioButtons | 3 | nein, RadioButtons bleiben Hinweis fuer `click pattern=select` |

Rund **die Haelfte** der Seiten ist also Feldseite. Die Luecke zwischen siebzehn
katalogisierten und dem Bestand ist damit real - anders als eine erste,
kleinere Stichprobe nahelegte.

**Diese Zahl hat Grenzen, und sie gehoeren dazu:**

- Eine erste Stichprobe von 20 Seiten kam auf nur vier Feldseiten. Sie lief
  durch eine tabellenlastige Region des Dokuments; wer wenige Seiten am Stueck
  misst, misst die Nachbarschaft, nicht das Ganze.
- ComboBoxen zaehlen doppelt: UIA meldet die Box und ein inneres `Edit`. Die
  Feldzahl je Seite ist daher eine Obergrenze.
- `ro=false` heisst „nicht schreibgeschuetzt", nicht „Benutzereingabe". Auf
  Ergebnisseiten wie der Steuerberechnung ist unbelegt, ob die gezaehlten
  Felder wirklich Eingaben sind. Stichprobe `Grunddaten` (Identnummer, Anrede,
  Name, Telefon, Geburtsdatum, Adresse) war dagegen eindeutig echt.
- Gemessen wurde **ein** Musterfall. Welche Seiten ueberhaupt erscheinen,
  entscheiden dessen Themenfilter.

Die Klassifikation selbst ist billig und wiederholbar: ein `snapshot` mit
`types: ["Edit","ComboBox","CheckBox","DataItem","RadioButton"]`, getrennt nach
Steuerelementtyp und `ro`-Kennzeichen. Eine Falle steckt darin: **RadioButtons
duerfen nicht als Felder zaehlen.** Sie sind im Profilvertrag ausdruecklich kein
`fields`-Eintrag, sondern ein Hinweis fuer `sse_click pattern=select`; wer sie
mitzaehlt, haelt jede Auswahlseite faelschlich fuer eine Feldseite.

Der Katalog ist trotzdem klein. `profiles/2025/page-objects.json` enthaelt heute
**siebzehn Seiten und fuenf Fenster**: neun aus der Einkommensteuer
(Fahrten, private Kranken- und Pflegeversicherung, Spenden, Verlustvortraege
aus Kapitaleinkuenften, die ELSTER-Grunddaten, die Riester-Foerder-
voraussetzungen und drei Themenfilter), sechs aus der Gewinnermittlung, zwei
aus der Gewinn-Erfassung. Es gibt genau
**einen** profilierten fokuslosen Schreibpfad.

Wer also fragt „koennen wir SSE vollstaendig steuern?", bekommt eine
zweigeteilte Antwort: Die *Reichweite* ist gross – jede Seite ist lesbar, und
mit sichtbarem Vordergrund auch beschreibbar. Auf einem privaten Desktop
schreibt dagegen nur der eine profilierte Focusless-Pfad; alles andere stoppt
dort fail-closed mit `hidden-desktop`. Was fehlt, ist *hinterlegtes Wissen ueber die Oberflaeche*:
stabile Namen, Beschriftungen, Wertarten, Sollzustaende und der geplante
Mehrfeld-Schreibweg. Ein Katalogeintrag verwandelt „der Aufrufer muss die
Seite kennen" in „die API kennt sie".

## 2. Die Bauwege

Jede neue Faehigkeit muss einen dieser Wege nehmen. Die Wahl bestimmt Kosten,
Risiko und ob der Benutzer dabei zusehen muss.

| Weg | Was er kann | Was er kostet | Wo er heute traegt |
| --- | --- | --- | --- |
| **Fokusloses UIA-Lesen** | Baum und Einzelwerte lesen, ohne den Vordergrund anzufassen | ein Baumlauf ist teuer, gezielte Bindung ueber AutomationId ist billig | Seitenlesen, Tabellen, Pruefer, Fallbindung |
| **Fokusloses Schreiben** | Werte in Feldpfade schreiben, mit Feld-, Summen- und Dirty-State-Readback | ohne Katalog traegt der Aufrufer die Bindung; nur `fill_fields` verlangt ein Seitenobjekt | `tracked_set_value` (generisch), `fill_fields` (katalogisiert) |
| **Vordergrund-Lease mit physischer Eingabe** | Qt-Steuerelemente bedienen, die kein brauchbares UIA-Muster anbieten | der Benutzer sieht es und darf nicht dazwischenfunken; braucht ausdrueckliche Zustimmung | `click`, `combo_select`, neun der zehn BelegManager-Wege |
| **Nativer Helfer (`sse-native.dll`)** | Fensteraufzaehlung, Prozesskommandozeile, MSAA-Punktprobe, UIA-Baumlauf, Controller-Lease | C#-Code mit Hash-Bindung und Oberflaechenvertrag; jede Erweiterung ist ein eigener Vertrag | der gesamte heisse Lesepfad |
| **Dateiebene** | Falldateien hashen, sichern, archivieren, Kopien binden | keine UI noetig, aber auch kein Blick in den Inhalt | `case_hash`, `backup_cases`, `archive_cases` |
| **OCR** (`Windows.Media.Ocr`) | Text aus Bildern lesen | Erkennungsqualitaet ist nicht zusicherbar | Belegbilder |
| **PDF-Aufbereitung** (`render-pdf.ps1`) | PDF-Seiten rendern und lesen | eigener Prozess, eigene Grenzen | Belegdokumente |
| **Hersteller-IPC** | direkte, typisierte Kommandos statt Oberflaechenbedienung | **derzeit geschlossen**, siehe Abschnitt 4 | – |

## 3. Offene Luecken

Jede Zeile nennt, warum sie offen ist und welcher Weg sie schliessen wuerde.
Was hier fehlt, ist bewusst nicht erfunden: die Liste enthaelt nur Luecken, die
im Repository belegt sind.

| Luecke | Warum offen | Weg | Was dafuer noetig ist |
| --- | --- | --- | --- |
| **VaSt vollstaendig** – die sechs Wege `vast_apply`, `vast_dialog_read`, `vast_mapping_options`, `vast_mapping_select`, `vast_row_details`, `vast_row_set_expanded` | in der Snapshot-VM erreichte jeder kontrolliert den echten `not-found`-Fehlerpfad; ohne Zertifikat-PIN kam kein Datensatz | Vordergrund-Lease, wie heute | ein ELSTER-Zertifikat mit PIN in einer Wegwerf-Umgebung, und die Entscheidung, ob echte Abrufdaten dort liegen duerfen |
| **BelegManager ohne Vordergrund** – neun der zehn Wege | nur `receipt_manager_list` ist als fokusloses Lesen freigegeben; Detailauswahl, Navigation und Mutation brauchen sichtbaren Vordergrund | fokusloses Schreiben, falls die Qt-Liste je brauchbare Muster anbietet | Nachweis, dass Auswahl und Detailbindung ohne physische Eingabe stabil sind – bisher nicht gelungen |
| **Steuerjahr 2024 im Vollbetrieb** | Profil steht auf `experimental` mit `verification-only`; nur mit ausdruecklichem Opt-in erreichbar | vorhandene Wege, neues Profil | vollstaendige Live-Verifikation gegen Engine 30, wie sie fuer 2025 vorliegt |
| **Steuerjahr 2026** | es gibt kein Profil | vorhandene Wege, neues Profil | das Produkt muss erscheinen; danach Katalog, Profil und Live-Verifikation |
| **Ausgabe ausser CSV** | es gibt genau `export_csv` | Vordergrund-Lease fuer den Druckdialog, danach PDF-Aufbereitung | Entscheidung, ob ein Druck-nach-PDF-Weg die Mutationsgrenze beruehrt |
| **Schnellere Bedienung ueber typisierte Kommandos** | der Herstellerweg ist geschlossen | Hersteller-IPC | siehe Abschnitt 4 |
| **Seiten, deren Felder sich nicht eindeutig adressieren lassen** – etwa `Kapitalertraege, ermaessigt besteuert`: Die Felder beider Ehepartner tragen im adressierbaren Endstueck denselben Pfad, unterschieden werden sie erst weiter oben im Baum (gemessen 2026-09-04) | ein Seitenobjekt braucht je Feld genau einen Treffer; hier waeren es zwei | UI, aber zuerst die Bindungsregel | entweder laengere Pfade im Seitenobjekt zulassen oder die Bindung um eine Positionsangabe erweitern |
| **Seiten mit Nummer in der Mitte der Ueberschrift** – etwa die Verpflegungspauschbetraege einer Fortbildungsreise (`Fortbildung <Name>: <N>. Reise (Verpflegung)`, zehn beschreibbare Felder, gemessen 2026-09-04) | die Bindung kennt zwei Muster: `headingNumberedLabel` erwartet ein fuehrendes `N. Label`, `headingPrefix` einen festen Anfang. Hier steht die Nummer in der Mitte und der Personenname davor; ein Praefix `Fortbildung ` wuerde jede Fortbildungsseite jeder Person treffen | UI, aber zuerst die Bindungsregel | ein drittes Muster fuer Ueberschriften mit Platzhaltern an beliebiger Stelle - und der Nachweis, dass es nicht versehentlich die Nachbarseite bindet |

### 3.1 SSEs eigene Kommandoflaeche

Aus den statischen Belegen im Repository lassen sich **vierzehn** Kommandonamen
von SSE selbst belegen (Quellen: `static-analysis-partial/targeted-strings.json`
und der in `codex-static-events.jsonl` eingebettete Kommando-Index; beide liegen
im privaten Analyseordner ausserhalb von Git). Davon deckt
die API vier funktional ab, drei teilweise, sieben gar nicht.

| Kommando | Stand bei uns |
| --- | --- |
| `FileOpen`, `FileClose`, `FileSaveAsCopy`, `ShowBelegManager` | abgedeckt |
| `FileOpenFromDir` | teilweise – wir listen Faelle, oeffnen aber nicht aus einem Verzeichnis |
| `DeleteBelegeOfDialog` | teilweise – wir loeschen Belege einzeln, nicht dialogweise |
| `SteuerSparTipps` | teilweise – das Fenster ist nur lesend profiliert |
| `CommandList`, `ExportCommands`, `StartCommandAsync` | nicht abgedeckt |
| `WriteToDM` | nicht abgedeckt, und das mit Absicht: wir schreiben ausschliesslich ueber profilierte Feldpfade mit Readback |
| `CopyDMNode`, `CopyDMNodeToDMExplorer` | nicht abgedeckt |
| `GenerateNavtreeXML` | nicht abgedeckt |

Zwei Einschraenkungen gehoeren dazu. Erstens ist diese Liste **nicht
vollstaendig**: Der zugrundeliegende Zeichenkettenscan war auf ein Suchmuster
begrenzt, und dass SSE ueberhaupt ein `ExportCommands` kennt, zeigt, dass das
Programm selbst einen groesseren Katalog fuehrt. Zweitens ist ein Literal
`Goto` in den vorliegenden Belegen **nicht** nachweisbar; belegt ist nur eine
Parametersignatur `STRING GotoExpression`.

### 3.2 Programmbereiche ohne Profil

Wer die Luecke lieber an der Oberflaeche als an Symbolnamen sehen will, findet
sie in zwei Entwicklungsdokumenten. Das
[Aktionsinventar](entwicklung/aktionsinventar.md) geht die sieben Menues von
SSE mit ihren 64 Eintraegen durch: elf abgedeckt, neun teilweise, vier mit
Absicht zu, der Rest offen, darunter zwei vollstaendig leere Menues. Der
[Funktionskatalog](entwicklung/funktionskatalog.md) nimmt die fachliche Achse -
SteuerSparErklaerung ist **sieben Module**, nicht eines, und zu **vieren davon
gibt es bei uns gar nichts**: Feststellung, Lohnsteuer-Ermaessigung, Prognose
und konsolidierte Umsatzsteuer.


Die Methodennamen von `DMSession` im dekompilierten `Dm.dll`-Index nennen
Faehigkeiten, zu denen es bei uns keinerlei Gegenstueck gibt:

| Bereich | Beleg | Weg |
| --- | --- | --- |
| Fast die gesamte Einkommensteuer | neun `est.`-Seitenobjekte im Katalog – erreichbar sind die Seiten, benannt sind sie nicht | UI, je Seite ein Profil |
| Optionen, Datenuebernahme, Steuerrechner, Musterbriefe, Service, Ansicht | Menuezeile bekannt, kein einziges Objekt daraus katalogisiert | UI, `menu`/`menu_click` sind generisch |
| Druck- und Ausgabefenster | kein Fensterobjekt | UI plus PDF-Aufbereitung |
| Passwortgeschuetzte Falldateien | `setPassword`, `checkPassword`, `activePassword` | UI, sofern es einen Dialog gibt |
| Anonymisierter Export | `writeAnonymizedDataFile` | UI, sofern im Menue erreichbar |
| VLH-Import und -Export | `vlhImport`, `vlhExport` | UI |
| Fremdformat-Import | `importDataFile`, `callImportScript` | UI |
| Autosave und Wiederherstellung | `autoSave`, `restoreAutoSaved` | heute bewusst nur die Wiederherstellungsfrage, und dort ist ausschliesslich `Nein` erlaubt |
| Ehegatten-/Partnersicht | `isSpouseVisible` | UI |
| DMExplorer als eigenes Programm | als IPC-Partner belegt | ausserhalb der Prozessgrenze der API |
| **Kommandoregistry als JSON** | `getCommandRegistryAsJson` | waere der autoritative Katalog – nur ueber den Herstellerweg erreichbar |

Der letzte Eintrag ist der interessanteste: SSE kann seinen eigenen
Kommandokatalog maschinenlesbar ausgeben. Waere er erreichbar, muesste niemand
mehr Zeichenketten aus Binaerdateien lesen, um diese Liste zu fuehren.

## 4. Der Hersteller-IPC-Weg und warum er zu ist

SteuerSparErklaerung kennt einen internen Nachrichtenweg: eine
`WM_COPYDATA`-Nachricht mit der Kennung `0x01FE0000`, deren Nutzlast
`"<Nachrichtenname>:<Inhalt>"` lautet, fuer SSE also
`"CallCommand:KommandoName(<Parameterliste>)"`. Der Empfaenger antwortet
synchron mit einem Ergebniscode. Das Protokoll ist vollstaendig rekonstruiert.

Er ist trotzdem nicht nutzbar: Die Gegenstelle lebt in `IPCHelper.dll`, und
diese Bibliothek wird seit SSE 2025 **nicht mehr ausgeliefert** – auch nicht in
Build `31.0.2.0`. Der ebenfalls vorhandene `IPCHelperWrapper.dll` wird zwar
geladen, installiert ohne sein Backend aber keinen Empfaenger. Gemessen an
einem vollstaendig geladenen Fall antwortet das Programm auf jede Nutzlast mit
dem Standardwert des Systems, auch auf absichtlich unsinnige.

Damit ist der Weg keine Aufgabe fuer diesen Adapter, sondern ein Gespraech mit
dem Hersteller. Kaeme die Bibliothek zurueck oder aktivierte der Hersteller die
Empfaengerseite, liessen sich Navigation und Bedienung ohne Oberflaeche
ausfuehren – das waere der groesste denkbare Sprung.

## 5. Dauerhaft geschlossen

Diese Punkte sind keine Luecken, sondern Grenzen. Sie werden nicht geoeffnet.

- **ELSTER und jede andere Uebermittlung ans Finanzamt.** Es gibt keine
  Operation dafuer, und es soll keine geben.
- **Automatisches Speichern.** Aendern erlaubt kein Speichern; der Zeitpunkt
  bleibt beim Benutzer.
- **Arbeiten am Originalfall ohne bestaetigte Bindung und hashverifizierte
  Sicherung.**
- **Umgehen der Build-Sperre.** Nach einem Produktupdate bleiben die
  mutierenden Operationen gesperrt, bis der neue Build live nachverifiziert
  ist. Es gibt bewusst keinen Schalter dagegen.
- **Steuerberatung.** Die API bedient ein Programm; sie beurteilt nichts.
