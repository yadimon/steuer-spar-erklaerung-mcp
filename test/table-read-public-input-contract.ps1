$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$worker=Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($worker,[ref]$null,[ref]$errors)
if ($errors.Count) {throw 'The production worker must parse.'}
foreach ($name in @('Invoke-SSETableReadInitialFocus','Get-SSETableExceptionDiagnostic','Test-SSETableReadHomeSnapshotSemantics')) {
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
$homeGates=@($branches[0].Item2.FindAll({param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
    $node.Clauses[0].Item1.Extent.Text -clike '*-not $cursorPhase*-not $gridRequested*' -and
    $node.Clauses[0].Item2.Extent.Text -clike '*Invoke-SSETableReadHomeSelection*'
},$true))
if ($homeGates.Count -ne 1) {throw 'The production public HOME-selection gate must be unique.'}
$homeGate=[scriptblock]::Create($homeGates[0].Extent.Text)
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
  public static Action<string> OnSend;
  public static void SendWait(string key){Calls++;if(OnSend!=null)OnSend(key);if(Calls==ThrowAt)throw new InvalidOperationException("Synthetic navigation result lost");Confirmed++;}
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
  if ($script:homeCase) {
    $null=$script:events.Add('guard:'+$navigationState.phase)
    if ($script:scenario -ceq 'home-selection-home-guard-failed' -and $navigationState.phase -ceq 'table-read-home-readback') {return 'Changed page'}
  }
  if ($script:scenario -ceq 'confirmed-home-binding-lost' -and [SyntheticPublicTableInput.SendKeys]::Calls -gt 0) {return 'Changed page'}
  'Synthetic table'
}
# Lost sender results do not establish whether input happened. Keep the
# observed input epoch unchanged for that branch; Dirty/Page doubles exercise
# independent post-input interference through the other public finish branch.
function Get-SSELastInputTick {
  if ($script:scenario -ceq 'existing-number-escape-tick-lost' -and [SyntheticPublicTableInput.SendKeys]::Calls -gt 0) {return $null}
  10+[SyntheticPublicTableInput.SendKeys]::Confirmed
}
function Test-SSELastInputUnchanged($Tick) {$Tick -eq (Get-SSELastInputTick)}
function Get-SSEInteractionWindowSet {[pscustomobject]@{fingerprint='stable';windows=@([pscustomobject]@{role='main'})}}
function Test-SSEWindowIsLockScreen {$false}
function Show-SSEWindow {$script:shows++}
function Set-SSEForegroundLeaseInputCheckpoint {$script:checkpoints++}
function Get-SSEPointObstruction {[pscustomobject]@{isBoundTarget=$true}}
function Get-SSETableLiveInputState {
  param($Window,$ProcessId,$Aid,$Rid,[switch]$RequireKeyboard,[switch]$RequireSelection)
  [pscustomobject]@{ok=[bool](-not $RequireKeyboard -or $script:scenario -cin @('lost-home','lost-home-dirty','confirmed-home-then-lost-down','confirmed-home-binding-lost') -or
      $script:homeCase -or
      ($script:scenario.StartsWith('existing-number-escape-',[StringComparison]::Ordinal) -and [SyntheticPublicTableInput.SendKeys]::Calls -gt 0));
    reason='keyboard-focus-is-not-table-or-cell';focusedType='Edit';selectedRids=@('1.2')}
}
function Test-SSETableReadNumberEditor {$script:scenario.StartsWith('existing-number-escape-',[StringComparison]::Ordinal)}
function Test-SSETableReadKeyboardTarget {
  if ($script:homeCase) {
    $null=$script:events.Add('keyboard:'+$navigationState.phase)
    if ($script:scenario -ceq 'home-selection-keyboard-guard-failed' -and $navigationState.phase -ceq 'table-read-home-selection-readback') {return $false}
  }
  -not ($script:scenario -ceq 'existing-number-escape-guard-rejected' -and $navigationState.phase -ceq 'table-read-number-editor-cancel')
}
function LiesZeilen {
  if ($script:homeCase -and [SyntheticPublicTableInput.SendKeys]::Confirmed -gt 0) {
    if ($script:homeSelectionAttempted) {
      $script:alignedReads++;$null=$script:events.Add('read:aligned')
      if ($script:scenario -ceq 'home-selection-provider-lost') {throw 'Synthetic aligned provider result lost'}
      return $script:homeAligned
    }
    $script:topReads++;$null=$script:events.Add('read:top');return $script:homeTop
  }
  if ($script:scenario -ceq 'existing-number-escape-provider-lost' -and [SyntheticPublicTableInput.SendKeys]::Calls -gt 0) {throw 'Synthetic ESC readback provider lost'}
  if ($script:scenario -ceq 'existing-number-escape-readback-failed' -and [SyntheticPublicTableInput.SendKeys]::Calls -gt 0) {
    $changed=$erst | ConvertTo-Json -Depth 10 -Compress | ConvertFrom-Json
    $changed.navigationBinding.contentSignature='changed after ESC'
    return $changed
  }
  $erst
}
function Start-Sleep {param([int]$Milliseconds) if ($script:homeCase) {$null=$script:events.Add('sleep:'+$Milliseconds)}}
function Get-LiveElement {
  if ($script:homeCase) {$null=$script:events.Add('selection:source')}
  $element=[pscustomobject]@{}
  $element | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern,$Result)
    if ($script:homeCase) {$null=$script:events.Add('selection:pattern')}
    $false
  }
  $element
}
$WLK=[pscustomobject]@{}
$WLK | Add-Member ScriptMethod GetParent {param($Element) $null}
function Invoke-SSETableReadHomeSelection {
  param($Window,$ProcessId,$Snapshot,$Tree,$InputTick,$WindowFingerprint,$ExpectedDirty)
  $script:homeSelectionCalls++
  if (-not $script:homeCase) {return [pscustomobject]@{ok=$true;attempted=$false;reason='synthetic-not-needed'}}
  $null=$script:events.Add('home:selection')
  Assert-True ($Window -eq [IntPtr]111 -and $ProcessId -eq 7 -and
    [object]::ReferenceEquals($Snapshot,$script:homeTop) -and
    [object]::ReferenceEquals($navigationState.snapshot,$script:homeTop) -and
    [object]::ReferenceEquals($Tree,$latestTableSnapshot.tree) -and
    $InputTick -eq 11 -and $WindowFingerprint -ceq 'stable' -and $ExpectedDirty -eq $false) 'The real HOME-selection boundary lost its fresh snapshot or original context.'
  # The footer contract exercises the actual selection helper. This double
  # controls only its outcome; the dispatcher snapshot/semantic proofs are real.
  if ($script:scenario -cin @('home-selection-helper-rejected','home-selection-null-tree')) {
    return [pscustomobject]@{ok=$false;attempted=$false;reason='synthetic-home-source-unbound'}
  }
  $script:homeSelectionAttempted=$script:scenario -cne 'home-selection-not-needed'
  [pscustomobject]@{ok=($script:scenario -cne 'home-selection-helper-lost');attempted=$script:homeSelectionAttempted;reason='synthetic-home-selection-result'}
}
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
  $script:homeCase=$Scenario.StartsWith('home-selection-',[StringComparison]::Ordinal)
  $script:homeSelectionCalls=0;$script:homeSelectionAttempted=$false;$script:topReads=0;$script:alignedReads=0
  $script:events=New-Object Collections.ArrayList
  [SyntheticPublicTableInput.SendKeys]::OnSend={param($Key) $null=$script:events.Add('send:'+$Key)}
  [SW]::Releases=0;[SyntheticPublicTableInput.SendKeys]::Calls=0;[SyntheticPublicTableInput.SendKeys]::Confirmed=0;[SyntheticPublicTableInput.SendKeys]::ThrowAt=$ThrowAt
  $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false;$script:DESKTOP_NAME=''
  $hwnd=[IntPtr]111;$cursorPhase='';$cursorPlan=$null;$gridRequested=$false;$a=[pscustomobject]@{noKeys=$false}
  $proof=[pscustomobject]@{complete=$true;editorFree=($Scenario -cne 'active-editor-before-input');heading='Synthetic table';
    tableRootAid='Synthetic.Table';tableRootRid='1.1';tableIdentity='Synthetic.Header';scopePrefix='own';selectionMethod='sum';
    summaryIdentity='Synthetic.Sum';summaryValue='20,00';contentSignature='unchanged'}
  $erst=[pscustomobject]@{kopf=@('Nr.','Betrag');cursorAnchorIsNumber=$true;tabelleAnzahl=1;error=$null;
    ersteZelle=[pscustomobject]@{rid='1.2';aid='Synthetic.Table';type='DataItem';x=10;y=20;w=40;h=24};
    bindung=[pscustomobject]@{sumLabel='Summe'};navigationBinding=$proof;zeilen=@(@('1','20,00'))}
  $latestTableSnapshot=[pscustomobject]@{tree=[pscustomobject]@{nodes=@()}}
  if ($script:homeCase) {
    $erst.kopf=@('Nr.','Betrag','N');$erst.zeilen=@(,@('1','20,00',''))
    $erst | Add-Member NoteProperty zeilenMitIdentitaet @([pscustomobject]@{semanticCells=@(
      [pscustomobject]@{ok=$true;error=$null;type='text';value='1';checkboxState=$null},
      [pscustomobject]@{ok=$true;error=$null;type='text';value='20,00';checkboxState=$null},
      [pscustomobject]@{ok=$true;error=$null;type='boolean';value=$false;checkboxState='Off'}
    )})
    $script:homeTop=$erst | ConvertTo-Json -Depth 20 -Compress | ConvertFrom-Json
    $script:homeAligned=$erst | ConvertTo-Json -Depth 20 -Compress | ConvertFrom-Json
    switch -Exact ($Scenario) {
      'home-selection-raw-changed' {$script:homeAligned.zeilen[0][1]='21,00';$script:homeAligned.navigationBinding.contentSignature='changed'}
      'home-selection-typed-changed' {$script:homeAligned.zeilenMitIdentitaet[0].semanticCells[1].value='21,00'}
      'home-selection-checkbox-changed' {$script:homeAligned.zeilenMitIdentitaet[0].semanticCells[2].checkboxState='On'}
      'home-selection-invalid-semantic' {$script:homeAligned.zeilenMitIdentitaet[0].semanticCells[2].ok='true'}
      'home-selection-null-tree' {$latestTableSnapshot.tree=$null}
    }
  }
  $dirtyBefore=$false;$identityState=[pscustomobject]@{fehlend=$false}
  $gesehen=New-Object 'Collections.Generic.HashSet[string]';$alle=New-Object Collections.ArrayList;$allSemanticRows=New-Object Collections.ArrayList
  $addSnapshotRows={param($Snapshot)
    if ($script:homeCase) {
      $null=$script:events.Add('rows:add')
      $expected=$(if ($script:homeSelectionAttempted) {$script:homeAligned} else {$script:homeTop})
      Assert-True ([object]::ReferenceEquals($Snapshot,$expected) -and [object]::ReferenceEquals($navigationState.snapshot,$expected)) 'Rows were collected from the pre-alignment snapshot.'
    }
  }
  $snapshotIdentities={param($Snapshot) '1.2'}
  $getCursorSignature={if ($script:homeCase) {$null=$script:events.Add('cursor:signature')};'synthetic-row'}
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
foreach ($escapeScenario in @(
  [pscustomobject]@{name='existing-number-escape-lost-send';throwAt=1;used=$null;kind='cursor-unavailable';unknown=$true;keys=1;reason='number-editor-cancel-failed'},
  [pscustomobject]@{name='existing-number-escape-tick-lost';throwAt=0;used=$null;kind='interference';unknown=$true;keys=1;reason='number-editor-cancel-unproven'},
  [pscustomobject]@{name='existing-number-escape-readback-failed';throwAt=0;used=$true;kind='cursor-unavailable';unknown=$true;keys=1;reason='number-editor-cancel-unproven'},
  [pscustomobject]@{name='existing-number-escape-provider-lost';throwAt=0;used=$true;kind='cursor-unavailable';unknown=$true;keys=1;reason='number-editor-cancel-failed'},
  [pscustomobject]@{name='existing-number-escape-success-then-home-lost';throwAt=2;used=$true;kind='cursor-unavailable';unknown=$false;keys=2;reason='unchanged-number-editor-cancelled'}
)) {
  $result=Invoke-PublicScenario $escapeScenario.name $escapeScenario.throwAt
  Assert-Uncertain $result $true $escapeScenario.used $escapeScenario.kind $escapeScenario.keys 0 $escapeScenario.name
  Same $result.cursorActivation.phase 'number-editor-cancel' "$($escapeScenario.name) lost exact action diagnostics."
  Same $result.cursorActivation.reason $escapeScenario.reason "$($escapeScenario.name) replaced the ESC action outcome."
  foreach ($name in @('activationSubmitted','physicalInputAttempted','escapeSubmitted')) {
    Same $result.cursorActivation.$name $true "$($escapeScenario.name) lost per-ESC $name."
  }
  Same $result.cursorActivation.physicalInputUsed $escapeScenario.used "$($escapeScenario.name) confused ESC input with later navigation."
  Same $result.cursorActivation.outcomeUnknown $escapeScenario.unknown "$($escapeScenario.name) replaced per-ESC uncertainty with whole-read uncertainty."
  Same $result.cursorActivation.reconciliationRequired $escapeScenario.unknown "$($escapeScenario.name) lost per-ESC reconciliation."
  Same $result.cursorActivation.retryable $false "$($escapeScenario.name) allowed ESC replay."
}
$result=Invoke-PublicScenario 'existing-number-escape-guard-rejected' 1
Same $result.kind 'interference' 'Pre-ESC guard rejection lost the public binding failure.'
Same ([SyntheticPublicTableInput.SendKeys]::Calls) 0 'Rejected ESC precondition submitted input.'
Same $script:numberCalls 0 'Rejected ESC precondition tried the number-cell click route.'
foreach ($name in @('activationSubmitted','physicalInputAttempted','physicalInputUsed','escapeSubmitted','outcomeUnknown','reconciliationRequired')) {
  Same $result.cursorActivation.$name $false "Rejected ESC precondition claimed per-action $name."
}
foreach ($name in @('activationSubmitted','physicalInputAttempted','physicalInputUsed','outcomeUnknown','reconciliationRequired','cleanupRequired')) {
  Same $result.$name $false "Rejected ESC precondition changed the public input union for $name."
}

