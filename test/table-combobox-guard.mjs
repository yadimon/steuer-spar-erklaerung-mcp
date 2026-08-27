import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SSE_MCP_UI_SCHEMAS } from "../dist/mcp-schemas-ui.js";
import { SSE_MCP_TOOL_SCHEMAS } from "../dist/mcp-operation-schemas.js";
import { SSE_API_OPERATION_SCHEMAS } from "../dist/operation-catalog.js";
import { loadProductProfile } from "../dist/product-profiles.js";

const worker = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");
const comboHelpers = readFileSync(new URL("../powershell/table-combobox.ps1", import.meta.url), "utf8");
const tools = readFileSync(new URL("../src/mcp-tools-ui.ts", import.meta.url), "utf8");
const pageObjects = JSON.parse(readFileSync(new URL("../profiles/2025/page-objects.json", import.meta.url), "utf8"));

function operationBlock(name, next) {
  const start = worker.indexOf(`  '${name}' {`);
  const end = worker.indexOf(`  '${next}' {`, start + 1);
  assert(start >= 0 && end > start, `Operationsblock ${name} fehlt`);
  return worker.slice(start, end);
}

for (const [name, next] of [["table_add", "table_update"], ["table_update", "table_delete"]]) {
  const block = operationBlock(name, next);
  const typedSelection = block.indexOf("Invoke-SSETableComboSelection");
  const firstValueWrite = block.indexOf(".SetValue(");
  assert(typedSelection >= 0, `${name} verwendet die typisierte Tabellen-ComboBox-Auswahl nicht`);
  assert(firstValueWrite > typedSelection, `${name} setzt normale ValuePattern-Zellen vor der typisierten ComboBox`);
  assert(block.includes("Resolve-SSETableProfile $headingBefore $sumLabel $sumOccurrence"));
  assert(block.includes("Get-SSETableProfileColumn $tableProfile $i"));
  assert(block.includes("[string]$columnProfile.controlType -eq 'ComboBox'"));
  assert(block.includes("Get-SSETableComboExpectedBefore $a $i"));
  assert(block.includes("comboExpectedBefore.$i"));
  assert(block.includes("Sort-Object @{ Expression = { if ($_.mode -eq 'combo') { 0 } else { 1 } }"));
  assert(block.includes("-GuardUserInput:$guardUserInput"));
  assert(block.includes("-Rollback"));
  assert(block.includes("Compare-SSEPageCheckerMessages $checkerBefore $checkerAfter"));
  assert(block.includes("Neue Pruefermeldung nach Tabellenmutation"));
  assert(block.includes("$rollbackNewCheckerMessages.Count -eq 0"));
  assert(block.includes("checkerMessagesBefore=$checkerBefore"));
  assert(block.includes("newCheckerMessages=$newCheckerMessages"));
  assert(block.includes("Get-SSETableComboDiagnosticProjection $comboResult"));
  assert(block.includes("error=$comboDiagnostic.error; kind=$comboDiagnostic.kind"));
  assert(block.includes("mutationStarted=$comboDiagnostic.mutationStarted; interference=$comboDiagnostic.interference"));
  assert(block.includes("editorClosed=$comboDiagnostic.editorClosed"));
  assert(block.includes("diagnosticBounds=$comboDiagnostic.diagnosticBounds"));
  assert(block.includes("if ($comboResult.mutationStarted) { $null = $changed.Add($entry) }"));
  assert(block.includes("$failureKind = [string]$comboDiagnostic.kind"));
  assert(block.includes("kind=$(if ($failureKind) { $failureKind } else { 'postcondition-failed' })"));
  assert(block.includes("if (-not $failure -and"), `${name} darf die erste Combo-Ursache nicht durch die Nachsumme ersetzen`);
}

