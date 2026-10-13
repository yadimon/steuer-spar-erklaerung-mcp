/** Opt-in native model/page navigation regression; run under test/with-api.mjs. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { copyFileSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { callApiOperationEnvelope, readApiHealthz } from "../dist/api-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";

assert(process.env.SSE_API_URL && process.env.SSE_TEST_CASE_DIR && process.env.SSE_TEST_NATIVE_PACKAGE,
  "Model navigation requires an isolated test API and the native test runtime.");
const cycles = Number(process.argv.find(value => value.startsWith("--cycles="))?.slice(9) ?? 12);
assert(Number.isInteger(cycles) && cycles >= 2 && cycles <= 24);
const profile = loadProductProfile(process.env.SSE_PROFILE_ID ?? "2025");
assert.equal(profile.status, "supported");
assert.equal(profile.operationAccess, "full");
const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
const definition = expectations.cases.find(entry => entry.mode === "einur");
assert(definition, "The profile requires an official business-income sample.");
const sampleDirectory = process.env.SSE_MUSTER_DIR ?? join("C:\\Program Files\\Steuertipps\\SteuerSparErklaerung",
  profile.executable.installationFolderName, expectations.musterDirRelative);
const original = join(sampleDirectory, definition.file);
assert(existsSync(original), "The official sample is required.");
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const originalHash = hash(original), suffix = extname(original), token = randomUUID();
const sourceName = `model-page-source-${token}${suffix}`;
const sourcePath = join(process.env.SSE_TEST_CASE_DIR, sourceName);
const caseName = `model-page-cycle-${token}${suffix}`;
const caseRef = `cases:${caseName}`, casePath = join(process.env.SSE_TEST_CASE_DIR, caseName);
copyFileSync(original, sourcePath);
assert.equal(hash(sourcePath), originalHash);
const client = { baseUrl: process.env.SSE_API_URL };
client.expectedInstanceId = (await readApiHealthz(client)).instanceId;
let instance, preserveStartup = false, workingCopyCreated = false, calls = 0;

async function call(operation, args = {}, timeoutMs = 120_000) {
  const result = (await callApiOperationEnvelope(operation, args, timeoutMs, client)).result;
  if (operation === "launch") {
    preserveStartup = result.processPreserved === true || result.kind === "recovered-state";
    if (Number.isInteger(result.pid) && result.pid > 0 && result.processStillRunning !== false) {
      instance = { pid: result.pid, ...(result.instance?.hwnd ? { hwnd: result.instance.hwnd } : {}) };
    }
  }
  process.stdout.write(`${++calls}: ${operation}: ${result.ok ? "ok" : result.kind}\n`);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

try {
  assert.equal((await call("instances")).count, 0);
  const copied = await call("make_working_copy", { sourceRef: `cases:${sourceName}`, targetRef: caseRef, expectedSourceHash: originalHash });
  assert.equal(copied.verified, true);
  workingCopyCreated = true;
  assert.equal(hash(casePath), originalHash);
  const launched = await call("launch", { caseRef, mode: definition.mode }, 300_000);
  assert.equal(launched.ready, true);
  assert.equal(launched.blockedByDialog, false);
  assert(Number.isInteger(instance.hwnd) && instance.hwnd > 0);
  const inventories = new Map();
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const heading of ["EDV-Kosten", "Geschenke bis 50,- €"]) {
      const navigation = await call("goto", { hwnd: instance.hwnd, name: heading, useSearch: true, maxSteps: 200 });
      assert.equal(navigation.backend, "qt");
      assert.equal(navigation.fokusfrei, true);
      assert.equal(navigation.physicalInputUsed, false);
      await call("read_page", { hwnd: instance.hwnd });
      const table = await call("table_read", { hwnd: instance.hwnd, sumLabel: "Summe", sumOccurrence: 1, noKeys: true, maxRows: 400 });
      assert.equal(table.backend, "qt");
      assert.equal(table.vollstaendig, true);
      assert.equal(table.physicalInputUsed, false);
      assert.equal(table.limitReached, false);
      assert(table.anzahl > 0, "The sample must exercise populated model rows.");
      const inventory = { kopf: table.kopf, zeilen: table.zeilen, summe: table.summe };
      if (cycle === 0) inventories.set(heading, inventory);
      else assert.deepEqual(inventory, inventories.get(heading), "Navigation must retain the exact populated inventory and sum.");
      assert.equal(hash(original), originalHash);
      assert.equal(hash(casePath), originalHash);
    }
  }
  await call("close", { ...instance, discardChanges: true });
  instance = undefined;
  assert.equal((await call("instances")).count, 0);
} finally {
  if (instance && !preserveStartup) await call("close", { ...instance, discardChanges: true, force: true });
  if (preserveStartup) process.stderr.write("Startup state preserved; inspect the process and recovery before another live test.\n");
  assert.equal(hash(original), originalHash);
  assert.equal(hash(sourcePath), originalHash);
  if (workingCopyCreated) assert.equal(hash(casePath), originalHash);
}
process.stdout.write(`Native model/page navigation: ${cycles} cycles, complete unchanged inventories and original parity passed (${calls} API calls).\n`);
