# TODO: Tabellen, Fokus und Paketabnahme

Technische Aufgaben zur zuverlässigen SSE-Bedienung. Fachliche Fallprüfungen und
private Diagnosen werden getrennt außerhalb des Repositorys geführt. Dieser Plan
richtet keine automatische Ausführung ein.

## Cursorlauf und Editorzustand

- [x] Bei einem nativen Positionierungsabbruch den tatsächlichen festen
  Produzenten-Code und begrenzte Nachweisflags bis zur MCP-Antwort erhalten.
  Ein pauschales `cursor-proof-failed` darf Modell-, Auswahl-, Editor-,
  Eingabe-Epochen- und Receipt-Abweichungen nicht ununterscheidbar machen.
  Diagnose transportiert keine Werte, Tokens, Bindings oder neue Autorität;
  `outcomeUnknown` bleibt unbekannt und erlaubt keinen Wiederholungsversuch.
- [x] Einen tatsächlich registrierten Qt-Delegate im `indexWidget()`-Inventar
  korrekt behandeln: Nur derselbe zuvor vollständig bewiesene Nr.-Editor am
  weiterhin aktuellen Modellindex in Spalte 0 darf bestehen bleiben. Andere
  Widgets und derselbe Pointer an einem anderen Index bleiben gesperrt.
  Die Regression nutzt den echten `edit()`-/Delegate-Pfad und prüft zusätzlich
  unveränderte Werte, Geometrie, Auswahl, leere QString-Rollen und ItemFlags.
  Diese Policyprüfung ersetzt keine vollständige Producer-/Receipt- oder
  tatsächliche SSE-Abnahme.
- [x] Beim frischen passiven UIA-Mutationszielnachweis den konkreten festen
  Ablehnungsgrund erhalten: Prüfphase, Spaltenindex, begrenzte Zähler und
  Vergleichsbooleans für Header, Zellgeometrie, GridItem und Toggle. Keine
  Zellwerte, Texte, Runtime-IDs oder Autorität ausgeben. Alle bisherigen
  Guards in derselben Reihenfolge beibehalten; auch ein erfolgreiches
  Positionieren ersetzt den vollständigen frischen Zielnachweis nicht.
  Der tatsächliche Helper und die private Fehlerprojektion sind mit
  synthetischen UIA-Gegenfällen geprüft; die reale Fehlerdiagnose steht aus.
- [ ] Bestehende Zielzeilen über eine private, bestätigte Nr.-Positionierung
  erreichen: exakter Modellindex, unverändertes vollständiges Modell,
  originale Eingabe-Epoche und Controller-Lease. CurrentIndex, Auswahl und
  echte Viewport-Sichtbarkeit danach neu beweisen. Keine clicked-Signale,
  Wertschreibzugriffe, freien Tasten oder Wiederholung nach unbekanntem Ausgang.
- [ ] Den schrittweisen HOME-/DOWN-Cursorlauf vollständig abnehmen: genau eine
  Taste pro konsumierter Lease, anschließend frische Modell-, CurrentIndex-,
  Selection-, Fenster- und Eingabe-Epochenprüfung. Bereits ausgeführte Tasten
  nach Abbruch niemals wiederholen.
- [ ] Begrenzte Qt-Verarbeitungszeit nach eigener Taste berücksichtigen; die
  bestehenden Wartezeiten von 350 ms nach HOME und 160 ms nach DOWN prüfen.
  Die bisherige Eingabe-Epoche danach weiterhin prüfen, keine neue Baseline
  setzen und keinen fehlgeschlagenen Schritt wiederholen.
- [ ] Nur einen frisch gebundenen, nachweislich unveränderten Nr.-Editor
  schließen. Erwartete Modellzeile und Spalte müssen vor FocusOut feststehen;
  Wert, ItemFlags, PID, Root, Geometrie und Editoridentität gemeinsam prüfen.
- [ ] Veränderte Nr.-Editoren und andere Editoren im Fehlerpfad offen lassen.
  Die Rückgabe des Vordergrunds darf keinen unbekannten Zellwert bestätigen.
  Lease widerrufen und TOPMOST entfernen, ohne diesen Editor zu verlassen.
