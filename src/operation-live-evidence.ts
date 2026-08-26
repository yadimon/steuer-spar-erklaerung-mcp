import { SSE_API_OPERATIONS, type SseApiOperation } from "./api-contract.js";

export const SSE_LIVE_EVIDENCE_SCHEMA_VERSION = 1;
export const SSE_LIVE_EVIDENCE_BASIS = "recorded-successful-live-execution";
export const SSE_LIVE_EVIDENCE_SCOPE = "aggregate-release-snapshot";
export const SSE_LIVE_EVIDENCE_STATUSES = Object.freeze([
  "functional",
  "error-path-only",
  "untested",
] as const);
export type OperationLiveEvidenceStatus = (typeof SSE_LIVE_EVIDENCE_STATUSES)[number];

const SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS = Object.freeze(
  [
    "vast_apply",
    "vast_dialog_read",
    "vast_mapping_options",
    "vast_mapping_select",
    "vast_row_details",
    "vast_row_set_expanded",
  ] as const satisfies readonly SseApiOperation[],
);

const SSE_LIVE_UNTESTED_OPERATIONS = Object.freeze(
  [] as const satisfies readonly SseApiOperation[],
);

const untested = new Set<SseApiOperation>(SSE_LIVE_UNTESTED_OPERATIONS);
const errorPathOnly = new Set<SseApiOperation>(SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS);
if (untested.size !== SSE_LIVE_UNTESTED_OPERATIONS.length) {
  throw new Error("Live-Evidenzkatalog enthaelt doppelte ungetestete Operationen.");
}
if (errorPathOnly.size !== SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS.length) {
  throw new Error("Live-Evidenzkatalog enthaelt doppelte Nur-Fehlerpfad-Operationen.");
}
if (SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS.some((operation) => untested.has(operation))) {
  throw new Error("Eine Live-Operation darf nicht zugleich ungetestet und nur im Fehlerpfad belegt sein.");
}

const operationStatus = Object.freeze(Object.fromEntries(
  SSE_API_OPERATIONS.map((operation) => [
    operation,
    untested.has(operation)
      ? "untested"
      : errorPathOnly.has(operation) ? "error-path-only" : "functional",
  ]),
) as Record<SseApiOperation, OperationLiveEvidenceStatus>);
const operationsWithStatus = (status: OperationLiveEvidenceStatus) => Object.freeze(
  SSE_API_OPERATIONS.filter((operation) => operationStatus[operation] === status),
);
const functionalOperations = operationsWithStatus("functional");
const errorPathOnlyOperations = operationsWithStatus("error-path-only");
const untestedOperations = operationsWithStatus("untested");

/**
 * Releasegebundener Informationsstand, keine Laufzeit-Freigabepolitik.
 * Der Vertragstest bindet ihn an die aus echten Testtraces erzeugte Bilanz;
 * die produktive API liest dagegen niemals Dateien aus test/.
 */
export const SSE_LIVE_EVIDENCE = Object.freeze({
  schemaVersion: SSE_LIVE_EVIDENCE_SCHEMA_VERSION,
  basis: SSE_LIVE_EVIDENCE_BASIS,
  scope: SSE_LIVE_EVIDENCE_SCOPE,
  profileSpecific: false,
  affectsAvailability: false,
  functionalCount: functionalOperations.length,
  errorPathOnlyCount: errorPathOnlyOperations.length,
  untestedCount: untestedOperations.length,
  untestedOperations,
  operationStatus,
});
