import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SSE_API_OPERATIONS } from "../../dist/api-contract.js";
import { classifyPassiveExportDialog } from "../export-dialog-policy.mjs";
import {
  SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS,
} from "../../dist/receipt-interaction-policy.js";
import {
  MEGA_EXCLUDED_DOMAINS,
  MEGA_MUTATION_READBACKS,
  MEGA_OPERATION_CATALOG,
} from "./api-mega-catalog.mjs";

const allowedClasses = new Set([
  "covered",
  "safely-skipped-read-only",
  "requires-external-state",
  "destructive-non-happy-path",
  "unavailable",
]);
const byOperation = new Map();
for (const entry of MEGA_OPERATION_CATALOG) {
  assert(SSE_API_OPERATIONS.includes(entry.operation), `Unbekannte Katalogoperation: ${entry.operation}`);
  assert(allowedClasses.has(entry.classification), `${entry.operation}: unbekannte Klassifikation.`);
  assert.equal(typeof entry.subclassification, "string");
  assert(entry.subclassification.length >= 8, `${entry.operation}: Unterklassifikation fehlt.`);
  assert.equal(typeof entry.reason, "string");
  assert(entry.reason.length >= 20, `${entry.operation}: Ausschluss-/Abdeckungsgrund ist nicht aussagekraeftig.`);
  assert(!byOperation.has(entry.operation), `${entry.operation}: doppelte Katalogzeile.`);
  byOperation.set(entry.operation, entry);
}
assert.equal(MEGA_OPERATION_CATALOG.length, 99, "Der aktuelle API-Katalog umfasst 99 Operationen.");
assert.deepEqual([...byOperation.keys()].sort(), [...SSE_API_OPERATIONS].sort(),
  "Jede aktuelle API-Operation braucht genau eine Mega-Klassifikation.");
assert(MEGA_OPERATION_CATALOG.some((entry) => entry.classification !== "covered"),
  "Der Benchmark darf nicht behaupten, alle Operationen seien happy-path-faehig.");

const declaredIds = new Set();
for (const declaration of MEGA_MUTATION_READBACKS) {
  assert(!declaredIds.has(declaration.id), `${declaration.id}: doppelte Mutation-ID.`);
  declaredIds.add(declaration.id);
  assert.equal(byOperation.get(declaration.operation)?.classification, "covered",
    `${declaration.id}: Mutation ist nicht als abgedeckt klassifiziert.`);
  assert.equal(byOperation.get(declaration.readbackOperation)?.classification, "covered",
    `${declaration.id}: unmittelbarer Readback ist nicht als abgedeckt klassifiziert.`);
  assert.notEqual(declaration.operation, "", `${declaration.id}: Mutation fehlt.`);
  assert.notEqual(declaration.readbackOperation, "", `${declaration.id}: Readback fehlt.`);
  assert.equal(typeof declaration.assertion, "string");
  assert(declaration.assertion.length >= 12, `${declaration.id}: Assertion fehlt.`);
}

const journey = readFileSync("test/live-api-mega-journey.mjs", "utf8");
const runner = readFileSync("test/run-live-api-mega.mjs", "utf8");
const harness = readFileSync("test/with-api.mjs", "utf8");
const fingerprint = readFileSync("test/performance/api-mega-fingerprint.mjs", "utf8");
const worker = readFileSync("powershell/sse-worker.ps1", "utf8");
const apiConfig = readFileSync("src/api-config.ts", "utf8");
const safetyPhaseStart = journey.indexOf('await phase("safety"');
const launchPhaseStart = journey.indexOf('await phase("launch-and-reads"');
assert(safetyPhaseStart >= 0 && launchPhaseStart > safetyPhaseStart,
  "Safety- und Launchphase muessen eindeutig geordnet sein.");
