import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const workflowPath = ".github/workflows/windows-ci.yml";
assert(existsSync(workflowPath), "Windows-CI-Workflow fehlt.");
const publishWorkflowPath = ".github/workflows/npm-publish.yml";
assert(existsSync(publishWorkflowPath), "npm-Publish-Workflow fehlt.");

const publicProcessFiles = [
  "CONTRIBUTING.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/fehler.yml",
  "docs/RELEASE.md",
];
for (const path of publicProcessFiles) {
  assert(existsSync(path), `Öffentlicher Contributor-/Release-Vertrag fehlt: ${path}`);
}

const workflow = readFileSync(workflowPath, "utf8");
const nodeVersion = readFileSync(".node-version", "utf8").trim();
const runtime = JSON.parse(readFileSync("portable/runtime.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const releaseCheckPath = "scripts/release-check.mjs";
const releaseCurrentPath = "scripts/release-current.mjs";
assert(existsSync(releaseCheckPath), "Lokaler Release-Check fehlt.");
assert(existsSync(releaseCurrentPath), "Lokaler Release-Orchestrator fehlt.");
const releaseCheck = readFileSync(releaseCheckPath, "utf8");
const releaseCurrent = readFileSync(releaseCurrentPath, "utf8");

assert.equal(nodeVersion, runtime.node.version, ".node-version und portable Runtime laufen auseinander.");
assert.equal(Number(nodeVersion.split(".")[0]), 22, "CI muss die freigegebene Node-22-Linie verwenden.");
assert.match(packageJson.engines.node, />=22/u, "package.json nennt Node 22 nicht als Mindestversion.");
assert.equal(packageJson.scripts.check, "node scripts/release-check.mjs");
assert.equal(packageJson.scripts["release:check"], "node scripts/release-check.mjs");
assert.equal(packageJson.scripts["release:current"], "node scripts/release-current.mjs");
assert.equal(packageJson.scripts["smoke:published"], "node test/npm-clean-install.mjs --published");

for (const required of [
  '["audit", "--omit=dev", "--audit-level=high"]',
  '["test"]',
  '["run", "test:product"]',
  '["run", "package:portable"]',
  '["run", "verify:portable-release"]',
  '["run", "pack"]',
  '["run", "publish:dry-run"]',
  '["run", "test:npm-clean-install"]',
]) {
  assert(releaseCheck.includes(required), `release:check verschweigt Gate: ${required}`);
}
assert.match(
  releaseCheck,
  /SSE_TEST_CONCURRENCY:\s*configuredConcurrency \|\| "4"/u,
  "release:check muss ohne explizites Override eine konservative Parallelitaet verwenden.",
);
assert.match(releaseCheck, /env:\s*releaseEnvironment/u, "Release-Kindprozesse muessen die begrenzte Umgebung erben.");
for (const required of [
  'capture(git, ["status", "--short"])',
  '["fetch", "origin", "--prune", "--tags"]',
  '["merge-base", "--is-ancestor", "origin/main", headSha]',
  "assertAnnotatedTag(tag)",
  "assertBetaTagPolicy(version)",
  "tags.latest === version",
  'npm(["run", "release:check"])',
  '"--verify-tag", "--prerelease"',
  '"workflow", "run", workflow',
  'gh(["run", "watch"',
  'npm(["run", "smoke:published"])',
]) {
  assert(releaseCurrent.includes(required), `release:current verschweigt Grenze: ${required}`);
}
assert(!/npm\(\["publish"/u.test(releaseCurrent), "release:current darf npm nicht lokal mit Langzeittoken publizieren.");

assert.match(workflow, /^name: Windows CI$/mu);
for (const trigger of ["push:", "pull_request:", "workflow_dispatch:"]) {
  assert(workflow.includes(`  ${trigger}`), `CI-Trigger fehlt: ${trigger}`);
}
assert.match(workflow, /^permissions:\r?\n  contents: read$/mu, "CI braucht ausschließlich read-only Contents-Rechte.");
assert.match(workflow, /^    runs-on: windows-2022$/mu);
assert.match(workflow, /^    timeout-minutes: 20$/mu);

const pinnedActions = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-artifact": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
};
for (const [action, revision] of Object.entries(pinnedActions)) {
  assert(workflow.includes(`uses: ${action}@${revision}`), `${action} ist nicht auf den geprüften Commit gepinnt.`);
}
assert(!/uses:\s+[^\s]+@(v\d+|main|master)\b/u.test(workflow), "GitHub Action verwendet einen beweglichen Ref.");
assert.match(workflow, /node-version-file: '\.node-version'/u);
assert.match(workflow, /fetch-depth: 0/u, "Privacy-Gate braucht die vollständige Git-Historie.");
assert.match(workflow, /persist-credentials: false/u, "Checkout darf das GitHub-Token nicht im Repository belassen.");

const commands = [
  "npm ci --ignore-scripts",
  "npm audit --omit=dev --audit-level=high",
  "npm test",
  "npm run package:portable",
  "npm run verify:portable-release",
];
let previous = -1;
for (const command of commands) {
  const index = workflow.indexOf(`run: ${command}`);
  assert(index > previous, `CI-Befehl fehlt oder steht in falscher Reihenfolge: ${command}`);
  previous = index;
}
for (const artifact of [
  "artifacts/portable/steuer-spar-erklaerung.zip",
  "artifacts/portable/steuer-spar-erklaerung.zip.sha256",
]) {
  assert(workflow.includes(artifact), `CI-Artefakt fehlt: ${artifact}`);
}
assert.match(workflow, /if-no-files-found: error/u);
assert.match(workflow, /retention-days: 7/u);
assert(!/(?:gh\s+release|create-release|softprops|contents:\s*write|secrets\.)/iu.test(workflow),
  "CI darf weder veröffentlichen noch Schreibrechte oder Secrets verwenden.");

const publishWorkflow = readFileSync(publishWorkflowPath, "utf8");
assert.match(publishWorkflow, /^name: Publish npm beta$/mu);
assert.match(publishWorkflow, /^  workflow_dispatch:$/mu, "npm-Publish muss bewusst manuell gestartet werden.");
assert(!/^  push:$/mu.test(publishWorkflow), "npm-Publish darf nicht automatisch auf einen Tag-Push reagieren.");
assert.match(
  publishWorkflow,
  /^permissions:\r?\n  contents: read\r?\n  id-token: write$/mu,
  "npm-Publish braucht nur Contents-Leserechte und OIDC.",
);
assert.match(publishWorkflow, /^    runs-on: windows-2022$/mu);
assert.match(publishWorkflow, /^    timeout-minutes: 25$/mu);
assert(!/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/iu.test(publishWorkflow), "Trusted Publishing darf kein npm-Token verwenden.");
for (const [action, revision] of Object.entries({
  "actions/checkout": pinnedActions["actions/checkout"],
  "actions/setup-node": pinnedActions["actions/setup-node"],
})) {
  assert(publishWorkflow.includes(`uses: ${action}@${revision}`), `${action} ist im npm-Publish nicht geprueft gepinnt.`);
}
assert(!/uses:\s+[^\s]+@(v\d+|main|master)\b/u.test(publishWorkflow), "npm-Publish verwendet einen beweglichen Action-Ref.");
assert.match(publishWorkflow, /node-version-file: '\.node-version'/u);
assert.match(publishWorkflow, /registry-url: 'https:\/\/registry\.npmjs\.org'/u);
assert.match(publishWorkflow, /npm install --global npm@11\.19\.0/u);
assert.match(publishWorkflow, /refs\/tags\/v/u, "npm-Publish muss Tag und Paketversion binden.");
const publishCommands = [
  "npm ci --ignore-scripts",
  "npm audit --omit=dev --audit-level=high",
  "npm test",
  "npm run test:npm-clean-install",
  "npm publish --workspace @yadimon/steuer-spar-erklaerung-mcp --ignore-scripts --tag beta --access public",
  "npm publish --workspace @yadimon/steuer-spar-erklaerung-api --ignore-scripts --tag beta --access public",
];
let previousPublish = -1;
for (const command of publishCommands) {
  const index = publishWorkflow.indexOf(`run: ${command}`);
  assert(index > previousPublish, `npm-Publish-Befehl fehlt oder steht in falscher Reihenfolge: ${command}`);
  previousPublish = index;
}

const contributing = readFileSync("CONTRIBUTING.md", "utf8");
for (const required of [
  "npm ci --ignore-scripts",
  "npm run test:fast",
  "npm test",
  "npm run test:live",
  "Conventional Commits",
  "SSE_WRITE_OPERATION_COVERAGE",
  "SSE_WRITE_OPERATION_SHAPE",
  "Niemals echte Steuerdaten einreichen",
]) {
  assert(contributing.includes(required), `CONTRIBUTING.md verschweigt: ${required}`);
}

const pullRequestTemplate = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
assert.match(pullRequestTemplate, /Keine echten Steuerfälle/u);
assert.match(pullRequestTemplate, /npm run test:fast/u);
assert.match(pullRequestTemplate, /npm test/u);
assert.match(pullRequestTemplate, /Live-Evidenz/u);
assert.match(pullRequestTemplate, /Release-Auswirkung/u);

const issueConfig = readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf8");
assert.match(issueConfig, /^blank_issues_enabled: false$/mu);
assert.match(issueConfig, /security\/advisories\/new/u);
const bugTemplate = readFileSync(".github/ISSUE_TEMPLATE/fehler.yml", "utf8");
assert.match(bugTemplate, /keine echten Steuerfälle/u);
assert.match(bugTemplate, /required: true/u);
assert.match(bugTemplate, /Produktprofil und Build/u);
assert.match(bugTemplate, /Direkte HTTP-API oder CLI/u);

const releaseProcess = readFileSync("docs/RELEASE.md", "utf8");
for (const required of [
  "npm audit --omit=dev --audit-level=high",
  "npm test",
  "npm run test:product",
  "npm run package:portable",
  "npm run verify:portable-release",
  "git tag -a",
  "gh release create",
  "--verify-tag --prerelease",
  "gh release download",
  "npx skills add yadimon/steuer-spar-erklaerung-mcp --list",
  "npm publish --workspace @yadimon/steuer-spar-erklaerung-mcp --ignore-scripts --tag beta --access public",
  "npm publish --workspace @yadimon/steuer-spar-erklaerung-api --ignore-scripts --tag beta --access public",
  "npm-publish.yml",
]) {
  assert(releaseProcess.includes(required), `Release-Prozess verschweigt: ${required}`);
}
assert.match(releaseProcess, /Erst nach ausdrücklicher Freigabe/u);
assert.match(releaseProcess, /kein öffentliches Release/u);

process.stdout.write(`GitHub Windows-CI: Node ${nodeVersion}, read-only, 5 Gates und gepinnte Actions bestanden\n`);
