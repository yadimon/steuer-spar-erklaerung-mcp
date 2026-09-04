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

- `status.md`: **eine Tafel für alles** — jede bekannte Fähigkeit mit Stand
  (fertig / teils / offen / bewusst zu), Beleg und Bauweg. Der Einstieg, wenn
  die Frage lautet „haben wir das schon?";
- `funktionskatalog.md`: die fachliche Landkarte — sieben Programmmodule mit
  gemessenen Navigationsbäumen, Funktionsgruppen aus dem Herstellerhandbuch und
  der Abgleich, was davon eine Operation hat;
- `aktionsinventar.md`: die aus dem laufenden Programm ausgelesene Menüstruktur
  mit der Zuordnung, welche Aktion eine Operation hat und welche nicht;
- `seitenlandkarte.md`: 55 gemessene Seiten der Einkommensteuer mit ihrer
  Bauart. Beantwortet vor dem Profilieren die Frage, ob sich ein Seitenobjekt
  für eine Seite überhaupt lohnt;
- `erfahrungen/sse-automation-erfahrungen.md`: sanitisierte Qt/UIA-Fehler,
  verifizierte Gegenmaßnahmen, Fall-/Backup-Sitzungsgrenzen,
  BelegManager-Bindungen, Sicherheitsnachbedingungen und offene Grenzen.

## Wie diese Dokumente ehrlich bleiben

Zwei Skripte halten die Dokumentation an den Quellen fest:

| Skript | Befehl | Was es sichert |
|---|---|---|
| `scripts/build-api-docs.mjs` | `npm run docs:build` | erzeugt `docs/API-REFERENZ.md` aus dem laufenden MCP-Server, den Operationsmerkmalen und dem Abdeckungsledger; `--check` schlägt an, sobald der Text abweicht |
| `scripts/check-docs-consistency.mjs` | `npm run docs:check` | prüft die **handgeschriebenen** Dokumente: keine toten Operationsnamen, jede live belegte Operation irgendwo genannt, kein `fertig` für etwas, das nur auf dem Fehlerpfad belegt ist |

Beide laufen in `npm test`. Die zweite Prüfung ist bewusst grob — Seiten- und
Menünamen des Produkts lassen sich nicht auf Operationsnamen abbilden. Sie
fängt die Abweichung, die tatsächlich passiert: eine gebaute und belegte
Operation, von der kein Dokument erzählt.

Historische Kopien öffentlicher Skills, agentenspezifische Arbeitspläne und
Werkzeugprotokolle gehören nicht hierher. Der aktuelle Nutzervertrag liegt
ausschließlich unter `skills/`; Architektur und Verifikation liegen in den
gleichnamigen öffentlichen Dokumenten unter `docs/`.

Temporäre Claude-/Codex-Reviewartefakte und lokale Sitzungsprotokolle werden
nicht eingecheckt.
