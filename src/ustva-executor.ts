import type { SseApiOperation, WorkerResult } from "./api-contract.js";
import { ExecutorArgumentError } from "./executor-errors.js";
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

export type NestedApiExecutor = (
  operation: SseApiOperation,
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
) => Promise<WorkerResult>;

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
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  execute: NestedApiExecutor,
): Promise<WorkerResult> {
  return normalizeUstvaCurrentPage(await execute(
    "page",
    args.hwnd === undefined ? {} : { hwnd: args.hwnd },
    timeoutMs,
    signal,
  ));
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
): Promise<WorkerResult> {
  switch (operation) {
    case "ustva_read": {
      return readCurrentUstvaPage(args, timeoutMs, signal, execute);
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
      const page = await readCurrentUstvaPage(args, timeoutMs, signal, execute);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await execute("combo_select", {
        expectedPage: page.page,
        aid: requested.aid,
        expectedCurrent: expected.display,
        value: requested.display,
        expectedAfter: requested.display,
        ...optionalWindow(args),
        ...caseBinding(args),
      }, timeoutMs, signal);
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
      const page = await readCurrentUstvaPage(args, timeoutMs, signal, execute);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await execute("toggle", {
        expectedPage: page.page,
        aid,
        expectedBefore: args.expectedBefore,
        value: args.value,
        expectedAfter: args.expectedAfter,
        ...optionalWindow(args),
        ...caseBinding(args),
      }, timeoutMs, signal);
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
      const page = await readCurrentUstvaPage(args, timeoutMs, signal, execute);
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
      const result = await execute("tracked_set_value", {
        expectedPage: page.page,
        aid: definition.aid,
        expectedBefore: args.expectedBefore,
        value: args.value,
        expectedAfter: args.expectedAfter,
        trackResults: false,
        ...optionalWindow(args),
        ...caseBinding(args),
      }, timeoutMs, signal);
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
      const page = await readCurrentUstvaPage(args, timeoutMs, signal, execute);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await execute("click", {
        aid: definition.aid,
        expectedPageBefore: page.page,
        expectedPageAfter: definition.targetPage,
        waitMs: 3_000,
        ...(args.hwnd === undefined ? {} : { hwnd: args.hwnd }),
      }, timeoutMs, signal);
      return withUstvaMetadata(result, {
        section,
        targetPage: definition.targetPage,
      }, mutationEffects(false));
    }
  }
}
