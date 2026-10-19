# API/MCP-Stabilisierung: Stand und verbleibende Grenzen

## Ziel und Nachweisgrenze

Low-Level-Operationen bleiben einzeln nutzbar. Höhere Abläufe verbinden frische
Identitäts- und Ausgangsprüfung, eine gezielte Aktion und verifizierten Readback.
Eine verlorene Antwort oder ein Timeout erlaubt kein blindes Wiederholen.
Die folgende Prüftabelle trennt den aktuellen Stand vom integrierten Ausgangsstand.
Frühere Erfolge gelten für ihren geprüften Quellstand und Ausführungspfad.
Produktivinstallation und Veröffentlichung bleiben gesonderte Schritte.

## Aktueller Prüfstand

| Bereich | Nachweis |
| --- | --- |
| Vollständiges `npm test` auf dem aktuellen Stand | **PASS** einschließlich Abdeckungs-, Ergebnis-, Privacy- und Dokumentationsverträgen |
| Native Komponentensuite | **PASS**, sieben Prüfungen sowie zwei zusätzliche frische Integrationsläufe |
| Kanonische native Mega-Reise | **PASS** im deklarierten Operationsumfang mit Mutation, Readback und Cleanup |
| Native Add → Readback → Update → Cursor → Seitenrückkehr → Cursor | **PASS**, drei unabhängige Folgen mit vollständigen Inventaren und Cleanup |
| Vollständige native Zustandsreise | **PASS**, sechs Anlagen und Löschungen, Änderung/Rücknahme, drei Seitenrückkehrten, Werte-Info/Hilfe, vollständige Inventare und unveränderte Falldateien |
| Paketbau, Publish-Probelauf und saubere Testinstallation | **PASS**, alle drei CLI-Einstiege und der vollständige MCP-Werkzeugvertrag aus den erzeugten Tarballs |
| Abschließender Doku-/Plugin-Abgleich | **PASS**, schnelle Suite einschließlich Dokumentations-, Plugin- und Privacy-Verträgen |

Der integrierte Ausgangsstand besteht zusätzlich die Standard-Zustandsreise,
die große Add-/Delete-Cursorfolge, das vollständige Live-Gate, Standard-Mega,
Produktprüfung und den produktfreien HTTP/MCP-Soak. Diese Nachweise ersetzen
keine erneute Prüfung eines danach geänderten Ausführungspfads.

## Umgesetzt

- **Werkzeugwahl:** strukturierte Hauptwege, seltene gebundene UI-Fallbacks
  und gezielte Diagnose sind in API-Planung, MCP-Katalog und Skill getrennt.
  MCP setzt fehlendes `noKeys` auf `true`; ein aktiver Cursorlauf braucht dort
  ausdrueckliches `false`. Direkte API-Defaults bleiben kompatibel. Fehler und
  unbekannte Schreibausgaenge starten keinen alternativen Methoden-/Backendweg.
- **Lebenszyklus:** eindeutige Eigentümerschaft, Schutz fremder Instanzen,
  begrenztes Beenden und unabhängige Cleanup-Schritte. Wrapper erhalten
  Primärfehler und Child-Exit-Code auch bei zusätzlichem Cleanup-Fehler.
- **Standardcursor:** vorhandenen gebundenen Fokus verwenden oder vorab genau
  eine sichere Nr.-Zellenaktivierung planen. Sichtbarkeit, RAW-/Grid-/Container-
  Bindung, unveränderte Werte und Eingabe-/Fensterkontext bleiben Pflicht.
  Bei einem abgeschnittenen Leseanker kann eine getrennte vollständig sichtbare
  Nr.-Zelle gebunden werden; der ursprüngliche Leseanker bleibt unverändert.
- **HOME und Nr.-Editor:** eine notwendige Auswahlkorrektur erfolgt genau einmal
  an der frisch bewiesenen eigenen Nr.-Zelle. Danach folgen vollständiger Roh-,
  Typ- und Checkbox-Readback sowie frische Auswahlprüfung. ESC, Eingabeversuch,
  bestätigte Ausführung und unbekannter Ausgang bleiben unterscheidbar.
- **Native Cursorübergänge:** nummerierte Tabellen wählen strukturell den
  modellgebundenen Schrittweg. Passive Footerquellen behalten nur frisch
  nachgewiesene Auswahl. Nach HOME wird die geplante Ausrichtung vor der
  abschließenden Auswahlprüfung ausgeführt. Ein exakt leerer Cursor nach
  Seitenrückkehr nutzt die vorhandene Nr.-Positionierung mit frischem Modell-
  und Bindungsnachweis; spätere Fehler erhalten bereits erfolgte Aktionen.
- **Navigation und No-op:** vollständiger nummerierter Eintragskontext trennt
  wiederholte Unterseitentitel verschiedener Wirtschaftsgüter von echten Zyklen.
  Eine bestätigte native Ablehnung ohne Aktion erlaubt nur den eng bewiesenen
  Lease-Abschluss; sie wird nicht als erfolgreiche Positionierung ausgegeben.
- **Tipps und Fokusquellen:** nur das bekannte eigene nicht modale Tipps-Fenster
  schließen. Eine genaue Werte-Info darf unveränderter passiver Beobachter sein.
  Eng profilierte Hilfe- und bereits erlaubte passive Quellen benötigen eigene
  frische Quellnachweise; unbekannte Fenster, Editoren und Auswahl bleiben gesperrt.
