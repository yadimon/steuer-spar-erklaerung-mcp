$ErrorActionPreference='Stop'
$worker=Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($worker,[ref]$null,[ref]$null)
$add=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst]},$true) |
  ForEach-Object {$_.Clauses | Where-Object {$_.Item1.Extent.Text -ceq "'table_add'"} | ForEach-Object {$_.Item2}})
if ($add.Count -ne 1) {throw 'Expected exactly one production append dispatcher.'}
$statements=@($add[0].Statements)
$start=@(for($index=0;$index -lt $statements.Count;$index++) {
  if ($statements[$index].Extent.Text.StartsWith('$navigationSteps =')) {$index}
})
$end=@(for($index=0;$index -lt $statements.Count;$index++) {
  if ($statements[$index].Extent.Text.StartsWith('$zeile =')) {$index}
})
if ($start.Count -ne 1 -or $end.Count -ne 1 -or $end[0] -le $start[0]) {throw 'Append seek boundary is ambiguous.'}
$seek=[scriptblock]::Create(($statements[$start[0]..($end[0]-1)].Extent.Text -join "`n"))

# The boundary deliberately exposes an editable date cell where the former
# append search clicked and sent HOME/DOWN. No real desktop APIs are loaded.
Add-Type @'
using System;
public static class SW { public static IntPtr GetForegroundWindow() { return new IntPtr(7); } }
namespace System.Windows.Forms {
 public static class SendKeys { public static void SendWait(string value) { throw new Exception("unexpected-editor-key"); } }
}
'@
function Fail($Message,$Kind) {throw "$Kind`: $Message"}
function Emit($Result) {$script:result=$Result;throw 'seek-result'}
function Get-SSETableRegion { @{ok=$true} }
function Initialize-SSETableMutationFocus { @{tree=$script:beforeTree;sumRead=$script:sumBeforeRead;guardUserInput=$true;inputBaseline=123} }
function Get-SSEPageCheckerMessages { @() }
function Compare-SSEPageCheckerMessages { @() }
function Find-FreeTableRow { $script:freeRead }
function Get-TableStructureEvidence { @{rowCount=6;populatedRowCount=6} }
function Get-SSETableRowDefaultEvidence { @{free=$false} }
function Test-SSETableMutationForegroundLost {$false}
function Test-SSELastInputUnchanged {$true}
function Get-SSELastInputTick {123}
function Set-SSEForegroundLeaseInputCheckpoint {}
function Click-VerifiedPoint {$script:clicks++;throw 'unexpected-date-editor-activation'}
function Start-Sleep {}
$script:DESKTOP_NAME='';$hwnd=[IntPtr]7;$targetPid=42
$expectedPage='Einnahmen: Synthetic commissions';$sumLabel='Summe';$sumOccurrence=1;$expectedBefore='615,00'
$beforeTree=@{};$sumBeforeRead=@{};$checkerBefore=@();$a=@{};$werte=@()

foreach ($hasFreeRow in @($false,$true)) {
  $script:clicks=0;$script:result=$null
  $script:freeRead=@{ error=$null;free=$(if($hasFreeRow){@(10)}else{@()});
    firstCell=@{type='DataItem';name='06.01';x=10;y=20;w=80;h=24};byY=@{10=@(@{name='Synthetic existing row'})} }
  try { & $seek } catch {
    if ($_.Exception.Message -cne 'seek-result') {throw}
  }
  if ($script:clicks -ne 0) {throw 'Append seek activated an editable existing cell.'}
  if ($hasFreeRow) {
    if ($script:result) {throw 'A visible append row was rejected.'}
  } else {
    if (-not $script:result -or $script:result.ok -ne $false -or $script:result.kind -cne 'not-found' -or
        $script:result.mutationStarted -ne $false -or $script:result.resultingState -cne 'unchanged' -or
        $script:result.physicalInputAttempted -ne $false -or $script:result.physicalInputUsed -ne $false) {
      throw 'A hidden append row needs a truthful rejection before input.'
    }
  }
}
Write-Output 'Append seek: hidden rows stop before editor activation; visible rows continue to the bound write.'
