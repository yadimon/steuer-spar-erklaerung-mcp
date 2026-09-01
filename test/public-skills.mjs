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
assert.deepEqual(discovered, expected, "Oeffentliche Skills muessen im Standardlayout auffindbar sein.");
assert.equal(existsSync(join(root, "skill")), false, "Veralteter singulaerer skill/-Container ist noch vorhanden.");

for (const name of discovered) {
  const directory = join(skillsRoot, name);
  const source = readFileSync(join(directory, "SKILL.md"), "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(source)?.[1] ?? "";
  const keys = [...frontmatter.matchAll(/^([a-z-]+):/gmu)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ["description", "name"]);
  assert.match(frontmatter, new RegExp(`^name: ${name}$`, "mu"));
  assert.match(frontmatter, /^description: \S.+$/mu);
  assert(source.split(/\r?\n/u).length < 200, `${name}/SKILL.md ist nicht progressiv genug.`);
  assert(!source.includes("docs/entwicklung/erfahrungen"));

  const openAi = readFileSync(join(directory, "agents", "openai.yaml"), "utf8");
  assert(openAi.includes(`$${name}`), `${name}/agents/openai.yaml nennt den Skill nicht im Default-Prompt.`);
  for (const match of source.matchAll(/\]\((references\/[^)]+)\)/gu)) {
    assert(existsSync(join(directory, ...match[1].split("/"))), `Skill-Referenz fehlt: ${name}/${match[1]}`);
  }
}

const skillRoot = join(skillsRoot, "steuer-spar-erklaerung");
const main = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
const normalizedMain = main.replace(/\s+/gu, " ");

for (const requirement of [
  "## Immer zuerst: MCP-Preflight",
  "Beginne jeden Auftrag mit dem echten MCP-Tool `sse_preflight`",
  "Setze danach den ursprünglichen Auftrag fort",
  "höchstens eine Frage pro Nachricht",
  "Ein bereits eindeutig geöffneter Fall ist der Arbeitsfall",
  "Profil `2025` mit Engine-Major `31` freigegeben",
  "Ändern ist nicht Speichern",
  "Erfolg nur nach strukturiertem Readback",
  "MCP ist der Standardtransport",
]) {
  assert(normalizedMain.includes(requirement), `Hauptskill-Vertrag fehlt: ${requirement}`);
}

assert.match(normalizedMain, /Fehlt jedes `sse_\*`-Tool.+nichts installieren.+Installationsanleitung/iu);
assert.match(normalizedMain, /Niemals über ELSTER/iu);
assert.match(normalizedMain, /Originale und übermittelte Falldateien niemals löschen, überschreiben/iu);
assert(normalizedMain.includes("Eine Arbeitskopie, `save_as`, Schließen oder Verwerfen ist keine implizite"));
assert.match(normalizedMain, /vor der ersten dirty-fähigen Navigation oder Mutation.+Disk-Hash/iu);
assert(normalizedMain.includes("keinen Prozess nach Namen beenden. Fremde, alte"));
assert.doesNotMatch(main, /npx\s|npm\s+(?:install|add)|plugins@/iu,
  "Der Fachskill darf keine Installerbefehle als Standardaktion enthalten.");
assert.doesNotMatch(main, /v\d+\.\d+\.\d+-beta\.\d+/iu,
  "Der Runtime-Skill darf keine konkrete Beta festschreiben.");

for (const reference of [
  "references/first-run.md",
  "references/case-session.md",
  "references/ustva.md",
  "references/steuerquellen.md",
  "references/ui-fallback.md",
  "references/belegmanager-backup.md",
]) {
  assert(main.includes(reference), `Situationsbezogene Skill-Route fehlt: ${reference}`);
}
assert.equal(existsSync(join(skillRoot, "references", "betriebsvertrag.md")), false,
  "Der redundante Betriebsvertrag wurde nicht aus der Skill-IA entfernt.");

