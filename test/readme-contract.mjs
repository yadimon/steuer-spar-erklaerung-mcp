import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const normalized = readme.replace(/\s+/gu, " ");

for (const heading of [
  "## Was kann es?",
  "## Voraussetzungen und harte Grenzen",
  "## Schnellstart",
  "### Codex",
  "### Claude Code",
  "## Erster Auftrag",
  "## Komponenten",
  "## Dokumentation",
]) {
  assert(readme.includes(heading), `README-Abschnitt fehlt: ${heading}`);
}

for (const feature of [
  "SteuerSparErklärung 2025",
  "Belegquellen",
  "Umsatzsteuer-Voranmeldungen",
  "sse_preflight",
  "Node.js 22",
  "Git auf `PATH`",
]) {
  assert(readme.includes(feature), `README-Feature fehlt: ${feature}`);
}

const codexInstall = "npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target codex --scope project --yes";
const codexActivate = "codex plugin add steuer-spar-erklaerung@plugins-cli --json";
const claudeInstall = "npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target claude-code --scope user --yes";
assert(readme.includes(codexInstall), "Codex-Plugin-Quickstart fehlt.");
assert(readme.includes(codexActivate), "Target-native Codex-Aktivierung fehlt.");
assert(readme.includes(claudeInstall), "Claude-Code-Plugin-Quickstart fehlt.");
const codexSection = readme.slice(readme.indexOf("### Codex"), readme.indexOf("### Claude Code"));
const claudeSection = readme.slice(readme.indexOf("### Claude Code"), readme.indexOf("## Erster Auftrag"));
assert(codexSection.indexOf(codexInstall) < codexSection.indexOf(codexActivate),
  "Codex muss erst mit plugins@1 klonen und danach target-nativ aktiviert werden.");
assert(codexSection.includes("codex plugin list --json")
  && codexSection.includes("`not installed`")
  && codexSection.includes("`installed, enabled`")
  && codexSection.includes("materialisieren"),
  "README muss die reale Codex-Zustandsfolge samt Readback-Grenze nennen.");
assert.doesNotMatch(codexSection, /codex plugin list --json.+(?:installiert|ändert) nichts/isu,
  "README darf den beobachtet zustandsbildenden Readback nicht als seiteneffektfrei behaupten.");
assert(claudeSection.includes(claudeInstall)
  && claudeSection.includes("`enabled`")
  && claudeSection.includes("User-Scope")
  && !claudeSection.includes(codexActivate),
  "Claude Code darf keinen Codex-Aktivierungsbefehl erhalten.");
assert(normalized.includes("automatische Clienterkennung") && normalized.includes("unter Windows nicht empfohlen"));
assert.match(normalized, /plugins@1\.3\.4.+ignoriert den Scope bei Codex/iu);
assert(readme.includes("keine physische") && readme.includes("Projektisolation"));
assert(readme.includes("SSE_API_CONFIG"));

assert(normalized.includes("kein `npm install`") && normalized.includes("kein separates API-Terminal"));
assert(normalized.includes("Beim MCP-Start laufen weder npm noch npx") && normalized.includes("kein Netzwerkzugriff"));
assert.doesNotMatch(readme, /npm\.cmd install --save-exact @yadimon\/steuer-spar-erklaerung-mcp/iu);
assert.doesNotMatch(readme, /npx(?:\.cmd)?\s+(?:-y\s+)?@yadimon\/steuer-spar-erklaerung-(?:mcp|api)/iu);
assert.doesNotMatch(readme, /OpenCode/iu, "README darf keine OpenCode-Unterstützung behaupten.");

assert(normalized.includes("sendet nichts über ELSTER"));
assert.match(normalized, /Originale.+übermittelte Fälle.+nicht still/iu);
assert.match(normalized, /hashgebunden gesichert/iu);
assert.match(normalized, /Änderung.+Readback.+Speichern.+ausdrücklichen Auftrag/iu);
assert.match(normalized, /Save As.+keine impliziten Sicherheitsmaßnahmen/iu);
assert.match(normalized, /GewErfass2026.+ausschließlich.+Leseweg/iu);

for (const reference of [
  "docs/README.md",
  "docs/INSTALLATION.md",
  "docs/ARCHITEKTUR.md",
  "docs/API-MCP-VERTRAG.md",
  "docs/UMSATZSTEUER-VORANMELDUNG.md",
  "docs/VERIFIKATION.md",
  "skills/steuer-spar-erklaerung/SKILL.md",
  "packages/api/README.md",
  "packages/mcp/README.md",
]) {
  assert(readme.includes(reference), `README-Referenz fehlt: ${reference}`);
}

const prompts = [...readme.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/gu)];
assert(prompts.length >= 3 && prompts.length <= 5, "README soll drei bis fünf Beispielprompts enthalten.");
assert.match(readme, /github\.com\/yadimon\/steuer-spar-erklaerung-mcp\/releases/u);
assert.doesNotMatch(readme, /docs\/releases\/v\d+\.\d+\.\d+(?:-[^)\s]+)?\.md/iu);
assert.doesNotMatch(readme, /v\d+\.\d+\.\d+-beta\.\d+/iu);

process.stdout.write("README: Plugin-First-Quickstart, Scope-Wahrheit, First run und Sicherheitsgrenzen bestanden\n");
