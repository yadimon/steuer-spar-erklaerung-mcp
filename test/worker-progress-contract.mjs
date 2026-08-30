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
assert.match(collect, /\$polledHeading = Wait-SSEHeadingChange \$hwnd \$head 950 100[\s\S]*\$afterHeading = \$\(if \(\$polledHeading\) \{ \$polledHeading \} else \{ Get-CurrentHeading \$hwnd \}\)[\s\S]*\$currentHeadingAfter = \$afterHeading[\s\S]*\$advancedAfterLastCaptured = \$true/);
assert.doesNotMatch(collect, /Start-Sleep -Milliseconds 950/,
  "collect darf nach Weiter nicht mehr starr 950 ms warten.");
assert.match(collect, /\$navigationElement = Find-SSEButtonByName \$hwnd 'Weiter'[\s\S]*if \(-not \$navigationElement\) \{[\s\S]*\$navigationTree = Walk-Tree \$hwnd 1200/,
  "collect braucht den direkten aktiven Weiter-Fund mit unveraendertem Snapshot-Fallback.");
assert.equal((collect.match(/currentHeadingAfter=\$currentHeadingAfter/g) ?? []).length, 2,
  "Wiederaufnahmeseite muss in Ergebnisdatei und direkter Antwort stehen.");
assert.equal((collect.match(/advancedAfterLastCaptured=\$advancedAfterLastCaptured/g) ?? []).length, 2,
  "Bestaetigter Fortschritt muss in Ergebnisdatei und direkter Antwort stehen.");

assert.match(worker, /function Get-SSEHeadingFast[\s\S]*\$text = Find-ExactAutomationElement \$Hwnd \$relative[\s\S]*ControlType\]::Text[\s\S]*-not \$current\.IsEnabled -or \$current\.IsOffscreen[\s\S]*if \(\$name\) \{ return \$name \}/,
  "Die allgemeine Ueberschrift akzeptiert nicht ausschliesslich das exakte, sichtbare und aktivierte Header-QLabel.");
assert.match(worker, /function Get-CurrentHeading[\s\S]*Get-SSEHeadingFast \$Hwnd[\s\S]*Walk-Tree \$Hwnd 1200 25 12 -WithValues/,
  "Get-CurrentHeading muss bei jedem unklaren Direktfund auf den alten Baumweg zurueckfallen.");
assert.match(worker, /function Wait-SSEHeadingChange[\s\S]*Get-SSEHeadingFast \$Hwnd[\s\S]*return \$null/,
  "Heading-Polling muss billig pollen und den strukturellen Readback dem sicherheitsgeprueften Aufrufer ueberlassen.");
assert.match(worker, /\$candidate = \$null[\s\S]*if \(\$candidate -ceq \$heading\) \{ return \$heading \}[\s\S]*\$candidate = \$heading[\s\S]*else \{[\s\S]*\$candidate = \$null/,
  "Generisches Heading-Polling muss denselben neuen Exact-Leaf-Wert zweimal hintereinander bestaetigen.");
assert.ok(collect.indexOf("$dialogsAfter = @(") < collect.indexOf("$afterHeading = $(if ($polledHeading)"),
  "collect muss Prozess/Dialoge vor dem strukturellen Heading-Fallback pruefen.");

const goto = operationBlock("goto");
assert.doesNotMatch(goto, /Invoke\(\); Start-Sleep -Milliseconds 900/,
  "goto wartet nach einem Navigations-Invoke noch starr 900 ms.");
assert.match(goto, /\$ok = DrueckeKnopf \$hwnd \$richtung ''[\s\S]*\$jetzt = WarteAufUeberschrift \$hwnd \$vorher \$ziel 900/,
  "goto muss den Heading-Wechsel nach dem Navigations-Invoke pollen.");
assert.match(goto, /function AktuelleUeberschrift[\s\S]*if \(\$knownTarget\) \{ return \(Get-KnownPageHeading \$h \$knownTarget\) \}[\s\S]*\$t = Walk-Tree \$h 400[\s\S]*function IstZielseite/,
  "Generisches Engine-30-goto muss beim kleinen 400-Knoten-Readback ohne ValuePatterns bleiben.");
assert.match(goto, /if \(-not \$knownTarget\) \{[\s\S]*Wait-SSEHeadingChange \$h \$vorher \$timeoutMs 100[\s\S]*return \(AktuelleUeberschrift \$h\)[\s\S]*# Qt bestaetigt/,
  "Generisches goto muss 2025 exakt pollen, 2024 einmal warten und danach genau einmal strukturell lesen.");
assert.doesNotMatch(goto, /function AktuelleUeberschrift[\s\S]{0,500}Get-CurrentHeading/,
  "Generisches goto darf Engine 30 nicht ueber den grossen Get-CurrentHeading-Baum pollen.");

process.stdout.write("OK: collect- und table_read-Fortschrittsvertrag ist fail-closed.\n");
