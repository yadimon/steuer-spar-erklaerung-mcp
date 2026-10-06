import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { apiOperationDiscovery, SSE_API_DISCOVERY } from "../dist/api-discovery.js";
import { SSE_CAPABILITIES } from "../dist/capabilities.js";
import { parseApiOperationArgs } from "../dist/operation-catalog.js";
import { SSE_API_RESULT_OUTPUT_SCHEMAS } from "../dist/result-contract.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

assert.equal(SSE_API_DISCOVERY.schemaVersion, 1);
assert.equal(SSE_API_DISCOVERY.safety.elsterAndSubmissionBlocked, true);
assert.equal(SSE_API_DISCOVERY.liveEvidence.affectsAvailability, false);
assert.equal(SSE_API_DISCOVERY.liveEvidence.operationStatus.vast_apply, "error-path-only");
assert.deepEqual(SSE_API_DISCOVERY.operations, SSE_API_OPERATIONS);
assert.deepEqual(Object.keys(SSE_API_DISCOVERY.argumentSchemas), SSE_API_OPERATIONS);
assert.equal(SSE_API_DISCOVERY.resultSchemaVersion, 1);
assert.deepEqual(Object.keys(SSE_API_DISCOVERY.resultSchemas), SSE_API_OPERATIONS);
assert.deepEqual(Object.keys(SSE_API_DISCOVERY.operationTraits), SSE_API_OPERATIONS);
assert(SSE_API_DISCOVERY.planning.fallbackStages.length >= 4);
assert.deepEqual(SSE_API_DISCOVERY.planning.selectors.preferred, ["aid", "rid", "name"]);
assert.equal(SSE_API_DISCOVERY.planning.click.genericToggleBlocked, true);
assert.equal(SSE_API_DISCOVERY.planning.dialogs.requiresWindowAndFingerprint, true);
assert.deepEqual(
  SSE_API_DISCOVERY.planning.concurrency.workerController,
  SSE_CAPABILITIES.concurrency.workerController,
  "Discovery muss die maschinenlesbare Worker-Controller-Semantik vollstaendig veroeffentlichen.",
);

let describedPropertyCount = 0;
function assertPropertyDescriptions(schema, path) {
  if (!schema || typeof schema !== "object") return;
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    describedPropertyCount += 1;
    assert.equal(
      typeof property.description === "string" && property.description.trim().length > 0,
      true,
      `${path}.${name}: Beschreibung fehlt.`,
    );
    assertPropertyDescriptions(property, `${path}.${name}`);
  }
  if (schema.items) assertPropertyDescriptions(schema.items, `${path}[]`);
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    for (const [index, child] of (schema[keyword] ?? []).entries()) {
      assertPropertyDescriptions(child, `${path}.${keyword}[${index}]`);
    }
  }
}

const resultEnvelope = SSE_API_DISCOVERY.definitions.OperationResultEnvelope;
assert.equal(resultEnvelope.properties.ok.type, "boolean");
assert.deepEqual(resultEnvelope.required, ["ok"]);
assertPropertyDescriptions(resultEnvelope, "OperationResultEnvelope");
const jsonValidator = new AjvJsonSchemaValidator();
const validTraversal = { ok: true, treeWalks: 1, treeWalkMs: 3,
  treeWalkDetail: [{ knoten: 87, grenze: 4000, ms: 1.25 }] };
const resultSamples = [
  [{ ok: true }, true], [validTraversal, true], [{}, false], [{ ok: "true" }, false],
  [{ ...validTraversal, treeWalks: 1.5 }, false], [{ ...validTraversal, treeWalkMs: -1 }, false],
  [{ ...validTraversal, treeWalkDetail: [{ knoten: 87, grenze: 4000, ms: "3" }] }, false],
  [{ ...validTraversal, treeWalkDetail: Array(17).fill(validTraversal.treeWalkDetail[0]) }, false],
];
for (const operation of SSE_API_OPERATIONS) {
  const schema = SSE_API_DISCOVERY.argumentSchemas[operation];
  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#", `${operation}: Draft-07-Marker fehlt.`);
  assert(
    schema.type || schema.anyOf || schema.oneOf || schema.allOf || schema.$ref,
    `${operation}: veroeffentlicht ein leeres Argument-Schema.`,
  );
  assertPropertyDescriptions(schema, operation);
  const resultSchema = SSE_API_DISCOVERY.resultSchemas[operation];
  assert.equal(resultSchema.$schema, "http://json-schema.org/draft-07/schema#", `${operation}: Result-Draft fehlt.`);
  assert.deepEqual(resultSchema.allOf, [{ $ref: "#/definitions/OperationResultEnvelope" }]);
  const expanded = { ...resultSchema,
    properties: { ...resultEnvelope.properties, ...resultSchema.properties },
    required: [...new Set([...resultEnvelope.required, ...(resultSchema.required ?? [])])],
  };
  delete expanded.allOf;
  assert.deepEqual(expanded, zodToJsonSchema(SSE_API_RESULT_OUTPUT_SCHEMAS[operation], {
    target: "jsonSchema7", $refStrategy: "none", effectStrategy: "input",
  }), `${operation}: Komprimierung aendert den vollstaendigen Ergebnisvertrag.`);
  const fullValidator = jsonValidator.getValidator({ ...SSE_API_DISCOVERY, $ref: `#/resultSchemas/${operation}` });
  const singleValidator = jsonValidator.getValidator(apiOperationDiscovery(operation).resultSchema);
  for (const [sample, expected] of resultSamples) {
    assert.equal(fullValidator(sample).valid, expected, `${operation}: Gesamt-Discovery verliert Validierung.`);
    assert.equal(singleValidator(sample).valid, expected, `${operation}: Einzel-Schema ist nicht eigenstaendig validierbar.`);
  }
  assertPropertyDescriptions(resultSchema, `Result_${operation}`);
  const traits = SSE_API_DISCOVERY.operationTraits[operation];
  assert.equal(typeof traits.readOnlyHint, "boolean", `${operation}: readOnlyHint fehlt.`);
  assert.equal(typeof traits.destructiveHint, "boolean", `${operation}: destructiveHint fehlt.`);
  assert.equal(traits.openWorldHint, false, `${operation}: API bleibt geschlossen.`);
}

