import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
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
  sameNames,
  withResourceIdentity,
} from "./local-file-transaction.js";
import { removeOwnedFile, removeOwnedFilePrefix, type OwnedFileRemoval } from "./owned-file.js";
import type { ProductProfile } from "./product-profiles.js";
import { executeLocalWorkingCopy } from "./working-copy-executor.js";

type OpenFile = Awaited<ReturnType<typeof open>>;

export interface LocalBackupOptions {
  args: Record<string, unknown>;
  resourceRefs: Record<string, string>;
  profile: ProductProfile;
  timeoutMs: number | undefined;
  signal?: AbortSignal;
  redactPaths: <T>(value: T) => T;
  /** Interne Testnaht nach einer vollstaendig verifizierten Einzelkopie. */
  afterFileCopied?: (file: { source: string; target: string; sha256: string }) => void | Promise<void>;
  /** Interne Testnaht fuer einen partiellen Manifest-Schreibfehler. */
  writeManifest?: (handle: OpenFile, content: Buffer) => Promise<void>;
  /** Interne Testnaht nach dem synchronisierten Manifest vor der Endfreigabe. */
  afterManifestWritten?: (paths: { destination: string; manifest: string }) => void | Promise<void>;
}

interface CopiedFile {
  name: string;
  path: string;
  sha256: string;
  bytes: number;
  identity: BigIntStats;
}

interface OwnedManifest {
  path: string;
  sha256: string;
  bytes: number;
  identity: BigIntStats;
  content: Buffer;
  complete: boolean;
}

async function sourceInventoryStillStable(
  path: string,
  identity: BigIntStats,
  expectedNames: readonly string[],
  profile: ProductProfile,
): Promise<boolean> {
  if (!(await directoryStillOwned(path, identity))) return false;
  const currentNames = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isProfileCaseFileName(entry.name, profile, true))
    .map((entry) => entry.name);
  return sameNames(currentNames, expectedNames);
}

async function assertVerifiedTargetStillOwned(
  file: CopiedFile,
  profile: ProductProfile,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const before = await stat(file.path, { bigint: true });
  if (!sameFileIdentity(file.identity, before)) {
    throw new LocalFileError(`Sicherungskopie fuer '${file.name}' wurde ersetzt.`, "postcondition-failed");
  }
  const info = await readCaseFileInfo(file.path, profile, {
    timeoutMs,
    ...(signal ? { signal } : {}),
  });
  const after = await stat(file.path, { bigint: true });
  if (info.sha256 !== file.sha256 || !sameFileState(before, after)) {
    throw new LocalFileError(`Sicherungskopie fuer '${file.name}' ist nicht mehr bytegleich.`, "postcondition-failed");
  }
}

