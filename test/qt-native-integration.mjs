import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadQtNativePackage } from "../dist/qt-native-package.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { startQtNativeBroker } from "../dist/qt-native-broker.js";
import { runApiRuntime } from "../dist/api-runtime.js";
import { callApiOperationEnvelope } from "../dist/api-client.js";
import { requestApiShutdown } from "../dist/api-control-client.js";
import { discoverQtNativeTarget } from "../dist/qt-native-discovery.js";
import { desktopMarkerPath } from "../dist/desktop-marker.js";
import { executeNativeDesktopStatus } from "../dist/native-desktop-status.js";
import { pageProjectionOracle } from "./qt-native-page-projections.mjs";

assert.equal(process.argv.length, 7, "Run this test through qt-native-desktop.ps1 or CTest.");
const [packageConfig, executable, qtBin] = process.argv.slice(2, 5).map(path => resolve(path));
const [desktop, reportPath] = process.argv.slice(5);
assert.match(desktop, /^SSEQtNativeTest_[0-9]+$/u);
const temporary = mkdtempSync(join(tmpdir(), "sse-native-integration-"));
const config = JSON.parse(readFileSync(packageConfig, "utf8"));
const report = { scope: "Built native package, public API runtime, native discovery and owned Qt fixture; synthetic profile seam", checks: [], http: [] };
const sessions = [], fixtures = [], workerCalls = [];
let ready, shutdown = false;

async function fixture() {
  const infoPath = join(temporary, `fixture-${fixtures.length}.json`);
  const child = spawn(executable, [infoPath, desktop], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PATH: `${qtBin};${process.env.PATH}`, QT_QPA_PLATFORM_PLUGIN_PATH: join(dirname(qtBin), "plugins/platforms") } });
  const item = { child, exited: once(child, "exit"), diagnostic: "", output: "", pending: [] };
  fixtures.push(item);
  child.stderr.on("data", chunk => { item.diagnostic += chunk; });
  child.stdout.on("data", chunk => {
    item.output += chunk;
    while (item.output.includes("\n")) {
      const end = item.output.indexOf("\n"), line = item.output.slice(0, end).trim(); item.output = item.output.slice(end + 1);
      const waiting = item.pending.shift(); if (waiting) { clearTimeout(waiting.timer); waiting.resolve(line); }
    }
  });
  const deadline = Date.now() + 10_000;
  while (!existsSync(infoPath) && Date.now() < deadline && child.exitCode === null) await delay(20);
  assert(existsSync(infoPath), "Owned fixture did not become ready: " + item.diagnostic);
  item.info = JSON.parse(readFileSync(infoPath, "utf8"));
  assert.equal(item.info.pid, child.pid); assert.equal(item.info.desktop, desktop);
  assert.notEqual(item.info.inputDesktop, desktop); assert.equal(item.info.visible, true);
  item.command = command => new Promise((resolveLine, reject) => {
    const waiting = { resolve: resolveLine, timer: setTimeout(() => reject(Error("Fixture command timed out")), 5000) };
    item.pending.push(waiting); child.stdin.write(command + "\n");
  });
  return item;
}
async function read(op, args = {}) {
  const start = performance.now();
  const { result } = await callApiOperationEnvelope(op, args, 10_000, { baseUrl: ready.baseUrl });
  report.http.push({ op, ms: performance.now() - start, ok: result.ok, kind: result.kind }); return result;
}
async function stopRuntime() {
  if (!ready || shutdown) return;
  const health = await (await fetch(ready.baseUrl + "/healthz")).json();
  await requestApiShutdown({ confirm: true, instanceId: health.instanceId }, { baseUrl: ready.baseUrl, expectedInstanceId: health.instanceId });
  shutdown = true;
  await Promise.all(sessions.map(session => session.exited));
}
async function uiaSnapshot(hwnd) {
  const output = join(temporary, "uia-snapshot.json");
  const script = fileURLToPath(new URL("./qt-native-snapshot-uia.ps1", import.meta.url));
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", script, "-Hwnd", String(hwnd), "-OutputPath", output, "-Desktop", desktop],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let errors = ""; child.stderr.on("data", chunk => { errors += chunk; });
  const timer = setTimeout(() => child.kill(), 30_000);
  const [code] = await once(child, "exit"); clearTimeout(timer);
  assert.equal(code, 0, errors);
  return { nodes: JSON.parse(readFileSync(output, "utf8")), rect: JSON.parse(readFileSync(output + ".window.json", "utf8")) };
}

