import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const allowedRoot = resolve(repoRoot, "artifacts", "portable");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const ownershipMarkerName = ".sse-portable-build.json";
const ownershipMarkerContent = `${JSON.stringify({ schemaVersion: 1, product: packageJson.name })}\n`;
const outputArgumentIndex = process.argv.indexOf("--output");
const createZip = process.argv.includes("--zip");
const requestedOutput = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : undefined;
if (outputArgumentIndex >= 0 && !requestedOutput) throw new Error("--output verlangt einen Pfad.");
const output = requestedOutput
  ? resolve(repoRoot, requestedOutput)
  : join(allowedRoot, "steuer-spar-erklaerung");

const insideAllowedRoot = relative(allowedRoot, output);
if (!insideAllowedRoot || insideAllowedRoot.startsWith("..") || isAbsolute(insideAllowedRoot)) {
  throw new Error(`Portable-Ausgabe muss ein Unterordner von ${allowedRoot} sein: ${output}`);
}
if (process.platform !== "win32") throw new Error("Portable Windows-Pakete werden nur unter Windows gebaut.");
mkdirSync(allowedRoot, { recursive: true });
const realAllowedRoot = realpathSync(allowedRoot);
let existingAncestor = output;
while (!existsSync(existingAncestor)) existingAncestor = dirname(existingAncestor);
const realAncestor = realpathSync(existingAncestor);
const ancestorRelative = relative(realAllowedRoot, realAncestor);
if (ancestorRelative.startsWith("..") || isAbsolute(ancestorRelative)) {
  throw new Error(`Portable-Ausgabe folgt einem Pfad ausserhalb von ${realAllowedRoot}: ${output}`);
}

