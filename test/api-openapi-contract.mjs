import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { SSE_API_OPERATIONS, SSE_API_VERSION } from "../dist/api-contract.js";
import { SSE_API_DISCOVERY } from "../dist/api-discovery.js";
import { SSE_OPENAPI_DOCUMENT } from "../dist/api-openapi.js";

assert.equal(SSE_OPENAPI_DOCUMENT.openapi, "3.1.0");
assert.deepEqual(SSE_OPENAPI_DOCUMENT.security, [{ bearerAuth: [] }]);
assert.equal(SSE_OPENAPI_DOCUMENT.components.securitySchemes.bearerAuth.scheme, "bearer");
assert.equal(SSE_OPENAPI_DOCUMENT.info.description.includes("ELSTER"), true);
assert.equal(Object.keys(SSE_OPENAPI_DOCUMENT.paths).length, SSE_API_OPERATIONS.length + 3);
assert.deepEqual(SSE_OPENAPI_DOCUMENT.paths["/healthz"].get.security, []);
assert.equal(SSE_OPENAPI_DOCUMENT.paths["/healthz"].get.operationId, "healthz");
assert.equal(SSE_OPENAPI_DOCUMENT.paths[`/${SSE_API_VERSION}/operations`].get.operationId, "list_operations");
assert.equal(SSE_OPENAPI_DOCUMENT.paths[`/${SSE_API_VERSION}/openapi.json`].get.operationId, "get_openapi");
assert.equal(SSE_OPENAPI_DOCUMENT.paths[`/${SSE_API_VERSION}/operations`].get.security, undefined);

for (const operation of SSE_API_OPERATIONS) {
  const path = `/${SSE_API_VERSION}/operations/${operation}`;
  const post = SSE_OPENAPI_DOCUMENT.paths[path]?.post;
  const get = SSE_OPENAPI_DOCUMENT.paths[path]?.get;
  assert(post, `${operation}: OpenAPI-Pfad fehlt.`);
  assert(get, `${operation}: Einzel-Discovery fehlt.`);
  assert.equal(get.operationId, `describe_${operation}`);
  assert(get.responses["200"] && get.responses["401"] && get.responses["404"]);
  assert.equal(post.operationId, operation);
  assert.equal(post.security, undefined, `${operation}: globale Bearer-Sicherheit darf nicht ueberschrieben werden.`);
  assert.equal(post["x-sse-read-only"], SSE_API_DISCOVERY.operationTraits[operation].readOnlyHint);
  assert.equal(post["x-sse-destructive"], SSE_API_DISCOVERY.operationTraits[operation].destructiveHint);
  assert.equal(
    post.requestBody.content["application/json"].schema.properties.args.$ref,
    `#/components/schemas/Args_${operation}`,
  );
  assert.equal(SSE_OPENAPI_DOCUMENT.components.schemas[`Args_${operation}`], SSE_API_DISCOVERY.argumentSchemas[operation]);
  assert.equal(
    SSE_OPENAPI_DOCUMENT.components.schemas[`Result_${operation}`].description,
    SSE_API_DISCOVERY.resultSchemas[operation].description,
  );
  const responseSchema = post.responses["200"].content["application/json"].schema;
  assert.equal(responseSchema.allOf[0].$ref, "#/components/schemas/OperationEnvelope");
  assert.equal(responseSchema.allOf[1].properties.operation.const, operation);
  assert.equal(responseSchema.allOf[1].properties.result.$ref, `#/components/schemas/Result_${operation}`);
  assert(post.responses["200"] && post.responses["400"] && post.responses["405"] && post.responses["502"]);
}

for (const field of ["ok", "kind", "error", "ms"]) {
  assert(!Object.hasOwn(SSE_OPENAPI_DOCUMENT.components.schemas.Result_health.properties, field),
    `Result_health darf den gemeinsamen Transportwert '${field}' nicht erneut inline duplizieren.`);
}
assert.equal(SSE_OPENAPI_DOCUMENT.components.schemas.Result_health.allOf[0].$ref,
  "#/components/schemas/OperationResultEnvelope");
assert.equal(SSE_OPENAPI_DOCUMENT.components.schemas.OperationResultEnvelope.properties.ok.$ref,
  "#/components/schemas/ResultOk");
