import assert from "node:assert/strict";
import { z } from "zod";
import { SSE_API_RESULT_OUTPUT_SCHEMAS } from "../dist/result-contract.js";
import {
  isResultTypeTag,
  mergeFieldEvidence,
  mergeScopeEvidence,
  resultObjectTypeTag,
  resultTypeTag,
  samplesForResultTypeTag,
  samplesForResultTypeTagWithSchemaLiteral,
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
assert.deepEqual(
  samplesForResultTypeTagWithSchemaLiteral("string-other", z.literal("foreground-required").nullable().optional()),
  ["synthetic", "foreground-required"],
);
assert.deepEqual(
  samplesForResultTypeTagWithSchemaLiteral("string-other", z.literal("")),
  ["synthetic"],
  "Ein Literal darf nur den wertfreien Typ ergaenzen, dem sein Laufzeitwert entspricht.",
);
assert.deepEqual(
  samplesForResultTypeTagWithSchemaLiteral("string-other", z.string()),
  ["synthetic"],
  "Offene String-Schemas brauchen keine schemaabhaengigen Werte.",
);
const numericRecords = z.array(z.object({ count: z.number().int().nonnegative(), ms: z.number().nonnegative() }).strict())
  .max(16).nullable().optional();
for (const tag of ["array-one:object", "array-many:object"]) {
  const samples = samplesForResultTypeTagWithSchemaLiteral(tag, numericRecords);
  assert(samples.some(sample => numericRecords.safeParse(sample).success),
    "Numeric object arrays need a schema-compatible sample with the observed cardinality.");
  assert(samples.every(sample => resultTypeTag(sample) === tag), "Schema samples must preserve the observed type tag.");
}
assert(samplesForResultTypeTagWithSchemaLiteral("array-one:string-other", numericRecords)
  .every(sample => !numericRecords.safeParse(sample).success), "A schema cannot convert an incompatible observed element type.");
const rowDetails = SSE_API_RESULT_OUTPUT_SCHEMAS.table_read.shape.rowDetails;
for (const tag of ["array-one:object", "array-many:object"]) {
  const samples = samplesForResultTypeTagWithSchemaLiteral(tag, rowDetails);
  assert(samples.some(sample => rowDetails.safeParse(sample).success),
    "The live table's structured row details need a schema-compatible sample.");
  assert(samples.every(sample => resultTypeTag(sample) === tag));
}
const objectTag = resultObjectTypeTag({ path: "results:synthetic.png", w: 1, h: 2 });
assert.equal(objectTag, 'object:{"h":"nonnegative-number","path":"string-other","w":"nonnegative-number"}');
assert.equal(isResultTypeTag(objectTag), true);
assert.deepEqual(samplesForResultTypeTag(objectTag), [{ h: 0, path: "synthetic", w: 0 }]);
assert.equal(isResultTypeTag('object:{"private\\path":"string-other"}'), false);
assert.equal(resultTypeTag([1, 2]), "array-many:nonnegative-number");
assert.equal(resultTypeTag([-1, 2]), "array-many:finite-number");
assert.equal(resultTypeTag(["", "Wert"]), "array-many:string");
assert.equal(resultTypeTag(["Wert", { name: "Objekt" }]), "array-many:mixed");
assert.equal(resultTypeTag({ rows: [1, 2] }), 'object:{"rows":"array-many:nonnegative-number"}');
assert.deepEqual(samplesForResultTypeTag("unsupported"), []);

process.stdout.write("OK: Ergebnisform-Evidenz wird monoton und deterministisch zusammengefuehrt.\n");
