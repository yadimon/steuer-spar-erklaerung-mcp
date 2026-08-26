import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiExecutor } from "../dist/api-executor.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-bulk-action-"));
const config = {
  host: "127.0.0.1",
  port: 43127,
  configPath: join(temporary, "config.json"),
  profileId: "2025",
  caseDir: join(temporary, "cases"),
  workspaceDir: join(temporary, "workspace"),
  documentsDir: join(temporary, "documents"),
  resultDir: join(temporary, "results"),
  backupsDir: join(temporary, "backups"),
  sseExecutable: "C:\\Program Files\\SSE 2025\\SSE.exe",
};
mkdirSync(config.documentsDir, { recursive: true });

test.after(() => rmSync(temporary, { recursive: true, force: true }));

test("fill_fields compiles the complete typed plan into one internal worker call", async () => {
  const calls = [];
  const execute = createApiExecutor(config, async (operation, args, timeoutMs, signal) => {
    calls.push({ operation, args, timeoutMs, signal });
    return {
      ok: true,
      schemaVersion: 1,
      planKind: "fill-fields",
      completed: args.actions,
      failedAction: null,
      failedIndex: null,
      skipped: [],
      rollback: { mode: "best-effort", attempted: false, ok: null, entries: [] },
      cleanupRequired: false,
      finalReadback: { ok: true, pageId: args.finalReadbackPlan.args.pageId },
      finalReadbackVerified: true,
      resultingState: "completed-verified",
      verified: true,
      performance: { workerProcessCount: 1 },
    };
  });

  const result = await execute("fill_fields", {
    pageId: "gew.fahrzeug",
    fields: [
      { fieldId: "bezeichnung", expectedBefore: "Alt", value: "Neu", expectedAfter: "Neu" },
      { fieldId: "kennzeichen", expectedBefore: "N-OLD", value: "N-NEW", expectedAfter: "N-NEW" },
    ],
    expectedEpoch: "A".repeat(64),
    stopOnError: true,
    rollback: "best-effort",
    finalReadback: true,
    hwnd: 4242,
  }, 45_000);

  assert.equal(result.ok, true);
  assert.equal(result.resultingState, "completed-verified");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "bulk_action");
  assert.equal(calls[0].args.actions.length, 2);
  assert.equal(calls[0].args.actions[0].args.expectedEpoch, "A".repeat(64));
  assert.equal(calls[0].args.actions[1].args.expectedEpoch, undefined);
  assert.equal(calls[0].args.actions.every((action) => (
    action.operation === "tracked_set_value"
    && action.args.pageId === "gew.fahrzeug"
    && !("aid" in action.args)
    && !("rid" in action.args)
    && !("name" in action.args)
  )), true);
  assert.deepEqual(calls[0].args.finalReadbackPlan, {
    operation: "known_page_state",
    args: { pageId: "gew.fahrzeug", hwnd: 4242 },
  });
});

test("fill_fields validates every page-object field before starting a worker", async () => {
  let workerCalls = 0;
  const execute = createApiExecutor(config, async () => {
    workerCalls += 1;
    return { ok: true };
  });
  const result = await execute("fill_fields", {
    pageId: "gew.fahrzeug",
    fields: [{ fieldId: "nicht-vorhanden", expectedBefore: "", value: "x", expectedAfter: "x" }],
  }, 30_000);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "bad-args");
  assert.equal(workerCalls, 0);
});

test("fill_fields reports unknown after worker cancellation instead of allowing a blind retry", async () => {
  let workerCalls = 0;
  const controller = new AbortController();
  const execute = createApiExecutor(config, async (_operation, _args, _timeoutMs, signal) => {
    workerCalls += 1;
    assert.equal(signal, controller.signal);
    controller.abort("test cancellation after worker start");
    assert.equal(signal.aborted, true);
    const cancellation = new Error("aborted after mutation boundary");
    cancellation.kind = "cancelled";
    throw cancellation;
  });
  const result = await execute("fill_fields", {
    pageId: "gew.fahrzeug",
    fields: [{ fieldId: "bezeichnung", expectedBefore: "Alt", value: "Neu", expectedAfter: "Neu" }],
  }, 30_000, controller.signal);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "cancelled");
  assert.equal(result.resultingState, "unknown");
  assert.equal(result.cleanupRequired, true);
  assert.equal(result.verified, false);
  assert.equal(result.performance.workerProcessCount, 1);
  assert.equal(workerCalls, 1);
});

test("receipt bulk reports timeout as unknown and never starts a retry worker", async () => {
  const receipt = Buffer.from("%PDF-1.4 timeout receipt\n", "utf8");
  const receiptPath = join(config.documentsDir, "timeout.pdf");
  writeFileSync(receiptPath, receipt);
  const expectedHash = createHash("sha256").update(receipt).digest("hex");
  let workerCalls = 0;
  const execute = createApiExecutor(config, async () => {
    workerCalls += 1;
    const timeout = new Error("worker timed out after mutation boundary");
    timeout.kind = "timeout";
    throw timeout;
  });
  const result = await execute("receipt_manager_bulk_upsert", {
    items: [{
      resourceRef: "documents:timeout.pdf",
      expectedHash,
      identity: { exactTitle: "Timeout", documentNumber: "T-1" },
      values: { title: "Timeout", documentNumber: "T-1" },
    }],
    acknowledgeBulkUpsert: true,
    stopOnError: true,
  }, 1_000);

  assert.equal(result.ok, false);
  assert.equal(result.kind, "timeout");
  assert.equal(result.resultingState, "unknown");
  assert.equal(result.cleanupRequired, true);
  assert.equal(result.finalReadbackVerified, false);
  assert.equal(workerCalls, 1);
});

test("receipt bulk resolves every document and starts exactly one worker", async () => {
  const receipt = Buffer.from("%PDF-1.4 synthetic bulk receipt\n", "utf8");
  const receiptPath = join(config.documentsDir, "bulk.pdf");
  writeFileSync(receiptPath, receipt);
  const expectedHash = createHash("sha256").update(receipt).digest("hex");
  const calls = [];
  const execute = createApiExecutor(config, async (operation, args) => {
    calls.push({ operation, args });
    return {
      ok: true,
      requestedCount: 1,
      completedCount: 1,
      completed: [],
      failedIndex: null,
      skipped: [],
      rollback: { mode: "best-effort", attempted: false, ok: null, entries: [] },
      cleanupRequired: false,
      finalReadback: { verified: true },
      resultingState: "completed-verified",
      verified: true,
      performance: { workerProcessCount: 1 },
    };
  });
  const result = await execute("receipt_manager_bulk_upsert", {
    items: [{
      resourceRef: "documents:bulk.pdf",
      expectedHash,
      identity: { exactTitle: "Bulk", documentNumber: "B-1" },
      values: { title: "Bulk", documentNumber: "B-1", amount: "12.34" },
    }],
    acknowledgeBulkUpsert: true,
    stopOnError: true,
  }, 60_000);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "receipt_manager_bulk_upsert");
  assert.equal(calls[0].args.items[0].expectedPath, receiptPath);
  assert.equal(result.resourceRefs["items.0.resourceRef"], "documents:bulk.pdf");
  assert.equal(JSON.stringify(result).includes(receiptPath), false);
});
