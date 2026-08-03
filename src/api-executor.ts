import type { SseApiServerConfig } from "./api-config.js";
import { existsSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { asArray, type SseApiOperation, type WorkerResult } from "./api-contract.js";
import { ZodError } from "zod";
import { parseApiOperationArgs, parseCheckerReadOnlyClickArgs } from "./operation-catalog.js";
import { runScenario, type ScenarioExecutor } from "./scenario.js";
import {
  formatResourceReference,
  createResourcePathRedactor,
  resolveResourceReference,
  type ResourceArea,
  type ResourceRoots,
  type ResolvedResourceReference,
} from "./resources.js";
import {
  ensureWorkspace,
  listWorkspaceFiles,
  readWorkspaceText,
  writeWorkspaceText,
} from "./workspace.js";

function operationError(error: string, kind = "operation"): WorkerResult {
  return { ok: false, kind, error };
}

class ExecutorArgumentError extends Error {}

interface ConfiguredArguments {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
}

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

function configuredArgs(
  operation: SseApiOperation,
  args: Record<string, unknown>,
  config: SseApiServerConfig,
): ConfiguredArguments {
  const result = { ...args };
  const roots = resourceRoots(config);
  const resourceRefs: Record<string, string> = {};
  if (operation === "case_hash") resolveAlias(result, resourceRefs, roots, "ref", "path", ["cases"]);
  if (operation === "center_refresh") {
    resolveAlias(result, resourceRefs, roots, "expectedDirectoryRef", "expectedDirectory", ["cases"]);
  }
  if (operation === "launch" || operation === "desktop_start") {
    resolveAlias(result, resourceRefs, roots, "caseRef", "file", ["cases"]);
  }
  if (operation === "collect") resolveAlias(result, resourceRefs, roots, "resultRef", "path", ["results"]);
  if (operation === "export_csv") resolveAlias(result, resourceRefs, roots, "resultRef", "dir", ["results"]);
  if (operation === "verify") resolveAlias(result, resourceRefs, roots, "sourceRef", "from", ["results", "workspace"]);
  if (operation === "screenshot") resolveAlias(result, resourceRefs, roots, "resultRef", "path", ["results"]);
  if (operation === "save") resolveAlias(result, resourceRefs, roots, "caseRef", "expectedPath", ["cases"]);
  if (operation === "file_dialog_select") {
    resolveAlias(result, resourceRefs, roots, "resourceRef", "expectedPath", [
      "cases",
      "documents",
      "workspace",
      "results",
      "backups",
    ]);
  }
  if (operation === "vast_apply" || operation === "tracked_set_value") {
    resolveAlias(result, resourceRefs, roots, "expectedCaseRef", "expectedCasePath", ["cases"]);
  }
  if (operation === "save_as") {
    resolveAlias(result, resourceRefs, roots, "sourceRef", "expectedSourcePath", ["cases"]);
    resolveAlias(result, resourceRefs, roots, "targetRef", "targetPath", ["cases"]);
  }
  if (operation === "make_working_copy") {
    resolveAlias(result, resourceRefs, roots, "sourceRef", "source", ["cases"]);
    resolveAlias(result, resourceRefs, roots, "targetRef", "target", ["cases"]);
  }
  if (operation === "backup_cases" || operation === "archive_cases") {
    resolveAlias(result, resourceRefs, roots, "destinationRef", "dest", ["backups"]);
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

function resourceArgument(
  roots: ResourceRoots,
  ref: string,
  area: unknown,
  defaultArea: ResourceArea,
  allowedAreas: readonly ResourceArea[],
): ResolvedResourceReference {
  if (ref.includes(":")) {
    if (area !== undefined) throw new ExecutorArgumentError("'area' darf nicht zusammen mit einer vollstaendigen Ressourcenreferenz stehen.");
    return resolveResourceReference(roots, ref, allowedAreas);
  }
  const selectedArea = area === undefined ? defaultArea : String(area);
  if (!allowedAreas.includes(selectedArea as ResourceArea)) {
    throw new ExecutorArgumentError(`Ressourcenbereich '${selectedArea}' ist fuer diesen Aufruf nicht erlaubt.`);
  }
  return resolveResourceReference(roots, formatResourceReference(selectedArea as ResourceArea, ref), allowedAreas);
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

export function createApiExecutor(config: SseApiServerConfig, worker: ScenarioExecutor): ScenarioExecutor {
  const roots = resourceRoots(config);
  ensureWorkspace(config.workspaceDir);
  ensureWorkspace(config.resultDir);
  ensureWorkspace(roots.documents!);
  ensureWorkspace(roots.backups!);
  const redactPaths = createResourcePathRedactor(roots);

  const executeOperation = async (
    operation: SseApiOperation,
    args: Record<string, unknown>,
    timeoutMs: number | undefined,
    signal?: AbortSignal,
    internalCheckerClick = false,
  ): Promise<WorkerResult> => {
    try {
      // HTTP-Aufrufe wurden bereits am Serverrand geprueft. Dieser zweite
      // Einstieg ist absichtlich noetig, weil Szenarien und komponierte
      // Operationen den Executor direkt aufrufen.
      args = internalCheckerClick
        ? parseCheckerReadOnlyClickArgs(args)
        : parseApiOperationArgs(operation, args);
      if (operation === "workspace_status") {
        return {
          ok: true,
          workspaceReady: true,
          resultAreaReady: true,
          caseDirectoryConfigured: Boolean(config.caseDir),
          documentAreaReady: true,
          backupAreaReady: true,
          sseExecutableConfigured: Boolean(config.sseExecutable),
        };
      }
      if (operation === "workspace_file_list") {
        const ref = typeof args.ref === "string" ? args.ref : "workspace:.";
        const limit = args.limit === undefined ? 500 : args.limit;
        if (typeof limit !== "number" || !Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > 2_000) {
          throw new Error("'limit' muss eine ganze Zahl zwischen 1 und 2000 sein.");
        }
        if (args.includeHashes !== undefined && typeof args.includeHashes !== "boolean") {
          throw new Error("'includeHashes' muss true oder false sein.");
        }
        const resource = resourceArgument(roots, ref, args.area, "workspace", [
          "cases",
          "documents",
          "workspace",
          "results",
          "backups",
        ]);
        return redactPaths({
          ok: true,
          ref: resource.ref,
          files: listWorkspaceFiles(resource.root, resource.relativePath, limit, args.includeHashes !== false).map((file) => ({
            ...file,
            ref: formatResourceReference(resource.area, file.ref),
          })),
        });
      }
      if (operation === "workspace_file_read_text") {
        if (typeof args.ref !== "string") throw new Error("'ref' fehlt.");
        const resource = resourceArgument(roots, args.ref, args.area, "workspace", [
          "cases",
          "documents",
          "workspace",
          "results",
          "backups",
        ]);
        const file = readWorkspaceText(resource.root, resource.relativePath);
        return { ...redactPaths({ ok: true, ...file.info, ref: resource.ref }), text: file.text };
      }
      if (operation === "workspace_file_write_text") {
        if (typeof args.ref !== "string") throw new Error("'ref' fehlt.");
        if (typeof args.text !== "string") throw new Error("'text' fehlt.");
        const resource = resourceArgument(roots, args.ref, args.area, "workspace", ["workspace", "results"]);
        const expectedSha256 = typeof args.expectedSha256 === "string" ? args.expectedSha256 : undefined;
        const info = writeWorkspaceText(resource.root, resource.relativePath, args.text, expectedSha256);
        return redactPaths({ ok: true, ...info, ref: resource.ref });
      }
      if (operation === "scenario_run") {
        if (typeof args.scenarioRef !== "string") throw new Error("'scenarioRef' fehlt.");
        const scenarioResource = resourceArgument(roots, args.scenarioRef, undefined, "workspace", ["workspace"]);
        const resultResource =
          typeof args.resultRef === "string"
            ? resourceArgument(roots, args.resultRef, undefined, "results", ["results"])
            : undefined;
        const expectedResultSha256 = typeof args.expectedResultSha256 === "string" ? args.expectedResultSha256 : undefined;
        const scenarioResult = await runScenario(
          config.workspaceDir,
          config.resultDir,
          scenarioResource.relativePath,
          resultResource?.relativePath,
          expectedResultSha256,
          timeoutMs,
          signal,
          execute,
        );
        const stableResultRef = resultResource?.ref ??
          (typeof scenarioResult.resultRef === "string"
            ? formatResourceReference("results", scenarioResult.resultRef)
            : undefined);
        return redactPaths({
          ...scenarioResult,
          scenarioRef: scenarioResource.ref,
          ...(stableResultRef ? { resultRef: stableResultRef } : {}),
        });
      }
      if (operation === "checker_open") {
        if (typeof args.name !== "string" || !args.name.trim()) throw new Error("'name' fehlt.");
        const target = args.hwnd === undefined ? {} : { hwnd: args.hwnd };
        const deadline = Date.now() + Math.min(timeoutMs ?? 300_000, 300_000);
        const step = async (
          nestedOperation: SseApiOperation,
          nestedArgs: Record<string, unknown>,
          preferredTimeoutMs: number,
        ): Promise<WorkerResult> => {
          if (signal?.aborted) return operationError("API-Client hat den Aufruf abgebrochen; Zustand vor Wiederholung lesen.", "aborted");
          const remainingMs = deadline - Date.now();
          if (remainingMs < 200) return operationError("Gesamtfrist fuer checker_open ist abgelaufen; Zustand vor Wiederholung lesen.", "timeout");
          const checkerClick = nestedOperation === "click_point" && nestedArgs.checkerReadOnly === true;
          return await executeOperation(
            nestedOperation,
            nestedArgs,
            Math.min(preferredTimeoutMs, remainingMs),
            signal,
            checkerClick,
          );
        };
        let current = await step("checker_results", target, 180_000);
        if (current.ok === false) return current;
        if (current.aktiv === true && current.konsistent !== true) {
          const visible = [
            ...asArray<Record<string, unknown>>(current.fragenWarnungen),
            ...asArray<Record<string, unknown>>(current.tippsZusatzinfos),
            ...asArray<Record<string, unknown>>(current.sonstige),
          ];
          if (!visible.some((message) => message.text === args.name)) {
            return operationError(
              "Der Qt-Prueferbaum ist unvollstaendig und die gewuenschte Meldung darin nicht sichtbar; keine Seriennavigation ausgefuehrt.",
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
            return operationError("Steuerpruefer wurde gestartet, aber der Ergebnisbaum ist nicht vollstaendig lesbar.", "checker-incomplete");
          }
        }
        const messages = [
          ...asArray<Record<string, unknown>>(current.fragenWarnungen),
          ...asArray<Record<string, unknown>>(current.tippsZusatzinfos),
          ...asArray<Record<string, unknown>>(current.sonstige),
        ];
        if (!messages.some((message) => message.text === args.name)) {
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
          const afterReset = [
            ...asArray<Record<string, unknown>>(reset.fragenWarnungen),
            ...asArray<Record<string, unknown>>(reset.tippsZusatzinfos),
            ...asArray<Record<string, unknown>>(reset.sonstige),
          ];
          if (!afterReset.some((message) => message.text === args.name)) {
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
      const configured = configuredArgs(operation, args, config);
      let createdExportDirectory: string | undefined;
      if (
        operation === "export_csv" &&
        typeof configured.args.dir === "string" &&
        configured.resourceRefs.resultRef?.startsWith("results:") &&
        !existsSync(configured.args.dir)
      ) {
        mkdirSync(configured.args.dir, { recursive: true });
        createdExportDirectory = configured.args.dir;
      }
      let result: WorkerResult | undefined;
      try {
        result = await worker(operation, configured.args, timeoutMs, signal);
      } finally {
        if (
          createdExportDirectory &&
          result?.ok !== true &&
          existsSync(createdExportDirectory) &&
          readdirSync(createdExportDirectory).length === 0
        ) {
          rmdirSync(createdExportDirectory);
        }
      }
      return withResourceIdentity(redactPaths, result, configured.resourceRefs);
    } catch (error) {
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
  };
  const execute: ScenarioExecutor = (operation, args, timeoutMs, signal) =>
    executeOperation(operation, args, timeoutMs, signal, false);
  return execute;
}
