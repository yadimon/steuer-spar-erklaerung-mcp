import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { loadQtNativePackage } from "../dist/qt-native-package.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { startQtNativeBroker } from "../dist/qt-native-broker.js";
import { runApiRuntime } from "../dist/api-runtime.js";
import { callApiOperationEnvelope } from "../dist/api-client.js";
import { requestApiShutdown } from "../dist/api-control-client.js";

assert.equal(process.argv.length, 7, "Run this test through qt-native-desktop.ps1 or CTest.");
const [packageConfig, executable, qtBin, desktop, reportPath] = process.argv.slice(2);
assert.match(desktop, /^SSEQtNativeTest_[0-9]+$/u);
const temporary = mkdtempSync(join(tmpdir(), "sse-native-integration-"));
const config = JSON.parse(readFileSync(packageConfig, "utf8"));
const report = { scope: "Built native package, public API runtime and owned Qt fixture; synthetic discovery/profile seams", checks: [], http: [] };
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

try {
  // Real production manifest/hash/profile verification comes before the fixture-only profile substitution.
  const validated = loadQtNativePackage(config.qtNativeRuntime, loadProductProfile("2025"));
  const nativePackage = { ...validated, manifest: { ...validated.manifest, profile: { id: "synthetic", qtVersion: "6.9.2" } } };
  const first = await fixture();
  await assert.rejects(startQtNativeBroker({ package: nativePackage, expectedImage: executable, timeoutMs: 5000,
    target: { ...first.info, creationTime: "1" } }));
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port; await new Promise(resolveClose => listener.close(resolveClose));
  const configPath = join(temporary, "api.json");
  writeFileSync(configPath, JSON.stringify({ host: "127.0.0.1", port, profileId: "2025", sseExecutable: executable,
    workspaceDir: join(temporary, "workspace"), ...config }));
  ready = await runApiRuntime(configPath, { worker: async operation => {
    workerCalls.push(operation);
    if (operation === "windows") return { ok: true, windows: fixtures.filter(item => item.child.exitCode === null).map(item => ({
      pid: item.info.pid, hwnd: item.info.hwnd, title: "SteuerSparErklärung – synthetic fixture", w: 1000, h: 400 })) };
    assert.equal(operation, "desktop_status"); return { ok: true, aktiv: true, markeVeraltet: false, pid: first.info.pid, desktop };
  }, qtNativeDependencies: { loadPackage: () => nativePackage, startSession: async options => {
    const session = await startQtNativeBroker(options); sessions.push(session); return session;
  } } });
  assert.equal(sessions.length, 0);
  for (let count = 0; count < 12; ++count) {
    const result = await read("get_value", { aid: "syntheticField" });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.backend, "qt"); assert.equal(result.value, "Native field – пример");
  }
  assert.equal(sessions.length, 1); assert.deepEqual(workerCalls, ["windows", "desktop_status"]);
  await first.command("change-field");
  assert.equal((await read("get_value", { aid: "syntheticField" })).value, "Changed by fixture");
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
  report.checks.push("The distributed read bridge does not dispatch private experimental mutations");
  const second = await fixture();
  assert.equal((await read("get_value", { aid: "syntheticField" })).kind, "ambiguous");
  assert.equal((await read("get_value", { aid: "syntheticField", hwnd: first.info.hwnd })).ok, true);
  second.child.stdin.write("quit\n"); await second.exited; assert.equal(second.child.exitCode, 0);
  await first.command("disable"); assert.equal((await read("get_value", { aid: "syntheticField" })).ok, false);
  await first.command("enable"); assert.equal((await read("get_value", { aid: "syntheticField" })).ok, true);
  await first.command("delete-field"); assert.equal((await read("get_value", { aid: "syntheticField" })).kind, "not-found");
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
