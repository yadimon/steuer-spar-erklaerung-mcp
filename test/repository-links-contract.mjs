import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const excludedDirectories = new Set([
  ".git",
  ".private",
  ".tmp",
  ".vm-provisioning",
  "ai-learning",
  "artifacts",
  "backups",
  "cases",
  "dist",
  "documents",
  "node_modules",
  "results",
  "tmp",
  "workspace",
]);
const markdownFiles = [];

function collectMarkdown(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      collectMarkdown(join(path, entry.name));
    }
    return;
  }
  if (path.endsWith(".md")) markdownFiles.push(path);
}

collectMarkdown(".");
let localLinkCount = 0;
let anchorLinkCount = 0;
const anchorCache = new Map();

function githubHeadingSlug(heading) {
  return heading
    .toLocaleLowerCase("de-DE")
    .replace(/<[^>]*>/gu, "")
    .replace(/[`*_~]/gu, "")
    .replace(/[^\p{Letter}\p{Mark}\p{Number}\s_-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

function markdownAnchors(path) {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const anchors = new Set();
  const duplicateCounts = new Map();
  const markdown = readFileSync(path, "utf8");
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
    const base = githubHeadingSlug(match[1]);
    const duplicateIndex = duplicateCounts.get(base) ?? 0;
    duplicateCounts.set(base, duplicateIndex + 1);
    anchors.add(duplicateIndex === 0 ? base : `${base}-${duplicateIndex}`);
  }
  anchorCache.set(path, anchors);
  return anchors;
}

for (const markdownFile of markdownFiles.sort()) {
  const markdown = readFileSync(markdownFile, "utf8");
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const rawTarget = match[1].trim();
    if (/^(?:https?:|mailto:)/iu.test(rawTarget)) continue;
    const targetWithFragment = rawTarget.startsWith("<") && rawTarget.endsWith(">")
      ? rawTarget.slice(1, -1)
      : rawTarget.split(/\s+["']/u, 1)[0];
    const [encodedPath, encodedFragment] = targetWithFragment.split("#", 2);
    let relativePath;
    let fragment;
    try {
      relativePath = decodeURIComponent(encodedPath);
      fragment = encodedFragment === undefined ? undefined : decodeURIComponent(encodedFragment);
    } catch {
      assert.fail(`${markdownFile}: Link ist nicht gueltig URL-kodiert: ${rawTarget}`);
    }
    const absoluteTarget = relativePath
      ? resolve(dirname(markdownFile), relativePath)
      : resolve(markdownFile);
    assert(existsSync(absoluteTarget), `${markdownFile}: lokales Linkziel fehlt: ${rawTarget}`);
    if (fragment) {
      assert(
        markdownAnchors(absoluteTarget).has(fragment),
        `${markdownFile}: Markdown-Anker fehlt: ${rawTarget}`,
      );
      anchorLinkCount += 1;
    }
    localLinkCount += 1;
  }
}

assert(localLinkCount >= 10, "Zu wenige lokale Dokumentationslinks wurden geprueft.");
assert(anchorLinkCount >= 10, "Zu wenige Markdown-Anker wurden geprueft.");

const currentDocumentationPaths = [
  "README.md",
  "health-check.md",
  "docs/README.md",
  "docs/INSTALLATION.md",
  "docs/ARCHITEKTUR.md",
  "docs/API-MCP-VERTRAG.md",
  "docs/VERIFIKATION.md",
  "skills/steuer-spar-erklaerung/SKILL.md",
  "skills-data/healthcheck/skill-profile.md",
  "skills-data/project-quality-maintenance/skill-profile.md",
  "skills-data/project-quality-maintenance/forever-improve-loop.md",
];
const currentDocumentation = currentDocumentationPaths
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
for (const staleCounter of [/82\/121/u, /87\/93/u, /\b120 (?:Tests|Schritte)\b/iu]) {
  assert.doesNotMatch(currentDocumentation, staleCounter,
    `Aktuelle Dokumentation enthält einen eingefrorenen alten Zähler: ${staleCounter}`);
}
assert.match(readFileSync("health-check.md", "utf8"), /keine eingefrorenen Test- oder\s+Operationszahlen/iu,
  "Health Check muss Zähler aus Quellen ableiten statt einen alten Grünstand zu konservieren.");
assert.doesNotMatch(readFileSync("docs/RELEASE.md", "utf8"), /GitHub-Assets aus Abschnitt 5/u,
  "Release-Anleitung verweist auf den falschen Abschnitt.");
assert.match(readFileSync("docs/releases/v0.1.0-beta.31.md", "utf8"), /foreground-required-operation-disabled/u,
  "Aktuelle Release Notes müssen die öffentliche BelegManager-Sperre offenlegen.");
process.stdout.write(
  `Repository-Links: ${markdownFiles.length} Markdown-Dateien, ${localLinkCount} lokale Ziele und ${anchorLinkCount} Anker bestanden\n`,
);
