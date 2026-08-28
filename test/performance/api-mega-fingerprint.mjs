import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { arch, availableParallelism, cpus, platform, release, totalmem } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MEGA_REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function git(args) {
  return execFileSync("git", args, {
    cwd: MEGA_REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

export function megaSourceFingerprint() {
  const metadata = {
    head: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    branch: git(["branch", "--show-current"]),
    status: git(["status", "--porcelain=v1", "--untracked-files=all"]),
  };
  const identity = JSON.stringify(metadata);
  return { ...metadata, fingerprint: sha256(identity) };
}

function filesBelow(path) {
  if (!existsSync(path)) return [];
  const entries = readdirSync(path, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const candidate = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(candidate) : entry.isFile() ? [candidate] : [];
  });
}

export function megaRuntimeFingerprint() {
  const roots = ["dist", "powershell", "profiles"];
  const files = roots.flatMap((name) => filesBelow(join(MEGA_REPOSITORY_ROOT, name)))
    .concat([join(MEGA_REPOSITORY_ROOT, "package.json"), join(MEGA_REPOSITORY_ROOT, "package-lock.json")])
    .filter((path) => existsSync(path))
    .sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  const manifest = files.map((path) => {
    const ref = relative(MEGA_REPOSITORY_ROOT, path).replaceAll("\\", "/");
    const bytes = readFileSync(path);
    const fileHash = sha256(bytes);
    hash.update(ref).update("\0").update(fileHash).update("\n");
    return { ref, bytes: bytes.length, sha256: fileHash };
  });
  return { fingerprint: hash.digest("hex"), fileCount: manifest.length, manifest };
}

export function assertFreshMegaDist() {
  const sources = filesBelow(join(MEGA_REPOSITORY_ROOT, "src")).filter((path) => path.endsWith(".ts"));
  const stale = [];
  const missing = [];
  for (const source of sources) {
    const rel = relative(join(MEGA_REPOSITORY_ROOT, "src"), source).replace(/\.ts$/u, ".js");
    const artifact = join(MEGA_REPOSITORY_ROOT, "dist", rel);
    if (!existsSync(artifact)) {
      missing.push(rel);
      continue;
    }
    if (statSync(artifact).mtimeMs + 1 < statSync(source).mtimeMs) stale.push(rel);
  }
  if (missing.length || stale.length) {
    throw new Error(`dist passt nicht zum Arbeitsbaum (missing=${missing.join(",")}; stale=${stale.join(",")}).`);
  }
  return { sourceCount: sources.length, missing, stale };
}

export function megaMachineMetadata() {
  const cpu = cpus()[0];
  let npm = "unknown";
  try {
    const npmExecutable = platform() === "win32"
      ? (process.env.ComSpec ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"))
      : "npm";
    const npmArgs = platform() === "win32" ? ["/d", "/s", "/c", "npm.cmd --version"] : ["--version"];
    npm = execFileSync(npmExecutable, npmArgs, {
      cwd: MEGA_REPOSITORY_ROOT, encoding: "utf8", windowsHide: true,
    }).trim();
  } catch { /* reported as unknown */ }
  return {
    node: process.version,
    npm,
    v8: process.versions.v8,
    platform: platform(),
    release: release(),
    arch: arch(),
    executable: basename(process.execPath),
    cpuModel: cpu?.model?.trim() || "unknown",
    logicalCpuCount: cpus().length,
    availableParallelism: availableParallelism(),
    totalMemoryBytes: totalmem(),
  };
}
