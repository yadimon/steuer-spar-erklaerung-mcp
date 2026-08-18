# Kontinuierliche Qualitätswartung

Diese Datei beschreibt den wiederholbaren Wartungsprozess. Sitzungsprotokolle,
persönliche Arbeitsaufträge, Uhrzeiten und temporäre Review-Zustände gehören
nicht in das Repository.

## Geltungsbereich

- lokale Windows-API, MCP-Wrapper und PowerShell-Worker;
- Produktprofile und portable Veröffentlichung;
- öffentliche deutsche Skills und Dokumentation;
- Tests, Datenschutz und Sicherheitsgrenzen.

Private Steuerfälle, lokale Nutzerpfade, Tokens und Review-Transkripte sind
ausgeschlossen.

## Ablauf einer Iteration

1. Arbeitsbaum, Produktprofil und betroffene Verträge lesen.
2. Das kleinste reproduzierbare Problem mit einem fokussierten Test belegen.
3. Verhalten und Sicherheitsgrenzen vor der Änderung festhalten.
4. Eine begrenzte, verständliche Änderung implementieren.
5. Fokus-Test, schnelle Suite und bei Laufzeitänderungen die vollständige Suite
   ausführen.
6. API-/MCP-Parität, Datenschutz, Links und Paketinhalt prüfen.
7. Öffentliche Texte auf aktuelle Produktinformationen und verständliche
   Nutzeranweisungen kontrollieren.
8. Nur grüne, überprüfte Änderungen mit Conventional Commit veröffentlichen.

## Priorisierung

1. Versand-, Datei- und Prozesssicherheit
2. Falsche oder nicht verifizierte Ergebnisse
3. API-/MCP-Vertragsbruch
4. Setup-, Portabilitäts- und Wiederherstellungsfehler
5. Geschwindigkeit und Wartbarkeit
6. Dokumentation und Bedienkomfort

Eine Optimierung darf keine Sicherheitsprüfung entfernen und keinen direkten
Worker-Zugriff außerhalb der API wieder einführen.

## Verbindliche Prüfungen

```powershell
npm run build:ts
npm run test:fast
npm test
npm run test:privacy
npm run test:links
```

Vor einem portablen Release zusätzlich:

```powershell
npm run package:portable
```

Echte UI-Tests verwenden ausschließlich ausdrücklich konfigurierte neutrale
Fixtures. Fehlt eine Fixture, wird dieser Teil als nicht ausgeführt gemeldet;
ein synthetischer Vertragstest darf nicht als realer UI-Nachweis ausgegeben
werden.

## Definition of Done

- Ursache und Änderung sind durch Tests belegt.
- API und MCP liefern für denselben Aufruf denselben Ergebnisvertrag.
- ELSTER bleibt gesperrt und Schreibaktionen bleiben zustandsgebunden.
- Keine privaten Daten oder maschinenspezifischen Pfade sind versioniert.
- Öffentliche Dokumentation beschreibt den aktuellen Nutzen und keine interne
  Entstehungsgeschichte.
- Verbleibende Grenzen werden konkret benannt.
