/**
 * case_create: einen neuen Steuerfall ueber den echten Startassistenten
 * anlegen und sofort unter der gewuenschten Falldatei speichern.
 *
 * Die Komposition benutzt ausschliesslich bereits veroeffentlichte, einzeln
 * verifizierte Operationen ueber den verschachtelten API-Executor. Jeder
 * Schritt hat eine harte Vor- und Nachbedingung; scheitert ein Schritt vor
 * dem Speichern, wird die exakt gestartete PID ohne Speichern beendet, sofern
 * kein ungewisser Ausgang, fremder Eingabekontext oder ungepruefter
 * Dialog-/Wiederherstellungszustand erhalten bleiben muss. Nach dem Speichern
 * wird die neue Datei niemals wieder geloescht.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  asArray,
  LAUNCH_OPERATION_TIMEOUT_MS,
  MAX_OPERATION_TIMEOUT_MS,
  type SseApiOperation,
  type WorkerResult,
} from "./api-contract.js";
import { operationError } from "./executor-errors.js";
import {
  CASE_CREATE_WIZARDS,
  getStartupDialogFailure,
  isStartupUiaRootFailure,
  mustPreserveFailedCase,
  StepFailure,
  type CaseCreateWizard,
} from "./case-create-state.js";
export { CASE_CREATE_WIZARDS } from "./case-create-state.js";
import type { ProductProfile } from "./product-profiles.js";
import type { ScenarioExecutor } from "./scenario.js";
import type { NestedApiExecutor } from "./ustva-executor.js";

export interface CaseCreateTarget {
  path: string;
  ref: string;
}

export interface CaseCreateDependencies {
  /** Verschachtelter API-Executor mit Schema-, Ressourcen- und Profilpruefung. */
  execute: NestedApiExecutor;
  /** Roher Worker nur fuer das Cleanup der exakt gestartetenPID. */
  worker: ScenarioExecutor;
  resolveTarget: (args: Record<string, unknown>) => CaseCreateTarget;
  profile: Pick<ProductProfile, "taxYear" | "startModes" | "additionalCaseYears">;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

const MIN_STEP_MS = 2_000;
const MIN_LAUNCH_MS = 30_000;
const WIZARD_RESERVE_MS = 60_000;
const START_PAGE_POLL_MS = 1_500;
const START_DIALOG_READ_CEILING_MS = 5_000;
// Der verschachtelte Executor normalisiert Worker-Ausnahmen zu Ergebnissen.
// Diese Transportfehler beweisen ohne ausdrueckliches false keinen Nichtversand.
const UNCERTAIN_EXECUTION_KINDS = new Set([
  "timeout", "aborted", "parse", "empty", "output-too-large", "worker",
  "worker-isolation-lost", "worker-transport-cleanup", "spawn",
]);

const EFFECTS = Object.freeze({ taxDataChanged: false, savePerformed: true, submissionPerformed: false });

const fail = (kind: string, error: string): never => {
  throw new StepFailure(operationError(error, kind));
};

