# API-/MCP-Vertrag

## Inhalt

- [Rollen](#rollen)
- [Werkzeugwahl: Hauptweg, Fallback und Diagnose](#werkzeugwahl-hauptweg-fallback-und-diagnose)
- [Gezielt lesen und geprüft ändern](#gezielt-lesen-und-geprüft-ändern)
- [Feldwerte mit explizitem Namensraum lesen](#feldwerte-mit-explizitem-namensraum-lesen)
- [Tabellen ohne Fokuswechsel lesen](#tabellen-ohne-fokuswechsel-lesen)
- [Bekanntes Hilfsfenster vor Tabellenbindung schließen](#bekanntes-hilfsfenster-vor-tabellenbindung-schließen)
- [Erreichbarkeit und Browser-Schutz](#erreichbarkeit-und-browser-schutz)
- [HTTP-Hüllen](#http-hüllen)
- [Startbereitschaft](#startbereitschaft)
- [UIA-Startlesefehler bei der Fallanlage](#uia-startlesefehler-bei-der-fallanlage)
- [Zielbereitschaft nach Suchschluss](#zielbereitschaft-nach-suchschluss)
- [Optionale Wiederholung bei belegter API](#optionale-wiederholung-bei-belegter-api)
- [Dauerhaftes CLI-Journal](#dauerhaftes-cli-journal)
- [MCP-Abbildung](#mcp-abbildung)
- [Aliase und Kompositionen](#aliase-und-kompositionen)
- [Queue, Abbruch und Timeout](#queue-abbruch-und-timeout)
- [Ergebnisgrenze und Evidenz](#ergebnisgrenze-und-evidenz)

## Rollen

Für die optionale dauerhafte Qt-Anbindung der in der [Native-Matrix](NATIVE-COVERAGE.md)
als **Qt optional** geführten Operationen gilt zusätzlich der
[native Paket- und Laufzeitvertrag](NATIVE-QT.md).
Dasselbe optionale Paket übernimmt `desktop_status` und `desktop_start` direkt
über Win32. Die Startoperation behält Ressourcenauflösung und Eigentumsprüfung;
ein verlorener Antwortweg wird als unbekannter Ausgang ohne Wiederholung behandelt.
`desktop_stop` nutzt Win32 und begrenztes COM-UIA im externen nativen Helfer.
Speichern bleibt hashgebunden separat; Verwerfen benötigt `discardChanges: true`.
Unsichere Dialoge und verlorene Ergebnisse lösen keinen Wiederholungsversuch aus.

`save` bindet den Schalter über seine eindeutige Hauptsymbolleisten-ID, auch
wenn die Oberfläche nur ein Symbol ohne zugänglichen Namen zeigt. Typ,
RuntimeId und Aktivierungszustand werden vor dem Speichern frisch geprüft;
der Abschluss benötigt weiterhin Datei-, Hash- und Zustandsnachweise.
Beim normalen `close` bleibt eine fehlende, mehrdeutige oder unlesbare
Speicheranzeige unbekannt und sperrt das Schließen ohne explizites Verwerfen.

Die lokale HTTP-API ist der ausführende Kern. Sie besitzt Konfiguration,
Ressourcenauflösung, Queue, Szenarien und den Windows-Worker. MCP ist ein
PC-blinder fachlicher Adapter: Er ruft für ein Werkzeug genau die zugeordnete
API-Operation oder eine dokumentierte API-Komposition auf. Nur sein Supervisor
kennt Loopback-URL, optionale absolute `SSE_API_CONFIG` und die eigene exakte
API-Dependency. Für die Identitätsprüfung liest er aus der begrenzten
Konfigurationsdatei auch die Ressourcenpfade und hasht sie; Inhalte aus
Steuerfällen, Belegen oder Arbeitsbereichen liest er nicht und gibt die Pfade
nicht über MCP aus.

Nach einem freigegebenen eigenen API-Start prüft der Supervisor die Bereitschaft
höchstens 15 Sekunden lang. Kurze lokale Health-Timeouts dürfen innerhalb dieses
Budgets erneut gelesen werden; das wiederholt ausschließlich Health-GETs.
Ein nicht rechtzeitig antwortender Endpunkt vor dem Start erlaubt
keinen zweiten API-Prozess. Versions- oder Konfigurationsabweichungen brechen
sofort ab. Gleichzeitige Erststarts dürfen den verifizierten gemeinsamen
API-Prozess verwenden; bei einem ausdrücklichen Neustart muss die Antwort
von der gerade gestarteten PID stammen. Ein Scheitern der Startprüfung
startet keine weitere API und beendet keinen fremden Prozess.

Beim regulären `close` bleibt die Endeprüfung an den verifizierten
Prozesshandle gebunden. Ein nach dem Schließbefehl erscheinender eigener
Dialog liefert `dialog-open`, `closeRequested=true`, `stillRunning=true`
und dessen Fingerprint. Der Befehl wurde bereits gesendet; zuerst
`sse_dialog_list` frisch lesen und die Frage ausdrücklich mit
`sse_dialog_answer` beantworten. Ohne ausdrückliches Verwerfen beantwortet
`close` keine neue Rückfrage. Der normale Wartepfad beendet den Prozess
nicht hart. Ein Fehler der zusätzlichen Dialoglese wird ausschließlich als
Typ unter `dialogInspectionError` mit der Ursache unter
`dialogInspectionKind` gemeldet; ein leeres Dialogfeld beweist
in diesem Fall keine vollständig gelesene Dialogfreiheit.
Bereits erkannte Dialoge bleiben auch bei einer fehlerhaften Punktlese
sichtbar. Unvollständige Punktinventare erhalten keinen Antwort-Fingerprint;
die Frage muss zuerst vollständig neu gelesen werden. Bekannt nicht
antwortende Fenster werden im Schließpfad nicht tief abgefragt.
Nach einer Dialogantwort werden nur neue Fenster der gebundenen Instanz
tief gelesen. Ist deren Zustand nicht vollständig lesbar, nennt die
Fehlerantwort die bereits ausgeführte Antwort und meldet
`newDialogsComplete=false`. Das erlaubt keine Wiederholung der Antwort;
zuerst den aktuellen eigenen Fensterzustand prüfen.

`positions` bestätigt einen leeren Bestand nur auf einer vollständig gelesenen
Positionenübersicht „Erlöse Lieferungen/Leistungen“ oder „Betriebsausgaben:
Eigene Positionen“. Überschrift, sichtbare Zeilenaktionen, eindeutige Namen,
zugeordnete Beträge und Erfassungsbefehl müssen zusammenpassen. Eine noch nicht
aufgebaute Seite oder ein unvollständiger Eintrag mit „»…« erfassen“ liefert
`position-inventory-incomplete`. Das gilt auch für einen Löschverweis ohne
passenden Bearbeiten-Verweis und doppelte Namen. Ein abgeschlossener roher
Baumdurchlauf allein beweist keine fachliche Seitenbereitschaft.

Dieselbe Bestandsprüfung schützt `position_create` vor dem ersten Klick.
Ein vorhandener Teilbestand wird nicht durch eine weitere Anlage verdeckt.
Nach einem tatsächlich begonnenen, unterbrochenen Schreibschritt bleiben
`mutationStarted` und `cleanupRequired` maßgeblich: zuerst den eigenen Zustand
frisch prüfen und gezielt entscheiden, wie der Teilstand behandelt wird.
Das Werkzeug ergänzt oder löscht keine Position automatisch.

Die normativen Laufzeitquellen sind:

- `GET /v1/operations` und `GET /v1/operations/{operation}` für
  Argument- und Ergebnisverträge, Traits, Grenzen und Sicherheitsplanung;
- `GET /v1/openapi.json` für dieselben HTTP-Verträge als OpenAPI 3.1;
- der MCP-Werkzeugkatalog für strikte agententaugliche Eingaben.

Handgepflegte Operationszahlen in Prosa sind nicht normativ.

## Werkzeugwahl: Hauptweg, Fallback und Diagnose

Der MCP-Katalog und der Skill unterscheiden bevorzugte strukturierte Wege,
Kompatibilitäts-/UI-Fallbacks und Diagnose. Die Gruppierung beschreibt die
Werkzeugwahl; sie entfernt keine bestehende Operation und startet keinen
automatischen Methoden- oder Backendwechsel.

| Gruppe | Auswahlregel |
| --- | --- |
| Hauptweg | Passende Fachoperation zuerst: Seiten-/Tabellenleser, gebundene Feldänderung, `table_add`/`table_update`/`table_delete`, profilierte Navigation und UStVA-Werkzeuge. `snapshot`, `find` und `get_value` bleiben geeignete Leser für gezielte Zustands- und Identitätsprüfungen. |
| Kompatibilität/UI-Fallback | `read_table` für einen ausdrücklich benötigten Sichtbestand, `table_read` mit ausdrücklich gewähltem `noKeys: false` sowie generische Klick-, Baum-, Scroll- und Menüwege nur bei fehlendem geeignetem Hauptweg oder frisch belegtem UIA-Positionierungsbedarf. `set_value` bleibt auf das globale steuerneutrale Suchfeld begrenzt. |
| Diagnose | `screenshot`, `snapshot_compare` und `accessibility_probe` gezielt zur Fehlersuche; keine Schreibbestätigung allein aus einem Bild oder einer Diagnose ableiten. |

Ein generisches Werkzeug ist nicht pauschal veraltet: Die exakt gebundene
RadioButton-Auswahl über `click` mit `pattern: "select"` bleibt beispielsweise
der unterstützte Weg, wenn keine passende Fachoperation existiert. Die
jeweiligen Sicherheits- und Ergebnisverträge gelten in jeder Gruppe.

Ein Fehler ist kein Anlass, weitere Methoden durchzuprobieren.
Mehrdeutigkeit, veraltete Zielbindung, Hashabweichung, unerwarteter Dialog,
Fremdeingabe, Recovery-Zustand, Transportfehler, ungewisser Mutationsausgang
oder fehlgeschlagener Readback verlangen Stopp und Zustandsklärung. Ein neuer
Versuch braucht frische passende Nachweise. RuntimeIds dürfen nicht entfernt
und Selektornamensräume nicht gewechselt werden, um einen Fehler zu umgehen.
Die ausdrücklich dokumentierten internen API-Kompatibilitätspfade bleiben
auf ihre jeweiligen Voraussetzungen begrenzt.

## Gezielt lesen und geprüft ändern

Die API bietet gezielte Zustandsabfragen und darauf aufbauende, stärker
abgesicherte Änderungen. Ein kurzer Aufrufname bedeutet keinen ungeprüften
Direktzugriff auf Steuerdaten.

| Aufgabe | Passender Vertrag |
| --- | --- |
| Einzelwert oder Element untersuchen | `get_value`, `find` und `snapshot` liefern den gebundenen Zustand; der Selektornamensraum bestimmt den Lesepfad. |
| Eine Seite oder Tabelle lesen | Seitenleser und `table_read` liefern strukturierte Daten mit dem jeweiligen Vollständigkeitsvertrag. |
| Ein Feld kontrolliert ändern | `tracked_set_value`, über MCP `sse_change_field` oder kataloggebunden `sse_change_known_field`: Ziel und Seite binden, Vorwert lesen und prüfen, schreiben, Commit ausführen und zurücklesen. Je nach Auftrag kommen Summen- oder Ergebnisprüfungen hinzu. |
| Mehrere Felder derselben Seite ändern | `fill_fields` plant eine begrenzte Folge katalogisierter Feldänderungen und führt sie gemeinsam in einem Worker aus. |
| Tabellenzeilen ändern | `table_add`, `table_update` und `table_delete` verwenden ihre eigenen Ziel-, Vorbedingungs- und Readback-Verträge. |

`set_value` ist auf das globale steuerneutrale Suchfeld begrenzt. Für fachliche
Feldänderungen gilt der geprüfte Änderungsweg; ein ähnlicher Name oder eine
passende Bildschirmposition ersetzt keine frische Zielbindung.

Feldänderungen brauchen auch für einen leeren Sollwert einen frischen
`ValuePattern`-Readback. Ohne Formatvertrag oder mit `valueKind: "text"`
bleiben Groß-/Kleinschreibung und Leerzeichen maßgeblich. Die ausdrücklich
gewählten Verträge `currency` und `date` behalten ihren Formatabgleich.
Dieser Vertrag gilt auch für die Vorwertprüfung im eigentlichen Commit und
erneut nach der Fokusvorbereitung, unmittelbar vor der Wertänderung. Das gilt
für UIA-Fokus, den geprüften Klickpfad und fokusloses `SetValue`. Ein unbekannter
Vorwert wird vor dieser Prüfung nicht in einen leeren Text umgewandelt.
Bei DataItems bleiben der erfasste Rohwert, der erfasste Name und die fachliche
Vorbedingung nach dem gewählten Formatvertrag bis zu dieser Grenze gebunden. Dadurch kann auch ein leerer
Rohwert keine zwischenzeitlich geänderte Anzeige verdecken. Eine reine
Wertabweichung meldet einen Epochenverlust, ohne Fremdeingabe zu behaupten.
Währungswerte werden zuerst als Zahlen gelesen: `1,000` und `1.000` haben
unterschiedliche Werte. Lässt sich eine Währungsdarstellung nicht lesen,
bestätigt nur ein exakt gleicher Text den Vergleich.
Ein fehlender oder `null` liefernder Wertzugriff bestätigt weder Erfolg noch
einen unveränderten Ausgang. Nach einer Rücknahme werden der Rohwert nach dem
bestehenden Wertvertrag, der daraus abgeleitete Anzeigewert und der
unveränderte UIA-Name getrennt geprüft. Ein leeres UIA-Namensfeld eines
Edit-Elements wird dabei nicht mit seinem vorhandenen Rohwert verwechselt.
Bei Edit-Feldern ist der lesbare Rohwert maßgeblich; ihr UIA-Name kann eine
Beschriftung sein. Ein leerer Name bestätigt deshalb weder das Leeren noch
die Eigentümerschaft eines abweichenden Rohwertes vor der Rücknahme.
DataItem-Zellen können ihren tatsächlichen formatierten Wert dagegen über
den Namen liefern; ein leerer Raw-Platzhalter verdeckt diese Anzeige nicht.
Der vollständige Name wird am lebenden Element gelesen; die für Baumansichten
vereinheitlichte Darstellung ersetzt ihn nicht. Fehlende Namen bleiben
unbekannt. Bestätigt bei einer DataItem-Zelle nur der Name die fachliche
Vorbedingung, verwenden beide Rücknahmepfade diesen ursprünglichen Namen als
Texteingabe. Ein solcher Raw-Platzhalter bleibt außerhalb dieser Texteingabe.
Der anschließende Nachweis verlangt weiterhin den ursprünglichen Rohwert und
Namen; eine bloß passende Anzeige bestätigt keine vollständige Rücknahme.
Ein lesbarer Zahlen- oder Datumsrohwert darf nicht durch einen widersprechenden
Anzeigenamen überstimmt werden. Auch ein ausdrücklich widersprechendes Jahr
im Rohwert oder Anzeigenamen darf nicht durch eine Anzeige ohne Jahr überstimmt werden.
Auch bei einer Vorgabe ohne Jahr müssen ausdrücklich gelesene Jahre in
Rohwert und Anzeige zueinander passen, einschließlich früher erfasster Jahre.
Ein Wechsel des Jahres zwischen Raw und Name darf keinen Widerspruch verbergen.
Enthalten Vorgabe und erfasste Darstellung kein Jahr, darf ein einzelnes Jahr
erstmals sichtbar werden. Das bestätigt keinen zuvor unsichtbaren Jahreswert;
ein ausdrücklich vorgegebenes Jahr bleibt dagegen Teil der Vorbedingung.
Eine passive Störungsprobe liest den
Anzeigenamen am lebenden Element erneut, auch beim allgemeinen Feldzugriff.
Ein fehlender Name bestätigt dabei keinen unveränderten leeren Wert.
Der Datumsvergleich trennt Tag und Monat; eine Zahlengleichheit wie `10.10`
und `10.1` ist keine Datumsgleichheit.
Fehlende Nachweise können als Bindungs-/Interferenzfehler enden; sie erlauben
keine zusätzliche Eingabe allein zur Bestätigung.

Bei der Unicode-Texteingabe des Feldcommits bleibt die nach der eigenen Auswahl geprüfte
Eingabemarke bis zum ersten Textblock erhalten. Nach dem letzten Textblock
wird dessen Marke bis zur Eingabeprüfung vor TAB weitergereicht. Ein interner
Helferwechsel ohne eigene Eingabe darf keine neue Ausgangsmarke setzen.
Eine dabei beobachtete abweichende Marke stoppt den Ablauf vor weiterer
Texteingabe beziehungsweise vor TAB; eine bereits begonnene Wertänderung
bleibt im Ergebnis erkennbar. Das ist kein lückenloser Nachweis aller
Fremdeingaben zwischen eigener Eingabe und anschließender Markenerfassung.

Bei der sichtbaren Tastatureingabe nicht-ASCII-haltiger Werte in Textfeldern
vom Typ `Edit` hält
`commitDetails.textBeforeCommitVerified`
fest, ob der unmittelbar vor TAB frisch gelesene Rohtext exakt der Eingabe
entsprach: `true` bei zeichengenauer Übereinstimmung, `false` bei Abweichung, `null`
ohne erfassten lesbaren Nachweis. Diese Diagnose schränkt die akzeptierte Eingabe
nicht ein; reine ASCII-Eingaben benötigen dafür keine zusätzliche Lesung.
Die zusätzliche Lesung übernimmt keine neue Eingabemarke; eine dabei erkannte
Fremdeingabe verhindert TAB.
Wurden anschließend bei gleicher UTF-16-Länge ausschließlich nicht-ASCII-Zeichen
durch U+003F ersetzt, beschreibt `commitDetails.characterSubstitution` dieses
beobachtete Muster. Es nennt keinen vermuteten Codec und bestätigt weder
Eigentum am Nachwert noch die Zulässigkeit einer Rücknahme oder Wiederholung.
Ein unlesbarer Nachwert bleibt `null` und bestätigt auch keinen leeren Modellwert.
Scheitert die Vorprüfung einer Rücknahme an unbewiesener Bindung oder einem
nicht bestätigten eigenen Wert, meldet sie ausdrücklich `resultingState="unknown"`,
`cleanupRequired=true` und `retryable=false`; der Zustand muss neu abgeglichen werden.
Ein abgeschlossener Tastaturpfad bestätigt für sich allein keinen fachlichen
Nachwert; dafür bleiben die unabhängigen Prüfungen des Feldkommandos maßgeblich.

`feld.nachherAnzeige` bleibt der tatsächliche UIA-Name. `rollback.wert`
bezeichnet dagegen wie der Ausgangswert den Rohwert des Edit-Feldes,
bei DataItems den vorhandenen Rohwert oder sonst ihren Anzeigennamen.
Bei einem fehlenden Rücknahme-Read bleiben `rollback.rawWert` und
`rollback.wert` unbekannt; ein alter Nachwert ersetzt diese Probe nicht.
Datumsfelder mit leerem Rohwert müssen weiterhin ihren tatsächlichen
Wiederherstellungsnachweis liefern. Eine leere Rücknahme-Eingabe beweist keine
erneut sichtbare Datumsanzeige.
Eine unlesbare physische Eingabemarke oder eine frische Beobachtung aus einem
unbekannt fehlgeschlagenen Commit erlaubt keine automatische Rücknahme.

`fill_fields` akzeptiert ein bis zwanzig eindeutige Felder einer bereits
geöffneten katalogisierten Seite. Der vollständige Plan wird vor der ersten
Änderung geprüft. Beim ersten Fehler endet die Vorwärtsausführung; bereits
abgeschlossene eigene Schritte werden bestmöglich in umgekehrter Reihenfolge
zurückgesetzt. Soweit der Worker regulär abschließen kann, beschreibt ein
abschließendes `known_page_state` den erreichten Seitenzustand. Bei Timeout,
Abbruch oder Transportverlust kann dieser Abschlussread fehlen:
`finalReadback: null`, `finalReadbackVerified: false` und
`resultingState: "unknown"` verlangen einen neuen Zustandsabgleich.
Das ist keine ACID-Transaktion und keine Garantie, dass jeder Teilstand
zurückgenommen werden kann.

Auf dem sichtbaren Desktop behält der Plan seine eigene Eingabemarke über
Vorwärts- und Rücknahmeschritte hinweg. Ein verifizierter eigener Feldcommit
oder eine bestätigte eigene Werte-Info-Vorbereitung reicht ihre Marke weiter;
spätere Lesungen setzen sie nicht zurück. Auch die innere Rücknahme eines
Kindes aktualisiert diese gemeinsame Marke. Eine lesbare Null ist gültig,
eine fehlende Marke bleibt unbekannt. Bei einer Abweichung beginnt kein
weiterer Kindschritt. Der Feldcommit prüft die übernommene Marke erneut vor
der Fokusübernahme und vor der Eingabe. Auch eine Abweichung beim passiven
Abschlusslesen verhindert einen verifizierten Erfolg. Der getrennte
fokusfreie Desktop-Pfad benötigt keine Marke des sichtbaren Desktops.
Ein unbewiesener Teilcommit darf keine neue eigene Marke begründen;
der Plan kann deshalb ohne automatische Rücknahme als `unknown` enden.
Der Plan bindet auch den vorbereitenden Invoke der Werte-Info an das frische
Fenster, den Prozess, den Knopf und die geerbte Eingabemarke. Unmittelbar nach
dem Aufruf erfasst er einen lokalen Markenkandidaten. Erst ein eindeutig
bestätigtes eigenes Fenster und die weiterhin gleiche Kandidatenmarke
erlauben ihre Übernahme. Spätere Bereitschaftslesungen liefern keine neue
Ausgangsmarke. Nach einem begonnenen, ungewissen Invoke folgt kein weiterer Klick.
Ist kein Invoke verfügbar und noch keine Aktion gestartet, bleibt der
vorhandene Klickweg mit Vordergrund-, Runtime-ID- und Eingabeprüfung nutzbar.

Der gesamte Invoke-Aufruf beim Provider bleibt dabei eine Grenze der
Eingabezuordnung. Dieses Zeitfenster kann größer als bei einem einzelnen
nativen Sendeaufruf sein; Markengleichheit beweist keine Ereignisherkunft.
Die Dauer hängt von der [Provider-Implementierung](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.invokepattern.invoke)
ab. Die Werte-Info-Evidenz nennt unter anderem Ausgangsmarke, Kandidat,
Invoke-Dauer sowie Vordergrund und Cursor vor und nach dem Aufruf.

Fremdeingaben, geänderte Bindungen und unbekannte Schreibausgänge verlangen
Zustandsklärung. Meldet ein Kindschritt einen solchen Kontextverlust, beginnt
der Bulk-Plan keine weiteren Rücknahmen. Auch eine bereits laufende
Rollback-Kette endet beim ersten fehlgeschlagenen oder unbewiesenen Ergebnis.
`rollback.skippedReason` nennt den Abbruchgrund. Der abschließende passive
Readback bleibt erhalten; selbst ursprüngliche sichtbare Werte heben einen
erkannten Kontextverlust nicht auf. Der Ausgang bleibt dann `unknown` und
abgleichpflichtig. Auch ein unbewiesenes Vorwärtsergebnis erlaubt keine
Fortsetzung. Nur bekannte gewöhnliche Vor-/Nachbedingungs- und Feldfehler
lassen eine weitere abgesicherte Rücknahme zu. Bei bereits erledigten Schritten
führt eine unbekannte Fehlerart deshalb ebenfalls zum Abgleich; eine bekannte klare
Ablehnung vor dem ersten geänderten Feld behält dagegen ihre ursprüngliche
Fehlerart, soweit der Readback den unveränderten Stand bestätigt und die
Eingabemarke erhalten bleibt. Eine dazwischen erkannte Fremdeingabe verlangt
auch bei gleichen Ausgangswerten einen neuen Zustandsabgleich. Leere oder
unbekannte erste Fehler bleiben ungewiss. Ein Nachbedingungsfehler erlaubt
Fortsetzung nur nach bestätigter eigener Rücknahme des fehlgeschlagenen Kindes.
Auch unerwartete Workerfehler mit strukturierter Fehlerantwort bleiben nach
dem Planaufruf `unknown`; sie erfinden weder einen Abschlussreadback noch
einen unveränderten Zustand und erlauben keine Wiederholung.
Ohne Teilergebnisse ist auch kein einzelner Schritt als `skipped` belegt.
`failed-action-lost-context` bezeichnet die verweigerte Rücknahme nach einem
Kindfehler, `rollback-lost-context` den Abbruch einer Rücknahmekette.
Scheitert der vorbereitende Werte-Info-Klick nach Beginn der Eingabe, bleibt
sein Öffnungszustand unbekannt. Das Kind meldet Interferenz und erforderlichen
Abgleich; der Plan wiederholt den Klick nicht und schließt kein unbewiesenes Fenster.
Dasselbe gilt für eine nach der Aktion verspätete, mehrdeutige oder unbewiesene
Öffnung. Eine klar vor Dispatch verweigerte Vorbereitung bei erhaltener Marke
behält dagegen ihren Vorbedingungsfehler und den bekannten ungeöffneten Zustand.
Eine weiterhin gebundene gewöhnliche Rücknahme bleibt dann möglich.
Auch eine Rücknahme darf fremde Änderungen nicht überschreiben.
Keine dieser Operationen speichert den Fall automatisch. Speichern benötigt
einen eigenen ausdrücklichen Auftrag. Eine erneute Änderung ist kein allgemeiner
Fehlerbehandler; die enge [Busy-Wiederholung](#optionale-wiederholung-bei-belegter-api)
betrifft nur vor der Ausführung abgelehnte API-Anfragen.

## Feldwerte mit explizitem Namensraum lesen

`get_value` beziehungsweise `sse_get_value` akzeptiert optional
`selectorNamespace: "uia" | "qt-object"`. Der Namensraum bestimmt den
Lesepfad vor dem ersten Backendaufruf; ein Fehler löst keinen Wechsel aus.

| Namensraum | Auswahl und Ausführung |
| --- | --- |
| `uia` | Bestehender UIA-Worker, auch bei konfiguriertem Qt-Backend. `aid` ist eine AutomationId oder ein eindeutiges Endstück, `rid` eine UIA-Referenz der Familie `42.`. |
| `qt-object` | Konfiguriertes Qt-Backend; `aid` muss der vollständige beobachtete QObject-`objectName` sein oder `rid` eine frische `qt:`-Referenz. Weitere Selektoren müssen dasselbe Objekt einschränken. |
| Feld fehlt | Bisheriges Routing: Mit Qt-Backend führt eine `42.`-RID zum frischen nativen Accessibility-Snapshot, jeder andere Selektor zur QObject-Wertprojektion. Ohne Qt-Backend bleibt der UIA-Worker zuständig. |

Punkte in Namen ändern das Legacy-Routing nicht. Die bisherigen
QObject-Suffix-/Präfixaliase bleiben ohne expliziten Namensraum kompatibel;
sie beweisen keinen vollständigen Elternpfad. Im expliziten `qt-object`-Pfad
werden solche Aliase und erfundene Elternpräfixe nicht als Objektidentität
akzeptiert. Fehlendes Qt-Backend und widersprüchliche RID-Familien scheitern
mit `bad-args` vor Provider-Dispatch.

Das Ergebnisformat bleibt unverändert. Im QObject-Ergebnis bezeichnet
`node.aid` den `objectName` und `node.rid` die `qt:`-Referenz. Beides ist keine
UIA-Schreibidentität. Ein Caller darf die RID nicht entfernen, um über einen
ähnlichen Namen ein anderes Schreibziel zu wählen. Für UIA-Schreiboperationen
sind frisch gelesene UIA-Selektoren nötig. Beschriftungen werden vom jeweiligen
Lesepfad aufgelöst; eine allgemeine Gleichheit der QObject- und
UIA-Labelzuordnung oder des Schreibziels ist nicht zugesagt.
`aufgeloestUeber` beschreibt die tatsächlich verwendete Zuordnung.

Der Getter liefert Textwerte. Checkboxzustände kommen typisiert aus dem
Snapshot und werden mit `toggle` geändert; Combos verwenden `combo_select`.
Die genaue native Identitätsgrenze steht in [NATIVE-QT.md](NATIVE-QT.md).

## Tabellen ohne Fokuswechsel lesen

Der bevorzugte MCP-Lesepfad ist `sse_table_read` ohne aktive
Cursorbewegung. Bei fehlendem `noKeys` ergänzt nur der MCP-Adapter
`noKeys: true`; eine ausdrückliche Angabe von `false` bleibt erhalten. Die
Defaults der direkten HTTP-API und CLI ändern sich dadurch nicht.

Mit konfiguriertem und verifiziertem Qt-Backend liest `table_read` im
Standardlesemodus mit `noKeys: true` das Modell passiv. Ohne dieses Backend
liefert gewöhnliches UIA damit nur sichtbare Zeilen. Für ein vollständiges
passives UIA-Inventar ist ausdrücklich `readMode: "grid"` zu wählen.
`vollstaendig`, `limitReached` und die Zeilenidentität sind in jedem Fall zu
prüfen; sichtbare Zeilen allein beweisen keinen vollständigen Bestand.

Im nativen Änderungsweg benötigen `table_add`, `table_update` und
`table_delete` keinen vorherigen vollständigen Cursorlauf; sie prüfen ihre
Bindung und ihren Vorwert selbst und positionieren die gebundene Zielzeile
direkt. Ein passiver Modell- oder Gridread erteilt keine Schreibberechtigung.

Bei gleichen Zeilentexten benötigen native `table_update`- und
`table_delete`-Aufrufe zusätzlich `targetRid` aus einer frischen sichtbaren
Zielzelle. Eine einmalige passive Abfrage ordnet diese Runtime-ID über das
tatsächliche GridItem der Modellzeile und -spalte zu. Danach bleiben der
vollständige Zeilenabgleich und ein frischer Nachweis des gesamten Modells
vor der ersten Positionierung erforderlich. Fehlende, leere oder veraltete
IDs sowie nicht passende Koordinaten führen vor einer Aktion zum Abbruch.
Auch vollständig gleiche sichtbare Zeilen erhalten keine Freigabe. Die
zusätzliche Zuordnung wird nur bei mehrdeutigem Text ausgeführt.

Vor der Lösch-Tastenkombination wird die aktuelle Auswahl erneut gelesen.
Sie muss ausschließlich eindeutige Zellen der vollständig geprüften
Modellzeile einschließlich der Zielzelle enthalten. Die frische Zielzelle,
alle ausgewählten GridItems und die zuvor gebundene Zeile müssen auch in
der sichtbaren Zeilenlage übereinstimmen. Auch der aktuelle Tastaturfokus muss
zu einer bewiesenen Zelle derselben Modellzeile gehören. Meldet Qt die Tabelle
als fokussiert, muss deren genaue Identität stimmen und genau eine frisch
gelesene Zelle der geprüften Zeile den Tastaturfokus bestätigen.
Ein fokussierter Editor bleibt gesperrt, auch wenn die zugehörige Datenzelle
zusätzlich einen Fokushinweis meldet. Der native Pfad verwendet den bereits
geprüften Tabellenfokus und klickt die ausgewählte Zelle nicht erneut an.
Ein verlorener Nachweis erlaubt keinen weiteren Klick oder Schreibversuch.

Nach einem nativen Löschen beweist erst der vollständige Modellvergleich,
dass genau die Zielzeile fehlt und alle anderen Zeilen unverändert sind.
Ein verbliebener gleicher Zeilentext gilt deshalb nicht als fehlgeschlagenes
Löschen und löst kein automatisches Rückgängigmachen aus. Auch Summe,
Tabellenstruktur und abschließende Eingabe-Epoche müssen stimmen, bevor
`verified: true` gemeldet wird. Ein fehlender Nachweis verlangt einen frischen
Zustandsabgleich; die Löschung wird nicht automatisch wiederholt.
Bei einer Störung nach dem Löschbefehl bleiben Löschung und Zielpräsenz
ungewiss; `outcomeUnknown` und `reconciliationRequired` verlangen Klärung.
Ein anderer gleicher Zeilentext wird dabei nicht als verbliebenes Ziel gemeldet.

Im nichtnativen UIA-Pfad benötigen `table_update` und `table_delete` eine
bereits sichtbare Zielzeile und führen keinen eigenen Zeilensuchlauf aus.
Ein vollständiger Gridread beweist die Daten, aber keine Sichtbarkeit oder
Materialisierung der Schreibzelle. `table_add` besitzt weiterhin seinen
eigenen einmaligen bewachten Suchlauf. Ziel und Sichtbarkeit sind vor einer
bewusst gewählten UIA-Vorbereitung frisch zu lesen.

Die UIA-Löschung bindet die frische Ziel-Runtime-ID an die tatsächliche
Gridzeile und -spalte. Vor und nach der Aktivierung sowie vor dem Löschbefehl
müssen alle ausgelesenen Modellwerte gleich bleiben, einschließlich
verborgener Spalten und Checkboxzustände. Gleicher Text in einer anderen
Zeile verhindert einen Erfolg nicht; vollständig ununterscheidbare
Modellzeilen werden vor einer Aktion abgewiesen. Ein Klick ist nur auf eine
sichtbare Textzelle mit geprüftem tatsächlichem Treffer zulässig.

Qt kann durch einen eigenen Klick oder Löschbefehl einen Zelleditor öffnen,
den der abwärts gelesene UIA-Baum nicht enthält. Deshalb wird zusätzlich die
Elternkette des tatsächlich fokussierten Elements geprüft. Nur ein neu
entstandener, genau gebundener Editor mit unverändertem Zellwert darf einmal
gezielt abgebrochen werden; unbekannte Editoren bleiben erhalten. Danach
werden Modell, Summe, Änderungsmarkierung und Tabellenfokus erneut geprüft.

Nach dem einzigen Löschbefehl müssen genau die Zielzeile fehlen und alle
übrigen ausgelesenen Zeilen, die Struktur und die erwartete Summe stimmen.
Eine unveränderte Summe genügt auch bei Nullbeträgen nicht. Wurde bis zum
Ende der begrenzten Beobachtung keine Entfernung gesehen, ist die
Verarbeitung des Tastaturbefehls nicht quittiert: Der Ausgang bleibt
ungewiss, ohne Undo einer älteren Aktion und ohne automatische Wiederholung.
Nur eine vollständig nachgewiesene eigene Einzelentfernung mit falscher
erwarteter Nachsumme kann bei unverändertem Eingabe-/Fensterkontext und
erneut bewiesenem Tabellenfokus genau ein Undo erlauben. `rolledBack: true`
verlangt die ursprünglichen ausgelesenen Werte und Summe. Die Markierung wird
mit `ungespeichertVorher`, `ungespeichertNachher` und `dirtyStateUnchanged`
getrennt angegeben. Sie darf unverändert bleiben oder weiterhin gesetzt sein,
wenn sie erst durch die eigene Löschung gesetzt wurde. Ein unerklärtes
Setzen oder das Löschen einer schon vorher gesetzten Markierung bleibt
ungewiss. Die API setzt diese Markierung nicht zurück und speichert nicht
automatisch. Vor dem Löschbefehl wird innerhalb der internen Beobachtungsfrist
anhand der bisherigen Lesezeiten eine Reserve für Nachlesen und gegebenenfalls
ein Undo geprüft. Für einzelne Raw-Läufe muss ebenfalls Zeitreserve bleiben;
fehlt sie, beginnt keine Löschung. Spätere Providerfehler, längere Aufrufe
oder ein früherer Auftragsabbruch können trotzdem einen ungewissen Ausgang
verlangen. Die Reserve ist keine Laufzeitgarantie.
Dies beweist beobachtete Konsistenz, keine atomare Änderung und keine
Wiederherstellung verborgener interner Datensatz- oder Belegidentitäten.

`table_read` mit `readMode: "grid"` wählt vor Beginn den reinen UIA-Gridpfad,
auch wenn die optionale native Qt-Anbindung konfiguriert ist. Er bindet genau
eine Tabelle über Fenster, Prozess, RuntimeId, AutomationId und Spaltenheader.
`sumLabel` und `sumOccurrence` wählen bei mehreren Tabellen die Summenregion.
Es gibt keinen nachgeschalteten Cursor- oder Backendversuch bei einem Fehler.
`noKeys: false` kann mit diesem Modus nicht kombiniert werden.

Der Leser prüft jede bereitgestellte Gridkoordinate und liest zweimal.
Gleiche Beobachtungen sowie unveränderte Fenster-, Eingabe- und Tabellenbindung
belegen beobachtete Konsistenz, keinen atomaren Snapshot und keine
Schreibberechtigung. `gridRead.atomic` ist deshalb `false`. Ein UIA-Fehler
beendet den Worker; er führt danach keine weitere Provideraktion aus.
Fremde Eingabe oder ein Vordergrundwechsel beendet die Beobachtung ebenfalls.
Die Enumeration hat eine gemeinsame Grenze von 20 Sekunden; eine kürzere
Aufruferfrist oder ein Abbruch begrenzt weiterhin den gesamten Worker.

`maxRows` begrenzt rohe Modellzeilen. `zeilen` enthält alle gelesenen Zeilen,
einschließlich leerer Eingabeslots und Nullbeträge; `gridRead.rowFilter` ist
`"none"`. Nur durch Headergeometrie belegte sichtbare Spalten werden ausgegeben;
`gridRead.visibleColumns` ordnet sie den rohen Gridspalten zu. Offscreen-Zeilen
werden weder gescrollt noch fokussiert. `rowDetails` erhält boolesche
Checkboxwerte einschließlich des unbestimmten Zustands. `vollstaendig` und
`limitReached` beschreiben die vollständige Enumeration dieser Gridzeilen.

### Ausdrücklicher Cursorlauf für Kompatibilität und Diagnose

Der bestehende aktive Cursorlauf über `noKeys: false` bleibt ein eigener
Vertrag mit Fokus- und Eingabeprüfungen. Er ist nur ausdrücklich für einen
fehlenden vollständigen passiven Lesepfad, eine frisch bewiesene nötige
UIA-Positionierung/Materialisierung oder eine gezielte GUI-Diagnose zu wählen.
Die Positionsausnahme gilt auch, wenn ein Gridread vollständig ist. Ein
vollständiger Cursorlauf zeigt das Tabellenende und positioniert keine
beliebige Zielzeile; er eignet sich nur, wenn genau diese Endposition benötigt
wird. Andere Zielzeilen brauchen einen passenden gebundenen Weg und frischen
Zielnachweis. Der Lauf ist kein automatischer Fallback nach einem Fehler und
gehört nicht vor native Tabellenänderungen. Nach ungewissem Mutationsausgang
keine blinde Wiederholung oder vorbereitende Positionierung starten.
Er prüft jeden Zeilenschritt und kann deutlich länger dauern als ein passiver
Modellread.

Bei nummerierten Tabellen kann er eine vorab festgelegte, genau gebundene
Nr-Zelle einmal aktivieren. Erst frischer Fokus-, Auswahl- und Datenabgleich
erlaubt die Navigation. Ein vorhandener exakt zugehöriger Nummerneditor darf
einmal per ESC abgeschlossen werden; nach ungewissem Ausgang folgt kein
alternativer Aktivierungsversuch.
Als Ausgangspunkt ist zusätzlich das ausdrücklich profilierte eigene
Hilfe-Root-Dokument zulässig. Dafür müssen die geladenen Qt-Provider zur
verifizierten Version passen, die Tabelle vollständig editorfrei und die
Fokus-, Prozess-, RAW-Fenster- und Snapshot-Identität frisch gebunden sein.
Das fehlende TextPattern wird ausschließlich für diesen QtWebEngine-Provider
und dieses bekannte Hilfedokument als Nicht-Editierbarkeitsnachweis verwendet;
es ist kein allgemeiner UIA-Schreibschutzbeweis. Vor dem vorhandenen Einzelklick
wird dieselbe Quelle erneut geprüft. Unbekannte Dokumente, editierbare Quellen,
fehlende Richtlinien und Providerfehler erhalten keine Freigabe.
Bereits unterstützte passive Quellen (`Table`, `DataGrid`, `DataItem`, `Button`,
`Tree`, `TreeItem`) benötigen den bestehenden vollständigen Fokusquellennachweis.
Nur für eine so bewiesene passive Quelle darf eine vorhandene Zeilenauswahl
gebunden werden: begrenzte eindeutige RIDs, dieselbe Tabelle und Modellzeile,
unveränderte sichtbare Zellmetadaten, Grid-/SelectionItem-Container und gültige
Spans. Der Auswahlzustand der Zielzelle muss dazu passen. Die vollständige
Ausgangsauswahl wird unmittelbar vor dem vorhandenen Einzelklick identisch
erneut bewiesen; erst der Klick darf sie verändern. Unbekannte, gemischte oder
nicht sichtbare Auswahl erlaubt keine Aktion. Die Positionsnamen- und
Hilfedokument-Pfade behalten ihre Voraussetzung einer leeren Auswahl.
Meldet der Provider den ursprünglichen Nr.-Anker trotz abgeschnittener Lage als
sichtbar, darf nur die früheste vollständig innerhalb des Tabelleninhalts
liegende Nr.-Zelle als getrenntes Aktivierungsziel dienen. Diese Alternative
benötigt zusätzlich eine eindeutige vollständige Rohzeilen-/Semantikzuordnung
mit Inhalt außerhalb der Nr.-Spalte. Ein unbewiesener Eingabeslot genügt nicht.
Ziel-RID und tatsächliche Grid-Zeile bleiben vor und nach dem Einzelklick fest;
ein fehlgeschlagener Nachweis erlaubt keine Auswahl eines anderen Ziels.
Der ursprüngliche Leseanker und die anschließende HOME-Navigation bleiben
unverändert.
Nach dem eigenen Sprung mit Strg+Home können aktueller Eintrag und Auswahl
auseinanderliegen. Vor der ersten Abwärtstaste darf der öffentliche
Standardcursor deshalb die frisch bewiesene unveränderte Nr.-Zelle auf
Modellzeile 0 einmal auswählen. Die Berechtigung umfasst die genaue
Editor-, RAW-Zell-, Grid-, Wert- und Fensterbindung; ein beliebiger aktiver
Editor genügt nicht. Eine bereits ausgewählte Zelle benötigt keine Aktion.
Nach einer Auswahl müssen vollständige Rohwerte, Typ- und Checkboxzustände
unverändert sowie Fokus und Auswahl frisch gebunden sein. Ein Fehler beendet
den Lauf ohne zweiten Auswahlversuch. Private Cursorphasen, Grid und
`noKeys: true` behalten ihre bisherigen Wege.
Während der Navigation darf ein unveränderter ausgewählter Nr.-Editor den
eigenen vollständigen Fokus-, RAW-Zell-, Wert- und Auswahlnachweis direkt
durchlaufen. Ein frischer Fokus-Hinweis wählt lediglich diesen Prüfpfad;
er ersetzt keinen Nachweis. Unbekannte oder inzwischen veränderte Editoren
bleiben gesperrt.

`physicalInputAttempted` bezeichnet einen begonnenen physischen Aufruf.
`physicalInputUsed: null` erhält dessen ungewissen Ausgang; `true` belegt
mindestens eine bestätigte Eingabe, auch wenn eine spätere Taste ungewiss ist.
Bei verlorenem Kontext oder unbewiesenem Ergebnis bleiben `outcomeUnknown`,
`reconciliationRequired` und `cleanupRequired` gesetzt, mit `retryable: false`.
`activationSubmitted` beschreibt gesondert die Cursoraktivierung; Navigation
mit bereits vorhandenem Fokus benötigt keine neue Aktivierung.
Bei einem fehlgeschlagenen nativen Positionsnachweis kann
`cursorActivation.nativeRelease` den Freigabenachweis getrennt erhalten:
`attempted` und `threw` sind boolesch; `workerOk`, `leaseReleased` und
`releasedByEmit` sind boolesch oder bei fehlender Beobachtung `null`.
Eine unbestätigte Lease-Freigabe kann `cleanupRequired` und
`reconciliationRequired` setzen, obwohl die native Aktion vor jeder Mutation
abgelehnt wurde. Das beweist kein Ressourcenleck. Der ursprüngliche
Positionierungsfehler bleibt der Primärfehler.
Wird erst durch die unbestätigte Freigabe aus einem erfolgreichen Cursor- oder
Positionierungsschritt ein Fehler, enthält die Antwort `kind: cursor-proof-failed`,
eine nichtleere Fehlermeldung und die Phase `native-step-release` beziehungsweise
`native-position-release`. Sie bleibt schemakonform und verlangt einen frischen
Abgleich; ein vorgeschalteter Erfolg erlaubt keine Wiederholung der Mutation.
Die Spaltenzuordnung erwartet dieselbe logische und sichtbare Reihenfolge;
eine abweichend gezogene Headerreihenfolge wird mit einem Bindungsfehler
abgelehnt, statt Werte einer anderen Spalte zuzuordnen.

## Bekanntes Hilfsfenster vor Tabellenbindung schließen

Vor einem öffentlichen Cursorread und dem ersten privaten nativen
`prebind` darf der Worker das katalogisierte Fenster `Steuer-Spar-Tipps`
einmal schließen. Dasselbe gilt für eigenständiges `table_add`, `table_update`
und `table_delete`, bevor ihre erste Tabellenbindung entsteht. Nach der
Vorbereitung werden die normalen Seiten-, Tabellen- und Mutationsbindungen
frisch aufgebaut. `readMode: "grid"`, `noKeys: true`, spätere private
Cursorphasen und Mutationen mit geerbter Bindung führen diese Vorbereitung
nicht aus. Der Cursorpfad auf versteckten Desktops erhält sie ebenfalls nicht.

Die Vorbereitung benötigt eine ausdrückliche Profilrichtlinie. Erlaubt ist
nur genau ein bekanntes, aktiviertes, nachweislich nichtmodales Hilfsfenster
derselben PID mit exaktem Titel und AutomationId, das unmittelbar dem
gebundenen Hauptfenster gehört. Zusätzlich darf genau eine katalogisierte
Werte-Info als passiver Beobachter vorhanden sein. Sie benötigt eine eigene
frische Bindung von PID, HWND, direktem Eigentümer, Root-Identität und typisiert
nichtmodalem Zustand. Sie darf nicht im Vordergrund stehen; ihr vollständiger
Inhalts- und Geometriezustand muss vor und nach dem Close unverändert sein.
Geschlossen wird ausschließlich das Tipps-Fenster. Der erwartete Fensterbestand
danach entspricht dem ursprünglichen Bestand ohne genau dieses Fenster.
Andere relevante Fenster, unbekannte Dialoge oder ein aktiver Tabelleneditor
blockieren das Schließen.
Unmittelbar davor werden Fenster-/Prozessidentität, Eigentümer, Eingabe,
Vordergrund sowie vollständiger Seitenzustand erneut geprüft. Danach müssen
Hauptfenster, Seite, Feldwerte, Auswahl und Dirty-State unverändert sein;
ein erwarteter Vordergrundübergang vom geschlossenen Hilfsfenster zum
Hauptfenster wird dabei ausdrücklich gebunden.

Auf dem ausdrücklich gebundenen versteckten Desktop benötigen eigenständige
Tabellenänderungen dafür keinen sichtbaren Vordergrund und keine Eingabeepoche
des sichtbaren Desktops. Stattdessen müssen die tatsächlichen Desktops des
Workers und des Zielfensters mit der gebundenen Desktopkennung übereinstimmen
und vom Eingabedesktop verschieden sein. Dieser Nachweis und die
Desktopkennung werden vor und nach dem Close erneut geprüft. Nicht lesbare
Desktopdaten führen zum Abbruch. Die vollständigen Prozess-, Fenster-,
Eigentümer- und Zustandsprüfungen gelten weiter. Auf dem sichtbaren Desktop
bleibt ein nicht lesbarer Eingabe- oder Vordergrundzustand ein Abbruchgrund.
Bereits als Systemoverlay bekannte kleine Fenster werden auch im
Dialoginventar als Dekoration behandelt; unbekannte Fenster und nicht
bestätigte Dialogaktionen erhalten dadurch keine Freigabe.

Weicht vor dem Close ausschließlich die Geometrie der Seitenknoten ab, darf
genau eine zusätzliche vollständige passive Lesung den neuen Zustand
bestätigen. Dafür müssen sämtliche anderen projizierten Felder sowie
Überschrift und Dirty-State dem ursprünglichen Zustand entsprechen. Die
zusätzliche Lesung muss den gesamten zweiten Fingerprint exakt bestätigen;
Fensterinventar, Außenmaße, Eingabe-, Vordergrund- und Prozessbindung bleiben
unverändert an ihren ursprünglichen Nachweis gebunden. Nach dem Close gilt
weiterhin die volle Gleichheitsprüfung gegen diesen bestätigten Zustand.
Weitere Bewegung, ein Providerfehler oder eine andere Zustandsänderung führen
zum Abbruch; es gibt keine zweite Close-Aktion.
Die zusätzliche Geometriebestätigung gilt nicht für die beobachtete Werte-Info.

Ein nicht bestätigtes Schließen liefert `table-preparation-failed` und
`retryable: false`. Nach abgesandtem Close bleiben `outcomeUnknown` und
`reconciliationRequired` gesetzt, wenn der Abschlussnachweis fehlt. Es folgt
kein weiterer Schließversuch und keine Tabellenmutation. Der Fokuskontext
bleibt zur Klärung erhalten; eine automatische Fokuswiederherstellung oder
alternative Provideraktion erfolgt nach diesem Fehler nicht.

Der zusätzliche Fehlercode `[preparation:…]` unterscheidet die abgebrochene
Prüfphase. Bei abweichendem Seitenfingerprint nennt er nur eine feste
Feldklasse, etwa Identität, Inhalt, Auswahl oder Geometrie. Die dafür bereits
gelesenen Vergleichsknoten bleiben intern; die Diagnose fragt den Provider
nicht erneut ab und verändert keine Freigabebedingung.

## Erreichbarkeit und Browser-Schutz

- Die API bindet ausschließlich an `127.0.0.1` oder `::1`.
- `GET /healthz` ist ohne Anmeldung erreichbar und gibt nur technischen
  Zustand sowie `packageName`, `packageVersion`, `processId`, die zufällige
  `instanceId` und den pfadfreien `configurationFingerprint` für die strikte
  lokale Singleton-Identität aus. MCP sendet die geprüfte `instanceId` bei
  jedem Operations-POST mit; eine inzwischen ausgetauschte API lehnt den
  Auftrag vor dem Executor ab.
  Bei einem verwalteten `SSE_API_CONFIG` muss auch dieser Fingerprint exakt zur
  erwarteten Ressourcenbindung passen.
- Es gibt keine Anmeldung und kein Token. Discovery, OpenAPI und jede
  Operation sind für jeden lokalen Prozess erreichbar. Aufrufe aus einem
  Browser werden anhand von `Origin`, `Sec-Fetch-Site` und `Host` mit `403`
  abgewiesen.
- Jeder lokale Prozess, der die API erreicht, hat die volle Autorität der vom
  aktiven Profil zugelassenen Operationen. Eine Nutzerfreigabe im Agenten-Skill
  ist keine serverseitige Approval-Sitzung.
- Loopback darf nicht über Proxy, Tunnel oder Portweiterleitung veröffentlicht
  werden.

## HTTP-Hüllen

Ein erfolgreicher HTTP-Aufruf liefert Transportmetadaten und das fachliche
Ergebnis getrennt:

```json
{
  "apiVersion": "v1",
  "requestId": "UUID",
  "operation": "page",
  "durationMs": 123,
  "result": { "ok": true }
}
```

Ein fachlich erwartbarer Fehlschlag kann als gültige Operationsantwort mit
`result.ok=false`, `kind`, `error` und Readback-/Recovery-Feldern erscheinen.
Fehler vor der Ausführung, etwa Herkunftsschutz, unbekannte Operation oder
ungültige Argumente, verwenden eine HTTP-Fehlerhülle.

Die Gesamt-Discovery teilt den gemeinsamen Ergebnisumschlag einschließlich
optionaler UIA-Baumzähler einmal unter `definitions.OperationResultEnvelope`.
Die `allOf`-Referenzen der `resultSchemas` werden gegen dieses Gesamtdokument
aufgelöst. Die Einzel-Discovery liefert die Definition zusätzlich innerhalb
ihres `resultSchema`, sodass es auch isoliert validiert werden kann. OpenAPI
verwendet dafür die entsprechende gemeinsame Schema-Komponente.

## Startbereitschaft

`launch` startet den Prozess einmal und liest danach dessen Fensterzustand
innerhalb des ursprünglichen Zeitbudgets. Ein einzelnes Hauptfenster wird erst
nach drei übereinstimmenden Beobachtungen seiner PID, HWND, Klasse, Beschriftung
und Geometrie als bereit gemeldet. Ein als hängend gemeldetes Fenster zählt
nicht als bereit. Nach der Dialoginventur prüft ein frischer Win32-Read zusätzlich,
dass sich die sichtbaren Top-Level-Fenster dieser PID nicht geändert haben.
Eine abgelaufene Start-Probe bindet kein Fenster und meldet nie Bereitschaft.

Rückfragen und mehrere Hauptfenster bleiben unmittelbar sichtbar; der Aufruf
beantwortet, schließt oder übernimmt sie nicht automatisch. Ohne stabile
Bereitschaft bleibt der möglicherweise gestartete Prozess erhalten. Ein
fehlgeschlagener Readback veranlasst keinen erneuten Prozessstart. Spätere
Operationen prüfen ihre Fenster- und Fallbindung weiterhin selbst.
Ohne Falldatei kann `launch` das generische Fenster `Steuerprogramm` als bereit
melden; dessen HWND kann kurz darauf ersetzt werden. Direkte Aufrufer binden
vor einem späteren UIA-Zugriff das aktuelle Fallfenster über `instances` frisch.

## UIA-Startlesefehler bei der Fallanlage

Vor dem ersten UIA-Zugriff wartet `case_create` auf ein eindeutig an die gestartete
PID gebundenes Fallfenster mit Produktnamen im Titel. Das generische Fenster
`Steuerprogramm` kann bereits breit sein und trotzdem noch durch eine neue HWND
ersetzt werden. `case_create` wiederholt die rein lesende Instanzabfrage innerhalb
des bestehenden Zeitbudgets und wartet auf diesen Übergang. Start und
Assistentenklicks werden nicht wiederholt. Bleibt der Übergang nach einem
generischen Fenster unbestätigt, endet der Aufruf mit `startup-not-ready` und
erhält die gestartete PID samt möglichen Rückfragen zur frischen Prüfung.

Der Standard-Worker kennzeichnet einen fehlgeschlagenen UIA-Wurzelzugriff
innerhalb einer gebundenen `ui_state`-Lesung als `uia-root-unavailable`.
Operation, Phase, PID/HWND, Exceptiontyp und HRESULT bleiben nachvollziehbar.
Die Diagnose verwendet eine rein lesende, frische Fensterinventur. Ein verschwundenes
oder mehrdeutiges Fenster oder eine fehlgeschlagene Diagnose ersetzt die
urspruengliche UIA-Ausnahme nicht durch einen anderen Fehler und erteilt keine
neue Wiederholungsfreigabe.
Die Kennzeichnung bestaetigt einen aktuellen, nicht haengenden Hauptfensterrahmen;
ein wiederhergestelltes minimiertes Fenster und unbekannte Peer-Fenster erhalten
keine Freigabe fuer Wiederholungen. Bei unbekannten Peer-Fenstern wird der Prozess
zur weiteren Klaerung erhalten.

`case_create` erlaubt vor der ersten Assistentenaktion hoechstens drei solche
belegten Lesefehler. Jeder neue Versuch benutzt einen frischen Worker,
erneuert die Instanzlesung, behaelt dieselbe PID/HWND und verbraucht das
urspruengliche Zeitbudget. Start, Assistentenaktionen und Schreiben werden nicht
wiederholt. Allgemeines `worker-init`, ungewisse Ergebnisse oder geaenderte
Bindungen bleiben terminal. Auf Erfolg oder spaeterem Fehler halten die optionalen
Felder `startupUiaRootFailures` und `lastUiaRootFailure` die beobachteten Fehler fest.
Andere Operationen behalten ihre bestehende Snapshot-/Legacy-Grenze.

Beim optionalen nativen Backend bleibt ein noch nicht bestätigt beendeter
Broker gebunden. Folgeaufrufe scheitern vor Dispatch mit einem typisierten
Abbaufehler, wenn ihre Frist endet oder kein Exit-Beweis vorliegt. Ein bereits
bestätigtes Worker-Ergebnis wird dadurch nicht in einen Fehler umgedeutet.
Der ursprüngliche Startaufruf kann `native-startup-unproven` mit unbekanntem
Ausgang melden; eine folgende Anfrage übernimmt diesen fremden Fehler nicht.
Die Besitz- und Fristgrenzen stehen in [NATIVE-QT.md](NATIVE-QT.md).

## Zielbereitschaft nach Suchschluss

Der Standard-Worker bestaetigt einen aktivierten Suchtreffer nach dem
Suchschluss mit demselben begrenzten Pollingbudget. Zwei aufeinanderfolgende
Beobachtungen muessen dieselbe Zielueberschrift und ihre vollstaendig gebundenen
profilierten Felder beziehungsweise Tabellen bestaetigen. Eine negative
Beobachtung setzt die Bestaetigung zurueck. Nach Fristende startet keine neue
Pruefung; ein bereits begonnener UIA-Read darf seinen gueltigen Beweis liefern.
Der letzte erfolgreiche Inhaltsbeweis
entscheidet ueber den Erfolg; ein weiterer Readback ohne Wartebudget folgt nicht.
Bleibt die Bindung instabil, liefert `goto` `navigation-blocked` mit dem
beobachteten Weg und loest keine weitere Navigation aus.

## Optionale Wiederholung bei belegter API

`steuer-spar-erklaerung-call <operation> --busy-attempts 3` erlaubt insgesamt
höchstens drei Versuche mit 250 ms zwischen den Versuchen. Ohne diese Option oder mit
`--busy-attempts 1` bleibt es beim unveränderten einzelnen Aufruf. Die
Wiederholung greift ausschließlich bei einer validierten
HTTP-409-Antwort mit Fehlercode `busy`: Diese Anfrage wurde vor der Ausführung
abgelehnt. Eine Belegung innerhalb eines Worker-Ergebnisses, ein Transportfehler
oder ein unbekannter Ausgang löst keine Wiederholung aus.

Die CLI bindet vor dem ersten Versuch die Serverinstanz und behält dieselben
Argumente und Vorbedingungen für alle Versuche. Eine inzwischen veränderte
Seite oder Tabelle braucht passende, vom Server erneut geprüfte Vorbedingungen;
die Wiederholung aktualisiert diese nicht automatisch. Identitätsabfrage,
Wartezeiten und Ausführung teilen das Zeitbudget von `--timeout-ms`; die bestehende
zusätzliche Frist zur Rücknahme und Prozessbereinigung bleibt erhalten. Nach
Serverwechsel oder Abbruch endet der Aufruf mit Fehler. `not-dispatched`
kennzeichnet eine gescheiterte Identitätsabfrage; `busy-budget-exhausted` ein
vor der Ausführung erschöpftes Zeitbudget. Für Operationen mit Mindestbudget
muss nach der Identitätsabfrage und den Pausen noch ausreichend Zeit bleiben;
für `launch` sind das 30 Sekunden. Beide Fehler bedeuten, dass keine Operation
gestartet wurde. Ungewisse Ausführungsfehler behalten den Vertrag des Rohclients.
Das interne Clientmodul `api-busy-retry` bietet denselben Vertrag als
`callApiOperationWithBusyRetry` und als Variante mit Ergebnisumschlag.

## Dauerhaftes CLI-Journal

Die ausgelieferte CLI kann mit `--journal-file <neue.jsonl>` einen
absturzlesbaren Aufrufernachweis erzeugen. Sie reserviert den Pfad exklusiv und
überschreibt nie. Noch vor Konfigurationslesen oder API-Aufruf schreibt und
flush't sie einen Eintrag mit `schemaVersion=1`, `invocationId` und
`status=pending`. Nach der Antwort folgt vor stdout ein ebenfalls synchronisierter
Eintrag `complete` mit `exitCode` und dem vollständigen Ergebnis. Ein lokaler
Clientfehler endet nach Möglichkeit mit `status=error`.

`complete` beschreibt den abgeschlossenen CLI-/API-Roundtrip, nicht zwingend
fachlichen Erfolg. Bei `result.ok=false` ist `exitCode=1` beabsichtigt; der
Aufrufer muss `kind`, `error` und mögliche Teilstands-/Recovery-Felder lesen.
Insbesondere bleibt ein durch sein Seitenlimit beendetes `collect`
`collection-incomplete`, auch wenn es verwertbare gelesene Seiten enthält.

Ein alleiniger `pending`-Eintrag beweist weder Erfolg noch Fehlschlag. Die
Operation kann serverseitig begonnen worden sein, während Aufrufer, Pipe oder
Transport abbrachen. Eine solche Operation darf nicht blind wiederholt werden;
zuerst ist ihr fachlicher Zustand über eine neue, read-only API-Abfrage zu
ermitteln. Das Journal ist bewusst eine optionale CLI-Aufruferfunktion und kein
zweites serverseitiges Transaktionsprotokoll.

Argumente erreichen die CLI auf zwei Wegen: einzeln als `--<name> <wert>` oder
als JSON-Objekt über `--args-file`. Beides zusammen ist erlaubt; die Datei ist
die Grundlage, einzelne Werte gewinnen darüber. Ein einzelner Wert wird als JSON
gelesen, wenn er sich als JSON lesen lässt, sonst als Zeichenkette — `--hwnd 123`
ist also eine Zahl, `--name Spenden` eine Zeichenkette.

Eine Zeichenkette, die wie eine Zahl aussieht, lässt sich über verschachtelte
Shell-Anführungszeichen nicht zuverlässig zwischen Windows PowerShell 5.1 und
PowerShell 7 übertragen. Deren Übergabe nativer Argumente unterscheidet sich;
die CLI kann dadurch statt einer JSON-Zeichenkette eine Zahl erhalten. Wer den
JSON-Typ sicher erhalten will, verwendet `--args-file`.

Für den Weg über die Kommandozeile gelten zwei weitere Einschränkungen, die
keine Verbote sind, sondern Eigenschaften der Umgebung: Werte landen im
dauerhaften Verlauf der Shell, und nicht-ASCII geht durch deren Codepage. Für
Umlaute und für alles, was nicht im Verlauf stehen soll, bleibt `--args-file`
der verlässliche Weg.

Für `--args-file` gilt zusätzlich ein Bytevertrag: Mehrzeilige oder
nicht-ASCII Nutzdaten werden als neue UTF-8-JSON-Datei ohne BOM erzeugt,
zurückgeparst und über ihren Pfad übergeben. Eine Windows-PowerShell-Pipeline
vor `--args-file -` ist dafür ungeeignet, weil ihre implizite Codepage
beispielsweise Umlaute durch `?` ersetzen kann, ohne dass JSON ungültig wird.
Stdin bleibt auf kleine, im selben Prozess erzeugte ASCII-Objekte begrenzt.
Create-only Textresultate werden nach dem Schreiben über die API zurückgelesen;
API-Hash, physischer Hash und Hash des zurückgelesenen UTF-8-Texts müssen
übereinstimmen. Ein bereits kodierungsbeschädigtes Ziel wird nicht
überschrieben, sondern durch einen neuen, ausdrücklich korrigierenden Snapshot
ersetzt.

### Wiederherstellungsdialog

Eine exakt erkannte SSE-Wiederherstellungsfrage erscheint in `dialog_list` mit
`recoveryPrompt=true` und `requiresCaseBinding=true`. Ihr Fingerprint allein
reicht nicht: `dialog_answer` akzeptiert nur `Nein` sowie `expectedCaseRef` und
`expectedCaseHash`. API und MCP lösen die Referenz innerhalb des konfigurierten
`cases:`-Bereichs auf; der Worker bindet dieselbe Datei erneut an PID und
Command-Line, prüft SHA256 und Parser, klickt fingerprintgebunden und verifiziert
anschließend reguläres Fallfenster und unveränderten Hash. `Ja`, unvollständige
Bindings, abweichende Texte/Schalter oder ein nachträglich veränderter Dialog
enden ohne Klick.

Für einen Prozess, der ohne Falldatei gestartet wurde (etwa ein nie gespeicherter
neuer Fall), gibt es keine reguläre Datei, an die sich `Nein` binden ließe.
`dialog_answer` akzeptiert dann `Nein` mit `discardUnsavedRecovery=true`: Der
Worker beweist über die Prozess-Kommandozeile, dass keine Falldatei geladen war,
verlangt nach dem Klick genau ein reguläres, nicht wiederhergestelltes Fallfenster
und meldet `caseBindingModeAfter=file-less-start` sowie
`startedWithoutCaseFile=true`. Das Flag ist mit `expectedCaseRef` und
`expectedCaseHash` unvereinbar und außerhalb der Wiederherstellungsfrage
verboten; ein mit Falldatei gestarteter Prozess wird mit `case-mismatch`
abgewiesen.

## MCP-Abbildung

Vor dieser Abbildung übernimmt der MCP-Start ausschließlich eine exakt passende
API-Identität oder startet bei freiem Ziel seine installierte Dependency. Eine
explizite `SSE_API_URL` deaktiviert Start und Fallback. Parallelstarts
konvergieren über das Port-Rennen; fremde oder unklare Prozesse werden nie
beendet oder ersetzt. `SSE_API_URL` und `SSE_API_CONFIG` gemeinsam sind als
mehrdeutige Wahl gesperrt. API-stdio bleibt vollständig vom MCP-stdout getrennt.

- MCP validiert unbekannte, falsch typisierte und zu große Argumente vor dem
  API-Aufruf. Nennt eine Meldung einen unbekannten Feldnamen, listet sie die
  erlaubten Namen der Operation gleich mit.
- `sse_table_read` setzt ein fehlendes `noKeys` auf `true`, damit ein normaler
  MCP-Read keine aktive Cursorfolge startet. Ein ausdrückliches `false`
  bleibt die Kompatibilitäts-/Diagnosewahl; die direkte API übernimmt diesen
  Adapterdefault nicht. Das ist keine Backend-Fallbackregel.
- Fehlertexte des Arbeitsprozesses nennen **MCP-Werkzeugnamen** (`sse_…`), auch
  wenn der Aufruf über die API oder die CLI kam. Ein Werkzeugname trägt dort
  teils mehr Information als der Operationsname: `sse_change_field` und
  `sse_change_known_field` sind beide `tracked_set_value`. Die vollständige
  direkte Zuordnung steht maschinenlesbar in
  `capabilities.transport.mcpToolOperations`; komponierte Werkzeuge stehen mit
  ihren geordneten API-Basisoperationen daneben in
  `capabilities.transport.mcpComposedToolOperations`.
- API-Fehlerfelder werden nicht durch eine Fehler-Allowlist abgeschnitten;
  MCP markiert sie mit `isError=true`.
- Erfolgreiche Antworten bleiben als JSON-Text verfügbar. Einige Werkzeuge
  erzeugen darin aus Kompatibilitätsgründen eine kompakte Projektion. Alle 104
  MCP-Werkzeuge veröffentlichen parallel ein vollständiges, redigiertes
  `structuredContent` mit einem deklarierten `outputSchema`. Bei den 102
  direkten Werkzeugen ist es das API-Ergebnis; `sse_preflight` besitzt einen
  eigenen PC-blinden Kompositionsvertrag. `sse_api_control` ergänzt den
  getrennten API-Lebenszyklusvertrag.
- Die kompakte Textantwort von `sse_read_table` erhält den vorhandenen
  Boolean `incomplete` unverändert. Ein fehlendes Flag wird nicht als `false`
  ergänzt. Sichtbare Zeilen allein belegen keinen vollständigen Baumlauf.
- Lokale Windows-, UNC-, Datei-URL- und typische POSIX-Pfade werden an der
  MCP-Ausgabegrenze redigiert. Deshalb kann die öffentliche MCP-Antwort nicht
  bytegleich mit einem unredigierten lokalen API-Objekt sein.
- Bilder werden als MCP-Bildinhalt geliefert, wenn Operation und Argumente dies
  erlauben. Die zugehörigen API-Metadaten bleiben im kanonischen
  `structuredContent`; die bereits als Bildinhalt übertragenen Base64-Bytes
  (`imageBase64`/`bildBase64`) werden dort nicht dupliziert.

Alle 102 Operationen besitzen ein eigenes `Result_<operation>`-Schema der
Ergebnisvertragsversion 1. Diese Schemata typisieren die stabile
Transportfläche und ausgewählte fachliche Kernfelder, bleiben aber mit
Zusatzfeldern vorwärtskompatibel. Sie sind deshalb ein versionierter
Mindestvertrag und keine Behauptung, dass jede UI-bedingte Erfolgsvariante
bereits live erzeugt wurde.

Keine Operation fällt mehr auf einen reinen `ok/kind/error/ms`-Umschlag
zurück. Auch Lese-, Diagnose-, Navigation-, Cleanup- und der ausschließlich
auf das globale steuerneutrale Suchfeld begrenzte `set_value`-Pfad nennen ihre
stabilen Fach-, Guard- oder Recovery-Felder. Der statische Worker-Guard prüft
dabei nur Top-Level-Felder realer `Emit`-Objekte; gleichnamige Properties in
verschachtelten Bindungs- oder Rollbackobjekten gelten nicht als Beleg. Eine
berechnete `ok`-Ausgabe muss zusätzlich `kind` und `error` für ihren
möglichen Fehlerzweig besitzen; damit wird ein fachliches `ok=false` nicht
erst an der API-Grenze in einen HTTP-502-Vertragsfehler verwandelt.

Alle 30 als destruktiv annotierten Operationen veröffentlichen inzwischen
fachliche Erfolgs-, Guard- oder Recovery-Felder statt nur
`ok/kind/error/ms`. Gemeinsame Zod-Bausteine verhindern dabei abweichende
Typentscheidungen für Flag, Hash, Rollback und Fenster-/Eingabe-Guard. OpenAPI
referenziert die häufigsten Blattbausteine und den gemeinsamen
`OperationResultEnvelope` als Komponenten; die operationsspezifischen
Result-Schemas bleiben semantisch identisch.

Die API validiert jedes lokale Executor-, Worker- und Kompositionsergebnis vor
der HTTP-Ausgabe.
Ein strukturell ungültiges Ergebnis endet als redigierter HTTP-502-Fehler
`invalid-operation-result`. Discovery veröffentlicht Versionsnummer und
Schemas; OpenAPI referenziert sie pro Operationspfad; jedes MCP-Werkzeug nutzt
das zugehörige Schema als `outputSchema` und liefert das vollständige Ergebnis
als `structuredContent`.

Gesamt-Discovery und OpenAPI werden beim Serverstart einmal innerhalb des
Antwortlimits als UTF-8-Bytes serialisiert. Wiederholte GETs übertragen diesen
byteidentischen Snapshot, statt die rund 200–270 KiB großen Vertragsbäume pro
Request erneut zu durchlaufen. Die kleine Einzeloperations-Discovery bleibt
dynamisch und wird für die jeweils angefragte Operation serialisiert.

Der Operationsvertrag trennt Registrierung von aktueller Interaktionsfreigabe.
Beim BelegManager ist nur `receipt_manager_list` als `focusless-read` erlaubt.
Die neun weiteren registrierten Operationen melden in
`capabilities.operationPolicy` `foreground-required`/`blocked` und liefern bei
gueltigen Aufrufen denselben nicht wiederholbaren strukturierten Block ueber
HTTP und MCP. Die Pruefung liegt nach der Argumentschema-Validierung, aber vor
Ressourcenaufloesung, Workerstart und UI; auch der direkte Worker besitzt den
identischen Guard.

Die internen Detailreader bilden einen Fingerprint erst aus vollständig
lesbaren Werten. Textfelder benötigen ihren Rohwert; eine Beschriftung
bestätigt keinen Feldinhalt. Checkboxen benötigen einen echten booleschen
Zustand. Für USt gelten die Sätze `0`, `7` und `19` einschließlich der
unterstützten Anzeigeformate mit Prozentzeichen und Dezimalnullen. Ein
lesbares exakt leeres USt-Feld steht für den Nullsatz. Ein fehlender Wert,
ein unbestimmter Checkboxzustand oder ungültiger USt-Text lässt den
Vollständigkeits- und Bindungsnachweis offen. Die Interaktionsfreigabe bleibt
ein eigener Vertrag.
Der interne USt-Auswahlhelfer bestätigt auch einen No-op erst nach einer
frischen Lesung des ursprünglich gebundenen Felds. Unlesbare Werte, eine
ersetzte Runtime-ID und abweichende Vorwerte verweigern den Eingriff.
Beim Leeren bleibt der frisch gelesene, semantisch geprüfte Rohwert die
Vorbedingung des bestehenden Commit-Primitivs; eine zulässige abweichende
Anzeigeformatierung wird dadurch nicht als fremder Zahlenwert übernommen.
Auch die anschließende Rücklesung bleibt an diese Runtime-ID gebunden;
ein inzwischen ersetztes Feld bestätigt den ursprünglichen Eingriff nicht.
Die interne Auswahl von `7` oder `19` benötigt zusätzlich die vorhandene
eigene Lease und deren gespeicherte Eingabemarke. Fenster, ursprüngliche
Feldbindung und ComboBox müssen vor weiteren Aktionen weiterhin passen.
Jede Beobachtung während der Auswahl wird geprüft: fremde oder unlesbare
Werte und neue Bindungen stoppen die Folgeaktionen dauerhaft. Auch ein
bereits bestätigter Zielwert darf nicht wieder auf den Ausgangswert wechseln.
Ein einzelner physischer Commit bleibt nur bei unverändertem Vorwert und
derselben neuen Popup-Option möglich; seine letzte Zielprüfung läuft direkt
vor dem Klick. Der nächste eigene Checkpoint stammt ausschließlich aus der
bestätigten Klickantwort. Verweigerte und bereits ausgeführte Klicks sowie
fehlende Dispatch-Nachweise bleiben im Fehlerbericht unterscheidbar.
Eine Auswahl- oder Öffnungsausnahme erlaubt keinen Ersatzklick. Ein Popup
wird nur bei erhaltener Kontrolle geschlossen; ein bereits geschlossenes
Popup benötigt keine weitere Aktion. Unbestätigtes Zuklappen bleibt ein Fehler.
Auch der interne Checkbox-Helfer bindet den ursprünglichen booleschen
Vorwert, die Runtime-ID und die eigene Eingabemarke. Die letzte Klickprüfung
liest den Wert erneut und prüft, ob der Punkt noch im aktuellen Zielrechteck
liegt. Ein unbekannter Toggle-Zustand erlaubt weder Änderung noch No-op.
Physische Fehler werden abgefangen: `inputDispatched=false`, `true` und ein
fehlender Nachweis bleiben verschieden. Der Transaktionsbericht erhält die
Fehlerevidenz in `failedPointEvidence`; Checkbox-Rücknahmen behalten
`pointInputDispatched` und `pointEvidence`. Bereits geänderte Felder und die
erste Ursache bleiben sichtbar. Ein unbestätigter Eingriff erlaubt keine
weiteren Schreibschritte oder neue Eingabemarke aus einem späteren Read.
Der abschließende Wertevergleich prüft Runtime-ID und Automation-ID der
ursprünglichen Felder. Ein ersetztes Feld bestätigt auch mit gleichem Wert
keinen Erfolg; sein Nachwert bleibt unbekannt. Nach bereits erfolgten
Änderungen bleiben Zustands-, Listen- und weitere Abschlusslesefehler im
gemeinsamen Bericht mit `changedFields`, `valuesBefore`, `requestedValues`
und `cleanupRequired=true` erhalten. `finalVerificationError` nennt Phase
und Ursache; `detailCloseError` erhält einen vorhandenen Schließfehler
einschließlich des möglicherweise unbekannten Dispatch-Ausgangs.
Das Detailschließen hält die eigene Lease und Eingabemarke fest. Der
ursprüngliche Schalter wird nach Runtime-ID, Automation-ID, Typ, Name und
aktuellem Zielrechteck erneut geprüft. Nur die bestätigte eigene Klickmarke
geht an den begrenzten Listenreadback weiter. Verlorener Kontext erlaubt
keinen weiteren Klick und keinen blinden Rollback. Interne Ergebnissentinels
werden auch durch Abschluss- und Schließaufrufer unverändert weitergereicht.
Ein weiterhin sichtbarer Schließknopf zählt auch bei deaktiviertem oder
unbekanntem Aktivierungszustand als offen; erst sein Verschwinden bestätigt
zusammen mit der vollständigen Liste den Abschluss.
Die laufende Feldtransaktion behandelt erwartete Auflösungsfehler beim
erneuten Binden als strukturierten Fehler. Der anfängliche Fehler und schon
erfolgte Änderungen bleiben erhalten; auch native Zustandslesefehler behalten
ihre Ursache im offenen Transaktionsergebnis. Eine Rücknahme erwartet unverändert
den eigenen angeforderten Wert, statt einen inzwischen gelesenen fremden
Wert als Vorbedingung zu übernehmen. Nach einer gescheiterten oder nicht
bestätigten Rücknahme werden weitere Felder nur noch gelesen. Bereits
verlorener Kontext bleibt mit `cleanupRequired=true` offen, selbst wenn
einzelne Werte wieder dem Ausgangszustand entsprechen. Das ersetzt weder
die offenen Prüfungen übriger Klickgrenzen, die reale Abnahme oder die
bestehenden Schreibsperren.
Der Qt-Pfad hält denselben Rücknahmestopp ein. Geht die Bestätigung einer
inversen Mutation verloren, bleibt `outcomeUnknown=true` erhalten; eine
anschließende Detail-Schließaktion bestätigt diesen Zustand nicht.
Wurde eine Detailansicht bereits geöffnet und lassen sich ihre Werte nicht
vollständig bestätigen, meldet die native Änderung den erforderlichen Abgleich mit
`cleanupRequired=true`. Ein automatisches Schließen ist dann kein bestätigter
Cleanup-Schritt. Ein bereits ausgeführter USt-Clear bleibt als begonnene
Mutation erkennbar, auch wenn sein Nachwert unlesbar ist; dieser bleibt `null`.
Sind bereits geöffnete Details unlesbar, verweigert die native Änderung auch
die erneute Zeilenaktivierung vor jeder Aktion. Der Aufruf selbst hat dann
nichts geändert; die vorhandene Detailansicht bleibt abgleichpflichtig und
der Aufruf nicht automatisch wiederholbar.

Die MCP-Eingaben dürfen strenger sein als die der lokalen API, nie
großzügiger. Bekannt und gewollt:

- Die Ressourcenwerkzeuge `sse_workspace_files`, `sse_workspace_read_text` und
  `sse_workspace_write_text` verlangen die eindeutige Form `bereich:pfad`.
  Der zusätzliche `area`-Parameter mit bloßem Relativpfad bleibt der lokalen
  HTTP-API und der CLI vorbehalten.
- Die historischen `*Path`-/`dir`-Argumente mit absolutem Windows-Pfad sind
  ebenfalls API-only; MCP kennt ausschließlich Ressourcenreferenzen.
  Insbesondere bleibt `case_hash.path` für vertrauenswürdige lokale
  Bestandsclients kompatibel und darf eine profilkonform benannte Falldatei
  auch außerhalb des konfigurierten Fallordners lesen. Für neue Aufrufer ist
  `cases:` die begrenzte, PC-blinde Form. Die API darf deshalb ausschließlich
  lokalen, vollständig vertrauenswürdigen Prozessen zugänglich bleiben.

API-/MCP-Parität bedeutet damit:

1. derselbe Operationsvertrag und dieselbe Ausdrucksstärke der Eingaben, wobei
   MCP auf die eindeutige Referenzform beschränkt bleibt;
2. genau ein API-Aufruf je einfachem MCP-Werkzeug;
3. keine verlorenen fachlichen Erfolgs- oder Fehlerfelder an der kanonischen
   MCP-Ergebnisgrenze;
4. dokumentierte Aliase und Kompositionen;
5. Pfadredaktion und die Auslagerung von Base64-Bildbytes in MCP-Bildblöcke als
   einzige beabsichtigte inhaltliche Transportdifferenzen.

## Aliase und Kompositionen

Die Zahl der Werkzeugnamen ist nicht die Zahl eindeutiger API-Ziele.
Beispielsweise bilden zwei Feldwerkzeuge auf `tracked_set_value` ab.
`sse_preflight` bildet bewusst nicht auf eine erfundene API-Operation ab: Es
ruft sequenziell `workspace_status`, `product_info` und `health` auf, stoppt bei
einem Komponentenfehler und gibt ansonsten nur stabile Bereitschaftsflags und
Blockercodes aus. Es startet oder konfiguriert nichts und gilt nicht als
Mutationsfreigabe. `ready=true` verlangt sowohl für die geprüfte Installation
als auch für den tatsächlich laufenden Prozess einen expliziten
`buildDrift.drifted=false`-Nachweis; fehlende oder abweichende Runtime-Evidenz
endet mit `SSE_BUILD_DRIFT`.
`checker_open` komponiert intern Prüferlesen und einen eng gebundenen
read-only Detailklick. UStVA-Werkzeuge komponieren profilierte Seiten- und
Feldoperationen in der API, nicht im MCP-Prozess. Ihr Seiten-Read und die
nachfolgende gebundene UI-Aktion teilen eine absolute Aufruferdeadline. Unter
zwei Sekunden Rest startet keine UStVA-Mutation oder Bereichsnavigation mehr.

Der Seiten-Read der vier schreibenden UStVA-Operationen entfällt, wenn der
Aufrufer die Seitenüberschrift als `expectedPage` durchreicht — das Feld `page`
aus dem unmittelbar vorangegangenen `ustva_read`. Die Angabe wird gegen die
geforderte Seitenart geprüft, bevor irgendeine Worker-Operation startet, und
der Worker hält sie unmittelbar vor der Änderung gegen die tatsächlich offene
Seite; beide Seiten lesen die Überschrift über dieselbe Funktion. Ohne die
Angabe bleibt die Komposition unverändert. Eine Ausnahme behält den Read auch
mit `expectedPage`: `ustva_change_value` auf den manuellen Übersichtsfeldern,
weil dort die Lesung der Nachweis für das aktive Kennzeichen „Beträge manuell
erfassen“ ist und eine Zusicherung des Aufrufers keine Prüfung wäre. Ein dort
trotzdem übergebenes `expectedPage` wird gegen die Lesung gehalten.
`case_create` komponiert in der API den Startassistenten eines neuen Falls:
`launch` ohne Datei, `instances`/`ui_state` bis zur Startseite, `subpages` und
`click` bis zur ersten Stammdatenseite, `menu`/`menu_click` „Speichern
unter…“, `dialog_list` und `file_dialog_select` im Modus `save-new` sowie den
`instances`-Readback. Vor dem Speichern beendet jeder Fehler die exakt
gestartete PID ohne Speichern; nach dem Speichern wird nie gelöscht. Die
Operation verlangt eine leere Instanzliste, keinen aktiven versteckten Desktop,
ein neues Ziel mit modusgerechter Endung und ist auf live verifizierte
Startmodi begrenzt. Kann der Worker nach dem Speichern keinen Dateihash
liefern, weil der Prozess ohne Datei gestartet wurde und der Titel gekürzt ist,
prüft die API den Dateihash lokal gegen den Dialog-Readback
(`caseHashSource=local-file`).

Jede neue Ausnahme braucht einen Vertragstest, der API-Ziel, Argumente,
Fehlerweitergabe und Ergebnisfelder nachweist.

## Queue, Abbruch und Timeout

Der HTTP-Client hält das kombinierte MCP-/Aufrufersignal und seine eigene
Frist nicht nur bis zu den Antwortheadern, sondern bis zum vollständigen,
größenbegrenzten JSON-Body aktiv. Das gilt für Operationen ebenso wie für
Discovery und OpenAPI; ein nach den Headern hängender Body bleibt damit
abbrechbar. Lehnt der Client eine Antwort schon wegen eines falschen
`Content-Type` ab, cancelt er den ungenutzten Body vor dem Protokollfehler;
dadurch bleiben weder ein Streaming-Body noch sein Keep-alive-Socket aktiv.
Der produktive Defaultpfad verwendet direkt `node:http` auf Loopback und hat
keine zusätzliche 300-Sekunden-`fetch`-/Undici-Frist. Dadurch bleibt das
zusätzliche Cleanup-Fenster auch nach einer maximalen Fünf-Minuten-Operation
erreichbar. Injizierte Test-/Alternativtransporte können weiterhin
`UND_ERR_HEADERS_TIMEOUT` oder `UND_ERR_BODY_TIMEOUT` liefern; beide werden als
`timeout` mit unbekanntem Operationszustand klassifiziert und dürfen keine
blinde Wiederholung auslösen.
Node-HTTP-Fehlercodes werden sowohl direkt am Fehler als auch in einer
Transportursache gelesen. Bricht eine bereits aufgebaute Verbindung während
eines Operations-POSTs mit `ECONNRESET`, `ECONNABORTED`, `EPIPE`,
`ERR_STREAM_PREMATURE_CLOSE` oder `UND_ERR_SOCKET` ab, lautet die Fehlerart
`transport-unknown`: Der Auftrag kann bereits ausgeführt worden sein und darf
erst nach einem gezielten Zustands-Readback wiederholt werden. Ein verweigerter
Verbindungsaufbau (`ECONNREFUSED`) bleibt dagegen `network`.

Auch eine unlesbare JSON-Operationsantwort oder ein verletzter Ergebnisvertrag beweist
nicht, dass die API den Auftrag verworfen hat. MCP kennzeichnet solche
`protocol`-Fehler deshalb vorsichtig mit `outcomeUnknown=true`,
`reconciliationRequired=true` und `retryable=false`. Vor einer weiteren
Schreibaktion muss der betroffene Zustand vollständig gelesen und abgeglichen
werden; eine ungültige Antwort löst keine automatische Wiederholung aus.
Protokollfehler der vorgeschalteten Healthz-Prüfung verhindern dagegen bereits
den Operations-POST und werden nicht als möglicherweise ausgeführter Auftrag markiert.
Auch ein Timeout oder Abbruch innerhalb dieser lesenden Identitätsprüfung
startet keinen Operations-POST. Solange derselbe MCP-Aufruf noch keine Antwort
auf eine Schreiboperation erhalten hat, meldet MCP dafür `not-dispatched` ohne
Ungewissheitsflags. Nach einer Schreibantwort oder einem ungewiss beendeten
Schreibauftrag verlangen auch spätere Fehler eines Callbacks einen
Zustandsabgleich; MCP setzt dafür die Ungewissheitsflags.
Das betrifft den gesamten Werkzeugaufruf: Bereits ausgeführte Teilschritte
werden durch eine später gescheiterte Vorprüfung nicht rückgängig.
Ein Abbruch des gesamten MCP-Zeitbudgets bleibt vorsichtig ungewiss, weil
bereits gestartete Aufträge noch bereinigt werden können.

Dasselbe gilt für HTTP-5xx-Antworten auf einen Operations-POST: Der Server
kann eine Änderung bereits ausgeführt haben und erst beim Erzeugen oder
Prüfen des Ergebnisses scheitern. MCP erhält die Fehlerart des Servers und
ergänzt `outcomeUnknown=true`, `reconciliationRequired=true` und
`retryable=false`. Auch der Busy-Retry-Client wiederholt solche Aufträge
nicht. Gültige HTTP-4xx-Ablehnungen bleiben als Ablehnung erkennbar; eine
fehlgeschlagene vorgeschaltete Healthz-Prüfung startet keinen Operations-POST.
`ApiClientError.operationResponseReceived` bezeichnet dabei den Empfang einer
Operationsantwort unabhängig von ihrer Fehlerart, nicht eine bestätigte Änderung.
Auch ein Fehler beim Lesen des Antwortbodys oder bei der anschließenden
MCP-Aufbereitung darf einen bereits ausgeführten Auftrag nicht als sichere
Ablehnung erscheinen lassen. Solche Fehler verlangen denselben Zustandsabgleich;
die Operation wird nicht automatisch erneut ausgeführt. Die aktuell
katalogisierten zusammengesetzten MCP-Werkzeuge bestehen ausschließlich aus
Leseoperationen. Eine künftige schreibende Komposition braucht zusätzlich eine
ausdrückliche Bilanz ihrer bereits ausgeführten Teilschritte.

Lehnt der lokale HTTP-Transport die Operationsantwort schon vor der JSON-Prüfung
ab, etwa wegen eines Redirects oder eines ungültigen HTTP-Status, gelten dieselben
Ungewissheitsregeln. HTTP-Parserfehler (`HPE_*`) während eines Operationsaufrufs
werden als `transport-unknown` gemeldet. Weder solche Antworten noch ein
Verbindungsabbruch lösen eine automatische Schreibwiederholung aus. Eine
weiterhin erfolglose vorgeschaltete Healthz-Prüfung startet auch nach den
erlaubten rein lesenden Proben keinen Operations-POST. Ein tatsächlich
verweigerter Verbindungsaufbau bleibt `network`.

Die gültigen HTTP-Nullbody-Statuscodes 204, 205 und 304 werden ohne
synthetischen Web-Stream abgebildet; 304 bleibt bei `redirect=error` dennoch
vorher gesperrt. Dadurch entstehen an dieser Adaptergrenze keine internen
WHATWG-`Response`-Konstruktorfehler.

Der MCP-Abbruchvertrag wartet im Integrationstest nicht auf eine zufällig
langsame Datei oder einen Virenscanner. Eine deterministische Executor-Barriere
beweist nacheinander, dass der MCP-Client lokal abbricht, der bereits
angekommene HTTP-Auftrag sein API-`AbortSignal` sieht, der Workspace-Executor
`kind=aborted` liefert, die getrennte Antwort als `delivered=false` geloggt
wird und ein zweiter Auftrag danach vollständig gelingt. Der kooperative
Abbruch während eines echten 64-KiB-Hashblocks bleibt davon getrennt im
Workspace-Dateivertrag geprüft.

Die API serialisiert Windows-Worker- und damit UI-Aufträge. Rein lokale,
read-only Pfade wie `case_hash`, das nicht-ausführliche `list_cases`, der
öffentliche Profilkatalog `page_objects` und die hashgebundene
`verify`-Auswertung laufen ohne PowerShell-Prozess und beachten denselben
Abbruch und Timeout.
Diese API-Sperre ist pro Prozess. Ein zweiter API-Prozess auf einem anderen
Loopback-Port oder ein direkter Worker wird deshalb zusaetzlich fuer jeden
lock-pflichtigen PowerShell-Workerabschnitt ueber einen festen Windows-
Sitzungsmutex koordiniert. Der Versuch wartet nicht:
`kind=busy`, `reason=session-controller-busy`, `retryable=true`,
`waited=false`, `mutationStarted=false` und `resultingState=unchanged` kommen im
normalen HTTP-200-Operationsergebnis zurueck. Das unterscheidet sich vom
prozesslokalen HTTP-409-Single-Flight. Nur `page_objects` und `product_info`
umgehen den Mutex; vorgewaermte Reserveworker halten ihn erst ab ihrem Auftrag.
Bei einem gültigen SSE-Privatdesktop-Marker dürfen genau diese zwei
desktopunabhängigen Reads eine bereits bereite Reserve verwenden. Node und
Worker prüfen den Marker trotzdem jeweils selbst; ein fremder Center-Marker
bleibt gesperrt, und ohne bereite Reserve gilt weiterhin der markierte
Kaltstart.
`unchanged` bedeutet hier ausschliesslich: Der abgewiesene Aufruf selbst hat
nichts mutiert. Der laufende Besitzer kann den gemeinsamen Produktzustand
waehrenddessen aendern; ein spaeterer Retry braucht deshalb frische Bindungen.
Lokale API-Pfade halten den Mutex nicht. Eine zusammengesetzte API-Operation mit
mehreren Workeraufrufen erwirbt ihn fuer jeden Schritt neu und kann dazwischen
mit einem anderen Prozess verzahnt werden; frische Bindungen und Postconditions
lassen einen solchen Schritt weiterhin fail-closed abbrechen. Dies ist daher
eine Serialisierung der SSE-/UIA-Kritischen Abschnitte, keine sitzungsweite
Transaktion um einen vollstaendigen API-Aufruf.
Eine beobachtete Aufgabe oder eine nicht sicher bind-/freigebbare Sperre liefert
`worker-isolation-lost` und unbekannten Zustand. Der Mutex speichert einen
bereits beendeten Crash nicht dauerhaft; Abbruch-/Timeout- und Readbackregeln
bleiben deshalb unveraendert.
Die Worker-Queue zählt höchstens 32 tatsächlich laufende oder noch wartende
Aufträge. Ein bereits abgebrochener Aufruf wird nicht eingereiht; ein erst in
der Queue abgebrochener Aufruf gibt seinen Kapazitätsplatz sofort frei und
wird vollständig aus der Warteliste entfernt, ohne einen Worker zu starten.
Nur ein bereits gestarteter Worker behält den Platz bis zum nachgewiesenen
Prozessbaum-Cleanup. `busy` bezeichnet dadurch echte laufende/wartende Last,
nicht zurückgelassene Clientabbrüche.
Die lokale Workspace-Dateiliste gibt den Eventloop zwischen vollständig
containment-geprüften Laufeinheiten sowie zwischen höchstens 64 KiB großen
Hashblöcken frei und liefert bei Abbruch oder Deadline keine Teilliste. Pro
Datei werden höchstens 16 MiB, pro Liste höchstens 64 MiB gehasht; tatsächlich
gelesene Bytes belasten dieses Gesamtbudget auch dann dauerhaft, wenn eine
währenddessen veränderte Datei keinen Hash erhält. Bei einem fachlichen
Dateilimit prüft die Liste genau einen weiteren
Treffer und kennzeichnet die ansonsten gültige Teilliste mit `truncated=true`;
ein vollständig durchlaufenes Verzeichnis liefert `truncated=false`.
Die auf 1 MiB begrenzten Textoperationen prüfen beides vor dem
Dateizugriff; ein bereits exklusiv begonnenes synchrones Schreiben wird zu
Ende geführt und nicht nachträglich als fehlgeschlagen ausgegeben.
Auch `make_working_copy` läuft im API-Prozess: Quelle und atomar neu erzeugtes
Ziel bleiben über denselben Aufruf geöffnet, werden vollständig gehasht und an
Dateiidentität, Größe sowie Zeitstempel gebunden. Ein Abbruch oder Timeout
entfernt eine Teilkopie nur, wenn Identität, Bytezahl und Teilhash weiterhin
den eigenen Schreibstand beweisen; ein fremd verändertes Ziel bleibt erhalten.
Nach dem Erzeugen eines Ziels gibt es niemals einen Worker-Fallback.
Für einen ausdrücklich isolierten UI-Audit ist diese Operation auch ohne
geplante fachliche Mutation die Sicherheitsgrenze: Erst Originalhash lesen,
dann eine neue bytegleiche Prüffallkopie erstellen und ausschließlich deren
`targetRef` starten. SSE kann reine Seitennavigation als
`ungespeichert=true` markieren. Der normale Agentenauftrag verwendet dagegen
den bereits eindeutig geöffneten Fall, sichert dessen aktuellen Disk-Hash
einmal nach `backups:` und speichert den Navigationszustand nicht automatisch.
Die beiden potenziell langsamen Dateiöffnungen sind an Clientabbruch und
Deadline gebunden; ein spät erfolgreicher Ziel-Open schließt und entfernt sein
leeres Eigenziel nachträglich. `FileHandle.read/write/stat/unlink` besitzen in
Node dagegen kein sicher abbrechbares Windows-API: Der Kopierpfad prüft die
Deadline zwischen höchstens 1 MiB großen Blöcken, ein einzelner hängender
Kernel-/Netzlaufwerkaufruf kann sie aber überschreiten. Eigentumsgeprüftes
Cleanup läuft bewusst zu Ende, auch wenn das Antwortbudget bereits abgelaufen
ist. Der direkte Worker bleibt durch Prozessbaum-Abbruch härter begrenzbar.

Node kann unter Windows nicht dieselben Share-Modi wie der direkte Worker
anfordern: Der Worker verhindert konkurrierende Schreiber während seiner
offenen Handles, der API-Pfad erkennt sie fail-closed beim Readback. Deshalb
werden Quelle, Ziel und Pfadidentität nach dem Kopieren erneut verglichen. Da
Node außerdem kein `DELETE_ON_CLOSE` für diesen Pfad bereitstellt, bleibt beim
Rollback zwischen letzter Identitätsprüfung und `unlink` ein kleines
Dateisystem-TOCTOU-Restfenster. Der direkte Worker bleibt für kompatible lokale
Aufrufer und als Paritätsreferenz erhalten.
`backup_cases` läuft über API und MCP ebenfalls vollständig im API-Prozess.
Es verwendet für jede Falldatei den verifizierten Einzelkopierpfad, teilt ein
gemeinsames Client-Zeitbudget und prüft zusätzlich den exakten Quell- und
Zielbestand. Das Zielverzeichnis, fehlende verschachtelte Eltern und jede
Zieldatei müssen komponentenweise exklusiv neu sein;
erst nach einem zweiten vollständigen Readback wird das bytekompatible
Prüfsummenmanifest exklusiv geschrieben. Abort, Timeout oder Bestandsänderung
rollen nur nachweislich eigene Dateien zurück. Unbekannte oder fremd veränderte
Ziele werden nie gelöscht, sondern in `retainedTargets` zur manuellen Klärung
ausgewiesen. Ein partiell geschriebenes Manifest wird nur bei unveränderter
Dateiidentität und exaktem Präfix der beabsichtigten Bytes als eigener Stand
entfernt. Nach dem ersten `mkdir` gibt es auch hier keinen Worker-Fallback.

Der MCP-Ablauf unterscheidet Backup und Arbeitskopie trotz desselben
Kopierprimitivs: `backups:` ist die normale private Sicherung des aktuellen
Dateistands; ein `cases:`-Ziel entsteht nur auf ausdrücklichen Wunsch nach einer
separaten Datei. Der Agent merkt in der laufenden Aufgabe Fallreferenz,
Quellhash und verifizierte Backupreferenz und kopiert bei unverändertem Hash
nicht vor jedem Tool-Aufruf neu. Nach einem ausdrücklich beauftragten
`save`-Hashwechsel muss die nächste Mutationsphase neu sichern. Der Release
besitzt keine automatische Backup-Retention und löscht deshalb nichts.

`archive_cases` läuft über API und MCP ebenfalls lokal, während der direkte
PowerShell-Aufruf als Kompatibilitäts- und Paritätsreferenz bestehen bleibt.
Vor der ersten Mutation müssen `cases` plus `expectedRemaining` den
vollständigen profilkonformen Bestand einschließlich `<Fall>_Backup` bilden;
alle Hashes werden über dauerhaft offene Handles gebunden und jeder zu
archivierende Fall muss sicher als nicht übermittelt lesbar sein. Eine
fail-closed `tasklist.exe`-Prüfung blockiert bei laufender `SSE.exe` sowohl vor
dem Datei-Preflight als auch unmittelbar vor der ersten Bewegung.

Die lokale Bewegung ist absichtlich kein Node-`rename`: `rename` könnte unter
Windows ein gleichzeitig erschienenes Ziel ersetzen. Stattdessen wird jede
Datei per `wx+` exklusiv neu kopiert, vollständig über Hash, Dateiidentität und
Pfadzustand verifiziert und erst danach am Quellpfad entfernt. Der offene
Quell-Handle bleibt bis Commit oder Rollback erhalten; Änderungs- und
Zugriffszeit werden auf das Archivziel übertragen. Dieser Copy/Delete-Vertrag
gilt gleich für Ziele auf demselben oder einem anderen Volume. Vor jeder
einzelnen Quellentfernung wird der SSE-Prozessstatus erneut geprüft. Kann ein
Dateisystem einen Namen bei offenem Quell-Handle nicht sicher entfernen,
endet die Operation fail-closed und behält das verifizierte Archivziel als
strukturiert gemeldeten Wiederherstellungspunkt; sie behauptet keinen Erfolg.
Das
bytekompatible CSV-Manifest entsteht verifiziert vor der ersten Bewegung.
Abbruch oder Timeout nach einer Bewegung beendet nicht den Sicherheitsnachweis,
sondern löst den vollständigen eigentumsgeprüften Rollback aus. Bei einem
harten Prozess- oder Stromausfall kann dieses vorab geschriebene Manifest
deshalb bereits alle vorgesehenen Dateien nennen, obwohl noch nicht alle
Quellnamen entfernt wurden. Für eine manuelle Wiederaufnahme sind immer
Manifest und aktueller Quell-/Zielbestand samt Hash zu vergleichen.

Ist das Archivziel fremd verändert, schreibt der Rollback die Originalbytes
aus dem offenen Quell-Handle zurück und erhält das fremde Ziel. Ist zugleich
der alte Quellpfad fremd belegt, bleibt eine intakte Archivkopie unangetastet;
sind beide Pfade fremd, wird zusätzlich eine exklusive, hashverifizierte
`.sse-recovery-*`-Datei im weiterhin identitätsgebundenen `cases:`-Ordner
angelegt. `rollbackFiles`, `recoveryFiles`, `retainedTargets` und
`recoverable` machen diesen Zustand strukturiert sichtbar. Nach der ersten
Zielerstellung gibt es keinen Worker-Fallback.
`list_cases` bleibt bei `verbose: true` oder einem nicht sicher lesbaren
AKAD-Kopf auf dem Worker-Kompatibilitätspfad. `page_objects` lädt und validiert
Manifest und Katalog pro Aufruf neu; bei lokaler Profilinkonsistenz bleibt der
echte Worker der Kompatibilitätspfad. Lokaler Versuch und Worker-Fallback
teilen dabei dasselbe Client-Zeitbudget; der Fallback erhält nur die
verbleibende Frist und startet bei weniger als zwei Sekunden Rest keinen neuen
PowerShell-Prozess. `verify` fällt nur bei Quell- oder Unicode-Werten außerhalb
der nachgewiesenen Node-/PowerShell-Parität zurück; Hashabweichung, ungültiges
UTF-8/JSON, unvollständige Quelle, Abbruch und Timeout bleiben lokale,
fail-closed Ergebnisse. Das lokale 16-MiB-Limit hat vor einem Hashvergleich
Vorrang: Eine größere Quelle endet als `invalid-source`, ohne durch
unbegrenztes Hashen Arbeit erzwingen zu können. Auch das Öffnen einer Falldatei ist an Abbruch und
Timeout gebunden. Ein MCP-Abbruch wird über den HTTP-Client an die API
weitergereicht.
Timeout oder Abbruch bedeutet bei einer Mutation nicht
„nicht ausgeführt“: Vor jeder Wiederholung muss der Zustand neu gelesen werden.
Kann ein gestarteter Worker-Prozessbaum nicht sicher beendet werden, sperrt die
API weitere Worker-Aufrufe bis zum Neustart. Ein beendeter direkter Parent ist
dabei kein ausreichender Nachweis: Hält ein entkoppelter Enkel geerbte
stdout/stderr-Handles offen und verhindert dadurch Nodes `close`, verriegelt
der äußere Cleanup-Wächter die Worker-Laufzeit fail-closed.

## Ergebnisgrenze und Evidenz

`read_table` und `table_read` liefern neben ihren bisherigen Textzeilen
`rowDetails` in derselben Zeilenreihenfolge. `rowIndex` ist nullbasiert;
`typedValues`, `checkboxStates` und `cellTypes` folgen der Spaltenreihenfolge.
Checkboxen stehen als echte Booleans in `typedValues` und separat als `On`,
`Off` oder `Indeterminate` in `checkboxStates`. Ein unbestimmter Zustand hat
den Wert `null`. Nicht beobachtete Zellen bleiben `unknown` und werden in
`semanticReadErrors` ausgewiesen; leerer Anzeigetext beweist keine ausgeschaltete
Checkbox. `semanticsComplete` beschreibt nur die ausgegebenen Zellen, nicht
die Vollständigkeit einer virtualisierten Tabelle. Sichtbares Lesen ersetzt
keinen vollständigen Modell- oder Gridbestand mit Endbeweis. Steuerbeträge
werden aus diesen Checkbox-Zuständen nicht abgeleitet.

Ein fehlender Cursor- oder Zeilenidentitätsnachweis bei `table_read` liefert
`ok=false` mit `kind=cursor-unavailable` oder `kind=row-identity-unavailable`.
Bereits eindeutig beobachtete Zeilen, `rowDetails`, Summen und die
Aktivierungsdiagnose bleiben erhalten. Auch bei `noKeys=true` ist ein Bestand
mit nicht identifizierbaren Zeilen ein Fehler; im gewöhnlichen UIA-Pfad
bezeichnet die Meldung dann ausdrücklich den sichtbaren Teilbestand. Das gilt
auch, wenn eine mehrdeutige
Tabelle nur passiv gelesen wurde. Dagegen bleibt eine Abfrage, die nur
das angeforderte `maxRows`-Limit erreicht, erfolgreich mit `vollstaendig=false`
und `stopKind=max-rows`. Ein gleichzeitig fehlender Nachweis hat Vorrang vor
dieser absichtlichen Begrenzung.

Beim Tabellen-Readback müssen zwei explizit angegebene Datumsjahre
übereinstimmen. Ungültige Kalendertage gelten auch bei gleichem Text nicht als
bestätigt. Für Datumseingaben ist weiterhin das vollständige Jahr anzugeben;
die gekürzte Produktanzeige wird gegen dieses angeforderte Jahr geprüft.

Der gemeinsame Ergebnisvertrag ist technisch an allen Transportgrenzen
durchgesetzt:

- das lokale Executor-/Worker-/Kompositionsergebnis am API-Rand validieren;
- in Discovery und OpenAPI referenziert werden;
- im MCP-Katalog als `outputSchema` erscheinen;
- das kanonische, pfadredigierte `structuredContent` validieren;
- synthetische Erfolgs-, Fachfehler- und Malformed-result-Tests bestehen.

Zusätzlich vergleicht `test/operation-result-shape.json` die veröffentlichten
Schemas mit den tatsächlich beobachteten Ergebnisformen. Die Trace-Dateien
enthalten nur sichere Feldnamen, wertfreie JSON-Typklassen, Profil, Herkunft
und Ergebnisart. Bei Objektfeldern kommen sichere direkte Schlüsselnamen und
deren Typklassen hinzu; Werte und tiefer verschachtelte Inhalte werden nie
persistiert. Neue
Felder oder Typvarianten sind eine bewusste Vertragsänderung; beobachtete
Typen, die das Schema nicht akzeptiert, brechen den Lauf.

Davon getrennt bleibt die fachliche Live-Evidenz: Ein Schema beweist weder die
Erreichbarkeit jedes UI-Zustands noch alle Schreib-, Rollback- und
Wiederöffnungsvarianten. Doku und Release Notes dürfen daher vollständige
Transportparität, aber keine vollständige praktische UI-Abdeckung aller
Operationen behaupten. Welche Operationen live belegt sind, hält `test/operation-coverage.json` fest.
