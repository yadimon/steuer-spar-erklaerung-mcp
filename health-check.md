# Zustandsprüfung des Repositorys

Dieses Prüfhandbuch liefert ein reproduzierbares Gesundheitsurteil für API,
MCP-Wrapper ohne eigene Desktopbedienung, Windows-Worker, npm-Pakete und das
unterstützte SteuerSparErklärung-Profil. Es enthält bewusst keine eingefrorenen Test- oder
Operationszahlen: Diese werden bei jedem Lauf aus den maschinenlesbaren Quellen
ermittelt.

Der Health Check sendet nichts über ELSTER und verwendet keine echten
Steuerdaten. Live-Prüfungen laufen ausschließlich auf konfigurierten
herstellereigenen Wegwerfkopien; Rohberichte, lokale Pfade, Screenshots und
Prüfprotokolle bleiben außerhalb von Git.

## Maßgebliche Quellen

- `package.json` und `test/suite-plan.mjs` für Build- und Testplan;
- `npm run test:inventory` für die abgeleitete Planausgabe ohne Testausführung;
- `src/api-contract.ts` für den aktuellen Operationskatalog;
- `test/operation-coverage.json` für Live-Evidenz;
- `profiles/*/profile.json` für Produktfreigabe und Buildbindung;
- `SECURITY.md` und `docs/RELEASE.md` für Support- und Releasegrenzen.

Die [Contributor-Anleitung](CONTRIBUTING.md) ordnet Voraussetzungen und
Mindestprüfungen nach Änderungsart zu. Der [Projektstand](PROGRESS.md) hält
Implementierung und verbleibende Grenzen fest. Beide ersetzen keinen aktuellen
Prüfnachweis.

Gezählte Werte werden aus diesen Dateien gelesen und nicht in diesem Prüfhandbuch
dupliziert. Release Notes bleiben historische Evidenz und sind keine aktuelle
Health-Quelle.

## Voraussetzungen

- Windows x64 mit der Node.js-Version aus `.node-version` und npm;
- Windows PowerShell 5.1 für die produktive Worker-Grenze;
- Abhängigkeiten aus dem eingecheckten Lockfile;
- für Produkt- und Live-Prüfungen die unterstützte
  SteuerSparErklärung-Installation;
- für UI-Läufe eine entsperrte, ansonsten unbenutzte Windows-Sitzung und
  ausschließlich Wegwerffälle;
- keine fremde API-, MCP- oder SSE-Instanz, die Testressourcen besitzt.

## Repository-Invarianten

| Prüfung | Befehl | Erfolg |
| --- | --- | --- |
| Datenschutz und verbotene Artefakte | `npm run test:privacy` | Exitcode 0 |
| Markdown-Ziele und Anker | `npm run test:links` | Exitcode 0 |
| TypeScript | `npm run build:ts` | Exitcode 0 ohne Compilerfehler |
| Arbeitsbaum | `git diff --check` und `git status --short` | nur beabsichtigte Änderungen |
| Produktionsabhängigkeiten | `npm audit --omit=dev --audit-level=low` | keine gemeldete Schwachstelle |
| Vollständiger Abhängigkeitsbaum | `npm audit --audit-level=low` | keine gemeldete Schwachstelle |

Die beiden Audit-Befehle oben sind eine zusätzliche Prüfung ab der niedrigsten
Schwereklasse. Die Windows-CI und `npm run check` verwenden dagegen tatsächlich
`npm audit --omit=dev --audit-level=high`: ein grüner CI-Check beweist deshalb
keine vollständige Freiheit von Schwachstellen aller Schwereklassen.

Ein Registry-Ausfall ist `BLOCKED`, niemals ein grüner Audit.

Der Audit-Dienst und die Paket-Registry sind getrennte Dienste. Ein Timeout
oder eine ungültige Antwort des Audit-Endpunkts beweist keinen Fehler im
lokalen Abhängigkeitsbaum. Einen solchen Lauf als `BLOCKED` behandeln und
Dienstverfügbarkeit sowie Lockfile getrennt prüfen.

Den fehlgeschlagenen Dienst und den Audit-Exitcode festhalten. Ein erfolgreicher
Registry-Ping belegt nicht die Verfügbarkeit des Audit-Endpunkts. Eine erneute
Audit-Abfrage darf den dokumentierten Prüfmaßstab nicht herabsetzen.

## Automatische Gates

| Umfang | Befehl | Bedeutung |
| --- | --- | --- |
| Testinventar | `npm run test:inventory` | zeigt Befehle, Suitezuordnung und Konfliktgruppen; führt keine Tests aus |
| schneller Vertrag | `npm run test:fast` | TypeScript-Build und ausgewählte Node-/Windows-PowerShell-Verträge; kein rein statischer oder plattformunabhängiger Lauf |
| vollständiger Offline-Vertrag | `npm test` | gesamter in `test/suite-plan.mjs` deklarierter Releaseplan |
| installiertes Produkt | `npm run test:product` | Identität, Modus, Profil und Katalog der lokalen Installation |
| saubere npm-Installation | `npm run test:npm-clean-install` | beide neu gebauten Pakete und alle öffentlichen Einstiegspunkte |
| Release-Metadaten | `npm run test:release-metadata` | Versionen, Security und aktuelle Release Notes synchron |
| erzeugte Referenz | `npm run docs:build -- --check` | `docs/API-REFERENZ.md` entspricht Katalog, Merkmalen und Abdeckungsledger |
| handgeschriebene Doku | `npm run docs:check` | prüft Operationsnamen, Erwähnung live belegter Operationen, ausgewählte Gesamtzahlen und grobe Widersprüche in `fertig`-Zeilen |

