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
  "@yadimon/steuer-spar-erklaerung-api",
  "@yadimon/steuer-spar-erklaerung-mcp",
];
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

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
  if (!expectedPublished && published !== 0 && published !== packageNames.length) {
    process.stdout.write(
      `Teilpublikation fuer ${version} wird idempotent fortgesetzt: ` +
        `${JSON.stringify(Object.fromEntries(packageNames.map((name, index) => [name, versions[index] ?? null])))}\n`,
    );
  }
  if (expectedPublished && published !== packageNames.length) {
    throw new Error(`Trusted Publishing hat ${version} nicht vollstaendig in npm bereitgestellt.`);
  }
  return published === packageNames.length;
}

/**
 * Es gibt genau einen Kanal: `latest`. Der Publish-Workflow setzt ihn direkt
 * beim Veroeffentlichen, und genau das deckt Trusted Publishing ab. Dadurch
 * braucht kein Release einen zusaetzlichen dist-tag-Schritt und damit auch
 * keine Zweitanmeldung per Token oder Einmalcode.
 */
function reportDistTagState(version) {
  for (const packageName of packageNames) {
    const tags = registryTags(packageName);
    process.stdout.write(
      `${packageName}: latest=${tags.latest ?? "(keiner)"} -> wird beim Publish auf ${version} gesetzt.\n`,
    );
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
  // Das Release traegt bewusst keine Anhaenge mehr: installiert wird aus der
  // npm-Registry, deren Tarballs der Clean-Install-Smoke separat beweist.
  if (release.assets.length) {
    throw new Error(`GitHub Release soll keine Anhaenge tragen, gefunden: ${release.assets.map((a) => a.name).join(", ")}`);
  }
  return release.url;
}

/**
 * Verhindert, dass eine vorhandene, aber noch nicht freigegebene Notes-Datei
 * als GitHub-Release-Text verwendet wird. Die Pruefung ist absichtlich rein,
 * damit derselbe Vertrag im Metadaten-Test mit isolierten Fixtures laeuft.
 */
export function assertReleaseNotesReady(releaseNotes, version, releasePath = `v${version}.md`) {
  if (typeof releaseNotes !== "string" || !releaseNotes.trim()) {
    throw new Error(`Release Notes sind leer: ${releasePath}`);
  }
  if (!/^0\.1\.0-beta\.\d+$/u.test(version)) {
    throw new Error(`Unerwartete Notes-Version: ${version}`);
  }

  const firstLine = releaseNotes.split(/\r?\n/u, 1)[0];
  if (firstLine !== `# v${version}`) {
    throw new Error(`Release Notes muessen versionsgenau mit '# v${version}' beginnen: ${releasePath}`);
  }

  const lines = releaseNotes.split(/\r?\n/u);
  const draftLine = lines.find((line) =>
    /^\s*(?:>\s*)?(?:(?:\*\*|__)?(?:status\s*:\s*)?(?:entwurf|draft)\b|#{1,6}\s+.*\b(?:entwurf|draft)\b)/iu.test(line),
  );
  if (draftLine) {
    throw new Error(`Release Notes enthalten einen Entwurfsmarker: ${draftLine.trim()}`);
  }

  const placeholderLine = lines.find((line) =>
    /^\s*(?:[-*+]\s+)?\[\s\]\s+/u.test(line)
      || /(?:^|[^\p{L}\p{N}_])(?:TODO|TBD|FIXME|PLACEHOLDER)(?:$|[^\p{L}\p{N}_])/iu.test(line),
  );
  if (placeholderLine) {
    throw new Error(`Release Notes enthalten einen offenen Pflichtmarker: ${placeholderLine.trim()}`);
  }

  // Markdown-Zeilenumbrueche duerfen eine Bezeichnung wie "VM-Matrix" nicht
  // vor der Erkennung verstecken. Nur explizite offene Statusformulierungen
  // sperren; fachliche Begriffe wie "offener Steuerfall" bleiben erlaubt.
  const prose = releaseNotes
    .replace(/-\r?\n(?=\p{L})/gu, "")
    .replace(/\r?\n/gu, " ")
    .replace(/\s+/gu, " ");
  const openMatrix =
    /\b(?:pflicht|release|vm|verifikations|validierungs|evidenz)[-\s]*matrix\b.{0,180}\b(?:bleibt|ist|steht|weiterhin|noch|ausdruecklich|ausdrücklich)\b.{0,100}\b(?:offen|ausstehend|pending)\b/iu.test(prose)
    || /\b(?:offen|ausstehend|pending)\b.{0,180}\b(?:pflicht|release|vm|verifikations|validierungs|evidenz)[-\s]*matrix\b/iu.test(prose);
  if (openMatrix) {
    throw new Error(`Release Notes enthalten eine offene Pflichtmatrix: ${releasePath}`);
  }

  let inRequiredSection = false;
  for (const line of lines) {
    const heading = line.match(/^\s*#{2,6}\s+(.+)$/u);
    if (heading) {
      inRequiredSection = /\b(?:verifikation|validierung|evidenz|release[-\s]?gate|pflichtmatrix|release[-\s]?matrix|vm[-\s]?matrix)\b/iu.test(heading[1]);
      if (inRequiredSection && /\b(?:offen|ausstehend|pending|entwurf)\b/iu.test(heading[1])) {
        throw new Error(`Release Notes markieren einen Pflichtabschnitt als offen: ${line.trim()}`);
      }
      continue;
    }
    if (!inRequiredSection) continue;
    const unresolved =
      /\b(?:zusaetzlich|zusätzlich|noch|weiterhin|ausdruecklich|ausdrücklich)\s+(?:geplant(?:\s+und)?\s+)?(?:offen|ausstehend|pending)\b/iu.test(line)
      || /\b(?:offen|ausstehend|pending)\s+bis\b/iu.test(line)
      || /\bnicht\s+(?:belegt|bestanden|verifiziert|durchgefuehrt|durchgeführt|abgeschlossen)\b/iu.test(line)
      || /^\s*\|.*\|\s*(?:offen|ausstehend|geplant|pending|nicht (?:belegt|bestanden|verifiziert|durchgefuehrt|durchgeführt|abgeschlossen))\s*\|\s*$/iu.test(line);
    if (unresolved) {
      throw new Error(`Release Notes enthalten einen offenen Pflichtstatus: ${line.trim()}`);
    }
  }
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

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Aufruf: npm run release:current\n\n" +
        "Prueft den bereits versionierten main-Stand, pusht ihn, erstellt Tag und GitHub-Prerelease, " +
        "startet Trusted Publishing und prueft danach die installierten Registry-Pakete.\n",
    );
    return;
  }
  if (process.argv.length !== 2) throw new Error("release:current akzeptiert keine Argumente; --help zeigt den Vertrag.");
  if (!existsSync(npmCli)) throw new Error(`npm CLI fehlt: ${npmCli}`);

  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const version = rootPackage.version;
  if (!/^0\.1\.0-beta\.\d+$/u.test(version)) throw new Error(`Unerwartete Release-Version: ${version}`);
  for (const packagePath of [join(repoRoot, "packages", "api", "package.json"), join(repoRoot, "packages", "mcp", "package.json")]) {
    if (JSON.parse(readFileSync(packagePath, "utf8")).version !== version) throw new Error(`Paketversion weicht ab: ${packagePath}`);
  }
  const tag = `v${version}`;
  const notes = join(repoRoot, "docs", "releases", `${tag}.md`);
  if (!existsSync(notes)) throw new Error(`Release Notes fehlen: ${notes}`);
  assertReleaseNotesReady(readFileSync(notes, "utf8"), version, notes);
  const security = readFileSync(join(repoRoot, "SECURITY.md"), "utf8");
  if (!security.includes(`\`${tag}\` ist die aktuelle öffentlich`) || security.includes(`bereitet \`${tag}\``)) {
    throw new Error(`SECURITY.md muss ${tag} vor dem Release als aktuelle öffentliche Version nennen.`);
  }
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
  reportDistTagState(version);
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
    if (tags.latest !== version) {
      throw new Error(
        `Trusted Publishing hat latest von ${packageName} nicht auf ${version} gesetzt: ${JSON.stringify(tags)}`,
      );
    }
    process.stdout.write(`${packageName}: latest zeigt auf ${version}.\n`);
  }
  npm(["run", "smoke:published"]);
  process.stdout.write(`\nRelease ${tag} vollstaendig verifiziert: ${releaseUrl}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