assert(worker.includes("function Resolve-SSETableProfile"));
assert(worker.includes("function Invoke-SSETableComboSelection"));
assert(worker.includes("automationIdSection"));
assert(worker.includes("page+sumLabel+sumOccurrence+column"));
const findAllReceivers = [...worker.matchAll(/(\$[A-Za-z_][A-Za-z0-9_:]*)\.FindAll\(/g)]
  .map((match) => match[1]);
assert.deepEqual(
  findAllReceivers,
  ["$workerAst"],
  "Worker darf FindAll nur fuer die lokale PowerShell-AST-Suche verwenden, nie fuer UIA-Elemente",
);
assert(!worker.includes("Get-SSETableCellSemantics"), "Heuristische ControlType-Erkennung darf nicht mehr entscheiden");
assert(worker.includes("function Get-SSEPageCheckerMessages"));
assert(worker.includes("function Compare-SSEPageCheckerMessages"));
assert(comboHelpers.includes("function Get-SSETableComboDiagnosticProjection"));
assert(comboHelpers.includes("function Test-SSETableRowFreeWithProfileDefaults"));
assert(comboHelpers.includes("function Test-SSETableComboPopupBindingEquivalent"));
assert(comboHelpers.includes("function Test-SSETableComboBoundListPresent"));
assert(comboHelpers.includes("function Test-SSETableComboCellAidProfileFragment"));
assert(comboHelpers.includes("function Get-SSETableComboDropArrowPoint"));
assert(comboHelpers.includes("$TableBinding.known -and $TableBinding.aidFallback"));
assert(comboHelpers.includes("initial+fresh-cell-automation-id-fragment"));

const comboFunctionStart = worker.indexOf("function Invoke-SSETableComboSelection");
const comboFunctionEnd = worker.indexOf("function Get-SSEPageCheckerMessages", comboFunctionStart);
const comboFunction = worker.slice(comboFunctionStart, comboFunctionEnd);
const noopIndex = comboFunction.indexOf("method='noop-already-target'");
const invokeAcquireIndex = comboFunction.indexOf("InvokePattern]::Pattern");
const physicalOpenIndex = comboFunction.indexOf("Click-VerifiedPoint -Window $Hwnd -Node $clickNode");
assert(noopIndex >= 0 && noopIndex < invokeAcquireIndex && noopIndex < physicalOpenIndex,
  "Exakter ComboBox-No-op muss vor Invoke/Klick zurueckkehren");
assert(comboFunction.includes("invokeAttempted=$false; clickAttempted=$false"));
assert(comboFunction.includes("method='noop-already-target'; internalSelected=$null; editorClosed=$true"));
assert(comboFunction.includes("InvokePattern]::Pattern"));
assert(comboFunction.includes("Resolve-SSETableComboPopup"));
assert(comboFunction.includes("SelectionItemPattern]::Pattern"));
assert(comboFunction.includes("$selection.Current.IsSelected"));
assert(worker.includes("value=(Get-SSETableComboCellValue $element $cell)"));
assert(comboFunction.includes("[string]$stateAfter.value"));
assert(comboFunction.includes("Compare-SSEPageCheckerMessages"));
assert(comboFunction.includes("$popupClosed"));
assert(comboFunction.includes("Kein blinder Rollback nach Interferenz"));
assert(!comboFunction.includes("SendKeys"), "Typisierte Tabellen-ComboBox darf keine Tasten senden");
assert(comboFunction.includes("InvokeThenVerifiedPointVisibleDesktop"));
assert(comboFunction.includes("Test-SSETableComboOpenFallbackBinding $stateBefore $clickState"));
assert(comboFunction.includes("[int]$ColumnProfile.index -ne $ColumnIndex"));
assert(comboFunction.includes("[int]$TableProfile.profileSumOccurrence -ne $SumOccurrence"));
assert(worker.includes("profileSumLabel=[string]$match.table.sumLabel"));
assert(worker.includes("profileSumOccurrence=[int]$match.table.sumOccurrence"));
assert(comboFunction.includes("$script:DESKTOP_NAME"), "Physischer Open-Fallback muss auf sichtbaren Desktop begrenzt sein");
assert(comboFunction.includes("Get-SSEPointObstruction $Hwnd $clickX $clickY"));
assert(comboFunction.includes("[int]$obstruction.boundPid -ne $ProcessId"));
assert(comboFunction.includes("Click-VerifiedPoint -Window $Hwnd -Node $clickNode"));
assert(comboFunction.includes("-ExpectedInputTick"));
assert(comboFunction.includes("-RequireForeground"));
assert(comboFunction.includes("verifiedPointPopupCandidateCount"));
assert(comboFunction.includes("Test-SSETableComboOpenFallbackBinding $clickState $arrowState"));
assert(comboFunction.includes("if (-not $popup.ok -and @($popup.candidates).Count -eq 0)"));
assert(comboFunction.includes("Get-SSETableComboDropArrowPoint $arrowState.cell $arrowState.nextCell"));
assert(comboFunction.includes("Get-SSEPointObstruction $Hwnd $arrowPoint.x $arrowPoint.y"));
assert(comboHelpers.includes("profile-bound-table-combobox-drop-arrow"));
assert(comboFunction.includes("invoke+verified-cell-point+verified-drop-arrow-point"));
assert(comboFunction.includes("dropArrowPopupCandidateCount"));
assert(comboFunction.includes("noSelectionReadback"));
assert(comboFunction.includes("Test-SSETableComboPopupBindingEquivalent $popup $postPopup"));
assert(comboFunction.includes("Test-SSETableComboBoundListPresent $postSources $popup"));
assert(comboFunction.includes("[int64]$postPopup.sourceHwnd -eq [int64]$Hwnd"));
assert(comboFunction.includes("[int]$_.pid -eq $ProcessId -and [int64]$_.hwnd -eq [int64]$postPopup.sourceHwnd"));
assert(comboFunction.includes("Get-SSEPointObstruction ([IntPtr][int64]$postPopup.sourceHwnd)"));
assert(comboFunction.includes("Click-VerifiedPoint -Window ([IntPtr][int64]$postPopup.sourceHwnd) -Node $targetNode"));
assert(comboFunction.includes("selection-item+verified-list-item-point"));
assert(comboFunction.includes("$selectionEvidence['boundListGone']=$popupClosed"));
assert(comboFunction.includes("$visualOk"));
assert(comboFunction.includes("$windowChanged"));
assert(comboFunction.includes("$rollbackResult = Invoke-SSETableComboSelection"));
assert(comboFunction.includes("$rollbackMethod = [string]$rollbackResult.method"));
assert(comboFunction.includes("$openEvidence['clickBinding'] = $clickBinding"));
assert(comboFunction.includes("initialRidResolvable=[bool]$initialElementAfterInvoke"));
assert(comboFunction.includes("freshRidResolvable=[bool]$freshElementAfterInvoke"));
assert(comboFunction.includes("windowFingerprintUnchanged="));
assert(comboFunction.includes("inputEpochUnchanged="));
assert(comboFunction.includes("mutationStarted=$false"));
assert(!comboFunction.includes(".SetValue("), "Typisierte Tabellen-ComboBox darf keinen sichtbaren Text als Auswahl setzen");

const profile = loadProductProfile("2025");
assert.equal(profile.id, "2025");
const page = pageObjects.pages["gew.innergem_erwerb_13b_einfuhr"];
assert.equal(page.heading, "Innergem. Erwerb, § 13b UStG und Einfuhr");
const costCategoryTable = page.tables.kostenkategorie_13b;
assert.equal(costCategoryTable.sumLabel, "Summe");
assert.equal(costCategoryTable.sumOccurrence, 1);
assert.equal(costCategoryTable.automationIdSection, "grpEmpf13b");
assert.equal(costCategoryTable.columns.find((column) => column.index === 3).writePolicy, "typed-selection-required");
assert.equal(costCategoryTable.columns.find((column) => column.index === 3).emptyRowDefault, "Sonst. Leistung EU");
const table = page.tables.sonstige_leistung_eu;
assert.equal(table.sumLabel, "Summe");
assert.equal(table.sumOccurrence, 2);
assert.equal(table.automationIdSection, "grpEmpf13b");
const category = table.columns.find((column) => column.index === 3);
assert.deepEqual(
  {
    header: category.header,
    controlType: category.controlType,
    valueKind: category.valueKind,
    writePolicy: category.writePolicy,
    openPattern: category.openPattern,
    optionControlType: category.optionControlType,
    optionSelectPattern: category.optionSelectPattern,
  },
  {
    header: "Kategorie",
    controlType: "ComboBox",
    valueKind: "enum",
    writePolicy: "typed-selection-required",
    openPattern: "InvokeThenVerifiedPointVisibleDesktop",
    optionControlType: "ListItem",
    optionSelectPattern: "SelectionItem",
  },
);
assert.deepEqual(category.readback, ["SelectionItem.IsSelected", "ValuePattern.Value", "checker-diff"]);
assert.match(category.reason, /DataItem.*SelectionItem.*ValuePattern text/i);

const addBlock = operationBlock("table_add", "table_update");
assert(addBlock.indexOf("Resolve-SSETableProfile $headingBefore $sumLabel $sumOccurrence $region") <
  addBlock.indexOf("Test-SSETableRowFreeWithProfileDefaults $byY[$_] $resolvedTableProfile"),
  "Tabellenprofil muss vor der profilierten Leerzeilenentscheidung gebunden sein");
assert(addBlock.includes("$tableProfile = $freeRead.tableProfile"));
assert(addBlock.includes("profileMismatch=$true"));

const addDescription = SSE_MCP_UI_SCHEMAS.sse_table_add.shape.werte.description ?? "";
const updateDescription = SSE_MCP_UI_SCHEMAS.sse_table_update.shape.werte.description ?? "";
const addComboBefore = SSE_MCP_UI_SCHEMAS.sse_table_add.shape.comboExpectedBefore.description ?? "";
const updateComboBefore = SSE_MCP_UI_SCHEMAS.sse_table_update.shape.comboExpectedBefore.description ?? "";
assert.match(addDescription, /Produktprofil.*ComboBox.*DataItem.*SelectionItem/i);
assert.match(updateDescription, /profil.*ComboBox.*DataItem.*SelectionItem/i);
assert.match(addComboBefore, /Vorwert.*0-basierter ComboBox-Spalte/i);
assert.match(updateComboBefore, /Vorwert.*0-basierter ComboBox-Spalte/i);
assert.match(tools, /sichtbarer ValuePattern-Text allein ist nie ein Commit-Beweis/i);
assert.match(tools, /Profilierte ComboBoxen binden Seite, Summenregion und Spalte/i);
assert.match(tools, /Neue seitenweite Pruefermeldungen gelten ebenfalls als/);

const typedAdd = {
  expectedPage: "Innergem. Erwerb, § 13b UStG und Einfuhr",
  werte: ["", "11.07", "Beleg", "Sonst. Leistung EU", "19", "181,58"],
  comboExpectedBefore: { 3: "" },
  sumLabel: "Summe",
  sumOccurrence: 2,
  expectedBefore: "0,00",
  expectedAfter: "181,58",
};
assert(SSE_MCP_TOOL_SCHEMAS.sse_table_add.safeParse(typedAdd).success, "MCP-Schema lehnt typisierten Add-Aufruf ab");
assert(SSE_API_OPERATION_SCHEMAS.table_add.safeParse(typedAdd).success, "API-Schema lehnt typisierten Add-Aufruf ab");
assert(!SSE_MCP_TOOL_SCHEMAS.sse_table_add.safeParse({ ...typedAdd, comboExpectedBefore: { x: "alt" } }).success);

process.stdout.write("Tabellen-ComboBox-Guard: Kategorie wird vor Textzellen per profil- und popupgebundenem SelectionItem gesetzt\n");
