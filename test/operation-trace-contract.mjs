import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPERATION_RESULT_FIELD_PATTERN,
  OPERATION_TRACE_LABELS,
  operationResultShape,
  traceOperations,
} from "./operation-trace.mjs";

assert(OPERATION_TRACE_LABELS.includes("profile-catalog"));

const directory = mkdtempSync(join(tmpdir(), "sse-operation-trace-contract-"));
try {
  const execute = traceOperations("worker", async () => ({
    ok: true,
    verified: false,
    count: 0,
    warning: null,
    rows: [{ privateValue: "nicht protokollieren" }],
    binding: { path: "C:\\Privat\\fall.Gew2025" },
    omitted: undefined,
  }), {
    SSE_TEST_OPERATION_TRACE_DIR: directory,
    SSE_PROFILE_ID: "2024",
  });
  await execute("page", {}, 1, undefined);
  const failing = traceOperations("worker", async () => {
    throw new Error("synthetischer Executorfehler");
  }, { SSE_TEST_OPERATION_TRACE_DIR: directory, SSE_PROFILE_ID: "2024" });
  await assert.rejects(() => failing("health", {}, 1, undefined), /synthetischer Executorfehler/u);
  const records = readdirSync(directory).flatMap((file) =>
    readFileSync(join(directory, file), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
  const record = records.find((entry) => entry.operation === "page");
  assert.equal(record.profileId, "2024", "Trace muss das echte Produktprofil mitprotokollieren.");
  assert.equal(record.operation, "page");
  assert.equal(record.ok, true);
  assert.deepEqual(record.fields, {
    ok: "boolean",
    verified: "boolean",
    count: "nonnegative-number",
    warning: "null",
    rows: "array-one:object",
    binding: 'object:{"path":"string-other"}',
  });
  assert(!JSON.stringify(record).includes("nicht protokollieren"));
  assert(!JSON.stringify(record).includes("Privat"));
  const failedRecord = records.find((entry) => entry.operation === "health");
  assert.equal(failedRecord.threw, true);
  assert.deepEqual(failedRecord.fields, {});
} finally {
  rmSync(directory, { recursive: true, force: true });
}

assert.deepEqual(operationResultShape({ offset: -1, text: "x" }), {
  offset: "negative-number",
  text: "string-other",
});
assert.deepEqual(operationResultShape({
  empty: "",
  hash: "A".repeat(64),
  unknown: "unknown",
  values: ["eins", "zwei"],
  mixed: ["eins", { name: "zwei" }],
}), {
  empty: "string-empty",
  hash: "string-hex64",
  unknown: "string-unknown",
  values: "array-many:string-other",
  mixed: "array-many:mixed",
});
assert.equal(
  operationResultShape({ shot: { path: "results:shot.png", w: 1, h: 2 } }).shot,
  'object:{"h":"nonnegative-number","path":"string-other","w":"nonnegative-number"}',
);
assert.equal(operationResultShape({ invalid: Number.POSITIVE_INFINITY }).invalid, "nonfinite-number");
assert(OPERATION_RESULT_FIELD_PATTERN.test("configurationFingerprint"));
assert.throws(() => operationResultShape({ "C:\\Privat\\fall": true }), /Unsicherer Ergebnisfeldname/u);
assert.throws(() => operationResultShape({ ["A".repeat(65)]: true }), /Unsicherer Ergebnisfeldname/u);

process.stdout.write("OK: Operation-Traces enthalten Profil und wertfreie Ergebnisformen.\n");
