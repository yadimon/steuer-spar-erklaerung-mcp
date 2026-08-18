import { asArray, type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { operationError } from "./executor-errors.js";

type CheckerNestedExecutor = (
  operation: SseApiOperation,
  args: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<WorkerResult>;

export async function executeCheckerOpen(
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  execute: CheckerNestedExecutor,
): Promise<WorkerResult> {
  if (typeof args.name !== "string" || !args.name.trim()) throw new Error("'name' fehlt.");
  const target = args.hwnd === undefined ? {} : { hwnd: args.hwnd };
  const deadline = Date.now() + Math.min(timeoutMs ?? 300_000, 300_000);
  const step = async (
    operation: SseApiOperation,
    nestedArgs: Record<string, unknown>,
    preferredTimeoutMs: number,
  ): Promise<WorkerResult> => {
    if (signal?.aborted) {
      return operationError("API-Client hat den Aufruf abgebrochen; Zustand vor Wiederholung lesen.", "aborted");
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs < 200) {
      return operationError("Gesamtfrist fuer checker_open ist abgelaufen; Zustand vor Wiederholung lesen.", "timeout");
    }
    return await execute(operation, nestedArgs, Math.min(preferredTimeoutMs, remainingMs), signal);
  };

  let current = await step("checker_results", target, 180_000);
  if (current.ok === false) return current;
  if (
    current.aktiv === true &&
    current.konsistent !== true &&
    !checkerMessages(current).some((message) => message.text === args.name)
  ) {
    // Eine bereits aufgeklappte Detailkarte kann den Baum verlaengern und
    // untere Meldungen aus dem virtualisierten Qt-Fenster schieben; dann liest
    // der Baum konsistent=false. checker_reset schliesst alle Karten und stellt
    // die vollstaendige Liste wieder her - dieselbe sichere Erholung, die der
    // Oeffnungspfad unten schon nutzt. Erst wenn die Meldung auch danach fehlt,
    // ist sie wirklich nicht vorhanden.
    const reset = await step("checker_reset", target, 240_000);
    if (reset.ok === false) return reset;
    current = await step("checker_results", target, 180_000);
    if (current.ok === false) return current;
    if (
      current.konsistent !== true &&
      !checkerMessages(current).some((message) => message.text === args.name)
    ) {
      return operationError(
        "Der Qt-Prueferbaum blieb auch nach checker_reset unvollstaendig und die gewuenschte Meldung darin nicht sichtbar.",
        "checker-incomplete",
      );
    }
  }

  if (current.aktiv !== true) {
    const page = await step("page", target, 180_000);
    if (page.ok === false) return page;
    if (page.ueberschrift === "Prüfen und Abgeben") {
      const opened = await step("click", {
        ...target,
        name: "Weiter",
        type: "Button",
        expectedPageBefore: "Prüfen und Abgeben",
        expectedPageAfter: "Steuererklärung prüfen",
        waitMs: 900,
      }, 180_000);
      if (opened.ok === false) return opened;
    } else if (page.ueberschrift !== "Steuererklärung prüfen") {
      return operationError(
        `checker_open braucht den Bereich 'Steuererklärung prüfen'; aktuell ist '${String(page.ueberschrift)}' offen.`,
        "checker-page",
      );
    }
    const started = await step("checker_run", target, 240_000);
    if (started.ok === false) return started;
    current = await step("checker_results", target, 180_000);
    if (current.ok === false || current.aktiv !== true || current.konsistent !== true) {
      return operationError(
        "Steuerpruefer wurde gestartet, aber der Ergebnisbaum ist nicht vollstaendig lesbar.",
        "checker-incomplete",
      );
    }
  }

  if (!checkerMessages(current).some((message) => message.text === args.name)) {
    return operationError(`Meldung nicht exakt im aktuellen Steuerpruefer gefunden: '${args.name}'`, "checker-message");
  }
  if (!asArray(current.aufgeklappt).includes(args.name)) {
    const clicked = await step(
      "click_point",
      { ...target, name: args.name, type: "TreeItem", waitMs: 1_200, checkerReadOnly: true },
      180_000,
    );
    if (clicked.ok === false) return clicked;
  }

  let verified = await step("checker_results", target, 180_000);
  if (verified.ok === false || !asArray(verified.aufgeklappt).includes(args.name)) {
    const reset = await step("checker_reset", target, 240_000);
    if (reset.ok === false) return reset;
    if (!checkerMessages(reset).some((message) => message.text === args.name)) {
      return operationError(`Meldung ist nach dem sicheren Reset nicht mehr sichtbar: '${args.name}'`, "checker-message");
    }
    const retried = await step(
      "click_point",
      { ...target, name: args.name, type: "TreeItem", waitMs: 1_200, checkerReadOnly: true },
      180_000,
    );
    if (retried.ok === false) return retried;
    verified = await step("checker_results", target, 180_000);
    if (verified.ok === false || !asArray(verified.aufgeklappt).includes(args.name)) {
      return operationError(`Meldung wurde auch nach sicherem Reset nicht geoeffnet: '${args.name}'`, "checker-message");
    }
  }

  const detail = await step("checker_detail", { ...target, name: args.name }, 240_000);
  return detail.ok === false
    ? detail
    : { ...detail, kontrollbildEnthalten: typeof detail.bildBase64 === "string" && detail.bildBase64.length > 0 };
}

function checkerMessages(result: WorkerResult): Record<string, unknown>[] {
  return [
    ...asArray<Record<string, unknown>>(result.fragenWarnungen),
    ...asArray<Record<string, unknown>>(result.tippsZusatzinfos),
    ...asArray<Record<string, unknown>>(result.sonstige),
  ];
}
