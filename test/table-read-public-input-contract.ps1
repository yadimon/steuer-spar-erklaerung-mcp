$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$worker=Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($worker,[ref]$null,[ref]$errors)
if ($errors.Count) {throw 'The production worker must parse.'}
foreach ($name in @('Invoke-SSETableReadInitialFocus','Get-SSETableExceptionDiagnostic')) {
  $definitions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($definitions.Count -ne 1) {throw "Production helper $name is ambiguous."}
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$branches=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst]},$true) |
  ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Extent.Text -ceq "'table_read'"})
if ($branches.Count -ne 1) {throw 'The real table_read branch must be unique.'}
$statements=@($branches[0].Item2.Statements)
function StatementIndex([string]$Prefix) {
  $found=@(for ($index=0;$index -lt $statements.Count;$index++) {
    if ($statements[$index].Extent.Text.StartsWith($Prefix,[StringComparison]::Ordinal)) {$index}
  })
  if ($found.Count -ne 1) {throw "The actual dispatcher statement $Prefix must be unique."}
  [int]$found[0]
}
$activationStart=StatementIndex '$geklickt ='
$stepsStart=StatementIndex '$schritte ='
$finalReadStart=StatementIndex '$vollstaendigerCursorbeweis ='
$finishStart=StatementIndex '$dirtyAfter ='
# Only the framework key sender is rebound. The real guards, focus callback
# wiring, catch, navigation loop and both public result branches run unchanged.
$activationText=$statements[$activationStart..($stepsStart-1)].Extent.Text -join "`n"
$activation=[scriptblock]::Create($activationText.Replace('[System.Windows.Forms.SendKeys]','[SyntheticPublicTableInput.SendKeys]'))
$navigation=[scriptblock]::Create(($statements[$stepsStart..($finalReadStart-1)].Extent.Text -join "`n"))
$completion=[scriptblock]::Create((@(
  $statements[(StatementIndex '$limitReached =')],$statements[(StatementIndex '$vollstaendig =')],$statements[(StatementIndex '$stopKind =')]
).Extent.Text -join "`n"))
$finish=[scriptblock]::Create(($statements[$finishStart..($statements.Count-1)].Extent.Text -join "`n"))
Add-Type -TypeDefinition @'
using System;
public static class SW {
 public static int Releases;
 public static IntPtr GetForegroundWindow(){return new IntPtr(111);}
 public static int GetWindowThreadProcessId(IntPtr hwnd,out int processId){processId=7;return 1;}
 public static bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,int flags){Releases++;return true;}
}
namespace SyntheticPublicTableInput {
 public static class SendKeys {
  public static int Calls,Confirmed,ThrowAt;
  public static void SendWait(string key){Calls++;if(Calls==ThrowAt)throw new InvalidOperationException("Synthetic navigation result lost");Confirmed++;}
 }
}
namespace System.Windows.Automation {
 public static class SelectionPattern {public static object Pattern=new object();}
}
'@
function Assert-True([bool]$Condition,[string]$Message) {if (-not $Condition) {throw $Message}}
function Same($Actual,$Expected,[string]$Message) {
  $actualJson=$Actual | ConvertTo-Json -Depth 20 -Compress;$expectedJson=$Expected | ConvertTo-Json -Depth 20 -Compress
  if ($actualJson -cne $expectedJson) {throw ($Message+' Actual: '+$actualJson+' Expected: '+$expectedJson)}
}
function Arg($Arguments,[string]$Name,$Default=$null) {
  $property=$Arguments.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) {return $Default}
  $property.Value
}
function Get-DirtyStateFast {
  [bool]($script:scenario -ceq 'lost-home-dirty' -and [SyntheticPublicTableInput.SendKeys]::Calls -gt 0)
}
function Get-CurrentHeading {
  if ($script:scenario -ceq 'confirmed-home-binding-lost' -and [SyntheticPublicTableInput.SendKeys]::Calls -gt 0) {return 'Changed page'}
  'Synthetic table'
}
# Lost sender results do not establish whether input happened. Keep the
# observed input epoch unchanged for that branch; Dirty/Page doubles exercise
# independent post-input interference through the other public finish branch.
function Get-SSELastInputTick {10+[SyntheticPublicTableInput.SendKeys]::Confirmed}
function Test-SSELastInputUnchanged($Tick) {$Tick -eq (Get-SSELastInputTick)}
function Get-SSEInteractionWindowSet {[pscustomobject]@{fingerprint='stable';windows=@([pscustomobject]@{role='main'})}}
function Test-SSEWindowIsLockScreen {$false}
function Show-SSEWindow {$script:shows++}
function Set-SSEForegroundLeaseInputCheckpoint {$script:checkpoints++}
function Get-SSEPointObstruction {[pscustomobject]@{isBoundTarget=$true}}
function Get-SSETableLiveInputState {
  param($Window,$ProcessId,$Aid,$Rid,[switch]$RequireKeyboard,[switch]$RequireSelection)
  [pscustomobject]@{ok=[bool](-not $RequireKeyboard -or $script:scenario -cin @('lost-home','lost-home-dirty','confirmed-home-then-lost-down','confirmed-home-binding-lost'));
    reason='keyboard-focus-is-not-table-or-cell';focusedType='Edit';selectedRids=@('1.2')}
}
function Test-SSETableReadNumberEditor {$false}
function Test-SSETableReadKeyboardTarget {$true}
function LiesZeilen {$erst}
function Start-Sleep {}
function Get-LiveElement {
  $element=[pscustomobject]@{}
  $element | Add-Member ScriptMethod TryGetCurrentPattern {param($Pattern,$Result) $false}
  $element
}
$WLK=[pscustomobject]@{}
$WLK | Add-Member ScriptMethod GetParent {param($Element) $null}
function Invoke-SSETableReadNumberCellClick {
  param($Window,$ProcessId,$Snapshot,$Tree,$Callbacks)
  $script:numberCalls++
  Assert-True ($Window -eq [IntPtr]111 -and $ProcessId -eq 7 -and $Snapshot -eq $erst -and $Callbacks.Count -eq 5) 'The actual public dispatcher changed the bound number-click callback.'
  if ($script:scenario -ceq 'blocked-number-before-input') {
    return [pscustomobject]@{ok=$false;method='verified-first-number-cell';phase='number-cell-precondition';reason='Synthetic input-free rejection';
      activationSubmitted=$false;physicalInputAttempted=$false;physicalInputUsed=$false;outcomeUnknown=$false;reconciliationRequired=$false;retryable=$false;snapshot=$Snapshot}
  }
  if ($script:scenario -ceq 'confirmed-click-then-lost-home') {
    $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true
    return [pscustomobject]@{ok=$true;method='verified-first-number-cell';phase='number-cell-final-focus';reason='Synthetic confirmed click';
      activationSubmitted=$true;physicalInputAttempted=$true;physicalInputUsed=$true;outcomeUnknown=$false;reconciliationRequired=$false;retryable=$false;snapshot=$Snapshot}
  }
  if ($script:scenario -ceq 'lost-click-interference') {
    $navigationState.failure=[pscustomobject]@{phase='before-number-cell-click';reason='Synthetic binding lost after submission'}
  }
  $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true
  # The real number-click module separately proves this transport-loss shape.
  # This boundary result is deliberately fed through the real dispatcher and
  # public JSON result builder instead of reimplementing their propagation.
  [pscustomobject]@{ok=$false;method='verified-first-number-cell';phase='number-cell-click';reason='Synthetic lost click result';
    activationSubmitted=$true;physicalInputAttempted=$true;physicalInputUsed=$null;outcomeUnknown=$true;reconciliationRequired=$true;retryable=$false;snapshot=$Snapshot}
}
function Emit($Payload) {
  $script:wire=$Payload | ConvertTo-Json -Depth 32 -Compress
  $script:captured=$script:wire | ConvertFrom-Json
  throw 'SSE_PUBLIC_TABLE_RESULT_CAPTURED'
}
function Invoke-PublicScenario([string]$Scenario,[int]$ThrowAt) {
  $script:scenario=$Scenario;$script:captured=$null;$script:wire=$null;$script:shows=0;$script:numberCalls=0;$script:checkpoints=0
  [SW]::Releases=0;[SyntheticPublicTableInput.SendKeys]::Calls=0;[SyntheticPublicTableInput.SendKeys]::Confirmed=0;[SyntheticPublicTableInput.SendKeys]::ThrowAt=$ThrowAt
  $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false;$script:DESKTOP_NAME=''
  $hwnd=[IntPtr]111;$cursorPhase='';$cursorPlan=$null;$a=[pscustomobject]@{noKeys=$false}
  $proof=[pscustomobject]@{complete=$true;editorFree=($Scenario -cne 'active-editor-before-input');heading='Synthetic table';
    tableRootAid='Synthetic.Table';tableRootRid='1.1';tableIdentity='Synthetic.Header';scopePrefix='own';selectionMethod='sum';
    summaryIdentity='Synthetic.Sum';summaryValue='20,00';contentSignature='unchanged'}
  $erst=[pscustomobject]@{kopf=@('Nr.','Betrag');cursorAnchorIsNumber=$true;tabelleAnzahl=1;error=$null;
    ersteZelle=[pscustomobject]@{rid='1.2';aid='Synthetic.Table';type='DataItem';x=10;y=20;w=40;h=24};
    bindung=[pscustomobject]@{sumLabel='Summe'};navigationBinding=$proof;zeilen=@(@('1','20,00'))}
  $latestTableSnapshot=[pscustomobject]@{tree=[pscustomobject]@{nodes=@()}}
  $dirtyBefore=$false;$identityState=[pscustomobject]@{fehlend=$false}
  $gesehen=New-Object 'Collections.Generic.HashSet[string]';$alle=New-Object Collections.ArrayList;$allSemanticRows=New-Object Collections.ArrayList
  $addSnapshotRows={param($Snapshot) };$snapshotIdentities={param($Snapshot) '1.2'};$getCursorSignature={'synthetic-row'}
  $kopf=@('Nr.','Betrag');$echte=@(@('1','10,00'),@('2','10,00'))
  $rowDetails=@([pscustomobject]@{rowIndex=0;typedValues=@('1','10,00')},[pscustomobject]@{rowIndex=1;typedValues=@('2','10,00')})
  $sumLabel='Summe';$summe='20,00';$summen=@([pscustomobject]@{label='Summe';wert='20,00';vorkommen=1})
  $maxSchritte=5
  . $activation
  . $navigation
  . $completion
  try {. $finish} catch {if ($_.Exception.Message -cne 'SSE_PUBLIC_TABLE_RESULT_CAPTURED') {throw}}
  Assert-True ($null -ne $script:captured -and -not $script:captured.ok -and -not $script:captured.vollstaendig) "$Scenario did not produce a public partial-error result."
  Same $script:captured.zeilen $echte "$Scenario lost already observed rows."
  Same $script:captured.rowDetails $rowDetails "$Scenario lost typed observations."
  Same $script:captured.summe '20,00' "$Scenario lost the observed sum."
  Same $script:captured.steps 0 "$Scenario claimed a completed DOWN step after a lost result."
  Same ([SW]::Releases) 1 "$Scenario did not leave the real activation finally exactly once."
  $script:captured
}
function Assert-Uncertain($Result,[bool]$Activation,$Used,[string]$Kind,[int]$Keys,[int]$NumberCalls,[string]$Label) {
  Same $Result.kind $Kind "$Label took the wrong real public finish branch."
  Same $Result.physicalInputAttempted $true "$Label lost physicalInputAttempted."
  Same $Result.physicalInputUsed $Used "$Label changed the three-state physicalInputUsed observation."
  Same $Result.activationSubmitted $Activation "$Label confused cursor activation with navigation input."
  foreach ($name in @('outcomeUnknown','reconciliationRequired','cleanupRequired')) {Same $Result.$name $true "$Label lost $name."}
  Same $Result.retryable $false "$Label became retryable."
  Same ([SyntheticPublicTableInput.SendKeys]::Calls) $Keys "$Label submitted another navigation action."
  Same $script:numberCalls $NumberCalls "$Label replayed or replaced the activation route."
  Same $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS $true "$Label released unproved focus authority."
}

