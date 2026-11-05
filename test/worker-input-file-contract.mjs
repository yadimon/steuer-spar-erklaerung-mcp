import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callWorker, MAX_WORKER_ARGUMENT_BYTES } from "../dist/worker.js";
import { bindDesktopStartDeadline } from "../dist/worker-start-deadline.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const worker = join(root, "powershell", "sse-worker.ps1");
const powershell = join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const argsPath = join(tmpdir(), `sse-args-${randomUUID().replaceAll("-", "")}.json`);
const invalidRoot = join(tmpdir(), `sse-args-invalid-${randomUUID()}`);
const invalidPath = join(invalidRoot, `sse-args-${randomUUID().replaceAll("-", "")}.json`);
const largeArgs = { payloadParts: Array.from({ length: 200 }, () => "x".repeat(500)) };
const payload = JSON.stringify(largeArgs);

const run = (path, extra = [], operation = "health") => spawnSync(
  powershell,
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", worker,
    "-Op", operation, "-ArgsFile", path, ...extra],
  { cwd: root, encoding: "utf8", windowsHide: true },
);

try {
  const callerArgs = { timeoutSec: 90 };
  assert.deepEqual(bindDesktopStartDeadline("desktop_start", callerArgs, 90_000, 10_000),
    { timeoutSec: 90, __desktopStartDeadlineUnixMs: 100_000 });
  assert.deepEqual(callerArgs, { timeoutSec: 90 }, "Transport binding must not change caller arguments");
  assert.equal(bindDesktopStartDeadline("health", callerArgs, 1), callerArgs);
  assert.equal(bindDesktopStartDeadline("desktop_start", {}, 90_000, 500_000).__desktopStartDeadlineUnixMs,
    590_000, "A warmed child's old birth time must not consume its new dispatch deadline");
  for (const invalid of [0, 6499, 6500.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => bindDesktopStartDeadline("desktop_start", {}, invalid, 10_000), TypeError);
  }
  for (const operation of ["desktop_start", "health"]) {
    assert.throws(() => bindDesktopStartDeadline(operation,
      { __desktopStartDeadlineUnixMs: 999_999 }, 90_000), TypeError);
  }
  await assert.rejects(callWorker("desktop_start", {}, 1000), (error) => error.kind === "bad-args");
  const workerSource = readFileSync(join(root, "src", "worker.ts"), "utf8");
  const deadlineBinding = workerSource.indexOf("args = bindDesktopStartDeadline(");
  assert(deadlineBinding >= 0 && deadlineBinding < workerSource.indexOf("const spare ="),
    "Reject invalid deadlines before borrowing a ready child");
  writeFileSync(argsPath, JSON.stringify({
    exe: "C:\\synthetic\\unavailable-SSE.exe", __desktopStartDeadlineUnixMs: 1,
  }), { encoding: "utf8", flag: "wx" });
  const expiredDesktopStart = JSON.parse(run(argsPath, [], "desktop_start").stdout.trim());
  assert.equal(expiredDesktopStart.kind, "startup-deadline",
    "An expired startup budget must fail before executable validation or desktop/process creation");
  assert.equal(expiredDesktopStart.mutationStarted, false);
  assert.equal(expiredDesktopStart.resultingState, "unchanged");

  writeFileSync(argsPath, payload, "utf8");
  const direct = run(argsPath);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  assert.equal(typeof JSON.parse(direct.stdout.trim()).ok, "boolean");
  assert.equal(readFileSync(argsPath, "utf8"), payload, "Worker darf die aufrufereigene Argumentdatei nicht veraendern");

  for (const invalidBudget of [
    { tooLong: "x".repeat(65_537) },
    { tooMany: Array.from({ length: 2_001 }, () => null) },
    { tooDeep: Array.from({ length: 34 }).reduce((value) => ({ value }), null) },
  ]) {
    writeFileSync(argsPath, JSON.stringify(invalidBudget), "utf8");
    const rejected = run(argsPath);
    const rejectedResult = JSON.parse(rejected.stdout.trim());
    assert(rejectedResult.ok === false && rejectedResult.kind === "bad-args",
      `Direkter Argumentdatei-Budgetbypass wurde akzeptiert: ${JSON.stringify(rejectedResult)}`);
  }
  writeFileSync(argsPath, Buffer.from([0xff]));
  const invalidUtf8 = JSON.parse(run(argsPath).stdout.trim());
  assert(invalidUtf8.ok === false && invalidUtf8.kind === "bad-args",
    "Argumentdatei muss ungueltiges UTF-8 vor Profil-/UI-Start ablehnen");

  const ambiguous = run(argsPath, ["-B64", "e30="]);
  assert.notEqual(ambiguous.status, 0);
  assert.equal(JSON.parse(ambiguous.stdout.trim()).kind, "bad-args");

  mkdirSync(invalidRoot);
  writeFileSync(invalidPath, "{}", { encoding: "utf8", flag: "wx" });
  const outsideTempRoot = run(invalidPath);
  assert.notEqual(outsideTempRoot.status, 0);
  assert.equal(JSON.parse(outsideTempRoot.stdout.trim()).kind, "bad-args");

  const throughNode = await callWorker("health", largeArgs, 90_000);
  assert.equal(typeof throughNode.ok, "boolean", "Grosse Argumente muessen ohne Windows-Kommandozeilenlimit ankommen");
  await assert.rejects(
    callWorker("health", { padding: "x".repeat(MAX_WORKER_ARGUMENT_BYTES + 1) }, 90_000),
    (error) => error?.kind === "payload-too-large",
  );

  process.stdout.write("Worker-Argumentdatei: 100-kB-Transport, Tempbindung, JSON-Budgets und 8-MiB-Limit bestanden\n");
} finally {
  rmSync(argsPath, { force: true });
  rmSync(invalidRoot, { recursive: true, force: true });
}
