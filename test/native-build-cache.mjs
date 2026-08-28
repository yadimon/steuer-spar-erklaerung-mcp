import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const powershell = process.env.SSE_POWERSHELL_EXE ??
  join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const sandbox = mkdtempSync(join(tmpdir(), "sse-native-build-cache-"));
const buildScript = join(sandbox, "build-native.ps1");
const loaderScript = join(sandbox, "load-native.ps1");
const validatorScript = join(sandbox, "validate-native.ps1");
const decoyBuildScript = join(sandbox, "build-decoy.ps1");
const source = join(sandbox, "sse-native.cs");
const dll = join(sandbox, "sse-native.dll");
const manifestPath = join(sandbox, "sse-native.sha256");
const originalBuildSource = readFileSync(join(root, "powershell", "build-native.ps1"), "utf8");
const originalLoaderSource = readFileSync(join(root, "powershell", "load-native.ps1"), "utf8");
const originalNativeSource = readFileSync(join(root, "powershell", "sse-native.cs"), "utf8");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const requiredMethods = (script, typeName) => {
  const surfaceStart = script.indexOf("$required = @{");
  assert(surfaceStart >= 0, "Native-Oberflaechenliste fehlt.");
  const match = script.slice(surfaceStart).match(new RegExp(`${typeName}=@\\(([\\s\\S]*?)\\)`));
  assert(match, `Native-Oberflaechenliste fuer ${typeName} fehlt.`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort();
};
const publicStaticMethods = (sourceText, classMarker, nextClassMarker) => {
  const start = sourceText.indexOf(classMarker);
  const end = nextClassMarker ? sourceText.indexOf(nextClassMarker, start + classMarker.length) : sourceText.length;
  assert(start >= 0 && end > start, `C#-Klassenabschnitt ${classMarker} fehlt.`);
  return [...sourceText.slice(start, end).matchAll(/public static(?: extern)?\s+[^\s(]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
    .map((entry) => entry[1])
    .sort();
};
const completeSurface = {
  DSK: publicStaticMethods(originalNativeSource, "public class DSK", "public sealed class SSEWorkerControllerLease"),
  SSEWorkerControllerLease: publicStaticMethods(
    originalNativeSource,
    "public sealed class SSEWorkerControllerLease",
    "public class SW",
  ),
  SW: publicStaticMethods(originalNativeSource, "public class SW", "public sealed class SSEAccNode"),
  SSEAccessible: publicStaticMethods(originalNativeSource, "public static class SSEAccessible", null),
};
for (const [typeName, methods] of Object.entries(completeSurface)) {
  assert.deepEqual(requiredMethods(originalBuildSource, typeName), methods, `Build prueft ${typeName} nicht vollstaendig.`);
  assert.deepEqual(requiredMethods(originalLoaderSource, typeName), methods, `Loader prueft ${typeName} nicht vollstaendig.`);
}
assert.equal(
  originalBuildSource.match(/Assert-SSENativeAssemblySurface \$assembly/g)?.length,
  2,
  "Cache-Hit und frischer Native-Build muessen dieselbe Oberflaeche pruefen.",
);

const powershellFile = (file, ...args) => execFileSync(
  powershell,
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, ...args],
  { cwd: sandbox, encoding: "utf8", windowsHide: true },
).trim();
const assertNoResidue = () => assert.deepEqual(
  readdirSync(sandbox).filter((name) => name.startsWith(".sse-native-")),
  [],
  "Native-Build darf keine temporaeren Ersetzungsdateien hinterlassen.",
);
const build = () => {
  const output = powershellFile(buildScript);
  assertNoResidue();
  return output;
};
const assertLoadable = () => assert.equal(powershellFile(validatorScript), "precompiled-dll");
const manifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));

try {
  copyFileSync(join(root, "powershell", "build-native.ps1"), buildScript);
  copyFileSync(join(root, "powershell", "load-native.ps1"), loaderScript);
  copyFileSync(join(root, "powershell", "sse-native.cs"), source);
  writeFileSync(
    validatorScript,
    `$ErrorActionPreference = 'Stop'\n. (Join-Path $PSScriptRoot 'load-native.ps1')\n` +
      `$result = Import-SSENativeInterop\nif ($result.mode -ne 'precompiled-dll') { throw $result.dllError }\n$result.mode\n`,
    "utf8",
  );
  writeFileSync(
    decoyBuildScript,
    `$ErrorActionPreference = 'Stop'\n` +
      `Add-Type -TypeDefinition 'public static class DSK {}' -OutputAssembly (Join-Path $PSScriptRoot 'sse-native.dll') -OutputType Library\n`,
    "utf8",
  );

  assert.match(build(), /^Built powershell\/sse-native\.dll /);
  const firstDllHash = sha256(dll);
  const firstManifest = manifest();
  assert.equal(firstManifest.dllSha256, firstDllHash);
  assertLoadable();

  assert.match(build(), /^Reused powershell\/sse-native\.dll /);
  assert.equal(sha256(dll), firstDllHash, "Unveraenderte Quelle muss dasselbe Native-Artefakt behalten.");
  assertLoadable();

  appendFileSync(source, "\r\n// cache invalidation fixture\r\n", "utf8");
  assert.match(build(), /^Built powershell\/sse-native\.dll /);
  const changedSourceManifest = manifest();
  assert.equal(changedSourceManifest.sourceSha256, sha256(source));
  assert.notEqual(changedSourceManifest.sourceSha256, firstManifest.sourceSha256);
  assert.match(build(), /^Reused powershell\/sse-native\.dll /);
  assertLoadable();

  rmSync(dll);
  powershellFile(decoyBuildScript);
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...changedSourceManifest, dllSha256: sha256(dll) })}\n`,
    "utf8",
  );
  assert.match(build(), /^Built powershell\/sse-native\.dll /);
  assertLoadable();

  writeFileSync(dll, "manipulated native helper\n", "utf8");
  assert.match(build(), /^Built powershell\/sse-native\.dll /);
  assert.equal(manifest().dllSha256, sha256(dll), "Manipulierte DLL muss neu gebaut und neu gebunden werden.");
  assertLoadable();

  writeFileSync(manifestPath, "{kaputt\n", "utf8");
  assert.match(build(), /^Built powershell\/sse-native\.dll /);
  assert.equal(manifest().dllSha256, sha256(dll), "Kaputtes Manifest muss durch einen Neubau ersetzt werden.");
  assertLoadable();

  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest(), extra: true })}\n`, "utf8");
  assert.match(build(), /^Built powershell\/sse-native\.dll /);

  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest(), schemaVersion: 2 })}\n`, "utf8");
  assert.match(build(), /^Built powershell\/sse-native\.dll /);

  rmSync(dll);
  assert.match(build(), /^Built powershell\/sse-native\.dll /);
  assertLoadable();

  rmSync(manifestPath);
  assert.match(build(), /^Built powershell\/sse-native\.dll /);
  assertLoadable();

  const completeSourceText = readFileSync(source, "utf8");
const incompleteSourceText = completeSourceText.replace(
    /^.*public static extern bool SetThreadDesktop\(IntPtr h\);\r?\n/m,
    "",
  );
  assert.notEqual(incompleteSourceText, completeSourceText, "Native-Test konnte die Zielmethode nicht entfernen.");
  writeFileSync(source, incompleteSourceText, "utf8");
  const incompleteBuild = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", buildScript],
    { cwd: sandbox, encoding: "utf8", windowsHide: true },
  );
  assert.notEqual(incompleteBuild.status, 0, "Unvollstaendiger Native-Compile wurde unerwartet akzeptiert.");
  assert.match(`${incompleteBuild.stdout}${incompleteBuild.stderr}`, /Native helper surface is incomplete/);
  assertNoResidue();
  writeFileSync(source, completeSourceText, "utf8");
  assert.match(build(), /^Reused powershell\/sse-native\.dll /);
  assertLoadable();

  process.stdout.write("Native-Build-Cache: Wiederverwendung und fail-closed Invalidierung bestanden\n");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
