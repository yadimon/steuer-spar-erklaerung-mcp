import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const worker = join(root, "powershell", "sse-worker.ps1");
const powershell = join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const run = (outFile) => spawnSync(
  powershell,
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", worker, "-Op", "health", "-OutFile", outFile],
  { cwd: root, encoding: "utf8", windowsHide: true },
);

const validPath = join(tmpdir(), `sse-out-${randomUUID().replaceAll("-", "")}.json`);
const occupiedPath = join(tmpdir(), `sse-out-${randomUUID().replaceAll("-", "")}.json`);
const invalidRoot = join(tmpdir(), `sse-output-invalid-${randomUUID()}`);
const invalidPath = join(invalidRoot, `sse-out-${randomUUID().replaceAll("-", "")}.json`);
try {
  const valid = run(validPath);
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.equal(valid.stdout, "");
  const result = JSON.parse(readFileSync(validPath, "utf8"));
  assert.equal(typeof result.ok, "boolean");
  assert(Object.hasOwn(result, "running"));

  writeFileSync(occupiedPath, "fremde-ausgabe\n", "utf8");
  const occupied = run(occupiedPath);
  assert.notEqual(occupied.status, 0, "Vorhandene Worker-Ausgabe darf nicht ersetzt werden.");
  assert.equal(readFileSync(occupiedPath, "utf8"), "fremde-ausgabe\n");

  mkdirSync(invalidRoot);
  const invalid = run(invalidPath);
  assert.notEqual(invalid.status, 0);
  assert.equal(existsSync(invalidPath), false);
  const invalidResult = JSON.parse(invalid.stdout.trim());
  assert.equal(invalidResult.kind, "bad-args");

  process.stdout.write("Worker-Ausgabedatei: Tempbindung, CreateNew und Fremddateischutz bestanden\n");
} finally {
  rmSync(validPath, { force: true });
  rmSync(occupiedPath, { force: true });
  rmSync(invalidRoot, { recursive: true, force: true });
}
