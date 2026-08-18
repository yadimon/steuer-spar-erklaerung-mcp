import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import {
  isSseApiOperation,
  type SseApiOperation,
  type WorkerResult,
} from "./api-contract.js";
import {
  MAX_TEXT_FILE_BYTES,
  readWorkspaceText,
  validateWorkspaceTextTarget,
  writeWorkspaceText,
} from "./workspace.js";
import { SSE_CLEANUP_OPERATIONS, SSE_READ_ONLY_OPERATIONS } from "./operation-traits.js";
import { assertApiArgumentBudget, formatOperationArgumentError } from "./operation-catalog.js";

const scenarioStepSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  operation: z.string().min(1),
  args: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().min(200).max(300_000).optional(),
  capture: z.array(z.string().min(1).max(128)).min(1).max(20).optional(),
  expect: z.record(z.unknown()).optional(),
  continueOnError: z.boolean().optional(),
}).strict().superRefine((step, context) => {
  const expectationPaths = Object.keys(step.expect ?? {});
  if (expectationPaths.length > 20) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expect"],
      message: "Ein Szenarioschritt darf hoechstens 20 Erwartungen enthalten.",
    });
  }
  const longPath = expectationPaths.find((path) => path.length > 128);
  if (longPath) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expect", longPath],
      message: "Erwartungspfade duerfen hoechstens 128 Zeichen lang sein.",
    });
  }
  const budgetOperation = isSseApiOperation(step.operation) ? step.operation : "health";
  for (const [field, value] of [["args", step.args], ["expect", step.expect]] as const) {
    if (value === undefined) continue;
    try {
      assertApiArgumentBudget(budgetOperation, value, [field]);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: error instanceof z.ZodError ? formatOperationArgumentError(error) : String(error),
      });
    }
  }
});

const CONTINUE_ON_ERROR_READ_ONLY = new Set<string>(SSE_READ_ONLY_OPERATIONS);
const SCENARIO_FORBIDDEN = new Set(["scenario_run", "workspace_file_write_text"]);
const FINALLY_CLEANUP_OPERATIONS = new Set<string>([
  ...CONTINUE_ON_ERROR_READ_ONLY,
  ...SSE_CLEANUP_OPERATIONS,
]);

function requireAllowedScenarioOperations(
  groups: ReadonlyArray<readonly [string, ReadonlyArray<ScenarioStep>]>,
  context: z.RefinementCtx,
): void {
  for (const [phase, steps] of groups) {
    steps.forEach((step, index) => {
      if (!isSseApiOperation(step.operation) || SCENARIO_FORBIDDEN.has(step.operation)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [phase, index, "operation"],
          message: `Szenario-Operation '${step.operation}' ist nicht freigegeben.`,
        });
      }
    });
  }
}

function requireUniqueStepIds(
  groups: ReadonlyArray<readonly [string, ReadonlyArray<{ id: string }>]>,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [phase, steps] of groups) {
    steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [phase, index, "id"],
          message: `Schritt-ID '${step.id}' muss im gesamten Szenario eindeutig sein.`,
        });
      }
      seen.add(step.id);
    });
  }
}

function requireSafeErrorContinuation(
  steps: ReadonlyArray<ScenarioStep>,
  context: z.RefinementCtx,
): void {
  steps.forEach((step, index) => {
    if (step.continueOnError !== true) return;
    if (!CONTINUE_ON_ERROR_READ_ONLY.has(step.operation)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps", index, "continueOnError"],
        message: `continueOnError ist fuer die nicht rein lesende Operation '${step.operation}' gesperrt.`,
      });
    }
    const laterMutation = steps.slice(index + 1).find((candidate) =>
      !CONTINUE_ON_ERROR_READ_ONLY.has(candidate.operation));
    if (laterMutation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps", index, "continueOnError"],
        message: `Nach continueOnError darf keine Hauptmutation wie '${laterMutation.operation}' folgen.`,
      });
    }
  });
}

const scenarioV1Schema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(200),
  resultFile: z.string().min(1).max(260),
  steps: z.array(scenarioStepSchema).min(1).max(100),
}).strict().superRefine((scenario, context) => {
  requireUniqueStepIds([["steps", scenario.steps]], context);
  requireAllowedScenarioOperations([["steps", scenario.steps]], context);
  requireSafeErrorContinuation(scenario.steps, context);
});

