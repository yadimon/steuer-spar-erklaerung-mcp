/**
 * Echte, fallunveraendernde Kern-Leseevidenz fuer beide Jahresprofile.
 *
 * Der strikte Volltest bleibt die einzige Aussage ueber Navigation, UStVA,
 * Pruefer und den profilierten Schreibweg. Dieser Runner ist bewusst davon
 * getrennt: Er prueft die Lesevertraege, die auf der vom offiziellen
 * Musterfall geoeffneten Seite ohne physischen UI-Zweigwechsel moeglich sind.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ssePids } from "./direct-worker-helpers.mjs";

if (process.platform !== "win32") throw new Error("Der SSE-Core-Live-Runner benoetigt Windows.");

const root = resolve(process.cwd());

function assertNoSse(phase) {
  const pids = ssePids();
  assert.equal(pids, "", `${phase}: Bereits laufende oder zurueckgebliebene SSE-Prozesse (${pids}). Nicht uebernehmen oder blind beenden.`);
}

function runProfile(profileId) {
  const env = {
    ...process.env,
    SSE_PROFILE_ID: profileId,
    SSE_LIVE_MUSTER_MODE: "core-read",
    SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE: "1",
  };
  for (const key of ["SSE_LIVE_MUSTER_CASES", "SSE_MUSTER_DIR", "SSE_TEST_CASE_DIR", "SSE_CASE_DIR"]) delete env[key];
  if (profileId === "2024") env.SSE_OPERATE_EXPERIMENTAL = "1";
  else delete env.SSE_OPERATE_EXPERIMENTAL;

  process.stdout.write(`\n> Core-Read-Live-Musterprofil ${profileId}\n`);
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
    throw new Error(`Core-Read-Profil ${profileId} konnte nicht ausgefuehrt werden: ${run.error.message}${leakSuffix}`,
      { cause: run.error });
  }
  assert.equal(run.signal, null, `Core-Read-Profil ${profileId} endete mit Signal ${run.signal}${leakSuffix}.`);
  assert.equal(run.status, 0, `Core-Read-Profil ${profileId} scheiterte mit Exit ${run.status}${leakSuffix}.`);
  assert.equal(leakedPids, "", `Nach Core-Read-Profil ${profileId}: verbliebene SSE-Prozesse (${leakedPids}). Nicht blind beenden.`);
}

assertNoSse("Vor dem Core-Read-Live-Gate");
for (const profileId of ["2025", "2024"]) runProfile(profileId);
process.stdout.write("\nCore-Read-Live-Gate: 2025 und 2024 ohne Steuerfalldatenmutation und ohne verbleibende SSE-Instanz bestanden\n");
