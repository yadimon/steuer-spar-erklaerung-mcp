import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const workflowPath = ".github/workflows/windows-ci.yml";
assert(existsSync(workflowPath), "Windows-CI-Workflow fehlt.");

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

process.stdout.write(`GitHub Windows-CI: Node ${nodeVersion}, read-only, 5 Gates und gepinnte Actions bestanden\n`);
