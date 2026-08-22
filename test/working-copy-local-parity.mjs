import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "node:fs/promises";
import { createApiExecutor } from "../dist/api-executor.js";
import { sameFileIdentity } from "../dist/file-identity.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { executeLocalWorkingCopy } from "../dist/working-copy-executor.js";
import { directWorker } from "./direct-worker-helpers.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sse-working-copy-local-parity-"));
const cases = join(temporary, "cases");
const workspace = join(temporary, "workspace");
const results = join(temporary, "results");
for (const directory of [cases, workspace, results]) mkdirSync(directory, { recursive: true });

const uint32 = (value) => {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
};
const record = (name, type, value) => {
  const encodedName = Buffer.from(`${name}\0`, "ascii");
  return Buffer.concat([uint32(encodedName.length), encodedName, Buffer.from([type]), uint32(value.length), value]);
};
const textRecord = (name, value) => record(name, 4, Buffer.from(`${value}\0`, "utf8"));
const akadFixture = (year = 2025, payloadBytes = 16) => {
  const uuid = Buffer.from("12345678-1234-1234-1234-123456789abc\0", "ascii");
  return Buffer.concat([
    Buffer.from("AKAD", "ascii"),
    Buffer.alloc(8),
    uint32(uuid.length),
    uuid,
    Buffer.from("FIIF", "ascii"),
    Buffer.from([0xaa, 0xbb, 0xcc]),
    textRecord("FileType", "Gew"),
    textRecord("VJahr", String(year)),
    textRecord("Steuernummer", "synthetisch"),
    textRecord("FileSavedBy", year === 2025 ? "31.0.1.0" : "30.0.127.0"),
    textRecord("ElsterTransferTime", ""),
    record("svCrypted", 12, Buffer.alloc(payloadBytes, 1)),
  ]);
};
const sha256Bytes = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();
const sha256File = (path) => sha256Bytes(readFileSync(path));
const normalizedSuccessContract = ({ ms: _ms, resourceRefs: _resourceRefs, ...result }) => ({
  ...result,
  source: "source",
  target: "target",
});

let workerCalls = 0;
const execute2025 = createApiExecutor(
  {
    host: "127.0.0.1",
    port: 43127,
    token: "working-copy-local-parity-token",
    configPath: join(temporary, "config-2025.json"),
    profileId: "2025",
    caseDir: cases,
    workspaceDir: workspace,
    resultDir: results,
  },
  async () => {
    workerCalls += 1;
    throw new Error("make_working_copy darf keinen PowerShell-Worker starten.");
  },
);

