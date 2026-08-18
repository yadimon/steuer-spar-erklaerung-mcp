# Mitwirken

Danke für Interesse an der inoffiziellen SteuerSparErklärung-Automation. Das
Projekt verarbeitet potenziell besonders sensible Daten. Kleine, überprüfbare
Änderungen und klare Sicherheitsgrenzen sind wichtiger als ein großer
Funktionsumfang.

## Niemals echte Steuerdaten einreichen

Issues, Pull Requests, Test-Fixtures und Logs dürfen keine echten Steuerfälle,
Belege, Namen, Adressen, E-Mail-Adressen, Steuer-IDs, IBANs, API-Tokens, lokalen
privaten Pfade oder ungeschwärzten Screenshots enthalten. Verwende synthetische
Daten oder die vom Hersteller gelieferten Musterfälle ausschließlich als
Wegwerfkopien.

Mögliche Sicherheitslücken nicht öffentlich diskutieren. Nutze stattdessen
GitHubs private Funktion **Report a vulnerability**, wie in der
[Sicherheitsrichtlinie](SECURITY.md) beschrieben.

## Entwicklungsumgebung

- Windows x64;
- die in [.node-version](.node-version) festgelegte Node.js-22-Version;
- Windows PowerShell 5.1 für die produktive Automationsgrenze;
- eine installierte SteuerSparErklärung nur für ausdrücklich optionale
  Live-Tests.

Abhängigkeiten und Build:

```powershell
npm ci --ignore-scripts
npm run build
npm run test:fast
```

Python und PowerShell 7 sind keine Laufzeitabhängigkeiten des portablen
Produkts. PowerShell 7 kann lokal für robuste Entwickler-Skripte verwendet
werden.

## Branches und Commits

Erstelle einen kurzen Themenbranch und mische keine unabhängigen Änderungen.
Commit-Nachrichten folgen Conventional Commits, zum Beispiel:

```text
feat(api): add bounded operation discovery
fix(worker): preserve window identity on retry
docs(readme): clarify portable setup
test(ustva): cover period selection rollback
```

Verändere ELSTER-, Versand- oder Übermittlungssperren nicht. Eine neue
Schreiboperation braucht einen fail-closed Vertrag, eine verifizierte
Arbeitskopie, Vorher-/Nachher-Readback und getrennte reale Evidenz.

## Welche Tests sind erforderlich?

| Änderung | Mindestprüfung |
| --- | --- |
| Nur Dokumentation oder Skill-Text | `npm run test:fast` |
| TypeScript, PowerShell, API, MCP, Profile oder Tests | `npm test` |
| Portable Laufzeit, Paketinhalt oder Release-Metadaten | `npm test`, `npm run package:portable`, `npm run verify:portable-release` |
| UI-Bindung oder Profilverhalten | vollständige Offline-Suite und, wenn Voraussetzungen vorhanden sind, der passende opt-in Live-Lauf |

`npm test` bleibt auf einem neutralen Windows-Rechner ohne installierte SSE
portabel. Wer die unterstützte SSE-2025-Standardinstallation besitzt, prüft die
lokale Produktidentität zusätzlich mit `npm run test:product`.

`npm run test:live` benötigt eine installierte SSE, herstellerseitige
Musterfälle, eine unbenutzte entsperrte Windows-Sitzung und eine ausdrücklich
aktivierte Live-Konfiguration. Fehlende Voraussetzungen sind kein Fehler eines
normalen Pull Requests. Dokumentiere im PR genau, welcher Live-Lauf ausgeführt
oder warum er nicht ausgeführt wurde.

## Coverage- und Ergebnisform-Ratschen

`test/operation-coverage.json` und `test/operation-result-shape.json` werden
nicht von Hand geändert, nur damit ein Test grün wird. Prüfe zuerst, ob neue
Abdeckung oder neue Ergebnisfelder beabsichtigt, sicher und durch einen echten
Executor-Aufruf belegt sind. Eine bewusste Regeneration erfolgt in PowerShell
zusammen mit der vollständigen Suite:

```powershell
$env:SSE_WRITE_OPERATION_COVERAGE = '1'
$env:SSE_WRITE_OPERATION_SHAPE = '1'
npm test
Remove-Item Env:SSE_WRITE_OPERATION_COVERAGE
Remove-Item Env:SSE_WRITE_OPERATION_SHAPE
```

Prüfe anschließend die beiden JSON-Diffs einzeln. Details und Evidenzgrenzen
stehen in [docs/VERIFIKATION.md](docs/VERIFIKATION.md).

## Pull Request

Ein Pull Request soll:

1. Problem, Lösung und Nutzerwirkung knapp erklären;
2. Sicherheits-, Datenschutz- und Kompatibilitätsgrenzen nennen;
3. alle ausgeführten Tests mit Ergebnis aufführen;
4. fehlende Live-Verifikation ehrlich als offen markieren;
5. keine generierten Artefakte, privaten Daten oder lokalen Konfigurationen
   enthalten.

Die read-only [Windows-CI](.github/workflows/windows-ci.yml) führt Audit,
Volltest, portablen Paketbau und erneute Artefaktprüfung aus. Ein grüner
Offline-Lauf allein macht ein neues UI-Verhalten nicht live-verifiziert.

Maintainer folgen für Version, Tag und GitHub-Prerelease zusätzlich dem
[Release-Prozess](docs/RELEASE.md).
