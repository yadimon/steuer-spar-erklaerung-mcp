import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
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
const publicStaticMethods = (sourceText, classMarker) => {
  // Keep offsets, but ignore braces and method-like text inside comments,
  // ordinary/verbatim strings and character literals. A following class is
  // not this class's boundary: new sibling types must not bleed into it.
  const code = sourceText.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|@"(?:""|[^"])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (token) => token.replace(/[^\r\n]/g, " "));
  const start = code.indexOf(classMarker);
  assert(start >= 0, `C#-Klassenabschnitt ${classMarker} fehlt.`);
  const open = code.indexOf("{", start + classMarker.length);
  assert(open >= 0, `C#-Klassenrumpf ${classMarker} fehlt.`);
  let depth = 1;
  let end = open + 1;
  while (end < code.length && depth) {
    if (code[end] === "{") depth++;
    else if (code[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0, `C#-Klassenrumpf ${classMarker} ist nicht geschlossen.`);
  const body = code.slice(open + 1, end - 1);
  const methods = [];
  let position = 0;
  depth = 0;
  for (const match of body.matchAll(/public static(?: extern)?\s+[^\s(]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    while (position < match.index) {
      if (body[position] === "{") depth++;
      else if (body[position] === "}") depth--;
      position++;
    }
    if (depth === 0) methods.push(match[1]);
  }
  return methods.sort();
};
assert.deepEqual(publicStaticMethods(
  'public static class First { string brace="}"; /* } */ public static void Own() {} ' +
    'public class Nested { public static void Other() {} } } public static class Next { public static void Sibling() {} }',
  "public static class First",
), ["Own"], "Native surface extraction must respect true class and nested-type boundaries.");
const completeSurface = {
  DSK: publicStaticMethods(originalNativeSource, "public class DSK", "public sealed class SSEWorkerControllerLease"),
  SSEWorkerControllerLease: publicStaticMethods(
    originalNativeSource,
    "public sealed class SSEWorkerControllerLease",
    "public class SW",
  ),
  SW: publicStaticMethods(originalNativeSource, "public class SW", "public sealed class SSEWindowNode"),
  SSEWindowNode: publicStaticMethods(
    originalNativeSource,
    "public sealed class SSEWindowNode",
    "public static class SSEWindowEnumerator",
  ),
  SSEWindowEnumerator: publicStaticMethods(
    originalNativeSource,
    "public static class SSEWindowEnumerator",
    "public static class SSEProcessCommandLine",
  ),
  SSEProcessCommandLine: publicStaticMethods(
    originalNativeSource,
    "public static class SSEProcessCommandLine",
    "public sealed class SSEAccNode",
  ),
  SSEAccessible: publicStaticMethods(
    originalNativeSource,
    "public static class SSEAccessible",
    "public sealed class SSEUiaScrollState",
  ),
  SSEAccDocumentNode: publicStaticMethods(originalNativeSource, "public sealed class SSEAccDocumentNode"),
  SSEAccDocumentSnapshot: publicStaticMethods(originalNativeSource, "public sealed class SSEAccDocumentSnapshot"),
  SSEUiaFreshRawResult: publicStaticMethods(originalNativeSource, "public sealed class SSEUiaFreshRawResult"),
  SSEUiaFreshRaw: publicStaticMethods(originalNativeSource, "public static class SSEUiaFreshRaw"),
  SSEUiaScrollState: publicStaticMethods(
    originalNativeSource,
    "public sealed class SSEUiaScrollState",
    "public sealed class SSEUiaNode",
  ),
  SSEUiaNode: publicStaticMethods(
    originalNativeSource,
    "public sealed class SSEUiaNode",
    "public sealed class SSEUiaSnapshot",
  ),
  SSEUiaSnapshot: publicStaticMethods(
    originalNativeSource,
    "public sealed class SSEUiaSnapshot",
    "public static class SSEUiaTree",
  ),
  SSEUiaTree: publicStaticMethods(originalNativeSource, "public static class SSEUiaTree", null),
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

  const coreBuild = spawnSync(
    "pwsh.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", buildScript],
    { cwd: sandbox, encoding: "utf8", windowsHide: true },
  );
  if (coreBuild.error?.code !== "ENOENT") {
    assert.equal(coreBuild.error, undefined, coreBuild.error?.message);
    assert.notEqual(coreBuild.status, 0, "PowerShell Core darf keine Produkt-DLL bauen.");
    assert.match(`${coreBuild.stdout}${coreBuild.stderr}`, /Windows PowerShell 5\.1/u);
    assert.equal(existsSync(dll), false, "Abgewiesener Core-Build darf keine DLL hinterlassen.");
  }

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
