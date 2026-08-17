import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const skillsRoot = join(root, "skills");
const expected = ["steuer-spar-erklaerung", "steuer-spar-erklaerung-setup"];
const discovered = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(discovered, expected, "Public skills muessen flach und ohne --full-depth auffindbar sein.");
assert.equal(existsSync(join(root, "skill")), false, "Veralteter singulaerer skill/-Container ist noch vorhanden.");

for (const name of discovered) {
  const directory = join(skillsRoot, name);
  const source = readFileSync(join(directory, "SKILL.md"), "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(source)?.[1] ?? "";
  const keys = [...frontmatter.matchAll(/^([a-z-]+):/gmu)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ["description", "name"]);
  assert.match(frontmatter, new RegExp(`^name: ${name}$`, "mu"));
  assert.match(frontmatter, /^description: \S.+$/mu);
  assert(source.split(/\r?\n/u).length < 500, `${name}/SKILL.md ist nicht progressiv genug.`);
  assert(!source.includes("docs/entwicklung/erfahrungen"), `${name} laedt Entwicklungs-Memory in den Runtime-Kontext.`);
  assert(!/Node (?:18|20|22).*(?:Pflicht|benötigt)/iu.test(source));
  assert(!/PowerShell 7.*(?:Pflicht|installieren)/iu.test(source));

  const openAi = readFileSync(join(directory, "agents", "openai.yaml"), "utf8");
  assert(openAi.includes(`$${name}`), `${name}/agents/openai.yaml nennt den Skill nicht im Default-Prompt.`);
  for (const match of source.matchAll(/\]\((references\/[^)]+)\)/gu)) {
    assert(existsSync(join(directory, ...match[1].split("/"))), `Skill-Referenz fehlt: ${name}/${match[1]}`);
  }
}

const main = readFileSync(join(skillsRoot, "steuer-spar-erklaerung", "SKILL.md"), "utf8");
assert(main.includes("kein globales Node.js/npm") && main.includes("kein Python") && main.includes("PowerShell 7"));
assert(main.includes("MCP ist ein optionaler dünner Wrapper") && main.includes("API-Selbstbeschreibung"));
assert(main.includes("steuer-spar-erklaerung-call") && main.includes("--args-file -") && main.includes("Prozessliste"));
assert(main.includes("describe <operation>") && main.includes("discovery"));
assert(main.includes("sse_capabilities") && main.includes("Fallback bei unbekannten Controls"));
assert(main.includes("unsupportedButtons") && main.includes("generischen Toggle-Klick"));
assert(main.includes("niemals über ELSTER") && main.includes("verifizierten Arbeitskopie"));
assert(main.includes("sse_ustva_read") && main.includes("sse_ustva_open_section"));
assert(main.includes("setup-decisions.json") && main.includes("settings.md"));
assert(main.includes("Tracking") && main.includes(".xlsx") && main.includes("Excel niemals still"));
assert(main.includes("API-/HTTP-Transporttimeout") && main.includes("nicht als Unerreichbarkeit behandeln"));
const setup = readFileSync(join(skillsRoot, "steuer-spar-erklaerung-setup", "SKILL.md"), "utf8");
assert(setup.includes("runtime/node.exe dist/api-cli.js health") && setup.includes("discovery"));
assert(setup.includes('command = "node"') && setup.includes("schwarze `cmd.exe`-Fenster"));
assert(setup.includes("Windows x64") && setup.includes("Windows PowerShell 5.1"));
assert(setup.includes("--defaults") && setup.includes("--no-start"));
assert(setup.includes("settings.md") && setup.includes("tracking.md") && setup.includes(".xlsx"));
assert(setup.includes("Connector") && setup.includes("read-only Prüfung"));
assert(!setup.includes("Windows 10/11"), "Setup darf kompatible Windows-Versionen nicht nach Label sperren.");

process.stdout.write("Public Skills: 2 flache npx-kompatible, deutsche und portable Skill-Pakete bestanden\n");
