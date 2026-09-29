import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = join(root, "packages", "api");
const mcpRoot = join(root, "packages", "mcp");

function removeGenerated(path) {
  if (!existsSync(path)) return;
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`Generiertes npm-Ziel darf kein Link sein: ${path}`);
  }
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

function assertNoLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`npm-Paketquelle darf keinen Link enthalten: ${path}`);
    if (entry.isDirectory()) assertNoLinks(path);
  }
}

for (const path of [
  join(apiRoot, "dist"),
  join(apiRoot, "powershell"),
  join(apiRoot, "profiles"),
  join(apiRoot, "LICENSE"),
  join(mcpRoot, "dist"),
  join(mcpRoot, "LICENSE"),
]) {
  removeGenerated(path);
}

const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
for (const config of ["tsconfig.npm-api.json", "tsconfig.npm-mcp.json"]) {
  const compiled = spawnSync(process.execPath, [tsc, "-p", config], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (compiled.status !== 0) {
    process.stderr.write(compiled.stdout ?? "");
    process.stderr.write(compiled.stderr ?? "");
    process.exit(compiled.status ?? 1);
  }
}

// A fresh npm installation otherwise loads hundreds of SDK/schema files before
// the stdio handshake. Bundle the CLI and its exact locked dependencies so cold
// startup needs one JavaScript read; the API remains an ordinary npm dependency.
const mcpBundle = await bundle({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: "index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  preserveSymlinks: true,
  charset: "utf8",
  legalComments: "eof",
  sourcemap: false,
  minify: false,
  treeShaking: true,
  write: false,
  metafile: true,
  logLevel: "warning",
});
if (mcpBundle.outputFiles.length !== 1 || Object.keys(mcpBundle.metafile.outputs).length !== 1) {
  throw new Error("MCP CLI bundle must contain exactly one JavaScript output.");
}
for (const imported of Object.values(mcpBundle.metafile.outputs)[0].imports) {
  if (imported.external && !imported.path.startsWith("node:")) {
    throw new Error(`MCP CLI bundle has an external JavaScript dependency: ${imported.path}`);
  }
}
const bundledText = mcpBundle.outputFiles[0].text;
if ([root, root.replaceAll("\\", "/")].some(path => bundledText.toLowerCase().includes(path.toLowerCase()))) {
  throw new Error("MCP CLI bundle contains an absolute build path.");
}
writeFileSync(join(mcpRoot, "dist", "index.js"), mcpBundle.outputFiles[0].contents);

// Every dependency actually included in the bundle carries its original license.
const bundledPackages = new Set();
for (const input of Object.keys(mcpBundle.metafile.inputs)) {
  const normalized = input.replaceAll("\\", "/");
  const marker = "node_modules/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) continue;
  const parts = normalized.slice(index + marker.length).split("/");
  bundledPackages.add(parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]);
}
const notices = ["# Bundled MCP CLI dependencies", "", "Generated from the esbuild input manifest.", ""];
for (const name of [...bundledPackages].sort()) {
  const dependencyRoot = join(root, "node_modules", ...name.split("/"));
  const manifest = JSON.parse(readFileSync(join(dependencyRoot, "package.json"), "utf8"));
  if (manifest.name !== name || !manifest.version || typeof manifest.license !== "string" || !manifest.license) {
    throw new Error(`Bundled dependency metadata is incomplete: ${name}`);
  }
  const licenses = readdirSync(dependencyRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(?:licen[cs]e|copying)(?:\..*)?$/iu.test(entry.name))
    .map(entry => entry.name).sort();
  if (!licenses.length) throw new Error(`Bundled dependency license is missing: ${name}`);
  notices.push(`## ${name}@${manifest.version} (${manifest.license})`, "");
  for (const license of licenses) {
    notices.push(readFileSync(join(dependencyRoot, license), "utf8").replaceAll("\r\n", "\n").trimEnd(), "");
  }
}
writeFileSync(join(mcpRoot, "dist", "THIRD_PARTY_NOTICES.md"), notices.join("\n"), "utf8");

const nativeDll = join(root, "powershell", "sse-native.dll");
const nativeHash = join(root, "powershell", "sse-native.sha256");
if (!existsSync(nativeDll) || !existsSync(nativeHash)) {
  throw new Error("Native API-Runtime fehlt. Zuerst npm run build:native ausfuehren.");
}

assertNoLinks(join(root, "powershell"));
assertNoLinks(join(root, "profiles"));

cpSync(join(root, "powershell"), join(apiRoot, "powershell"), {
  recursive: true,
  filter: (source) => {
    const name = basename(source);
    return !name.startsWith(".sse-native-") && name !== "build-native.ps1";
  },
});
cpSync(join(root, "profiles"), join(apiRoot, "profiles"), { recursive: true });
for (const packageRoot of [apiRoot, mcpRoot]) {
  mkdirSync(packageRoot, { recursive: true });
  copyFileSync(join(root, "LICENSE"), join(packageRoot, "LICENSE"));
}

const countFiles = (directory) => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile()).length;
process.stdout.write(
  `npm-Pakete gebaut: API ${countFiles(apiRoot)} Dateien, MCP ${countFiles(mcpRoot)} Dateien\n`,
);
