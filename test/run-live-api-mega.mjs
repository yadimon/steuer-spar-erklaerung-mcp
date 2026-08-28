import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { loadProductProfile } from "../dist/product-profiles.js";
import { desktopMarkerState, ssePids } from "./direct-worker-helpers.mjs";
import {
  assertFreshMegaDist,
  megaMachineMetadata,
  MEGA_REPOSITORY_ROOT,
  megaRuntimeFingerprint,
  megaSourceFingerprint,
} from "./performance/api-mega-fingerprint.mjs";

if (process.platform !== "win32") throw new Error("Die API-Mega-Reise benoetigt Windows.");
assert.equal(resolve(process.cwd()), MEGA_REPOSITORY_ROOT, "Die API-Mega-Reise muss aus dem Repository-Stamm laufen.");
const orchestrationStartedAt = performance.now();

const classificationArg = process.argv.find((argument) => argument.startsWith("--classification="));
const classification = classificationArg?.slice("--classification=".length) ?? "cold";
assert(["cold", "warm"].includes(classification), "--classification muss cold oder warm sein.");

const evidenceRoot = resolve(process.env.SSE_MEGA_EVIDENCE_DIR ?? "C:\\sse-lab\\evidence\\perf\\api-mega");
mkdirSync(evidenceRoot, { recursive: true });
const statusPath = join(evidenceRoot, "MEGA_STATUS.md");
const generatedAt = new Date().toISOString();
const timestamp = generatedAt.replaceAll(":", "-").replaceAll(".", "-");

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const markerEvidence = (state) => ({
  present: state !== null,
  contentSha256: state === null ? null : createHash("sha256").update(state, "utf8").digest("hex").toUpperCase(),
});
const rounded = (value) => Math.round(Number(value) * 1_000) / 1_000;
const writeExclusive = (path, text) => writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
const updateStatus = (lines) => writeFileSync(statusPath, `# API Mega Journey Status\n\n${lines.join("\n")}\n`, "utf8");

