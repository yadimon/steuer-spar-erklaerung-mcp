import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import { operationError } from "./executor-errors.js";
import { loadProductProfile, resolvePageObjectDefinition } from "./product-profiles.js";

export interface LocalPageObjectsOptions {
  profileId: string;
  profilesRoot: string;
  args: Record<string, unknown>;
  timeoutMs: number | undefined;
  signal?: AbortSignal;
  redactPaths: <T>(value: T) => T;
}

export type LocalPageObjectsOutcome =
  | { kind: "result"; result: WorkerResult }
  | { kind: "worker-fallback"; effectiveTimeoutMs: number; localStartedAt: number };

export function executeLocalPageObjects(options: LocalPageObjectsOptions): LocalPageObjectsOutcome {
  const effectiveTimeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const localStartedAt = performance.now();
  const remainingTimeoutMs = (): number => Math.max(
    0,
    Math.floor(effectiveTimeoutMs - (performance.now() - localStartedAt)),
  );
  const localStopResult = (): WorkerResult | undefined => {
    if (options.signal?.aborted) {
      return operationError("API-Client hat den Page-Object-Katalog abgebrochen.", "aborted");
    }
    if (remainingTimeoutMs() <= 0) {
      return operationError("Zeitbudget beim lokalen Lesen des Page-Object-Katalogs aufgebraucht.", "timeout");
    }
    return undefined;
  };
  const localResult = (result: WorkerResult): LocalPageObjectsOutcome => {
    const stoppedBeforeRedaction = localStopResult();
    if (stoppedBeforeRedaction) {
      return { kind: "result", result: options.redactPaths(stoppedBeforeRedaction) };
    }
    const redacted = options.redactPaths(result);
    const stoppedAfterRedaction = localStopResult();
    return {
      kind: "result",
      result: stoppedAfterRedaction ? options.redactPaths(stoppedAfterRedaction) : redacted,
    };
  };

  const stoppedBeforeLoad = localStopResult();
  if (stoppedBeforeLoad) return localResult(stoppedBeforeLoad);

  let currentProfile;
  try {
    // Der Katalog darf sich waehrend einer Entwicklungssitzung aendern.
    // Pro Aufruf neu laden, damit die API keinen Startzustand vortaeuscht.
    currentProfile = loadProductProfile(options.profileId, options.profilesRoot);
  } catch {
    return { kind: "worker-fallback", effectiveTimeoutMs, localStartedAt };
  }
  const stoppedAfterLoad = localStopResult();
  if (stoppedAfterLoad) return localResult(stoppedAfterLoad);

  const pageId = typeof options.args.pageId === "string" ? options.args.pageId : "";
  if (!pageId) return localResult({ ok: true, catalog: currentProfile.pageObjectsCatalog });

  const resolved = resolvePageObjectDefinition(currentProfile.pageObjectsCatalog, pageId);
  if (resolved.status === "ambiguous") {
    return { kind: "worker-fallback", effectiveTimeoutMs, localStartedAt };
  }
  if (resolved.status === "missing") {
    return localResult(operationError(`Unbekannte Page-Object-ID '${pageId}'.`, "unknown-page-object"));
  }
  return localResult({ ok: true, pageId, page: resolved.page });
}