const firstRun = readFileSync(join(skillRoot, "references", "first-run.md"), "utf8");
const normalizedFirstRun = firstRun.replace(/\s+/gu, " ");
for (const requirement of [
  "Merke dir diesen Auftrag unverändert",
  "höchstens **eine Frage pro Nachricht**",
  "Rufe zuerst das echte MCP-Tool `sse_preflight` auf",
  "Ist genau ein Fall vollständig und eindeutig geöffnet, gewinnt dieser Fall",
  "vollständigen Liste der freigegebenen Belegordner",
  "Sicheren Plan gemeinsam bestätigen",
  "Ursprünglichen Auftrag fortsetzen",
]) {
  assert(normalizedFirstRun.includes(requirement), `First-run-Vertrag fehlt: ${requirement}`);
}
assert.match(normalizedFirstRun, /keine Installerbefehle ausführen.+keine Clientdatei verändern/iu);
assert(firstRun.includes("höchstens 100") && firstRun.includes("Durchsuche niemals das gesamte Laufwerk"));
assert(firstRun.includes("`caseDir` ist eine Ressourcen-/Redaktionsgrenze, keine Fallauswahl"));

const caseSession = readFileSync(join(skillRoot, "references", "case-session.md"), "utf8");
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

const receiptBackup = readFileSync(join(skillRoot, "references", "belegmanager-backup.md"), "utf8");
for (const requirement of ["SSEKonf.user.ini", "DataDir", "BelegManager.db4", "PRAGMA integrity_check", "SHA-256"]) {
  assert(receiptBackup.includes(requirement), `BelegManager-Sicherungswissen fehlt: ${requirement}`);
}

const installation = readFileSync(join(root, "docs", "INSTALLATION.md"), "utf8");
const normalizedInstallation = installation.replace(/\s+/gu, " ");
for (const requirement of [
  "Windows x64",
  "Node.js 22 oder neuer",
  "Git auf `PATH`",
  "--target codex --scope project --yes",
  "--target claude-code --scope project --yes",
  "codex plugin add steuer-spar-erklaerung@plugins-cli --json",
  "codex plugin list --json",
  "codex plugin remove steuer-spar-erklaerung@plugins-cli",
  "sse_preflight",
  "%LOCALAPPDATA%\\SteuerSparErklaerungApi",
  "SSE_API_CONFIG",
  "## Update",
  "## Entfernung",
  "## API-Singleton bewusst beenden",
  "## Fortgeschrittene standalone-Nutzung",
]) {
  assert(installation.includes(requirement), `Installationsvertrag fehlt: ${requirement}`);
}
assert.match(normalizedInstallation, /automatische Zielerkennung.+nicht zuverlässig/iu);
assert.match(normalizedInstallation, /ignoriert den Scope bei Codex vollständig/iu);
assert(normalizedInstallation.includes("keine physische Projektisolation"));
assert(normalizedInstallation.includes("kein `node_modules`")
  && normalizedInstallation.includes("weder npm noch npx")
  && normalizedInstallation.includes("keinen Netzwerkdownload"));
assert.match(normalizedInstallation, /nach dem ersten Befehl.+`not installed`.+target-native.+`installed, enabled`/iu);
const installationCodexStart = installation.indexOf("### Codex");
const installationClaudeStart = installation.indexOf("### Claude Code");
const installationScopeStart = installation.indexOf("### Was `--scope project` hier bedeutet");
const installationCodex = installation.slice(installationCodexStart, installationClaudeStart);
const installationClaude = installation.slice(installationClaudeStart, installationScopeStart);
const codexClone = "npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target codex --scope project --yes";
const codexActivate = "codex plugin add steuer-spar-erklaerung@plugins-cli --json";
const claudeInstall = "npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target claude-code --scope project --yes";
assert(installationCodex.indexOf(codexClone) < installationCodex.indexOf(codexActivate),
  "Codex-Installation muss als externe plus target-native Stufe dokumentiert sein.");
assert(installationClaude.includes(claudeInstall)
  && installationClaude.includes("`enabled`")
  && !installationClaude.includes(codexActivate),
  "Claude Code bleibt ein zielgenauer Ein-Schritt-Pfad.");
assert.match(normalizedInstallation, /kein eigenes `update`-Kommando/iu);
assert.match(normalizedInstallation, /kein `remove`-Kommando/iu);
assert.match(normalizedInstallation, /Readback.+Cache-\/Konfigurationszustand materialisieren/iu);
assert.doesNotMatch(normalizedInstallation, /codex plugin list --json.+(?:installiert|ändert) nichts/iu,
  "Der Codex-Readback darf nicht als garantiert seiteneffektfrei dokumentiert sein.");
