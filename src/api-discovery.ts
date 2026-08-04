import { zodToJsonSchema, type JsonSchema7Type } from "zod-to-json-schema";
import { SSE_API_OPERATIONS, SSE_API_VERSION, type SseApiOperation } from "./api-contract.js";
import { SSE_CAPABILITIES } from "./capabilities.js";
import { SSE_API_OPERATION_SCHEMAS } from "./operation-catalog.js";
import { operationAnnotations } from "./operation-traits.js";

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

/**
 * Authentifizierte, PC-unabhaengige Laufzeitbeschreibung fuer reine API-Clients.
 * Sie wird einmal beim Prozessstart erzeugt; Requests konvertieren keine Schemas neu.
 */
export const SSE_API_DISCOVERY = Object.freeze({
  schemaVersion: 1,
  apiVersion: SSE_API_VERSION,
  operations: SSE_API_OPERATIONS,
  argumentSchemas: createArgumentSchemas(),
  operationTraits: createOperationTraits(),
  planning: Object.freeze({
    fallbackStages: SSE_CAPABILITIES.fallbackStages,
    selectors: SSE_CAPABILITIES.selectors,
    click: SSE_CAPABILITIES.click,
    dialogs: SSE_CAPABILITIES.dialogs,
  }),
  limits: SSE_CAPABILITIES.limits,
  safety: SSE_CAPABILITIES.safety,
});

/** Kleine Einzelansicht fuer Agenten, die nur eine Operation planen. */
export function apiOperationDiscovery(operation: SseApiOperation) {
  return Object.freeze({
    schemaVersion: SSE_API_DISCOVERY.schemaVersion,
    apiVersion: SSE_API_DISCOVERY.apiVersion,
    operation,
    argumentSchema: SSE_API_DISCOVERY.argumentSchemas[operation],
    operationTraits: SSE_API_DISCOVERY.operationTraits[operation],
    planning: SSE_API_DISCOVERY.planning,
    limits: SSE_API_DISCOVERY.limits,
    safety: SSE_API_DISCOVERY.safety,
  });
}
