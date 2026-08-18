import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveWindowsPowerShell } from "../dist/windows-runtime.js";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const powershell = resolveWindowsPowerShell();
const artifactName = `release-verification-${process.pid}`;
const bundle = join(root, "artifacts", "portable", artifactName);
const zip = `${bundle}.zip`;
const checksum = `${zip}.sha256`;
const compressScript = join(root, "scripts", "compress-portable.ps1");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function buildFixture(version = packageJson.version) {
  rmSync(bundle, { recursive: true, force: true });
  rmSync(zip, { force: true });
  rmSync(checksum, { force: true });
  mkdirSync(bundle, { recursive: true });
  const payload = Buffer.from("release verifier payload\n", "utf8");
  writeFileSync(join(bundle, "payload.txt"), payload);
  writeFileSync(
    join(bundle, "portable-manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      product: packageJson.name,
      productVersion: version,
      files: [{ path: "payload.txt", bytes: payload.length, sha256: createHash("sha256").update(payload).digest("hex") }],
    }, null, 2)}\n`,
    "utf8",
  );
  const compressed = spawnSync(
    powershell,
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      compressScript, "-Source", bundle, "-Destination", zip,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(compressed.status, 0, `Release-Fixture konnte nicht gepackt werden: ${compressed.stderr}`);
  writeFileSync(checksum, `${sha256(zip)}  ${artifactName}.zip\n`, "utf8");
}

function verify() {
  return spawnSync(
    process.execPath,
    ["scripts/verify-portable-release.mjs", "--zip", relative(root, zip)],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
}

try {
  buildFixture();
  const valid = verify();
  assert.equal(valid.status, 0, `Gueltiges Release-Artefakt wurde abgelehnt: ${valid.stderr}`);
  const summary = JSON.parse(valid.stdout);
  assert.deepEqual(
    { ok: summary.ok, product: summary.product, productVersion: summary.productVersion, sha256: summary.sha256 },
    { ok: true, product: packageJson.name, productVersion: packageJson.version, sha256: sha256(zip) },
  );

  writeFileSync(checksum, `${"0".repeat(64)}  ${artifactName}.zip\n`, "utf8");
  const wrongHash = verify();
  assert.notEqual(wrongHash.status, 0, "ZIP mit falscher aeusserer Pruefsumme wurde akzeptiert.");
  assert.match(wrongHash.stderr, /SHA-256/u);

  writeFileSync(checksum, `${sha256(zip)}  anderes.zip\n`, "utf8");
  const wrongName = verify();
  assert.notEqual(wrongName.status, 0, "Sidecar mit falschem ZIP-Namen wurde akzeptiert.");
  assert.match(wrongName.stderr, /SHA-256/u);

  buildFixture("0.1.0-veraltet");
  const staleVersion = verify();
  assert.notEqual(staleVersion.status, 0, "Neu gehashtes Archiv mit veralteter Produktversion wurde akzeptiert.");
  assert.match(staleVersion.stderr, /Produkt\/Version/u);
} finally {
  rmSync(bundle, { recursive: true, force: true });
  rmSync(zip, { force: true });
  rmSync(checksum, { force: true });
}

process.stdout.write("Portable Release-Verifikation: Sidecar, Hash und Quellversion fail-closed bestanden\n");
