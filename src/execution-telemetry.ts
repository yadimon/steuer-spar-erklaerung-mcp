import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { isSseApiOperation, type SseApiOperation } from "./api-contract.js";

/** Publicly safe dimensions only: never attach request arguments or result text. */
export const EXECUTION_TELEMETRY_PHASES = [
  "api", "composite", "node-local", "worker", "worker-queue", "worker-prepare", "qt-native", "discovery", "bind",
  "win32", "com-uia", "readback", "settle", "cleanup",
] as const;
export type ExecutionTelemetryPhase = typeof EXECUTION_TELEMETRY_PHASES[number];

export const EXECUTION_TELEMETRY_BACKENDS = [
  "node", "powershell-worker", "qt", "win32", "com-uia", "composite",
] as const;
export type ExecutionTelemetryBackend = typeof EXECUTION_TELEMETRY_BACKENDS[number];

export const WORKER_PERFORMANCE_COUNTERS = [
  "workerProcessCount", "internalOperationCount", "reusedReadbackCount", "treeWalks", "treeWalkMs", "workerMs", "nativeMs",
] as const;
export type WorkerPerformanceCounter = typeof WORKER_PERFORMANCE_COUNTERS[number];
export type WorkerPerformanceCounters = Partial<Record<WorkerPerformanceCounter, number>>;

export interface ExecutionTelemetrySpan {
  id: number;
  parentId: number | null;
  phase: ExecutionTelemetryPhase;
  backend: ExecutionTelemetryBackend;
  /** Validated against the public catalogue when supplied; private worker calls omit it. */
  operation?: SseApiOperation;
  startedAtMs: number;
  durationMs: number | null;
  completion: "completed" | "unfinished";
  /** Inclusive duration. Nested spans overlap this value and must not be summed as exclusive time. */
  durationSemantics: "inclusive";
  counters: WorkerPerformanceCounters;
}

export interface ExecutionTrace {
  id: number;
  operation: SseApiOperation;
  startedAtMs: number;
  durationMs: number;
  /** Inclusive duration. Benchmark consumers must not sum nested span durations. */
  durationSemantics: "inclusive";
  droppedSpanCount: number;
  spans: readonly ExecutionTelemetrySpan[];
}

export interface ExecutionTelemetryOptions {
  /** Internal opt-in only. Omit telemetry from runtime dependencies to disable it. */
  enabled?: boolean;
  maxCompletedTraces?: number;
  maxSpansPerTrace?: number;
}

interface MutableSpan extends ExecutionTelemetrySpan {
  ended: boolean;
}
interface TraceState {
  id: number;
  operation: SseApiOperation;
  startedAtMs: number;
  nextSpanId: number;
  droppedSpanCount: number;
  closed: boolean;
  spans: Map<number, MutableSpan>;
}
interface ActiveContext {
  state: TraceState;
  activeSpanId: number;
}

const DEFAULT_MAX_COMPLETED_TRACES = 64;
const DEFAULT_MAX_SPANS_PER_TRACE = 256;
const MAX_BUFFER_LIMIT = 4_096;

function boundedLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > MAX_BUFFER_LIMIT) {
    throw new Error(`${name} must be an integer from 1 through ${MAX_BUFFER_LIMIT}.`);
  }
  return value;
}

function safeCounter(value: unknown, integer = false): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  if (integer && !Number.isInteger(value)) return undefined;
  return value;
}

function catalogueOperation(operation: string): SseApiOperation {
  if (!isSseApiOperation(operation)) throw new Error(`Execution telemetry operation is not in the API catalogue: '${operation}'.`);
  return operation;
}

/**
 * Copy only known numeric worker timing/counter fields. This deliberately does
 * not retain any unknown property, argument, error, title, path, or result data.
 */
export function sanitizeWorkerPerformance(value: unknown): WorkerPerformanceCounters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const counters: WorkerPerformanceCounters = {};
  for (const key of WORKER_PERFORMANCE_COUNTERS) {
    const numeric = safeCounter(source[key], key.endsWith("Count") || key === "treeWalks");
    if (numeric !== undefined) counters[key] = numeric;
  }
  return counters;
}