- **Lesepfade:** der Standardcursor vermeidet einen anschließend verworfenen
  Doppel-Walk beim eigenen Edit. `readMode: "grid"` liest ausdrücklich ohne
  Fokus-, Scroll- oder Schreibaktion; Vollständigkeit und Eingabeslot bleiben sichtbar.
  Native Modell-/Positionierungsnachweise ergänzen weiterhin hybride Worker-Schreibabläufe.
- **Getter und Buildbindung:** explizite Namensräume `uia` und `qt-object`,
  kompatibles Legacy-Routing, frühe Ablehnung widersprüchlicher Identitäten und
  Prüfung der unterstützten Produkt-/Paketbindung. Kein neuer allgemeiner Schreibzugang.
- **Native Texteingriffe:** lokale Schrift-/Layoutvorbereitung und ein atomarer
  Permit liegen vor der ersten Änderung. Nur ein gewonnener Abbruch vor diesem
  Permit beweist, dass keine Mutation begonnen hat. Die neue eigene Fixture prüft
  unveränderten Text, Modell, Cursor, Auswahl, Fokus und fünf Signalzähler nach
  absichtlich langsamem Read; anschließend gelingt ein frischer Unicode-Edit.
  Ein bereits begonnener ungewisser Commit bleibt recovery-pflichtig und wird nicht wiederholt.
- **Diagnose und Wiederholung:** begrenzte wertfreie native Phasen, feste
  Ablehnungsgründe und getrennte Freigabeflags bleiben im Mega-Bericht erhalten.
  Höchstens drei Client-Versuche sind nur bei validiertem HTTP 409 vor Dispatch
  zulässig, mit gleicher Instanz und gemeinsamem Zeitbudget. Kein Unknown-Replay.
- **API/MCP-Verträge:** tatsächliche Produktionsfunktionen und Dispatcher werden
  geprüft. Kompakte Tabellenantworten erhalten `incomplete`; Schema-, Ergebnis-,
  Plugin- und Privacy-Grenzen bleiben bestehen. Das OpenAPI-Limit wurde nicht angehoben.

## Verbleibende Grenzen

- Explizites Cursorlesen und native Positionsnachweise bleiben aufwendig. Die
  passive Standardlesung bleibt der schnelle Normalpfad; Grid-Lesen vermeidet
  ebenfalls Navigation. Beide ersetzen keine Cursor- oder Schreibabnahme.
- Schriftvorbereitung und Cancellation sind geprüft; damit ist nicht bewiesen,
  dass sämtliche Ursachen seltener Unicode-Latenzen beseitigt sind. Erfolgreiche
  Folgeläufe erklären einen früheren Ausreißer nicht rückwirkend.
- Der genaue Ablehnungsgrund eines früheren nativen Positionsabbruchs fehlt im
  damaligen Bericht. Neuere Berichte erhalten mehr begrenzte Diagnose;
  ein erfolgreicher Folgelauf beweist keine Behebung der damaligen Ursache.
- Synchron blockierende Provider-/OS-Aufrufe können den Drain verzögern.
  Kurze Caller-Budgets können weiterhin einen unbekannten Transportausgang liefern.
  Unbewiesenes Cleanup und begonnene ungewisse Änderungen bleiben fail-closed.
  Weitere langsame Name-Lesepunkte sind nicht separat Ende-zu-Ende erzwungen.
- Zwei gleiche Beobachtungen sind kein atomarer Snapshot. Beliebige Feld-/Label-
  Zuordnungen und ein positiver VaST-Ende-zu-Ende-Ablauf sind nicht vollständig belegt.
  Profil 2024 bleibt experimentell mit `operationAccess: "verification-only"`.

## Getrennte Folgearbeit

- Worker-Roundtrips des aktiven Cursors und höherer Schreibabläufe reduzieren;
  dabei frische Identitäts-, Modell-, Auswahl- und Cleanup-Nachweise erhalten
  und dieselbe Methode vor und nach der Änderung messen.
- Weitere langsame Provider-Lesepunkte gezielt erzwingen und einen erneuten
  Unicode-Ausreißer bei Gelegenheit mit passender Phasen-/Stackevidenz erfassen.
- Positive VaST-Ende-zu-Ende-Evidenz und weitergehende Profilfreigaben getrennt
  vorbereiten; bestehende Prüfgrenzen nicht aus erfolgreichen Nachbarabläufen ableiten.

## Reproduzierbare Prüfung

Mit den dokumentierten Voraussetzungen und Wegwerfkopien alle GUI-/Controller-
Reisen seriell ausführen. Die Gate-Ergebnisse oben vor Abschluss aktualisieren.

```powershell
npm test
npm run test:qt-native
npm run test:live-native-add-update
npm run test:live-state
npm run test:live
npm run perf:api-mega -- --classification=cold
npm run docs:check
npm run check:plugin
npm run pack
npm run publish:dry-run
npm run test:npm-clean-install
```

Mega und Zustandsreise mit der jeweils dokumentierten Backendkonfiguration
prüfen. Leistung über `perf:api-mega` und den kanonischen `perf:api-load-soak`
mit Ausgabe außerhalb des Repositorys messen; der produktfreie Soak belegt
keine GUI-Latenz. Vor Veröffentlichung gilt zusätzlich das vollständige
`npm run check`. Ein Publish-Probelauf veröffentlicht kein Paket.
