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

export const OPERATION_TRACE_DIRECTORY_KEY = "SSE_TEST_OPERATION_TRACE_DIR";

/** Erlaubte Herkunftsmarken. Eine unbekannte Marke ist ein Testfehler. */
export const OPERATION_TRACE_LABELS = Object.freeze([
  "worker",
  "stateful-mock",
  "ustva-mock",
  "scenario-mock",
]);

export function operationTraceDirectory(env = process.env) {
  return env[OPERATION_TRACE_DIRECTORY_KEY] ?? "";
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
    const line = JSON.stringify({
      label,
      operation,
      profileId,
      ok: failed ? false : result?.ok === true,
      ms: elapsedMs,
      ...(failed ? { threw: true } : {}),
      ...(typeof result?.kind === "string" && result.kind ? { kind: result.kind } : {}),
    });
    appendFileSync(file, `${line}\n`, "utf8");
  };

  return async (operation, args, timeoutMs, signal) => {
    const startedAt = process.hrtime.bigint();
    let result;
    let failed = false;
    try {
      result = await execute(operation, args, timeoutMs, signal);
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      record(operation, result, failed, Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000));
    }
  };
}
