/**
 * Eigenstaendiger Runner fuer die Zustandsreise (test/live-state-journey.mjs).
 *
 * Wie bei der grossen Schreibreise wird die Wegwerfkopie einmal sichtbar auf
 * die profilierte Tabellenseite gestellt. Danach darf sich die Datei nicht mehr
 * aendern: die Reise legt an und loescht wieder, speichert aber nie.
 *
 * Aufruf: npm run test:live-state   (Profil ueber SSE_PROFILE_ID, Vorgabe 2025)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { loadProductProfile } from "../dist/product-profiles.js";
import { ssePids } from "./direct-worker-helpers.mjs";

if (process.platform !== "win32") throw new Error("Die Zustandsreise benoetigt Windows.");

const root = resolve(process.cwd());
const STEUERTIPPS_ROOT = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung";
const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
assert.equal(profile.status, "supported",
  `Die Zustandsreise laeuft nur gegen ein voll unterstuetztes Profil; '${profileId}' ist '${profile.status}'.`);
assert.equal(profile.operationAccess, "full",
  `Die Zustandsreise braucht den vollen Operationszugriff des Profils '${profileId}'.`);

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();

const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
const definition = expectations.cases.find((entry) => entry.mode === "einur");
assert(definition, `Profil ${profileId} nennt keinen Gewinnermittlungs-Musterfall.`);
const source = join(
  STEUERTIPPS_ROOT, profile.executable.installationFolderName, expectations.musterDirRelative, definition.file,
);
assert(existsSync(source), `Offizieller Musterfall fehlt: ${source}`);
const sourceHash = sha256(source);

assert.equal(ssePids(), "", "Die Zustandsreise startet nur ohne vorhandene SSE-Prozesse.");

const directory = mkdtempSync(join(tmpdir(), `sse-state-${profileId}-`));
const copy = join(directory, `zustandsreise${extname(source)}`);
copyFileSync(source, copy);
const copyHash = sha256(copy);

function runStep(label, script, fixtureVariable) {
  process.stdout.write(`\n> ${label} (${profileId})\n`);
  const run = spawnSync(
    process.execPath,
    ["test/with-api.mjs", process.execPath, script],
    {
      cwd: root,
      env: { ...process.env, SSE_PROFILE_ID: profileId, SSE_CASE_DIR: directory, [fixtureVariable]: copy },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (run.error) throw new Error(`${label} konnte nicht laufen: ${run.error.message}`, { cause: run.error });
  assert.equal(run.status, 0, `${label} scheiterte mit Exit ${run.status}.`);
  assert.equal(ssePids(), "", `Nach ${label}: verbliebene SSE-Prozesse.`);
  assert.equal(sha256(source), sourceHash, `${label}: der offizielle Musterfall wurde veraendert.`);
}

let completed = false;
try {
  runStep("Wegwerfvorlage positionieren", "test/position-case.mjs", "SSE_POSITION_FIXTURE");
  const positionedHash = sha256(copy);
  assert.notEqual(positionedHash, copyHash, "Die Positionierung hat nichts gespeichert.");

  runStep("Zustandsreise", "test/live-state-journey.mjs", "SSE_STATE_FIXTURE");
  assert.equal(sha256(copy), positionedHash,
    "Die Zustandsreise hat die Kopie veraendert; sie legt an und loescht wieder, speichert aber nie.");
  completed = true;
} finally {
  if (completed) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } else {
    process.stderr.write(`Zustandsreise-Fixture zur Diagnose erhalten: ${directory}\n`);
  }
}

process.stdout.write("\nZustandsreise: bestanden, Kopie unveraendert, keine SSE-Instanz verblieben.\n");
