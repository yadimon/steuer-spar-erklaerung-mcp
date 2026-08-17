import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exclusiveSteps, finalSteps, parallelSteps, serialBuildSteps } from "./suite-plan.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const versionSource = readFileSync("src/version.ts", "utf8");
const security = readFileSync("SECURITY.md", "utf8");
const readme = readFileSync("README.md", "utf8");
const mainSkill = readFileSync(join("skills", "steuer-spar-erklaerung", "SKILL.md"), "utf8");
const setupSkill = readFileSync(join("skills", "steuer-spar-erklaerung-setup", "SKILL.md"), "utf8");
const releasePath = join("docs", "releases", `v${packageJson.version}.md`);

assert.match(packageJson.version, /^0\.1\.0-beta\.\d+$/u, "Beta-Release braucht eine erwartete SemVer-Vorabversion.");
assert.equal(packageLock.version, packageJson.version, "Lockfile und package.json haben unterschiedliche Versionen.");
assert.equal(packageLock.packages?.[""]?.version, packageJson.version, "Lockfile-Rootpaket hat eine andere Version.");
assert(
  versionSource.includes(`SSE_PACKAGE_VERSION = "${packageJson.version}"`),
  "Kompilierte Runtimeversion und package.json laufen auseinander.",
);
assert(existsSync(releasePath), `Release Notes fehlen: ${releasePath}`);

const releaseNotes = readFileSync(releasePath, "utf8");
assert(releaseNotes.startsWith(`# v${packageJson.version}\n`), "Release Notes tragen nicht die Paketversion als H1.");
assert.match(releaseNotes, /SteuerSparErklärung 2025/u, "Release Notes nennen das unterstützte Produktprofil nicht.");
assert.match(releaseNotes, /ELSTER/iu, "Release Notes verschweigen die dauerhafte Übermittlungsgrenze.");
assert.match(releaseNotes, /steuer-spar-erklaerung\.zip\.sha256/u, "Release Notes erklären die ZIP-Prüfsumme nicht.");
const fullSuiteSteps = serialBuildSteps.length + parallelSteps.length + exclusiveSteps.length + finalSteps.length;
assert(
  releaseNotes.includes(`alle ${fullSuiteSteps} geplanten Schritte`) &&
    releaseNotes.includes(`${parallelSteps.length} konfliktfreie Haupttests`),
  "Release Notes nennen nicht den aktuellen vollständig bestandenen Suite-Plan.",
);
assert(security.includes(`v${packageJson.version}`), "Sicherheitsrichtlinie nennt den vorbereiteten Paketstand nicht.");
assert.match(security, /jeweils neueste GitHub-Version/u, "Security nennt die unterstützte Release-Linie nicht.");
assert.match(
  security,
  /jeweils jüngste dort vollständige Release unterstützt/u,
  "Security bindet Support nicht dauerhaft an ein vollständiges ZIP-/SHA-Release.",
);
assert(!/bleibt `v0\.1\.0-beta\.\d+`/u.test(security), "Security enthält eine nach Veröffentlichung veraltende Vorversion.");
assert.match(readme, /`2024` \/ Engine 30 \| `experimental` \/ `verification-only`/u);
assert.match(mainSkill, /Profil `2025` mit Engine-Major `31` freigegeben/u);
assert.match(setupSkill, /derzeit `2025` \/ Engine-Major `31`/u);

process.stdout.write(`Release-Metadaten: v${packageJson.version}, Security, Notes und 2 Skills synchron\n`);
