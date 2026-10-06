import assert from "node:assert/strict";
import { isQtNativeOperation } from "../dist/qt-native-executor.js";
import { fixture, policy } from "./qt-native-classification-fixture.mjs";

assert(isQtNativeOperation("receipt_manager_classify"));
for (const values of [{ categories: ["Option 0"] }, { categories: [] }, { persons: ["Option 1"] },
  { categories: ["Option 0"], persons: ["Option 1", "Option 2"] }]) {
  const test = fixture({ count: 3 }), result = await test.classify({ values });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.verified, true); assert.equal(result.persistenceVerified, true);
  assert.equal(result.physicalInputUsed, false); assert.equal(result.foregroundLeaseUsed, false); assert.equal(result.cleanupRequired, false);
  assert.equal(result.dirtyStateUnchanged, true); assert.equal(result.otherRowsUnchanged, true); assert.equal(result.countUnchanged, true);
  assert.equal(result.windowSetUnchanged, true); assert.equal(result.detailClosed, true); assert.equal(result.rollback.attempted, false);
  assert.deepEqual(result.requestedValues, values);
  for (const kind of Object.keys(values)) {
    assert.deepEqual(result.valuesAfter[kind], values[kind]);
    assert.deepEqual(result.valuesBefore[kind], ["Option 2"]);
  }
  assert.equal(test.modalOpens(), Object.keys(values).length * 2, "Persistence must use a separately reopened modal");
  const saveActions = test.actions.filter(action => action.expectedName === "Speichern");
  assert.equal(saveActions.length, Object.keys(values).length);
  assert(test.actions.some(action => action.action === "set-table-check-state"));
}
const noOp = fixture({ count: 3, alreadyOpen: true });
const unchanged = await noOp.classify({ values: { categories: ["Option 2"] } });
assert.equal(unchanged.ok, true, JSON.stringify(unchanged)); assert.deepEqual(unchanged.changedKinds, []);
assert.equal(noOp.actions.filter(action => action.action === "set-table-check-state" || action.expectedName === "Speichern").length, 0);
assert.equal(noOp.actions.filter(action => action.action === "activate-table-cell").length, 0);
assert.equal(noOp.modalOpens(), 2);
const empty = fixture({ count: 0 }); const removed = await empty.classify({ values: { categories: [], persons: [] } });
assert.equal(removed.ok, true, JSON.stringify(removed)); assert.deepEqual(removed.valuesAfter, { categories: [], persons: [] });
assert.equal(empty.actions.filter(action => action.action === "set-table-check-state").length, 0);

const unicodeNames = ["äÖß Україна 🚀", "Ω Greek", "Capital"];
const unicode = fixture({ count: 3, names: unicodeNames });
const named = await unicode.classify({ values: { categories: [unicodeNames[0]] } });
assert.equal(named.ok, true, JSON.stringify(named)); assert.deepEqual(named.valuesAfter.categories, [unicodeNames[0]]);
assert(unicode.actions.filter(action => action.action === "set-table-check-state").some(action => action.expectedRowTitle === unicodeNames[0]));
const offscreen = fixture({ count: 40 });
assert.equal((await offscreen.classify({ values: { categories: ["Option 0", "Option 39"] } })).ok, true);
const cannotHide = fixture({ count: 40 });
const refusedHidden = await cannotHide.classify({ values: { categories: ["Option 0"] } });
assert.equal(refusedHidden.ok, false); assert.equal(refusedHidden.cleanupRequired, false);
assert.equal(cannotHide.actions.filter(action => action.expectedName === "Speichern").length, 0);
assert.equal(cannotHide.persisted.categories[39], true, "An invisible checkbox must never be changed or saved");

