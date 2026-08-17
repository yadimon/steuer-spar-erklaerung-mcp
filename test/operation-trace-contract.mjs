import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceOperations } from "./operation-trace.mjs";

const directory = mkdtempSync(join(tmpdir(), "sse-operation-trace-contract-"));
try {
  const execute = traceOperations("worker", async () => ({ ok: true }), {
    SSE_TEST_OPERATION_TRACE_DIR: directory,
    SSE_PROFILE_ID: "2024",
  });
  await execute("page", {}, 1, undefined);
  const [file] = (await import("node:fs")).readdirSync(directory);
  const [record] = readFileSync(join(directory, file), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(record.profileId, "2024", "Trace muss das echte Produktprofil mitprotokollieren.");
  assert.equal(record.operation, "page");
  assert.equal(record.ok, true);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

process.stdout.write("OK: Operation-Traces enthalten das aktive Produktprofil.\n");