- [ ] Fehlende oder fehlerhafte neue Handover-Leases, Nonce-Wiederverwendung und
  unbekannte SendWait-Ergebnisse müssen einen wahrheitsgemäßen Teilzustand und
  eine passive Reconciliation erhalten. Kein Restore mit alter Autorität.
- [ ] Tabellenende nur bestätigen, wenn die letzte native Zeile vollständig
  im tatsächlichen Viewport liegt. Vollständiges Modelllesen allein genügt
  nicht als Nachweis einer bedienbaren Leerzeile.
- [ ] Den aktuellen Nummernanker über frische GridItem-Zeile, Spalte und
  ContainingGrid an das native Modell binden. Headergeometrie ersetzt keine
  semantische Zellidentität. Prozess, Root, direkte Tabellenzugehörigkeit,
  Auswahl und vollständige Zeile im gebundenen nativen Viewport mitprüfen;
  geometrische Abweichungen und jeden fehlenden Nachweis eindeutig diagnostizieren.
- [ ] Native Viewport-Geometrie anhand der frisch gebundenen QObject- und
  Accessibility-Bäume prüfen. Bei einer Abweichung einzelne Bounds-, DPI- und
  Ursprungsbedingungen datensparsam berichten; eine Diagnose lockert weder
  Identität noch Eingabe- oder Sichtbarkeitsgrenzen.
- [ ] Bildschirmrechtecke direkt vom gebundenen Qt-Produzenten übernehmen,
  mit derselben Koordinatenumrechnung wie dessen Accessibility-Rechtecke.
  Windows-DPI beschreibt nicht zwingend den effektiven Qt-Maßstab und darf
  ihn nicht ersetzen. Tabellen- und echte Viewport-Rechtecke in beiden
  Koordinatenräumen binden und vor jeder Eingabe neu prüfen; fehlende
  Produzenten-Evidenz ohne geratene Rückfallumrechnung ablehnen.

## Bedienverhalten und Regressionen

- [x] Boolesche Add-Nachbedingungen über ein frisch gebundenes echtes
  TogglePattern lesen. Eine leere Checkbox-Anzeige ist kein Textwert `false`;
  nur eindeutiges On/Off darf die angeforderte boolesche Nachbedingung beweisen.
  Unbestimmte, unlesbare und fehlende Zellen sowie leere Textfelder bleiben
  abgewiesen. Der synthetische Vertrag prüft den tatsächlichen Add-Readback
  und ist in Voll- und Fast-Suite registriert. Der Schreibweg bleibt
  ValuePattern; eine neue Toggle-only- oder On-Schreibfähigkeit und die reale
  Abnahme sind damit nicht belegt.
- [ ] Add-Rollback auch strukturell beweisen: Wiederhergestellte Betragswerte
  und Kontrollsumme genügen nicht, wenn eine zusätzliche leere Modellzeile
  bestehen bleibt. Finanzielle Rücksetzung und vollständige Wiederherstellung
  der Zeilenstruktur getrennt berichten; den Teilzustand frisch zurücklesen.
- [ ] Virtualisierte Add-Anlegezeilen nach begrenzter Tabellenend-Navigation
  zuverlässig materialisieren. `not-found` beendet den Versuch ohne weitere
  Mutation. Eine nach manuellem Scrollen frisch nachgewiesene Leerzeile ist
  bedienbar, ersetzt aber keinen Nachweis des automatischen Endsuchpfades.
- [x] Die Diagnose des automatischen Add-Endsuchpfades erhalten. Der API-Pfad
  startet nach „Keine freie Tabellenzeile“ bereits einen geschützten
  `table_read(noKeys:false)`; nur dessen vollständiger Erfolg erlaubt einen
  weiteren Add-Aufruf. Fehlgeschlagene oder unvollständige Cursorantworten
  bleiben als begrenzte Diagnose zusammen mit dem ursprünglichen Add-Abbruch
  erhalten. Unbekannter Ausgang, Reconciliation und Cleanup verhindern einen
  weiteren Add; Transportausnahmen erhalten einen konservativen Teilzustand
  ohne Rohfehler oder private Bindings. Mock-Verträge prüfen die Ablehnung,
  Diagnosegrenzen und genau einen Add nach vollständig bewiesenem Erfolg.
  Die tatsächliche Abnahme des installierten Pakets bleibt offen.
  Die Sonderroute für EDV und profilierte Kategorie-Tabellen beweist keinen
  funktionierenden Cursorlauf in allgemeinen Einnahmen-Tabellen. Dafür eigene
  Nachweise mit tatsächlich vollständig sichtbarer Anlegezeile ergänzen.
