import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  loadAgentPluginMetadata,
  writeOrCheckAgentPluginManifests,
} from "../scripts/generate-agent-plugin-manifests.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (content) => createHash("sha256").update(content).digest("hex");
const rootPackage = readJson("package.json");
const metadata = readJson("plugin/metadata.json");
const pluginRoot = resolve("plugin", metadata.name);
const portableManifest = readJson(join(pluginRoot, "plugin.json"));
const portableMcp = readJson(join(pluginRoot, "mcp.json"));
const compatibilityMcp = readJson(join(pluginRoot, ".mcp.json"));
const openPluginManifest = readJson(join(pluginRoot, ".plugin", "plugin.json"));
const codexManifest = readJson(join(pluginRoot, ".codex-plugin", "plugin.json"));
const claudeManifest = readJson(join(pluginRoot, ".claude-plugin", "plugin.json"));
const marketplace = readJson("marketplace.json");
const runtimeRoot = join(pluginRoot, "runtime");
const runtimeLock = readJson(join(runtimeRoot, "runtime-lock.json"));
const thirdPartyNotices = readJson(join(runtimeRoot, "third-party", "NOTICE.json"));

for (const path of [
  "plugin/metadata.json",
  "marketplace.json",
  ...regularFiles(pluginRoot).map((file) => relative(resolve("."), file).replaceAll("\\", "/")),
]) {
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "--", path], {
    cwd: resolve("."),
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(ignored.status, 1, `Plugin-Datei ist nicht commit-/clone-faehig, weil git sie ignoriert: ${path}`);
}