function snapshotSpan(span: MutableSpan): ExecutionTelemetrySpan {
  return {
    id: span.id,
    parentId: span.parentId,
    phase: span.phase,
    backend: span.backend,
    ...(span.operation === undefined ? {} : { operation: span.operation }),
    startedAtMs: span.startedAtMs,
    durationMs: span.durationMs,
    completion: span.completion,
    durationSemantics: span.durationSemantics,
    counters: { ...span.counters },
  };
}

export class ExecutionTelemetry {
  readonly enabled: boolean;
  readonly #storage = new AsyncLocalStorage<ActiveContext>();
  readonly #completed: ExecutionTrace[] = [];
  readonly #maxCompletedTraces: number;
  readonly #maxSpansPerTrace: number;
  #nextTraceId = 1;
  #droppedTraceCount = 0;

  get droppedTraceCount(): number { return this.#droppedTraceCount; }

  constructor(options: ExecutionTelemetryOptions = {}) {
    this.enabled = options.enabled === true;
    this.#maxCompletedTraces = boundedLimit(options.maxCompletedTraces, DEFAULT_MAX_COMPLETED_TRACES, "maxCompletedTraces");
    this.#maxSpansPerTrace = boundedLimit(options.maxSpansPerTrace, DEFAULT_MAX_SPANS_PER_TRACE, "maxSpansPerTrace");
  }

  async runApi<T>(operation: SseApiOperation, task: () => Promise<T> | T): Promise<T> {
    const validatedOperation = catalogueOperation(operation);
    if (!this.enabled) return await task();
    const startedAtMs = performance.now();
    const state: TraceState = {
      id: this.#nextTraceId++, operation: validatedOperation, startedAtMs, nextSpanId: 1, droppedSpanCount: 0, closed: false, spans: new Map(),
    };
    const root = this.#createSpan(state, null, "api", "node", validatedOperation, startedAtMs);
    if (!root) throw new Error("Execution telemetry could not allocate an API root span.");
    try {
      return await this.#storage.run({ state, activeSpanId: root.id }, task);
    } finally {
      this.#finishSpan(root, "completed");
      for (const span of state.spans.values()) {
        if (!span.ended) this.#finishSpan(span, "unfinished");
      }
      state.closed = true;
      const finishedAtMs = performance.now();
      const trace: ExecutionTrace = {
        id: state.id, operation: state.operation, startedAtMs: state.startedAtMs,
        durationMs: Math.max(0, finishedAtMs - state.startedAtMs), durationSemantics: "inclusive",
        droppedSpanCount: state.droppedSpanCount,
        spans: [...state.spans.values()].sort((left, right) => left.id - right.id).map(snapshotSpan),
      };
      this.#completed.push(trace);
      if (this.#completed.length > this.#maxCompletedTraces) {
        const dropped = this.#completed.length - this.#maxCompletedTraces;
        this.#completed.splice(0, dropped);
        this.#droppedTraceCount += dropped;
      }
    }
  }

  async runCompositeChild<T>(operation: SseApiOperation, task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("composite", "composite", operation, task);
  }

  async runNodeLocal<T>(operation: SseApiOperation, task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("node-local", "node", operation, task);
  }

  /** `operation` is omitted for private worker-only operations such as bulk_action. */
  async runWorker<T>(operation: SseApiOperation | undefined, task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("worker", "powershell-worker", operation, task);
  }

  async runQtNative<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("qt-native", "qt", undefined, task);
  }

