/**
 * Abdeckungsbilanz aus echter Ausfuehrung.
 *
 * Der Katalog `test/operation-coverage.json` behauptet fuer jede der
 * veroeffentlichten API-Operationen, ob sie in einem Suitelauf tatsaechlich
 * erfolgreich ausgefuehrt wird. Dieser Vertrag vergleicht die Behauptung mit
 * dem Laufzeitprotokoll aus `operation-trace.mjs`.
 *
 * Die Bilanz ist eine Ratsche in beide Richtungen:
 * - Verschwundene Abdeckung ist eine Regression.
 * - Neu entstandene Abdeckung muss bewusst in den Katalog uebernommen werden.
 *
 * Regenerieren (nach bewusster Erweiterung der Tests):
 *   SSE_WRITE_OPERATION_COVERAGE=1 npm test
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { OPERATION_TRACE_LABELS, operationTraceDirectory } from "./operation-trace.mjs";
import { COVERAGE_RANK, mergeCoverageLabels, retainHighestCoverageStatus } from "./operation-coverage-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ledgerPath = join(here, "operation-coverage.json");
const scope = process.env.SSE_TEST_COVERAGE_SCOPE ?? "";
const CURRENT_GATE_EVIDENCE = "current-gate";
const SNAPSHOT_VM_EVIDENCE = "snapshot-vm";
assert(
  scope === "offline" || scope === "live",
  "SSE_TEST_COVERAGE_SCOPE muss 'offline' oder 'live' sein; der Vertrag laeuft nur aus einem Suiterunner.",
);

const traceDirectory = operationTraceDirectory();
assert(traceDirectory, "SSE_TEST_OPERATION_TRACE_DIR fehlt; ohne Laufzeitprotokoll ist die Bilanz wertlos.");

const traceFiles = readdirSync(traceDirectory).filter((name) => name.endsWith(".jsonl"));
assert(traceFiles.length > 0, `Kein Operationsprotokoll in ${traceDirectory}; kein Harnisch war instrumentiert.`);

/** operation -> { ok: Set<label>, seen: Set<label>, calls, totalMs, slowestMs } */
const observed = new Map();
let recordCount = 0;
for (const name of traceFiles) {
  const raw = readFileSync(join(traceDirectory, name), "utf8");
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const entry = JSON.parse(line);
    assert(
      OPERATION_TRACE_LABELS.includes(entry.label),
      `Protokollzeile in '${name}' nennt eine unbekannte Marke: ${entry.label}`,
    );
    assert(
      SSE_API_OPERATIONS.includes(entry.operation),
      `Protokollzeile in '${name}' nennt eine unbekannte Operation: ${entry.operation}`,
    );
    recordCount += 1;
    const state = observed.get(entry.operation) ??
      { ok: new Set(), seen: new Set(), calls: 0, totalMs: 0, slowestMs: 0 };
    state.seen.add(entry.label);
    if (entry.ok === true) state.ok.add(entry.label);
    state.calls += 1;
    state.totalMs += Number(entry.ms ?? 0);
    state.slowestMs = Math.max(state.slowestMs, Number(entry.ms ?? 0));
    observed.set(entry.operation, state);
  }
}

const observedStatus = (operation) => {
  const state = observed.get(operation);
  if (!state) return "untested";
  return state.ok.size > 0 ? "functional" : "error-path-only";
};
const observedLabels = (operation) => [...(observed.get(operation)?.ok ?? [])].sort();

