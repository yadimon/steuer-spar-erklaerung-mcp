import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectNativeEditPhases, nativeEditPhaseNames, successfulNativeLineEditPhases } from "./qt-native-edit-phases.mjs";

const successful = { id: 17, ok: true, nativeEditTrace: {
  schemaVersion: 1, capacity: 32, clock: "request-relative-steady-microseconds",
  capturedAtUs: successfulNativeLineEditPhases.length * 10,
  captureComplete: true, overflow: false,
  records: successfulNativeLineEditPhases.map((phase, index) => ({ sequence: index + 1, phase, monotonicUs: index * 10, threadId: 42 })),
} };
const inspectSuccess = reply => inspectNativeEditPhases(reply, { complete: true, successfulLineEdit: true });
const valid = inspectSuccess(successful);
assert.equal(valid.valid, true);
assert.equal(valid.intervals.length, successfulNativeLineEditPhases.length - 1);
assert(valid.intervals.every(interval => interval.durationUs === 10));

const partial = structuredClone(successful);
partial.ok = false; partial.code = "GUI_OPERATION_TIMEOUT"; partial.outcomeUnknown = true;
partial.nativeEditTrace.captureComplete = false;
partial.nativeEditTrace.records = partial.nativeEditTrace.records.slice(0, successfulNativeLineEditPhases.indexOf("commit.before") + 1);
const inspectPartial = reply => inspectNativeEditPhases(reply, { complete: false, activePhase: "commit.before" });
assert.equal(inspectPartial(partial).valid, true);
assert.equal(inspectSuccess(partial).valid, false, "A partial timeout must never satisfy completed edit coverage.");
assert.equal(inspectPartial(successful).valid, false);

const invalid = mutate => {
  const reply = structuredClone(successful); mutate(reply);
  assert.equal(inspectSuccess(reply).valid, false);
};
invalid(reply => { delete reply.nativeEditTrace; });
invalid(reply => { reply.id = "17"; });
invalid(reply => { delete reply.ok; });
invalid(reply => { reply.nativeEditTrace.value = "Must never appear in diagnostics"; });
invalid(reply => { reply.nativeEditTrace.clock = "fixture-relative"; });
invalid(reply => { reply.nativeEditTrace.capacity = 256; });
invalid(reply => { reply.nativeEditTrace.overflow = true; });
invalid(reply => { reply.nativeEditTrace.captureComplete = false; });
invalid(reply => { reply.nativeEditTrace.records[2].rid = "Must never appear"; });
invalid(reply => { reply.nativeEditTrace.records[2].phase = "untrusted private field"; });
invalid(reply => { reply.nativeEditTrace.records[2].threadId++; });
invalid(reply => { reply.nativeEditTrace.records[2].monotonicUs = -1; });
invalid(reply => { reply.nativeEditTrace.records[2].monotonicUs = reply.nativeEditTrace.capturedAtUs + 1; });
invalid(reply => { reply.nativeEditTrace.records[2].monotonicUs = 0; });
invalid(reply => { reply.nativeEditTrace.records[2].sequence++; });
invalid(reply => { reply.nativeEditTrace.records.splice(2, 1); });
invalid(reply => { reply.nativeEditTrace.records.push(structuredClone(reply.nativeEditTrace.records.at(-1))); });
invalid(reply => { reply.nativeEditTrace.records = Array.from({ length: 33 }, () => reply.nativeEditTrace.records[0]); });
const cancelled = structuredClone(partial);
cancelled.nativeEditTrace.records = [];
assert.equal(inspectNativeEditPhases(cancelled, { complete: false }).valid, true,
  "A request cancelled before GUI dispatch has a valid empty published prefix.");
assert.equal(inspectNativeEditPhases(cancelled, { complete: false, activePhase: "commit.before" }).valid, false);
const inconsistentCompletion = structuredClone(successful); inconsistentCompletion.nativeEditTrace.captureComplete = false;
assert.equal(inspectNativeEditPhases(inconsistentCompletion, { complete: false }).valid, false);
const refusal = structuredClone(successful); refusal.ok = false;
refusal.nativeEditTrace.records = [...successfulNativeLineEditPhases.slice(0, successfulNativeLineEditPhases.indexOf("permit.claimed")),
  "permit.refused", "gui.complete"].map((phase, index) => ({ sequence: index + 1, phase, monotonicUs: index * 10, threadId: 42 }));
