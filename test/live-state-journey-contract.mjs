/** Offline regression of the actual live journey's catalog and viewport contract. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { assertStateMutation, assertStateRowsUnchanged, stateJourneyDestination,
  stateJourneyInventory, stateJourneyVisibility } from "./state-journey-contract.mjs";

const catalog = { pages: {
  "gew_erfass.einnahmen_ausgaben": { heading: "Gewinnermittlung", documentType: "GewErfass2026" },
  "gew.umsatzsteuer_jahreserklaerung": { heading: "Annual return", documentType: "Gew2025" },
} };
const destination = { pageId: "gew.umsatzsteuer_jahreserklaerung", heading: "Annual return", documentType: "Gew2025" };
assert.deepEqual(stateJourneyDestination(catalog, "copy.Gew2025", "Table"), destination);
assert.deepEqual(stateJourneyDestination({ pages: Object.fromEntries(Object.entries(catalog.pages).reverse()) },
  "copy.Gew2025", "Table"), destination, "Catalog insertion order must not choose a foreign document page.");
assert.throws(() => stateJourneyDestination(catalog, "copy.Gew2024", "Table"), /exactly one compatible/u);
assert.throws(() => stateJourneyDestination(catalog, "copy.Gew2025", "Annual return"), /exactly one compatible/u);
assert.throws(() => stateJourneyDestination({ pages: { ...catalog.pages,
  "other.umsatzsteuer_jahreserklaerung": catalog.pages[destination.pageId] } }, "copy.Gew2025", "Table"),
/exactly one compatible/u);

const headers = ["Nr.", "Bezeichnung", "Betrag", "Netto"];
const fullTable = (rows) => ({ vollstaendig: true, kopf: headers, zeilen: rows, summe: "33,33",
  rowDetails: rows.map((row, rowIndex) => ({ rowIndex, typedValues: [...row],
    cellTypes: row.map(() => "text"), checkboxStates: row.map(() => null) })) });
const model = fullTable([["", "Row one", "11,11", "11,11"], ["", "Row two", "22,22", "22,22"]]);
const visible = { incomplete: false, headers, rows: [model.zeilen[0]], rowCount: 1 };
assert.deepEqual(stateJourneyVisibility(model, visible, ["11,11", "22,22"], "Betrag", "viewport"),
  { visible: ["11,11"], offscreen: ["22,22"] });
assert.throws(() => stateJourneyVisibility(fullTable([model.zeilen[0]]), visible,
  ["11,11", "22,22"], "Betrag", "lost offscreen row"), /exactly one complete-model/u);
assert.throws(() => stateJourneyVisibility(model, { ...visible, incomplete: true },
  ["11,11", "22,22"], "Betrag", "truncated"), /truncated/u);
const inventory = stateJourneyInventory(model, "model");
for (const altered of [
  { ...inventory, rows: structuredClone(inventory.rows).reverse() },
  { ...inventory, rows: [structuredClone(inventory.rows[0]), structuredClone(inventory.rows[1])] },
]) {
  altered.rows[0].typedValues[1] = "Unexpected change";
  assert.throws(() => assertStateRowsUnchanged(inventory, altered, "navigation"), /order or types changed/u);
}
const changed = stateJourneyInventory(fullTable([["", "Row one", "44,44", "44,44"], model.zeilen[1]]), "updated");
assert.doesNotThrow(() => assertStateMutation(inventory, changed,
  { kind: "update", before: "11,11", value: "44,44" }, "Betrag", "update"));
changed.rows[1].cellTypes[1] = "unknown";
assert.throws(() => assertStateMutation(inventory, changed,
  { kind: "update", before: "11,11", value: "44,44" }, "Betrag", "update"), /another value, row order or cell type/u);

// Run the actual optional journey with a recording transport, never a GUI or
// worker. The deliberately small viewport makes several required model rows
// unavailable to geometric find, including the row later deleted.
const sandbox = mkdtempSync(join(tmpdir(), "sse-state-viewport-contract-"));
const originalPath = resolve("test/live-state-journey.mjs");
const originalSource = readFileSync(originalPath, "utf8");
const saved = new Map(["SSE_PROFILE_ID", "SSE_STATE_FIXTURE", "SSE_TEST_CASE_DIR"]
  .map(key => [key, process.env[key]]));
try {
  const fixture = join(sandbox, "synthetic.Gew2025");
  writeFileSync(fixture, "synthetic transport fixture", { flag: "wx" });
  Object.assign(process.env, { SSE_PROFILE_ID: "2025", SSE_STATE_FIXTURE: fixture, SSE_TEST_CASE_DIR: sandbox });
  const transportPath = join(sandbox, "recording-transport.mjs");
  writeFileSync(transportPath, `
import assert from "node:assert/strict";
export const calls = [];
let rows, mode, page, navigatedAway;
const headers = ["Nr.", "Bezeichnung", "Betrag", "Netto"];
const tableHeading = "Beiträge, Gebühren und Abgaben";
const returnHeading = "Umsatzsteuererklärung 2025";
export function configure(value) {
  calls.length = 0; mode = value; page = tableHeading; navigatedAway = false;
  rows = [["1", "Original record", "10,00", "10,00"]];
}
const cents = value => Math.round(Number(value.replace(",", ".")) * 100);
const euros = value => (value / 100).toFixed(2).replace(".", ",");
const total = () => euros(rows.reduce((sum, row) => sum + cents(row[2]), 0));
const visibleRows = () => rows.slice(0, 3);
const result = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
export class Client {
  async connect() { calls.push({ name: "connect" }); }
  async close() { calls.push({ name: "client-close" }); }
  async callTool(request) {
    calls.push(structuredClone(request));
    const args = request.arguments;
    switch (request.name) {
      case "sse_launch": return result({ pid: 27182, instance: { pid: 27182, hwnd: 31415 } });
      case "sse_page": return result({ ueberschrift: page });
      case "sse_table_read": {
        assert.equal(args.noKeys, false, "State journey must explicitly request its guarded cursor path, including native configuration.");
        let observed = structuredClone(rows);
        if (mode === "changed-after-navigation" && navigatedAway && page === tableHeading) observed[0][1] += " changed";
        if (mode === "lost-offscreen-row" && navigatedAway && page === tableHeading) observed.pop();
        return result({ vollstaendig: mode !== "cursor-unavailable", stopKind: mode,
          kopf: headers, zeilen: observed, summe: total(), rowDetails: observed.map((row, rowIndex) => ({
            rowIndex, typedValues: row, cellTypes: row.map(() => "text"), checkboxStates: row.map(() => null)
          })) });
      }
      case "sse_read_table": return result({ incomplete: false, headers,
        rows: visibleRows(), rowCount: visibleRows().length });
      case "sse_find": {
        assert(visibleRows().some(row => row[2] === args.name), "Journey requested an offscreen geometric marker.");
        const hits = mode === "missing-visible-marker" ? [] : [{ name: args.name, rid: "synthetic", x: 100 }];
        return result({ incomplete: false, count: hits.length, hits });
      }
      case "sse_table_add": {
        assert.equal(args.expectedBefore, total());
        rows.push(["", args.werte[1], args.werte[2], args.werte[2]]);
        assert.equal(args.expectedAfter, total());
        return result({ verified: true, sumAfter: total() });
      }
      case "sse_table_update": {
        assert.equal(args.expectedBefore, total());
        assert.equal(args.targetRid, undefined, "Offscreen mutation must bind its unique model text.");
        const targets = rows.filter(row => row[1] === args.text);
        assert.equal(targets.length, 1);
        targets[0][2] = args.werte[2]; targets[0][3] = args.werte[2];
        assert.equal(args.expectedAfter, total());
        return result({ verified: true });
      }
      case "sse_table_delete": {
        assert.equal(args.expectedBefore, total());
        assert.equal(args.targetRid, undefined);
        const targets = rows.flatMap((row, index) => row[1] === args.text ? [index] : []);
        assert.equal(targets.length, 1);
        rows.splice(targets[0], 1);
        assert.equal(args.expectedAfter, total());
        return result({ verified: true, geloescht: true, target: args.text, nochVorhanden: false });
      }
      case "sse_goto": {
        if (args.pageId) {
          assert.equal(args.pageId, "gew.umsatzsteuer_jahreserklaerung");
          page = returnHeading; navigatedAway = true;
        } else {
          assert.equal(args.name, tableHeading, "Journey selected a foreign document page.");
          page = tableHeading;
        }
        return result({ heading: page });
      }
      case "sse_result_details": return result({ vollstaendig: true, zeilen: [["Summary"]] });
      case "sse_help": return result({ text: "Help" });
      case "sse_ui_state": return result({ ungespeichert: true, dialoge: [] });
      case "sse_close": return result({ stillRunning: false });
      default: throw new Error("Unexpected journey operation " + request.name);
    }
  }
}
export class StdioClientTransport { constructor(options) { this.options = options; } }
`, { flag: "wx" });
  const sdk = await import(pathToFileURL(transportPath).href);
  const adapted = originalSource.replace(/from (["'])([^"']+)\1/gu, (whole, quote, specifier) => {
    if (specifier.startsWith("node:")) return whole;
    return `from ${JSON.stringify(pathToFileURL(specifier.startsWith("@modelcontextprotocol/")
      ? transportPath : resolve("test", specifier)).href)}`;
  }).replace("const here = dirname(fileURLToPath(import.meta.url));", `const here = ${JSON.stringify(resolve("test"))};`);
  const adaptedPath = join(sandbox, "actual-journey.mjs");
  writeFileSync(adaptedPath, adapted, { flag: "wx" });
  for (const [mode, expectedFailure] of [
    ["normal", null],
    ["cursor-unavailable", /partial table cannot prove state/u],
    ["missing-visible-marker", /sichtbar inventarisierten Betrag/u],
    ["changed-after-navigation", /row values, order or types changed/u],
    ["lost-offscreen-row", /Marker|row values, order or types changed/u],
  ]) {
    sdk.configure(mode);
    let failure;
    try { await import(`${pathToFileURL(adaptedPath).href}?scenario=${mode}`); }
    catch (error) { failure = error; }
    if (expectedFailure) assert.match(failure?.message ?? "", expectedFailure, `${mode}: wrong failure`);
    else assert.equal(failure, undefined, failure?.stack);
    assert.equal(sdk.calls.filter(call => call.name === "sse_close").length, 1, `${mode}: owned cleanup must run once.`);
    assert.deepEqual(sdk.calls.find(call => call.name === "sse_close").arguments,
      { pid: 27182, hwnd: 31415, discardChanges: true });
    assert.equal(sdk.calls.at(-1).name, "client-close");
    if (mode === "normal") {
      assert.equal(sdk.calls.filter(call => call.name === "sse_table_add").length, 6);
      assert.equal(sdk.calls.filter(call => call.name === "sse_table_delete").length, 6);
      assert.equal(sdk.calls.filter(call => call.name === "sse_table_update").length, 2);
      assert.equal(sdk.calls.filter(call => call.name === "sse_goto" && call.arguments.pageId).length, 3);
    }
    if (mode === "cursor-unavailable") assert.deepEqual(sdk.calls.filter(call => call.arguments).map(call => call.name),
      ["sse_launch", "sse_page", "sse_table_read", "sse_close"], "The original focus failure must stop before mutations.");
  }
  assert.equal(readFileSync(originalPath, "utf8"), originalSource);
} finally {
  for (const [key, value] of saved) value === undefined ? delete process.env[key] : process.env[key] = value;
  assert(resolve(sandbox).startsWith(resolve(tmpdir()) + sep), "Temporary test sandbox escaped its owned root.");
  rmSync(sandbox, { recursive: true, force: true });
}
process.stdout.write("State journey: document-compatible navigation, visible/offscreen inventory, exact row semantics and owned cleanup passed.\n");
