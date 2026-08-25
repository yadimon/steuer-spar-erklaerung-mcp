import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");

for (const heading of [
  "## Features",
  "## Prompts",
  "### Basic Prompt",
  "### Robuster isolierter Prüflauf",
  "### Referenzdokumente",
]) {
  assert(readme.includes(heading), `README-Abschnitt fehlt: ${heading}`);
}

for (const feature of [
  "SteuerSparErklärung 2025",
  "BelegManager",
  "Umsatzsteuer-Voranmeldung",
  "verifizierten Arbeitskopie",
  "98",
]) {
  assert(readme.includes(feature), `README-Feature fehlt: ${feature}`);
}

for (const reference of [
  "docs/INSTALLATION.md",
  "docs/ARCHITEKTUR.md",
  "docs/API-MCP-VERTRAG.md",
  "docs/UMSATZSTEUER-VORANMELDUNG.md",
  "docs/VERIFIKATION.md",
  "skills/steuer-spar-erklaerung/SKILL.md",
]) {
  assert(readme.includes(reference), `README-Referenz fehlt: ${reference}`);
}

assert.match(readme, /npx.+ohne MCP/isu, "Der isolierte Prompt muss den temporären NPX-Weg ohne MCP erklären.");
assert.match(readme, /ELSTER.+(?:nicht|nichts|keine)/isu, "Die Prompt-Dokumentation muss die ELSTER-Grenze nennen.");

process.stdout.write("README: Features, zwei Prompts und Kernreferenzen bestanden\n");
