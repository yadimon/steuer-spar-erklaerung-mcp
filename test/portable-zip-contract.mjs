import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const contractRoot = resolve(root, "artifacts", "portable", "zip-contract");
const source = join(contractRoot, "portable-fixture");
const destination = join(contractRoot, "portable-fixture.zip");
rmSync(contractRoot, { recursive: true, force: true });
mkdirSync(source, { recursive: true });
writeFileSync(join(source, "probe.txt"), "portable-zip-contract\n", "utf8");

try {
  const powershell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
  );
  const result = spawnSync(
    powershell,
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      join(root, "scripts", "compress-portable.ps1"), "-Source", source, "-Destination", destination,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(destination), true);
  const hash = createHash("sha256").update(readFileSync(destination)).digest("hex");
  assert.match(hash, /^[a-f0-9]{64}$/u);

  const overwrite = spawnSync(
    powershell,
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      join(root, "scripts", "compress-portable.ps1"), "-Source", source, "-Destination", destination,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.notEqual(overwrite.status, 0, "ZIP-Contract darf ein bestehendes Ziel nicht still ersetzen.");
} finally {
  rmSync(contractRoot, { recursive: true, force: true });
}

process.stdout.write("Portable-ZIP: PS5.1-Kompression, SHA256-Lesbarkeit und No-Overwrite bestanden\n");
