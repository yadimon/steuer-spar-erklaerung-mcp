import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

test("receipt bulk blocks before a timeout-capable worker can start", async () => {
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
      expectedHash: "A".repeat(64),
      identity: { exactTitle: "Timeout", documentNumber: "T-1" },
      values: { title: "Timeout", documentNumber: "T-1" },
    }],
    acknowledgeBulkUpsert: true,
    stopOnError: true,
  }, 1_000);

  assert.equal(result.ok, false);
  assert.equal(result.kind, "blocked");
  assert.equal(result.reason, "foreground-required-operation-disabled");
  assert.equal(result.retryable, false);
  assert.equal(result.mutationStarted, false);
  assert.equal(result.resultingState, "unchanged");
  assert.equal(result.cleanupRequired, false);
  assert.equal(workerCalls, 0);
});

test("receipt bulk still rejects malformed public arguments before the policy block", async () => {
  let workerCalls = 0;
  const execute = createApiExecutor(config, async () => {
    workerCalls += 1;
    return { ok: true };
  });
  const result = await execute("receipt_manager_bulk_upsert", {
    items: [{
      resourceRef: "documents:bulk.pdf",
      expectedHash: "A".repeat(64),
      identity: { exactTitle: "Bulk", documentNumber: "B-1" },
      values: { title: "Bulk", documentNumber: "B-1", amount: "12.34" },
    }],
    acknowledgeBulkUpsert: true,
    stopOnError: true,
    freeSelector: "never-accepted",
  }, 60_000);

  assert.equal(result.ok, false);
  assert.equal(result.kind, "bad-args");
  assert.equal(workerCalls, 0);
});

const appendArgs = {
  expectedPage: "Synthetic table", werte: ["", "02.01", "Synthetic expense", "1,00"],
  sumLabel: "Summe", sumOccurrence: 2, expectedBefore: "1,00", expectedAfter: "2,00", hwnd: 4242,
};
const missingAppendRow = {
  ok: false, kind: "not-found", error: "Keine freie Tabellenzeile gefunden.",
  mutationStarted: false, resultingState: "unchanged", physicalInputUsed: false,
};

async function appendWithCursor(cursor, retried = { ok: true, verified: true, sumAfter: "2,00" }, original = missingAppendRow) {
  const calls = [];
  const execute = createApiExecutor(config, async (operation, args) => {
    calls.push({ operation, args });
    if (operation === "table_read") {
      assert.equal(args.noKeys, false);
      assert.equal(args.maxRows, 400);
      for (const key of ["sumLabel", "sumOccurrence", "hwnd"]) assert.equal(args[key], appendArgs[key]);
      return typeof cursor === "function" ? cursor() : cursor;
    }
    assert.equal(operation, "table_add");
    return calls.length === 1 ? original : retried;
  });
  return { result: await execute("table_add", appendArgs, 30_000), calls };
}

test("append preserves a rejected cursor's bounded diagnosis and unknown cleanup without another write", async () => {
  const { result, calls } = await appendWithCursor({
    ok: false, kind: "interference", phase: "cursor-resume", proofCheck: "native-focus-resume-worker-result",
    vollstaendig: false, anzahl: 6, steps: 0, outcomeUnknown: true, reconciliationRequired: true,
    cleanupRequired: true, activationSubmitted: true, physicalInputAttempted: false, physicalInputUsed: false,
  });
  assert.deepEqual(calls.map(value => value.operation), ["table_add", "table_read"]);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "cursor-proof-failed");
  assert.equal(result.verified, false);
  assert.equal(result.retryable, false);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.cleanupRequired, true);
  assert.equal(result.mutationStarted, null, "A cursor's unknown outcome must not inherit a global no-mutation claim.");
  assert.equal(result.resultingState, "unknown");
  assert.equal(result.physicalInputUsed, false);
  assert.equal(result.freeRowSearch.retriedAfterTableWalk, false);
  assert.equal(result.freeRowSearch.rowsWalked, 6);
  assert.equal(result.freeRowSearch.originalKind, "not-found");
  assert.equal(result.freeRowSearch.cursorResult.kind, "interference");
  assert.equal(result.freeRowSearch.cursorResult.phase, "cursor-resume");
  assert.equal(result.freeRowSearch.cursorResult.proofCheck, "native-focus-resume-worker-result");
});

