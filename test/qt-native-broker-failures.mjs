import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { startQtNativeBroker, QtNativeStartupUnprovenError } from "../dist/qt-native-broker.js";

export async function verifyBrokerExitOwnership(nativePackage, executable) {
  const originalSpawn = childProcess.spawn;
  for (const [mode, completed] of [["child-error", true], ["ignored-kill", false]]) {
    const child = new EventEmitter();
    Object.assign(child, { pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    let kills = 0, watchdog, observation;
    child.kill = () => { kills++; return false; };
    child.stdin.once("data", () => queueMicrotask(() => {
      if (mode === "child-error") child.emit("error", Error("Synthetic child failure"));
      else child.stdout.write('{"ok":false}\n');
    }));
    childProcess.spawn = () => child;
    syncBuiltinESMExports();
    const pending = startQtNativeBroker({ package: nativePackage,
      target: { pid: 99, hwnd: 42, creationTime: "1" }, expectedImage: executable, timeoutMs: 80 });
    try {
      const failure = await Promise.race([pending.then(() => null, error => error),
        new Promise(resolveWatchdog => { watchdog = setTimeout(() => resolveWatchdog("outer-watchdog"), 2_000); })]);
      assert(failure instanceof QtNativeStartupUnprovenError,
        "Failed startup must return a held owner instead of waiting indefinitely or forgetting its child.");
      assert.equal(failure.outcomeUnknown, true);
      assert(failure.cause instanceof Error, "The original startup error remains available internally.");
      assert.equal(failure.retirement.processExited, false);
      assert.equal(kills, 1, "Failed readiness starts exactly one owned-child cleanup attempt.");
      const completion = await Promise.race([failure.retirement.close().then(() => true),
        new Promise(resolveObservation => { observation = setTimeout(() => resolveObservation(false), 20); })]);
      assert.equal(completion, completed, "An ignored kill with no error or exit must leave retirement pending.");
      assert.doesNotThrow(() => child.emit("error", Error("Synthetic repeated child error")),
        "A later owned-child error must not crash the controller.");
      await failure.retirement.close();
      assert.equal(failure.retirement.processExited, false, "Error-fulfilled completion is not actual exit proof.");
      child.emit("exit", 1);
      assert.equal(failure.retirement.processExited, true);
    } finally {
      clearTimeout(watchdog); clearTimeout(observation);
      child.emit("exit", 1);
      await pending.catch(() => undefined);
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    }
  }
}
