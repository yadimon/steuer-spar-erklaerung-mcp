# Funktionskatalog: das Produkt gegen unsere API

Dieses Dokument stellt die Faehigkeiten von SteuerSparErklaerung der API
gegenueber – gruppiert, damit sichtbar wird, wo wir tief sind und wo gar nichts
ist. Es ist Entwicklungswissen und kein Versprechen.

Das [Aktionsinventar](aktionsinventar.md) ist die Detailsicht auf die Menuezeile;
hier geht es um die fachliche Landkarte.

## Quellen und was sie taugen

| Quelle | Wie belastbar |
| --- | --- |
| **Messung in der Forschungs-VM**, 2026-09-03, SSE `31.0.2.0` / `[31.31]` | belastbar. Sieben Musterfaelle geoeffnet, je der Navigationsbaum ueber UIA aufgeklappt und gelesen. Nichts geklickt, nichts gespeichert. Rohdaten: `fallarten-katalog.json`, Job `43-alle-fallarten.ps1` |
| **Herstellerhandbuch** | eingeschraenkt. Oeffentlich zugaenglich ist nur das Handbuch zum Steuerjahr **2023**; fuer 2025 gibt es keine oeffentliche Fassung. Die Kapitelstruktur ist ueber Jahrgaenge hinweg stabil, Einzelaussagen sind fuer unser Profiljahr aber nur wahrscheinlich |
| **Unser Repository** | belastbar. Operationsliste, Seitenkatalog, Verifikationsstand |

Wo unten „vermutet" steht, ist die Zuordnung aus Namensaehnlichkeit geraten und
nicht gemessen.

## Achse 1: Die Module

SteuerSparErklaerung ist nicht ein Programm, sondern sieben. Jede Fallart hat
eine eigene Dateiendung, einen eigenen Startmodus und einen eigenen
Navigationsbaum. Die folgenden Baeume sind gemessen.

| Modul | Endung | Rubriken | Bei uns |
| --- | --- | --- | --- |
| **Einkommensteuer** | `.ESt2025` | 9 | die einzige live gefahrene Fallart; **ein** Seitenobjekt |
| **Gewinnermittlung** | `.Gew2025` | 15 | sechs Seitenobjekte (`gew.*`), UStVA ausgebaut |
| **Gewinn-Erfassung** | `.GewErfass2026` | 12 | zwei Seitenobjekte (`gew_erfass.*`) |
| **Gesonderte Feststellung** | `.GesondFest2025` | 11 | **nichts** |
| **Lohnsteuer-Ermaessigung** | `.Freib2026` | 14 | **nichts** |
| **Prognose** | `.EStProg2026` | 4 | **nichts** |
| **Konsolidierte Umsatzsteuer** | `.KonsUSt2025` | – | **nichts**, siehe Befund unten |

### Gemessener Befund: die konsolidierte Umsatzsteuer laesst sich nicht direkt oeffnen

Wird `Muster USt.KonsUSt2025` als Argument an `SSE.exe` uebergeben, meldet das
Programm ein Fenster mit dem Titel **„Ungueltiger Modus"** und keinen
Navigationsbaum. Die anderen sechs Fallarten oeffnen so problemlos.

Das ist praktisch relevant: Unser `launch` uebergibt die Falldatei genauso.
Diese Fallart braucht offenbar einen eigenen Startweg – vermutlich ueber das
Steuertipps-Center oder einen Startmodus-Schalter. Das Profil kennt sechs
Startmodi (`einur`, `normal`, `einurvor`, `fest`, `ermaess`, `vorweg`); welcher
zur konsolidierten Umsatzsteuer gehoert, ist offen.

### Die Rubriken je Modul

**Einkommensteuer (9):** Vorbereitung · ELSTER-Anmeldeinformation ·
Datenuebernahme · Steuererklaerung · Pruefen und Abgeben · **Steuerbescheid** ·
**Einspruchs-Generator** · Kommunikation mit dem Finanzamt · Meine
Steuerdokumente

**Gewinnermittlung (15):** Voreinstellungen · ELSTER-Anmeldeinformation ·
Beginn der Datenbearbeitung · Detail-/Summenerfassung · Allgemeine Angaben zum
Unternehmen · Fahrzeuge · Einnahmen/Ausgaben · Umsatzsteuererklaerung ·
Umsatzsteuer-Voranmeldungen · **Gewerbesteuererklaerung** · Anmeldungen
versenden · Jahreserklaerungen abschliessen · Belege nachreichen ·
Kommunikation · Meine Steuerdokumente

