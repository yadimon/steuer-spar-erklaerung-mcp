import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { callApiOperationEnvelope, readApiHealthz } from "../dist/api-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { formatCents, parseCents } from "./currency-cents.mjs";
import { classifyPassiveExportDialog, exportDialogEvidence } from "./export-dialog-policy.mjs";
import { profiledTablePage } from "./profiled-table-page.mjs";
import { classifyPassiveStartupDialog } from "./startup-dialog-policy.mjs";
import {
  MEGA_EXCLUDED_DOMAINS,
  MEGA_MUTATION_READBACKS,
  MEGA_OPERATION_CATALOG,
} from "./performance/api-mega-catalog.mjs";
import {
  megaRuntimeFingerprint,
  megaSourceFingerprint,
} from "./performance/api-mega-fingerprint.mjs";
import { writeDeterministicDocument } from "./performance/receipt-workload.mjs";

const baseUrl = process.env.SSE_API_URL;
const rawReportPath = process.env.SSE_MEGA_RAW_REPORT;
const statusPath = process.env.SSE_MEGA_STATUS_PATH;
assert(baseUrl && /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d+$/u.test(baseUrl), "Direkte Loopback-API-URL fehlt.");
assert(rawReportPath && !existsSync(rawReportPath), "Neuer create-only Rohberichtspfad ist Pflicht.");
assert(statusPath, "MEGA_STATUS.md-Pfad fehlt.");
assert.equal(process.env.SSE_TEST_INTERACTIVE_RECEIPT_LEASE_ACTIVE, "1", "Interaktive Test-Lease ist nicht aktiv.");
assert.equal(process.env.SSE_TEST_API_PREWARM, "1", "Der kanonische Lauf braucht den normalen API-Worker-Prewarm.");
assert(!process.env.SSE_TEST_INTERACTIVE_RECEIPT_TOKEN, "Der API-Client darf den internen Receipt-Lease-Nonce nicht sehen.");

const fixtures = JSON.parse(process.env.SSE_MEGA_FIXTURES_JSON ?? "null");
assert(fixtures?.gew && fixtures?.est, "Sanitisierte Gew-/ESt-Fixture-Identitaeten fehlen.");
const caseDir = process.env.SSE_TEST_CASE_DIR;
const documentsDir = process.env.SSE_TEST_DOCUMENTS_DIR;
assert(caseDir && documentsDir, "Isolierte Testressourcen fehlen.");
const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
const tableProfile = profiledTablePage(profileId);
const expectedSourceFingerprint = process.env.SSE_MEGA_EXPECTED_SOURCE_FINGERPRINT;
const expectedRuntimeFingerprint = process.env.SSE_MEGA_EXPECTED_RUNTIME_FINGERPRINT;
const preflightStartedAt = performance.now();
const sourceAtStart = megaSourceFingerprint();
const runtimeAtStart = megaRuntimeFingerprint();
assert.equal(sourceAtStart.fingerprint, expectedSourceFingerprint, "Quellfingerprint driftete vor dem ersten API-Aufruf.");
assert.equal(runtimeAtStart.fingerprint, expectedRuntimeFingerprint, "Runtime-/dist-Fingerprint passt nicht zum Runner.");
assert.equal(sourceAtStart.status, "", "Live-Reise startet nur aus einem sauberen Arbeitsbaum.");

const mutationDeclarations = new Map(MEGA_MUTATION_READBACKS.map((entry) => [entry.id, entry]));
assert.equal(mutationDeclarations.size, MEGA_MUTATION_READBACKS.length, "Doppelte Mutation-ID im Manifest.");

const rounded = (value) => Math.round(value * 1_000) / 1_000;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const operationRecords = [];
const mutationRecords = [];
const phaseRecords = [];
const ownedLaunchPids = new Set();
let controlledRunStartedAt = 0;
let journeyEndedAt = 0;
let controlledRunEndedAt = 0;
let currentPhase = "setup";
let currentHwnd = 0;
let currentPid = 0;
let sseEnvironment = null;
let failure = null;
let cleanup = { attempted: false, stateKnown: false, closed: false, zeroOwnedProcesses: false };
const leaseIssuedAt = Date.parse(process.env.SSE_TEST_INTERACTIVE_RECEIPT_LEASE_ISSUED_AT ?? "");
const leaseExpiresAt = Date.parse(process.env.SSE_TEST_INTERACTIVE_RECEIPT_LEASE_EXPIRES_AT ?? "");
const minimumReceiptLeaseMarginMs = 15 * 60_000;
assert(Number.isFinite(leaseIssuedAt) && Number.isFinite(leaseExpiresAt), "Receipt-Lease-Zeitbindung fehlt.");
assert(leaseExpiresAt > leaseIssuedAt && leaseExpiresAt - leaseIssuedAt <= 60 * 60_000,
  "Receipt-Lease ueberschreitet die maximal zulaessige Stunde.");
const leaseEvidence = {
  issuedAt: new Date(leaseIssuedAt).toISOString(),
  expiresAt: new Date(leaseExpiresAt).toISOString(),
  lifetimeMs: leaseExpiresAt - leaseIssuedAt,
  minimumReceiptPhaseMarginMs: minimumReceiptLeaseMarginMs,
  remainingBeforeReceiptMs: null,
};

const status = (detail) => writeFileSync(statusPath,
  `# API Mega Journey Status\n\n` +
  `- Status: live ${process.env.SSE_MEGA_CLASSIFICATION ?? "cold"} run in progress\n` +
  `- Current phase: ${currentPhase}\n` +
  `- Detail: ${detail}\n` +
  `- API calls completed: ${operationRecords.length}\n` +
  `- Mutation/readback assertions completed: ${mutationRecords.filter((entry) => entry.result === "passed").length}\n` +
  "- Controller: one serial direct-loopback API; no MCP and no direct worker\n",
"utf8");

function timingSubset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (typeof item === "number" && Number.isFinite(item)) return [[key, rounded(item)]];
    if (typeof item === "boolean") return [[key, item]];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = timingSubset(item);
      return nested && Object.keys(nested).length ? [[key, nested]] : [];
    }
    return [];
  }));
}

function recordMutationSkip(id, skipReason) {
  const declaration = mutationDeclarations.get(id);
  assert(declaration, `Nicht deklarierte optionale Mutation '${id}'.`);
  assert.equal(declaration.phase, currentPhase, `${id}: Manifestphase stimmt nicht.`);
  assert(!mutationRecords.some((entry) => entry.id === id), `${id}: optionale Mutation wurde doppelt verbucht.`);
  mutationRecords.push({
    ...declaration,
    execution: 0,
    result: "skipped",
    skipReason,
    mutationTiming: null,
    readbackTiming: null,
  });
}

async function call(operation, args = {}, timeoutMs = 300_000, label = operation) {
  const startedAt = performance.now();
  let envelope;
  try {
    envelope = await callApiOperationEnvelope(operation, args, timeoutMs, { baseUrl });
  } catch (error) {
    operationRecords.push({
      sequence: operationRecords.length + 1,
      phase: currentPhase,
      label,
      operation,
      ok: false,
      kind: error?.kind ?? "exception",
      wallMs: rounded(performance.now() - startedAt),
      envelopeDurationMs: null,
      workerReportedMs: null,
      workerPerformance: null,
      resultSafety: null,
    });
    throw error;
  }
  const wallMs = rounded(performance.now() - startedAt);
  const result = envelope.result;
  operationRecords.push({
    sequence: operationRecords.length + 1,
    phase: currentPhase,
    label,
    operation,
    ok: result.ok,
    kind: result.kind ?? null,
    wallMs,
    envelopeDurationMs: envelope.durationMs,
    workerReportedMs: Number.isFinite(result.ms) ? rounded(result.ms) : null,
    workerPerformance: timingSubset(result.performance),
    resultSafety: {
      verified: typeof result.verified === "boolean" ? result.verified : null,
      foregroundLeaseUsed: typeof result.foregroundLeaseUsed === "boolean" ? result.foregroundLeaseUsed : null,
      physicalInputUsed: typeof result.physicalInputUsed === "boolean" ? result.physicalInputUsed : null,
    },
  });
  assert.equal(result.ok, true, `${operation} meldete ${result.kind ?? "failure"}: ${result.error ?? "ohne Fehlertext"}`);
  return { result, timing: operationRecords.at(-1) };
}

async function read(operation, args, assertion, label = operation, timeoutMs = 300_000) {
  const called = await call(operation, args, timeoutMs, label);
  await assertion?.(called.result);
  return called.result;
}

