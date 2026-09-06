import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  MAX_OPERATION_TIMEOUT_MS,
  type SseApiOperation,
  type WorkerResult,
} from "./api-contract.js";
import { ExecutorArgumentError, operationError } from "./executor-errors.js";
import {
  classifyUstvaPageHeading,
  mapUstvaPeriodValue,
  normalizeUstvaCurrentPage,
  USTVA_FLAGS,
  USTVA_SECTIONS,
  USTVA_VALUE_FIELDS,
  type UstvaPageKind,
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

/**
 * Die Seite, auf der die Schreiboperation stattfinden muss - entweder frisch
 * gelesen oder vom Aufrufer durchgereicht.
 *
 * Die UStVA-Schreiboperationen brauchten bisher IMMER eine eigene
 * `page`-Lesung, nur um die Ueberschrift zu erfahren, die sie danach als
 * `expectedPage` an die eigentliche Worker-Operation weitergeben. Diese Lesung
 * kostet einen vollstaendigen zweiten Workerprozess samt eigenem Baumlauf
 * (gemessen rund 1000 ms je Aufruf) - und der Arbeiter liest die Seite fuer
 * seine eigene `expectedPage`-Pruefung ohnehin ein drittes Mal.
 *
 * Wer die Ueberschrift schon kennt, weil er unmittelbar davor `ustva_read`
 * aufgerufen hat, reicht sie als `expectedPage` durch. Der Verlass darauf ist
 * KEIN Vertrauensvorschuss: die Ueberschrift wird hier gegen dieselbe
 * Seitenart geprueft wie eine selbst gelesene, und der Arbeiter vergleicht sie
 * unmittelbar vor der Aenderung gegen die tatsaechlich offene Seite und bricht
 * fail-closed ab, wenn sie abweicht. Der Weg ist sogar enger als der bisherige:
 * zwischen Lesung und Aenderung liegt kein zweiter Prozesswechsel mehr, in dem
 * die Seite haette wechseln koennen.
 */
async function resolveUstvaPageHeading(
  args: Record<string, unknown>,
  step: UstvaStep,
  requiredKind: UstvaPageKind,
): Promise<{ heading: string } | { failure: WorkerResult }> {
  const durchgereicht = args.expectedPage;
  if (typeof durchgereicht === "string" && durchgereicht.length > 0) {
    const art = classifyUstvaPageHeading(durchgereicht);
    if (art !== requiredKind) {
      return {
        failure: {
          ok: false,
          kind: "ustva-page",
          error: `Die Operation braucht den UStVA-Bereich '${requiredKind}'; die uebergebene Seite ` +
            `'${durchgereicht}' gehoert ${art ? `zu '${art}'` : "zu keinem bekannten Bereich"}.`,
          effects: mutationEffects(false),
        },
      };
    }
    return { heading: durchgereicht };
  }
  const gelesen = await readCurrentUstvaPage(args, step);
  if (gelesen.ok === false) return { failure: gelesen };
  if (gelesen.pageKind !== requiredKind) {
    return {
      failure: {
        ok: false,
        kind: "ustva-page",
        error: `Die Operation braucht den UStVA-Bereich '${requiredKind}'; aktuell ist ` +
          `'${String(gelesen.page ?? "")}' offen.`,
        effects: mutationEffects(false),
      },
    };
  }
  return { heading: String(gelesen.page ?? "") };
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
      const seite = await resolveUstvaPageHeading(args, step, "overview");
      if ("failure" in seite) return seite.failure;
      const result = await step("combo_select", {
        expectedPage: seite.heading,
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
      const seite = await resolveUstvaPageHeading(args, step, "overview");
      if ("failure" in seite) return seite.failure;
      const result = await step("toggle", {
        expectedPage: seite.heading,
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
      // Manuelle Uebersichtsfelder brauchen den LIVE gelesenen Nachweis, dass
      // das Kennzeichen 'manuelle Erfassung' aktiv ist. Diese Lesung ist keine
      // blosse Ueberschriftenbeschaffung und darf deshalb nicht entfallen -
      // eine Zusicherung des Aufrufers waere hier keine Pruefung. Ein trotzdem
      // uebergebenes `expectedPage` wird gegen die Lesung gehalten, statt es
      // stillschweigend zu uebergehen.
      const brauchtLebendesKennzeichen = definition.manualOnly && definition.page === "overview";
      let ueberschrift: string;
      if (brauchtLebendesKennzeichen) {
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
        const flags = page.flags as Record<string, unknown> | undefined;
        if (flags?.manual_input !== true) {
          return {
            ok: false,
            kind: "manual-input-disabled",
            error: "Das UStVA-Kennzeichen fuer manuelle Erfassung ist nicht nachweislich aktiv; keine Aenderung ausgefuehrt.",
            effects: mutationEffects(false),
          };
        }
        ueberschrift = String(page.page ?? "");
        if (typeof args.expectedPage === "string" && args.expectedPage !== ueberschrift) {
          return {
            ok: false,
            kind: "ustva-page",
            error: `Uebergebene Seite '${args.expectedPage}' stimmt nicht mit der offenen Seite ` +
              `'${ueberschrift}' ueberein; keine Aenderung ausgefuehrt.`,
            effects: mutationEffects(false),
          };
        }
      } else {
        const seite = await resolveUstvaPageHeading(args, step, definition.page);
        if ("failure" in seite) return seite.failure;
        ueberschrift = seite.heading;
      }
      const result = await step("tracked_set_value", {
        expectedPage: ueberschrift,
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
      const seite = await resolveUstvaPageHeading(args, step, "overview");
      if ("failure" in seite) return seite.failure;
      const result = await step("click", {
        aid: definition.aid,
        expectedPageBefore: seite.heading,
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
