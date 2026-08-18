import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { listCaseFiles, readCaseFileInfo } from "../dist/case-file.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { callWorker } from "../dist/worker.js";

if (process.platform !== "win32") throw new Error("Der Fallhash-Livevergleich benoetigt Windows.");
const profile = loadProductProfile(process.env.SSE_PROFILE_ID ?? "2025");
const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
const definition = expectations.cases.find((entry) => entry.mode === "einur");
assert(definition, `Profil ${profile.id} nennt keinen Gewinnermittlungs-Musterfall.`);
const musterDir = join(
  "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung",
  profile.executable.installationFolderName,
  expectations.musterDirRelative,
);
const casePath = join(musterDir, definition.file);
assert(existsSync(casePath), `Offizieller Musterfall fehlt: ${casePath}`);

const localStarted = performance.now();
const local = await readCaseFileInfo(casePath, profile);
const localMs = Math.round(performance.now() - localStarted);
const workerStarted = performance.now();
const worker = await callWorker("case_hash", { path: casePath }, 30_000);
const workerMs = Math.round(performance.now() - workerStarted);
assert.equal(worker.ok, true, worker.error);

for (const field of ["path", "exists", "size", "mtimeUtc", "sha256", "header", "transmitted", "transmittedReason"]) {
  assert.deepEqual(local[field], worker[field], `${profile.id}: lokaler und PowerShell-Fallhash unterscheiden sich bei '${field}'.`);
}
process.stdout.write(
  `${profile.id}-Fallhash-Paritaet: 8 Felder identisch; lokal ${localMs} ms, PowerShell ${workerMs} ms.\n`,
);

const localListStarted = performance.now();
const localList = await listCaseFiles(musterDir, profile);
const localListMs = Math.round(performance.now() - localListStarted);
const workerListStarted = performance.now();
const workerList = await callWorker("list_cases", { dir: musterDir }, 30_000);
const workerListMs = Math.round(performance.now() - workerListStarted);
assert.equal(workerList.ok, true, workerList.error);

assert.equal(localList.dir, workerList.dir, `${profile.id}: Falllisten-Verzeichnis unterscheidet sich.`);
assert.equal(localList.count, workerList.count, `${profile.id}: Falllisten-Anzahl unterscheidet sich.`);
assert.equal(localList.parserError ?? null, workerList.parserError ?? null, `${profile.id}: Parserstatus unterscheidet sich.`);
assert.deepEqual(
  localList.cases,
  workerList.cases,
  `${profile.id}: lokale und PowerShell-Fallliste unterscheiden sich.`,
);
process.stdout.write(
  `${profile.id}-Falllisten-Paritaet: ${localList.count} Faelle identisch; lokal ${localListMs} ms, ` +
    `PowerShell ${workerListMs} ms.\n`,
);
