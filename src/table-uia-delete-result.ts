import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import { amountEqual } from "./table-cursor-edit-roles.js";
import { publicCursorResult } from "./table-cursor-proofs.js";

const proofSchema = z.object({
  schemaVersion: z.literal(1), method: z.literal("uia-grid-logical-model"),
  outcome: z.enum(["deleted-exact", "restored"]),
  removedRow: z.number().int().min(0).max(999), rowsBefore: z.number().int().min(1).max(1000),
  rowsAfter: z.number().int().min(0).max(1000),
  beforeFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), afterFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  inputEpoch: z.number().int().min(0).max(0xffff_ffff), dirtyBefore: z.boolean(), dirtyAfter: z.boolean(), dirtyAfterDelete: z.boolean(),
}).strict();

/** Only a complete worker observation can finalize a nonnative deletion. */
export function normalizeUiaTableDeleteResult(args: Readonly<Record<string, unknown>>, result: WorkerResult): WorkerResult {
  const visible = publicCursorResult(result);
  if (!result.ok && result.mutationStarted === false && result.outcomeUnknown === false
    && result.resultingState === "unchanged" && result.rolledBack !== true && result.rollbackAttempted !== true
    && result.geloescht !== true && result.mutationPostProof === undefined) {
    return { ...visible, verified: false, retryable: false };
  }
  const parsed = proofSchema.safeParse(result.mutationPostProof);
  if (parsed.success) {
    const proof = parsed.data;
    const common = proof.removedRow < proof.rowsBefore && result.mutationStarted === true
      && result.outcomeUnknown === false && result.reconciliationRequired !== true && result.cleanupRequired !== true
      && typeof result.before === "string" && typeof result.after === "string" && amountEqual(result.before, args.expectedBefore);
    if (common && proof.outcome === "deleted-exact" && result.ok && result.verified === true
      && result.geloescht === true && result.nochVorhanden === false && result.rolledBack !== true && result.rollbackAttempted !== true
      && proof.rowsAfter === proof.rowsBefore - 1 && proof.beforeFingerprint !== proof.afterFingerprint
      && proof.dirtyAfterDelete === proof.dirtyAfter && amountEqual(result.after, args.expectedAfter)
      && (!Object.hasOwn(result, "ungespeichertVorher") || result.ungespeichertVorher === proof.dirtyBefore)
      && (!Object.hasOwn(result, "ungespeichertNachher") || result.ungespeichertNachher === proof.dirtyAfter)
      && (!Object.hasOwn(result, "dirtyStateUnchanged") || result.dirtyStateUnchanged === (proof.dirtyBefore === proof.dirtyAfter))) {
      return { ...visible, retryable: false };
    }
    const restored = proof.outcome === "restored" && result.rolledBack === true && result.rollbackAttempted === true
      && result.resultingState === "restored" && typeof result.rollbackValue === "string" && amountEqual(result.rollbackValue, args.expectedBefore)
      && amountEqual(result.after, result.after) && !amountEqual(result.after, args.expectedAfter);
    if (common && !result.ok && result.verified === false && result.geloescht === false && result.nochVorhanden === true
      && proof.rowsAfter === proof.rowsBefore && proof.beforeFingerprint === proof.afterFingerprint
      && result.ungespeichertVorher === proof.dirtyBefore && result.ungespeichertNachher === proof.dirtyAfter
      && result.dirtyStateUnchanged === (proof.dirtyBefore === proof.dirtyAfter)
      && (proof.dirtyBefore === proof.dirtyAfter || (!proof.dirtyBefore && proof.dirtyAfterDelete && proof.dirtyAfter))
      && restored) return { ...visible, retryable: false };
  }
  return { ...visible, ok: false, verified: false,
    kind: typeof result.kind === "string" ? result.kind : "cursor-proof-failed",
    error: result.rolledBack === true || typeof result.error !== "string"
      ? "Loeschergebnis und Wiederherstellung sind nicht vollstaendig bestaetigt; Zustand frisch abgleichen und Auftrag nicht wiederholen."
      : result.error,
    mutationStarted: result.mutationStarted === true ? true : null,
    outcomeUnknown: true, resultingState: "unknown", reconciliationRequired: true, retryable: false,
    geloescht: null, nochVorhanden: null,
    ...(Object.hasOwn(result, "ungespeichertVorher") ? { ungespeichertVorher: null } : {}),
    ...(Object.hasOwn(result, "ungespeichertNachher") ? { ungespeichertNachher: null } : {}),
    ...(Object.hasOwn(result, "dirtyStateUnchanged") ? { dirtyStateUnchanged: null } : {}),
    ...(Object.hasOwn(result, "rolledBack") ? { rolledBack: null } : {}) };
}
