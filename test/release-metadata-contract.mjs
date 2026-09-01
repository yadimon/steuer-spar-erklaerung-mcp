import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAUNCH_OPERATION_TIMEOUT_MS } from "../dist/api-contract.js";
import { assertReleaseNotesReady } from "../scripts/release-current.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const apiPackage = JSON.parse(readFileSync(join("packages", "api", "package.json"), "utf8"));
const mcpPackage = JSON.parse(readFileSync(join("packages", "mcp", "package.json"), "utf8"));
const versionSource = readFileSync("src/version.ts", "utf8");
const security = readFileSync("SECURITY.md", "utf8");
const readme = readFileSync("README.md", "utf8");
const mainSkill = readFileSync(join("skills", "steuer-spar-erklaerung", "SKILL.md"), "utf8");
const installationGuide = readFileSync(join("docs", "INSTALLATION.md"), "utf8");
const releaseMode = process.argv.includes("--release");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--release");
assert.deepEqual(unknownArguments, [], `Unbekannte Release-Metadaten-Argumente: ${unknownArguments.join(" ")}`);

const fixtureRoot = join("test", "fixtures", "release-metadata");
const fixture = (name) => readFileSync(join(fixtureRoot, name), "utf8");
assert.doesNotThrow(
  () => assertReleaseNotesReady(fixture("ready.md"), "0.1.0-beta.99", "ready.md"),
  "Vollständige Notes mit einem fachlich offenen Steuerfall müssen releasebereit sein.",
);
for (const [name, expectedError] of [
  ["draft.md", /Entwurfsmarker/u],
  ["wrong-version.md", /versionsgenau/u],
  ["open-matrix.md", /offene Pflichtmatrix/u],
  ["open-verification.md", /offenen Pflichtstatus/u],
  ["unchecked-task.md", /offenen Pflichtmarker/u],
]) {
  assert.throws(
    () => assertReleaseNotesReady(fixture(name), "0.1.0-beta.99", name),
    expectedError,
    `${name} muss das Publish-Gate fail-closed sperren.`,
  );
}

assert.match(packageJson.version, /^0\.1\.0-beta\.\d+$/u, "Beta-Release braucht eine erwartete SemVer-Vorabversion.");
assert.equal(packageLock.version, packageJson.version, "Lockfile und package.json haben unterschiedliche Versionen.");
assert.equal(packageLock.packages?.[""]?.version, packageJson.version, "Lockfile-Rootpaket hat eine andere Version.");
assert.equal(apiPackage.version, packageJson.version, "API-npm-Paket hat eine andere Version.");
assert.equal(mcpPackage.version, packageJson.version, "MCP-npm-Paket hat eine andere Version.");
assert.equal(packageLock.packages?.["packages/api"]?.version, packageJson.version, "API-Lockfile hat eine andere Version.");
assert.equal(packageLock.packages?.["packages/mcp"]?.version, packageJson.version, "MCP-Lockfile hat eine andere Version.");
for (const manifest of [apiPackage, mcpPackage]) {
  assert.deepEqual(manifest.publishConfig, { access: "public", tag: "latest" },
    `${manifest.name} muss ausschließlich über den unterstützten latest-Kanal veröffentlichen.`);
  assert.match(manifest.scripts?.["publish:dry-run"] ?? "", /--tag latest/u,
    `${manifest.name} verwendet im Publish-Dry-Run nicht latest.`);
}
assert(
  versionSource.includes(`SSE_PACKAGE_VERSION = "${packageJson.version}"`),
  "Kompilierte Runtimeversion und package.json laufen auseinander.",
);
const publicVersionMatch = security.match(/`v(0\.1\.0-beta\.\d+)` ist die aktuelle öffentlich\s+unterstützte Version/u);
assert(publicVersionMatch, "Sicherheitsrichtlinie nennt keine eindeutig aktuelle öffentliche Version.");
const publicVersion = publicVersionMatch[1];
const notesVersion = releaseMode ? packageJson.version : publicVersion;
const releasePath = join("docs", "releases", `v${notesVersion}.md`);
assert(
  existsSync(releasePath),
  `Release Notes der ${releaseMode ? "zu veröffentlichenden Quellversion" : "aktuellen öffentlichen Version"} fehlen: ${releasePath}`,
);

const releaseNotes = readFileSync(releasePath, "utf8");
assertReleaseNotesReady(releaseNotes, notesVersion, releasePath);
if (releaseMode) {
  assert.equal(
    publicVersion,
    packageJson.version,
    "Vor einer Veröffentlichung muss SECURITY.md die zu veröffentlichende Quellversion als aktuell öffentlich nennen.",
  );
}
assert.match(releaseNotes, /SteuerSparErklärung 2025/u, "Release Notes nennen das unterstützte Produktprofil nicht.");
assert.match(releaseNotes, /ELSTER/iu, "Release Notes verschweigen die dauerhafte Übermittlungsgrenze.");
assert(
  !/steuer-spar-erklaerung\.zip/u.test(releaseNotes) || /entfallen|entfernt/u.test(releaseNotes),
  "Release Notes duerfen kein Portable-ZIP mehr anpreisen; installiert wird aus der npm-Registry.",
);
assert(
  /alle \d+ geplanten Schritte/u.test(releaseNotes) &&
    /\d+ parallele Haupttests/u.test(releaseNotes) &&
    releaseNotes.includes("konfliktbewusster Worker-Serialisierung"),
  "Release Notes nennen nicht den zum Releasezeitpunkt vollständig bestandenen Suite-Plan.",
);
assert(
  security.includes(`\`v${publicVersion}\` ist die aktuelle öffentlich`)
    && !security.includes(`bereitet \`v${publicVersion}\``),
  "Sicherheitsrichtlinie muss den tatsaechlich veröffentlichten Paketstand als aktuell unterstützt nennen.",
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
assert.match(readme, /Profil 2024.+experimentell.+Verifikation/isu);
assert.match(mainSkill, /Profil `2025` mit Engine-Major `31` freigegeben/u);
assert.match(installationGuide, /SteuerSparErklärung 2025/u);

process.stdout.write(
  `Release-Metadaten: Quellstand v${packageJson.version}, öffentlich v${publicVersion}, ` +
  `Security, historische Notes und Public Skill synchron${releaseMode ? " (Publish-Gate)" : ""}\n`,
);
