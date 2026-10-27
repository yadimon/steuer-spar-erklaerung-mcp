# API/MCP-Stabilisierung: Stand und verbleibende Grenzen

## Ziel und Nachweisgrenze

Die API soll eindeutige, begrenzte Operationen anbieten und Fehler so melden,
dass ein Aufrufer sicher weiterarbeiten kann. Low-Level-Operationen bleiben
einzeln nutzbar. Höhere Schreibabläufe verbinden eine frische Ziel- und
Ausgangsprüfung, die gezielte Änderung und einen erneuten Readback. Speichern
bleibt ein eigener Auftrag.

Dieses Dokument beschreibt den Repository-Stand und die weitere Arbeitsweise.
Es ist kein Protokoll einzelner Prüfläufe und keine pauschale Freigabe aller
Oberflächenzustände. Frühere Erfolge gelten für ihren geprüften Quellstand,
das Produktprofil und den Ausführungspfad. Eine neue Installation oder
Veröffentlichung braucht eigene Prüfungen.

## Aktueller Prüfstand

| Ebene | Maßgebliche Quelle | Aussage und Grenze |
| --- | --- | --- |
| Implementierung | `src/`, `powershell/` und `native/qt/` | Zeigt vorhandene Pfade; ein Handler allein beweist keine Produktbedienung |
| Offline-Verträge | `test/suite-plan.mjs`, `npm run test:inventory` | Prüfen unter anderem Transport, Bindung, Fehler und Bereinigung; die Planausgabe führt keine Tests aus |
| Funktionale Live-Abdeckung | `test/operation-coverage.json` | Registrierte Belege mit ausdrücklich getrennten Erfolgs-, Fehlerpfad- und ungetesteten Operationen |
| Qt-Umstellung | [Native-Matrix](docs/NATIVE-COVERAGE.md) | Zählt direkte optionale Qt-Handler getrennt von funktionaler Live-Abdeckung |
| PR- und Paketprüfung | [Windows-CI](.github/workflows/windows-ci.yml) | Offline-Suite, Abhängigkeitsprüfung, Plugin-Abgleich und saubere Paketinstallation; keine vollständige Produktreise |
| Veröffentlichung | [Release-Anleitung](docs/RELEASE.md) | Zusätzliche Produkt-, Paket- und Metadatenprüfungen; ein Probelauf veröffentlicht kein Paket |

Die [Verifikationsdokumentation](docs/VERIFIKATION.md) erklärt die einzelnen
Nachweisstufen. Ein erfolgreicher Worker-Lauf beweist keine Qt-Parität, und ein
produktfreier Lasttest beweist keine GUI-Latenz.

## Umgesetzt

- **Werkzeugwahl:** strukturierte Hauptwege, seltene gebundene UI-Fallbacks
  und gezielte Diagnose sind in API-Planung, MCP-Katalog und Skill getrennt.
  MCP setzt fehlendes `noKeys` auf `true`; ein aktiver Cursorlauf braucht dort
  ausdrückliches `false`. Direkte API-Defaults bleiben kompatibel. Fehler und
  unbekannte Schreibausgänge starten keinen alternativen Methoden-/Backendweg.
- **Lebenszyklus:** eindeutige Eigentümerschaft, Schutz fremder Instanzen,
  begrenztes Beenden und unabhängige Cleanup-Schritte. Die API-Testhülle erhält
  Primärfehler und Child-Exit-Code auch bei einem zusätzlichen Cleanup-Fehler.
  Ihre Regression bindet die Diagnose-Datei über den kanonischen Elternpfad,
  damit ein Pfadalias weder Beobachtung noch Fehlerinjektion überspringt.
- **Tabellen:** passives Standardlesen, explizites Grid-Lesen und geschütztes
  Cursorlesen haben unterschiedliche Verträge. Grid-Lesen löst keine Fokus-,
  Scroll- oder Schreibaktion aus. Ein Cursorweg braucht zusätzlich frische
  Modell-, Auswahl-, Fenster- und Eingabenachweise; Fehler erlauben kein
  Ausweichen auf einen anderen Eingriff.
