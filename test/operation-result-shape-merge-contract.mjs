import assert from "node:assert/strict";
import {
  isResultTypeTag,
  mergeFieldEvidence,
  mergeScopeEvidence,
  resultObjectTypeTag,
  resultTypeTag,
  samplesForResultTypeTag,
} from "./operation-result-shape-lib.mjs";

assert.deepEqual(
  mergeFieldEvidence(
    { types: ["string-other"], labels: ["worker"], outcomes: ["success"] },
    { types: ["null", "string-other"], labels: ["stateful-mock"], outcomes: ["error"] },
  ),
  {
    types: ["null", "string-other"],
    labels: ["stateful-mock", "worker"],
    outcomes: ["error", "success"],
  },
);
assert.deepEqual(
  mergeScopeEvidence(
    { profiles: ["2025"], fields: { verified: { types: ["boolean"], labels: ["worker"], outcomes: ["success"] } } },
    { profiles: ["2024"], fields: { rollback: { types: ["object"], labels: ["stateful-mock"], outcomes: ["error"] } } },
  ),
  {
    profiles: ["2024", "2025"],
    fields: {
      rollback: { types: ["object"], labels: ["stateful-mock"], outcomes: ["error"] },
      verified: { types: ["boolean"], labels: ["worker"], outcomes: ["success"] },
    },
  },
);
assert.deepEqual(samplesForResultTypeTag("negative-number"), [-1]);
assert.deepEqual(samplesForResultTypeTag("array-one:string-other"), [["synthetic"]]);
assert.deepEqual(samplesForResultTypeTag("array-many:object"), [[{ name: "synthetic" }, { name: "synthetic-2" }]]);
const objectTag = resultObjectTypeTag({ path: "results:synthetic.png", w: 1, h: 2 });
assert.equal(objectTag, 'object:{"h":"nonnegative-number","path":"string-other","w":"nonnegative-number"}');
assert.equal(isResultTypeTag(objectTag), true);
assert.deepEqual(samplesForResultTypeTag(objectTag), [{ h: 0, path: "synthetic", w: 0 }]);
assert.equal(isResultTypeTag('object:{"private\\path":"string-other"}'), false);
assert.equal(resultTypeTag([1, 2]), "array-many:nonnegative-number");
assert.equal(resultTypeTag({ rows: [1, 2] }), 'object:{"rows":"array-many:nonnegative-number"}');
assert.deepEqual(samplesForResultTypeTag("unsupported"), []);

process.stdout.write("OK: Ergebnisform-Evidenz wird monoton und deterministisch zusammengefuehrt.\n");
