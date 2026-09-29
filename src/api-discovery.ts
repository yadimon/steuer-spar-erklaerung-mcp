import { zodToJsonSchema, type JsonSchema7ObjectType, type JsonSchema7Type } from "zod-to-json-schema";
import { SSE_API_OPERATIONS, SSE_API_VERSION, type SseApiOperation } from "./api-contract.js";
import { SSE_CAPABILITIES } from "./capabilities.js";
import { SSE_API_OPERATION_SCHEMAS } from "./operation-catalog.js";
import { operationAnnotations } from "./operation-traits.js";
import {
  SSE_API_RESULT_COMMON_FIELDS, SSE_API_RESULT_ENVELOPE_SCHEMA,
  SSE_API_RESULT_OUTPUT_SCHEMAS, SSE_API_RESULT_SCHEMA_VERSION,
} from "./result-contract.js";
import { API_SHUTDOWN_REQUEST_SCHEMA, SSE_API_SHUTDOWN_PATH } from "./api-control-contract.js";

function createArgumentSchemas(): Readonly<Record<SseApiOperation, JsonSchema7Type>> {
  return Object.freeze(Object.fromEntries(
    SSE_API_OPERATIONS.map((operation) => [
      operation,
      zodToJsonSchema(SSE_API_OPERATION_SCHEMAS[operation], {
        target: "jsonSchema7",
        $refStrategy: "none",
        effectStrategy: "input",
      }),
    ]),
  ) as Record<SseApiOperation, JsonSchema7Type>);
}

function createOperationTraits(): Readonly<
  Record<SseApiOperation, ReturnType<typeof operationAnnotations>>
> {
  return Object.freeze(Object.fromEntries(
    SSE_API_OPERATIONS.map((operation) => [operation, Object.freeze(operationAnnotations(operation))]),
  ) as Record<SseApiOperation, ReturnType<typeof operationAnnotations>>);
}

const inlineResultSchemas = Object.fromEntries(SSE_API_OPERATIONS.map((operation) => [operation,
  zodToJsonSchema(SSE_API_RESULT_OUTPUT_SCHEMAS[operation], {
    target: "jsonSchema7", $refStrategy: "none", effectStrategy: "input",
  }) as JsonSchema7ObjectType,
])) as Record<SseApiOperation, JsonSchema7ObjectType>;
const commonResultEnvelope = zodToJsonSchema(SSE_API_RESULT_ENVELOPE_SCHEMA, {
  target: "jsonSchema7", $refStrategy: "none", effectStrategy: "input",
}) as JsonSchema7ObjectType;
// Einige Operationen besitzen einen eigenen 'kind'-Vertrag. Nur exakt
// identische Blattvertraege duerfen in den gemeinsamen Umschlag wandern.
const commonFields = new Set(Object.keys(SSE_API_RESULT_COMMON_FIELDS).filter((field) =>
  SSE_API_OPERATIONS.every((operation) => JSON.stringify(inlineResultSchemas[operation].properties[field])
    === JSON.stringify(commonResultEnvelope.properties[field]))));
commonResultEnvelope.properties = Object.fromEntries(Object.entries(commonResultEnvelope.properties)
  .filter(([field]) => commonFields.has(field)));
const resultDefinitions = Object.freeze({ OperationResultEnvelope: commonResultEnvelope });

function createResultSchemas(): Readonly<Record<SseApiOperation, JsonSchema7Type>> {
  return Object.freeze(Object.fromEntries(
    SSE_API_OPERATIONS.map((operation): [SseApiOperation, JsonSchema7Type] => {
      const schema = inlineResultSchemas[operation];
      const required = schema.required?.filter((field) => !commonFields.has(field));
      const compactSchema: JsonSchema7ObjectType & { allOf: { $ref: string }[] } = {
        ...schema,
        properties: Object.fromEntries(Object.entries(schema.properties).filter(([field]) => !commonFields.has(field))),
        allOf: [{ $ref: "#/definitions/OperationResultEnvelope" }],
      };
      if (required?.length) compactSchema.required = required;
      else delete compactSchema.required;
      return [operation, compactSchema];
    }),
  ) as Record<SseApiOperation, JsonSchema7Type>);
}

/**
 * Authentifizierte, PC-unabhaengige Laufzeitbeschreibung fuer reine API-Clients.
 * Sie wird einmal beim Prozessstart erzeugt; Requests konvertieren keine Schemas neu.
 */
export const SSE_API_DISCOVERY = Object.freeze({
  schemaVersion: 1,
  apiVersion: SSE_API_VERSION,
  operations: SSE_API_OPERATIONS,
  argumentSchemas: createArgumentSchemas(),
  resultSchemaVersion: SSE_API_RESULT_SCHEMA_VERSION,
  resultSchemas: createResultSchemas(),
  definitions: resultDefinitions,
  operationTraits: createOperationTraits(),
  controls: Object.freeze({
    shutdown: Object.freeze({
      method: "POST", path: SSE_API_SHUTDOWN_PATH,
      instanceHeader: "x-sse-api-instance-id", idleOnly: true,
      acceptanceStatus: 202, acceptanceProvesProcessExit: false,
      argumentSchema: zodToJsonSchema(API_SHUTDOWN_REQUEST_SCHEMA, { target: "jsonSchema7", $refStrategy: "none" }),
    }),
  }),
  planning: Object.freeze({
    fallbackStages: SSE_CAPABILITIES.fallbackStages,
    selectors: SSE_CAPABILITIES.selectors,
    click: SSE_CAPABILITIES.click,
    dialogs: SSE_CAPABILITIES.dialogs,
    concurrency: SSE_CAPABILITIES.concurrency,
    batching: SSE_CAPABILITIES.batching,
  }),
  limits: SSE_CAPABILITIES.limits,
  safety: SSE_CAPABILITIES.safety,
  liveEvidence: SSE_CAPABILITIES.liveEvidence,
});

/** Kleine Einzelansicht fuer Agenten, die nur eine Operation planen. */
export function apiOperationDiscovery(operation: SseApiOperation) {
  return Object.freeze({
    schemaVersion: SSE_API_DISCOVERY.schemaVersion,
    apiVersion: SSE_API_DISCOVERY.apiVersion,
    operation,
    argumentSchema: SSE_API_DISCOVERY.argumentSchemas[operation],
    resultSchemaVersion: SSE_API_DISCOVERY.resultSchemaVersion,
    // Die Gesamtansicht teilt Definitionen am Dokumentwurzelpunkt. Die
    // Einzelansicht muss dagegen auch als isoliertes JSON-Schema aufloesbar sein.
    resultSchema: {
      ...SSE_API_DISCOVERY.resultSchemas[operation],
      definitions: structuredClone(resultDefinitions),
    },
    operationTraits: SSE_API_DISCOVERY.operationTraits[operation],
    planning: SSE_API_DISCOVERY.planning,
    limits: SSE_API_DISCOVERY.limits,
    safety: SSE_API_DISCOVERY.safety,
    liveEvidence: SSE_API_DISCOVERY.liveEvidence,
  });
}
