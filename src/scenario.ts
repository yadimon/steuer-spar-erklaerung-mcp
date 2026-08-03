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
  readWorkspaceText,
  validateWorkspaceTextWrite,
  writeWorkspaceText,
} from "./workspace.js";

const scenarioStepSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  operation: z.string().min(1),
  args: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().min(200).max(300_000).optional(),
  capture: z.array(z.string().min(1)).min(1).optional(),
  expect: z.record(z.unknown()).optional(),
  continueOnError: z.boolean().optional(),
});

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

const scenarioV1Schema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  resultFile: z.string().min(1),
  steps: z.array(scenarioStepSchema).min(1).max(100),
}).superRefine((scenario, context) => {
  requireUniqueStepIds([["steps", scenario.steps]], context);
});

const scenarioV2Schema = z.object({
  schemaVersion: z.literal(2),
  name: z.string().min(1),
  resultFile: z.string().min(1),
  steps: z.array(scenarioStepSchema).min(1).max(100),
  finally: z.array(scenarioStepSchema).min(1).max(20),
}).superRefine((scenario, context) => {
  requireUniqueStepIds([["steps", scenario.steps], ["finally", scenario.finally]], context);
});

const scenarioSchema = z.union([scenarioV1Schema, scenarioV2Schema]);
type ScenarioStep = z.infer<typeof scenarioStepSchema>;

const SCENARIO_FORBIDDEN = new Set(["scenario_run", "workspace_file_write_text"]);

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

function capture(result: WorkerResult, paths: string[]): Record<string, unknown> {
  return Object.fromEntries(paths.map((path) => [path, valueAt(result, path) ?? null]));
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
  const [, stepId, path] = match;
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
): unknown {
  if (allowStepReferences && typeof value === "string" && value.startsWith("$steps")) {
    return resolveStepReference(value, priorResults);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveInput(entry, workspaceDir, priorResults, allowStepReferences));
  }
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length === 1 && typeof object.$text === "string") {
    return readWorkspaceText(workspaceDir, object.$text).text.trim();
  }
  if (keys.length === 1 && typeof object.$json === "string") {
    const parsed = JSON.parse(readWorkspaceText(workspaceDir, object.$json).text) as unknown;
    return resolveInput(parsed, workspaceDir, priorResults, allowStepReferences);
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [
      key,
      resolveInput(entry, workspaceDir, priorResults, allowStepReferences),
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
    record: { id: step.id, operation: step.operation, ok: false, values: {}, kind, error },
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

  let args: Record<string, unknown>;
  try {
    args = resolveInput(step.args ?? {}, workspaceDir, priorResults, allowStepReferences) as Record<string, unknown>;
  } catch (error) {
    return failedStep(
      step,
      error instanceof ScenarioReferenceError ? "invalid-reference" : "invalid-input",
      error instanceof Error ? error.message : String(error),
    );
  }

  const operation = step.operation as SseApiOperation;
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
    .map(([path, expected]) => ({ path, expected, actual: valueAt(result, path) ?? null }));
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
      ...(!ok && result.error ? { error: result.error } : {}),
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
  expectedResultSha256: string | undefined,
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
  validateWorkspaceTextWrite(resultDir, resultRef, expectedResultSha256);
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
    const step = cleanupSteps[index];
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
  let actualResultRef = resultRef;
  let info: ReturnType<typeof writeWorkspaceText>;
  let resultWriteConflict = false;
  try {
    info = writeWorkspaceText(resultDir, resultRef, json, expectedResultSha256);
  } catch {
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
      let existing;
      try {
        existing = readWorkspaceText(resultDir, actualResultRef);
      } catch {
        throw fallbackError;
      }
      if (existing.info.sha256 !== jsonSha256 || existing.text !== json) throw fallbackError;
      info = existing.info;
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
