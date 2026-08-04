import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const worker = readFileSync(join(root, "powershell", "sse-worker.ps1"), "utf8");
const uiTools = readFileSync(join(root, "src", "mcp-tools-ui.ts"), "utf8");

const operationBlock = (operation) => {
  const marker = `\n  '${operation}' {`;
  const start = worker.indexOf(marker);
  assert(start >= 0, `Worker-Operation '${operation}' fehlt.`);
  const next = worker.indexOf("\n  '", start + marker.length);
  return worker.slice(start, next >= 0 ? next : worker.length);
};

const tableRead = operationBlock("table_read");
assert.match(tableRead, /zeilenMitIdentitaet/);
assert.match(tableRead, /\$curRids\[\$best\] = \$c\.rid/);
assert.match(tableRead, /\$entry\.identitaet/);
assert.doesNotMatch(tableRead, /\$r\s+-join\s+'\|'/,
  "Tabellenzeilen duerfen nicht mehr ueber ihren Inhalt dedupliziert werden.");
assert.doesNotMatch(tableRead, /\$leerlauf|-ge\s+4/,
  "Vier gleiche Viewport-Snapshots duerfen den Tabellenlauf nicht beenden.");
assert.match(tableRead, /SelectionPattern\]::Pattern/);
assert.match(tableRead, /\.Current\.GetSelection\(\)/);
assert.match(tableRead, /\$stableCursorMoves -ge 2/);
assert.match(tableRead, /\$limitReached = \[bool\]\(\$geklickt -and \$schritte -ge \$maxSchritte\)/);
assert.match(tableRead, /\$endProven[\s\S]*-not \$limitReached[\s\S]*-not \$identityState\.fehlend/);
for (const field of ["schritte", "stopKind", "limitReached"]) {
  assert.match(tableRead, new RegExp(`${field}\\s*=\\s*\\$${field}`),
    `sse_table_read meldet '${field}' nicht.`);
  assert.match(uiTools, new RegExp(`${field}: r\\.${field}`),
    `Der MCP-Wrapper verwirft '${field}'.`);
}
assert.match(tableRead, /steps\s*=\s*\$schritte/);
assert.match(uiTools, /steps: r\.steps/);

const collect = operationBlock("collect");
assert.match(collect, /\$currentHeadingAfter = \$head[\s\S]*\$advancedAfterLastCaptured = \$false/);
assert.match(collect, /\$afterHeading = Get-CurrentHeading \$hwnd[\s\S]*\$currentHeadingAfter = \$afterHeading[\s\S]*\$advancedAfterLastCaptured = \$true/);
assert.equal((collect.match(/currentHeadingAfter=\$currentHeadingAfter/g) ?? []).length, 2,
  "Wiederaufnahmeseite muss in Ergebnisdatei und direkter Antwort stehen.");
assert.equal((collect.match(/advancedAfterLastCaptured=\$advancedAfterLastCaptured/g) ?? []).length, 2,
  "Bestaetigter Fortschritt muss in Ergebnisdatei und direkter Antwort stehen.");

process.stdout.write("OK: collect- und table_read-Fortschrittsvertrag ist fail-closed.\n");
