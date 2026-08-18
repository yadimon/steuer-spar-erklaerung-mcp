import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callWorker, MAX_WORKER_ARGUMENT_BYTES } from "../dist/worker.js";

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

const run = (path, extra = []) => spawnSync(
  powershell,
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", worker,
    "-Op", "health", "-ArgsFile", path, ...extra],
  { cwd: root, encoding: "utf8", windowsHide: true },
);

try {
  writeFileSync(argsPath, payload, { encoding: "utf8", flag: "wx" });
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
