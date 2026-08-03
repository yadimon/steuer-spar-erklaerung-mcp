import assert from "node:assert/strict";
import { withCombinedAbortSignal } from "../dist/abort.js";

const waitForAbort = (signal) => new Promise((resolve) => {
  if (signal.aborted) resolve("aborted");
  else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
});

const request = new AbortController();
const shutdown = new AbortController();
const shutdownReason = new Error("controlled shutdown");
const byShutdown = withCombinedAbortSignal([request.signal, shutdown.signal], async (signal) => {
  await waitForAbort(signal);
  return signal.reason;
});
shutdown.abort(shutdownReason);
assert.equal(await byShutdown, shutdownReason, "Shutdown-Grund muss unveraendert weitergereicht werden");

const requestTwo = new AbortController();
const shutdownTwo = new AbortController();
const requestReason = { kind: "client-disconnected" };
const byRequest = withCombinedAbortSignal([requestTwo.signal, shutdownTwo.signal], async (signal) => {
  await waitForAbort(signal);
  return signal.reason;
});
requestTwo.abort(requestReason);
assert.equal(await byRequest, requestReason, "Request-Grund muss unveraendert weitergereicht werden");

const alreadyAborted = new AbortController();
const alreadyReason = new DOMException("already stopped", "AbortError");
alreadyAborted.abort(alreadyReason);
assert.equal(
  await withCombinedAbortSignal([alreadyAborted.signal], (signal) => Promise.resolve(signal.reason)),
  alreadyReason,
);

const completed = await withCombinedAbortSignal([new AbortController().signal], async (signal) => {
  assert.equal(signal.aborted, false);
  return "complete";
});
assert.equal(completed, "complete");

const duplicate = new AbortController();
const duplicateReason = new Error("one source, listed twice");
const duplicated = withCombinedAbortSignal([duplicate.signal, duplicate.signal], async (signal) => {
  await waitForAbort(signal);
  return signal.reason;
});
duplicate.abort(duplicateReason);
assert.equal(await duplicated, duplicateReason);

process.stdout.write("API-Shutdown: Request- und Prozessabbruchgruende werden unveraendert weitergegeben\n");
