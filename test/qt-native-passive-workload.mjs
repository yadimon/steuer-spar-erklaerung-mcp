import assert from "node:assert/strict";

// The caller owns the native fixture, its inactive desktop, and its single
// bound broker. This module never discovers or touches an installed product.
export async function testPassiveModelWorkload({ fixture, client, read, sessionCount }) {
  const state = async () => JSON.parse(await fixture.command("passive-accessibility-state"));
  const before = await state();
  assert.equal(before.active, false, "Run passive pressure before any accessibility client attaches.");
  const activationChanges = before.activationChanges;
  await fixture.command("passive-table-open");
  const timings = [], fingerprints = new Map();
  let reads = 0;
  const check = async () => {
    const expected = await state();
    const started = performance.now();
    const result = await read("table_read", { maxRows: 1000, sumLabel: "Summe", sumOccurrence: 1 });
    timings.push(performance.now() - started); reads++;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.backend, "qt"); assert.equal(result.vollstaendig, true);
    assert.equal(result.limitReached, false); assert.equal(result.physicalInputUsed, false);
    assert.equal(result.summe, "4,00"); assert.equal(result.anzahl, 3);
    const rows = [0, 1, 3], columns = [0, 1, 2, 3, 4, 6];
    assert.deepEqual(result.kopf, columns.map(column => `Column ${column}`));
    assert.deepEqual(result.zeilen, rows.map(row => columns.map(column =>
      `passive-${expected.generation}-row-${row}-cell-${column}`)));
    assert.deepEqual(result.rowDetails.map(row => row.modelRowIndex), rows);
    assert.deepEqual(result.rowDetails.map(row => row.typedValues), result.zeilen);
    assert(result.rowDetails.every(row => row.semanticsComplete
      && row.cellTypes.every(type => type === "text") && row.checkboxStates.every(value => value === null)));
    assert.equal(result.nativeTable.modelRows, 4); assert.equal(result.nativeTable.readModelRows, 4);
    assert.equal(result.nativeTable.modelColumns, 7); assert.deepEqual(result.nativeTable.visibleColumns, columns);
    const observed = result.rowDetails.map(row => row.rowFingerprint);
    assert(observed.every(value => /^[a-f0-9]{64}$/u.test(value)));
    if (fingerprints.has(expected.generation)) assert.deepEqual(observed, fingerprints.get(expected.generation));
    else {
      for (const previous of fingerprints.values()) assert(observed.every((value, index) => value !== previous[index]),
        "A replaced model must not return the preceding generation's row evidence.");
      fingerprints.set(expected.generation, observed);
    }
    const after = await state();
    assert.equal(after.generation, expected.generation);
    assert.equal(after.active, false); assert.equal(after.activationChanges, activationChanges);
    assert.equal(sessionCount(), 1, "Repeated reads/page replacements reuse the exact owned broker.");
  };
  for (let index = 0; index < 8; index++) await check();
  for (const command of ["passive-table-replace-model", "passive-table-replace-page"]) {
    for (let index = 0; index < 16; index++) { await fixture.command(command); await check(); }
  }
  const raw = (await client.request("table_snapshot", { maxRows: 1000, sumLabel: "Summe" }, 5000)).result;
  assert.equal(raw.ok, true); assert.equal(raw.complete, true);
  assert.deepEqual(raw.hiddenRows, [2]); assert.deepEqual(raw.hiddenColumns, [5]);
  assert.equal(raw.cursorFocusBinding, null);
  assert(!Object.hasOwn(raw.table, "nativeScreenRect"), "A passive model read must not generate accessibility geometry.");
  await fixture.command("passive-table-remove-model");
  const missing = await read("table_read", { maxRows: 1000, sumLabel: "Summe" });
  assert.equal(missing.ok, false); assert.equal(missing.kind, "precondition-failed");
  await fixture.command("passive-table-replace-page"); await check();
  await fixture.command("passive-table-duplicate");
  const ambiguous = await read("table_read", { maxRows: 1000 });
  assert.equal(ambiguous.ok, false); assert.equal(ambiguous.kind, "ambiguous-table");
  await fixture.command("passive-table-replace-page"); await check();
  const after = await state();
  assert.equal(after.active, false); assert.equal(after.activationChanges, activationChanges);
  await fixture.command("passive-table-close");
  return { reads, modelReplacements: 16, pageReplacements: 18, generations: fingerprints.size,
    brokerCount: sessionCount(), accessibilityActivationChanges: after.activationChanges - activationChanges,
    timingMs: { cold: timings[0], warmMin: Math.min(...timings.slice(1)), warmMax: Math.max(...timings.slice(1)) },
    missingModelRejected: true, ambiguousTableRejected: true };
}

