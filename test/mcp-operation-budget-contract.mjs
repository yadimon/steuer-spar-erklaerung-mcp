import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { McpBudgetError, McpOperationBudget, MCP_RESPONSE_BUDGET_MS, MCP_API_CLEANUP_MARGIN_MS }
  from "../dist/mcp-operation-budget.js";
import { createMcpRegistry } from "../dist/mcp-registry.js";
import { SSE_MCP_TOOL_SCHEMAS } from "../dist/operation-catalog.js";

// Pure fake time: no supervisor, network, worker, desktop or real delay.
function create(parent = new AbortController()) {
  let now = 0, callback, cleared = 0;
  const budget = new McpOperationBudget(parent.signal, {
    now: () => now,
    setTimer: (fn, duration) => { callback = fn; assert.equal(duration, MCP_RESPONSE_BUDGET_MS); return 1; },
    clearTimer: () => { cleared++; },
  });
  return { budget, parent, advance: ms => { now += ms; }, expire: () => callback(), cleared: () => cleared };
}
assert(MCP_RESPONSE_BUDGET_MS < 300_000);
assert(MCP_API_CLEANUP_MARGIN_MS >= 12_000 + 5_000);
const composed = create();
assert.equal(composed.budget.operationTimeout(300_000), 260_000);
assert.equal(composed.budget.operationTimeout(), 90_000);
composed.advance(100_000);
assert.equal(composed.budget.operationTimeout(300_000), 160_000, "A composed call must not reset its budget.");
const unchangedGuard = { ok: false, kind: "interference", mutationStarted: true };
assert.equal(await composed.budget.run(async () => unchangedGuard), unchangedGuard);
assert.equal(composed.cleared(), 1);
assert.equal(composed.budget.signal.aborted, false);

const deadline = create();
let lateReject;
const response = deadline.budget.run(() => new Promise((_, reject) => { lateReject = reject; }));
await Promise.resolve();
deadline.expire();
await assert.rejects(response, error => error instanceof McpBudgetError && error.kind === "timeout");
assert.equal(deadline.budget.signal.aborted, true);
assert.throws(() => deadline.budget.operationTimeout(300_000), McpBudgetError);
lateReject(new Error("Late cleanup result"));
await Promise.resolve();
assert.equal(deadline.cleared(), 1);

const cancelled = create();
let queuedStarted = false;
const pending = cancelled.budget.run(() => { queuedStarted = true; return new Promise(() => {}); });
cancelled.parent.abort();
await assert.rejects(pending, error => error instanceof McpBudgetError && error.kind === "aborted");
assert.equal(queuedStarted, false, "Cancellation before the callback microtask must prevent dispatch.");
assert.throws(() => cancelled.budget.operationTimeout(), McpBudgetError);
const preAborted = new AbortController(); preAborted.abort();
let started = false;
await assert.rejects(create(preAborted).budget.run(async () => { started = true; }), McpBudgetError);
assert.equal(started, false);
const exhausted = create(); exhausted.advance(259_801);
assert.throws(() => exhausted.budget.operationTimeout(), McpBudgetError);

const registry = readFileSync("src/mcp-registry.ts", "utf8");
assert.match(registry, /await assertApiSingletonIdentity\(\);\s*const boundedTimeout = budget\?\.operationTimeout\(timeoutMs\)/u,
  "The API dispatch budget must be recomputed after identity verification.");
assert.match(registry, /outcomeUnknown: true, reconciliationRequired: true, retryable: false/u);
assert(!registry.includes("mutationStarted: false"), "A transport deadline cannot prove no mutation.");
const boundary = createMcpRegistry({ registerTool() { throw new Error("No tool registration needed"); } });
for (const kind of ["timeout", "aborted"]) {
  const response = boundary.caughtErrorResult("table_update", new McpBudgetError(kind));
  assert.equal(response.isError, true);
  assert.deepEqual({ ...response.structuredContent, error: undefined, hint: undefined }, {
    ok: false, kind, error: undefined, hint: undefined,
    outcomeUnknown: true, reconciliationRequired: true, retryable: false,
  }, "The MCP deadline must preserve an explicit unknown outcome, never fabricate no-write/quiescence.");
}
// Exercise the real registered MCP callback with a deliberately unresponsive
// synthetic handler. The timer is virtual; there is no API operation.
const originalTimer = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
let expireHandler, handlerEntered = false, rejectHandler, registered;
try {
  globalThis.setTimeout = (callback, ms) => { assert.equal(ms, 280_000); expireHandler = callback; return 1; };
  globalThis.clearTimeout = () => {};
  const realBoundary = createMcpRegistry({ registerTool(_name, _config, callback) { registered = callback; } });
  realBoundary.registerStrictTool("sse_find", { inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_find.shape }, () => {
    handlerEntered = true;
    return new Promise((_, reject) => { rejectHandler = reject; });
  });
  const result = registered({ name: "Synthetic selector" }, { signal: new AbortController().signal });
  await Promise.resolve();
  assert.equal(handlerEntered, true);
  expireHandler();
  const output = await result;
  assert.equal(output.isError, true);
  assert.equal(output.structuredContent.kind, "timeout");
  assert.equal(output.structuredContent.outcomeUnknown, true);
  assert.equal(output.structuredContent.reconciliationRequired, true);
  assert.equal(output.structuredContent.retryable, false);
  assert.equal(Object.hasOwn(output.structuredContent, "mutationStarted"), false);
  rejectHandler(new Error("Late synthetic cleanup failure"));
  await Promise.resolve();
} finally {
  globalThis.setTimeout = originalTimer;
  globalThis.clearTimeout = originalClear;
}
console.log("MCP shared budget, response deadline, late result and cancellation contracts passed.");
