# Dokumentation

Der Nutzerstandard ist das selbstenthaltene Agent Plugin. Alte Release Notes
und historische VM-Berichte beschreiben ihren damaligen Stand und sind keine
aktuelle Installationsanweisung.

## Einstieg

- [Projektüberblick und Schnellstart](../README.md) — Fähigkeit, Grenzen,
  target-spezifische Installationsfolge und erste Aufträge;
- [Installation](INSTALLATION.md) — Codex-/Claude-Code-Setup, First run,
  Datenablage, Update, sichere Entfernung und Fehlerbehebung;
- [Skill](../skills/steuer-spar-erklaerung/SKILL.md) — kurzer Router für
  wiederverwendbare Prüf-, Beleg-, Änderungs- und UStVA-Abläufe;
- [Öffentlicher Artikel](OEFFENTLICHER-POST.md) — kopierbarer Ankündigungstext.

## Produkt- und Sicherheitsverträge

- [Architektur](ARCHITEKTUR.md) — Agent Plugin, MCP/API-Singleton, Worker und
  Produktprofile;
- [API-/MCP-Vertrag](API-MCP-VERTRAG.md) — Transport, Schemas, Queue, Abbruch
  und Evidenzgrenze;
- [API-Referenz](API-REFERENZ.md) — alle Operationen mit MCP-Werkzeug, Art,
  Build-Drift-Sperre und Verifikationsstand; wird aus den Quellen erzeugt;
- [Umsatzsteuer-Voranmeldung](UMSATZSTEUER-VORANMELDUNG.md) — fachlicher und
  technischer UStVA-Ablauf;
- [Verifikationsstand](VERIFIKATION.md) — Offline-/Live-Abdeckung, historische
  Evidenz und die ausdrücklich offene Plugin-VM-Matrix;
- [Sicherheitsrichtlinie](../SECURITY.md) — Support-, Melde- und
  Betriebsgrenze.

## Fortgeschrittene Nutzung

- [API-Paket](../packages/api/README.md) — direkte HTTP-/CLI-Nutzung ohne
  Agent Plugin;
- [MCP-Paket](../packages/mcp/README.md) — standalone npm-MCP-Installation;
- [Abgleichvorlage](ABGLEICH-BEISPIEL.md) — strukturierter Vergleich mit
  einer externen Belegaufstellung.

Diese Wege bleiben unterstützt, sind aber nicht der normale Einstieg.

## Für Mitwirkende

- [Mitwirken](../CONTRIBUTING.md) — Entwicklung, Tests und Datenschutz;
- [Fähigkeiten und offene Lücken](ROADMAP.md) — was fertig ist, was fehlt und
  auf welchem Bauweg es zu schließen wäre;
- [Release-Prozess](RELEASE.md) — versionsgleicher Plugin-/npm-Release und
  verifizierte Registry-/VM-Gates;
- [Repository Health Check](../health-check.md) — reproduzierbares Playbook;
- [Statustafel](entwicklung/status.md) — jede bekannte Fähigkeit des Produkts
  mit ihrem Stand bei uns; der Einstieg für „haben wir das schon?";
- [Seitenlandkarte](entwicklung/seitenlandkarte.md) — gemessene Bauart der
  Seiten beider Module; sagt, wo ein Seitenobjekt etwas bringt und wo nicht;
- [Entwicklungswissen](entwicklung/README.md) — Funktionskatalog,
  Aktionsinventar, historische Ursachen und verworfene Ansätze;
- [Performance-Harness](../test/performance/README.md) — produktfreie
  Benchmarks und ihre Beweisgrenzen.

## Quellen der Wahrheit

| Frage | Maßgebliche Quelle |
| --- | --- |
| Welche Version gehört zusammen? | zentrales Release-Metadatum und generierte Manifeste |
| Was ist installiert und unterstützt? | `package.json`, `SECURITY.md`, `profiles/*/profile.json` |
| Welche Operationen existieren? | `src/api-contract.ts`, laufendes `discovery` |
| Welche Operation kann was, und wie belegt? | [API-REFERENZ.md](API-REFERENZ.md), erzeugt aus Katalog, Merkmalen und Ledger |
| Was fehlt noch, und auf welchem Weg? | [ROADMAP.md](ROADMAP.md) |
| Welche Operation ist erreichbar? | laufendes `capabilities.operationPolicy` |
| Wie wird installiert? | [INSTALLATION.md](INSTALLATION.md) |
| Was ist live belegt? | `test/operation-coverage.json`, [VERIFIKATION.md](VERIFIKATION.md) |
| Welche Tests gehören zum Gate? | `test/suite-plan.mjs` |
| Wie wird veröffentlicht? | [RELEASE.md](RELEASE.md), npm-Publish-Workflow |
