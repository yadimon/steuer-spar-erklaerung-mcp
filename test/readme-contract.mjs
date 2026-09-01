import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");

for (const heading of [
  "## Was kann es?",
  "## Voraussetzungen und harte Grenzen",
  "### Ich nix ITler",
  "### Ich bin ITler",
  "## Beispielaufträge",
  "## Architektur und Sicherheit",
  "## Dokumentation",
]) {
  assert(readme.includes(heading), `README-Abschnitt fehlt: ${heading}`);
}

for (const feature of [
  "SteuerSparErklärung 2025",
  "BelegManager",
  "Umsatzsteuer-Voranmeldungen",
  "aktuellen Dateistand kontrolliert ändern",
  "99 versionierte API-Operationen",
  "sse_preflight",
]) {
  assert(readme.includes(feature), `README-Feature fehlt: ${feature}`);
}

for (const reference of [
  "docs/README.md",
  "docs/INSTALLATION.md",
  "docs/ARCHITEKTUR.md",
  "docs/API-MCP-VERTRAG.md",
  "docs/UMSATZSTEUER-VORANMELDUNG.md",
  "docs/VERIFIKATION.md",
  "skills/steuer-spar-erklaerung/SKILL.md",
]) {
  assert(readme.includes(reference), `README-Referenz fehlt: ${reference}`);
}

assert.match(readme, /ELSTER.+(?:nicht|nichts|keine)/isu, "README muss die ELSTER-Grenze nennen.");
assert.match(readme, /Save As.+keine impliziten Sicherheitsmaßnahmen/isu,
  "README darf Save As oder Arbeitskopien nicht still als Sicherheitsweg vorgeben.");
assert.match(readme, /GewErfass2026.+ausschließlich.+Leseweg/isu,
  "README muss den Folgejahr-UStVA-Weg begrenzen.");
assert.match(readme, /npm\.cmd install --save-exact @yadimon\/steuer-spar-erklaerung-mcp@latest/u);
assert.match(readme, /npm.+MCP und API.+node_modules/isu,
  "README muss die automatisch installierte API-Dependency erklären.");
assert.match(readme, /github\.com\/yadimon\/steuer-spar-erklaerung-mcp\/releases/u);
assert.doesNotMatch(readme, /docs\/releases\/v\d+\.\d+\.\d+(?:-[^)\s]+)?\.md/iu);
assert.doesNotMatch(readme, /v\d+\.\d+\.\d+-beta\.\d+/iu);
assert.match(readme, /neun Vordergrundwege.+API-CLI und MCP.+fail-closed/isu);
assert(!readme.includes("Robuster isolierter Prüflauf"));
assert(!readme.includes("Dauerhaftes Setup mit zwei Prompts"));
assert(!/npm(?:\.cmd)? install --global/u.test(readme));

process.stdout.write("README: zwei Zielgruppen, Preflight, lokale Installation und Kernreferenzen bestanden\n");
