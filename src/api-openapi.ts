import {
  MAX_OPERATION_TIMEOUT_MS,
  SSE_API_OPERATIONS,
  SSE_API_VERSION,
  type SseApiOperation,
} from "./api-contract.js";
import { SSE_API_DISCOVERY } from "./api-discovery.js";

const schemaName = (operation: SseApiOperation): string => `Args_${operation}`;
const resultSchemaName = (operation: SseApiOperation): string => `Result_${operation}`;

const argumentComponents = Object.freeze(Object.fromEntries(
  SSE_API_OPERATIONS.map((operation) => [schemaName(operation), SSE_API_DISCOVERY.argumentSchemas[operation]]),
));

function resultProperty(operation: SseApiOperation, property: string): object {
  const schema = SSE_API_DISCOVERY.resultSchemas[operation] as { properties?: Record<string, object>; };
  const value = schema.properties?.[property];
  if (!value) throw new Error(`Result_${operation}.${property} fehlt fuer die OpenAPI-Komprimierung.`);
  return structuredClone(value);
}

/** Wiederkehrende Blattvertraege nur einmal publizieren statt hunderte Male inline. */
const resultValueComponents = Object.freeze({
  ResultOk: resultProperty("health", "ok"),
  ResultKind: resultProperty("health", "kind"),
  ResultError: resultProperty("health", "error"),
  ResultWorkerMs: resultProperty("health", "ms"),
  OptionalText: resultProperty("page", "ueberschrift"),
  OptionalFlag: resultProperty("health", "running"),
  OptionalObject: resultProperty("capabilities", "transport"),
  OptionalArray: resultProperty("health", "windows"),
  OptionalNonNegativeNumber: resultProperty("list_cases", "count"),
  OptionalSha256: resultProperty("case_hash", "sha256"),
  OptionalStringList: resultProperty("backup_cases", "retainedTargets"),
  OptionalTransmissionState: resultProperty("case_hash", "transmitted"),
});
const resultValueReferences = new Map(Object.entries(resultValueComponents)
  .map(([name, schema]) => [JSON.stringify(schema), { $ref: `#/components/schemas/${name}` }]));
const RESULT_TRANSPORT_PROPERTIES = new Set(["ok", "kind", "error", "ms"]);
const resultEnvelopeComponent = Object.freeze({
  type: "object",
  properties: {
    ok: { $ref: "#/components/schemas/ResultOk" },
    kind: { $ref: "#/components/schemas/ResultKind" },
    error: { $ref: "#/components/schemas/ResultError" },
    ms: { $ref: "#/components/schemas/ResultWorkerMs" },
  },
  required: ["ok"],
  additionalProperties: true,
  description: "Gemeinsamer Transportumschlag jedes Operationsergebnisses",
});

function compactResultSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const typed = structuredClone(schema) as {
    properties?: Record<string, unknown>;
    description?: string;
  } & Record<string, unknown>;
  if (!typed.properties) return schema;
  const operationProperties = Object.entries(typed.properties)
    .filter(([property]) => !RESULT_TRANSPORT_PROPERTIES.has(property));
  return {
    allOf: [{ $ref: "#/components/schemas/OperationResultEnvelope" }],
    properties: Object.fromEntries(operationProperties.map(([property, value]) => [
      property,
      structuredClone(resultValueReferences.get(JSON.stringify(value)) ?? value),
    ])),
    description: typed.description,
  };
}

const resultComponents = Object.freeze(Object.fromEntries(
  SSE_API_OPERATIONS.map((operation) => [
    resultSchemaName(operation),
    compactResultSchema(SSE_API_DISCOVERY.resultSchemas[operation]),
  ]),
));

