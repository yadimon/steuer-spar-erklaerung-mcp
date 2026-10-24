# Kriterien für einen stabilen Release

Die funktionale Live-Bilanz beschreibt die registrierten Tests über mehrere
Entwicklungsstände. Sie ist keine pauschale Freigabe aller Funktionen auf
jedem Backend. Ein Stable-Release braucht einen benannten Unterstützungsumfang
und zusätzliche Nachweise am tatsächlich zu veröffentlichenden Paket.

## Was vor der Freigabe zu prüfen ist

| Bereich | Erforderlicher Nachweis |
| --- | --- |
| Steuerwissen | Eindeutiges Fenster und Prozesslebensdauer; passende Treffer, bestätigte Nulltreffer, wiederholte Begriffe, mehrere Fenster und Fokusverlust; normales eigenes Cleanup |
| Positionsanlage | Erste und weitere Position; vollständige Inventare und Nettobeträge; falscher Hash, falsches Fenster, doppelte Namen, fehlgeschlagenes Backup und Unterbrechung |
| Versions- und Backendbindung | Paketversion und Integrität, Produktprofil und Produktbuild, native Manifestidentität, API oder MCP, tatsächlich verwendeter Ausführungspfad und konkrete Assertions |
| VaSt | Sichere positive Testdaten für alle sechs Operationen oder ausdrücklich begrenzter Unterstützungsumfang; bisherige Fehlerpfade reichen für eine uneingeschränkte Freigabe nicht aus |
| Tabellen und Persistenz | Add/Update/Delete, gescrollte und teilweise verdeckte Zeilen, Checkboxwechsel, Auswahl-/Datumswerte, identische Texte, Netto/Brutto und Rundung; vollständiger relevanter Bestand nach Save/Reopen |
| Störungen | Fokusverlust, fremde Eingabe, unerwarteter Dialog, Abbruch, geschlossene Zielinstanz und Antwortverlust vor/nach Mutation; keine Doppelmutation oder unbestätigte Erfolgsmeldung |
| Lebenszyklus | Saubere und geänderte Fälle, Speichern/Verwerfen/Abbrechen, mehrere Instanzen, native Start-/Stop-Wege; eigene Prozesse, Marker und Sperren freigegeben |
| Leistung | Erfolgreiche kalte und warme Reads, Navigation und Mutationen getrennt messen; Median, p95, Ausreißer und Fehlerrate; Schutzbedingungen bei Optimierungen beibehalten |
| Dauerlauf | Mindestens 60 Minuten reale Reads, Verbindungen und kontrollierte Arbeits-/Start-/Schließzyklen; Speicher, Handles, Threads, Worker und temporäre Dateien beobachten und Wachstum erklären |
| Unterstützte Umgebung | Normale Benutzerrechte, Unicode/Leerzeichen, Fenstergrößen und DPI, minimierte Fenster, mehrere Kopien und abweichende Builds; ungeeignete Ziele vor Mutation abweisen |
| Reproduzierbarkeit und Paket | Allgemeine opt-in Tests, dokumentierte Voraussetzungen, vollständiges Release-Gate, saubere Paketinstallation, synchronisierte Dokumentation und Sicherheitsprüfung des tatsächlichen Veröffentlichungsumfangs |

ELSTER-Versand bleibt gesperrt. Tests verwenden ausschließlich synthetische
Fälle oder eigene Kopien der Hersteller-Musterfälle. Ein fehlender Nachweis
wird als fehlend dokumentiert; ein allgemeiner Fehler ersetzt keinen
erfolgreichen Operationsvertrag.

## Schrittweises Vorgehen

1. Einen Fehler mit der kleinsten passenden Reise reproduzieren und den
   unveränderten Fehlerbericht erhalten.
2. Ursache, Zustandsbindung und erwartete Nachbedingungen bestimmen.
3. Den tatsächlichen Dispatcher oder Helfer mit deterministischen Negativtests
   absichern. Ein neuer Test darf sich bei fehlenden Voraussetzungen nicht
   selbst überspringen.
4. Die passende echte Reise auf einer eigenen Kopie wiederholen. Alle
   unberührten Werte, das vollständige relevante Inventar und das Cleanup
   gehören zur Abnahme.
5. Kleine Änderungen prüfen und committen; vor Veröffentlichung
   `npm run check` und die benötigten getrennten Live-/Qt-Prüfungen am selben
   Endstand ausführen.

Ein unbekannter Schreibausgang erlaubt keinen erneuten Schreibversuch.
Bekannt abgesagte, noch nicht gestartete native Snapshot-Reads dürfen dagegen
höchstens drei Gesamtversuche innerhalb derselben Frist und Sitzung erhalten.
Das setzt ausdrücklich `GUI_QUEUE_TIMEOUT`, `mutationAttempted=false` und
`outcomeUnknown=false` voraus. Ein Transportfehler ist kein solcher Nachweis.

Die allgemeinen Befehle und Voraussetzungen stehen in
[CONTRIBUTING.md](../../CONTRIBUTING.md) und
[VERIFIKATION.md](../VERIFIKATION.md). Einzelne Laufprotokolle, Steuerdaten und
Umgebungsinformationen gehören außerhalb des öffentlichen Repositorys.
