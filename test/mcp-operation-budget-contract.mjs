import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
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
const registryAst = ts.createSourceFile("mcp-registry.ts", registry, ts.ScriptTarget.Latest, true);
let operationBody;
function findOperation(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "callApiOperation") {
    assert.equal(operationBody, undefined, "The registry dispatch function must be unique.");
    operationBody = node.body;
  }
  ts.forEachChild(node, findOperation);
}
findOperation(registryAst);
assert(operationBody);
const statements = [...operationBody.statements];
const declaration = name => statements.flatMap((statement, index) => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations].filter(item => item.name.getText() === name)
    .map(item => ({ index, initializer: item.initializer })) : []);
const [health] = declaration("health"), [bounded] = declaration("boundedTimeout");
assert(health && bounded && ts.isAwaitExpression(health.initializer));
const identityCatch = health.initializer.expression;
assert(ts.isCallExpression(identityCatch) && ts.isPropertyAccessExpression(identityCatch.expression));
assert.equal(identityCatch.expression.name.text, "catch");
assert.equal(identityCatch.expression.expression.getText(), "assertApiSingletonIdentity()");
assert.equal(identityCatch.arguments.length, 1);
const failureHandler = identityCatch.arguments[0];
assert(ts.isArrowFunction(failureHandler) && ts.isBlock(failureHandler.body));
assert(ts.isThrowStatement(failureHandler.body.statements.at(-1)), "Every completed identity-error path must throw.");
function rejectIdentityRecovery(node) {
  assert(!ts.isReturnStatement(node), "The identity catch must never recover an unverified API identity.");
  ts.forEachChild(node, rejectIdentityRecovery);
}
rejectIdentityRecovery(failureHandler.body);
assert(bounded.index > health.index, "Recompute the budget only after the awaited identity check completes.");
assert.equal(bounded.initializer.getText(), "budget?.operationTimeout(timeoutMs) ?? timeoutMs");
const [dispatched] = declaration("result");
assert(dispatched && dispatched.index > bounded.index && ts.isAwaitExpression(dispatched.initializer),
  "Dispatch must follow the refreshed budget on the normal control-flow path.");
const guardedDispatch = dispatched.initializer.expression;
assert(ts.isCallExpression(guardedDispatch) && ts.isPropertyAccessExpression(guardedDispatch.expression));
assert.equal(guardedDispatch.expression.name.text, "catch");
assert.equal(guardedDispatch.arguments.length, 1);
const dispatchFailure = guardedDispatch.arguments[0];
assert(ts.isArrowFunction(dispatchFailure) && ts.isBlock(dispatchFailure.body));
assert(ts.isThrowStatement(dispatchFailure.body.statements.at(-1)), "The dispatch catch must rethrow, never retry or fabricate a result.");
rejectIdentityRecovery(dispatchFailure.body);
const dispatch = guardedDispatch.expression.expression;
assert(ts.isCallExpression(dispatch));
assert.equal(dispatch.expression.getText(), "callApiOperationDirect");
assert.equal(dispatch.arguments[2].getText(), "boundedTimeout");
assert(ts.isReturnStatement(statements.at(-1)) && statements.at(-1).expression.getText() === "result");
const dispatchOptions = dispatch.arguments[3];
assert(ts.isObjectLiteralExpression(dispatchOptions));
const identityBindings = dispatchOptions.properties.filter(property => ts.isPropertyAssignment(property) &&
  property.name.getText() === "expectedInstanceId");
assert.equal(identityBindings.length, 1);
assert.equal(identityBindings[0].initializer.getText(), "health.instanceId", "Dispatch must use the verified identity.");
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
