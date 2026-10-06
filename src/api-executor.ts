import type { SseApiServerConfig } from "./api-config.js";
import { existsSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, isSseApiOperation, type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { type ExecutionTelemetry, sanitizeWorkerPerformance } from "./execution-telemetry.js";
import { SSE_CAPABILITIES } from "./capabilities.js";
import { CaseFileParserFallbackError, listCaseFiles, readCaseFileInfo } from "./case-file.js";
import { executeCheckerOpen } from "./checker-executor.js";
import {
  executeFillFieldsPlan,
  executeReceiptManagerBulkPlan,
} from "./bulk-plan-executor.js";
import { executeCaseCreate } from "./case-create-executor.js";
import { ExecutorArgumentError, executionError, operationError } from "./executor-errors.js";
import { executeLaunchOperation } from "./launch-executor.js";
import { parseApiOperationArgs, parseCheckerReadOnlyClickArgs } from "./operation-catalog.js";
import { receiptBlock } from "./receipt-interaction-policy.js";
import {
  createProfileOperationMatrix,
  EXPERIMENTAL_PROFILE_BASE_OPERATIONS,
  EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS,
} from "./profile-operation-policy.js";
import { defaultProfilesRoot, loadProductProfile } from "./product-profiles.js";
import { executeLocalPageObjects } from "./page-objects-executor.js";
import type { ScenarioExecutor } from "./scenario.js";
import { executeUstvaOperation, isUstvaOperation } from "./ustva-executor.js";
import { createResourcePathRedactor } from "./resources.js";
import { configuredArgs, resourceRoots, type ConfiguredArguments } from "./configured-args.js";
import { ensureWorkspace } from "./workspace.js";
import { executeWorkspaceOperation, isWorkspaceExecutorOperation } from "./workspace-executor.js";
import { readWorkspaceStatus } from "./workspace-status.js";
import { executeLocalVerify } from "./verify-executor.js";
import { executeLocalWorkingCopy } from "./working-copy-executor.js";
import { executeLocalBackup } from "./backup-executor.js";
import { executeLocalArchive } from "./archive-executor.js";
import { executeQtNativeOperation, isQtNativeOperation, type QtNativeExecutorDependencies } from "./qt-native-executor.js";

export { API_RESOURCE_BINDINGS } from "./api-resource-bindings.js";

function withResourceIdentity(
  redactPaths: <T>(value: T) => T,
  result: WorkerResult,
  resourceRefs: Record<string, string> = {},
): WorkerResult {
  const redacted = redactPaths(result);
  if (!Object.keys(resourceRefs).length) return redacted;
  return { ...redacted, resourceRefs };
}

const MIN_WORKER_FALLBACK_TIMEOUT_MS = 2_000;

function remainingTimeoutMs(timeoutMs: number, startedAt: number): number {
  return Math.max(0, Math.floor(timeoutMs - (performance.now() - startedAt)));
}

export {
  EXPERIMENTAL_PROFILE_BASE_OPERATIONS,
  EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS,
} from "./profile-operation-policy.js";

const EXPERIMENTAL_PROFILE_BASE = new Set<SseApiOperation>(EXPERIMENTAL_PROFILE_BASE_OPERATIONS);
const EXPERIMENTAL_PROFILE_VERIFICATION = new Set<SseApiOperation>(
  EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS,
);

export interface ApiExecutorDependencies extends QtNativeExecutorDependencies {
  /** Internal opt-in; never supplied by public API arguments or configuration. */
  telemetry?: ExecutionTelemetry;
  nativeDesktopStatus?: (timeoutMs: number, signal?: AbortSignal) => Promise<WorkerResult>;
  nativeDesktopStart?: (args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal) => Promise<WorkerResult>;
  nativeDesktopStop?: (args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal) => Promise<WorkerResult>;
  /** Interne Testgrenze; kein benutzerkonfigurierbarer API-Dateipfad. */
  profilesRoot?: string;
  /** Interne Testgrenze fuer die fail-closed SSE-Prozesspruefung der Fallarchivierung. */
  archiveHasRunningSseProcess?: () => Promise<boolean>;
}

function isExperimentalDialogAnswerCandidate(
  operation: SseApiOperation,
  args: Record<string, unknown>,
): boolean {
  // Der Worker bindet diesen Kandidaten zusaetzlich an eine exakt bekannte
  // passive Startnotiz. Alle bestaetigenden, speichernden oder
  // exportierenden Antworten scheitern bereits hier, bevor UI gelesen wird.
  return operation === "dialog_answer" && args.button === "OK";
}

export function createApiExecutor(
  config: SseApiServerConfig,
  rawWorker: ScenarioExecutor,
  dependencies: ApiExecutorDependencies = {},
): ScenarioExecutor {
  const telemetry = dependencies.telemetry;
  const worker: ScenarioExecutor = telemetry?.enabled ? (operation, args, timeoutMs, signal) =>
    telemetry.runWorker(isSseApiOperation(operation) ? operation : undefined, async () => {
      const result = await rawWorker(operation, args, timeoutMs, signal);
      telemetry.recordWorkerPerformance({
        ...sanitizeWorkerPerformance(result),
        ...sanitizeWorkerPerformance(result.performance),
      });
      return result;
    }) : rawWorker;
  const local = async <T>(operation: SseApiOperation, task: () => T | Promise<T>): Promise<T> =>
    telemetry?.enabled ? await telemetry.runNodeLocal(operation, task) : await task();
  const win32 = (task: () => Promise<WorkerResult>): Promise<WorkerResult> =>
    telemetry?.enabled ? telemetry.runWin32(task) : task();
  const roots = resourceRoots(config);
  const profilesRoot = dependencies.profilesRoot ?? defaultProfilesRoot;
  const profile = loadProductProfile(config.profileId, profilesRoot);
  ensureWorkspace(config.workspaceDir);
  ensureWorkspace(config.resultDir);
  ensureWorkspace(roots.documents!);
  ensureWorkspace(roots.backups!);
  const redactPaths = createResourcePathRedactor(roots);
  const receiptLease = /^[A-F0-9]{64}$/u.test(config.interactiveReceiptLeaseToken ?? "");

  const executeWorkerFallback = async (
    operation: SseApiOperation,
    configured: ConfiguredArguments,
    effectiveTimeoutMs: number,
    localStartedAt: number,
    timeoutError: string,
    signal?: AbortSignal,
  ): Promise<WorkerResult> => {
    const fallbackTimeoutMs = remainingTimeoutMs(effectiveTimeoutMs, localStartedAt);
    if (fallbackTimeoutMs < MIN_WORKER_FALLBACK_TIMEOUT_MS) {
      return withResourceIdentity(
        redactPaths,
        operationError(timeoutError, "timeout"),
        configured.resourceRefs,
      );
    }
    const result = await worker(operation, configured.args, fallbackTimeoutMs, signal);
    return withResourceIdentity(redactPaths, result, configured.resourceRefs);
  };

  const executeOperationBody = async (
    operation: SseApiOperation,
    args: Record<string, unknown>,
    timeoutMs: number | undefined,
    signal?: AbortSignal,
    internalCheckerClick = false,
    internalCheckerNavigation = false,
  ): Promise<WorkerResult> => {
    try {
      if (profile.status === "disabled" && !EXPERIMENTAL_PROFILE_BASE.has(operation)) {
        return operationError(
          `Produktprofil '${profile.id}' ist deaktiviert; Betriebsoperationen sind gesperrt.`,
          "profile-disabled",
        );
      }
      const block = receiptBlock(operation, args, receiptLease);
      if (block) return block;
      const verificationOnlyProfile =
        profile.status !== "supported" || profile.operationAccess !== "full";
      if (verificationOnlyProfile && !EXPERIMENTAL_PROFILE_BASE.has(operation)) {
        if (config.operateExperimental !== true) {
          return operationError(
            `Produktprofil '${profile.id}' ist nicht vollstaendig freigegeben ` +
              `(status=${profile.status}, operationAccess=${profile.operationAccess}). ` +
              "Nur Katalog- und Dateiauskuenfte sind erlaubt. Fuer eine bewusste Jahresverifikation " +
              "operateExperimental: true in der API-Konfiguration setzen.",
            "profile-unverified",
          );
        }
        if (
          !EXPERIMENTAL_PROFILE_VERIFICATION.has(operation) &&
          !internalCheckerNavigation &&
          !isExperimentalDialogAnswerCandidate(operation, args)
        ) {
          return operationError(
            `Operation '${operation}' ist fuer das eingeschraenkte Produktprofil '${profile.id}' ` +
              "nicht im expliziten Verifikationskatalog. operateExperimental erlaubt nur den " +
              "geprueften Lese-, Navigations- und Disposable-Copy-Lebenszyklus.",
            "profile-operation-unverified",
          );
        }
      }
      args = internalCheckerClick
        ? parseCheckerReadOnlyClickArgs(args)
        : parseApiOperationArgs(operation, args);
      if (operation === "desktop_status" && dependencies.nativeDesktopStatus) {
        return redactPaths(await win32(() => dependencies.nativeDesktopStatus!(timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS, signal)));
      }
      if (isQtNativeOperation(operation)
        && (dependencies.qtNativeClient || dependencies.qtNativeClientFor)) {
        const executeNative = () => executeQtNativeOperation(operation, args, dependencies, timeoutMs, signal, profile);
        return redactPaths(await (telemetry?.enabled ? telemetry.runQtNative(executeNative) : executeNative()));
      }
      if (operation === "capabilities") {
        return {
          ok: true,
          ...SSE_CAPABILITIES,
          profile: {
            id: profile.id,
            status: profile.status,
            operationAccess: profile.operationAccess,
            operateExperimental: config.operateExperimental === true,
            interactiveReceiptLeaseActive: receiptLease,
          },
          operationPolicy: createProfileOperationMatrix(
            profile.status,
            profile.operationAccess,
            config.operateExperimental === true,
            receiptLease,
          ),
          buildDriftPolicy: "block-ui-tax-mutations",
        };
      }
      if (operation === "workspace_status") {
        return await local(operation, () => readWorkspaceStatus({
          ...config,
          profileId: config.profileId ?? "2025",
          documentsDir: roots.documents!,
          backupsDir: roots.backups!,
        }));
      }
      if (operation === "page_objects") {
        const configured = configuredArgs(operation, args, config);
        const localResult = await local(operation, () => executeLocalPageObjects({
          profileId: profile.id,
          profilesRoot,
          args: configured.args,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
        }));
        if (localResult.kind === "result") return localResult.result;
        return await executeWorkerFallback(
          operation,
          configured,
          localResult.effectiveTimeoutMs,
          localResult.localStartedAt,
          "Verbleibendes Zeitbudget reicht nicht fuer einen sicheren Worker-Fallback des Page-Object-Katalogs.",
          signal,
        );
      }
      if (operation === "verify") {
        const configured = configuredArgs(operation, args, config);
        const localResult = await local(operation, () => executeLocalVerify({
          args: configured.args,
          resourceRefs: configured.resourceRefs,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
        }));
        if (localResult.kind === "result") return localResult.result;
        return await executeWorkerFallback(
          operation,
          configured,
          localResult.effectiveTimeoutMs,
          localResult.localStartedAt,
          "Verbleibendes Zeitbudget reicht nicht fuer einen sicheren Worker-Fallback der Collect-Verifikation.",
          signal,
        );
      }
      if (operation === "make_working_copy") {
        const configured = configuredArgs(operation, args, config);
        return await local(operation, () => executeLocalWorkingCopy({
          args: configured.args,
          resourceRefs: configured.resourceRefs,
          profile,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
        }));
      }
      if (operation === "backup_cases") {
        const configured = configuredArgs(operation, args, config);
        return await local(operation, () => executeLocalBackup({
          args: configured.args,
          resourceRefs: configured.resourceRefs,
          profile,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
        }));
      }
      if (operation === "archive_cases") {
        const configured = configuredArgs(operation, args, config);
        return await local(operation, () => executeLocalArchive({
          args: configured.args,
          resourceRefs: configured.resourceRefs,
          profile,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
          ...(dependencies.archiveHasRunningSseProcess
            ? { hasRunningSseProcess: dependencies.archiveHasRunningSseProcess }
            : {}),
        }));
      }
      if (isWorkspaceExecutorOperation(operation)) {
        return await executeWorkspaceOperation(operation, args, {
          roots,
          workspaceDir: config.workspaceDir,
          resultDir: config.resultDir,
          timeoutMs,
          ...(signal ? { signal } : {}),
          execute: executeOperation,
          redactPaths,
        });
      }
      if (operation === "checker_open") {
        // Die oeffentlichen Argumente sind an dieser Stelle bereits strikt
        // geprueft. Erst danach kompiliert checker_open seinen privaten Plan,
        // der in genau EINEM Worker ausgefuehrt wird und nie als API-Operation
        // oder frei waehlbare Szenarioaktion erreichbar ist.
        const configured = configuredArgs(operation, args, config);
        return redactPaths(await executeCheckerOpen(
          configured.args,
          timeoutMs,
          signal,
          (privateOperation, privateArgs, privateTimeoutMs, privateSignal) => worker(
            privateOperation as SseApiOperation,
            privateArgs,
            privateTimeoutMs,
            privateSignal,
          ),
        ));
      }
      if (isUstvaOperation(operation)) {
        return await executeUstvaOperation(operation, args, timeoutMs, signal, executeOperation);
      }
      if (operation === "case_create") {
        return redactPaths(await executeCaseCreate(args, timeoutMs, signal, {
          execute: executeOperation,
          worker,
          resolveTarget: (raw) => {
            const configured = configuredArgs("case_create", raw, config);
            return { path: String(configured.args.targetPath ?? ""), ref: configured.resourceRefs.targetRef ?? "" };
          },
          profile,
        }));
      }
      if (operation === "fill_fields") {
        return await executeFillFieldsPlan(args, timeoutMs, signal, {
          pageObjectsCatalog: profile.pageObjectsCatalog,
          configure: (nestedOperation, nestedArgs) => configuredArgs(nestedOperation, nestedArgs, config),
          worker,
          finish: (result, resourceRefs) => withResourceIdentity(redactPaths, result, resourceRefs),
          executionError,
        });
      }
      if (operation === "receipt_manager_bulk_upsert") {
        const configured = configuredArgs(operation, args, config);
        return await executeReceiptManagerBulkPlan(args, configured, timeoutMs, signal, {
          worker,
          finish: (result, resourceRefs) => withResourceIdentity(redactPaths, result, resourceRefs),
          executionError,
        });
      }
      const configured = configuredArgs(operation, args, config);
      if (operation === "desktop_stop" && dependencies.nativeDesktopStop) {
        return redactPaths(await win32(() => dependencies.nativeDesktopStop!(configured.args, timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS, signal)));
      }
      if (operation === "desktop_start" && dependencies.nativeDesktopStart) {
        return withResourceIdentity(redactPaths,
          await win32(() => dependencies.nativeDesktopStart!(configured.args, timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS, signal)), configured.resourceRefs);
      }
      if (internalCheckerNavigation) {
        // Kein oeffentliches Argumentschema akzeptiert dieses Feld. Es wird
        // erst nach der strikten Validierung fuer den eng gebundenen
        // checker_open-Navigationsschritt an den Worker angehaengt.
        configured.args.experimentalCheckerNavigation = true;
      }
      if (
        operation === "screenshot" &&
        typeof configured.args.path === "string" &&
        existsSync(configured.args.path)
      ) {
        throw new ExecutorArgumentError(
          "Screenshot-Zieldatei existiert bereits; fuer Kontrollbilder immer eine neue results:-Referenz verwenden.",
        );
      }
      if (operation === "launch") {
        const result = await executeLaunchOperation(configured.args, timeoutMs, signal, worker);
        return withResourceIdentity(redactPaths, result, configured.resourceRefs);
      }
      if (
        operation === "list_cases" &&
        configured.args.verbose !== true &&
        typeof configured.args.dir === "string" &&
        existsSync(configured.args.dir)
      ) {
        const effectiveTimeoutMs = timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
        const localStartedAt = performance.now();
        try {
          const result = await local(operation, () => listCaseFiles(String(configured.args.dir), profile, {
            includeBackups: configured.args.includeBackups === true,
            timeoutMs: effectiveTimeoutMs,
            ...(signal ? { signal } : {}),
          }));
          return withResourceIdentity(redactPaths, result, configured.resourceRefs);
        } catch (error) {
          if (!(error instanceof CaseFileParserFallbackError)) {
            return withResourceIdentity(redactPaths, executionError(operation, error), configured.resourceRefs);
          }
          return await executeWorkerFallback(
            operation,
            configured,
            effectiveTimeoutMs,
            localStartedAt,
            "Verbleibendes Zeitbudget reicht nicht fuer einen sicheren Worker-Fallback der Fallliste.",
            signal,
          );
        }
      }
      if (operation === "case_hash") {
        const path = configured.args.path;
        if (typeof path !== "string") throw new ExecutorArgumentError("'path' fehlt.");
        try {
          const result = await local(operation, () => readCaseFileInfo(path, profile, {
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(signal ? { signal } : {}),
          }));
          return withResourceIdentity(redactPaths, result, configured.resourceRefs);
        } catch (error) {
          return withResourceIdentity(redactPaths, executionError(operation, error), configured.resourceRefs);
        }
      }
      let createdExportDirectory: string | undefined;
      if (
        operation === "export_csv" &&
        typeof configured.args.dir === "string" &&
        configured.resourceRefs.resultRef?.startsWith("results:") &&
        !existsSync(configured.args.dir)
      ) {
        const firstCreatedDirectory = mkdirSync(configured.args.dir, { recursive: true });
        if (firstCreatedDirectory === undefined) {
          throw new ExecutorArgumentError(
            "CSV-Ergebnisordner erschien waehrend des Preflights; fremdes Ziel wird nicht verwendet.",
          );
        }
        // mkdirSync gibt die oberste neu angelegte Komponente zurueck. Diese
        // merken wir als Cleanup-Wurzel, damit ein fehlgeschlagener Export
        // keine leere verschachtelte results:-Struktur hinterlaesst.
        createdExportDirectory = firstCreatedDirectory;
      }
      let result: WorkerResult | undefined;
      try {
        result = await worker(operation, configured.args, timeoutMs, signal);
      } finally {
        if (createdExportDirectory && result?.ok !== true) {
          try {
            let candidate = configured.args.dir;
            while (
              typeof candidate === "string" &&
              existsSync(candidate) &&
              readdirSync(candidate).length === 0
            ) {
              rmdirSync(candidate);
              if (candidate === createdExportDirectory) break;
              candidate = dirname(candidate);
            }
          } catch {
            // Best-effort-Aufraeumen darf weder den strukturierten Workerfehler
            // verdecken noch eine zwischenzeitlich extern angelegte Datei
            // entfernen. Der leere Ordner kann beim naechsten Lauf bleiben.
          }
        }
      }
      // Eine Zeile anzuhaengen scheitert, solange die Anlegezeile ausserhalb
      // des Sichtbereichs liegt: Qt haelt nur rund sechs Zeilen im
      // UIA-Baum, und die Tastaturnavigation zum Tabellenende bewegt diese
      // Tabelle nachweislich nicht - gemessen blieb die unterste sichtbare
      // Zeile nach 41 Pfeiltasten unveraendert.
      //
      // Der Cursorlauf von table_read schafft dieselbe Strecke dagegen
      // zuverlaessig durch 45 Zeilen. Bisher musste der Aufrufer das wissen
      // und selbst einen vollstaendigen Lesevorgang vorschalten. Genau das
      // macht "haenge eine Zeile an" unbrauchbar.
      //
      // Deshalb hier: einmal lesen, einmal wiederholen - und nur auf diesem
      // langsamen Pfad. Der schnelle Weg mit sichtbarer Anlegezeile bleibt
      // ein einziger Workeraufruf.
      if (
        operation === "table_add" &&
        result?.ok !== true &&
        result?.kind === "not-found" &&
        typeof result?.error === "string" &&
        result.error.includes("Keine freie Tabellenzeile")
      ) {
        const readArgs: Record<string, unknown> = { maxRows: 400 };
        for (const key of ["sumLabel", "sumOccurrence", "hwnd", "pid"] as const) {
          if (configured.args[key] !== undefined) readArgs[key] = configured.args[key];
        }
        const configuredRead = configuredArgs("table_read", readArgs, config);
        const scrolled = await worker("table_read", configuredRead.args, timeoutMs, signal);
        if (scrolled?.ok === true) {
          const retried = await worker(operation, configured.args, timeoutMs, signal);
          return withResourceIdentity(redactPaths, {
            ...retried,
            freeRowSearch: {
              retriedAfterTableWalk: true,
              rowsWalked: scrolled.anzahl ?? null,
            },
          }, configured.resourceRefs);
        }
      }
      return withResourceIdentity(redactPaths, result, configured.resourceRefs);
    } catch (error) {
      return redactPaths(executionError(operation, error));
    }
  };
  const executeOperation: typeof executeOperationBody = (operation, ...parameters) =>
    telemetry?.enabled
      ? telemetry.runCompositeChild(operation, () => executeOperationBody(operation, ...parameters))
      : executeOperationBody(operation, ...parameters);
  const execute: ScenarioExecutor = (operation, args, timeoutMs, signal) =>
    telemetry?.enabled
      ? telemetry.runApi(operation, () => executeOperationBody(operation, args, timeoutMs, signal, false, false))
      : executeOperationBody(operation, args, timeoutMs, signal, false, false);
  return execute;
}
