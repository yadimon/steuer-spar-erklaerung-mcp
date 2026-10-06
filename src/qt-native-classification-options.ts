import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { SSE_MCP_RECEIPT_SCHEMAS } from "./mcp-schemas-receipts.js";
import { fail } from "./qt-native-receipts.js";
import { classificationOptionsFingerprint, classificationPolicySchema, selectedClassification } from "./qt-native-classification-projection.js";
import { ReceiptClassificationSession } from "./qt-native-classification-session.js";

/** Complete option enumeration using the shared exact receipt/dialog transaction. */
export async function executeQtNativeClassificationOptions(
  client: QtNativeClient, rawArgs: Readonly<Record<string, unknown>>, timeoutMs: number,
  signal?: AbortSignal, profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsed = SSE_MCP_RECEIPT_SCHEMAS.sse_receipt_manager_classification_options.safeParse(rawArgs);
  if (!parsed.success) return fail("bad-args", parsed.error.message);
  const policy = classificationPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!policy.success) return fail("invalid-catalog", "The complete classification policy is required.");
  const args = parsed.data, session = new ReceiptClassificationSession(client, args, policy.data, timeoutMs, signal);
  try {
    await session.prepare();
    const grid = await session.open(args.kind), dialogFingerprint = session.dialogFingerprint;
    await session.closeModal(false);
    const { list, ...proof } = await session.finish(true);
    return { ok: true, ...session.bindings(), ...proof, kind: args.kind, row: session.row,
      options: grid.options.map(({ name, selected }) => ({ name, selected })), selected: selectedClassification(grid),
      optionsFingerprint: classificationOptionsFingerprint(grid.options), dialogFingerprint, dialogClosed: true,
      listFingerprint: list.listFingerprint, detailFingerprint: args.expectedDetailFingerprint.toUpperCase(), cleanupRequired: false, verified: true };
  } catch (error) {
    session.markError(error);
    let cleanupError: string | null = null;
    if (session.hasModal && !session.closingModal && !session.outcomeUnknown) {
      try { await session.closeModal(false); } catch (cleanup) { cleanupError = cleanup instanceof Error ? cleanup.message : String(cleanup); }
    }
    return session.failure(error, cleanupError);
  }
}