const operationPaths = Object.freeze(Object.fromEntries(
  SSE_API_OPERATIONS.map((operation) => {
    const traits = SSE_API_DISCOVERY.operationTraits[operation];
    return [
      `/${SSE_API_VERSION}/operations/${operation}`,
      {
        get: {
          operationId: `describe_${operation}`,
          summary: `Schema und Sicherheitsmerkmale fuer ${operation}`,
          tags: ["discovery"],
          responses: {
            "200": { $ref: "#/components/responses/OperationDiscovery" },
            "401": { $ref: "#/components/responses/ApiError" },
            "404": { $ref: "#/components/responses/ApiError" },
          },
        },
        post: {
          operationId: operation,
          summary: `Lokale SteuerSparErklaerung-Operation ${operation}`,
          tags: [traits.readOnlyHint ? "read-only" : "stateful"],
          "x-sse-read-only": traits.readOnlyHint,
          "x-sse-destructive": traits.destructiveHint,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    args: { $ref: `#/components/schemas/${schemaName(operation)}` },
                    timeoutMs: {
                      type: "integer",
                      minimum: 200,
                      maximum: MAX_OPERATION_TIMEOUT_MS,
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Strukturiertes lokales Operationsergebnis",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/OperationEnvelope" },
                      {
                        type: "object",
                        properties: {
                          operation: { const: operation },
                          result: { $ref: `#/components/schemas/${resultSchemaName(operation)}` },
                        },
                      },
                    ],
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/ApiError" },
            "401": { $ref: "#/components/responses/ApiError" },
            "404": { $ref: "#/components/responses/ApiError" },
            "405": { $ref: "#/components/responses/ApiError" },
            "413": { $ref: "#/components/responses/ApiError" },
            "415": { $ref: "#/components/responses/ApiError" },
            "502": { $ref: "#/components/responses/ApiError" },
          },
        },
      },
    ];
  }),
));