const scenarioV2Schema = z.object({
  schemaVersion: z.literal(2),
  name: z.string().min(1).max(200),
  resultFile: z.string().min(1).max(260),
  steps: z.array(scenarioStepSchema).min(1).max(100),
  finally: z.array(scenarioStepSchema).min(1).max(20),
}).strict().superRefine((scenario, context) => {
  requireUniqueStepIds([["steps", scenario.steps], ["finally", scenario.finally]], context);
  requireAllowedScenarioOperations([["steps", scenario.steps], ["finally", scenario.finally]], context);
  requireSafeErrorContinuation(scenario.steps, context);
  scenario.finally.forEach((step, index) => {
    if (step.continueOnError === true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["finally", index, "continueOnError"],
        message: "finally fuehrt ohnehin jeden Cleanup-Schritt aus; continueOnError ist dort ungueltig.",
      });
    }
    if (!FINALLY_CLEANUP_OPERATIONS.has(step.operation)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["finally", index, "operation"],
        message: `finally erlaubt nur Read-only- oder Cleanup-Operationen; '${step.operation}' ist gesperrt.`,
      });
    }
  });
});

const scenarioSchema = z.union([scenarioV1Schema, scenarioV2Schema]);
type ScenarioStep = z.infer<typeof scenarioStepSchema>;

export type ScenarioExecutor = (
  operation: SseApiOperation,
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
) => Promise<WorkerResult>;

interface LocatedValue {
  found: boolean;
  value?: unknown;
}

function locateValue(value: unknown, path: string): LocatedValue {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}

function valueAt(value: unknown, path: string): unknown {
  return locateValue(value, path).value;
}

const MAX_CAPTURE_VALUE_BYTES = 16 * 1024;
const MAX_RECORDED_ERROR_CHARS = 4_096;