- **UIA-Löschung:** Zielkoordinaten und vollständiger ausgelesener Bestand
  ersetzen Textanwesenheit und sichtbaren Zeilenrang als Nachweis. Verborgene
  Spalten und Checkboxwerte werden mitgeprüft. Eigene Zelleditoren brauchen
  einen gesonderten Fokus-/Wertnachweis; unbekannte Editoren bleiben erhalten.
  Weder eine unveränderte Summe noch eine ausbleibende beobachtete Wirkung
  erlauben Erfolg, Rollbackbehauptung oder Wiederholung. Ein Undo benötigt
  genau die eigene Einerentfernung und erneut bewiesenen Tabellenfokus.
- **Mehrfeldpläne:** Nach erkanntem Eingabe-/Fensterkontextverlust beginnt
  kein neuer Rollback-Schritt. Eine unbewiesene Rücknahme beendet auch eine
  bereits laufende Rücknahmekette. Der passive Abschlussreadback bleibt
  erhalten; ungewisse Ergebnisse verlangen weiterhin einen frischen Abgleich.
- **Feldrücknahmen:** Rohwert und UIA-Name werden konsistent getrennt geprüft.
  Ein leeres Namensfeld erzeugt keinen falschen Rücknahmefehler für einen
  vorhandenen Edit-Wert. Fehlende Nachher- oder Rücknahme-Lesungen bestätigen
  auch bei leeren Werten keinen Erfolg und verwenden keine alte Wertprobe.
- **Feldvorwerte:** Der Commit prüft den typisierten Vorwert erneut nach der
  Fokusvorbereitung. Bei DataItems bleiben Raw, Name und fachliche Vorgabe
  gebunden. Unbekannte Vorwerte bleiben unbekannt; Währungsformate dürfen
  keinen anderen Zahlenwert oder widersprüchlichen DataItem-Rohwert verdecken.
  Vollständige lebende Namen bleiben von der Baumdarstellung unabhängig.
  Ein DataItem-Rohplatzhalter führt bei der Rücknahme zur Eingabe des bestätigten
  alten Anzeigenamens; Erfolg braucht weiterhin den getrennten Raw-/Namensnachweis.
- **Checkboxen in Tabellen:** boolesche Werte werden typisiert gelesen und
  mit genau einem gebundenen Eingriff geändert. Eine positive UIA-Geometrie
  genügt bei teilweise verdeckten Zeilen nicht; die Vorbereitung prüft den
  tatsächlichen Punkt vor dem ersten Zellschreiben. Add, Update und Rollback
  teilen die Zustands-, Fokus-, Eingabe- und DPI-Prüfungen.
- **Steuerwissen:** die Suche bindet Fenster, Prozesslebensdauer und
  tatsächliches Eingabefeld. Ein begrenzter MSAA-Baum und die zugehörige
  Trefferliste unterscheiden Artikel, bestätigte Nulltreffer und fehlende
  Nachweise. Der optionale Live-Test nutzt eigene Musterkopien und beweist
  die Zugehörigkeit des gestarteten Helfers über ein Windows Job Object.
- **Getter und Buildbindung:** die Namensräume `uia` und `qt-object` sind
  explizit wählbar. Widersprüchliche Identitäten werden früh abgewiesen;
  Produktprofil und native Paketbindung werden geprüft.
- **Native Texteingriffe:** Vorbereitung und atomare Änderungsfreigabe liegen
  vor der ersten Mutation. Nur ein nachweislich gewonnener Abbruch vor dieser
  Freigabe belegt, dass keine Änderung begonnen hat. Ein bereits begonnener,
  ungewisser Commit bleibt abgleichpflichtig.
- **Begrenzte Wiederholung:** der optionale Busy-Retry-Helfer erlaubt höchstens drei
  Versuche ausschließlich bei validiertem HTTP 409 vor Dispatch, mit gleicher
  Instanz und gemeinsamem Zeitbudget. Timeouts, Verbindungsverlust und
  unbekannte Schreibausgänge werden nicht blind wiederholt.
  Ein nativer Snapshot-Read hat einen eigenen begrenzten Retry nur dann,
  wenn die Brücke seinen noch nicht gestarteten GUI-Auftrag nachweislich
  abgesagt hat. Er wiederholt weder eine Aktion noch eine Verbindung.
- **Qualitätsprozess:** die dokumentierte Main-Regel verlangt einen Pull
  Request, aufgelöste Review-Threads und den erfolgreichen
  `Offline API/MCP and package gate` auf aktuellem Stand. Das Contributor-
  Testinventar leitet Befehle, Suitezuordnung und Konfliktgruppen aus dem
  tatsächlichen Testplan ab. Regeln und Testauswahl werden selbst durch
  Verträge geprüft; die wirksamen GitHub-Regeln werden separat kontrolliert.

