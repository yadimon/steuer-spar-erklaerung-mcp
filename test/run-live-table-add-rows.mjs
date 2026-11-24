/**
 * Eigenstaendiger Runner fuer den Livebeweis der Mehrzeilenanlage
 * (test/live-table-add-rows.mjs).
 *
 * Sichtbarer Desktop, keine laufende SSE. Die Wegwerfkopie des offiziellen
 * Musterfalls wird einmal auf die profilierte Tabellenseite gestellt; die
 * Reise speichert sie danach mit voller Absicht - der Hashwechsel gehoert zum
 * Beweis, waehrend der Musterfall byteidentisch bleiben muss. Mit --write
 * werden die Live-Ledger (Abdeckung und Ergebnisformen) bewusst uebernommen;
 * ohne --write wird nur ausgefuehrt und geprueft.
 *
 * Aufruf: npm run test:live-table-add-rows [-- --write]
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { loadProductProfile } from "../dist/product-profiles.js";
import { ssePids } from "./direct-worker-helpers.mjs";
import { OPERATION_TRACE_DIRECTORY_KEY, operationTraceDirectory } from "./operation-trace.mjs";

if (process.platform !== "win32") throw new Error("Der Livebeweis der Mehrzeilenanlage benoetigt Windows.");

const root = resolve(process.cwd());
const STEUERTIPPS_ROOT = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung";
const writeLedgers = process.argv.includes("--write");
const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
assert.equal(profile.status, "supported",
  `Die Mehrzeilenanlage laeuft nur gegen ein voll unterstuetztes Profil; '${profileId}' ist '${profile.status}'.`);
assert.equal(profile.operationAccess, "full",
  `Die Mehrzeilenanlage braucht den vollen Operationszugriff des Profils '${profileId}'.`);

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
const definition = expectations.cases.find((entry) => entry.mode === "einur");
assert(definition, `Profil ${profileId} nennt keinen Gewinnermittlungs-Musterfall.`);
const source = join(
  STEUERTIPPS_ROOT, profile.executable.installationFolderName, expectations.musterDirRelative, definition.file,
);
assert(existsSync(source), `Offizieller Musterfall fehlt: ${source}`);
const sourceHash = sha256(source);

assert.equal(ssePids(), "", "Der Livebeweis startet nur ohne vorhandene SSE-Prozesse.");

const directory = mkdtempSync(join(tmpdir(), `sse-table-add-rows-${profileId}-`));
const copy = join(directory, `mehrzeilenanlage${extname(source)}`);
copyFileSync(source, copy);
const copyHash = sha256(copy);
// A full live suite owns its aggregate trace. A standalone invocation owns
// a separate trace and may remove it after successful verification.
const inheritedTraceDirectory = operationTraceDirectory();
const traceDirectory = inheritedTraceDirectory || mkdtempSync(join(tmpdir(), "sse-table-add-rows-trace-"));

function runNode(label, args, env) {
  process.stdout.write(`\n> ${label} (${profileId})\n`);
  const run = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true });
  if (run.error) throw new Error(`${label} konnte nicht laufen: ${run.error.message}`, { cause: run.error });
  assert.equal(run.status, 0, `${label} scheiterte mit Exit ${run.status}.`);
}
function runStep(label, script, fixtureVariable) {
  runNode(label, ["test/with-api.mjs", process.execPath, script], {
    SSE_PROFILE_ID: profileId, SSE_CASE_DIR: directory, [fixtureVariable]: copy,
    [OPERATION_TRACE_DIRECTORY_KEY]: traceDirectory,
  });
  assert.equal(ssePids(), "", `Nach ${label}: verbliebene SSE-Prozesse.`);
  assert.equal(sha256(source), sourceHash, `${label}: der offizielle Musterfall wurde veraendert.`);
}

let completed = false;
try {
  runStep("Wegwerfvorlage positionieren", "test/position-case.mjs", "SSE_POSITION_FIXTURE");
  const positionedHash = sha256(copy);
  assert.notEqual(positionedHash, copyHash, "Die Positionierung hat nichts gespeichert.");

  runStep("Mehrzeilenanlage", "test/live-table-add-rows.mjs", "SSE_ROWS_FIXTURE");
  assert.notEqual(sha256(copy), positionedHash,
    "Die Mehrzeilenanlage hat ihre Kopie nie gespeichert; der Speicherbeweis fehlt.");

  const ledgerEnv = {
    SSE_TEST_COVERAGE_SCOPE: "live",
    [OPERATION_TRACE_DIRECTORY_KEY]: traceDirectory,
    ...(writeLedgers ? { SSE_WRITE_OPERATION_COVERAGE: "1", SSE_WRITE_OPERATION_SHAPE: "1" } : {}),
  };
  if (writeLedgers) {
    runNode("Live-Abdeckungsbilanz uebernehmen", ["test/operation-coverage-contract.mjs"], ledgerEnv);
    runNode("Live-Ergebnisform-Bilanz uebernehmen", ["test/operation-result-shape-contract.mjs"], ledgerEnv);
  }
  completed = true;
} finally {
  if (completed) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (!inheritedTraceDirectory) rmSync(traceDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } else {
    process.stderr.write(`Fixture und Trace zur Diagnose erhalten: ${directory} / ${traceDirectory}\n`);
  }
}

process.stdout.write("\nMehrzeilenanlage: bestanden, Musterfall unveraendert, keine SSE-Instanz verblieben.\n");
