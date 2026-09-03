/**
 * Eigenstaendiger Runner fuer den Livebeweis der Fallanlage.
 *
 * Sichtbarer Desktop, keine laufende SSE, frischer Fallordner. Mit --write
 * werden die Live-Ledger (Abdeckung und Ergebnisformen) bewusst uebernommen;
 * ohne --write wird nur ausgefuehrt und geprueft.
 *
 * Aufruf: npm run test:live-case-create [-- --write]
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadProductProfile } from "../dist/product-profiles.js";
import { ssePids } from "./direct-worker-helpers.mjs";
import { OPERATION_TRACE_DIRECTORY_KEY } from "./operation-trace.mjs";

if (process.platform !== "win32") throw new Error("Der Livebeweis der Fallanlage benoetigt Windows.");

const root = resolve(process.cwd());
const writeLedgers = process.argv.includes("--write");
const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
assert.equal(profile.status, "supported", `Die Fallanlage laeuft nur gegen ein voll unterstuetztes Profil; '${profileId}' ist '${profile.status}'.`);
assert.deepEqual(profile.additionalCaseYears?.einurvor, [profile.taxYear + 1],
  "Das Profil muss genau das Folgejahr fuer die Gewinn-Erfassung freigeben.");

function assertNoRecoveryFile(phase) {
  const directory = join(process.env.LOCALAPPDATA ?? "", "Steuertipps", "SSE", String(profile.engineFileMajor));
  if (!existsSync(directory)) return;
  const leftovers = readdirSync(directory).filter((name) => name.startsWith("Wiederhergestellt-"));
  assert.deepEqual(leftovers, [],
    `${phase} hat eine Wiederherstellungsdatei hinterlassen: ${leftovers.join(", ")} in ${directory}. ` +
    "Inhalt pruefen und bewusst verwerfen, nicht blind loeschen.");
}

function runNode(label, args, env) {
  process.stdout.write(`\n> ${label}\n`);
  const run = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true });
  if (run.error) throw new Error(`${label} konnte nicht laufen: ${run.error.message}`, { cause: run.error });
  assert.equal(run.status, 0, `${label} scheiterte mit Exit ${run.status}.`);
}

assert.equal(ssePids(), "", "Der Livebeweis startet nur ohne vorhandene SSE-Prozesse.");
assertNoRecoveryFile("Der Zustand vor der Fallanlage");

const caseDir = mkdtempSync(join(tmpdir(), `sse-case-create-${profileId}-`));
const traceDirectory = mkdtempSync(join(tmpdir(), "sse-case-create-trace-"));
let completed = false;
try {
  runNode(`Live case_create (${profileId})`, ["test/with-api.mjs", process.execPath, "test/live-case-create.mjs"], {
    SSE_PROFILE_ID: profileId,
    SSE_CASE_DIR: caseDir,
    [OPERATION_TRACE_DIRECTORY_KEY]: traceDirectory,
  });
  assert.equal(ssePids(), "", "Nach der Fallanlage: verbliebene SSE-Prozesse.");
  assertNoRecoveryFile("Die Fallanlage");
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
    rmSync(caseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(traceDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } else {
    process.stderr.write(`Fallordner und Trace zur Diagnose erhalten: ${caseDir} / ${traceDirectory}\n`);
  }
}

process.stdout.write(`\nLive case_create: bestanden${writeLedgers ? ", Live-Ledger uebernommen" : ""}, keine SSE-Instanz verblieben.\n`);
