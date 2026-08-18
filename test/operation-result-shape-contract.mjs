/**
 * Wertfreie Laufzeitevidenz fuer API-Ergebnisformen.
 *
 * Regenerieren (nach bewusst geaenderten Ergebnisformen):
 *   SSE_WRITE_OPERATION_SHAPE=1 npm test
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { SSE_API_RESULT_OUTPUT_SCHEMAS } from "../dist/result-contract.js";
import { UTILITY_OPERATION_RESULT_FIELDS } from "../dist/result-utility-fields.js";
import {
  OPERATION_RESULT_FIELD_PATTERN,
  OPERATION_TRACE_LABELS,
  operationTraceDirectory,
} from "./operation-trace.mjs";
import {
  isResultTypeTag,
  mergeScopeEvidence,
  samplesForResultTypeTag,
} from "./operation-result-shape-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ledgerPath = join(here, "operation-result-shape.json");
const scope = process.env.SSE_TEST_COVERAGE_SCOPE ?? "";
assert(scope === "offline" || scope === "live", "Ergebnisform-Vertrag braucht den Suite-Scope offline oder live.");
const traceDirectory = operationTraceDirectory();
assert(traceDirectory, "SSE_TEST_OPERATION_TRACE_DIR fehlt; Ergebnisformen koennen nicht belegt werden.");

const traceFiles = readdirSync(traceDirectory).filter((name) => name.endsWith(".jsonl"));
assert(traceFiles.length > 0, `Kein Operationsprotokoll in ${traceDirectory}.`);
const observed = Object.fromEntries(SSE_API_OPERATIONS.map((operation) => [operation, { profiles: [], fields: {} }]));
const sourceAuditedOperations = new Set([
  ...Object.keys(UTILITY_OPERATION_RESULT_FIELDS),
  "set_value",
  "ustva_open_section",
]);
const boundaryMetadataFields = new Set(["resourceRefs"]);
for (const name of traceFiles) {
  for (const line of readFileSync(join(traceDirectory, name), "utf8").split("\n")) {
    if (!line) continue;
    const entry = JSON.parse(line);
    assert(OPERATION_TRACE_LABELS.includes(entry.label), `${name}: unbekannte Trace-Marke '${entry.label}'.`);
    assert(SSE_API_OPERATIONS.includes(entry.operation), `${name}: unbekannte Operation '${entry.operation}'.`);
    assert(entry.fields && typeof entry.fields === "object" && !Array.isArray(entry.fields), `${name}: fields fehlt.`);
    const target = observed[entry.operation];
    if (typeof entry.profileId === "string" && entry.profileId) target.profiles.push(entry.profileId);
    for (const [field, tag] of Object.entries(entry.fields)) {
      assert(OPERATION_RESULT_FIELD_PATTERN.test(field), `${entry.operation}: unsicherer Feldname '${field}'.`);
      assert(isResultTypeTag(tag), `${entry.operation}.${field}: unbekannter Typ '${tag}'.`);
      if (sourceAuditedOperations.has(entry.operation) && !boundaryMetadataFields.has(field)) {
        assert(Object.hasOwn(SSE_API_RESULT_OUTPUT_SCHEMAS[entry.operation].shape, field),
          `${entry.operation}.${field}: Mock-/Executorfeld fehlt im quellenauditierten Ergebnisvertrag.`);
      }
      const evidence = target.fields[field] ?? { types: [], labels: [], outcomes: [] };
      evidence.types.push(tag);
      evidence.labels.push(entry.label);
      evidence.outcomes.push(entry.ok === true ? "success" : "error");
      target.fields[field] = evidence;
    }
  }
}
for (const operation of SSE_API_OPERATIONS) observed[operation] = mergeScopeEvidence({}, observed[operation]);

let ledger;
const writeRequested = process.env.SSE_WRITE_OPERATION_SHAPE === "1";
if (writeRequested) {
  const previous = readLedgerOrEmpty();
  const operations = {};
  for (const operation of SSE_API_OPERATIONS) {
    const carried = previous.operations?.[operation] ?? {};
    operations[operation] = scope === "offline"
      ? { offline: observed[operation], live: carried.live ?? { profiles: [], fields: {} } }
      : { offline: carried.offline ?? { profiles: [], fields: {} }, live: mergeScopeEvidence(carried.live, observed[operation]) };
  }
  ledger = {
    schemaVersion: 1,
    hinweis: "Nur Feldnamen und JSON-Typen aus echter Testausfuehrung; niemals Werte von Hand eintragen.",
    operations,
  };
} else {
  ledger = readLedgerOrEmpty();
}

assert.equal(ledger.schemaVersion, 1, "Unbekannte Schemaversion der Ergebnisform-Bilanz.");
assert.deepEqual(Object.keys(ledger.operations ?? {}).sort(), [...SSE_API_OPERATIONS].sort(),
  "Ergebnisform-Bilanz muss genau den API-Katalog fuehren.");

const upgrades = [];
const downgrades = [];
for (const operation of SSE_API_OPERATIONS) {
  validateScope(operation, "offline", ledger.operations[operation].offline);
  validateScope(operation, "live", ledger.operations[operation].live);
  const claimed = ledger.operations[operation][scope];
  for (const profile of observed[operation].profiles) {
    if (!claimed.profiles.includes(profile)) upgrades.push(`${operation}: profiles += ${profile}`);
  }
  for (const [field, evidence] of Object.entries(observed[operation].fields)) {
    const known = claimed.fields[field];
    if (!known) {
      upgrades.push(`${operation}.${field}: neues Feld`);
      continue;
    }
    for (const dimension of ["types", "labels", "outcomes"]) {
      for (const value of evidence[dimension]) {
        if (!known[dimension].includes(value)) upgrades.push(`${operation}.${field}: ${dimension} += ${value}`);
      }
    }
  }
  if (scope === "offline") {
    for (const profile of claimed.profiles) {
      if (!observed[operation].profiles.includes(profile)) downgrades.push(`${operation}: profile ${profile} fehlt`);
    }
    for (const [field, evidence] of Object.entries(claimed.fields)) {
      const current = observed[operation].fields[field];
      if (!current) {
        downgrades.push(`${operation}.${field}: Feld fehlt`);
        continue;
      }
      for (const dimension of ["types", "labels", "outcomes"]) {
        for (const value of evidence[dimension]) {
          if (!current[dimension].includes(value)) downgrades.push(`${operation}.${field}: ${dimension} -= ${value}`);
        }
      }
    }
  }
}
assert.deepEqual(upgrades, [],
  `Ergebnisformen (${scope}) sind gewachsen. Mit SSE_WRITE_OPERATION_SHAPE=1 bewusst uebernehmen:\n  ${upgrades.join("\n  ")}`);
assert.deepEqual(downgrades, [],
  `Ergebnisformen (${scope}) sind geschrumpft. Ursache pruefen oder Bilanz bewusst neu erzeugen:\n  ${downgrades.join("\n  ")}`);

let fields = 0;
let observations = 0;
let mockOnlyFields = 0;
for (const operation of SSE_API_OPERATIONS) {
  for (const ledgerScope of ["offline", "live"]) {
    for (const [field, evidence] of Object.entries(ledger.operations[operation][ledgerScope].fields)) {
      fields += 1;
      if (evidence.labels.length > 0 && evidence.labels.every((label) => label.endsWith("mock"))) mockOnlyFields += 1;
      for (const tag of evidence.types) {
        observations += 1;
        const samples = samplesForResultTypeTag(tag);
        assert(samples.length > 0, `${operation}.${field}: nicht pruefbarer Ergebnis-Typ '${tag}'.`);
        assert(samples.some((sample) =>
          SSE_API_RESULT_OUTPUT_SCHEMAS[operation].safeParse({ ok: true, [field]: sample }).success),
        `${operation}.${field}: veroeffentlichtes Schema akzeptiert beobachteten Typ '${tag}' nicht.`);
      }
    }
  }
}
if (writeRequested) {
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  process.stdout.write(`Ergebnisform-Bilanz (${scope}) neu geschrieben: ${ledgerPath}\n`);
}
process.stdout.write(
  `Ergebnisform-Bilanz ${scope}: ${fields} Feld-Scope-Belege, ${observations} Typbeobachtungen akzeptiert, ` +
  `${mockOnlyFields} nur durch Mock-Harnische belegt\n`,
);

function validateScope(operation, ledgerScope, value) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${operation}.${ledgerScope} fehlt.`);
  assert(Array.isArray(value.profiles), `${operation}.${ledgerScope}.profiles muss eine Liste sein.`);
  assert(value.fields && typeof value.fields === "object" && !Array.isArray(value.fields),
    `${operation}.${ledgerScope}.fields muss ein Objekt sein.`);
  for (const [field, evidence] of Object.entries(value.fields)) {
    assert(OPERATION_RESULT_FIELD_PATTERN.test(field), `${operation}.${ledgerScope}: unsicherer Feldname '${field}'.`);
    assert.deepEqual([...evidence.types].sort(), evidence.types, `${operation}.${field}.types ist nicht sortiert.`);
    assert.deepEqual([...evidence.labels].sort(), evidence.labels, `${operation}.${field}.labels ist nicht sortiert.`);
    assert.deepEqual([...evidence.outcomes].sort(), evidence.outcomes, `${operation}.${field}.outcomes ist nicht sortiert.`);
    assert(evidence.types.every((tag) => isResultTypeTag(tag)), `${operation}.${field}: unbekannter Typ.`);
    assert(evidence.labels.every((label) => OPERATION_TRACE_LABELS.includes(label)), `${operation}.${field}: unbekannte Marke.`);
    assert(evidence.outcomes.every((outcome) => ["error", "success"].includes(outcome)), `${operation}.${field}: unbekannter Ausgang.`);
  }
}

function readLedgerOrEmpty() {
  try {
    return JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && process.env.SSE_WRITE_OPERATION_SHAPE === "1") return {};
    throw error;
  }
}
