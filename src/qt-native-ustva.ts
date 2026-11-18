import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { executeQtNativePage } from "./qt-native-page.js";
import { normalizeUstvaCurrentPage } from "./ustva.js";

/** Preserve the page shape for internal UStVA preparation and normalization. */
export async function executeQtNativeUstvaPage(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  return executeQtNativePage(client, args, timeoutMs, signal, profile, (nodes, bounds) => {
    // The native walker excludes invisible interfaces before emitting nodes.
    const columns = nodes.filter(node => node.aid.endsWith(".centralWidget.SearchSplitter.TopLevelHSplitter.LibraryFrameSSE"));
    const column = columns[0];
    if (columns.length !== 1 || !column || column.type !== "Group" || !column.on
      || column.w <= 0 || column.h <= 0 || column.x < bounds.maxX) {
      return { ok: false, backend: "qt", kind: "ustva-incomplete",
        error: "Der UStVA-Prueferbereich ist nicht sicher lesbar. Hilfespalte einblenden und erneut lesen." };
    }
    return null;
  });
}

/** Reuse the same complete observation for public reads and write preparation. */
export async function executeQtNativeUstvaRead(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  const page = await executeQtNativeUstvaPage(client, args, timeoutMs, signal, profile);
  return { ...normalizeUstvaCurrentPage(page), backend: "qt", nativeDurationMs: page.nativeDurationMs };
}
