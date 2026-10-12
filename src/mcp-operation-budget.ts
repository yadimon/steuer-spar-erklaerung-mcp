/** Leave HTTP termination and a structured MCP response below the outer deadline. */
export const MCP_RESPONSE_BUDGET_MS = 280_000;
export const MCP_API_CLEANUP_MARGIN_MS = 20_000;
export const MCP_DEFAULT_OPERATION_MS = 90_000;

export class McpBudgetError extends Error {
  constructor(readonly kind: "timeout" | "aborted") {
    super(kind === "timeout"
      ? "Internes MCP-Zeitbudget erreicht. Der Operationszustand ist unbekannt; zuerst passiv abgleichen, nicht wiederholen."
      : "MCP-Auftrag abgebrochen. Der Operationszustand ist unbekannt; zuerst passiv abgleichen, nicht wiederholen.");
    this.name = "McpBudgetError";
  }
}

type BudgetClock = {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
};

/** One budget for the entire tool, including composed tools and identity checks. */
export class McpOperationBudget {
  readonly controller = new AbortController();
  readonly deadline: number;
  private readonly clock: BudgetClock;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onParentAbort: () => void;

  constructor(private readonly parent: AbortSignal, clock: Partial<BudgetClock> = {}) {
    this.clock = { now: () => performance.now(), setTimer: setTimeout, clearTimer: clearTimeout, ...clock };
    this.deadline = this.clock.now() + MCP_RESPONSE_BUDGET_MS;
    this.onParentAbort = () => this.controller.abort(new McpBudgetError("aborted"));
    this.timer = this.clock.setTimer(() => this.controller.abort(new McpBudgetError("timeout")), MCP_RESPONSE_BUDGET_MS);
    parent.addEventListener("abort", this.onParentAbort, { once: true });
    if (parent.aborted) this.onParentAbort();
  }

  get signal(): AbortSignal { return this.controller.signal; }

  operationTimeout(requested = MCP_DEFAULT_OPERATION_MS): number {
    this.throwIfAborted();
    const remaining = Math.floor(this.deadline - this.clock.now() - MCP_API_CLEANUP_MARGIN_MS);
    if (remaining < 200) {
      this.controller.abort(new McpBudgetError("timeout"));
      this.throwIfAborted();
    }
    return Math.min(requested, remaining);
  }

  private throwIfAborted(): void {
    if (this.signal.aborted) throw this.signal.reason;
  }

  async run<T>(action: () => Promise<T>): Promise<T> {
    let onAbort: (() => void) | undefined;
    try {
      this.throwIfAborted();
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(this.signal.reason);
        this.signal.addEventListener("abort", onAbort, { once: true });
      });
      // Race only the response. Abort propagates to HTTP/worker; it is not a
      // proof that server cleanup or an already submitted mutation has ended.
      return await Promise.race([Promise.resolve().then(() => { this.throwIfAborted(); return action(); }), aborted]);
    } finally {
      if (onAbort) this.signal.removeEventListener("abort", onAbort);
      this.parent.removeEventListener("abort", this.onParentAbort);
      this.clock.clearTimer(this.timer);
    }
  }
}
