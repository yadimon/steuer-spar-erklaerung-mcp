/**
 * Dateisystem-Regressionslauf fuer sse_archive_cases.
 *
 * Ein lokal vorhandener, NICHT uebermittelter Steuerfall dient ausschliesslich
 * als Kopiervorlage im Temp-Ordner. Pfad und Inhalt gelangen nie ins Repo.
 *
 * Aufruf (PowerShell):
 *   $env:SSE_ARCHIVE_FIXTURE = '<nicht uebermittelte Falldatei>'
 *   node test/archive-cases.mjs
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = process.env.SSE_ARCHIVE_FIXTURE;
if (!fixture || !existsSync(fixture)) {
  process.stdout.write("SKIP: SSE_ARCHIVE_FIXTURE fehlt oder existiert nicht.\n");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const worker = join(here, "..", "powershell", "sse-worker.ps1");
const extension = extname(fixture);
if (!/^\.(?:ESt|Gew|GewErfass|Fest|KonsUst|Erm|Zulage|NVBescheinigung|Vorweg)\d{4}$/i.test(extension)) {
  throw new Error(`Nicht unterstuetzte Fixture-Endung: ${extension}`);
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const callWorker = (args, fault = "") => {
  const b64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", worker, "-Op", "archive_cases", "-B64", b64],
    {
      encoding: "utf8",
      env: { ...process.env, SSE_MCP_TEST_FAULT: fault },
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (!result.stdout.trim()) throw new Error(`Worker ohne JSON. stderr=${result.stderr}`);
  return JSON.parse(result.stdout);
};

const root = mkdtempSync(join(tmpdir(), "sse-archive-cases-"));
let checks = 0;
const assert = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};

try {
  const makeInventory = (label) => {
    const dir = join(root, label);
    const dest = join(root, `${label}-archive`);
    mkdirSync(dir);
    const paths = ["a", "b", "c"].map((stem) => join(dir, `${stem}${extension}`));
    for (const path of paths) copyFileSync(fixture, path);
    const hash = sha256(paths[0]);
    return {
      dir,
      dest,
      paths,
      hash,
      args: {
        dir,
        dest,
        cases: paths.slice(0, 2).map((path) => ({ name: basename(path), expectedSha256: hash })),
        expectedRemaining: [{ name: basename(paths[2]), expectedSha256: hash }],
      },
    };
  };

  const happy = makeInventory("happy");
  const happyResult = callWorker(happy.args);
  assert(happyResult.ok === true && happyResult.archived === 2, "Happy path meldet nicht zwei archivierte Faelle");
  assert(!existsSync(happy.paths[0]) && !existsSync(happy.paths[1]), "Archivierte Quellen sind noch aktiv");
  assert(sha256(join(happy.dest, basename(happy.paths[0]))) === happy.hash, "Erster Archivhash stimmt nicht");
  assert(sha256(join(happy.dest, basename(happy.paths[1]))) === happy.hash, "Zweiter Archivhash stimmt nicht");
  assert(sha256(happy.paths[2]) === happy.hash, "Restfall wurde veraendert");
  assert(existsSync(join(happy.dest, "pruefsummen.csv")), "Pruefsummenmanifest fehlt");

  const rollback = makeInventory("rollback");
  const rollbackResult = callWorker(rollback.args, "archive-after-first-move");
  assert(rollbackResult.ok === false && rollbackResult.kind === "postcondition-failed", "Testfehler ergab nicht postcondition-failed");
  assert(rollbackResult.rolledBack === true, "Rollback wurde nicht als vollstaendig verifiziert");
  assert(rollbackResult.movedBeforeFailure === 1, "Testfehler trat nicht nach exakt einer Bewegung ein");
  assert(rollback.paths.every((path) => sha256(path) === rollback.hash), "Mindestens eine Quelldatei wurde nicht hashgleich wiederhergestellt");
  assert(!existsSync(rollback.dest), "Archivordner blieb nach vollstaendigem Rollback bestehen");
  assert(rollbackResult.rollbackFiles?.every((entry) => entry.restored === true), "Per-file-Rollbackstatus ist nicht vollstaendig gruen");

  const unknownDir = join(root, "unknown");
  const unknownDest = join(root, "unknown-archive");
  mkdirSync(unknownDir);
  const unknown = join(unknownDir, `unknown${extension}`);
  const keep = join(unknownDir, `keep${extension}`);
  writeFileSync(unknown, "synthetisch und absichtlich kein gueltiger Steuerfall", "utf8");
  copyFileSync(fixture, keep);
  const unknownResult = callWorker({
    dir: unknownDir,
    dest: unknownDest,
    cases: [{ name: basename(unknown), expectedSha256: sha256(unknown) }],
    expectedRemaining: [{ name: basename(keep), expectedSha256: sha256(keep) }],
  });
  assert(unknownResult.ok === false && unknownResult.kind === "blocked", "Unlesbarer Uebermittlungsstatus wurde nicht blockiert");
  assert(existsSync(unknown) && !existsSync(unknownDest), "Blockierte Datei wurde trotzdem bewegt");

  process.stdout.write(`OK: ${checks} Archivierungs- und Rollback-Pruefungen; Fixture=${basename(fixture)}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