assert.equal(inspectNativeEditPhases(refusal, { complete: true }).valid, true);
assert.equal(inspectSuccess(refusal).valid, false, "A refused permit is never a successful line edit.");
for (const forbidden of ["permit.claimed", "selectAll.before", "insert.before", "commit.before"]) {
  const contradictory = structuredClone(refusal);
  contradictory.nativeEditTrace.records.splice(-1, 0, { phase: forbidden, monotonicUs: 150, threadId: 42 });
  contradictory.nativeEditTrace.records.forEach((record, index) => { record.sequence = index + 1; record.monotonicUs = index * 10; });
  assert.equal(inspectNativeEditPhases(contradictory, { complete: true }).valid, false, "Refused permission cannot precede an action or a later claim.");
}
const unpermitted = structuredClone(successful);
unpermitted.nativeEditTrace.records = unpermitted.nativeEditTrace.records.filter(record => record.phase !== "permit.claimed");
unpermitted.nativeEditTrace.records.forEach((record, index) => { record.sequence = index + 1; });
assert.equal(inspectNativeEditPhases(unpermitted, { complete: true }).valid, false, "Mutation phases require a successful permit claim.");
const preparing = structuredClone(partial); preparing.code = "GUI_PREPARATION_CANCELLED";
preparing.outcomeUnknown = false; preparing.mutationAttempted = false;
preparing.nativeEditTrace.records = preparing.nativeEditTrace.records.slice(0, successfulNativeLineEditPhases.indexOf("lookup.after") + 1);
assert.equal(inspectNativeEditPhases(preparing, { complete: false, activePhase: "lookup.after" }).valid, true,
  "A post-lookup name read can be cancelled before edit.enter and has no later refused-permit record yet.");
const preparationPhases = ["prepare.layout.created", "prepare.layout.configured", "prepare.layout.begun",
  "prepare.layout.lineCreated", "prepare.layout.ended", "prepare.layout.destroy.before"];
const preparationPrefix = successfulNativeLineEditPhases.slice(0, successfulNativeLineEditPhases.indexOf("prepare.before") + 1);
for (const [index, phase] of preparationPhases.entries()) {
  const cancelledPreparation = structuredClone(preparing);
  cancelledPreparation.nativeEditTrace.records = [...preparationPrefix, ...preparationPhases.slice(0, index + 1)]
    .map((name, ordinal) => ({ sequence: ordinal + 1, phase: name, monotonicUs: ordinal * 10, threadId: 42 }));
  assert.equal(inspectNativeEditPhases(cancelledPreparation, { complete: false, activePhase: phase }).valid, true,
    "A frozen read-only preparation prefix must remain inspectable at " + phase);
  assert.equal(inspectSuccess(cancelledPreparation).valid, false,
    "A preparation boundary must never count as a successful edit.");
  const missingBoundary = structuredClone(successful);
  missingBoundary.nativeEditTrace.records = missingBoundary.nativeEditTrace.records.filter(record => record.phase !== phase);
  missingBoundary.nativeEditTrace.records.forEach((record, ordinal) => { record.sequence = ordinal + 1; });
  assert.equal(inspectSuccess(missingBoundary).valid, false,
    "A completed unmasked line edit must retain its preparation boundary " + phase);
}
const withPhases = (phases, ok, complete) => ({ id: 18, ok, nativeEditTrace: {
  schemaVersion: 1, capacity: 32, clock: "request-relative-steady-microseconds", capturedAtUs: phases.length * 10,
  captureComplete: complete, overflow: false,
  records: phases.map((phase, index) => ({ sequence: index + 1, phase, monotonicUs: index * 10, threadId: 42 })),
} });
const masked = withPhases(successfulNativeLineEditPhases.filter(phase => !preparationPhases.includes(phase)), true, true);
assert.equal(inspectNativeEditPhases(masked, { complete: true }).valid, true);
assert.equal(inspectSuccess(masked).valid, false, "Masked edits do not satisfy the unmasked first-edit fixture.");
const invalidLayout = withPhases([...preparationPrefix, ...preparationPhases.slice(0, -1), "gui.complete"], false, true);
assert.equal(inspectNativeEditPhases(invalidLayout, { complete: true }).valid, true);
assert.equal(inspectSuccess(invalidLayout).valid, false, "An invalid layout returns before the normal destruction marker.");
for (const count of [0, 1, 2, 3, 4, 5, 6]) {
  const exception = withPhases([...preparationPrefix, ...preparationPhases.slice(0, count), "gui.complete"], false, true);
  assert.equal(inspectNativeEditPhases(exception, { complete: true }).valid, true,
    "The native exception handler can complete an error after any preparation prefix.");
}
for (const malformed of [
  [...preparationPrefix, preparationPhases[0], "prepare.after", "gui.complete"],
  [...preparationPrefix, ...preparationPhases.slice(0, -1), "prepare.after", "gui.complete"],
  [...preparationPrefix, preparationPhases[2], "prepare.after", "gui.complete"],
  [...preparationPrefix.slice(0, -1), ...preparationPhases, "prepare.after", "gui.complete"],
]) {
  const inspection = inspectNativeEditPhases(withPhases(malformed, true, true), { complete: true });
  assert.equal(inspection.checks.preparationBlock, false);
  assert.equal(inspection.valid, false,
    "A completed success must not skip a preparation boundary.");
}
const gappedError = inspectNativeEditPhases(withPhases([
  ...preparationPrefix, preparationPhases[0], preparationPhases[3], "gui.complete",
], false, true), { complete: true });
assert.equal(gappedError.checks.preparationBlock, false);
assert.equal(gappedError.valid, false, "An error may end a prefix, but must not have gaps inside it.");
assert.equal(inspectNativeEditPhases({ id: 1, nativeEditTrace: { records: [null] } }).valid, false);