assert.deepEqual(Object.keys(portableManifest).sort(), [
  "$schema", "author", "description", "homepage", "keywords", "license", "name", "repository", "version",
].sort(), "Der geschlossene Agent-Plugins-v1-Manifestvertrag enthaelt unbekannte Felder.");
assert.equal(portableManifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.equal(portableManifest.name, metadata.name);
assert.equal(portableManifest.version, rootPackage.version);
assert.deepEqual(portableManifest.author, metadata.author);

assert.deepEqual(Object.keys(portableMcp).sort(), ["$schema", "mcpServers"].sort());
assert.equal(portableMcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
assert.deepEqual(portableMcp.mcpServers[metadata.mcpServer.name], {
  type: "stdio",
  command: "node",
  args: [`\${PLUGIN_ROOT}/${metadata.mcpServer.entry}`],
  cwd: "${PLUGIN_ROOT}",
});
assert.deepEqual(compatibilityMcp.mcpServers[metadata.mcpServer.name], {
  command: "node",
  args: [`\${PLUGIN_ROOT}/${metadata.mcpServer.entry}`],
  cwd: "${PLUGIN_ROOT}",
});
for (const configuration of [portableMcp, compatibilityMcp]) {
  const serialized = JSON.stringify(configuration.mcpServers);
  assert.doesNotMatch(serialized, /\b(?:npm|npx|pnpm|yarn)(?:\.cmd)?\b/iu,
    "Der MCP-Start darf keinen Paketmanager oder Runtime-Installer verwenden.");
  assert.doesNotMatch(serialized, /https?:\/\//iu, "Der MCP-Start darf keinen Netzwerk-Endpunkt enthalten.");
}

for (const manifest of [openPluginManifest, codexManifest, claudeManifest]) {
  assert.equal(manifest.name, metadata.name);
  assert.equal(manifest.version, rootPackage.version);
  assert.equal(manifest.repository, metadata.repository);
}
assert.equal(codexManifest.skills, "./skills/");
assert.equal(codexManifest.mcpServers, "./.mcp.json");
assert.equal(codexManifest.interface.displayName, metadata.displayName);
assert.equal(claudeManifest.skills, undefined,
  "Claude-Kompatibilitaet wird ueber den Standardordner und .mcp.json statt proprietaere Felder geladen.");

assert.equal(marketplace.name, metadata.marketplace.name);
assert.equal(marketplace.plugins.length, 1);
assert.equal(marketplace.plugins[0].source, `./plugin/${metadata.name}`);
assert.equal(marketplace.plugins[0].version, rootPackage.version);
assert.deepEqual(marketplace.plugins[0].policy, {
  installation: "AVAILABLE",
  authentication: "ON_INSTALL",
});

const canonicalSkillRoot = resolve(metadata.skill.source);
const bundledSkillRoot = resolve(pluginRoot, "skills", metadata.skill.name);
function regularFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Plugin-Baum darf keinen Link enthalten: ${path}`);
    if (entry.isDirectory()) result.push(...regularFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const canonicalSkillFiles = regularFiles(canonicalSkillRoot)
  .map((path) => relative(canonicalSkillRoot, path).replaceAll("\\", "/")).sort();
const bundledSkillFiles = regularFiles(bundledSkillRoot)
  .map((path) => relative(bundledSkillRoot, path).replaceAll("\\", "/")).sort();
assert.deepEqual(bundledSkillFiles, canonicalSkillFiles, "Der gebuendelte Skill weist Dateidrift auf.");
for (const path of canonicalSkillFiles) {
  assert(readFileSync(join(canonicalSkillRoot, path)).equals(readFileSync(join(bundledSkillRoot, path))),
    `Der gebuendelte Skill weist Inhaltsdrift auf: ${path}`);
}

assert.equal(runtimeLock.schemaVersion, 1);
assert.equal(runtimeLock.packageName, rootPackage.name);
assert.equal(runtimeLock.packageVersion, rootPackage.version);
assert.equal(runtimeLock.pluginName, metadata.name);
assert.equal(runtimeLock.pluginVersion, rootPackage.version);
assert.deepEqual(runtimeLock.entries, { mcp: "dist/mcp.js", api: "dist/api.js" });
const locked = new Map(runtimeLock.files.map((file) => [file.path, file]));
assert.equal(locked.size, runtimeLock.files.length, "Runtime-Lock enthaelt doppelte Pfade.");
const deliveredRuntimeFiles = regularFiles(runtimeRoot)
  .map((path) => relative(runtimeRoot, path).replaceAll("\\", "/"))
  .filter((path) => path !== "runtime-lock.json")
  .sort();
function assertRuntimeTreeExactlyLocked(lock, delivered) {
  assert.deepEqual([...lock.keys()].sort(), [...delivered].sort(),
    "Runtime-Lock und ausgelieferter Runtime-Baum laufen auseinander.");
}
assertRuntimeTreeExactlyLocked(locked, deliveredRuntimeFiles);
assert.throws(
  () => assertRuntimeTreeExactlyLocked(locked, [...deliveredRuntimeFiles, "ungebundene-extra-datei"]),
  /Runtime-Lock und ausgelieferter Runtime-Baum laufen auseinander/iu,
  "Der Runtime-Vertrag muss eine ausgelieferte Datei ohne Lock-Eintrag ablehnen.",
);
assert.throws(
  () => assertRuntimeTreeExactlyLocked(
    new Map([...locked, ["fehlende-runtime-datei", { path: "fehlende-runtime-datei" }]]),
    deliveredRuntimeFiles,
  ),
  /Runtime-Lock und ausgelieferter Runtime-Baum laufen auseinander/iu,
  "Der Runtime-Vertrag muss einen Lock-Eintrag ohne ausgelieferte Datei ablehnen.",
);

const sourceProfileIds = readdirSync("profiles", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^[0-9]{4}$/u.test(entry.name))
  .map((entry) => entry.name)
  .sort();
const expectedProductionProfileFiles = sourceProfileIds
  .flatMap((profileId) => [
    `profiles/${profileId}/page-objects.json`,
    `profiles/${profileId}/profile.json`,
  ])
  .sort();
const deliveredProfileFiles = deliveredRuntimeFiles
  .filter((path) => path.startsWith("profiles/"))
  .sort();
assert.deepEqual(deliveredProfileFiles, expectedProductionProfileFiles,
  "Das Produktionsplugin darf nur Profile und Page-Objects ausliefern, keine Test-Fixtures.");
for (const path of deliveredRuntimeFiles) {
  assert(!path.startsWith("../") && !path.includes("\\") && !path.split("/").includes(".."));
  const content = readFileSync(join(runtimeRoot, path));
  const record = locked.get(path);
  assert.equal(record.size, content.length, `Runtime-Groesse driftet: ${path}`);
  assert.equal(record.sha256, hash(content), `Runtime-Hash driftet: ${path}`);
}
for (const entry of Object.values(runtimeLock.entries)) assert(locked.has(entry), `Runtime-Einstieg fehlt: ${entry}`);

for (const entry of ["dist/mcp.js", "dist/api.js"]) {
  const bundle = readFileSync(join(runtimeRoot, entry), "utf8");
  assert.match(bundle.slice(0, 500), /process\.versions\.node[\s\S]+__sseNodeMajor < 22[\s\S]+process\.stderr\.write/iu,
    `${entry} lehnt Node-Versionen unter 22 nicht vor dem Runtime-Start ab.`);
  assert(!bundle.slice(0, 500).includes("process.stdout"), `${entry} verschmutzt beim Node-Versionsfehler stdout.`);
  assert(!bundle.toLowerCase().includes(resolve(".").toLowerCase()),
    `${entry} enthaelt den absoluten lokalen Buildpfad.`);
  for (const match of bundle.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["'];?$/gmu)) {
    assert(match[1].startsWith("node:"), `${entry} besitzt eine externe Runtime-Abhaengigkeit: ${match[1]}`);
  }
}

assert.equal(thirdPartyNotices.generatedFrom, "esbuild-metafile-inputs");
assert(thirdPartyNotices.packages.length > 0, "Drittanbieter-Notices duerfen nicht leer sein.");
for (const dependency of thirdPartyNotices.packages) {
  const installed = readJson(join("node_modules", ...dependency.name.split("/"), "package.json"));
  assert.equal(dependency.version, installed.version, `Notice-Version driftet: ${dependency.name}`);
  assert.equal(dependency.license, installed.license, `Notice-Lizenz driftet: ${dependency.name}`);
  assert(dependency.bundles.length > 0 && dependency.bundles.every((name) => ["api", "mcp"].includes(name)));
  assert(dependency.licenseFiles.length > 0, `Notice ohne Lizenzdatei: ${dependency.name}`);
  for (const licensePath of dependency.licenseFiles) {
    assert(locked.has(licensePath), `Drittanbieter-Lizenz ist nicht im Runtime-Lock: ${licensePath}`);
  }
}

for (const [script, args] of [
  ["scripts/generate-agent-plugin-manifests.mjs", ["--check"]],
  ["scripts/build-agent-plugin.mjs", ["--check"]],
]) {
  const checked = spawnSync(process.execPath, [script, ...args], {
    cwd: resolve("."),
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(checked.status, 0, `${script} meldet Drift:\n${checked.stdout}\n${checked.stderr}`);
}

function metadataPathSecurityContract() {
  const temporary = mkdtempSync(join(tmpdir(), "sse-agent-plugin-metadata-"));
  const activeJunctions = [];
  const canonicalMetadata = readJson("plugin/metadata.json");
  const fixture = (name) => {
    const fixtureRoot = join(temporary, name);
    mkdirSync(join(fixtureRoot, "plugin"), { recursive: true });
    mkdirSync(join(fixtureRoot, "skills"), { recursive: true });
    cpSync("package.json", join(fixtureRoot, "package.json"));
    cpSync("plugin/metadata.json", join(fixtureRoot, "plugin", "metadata.json"));
    cpSync(
      resolve(canonicalMetadata.skill.source),
      join(fixtureRoot, ...canonicalMetadata.skill.source.split("/")),
      { recursive: true },
    );
    return fixtureRoot;
  };
  const mutate = (fixtureRoot, change) => {
    const path = join(fixtureRoot, "plugin", "metadata.json");
    const value = readJson(path);
    change(value);
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  };
  try {
    for (const [name, change] of [
      ["plugin-traversal", (value) => { value.name = "../outside"; }],
      ["absolute-skill-source", (value) => { value.skill.source = "C:/outside"; }],
      ["skill-source-traversal", (value) => { value.skill.source = "skills/../outside"; }],
      ["mcp-entry-traversal", (value) => { value.mcpServer.entry = "runtime/../../outside.js"; }],
      ["api-entry-backslash", (value) => { value.runtime.apiEntry = "runtime\\dist\\api.js"; }],
      ["api-entry-absolute", (value) => { value.runtime.apiEntry = "C:/outside/api.js"; }],
    ]) {
      const fixtureRoot = fixture(name);
      mutate(fixtureRoot, change);
      assert.throws(
        () => writeOrCheckAgentPluginManifests({ root: fixtureRoot }),
        /(?:portabler|Pfadsegment|Wurzel|Runtime-Einstiege)/iu,
        `Unsicherer Metadata-Pfad wurde akzeptiert: ${name}`,
      );
    }

    const sourceFixture = fixture("source-junction");
    const sourcePath = join(sourceFixture, ...canonicalMetadata.skill.source.split("/"));
    rmSync(sourcePath, { recursive: true, force: true });
    const outsideSource = join(temporary, "outside-source");
    mkdirSync(outsideSource, { recursive: true });
    writeFileSync(join(outsideSource, "secret.txt"), "darf nicht als Skill gelesen werden\n", "utf8");
    symlinkSync(outsideSource, sourcePath, "junction");
    activeJunctions.push(sourcePath);
    assert.throws(
      () => loadAgentPluginMetadata(sourceFixture),
      /(?:Link|real|sicher gebunden)/iu,
      "Eine aus der Skill-Wurzel ausbrechende Junction wurde als Quelle akzeptiert.",
    );

    const targetFixture = fixture("target-junction");
    const targetPluginRoot = join(targetFixture, "plugin", canonicalMetadata.name);
    mkdirSync(targetPluginRoot, { recursive: true });
    const outsideTarget = join(temporary, "outside-target");
    mkdirSync(outsideTarget, { recursive: true });
    const sentinel = join(outsideTarget, "plugin.json");
    writeFileSync(sentinel, "unveraendert\n", "utf8");
    const targetJunction = join(targetPluginRoot, ".plugin");
    symlinkSync(outsideTarget, targetJunction, "junction");
    activeJunctions.push(targetJunction);
    assert.throws(
      () => writeOrCheckAgentPluginManifests({ root: targetFixture }),
      /Link/iu,
      "Eine aus dem Plugin-Ziel ausbrechende Junction wurde beim Schreiben akzeptiert.",
    );
    assert.equal(readFileSync(sentinel, "utf8"), "unveraendert\n",
      "Der Manifest-Build ueberschrieb ein Ziel ausserhalb der Plugin-Wurzel.");
  } finally {
    for (const junction of activeJunctions.reverse()) {
      if (existsSync(junction)) rmdirSync(junction);
    }
    rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

metadataPathSecurityContract();

process.stdout.write(
  `Agent-Plugin-Vertrag: v${rootPackage.version}, Agent Plugins 1.0, Codex/Claude-Kompatibilitaet und ${runtimeLock.files.length} Runtime-Hashes bestanden\n`,
);
