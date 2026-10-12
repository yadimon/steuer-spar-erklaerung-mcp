export function firstEditTraceCoverage(diagnostic, measurement, window) {
  const events = [], journals = [];
  let malformedRecords = 0;
  for (const line of diagnostic.text.split(/\r?\n/u)) {
    const phase = "SSE_FIXTURE_EDIT_PHASE ", journal = "SSE_FIXTURE_EDIT_JOURNAL ";
    if (!line.startsWith(phase) && !line.startsWith(journal)) continue;
    try { (line.startsWith(phase) ? events : journals).push(JSON.parse(line.slice(
      line.startsWith(phase) ? phase.length : journal.length))); }
    catch { malformedRecords++; }
  }
  const arms = events.filter(event => event.phase === "firstEditWindow.arm");
  const completions = events.filter(event => event.phase === "firstEditWindow.complete");
  const completion = completions[0], callId = completion?.callId;
  const expected = ["metaCall.enter", "textEdited.enter", "textEdited.leave", "commit.enter", "delay.before",
    "delay.after", "modelSet.before", "modelSet.after", "commit.leave", "metaCall.leave", "firstEditWindow.complete"];
  const call = events.filter(event => callId > 0 && event.callId === callId && expected.includes(event.phase));
  const before = window?.nativeClockBefore, after = window?.nativeClockAfter;
  const clock = value => value && Number.isSafeInteger(value.monotonicUs) && value.monotonicUs >= 0
    && Number.isSafeInteger(value.threadId) && value.threadId > 0;
  const footer = journals[0];
  const checks = {
    armedOnce: arms.length === 1 && window?.acknowledgment === "trace-first-edit-arm",
    closedOnce: completions.length === 1 && callId > 0,
    exactPhases: call.length === expected.length && call.every((event, index) => event.phase === expected[index]),
    ordered: call.length > 0 && call.every((event, index) => Number.isSafeInteger(event.monotonicUs)
      && (index === 0 || (event.sequence > call[index - 1].sequence && event.monotonicUs >= call[index - 1].monotonicUs))),
    sameThread: call.length > 0 && call.every(event => event.threadId === call[0].threadId),
    originalZeroDelay: call.length > 0 && call.every(event => event.delayMs === 0),
    nativeMonotonicCaptureWindow: Boolean(clock(before) && clock(after) && before.threadId === after.threadId
      && before.monotonicUs < after.monotonicUs && call.length > 0
      && call.every(event => event.threadId === before.threadId
        && event.monotonicUs >= before.monotonicUs && event.monotonicUs <= after.monotonicUs)),
    armPrecedesCall: arms.length === 1 && call.length > 0 && arms[0].sequence < call[0].sequence,
    boundedCompleteExport: journals.length === 1 && footer.exportComplete === true && footer.overflow === false
      && footer.records === events.length && footer.records <= 256 && malformedRecords === 0,
    drained: diagnostic.stderrDrained === true && diagnostic.exitCode === 0
      && diagnostic.signalCode === null && diagnostic.truncated === false,
  };
  return { complete: Object.values(checks).every(Boolean), checks, malformedRecords, arm: arms[0], footer,
    callId, events: call, nativeRequestId: measurement.request.id ?? null,
    nativeClockBefore: before, nativeClockAfter: after,
    correlation: "GUI callId is independent of native request ID; explicit same-GUI-thread monotonic probes bracket the submitted request and received reply. UTC clocks are diagnostic only." };
}
