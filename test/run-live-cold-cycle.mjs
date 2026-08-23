/**
 * Eigenstaendiger Runner fuer den kalten Feldzyklus.
 *
 * Bewusst OHNE vorherige Positionierung: der Zyklus soll genau den Zustand
 * treffen, den ein Nutzer beim ersten Start hat. Die Wegwerfkopie muss danach
 * byteidentisch sein, denn der Zyklus dreht jede Aenderung zurueck und
 * schliesst ohne zu speichern.
 *
 * Aufruf: npm run test:live-cold-cycle   (Profil ueber SSE_PROFILE_ID, Vorgabe 2025)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { loadProductProfile } from "../dist/product-profiles.js";
import { ssePids } from "./direct-worker-helpers.mjs";

if (process.platform !== "win32") throw new Error("Der kalte Feldzyklus benoetigt Windows.");

const root = resolve(process.cwd());
const STEUERTIPPS_ROOT = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung";
const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
assert.equal(profile.status, "supported",
  `Der kalte Feldzyklus laeuft nur gegen ein voll unterstuetztes Profil; '${profileId}' ist '${profile.status}'.`);
assert.equal(profile.operationAccess, "full",
  `Der kalte Feldzyklus braucht den vollen Operationszugriff des Profils '${profileId}'.`);

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();

const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
const definition = expectations.cases.find((entry) => entry.coldFieldCycle);
assert(definition, `Profil ${profileId} nennt keinen Musterfall mit coldFieldCycle.`);
const source = join(
  STEUERTIPPS_ROOT,
  profile.executable.installationFolderName,
  expectations.musterDirRelative,
  definition.file,
);
assert(existsSync(source), `Offizieller Musterfall fehlt: ${source}`);
const sourceHash = sha256(source);

assert.equal(ssePids(), "", "Der kalte Feldzyklus startet nur ohne vorhandene SSE-Prozesse.");

const directory = mkdtempSync(join(tmpdir(), `sse-cold-${profileId}-`));
const copy = join(directory, `kaltzyklus${extname(source)}`);
copyFileSync(source, copy);
const copyHash = sha256(copy);

let completed = false;
try {
  process.stdout.write(`\n> Kalter Feldzyklus (${profileId})\n`);
  const run = spawnSync(
    process.execPath,
    ["test/with-api.mjs", process.execPath, "test/live-cold-field-cycle.mjs"],
    {
      cwd: root,
      env: { ...process.env, SSE_PROFILE_ID: profileId, SSE_CASE_DIR: directory, SSE_COLD_FIXTURE: copy },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (run.error) throw new Error(`Kalter Feldzyklus konnte nicht laufen: ${run.error.message}`, { cause: run.error });
  assert.equal(run.status, 0, `Kalter Feldzyklus scheiterte mit Exit ${run.status}.`);
  assert.equal(ssePids(), "", "Nach dem kalten Feldzyklus: verbliebene SSE-Prozesse.");
  assert.equal(sha256(source), sourceHash, "Der offizielle Musterfall wurde veraendert.");
  assert.equal(sha256(copy), copyHash,
    "Die Wegwerfkopie hat sich veraendert; der Zyklus darf nichts speichern.");
  completed = true;
} finally {
  if (completed) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } else {
    process.stderr.write(`Kaltzyklus-Fixture zur Diagnose erhalten: ${directory}\n`);
  }
}

process.stdout.write("\nKalter Feldzyklus: bestanden, Kopie byteidentisch, keine SSE-Instanz verblieben.\n");