try {
  // Real production manifest/hash/profile verification comes before the fixture-only profile substitution.
  const validated = loadQtNativePackage(config.qtNativeRuntime, loadProductProfile("2025"));
  const nativePackage = { ...validated, manifest: { ...validated.manifest, profile: { id: "synthetic", qtVersion: "6.9.2" } } };
  const first = await fixture();
  process.env.TEMP = temporary; process.env.TMP = temporary;
  const marker = { schemaVersion: 1, owner: "sse", name: desktop, pid: first.info.pid };
  const markerPath = desktopMarkerPath();
  writeFileSync(markerPath, JSON.stringify(marker));
  const discoveryOptions = { package: nativePackage, expectedImage: executable, marker, timeoutMs: 5000 };
  const discoveryStarted = performance.now();
  assert.deepEqual(await discoverQtNativeTarget(discoveryOptions), {
    pid: first.info.pid, hwnd: first.info.hwnd, creationTime: first.info.creationTime, desktop,
  });
  report.discoveryMs = performance.now() - discoveryStarted;
  await assert.rejects(discoverQtNativeTarget({ ...discoveryOptions, hwnd: 1 }), error => error.kind === "no-window");
  await assert.rejects(discoverQtNativeTarget({ ...discoveryOptions, marker: { ...marker, pid: process.pid } }), error => error.kind === "native-binding");
  await assert.rejects(startQtNativeBroker({ package: nativePackage, expectedImage: executable, timeoutMs: 5000,
    target: { ...first.info, creationTime: "1" } }));
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port; await new Promise(resolveClose => listener.close(resolveClose));
  const configPath = join(temporary, "api.json");
  writeFileSync(configPath, JSON.stringify({ host: "127.0.0.1", port, profileId: "2025", sseExecutable: executable,
    workspaceDir: join(temporary, "workspace"), ...config }));
  ready = await runApiRuntime(configPath, { worker: async operation => {
    workerCalls.push(operation);
    assert.fail("Native reads unexpectedly invoked PowerShell: " + operation);
  }, qtNativeDependencies: { loadPackage: () => nativePackage, startSession: async options => {
    const session = await startQtNativeBroker(options); sessions.push(session); return session;
  } } });
  assert.equal(sessions.length, 0);
  // Real Win32 diagnostics do not attach a DLL, even for unsupported/stale processes.
  await first.command("lock-controller");
  assert.equal((await read("desktop_status")).kind, "worker-busy");
  await first.command("unlock-controller");
  await first.command("abandon-controller");
  assert.equal((await read("desktop_status")).kind, "worker-isolation-lost");
  await first.command("close-controller");
  await first.command("untitled-window");
  const status = await read("desktop_status");
  assert.equal(status.ok, true, JSON.stringify(status)); assert.equal(status.backend, "win32");
  assert.equal(status.desktopErreichbar, true); assert.equal(status.processIdentity.pid, first.info.pid);
  assert.equal(status.processIdentity.supported, false, "Fixture must not be classified as the installed tax product");
  assert.equal(status.aktiv, false); assert.equal(status.markeVeraltet, true); assert.deepEqual(status.fenster, []);
  await first.command("close-untitled");
  assert.equal(sessions.length, 0);
  const rawOptions = { package: nativePackage, profile: loadProductProfile("2025"), timeoutMs: 5000 };
  const changed = await executeNativeDesktopStatus({ ...rawOptions, readMarker: (() => {
    let count = 0; return () => ++count === 1 ? marker : { ...marker, pid: process.pid };
  })() });
  assert.equal(changed.kind, "native-binding");
  writeFileSync(markerPath, JSON.stringify({ ...marker, owner: "center-test" }));
  assert.match((await read("desktop_status")).note, /Center-Testmarker/);
  rmSync(markerPath);
  const noMarker = await read("desktop_status");
  assert.equal(noMarker.ok, true); assert.equal(noMarker.markeVeraltet, false); assert.equal(noMarker.aktiv, false);
  writeFileSync(markerPath, "invalid/desktop");
  assert.equal((await read("desktop_status")).kind, "desktop-marker-invalid");
  assert.equal((await read("get_value", { aid: "syntheticField" })).kind, "desktop-marker-invalid");
  assert.equal(sessions.length, 0);
  writeFileSync(markerPath, JSON.stringify({ ...marker, owner: "center-test" }));
  assert.equal((await read("get_value", { aid: "syntheticField" })).kind, "desktop-marker-owner");
  assert.equal(sessions.length, 0);
  writeFileSync(markerPath, JSON.stringify(marker));
  for (let count = 0; count < 12; ++count) {
    const result = await read("get_value", { aid: "syntheticField" });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.backend, "qt"); assert.equal(result.value, "Native field – пример");
  }
  assert.equal(sessions.length, 1); assert.deepEqual(workerCalls, []);
  const snapshot = await read("snapshot", { maxNodes: 5000 });
  assert.equal(snapshot.ok, true, JSON.stringify(snapshot)); assert.equal(snapshot.backend, "qt");
  assert.equal(snapshot.stats.truncated, false); assert.equal(snapshot.stats.n, snapshot.count);
  const sparseRead = await sessions[0].client.request("accessibility_snapshot",
    { maxNodes: 16, aidSuffixes: ["syntheticField"] }, 5000);
  assert.equal(sparseRead.result.ok, true, JSON.stringify(sparseRead.result));
  assert.equal(sparseRead.result.stats.truncated, false);
  assert.equal(sparseRead.result.stats.n, 1);
  assert.equal(sparseRead.result.nodes[0].aid.endsWith("syntheticField"), true);
  assert.equal(sparseRead.result.nodes[0].p, -1);
  assert.equal(sparseRead.result.nodes[0].d, 0);
  const containsRead = await sessions[0].client.request("accessibility_snapshot",
    { maxNodes: 5000, aidContains: ["synthetic"] }, 5000);
  assert.equal(containsRead.result.ok, true, JSON.stringify(containsRead.result));
  assert.equal(containsRead.result.stats.truncated, false);
  assert(containsRead.result.nodes.length >= 4);
  assert(containsRead.result.nodes.every(node => node.aid.includes("synthetic")));
  assert(containsRead.result.nodes.every(node => node.p === -1 && node.d === 0));
  const inventory = await sessions[0].client.request("window_inventory", {}, 5000);
  assert.equal(inventory.result.ok, true, JSON.stringify(inventory.result));
  assert(inventory.result.windows.some(window => window.hwnd === first.info.hwnd));
  assert(inventory.result.windows.every(window => window.pid === first.info.pid));
  assert(inventory.result.windows.every(window => typeof window.class === "string" && window.class.length > 0));
  assert(inventory.result.windows.every(window => typeof window.title === "string" && window.title.length > 0));
  assert(inventory.result.windows.every(window => typeof window.minimized === "boolean" && typeof window.hung === "boolean"));
  assert.equal(snapshot.canaryMs, null); assert.equal(snapshot.responsivenessCheck, "bounded-gui-thread");
  const independent = await uiaSnapshot(first.info.hwnd);
  const redactPassword = nodes => nodes.map(node => node.aid.endsWith("syntheticSecret") ? { ...node, val: null, ro: null } : node);
  assert.deepEqual(redactPassword(snapshot.nodes), redactPassword(independent.nodes), "Public native tree must match independent Windows UIA");
  assert(!JSON.stringify(snapshot).includes("must-not-be-exposed"));
  assert(snapshot.nodes.some(node => /^42\.-?\d+$/u.test(node.rid)), "Fixture must cover a native child-window fragment root");
  const fields = snapshot.nodes.filter(node => node.aid.endsWith("syntheticField"));
  assert.equal(fields.length, 1);
  const fieldRid = fields[0].rid;
  assert.equal((await read("get_value", { rid: fieldRid })).value, "Native field – пример");
  const limited = await read("snapshot", { maxNodes: 2 });
  assert.equal(limited.count, 2); assert.equal(limited.stats.truncated, true);
  assert.deepEqual(limited.nodes, snapshot.nodes.slice(0, 2));
  const filtered = await read("snapshot", { types: ["eDiT"], namedOnly: true, maxNodes: 5000 });
  assert.deepEqual(filtered.nodes, snapshot.nodes.filter(node => node.type === "Edit" && node.name));
  assert.equal(filtered.stats.n, snapshot.stats.n);
  const projectionCases = [
    { operation: "read_page", args: {} }, { operation: "read_page", args: { minX: -1000000, maxX: 1000000 } },
    { operation: "subpages", args: {} }, { operation: "find", args: { type: "CheckBox" } },
    { operation: "find", args: { aid: "syntheticFi?ld" } }, { operation: "find", args: { name: "Synthetic*", contains: true } },
    { operation: "find", args: { name: "Synthetic STRASSE" } },
  ].map(test => ({ ...test, nodes: redactPassword(independent.nodes).map(node => test.operation === "find"
    ? { ...node, val: null, ro: null, checked: null, selected: null } : node), rect: independent.rect, stats: snapshot.stats }));
  const oracle = await pageProjectionOracle(projectionCases);
  for (const [index, test] of projectionCases.entries()) {
    const result = await read(test.operation, test.args);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.backend, "qt");
    const { backend, nativeDurationMs, stats, ...projection } = result;
    const { stats: oracleStats, ...expected } = oracle.results[index];
    assert.deepEqual(projection, expected, test.operation + JSON.stringify(test.args));
  }
  assert.equal(oracle.results[0].heading, "Synthetic heading");
  assert(oracle.results[2].anzahl > 0, "Native fixture must expose a subpage action within the content bounds");
  report.checks.push("Native find/read_page/subpages match the actual Worker projection bodies over independently observed UIA nodes and Win32 bounds");
  assert.equal((await read("snapshot", { toolWindow: "unknown" })).kind, "bad-args");
  assert.equal((await read("snapshot", { toolWindow: "receiptManager" })).kind, "not-found");
  await first.command("open-tool");
  const tool = await read("snapshot", { toolWindow: "receiptManager" });
  assert.equal(tool.ok, true, JSON.stringify(tool)); assert.notEqual(tool.hwnd, first.info.hwnd);
  assert.equal(tool.toolWindow, "receiptManager");
  assert(tool.nodes.some(node => node.val === "Synthetic tool value"));
  assert.deepEqual(tool.nodes, (await uiaSnapshot(tool.hwnd)).nodes);
  await first.command("duplicate-tool");
  assert.equal((await read("snapshot", { toolWindow: "receiptManager" })).kind, "ambiguous");
  await first.command("close-tools");
  report.checks.push("Catalogue-bound nonmodal tool snapshots match independent UIA and reject duplicate window titles");
  report.checks.push("Public native snapshot matches independent UIA nodes, IDs, parents, geometry, types and values; limits and filters preserve original indices");
  report.checks.push("Actual Win32 discovery reads the owned marker and binds process/window birth without any PowerShell inventory or discovery seam");
  const actionTarget = snapshot.nodes.filter(node => node.aid.endsWith("syntheticAction"));
  assert.equal(actionTarget.length, 1);
  const actionResult = await sessions[0].client.requestAcknowledged("accessibility_action", {
    rid: actionTarget[0].rid, aid: actionTarget[0].aid, expectedName: "Synthetic action", action: "press",
  }, 5000);
  assert.equal(actionResult.result.ok, true, JSON.stringify(actionResult.result));
  assert.equal(actionResult.result.mutationAttempted, true);
  assert.equal(actionResult.receiptAcknowledged, true);
  await delay(200);
  assert.equal((await read("get_value", { aid: "syntheticField" })).value, "Changed by native action");
  report.checks.push("An exact runtime-ID, automation-ID and name-bound Qt action executes once and is receipt-acknowledged without physical input");
  const tableActionTarget = snapshot.nodes.filter(node => node.type === "DataItem" && node.name === "row-0-cell-0");
  assert.equal(tableActionTarget.length, 1);
  const tableAction = await sessions[0].client.requestAcknowledged("accessibility_action", {
    rid: tableActionTarget[0].rid, aid: tableActionTarget[0].aid,
    expectedName: tableActionTarget[0].name, action: "activate-table-cell",
  }, 5000);
  assert.equal(tableAction.result.ok, true, JSON.stringify(tableAction.result));
  assert.equal(tableAction.result.mutationAttempted, true);
  assert.equal(tableAction.receiptAcknowledged, true);
  await delay(200);
  assert.equal((await read("get_value", { aid: "syntheticField" })).value, "Changed by table action");
  report.checks.push("An exact Qt table-cell activation emits the table click without physical input");
  await first.command("change-field");
  assert.equal((await read("get_value", { aid: "syntheticField" })).value, "Changed by fixture");
  assert.equal((await read("get_value", { rid: fieldRid })).value, "Changed by fixture");
  const password = await read("get_value", { aid: "syntheticSecret" }); assert.equal(password.ok, false);
  const table = await read("table_read", { maxRows: 600 });
  assert.equal(table.ok, true, JSON.stringify(table)); assert.equal(table.nativeTable.modelRows, 500);
  assert.equal(table.vollstaendig, true); assert.equal(table.anzahl, 499); assert.equal(table.kopf.length, 6);
  await first.command("change-cell");
  assert.equal((await read("table_read", { maxRows: 1 })).zeilen[0][4], "Changed cell");
  report.checks.push("Fresh public HTTP field/table reads use one lazy OS-verified native broker; hidden rows/columns and password controls are handled");
  for (const op of ["field_set_value", "table_set_cell", "select_navigation", "save_disposable"]) {
    const rejected = await sessions[0].client.requestAcknowledged(op);
    assert.equal(rejected.result.code, "UNSUPPORTED_OPERATION"); assert.equal(rejected.result.mutationAttempted, false);
    assert.equal(rejected.receiptAcknowledged, false);
  }
  assert.equal((await read("get_value", { aid: "syntheticField" })).value, "Changed by fixture");
  report.checks.push("Generic field, table, navigation and save mutations remain unavailable through the distributed bridge");
  const second = await fixture();
  await assert.rejects(discoverQtNativeTarget(discoveryOptions), error => error.kind === "ambiguous");
  assert.equal((await discoverQtNativeTarget({ ...discoveryOptions, hwnd: first.info.hwnd })).pid, first.info.pid);
  await assert.rejects(discoverQtNativeTarget({ ...discoveryOptions, hwnd: second.info.hwnd }), error => error.kind === "native-binding");
  assert.equal((await read("get_value", { aid: "syntheticField" })).kind, "ambiguous");
  assert.equal((await read("get_value", { aid: "syntheticField", hwnd: first.info.hwnd })).ok, true);
  second.child.stdin.write("quit\n"); await second.exited; assert.equal(second.child.exitCode, 0);
  writeFileSync(markerPath, JSON.stringify({ ...marker, pid: second.info.pid }));
  const deadStatus = await read("desktop_status");
  assert.equal(deadStatus.ok, true); assert.equal(deadStatus.processIdentity, null); assert.equal(deadStatus.markeVeraltet, true);
  writeFileSync(markerPath, JSON.stringify({ ...marker, name: desktop + "_Absent" }));
  const missingDesktop = await read("desktop_status");
  assert.equal(missingDesktop.ok, true, JSON.stringify(missingDesktop)); assert.equal(missingDesktop.desktopErreichbar, false);
  writeFileSync(markerPath, JSON.stringify(marker));
  report.checks.push("Public desktop_status uses fresh Win32 diagnostics without injection/PowerShell; absent, malformed, foreign, stale and changed markers are checked");
  await assert.rejects(discoverQtNativeTarget({ ...discoveryOptions, marker: { ...marker, pid: second.info.pid } }), error => error.kind === "desktop-marker-stale");
  await first.command("disable"); assert.equal((await read("get_value", { aid: "syntheticField" })).ok, false);
  await first.command("enable"); assert.equal((await read("get_value", { aid: "syntheticField" })).ok, true);
  await first.command("delete-field"); assert.equal((await read("get_value", { aid: "syntheticField" })).kind, "not-found");
  assert.equal((await read("get_value", { rid: fieldRid })).kind, "not-found");
  report.checks.push("New window ambiguity, disabled windows and destroyed QObjects are observed on the retained connection");
  await stopRuntime(); assert.equal(first.child.exitCode, null);
  report.checks.push("API shutdown ends every native helper while the target application remains alive");
  report.ok = true;
} catch (error) {
  report.error = error.stack; process.exitCode = 1;
} finally {
  try { await stopRuntime(); } catch (error) { report.shutdownError = error.message; process.exitCode = 1; }
  for (const session of sessions) await session.close();
  for (const item of fixtures) {
    if (item.child.exitCode === null) { item.child.stdin.write("quit\n"); await Promise.race([item.exited, delay(3000)]); }
    if (item.child.exitCode === null) { item.child.kill(); process.exitCode = 1; }
    await item.exited; assert.equal(item.child.exitCode, 0, item.diagnostic);
  }
  report.ok = Boolean(report.ok && !process.exitCode); report.fixtureCount = fixtures.length;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  rmSync(resolve(temporary), { recursive: true, force: true });
}
