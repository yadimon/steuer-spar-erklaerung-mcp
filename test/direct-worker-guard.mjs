import assert from "node:assert/strict";
import { desktopMarkerState, directWorker, directWorkerBase64, ssePids } from "./direct-worker-helpers.mjs";

const pidsBefore = ssePids();
const markerBefore = desktopMarkerState();

const wildcard = directWorker("windows", { process: "explorer" });
assert(wildcard.ok === false && wildcard.kind === "blocked", `Freier Prozessname wurde direkt akzeptiert: ${JSON.stringify(wildcard)}`);
const injectedMode = directWorker("launch", { mode: "einur \"C:\\__sse_mcp_tests__\\fixture.Gew2024\"" });
assert(injectedMode.ok === false && injectedMode.kind === "bad-args", `Direkter Modus-Injektionsversuch wurde akzeptiert: ${JSON.stringify(injectedMode)}`);
const rawKeys = directWorker("keys", { keys: "123" });
assert(rawKeys.ok === false && rawKeys.kind === "blocked" && /Roh-Tastatureingabe/.test(rawKeys.error ?? ""),
  `Direkter Roh-Tastaturaufruf wurde akzeptiert: ${JSON.stringify(rawKeys)}`);
const invalidUtf8Args = directWorkerBase64("health", Buffer.from([0xff]).toString("base64"));
assert(invalidUtf8Args.ok === false && invalidUtf8Args.kind === "bad-args",
  "Direkter Worker darf ungueltige UTF-8-Argumente nicht ersetzen oder ausfuehren.");
for (const invalidEnvelope of ["[]", '"text"', "null"]) {
  const invalidDirectArgs = directWorkerBase64("health", Buffer.from(invalidEnvelope, "utf8").toString("base64"));
  assert(invalidDirectArgs.ok === false && invalidDirectArgs.kind === "bad-args",
    `Direkter Worker akzeptierte Nicht-Objekt-Argumente: ${invalidEnvelope}`);
}
for (const action of ["add", "delete"]) {
  const positionsMutation = directWorker("positions", { aktion: action, name: "MCP neutral" });
  assert(positionsMutation.ok === false && positionsMutation.kind === "blocked",
    `Direkter Positions-${action}-Aufruf wurde akzeptiert: ${JSON.stringify(positionsMutation)}`);
}
for (const operation of ["click", "click_point", "menu_click"]) {
  const destructive = directWorker(operation, { name: "Datenübernahme" });
  assert(destructive.ok === false && destructive.kind === "blocked" && /acknowledgeDestructive/.test(destructive.error ?? ""),
    `Destruktiver Direktaufruf '${operation}' wurde ohne Bestaetigung akzeptiert: ${JSON.stringify(destructive)}`);
}
const blockedReceiptAction = directWorker("receipt_manager_action", { actionId: "showAllReceipts" });
assert(blockedReceiptAction.ok === false && blockedReceiptAction.kind === "blocked",
  `Vordergrundpflichtige BelegManager-Aktion wurde akzeptiert: ${JSON.stringify(blockedReceiptAction)}`);
assert.equal(blockedReceiptAction.reason, "foreground-required-operation-disabled");
assert.equal(blockedReceiptAction.retryable, false);
assert.equal(blockedReceiptAction.interactionRequirement, "foreground-required");
for (const field of ["mutationStarted", "cleanupRequired", "physicalInputUsed", "foregroundLeaseUsed"]) {
  assert.equal(blockedReceiptAction[field], false, `Direkter BelegManager-Block muss ${field}=false melden.`);
}
assert.equal(blockedReceiptAction.resultingState, "unchanged");
assert.equal(ssePids(), pidsBefore, "Ein abgewiesener Direkt-Grenztest hat trotzdem eine SSE-PID erzeugt oder beendet.");
const markerAfter = desktopMarkerState();
assert.equal(markerAfter, markerBefore, "Ein abgewiesener Direkt-Grenztest hat den Desktop-Marker veraendert.");
process.stdout.write("Direkter Worker: Argument-, Prozess- und Desktop-Grenzen bestanden\n");
