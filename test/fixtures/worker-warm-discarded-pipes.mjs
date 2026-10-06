import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const pool = await import("../../dist/worker-prewarm.js");
pool.enableWorkerPrewarm();
const deadline = performance.now() + 10_000;
while (!pool.isWarmSpareReady() && performance.now() < deadline) await delay(10);
assert.equal(pool.isWarmSpareReady(), true, "The inherited-pipe worker did not become ready.");
pool.shutdownWarmSpare();
assert.deepEqual(pool.warmSparePoolStatus(), { ready: 0, starting: 0, target: 1 });
console.log("Discarded spare releases inherited pipes without waiting for a descendant.");
// The parent test keeps the owned descendant alive until this process exits.
// A leaked stdout/stderr pipe must therefore fail the parent's bounded wait.
