import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const [manifestPath, helperPath, fixturePath, qtBin] = process.argv.slice(2).map(value => resolve(value));
assert.equal(process.argv.length, 6, "Expected native manifest, stop test helper, synthetic fixture and Qt bin");
const attempt = mkdtempSync(join(tmpdir(), "sse-native-stop-"));
const productionPath = resolve(dirname(manifestPath), "bin/bridge-load.exe");
const report = { cases: [], fixtures: [] }, fixtures = [];
const json = path => JSON.parse(readFileSync(path, "utf8"));
const persist = () => writeFileSync(join(attempt, "result.json"), JSON.stringify(report, null, 2));
async function fixture(mode, label = mode) {
  const directory = join(attempt, label); mkdirSync(directory);
  const readyPath = join(directory, "ready.json"), statePath = join(directory, "state.json"), markerPath = join(directory, "marker.json");
  const desktop = `SSEStopTest_${process.pid}_${fixtures.length}`;
  const env = { ...process.env, QT_PLUGIN_PATH: resolve(qtBin, "../plugins") };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path"); env[pathKey] = `${qtBin};${env[pathKey]}`;
  const child = spawn(fixturePath, [desktop, readyPath, mode, statePath], { windowsHide: true, env, stdio: ["pipe", "pipe", "pipe"] });
  const item = { label, mode, pid: child.pid, desktop, stderr: "", stdout: "" }; report.fixtures.push(item);
  child.stdout.on("data", data => { item.stdout += data; }); child.stderr.on("data", data => { item.stderr += data; });
  const owned = { child, item, exited: once(child, "exit"), markerPath, statePath }; fixtures.push(owned);
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline && child.exitCode === null && !existsSync(readyPath)) await delay(20);
  owned.binding = json(readyPath); assert.equal(owned.binding.pid, child.pid);
  assert.notEqual(owned.binding.desktop, owned.binding.inputDesktop);
  owned.marker = { schemaVersion: 1, owner: "sse", name: desktop, pid: child.pid };
  writeFileSync(markerPath, JSON.stringify(owned.marker)); persist(); return owned;
}
function helper(owned, overrides = {}, executable = helperPath) {
  const request = { ...owned.binding, mode: "desktop-stop", expectedImage: fixturePath, markerPath: owned.markerPath,
    expectedProfile: { id: "synthetic", qtVersion: "6.9.2" }, waitMs: 1500, deadlineUnixMs: Date.now() + 11000, ...overrides };
  const record = { label: owned.item.label, request }; report.cases.push(record); persist();
  const start = performance.now(); let child;
  const finished = new Promise(resolveCall => {
    child = execFile(executable, ["--stdin"], { windowsHide: true, encoding: "utf8", timeout: 12000, maxBuffer: 1048576 }, (error, stdout, stderr) => {
      Object.assign(record, { durationMs: performance.now() - start, exitCode: error ? (error.code ?? null) : 0,
        signal: error?.signal ?? null, stdout, stderr });
      try { record.result = JSON.parse(stdout); } catch { record.result = null; }
      persist(); resolveCall(record);
    });
    child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify(request));
  });
  return { child, finished };
}
function preserved(owned, closes = 0) {
  assert.equal(owned.child.exitCode, null); assert.deepEqual(json(owned.markerPath), owned.marker);
  assert.equal(json(owned.statePath).closeEvents, closes); assert.equal(json(owned.statePath).saveInvokes, 0);
  assert.equal(json(owned.statePath).discardInvokes, 0);
}
async function quit(owned, expected = 0) {
  if (owned.child.exitCode === null) { owned.child.stdin.write("quit\n"); await Promise.race([owned.exited, delay(5000)]); }
  assert.equal(owned.child.exitCode, expected, owned.item.stderr); owned.item.exitCode = owned.child.exitCode; persist();
}
try {
  const clean = await fixture("clean");
  const production = await helper(clean, {}, productionPath).finished;
  assert.equal(production.result.ok, false); assert.equal(production.result.mutationAttempted, false); preserved(clean);
  const expired = await helper(clean, { deadlineUnixMs: Date.now() - 1000 }).finished;
  assert.equal(expired.result.kind, "native-deadline"); assert.equal(expired.result.mutationAttempted, false); preserved(clean);
  const short = await helper(clean, { deadlineUnixMs: Date.now() + 5000 }).finished;
  assert.equal(short.result.kind, "native-deadline"); assert.equal(short.result.mutationAttempted, false); preserved(clean);
  writeFileSync(clean.markerPath, JSON.stringify({ ...clean.marker, owner: "center-test" }));
  const foreign = await helper(clean).finished;
  assert.equal(foreign.result.kind, "ownership"); assert.equal(foreign.result.mutationAttempted, false);
  assert.equal(json(clean.markerPath).owner, "center-test"); assert.equal(json(clean.statePath).closeEvents, 0);
  writeFileSync(clean.markerPath, JSON.stringify(clean.marker));
  const stale = await helper(clean, { creationTime: "1" }).finished;
  assert.equal(stale.result.kind, "ownership"); assert.equal(stale.result.mutationAttempted, false); preserved(clean);
  const deniedSave = await helper(clean, { save: true }).finished;
  assert.equal(deniedSave.result.kind, "confirmation-required"); preserved(clean);
  const conflicting = await helper(clean, { save: true, discardChanges: true }).finished;
  assert.equal(conflicting.result.kind, "bad-args"); preserved(clean);
  const allowed = await helper(clean).finished;
  assert.equal(allowed.result.ok, true, JSON.stringify(allowed)); assert.equal(allowed.result.processExited, true);
  assert.equal(allowed.result.desktopMarkeEntfernt, true); assert.equal(allowed.result.hartBeendet, false);
  assert(!existsSync(clean.markerPath)); await quit(clean); assert.equal(json(clean.statePath).closeEvents, 1);
  const dirty = await fixture("dirty"); const deniedDirty = await helper(dirty).finished;
  assert.equal(deniedDirty.result.ungespeichert, true); assert.equal(deniedDirty.result.kind, "confirmation-required"); preserved(dirty);
  const discarded = await helper(dirty, { discardChanges: true, waitMs: 4000 }).finished;
  assert.equal(discarded.result.ok, true, JSON.stringify(discarded)); assert.equal(discarded.result.hartBeendet, false);
  assert.equal(discarded.result.speichernAntwort, "Nein"); assert.equal(discarded.result.antwortMethode, "uia-invoke");
  assert(!existsSync(dirty.markerPath)); await quit(dirty);
  assert.equal(json(dirty.statePath).discardInvokes, 1); assert.equal(json(dirty.statePath).saveInvokes, 0);
  const duplicate = await fixture("duplicate"); const duplicated = await helper(duplicate, { discardChanges: true }).finished;
  assert.equal(duplicated.result.ok, false); assert.equal(duplicated.result.kind, "confirmation-required"); preserved(duplicate, 1); await quit(duplicate);
  const blocked = await fixture("blocked"); const blockedResult = await helper(blocked, { discardChanges: true }).finished;
  assert.equal(blockedResult.result.ok, false); assert.equal(blockedResult.result.kind, "blocked"); preserved(blocked, 1); await quit(blocked);
  const oversize = await fixture("oversize"); const oversized = await helper(oversize, { discardChanges: true }).finished;
  assert.equal(oversized.result.ok, false); assert.equal(oversized.result.kind, "state-unknown"); preserved(oversize, 1); await quit(oversize);
  const modal = await fixture("modal"); const modalResult = await helper(modal, { discardChanges: true }).finished;
  assert.equal(modalResult.result.ok, false); assert.equal(modalResult.result.mutationAttempted, false); preserved(modal); await quit(modal);
  const unexpected = await fixture("unexpected"); const uncertain = await helper(unexpected).finished;
  assert.equal(uncertain.result.ok, false); assert.equal(uncertain.result.outcomeUnknown, true); preserved(unexpected, 1); await quit(unexpected);
  const noMain = await fixture("no-main"); const noMainDenied = await helper(noMain).finished;
  assert.equal(noMainDenied.result.kind, "confirmation-required"); preserved(noMain);
  const noMainDiscard = await helper(noMain, { discardChanges: true }).finished;
  assert.equal(noMainDiscard.result.ok, true); assert.equal(noMainDiscard.result.hartBeendet, true); await quit(noMain, 1);
  const ignore = await fixture("ignore"); const terminated = await helper(ignore, { discardChanges: true }).finished;
  assert.equal(terminated.result.ok, true); assert.equal(terminated.result.hartBeendet, true); await quit(ignore, 1);
  const orphan = await fixture("unexpected", "helper-death"); const pending = helper(orphan, { waitMs: 8000 });
  const deathDeadline = performance.now() + 5000;
  while (performance.now() < deathDeadline && json(orphan.statePath).closeEvents === 0) await delay(20);
  assert.equal(json(orphan.statePath).closeEvents, 1); assert.equal(pending.child.exitCode, null);
  pending.child.kill(); const lost = await pending.finished;
  assert.notEqual(lost.exitCode, 0); assert.equal(lost.result, null); preserved(orphan, 1);
  const diagnosis = await helper(orphan, { mode: "desktop-status" }, productionPath).finished;
  assert.notEqual(diagnosis.exitCode, 0); assert.equal(JSON.parse(diagnosis.stderr).kind, "worker-isolation-lost");
  preserved(orphan, 1); await quit(orphan);
  report.ok = true;
} catch (error) { report.ok = false; report.error = error.stack; process.exitCode = 1; }
finally {
  for (const owned of fixtures) {
    try { if (owned.child.exitCode === null) await quit(owned); }
    catch (error) {
      owned.item.cleanupError = error.message; owned.child.kill(); await Promise.race([owned.exited, delay(5000)]);
      report.ok = false; process.exitCode = 1;
    }
  }
  persist(); console.log(JSON.stringify({ ok: report.ok, error: report.error, cases: report.cases.length, report: join(attempt, "result.json") }));
}
