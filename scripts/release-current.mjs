import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = "yadimon/steuer-spar-erklaerung-mcp";
const workflow = "npm-publish.yml";
const packageNames = [
  "@yadimon/steuer-spar-erklaerung-mcp",
  "@yadimon/steuer-spar-erklaerung-api",
];
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

if (process.argv.includes("--help")) {
  process.stdout.write(
    "Aufruf: npm run release:current\n\n" +
      "Prueft den bereits versionierten main-Stand, pusht ihn, erstellt Tag und GitHub-Prerelease, " +
      "startet Trusted Publishing und prueft danach die installierten Registry-Pakete.\n",
  );
  process.exit(0);
}
if (process.argv.length !== 2) throw new Error("release:current akzeptiert keine Argumente; --help zeigt den Vertrag.");
if (!existsSync(npmCli)) throw new Error(`npm CLI fehlt: ${npmCli}`);

function execute(command, args, { allowFailure = false, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} ${args.join(" ")} fehlgeschlagen${detail ? `: ${detail}` : "."}`);
  }
  return result;
}

const git = (args, options) => execute("git", args, options);
const gh = (args, options) => execute("gh", args, options);
const npm = (args, options) => execute(process.execPath, [npmCli, ...args], options);
const capture = (runner, args) => (runner(args, { capture: true }).stdout ?? "").trim();
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function registryVersion(packageName, version) {
  const result = npm(["view", `${packageName}@${version}`, "version", "--json"], {
    allowFailure: true,
    capture: true,
  });
  if (result.status === 0) return JSON.parse(result.stdout).toString();
  if (/E404|is not in this registry/iu.test(`${result.stderr}\n${result.stdout}`)) return undefined;
  throw new Error(`npm view fuer ${packageName}@${version} fehlgeschlagen: ${(result.stderr || result.stdout).trim()}`);
}

function registryTags(packageName) {
  const result = npm(["view", packageName, "dist-tags", "--json"], { allowFailure: true, capture: true });
  if (result.status !== 0) {
    if (/E404|is not in this registry/iu.test(`${result.stderr}\n${result.stdout}`)) return {};
    throw new Error(`npm dist-tags fuer ${packageName} konnten nicht gelesen werden.`);
  }
  return JSON.parse(result.stdout || "{}");
}

function registryPublicationState(version) {
  const versions = packageNames.map((packageName) => registryVersion(packageName, version));
  return { versions, published: versions.filter(Boolean).length };
}

function assertRegistryState(version, expectedPublished) {
  const { versions, published } = registryPublicationState(version);
  if (published !== 0 && published !== packageNames.length) {
    throw new Error(`Teilpublikation fuer ${version}: ${JSON.stringify(Object.fromEntries(packageNames.map((name, index) => [name, versions[index] ?? null])))}`);
  }
  if (expectedPublished && published !== packageNames.length) {
    throw new Error(`Trusted Publishing hat ${version} nicht vollstaendig in npm bereitgestellt.`);
  }
  return published === packageNames.length;
}

function assertNoLatestTags() {
  for (const packageName of packageNames) {
    const tags = registryTags(packageName);
    if (tags.latest) {
      throw new Error(
        `${packageName} besitzt noch den dist-tag latest=${tags.latest}. ` +
          `Beta-Releases erst nach 'npm dist-tag rm ${packageName} latest' fortsetzen.`,
      );
    }
  }
}

function tagCommit(tag) {
  const local = git(["rev-parse", "--verify", `${tag}^{commit}`], { allowFailure: true, capture: true });
  return local.status === 0 ? local.stdout.trim() : undefined;
}

function assertAnnotatedTag(tag) {
  const type = capture(git, ["cat-file", "-t", tag]);
  if (type !== "tag") throw new Error(`${tag} existiert, ist aber kein annotierter Tag.`);
}

function remoteTagCommit(tag) {
  const output = capture(git, ["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (!output) return undefined;
  const refs = new Map(output.split(/\r?\n/u).map((line) => {
    const [sha, ref] = line.trim().split(/\s+/u);
    return [ref, sha];
  }));
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
}

function releaseDetails(tag) {
  const result = gh([
    "release", "view", tag, "--repo", repository,
    "--json", "tagName,isDraft,isPrerelease,assets,url",
  ], { allowFailure: true, capture: true });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/release not found/iu.test(`${result.stderr}\n${result.stdout}`)) return undefined;
  throw new Error(`GitHub Release konnte nicht gelesen werden: ${(result.stderr || result.stdout).trim()}`);
}

function verifyPublishedAssets(tag) {
  const release = releaseDetails(tag);
  if (!release || release.isDraft || !release.isPrerelease || release.tagName !== tag) {
    throw new Error(`GitHub Release ${tag} ist nicht als vollstaendiger Prerelease sichtbar.`);
  }
  const expectedNames = ["steuer-spar-erklaerung.zip", "steuer-spar-erklaerung.zip.sha256"];
  const actualNames = release.assets.map((asset) => asset.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames.sort())) {
    throw new Error(`GitHub Release Assets weichen ab: ${actualNames.join(", ")}`);
  }

  const readbackRoot = mkdtempSync(join(tmpdir(), "sse-release-readback-"));
  try {
    gh(["release", "download", tag, "--repo", repository, "--dir", readbackRoot, "--pattern", "steuer-spar-erklaerung.zip*"]);
    const localZip = join(repoRoot, "artifacts", "portable", "steuer-spar-erklaerung.zip");
    const remoteZip = join(readbackRoot, "steuer-spar-erklaerung.zip");
    const remoteSidecar = join(readbackRoot, "steuer-spar-erklaerung.zip.sha256");
    const expectedHash = readFileSync(remoteSidecar, "utf8").trim().split(/\s+/u)[0].toLowerCase();
    if (sha256(localZip) !== sha256(remoteZip) || sha256(remoteZip) !== expectedHash) {
      throw new Error("Lokales ZIP, GitHub-Asset und Sidecar haben unterschiedliche SHA-256-Werte.");
    }
    if (statSync(localZip).size !== statSync(remoteZip).size) throw new Error("GitHub-ZIP hat eine andere Bytezahl.");
  } finally {
    rmSync(readbackRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  return release.url;
}

async function waitForWorkflow(headSha, startedAt) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const runs = JSON.parse(capture(gh, [
      "run", "list", "--repo", repository, "--workflow", workflow,
      "--event", "workflow_dispatch", "--limit", "20",
      "--json", "databaseId,headSha,createdAt,status,conclusion",
    ]) || "[]");
    const matching = runs.find((run) =>
      run.headSha === headSha && Date.parse(run.createdAt) >= startedAt - 30_000,
    );
    if (matching) return matching.databaseId;
    await wait(2_000);
  }
  throw new Error("Der gestartete npm-Publish-Workflow wurde nicht eindeutig gefunden.");
}

const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const version = rootPackage.version;
if (!/^0\.1\.0-beta\.\d+$/u.test(version)) throw new Error(`Unerwartete Release-Version: ${version}`);
for (const packagePath of [join(repoRoot, "packages", "api", "package.json"), join(repoRoot, "packages", "mcp", "package.json")]) {
  if (JSON.parse(readFileSync(packagePath, "utf8")).version !== version) throw new Error(`Paketversion weicht ab: ${packagePath}`);
}
const tag = `v${version}`;
const notes = join(repoRoot, "docs", "releases", `${tag}.md`);
if (!existsSync(notes)) throw new Error(`Release Notes fehlen: ${notes}`);
if (capture(git, ["branch", "--show-current"]) !== "main") throw new Error("release:current darf nur auf main laufen.");
if (capture(git, ["status", "--short"])) throw new Error("Der Worktree muss vor dem Release leer sein.");

git(["fetch", "origin", "--prune", "--tags"]);
const headSha = capture(git, ["rev-parse", "HEAD"]);
const ancestor = git(["merge-base", "--is-ancestor", "origin/main", headSha], { allowFailure: true, capture: true });
if (ancestor.status !== 0) throw new Error("origin/main ist kein Vorfahr von HEAD; zuerst synchronisieren.");
const localTagCommit = tagCommit(tag);
if (localTagCommit) {
  assertAnnotatedTag(tag);
  if (localTagCommit !== headSha) throw new Error(`${tag} zeigt lokal auf ${localTagCommit}, erwartet ${headSha}.`);
}
const existingRemoteTag = remoteTagCommit(tag);
if (existingRemoteTag && existingRemoteTag !== headSha) {
  throw new Error(`${tag} zeigt remote auf ${existingRemoteTag}, erwartet ${headSha}.`);
}
assertNoLatestTags();
const alreadyPublished = assertRegistryState(version, false);

npm(["run", "release:check"]);
if (capture(git, ["status", "--short"])) throw new Error("Release-Gates haben den getrackten Worktree veraendert.");
if (capture(git, ["rev-parse", "HEAD"]) !== headSha) throw new Error("HEAD hat sich waehrend der Release-Gates veraendert.");

git(["push", "origin", "HEAD:main"]);
if (!localTagCommit) git(["tag", "-a", tag, "-m", tag]);
if (!existingRemoteTag) git(["push", "origin", tag]);

if (!releaseDetails(tag)) {
  gh([
    "release", "create", tag, "--repo", repository, "--verify-tag", "--prerelease", "--title", tag,
    "--notes-file", notes,
    join(repoRoot, "artifacts", "portable", "steuer-spar-erklaerung.zip"),
    join(repoRoot, "artifacts", "portable", "steuer-spar-erklaerung.zip.sha256"),
  ]);
}
const releaseUrl = verifyPublishedAssets(tag);

if (!alreadyPublished) {
  const startedAt = Date.now();
  gh(["workflow", "run", workflow, "--repo", repository, "--ref", tag]);
  const runId = await waitForWorkflow(headSha, startedAt);
  gh(["run", "watch", String(runId), "--repo", repository, "--exit-status"]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (registryPublicationState(version).published === packageNames.length) break;
    await wait(2_000);
  }
  assertRegistryState(version, true);
}

for (const packageName of packageNames) {
  const tags = registryTags(packageName);
  if (tags.beta !== version || tags.latest) throw new Error(`Unerwartete dist-tags fuer ${packageName}: ${JSON.stringify(tags)}`);
}
npm(["run", "smoke:published"]);
process.stdout.write(`\nRelease ${tag} vollstaendig verifiziert: ${releaseUrl}\n`);
