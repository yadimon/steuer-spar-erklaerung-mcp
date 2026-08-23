import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { loadProductProfile } from "../dist/product-profiles.js";
import { createProfileOperationMatrix } from "../dist/profile-operation-policy.js";
import { SSE_DESTRUCTIVE_OPERATIONS } from "../dist/operation-traits.js";
import { ssePids } from "./direct-worker-helpers.mjs";
import { OPERATION_TRACE_DIRECTORY_KEY } from "./operation-trace.mjs";

if (process.platform !== "win32") throw new Error("Der SSE-Live-Runner benoetigt Windows.");

const root = resolve(process.cwd());
const STEUERTIPPS_ROOT = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung";
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const assertNoSse = (phase) => {
  const pids = ssePids();
  assert.equal(pids, "", `${phase}: Bereits laufende oder zurueckgebliebene SSE-Prozesse (${pids}). Nicht uebernehmen oder blind beenden.`);
};

function runProfile(profileId) {
  const env = { ...process.env, SSE_PROFILE_ID: profileId, SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE: "1" };
  delete env.SSE_LIVE_MUSTER_CASES;
  // Der Live-Runner darf weder fremde Musterdateien noch einen von einem
  // vorherigen Profil geerbten Fallbereich verwenden. with-api erzeugt pro
  // Profil seine eigenen Testbereiche und reicht sie explizit weiter.
  delete env.SSE_MUSTER_DIR;
  delete env.SSE_TEST_CASE_DIR;
  delete env.SSE_CASE_DIR;
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

function runCenterCoverage() {
  process.stdout.write("\n> Steuertipps-Center auf privatem Desktop (2025)\n");
  const run = spawnSync(
    process.execPath,
    ["test/run-live-center.mjs"],
    { cwd: root, env: { ...process.env }, stdio: "inherit", windowsHide: true },
  );
  if (run.error) throw new Error(`Center-Livevertrag konnte nicht laufen: ${run.error.message}`, { cause: run.error });
  assert.equal(run.signal, null, `Center-Livevertrag endete mit Signal ${run.signal}.`);
  assert.equal(run.status, 0, `Center-Livevertrag scheiterte mit Exit ${run.status}.`);
}

function assertCaseFileParity(profileId) {
  process.stdout.write(`\n> ${profileId}-Fallhash-Paritaet\n`);
  const env = { ...process.env, SSE_PROFILE_ID: profileId };
  for (const key of ["SSE_LIVE_MUSTER_CASES", "SSE_MUSTER_DIR", "SSE_TEST_CASE_DIR", "SSE_CASE_DIR"]) delete env[key];
  const check = spawnSync(
    process.execPath,
    ["test/case-file-live-parity.mjs"],
    {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (check.error) {
    throw new Error(`${profileId}-Fallhash-Paritaet konnte nicht laufen: ${check.error.message}`, { cause: check.error });
  }
  assert.equal(check.signal, null, `${profileId}-Fallhash-Paritaet endete mit Signal ${check.signal}.`);
  assert.equal(check.status, 0, `${profileId}-Fallhash-Paritaet scheiterte mit Exit ${check.status}.`);
}

/**
 * Legt eine Wegwerfkopie des offiziellen Gewinnermittlungs-Musterfalls an.
 *
 * Die vorhandenen Einzeltransaktionstests erwarten alle dieselbe Sache: eine
 * neutrale `.Gew2025`-Kopie, die sie oeffnen, veraendern und wieder verwerfen
 * duerfen. Genau die stellt das Gate hier selbst her, statt sie von aussen zu
 * verlangen - deshalb koennen diese Tests ueberhaupt verbindlich laufen.
 */
function officialSampleCase(profileId) {
  const profile = loadProductProfile(profileId);
  const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
  const definition = expectations.cases.find((entry) => entry.mode === "einur");
  assert(definition, `Profil ${profileId} nennt keinen Gewinnermittlungs-Musterfall.`);
  const source = join(
    STEUERTIPPS_ROOT,
    profile.executable.installationFolderName,
    expectations.musterDirRelative,
    definition.file,
  );
  assert(existsSync(source), `Offizieller Musterfall fehlt: ${source}`);
  return source;
}

function provisionDisposableCase(profileId, template = officialSampleCase(profileId)) {
  const source = officialSampleCase(profileId);
  const directory = mkdtempSync(join(tmpdir(), `sse-live-fixture-${profileId}-`));
  const copy = join(directory, `wegwerfkopie${extname(source)}`);
  copyFileSync(template, copy);
  return { directory, copy, source, sourceHash: sha256(source), copyHash: sha256(copy) };
}

/**
 * Kalter Lese-/Aenderungs-/Lese-Zyklus auf einem gewoehnlichen Steuerfeld.
 *
 * Bewusst VOR dem Positionieren und auf einer eigenen frischen Kopie: Er soll
 * genau den Zustand treffen, in dem ein Nutzer die Anwendung zum ersten Mal
 * startet. Alles andere in diesem Gate laeuft auf einer vorpositionierten
 * Vorlage in einer bereits warmen Anwendung - und genau dort blieben die
 * Fehler unsichtbar, die den einzigen erlaubten Feldschreibweg blockierten.
 * Die Kopie muss danach byteidentisch sein; der Zyklus speichert nie.
 */
function runColdFieldCycle(profileId) {
  const profile = loadProductProfile(profileId);
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
  // Eigene Kopie statt provisionDisposableCase: das baut den Dateinamen immer
  // aus dem Gewinnermittlungs-Musterfall, und eine ESt-Datei unter .Gew2025
  // weist die Startmodus-Pruefung zu Recht ab.
  const sourceHash = sha256(source);
  const directory = mkdtempSync(join(tmpdir(), `sse-cold-${profileId}-`));
  const copy = join(directory, `kaltzyklus${extname(source)}`);
  copyFileSync(source, copy);
  const fixture = { directory, copy, sourceHash, copyHash: sha256(copy) };
  process.stdout.write(`\n> Kalter Feldzyklus (${profileId})\n`);
  try {
    const run = spawnSync(
      process.execPath,
      ["test/with-api.mjs", process.execPath, "test/live-cold-field-cycle.mjs"],
      {
        cwd: root,
        env: {
          ...process.env,
          SSE_PROFILE_ID: profileId,
          SSE_CASE_DIR: fixture.directory,
          SSE_COLD_FIXTURE: fixture.copy,
        },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    const leakedPids = ssePids();
    if (run.error) {
      throw new Error(`Kalter Feldzyklus (${profileId}) konnte nicht ausgefuehrt werden: ${run.error.message}`,
        { cause: run.error });
    }
    assert.equal(run.status, 0, `Kalter Feldzyklus (${profileId}) scheiterte mit Exit ${run.status}.`);
    assert.equal(leakedPids, "", `Nach dem kalten Feldzyklus (${profileId}): verbliebene SSE-Prozesse (${leakedPids}).`);
    assert.equal(sha256(source), fixture.sourceHash, `Kalter Feldzyklus (${profileId}): Musterfall veraendert.`);
    assert.equal(sha256(fixture.copy), fixture.copyHash,
      `Kalter Feldzyklus (${profileId}): die Kopie hat sich veraendert, es darf aber nichts gespeichert werden.`);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Stellt die Vorlage einmalig auf die profilierte Formularseite.
 *
 * Gemessen am Herstellermusterfall: Er oeffnet auf einer Uebersichtsseite ohne
 * 'Weiter'; weder Invoke auf 'Jetzt beginnen' noch linear Blaettern kommt von
 * dort weg, nur ein echter Klick in den Navigationsbaum - und der ist auf dem
 * privaten Desktop ausgeschlossen. Einmal sichtbar positionieren und speichern
 * loest das fuer alle folgenden Laeufe, weil die Anwendung sich die Seite in
 * der Datei merkt.
 */
function positionTemplate(profileId, fixture) {
  process.stdout.write(`\n> Wegwerfvorlage positionieren (${profileId})\n`);
  const run = spawnSync(
    process.execPath,
    ["test/with-api.mjs", process.execPath, "test/position-case.mjs"],
    {
      cwd: root,
      env: {
        ...process.env,
        SSE_PROFILE_ID: profileId,
        SSE_CASE_DIR: fixture.directory,
        SSE_POSITION_FIXTURE: fixture.copy,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (run.error) {
    throw new Error(`Positionierung (${profileId}) konnte nicht laufen: ${run.error.message}`, { cause: run.error });
  }
  assert.equal(run.status, 0, `Positionierung (${profileId}) scheiterte mit Exit ${run.status}.`);
  assert.equal(ssePids(), "", `Nach der Positionierung (${profileId}): verbliebene SSE-Prozesse.`);
  assert.notEqual(sha256(fixture.copy), fixture.copyHash, "Die Positionierung hat nichts gespeichert.");
  assert.equal(sha256(fixture.source), fixture.sourceHash, "Die Positionierung hat den Musterfall veraendert.");
}

/**
 * Faehrt einen Einzeltransaktionstest gegen eine frische Kopie der bereits
 * positionierten Vorlage. Die Tests pruefen selbst, dass sie ihre Kopie
 * unveraendert hinterlassen; das Gate prueft zusaetzlich den Musterfall und
 * die Prozessliste.
 */
function runFixtureScript(profileId, { label, script, fixtureVariable }, template) {
  const fixture = provisionDisposableCase(profileId, template);
  process.stdout.write(`\n> ${label} (${profileId})\n`);
  try {
    const run = spawnSync(
      process.execPath,
      ["test/with-api.mjs", process.execPath, script],
      {
        cwd: root,
        env: {
          ...process.env,
          SSE_PROFILE_ID: profileId,
          // Die MCP-Schicht kennt keine PC-Pfade mehr. Der Fallbereich der
          // Test-API zeigt deshalb direkt auf das Wegwerfverzeichnis; die
          // Skripte adressieren ihre Kopie als 'cases:<name>'.
          SSE_CASE_DIR: fixture.directory,
          [fixtureVariable]: fixture.copy,
        },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    const leakedPids = ssePids();
    if (run.error) {
      throw new Error(`${label} (${profileId}) konnte nicht ausgefuehrt werden: ${run.error.message}`, { cause: run.error });
    }
    assert.equal(run.status, 0, `${label} (${profileId}) scheiterte mit Exit ${run.status}.`);
    assert.equal(leakedPids, "", `Nach ${label} (${profileId}): verbliebene SSE-Prozesse (${leakedPids}).`);
    assert.equal(sha256(fixture.copy), fixture.copyHash, `${label}: die Wegwerfkopie wurde auf der Platte veraendert.`);
    assert.equal(sha256(fixture.source), fixture.sourceHash, `${label}: der offizielle Musterfall wurde veraendert.`);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Genau die Operationen, die die Einzeltransaktionen unten ausfuehren. Ein
 * experimentelles Jahr laeuft diese Tests nicht - deshalb wird hier statt
 * eines stillen SKIP geprueft, dass die Policy sie tatsaechlich sperrt.
 *
 * Bewusst diese Liste und nicht SSE_DESTRUCTIVE_OPERATIONS: dort stehen auch
 * close, desktop_stop, click_point und dialog_answer, die ein experimentelles
 * Jahr zum Aufraeumen und zur Verifikation ausdruecklich braucht. Die Liste
 * hier benennt nur, was einen Steuerfall wirklich veraendert.
 */
const FIXTURE_MUTATIONS = [
  "toggle", "tracked_set_value",
  "table_add", "table_update", "table_delete",
  "save", "save_as",
];

function assertMutationsBlocked(profileId) {
  const profile = loadProductProfile(profileId);
  process.stdout.write(`\n> Profil ${profileId}: Mutationssperre statt stillem SKIP\n`);
  const destructive = new Set(SSE_DESTRUCTIVE_OPERATIONS);
  // Mit true fuer den Experimental-Opt-in - also genau die Lage, in der dieses
  // Gate seine Lesepruefungen fuer das Jahr ueberhaupt erst fahren darf.
  const matrix = createProfileOperationMatrix(profile.status, profile.operationAccess, true);
  const leaked = [];
  const unexplained = [];
  for (const operation of FIXTURE_MUTATIONS) {
    assert(destructive.has(operation),
      `'${operation}' gilt nicht als destruktiv; die Liste der Fixture-Mutationen ist veraltet.`);
    const policy = matrix[operation];
    assert(policy, `Die Policy kennt die Operation '${operation}' nicht.`);
    if (policy.availability !== "blocked") leaked.push(`${operation}=${policy.availability}`);
    if (!policy.reason) unexplained.push(operation);
  }
  assert.deepEqual(leaked, [],
    `Profil ${profileId} laesst trotz Experimental-Opt-in Steuerfallmutationen zu: ${leaked.join(", ")}`);
  assert.deepEqual(unexplained, [],
    `Profil ${profileId} blockiert ohne genannten Grund: ${unexplained.join(", ")}`);
  process.stdout.write(
    `  ${FIXTURE_MUTATIONS.length} Steuerfallmutationen sind mit genanntem Grund gesperrt; ` +
    "die Einzeltransaktionen laufen fuer dieses Jahr deshalb bewusst nicht.\n",
  );
}

/**
 * Jeder Eintrag kostet einen vollstaendigen Programmstart, deshalb deckt jeder
 * ein eigenes Gebiet ab und keiner wiederholt ein anderes:
 *
 *   Desktop-Lebenszyklus  Start/Status/Stop, Lagebild, Ergebniswerte,
 *                         Navigation vor und zurueck, Teilerfassung
 *   Globales Suchfeld     der begrenzte set_value-Kompatibilitaetspfad
 *   Toolbar-CheckBox      toggle samt eigenem Nachbedingungs-Rollback
 *   Tabellen-Lebenszyklus table_add/table_update/table_delete in einem Lauf,
 *                         inklusive strukturellem und zellweisem Rollback
 *   Focusless-Schreibweg  der profilierte Schreibpfad auf privatem Desktop
 *
 * test/hidden-console-smoke.mjs bleibt bewusst draussen: es prueft mit Start,
 * Health und Stop eine echte Teilmenge des Desktop-Lebenszyklus. Es ist
 * lauffaehig, nur nicht Teil des Gates.
 */
const FIXTURE_SCRIPTS = [
  { label: "Desktop-Lebenszyklus", script: "test/hidden-desktop-lifecycle.mjs", fixtureVariable: "SSE_HIDDEN_FIXTURE" },
  { label: "Globales Suchfeld", script: "test/search-set-transaction.mjs", fixtureVariable: "SSE_SEARCH_SET_FIXTURE" },
  { label: "Toolbar-CheckBox", script: "test/toggle-transaction.mjs", fixtureVariable: "SSE_TOGGLE_FIXTURE" },
  { label: "Tabellen-Lebenszyklus", script: "test/table-lifecycle-transaction.mjs", fixtureVariable: "SSE_TABLE_FIXTURE" },
  { label: "Profilierter Focusless-Schreibweg", script: "test/hidden-wm-char-transaction.mjs", fixtureVariable: "SSE_FOCUSLESS_FIXTURE" },
  // Legt an und loescht wieder, speichert aber nie - die Kopie bleibt also
  // unveraendert und der Eintrag gehoert hierher und nicht zur Schreibreise.
  { label: "Zustandsreise", script: "test/live-state-journey.mjs", fixtureVariable: "SSE_STATE_FIXTURE" },
];

/**
 * Die grosse Schreibreise ist bewusst KEIN Eintrag in FIXTURE_SCRIPTS: sie
 * speichert ihre Wegwerfkopie mit voller Absicht, und genau dieser Hashwechsel
 * ist ihr Beweis. Die Invarianten sind deshalb andere - die Kopie MUSS sich
 * aendern, waehrend der Musterfall weiterhin byteidentisch bleiben muss.
 */
function runWriteJourney(profileId, template) {
  const fixture = provisionDisposableCase(profileId, template);
  process.stdout.write(`\n> Grosse Schreibreise (${profileId})\n`);
  try {
    const run = spawnSync(
      process.execPath,
      ["test/with-api.mjs", process.execPath, "test/live-write-journey.mjs"],
      {
        cwd: root,
        env: {
          ...process.env,
          SSE_PROFILE_ID: profileId,
          SSE_CASE_DIR: fixture.directory,
          SSE_JOURNEY_FIXTURE: fixture.copy,
        },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    const leakedPids = ssePids();
    if (run.error) {
      throw new Error(`Grosse Schreibreise (${profileId}) konnte nicht ausgefuehrt werden: ${run.error.message}`, { cause: run.error });
    }
    assert.equal(run.status, 0, `Grosse Schreibreise (${profileId}) scheiterte mit Exit ${run.status}.`);
    assert.equal(leakedPids, "", `Nach der Schreibreise (${profileId}): verbliebene SSE-Prozesse (${leakedPids}).`);
    assert.notEqual(sha256(fixture.copy), fixture.copyHash,
      "Die Schreibreise hat ihre Kopie nie gespeichert; der Speicherbeweis fehlt.");
    assert.equal(sha256(fixture.source), fixture.sourceHash,
      "Die Schreibreise veraenderte den offiziellen Musterfall.");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Fuer ein nicht voll freigegebenes Profil bleiben Mutationen gesperrt. Das
 * wird hier nicht stillschweigend uebersprungen, sondern als Erwartung
 * geprueft: die Policy muss jede Mutation mit genanntem Grund blockieren.
 */
function runFixtureScripts(profileId) {
  const profile = loadProductProfile(profileId);
  if (profile.status !== "supported" || profile.operationAccess !== "full") {
    assertMutationsBlocked(profileId);
    return;
  }
  const catalog = JSON.parse(readFileSync(profile.pageObjectsPath, "utf8"));
  assert(
    Object.keys(catalog.focuslessCommits ?? {}).length > 0,
    `Profil ${profileId} ist voll freigegeben, nennt aber keinen profilierten Schreibweg.`,
  );
  // Einmal positionieren, danach je Test eine frische Kopie davon: das spart
  // pro Test einen kompletten sichtbaren Navigationslauf.
  runColdFieldCycle(profileId);
  const template = provisionDisposableCase(profileId);
  try {
    positionTemplate(profileId, template);
    for (const entry of FIXTURE_SCRIPTS) runFixtureScript(profileId, entry, template.copy);
    runWriteJourney(profileId, template.copy);
  } finally {
    rmSync(template.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** Dokumentierte Live-Abdeckung und wertfreie Ergebnisformen werden bewiesen. */
function assertLiveLedgers() {
  for (const [label, script] of [
    ["Live-Abdeckungsbilanz", "test/operation-coverage-contract.mjs"],
    ["Live-Ergebnisform-Bilanz", "test/operation-result-shape-contract.mjs"],
  ]) {
    process.stdout.write(`\n> ${label}\n`);
    const ledger = spawnSync(
      process.execPath,
      [script],
      {
        cwd: root,
        env: { ...process.env, SSE_TEST_COVERAGE_SCOPE: "live" },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (ledger.error) {
      throw new Error(`${label} konnte nicht laufen: ${ledger.error.message}`, { cause: ledger.error });
    }
    assert.equal(ledger.status, 0, `${label} scheiterte mit Exit ${ledger.status}.`);
  }
}

/** Beide Jahresprofile brauchen einen getrennten Nachweis der Kernlesewege. */
function assertProfileReadCoverage(profileId) {
  process.stdout.write(`\n> ${profileId}-Leseabdeckung\n`);
  const check = spawnSync(
    process.execPath,
    ["test/live-profile-read-coverage.mjs"],
    {
      cwd: root,
      env: { ...process.env, SSE_LIVE_PROFILE_ID: profileId },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (check.error) {
    throw new Error(`${profileId}-Leseabdeckung konnte nicht geprueft werden: ${check.error.message}`, { cause: check.error });
  }
  assert.equal(check.status, 0, `${profileId}-Leseabdeckung scheiterte mit Exit ${check.status}.`);
}

assertNoSse("Vor dem Live-Gate");
// Beide Profillaeufe schreiben in dasselbe Verzeichnis; die Bilanz prueft
// danach, welche Operationen die echte Anwendung wirklich bedient hat.
const traceDirectory = mkdtempSync(join(tmpdir(), "sse-live-trace-"));
process.env[OPERATION_TRACE_DIRECTORY_KEY] = traceDirectory;
let liveGateCompleted = false;
try {
  for (const profileId of ["2025", "2024"]) {
    assertCaseFileParity(profileId);
    runProfile(profileId);
    runFixtureScripts(profileId);
  }
  runCenterCoverage();
  for (const profileId of ["2025", "2024"]) assertProfileReadCoverage(profileId);
  assertLiveLedgers();
  liveGateCompleted = true;
} finally {
  if (liveGateCompleted) {
    rmSync(traceDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } else {
    process.stderr.write(`Live-Evidenzspur zur Diagnose erhalten: ${traceDirectory}\n`);
  }
}

process.stdout.write("\nStriktes Live-Gate: 2025 und 2024 ohne SKIP und ohne verbleibende SSE-Instanz bestanden\n");
