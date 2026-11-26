export const MEGA_BENCHMARK = "canonical-live-api-mega-happy-path";

export function isSuccessfulMegaReport(report) {
  return report?.benchmark === MEGA_BENCHMARK && report.status === "passed";
}

export function matchesMegaBaseline(report, identity) {
  return isSuccessfulMegaReport(report) &&
    report.source?.head === identity.head &&
    report.runtime?.artifactFingerprint === identity.artifactFingerprint &&
    report.executionBackend === identity.executionBackend &&
    report.nativeManifestSha256 === identity.nativeManifestSha256;
}

export function megaJourneyFailureReasons(child, raw) {
  const reasons = [];
  if (!child) reasons.push("child-result-missing");
  else if (child.status !== 0) reasons.push(`child-exit-${child.status}`);
  if (child?.signal) reasons.push(`child-signal-${child.signal}`);

  if (raw === null) {
    reasons.push("journey-report-missing");
  } else if (raw.schemaVersion === 1 && raw.status === "failed") {
    reasons.push(raw.failure?.kind ?? "journey-failed");
  } else if (raw.schemaVersion !== 1 || raw.status !== "passed" ||
      !Array.isArray(raw.operations?.calls) || raw.operations.calls.length === 0 ||
      raw.operations.count !== raw.operations.calls.length || !Number.isFinite(raw.timings?.totalWallMs)) {
    reasons.push("journey-report-invalid");
  }
  return reasons;
}