- [ ] Beim geschützten `table_read(noKeys:false)` einen fehlenden frischen
  Editor-/Fokusnachweis gezielt diagnostizieren und erhalten. Vollständiges
  natives Modelllesen beweist weder Editorfreiheit noch eine bedienbare
  Cursorposition; keine unbewiesenen Keys oder Wiederholung nach Abbruch.
- [ ] Wirkungsloses TreeItem-Invoke als Navigations-No-op erkennen. Die
  aktuelle Seite muss danach dem gebundenen Ziel entsprechen; ein angebotenes
  InvokePattern allein beweist keine erfolgreiche Navigation.
- [ ] GUI-Reaktionsfähigkeit getrennt von Prozess- und API-Lebenszeichen
  prüfen. `GUI_QUEUE_TIMEOUT` mit „Operation cancelled before GUI dispatch“
  bestätigt den Abbruch dieses Aufrufs vor seiner GUI-Ausführung. Jeder Aufruf
  besitzt einen eigenen Pending-Zustand; diese empfangene Fehlerantwort setzt
  keinen bleibenden Transport-Abbruchzustand im Native-Client. `instances`
  und eine laufende API beweisen keine reagierende Qt-GUI. Bei ausbleibender
  Reaktion weitere Zielaktionen und Lese-Wiederholungen pausieren; der
  API-Neustart ist keine belegte Reparatur des GUI-Hängers. Die konkrete
  Hängerursache und eine passende Stackdiagnose bleiben offen; diesen Befund
  nicht als behobenen Fehler oder unveränderten gesamten Fallzustand ausgeben.
- [ ] Den wiederholt beobachteten GUI-Hänger nach einem Seitenwechsel zu einer
  Kosten-Seite mit einer einzelnen Tabelle und vorherigen nativen passiven
  Tabellenreads untersuchen. Der nächste Read liefert `GUI_QUEUE_TIMEOUT` vor
  seinem GUI-Dispatch; anschließend reagiert auch die Anwendung nicht mehr.
  Diese Folge beweist weder einen alten Tabellenpointer noch eine bestimmte
  Ursache im Modell, in der Navigation oder im Provider. Eine neue normale
  Sitzung ohne native Qt-Reads reagierte wieder; das ist keine Reparaturabnahme.
  Frühere Reads aktivieren derzeit die Qt-Accessibility-Schicht dauerhaft.
  Eine Beteiligung ihrer Ereignisverarbeitung beim späteren Seitenwechsel ist
  eine unbewiesene Hypothese. Für die Ursachenklärung wird ein privat gehaltener
  GUI-Thread-Stack mit Modul- und Funktionsnachweis benötigt; keine Feldinhalte
  oder Speicherabbilder in öffentliche Diagnoseprotokolle übernehmen.
