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
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "powershell", "sse-worker.ps1");
const ownedProcessIdentityHelper = join(root, "test", "performance", "owned-process-identity.ps1");
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
assert.equal(configuredPoolTarget("4"), 4, "Der schnelle Host darf vier Reserven konfigurieren.");
assert.equal(configuredPoolTarget("999"), 4, "Der Reservevorrat muss nach oben auf vier begrenzt bleiben.");
assert.equal(configuredPoolTarget("0"), 1, "Der Reservevorrat muss nach unten mindestens eins bleiben.");
const configuredDeadline = execFileSync(process.execPath, ["--input-type=module", "-e",
  'const m=await import("./dist/worker-prewarm.js");process.stdout.write(String(m.prewarmStartupTimeoutMs()));'], {
  cwd: root, env: { ...process.env, SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS: "23000" }, encoding: "utf8",
});
assert.equal(configuredDeadline, "23000", "Readiness waiters must use the same deadline as the pool.");

// Ohne ausdrueckliche Einstellung richtet sich der Vorrat nach der Ausstattung
// des Rechners. Die Regel wird mit festen Zahlen geprueft, damit der Test auf
// jedem Rechner dasselbe aussagt - `defaultPoolSize` misst die Maschine, diese
// Funktion entscheidet.
const { poolSizeForHost } = await import("../dist/worker-prewarm.js");
assert.equal(poolSizeForHost(68, 32), 4, "Ein grosszuegiger Rechner haelt vier Reserven.");
assert.equal(poolSizeForHost(24, 8), 4, "An der oberen Schwelle sind es vier.");
assert.equal(poolSizeForHost(24, 7), 3, "Zu wenige Kerne verhindern die vierte Reserve.");
assert.equal(poolSizeForHost(16, 8), 3, "Mittlere Ausstattung haelt drei Reserven.");
assert.equal(poolSizeForHost(12, 4), 3, "An der unteren Schwelle sind es drei.");
assert.equal(poolSizeForHost(8, 16), 2, "Wenig Speicher bleibt beim sparsamen Vorrat.");
assert.equal(poolSizeForHost(64, 2), 2, "Wenige Kerne bleiben beim sparsamen Vorrat.");

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

// Ein gueltiger Privatdesktop darf statische, controllerfreie Reads nicht auf
// den kalten Launcherpfad zwingen. Der Unterprozess isoliert TEMP, Modulcache
// und Poolzustand vom nachfolgenden Timeout-/Retry-Fixture.
const staticMarkerOutput = execFileSync(
  process.execPath,
  [join(root, "test", "worker-static-marker-prewarm.mjs")],
  {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000,
    // This subtest validates routing, not the separate startup-timeout path.
    // Parallel Windows suites can make PowerShell startup exceed its 15 s
    // production default, so give the isolated fixture its own bounded budget.
    env: { ...process.env, SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS: "45000" },
  },
);
assert.match(staticMarkerOutput, /gueltiger Privatdesktop-Marker nutzt den Warm-Pool/u);

