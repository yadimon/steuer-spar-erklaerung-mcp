import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const artifactRoot = resolve(repoRoot, "artifacts", "portable");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

function requestedZip(args) {
  if (args.length === 0) return join(artifactRoot, "steuer-spar-erklaerung.zip");
  if (args.length !== 2 || args[0] !== "--zip" || !args[1]) {
    throw new Error("Aufruf: node scripts/verify-portable-release.mjs [--zip artifacts/portable/name.zip]");
  }
  return resolve(repoRoot, args[1]);
}

function assertOwnedArtifactPath(zipPath) {
  const artifactRelative = relative(artifactRoot, zipPath);
  if (
    !artifactRelative ||
    artifactRelative.startsWith("..") ||
    isAbsolute(artifactRelative) ||
    dirname(artifactRelative) !== "." ||
    !artifactRelative.endsWith(".zip")
  ) {
    throw new Error(`Release-ZIP muss eine direkte .zip-Datei unter ${artifactRoot} sein.`);
  }
  if (!existsSync(artifactRoot) || realpathSync(dirname(zipPath)) !== realpathSync(artifactRoot)) {
    throw new Error("Release-ZIP liegt nicht im realen portablen Artefaktordner.");
  }
}

function assertRegularFile(path, label, maximumBytes = Number.POSITIVE_INFINITY) {
  if (!existsSync(path)) throw new Error(`${label} fehlt: ${path}`);
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > maximumBytes) {
    throw new Error(`${label} ist keine gueltige regulaere Datei.`);
  }
  return info;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyRelease() {
  const zipPath = requestedZip(process.argv.slice(2));
  assertOwnedArtifactPath(zipPath);
  const checksumPath = `${zipPath}.sha256`;
  const zipInfo = assertRegularFile(zipPath, "Release-ZIP");
  assertRegularFile(checksumPath, "SHA-256-Sidecar", 256);

  const actualSha256 = await sha256File(zipPath);
  const checksumBytes = readFileSync(checksumPath);
  let declaredChecksum;
  try {
    declaredChecksum = new TextDecoder("utf-8", { fatal: true }).decode(checksumBytes);
  } catch {
    throw new Error("SHA-256-Sidecar ist kein gueltiges UTF-8.");
  }
  const expectedChecksum = `${actualSha256}  ${basename(zipPath)}\n`;
  if (declaredChecksum !== expectedChecksum) {
    throw new Error("SHA-256-Sidecar stimmt nicht exakt mit Inhalt und Dateiname des Release-ZIPs ueberein.");
  }

  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  assertRegularFile(powershell, "Windows PowerShell");
  const rootName = basename(zipPath, ".zip");
  const verification = spawnSync(
    powershell,
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      join(repoRoot, "scripts", "verify-portable-archive.ps1"),
      "-ZipPath", zipPath,
      "-ExpectedRootName", rootName,
      "-ExpectedProduct", packageJson.name,
      "-ExpectedVersion", packageJson.version,
    ],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  let archiveSummary;
  try {
    archiveSummary = JSON.parse(verification.stdout?.trim() ?? "");
  } catch {
    archiveSummary = null;
  }
  if (
    verification.error ||
    verification.status !== 0 ||
    archiveSummary?.ok !== true ||
    archiveSummary.product !== packageJson.name ||
    archiveSummary.productVersion !== packageJson.version
  ) {
    throw new Error(
      `Interne ZIP-Pruefung scheiterte: ${verification.stderr?.trim() || verification.error?.message || "ungueltige Pruefausgabe"}`,
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    product: archiveSummary.product,
    productVersion: archiveSummary.productVersion,
    files: archiveSummary.files,
    zipBytes: zipInfo.size,
    sha256: actualSha256,
  })}\n`);
}

try {
  await verifyRelease();
} catch (error) {
  process.stderr.write(`Release-Artefakt ungueltig: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
