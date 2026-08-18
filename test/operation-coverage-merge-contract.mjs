import assert from "node:assert/strict";
import { COVERAGE_RANK, mergeCoverageLabels, retainHighestCoverageStatus } from "./operation-coverage-lib.mjs";

assert.deepEqual(COVERAGE_RANK, { untested: 0, "error-path-only": 1, functional: 2 });
assert.equal(retainHighestCoverageStatus("functional", "untested"), "functional");
assert.equal(retainHighestCoverageStatus("functional", "error-path-only"), "functional");
assert.equal(retainHighestCoverageStatus("error-path-only", "functional"), "functional");
assert.equal(retainHighestCoverageStatus(undefined, "error-path-only"), "error-path-only");
assert.throws(() => retainHighestCoverageStatus("unknown", "functional"), /Unbekannter bisheriger/u);
assert.throws(() => retainHighestCoverageStatus("functional", "unknown"), /Unbekannter beobachteter/u);
assert.deepEqual(mergeCoverageLabels(["worker", "stateful-mock"], ["worker", "scenario-mock"]),
  ["scenario-mock", "stateful-mock", "worker"]);
assert.throws(() => mergeCoverageLabels("worker", []), /müssen Listen/u);

process.stdout.write("OK: Teil-Live-Läufe können Coverage nur nachweisbar hochstufen.\n");
