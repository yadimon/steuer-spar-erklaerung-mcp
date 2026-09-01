import {
  MAX_API_BODY_BYTES,
  MAX_API_RESPONSE_BYTES,
  MAX_OPERATION_TIMEOUT_MS,
  MAX_WORKER_QUEUE_DEPTH,
  SSE_API_OPERATIONS,
  SSE_API_VERSION,
  type SseApiOperation,
} from "./api-contract.js";
import {
  MAX_API_ARGUMENT_COLLECTION_ITEMS,
  MAX_API_ARGUMENT_DEPTH,
  MAX_API_ARGUMENT_NODES,
  MAX_API_ARGUMENT_STRING_BYTES,
  SSE_CLICK_PATTERNS,
  SSE_DIALOG_BUTTONS,
  SSE_MCP_COMPOSED_TOOL_OPERATIONS,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_OPERATION_LIMITS,
} from "./operation-catalog.js";
import {
  SSE_DESTRUCTIVE_OPERATIONS,
  SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS,
  SSE_READ_ONLY_OPERATIONS,
  SSE_STATEFUL_OPERATIONS,
} from "./operation-traits.js";
import { SSE_LIVE_EVIDENCE } from "./operation-live-evidence.js";
import { SSE_WORKER_CONTROLLER_BYPASS_OPERATIONS } from "./worker-operation-policy.js";
import { SSE_PACKAGE_NAME, SSE_PACKAGE_VERSION } from "./version.js";

type FallbackStage = {
  intent: string;
  operations: readonly SseApiOperation[];
  rule: string;
};

const fallbackStages = [
  {
    intent: "Schneller strukturierter Zustand",
    operations: ["known_page_state", "page", "ui_state"],
    rule: "Katalogisierte Seite bevorzugen; bei unbekannter Seite auf den generischen Snapshot wechseln.",
  },
  {
    intent: "Unbekannte Controls entdecken",
    operations: ["snapshot", "find", "positions", "accessibility_probe"],
    rule: "Erst lesen; AutomationId oder RuntimeId aus demselben frischen Zustand uebernehmen.",
  },
  {
    intent: "Eindeutig interagieren",
    operations: ["click", "click_point", "toggle", "combo_options", "combo_select", "tracked_set_value"],
    rule: "Spezialtransaktion fuer Checkbox, Dropdown und Schreibfeld; generischen Klick nur mit eindeutiger Bindung und Nachbedingung.",
  },
  {
    intent: "Dialog sicher fortsetzen",
    operations: ["dialog_list", "warning_popup_read", "dialog_answer"],
    rule: "Nur obersten Dialog, exakten Fingerprint und freigegebenen Button verwenden; nie blind wiederholen.",
  },
] as const satisfies readonly FallbackStage[];