## Verbleibende Grenzen

- Explizites Cursorlesen und native Positionsnachweise können mehr Arbeit
  erfordern als passives Lesen. Ein schneller Leseweg ersetzt keine Cursor-
  oder Schreibabnahme.
- Vorbereitungs- und Abbruchtests beweisen nicht, dass jede Ursache seltener
  Unicode-Latenzen beseitigt ist. Weitere blockierende Provider-Aufrufe
  benötigen gezielte Nachweise. Ein erfolgreicher Folgelauf erklärt einen
  früheren Ausreißer nicht rückwirkend.
- Synchron blockierende Provider-/OS-Aufrufe können den Abschluss verzögern.
  Kurze Caller-Budgets können einen unbekannten Transportausgang liefern.
  Unbewiesenes Cleanup und begonnene ungewisse Änderungen bleiben gesperrt,
  bis ihr Zustand geklärt ist.
- Zwei gleiche Beobachtungen sind kein atomarer Snapshot. Die generischen
  Mechanismen belegen nicht jede Feld-/Label-Zuordnung oder alle Produktseiten.
- Die gesperrten BelegManager-Schreibwege benötigen noch eine strengere
  Behandlung unbekannter USt-Werte und eine erneute Eigentumsprüfung nach
  frischer Feldbindung vor der Rücknahme. Das ist bekannte Folgearbeit;
  die Schreibsperren bleiben maßgeblich.
- Ein positiver VaSt-Ende-zu-Ende-Ablauf ist im aggregierten Live-Ledger nicht
  belegt. Profil 2024 bleibt experimentell mit
  `operationAccess: "verification-only"`.
- Die Qt-Brücke ist optional und separat zu bauen. Allgemeine Feld- und
  Tabellenmutationen sowie Speichern behalten ihre bestehenden
  Transaktionswege; die Umstellung ist nicht abgeschlossen.

## Getrennte Folgearbeit

Die konkreten Kriterien für den vollständigen Qualitätsabschluss stehen in der
[Stable-Abnahme](docs/entwicklung/stable-freigabe.md), einschließlich VaSt,
realer Unterbrechungen, Persistenz, Leistung und Dauerlauf.

1. Eine konkrete Operation und ihren bisherigen Vertrag auswählen. Für die
   Qt-Umstellung gelten Zweck und Abnahmekriterien der [Roadmap](docs/ROADMAP.md).
2. Fehler erst einordnen: falsche Voraussetzung, verletzter Vertrag,
   ungeklärter Ausgang oder tatsächliche Regression. Bei ungewisser Mutation
   zuerst den Zustand abgleichen und die Bereinigung klären.
3. Fehlenden Gegenfall gezielt reproduzierbar machen; dann die kleinste
   Änderung umsetzen. Bindung, Readback, Ergebnisform und Sperren erhalten.
4. Betroffene Verträge und das passende Gate prüfen. Produkt- und GUI-Prüfungen
   bleiben ausdrücklich getrennt und brauchen eine unbenutzte Sitzung mit
   Wegwerfkopien.
5. Dokumentation, Testinventar und gegebenenfalls erzeugte Matrix synchron
   halten. Kleine Commits und Pull Requests erleichtern Prüfung und Rücknahme.

## Reproduzierbare Prüfung

Zuerst ohne Testausführung den Plan ansehen:

```powershell
npm run test:inventory
npm run --silent test:inventory -- --json
```

Die Voraussetzungen und die passende Mindestprüfung stehen in
[CONTRIBUTING.md](CONTRIBUTING.md). `npm run test:fast` und `npm test` enthalten
Windows-/Worker-Prüfungen und sind keine Zusage, dass sie neben aktiver
Produktbedienung unbedenklich laufen. Große Suites und GUI-/Controller-Reisen
seriell ausführen.

Native Komponentenprüfungen, `test:live`, `test:live-state`,
`test:live-native-add-update` und `perf:api-mega` bleiben gesonderte Prüfungen.
Das vollständige Release-Gate ist `npm run check`; eine grüne Offline-CI ersetzt
es nicht. Messwege und Nachweisgrenzen stehen in
[VERIFIKATION.md](docs/VERIFIKATION.md), der Ablauf im
[Health Check](health-check.md). Rohberichte und Umgebungsdaten bleiben
außerhalb des öffentlichen Repositorys.
