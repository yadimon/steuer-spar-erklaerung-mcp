import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { loadProductProfile } from "../dist/product-profiles.js";
import { loadQtNativePackage } from "../dist/qt-native-package.js";
import { desktopMarkerPath, readDesktopMarker, parseDesktopMarker } from "../dist/desktop-marker.js";
import { executeNativeDesktopStart } from "../dist/native-desktop-start.js";
import { runApiRuntime } from "../dist/api-runtime.js";
import { callApiOperationEnvelope } from "../dist/api-client.js";
import { requestApiShutdown } from "../dist/api-control-client.js";

assert.equal(process.argv.length, 5);
const [configPath, testLoader, fixture] = process.argv.slice(2).map(value => resolve(value));
const temporary = mkdtempSync(join(tmpdir(), "sse-native-start-"));
const profile = loadProductProfile("2025");
const configuration = JSON.parse(readFileSync(configPath, "utf8"));
const validated = loadQtNativePackage(configuration.qtNativeRuntime, profile);
const nativePackage = { ...validated, loaderPath: testLoader,
  manifest: { ...validated.manifest, profile: { id: "synthetic", qtVersion: "6.9.2" } } };
process.env.TEMP = temporary; process.env.TMP = temporary;
const markerPath = desktopMarkerPath(), ownedPids = new Set(), helpers = new Set();
let number = 0, ready;
const name = () => `SSEQtNativeTest_start_${process.pid}_${number++}`;
const baseRequest = () => ({ mode: "desktop-start", desktop: name(), startMode: "normal", expectedImage: fixture,
  expectedProfile: nativePackage.manifest.profile, markerPath, waitMs: 3000 });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(condition, message) {
  const end = performance.now() + 5000;
  while (!condition() && performance.now() < end) await delay(10);
  assert(condition(), message);
}
function raw(request, loader = testLoader) {
  return new Promise((resolveResult, reject) => {
    const child = execFile(loader, ["--stdin"], { windowsHide: true, encoding: "utf8", timeout: 10000 }, (error, stdout, stderr) => {
      helpers.delete(child);
      try { resolveResult({ code: error?.code ?? 0, value: JSON.parse(error ? stderr : stdout) }); }
      catch { reject(Error(`Native test returned no structured result: ${stderr}`)); }
    });
    helpers.add(child); child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify(request));
  });
}
async function cleanup(pid) {
  assert(ownedPids.has(pid), "Only explicitly created fixture processes may be stopped");
  if (alive(pid)) process.kill(pid);
  await until(() => !alive(pid), "Owned fixture did not exit");
  const marker = readDesktopMarker(markerPath);
  if (marker?.pid === pid) rmSync(markerPath);
  ownedPids.delete(pid);
}

