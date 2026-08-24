import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_API_BODY_BYTES,
  MAX_API_RESPONSE_BYTES,
  MAX_OPERATION_TIMEOUT_MS,
  SSE_API_OPERATIONS,
} from "../dist/api-contract.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { SSE_CAPABILITIES } from "../dist/capabilities.js";
import {
  MAX_API_ARGUMENT_COLLECTION_ITEMS,
  MAX_API_ARGUMENT_DEPTH,
  MAX_API_ARGUMENT_NODES,
  MAX_API_ARGUMENT_STRING_BYTES,
  SSE_CLICK_PATTERNS,
  SSE_DIALOG_BUTTONS,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_OPERATION_LIMITS,
} from "../dist/operation-catalog.js";
import { SSE_PACKAGE_NAME, SSE_PACKAGE_VERSION } from "../dist/version.js";
import { SSE_LIVE_EVIDENCE } from "../dist/operation-live-evidence.js";
import {
  SSE_BUILD_DRIFT_BLOCKED_OPERATIONS,
  SSE_CLEANUP_OPERATIONS,
  SSE_DESTRUCTIVE_OPERATIONS,
  SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS,
  SSE_READ_ONLY_OPERATIONS,
  SSE_STATEFUL_OPERATIONS,
} from "../dist/operation-traits.js";

const calls = [];
const execute = createApiExecutor({
  host: "127.0.0.1",
  port: 1,
  configPath: "unused.json",
  workspaceDir: process.cwd(),
  resultDir: process.cwd(),
}, async (operation, args) => {
  calls.push({ operation, args });
  return { ok: false, kind: "unexpected-worker", error: "Capabilities duerfen keinen Worker starten." };
});

const result = await execute("capabilities", {}, 1_000);
assert.equal(result.ok, true);
assert.equal(calls.length, 0, "PC-blinde Faehigkeiten duerfen keinen Worker starten.");
assert.deepEqual(result.safety, SSE_CAPABILITIES.safety);
assert.equal(result.safety.elsterAndSubmissionBlocked, true);
assert.equal(result.safety.directWorkerSubmissionBypass, false);
assert.deepEqual(result.liveEvidence, SSE_LIVE_EVIDENCE);
assert.equal(result.liveEvidence.affectsAvailability, false);
assert.equal(result.liveEvidence.functionalCount, 86);
assert.equal(result.liveEvidence.errorPathOnlyCount, 0);
assert.equal(result.liveEvidence.untestedCount, 7);
assert.equal(result.transport.directApiWithoutMcp, true);
assert.equal(result.transport.directCliWithoutMcp, true);
assert.equal(result.transport.discoveryPath, "/v1/operations");
assert.equal(result.transport.operationDiscoveryPathTemplate, "/v1/operations/{operation}");
assert.equal(result.transport.openApiPath, "/v1/openapi.json");
assert.equal(result.transport.mcpCancellationPropagatesToApi, true);
assert.equal(result.transport.workerArguments, "exclusive-bounded-temp-json");
assert.equal(result.transport.workerArgumentsVisibleInProcessList, false);
assert.equal(result.transport.workerQueueDepth, 32);
assert.deepEqual(result.profile, {
  id: "2025",
  status: "supported",
  operationAccess: "full",
  operateExperimental: false,
});
assert.equal(result.buildDriftPolicy, "block-ui-tax-mutations");
assert.deepEqual(Object.keys(result.operationPolicy), SSE_API_OPERATIONS);
for (const operation of SSE_API_OPERATIONS) {
  assert.equal(result.operationPolicy[operation].operation, operation);
  assert.equal(result.operationPolicy[operation].availability, "allowed");
  assert.equal(
    result.operationPolicy[operation].blockedOnBuildDrift,
    SSE_BUILD_DRIFT_BLOCKED_OPERATIONS.includes(operation),
  );
}
assert.deepEqual(result.limits, {
  apiRequestBytes: MAX_API_BODY_BYTES,
  apiResponseBytes: MAX_API_RESPONSE_BYTES,
  operationTimeoutMs: MAX_OPERATION_TIMEOUT_MS,
  argumentStringBytes: MAX_API_ARGUMENT_STRING_BYTES,
  argumentCollectionItems: MAX_API_ARGUMENT_COLLECTION_ITEMS,
  argumentDepth: MAX_API_ARGUMENT_DEPTH,
  argumentNodes: MAX_API_ARGUMENT_NODES,
  workerArgumentBytes: MAX_API_BODY_BYTES,
  operation: SSE_OPERATION_LIMITS,
});
assert.deepEqual(result.transport.apiOperations, SSE_API_OPERATIONS);
assert.deepEqual(result.transport.mcpToolOperations, SSE_MCP_TOOL_OPERATIONS);
assert.deepEqual(result.transport.readOnlyOperations, SSE_READ_ONLY_OPERATIONS);
assert.deepEqual(result.transport.statefulOperations, SSE_STATEFUL_OPERATIONS);
assert.deepEqual(result.transport.nonDestructiveStatefulOperations, SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS);
assert.deepEqual(result.transport.potentiallyDestructiveOperations, SSE_DESTRUCTIVE_OPERATIONS);
for (const [label, operations] of [
  ["read-only", SSE_READ_ONLY_OPERATIONS],
  ["destructive", SSE_DESTRUCTIVE_OPERATIONS],
  ["cleanup", SSE_CLEANUP_OPERATIONS],
]) {
  assert.equal(new Set(operations).size, operations.length, `${label}-Katalog enthaelt Duplikate.`);
  assert(operations.every((operation) => SSE_API_OPERATIONS.includes(operation)), `${label}-Katalog enthaelt Fremdoperationen.`);
}
assert(
  SSE_READ_ONLY_OPERATIONS.every((operation) => !SSE_DESTRUCTIVE_OPERATIONS.includes(operation)),
  "Eine Operation darf nicht zugleich read-only und potenziell destruktiv sein.",
);
assert.deepEqual(
  [...SSE_READ_ONLY_OPERATIONS, ...SSE_STATEFUL_OPERATIONS].sort(),
  [...SSE_API_OPERATIONS].sort(),
  "Read-only- und zustandsbehaftete Operationen muessen den ganzen API-Katalog abdecken.",
);
assert.deepEqual(
  [...SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS, ...SSE_DESTRUCTIVE_OPERATIONS].sort(),
  [...SSE_STATEFUL_OPERATIONS].sort(),
  "Nicht-destruktive und potenziell destruktive Operationen muessen den stateful-Katalog partitionieren.",
);
for (const operation of ["scenario_run", "dialog_answer", "file_dialog_select", "archive_cases"]) {
  assert(SSE_DESTRUCTIVE_OPERATIONS.includes(operation), `${operation} braucht einen konservativen destructiveHint.`);
}
for (const operation of ["click_point", "vast_mapping_select"]) {
  assert(
    SSE_DESTRUCTIVE_OPERATIONS.includes(operation),
    `${operation} muss fuer direkte API-/OpenAPI-Clients als potenziell destruktiv markiert sein.`,
  );
}
assert(!SSE_DESTRUCTIVE_OPERATIONS.includes("set_value"), "Gebundenes globales Suchfeld ist nicht steuerdaten-destruktiv.");
for (const operation of [
  "backup_cases",
  "collect",
  "export_csv",
  "make_working_copy",
  "screenshot",
  "workspace_file_write_text",
]) {
  assert(
    !SSE_DESTRUCTIVE_OPERATIONS.includes(operation),
    `${operation} erzeugt nur neue Artefakte und muss als additiv markiert sein.`,
  );
}
assert.equal(SSE_MCP_TOOL_OPERATIONS.sse_change_field, "tracked_set_value");
assert.equal(SSE_MCP_TOOL_OPERATIONS.sse_change_known_field, "tracked_set_value");
assert.equal(result.click.genericToggleBlocked, true);
assert(result.click.safePatterns.includes("invoke") && !result.click.safePatterns.includes("toggle"));
assert(!result.click.patterns.includes("toggle") && result.click.blockedLegacyPatterns.includes("toggle"));
assert.equal(result.dialogs.unsupportedButtonsAreReportedButBlocked, true);

