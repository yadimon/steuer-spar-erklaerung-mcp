import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { startQtNativeBroker } from "../dist/qt-native-broker.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";

assert.equal(process.argv.length, 3);
const channel = process.argv[2];
assert(["stdout", "stderr"].includes(channel));

// A separate process proves that an unhandled stream error cannot terminate
// the API owner. The monitor observes failures without swallowing them.
const monitor = () => process.stdout.write(JSON.stringify({ unhandledStreamFailure: true }) + "\n");
process.on("uncaughtExceptionMonitor", monitor);
const childProcess = createRequire(import.meta.url)("node:child_process");
const originalSpawn = childProcess.spawn;
let child, exitQueued = false, exited = false, spawns = 0;
const requests = [];
childProcess.spawn = (_file, args) => {
  spawns++;
  assert.deepEqual(args, ["--broker"]);
  child = new EventEmitter(); child.pid = 4242;
  child.once("exit", () => { exited = true; });
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const request = JSON.parse(chunk.subarray(4)); requests.push(request.mode ?? request.op);
    assert.equal(request.mode, "attach");
    callback();
    queueMicrotask(() => child[channel].emit("error", new Error("SYNTH42")));
  } });
  child.kill = () => {
    if (!exitQueued) {
      exitQueued = true;
      queueMicrotask(() => child.emit("exit", 0, null));
    }
    return true;
  };
  return child;
};
syncBuiltinESMExports();
try {
  await assert.rejects(startQtNativeBroker({
    package: { loaderPath: "synthetic-loader", bridgePath: process.execPath,
      manifest: { buildIdentity: "a".repeat(64), profile: { taxYear: 2025, engineFileMajor: 31 } } },
    target: { pid: process.pid, hwnd: 42, creationTime: "134000000000000000" },
    expectedImage: process.execPath, timeoutMs: 1000,
  }), error => {
    assert(error instanceof QtNativeTransportError); assert.equal(error.kind, "native-startup");
    assert.equal(error.outcomeUnknown, true); assert.equal(error.message.includes("SYNTH42"), false);
    return true;
  });
  assert.equal(exited, true); assert.equal(spawns, 1);
  assert.deepEqual(requests, ["attach"], "A broken startup channel must not dispatch pings or reconnect.");
  assert.equal(child.stdout.listenerCount("readable"), 0);
  process.stdout.write(JSON.stringify({ ok: true, channel, spawns, verifiedExit: exited }) + "\n");
} finally {
  childProcess.spawn = originalSpawn; syncBuiltinESMExports();
  child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy();
  process.off("uncaughtExceptionMonitor", monitor);
}
