import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { readNativeFixtureReady } from "./native-fixture-ready.mjs";

const prefix = "sse-native-ready-contract-";
const root = resolve(mkdtempSync(join(tmpdir(), prefix)));
const timers = new Set();
const expected = { pid: 123, hwnd: 456, creationTime: "789", desktop: "SyntheticDesktop",
  inputDesktop: "Default", visible: true, name: "Native field – пример" };
const options = { timeoutMs: 1000, pollMs: 2 };
const later = (ms, action) => {
  const timer = setTimeout(() => { timers.delete(timer); action(); }, ms);
  timers.add(timer);
};

try {
  // A real already-existing truncated file reproduces the startup publication
  // race. The original existence-then-single-parse helper rejects immediately.
  const partial = join(root, "partial.json");
  writeFileSync(partial, '{"pid":');
  const partialReady = readNativeFixtureReady(partial, options);
  later(15, () => writeFileSync(partial, JSON.stringify(expected)));
  await assert.doesNotReject(partialReady,
    "A visible startup file must not be parsed as ready before its JSON write completes");
  assert.deepEqual(await partialReady, expected);

  const empty = join(root, "empty-utf8.json");
  const utf8 = Buffer.from(JSON.stringify(expected));
  const split = utf8.indexOf(Buffer.from("–")) + 1;
  writeFileSync(empty, "");
  const emptyReady = readNativeFixtureReady(empty, options);
  later(10, () => writeFileSync(empty, utf8.subarray(0, split)));
  later(25, () => writeFileSync(empty, utf8));
  assert.deepEqual(await emptyReady, expected,
    "Empty and partial UTF8 writes must settle to the exact complete value");

  const publishedLater = join(root, "published-later.json");
  const laterReady = readNativeFixtureReady(publishedLater, options);
  later(10, () => writeFileSync(publishedLater, JSON.stringify(expected) + "\r\n"));
  assert.deepEqual(await laterReady, expected, "Delayed publication and CRLF are valid");

  const complete = join(root, "complete.json");
  writeFileSync(complete, JSON.stringify(expected));
  assert.deepEqual(await readNativeFixtureReady(complete, options), expected);
  for (const option of ["timeoutMs", "pollMs"]) {
    for (const invalid of [0, -1, NaN, Infinity]) {
      await assert.rejects(readNativeFixtureReady(complete, { ...options, [option]: invalid }), TypeError);
    }
  }

  const inaccessible = join(root, "inaccessible.json");
  writeFileSync(inaccessible, JSON.stringify(expected));
  const denied = Object.assign(new Error("Synthetic access denied"), { code: "EACCES" });
  // Access ACLs differ across operating systems and elevated test accounts.
  // Only this read failure is injected; the readiness path is a real file.
  await assert.rejects(readNativeFixtureReady(inaccessible, { ...options,
    readFile() { throw denied; } }), error => error.code === "EACCES"
      && /fixture.*read|read.*fixture/iu.test(error.message),
  "An access failure must be immediate and retain its I/O code with fixture context");

  const directory = join(root, "directory.json");
  mkdirSync(directory);
  await assert.rejects(readNativeFixtureReady(directory, options),
    error => ["EISDIR", "EACCES", "EPERM"].includes(error.code)
      && /fixture.*read|read.*fixture/iu.test(error.message),
    "A real non-file I/O error must be explicit rather than retried as partial JSON");

  let running = true;
  const exited = readNativeFixtureReady(join(root, "never-published.json"), {
    ...options, isRunning: () => running, diagnostic: () => "Synthetic fixture stderr",
  });
  later(10, () => { running = false; });
  await assert.rejects(exited, error => error.code === "FIXTURE_READY_EXITED"
    && /Synthetic fixture stderr/u.test(error.message));

  const missingStarted = performance.now();
  await assert.rejects(readNativeFixtureReady(join(root, "missing.json"), { timeoutMs: 20, pollMs: 2 }),
    error => error.code === "FIXTURE_READY_TIMEOUT");
  assert(performance.now() - missingStarted < 1000, "A missing readiness file has a bounded deadline");

  const invalid = join(root, "invalid.json");
  writeFileSync(invalid, '{"pid":');
  const invalidStarted = performance.now();
  await assert.rejects(readNativeFixtureReady(invalid, { timeoutMs: 20, pollMs: 2 }),
    error => error.code === "FIXTURE_READY_TIMEOUT" && error.cause instanceof SyntaxError
      && /last.*parse|parse.*last/iu.test(error.message),
    "A permanently incomplete file must retain its last parse failure at the same deadline");
  assert(performance.now() - invalidStarted < 1000, "Partial JSON must not extend the deadline");

  const oversized = join(root, "oversized.json");
  writeFileSync(oversized, JSON.stringify({ padding: "x".repeat(129) }));
  await assert.rejects(readNativeFixtureReady(oversized, { ...options, maxBytes: 128 }),
    error => error.code === "FIXTURE_READY_TOO_LARGE",
    "Readiness input has a finite byte limit even when oversized JSON is otherwise valid");

  console.log("PASS owned fixture readiness publication, UTF8, CRLF, I/O failures, process exit, deadlines and byte limits");
} finally {
  for (const timer of timers) clearTimeout(timer);
  assert.equal(dirname(root), resolve(tmpdir()));
  assert(basename(root).startsWith(prefix));
  rmSync(root, { recursive: true, force: true });
}
