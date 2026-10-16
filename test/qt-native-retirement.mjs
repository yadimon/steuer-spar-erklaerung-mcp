import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createApiExecutor } from "../dist/api-executor.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";
import { QtNativeStartupUnprovenError } from "../dist/qt-native-broker.js";
import { withQtNativeLifecycle } from "../dist/qt-native-worker.js";
import { parseApiOperationResult } from "../dist/result-contract.js";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const kind = expected => error => error instanceof QtNativeTransportError && error.kind === expected;
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Native retirement test exceeded its watchdog.")), 2_000); })]);
  } finally { clearTimeout(timer); }
}
const rejects = (promise, expected) => assert.rejects(bounded(promise), kind(expected));

export async function verifyNativeRetirement(harness, config) {
  const unhandled = [], trap = error => unhandled.push(error);
  process.on("unhandledRejection", trap);
  try {
    {
      const gate = deferred(), h = harness({ closeWait: () => gate.promise, brokerProcessExited: false });
      try {
        await h.runtime.client({ hwnd: 42 }, 1000);
        h.state.target = { pid: 100, hwnd: 43, creationTime: "2" };
        const unrelated = await h.runtime.client({ hwnd: 43 }, 1000);
        await bounded(h.runtime.afterWorker("close", { ok: true, pid: 99 }));
        assert.equal(await h.runtime.client({ hwnd: 43 }, 1000), unrelated,
          "A healthy unrelated cached native session remains usable.");
        const signal = new AbortController();
        await rejects(h.runtime.client({ hwnd: 42 }, 30, signal.signal), "native-session-retiring");
        await rejects(h.runtime.beforeWorker(30, signal.signal), "native-session-retiring");
        assert.equal(getEventListeners(signal.signal, "abort").length, 0, "Timed-out waits must remove abort listeners.");
        assert.equal(h.starts.length, 2); assert.equal(h.calls.length, 2);
        await h.runtime.afterWorker("close", { ok: true, pid: 99 });
        assert.equal(h.state.closed, 1, "Repeated invalidation cannot close the same owner again.");
        gate.resolve(); await nextTurn();
        h.state.target = { pid: 99, hwnd: 42, creationTime: "1" };
        await h.runtime.client({ hwnd: 42 }, 1000);
        assert.equal(h.starts.length, 3, "Only positive exit proof permits a fresh broker.");
      } finally { gate.resolve(); await h.runtime.close(); }
    }
    {
      const h = harness(), cancel = new AbortController();
      try {
        const retained = await h.runtime.client({}, 1000); cancel.abort();
        for (const method of ["desktopStart", "desktopStop"]) {
          assert.equal((await h.runtime[method]({}, 90_000, cancel.signal)).kind, "aborted");
          assert.equal(h.state.closed, 0, "Pre-cancelled lifecycle calls must not retire bindings.");
        }
        assert.equal(await h.runtime.client({}, 1000), retained);
      } finally { await h.runtime.close(); }
    }
    {
      const gate = deferred(), h = harness({ closeWait: () => gate.promise, brokerProcessExited: false });
      const cancel = new AbortController();
      try {
        await h.runtime.client({}, 1000);
        const stop = h.runtime.desktopStop({}, 90_000, cancel.signal);
        await nextTurn(); cancel.abort();
        const result = await bounded(stop);
        assert.equal(result.kind, "aborted"); assert.equal(result.outcomeUnknown, false);
        await rejects(h.runtime.close(30), "native-session-retiring");
        await rejects(h.runtime.close(30), "native-session-retiring");
        assert.equal(h.state.closed, 1);
        h.shutdown.abort();
        await rejects(h.runtime.client({}, 1000), "aborted");
      } finally { gate.resolve(); await h.runtime.close(); }
    }
    for (const [exitProof, closeWait] of [[false, async () => {}], ["true", async () => {}],
      [false, async () => { throw Error("Synthetic private cleanup failure"); }]]) {
      const h = harness({ brokerProcessExited: exitProof, closeWait, keepBrokerAliveOnClose: true });
      try {
        await h.runtime.client({}, 1000);
        await bounded(h.runtime.afterWorker("close", { ok: true, pid: 99 }));
        await nextTurn();
        await rejects(h.runtime.beforeWorker(1000), "native-retirement-unproven");
        await rejects(h.runtime.client({}, 1000), "native-retirement-unproven");
        assert.equal(h.state.closed, 1); assert.equal(h.starts.length, 1);
        h.shutdown.abort(); await nextTurn();
        await rejects(h.runtime.close(30), "native-retirement-unproven");
        h.sessions[0].markExited();
        await h.runtime.close();
      } finally {
        for (const session of h.sessions) session.markExited();
        await h.runtime.close();
      }
    }
    {
      const gate = deferred(), h = harness({ startWait: () => gate.promise });
      try {
        await rejects(h.runtime.client({}, 30), "native-timeout");
        await rejects(h.runtime.client({}, 30), "native-timeout");
        assert.equal(h.starts.length, 1); assert.equal(h.calls.length, 1,
          "An expired owner must not forget its still-running startup.");
        gate.resolve(); await nextTurn();
        await h.runtime.client({}, 1000);
        assert.equal(h.starts.length, 1);
      } finally { gate.resolve(); await h.runtime.close(); }
    }
    {
      const gate = deferred(), h = harness({ startWait: () => gate.promise });
      h.state.startFailures = [new QtNativeTransportError("Previous caller cancelled its startup.", "aborted", true)];
      try {
        await rejects(h.runtime.client({}, 30), "native-timeout");
        const following = h.runtime.client({}, 1000);
        await nextTurn(); gate.resolve();
        assert.equal((await bounded(following)).binding.hwnd, 42,
          "A later caller must not inherit the expired owner's abort or unknown outcome.");
        assert.equal(h.starts.length, 2, "A proved failed attachment with no retained session permits a new caller's bind.");
      } finally { gate.resolve(); await h.runtime.close(); }
    }
    {
      const gate = deferred(), h = harness({ startWait: () => gate.promise });
      let exited = false;
      h.state.startFailures = [new QtNativeStartupUnprovenError({
        get processExited() { return exited; }, async close() {},
      })];
      try {
        await rejects(h.runtime.client({}, 30), "native-timeout");
        const following = h.runtime.client({}, 1000);
        await nextTurn(); gate.resolve();
        await assert.rejects(bounded(following), error => kind("native-retirement-unproven")(error) && error.outcomeUnknown === false,
          "A following request reports its own predispatch retirement failure, not the owner's unknown startup.");
        assert.equal(h.starts.length, 1); assert.equal(h.calls.length, 1);
      } finally { exited = true; gate.resolve(); await h.runtime.close(); }
    }
    {
      const startGate = deferred(), closeGate = deferred();
      const h = harness({ startWait: () => startGate.promise, closeWait: () => closeGate.promise, brokerProcessExited: false });
      const initial = rejects(h.runtime.client({}, 1000), "native-session-changed");
      try {
        await nextTurn();
        await rejects(h.runtime.close(30), "native-session-retiring");
        startGate.resolve(); await initial;
        assert.equal(h.state.closed, 1, "A late startup must be held as retiring without delaying its own result.");
        await rejects(h.runtime.close(30), "native-session-retiring");
        assert.equal(h.starts.length, 1); assert.equal(h.state.closed, 1);
      } finally { startGate.resolve(); closeGate.resolve(); await initial; await h.runtime.close(); }
    }
    {
      const h = harness(); let exited = false, closes = 0;
      h.state.startError = new QtNativeStartupUnprovenError({
        get processExited() { return exited; }, async close() { closes++; },
      });
      try {
        await rejects(h.runtime.client({}, 1000), "native-startup-unproven");
        delete h.state.startError;
        await rejects(h.runtime.client({}, 1000), "native-retirement-unproven");
        assert.equal(h.starts.length, 1); assert.equal(closes, 1);
        exited = true;
        await h.runtime.client({}, 1000);
        assert.equal(h.starts.length, 2);
      } finally { exited = true; await h.runtime.close(); }
    }
    {
      const h = harness(), gate = deferred(); let exited = false;
      h.state.startError = new QtNativeStartupUnprovenError({
        get processExited() { return exited; }, close() { return gate.promise; },
      });
      try {
        await rejects(h.runtime.client({}, 1000), "native-startup-unproven");
        delete h.state.startError;
        await rejects(h.runtime.client({}, 30), "native-session-retiring");
        assert.equal(h.starts.length, 1);
        exited = true;
        await h.runtime.client({}, 1000);
        assert.equal(h.starts.length, 2, "Late actual exit frees a pending retirement without assuming completion proof.");
      } finally { exited = true; gate.resolve(); await h.runtime.close(); }
    }
    {
      const closeGate = deferred(), workGate = deferred();
      const h = harness({ closeWait: () => closeGate.promise, brokerProcessExited: false });
      const success = { ok: true, pid: 99, closed: true }, budgets = [];
      const worker = async (_operation, _args, timeoutMs) => { budgets.push(timeoutMs); await workGate.promise; return success; };
      const managed = withQtNativeLifecycle(worker, h.runtime);
      const execute = createApiExecutor(config, managed);
      let release;
      try {
        await h.runtime.client({}, 1000);
        const first = managed("close", { pid: 99, hwnd: 42 }, 1000);
        await nextTurn();
        const busy = await bounded(managed("close", { pid: 99, hwnd: 42 }, 1000));
        assert.equal(busy.kind, "busy"); assert.equal(busy.mutationStarted, false);
        assert.deepEqual(parseApiOperationResult("close", busy), busy);
        assert.deepEqual(parseApiOperationResult("launch", busy), busy);
        assert.equal(budgets.length, 1, "Parallel direct calls cannot bypass afterWorker through the worker queue.");
        workGate.resolve();
        assert.deepEqual(await bounded(first), success, "Retirement cannot replace a proven worker result.");
        const blocked = await bounded(execute("close", { pid: 99, hwnd: 42 }, 30));
        assert.equal(blocked.kind, "native-session-retiring"); assert.equal(blocked.outcomeUnknown, false);
        assert.deepEqual(parseApiOperationResult("close", blocked), blocked);
        assert.equal(budgets.length, 1);
        const following = execute("close", { pid: 99, hwnd: 42 }, 1000);
        await nextTurn();
        release = setTimeout(() => closeGate.resolve(), 50);
        assert.deepEqual(await bounded(following), success);
        assert(budgets[1] > 0 && budgets[1] < 990, "Cleanup wait consumes the same worker caller budget.");
      } finally {
        clearTimeout(release); workGate.resolve(); closeGate.resolve(); await h.runtime.close();
      }
    }
    {
      const h = harness(), unknown = { ok: false, kind: "native-connection", outcomeUnknown: true };
      try {
        const execute = createApiExecutor(config, withQtNativeLifecycle(async () => unknown, h.runtime));
        assert.deepEqual(await execute("close", { pid: 99, hwnd: 42 }, 1000), unknown);
        assert.equal(h.state.closed, 0);
      } finally { await h.runtime.close(); }
    }
    await nextTurn();
    assert.deepEqual(unhandled, [], "Late startup, close failures and shutdown must not create unhandled rejections.");
  } finally { process.off("unhandledRejection", trap); }
}
