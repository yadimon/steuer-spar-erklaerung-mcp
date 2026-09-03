# Entwicklungswissen und Erfahrungen

Dieser Ordner ist bewusst **kein installierter Agent Skill**. Er sammelt
sanitisierte Entwicklungsbeobachtungen, verworfene Ansätze, Ursachen früherer
Fehler, Messungen und Architekturentscheidungen.

Zur aktuellen Nutzer- und Vertragsdokumentation führt der
[Dokumentationsindex](../README.md).

## Trennregel

| Gehört hierher | Gehört in `skills/` |
|---|---|
| „Ansatz X hing wegen Qt-`FindAll`“ | „Kein ungebremstes `FindAll` verwenden“ |
| genaue Fehlerhistorie und Reparatur | aktuelle sichere Recovery-Anweisung |
| Benchmarks und Versuchsaufbau | belastbarer Laufzeit-Default |
| Refactoring- und Reviewnotizen | nur der resultierende Nutzervertrag |
| interne Backlog-Hypothesen | keine unfertigen Versprechen |

Entwicklungswissen darf echte Steuerdaten, Namen, Konten, lokale private Pfade
oder Zugangsdaten auch hier nicht enthalten. Wiederverwendbare Erkenntnisse
werden erst nach Verifikation als kurze aktuelle Regel in einen Skill
übernommen. Die historische Begründung bleibt in diesem Ordner.

## Aktueller Inhalt

- `funktionskatalog.md`: die fachliche Landkarte — sieben Programmmodule mit
  gemessenen Navigationsbäumen, Funktionsgruppen aus dem Herstellerhandbuch und
  der Abgleich, was davon eine Operation hat;
- `aktionsinventar.md`: die aus dem laufenden Programm ausgelesene Menüstruktur
  mit der Zuordnung, welche Aktion eine Operation hat und welche nicht;
- `erfahrungen/sse-automation-erfahrungen.md`: sanitisierte Qt/UIA-Fehler,
  verifizierte Gegenmaßnahmen, Fall-/Backup-Sitzungsgrenzen,
  BelegManager-Bindungen, Sicherheitsnachbedingungen und offene Grenzen.

Historische Kopien öffentlicher Skills, agentenspezifische Arbeitspläne und
Werkzeugprotokolle gehören nicht hierher. Der aktuelle Nutzervertrag liegt
ausschließlich unter `skills/`; Architektur und Verifikation liegen in den
gleichnamigen öffentlichen Dokumenten unter `docs/`.

Temporäre Claude-/Codex-Reviewartefakte und lokale Sitzungsprotokolle werden
nicht eingecheckt.
