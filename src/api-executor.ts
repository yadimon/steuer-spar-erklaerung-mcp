import type { SseApiServerConfig } from "./api-config.js";
import { existsSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { ZodError } from "zod";
import { SSE_CAPABILITIES } from "./capabilities.js";
import {
  CaseFileParserFallbackError,
  listCaseFiles,
  readCaseFileInfo,
} from "./case-file.js";
import { executeCheckerOpen } from "./checker-executor.js";
import {
  executeFillFieldsPlan,
  executeReceiptManagerBulkPlan,
  resolveReceiptManagerBulkReferences,
} from "./bulk-plan-executor.js";
import { API_RESOURCE_BINDINGS } from "./api-resource-bindings.js";
import { executeCaseCreate } from "./case-create-executor.js";
import { ExecutorArgumentError, operationError } from "./executor-errors.js";
import { executeLaunchOperation } from "./launch-executor.js";
import { parseApiOperationArgs, parseCheckerReadOnlyClickArgs } from "./operation-catalog.js";
import { receiptBlock } from "./receipt-interaction-policy.js";
import {
  createProfileOperationMatrix,
  EXPERIMENTAL_PROFILE_BASE_OPERATIONS,
  EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS,
} from "./profile-operation-policy.js";
import {
  defaultProfilesRoot,
  loadProductProfile,
} from "./product-profiles.js";
import { executeLocalPageObjects } from "./page-objects-executor.js";
import type { ScenarioExecutor } from "./scenario.js";
import { executeUstvaOperation, isUstvaOperation } from "./ustva-executor.js";
import {
  createResourcePathRedactor,
  resolveResourceReference,
  type ResourceArea,
  type ResourceRoots,
  type ResolvedResourceReference,
} from "./resources.js";
import { ensureWorkspace } from "./workspace.js";
import { executeWorkspaceOperation, isWorkspaceExecutorOperation } from "./workspace-executor.js";
import { readWorkspaceStatus } from "./workspace-status.js";
import { executeLocalVerify } from "./verify-executor.js";
import { executeLocalWorkingCopy } from "./working-copy-executor.js";
import { executeLocalBackup } from "./backup-executor.js";
import { executeLocalArchive } from "./archive-executor.js";

interface ConfiguredArguments {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
}

export { API_RESOURCE_BINDINGS } from "./api-resource-bindings.js";

function resourceRoots(config: SseApiServerConfig): ResourceRoots {
  return {
    cases: config.caseDir,
    documents: config.documentsDir ?? join(config.workspaceDir, "documents"),
    workspace: config.workspaceDir,
    results: config.resultDir,
    backups: config.backupsDir ?? join(config.workspaceDir, "backups"),
  };
}

function resolveAlias(
  args: Record<string, unknown>,
  resourceRefs: Record<string, string>,
  roots: ResourceRoots,
  alias: string,
  legacy: string,
  allowedAreas: readonly ResourceArea[],
): void {
  if (args[alias] === undefined) return;
  if (args[legacy] !== undefined) {
    throw new ExecutorArgumentError(`'${alias}' und '${legacy}' duerfen nicht gemeinsam angegeben werden.`);
  }
  if (typeof args[alias] !== "string") throw new ExecutorArgumentError(`'${alias}' muss eine Ressourcenreferenz sein.`);
  let resolved: ResolvedResourceReference;
  try {
    resolved = resolveResourceReference(roots, args[alias], allowedAreas);
  } catch (error) {
    throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
  }
  delete args[alias];
  args[legacy] = resolved.path;
  resourceRefs[alias] = resolved.ref;
}

function resolveSaveCorrectionReferences(
  args: Record<string, unknown>,
  resourceRefs: Record<string, string>,
  roots: ResourceRoots,
): void {
  if (args.correction === undefined) return;
  if (!args.correction || typeof args.correction !== "object" || Array.isArray(args.correction)) {
    throw new ExecutorArgumentError("'correction' muss ein Objekt sein.");
  }
  const correction = { ...(args.correction as Record<string, unknown>) };
  const bindings = [
    ["sourceRef", "sourcePath", ["cases"]],
    ["backupRef", "backupPath", ["backups"]],
  ] as const;
  for (const [alias, workerField, allowedAreas] of bindings) {
    const value = correction[alias];
    if (typeof value !== "string") {
      throw new ExecutorArgumentError(`'correction.${alias}' muss eine Ressourcenreferenz sein.`);
    }
    let resolved: ResolvedResourceReference;
    try {
      resolved = resolveResourceReference(roots, value, allowedAreas);
    } catch (error) {
      throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
    }
    delete correction[alias];
    correction[workerField] = resolved.path;
    resourceRefs[`correction.${alias}`] = resolved.ref;
  }
  args.correction = correction;
}

function configuredArgs(
  operation: SseApiOperation,
  args: Record<string, unknown>,
  config: SseApiServerConfig,
): ConfiguredArguments {
  const result = { ...args };
  const roots = resourceRoots(config);
  const resourceRefs: Record<string, string> = {};
  for (const binding of API_RESOURCE_BINDINGS[operation] ?? []) {
    resolveAlias(
      result,
      resourceRefs,
      roots,
      binding.alias,
      binding.workerField,
      binding.allowedAreas,
    );
  }
  if (operation === "save") resolveSaveCorrectionReferences(result, resourceRefs, roots);
  if (operation === "receipt_manager_bulk_upsert") {
    resolveReceiptManagerBulkReferences(result, resourceRefs, roots);
  }
  if (operation === "launch" || operation === "desktop_start") {
    if (result.exe !== undefined) {
      throw new ExecutorArgumentError("'exe' wird ausschliesslich in der lokalen API-Konfiguration festgelegt.");
    }
    if (config.sseExecutable) result.exe = config.sseExecutable;
  }
  if (
    (operation === "list_cases" || operation === "backup_cases" || operation === "archive_cases") &&
    result.dir === undefined &&
    config.caseDir
  ) {
    result.dir = config.caseDir;
  }
  return { args: result, resourceRefs };
}

function withResourceIdentity(
  redactPaths: <T>(value: T) => T,
  result: WorkerResult,
  resourceRefs: Record<string, string> = {},
): WorkerResult {
  const redacted = redactPaths(result);
  if (!Object.keys(resourceRefs).length) return redacted;
  return { ...redacted, resourceRefs };
}

function executionError(operation: SseApiOperation, error: unknown): WorkerResult {
  const explicitKind =
    error && typeof error === "object" && typeof (error as { kind?: unknown }).kind === "string"
      ? String((error as { kind: string }).kind)
      : undefined;
  return {
    ok: false,
    kind:
      explicitKind ??
      (error instanceof ZodError || error instanceof ExecutorArgumentError
        ? "bad-args"
        : operation.startsWith("workspace_") || operation === "scenario_run"
          ? "workspace"
          : "worker"),
    error: error instanceof Error ? error.message : String(error),
  };
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

export interface ApiExecutorDependencies {
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
  worker: ScenarioExecutor,
  dependencies: ApiExecutorDependencies = {},
): ScenarioExecutor {
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

  const executeOperation = async (
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
        return readWorkspaceStatus({
          ...config,
          profileId: config.profileId ?? "2025",
          documentsDir: roots.documents!,
          backupsDir: roots.backups!,
        });
      }
      if (operation === "page_objects") {
        const configured = configuredArgs(operation, args, config);
        const local = executeLocalPageObjects({
          profileId: profile.id,
          profilesRoot,
          args: configured.args,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
        });
        if (local.kind === "result") return local.result;
        return await executeWorkerFallback(
          operation,
          configured,
          local.effectiveTimeoutMs,
          local.localStartedAt,
          "Verbleibendes Zeitbudget reicht nicht fuer einen sicheren Worker-Fallback des Page-Object-Katalogs.",
          signal,
        );
      }
      if (operation === "verify") {
        const configured = configuredArgs(operation, args, config);
        const local = await executeLocalVerify({
          args: configured.args,
          resourceRefs: configured.resourceRefs,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
        });
        if (local.kind === "result") return local.result;
        return await executeWorkerFallback(
          operation,
          configured,
          local.effectiveTimeoutMs,
          local.localStartedAt,
          "Verbleibendes Zeitbudget reicht nicht fuer einen sicheren Worker-Fallback der Collect-Verifikation.",
          signal,
        );
      }
      if (operation === "make_working_copy") {
        const configured = configuredArgs(operation, args, config);
        return await executeLocalWorkingCopy({
          args: configured.args,
          resourceRefs: configured.resourceRefs,
          profile,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
        });
      }
      if (operation === "backup_cases") {
        const configured = configuredArgs(operation, args, config);
        return await executeLocalBackup({
          args: configured.args,
          resourceRefs: configured.resourceRefs,
          profile,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
        });
      }
      if (operation === "archive_cases") {
        const configured = configuredArgs(operation, args, config);
        return await executeLocalArchive({
          args: configured.args,
          resourceRefs: configured.resourceRefs,
          profile,
          timeoutMs,
          ...(signal ? { signal } : {}),
          redactPaths,
          ...(dependencies.archiveHasRunningSseProcess
            ? { hasRunningSseProcess: dependencies.archiveHasRunningSseProcess }
            : {}),
        });
      }
      if (isWorkspaceExecutorOperation(operation)) {
        return await executeWorkspaceOperation(operation, args, {
          roots,
          workspaceDir: config.workspaceDir,
          resultDir: config.resultDir,
          timeoutMs,
          ...(signal ? { signal } : {}),
          execute,
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
          const result = await listCaseFiles(configured.args.dir, profile, {
            includeBackups: configured.args.includeBackups === true,
            timeoutMs: effectiveTimeoutMs,
            ...(signal ? { signal } : {}),
          });
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
          const result = await readCaseFileInfo(path, profile, {
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(signal ? { signal } : {}),
          });
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
      return withResourceIdentity(redactPaths, result, configured.resourceRefs);
    } catch (error) {
      return redactPaths(executionError(operation, error));
    }
  };
  const execute: ScenarioExecutor = (operation, args, timeoutMs, signal) =>
    executeOperation(operation, args, timeoutMs, signal, false, false);
  return execute;
}