export async function executeLocalBackup(options: LocalBackupOptions): Promise<WorkerResult> {
  const effectiveTimeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const startedAt = performance.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, effectiveTimeoutMs);
  const stopped = (): WorkerResult | undefined => {
    if (options.signal?.aborted) return operationError("API-Client hat die Fallsicherung abgebrochen.", "aborted");
    if (timedOut || performance.now() - startedAt >= effectiveTimeoutMs) {
      return operationError("Zeitbudget beim lokalen Sichern der Steuerfaelle aufgebraucht.", "timeout");
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

  let destination = "";
  let destinationIdentity: BigIntStats | undefined;
  const createdDirectories: OwnedDirectory[] = [];
  let manifestHandle: OpenFile | undefined;
  let manifest: OwnedManifest | undefined;
  const copied: CopiedFile[] = [];
  try {
    const directoryRaw = options.args.dir;
    const destinationRaw = options.args.dest;
    if (typeof directoryRaw !== "string" || !directoryRaw || typeof destinationRaw !== "string" || !destinationRaw) {
      return localResult(operationError("dir und dest sind Pflicht.", "bad-args"));
    }
    const directory = resolve(directoryRaw);
    destination = resolve(destinationRaw);
    let directoryState: BigIntStats;
    try {
      directoryState = await stat(directory, { bigint: true });
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(errorCode(error))) {
        return localResult(operationError(`Fallordner fehlt: ${directory}`, "not-found"));
      }
      throw error;
    }
    if (!directoryState.isDirectory()) {
      return localResult(operationError(`Fallordner fehlt: ${directory}`, "not-found"));
    }
    if (isInside(directory, destination)) {
      return localResult(operationError(
        "Sicherungsziel darf nicht im Fallordner liegen; sonst kopiert sich die Sicherung rekursiv selbst.",
        "bad-args",
      ));
    }
    if (await pathExists(destination)) {
      return localResult(operationError(`Sicherungsziel existiert bereits: ${destination}`, "precondition-failed"));
    }
    const entries = await readdir(directory, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile() && isProfileCaseFileName(entry.name, options.profile, true))
      .map((entry) => entry.name);
    if (!names.length) {
      return localResult(operationError(`Keine Falldateien in ${directory} gefunden.`, "not-found"));
    }
    if (!(await sourceInventoryStillStable(directory, directoryState, names, options.profile))) {
      return localResult(operationError(
        "Fallordner wurde waehrend der Sicherungsvorbereitung veraendert.",
        "resource-changed",
      ));
    }
    checkStopped();
    destinationIdentity = await createOwnedDirectoryChain({
      destination,
      sourceDirectory: directory,
      created: createdDirectories,
      destinationLabel: "Sicherungsziel",
      insideSourceMessage: "Sicherungsziel folgt einem Link oder einer Junction in den Fallordner.",
    });

    for (const name of names) {
      checkStopped();
      if (
        !destinationIdentity ||
        !(await directoryHasExactEntries(destination, destinationIdentity, copied.map((file) => file.name)))
      ) {
        throw new LocalFileError("Sicherungsziel wurde waehrend des Laufs veraendert.", "postcondition-failed");
      }
      if (!(await sourceInventoryStillStable(directory, directoryState, names, options.profile))) {
        throw new LocalFileError("Fallbestand wurde waehrend der Sicherung veraendert.", "postcondition-failed");
      }
      const source = join(directory, name);
      const target = join(destination, name);
      const sourceInfo = await readCaseFileInfo(source, options.profile, {
        timeoutMs: remainingMs(),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      let targetIdentity: BigIntStats | undefined;
      const copy = await executeLocalWorkingCopy({
        args: { source, target, expectedSourceHash: sourceInfo.sha256 },
        resourceRefs: {},
        profile: options.profile,
        timeoutMs: remainingMs(),
        ...(options.signal ? { signal: options.signal } : {}),
        redactPaths: <T>(value: T): T => value,
        afterVerifiedTarget: (identity) => {
          targetIdentity = identity;
        },
      });
      if (!copy.ok || !targetIdentity) {
        throw new LocalFileError(
          copy.error ?? `Sicherungskopie fuer '${name}' ist nicht bytegleich.`,
          copy.kind ?? "postcondition-failed",
        );
      }
      if (targetIdentity.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new LocalFileError(`Sicherungskopie fuer '${name}' ist zu gross.`, "postcondition-failed");
      }
      const record: CopiedFile = {
        name,
        path: target,
        sha256: sourceInfo.sha256,
        bytes: Number(targetIdentity.size),
        identity: targetIdentity,
      };
      copied.push(record);
      await options.afterFileCopied?.({ source, target, sha256: record.sha256 });
    }

    for (const file of copied) {
      checkStopped();
      await assertVerifiedTargetStillOwned(file, options.profile, remainingMs(), options.signal);
    }
    if (!(await sourceInventoryStillStable(directory, directoryState, names, options.profile))) {
      throw new LocalFileError("Fallbestand wurde waehrend der Sicherung veraendert.", "postcondition-failed");
    }
    if (
      !destinationIdentity ||
      !(await directoryHasExactEntries(destination, destinationIdentity, copied.map((file) => file.name)))
    ) {
      throw new LocalFileError("Sicherungsziel wurde vor dem Manifest veraendert.", "postcondition-failed");
    }

    const hashes = copied.map((entry) => ({ file: entry.name, sha256: entry.sha256 }));
    const manifestPath = join(destination, "pruefsummen.csv");
    const manifestBytes = csvManifest(hashes);
    const manifestHash = createHash("sha256").update(manifestBytes).digest("hex").toUpperCase();
    manifestHandle = await open(manifestPath, "wx+");
    const manifestIdentity = await manifestHandle.stat({ bigint: true });
    manifest = {
      path: manifestPath,
      sha256: manifestHash,
      bytes: manifestBytes.length,
      identity: manifestIdentity,
      content: manifestBytes,
      complete: false,
    };
    await (options.writeManifest ?? ((handle, content) => handle.writeFile(content)))(manifestHandle, manifestBytes);
    await manifestHandle.sync();
    const manifestContentMatches = await handleContainsExactBytes(manifestHandle, manifestBytes);
    const manifestHandleAfter = await manifestHandle.stat({ bigint: true });
    const manifestPathAfter = await stat(manifestPath, { bigint: true });
    if (
      !sameFileIdentity(manifestIdentity, manifestHandleAfter) ||
      !sameFileState(manifestHandleAfter, manifestPathAfter) ||
      manifestHandleAfter.size !== BigInt(manifestBytes.length) ||
      !manifestContentMatches
    ) {
      throw new LocalFileError("Pruefsummenmanifest wurde waehrend des Schreibens ersetzt.", "postcondition-failed");
    }
    manifest.complete = true;
    await manifestHandle.close();
    manifestHandle = undefined;
    checkStopped();
    await options.afterManifestWritten?.({ destination, manifest: manifestPath });
    checkStopped();
    if (!(await sourceInventoryStillStable(directory, directoryState, names, options.profile))) {
      throw new LocalFileError("Fallbestand wurde nach dem Manifest veraendert.", "postcondition-failed");
    }
    if (
      !destinationIdentity ||
      !(await directoryHasExactEntries(
        destination,
        destinationIdentity,
        [...copied.map((file) => file.name), "pruefsummen.csv"],
      ))
    ) {
      throw new LocalFileError("Sicherungsziel wurde nach dem Manifest veraendert.", "postcondition-failed");
    }

    return localResult({
      ok: true,
      dest: destination,
      anzahl: hashes.length,
      files: hashes.map((entry) => ({ name: entry.file, sha256: entry.sha256 })),
      hashes,
      manifest: manifestPath,
      verified: true,
    });
  } catch (error) {
    const classifiedFailure = error instanceof LocalOperationStopped
      ? error.result
      : error instanceof LocalFileError
        ? operationError(error.message, error.kind)
        : stopped();
    await manifestHandle?.close().catch(() => undefined);
    manifestHandle = undefined;
    const removals: Array<{ path: string; ownership: OwnedFileRemoval }> = [];
    if (manifest) {
      removals.push({
        path: manifest.path,
        ownership: manifest.complete
          ? await removeOwnedFile(manifest.path, manifest.identity, manifest.bytes, manifest.sha256)
          : await removeOwnedFilePrefix(manifest.path, manifest.identity, manifest.content),
      });
    } else if (destination && await pathExists(join(destination, "pruefsummen.csv")).catch(() => false)) {
      removals.push({ path: join(destination, "pruefsummen.csv"), ownership: { stillOwned: false, removed: false } });
    }
    for (const file of [...copied].reverse()) {
      removals.push({
        path: file.path,
        ownership: await removeOwnedFile(file.path, file.identity, file.bytes, file.sha256),
      });
    }
    const retainedTargets = removals.filter((entry) => !entry.ownership.removed).map((entry) => entry.path);
    const destinationDirectory = createdDirectories.find((entry) => entry.path === destination);
    if (destinationDirectory) {
      if (destinationDirectory.identity && await directoryStillOwned(destination, destinationDirectory.identity)) {
        try {
          for (const name of await readdir(destination)) {
            const path = join(destination, name);
            if (!retainedTargets.includes(path)) retainedTargets.push(path);
          }
        } catch {
          if (!retainedTargets.includes(destination)) retainedTargets.push(destination);
        }
      } else if (!retainedTargets.includes(destination)) {
        retainedTargets.push(destination);
      }
    }
    for (const directory of [...createdDirectories].reverse()) {
      const retainedDescendant = retainedTargets.some((path) => isInside(directory.path, path));
      const removed = directory.identity && !retainedDescendant
        ? await removeOwnedEmptyDirectory(directory.path, directory.identity)
        : false;
      if (!removed && await pathExists(directory.path).catch(() => true) && !retainedDescendant) {
        retainedTargets.push(directory.path);
      }
    }
    const rolledBack = createdDirectories.length
      ? (await Promise.all(createdDirectories.map(async (entry) =>
          !(await pathExists(entry.path).catch(() => true))))).every(Boolean)
      : true;
    const backupStillExists = destination ? await pathExists(destination).catch(() => true) : false;
    const kind = classifiedFailure?.kind ?? (createdDirectories.length ? "postcondition-failed" : "worker");
    const message = classifiedFailure?.error ?? (error instanceof Error ? error.message : String(error));
    return localResult({
      ok: false,
      kind,
      error: retainedTargets.length
        ? `${message} Unbekannte oder veraenderte Sicherungsziele blieben zur manuellen Klaerung erhalten.`
        : message,
      copiedBeforeFailure: copied.length,
      rolledBack,
      retainedTargets,
      backupStillExists,
      ...(destination ? { dest: destination } : {}),
    });
  } finally {
    clearTimeout(timer);
    await manifestHandle?.close().catch(() => undefined);
  }
}