try {
  // The production loader has no synthetic launch bypass, even when the caller supplies the fixture profile.
  const rejected = await raw(baseRequest(), validated.loaderPath);
  assert.notEqual(rejected.code, 0); assert.equal(existsSync(markerPath), false);
  const request = baseRequest();
  const first = (await raw(request)).value;
  assert.equal(first.ok, true, JSON.stringify(first)); ownedPids.add(first.pid);
  assert.equal(first.ready, true); assert.equal(first.blockedByDialog, false);
  assert(first.wartesekunden < 3); assert.equal(first.instance.pid, first.pid);
  assert.deepEqual(readDesktopMarker(markerPath), { schemaVersion: 1, owner: "sse", name: request.desktop, pid: first.pid });
  const active = await raw(baseRequest()); assert.equal(active.value.kind, "desktop-active");
  assert.equal(readDesktopMarker(markerPath).pid, first.pid);
  rmSync(markerPath);
  const occupied = await raw(request); assert.equal(occupied.value.kind, "desktop-occupied");
  writeFileSync(markerPath, JSON.stringify({ schemaVersion: 1, owner: "sse", name: request.desktop, pid: first.pid }));
  await cleanup(first.pid);

  const dialog = (await raw({ ...baseRequest(), startMode: "dialog" })).value;
  assert.equal(dialog.ok, true); ownedPids.add(dialog.pid);
  assert.equal(dialog.ready, false); assert.equal(dialog.blockedByDialog, true); assert.equal(dialog.dialogWindows.length, 1);
  await cleanup(dialog.pid);

  const probe = join(temporary, "timeout.json");
  writeFileSync(probe, "{}");
  const timedOut = (await raw({ ...baseRequest(), startMode: "hang", waitMs: 250, casePath: probe })).value;
  assert.equal(timedOut.ok, false); assert.equal(timedOut.kind, "startup-timeout");
  assert.equal(timedOut.processStillRunning, false); assert.equal(timedOut.markerRemoved, true); assert.equal(timedOut.outcomeUnknown, false);
  assert.equal(alive(timedOut.pid), false); assert.equal(existsSync(markerPath), false);

  const earlyExit = (await raw({ ...baseRequest(), startMode: "exit" })).value;
  assert.equal(earlyExit.ok, false); assert.equal(earlyExit.kind, "launch"); assert.equal(earlyExit.processStillRunning, false);
  assert.equal(existsSync(markerPath), false);

  for (const markerText of ["invalid name", "{\"name\":\"Valid\",\"pid\":0}", "{\"schemaVersion\":1,\"owner\":\"sse\",\"name\":\"Valid\",\"pid\":4,\"extra\":1}",
    "{\"schemaVersion\":1,\"owner\":false,\"name\":\"Valid\",\"pid\":4}", "[]", "", "x".repeat(4097)]) {
    assert.throws(() => parseDesktopMarker(markerText));
    writeFileSync(markerPath, markerText);
    assert.equal((await raw(baseRequest())).value.kind, "desktop-marker-invalid"); rmSync(markerPath);
  }
  writeFileSync(markerPath, "\ufeff  OldDesktop  \r\n");
  assert.equal((await raw(baseRequest())).value.kind, "stale-marker"); rmSync(markerPath);
  writeFileSync(markerPath, JSON.stringify({ name: "OwnedElsewhere", pid: process.pid, owner: "center-test", schemaVersion: 1 }));
  assert.equal((await raw(baseRequest())).value.kind, "desktop-marker-owner"); rmSync(markerPath);

  // Kill the real helper while its child has no window: atomic job assignment must prevent an orphan.
  const killedProbe = join(temporary, "killed-helper.json"); writeFileSync(killedProbe, "{}");
  const helper = spawn(testLoader, ["--stdin"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  helpers.add(helper); const exited = once(helper, "exit"); helper.stderr.resume(); helper.stdout.resume();
  helper.stdin.end(JSON.stringify({ ...baseRequest(), startMode: "hang", waitMs: 10000, casePath: killedProbe }));
  let childPid;
  await until(() => { try { childPid = JSON.parse(readFileSync(killedProbe, "utf8")).pid; return Boolean(childPid); } catch { return false; } }, "Fixture did not start");
  ownedPids.add(childPid); helper.kill(); await exited; helpers.delete(helper);
  await until(() => !alive(childPid), "Killing the helper left its owned fixture alive"); ownedPids.delete(childPid);
  assert.equal(existsSync(markerPath), false);

  // Exercise the public runtime with the same implementation and a fixture-only package substitution.
  const installation = join(temporary, "Steuerjahr 2025"); mkdirSync(installation);
  const executable = join(installation, "SSE.exe"); copyFileSync(fixture, executable);
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port; await new Promise(resolveClose => listener.close(resolveClose));
  const apiConfigPath = join(temporary, "api.json"), cases = join(temporary, "cases"); mkdirSync(cases);
  const sample = join(cases, "Synthetic.Gew2025"); writeFileSync(sample, "{}");
  writeFileSync(apiConfigPath, JSON.stringify({ host: "127.0.0.1", port, profileId: "2025", sseExecutable: executable,
    caseDir: cases, workspaceDir: join(temporary, "workspace"), ...configuration }));
  const workerCalls = [];
  ready = await runApiRuntime(apiConfigPath, {
    qtNativeDependencies: { loadPackage: () => nativePackage },
    worker: async op => { workerCalls.push(op); throw Error(`Unexpected legacy worker: ${op}`); },
  });
  const publicName = name();
  const response = await callApiOperationEnvelope("desktop_start", { name: publicName, caseRef: "cases:Synthetic.Gew2025", mode: "einur" }, 10000,
    { baseUrl: ready.baseUrl });
  assert.equal(response.result.ok, true, JSON.stringify(response.result)); ownedPids.add(response.result.pid);
  assert.equal(response.result.backend, "win32"); assert.equal(response.result.ready, true);
  assert.deepEqual(response.result.resourceRefs, { caseRef: "cases:Synthetic.Gew2025" });
  assert.equal(response.result.case.taxYear, 2025); assert.equal(response.result.product.fileMajor, 31);
  assert.equal(response.result.fenster[0].titleFingerprint.length, 64);
  assert.deepEqual(workerCalls, []);
  await cleanup(response.result.pid);
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await executeNativeDesktopStart({ package: nativePackage, profile, executable, args: {}, timeoutMs: 10000, signal: aborted.signal })).outcomeUnknown, false);
  const health = await (await fetch(ready.baseUrl + "/healthz")).json();
  await requestApiShutdown({ confirm: true, instanceId: health.instanceId }, { baseUrl: ready.baseUrl, expectedInstanceId: health.instanceId });
  ready = undefined;
  console.log("OK: native launch handoff, occupied/foreign markers, dialogs, timeout cleanup, killed helper and public API resource binding.");
} finally {
  if (ready) {
    const health = await (await fetch(ready.baseUrl + "/healthz")).json();
    await requestApiShutdown({ confirm: true, instanceId: health.instanceId }, { baseUrl: ready.baseUrl, expectedInstanceId: health.instanceId });
  }
  for (const helper of helpers) helper.kill();
  for (const pid of ownedPids) await cleanup(pid);
  assert.equal(readDesktopMarker(markerPath), null, "Native start test left an ownership marker");
  rmSync(temporary, { recursive: true, force: true });
}
