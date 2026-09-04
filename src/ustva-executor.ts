import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  MAX_OPERATION_TIMEOUT_MS,
  type SseApiOperation,
  type WorkerResult,
} from "./api-contract.js";
import { ExecutorArgumentError, operationError } from "./executor-errors.js";
import {
  mapUstvaPeriodValue,
  normalizeUstvaCurrentPage,
  USTVA_FLAGS,
  USTVA_SECTIONS,
  USTVA_VALUE_FIELDS,
} from "./ustva.js";

const USTVA_OPERATIONS = [
  "ustva_read",
  "ustva_select_period",
  "ustva_set_flag",
  "ustva_change_value",
  "ustva_open_section",
] as const satisfies readonly SseApiOperation[];
type UstvaOperation = typeof USTVA_OPERATIONS[number];
const MIN_USTVA_READ_MS = 200;
const MIN_USTVA_FOLLOWUP_MS = 2_000;

export type NestedApiExecutor = (
  operation: SseApiOperation,
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
) => Promise<WorkerResult>;

type UstvaStep = (
  operation: SseApiOperation,
  args: Record<string, unknown>,
  minimumRemainingMs?: number,
) => Promise<WorkerResult>;

interface UstvaExecutorOptions {
  now?: () => number;
}

function mutationEffects(taxDataChanged: boolean) {
  return { taxDataChanged, savePerformed: false, submissionPerformed: false } as const;
}

function optionalWindow(args: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(args.hwnd === undefined ? {} : { hwnd: args.hwnd }),
    ...(args.pid === undefined ? {} : { pid: args.pid }),
  };
}

function caseBinding(args: Record<string, unknown>): Record<string, unknown> {
  return {
    expectedCaseRef: args.expectedCaseRef,
    expectedCaseHash: args.expectedCaseHash,
  };
}

async function readCurrentUstvaPage(
  args: Record<string, unknown>,
  step: UstvaStep,
): Promise<WorkerResult> {
  const gelesen = await step(
    "page",
    args.hwnd === undefined ? {} : { hwnd: args.hwnd },
    MIN_USTVA_READ_MS,
  );
  const normalisiert = normalizeUstvaCurrentPage(gelesen);
  // Die Normalisierung baut je Seitenart ein NEUES Ergebnisobjekt und liesse
  // die gemessene Workerzeit dabei fallen. Im Leistungsbericht stand
  // `ustva_read` deshalb mit 0 ms und las sich wie "laeuft gar nicht im
  // Worker" - eine Messfalle, auf die schon jemand hereingefallen ist. Ein
  // vorhandenes `ms` der Normalisierung hat Vorrang; ohne gemessenes `ms`
  // bleibt das Ergebnis unveraendert.
  if (typeof normalisiert.ms === "number" || typeof gelesen.ms !== "number") return normalisiert;
  return { ...normalisiert, ms: gelesen.ms };
}

function requireOverview(page: WorkerResult): WorkerResult | null {
  if (page.ok === false) return page;
  if (page.pageKind === "overview") return null;
  return {
    ok: false,
    kind: "ustva-page",
    error: `Die Operation braucht die UStVA-Uebersicht; aktuell ist '${String(page.page ?? "")}' offen.`,
  };
}

function withUstvaMetadata(
  result: WorkerResult,
  metadata: Record<string, unknown>,
  effects: Record<string, unknown>,
): WorkerResult {
  return result.ok === false ? result : { ...result, ustva: { ...metadata, effects } };
}

export function isUstvaOperation(operation: SseApiOperation): operation is UstvaOperation {
  return (USTVA_OPERATIONS as readonly SseApiOperation[]).includes(operation);
}