- [x] Gewöhnliche passive native Tabellenreads von Accessibility-Aktivierung,
  Provider-Geometrie und optionaler Cursorbindung isolieren. Implementiert ist
  ein reiner QWidget-/QAbstractItemModel-Read mit unveränderten Fenster-, Root-,
  Controller-, Tabellen-, Modell- und Summennachweisen. Die heutigen exakten
  AID-Bindungen für Kfz-Teilsummen und private Cursor-/Mutationspfade bleiben
  erforderlich; keine geometrische Ersatzbindung oder globale Deaktivierung
  fremder Accessibility-Clients einführen. Synthetisch nachweisen: eine anfangs
  inaktive Plattform bleibt nach gewöhnlichem Read inaktiv, kein eigener
  Aktivierungsobserver wird ausgelöst, zerstörte und neu erzeugte Tabellen und
  Modelle liefern keine veralteten Referenzen, und die getrennten privaten
  Pfade behalten Modellinvalidierung und sämtliche negativen Guards.
  Implementierung und synthetische Abnahme: lokal begrenzte Invalidierung vor
  jedem weiteren Modellcallback, Offscreen-Modell-/View-Austausch, öffentliche
  HTTP-Reads mit wiederholtem Modell-/Seitenwechsel ohne Aktivierungsobserver,
  fehlendes Modell und doppelte Tabellen, je ein echter bounded GUI-Stall vor
  Dispatch und während des Modellreads. Der abgesagte Callback bleibt später
  unausgeführt; Unknown bleibt Unknown, kein Replay oder neuer Broker.
  Client-Drucktest füllt und leert die tatsächliche Warteschlange wiederholt,
  einschließlich fragmentierter Antworten und abgewiesener Überlast.
  Der Diagnose-Test korreliert GUI-Phasen über ausdrücklich vor/nach dem Request
  bestätigte monotone Zeitproben desselben GUI-Threads; unterschiedliche
  UTC-Uhren gelten nicht als Eingabe-/Abschlussnachweis. Vollsuite, Installation
  und Live-Abnahme bleiben eigene Gates. Dies beweist keine Behebung des
  tatsächlichen GUI-Hängers.
- [ ] Einen reproduzierten GUI-Hänger auf der Geschenke-Seite nach frischem
  Anwendungsstart untersuchen. Die beobachtete Folge aus normaler Navigation
  beziehungsweise Zellklick und anschließendem Sky-Fensterlesen ist auch ohne
  Textaufnahme und ohne nativen Tabellenread oder Bootstrap reproduziert.
  Erfolgreiche native Initialisierung auf einer anderen Seite verhindert den
  Hänger ebenfalls nicht. Diese Folgen belegen noch keine einzelne Ursache.
  Prozess- und API-Inventar können weiter
  antworten, während die Anwendung nicht reagiert. Keine weiteren Zielaktionen
  daraus ableiten; Stack- und Providerdiagnose sowie eine Reparatur stehen aus.
- [x] Native Ping-Fehler von erfolgreicher Peer-Identität unterscheiden.
  Eine reguläre `ok:false`-Antwort mit `GUI_QUEUE_TIMEOUT` oder
  `GUI_OPERATION_TIMEOUT` enthält nicht
  zwingend die Identitätsfelder einer erfolgreichen Ping-Antwort. Der aktuelle
  Vergleich verdeckte diesen Fehler als Peer-Abweichung. Client-Handshake und
  Broker-Owner-Ping lehnen negative Antworten jetzt getrennt ab, erhalten die
  festen GUI-Timeout-Codes und den expliziten Unknown-Bool und geben keine
  Rohfehler aus. Fehlende oder ungültige Outcome-Evidenz bleibt konservativ
  unbekannt. Alle erfolgreichen Peer- und Owner-Identitätsvergleiche bleiben
  unverändert; keine negative Antwort stellt eine Session bereit. Isolierte
  Byte-Stream-/Broker-Mocks prüfen diesen Vertrag ohne Bootstrap-Wiederholung.
  Installation und tatsächliche Abnahme bleiben offen; der GUI-Hänger wird
  dadurch nicht als repariert ausgewiesen.
- [ ] Sky-Beobachtungen vor einer Zielaktion frisch auf Konsistenz prüfen.
  Ein ausschließlich textueller Snapshot kann Eingabegeometrie auslassen;
  fehlende Bounds nicht aus Textpositionen ableiten, sondern einen frischen
  Screenshot aufnehmen und den gebundenen Zielnachweis erneuern. Nach einer
  Qt-Navigation kann der Accessibility-Baum noch die vorherige Seite zeigen,
  während der Screenshot bereits die neue Seite zeigt. Baum, aktuelle
  Seitenüberschrift und frischer Screenshot müssen zum selben Ziel passen;
  widersprüchliche oder veraltete Beobachtungen erlauben keine Zielaktion.