export async function testPassiveGuiTimeouts({ fixture, client, sessionCount }) {
  const state = async () => JSON.parse(await fixture.command("passive-accessibility-state"));
  await fixture.command("passive-table-open");
  const before = await state();
  const eventStart = fixture.passiveEvents.length;
  const entered = fixture.waitForPassiveEvent("passive-gui-stall-enter", eventStart);
  const stalledCommand = fixture.command("passive-gui-stall");
  assert.equal((await entered).delayMs, 2600);
  const queued = await client.request("table_snapshot", { maxRows: 1000, sumLabel: "Summe" }, 5000);
  assert.equal(queued.result.ok, false); assert.equal(queued.result.code, "GUI_QUEUE_TIMEOUT");
  assert.equal(queued.result.outcomeUnknown, false); assert.equal(queued.result.mutationAttempted, false);
  await stalledCommand;
  await fixture.waitForPassiveEvent("passive-gui-stall-leave", eventStart);
  const afterQueue = await state();
  assert.equal(afterQueue.modelReads, before.modelReads,
    "A callback cancelled before GUI dispatch must remain unexecuted after the GUI resumes.");
  const ping = await client.request("ping", {}, 5000);
  assert.equal(ping.result.ok, true); assert.equal(ping.result.recoveryRequired, false);
  assert.equal(queued.result.ok, false, "A later responsive ping must not promote the timed-out request to success.");
  await fixture.command("passive-model-slow-read");
  const slowStart = fixture.passiveEvents.length;
  const slowEntered = fixture.waitForPassiveEvent("passive-model-read-enter", slowStart);
  const slowRequest = client.request("table_snapshot", { maxRows: 1000, sumLabel: "Summe" }, 5000);
  assert.equal((await slowEntered).delayMs, 2600);
  const slow = await slowRequest;
  assert.equal(slow.result.ok, false); assert.equal(slow.result.code, "GUI_OPERATION_TIMEOUT");
  assert.equal(slow.result.outcomeUnknown, true); assert.equal(slow.result.mutationAttempted, false);
  await fixture.waitForPassiveEvent("passive-model-read-leave", slowStart);
  const afterSlow = await state();
  assert.equal(afterSlow.slowReadStarted, before.slowReadStarted + 1);
  assert.equal(afterSlow.slowReadCompleted, before.slowReadCompleted + 1);
  assert.equal(afterSlow.modelReads, before.modelReads + 1,
    "Only the explicitly submitted slow model read may execute; neither timeout may be replayed.");
  assert.equal(afterSlow.active, false); assert.equal(afterSlow.activationChanges, before.activationChanges);
  const diagnostic = await client.request("table_snapshot", { maxRows: 1000, sumLabel: "Summe" }, 5000);
  assert.equal(diagnostic.result.ok, true); assert.equal(diagnostic.result.complete, true);
  assert.equal(slow.result.ok, false); assert.equal(slow.result.outcomeUnknown, true);
  assert.equal(sessionCount(), 1, "Timeout diagnostics must not acquire a second broker.");
  await fixture.command("passive-table-close");
  return { beforeDispatch: { code: queued.result.code, outcomeUnknown: queued.result.outcomeUnknown,
    callbackRemainsCancelled: true }, duringModelRead: { code: slow.result.code,
    outcomeUnknown: slow.result.outcomeUnknown, started: 1, completed: 1 }, automaticReplays: 0,
    originalTimeoutsRemainFailed: true, brokerCount: sessionCount() };
}