if (process.env.SSE_WRITE_OPERATION_COVERAGE === "1") {
  const previous = readLedgerOrEmpty();
  const operations = {};
  for (const operation of SSE_API_OPERATIONS) {
    const carried = previous.operations?.[operation] ?? {};
    const liveEvidence = carried.liveEvidence ?? CURRENT_GATE_EVIDENCE;
    operations[operation] = scope === "offline"
      ? {
        offline: retainHighestCoverageStatus(carried.offline, observedStatus(operation)),
        offlineLabels: mergeCoverageLabels(carried.offlineLabels, observedLabels(operation)),
        live: carried.live ?? "untested",
        ...(carried.liveEvidence ? { liveEvidence: carried.liveEvidence } : {}),
      }
      : {
        offline: carried.offline ?? "untested",
        offlineLabels: carried.offlineLabels ?? [],
        live: liveEvidence === SNAPSHOT_VM_EVIDENCE
          ? carried.live ?? "untested"
          : retainHighestCoverageStatus(carried.live, observedStatus(operation)),
        ...(carried.liveEvidence ? { liveEvidence: carried.liveEvidence } : {}),
      };
  }
  writeFileSync(
    ledgerPath,
    `${JSON.stringify({
      schemaVersion: 1,
      hinweis: "Erzeugt aus echter Testausfuehrung. Nicht von Hand hochstufen - erst Test schreiben, dann regenerieren.",
      operations,
    }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`Abdeckungsbilanz (${scope}) neu geschrieben: ${ledgerPath}\n`);
  process.exit(0);
}

const ledger = readLedgerOrEmpty();
assert.equal(ledger.schemaVersion, 1, "Unbekannte Schemaversion der Abdeckungsbilanz.");
assert.deepEqual(
  Object.keys(ledger.operations ?? {}).sort(),
  [...SSE_API_OPERATIONS].sort(),
  "Die Abdeckungsbilanz muss genau die veroeffentlichten Operationen fuehren.",
);
for (const operation of SSE_API_OPERATIONS) {
  const entry = ledger.operations[operation];
  assert.deepEqual(
    Object.keys(entry).filter((key) => !["offline", "offlineLabels", "live", "liveEvidence"].includes(key)),
    [],
    `${operation}: unbekanntes Coverage-Metadatum.`,
  );
  const liveEvidence = entry.liveEvidence ?? CURRENT_GATE_EVIDENCE;
  assert(
    [CURRENT_GATE_EVIDENCE, SNAPSHOT_VM_EVIDENCE].includes(liveEvidence),
    `${operation}: unbekannte Live-Evidenzquelle '${liveEvidence}'.`,
  );
  if (liveEvidence === SNAPSHOT_VM_EVIDENCE) {
    assert.notEqual(entry.live, "untested",
      `${operation}: ein externer Snapshot-Nachweis muss mindestens einen echten Live-Fehlerpfad belegen.`);
  }
}

const regressions = [];
const upgrades = [];
for (const operation of SSE_API_OPERATIONS) {
  const entry = ledger.operations[operation];
  const claimed = entry[scope];
  assert(
    ["functional", "error-path-only", "untested"].includes(claimed),
    `Unbekannter Abdeckungsstatus '${claimed}' fuer '${operation}'.`,
  );
  const actual = observedStatus(operation);
  // Benutzerbezogene Desktopdaten und ELSTER-Voraussetzungen lassen sich auf
  // dem Host nicht deterministisch pruefen, ohne fremde Daten anzufassen.
  // Diese eng begrenzten Operationen werden in der sauberen Snapshot-VM
  // ausgefuehrt und gehoeren deshalb nicht zur Host-Trace-Ratsche.
  if (scope === "live" && entry.liveEvidence === SNAPSHOT_VM_EVIDENCE) continue;
  if (actual === claimed) continue;
  if (COVERAGE_RANK[actual] < COVERAGE_RANK[claimed]) regressions.push(`${operation}: erwartet ${claimed}, beobachtet ${actual}`);
  else upgrades.push(`${operation}: beobachtet ${actual}, Bilanz sagt ${claimed}`);
}

assert.deepEqual(
  regressions,
  [],
  `Abdeckung (${scope}) ist gesunken. Test reparieren statt Bilanz absenken:\n  ${regressions.join("\n  ")}`,
);
assert.deepEqual(
  upgrades,
  [],
  `Abdeckung (${scope}) ist gewachsen. Mit SSE_WRITE_OPERATION_COVERAGE=1 bewusst uebernehmen:\n  ${upgrades.join("\n  ")}`,
);

const functional = SSE_API_OPERATIONS.filter((operation) => ledger.operations[operation][scope] === "functional");
const errorOnly = SSE_API_OPERATIONS.filter((operation) => ledger.operations[operation][scope] === "error-path-only");
const external = scope === "live"
  ? functional.filter((operation) => ledger.operations[operation].liveEvidence === SNAPSHOT_VM_EVIDENCE)
  : [];
process.stdout.write(
  `Abdeckungsbilanz ${scope}: ${functional.length}/${SSE_API_OPERATIONS.length} Operationen erfolgreich ausgefuehrt, ` +
  `${errorOnly.length} nur auf Fehlerpfaden, ${recordCount} protokollierte Aufrufe` +
  (external.length ? `; ${external.length} Live-Nachweise stammen aus dem getrennten Snapshot-VM-Gate` : "") + "\n",
);

// Laufzeitbild statt Bauchgefuehl: Es wird berichtet, nie behauptet. Ein
// Schwellwert waere hier unvermeidlich flaky und wuerde echte Tests
// unbrauchbar machen.
const slowest = [...observed.entries()]
  .map(([operation, state]) => ({ operation, ...state }))
  .sort((left, right) => right.totalMs - left.totalMs)
  .slice(0, 10);
if (slowest.length) {
  process.stdout.write("Teuerste Operationen (Summe der Wanduhrzeit ueber alle Aufrufe):\n");
  for (const entry of slowest) {
    process.stdout.write(
      `  ${entry.operation.padEnd(24)} ${String(entry.calls).padStart(4)} Aufrufe  ` +
      `${String(entry.totalMs).padStart(7)} ms gesamt  ${String(entry.slowestMs).padStart(6)} ms langsamster\n`,
    );
  }
}

function readLedgerOrEmpty() {
  try {
    return JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && process.env.SSE_WRITE_OPERATION_COVERAGE === "1") return {};
    throw error;
  }
}
