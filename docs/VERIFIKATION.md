# Verifikationsstand

Dieses Dokument trennt veröffentlichte Verträge, Mock-/Quelltests und echte
SSE-Läufe. Ein grüner Vertragstest beweist nicht automatisch, dass jede
UI-Operation auf jeder Jahresversion praktisch funktioniert.

## Inhalt

- [Produkt- und Supportmatrix](#produkt--und-supportmatrix)
- [Was die Tests beweisen](#was-die-tests-beweisen)
- [Einmalige Leistungsbeobachtungen](#einmalige-leistungsbeobachtungen)
- [Agent-Plugin-VM-Matrix](#agent-plugin-vm-matrix-2026-09-01)
- [Aktueller projektlokaler Clean-install](#projektlokaler-clean-install-in-einer-frischen-vm-2026-09-01)
- [Abdeckungsbilanz aus echter Ausführung](#abdeckungsbilanz-aus-echter-ausführung)
- [Browser-Herkunftsprüfung](#herkunftsprüfung-gegen-einen-echten-browser-2026-08-23)
- [`/healthz` unter Hashlast](#healthz-unter-hashlast-2026-08-23)
- [Zustandsreise](#zustandsreise-2026-08-24)
- [Nebenfenster](#nebenfenster-sind-lesbar-aber-nicht-bedienbar-2026-08-24)
- [Kalter Feldzyklus](#kalter-feldzyklus-2026-08-23)
- [Fallanlage live](#fallanlage-live-2026-09-03)
- [Saubere VM](#installations--und-live-lauf-in-einer-sauberen-vm-2026-08-23)
- [Aktuelle Live-Muster-Evidenz](#aktuelle-live-muster-evidenz)
- [Wegwerfkopien](#wegwerfkopien-statt-privater-fixtures)
- [Profilierter Schreibweg](#profilierter-schreibweg)
- [Große Schreibreise](#große-schreibreise)
- [Noch nicht freigegeben](#noch-nicht-freigegeben)

## Produkt- und Supportmatrix

| Profil | Status | Verifizierter Build | aktuelle Kern-Leseevidenz | vollständige Navigation/Prüfer/UStVA | allgemeine Schreibpfade | profilierter Focusless-Commit |
| --- | --- | --- | --- | --- | --- | --- |
| `2025` | `supported` | `31.0.1.0` | letzter vollständiger strikter Grünlauf vor dem terminalen Collect-Zusatz: beide offiziellen Musterfälle und 38 geforderte Operationen; neuer Collect-Erfolg separat live belegt | Navigation, Prüfer und UStVA im letzten vollständigen strikten Gate grün | fünf getrennte Mutationstests plus große Schreibreise grün; keine vollständige VaSt-/Center-Matrix | profilierter Commit im letzten vollständigen strikten Gate grün |
| `2024` | `experimental` | `30.0.127.0` | Opt-in-Live-Gate grün: beide offiziellen Musterfälle, 43 semantische Prüfungen und 38 geforderte Operationen | Navigation, Prüfer und UStVA-Read im strikten Gate grün; daraus folgt keine Freigabe | nicht freigegeben und im Gate als gesperrt geprüft | keiner |

`experimental` bedeutet: Das Profil darf weder vom Setup angeboten noch wie
ein produktiv unterstütztes Jahr behandelt werden. Der Opt-in dient nur der
gezielten Verifikation. Er ist keine Nutzerfreigabe für unbewiesene
Steuerdatenänderungen. API und direkter Worker begrenzen den Opt-in auf
paritätsgetestete Kataloge für Lesen, Navigation, Prüfer/UStVA-Read sowie den
nötigen Wegwerfkopie-Lebenszyklus; Tabellen-, Steuerdaten-, Speicher-, Export-
und VaSt-Mutationen bleiben mit `profile-operation-unverified` gesperrt.
`dialog_answer` gehört nicht zum allgemeinen Katalog: Nur `OK` auf der exakt
titel-, text- und schaltergebundenen passiven Gewinnaktualisierungsnotiz darf
die Worker-Prüfung erreichen. Insbesondere eine Wiederherstellungsdatei wird
nie automatisch verworfen.

## Was die Tests beweisen

Die Spalte **Beweis** beschreibt ausschließlich die Assertions, die der jeweils
genannte Standardbefehl tatsächlich ausführt. Historische Laufzeitwerte stehen
getrennt unter [Einmalige Leistungsbeobachtungen](#einmalige-leistungsbeobachtungen):
Sie sind weder Ausgabe des Standardbefehls noch CI-Grenzwert.

| Ebene | Befehl | Beweis | Nicht bewiesen |
| --- | --- | --- | --- |
| Schnell | `npm run test:fast` | Build, vollständiger Operations-/Toolkatalog, strikte Eingaben, Auth-/Transportgrenzen, Mock-Journeys, Sicherheits- und Quellverträge | reale SSE-UI |
| Vollständig offline | `npm test` | zusätzliche Packaging-, Worker-, Timeout-, Cleanup- und No-Console-Verträge sowie die Abdeckungsbilanz; eine vorhandene Standardinstallation wird identitätsgeprüft, ihr nachweisliches Fehlen bleibt auf neutralen Build-Rechnern zulässig | reale SSE-UI; optionale Fixtures können fehlen |
| Lokales Produkt-Gate | `npm run test:product` | verlangt die unterstützte SSE-2025-Standardinstallation und prüft EXE-, Engine-, Native-, Prozess-, Jahres-, Modus- und Kataloggrenzen fail-closed | Bedienung eines echten Steuerfalls |
| Page-Object-Offlineparität | `node test/page-objects-parity.mjs` | lokaler API-Pfad und echter PowerShell-Worker liefern für jedes Profil denselben Vollkatalog, dieselbe exakte und case-insensitive Seite sowie denselben Unknown-ID-Fehler; Reload, Vorab-Abbruch, lokaler Timeout und budgetierter Drift-Fallback sind separat gebunden | echte Formularfelder oder UI-Zustände |
| Verify-Offlineparität | `node test/verify-local-parity.mjs` | lokaler API-Pfad und echter Worker liefern für vollständige, unvollständige, mehrdeutige und hashabweichende Collect-Stände feldgleiche Ergebnisse; Dezimal-/Währungsformate, Occurrences, Ressourcenidentität, Abort/Timeout ohne Subprozess und riskanter Unicode-Fallback sind gebunden | fachliche Richtigkeit der Erwartungen oder Vollständigkeit des vorausgehenden UI-Collects |
| Arbeitskopie-Offlineparität | `node test/working-copy-local-parity.mjs` | lokaler API-Pfad und echter Worker liefern für lesbaren wie unbekannten AKAD-Kopf denselben Erfolgsvertrag; Fehlerarten für falschen Hash, vorhandenes Ziel, Endungs- und Ordnerfehler sind workergebunden; beide Profile, echte Datei-Ersetzung, Pfadredaktion sowie Abort/Timeout-Cleanup ohne Worker sind geprüft | vollständige Semantik exotischer Dateisysteme, ein hängender einzelner Kernel-I/O-Aufruf oder Ausschluss des dokumentierten Rollback-TOCTOU-Restfensters |
| Fallsicherungs-Offlineparität | `node test/backup-local-parity.mjs` | lokaler API-Pfad und echter Worker liefern denselben Erfolgs-, Wiederholschutz- und bytegleichen CSV-Manifestvertrag auch für verschachtelte Ziele, nichtalphabetische und Nicht-ASCII-Namen; ResourceRefs, Quell-/Zielinventar, zweiter Inhaltsreadback, partielle Manifeste, fremde Zielinhalte sowie Abort-/Timeout-Rollback ohne Worker sind geprüft | vollständige Semantik exotischer Dateisysteme, ein hängender einzelner Kernel-I/O-Aufruf oder Ausschluss des dokumentierten Rollback-TOCTOU-Restfensters |
| Fallarchivierungs-Offlineparität | `node test/archive-local-parity.mjs` | lokaler API-Pfad und echter Worker liefern denselben Erfolg, dieselben zentralen Preflight-Fehlerarten und ein bytegleiches CSV-Manifest; vollständiger Bestand einschließlich `_Backup`, Zeitstempel, ResourceRefs, kein Workerstart, SSE-Prozesssperre vor jeder Entfernung, fail-closed Nicht-POSIX-Delete, Teilmanifest, verschachtelter Rollback, Abort/Timeout sowie Quell-, Ziel-, Restbestands- und Doppelinterferenz mit Recovery-Datei sind geprüft | erneuter echter SSE-Lauf über den neuen Lokalpfad; vollständige Semantik exotischer Dateisysteme oder ein hängender einzelner Kernel-I/O-Aufruf |
| SSE-Prozessguard | `node test/sse-process-guard.mjs` | lokalisierte leere `tasklist`-Antworten, exakter `SSE.exe`-CSV-Treffer und fail-closed Ablehnung leerer, fremder oder unstrukturierter Antworten | jede Windows-Locale und jeder externe Prozessstart im kleinen Fenster nach der zweiten Probe |
| Optionale Live-Skript-Verträge | `node test/live-script-resource-contract.mjs` | Mehrinstanz- und Suchdiagnose verwenden ausschließlich die aktuellen strikten MCP-ResourceRefs; zwei zufällig benannte Wegwerfkopien liegen im konfigurierten `cases:`-Bereich und nur bei unveränderter Dateiidentität plus Quellhash werden diese beiden exakten Dateien nach dem Schließen entfernt | tatsächlicher Zwei-Instanz-Lauf ohne gesetzte neutrale Fixture und installierte SSE |
| Core-Read-Live-Gate | `npm run test:live-core-read` | beide Profile und ihre offiziellen Musterfälle über MCP→API und für UI-Leser weiter zum Worker: Produkt-/Arbeitsbereich, Hash/Arbeitskopie, Start/PID/HWND, Ergebnislesen, HTTP↔kanonisches-MCP, Seiten-/Hilfe-/Tabellen-/Snapshot-/Accessibility-Leser und gebundener Discard-Close | physische Bereichsnavigation, Prüfer, UStVA, Tiefensweep und Steuerfall-Schreibwege |
| Striktes Live-Gate | `npm run test:live` | beide Profile nacheinander, jede vom Profil erlaubte Leseoperation, lokale-gegen-Worker-Falldateiparität, der profilierte Schreibweg, die große Schreibreise, Steuertipps-Center 2025 auf privatem Desktop, echter MCP→API→Worker-Weg für UI-Aktionen, direkter HTTP↔kanonischer MCP-Vergleich, Hash- und Cleanup-Invarianten; fehlende Voraussetzungen sind Fehler | vollständige Mutationsmatrix pro Jahresprofil; VaSt-Dialogwege |
| Center-Live-Gate | `npm run test:live-center` | `center_cases` und `center_refresh` für Profil 2025 über die HTTP-API in „Verzeichnis“ oder „Zuletzt verwendet“, exakte HWND-/Zustandsbindung, Rückkehr in den Ausgangsmodus, pfadredigierte Antworten und Kill-on-close-Cleanup auf einem privaten Desktop; im Verzeichnismodus zusätzlich unveränderter Dateibestand | Profil 2024; VaSt; fachliche Richtigkeit der realen Fallnamen |
| Falldatei-Liveparität | `npm run test:live-case-file` | lokale API-Implementierung und direkter PowerShell-Worker liefern denselben Fallhash sowie dieselbe vollständige Standard-Fallliste des offiziellen Musterordners; keine SSE-UI wird gestartet | ausführliche Parser-Metadaten und UI-Verhalten |
| Workspace-Dateivertrag | `node test/workspace-file-cancellation.mjs` | synchrone/kooperative Listenparität, Abbruch vor und während der Liste sowie nach einem 64-KiB-Hashblock, Hashbudget auch bei verworfener I/O, Deadline ohne Teilergebnis, exakte Trunkierung samt Gleichheitsgrenze, Read-Post-Deadline, Write-Preflight und veröffentlichte Schemas | reales langsames Netzlaufwerk; Abbruch eines bereits laufenden synchronen 1-MiB-Textwrites |
| MCP-Abbruchkette | `node test/mcp-cancellation.mjs` | echter `sse_workspace_files`-Aufruf über MCP-Prozess, HTTP-Client, API-Server und Workspace-Executor; eine deterministische Barriere beweist das API-`AbortSignal`, danach ergeben sich serverseitig `ok=false`, `kind=aborted`, `delivered=false` und ein vollständiger Folgeaufruf | harter Prozessabsturz während des Abbruchs; bereits gestartete synchrone Mutationen |
| MCP/API-Singleton | `node test/mcp-api-supervisor.mjs` | fehlende API wird aus der exakten installierten Dependency gestartet und erreicht Readiness; vorhandene kompatible API und zwei parallele MCP-Starts verwenden dieselbe PID; fremder Portinhaber, andere Paketversion, gleichzeitig gesetztes `SSE_API_URL`/`SSE_API_CONFIG` und unerreichbares autoritatives `SSE_API_URL` stoppen fail-closed; stdout bleibt ein echter MCP-stdio-Kanal | absichtlich manipulierter npm-Cache nach abgeschlossener Installation; Betriebssystemstillstand unterhalb von Node-Netzwerkaufrufen |
| MCP-Preflight | `node test/mcp-preflight.mjs`, `node test/mcp-api-all-operations.mjs` | genau die read-only Folge `workspace_status` → `product_info` → `health`, stabile Setup-/Runtime-Blockercodes, exakter negativer Build-Drift-Nachweis für Installation und laufenden Prozess, kein Auto-Launch und keine Projektion lokaler Pfade; der direkte Operationskatalog bleibt bei 99 | reale Produktinstallation und reale Clientauswahl |
| Worker-Queue-Abbruch | `node test/worker-timeout.mjs` | Vorab-Abbruch auch bei voller Queue bleibt `aborted`; eine echte 32er-Belegung liefert `busy`; 31 abgebrochene wartende Aufträge geben ihre Plätze vor Abschluss des Vorderauftrags frei und starten keinen Worker | Betriebssystemstillstand innerhalb eines bereits gestarteten Worker-/Cleanup-Prozesses |
| Worker-Prewarm und Desktopmarker | `node test/worker-prewarm.mjs` | ein echter leerer Privatdesktop mit gültigem SSE-Marker lässt ausschließlich `product_info` und `page_objects` eine bereite Einmal-Reserve übernehmen; `health` bleibt markiert, Center-Eigentum stoppt in Node und Worker fail-closed. Startup-Timeout, Retry und Cleanup bleiben gebunden; zusätzlich beendet die autoritative Node-Frist einen bereits zugewiesenen blockierenden Warm-Worker an seiner exakten PID, entfernt dessen Argumentdatei, ersetzt ihn und hinterlässt nach Shutdown keinen eigenen Fixture-Prozess | Beschleunigung einer realen UI-Operation oder ein allgemeiner Laufzeitgrenzwert; harter Node-Absturz beziehungsweise Eventloop-Stillstand nach der Warm-Zuweisung |
| Native Fensterenumeration | `powershell -File test/desktop-enumeration-contract.ps1` | Unicode-Inhalt und Ergebnistypen stimmen für drei echte Fenster mit dem bisherigen Weg überein; leere PID-Freigabe und doppelte PID bleiben stabil. Ein frischer C#-Thread bindet sich an einen neu erzeugten leeren Privatdesktop und belegt direkt über `SSEWindowEnumerator.Describe` mit nichtleerer PID-Freigabe den legitimen `FALSE`/Fehlercode-0/kein-Callback-Pfad. Callback-Ausnahme, Win32-Fehler und ein Abbruch nach begonnenem Callback sind deterministisch fail-closed und statisch an den produktiven P/Invoke-Pfad gebunden; zwei gleich große Fenster behalten die rohe `EnumWindows`-Reihenfolge | ein echter Betriebssystemfehler während einer produktiven Enumeration oder fremde Fensteränderung zwischen zwei getrennten Snapshots |
| Steuerfall-Bindungsentscheidung | `powershell -File test/case-binding-contract.ps1` | nur ein vollständiger exakter Titel darf bei internen Decision-only-Aufrufern die Kommandozeilenabfrage überspringen; gekürzte Titel, Command-line-Fallback und Abfragefehler fragen sie weiterhin ab und behalten ihre bisherige Entscheidungssemantik, `save`/`save_as` behalten ihre vollständige öffentliche Bindungsevidenz | ein nach der Bindung wechselnder Fenstertitel |
| Recovery-Antwort-Policy | `powershell -File test/recovery-answer-policy-contract.ps1` | die reine Entscheidung hinter `dialog_answer` erlaubt `Nein` nur dateigebunden (Pfad plus 64-stelliger Hash) oder mit `discardUnsavedRecovery=true` für eine nachweislich ohne Falldatei gestartete PID; `Ja`, halbe Bindungen, das Flag außerhalb der Wiederherstellungsfrage, Flag plus Bindung und Flag bei Dateistart scheitern mit festen `kind`-Werten | ein Prozess, dessen Kommandozeile den Fall verschweigt |
| desktop_stop-Policy | `powershell -File test/desktop-stop-policy-contract.ps1` | genau ein Hauptfenster bleibt der sanfte Weg, mehrere bleiben `ambiguous`; ohne Hauptfenster beendet nur `discardChanges=true` die markierte PID hart, sonst `confirmation-required` | der eigentliche Prozessstop und die Markerentfernung |
| Fallanlage-Komposition | `node test/case-create-contract.mjs` | `case_create` ruft gegen einen Skript-Worker exakt die Folge `instances, desktop_status, launch, instances, ui_state, subpages, click×3, menu, menu_click, dialog_list, file_dialog_select, instances`; offene Instanz, versteckter Desktop, vorhandenes Ziel, falsche Endung und Abbruch starten nichts; falsche Assistentenseite, gesperrter Menüeintrag, fehlender nativer Dialog und gescheiterter Speicherdialog beenden die gestartete PID ohne Speichern; nach einer existierenden Datei wird nie geschlossen oder gelöscht; ein gekürzter Fenstertitel ohne Worker-Hash wird lokal gegen den Dialog-Readback geprüft | die echten Klick- und Dialogwege des Produkts |
| Prozess-Kommandozeile | `powershell -File test/process-command-line-contract.ps1` | der begrenzte read-only Native-Pfad liefert für einen echten Unicode-Prozess exakt dieselbe Kommandozeile wie CIM, verliert bei Wiederholung keine Handles und fällt bei nicht lesbaren PIDs, leerem Ergebnis, `null` oder Ausnahmen nur für die betroffenen PIDs auf den bestehenden CIM-Weg zurück | zukünftige Windows-Version ohne die interne Informationsklasse; fremde oder geschützte Prozesse mit abweichenden Zugriffsregeln |
| Prozessende beim Schließen | `powershell -File test/process-exit-wait-contract.ps1` | fehlende, ungebundene und bereits freigegebene Prozessobjekte sowie `null`, ungültige oder geschlossene Handles werden abgelehnt; lebend, Exit während des Waits, bereits beendet und Timeout 0/negativ bleiben unter Windows PowerShell 5.1 signalgesteuert. Alle Close-Wege verwenden denselben gepinnten SafeHandle direkt über `WaitForSingleObject`; `WAIT_FAILED` wird dynamisch und jeder andere unbekannte Rückgabewert im Quellvertrag fail-closed geprüft | ein tatsächlich von einem produktiven Prozess-Handle gelieferter unbekannter Kernel-Rückgabewert, Kernelstillstand in `WaitForSingleObject` oder das fachliche Verhalten eines realen SSE-Speicherdialogs |
| Begrenzte MSAA-Punktprojektion | `powershell -File test/describe-point-basic-contract.ps1` | exakt die drei internen Klick-/Dialogproben verwenden den begrenzten Native-Pfad; Ergebnisform, gemeinsame Felder und vollständiger Diagnosepfad bleiben statisch und per Reflection gebunden | reale Qt-/Accessibility-Provider-Parität und Laufzeit; andere Accessibility-Provider und zukünftige Qt-Versionen |
| UIA-Proxy-Zustand des Workers | `powershell -File test/uia-proxy-state-contract.ps1` | an einem echten Fenster mit Titelleiste sieht der native Baumlauf nach einem vorangestellten PowerShell-`FromHandle` weder einen TitleBar-Teilbaum noch geladene Client-Side-Proxies; ohne diesen Aufruf lädt der .NET-UIA-Client die Proxies und zeigt die Titelleiste; der Worker-Quelltext stellt den PowerShell-Aufruf dem nativen Lauf voran | dass künftige .NET-Framework-Updates den Stack-Walk in `ProxyManager.LoadDefaultProxies` beibehalten – ändert er sich, schlägt genau dieser Vertrag an und die Proxy-Entscheidung muss bewusst neu getroffen werden; Qt-/SSE-Fenster selbst |
| Dirty-State-Bindung | `node test/dirty-state-binding-contract.mjs` | `Get-DirtyState` bekommt nirgends im Worker ein Argument, das den Baum erst erzeugt; `table_read` bindet den Sichern-Schalter vor und nach dem Lesen ueber `Get-DirtyStateFast`, und beide Wege lesen nachweislich denselben Knoten `MainToolBar.tb_sichern` | dass die gezielte Abfrage und der Baumlauf am laufenden Fenster denselben Wert liefern - das ist gemessen (7 Runden identisch), aber nicht statisch beweisbar; die Laufzeit selbst |
| Online-Update-Angebot | `powershell -File test/update-prompt-contract.ps1` | der Update-Dialog von SteuerSparErklärung wird als `updatePrompt` gekennzeichnet und an beiden Meldewegen ausgegeben; nahe Verfehlungen (andere Dialogart, Titelschreibweise, fehlendes `Abbrechen`, fremder Text) bleiben ungekennzeichnet, und `Weiter` steht nachweislich nicht in der Liste beantwortbarer Schalter – ein Programmupdate lässt sich also nicht auslösen | der genaue Wortlaut des Herstellerdialogs in künftigen Versionen; die Kennzeichnung ist rein informativ und erweitert keine Rechte, ein Fehltreffer bliebe daher folgenlos |
| Tabellenregion-X-Sweep | `powershell -File test/table-region-contract.ps1` | Grenzen, AID-Vorrang, Referenzen, Ergebnisformen, deterministische Gleichstände und 64 reproduzierbare Ergebnisvergleiche gegen den alten Labelscan | reale UIA-Snapshot-Laufzeit; Koordinaten außerhalb des ganzzahligen Windows-UIA-Vertrags; eine Laufzeitgrenze |
| BelegManager-Projektionsindizes | `powershell -File test/receipt-manager-action-contract.ps1` | Zustände: ordinale Suffixe, Sichtbarkeit, deaktivierte und doppelte Treffer, Überlappungen, exakter Fingerprint, Node-Identität sowie Altparität für gerichtete und 32 deterministische Fälle. Liste: exakte Ergebnis-/Fehlerparität für 0, 1 und 30 Zeilen samt Zählerreihenfolge, Grenzen und Shuffles. Lineare Zugriffswächter begrenzen wiederholte Node-Klassifikation | der reale UIA-Walk und ein live virtualisierter GridPattern-/COM-Pfad; andere Qt-/Produktversionen; eine Laufzeitgrenze |
| Worker-Prozessbaum-Cleanup | `node test/worker-inherited-pipe.mjs` | ein echter Windows-Enkelprozess hält nach beendetem Parent geerbte stdout/stderr-Handles offen; fehlendes `close` verriegelt nach beiden Cleanup-Wächtern die globale Worker-Laufzeit mit `worker-isolation-lost`, bevor selbst ein bereits abgebrochener Folgeaufruf die Queue betreten kann | Identifikation oder automatische Beseitigung eines bereits vom beendeten Parent entkoppelten fremden Prozessbaums |
| Sitzungsweiter Worker-Controller | `node test/worker-controller-lock-contract.mjs` | fester `Local\`-Mutex, zero-wait `busy` vor Desktop/Build/Dispatch, exakte statische Bypaesse, Policy-Praezedenz, graceful Release, Typkollision fail-closed, beobachtete Aufgabe mit offenem Peer-Handle und die bewusst nicht behauptete dauerhafte Crash-Erkennung ohne Peer-Handle | persistente Crash-Taint ueber das Ende aller Kernel-Handles; menschliche Interferenz (separate Input-/Foreground-Waechter) |
| HTTP-Body-Abbruch | `node test/api-client-body-abort.mjs` | Aufruferabbruch nach bereits gelieferten HTTP-Headern beendet verzögerte Operations- und Discovery-JSON-Streams; ein echter falscher `Content-Type` bleibt `protocol`, cancelt aber einen laufenden 64-MiB-Body und schließt den serverseitigen Socket innerhalb 500 ms | ein nicht abbrechbarer Kernel-/Netzwerkaufruf unterhalb des Node-Streams |
| HTTP-Transportfehler | `node test/api-client-transport-timeout.mjs` | Header-/Body-Timeoutcodes injizierter Alternativtransporte werden eindeutig als `timeout` klassifiziert; ein echter Defaulttransport-Reset nach nachweislich empfangenem Mutations-POST wird samt direktem `ECONNRESET` zu `transport-unknown`; ein danach real verweigerter Verbindungsaufbau bleibt `network` und nennt `ECONNREFUSED` | unbekannte Fehlerformen fremder Transportimplementierungen |
| Loopback-Defaulttransport | `node test/api-local-http-transport.mjs` | produktiver Client ist von globalem `fetch` unabhängig; echter POST, Loopback-/Bodygrenze, Nullbody-Status 204/205/304, Redirect-Stopp und Abbruch nach Headern sind geprüft | hängender einzelner Kernelaufruf unterhalb von Node-Streams |
| CLI-Aufrufjournal | `node test/api-cli-contract.mjs` | exklusives create-only JSONL, vor dem API-Aufruf geflushter `pending`-Stand, dauerhafter vollständiger Erfolg und fachliches `ok=false`, lokaler Fehlerabschluss sowie unveränderte Kollisionsdatei ohne API-Aufruf | Wiederanlauf nach Prozess-/Stromausfall und serverseitige Transaktionswiederaufnahme |
| Herkunftsprüfung statt Anmeldung | `node test/api-contract.mjs` | die API antwortet mit 403 auf `Origin`, auf `Sec-Fetch-Site` ungleich `none`, auf einen Nicht-Loopback-`Host` und auf mehrere `Host`-Kopfzeilen; ein lokaler Aufruf ohne diese Kopfzeilen und `Sec-Fetch-Site: none` bleibt erlaubt | ein Reverse-Proxy, der die Herkunftskopfzeilen vor der API entfernt; andere lokale Prozesse desselben Windows-Kontos |
| Lokaler PDF-Renderer | `node test/pdf-render-helper.mjs` | Windows-PDF-API rendert ein echtes synthetisches PDF ohne Zusatzruntime in eine PNG-Datei; Seiten-/Breitenlimit und create-only Zielkollision liefern kompaktes JSON; der dedizierte Windows-PowerShell-Prozess flusht stdout und neutralisiert den auf einer echten Windows-11-VM beobachteten WinRT-Abschlusscode 2170 | OCR-Qualität realer Scans, passwortgeschützte oder defekte PDFs |
| Statische API-Vertragsdokumente | `node test/api-static-document-cache.mjs` | Discovery und OpenAPI werden beim Serverstart je einmal größenbegrenzt als UTF-8 serialisiert; wiederholte GETs bleiben byteidentisch und selbst eine spätere interne Mutation eines nur flach eingefrorenen Schemaobjekts verändert den veröffentlichten Snapshot nicht | Signatur oder langfristiges HTTP-Caching über Prozessneustarts; Einzeloperations-Discovery bleibt dynamisch serialisiert |
| UStVA-Kompositionsbudget | `node test/ustva-contract.mjs` | Seiten-Read und gebundene Mutation verwenden eine deterministisch geprüfte absolute Deadline; verbrauchtes Restbudget und Vorab-Abbruch verhindern jeden Folge-Workerstart | Scheduler-/Kernelstillstand innerhalb eines bereits gestarteten Workeraufrufs |
| Folgejahr-UStVA-Live | `npm run test:live-ustva-next-year` | Profil 2025 öffnet eine bytegleiche `GewErfass2026`-Wegwerfkopie ausschließlich mit `einurvor`; MCP→HTTP-API→Worker liefert die UStVA-Übersicht 2026, lässt ELSTER gesperrt, verändert den Dirty-State beim reinen `ustva_read` nicht weiter und hält die Testkopie über SHA-256 unverändert | UStVA-Mutationen 2026, Speichern, ELSTER oder andere 2026er Fallarten; die Navigation zur automatisch erzeugten UStVA kann SSE-intern bereits `ungespeichert` setzen |
| Windows-CI und npm-Publish | `node test/github-workflow-contract.mjs` | `.node-version` entspricht der gepinnten Build-Runtime; die normale CI bleibt read-only. Der getrennte manuelle npm-Workflow ist an `v<version>` gebunden, verwendet nur Contents-Lesen plus OIDC, keine npm-Secrets, npm 11.19.0, Vollsuite und Clean-install und veröffentlicht die API vor dem von ihr exakt abhängigen MCP | ein grüner GitHub-Hosted-Windows-Lauf für den tatsächlich zu mergenden SHA; erster manueller npm-Bootstrap und danach echter OIDC-Publish vom Release-Tag |
| Release-Artefakte | `node test/dist-artifacts-contract.mjs`, `node test/native-build-cache.mjs`, `node test/npm-package-contract.mjs` | quellbasiertes Pruning stoppt vor Fremddateien; der Native-Build verwendet nur eine quell-, DLL-hash- und vollständig oberflächengeprüfte Binärdatei wieder und baut nach Quelländerung, DLL-Manipulation, unvollständiger Assembly, strengem Schemafehler oder fehlender DLL rückstandsfrei neu; der API-Tarball enthält Windows-Runtime/Profile, aber keinen MCP-Server; der Windows-x64-MCP-Tarball enthält den Supervisor, keine Runtime-Duplikate und eine exakte normale API-Dependency | byteidentischer frischer Native-Neubau auf unterschiedlichen Build-Hosts; Signatur/Authentizität veröffentlichter Registry-Artefakte |
| npm-Clean-install | `npm run test:npm-clean-install` | packt beide Tarballs, installiert in einem neuen Windows-x64-Präfix aber nur das MCP-Tarball und beweist über eine lokale Registry, dass npm die exakt passende API automatisch installiert; direkte API-Installation bleibt separat geprüft; alle Bin-Einstiege starten mit `--help` | veröffentlichter Registry-Download und echter Lauf mit installierter SSE |
| Agent-Plugin-Manifeste | `node test/agent-plugin-contract.mjs` | generierte Agent-Plugins-1.0-, MCP-, Marketplace-, Codex- und Claude-Kompatibilitätsmanifeste stimmen mit einer Metadatenquelle überein; Skill, Runtime-Lock, Dateien, Hashes, Drittanbieterlizenzen und exakte Versionen sind driftgebunden; der MCP-Eintrag enthält weder Paketmanager noch Netzwerkziel | Verhalten der installierten Codex-/Claude-Code-Clients und ihre tatsächlichen Cache-/Scope-Regeln |
| Agent-Plugin-Runtime | `node test/agent-plugin-runtime.mjs` | kopierte self-contained Runtime startet auf Windows x64 ohne `node_modules`, Paketmanager-PATH oder Registry; echter MCP-Handshake, gebündelter API-Autostart, Singleton-Wiederverwendung, protokollreines Fehler-stdout sowie Hash-, Containment- und Versions-Fail-closed sind geprüft | einmaliger Git-Download, target-spezifische Plugin-Sichtbarkeit, Update und Entfernung in einem echten Client |
| Große Schreibreise | `npm run test:live-journey` | eine zusammenhängende Reise auf einer Wegwerfkopie: Tabellenschreibzyklus mit Kontrollsummen-Readback, hashgebundenes Speichern mit Datei- und Neustart-Persistenzbeweis, UStVA-Schreibquartett mit Zahllast-Kontrolle, CSV-Export bis zur Datei, Menü-/Fenster-/Dialogverwaltung, Speichern unter und Archiv | VaSt-Dialogwege, Steuertipps-Center |
| Einzelprofil-Live | `npm run test:live-muster` | gezielter profilabhängiger Musterlauf für Diagnose | das jeweils andere Profil |
| Focusless | `npm run test:hidden-focusless` | ein konkret profiliertes 2025-Feld mit Feld-/Summen-/Dirty-State-Readback; im strikten Gate enthalten | andere Felder; 2024; sichtbare Tabellen-/Combo-Pfade |

## Einmalige Leistungsbeobachtungen

Die folgenden Vorher-/Nachher-Werte wurden am 2026-09-01 auf demselben
lokalen Entwicklungsrechner während der jeweiligen Änderung erhoben. Sie
dokumentieren die Entscheidungsgrundlage, nicht einen automatisierten
Leistungsvertrag. Die zugehörigen Standardbefehle in der Tabelle oben prüfen
Ergebnisparität, Grenzen und strukturelle Ursachen; sie behaupten keinen dieser
historischen Zeitwerte.

| Pfad | Messaufbau und Provenienz | Beobachtung | Nicht daraus ableitbar |
| --- | --- | --- | --- |
| Begrenzte MSAA-Punktprojektion | einmaliger Live-Vergleich des vollständigen und begrenzten Native-Pfads auf demselben realen Qt-Raster mit 432 Punkten; gemeinsame Felder wurden paarweise verglichen | alle gemeinsamen Felder waren gleich; zwei Läufe sparten 214 beziehungsweise 334 ms (11–17 %) | allgemeine Beschleunigung auf anderen Accessibility-Providern oder Qt-Versionen |
| Tabellenregion-X-Sweep | einmaliger entwicklungsinterner A/B-Harness mit 4.000 synthetischen Knoten und identischen Ergebnisdigests; der Harness ist kein Bestandteil des Standardtests | Median ausgeglichen: 17.576 auf 88 ms; Median textlastig: 7.752 auf 56 ms | Zeit für Erzeugung eines realen UIA-Snapshots oder eine belastbare CI-Schwelle |
| BelegManager-Zustand | optionaler diagnostischer A/B/BA-Lauf mit 800 synthetischen Knoten, drei Warmups und 31 Messpaaren; aktivierbar mit `$env:SSE_RECEIPT_STATE_BENCHMARK='1'; powershell -File test/receipt-manager-action-contract.ps1` | historischer Median: 61,4 auf 4,5 ms (13,6×) | dieselbe Beschleunigung beim realen UIA-Walk; der Diagnosemodus gibt aktuelle Hostwerte aus, prüft aber keinen Grenzwert |
| BelegManager-Liste | optionaler diagnostischer A/B/BA-Lauf mit 800 synthetischen Knoten und 30 Zeilen, drei Warmups und 31 Messpaaren; aktivierbar mit `$env:SSE_RECEIPT_LIST_BENCHMARK='1'; powershell -File test/receipt-manager-action-contract.ps1` | historischer Median: 47,2 auf 23,8 ms (1,98×) | Zeit eines live virtualisierten GridPattern-/COM-Pfads; der Diagnosemodus gibt aktuelle Hostwerte aus, prüft aber keinen Grenzwert |

## Agent-Plugin-VM-Matrix, 2026-09-01

Die Plugin-First-Anleitung ist in der unabhängigen vollständigen
Windows-11-x64-VM-Kopie `CleanWin11-SSE-agent-plugin-20260901-root` aus kaltem
Snapshot vollständig geprüft. Die VM hatte keine Shared Folder; Credentials
wurden weder in das Transferarchiv aufgenommen noch in die VM kopiert. Das aus
Commit `56b86bd27755a8d043019ef4e9dee0ea6c915411` erstellte Archiv enthielt 53
Einträge, kein `node_modules` und keine Credentials. Host- und Guest-Hash waren
identisch: `c7874f26834142cf17ff0ec451341188149311d87b53e53bc31a21a953676410`.

Nur die Installationsphase hatte einen verbundenen virtuellen NIC. Vor dem
Runtime-Lauf wurde der Link über VirtualBox auf `off` gesetzt; im Gast waren
null Adapter `Up` und ein ausgehender TCP-Probeversuch scheiterte. Online- und
Offline-Phase sind grün. Die Agent-Plugin-VM-Matrix ist damit für den ersten
Plugin-Release beta.33 keine Release-Sperre mehr.

Ein isolierter realer Client-Probelauf belegt bereits einen engeren
Registrierungsvertrag. Mit `plugins@1.3.4` und Codex CLI
0.151.0-alpha.7.2 schrieb
`plugins@1 add ... --target codex --scope project --yes` Cache, Marketplace und
Konfiguration; der reine Readback `codex plugin list --json` meldete
anschließend trotzdem
`not installed`. Erst
`codex plugin add steuer-spar-erklaerung@plugins-cli --json` registrierte
v0.1.0-beta.33 als `installed, enabled`. Beim Claude-Code-Ziel zeigte der
einzelne zielgenaue `plugins@1 add`-Lauf den Eintrag als `enabled`. Diese
Evidenz war der Vorläufer des nun grünen Online-Kaltlaufs. Der abschließende
Lauf ergänzt Offline-Preflight, Runtime, idempotente Wiederholung, Entfernung,
Singleton und Portkonflikte. Ein Update über zwei Plugin-Versionen ist für
beta.33 nicht anwendbar, weil beta.32 noch kein Agent Plugin enthielt; dieser
Nachweis wird erstmals für den Nachfolger von beta.33 Pflicht.

Ein älteres Probe-Home wurde verworfen, weil
`codex plugin list --json` dort beim vermeintlichen Readback unerwartet selbst
nativen Cache-/Konfigurationszustand materialisierte. Belastbar sind deshalb
nur der unveränderte Failure-Lauf `064048Z` und der native Success-Lauf
`064512Z`. Der Readback ist kein vorgesehener Installationsschritt, darf bei
dieser Alpha-Version aber auch nicht als garantiert seiteneffektfrei gelten.

| Ziel | Nachweis | Stand |
| --- | --- | --- |
| Codex | `plugins@1.3.4 add` mit explizitem `--target codex`, danach target-nativ `codex plugin add steuer-spar-erklaerung@plugins-cli --json`; dieselbe zweistufige Folge ein zweites Mal | grün: beide Folgen stabil; `installed, enabled`; native Entfernung und Readback erfolgreich |
| Claude Code | zielgenaues `plugins@1.3.4 add --target claude-code --scope user`; native Anzeige und Entfernung mit Claude Code 2.1.252 | grün: `Version: 0.1.0-beta.33`, `Scope: user`, `Status: enabled`; Offline-Selftest aus dem nativen Cache und anschließender User-Scope-Uninstall erfolgreich |
| Audit-Hygiene | Abschlussinventur nach den Online-Installationen | grün: keine hinterlassenen Runtime-/Auditprozesse und keine Credential-Dateien |
| Self-contained Runtime | Workspace ohne `node_modules`; MCP-Start ohne npm, npx und Netzwerk; kein separates API-Terminal; stdout protokollrein | grün: beide installierten Cachekopien listeten je 100 Tools; beide echten `sse_preflight`-Aufrufe meldeten ausschließlich `SSE_NOT_RUNNING` als erwarteten Produktblocker |
| Wiederholung und Update | erneutes zielgenaues `plugins@1 add`; bei Codex zusätzlich der target-native zweite Schritt; danach Versions- und Preflight-Readback | grün für idempotente beta.33-Wiederholung; Zwei-Versionen-Update für den ersten Plugin-Release nicht anwendbar und ab beta.34 Pflicht |
| Entfernung | Codex target-nativ; Claude Code mit zurückgelesener ID und `--scope user`; Nutzerdaten bleiben erhalten | grün: beide Client-Readbacks zeigen den Eintrag danach nicht mehr als installiert; nur verifizierte API-PIDs wurden beendet |
| Singleton und Konflikte | zwei parallele Starts verwenden dieselbe PID; fremder Portinhaber und alte API stoppen fail-closed | grün: genau eine beta.33-API PID 7088; fremder Listener blieb erhalten; eine beta.32-API PID 6656 wurde abgelehnt und unverändert weiter bedient |

Der VM-Lauf lieferte außerdem drei reproduzierbare rote Befunde, aus denen
bereits Korrekturen entstanden:

1. Der ausgelieferte Runtimebaum enthielt zunächst sechs Fixture-/Testdateien,
   die nicht im Runtime-Lock standen. Der Produkt-Build schließt sie inzwischen
   aus und prüft Baum und Lock auf exakte Gleichheit.
2. Der Selftest-Harness erwartete für einen CLI-Readback fälschlich genau eine
   Ausgabezeile, obwohl die CLI valides Pretty-JSON schreibt. Diese
   Harnessannahme ist korrigiert.
3. Der Harness brach `tools/call` nach 180 Sekunden ab, obwohl der etablierte
   MCP-Vertrag 300 Sekunden vorsieht. Der Harness verwendet nun dieses Budget.

Ein früherer Offline-Versuch war nach einer externen VM-Pause am WSL-Backend
abgebrochen. Der abschließende Lauf startete den kalten Snapshot neu und
klassifizierte den damaligen scheinbaren MCP-Fehler: Beide Preflights waren
transportseitig erfolgreich und nannten nur den erwarteten fachlichen Blocker
`SSE_NOT_RUNNING`. Die API blieb dabei in v0.1.0-beta.33, wurde von beiden
stdio-Probes unter derselben PID wiederverwendet und danach exakt beendet.

Der Claude-Entfernungstest deckte außerdem eine Installergrenze auf:
`plugins@1.3.4 --scope project` erzeugte einen als `project` angezeigten
Zustand, den Claude Code 2.1.252 target-nativ weder aus dem Installationsordner
noch aus dem Benutzerprofil entfernen konnte. Die Wiederholung mit
`--scope user` war vollständig symmetrisch: native Anzeige `enabled`, echter
Offline-Runtime-Start aus dem Cache und erfolgreicher
`claude plugin uninstall ... --scope user`. Der öffentliche Claude-Quickstart
verwendet deshalb den verifizierten User-Scope.

Der Lauf hält außerdem die aktuelle Installergrenze fest:
`plugins@1.3.4` benötigt für das einmalige Klonen Git auf `PATH`, ignoriert den
Scope bei Codex und schreibt für beide Ziele in clientverwaltete
Benutzer-Caches beziehungsweise Konfiguration. Das ist kein Nachweis physischer
Projektisolation. OpenCode gehört nicht zu dieser Matrix. Ein gebautes Plugin,
ein Installer-Exitcode oder ein MCP-Handshake allein hätte weiterhin nicht
genügt; grün ist die Matrix erst durch den vollständigen Runtime- und
Client-Readback.

## Projektlokaler Clean-install in einer frischen VM, 2026-09-01

Ein eigener Windows-11-x64-VM-Klon mit Node 24.12.0 und npm 11.6.2 erhielt
nur das gepackte MCP-Release-Artefakt. Eine lokale Fixture-Registry stellte
dabei die noch unveröffentlichte, exakt passende API-Version bereit. Der Lauf
belegte, dass npm die API als normale exakte Dependency transitiv installiert,
kein `postinstall` benötigt wird und beide Pakete dieselbe Version tragen.

Die damalige optionale `skills add`-Installation lief für Codex und Claude Code
durch. Ein isoliertes `CODEX_HOME`, das ausschließlich das exakte Auditprojekt
als vertrauenswürdig kannte, schloss eine Übernahme globaler MCP-Einträge aus.
Die Codex CLI listete den Server aus `.codex/config.toml` und bestätigte dessen
exakte Node- und MCP-Pfade. Claude Code 2.1.252 wurde ohne Anmeldedaten
installiert; `claude mcp add --scope project` erzeugte eine `.mcp.json` mit den
erwarteten absoluten Pfaden und der API-Konfiguration. OpenCode war nicht
installiert, wurde nicht als Client getestet und wird nicht als unterstützt
beansprucht.

Zwei gleichzeitig gestartete `--selftest`-Prozesse verwendeten nach einem
absichtlich provozierten Start-Rennen denselben ausdrücklich gesetzten
projektlokalen `SSE_API_CONFIG`-Pfad und denselben API-PID; eine exakte
Kommandozeilenabfrage fand danach genau einen passenden `node.exe`-Prozess. Ein
echter MCP-SDK-Handshake listete 101 Werkzeuge, rief `sse_preflight` auf und
hielt stdout protokollrein. Der erwartete Preflight-Blocker `SSE_NOT_RUNNING`
bestätigte, dass die Produktanwendung im Installationsaudit nicht still
gestartet wurde. Zum Abschluss wurde ausschließlich der zuvor über Paketname,
Version und Kommandozeile identifizierte API-PID beendet. Danach waren der Port
geschlossen und kein passender API-Prozess mehr vorhanden; der readonly Share
wurde entfernt und der eigene VM-Klon regulär heruntergefahren.

Dieser Lauf beweist den Kandidaten-Tarball sowie die projektlokale Konfiguration
der echten Codex- und Claude-Code-CLIs. Er beweist nicht den späteren Download
aus der öffentlichen npm-Registry, einen modellgesteuerten Tool-Aufruf aus
Codex oder Claude Code, einen OpenCode-Clientstart oder die Bedienung eines
realen Steuerfalls.

Die lokale Orientierungsmessung vom 2026-08-17 nutzte nach fünf Warmups 100
sequenzielle Loopback-GETs je Gesamtdokument. Der Discovery-Mittelwert sank von
2,207 auf 1,374 ms, OpenAPI von 5,865 auf 1,983 ms; die dynamische
Einzeloperations-Discovery blieb mit 0,391 gegenüber 0,337 ms praktisch im
Messrauschen. Diese Werte begründen den begrenzten Cache, sind aber keine
plattformübergreifende Leistungsschwelle.

Für den ungeformten MCP-Erfolgspfad wurde auf demselben Rechner ein
synthetischer 5.000-Knoten-Snapshot mit 1.130.179 UTF-8-Bytes nach zehn
Warmups in sieben Runden zu je 30 Antworten gemessen. Drei Prozessläufe lagen
vor der Optimierung bei 82,8 bis 85,5 ms Median und danach bei 14,4 bis
14,6 ms. Der Vertrag prüft keine flüchtige Zeitgrenze, sondern die Ursachen:
Bei `textValue === apiResult` darf jedes Ergebnisfeld nur einmal rekursiv
gelesen werden; dieselbe redigierte Struktur speist Text und
`structuredContent`. Strings ohne `/`, `\\` oder `%` überspringen die sechs
Pfadregexe, weil keine unterstützte lokale Pfadform ohne diese notwendigen
Zeichen auskommt. Geformte Texte und Antworten mit ausgelagerten Binärfeldern
bleiben getrennte Darstellungen.

Der Laufzeitkatalog ist die Quelle für die aktuelle Anzahl und Benennung der
Operationen. Am genannten Stand enthält er 100 API-Operationen und 101
MCP-Werkzeugnamen. Das sind keine eindeutigen Eins-zu-eins-Zuordnungen:
`sse_change_field` und `sse_change_known_field` rufen beide
`tracked_set_value` auf; `checker_detail` ist eine API-interne Komposition von
`sse_checker_open`. Zusätzlich komponiert `sse_preflight` drei bereits
vorhandene read-only API-Operationen, ohne den API-Katalog zu erweitern.

Fixture-gesteuerte Diagnoseprogramme sind ebenfalls Teil des wartbaren
Vertrags: Sie dürfen nicht jahrelang erfolgreich `SKIP` melden, während ihre
MCP-Argumente längst vom öffentlichen Schema abgewiesen würden. Der statische
Live-Skript-Vertrag bindet deshalb die tatsächlich geschriebenen Argumentnamen
an die strikten Laufzeitschemas. Beim Mehrinstanztest muss
`SSE_MULTI_INSTANCE_FIXTURE` direkt im über `SSE_CASE_DIR` konfigurierten
Fallordner liegen. Die Quelle wird nur gehasht; zwei eindeutig benannte
Arbeitskopien werden über `sourceRef`/`targetRef` erzeugt und nach dem
gebundenen Schließen nur dann einzeln entfernt, wenn `dev`/`ino` und SHA-256
weiterhin den test-eigenen Stand beweisen. Ersetzte oder geänderte Ziele bleiben
bewusst zur manuellen Klärung erhalten. Ein rekursiver Cleanup des Fallordners
ist ausdrücklich ausgeschlossen.

Alle Operationen besitzen getestete Eingabeschemata und einen versionierten
`Result_<operation>`-Mindestvertrag. API, Discovery, OpenAPI und alle
MCP-`outputSchema`-Definitionen verwenden diesen Katalog; ein malformed
Worker-Ergebnis wird vor der Ausgabe mit `invalid-operation-result` gestoppt.
Die Schemas bleiben für zusätzliche Fachfelder offen. Deshalb ist „alle
Operationen transportseitig validiert“ weiterhin nicht mit „jede mögliche
UI-Ergebnisvariante live erzeugt“ gleichzusetzen.

### Ergebnisform-Bilanz

`test/operation-result-shape.json` wird am selben API-Executor-Rand wie die
Operationsabdeckung erzeugt. Pro Operation und Scope speichert sie nur:

- Top-Level-Feldname und wertfreie JSON-Typklasse;
- bei Objektfeldern sichere direkte Schlüsselnamen und deren Typklassen;
- Herkunftsmarke des Harnischs;
- Erfolg oder Fachfehler;
- optional die öffentliche Profil-ID.

Steuerwerte, lokale Pfade und tiefer verschachtelte Inhalte werden weder in die
Trace-Dateien noch in die Bilanz geschrieben. Der Offline-Stand vom
2026-08-16 enthält 645 Operation-Feld-Beobachtungen außerhalb des
generischen Transportumschlags; 502 davon sind bereits explizit typisiert.
Das ist eine sichtbare Ausbaubilanz, kein Prozentwert für praktische
UI-Abdeckung. Alle 100 Operationen besitzen konkrete Fachfelder; darunter sind
alle 30 destruktiv annotierten Operationen sowie der nicht destruktive, aber
zustandsbehaftete `set_value`-Suchfeldpfad. 143 beobachtete Zusatz- und
API-Grenzfelder bleiben vom offenen Mindestvertrag durchgelassen, ohne schon
als stabile Einzelfelder zugesagt zu werden.

Für die zuletzt direkt an den Worker-Emit-Stellen auditierten 30 Operationen
gilt eine zusätzliche Mock-Ratsche: Jedes beobachtete Top-Level-Feld außer dem
generischen API-Metafeld `resourceRefs` muss im operationsspezifischen Schema
stehen. So können historische Mock-Namen wie `find.treffer` statt `find.hits`
oder ein fiktiver Steuerfeld-Write über `set_value` nicht erneut als
Laufzeitevidenz gelten. Der statische Guard zählt derzeit 638 explizite
Top-Level-Felder in 75 echten Worker-Operationsblöcken; API-interne
Kompositionen werden separat an ihren TypeScript-Executoren geprüft. Derselbe
Guard sichert berechnete `ok`-Ausgaben als Ratsche ab: Jeder mögliche Fehlerzweig muss
`kind` und `error` tragen. Dadurch wurden zwei `close`-Varianten und der
fail-closed `menu_close`-Nachbedingungsfehler vor dem Commit korrigiert.

Die Live-Spalte der Ergebnisform-Bilanz enthält jetzt 234 fachliche
Feldbeobachtungen aus 31 echten 2025-Worker-Operationen; 122 davon sind
explizit typisiert. Der Lauf deckte zunächst einen echten Vertragsfehler auf:
`find.note` wurde bei nicht abgeschnittenem Baum als PowerShell-Leerobjekt
serialisiert und vom Textschema mit `invalid-operation-result` gestoppt. Der
Worker gibt deshalb nun ausdrücklich `null` aus; dieselbe Normalisierung gilt
für die optionalen Hinweise von `positions` und `dismiss`.

Der anschließende Lauf passierte diesen Vertrag, scheiterte aber später beim
bekannten Prüfer-Navigationszweig dreimal fail-closed an der Foreground-Lease.
Die bis dahin echten, unverändernden Reads wurden über den vorgesehenen
monotonen Live-Merge übernommen. Das ist eine partielle Ergebnisform-Evidenz,
kein grüner strikter Live-Gate-Lauf und kein neuer 2024-Nachweis. Historische
79/88-Live-Abdeckung und Ergebnisform-Spalte bleiben getrennte Messungen; die
Feldformen werden niemals aus der Coverage-Zahl abgeleitet.

Bewusste Regeneration nach einer getesteten Vertragsänderung:

```powershell
$env:SSE_WRITE_OPERATION_SHAPE = '1'
npm test
Remove-Item Env:SSE_WRITE_OPERATION_SHAPE
```

Der Abschlussvertrag stoppt bei neuen Feld-/Typvarianten und wenn ein
beobachteter Typ vom veröffentlichten Schema abgewiesen würde. Ein zusätzlicher
statischer Worker-Feldguard schützt optionale Recovery-Pfade, die nicht in
jedem deterministischen Lauf erscheinen.

## Abdeckungsbilanz aus echter Ausführung

`test/operation-coverage.json` ist keine handgepflegte Behauptung: Die
verhaltenstragenden Testharnische protokollieren jede Operation, die einen
echten API-Executor erreicht, und der letzte Schritt von `npm test` vergleicht
das Protokoll mit dem Katalog. Die Bilanz ist eine Ratsche in beide
Richtungen – verschwundene Abdeckung ist eine Regression, neue Abdeckung muss
mit `SSE_WRITE_OPERATION_COVERAGE=1` bewusst übernommen werden.

Seit 2026-08-28 trennt die Laufzeitverfuegbarkeit diese historischen
Funktionsnachweise ausdruecklich von einer aktuellen Freigabe. Nur
`receipt_manager_list` ist `focusless-read` und erreichbar. Die neun
BelegManager-Wege fuer Navigation, Detailauswahl und Mutation sind als
`foreground-required` klassifiziert und sowohl an der API- als auch an der
direkten Worker-Grenze gesperrt. Ein gueltiger Aufruf liefert strukturiert
`foreground-required-operation-disabled` und ist nicht wiederholbar. API und
MCP starten dafuer weder Worker noch UIA; ein direkter Worker-Aufruf stoppt vor
Dispatcher und UIA. An API und MCP bleibt ein ungueltiger Aufruf ein normaler
`bad-args`-Fehler; der direkte Worker prueft an dieser aeusseren Grenze nur den
Transport und blockiert vor der dormanten semantischen Operationsvalidierung.
Die nachstehenden Snapshot-/VM-Nachweise belegen die
historische Implementierung und ihre Guards, nicht ihre heutige
Laufzeitverfuegbarkeit.

Fünf ausdrücklich mit `liveEvidence: "snapshot-vm"` markierte BelegManager-
Operationen bilden die einzige Ausnahme vom aktuellen Hostlauf: Der PC kann
bereits benutzereigene Belegentwürfe enthalten, die ein Test weder löschen noch
als Ausgangsfixture übernehmen darf. Diese fünf Nachweise stammen aus dem
getrennten privaten Snapshot-VM-Gate; der Host importiert dafür keine alte
Trace-Datei und behauptet nicht, sie in jedem `npm run test:live` wiederholt zu
haben.

Gezählt wird nur der API-Rand. Operationen, die eine Komposition oder ein
Szenario intern aufruft, gelten damit nicht automatisch als geprüft; sie
brauchen einen eigenen Aufruf über die HTTP-Grenze.

Stand: 100 der 100 Operationsvertraege werden im Offline-Lauf mindestens einmal
funktional ausgeuebt – als erfolgreicher Aufruf oder, bei den neun aktuell
gesperrten BelegManager-Wegen, als vollstaendig passender globaler Policy-Block
mit unveraendertem Zustand. Das geschieht überwiegend gegen den zustandsbehafteten
synthetischen Worker, der Seitengraph, Elementbaum, Tabelle, Menü, VaSt-Dialog
und Fenster-/Desktopzustand modelliert. Das beweist Argumentbindung,
Ressourcenauflösung, Komposition, Ergebnisvertrag und Redaktion über die
gesamte Kette. Es beweist ausdrücklich **nicht** die proprietäre UIA-Schicht;
dafür zählt allein die Live-Spalte derselben Bilanz, die echte Worker-Aufrufe
gegen die installierte Anwendung füllen. Dort stehen am 2026-09-03 94 der 100
Operationen: 81 aus dem strikten Host-Gate einschließlich `collect` und der
beiden Center-Operationen sowie fünf BelegManager-Operationen und `instances`,
die erfolgreich in einer Snapshot-VM ausgeführt wurden, plus die lokal
ausgeführten BelegManager-Wege `receipt_manager_update`,
`receipt_manager_classification_options`, `receipt_manager_classify`,
und `receipt_manager_link`, den lokal geprüften `fill_fields`-Plan sowie den
grünen VM-Lauf von `receipt_manager_bulk_upsert`. `collect` ist auf der
profilierten ESt-2025-Startseite ohne `Weiter` erfolgreich mit `end-of-branch` belegt:
genau eine Seite, kein Navigationsschritt hinter dem gespeicherten Stand und
hashgleicher Datei-Readback. Der getrennte Zwei-Seiten-Lauf belegt weiterhin
`collection-incomplete`, `limit-reached` und den hashgebundenen Teilabgleich.
„Vollständig" gilt dabei nur für den ab der jeweiligen Startseite erreichbaren
Blätterpfad, nicht für den gesamten Steuerfall. Noch nie erfolgreich live
abgeschlossen sind die sechs VaSt-Wege `vast_apply`,
`vast_dialog_read`, `vast_mapping_options`, `vast_mapping_select`,
`vast_row_details` und `vast_row_set_expanded`. In der Snapshot-VM erreichte
jeder davon ohne den erforderlichen Zertifikat-PIN kontrolliert den echten
`not-found`-Fehlerpfad; die Mehrinstanz-Übersicht war mit genau einer Instanz
funktional.

Der BelegManager-Nachweis verwendete ausschließlich eine synthetische PDF und
den direkten VM-Runner: `receipt_manager_list` las zunächst eine vollständige
leere Liste, `receipt_manager_import` legte genau einen Entwurf an, hielt den
Quell-SHA-256 stabil und bewies eine geänderte Vorschau, `receipt_manager_read`
las die gebundenen Detailfelder, und `receipt_manager_delete` entfernte genau
diese Zeile über den profilierten Bestätigungsdialog. Der abschließende
Listen-Readback war wieder vollständig leer. `receipt_manager_action` bewies
zusätzlich `list -> start -> list`. Der Steuerfall blieb bei jedem Schritt
`ungespeichert=false`; es wurde nicht gespeichert und ELSTER nicht geöffnet.

Der neue Ein-Prozess-`receipt_manager_bulk_upsert` wurde am 2026-08-26 nach
Restore des sauberen VM-Snapshots mit derselben hashgebundenen synthetischen
PDF gegen eine Einwegkopie grün ausgeführt. Import, alle sieben gesetzten
Werte und der Abschlusszustand `completed-verified` wurden real verifiziert;
der Plan startete genau einen Worker und benötigte 98,561 Sekunden. Der
öffentliche Detailread blieb beim von Qt neu vergebenen technischen
Zeilenfingerprint bewusst `postcondition-failed`. Für den Bulk-Plan band er die
Zeile zusätzlich eindeutig an exakten Titel und Inhaltsfingerprint; erst ein
separater vollständiger Listenread nach Freigabe der Foreground-Lease mit
hashgleichem semantischem Zeilen-Multiset hob den Zwischenzustand auf. Der
synthetische Beleg wurde anschließend exakt gebunden gelöscht, die Liste auf
vier vorhandene Zeilen zurückgeführt und SSE ohne Speichern geschlossen.

Die lokale Vorher-/Nachher-Messung vom 2026-08-26 verwendete auf demselben
Wegwerffall mit 21 Ausgangsbelegen zweimal dieselbe synthetische, SHA-gebundene
PDF. Import, alle sieben Felder und unabhängiger Abschlussreadback waren beide
Male `completed-verified`. Der erste Lauf benötigte 37,531 s; nach Ersatz der
Feld-für-Feld-Vollbaumprojektionen durch exakt gebundene Live-Readbacks
25,568 s (−31,9 %). Die neuen Phasenwerte wiesen 10,203 s Import, 6,609 s
Update, 4,799 s Abschluss-Detailread und 2,520 s Listenreads aus. Ein weiterer
Update-Lauf änderte einschließlich Netto-Checkbox zwei Werte in 15,009 s
Gesamtzeit und blieb vollständig verifiziert. Beide Testbelege und ein durch
einen absichtlich falschen Dateityp erzeugter Entwurf wurden exakt gebunden
gelöscht; der Fall wurde ohne Speichern geschlossen und das Quellfixture blieb
unter SHA-256
`6C14AD6871F72E811B16FCB1CA65586FE95FBD99393A1648C5C8D19C64C4AA00`
unverändert.

`fill_fields` wurde am selben Tag lokal an einer verworfenen Kopie eines
synthetischen Fahrzeugfalls erfolgreich live geprüft. Zwei Felder wurden mit
exakten Vorwerten und Seitenepoch in einem Worker geändert, gemeinsam als
`completed-verified` zurückgelesen und in einem zweiten ebenso gebundenen Plan
auf `Chevrolet Camaro` und `N-CC999` zurückgesetzt. Der Änderungsplan benötigte
8,753 Sekunden, davon 8,735 Sekunden Worker-Aktionszeit, bei drei internen
Operationen und genau einem Worker. Danach wurde die Kopie ohne Speichern
geschlossen; ihr Quellfixture blieb SHA-256-identisch.

Der lokale BelegManager-Nachweis vom 2026-08-25 band einen zuvor importierten
Amazon-Beleg an Zeilen-, Listen- und Detailfingerprint. Ein einzelner
`receipt_manager_update`-Aufruf setzte Titel, Datum, Belegnummer, Betrag,
USt-Satz und Notiz; `net=false` war bereits korrekt. Feld-, Listen- und
Detail-Readback waren vollständig verifiziert, der Entwurfsmarker verschwand,
Anzahl und übrige Zeilen blieben unverändert. Nach gebundenem Schließen und
erneutem Öffnen des BelegManagers waren dieselben Werte weiter vorhanden. Der
Aufruf speicherte den Steuerfall nicht und öffnete ELSTER nicht.

Der erweiterte lokale Nachweis desselben Tages las alle elf profilierten
Kategorien, ordnete `Arbeitsmittel` mit Dialog- und Detail-Readback zu und
verarbeitete eine Amazon-Rechnung in einem einzigen
`receipt_manager_bulk_upsert`-Aufruf von SHA-gebundenem Import bis zum finalen
Feld- und Kategorien-Readback. Ein abgeschnittener langer Dateipfad wurde vor
dem Import erkannt; nach atomarem WM_SETTEXT-Readback lief derselbe gebundene
Aufruf erfolgreich. `receipt_manager_link` verknüpfte eine Ausgangsrechnung
mit der exakt gebundenen Steuerseite `Einnahmen: Lotterie`, brach den separaten
Dialog zur Werteübernahme bewusst ab, um keine Tabellenzeile zu duplizieren,
und bestätigte die gespeicherte Verknüpfung nach erneutem Öffnen.

Der Center-Nachweis startet ausschließlich den profilierten 2025-Center in
einem neuen Windows-Desktop und bindet den gesamten Prozessbaum an einen
Kill-on-close-Job. Ein vorhandener Center-Prozess, Desktop oder Marker ist ein
Fehler und wird niemals übernommen. `center_cases` liest sowohl „Verzeichnis“
als auch „Zuletzt verwendet“. Nur der Verzeichnismodus besitzt einen einzelnen
gebundenen Ordner; dort bleibt der intern gelesene absolute Pfad nur im
Testprozess, API-Antwort und wertfreier Operation-Trace enthalten ihn nicht.
Vor und nach `center_cases` → `center_refresh` → `center_cases` werden in diesem
Modus Name/Typ/Größe/Zeitstempel/Inhalt der angezeigten Top-Level-Dateien in
eine nicht rückrechenbare Inventarsignatur überführt. „Zuletzt verwendet“
liefert dagegen ausdrücklich `dateisystemVerglichen=false` und behauptet keine
Ordnerkonsistenz.

Der echte Lauf am 2026-08-25 belegte drei grüne API-Schritte im persistenten
Modus „Zuletzt verwendet“, zwei sichtbare Fälle, unveränderte Suche/Sortierung,
die Rückkehr in denselben Modus und null verbleibende Center-Prozesse.
`center_refresh` aktiviert kurz den jeweils anderen Modus über das tatsächlich
seitenwirksame `InvokePattern` und danach wieder den exakt gelesenen
Ausgangsmodus. Ein reines `TogglePattern` änderte im realen Qt-Center zwar den
UIA-Haken, aber nicht die Seite und ist deshalb kein Erfolgsweg. Scheitert die
zweite Aktivierung, bleibt die Operation fail-closed, kann den Ansichtsmodus
aber nicht blind restaurieren.

Das Endurteil ist doppelt fail-closed: Sowohl der inhaltsgebundene Seitenbaum
als auch der kleinere Navigationsbaum müssen ungekürzt sein. Fehlt `Weiter`
in einem abgeschnittenen der beiden UIA-Snapshots, liefert `collect`
`snapshot-truncated` statt eines falschen `end-of-branch`.

Der gezielte 2025-Lauf protokollierte `collect ok=true` in 1.613 ms und räumte
seine SSE-PID vollständig auf. Der anschließend unveränderte Prüfer-Tree-Klick
erhielt in derselben Desktop-Sitzung dreimal keine Foreground-Lease und stoppte
jeweils vor dem Klick mit `interference`. Deshalb wird hier nur der gemessene
Collect-Weg hochgestuft; ein neuer vollständiger Grünlauf des gesamten Gates
wird daraus ausdrücklich nicht abgeleitet.

### Die Live-Bilanz informiert, steuert aber keine Freigabe

Das gehört ausdrücklich hierher, weil es leicht zu überschätzen ist: Die
Abdeckungsbilanz ist **Dokumentation, keine Laufzeitsperre**. Die API liest
niemals `test/operation-coverage.json`; `capabilities.liveEvidence` liefert
stattdessen einen fest kompilierten Release-Snapshot, den ein Vertragstest an
die erzeugte Bilanz bindet. `affectsAvailability=false` und
`profileSpecific=false` benennen seine Grenzen maschinenlesbar. Ein Profil mit
`status=supported` und `operationAccess=full` gibt den Profilkatalog frei;
zusätzliche globale Laufzeitregeln wie die oben dokumentierte
BelegManager-Sperre bleiben vorrangig. Die Live-Evidenz allein schaltet keine
Operation frei oder aus. Gemessen am 2026-09-03 sind noch 6 der 100 Operationen nicht
live-funktional belegt: die oben genannten sechs VaSt-Wege. Damit sind 94
Operationen `functional`, sechs `error-path-only` und keine `untested`.
Zwei davon (`vast_apply`, `vast_mapping_select`) fallen in die
Klasse `destructive`.

Das ist kein Widerspruch zu den Sicherheitszusagen: Jede dieser Operationen
trägt weiterhin ihre eigenen Vor- und Nachbedingungen, die Hash-, Fenster-
und Readback-Bindung sowie die Versandsperre. Es heißt aber, dass „vom Profil
freigegeben" und „live bewiesen" zwei verschiedene Aussagen sind. Wer die
Live-Spalte als Freigabeliste liest, liest sie falsch. Eine Kopplung beider
Ebenen wäre möglich – sie ist bewusst noch nicht gebaut, weil eine
Laufzeitsperre auf Basis einer Testdatei den umgekehrten Fehler erzeugen kann:
eine funktionierende Operation zu blockieren, weil das Gate zuletzt an einer
fremden Benutzereingabe gescheitert ist. Die tatsächliche Sperre bleibt allein
`capabilities.operationPolicy`.

Der aggregierte Wert ersetzt keinen Jahresnachweis: Das strikte Live-Gate
fordert zusätzlich für **jedes** Profil 38 erfolgreiche, profilmarkierte
Operationsaufrufe aus dem expliziten Lese-/Navigationsvertrag – darunter
Ergebnislesen, Snapshot/Accessibility, Prüfer, UStVA sowie die hashgebundene
Wegwerfkopie. Reine API-Lokalpfade sind darin absichtlich keine
Worker-Aufrufe. Eine erfolgreiche Ausführung des jeweils anderen Jahres kann
diese Pflicht nicht erfüllen.

Die Bilanz hatte außerdem den größten vermeidbaren Prozesspreis gezeigt:
`case_hash` und `list_cases` brauchten im frischen PowerShell-Worker jeweils
rund 1,1 bis 1,4 s, ohne die Oberfläche zu berühren. Seit 2026-08-16 laufen
Fallhash und Standard-Fallliste im API-Prozess; die Hashberechnung streamt,
die Fallliste liest je Datei höchstens 512 KiB Kopf. Der feldgenaue Vergleich
auf beiden offiziellen Musterordnern ergab identische acht Hashfelder sowie
identische, gleich geordnete Listen mit 11 Fällen (2025) und 14 Fällen (2024).
Der Vergleichslauf am 2026-08-16 brauchte beim Hash lokal 6/7 ms statt
1.160/1.140 ms im Worker und bei der Liste lokal 16/19 ms statt 1.233/1.327 ms
im Worker (2025/2024). Das sind orientierende Messwerte, keine harte
Testschwelle. Der direkte Worker bleibt für ausführliche Metadaten, unbekannte
Parserfälle und kompatible lokale Aufrufer erhalten.

`listWorkspaceFiles` bleibt als synchroner Referenzpfad für den
Containment-Vertragstest erhalten. Jeder API-, MCP- und Szenarioaufruf von
`workspace_file_list` läuft kooperativ: Nach jeder vollständig
containment-geprüften Ordner-/Dateieinheit und nach höchstens 64 KiB Hash-I/O
erhält Node einen echten Eventloop-Turn und prüft anschließend Clientabbruch
sowie Restzeit. Das Hashbudget beträgt 16 MiB pro Datei und 64 MiB pro Liste;
gelesene Bytes eines wegen gleichzeitiger Änderung verworfenen Hashes werden
nicht zurückgebucht. Bei Abbruch
oder Deadline wird keine Teilliste veröffentlicht. Erreicht eine erfolgreiche
Liste dagegen das fachliche Dateilimit, sucht sie containment- und
deadline-gebunden genau einen weiteren Treffer: Nur dessen Existenz setzt
`truncated=true`; ein vollständig geprüftes Verzeichnis liefert
`truncated=false`. Ein orientierender Lauf am
2026-08-17 mit 1.000 Ein-Byte-Dateien und deaktivierten Hashes brauchte lokal
1.279 ms synchron und 1.378 ms kooperativ; während des kooperativen Laufs
konnten 1.001 Timer-Ticks abgearbeitet werden. Die Werte enthalten keinen
HTTP-Transport, hängen stark vom Dateisystem ab und sind keine Testschwelle.
Ein separater 16-MiB-Einzelhash am selben Tag brauchte 10,9 ms synchron und
24,2 ms kooperativ, lieferte denselben SHA-256 und ließ währenddessen 14
Timer-Ticks zu. Auch diese Werte sind nur eine lokale Orientierung; der
zusätzliche absolute Preis kauft die gebundene Abbruchlatenz zwischen
64-KiB-Blöcken.
Die auf 1 MiB begrenzten Text-Lese-/Schreibpfade prüfen Abbruch und Deadline
vor dem Dateizugriff; Lesen verwirft außerdem ein nach Fristende fertiges
Ergebnis. Ein bereits exklusiv begonnenes synchrones Schreiben wird nicht als
Timeout umetikettiert, weil ein solcher Fehler einen unsicheren Retry
nahelegen würde.

Auch `page_objects` hatte trotz rein öffentlicher Profilmetadaten pro Aufruf
einen frischen Worker gestartet. Drei direkte 2025-Workerläufe am 2026-08-16
brauchten 997/987/1.007 ms. Der neue API-Pfad las, validierte und redigierte den
vollständigen 2025-Katalog in 1.000 aufeinanderfolgenden Aufrufen im Mittel in
2,957 ms je Aufruf; Transportzeit ist darin nicht enthalten und der Messwert
ist keine Testschwelle. `test/page-objects-parity.mjs` bindet die semantische
Parität für 2024 und 2025 an den echten Worker, einschließlich dessen
case-insensitiver ID-Auflösung. Das Live-Gate prüft weiterhin den öffentlichen
API-/MCP-Weg; den dort nicht mehr gestarteten Worker-Katalogpfad beweist dieser
Offline-Test separat.

`verify` war derselbe unnötige Prozesspfad für eine reine, bereits
hashgebundene JSON-Auswertung. Drei direkte Workerstarts ohne fachliche Arbeit
brauchten am 2026-08-16 1.236/1.103/1.077 ms. Der lokale Executor brauchte für
1.000 aufeinanderfolgende vollständige Hash-, Stabilitäts- und
Vergleichsaufrufe nach dem Review insgesamt 655,730 ms, im Mittel 0,656 ms. Beide Werte sind
orientierende Messungen ohne Transport und keine Testschwelle. Der lokale
Pfad liest die höchstens 16 MiB große Quelle einmal gepuffert und hasht sie
danach nochmals ungepuffert über stabile Dateihandles. Er prüft SHA-256 und
Dateiidentität, parst strikt UTF-8/JSON und rechnet Dezimal-
differenzen per `BigInt` mit Half-to-even-Rundung. Bei Unicode-Faltungen oder
manuell gebauten Quelltypen, deren Windows-PowerShell-Semantik Node nicht
beweisbar gleich abbildet, verwendet er mit dem verbleibenden Zeitbudget den
echten Worker. Der Paritätstest beweist beide Wege; ungültige Quellen oder ein
nicht-boolesches `vollstaendig` bleiben fail-closed.

Auch `make_working_copy` hatte trotz reiner Dateiarbeit einen frischen Worker
gestartet. Bei einer synthetischen 1-MiB-Falldatei brauchten drei direkte
Workerläufe am 2026-08-16 1.112/1.086/1.073 ms, der lokale Executor
24,0/11,7/10,5 ms. Das sind orientierende Messwerte ohne HTTP-Transport und
keine Testschwelle. Der lokale Pfad verwendet `wx+` für ein atomar neues Ziel,
streamt die Bytes über dauerhaft offene Handles und verifiziert danach Quelle
und Ziel erneut über Hash, Identität und Dateizustand. Quellenänderung rollt
nur die nachweislich eigene Kopie zurück; ein fremd verändertes Ziel bleibt zur
manuellen Klärung erhalten. Weil Node die exklusiveren Windows-Share-Modi des
Workers nicht ausdrücken und kein `DELETE_ON_CLOSE` setzen kann, beweist der
Vertrag Erkennung statt Verhinderung sowie das verbleibende kleine
Rollback-TOCTOU-Fenster. Der PowerShell-Pfad bleibt als direkte
Kompatibilitätsschnittstelle und Paritätsreferenz bestehen. Open-Aufrufe sind
deadlinegebunden; die Kopierschleife prüft kooperativ zwischen 1-MiB-Blöcken.
Da Node laufende `FileHandle`-Operationen nicht sicher abbrechen kann, kann ein
einzelner hängender Kernel-/Netzlaufwerkaufruf die Frist überschreiten. Das
eigentumsgeprüfte Cleanup wird auch nach Fristablauf zu Ende geführt.

`backup_cases` nutzt über API und MCP jetzt dieselbe lokale, hash- und
identitätsgebundene Kopiergrenze. Bei einer synthetischen 1-MiB-Falldatei
brauchten drei direkte Workerläufe am 2026-08-16
1.104,6/1.106,8/1.112,5 ms, der lokale Executor 47,0/35,5/38,4 ms. Die Werte
enthalten keinen HTTP-Transport und sind keine Testschwelle. Der
Offline-Paritätstest vergleicht zusätzlich das CSV-Manifest byteweise mit
Windows PowerShell 5.1. Quell- und Zielinventar werden während des Laufs exakt
gebunden; fremde Einträge führen zu einem fail-closed Ergebnis und bleiben zur
manuellen Klärung erhalten. Für Node-Dateihandles und Rollback gelten dieselben
Share-Mode-, Kernel-I/O- und TOCTOU-Grenzen wie bei `make_working_copy`.
Der frühere Live-Nachweis von `backup_cases` lief noch über den Worker. Der nun
ausgelieferte API-/MCP-Lokalpfad ist deshalb bis zum nächsten strikten Live-Gate
als offline workerparitätisch, nicht als erneut live ausgeführt, belegt.

`archive_cases` vermeidet über API und MCP ebenfalls den frischen Worker, ohne
die Sicherungsregeln auf einen schnellen Rename zu reduzieren. Bei einer
synthetischen 1-MiB-Falldatei brauchten drei direkte Workerläufe am 2026-08-16
1.201,3/1.188,4/1.195,1 ms. Der lokale Produktionspfad einschließlich zweier
echter fail-closed `tasklist.exe`-Prüfungen brauchte
790,5/875,8/841,9 ms. Die Werte enthalten keinen HTTP-Transport und sind keine
Testschwelle. Der lokale Pfad kopiert in ein exklusiv neues Ziel, übernimmt
`atime`/`mtime`, verifiziert Ziel und noch offenen Quell-Handle vollständig und
entfernt erst danach den Quellnamen. Sein Manifest ist bytegleich zum Windows-
PowerShell-Worker. Rollback läuft auch nach Clientabbruch oder Deadline zu
Ende; bei fremdem Ziel wird aus dem offenen Originalhandle restauriert, und
ein gleichzeitiger Quell-/Zielkonflikt erzeugt eine explizit gemeldete,
hashverifizierte Recovery-Datei statt Originalbytes zu verlieren.
Die große Schreibreise vom 2026-08-14 belegt die fachliche Archivoperation real,
lief aber noch über den Worker. Der neue lokale API-/MCP-Pfad ist daher bis zum
nächsten strikten Live-Gate als offline workerparitätisch, nicht als erneut live
ausgeführt, belegt.

## Herkunftsprüfung gegen einen echten Browser, 2026-08-23

Die API kennt keine Anmeldung. Ihre einzige Zugangsgrenze ist die Annahme, dass
ein Browser die Kopfzeilen `Origin`, `Sec-Fetch-Site` und `Host` zwingend setzt
und eine Webseite sie nicht fälschen kann. Diese Annahme wurde nicht simuliert,
sondern mit einer echten Seite in einem echten Browser geprüft.

Aufbau: die laufende API auf `http://127.0.0.1:43127`, daneben eine Angriffsseite
auf `http://127.0.0.1:8099` — ein anderer Port und damit eine echte fremde
Herkunft. Die Seite versuchte fünf `fetch`-Varianten und zusätzlich einen
HTML-Formular-POST auf `close`.

Ergebnis aus dem Netzwerkprotokoll des Browsers:

| Versuch | Ergebnis |
| --- | --- |
| `POST /v1/operations/close` per HTML-Formular | **403 vom Server** |
| `GET /healthz` | `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` |
| `POST /v1/operations/health` | Preflight abgewiesen |
| `POST` mit `text/plain` ohne Preflight | abgewiesen |
| `fetch` mit `mode: "no-cors"` | abgewiesen |

Der Formular-POST ist der aussagekräftigste Fall: Er löst keinen Preflight aus,
der Browser sendet ihn also wirklich ab, und keine CORS-Regel steht davor. Dass
er mit `403` und `code: "forbidden"` beantwortet wird, belegt die Prüfung im
Server selbst — nicht bloß eine Browserhöflichkeit. Die übrigen Zeilen zeigen,
dass `cross-origin-resource-policy` und die CORS-Preflight-Ablehnung als
zusätzliche, unabhängige Schichten davor liegen.

Nicht belegt und ausdrücklich außerhalb dieser Grenze: ein anderer lokaler
Prozess desselben Windows-Kontos, und ein vorgeschalteter Proxy, der die
Herkunftskopfzeilen entfernt, bevor die API sie sieht.

## /healthz unter Hashlast, 2026-08-23

Der aktuelle Health-Vertrag enthält neben `ok`, `apiVersion`, `inFlight` und
`prewarm` auch `packageName`, `packageVersion`, `processId`, die zufällige
`instanceId` und den pfadfreien `configurationFingerprint`. API-Vertrags-
und OpenAPI-Tests binden diese Pflichtfelder; der MCP-Supervisortest weist
falschen Namen, falsche Releaseversion, unvollständige Identität und fremde
Nicht-API-Antworten ab. Supervisor-Tests belegen zusätzlich die Ablehnung einer
anderen Ressourcenbindung, einen vom Default-Config gewählten Port und den
erneuten Identitätscheck nach einem Prozesswechsel am selben Port. Ein falscher
Instanz-Header wird vor dem Executor mit Konflikt abgewiesen. Die PID ist nur
Identitätsinformation und wird in der Produktion nie automatisch zum Beenden
verwendet.

Die API sagt zu, `/healthz` melde den Fortschritt jederzeit. Weil das
Workspace-Hashing synchron mit `readSync` liest, stand die Vermutung im Raum,
ein grosses Listing blockiere die Ereignisschleife und mache diese Zusage
falsch. Gemessen statt vermutet:

Bei 300 Dateien à 2 MiB im Arbeitsbereich hashte ein `workspace_file_list`
innerhalb seines Gesamtbudgets 32 Dateien und lief 405 ms. Währenddessen
antwortete `/healthz` 26-mal, im Median in 1,4 ms und im Maximum in 7,0 ms.

Die Ereignisschleife bleibt also frei. Der Grund ist strukturell und nicht
zufällig: Der Hashgenerator gibt nach jedem 64-KiB-Block ab, und der Treiber
wartet zwischen zwei Arbeitseinheiten auf `setImmediate` statt auf eine blosse
Microtask. Dass dieses Abgeben je Block wirklich stattfindet, prüft
`test/workspace-file-cancellation.mjs` über den `hash-chunk`-Rückruf.

Die Vermutung ist damit widerlegt und braucht keine Änderung.

## Zustandsreise, 2026-08-24

Alle bisherigen Livetests prüfen **eine Operation gegen ihre eigene Antwort**.
Keiner prüfte, ob ein später gelesener Zustand noch zu dem passt, was vorher
geschrieben wurde. `test/live-state-journey.mjs` schließt diese Lücke: Sie führt
ein Erwartungsmodell mit und vergleicht es nach **jeder** Mutation und nach
**jedem** Ortswechsel gegen einen frischen Readback.

Ablauf auf der profilierten Tabellenseite, ohne jedes Speichern:

1. fünf Zeilen anlegen, Kontrollsumme nach jeder Zeile binden;
2. auf eine zweite katalogisierte Seite navigieren, dort lesen, zurück
   navigieren — die Tabelle muss unverändert sein;
3. sechste Zeile ergänzen, Werte-Info öffnen und lesen, Hilfespalte lesen —
   jedes Mal die Tabelle erneut prüfen;
4. eine Zeile löschen, erneut wegnavigieren und zurück;
5. alle Zeilen zurückbauen, Ausgangssumme muss exakt wieder erreicht sein;
6. ohne Speichern schließen, die Wegwerfkopie bleibt byteidentisch.

Dabei werden **zwei unabhängige Lesewege** gegeneinander gehalten: die
strukturierte Tabellensicht (`sse_table_read`) und die geometrische Suche
(`sse_find`). Weichen sie voneinander ab, ist eine der beiden Seiten kaputt —
eine Abweichung, die keine Einzeloperation je bemerken würde.

Gemessen am 2026-08-24: 83 Operationen, gut vier Minuten, grün.

Die Reise fand beim ersten Lauf zwei Fehler:

- `table_delete` legte den Zeilentext in das Feld `geloescht`, das der Vertrag
  als Wahrheitswert führt; für den Text gibt es `target`, das die übrigen
  Emit-Pfade derselben Operation auch benutzen. **Jedes erfolgreiche Löschen kam
  damit als `invalid-operation-result` zurück** — die Operation war über die API
  unbenutzbar, und kein Livetest hatte je gelöscht.
- `noKeys` verschwieg seine Folge: Es schaltet den Cursorlauf ab, und damit kann
  `vollstaendig` nie wahr werden. Auch die große Schreibreise hatte deshalb nie
  eine Tabelle als vollständig bewiesen.

## Nebenfenster sind lesbar, aber nicht bedienbar, 2026-08-24

In einer sauberen VM reproduziert und offen: Jede Interaktionsoperation bindet
ausschließlich an das verifizierte Hauptfenster. Nebenfenster desselben
verifizierten Prozesses liefern über `windows`, `dialog_list` und `snapshot`
Text, Schalter, Optionsfelder, RuntimeIds und Fingerprint — ein Klick darauf
scheitert aber mit `stale-window`.

Zwei belegte Folgen:

- **BelegManager** (eigenes Qt-Fenster im SSE-Prozess, über Extras erreichbar):
  Der Startschirm mit „Neuen Beleg anlegen", „Mehrere Belege anlegen" und
  „Alle Belege anzeigen" ist lesbar, aber nicht bedienbar. Belegverwaltung ist
  über die API damit gar nicht erreichbar.
- **Frische Installation**: SSE zeigt vor jedem Hauptfenster den
  Einwilligungsdialog „Programm zur Verbesserung der Benutzerfreundlichkeit"
  (zwei Optionsfelder, OK erst nach Auswahl aktiv). `dialog_list` liest ihn samt
  Fingerprint, `dialog_answer` kann nur Schalter drücken und keine Option
  wählen, `click` verweigert mangels Hauptfenster. `launch` meldet nur
  `ready:false`. Ein neuer Nutzer steckt beim allerersten Start fest.

Nebenbefund für Aufräumarbeiten: SteuerSparErklärung legt Wiederherstellungs­
dateien als `Wiederhergestellt-*` im Ordner `%LOCALAPPDATA%\Steuertipps\SSE\<Engine-Major>`
ab — im selben Ordner wie ihre Benutzerkonfiguration (`SSEKonf.user.ini`,
`normal.user.ini`). Wer dort aufräumt, darf ausschließlich das Präfix treffen;
löscht man die Konfiguration mit, verhält sich das Programm wie frisch
installiert und zeigt wieder den Einwilligungsdialog.

## Kalter Feldzyklus, 2026-08-23

Bis zu diesem Tag deckte kein einziger Livetest `sse_change_field`
(`tracked_set_value`) ab — den einzigen erlaubten Weg, ein Steuerfeld zu
ändern. Die große Schreibreise prüft Tabellen, UStVA, Speichern, Export und
Dateiwege, aber nie ein schlichtes beschriftetes Feld. `sse_collect` lief live
ausschließlich mit `resultRef`; dann liegen die Seiten in einer Datei und das
Antwortfeld bleibt leer, also konnte der Vertragsbruch bei genau einer Seite
dort nicht auftreten. Und alles lief auf einer vorpositionierten Kopie in einer
längst warmen Anwendung, während die Fehler ausgerechnet beim ersten Öffnen der
Werte-Info auf einer kalten Instanz auftraten.

`test/live-cold-field-cycle.mjs` schließt diese Lücke und läuft im vollen
Live-Gate vor dem Positionieren auf einer eigenen frischen Kopie:

1. starten, Startseite gegen die Profilerwartung prüfen;
2. `collect` **ohne** `resultRef` — die Seiten müssen als Liste kommen und ihre
   Zahl muss zur gemeldeten Seitenzahl passen;
3. `result_details` auf der kalten Instanz — vollständig und mit Zeilen;
4. lesen, ändern, **erneut lesen**, falschen Vorwert abweisen lassen, erneut
   lesen, zurückdrehen, **erneut lesen**;
5. schließen ohne Speichern; die Kopie muss byteidentisch bleiben.

Gegenprobe am selben Tag: Mit dem wieder eingebauten `collect`-Fehler bricht der
Zyklus mit `invalid-operation-result` ab, mit der wieder eingebauten doppelten
Listenverpackung mit `hwnd darf nicht IntPtr.Zero oder NULL sein`. Beide Fehler
der Version beta.21 werden also gefangen.

## Fallanlage live, 2026-09-03

`case_create` ist die erste Operation, die einen Steuerfall ohne vorhandene
Datei erzeugt. Sie komponiert ausschließlich einzeln verifizierte Operationen:
Start ohne Datei, Startseite des Assistenten, `Jetzt beginnen` per `rid`,
Navigator-Modus, `Weiter`, `Datei → Speichern unter…`, nativer Dialog
„Gewinn-Erfassung speichern“, `file_dialog_select` im Modus `save-new` und der
`instances`-Readback. `npm run test:live-case-create` beweist sie auf dem
sichtbaren Desktop gegen die installierte Anwendung und übernimmt mit
`--write` die Live-Ledger:

1. `product_info`, `instances` (leer) und `desktop_status` (kein versteckter
   Desktop) als Vorbedingungen;
2. `case_create` mit `cases:neuer-fall.GewErfass2026` — rund 78 Sekunden
   inklusive Kaltstart; die Datei existiert danach mit dem gemeldeten SHA-256;
3. `case_hash`, `instances` und `ui_state` binden Datei, PID, Fenster und die
   Stammdatenseite;
4. `make_working_copy` nach `backups:`, dann `fill_fields` (Name, Vorname) und
   `combo_select` (Einkunftsart) auf `gew_erfass.allgemeine_angaben_unternehmen`
   mit Readback über `known_page_state`;
5. `click` auf den Themenfilter-Schalter, `toggle` eines Kontrollkästchens auf
   `gew_erfass.themenfilter_umsatzsteuer` mit Readback;
6. `close` mit `discardChanges` — die Datei bleibt byteidentisch zum Stand nach
   der Anlage, keine SSE-Instanz und keine Wiederherstellungsdatei verbleiben.

Vier Befunde aus den ersten Läufen desselben Tages sind in Worker, Vertrag,
Mock und Skill eingeflossen: der exakte Katalog-Readback (`known_page_state`)
las Kontrollkästchen als leeren Text, weil Qt ihnen ein leeres `ValuePattern`
gibt — bei leerem Wert liest er jetzt das `TogglePattern` als `True`/`False`;
`menu` liefert mit
`name` die Einträge flach unter
`eintraege`, nicht verschachtelt; ein ohne Datei gestarteter Prozess trägt den
Fallpfad weder in der Kommandozeile noch — bei langem Pfad — vollständig im
Fenstertitel, sodass `instances` nur `caseName` (`casePathSource=title-leaf`)
und keinen Hash liefern kann, weshalb `case_create` den Dateihash lokal gegen
den Dialog-Readback prüft und `caseHashSource=local-file` meldet; und beim
Verlassen der Stammdatenseite ohne Einkunftsart zeigt der Programm-Prüfer den
Hinweis „ELSTER: Einkunftsart fehlt!“, den `dialog_answer` wegen
Übermittlungsbezug bewusst sperrt — der Weg ist, die Einkunftsart per
`combo_select` zu setzen, nicht der Klick. `fill_fields` schreibt nur Text,
Betrag und Datum; Auswahlfelder und Kontrollkästchen nennen im Katalog ihr
`writeTool` (`sse_combo_select`, `sse_toggle`).

## Installations- und Live-Lauf in einer sauberen VM, 2026-08-23

Ein zweiter VM-Lauf prüfte den damaligen, setup-freien Installationsweg: sauberer
VirtualBox-Snapshot, Windows 11 x64, SteuerSparErklärung 2025 Build `31.0.1.0`,
Node 24.12.0, npm 11.6.2, git 2.55.0 — ohne vorbereitete API, ohne Token, ohne
`config.json`. Die damals dokumentierten vier Befehle liefen wörtlich
durch: beide npm-Pakete, `skills add`, `claude mcp add`, API-Start. Die API
antwortete zwei Sekunden nach dem Start auf `/healthz`, legte `workspace/` und
`logs/` selbst an und brauchte keine Konfigurationsdatei.

Live belegt wurden anschließend gegen einen offiziellen Musterfall auf einer
hashverifizierten Arbeitskopie: `case_hash`, `make_working_copy`, `launch`
(kalt 96 s bis bedienbar), `windows`, `ui_state`, `page`, `read_full`,
`subpages`, `collect`, `result_details`, `instances` mit genau einer laufenden
Instanz, ein geschützter Feldschreibvorgang über `tracked_set_value` samt
Rückgängigmachen sowie `close` ohne Speichern. Derselbe Weg lief auch über den
MCP-Server mit den damaligen 88 Werkzeugen.

Der Lauf deckte fünf Fehler auf, die kein Offline-Test zeigte:

- `collect` verletzte den Ergebnisvertrag, sobald ein Segment genau eine Seite
  erfasste; die Operation war über die API damit unbenutzbar.
- Der einzige erlaubte Schreibweg für Steuerfelder scheiterte, weil nach dem
  Öffnen der Werte-Info nur einmal fest gewartet wurde.
- Deckte die Werte-Info das Zielfeld ab, brach der Schreibvorgang mit
  „fremde Eingabe" ab, obwohl niemand eingegriffen hatte.
- `close` meldete einen Fehlschlag, obwohl das Programm regulär beendete.
- `get_value` und der Schreibweg lösten denselben Feldnamen verschieden auf.

Nicht geprüft: ein echter Agentenlauf — im Gast war Claude Code installierbar,
aber nicht angemeldet; ferner die sechs VaSt-Wege und jeder ELSTER-Pfad.

## Eingeklappte Navigationsspalte, 2026-08-24

Gemessen in derselben sauberen VM, nach einem Neuaufbau der SSE-Benutzerkonfiguration.
Der Bildschirm war 1020 Pixel breit, das Programmfenster 1086 Pixel ab x = -8.

`sse_page` lieferte auf „Vorbereitung Steuererklärung 2025" **sieben Felder mit
korrekten Werten und ausnahmslos leerer Beschriftung**. Die Beschriftungen
standen im Baum — „Wie ist Ihr Familienstand?" bei x = 98, „Seit wann?" bei
x = 484 in derselben Bildschirmzeile wie ihr Feld. Ursache war nicht das Lesen
der Knoten, sondern ihre Eingrenzung: Die Navigationsspalte war eingeklappt und
erschien als Baum der Breite 0. `Get-ContentBounds` erkennt sie deshalb nicht
und fällt auf 28 % der Fensterbreite zurück — hier x ≥ 296. Die
Beschriftungsspalte lag links davon.

Derselbe Rückfall trug drei Symptome:

| Symptom | Messung vorher | Messung nachher |
| --- | --- | --- |
| `sse_page` | 0 von 7 Feldern beschriftet | 4 von 7 (drei Werkzeugleisten-Elemente tragen keine) |
| `sse_get_value 'Seit wann?'` | leer, aufgelöst über `selektor` | der Wert des Musterfalls, aufgelöst über `beschriftung` |
| `tracked_set_value` | `bad-target` | `interference` (siehe unten) |

Der `get_value`-Treffer war nachweislich der Beschriftungsknoten
(`…FamStandDatum.Caption`, Typ `Text`, ohne Wert). Der vorhandene Rückfall auf
das zugehörige Eingabefeld sprang nicht an, weil er auf ein fehlendes
ValuePattern prüfte statt auf die Rolle des Treffers.

Das Schreiben scheiterte danach an einer zweiten, davon unabhängigen Ursache:
Das Ergebnisfenster (640 × 480 ab 370, 153) lag über dem Zielpunkt (621, 496),
und die Ausweichbewegung meldete `keine-freie-ecke`. Ihre vier Kandidatenecken
richteten sich nach dem Hauptfenster, das hier breiter ist als der Bildschirm,
sodass alle vier das Feld weiterhin abdeckten. Seit die Ecken am Arbeitsbereich
des Bildschirms ausgerichtet werden, läuft der Zyklus in dieser VM vollständig
durch:

    page 4/7 beschriftet -> get_value ueber Beschriftung -> schreiben ok
    -> nachlesen zeigt den neuen Wert -> zuruecknehmen ok -> Endstand wie vorher

Gespeichert wurde dabei nichts.

Festgehalten von `test/content-bounds-contract.ps1` und
`test/aside-corners-contract.ps1`.

## Isolierter First-Run-VM-Smoke vom 2026-08-18

Ein realer Endnutzerlauf startete aus einem sauberen VirtualBox-Snapshot mit
Windows 11 x64, installierter SteuerSparErklärung 2025 Build 31.0.1.0 und in
ChatGPT angemeldetem Codex, aber ohne globales Node/npm, Poppler oder ein
vorbereitetes API-Setup. Der Agent lief durchgehend mit `gpt-5.6-sol` und
Reasoning `medium`; ein Wechsel auf `high` war nicht nötig.

Der Lauf belegte in dieser Reihenfolge:

- Installation beider lokaler Skills aus dem Portable-Release und begrenzte
  Metadatensuche ohne Öffnen von Steuer- oder Beleginhalten;
- getrennte Bestätigung des Einkommensteuerfalls und des einzigen
  Belegordners sowie einen gemeinsam bestätigten `OK Standard`-Plan;
- eine exakt vier Felder große, 181 Byte lange First-run-Datei und echten
  promptfreien Setup-Aufruf mit `--plan-file`;
- Loopback-API, Profil `2025`/`supported`/`full`, Engine 31, Buildgleichheit,
  88 Operationen, 81 funktionale und sieben als `untested` ausgewiesene
  VaSt-Operationen;
- CLI-Journal mit vor dem Setup geflushtem `pending` und abgeschlossenem
  lokalem Fehler, ohne eine Aktion blind zu wiederholen;
- Inventar und SHA-256 der acht freigegebenen PDFs, aber Rendering und Lesen
  ausschließlich der vier 2025-Dateien;
- bytegleiche Prüfkopie vor der sichtbaren Zustimmung; der Fenstertitel band
  anschließend PID/HWND nachweislich nur an diese Kopie;
- zwei begrenzte `collect`-Segmente. Nach sechs Seiten meldete ausschließlich
  die Prüfkopie `ungespeichert=true`; der Agent stoppte sofort, fragte nach
  Verwerfen und navigierte nicht weiter;
- `close` mit `discardChanges=true`, `stillRunning=false`, ohne Force und mit
  Speicherantwort `Nein`; danach null Fenster, Health `running=false` und
  unveränderte, weiterhin gleiche Original-/Kopie-Hashes;
- einen create-only UTF-8-Teilbericht mit anschließend identischen API-,
  physischen und aus dem Readback berechneten SHA-256-Bytes.

Der Smoke deckte drei reale Betriebsprobleme auf. `Expand-Archive` erreichte
wegen der vielen kleinen Dateien wiederholt das Agent-Limit; das eingebaute
Windows-`tar.exe` entpackte dasselbe ZIP erfolgreich. Der native PDF-Renderer
erzeugte korrekte PNGs und `ok=true`, verließ den dedizierten Prozess auf diesem
Windows-Build aber zunächst mit WinRT-Restcode 2170; nach vollständig
geflushtem JSON und direktem Prozessabschluss lieferte derselbe echte PDF-Typ
Exitcode 0. Schließlich ersetzte eine Windows-PowerShell-stdin-Pipeline Umlaute
in einem Report durch `?`; eine direkte UTF-8-Argumentübertragung und der
Byte-Readback erkannten und korrigierten das über einen neuen create-only
Bericht. Alle drei Erkenntnisse sind jetzt in Runtime, Skills und Verträgen
abgebildet.

Ein anschließendes Gate verwendete das nach allen Runtime-/Skill-Änderungen
neu gebaute Portable-ZIP mit SHA-256
`453aa47c853e358a06f340c6f54ab53d1e525e94130db42b6a07af20ffaf518d`
aus demselben erneut zurückgesetzten Snapshot. Dabei wurde eine vierte reale
Betriebslücke gefunden: Der kalte API-Prozess meldete erst nach rund 4,2
Sekunden `ready`, während drei Probes bei 0/2/4 Sekunden knapp vollständig vor
dem Listener lagen. Setup verwendet deshalb jetzt sechs begrenzte
Startversuche und getrennte Diagnose für Health, Discovery und Workspace. Der
erneute Lauf mit dem korrigierten exakten ZIP belegte PDF-Render-Exitcode 0,
eine gültige PNG-Seite, `--plan-file`-Setup-Exitcode 0, Profil 2025,
zurückgelesenen Fall-/Belegordner, API-Health, 88 Discovery-Operationen und ein
dauerhaftes Journal `pending` → `complete`.

Der Lauf ist kein vollständiger steuerfachlicher Nachweis: Er stoppte bewusst
am Dirty-State, spätere SSE-Bereiche blieben ungeprüft, VaSt wurde nicht
verwendet und die private Fixture-/Belegevidenz wird nicht veröffentlicht. Er
belegt den sicheren First-Run- und Teilprüfungsweg, nicht die Richtigkeit einer
gesamten Steuererklärung.

## Aktuelle Live-Muster-Evidenz

`npm run test:live-core-read` ist der reproduzierbare, fallunverändernde
Basisnachweis. Am 2026-08-14 lief er erfolgreich für 2025 und 2024 (bei 2024
mit dem engen Verifikations-Opt-in), jeweils gegen beide offiziellen
Musterfälle. Pro Profil prüfte er 21 semantische Aussagen und beendete alle
gestarteten SSE-Instanzen. Er überspringt nicht still: Sein JSON-Ergebnis
nennt die fünf bewusst nicht enthaltenen Bereiche
`cross-section-navigation`, `ustva-read`, `checker`, `terminal-collect` und
`deep-read-sweep`.

Das strikte `npm run test:live` bleibt der weitergehende Nachweis für diese
fünf Bereiche und die profilierten Mutationsfixtures. Es wird nicht durch das
Core-Read-Gate ersetzt. Am 2026-08-16 bestand es für beide Profile ohne SKIP
und ohne verbleibende SSE-Instanz. Die Foreground-Lease funktionierte in
diesem Lauf. Wird sie durch Benutzereingabe oder einen fremden
Vordergrundprozess verloren, meldet der Worker weiterhin `interference`
**vor** Mausinput; ein möglicherweise wirkungsloser Klick kann damit nicht als
erfolgreiche Navigation gelten.

## Strikter Live-Muster-Sweep

Der Sweep startet ohne vorhandene SSE-Instanz. Er kopiert jeden offiziellen
Musterfall in den isolierten Test-Fallbereich, erzeugt daraus eine zweite
Arbeitskopie, bindet PID/HWND, liest ausschließlich, schließt mit Verwerfen
und prüft den unveränderten SHA-256. Testkopien werden erst nach bestätigtem
Prozessende entfernt. Bleibt ein PID-gebundener Schließvorgang nach seinem
Client-Timeout noch aktiv, wartet der Sweep auf den Abschluss; bei weiterhin
unklarem Zustand erhält der Live-Runner seine isolierte Sandbox als
Diagnoseartefakt statt sie still zu löschen.

Welche Operationen der Sweep versucht, entscheidet nicht der Test, sondern die
Fähigkeitsmatrix aus `sse_capabilities`. Alles, was das aktive Profil erlaubt
und keinen Steuerfall verändert, wird ausgeführt; alles andere muss die Matrix
ausdrücklich als gesperrt ausweisen. Ein stiller `SKIP` ist damit ausgeschlossen –
ein Profil kann keine Prüfung mehr dadurch verlieren, dass sie einfach ausbleibt.

Er umfasst derzeit unter anderem:

- Produkt-/Fallhash, Kopie, Start, Dialoginventar und gebundener Close;
- Fenster-/Seitenzustand, Ergebnisse, Seiten-, Vollseiten-, Hilfe- und
  Tabellenleser;
- Navigation, Unterseiten, Suche, Roll- und Baumzustand;
- katalogisierten Seitenzustand samt Inhaltsfingerprint, Einzelwertlesung,
  Positionen, Seitenprüfung und Auswahllisten;
- Prüferlauf, Prüferergebnis, gebundenes Öffnen einer Meldung, Reset und Close;
- UStVA-Zeitraum und Betragsreadback ohne Speichern oder Übermittlung;
- Element-Snapshot, Accessibility-Probe und Vergleich des sicheren
  TreeWalker-Pfads mit dem Bulk-Snapshot;
- Sammellauf, hashgebundenen Soll/Ist-Abgleich, Kontrollbild und Fallsicherung
  in die isolierten Test-Ressourcenbereiche;
- einen zweistufigen, rein lesenden Szenariolauf samt Abschlussschritt und
  hashgebundenem Ergebnisbericht.

Genau dieser Sweep hat drei Operationen aufgedeckt, die gegen die echte
Anwendung nie funktioniert haben: `backup_cases`, `known_page_state` und
`goto` auf die bereits offene Seite endeten jedes Mal mit
`invalid-operation-result`, weil ihr veröffentlichter Ergebnisvertrag einen
anderen Typ versprach als der Worker lieferte – eine Anzahl statt einer Liste,
ein Fingerprint statt einer Zahl, ein Text statt einer Liste. Alle drei waren
zuvor grün, aber eben nur schematisch geprüft. Ein Ergebnisschema ohne echten
Aufruf ist deshalb keine Zusicherung.

Ebenfalls belegt: Der Sprung über die globale Suche aktiviert den Treffer im
Vorbereitungszweig reproduzierbar nicht – der Doppelklick verpufft und `goto`
meldet korrekt `not-found`. Der gleichnamige Eintrag im Navigationsbaum führt
dagegen zuverlässig zum Ziel. Der Sweep nimmt deshalb diesen Weg; er ist damit
zugleich der einzige Live-Beleg für `click_point`.

Der lokale Fahrzeugfall vom 2026-08-26 belegt daneben den neuen semantischen
`goto`-Pfad. Der alte exakte Zieltext `Fahrzeug` öffnete zwar tatsächlich
`1. Fahrzeug: Chevrolet Camaro`, verwarf den dynamischen Titel aber und endete
nach 19,916 s mit `not-found`. `pageId=gew.fahrzeug` erreichte dieselbe Seite
vom identischen Startzustand in 12,724 s, bestätigte anschließend mit
`known_page_state` Überschrift und beide Pflichtfelder und benötigte auf der
bereits geöffneten Seite 1,956 s ohne Navigationsschritt. Die globale Suche
bleibt nur Transport; Zielerfolg entsteht erst aus Page-Object-Überschrift und
Pflichtfeldern.

`snapshot_compare` kann auf Engine 30 über unmittelbar benachbarte
Messpaare hinweg einen echten Leserunterschied melden. Das Profil verwendet
deshalb fünf statt drei Wiederholungen. Im Lauf vom 2026-08-14
fehlten dem Bulk-Snapshot fünf unbenannte TreeWalker-Knoten (`Button`, `Custom`
und `Hyperlink`); es gab keine zusätzlichen Knoten, Metadaten- oder
Wertabweichungen. Das 2024-Profil erlaubt deshalb ausschließlich diesen
fehlende-Knoten-Diagnoseausgang. Jede zusätzliche Struktur-, Metadaten- oder
Wertabweichung bleibt rot. Der Vergleich wird also nicht weichgestellt, sondern
liefert für diese bekannte Engine-Grenze weiterhin seinen fail-closed Befund.

Ein weiterer Engine-Unterschied ist damit belegt: `combo_options` bindet die
Auswahleinträge an die AutomationId der ComboBox. Engine 31 liefert so eine
vollständige Liste; Engine 30 hängt die Popup-Einträge nicht darunter und der
Leser meldet ehrlich `not-found`, statt eine womöglich fremde Liste zu
behaupten. Der Live-Sweep akzeptiert genau diese beiden Ausgänge – eine dritte,
stillschweigend geratene Liste wäre der Fehler.

## Wegwerfkopien statt privater Fixtures

Die Einzeltransaktionen brauchen einen Steuerfall, den sie verändern dürfen.
Bisher musste der von außen kommen: Jedes Skript verlangte eine eigene
Umgebungsvariable auf eine „neutrale Kopie", und ohne sie beendete es sich mit
`SKIP` und Rückgabewert 0. Genau so verschwanden sie aus jedem Gate.

Das Gate stellt die Kopie inzwischen selbst her: Es kopiert den offiziellen
Gewinnermittlungs-Musterfall in ein frisches Temp-Verzeichnis, richtet den
Fallbereich der Test-API darauf, führt das Skript aus und löscht das
Verzeichnis wieder. Danach prüft es dreierlei – Exit 0, unveränderter SHA-256
des Originalmusterfalls und null verbliebene SSE-Prozesse. Die Kopie ist damit
kein Vorrecht des Entwicklerrechners mehr, sondern Teil des Laufs.

Dabei kam heraus, warum diese Skripte nicht nur ungenutzt, sondern **defekt**
waren: Acht von ihnen übergaben `sse_desktop_start` bzw. `sse_launch` einen
absoluten Windows-Pfad als `file`. Seit der Pfadredaktion kennt die
MCP-Schicht nur noch `caseRef` im konfigurierten Fallbereich, und ihr striktes
Schema weist alles andere ab. Jedes dieser Skripte scheiterte deshalb im
allerersten Aufruf – unbemerkt, weil niemand sie mehr startete. Die Umrechnung
liegt jetzt in `test/fixture-case-ref.mjs` an einer Stelle.

Zwei weitere Annahmen dieser Skripte hielten der frischen Kopie nicht stand:

- Sie erwarteten feste Beträge („1,50" → „1,51"). Die stammten aus der privaten
  Arbeitskopie ihres Autors. Die Zieltabelle kommt jetzt aus dem Produktprofil,
  jeder erwartete Betrag aus der laufenden Anwendung.
- Sie erwarteten eine Startseite mit „Weiter". Der offizielle Musterfall öffnet
  auf einer Übersichtsseite ganz ohne diesen Schalter; der Test scheiterte mit
  `not-found` statt der erwarteten blockierten Navigation.

Der zweite Punkt ist mehr als ein Testdetail. Gemessen wurde: Von dieser
Startseite führt **kein** fokusfreier Weg weiter. `Invoke` auf „Jetzt beginnen"
wird ausgeführt und wechselt die Seite nicht; linear blättern geht nicht, weil
es kein „Weiter" gibt; und der Navigationsbaum braucht einen echten Mausklick,
der auf dem privaten Desktop technisch ausgeschlossen ist. Jeder versteckte
Lauf war dort gefangen. Das Gate stellt die Vorlage deshalb einmal **sichtbar**
auf die profilierte Formularseite und speichert – die Anwendung merkt sich die
Seite in der Datei, und alle folgenden Läufe öffnen direkt dort, auch versteckt.

### Was dieser Weg an echten Fehlern freigelegt hat

Erst dieser Lauf gegen den Herstellermusterfall hat vier Defekte gezeigt, die
gegen den synthetischen Worker alle grün waren:

1. **`sse_save` meldete jedes erfolgreiche Speichern als Fehlschlag.** Zwei
   Nachbedingungen waren zu streng. Erstens verlangte sie eine *fortgeschrittene*
   Schreibzeit; SSE speichert aber über eine temporäre Datei und benennt um,
   und Windows überträgt dabei per File Tunneling die alten Zeitstempel –
   gemessen: identischer `LastWriteTimeUtc` bei geändertem Hash. Zweitens
   verglich sie `ElsterTransferTime` wörtlich, das der Build beim Speichern von
   „-" auf leer normalisiert. Der Hashwechsel bleibt der eigentliche Beweis.
2. **Der Kopfparser meldete den Musterfall als übermittelt.** `-` ist der
   Platzhalter für „nie versendet"; der frühere Test „nicht leer und nicht 0"
   machte daraus `transmitted = true`, Begründung „übermittelt am -". Für ein
   Werkzeug, dessen erste Regel „niemals versenden" ist, ist eine falsche
   Übermittlungsauskunft der schlechteste denkbare Fehler. Jetzt gilt: leer,
   `0` und `-` heißen nicht übermittelt, ein Wert mit Ziffern heißt übermittelt,
   und alles andere bleibt ausdrücklich `unknown` statt geraten – ein
   irrtümlich zweiter Versand wäre der teurere Fehler.
3. **`table_read`, `read_table` und `collect` lieferten keine Tabellenzeilen.**
   Windows PowerShell 5.1 serialisiert ein verschachteltes `object[]` als
   `{"value":[…],"Count":n}`. Jeder Aufrufer bekam also Hüllobjekte statt
   Zeilen. Der synthetische Worker baut seine Zeilen in JavaScript und konnte
   das nie zeigen.
4. **Die Kontrollsumme war gar nicht lesbar.** `table_add`, `table_update` und
   `table_delete` verlangen `expectedBefore` zwingend, aber keine einzige
   Leseoperation lieferte den Wert – ein Aufrufer hätte ihn raten müssen.
   `sse_table_read` meldet ihn jetzt als `summe`. Dass er zunächst leer blieb,
   lag daran, dass der Leser den Baum ohne Werte lief; Qt gibt die Summenzelle
   nur mit `-WithValues` heraus.

Dazu kommt eine Diagnoseverbesserung: `sse_save` nennt bei `postcondition-failed`
jetzt in `offeneBedingungen`, welche Bedingung gerissen ist. Vorher stand dort
nur eine Sammelmeldung, und genau diese Sammelmeldung hat den obigen Befund
jahrelang verdeckt.

Für ein Jahr ohne volle Freigabe laufen diese Transaktionen nicht. Das ist kein
stiller SKIP: Das Gate prüft stattdessen, dass die Policy jede der sieben
Steuerfallmutationen mit genanntem Grund sperrt – auch mit gesetztem
Experimental-Opt-in.

## Profilierter Schreibweg

Der profilierte Focusless-Commit schreibt eine gebundene Tabellenzelle auf
einem privaten Windows-Desktop, mit laufendem Vordergrundwächter. Bewiesen
werden Feld-Readback, abhängige Seitensumme, `ungespeichert`, das Ausbleiben
jeder physischen Eingabe und dass die Arbeitskopie nicht auf die Platte
geschrieben wird.

Er brauchte früher eine von außen gestellte Fixture, weil ein Fall nötig ist,
der sich die profilierte Seite bereits merkt. Diesen Fall stellt das Gate
inzwischen selbst her (siehe oben); eine Umgebungsvariable ist nicht mehr
Voraussetzung.

Eine Tabellenzeile **löschen** geht dagegen nur sichtbar: Qt verlangt dafür
Strg+Umschalt+Entf, und der Worker sperrt `sse_table_delete` auf dem privaten
Desktop ausdrücklich ab. Der Tabellen-Lebenszyklus läuft deshalb bewusst
sichtbar – das Gate verlangt ohnehin eine unbenutzte Maschine.

Ein Vorbehalt gehört dazu: Erscheint beim Start eine Wiederherstellungsfrage,
beantwortet dieser Schritt sie gebunden mit „Nein". Das verwirft die
Autosave-Daten einer zuvor abgestürzten SSE-Sitzung – auch wenn diese zu einem
ganz anderen Steuerfall gehört. Das Gate startet deshalb nur ohne laufende
SSE-Instanz; wer eine offene Wiederherstellung erwartet, klärt sie vorher
selbst in der Anwendung.

## Große Schreibreise

`test/live-write-journey.mjs` ist die eine lange, streng lineare Reise über
die Schreib- und Dateiwege: lesen, Kontrollsumme prüfen, schreiben,
Kontrollsumme erneut prüfen – und für jedes Speichern der Beweis auf der
Platte. Sie läuft im strikten Live-Gate nach den Einzeltransaktionen und
zusätzlich eigenständig über `npm run test:live-journey`. Anders als die
Einzeltransaktionen **speichert sie ihre Wegwerfkopie mit Absicht**; ihr
Runner erwartet deshalb den Hashwechsel der Kopie und weiterhin den
byteidentischen Musterfall.

Ihre Beweiskette in einer Ausführung:

- Tabellenzeile anlegen, Kontrollsumme aus der Anwendung gegenlesen,
  hashgebunden speichern (Datei ändert sich nachweislich), Anwendung
  schließen, **neu starten und die Zeile erneut vorfinden** – erst der
  Neustart trennt „im Fenster sichtbar" von „in der Datei gespeichert";
- Zeile löschen, Summe exakt zurück auf dem Ausgangswert, zweites
  hashgebundenes Speichern;
- UStVA-Quartett auf der Übersicht: Zeitraum q1→q2 direkt per `combo_select`
  und zurück über `ustva_select_period`, Belege-Kennzeichen hin und zurück,
  Sondervorauszahlung 100,00 mit exakt um 10.000 Cent sinkender Zahllast und
  vollständiger Rücknahme, Vorsteuerbereich öffnen und zurück – alles ohne
  Speichern, die Datei bleibt nachweislich auf dem Stand des letzten Saves;
- CSV-Export über den echten Dialogweg (`export_csv` → `dialog_answer` →
  nativer Ordnerdialog per `file_dialog_select`) bis zu tatsächlich
  geschriebenen CSV-Dateien im Ergebnisbereich, danach derselbe Exportdialog
  noch einmal über `menu`/`menu_click`;
- Werte-Info als bekanntes Nebenfenster öffnen und per `window_close` exakt
  fingerprintgebunden schließen; Hauptfenster echt minimieren und per
  `window_restore` verifiziert zurückholen;
- `save_as` auf eine Zweitdatei samt nachgewiesener Fensterumbindung,
  Bestandskontrolle über `list_cases`/`case_hash` und hashgebundenes
  Verschieben der Zweitdatei per `archive_cases`.

### Was die Reise bereits an Wirklichkeit freigelegt hat

Vier Annahmen hielten dem echten Programm nicht stand. Alle vier sind
Produktverhalten, nicht Testfehler – und alle vier wären mit einer weniger
strengen Prüfung unbemerkt geblieben:

1. **Die profilierte Gebührentabelle spiegelt den Betrag in eine zweite,
   berechnete Spalte derselben Zeile.** Eine Zeilenbindung allein über den
   Text ist dort deshalb grundsätzlich mehrdeutig; `sse_table_delete` weist
   das korrekt mit `ambiguous` ab. Nach einem Neustart existiert keine
   Runtime-ID aus der Mutation mehr, die Reise leitet sie deshalb neu aus der
   laufenden Anwendung ab und prüft strukturelle gegen geometrische Sicht.
   Für Aufrufer heißt das: Eine Tabellenzeile über einen Betrag zu adressieren
   ist auf gespiegelten Tabellen nicht eindeutig – `targetRid` ist Pflicht.
2. **Der CSV-Export schreibt eine Datei je Ausgabekategorie, und Kategorien
   ohne Daten ergeben eine leere Datei.** Am Musterfall ist das
   `GWGVerzeichnis.csv` – der Fall hat keine geringwertigen Wirtschaftsgüter.
   Eine leere Exportdatei ist damit korrektes Verhalten; beweiskräftig ist,
   dass überhaupt Inhalt geschrieben wurde.
3. **Der abgeschlossene Export legt eine weitere Meldung über das
   Exportfenster.** `sse_dialog_answer` verweigert die Antwort auf einen
   verdeckten Dialog mit `non-topmost-dialog`. Die Reise räumt die Kette
   deshalb von oben nach unten ab und benutzt genau dieses strukturierte
   Urteil als Reihenfolgequelle, statt eine Reihenfolge zu raten.
4. **SteuerSparErklärung legt beim Speichern eine eigene Sicherungsdatei
   `<Fallname>_Backup` neben den Fall**, und der Bestandsabgleich von
   `sse_archive_cases` zählt sie mit. Ein Archivlauf, der nur die sichtbaren
   Falldateien kennt, wird deshalb korrekt mit `inventory-mismatch` gestoppt –
   die Operation verlangt den vollständigen Restbestand, nicht den vermuteten.
   Für Aufrufer heißt das: `sse_list_cases` mit `includeBackups: true` ist vor
   einem Archivlauf Pflicht.

Eine Grenze bleibt bewusst außerhalb der Reise und weiterhin live unbelegt:
Die sechs `vast_*`-Operationen brauchen den echten VaSt-Belegabruf-Dialog
eines ELSTER-Kontos. `center_cases` und `center_refresh` sind dagegen nun im
separaten privaten Center-Gate sowie im strikten Runner enthalten. Ein
VaSt-Live-Nachweis ohne die echte Voraussetzung wäre gespielt statt bewiesen.

Die Reise braucht eine entsperrte, unbenutzte Windows-Sitzung: Zwei Versuche
am Vormittag des 2026-08-14 endeten reproduzierbar fail-closed mit
`interference`, weil während der ersten Zellschreibung echte Benutzereingaben
eintrafen – bei gesperrtem Bildschirm scheitern dagegen die
SendInput-Dialogwege. Ihr erster vollständiger Lauf gehört deshalb in das
unbeaufsichtigte Zeitfenster des geplanten Gesamtlaufs; erst mit dessen
Abdeckungsbilanz wandern die neuen Operationen in die Live-Spalte.

Engine 30 vergibt bei einzelnen semantisch identischen, unbenannten Qt-Knoten
zwischen zwei unmittelbar folgenden Läufen neue Runtime-IDs. Der Vergleich
weist diese als `runtimeIdChurnCount` aus und paart sie nur im identischen
Traversal-Slot mit identischem Elternindex und gleicher Tiefe, wenn außerdem
Typ, Name, AutomationId, Geometrie, Zustand und privater Wert intern exakt
identisch sind. Die privaten Vergleichsdaten verlassen den Worker nicht; echte
Struktur- oder Wertabweichungen bleiben ein Fehler.

Praktische Folge für Aufrufer: Eine Runtime-ID aus einem vorherigen Aufruf ist
auf Engine 30 keine tragfähige Bindung für eine Aktion – der Klick endet dann
mit `not-found` auf einem leeren Bezeichner. Für Aktionen binden Name oder
AutomationId; die Eindeutigkeit wird vorher lesend geprüft.

Strikte Ausführung beider Profile in PowerShell:

```powershell
npm run test:live
```

Der Runner entfernt eine eventuell gesetzte Fallauswahl, startet nur ohne
vorhandene SSE-Instanz, prüft `2025` und danach `2024` vollständig und verlangt
nach jedem Profil wieder null SSE-Prozesse. Für 2024 setzt er den eng begrenzten
Verifikations-Opt-in selbst. Im Lauf werden ein Dateihash und ein stabiler
Ergebnisreadback jeweils direkt per HTTP und über das kanonische MCP-
`structuredContent` verglichen.

Fehlende Installation, Musterdatei oder Testvoraussetzung darf in einem
verpflichtenden Live-Gate nicht als grüner `SKIP` gelten. Vor und nach dem Lauf
muss geprüft werden, dass keine fremde SSE-Instanz übernommen oder beendet
wurde.

Während des Laufs darf der Rechner nicht nebenher bedient werden. Vor jedem
echten Baumklick bindet der Worker den aktuellen Windows-Eingabetick sowie den
exakten SSE-PID-/Root an der Zielposition; fremde Eingabe oder Überdeckung
stoppt deshalb vor dem Input. Ein physischer Baumklick verlangt zusätzlich,
dass genau dieses SSE-HWND unmittelbar vor dem Mausinput im Vordergrund ist.
Verweigert Windows die Aktivierung, meldet `sse_click_point` `interference`
und führt keinen Klick aus. Nur bei Vordergrund-, Root- und Input-Bindung kann
ein wirkungsloser Qt-Klick noch als `postcondition-failed` erscheinen. Der
Sweep wiederholt ausschließlich diesen lesenden Zweigklick begrenzt und gibt
pro Versuch Fokus- und Klick-Bindungsdaten aus; damit ist eine ruhige sichtbare
Sitzung prüfbar, ohne Fremdbedienung pauschal als Ursache zu behaupten.

## Noch nicht freigegeben

Für „jede praktische SSE-Aktion vollständig geprüft“ fehlen insbesondere:

1. erfolgreiche Live-Läufe der sechs `vast_*`-Operationen mit einem neutralen
   ELSTER-/VaSt-Dialog. Diese sechs Operationen sind offline funktional, live
   aber weiterhin nur durch kontrollierte Fehlerpfade belegt;
2. eine fallweite Gesamterfassung. Der erfolgreiche `collect`-Lauf beweist
   exakt das Ende eines profilierten Ein-Seiten-Blätterpfads; der getrennte
   Zwei-Seiten-Lauf beweist den fortsetzbaren Teilstand. Wegen des absichtlichen
   Maximums von fünf Seiten ersetzt beides keine Baumkartierung des ganzen Falls;
3. die 2024-Mutationsmatrix. Der Experimental-Opt-in sperrt diese Pfade
   absichtlich; die erfolgreichen 2025-Läufe für UStVA-Schreiben,
   `combo_select`, `save_as`, `export_csv` und `file_dialog_select` sind keine
   Freigabe für Engine 30;
4. ein vollständiger HTTP-gegen-MCP-Szenariolauf auf zwei unabhängigen frischen
   Wegwerfkopien einschließlich der freigegebenen Mutationen; der aktuelle
   Live-Lauf belegt bereits die echte Transportparität für Hash und Ergebnisreadback;

Die Live-Spalte der Abdeckungsbilanz ist die verbindliche Antwort darauf,
welche Operationen die echte Anwendung schon bedient hat. Prosa in dieser Datei
darf ihr nie widersprechen.

Eine Jahresprofil-Promotion ist erst zulässig, wenn diese Freigaben nicht
pauschal über den Profilstatus erfolgen und alle für das Jahr erlaubten
Operationsklassen mit passender Live-Evidenz hinterlegt sind.