const fallbackOperations = result.fallbackStages.flatMap((stage) => stage.operations);
for (const operation of fallbackOperations) {
  assert(SSE_API_OPERATIONS.includes(operation), `Fallback referenziert unbekannte API-Operation '${operation}'.`);
}
for (const required of ["snapshot", "find", "accessibility_probe", "click", "toggle", "combo_select", "dialog_answer"]) {
  assert(fallbackOperations.includes(required), `Generischer Fallback '${required}' fehlt.`);
}

const worker = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(SSE_PACKAGE_NAME, packageJson.name);
assert.equal(SSE_PACKAGE_VERSION, packageJson.version);
assert.equal(SSE_CAPABILITIES.transport.packageName, packageJson.name);
assert.equal(SSE_CAPABILITIES.transport.packageVersion, packageJson.version);
const buttonBlock = /\$script:DIALOG_BUTTONS\s*=\s*@\(([\s\S]*?)\)\s*\r?\n/.exec(worker)?.[1];
assert(buttonBlock, "PowerShell-Dialogbutton-Allowlist fehlt.");
const workerButtons = [...buttonBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(
  [...new Set(workerButtons)].sort(),
  [...SSE_DIALOG_BUTTONS].sort(),
  "TypeScript- und PowerShell-Dialogbutton-Allowlist muessen identisch sein.",
);
assert(worker.includes("unsupportedButtons = $unsupportedButtons"));
assert(worker.includes("$unsupportedButtons.Count"));
const clickBlock = /'click' \{([\s\S]*?)\n  'toggle' \{/.exec(worker)?.[1];
assert(clickBlock, "PowerShell-Klickoperation fehlt.");
for (const pattern of SSE_CLICK_PATTERNS) {
  assert(clickBlock.includes(`'${pattern}'`), `Beworbenes Klickmuster '${pattern}' fehlt im Worker.`);
}
assert(!SSE_CLICK_PATTERNS.includes("toggle"));
const findBlock = /'find' \{([\s\S]*?)\n  'click' \{/.exec(worker)?.[1];
assert(findBlock, "PowerShell-Find-Operation fehlt.");
assert(findBlock.includes("$nameHit = -not $q") && findBlock.includes("$aidHit = -not $wantA"),
  "sse_find muss Name, AutomationId und Typ kombinieren und type-only zulassen.");
assert(findBlock.includes("contains=true ist nur zusammen mit name erlaubt"));

process.stdout.write("Faehigkeiten: PC-blinde Fallback-Leiter, Klickmuster und Dialogbutton-Paritaet bestanden\n");
