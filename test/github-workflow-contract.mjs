import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const workflowPath = ".github/workflows/windows-ci.yml";
assert(existsSync(workflowPath), "Windows-CI-Workflow fehlt.");

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

assert.equal(nodeVersion, runtime.node.version, ".node-version und portable Runtime laufen auseinander.");
assert.equal(Number(nodeVersion.split(".")[0]), 22, "CI muss die freigegebene Node-22-Linie verwenden.");
assert.match(packageJson.engines.node, />=22/u, "package.json nennt Node 22 nicht als Mindestversion.");

assert.match(workflow, /^name: Windows CI$/mu);
for (const trigger of ["push:", "pull_request:", "workflow_dispatch:"]) {
  assert(workflow.includes(`  ${trigger}`), `CI-Trigger fehlt: ${trigger}`);
}
assert.match(workflow, /^permissions:\r?\n  contents: read$/mu, "CI braucht ausschließlich read-only Contents-Rechte.");
assert.match(workflow, /^    runs-on: windows-2022$/mu);
assert.match(workflow, /^    timeout-minutes: 20$/mu);

const pinnedActions = {
  "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
};
for (const [action, revision] of Object.entries(pinnedActions)) {
  assert(workflow.includes(`uses: ${action}@${revision}`), `${action} ist nicht auf den geprüften Commit gepinnt.`);
}
assert(!/uses:\s+[^\s]+@(v\d+|main|master)\b/u.test(workflow), "GitHub Action verwendet einen beweglichen Ref.");
assert.match(workflow, /node-version-file: '\.node-version'/u);
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
  "npm run package:portable",
  "npm run verify:portable-release",
  "git tag -a",
  "gh release create",
  "--verify-tag --prerelease",
  "gh release download",
  "npx skills add yadimon/steuer-spar-erklaerung-mcp --list",
]) {
  assert(releaseProcess.includes(required), `Release-Prozess verschweigt: ${required}`);
}
assert.match(releaseProcess, /Erst nach ausdrücklicher Freigabe/u);
assert.match(releaseProcess, /kein öffentliches Release/u);

process.stdout.write(`GitHub Windows-CI: Node ${nodeVersion}, read-only, 5 Gates und gepinnte Actions bestanden\n`);
