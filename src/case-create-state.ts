/** Reine Assistenten- und Fehlerzustände der Fallanlage; keine Produktaktionen. */
import type { WorkerResult } from "./api-contract.js";
import { executionError } from "./executor-errors.js";

export interface CaseCreateWizard {
  startHeading: RegExp;
  beginLink: string;
  modeChoiceHeading: string;
  modeChoiceAid: string;
  nextButton: string;
  masterDataHeading: string;
  saveMenu: string;
  saveMenuEntry: string;
  saveDialogTitle: string;
  yearOffset: number;
}

/** Live verifizierte Assistentenwege je Startmodus; andere Modi bleiben gesperrt. */
export const CASE_CREATE_WIZARDS: Readonly<Record<string, CaseCreateWizard>> = Object.freeze({
  einurvor: {
    startHeading: /^Gewinn-Erfassung für das Jahr (\d{4})$/u,
    beginLink: "Jetzt beginnen",
    modeChoiceHeading: "Beginn der Datenbearbeitung",
    modeChoiceAid: "btnNavigatormodusEinURVor",
    nextButton: "Weiter",
    masterDataHeading: "Allgemeine Angaben zum Unternehmen",
    saveMenu: "Datei",
    saveMenuEntry: "Speichern unter... Strg+Alt+S",
    saveDialogTitle: "Gewinn-Erfassung speichern",
    yearOffset: 1,
  },
});

export class StepFailure extends Error {
  constructor(readonly result: WorkerResult) {
    super(String(result.error ?? result.kind ?? "Schritt scheiterte."));
  }
}

export function mustPreserveFailedCase(error: unknown): boolean {
  if (!(error instanceof StepFailure)) return true;
  const result = error.result;
  return result.processPreserved === true || result.outcomeUnknown === true
    || result.reconciliationRequired === true || result.kind === "interference";
}

export function preserveCaseCreateSaveDialogFailure(error: unknown, failedStep: string): StepFailure {
  const failure = error instanceof StepFailure ? error.result : executionError("menu_click", error);
  return new StepFailure({ ...failure, failedStep: failure.failedStep ?? failedStep, processPreserved: true, outcomeUnknown: true,
    reconciliationRequired: true, retryable: false });
}

export function assertCaseCreateSaveDialog(opened: WorkerResult, expectedTitle: string): void {
  if (opened.saveDialogOpened === true && opened.dialogTitle === expectedTitle
    && !mustPreserveFailedCase(new StepFailure(opened)) && opened.cleanupRequired !== true) return;
  throw preserveCaseCreateSaveDialogFailure(new StepFailure({ ok: false, kind: "postcondition-failed",
    error: "Der Worker bestaetigt den gebundenen Fallanlage-Speicherdialog nicht; Zustand frisch abgleichen." }), "menu_click");
}

export function isStartupUiaRootFailure(result: WorkerResult, pid: number, hwnd: number): boolean {
  return result.ok === false && result.backend === undefined && result.kind === "uia-root-unavailable"
    && result.operation === "ui_state" && result.phase === "snapshot-root"
    && result.mutationStarted === false && result.outcomeUnknown === false && result.windowStateChanged === false
    && result.windowAlive === true && result.windowSetMainOnly === true && result.pid === pid && result.hwnd === hwnd;
}

/** Ein bestätigter eigener Dialog oder eine unvollständige Lesung erhält den Startzustand. */
export function getStartupDialogFailure(inventory: WorkerResult, pid: number): WorkerResult | undefined {
  const ownWindow = (entry: unknown): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const window = entry as Record<string, unknown>;
    return window.pid === pid && Number.isInteger(window.hwnd) && Number(window.hwnd) > 0;
  };
  const dialogs = Array.isArray(inventory.dialogs) ? inventory.dialogs : [];
  const windows = Array.isArray(inventory.windows) ? inventory.windows : [];
  const ownDialogs = dialogs.filter((dialog) => ownWindow(dialog)
    && ["native-dialog", "qt-dialog"].includes(String(dialog.kind))
    && windows.some((window) => ownWindow(window) && window.hwnd === dialog.hwnd && window.kind === dialog.kind));
  // count is the complete window inventory, not the number of dialogs.
  // An own modal blocks even without a successful UIA content read; no answer is sent.
  const completeInventory = Array.isArray(inventory.dialogs) && Array.isArray(inventory.windows)
    && Number.isInteger(inventory.count) && inventory.count === windows.length
    && windows.every((window) => ownWindow(window) && typeof window.kind === "string" && window.kind.length > 0)
    && ownDialogs.length === dialogs.length
    && windows.every((window) => !["native-dialog", "qt-dialog"].includes(String(window.kind))
      || ownDialogs.some((dialog) => dialog.hwnd === window.hwnd && dialog.kind === window.kind))
    && ["cleanupRequired", "reconciliationRequired", "outcomeUnknown", "processPreserved"]
      .every((flag) => inventory[flag] === undefined || inventory[flag] === false)
    && !windows.some((window) => ownWindow(window) && (
      ["uiaReadOk", "msaaReadOk"].some((flag) => window[flag] !== undefined && typeof window[flag] !== "boolean")
      || ((window.uiaError || window.msaaError) && window.uiaReadOk !== true && window.msaaReadOk !== true)));
  if (ownDialogs.length > 0 || !completeInventory) {
    return { ...inventory, ok: false, kind: "startup-not-ready", failedStep: "dialog_list", pid,
      error: ownDialogs.length > 0
        ? "Ein eigener Startdialog blockiert die Fallanlage; Dialog und Wiederherstellungszustand bleiben erhalten."
        : "Das eigene Startdialoginventar ist nicht vollstaendig bestaetigt; Zustand erhalten und frisch abgleichen.",
      ready: false, blockedByDialog: ownDialogs.length > 0 ? true : null, processPreserved: true,
      processStillRunning: ownDialogs.length > 0 ? true : null,
      outcomeUnknown: true, reconciliationRequired: true, retryable: false };
  }
  return undefined;
}