**Gewinn-Erfassung (12):** wie oben, zusaetzlich **Lohnsteuer-Anmeldungen**,
ohne Gewerbesteuererklaerung und Detailerfassung

**Gesonderte Feststellung (11):** Feststellungserklaerung · ELSTER · Beginn ·
Allgemeine Angaben · Weitere allgemeine Angaben · **Beteiligte Personen** ·
Einkuenfte · Sonderausgaben · Ergaenzende Angaben · abschliessen · Meine
Steuerdokumente

**Lohnsteuer-Ermaessigung (14):** Antrag · ELSTER · Beginn · Angaben zum Antrag ·
Persoenliche Angaben · Weitere Angaben und Einkuenfte · Kinder · Allgemeine
Kosten · Werbungskosten · Sonderausgaben · und weitere

**Prognose (4):** Vorbereitung · Datenuebernahme · Steuerprognose · beenden

### Gemessener Befund: die Seitenflaeche laesst sich nicht aufzaehlen

Der naheliegende Wunsch, den vollstaendigen Seitenkatalog einfach auszulesen,
scheitert am Navigationsbaum. Gemessen am Einkommensteuer-Musterfall:

- Der Baum hat **neun** Eintraege. Fuenf davon bieten `ExpandCollapse` an, vier
  nicht.
- **`Expand()` meldet Erfolg und bewirkt nichts.** Fuenfzehn Runden mit je vier
  Aufklappversuchen, keine einzige Ausnahme - der Zustand bleibt `Collapsed`,
  die Zahl der Eintraege bleibt neun.
- **`SelectionItem.Select()` meldet ebenfalls Erfolg und navigiert nicht.** Ueber
  alle neun Rubriken hinweg blieb die Seitenueberschrift unveraendert.
- Die Hierarchie steckt ausserdem **nicht im UIA-Baum**: alle Eintraege sind
  Geschwister, die Ebene ist allein ueber die X-Koordinate kodiert (107 fuer die
  oberste Ebene, 127 fuer die zweite).

Das ist dieselbe Klasse von Befund, die der Worker fuer `goto` bereits
festhaelt: Die Qt-Elemente des Navigationsbaums bieten UIA-Muster an, die
zusagen und nichts tun. Deshalb navigiert `goto` ueber das Suchfeld und einen
echten Doppelklick.

**Konsequenz:** Die Seitenflaeche ist ohne physische Eingabe nicht aufzaehlbar.
Ein vollstaendiger Seitenkatalog entsteht nur, indem man jede Seite tatsaechlich
ansteuert und von Hand profiliert. Dass der Katalog neun Seiten hat, ist also
keine Nachlaessigkeit, sondern der Preis dieser Eigenschaft. Wer die Flaeche
erweitern will, plant pro Seite einen Navigations- und einen Profilierungslauf
ein - nicht einen Generator.

Der einzige billige Weg waere `GenerateNavtreeXML`, ein Kommando von SSE selbst,
das den Navigationsbaum als XML ausgibt. Es ist nur ueber den Herstellerweg
erreichbar, und der ist geschlossen.

## Achse 2: Funktionsgruppen

