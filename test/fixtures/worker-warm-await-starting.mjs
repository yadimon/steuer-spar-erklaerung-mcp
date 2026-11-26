/**
 * Ohne bereite Reserve wartet ein Aufruf auf eine, die schon weit im Start ist,
 * statt kalt zu starten - begrenzt durch den Vorsprung der Reserve, die Frist
 * des Aufrufs und einen Abbruch des Aufrufers.
 *
 * Die Reserven dieses Fixtures brauchen eine feste, grosszuegige Zeit bis zur
 * Bereitschaft; ein Kaltstart antwortet sofort. Jedes Ergebnis nennt Art und
 * Startnummer seines Prozesses, sodass der Test nie raten muss, wer geantwortet
 * hat. Alle Zeitabstaende haben mehr als eine Sekunde Reserve zu ihrer Grenze.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const statePath = process.env.SSE_PREWARM_FIXTURE_STATE;
assert(statePath && isAbsolute(statePath), "Starting-reserve fixture state path is missing or relative.");
const readyDelayMs = Number(process.env.SSE_PREWARM_FIXTURE_READY_DELAY_MS);
assert(Number.isInteger(readyDelayMs) && readyDelayMs >= 6_000,
  "The starting-reserve fixture needs a generous readiness delay for its timing margins.");

const pool = await import("../../dist/worker-prewarm.js");
const worker = await import("../../dist/worker.js");

function stateLines() {
  return existsSync(statePath) ? readFileSync(statePath, "utf8").split(/\r?\n/u) : [];
}

/** Launch numbers of one kind ("reserve" or "cold") in the order the processes started. */
function launchesOfKind(kind) {
  return stateLines()
    .map((line) => /^kind\|([1-9]\d{0,9})\|(reserve|cold)$/u.exec(line))
    .filter((match) => match !== null && match[2] === kind)
    .map((match) => Number(match[1]));
}

function launchedPids() {
  return stateLines()
    .map((line) => /^launch\|[1-9]\d{0,9}\|([1-9]\d{0,9})$/u.exec(line))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]));
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, message, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

try {
  assert.equal(pool.startingSpareWaitMs(), 0, "A disabled pool offers nothing to wait for.");
  pool.enableWorkerPrewarm();
  await waitFor(() => pool.warmSparePoolStatus().starting === 1, "The first reserve did not start.");
  assert.equal(pool.startingSpareWaitMs(), 0,
    "Before any reserve became ready there is no measure for a head start, hence no waiting.");
  await waitFor(() => pool.warmSparePoolStatus().ready === 1, "The first reserve did not become ready.");

  // 1) A ready reserve is taken at once; its replacement starts right away.
  const taken = await worker.callWorker("product_info", {}, 30_000);
  assert.deepEqual(taken, { ok: true, fixture: "reserve", launch: launchesOfKind("reserve")[0] });
  assert.deepEqual(pool.warmSparePoolStatus(), { ready: 0, starting: 1, target: 1 });

  // 2) The replacement has no head start yet: the next call starts cold, as before.
  assert.equal(pool.startingSpareWaitMs(), 0, "A reserve that has only just started is not worth waiting for.");
  const cold = await worker.callWorker("product_info", {}, 30_000);
  assert.equal(cold.fixture, "cold", "Without a head start the call must not wait for the replacement.");
  assert.deepEqual(launchesOfKind("cold"), [cold.launch]);

  // 3) Well into its startup the reserve is worth waiting for - but a call
  //    spends at most half of its own deadline on that, then starts cold, and
  //    the cold worker gets only what is left of the deadline. This cold start
  //    never answers, so the reported limit shows the remaining half.
  await delay(readyDelayMs * 0.4);
  assert(pool.startingSpareWaitMs() > 0, "A reserve with a head start must be worth waiting for.");
  const shortDeadlineMs = 1_600;
  const expired = await worker.callWorker("health", {}, shortDeadlineMs).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  assert.equal(expired.value, undefined, "The silent cold start must not produce a result.");
  assert.equal(expired.error?.kind, "timeout");
  const reportedLimitMs = Number(/^Zeitueberschreitung nach (\d+) ms bei 'health'/u.exec(expired.error?.message ?? "")?.[1]);
  assert(reportedLimitMs >= shortDeadlineMs / 8 && reportedLimitMs <= shortDeadlineMs / 2 + 10,
    `After waiting half of its deadline the cold worker must get the remaining half, not ${reportedLimitMs} ms.`);
  assert.equal(launchesOfKind("cold").length, 2, "Waiting must give way to a cold start within the deadline.");

  // 4) A caller that aborts while waiting never starts a worker, and the
  //    awaited reserve stays in the pool.
  const abortController = new AbortController();
  const abortedOutcome = worker.callWorker("product_info", {}, 30_000, abortController.signal).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await delay(150);
  abortController.abort();
  const aborted = await abortedOutcome;
  assert.equal(aborted.value, undefined, "An aborted wait must not produce a result.");
  assert.equal(aborted.error?.kind, "aborted");
  assert.match(aborted.error?.message ?? "", /kein Worker wurde gestartet/u);
  assert.equal(launchesOfKind("cold").length, 2, "An aborted wait must not start a worker.");
  assert.deepEqual(pool.warmSparePoolStatus(), { ready: 0, starting: 1, target: 1 });

  // 5) A patient call waits for that very reserve and is served by it - the
  //    moment it becomes ready: no observer may ever see it left in the pool.
  const readyCountsWhileWaiting = [];
  let awaitedSettled = false;
  const observer = (async () => {
    while (!awaitedSettled) {
      readyCountsWhileWaiting.push(pool.warmSparePoolStatus().ready);
      await delay(10);
    }
  })();
  const awaited = await worker.callWorker("product_info", {}, 30_000).finally(() => { awaitedSettled = true; });
  await observer;
  assert.deepEqual(awaited, { ok: true, fixture: "reserve", launch: launchesOfKind("reserve")[1] });
  assert.equal(launchesOfKind("cold").length, 2, "The awaited reserve must replace a cold start.");
  assert.equal(Math.max(...readyCountsWhileWaiting), 0,
    "The waiting call must take the reserve as soon as it becomes ready.");
} finally {
  pool.shutdownWarmSpare();
  await waitFor(
    () => launchedPids().every((pid) => !processIsAlive(pid)),
    "Shutdown left a starting-reserve fixture process alive.",
  );
}

process.stdout.write("Starting reserve: awaited with a head start, not without one, bounded by deadline and abort\n");
