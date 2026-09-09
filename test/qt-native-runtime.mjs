import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { parseQtNativeRuntimeConfig } from "../dist/qt-native-config.js";
import { loadQtNativePackage } from "../dist/qt-native-package.js";
import { createQtNativeRuntime } from "../dist/qt-native-runtime.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { loadApiServerConfig } from "../dist/api-config.js";
import { configurationFingerprint } from "../dist/configuration-fingerprint.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";
import { startQtNativeBroker } from "../dist/qt-native-broker.js";
import { discoverQtNativeTarget, parseQtNativeDiscovery } from "../dist/qt-native-discovery.js";
import { DesktopMarkerError } from "../dist/desktop-marker.js";
import { executeNativeDesktopStatus, parseNativeDesktopStatus } from "../dist/native-desktop-status.js";
import { verifyNativeDesktopStartContract } from "./native-desktop-start-contract.mjs";
import { verifyNativeDesktopStopContract } from "./native-desktop-stop-contract.mjs";

await verifyNativeDesktopStartContract();
await verifyNativeDesktopStopContract();

const temporary = mkdtempSync(join(tmpdir(), "sse-native-runtime-"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const profile = loadProductProfile("2025");
const nativeDirectory = join(temporary, "native");
mkdirSync(nativeDirectory);
const manifest = {
  schemaVersion: 1, startupAbi: 2, bridgeProtocol: 1, discoveryProtocol: 1, buildIdentity: `SSE_NATIVE_BRIDGE_V2:${"a".repeat(64)}`,
  profile: { id: profile.id, taxYear: profile.taxYear, engineFileMajor: profile.engineFileMajor,
    verifiedBuild: profile.verifiedBuild, qtVersion: profile.nativeQtVersion },
  loader: { file: "bridge-load.exe", sha256: digest("loader-fixture") },
  bridge: { file: "sse-qt-read.dll", sha256: digest("bridge-fixture") },
};
function packageConfig(value = manifest) {
  const bytes = Buffer.from(JSON.stringify(value));
  writeFileSync(join(nativeDirectory, "manifest.json"), bytes);
  return { directory: nativeDirectory, manifestSha256: digest(bytes) };
}
const configPath = join(temporary, "config.json");
const deferred = () => {
  let resolvePending, rejectPending;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolvePending = resolvePromise; rejectPending = rejectPromise; });
  return { promise, resolve: resolvePending, reject: rejectPending };
};
const kind = expected => error => error instanceof QtNativeTransportError && error.kind === expected;

