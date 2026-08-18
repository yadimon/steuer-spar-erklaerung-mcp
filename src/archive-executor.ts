import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { open, readdir, stat, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import {
  copyOpenFileToArchive,
  filePathMatchesIdentityAndHash,
  hashFilePath,
  hashOpenFile,
  openFileMatchesPath,
  type OpenFile,
} from "./archive-file-copy.js";
import { isProfileCaseFileName, readCaseFileInfo } from "./case-file.js";
import { operationError } from "./executor-errors.js";
import { sameFileIdentity, sameFileState } from "./file-identity.js";
import {
  createOwnedDirectoryChain,
  csvManifest,
  directoryHasExactEntries,
  directoryStillOwned,
  errorCode,
  handleContainsExactBytes,
  isInside,
  LocalFileError,
  LocalOperationStopped,
  type OwnedDirectory,
  pathExists,
  removeOwnedEmptyDirectory,
  withResourceIdentity,
} from "./local-file-transaction.js";
import { removeOwnedFile, removeOwnedFilePrefix } from "./owned-file.js";
import type { ProductProfile } from "./product-profiles.js";
import { hasRunningSseProcess } from "./sse-process-guard.js";

interface ArchiveArgument {
  name: string;
  expectedSha256: string;
}

interface BoundCase extends ArchiveArgument {
  actualName: string;
  source: string;
  handle: OpenFile;
  identity: BigIntStats;
  bytes: number;
}

interface MovedCase extends BoundCase {
  target: string;
  targetIdentity: BigIntStats;
}

interface OwnedManifest {
  path: string;
  identity: BigIntStats;
  bytes: number;
  sha256: string;
  content: Buffer;
  complete: boolean;
}

export interface LocalArchiveOptions {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
  profile: ProductProfile;
  timeoutMs: number | undefined;
  signal?: AbortSignal;
  redactPaths: <T>(value: T) => T;
  /** Interne Testnaht; Produktion prueft tasklist.exe fail-closed. */
  hasRunningSseProcess?: () => Promise<boolean>;
  /** Interne Testnaht nach einer vollstaendig verifizierten Bewegung. */
  afterFileMoved?: (file: { source: string; target: string; sha256: string }) => void | Promise<void>;
  /** Interne Testnaht fuer einen partiellen Manifest-Schreibfehler. */
  writeManifest?: (handle: OpenFile, content: Buffer) => Promise<void>;
  removeSource?: (path: string) => Promise<void>;
}

function asArchiveArguments(value: unknown): ArchiveArgument[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const result: ArchiveArgument[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return undefined;
    const name = (entry as { name?: unknown }).name;
    const hash = (entry as { expectedSha256?: unknown }).expectedSha256;
    if (typeof name !== "string" || typeof hash !== "string") return undefined;
    result.push({ name, expectedSha256: hash.toUpperCase() });
  }
  return result;
}

async function bindCase(
  source: string,
  argument: ArchiveArgument,
  actualName: string,
  profile: ProductProfile,
  remainingMs: () => number,
  signal?: AbortSignal,
): Promise<BoundCase & { transmitted: boolean | "unknown" }> {
  const info = await readCaseFileInfo(source, profile, {
    timeoutMs: remainingMs(),
    ...(signal ? { signal } : {}),
  });
  let handle: OpenFile | undefined;
  try {
    handle = await open(source, "r");
    const before = await handle.stat({ bigint: true });
    const pathBefore = await stat(source, { bigint: true });
    if (!before.isFile() || !sameFileState(before, pathBefore) || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new LocalFileError(`Fall '${actualName}' konnte nicht stabil gebunden werden.`, "resource-changed");
    }
    const hash = await hashOpenFile(handle);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await stat(source, { bigint: true });
    if (!sameFileState(before, after) || !sameFileState(after, pathAfter) || hash !== info.sha256) {
      throw new LocalFileError(`Fall '${actualName}' wurde waehrend der Archivvorbereitung veraendert.`, "resource-changed");
    }
    if (hash !== argument.expectedSha256) {
      throw new LocalFileError(`Hash fuer '${argument.name}' stimmt nicht; NICHTS verschoben.`, "precondition-failed");
    }
    return {
      ...argument,
      actualName,
      source,
      handle,
      identity: before,
      bytes: Number(before.size),
      transmitted: info.transmitted,
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    throw error;
  }
}

async function sourcePathStillBound(file: BoundCase): Promise<boolean> {
  return await openFileMatchesPath(file.handle, file.source, file.identity, file.expectedSha256);
}

async function caseInventory(
  directory: string,
  profile: ProductProfile,
): Promise<{ names: string[]; byLowerName: Map<string, string>; collision: string | undefined }> {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isProfileCaseFileName(entry.name, profile, true))
    .map((entry) => entry.name);
  const byLowerName = new Map<string, string>();
  let collision: string | undefined;
  for (const name of names) {
    const key = name.toLowerCase();
    if (byLowerName.has(key)) collision = name;
    else byLowerName.set(key, name);
  }
  return { names, byLowerName, collision };
}

async function writeVerifiedManifest(
  destination: string,
  rows: readonly { file: string; sha256: string }[],
  writeManifest?: (handle: OpenFile, content: Buffer) => Promise<void>,
): Promise<{ manifest: OwnedManifest; handle: OpenFile }> {
  const path = join(destination, "pruefsummen.csv");
  const content = csvManifest(rows);
  const sha256 = createHash("sha256").update(content).digest("hex").toUpperCase();
  const handle = await open(path, "wx+");
  const identity = await handle.stat({ bigint: true });
  const manifest: OwnedManifest = {
    path, identity, bytes: content.length, sha256, content, complete: false,
  };
  try {
    await (writeManifest ?? ((target, bytes) => target.writeFile(bytes)))(handle, content);
    await handle.sync();
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat(path, { bigint: true });
    if (
      !sameFileIdentity(identity, afterHandle) || !sameFileState(afterHandle, afterPath) ||
      afterHandle.size !== BigInt(content.length) || !(await handleContainsExactBytes(handle, content))
    ) {
      throw new LocalFileError("Pruefsummenmanifest wurde waehrend des Schreibens ersetzt.", "postcondition-failed");
    }
    manifest.complete = true;
    return { manifest, handle };
  } catch (error) {
    await handle.close().catch(() => undefined);
    const removal = manifest.complete
      ? await removeOwnedFile(path, identity, content.length, sha256)
      : await removeOwnedFilePrefix(path, identity, content);
    if (!removal.removed) {
      throw new LocalFileError("Unvollstaendiges Archivmanifest blieb zur manuellen Klaerung erhalten.", "postcondition-failed");
    }
    throw error;
  }
}

async function preserveRecoveryCopy(
  file: BoundCase,
  directory: string,
  directoryIdentity: BigIntStats | undefined,
): Promise<string | undefined> {
  if (!directoryIdentity || !(await directoryStillOwned(directory, directoryIdentity))) return undefined;
  const stem = `.sse-recovery-${file.expectedSha256.slice(0, 16)}-${file.actualName}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const path = join(directory, `${stem}${attempt === 0 ? "" : `.${attempt}`}.bin`);
    try {
      const copy = await copyOpenFileToArchive(
        file.handle,
        path,
        file.expectedSha256,
        file.bytes,
        undefined,
        file.identity,
      );
      await copy.handle.close();
      return path;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return undefined;
    }
  }
  return undefined;
}

export async function executeLocalArchive(options: LocalArchiveOptions): Promise<WorkerResult> {
  const effectiveTimeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const startedAt = performance.now();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; }, effectiveTimeoutMs);
  const stopped = (): WorkerResult | undefined => {
    if (options.signal?.aborted) return operationError("API-Client hat die Fallarchivierung abgebrochen.", "aborted");
    if (timedOut || performance.now() - startedAt >= effectiveTimeoutMs) {
      return operationError("Zeitbudget beim lokalen Archivieren der Steuerfaelle aufgebraucht.", "timeout");
    }
    return undefined;
  };
  const checkStopped = (): void => {
    const result = stopped();
    if (result) throw new LocalOperationStopped(result);
  };
  const remainingMs = (): number => Math.max(0, Math.floor(effectiveTimeoutMs - (performance.now() - startedAt)));
  const localResult = (result: WorkerResult): WorkerResult =>
    options.redactPaths(withResourceIdentity(result, options.resourceRefs));

  let directory = "";
  let destination = "";
  let directoryIdentity: BigIntStats | undefined;
  let destinationIdentity: BigIntStats | undefined;
  const createdDirectories: OwnedDirectory[] = [];
  const bound: BoundCase[] = [];
  const moved: MovedCase[] = [];
  let manifestHandle: OpenFile | undefined;
  let manifest: OwnedManifest | undefined;
  let archiveArguments: ArchiveArgument[] = [];
  let remainingArguments: ArchiveArgument[] = [];
  try {
    const directoryRaw = options.args.dir;
    const destinationRaw = options.args.dest;
    archiveArguments = asArchiveArguments(options.args.cases) ?? [];
    remainingArguments = asArchiveArguments(options.args.expectedRemaining) ?? [];
    if (
      typeof directoryRaw !== "string" || !directoryRaw || typeof destinationRaw !== "string" || !destinationRaw ||
      !archiveArguments.length || !remainingArguments.length
    ) {
      return localResult(operationError("dir, dest, cases und expectedRemaining sind Pflicht und duerfen nicht leer sein.", "bad-args"));
    }
    directory = resolve(directoryRaw);
    destination = resolve(destinationRaw);
    try {
      directoryIdentity = await stat(directory, { bigint: true });
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(errorCode(error))) {
        return localResult(operationError(`Fallordner fehlt: ${directory}`, "not-found"));
      }
      throw error;
    }
    if (!directoryIdentity.isDirectory()) {
      return localResult(operationError(`Fallordner fehlt: ${directory}`, "not-found"));
    }
    if (isInside(directory.toLowerCase(), destination.toLowerCase())) {
      return localResult(operationError("Archivziel muss ausserhalb des aktiven Fallordners liegen.", "bad-args"));
    }
    if (await pathExists(destination)) {
      return localResult(operationError(`Archivziel existiert bereits: ${destination}`, "precondition-failed"));
    }

    const allArguments = [...archiveArguments, ...remainingArguments];
    const seen = new Set<string>();
    for (const entry of allArguments) {
      const key = entry.name.toLowerCase();
      if (!entry.name || basename(entry.name) !== entry.name || !isProfileCaseFileName(entry.name, options.profile, true)) {
        return localResult(operationError(`Ungueltiger Fallname '${entry.name}'. Nur ein einfacher Falldateiname ist erlaubt.`, "bad-args"));
      }
      if (!/^[0-9A-F]{64}$/u.test(entry.expectedSha256)) {
        return localResult(operationError(`Ungueltiger SHA256 fuer '${entry.name}'.`, "bad-args"));
      }
      if (seen.has(key)) {
        return localResult(operationError(`Fall '${entry.name}' ist mehrfach in der Bestandsvorgabe enthalten.`, "bad-args"));
      }
      seen.add(key);
    }
    checkStopped();
    const processIsRunning = options.hasRunningSseProcess ?? hasRunningSseProcess;
    if (await processIsRunning()) {
      return localResult(operationError(
        "SteuerSparErklaerung laeuft. Vor der Fallarchivierung alle SSE-Fenster kontrolliert schliessen.",
        "precondition-failed",
      ));
    }
    const inventory = await caseInventory(directory, options.profile);
    if (inventory.collision) {
      return localResult(operationError("Aktiver Fallbestand enthaelt eine nicht eindeutig aufloesbare Namenskollision.", "inventory-mismatch"));
    }
    const actualNames = inventory.names.map((name) => name.toLowerCase()).sort();
    const expectedNames = allArguments.map((entry) => entry.name.toLowerCase()).sort();
    if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) {
      return localResult({
        ok: false,
        kind: "inventory-mismatch",
        error: "Aktiver Fallbestand stimmt nicht exakt mit cases + expectedRemaining ueberein; NICHTS verschoben.",
        expected: expectedNames,
        actual: actualNames,
        differences: [
          ...expectedNames.filter((name) => !actualNames.includes(name)).map((InputObject) => ({ InputObject, SideIndicator: "<=" })),
          ...actualNames.filter((name) => !expectedNames.includes(name)).map((InputObject) => ({ InputObject, SideIndicator: "=>" })),
        ],
      });
    }

    for (const entry of allArguments) {
      checkStopped();
      const actualName = inventory.byLowerName.get(entry.name.toLowerCase());
      if (!actualName) throw new LocalFileError(`Fall '${entry.name}' fehlt waehrend der Archivvorbereitung.`, "resource-changed");
      const file = await bindCase(
        join(directory, actualName), entry, actualName, options.profile, remainingMs, options.signal,
      );
      bound.push(file);
      if (archiveArguments.includes(entry) && file.transmitted !== false) {
        throw new LocalFileError(
          `GESPERRT: '${entry.name}' ist uebermittelt oder der Status ist nicht sicher false.`,
          "blocked",
        );
      }
    }
    checkStopped();
    destinationIdentity = await createOwnedDirectoryChain({
      destination,
      sourceDirectory: directory,
      created: createdDirectories,
      destinationLabel: "Archivziel",
      insideSourceMessage: "Archivziel folgt einem Link oder einer Junction in den aktiven Fallordner.",
    });
    const archiveFiles = bound.slice(0, archiveArguments.length);
    const manifestResult = await writeVerifiedManifest(
      destination,
      archiveFiles.map((entry) => ({ file: entry.actualName, sha256: entry.expectedSha256 })),
      options.writeManifest,
    );
    manifest = manifestResult.manifest;
    manifestHandle = manifestResult.handle;
    await manifestHandle.close();
    manifestHandle = undefined;
    for (const file of archiveFiles) {
      checkStopped();
      if (!destinationIdentity || !(await directoryHasExactEntries(
        destination,
        destinationIdentity,
        ["pruefsummen.csv", ...moved.map((entry) => entry.actualName)],
      ))) {
        throw new LocalFileError("Archivziel wurde waehrend des Laufs veraendert.", "postcondition-failed");
      }
      if (!(await sourcePathStillBound(file))) {
        throw new LocalFileError(`Fall '${file.actualName}' wurde vor dem Verschieben veraendert.`, "postcondition-failed");
      }
      const target = join(destination, file.actualName);
      const copied = await copyOpenFileToArchive(
        file.handle, target, file.expectedSha256, file.bytes, options.signal, file.identity,
      );
      if (!(await sourcePathStillBound(file))) {
        await copied.handle.close();
        await removeOwnedFile(target, copied.identity, file.bytes, file.expectedSha256);
        throw new LocalFileError(`Fall '${file.actualName}' wurde vor dem Entfernen veraendert.`, "postcondition-failed");
      }
      if (await processIsRunning()) {
        await copied.handle.close();
        await removeOwnedFile(target, copied.identity, file.bytes, file.expectedSha256);
        throw new LocalFileError(
          "SteuerSparErklaerung wurde waehrend der Archivvorbereitung gestartet; NICHTS weiter verschoben.",
          "precondition-failed",
        );
      }
      try {
        await (options.removeSource ?? unlink)(file.source);
      } catch (error) {
        await copied.handle.close();
        const removed = await removeOwnedFile(target, copied.identity, file.bytes, file.expectedSha256);
        if (!removed.removed) {
          throw new LocalFileError(
            `Quellfall '${file.actualName}' konnte nicht entfernt werden; verifiziertes Archivziel blieb erhalten.`,
            "postcondition-failed",
          );
        }
        throw error;
      }
      const movedFile: MovedCase = { ...file, target, targetIdentity: copied.identity };
      moved.push(movedFile);
      await copied.handle.close();
      const sourceStillVisible = await pathExists(file.source).catch((error) => {
        if (["EACCES", "EPERM"].includes(errorCode(error))) return true;
        throw error;
      });
      if (sourceStillVisible) {
        throw new LocalFileError(
          `Dateisystem entfernte Quellfall '${file.actualName}' nicht sicher bei offenem Handle; ` +
          "verifiziertes Archivziel bleibt als Wiederherstellungspunkt erhalten.",
          "postcondition-failed",
        );
      }
      await options.afterFileMoved?.({ source: file.source, target, sha256: file.expectedSha256 });
    }

    checkStopped();
    const remainingFiles = bound.slice(archiveArguments.length);
    const remainingInventory = await caseInventory(directory, options.profile);
    const remainingActual = remainingInventory.names.map((name) => name.toLowerCase()).sort();
    const remainingExpected = remainingArguments.map((entry) => entry.name.toLowerCase()).sort();
    if (
      remainingInventory.collision || remainingActual.length !== remainingExpected.length ||
      remainingActual.some((name, index) => name !== remainingExpected[index]) ||
      !directoryIdentity || !(await directoryStillOwned(directory, directoryIdentity))
    ) {
      throw new LocalFileError("Restbestand stimmt nach der Archivierung nicht mit expectedRemaining ueberein.", "postcondition-failed");
    }
    for (const file of remainingFiles) {
      if (!(await sourcePathStillBound(file))) {
        throw new LocalFileError(`Resthash stimmt fuer '${file.actualName}' nicht.`, "postcondition-failed");
      }
    }
    if (!destinationIdentity || !(await directoryHasExactEntries(
      destination,
      destinationIdentity,
      ["pruefsummen.csv", ...moved.map((entry) => entry.actualName)],
    ))) {
      throw new LocalFileError("Archivziel wurde vor der Endfreigabe veraendert.", "postcondition-failed");
    }
    for (const file of moved) {
      if (!(await filePathMatchesIdentityAndHash(file.target, file.targetIdentity, file.expectedSha256))) {
        throw new LocalFileError(`Archivhash stimmt fuer '${file.actualName}' nicht.`, "postcondition-failed");
      }
    }
    await Promise.all(bound.map((file) => file.handle.close().catch(() => undefined)));
    return localResult({
      ok: true,
      archived: moved.length,
      dest: destination,
      files: moved.map((entry) => ({ name: entry.actualName, sha256: entry.expectedSha256 })),
      remaining: remainingArguments.map((entry) => ({ name: entry.name, sha256: entry.expectedSha256 })),
      manifest: join(destination, "pruefsummen.csv"),
      verified: true,
      recoverable: true,
    });
  } catch (error) {
    const classified = error instanceof LocalOperationStopped
      ? error.result
      : error instanceof LocalFileError
        ? operationError(error.message, error.kind)
        : stopped();
    await manifestHandle?.close().catch(() => undefined);
    manifestHandle = undefined;
    const rollbackFiles: Array<Record<string, unknown>> = [];
    const retainedTargets: string[] = [];
    const recoveryFiles: string[] = [];
    for (const file of [...moved].reverse()) {
      let restoreError: string | undefined;
      let restored = false;
      try {
        if (!(await pathExists(file.source)) && await hashOpenFile(file.handle) === file.expectedSha256) {
          const restoredCopy = await copyOpenFileToArchive(
            file.handle, file.source, file.expectedSha256, file.bytes, undefined, file.identity,
          );
          await restoredCopy.handle.close();
          restored = true;
        }
      } catch (restoreFailure) {
        restoreError = restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure);
      }
      const targetStillOriginal = await filePathMatchesIdentityAndHash(
        file.target,
        file.targetIdentity,
        file.expectedSha256,
      );
      let recoveryPath: string | undefined;
      if (!restored && !targetStillOriginal) {
        recoveryPath = await preserveRecoveryCopy(file, directory, directoryIdentity);
        if (recoveryPath) recoveryFiles.push(recoveryPath);
      }
      const targetRemoval = restored
        ? await removeOwnedFile(
            file.target, file.targetIdentity, file.bytes, file.expectedSha256,
          ).catch(() => ({ stillOwned: false, removed: false }))
        : { stillOwned: false, removed: false };
      if (!targetRemoval.removed && await pathExists(file.target).catch(() => true)) retainedTargets.push(file.target);
      const sourceHash = restored
        ? await hashFilePath(file.source).catch(() => undefined)
        : undefined;
      rollbackFiles.push({
        name: file.actualName,
        restored: restored && sourceHash === file.expectedSha256,
        recoverable: restored || targetStillOriginal || Boolean(recoveryPath),
        sourceHash,
        targetExists: await pathExists(file.target).catch(() => true),
        ...(recoveryPath ? { recoveryPath } : {}),
        ...(restoreError ? { error: restoreError } : {}),
      });
    }
    if (manifest) {
      const removal = manifest.complete
        ? await removeOwnedFile(manifest.path, manifest.identity, manifest.bytes, manifest.sha256)
        : await removeOwnedFilePrefix(manifest.path, manifest.identity, manifest.content);
      if (!removal.removed && await pathExists(manifest.path).catch(() => true)) retainedTargets.push(manifest.path);
    }
    const destinationDirectory = createdDirectories.find((entry) => entry.path === destination);
    if (destinationDirectory?.identity && await directoryStillOwned(destination, destinationDirectory.identity)) {
      for (const name of await readdir(destination).catch(() => [])) {
        const path = join(destination, name);
        if (!retainedTargets.includes(path)) retainedTargets.push(path);
      }
    }
    for (const entry of [...createdDirectories].reverse()) {
      const retainedDescendant = retainedTargets.some((path) => isInside(entry.path, path));
      const removed = entry.identity && !retainedDescendant
        ? await removeOwnedEmptyDirectory(entry.path, entry.identity)
        : false;
      if (!removed && await pathExists(entry.path).catch(() => true) && !retainedDescendant) retainedTargets.push(entry.path);
    }
    await Promise.all(bound.map((file) => file.handle.close().catch(() => undefined)));
    const allSourcesRestored = rollbackFiles.length === moved.length && rollbackFiles.every((entry) => entry.restored === true);
    const recoverable = rollbackFiles.every((entry) => entry.recoverable === true);
    const rolledBack = allSourcesRestored && retainedTargets.length === 0 &&
      (await Promise.all(createdDirectories.map(async (entry) => !(await pathExists(entry.path).catch(() => true))))).every(Boolean);
    const baseMessage = classified?.error ?? (error instanceof Error ? error.message : String(error));
    return localResult({
      ok: false,
      kind: classified?.kind ?? (createdDirectories.length ? "postcondition-failed" : "worker"),
      error: retainedTargets.length
        ? `${baseMessage} Unbekannte oder veraenderte Archivziele blieben zur manuellen Klaerung erhalten.`
        : baseMessage,
      movedBeforeFailure: moved.length,
      rolledBack,
      rollbackFiles,
      recoveryFiles,
      recoverable,
      retainedTargets,
      archiveStillExists: destination ? await pathExists(destination).catch(() => true) : false,
      ...(destination ? { dest: destination } : {}),
    });
  } finally {
    clearTimeout(timer);
    await manifestHandle?.close().catch(() => undefined);
    await Promise.all(bound.map((file) => file.handle.close().catch(() => undefined)));
  }
}