// Source contracts supplement the native atomic-fence unit test and real
// fixture. Every supported edit must claim permission before its first action.
const actions = readFileSync(new URL("../native/qt/bridge-edit-actions.h", import.meta.url), "utf8");
const replaceStart = actions.indexOf("static Json replaceAccessibleEdit(");
const replaceEnd = actions.indexOf("static Json selectAccessibleCombo(", replaceStart);
assert(replaceStart >= 0 && replaceEnd > replaceStart);
const replace = actions.slice(replaceStart, replaceEnd);
const traceSource = readFileSync(new URL("../native/qt/bridge-edit-trace.h", import.meta.url), "utf8");
const nativePhaseNames = [...traceSource.matchAll(/case NativeEditPhase::\w+: return "([^"]+)";/gu)].map(match => match[1]);
assert.deepEqual(new Set(nativePhaseNames), new Set(nativeEditPhaseNames), "Native and inspector phase vocabularies must agree.");
assert.match(replace, /markNativeEdit\(NativeEditPhase::PrepareLayoutDestroyBefore\);\s*\}\s*markNativeEdit\(NativeEditPhase::PrepareAfter\);/u,
  "The final preparation marker must stay after the layout scope has released its local objects.");
const branches = ["if (auto *line = qobject_cast<QLineEdit *>", "if (auto *text = qobject_cast<QTextEdit *>",
  "if (auto *text = qobject_cast<QPlainTextEdit *>"];
const starts = branches.map(branch => replace.indexOf(branch));
assert(starts.every((start, index) => start >= 0 && (index === 0 || start > starts[index - 1])));
const permitStatement = "if (auto denied = requireEditMutationPermit(); !denied.is_null()) return denied;";
assert.equal(replace.split(permitStatement).length - 1, 3);
assert.doesNotMatch(replace, /mutationStarted\s*=\s*true/u,
  "An edit branch must not bypass the atomic permit by setting mutationStarted directly.");
for (const [index, action] of ["live->selectAll();", "cursor.select(QTextCursor::Document);", "cursor.select(QTextCursor::Document);"].entries()) {
  const branch = replace.slice(starts[index], starts[index + 1] ?? replace.length);
  assert.equal(branch.split(permitStatement).length - 1, 1, branches[index]);
  const validation = branch.indexOf("validatePreparedEditBinding(binding, request)");
  const permission = branch.indexOf(permitStatement), mutation = branch.indexOf(action);
  assert(validation >= 0 && validation < permission);
  assert(mutation > permission, "The exact permit must precede " + action);
}
const bridge = readFileSync(new URL("../native/qt/bridge.cpp", import.meta.url), "utf8");
const permitStart = bridge.indexOf("static Json requireEditMutationPermit()");
const permitEnd = bridge.indexOf("static std::uint64_t objectId(", permitStart);
assert(permitStart >= 0 && permitEnd > permitStart);
const permit = bridge.slice(permitStart, permitEnd);
assert.match(permit, /if \(claimNativeEditMutation\(currentNativeDispatchFence, mutationStarted\)\)\s*\{\s*markNativeEdit\(NativeEditPhase::PermitClaimed\);\s*return nullptr;/u);
assert.match(permit, /markNativeEdit\(NativeEditPhase::PermitRefused\)/u);
assert.match(permit, /return noMutationError\("ACTION_DISPATCH_FAILED", "The exact edit has no available pre-mutation permit"\)/u);
const fence = readFileSync(new URL("../native/qt/bridge-dispatch-fence.h", import.meta.url), "utf8");
assert.match(fence, /if \(!fence \|\| !fence->permitMutation\(\)\) return false;\s*mutationStarted = true;/u,
  "A missing or refused fence must fail before recording mutation authority.");
assert.match(bridge, /const auto deadlineMs = 2000;/u);
assert.match(bridge, /static bool transfer\([^\n]+DWORD timeout = 2500,/u);
console.log("PASS native edit phase diagnostic shape, immutable prefixes, ordering, privacy and independent clock semantics");
