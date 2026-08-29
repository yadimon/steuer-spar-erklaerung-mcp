# Dokumentation

Dieser Index trennt aktuelle Nutzeranleitungen, technische Verträge,
Entwicklungswissen und historische Evidenz. Bei einem Widerspruch gelten die
maschinenlesbaren Runtime-Verträge und die hier benannten kanonischen Quellen;
alte Release Notes sind niemals eine aktuelle Bedienungsanweisung.

## Für Nutzer und Agenten

- [Projektüberblick und sichere Prompts](../README.md) — unterstützter Umfang,
  Auswahl des Arbeitswegs und kurze Einstiege;
- [Installation](INSTALLATION.md) — kanonischer Setup-, Update- und
  Client-Vertrag;
- [Öffentlicher Post](OEFFENTLICHER-POST.md) — kurzer kopierbarer Ersatztext
  zum vereinfachten MCP-/API-Setup;
- [Haupt-Skill](../skills/steuer-spar-erklaerung/SKILL.md) — verbindlicher
  Ablauf für Prüfung und kontrollierte Bearbeitung;
- [Umsatzsteuer-Voranmeldung](UMSATZSTEUER-VORANMELDUNG.md) — fachlicher und
  technischer UStVA-Ablauf;
- [Abgleichvorlage](ABGLEICH-BEISPIEL.md) — strukturierter Vergleich mit einer
  externen Belegaufstellung;
- [Sicherheitsrichtlinie](../SECURITY.md) — Support-, Melde- und Betriebsgrenze.

## Produkt- und Transportverträge

- [Produktarchitektur](ARCHITEKTUR.md) — Zielbild, Schichten, Profile und
  harte Grenzen;
- [API-/MCP-Vertrag](API-MCP-VERTRAG.md) — Transport, Schemas, Queue,
  Abbruch und Evidenzgrenze;
- [Verifikationsstand](VERIFIKATION.md) — aktuelle Offline-/Live-Abdeckung und
  ausdrücklich offene Nachweise;
- [API-Paket](../packages/api/README.md) und
  [MCP-Paket](../packages/mcp/README.md) — npm-spezifische Einstiege und
  Paketgrenzen.

## Für Mitwirkende und Maintainer

- [Mitwirken](../CONTRIBUTING.md) — Entwicklungsumgebung, Tests, Datenschutz
  und Pull Requests;
- [Release-Prozess](RELEASE.md) — aktueller tag-, npm- und
  Trusted-Publishing-Ablauf;
- [Repository Health Check](../health-check.md) — reproduzierbarer
  Gesundheits-Playbook ohne eingefrorene Zähler;
- [Entwicklungswissen](entwicklung/README.md) — historische Ursachen,
  Messungen und verworfene Ansätze;
- [Performance-Harness](../test/performance/README.md) — synthetische,
  produktfreie Benchmarks und ihre Beweisgrenzen.

## Historische und interne Unterlagen

- [`releases/`](releases/) enthält versionierte Release Notes. Aussagen über
  frühere Tokens, ZIPs, Operationszahlen oder Supportgrenzen beschreiben nur
  den damaligen Stand.
- `skills-data/` im Repository enthält interne Profile für Wartungsabläufe.
  Diese Dateien dürfen keine eigenen Release-Zähler oder dauerhaften
  Gesundheitsurteile führen; aktuelle Werte werden aus Suite, Katalog und
  Coverage-Ledger abgeleitet.
- Datierte Abschnitte in [VERIFIKATION.md](VERIFIKATION.md) sind
  Beobachtungsnachweise. Die aktuelle Laufzeitfreigabe steht dagegen in
  `capabilities.operationPolicy`.

## Quellen der Wahrheit

| Frage | Maßgebliche Quelle |
| --- | --- |
| Was ist installiert und unterstützt? | `package.json`, `SECURITY.md`, `profiles/*/profile.json` |
| Welche Operationen existieren? | `src/api-contract.ts`, laufendes `discovery` |
| Welche Operation ist aktuell erreichbar? | laufendes `capabilities.operationPolicy` |
| Wie wird installiert? | `docs/INSTALLATION.md` |
| Was ist live belegt? | `test/operation-coverage.json`, `docs/VERIFIKATION.md` |
| Welche Tests gehören zum Gate? | `test/suite-plan.mjs` |
| Wie wird veröffentlicht? | `docs/RELEASE.md`, npm-Publish-Workflow |
