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

Der Testplan lässt sich vor dem Installieren der Abhängigkeiten mit der
festgelegten Node-Version anzeigen:

```powershell
npm run test:inventory
npm run --silent test:inventory -- --json
```

Dieser Befehl gibt nur den Plan aus. Er baut nichts und startet keine
Testprogramme, zusätzlichen Prozesse, API-Server oder Anwendung. Die Ausgabe
nennt für jeden Schritt Suite, Volltest-Ausführungsphase, benötigte Laufzeit
(`node` oder Windows PowerShell) und vorhandene Konfliktressource. Sie wird direkt
aus den bestehenden Voll- und Schnellplänen erzeugt; lokale Programmpfade
werden als `node` oder `powershell.exe` angezeigt. Native CTest- und Live-Läufe
gehören zu getrennten opt-in Befehlen und sind nicht Teil dieses Inventars.

`fullPhase` bezeichnet die Phase im Volltest. `fast` markiert die Zugehörigkeit
zum Schnellplan; dieser führt seine Buildschritte seriell und die übrigen
Schritte konfliktbewusst parallel aus. Ein Volltest-Finalschritt läuft im
Schnellplan deshalb nicht in einer eigenen Finalphase.

Abhängigkeiten und Build:

```powershell
npm ci --ignore-scripts
npm run build
npm run test:fast
```

Python und PowerShell 7 sind keine Laufzeitabhängigkeiten des
Produkts. PowerShell 7 kann lokal für robuste Entwickler-Skripte verwendet
werden.

Der schnelle Lauf enthält keine Checker-Worker-Probe, die ein fehlendes
SSE-Fenster voraussetzt. Dieser Vertrag bleibt im vollständigen `npm test`,
das vor dem Start ein geschlossenes SSE verlangt. Der schnelle Lauf enthält
Windows-PowerShell-Verträge, synthetische API-/MCP-Läufe und Helferprüfungen.
Er ist deshalb kein rein statischer Prüflauf für einen gerade benutzten PC.

Die getrennte native Qt-Fixture läuft auf einem eigenen inaktiven Desktop
und wird gesondert opt-in gestartet. Gleichzeitig darf keine Automation des
echten SSE den sitzungsweiten Controller verwenden.

## Branches und Commits

Erstelle einen kurzen Themenbranch und mische keine unabhängigen Änderungen.
Commit-Nachrichten folgen Conventional Commits, zum Beispiel:

