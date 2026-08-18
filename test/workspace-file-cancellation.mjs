import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { SSE_MCP_DIAGNOSTIC_SCHEMAS } from "../dist/mcp-schemas-diagnostics.js";
import { SSE_API_OPERATION_SCHEMAS } from "../dist/operation-catalog.js";
import { SSE_API_RESULT_OUTPUT_SCHEMAS } from "../dist/result-contract.js";
import { executeWorkspaceOperation } from "../dist/workspace-executor.js";
import {
  listWorkspaceFiles,
  listWorkspaceFilesBounded,
  WorkspaceListStoppedError,
} from "../dist/workspace.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-workspace-cancellation-"));
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });
for (let index = 0; index < 4; index += 1) {
  writeFileSync(join(workspaceDir, `fixture-${index}.txt`), `Inhalt ${index}\n`, "utf8");
}
mkdirSync(join(workspaceDir, "nested"));
writeFileSync(join(workspaceDir, "nested", "child.txt"), "verschachtelt\n", "utf8");

const execute = createApiExecutor(
  {
    host: "127.0.0.1",
    port: 1,
    token: "workspace-cancellation-token",
    configPath: join(temporary, "config.json"),
    workspaceDir,
    resultDir,
  },
  async () => ({ ok: true }),
);

try {
  const synchronous = listWorkspaceFiles(workspaceDir, ".", 2_000, true);
  const cooperative = await listWorkspaceFilesBounded(workspaceDir, ".", 2_000, true);
  assert.deepEqual(cooperative.files, synchronous,
    "Kooperative Dateiliste muss denselben sortierten Inhalt wie der synchrone Kompatibilitaetspfad liefern");
  assert.equal(cooperative.truncated, false);
  assert.equal(
    cooperative.files.find((file) => file.ref === "fixture-0.txt")?.sha256,
    createHash("sha256").update("Inhalt 0\n", "utf8").digest("hex"),
    "Chunkweises Hashen muss gegen einen unabhaengig berechneten SHA-256 stimmen",
  );
  await assert.rejects(
    listWorkspaceFilesBounded(workspaceDir, ".", 2_000, true, { maxDirectories: 1 }),
    /Ordnerlimit von 1/u,
    "Kooperativer Pfad muss dasselbe Ordnerlimit wie der synchrone Referenzpfad beachten",
  );

  const deletionRoot = join(temporary, "concurrent-delete");
  mkdirSync(deletionRoot);
  for (const name of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(deletionRoot, name), name, "utf8");
  const deletionFiles = await listWorkspaceFilesBounded(deletionRoot, ".", 2_000, true, {
    afterWork: () => rmSync(join(deletionRoot, "c.txt"), { force: true }),
  });
  assert.deepEqual(deletionFiles.files.map((file) => file.ref), ["a.txt", "b.txt"],
    "Waehrend der Auflistung geloeschter Eintrag muss fehlen, darf aber die Restliste nicht zerstoeren");
  assert.equal(deletionFiles.truncated, false);
  const exactLimitFiles = await listWorkspaceFilesBounded(deletionRoot, ".", 2, false);
  assert.equal(exactLimitFiles.files.length, 2);
  assert.equal(exactLimitFiles.truncated, false,
    "Exakt limit viele Dateien sind vollstaendig und duerfen nicht als abgeschnitten gelten");

  const hashAbortRoot = join(temporary, "hash-abort");
  mkdirSync(hashAbortRoot);
  writeFileSync(join(hashAbortRoot, "large.bin"), Buffer.alloc(256 * 1024, 0x43));
  const hashAbort = new AbortController();
  let observedHashChunks = 0;
  await assert.rejects(
    listWorkspaceFilesBounded(hashAbortRoot, ".", 10, true, {
      signal: hashAbort.signal,
      afterWork: (kind) => {
        if (kind !== "hash-chunk") return;
        observedHashChunks += 1;
        hashAbort.abort();
      },
    }),
    (error) => error instanceof WorkspaceListStoppedError && error.kind === "aborted",
    "Auch innerhalb eines einzelnen Datei-Hashes muss Clientabbruch beobachtet werden",
  );
  assert.equal(observedHashChunks, 1, "Hashabbruch muss nach genau einem 64-KiB-Chunk stoppen");

  const hashBudgetRoot = join(temporary, "hash-budget");
  mkdirSync(hashBudgetRoot);
  const changingHashPath = join(hashBudgetRoot, "a-changing.bin");
  const followingHashPath = join(hashBudgetRoot, "b-following.bin");
  writeFileSync(changingHashPath, Buffer.alloc(64 * 1024, 0x41));
  writeFileSync(followingHashPath, Buffer.alloc(64 * 1024, 0x42));
  let growthApplied = false;
  const budgetedHashes = await listWorkspaceFilesBounded(hashBudgetRoot, ".", 10, true, {
    maxTotalHashBytes: 64 * 1024,
    afterWork: (kind) => {
      if (kind !== "hash-chunk" || growthApplied) return;
      truncateSync(changingHashPath, 128 * 1024);
      growthApplied = true;
    },
  });
  assert.equal(growthApplied, true, "Test muss die erste Datei waehrend eines echten Hash-Chunks vergroessern");
  assert.equal(budgetedHashes.files.find((file) => file.ref === "a-changing.bin")?.sha256, null,
    "Ein waehrend des Hashens gewachsener Inhalt darf keinen scheinbar stabilen Hash liefern");
  assert.equal(budgetedHashes.files.find((file) => file.ref === "b-following.bin")?.sha256, null,
    "Fehlgeschlagene Hash-I/O muss das Gesamtbudget belasten und Folgehashes begrenzen");

  const swappedRoot = join(temporary, "swapped-root");
  const swappedDirectory = join(swappedRoot, "inside");
  const outsideDirectory = join(temporary, "outside");
  mkdirSync(swappedDirectory, { recursive: true });
  mkdirSync(outsideDirectory);
  writeFileSync(join(swappedDirectory, "inside.txt"), "innen", "utf8");
  writeFileSync(join(outsideDirectory, "outside.txt"), "aussen", "utf8");
  let swapPending = true;
  await assert.rejects(
    listWorkspaceFilesBounded(swappedRoot, ".", 2_000, true, {
      afterWork: () => {
        if (!swapPending) return;
        rmSync(swappedDirectory, { recursive: true });
        symlinkSync(outsideDirectory, swappedDirectory, "junction");
        swapPending = false;
      },
    }),
    /ausserhalb des Arbeitsbereichs/u,
    "Ausgetauschter Ordner ausserhalb des Roots muss trotz Concurrent-Delete-Toleranz fatal bleiben",
  );

  let syntheticNow = 0;
  await assert.rejects(
    listWorkspaceFilesBounded(workspaceDir, ".", 2_000, true, {
      timeoutMs: 1,
      now: () => syntheticNow,
      afterWork: () => { syntheticNow = 1; },
    }),
    (error) => error instanceof WorkspaceListStoppedError && error.kind === "timeout",
    "Workspace-Liste muss eine waehrend des Laufs erschoepfte Deadline erkennen",
  );

  const afterWorkAbort = new AbortController();
  let completedUnits = 0;
  await assert.rejects(
    listWorkspaceFilesBounded(workspaceDir, ".", 2_000, true, {
      signal: afterWorkAbort.signal,
      afterWork: () => {
        completedUnits += 1;
        afterWorkAbort.abort();
      },
    }),
    (error) => error instanceof WorkspaceListStoppedError && error.kind === "aborted",
    "Abbruch direkt nach einer Laufeinheit muss vor der naechsten Einheit stoppen",
  );
  assert.equal(completedUnits, 1, "Nach dem Abbruch darf keine weitere Laufeinheit starten");

  const preAborted = new AbortController();
  preAborted.abort();
  const abortedList = await execute(
    "workspace_file_list",
    { ref: "workspace:.", limit: 2_000 },
    90_000,
    preAborted.signal,
  );
  assert.equal(abortedList.ok, false,
    "workspace_file_list muss einen bereits abgebrochenen API-Aufruf fail-closed melden");
  assert.equal(abortedList.kind, "aborted");
  assert.equal(abortedList.files, undefined, "Abgebrochene Auflistung darf keine Teilliste liefern");

  const duringList = new AbortController();
  setImmediate(() => duringList.abort());
  const interruptedList = await execute(
    "workspace_file_list",
    { ref: "workspace:.", limit: 2_000 },
    90_000,
    duringList.signal,
  );
  assert.equal(interruptedList.ok, false,
    "workspace_file_list muss den Eventloop waehrend der Auflistung fuer Abbruch freigeben");
  assert.equal(interruptedList.kind, "aborted");
  assert.equal(interruptedList.files, undefined, "Unterbrochene Auflistung darf keine Teilliste liefern");

  const timedOutList = await execute("workspace_file_list", { ref: "workspace:." }, 0);
  assert.equal(timedOutList.ok, false, "workspace_file_list muss ein erschoepftes Zeitbudget beachten");
  assert.equal(timedOutList.kind, "timeout");
  assert.equal(timedOutList.files, undefined, "Zeitueberschreitung darf keine Teilliste liefern");

  const limitedList = await execute(
    "workspace_file_list",
    { ref: "workspace:.", limit: 2, includeHashes: false },
    90_000,
  );
  assert.equal(limitedList.ok, true);
  assert.equal(limitedList.files.length, 2);
  assert.equal(limitedList.truncated, true,
    "Eine nachweislich am Dateilimit abgeschnittene Liste muss dies explizit melden");

  const completeList = await execute(
    "workspace_file_list",
    { ref: "workspace:.", limit: 2_000, includeHashes: false },
    90_000,
  );
  assert.equal(completeList.ok, true);
  assert.equal(completeList.truncated, false,
    "Eine bis zum gebundenen Ende gelaufene Liste darf nicht als abgeschnitten gelten");

  const abortedRead = await execute(
    "workspace_file_read_text",
    { ref: "workspace:fixture-0.txt" },
    90_000,
    preAborted.signal,
  );
  assert.equal(abortedRead.ok, false, "workspace_file_read_text muss vor Dateizugriff auf Abbruch reagieren");
  assert.equal(abortedRead.kind, "aborted");
  assert.equal(abortedRead.text, undefined, "Abgebrochener Read darf keinen Dateiinhalt liefern");

  const timedOutRead = await execute("workspace_file_read_text", { ref: "workspace:fixture-0.txt" }, 0);
  assert.equal(timedOutRead.ok, false);
  assert.equal(timedOutRead.kind, "timeout");
  assert.equal(timedOutRead.text, undefined, "Read nach Deadline darf keinen Dateiinhalt liefern");

  const directRoots = {
    cases: workspaceDir,
    documents: workspaceDir,
    workspace: workspaceDir,
    results: resultDir,
    backups: workspaceDir,
  };
  const clockValues = [0, 0, 10_000];
  const postDeadlineRead = await executeWorkspaceOperation(
    "workspace_file_read_text",
    { ref: "workspace:fixture-0.txt" },
    {
      roots: directRoots,
      workspaceDir,
      resultDir,
      timeoutMs: 10_000,
      now: () => clockValues.shift() ?? 10_000,
      execute: async () => ({ ok: true }),
      redactPaths: (value) => value,
    },
  );
  assert.equal(postDeadlineRead.ok, false,
    "Ein erst waehrend des synchronen Lesens erschoepftes Budget muss das fertige Ergebnis verwerfen");
  assert.equal(postDeadlineRead.kind, "timeout");
  assert.equal(postDeadlineRead.text, undefined, "Spaet fertiger Dateiinhalt darf nicht publiziert werden");

  const blockedWritePath = join(workspaceDir, "blocked-write.txt");
  const abortedWrite = await execute(
    "workspace_file_write_text",
    { ref: "workspace:blocked-write.txt", text: "darf nicht geschrieben werden" },
    90_000,
    preAborted.signal,
  );
  assert.equal(abortedWrite.ok, false, "workspace_file_write_text muss vor Dateizugriff auf Abbruch reagieren");
  assert.equal(abortedWrite.kind, "aborted");
  assert.equal(existsSync(blockedWritePath), false, "Abgebrochener Write legte trotzdem eine Datei an");

  const timedOutWritePath = join(workspaceDir, "timed-out-write.txt");
  const timedOutWrite = await execute(
    "workspace_file_write_text",
    { ref: "workspace:timed-out-write.txt", text: "darf nicht geschrieben werden" },
    0,
  );
  assert.equal(timedOutWrite.ok, false);
  assert.equal(timedOutWrite.kind, "timeout");
  assert.equal(existsSync(timedOutWritePath), false, "Write nach Deadline legte trotzdem eine Datei an");

  assert.match(
    SSE_MCP_DIAGNOSTIC_SCHEMAS.sse_workspace_files.shape.limit.description ?? "",
    /Vorgabe 500, Maximum 2000/u,
    "MCP-Schema muss den tatsaechlichen List-Default dokumentieren",
  );
  assert.match(
    SSE_API_OPERATION_SCHEMAS.workspace_file_list.shape.limit.description ?? "",
    /Vorgabe 500, Maximum 2000/u,
    "Normatives API-Schema muss denselben tatsaechlichen List-Default dokumentieren",
  );
  assert(SSE_API_RESULT_OUTPUT_SCHEMAS.workspace_file_list.shape.truncated,
    "Normatives API-/MCP-Ergebnisschema muss die Trunkierungsmarkierung veroeffentlichen");

  const sourceDirectory = new URL("../src/", import.meta.url);
  const unexpectedSynchronousCallers = readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".ts") && name !== "workspace.ts")
    .filter((name) => /\blistWorkspaceFiles\b/u.test(readFileSync(new URL(name, sourceDirectory), "utf8")));
  assert.deepEqual(unexpectedSynchronousCallers, [],
    "Produktionspfade ausserhalb workspace.ts duerfen den synchronen Referenzpfad nicht verwenden");

  process.stdout.write("Workspace-Dateien: Abbruch, Timeout und fehlende Teilergebnisse fail-closed.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
