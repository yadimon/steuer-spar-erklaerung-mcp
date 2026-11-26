/**
 * Steht eine Reserve bereit, wartet kein Aufruf auf eine andere, die noch
 * startet - auch dann nicht, wenn diese schon weit im Start ist.
 *
 * Zwei Reserven brauchen dieselbe feste, grosszuegige Zeit bis zur
 * Bereitschaft. Der erste Aufruf nimmt eine davon; ihr Ersatz bekommt einen
 * Vorsprung, waehrend die zweite weiter bereitsteht. Jedes Ergebnis nennt die
 * Startnummer seines Prozesses, sodass der Test nie raten muss, wer geantwortet
 * hat. Alle Zeitabstaende haben mehr als eine Sekunde Reserve zu ihrer Grenze.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const statePath = process.env.SSE_PREWARM_FIXTURE_STATE;
assert(statePath && isAbsolute(statePath), "Ready-reserve fixture state path is missing or relative.");
const readyDelayMs = Number(process.env.SSE_PREWARM_FIXTURE_READY_DELAY_MS);
assert(Number.isInteger(readyDelayMs) && readyDelayMs >= 6_000,
  "The ready-reserve fixture needs a generous readiness delay for its timing margins.");

const pool = await import("../../dist/worker-prewarm.js");
const worker = await import("../../dist/worker.js");

function stateLines() {
  return existsSync(statePath) ? readFileSync(statePath, "utf8").split(/\r?\n/u) : [];
}

/** Launch numbers of all reserves started so far, ascending. */
function reserveLaunches() {
  return stateLines()
    .map((line) => /^kind\|([1-9]\d{0,9})\|reserve$/u.exec(line))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]))
    .sort((left, right) => left - right);
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
  pool.enableWorkerPrewarm();
  await waitFor(() => pool.warmSparePoolStatus().ready === 2, "Both reserves did not become ready.");
  const readyLaunches = reserveLaunches();
  assert.equal(readyLaunches.length, 2, "Exactly the two pooled reserves must have started.");

  // The first call takes one ready reserve; its replacement starts right away.
  const first = await worker.callWorker("product_info", {}, 30_000);
  assert.equal(first.fixture, "reserve");
  assert.deepEqual(pool.warmSparePoolStatus(), { ready: 1, starting: 1, target: 2 });

  // Well into its startup the replacement would be worth waiting for - if no
  // reserve were ready. One still is, so nothing is worth waiting for.
  await delay(readyDelayMs * 0.4);
  assert.deepEqual(pool.warmSparePoolStatus(), { ready: 1, starting: 1, target: 2 });
  assert.equal(pool.startingSpareWaitMs(), 0, "A ready reserve leaves nothing to wait for.");

  const secondStarted = performance.now();
  const second = await worker.callWorker("product_info", {}, 30_000);
  const secondMs = performance.now() - secondStarted;
  assert.equal(second.fixture, "reserve");
  assert.deepEqual([first.launch, second.launch].sort((left, right) => left - right), readyLaunches,
    "Both calls must be served by the reserves that were ready, not by the replacement.");
  assert(secondMs < 2_000, `The ready reserve must answer at once, not after ${Math.round(secondMs)} ms.`);
} finally {
  pool.shutdownWarmSpare();
  await waitFor(
    () => launchedPids().every((pid) => !processIsAlive(pid)),
    "Shutdown left a ready-reserve fixture process alive.",
  );
}

process.stdout.write("Ready reserve: taken at once while another one is still starting\n");
