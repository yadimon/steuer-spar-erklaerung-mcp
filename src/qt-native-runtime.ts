import { performance } from "node:perf_hooks";
import type { ExecutionTelemetry } from "./execution-telemetry.js";
import { z } from "zod";
import type { SseApiServerConfig } from "./api-config.js";
import { detectSseExecutables } from "./api-first-run.js";
import type { SseApiOperation, WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { loadQtNativePackage, type QtNativePackage } from "./qt-native-package.js";
import { startQtNativeBroker, QtNativeStartupUnprovenError,
  type QtNativeBrokerOptions, type QtNativeSession, type QtNativeTarget, type QtNativeRetirementHandle } from "./qt-native-broker.js";
import { withCombinedAbortSignal } from "./abort.js";
import { executeNativeDesktopStatus } from "./native-desktop-status.js";
import { executeNativeDesktopStart, MAX_NATIVE_DESKTOP_START_TIMEOUT_MS } from "./native-desktop-start.js";
import { executeNativeDesktopStop, MAX_NATIVE_DESKTOP_STOP_TIMEOUT_MS } from "./native-desktop-stop.js";
import { discoverQtNativeTarget, type QtNativeDiscoveryOptions } from "./qt-native-discovery.js";
import { DesktopMarkerError, desktopMarkerPath, resolveDesktopMarkerForOperation, type DesktopMarker } from "./desktop-marker.js";

const contextSchema = z.object({ ok: z.literal(true), boundMain: z.boolean(), unique: z.boolean() }).passthrough();

// Right after a launch the named main window can briefly miss the native
// criteria (visible, unowned, at least 900 px, product title) while the same
// HWND qualifies moments later. Only for an explicitly addressed window and
// only for 'no-window', discovery is therefore repeated for a bounded time -
// never towards another target. Without an HWND 'no-window' stays immediate.
const NAMED_WINDOW_SETTLE_MS = 2_000;
const NAMED_WINDOW_POLL_MS = 150;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface QtNativeRuntime {
  desktopStatus(timeoutMs: number, signal?: AbortSignal): Promise<WorkerResult>;
  desktopStart(args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal): Promise<WorkerResult>;
  desktopStop(args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal): Promise<WorkerResult>;
  client(args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal): Promise<QtNativeClient>;
  beforeWorker(timeoutMs: number, signal?: AbortSignal): Promise<void>;
  afterWorker(operation: SseApiOperation, result: WorkerResult, args?: Readonly<Record<string, unknown>>): Promise<void>;
  close(timeoutMs?: number): Promise<void>;
}

export interface QtNativeRuntimeDependencies {
  telemetry?: ExecutionTelemetry;
  /** Internal integration-test seam; package configuration never accepts a callback. */
  loadPackage?: (config: NonNullable<SseApiServerConfig["qtNativeRuntime"]>, profile: ProductProfile) => QtNativePackage;
  startSession?: (options: QtNativeBrokerOptions) => Promise<QtNativeSession>;
  discoverTarget?: (options: QtNativeDiscoveryOptions) => Promise<QtNativeTarget>;
  readMarker?: () => DesktopMarker | null;
  /** Passive process existence only; null retains an unprovable binding. Not configurable through the API. */
  processExists?: (pid: number) => boolean | null;
}

export function createQtNativeRuntime(
  config: SseApiServerConfig, profile: ProductProfile,
  shutdown: AbortSignal, dependencies: QtNativeRuntimeDependencies = {},
): QtNativeRuntime {
  if (!config.qtNativeRuntime) throw new Error("Native runtime configuration is required.");
  const nativePackage = (dependencies.loadPackage ?? loadQtNativePackage)(config.qtNativeRuntime, profile);
  const executable = config.sseExecutable ? [config.sseExecutable] : detectSseExecutables(profile.id);
  if (executable.length !== 1) throw new Error("Native runtime requires exactly one configured or installed product executable.");
  const telemetry = dependencies.telemetry;
  const start = (options: QtNativeBrokerOptions): Promise<QtNativeSession> => {
    const action = () => (dependencies.startSession ?? startQtNativeBroker)(options);
    return telemetry?.enabled ? telemetry.runBind(action) : action();
  };
  const discover = (options: QtNativeDiscoveryOptions): Promise<QtNativeTarget> => {
    const action = () => (dependencies.discoverTarget ?? discoverQtNativeTarget)(options);
    return telemetry?.enabled ? telemetry.runDiscovery(action) : action();
  };
  const readMarker = dependencies.readMarker ?? (() => resolveDesktopMarkerForOperation(desktopMarkerPath(), "get_value", false));
  const sessions = new Map<number, QtNativeSession>();
  const retiring = new Map<QtNativeRetirementHandle, { settled: boolean }>();
  const changeWaiters = new Set<() => void>();
  const changed = () => { for (const notify of [...changeWaiters]) notify(); };
  const processExists = dependencies.processExists ?? ((pid: number): boolean | null => {
    try { process.kill(pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? false : null; }
  });
  let selected: number | undefined, starting: Promise<QtNativeSession> | undefined;
  let startupAbort: AbortController | undefined;
  let stopped = false, revision = 0, lifecycleInFlight = false;
  const failure = (message: string, kind: string, outcomeUnknown = false) => new QtNativeTransportError(message, kind, outcomeUnknown);
  function currentMarker(): DesktopMarker | null {
    try { return readMarker(); }
    catch (error) {
      if (error instanceof DesktopMarkerError) throw failure(error.message, error.kind);
      throw error;
    }
  }
  function matchesMarker(binding: QtNativeTarget, marker: DesktopMarker | null, explicit: boolean): boolean {
    return binding.desktop === marker?.name && (explicit || marker?.pid == null || binding.pid === marker.pid);
  }
  const left = (deadline: number, kind = "native-timeout") => {
    const value = Math.floor(deadline - performance.now());
    if (value < 1) throw failure("Native operation deadline exceeded before dispatch.", kind);
    return value;
  };
  async function waitForChange(deadline: number, signal: AbortSignal | undefined, kind: string): Promise<void> {
    if (signal?.aborted) throw failure("Native wait cancelled before dispatch.", "aborted");
    const remaining = left(deadline, kind);
    await new Promise<void>((resolveWait, reject) => {
      let done = false;
      const finish = (error?: unknown) => {
        if (done) return; done = true;
        clearTimeout(timer); signal?.removeEventListener("abort", abort); changeWaiters.delete(notify);
        if (error) reject(error); else resolveWait();
      };
      const abort = () => finish(failure("Native wait cancelled before dispatch.", "aborted"));
      const notify = () => {
        try { left(deadline, kind); finish(); } catch (error) { finish(error); }
      };
      // Also observe a late actual exit after an error-fulfilled completion.
      // Timed-out callers leave no reactions attached to an endless Promise.
      const timer = setTimeout(notify, Math.min(remaining, 100));
      changeWaiters.add(notify);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  async function waitForStartup(pending: Promise<QtNativeSession>, deadline: number, signal?: AbortSignal): Promise<void> {
    // Only the owner returns the startup's result. Later callers recheck
    // retained ownership instead of inheriting another request's failure.
    while (starting === pending) await waitForChange(deadline, signal, "native-timeout");
    if (signal?.aborted) throw failure("Native startup wait cancelled.", "aborted");
    left(deadline);
  }
  function retire(session: QtNativeRetirementHandle): void {
    if (retiring.has(session)) return;
    const record = { settled: false };
    retiring.set(session, record);
    const settled = () => { record.settled = true; changed(); };
    try { void Promise.resolve(session.close()).then(settled, settled); }
    catch { settled(); }
  }
  function pruneRetirements(): void {
    for (const session of retiring.keys()) if (session.processExited === true) retiring.delete(session);
  }
  async function quiesce(deadline: number, signal?: AbortSignal, includeLifecycle = true): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw failure("Native cleanup wait cancelled before dispatch.", "aborted");
      pruneRetirements();
      if ([...retiring.values()].some(record => record.settled))
        throw failure("Native broker exit remains unverified; no new operation was submitted.", "native-retirement-unproven");
      if (!starting && !retiring.size && (!includeLifecycle || !lifecycleInFlight)) return;
      await waitForChange(deadline, signal, "native-session-retiring");
    }
  }
  async function discoverOnce(args: Readonly<Record<string, unknown>>, deadline: number, signal?: AbortSignal): Promise<QtNativeTarget> {
    try {
      const marker = readMarker();
      const binding = await discover({ package: nativePackage, expectedImage: executable[0]!, marker,
        ...(typeof args.hwnd === "number" ? { hwnd: args.hwnd } : {}), timeoutMs: Math.min(left(deadline), 60_000), ...(signal ? { signal } : {}) });
      if (JSON.stringify(readMarker()) !== JSON.stringify(marker)) {
        throw failure("Desktop ownership changed during native discovery.", "native-binding");
      }
      return binding;
    } catch (error) {
      if (error instanceof DesktopMarkerError) throw failure(error.message, error.kind);
      throw error;
    }
  }
  async function target(args: Readonly<Record<string, unknown>>, deadline: number, signal?: AbortSignal): Promise<QtNativeTarget> {
    const settleUntil = Math.min(performance.now() + NAMED_WINDOW_SETTLE_MS, deadline);
    for (;;) {
      try { return await discoverOnce(args, deadline, signal); } catch (error) {
        const settling = typeof args.hwnd === "number" && error instanceof QtNativeTransportError && error.kind === "no-window";
        if (!settling || signal?.aborted || performance.now() + NAMED_WINDOW_POLL_MS >= settleUntil) throw error;
      }
      await pause(NAMED_WINDOW_POLL_MS, signal);
    }
  }
  function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolvePause, reject) => {
      const abort = () => { clearTimeout(timer); reject(failure("Native discovery cancelled.", "aborted")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolvePause(); }, milliseconds);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  async function obtain(args: Readonly<Record<string, unknown>>, deadline: number, signal?: AbortSignal): Promise<QtNativeSession> {
    if (stopped || shutdown.aborted || signal?.aborted) throw failure("Native runtime is stopping or the request was cancelled.", "aborted");
    if (lifecycleInFlight) throw failure("A native desktop lifecycle operation is still running.", "native-session-changed");
    const requested = typeof args.hwnd === "number" ? args.hwnd : selected;
    const explicit = typeof args.hwnd === "number";
    const retained = requested === undefined ? undefined : sessions.get(requested);
    if (retained && matchesMarker(retained.client.binding, currentMarker(), explicit)) return retained;
    if (starting) { await waitForStartup(starting, deadline, signal); return obtain(args, deadline, signal); }
    pruneRetirements();
    if (retiring.size) { await quiesce(deadline, signal); return obtain(args, deadline, signal); }
    const expectedRevision = revision;
    startupAbort = new AbortController();
    const startupSignal = startupAbort.signal;
    const pending = withCombinedAbortSignal([signal, shutdown, startupSignal], async combined => {
      const binding = await target(args, deadline, combined);
      if (combined.aborted || stopped || expectedRevision !== revision) throw failure("Native attachment was cancelled before launch.", "aborted");
      if (!matchesMarker(binding, currentMarker(), explicit))
        throw failure("Native target does not match the current desktop and implicit owner binding.", "native-binding");
      const existing = sessions.get(binding.hwnd);
      if (existing) {
        if (existing.client.binding.pid !== binding.pid || existing.client.binding.creationTime !== binding.creationTime
          || existing.client.binding.desktop !== binding.desktop) {
          throw failure("Rediscovered window does not match its retained process identity.", "native-binding");
        }
        // Rediscovery after an unrelated launch can select an existing session.
        // Keep even a failed connection bound: client() must verify its context
        // and must never treat rediscovery as permission to reconnect.
        selected = binding.hwnd;
        return existing;
      }
      if (sessions.size >= 4) {
        // Only an exited owned broker AND an absent target process can free a slot.
        // Failed transports, live/reused PIDs and uncertain existence retain their binding.
        // Never use this cleanup to reconnect the just-discovered process or resolve an old outcome.
        for (const [hwnd, retained] of sessions) {
          if (retained.client.binding.pid === binding.pid || retained.processExited !== true) continue;
          let exists: boolean | null;
          try { exists = processExists(retained.client.binding.pid); } catch { continue; }
          if (exists !== false) continue;
          sessions.delete(hwnd);
          if (selected === hwnd) selected = undefined;
        }
      }
      if (sessions.size >= 4) throw failure("Native window session limit reached.", "native-session-limit");
      if ([...sessions.values()].some(session => session.client.binding.pid === binding.pid)) {
        throw failure("This process already has a native session bound to another window.", "native-window-conflict");
      }
      let session: QtNativeSession;
      try {
        session = await start({
          package: nativePackage, target: binding, expectedImage: executable[0]!, timeoutMs: Math.min(left(deadline), 60_000), signal: combined,
        });
      } catch (error) {
        if (error instanceof QtNativeStartupUnprovenError) retire(error.retirement);
        throw error;
      }
      if (combined.aborted || stopped || shutdown.aborted || expectedRevision !== revision) {
        retire(session); throw failure("Native attachment was superseded by a lifecycle change.", "native-session-changed");
      }
      sessions.set(binding.hwnd, session); selected = binding.hwnd;
      // Failed connections to live or unprovable processes stay bound until an explicit lifecycle change;
      // later requests do not silently reconnect or replay work.
      return session;
    });
    starting = pending;
    const release = () => {
      if (starting === pending) { starting = undefined; startupAbort = undefined; changed(); }
    };
    void pending.then(release, release);
    await waitForStartup(pending, deadline, signal); return pending;
  }
  function clear(): void {
    revision++; selected = undefined;
    startupAbort?.abort(new Error("Native lifecycle changed during startup."));
    for (const [hwnd, session] of sessions) { sessions.delete(hwnd); retire(session); }
  }
  function invalidate(predicate: (session: QtNativeSession) => boolean): void {
    revision++;
    startupAbort?.abort(new Error("Native lifecycle changed during startup."));
    for (const [hwnd, session] of sessions) {
      if (!predicate(session)) continue;
      sessions.delete(hwnd);
      if (selected === hwnd) selected = undefined;
      retire(session);
    }
  }
  async function desktopLifecycle(timeoutMs: number, maximum: number, backend: "win32" | "win32-uia", signal: AbortSignal | undefined,
    action: (remaining: number, combined: AbortSignal) => Promise<WorkerResult>): Promise<WorkerResult> {
    const started = performance.now();
    const budget = Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 ? Math.min(timeoutMs, maximum) : 0;
    const deadline = started + budget;
    const beforeDispatchError = (error: unknown): WorkerResult => ({
      ok: false, backend, kind: error instanceof QtNativeTransportError ? error.kind : "native-retirement-unproven",
      error: error instanceof QtNativeTransportError ? error.message : "Native cleanup failed before desktop submission.",
      outcomeUnknown: false, ms: performance.now() - started,
    });
    return withCombinedAbortSignal([signal, shutdown], async combined => {
      if (combined.aborted || stopped) return beforeDispatchError(failure("Native desktop operation cancelled before submission.", "aborted"));
      if (lifecycleInFlight) return beforeDispatchError(failure("A native desktop lifecycle operation is still running.", "native-session-changed"));
      lifecycleInFlight = true;
      try {
        clear();
        try { await quiesce(deadline, combined, false); } catch (error) { return beforeDispatchError(error); }
        return await action(Math.max(0, Math.floor(deadline - performance.now())), combined);
      } finally { lifecycleInFlight = false; changed(); }
    });
  }
  const runtime: QtNativeRuntime = {
    async desktopStop(args, timeoutMs, signal) {
      return desktopLifecycle(timeoutMs, MAX_NATIVE_DESKTOP_STOP_TIMEOUT_MS, "win32-uia", signal, (remaining, combined) => executeNativeDesktopStop({
        package: nativePackage, executable: executable[0]!, args,
        timeoutMs: remaining, signal: combined,
      }));
    },
    async desktopStart(args, timeoutMs, signal) {
      // A longer API/MCP ceiling never expands the external helper's bound.
      // Retiring a prior session consumes this same capped absolute deadline.
      return desktopLifecycle(timeoutMs, MAX_NATIVE_DESKTOP_START_TIMEOUT_MS, "win32", signal, (remaining, combined) => executeNativeDesktopStart({
        package: nativePackage, profile, executable: executable[0]!, args, timeoutMs: remaining, signal: combined,
      }));
    },
    async desktopStatus(timeoutMs, signal) {
      return withCombinedAbortSignal([signal, shutdown], combined => executeNativeDesktopStatus({
        package: nativePackage, profile, timeoutMs: Math.min(timeoutMs, 60_000), signal: combined,
      }));
    },
    async client(args, timeoutMs, signal) {
      const deadline = performance.now() + timeoutMs;
      return withCombinedAbortSignal([signal, shutdown], async combined => {
        const session = await obtain(args, deadline, combined);
        const checked = await session.client.request("window_context", {}, left(deadline), combined);
        if (!checked.result.ok) throw failure(String(checked.result.error ?? "Native window context failed."),
          String(checked.result.code ?? "native-binding"), checked.result.outcomeUnknown === true);
        const context = contextSchema.parse(checked.result);
        if (!context.boundMain) throw failure("The bound window is no longer a current main window.", "stale-window");
        if (args.hwnd === undefined && !context.unique) throw failure("Multiple product windows require an explicit hwnd.", "ambiguous");
        return session.client;
      });
    },
    async beforeWorker(timeoutMs, signal) {
      if (stopped) throw failure("Native runtime is stopping.", "aborted");
      await withCombinedAbortSignal([signal, shutdown], combined => quiesce(performance.now() + timeoutMs, combined));
    },
    async afterWorker(operation, result, args = {}) {
      // A failed/unknown mutation must retain its failed binding, not silently
      // create a fresh session that could be mistaken for permission to retry.
      if (result.ok !== true || result.outcomeUnknown === true) return;
      const identity = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
      if (operation === "window_close") {
        // The worker proves that only this known auxiliary window disappeared.
        // Keep a healthy main-window session (and its object IDs) in the same PID.
        if (result.onlyTargetRemoved === true && result.verified === true && identity(result.hwnd)) {
          invalidate(session => session.client.binding.hwnd === result.hwnd);
        } else clear();
        return;
      }
      if (!["desktop_start", "desktop_stop", "launch", "close", "save_as", "case_create"].includes(operation)) return;
      if (identity(result.pid)) {
        invalidate(session => session.client.binding.pid === result.pid);
      } else if (identity(args.hwnd)) {
        invalidate(session => session.client.binding.hwnd === args.hwnd);
      } else {
        // Older lifecycle results can omit identity (including close when no
        // process exists). Do not retain an unprovable case/window binding.
        clear();
      }
      // A new launch can change the implicit target while existing explicitly
      // addressed processes remain healthy. Resolve implicit selection afresh.
      if (operation === "launch" || operation === "desktop_start" || operation === "case_create") selected = undefined;
    },
    async close(timeoutMs = SHUTDOWN_TIMEOUT_MS) {
      stopped = true; clear();
      const budget = Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 ? Math.min(timeoutMs, SHUTDOWN_TIMEOUT_MS) : 0;
      await quiesce(performance.now() + budget);
    },
  };
  shutdown.addEventListener("abort", () => { void runtime.close().catch(() => { /* Stopped runtime retains unresolved owners. */ }); }, { once: true });
  return runtime;
}
