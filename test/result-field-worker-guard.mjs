/**
 * Jedes typisierte Feld eines Ergebnisvertrags muss im echten Worker auch
 * vorkommen.
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

const phantoms = [];
let checkedFields = 0;
for (const operation of SSE_API_OPERATIONS) {
  if (API_INTERNAL_OPERATIONS.includes(operation)) continue;
  const body = blockBody(operation);
  for (const field of Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS[operation].shape)) {
    if (TRANSPORT_FIELDS.has(field)) continue;
    checkedFields += 1;
    const emitted = new RegExp(`(^|[^A-Za-z0-9_$])${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`, "m");
    if (!emitted.test(body)) phantoms.push(`${operation}.${field}`);
  }
}

assert.deepEqual(phantoms, [],
  "Diese Vertragsfelder verspricht die API, ohne dass der Worker sie je setzt:\n  " + phantoms.join("\n  "));

process.stdout.write(
  `Ergebnisvertrag gegen Worker: ${checkedFields} typisierte Felder in ` +
  `${SSE_API_OPERATIONS.length - API_INTERNAL_OPERATIONS.length} Worker-Operationen belegt\n`,
);