assert.deepEqual(SSE_OPENAPI_DOCUMENT.components.schemas.OperationResultEnvelope.required, ["ok"]);
assert.equal(SSE_OPENAPI_DOCUMENT.components.schemas.Result_toggle.properties.verified.$ref,
  "#/components/schemas/OptionalFlag");
assert.notEqual(
  SSE_OPENAPI_DOCUMENT.components.schemas.Result_toggle.properties.verified,
  SSE_OPENAPI_DOCUMENT.components.schemas.Result_save.properties.verified,
  "Result-Schemas duerfen auch ihre kompakten Referenzobjekte nicht gemeinsam mutierbar teilen.",
);
assert.deepEqual(SSE_OPENAPI_DOCUMENT.components.schemas.ResultOk, SSE_API_DISCOVERY.resultSchemas.health.properties.ok);
assert.notEqual(SSE_OPENAPI_DOCUMENT.components.schemas.ResultOk, SSE_API_DISCOVERY.resultSchemas.health.properties.ok,
  "OpenAPI-Komponenten duerfen die Discovery-Objekte nicht per Referenz teilen.");

const commonResultComponentNames = [
  "ResultOk", "ResultKind", "ResultError", "ResultWorkerMs", "OptionalText", "OptionalFlag",
  "OptionalObject", "OptionalArray", "OptionalNonNegativeNumber", "OptionalSha256",
  "OptionalStringList", "OptionalTransmissionState",
];
assert.equal(new Set(commonResultComponentNames.map((name) =>
  JSON.stringify(SSE_OPENAPI_DOCUMENT.components.schemas[name]))).size, commonResultComponentNames.length,
"Gemeinsame OpenAPI-Resultbausteine muessen paarweise verschieden sein.");

assert.equal(SSE_OPENAPI_DOCUMENT.paths[`/${SSE_API_VERSION}/operations/keys`], undefined);
for (const operation of ["click_point", "vast_mapping_select"]) {
  assert.equal(SSE_OPENAPI_DOCUMENT.paths[`/${SSE_API_VERSION}/operations/${operation}`].post["x-sse-destructive"], true);
}
assert.equal(SSE_OPENAPI_DOCUMENT.paths[`/${SSE_API_VERSION}/operations/set_value`].post["x-sse-destructive"], false);
assert.equal(SSE_OPENAPI_DOCUMENT.components.schemas.Args_snapshot.properties.maxNodes.maximum, 5_000);
assert.equal(SSE_OPENAPI_DOCUMENT.components.schemas.Args_click.properties.waitMs.maximum, 10_000);
assert(
  SSE_OPENAPI_DOCUMENT.components.schemas.OperationDiscoveryDocument.required.includes("planning"),
  "Einzel-Discovery muss die generische Fallback-Leiter dokumentieren.",
);
assert.equal(
  SSE_OPENAPI_DOCUMENT.components.schemas.OperationDiscoveryDocument.properties.planning.$ref,
  "#/components/schemas/PlanningContract",
);
assert.deepEqual(
  SSE_OPENAPI_DOCUMENT.components.schemas.PlanningContract.properties.fallbackStages.items.properties.operations.items.enum,
  SSE_API_OPERATIONS,
);
assert.deepEqual(
  SSE_OPENAPI_DOCUMENT.components.schemas.PlanningContract.properties.dialogs.properties.allowedButtons.items.enum,
  SSE_API_DISCOVERY.planning.dialogs.allowedButtons,
);

const serialized = JSON.stringify(SSE_OPENAPI_DOCUMENT);
for (const name of commonResultComponentNames) {
  assert(serialized.includes(`\"$ref\":\"#/components/schemas/${name}\"`),
    `Gemeinsame OpenAPI-Komponente '${name}' wird von keinem Result-Schema referenziert.`);
}
// 88 operationsspezifische Result-Schemas mit den realen stabilen Worker-
// Feldern brauchen knapp 265 KiB; die enge Reserve faengt unbeabsichtigte
// Schema-Dopplung weiterhin ab.
assert(Buffer.byteLength(serialized, "utf8") < 272 * 1024, "OpenAPI-Dokument ist unnoetig gross.");
assert(!serialized.includes("C:\\development"));
assert(!serialized.includes("allowSend") && !serialized.includes("confirmSend"));

process.stdout.write(
  `OpenAPI 3.1: ${SSE_API_OPERATIONS.length} Operationen plus 3 Infrastrukturpfade und gemeinsame Schemas (${Buffer.byteLength(serialized, "utf8")} Bytes)\n`,
);
