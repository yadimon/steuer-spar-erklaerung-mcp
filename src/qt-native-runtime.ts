import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { SseApiServerConfig } from "./api-config.js";
import { detectSseExecutables } from "./api-first-run.js";
import type { SseApiOperation, WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import type { ScenarioExecutor } from "./scenario.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { loadQtNativePackage, type QtNativePackage } from "./qt-native-package.js";
import { startQtNativeBroker, type QtNativeBrokerOptions, type QtNativeSession, type QtNativeTarget } from "./qt-native-broker.js";
import { withCombinedAbortSignal } from "./abort.js";

const windowSchema = z.object({
  pid: z.number().int().positive(), hwnd: z.number().int().positive(), title: z.string(),
  w: z.number(), h: z.number(), minimiert: z.boolean().optional(),
}).passthrough();
const windowsSchema = z.object({ ok: z.literal(true), windows: z.array(windowSchema).max(256) });
const desktopSchema = z.object({
  ok: z.literal(true), aktiv: z.boolean(), markeVeraltet: z.boolean(),
  desktop: z.string().nullable().optional(), pid: z.number().int().nonnegative().nullable().optional(),
}).passthrough();
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
}

export function createQtNativeRuntime(
  config: SseApiServerConfig, profile: ProductProfile, worker: ScenarioExecutor,
  shutdown: AbortSignal, dependencies: QtNativeRuntimeDependencies = {},
): QtNativeRuntime {
  if (!config.qtNativeRuntime) throw new Error("Native runtime configuration is required.");
  const nativePackage = (dependencies.loadPackage ?? loadQtNativePackage)(config.qtNativeRuntime, profile);
  const executable = config.sseExecutable ? [config.sseExecutable] : detectSseExecutables(profile.id);
  if (executable.length !== 1) throw new Error("Native runtime requires exactly one configured or installed product executable.");
  const start = dependencies.startSession ?? startQtNativeBroker;
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
    // The first worker inventory retains desktop-marker ownership and profile gates.
    // Subsequent reads use a native context check on the retained connection.
    const inventory = await worker("windows", {}, left(deadline), signal);
    if (inventory.ok !== true) throw failure(String(inventory.error ?? "Native window inventory failed."), String(inventory.kind ?? "native-binding"));
    const windows = windowsSchema.parse(inventory).windows;
    const loaded = windows.filter(window => window.title.includes("SteuerSparErklärung") && (window.w >= 900 || window.minimiert));
    const main = loaded.length ? loaded : windows.filter(window => window.title === "Steuerprogramm" && (window.w >= 900 || window.minimiert));
    const matches = args.hwnd === undefined ? main : main.filter(window => window.hwnd === args.hwnd);
    if (matches.length !== 1) throw failure("An unambiguous current product window is required.", matches.length ? "ambiguous" : "no-window");
    const window = matches[0]!;
    const rawDesktop = await worker("desktop_status", {}, left(deadline), signal);
    if (rawDesktop.ok !== true) throw failure("Native desktop ownership could not be verified.", "native-binding");
    const desktop = desktopSchema.parse(rawDesktop);
    if (desktop.markeVeraltet) throw failure("The owned desktop marker is stale.", "desktop-marker-stale");
    if (desktop.aktiv && (desktop.pid !== window.pid || !desktop.desktop)) throw failure("Native target differs from the owned desktop.", "native-binding");
    return { pid: window.pid, hwnd: window.hwnd, ...(desktop.aktiv ? { desktop: desktop.desktop! } : {}) };
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