```text
feat(api): add bounded operation discovery
fix(worker): preserve window identity on retry
docs(readme): clarify local setup
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
| npm-Laufzeit, Paketinhalt oder Release-Metadaten | `npm test`, `npm run pack`, `npm run publish:dry-run`, `npm run test:npm-clean-install` |
| UI-Bindung oder Profilverhalten | vollständige Offline-Suite und, wenn Voraussetzungen vorhanden sind, der passende opt-in Live-Lauf |

### Testebenen und Voraussetzungen

| Befehl | Umfang und Voraussetzungen |
| --- | --- |
| `npm run test:inventory` | Nur Planausgabe; Node.js genügt, kein Build und keine Testausführung |
| `npm run test:fast` | Schnellplan mit TypeScript-Build; Windows x64, festgelegte Node-Version, Abhängigkeiten und Windows PowerShell 5.1 |
| `npm test` | Vollständige Offline-Suite samt C#-Build und Controller-Prüfungen; Windows-Voraussetzungen wie oben, SSE muss geschlossen sein |
| `npm run test:qt-native` | Gesonderter opt-in Lauf mit gebautem Qt-Paket und passendem SDK; synthetische Qt-Fixture auf eigenem inaktivem Desktop |
| `npm run test:live` | Installiertes unterstütztes Produkt, Musterfallkopien, aktivierte Live-Konfiguration und unbenutzte entsperrte Windows-Sitzung |
| `npm run test:live-tax-knowledge` | Eigene kompatible Musterfallkopie, `SSE_KNOWLEDGE_SOURCE_FILE`, Testordner außerhalb des Repositorys und freie sichtbare Sitzung; Details unter [VERIFIKATION.md](docs/VERIFIKATION.md) |
| `npm run perf:api-mega` | Opt-in Reise durch das installierte Produkt; dieselben Voraussetzungen für Sitzung und Wegwerfdaten wie bei Live-Tests |
| `npm run check` | Release-Gate mit vollständiger Offline-Suite, installierter Produktidentität und Paketprüfungen |

Das Inventar beschreibt die Planung; es gibt keine zusätzliche Erlaubnis zur
Testausführung. Voraussetzungen gelten für die jeweilige Suite. Dateiendung
und `contract` im Namen belegen keine Nebenwirkungsfreiheit eines Schritts.
In einem Pull Request gehören tatsächliche Prüfergebnisse und fehlende
Voraussetzungen ausdrücklich in den Testnachweis.

### Dokumentation gezielt prüfen

Für Text und lokale Links gibt es direkte, statische Node-Prüfungen:

```powershell
node test/readme-contract.mjs
node test/repository-links-contract.mjs
```

`npm run docs:check` gleicht Operationsnamen und Teile der Statusangaben mit
Katalog und Ledger ab. Es setzt einen aktuellen TypeScript-Build samt
Abhängigkeiten voraus und baut diesen nicht selbst. Der Check ist bewusst
grob und ersetzt keine inhaltliche Prüfung von Prosa oder Nachweisen.

`node scripts/build-api-docs.mjs --check` vergleicht die erzeugte API-Referenz
mit dem aktuellen Build. Dafür startet es einen MCP-Prozess gegen eine
synthetische Loopback-API; Fachoperationen führt es dabei nicht aus. Die Option
`--check` verhindert das Schreiben der Referenz, nicht den Prozessstart.

Diese gezielten Prüfungen helfen beim Dokumentationsabgleich. Die
Mindestprüfungen der Tabelle und der erforderliche CI-Check gelten weiterhin.

`npm test` bleibt auf einem neutralen Windows-Rechner ohne installierte SSE
portabel. Wer die unterstützte SSE-2025-Standardinstallation besitzt, prüft die
lokale Produktidentität zusätzlich mit `npm run test:product`.

Für Änderungen am optionalen C++-Qt-Lesepfad kommt bei vorhandenem Qt-6.9.2-SDK
der native Build samt `npm run test:qt-native` hinzu. Der Ablauf steht unter
[NATIVE-QT.md](docs/NATIVE-QT.md). Die normale Offline-Suite prüft zusätzlich
Quellenidentität und Paketvertrag, ohne CMake oder ein Qt-SDK vorauszusetzen.

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

Prüfe anschließend die beiden JSON-Diffs einzeln. Welche Operation live belegt ist, hält `test/operation-coverage.json` fest.

## Pull Request

Ein Pull Request soll:

1. Problem, Lösung und Nutzerwirkung knapp erklären;
2. Sicherheits-, Datenschutz- und Kompatibilitätsgrenzen nennen;
3. alle ausgeführten Tests mit Ergebnis aufführen;
4. fehlende Live-Verifikation ehrlich als offen markieren;
5. keine generierten Artefakte, privaten Daten oder lokalen Konfigurationen
   enthalten.

Die read-only [Windows-CI](.github/workflows/windows-ci.yml) führt Audit,
Volltest und die Paketprüfungen aus. Der getrennte
npm-Publish-Workflow ist manuell, taggebunden und verwendet OIDC ohne
langlebiges npm-Token. Ein grüner
Offline-Lauf allein macht ein neues UI-Verhalten nicht live-verifiziert.

## Geschützter main

Änderungen an `main` gehen über einen Pull Request. Die kanonische
[Ruleset-Konfiguration](.github/main-ruleset.json) verlangt den erfolgreichen
GitHub-Actions-Check `Offline API/MCP and package gate` auf einem gegenüber
`main` aktuellen Stand sowie aufgelöste Review-Threads. Es gibt keine
Bypass-Akteure. Verpflichtende externe Freigaben stehen auf null, damit ein
einzelner Maintainer eigene PRs mergen kann; Community-Änderungen werden
weiterhin vor dem Merge geprüft.

Die Datei aktiviert GitHub-Regeln nicht selbst. Maintainer gleichen sie mit den
Repository-Einstellungen ab. Bereits aktive Regeln gegen Löschen und Force-push
bleiben erhalten; das zusätzliche Ruleset `main PR and CI` ergänzt sie.

Vor einer Aktivierung muss der genannte Check für den aktuellen Änderungsstand
im CI-Workflow erfolgreich laufen. Bei ersten Beiträgen aus einem Fork kann GitHub zunächst eine bewusste
Freigabe des Workflow-Laufs verlangen. Ein ausstehender Lauf wird weder durch
einen Dummy-Check noch durch einen Bypass ersetzt. Die CI verwendet
`pull_request`; fremder PR-Code erhält keine Publish-Secrets oder Schreibrechte.

Für den Abgleich zuerst die vorhandenen Rulesets lesen:

```powershell
gh api repos/yadimon/steuer-spar-erklaerung-mcp/rulesets --jq '.[] | {id, name, target, enforcement}'
```

Bei einer vorhandenen Ruleset `main PR and CI` deren vollständige Konfiguration
lesen und die passende ID verwenden. Bei mehreren passenden Einträgen zuerst
die Mehrdeutigkeit klären. Keine neue Ruleset über eine bestehende legen:

```powershell
$rulesetId = '<ID der vorhandenen main PR and CI Ruleset>'
gh api "repos/yadimon/steuer-spar-erklaerung-mcp/rulesets/$rulesetId"
gh api --method PUT "repos/yadimon/steuer-spar-erklaerung-mcp/rulesets/$rulesetId" --input .github/main-ruleset.json
```

Nur wenn keine passende Ruleset existiert, sie einmal neu anlegen:

```powershell
gh api --method POST repos/yadimon/steuer-spar-erklaerung-mcp/rulesets --input .github/main-ruleset.json
```

Anschließend die erzeugte oder aktualisierte Ruleset über ihre ID und die
effektiven Regeln von `main` erneut lesen:

```powershell
gh api "repos/yadimon/steuer-spar-erklaerung-mcp/rulesets/$rulesetId"
gh api repos/yadimon/steuer-spar-erklaerung-mcp/rules/branches/main
```

Beim Neuanlegen die zurückgegebene ID zuerst in `$rulesetId` übernehmen.
Abzugleichen sind Aktivierung, exakter Zielbranch, leere Bypass-Liste, PR-Regel,
aufgelöste Threads und der strikt aktuelle Pflichtcheck mit GitHub-Actions-App
`15368`. Die bestehenden Lösch- und Force-push-Sperren müssen weiterhin gelten.
Checkname und App-ID binden den Statusanbieter; Änderungen an Workflow und
Tests brauchen weiterhin eine inhaltliche Prüfung.

Maintainer folgen für Version, Tag und GitHub-Prerelease zusätzlich dem
[Release-Prozess](docs/RELEASE.md).
