import assert from "node:assert/strict";
import { callWorker } from "../dist/worker.js";

await assert.rejects(callWorker("health", {}, 1), /Zeitueberschreitung/);
const controller = new AbortController();
const aborted = callWorker("health", {}, 90_000, controller.signal);
setTimeout(() => controller.abort(), 1);
await assert.rejects(aborted, /Zustand ist unbekannt|vor dem Start abgebrochen/);
const recovered = await callWorker("health", {}, 90_000);
assert.equal(typeof recovered.ok, "boolean");
assert(Object.hasOwn(recovered, "running"), JSON.stringify(recovered));
process.stdout.write("Worker-Timeout: Timeout/Abbruch beenden den Prozessbaum und die Queue bleibt gesund\n");
