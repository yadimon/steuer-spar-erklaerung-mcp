/**
 * Jedes typisierte Feld eines Ergebnisvertrags muss im echten Worker oder im
 * explizit benannten lokalen API-Executor vorkommen.
 *
 * Hintergrund: `Result_backup_cases` versprach eine Liste `files`, waehrend der
 * Worker dort eine Anzahl lieferte. Weil kein Test die Operation je wirklich
 * ausfuehrte, endete jeder echte Aufruf still mit HTTP 502. Ein erfundenes
 * Vertragsfeld ist ausserdem eine falsche Zusage an jeden Agenten, der
 * Discovery, OpenAPI oder das MCP-outputSchema liest.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { SSE_API_RESULT_OUTPUT_SCHEMAS } from "../dist/result-contract.js";

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, "..", "powershell", "sse-worker.ps1");
const lines = readFileSync(workerPath, "utf8").split("\n");
const localExecutors = new Map([
  ["backup_cases", readFileSync(join(here, "..", "src", "backup-executor.ts"), "utf8")],
  ["archive_cases", readFileSync(join(here, "..", "src", "archive-executor.ts"), "utf8")],
]);

/** Transportfelder, die jeder Vertrag traegt und die der Worker generisch setzt. */
const TRANSPORT_FIELDS = new Set(["ok", "kind", "error", "ms"]);

/**
 * Operationen, die die API selbst beantwortet. Sie erreichen den PowerShell-
 * Worker nie; ihre Felder werden von den TypeScript-Executoren erzeugt.
 */
const API_INTERNAL_OPERATIONS = [
  "capabilities",
  "checker_open",
  "scenario_run",
  "ustva_change_value",
  "ustva_open_section",
  "ustva_read",
  "ustva_select_period",
  "ustva_set_flag",
  "workspace_file_list",
  "workspace_file_read_text",
  "workspace_file_write_text",
  "workspace_status",
];

/** API-lokale Zusatzfelder dual implementierter Operationen. */
const API_LOCAL_RESULT_FIELDS = new Map([
  ["backup_cases", new Set(["copiedBeforeFailure", "rolledBack", "retainedTargets", "backupStillExists"])],
  ["archive_cases", new Set(["recoveryFiles", "retainedTargets"])],
]);

const blockStart = new Map();
for (const [index, line] of lines.entries()) {
  const match = /^ {2}'([a-z_]+)' \{/.exec(line);
  if (match) blockStart.set(match[1], index);
}
const ordered = [...blockStart.entries()].sort((left, right) => left[1] - right[1]);
const blockBody = (operation) => {
  const start = blockStart.get(operation);
  const next = ordered.find(([, index]) => index > start)?.[1] ?? lines.length;
  return lines.slice(start, next).join("\n");
};

/**
 * Liest nur Properties der an Emit uebergebenen aeusseren PSCustomObjects.
 * Eine Regex ueber den ganzen Block akzeptiert sonst ein Vertragsfeld schon
 * dann, wenn es nur in `binding`, `rollback` oder einem anderen Unterobjekt
 * vorkommt.
 */
function emittedResultFields(body) {
  const fields = new Set();
  for (const result of emittedResultObjects(body)) {
    for (const field of result.fields) fields.add(field);
  }
  return fields;
}

/** Liest Quelltext und Top-Level-Felder aller direkt emittierten Resultate. */
function emittedResultObjects(body) {
  const results = [];
  const marker = "Emit ([pscustomobject]@{";
  for (let markerAt = body.indexOf(marker); markerAt >= 0; markerAt = body.indexOf(marker, markerAt + marker.length)) {
    const openingBrace = markerAt + marker.length - 1;
    results.push(readOuterPowerShellObject(body, openingBrace));
  }
  for (const emittedVariable of body.matchAll(/\bEmit \$([A-Za-z_][A-Za-z0-9_]*)\s*$/gmu)) {
    const assignment = new RegExp(`\\$${emittedVariable[1]}\\s*=\\s*\\[pscustomobject\\]@\\{`, "u").exec(body);
    if (!assignment) throw new Error(`Emit-Variable '$${emittedVariable[1]}' hat kein lokales PSCustomObject.`);
    const openingBrace = assignment.index + assignment[0].length - 1;
    results.push(readOuterPowerShellObject(body, openingBrace));
  }
  return results;
}

function readOuterPowerShellObject(source, openingBrace) {
  const fields = new Set();
  let depth = 0;
  let quote = "";
  let lineComment = false;
  for (let index = openingBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? "";
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (quote) {
      if (quote === "'" && char === "'" && next === "'") {
        index += 1;
      } else if (quote === '"' && char === "`") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "#") {
      lineComment = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { fields, source: source.slice(openingBrace, index + 1) };
      }
      continue;
    }
    if (depth !== 1 || !/[A-Za-z]/u.test(char)) continue;
    const match = /^[A-Za-z][A-Za-z0-9_]*/u.exec(source.slice(index));
    if (!match) continue;
    const before = source[index - 1] ?? "";
    const after = source.slice(index + match[0].length);
    if (before !== "$" && /^\s*=/u.test(after)) fields.add(match[0]);
    index += match[0].length - 1;
  }
  throw new Error("Unvollstaendiges Emit-PSCustomObject im Worker-Ergebnisvertrag.");
}

