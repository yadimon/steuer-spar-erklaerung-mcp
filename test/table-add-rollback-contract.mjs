import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const worker = readFileSync(join(root, "powershell", "sse-worker.ps1"), "utf8");
const lifecycleTest = readFileSync(join(root, "test", "table-lifecycle-transaction.mjs"), "utf8");
const marker = "\n  'table_add' {";
const start = worker.indexOf(marker);
assert(start >= 0, "table_add fehlt im Worker.");
const next = worker.indexOf("\n  '", start + marker.length);
const tableAdd = worker.slice(start, next >= 0 ? next : worker.length);
const rollbackStart = tableAdd.indexOf("# Vor jeder Ruecksetzung erneut beweisen");
assert(rollbackStart >= 0, "Gebundener table_add-Rollback fehlt.");
const rollback = tableAdd.slice(rollbackStart);

assert.match(tableAdd, /beforeRaw=\[string\]\$snapshotPattern\.Current\.Value/);
assert.match(tableAdd, /beforeDisplay=\[string\]\$snapshotElement\.Current\.Name/);
assert.match(rollback, /SetValue\(\[string\]\$snapshot\.beforeRaw\)/,
  "Rollback muss den rohen ValuePattern-Ausgangswert statt des sichtbaren '0,00'-Fallbacks schreiben.");
assert.doesNotMatch(rollback, /SetValue\(\$entry\.before\)/);
assert.doesNotMatch(rollback, /SendKeys|\^\{?Z\}?|Undo/i,
  "Rollback darf weder rohe Tasten noch blindes Undo verwenden.");
assert(rollback.indexOf("$rollbackPreflightError") < rollback.indexOf("$rollbackActions = @{}"),
  "Interferenz muss vor der ersten Rollback-Mutation geprueft werden.");
for (const proof of [
  "rowCount", "freeRowCount", "populatedRowCount", "fingerprint", "endRowFingerprint",
  "strukturEntfernt", "ausgangszustandBewiesen", "interactionOk",
]) {
  assert(rollback.includes(proof), `Rollback-Vollstaendigkeitsbeweis '${proof}' fehlt.`);
}
assert.match(rollback, /\$rollbackNewCheckerMessages\.Count -eq 0/);
assert.match(rollback, /Test-SSEScalarEqual \$rollbackSum\.value \$expectedBefore/);
assert.match(rollback, /Where-Object \{ -not \$_\.restored \}/);
assert(lifecycleTest.includes("failedAdd.rollback?.strukturEntfernt, false") &&
  lifecycleTest.includes("failedAdd.rollback?.erfolgreich, false") &&
  lifecycleTest.includes("failedAdd.rollback?.strukturVorher?.freeRowCount + 1") &&
  lifecycleTest.includes("verwaiste zweite Leerzeile"),
"Der reale Lifecycle-Test prueft den fail-closed gemeldeten Orphan-Leerzeilenfall nicht.");

process.stdout.write("OK: table_add-Rollback stellt rohe Zellwerte wieder her und meldet unvollstaendige Struktur fail-closed.\n");
