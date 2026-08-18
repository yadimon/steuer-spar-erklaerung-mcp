import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKER_RUNTIME_FILES } from "./worker-fixture-files.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
assert.deepEqual(packageLock.packages[""].bin, packageJson.bin, "Lockfile und Manifest haben unterschiedliche CLI-Einstiege.");
assert.deepEqual(
  packageLock.packages[""].dependencies,
  packageJson.dependencies,
  "Lockfile und Manifest haben unterschiedliche Produktionsabhaengigkeiten.",
);
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
assert(existsSync(npmCli), `npm CLI fuer Paketvertrag fehlt: ${npmCli}`);
const packed = spawnSync(
  process.execPath,
  [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: process.cwd(), encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(packed.status, 0, packed.stderr || packed.stdout);
const [manifest] = JSON.parse(packed.stdout);
assert.equal(manifest.name, packageJson.name);
assert.equal(manifest.version, packageJson.version);
assert(manifest.size < 2 * 1024 * 1024, `npm-Paket ist unerwartet gross: ${manifest.size} Bytes`);
assert.deepEqual(packageJson.bin, {
  "steuer-spar-erklaerung-mcp": "dist/index.js",
  "steuer-spar-erklaerung-api": "dist/api-main.js",
  "steuer-spar-erklaerung-call": "dist/api-cli.js",
  "steuer-spar-erklaerung-setup": "dist/setup-main.js",
});

const paths = new Set(manifest.files.map((file) => file.path.replaceAll("\\", "/")));
for (const required of [
  "dist/index.js",
  "dist/api-main.js",
  "dist/api-main-arguments.js",
  "dist/api-runtime.js",
  "dist/api-cli.js",
  "dist/local-http-transport.js",
  "dist/api-discovery.js",
  "dist/api-openapi.js",
  "dist/jsonl-logger.js",
  "dist/setup-main.js",
  "dist/setup-main-arguments.js",
  "dist/setup.js",
  "dist/mcp-registry.js",
  "dist/mcp-main.js",
  "dist/mcp-tools.js",
  "dist/mcp-tools-analysis.js",
  "dist/mcp-tools-desktop.js",
  "dist/mcp-tools-diagnostics.js",
  "dist/mcp-tools-interaction.js",
  "dist/mcp-tools-lifecycle.js",
  "dist/mcp-tools-ui.js",
  "dist/mcp-operation-schemas.js",
  "dist/mcp-schemas-analysis.js",
  "dist/mcp-schemas-desktop.js",
  "dist/mcp-schemas-diagnostics.js",
  "dist/mcp-schemas-interaction.js",
  "dist/mcp-schemas-lifecycle.js",
  "dist/mcp-schemas-ui.js",
  "dist/operation-schema-primitives.js",
  "dist/operation-catalog.js",
  ...WORKER_RUNTIME_FILES.map((name) => `powershell/${name}`),
  "powershell/api-task-common.ps1",
  "powershell/install-api-task.ps1",
  "powershell/ocr-image.ps1",
  "powershell/run-on-desktop.ps1",
  "powershell/start-api-hidden.ps1",
  "profiles/2025/profile.json",
  "profiles/2025/page-objects.json",
  "skills/steuer-spar-erklaerung/SKILL.md",
  "skills/steuer-spar-erklaerung-setup/SKILL.md",
  "README.md",
  "LICENSE",
]) {
  assert(paths.has(required), `npm-Paket enthaelt Pflichtdatei nicht: ${required}`);
}
for (const path of paths) {
  assert(!/^(?:src|test|skills-data|artifacts|\.tmp)\//u.test(path), `npm-Paket enthaelt Entwicklungsdatei: ${path}`);
  assert(!/[A-Za-z]:[\\/]|Users[\\/]|Meine\s+Ablage|dimon/iu.test(path), `npm-Paket enthaelt lokalen Pfad: ${path}`);
  if (/^dist\/.+\.js(?:\.map)?$/u.test(path)) {
    const source = join("src", path.slice("dist/".length).replace(/\.js(?:\.map)?$/u, ".ts"));
    assert(existsSync(source), `npm-Paket enthaelt ein Build-Artefakt ohne TypeScript-Quelle: ${path}`);
  }
}

process.stdout.write(`npm-Paketvertrag: ${manifest.entryCount} Dateien, ${manifest.size} Bytes, Runtime und 2 Skills enthalten\n`);