// runWorker schreibt die Auftragszeile unmittelbar nach spawn, also lange vor
// der spaeter eintreffenden Bereitschaft. Zusaetzlich bindet die Quellstruktur
// beide Startpfade an dieselbe vor der Bereitschaft registrierte Definition.
const workerSource = readFileSync(worker, "utf8");
assert.equal([...workerSource.matchAll(/^function Invoke-SSEWorkerOperation\(/gmu)].length, 1,
  "Beide Startpfade muessen genau eine direkte Dispatcherdefinition teilen.");
const declarationIndex = workerSource.indexOf("function Invoke-SSEWorkerOperation(");
const warmupIndex = workerSource.indexOf(
  "Invoke-SSEWorkerOperation $script:SSE_DISPATCHER_WARMUP $null",
);
const readyIndex = workerSource.indexOf("prewarm='ready'");
const warmDispatchIndex = workerSource.indexOf(
  "if ($Prewarm) {\n  Invoke-SSEWorkerOperation $Op $a", readyIndex,
);
const coldDispatchIndex = workerSource.indexOf("\nInvoke-SSEWorkerOperation $Op $a", warmDispatchIndex);
assert(declarationIndex >= 0 && warmupIndex > declarationIndex && readyIndex > warmupIndex,
  "Der direkte Dispatcher muss vor Warmlauf und Bereitschaft registriert sein.");
assert(warmDispatchIndex > readyIndex && coldDispatchIndex > warmDispatchIndex,
  "Erst nach der Bereitschaft darf der warme oder kalte Auftrag dispatchen.");
const prewarmIndex = workerSource.indexOf("if ($Prewarm) {\n  # Statische, validierte Profilkataloge");
assert(prewarmIndex > declarationIndex && prewarmIndex < warmupIndex);
const dynamicDispatcherText = /\[ScriptBlock\]::Create|Invoke-Expression|\biex\b|^[ \t]*\.[ \t]+\$dispatcher/imu;
assert.doesNotMatch("# Hier gehoert er hin.\n  $dispatcherWarmupProbe = 1", dynamicDispatcherText,
  "Ein Satzpunkt im Kommentar ist keine Dot-Sourcing-Anweisung.");
assert.match("  . $dispatcherDefinition", dynamicDispatcherText);
assert.doesNotMatch(workerSource.slice(prewarmIndex, readyIndex), dynamicDispatcherText,
  "Der Prewarm-Pfad darf Dispatcherquelltext nicht erneut erzeugen oder auswerten.");

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
// Ein frisch kompiliertes EXE kann auf einem ausgelasteten Hosted Runner erst
// nach Virenscan und Prozessplanung anlaufen. 120 ms prueften dort eher den
// Runner als unseren Timeout-Vertrag. Fuenf Sekunden bleiben deutlich unter
// dem Produktionswert, geben dem Kind aber Zeit, seinen Start zu protokollieren.
const fixtureStartupTimeoutMs = 5_000;
const fixtureRetryDelayMs = 1_000;
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
let fixtureError;
const wallNow = Date.now;

writeFileSync(fixtureSource, `
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

public static class Program {
  static void Append(string state, string mutexName, string line) {
    using (var mutex = new Mutex(false, mutexName)) {
      mutex.WaitOne();
      try {
        File.AppendAllText(state, line + Environment.NewLine);
      } finally {
        mutex.ReleaseMutex();
      }
    }
  }

  public static int Main() {
    string state = Environment.GetEnvironmentVariable("SSE_PREWARM_FIXTURE_STATE");
    string mutexName = Environment.GetEnvironmentVariable("SSE_PREWARM_FIXTURE_MUTEX");
    string mode = Environment.GetEnvironmentVariable("SSE_PREWARM_FIXTURE_MODE") ?? "pool";
    int launch;
    int pid = Process.GetCurrentProcess().Id;
    using (var mutex = new Mutex(false, mutexName)) {
      mutex.WaitOne();
      try {
        launch = File.Exists(state) ? File.ReadAllLines(state).Length + 1 : 1;
        string launchLine = mode == "assigned-timeout"
          ? "launch|" + launch + "|" + pid
          : launch + "|" + pid;
        File.AppendAllText(state, launchLine + Environment.NewLine);
      } finally {
        mutex.ReleaseMutex();
      }
    }
    if (mode == "assigned-timeout") {
      Console.WriteLine("{\\\"prewarm\\\":\\\"ready\\\",\\\"pid\\\":" + pid + "}");
      Console.Out.Flush();
      string job = Console.ReadLine();
      if (job == null) return 0;
      Append(state, mutexName, "job|" + launch + "|" + pid + "|" +
        Convert.ToBase64String(Encoding.UTF8.GetBytes(job)));
      if (launch == 1) {
        Thread.Sleep(Timeout.Infinite);
        return 0;
      }
      Console.WriteLine("{\\\"ok\\\":true,\\\"fixture\\\":\\\"replacement\\\"}");
      Console.Out.Flush();
      return 0;
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

async function waitFor(predicate, message, timeoutMs = 10_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

async function removeSandboxAfterExecutableUnlock(path, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs;
  let lastError;
  do {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
      lastError = error;
      await delay(250);
    }
  } while (performance.now() < deadline);
  throw lastError;
}

function assignedFixturePids(statePath) {
  if (!existsSync(statePath)) return [];
  const pids = new Set();
  for (const line of readFileSync(statePath, "utf8").split(/\r?\n/u)) {
    const match = /^launch\|[1-9]\d{0,9}\|([1-9]\d{0,9})$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid <= 2_147_483_647) pids.add(pid);
  }
  return [...pids];
}

function invokeOwnedProcessIdentity(mode, pid, identity) {
  const args = [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", ownedProcessIdentityHelper,
    "-Mode", mode,
    "-TargetProcessId", String(pid),
  ];
  if (identity) {
    args.push(
      "-ExpectedCreationTimeUtcTicks", identity.creationTimeUtcTicks,
      "-ExpectedImageNameLower", identity.imageNameLower,
      "-ExpectedImagePathTextSha256", identity.imagePathTextSha256,
    );
  }
  return JSON.parse(execFileSync(powershell, args, {
    cwd: root,
    windowsHide: true,
    encoding: "utf8",
    timeout: 15_000,
  }));
}

function cleanupAssignedFixtureProcesses(statePath, executablePath) {
  const expectedName = basename(executablePath, ".exe").toLowerCase();
  const expectedPathHash = createHash("sha256")
    .update(resolve(executablePath).toLowerCase(), "utf8")
    .digest("hex")
    .toUpperCase();
  const cleanupErrors = [];
  for (const pid of assignedFixturePids(statePath)) {
    try {
      const inspected = invokeOwnedProcessIdentity("Inspect", pid);
      if (inspected.outcome === "not-running") continue;
      const identity = inspected.identity;
      const identityIsSafe = identity &&
        /^\d{10,20}$/u.test(identity.creationTimeUtcTicks ?? "") &&
        /^[a-z0-9._-]{1,128}$/u.test(identity.imageNameLower ?? "") &&
        /^[A-F0-9]{64}$/u.test(identity.imagePathTextSha256 ?? "");
      if (!identityIsSafe) throw new Error(`Fixture PID ${pid} has no complete immutable identity.`);
      if (identity.imageNameLower !== expectedName || identity.imagePathTextSha256 !== expectedPathHash) {
        continue;
      }
      const terminated = invokeOwnedProcessIdentity("Terminate", pid, identity);
      if (!["terminated", "not-running", "identity-mismatch"].includes(terminated.outcome)) {
        throw new Error(`Fixture PID ${pid} was not terminated safely (${terminated.outcome ?? "unknown"}).`);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  return cleanupErrors;
}

try {
  execFileSync(compiler, ["/nologo", "/target:exe", `/out:${fixtureExecutable}`, fixtureSource], {
    cwd: sandbox,
    windowsHide: true,
    stdio: "pipe",
  });
  const assignedState = join(sandbox, "assigned-job-state.txt");
  try {
    const assignedOutput = execFileSync(
      process.execPath,
      [join(root, "test", "fixtures", "worker-warm-assigned-timeout.mjs")],
      {
        cwd: root,
        windowsHide: true,
        timeout: 90_000,
        encoding: "utf8",
        env: {
          ...process.env,
          TEMP: sandbox,
          TMP: sandbox,
          SSE_POWERSHELL_EXE: fixtureExecutable,
          SSE_WORKER_PREWARM_POOL_SIZE: "1",
          SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS: "5000",
          SSE_WORKER_PREWARM_RETRY_DELAY_MS: "1000",
          SSE_PREWARM_FIXTURE_STATE: assignedState,
          SSE_PREWARM_FIXTURE_MUTEX: `Local\\SSEAssignedTimeout${randomUUID().replaceAll("-", "")}`,
          SSE_PREWARM_FIXTURE_MODE: "assigned-timeout",
        },
      },
    );
    assert.match(assignedOutput, /Warm assigned-job timeout: exact child cleanup/u);
  } catch (error) {
    const cleanupErrors = cleanupAssignedFixtureProcesses(assignedState, fixtureExecutable);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Assigned warm-timeout fixture and exact process cleanup both failed.",
      );
    }
    throw error;
  }

  process.env.SSE_POWERSHELL_EXE = fixtureExecutable;
  process.env.SSE_WORKER_PREWARM_POOL_SIZE = "2";
  process.env.SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS = String(fixtureStartupTimeoutMs);
  process.env.SSE_WORKER_PREWARM_RETRY_DELAY_MS = String(fixtureRetryDelayMs);
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
    () => new RegExp(`nicht innerhalb von ${fixtureStartupTimeoutMs} ms bereit`).test(
      prewarmPool.lastPrewarmFailure() ?? "",
    ),
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

  // Only this JavaScript process sees the clock corrections; Windows time is unchanged.
  Date.now = () => wallNow() + 2 * 24 * 60 * 60 * 1000;
  prewarmPool.ensureWarmSpare();
  assert.equal(prewarmPool.warmSparePoolStatus().starting, 0,
    "A forward wall-clock correction must not bypass the prewarm retry delay.");
  await delay(40);
  assert.equal(fixtureLaunches().length, 2, "Die Retry-Sperre muss einen sofortigen Neustart verhindern.");
  Date.now = () => wallNow() - 2 * 24 * 60 * 60 * 1000;

  const firstReadySpare = prewarmPool.takeWarmSpare();
  assert(firstReadySpare, "Die trotz Teilfehler bereite Reserve muss entnehmbar bleiben.");
  const firstReadyClose = once(firstReadySpare.child, "close");
  firstReadySpare.child.stdin.end();
  await firstReadyClose;

  await waitFor(
    () => {
      prewarmPool.ensureWarmSpare();
      return fixtureLaunches().length === 4 && prewarmPool.warmSparePoolStatus().ready === 1;
    },
    "A backward wall-clock correction must not prolong the prewarm retry delay.",
  );
  Date.now = wallNow;
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
} catch (error) {
  fixtureError = error;
} finally {
  Date.now = wallNow;
  let shutdownError;
  try {
    prewarmPool?.shutdownWarmSpare();
    await waitFor(
      () => fixtureLaunches().every(({ pid }) => !processIsAlive(pid)),
      "Fixture shutdown left a recorded pool process alive.",
      15_000,
    );
  } catch (error) {
    shutdownError = error;
  }
  for (const [name, previous] of previousEnvironment) {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
  // Keep the original assertion and its launch records if shutdown also fails.
  // A fixed sleep neither proves process exit nor releases an executable lock.
  const failures = [fixtureError, shutdownError].filter((error) => error !== undefined);
  if (failures.length > 0) {
    throw new AggregateError(failures, `Prewarm fixture failed; evidence retained at ${sandbox}`);
  }
  assert.equal(dirname(resolve(sandbox)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.match(basename(sandbox), /^sse-prewarm-startup-timeout-[a-z0-9]+$/iu);
  // Windows can keep the freshly executed fixture image mapped for several
  // seconds after process exit (notably under VM antivirus scanning). Process
  // identity and exit are already proven above; wait only for that OS handle.
  await removeSandboxAfterExecutableUnlock(sandbox);
}

process.stdout.write(
  "Vorgewaermter Arbeiter: Bereitschaft, gleiches Ergebnis wie kalt, " +
  `${rejected.length} abgewiesene Auftragszeilen, Poolgroesse 2, Startup-Timeout, Retry und Cleanup bestanden\n`,
);
