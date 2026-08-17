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

const preAbortedController = new AbortController();
preAbortedController.abort();
const preAbortedQueue = Array.from(
  { length: MAX_WORKER_QUEUE_DEPTH + 1 },
  () => callWorker("health", {}, 90_000, preAbortedController.signal),
);
const preAbortedResults = await Promise.allSettled(preAbortedQueue);
assert(preAbortedResults.every(
  (result) => result.status === "rejected" && result.reason?.kind === "aborted",
), "Schon abgebrochene Auftraege duerfen keinen Queueplatz belegen oder als busy erscheinen.");

const blocker = callWorker("health", {}, 90_000);
const queuedControllers = Array.from(
  { length: MAX_WORKER_QUEUE_DEPTH - 1 },
  () => new AbortController(),
);
const cancelledQueue = queuedControllers.map(
  (queuedController) => callWorker("health", {}, 90_000, queuedController.signal),
);
await assert.rejects(
  callWorker("health", {}, 90_000),
  (error) => error?.kind === "busy",
  "Eine wirklich belegte Queue muss vor unbegrenztem Speicherwachstum fail-closed ablehnen.",
);
const preAbortedWhileFull = new AbortController();
preAbortedWhileFull.abort();
await assert.rejects(
  callWorker("health", {}, 90_000, preAbortedWhileFull.signal),
  (error) => error?.kind === "aborted",
  "Ein bereits abgebrochener Aufruf darf selbst bei voller Queue nicht als busy fehlklassifiziert werden.",
);
for (const queuedController of queuedControllers) queuedController.abort();
const cancelledQueueResults = await Promise.allSettled(cancelledQueue);
assert(cancelledQueueResults.every(
  (result) => result.status === "rejected" && result.reason?.kind === "aborted",
), "Abgebrochene wartende Auftraege muessen einheitlich als aborted enden.");

const recoveredAfterQueueCancellation = callWorker("health", {}, 90_000);
const [blockerResult, recovered] = await Promise.all([blocker, recoveredAfterQueueCancellation]);
for (const result of [blockerResult, recovered]) {
  assert.equal(typeof result.ok, "boolean");
  assert(Object.hasOwn(result, "running"), JSON.stringify(result));
}
const longDiagnostic = "ä".repeat(MAX_WORKER_DIAGNOSTIC_CHARACTERS + 100);
const summarized = summarizeWorkerDiagnostic(longDiagnostic);
assert(summarized.startsWith("ä".repeat(MAX_WORKER_DIAGNOSTIC_CHARACTERS)));
assert.match(summarized, /Diagnose gekuerzt: \d+ UTF-8-Bytes, sha256=[a-f0-9]{64}/);
assert.equal(summarizeWorkerDiagnostic("kurz"), "kurz");
assert.deepEqual(parseWorkerResult('{"ok":true,"value":1}', "synthetic"), { ok: true, value: 1 });
for (const malformed of ["kein-json", "null", "[]", "{}", '{"ok":"true"}']) {
  assert.throws(() => parseWorkerResult(malformed, "synthetic"), /kein JSON|Ergebnisobjekt.*ok-Status/);
}
process.stdout.write("Worker-Timeout: Timeout/Abbruch, Queue-Freigabe/-Limit, Diagnoselimit und Folgeaufruf bestanden\n");
