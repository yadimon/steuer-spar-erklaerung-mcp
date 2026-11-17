// Native records use request-relative time. Fixture textEdited/commit records
// have a different origin: compare their own intervals, never subtract clocks.
// insert.before -> insert.after includes synchronous application callbacks.
export const nativeEditPhaseNames = Object.freeze([
  "gui.enter", "controller.acquired", "root.before", "root.after", "action.enter",
  "lookup.before", "lookup.after", "edit.enter", "prepare.before",
  "prepare.layout.created", "prepare.layout.configured", "prepare.layout.begun",
  "prepare.layout.lineCreated", "prepare.layout.ended", "prepare.layout.destroy.before",
  "prepare.after", "permit.refused", "permit.claimed", "selectAll.before", "selectAll.after",
  "insert.before", "insert.after", "commit.before", "commit.after", "gui.complete",
]);
// The first-edit fixture uses the complete unmasked QLineEdit path.
export const successfulNativeLineEditPhases = Object.freeze(nativeEditPhaseNames.filter(phase => phase !== "permit.refused"));
const layoutPhases = nativeEditPhaseNames.slice(nativeEditPhaseNames.indexOf("prepare.before") + 1,
  nativeEditPhaseNames.indexOf("prepare.after"));

function hasContiguousPreparation(phases, ok) {
  const layoutCount = phases.filter(phase => layoutPhases.includes(phase)).length;
  const preparationStart = phases.indexOf("prepare.before");
  if (preparationStart < 0) return layoutCount === 0;
  let prefixLength = 0;
  while (prefixLength < layoutPhases.length && phases[preparationStart + 1 + prefixLength] === layoutPhases[prefixLength])
    prefixLength++;
  const next = phases[preparationStart + 1 + prefixLength];
  // The native exception handler may finish an error at any boundary. A
  // successful preparation must finish the layout block or skip it entirely.
  return layoutCount === prefixLength && (next === undefined
    || (next === "prepare.after" && (prefixLength === 0 || prefixLength === layoutPhases.length))
    || (next === "gui.complete" && ok === false));
}

const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;

/** Inspect private RPC diagnostics without treating them as mutation evidence. */
export function inspectNativeEditPhases(reply, { complete, successfulLineEdit = false, activePhase } = {}) {
  const trace = reply?.nativeEditTrace, records = Array.isArray(trace?.records) ? trace.records : [];
  const phases = records.map(record => record?.phase);
  const checks = {
    requestEnvelope: Number.isSafeInteger(reply?.id) && reply.id > 0 && typeof reply.ok === "boolean",
    exactTraceShape: exactKeys(trace, ["schemaVersion", "capacity", "clock", "capturedAtUs", "captureComplete", "overflow", "records"]),
    schema: trace?.schemaVersion === 1 && trace.capacity === 32
      && trace.clock === "request-relative-steady-microseconds",
    boundedPrefix: Array.isArray(trace?.records) && records.length <= 32 && trace.overflow === false,
    captureState: typeof trace?.captureComplete === "boolean" && (complete === undefined || trace.captureComplete === complete),
    exactRecordShape: records.every(record => exactKeys(record, ["sequence", "phase", "monotonicUs", "threadId"])),
    sequence: records.every((record, index) => record?.sequence === index + 1),
    fixedOrderedPhases: phases.every((phase, index) => nativeEditPhaseNames.includes(phase)
      && (index === 0 || nativeEditPhaseNames.indexOf(phase) > nativeEditPhaseNames.indexOf(phases[index - 1]))),
    preparationBlock: hasContiguousPreparation(phases, reply?.ok),
    monotonic: nonnegativeInteger(trace?.capturedAtUs) && records.every((record, index) =>
      nonnegativeInteger(record?.monotonicUs) && record.monotonicUs <= trace.capturedAtUs
      && (index === 0 || record.monotonicUs >= records[index - 1].monotonicUs)),
    sameGuiThread: records.every(record => Number.isSafeInteger(record?.threadId)
      && record.threadId > 0 && record.threadId <= 0xffffffff && record.threadId === records[0].threadId),
    completionBoundary: (records.length === 0 || phases[0] === "gui.enter")
      && (trace?.captureComplete === true ? phases.at(-1) === "gui.complete" : !phases.includes("gui.complete")),
    refusedPermit: !phases.includes("permit.refused") || (reply?.ok === false
      && !phases.some(phase => phase === "permit.claimed" || /^(?:selectAll|insert|commit)\./u.test(phase))),
    mutationPermit: !phases.some(phase => /^(?:selectAll|insert|commit)\./u.test(phase)) || phases.includes("permit.claimed"),
    successfulLineEditPhases: !successfulLineEdit || (reply?.ok === true && trace?.captureComplete === true
      && phases.length === successfulNativeLineEditPhases.length && phases.every((phase, index) => phase === successfulNativeLineEditPhases[index])),
    activePhase: activePhase === undefined || (trace?.captureComplete === false && phases.at(-1) === activePhase),
  };
  const valid = Object.values(checks).every(Boolean);
  return { valid, checks, requestId: Number.isSafeInteger(reply?.id) ? reply.id : null,
    recordCount: records.length, captureComplete: trace?.captureComplete === true,
    phases: phases.filter(phase => nativeEditPhaseNames.includes(phase)),
    intervals: valid ? records.slice(1).map((record, index) => ({
      from: records[index].phase, to: record.phase, durationUs: record.monotonicUs - records[index].monotonicUs,
    })) : [],
    semantics: "Value-free request-relative native boundaries. Adjacent intervals are exclusive; insert includes synchronous textEdited callbacks. Fixture timestamps have an independent origin. Trace completion is not mutation success." };
}
