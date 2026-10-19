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
  SSE_MCP_CONTROL_TOOL_ACTIONS,
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
    intent: "Standard: Strukturierter Zustand",
    operations: ["known_page_state", "page", "read_page", "ui_state", "get_value"],
    rule: "Katalogisierte und gezielte Lesungen bevorzugen; fuer get_value den beobachteten selectorNamespace explizit angeben. " +
      "Unbekannte Controls lesend entdecken, statt einen Namensraum nach einer Ablehnung zu wechseln.",
  },
  {
    intent: "Standard: Passiver Tabellenbestand",
    operations: ["table_read"],
    rule: "Native Modelllesung ohne Cursor bevorzugen. MCP setzt bei fehlendem noKeys explizit noKeys:true; " +
      "Standard-UIA liefert damit nur sichtbare Zeilen, fuer ein vollstaendiges passives UIA-Inventar readMode:'grid' waehlen. " +
      "Vollstaendigkeit und Limits pruefen; kein automatischer Backendwechsel nach einem Fehler. Direkte API-Defaults bleiben unveraendert.",
  },
  {
    intent: "Standard: Verifizierte Transaktion",
    operations: ["goto", "tracked_set_value", "fill_fields", "table_add", "table_update", "table_delete", "toggle", "combo_options", "combo_select"],
    rule: "Passendes Spezialwerkzeug mit frischem Vorwert und Readback verwenden. Native Tabellenmutationen positionieren ihr Ziel selbst; " +
      "keinen vollen Cursorlauf zur Schreibvorbereitung anfordern. Interne gebundene Positionierung bleibt Teil der Transaktion.",
  },
  {
    intent: "Unbekannte Controls entdecken",
    operations: ["snapshot", "find", "positions"],
    rule: "Erst lesen; AutomationId oder RuntimeId aus demselben frischen Zustand uebernehmen.",
  },
  {
    intent: "Fallback: Gebundene generische UI-Interaktion",
    operations: ["click", "click_point", "tree_top", "tree_scroll", "scroll", "scroll_page", "menu", "menu_click"],
    rule: "Selten und nur bei konkret fehlender passender Spezialoperation verwenden; frische eindeutige Bindung und Nachbedingung bleiben Pflicht. " +
      "click pattern='select' bleibt die unterstuetzte RadioButton-Transaktion. Kein Fallback nach Guard-, Dialog-, Hash-, Interferenz-, " +
      "Transport- oder Readbackfehler; bei outcomeUnknown, ungeklaerter Mutation oder Recovery stoppen und lesend abgleichen.",
  },
  {
    intent: "Fallback: Kompatible Teilansicht und Suche",
    operations: ["read_table", "set_value"],
    rule: "read_table nur fuer eine bewusst sichtbare Teilansicht, nicht als vollstaendiges Inventar; table_read bevorzugen. " +
      "set_value ist ausschliesslich das gebundene globale Suchfeld, keine allgemeine Alternative zu verifizierten Feld- oder Tabellenmutationen.",
  },
  {
    intent: "Fallback: Aktiver Tabellenlauf und Diagnose",
    operations: ["table_read"],
    rule: "Im MCP waehlt nur ausdrueckliches noKeys:false diesen langsamen aktiven Kompatibilitaets-/Diagnosemodus; direkte API-Defaults bleiben kompatibel. " +
      "Nur bei belegter fehlender vollstaendiger passiver Lesefaehigkeit, nachweislich benoetigter UIA-Schreibposition oder gezielter GUI-Diagnose ausdruecklich anfordern. " +
      "Der volle Lauf zeigt das Tabellenende, nicht eine beliebige Zielzeile; vor dem Schreiben Ziel und Vorwerte frisch pruefen. " +
      "Kein automatischer Fallback und keine Vorbereitungspflicht fuer native Tabellenmutationen.",
  },
  {
    intent: "Diagnose: Darstellung untersuchen",
    operations: ["snapshot_compare", "accessibility_probe", "screenshot"],
    rule: "Nur zur gezielten Untersuchung einer konkreten Darstellungs-/Providergrenze oder auf ausdruecklichen Diagnoseauftrag verwenden. " +
      "Strukturierte Lesungen zuerst; Diagnose erteilt keine Berechtigung fuer einen anderen Schreibweg.",
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
    mcpControlToolActions: SSE_MCP_CONTROL_TOOL_ACTIONS,
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
    rule: "Worker-Auftraege werden einzeln ausgefuehrt; ein Auftrag kann einen vorgewaermten Arbeitsprozess verwenden. " +
      "scenario_run fuehrt seine Schritte seriell ueber den Executor aus, mit einem eigenen Auftrag je Worker-Schritt. " +
      "Ein Szenario haelt keinen gemeinsamen Tabellen-Worker und ist keine Tabellen-Bulk-API.",
    levels: [
      { intent: "Einzelner Handgriff", operations: ["click", "click_point", "set_value", "read_page"] },
      { intent: "Navigieren und lesen in einem Aufruf", operations: ["checker_open", "subpages", "table_read"] },
      { intent: "Ganze Seitenstrecke", operations: ["collect", "read_full", "export_csv"] },
      { intent: "Begrenzte serielle Schrittfolge ueber den Executor", operations: ["scenario_run"] },
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
