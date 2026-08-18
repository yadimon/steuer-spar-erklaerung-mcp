import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = readFileSync(join(here, "..", "powershell", "sse-worker.ps1"), "utf8");

function operationBlock(operation) {
  const marker = `\n  '${operation}' {`;
  const start = worker.indexOf(marker);
  assert(start >= 0, `${operation} fehlt im Worker.`);
  const next = worker.indexOf("\n  '", start + marker.length);
  return worker.slice(start, next >= 0 ? next : worker.length);
}

for (const operation of ["table_add", "table_update", "table_delete"]) {
  const block = operationBlock(operation);
  assert.match(block, /Walk-BoundTree/u,
    `${operation} muss seinen Tabellenbaum an das angeforderte Hauptfenster binden.`);
  assert.doesNotMatch(block, /\bWalk-Tree\b/u,
    `${operation} darf keine angehaengten Werte-Info-/Hilfsfenster in die Mutation einbeziehen.`);
}

const update = operationBlock("table_update");
assert.doesNotMatch(update, /aid\s+-notmatch\s+['"]WerteInfo/u,
  "table_update darf Fenstersicherheit nicht ueber eine fragile AID-Namensheuristik ersetzen.");

process.stdout.write("Tabellenmutation: Add/Update/Delete lesen ausschliesslich den gebundenen Hauptfensterbaum.\n");
