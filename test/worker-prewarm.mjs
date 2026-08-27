/**
 * Vertrag des vorgewaermten Reservearbeiters.
 *
 * Der Reservearbeiter existiert nur aus einem Grund: das Zerlegen des grossen
 * Workerskripts vor dem Auftrag zu erledigen. Er darf deshalb
 *  - sich genau einmal als bereit melden,
 *  - genau EINEN Auftrag annehmen und danach enden,
 *  - dasselbe Ergebnis liefern wie der Kaltstart,
 *  - keine Auftragszeile akzeptieren, die die Transportgrenze umgeht,
 *  - und bei geschlossener Standardeingabe folgenlos enden.
 *
 * Die Zeitmessung ist bewusst KEIN Bestandteil dieses Vertrags: auf einer
 * ausgelasteten Maschine waere sie unzuverlaessig, und ein langsamer, aber
 * korrekter Reservearbeiter ist kein Fehler.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "powershell", "sse-worker.ps1");
const powershell = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const compilerCandidates = [
  join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
];
const compiler = compilerCandidates.find((candidate) => existsSync(candidate));
assert(compiler, "Der Windows-.NET-Framework-Compiler fuer den Prewarm-Pool-Test fehlt.");

const poolTargetProbe =
  'const m=await import("./dist/worker-prewarm.js");process.stdout.write(String(m.warmSparePoolStatus().target));';
const configuredPoolTarget = (value) => Number(execFileSync(
  process.execPath,
  ["--input-type=module", "-e", poolTargetProbe],
  {
    cwd: root,
    env: { ...process.env, SSE_WORKER_PREWARM_POOL_SIZE: value },
    encoding: "utf8",
  },
));
assert.equal(configuredPoolTarget("3"), 3, "Der schnelle Host darf drei Reserven konfigurieren.");
assert.equal(configuredPoolTarget("999"), 3, "Der Reservevorrat muss nach oben auf drei begrenzt bleiben.");
assert.equal(configuredPoolTarget("0"), 1, "Der Reservevorrat muss nach unten mindestens eins bleiben.");

function newArgumentsFile() {
  const path = join(tmpdir(), `sse-args-${randomUUID().replaceAll("-", "")}.json`);
  writeFileSync(path, "{}", "utf8");
  return path;
}

function runWorker(argv, { jobLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      powershell,
      ["-ExecutionPolicy", "Bypass", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", worker, ...argv],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (jobLine === null) child.stdin.end();
    else if (jobLine !== undefined) child.stdin.end(`${jobLine}\n`, "utf8");
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Erste Zeile ist die Bereitschaftsmeldung, der Rest das Auftragsergebnis. */
function splitPrewarmOutput(stdout) {
  const newline = stdout.indexOf("\n");
  assert(newline > 0, `Reservearbeiter meldete keine Bereitschaftszeile: ${stdout.slice(0, 400)}`);
  return { announcement: stdout.slice(0, newline).trim(), payload: stdout.slice(newline + 1).trim() };
}

// ---------------------------------------------------------- 1) Kaltstart als Mass
const coldArgumentsFile = newArgumentsFile();
const cold = await runWorker(["-Op", "product_info", "-ArgsFile", coldArgumentsFile]);
unlinkSync(coldArgumentsFile);
assert.equal(cold.code, 0, `Kaltstart scheiterte: ${cold.stderr.slice(0, 400)}`);
const coldResult = JSON.parse(cold.stdout.trim());
assert.equal(coldResult.ok, true);
assert.equal(coldResult.workerInitializationMs.dispatcherRegistrationMs, undefined,
  "Der Cold-Worker darf den Prewarm-Dispatcherpfad nicht ausfuehren.");

