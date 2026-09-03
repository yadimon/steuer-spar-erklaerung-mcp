# Repository Health Check

Dieser Playbook liefert ein reproduzierbares Gesundheitsurteil für API,
PC-blinden MCP-Wrapper, Windows-Worker, npm-Pakete und das unterstützte
SteuerSparErklärung-Profil. Er enthält bewusst keine eingefrorenen Test- oder
Operationszahlen: Diese werden bei jedem Lauf aus den maschinenlesbaren Quellen
ermittelt.

Der Health Check sendet nichts über ELSTER und verwendet keine echten
Steuerdaten. Live-Prüfungen laufen ausschließlich auf konfigurierten
herstellereigenen Wegwerfkopien; Rohberichte, lokale Pfade, Screenshots und
VM-Evidenz bleiben außerhalb von Git.

## Maßgebliche Quellen

- `package.json` und `test/suite-plan.mjs` für Build- und Testplan;
- `src/api-contract.ts` für den aktuellen Operationskatalog;
- `test/operation-coverage.json` und `docs/VERIFIKATION.md` für Live-Evidenz;
- `profiles/*/profile.json` für Produktfreigabe und Buildbindung;
- `SECURITY.md` und `docs/RELEASE.md` für Support- und Releasegrenzen.

Gezählte Werte werden aus diesen Dateien gelesen und nicht in diesem Playbook
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

Ein Registry-Ausfall ist `BLOCKED`, niemals ein grüner Audit.

## Automatische Gates

| Umfang | Befehl | Bedeutung |
| --- | --- | --- |
| schneller Vertrag | `npm run test:fast` | portable API-/MCP-, Skill-, Link-, Schema- und Metadatenverträge |
| vollständiger Offline-Vertrag | `npm test` | gesamter in `test/suite-plan.mjs` deklarierter Releaseplan |
| installiertes Produkt | `npm run test:product` | Identität, Modus, Profil und Katalog der lokalen Installation |
| saubere npm-Installation | `npm run test:npm-clean-install` | beide neu gebauten Pakete und alle öffentlichen Einstiegspunkte |
| Release-Metadaten | `npm run test:release-metadata` | Versionen, Security und aktuelle Release Notes synchron |
| Dokumentation | `npm run docs:check` | erzeugte Referenz vollständig, keine toten Operationsnamen, jede live belegte Operation in der Statustafel genannt |

Große Suites seriell ausführen. Ein optional fehlendes privates Archiv-Fixture
darf nur dort übersprungen werden, wo der konkrete Vertrag es ausdrücklich als
optional behandelt; andere fehlende Voraussetzungen bleiben Fehler oder
`BLOCKED`.

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
- ELSTER-, Versand- und Übermittlungswege sind gesperrt und werden durch diesen
  Playbook nie freigeschaltet.
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
4. Nach Möglichkeit zuerst den nächsten Regressionstest ergänzen.
5. Betroffenen Check und danach den vollständigen relevanten Gate wiederholen.
6. Erst nach grünem Scope-Review ein neues Urteil ausgeben.
