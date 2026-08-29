import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");

for (const heading of [
  "## Features",
  "## Prompts",
  "### Dauerhaftes Setup mit zwei Prompts",
  "### Robuster isolierter Prüflauf",
  "## Referenzdokumente",
]) {
  assert(readme.includes(heading), `README-Abschnitt fehlt: ${heading}`);
}

for (const feature of [
  "SteuerSparErklärung 2025",
  "BelegManager",
  "Umsatzsteuer-Voranmeldung",
  "Bereits geöffneten Fall bearbeiten",
  "aktuellen Dateistands kontrolliert ändern",
  "99",
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

assert.match(readme, /npx.+ohne MCP/isu, "Der isolierte Prompt muss den temporären NPX-Weg ohne MCP erklären.");
assert.match(readme, /ELSTER.+(?:nicht|nichts|keine)/isu, "Die Prompt-Dokumentation muss die ELSTER-Grenze nennen.");
assert.match(readme, /Dateihash.+unverändert.+wiederverwendet/isu,
  "Der normale Ablauf muss die einmalige Sicherung je Dateistand erklären.");
assert.match(readme, /Save As.+keine impliziten Sicherheitsmaßnahmen/isu,
  "README darf Save As oder Arbeitskopien nicht still als Sicherheitsweg vorgeben.");
assert.match(readme, /GewErfass2026.+ausschließlich lesen/isu,
  "README muss den derzeit read-only belegten Folgejahr-UStVA-Weg begrenzen.");
assert.doesNotMatch(readme, /npm\.cmd install --global @yadimon\/steuer-spar-erklaerung-api/u,
  "Die lokale manuelle Installation darf nicht global beginnen und danach lokale Bins voraussetzen.");
assert.match(readme, /npm\.cmd install @yadimon\/steuer-spar-erklaerung-mcp@latest/u,
  "Der kopierbare lokale Installationsblock muss das MCP-Paket enthalten.");
assert.match(readme, /npm\s+installiert sie automatisch/u,
  "README muss die automatisch installierte exakte API-Dependency erklären.");
assert.match(readme, /github\.com\/yadimon\/steuer-spar-erklaerung-mcp\/releases/u,
  "README muss auf die stabile Releases-Übersicht statt auf eine einzelne Beta zeigen.");
assert.doesNotMatch(readme, /docs\/releases\/v\d+\.\d+\.\d+(?:-[^)\s]+)?\.md/iu,
  "README darf keine bei jedem Release veraltende Release-Note direkt verlinken.");
assert.doesNotMatch(readme, /v\d+\.\d+\.\d+-beta\.\d+/iu,
  "README darf keine konkrete Beta als aktuellen Einstieg festschreiben.");
assert.match(readme, /neun Vordergrundwege.+gelten für API-CLI und MCP gleichermaßen/isu,
  "README muss Laufzeitsperren für MCP und API-CLI gleich beschreiben.");

process.stdout.write("README: Features, zwei Prompts und Kernreferenzen bestanden\n");