// ------------------------------------- 2) Vorgewaermt liefert dasselbe Ergebnis
const warmArgumentsFile = newArgumentsFile();
const warm = await runWorker(["-Prewarm"], {
  jobLine: JSON.stringify({ op: "product_info", argsFile: warmArgumentsFile }),
});
unlinkSync(warmArgumentsFile);
assert.equal(warm.code, 0, `Vorgewaermter Lauf scheiterte: ${warm.stderr.slice(0, 400)}`);
const { announcement, payload } = splitPrewarmOutput(warm.stdout);
const ready = JSON.parse(announcement);
assert.equal(ready.prewarm, "ready", "Die erste Zeile muss die Bereitschaft melden.");
assert.equal(typeof ready.pid, "number");
const warmResult = JSON.parse(payload);
assert.equal(warmResult.ok, true);
assert.equal(warmResult.product, coldResult.product, "Warm und kalt muessen dasselbe Produktprofil melden.");
assert.equal(warmResult.profileId, coldResult.profileId);
assert.equal(warmResult.taxYear, coldResult.taxYear);
const coldStable = { ...coldResult };
const warmStable = { ...warmResult };
delete coldStable.ms;
delete coldStable.workerInitializationMs;
delete warmStable.ms;
delete warmStable.workerInitializationMs;
assert.deepEqual(warmStable, coldStable,
  "Warm und kalt muessen abseits ihrer Laufzeit-Telemetrie exakt dasselbe Ergebnis liefern.");
// Die Uhr startet erst mit dem Auftrag; die Wartezeit gehoert nicht dazu.
assert.equal(typeof warmResult.ms, "number");
assert.equal(Number.isFinite(warmResult.workerInitializationMs.dispatcherRegistrationMs), true,
  "Der warme Arbeiter muss die Dispatcherregistrierung vor seiner Bereitschaft messen.");
assert(warmResult.workerInitializationMs.dispatcherRegistrationMs >= 0);
assert.equal(Number.isFinite(warmResult.workerInitializationMs.staticProfileCacheMs), true);
assert(warmResult.workerInitializationMs.staticProfileCacheMs >= 0);
assert.equal(coldResult.workerInitializationMs.staticProfileCacheMs, undefined);

// runWorker schreibt die Auftragszeile unmittelbar nach spawn, also lange vor
// der spaeter eintreffenden Bereitschaft. Zusaetzlich bindet die Quellstruktur
// den warmen Aufruf vor die ausschliessliche Cold-Worker-Deklaration.
const workerSource = readFileSync(worker, "utf8");
const preloadIndex = workerSource.indexOf("[ScriptBlock]::Create($dispatcherDefinitions[0].Extent.Text)");
const readyIndex = workerSource.indexOf("prewarm='ready'", preloadIndex);
const warmDispatchIndex = workerSource.indexOf("if ($Prewarm) {\n  Invoke-SSEWorkerOperation $Op $a", readyIndex);
const coldDeclarationIndex = workerSource.indexOf(
  "if (-not $Prewarm) {\nfunction Invoke-SSEWorkerOperation([string]$Operation, $Arguments)",
  warmDispatchIndex,
);
assert(preloadIndex >= 0 && readyIndex > preloadIndex,
  "Die exakt geparste Dispatcherdefinition muss vor prewarm=ready registriert werden.");
assert(warmDispatchIndex > readyIndex && coldDeclarationIndex > warmDispatchIndex,
  "Der Warm-Auftrag muss vor der nur fuer Cold-Worker ausgefuehrten Originaldeklaration dispatchen.");

// --------------------------------- 3) Die Transportgrenze gilt auch fuer Auftraege
const rejected = [
  ["kein JSON-Objekt", "nicht-json"],
  ["fremdes Feld", JSON.stringify({ op: "product_info", desktop: "boese" })],
  ["unzulaessiger Operationsname", JSON.stringify({ op: "Product-Info" })],
  ["fremde Argumentdatei", JSON.stringify({ op: "product_info", argsFile: "C:\\Windows\\win.ini" })],
];
for (const [label, jobLine] of rejected) {
  const run = await runWorker(["-Prewarm"], { jobLine });
  const { payload: body } = splitPrewarmOutput(run.stdout);
  const result = JSON.parse(body);
  assert.equal(result.ok, false, `${label} haette abgelehnt werden muessen.`);
  assert.equal(result.kind, "bad-args", `${label} muss als bad-args abgelehnt werden.`);
  assert.equal(run.code, 1, `${label} muss mit Exitcode 1 enden.`);
}