export const SSE_CAPABILITIES = Object.freeze({
  schemaVersion: 1,
  architecture: {
    api: "Lokaler loopback-only Ausfuehrungskern",
    mcp: "PC-blinder Wrapper derselben Operationen",
    cli: "Direkter config-gebundener API-Client ohne Werte in Prozessargumenten",
    worker: "Kurzlebige, gebundene Windows-UI-Transaktionen",
  },
  transport: {
    packageName: SSE_PACKAGE_NAME,
    packageVersion: SSE_PACKAGE_VERSION,
    apiVersion: SSE_API_VERSION,
    directApiWithoutMcp: true,
    directCliWithoutMcp: true,
    discoveryPath: `/${SSE_API_VERSION}/operations`,
    operationDiscoveryPathTemplate: `/${SSE_API_VERSION}/operations/{operation}`,
    openApiPath: `/${SSE_API_VERSION}/openapi.json`,
    mcpCancellationPropagatesToApi: true,
    workerArguments: "exclusive-bounded-temp-json",
    workerArgumentsVisibleInProcessList: false,
    workerQueueDepth: MAX_WORKER_QUEUE_DEPTH,
    apiOperations: SSE_API_OPERATIONS,
    mcpToolOperations: SSE_MCP_TOOL_OPERATIONS,
    mcpComposedToolOperations: SSE_MCP_COMPOSED_TOOL_OPERATIONS,
    readOnlyOperations: SSE_READ_ONLY_OPERATIONS,
    statefulOperations: SSE_STATEFUL_OPERATIONS,
    nonDestructiveStatefulOperations: SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS,
    potentiallyDestructiveOperations: SSE_DESTRUCTIVE_OPERATIONS,
  },
  limits: {
    apiRequestBytes: MAX_API_BODY_BYTES,
    apiResponseBytes: MAX_API_RESPONSE_BYTES,
    operationTimeoutMs: MAX_OPERATION_TIMEOUT_MS,
    argumentStringBytes: MAX_API_ARGUMENT_STRING_BYTES,
    argumentCollectionItems: MAX_API_ARGUMENT_COLLECTION_ITEMS,
    argumentDepth: MAX_API_ARGUMENT_DEPTH,
    argumentNodes: MAX_API_ARGUMENT_NODES,
    workerArgumentBytes: MAX_API_BODY_BYTES,
    operation: SSE_OPERATION_LIMITS,
  },
  selectors: {
    preferred: ["aid", "rid", "name"],
    containsRequiresUniqueMatch: true,
    expectedPageRecommended: true,
  },
  click: {
    patterns: SSE_CLICK_PATTERNS,
    genericToggleBlocked: true,
    blockedLegacyPatterns: ["toggle"],
    safePatterns: SSE_CLICK_PATTERNS,
    observedMethods: ["uia-invoke", "verified-point", "uia-invoke+verified-point-fallback"],
  },
  dialogs: {
    allowedButtons: SSE_DIALOG_BUTTONS,
    unsupportedButtonsAreReportedButBlocked: true,
    requiresWindowAndFingerprint: true,
    warningAlsoRequiresBodyFingerprint: true,
  },
  fallbackStages,
  // Ohne MCP ist die Selbstbeschreibung die einzige Quelle, aus der ein Agent
  // Nebenlaeufigkeit und Buendelung erfahren kann.
  concurrency: {
    singleFlight: true,
    rejectionCode: "busy",
    rejectionStatus: 409,
    progressRoute: "/healthz",
    workerController: {
      scope: "windows-session",
      includesDirectWorker: true,
      policy: "zero-wait",
      idlePrewarmHoldsLease: false,
      bypassOperations: SSE_WORKER_CONTROLLER_BYPASS_OPERATIONS,
      contentionKind: "busy",
      contentionReason: "session-controller-busy",
      contentionTransport: "operation-result",
      contentionHttpStatus: 200,
      observedAbandonmentKind: "worker-isolation-lost",
      observedAbandonmentReason: "controller-lock-abandoned",
      durableCrashDetection: false,
    },
    rule: "Es laeuft immer nur eine Operation. Ein zweiter Aufruf wird mit 'busy' abgelehnt, " +
      "nicht eingereiht. Warte auf das Ergebnis statt parallel erneut aufzurufen; /healthz " +
      "meldet jederzeit, welche Operation seit wann laeuft. Abbrechen geschieht ausschliesslich " +
      "durch Trennen der HTTP-Verbindung, nie durch einen zweiten Aufruf.",
  },
  batching: {
    rule: "Jeder Aufruf startet einen frischen Arbeitsprozess und laedt das Workerskript neu. " +
      "Diese Fixkosten fallen pro Aufruf an, nicht pro Schritt. Buendele deshalb, statt Feld " +
      "fuer Feld einzeln abzurufen.",
    levels: [
      { intent: "Einzelner Handgriff", operations: ["click", "click_point", "set_value", "read_page"] },
      { intent: "Navigieren und lesen in einem Aufruf", operations: ["checker_open", "subpages", "table_read"] },
      { intent: "Ganze Seitenstrecke", operations: ["collect", "read_full", "export_csv"] },
      { intent: "Beliebige Schrittfolge in einem Arbeitsprozess", operations: ["scenario_run"] },
    ],
  },
  liveEvidence: SSE_LIVE_EVIDENCE,
  safety: {
    elsterAndSubmissionBlocked: true,
    directWorkerSubmissionBypass: false,
    writesRequireReadback: true,
    caseAndHashBindingAvailable: true,
    localPathsHiddenFromMcp: true,
    unknownOrAmbiguousStateFailsClosed: true,
    singleFlightEnforced: true,
  },
});
