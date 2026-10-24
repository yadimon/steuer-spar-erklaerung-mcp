/** Opt-in native Add/read/Update, guarded cursor and page reentry; use with-api. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { appendFileSync, constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { callApiOperationEnvelope, readApiHealthz } from "../dist/api-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { profiledTablePage } from "./profiled-table-page.mjs";
import { formatCents, parseCents } from "./currency-cents.mjs";
import { assertStateMutation, assertStateRowsUnchanged, stateJourneyDestination, stateJourneyInventory } from "./state-journey-contract.mjs";
import { desktopMarkerState, ssePids } from "./direct-worker-helpers.mjs";
import { assertFreshMegaDist, megaRuntimeFingerprint, megaSourceFingerprint } from "./performance/api-mega-fingerprint.mjs";

assert(process.env.SSE_API_URL && process.env.SSE_TEST_CASE_DIR && process.env.SSE_TEST_NATIVE_PACKAGE
  && process.env.SSE_TEST_NATIVE_MANIFEST_SHA256, "An isolated API and a verified native package are required.");
assert.equal(process.env.SSE_TEST_API_PREWARM, "1", "Use the same normal worker prewarm as the canonical Mega journey.");
assert.equal(process.env.SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE, "1", "Preserve the failing disposable case for diagnosis.");
const sourceBefore = megaSourceFingerprint();
assert.equal(sourceBefore.status, "", "Capture acceptance evidence only from a clean source tree.");
assertFreshMegaDist();
const runtimeBefore = megaRuntimeFingerprint();
const options = process.argv.slice(2);
assert(options.length <= 1 && options.every(value => /^--cycles=\d+$/u.test(value)), "Only --cycles=N is accepted.");
const cycles = Number(options[0]?.slice(9) ?? 3);
assert(Number.isSafeInteger(cycles) && cycles >= 2 && cycles <= 12, "Use 2 to 12 independent cycles.");
const reportPath = resolve(process.env.SSE_NATIVE_ADD_UPDATE_REPORT ?? "");
assert(process.env.SSE_NATIVE_ADD_UPDATE_REPORT && isAbsolute(process.env.SSE_NATIVE_ADD_UPDATE_REPORT),
  "SSE_NATIVE_ADD_UPDATE_REPORT must name a fresh absolute JSON report outside the repository.");
const reportRelative = relative(resolve("."), reportPath);
assert(isAbsolute(reportRelative) || reportRelative === ".." || reportRelative.startsWith("..\\") || reportRelative.startsWith("../"),
  "Raw live evidence must stay outside the public repository.");
assert(existsSync(dirname(reportPath)), "The private report parent must already exist.");
assert(!existsSync(reportPath) && !existsSync(reportPath + ".calls.jsonl"), "Existing evidence must not be overwritten.");
const profile = loadProductProfile(process.env.SSE_PROFILE_ID ?? "2025");
assert.equal(profile.status, "supported");
assert.equal(profile.operationAccess, "full");
const table = profiledTablePage(profile.id);
const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
const definition = expectations.cases.find(entry => entry.mode === "einur");
assert(definition, "A supported official income sample is required.");
const original = join("C:\\Program Files\\Steuertipps\\SteuerSparErklaerung",
  profile.executable.installationFolderName, expectations.musterDirRelative, definition.file);
const catalog = JSON.parse(readFileSync(profile.pageObjectsPath, "utf8"));
const destination = stateJourneyDestination(catalog, original, table.heading);
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const originalHash = hash(original), markerBefore = desktopMarkerState();
assert.equal(ssePids(), "", "Do not take over existing SSE processes.");
assert.equal(markerBefore, null, "Do not take over an existing hidden desktop.");
const client = { baseUrl: process.env.SSE_API_URL };
const health = await readApiHealthz(client);
client.expectedInstanceId = health.instanceId;
assert.equal(health.prewarm?.ready, true, "The canonical prewarm must be ready before the first operation.");
const report = { scope: "Native Add/passive read/Update, guarded cursor and profiled page reentry; independent fresh product processes; no mutation replay",
  source: sourceBefore, runtimeFingerprint: runtimeBefore.fingerprint,
  nativeManifestSha256: process.env.SSE_TEST_NATIVE_MANIFEST_SHA256, requestedCycles: cycles, cycles: [], status: "running" };
writeFileSync(reportPath + ".calls.jsonl", "", { flag: "wx" });
let current, owned, preserveStartup = false, sequence = 0;
const finalErrors = [];
async function call(operation, args = {}, requireOk = true) {
  const entry = { sequence: ++sequence, cycle: current?.cycle ?? null, operation, args, startedAt: new Date().toISOString() };
  let failure;
  if (operation === "close" && current) current.closeAttempted = true;
  try {
    const result = (await callApiOperationEnvelope(operation, args, 300_000, client)).result;
    entry.result = result;
    if (operation === "launch") {
      // A narrow transition regression does not decide recovery/startup
      // questions. Preserve any launch that is not positively ordinary/ready.
      preserveStartup = result.processPreserved === true || result.kind === "recovered-state"
        || result.ready !== true || result.blockedByDialog !== false
        || !Number.isInteger(result.instance?.hwnd) || result.instance.hwnd <= 0
        || result.instance.pid !== result.pid || !Array.isArray(result.dialogs) || result.dialogs.length !== 0;
      if (Number.isInteger(result.pid) && result.pid > 0 && result.processStillRunning !== false)
        owned = { pid: result.pid, ...(result.instance?.hwnd ? { hwnd: result.instance.hwnd } : {}) };
    }
    if (requireOk) assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  } catch (error) {
    failure = error;
    entry.error = { name: error.name, message: error.message, kind: error.kind, outcomeUnknown: error.outcomeUnknown };
    throw error;
  } finally {
    entry.completedAt = new Date().toISOString();
    try { appendFileSync(reportPath + ".calls.jsonl", JSON.stringify(entry) + "\n"); }
    catch (error) {
      if (failure) throw new AggregateError([failure, error], "Operation and private evidence logging failed.", { cause: failure });
      throw error;
    }
  }
}
const modelArgs = () => ({ hwnd: owned.hwnd, sumLabel: table.sumLabel, sumOccurrence: table.sumOccurrence, noKeys: true, maxRows: 1000 });
// Checkbox display text is backend-specific. Compare its typed state, while
// preserving exact display text for every non-boolean cell and all cell types.
function comparable(inventory) {
  return { headers: inventory.headers, rows: inventory.rows.map(row => ({
    ...row, values: row.values.map((value, index) => {
      if (row.cellTypes[index] !== "boolean") return value;
      assert(["On", "Off", "Indeterminate"].includes(row.checkboxStates[index]), "A checkbox state must be determinate or explicitly indeterminate.");
      return row.checkboxStates[index];
    }),
  })) };
}
let primary;
try {
  for (let cycle = 1; cycle <= cycles; cycle++) {
    current = { cycle, status: "running" }; report.cycles.push(current);
    assert.equal((await call("instances")).count, 0);
    const sourceName = `native-transition-source-${randomUUID()}${extname(original)}`;
    const sourcePath = join(process.env.SSE_TEST_CASE_DIR, sourceName);
    current.sourcePath = sourcePath;
    copyFileSync(original, sourcePath, constants.COPYFILE_EXCL);
    current.sourceCreated = true;
    assert.equal(hash(sourcePath), originalHash);
    const caseName = `native-transition-${randomUUID()}${extname(original)}`;
    const caseRef = `cases:${caseName}`, casePath = join(process.env.SSE_TEST_CASE_DIR, caseName);
    current.casePath = casePath;
    assert.equal((await call("make_working_copy", { sourceRef: `cases:${sourceName}`, targetRef: caseRef,
      expectedSourceHash: originalHash })).verified, true);
    current.workingCopyCreated = true;
    assert.equal(hash(casePath), originalHash);
    const launched = await call("launch", { caseRef, mode: definition.mode });
    assert(Number.isInteger(launched.pid) && launched.pid > 0, "Launch must provide a positive owned PID.");
    assert.equal(launched.instance?.pid, launched.pid, "The launch PID and its case-window PID must match.");
    assert.equal(launched.ready, true); assert.equal(launched.blockedByDialog, false);
    assert(Number.isInteger(owned?.hwnd) && owned.hwnd > 0, "Launch must bind the fresh process window.");
    assert.equal(preserveStartup, false, "Preserve an unclassified startup/recovery state without answering or closing it.");
    current.instance = { ...owned };
    const dialogs = await call("dialog_list", { pid: owned.pid });
    assert(Array.isArray(dialogs.dialogs), "The fresh startup dialog inventory must be explicit.");
    const startupDialogs = dialogs.dialogs.filter(dialog => ["native-dialog", "qt-dialog"].includes(dialog.kind));
    if (startupDialogs.length !== 0) preserveStartup = true;
    assert.equal(startupDialogs.length, 0, "Preserve unexpected startup dialogs; this regression does not answer them.");
    const bound = await call("ui_state", { hwnd: owned.hwnd });
    assert.equal(bound.running, true); assert.equal(bound.instance?.hwnd, owned.hwnd);
    assert.equal((await call("goto", { name: table.heading, useSearch: true, maxSteps: 200, hwnd: owned.hwnd })).erreicht, true);
    const start = await call("table_read", modelArgs());
    assert.equal(start.backend, "qt");
    const before = stateJourneyInventory(start, "initial native inventory");
    // Match the canonical pre-Add inventory, without inserting a read after Add.
    const visible = await call("read_table", { hwnd: owned.hwnd });
    assert(Array.isArray(visible.headers) && Array.isArray(visible.rows) && Array.isArray(visible.rowDetails));
    assert.equal(visible.rowCount, visible.rows.length); assert.equal(visible.rowDetails.length, visible.rows.length);
    assert(visible.headers.includes(table.amountColumn));
    const amountColumn = start.kopf.indexOf(table.amountColumn);
    assert(amountColumn >= 0);
    for (const value of ["0,17", "0,19"]) assert(!start.zeilen.flat().includes(value), "Synthetic target must be unique.");
    const baseCents = parseCents(start.summe), addSum = formatCents(baseCents + 17), updateSum = formatCents(baseCents + 19);
    const added = await call("table_add", { expectedPage: table.heading,
      werte: start.kopf.map(column => column === table.amountColumn ? "0,17" : ""),
      sumLabel: table.sumLabel, sumOccurrence: table.sumOccurrence,
      expectedBefore: start.summe, expectedAfter: addSum, hwnd: owned.hwnd });
    assert.equal(added.verified, true);
    const targetRid = added.zellen?.find(cell => cell.spalte === amountColumn)?.rid;
    assert.equal(typeof targetRid, "string");
    // Deliberately no page/snapshot/find/cursor/focus call between these three
    // operations. Preserve the canonical failing transition and its Add RID.
    const afterAdd = await call("table_read", modelArgs());
    const appended = stateJourneyInventory(afterAdd, "native read immediately after Add");
    assert.equal(appended.rows.length, before.rows.length + 1);
    assertStateRowsUnchanged(before, { ...appended, rows: appended.rows.slice(0, -1) }, "Add preserved all original cells");
    assert.equal(appended.rows.at(-1).values[amountColumn], "0,17");
    assert.equal(afterAdd.summe, addSum);
    const updated = await call("table_update", { expectedPage: table.heading, text: "0,17", targetRid,
      werte: start.kopf.map(column => column === table.amountColumn ? "0,19" : null),
      sumLabel: table.sumLabel, sumOccurrence: table.sumOccurrence,
      expectedBefore: addSum, expectedAfter: updateSum, hwnd: owned.hwnd });
    assert.equal(updated.verified, true);
    const afterUpdate = await call("table_read", modelArgs());
    const updatedInventory = stateJourneyInventory(afterUpdate, "native read after Update");
    assertStateMutation(appended, updatedInventory, { kind: "update", before: "0,17", value: "0,19" }, table.amountColumn, "Update exact delta");
    assert.equal(afterUpdate.summe, updateSum);
    const cursor = await call("table_read", { ...modelArgs(), noKeys: false });
    assert.deepEqual(comparable(stateJourneyInventory(cursor, "explicit native guarded cursor")), comparable(updatedInventory));
    assert.equal(cursor.summe, updateSum);
    const finalModel = await call("table_read", modelArgs());
    assertStateRowsUnchanged(updatedInventory, stateJourneyInventory(finalModel, "model after cursor"), "Cursor preserved native raw/type/checkbox inventory");
    assert.deepEqual(finalModel.rowDetails.map(row => row.rowFingerprint), afterUpdate.rowDetails.map(row => row.rowFingerprint));
    // Page reentry is a separate, planned transition after the original exact
    // Add/read/Update sequence and its first guarded cursor/model checks.
    current.reentry = { pageId: destination.pageId, heading: destination.heading, status: "running" };
    const away = await call("goto", { pageId: destination.pageId, hwnd: owned.hwnd });
    assert.equal(away.erreicht, true);
    assert.equal(away.ueberschrift ?? away.heading, destination.heading);
    const awayPage = await call("page", { hwnd: owned.hwnd });
    assert.equal(awayPage.ueberschrift ?? awayPage.heading, destination.heading);
    const returned = await call("goto", { name: table.heading, hwnd: owned.hwnd });
    assert.equal(returned.erreicht, true);
    assert.equal(returned.ueberschrift ?? returned.heading, table.heading);
    const returnedPage = await call("page", { hwnd: owned.hwnd });
    assert.equal(returnedPage.ueberschrift ?? returnedPage.heading, table.heading);
    const reentryModel = await call("table_read", modelArgs());
    assert.equal(reentryModel.backend, "qt");
    assertStateRowsUnchanged(updatedInventory, stateJourneyInventory(reentryModel, "native model after page reentry"),
      "Page reentry preserved every native cell and typed checkbox state");
    assert.equal(reentryModel.summe, updateSum);
    assert.deepEqual(reentryModel.rowDetails.map(row => row.rowFingerprint), afterUpdate.rowDetails.map(row => row.rowFingerprint));
    const reentryCursor = await call("table_read", { ...modelArgs(), noKeys: false });
    assert.deepEqual(comparable(stateJourneyInventory(reentryCursor, "explicit native guarded cursor after reentry")), comparable(updatedInventory));
    assert.equal(reentryCursor.summe, updateSum);
    const reentryFinalModel = await call("table_read", modelArgs());
    assertStateRowsUnchanged(updatedInventory, stateJourneyInventory(reentryFinalModel, "native model after reentry cursor"),
      "Reentry cursor preserved native raw/type/checkbox inventory");
    assert.equal(reentryFinalModel.summe, updateSum);
    assert.deepEqual(reentryFinalModel.rowDetails.map(row => row.rowFingerprint), afterUpdate.rowDetails.map(row => row.rowFingerprint));
    current.reentry.status = "passed";
    // A text-bearing Add can leave the embedded Help document focused. Cover
    // that natural transition separately from the amount-only Add above.
    // No intervening snapshot, cursor or focus command repairs its state.
    const label = `Synthetic labeled transition ${cycle}`;
    for (const value of ["0,23", "0,29", label]) assert(!reentryFinalModel.zeilen.flat().includes(value));
    const labeledAddSum = formatCents(baseCents + 19 + 23), labeledUpdateSum = formatCents(baseCents + 19 + 29);
    const mutationArgs = { hwnd: owned.hwnd, expectedPage: table.heading,
      sumLabel: table.sumLabel, sumOccurrence: table.sumOccurrence };
    assert.equal((await call("table_add", { ...mutationArgs,
      werte: start.kopf.map(column => column === table.amountColumn ? "0,23" : column === "Bezeichnung" ? label : ""),
      expectedBefore: updateSum, expectedAfter: labeledAddSum })).verified, true);
    const labeledAdded = stateJourneyInventory(await call("table_read", modelArgs()), "native labeled Add");
    assertStateMutation(updatedInventory, labeledAdded, { kind: "append", value: "0,23", label }, table.amountColumn, "Labeled Add exact delta");
    assert.equal(labeledAdded.sum, labeledAddSum);
    assert.equal((await call("table_update", { ...mutationArgs, text: label,
      werte: start.kopf.map(column => column === table.amountColumn ? "0,29" : null),
      expectedBefore: labeledAddSum, expectedAfter: labeledUpdateSum })).verified, true);
    const labeledUpdated = stateJourneyInventory(await call("table_read", modelArgs()), "native labeled Update");
    assertStateMutation(labeledAdded, labeledUpdated, { kind: "update", before: "0,23", value: "0,29" }, table.amountColumn, "Labeled Update exact delta");
    assert.equal(labeledUpdated.sum, labeledUpdateSum);
    assert.equal((await call("table_delete", { ...mutationArgs, text: label,
      expectedBefore: labeledUpdateSum, expectedAfter: updateSum })).verified, true);
    const labeledDeleted = stateJourneyInventory(await call("table_read", modelArgs()), "native labeled Delete");
    assertStateRowsUnchanged(updatedInventory, labeledDeleted, "Labeled Add/Update/Delete restored every previous cell");
    assert.equal(labeledDeleted.sum, updateSum);
    current.labeledMutation = { status: "passed", fullInventoryRestored: true };
    const closed = await call("close", { ...owned, discardChanges: true });
    assert.equal(closed.stillRunning, false); owned = undefined;
    assert.equal((await call("instances")).count, 0);
    assert.equal(hash(sourcePath), originalHash); assert.equal(hash(casePath), originalHash); assert.equal(hash(original), originalHash);
    current.status = "passed";
  }
  report.status = "passed";
} catch (error) {
  primary = error; report.status = "failed";
  report.error = { name: error.name, message: error.message, kind: error.kind, outcomeUnknown: error.outcomeUnknown };
  if (current) current.status = "failed";
} finally {
  if (owned && !preserveStartup && !current?.closeAttempted) {
    try {
      const cleanup = await call("close", { ...owned, discardChanges: true }, false);
      assert.equal(cleanup.ok, true); assert.equal(cleanup.stillRunning, false); owned = undefined;
    } catch (error) { finalErrors.push(error); }
  }
  if (preserveStartup) finalErrors.push(new Error("Startup state was preserved; inspect it before another live attempt."));
  const protectedPaths = report.cycles.flatMap(run => [
    ...(run.sourcePath && (run.sourceCreated || existsSync(run.sourcePath)) ? [run.sourcePath] : []),
    ...(run.casePath && (run.workingCopyCreated || existsSync(run.casePath)) ? [run.casePath] : []),
  ]);
  for (const path of [original, ...protectedPaths]) {
    try { assert.equal(hash(path), originalHash); } catch (error) { finalErrors.push(error); }
  }
  try { assert.equal(ssePids(), ""); assert.equal(desktopMarkerState(), markerBefore); } catch (error) { finalErrors.push(error); }
  try {
    assert.equal(megaSourceFingerprint().fingerprint, sourceBefore.fingerprint, "Source identity changed during the run.");
    assert.equal(megaRuntimeFingerprint().fingerprint, runtimeBefore.fingerprint, "Runtime identity changed during the run.");
  } catch (error) { finalErrors.push(error); }
  report.cleanupErrors = finalErrors.map(error => ({ name: error.name, message: error.message }));
  if (finalErrors.length) report.status = "failed";
  try { writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); }
  catch (error) { finalErrors.push(error); }
}
if (primary && finalErrors.length) throw new AggregateError([primary, ...finalErrors], "Native transition and cleanup failed.", { cause: primary });
if (primary) throw primary;
if (finalErrors.length) throw new AggregateError(finalErrors, "Native transition cleanup failed.");
console.log(`Native Add/read/Update and page reentry: ${cycles} independent fresh processes passed; both guarded cursors, full comparable inventories and original hashes preserved.`);
