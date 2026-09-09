import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { SseApiServerConfig } from "./api-config.js";
import { detectSseExecutables } from "./api-first-run.js";
import type { SseApiOperation, WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { loadQtNativePackage, type QtNativePackage } from "./qt-native-package.js";
import { startQtNativeBroker, type QtNativeBrokerOptions, type QtNativeSession, type QtNativeTarget } from "./qt-native-broker.js";
import { withCombinedAbortSignal } from "./abort.js";
import { discoverQtNativeTarget, type QtNativeDiscoveryOptions } from "./qt-native-discovery.js";
import { DesktopMarkerError, desktopMarkerPath, resolveDesktopMarkerForOperation, type DesktopMarker } from "./desktop-marker.js";

const contextSchema = z.object({ ok: z.literal(true), boundMain: z.boolean(), unique: z.boolean() }).passthrough();

export interface QtNativeRuntime {
  client(args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal): Promise<QtNativeClient>;
  afterWorker(operation: SseApiOperation, result: WorkerResult): Promise<void>;
  close(): Promise<void>;
}

export interface QtNativeRuntimeDependencies {
  /** Internal integration-test seam; package configuration never accepts a callback. */
  loadPackage?: (config: NonNullable<SseApiServerConfig["qtNativeRuntime"]>, profile: ProductProfile) => QtNativePackage;
  startSession?: (options: QtNativeBrokerOptions) => Promise<QtNativeSession>;
  discoverTarget?: (options: QtNativeDiscoveryOptions) => Promise<QtNativeTarget>;
  readMarker?: () => DesktopMarker | null;
}

export function createQtNativeRuntime(
  config: SseApiServerConfig, profile: ProductProfile,
  shutdown: AbortSignal, dependencies: QtNativeRuntimeDependencies = {},
): QtNativeRuntime {
  if (!config.qtNativeRuntime) throw new Error("Native runtime configuration is required.");
  const nativePackage = (dependencies.loadPackage ?? loadQtNativePackage)(config.qtNativeRuntime, profile);
  const executable = config.sseExecutable ? [config.sseExecutable] : detectSseExecutables(profile.id);
  if (executable.length !== 1) throw new Error("Native runtime requires exactly one configured or installed product executable.");
  const start = dependencies.startSession ?? startQtNativeBroker;
  const discover = dependencies.discoverTarget ?? discoverQtNativeTarget;
  const readMarker = dependencies.readMarker ?? (() => resolveDesktopMarkerForOperation(desktopMarkerPath(), "get_value", false));
  const sessions = new Map<number, QtNativeSession>();
  let selected: number | undefined, starting: Promise<QtNativeSession> | undefined;
  let startupAbort: AbortController | undefined;
  let stopped = false, revision = 0;
  const failure = (message: string, kind: string, outcomeUnknown = false) => new QtNativeTransportError(message, kind, outcomeUnknown);
  const left = (deadline: number) => {
    const value = Math.floor(deadline - performance.now());
    if (value < 1) throw failure("Native operation deadline exceeded before dispatch.", "native-timeout");
    return value;
  };
  async function waitForStartup(pending: Promise<QtNativeSession>, deadline: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolveWait, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolveWait();
      };
      const abort = () => finish(failure("Native startup wait cancelled.", "aborted"));
      const timer = setTimeout(() => finish(failure("Native startup wait exceeded its deadline.", "native-timeout")), left(deadline));
      signal?.addEventListener("abort", abort, { once: true });
      pending.then(() => finish(), error => finish(error));
      if (signal?.aborted) abort();
    });
  }
  async function target(args: Readonly<Record<string, unknown>>, deadline: number, signal?: AbortSignal): Promise<QtNativeTarget> {
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
  async function obtain(args: Readonly<Record<string, unknown>>, deadline: number, signal?: AbortSignal): Promise<QtNativeSession> {
    if (stopped || shutdown.aborted || signal?.aborted) throw failure("Native runtime is stopping or the request was cancelled.", "aborted");
    const requested = typeof args.hwnd === "number" ? args.hwnd : selected;
    if (requested !== undefined && sessions.has(requested)) return sessions.get(requested)!;
    if (starting) { await waitForStartup(starting, deadline, signal); return obtain(args, deadline, signal); }
    if (sessions.size >= 4) throw failure("Native window session limit reached.", "native-session-limit");
    const expectedRevision = revision;
    startupAbort = new AbortController();
    const startupSignal = startupAbort.signal;
    starting = withCombinedAbortSignal([signal, shutdown, startupSignal], async combined => {
      const binding = await target(args, deadline, combined);
      if (combined.aborted || stopped || expectedRevision !== revision) throw failure("Native attachment was cancelled before launch.", "aborted");
      if ([...sessions.values()].some(session => session.client.binding.pid === binding.pid)) {
        throw failure("This process already has a native session bound to another window.", "native-window-conflict");
      }
      const session = await start({
        package: nativePackage, target: binding, expectedImage: executable[0]!, timeoutMs: Math.min(left(deadline), 60_000), signal: combined,
      });
      if (stopped || shutdown.aborted || expectedRevision !== revision) {
        await session.close(); throw failure("Native attachment was superseded by a lifecycle change.", "native-session-changed");
      }
      sessions.set(binding.hwnd, session); selected = binding.hwnd;
      // A failed connection is kept bound until a lifecycle operation or API restart;
      // later requests do not silently reconnect or replay work.
      return session;
    });
    try { return await starting; } finally { starting = undefined; startupAbort = undefined; }
  }
  async function clear(): Promise<void> {
    revision++; selected = undefined;
    startupAbort?.abort(new Error("Native lifecycle changed during startup."));
    const current = [...sessions.values()]; sessions.clear();
    await Promise.all(current.map(session => session.close()));
  }
  const runtime: QtNativeRuntime = {
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
    async afterWorker(operation, result) {
      if (result.ok === true && ["desktop_start", "desktop_stop", "window_close", "launch"].includes(operation)) await clear();
    },
    async close() {
      stopped = true; await clear();
      if (starting) { try { await starting; } catch { /* Pending startup observes the stopped/revision guard. */ } }
    },
  };
  shutdown.addEventListener("abort", () => { void runtime.close(); }, { once: true });
  return runtime;
}