assert.equal(SSE_API_DISCOVERY.argumentSchemas.snapshot.properties.maxNodes.maximum, 5_000);
assert.equal(SSE_API_DISCOVERY.argumentSchemas.table_read.properties.maxRows.maximum, 1_000);
assert.equal(SSE_API_DISCOVERY.argumentSchemas.goto.properties.maxSteps.maximum, 200);
assert.equal(SSE_API_DISCOVERY.argumentSchemas.click.properties.waitMs.maximum, 10_000);
assert.equal(SSE_API_DISCOVERY.argumentSchemas.close.properties.pid.maximum, 2_147_483_647);
assert.equal(SSE_API_DISCOVERY.argumentSchemas.tracked_set_value.anyOf.length, 2);
assert.match(
  SSE_API_DISCOVERY.argumentSchemas.launch.properties.mode.description,
  /normal=Einkommensteuer.*\.ESt-Datei immer normal/u,
);
assert.match(
  SSE_API_DISCOVERY.argumentSchemas.workspace_file_write_text.properties.ref.description,
  /area='results'.*nicht 'results\/bericht\.md'/u,
);
assert.equal(SSE_API_DISCOVERY.operationTraits.health.readOnlyHint, true);
assert.equal(SSE_API_DISCOVERY.operationTraits.workspace_file_write_text.destructiveHint, false);
assert.equal(SSE_API_DISCOVERY.operationTraits.collect.destructiveHint, false);
assert.equal(SSE_API_DISCOVERY.operationTraits.keys, undefined);

const singleFind = apiOperationDiscovery("find");
assert.equal(singleFind.operation, "find");
assert.deepEqual(singleFind.argumentSchema, SSE_API_DISCOVERY.argumentSchemas.find);
assert.equal(singleFind.resultSchemaVersion, SSE_API_DISCOVERY.resultSchemaVersion);
const { definitions: singleDefinitions, ...singleSchema } = singleFind.resultSchema;
assert.deepEqual(singleSchema, SSE_API_DISCOVERY.resultSchemas.find);
assert.deepEqual(singleDefinitions, SSE_API_DISCOVERY.definitions);
assert.notEqual(singleDefinitions.OperationResultEnvelope, resultEnvelope,
  "Einzel-Discovery darf die gemeinsame Definition nicht mutierbar teilen.");
assert.deepEqual(singleFind.operationTraits, SSE_API_DISCOVERY.operationTraits.find);
assert.deepEqual(singleFind.planning, SSE_API_DISCOVERY.planning);
assert.deepEqual(singleFind.liveEvidence, SSE_API_DISCOVERY.liveEvidence);
assert(Buffer.byteLength(JSON.stringify(singleFind), "utf8") < 16 * 1024);

const emptyObjectOperations = SSE_API_OPERATIONS.filter((operation) => {
  try {
    parseApiOperationArgs(operation, {});
    return true;
  } catch {
    return false;
  }
});
for (const operation of emptyObjectOperations) {
  const schema = SSE_API_DISCOVERY.argumentSchemas[operation];
  assert(!schema.required?.length, `${operation}: Runtime akzeptiert {}, Discovery markiert aber Pflichtfelder.`);
}

const serialized = JSON.stringify(SSE_API_DISCOVERY);
// Einschliesslich typisierter Tabellenzellen braucht die Discovery rund
// 299 KiB. Die Reserve deckt kleinere Beschreibungen ab;
// zweistellige KiB-Zuwaechse durch duplizierte Schemas bleiben ein Fehler.
assert(Buffer.byteLength(serialized, "utf8") < 300 * 1024, "Discovery-Antwort ist unnoetig gross.");
assert(!serialized.includes("C:\\development"), "Discovery darf keine Build-PC-Pfade enthalten.");
assert(!serialized.includes("private-tax"), "Discovery darf keine Test- oder Steuerdaten enthalten.");

process.stdout.write(
  `API-Discovery: ${SSE_API_OPERATIONS.length} JSON-Schemas, ${describedPropertyCount} beschriebene Felder, Traits und harte Grenzen vollstaendig (${Buffer.byteLength(serialized, "utf8")} Bytes)\n`,
);
