import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadProductProfile } from "../dist/product-profiles.js";
import { ssePids } from "./direct-worker-helpers.mjs";
import { OPERATION_TRACE_DIRECTORY_KEY } from "./operation-trace.mjs";

if (process.platform !== "win32") throw new Error("Der SSE-Live-Runner benoetigt Windows.");

const root = resolve(process.cwd());
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const assertNoSse = (phase) => {
  const pids = ssePids();
  assert.equal(pids, "", `${phase}: Bereits laufende oder zurueckgebliebene SSE-Prozesse (${pids}). Nicht uebernehmen oder blind beenden.`);
};

function runProfile(profileId) {
  const env = { ...process.env, SSE_PROFILE_ID: profileId };
  delete env.SSE_LIVE_MUSTER_CASES;
  if (profileId === "2024") env.SSE_OPERATE_EXPERIMENTAL = "1";
  else delete env.SSE_OPERATE_EXPERIMENTAL;

  process.stdout.write(`\n> Striktes Live-Musterprofil ${profileId}\n`);
  const run = spawnSync(
    process.execPath,
    ["test/with-api.mjs", process.execPath, "test/live-muster-cases.mjs"],
    { cwd: root, env, stdio: "inherit", windowsHide: true },
  );
  const leakedPids = ssePids();
  const leakSuffix = leakedPids
    ? `; verbleibende SSE-Prozesse: ${leakedPids} (nicht blind beenden)`
    : "";
  if (run.error) {
    throw new Error(`Live-Musterprofil ${profileId} konnte nicht ausgefuehrt werden: ${run.error.message}${leakSuffix}`,
      { cause: run.error });
  }
  assert.equal(run.signal, null, `Live-Musterprofil ${profileId} endete mit Signal ${run.signal}${leakSuffix}.`);
  assert.equal(run.status, 0, `Live-Musterprofil ${profileId} scheiterte mit Exit ${run.status}${leakSuffix}.`);
  assert.equal(leakedPids, "", `Nach Live-Musterprofil ${profileId}: verbliebene SSE-Prozesse (${leakedPids}). Nicht blind beenden.`);
}

/**
 * Der profilierte Focusless-Commit ist der einzige Schreibweg mit echter
 * Live-Evidenz. Er laeuft auf einem privaten Desktop und verwirft am Ende.
 *
 * Er braucht eine ausdrueckliche Fixture: Auf dem privaten Desktop ist ein
 * echter Mausklick technisch ausgeschlossen, also bleibt nur der lineare
 * Blaetterweg - und der offizielle Musterfall oeffnet auf einer Seite, von der
 * aus 'Weiter' gar nicht angeboten wird. Ohne `SSE_FOCUSLESS_FIXTURE` bleibt
 * der Schreibweg deshalb ungeprueft; das ist kein stiller SKIP, sondern steht
 * so in der Live-Spalte der Abdeckungsbilanz.
 */
function runFocuslessCommit(profileId) {
  const profile = loadProductProfile(profileId);
  const catalog = JSON.parse(readFileSync(profile.pageObjectsPath, "utf8"));
  if (!Object.keys(catalog.focuslessCommits ?? {}).length) {
    assert.notEqual(
      `${profile.status}/${profile.operationAccess}`,
      "supported/full",
      `Profil ${profileId} ist voll freigegeben, nennt aber keinen profilierten Schreibweg.`,
    );
    process.stdout.write(`\n> Profil ${profileId} kennt keinen profilierten Schreibweg; Mutationen bleiben gesperrt\n`);
    return;
  }

  const fixture = process.env.SSE_FOCUSLESS_FIXTURE;
  if (!fixture) {
    process.stdout.write(
      `\n> Profil ${profileId}: kein SSE_FOCUSLESS_FIXTURE gesetzt; der profilierte Schreibweg bleibt ` +
      "in der Abdeckungsbilanz als live ungeprueft ausgewiesen\n",
    );
    return;
  }
  assert(existsSync(fixture), `SSE_FOCUSLESS_FIXTURE zeigt auf keine vorhandene Datei: ${fixture}`);
  const fixtureHash = sha256(fixture);

  process.stdout.write(`\n> Profilierter Focusless-Schreibweg ${profileId}\n`);
  const run = spawnSync(
    process.execPath,
    ["test/with-api.mjs", process.execPath, "test/hidden-wm-char-transaction.mjs"],
    {
      cwd: root,
      env: { ...process.env, SSE_PROFILE_ID: profileId, SSE_FOCUSLESS_FIXTURE: fixture },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const leakedPids = ssePids();
  if (run.error) {
    throw new Error(`Focusless-Schreibweg ${profileId} konnte nicht ausgefuehrt werden: ${run.error.message}`,
      { cause: run.error });
  }
  assert.equal(run.status, 0, `Focusless-Schreibweg ${profileId} scheiterte mit Exit ${run.status}.`);
  assert.equal(leakedPids, "", `Nach dem Focusless-Schreibweg ${profileId}: verbliebene SSE-Prozesse (${leakedPids}).`);
  assert.equal(sha256(fixture), fixtureHash, `Die Focusless-Fixture von ${profileId} wurde veraendert.`);
}

/** Die dokumentierte Live-Abdeckung wird bewiesen statt behauptet. */
function assertLiveCoverageLedger() {
  process.stdout.write("\n> Live-Abdeckungsbilanz\n");
  const ledger = spawnSync(
    process.execPath,
    ["test/operation-coverage-contract.mjs"],
    {
      cwd: root,
      env: { ...process.env, SSE_TEST_COVERAGE_SCOPE: "live" },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (ledger.error) {
    throw new Error(`Live-Abdeckungsbilanz konnte nicht laufen: ${ledger.error.message}`, { cause: ledger.error });
  }
  assert.equal(ledger.status, 0, `Live-Abdeckungsbilanz scheiterte mit Exit ${ledger.status}.`);
}

assertNoSse("Vor dem Live-Gate");
// Beide Profillaeufe schreiben in dasselbe Verzeichnis; die Bilanz prueft
// danach, welche Operationen die echte Anwendung wirklich bedient hat.
const traceDirectory = mkdtempSync(join(tmpdir(), "sse-live-trace-"));
process.env[OPERATION_TRACE_DIRECTORY_KEY] = traceDirectory;
try {
  for (const profileId of ["2025", "2024"]) {
    runProfile(profileId);
    runFocuslessCommit(profileId);
  }
  assertLiveCoverageLedger();
} finally {
  rmSync(traceDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

process.stdout.write("\nStriktes Live-Gate: 2025 und 2024 ohne SKIP und ohne verbleibende SSE-Instanz bestanden\n");
