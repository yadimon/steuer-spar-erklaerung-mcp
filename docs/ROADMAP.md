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
ihrem Fehlerpfad. Als MCP-Werkzeuge veroeffentlicht sind alle 100, dazu ein
zusammengesetztes Werkzeug fuer den Einstieg.

Das ist keine Vollstaendigkeit gegenueber dem Produkt, und die Zahl 100 ist
irrefuehrend, wenn man sie allein liest. **Operationen sind Mechanismen, keine
Flaeche.** `page`, `table_read` oder `goto` arbeiten auf jeder Seite; fokusloses
Schreiben und Zustandsvergleiche brauchen dagegen ein katalogisiertes
Seitenobjekt.

Und der Katalog ist klein. `profiles/2025/page-objects.json` enthaelt heute
**neun Seiten und fuenf Fenster**, davon genau **eine** Seite aus der
Einkommensteuer (`est.sonstige_werbungskosten_fahrten`); sechs Seiten gehoeren
zur Gewinnermittlung, zwei zur Gewinn-Erfassung. Es gibt genau **einen**
profilierten fokuslosen Schreibpfad.

Wer also fragt „koennen wir SSE vollstaendig steuern?", bekommt zwei
verschiedene Antworten: Die *Mechanik* traegt weit; die *Kenntnis der
Oberflaeche* endet nach neun Seiten. Der groesste Zuwachs an echter Faehigkeit
kaeme nicht aus neuen Operationen, sondern aus mehr katalogisierten Seiten.

## 2. Die Bauwege

Jede neue Faehigkeit muss einen dieser Wege nehmen. Die Wahl bestimmt Kosten,
Risiko und ob der Benutzer dabei zusehen muss.

| Weg | Was er kann | Was er kostet | Wo er heute traegt |
| --- | --- | --- | --- |
| **Fokusloses UIA-Lesen** | Baum und Einzelwerte lesen, ohne den Vordergrund anzufassen | ein Baumlauf ist teuer, gezielte Bindung ueber AutomationId ist billig | Seitenlesen, Tabellen, Pruefer, Fallbindung |
| **Fokusloses Schreiben** | Werte in profilierte Feldpfade schreiben, mit Feld-, Summen- und Dirty-State-Readback | nur fuer katalogisierte Felder; jede neue Seite braucht ein Profil | `fill_fields`, `set_value`, `tracked_set_value` |
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

### 3.1 SSEs eigene Kommandoflaeche

Aus den statischen Belegen im Repository lassen sich **vierzehn** Kommandonamen
von SSE selbst belegen (Quellen: `static-analysis-partial/targeted-strings.json`
und der in `codex-static-events.jsonl` eingebettete Kommando-Index). Davon deckt
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
| Fast die gesamte Einkommensteuer | genau ein `est.`-Seitenobjekt im Katalog | UI, je Seite ein Profil |
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
