/**
 * Laufzeitnachweis, welche API-Operationen eine Testsuite wirklich ausgefuehrt
 * hat.
 *
 * Nur verhaltenstragende Testharnische werden instrumentiert: der echte
 * PowerShell-Worker hinter `with-api.mjs` und die zustandsbehafteten
 * synthetischen Worker. Harnische mit reinen Stub-Workern bleiben absichtlich
 * ununterstuetzt - sie beweisen Routing, nicht Funktion, und wuerden die
 * Abdeckungsbilanz sonst unehrlich aufblaehen.
 *
 * Jeder Prozess schreibt eine eigene Datei. Damit gibt es keine
 * verschraenkten Zeilen zwischen parallelen Testprozessen und kein
 * Sperrprotokoll.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { resultTypeTag } from "./operation-result-shape-lib.mjs";
import {
  RECEIPT_FOREGROUND_BLOCK_REASON,
  SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS,
} from "../dist/receipt-interaction-policy.js";

export const OPERATION_TRACE_DIRECTORY_KEY = "SSE_TEST_OPERATION_TRACE_DIR";

/** Erlaubte Herkunftsmarken. Eine unbekannte Marke ist ein Testfehler. */
export const OPERATION_TRACE_LABELS = Object.freeze([
  "worker",
  "stateful-mock",
  "ustva-mock",
  "scenario-mock",
  "profile-catalog",
  "local-file",
]);

export function operationTraceDirectory(env = process.env) {
  return env[OPERATION_TRACE_DIRECTORY_KEY] ?? "";
}

export const OPERATION_RESULT_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const FOREGROUND_RECEIPT_OPERATIONS = new Set(SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS);

/** Ein erwarteter Policy-Block ist die vollstaendige aktuelle Funktion, kein beliebiger Fehlerpfad. */
export function isFunctionalPolicyBlock(operation, result) {
  return FOREGROUND_RECEIPT_OPERATIONS.has(operation) &&
    result?.ok === false &&
    result.kind === "blocked" &&
    result.reason === RECEIPT_FOREGROUND_BLOCK_REASON &&
    result.retryable === false &&
    result.interactionRequirement === "foreground-required" &&
    result.mutationStarted === false &&
    result.resultingState === "unchanged" &&
    result.cleanupRequired === false &&
    result.physicalInputUsed === false &&
    result.foregroundLeaseUsed === false;
}

/** Nur Feldnamen und wertfreie Typklassen, niemals Werte oder tiefer verschachtelte Nutzdaten. */
export function operationResultShape(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  const shape = {};
  for (const [field, value] of Object.entries(result)) {
    if (value === undefined) continue;
    if (!OPERATION_RESULT_FIELD_PATTERN.test(field)) {
      throw new Error(`Unsicherer Ergebnisfeldname im Operation-Trace: '${field}'.`);
    }
    shape[field] = resultTypeTag(value);
  }
  return shape;
}

/**
 * Umhuellt einen Executor und protokolliert jede Operation mitsamt Ergebnisart.
 * Ohne gesetztes Trace-Verzeichnis wird der Executor unveraendert
 * zurueckgegeben; ausserhalb der Suite entsteht damit kein Aufwand.
 */
export function traceOperations(label, execute, env = process.env) {
  if (!OPERATION_TRACE_LABELS.includes(label)) {
    throw new Error(`Unbekannte Operation-Trace-Marke: '${label}'.`);
  }
  const directory = operationTraceDirectory(env);
  if (!directory) return execute;

  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${label}-${process.pid}-${randomUUID().replaceAll("-", "")}.jsonl`);
  const record = (operation, result, failed, elapsedMs) => {
    const profileId = env.SSE_PROFILE_ID ?? null;
    const policyBlocked = !failed && isFunctionalPolicyBlock(operation, result);
    const line = JSON.stringify({
      label,
      operation,
      profileId,
      ok: failed ? false : result?.ok === true,
      contractOk: failed ? false : result?.ok === true || policyBlocked,
      ms: elapsedMs,
      ...(failed ? { threw: true } : {}),
      ...(policyBlocked ? { contractOutcome: "policy-blocked" } : {}),
      ...(typeof result?.kind === "string" && result.kind ? { kind: result.kind } : {}),
      fields: operationResultShape(result),
    });
    appendFileSync(file, `${line}\n`, "utf8");
  };

  return async (operation, args, timeoutMs, signal) => {
    const startedAt = process.hrtime.bigint();
    let result;
    try {
      result = await execute(operation, args, timeoutMs, signal);
    } catch (error) {
      try {
        record(operation, result, true, Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000));
      } catch (traceError) {
        throw new AggregateError([error, traceError],
          `Operation '${operation}' und ihr wertfreier Trace sind beide fehlgeschlagen.`);
      }
      throw error;
    }
    record(operation, result, false, Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000));
    return result;
  };
}
