import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const statePath = process.env.SSE_PREWARM_FIXTURE_STATE;
assert(statePath, "Assigned-job fixture state path is missing.");

const pool = await import("../../dist/worker-prewarm.js");
const worker = await import("../../dist/worker.js");

function records() {
  if (!existsSync(statePath)) return [];
  return readFileSync(statePath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => {
    const [kind, launchText, pidText, encodedJob = ""] = line.split("|");
    return { kind, launch: Number(launchText), pid: Number(pidText), encodedJob };
  });
}

async function waitFor(predicate, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let argsFile;
try {
  pool.enableWorkerPrewarm();
  await waitFor(() => pool.warmSparePoolStatus().ready === 1,
    "Assigned-job fixture did not produce its first ready spare.");
  const first = records().find((record) => record.kind === "launch" && record.launch === 1);
  assert(first?.pid > 0, "First assigned-job fixture PID is missing.");

  const timeoutOutcome = worker.callWorker("product_info", {}, 500).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await waitFor(() => records().some((record) => record.kind === "job" && record.launch === 1),
    "The ready spare did not receive its assigned job before the deadline.");
  const assigned = records().find((record) => record.kind === "job" && record.launch === 1);
  const job = JSON.parse(Buffer.from(assigned.encodedJob, "base64").toString("utf8"));
  argsFile = job.argsFile;
  assert.equal(typeof argsFile, "string");
  assert.equal(existsSync(argsFile), true, "Assigned worker argument file was never observable.");

  const outcome = await timeoutOutcome;
  assert.equal(outcome.value, undefined, "Blocked warm worker unexpectedly returned a result.");
  assert.equal(outcome.error?.kind, "timeout", "Blocked warm worker was not classified as timeout.");
  await waitFor(() => !processIsAlive(first.pid), "Timed-out warm worker remained alive.");
  assert.equal(existsSync(argsFile), false, "Timed-out warm worker argument file was not removed.");

  await waitFor(() => pool.warmSparePoolStatus().ready === 1,
    "Pool did not provide a replacement after the assigned-job timeout.");
  const replacement = await worker.callWorker("product_info", {}, 5_000);
  assert.deepEqual(replacement, { ok: true, fixture: "replacement" },
    "Replacement spare did not complete the follow-up call.");
} finally {
  pool.shutdownWarmSpare();
  await waitFor(
    () => records().filter((record) => record.kind === "launch").every((record) => !processIsAlive(record.pid)),
    "Shutdown left an owned assigned-job fixture process alive.",
  );
  if (argsFile && existsSync(argsFile)) rmSync(argsFile, { force: true });
}

process.stdout.write("Warm assigned-job timeout: exact child cleanup, temp cleanup, replacement and shutdown passed\n");
