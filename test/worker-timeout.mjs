import assert from "node:assert/strict";
import {
  callWorker,
  MAX_WORKER_DIAGNOSTIC_CHARACTERS,
  parseWorkerResult,
  summarizeWorkerDiagnostic,
} from "../dist/worker.js";
import { MAX_WORKER_QUEUE_DEPTH } from "../dist/api-contract.js";

await assert.rejects(callWorker("health", {}, 1), /Zeitueberschreitung/);
const controller = new AbortController();
const aborted = callWorker("health", {}, 90_000, controller.signal);
setTimeout(() => controller.abort(), 1);
await assert.rejects(aborted, /Zustand ist unbekannt|vor dem Start abgebrochen/);
const cancelledQueue = Array.from({ length: MAX_WORKER_QUEUE_DEPTH }, () => {
  const queuedController = new AbortController();
  queuedController.abort();
  return callWorker("health", {}, 90_000, queuedController.signal);
});
await assert.rejects(
  callWorker("health", {}, 90_000),
  (error) => error?.kind === "busy",
  "Queue muss vor unbegrenztem Speicherwachstum fail-closed ablehnen",
);
const cancelledQueueResults = await Promise.allSettled(cancelledQueue);
assert(cancelledQueueResults.every((result) => result.status === "rejected"));
const recovered = await callWorker("health", {}, 90_000);
assert.equal(typeof recovered.ok, "boolean");
assert(Object.hasOwn(recovered, "running"), JSON.stringify(recovered));
const longDiagnostic = "ä".repeat(MAX_WORKER_DIAGNOSTIC_CHARACTERS + 100);
const summarized = summarizeWorkerDiagnostic(longDiagnostic);
assert(summarized.startsWith("ä".repeat(MAX_WORKER_DIAGNOSTIC_CHARACTERS)));
assert.match(summarized, /Diagnose gekuerzt: \d+ UTF-8-Bytes, sha256=[a-f0-9]{64}/);
assert.equal(summarizeWorkerDiagnostic("kurz"), "kurz");
assert.deepEqual(parseWorkerResult('{"ok":true,"value":1}', "synthetic"), { ok: true, value: 1 });
for (const malformed of ["kein-json", "null", "[]", "{}", '{"ok":"true"}']) {
  assert.throws(() => parseWorkerResult(malformed, "synthetic"), /kein JSON|Ergebnisobjekt.*ok-Status/);
}
process.stdout.write("Worker-Timeout: Timeout/Abbruch, Queue-Limit, Diagnoselimit und gesunder Folgeaufruf bestanden\n");