function Home-Order {
  # Keep provider/setup calls in the full trace while comparing only the
  # relevant production sequence. Duplicate relevant events still fail.
  @($script:events | Where-Object {$_ -cin @(
    'send:^{HOME}','sleep:350','read:top','guard:table-read-home-readback','home:selection','read:aligned',
    'guard:table-read-home-selection-readback','keyboard:table-read-home-selection-readback',
    'rows:add','selection:source','selection:pattern','cursor:signature','send:{DOWN}'
  )})
}
$homePrefix=@('send:^{HOME}','sleep:350','read:top','guard:table-read-home-readback')
$cursorSuffix=@('rows:add','selection:source','selection:pattern','cursor:signature','send:{DOWN}')
foreach ($homeScenario in @('home-selection-not-needed','home-selection-needed','home-selection-null-tree')) {
  # Stop at the first DOWN submission after proving successful initialization;
  # the real catch and JSON finish must preserve the acknowledged HOME input.
  $result=Invoke-PublicScenario $homeScenario 2
  Assert-Uncertain $result $false $true 'cursor-unavailable' 2 0 $homeScenario
  Same $script:topReads 1 "$homeScenario repeated the HOME viewport read."
  $attempted=$homeScenario -ceq 'home-selection-needed'
  Same $script:alignedReads $(if ($attempted) {1} else {0}) "$homeScenario changed the conditional readback count."
  Same $script:homeSelectionCalls $(if ($homeScenario -ceq 'home-selection-null-tree') {0} else {1}) "$homeScenario changed the public phase route."
  $expected=@($homePrefix)
  if ($homeScenario -cne 'home-selection-null-tree') {$expected+='home:selection'}
  if ($attempted) {$expected+=@('read:aligned','guard:table-read-home-selection-readback','keyboard:table-read-home-selection-readback')}
  $expected+=$cursorSuffix
  Same (Home-Order) $expected "$homeScenario read, proved or navigated in the wrong order."
}
foreach ($homeFailure in @(
  [pscustomobject]@{name='home-selection-helper-rejected';kind='interference';phase='table-read-home-selection';read=0},
  [pscustomobject]@{name='home-selection-helper-lost';kind='interference';phase='table-read-home-selection';read=0},
  [pscustomobject]@{name='home-selection-provider-lost';kind='cursor-unavailable';phase=$null;read=1},
  [pscustomobject]@{name='home-selection-raw-changed';kind='interference';phase='table-read-home-selection-readback';read=1},
  [pscustomobject]@{name='home-selection-typed-changed';kind='interference';phase='table-read-home-selection-readback';read=1},
  [pscustomobject]@{name='home-selection-checkbox-changed';kind='interference';phase='table-read-home-selection-readback';read=1},
  [pscustomobject]@{name='home-selection-invalid-semantic';kind='interference';phase='table-read-home-selection-readback';read=1},
  [pscustomobject]@{name='home-selection-keyboard-guard-failed';kind='interference';phase='table-read-home-selection-readback';read=1},
  [pscustomobject]@{name='home-selection-home-guard-failed';kind='interference';phase='table-read-home-readback';read=0}
)) {
  $result=Invoke-PublicScenario $homeFailure.name 0
  Assert-Uncertain $result $false $true $homeFailure.kind 1 0 $homeFailure.name
  Same $script:topReads 1 "$($homeFailure.name) repeated HOME readback."
  Same $script:alignedReads $homeFailure.read "$($homeFailure.name) retried or omitted the conditional readback."
  Same $script:homeSelectionCalls $(if ($homeFailure.name -ceq 'home-selection-home-guard-failed') {0} else {1}) "$($homeFailure.name) retried or bypassed the selection phase."
  foreach ($event in $cursorSuffix) {
    Assert-True (-not ($script:events -ccontains $event)) "$($homeFailure.name) continued with $event after a failed HOME proof."
  }
  if ($null -ne $homeFailure.phase) {
    Same $result.navigationEvidence.phase $homeFailure.phase "$($homeFailure.name) lost its actual terminal phase."
  }
}