assert.deepEqual(
  [...emittedResultFields("Emit ([pscustomobject]@{ ok=$true; binding=[pscustomobject]@{ rid=$rid; grund='x' } })")].sort(),
  ["binding", "ok"],
  "Verschachtelte Guard-Felder duerfen nicht als Top-Level-Vertragsbeleg gelten.",
);
assert.deepEqual(
  [...emittedResultFields("$result = [pscustomobject]@{ ok=$true; value=$value }\nEmit $result")].sort(),
  ["ok", "value"],
  "Explizit aufgebaute und anschliessend emittierte Ergebnisobjekte muessen belegt bleiben.",
);

const missingInWorker = SSE_API_OPERATIONS.filter(
  (operation) => !blockStart.has(operation) && !API_INTERNAL_OPERATIONS.includes(operation),
);
assert.deepEqual(missingInWorker, [],
  `Diese Operationen fehlen im Worker und sind nicht als API-intern gefuehrt: ${missingInWorker.join(", ")}`);

const wronglyInternal = API_INTERNAL_OPERATIONS.filter((operation) => blockStart.has(operation));
assert.deepEqual(wronglyInternal, [],
  `Diese Operationen sind als API-intern gefuehrt, existieren aber im Worker: ${wronglyInternal.join(", ")}`);

const unknownInternal = API_INTERNAL_OPERATIONS.filter((operation) => !SSE_API_OPERATIONS.includes(operation));
assert.deepEqual(unknownInternal, [], `Unbekannte Operation in der API-internen Liste: ${unknownInternal.join(", ")}`);

const dynamicEnvelopeViolations = [];
for (const operation of SSE_API_OPERATIONS) {
  if (API_INTERNAL_OPERATIONS.includes(operation)) continue;
  for (const result of emittedResultObjects(blockBody(operation))) {
    const okAssignment = /(?:^|[;{\r\n])\s*ok\s*=\s*([^;\r\n}]+)/u.exec(result.source);
    if (!okAssignment || /^\$(?:true|false)\b/iu.test(okAssignment[1].trim())) continue;
    const missing = ["kind", "error"].filter((field) => !result.fields.has(field));
    if (missing.length) dynamicEnvelopeViolations.push(`${operation}: ${missing.join(", ")}`);
  }
}
assert.deepEqual(dynamicEnvelopeViolations, [],
  "Berechnetes Worker-ok kann false werden, ohne einen vollstaendigen Fehlerumschlag zu liefern:\n  " +
  dynamicEnvelopeViolations.join("\n  "));