test("append stops on incomplete or uncertain cursor successes and on known pre-input rejection", async () => {
  for (const cursor of [
    { ok: true, vollstaendig: false, anzahl: 6, stopKind: "cursor-unavailable", outcomeUnknown: false, cleanupRequired: false },
    { ok: false, phase: "native-preproof", proofCheck: "native-session-not-ready", outcomeUnknown: false, cleanupRequired: false },
    { ok: true, vollstaendig: true, outcomeUnknown: true, cleanupRequired: false },
    { ok: true, vollstaendig: true, outcomeUnknown: false, cleanupRequired: true },
    { ok: true, vollstaendig: true, outcomeUnknown: false, reconciliationRequired: true },
  ]) {
    const { result, calls } = await appendWithCursor(cursor);
    assert.deepEqual(calls.map(value => value.operation), ["table_add", "table_read"]);
    assert.equal(result.ok, false);
    assert.equal(result.retryable, false);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.outcomeUnknown, cursor.outcomeUnknown || cursor.cleanupRequired === true);
    assert.equal(result.freeRowSearch.cursorResult.ok, cursor.ok);
    assert.equal(result.freeRowSearch.cursorResult.vollstaendig, cursor.vollstaendig === true);
  }
  const absentProof = await appendWithCursor({ ok: true, vollstaendig: false });
  assert.equal(absentProof.result.outcomeUnknown, true, "Missing outcome evidence cannot prove an unchanged composite.");
  assert.equal(absentProof.result.mutationStarted, null);
});

test("append cursor diagnostics exclude cells, free text, identities, authority and invalid scalar types", async () => {
  const secret = "synthetic-private-evidence";
  const { result, calls } = await appendWithCursor({
    ok: false, kind: secret, phase: secret, proofCheck: secret, stopKind: secret, error: secret,
    anzahl: 401, steps: -1, schritte: "3", physicalInputAttempted: { secret }, cleanupRequired: { secret },
    cursorBinding: { secret }, cursorLease: { secret }, cursorInputEpoch: 123, selectedRids: [secret],
    cursorActivation: { secret }, zeilen: [[secret]], windowTitle: secret, receipt: secret,
  });
  assert.deepEqual(calls.map(value => value.operation), ["table_add", "table_read"]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  for (const key of ["kind", "phase", "proofCheck", "stopKind"]) assert.equal(result.freeRowSearch.cursorResult[key], "unclassified");
  for (const key of ["steps", "schritte", "physicalInputAttempted", "cleanupRequired"]) assert.equal(result.freeRowSearch.cursorResult[key], null);
  assert.equal(result.freeRowSearch.rowsWalked, null);
  assert.equal(result.cleanupRequired, null);
  assert.equal(result.outcomeUnknown, true);
  const wrongEnum = await appendWithCursor({
    ok: false, kind: "native-focus-only", phase: "interference", proofCheck: "cursor-resume", stopKind: "native-preproof",
  });
  for (const key of ["kind", "phase", "proofCheck", "stopKind"]) assert.equal(wrongEnum.result.freeRowSearch.cursorResult[key], "unclassified");
});

test("append returns a conservative structured result if cursor transport throws and never exports the exception", async () => {
  const secret = "synthetic-private-transport-evidence";
  const { result, calls } = await appendWithCursor(() => { throw new Error(secret); });
  assert.deepEqual(calls.map(value => value.operation), ["table_add", "table_read"]);
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.cleanupRequired, true);
  assert.equal(result.mutationStarted, null);
  assert.equal(result.resultingState, "unknown");
  assert.equal(result.freeRowSearch.cursorResult.proofCheck, "cursor-transport-error");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("append retains own earlier flags and retries exactly once only after a complete proven cursor result", async () => {
  const priorInput = await appendWithCursor({ ok: false, outcomeUnknown: false, physicalInputUsed: false, cleanupRequired: false },
    undefined, { ...missingAppendRow, physicalInputUsed: true, cleanupRequired: true });
  assert.equal(priorInput.result.physicalInputUsed, true);
  assert.equal(priorInput.result.cleanupRequired, true);
  assert.equal(priorInput.result.outcomeUnknown, true);

  for (const original of [
    { ...missingAppendRow, outcomeUnknown: true },
    { ...missingAppendRow, reconciliationRequired: true },
    { ...missingAppendRow, cleanupRequired: true },
  ]) {
    const uncertainFirstAdd = await appendWithCursor({ ok: true, vollstaendig: true, outcomeUnknown: false }, undefined, original);
    assert.deepEqual(uncertainFirstAdd.calls.map(value => value.operation), ["table_add", "table_read"]);
    assert.equal(uncertainFirstAdd.result.ok, false);
    assert.equal(uncertainFirstAdd.result.retryable, false);
    assert.equal(uncertainFirstAdd.result.reconciliationRequired, true);
    assert.equal(uncertainFirstAdd.result.outcomeUnknown, original.outcomeUnknown === true || original.cleanupRequired === true);
  }

  for (const retried of [{ ok: true, verified: true, sumAfter: "2,00" }, missingAppendRow]) {
    const { result, calls } = await appendWithCursor({ ok: true, vollstaendig: true, anzahl: 7 }, retried);
    assert.deepEqual(calls.map(value => value.operation), ["table_add", "table_read", "table_add"]);
    assert.deepEqual(result, { ...retried, freeRowSearch: { retriedAfterTableWalk: true, rowsWalked: 7 } });
  }
  const differentError = { ...missingAppendRow, error: "Different rejection." };
  const noSeek = await appendWithCursor({ ok: true, vollstaendig: true }, undefined, differentError);
  assert.deepEqual(noSeek.calls.map(value => value.operation), ["table_add"]);
  assert.deepEqual(noSeek.result, differentError);
});
