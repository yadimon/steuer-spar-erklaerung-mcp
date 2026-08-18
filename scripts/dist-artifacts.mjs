import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const PRODUCT = "steuer-spar-erklaerung-mcp";

function artifactRoots(repoRoot) {
  const root = realpathSync(resolve(repoRoot));
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== PRODUCT) {
    throw new Error(`dist-Pruning verweigert: package.json gehoert nicht zu ${PRODUCT}.`);
  }
  const srcRoot = join(root, "src");
  const distRoot = join(root, "dist");
  if (!existsSync(srcRoot) || !lstatSync(srcRoot).isDirectory() || lstatSync(srcRoot).isSymbolicLink()) {
    throw new Error("dist-Pruning verweigert: src ist kein regulaeres Quellverzeichnis.");
  }
  if (existsSync(distRoot) && (!lstatSync(distRoot).isDirectory() || lstatSync(distRoot).isSymbolicLink())) {
    throw new Error("dist-Pruning verweigert: dist ist kein regulaeres Buildverzeichnis.");
  }
  return { root, srcRoot, distRoot };
}

function collectFiles(root, current = root) {
  if (!existsSync(current)) return [];
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`dist enthaelt einen symbolischen Link und wird nicht bereinigt: ${path}`);
    }
    if (stats.isDirectory()) return collectFiles(root, path);
    if (!stats.isFile()) throw new Error(`dist enthaelt keinen regulaeren Dateieintrag: ${path}`);
    const local = relative(root, path);
    if (!local || local.startsWith("..") || isAbsolute(local)) {
      throw new Error(`dist-Artefakt liegt ausserhalb des Buildverzeichnisses: ${path}`);
    }
    return [{ path, local: local.replaceAll("\\", "/") }];
  });
}

function sourceForArtifact(srcRoot, local) {
  if (!/.+\.js(?:\.map)?$/u.test(local)) return null;
  return join(srcRoot, ...local.replace(/\.js(?:\.map)?$/u, ".ts").split("/"));
}

export function inspectDistArtifacts(repoRoot) {
  const { srcRoot, distRoot } = artifactRoots(repoRoot);
  const stale = [];
  const unknown = [];
  for (const artifact of collectFiles(distRoot)) {
    const source = sourceForArtifact(srcRoot, artifact.local);
    if (!source) {
      unknown.push(artifact);
      continue;
    }
    if (
      !existsSync(source) ||
      !lstatSync(source).isFile() ||
      lstatSync(source).isSymbolicLink()
    ) {
      stale.push(artifact);
    }
  }
  return { stale, unknown };
}

function formatArtifacts(entries) {
  return entries.map((entry) => entry.local).sort().join(", ");
}

export function assertDistArtifacts(repoRoot) {
  const inspection = inspectDistArtifacts(repoRoot);
  if (inspection.unknown.length) {
    throw new Error(`dist enthaelt unbekannte Nicht-Compilerdateien: ${formatArtifacts(inspection.unknown)}`);
  }
  if (inspection.stale.length) {
    throw new Error(`dist enthaelt Build-Artefakte ohne TypeScript-Quelle: ${formatArtifacts(inspection.stale)}`);
  }
}

export function pruneStaleDistArtifacts(repoRoot) {
  const { distRoot } = artifactRoots(repoRoot);
  const inspection = inspectDistArtifacts(repoRoot);
  if (inspection.unknown.length) {
    throw new Error(
      `dist enthaelt unbekannte Dateien; nichts wird geloescht: ${formatArtifacts(inspection.unknown)}`,
    );
  }
  for (const artifact of inspection.stale) unlinkSync(artifact.path);

  const candidateDirectories = [...new Set(inspection.stale.map((artifact) => dirname(artifact.path)))]
    .sort((left, right) => right.length - left.length);
  for (const directory of candidateDirectories) {
    let current = directory;
    while (current !== distRoot && existsSync(current) && readdirSync(current).length === 0) {
      rmdirSync(current);
      current = dirname(current);
    }
  }
  return inspection.stale.map((artifact) => artifact.local).sort();
}
