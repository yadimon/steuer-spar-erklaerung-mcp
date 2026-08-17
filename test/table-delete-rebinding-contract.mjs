import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");
const start = worker.indexOf("\n  'table_delete' {");
const end = worker.indexOf("\n  '", start + 5);
assert(start >= 0 && end > start, "table_delete-Workerblock fehlt.");
const tableDelete = worker.slice(start, end);

assert.doesNotMatch(tableDelete, /\[bool\]\(if \(/u,
  "PowerShell darf eine if-Anweisung nicht als [bool](...) auswerten; das scheitert erst im echten Worker.");
assert.match(tableDelete, /\$nochDa = if \(\$afterRegion\.ok\) \{[\s\S]*\[bool\]\(@\(\$afterRegion\.cells/u,
  "Der Post-Delete-Readback muss den Regionsfund als gueltigen PowerShell-Ausdruck boolesch binden.");
assert.match(tableDelete, /function Resolve-TableDeleteFreshTarget/u,
  "table_delete braucht einen gemeinsamen Resolver fuer RuntimeId-Churn.");
assert.match(tableDelete, /\(\$matches\.Count -eq 0 -or \$matches\.Count -gt 1\)/u,
  "Der Resolver muss mehrdeutige AutomationIds vor dem Aktivierungs-Gate strukturell re-binden.");
assert.match(tableDelete, /\(-not \$targetAid -or \[string\]\$rowCells\[\$targetColumnIndex\]\.aid -eq \$targetAid\)/u,
  "Der strukturelle Rebind muss die zuvor gebundene AutomationId weiterhin pruefen.");
assert.match(tableDelete, /row-column-after-ambiguous-automation-id/u,
  "Der Ergebnisnachweis muss einen durch Mehrdeutigkeit ausgeloesten strukturellen Rebind kenntlich machen.");
const resolver = tableDelete.indexOf("Resolve-TableDeleteFreshTarget $pointRegion");
const preDelete = tableDelete.indexOf("Resolve-TableDeleteFreshTarget $preDeleteRegion");
const deleteKeys = tableDelete.indexOf("SendWait('^+{DEL}')");
assert(resolver >= 0 && preDelete > resolver && deleteKeys > preDelete,
  "Der frische Resolver muss sowohl vor der Auswahl als auch unmittelbar vor dem Loeschbefehl laufen.");

process.stdout.write("table_delete: RuntimeId-Churn mit mehrdeutiger AutomationId bleibt nur ueber die summengebundene Zeile/Spalte erlaubt.\n");