const installationUpdate = installation.slice(installation.indexOf("## Update"), installation.indexOf("## Entfernung"));
assert(installationUpdate.includes("plugins@1 add")
  && installationUpdate.includes(codexActivate)
  && /Zeigt Codex danach.+nicht als `installed, enabled`/su.test(installationUpdate),
"Der Updatepfad muss externes add, Codex-Readback und bedingte target-native Aktivierung enthalten.");
assert.match(normalizedInstallation, /Claude Code.+exakte Plugin-ID.+zurücklesen/iu);
assert.doesNotMatch(installation, /^\s*(?:npx(?:\.cmd)?\s+[^\r\n]*\s+)?plugins\s+(?:remove|uninstall)\b/gimu,
  "Nicht existente plugins-Kommandos duerfen nicht als Anleitung erscheinen.");
assert.match(normalizedInstallation, /Nutzerdaten nur nach separater Prüfung und ausdrücklichem Auftrag/iu);
assert.match(normalizedInstallation, /Niemals Prozesse pauschal nach `node`, `SSE`/iu);
assert.doesNotMatch(installation, /--target opencode|OpenCode projektlokal/iu);

const readme = readFileSync(join(root, "README.md"), "utf8");
assert(readme.includes("--target codex --scope project --yes"));
assert(readme.includes("--target claude-code --scope project --yes"));
assert(readme.includes("codex plugin add steuer-spar-erklaerung@plugins-cli --json")
  && readme.includes("`not installed`")
  && readme.includes("`installed, enabled`"));
assert.doesNotMatch(readme, /npm\.cmd install --save-exact @yadimon\/steuer-spar-erklaerung-mcp/iu);

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
assert(architecture.includes("Agent Plugin")
  && architecture.includes("`${PLUGIN_ROOT}/runtime/dist/mcp.js`")
  && architecture.includes("`sse_preflight`")
  && architecture.includes("keine physische Projektisolation"));

const verification = readFileSync(join(root, "docs", "VERIFIKATION.md"), "utf8");
assert(verification.includes("0.151.0-alpha.7.2")
  && verification.includes("`064048Z`")
  && verification.includes("`064512Z`")
  && verification.includes("materialisierte")
  && verification.includes("VM-Ende-zu-Ende offen"));

const apiPackageReadme = readFileSync(join(root, "packages", "api", "README.md"), "utf8");
const mcpPackageReadme = readFileSync(join(root, "packages", "mcp", "README.md"), "utf8");
const normalizedMcpPackageReadme = mcpPackageReadme.replace(/\s+/gu, " ");
assert(apiPackageReadme.includes("Nutzerstandard ist das Agent Plugin"));
assert(apiPackageReadme.includes("`--case-dir` öffnet keinen Steuerfall")
  && /keine Dateisystem-Sandbox/u.test(apiPackageReadme));
assert(apiPackageReadme.includes("$Root = 'C:\\mein-steuer-api'")
  && apiPackageReadme.includes("npm.cmd install --save-exact @yadimon/steuer-spar-erklaerung-api@latest")
  && apiPackageReadme.includes("& $Node $Api --config $ApiConfig")
  && apiPackageReadme.includes("& $Node $Call discovery --config $ApiConfig"));
assert(mcpPackageReadme.includes("Empfohlener Weg: Agent Plugin"));
assert(normalizedMcpPackageReadme.includes("`sse_preflight`")
  && normalizedMcpPackageReadme.includes("kein `node_modules`")
  && normalizedMcpPackageReadme.includes("weder npm noch npx"));
assert(mcpPackageReadme.includes("codex plugin add steuer-spar-erklaerung@plugins-cli --json")
  && mcpPackageReadme.includes("--target claude-code --scope project --yes")
  && normalizedMcpPackageReadme.includes("API kennt keine Anmeldung"));
assert(mcpPackageReadme.includes("vor dirty-fähiger Navigation oder Mutation")
  && mcpPackageReadme.includes("`save` und `save_as` brauchen"));

process.stdout.write("Public Skill: knapper Router, First run, Plugin-Installation und harte Grenzen bestanden\n");
