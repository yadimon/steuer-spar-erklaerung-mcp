import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { SSE_CAPABILITIES } from "../dist/capabilities.js";
import {
  SSE_LIVE_EVIDENCE,
  SSE_LIVE_EVIDENCE_BASIS,
  SSE_LIVE_EVIDENCE_SCHEMA_VERSION,
  SSE_LIVE_EVIDENCE_SCOPE,
} from "../dist/operation-live-evidence.js";
import { parseApiOperationResult } from "../dist/result-contract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const coverage = JSON.parse(readFileSync(join(root, "test", "operation-coverage.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const releaseNotes = readFileSync(join(root, "docs", "releases", `v${packageJson.version}.md`), "utf8");
const recordedStatus = Object.fromEntries(SSE_API_OPERATIONS.map((operation) => [
  operation,
  coverage.operations?.[operation]?.live,
]));

assert.deepEqual(Object.keys(SSE_LIVE_EVIDENCE.operationStatus), [...SSE_API_OPERATIONS]);
const statusMismatches = SSE_API_OPERATIONS
  .filter((operation) => SSE_LIVE_EVIDENCE.operationStatus[operation] !== recordedStatus[operation])
  .map((operation) => ({
    operation,
    compiled: SSE_LIVE_EVIDENCE.operationStatus[operation],
    recorded: recordedStatus[operation],
  }));
assert.deepEqual(statusMismatches, [], "Kompilierte Live-Evidenz und erzeugte Operationsbilanz laufen auseinander.");
const functional = SSE_API_OPERATIONS.filter((operation) => recordedStatus[operation] === "functional");
const untested = SSE_API_OPERATIONS.filter((operation) => recordedStatus[operation] === "untested");
assert.equal(functional.length, SSE_LIVE_EVIDENCE.functionalCount);
const errorPathOnly = SSE_API_OPERATIONS.filter((operation) => recordedStatus[operation] === "error-path-only");
assert.equal(errorPathOnly.length, SSE_LIVE_EVIDENCE.errorPathOnlyCount);
assert.equal(untested.length, SSE_LIVE_EVIDENCE.untestedCount);
assert.deepEqual(untested, SSE_LIVE_EVIDENCE.untestedOperations);
assert.equal(
  SSE_LIVE_EVIDENCE.functionalCount + SSE_LIVE_EVIDENCE.errorPathOnlyCount + SSE_LIVE_EVIDENCE.untestedCount,
  SSE_API_OPERATIONS.length,
);
assert.equal(SSE_LIVE_EVIDENCE.schemaVersion, SSE_LIVE_EVIDENCE_SCHEMA_VERSION);
assert.equal(SSE_LIVE_EVIDENCE.basis, SSE_LIVE_EVIDENCE_BASIS);
assert.equal(SSE_LIVE_EVIDENCE.scope, SSE_LIVE_EVIDENCE_SCOPE);
assert.equal(SSE_LIVE_EVIDENCE.affectsAvailability, false);
assert.equal(SSE_LIVE_EVIDENCE.profileSpecific, false);
assert.deepEqual(SSE_CAPABILITIES.liveEvidence, SSE_LIVE_EVIDENCE);
assert.deepEqual(
  parseApiOperationResult("capabilities", { ok: true, ...SSE_CAPABILITIES }).liveEvidence,
  SSE_LIVE_EVIDENCE,
  "Der veroeffentlichte Result-Vertrag muss den echten Capabilities-Payload direkt akzeptieren.",
);
for (const operation of untested) {
  assert(releaseNotes.includes(`\`${operation}\``), `Release Notes verschweigen live ungetestete Operation '${operation}'.`);
}

process.stdout.write(
  `Live-Evidenz: ${functional.length} funktional, ${errorPathOnly.length} nur Fehlerpfad, ` +
  `${untested.length} ungetestet, informativ und coverage-synchron\n`,
);
