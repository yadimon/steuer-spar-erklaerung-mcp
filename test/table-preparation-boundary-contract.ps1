$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Worker cannot be parsed.'}
$clauses=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst]},$true) | ForEach-Object {$_.Clauses})
function Get-Prefix([string]$Operation,[string]$StopPrefix) {
  $clause=@($clauses | Where-Object {$_.Item1.Extent.Text -ceq "'$Operation'"})
  if($clause.Count -ne 1){throw "Expected one $Operation dispatcher."}
  $statements=@($clause[0].Item2.Statements)
  $stop=@(for($index=0;$index -lt $statements.Count;$index++) {
    if($statements[$index].Extent.Text.StartsWith($StopPrefix,[StringComparison]::Ordinal)){$index}
  })
  if($stop.Count -ne 1 -or $stop[0] -lt 1){throw 'Preparation boundary statement missing.'}
  [scriptblock]::Create(($statements[0..($stop[0]-1)].Extent.Text -join "`n"))
}
function Arg($Arguments,$Name,$Default=$null) {if($Arguments.ContainsKey($Name)){$Arguments[$Name]}else{$Default}}
function Get-SSEBoundedIntegerArg($Arguments,$Name,$Default,$Minimum,$Maximum) {Arg $Arguments $Name $Default}
function Resolve-SSEMainWindowDescriptor { [pscustomobject]@{hwnd=111;pid=7;minimiert=$false} }
function Invoke-SSETablePreparation($Window,$ProcessId) {
  if($Window -ne [IntPtr]111 -or $ProcessId -ne 7){throw 'Preparation lost main PID/HWND.'}
  $script:preparations++
  [pscustomobject]@{ok=(-not $script:preparationFails);kind='table-preparation-failed'}
}
function Get-SSELastInputTick {10}
function Emit($Result) {$script:emitted=$Result;throw 'SYNTHETIC_EMIT'}
function Fail($Message,$Kind) {$script:failedKind=$Kind;throw $Message}
Add-Type @'
using System;
public static class SW {
 public static IntPtr GetForegroundWindow(){return new IntPtr(111);}
 public static int GetWindowThreadProcessId(IntPtr hwnd,out int pid){pid=7;return 1;}
}
'@
$read=Get-Prefix 'table_read' '$dirtyBefore ='
foreach($case in @(
  @{args=@{noKeys=$false};expected=1},
  @{args=@{};expected=1},
  @{args=@{noKeys=$true};expected=0},
  @{args=@{readMode='grid'};expected=0},
  @{args=@{readMode='grid';noKeys=$false};expected=0;bad=$true},
  @{args=@{noKeys=$false;__tableCursorPlan=[pscustomobject]@{schemaVersion=1;phase='prebind'}};expected=1},
  @{args=@{noKeys=$false;__tableCursorPlan=[pscustomobject]@{schemaVersion=1;phase='native-acquire';binding=@{}}};expected=0},
  @{args=@{noKeys=$false;__tableCursorPlan=[pscustomobject]@{schemaVersion=1;phase='resume';binding=@{}}};expected=0},
  @{args=@{noKeys=$false;__tableCursorPlan=[pscustomobject]@{schemaVersion=1;phase='unknown'}};expected=0;bad=$true},
  @{args=@{noKeys=$false;__tableCursorPlan=[pscustomobject]@{schemaVersion=1;phase='prebind';extra=$true}};expected=0;bad=$true}
)) {
  $a=@{sumLabel='Summe'}+$case.args;$script:preparations=0;$script:failedKind=$null;$script:preparationFails=$false
  $script:DESKTOP_NAME='';$caught=$null
  try {& $read} catch {$caught=$_}
  if($script:preparations -ne $case.expected -or [bool]$caught -ne [bool]$case.bad){throw 'Read preparation ran after binding, for a read-only scope, or before valid plan admission.'}
  if($case.bad -and $script:failedKind -cne 'bad-args'){throw 'Invalid plan did not retain bad-args.'}
}
foreach($operation in @('table_add','table_update','table_delete')) {
  $prefix=Get-Prefix $operation '$dialogsBefore ='
  foreach($inherited in @($false,$true)) {
    $a=@{werte=@('Synthetic');expectedPage='Synthetic';text='Synthetic row';sumLabel='Summe';expectedBefore='10,00';expectedAfter='10,00'}
    if($inherited){$a.__tableMutationBinding=[pscustomobject]@{binding='existing'}}
    $script:preparations=0;$script:preparationFails=$false;$script:DESKTOP_NAME=''
    & $prefix
    if($script:preparations -ne [int](-not $inherited)){throw "$operation`: preparation invalidated an inherited mutation binding or was omitted."}
  }
}
Write-Output 'Table preparation boundary: public cursor and initial native prebind only; no Grid/noKeys/private binding or inherited mutation preparation.'