for (const values of [{ categories: ["Unknown"] }, { categories: ["Option 0", "Option 0"] }, { categories: ["option 0"] }]) {
  const test = fixture({ count: 3 }), result = await test.classify({ values }); assert.equal(result.ok, false);
  assert.equal(test.actions.filter(action => action.action === "set-table-check-state" || action.expectedName === "Speichern").length, 0);
}
for (const guard of ["rowFingerprint", "expectedListFingerprint", "expectedDetailFingerprint"]) {
  const test = fixture({ count: 3 }), result = await test.classify({ [guard]: "A".repeat(64) }); assert.equal(result.ok, false);
  assert.equal(test.actions.filter(action => action.action === "set-table-check-state").length, 0);
  assert.equal(test.actions.filter(action => action.expectedName === policy.controls.classification.categories.chooserExpectedName).length, 0);
}
const rollback = fixture({ count: 3 });
const rolledBack = await rollback.classify({ values: { categories: ["Option 0"], persons: ["Unknown"] } });
assert.equal(rolledBack.ok, false); assert.equal(rolledBack.rollback.attempted, true);
assert.equal(rolledBack.rollback.ok, true, JSON.stringify(rolledBack)); assert.equal(rolledBack.cleanupRequired, false);
assert.deepEqual(rolledBack.rollback.entries, [{ kind: "categories", ok: true, restored: ["Option 2"] }]);
assert.deepEqual(rollback.persisted, { categories: [false, false, true], persons: [false, false, true] });
for (const rejectToggleName of ["Option 0", "Option 2"]) {
  const test = fixture({ count: 3, rejectToggleName, rejectToggleKind: "persons" });
  const result = await test.classify({ values: { categories: ["Option 0"], persons: ["Option 0"] } });
  assert.equal(result.ok, false); assert.equal(result.rollback.ok, true, JSON.stringify(result)); assert.equal(result.cleanupRequired, false);
  assert.deepEqual(test.persisted, { categories: [false, false, true], persons: [false, false, true] });
}
const lag = fixture({ count: 3, saveLagReads: 3 }); assert.equal((await lag.classify()).ok, true);
const neverReady = fixture({ count: 3, neverEnableSave: true }), notReady = await neverReady.classify();
assert.equal(notReady.ok, false); assert.equal(notReady.kind, "button-not-ready"); assert.equal(notReady.cleanupRequired, false);
assert.equal(neverReady.actions.filter(action => action.expectedName === "Speichern").length, 0);

const rejected = fixture({ count: 3, rejectToggleName: "Option 0" });
const rejection = await rejected.classify(); assert.equal(rejection.ok, false); assert.equal(rejection.outcomeUnknown, false);
assert.equal(rejection.cleanupRequired, false, JSON.stringify(rejection)); assert.equal(rejected.actions.filter(action => action.expectedName === "Speichern").length, 0);
for (const option of ["lostToggleAck", "lostSaveAck", "foreignGridAfterToggle", "unknownAfterToggle", "foreignFieldAfterSave", "notificationMissing"]) {
  const test = fixture({ count: 3, [option]: true }), result = await test.classify();
  assert.equal(result.ok, false, option); assert.equal(result.outcomeUnknown, true, JSON.stringify(result)); assert.equal(result.cleanupRequired, true);
  assert.equal(result.rollback.attempted, false, "Unverified/foreign state must block reverse mutations");
  assert(test.actions.filter(action => action.expectedName === "Speichern").length <= 1);
  assert.equal(test.actions.filter(action => action.expectedName === policy.controls.detailClose.expectedName).length, 0);
}
for (const option of ["otherRowDrift", "dirtyDrift", "windowDrift"]) {
  const test = fixture({ count: 3, [option]: true }), result = await test.classify();
  assert.equal(result.ok, false, option); assert.equal(result.cleanupRequired, true); assert.equal(result.rollback.attempted, false);
}
const missingPersistence = fixture({ count: 3, losePersistence: true });
const notPersisted = await missingPersistence.classify(); assert.equal(notPersisted.ok, false);
assert.equal(notPersisted.persistenceVerified, false); assert.equal(notPersisted.cleanupRequired, true);
assert.equal(missingPersistence.actions.filter(action => action.expectedName === "Speichern").length, 1);
for (const acknowledgedMissingOpenAt of [1, 2, 3]) {
  const pendingChooser = fixture({ count: 3, acknowledgedMissingOpenAt });
  const failure = await pendingChooser.classify({ values: { categories: ["Option 0"], persons: ["Option 0"] }, waitMs: 100 });
  assert.equal(failure.ok, false);
  assert.equal(failure.outcomeUnknown, true, JSON.stringify(failure));
  assert.equal(failure.cleanupRequired, true);
  assert.equal(failure.rollback.attempted, false, "An acknowledged chooser with an unproved dialog must block rollback");
  assert.equal(pendingChooser.modalOpens(), acknowledgedMissingOpenAt, "No further chooser may be pressed");
  assert.equal(pendingChooser.actions.filter(action => action.expectedName === policy.controls.detailClose.expectedName).length, 0);
}
console.log("PASS native classification persistence, empty/no-op/Unicode sets, reverse rollback and no replay of unknown mutations");