// ------------------------------- 4) Ohne Auftrag endet der Reservearbeiter still
const abandoned = await runWorker(["-Prewarm"], { jobLine: null });
assert.equal(abandoned.code, 0, "Ein nicht abgeholter Reservearbeiter muss folgenlos enden.");
const { payload: nothing } = splitPrewarmOutput(abandoned.stdout);
assert.equal(nothing, "", "Ohne Auftrag darf kein Ergebnis entstehen.");

// -------------------- 5) Ein stummes Kind blockiert Start und Retry nicht
const sandbox = mkdtempSync(join(tmpdir(), "sse-prewarm-startup-timeout-"));
const fixtureSource = join(sandbox, "prewarm-fixture.cs");
const fixtureExecutable = join(sandbox, "powershell.exe");
const fixtureState = join(sandbox, "launches.txt");
const managedEnvironment = [
  "SSE_POWERSHELL_EXE",
  "SSE_WORKER_PREWARM_POOL_SIZE",
  "SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS",
  "SSE_WORKER_PREWARM_RETRY_DELAY_MS",
  "SSE_PREWARM_FIXTURE_STATE",
  "SSE_PREWARM_FIXTURE_MUTEX",
];
const previousEnvironment = new Map(managedEnvironment.map((name) => [name, process.env[name]]));
let prewarmPool;

writeFileSync(fixtureSource, `
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

public static class Program {
  public static int Main() {
    string state = Environment.GetEnvironmentVariable("SSE_PREWARM_FIXTURE_STATE");
    string mutexName = Environment.GetEnvironmentVariable("SSE_PREWARM_FIXTURE_MUTEX");
    int launch;
    int pid = Process.GetCurrentProcess().Id;
    using (var mutex = new Mutex(false, mutexName)) {
      mutex.WaitOne();
      try {
        launch = File.Exists(state) ? File.ReadAllLines(state).Length + 1 : 1;
        File.AppendAllText(state, launch + "|" + pid + Environment.NewLine);
      } finally {
        mutex.ReleaseMutex();
      }
    }
    if (launch == 1 || launch == 4) {
      Thread.Sleep(Timeout.Infinite);
      return 0;
    }
    Console.WriteLine("{\\\"prewarm\\\":\\\"ready\\\",\\\"pid\\\":" + pid + "}");
    Console.Out.Flush();
    Console.In.ReadLine();
    return 0;
  }
}
`, "utf8");

function fixtureLaunches() {
  if (!existsSync(fixtureState)) return [];
  return readFileSync(fixtureState, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [launch, pid] = line.split("|").map(Number);
    return { launch, pid };
  });
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, message, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

