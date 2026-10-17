import assert from "node:assert/strict";
import { extname } from "node:path";

/** Select the profiled annual-return page of this document, never catalog order. */
export function stateJourneyDestination(catalog, fixture, tableHeading) {
  const documentType = extname(fixture).slice(1);
  assert.match(documentType, /^[A-Za-z]+\d{4}$/u, "The state fixture requires an exact document type.");
  const candidates = Object.entries(catalog.pages ?? {}).filter(([pageId, page]) =>
    pageId.endsWith(".umsatzsteuer_jahreserklaerung") && page.documentType === documentType &&
    typeof page.heading === "string" && page.heading.trim() && page.heading !== tableHeading);
  assert.equal(candidates.length, 1,
    `Document '${documentType}' requires exactly one compatible annual-return destination (${candidates.length}).`);
  const [pageId, page] = candidates[0];
  return { pageId, heading: page.heading, documentType };
}

/** Preserve values, order and typed semantics; omit backend-specific row identities. */
export function stateJourneyInventory(table, step) {
  assert.equal(table.vollstaendig, true, `${step}: a partial table cannot prove state (${table.stopKind}).`);
  assert(Array.isArray(table.kopf) && table.kopf.length > 0, `${step}: missing headers.`);
  assert(Array.isArray(table.zeilen), `${step}: missing rows.`);
  assert.equal(table.rowDetails?.length, table.zeilen.length, `${step}: missing row semantics.`);
  const rows = table.zeilen.map((values, index) => {
    assert.equal(values.length, table.kopf.length, `${step}: row width changed.`);
    const details = table.rowDetails[index];
    for (const key of ["typedValues", "checkboxStates", "cellTypes"]) {
      assert.equal(details[key]?.length, values.length, `${step}: incomplete ${key}.`);
    }
    return { values: [...values], typedValues: [...details.typedValues],
      checkboxStates: [...details.checkboxStates], cellTypes: [...details.cellTypes] };
  });
  return { headers: [...table.kopf], rows, sum: table.summe };
}

/** The geometric reader has a viewport contract, while the model includes offscreen rows. */
export function stateJourneyVisibility(table, visible, markers, amountColumn, step) {
  const column = table.kopf.indexOf(amountColumn);
  assert(column >= 0, `${step}: amount column missing.`);
  assert.equal(visible.incomplete, false, `${step}: truncated visible inventory.`);
  assert.deepEqual(visible.headers, table.kopf, `${step}: visible headers differ from the full table.`);
  assert.equal(visible.rowCount, visible.rows?.length, `${step}: visible row count differs.`);
  assert(visible.rows.every(row => row.length === table.kopf.length), `${step}: visible row width differs.`);
  const modelAmounts = table.zeilen.map(row => row[column]);
  const visibleAmounts = visible.rows.map(row => row[column]);
  for (const marker of markers) {
    assert.equal(modelAmounts.filter(value => value === marker).length, 1,
      `${step}: '${marker}' must occur in exactly one complete-model amount cell.`);
    assert(visibleAmounts.filter(value => value === marker).length <= 1,
      `${step}: duplicate visible marker '${marker}'.`);
  }
  return {
    visible: markers.filter(marker => visibleAmounts.includes(marker)),
    offscreen: markers.filter(marker => !visibleAmounts.includes(marker)),
  };
}

export function assertStateRowsUnchanged(before, after, step) {
  assert.deepEqual(after.headers, before.headers, `${step}: headers changed.`);
  assert.deepEqual(after.rows, before.rows, `${step}: row values, order or types changed.`);
}

/** Check a single mutation and retain every unaffected row and semantic cell. */
export function assertStateMutation(before, after, mutation, amountColumn, step) {
  assert.deepEqual(after.headers, before.headers, `${step}: headers changed.`);
  const column = before.headers.indexOf(amountColumn);
  assert(column >= 0, `${step}: amount column missing.`);
  if (mutation.kind === "append") {
    assert.equal(after.rows.length, before.rows.length + 1, `${step}: append changed the row count incorrectly.`);
    assert.deepEqual(after.rows.slice(0, -1), before.rows, `${step}: append changed existing rows.`);
    const added = after.rows.at(-1);
    assert.equal(added.values[column], mutation.value, `${step}: appended amount differs.`);
    assert.equal(added.typedValues[column], mutation.value, `${step}: appended typed amount differs.`);
    assert.equal(added.cellTypes[column], "text", `${step}: appended amount type differs.`);
    const labelColumn = before.headers.indexOf("Bezeichnung");
    assert(labelColumn >= 0, `${step}: row label column missing.`);
    assert.equal(added.values[labelColumn], mutation.label, `${step}: appended row identity differs.`);
    assert.equal(added.typedValues[labelColumn], mutation.label, `${step}: appended typed row identity differs.`);
    assert.equal(added.cellTypes[labelColumn], "text", `${step}: appended row identity type differs.`);
    return;
  }
  const targets = before.rows.flatMap((row, index) => row.values[column] === mutation.before ? [index] : []);
  assert.equal(targets.length, 1, `${step}: mutation target is ambiguous or absent.`);
  const expected = structuredClone(before.rows);
  if (mutation.kind === "delete") expected.splice(targets[0], 1);
  else {
    assert.equal(mutation.kind, "update", `${step}: unknown mutation.`);
    for (const index of [column, before.headers.indexOf("Netto")].filter(index => index >= 0)) {
      expected[targets[0]].values[index] = mutation.value;
      expected[targets[0]].typedValues[index] = mutation.value;
    }
  }
  assert.deepEqual(after.rows, expected, `${step}: mutation changed another value, row order or cell type.`);
}