async function mutateAndRead(id, mutationArgs, mutationAssertion, readbackArgs, readbackAssertion, options = {}) {
  const declaration = mutationDeclarations.get(id);
  assert(declaration, `Nicht deklarierte Mutation '${id}'.`);
  assert.equal(declaration.phase, currentPhase, `${id}: Manifestphase stimmt nicht.`);
  assert(!mutationRecords.some((entry) => entry.id === id), `${id}: Mutation darf pro Journey nur einmal laufen.`);
  const record = {
    ...declaration,
    execution: mutationRecords.filter((entry) => entry.id === id).length + 1,
    result: "running",
    mutationTiming: null,
    readbackTiming: null,
  };
  mutationRecords.push(record);
  try {
    const changed = await call(
      declaration.operation,
      typeof mutationArgs === "function" ? mutationArgs() : mutationArgs,
      options.mutationTimeoutMs ?? 300_000,
      `${id}:mutation`,
    );
    record.mutationTiming = changed.timing;
    let mutationAssertionError = null;
    try { await mutationAssertion?.(changed.result); }
    catch (error) { mutationAssertionError = error; }
    const resolvedReadArgs = typeof readbackArgs === "function" ? readbackArgs(changed.result) : readbackArgs;
    const observed = await call(
      declaration.readbackOperation,
      resolvedReadArgs,
      options.readbackTimeoutMs ?? 300_000,
      `${id}:readback`,
    );
    record.readbackTiming = observed.timing;
    let readbackAssertionError = null;
    try { await readbackAssertion(observed.result, changed.result); }
    catch (error) { readbackAssertionError = error; }
    if (mutationAssertionError) throw mutationAssertionError;
    if (readbackAssertionError) throw readbackAssertionError;
    record.result = "passed";
    return { mutation: changed.result, readback: observed.result };
  } catch (error) {
    record.result = "failed";
    record.failure = String(error?.message ?? error);
    throw error;
  }
}

async function phase(name, action) {
  currentPhase = name;
  status("phase started");
  const startedAt = performance.now();
  try {
    const value = await action();
    phaseRecords.push({ phase: name, status: "passed", wallMs: rounded(performance.now() - startedAt) });
    status("phase completed");
    return value;
  } catch (error) {
    phaseRecords.push({ phase: name, status: "failed", wallMs: rounded(performance.now() - startedAt) });
    throw error;
  }
}

const pdfName = `api-mega-synthetic-${process.pid}.pdf`;
const pdfPath = join(documentsDir, pdfName);
const pdfHash = writeDeterministicDocument(pdfPath, {
  bytes: 8 * 1_024,
  seed: "canonical-live-api-mega",
  contentKey: sourceAtStart.head,
});
const pdfRef = `documents:${pdfName}`;
const healthzStartedAt = performance.now();
const initialHealthz = await readApiHealthz({ baseUrl });
const healthzWallMs = rounded(performance.now() - healthzStartedAt);
assert.equal(initialHealthz.prewarm?.ready, true,
  `API worker prewarm was not ready before the first catalog operation: ${JSON.stringify(initialHealthz.prewarm)}`);
const setupWallMs = rounded(performance.now() - preflightStartedAt);

function fieldMap(state) {
  return new Map((state.fields ?? []).map((field) => [field.fieldId ?? field.id ?? field.label, field.value ?? field.wert]));
}

function findWindow(windows, predicate, message) {
  const matches = (windows.windows ?? []).filter(predicate);
  assert.equal(matches.length, 1, `${message}: ${matches.length} Treffer.`);
  return matches[0];
}

const ownedCaseNames = new Set(Object.values(fixtures).map((fixture) => fixture.targetRef.split(":").at(-1)));
function findOwnedInstances(instances) {
  return (instances.instances ?? []).filter((instance) =>
    ownedCaseNames.has(String(instance.caseName ?? "")) ||
    (currentPid > 0 && instance.pid === currentPid));
}

function assertMenuPopupReadback(windows, changed, expectedEntry) {
  const entry = (changed.eintraege ?? []).find((candidate) => candidate.name === expectedEntry);
  assert(entry, `Menueeintrag '${expectedEntry}' fehlt.`);
  assert((windows.windows ?? []).some((candidate) => candidate.hwnd === entry.hwnd),
    `Menue-Popup fuer '${expectedEntry}' ist beim unmittelbaren API-Readback nicht mehr vorhanden.`);
}

function assertKnownLaunchDialogs(listed) {
  const dialogs = (listed.dialogs ?? []).filter((dialog) =>
    dialog.kind === "native-dialog" || dialog.kind === "qt-dialog");
  assert(dialogs.length <= 1, `Mehrdeutige Startdialoge: ${dialogs.length}.`);
  if (dialogs.length === 1) {
    assert(classifyPassiveStartupDialog(dialogs[0]),
      `Unerwarteter Startdialog '${dialogs[0].title ?? "ohne Titel"}'; nichts beantworten.`);
  }
  return dialogs;
}

function bindLaunchProcess(result, label) {
  assert(Number.isInteger(result.pid) && result.pid > 0, `${label}: Launch lieferte keine positive PID.`);
  currentPid = result.pid;
  ownedLaunchPids.add(currentPid);
  currentHwnd = Number.isInteger(result.instance?.hwnd) ? result.instance.hwnd : 0;
}

function assertReadyLaunchReadback(listed, launched, label) {
  assertKnownLaunchDialogs(listed);
  assert.equal(launched.ready, true, `${label}: Launch blieb ohne verifiziertes Produktfenster.`);
  assert(Number.isInteger(currentHwnd) && currentHwnd > 0, `${label}: Launch lieferte kein gebundenes HWND.`);
}

async function maybeDismissStartupDialog(id, launchReadback) {
  const declaration = mutationDeclarations.get(id);
  assert(declaration, `Nicht deklarierte optionale Startdialog-Mutation '${id}'.`);
  const dialogs = assertKnownLaunchDialogs(launchReadback);
  if (!dialogs.length) {
    recordMutationSkip(id, "no-passive-startup-dialog-present");
    return;
  }
  const dialog = dialogs[0];
  const button = classifyPassiveStartupDialog(dialog);
  await mutateAndRead(
    id,
    { hwnd: dialog.hwnd, fingerprint: dialog.fingerprint, button, waitMs: 2_000 },
    (result) => assert.equal(result.closed, true),
    { pid: currentPid },
    (result) => assert(!(result.dialogs ?? []).some((candidate) => candidate.hwnd === dialog.hwnd)),
    { mutationTimeoutMs: 120_000, readbackTimeoutMs: 120_000 },
  );
}

async function assertBoundUiState(label) {
  await read("ui_state", { hwnd: currentHwnd }, (result) => {
    assert.equal(result.running, true, `${label}: SSE ist nicht lesbar.`);
    assert.equal(result.instance?.hwnd, currentHwnd, `${label}: HWND-Bindung driftete.`);
  }, `${label}:ui-state`);
}

function receiptBinding(list) {
  assert.equal(list.rowsComplete, true, "Belegliste ist nicht vollstaendig.");
  assert.equal(list.count, 1, "Synthetischer Lebenszyklus erwartet genau einen Beleg.");
  assert.equal(list.rows.length, 1, "Beleglistenprojektion ist nicht eindeutig.");
  return list.rows[0];
}

const readReceiptArgs = (row, listFingerprint, hwnd) => ({
  rowRid: row.rowRid,
  rowFingerprint: row.rowFingerprint,
  expectedListFingerprint: listFingerprint,
  hwnd,
});

async function maybeCloseExactExportDialog(pid, expectedExportDialog) {
  const before = await read("dialog_list", { pid }, null, "export-post-dialogs");
  const dialogs = before.dialogs ?? [];
  if (!dialogs.length) {
    recordMutationSkip("export-dialog-cleanup", "no-post-export-dialog-present");
    return { result: "skipped", evidence: [] };
  }
  const classified = dialogs.map((dialog) => ({
    dialog,
    button: classifyPassiveExportDialog(dialog, expectedExportDialog),
  })).filter((entry) => entry.button);
  assert.equal(classified.length, 1,
    `Post-Export-Dialoge sind nicht exakt klassifiziert; nichts beantwortet: ${JSON.stringify(dialogs.map(exportDialogEvidence))}`);
  assert.equal(dialogs.length, 1,
    `Neben dem exakt klassifizierten Exportfenster ist ein unbekannter Dialog offen; nichts beantwortet: ${JSON.stringify(dialogs.map(exportDialogEvidence))}`);
  const { dialog, button } = classified[0];
  await mutateAndRead(
    "export-dialog-cleanup",
    { hwnd: dialog.hwnd, fingerprint: dialog.fingerprint, button, waitMs: 2_000 },
    (result) => assert.equal(result.closed, true),
    { pid },
    (after) => assert(!(after.dialogs ?? []).some((entry) => entry.hwnd === dialog.hwnd),
      "Exakt klassifiziertes Exportfenster blieb offen."),
    { mutationTimeoutMs: 120_000, readbackTimeoutMs: 120_000 },
  );
  return { result: "passed", evidence: dialogs.map(exportDialogEvidence) };
}