/** Standardisierte, rein aus den produktiven Laufzeitvertraegen erzeugte API-Beschreibung. */
export const SSE_OPENAPI_DOCUMENT = Object.freeze({
  openapi: "3.1.0",
  info: {
    title: "Unoffizielle lokale SteuerSparErklaerung API",
    version: SSE_API_VERSION,
    description:
      "Loopback-only Windows-UI-Automation. ELSTER, Versand und Steueruebermittlung sind dauerhaft gesperrt.",
  },
  servers: [{ url: "/", description: "Aktueller lokaler API-Server" }],
  security: [{ bearerAuth: [] }],
  paths: Object.freeze({
    "/healthz": {
      get: {
        operationId: "healthz",
        summary: "Lokale API-Erreichbarkeit und Version",
        tags: ["diagnostics"],
        security: [],
        responses: {
          "200": {
            description: "API-Prozess ist erreichbar",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["ok", "apiVersion", "inFlight"],
                  properties: {
                    ok: { const: true },
                    apiVersion: { const: SSE_API_VERSION },
                    inFlight: {
                      description: "Laufende Operation oder null. Diese Route startet keinen " +
                        "Arbeitsprozess und antwortet deshalb auch waehrend einer langen Operation.",
                      oneOf: [
                        { type: "null" },
                        {
                          type: "object",
                          required: ["operation", "requestId", "startedAt", "elapsedMs"],
                          properties: {
                            operation: { type: "string" },
                            requestId: { type: "string" },
                            startedAt: { type: "integer" },
                            elapsedMs: { type: "integer" },
                          },
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
        },
      },
    },
    [`/${SSE_API_VERSION}/operations`]: {
      get: {
        operationId: "list_operations",
        summary: "Vollstaendiger API-Katalog mit Schemas und Sicherheitsmerkmalen",
        tags: ["discovery"],
        responses: {
          "200": {
            description: "Gesamter authentifizierter API-Katalog",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": { $ref: "#/components/responses/ApiError" },
        },
      },
    },
    [`/${SSE_API_VERSION}/openapi.json`]: {
      get: {
        operationId: "get_openapi",
        summary: "Diese generierte OpenAPI-3.1-Beschreibung",
        tags: ["discovery"],
        responses: {
          "200": {
            description: "OpenAPI-3.1-Dokument",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": { $ref: "#/components/responses/ApiError" },
        },
      },
    },
    ...operationPaths,
  }),
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      ...argumentComponents,
      ...resultValueComponents,
      OperationResultEnvelope: resultEnvelopeComponent,
      ...resultComponents,
      OperationEnvelope: {
        type: "object",
        required: ["apiVersion", "requestId", "operation", "durationMs", "result"],
        properties: {
          apiVersion: { const: SSE_API_VERSION },
          requestId: { type: "string", format: "uuid" },
          operation: { type: "string", enum: SSE_API_OPERATIONS },
          durationMs: { type: "integer", minimum: 0 },
          result: {
            type: "object",
            required: ["ok"],
            properties: { ok: { type: "boolean" } },
            additionalProperties: true,
          },
        },
        additionalProperties: false,
      },
      ApiErrorEnvelope: {
        type: "object",
        required: ["apiVersion", "requestId", "error"],
        properties: {
          apiVersion: { const: SSE_API_VERSION },
          requestId: { type: "string", format: "uuid" },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      OperationDiscoveryDocument: {
        type: "object",
        required: [
          "schemaVersion", "apiVersion", "operation", "argumentSchema", "resultSchemaVersion",
          "resultSchema", "operationTraits", "planning", "limits", "safety",
        ],
        properties: {
          schemaVersion: { const: 1 },
          apiVersion: { const: SSE_API_VERSION },
          operation: { type: "string", enum: SSE_API_OPERATIONS },
          argumentSchema: { type: "object" },
          resultSchemaVersion: { const: SSE_API_DISCOVERY.resultSchemaVersion },
          resultSchema: { type: "object" },
          operationTraits: { type: "object" },
          planning: { $ref: "#/components/schemas/PlanningContract" },
          limits: { type: "object" },
          safety: { type: "object" },
        },
        additionalProperties: false,
      },
      PlanningContract: {
        type: "object",
        required: ["fallbackStages", "selectors", "click", "dialogs"],
        properties: {
          fallbackStages: {
            type: "array",
            minItems: 4,
            items: {
              type: "object",
              required: ["intent", "operations", "rule"],
              properties: {
                intent: { type: "string", minLength: 1 },
                operations: {
                  type: "array",
                  minItems: 1,
                  items: { type: "string", enum: SSE_API_OPERATIONS },
                },
                rule: { type: "string", minLength: 1 },
              },
              additionalProperties: false,
            },
          },
          selectors: {
            type: "object",
            required: ["preferred", "containsRequiresUniqueMatch", "expectedPageRecommended"],
            properties: {
              preferred: { type: "array", items: { type: "string", enum: ["aid", "rid", "name"] } },
              containsRequiresUniqueMatch: { type: "boolean" },
              expectedPageRecommended: { type: "boolean" },
            },
            additionalProperties: false,
          },
          click: {
            type: "object",
            required: ["patterns", "genericToggleBlocked", "blockedLegacyPatterns", "safePatterns", "observedMethods"],
            properties: {
              patterns: { type: "array", items: { type: "string", enum: SSE_API_DISCOVERY.planning.click.patterns } },
              genericToggleBlocked: { const: true },
              blockedLegacyPatterns: {
                type: "array",
                items: { type: "string", enum: SSE_API_DISCOVERY.planning.click.blockedLegacyPatterns },
              },
              safePatterns: { type: "array", items: { type: "string", enum: SSE_API_DISCOVERY.planning.click.safePatterns } },
              observedMethods: {
                type: "array",
                items: { type: "string", enum: SSE_API_DISCOVERY.planning.click.observedMethods },
              },
            },
            additionalProperties: false,
          },
          dialogs: {
            type: "object",
            required: ["allowedButtons", "unsupportedButtonsAreReportedButBlocked", "requiresWindowAndFingerprint", "warningAlsoRequiresBodyFingerprint"],
            properties: {
              allowedButtons: {
                type: "array",
                items: { type: "string", enum: SSE_API_DISCOVERY.planning.dialogs.allowedButtons },
              },
              unsupportedButtonsAreReportedButBlocked: { const: true },
              requiresWindowAndFingerprint: { const: true },
              warningAlsoRequiresBodyFingerprint: { const: true },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    responses: {
      OperationDiscovery: {
        description: "Kleine Einzel-Discovery fuer genau diese Operation",
        content: { "application/json": { schema: { $ref: "#/components/schemas/OperationDiscoveryDocument" } } },
      },
      ApiError: {
        description: "Strukturierter API-Fehler ohne Argument- oder Ergebnisprotokollierung",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } },
      },
    },
  },
});
