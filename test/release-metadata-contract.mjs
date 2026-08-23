import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAUNCH_OPERATION_TIMEOUT_MS } from "../dist/api-contract.js";
import { exclusiveSteps, finalSteps, parallelSteps, serialBuildSteps } from "./suite-plan.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const apiPackage = JSON.parse(readFileSync(join("packages", "api", "package.json"), "utf8"));
const mcpPackage = JSON.parse(readFileSync(join("packages", "mcp", "package.json"), "utf8"));
const versionSource = readFileSync("src/version.ts", "utf8");
const security = readFileSync("SECURITY.md", "utf8");
const readme = readFileSync("README.md", "utf8");
const mainSkill = readFileSync(join("skills", "steuer-spar-erklaerung", "SKILL.md"), "utf8");
const installationGuide = readFileSync(join("docs", "INSTALLATION.md"), "utf8");
const releasePath = join("docs", "releases", `v${packageJson.version}.md`);

assert.match(packageJson.version, /^0\.1\.0-beta\.\d+$/u, "Beta-Release braucht eine erwartete SemVer-Vorabversion.");
assert.equal(packageLock.version, packageJson.version, "Lockfile und package.json haben unterschiedliche Versionen.");
assert.equal(packageLock.packages?.[""]?.version, packageJson.version, "Lockfile-Rootpaket hat eine andere Version.");
assert.equal(apiPackage.version, packageJson.version, "API-npm-Paket hat eine andere Version.");
assert.equal(mcpPackage.version, packageJson.version, "MCP-npm-Paket hat eine andere Version.");
assert.equal(packageLock.packages?.["packages/api"]?.version, packageJson.version, "API-Lockfile hat eine andere Version.");
assert.equal(packageLock.packages?.["packages/mcp"]?.version, packageJson.version, "MCP-Lockfile hat eine andere Version.");
assert(
  versionSource.includes(`SSE_PACKAGE_VERSION = "${packageJson.version}"`),
  "Kompilierte Runtimeversion und package.json laufen auseinander.",
);
assert(existsSync(releasePath), `Release Notes fehlen: ${releasePath}`);

const releaseNotes = readFileSync(releasePath, "utf8");
const releaseHeading = releaseNotes.split(/\r?\n/u, 1)[0];
assert.equal(releaseHeading, `# v${packageJson.version}`, "Release Notes tragen nicht die Paketversion als H1.");
assert.match(releaseNotes, /SteuerSparErklärung 2025/u, "Release Notes nennen das unterstützte Produktprofil nicht.");
assert.match(releaseNotes, /ELSTER/iu, "Release Notes verschweigen die dauerhafte Übermittlungsgrenze.");
assert(
  !/steuer-spar-erklaerung\.zip/u.test(releaseNotes) || /entfallen|entfernt/u.test(releaseNotes),
  "Release Notes duerfen kein Portable-ZIP mehr anpreisen; installiert wird aus der npm-Registry.",
);
const fullSuiteSteps = serialBuildSteps.length + parallelSteps.length + exclusiveSteps.length + finalSteps.length;
assert(
  releaseNotes.includes(`alle ${fullSuiteSteps} geplanten Schritte`) &&
    releaseNotes.includes(`${parallelSteps.length} konfliktfreie Haupttests`),
  "Release Notes nennen nicht den aktuellen vollständig bestandenen Suite-Plan.",
);
assert(
  security.includes(`\`v${packageJson.version}\` ist die aktuelle öffentlich`)
    && !security.includes(`bereitet \`v${packageJson.version}\``),
  "Sicherheitsrichtlinie muss den veröffentlichten Paketstand als aktuell unterstützt nennen.",
);
assert.match(security, /jeweils neueste vollständige\s+Release-Version/u, "Security nennt die unterstützte Release-Linie nicht.");
assert.match(security, /@yadimon\/steuer-spar-erklaerung-api/u);
assert.match(security, /@yadimon\/steuer-spar-erklaerung-mcp/u);
// Bis beta.19 hatten CLI und MCP verschiedene Kaltstartfristen, und die
// Release Notes mussten den Unterschied nennen. Seit beta.20 gibt es genau
// eine Frist; genannt werden muss sie weiterhin, denn sie ist der Unterschied
// zwischen einem gelungenen und einem abgebrochenen ersten Programmstart.
assert(
  releaseNotes.includes("MCP-Tool `sse_launch`")
    && new RegExp(`${LAUNCH_OPERATION_TIMEOUT_MS / 1000}\\s+Sekunden`, "u").test(releaseNotes),
  "Release Notes müssen die geltende Kaltstartfrist von launch für CLI und MCP nennen.",
);
assert.match(
  security,
  /jeweils jüngste\s+dort vollständige Release maßgeblich/u,
  "Security bindet Support nicht dauerhaft an ein vollständiges ZIP-/SHA-Release.",
);
assert(!/bleibt `v0\.1\.0-beta\.\d+`/u.test(security), "Security enthält eine nach Veröffentlichung veraltende Vorversion.");
assert.match(readme, /`2024` \/ Engine 30 \| `experimental` \/ `verification-only`/u);
assert.match(mainSkill, /Profil `2025` mit Engine-Major `31` freigegeben/u);
assert.match(installationGuide, /derzeit `2025` \/ Engine-Major `31`/u);

process.stdout.write(`Release-Metadaten: v${packageJson.version}, Security, Notes und 2 Skills synchron\n`);
