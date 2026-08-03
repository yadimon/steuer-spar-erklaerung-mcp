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
assert(main.includes("niemals über ELSTER") && main.includes("verifizierten Arbeitskopie"));

process.stdout.write("Public Skills: 2 flache npx-kompatible, deutsche und portable Skill-Pakete bestanden\n");