$result=Invoke-PublicScenario 'lost-click' 1
Assert-Uncertain $result $true $null 'cursor-unavailable' 0 1 'Lost click / completedTableRead branch'
$result=Invoke-PublicScenario 'lost-click-interference' 1
Assert-Uncertain $result $true $null 'interference' 0 1 'Lost click / interference branch'
$result=Invoke-PublicScenario 'lost-home' 1
Assert-Uncertain $result $false $null 'cursor-unavailable' 1 0 'Lost first navigation / completedTableRead branch'
$result=Invoke-PublicScenario 'lost-home-dirty' 1
Assert-Uncertain $result $false $null 'interference' 1 0 'Lost first navigation / interference branch'
$result=Invoke-PublicScenario 'confirmed-home-then-lost-down' 2
Assert-Uncertain $result $false $true 'cursor-unavailable' 2 0 'Confirmed Home then lost DOWN'
$result=Invoke-PublicScenario 'confirmed-home-binding-lost' 0
Assert-Uncertain $result $false $true 'interference' 1 0 'Acknowledged navigation then binding loss'
$result=Invoke-PublicScenario 'confirmed-click-then-lost-home' 1
Assert-Uncertain $result $true $true 'cursor-unavailable' 1 1 'Confirmed click then lost navigation'
foreach ($scenarioName in @('blocked-number-before-input','active-editor-before-input')) {
  $result=Invoke-PublicScenario $scenarioName 1
  Same ([SyntheticPublicTableInput.SendKeys]::Calls) 0 "$scenarioName sent a navigation key."
  Same $script:numberCalls $(if ($scenarioName -ceq 'blocked-number-before-input') {1} else {0}) "$scenarioName selected another route."
  foreach ($name in @('physicalInputAttempted','physicalInputUsed','activationSubmitted','outcomeUnknown','reconciliationRequired','cleanupRequired')) {
    $property=$result.PSObject.Properties[$name]
    if ($null -ne $property) {Same $property.Value $false "$scenarioName claimed input or uncertainty without any action."}
  }
}
Write-Output 'Public table_read: real dispatcher and both JSON finish branches preserve attempted/acknowledged/unknown input, terminal outcomes and input-free failures.'