try {
  execFileSync(compiler, ["/nologo", "/target:exe", `/out:${fixtureExecutable}`, fixtureSource], {
    cwd: sandbox,
    windowsHide: true,
    stdio: "pipe",
  });
  process.env.SSE_POWERSHELL_EXE = fixtureExecutable;
  process.env.SSE_WORKER_PREWARM_POOL_SIZE = "2";
  process.env.SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS = "120";
  process.env.SSE_WORKER_PREWARM_RETRY_DELAY_MS = "100";
  process.env.SSE_PREWARM_FIXTURE_STATE = fixtureState;
  process.env.SSE_PREWARM_FIXTURE_MUTEX = `Local\\SSEPrewarmFixture${randomUUID().replaceAll("-", "")}`;

  prewarmPool = await import(`../dist/worker-prewarm.js?startup-timeout=${randomUUID()}`);
  prewarmPool.enableWorkerPrewarm();
  await waitFor(() => fixtureLaunches().length === 2, "Die beiden Fixture-Prozesse wurden nicht gestartet.");
  const firstPid = fixtureLaunches()[0].pid;
  await waitFor(
    () => prewarmPool.warmSparePoolStatus().ready === 1,
    "Der zweite Pool-Arbeiter wurde nicht bereit.",
  );
  await waitFor(
    () => /nicht innerhalb von 120 ms bereit/.test(prewarmPool.lastPrewarmFailure() ?? ""),
    "Der Startup-Timeout wurde nicht als Prewarm-Fehler gemeldet.",
  );
  await waitFor(() => !processIsAlive(firstPid), "Der stumme Fixture-Prozess wurde nach Timeout nicht beendet.");
  assert.deepEqual(
    prewarmPool.warmSparePoolStatus(),
    { ready: 1, starting: 0, target: 2 },
    "Der Timeout eines Starts darf die bereits bereite Reserve nicht verwerfen.",
  );
  assert.equal(
    prewarmPool.isWarmSpareReady(),
    true,
    "Die Health-Anzeige muss eine trotz Teilfehler nutzbare Reserve melden.",
  );

  prewarmPool.ensureWarmSpare();
  await delay(40);
  assert.equal(fixtureLaunches().length, 2, "Die Retry-Sperre muss einen sofortigen Neustart verhindern.");

  const firstReadySpare = prewarmPool.takeWarmSpare();
  assert(firstReadySpare, "Die trotz Teilfehler bereite Reserve muss entnehmbar bleiben.");
  const firstReadyClose = once(firstReadySpare.child, "close");
  firstReadySpare.child.stdin.end();
  await firstReadyClose;

  await delay(80);
  prewarmPool.ensureWarmSpare();
  await waitFor(
    () => fixtureLaunches().length === 4 && prewarmPool.warmSparePoolStatus().ready === 1,
    "Nach der Retry-Sperre wurde der Pool nicht neu aufgebaut.",
  );
  assert.deepEqual(prewarmPool.warmSparePoolStatus(), { ready: 1, starting: 1, target: 2 });
  assert.equal(prewarmPool.lastPrewarmFailure(), null, "Ein erfolgreicher Retry muss den Timeout-Fehler loeschen.");

  const retriedSpare = prewarmPool.takeWarmSpare();
  assert(retriedSpare, "Der erfolgreiche Retry muss entnehmbar sein.");
  const retriedClose = once(retriedSpare.child, "close");
  retriedSpare.child.stdin.end();
  await retriedClose;

  const cleanupPid = fixtureLaunches()[3].pid;
  prewarmPool.shutdownWarmSpare();
  await waitFor(() => !processIsAlive(cleanupPid), "Shutdown muss auch einen noch startenden Arbeiter beenden.");
  assert.deepEqual(prewarmPool.warmSparePoolStatus(), { ready: 0, starting: 0, target: 2 });

  prewarmPool.enableWorkerPrewarm();
  await waitFor(
    () => fixtureLaunches().length === 6 && prewarmPool.warmSparePoolStatus().ready === 2,
    "Nach Cleanup blieb der Pool im Zustand starting haengen.",
  );
  assert.deepEqual(prewarmPool.warmSparePoolStatus(), { ready: 2, starting: 0, target: 2 });
  prewarmPool.ensureWarmSpare();
  prewarmPool.ensureWarmSpare();
  await delay(40);
  assert.equal(fixtureLaunches().length, 6, "Mehrfache Sicherung darf den Pool nicht ueber zwei Arbeiter vergroessern.");

  const consumedSpare = prewarmPool.takeWarmSpare();
  assert(consumedSpare, "Eine Reserve aus dem vollen Pool muss entnehmbar sein.");
  const consumedClose = once(consumedSpare.child, "close");
  consumedSpare.child.stdin.end();
  await consumedClose;
  prewarmPool.ensureWarmSpare();
  await waitFor(
    () => fixtureLaunches().length === 7 && prewarmPool.warmSparePoolStatus().ready === 2,
    "Eine entnommene Reserve wurde nicht bis zur Poolgroesse zwei nachgefuellt.",
  );

  const restartedPids = fixtureLaunches().slice(4).map(({ pid }) => pid);
  prewarmPool.shutdownWarmSpare();
  await waitFor(
    () => restartedPids.every((pid) => !processIsAlive(pid)),
    "Der neu aufgebaute Pool muss sauber herunterfahren.",
  );
} finally {
  prewarmPool?.shutdownWarmSpare();
  for (const [name, previous] of previousEnvironment) {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
  await delay(50);
  rmSync(sandbox, { recursive: true, force: true });
}

process.stdout.write(
  "Vorgewaermter Arbeiter: Bereitschaft, gleiches Ergebnis wie kalt, " +
  `${rejected.length} abgewiesene Auftragszeilen, Poolgroesse 2, Startup-Timeout, Retry und Cleanup bestanden\n`,
);
