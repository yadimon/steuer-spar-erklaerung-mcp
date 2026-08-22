import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { executeLocalBackup } from "../dist/backup-executor.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { directWorker } from "./direct-worker-helpers.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sse-backup-local-parity-"));
const cases = join(temporary, "cases");
const workspace = join(temporary, "workspace");
const results = join(temporary, "results");
const backups = join(temporary, "backups");
const directCases = join(temporary, "direct-cases");
for (const directory of [cases, workspace, results, backups, directCases]) mkdirSync(directory);

const fixtures = new Map([
  ["zwei.Gew2025", Buffer.from([0, 1, 2, 3, 255])],
  ["A-fall.Gew2025", Buffer.from("synthetischer-fall-a\n", "utf8")],
  ["Ärger.Gew2025", Buffer.from("synthetischer-fall-umlaut\n", "utf8")],
  ["eins.Gew2025", Buffer.from("synthetischer-fall-eins\n", "utf8")],
]);
const writeFixtures = (directory) => {
  for (const [name, bytes] of fixtures) writeFileSync(join(directory, name), bytes);
};
for (const directory of [cases, directCases]) {
  writeFixtures(directory);
}

const normalized = ({ ms: _ms, resourceRefs: _refs, ...result }) => ({
  ...result,
  dest: result.dest ? "backup" : result.dest,
  manifest: result.manifest ? "manifest" : result.manifest,
  files: [...(result.files ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
  hashes: [...(result.hashes ?? [])].sort((left, right) => left.file.localeCompare(right.file)),
});

let workerCalls = 0;
const execute = createApiExecutor(
  {
    host: "127.0.0.1",
    port: 43127,
    configPath: join(temporary, "config.json"),
    profileId: "2025",
    caseDir: cases,
    workspaceDir: workspace,
    resultDir: results,
    backupsDir: backups,
  },
  async () => {
    workerCalls += 1;
    throw new Error("backup_cases darf keinen PowerShell-Worker starten.");
  },
);

try {
  const directDestination = join(temporary, "direct-backup");
  const expected = directWorker("backup_cases", { dir: directCases, dest: directDestination });
  const actual = await execute("backup_cases", { destinationRef: "backups:local-success" }, 30_000);
  assert.equal(workerCalls, 0, "Lokaler Backup-Erfolg startete einen Worker.");
  assert.deepEqual(normalized(actual), normalized(expected),
    "Lokaler Backup-Erfolg driftet vom echten Worker-Vertrag.");
  assert.deepEqual(actual.resourceRefs, { destinationRef: "backups:local-success" });
  assert.equal(actual.dest, "backups:local-success");
  assert.equal(actual.manifest, "backups:local-success/pruefsummen.csv");
  assert(!JSON.stringify(actual).includes(temporary), "Backup-Ergebnis leakt absolute Ressourcenpfade.");
  assert.deepEqual(
    readFileSync(join(backups, "local-success", "pruefsummen.csv")),
    readFileSync(join(directDestination, "pruefsummen.csv")),
    "Lokales Pruefsummenmanifest driftet byteweise vom Worker.",
  );

  const repeated = await execute("backup_cases", { destinationRef: "backups:local-success" }, 30_000);
  const repeatedWorker = directWorker("backup_cases", { dir: directCases, dest: directDestination });
  assert.deepEqual(
    { ok: repeated.ok, kind: repeated.kind },
    { ok: repeatedWorker.ok, kind: repeatedWorker.kind },
    "Wiederholschutz driftet vom Worker.",
  );
  assert.equal(workerCalls, 0);

  const directNestedDestination = join(temporary, "direct-nested", "monat", "sicherung");
  const expectedNested = directWorker("backup_cases", { dir: directCases, dest: directNestedDestination });
  assert.equal(expectedNested.ok, true, `Worker muss verschachteltes Sicherungsziel anlegen: ${JSON.stringify(expectedNested)}`);
  const actualNested = await execute("backup_cases", { destinationRef: "backups:monat/sicherung" }, 30_000);
  assert.deepEqual(normalized(actualNested), normalized(expectedNested),
    "Verschachteltes Sicherungsziel driftet vom Worker.");
  assert.equal(existsSync(join(backups, "monat", "sicherung", "pruefsummen.csv")), true);

  const profile = loadProductProfile("2025");
  const identity = (value) => value;
  const cleanFailureDestination = join(temporary, "clean-failure");
  const cleanFailure = await executeLocalBackup({
    args: { dir: cases, dest: cleanFailureDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterFileCopied: () => {
      throw new Error("synthetischer Fehler nach Kopie");
    },
  });
  assert.equal(cleanFailure.ok, false);
  assert.equal(cleanFailure.kind, "postcondition-failed");
  assert.equal(cleanFailure.rolledBack, true);
  assert.equal(existsSync(cleanFailureDestination), false,
    "Vollstaendig eigener fehlgeschlagener Backupstand blieb liegen.");

  const nestedRollbackRoot = join(temporary, "nested-rollback");
  const nestedRollbackDestination = join(nestedRollbackRoot, "monat", "sicherung");
  const nestedRollback = await executeLocalBackup({
    args: { dir: cases, dest: nestedRollbackDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterFileCopied: () => {
      throw new Error("synthetischer Fehler in verschachtelter Sicherung");
    },
  });
  assert.equal(nestedRollback.ok, false);
  assert.equal(nestedRollback.rolledBack, true);
  assert.equal(existsSync(nestedRollbackRoot), false,
    "Eigene leere Zielkette wurde nach fehlgeschlagener Sicherung nicht entfernt.");

  const foreignFailureDestination = join(temporary, "foreign-failure");
  let changedTarget;
  const foreignFailure = await executeLocalBackup({
    args: { dir: cases, dest: foreignFailureDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterFileCopied: ({ target }) => {
      changedTarget = target;
      writeFileSync(target, "fremder inhalt", "utf8");
      throw new Error("synthetische Zielinterferenz");
    },
  });
  assert.equal(foreignFailure.ok, false);
  assert.equal(foreignFailure.kind, "postcondition-failed");
  assert.equal(foreignFailure.rolledBack, false);
  assert.equal(foreignFailure.backupStillExists, true);
  assert.equal(readFileSync(changedTarget, "utf8"), "fremder inhalt",
    "Fremd veraenderte Sicherungsdatei wurde geloescht.");

  const readbackFailureDestination = join(temporary, "readback-failure");
  const readbackFailure = await executeLocalBackup({
    args: { dir: cases, dest: readbackFailureDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterFileCopied: ({ target }) => {
      writeFileSync(target, "erst nach dem Kopieren veraendert", "utf8");
    },
  });
  assert.equal(readbackFailure.ok, false);
  assert.equal(readbackFailure.kind, "postcondition-failed");
  assert.match(readbackFailure.error, /nicht mehr bytegleich/);
  assert.equal(readbackFailure.rolledBack, false);

  const partialManifestDestination = join(temporary, "partial-manifest-failure");
  const partialManifestFailure = await executeLocalBackup({
    args: { dir: cases, dest: partialManifestDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    writeManifest: async (handle, content) => {
      await handle.writeFile(content.subarray(0, 11));
      throw new Error("synthetischer Manifest-Schreibfehler");
    },
  });
  assert.equal(partialManifestFailure.ok, false);
  assert.equal(partialManifestFailure.kind, "postcondition-failed");
  assert.equal(partialManifestFailure.rolledBack, true);
  assert.equal(existsSync(partialManifestDestination), false,
    "Eigenes partielles Manifest blockiert den Rollback.");

  const corruptManifestDestination = join(temporary, "corrupt-manifest-failure");
  const corruptManifestPath = join(corruptManifestDestination, "pruefsummen.csv");
  const corruptManifestFailure = await executeLocalBackup({
    args: { dir: cases, dest: corruptManifestDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    writeManifest: async (handle, content) => {
      await handle.writeFile(Buffer.alloc(content.length, 0x58));
    },
  });
  assert.equal(corruptManifestFailure.ok, false);
  assert.equal(corruptManifestFailure.kind, "postcondition-failed");
  assert.equal(corruptManifestFailure.rolledBack, false);
  assert(corruptManifestFailure.retainedTargets.includes(corruptManifestPath));
  assert.equal(readFileSync(corruptManifestPath).every((byte) => byte === 0x58), true,
    "Inhaltlich fremdes Manifest wurde geloescht oder veraendert.");

  const afterManifestDestination = join(temporary, "after-manifest-failure");
  const afterManifestForeignFile = join(afterManifestDestination, "spaet-fremd.txt");
  const afterManifestFailure = await executeLocalBackup({
    args: { dir: cases, dest: afterManifestDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterManifestWritten: () => {
      writeFileSync(afterManifestForeignFile, "fremder Zieleintrag", "utf8");
    },
  });
  assert.equal(afterManifestFailure.ok, false);
  assert.equal(afterManifestFailure.kind, "postcondition-failed");
  assert.equal(afterManifestFailure.rolledBack, false);
  assert.equal(readFileSync(afterManifestForeignFile, "utf8"), "fremder Zieleintrag");
  assert(afterManifestFailure.retainedTargets.includes(afterManifestForeignFile));

  const afterManifestCases = join(temporary, "after-manifest-cases");
  const afterManifestSourceDestination = join(temporary, "after-manifest-source-failure");
  mkdirSync(afterManifestCases);
  writeFixtures(afterManifestCases);
  const lateSource = join(afterManifestCases, "nach-manifest.Gew2025");
  const afterManifestSourceFailure = await executeLocalBackup({
    args: { dir: afterManifestCases, dest: afterManifestSourceDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterManifestWritten: () => {
      writeFileSync(lateSource, "neuer Quellfall nach Manifest", "utf8");
    },
  });
  assert.equal(afterManifestSourceFailure.ok, false);
  assert.equal(afterManifestSourceFailure.kind, "postcondition-failed");
  assert.match(afterManifestSourceFailure.error, /nach dem Manifest veraendert/);
  assert.equal(afterManifestSourceFailure.rolledBack, true);
  assert.equal(existsSync(afterManifestSourceDestination), false);
  assert.equal(existsSync(lateSource), true);

  const foreignEntryDestination = join(temporary, "foreign-entry-failure");
  const foreignEntry = join(foreignEntryDestination, "fremd.txt");
  const foreignEntryFailure = await executeLocalBackup({
    args: { dir: cases, dest: foreignEntryDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterFileCopied: () => {
      writeFileSync(foreignEntry, "nicht vom Backup", "utf8");
    },
  });
  assert.equal(foreignEntryFailure.ok, false);
  assert.equal(foreignEntryFailure.kind, "postcondition-failed");
  assert.equal(foreignEntryFailure.rolledBack, false);
  assert.equal(readFileSync(foreignEntry, "utf8"), "nicht vom Backup");
  assert(foreignEntryFailure.retainedTargets.includes(foreignEntry),
    "Unbekannter Zieleintrag fehlt in retainedTargets.");

  const changingCases = join(temporary, "changing-cases");
  const changingDestination = join(temporary, "changing-source-failure");
  mkdirSync(changingCases);
  writeFixtures(changingCases);
  const addedSource = join(changingCases, "spaeter.Gew2025");
  const changingSourceFailure = await executeLocalBackup({
    args: { dir: changingCases, dest: changingDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterFileCopied: () => {
      writeFileSync(addedSource, "neuer Fall", "utf8");
    },
  });
  assert.equal(changingSourceFailure.ok, false);
  assert.equal(changingSourceFailure.kind, "postcondition-failed");
  assert.equal(changingSourceFailure.rolledBack, true);
  assert.equal(existsSync(changingDestination), false);
  assert.equal(existsSync(addedSource), true, "Quellinterferenz darf nie veraendert werden.");

  const abortController = new AbortController();
  const abortedDestination = join(temporary, "aborted-backup");
  const aborted = await executeLocalBackup({
    args: { dir: cases, dest: abortedDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    signal: abortController.signal,
    redactPaths: identity,
    afterFileCopied: () => {
      abortController.abort();
    },
  });
  assert.equal(aborted.kind, "aborted");
  assert.equal(aborted.rolledBack, true);
  assert.equal(existsSync(abortedDestination), false);

  const timedOutDestination = join(temporary, "timed-out-backup");
  const timedOut = await executeLocalBackup({
    args: { dir: cases, dest: timedOutDestination },
    resourceRefs: {},
    profile,
    timeoutMs: 200,
    redactPaths: identity,
    afterFileCopied: async () => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    },
  });
  assert.equal(timedOut.kind, "timeout", JSON.stringify(timedOut));
  assert.equal(timedOut.rolledBack, true);
  assert.equal(existsSync(timedOutDestination), false);

  const emptyCases = join(temporary, "empty-cases");
  mkdirSync(emptyCases);
  const empty = await executeLocalBackup({
    args: { dir: emptyCases, dest: join(temporary, "empty-backup") },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
  });
  assert.equal(empty.kind, "not-found");
  assert.equal(existsSync(join(temporary, "empty-backup")), false);

  const nested = await executeLocalBackup({
    args: { dir: cases, dest: join(cases, "nested-backup") },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
  });
  assert.equal(nested.kind, "bad-args");
  assert.equal(existsSync(join(cases, "nested-backup")), false);

  process.stdout.write("Lokale Fallsicherung: Worker-Paritaet, Manifest, Interferenz und Rollback bestanden.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