const sourceBefore = megaSourceFingerprint();
assert.equal(sourceBefore.status, "", "Live-Benchmark verweigert einen nicht sauberen Arbeitsbaum.");
assertFreshMegaDist();
const runtimeBefore = megaRuntimeFingerprint();
const previousReports = readdirSync(evidenceRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
  .flatMap((entry) => {
    try {
      const report = JSON.parse(readFileSync(join(evidenceRoot, entry.name), "utf8"));
      return report?.benchmark === "canonical-live-api-mega-happy-path" && report?.status === "passed"
        ? [{ name: entry.name, report }]
        : [];
    } catch { return []; }
  });
const sameFingerprintReports = previousReports.filter(({ report }) =>
  report.source?.head === sourceBefore.head &&
  report.runtime?.artifactFingerprint === runtimeBefore.fingerprint);
const baselineOrdinal = previousReports.length + 1;
const observedRunClass = sameFingerprintReports.length
  ? "repeat-same-source-runtime-fingerprint"
  : "first-for-source-runtime-fingerprint";
const reportStem = `${timestamp}-${sourceBefore.head.slice(0, 12)}-${classification}`;
const jsonPath = join(evidenceRoot, `${reportStem}.json`);
const markdownPath = join(evidenceRoot, `${reportStem}.md`);
const rawPath = join(evidenceRoot, `.${reportStem}.raw.json`);
for (const path of [jsonPath, markdownPath, rawPath]) {
  assert.equal(existsSync(path), false, `Stale Performance-Evidenz wird nicht ueberschrieben: ${path}`);
}

const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
assert.equal(profile.status, "supported", `Profil '${profileId}' ist nicht voll unterstuetzt.`);
assert.equal(profile.operationAccess, "full", `Profil '${profileId}' hat keinen vollen Operationszugriff.`);
const expectations = JSON.parse(readFileSync(join(profile.profileDir, "tests", "expectations.json"), "utf8"));
const installRoot = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung";
const definitions = {
  gew: expectations.cases.find((entry) => entry.mode === "einur"),
  est: expectations.cases.find((entry) => entry.mode === "normal"),
};
assert(definitions.gew && definitions.est, "Profil braucht je einen offiziellen Gew- und ESt-Musterfall.");
const official = Object.fromEntries(Object.entries(definitions).map(([id, definition]) => {
  const path = join(
    installRoot,
    profile.executable.installationFolderName,
    expectations.musterDirRelative,
    definition.file,
  );
  assert(existsSync(path), `Offizieller Musterfall '${id}' fehlt.`);
  return [id, { id, definition, path, hashBefore: sha256File(path) }];
}));

assert.equal(ssePids(), "", "Die API-Mega-Reise startet nur ohne vorhandene SSE-Prozesse.");
const markerBeforeState = desktopMarkerState();
const markerBefore = markerEvidence(markerBeforeState);
const caseDirectory = mkdtempSync(join(tmpdir(), `sse-api-mega-${profileId}-`));
const fixtures = Object.fromEntries(Object.entries(official).map(([id, entry]) => {
  const stagedName = `official-${id}-template${extname(entry.path)}`;
  const targetName = `api-mega-${id}${extname(entry.path)}`;
  const stagedPath = join(caseDirectory, stagedName);
  copyFileSync(entry.path, stagedPath);
  assert.equal(sha256File(stagedPath), entry.hashBefore, `${id}: bereitgestellte offizielle Vorlage weicht ab.`);
  return [id, {
    id,
    mode: entry.definition.mode,
    sourceRef: `cases:${stagedName}`,
    targetRef: `cases:${targetName}`,
    sourceHash: entry.hashBefore,
    terminalCollect: entry.definition.terminalCollect ?? null,
  }];
}));
const preflightWallMs = rounded(performance.now() - orchestrationStartedAt);

updateStatus([
  `- Status: live ${classification} run in progress`,
  `- Started: ${generatedAt}`,
  `- Branch/HEAD: \`${sourceBefore.branch}\` / \`${sourceBefore.head}\``,
  "- Controller: one direct loopback API; all GUI/API calls serial",
  "- Safety: official Musterfall hashes captured; staged fixtures provisioned; backup is the first journey mutation",
  `- Pending report: \`${jsonPath}\``,
]);

let raw = null;
let child = null;
let setupFailure = markerBefore.present
  ? new Error("Die API-Mega-Reise startet nicht mit vorhandenem Hidden-Desktop-Marker.")
  : null;
try {
  if (!setupFailure) {
    child = spawnSync(process.execPath, [
      "test/with-api.mjs", process.execPath, "test/live-api-mega-journey.mjs",
    ], {
      cwd: MEGA_REPOSITORY_ROOT,
      env: {
        ...process.env,
        SSE_PROFILE_ID: profileId,
        SSE_CASE_DIR: caseDirectory,
        SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE: "1",
        SSE_TEST_INTERACTIVE_RECEIPTS: "1",
        SSE_TEST_API_PREWARM: "1",
        SSE_MEGA_CLASSIFICATION: classification,
        SSE_MEGA_RAW_REPORT: rawPath,
        SSE_MEGA_STATUS_PATH: statusPath,
        SSE_MEGA_EXPECTED_SOURCE_FINGERPRINT: sourceBefore.fingerprint,
        SSE_MEGA_EXPECTED_RUNTIME_FINGERPRINT: runtimeBefore.fingerprint,
        SSE_MEGA_FIXTURES_JSON: JSON.stringify(fixtures),
      },
      stdio: "inherit",
      windowsHide: true,
    });
    if (child.error) setupFailure = child.error;
  }
} catch (error) {
  setupFailure = error;
}

if (existsSync(rawPath)) {
  try { raw = JSON.parse(readFileSync(rawPath, "utf8")); }
  catch (error) { setupFailure ??= new Error(`Rohbericht ist unlesbar: ${error.message}`); }
}

const postflightVerificationStartedAt = performance.now();
const sourceAfter = megaSourceFingerprint();
const runtimeAfter = megaRuntimeFingerprint();
const pidsAfter = ssePids();
const markerAfterState = desktopMarkerState();
const markerAfter = markerEvidence(markerAfterState);
const markerUnchanged = markerAfterState === markerBeforeState;
const markerSafe = !markerBefore.present && !markerAfter.present && markerUnchanged;
const officialAfter = Object.fromEntries(Object.entries(official).map(([id, entry]) => [id, sha256File(entry.path)]));
const officialUnchanged = Object.entries(official).every(([id, entry]) => officialAfter[id] === entry.hashBefore);
const fingerprintStable =
  sourceAfter.fingerprint === sourceBefore.fingerprint &&
  runtimeAfter.fingerprint === runtimeBefore.fingerprint;
const fingerprintVerificationWallMs = rounded(performance.now() - postflightVerificationStartedAt);
const childSucceeded = !setupFailure && child?.status === 0 && child?.signal === null && raw?.status === "passed";
const cleanupSafe = childSucceeded && pidsAfter === "" && markerSafe && officialUnchanged && fingerprintStable;
let disposableCleanup = { attempted: false, removed: false, preserved: true };
let disposableCleanupWallMs = 0;
if (cleanupSafe) {
  const disposableCleanupStartedAt = performance.now();
  disposableCleanup = { attempted: true, removed: false, preserved: false };
  const temporaryRoot = resolve(tmpdir());
  const relativeDisposable = relative(temporaryRoot, resolve(caseDirectory));
  assert(relativeDisposable && !isAbsolute(relativeDisposable) &&
    relativeDisposable !== ".." && !relativeDisposable.startsWith(`..\\`) && !relativeDisposable.startsWith("../"),
    `Wegwerfbereich liegt nicht sicher unter dem Temp-Verzeichnis: ${caseDirectory}`);
  assert(basename(caseDirectory).startsWith(`sse-api-mega-${profileId}-`),
    `Wegwerfbereich traegt nicht das erwartete create-only Praefix: ${caseDirectory}`);
  rmSync(caseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  disposableCleanup.removed = !existsSync(caseDirectory);
  disposableCleanup.preserved = !disposableCleanup.removed;
  disposableCleanupWallMs = rounded(performance.now() - disposableCleanupStartedAt);
}
const postflightVerificationWallMs = rounded(performance.now() - postflightVerificationStartedAt);

const failureReasons = [
  ...(setupFailure ? [`setup: ${setupFailure.message}`] : []),
  ...(child && child.status !== 0 ? [`child-exit-${child.status}`] : []),
  ...(child?.signal ? [`child-signal-${child.signal}`] : []),
  ...(pidsAfter ? ["owned-sse-process-remained"] : []),
  ...(markerBefore.present ? ["hidden-desktop-marker-present-before"] : []),
  ...(markerAfter.present ? ["hidden-desktop-marker-present-after"] : []),
  ...(!markerUnchanged ? ["hidden-desktop-marker-changed"] : []),
  ...(!officialUnchanged ? ["official-musterfall-hash-changed"] : []),
  ...(!fingerprintStable ? ["source-or-runtime-fingerprint-drift"] : []),
  ...(!raw ? ["journey-report-missing"] : []),
  ...(raw?.status === "failed" ? [raw.failure?.kind ?? "journey-failed"] : []),
  ...(cleanupSafe && !disposableCleanup.removed ? ["successful-disposable-cleanup-failed"] : []),
];
const passed = failureReasons.length === 0;
const report = {
  schemaVersion: 1,
  benchmark: "canonical-live-api-mega-happy-path",
  status: passed ? "passed" : "failed",
  classification,
  classificationEvidence: {
    requestedCacheState: classification,
    observedRunClass,
    claim: "cold/warm is operator intent; comparability is derived from prior reports, fingerprints, prewarm readiness, and launch evidence",
    priorSuccessfulWholeJourneyCount: previousReports.length,
    priorSameFingerprintCount: sameFingerprintReports.length,
    workerPrewarm: raw?.safety?.workerPrewarm ?? null,
    firstLaunchWallMs: raw?.operations?.calls?.find((entry) => entry.label === "launch-gew:mutation")?.wallMs ?? null,
    workerInitializationMs: raw?.environment?.sse?.workerInitializationMs ?? null,
  },
  generatedAt,
  historicalComparison: {
    comparableWholeJourneyBaselineExists: previousReports.length > 0,
    baselineOrdinal,
    previousSuccessfulReports: previousReports.map((entry) => entry.name),
    note: !passed
      ? "This failed run is not a canonical whole-journey baseline; historical numbers remain component-only context."
      : previousReports.length
        ? `This is canonical whole-journey baseline #${baselineOrdinal}; prior canonical reports are eligible for explicit comparison when their fingerprints and run evidence match.`
        : "This is the first canonical whole-journey baseline; historical numbers are component-only and are not deltas for this report.",
    componentContextMs: {
      semanticNavigationBefore: 19_916,
      semanticNavigationAfter: 12_724,
      receiptBulkBefore: 37_531,
      receiptBulkAfter: 25_568,
      existingReceiptUpdateSafeCycle: 15_009,
      vehicleFillFieldsCycle: 8_753,
      coldOutlierVmBulkUpsert: 98_561,
    },
  },
  source: {
    branch: sourceBefore.branch,
    head: sourceBefore.head,
    tree: sourceBefore.tree,
    clean: sourceBefore.status === "",
    fingerprint: sourceBefore.fingerprint,
    stableThroughRun: sourceAfter.fingerprint === sourceBefore.fingerprint,
  },
  runtime: {
    ...megaMachineMetadata(),
    artifactFingerprint: runtimeBefore.fingerprint,
    artifactFileCount: runtimeBefore.fileCount,
    stableThroughRun: runtimeAfter.fingerprint === runtimeBefore.fingerprint,
    sse: raw?.environment?.sse ?? null,
  },
  fixtures: Object.values(fixtures).map(({ id, mode, sourceHash }) => ({ id, mode, officialSourceHash: sourceHash })),
  safety: {
    staticEnforcement: raw?.safety?.staticEnforcement ?? null,
    runtimeEvidence: raw?.safety?.runtimeEvidence ?? null,
    receiptLease: raw?.safety?.receiptLease ?? null,
    workerPrewarm: raw?.safety?.workerPrewarm ?? null,
    officialHashesBefore: Object.fromEntries(Object.entries(official).map(([id, entry]) => [id, entry.hashBefore])),
    officialHashesAfter: officialAfter,
    officialHashesUnchanged: officialUnchanged,
    ssePidsAfter: pidsAfter ? pidsAfter.split(",").length : 0,
    hiddenDesktopMarker: {
      before: markerBefore,
      after: markerAfter,
      unchanged: markerUnchanged,
      safe: markerSafe,
    },
    disposableCleanup,
  },
  timings: {
    ...(raw?.timings ?? {}),
    runnerPreflightWallMs: preflightWallMs,
    runnerFingerprintVerificationWallMs: fingerprintVerificationWallMs,
    runnerPostflightVerificationWallMs: postflightVerificationWallMs,
    disposableCleanupWallMs,
    orchestrationWallMs: rounded(performance.now() - orchestrationStartedAt),
  },
  operations: raw?.operations ?? null,
  mutationCoverage: raw?.mutationCoverage ?? null,
  catalogCoverage: raw?.catalogCoverage ?? null,
  operationCatalog: raw?.operationCatalog ?? null,
  excludedDomains: raw?.excludedDomains ?? null,
  failure: passed ? null : {
    phase: raw?.failure?.phase ?? "runner",
    kind: raw?.failure?.kind ?? "runner-failure",
    message: raw?.failure?.message ?? setupFailure?.message ?? failureReasons.join(", "),
    reasons: failureReasons,
    disposableSandboxPreserved: disposableCleanup.preserved,
    diagnosticSandboxPaths: {
      cases: caseDirectory,
      ...(raw?.diagnosticSandboxPaths ?? {}),
    },
  },
  artifacts: { json: jsonPath, markdown: markdownPath, status: statusPath },
};

const totalSeconds = report.timings?.totalWallMs === undefined
  ? "n/a"
  : (report.timings.totalWallMs / 1_000).toFixed(3);
const phaseRows = (report.timings?.phases ?? [])
  .map((entry) => `| ${entry.phase} | ${entry.status} | ${(entry.wallMs / 1_000).toFixed(3)} |`)
  .join("\n");
const md = (value) => String(value && typeof value === "object" ? JSON.stringify(value) : (value ?? ""))
  .replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
const apiCallRows = (report.operations?.calls ?? []).map((entry) =>
  `| ${entry.sequence} | ${md(entry.phase)} | ${md(entry.label)} | ${entry.operation} | ` +
  `${entry.ok ? "ok" : md(entry.kind ?? "failed")} | ${Number(entry.wallMs).toFixed(3)} | ` +
  `${Number.isFinite(entry.envelopeDurationMs) ? Number(entry.envelopeDurationMs).toFixed(3) : "n/a"} | ` +
  `${Number.isFinite(entry.workerReportedMs) ? Number(entry.workerReportedMs).toFixed(3) : "n/a"} |`).join("\n");
const mutationRows = (report.mutationCoverage?.records ?? []).map((entry) =>
  `| ${entry.id} | ${entry.operation} | ${entry.readbackOperation} | ${entry.result} | ` +
  `${Number.isFinite(entry.mutationTiming?.wallMs) ? Number(entry.mutationTiming.wallMs).toFixed(3) : "n/a"} | ` +
  `${Number.isFinite(entry.readbackTiming?.wallMs) ? Number(entry.readbackTiming.wallMs).toFixed(3) : "n/a"} | ` +
  `${md(entry.skipReason ?? entry.assertion)} |`).join("\n");
const exclusionGroups = new Map();
for (const entry of (report.operationCatalog ?? []).filter((item) => item.classification !== "covered")) {
  const key = `${entry.classification}\0${entry.subclassification}\0${entry.reason}`;
  if (!exclusionGroups.has(key)) exclusionGroups.set(key, { ...entry, operations: [] });
  exclusionGroups.get(key).operations.push(entry.operation);
}
const exclusionRows = [...exclusionGroups.values()].map((entry) =>
  `| ${entry.classification} | ${entry.subclassification} | ${entry.operations.join(", ")} | ${md(entry.reason)} |`).join("\n");
const timingRows = [
  ["Journey wall excluding cleanup", report.timings?.journeyWallMsExcludingCleanup],
  ["Cleanup wall", report.timings?.cleanupWallMs],
  ["Controlled API run including cleanup", report.timings?.totalWallMs],
  ["Child setup/fingerprints/PDF/healthz", report.timings?.setupWallMs],
  ["Runner preflight", report.timings?.runnerPreflightWallMs],
  ["Runner fingerprint/hash/process verification", report.timings?.runnerFingerprintVerificationWallMs],
  ["Runner postflight including disposable cleanup", report.timings?.runnerPostflightVerificationWallMs],
  ["Disposable cleanup", report.timings?.disposableCleanupWallMs],
  ["Runner/orchestration wall", report.timings?.orchestrationWallMs],
  ["API-call wall sum", report.timings?.apiCallWallTotalMs],
  ["API-envelope duration sum", report.timings?.apiEnvelopeTotalMs],
  ["Worker-reported duration sum", report.timings?.workerReportedTotalMs],
].map(([label, milliseconds]) =>
  `| ${label} | ${Number.isFinite(milliseconds) ? (milliseconds / 1_000).toFixed(3) : "n/a"} |`).join("\n");
const markdown = `# Canonical live API mega journey — ${classification}\n\n` +
  `- Status: **${report.status}**\n` +
  `- Generated: ${generatedAt}\n` +
  `- Git: \`${sourceBefore.head}\` (tree \`${sourceBefore.tree}\`, clean and stable: ${fingerprintStable})\n` +
  `- Total wall time: ${totalSeconds} s\n` +
  `- Run evidence: requested=${classification}; observed=${observedRunClass}; prewarm-ready=${report.classificationEvidence.workerPrewarm?.readyBeforeFirstCatalogOperation ?? false}\n` +
  `- API calls: ${report.operations?.count ?? "n/a"}; distinct executed operations: ${report.operations?.distinctCount ?? "n/a"}; call failures=${report.operations?.failureCount ?? "n/a"}\n` +
  `- Catalog coverage: executed=${report.catalogCoverage?.coveredExecutedCount ?? 0}/${report.catalogCoverage?.coveredDeclaredCount ?? 0} declared covered; catalog total=${report.catalogCoverage?.operationCount ?? 99}\n` +
  `- Mutation/readback assertions: passed=${report.mutationCoverage?.passed ?? 0}; skipped=${report.mutationCoverage?.skipped ?? 0}; failed=${report.mutationCoverage?.failed ?? 0}; unexecuted=${report.mutationCoverage?.unexecuted ?? 0}; declared=${report.mutationCoverage?.declared ?? 0}\n` +
  `- Cleanup: zero SSE processes=${pidsAfter === ""}; hidden-desktop marker safe=${markerSafe}; official hashes unchanged=${officialUnchanged}; disposable copies removed=${disposableCleanup.removed}\n\n` +
  "## Environment and stability\n\n" +
  `- Runtime fingerprint: \`${runtimeBefore.fingerprint}\` (stable: ${runtimeAfter.fingerprint === runtimeBefore.fingerprint})\n` +
  `- Node/npm: ${report.runtime.node} / ${report.runtime.npm}; SSE build: ${md(report.runtime.sse?.currentBuild ?? "n/a")}\n` +
  `- Machine: ${md(report.runtime.cpuModel)}, ${report.runtime.logicalCpuCount} logical CPUs, ${report.runtime.totalMemoryBytes} bytes RAM\n` +
  `- Worker prewarm: requested=${report.safety.workerPrewarm?.requested ?? false}, ready-before-first-operation=${report.safety.workerPrewarm?.readyBeforeFirstCatalogOperation ?? false}, pool=${report.safety.workerPrewarm?.configuredPoolSize ?? "n/a"}\n` +
  `- Hidden-desktop marker: before-present=${markerBefore.present}, after-present=${markerAfter.present}, unchanged=${markerUnchanged}, safe=${markerSafe}\n` +
  `- Official fixture identities: ${report.fixtures.map((entry) => `${entry.id}/${entry.mode}/${entry.officialSourceHash}`).join(", ")}\n\n` +
  "## Timings\n\n| Measure | Seconds |\n| --- | ---: |\n" + timingRows + "\n\n" +
  "| Phase | Status | Seconds |\n| --- | --- | ---: |\n" + (phaseRows || "| n/a | n/a | n/a |") + "\n\n" +
  "## Mutation → immediate API readback\n\n" +
  "| ID | Mutation | Readback | Result | Mutation wall ms | Readback wall ms | Assertion/skip |\n" +
  "| --- | --- | --- | --- | ---: | ---: | --- |\n" +
  (mutationRows || "| n/a | n/a | n/a | n/a | n/a | n/a | n/a |") + "\n\n" +
  "## Per-call direct API timings\n\n" +
  "| # | Phase | Label | Operation | Outcome | E2E wall ms | API envelope ms | Worker ms |\n" +
  "| ---: | --- | --- | --- | --- | ---: | ---: | ---: |\n" +
  (apiCallRows || "| n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |") + "\n\n" +
  "## Safely excluded catalog operations\n\n" +
  "| Classification | Subclassification | Operations | Reason |\n| --- | --- | --- | --- |\n" +
  (exclusionRows || "| n/a | n/a | n/a | n/a |") + "\n\n" +
  `${report.historicalComparison.note} The historical navigation, receipt, vehicle, and VM figures are component measurements only and are not directly comparable.\n` +
  (passed ? "" : `\nFailure phase: ${report.failure.phase}; reasons: ${failureReasons.join(", ")}\n`);

writeExclusive(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeExclusive(markdownPath, markdown);
if (existsSync(rawPath)) rmSync(rawPath, { force: true });
updateStatus([
  `- Status: ${passed ? "completed" : "failed"} — ${classification} run`,
  `- Finished: ${new Date().toISOString()}`,
  `- Total wall time: ${totalSeconds} s`,
  `- JSON report: \`${jsonPath}\``,
  `- Markdown summary: \`${markdownPath}\``,
  `- Zero SSE processes: ${pidsAfter === ""}`,
  `- Hidden-desktop marker absent and unchanged: ${markerSafe}`,
  `- Official Musterfall hashes unchanged: ${officialUnchanged}`,
  `- Disposable copies: ${disposableCleanup.removed ? "removed" : "preserved for diagnosis"}`,
  ...(passed ? [`- Baseline note: canonical whole-journey baseline #${baselineOrdinal}; historical component figures remain non-comparable.`]
    : [`- Failure phase: ${report.failure.phase}`, `- Failure reasons: ${failureReasons.join(", ")}`]),
]);

if (!passed) {
  process.stderr.write(`API-Mega-Reise fehlgeschlagen; Wegwerfbereich zur Diagnose erhalten: ${caseDirectory}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`API-Mega-Reise bestanden: ${totalSeconds} s; Evidenz ${jsonPath}\n`);
}
