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
process.stdout.write(
  `Repository-Links: ${markdownFiles.length} Markdown-Dateien, ${localLinkCount} lokale Ziele und ${anchorLinkCount} Anker bestanden\n`,
);