try {
  const sourceName = "quelle.Gew2025";
  const targetName = "arbeitskopie.gEw2025";
  const sourcePath = join(cases, sourceName);
  const targetPath = join(cases, targetName);
  const sourceBytes = akadFixture();
  writeFileSync(sourcePath, sourceBytes);
  const sourceHash = sha256Bytes(sourceBytes);

  const directRoot = join(temporary, "direct");
  mkdirSync(directRoot);
  const directSource = join(directRoot, sourceName);
  const directTarget = join(directRoot, targetName);
  writeFileSync(directSource, sourceBytes);
  const workerSuccess = directWorker("make_working_copy", {
    source: directSource,
    target: directTarget,
    expectedSourceHash: sourceHash.toLowerCase(),
  });

  const apiSuccess = await execute2025("make_working_copy", {
    sourceRef: `cases:${sourceName}`,
    targetRef: `cases:${targetName}`,
    expectedSourceHash: sourceHash.toLowerCase(),
  }, 30_000);
  assert.equal(workerCalls, 0, "Der erfolgreiche lokale Kopierpfad startete einen Worker.");
  assert.deepEqual(
    normalizedSuccessContract(apiSuccess),
    normalizedSuccessContract(workerSuccess),
    "Lokaler Erfolg driftet vom echten Worker-Vertrag.",
  );
  assert.deepEqual(apiSuccess.resourceRefs, {
    sourceRef: `cases:${sourceName}`,
    targetRef: `cases:${targetName}`,
  });
  assert.equal(apiSuccess.source, `cases:${sourceName}`);
  assert.equal(apiSuccess.target, `cases:${targetName}`);
  assert(!JSON.stringify(apiSuccess).includes(cases), "Lokale Arbeitskopie leakt einen absoluten Ressourcenpfad.");
  assert.deepEqual(readFileSync(targetPath), sourceBytes);

  const invalidBytes = Buffer.from("kein AKAD", "utf8");
  const invalidHash = sha256Bytes(invalidBytes);
  const invalidSourceName = "ungueltiger-kopf.Gew2025";
  const invalidTargetName = "ungueltiger-kopf-kopie.Gew2025";
  writeFileSync(join(cases, invalidSourceName), invalidBytes);
  writeFileSync(join(directRoot, invalidSourceName), invalidBytes);
  const workerInvalid = directWorker("make_working_copy", {
    source: join(directRoot, invalidSourceName),
    target: join(directRoot, invalidTargetName),
    expectedSourceHash: invalidHash,
  });
  const apiInvalid = await execute2025("make_working_copy", {
    sourceRef: `cases:${invalidSourceName}`,
    targetRef: `cases:${invalidTargetName}`,
    expectedSourceHash: invalidHash,
  }, 30_000);
  assert.deepEqual(
    normalizedSuccessContract(apiInvalid),
    normalizedSuccessContract(workerInvalid),
    "Nicht parsebarer AKAD-Kopf driftet zwischen lokalem Pfad und Worker.",
  );
  assert.equal(workerCalls, 0);

  const identityLeft = join(cases, "identitaet-links.Gew2025");
  const identityRight = join(cases, "identitaet-rechts.Gew2025");
  writeFileSync(identityLeft, sourceBytes);
  writeFileSync(identityRight, sourceBytes);
  assert.equal(
    sameFileIdentity(statSync(identityLeft, { bigint: true }), statSync(identityRight, { bigint: true })),
    false,
    "Zwei bytegleiche Dateien auf dem Testvolume duerfen nicht dieselbe Dateiidentitaet besitzen.",
  );

  const errorCases = [
    {
      name: "falscher Hash",
      args: {
        sourceRef: `cases:${sourceName}`,
        targetRef: "cases:falscher-hash.Gew2025",
        expectedSourceHash: "0".repeat(64),
      },
      kind: "precondition-failed",
      target: join(cases, "falscher-hash.Gew2025"),
    },
    {
      name: "existierendes Ziel",
      prepare: (path) => writeFileSync(path, "fremd", "utf8"),
      args: {
        sourceRef: `cases:${sourceName}`,
        targetRef: "cases:vorhanden.Gew2025",
        expectedSourceHash: sourceHash,
      },
      kind: "exists",
      target: join(cases, "vorhanden.Gew2025"),
      preserved: "fremd",
    },
    {
      name: "fremde Endung",
      args: {
        sourceRef: `cases:${sourceName}`,
        targetRef: "cases:fremd.ESt2025",
        expectedSourceHash: sourceHash,
      },
      kind: "bad-args",
      target: join(cases, "fremd.ESt2025"),
    },
    {
      name: "fehlender Zielordner",
      args: {
        sourceRef: `cases:${sourceName}`,
        targetRef: "cases:fehlt/arbeitskopie.Gew2025",
        expectedSourceHash: sourceHash,
      },
      kind: "not-found",
      target: join(cases, "fehlt", "arbeitskopie.Gew2025"),
    },
  ];
  for (const errorCase of errorCases) {
    errorCase.prepare?.(errorCase.target);
    const result = await execute2025("make_working_copy", errorCase.args, 30_000);
    assert.equal(result.ok, false, `${errorCase.name}: lokaler Pfad meldet Erfolg.`);
    assert.equal(result.kind, errorCase.kind, `${errorCase.name}: falsche Fehlerart.`);
    assert.equal(workerCalls, 0, `${errorCase.name}: lokaler Fehler startete einen Worker.`);
    const relativeTarget = errorCase.args.targetRef.slice("cases:".length);
    const directErrorTarget = join(directRoot, ...relativeTarget.split("/"));
    errorCase.prepare?.(directErrorTarget);
    const workerError = directWorker("make_working_copy", {
      source: directSource,
      target: directErrorTarget,
      expectedSourceHash: errorCase.args.expectedSourceHash,
    });
    assert.deepEqual(
      { ok: result.ok, kind: result.kind },
      { ok: workerError.ok, kind: workerError.kind },
      `${errorCase.name}: lokaler Fehler driftet vom echten Worker.`,
    );
    if (errorCase.preserved !== undefined) {
      assert.equal(readFileSync(errorCase.target, "utf8"), errorCase.preserved);
    } else {
      assert.equal(existsSync(errorCase.target), false, `${errorCase.name}: abgelehntes Ziel blieb liegen.`);
    }
  }

  const profile = loadProductProfile("2025");
  const identity = (value) => value;
  const changedSource = join(cases, "quelle-geaendert.Gew2025");
  const changedSourceTarget = join(cases, "quelle-geaendert-kopie.Gew2025");
  writeFileSync(changedSource, sourceBytes);
  const sourceChanged = await executeLocalWorkingCopy({
    args: { source: changedSource, target: changedSourceTarget, expectedSourceHash: sourceHash },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterCopy: () => writeFileSync(changedSource, Buffer.concat([sourceBytes, Buffer.from("veraendert")])),
  });
  assert.equal(sourceChanged.ok, false);
  assert.equal(sourceChanged.kind, "postcondition-failed");
  assert.equal(sourceChanged.targetStillOwned, true);
  assert.equal(sourceChanged.rolledBack, true);
  assert.equal(existsSync(changedSourceTarget), false, "Eigene Kopie einer veraenderten Quelle blieb liegen.");

  const interferedSource = join(cases, "ziel-interferenz.Gew2025");
  const interferedTarget = join(cases, "ziel-interferenz-kopie.Gew2025");
  writeFileSync(interferedSource, sourceBytes);
  const foreignBytes = Buffer.from("fremder zielinhalt", "utf8");
  const targetInterfered = await executeLocalWorkingCopy({
    args: { source: interferedSource, target: interferedTarget, expectedSourceHash: sourceHash },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterCopy: () => writeFileSync(interferedTarget, foreignBytes),
  });
  assert.equal(targetInterfered.ok, false);
  assert.equal(targetInterfered.kind, "postcondition-failed");
  assert.equal(targetInterfered.targetStillOwned, false);
  assert.equal(targetInterfered.rolledBack, false);
  assert.deepEqual(readFileSync(interferedTarget), foreignBytes,
    "Fremd veraendertes Ziel wurde geloescht oder erneut ueberschrieben.");

  const replacedSource = join(cases, "ziel-ersetzt.Gew2025");
  const replacedTarget = join(cases, "ziel-ersetzt-kopie.Gew2025");
  writeFileSync(replacedSource, sourceBytes);
  const targetReplaced = await executeLocalWorkingCopy({
    args: { source: replacedSource, target: replacedTarget, expectedSourceHash: sourceHash },
    resourceRefs: {},
    profile,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterCopy: () => {
      unlinkSync(replacedTarget);
      writeFileSync(replacedTarget, sourceBytes);
    },
  });
  assert.equal(targetReplaced.ok, false);
  assert.equal(targetReplaced.kind, "postcondition-failed");
  assert.equal(targetReplaced.targetStillOwned, false,
    "Bytegleicher Ersatz darf nicht ueber den Hash als eigenes Ziel gelten.");
  assert.equal(targetReplaced.rolledBack, false);
  assert.deepEqual(readFileSync(replacedTarget), sourceBytes,
    "Bytegleiche fremde Ersatzdatei wurde wegen eines Identitaetsfehlers geloescht.");

  const abortSource = join(cases, "abbruch.Gew2025");
  const abortTarget = join(cases, "abbruch-kopie.Gew2025");
  const largeBytes = akadFixture(2025, 3 * 1024 * 1024);
  writeFileSync(abortSource, largeBytes);
  const abortController = new AbortController();
  const aborted = await executeLocalWorkingCopy({
    args: { source: abortSource, target: abortTarget, expectedSourceHash: sha256Bytes(largeBytes) },
    resourceRefs: {},
    profile,
    signal: abortController.signal,
    timeoutMs: 30_000,
    redactPaths: identity,
    afterChunk: () => abortController.abort(),
  });
  assert.equal(aborted.kind, "aborted");
  assert.equal(aborted.targetStillOwned, true);
  assert.equal(aborted.rolledBack, true);
  assert.equal(existsSync(abortTarget), false, "Abbruch liess eine eigene Teilkopie liegen.");

  const timeoutSource = join(cases, "timeout.Gew2025");
  const timeoutTarget = join(cases, "timeout-kopie.Gew2025");
  writeFileSync(timeoutSource, largeBytes);
  const timedOut = await executeLocalWorkingCopy({
    args: { source: timeoutSource, target: timeoutTarget, expectedSourceHash: sha256File(timeoutSource) },
    resourceRefs: {},
    profile,
    timeoutMs: 100,
    redactPaths: identity,
    afterChunk: () => new Promise((resolvePromise) => setTimeout(resolvePromise, 150)),
  });
  assert.equal(timedOut.kind, "timeout");
  assert.equal(timedOut.targetStillOwned, true);
  assert.equal(timedOut.rolledBack, true);
  assert.equal(existsSync(timeoutTarget), false, "Timeout liess eine eigene Teilkopie liegen.");

  const lateOpenSource = join(cases, "spaeter-open.Gew2025");
  const lateOpenTarget = join(cases, "spaeter-open-kopie.Gew2025");
  writeFileSync(lateOpenSource, sourceBytes);
  const lateOpen = await executeLocalWorkingCopy({
    args: { source: lateOpenSource, target: lateOpenTarget, expectedSourceHash: sourceHash },
    resourceRefs: {},
    profile,
    timeoutMs: 100,
    redactPaths: identity,
    openFile: async (path, flags) => {
      if (flags === "r") return await open(path, flags);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
      return await open(path, flags);
    },
  });
  assert.equal(lateOpen.kind, "timeout");
  // Die Aufraeumung des spaeten Opens ist bewusst nicht Teil des Timeout-
  // Ergebnisses (es darf nicht an einem haengenden Open warten). Die Garantie
  // lautet "wird entfernt", nicht "innerhalb von 250 ms" - auf einem
  // ausgelasteten CI-Datentraeger brauchen die acht Datei-Roundtrips laenger.
  const lateOpenDeadline = Date.now() + 10_000;
  while (existsSync(lateOpenTarget) && Date.now() < lateOpenDeadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.equal(existsSync(lateOpenTarget), false,
    "Ein nach Timeout spaet erfolgreiches wx+-Open liess ein leeres Ziel liegen.");

  const cases2024 = join(temporary, "cases-2024");
  mkdirSync(cases2024);
  const bytes2024 = akadFixture(2024);
  writeFileSync(join(cases2024, "quelle.Gew2024"), bytes2024);
  const execute2024 = createApiExecutor(
    {
      host: "127.0.0.1",
      port: 43128,
      token: "working-copy-local-parity-2024",
      configPath: join(temporary, "config-2024.json"),
      profileId: "2024",
      operateExperimental: true,
      caseDir: cases2024,
      workspaceDir: join(temporary, "workspace-2024"),
      resultDir: join(temporary, "results-2024"),
    },
    async () => {
      workerCalls += 1;
      throw new Error("2024-Arbeitskopie darf keinen Worker starten.");
    },
  );
  const copied2024 = await execute2024("make_working_copy", {
    sourceRef: "cases:quelle.Gew2024",
    targetRef: "cases:kopie.Gew2024",
    expectedSourceHash: sha256Bytes(bytes2024),
  }, 30_000);
  assert.equal(copied2024.ok, true, JSON.stringify(copied2024));
  assert.equal(workerCalls, 0);

  process.stdout.write("Lokale Arbeitskopie: Worker-Paritaet, Profilbindung, Interferenz und Cleanup bestanden.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
