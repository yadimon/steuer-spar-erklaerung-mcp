import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");
const start = worker.indexOf("\n  'table_delete' {");
const end = worker.indexOf("\n  '", start + 5);
assert(start >= 0 && end > start, "table_delete-Workerblock fehlt.");
const tableDelete = worker.slice(start, end);

assert.doesNotMatch(tableDelete, /\[bool\]\(if \(/u,
  "PowerShell darf eine if-Anweisung nicht als [bool](...) auswerten; das scheitert erst im echten Worker.");
assert.doesNotMatch(tableDelete, /\$nochDa|\$targetRestored|SendWait\('\^z'\)|mouse_event/u,
  "Der native Dispatcher darf den alten textbasierten Legacy-Readback, Klick oder Undo nicht mehr enthalten.");
assert.match(tableDelete, /Invoke-SSEUiaTableDelete[\s\S]*finally \{\$uiaDeleteProcess\.Dispose\(\)\}/u,
  "Der UIA-Transaktionspfad muss den eigenen Prozess durch Emit hindurch binden.");
assert(tableDelete.indexOf("Invoke-SSEUiaTableDelete") < tableDelete.indexOf("Resolve-TableDeleteFreshTarget"),
  "UIA muss vor dem ausschliesslich nativ abgesicherten Resolver getrennt aussteigen.");
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
assert.match(tableDelete, /\$inputBaseline -eq \$preDeleteInput/u,
  "Die eigene Auswahl-Epoche darf vor dem letzten Readback nicht durch eine fremde Eingabe ersetzt werden.");
assert(tableDelete.includes("inputEpoch=[pscustomobject]@{ sinceSelection=$selectionInputEvidence; duringRead=$readInputEvidence }") &&
  tableDelete.includes("foregroundOk=($preDeleteForegroundAfter -eq [int64]$hwnd)"),
  "Der Loeschstopp muss Eingabe-Epochen und denselben gebundenen Vordergrundwert wie der Guard melden.");

process.stdout.write("table_delete: separater vollstaendiger UIA-Gridproof; nativer Resolver ohne Legacy-Klick oder Text-Undo.\n");
