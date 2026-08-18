import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWindowsPowerShell } from "../dist/windows-runtime.js";

const root = process.cwd();
const powershell = resolveWindowsPowerShell();
const compressScript = join(root, "scripts", "compress-portable.ps1");
const verifyScript = join(root, "scripts", "verify-portable-archive.ps1");
const product = "portable-archive-contract";
const version = "1.2.3-test";
const temporary = mkdtempSync(join(tmpdir(), "sse-portable-archive-"));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createArchive(scenario, mutation) {
  const scenarioRoot = join(temporary, scenario);
  const bundle = join(scenarioRoot, "portable-fixture");
  const nested = join(bundle, "nested");
  const zip = join(scenarioRoot, "portable-fixture.zip");
  mkdirSync(nested, { recursive: true });
  const payload = Buffer.from("portable payload\n", "utf8");
  const tool = Buffer.from("export const ready = true;\n", "utf8");
  writeFileSync(join(bundle, "payload.txt"), payload);
  writeFileSync(join(nested, "tool.js"), tool);
  const manifest = {
    schemaVersion: 1,
    product,
    productVersion: version,
    files: [
      { path: "nested/tool.js", bytes: tool.length, sha256: sha256(tool) },
      { path: "payload.txt", bytes: payload.length, sha256: sha256(payload) },
    ],
  };
  writeFileSync(join(bundle, "portable-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  mutation?.(bundle);
  const compressed = spawnSync(
    powershell,
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      compressScript, "-Source", bundle, "-Destination", zip,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(compressed.status, 0, `Fixture-ZIP scheiterte: ${compressed.stderr}`);
  return zip;
}

function verify(zip, expectedVersion = version) {
  return spawnSync(
    powershell,
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      verifyScript,
      "-ZipPath", zip,
      "-ExpectedRootName", "portable-fixture",
      "-ExpectedProduct", product,
      "-ExpectedVersion", expectedVersion,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
}

function addZipEntry(zip, entryName) {
  const command = [
    "Add-Type -AssemblyName System.IO.Compression",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "$archive = [IO.Compression.ZipFile]::Open($env:SSE_TEST_ZIP, [IO.Compression.ZipArchiveMode]::Update)",
    "try {",
    "  $entry = $archive.CreateEntry($env:SSE_TEST_ENTRY)",
    "  $writer = New-Object IO.StreamWriter($entry.Open())",
    "  try { $writer.Write('synthetic') } finally { $writer.Dispose() }",
    "} finally { $archive.Dispose() }",
  ].join("\n");
  const mutation = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      cwd: root,
      env: { ...process.env, SSE_TEST_ZIP: zip, SSE_TEST_ENTRY: entryName },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(mutation.status, 0, `ZIP-Mutation scheiterte: ${mutation.stderr}`);
}

try {
  const valid = verify(createArchive("valid"));
  assert.equal(valid.status, 0, `Gueltiges Archiv wurde abgelehnt: ${valid.stderr}`);
  const summary = JSON.parse(valid.stdout);
  assert.deepEqual(
    { ok: summary.ok, product: summary.product, productVersion: summary.productVersion, files: summary.files },
    { ok: true, product, productVersion: version, files: 2 },
  );

  const wrongVersion = verify(createArchive("wrong-version"), "9.9.9");
  assert.notEqual(wrongVersion.status, 0, "Falsche erwartete Releaseversion wurde akzeptiert.");
  assert.match(wrongVersion.stderr, /Produkt\/Version/u);

  const tampered = verify(createArchive("tampered", (bundle) => {
    writeFileSync(join(bundle, "payload.txt"), Buffer.alloc(Buffer.byteLength("portable payload\n"), "x"));
  }));
  assert.notEqual(tampered.status, 0, "Hashabweichende Manifestdatei wurde akzeptiert.");
  assert.match(tampered.stderr, /SHA256/u);

  const extra = verify(createArchive("extra", (bundle) => {
    writeFileSync(join(bundle, "nicht-manifestiert.txt"), "extra\n", "utf8");
  }));
  assert.notEqual(extra.status, 0, "Nicht manifestierte ZIP-Datei wurde akzeptiert.");
  assert.match(extra.stderr, /nicht manifestierte Datei/u);

  const unsafeZip = createArchive("unsafe-path");
  addZipEntry(unsafeZip, "../escape.txt");
  const unsafe = verify(unsafeZip);
  assert.notEqual(unsafe.status, 0, "Traversal-Pfad im ZIP wurde akzeptiert.");
  assert.match(unsafe.stderr, /unsicher/u);

  const collisionZip = createArchive("case-collision");
  addZipEntry(collisionZip, "portable-fixture/PAYLOAD.txt");
  const collision = verify(collisionZip);
  assert.notEqual(collision.status, 0, "Windows-Case-Kollision im ZIP wurde akzeptiert.");
  assert.match(collision.stderr, /kollidierenden Pfad/u);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("Portable-Archivpruefung: Hash-, Pfad-, Extra-Datei- und Versionsmutationen fail-closed bestanden\n");