- [ ] Ein gemeinsames Antwortbudget für mehrstufige MCP-Werkzeuge erhalten.
  API-Arbeit und Cleanup müssen innerhalb dieses Budgets bleiben; die äußere
  Clientfrist darf nicht vorher das strukturierte Teilergebnis verlieren.
  Ein Budgetabbruch beweist keine Quieszenz und erlaubt keinen neuen Schreibversuch.
- [x] Szenario-Fähigkeiten wahrheitsgemäß beschreiben: `scenario_run` führt
  seine begrenzte Schrittfolge seriell über den Executor aus; es hält keinen
  gemeinsamen Tabellen-Worker für alle Schritte. Der Fähigkeitskatalog benennt
  jetzt den eigenen Auftrag je Worker-Schritt und mögliche vorgewärmte
  Arbeitsprozesse; der Vertrag prüft den tatsächlichen seriellen Dispatch.
  Ein Szenario ist
  keine Tabellen-Bulk-API; ein TSV- oder Zwischenablage-Tabellenimport ist
  ebenfalls nicht dokumentiert und darf nicht als vorhandener Weg gelten.
- [ ] Serielle Add-Orchestrierung mit den vorhandenen Nachweisen abnehmen:
  Nur nach `verified:true`, bestätigten Zellwerten und eindeutiger `sumAfter`
  darf diese Summe als `expectedBefore` des nächsten Add dienen. Jeder Add
  behält seine frischen Fall-, Fenster-, Seiten- und Eingabeguards. Nach einem
  begrenzten Block das vollständige typisierte Modell einschließlich aller
  ursprünglichen Zeilen vergleichen. Ein zusätzlicher vollständiger Modellread
  nach jeder erfolgreichen Zeile ist dafür keine neue Pflicht; Teilfehler
  dagegen sofort vollständig abgleichen, den Block stoppen und nicht blind
  wiederholen. Diese Orchestrierung ersetzt weder die Add-Nachbedingungen
  noch eine echte Bulk-Implementierung.
- [ ] Native Tabellen mit mehreren Summen über eindeutige Profil-AIDs und
  ihre wirkliche QObject-Gruppe binden. Dieselbe Tabelle darf beide passenden
  Summen bedienen; eine gemeinsame beliebige Fensterwurzel reicht nicht.
  Alle Modellzeilen und typisierten Werte für Mutationsvergleiche erhalten.
- [x] `suite-runner-contract` an die beabsichtigte Testliste anpassen:
  `table-cursor-step-contract` und `table-native-step-contract` sind im
  Suite-Plan registriert, fehlen aber in dessen Erwartungsliste. Beide Tests
  regulär aufnehmen, keine Prüfungen überspringen oder abschwächen.
- [ ] Private Cursor- und Mutationsautorität nur über eine pro Worker-Prozess
  neu erzeugte Fähigkeit transportieren. Kalter und vorgewärmter Worker müssen
  dieselbe Argumentdatei-Bindung beweisen; öffentliche, doppelte oder für die
  falsche Operation gelieferte Autorität vor jedem UI-Zugriff ablehnen.
- [ ] Bei bestehenden EDV-Zeilen abgeleitete, deaktivierte Nettozellen exakt
  und ausschließlich passiv vergleichen. Für die tatsächliche Schreibzelle
  weiterhin Schreibbarkeit, eindeutige Identität und Fokusbindung verlangen.
- [ ] Die geerbte Eingabe-Epoche durch Update/Delete unverändert forttragen.
  Vor physischer Auswahl und nach dem nativen Nachlesen Fenster-, Fall- und
  Eingabebindung erneut prüfen; fremde Eingabe niemals durch eine neue Baseline
  verdecken. Zielzeile und sämtliche unberührten Zeilen unabhängig vergleichen.
- [ ] Native Display- und Edit-Rollen vor jeder Änderung eindeutig binden.
  Kategorien benötigen die genaue serverseitige Profilspalte und ein eindeutiges
  Display/Edit-Paar aus dem frischen vollständigen Modell. Datumsänderungen
  unterstützen derzeit nur dort bereits belegte Paare; neue unbewiesene Formate
  vor Cursorlauf und Mutation ablehnen. Diese Grenze im Smoke-Test prüfen.