  async runWin32<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("win32", "win32", undefined, task);
  }

  async runComUia<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("com-uia", "com-uia", undefined, task);
  }

  async runWorkerQueue<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("worker-queue", "powershell-worker", undefined, task);
  }

  async runWorkerPrepare<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("worker-prepare", "powershell-worker", undefined, task);
  }

  async runDiscovery<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("discovery", "qt", undefined, task);
  }

  async runBind<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("bind", "qt", undefined, task);
  }

  async runReadback<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("readback", "node", undefined, task);
  }

  async runSettle<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("settle", "node", undefined, task);
  }

  async runCleanup<T>(task: () => Promise<T> | T): Promise<T> {
    return await this.#runNested("cleanup", "node", undefined, task);
  }

  /** Preserve the submitting trace when a shared queue dispatches from another request's continuation. */
  bindContext<T>(task: () => T): () => T {
    const context = this.enabled ? this.#storage.getStore() : undefined;
    return context ? () => this.#storage.run(context, task) : task;
  }

  /** End on dispatch or cancellation; this measures queue residence, not execution. */
  beginWorkerQueue(): () => void {
    return this.#beginSynchronousSpan("worker-queue", "powershell-worker");
  }

  /** Node-side marker/argument/spawn/handover setup only, not PowerShell parsing or UI execution. */
  measureWorkerPreparation<T>(task: () => T): T {
    const finish = this.#beginSynchronousSpan("worker-prepare", "powershell-worker");
    try { return task(); } finally { finish(); }
  }

  #beginSynchronousSpan(phase: ExecutionTelemetryPhase, backend: ExecutionTelemetryBackend): () => void {
    const parent = this.#storage.getStore();
    if (!this.enabled || !parent || parent.state.closed) return () => {};
    const span = this.#createSpan(parent.state, parent.activeSpanId, phase, backend, undefined);
    return () => { if (span) this.#finishSpan(span, "completed"); };
  }

  /** Attach only allowlisted numeric worker counters to the active backend span. */
  recordWorkerPerformance(value: unknown): WorkerPerformanceCounters {
    const counters = sanitizeWorkerPerformance(value);
    const context = this.#storage.getStore();
    const span = context && !context.state.closed ? context.state.spans.get(context.activeSpanId) : undefined;
    if (span) Object.assign(span.counters, counters);
    return counters;
  }

  /** Benchmark consumers call this to consume the bounded completed-trace buffer. */
  consumeCompleted(): ExecutionTrace[] {
    return this.#completed.splice(0, this.#completed.length);
  }

  #createSpan(
    state: TraceState, parentId: number | null, phase: ExecutionTelemetryPhase,
    backend: ExecutionTelemetryBackend, operation: SseApiOperation | undefined, startedAtMs = performance.now(),
  ): MutableSpan | undefined {
    if (state.spans.size >= this.#maxSpansPerTrace) {
      state.droppedSpanCount++;
      return undefined;
    }
    const span: MutableSpan = {
      id: state.nextSpanId++, parentId, phase, backend, ...(operation === undefined ? {} : { operation }),
      startedAtMs, durationMs: null, completion: "completed", durationSemantics: "inclusive", counters: {}, ended: false,
    };
    state.spans.set(span.id, span);
    return span;
  }

  #finishSpan(span: MutableSpan, completion: "completed" | "unfinished"): void {
    if (span.ended) return;
    span.completion = completion;
    span.durationMs = completion === "completed" ? Math.max(0, performance.now() - span.startedAtMs) : null;
    span.ended = true;
  }

  async #runNested<T>(
    phase: ExecutionTelemetryPhase, backend: ExecutionTelemetryBackend, operation: SseApiOperation | undefined,
    task: () => Promise<T> | T,
  ): Promise<T> {
    const validatedOperation = operation === undefined ? undefined : catalogueOperation(operation);
    const parent = this.#storage.getStore();
    if (!this.enabled || !parent || parent.state.closed) return await task();
    const span = this.#createSpan(parent.state, parent.activeSpanId, phase, backend, validatedOperation);
    if (!span) return await task();
    try {
      return await this.#storage.run({ state: parent.state, activeSpanId: span.id }, task);
    } finally {
      this.#finishSpan(span, "completed");
    }
  }
}

export function createExecutionTelemetry(options: ExecutionTelemetryOptions = {}): ExecutionTelemetry {
  return new ExecutionTelemetry(options);
}
