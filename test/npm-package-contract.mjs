import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKER_RUNTIME_FILES } from "./worker-fixture-files.mjs";

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const apiPackage = JSON.parse(readFileSync("packages/api/package.json", "utf8"));
const mcpPackage = JSON.parse(readFileSync("packages/mcp/package.json", "utf8"));
const apiReadme = readFileSync("packages/api/README.md", "utf8");
const mcpReadme = readFileSync("packages/mcp/README.md", "utf8");
const cleanInstallSource = readFileSync("test/npm-clean-install.mjs", "utf8");

assert.equal(rootPackage.private, true, "Das Workspace-Root muss unveroeffentlichbar bleiben.");
assert.deepEqual(rootPackage.workspaces, ["packages/*"]);
assert.equal(rootPackage.version, apiPackage.version);
assert.equal(rootPackage.version, mcpPackage.version);

for (const [directory, manifest] of [["packages/api", apiPackage], ["packages/mcp", mcpPackage]]) {
  assert.equal(manifest.private, undefined, `${directory} darf nicht private sein.`);
  assert.deepEqual(manifest.publishConfig, { access: "public", tag: "beta" });
  assert.equal(manifest.main, undefined, `${directory} ist ein CLI-Paket ohne nebenwirkenden JS-Haupteinstieg.`);
  if (directory === "packages/api") {
    assert.deepEqual(manifest.exports, { "./package.json": "./package.json" });
  } else {
    assert.deepEqual(manifest.exports, { "./cli": "./dist/index.js", "./package.json": "./package.json" });
  }
  for (const lifecycle of ["prepare", "prepack", "prepublish", "prepublishOnly", "postinstall"]) {
    assert.equal(manifest.scripts?.[lifecycle], undefined, `Consumer-Lifecycle darf nicht definiert sein: ${directory}/${lifecycle}`);
  }
  const lockEntry = packageLock.packages[directory];
  assert(lockEntry, `Lockfile-Eintrag fehlt: ${directory}`);
  assert.equal(lockEntry.version, manifest.version, `Lockfile-Version weicht ab: ${directory}`);
  assert.deepEqual(lockEntry.bin, manifest.bin, `Lockfile-Bins weichen ab: ${directory}`);
  assert.deepEqual(lockEntry.dependencies, manifest.dependencies, `Lockfile-Abhaengigkeiten weichen ab: ${directory}`);
}

assert.equal(apiPackage.name, "@yadimon/steuer-spar-erklaerung-api");
assert.match(apiPackage.description, /HTTP API wrapper and CLI/u);
assert.doesNotMatch(apiPackage.description, /wizard/iu, "Das API-Paket darf nicht als Wizard positioniert werden.");
assert.deepEqual(apiPackage.os, ["win32"]);
assert.deepEqual(apiPackage.cpu, ["x64"]);
assert.deepEqual(apiPackage.bin, {
  "steuer-spar-erklaerung-api": "dist/api-main.js",
  "steuer-spar-erklaerung-call": "dist/api-cli.js",
  "steuer-spar-erklaerung-setup": "dist/setup-main.js",
});
assert.equal(
  Object.keys(apiPackage.bin)[0],
  apiPackage.name.split("/").at(-1),
  "Der erste API-Bin muss dem Paketnamen entsprechen, damit npx <paket> den Foreground-Start waehlt.",
);
assert.equal(mcpPackage.name, "@yadimon/steuer-spar-erklaerung-mcp");
assert.match(mcpPackage.description, /MCP wrapper.*via the local API package/u);
assert.equal(mcpPackage.os, undefined, "Der PC-blinde MCP-Wrapper soll plattformneutral installierbar bleiben.");
assert.equal(mcpPackage.cpu, undefined, "Der PC-blinde MCP-Wrapper soll keine CPU-Einschraenkung tragen.");
assert.deepEqual(mcpPackage.bin, { "steuer-spar-erklaerung-mcp": "dist/index.js" });

for (const required of [
  "Beta und inoffiziell",
  "Windows x64",
  "SteuerSparErklärung 2025 / Engine-Major 31",
  "@yadimon/steuer-spar-erklaerung-api@beta",
  "API-Wrapper",
  "Setup-Skill",
  "ELSTER",
  "GitHub Releases",
]) {
  assert(apiReadme.includes(required), `API-Paket-README verschweigt: ${required}`);
}
for (const required of [
  "Beta und inoffiziell",
  "PC-blinder MCP-Wrapper",
  "exakt dieselbe Version",
  "@yadimon/steuer-spar-erklaerung-mcp@beta",
  "87 fachliche MCP-Toolnamen",
  "structuredContent",
  "SSE_API_TOKEN",
  "ELSTER",
]) {
  assert(mcpReadme.includes(required), `MCP-Paket-README verschweigt: ${required}`);
}
assert.match(mcpReadme, /über die lokale\s+SteuerSparErklärung-API/u);
assert.match(cleanInstallSource, /process\.argv\.includes\("--published"\)/u);
assert.match(cleanInstallSource, /npm_config_cache: join\(temporary, "npm-cache"\)/u);
assert.match(cleanInstallSource, /"Registry-Smoke"/u);