Die Planausgabe ist auch maschinenlesbar über
`npm run --silent test:inventory -- --json`. `fullPhase` nennt die Phase der
vollständigen Suite; der Schnellplan ordnet seine Schritte teilweise anders an.
Ein Dateiname mit `contract` oder `.mjs` beweist keine Nebenwirkungsfreiheit.
Die vollständige Offline-Suite baut den C#-Helfer und prüft Controllergrenzen;
SSE muss dafür geschlossen sein. Native CTest-Prüfungen und Produktreisen sind
gesondert konfiguriert und kein Teil dieser Planausgabe.

Die Dokumentationsprüfung kann weder vollständige fachliche Aussagen noch die
Live-Abdeckung jeder Operation einer gemeinsam bewerteten Tabellenzeile
beweisen. Dazu bleiben Quellenreview und getrennte Nachweisbewertung nötig.

Große Suites seriell ausführen: Parallel gestartete Suites können denselben
Build- und Paketbaum verändern. Die im Testplan gesteuerte interne Parallelität
mit Konfliktgruppen ist davon zu unterscheiden. Den Exitcode jedes Gates direkt
prüfen; eine nachgeschaltete Ausgabe- oder Filterstufe darf ihn nicht verdecken.
Eine optional fehlende externe Archiv-Fixture
darf nur dort übersprungen werden, wo der konkrete Vertrag es ausdrücklich als
optional behandelt; andere fehlende Voraussetzungen bleiben Fehler oder
`BLOCKED`.

### Pull Requests und CI

Die [Windows-CI](.github/workflows/windows-ci.yml) führt den Check
`Offline API/MCP and package gate` mit lesenden Repository-Rechten aus. Sie
prüft Produktionsabhängigkeiten ab `high`, die vollständige Offline-Suite, den
deterministischen Plugin-Baum und die saubere Installation beider npm-Pakete.
Sie beweist keine vollständige native Qt- oder Produktreise.

Die Sollregel für `main` steht in [`.github/main-ruleset.json`](.github/main-ruleset.json):
Pull Request, aufgelöste Review-Threads und der erfolgreiche Actions-Check
auf gegenüber `main` aktuellem Stand. Die Datei allein aktiviert keine
GitHub-Regel; Einrichtung und Kontrolle stehen in
[CONTRIBUTING.md](CONTRIBUTING.md). Änderungen an Tests und CI benötigen auch
inhaltliches Review, weil ein identischer Checkname allein den Testumfang
nicht schützt.

## Live- und manuelle Prüfungen

| Prüfung | Befehl oder Handlung | Erfolg |
| --- | --- | --- |
| Live-UI-Gate | `npm run test:live` | vollständiger Exitcode 0, kein SKIP und keine besessene SSE-Instanz übrig |
| Scope-/Privacy-Review | finalen Status und Diff lesen | keine privaten oder unbeabsichtigten Dateien |
| Release-Review | Registry-Versionen, dist-tags, Tag und GitHub-Prerelease vergleichen | nur wenn Veröffentlichung im Scope liegt |

Fehlen Voraussetzungen des Live-Gates, lautet das Gesamturteil höchstens
`AT_RISK`. Mock-, Schema- und Produktidentitätstests ersetzen keine echte
UI-Evidenz.

## Bekannte Produktgrenzen

- Unterstützt ist das in `profiles/2025/profile.json` als `supported/full`
  ausgewiesene Profil; 2024 bleibt experimentell und verification-only.
- ELSTER-, Versand- und Übermittlungswege sind gesperrt und werden durch dieses
  Prüfhandbuch nie freigeschaltet.
- Die erfolgreichen und nur im Fehlerpfad belegten Operationen werden aus
  `test/operation-coverage.json` abgeleitet; dort als `error-path-only`
  markierte VaSt-Wege besitzen keinen erfolgreichen zertifikatgebundenen
  Live-Nachweis.
- Von den zehn BelegManager-Operationen ist öffentlich nur
  `receipt_manager_list` aktiv; die übrigen neun benötigen eine nicht
  öffentlich aktivierbare Test-Lease und bleiben fail-closed gesperrt.
- UI-Automation setzt einen entsperrten, unbenutzten Desktop und
  Wegwerf-Fixtures voraus.

## Urteil

- `HEALTHY`: alle erforderlichen Repository-, Offline-, Produkt- und
  Live-Prüfungen bestanden; manueller Scope-Review ist sauber.
- `AT_RISK`: kein erforderlicher Vertrag ist rot, aber Live-Gate, Registry oder
  eine andere externe Voraussetzung ist blockiert.
- `UNHEALTHY`: ein erforderlicher kritischer Vertrag scheitert oder mehrere
  kontrollierbare Voraussetzungen fehlen.

Optionale Release-Prüfungen senken ein sonst gültiges Urteil nicht, wenn keine
Veröffentlichung beauftragt ist.

## Fehlerprotokoll

1. Weitere Refactorings, Releases und Publikationen stoppen.
2. Nur minimale, nicht private Evidenz sichern.
3. Regression, veralteten Vertrag, fehlende Umgebung oder externen Ausfall
   unterscheiden.
4. Bei einer Mutation zuerst zwischen bestätigter Ablehnung vor Ausführung und
   unbekanntem Ausgang unterscheiden. Kein blindes Wiederholen und kein
   automatischer Backendwechsel; Zustand und Bereinigung getrennt klären.
5. Nach Möglichkeit zuerst einen gezielten Regressionstest ergänzen. Danach
   betroffenen Check und das vollständige relevante Gate prüfen. Ein
   erfolgreicher Folgelauf erklärt die ursprüngliche Ursache nicht von selbst.
6. Erst nach grünem Scope-Review ein neues Urteil ausgeben.