function summarizedValue(value: unknown, force = false): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    return { omitted: true, reason: "not-json-serializable" };
  }
  const bytes = Buffer.byteLength(serialized);
  if (!force && bytes <= MAX_CAPTURE_VALUE_BYTES) return value;
  return {
    omitted: true,
    bytes,
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

function capture(result: WorkerResult, paths: string[]): Record<string, unknown> {
  return Object.fromEntries(paths.map((path) => [path, summarizedValue(valueAt(result, path) ?? null)]));
}

function recordedError(error: string): string {
  if (error.length <= MAX_RECORDED_ERROR_CHARS) return error;
  const sha256 = createHash("sha256").update(error).digest("hex");
  return `${error.slice(0, MAX_RECORDED_ERROR_CHARS)}… [gekuerzt; sha256=${sha256}]`;
}

function compactStepRecord(record: Record<string, unknown>): Record<string, unknown> {
  const compacted = { ...record };
  const omittedDetails: Record<string, unknown> = {};
  for (const field of ["values", "expectationFailures"]) {
    if (field in compacted) {
      omittedDetails[field] = summarizedValue(compacted[field], true);
      delete compacted[field];
    }
  }
  if (typeof compacted.error === "string") compacted.error = recordedError(compacted.error);
  return Object.keys(omittedDetails).length ? { ...compacted, omittedDetails } : compacted;
}

function compactScenarioReport(
  result: Record<string, unknown> & { ok: boolean },
  originalBytes: number,
): Record<string, unknown> & { ok: boolean } {
  return {
    ...result,
    reportCompacted: {
      originalBytes,
      reason: `Ausfuehrlicher Bericht ueberschritt ${MAX_TEXT_FILE_BYTES} Bytes.`,
    },
    steps: Array.isArray(result.steps) ? result.steps.map((step) => compactStepRecord(step)) : [],
    ...(Array.isArray(result.cleanup)
      ? { cleanup: result.cleanup.map((step) => compactStepRecord(step)) }
      : {}),
  };
}

function same(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

class ScenarioReferenceError extends Error {}

const STEP_REFERENCE = /^\$steps\.([a-z0-9][a-z0-9_-]*)\.result(?:\.([a-z0-9_-]+(?:\.[a-z0-9_-]+)*))?$/i;
const FORBIDDEN_REFERENCE_PARTS = new Set(["__proto__", "prototype", "constructor"]);

function resolveStepReference(value: string, priorResults: ReadonlyMap<string, WorkerResult>): unknown {
  const match = STEP_REFERENCE.exec(value);
  if (!match) {
    throw new ScenarioReferenceError(
      `Ungueltige Schritt-Referenz '${value}'. Erwartet wird '$steps.<vorherige-id>.result.<pfad>'.`,
    );
  }
  const stepId = match[1]!;
  const path = match[2];
  const result = priorResults.get(stepId);
  if (!result) {
    throw new ScenarioReferenceError(
      `Schritt-Referenz '${value}' verweist nicht auf einen bereits abgeschlossenen Schritt.`,
    );
  }
  if (!path) return structuredClone(result);
  const parts = path.split(".");
  if (parts.some((part) => FORBIDDEN_REFERENCE_PARTS.has(part.toLowerCase()))) {
    throw new ScenarioReferenceError(`Schritt-Referenz '${value}' enthaelt einen gesperrten Eigenschaftsnamen.`);
  }
  const located = locateValue(result, path);
  if (!located.found || located.value === undefined) {
    throw new ScenarioReferenceError(`Schritt-Referenz '${value}' wurde im vorherigen Ergebnis nicht gefunden.`);
  }
  return structuredClone(located.value);
}

function resolveInput(
  value: unknown,
  workspaceDir: string,
  priorResults: ReadonlyMap<string, WorkerResult>,
  allowStepReferences: boolean,
  operation: SseApiOperation,
  path: Array<string | number>,
): unknown {
  if (allowStepReferences && typeof value === "string" && value.startsWith("$steps")) {
    return resolveStepReference(value, priorResults);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      resolveInput(entry, workspaceDir, priorResults, allowStepReferences, operation, [...path, index]));
  }
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length === 1 && typeof object.$text === "string") {
    return readWorkspaceText(workspaceDir, object.$text).text.trim();
  }
  if (keys.length === 1 && typeof object.$json === "string") {
    const parsed = JSON.parse(readWorkspaceText(workspaceDir, object.$json).text) as unknown;
    // Vor der rekursiven Aufloesung pruefen: tief verschachtelte oder extrem
    // breite Eingabedateien duerfen nicht erst den JavaScript-Stack/Heap
    // beanspruchen und danach am Operationsschema scheitern.
    assertApiArgumentBudget(operation, parsed, path);
    return resolveInput(parsed, workspaceDir, priorResults, allowStepReferences, operation, path);
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [
      key,
      resolveInput(entry, workspaceDir, priorResults, allowStepReferences, operation, [...path, key]),
    ]),
  );
}

interface StepExecution {
  record: Record<string, unknown>;
  result?: WorkerResult;
}

function failedStep(
  step: ScenarioStep,
  kind: string,
  error: string,
): StepExecution {
  return {
    record: { id: step.id, operation: step.operation, ok: false, values: {}, kind, error: recordedError(error) },
  };
}

