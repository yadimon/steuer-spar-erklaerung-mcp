import { openSync, fstatSync, readSync, closeSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const readinessError = (code, message, cause) => Object.assign(
  new Error(message, cause ? { cause } : undefined), { code });
const tooLarge = maxBytes => readinessError("FIXTURE_READY_TOO_LARGE",
  `Owned fixture readiness file exceeds the ${maxBytes}-byte limit`);

function readBoundedReadyFile(infoPath, _encoding, maxBytes) {
  const fd = openSync(infoPath, "r");
  try {
    if (fstatSync(fd).size > maxBytes) throw tooLarge(maxBytes);
    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maxBytes) throw tooLarge(maxBytes);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)); }
    catch (error) { throw new SyntaxError("Fixture readiness JSON has incomplete or invalid UTF8", { cause: error }); }
  } finally { closeSync(fd); }
}

/** Read the owned fixture's startup file; the caller verifies its exact identity. */
export async function readNativeFixtureReady(infoPath, {
  isRunning = () => true, diagnostic = () => "", timeoutMs = 10_000, pollMs = 20,
  maxBytes = 65_536, readFile = readBoundedReadyFile,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("Readiness timeout must be finite and positive");
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new TypeError("Readiness poll interval must be finite and positive");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("Readiness byte limit must be a positive safe integer");
  const deadline = Date.now() + timeoutMs;
  let lastParseError;
  for (;;) {
    if (!isRunning()) throw readinessError("FIXTURE_READY_EXITED",
      "Owned fixture exited before readiness: " + diagnostic(), lastParseError);
    if (Date.now() >= deadline) throw readinessError("FIXTURE_READY_TIMEOUT",
      "Owned fixture did not become ready before its deadline. Last parse error: "
        + (lastParseError?.message ?? "none; file not yet published") + ". " + diagnostic(), lastParseError);
    try {
      const text = readFile(infoPath, "utf8", maxBytes);
      if (Buffer.byteLength(text, "utf8") > maxBytes) throw tooLarge(maxBytes);
      return JSON.parse(text);
    } catch (error) {
      // The owned producer can expose its path before writing all JSON bytes.
      // Only readiness reads repeat; no application operation is replayed.
      if (error instanceof SyntaxError) lastParseError = error;
      else if (error.code === "FIXTURE_READY_TOO_LARGE") throw error;
      else if (error.code !== "ENOENT") throw readinessError(error.code ?? "FIXTURE_READY_IO_ERROR",
        "Could not read owned fixture readiness file: " + error.message, error);
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(pollMs, remaining));
  }
}