| Gruppe | Hersteller nennt | Bei uns |
| --- | --- | --- |
| **Eingabe Einkommensteuer** | alle Einkuenfte und Anlagen: nichtselbstaendige Arbeit, Renten, V+V, Kapitalertraege, Kinder, Unterhalt, Immobilien, Handwerker | **ein** Seitenobjekt. Generische Mechanik (`goto`, `page`, `read_page`, `table_read`) traegt ueberall, fokusloses Schreiben nur dort |
| **Selbstaendige** | EUeR, Summenerfassung, USt-Jahreserklaerung, UStVA, Dauerfristverlaengerung, Lohnsteuer-Anmeldung, Gewerbesteuer, Anlagenverzeichnis, Fahrzeugkosten | UStVA gut ausgebaut (fuenf Operationen), Anlagevermoegen und Fahrzeug profiliert. **Fehlen:** Gewerbesteuer, USt-Jahreserklaerung, Lohnsteuer-Anmeldung, Dauerfristverlaengerung |
| **Datenuebernahme und Import** | Vorjahr (auch aus MeinElster-Versandnachweis), VaSt-Abruf, Ehepartner B, Nebenkostenabrechnung, Gewinnermittlung nach Anlage G/S, Fremdformate SSX/QIF/CSV/SDI | **fast nichts.** VaSt existiert, ist live aber nur auf dem Fehlerpfad belegt |
| **Ausgabe** | Druckauswahl mit Filter, Belegempfehler, Checkliste, Druckvorschau, Formulardruck in amtliche Formulare, PDF, RTF, GoBD-CSV, neun Musterbrief-Typen | **genau eine** Entsprechung: `export_csv` (GoBD). Sonst nichts |
| **Pruefen** | Eingabepruefer, Steuerpruefer, Steuer-Spar-Tipps, Sparpotenzial | gut abgedeckt: `check`, sechs `checker_*`. Tipps-Fenster nur lesend. Sparpotenzial fehlt (vermutet: Teil des Ergebnisbereichs) |
| **Bescheid** | Bescheiddaten abholen, Steuerbescheidpruefung, Einspruchs-Generator | **nichts** – und das ist keine Absicht, siehe unten |
| **Belege** | BelegManager, verknuepfen, Belegempfehler, Checkliste | zehn Operationen, aber nur `receipt_manager_list` ohne sichtbaren Vordergrund. Entknuepfen fehlt |
| **Bedienung** | Zwischenablage, Undo/Redo, Erlaeuterung, Notiz, Mehrfachfenster, Optionen, Taschenrechner, Steuerrechner, Steuertabellen, Kalender | **nichts davon** |
| **Datensicherheit** | Passwortschutz, programmeigene Sicherungskopie, Wiederherstellungsdatei | Passwort fehlt. `backup_cases` arbeitet auf Dateiebene, die programmeigene Sicherung ist etwas anderes. Wiederherstellung bewusst nur als Rueckfrage, Antwort immer `Nein` |
| **Hilfe und Wissen** | kontextsensitive Hilfe, Steuer-Bibliothek, Ratgeberdatenbank, KI-Assistent „Alma" | `help` liest die Hilfespalte. Alles Uebrige fehlt |
| **ELSTER, Update, Lizenz** | Versand, Zertifikat, Versandservice, Online-Update, Freischaltcode, Fernwartung | **dauerhaft zu, mit Absicht.** Ausnahme: das Update-Angebot wird seit `updatePrompt` erkannt, aber nie ausgeloest |

## Was fehlt, nach Gewicht

1. **Vier vollstaendige Module.** Feststellung, Lohnsteuer-Ermaessigung,
   Prognose und konsolidierte Umsatzsteuer haben weder Profil noch Operation.
   Zusammen 25 gemessene Rubriken plus die nicht oeffenbare Fallart.
2. **Der gesamte Ausgabeweg.** Drucken, PDF, RTF, Formulardruck, neun
   Musterbrief-Typen. Einzige Ausnahme ist die GoBD-CSV.
3. **Fast die gesamte Einkommensteuer-Flaeche.** Ein katalogisiertes
   Seitenobjekt.
4. **Import und Datenuebernahme.** Der Jahreswechsel ist der Moment, in dem ein
   Benutzer am meisten Arbeit hat, und wir helfen dabei gar nicht.
5. **Steuerbescheidpruefung und Bescheiddatenabholung.** Zwei Rubriken stehen im
   gemessenen Navigationsbaum – `Steuerbescheid` und `Einspruchs-Generator` –
   und die Funktion ist **lesend**, faellt also nicht unter die
   ELSTER-Sperre. Sie stand bisher in keinem unserer Dokumente.
6. **Gewerbesteuererklaerung** als eigene Rubrik der Gewinnermittlung.

## Zwei Stolperfallen

**`scenario_run` ist nicht die Szenarienfunktion des Programms.** Unsere
Operation fuehrt ein Skript im Arbeitsbereich aus. Die Herstellerfunktion
„Alternative Berechnungen / Was waere wenn" ist etwas voellig anderes und bei
uns nicht abgedeckt. Wer nach dem Namen sucht, findet das Falsche.

**„Sicherungskopie erstellen" ist nicht `backup_cases`.** Unsere Operation
kopiert und hasht auf Dateiebene. Das Programm hat einen eigenen Sicherungsweg
mit eigenem Format.

## Wenn das jemand angeht

Die Handbuchbasis ist Jahrgang 2023. Bevor daraus Arbeitspakete werden, sollte
jemand das im Programm liegende Handbuch fuer das Steuerjahr 2025 heranziehen
(Menue `?` → Anleitung). Und die vier fehlenden Module brauchen zuerst je einen
gemessenen Navigationsbaum mit aufgeklappten Unterseiten – der hier gemessene
Baum ist die oberste Ebene, nicht die Seitenliste.
