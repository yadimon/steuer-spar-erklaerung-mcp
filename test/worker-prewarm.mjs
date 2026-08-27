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
// Die Uhr startet erst mit dem Auftrag; die Wartezeit gehoert nicht dazu.
assert.equal(typeof warmResult.ms, "number");

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
  "SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS",
  "SSE_WORKER_PREWARM_RETRY_DELAY_MS",
  "SSE_PREWARM_FIXTURE_STATE",
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
    int launch = File.Exists(state) ? File.ReadAllLines(state).Length + 1 : 1;
    int pid = Process.GetCurrentProcess().Id;
    File.AppendAllText(state, launch + "|" + pid + Environment.NewLine);
    if ((launch % 2) == 1) {
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
  process.env.SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS = "120";
  process.env.SSE_WORKER_PREWARM_RETRY_DELAY_MS = "100";
  process.env.SSE_PREWARM_FIXTURE_STATE = fixtureState;

  prewarmPool = await import(`../dist/worker-prewarm.js?startup-timeout=${randomUUID()}`);
  prewarmPool.enableWorkerPrewarm();
  await waitFor(() => fixtureLaunches().length === 1, "Der stumme Fixture-Prozess wurde nicht gestartet.");
  const firstPid = fixtureLaunches()[0].pid;
  await waitFor(
    () => /nicht innerhalb von 120 ms bereit/.test(prewarmPool.lastPrewarmFailure() ?? ""),
    "Der Startup-Timeout wurde nicht als Prewarm-Fehler gemeldet.",
  );
  await waitFor(() => !processIsAlive(firstPid), "Der stumme Fixture-Prozess wurde nach Timeout nicht beendet.");
  assert.equal(prewarmPool.isWarmSpareReady(), false);

  prewarmPool.ensureWarmSpare();
  await delay(40);
  assert.equal(fixtureLaunches().length, 1, "Die Retry-Sperre muss einen sofortigen Neustart verhindern.");
  await delay(80);
  prewarmPool.ensureWarmSpare();
  await waitFor(() => prewarmPool.isWarmSpareReady(), "Nach der Retry-Sperre wurde kein Ersatzarbeiter bereit.");
  assert.equal(fixtureLaunches().length, 2, "Nach der Retry-Sperre muss genau ein Ersatz starten.");
  assert.equal(prewarmPool.lastPrewarmFailure(), null, "Ein erfolgreicher Retry muss den Timeout-Fehler loeschen.");

  const retriedSpare = prewarmPool.takeWarmSpare();
  assert(retriedSpare, "Der erfolgreiche Retry muss entnehmbar sein.");
  const retriedClose = once(retriedSpare.child, "close");
  retriedSpare.child.stdin.end();
  await retriedClose;

  prewarmPool.ensureWarmSpare();
  await waitFor(() => fixtureLaunches().length === 3, "Der Cleanup-Fixture-Prozess wurde nicht gestartet.");
  const cleanupPid = fixtureLaunches()[2].pid;
  prewarmPool.shutdownWarmSpare();
  await waitFor(() => !processIsAlive(cleanupPid), "Shutdown muss auch einen noch startenden Arbeiter beenden.");

  prewarmPool.enableWorkerPrewarm();
  await waitFor(
    () => prewarmPool.isWarmSpareReady() && fixtureLaunches().length === 4,
    "Nach Cleanup blieb der Pool im Zustand starting haengen.",
  );
  const restartedPid = fixtureLaunches()[3].pid;
  prewarmPool.shutdownWarmSpare();
  await waitFor(() => !processIsAlive(restartedPid), "Der neu aufgebaute Pool muss sauber herunterfahren.");
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
  `${rejected.length} abgewiesene Auftragszeilen, Startup-Timeout, Retry und Cleanup bestanden\n`,
);