try {
  writeFileSync(join(nativeDirectory, "bridge-load.exe"), "loader-fixture");
  writeFileSync(join(nativeDirectory, "sse-qt-read.dll"), "bridge-fixture");
  const nativeConfig = packageConfig();
  assert.equal(parseQtNativeRuntimeConfig(undefined), undefined);
  assert.deepEqual(parseQtNativeRuntimeConfig(nativeConfig), nativeConfig);
  for (const invalid of [null, {}, { ...nativeConfig, extra: true }, { ...nativeConfig, directory: "relative" },
    { ...nativeConfig, directory: "\\\\server\\share" }, { ...nativeConfig, directory: `${temporary}\n` },
    { ...nativeConfig, manifestSha256: "A".repeat(64) }]) {
    assert.throws(() => parseQtNativeRuntimeConfig(invalid), /qtNativeRuntime/);
  }
  const nativePackage = loadQtNativePackage(nativeConfig, profile);
  const statusMarker = { schemaVersion: 1, owner: "sse", name: "Owned", pid: 99 };
  const statusOptions = { package: nativePackage, profile, timeoutMs: 1000 };
  const rawStatus = { ok: true, desktop: "Owned", pid: 99, reachable: true, loaderBuildIdentity: manifest.buildIdentity, loaderMs: 1,
    process: { image: "C:\\Product\\Steuerjahr 2025\\SSE.exe", creationTime: "1", fileMajor: 31, fileVersion: "31.0.2.0", productName: "SSE" },
    windows: [{ hwnd: 42, pid: 99, x: 0, y: 0, w: 1200, h: 800, cls: "Qt692QWindowIcon", title: "Synthetic", hung: false, minimiert: false }] };
  const activeStatus = parseNativeDesktopStatus(rawStatus, statusMarker, statusOptions);
  assert.equal(activeStatus.aktiv, true); assert.equal(activeStatus.sseLaeuft, true); assert.equal(activeStatus.markeVeraltet, false);
  assert.equal(activeStatus.processIdentity.taxYear, 2025); assert.equal(activeStatus.fenster[0].titleFingerprint, digest("Synthetic").toUpperCase());
  for (const patch of [{ fileMajor: 30 }, { image: "C:\\Product\\Steuerjahr 2024\\SSE.exe" }, { image: "C:\\Product\\Steuerjahr 2025\\Other.exe" }]) {
    const status = parseNativeDesktopStatus({ ...rawStatus, process: { ...rawStatus.process, ...patch } }, statusMarker, statusOptions);
    assert.equal(status.aktiv, false); assert.equal(status.markeVeraltet, true); assert.deepEqual(status.fenster, []);
  }
  for (const patch of [{ desktop: "Other" }, { pid: 98 }, { loaderBuildIdentity: "other" }, { reachable: false },
    { windows: [{ ...rawStatus.windows[0], pid: 98 }] }]) assert.throws(() => parseNativeDesktopStatus({ ...rawStatus, ...patch }, statusMarker, statusOptions));
  const absent = await executeNativeDesktopStatus({ ...statusOptions, readMarker: () => null });
  assert.equal(absent.ok, true); assert.equal(absent.aktiv, false); assert.equal(absent.markeVeraltet, false);
  assert.equal((await executeNativeDesktopStatus({ ...statusOptions, timeoutMs: 0, readMarker: () => null })).kind, "native-deadline");
  const cancelStatus = new AbortController(); cancelStatus.abort();
  assert.equal((await executeNativeDesktopStatus({ ...statusOptions, signal: cancelStatus.signal, readMarker: () => null })).kind, "aborted");
  let markerReads = 0;
  assert.equal((await executeNativeDesktopStatus({ ...statusOptions, readMarker: () => ++markerReads === 1 ? null : statusMarker })).kind, "native-binding");
  assert.equal((await executeNativeDesktopStatus({ ...statusOptions, readMarker: () => { throw new DesktopMarkerError("Malformed", "desktop-marker-invalid"); } })).kind,
    "desktop-marker-invalid");
  assert.equal(nativePackage.loaderPath, join(nativeDirectory, "bridge-load.exe"));
  assert.throws(() => loadQtNativePackage({ ...nativeConfig, manifestSha256: "0".repeat(64) }, profile), /digest mismatch/);
  assert.throws(() => loadQtNativePackage(nativeConfig, { ...profile, nativeQtVersion: "0.0.0" }), /compatibility/);
  assert.throws(() => loadQtNativePackage(nativeConfig, { ...profile, status: "experimental" }), /no supported/);
  assert.throws(() => loadQtNativePackage(packageConfig({ ...manifest, extra: true }), profile));
  assert.throws(() => loadQtNativePackage(packageConfig({ ...manifest, discoveryProtocol: undefined }), profile));
  assert.throws(() => loadQtNativePackage(packageConfig({ ...manifest, loader: { ...manifest.loader, file: "../loader.exe" } }), profile));
  packageConfig();
  writeFileSync(nativePackage.bridgePath, "tampered-fixture");
  assert.throws(() => loadQtNativePackage(nativeConfig, profile), /digest mismatch/);
  writeFileSync(nativePackage.bridgePath, "bridge-fixture");
  writeFileSync(configPath, JSON.stringify({ qtNativeRuntime: nativeConfig, sseExecutable: join(temporary, "SSE.exe") }));
  const config = loadApiServerConfig({ SSE_API_CONFIG: configPath });
  assert.deepEqual(config.qtNativeRuntime, nativeConfig);
  assert.notEqual(configurationFingerprint(config), configurationFingerprint({ ...config, qtNativeRuntime: undefined }));
  assert.notEqual(configurationFingerprint(config), configurationFingerprint({ ...config, qtNativeRuntime: { ...nativeConfig, manifestSha256: "b".repeat(64) } }));
  assert.notEqual(configurationFingerprint(config), configurationFingerprint({ ...config, qtNativeRuntime: { ...nativeConfig, directory: temporary } }));
  assert.equal(configurationFingerprint(config), configurationFingerprint({ ...config, qtNativeRuntime: { ...nativeConfig, directory: resolve(nativeDirectory, ".") } }));
  writeFileSync(configPath, "{}");
  const legacy = loadApiServerConfig({ SSE_API_CONFIG: configPath, SSE_QT_NATIVE_RUNTIME: JSON.stringify(nativeConfig) });
  assert.equal(legacy.qtNativeRuntime, undefined, "An unrecognized environment variable must not enable native injection.");
  assert.equal(configurationFingerprint(legacy), configurationFingerprint({ ...legacy, qtNativeRuntime: undefined }));

  function harness(options = {}) {
    const shutdown = new AbortController(), calls = [], starts = [], sessions = [];
    const state = { target: { pid: 99, hwnd: 42, creationTime: "1" }, marker: null,
      context: { ok: true, boundMain: true, unique: true }, closed: 0, reads: 0 };
    const runtime = createQtNativeRuntime(config, profile, shutdown.signal, {
      loadPackage: () => nativePackage,
      readMarker: () => { if (state.markerError) throw state.markerError; return state.marker; },
      discoverTarget: async request => {
        calls.push("discover");
        await options.inventoryWait?.("discover", request.signal);
        if (state.discoveryError) throw state.discoveryError;
        return { ...state.target, ...(request.marker ? { desktop: request.marker.name } : {}) };
      },
      startSession: async request => {
        starts.push(request);
        await options.startWait?.(request);
        const session = {
          client: { binding: request.target, async request(operation) {
            assert.equal(operation, "window_context"); state.reads++;
            if (state.connectionError) throw state.connectionError;
            return { result: state.context };
          } },
          brokerPid: 123, exited: Promise.resolve(), async close() { state.closed++; },
        };
        sessions.push(session); return session;
      },
    });
    return { runtime, shutdown, calls, starts, sessions, state };
  }

  const h = harness();
  const first = await h.runtime.client({}, 1000);
  assert.equal(await h.runtime.client({}, 1000), first);
  assert.equal(await h.runtime.client({ hwnd: 42 }, 1000), first);
  assert.deepEqual(h.calls, ["discover"]);
  assert.equal(h.starts.length, 1);
  assert.equal(h.state.reads, 3, "Every cached use must verify current native window context.");
  h.state.context.unique = false;
  await assert.rejects(h.runtime.client({}, 1000), kind("ambiguous"));
  assert.equal(await h.runtime.client({ hwnd: 42 }, 1000), first);
  h.state.context.boundMain = false;
  await assert.rejects(h.runtime.client({ hwnd: 42 }, 1000), kind("stale-window"));
  h.state.context = { ok: false, code: "worker-isolation-lost", outcomeUnknown: true };
  await assert.rejects(h.runtime.client({}, 1000), error => kind("worker-isolation-lost")(error) && error.outcomeUnknown);
  h.state.context = { ok: true, boundMain: true, unique: true };
  h.state.connectionError = new QtNativeTransportError("Disconnected", "native-connection", true);
  await assert.rejects(h.runtime.client({}, 1000), kind("native-connection"));
  await assert.rejects(h.runtime.client({}, 1000), kind("native-connection"));
  assert.equal(h.starts.length, 1, "Failed bound sessions must not automatically reconnect.");
  await h.runtime.afterWorker("window_close", { ok: false });
  assert.equal(h.state.closed, 0);
  await h.runtime.afterWorker("window_close", { ok: true });
  assert.equal(h.state.closed, 1);
  delete h.state.connectionError;
  await h.runtime.client({}, 1000);
  assert.equal(h.starts.length, 2);
  h.shutdown.abort(); await h.runtime.close();
  assert.equal(h.state.closed, 2);
  await assert.rejects(h.runtime.client({}, 1000), kind("aborted"));

  const multiple = harness(); multiple.state.discoveryError = new QtNativeTransportError("Multiple windows", "ambiguous");
  await assert.rejects(multiple.runtime.client({}, 1000), kind("ambiguous"));
  assert.equal(multiple.starts.length, 0);
  delete multiple.state.discoveryError; multiple.state.target = { hwnd: 43, pid: 100, creationTime: "2" };
  await multiple.runtime.client({ hwnd: 43 }, 1000);
  assert.equal(multiple.starts[0].target.hwnd, 43);
  multiple.state.target = { hwnd: 44, pid: 100, creationTime: "2" };
  await assert.rejects(multiple.runtime.client({ hwnd: 44 }, 1000), kind("native-window-conflict"));
  await multiple.runtime.close();
  for (const expected of ["desktop-marker-stale", "native-binding"]) {
    const rejected = harness(); rejected.state.discoveryError = new QtNativeTransportError("Discovery rejected", expected);
    await assert.rejects(rejected.runtime.client({}, 1000), kind(expected));
    assert.equal(rejected.starts.length, 0); await rejected.runtime.close();
  }
  const malformed = harness(); malformed.state.markerError = new DesktopMarkerError("Invalid marker", "desktop-marker-invalid");
  await assert.rejects(malformed.runtime.client({}, 1000), kind("desktop-marker-invalid"));
  assert.equal(malformed.calls.length, 0); await malformed.runtime.close();
  const foreign = harness(); foreign.state.markerError = new DesktopMarkerError("Foreign marker", "desktop-marker-owner");
  await assert.rejects(foreign.runtime.client({}, 1000), kind("desktop-marker-owner"));
  assert.equal(foreign.calls.length, 0); await foreign.runtime.close();
  const owned = harness(); owned.state.marker = { schemaVersion: 1, owner: "sse", name: "Private", pid: 99 };
  await owned.runtime.client({}, 1000); assert.equal(owned.starts[0].target.desktop, "Private"); await owned.runtime.close();

  const markerGate = deferred(), markerChanged = harness({ inventoryWait: () => markerGate.promise });
  const staleMarker = assert.rejects(markerChanged.runtime.client({}, 5000), kind("native-binding"));
  await nextTurn(); markerChanged.state.marker = { schemaVersion: 1, owner: "sse", name: "Private", pid: 99 };
  markerGate.resolve(); await staleMarker; assert.equal(markerChanged.starts.length, 0); await markerChanged.runtime.close();

  const gate = deferred(), concurrent = harness({ startWait: () => gate.promise });
  const initial = concurrent.runtime.client({}, 5000); await nextTurn();
  const cancelled = new AbortController();
  const waiting = assert.rejects(concurrent.runtime.client({}, 5000, cancelled.signal), kind("aborted"));
  cancelled.abort(); await waiting;
  await assert.rejects(concurrent.runtime.client({}, 20), kind("native-timeout"));
  const second = concurrent.runtime.client({}, 5000);
  gate.resolve(); assert.equal(await second, await initial);
  assert.equal(concurrent.starts.length, 1); await concurrent.runtime.close();

  const inventoryGate = deferred(), duringInventory = harness({ inventoryWait: () => inventoryGate.promise });
  const superseded = assert.rejects(duringInventory.runtime.client({}, 5000), kind("aborted"));
  await nextTurn(); await duringInventory.runtime.afterWorker("launch", { ok: true });
  inventoryGate.resolve(); await superseded;
  assert.equal(duringInventory.starts.length, 0, "Lifecycle invalidation must not inject after a delayed inventory.");
  await duringInventory.runtime.close();

  const startGate = deferred(), duringStart = harness({ startWait: () => startGate.promise });
  const late = assert.rejects(duringStart.runtime.client({}, 5000), kind("native-session-changed"));
  await nextTurn(); duringStart.shutdown.abort(); startGate.resolve(); await late; await duringStart.runtime.close();
  assert.equal(duringStart.state.closed, 1, "A late attachment must be closed before it can be reused.");

  let providerCalls = 0;
  const execute = createApiExecutor(config, async () => assert.fail("Unexpected worker"), {
    qtNativeClientFor: async () => { providerCalls++; throw new QtNativeTransportError("Lost attachment", "native-startup", true); },
  });
  assert.equal((await execute("get_value", { aid: "field", unexpected: true }, 1000)).ok, false);
  const unverified = createApiExecutor({ ...config, profileId: "2024" }, async () => assert.fail("Unexpected worker"), {
    qtNativeClientFor: async () => { providerCalls++; assert.fail("Unverified profile attached"); },
  });
  assert.equal((await unverified("get_value", { aid: "field" }, 1000)).kind, "profile-unverified");
  assert.equal(providerCalls, 0, "Invalid selectors must be rejected before native startup.");
  const failure = await execute("get_value", { aid: "field" }, 1000);
  assert.equal(failure.kind, "native-startup"); assert.equal(failure.outcomeUnknown, true); assert.equal(providerCalls, 1);
  const stopped = new AbortController(); stopped.abort();
  const discoveryOptions = { package: nativePackage, expectedImage: config.sseExecutable, marker: null, timeoutMs: 1000 };
  const identity = { ok: true, pid: 99, hwnd: 42, creationTime: "1", image: config.sseExecutable, sessionId: 1,
    bindingDiscovered: true, binaryIdentityVerified: true, loaderBuildIdentity: manifest.buildIdentity, profile: manifest.profile };
  assert.deepEqual(parseQtNativeDiscovery(identity, discoveryOptions), { pid: 99, hwnd: 42, creationTime: "1" });
  for (const changed of [{ pid: 0 }, { creationTime: "18446744073709551616" }, { hwnd: 0 }, { image: "C:\\different.exe" },
    { binaryIdentityVerified: false }, { loaderBuildIdentity: "other" }, { desktop: "Other" }, { profile: { ...manifest.profile, id: "2024" } }]) {
    assert.throws(() => parseQtNativeDiscovery({ ...identity, ...changed }, discoveryOptions));
  }
  assert.throws(() => parseQtNativeDiscovery(identity, { ...discoveryOptions, hwnd: 43 }));
  assert.throws(() => parseQtNativeDiscovery({ ...identity, desktop: "Private" }, {
    ...discoveryOptions, marker: { schemaVersion: 1, owner: "sse", name: "Private", pid: 98 },
  }));
  await assert.rejects(discoverQtNativeTarget({ ...discoveryOptions, signal: stopped.signal }), kind("aborted"));
  await assert.rejects(discoverQtNativeTarget({ ...discoveryOptions, timeoutMs: 0 }), kind("native-deadline"));
  await assert.rejects(discoverQtNativeTarget({ ...discoveryOptions, expectedImage: "relative" }), kind("native-binding"));
  await assert.rejects(discoverQtNativeTarget({ ...discoveryOptions, marker: { name: "../Other", owner: "sse", pid: 99 } }), kind("desktop-marker-invalid"));
  await assert.rejects(startQtNativeBroker({ package: nativePackage, target: { pid: 99, hwnd: 42 },
    expectedImage: config.sseExecutable, timeoutMs: 1000, signal: stopped.signal }), kind("aborted"));
  await assert.rejects(startQtNativeBroker({ package: nativePackage, target: { pid: 0, hwnd: 42 },
    expectedImage: config.sseExecutable, timeoutMs: 1000 }), kind("native-binding"));
  console.log("OK: pinned native package, opt-in configuration, lazy session reuse, window ownership, deadlines and lifecycle invalidation.");
} finally {
  assert(temporary.startsWith(join(tmpdir(), "sse-native-runtime-")));
  rmSync(temporary, { recursive: true, force: true });
}