async function executeScenarioStep(
  step: ScenarioStep,
  workspaceDir: string,
  priorResults: ReadonlyMap<string, WorkerResult>,
  deadline: number,
  signal: AbortSignal | undefined,
  execute: ScenarioExecutor,
  allowStepReferences: boolean,
  defaultTimeoutMs?: number,
): Promise<StepExecution> {
  const remainingMs = deadline - Date.now();
  if (signal?.aborted || remainingMs < 200) {
    return failedStep(
      step,
      signal?.aborted ? "aborted" : "timeout",
      signal?.aborted ? "API-Client hat den Szenariolauf abgebrochen." : "Gesamtfrist des Szenarios ist abgelaufen.",
    );
  }
  if (!isSseApiOperation(step.operation) || SCENARIO_FORBIDDEN.has(step.operation)) {
    return failedStep(step, "operation-not-allowed", `Szenario-Operation '${step.operation}' ist nicht freigegeben.`);
  }

  const operation = step.operation as SseApiOperation;
  let args: Record<string, unknown>;
  try {
    assertApiArgumentBudget(operation, step.args ?? {});
    args = resolveInput(
      step.args ?? {},
      workspaceDir,
      priorResults,
      allowStepReferences,
      operation,
      [],
    ) as Record<string, unknown>;
    assertApiArgumentBudget(operation, args);
  } catch (error) {
    return failedStep(
      step,
      error instanceof ScenarioReferenceError ? "invalid-reference" : "invalid-input",
      error instanceof z.ZodError
        ? formatOperationArgumentError(error)
        : error instanceof Error ? error.message : String(error),
    );
  }

  const stepTimeoutMs = Math.min(step.timeoutMs ?? defaultTimeoutMs ?? remainingMs, remainingMs);
  let result: WorkerResult;
  try {
    result = await execute(operation, args, stepTimeoutMs, signal);
  } catch (error) {
    return failedStep(step, "execution-error", error instanceof Error ? error.message : String(error));
  }
  if (signal?.aborted || Date.now() > deadline) {
    const kind = signal?.aborted ? "aborted" : "timeout";
    const error = signal?.aborted
      ? "API-Client hat den Szenariolauf abgebrochen."
      : "Gesamtfrist des Szenarios ist abgelaufen.";
    return {
      result,
      record: {
        id: step.id,
        operation,
        ok: false,
        values: capture(result, step.capture ?? ["ok"]),
        kind,
        error,
      },
    };
  }

  const expectationFailures = Object.entries(step.expect ?? {})
    .filter(([path, expected]) => !same(valueAt(result, path), expected))
    .map(([path, expected]) => ({
      path,
      expected: summarizedValue(expected),
      actual: summarizedValue(valueAt(result, path) ?? null),
    }));
  const ok = result.ok !== false && expectationFailures.length === 0;
  const values = capture(result, step.capture ?? ["ok"]);
  return {
    result,
    record: {
      id: step.id,
      operation,
      ok,
      values,
      ...(expectationFailures.length ? { kind: "expectation-failed", expectationFailures } : {}),
      ...(!ok && !expectationFailures.length && typeof result.kind === "string" ? { kind: result.kind } : {}),
      ...(!ok && result.error ? { error: recordedError(String(result.error)) } : {}),
    },
  };
}

function fallbackResultRef(requestedRef: string, sha256: string): string {
  const extension = extname(requestedRef);
  const stem = basename(requestedRef, extension);
  const fallbackName = `${stem}.conflict-${sha256}${extension || ".json"}`;
  const parent = dirname(requestedRef);
  return (parent === "." ? fallbackName : join(parent, fallbackName)).replaceAll("\\", "/");
}