# Execute the exact production gate separately for routes whose earlier
# dispatcher branches have different setup/transport. A skipped gate must
# neither ask the selection helper nor perform an additional table read.
foreach ($excluded in @('private','grid','noKeys','non-number','null-tree')) {
  $script:homeSelectionCalls=0;$script:alignedReads=0;$script:topReads=0
  $cursorPhase=$(if ($excluded -ceq 'private') {'native-step'} else {''})
  $gridRequested=$excluded -ceq 'grid';$a=[pscustomobject]@{noKeys=($excluded -ceq 'noKeys')}
  $topSnapshot=[pscustomobject]@{cursorAnchorIsNumber=($excluded -cne 'non-number')}
  $latestTableSnapshot=[pscustomobject]@{tree=$(if ($excluded -ceq 'null-tree') {$null} else {[pscustomobject]@{nodes=@()}})}
  . $homeGate
  Same $script:homeSelectionCalls 0 "$excluded entered the new public HOME-selection phase."
  Same $script:alignedReads 0 "$excluded requested an alignment readback."
  Same $script:topReads 0 "$excluded requested a table read from the isolated gate."
}
Write-Output 'Public table_read: actual dispatcher and JSON finish preserve input uncertainty; HOME selection is bounded, semantically verified, ordered before signature/DOWN, and excluded from private/Grid/noKeys/null-tree routes.'
