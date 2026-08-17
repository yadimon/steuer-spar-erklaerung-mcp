import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const callWorker = (operation, args) => {
  const b64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  const output = execFileSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", worker, "-Op", operation, "-B64", b64],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  return JSON.parse(output.trim());
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();

const temporary = mkdtempSync(join(tmpdir(), "sse-backup-contract-"));
try {
  const cases = join(temporary, "cases");
  const backup = join(temporary, "backup");
  mkdirSync(cases);
  const first = join(cases, "eins.Gew2025");
  const second = join(cases, "zwei.Gew2025");
  writeFileSync(first, "synthetischer-fall-eins\n", "utf8");
  writeFileSync(second, Buffer.from([0, 1, 2, 3, 255]));
  const expected = new Map([["eins.Gew2025", sha256(first)], ["zwei.Gew2025", sha256(second)]]);

  const result = callWorker("backup_cases", { dir: cases, dest: backup });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.anzahl, 2);
  // 'files' traegt wie bei archive_cases name/sha256 je Datei. Eine blosse
  // Anzahl unter demselben Namen hatte den veroeffentlichten Ergebnisvertrag
  // verletzt und jeden API-Aufruf mit 502 beendet.
  assert.equal(result.files.length, 2);
  for (const entry of result.files) {
    assert.equal(entry.sha256, expected.get(entry.name));
    assert.equal(sha256(join(backup, entry.name)), entry.sha256);
  }
  assert.equal(result.hashes.length, 2);
  for (const entry of result.hashes) {
    assert.equal(entry.sha256, expected.get(entry.file));
  }
  assert.match(result.manifest, /pruefsummen\.csv$/);
  const manifest = readFileSync(join(backup, "pruefsummen.csv"), "utf8");
  assert.match(manifest, /eins\.Gew2025/);
  assert.match(manifest, /zwei\.Gew2025/);

  const before = new Map([...expected.keys()].map((name) => [name, sha256(join(backup, name))]));
  const repeated = callWorker("backup_cases", { dir: cases, dest: backup });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.kind, "precondition-failed");
  for (const [name, hash] of before) assert.equal(sha256(join(backup, name)), hash);

  const nested = callWorker("backup_cases", { dir: cases, dest: join(cases, "nicht-erlaubt") });
  assert.equal(nested.ok, false);
  assert.equal(nested.kind, "bad-args");
  assert.equal(existsSync(join(cases, "nicht-erlaubt")), false);

  process.stdout.write("Fallsicherung: exklusive Ziele, Bytegleichheit, Manifest und Wiederholschutz bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
