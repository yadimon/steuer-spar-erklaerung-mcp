import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const skillsRoot = join(root, "skills");
const expected = ["steuer-spar-erklaerung"];
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
  assert(source.split(/\r?\n/u).length < 400, `${name}/SKILL.md ist nicht progressiv genug.`);
  assert(!source.includes("docs/entwicklung/erfahrungen"));

  const openAi = readFileSync(join(directory, "agents", "openai.yaml"), "utf8");
  assert(openAi.includes(`$${name}`), `${name}/agents/openai.yaml nennt den Skill nicht im Default-Prompt.`);
  for (const match of source.matchAll(/\]\((references\/[^)]+)\)/gu)) {
    assert(existsSync(join(directory, ...match[1].split("/"))), `Skill-Referenz fehlt: ${name}/${match[1]}`);
  }
}

const main = readFileSync(join(skillsRoot, "steuer-spar-erklaerung", "SKILL.md"), "utf8");
const openAiMetadata = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "agents", "openai.yaml"),
  "utf8",
);
assert(openAiMetadata.includes("kündige sichtbare Bedienung trotzdem an"));
assert(main.includes("## Zuerst im MCP-Modus: MCP-Preflight"));
assert(main.includes("Beginne jeden Auftrag im MCP-Modus mit `sse_preflight`"));
assert(main.includes("`workspace_status`, `product_info`, `health` den MCP-Preflight"));
assert(main.includes("stabilen `nextTool`") && main.includes("Es gibt gar kein `sse_*`-Tool"));
assert(main.includes("Direkte API nur als bewusster Fallback") && main.includes("Skill ist eine Komfortschicht"));
assert(!main.includes("NPX-Kurzweg ohne globale Runtime-Installation"));
assert(main.includes("MCP ist ein dünner Wrapper darüber") && main.includes("API-Selbstbeschreibung"));
assert(main.includes("Der MCP-Eintrag enthält keinen `--config`-Parameter"));
assert(main.includes("`SSE_API_CONFIG`") && main.includes("bleibt autoritativ") && main.includes("niemals gleichzeitig"));
assert(main.includes("echten Aufruf von `sse_preflight`") && main.includes("Handshake allein genügt nicht"));
assert(main.includes("Technisches Setup bereit;") && main.includes("Client-Verifikation nach Neustart offen."));
assert(main.includes("niemals über ELSTER") && main.includes("Ein bereits eindeutig"));
assert(main.includes("references/case-session.md") && main.includes("Eine Arbeits- oder"));
assert(main.includes("dirty-fähige UI-Navigation oder Mutation"));
assert(main.includes("genau einmal nach `backups:`") && main.includes("Disk-Hash weiterhin zum verifizierten Backup-Tupel passen"));
assert(main.includes("references/belegmanager-backup.md")
  && main.includes("Eine Falldatei-Sicherung ersetzt diese Sicherung nicht"));
assert(main.includes("references/ustva.md") && main.includes("references/ui-fallback.md"));
assert(main.includes("powershell/render-pdf.ps1") && main.includes("ocr-image.ps1"));
assert(main.includes("Tracking") && main.includes(".xlsx") && main.includes("Excel niemals still"));
assert(main.includes("Sonst antworte im Chat") && main.includes("Speicherstatus"));
assert(main.includes("`Prüfen und Abgeben`") && main.includes('`direction="Weiter"`'));
assert(main.includes("`checker_open`") && main.includes("`checker_detail` nicht"));
assert(main.includes('`stopKind="no-table"') && main.includes("frische `rid`") && main.includes("niemals mit `Out-Null`"));
assert(!/v\d+\.\d+\.\d+-beta\.\d+/iu.test(main), "Runtime-Skill darf keine konkrete Beta festschreiben.");

const firstRun = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "first-run.md"),
  "utf8",
);
assert(firstRun.includes("der richtige Steuerfall") && firstRun.includes("vollständige Liste der Belegordner"));
assert(firstRun.includes("höchstens 100") && firstRun.includes("Durchsuche niemals das gesamte Laufwerk"));
assert(firstRun.includes("API-Dependency installiert npm automatisch") && !/Portable/u.test(firstRun));
assert(firstRun.includes("MCP ist der Standardtransport") && /Der Skill\s+ist nur eine optionale Komfortschicht/u.test(firstRun));
assert(!firstRun.includes("NPX-Kurzweg"));
assert(firstRun.includes("`caseDir` ist keine Fallauswahl und öffnet nichts"));
assert(firstRun.includes("Es gibt kein Einrichtungsprogramm und keine Plandatei"));
assert(firstRun.includes("docs/INSTALLATION.md") && !firstRun.includes("setup-decisions.json"));
assert(firstRun.includes("hashverifizierte Prüffallkopie") && firstRun.includes("ausdrücklich isolierten"));

const caseSession = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "case-session.md"),
  "utf8",
);
for (const requirement of [
  "Der offene Fall ist maßgeblich",
  "Eine Sicherung je unverändertem Dateistand",
  "Ändern ist nicht Speichern",
  "sse_instances",
  "sse_make_working_copy",
  "sse_save_as",
  "Erzeuge keinen separaten",
]) {
  assert(caseSession.includes(requirement), `Arbeitssitzungs-Vertrag fehlt: ${requirement}`);
}

