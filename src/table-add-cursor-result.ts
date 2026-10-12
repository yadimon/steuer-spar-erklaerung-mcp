import type { WorkerResult } from "./api-contract.js";

const kinds = new Set([
  "aborted", "busy", "cancelled", "cursor-proof-failed", "cursor-unavailable", "interference", "not-found",
  "precondition-failed", "postcondition-failed", "timeout", "worker-isolation-lost", "native-contract", "native-timeout",
  "GUI_QUEUE_TIMEOUT", "GUI_OPERATION_TIMEOUT", "MUTATION_ACK_REQUIRED", "SESSION_DRAINING",
]);
const phases = new Set([
  "prebind", "native-preproof", "native-acquire", "native-focus-preproof", "native-focus-only", "native-focus-readback",
  "cursor-resume", "native-final-readback", "passive-final-checkpoint", "viewport-activation", "native-activation-readback",
  "native-step-home", "native-step-down", "native-step-focus-only", "native-step-model-readback",
]);
const proofChecks = new Set([
  "native-or-worker-contract", "native-step-contract", "native-session-not-ready", "native-viewport-dpi-geometry",
  "native-focus-resume-worker-result", "native-focus-resume-lease-completion", "native-focus-final-model",
  "native-focus-final-epoch", "native-step-worker-result", "native-step-last-row-clipped", "native-step-final-epoch",
  "cursor-transport-error", "cursor-deadline", "append-no-mutation-proof",
]);
const stopKinds = new Set(["cursor-unavailable", "max-rows", "cursor-stalled"]);

/** Preserve a rejected append seek without exporting its cells, raw errors or private cursor authority. */
export function tableAddCursorFailure(original: WorkerResult, cursor: WorkerResult): WorkerResult {
  const code = (value: unknown, allowed: ReadonlySet<string>) =>
    typeof value === "string" && allowed.has(value) ? value : "unclassified";
  const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 400 ? value : null;
  const flag = (key: string) => typeof cursor[key] === "boolean" ? cursor[key] : null;
  const combinedFlag = (key: string) => original[key] === true || cursor[key] === true ? true : flag(key);
  const cleanupRequired = combinedFlag("cleanupRequired");
  const outcomeUnknown = original.outcomeUnknown === true || cursor.outcomeUnknown !== false || cleanupRequired === true;
  return {
    ...original, ok: false, kind: "cursor-proof-failed",
    error: "Anlegezeile nach Tabellenlauf nicht vollstaendig bewiesen; Teilzustand frisch abgleichen, nicht wiederholen.",
    verified: false, retryable: false, outcomeUnknown, reconciliationRequired: true, cleanupRequired,
    mutationStarted: original.mutationStarted === true ? true : outcomeUnknown ? null : original.mutationStarted,
    resultingState: outcomeUnknown ? "unknown" : original.resultingState,
    physicalInputAttempted: combinedFlag("physicalInputAttempted"), physicalInputUsed: combinedFlag("physicalInputUsed"),
    freeRowSearch: {
      retriedAfterTableWalk: false, rowsWalked: count(cursor.anzahl), originalKind: "not-found",
      cursorResult: {
        ok: cursor.ok === true, vollstaendig: cursor.vollstaendig === true,
        kind: code(cursor.kind, kinds), phase: code(cursor.phase, phases),
        proofCheck: code(cursor.proofCheck, proofChecks), stopKind: code(cursor.stopKind, stopKinds),
        steps: count(cursor.steps), schritte: count(cursor.schritte),
        outcomeUnknown: flag("outcomeUnknown"), reconciliationRequired: flag("reconciliationRequired"), cleanupRequired: flag("cleanupRequired"),
        activationSubmitted: flag("activationSubmitted"), physicalInputAttempted: flag("physicalInputAttempted"), physicalInputUsed: flag("physicalInputUsed"),
        nativeWholeModelUnchanged: flag("nativeWholeModelUnchanged"),
      },
    },
  };
}
