/** Opt-in UIA search regression: first search in fresh SSE processes, MCP only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadProductProfile } from "../dist/product-profiles.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const caseDir = process.env.SSE_TEST_CASE_DIR;
const resultDir = process.env.SSE_TEST_RESULT_DIR;
assert(caseDir && resultDir && (process.env.SSE_API_URL || process.env.SSE_API_CONFIG),
  "Use an explicitly isolated test API with SSE_TEST_CASE_DIR and SSE_TEST_RESULT_DIR.");
for (const directory of [caseDir, resultDir]) {
  const outside = relative(realpathSync(root), realpathSync(directory));
  assert(isAbsolute(outside) || outside.startsWith(`..${sep}`), "Live data must stay outside the repository.");
}
const profile = loadProductProfile(process.env.SSE_PROFILE_ID ?? "2025");
assert.equal(profile.id, "2025", "This first-search regression requires the verified 2025 fixture.");
const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
const definitions = expectations.cases.filter(item => item.id === "gew");
assert.equal(definitions.length, 1, "Exactly one manufacturer profit fixture is required.");
const definition = definitions[0];
const manufacturerDir = process.env.SSE_MUSTER_DIR ?? join("C:\\Program Files\\Steuertipps\\SteuerSparErklaerung",
  profile.executable.installationFolderName, expectations.musterDirRelative);
const source = join(manufacturerDir, definition.file);
assert(existsSync(source), "The installed manufacturer's profit fixture is required.");
const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const sourceHash = sha256(source);
const reportPath = join(resultDir, "first-search-report.json");
assert(!existsSync(reportPath), "Use a fresh first-search report directory.");
const report = { schemaVersion: 1, outcome: "running", calls: [], scenarios: [] };
const persist = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
persist();
const client = new Client({ name: "sse-live-first-search", version: "1.0.0" });
let owned, closeAttempted = false, connected = false;

async function call(name, args = {}) {
  const raw = await client.callTool({ name, arguments: args }, undefined, { timeout: 240_000 });
  const result = raw.structuredContent ?? JSON.parse(raw.content.filter(part => part.type === "text").map(part => part.text).join("\n"));
  report.calls.push({ name, args, result });
  persist();
  if (name === "sse_launch" && Number.isInteger(result.pid) && result.pid > 0) {
    owned = { pid: result.pid, hwnd: result.instance?.hwnd ?? result.hwnd, caseRef: args.caseRef };
    closeAttempted = false;
  }
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}

async function readOwned() {
  assert(owned && Number.isInteger(owned.hwnd) && owned.hwnd > 0, "An exact owned launch is required.");
  const inventory = await call("sse_instances");
  const matches = inventory.instances.filter(item => item.pid === owned.pid && item.hwnd === owned.hwnd
    && item.casePath === owned.caseRef && item.recoveredState === false && item.hung === false);
  assert.equal(matches.length, 1, "The fresh window must still belong to the exact disposable fixture.");
  return matches[0];
}

async function closeOwned() {
  await readOwned();
  assert.equal(closeAttempted, false, "Never replay an uncertain close.");
  closeAttempted = true;
  const closed = await call("sse_close", { hwnd: owned.hwnd, pid: owned.pid, discardChanges: true });
  assert.equal(closed.stillRunning, false);
  assert.notEqual(closed.killed, true, "The fixture must close normally.");
  owned = undefined;
}

async function navigate(target) {
  await readOwned();
  const result = await call("sse_goto", { hwnd: owned.hwnd, name: target, useSearch: true, maxSteps: 1 });
  assert.notEqual(result.backend, "qt", "This contract exercises the UIA search click.");
  assert.equal(result.erreicht, true);
  assert.equal(result.ueberschrift, target);
  assert.equal(result.schritte, 1);
  const state = await call("sse_ui_state", { hwnd: owned.hwnd });
  assert.equal(state.heading, target, "Independent readback must retain the target after closing search.");
  assert.deepEqual(state.dialoge, []);
  assert.equal(state.instance.pid, owned.pid);
  return result;
}

async function verifyChecker() {
  await readOwned();
  const run = await call("sse_checker_run", { hwnd: owned.hwnd });
  assert.equal(run.konsistent, true, "Checker must remain complete after search and help-window activity.");
  const results = await call("sse_checker_results", { hwnd: owned.hwnd });
  assert.equal(results.konsistent, true);
  assert.equal(results.fragenWarnungenAngekuendigt, 0, "The fixture exercises the omitted zero-count warnings group.");
  assert.equal(results.fragenWarnungenGruppeGesehen, false);
  assert.equal(results.tippsGruppeGesehen, true);
  assert(results.tippsAngekuendigt > 0);
  assert.equal(results.gesamt, run.gesamt);
  assert.equal(results.tippsAngekuendigt, results.tippsZusatzinfos.length);
  const state = await call("sse_ui_state", { hwnd: owned.hwnd });
  assert.equal(state.steuerpruefer.konsistent, true);
  assert.equal(state.steuerpruefer.gesamt, results.gesamt);
  assert.equal(state.instance.pid, owned.pid);
}

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, "dist", "index.js")],
    cwd: root, env: { ...process.env }, stderr: "pipe" }));
  connected = true;
  const preflight = await call("sse_preflight");
  assert(preflight.blockers.every(item => item.code === "SSE_NOT_RUNNING"), "Resolve every preflight blocker first.");
  assert.equal((await call("sse_instances")).count, 0, "An existing case prevents this live test.");
  assert.equal((await call("sse_desktop_status")).aktiv, false);
  assert.equal((await call("sse_list_cases")).count, 0, "Use a fresh isolated API case directory.");

  const scenarios = [
    { id: "expanded", target: "Sonstige Vorsteuerbeträge" },
    { id: "clipped", target: "Bürobedarf" },
    { id: "compact", target: "Betriebsausgaben" },
  ];
  for (const scenario of scenarios) {
    const filename = `synthetic-search-${scenario.id}.Gew2025`;
    const caseRef = `cases:${filename}`;
    const destination = join(caseDir, filename);
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
    assert.equal(sha256(destination), sourceHash);
    assert.equal((await call("sse_case_hash", { ref: caseRef })).sha256, sourceHash);
    assert.equal((await call("sse_make_working_copy", { sourceRef: caseRef,
      targetRef: `backups:search-${scenario.id}-before.Gew2025`, expectedSourceHash: sourceHash })).verified, true);
    await call("sse_launch", { caseRef, mode: definition.mode });
    await readOwned();
    // No warm-up search or initial row selection: this must be the first
    // search after creating a new product process.
    const first = await navigate(scenario.target);
    assert.equal(first.richtung, "Suche", "A different navigation path cannot prove the first-search regression.");
    await navigate("Fachliteratur");
    await navigate(scenario.target);
    await verifyChecker();
    await closeOwned();
    assert.equal((await call("sse_case_hash", { ref: caseRef })).sha256, sourceHash, "Navigation must not save the fixture.");
    report.scenarios.push({ id: scenario.id, target: scenario.target, firstSearch: "passed", returnSearch: "passed", checker: "passed" });
    persist();
  }
  assert.equal(sha256(source), sourceHash, "The manufacturer's source must remain unchanged.");
  report.outcome = "passed";
  persist();
  console.log(JSON.stringify({ ok: true, scenarios: report.scenarios }));
} catch (error) {
  report.outcome = "failed";
  report.error = String(error.message ?? error);
  persist();
  throw error;
} finally {
  try { if (owned && !closeAttempted) await closeOwned(); }
  finally { if (connected) await client.close(); }
}