const receiptBackup = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "belegmanager-backup.md"),
  "utf8",
);
for (const requirement of ["SSEKonf.user.ini", "DataDir", "BelegManager.db4", "PRAGMA integrity_check", "SHA-256"]) {
  assert(receiptBackup.includes(requirement), `BelegManager-Sicherungswissen fehlt: ${requirement}`);
}

const installation = readFileSync(join(root, "docs", "INSTALLATION.md"), "utf8");
for (const requirement of [
  "## Ich nix ITler",
  "## Ich bin ITler",
  "Windows x64",
  "Node.js 22 oder neuer",
  "npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest",
  "$SkillAgent = 'codex'",
  "--agent $SkillAgent",
  "#### Codex projektlokal",
  ".codex/config.toml",
  "#### Claude Code projektlokal",
  "--scope project",
  "#### OpenCode projektlokal",
  "opencode.json",
  "SSE_API_CONFIG",
  "--selftest",
  "sse_preflight",
  "## Direkte API-Nutzung (separat)",
  "## API-Singleton bewusst beenden",
]) {
  assert(installation.includes(requirement), `Installationsvertrag fehlt: ${requirement}`);
}
assert(!installation.includes("Codex kennt nur eine globale Konfiguration"));
assert(installation.includes("`SSE_API_URL` und `SSE_API_CONFIG` dürfen nicht gleichzeitig"));
assert(installation.includes("fremde, alte oder nicht eindeutig") && installation.includes("niemals beenden, ersetzen oder übergehen"));
assert(installation.includes("/v1/openapi.json") && installation.includes("/v1/operations"));
assert(installation.includes("## Update") && installation.includes("## Deinstallation") && installation.includes("Nutzerdaten"));
assert(!/npx\.cmd -y @yadimon\/steuer-spar-erklaerung-api --case-dir/u.test(installation),
  "Der konkurrierende NPX-Prueflauf gehoert nicht mehr in den MCP-Installationsstandard.");
assert(!/npm(?:\.cmd)? install --global/u.test(installation), "Der Standard darf nichts global installieren.");

const readme = readFileSync(join(root, "README.md"), "utf8");
const fencedPrompt = (source, prefix) => [...source.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/gu)]
  .map((match) => match[1])
  .find((text) => text.startsWith(prefix));
assert.equal(
  fencedPrompt(readme, "Richte SteuerSparErklärung"),
  fencedPrompt(installation, "Richte SteuerSparErklärung"),
  "README und kanonische Anleitung enthalten unterschiedliche Installationsprompts.",
);
assert.equal(
  fencedPrompt(readme, "Nutze $steuer-spar-erklaerung"),
  fencedPrompt(installation, "Nutze $steuer-spar-erklaerung"),
  "README und kanonische Anleitung enthalten unterschiedliche Anwendungs-Prompts.",
);
assert(readme.includes("### Ich nix ITler") && readme.includes("### Ich bin ITler"));
assert(!readme.includes("Robuster isolierter Prüflauf") && !readme.includes("Dauerhaftes Setup mit zwei Prompts"));
assert(readme.includes("Der Skill ist eine optionale Komfortschicht"));
assert(readme.includes("npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-mcp@latest"));
assert(readme.includes("--agent $SkillAgent --copy --yes"));
assert(readme.includes(".codex/config.toml") && readme.includes("--scope project") && readme.includes("opencode.json"));
assert(readme.includes("exakt passende API") && readme.includes("separates API-Terminal"));
assert(readme.includes("keine Dateisystem-Sandbox") && readme.includes("sse_preflight"));
assert(!/v\d+\.\d+\.\d+-beta\.\d+/iu.test(readme));

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

const architecture = readFileSync(join(root, "docs", "ARCHITEKTUR.md"), "utf8");
assert(architecture.includes("optionale veröffentlichte Skill")
  && architecture.includes("`sse_preflight`")
  && architecture.includes("Preflight-Ergebnis ist keine")
  && !architecture.includes("prüft zuerst über `sse_health`"));

const apiPackageReadme = readFileSync(join(root, "packages", "api", "README.md"), "utf8");
const mcpPackageReadme = readFileSync(join(root, "packages", "mcp", "README.md"), "utf8");
assert(apiPackageReadme.includes("`--case-dir` öffnet keinen Steuerfall")
  && /keine\s+Dateisystem-Sandbox/u.test(apiPackageReadme));
assert(mcpPackageReadme.includes("`sse_preflight`") && mcpPackageReadme.includes("optionale Komfortschicht"));
assert(mcpPackageReadme.includes("dirty-fähigen UI-Navigation oder Mutation")
  && mcpPackageReadme.includes("`save` oder `save_as` wird nie still"));

process.stdout.write("Public Skill: optionaler Wizard, MCP-Preflight und zwei lokale Installationswege bestanden\n");