controlledRunStartedAt = performance.now();
try {
  await phase("safety", async () => {
    await read("health", {}, (result) => assert.equal(result.running, false, "SSE lief vor dem Backup."));
    const capabilities = await read("capabilities", {}, (result) => {
      assert.equal(result.profile?.id, profileId);
      assert.equal(result.profile?.interactiveReceiptLeaseActive, true);
      for (const operation of MEGA_OPERATION_CATALOG
        .filter((entry) => entry.operation.startsWith("receipt_manager_") && entry.operation !== "receipt_manager_list")
        .map((entry) => entry.operation)) {
        assert.equal(result.operationPolicy[operation].availability, "conditional", `${operation}: Lease nicht sichtbar.`);
        assert.equal(result.operationPolicy[operation].requiresInteractiveReceiptLease, true);
      }
    });
    void capabilities;
    const productInfo = await read("product_info", {}, (result) => {
      assert.equal(result.profileId, profileId);
      assert.equal(result.defaultExecutable?.exists, true);
      assert.equal(result.defaultExecutable?.supported, true);
      assert.equal(result.buildDrift?.drifted, false, "Installierter SSE-Build driftet vom Profil.");
      sseEnvironment = {
        profileId: result.profileId,
        profileStatus: result.profileStatus,
        product: result.product,
        taxYear: result.taxYear,
        engineFileMajor: result.engineFileMajor,
        verifiedBuild: result.buildDrift?.verified,
        currentBuild: result.buildDrift?.current,
        workerInitializationMs: timingSubset(result.workerInitializationMs),
      };
    });
    await read("workspace_status", {}, (result) => {
      assert.equal(result.workspaceReady, true);
      assert.equal(result.caseDirectoryReady, true);
    });
    const cases = await read("list_cases", {}, (result) => {
      const names = new Set((result.cases ?? []).map((entry) => `cases:${entry.name}`));
      assert(names.has(fixtures.gew.sourceRef) && names.has(fixtures.est.sourceRef));
    });
    void cases;
    for (const fixture of [fixtures.gew, fixtures.est]) {
      await read("case_hash", { ref: fixture.sourceRef }, (result) => assert.equal(result.sha256, fixture.sourceHash));
    }
    await mutateAndRead(
      "backup-cases",
      { destinationRef: "backups:api-mega-initial" },
      (result) => {
        assert.equal(result.verified, true);
        assert(result.anzahl >= 2);
        assert.equal(result.files.length, result.anzahl);
      },
      { ref: "backups:api-mega-initial", includeHashes: true },
      (result) => {
        const refs = (result.files ?? []).map((entry) => entry.ref);
        assert(refs.some((ref) => ref.endsWith("pruefsummen.csv")));
        for (const fixture of [fixtures.gew, fixtures.est]) {
          const sourceName = fixture.sourceRef.split(":").at(-1);
          assert(refs.some((ref) => ref.endsWith(sourceName)),
            `Backup-Readback listet den bereitgestellten offiziellen Musterfall '${fixture.id}' nicht.`);
        }
      },
    );
    await mutateAndRead(
      "copy-gew",
      {
        sourceRef: fixtures.gew.sourceRef,
        targetRef: fixtures.gew.targetRef,
        expectedSourceHash: fixtures.gew.sourceHash,
      },
      (result) => assert.equal(result.verified, true),
      { ref: fixtures.gew.targetRef },
      (result) => assert.equal(result.sha256, fixtures.gew.sourceHash),
    );
    await mutateAndRead(
      "copy-est",
      {
        sourceRef: fixtures.est.sourceRef,
        targetRef: fixtures.est.targetRef,
        expectedSourceHash: fixtures.est.sourceHash,
      },
      (result) => assert.equal(result.verified, true),
      { ref: fixtures.est.targetRef },
      (result) => assert.equal(result.sha256, fixtures.est.sourceHash),
    );
    await mutateAndRead(
      "workspace-marker",
      { ref: "workspace:api-mega-marker.txt", text: "canonical-live-api-mega\n" },
      (result) => assert(result.bytes > 0),
      { ref: "workspace:api-mega-marker.txt" },
      (result) => assert.equal(result.text, "canonical-live-api-mega\n"),
    );
    return { productInfo };
  });

  await phase("launch-and-reads", async () => {
    const launchedGew = await mutateAndRead(
      "launch-gew",
      { caseRef: fixtures.gew.targetRef, mode: fixtures.gew.mode },
      (result) => bindLaunchProcess(result, "launch-gew"),
      (result) => ({ pid: result.pid }),
      (result, changed) => assertReadyLaunchReadback(result, changed, "launch-gew"),
    );
    await maybeDismissStartupDialog("launch-gew-startup-dialog", launchedGew.readback);
    await assertBoundUiState("launch-gew");
    await read("page", { hwnd: currentHwnd }, (result) => assert(result.ueberschrift));
    await read("help", { hwnd: currentHwnd }, (result) => {
      assert.equal(typeof result.seite, "string");
      assert(result.seite.length > 0, "Gebundene Eingabehilfe nennt keine Seite.");
      assert(result.abschnitte && typeof result.abschnitte === "object",
        "Gebundene Eingabehilfe liefert keine strukturierten Abschnitte.");
    });
    await read("read_full", { hwnd: currentHwnd }, (result) => assert(Array.isArray(result.elemente ?? result.elements ?? [])));
    await read("read_page", { hwnd: currentHwnd }, (result) => assert(Array.isArray(result.felder ?? result.fields ?? [])));
    await read("page_objects", { pageId: "gew.fahrzeug" }, (result) => assert.equal(result.pageId, "gew.fahrzeug"));
    await read("instances", { includeHash: true }, (result) => {
      assert.equal(result.count, 1);
      assert.equal(result.instances[0].hwnd, currentHwnd);
    });
    await read("windows", {}, (result) => assert((result.windows ?? []).some((entry) => entry.hwnd === currentHwnd)));
    await read("positions", { aktion: "list", hwnd: currentHwnd }, (result) => assert(Array.isArray(result.positionen ?? result.positions ?? [])));
    await read("subpages", { hwnd: currentHwnd }, (result) => assert(Array.isArray(result.seiten ?? result.subpages ?? [])));
    await read("warning_popup_read", { hwnd: currentHwnd, ocr: false }, (result) => assert.equal(result.active, false));
    const snap = await read("snapshot", { hwnd: currentHwnd, namedOnly: true, maxNodes: 800 }, (result) => {
      assert(result.count > 0);
      assert.equal(result.count, result.nodes.length);
    });
    await read("snapshot_compare", { hwnd: currentHwnd, repetitions: 2 }, (result) => {
      assert.equal(result.equivalent, true);
      assert.equal(result.privateValuesReturned, false);
    });
    const probeNode = snap.nodes.find((node) => typeof node.rid === "string" && node.rid);
    assert(probeNode, "Snapshot lieferte keine Runtime-ID fuer den Accessibility-Probe.");
    await read("accessibility_probe", {
      rid: probeNode.rid, maxDepth: 1, maxNodes: 50, includePatterns: true, includeRaw: false, hwnd: currentHwnd,
    }, (result) => assert.equal(result.node?.rid, probeNode.rid));
  });

  let gewHash;
  await phase("table-and-persistence", async () => {
    let tableStart;
    await mutateAndRead(
      "goto-table",
      { name: tableProfile.heading, maxSteps: 200, useSearch: true, hwnd: currentHwnd },
      (result) => assert.equal(result.erreicht, true),
      { sumLabel: tableProfile.sumLabel, sumOccurrence: tableProfile.sumOccurrence, noKeys: true, hwnd: currentHwnd },
      (result) => {
        tableStart = result;
        assert(result.kopf.includes(tableProfile.amountColumn));
        assert.equal(formatCents(parseCents(result.summe)), result.summe);
      },
    );
    await read("read_table", { hwnd: currentHwnd }, (result) => assert(Array.isArray(result.zeilen ?? [])));
    const startSum = tableStart.summe;
    const startCents = parseCents(startSum);
    const addedAmount = "0,17";
    const correctedAmount = "0,19";
    const existing = tableStart.zeilen.flat().map((value) => String(value ?? ""));
    assert(!existing.includes(addedAmount) && !existing.includes(correctedAmount));
    const sumAfterAdd = formatCents(startCents + parseCents(addedAmount));
    const sumAfterUpdate = formatCents(startCents + parseCents(correctedAmount));
    let addedRid;
    await mutateAndRead(
      "table-add",
      {
        expectedPage: tableProfile.heading,
        werte: tableStart.kopf.map((column) => column === tableProfile.amountColumn ? addedAmount : ""),
        sumLabel: tableProfile.sumLabel, sumOccurrence: tableProfile.sumOccurrence,
        expectedBefore: startSum, expectedAfter: sumAfterAdd, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.verified, true);
        const amountColumnIndex = tableStart.kopf.indexOf(tableProfile.amountColumn);
        addedRid = result.zellen?.find((cell) => cell.spalte === amountColumnIndex)?.rid;
        assert.equal(typeof addedRid, "string");
      },
      { sumLabel: tableProfile.sumLabel, sumOccurrence: tableProfile.sumOccurrence, noKeys: true, hwnd: currentHwnd },
      (result) => {
        assert.equal(result.summe, sumAfterAdd);
        assert(result.zeilen.flat().map(String).includes(addedAmount));
      },
    );
    let updatedRid;
    await mutateAndRead(
      "table-update",
      {
        expectedPage: tableProfile.heading, text: addedAmount, targetRid: addedRid,
        werte: tableStart.kopf.map((column) => column === tableProfile.amountColumn ? correctedAmount : null),
        sumLabel: tableProfile.sumLabel, sumOccurrence: tableProfile.sumOccurrence,
        expectedBefore: sumAfterAdd, expectedAfter: sumAfterUpdate, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.verified, true);
        updatedRid = result.tableBinding?.targetRid;
        assert.equal(typeof updatedRid, "string");
      },
      { sumLabel: tableProfile.sumLabel, sumOccurrence: tableProfile.sumOccurrence, noKeys: true, hwnd: currentHwnd },
      (result) => {
        assert.equal(result.summe, sumAfterUpdate);
        const cells = result.zeilen.flat().map(String);
        assert(cells.includes(correctedAmount) && !cells.includes(addedAmount));
      },
    );
    const hashBeforeSave = (await read("case_hash", { ref: fixtures.gew.targetRef })).sha256;
    await mutateAndRead(
      "save-table",
      { caseRef: fixtures.gew.targetRef, expectedHashBefore: hashBeforeSave, hwnd: currentHwnd },
      (result) => assert.equal(result.verified, true),
      { ref: fixtures.gew.targetRef },
      (result) => {
        gewHash = result.sha256;
        assert.notEqual(result.sha256, hashBeforeSave);
      },
    );
    await mutateAndRead(
      "close-after-save",
      { pid: currentPid, hwnd: currentHwnd, discardChanges: true },
      (result) => assert.equal(result.stillRunning, false),
      {},
      (result) => assert.equal(result.running, false),
      { mutationTimeoutMs: 180_000 },
    );
    currentHwnd = 0; currentPid = 0;
    const reopenedGew = await mutateAndRead(
      "reopen-gew",
      { caseRef: fixtures.gew.targetRef, mode: fixtures.gew.mode },
      (result) => bindLaunchProcess(result, "reopen-gew"),
      (result) => ({ pid: result.pid }),
      (result, changed) => assertReadyLaunchReadback(result, changed, "reopen-gew"),
    );
    await maybeDismissStartupDialog("reopen-gew-startup-dialog", reopenedGew.readback);
    await assertBoundUiState("reopen-gew");
    let persistedTable;
    await mutateAndRead(
      "goto-persisted-table",
      { name: tableProfile.heading, maxSteps: 200, useSearch: true, hwnd: currentHwnd },
      (result) => assert.equal(result.erreicht, true),
      { sumLabel: tableProfile.sumLabel, sumOccurrence: tableProfile.sumOccurrence, noKeys: true, hwnd: currentHwnd },
      (result) => {
        persistedTable = result;
        assert.equal(result.summe, sumAfterUpdate);
        assert(result.zeilen.flat().map(String).includes(correctedAmount));
      },
    );
    const correctedColumns = persistedTable.zeilen.flatMap((row) => row.map((cell, index) => ({ cell: String(cell ?? ""), index })))
      .filter((entry) => entry.cell === correctedAmount).map((entry) => entry.index);
    const amountIndex = persistedTable.kopf.indexOf(tableProfile.amountColumn);
    const hits = await read("find", { name: correctedAmount, hwnd: currentHwnd }, (result) => assert((result.hits ?? []).length >= 1));
    const orderedHits = [...hits.hits].sort((left, right) => left.x - right.x);
    const deleteRid = orderedHits[[...correctedColumns].sort((a, b) => a - b).indexOf(amountIndex)]?.rid;
    assert.equal(typeof deleteRid, "string");
    await mutateAndRead(
      "table-delete",
      {
        expectedPage: tableProfile.heading, text: correctedAmount, targetRid: deleteRid,
        sumLabel: tableProfile.sumLabel, sumOccurrence: tableProfile.sumOccurrence,
        expectedBefore: sumAfterUpdate, expectedAfter: startSum, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.verified, true),
      { sumLabel: tableProfile.sumLabel, sumOccurrence: tableProfile.sumOccurrence, noKeys: true, hwnd: currentHwnd },
      (result) => {
        assert.equal(result.summe, startSum);
        assert(!result.zeilen.flat().map(String).includes(correctedAmount));
      },
    );
    await mutateAndRead(
      "save-table-clean",
      { caseRef: fixtures.gew.targetRef, expectedHashBefore: gewHash, hwnd: currentHwnd },
      (result) => assert.equal(result.verified, true),
      { ref: fixtures.gew.targetRef },
      (result) => {
        assert.notEqual(result.sha256, gewHash);
        gewHash = result.sha256;
      },
    );
  });

  await phase("ustva", async () => {
    const ustvaPage = `Umsatzsteuer-Voranmeldungen ${profile.taxYear}`;
    let original;
    await mutateAndRead(
      "goto-ustva",
      { name: ustvaPage, maxSteps: 200, useSearch: true, hwnd: currentHwnd },
      (result) => assert.equal(result.erreicht, true),
      { hwnd: currentHwnd },
      (result) => {
        original = result;
        assert.equal(result.pageKind, "overview");
      },
    );
    const ustvaPageRead = await read("read_page", { hwnd: currentHwnd }, (result) => {
      assert(Array.isArray(result.felder ?? result.fields ?? []));
    }, "ustva-period-selector-read");
    const ustvaFields = ustvaPageRead.felder ?? ustvaPageRead.fields ?? [];
    const periodSelectorFields = ustvaFields.filter((field) =>
      (field.typ ?? field.type) === "ComboBox" &&
      (field.label ?? field.name) !== "Voranmeldezeitraum");
    assert.equal(periodSelectorFields.length, 1,
      `UStVA-${original.period.frequency}-Zeitraumselektor ist nicht eindeutig strukturiert lesbar.`);
    const periodSelectorName = periodSelectorFields[0].label ?? periodSelectorFields[0].name;
    await read("combo_options", { name: periodSelectorName, hwnd: currentHwnd }, (result) => {
      assert((result.options ?? []).length > 0);
      assert.equal(typeof result.current, "string");
    });
    const selector = original.period.frequency === "quarterly" ? "quarter" : "month";
    const alternate = selector === "quarter" ? (original.period.key === "q1" ? "q2" : "q1")
      : (original.period.key === "january" ? "february" : "january");
    await mutateAndRead(
      "ustva-period-change",
      {
        selector, expectedCurrent: original.period.key, value: alternate,
        expectedCaseRef: fixtures.gew.targetRef, expectedCaseHash: gewHash, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.verified, true),
      { hwnd: currentHwnd },
      (result) => assert.equal(result.period.key, alternate),
    );
    await mutateAndRead(
      "ustva-period-restore",
      {
        selector, expectedCurrent: alternate, value: original.period.key,
        expectedCaseRef: fixtures.gew.targetRef, expectedCaseHash: gewHash, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.verified, true),
      { hwnd: currentHwnd },
      (result) => {
        assert.equal(result.period.key, original.period.key);
        assert.equal(result.amounts.settlement.cents, original.amounts.settlement.cents);
      },
    );
    const originalFlag = original.flags.documents;
    await mutateAndRead(
      "ustva-flag-change",
      {
        flag: "documents", expectedBefore: originalFlag, value: !originalFlag, expectedAfter: !originalFlag,
        expectedCaseRef: fixtures.gew.targetRef, expectedCaseHash: gewHash, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.verified, true),
      { hwnd: currentHwnd },
      (result) => assert.equal(result.flags.documents, !originalFlag),
    );
    await mutateAndRead(
      "ustva-flag-restore",
      {
        flag: "documents", expectedBefore: !originalFlag, value: originalFlag, expectedAfter: originalFlag,
        expectedCaseRef: fixtures.gew.targetRef, expectedCaseHash: gewHash, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.verified, true),
      { hwnd: currentHwnd },
      (result) => assert.equal(result.flags.documents, originalFlag),
    );
    const special = original.amounts.specialAdvancePayment;
    const changedDisplay = special.cents === 0 ? "100,00" : "0,00";
    const changedCents = special.cents === 0 ? 10_000 : 0;
    await mutateAndRead(
      "ustva-value-change",
      {
        field: "special_advance_payment", expectedBefore: special.display,
        value: changedDisplay, expectedAfter: changedDisplay,
        expectedCaseRef: fixtures.gew.targetRef, expectedCaseHash: gewHash, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.verified, true),
      { hwnd: currentHwnd },
      (result) => {
        assert.equal(result.amounts.specialAdvancePayment.cents, changedCents);
        assert.equal(result.amounts.settlement.cents,
          original.amounts.settlement.cents + special.cents - changedCents);
      },
    );
    await mutateAndRead(
      "ustva-value-restore",
      {
        field: "special_advance_payment", expectedBefore: changedDisplay,
        value: special.display, expectedAfter: special.display,
        expectedCaseRef: fixtures.gew.targetRef, expectedCaseHash: gewHash, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.verified, true),
      { hwnd: currentHwnd },
      (result) => {
        assert.equal(result.amounts.specialAdvancePayment.cents, special.cents);
        assert.equal(result.amounts.settlement.cents, original.amounts.settlement.cents);
      },
    );
    await mutateAndRead(
      "ustva-section-open",
      { section: "input_tax", hwnd: currentHwnd },
      (result) => assert.equal(result.ustva?.targetPage, "Abziehbare Vorsteuer"),
      { hwnd: currentHwnd },
      (result) => assert.equal(result.pageKind, "input_tax"),
    );
    await mutateAndRead(
      "ustva-section-restore",
      {
        name: "Zurück", expectedPageBefore: "Abziehbare Vorsteuer",
        expectedPageAfter: ustvaPage, waitMs: 3_000, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.verified, true),
      { hwnd: currentHwnd },
      (result) => {
        assert.equal(result.pageKind, "overview");
        assert.equal(result.period.key, original.period.key);
        assert.equal(result.amounts.settlement.cents, original.amounts.settlement.cents);
      },
      { mutationTimeoutMs: 120_000 },
    );
  });

  await phase("artifacts", async () => {
    let collected;
    let collectReportedHash;
    await mutateAndRead(
      "collect-result",
      { resultRef: "results:api-mega-collect.json", maxPages: 1, hwnd: currentHwnd },
      (result) => {
        assert.equal(result.anzahl, 1);
        assert.match(result.dateiHash, /^[A-F0-9]{64}$/u);
        collectReportedHash = result.dateiHash;
      },
      { ref: "results:api-mega-collect.json" },
      (result) => {
        collected = JSON.parse(result.text);
        assert.equal(collected.anzahl, 1);
        assert(Array.isArray(collected.seiten));
      },
    );
    const fields = collected.seiten.flatMap((page) => (page.felder ?? []).map((field) => ({ page, field })));
    const unique = fields.find(({ page, field }) =>
      field.label && typeof field.wert === "string" &&
      fields.filter((entry) => entry.page.ueberschrift === page.ueberschrift && entry.field.label === field.label).length === 1);
    assert(unique, "Collect-Bericht enthaelt kein eindeutiges Feld fuer verify.");
    const fileRead = await read("workspace_file_list", { ref: "results:.", includeHashes: true },
      (result) => assert((result.files ?? []).some((entry) => entry.ref === "results:api-mega-collect.json")));
    const listedCollectHash = fileRead.files.find((entry) => entry.ref === "results:api-mega-collect.json").sha256;
    assert.equal(listedCollectHash, collectReportedHash);
    await read("verify", {
      sourceRef: "results:api-mega-collect.json",
      expectedSourceHash: listedCollectHash,
      allowIncompleteSource: collected.vollstaendig !== true,
      erwartungen: [{
        seite: unique.page.ueberschrift, label: unique.field.label, wert: unique.field.wert,
      }],
    }, (result) => assert.equal(result.vergleichOk, true));
    await mutateAndRead(
      "screenshot-result",
      { resultRef: "results:api-mega.png", includeImage: false, hwnd: currentHwnd },
      (result) => assert.equal(result.shot?.path, "results:api-mega.png"),
      { ref: "results:.", includeHashes: true },
      (result) => {
        const image = result.files.find((entry) => entry.ref === "results:api-mega.png");
        assert(image);
        assert.match(image.sha256, /^[A-F0-9]{64}$/u);
      },
    );
    let exportDialog;
    await mutateAndRead(
      "export-open",
      { resultRef: "results:api-mega-csv", hwnd: currentHwnd },
      (result) => {
        assert.equal(result.offeneDialoge, 1);
        exportDialog = result.dialog;
      },
      { pid: currentPid },
      (result) => assert((result.dialogs ?? []).some((dialog) => dialog.hwnd === exportDialog.hwnd)),
    );
    const exportButton = "Klicken Sie hier, um Ihre Daten zu exportieren";
    assert((exportDialog.buttons ?? []).some((button) => button.name === exportButton));
    await mutateAndRead(
      "export-trigger",
      { hwnd: exportDialog.hwnd, fingerprint: exportDialog.fingerprint, button: exportButton, waitMs: 3_000 },
      null,
      { pid: currentPid },
      (result) => assert((result.dialogs ?? []).some((dialog) => dialog.title === "Ausgabe-Verzeichnis wählen")),
      { mutationTimeoutMs: 120_000, readbackTimeoutMs: 120_000 },
    );
    await mutateAndRead(
      "export-folder",
      { expectedDialogTitle: "Ausgabe-Verzeichnis wählen", resourceRef: "results:api-mega-csv", waitMs: 5_000 },
      (result) => assert.equal(result.dialogClosed, true),
      { pid: currentPid },
      (result) => assert(!(result.dialogs ?? []).some((dialog) => dialog.title === "Ausgabe-Verzeichnis wählen")),
      { mutationTimeoutMs: 120_000, readbackTimeoutMs: 120_000 },
    );
    let csvFiles = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const listing = await read("workspace_file_list", { ref: "results:api-mega-csv", includeHashes: true });
      csvFiles = (listing.files ?? []).filter((entry) => entry.ref.toLowerCase().endsWith(".csv"));
      if (csvFiles.some((entry) => entry.bytes > 0)) break;
      await wait(500);
    }
    assert(csvFiles.length > 0 && csvFiles.some((entry) => entry.bytes > 0), "CSV-Export lieferte keine nichtleere Datei.");
    await maybeCloseExactExportDialog(currentPid, exportDialog);
    let valuesWindow;
    await mutateAndRead(
      "result-details-open",
      { openIfNeeded: true, hwnd: currentHwnd },
      (result) => assert.equal(result.vollstaendig, true),
      {},
      (result) => {
        valuesWindow = findWindow(result, (entry) => String(entry.title ?? "").startsWith("Werte-Info:"), "Werte-Info");
      },
    );
    await mutateAndRead(
      "result-details-close",
      {
        pid: valuesWindow.pid, hwnd: valuesWindow.hwnd,
        titleFingerprint: valuesWindow.titleFingerprint, waitMs: 2_000,
      },
      (result) => assert.equal(result.closed, true),
      {},
      (result) => assert(!(result.windows ?? []).some((entry) => entry.hwnd === valuesWindow.hwnd)),
      { mutationTimeoutMs: 120_000 },
    );
    const artifactMenuOpened = await mutateAndRead(
      "artifact-menu-open",
      { name: "Datei", hwnd: currentHwnd },
      (result) => assert(JSON.stringify(result).includes("Export für das Finanzamt")),
      {},
      (result, changed) => assertMenuPopupReadback(result, changed, "Export für das Finanzamt (CSV-Dateien)"),
      { mutationTimeoutMs: 120_000 },
    );
    const artifactMenuEntry = (artifactMenuOpened.mutation.eintraege ?? [])
      .find((entry) => entry.name === "Export für das Finanzamt (CSV-Dateien)");
    assert(Number.isInteger(artifactMenuEntry?.hwnd) && artifactMenuEntry.hwnd > 0,
      "Datei-Menue lieferte kein gebundenes Popup-HWND.");
    await mutateAndRead(
      "artifact-menu-close",
      { name: "Datei", hwnd: currentHwnd },
      (result) => assert.equal(result.popupCountAfter, 0),
      {},
      (result) => assert(!(result.windows ?? []).some((entry) => entry.hwnd === artifactMenuEntry.hwnd),
        "Das exakt gebundene Datei-Menue-Popup ist im unmittelbaren windows-Readback noch vorhanden."),
      { mutationTimeoutMs: 120_000 },
    );
  });

  await phase("known-fields", async () => {
    await mutateAndRead(
      "close-gew",
      { pid: currentPid, hwnd: currentHwnd, discardChanges: true },
      (result) => assert.equal(result.stillRunning, false),
      {},
      (result) => assert.equal(result.running, false),
      { mutationTimeoutMs: 180_000 },
    );
    currentHwnd = 0; currentPid = 0;
    const launchedEst = await mutateAndRead(
      "launch-est",
      { caseRef: fixtures.est.targetRef, mode: fixtures.est.mode },
      (result) => bindLaunchProcess(result, "launch-est"),
      (result) => ({ pid: result.pid }),
      (result, changed) => assertReadyLaunchReadback(result, changed, "launch-est"),
    );
    await maybeDismissStartupDialog("launch-est-startup-dialog", launchedEst.readback);
    await assertBoundUiState("launch-est");
    const pageId = "est.sonstige_werbungskosten_fahrten";
    const fieldId = "kontofuehrungsgebuehren_pauschal";
    const fieldLabel = "Kontoführungsgebühren (pauschal)";
    let fieldState;
    await mutateAndRead(
      "goto-known-field",
      { pageId, hwnd: currentHwnd },
      (result) => assert.equal(result.pageId, pageId),
      { pageId, hwnd: currentHwnd },
      (result) => {
        fieldState = result;
        assert.equal(result.pageId, pageId);
        assert.equal(result.onExpectedPage, true);
        assert.match(result.epoch, /^[A-F0-9]{64}$/u);
      },
    );
    const originalValue = fieldMap(fieldState).get(fieldId) ?? fieldMap(fieldState).get(fieldLabel);
    assert.equal(typeof originalValue, "string");
    await read("get_value", { name: fieldLabel, hwnd: currentHwnd },
      (result) => assert.equal(result.value, originalValue));
    await read("find", { name: fieldLabel, hwnd: currentHwnd },
      (result) => assert((result.hits ?? []).length >= 1));
    const temporaryValue = originalValue === "17,00" ? "18,00" : "17,00";
    const correctedValue = ["19,00", "20,00"].find((value) => value !== originalValue && value !== temporaryValue);
    assert(correctedValue, "Kein eindeutiger synthetischer Korrekturwert verfuegbar.");
    let afterWrite;
    await mutateAndRead(
      "known-field-write",
      {
        pageId,
        fields: [{ fieldId, expectedBefore: originalValue, value: temporaryValue, expectedAfter: temporaryValue }],
        expectedEpoch: fieldState.epoch, stopOnError: true, rollback: "best-effort", finalReadback: true, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.resultingState, "completed-verified");
        assert.equal(result.finalReadbackVerified, true);
      },
      { pageId, hwnd: currentHwnd },
      (result) => {
        afterWrite = result;
        assert.equal(fieldMap(result).get(fieldId) ?? fieldMap(result).get(fieldLabel), temporaryValue);
      },
    );
    let afterCorrection;
    await mutateAndRead(
      "known-field-correction",
      {
        pageId,
        fields: [{ fieldId, expectedBefore: temporaryValue, value: correctedValue, expectedAfter: correctedValue }],
        expectedEpoch: afterWrite.epoch, stopOnError: true, rollback: "best-effort", finalReadback: true, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.finalReadbackVerified, true),
      { pageId, hwnd: currentHwnd },
      (result) => {
        afterCorrection = result;
        assert.equal(fieldMap(result).get(fieldId) ?? fieldMap(result).get(fieldLabel), correctedValue);
      },
    );
    await mutateAndRead(
      "known-field-restore",
      {
        pageId,
        fields: [{ fieldId, expectedBefore: correctedValue, value: originalValue, expectedAfter: originalValue }],
        expectedEpoch: afterCorrection.epoch, stopOnError: true, rollback: "best-effort", finalReadback: true, hwnd: currentHwnd,
      },
      (result) => assert.equal(result.finalReadbackVerified, true),
      { pageId, hwnd: currentHwnd },
      (result) => assert.equal(fieldMap(result).get(fieldId) ?? fieldMap(result).get(fieldLabel), originalValue),
    );
  });

  await phase("receipts", async () => {
    leaseEvidence.remainingBeforeReceiptMs = leaseExpiresAt - Date.now();
    assert(leaseEvidence.remainingBeforeReceiptMs >= minimumReceiptLeaseMarginMs,
      `Receipt-Phase startet mit nur ${leaseEvidence.remainingBeforeReceiptMs} ms Lease-Restzeit; ` +
      `${minimumReceiptLeaseMarginMs} ms sind Pflicht. Keine Receipt-Mutation begonnen.`);
    await mutateAndRead(
      "menu-open",
      { name: "Extras", hwnd: currentHwnd },
      (result) => assert(JSON.stringify(result).includes("BelegManager")),
      {},
      (result, changed) => assertMenuPopupReadback(result, changed, "BelegManager"),
      { mutationTimeoutMs: 120_000 },
    );
    let managerWindow;
    await mutateAndRead(
      "receipt-manager-open",
      { name: "BelegManager", waitMs: 4_000, hwnd: currentHwnd },
      (result) => assert.equal(result.ausgeloest, "BelegManager"),
      {},
      (result) => {
        managerWindow = findWindow(result, (entry) => String(entry.title ?? "") === "BelegManager", "BelegManager");
      },
      { mutationTimeoutMs: 120_000 },
    );
    const baseline = await read("receipt_manager_list", { hwnd: currentHwnd }, (result) => {
      assert.equal(result.rowsComplete, true);
      assert.equal(result.count, 0, "Nichtleere Belegliste: keine vorhandenen Belege ansehen oder veraendern.");
      assert.equal(result.draftCount, 0);
    }, "receipt-baseline-list", 120_000);
    await mutateAndRead(
      "receipt-go-home",
      { actionId: "goHome", hwnd: currentHwnd },
      (result) => assert.equal(result.stateAfter, "start"),
      { toolWindow: "receiptManager", namedOnly: true, maxNodes: 500, hwnd: currentHwnd },
      (result) => assert(result.count > 0),
      { mutationTimeoutMs: 120_000 },
    );
    let emptyList;
    await mutateAndRead(
      "receipt-show-list",
      { actionId: "showAllReceipts", hwnd: currentHwnd },
      (result) => assert.equal(result.stateAfter, "list"),
      { hwnd: currentHwnd },
      (result) => {
        emptyList = result;
        assert.equal(result.count, 0);
        assert.equal(result.rowsComplete, true);
      },
      { mutationTimeoutMs: 120_000 },
    );
    let importedList;
    await mutateAndRead(
      "receipt-import",
      {
        resourceRef: pdfRef, expectedHash: pdfHash,
        expectedListFingerprint: emptyList.listFingerprint,
        expectedCountBefore: 0, acknowledgeImport: true, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.sourceHashStable, true);
        assert.equal(result.countAfter, 1);
      },
      { hwnd: currentHwnd },
      (result) => {
        importedList = result;
        assert.equal(result.count, 1);
        assert.equal(result.draftCount, 1);
        receiptBinding(result);
      },
      { mutationTimeoutMs: 180_000, readbackTimeoutMs: 120_000 },
    );
    let detail = await read("receipt_manager_read",
      readReceiptArgs(receiptBinding(importedList), importedList.listFingerprint, currentHwnd),
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.valuesComplete, true);
      }, "receipt-import-detail", 120_000);
    const serial = sourceAtStart.head.slice(0, 8).toUpperCase();
    const receiptValues = {
      title: `API Mega Synthetic ${serial}`,
      date: "2025-01-15",
      documentNumber: `MEGA-${serial}`,
      amount: "12,34",
      vatRate: "19",
      net: false,
      note: "Generated synthetic benchmark receipt",
    };
    await mutateAndRead(
      "receipt-update",
      {
        ...readReceiptArgs(detail.row, detail.listFingerprint, currentHwnd),
        expectedDetailFingerprint: detail.detailFingerprint,
        values: receiptValues, acknowledgeUpdate: true,
      },
      (result) => assert.equal(result.verified, true),
      (result) => readReceiptArgs(result.rowAfter, result.listFingerprintAfter, currentHwnd),
      (result) => {
        detail = result;
        assert.equal(result.verified, true);
        for (const [key, value] of Object.entries(receiptValues)) assert.equal(result.values[key], value, key);
      },
      { mutationTimeoutMs: 180_000, readbackTimeoutMs: 120_000 },
    );
    let category;
    const classificationOptions = await read(
      "receipt_manager_classification_options",
      {
        ...readReceiptArgs(detail.row, detail.listFingerprint, currentHwnd),
        expectedDetailFingerprint: detail.detailFingerprint, kind: "categories",
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.dirtyStateUnchanged, true);
        assert((result.options ?? []).length > 0);
        const names = result.options.map((option) => option.name);
        category = names.includes("Arbeitsmittel") ? "Arbeitsmittel" : names[0];
        assert.equal(typeof category, "string");
      },
      "receipt-options",
      180_000,
    );
    detail = await read(
      "receipt_manager_read",
      readReceiptArgs(classificationOptions.row, classificationOptions.listFingerprint, currentHwnd),
      (result) => {
        assert.equal(result.values.title, receiptValues.title);
      },
      "receipt-options-detail-readback",
      120_000,
    );
    let classifiedList;
    await mutateAndRead(
      "receipt-classify",
      {
        ...readReceiptArgs(detail.row, detail.listFingerprint, currentHwnd),
        expectedDetailFingerprint: detail.detailFingerprint,
        values: { categories: [category] }, acknowledgeClassification: true,
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.deepEqual(result.valuesAfter.categories, [category]);
      },
      { hwnd: currentHwnd, filter: { exactTitle: receiptValues.title } },
      (result) => {
        classifiedList = result;
        assert.equal(result.rowsComplete, true);
        assert.equal(result.count, 1);
        assert.equal(result.matchedCount, 1);
        assert.equal(result.draftCount, 0, "Klassifizierter Beleg blieb unerwartet ein Entwurf.");
      },
      { mutationTimeoutMs: 240_000, readbackTimeoutMs: 120_000 },
    );
    detail = await read("receipt_manager_read",
      readReceiptArgs(receiptBinding(classifiedList), classifiedList.listFingerprint, currentHwnd),
      (result) => {
        assert.equal(result.values.title, receiptValues.title);
        assert.equal(result.values.documentNumber, receiptValues.documentNumber);
      }, "receipt-classified-detail", 120_000);
    let upsertList;
    await mutateAndRead(
      "receipt-upsert-idempotence",
      {
        items: [{
          resourceRef: pdfRef, expectedHash: pdfHash,
          identity: { exactTitle: receiptValues.title, documentNumber: receiptValues.documentNumber },
          onExisting: "skip", values: receiptValues,
        }],
        acknowledgeBulkUpsert: true, stopOnError: true, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.completedCount, 1);
        assert(["skipped", "skip"].includes(result.completed[0].action));
      },
      { hwnd: currentHwnd, filter: { exactTitle: receiptValues.title } },
      (result) => {
        upsertList = result;
        assert.equal(result.count, 1);
        assert.equal(result.matchedCount, 1);
      },
      { mutationTimeoutMs: 300_000, readbackTimeoutMs: 120_000 },
    );
    const linkedRow = receiptBinding(upsertList);
    detail = await read("receipt_manager_read", readReceiptArgs(linkedRow, upsertList.listFingerprint, currentHwnd),
      (result) => assert.equal(result.values.documentNumber, receiptValues.documentNumber), "receipt-pre-link-detail", 120_000);
    const windowsBeforeLink = await read("windows", {});
    managerWindow = findWindow(windowsBeforeLink, (entry) => entry.hwnd === managerWindow.hwnd, "BelegManager vor Link");
    await mutateAndRead(
      "receipt-manager-close-before-link",
      {
        pid: managerWindow.pid, hwnd: managerWindow.hwnd,
        titleFingerprint: managerWindow.titleFingerprint, waitMs: 2_000,
      },
      (result) => assert.equal(result.closed, true),
      {},
      (result) => assert(!(result.windows ?? []).some((entry) => entry.hwnd === managerWindow.hwnd)),
      { mutationTimeoutMs: 120_000 },
    );
    // This is the repository's previously live-verified 2025 Musterfall link target.
    const targetPage = "Einnahmen: Lotterie";
    const expectedLinkTarget = targetPage.split(": ").at(-1);
    assert(expectedLinkTarget, "Beleg-Linkziel ist aus der verifizierten Seitenueberschrift nicht ableitbar.");
    await mutateAndRead(
      "goto-receipt-link-target",
      { name: targetPage, maxSteps: 250, useSearch: true, hwnd: currentHwnd },
      (result) => assert.equal(result.erreicht, true),
      { hwnd: currentHwnd },
      (result) => assert.equal(result.ueberschrift, targetPage),
    );
    const linkItems = [{
      expectedReceiptTitle: receiptValues.title,
      expectedDocumentNumber: receiptValues.documentNumber,
      receiptContentFingerprint: linkedRow.contentFingerprint,
      linked: true,
    }];
    await mutateAndRead(
      "receipt-link",
      {
        items: linkItems, expectedTargetPage: targetPage, expectedLinkTarget,
        acknowledgeLinkChange: true, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.persistenceVerified, true);
        assert.equal(result.linkedAfter, true);
      },
      {
        items: linkItems, expectedTargetPage: targetPage, expectedLinkTarget,
        acknowledgeLinkChange: true, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.noChanges, true);
        assert.equal(result.applied, false);
        assert.equal(result.linkedBefore, true);
        assert.equal(result.linkedAfter, true);
        assert.equal(result.persistenceVerified, true);
      },
      { mutationTimeoutMs: 240_000, readbackTimeoutMs: 240_000 },
    );
    await mutateAndRead(
      "receipt-menu-open-after-link",
      { name: "Extras", hwnd: currentHwnd },
      (result) => assert(JSON.stringify(result).includes("BelegManager")),
      {},
      (result, changed) => assertMenuPopupReadback(result, changed, "BelegManager"),
      { mutationTimeoutMs: 120_000 },
    );
    let afterLinkList;
    await mutateAndRead(
      "receipt-manager-open-after-link",
      { name: "BelegManager", waitMs: 4_000, hwnd: currentHwnd },
      null,
      { hwnd: currentHwnd, filter: { exactTitle: receiptValues.title } },
      (result) => {
        afterLinkList = result;
        assert.equal(result.count, 1);
        assert.equal(result.matchedCount, 1);
      },
      { mutationTimeoutMs: 120_000, readbackTimeoutMs: 120_000 },
    );
    await read("receipt_manager_read",
      readReceiptArgs(receiptBinding(afterLinkList), afterLinkList.listFingerprint, currentHwnd),
      (result) => assert.equal(result.values.title, receiptValues.title), "receipt-after-link-detail", 120_000);
    const managerAfterLink = findWindow(await read("windows", {}),
      (entry) => String(entry.title ?? "") === "BelegManager", "BelegManager nach Link");
    await mutateAndRead(
      "receipt-manager-close-before-unlink",
      {
        pid: managerAfterLink.pid, hwnd: managerAfterLink.hwnd,
        titleFingerprint: managerAfterLink.titleFingerprint, waitMs: 2_000,
      },
      (result) => assert.equal(result.closed, true),
      {},
      (result) => assert(!(result.windows ?? []).some((entry) => entry.hwnd === managerAfterLink.hwnd)),
      { mutationTimeoutMs: 120_000 },
    );
    await mutateAndRead(
      "receipt-unlink",
      {
        items: [{ ...linkItems[0], linked: false }], expectedTargetPage: targetPage, expectedLinkTarget,
        acknowledgeLinkChange: true, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.persistenceVerified, true);
        assert.equal(result.linkedAfter, false);
      },
      {
        items: [{ ...linkItems[0], linked: false }], expectedTargetPage: targetPage, expectedLinkTarget,
        acknowledgeLinkChange: true, hwnd: currentHwnd,
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.noChanges, true);
        assert.equal(result.applied, false);
        assert.equal(result.linkedBefore, false);
        assert.equal(result.linkedAfter, false);
        assert.equal(result.persistenceVerified, true);
      },
      { mutationTimeoutMs: 240_000, readbackTimeoutMs: 240_000 },
    );
    await mutateAndRead(
      "receipt-menu-open-after-unlink",
      { name: "Extras", hwnd: currentHwnd },
      (result) => assert(JSON.stringify(result).includes("BelegManager")),
      {},
      (result, changed) => assertMenuPopupReadback(result, changed, "BelegManager"),
      { mutationTimeoutMs: 120_000 },
    );
    let afterUnlinkList;
    await mutateAndRead(
      "receipt-manager-open-after-unlink",
      { name: "BelegManager", waitMs: 4_000, hwnd: currentHwnd },
      null,
      { hwnd: currentHwnd, filter: { exactTitle: receiptValues.title } },
      (result) => {
        afterUnlinkList = result;
        assert.equal(result.count, 1);
        assert.equal(result.matchedCount, 1);
      },
      { mutationTimeoutMs: 120_000, readbackTimeoutMs: 120_000 },
    );
    detail = await read("receipt_manager_read",
      readReceiptArgs(receiptBinding(afterUnlinkList), afterUnlinkList.listFingerprint, currentHwnd),
      (result) => assert.equal(result.values.title, receiptValues.title), "receipt-after-unlink-detail", 120_000);
    let finalList;
    await mutateAndRead(
      "receipt-delete",
      {
        ...readReceiptArgs(detail.row, detail.listFingerprint, currentHwnd),
        expectedCountBefore: 1, acknowledgeDelete: true,
      },
      (result) => {
        assert.equal(result.verified, true);
        assert.equal(result.countAfter, 0);
      },
      { hwnd: currentHwnd },
      (result) => {
        finalList = result;
        assert.equal(result.count, baseline.count);
        assert.equal(result.rowsComplete, true);
        assert.equal(result.draftCount, 0);
      },
      { mutationTimeoutMs: 180_000, readbackTimeoutMs: 120_000 },
    );
    void finalList;
    const finalManager = findWindow(await read("windows", {}),
      (entry) => String(entry.title ?? "") === "BelegManager", "BelegManager vor Abschluss");
    await mutateAndRead(
      "receipt-manager-final-close",
      {
        pid: finalManager.pid, hwnd: finalManager.hwnd,
        titleFingerprint: finalManager.titleFingerprint, waitMs: 2_000,
      },
      (result) => assert.equal(result.closed, true),
      {},
      (result) => assert(!(result.windows ?? []).some((entry) => entry.hwnd === finalManager.hwnd)),
      { mutationTimeoutMs: 120_000 },
    );
  });

  journeyEndedAt = performance.now();
  await phase("cleanup", async () => {
    await mutateAndRead(
      "close-est",
      { pid: currentPid, hwnd: currentHwnd, discardChanges: true },
      (result) => {
        assert.equal(result.stillRunning, false);
        assert.equal(result.killed, false);
      },
      {},
      (result) => {
        assert.equal(result.running, false);
        assert.deepEqual(result.windows ?? [], []);
      },
      { mutationTimeoutMs: 180_000 },
    );
    currentHwnd = 0; currentPid = 0;
    const finalInstances = await read("instances", { includeHash: true }, (result) => {
      assert.equal(result.count, 0, "Nach erfolgreichem close ist noch eine SSE-Instanz registriert.");
    }, "cleanup-final-instances");
    cleanup = {
      attempted: true,
      stateKnown: true,
      closed: finalInstances.count === 0,
      zeroOwnedProcesses: findOwnedInstances(finalInstances).length === 0,
    };
  });
  controlledRunEndedAt = performance.now();
  const coveredOperations = MEGA_OPERATION_CATALOG
    .filter((entry) => entry.classification === "covered")
    .map((entry) => entry.operation);
  const successfulOperations = new Set(operationRecords.filter((entry) => entry.ok).map((entry) => entry.operation));
  assert.deepEqual(coveredOperations.filter((operation) => !successfulOperations.has(operation)), [],
    "Jede als covered klassifizierte API-Operation muss im erfolgreichen Lauf wirklich erfolgreich ausgefuehrt werden.");
  assert.deepEqual(
    [...new Set(mutationRecords.filter((entry) => ["passed", "skipped"].includes(entry.result)).map((entry) => entry.id))].sort(),
    [...mutationDeclarations.keys()].sort(),
    "Erfolgreiche Reise muss jede deklarierte Mutation bestanden oder explizit als nicht anwendbar uebersprungen haben.",
  );
} catch (error) {
  if (!journeyEndedAt) journeyEndedAt = performance.now();
  failure = {
    phase: currentPhase,
    kind: error?.kind ?? error?.code ?? "assertion",
    message: String(error?.message ?? error)
      .replaceAll(caseDir, "<case-sandbox>")
      .replaceAll(documentsDir, "<documents-sandbox>"),
  };
  const failedPhase = currentPhase;
  currentPhase = "failure-cleanup";
  status(`failure cleanup after ${failedPhase}`);
  const failureCleanupStartedAt = performance.now();
  try {
    cleanup.attempted = true;
    const health = await call("health", {}, 30_000, "failure-cleanup-health");
    if (health.result.running) {
      const discovered = await call("instances", { includeHash: true }, 120_000, "failure-cleanup-instances");
      const owned = findOwnedInstances(discovered.result);
      if (owned.length === 1) {
        currentPid = owned[0].pid;
        currentHwnd = owned[0].hwnd;
        const state = await call("ui_state", { hwnd: currentHwnd }, 60_000, "failure-cleanup-state");
        cleanup.stateKnown = state.result.running === true && state.result.instance?.hwnd === currentHwnd;
        assert.equal(cleanup.stateKnown, true, "Entdeckte Wegwerf-Instanz ist nicht zustandsgebunden lesbar.");
        try {
          await call("close", { pid: currentPid, hwnd: currentHwnd, discardChanges: true }, 180_000,
            "failure-cleanup-close");
        } catch (closeError) {
          if (!/dialog-open/iu.test(String(closeError?.message))) throw closeError;
          const forced = await call(
            "close",
            { pid: currentPid, hwnd: currentHwnd, discardChanges: true, force: true },
            180_000,
            "failure-cleanup-force-close-unanswered-dialog",
          );
          assert.equal(forced.result.killed, true,
            "Unklassifizierter Dialog wurde nicht beantwortet; exakt gebundener Wegwerfprozess liess sich auch nicht sicher beenden.");
          cleanup.forcedTermination = true;
          cleanup.forceReason = "unclassified-dialog-was-not-answered";
        }
      } else if (owned.length === 0 && Number.isInteger(currentPid) && ownedLaunchPids.has(currentPid)) {
        const forced = await call(
          "close",
          { pid: currentPid, discardChanges: true, force: true },
          180_000,
          "failure-cleanup-force-close-owned-launch-pid",
        );
        assert.equal(forced.result.killed, true,
          "Exakt aus dem Launch gebundene Wegwerf-PID ohne Hauptfenster liess sich nicht sicher beenden.");
        cleanup.stateKnown = false;
        cleanup.processStateVerifiedOnly = true;
        cleanup.forcedTermination = true;
        cleanup.forceReason = "owned-launch-pid-without-main-instance";
      } else {
        assert.fail(
          `Laufende SSE-Instanz ist nicht eindeutig einer Wegwerfkopie zuordenbar; nichts blind geschlossen: ` +
          `${JSON.stringify((discovered.result.instances ?? []).map((instance) => ({
            pid: instance.pid, hwnd: instance.hwnd, caseName: instance.caseName,
          })))}`,
        );
      }
    }
    const finalInstances = await call("instances", { includeHash: true }, 120_000, "failure-cleanup-final-instances");
    const finalHealth = await call("health", {}, 30_000, "failure-cleanup-final-health");
    cleanup.processStateKnown = true;
    cleanup.zeroOwnedProcesses = findOwnedInstances(finalInstances.result).length === 0;
    cleanup.closed = finalHealth.result.running === false && finalInstances.result.count === 0;
    assert.equal(cleanup.closed, true, "Failure-Cleanup endete mit einer weiterhin laufenden SSE-Instanz.");
    phaseRecords.push({
      phase: "failure-cleanup", status: "passed",
      wallMs: rounded(performance.now() - failureCleanupStartedAt), afterPhase: failedPhase,
    });
  } catch (cleanupError) {
    cleanup.closed = false;
    cleanup.zeroOwnedProcesses = false;
    cleanup.error = String(cleanupError?.message ?? cleanupError)
      .replaceAll(caseDir, "<case-sandbox>")
      .replaceAll(documentsDir, "<documents-sandbox>");
    phaseRecords.push({
      phase: "failure-cleanup", status: "failed",
      wallMs: rounded(performance.now() - failureCleanupStartedAt), afterPhase: failedPhase,
    });
  }
  controlledRunEndedAt = performance.now();
} finally {
  if (!journeyEndedAt) journeyEndedAt = performance.now();
  if (!controlledRunEndedAt) controlledRunEndedAt = performance.now();
  const totalWallMs = rounded(controlledRunEndedAt - controlledRunStartedAt);
  const journeyWallMsExcludingCleanup = rounded(journeyEndedAt - controlledRunStartedAt);
  const cleanupWallMs = rounded(phaseRecords.filter((entry) => entry.phase.includes("cleanup"))
    .reduce((total, entry) => total + entry.wallMs, 0));
  const completedDeclarations = new Set(mutationRecords.filter((entry) => entry.result === "passed").map((entry) => entry.id));
  const skippedDeclarations = new Set(mutationRecords.filter((entry) => entry.result === "skipped").map((entry) => entry.id));
  const failedDeclarations = new Set(mutationRecords.filter((entry) => entry.result === "failed").map((entry) => entry.id));
  const recordedDeclarations = new Set(mutationRecords.map((entry) => entry.id));
  const unexecutedDeclarations = MEGA_MUTATION_READBACKS.filter((entry) => !recordedDeclarations.has(entry.id));
  const operationCounts = Object.fromEntries([...new Set(operationRecords.map((entry) => entry.operation))]
    .sort().map((operation) => [operation, operationRecords.filter((entry) => entry.operation === operation).length]));
  const sumTiming = (field) => rounded(operationRecords.reduce(
    (total, entry) => total + (Number.isFinite(entry[field]) ? entry[field] : 0), 0,
  ));
  const coveredOperations = MEGA_OPERATION_CATALOG
    .filter((entry) => entry.classification === "covered")
    .map((entry) => entry.operation);
  const successfulOperations = new Set(operationRecords.filter((entry) => entry.ok).map((entry) => entry.operation));
  const coveredMissing = coveredOperations.filter((operation) => !successfulOperations.has(operation));
  const catalogClassificationCounts = Object.fromEntries([...new Set(MEGA_OPERATION_CATALOG.map((entry) => entry.classification))]
    .sort().map((classification) => [classification,
      MEGA_OPERATION_CATALOG.filter((entry) => entry.classification === classification).length]));
  const foregroundLeaseCalls = operationRecords.filter((entry) => entry.resultSafety?.foregroundLeaseUsed === true);
  const report = {
    schemaVersion: 1,
    status: failure ? "failed" : "passed",
    classification: process.env.SSE_MEGA_CLASSIFICATION ?? "cold",
    safety: {
      staticEnforcement: {
        directLoopbackApiOnly: true,
        mcpImportsForbiddenByContract: true,
        directWorkerImportsForbiddenByContract: true,
      },
      runtimeEvidence: {
        loopbackBaseUrlValidated: true,
        foregroundLeaseVerifiedCallCount: foregroundLeaseCalls.length,
      },
      receiptLease: {
        ...leaseEvidence,
        scope: "ephemeral loopback API server mode shared by clients that can reach its random port; every worker call revalidates nonce, owner PID, expiry, visible same-session foreground window, and absence of the hidden-desktop marker",
        transportEvidence: {
          childClientReceivesNonce: false,
          apiServerModeSharedAcrossLocalClients: true,
          prewarmWorkersInheritServerEnvironment: true,
          nonceRemovedFromWorkerArgumentsBeforeDispatch: true,
        },
      },
      workerPrewarm: {
        requested: true,
        readyBeforeFirstCatalogOperation: initialHealthz.prewarm?.ready === true,
        status: initialHealthz.prewarm,
        configuredPoolSize: Number.parseInt(process.env.SSE_WORKER_PREWARM_POOL_SIZE ?? "2", 10),
      },
      cleanup,
    },
    environment: {
      sourceFingerprint: sourceAtStart.fingerprint,
      runtimeFingerprint: runtimeAtStart.fingerprint,
      sse: sseEnvironment,
    },
    timings: {
      setupWallMs,
      initialHealthzWallMs: healthzWallMs,
      journeyWallMsExcludingCleanup,
      cleanupWallMs,
      totalWallMs,
      apiCallWallTotalMs: sumTiming("wallMs"),
      apiEnvelopeTotalMs: sumTiming("envelopeDurationMs"),
      workerReportedTotalMs: sumTiming("workerReportedMs"),
      phases: phaseRecords,
    },
    operations: {
      count: operationRecords.length,
      distinctCount: Object.keys(operationCounts).length,
      successCount: operationRecords.filter((entry) => entry.ok).length,
      failureCount: operationRecords.filter((entry) => !entry.ok).length,
      counts: operationCounts,
      calls: operationRecords,
    },
    catalogCoverage: {
      operationCount: MEGA_OPERATION_CATALOG.length,
      classificationCounts: catalogClassificationCounts,
      coveredDeclaredCount: coveredOperations.length,
      coveredExecutedCount: coveredOperations.length - coveredMissing.length,
      coveredMissing,
    },
    mutationCoverage: {
      declared: MEGA_MUTATION_READBACKS.length,
      passed: completedDeclarations.size,
      skipped: skippedDeclarations.size,
      failed: failedDeclarations.size,
      unexecuted: unexecutedDeclarations.length,
      executions: mutationRecords.length,
      unexecutedIds: unexecutedDeclarations.map((entry) => entry.id),
      records: mutationRecords,
    },
    operationCatalog: MEGA_OPERATION_CATALOG,
    excludedDomains: MEGA_EXCLUDED_DOMAINS,
    failure,
    ...(failure ? {
      diagnosticSandboxPaths: {
        apiHarness: process.env.SSE_TEST_SANDBOX_ROOT ?? null,
        cases: caseDir,
        documents: documentsDir,
      },
    } : {}),
  };
  writeFileSync(rawReportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`API-Mega Rohbericht: status=${report.status}, wall=${totalWallMs} ms, calls=${operationRecords.length}\n`);
}

if (failure) process.exitCode = 1;