assert.doesNotMatch(journey.slice(safetyPhaseStart, launchPhaseStart), /read\(\s*["']help["']/u,
  "Fensterabhaengige Eingabehilfe darf nicht vor dem ersten verifizierten SSE-Start gelesen werden.");
const firstLaunch = journey.indexOf('"launch-gew"', launchPhaseStart);
const firstBoundUiState = journey.indexOf('await assertBoundUiState("launch-gew")', firstLaunch);
const firstBoundHelp = journey.indexOf('await read("help", { hwnd: currentHwnd }', firstBoundUiState);
assert(firstLaunch >= launchPhaseStart && firstBoundUiState > firstLaunch && firstBoundHelp > firstBoundUiState,
  "Eingabehilfe muss nach Launch und gebundenem UI-State mit dem verifizierten HWND gelesen werden.");
const invokedMutationIds = [...journey.matchAll(/(?:mutateAndRead|maybeDismissStartupDialog)\(\s*["']([^"']+)["']/gu)]
  .map((match) => match[1]);
assert.deepEqual([...new Set(invokedMutationIds)].sort(), [...declaredIds].sort(),
  "Implementierung und maschinenlesbares Mutations-/Readback-Manifest muessen deckungsgleich sein.");
assert.equal(new Set(invokedMutationIds).size, invokedMutationIds.length,
  "Jede deklarierte Mutationsstelle soll genau einmal im Quellfluss stehen; Laufzeitwiederholungen werden separat gezaehlt.");
assert.match(journey,
  /const changed = await call\([\s\S]+?await mutationAssertion\?\.\(changed\.result\);[\s\S]+?const observed = await call\([\s\S]+?await readbackAssertion\(observed\.result, changed\.result\);/u,
  "Der zentrale Mutationshelfer muss Mutation, unmittelbaren API-Readback und Assertion serialisieren.");
assert.match(journey, /coveredMissing[\s\S]+?coveredExecutedCount/u,
  "Laufzeitbericht muss wirklich ausgefuehrte covered-Operationen gegen den Katalog bilanzieren.");
assert.match(journey, /assert\.deepEqual\(coveredOperations\.filter/u,
  "Ein erfolgreicher Lauf muss bei jeder fehlenden covered-Operation scheitern.");
assert.doesNotMatch(journey, /MEGA_MUTATION_READBACKS\.length\s*-\s*completedDeclarations/u,
  "Mutationsbilanz darf nicht durch ueberlappende Mengen negativ werden.");
assert.doesNotMatch(journey, /skipCount:/u,
  "API-Aufrufzaehler und ausgeschlossene Katalogoperationen muessen getrennte Einheiten bleiben.");
assert.match(journey, /journeyWallMsExcludingCleanup/u);
assert.match(journey, /cleanupWallMs/u);
assert.match(runner, /previousReports[\s\S]+?sameFingerprintReports/u);
assert.doesNotMatch(runner, /comparableWholeJourneyBaselineExists:\s*false/u,
  "Erste-/Folgebaseline darf nicht dauerhaft hart codiert sein.");
assert.match(fingerprint, /ComSpec[\s\S]+?npm\.cmd --version/u,
  "npm-Version muss unter Windows ueber einen aufloesbaren cmd-Host gelesen werden.");
assert.match(runner, /Per-call direct API timings/u);
assert.match(runner, /API envelope ms/u);
assert.match(runner, /Mutation → immediate API readback/u);
assert.match(runner, /Safely excluded catalog operations/u);

const staticallyObserved = new Set(MEGA_MUTATION_READBACKS.flatMap((entry) => [
  entry.operation,
  entry.readbackOperation,
]));
for (const match of journey.matchAll(/(?:read|call)\(\s*["']([^"']+)["']/gu)) {
  staticallyObserved.add(match[1]);
}
const covered = MEGA_OPERATION_CATALOG
  .filter((entry) => entry.classification === "covered")
  .map((entry) => entry.operation);
assert.deepEqual([...staticallyObserved].sort(), [...covered].sort(),
  "Als covered deklarierte Operationen muessen im direkten Journey-Quellfluss vorkommen, und umgekehrt.");

assert.match(journey, /callApiOperationEnvelope/u);
assert.doesNotMatch(journey, /@modelcontextprotocol|StdioClientTransport|callWorker|sse-worker\.ps1|powershell(?:\.exe)?/iu,
  "Die Reise darf weder MCP noch den PowerShell-Worker direkt steuern.");
assert.match(runner, /test\/with-api\.mjs/u);
assert.match(runner, /SSE_TEST_API_PREWARM: "1"/u);
assert.match(harness, /enableWorkerPrewarm\(\)/u);
assert.match(harness, /shutdownWarmSpare\(\)/u);
assert.doesNotMatch(runner, /run-live-(?:journey|state-journey|suite)\.mjs/u);
assert.match(journey, /writeDeterministicDocument/u,
  "Der Mega-Lauf muss den vertragserprobten deterministischen synthetischen PDF-Generator wiederverwenden.");
assert.match(journey, /sourceHashStable/u);
assert.match(journey, /expectedListFingerprint/u);
assert.match(journey, /expectedDetailFingerprint/u);
assert.match(journey, /receiptContentFingerprint/u);

const receiptOperations = SSE_API_OPERATIONS.filter((operation) => operation.startsWith("receipt_manager_"));
assert.deepEqual(receiptOperations.sort(), MEGA_OPERATION_CATALOG
  .filter((entry) => entry.operation.startsWith("receipt_manager_") && entry.classification === "covered")
  .map((entry) => entry.operation).sort(), "Alle zehn getypten BelegManager-Operationen gehoeren in den Lauf.");
assert.equal(SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS.length, 9);
assert.match(harness, /SSE_TEST_INTERACTIVE_RECEIPTS[^\n]+!== "1"/u);
assert.match(harness, /randomBytes\(32\)/u);
assert.match(harness, /GetForegroundWindow/u);
assert.match(harness, /foregroundSessionId[^\n]+sessionId/u);
assert.match(harness, /resolveWindowsPowerShell\(\)/u);
assert.match(harness, /issuedAtMs \+ 60 \* 60_000/u);
assert.match(harness, /delete childEnv\.SSE_TEST_INTERACTIVE_RECEIPT_TOKEN/u);
assert.match(journey, /minimumReceiptLeaseMarginMs = 15 \* 60_000/u);
assert.match(journey, /remainingBeforeReceiptMs >= minimumReceiptLeaseMarginMs/u);
assert.match(journey, /readApiHealthz/u);
assert.match(journey, /readyBeforeFirstCatalogOperation/u);
assert.match(worker, /__interactiveReceiptLease/u);
assert.match(worker, /SSE_TEST_INTERACTIVE_RECEIPT_OWNER_PID/u);
assert.match(worker, /\$expiresAt -gt \$now -and \$expiresAt -le \$now\.AddHours\(1\)/u);
assert.match(worker, /\$foregroundOwner[\s\S]+SessionId -eq \[int\]\$currentSession/u);
assert.match(worker, /-not \(Test-Path -LiteralPath \$script:DESKTOP_MARKE\)/u);
const configFileBody = /interface ConfigFile \{([\s\S]+?)\n\}/u.exec(apiConfig)?.[1] ?? "";
assert.doesNotMatch(configFileBody, /interactiveReceiptLease/u,
  "Die Test-Lease darf nicht aus der installierten API-Konfigurationsdatei ladbar sein.");

for (const operation of [
  "vast_apply", "vast_dialog_read", "vast_mapping_options", "vast_mapping_select",
  "vast_row_details", "vast_row_set_expanded",
]) {
  assert.equal(byOperation.get(operation).classification, "requires-external-state", operation);
}
for (const operation of ["center_cases", "center_refresh"]) {
  assert.equal(byOperation.get(operation).classification, "requires-external-state", operation);
}
assert.equal(byOperation.get("click_point").classification, "destructive-non-happy-path");
assert.equal(byOperation.get("check").subclassification, "diagnostic-or-failure-path");
assert.equal(byOperation.get("desktop_start").subclassification, "incompatible-controller-mode");
assert.equal(byOperation.get("click_point").subclassification, "generic-physical-input");
assert.equal(byOperation.get("save_as").subclassification, "alternate-file-lifecycle");

const exactExport = {
  hwnd: 701,
  title: "Export für das Finanzamt (*.csv)",
  texts: ["Exportieren Sie die Daten als CSV-Dateien."],
  buttons: [
    { name: "Klicken Sie hier, um Ihre Daten zu exportieren", enabled: true },
    { name: "Schließen", enabled: true },
  ],
};
assert.equal(classifyPassiveExportDialog(structuredClone(exactExport), exactExport), "Schließen");
assert.equal(classifyPassiveExportDialog({ ...exactExport, title: "Steuerfall speichern?" }, exactExport), null);
assert.equal(classifyPassiveExportDialog({ ...exactExport, texts: ["Export abgeschlossen."] }, exactExport), null);
assert.equal(classifyPassiveExportDialog({ ...exactExport, buttons: [{ name: "OK", enabled: true }] }, exactExport), null);
assert.match(journey, /no-post-export-dialog-present/u,
  "Ein fehlender optionaler Post-Export-Dialog muss als Skip protokolliert werden.");
assert.doesNotMatch(journey, /\["OK", "Schließen", "Schliessen", "Abbrechen"\]/u,
  "Die Mega-Reise darf keinen beliebigen SSE-Dialog anhand eines generischen Schliessbuttons beantworten.");
assert.match(journey, /failure-cleanup-instances/u);
assert.match(journey, /findOwnedInstances/u);
assert.match(journey, /const ownedLaunchPids = new Set/u);
assert.equal((journey.match(/\(result\) => \(\{ pid: result\.pid \}\)/gu) ?? []).length, 3,
  "Alle drei Launch-Readbacks muessen ihre PID direkt aus dem Mutationsergebnis binden.");
assert.doesNotMatch(journey, /\(\) => \(\{ pid: currentPid \}\)/u,
  "Launch-Readback darf nicht von einer erst nachgelagert gesetzten Umgebungs-PID abhaengen.");
assert.match(journey, /currentPhase = "failure-cleanup"/u);
assert.match(journey, /ownedLaunchPids\.has\(currentPid\)[\s\S]+failure-cleanup-force-close-owned-launch-pid/u,
  "Failure-Cleanup muss auch eine exakt aus dem Launch belegte PID ohne Hauptinstanz schliessen.");
assert.match(worker, /Exakt gebundene SSE-Start-PID ohne verifiziertes Hauptfenster wurde ohne Speichern beendet/u,
  "Der API-Close-Pfad muss eine unbekannte Startdialog-PID ohne Dialogantwort hart und exakt beenden koennen.");
assert.match(journey, /cleanup\.closed = finalHealth\.result\.running === false && finalInstances\.result\.count === 0/u);
assert.match(journey, /"receipt-link"[\s\S]+?noChanges, true[\s\S]+?linkedAfter, true/u);
assert.match(journey, /"receipt-unlink"[\s\S]+?noChanges, true[\s\S]+?linkedAfter, false/u);
assert(!MEGA_MUTATION_READBACKS.some((entry) => entry.id === "receipt-options"),
  "Klassifikationsoptionen sind eine Lease-gebundene Lesung, keine Mutation.");
assert.equal(MEGA_MUTATION_READBACKS.find((entry) => entry.id === "receipt-classify")?.readbackOperation,
  "receipt_manager_list");
assert.match(journey, /draftCount, 0, "Klassifizierter Beleg blieb unerwartet ein Entwurf/u);
assert.deepEqual(MEGA_EXCLUDED_DOMAINS.map((entry) => entry.domain), [
  "VaSt/ELSTER account and certificate",
  "Steuertipps Center and external services",
  "Transmission and submission",
  "Activation and licensing",
  "Arbitrary physical input",
]);

process.stdout.write(
  `API-Mega-Vertrag: ${MEGA_OPERATION_CATALOG.length} Operationen, ` +
  `${MEGA_MUTATION_READBACKS.length} Mutations-/Readback-Schritte, direkte API und fail-closed Lease bestanden\n`,
);
