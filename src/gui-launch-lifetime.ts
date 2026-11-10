import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { readFileBounded } from "./bounded-files.js";
import type { WorkerResult } from "./api-contract.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "powershell");
const PROBE_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4_096;
const PROBE_CLEANUP_MS = 1_000;
const MINIMUM_START_RESERVE_MS = 5_000;

/** Internal test dependencies; never accepted from API arguments or configuration. */
export interface GuiLaunchProbeDependencies {
  spawnProcess?: typeof spawn;
  timeoutMs?: number;
  cleanupMs?: number;
}

/** Observe GUI inheritance without libuv's extra job for non-detached workers. */
export async function readGuiLaunchJob(signal?: AbortSignal, dependencies: GuiLaunchProbeDependencies = {}): Promise<unknown> {
  if (signal?.aborted) throw new Error("aborted");
  const manifest = JSON.parse((await readFileBounded(join(ROOT, "gui-launch-lifetime.sha256"), 1_024)).toString("utf8"));
  if (manifest?.schemaVersion !== 1 || Object.keys(manifest).sort().join() !== "exeSha256,schemaVersion,sourceSha256") {
    throw new Error("Invalid GUI lifetime probe manifest.");
  }
  for (const [name, expected, maximum] of [
    ["gui-launch-lifetime.cs", manifest.sourceSha256, 64 * 1_024],
    ["gui-launch-lifetime.exe", manifest.exeSha256, 128 * 1_024],
  ] as const) {
    if (typeof expected !== "string" || !/^[A-F0-9]{64}$/u.test(expected) ||
        createHash("sha256").update(await readFileBounded(join(ROOT, name), maximum)).digest("hex").toUpperCase() !== expected) {
      throw new Error("GUI lifetime probe integrity failed.");
    }
  }
  if (signal?.aborted) throw new Error("aborted");
  return new Promise((resolve, reject) => {
    // No CREATE_BREAKAWAY_FROM_JOB: the probe must retain the actual host job.
    // UV_PROCESS_DETACHED avoids masking it with libuv's silent-breakaway job.
    const child = (dependencies.spawnProcess ?? spawn)(join(ROOT, "gui-launch-lifetime.exe"), [], {
      detached: true, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", errors = "", failure: Error | undefined, settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => stop("aborted");
    const settle = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(cleanupTimer);
      signal?.removeEventListener("abort", abort);
      child.stdout?.removeListener("data", stdout);
      child.stderr?.removeListener("data", stderr);
      child.removeListener("error", onError); child.removeListener("close", onClose);
      if (error) {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
        // A late native error after unproven cleanup must not crash the API.
        child.on("error", () => {});
        reject(error);
      } else resolve(value);
    };
    const stop = (message: string) => {
      if (settled) return;
      failure ??= new Error(message);
      if (cleanupTimer) return;
      cleanupTimer = setTimeout(() => settle(new Error("GUI lifetime probe exit remains unproven.")),
        dependencies.cleanupMs ?? PROBE_CLEANUP_MS);
      try { child.kill(); } catch { /* The bounded cleanup result remains unproven. */ }
    };
    const capture = (chunk: Buffer, stderr: boolean) => {
      if (Buffer.byteLength(output) + Buffer.byteLength(errors) + chunk.length > MAX_OUTPUT_BYTES) {
        stop("GUI lifetime probe output exceeds its bound."); return;
      }
      if (stderr) errors += chunk.toString("utf8"); else output += chunk.toString("utf8");
    };
    const stdout = (chunk: Buffer) => capture(chunk, false);
    const stderr = (chunk: Buffer) => capture(chunk, true);
    const onError = (error: Error) => { failure ??= error; stop("GUI lifetime probe failed."); };
    const onClose = (code: number | null) => {
      if (failure || code !== 0 || errors) { settle(failure ?? new Error("GUI lifetime probe failed.")); return; }
      try { settle(undefined, JSON.parse(output)); } catch { settle(new Error("Invalid GUI lifetime probe output.")); }
    };
    child.stdout?.on("data", stdout); child.stderr?.on("data", stderr);
    child.once("error", onError); child.once("close", onClose);
    timer = setTimeout(() => stop("GUI lifetime probe timed out."), dependencies.timeoutMs ?? PROBE_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function withVisibleGuiLaunchGuard(
  operation: string, desktop: string | null, signal: AbortSignal | undefined,
  startWorker: (remainingMs?: number) => Promise<WorkerResult>,
  probe: (signal?: AbortSignal) => Promise<unknown> = readGuiLaunchJob,
  budget?: { timeoutMs: number; now?: () => number },
): Promise<WorkerResult> {
  if (operation !== "launch" || desktop !== null) return startWorker(budget?.timeoutMs);
  const now = budget?.now ?? (() => performance.now());
  const startedAt = now();
  const refused = (error: string): WorkerResult => ({
    ok: false, kind: signal?.aborted ? "aborted" : "launch-error", error,
    mutationStarted: false, resultingState: "unchanged", retryable: false,
  });
  let remainingMs: number | undefined;
  try {
    if (signal?.aborted) return refused("SSE-Start vor der Lebensdauerpruefung abgebrochen.");
    const value = await probe(signal) as Record<string, unknown> | null;
    if (!value || Object.keys(value).sort().join() !== "inJob,limitFlags,ok" || value.ok !== true ||
        typeof value.inJob !== "boolean" || !Number.isSafeInteger(value.limitFlags) ||
        (value.limitFlags as number) < 0 || (value.limitFlags as number) > 0xFFFF_FFFF ||
        (!value.inJob && value.limitFlags !== 0)) {
      return refused("Windows-Jobvererbung ist nicht eindeutig pruefbar; kein SSE-Prozess wurde gestartet.");
    }
    const flags = value.limitFlags as number;
    if ((flags & 0x2000) !== 0 && (flags & 0x1000) === 0) {
      return refused("Der Windows-Hostjob wuerde eine neu gestartete SSE beim Ende der MCP-Verbindung mit beenden. " +
        "API vor dem Client separat mit derselben Konfiguration starten und sse_preflight frisch ausfuehren. " +
        "Kein SSE-Prozess wurde gestartet.");
    }
    if (signal?.aborted) return refused("SSE-Start nach der Lebensdauerpruefung abgebrochen.");
    if (budget) {
      const elapsedMs = now() - startedAt;
      remainingMs = Math.floor(budget.timeoutMs - elapsedMs);
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(remainingMs) || remainingMs < MINIMUM_START_RESERVE_MS) {
        return refused("Nach der Lebensdauerpruefung bleibt keine sichere Startreserve; kein SSE-Prozess wurde gestartet.");
      }
    }
  } catch {
    return refused("Windows-Jobvererbung konnte nicht sicher gelesen werden; kein SSE-Prozess wurde gestartet.");
  }
  // This excludes the observed inherited kill job, not every possible ancestor.
  return startWorker(remainingMs);
}