export async function executeUstvaOperation(
  operation: UstvaOperation,
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  execute: NestedApiExecutor,
  options: UstvaExecutorOptions = {},
): Promise<WorkerResult> {
  const now = options.now ?? Date.now;
  const effectiveTimeoutMs = Math.max(
    0,
    Math.min(timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS, MAX_OPERATION_TIMEOUT_MS),
  );
  const deadline = now() + effectiveTimeoutMs;
  const step: UstvaStep = async (nestedOperation, nestedArgs, minimumRemainingMs = MIN_USTVA_READ_MS) => {
    if (signal?.aborted) {
      return operationError(
        "API-Client hat die UStVA-Operation abgebrochen; Zustand vor Wiederholung lesen.",
        "aborted",
      );
    }
    const remainingMs = Math.floor(deadline - now());
    if (remainingMs < minimumRemainingMs) {
      return operationError(
        "Gesamtfrist der UStVA-Operation ist aufgebraucht; keine weitere UI-Aktion ausgefuehrt.",
        "timeout",
      );
    }
    return await execute(nestedOperation, nestedArgs, remainingMs, signal);
  };

  switch (operation) {
    case "ustva_read": {
      return readCurrentUstvaPage(args, step);
    }
    case "ustva_select_period": {
      const selector = String(args.selector);
      let expected: ReturnType<typeof mapUstvaPeriodValue>;
      let requested: ReturnType<typeof mapUstvaPeriodValue>;
      try {
        expected = mapUstvaPeriodValue(selector, String(args.expectedCurrent));
        requested = mapUstvaPeriodValue(selector, String(args.value));
      } catch (error) {
        throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
      }
      if (expected.aid !== requested.aid) {
        throw new ExecutorArgumentError("UStVA-Vorwert und Ziel gehoeren nicht zum selben Selektor.");
      }
      const page = await readCurrentUstvaPage(args, step);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await step("combo_select", {
        expectedPage: page.page,
        aid: requested.aid,
        expectedCurrent: expected.display,
        value: requested.display,
        expectedAfter: requested.display,
        ...optionalWindow(args),
        ...caseBinding(args),
      }, MIN_USTVA_FOLLOWUP_MS);
      return withUstvaMetadata(result, {
        selector,
        before: args.expectedCurrent,
        selected: args.value,
      }, mutationEffects(args.expectedCurrent !== args.value));
    }
    case "ustva_set_flag": {
      const flag = String(args.flag) as keyof typeof USTVA_FLAGS;
      const aid = USTVA_FLAGS[flag];
      if (!aid) throw new ExecutorArgumentError(`Unbekanntes UStVA-Flag: '${flag}'.`);
      const page = await readCurrentUstvaPage(args, step);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await step("toggle", {
        expectedPage: page.page,
        aid,
        expectedBefore: args.expectedBefore,
        value: args.value,
        expectedAfter: args.expectedAfter,
        ...optionalWindow(args),
        ...caseBinding(args),
      }, MIN_USTVA_FOLLOWUP_MS);
      return withUstvaMetadata(result, { flag }, mutationEffects(args.expectedBefore !== args.expectedAfter));
    }
    case "ustva_change_value": {
      const field = String(args.field) as keyof typeof USTVA_VALUE_FIELDS;
      const definition = USTVA_VALUE_FIELDS[field];
      if (!definition) throw new ExecutorArgumentError(`Unbekanntes UStVA-Wertfeld: '${field}'.`);
      if (definition.manualOnly && args.manualInputConfirmed !== true) {
        throw new ExecutorArgumentError(
          `UStVA-Feld '${field}' ist nur bei bewusst aktivierter manueller Erfassung erlaubt; manualInputConfirmed=true fehlt.`,
        );
      }
      const page = await readCurrentUstvaPage(args, step);
      if (page.ok === false) return page;
      if (page.pageKind !== definition.page) {
        return {
          ok: false,
          kind: "ustva-page",
          error: `UStVA-Feld '${field}' braucht den Bereich '${definition.page}'; aktuell ist '${String(page.pageKind ?? page.page ?? "")}' offen.`,
          effects: mutationEffects(false),
        };
      }
      if (definition.manualOnly && definition.page === "overview") {
        const flags = page.flags as Record<string, unknown> | undefined;
        if (flags?.manual_input !== true) {
          return {
            ok: false,
            kind: "manual-input-disabled",
            error: "Das UStVA-Kennzeichen fuer manuelle Erfassung ist nicht nachweislich aktiv; keine Aenderung ausgefuehrt.",
            effects: mutationEffects(false),
          };
        }
      }
      const result = await step("tracked_set_value", {
        expectedPage: page.page,
        aid: definition.aid,
        expectedBefore: args.expectedBefore,
        value: args.value,
        expectedAfter: args.expectedAfter,
        trackResults: false,
        ...optionalWindow(args),
        ...caseBinding(args),
      }, MIN_USTVA_FOLLOWUP_MS);
      return withUstvaMetadata(
        result,
        { field, manualOnly: definition.manualOnly },
        mutationEffects(args.expectedBefore !== args.expectedAfter),
      );
    }
    case "ustva_open_section": {
      const section = String(args.section) as keyof typeof USTVA_SECTIONS;
      const definition = USTVA_SECTIONS[section];
      if (!definition) throw new ExecutorArgumentError(`Unbekannter UStVA-Bereich: '${section}'.`);
      const page = await readCurrentUstvaPage(args, step);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await step("click", {
        aid: definition.aid,
        expectedPageBefore: page.page,
        expectedPageAfter: definition.targetPage,
        waitMs: 3_000,
        ...(args.hwnd === undefined ? {} : { hwnd: args.hwnd }),
      }, MIN_USTVA_FOLLOWUP_MS);
      return withUstvaMetadata(result, {
        section,
        targetPage: definition.targetPage,
      }, mutationEffects(false));
    }
  }
}
