import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { executeLocalArchive } from "../dist/archive-executor.js";
import { isProfileCaseFileName } from "../dist/case-file.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { directWorker } from "./direct-worker-helpers.mjs";

const uint32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};
const record = (name, type, value) => {
  const nameBytes = Buffer.from(`${name}\0`, "ascii");
  return Buffer.concat([uint32(nameBytes.length), nameBytes, Buffer.from([type]), uint32(value.length), value]);
};
const textRecord = (name, value) => record(name, 4, Buffer.from(`${value}\0`, "utf8"));
const akadCase = (marker, transferTime = "") => {
  const uuid = Buffer.from("12345678-1234-1234-1234-123456789abc\0", "ascii");
  return Buffer.concat([
    Buffer.from("AKAD", "ascii"),
    Buffer.alloc(8),
    uint32(uuid.length),
    uuid,
    Buffer.from("FIIF", "ascii"),
    Buffer.from([0xaa, 0xbb, 0xcc]),
    textRecord("FileType", "Gew"),
    textRecord("VJahr", "2025"),
    textRecord("Steuernummer", marker),
    textRecord("ElsterTransferTime", transferTime),
    record("svCrypted", 12, Buffer.from([1, 2, 3, 4, marker.length])),
  ]);
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const FIXTURE_TIME = new Date("2025-01-02T03:04:05.000Z");
const writeInventory = (directory, { oldTransferTime = "" } = {}) => {
  mkdirSync(directory, { recursive: true });
  const names = ["alt.Gew2025", "aktuell.Gew2025", "aktuell.Gew2025_Backup"];
  for (const name of names) {
    writeFileSync(join(directory, name), akadCase(name, name === names[0] ? oldTransferTime : ""));
    utimesSync(join(directory, name), FIXTURE_TIME, FIXTURE_TIME);
  }
  return {
    cases: [{ name: names[0], expectedSha256: sha256(join(directory, names[0])) }],
    expectedRemaining: names.slice(1).map((name) => ({ name, expectedSha256: sha256(join(directory, name)) })),
  };
};
const normalize = ({ ms: _ms, resourceRefs: _refs, ...result }) => ({
  ...result,
  dest: result.dest ? "archive" : result.dest,
  manifest: result.manifest ? "manifest" : result.manifest,
});

const temporary = mkdtempSync(join(tmpdir(), "sse-archive-local-parity-"));
try {
  const directCases = join(temporary, "direct-cases");
  const localCases = join(temporary, "local-cases");
  const directArgs = writeInventory(directCases);
  const localArgs = writeInventory(localCases);
  const directDestination = join(temporary, "direct-archive");
  const localDestination = join(temporary, "local-archive");
  const expected = directWorker("archive_cases", { dir: directCases, dest: directDestination, ...directArgs });
  assert.equal(expected.ok, true, JSON.stringify(expected));

  const actual = await executeLocalArchive({
    args: { dir: localCases, dest: localDestination, ...localArgs },
    resourceRefs: {},
    profile: loadProductProfile("2025"),
    timeoutMs: 30_000,
    redactPaths: (value) => value,
    hasRunningSseProcess: async () => false,
  });
  assert.deepEqual(normalize(actual), normalize(expected), "Lokaler Archiverfolg driftet vom Worker-Vertrag.");
  assert.deepEqual(
    readFileSync(join(localDestination, "pruefsummen.csv")),
    readFileSync(join(directDestination, "pruefsummen.csv")),
    "Lokales Archivmanifest driftet byteweise vom Worker.",
  );
  assert.equal(existsSync(join(localCases, "alt.Gew2025")), false);
  assert.equal(sha256(join(localDestination, "alt.Gew2025")), localArgs.cases[0].expectedSha256);
  assert.equal(statSync(join(localDestination, "alt.Gew2025")).mtimeMs, FIXTURE_TIME.getTime(),
    "Lokale Archivkopie bewahrte den Quell-Aenderungszeitpunkt nicht.");
  assert.equal(sha256(join(localCases, "aktuell.Gew2025_Backup")), localArgs.expectedRemaining[1].expectedSha256);

  const assertFailureParity = async (label, options = {}) => {
    const directDirectory = join(temporary, `${label}-direct-cases`);
    const localDirectory = join(temporary, `${label}-local-cases`);
    const directBase = writeInventory(directDirectory, options.inventoryOptions);
    const localBase = writeInventory(localDirectory, options.inventoryOptions);
    const directFailureArgs = options.mutateArgs
      ? options.mutateArgs(structuredClone(directBase))
      : directBase;
    const localFailureArgs = options.mutateArgs
      ? options.mutateArgs(structuredClone(localBase))
      : localBase;
    options.mutateInventory?.(directDirectory);
    options.mutateInventory?.(localDirectory);
    const directFailureDestination = join(temporary, `${label}-direct-archive`);
    const localFailureDestination = join(temporary, `${label}-local-archive`);
    const expectedFailure = directWorker("archive_cases", {
      dir: directDirectory, dest: directFailureDestination, ...directFailureArgs,
    });
    const actualFailure = await executeLocalArchive({
      args: { dir: localDirectory, dest: localFailureDestination, ...localFailureArgs },
      resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 30_000,
      redactPaths: (value) => value, hasRunningSseProcess: async () => false,
    });
    assert.deepEqual(
      { ok: actualFailure.ok, kind: actualFailure.kind },
      { ok: expectedFailure.ok, kind: expectedFailure.kind },
      `${label}: Preflight-Fehlerart driftet vom Worker.`,
    );
    assert.equal(sha256(join(localDirectory, "alt.Gew2025")), sha256(join(directDirectory, "alt.Gew2025")),
      `${label}: Preflight veraenderte den Quellfall.`);
    assert.equal(existsSync(localFailureDestination), false, `${label}: Preflight legte ein Archivziel an.`);
  };
  await assertFailureParity("wrong-hash", {
    mutateArgs: (args) => ({ ...args, cases: [{ ...args.cases[0], expectedSha256: "0".repeat(64) }] }),
  });
  await assertFailureParity("invalid-name", {
    mutateArgs: (args) => ({ ...args, cases: [{ ...args.cases[0], name: "..\\alt.Gew2025" }] }),
  });
  await assertFailureParity("extra-inventory", {
    mutateInventory: (directory) => writeFileSync(join(directory, "unerwartet.Gew2025"), akadCase("unerwartet")),
  });
  await assertFailureParity("transmitted", {
    inventoryOptions: { oldTransferTime: "2025-05-01 12:30" },
  });

  const rollbackCases = join(temporary, "rollback-cases");
  const rollbackArgs = writeInventory(rollbackCases);
  const rollbackDestination = join(temporary, "rollback", "nested", "archive");
  const rolledBack = await executeLocalArchive({
    args: { dir: rollbackCases, dest: rollbackDestination, ...rollbackArgs },
    resourceRefs: {},
    profile: loadProductProfile("2025"),
    timeoutMs: 30_000,
    redactPaths: (value) => value,
    hasRunningSseProcess: async () => false,
    afterFileMoved: () => {
      throw new Error("synthetischer Fehler nach erster Bewegung");
    },
  });
  assert.equal(rolledBack.ok, false);
  assert.equal(rolledBack.kind, "postcondition-failed");
  assert.equal(rolledBack.rolledBack, true, JSON.stringify(rolledBack));
  assert.equal(existsSync(join(temporary, "rollback")), false, "Eigene verschachtelte Zielkette blieb liegen.");
  assert.equal(sha256(join(rollbackCases, "alt.Gew2025")), rollbackArgs.cases[0].expectedSha256);

  const changedCases = join(temporary, "changed-cases");
  const changedArgs = writeInventory(changedCases);
  const changedDestination = join(temporary, "changed-archive");
  const changed = await executeLocalArchive({
    args: { dir: changedCases, dest: changedDestination, ...changedArgs },
    resourceRefs: {},
    profile: loadProductProfile("2025"),
    timeoutMs: 30_000,
    redactPaths: (value) => value,
    hasRunningSseProcess: async () => false,
    afterFileMoved: ({ target }) => {
      writeFileSync(target, "fremder Archivinhalt", "utf8");
      throw new Error("synthetische Zielinterferenz");
    },
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.rolledBack, false);
  assert.equal(sha256(join(changedCases, "alt.Gew2025")), changedArgs.cases[0].expectedSha256,
    "Originalbytes wurden bei Zielinterferenz nicht in den Fallordner zurueckgeschrieben.");
  assert.equal(readFileSync(join(changedDestination, "alt.Gew2025"), "utf8"), "fremder Archivinhalt",
    "Fremd veraendertes Archivziel wurde geloescht oder ueberschrieben.");
  assert(changed.retainedTargets.includes(join(changedDestination, "alt.Gew2025")));

  const occupiedCases = join(temporary, "occupied-cases");
  const occupiedArgs = writeInventory(occupiedCases);
  const occupiedDestination = join(temporary, "occupied-archive");
  const occupied = await executeLocalArchive({
    args: { dir: occupiedCases, dest: occupiedDestination, ...occupiedArgs },
    resourceRefs: {},
    profile: loadProductProfile("2025"),
    timeoutMs: 30_000,
    redactPaths: (value) => value,
    hasRunningSseProcess: async () => false,
    afterFileMoved: ({ source }) => {
      writeFileSync(source, "fremder neuer Quellfall", "utf8");
      throw new Error("synthetischer Quellkonflikt");
    },
  });
  assert.equal(occupied.ok, false);
  assert.equal(occupied.rolledBack, false);
  assert.equal(readFileSync(join(occupiedCases, "alt.Gew2025"), "utf8"), "fremder neuer Quellfall",
    "Fremder Quellpfad wurde beim Rollback ueberschrieben.");
  assert.equal(sha256(join(occupiedDestination, "alt.Gew2025")), occupiedArgs.cases[0].expectedSha256,
    "Einzig intakte Originalkopie wurde trotz blockierter Wiederherstellung entfernt.");
  assert(occupied.retainedTargets.includes(join(occupiedDestination, "alt.Gew2025")));

  const doubleConflictCases = join(temporary, "double-conflict-cases");
  const doubleConflictArgs = writeInventory(doubleConflictCases);
  const doubleConflictDestination = join(temporary, "double-conflict-archive");
  const doubleConflict = await executeLocalArchive({
    args: { dir: doubleConflictCases, dest: doubleConflictDestination, ...doubleConflictArgs },
    resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 30_000,
    redactPaths: (value) => value, hasRunningSseProcess: async () => false,
    afterFileMoved: ({ source, target }) => {
      writeFileSync(source, "fremder neuer Quellfall", "utf8");
      writeFileSync(target, "fremder neuer Archivfall", "utf8");
      throw new Error("synthetischer Doppelkonflikt");
    },
  });
  assert.equal(doubleConflict.ok, false);
  assert.equal(doubleConflict.rolledBack, false);
  assert.equal(doubleConflict.recoverable, true, JSON.stringify(doubleConflict));
  assert.equal(readFileSync(join(doubleConflictCases, "alt.Gew2025"), "utf8"), "fremder neuer Quellfall");
  assert.equal(readFileSync(join(doubleConflictDestination, "alt.Gew2025"), "utf8"), "fremder neuer Archivfall");
  assert.equal(doubleConflict.recoveryFiles.length, 1, JSON.stringify(doubleConflict));
  assert.equal(
    isProfileCaseFileName(doubleConflict.recoveryFiles[0], loadProductProfile("2025"), true),
    false,
    "Recovery-Datei darf niemals als aktiver Steuerfall erscheinen.",
  );
  assert.equal(sha256(doubleConflict.recoveryFiles[0]), doubleConflictArgs.cases[0].expectedSha256,
    "Originalbytes gingen bei gleichzeitigem Quell- und Zielkonflikt verloren.");

  const abortCases = join(temporary, "abort-cases");
  const abortArgs = writeInventory(abortCases);
  const abortDestination = join(temporary, "abort-archive");
  const abortController = new AbortController();
  const aborted = await executeLocalArchive({
    args: { dir: abortCases, dest: abortDestination, ...abortArgs },
    resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 30_000,
    signal: abortController.signal, redactPaths: (value) => value,
    hasRunningSseProcess: async () => false,
    afterFileMoved: () => abortController.abort(),
  });
  assert.equal(aborted.kind, "aborted", JSON.stringify(aborted));
  assert.equal(aborted.rolledBack, true);
  assert.equal(existsSync(abortDestination), false);
  assert.equal(sha256(join(abortCases, "alt.Gew2025")), abortArgs.cases[0].expectedSha256);

  const timeoutCases = join(temporary, "timeout-cases");
  const timeoutArgs = writeInventory(timeoutCases);
  const timeoutDestination = join(temporary, "timeout-archive");
  const timedOut = await executeLocalArchive({
    args: { dir: timeoutCases, dest: timeoutDestination, ...timeoutArgs },
    resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 100,
    redactPaths: (value) => value, hasRunningSseProcess: async () => false,
    afterFileMoved: async () => await new Promise((resolveDelay) => setTimeout(resolveDelay, 130)),
  });
  assert.equal(timedOut.kind, "timeout", JSON.stringify(timedOut));
  assert.equal(timedOut.rolledBack, true);
  assert.equal(existsSync(timeoutDestination), false);

  const guardCases = join(temporary, "guard-cases");
  const guardArgs = writeInventory(guardCases);
  const guardDestination = join(temporary, "guard-archive");
  let guardCalls = 0;
  const guardStopped = await executeLocalArchive({
    args: { dir: guardCases, dest: guardDestination, ...guardArgs },
    resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 30_000,
    redactPaths: (value) => value,
    hasRunningSseProcess: async () => ++guardCalls === 2,
  });
  assert.equal(guardStopped.kind, "precondition-failed");
  assert.equal(guardCalls, 2, "SSE-Prozessstatus muss direkt vor der ersten Mutation erneut geprueft werden.");
  assert.equal(guardStopped.rolledBack, true);
  assert.equal(existsSync(guardDestination), false);
  assert.equal(sha256(join(guardCases, "alt.Gew2025")), guardArgs.cases[0].expectedSha256);

  const nonPosixCases = join(temporary, "non-posix-cases");
  const nonPosixArgs = writeInventory(nonPosixCases);
  const nonPosixDestination = join(temporary, "non-posix-archive");
  const nonPosix = await executeLocalArchive({
    args: { dir: nonPosixCases, dest: nonPosixDestination, ...nonPosixArgs },
    resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 30_000,
    redactPaths: (value) => value, hasRunningSseProcess: async () => false,
    removeSource: async () => undefined,
  });
  assert.equal(nonPosix.kind, "postcondition-failed");
  assert.equal(nonPosix.recoverable, true);
  assert.equal(nonPosix.rolledBack, false);
  assert.match(nonPosix.error, /offenem Handle/);
  assert.equal(sha256(join(nonPosixCases, "alt.Gew2025")), nonPosixArgs.cases[0].expectedSha256);
  assert.equal(sha256(join(nonPosixDestination, "alt.Gew2025")), nonPosixArgs.cases[0].expectedSha256);
  assert(nonPosix.retainedTargets.includes(join(nonPosixDestination, "alt.Gew2025")));

  const manifestCases = join(temporary, "manifest-cases");
  const manifestArgs = writeInventory(manifestCases);
  const manifestDestination = join(temporary, "manifest-archive");
  const manifestFailure = await executeLocalArchive({
    args: { dir: manifestCases, dest: manifestDestination, ...manifestArgs },
    resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 30_000,
    redactPaths: (value) => value, hasRunningSseProcess: async () => false,
    writeManifest: async (handle, content) => {
      await handle.writeFile(content.subarray(0, 13));
      throw new Error("synthetischer Manifestfehler");
    },
  });
  assert.equal(manifestFailure.kind, "postcondition-failed");
  assert.equal(manifestFailure.rolledBack, true);
  assert.equal(existsSync(manifestDestination), false, "Eigenes Teilmanifest oder Ziel blieb liegen.");
  assert.equal(sha256(join(manifestCases, "alt.Gew2025")), manifestArgs.cases[0].expectedSha256);

  const foreignEntryCases = join(temporary, "foreign-entry-cases");
  const foreignEntryArgs = writeInventory(foreignEntryCases);
  const foreignEntryDestination = join(temporary, "foreign-entry-archive");
  const foreignEntryPath = join(foreignEntryDestination, "fremd.txt");
  const foreignEntry = await executeLocalArchive({
    args: { dir: foreignEntryCases, dest: foreignEntryDestination, ...foreignEntryArgs },
    resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 30_000,
    redactPaths: (value) => value, hasRunningSseProcess: async () => false,
    afterFileMoved: () => writeFileSync(foreignEntryPath, "fremder Zieleintrag", "utf8"),
  });
  assert.equal(foreignEntry.kind, "postcondition-failed");
  assert.equal(foreignEntry.rolledBack, false);
  assert.equal(sha256(join(foreignEntryCases, "alt.Gew2025")), foreignEntryArgs.cases[0].expectedSha256);
  assert.equal(readFileSync(foreignEntryPath, "utf8"), "fremder Zieleintrag");
  assert(foreignEntry.retainedTargets.includes(foreignEntryPath));

  const remainingChangeCases = join(temporary, "remaining-change-cases");
  const remainingChangeArgs = writeInventory(remainingChangeCases);
  const remainingChangeDestination = join(temporary, "remaining-change-archive");
  const changedRemainingPath = join(remainingChangeCases, "aktuell.Gew2025");
  const remainingChanged = await executeLocalArchive({
    args: { dir: remainingChangeCases, dest: remainingChangeDestination, ...remainingChangeArgs },
    resourceRefs: {}, profile: loadProductProfile("2025"), timeoutMs: 30_000,
    redactPaths: (value) => value, hasRunningSseProcess: async () => false,
    afterFileMoved: () => writeFileSync(changedRemainingPath, "fremd veraenderter Restfall", "utf8"),
  });
  assert.equal(remainingChanged.kind, "postcondition-failed");
  assert.equal(remainingChanged.rolledBack, true, JSON.stringify(remainingChanged));
  assert.equal(sha256(join(remainingChangeCases, "alt.Gew2025")), remainingChangeArgs.cases[0].expectedSha256);
  assert.equal(readFileSync(changedRemainingPath, "utf8"), "fremd veraenderter Restfall",
    "Fremd veraenderter Restbestand wurde beim Rollback ueberschrieben.");
  assert.equal(existsSync(remainingChangeDestination), false);

  const apiCases = join(temporary, "api-cases");
  const apiArgs = writeInventory(apiCases);
  const workspace = join(temporary, "workspace");
  const results = join(temporary, "results");
  const backups = join(temporary, "backups");
  for (const directory of [workspace, results, backups]) mkdirSync(directory, { recursive: true });
  let workerCalls = 0;
  const execute = createApiExecutor(
    {
      host: "127.0.0.1", port: 43127, token: "archive-local-parity-token-24",
      configPath: join(temporary, "config.json"), profileId: "2025", caseDir: apiCases,
      workspaceDir: workspace, resultDir: results, backupsDir: backups,
    },
    async () => {
      workerCalls += 1;
      throw new Error("archive_cases darf keinen PowerShell-Worker starten.");
    },
    { archiveHasRunningSseProcess: async () => false },
  );
  const apiResult = await execute("archive_cases", {
    destinationRef: "backups:lokal", ...apiArgs,
  }, 30_000);
  assert.equal(apiResult.ok, true, JSON.stringify(apiResult));
  assert.equal(workerCalls, 0);
  assert.deepEqual(apiResult.resourceRefs, { destinationRef: "backups:lokal" });
  assert.equal(apiResult.dest, "backups:lokal");
  assert.equal(apiResult.manifest, "backups:lokal/pruefsummen.csv");
  assert(!JSON.stringify(apiResult).includes(temporary), "Archivergebnis leakt absolute Ressourcenpfade.");

  process.stdout.write("Lokale Fallarchivierung: Worker-Paritaet, Backupnamen, Rollback, Interferenz und API-Pfad bestanden.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