/**
 * Listenfelder duerfen nicht aus einem `$(...)`-Unterausdruck kommen.
 *
 * Hintergrund: `collect` baute `seiten=$(if ($ziel) { $null } else { @($seiten) })`.
 * PowerShell gibt aus einem Unterausdruck genau ein Element als Objekt statt
 * als Liste zurueck, also scheiterte jedes Einseitensegment am Ergebnisvertrag.
 * `@(...)` oder eine vorher gefuellte Variable haelt die Liste eine Liste.
 */
function istListenSchema(schema) {
  let current = schema;
  for (let tiefe = 0; tiefe < 6 && current?._def; tiefe += 1) {
    const typ = current._def.typeName;
    if (typ === "ZodArray") return true;
    if (typ !== "ZodOptional" && typ !== "ZodNullable" && typ !== "ZodDefault") return false;
    current = current._def.innerType;
  }
  return false;
}

const unterausdruckFeld = (field) =>
  new RegExp(`(^|[^A-Za-z0-9_$])${field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*=\\s*\\$\\(`, "u");

assert(unterausdruckFeld("seiten").test("Emit ([pscustomobject]@{ seiten=$(if ($z) { $null } else { @($s) }) })"),
  "Der Listenwaechter muss die historische collect-Form erkennen.");
assert(!unterausdruckFeld("seiten").test("Emit ([pscustomobject]@{ seiten=@($s) })"),
  "Ein echtes Array-Literal darf der Listenwaechter nicht melden.");

const unwrappedLists = [];
let checkedLists = 0;
for (const operation of SSE_API_OPERATIONS) {
  if (API_INTERNAL_OPERATIONS.includes(operation)) continue;
  const listFields = Object.entries(SSE_API_RESULT_OUTPUT_SCHEMAS[operation].shape)
    .filter(([field, schema]) => !TRANSPORT_FIELDS.has(field) && istListenSchema(schema))
    .map(([field]) => field);
  if (listFields.length === 0) continue;
  for (const result of emittedResultObjects(blockBody(operation))) {
    for (const field of listFields) {
      checkedLists += 1;
      if (unterausdruckFeld(field).test(result.source)) unwrappedLists.push(`${operation}.${field}`);
    }
  }
}
assert(checkedLists > 0, "Der Listenwaechter hat kein einziges Listenfeld gesehen.");
assert.deepEqual(unwrappedLists, [],
  "Diese Listenfelder kommen aus einem $(...)-Unterausdruck und werden bei genau einem Element zum Objekt:\n  " +
  unwrappedLists.join("\n  "));

const phantoms = [];
let checkedFields = 0;
for (const operation of SSE_API_OPERATIONS) {
  if (API_INTERNAL_OPERATIONS.includes(operation)) continue;
  const body = blockBody(operation);
  const emittedFields = emittedResultFields(body);
  for (const field of Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS[operation].shape)) {
    if (TRANSPORT_FIELDS.has(field)) continue;
    checkedFields += 1;
    const localField = API_LOCAL_RESULT_FIELDS.get(operation)?.has(field) === true;
    const assignedLocally = new RegExp(`(^|[^A-Za-z0-9_$])${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`, "m");
    const emittedLocally = new RegExp(`(^|[^A-Za-z0-9_$])${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m");
    const localExecutor = localExecutors.get(operation) ?? "";
    if (localField ? !(assignedLocally.test(localExecutor) || emittedLocally.test(localExecutor)) : !emittedFields.has(field)) {
      phantoms.push(`${operation}.${field}`);
    }
  }
}

assert.deepEqual(phantoms, [],
  "Diese Vertragsfelder verspricht die API, ohne dass Worker oder lokaler Executor sie setzen:\n  " +
  phantoms.join("\n  "));

process.stdout.write(
  `Ergebnisvertrag gegen Worker: ${checkedFields} typisierte Felder in ` +
  `${SSE_API_OPERATIONS.length - API_INTERNAL_OPERATIONS.length} Worker-Operationen belegt\n`,
);
