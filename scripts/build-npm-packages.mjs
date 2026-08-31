import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