export async function runScenario(
  workspaceDir: string,
  resultDir: string,
  scenarioRef: string,
  resultRefOverride: string | undefined,
  totalTimeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  execute: ScenarioExecutor,
): Promise<WorkerResult> {
  const source = readWorkspaceText(workspaceDir, scenarioRef);
  const scenario = scenarioSchema.parse(JSON.parse(source.text));
  const resultRef = resultRefOverride ?? scenario.resultFile;
  // Zielkonflikte muessen vor dem ersten UI-Schritt scheitern. Sonst koennten
  // Mutationen bereits erfolgt sein, waehrend der einzige Ergebnisbericht
  // erst am abschliessenden SHA-Vertrag verloren geht.
  validateWorkspaceTextTarget(resultDir, resultRef);
  const steps: Array<Record<string, unknown>> = [];
  const cleanup: Array<Record<string, unknown>> = [];
  const priorResults = new Map<string, WorkerResult>();
  let mainOk = true;
  const startedAt = Date.now();
  const totalBudgetMs = Math.min(totalTimeoutMs ?? 300_000, 300_000);
  const deadline = startedAt + totalBudgetMs;
  const cleanupSteps = scenario.schemaVersion === 2 ? scenario.finally : [];
  const requestedCleanupMs = Math.min(
    60_000,
    cleanupSteps.reduce((sum, step) => sum + (step.timeoutMs ?? 10_000), 0),
  );
  const cleanupReserveMs = Math.min(
    requestedCleanupMs,
    Math.floor(totalBudgetMs / 3),
    Math.max(0, totalBudgetMs - 200),
  );
  const mainDeadline = deadline - cleanupReserveMs;

  for (const step of scenario.steps) {
    const execution = await executeScenarioStep(
      step,
      workspaceDir,
      priorResults,
      mainDeadline,
      signal,
      execute,
      scenario.schemaVersion === 2,
    );
    steps.push(execution.record);
    if (execution.result) priorResults.set(step.id, execution.result);
    if (execution.record.ok !== true) {
      mainOk = false;
      if (step.continueOnError !== true) break;
    }
  }
  mainOk = mainOk && steps.length === scenario.steps.length;

  for (let index = 0; index < cleanupSteps.length; index++) {
    const step = cleanupSteps[index]!;
    const remainingMs = deadline - Date.now();
    const remainingSteps = cleanupSteps.length - index;
    const defaultTimeoutMs = Math.max(200, Math.floor(remainingMs / remainingSteps));
    // Cleanup muss auch nach Client-Abbruch versucht werden. Deshalb wird das
    // abgebrochene Aufrufsignal nicht an diese eng begrenzten Schritte gereicht;
    // die reservierte Gesamtfrist bleibt trotzdem hart.
    const execution = await executeScenarioStep(
      step,
      workspaceDir,
      priorResults,
      deadline,
      undefined,
      execute,
      true,
      defaultTimeoutMs,
    );
    cleanup.push(execution.record);
    if (execution.result) priorResults.set(step.id, execution.result);
  }
  const cleanupOk = cleanup.length === cleanupSteps.length && cleanup.every((step) => step.ok === true);

  const stableResult = scenario.schemaVersion === 1
    ? {
        schemaVersion: 1 as const,
        scenario: scenario.name,
        ok: mainOk,
        steps,
      }
    : {
        schemaVersion: 2 as const,
        scenario: scenario.name,
        ok: mainOk && cleanupOk,
        mainOk,
        cleanupOk,
        status:
          mainOk && cleanupOk
            ? "ok"
            : !mainOk && !cleanupOk
              ? "main-and-cleanup-failed"
              : !mainOk
                ? "main-failed"
                : "cleanup-failed",
        steps,
        cleanup,
      };
  let finalResult: Record<string, unknown> & { ok: boolean } = stableResult;
  let json = `${JSON.stringify(finalResult, null, 2)}\n`;
  const originalReportBytes = Buffer.byteLength(json);
  if (originalReportBytes > MAX_TEXT_FILE_BYTES) {
    finalResult = compactScenarioReport(finalResult, originalReportBytes);
    json = `${JSON.stringify(finalResult, null, 2)}\n`;
  }
  let actualResultRef = resultRef;
  let info: ReturnType<typeof writeWorkspaceText>;
  let resultWriteConflict = false;
  try {
    info = writeWorkspaceText(resultDir, resultRef, json);
  } catch {
    const existing = (() => {
      try { return readWorkspaceText(resultDir, resultRef); } catch { return undefined; }
    })();
    if (existing?.text === json) {
      info = existing.info;
    } else {
      resultWriteConflict = true;
      finalResult = {
        ...stableResult,
        resultWriteConflict: { requestedRef: resultRef },
      };
      json = `${JSON.stringify(finalResult, null, 2)}\n`;
      const jsonSha256 = createHash("sha256").update(json).digest("hex");
      actualResultRef = fallbackResultRef(resultRef, jsonSha256);
      try {
        info = writeWorkspaceText(resultDir, actualResultRef, json);
      } catch (fallbackError) {
        // Ein identischer, deterministischer Fallback darf von einem frueheren
        // gleichartigen Lauf bereits existieren. Andere Inhalte bleiben hart
        // gesperrt; der vollstaendige SHA256 im Namen macht das zur Kollision.
        let fallbackExisting;
        try {
          fallbackExisting = readWorkspaceText(resultDir, actualResultRef);
        } catch {
          throw fallbackError;
        }
        if (fallbackExisting.info.sha256 !== jsonSha256 || fallbackExisting.text !== json) throw fallbackError;
        info = fallbackExisting.info;
      }
    }
  }
  return {
    ok: finalResult.ok,
    scenario: scenario.name,
    scenarioRef,
    resultRef: actualResultRef,
    ...(resultWriteConflict ? { requestedResultRef: resultRef, resultWriteConflict: true } : {}),
    sha256: info.sha256,
    bytes: info.bytes,
    result: finalResult,
  };
}