async function cleanupStartedProcess(worker: ScenarioExecutor, pid: number): Promise<Record<string, unknown>> {
  let cleanup: WorkerResult = { ok: false, kind: "cleanup-not-run", error: "Cleanup wurde nicht ausgefuehrt." };
  const errors: string[] = [];
  try {
    cleanup = await worker("close", { pid, force: true, discardChanges: true }, 30_000);
  } catch (error) {
    errors.push(`close: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Unbekannter Status gilt fail-closed als weiterhin laufend; nur beide
  // realen Prozesslisten ohne diese PID beweisen das Cleanup.
  let processStillRunning = true;
  try {
    const status = await worker("product_info", {}, 30_000);
    if (status.ok === true && Object.hasOwn(status, "supportedRunning") && Object.hasOwn(status, "ignoredRunning")) {
      const running = [
        ...asArray<Record<string, unknown>>(status.supportedRunning),
        ...asArray<Record<string, unknown>>(status.ignoredRunning),
      ];
      processStillRunning = running.some((entry) => Number(entry.pid) === pid);
    } else {
      errors.push("product_info: Prozessstatus war unvollstaendig.");
    }
  } catch (error) {
    errors.push(`product_info: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { cleanup, processStillRunning, ...(errors.length ? { cleanupError: errors.join(" ") } : {}) };
}

function expectedFileSuffix(
  profile: CaseCreateDependencies["profile"],
  mode: string,
  wizard: CaseCreateWizard,
): { suffix: string; taxYear: number } {
  const documentType = profile.startModes[mode];
  const taxYear = profile.taxYear + wizard.yearOffset;
  const released = profile.additionalCaseYears?.[mode] ?? [];
  if (!documentType || !released.includes(taxYear)) {
    fail("bad-args", `Startmodus '${mode}' ist im aktiven Produktprofil nicht fuer einen neuen Fall des Jahres ${taxYear} freigegeben.`);
  }
  return { suffix: `.${documentType}${taxYear}`, taxYear };
}

export async function executeCaseCreate(
  args: Record<string, unknown>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  dependencies: CaseCreateDependencies,
): Promise<WorkerResult> {
  const now = dependencies.now ?? Date.now;
  const budgetMs = Math.min(timeoutMs ?? LAUNCH_OPERATION_TIMEOUT_MS, MAX_OPERATION_TIMEOUT_MS);
  const deadline = now() + budgetMs;
  const steps: string[] = [];
  let pid = 0;
  let hwnd = 0;
  let launchDispatched = false;
  let startupWindowUnconfirmed = false;
  let target: CaseCreateTarget | undefined;
  let uiaRootFailures = 0;
  let uiaRootPinnedHwnd: number | undefined;
  let lastUiaRootFailure: Record<string, unknown> | undefined;
  let activeStep: SseApiOperation | undefined;
  const rootDiagnostics = () => uiaRootFailures > 0 ? { startupUiaRootFailures: uiaRootFailures,
    lastUiaRootFailure } : {};

  const step = async (operation: SseApiOperation, stepArgs: Record<string, unknown>, ceilingMs = budgetMs,
    run: NestedApiExecutor = dependencies.execute): Promise<WorkerResult> => {
    if (signal?.aborted) fail("aborted", "API-Client hat die Fallanlage abgebrochen.");
    const remaining = deadline - now();
    if (remaining < MIN_STEP_MS) fail("timeout", `Zeitbudget der Fallanlage ist vor '${operation}' erschoepft.`);
    if (operation === "launch" && (Math.min(remaining, ceilingMs) < MIN_LAUNCH_MS || remaining < MIN_LAUNCH_MS + WIZARD_RESERVE_MS)) {
      fail("timeout", "Zeitbudget der Fallanlage reicht vor dem Programmstart nicht fuer den Mindest-Startvertrag.");
    }
    steps.push(operation);
    if (operation === "launch") launchDispatched = true;
    activeStep = operation;
    const result = await run(operation, stepArgs, Math.min(remaining, ceilingMs), signal);
    activeStep = undefined;
    if (result.ok !== true) {
      const uncertain = pid > 0 && result.outcomeUnknown !== false
        && UNCERTAIN_EXECUTION_KINDS.has(String(result.kind));
      throw new StepFailure({ ...result, failedStep: operation,
        ...(uncertain ? { outcomeUnknown: true, reconciliationRequired: true, retryable: false } : {}) });
    }
    return result;
  };
  const wait = dependencies.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  try {
    const mode = String(args.mode ?? "");
    const wizard: CaseCreateWizard = CASE_CREATE_WIZARDS[mode] ??
      fail("bad-args", `Startmodus '${mode}' besitzt keinen live verifizierten Assistentenweg fuer neue Faelle.`);
    target = dependencies.resolveTarget(args);
    const { suffix, taxYear } = expectedFileSuffix(dependencies.profile, mode, wizard);
    const fileName = basename(target.path);
    if (!fileName.endsWith(suffix) || fileName.length <= suffix.length) {
      fail("bad-args", `Zieldatei muss auf '${suffix}' enden und einen Namen davor tragen; '${fileName}' passt nicht.`);
    }
    if (existsSync(target.path)) fail("target-exists", "Zieldatei existiert bereits; case_create ueberschreibt niemals.");

    const instances = await step("instances", {});
    if (Number(instances.count) !== 0) {
      fail("confirmation-required", "Es ist bereits eine SSE-Instanz offen. case_create startet nur ohne offene Instanz; " +
        "den offenen Fall zuerst bewusst schliessen oder sichern.");
    }
    const desktop = await step("desktop_status", {});
    if (desktop.aktiv === true) {
      fail("hidden-desktop", "Der versteckte Desktop ist aktiv; der Startassistent braucht den sichtbaren Desktop.");
    }

    const launchBudget = Math.max(MIN_LAUNCH_MS, deadline - now() - WIZARD_RESERVE_MS);
    const launched = await step("launch", { mode }, launchBudget);
    const launchedPid = Number(launched.pid);
    if (!Number.isInteger(launchedPid) || launchedPid <= 0) fail("startup-pid", "Der Start lieferte keine verifizierbare PID.");
    pid = launchedPid;
    startupWindowUnconfirmed = true;
    if (launched.ready !== true || launched.blockedByDialog === true || launched.outcomeUnknown === true || launched.processPreserved === true) {
      throw new StepFailure({ ...launched, ok: false, kind: "startup-not-ready", failedStep: "launch",
        error: "Der gestartete Prozess ist nicht bereit fuer die Fallanlage. Startdialog und moegliche Wiederherstellung frisch lesen; " +
          "keine Assistentenaktion und kein automatisches Verwerfen oder Beenden.",
        ready: false, processPreserved: true, reconciliationRequired: true, retryable: false });
    }

    // Wait for a product-titled case window before reading its UIA page.
    // A generic startup frame can be replaced or hidden by a startup dialog.
    let startHeading = "";
    let waitingForCaseWindow = false;
    for (;;) {
      const bound = await step("instances", {});
      const instance = asArray<Record<string, unknown>>(bound.instances).find((entry) => Number(entry.pid) === pid);
      if (instance && (instance.recoveredState === true || instance.hung === true)) {
        throw new StepFailure({ ok: false, kind: instance.recoveredState === true ? "recovered-state" : "startup-not-ready",
          error: "Der gestartete Fall ist wiederhergestellt oder nicht responsiv; Zustand erhalten und frisch abgleichen.",
          failedStep: "instances", pid, ready: false, processPreserved: true, processStillRunning: true,
          outcomeUnknown: true, reconciliationRequired: true, retryable: false });
      }
      const productWindow = instance && String(instance.title ?? "").includes("SteuerSparErklärung");
      const pinnedBindingChanged = uiaRootPinnedHwnd !== undefined
        && (!instance || Number(bound.count) !== 1 || Number(instance.hwnd) !== uiaRootPinnedHwnd);
      if (!productWindow || pinnedBindingChanged) {
        waitingForCaseWindow = true;
        let inventory: WorkerResult;
        try {
          inventory = await step("dialog_list", { pid }, START_DIALOG_READ_CEILING_MS);
        } catch (error) {
          const failure = error instanceof StepFailure ? error.result
            : operationError(error instanceof Error ? error.message : String(error), signal?.aborted ? "aborted" : "startup-probe");
          throw new StepFailure({ ...failure, failedStep: "dialog_list", pid, ready: false,
            processPreserved: true, outcomeUnknown: true, reconciliationRequired: true, retryable: false });
        }
        const startupFailure = getStartupDialogFailure(inventory, pid);
        if (startupFailure) throw new StepFailure(startupFailure);
      }
      if (pinnedBindingChanged) {
        throw new StepFailure({ ok: false, kind: "startup-binding-changed", failedStep: "instances", pid,
          error: "Die Startfensterbindung aenderte sich nach dem UIA-Lesefehler; Zustand erhalten, keine Assistentenaktion.",
          ready: false, processPreserved: true, processStillRunning: null,
          outcomeUnknown: true, reconciliationRequired: true, retryable: false });
      }
      if (instance && Number(bound.count) === 1 && instance.hung !== true && instance.recoveredState !== true && productWindow) {
        waitingForCaseWindow = false;
        hwnd = Number(instance.hwnd);
        let state: WorkerResult | undefined;
        try {
          state = await step("ui_state", { hwnd });
        } catch (error) {
          if (error instanceof StepFailure && isStartupUiaRootFailure(error.result, pid, hwnd)) {
            uiaRootFailures += 1;
            lastUiaRootFailure = { exceptionType: error.result.exceptionType, hresult: error.result.hresult,
              error: error.result.error };
            if (uiaRootFailures >= 3) {
              throw new StepFailure({ ...error.result, attempts: uiaRootFailures, failedStep: "ui_state", retryable: false });
            }
            uiaRootPinnedHwnd = hwnd;
          } else {
            // Passive native discovery can precede window materialization.
            // Every other failure remains terminal; no wizard click repeats.
            if (!(error instanceof StepFailure) || error.result.backend !== "qt"
              || error.result.kind !== "no-window" || error.result.outcomeUnknown !== false) throw error;
          }
        }
        if (state?.blockiert === true) {
          throw new StepFailure({ ok: false, kind: "startup-not-ready",
            error: "Der Startassistent ist durch einen Dialog blockiert; Zustand erhalten und frisch abgleichen.",
            failedStep: "ui_state", pid, hwnd, ready: false, processPreserved: true, processStillRunning: true,
            outcomeUnknown: true, reconciliationRequired: true, retryable: false });
        }
        const heading = String(state?.heading ?? "");
        if (state && (Number((state.instance as Record<string, unknown> | undefined)?.pid) !== pid
          || Number((state.instance as Record<string, unknown> | undefined)?.hwnd) !== hwnd)) {
          throw new StepFailure({ ok: false, kind: "startup-binding-changed", failedStep: "ui_state", pid,
            error: "Die Startlesung bestaetigt nicht die gebundene PID und HWND; Zustand erhalten, keine Assistentenaktion.",
            ready: false, processPreserved: true, processStillRunning: null,
            outcomeUnknown: true, reconciliationRequired: true, retryable: false });
        }
        const match = wizard.startHeading.exec(heading);
        if (match) {
          if (Number(match[1]) !== taxYear) {
            fail("wizard-page", `Der Assistent bietet das Jahr ${match[1]} an, das Profil erlaubt fuer '${mode}' nur ${taxYear}.`);
          }
          startHeading = heading;
          startupWindowUnconfirmed = false;
          break;
        }
      }
      if (deadline - now() < WIZARD_RESERVE_MS / 2) {
        if (waitingForCaseWindow) {
          throw new StepFailure({ ok: false, kind: "startup-not-ready", failedStep: "instances", pid, ready: false,
            error: "Nach dem generischen Startfenster wurde kein lesbar gebundenes Fallfenster bestaetigt; Prozess und moegliche Rueckfragen frisch pruefen.",
            processPreserved: true, processStillRunning: instance ? true : null,
            outcomeUnknown: true, reconciliationRequired: true, retryable: false });
        }
        fail("wizard-page", "Die Startseite des Assistenten erschien nicht rechtzeitig nach dem Programmstart.");
      }
      if (signal?.aborted) fail("aborted", "API-Client hat die Fallanlage abgebrochen.");
      await wait(START_PAGE_POLL_MS);
    }

    // Der Startassistent exponiert seine Links im nativen Qt-Snapshot erst,
    // nachdem ein UIA-Baumlauf sie materialisiert hat. Diesen einen
    // Wizard-Read deshalb bewusst ueber den Worker binden; der folgende
    // Klick verifiziert weiterhin die exakte Seite und RuntimeId.
    const subpages = await step("subpages", { hwnd }, budgetMs, dependencies.worker);
    const begin = asArray<Record<string, unknown>>(subpages.unterseiten).filter((entry) =>
      String(entry.schalter ?? "") === wizard.beginLink && entry.typ === "Hyperlink" && entry.aktiviert === true);
    if (begin.length !== 1) fail("wizard-page", `Der Startlink '${wizard.beginLink}' ist auf '${startHeading}' nicht eindeutig aktiv gebunden.`);

    // GuideViewer can recycle an accessibility RuntimeId between workers.
    // Bind the one semantic link afresh, including its type and exact page,
    // rather than dispatching to an unrelated anonymous button with that ID.
    const began = await step("click", {
      name: wizard.beginLink, type: "Hyperlink", hwnd,
      expectedPageBefore: startHeading, expectedPageAfter: wizard.modeChoiceHeading, waitMs: 6_000,
    });
    if (String(began.ueberschriftNachher ?? "") !== wizard.modeChoiceHeading) {
      fail("wizard-page", `Nach '${wizard.beginLink}' steht '${String(began.ueberschriftNachher ?? "")}' statt '${wizard.modeChoiceHeading}'.`);
    }
    await step("click", { aid: wizard.modeChoiceAid, hwnd, expectedPageBefore: wizard.modeChoiceHeading, waitMs: 100 });
    const master = await step("click", {
      name: wizard.nextButton, hwnd, expectedPageBefore: wizard.modeChoiceHeading, expectedPageAfter: wizard.masterDataHeading, waitMs: 9_000,
    });
    if (String(master.ueberschriftNachher ?? "") !== wizard.masterDataHeading) {
      fail("wizard-page", `Nach '${wizard.nextButton}' steht '${String(master.ueberschriftNachher ?? "")}' statt '${wizard.masterDataHeading}'.`);
    }

    // Mit name liefert der Worker die Eintraege des einen geoeffneten Menues flach.
    const menu = await step("menu", { name: wizard.saveMenu, hwnd });
    const entry = asArray<Record<string, unknown>>(menu.eintraege)
      .find((candidate) => String(candidate.name ?? "") === wizard.saveMenuEntry);
    if (!entry || entry.gesperrt === true || entry.aktiv === false) {
      fail("menu-entry", `Menueeintrag '${wizard.saveMenuEntry}' ist nicht aktiv verfuegbar.`);
    }
    try {
      await step("menu_click", { name: wizard.saveMenuEntry, hwnd, waitMs: 100 });
      const dialogDeadline = Math.min(deadline, now() + 5_000);
      for (;;) {
        const dialogs = await step("dialog_list", { pid });
        const saveDialogs = asArray<Record<string, unknown>>(dialogs.dialogs).filter((dialog) =>
          String(dialog.kind ?? "") === "native-dialog" && String(dialog.title ?? "") === wizard.saveDialogTitle);
        if (saveDialogs.length === 1) break;
        if (saveDialogs.length > 1 || now() >= dialogDeadline) {
          fail("save-dialog", `Erwartet genau einen nativen Dialog '${wizard.saveDialogTitle}', gefunden ${saveDialogs.length}.`);
        }
        await wait(100);
      }
    } catch (error) {
      // Nach unbekannter Aktion oder fremder Eingabe beginnt auch keine
      // vermeintlich harmlose Menuebereinigung mit einer neuen Eingabe.
      if (!mustPreserveFailedCase(error)) {
        try {
          const closed = await step("menu_close", { hwnd }, MIN_STEP_MS * 5);
          if (mustPreserveFailedCase(new StepFailure(closed))) throw new StepFailure(closed);
        } catch (cleanupError) {
          const primary = error instanceof StepFailure ? error.result
            : operationError(error instanceof Error ? error.message : String(error), "case-create");
          const cleanup = cleanupError instanceof StepFailure ? cleanupError.result
            : operationError(cleanupError instanceof Error ? cleanupError.message : String(cleanupError), "menu-cleanup");
          const cleanupUnknown = cleanup.outcomeUnknown === true || (!(cleanupError instanceof StepFailure) && activeStep !== undefined);
          throw new StepFailure({ ...primary, cleanup: { ...cleanup, operation: "menu_close" },
            cleanupError: String(cleanup.error ?? "Die Menuebereinigung wurde nicht bestaetigt."),
            ...(cleanupUnknown ? { outcomeUnknown: true } : {}),
            processPreserved: true, reconciliationRequired: true, retryable: false });
        }
      }
      throw error;
    }

    const saved = await step("file_dialog_select", {
      expectedDialogTitle: wizard.saveDialogTitle, expectedPath: target.path, waitMs: 15_000,
    });
    const sha256 = String(saved.sha256 ?? "");
    if (saved.mode !== "save-new" || saved.verified !== true || !/^[A-F0-9]{64}$/iu.test(sha256)) {
      throw new StepFailure(operationError("Der Speicherdialog schloss ohne verifizierten save-new-Readback.", "postcondition-failed"));
    }
    const bindingDeadline = Math.min(deadline, now() + 15_000);
    let bound: Record<string, unknown> | undefined;
    for (;;) {
      const readback = await step("instances", { includeHash: true });
      bound = asArray<Record<string, unknown>>(readback.instances).find((entry) => Number(entry.pid) === pid);
      if (bound?.recoveredState === true) {
        fail("postcondition-failed", "Der gespeicherte Fall wurde als Wiederherstellung statt als regulaeres Fallfenster erkannt.");
      }
      if (Number(readback.count) === 1 && bound && String(bound.caseName ?? "") === fileName) break;
      if (now() >= bindingDeadline) {
        fail("postcondition-failed", "Die gespeicherte Datei ist nicht exakt an das offene Fallfenster gebunden.");
      }
      await wait(100);
    }
    // Ein ohne Datei gestarteter Prozess traegt den Pfad nicht in der
    // Kommandozeile, und ein langer Pfad wird im Fenstertitel gekuerzt. Dann
    // kann der Worker keinen Dateihash liefern; die Datei selbst beweist ihn.
    const instanceHash = typeof bound.caseSha256 === "string" ? bound.caseSha256.toUpperCase() : null;
    const diskHash = instanceHash ?? createHash("sha256").update(readFileSync(target.path)).digest("hex").toUpperCase();
    if (diskHash !== sha256.toUpperCase()) {
      throw new StepFailure(operationError("Der Dateihash nach dem Speichern weicht vom Dialog-Readback ab.", "postcondition-failed"));
    }
    return {
      ok: true, created: true, ...rootDiagnostics(), caseRef: target.ref || target.path, sha256: sha256.toUpperCase(), pid, hwnd: Number(bound.hwnd),
      caseHashSource: instanceHash ? "instances" : "local-file",
      mode, taxYear, heading: wizard.masterDataHeading, steps, effects: { ...EFFECTS },
      note: "Der neue Fall ist geoeffnet und leer gespeichert. Stammdaten jetzt mit fill_fields fuellen; " +
        "vor der ersten weiteren Mutation den Dateistand nach backups: sichern.",
    };
  } catch (error) {
    let failure = error instanceof StepFailure
      ? error.result
      : operationError(error instanceof Error ? error.message : String(error), signal?.aborted ? "aborted" : "case-create");
    failure = { ...failure, ...rootDiagnostics() };
    if (pid > 0 && startupWindowUnconfirmed && failure.processPreserved !== true
      && (failure.kind === "aborted" || signal?.aborted || failure.failedStep === "instances")) {
      // Cancellation or a failed inventory cannot prove that no new startup
      // question appeared after the last read. Never discard that process.
      failure = { ...failure, ready: false, processPreserved: true, processStillRunning: null,
        outcomeUnknown: true, reconciliationRequired: true, retryable: false };
    }
    if (launchDispatched && pid <= 0 && !(failure.mutationStarted === false && failure.resultingState === "unchanged")) {
      failure = { ...failure, failedStep: failure.failedStep ?? "launch", processPreserved: true, processStillRunning: failure.processStillRunning ?? null,
        outcomeUnknown: true, reconciliationRequired: true, retryable: false };
    }
    if (pid > 0 && mustPreserveFailedCase(error)) {
      failure = { ...failure,
        ...(!(error instanceof StepFailure) ? {
          ...(activeStep !== undefined ? { outcomeUnknown: true } : {}),
          failedStep: failure.failedStep ?? activeStep ?? "case-create",
        } : {}),
        processPreserved: true,
        processStillRunning: typeof failure.processStillRunning === "boolean" ? failure.processStillRunning : null,
        reconciliationRequired: true, retryable: false };
    }
    const created = target !== undefined && existsSync(target.path);
    if (pid > 0 && !created && failure.processPreserved !== true) {
      const cleanupState = await cleanupStartedProcess(dependencies.worker, pid);
      return { ...failure, created: false, steps, pid, ...cleanupState };
    }
    return { ...failure, created, steps, ...(pid > 0 ? { pid, processStillRunning: failure.processPreserved === true
      ? typeof failure.processStillRunning === "boolean" ? failure.processStillRunning : null : true } : {}),
      ...(created ? { caseRef: target!.ref || target!.path } : {}) };
  }
}
