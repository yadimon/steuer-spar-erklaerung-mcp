/**
 * case_create: einen neuen Steuerfall ueber den echten Startassistenten
 * anlegen und sofort unter der gewuenschten Falldatei speichern.
 *
 * Die Komposition benutzt ausschliesslich bereits veroeffentlichte, einzeln
 * verifizierte Operationen ueber den verschachtelten API-Executor. Jeder
 * Schritt hat eine harte Vor- und Nachbedingung; scheitert ein Schritt vor
 * dem Speichern, wird die exakt gestartete PID ohne Speichern beendet. Nach
 * dem Speichern wird die neue Datei niemals wieder geloescht.
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
}

interface CaseCreateWizard {
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

const MIN_STEP_MS = 2_000;
const MIN_LAUNCH_MS = 30_000;
const WIZARD_RESERVE_MS = 60_000;
const START_PAGE_POLL_MS = 1_500;

const EFFECTS = Object.freeze({ taxDataChanged: false, savePerformed: true, submissionPerformed: false });

class StepFailure extends Error {
  constructor(readonly result: WorkerResult) {
    super(String(result.error ?? result.kind ?? "Schritt scheiterte."));
  }
}

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
  let target: CaseCreateTarget | undefined;

  const step = async (operation: SseApiOperation, stepArgs: Record<string, unknown>, ceilingMs = budgetMs): Promise<WorkerResult> => {
    if (signal?.aborted) fail("aborted", "API-Client hat die Fallanlage abgebrochen.");
    const remaining = deadline - now();
    if (remaining < MIN_STEP_MS) fail("timeout", `Zeitbudget der Fallanlage ist vor '${operation}' erschoepft.`);
    steps.push(operation);
    const result = await dependencies.execute(operation, stepArgs, Math.min(remaining, ceilingMs), signal);
    if (result.ok !== true) throw new StepFailure({ ...result, failedStep: operation });
    return result;
  };
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    pid = Number(launched.pid);
    if (!Number.isInteger(pid) || pid <= 0) fail("startup-pid", "Der Start lieferte keine verifizierbare PID.");

    // Erst das breite Fallfenster binden, dann die Startseite des Assistenten
    // abwarten. Der Splash traegt denselben Prozess, aber nie die Ueberschrift.
    let startHeading = "";
    for (;;) {
      const bound = await step("instances", {});
      const instance = asArray<Record<string, unknown>>(bound.instances).find((entry) => Number(entry.pid) === pid);
      if (instance && Number(bound.count) === 1 && instance.hung !== true && instance.recoveredState !== true) {
        hwnd = Number(instance.hwnd);
        const state = await step("ui_state", { hwnd });
        const heading = String(state.heading ?? "");
        const match = wizard.startHeading.exec(heading);
        if (match) {
          if (Number(match[1]) !== taxYear) {
            fail("wizard-page", `Der Assistent bietet das Jahr ${match[1]} an, das Profil erlaubt fuer '${mode}' nur ${taxYear}.`);
          }
          startHeading = heading;
          break;
        }
      }
      if (deadline - now() < WIZARD_RESERVE_MS / 2) {
        fail("wizard-page", "Die Startseite des Assistenten erschien nicht rechtzeitig nach dem Programmstart.");
      }
      await wait(START_PAGE_POLL_MS);
    }

    const subpages = await step("subpages", { hwnd });
    const begin = asArray<Record<string, unknown>>(subpages.unterseiten)
      .find((entry) => String(entry.schalter ?? "") === wizard.beginLink && typeof entry.rid === "string" && entry.rid);
    if (!begin) fail("wizard-page", `Der Startlink '${wizard.beginLink}' fehlt auf '${startHeading}'.`);

    const began = await step("click", {
      rid: begin!.rid, hwnd, expectedPageBefore: startHeading, expectedPageAfter: wizard.modeChoiceHeading, waitMs: 6_000,
    });
    if (String(began.ueberschriftNachher ?? "") !== wizard.modeChoiceHeading) {
      fail("wizard-page", `Nach '${wizard.beginLink}' steht '${String(began.ueberschriftNachher ?? "")}' statt '${wizard.modeChoiceHeading}'.`);
    }
    await step("click", { aid: wizard.modeChoiceAid, hwnd, expectedPageBefore: wizard.modeChoiceHeading, waitMs: 3_000 });
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
      await step("menu_click", { name: wizard.saveMenuEntry, hwnd, waitMs: 5_000 });
      const dialogs = await step("dialog_list", { pid });
      const saveDialogs = asArray<Record<string, unknown>>(dialogs.dialogs).filter((dialog) =>
        String(dialog.kind ?? "") === "native-dialog" && String(dialog.title ?? "") === wizard.saveDialogTitle);
      if (saveDialogs.length !== 1) {
        fail("save-dialog", `Erwartet genau einen nativen Dialog '${wizard.saveDialogTitle}', gefunden ${saveDialogs.length}.`);
      }
    } catch (error) {
      // Ein offen gebliebenes Menue darf das Cleanup nicht blockieren.
      await dependencies.execute("menu_close", { hwnd }, MIN_STEP_MS * 5, signal).catch(() => undefined);
      throw error;
    }

    const saved = await step("file_dialog_select", {
      expectedDialogTitle: wizard.saveDialogTitle, expectedPath: target.path, waitMs: 15_000,
    });
    const sha256 = String(saved.sha256 ?? "");
    if (saved.mode !== "save-new" || saved.verified !== true || !/^[A-F0-9]{64}$/iu.test(sha256)) {
      throw new StepFailure(operationError("Der Speicherdialog schloss ohne verifizierten save-new-Readback.", "postcondition-failed"));
    }
    const readback = await step("instances", { includeHash: true });
    const bound = asArray<Record<string, unknown>>(readback.instances).find((entry) => Number(entry.pid) === pid);
    if (!bound || String(bound.caseName ?? "") !== fileName || bound.recoveredState === true) {
      throw new StepFailure(operationError("Die gespeicherte Datei ist nicht exakt an das offene Fallfenster gebunden.", "postcondition-failed"));
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
      ok: true, created: true, caseRef: target.ref || target.path, sha256: sha256.toUpperCase(), pid, hwnd: Number(bound.hwnd),
      caseHashSource: instanceHash ? "instances" : "local-file",
      mode, taxYear, heading: wizard.masterDataHeading, steps, effects: { ...EFFECTS },
      note: "Der neue Fall ist geoeffnet und leer gespeichert. Stammdaten jetzt mit fill_fields fuellen; " +
        "vor der ersten weiteren Mutation den Dateistand nach backups: sichern.",
    };
  } catch (error) {
    const failure = error instanceof StepFailure
      ? error.result
      : operationError(error instanceof Error ? error.message : String(error), signal?.aborted ? "aborted" : "case-create");
    const created = target !== undefined && existsSync(target.path);
    if (pid > 0 && !created) {
      const cleanupState = await cleanupStartedProcess(dependencies.worker, pid);
      return { ...failure, created: false, steps, pid, ...cleanupState };
    }
    return { ...failure, created, steps, ...(pid > 0 ? { pid, processStillRunning: true } : {}),
      ...(created ? { caseRef: target!.ref || target!.path } : {}) };
  }
}
