import { performance } from "node:perf_hooks";
import { ApiClientError } from "./api-client-error.js";
import type { ApiHealthDocument } from "./api-client.js";

type ProbeFailureState = "absent" | "unresponsive" | "incompatible";
export type ApiProbeResult =
  | { state: "compatible"; health: ApiHealthDocument }
  | { state: ProbeFailureState; error: ApiClientError };

export interface OwnedApiChild {
  pid: number | undefined;
  exited(): boolean;
  spawnError(): Error | undefined;
}

export function probeFailureState(error: ApiClientError, ownTimerFired: boolean): ProbeFailureState {
  if (error.httpStatus !== undefined) return "incompatible";
  if (error.kind === "network") return "absent";
  if ((ownTimerFired && error.kind === "aborted") || error.kind === "timeout") return "unresponsive";
  return "incompatible";
}

type ReadinessOptions = {
  child: OwnedApiChild;
  requireOwnProcess: boolean;
  probe(timeoutMs: number): Promise<ApiProbeResult>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** Observe one already started child; never spawn, terminate or replay an operation. */
export async function waitForOwnedApi(options: ReadinessOptions): Promise<ApiHealthDocument> {
  const { child, requireOwnProcess, probe } = options;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + 15_000;
  let lastError: ApiClientError | undefined;
  const checkSpawnError = () => {
    const error = child.spawnError() as NodeJS.ErrnoException | undefined;
    if (!error) return;
    // Raw spawn errors include installation paths; retain only known errno codes.
    const code = error.code && ["EACCES", "EAGAIN", "ENOENT", "ENOEXEC", "ENOMEM", "ENOTDIR", "EPERM", "UNKNOWN"].includes(error.code)
      ? error.code : "UNKNOWN";
    throw new Error("Die installierte API-Dependency konnte nicht gestartet werden.",
      { cause: new Error(`API-Prozessstart: ${code}.`) });
  };
  const ended = () => new Error(
    child.exited()
      ? "Die installierte API-Dependency endete, bevor eine kompatible SSE-API bereit war."
      : "Die installierte API-Dependency erreichte ihre Readiness nicht rechtzeitig.",
    { cause: lastError },
  );
  while (now() < deadline) {
    checkSpawnError();
    if (requireOwnProcess && child.exited()) throw ended();
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const current = await probe(Math.max(1, Math.min(750, Math.ceil(remaining))));
    checkSpawnError();
    if (current.state === "compatible") {
      if (requireOwnProcess && current.health.processId !== child.pid) {
        throw new ApiClientError("Die antwortende API gehoert nicht zum ausdruecklich gestarteten Prozess.", "api-replaced");
      }
      if (requireOwnProcess && child.exited()) throw ended();
      if (now() >= deadline) break;
      // Initial competing MCP starts may reuse their verified winning singleton.
      return current.health;
    }
    lastError = current.error;
    if (current.state === "incompatible") throw current.error;
    // A losing initial contender may still await the verified winning singleton.
    if (requireOwnProcess && child.exited()) throw ended();
    const wait = Math.min(100, deadline - now());
    if (wait <= 0) break;
    await sleep(wait);
  }
  checkSpawnError();
  throw ended();
}