const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
assert(existsSync(npmCli), `npm CLI fuer Paketvertrag fehlt: ${npmCli}`);

function dryPack(directory) {
  const packed = spawnSync(
    process.execPath,
    [npmCli, "pack", `./${directory}`, "--dry-run", "--json", "--ignore-scripts"],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const [manifest] = JSON.parse(packed.stdout);
  return { manifest, paths: new Set(manifest.files.map((file) => file.path.replaceAll("\\", "/"))) };
}

const api = dryPack("packages/api");
assert.equal(api.manifest.name, apiPackage.name);
assert.equal(api.manifest.version, apiPackage.version);
assert(api.manifest.size < 2 * 1024 * 1024, `API-Paket ist unerwartet gross: ${api.manifest.size} Bytes`);
for (const required of [
  "dist/api-main.js",
  "dist/api-main-arguments.js",
  "dist/api-first-run.js",
  "dist/api-runtime.js",
  "dist/api-cli.js",
  "dist/local-http-transport.js",
  "dist/api-discovery.js",
  "dist/api-openapi.js",
  "dist/jsonl-logger.js",
  "dist/setup-main.js",
  "dist/setup-main-arguments.js",
  "dist/setup-check.js",
  "dist/setup.js",
  "dist/api-mcp-bootstrap.js",
  "dist/operation-catalog.js",
  ...WORKER_RUNTIME_FILES.map((name) => `powershell/${name}`),
  "powershell/api-task-common.ps1",
  "powershell/install-api-task.ps1",
  "powershell/ocr-image.ps1",
  "powershell/run-on-desktop.ps1",
  "powershell/start-api-hidden.ps1",
  "profiles/2025/profile.json",
  "profiles/2025/page-objects.json",
  "profiles/2024/profile.json",
  "profiles/2024/page-objects.json",
  "README.md",
  "LICENSE",
]) {
  assert(api.paths.has(required), `API-Paket enthaelt Pflichtdatei nicht: ${required}`);
}
for (const path of api.paths) {
  assert(!/^dist\/(?:index|mcp-(?:main|registry|response|tools))/u.test(path), `API-Paket enthaelt MCP-Runtime: ${path}`);
}

const mcp = dryPack("packages/mcp");
assert.equal(mcp.manifest.name, mcpPackage.name);
assert.equal(mcp.manifest.version, mcpPackage.version);
assert(mcp.manifest.size < 2 * 1024 * 1024, `MCP-Paket ist unerwartet gross: ${mcp.manifest.size} Bytes`);
for (const required of [
  "dist/index.js",
  "dist/api-client.js",
  "dist/local-http-transport.js",
  "dist/mcp-main.js",
  "dist/mcp-registry.js",
  "dist/mcp-response.js",
  "dist/mcp-tools.js",
  "dist/mcp-tools-analysis.js",
  "dist/mcp-tools-desktop.js",
  "dist/mcp-tools-diagnostics.js",
  "dist/mcp-tools-interaction.js",
  "dist/mcp-tools-lifecycle.js",
  "dist/mcp-tools-ui.js",
  "dist/operation-catalog.js",
  "dist/result-contract.js",
  "README.md",
  "LICENSE",
]) {
  assert(mcp.paths.has(required), `MCP-Paket enthaelt Pflichtdatei nicht: ${required}`);
}
for (const path of mcp.paths) {
  assert(!/^(?:powershell|profiles)\//u.test(path), `MCP-Paket kennt PC-Runtime: ${path}`);
  assert(!/^dist\/(?:api-main|api-runtime|setup|worker|product-profile)/u.test(path), `MCP-Paket enthaelt API-/PC-Modul: ${path}`);
}

for (const [label, packed] of [["API", api], ["MCP", mcp]]) {
  for (const path of packed.paths) {
    assert(!/^(?:src|test|skills-data|artifacts|\.tmp)\//u.test(path), `${label}-Paket enthaelt Entwicklungsdatei: ${path}`);
    assert(!/[A-Za-z]:[\\/]|Users[\\/]|Meine\s+Ablage|dimon/iu.test(path), `${label}-Paket enthaelt lokalen Pfad: ${path}`);
    if (/^dist\/.+\.js(?:\.map)?$/u.test(path)) {
      const source = join("src", path.slice("dist/".length).replace(/\.js(?:\.map)?$/u, ".ts"));
      assert(existsSync(source), `${label}-Paket enthaelt Build-Artefakt ohne TypeScript-Quelle: ${path}`);
    }
  }
}

process.stdout.write(
  `npm-Paketvertrag: API ${api.manifest.entryCount} Dateien/${api.manifest.size} Bytes, ` +
  `MCP ${mcp.manifest.entryCount} Dateien/${mcp.manifest.size} Bytes\n`,
);
