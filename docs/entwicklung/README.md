# Entwicklungswissen und Erfahrungen

Dieser Ordner ist bewusst **kein installierter Agent Skill**. Er sammelt
sanitisierte Entwicklungsbeobachtungen, verworfene Ansätze, Ursachen früherer
Fehler, Messungen und Architekturentscheidungen.

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

- `erfahrungen/sse-automation-erfahrungen.md`: sanitisierte Qt/UIA-Fehler,
  verifizierte Gegenmaßnahmen, Sicherheitsnachbedingungen und offene Grenzen.

Historische Kopien öffentlicher Skills, agentenspezifische Arbeitspläne und
Werkzeugprotokolle gehören nicht hierher. Der aktuelle Nutzervertrag liegt
ausschließlich unter `skills/`; Architektur und Verifikation liegen in den
gleichnamigen öffentlichen Dokumenten unter `docs/`.

Temporäre Claude-/Codex-Reviewartefakte und lokale Sitzungsprotokolle werden
nicht eingecheckt.
