import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScenario } from "../dist/scenario.js";
import { parseApiOperationResult } from "../dist/result-contract.js";
import { MAX_TEXT_FILE_BYTES } from "../dist/workspace.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-scenario-flow-"));
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });

const writeScenario = (name, scenario) => {
  const ref = `${name}.json`;
  writeFileSync(join(workspaceDir, ref), `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
  return ref;
};

const run = async (name, scenario, executor, resultRef = `${name}-result.json`, options = {}) => {
  const scenarioRef = writeScenario(name, scenario);
  const calls = [];
  const result = await runScenario(
    workspaceDir,
    resultDir,
    scenarioRef,
    resultRef,
    options.totalTimeoutMs ?? 30_000,
    options.signal,
    async (operation, args, timeoutMs, signal) => {
      calls.push({ operation, args, timeoutMs, signal });
      return await executor(operation, args, timeoutMs, signal);
    },
  );
  return { result, calls, bytes: readFileSync(join(resultDir, result.resultRef)) };
};

try {
  let deeplyNestedInput = "wert";
  for (let depth = 0; depth < 40; depth += 1) deeplyNestedInput = [deeplyNestedInput];
  writeFileSync(join(workspaceDir, "deep-input.json"), JSON.stringify(deeplyNestedInput), "utf8");
  const deepInputBudget = await run(
    "deep-input-budget",
    {
      schemaVersion: 1,
      name: "deep-input-budget",
      resultFile: "unused.json",
      steps: [{ id: "deep", operation: "find", args: { name: { $json: "deep-input.json" } } }],
    },
    async () => assert.fail("Zu tiefe JSON-Eingabe darf den Executor nicht erreichen"),
  );
  assert.equal(deepInputBudget.calls.length, 0);
  assert.equal(deepInputBudget.result.result.steps[0].kind, "invalid-input");
  assert.match(deepInputBudget.result.result.steps[0].error, /hoechstens 32 Ebenen/);

  const happyScenario = {
    schemaVersion: 2,
    name: "dynamic-happy",
    resultFile: "unused.json",
    steps: [
      {
        id: "launch",
        operation: "launch",
        capture: ["ok", "instance.hwnd", "caseRef", "sha256"],
      },
      {
        id: "consume",
        operation: "case_hash",
        args: {
          hwnd: "$steps.launch.result.instance.hwnd",
          resourceRef: "$steps.launch.result.caseRef",
          expectedSha256: "$steps.launch.result.sha256",
          launchResult: "$steps.launch.result",
        },
        capture: ["ok", "consumedHwnd", "consumedRef", "consumedHash"],
      },
    ],
    finally: [
      {
        id: "controlled-close",
        operation: "close",
        args: {
          hwnd: "$steps.launch.result.instance.hwnd",
          discardChanges: true,
        },
        capture: ["ok", "closed", "hwnd"],
      },
    ],
  };
  const happyExecutor = async (operation, args) => {
    if (operation === "launch") {
      return {
        ok: true,
        instance: { hwnd: 4242, pid: 3131 },
        caseRef: "cases:arbeitskopie.Gew2025",
        sha256: "a".repeat(64),
      };
    }
    if (operation === "case_hash") {
      assert.equal(args.hwnd, 4242);
      assert.equal(args.resourceRef, "cases:arbeitskopie.Gew2025");
      assert.equal(args.expectedSha256, "a".repeat(64));
      assert.deepEqual(args.launchResult.instance, { hwnd: 4242, pid: 3131 });
      return {
        ok: true,
        consumedHwnd: args.hwnd,
        consumedRef: args.resourceRef,
        consumedHash: args.expectedSha256,
      };
    }
    if (operation === "close") return { ok: true, closed: true, hwnd: args.hwnd };
    throw new Error(`Unerwartete Operation: ${operation}`);
  };
  const happy = await run("happy", happyScenario, happyExecutor, "happy-a.json");
  assert.equal(happy.result.ok, true);
  assert.deepEqual(happy.calls.map((call) => call.operation), ["launch", "case_hash", "close"]);
  assert.equal(happy.calls[2].args.hwnd, 4242, "Cleanup muss Main-Ergebnis referenzieren");
  assert.equal(happy.calls[2].signal, undefined, "Cleanup darf kein abgebrochenes Client-Signal erben");
  assert.deepEqual(happy.result.result, {
    schemaVersion: 2,
    scenario: "dynamic-happy",
    ok: true,
    mainOk: true,
    cleanupOk: true,
    status: "ok",
    steps: [
      {
        id: "launch",
        operation: "launch",
        ok: true,
        values: {
          ok: true,
          "instance.hwnd": 4242,
          caseRef: "cases:arbeitskopie.Gew2025",
          sha256: "a".repeat(64),
        },
      },
      {
        id: "consume",
        operation: "case_hash",
        ok: true,
        values: {
          ok: true,
          consumedHwnd: 4242,
          consumedRef: "cases:arbeitskopie.Gew2025",
          consumedHash: "a".repeat(64),
        },
      },
    ],
    cleanup: [
      {
        id: "controlled-close",
        operation: "close",
        ok: true,
        values: { ok: true, closed: true, hwnd: 4242 },
      },
    ],
  });

  const deterministic = await run("happy-repeat", happyScenario, happyExecutor, "happy-b.json");
  assert.deepEqual(deterministic.bytes, happy.bytes, "Gleiche Resultate muessen byteidentische Dateien ergeben");

  const mainFailure = await run(
    "main-failure",
    {
      schemaVersion: 2,
      name: "main-failure",
      resultFile: "unused.json",
      steps: [
        { id: "launch", operation: "launch", capture: ["ok", "instance.hwnd"] },
        { id: "main", operation: "health", capture: ["ok"] },
        { id: "must-not-run", operation: "page" },
      ],
      finally: [
        {
          id: "cleanup",
          operation: "close",
          args: { hwnd: "$steps.launch.result.instance.hwnd", discardChanges: true },
          capture: ["ok", "closed"],
        },
      ],
    },
    async (operation, args) => {
      if (operation === "launch") return { ok: true, instance: { hwnd: 88 } };
      if (operation === "health") return { ok: false, kind: "fixture-main", error: "Main-Schritt fehlgeschlagen" };
      if (operation === "close") return { ok: true, closed: args.hwnd === 88 };
      throw new Error("Schritt nach Main-Fehler wurde ausgefuehrt");
    },
  );
  assert.deepEqual(mainFailure.calls.map((call) => call.operation), ["launch", "health", "close"]);
  assert.equal(mainFailure.result.result.mainOk, false);
  assert.equal(mainFailure.result.kind, "scenario-failed");
  assert.match(mainFailure.result.error, /main-failure.*main/);
  assert.doesNotThrow(() => parseApiOperationResult("scenario_run", mainFailure.result));
  assert.equal(mainFailure.result.result.cleanupOk, true);
  assert.equal(mainFailure.result.result.status, "main-failed");
  assert.equal(mainFailure.result.result.cleanup[0].ok, true);

  const cleanupFailure = await run(
    "cleanup-failure",
    {
      schemaVersion: 2,
      name: "cleanup-failure",
      resultFile: "unused.json",
      steps: [{ id: "main", operation: "health", capture: ["ok"] }],
      finally: [
        { id: "cleanup-close", operation: "close", capture: ["ok", "closed"] },
        {
          id: "cleanup-readback",
          operation: "health",
          args: { previousClosed: "$steps.cleanup-close.result.closed" },
          capture: ["ok", "previousClosed"],
        },
      ],
    },
    async (operation, args) => {
      if (operation === "close") return { ok: false, kind: "cleanup-fixture", error: "Schliessen fehlgeschlagen", closed: false };
      return { ok: true, ...(args.previousClosed !== undefined ? { previousClosed: args.previousClosed } : {}) };
    },
  );
  assert.deepEqual(cleanupFailure.calls.map((call) => call.operation), ["health", "close", "health"]);
  assert.equal(cleanupFailure.result.result.mainOk, true);
  assert.equal(cleanupFailure.result.kind, "scenario-failed");
  assert.match(cleanupFailure.result.error, /cleanup-failure.*cleanup-close/);
  assert.doesNotThrow(() => parseApiOperationResult("scenario_run", cleanupFailure.result));
  assert.equal(cleanupFailure.result.result.cleanupOk, false);
  assert.equal(cleanupFailure.result.result.status, "cleanup-failed");
  assert.equal(cleanupFailure.result.result.cleanup[0].kind, "cleanup-fixture");
  assert.equal(cleanupFailure.result.result.cleanup[1].values.previousClosed, false);

  const invalidReferences = await run(
    "invalid-references",
    {
      schemaVersion: 2,
      name: "invalid-references",
      resultFile: "unused.json",
      steps: [
        { id: "launch", operation: "launch", capture: ["ok", "instance.hwnd"] },
        {
          id: "missing",
          operation: "health",
          args: { value: "$steps.launch.result.instance.missing" },
          continueOnError: true,
        },
        {
          id: "future",
          operation: "page",
          args: { value: "$steps.later.result.ok" },
          continueOnError: true,
        },
        {
          id: "prototype",
          operation: "product_info",
          args: { value: "$steps.launch.result.constructor.name" },
          continueOnError: true,
        },
        {
          id: "invalid-syntax",
          operation: "health",
          args: { value: "$steps.launch.values.ok" },
          continueOnError: true,
        },
      ],
      finally: [{ id: "cleanup", operation: "close", args: { hwnd: "$steps.launch.result.instance.hwnd" } }],
    },
    async (operation, args) => {
      if (operation === "launch") return { ok: true, instance: { hwnd: 99 } };
      if (operation === "close") return { ok: true, closed: true, hwnd: args.hwnd };
      throw new Error(`Ungueltige Referenz erreichte Executor: ${operation}`);
    },
  );
  assert.deepEqual(invalidReferences.calls.map((call) => call.operation), ["launch", "close"]);
  assert(invalidReferences.result.result.steps.slice(1).every((step) => step.kind === "invalid-reference"));
  assert.equal(invalidReferences.result.result.status, "main-failed");
  assert.equal(invalidReferences.result.result.cleanup[0].ok, true);

  const lateAbortController = new AbortController();
  const lateResult = await run(
    "late-aborted-result",
    {
      schemaVersion: 2,
      name: "late-aborted-result",
      resultFile: "unused.json",
      steps: [
        { id: "launch", operation: "launch", capture: ["ok", "instance.hwnd"] },
      ],
      finally: [
        {
          id: "cleanup",
          operation: "close",
          args: { hwnd: "$steps.launch.result.instance.hwnd" },
          capture: ["ok", "closed", "hwnd"],
        },
      ],
    },
    async (operation, args, _timeoutMs, signal) => {
      if (operation === "launch") {
        assert.equal(signal, lateAbortController.signal);
        lateAbortController.abort();
        return { ok: true, instance: { hwnd: 7070 } };
      }
      return { ok: true, closed: true, hwnd: args.hwnd };
    },
    "late-aborted-result.json",
    { signal: lateAbortController.signal },
  );
  assert.deepEqual(lateResult.calls.map((call) => call.operation), ["launch", "close"]);
  assert.equal(lateResult.result.result.steps[0].ok, false);
  assert.equal(lateResult.result.result.steps[0].kind, "aborted");
  assert.equal(lateResult.result.result.steps[0].values["instance.hwnd"], 7070);
  assert.equal(lateResult.calls[1].args.hwnd, 7070, "Finally muss spaetes Launch-Ergebnis erhalten");
  assert.equal(lateResult.result.result.cleanup[0].ok, true);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const abortedBeforeStart = await run(
    "already-aborted",
    {
      schemaVersion: 2,
      name: "already-aborted",
      resultFile: "unused.json",
      steps: [{ id: "main", operation: "health" }],
      finally: [{ id: "cleanup", operation: "close", capture: ["ok", "closed"] }],
    },
    async (operation) => {
      assert.equal(operation, "close", "Abgebrochener Main-Schritt darf den Executor nicht erreichen");
      return { ok: true, closed: true };
    },
    "already-aborted.json",
    { signal: alreadyAborted.signal },
  );
  assert.deepEqual(abortedBeforeStart.calls.map((call) => call.operation), ["close"]);
  assert.equal(abortedBeforeStart.result.result.steps[0].kind, "aborted");
  assert.equal(abortedBeforeStart.result.result.cleanup[0].ok, true);

  const cleanupBudget = await run(
    "cleanup-budget",
    {
      schemaVersion: 2,
      name: "cleanup-budget",
      resultFile: "unused.json",
      steps: [{ id: "main", operation: "health" }],
      finally: [{ id: "cleanup", operation: "close", timeoutMs: 300 }],
    },
    async () => ({ ok: true }),
    "cleanup-budget.json",
    { totalTimeoutMs: 900 },
  );
  assert.equal(cleanupBudget.calls.length, 2);
  assert(
    cleanupBudget.calls[0].timeoutMs > 0 && cleanupBudget.calls[0].timeoutMs <= 600,
    `Main-Budget muss Cleanup-Zeit reservieren: ${cleanupBudget.calls[0].timeoutMs}`,
  );
  assert.equal(cleanupBudget.calls[1].timeoutMs, 300, "Explizites Cleanup-Budget muss erhalten bleiben");
  assert.equal(cleanupBudget.result.ok, true);

  const v1Literal = "$steps.previous.result.instance.hwnd";
  const legacy = await run(
    "legacy-v1",
    {
      schemaVersion: 1,
      name: "legacy-v1",
      resultFile: "unused.json",
      steps: [
        {
          id: "legacy",
          operation: "health",
          args: { literal: v1Literal },
          capture: ["ok", "literal"],
        },
      ],
    },
    async (_operation, args) => ({ ok: true, literal: args.literal }),
  );
  assert.equal(legacy.calls[0].args.literal, v1Literal, "v1 darf $steps nicht als Referenz interpretieren");
  assert.deepEqual(legacy.result.result, {
    schemaVersion: 1,
    scenario: "legacy-v1",
    ok: true,
    steps: [
      {
        id: "legacy",
        operation: "health",
        ok: true,
        values: { ok: true, literal: v1Literal },
      },
    ],
  });

  const duplicateV1Ref = writeScenario("duplicate-v1", {
    schemaVersion: 1,
    name: "duplicate-v1",
    resultFile: "duplicate-v1-result.json",
    steps: [
      { id: "same", operation: "health" },
      { id: "same", operation: "page" },
    ],
  });
  const duplicateCalls = [];
  await assert.rejects(
    runScenario(
      workspaceDir,
      resultDir,
      duplicateV1Ref,
      undefined,
      30_000,
      undefined,
      async (...args) => {
        duplicateCalls.push(args);
        return { ok: true };
      },
    ),
    /eindeutig/,
  );
  assert.equal(duplicateCalls.length, 0, "Doppelte v1-IDs muessen vor Ausfuehrung scheitern");

  const requestedConflictRef = "toctou.json";
  const requestedConflictPath = join(resultDir, requestedConflictRef);
  const competingBytes = "fremder paralleler Bericht\n";
  const conflictScenario = {
    schemaVersion: 2,
    name: "result-write-conflict",
    resultFile: "unused.json",
    steps: [{ id: "main", operation: "health", capture: ["ok", "stable"] }],
    finally: [{ id: "cleanup", operation: "close", capture: ["ok", "closed"] }],
  };
  const conflictExecutor = async (operation) => {
    if (operation === "health") {
      writeFileSync(requestedConflictPath, competingBytes, "utf8");
      return { ok: true, stable: "same" };
    }
    return { ok: true, closed: true };
  };
  const firstConflict = await run(
    "toctou-a",
    conflictScenario,
    conflictExecutor,
    requestedConflictRef,
  );
  assert.equal(readFileSync(requestedConflictPath, "utf8"), competingBytes, "Konfliktziel darf nicht ueberschrieben werden");
  assert.equal(firstConflict.result.resultWriteConflict, true);
  assert.equal(firstConflict.result.requestedResultRef, requestedConflictRef);
  assert.deepEqual(firstConflict.result.result.resultWriteConflict, { requestedRef: requestedConflictRef });
  const fallbackMatch = /\.conflict-([a-f0-9]{64})\.json$/.exec(firstConflict.result.resultRef);
  assert(fallbackMatch, `Fallback-Ref braucht vollen JSON-SHA256: ${firstConflict.result.resultRef}`);
  assert.equal(createHash("sha256").update(firstConflict.bytes).digest("hex"), fallbackMatch[1]);

  rmSync(requestedConflictPath);
  const repeatedConflict = await run(
    "toctou-b",
    conflictScenario,
    conflictExecutor,
    requestedConflictRef,
  );
  assert.equal(repeatedConflict.result.resultRef, firstConflict.result.resultRef);
  assert.deepEqual(repeatedConflict.bytes, firstConflict.bytes, "Identischer Konflikt muss denselben Fallback wiederverwenden");

  const callsBeforeInvalidSchema = [];
  const invalidSchemaRef = writeScenario("missing-finally", {
    schemaVersion: 2,
    name: "missing-finally",
    resultFile: "missing-finally-result.json",
    steps: [{ id: "main", operation: "health" }],
  });
  await assert.rejects(
    runScenario(
      workspaceDir,
      resultDir,
      invalidSchemaRef,
      undefined,
      30_000,
      undefined,
      async (...args) => {
        callsBeforeInvalidSchema.push(args);
        return { ok: true };
      },
    ),
    /finally/,
  );
  assert.equal(callsBeforeInvalidSchema.length, 0, "Fehlendes Cleanup muss vor dem ersten Schritt scheitern");

  const largeReport = await run(
    "large-report",
    {
      schemaVersion: 1,
      name: "large-report",
      resultFile: "large-report-result.json",
      steps: Array.from({ length: 100 }, (_, index) => ({
        id: `read-${index + 1}`,
        operation: "health",
        capture: ["payload"],
      })),
    },
    async () => ({ ok: true, payload: "x".repeat(15_000) }),
  );
  assert.equal(largeReport.result.ok, true);
  assert(largeReport.result.result.reportCompacted, "Uebergrosser Bericht muss deterministisch verdichtet werden");
  assert(largeReport.result.bytes <= MAX_TEXT_FILE_BYTES);
  assert(largeReport.result.result.steps.every((step) => step.omittedDetails?.values?.omitted === true));

  const largeValue = await run(
    "large-value",
    {
      schemaVersion: 1,
      name: "large-value",
      resultFile: "large-value-result.json",
      steps: [{ id: "read", operation: "health", capture: ["payload"], expect: { payload: "anders" } }],
    },
    async () => ({ ok: true, payload: "y".repeat(20_000) }),
  );
  const largeValueStep = largeValue.result.result.steps[0];
  assert.equal(largeValueStep.values.payload.omitted, true);
  assert.equal(largeValueStep.expectationFailures[0].actual.omitted, true);

  for (const [name, scenario] of [
    ["unknown-root-field", {
      schemaVersion: 1,
      name: "unknown-root-field",
      resultFile: "unknown-root-field-result.json",
      steps: [{ id: "read", operation: "health" }],
      unexpected: true,
    }],
    ["unknown-step-field", {
      schemaVersion: 1,
      name: "unknown-step-field",
      resultFile: "unknown-step-field-result.json",
      steps: [{ id: "read", operation: "health", contineOnError: true }],
    }],
    ["deep-expectation", {
      schemaVersion: 1,
      name: "deep-expectation",
      resultFile: "deep-expectation-result.json",
      steps: [{ id: "read", operation: "health", expect: { payload: deeplyNestedInput } }],
    }],
  ]) {
    const ref = writeScenario(name, scenario);
    const strictCalls = [];
    await assert.rejects(
      runScenario(
        workspaceDir,
        resultDir,
        ref,
        undefined,
        30_000,
        undefined,
        async (...args) => {
          strictCalls.push(args);
          return { ok: true };
        },
      ),
      name === "deep-expectation" ? /hoechstens 32 Ebenen/ : /Unrecognized key/,
    );
    assert.equal(strictCalls.length, 0, `${name} muss vor der ersten Operation scheitern`);
  }

  for (const [name, steps, finallySteps, message] of [
    [
      "unsafe-continue-mutation",
      [{ id: "write", operation: "tracked_set_value", continueOnError: true }],
      [{ id: "cleanup", operation: "close" }],
      /nicht rein lesende Operation/,
    ],
    [
      "unsafe-later-mutation",
      [
        { id: "read", operation: "health", continueOnError: true },
        { id: "write", operation: "tracked_set_value" },
      ],
      [{ id: "cleanup", operation: "close" }],
      /keine Hauptmutation/,
    ],
    [
      "redundant-finally-continue",
      [{ id: "read", operation: "health" }],
      [{ id: "cleanup", operation: "close", continueOnError: true }],
      /finally.*continueOnError/,
    ],
    [
      "unsafe-finally-mutation",
      [{ id: "read", operation: "health" }],
      [{ id: "cleanup", operation: "table_delete" }],
      /finally.*Cleanup-Operationen.*table_delete/,
    ],
    [
      "forbidden-late-operation",
      [
        { id: "would-mutate", operation: "tracked_set_value" },
        { id: "forbidden", operation: "scenario_run" },
      ],
      [{ id: "cleanup", operation: "close" }],
      /scenario_run.*nicht freigegeben/,
    ],
  ]) {
    const ref = writeScenario(name, {
      schemaVersion: 2,
      name,
      resultFile: `${name}-result.json`,
      steps,
      finally: finallySteps,
    });
    const unsafeCalls = [];
    await assert.rejects(
      runScenario(
        workspaceDir,
        resultDir,
        ref,
        undefined,
        30_000,
        undefined,
        async (...args) => {
          unsafeCalls.push(args);
          return { ok: true };
        },
      ),
      message,
    );
    assert.equal(unsafeCalls.length, 0, `${name} muss vor der ersten Operation scheitern`);
  }

  process.stdout.write("Szenario-Steuerfluss: Referenzen, Finally, Fehlerpfade und deterministische Bytes bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