const profilesRoot = join(repoRoot, "profiles");
const supportedProfiles = readdirSync(profilesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^[0-9]{4}$/u.test(entry.name))
  .map((entry) => {
    const manifestPath = join(profilesRoot, entry.name, "profile.json");
    if (!existsSync(manifestPath)) throw new Error(`Portable Produktprofil fehlt: profiles/${entry.name}/profile.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.schemaVersion !== 1 || manifest.id !== entry.name || String(manifest.taxYear) !== entry.name) {
      throw new Error(`Portable Produktprofil '${entry.name}' widerspricht Verzeichnis, Schema oder Steuerjahr.`);
    }
    if (typeof manifest.pageObjects !== "string" || !/^[^\\/:]+\.json$/iu.test(manifest.pageObjects)) {
      throw new Error(`Portable Produktprofil '${entry.name}' nennt keinen sicheren Page-Object-Dateinamen.`);
    }
    return manifest;
  })
  .filter((profile) => profile.status === "supported");
if (!supportedProfiles.length) throw new Error("Portable Build enthaelt kein produktiv freigegebenes SSE-Profil.");

const dotSourcedPowerShellFiles = [
  "powershell/akad-parser.ps1",
  "powershell/api-task-common.ps1",
  "powershell/load-native.ps1",
  "powershell/table-region.ps1",
  "powershell/table-values.ps1",
  "powershell/worker-transport-common.ps1",
];

const requiredFiles = [
  "dist/api-main.js",
  "dist/index.js",
  "dist/setup-main.js",
  "dist/setup-main-arguments.js",
  "dist/setup.js",
  "powershell/sse-worker.ps1",
  "powershell/run-on-desktop.ps1",
  "powershell/start-api-hidden.ps1",
  "powershell/install-api-task.ps1",
  "powershell/ocr-image.ps1",
  "powershell/sse-native.dll",
  "powershell/sse-native.sha256",
  "powershell/sse-native.cs",
  ...dotSourcedPowerShellFiles,
  ...supportedProfiles.flatMap((profile) => [
    `profiles/${profile.id}/profile.json`,
    `profiles/${profile.id}/${profile.pageObjects}`,
  ]),
  "skills/steuer-spar-erklaerung/SKILL.md",
  "skills/steuer-spar-erklaerung-setup/SKILL.md",
  "docs/assets/demo/steuer-spar-erklaerung-demo.gif",
  "README.md",
  "LICENSE",
  "package.json",
];
for (const item of requiredFiles) {
  if (!existsSync(join(repoRoot, item))) throw new Error(`Portable Build-Artefakt fehlt: ${item}`);
}

const nodeExecutable = process.execPath;
const nodeLicense = join(dirname(nodeExecutable), "LICENSE");
if (!existsSync(nodeLicense)) {
  throw new Error(`Lizenz der gebuendelten Node-Laufzeit fehlt neben ${nodeExecutable}`);
}
const runtimeDefinition = JSON.parse(readFileSync(join(repoRoot, "portable", "runtime.json"), "utf8"));
const pinnedNode = runtimeDefinition.node;
const currentNodeHash = createHash("sha256").update(readFileSync(nodeExecutable)).digest("hex");
if (
  process.version !== `v${pinnedNode.version}` ||
  process.platform !== pinnedNode.platform ||
  process.arch !== pinnedNode.arch ||
  currentNodeHash !== pinnedNode.executableSha256
) {
  throw new Error(
    `Portable Build braucht den gepinnten offiziellen Node ${pinnedNode.version}-${pinnedNode.platform}-${pinnedNode.arch} ` +
      `mit SHA256 ${pinnedNode.executableSha256}; aktuell ${process.version}-${process.platform}-${process.arch} ${currentNodeHash}.`,
  );
}

if (existsSync(output)) {
  const outputStats = lstatSync(output);
  const ownershipMarker = join(output, ownershipMarkerName);
  if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
    throw new Error(`Portable-Ausgabe ist kein eigener regulaerer Buildordner: ${output}`);
  }
  if (
    !existsSync(ownershipMarker) ||
    lstatSync(ownershipMarker).isSymbolicLink() ||
    statSync(ownershipMarker).size > 1024 ||
    readFileSync(ownershipMarker, "utf8") !== ownershipMarkerContent
  ) {
    throw new Error(`Portable-Ausgabe besitzt keine gueltige Build-Eigentumsmarke und wird nicht geloescht: ${output}`);
  }
  rmSync(output, { recursive: true });
}
mkdirSync(output, { recursive: true });
writeFileSync(join(output, ownershipMarkerName), ownershipMarkerContent, { encoding: "utf8", flag: "wx" });
for (const item of ["dist", "powershell", "profiles", "skills", "README.md", "LICENSE", "package.json"]) {
  const source = join(repoRoot, item);
  if (existsSync(source)) cpSync(source, join(output, item), { recursive: true, dereference: true });
}
cpSync(
  join(repoRoot, "docs", "assets", "demo"),
  join(output, "docs", "assets", "demo"),
  { recursive: true, dereference: true },
);
for (const entry of readdirSync(join(output, "powershell"))) {
  if (entry.startsWith(".sse-native-")) rmSync(join(output, "powershell", entry), { force: true });
}

const runtimeDir = join(output, "runtime");
mkdirSync(runtimeDir, { recursive: true });
cpSync(nodeExecutable, join(runtimeDir, "node.exe"));
cpSync(nodeLicense, join(runtimeDir, "LICENSE-node.txt"));

const npmCli = process.env.npm_execpath || join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
if (!existsSync(npmCli)) throw new Error(`npm CLI fuer den Entwickler-Build fehlt: ${npmCli}`);
const dependencyStage = mkdtempSync(join(allowedRoot, ".dependency-stage-"));
try {
  cpSync(join(repoRoot, "package.json"), join(dependencyStage, "package.json"));
  cpSync(join(repoRoot, "package-lock.json"), join(dependencyStage, "package-lock.json"));
  const npm = spawnSync(
    process.execPath,
    [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", dependencyStage],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  if (npm.error || npm.status !== 0) {
    throw new Error(`Saubere Produktionsinstallation aus package-lock.json scheiterte: ${npm.stderr || npm.error?.message}`);
  }
  cpSync(join(dependencyStage, "node_modules"), join(output, "node_modules"), { recursive: true, dereference: true });
} finally {
  rmSync(dependencyStage, { recursive: true, force: true });
}

writeFileSync(
  join(output, "sse-setup.cmd"),
  '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0dist\\setup-main.js" %*\r\nif errorlevel 1 pause\r\n',
  "utf8",
);
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const collectFiles = (root, current = root) => readdirSync(current, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(current, entry.name);
    return entry.isDirectory() ? collectFiles(root, path) : [relative(root, path).replaceAll("\\", "/")];
  });
const files = collectFiles(output)
  .filter((path) => path !== "portable-manifest.json")
  .sort()
  .map((path) => ({ path, bytes: statSync(join(output, path)).size, sha256: sha256(join(output, path)) }));
writeFileSync(
  join(output, "portable-manifest.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    product: packageJson.name,
    productVersion: packageJson.version,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    userInstalledRuntimes: [],
    systemRequirements: {
      os: "Windows 10 oder 11 x64",
      windowsPowerShell: ">=5.1 (Bestandteil von Windows)",
      steuerSparErklaerung: supportedProfiles
        .map((profile) => `${profile.product} / Engine-Major ${profile.engineFileMajor}`)
        .join("; "),
      interactiveDesktop: "entsperrt; bei sichtbaren Aktionen keine parallelen Maus-/Tastatureingaben",
    },
    supportedProfiles: supportedProfiles.map((profile) => ({
      id: profile.id,
      product: profile.product,
      taxYear: profile.taxYear,
      engineFileMajor: profile.engineFileMajor,
    })),
    bundledRuntimes: { node: pinnedNode },
    files,
  }, null, 2)}\n`,
  "utf8",
);

if (createZip) {
  const zipPath = `${output}.zip`;
  const checksumPath = `${zipPath}.sha256`;
  const zipExists = existsSync(zipPath);
  const checksumExists = existsSync(checksumPath);
  if (zipExists || checksumExists) {
    if (!zipExists || !checksumExists || lstatSync(zipPath).isSymbolicLink() || lstatSync(checksumPath).isSymbolicLink()) {
      throw new Error("Vorhandenes ZIP/Pruefsummenpaar ist unvollstaendig oder verlinkt und wird nicht ersetzt.");
    }
    const expectedChecksum = `${sha256(zipPath)}  ${zipPath.split(/[\\/]/u).at(-1)}\n`;
    if (statSync(checksumPath).size > 256 || readFileSync(checksumPath, "utf8") !== expectedChecksum) {
      throw new Error("Vorhandenes ZIP stimmt nicht mit seiner Pruefsumme ueberein und wird nicht ersetzt.");
    }
    rmSync(zipPath);
    rmSync(checksumPath);
  }
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const archive = spawnSync(
    powershell,
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      join(repoRoot, "scripts", "compress-portable.ps1"), "-Source", output, "-Destination", zipPath,
    ],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (archive.error || archive.status !== 0 || !existsSync(zipPath)) {
    throw new Error(`Portable ZIP konnte nicht erstellt werden: ${archive.stderr || archive.error?.message}`);
  }
  writeFileSync(checksumPath, `${sha256(zipPath)}  ${zipPath.split(/[\\/]/u).at(-1)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${zipPath}\n${checksumPath}\n`);
} else {
  process.stdout.write(`${output}\n`);
}
