# Produktkatalog und Automationsgrenzen

Dieser Ordner beschreibt den unterstützten Produktaufbau, den aktuellen
Funktionsumfang und nachvollziehbare Abnahmekriterien für Erweiterungen.

Zur aktuellen Nutzer- und Vertragsdokumentation führt der
[Dokumentationsindex](../README.md).

Persönliche Entwicklungsnotizen, Messungen einzelner Rechner, Reviewartefakte
und Versuchsprotokolle bleiben außerhalb des Repositorys. Verifizierte
Bedienregeln stehen in `skills/`; diese Dokumente beschreiben die Produktgrenzen
und deren reproduzierbare Prüfung.

## Aktueller Inhalt

- [Native-Abdeckung](../NATIVE-COVERAGE.md): jede API-Operation mit direktem
  Qt-DLL-Status, getrennt vom funktionalen Live-Teststand;

- `status.md`: **eine Tafel für alles** — jede bekannte Fähigkeit mit Stand
  (fertig / teils / offen / bewusst zu), Beleg und Bauweg. Der Einstieg, wenn
  die Frage lautet „haben wir das schon?";
- `funktionskatalog.md`: die fachliche Landkarte — sieben Programmmodule mit
  gemessenen Navigationsbäumen, Funktionsgruppen aus dem Herstellerhandbuch und
  der Abgleich, was davon eine Operation hat;
- `aktionsinventar.md`: die aus dem laufenden Programm ausgelesene Menüstruktur
  mit der Zuordnung, welche Aktion eine Operation hat und welche nicht;
- `seitenlandkarte.md`: 85 gemessene Seiten aus Einkommensteuer und
  Gewinnermittlung mit ihrer Bauart. Beantwortet vor dem Profilieren die Frage,
  ob sich ein Seitenobjekt lohnt — und zeigt, dass die Antwort je Modul
  verschieden ausfällt;

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