- [ ] Die automatische Änderung einer sichtbaren Datum-Zelle gesondert
  abnehmen. Ein tatsächlicher `table_update` wurde vor der Mutation mit
  `cursor-proof-failed` und
  `mutation-requested-edit-role-unknown-or-ambiguous` abgewiesen. Eine mögliche
  Änderung über Computer Use mit `set_value` bestätigt diesen MCP-Pfad nicht.
  Der gewünschte neue Wert hatte kein bereits belegtes Display/Edit-Paar;
  vorhandene Kopiertests beweisen nur die Wiederverwendung solcher Paare.
  Der native Zellvertrag verliert bislang den QVariant-Metatype und liefert
  keinen zellgebundenen Kalender-, Datumsformat- oder Grenzennachweis. Neue
  Datumswerte benötigen atomare Metatype-/Kalender-/Codec-Evidenz und, falls
  vorhanden, den exakt gebundenen QDateEdit-Vertrag. Keine ISO-Stringheuristik
  oder behauptete Header-/Encoding-Reparatur anstelle dieses fehlenden Beweises.
- [ ] Fokus selbstständig erwerben und nach erfolgreichem Block zurückgeben;
  fremde Eingaben, falsches Fenster, mehrere Hauptfenster und Fokus-No-op
  zuverlässig erkennen. Passives Lesen darf den Vordergrund nicht übernehmen.
- [ ] §-13b-Tabelle: EU und Drittland auswählen, Popup und Editor schließen,
  neue Zeile hinzufügen und Werte sowie Summen unabhängig zurücklesen.
- [ ] Nach erfolgreicher Kategorieauswahl den typisierten ComboBox-Editor
  eigenständig schließen und den Abschluss beweisen. Insbesondere
  `footer-source-focus-unbound` behandeln: unveränderte Eingabe-Epoche,
  geschlossenes Popup und sichtbarer Zieltext allein reichen nicht aus.
  Partiell geänderte Kategorie erhalten, passiv zurücklesen und nicht erneut
  auswählen oder einen unbekannten Editor durch Fokus-Rückgabe bestätigen.
- [ ] Bestehende Zeilen ändern und löschen; nach jeder Mutation neu binden,
  eindeutige Zielzeile und vollständige Vorher-/Nachher-Tabelle beweisen.
- [ ] Tabellen mit mehreren Summenregionen prüfen, insbesondere Kfz-Kosten
  mit und ohne Vorsteuerabzug. Eine Leerzeile darf nie an die falsche Summe
  gebunden werden.
- [ ] Abbruchfälle in synthetischen oder ausdrücklich freigegebenen
  Wegwerffällen prüfen: aktuelle/ausgewählte Zeile verschieden, Modelländerung,
  fremder PID/Root, veraltete Epoche, angeschnittener Viewport, Popup offen,
  unveränderter und veränderter Nr.-Editor, anderer Editor, unbekannte Eingabe.
- [ ] Native Desktop-Start-/WaitAbandoned-Prüfung abschließen. Bei Änderungen
  am C++-Qt-Pfad nativen Build und `npm run test:qt-native` erneut ausführen.
- [ ] Die erste native Edit-Mutation mit einem einmaligen begrenzten
  Fixture-Aufnahmefenster abdecken. Journalplätze nur einmal veröffentlichen,
  GUI-Thread ohne Protokoll-I/O oder Exporter-Lock lassen und vollständigen
  stderr-Drain sowie Überlauf/Trunkierung prüfen. Requestzeit und GUI-Call-ID
  getrennt führen; einen unbekannten Ausgang niemals durch Diagnose oder
  eine spätere bestandene Baseline als erfolgreich erklären.
- [ ] Navigation, Speichern und Wiederöffnen auf exakte Fallbindung prüfen;
  mehrere Instanzen und Wiederherstellung dürfen nicht zum falschen Fall führen.
- [x] Steuerprüfer: Singular und Plural von „Tipp oder Zusatzinformation“
  korrekt parsen; Tipps und Fragen/Warnungen getrennt zählen. Das Konsistenzflag
  darf bei einer Singularüberschrift nicht falsch negativ werden.
  Die isolierten Parserverträge sind geprüft; die tatsächliche SSE-Ausgabe
  gehört weiterhin zur Live-Abnahme des installierten Pakets.
