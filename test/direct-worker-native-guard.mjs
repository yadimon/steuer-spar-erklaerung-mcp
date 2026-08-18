import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopMarkerState, directWorker, root, ssePids } from "./direct-worker-helpers.mjs";
import { WORKER_RUNTIME_FILES } from "./worker-fixture-files.mjs";

const pidsBefore = ssePids();
const markerBefore = desktopMarkerState();
const sourceFallback = directWorker("product_info", {}, { SSE_MCP_FORCE_NATIVE_SOURCE: "1" });
assert(sourceFallback.ok === true && sourceFallback.workerInitializationMs?.nativeInteropMode === "source-fallback",
  `Nativer Source-Fallback ist nicht funktionsfaehig: ${JSON.stringify(sourceFallback.workerInitializationMs)}`);

const driftRoot = mkdtempSync(join(tmpdir(), "sse-native-drift-"));
const driftDir = join(driftRoot, "powershell");
try {
  mkdirSync(driftDir, { recursive: true });
  for (const name of WORKER_RUNTIME_FILES.filter((name) => name !== "sse-native.sha256")) {
    copyFileSync(join(root, "powershell", name), join(driftDir, name));
  }
  cpSync(join(root, "profiles"), join(driftRoot, "profiles"), { recursive: true });
  const integrity = JSON.parse(readFileSync(join(root, "powershell", "sse-native.sha256"), "utf8"));
  writeFileSync(
    join(driftDir, "sse-native.sha256"),
    `${JSON.stringify({ ...integrity, sourceSha256: "0".repeat(64) })}\n`,
    "utf8",
  );
  const driftFallback = directWorker("product_info", {}, {}, join(driftDir, "sse-worker.ps1"));
  assert(driftFallback.ok === true && driftFallback.workerInitializationMs?.nativeInteropMode === "source-fallback",
    `Veraltete DLL wurde nicht durch Source-Fallback ersetzt: ${JSON.stringify(driftFallback.workerInitializationMs)}`);
  assert(driftFallback.workerInitializationMs?.nativeHashMatch === false && /veraltet/i.test(driftFallback.workerInitializationMs?.nativeDllError ?? ""),
    `Hash-Drift wurde nicht sichtbar gemeldet: ${JSON.stringify(driftFallback.workerInitializationMs)}`);

  copyFileSync(join(root, "powershell", "sse-native.sha256"), join(driftDir, "sse-native.sha256"));
  writeFileSync(join(driftDir, "sse-native.dll"), "manipulierte DLL\n", "utf8");
  const tamperedDllFallback = directWorker("product_info", {}, {}, join(driftDir, "sse-worker.ps1"));
  assert(
    tamperedDllFallback.ok === true &&
    tamperedDllFallback.workerInitializationMs?.nativeInteropMode === "source-fallback" &&
    tamperedDllFallback.workerInitializationMs?.nativeHashMatch === true &&
    tamperedDllFallback.workerInitializationMs?.nativeDllHashMatch === false,
    `Manipulierte DLL wurde nicht vor dem Laden gesperrt: ${JSON.stringify(tamperedDllFallback.workerInitializationMs)}`,
  );
  assert.match(tamperedDllFallback.workerInitializationMs?.nativeDllError ?? "", /DLL-Hash stimmt nicht/i);

  copyFileSync(join(root, "powershell", "sse-native.dll"), join(driftDir, "sse-native.dll"));
  writeFileSync(join(driftDir, "sse-native.sha256"), "x".repeat(1_025), "utf8");
  const oversizedManifestFallback = directWorker("product_info", {}, {}, join(driftDir, "sse-worker.ps1"));
  assert.equal(oversizedManifestFallback.workerInitializationMs?.nativeInteropMode, "source-fallback");
  assert.match(oversizedManifestFallback.workerInitializationMs?.nativeDllError ?? "", /kleines regulaeres Dokument/i);

  writeFileSync(join(driftDir, "sse-native.sha256"), Buffer.from([0xff]));
  const invalidUtf8ManifestFallback = directWorker("product_info", {}, {}, join(driftDir, "sse-worker.ps1"));
  assert.equal(invalidUtf8ManifestFallback.workerInitializationMs?.nativeInteropMode, "source-fallback");
  assert(invalidUtf8ManifestFallback.workerInitializationMs?.nativeDllError, "Ungueltiges UTF-8 muss sichtbar zum Fallback fuehren.");

  copyFileSync(join(root, "powershell", "sse-native.sha256"), join(driftDir, "sse-native.sha256"));
  writeFileSync(join(driftDir, "sse-native.dll"), "x", "utf8");
  truncateSync(join(driftDir, "sse-native.dll"), 4 * 1024 * 1024 + 1);
  const oversizedDllFallback = directWorker("product_info", {}, {}, join(driftDir, "sse-worker.ps1"));
  assert.equal(oversizedDllFallback.workerInitializationMs?.nativeInteropMode, "source-fallback");
  assert.match(oversizedDllFallback.workerInitializationMs?.nativeDllError ?? "", /groesser als 4194304 Bytes/i);
} finally {
  rmSync(driftRoot, { recursive: true, force: true });
}

assert.equal(ssePids(), pidsBefore, "Ein Native-Fallbacktest hat eine SSE-PID erzeugt oder beendet.");
assert.equal(desktopMarkerState(), markerBefore, "Ein Native-Fallbacktest hat den Desktop-Marker veraendert.");
process.stdout.write("Direkter Worker: Native-Source-Fallback, Quell- und DLL-Hashgrenzen bestanden\n");
