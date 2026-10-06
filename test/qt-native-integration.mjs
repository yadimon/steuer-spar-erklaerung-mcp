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
import { readQtNativeSnapshot } from "../dist/qt-native-snapshot.js";

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
async function uiaSnapshot(hwnd, withCellStates = false) {
  const output = join(temporary, "uia-snapshot.json");
  const script = fileURLToPath(new URL("./qt-native-snapshot-uia.ps1", import.meta.url));
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", script, "-Hwnd", String(hwnd), "-OutputPath", output, "-Desktop", desktop, ...(withCellStates ? ["-WithCellStates"] : [])],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let errors = ""; child.stderr.on("data", chunk => { errors += chunk; });
  const timer = setTimeout(() => child.kill(), 30_000);
  const [code] = await once(child, "exit"); clearTimeout(timer);
  assert.equal(code, 0, errors);
  return { nodes: JSON.parse(readFileSync(output, "utf8")), rect: JSON.parse(readFileSync(output + ".window.json", "utf8")),
    cells: JSON.parse(readFileSync(output + ".cells.json", "utf8")) };
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
  await first.command("accessibility-status");
  const preActivation = await read("get_value", { aid: "syntheticRateModel" });
  assert.equal(preActivation.ok, true, JSON.stringify(preActivation));
  assert.equal(preActivation.value, "inactive", "Fresh fixture must start without an external accessibility client");
  assert.equal((await read("snapshot", { maxNodes: 5000 })).ok, true);
  await first.command("accessibility-status");
  assert.equal((await read("get_value", { aid: "syntheticRateModel" })).value, "active");
  // Cache a nested cell, replace its model row, and read it again before any
  // Windows UIA client can activate accessibility on our behalf.
  await first.command("open-navigation-tool");
  const beforeReset = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "Synthetic navigation" }, 5000);
  assert(beforeReset.nodes.some(node => node.name === "Nested target"));
  await first.command("replace-navigation-row");
  const afterReset = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "Synthetic navigation" }, 5000);
  assert(afterReset.nodes.some(node => node.name === "Replacement target"));
  assert(!afterReset.nodes.some(node => node.name === "Nested target"));
  await first.command("close-navigation-tool");
  await first.command("reset-accessibility-status");
  report.checks.push("The direct client activates platform accessibility before caching; replaced nested model rows remain complete before any UIA client attaches");
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
  assert.equal(typeof containsRead.result.root?.aid, "string"); assert.equal(typeof containsRead.result.root?.name, "string");
  const inventory = await sessions[0].client.request("window_inventory", {}, 5000);
  assert.equal(inventory.result.ok, true, JSON.stringify(inventory.result));
  assert(inventory.result.windows.some(window => window.hwnd === first.info.hwnd));
  assert(inventory.result.windows.every(window => window.pid === first.info.pid));
  assert(inventory.result.windows.every(window => typeof window.class === "string" && window.class.length > 0));
  assert(inventory.result.windows.every(window => typeof window.title === "string" && window.title.length > 0));
  assert(inventory.result.windows.every(window => typeof window.minimized === "boolean" && typeof window.hung === "boolean"));
  assert(inventory.result.windows.every(window => [window.x, window.y, window.w, window.h].every(Number.isSafeInteger)));
  assert(inventory.result.windows.every(window => window.w > 0 && window.h > 0));
  const orders = [...inventory.result.windows, ...inventory.result.untitledWindows].map(window => window.order);
  assert(orders.every(order => Number.isSafeInteger(order) && order >= 0) && new Set(orders).size === orders.length);
  assert(Array.isArray(inventory.result.untitledWindows) && Number.isSafeInteger(inventory.result.visibleWindowCount));
  assert(inventory.result.visibleWindowCount >= inventory.result.windows.length + inventory.result.untitledWindows.length);
  assert(Number.isSafeInteger(inventory.result.productWindowCount) && inventory.result.productWindowCount >= inventory.result.visibleWindowCount);
  assert.equal(snapshot.canaryMs, null); assert.equal(snapshot.responsivenessCheck, "bounded-gui-thread");
  const independent = await uiaSnapshot(first.info.hwnd, true);
  const cellSnapshot = await sessions[0].client.request("accessibility_snapshot", { withValues: true, withCellStates: true, maxNodes: 5000 }, 5000);
  assert.equal(cellSnapshot.result.ok, true, JSON.stringify(cellSnapshot.result));
  for (const cell of independent.cells) {
    const nativeCell = cellSnapshot.result.nodes.find(node => node.rid === cell.rid);
    assert(nativeCell, `Missing native cell ${cell.name}`);
    assert.equal(nativeCell.checked, cell.checked, `Native cell ${cell.name} must match independent UIA TogglePattern`);
  }
  assert(snapshot.nodes.filter(node => node.type === "DataItem").every(node => node.checked === null));
  const checkableRids = new Set(independent.cells.filter(cell => cell.toggleState !== null).map(cell => cell.rid));
  assert(cellSnapshot.result.nodes.filter(node => node.type === "DataItem" && !checkableRids.has(node.rid))
    .every(node => node.checked === null));
  // The inventory's geometry is the same GetWindowRect the independent read reports, and its counters move
  // with a real untitled Win32 window of the fixture process: one visible window more, no title, the Static class.
  const mainInventory = inventory.result.windows.find(window => window.hwnd === first.info.hwnd);
  assert.deepEqual({ x: mainInventory.x, y: mainInventory.y, w: mainInventory.w, h: mainInventory.h }, independent.rect);
  assert.equal(inventory.result.productWindowCount, inventory.result.visibleWindowCount, "One fixture process: the product count is its own count");
  await first.command("untitled-window");
  const withUntitled = await sessions[0].client.request("window_inventory", {}, 5000);
  assert.equal(withUntitled.result.ok, true, JSON.stringify(withUntitled.result));
  const existingUntitled = new Set(inventory.result.untitledWindows.map(window => window.hwnd));
  const addedUntitled = withUntitled.result.untitledWindows.filter(window => !existingUntitled.has(window.hwnd));
  assert.equal(addedUntitled.length, 1);
  assert.equal(withUntitled.result.untitledWindows.length, inventory.result.untitledWindows.length + 1);
  const [untitledEntry] = addedUntitled;
  assert(!("title" in untitledEntry));
  assert.equal(untitledEntry.class, "Static"); assert.equal(untitledEntry.pid, first.info.pid);
  assert.equal(untitledEntry.w, 100); assert.equal(untitledEntry.h, 80);
  assert.equal(withUntitled.result.windows.length, inventory.result.windows.length);
  assert.equal(withUntitled.result.visibleWindowCount, inventory.result.visibleWindowCount + 1);
  assert.equal(withUntitled.result.productWindowCount, withUntitled.result.visibleWindowCount);
  await first.command("close-untitled");
  const afterUntitled = await sessions[0].client.request("window_inventory", {}, 5000);
  assert.equal(afterUntitled.result.ok, true, JSON.stringify(afterUntitled.result));
  assert.deepEqual(afterUntitled.result.untitledWindows.map(window => window.hwnd), [...existingUntitled]);
  report.checks.push("Process window inventory reports Win32 geometry, an untitled window and counters that move with it");
  // Real Windows input indicators can be untitled; every new projection must still read this fixture through Qt.
  const projectedPage = await read("page", { hwnd: first.info.hwnd });
  assert.equal(projectedPage.ok, true, JSON.stringify(projectedPage)); assert.equal(projectedPage.backend, "qt");
  assert.equal(projectedPage.ueberschrift, "Synthetic heading");
  const projectedState = await read("ui_state", { hwnd: first.info.hwnd });
  assert.equal(projectedState.ok, true, JSON.stringify(projectedState)); assert.equal(projectedState.backend, "qt");
  assert.equal(projectedState.blockiert, false); assert.deepEqual(projectedState.unsichereFenster, []);
  const projectedHelp = await read("help", { hwnd: first.info.hwnd });
  assert.equal(projectedHelp.ok, true, JSON.stringify(projectedHelp)); assert.equal(projectedHelp.backend, "qt");
  const projectedTable = await read("read_table", { hwnd: first.info.hwnd });
  assert.equal(projectedTable.ok, true, JSON.stringify(projectedTable)); assert.equal(projectedTable.backend, "qt");
  assert(projectedTable.rowCount > 0);
  const checkedColumn = projectedTable.headers.indexOf("Column 0"), uncheckedColumn = projectedTable.headers.indexOf("Column 1");
  const mixedColumn = projectedTable.headers.indexOf("Column 3");
  assert(checkedColumn >= 0 && uncheckedColumn >= 0 && mixedColumn >= 0);
  const firstRow = projectedTable.rowDetails[0];
  assert.equal(firstRow.cellTypes[checkedColumn], "boolean"); assert.equal(firstRow.typedValues[checkedColumn], true);
  assert.equal(firstRow.checkboxStates[checkedColumn], "On");
  assert.equal(firstRow.cellTypes[uncheckedColumn], "boolean"); assert.equal(firstRow.typedValues[uncheckedColumn], false);
  assert.equal(firstRow.checkboxStates[uncheckedColumn], "Off");
  // Qt 6.9.2's table-cell accessibility reports a partially checked model item as Off; preserve UIA parity.
  assert.equal(firstRow.cellTypes[mixedColumn], "boolean"); assert.equal(firstRow.typedValues[mixedColumn], false);
  assert.equal(firstRow.checkboxStates[mixedColumn], independent.cells.find(cell => cell.name === "row-0-cell-3").toggleState);
  const projectedChecker = await read("checker_results", { hwnd: first.info.hwnd });
  assert.equal(projectedChecker.ok, true, JSON.stringify(projectedChecker)); assert.equal(projectedChecker.backend, "qt");
  assert.equal(projectedChecker.aktiv, false);
  assert.deepEqual(workerCalls, []);
  report.checks.push("All five new public Qt projections read the owned fixture, including actual checked, unchecked and mixed table cells");
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
  await first.command("open-modal-tool");
  const modalTool = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "BelegManager" }, 5000);
  const blockedMain = await readQtNativeSnapshot(sessions[0].client, {}, 5000);
  assert.equal(blockedMain.modalBlocked, true); assert.equal(blockedMain.activeModalHwnd, modalTool.hwnd);
  const allowedMain = await readQtNativeSnapshot(sessions[0].client,
    { allowedModalTitle: "BelegManager", allowedModalHwnd: modalTool.hwnd }, 5000);
  assert.equal(allowedMain.modalBlocked, false); assert.equal(allowedMain.windowEnabled, true);
  assert.equal(allowedMain.activeModalHwnd, modalTool.hwnd);
  const wrongModal = await readQtNativeSnapshot(sessions[0].client,
    { allowedModalTitle: "BelegManager", allowedModalHwnd: first.info.hwnd }, 5000);
  assert.equal(wrongModal.modalBlocked, true, "A matching title cannot authorize another modal HWND");
  await first.command("close-tools");
  report.checks.push("Main reads behind an owned modal tool require its exact native HWND as well as its title");
  await first.command("open-option-tool");
  const optionWindow = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "Synthetic options", withCellStates: true }, 5000);
  const optionTables = optionWindow.nodes.filter(node => node.type === "Table"); assert.equal(optionTables.length, 1);
  const optionArgs = { toolTitle: "Synthetic options", expectedRootHwnd: optionWindow.hwnd,
    tableAid: optionTables[0].aid, toggleColumn: 0, labelColumn: 2 };
  const optionsRead = async extra => (await sessions[0].client.request("accessibility_table_options", { ...optionArgs, ...extra }, 5000)).result;
  assert.equal((await optionsRead({ expectedRootHwnd: optionWindow.hwnd + 1 })).code, "stale-window");
  assert.equal((await optionsRead({ tableAid: optionTables[0].aid + ".stale" })).code, "stale");
  assert.equal((await optionsRead({ labelColumn: 0 })).code, "INVALID_OPTION_TABLE");
  const allOptions = await optionsRead({}); assert.equal(allOptions.ok, true, JSON.stringify(allOptions));
  assert.equal(allOptions.complete, true); assert.equal(allOptions.canFetchMore, false);
  assert.equal(allOptions.rowCount, 40); assert.equal(allOptions.columnCount, 3); assert.equal(allOptions.options.length, 40);
  assert.equal(allOptions.options[39].name, "option-39"); assert.equal(allOptions.options[39].selected, true);
  assert.equal(allOptions.options[39].visible, false, "The complete read must include the offscreen last row.");
    const optionSaves = optionWindow.nodes.filter(node => node.type === "Button" && node.aid.endsWith(".optionSave"));
    const optionCounters = optionWindow.nodes.filter(node => node.type === "Text" && node.aid.endsWith(".optionClickCount"));
    assert.equal(optionSaves.length, 1); assert.equal(optionCounters.length, 1); assert.equal(optionSaves[0].on, false);
    const optionOracleRead = async label => {
    const optionOraclePath = join(temporary, `uia-options-${label}.json`);
  const optionOracle = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", fileURLToPath(new URL("./qt-native-snapshot-uia.ps1", import.meta.url)),
    "-Hwnd", String(optionWindow.hwnd), "-OptionTableAid", optionTables[0].aid, "-OutputPath", optionOraclePath,
      "-OptionSaveAid", optionSaves[0].aid, "-OptionCounterAid", optionCounters[0].aid,
    "-Desktop", desktop], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let optionOracleErrors = ""; optionOracle.stderr.on("data", chunk => { optionOracleErrors += chunk; });
  const optionOracleTimer = setTimeout(() => optionOracle.kill(), 30_000);
  const [optionOracleCode] = await once(optionOracle, "exit"); clearTimeout(optionOracleTimer);
  assert.equal(optionOracleCode, 0, "Independent UIA option-grid read failed: " + optionOracleErrors);
    return JSON.parse(readFileSync(optionOraclePath, "utf8"));
    };
    const oracleOptions = await optionOracleRead("initial");
  assert.deepEqual(allOptions.options.map(({ index, name, selected }) => ({ index, name, selected })), oracleOptions.options);
  assert.equal(allOptions.rowCount, oracleOptions.rowCount); assert.equal(allOptions.columnCount, oracleOptions.columnCount);
    assert.equal(oracleOptions.saveEnabled, false); assert.equal(oracleOptions.clickCount, 0);
    const optionCheck = async (expectedChecked, checked, notifyClicked, extra = {}) => {
      const fresh = await optionsRead({}); assert.equal(fresh.ok, true);
      const target = fresh.options[0];
      return sessions[0].client.requestAcknowledged("accessibility_action", { toolTitle: "Synthetic options", expectedRootHwnd: optionWindow.hwnd,
        action: "set-table-check-state", rid: target.toggleRid, aid: target.toggleAid, expectedName: target.toggleName,
        expectedChecked, checked, expectedRowTitle: target.name, titleColumn: 2,
        ...(notifyClicked ? { notifyClicked: true, expectedRootAid: optionWindow.root.aid, expectedTableAid: optionTables[0].aid } : {}), ...extra }, 5000);
    };
    const rawOption = await optionCheck(false, true, false); assert.equal(rawOption.result.ok, true); assert.equal(rawOption.result.notificationDispatched, false);
    const rawSnapshot = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "Synthetic options" }, 5000);
    assert.equal(rawSnapshot.nodes.find(node => node.aid === optionSaves[0].aid).on, false, "A model-role commit alone does not notify application dirty tracking");
    const staleNotification = await optionCheck(true, false, true, { expectedRootAid: optionWindow.root.aid + ".stale" });
    assert.equal(staleNotification.result.ok, false); assert.equal(staleNotification.result.mutationAttempted, false);
    assert.equal((await optionsRead({})).options[0].selected, true);
    const notifiedOption = await optionCheck(true, false, true); assert.equal(notifiedOption.result.ok, true);
    assert.equal(notifiedOption.result.notificationDispatched, true); assert.equal(notifiedOption.receiptAcknowledged, true);
    const notifiedOracle = await optionOracleRead("notified");
    assert.equal(notifiedOracle.options[0].selected, false); assert.equal(notifiedOracle.options[39].selected, true);
    assert.equal(notifiedOracle.saveEnabled, true); assert.equal(notifiedOracle.clickCount, 1, "One typed business notification must enable completion exactly once");
    const noopOption = await optionCheck(false, false, true); assert.equal(noopOption.result.ok, true); assert.equal(noopOption.result.notificationDispatched, false);
    const noopSnapshot = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "Synthetic options" }, 5000);
    assert.equal(noopSnapshot.nodes.find(node => node.aid === optionCounters[0].aid).name, "1");
  await first.command("mixed-option-tool"); assert.equal((await optionsRead({})).code, "INVALID_OPTION_TABLE");
  await first.command("empty-option-tool");
  const emptyOptions = await optionsRead({}); assert.equal(emptyOptions.ok, true); assert.equal(emptyOptions.rowCount, 0);
  assert.deepEqual(emptyOptions.options, []); await first.command("close-option-tool");
  assert.equal((await optionsRead({})).code, "not-found");
  report.checks.push("Complete Qt option-grid reads match independent UIA across offscreen rows and hidden columns; empty grids are explicit and stale/partial bindings are refused");
    report.checks.push("Exact checkbox model commits optionally notify the typed clicked signal once; independent UIA proves application save readiness, stale roots/no-ops do not notify, and callback-invalidated bindings report unknown outcomes");
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
  await first.command("open-navigation-tool");
  const navigationTree = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "Synthetic navigation" }, 5000);
  const nestedTargets = navigationTree.nodes.filter(node => node.type === "TreeItem" && node.name === "Nested target");
  assert.equal(nestedTargets.length, 1);
  const nestedTarget = nestedTargets[0];
  const navigationAction = async extra => sessions[0].client.requestAcknowledged("accessibility_action", {
    toolTitle: "Synthetic navigation", expectedRootHwnd: navigationTree.hwnd,
    rid: nestedTarget.rid, aid: nestedTarget.aid, expectedName: nestedTarget.name, action: "activate-navigation-item", ...extra,
  }, 5000);
  const wrongNavigationRoot = await navigationAction({ expectedRootHwnd: first.info.hwnd });
  assert.equal(wrongNavigationRoot.result.ok, false); assert.equal(wrongNavigationRoot.result.mutationAttempted, false);
  assert.equal(wrongNavigationRoot.result.code, "stale-window");
  const wrongNavigationName = await navigationAction({ expectedName: "Foreign heading" });
  assert.equal(wrongNavigationName.result.ok, false); assert.equal(wrongNavigationName.result.mutationAttempted, false);
  const nestedAction = await navigationAction({});
  assert.equal(nestedAction.result.ok, true, JSON.stringify(nestedAction)); assert.equal(nestedAction.receiptAcknowledged, true);
  assert.equal(nestedAction.result.modelIndexBinding, "viewport-hierarchical");
  assert.equal(nestedAction.result.dispatch, "qt-navigation-signal");
  const navigationAfter = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "Synthetic navigation" }, 5000);
  assert.equal(navigationAfter.nodes.find(node => node.aid.endsWith("navigationBusinessModel")).val, "Parent heading/Nested target");
  assert.equal(navigationAfter.nodes.find(node => node.aid.endsWith("navigationClickCount")).val, "1");
  const independentNavigation = await uiaSnapshot(navigationTree.hwnd);
  assert.equal(independentNavigation.nodes.find(node => node.aid.endsWith("navigationBusinessModel")).val, "Parent heading/Nested target");
  assert.equal(independentNavigation.nodes.find(node => node.aid.endsWith("navigationClickCount")).val, "1");
  const flatNavigation = await sessions[0].client.requestAcknowledged("accessibility_action", {
    expectedRootHwnd: first.info.hwnd, rid: tableActionTarget[0].rid, aid: tableActionTarget[0].aid,
    expectedName: tableActionTarget[0].name, action: "activate-navigation-item",
  }, 5000);
  assert.equal(flatNavigation.result.ok, false); assert.equal(flatNavigation.result.mutationAttempted, false);
  assert.equal(flatNavigation.result.code, "ACTION_UNSUPPORTED");
  await first.command("close-navigation-tool");
  report.checks.push("An exact hierarchical navigation label activates its nested model index once; independent UIA confirms the business model, while stale bindings and flat tables are refused");
  const editTarget = async suffix => {
    const current = await read("snapshot");
    assert.equal(current.ok, true, JSON.stringify(current));
    const candidates = current.nodes.filter(node => node.aid.endsWith(suffix));
    assert.equal(candidates.length, 1, suffix); return candidates[0];
  };
  const editAction = async (target, action, args = {}) => {
    const result = await sessions[0].client.requestAcknowledged("accessibility_action", {
      rid: target.rid, aid: target.aid, expectedName: target.name, expectedRootHwnd: first.info.hwnd, action, ...args,
    }, 5000);
    return result;
  };
  const literal = "Native +^%~(){}[] äÖß € Україна 🚀 middle";
  const lineTarget = await editTarget(".syntheticField");
  const replaced = await editAction(lineTarget, "replace-edit-text", { expectedValue: "Changed by table action", value: literal });
  assert.equal(replaced.result.ok, true, JSON.stringify(replaced.result)); assert.equal(replaced.receiptAcknowledged, true);
  assert.equal((await read("get_value", { aid: "syntheticField" })).value, literal);
  assert.equal((await read("get_value", { aid: "syntheticCommittedModel" })).value, literal);
  assert.equal((await read("get_value", { aid: "syntheticEditedCount" })).value, "1");
  const wrongRoot = await editAction(await editTarget(".syntheticField"), "replace-edit-text", {
    expectedValue: literal, value: "Must not commit", expectedRootHwnd: first.info.hwnd + 1,
  });
  assert.equal(wrongRoot.result.ok, false); assert.equal(wrongRoot.result.code, "stale-window");
  assert.equal(wrongRoot.result.mutationAttempted, false); assert.equal(wrongRoot.receiptAcknowledged, false);
  assert.equal((await read("get_value", { aid: "syntheticCommittedModel" })).value, literal);
  assert.equal((await read("get_value", { aid: "syntheticEditedCount" })).value, "1");
  const staleEdit = await editAction(lineTarget, "replace-edit-text", { expectedValue: "Changed by table action", value: "Do not write" });
  assert.equal(staleEdit.result.ok, false); assert.equal(staleEdit.result.mutationAttempted, false);
  assert.equal((await read("get_value", { aid: "syntheticCommittedModel" })).value, literal);
  for (const suffix of [".syntheticSecret", ".syntheticCommittedModel"]) {
    const target = await editTarget(suffix);
    const rejected = await editAction(target, "replace-edit-text", { expectedValue: "", value: "Do not write" });
    assert.equal(rejected.result.ok, false); assert.equal(rejected.result.mutationAttempted, false);
    assert.equal(rejected.receiptAcknowledged, false);
  }
  const cleared = await editAction(await editTarget(".syntheticField"), "replace-edit-text", { expectedValue: literal, value: "" });
  assert.equal(cleared.result.ok, true); assert.equal(cleared.receiptAcknowledged, true);
  assert.equal((await read("get_value", { aid: "syntheticCommittedModel" })).value, "");
  assert.equal((await read("get_value", { aid: "syntheticEditedCount" })).value, "2");
  const dateTarget = await editTarget(".syntheticDateEdit");
  const dateEdit = await editAction(dateTarget, "replace-edit-text", { expectedValue: "01.01.2025", value: "15.01.2025" });
  assert.equal(dateEdit.result.ok, true, JSON.stringify(dateEdit.result)); assert.equal(dateEdit.receiptAcknowledged, true);
  assert.equal((await read("get_value", { aid: "syntheticDateModel" })).value, "2025-01-15");
  assert.equal(await first.command("date-commit-count"), "1", "The spin-box commit signal must reach its model exactly once");
  for (const rate of ["19", "7", "0"]) {
    const rateTarget = await editTarget(".syntheticRateEdit");
    const chosen = await editAction(rateTarget, "select-combo-value", { expectedValue: rateTarget.val, value: rate });
    assert.equal(chosen.result.ok, true, JSON.stringify(chosen.result)); assert.equal(chosen.receiptAcknowledged, true);
    assert.equal((await read("get_value", { aid: "syntheticRateModel" })).value.replace(/[^0-9]/gu, "") || "0", rate);
  }
  const toggle = await editAction(await editTarget(".syntheticCheck"), "toggle-check-box", { expectedChecked: true, checked: false });
  assert.equal(toggle.result.ok, true); assert.equal(toggle.receiptAcknowledged, true);
  assert.equal((await read("get_value", { aid: "syntheticCheckModel" })).value, "false");
  const wrongToggle = await editAction(await editTarget(".syntheticCheck"), "toggle-check-box", { expectedChecked: true, checked: true });
  assert.equal(wrongToggle.result.ok, false); assert.equal(wrongToggle.result.mutationAttempted, false);
  for (const value of ["Literal Ελληνικά 🚀 middle +^%~(){}[]", ""]) {
    const noteTarget = await editTarget(".syntheticNote");
    const changed = await editAction(noteTarget, "replace-edit-text", { expectedValue: noteTarget.val, value });
    assert.equal(changed.result.ok, true, JSON.stringify(changed.result)); assert.equal(changed.receiptAcknowledged, true);
    assert.equal((await read("get_value", { aid: "syntheticNoteModel" })).value, value);
    const independentlyObserved = await uiaSnapshot(first.info.hwnd);
    assert.equal(independentlyObserved.nodes.filter(node => node.aid.endsWith(".syntheticNote"))[0].val, value);
  }
  report.checks.push("Exact Qt edit/date/combo/checkbox commits update independent business-signal models and UIA; literals, Unicode, empty values, stale/readonly/password guards and receipt acknowledgments pass");
  const tableCheckTarget = async name => {
    const current = await read("snapshot");
    const candidates = current.nodes.filter(node => node.type === "DataItem" && node.name === name);
    assert.equal(candidates.length, 1); return candidates[0];
  };
  const tableCheckArgs = { expectedChecked: false, checked: true, titleColumn: 2, expectedRowTitle: "row-0-cell-2" };
  const wrongTableRow = await editAction(await tableCheckTarget("row-0-cell-1"), "set-table-check-state", {
    ...tableCheckArgs, expectedRowTitle: "row-1-cell-2",
  });
  assert.equal(wrongTableRow.result.ok, false); assert.equal(wrongTableRow.result.mutationAttempted, false);
  assert.equal((await read("get_value", { aid: "syntheticTableCheckCommits" })).value, "0");
  const wrongTableRoot = await editAction(await tableCheckTarget("row-0-cell-1"), "set-table-check-state", {
    ...tableCheckArgs, expectedRootHwnd: first.info.hwnd + 1,
  });
  assert.equal(wrongTableRoot.result.ok, false); assert.equal(wrongTableRoot.result.code, "stale-window");
  assert.equal(wrongTableRoot.result.mutationAttempted, false);
  for (const name of ["row-0-cell-3", "row-0-cell-4"]) {
    const rejected = await editAction(await tableCheckTarget(name), "set-table-check-state", tableCheckArgs);
    assert.equal(rejected.result.ok, false); assert.equal(rejected.result.mutationAttempted, false);
  }
  const checkedTable = await editAction(await tableCheckTarget("row-0-cell-1"), "set-table-check-state", tableCheckArgs);
  assert.equal(checkedTable.result.ok, true, JSON.stringify(checkedTable.result)); assert.equal(checkedTable.receiptAcknowledged, true);
  assert.equal((await read("get_value", { aid: "syntheticTableCheckModel" })).value, "true");
  assert.equal((await read("get_value", { aid: "syntheticTableCheckCommits" })).value, "1");
  assert.equal((await uiaSnapshot(first.info.hwnd, true)).cells.find(cell => cell.name === "row-0-cell-1").toggleState, "On");
  const staleTableCheck = await editAction(await tableCheckTarget("row-0-cell-1"), "set-table-check-state", tableCheckArgs);
  assert.equal(staleTableCheck.result.ok, false); assert.equal(staleTableCheck.result.mutationAttempted, false);
  assert.equal((await read("get_value", { aid: "syntheticTableCheckCommits" })).value, "1");
  const uncheckedTable = await editAction(await tableCheckTarget("row-0-cell-1"), "set-table-check-state", {
    ...tableCheckArgs, expectedChecked: true, checked: false,
  });
  assert.equal(uncheckedTable.result.ok, true); assert.equal(uncheckedTable.receiptAcknowledged, true);
  assert.equal((await read("get_value", { aid: "syntheticTableCheckModel" })).value, "false");
  assert.equal((await read("get_value", { aid: "syntheticTableCheckCommits" })).value, "2");
  assert.equal((await uiaSnapshot(first.info.hwnd, true)).cells.find(cell => cell.name === "row-0-cell-1").toggleState, "Off");
  const sameTableCheck = await editAction(await tableCheckTarget("row-0-cell-1"), "set-table-check-state", {
    ...tableCheckArgs, expectedChecked: false, checked: false,
  });
  assert.equal(sameTableCheck.result.ok, true); assert.equal(sameTableCheck.result.mutationAttempted, false);
  assert.equal((await read("get_value", { aid: "syntheticTableCheckCommits" })).value, "2");
  report.checks.push("Exact table CheckStateRole commits reach the independent dataChanged business model and UIA; stale row/window/state, partial and noncheckable cells are rejected without a commit");
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
  // Unknown mutation outcomes deliberately make this application refuse later
  // writes. Exercise that permanent barrier after the other mutation oracles.
  await first.command("open-option-tool");
  const invalidatingWindow = await readQtNativeSnapshot(sessions[0].client, { toolTitle: "Synthetic options" }, 5000);
  const invalidatingTables = invalidatingWindow.nodes.filter(node => node.type === "Table"); assert.equal(invalidatingTables.length, 1);
  const invalidatingGrid = (await sessions[0].client.request("accessibility_table_options", { toolTitle: "Synthetic options",
    expectedRootHwnd: invalidatingWindow.hwnd, tableAid: invalidatingTables[0].aid, toggleColumn: 0, labelColumn: 2 }, 5000)).result;
  assert.equal(invalidatingGrid.ok, true); const invalidatingTarget = invalidatingGrid.options[0];
  await first.command("remove-option-on-click");
  const disappearingOption = await sessions[0].client.requestAcknowledged("accessibility_action", { action: "set-table-check-state",
    toolTitle: "Synthetic options", expectedRootHwnd: invalidatingWindow.hwnd, rid: invalidatingTarget.toggleRid,
    aid: invalidatingTarget.toggleAid, expectedName: invalidatingTarget.toggleName, expectedChecked: false, checked: true,
    expectedRowTitle: invalidatingTarget.name, titleColumn: 2, notifyClicked: true,
    expectedRootAid: invalidatingWindow.root.aid, expectedTableAid: invalidatingTables[0].aid }, 5000);
  assert.equal(disappearingOption.result.ok, false); assert.equal(disappearingOption.result.mutationAttempted, true);
  assert.equal(disappearingOption.result.outcomeUnknown, true, "A notification that invalidates its persistent index must never report success");
  const blockedReplay = await sessions[0].client.requestAcknowledged("accessibility_action", {
    rid: actionTarget[0].rid, aid: actionTarget[0].aid, expectedName: "Synthetic action", action: "press" }, 5000);
  assert.equal(blockedReplay.result.code, "RECOVERY_REQUIRED"); assert.equal(blockedReplay.result.mutationAttempted, false);
  await first.command("close-option-tool");
  for (const command of ["validate-field", "mask-field"]) {
    const validatedFixture = await fixture();
    await validatedFixture.command(command);
    const validationSession = await startQtNativeBroker({ package: nativePackage, expectedImage: executable,
      timeoutMs: 5000, target: validatedFixture.info });
    try {
      const before = await readQtNativeSnapshot(validationSession.client, { maxNodes: 5000 }, 5000);
      const target = before.nodes.find(node => node.aid.endsWith(".syntheticField"));
      assert(target); assert.equal(target.val, "10");
      const refusal = await validationSession.client.requestAcknowledged("accessibility_action", {
        expectedRootHwnd: validatedFixture.info.hwnd, rid: target.rid, aid: target.aid, expectedName: target.name,
        action: "replace-edit-text", expectedValue: "10", value: "1",
      }, 5000);
      assert.equal(refusal.result.ok, false, command);
      assert.equal(refusal.result.code, "EDIT_VALIDATION_FAILED");
      assert.equal(refusal.result.mutationAttempted, true);
      assert.equal(refusal.receiptAcknowledged, true, "The rejected attempted edit must retain its exact acknowledgment");
      const after = await readQtNativeSnapshot(validationSession.client, { maxNodes: 5000 }, 5000);
      assert.equal(after.nodes.find(node => node.aid.endsWith(".syntheticCommittedModel")).val, "Uncommitted model",
        "Intermediate or incomplete input must never emit the model commit signal");
    } finally { await validationSession.close(); }
  }
  report.checks.push("Intermediate validators and incomplete input masks refuse model commits; spin-box editingFinished reaches the model once");
  const slowFixture = await fixture();
  await slowFixture.command("slow-field-commit");
  const slowSession = await startQtNativeBroker({ package: nativePackage, expectedImage: executable,
    timeoutMs: 5000, target: slowFixture.info });
  try {
    const before = await readQtNativeSnapshot(slowSession.client, { maxNodes: 5000 }, 5000);
    const target = before.nodes.find(node => node.aid.endsWith(".syntheticField")); assert(target);
    const committed = await slowSession.client.requestAcknowledged("accessibility_action", {
      expectedRootHwnd: slowFixture.info.hwnd, rid: target.rid, aid: target.aid, expectedName: target.name,
      action: "replace-edit-text", expectedValue: target.val, value: "Slow verified commit",
    }, 5000);
    assert.equal(committed.result.ok, true, JSON.stringify(committed.result));
    assert.equal(committed.receiptAcknowledged, true);
    const after = await readQtNativeSnapshot(slowSession.client, { maxNodes: 5000 }, 5000);
    assert.equal(after.nodes.find(node => node.aid.endsWith(".syntheticCommittedModel")).val, "Slow verified commit");
  } finally { await slowSession.close(); }
  report.checks.push("A bounded slow application commit completes inside the GUI/pipe budget with exact acknowledgment and model readback");
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