- [x] Den `checker_run`-Start im Gewinn-Erfassungsfall profilgerecht binden.
  Der Einkommensteuerfall behält seinen exakten Seitenknopf; Gewinnermittlung
  und Gewinn-Erfassung verwenden den eindeutig gebundenen Toolbar-Befehl.
  Dessen Off-Zustand wird vor genau einem Invoke geprüft: Toggle allein
  verändert nur Zustand/Vorschau und startet den globalen Prüfer nicht.
  Fallart/Jahr, Fenster, Titel, PID, Steuerung, Muster und vollständiger Baum
  bleiben Pflicht; unbekannte Ausgänge erlauben keinen Replay. Verhaltenstests
  decken negative Bindungen ab; die Live-Fallanlage prüft Start, erneuten
  reinen Read, Ergebnisse und Schließen am synthetischen Folgejahresfall samt
  unverändertem Disk-Hash. Paket- und allgemeine Live-Abnahme bleiben eigene Gates.

## Reihenfolge bis zur Paketfreigabe

Fix47 ist bislang ausschließlich ein geprüfter Quellstand: tote native
Sitzungsbindungen werden nur nach tatsächlichem Exit des eigenen Brokers und
eindeutigem Nichtvorhandensein des Zielprozesses entfernt. Die Vierergrenze und
unklare Bindungen bleiben erhalten. Isolierte Verträge und Review ersetzen
weder vollständige Suite noch Paketbau, Installation oder tatsächlichen
Smoke-Test; diese Freigabeschritte sind für Fix47 noch offen.

1. Quellcode vervollständigen und unabhängigen Review abschließen. Bestehende
   lokale Änderungen nicht überschreiben; erforderliche Regressionen ergänzen.
2. Reale SSE-Fälle ausdrücklich speichern und kontrolliert schließen, bevor
   die volle Offline-Suite läuft. Kein automatisches Verwerfen oder Beenden.
3. Nach dem vollständigen Build die Gates: `npm test`, `npm run pack`,
   `npm run publish:dry-run`, `npm run test:npm-clean-install`.
   Dokumentationsänderungen benötigen zusätzlich `npm run test:fast`.
   `npm run test:qt-native` separat danach ausführen: native Desktop-Fixtures
   und direkte Worker-Verträge teilen den sitzungsweiten Windows-Controller
   und dürfen diese Ressource nicht gleichzeitig belegen.
4. Erst nach grünen Gates die erzeugten lokalen npm-Archive installieren.
   Globales API-Paket und API-Abhängigkeit des MCP-Pakets müssen übereinstimmen.
   Auch die globalen Startprogramme mit `--help` prüfen; identische Moduldateien
   allein belegen keine funktionierenden npm-Bin-Verknüpfungen.
5. Nur die eindeutig gebundene eigene API stoppen/starten; installierte Dateien
   gegen die Archive prüfen. Einen fremden Portinhaber niemals beenden.
6. Smoke-Test über den echten MCP: Preflight, Instanzen/Fallbindung, passives
   Tabellenlesen, Cursorlauf, §-13b-Add/Update/Delete, beide Kfz-Summen,
   Navigation, Fokusübernahme und Rückgabe. Fehler- und Löschtests ausschließlich
   an freigegebenen Testfällen; keine erfundenen Buchungen in echten Fällen.
7. Bei Fehlern Quellcode korrigieren und die betroffenen Gates sowie Paket- und
   Live-Abnahme wiederholen. Veröffentlichungsfreigabe erst nach `npm run check`
   und dem [Release-Prozess](../RELEASE.md). ELSTER-Sperren unverändert lassen.

Offline-Verträge oder grüner Quellcode-Review ersetzen die tatsächliche
SSE-Abnahme des installierten Pakets nicht. Private Protokolle, Steuerdaten,
Paket-Transferhashes und maschinenspezifische Ergebnisse bleiben außerhalb
dieses Repositorys.
