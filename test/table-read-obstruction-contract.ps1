param([string]$WorkerPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'powershell\sse-worker.ps1'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($WorkerPath,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Worker cannot be parsed.' }
$diagnosticHelper=@($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -ceq 'Get-SSETableExceptionDiagnostic'
},$true))
if ($diagnosticHelper.Count -ne 1) { throw 'Expected one real cursor exception diagnostic helper.' }
. ([scriptblock]::Create($diagnosticHelper[0].Extent.Text))
$clauses=@($ast.FindAll({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] },$true) |
  ForEach-Object { $_.Clauses } | Where-Object { $_.Item1.Extent.Text -ceq "'table_read'" })
if ($clauses.Count -ne 1) { throw 'Expected one real table_read dispatcher branch.' }
$statements=@($clauses[0].Item2.Statements)
function StatementIndex([string]$Prefix) {
  $matches=@(for($index=0;$index -lt $statements.Count;$index++) {
    if ($statements[$index].Extent.Text.StartsWith($Prefix,[StringComparison]::Ordinal)) { $index }
  })
  if ($matches.Count -ne 1) { throw ('Expected one statement: '+$Prefix) }
  [int]$matches[0]
}
$activationStart=StatementIndex '$geklickt ='
$stepsStart=StatementIndex '$schritte ='
$finishStart=StatementIndex '$dirtyAfter ='
$activationText=($statements[$activationStart..($stepsStart-1)].Extent.Text -join "`n")
# A distinct fixture namespace cannot bind the real framework SendKeys type.
$activation=[scriptblock]::Create($activationText.Replace('[System.Windows.Forms.SendKeys]','[SyntheticCursorInput.SendKeys]'))
$completionNodes=@(
  $statements[(StatementIndex '$limitReached =')],
  $statements[(StatementIndex '$vollstaendig =')],
  $statements[(StatementIndex '$stopKind =')]
)
$completion=[scriptblock]::Create(($completionNodes.Extent.Text -join "`n"))
$finish=[scriptblock]::Create(($statements[$finishStart..($statements.Count-1)].Extent.Text -join "`n"))
$finalReadStart=StatementIndex '$vollstaendigerCursorbeweis ='
$limitStart=StatementIndex '$limitReached ='
if ($limitStart -le $finalReadStart) { throw 'Finaler Tabellenread steht nicht vor dem Abschlussbeweis.' }
$finalRead=[scriptblock]::Create(($statements[$finalReadStart..($limitStart-1)].Extent.Text -join "`n"))
$tableBranch=$clauses[0].Item2.Extent.Text
$lastAdd=$tableBranch.IndexOf('& $addSnapshotRows $snapshot',[StringComparison]::Ordinal)
$endProof=$tableBranch.IndexOf('$endProven = $true',[StringComparison]::Ordinal)
if ($lastAdd -lt 0 -or $endProof -le $lastAdd) {
  throw 'Der letzte Viewport muss vor dem Tabellen-Endbeweis aufgenommen werden.'
}

# No Win32 imports. These counters make any physical-input attempt a failure.
# The old activation block also runs against these doubles for the regression.
Add-Type -TypeDefinition @'
using System;
public static class SW {
  public struct PT { public int X; public int Y; }
  public static int InputCalls;
  public static int Releases;
  public static int HitPid;
  public static IntPtr HitRoot;
  public static int Foreground = 111;
  public static IntPtr GetForegroundWindow() { return new IntPtr(Foreground); }
  public static IntPtr WindowFromPoint(PT point) { return new IntPtr(222); }
  public static IntPtr GetAncestor(IntPtr handle, int flags) { return HitRoot; }
  public static int GetWindowThreadProcessId(IntPtr handle, out int pid) {
    pid = handle.ToInt64() == 111 ? 7 : HitPid; return 1;
  }
  public static bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, int flags) {
    Releases++; return true;
  }
  public static bool SetCursorPos(int x, int y) { InputCalls++; throw new Exception("Unexpected physical input"); }
  public static void mouse_event(int flags, int x, int y, int data, IntPtr extra) {
    InputCalls++; throw new Exception("Unexpected physical input");
  }
}
namespace SyntheticCursorInput {
  public static class SendKeys {
    public static int Calls;
    public static void SendWait(string key) { Calls++; }
  }
}
namespace System.Windows.Automation {
  public static class AutomationElement { public static object FocusedElement; }
  public static class ControlType { public static string Table="Table"; public static string DataGrid="DataGrid"; public static string Header="Header"; }
  public static class ValuePattern { public static object Pattern=new object(); }
}
'@
function Same($Actual,$Expected,[string]$Message) {
  if (($Actual | ConvertTo-Json -Depth 10 -Compress) -cne ($Expected | ConvertTo-Json -Depth 10 -Compress)) { throw $Message }
}
function Run-FinalReadCase([string]$Name,[bool]$Clicked,[bool]$EndProven,[int]$Steps,[int]$MaxSteps,
                           [bool]$CursorUnavailable,[bool]$IdentityMissing,[bool]$ReadError,[int]$ExpectedReads) {
  $script:finalReadCalls=0; $script:finalAdds=0; $script:finalReadError=$ReadError
  $hwnd=[IntPtr]111; $geklickt=$Clicked; $endProven=$EndProven
  $schritte=$Steps; $maxSchritte=$MaxSteps; $cursorUnavailable=$CursorUnavailable
  $identityState=[pscustomobject]@{ fehlend=$IdentityMissing }
  $addSnapshotRows={ param($snapshot) $script:finalAdds++ }
  $proof=[pscustomobject]@{complete=$true;heading='Synthetic';tableIdentity='Synthetic.Header';scopePrefix='';selectionMethod='';summaryIdentity='Synthetic.Sum';summaryValue='0,00';contentSignature='initial'}
  $erst=[pscustomobject]@{navigationBinding=$proof;tabelleAnzahl=1;error=$null}
  $navigationState=[pscustomobject]@{failure=$null}
  $readNavigationGuard={ param($Phase) $true }
  function LiesZeilen($Window) {
    $script:finalReadCalls++
    [pscustomobject]@{ error=$(if ($script:finalReadError) { 'read failed' } else { $null });navigationBinding=$proof;tabelleAnzahl=1 }
  }
  . $finalRead
  Same $script:finalReadCalls $ExpectedReads "$Name`: falsche Anzahl finaler Viewport-Reads."
  Same $script:finalAdds $(if ($ReadError) { 0 } else { $ExpectedReads }) `
    "$Name`: finaler Viewport wurde trotz Lesefehler uebernommen oder trotz Erfolg verworfen."
}

Run-FinalReadCase 'vollstaendiger Endbeweis' $true $true 9 10 $false $false $false 0
Run-FinalReadCase 'max-rows' $true $true 10 10 $false $false $false 1
Run-FinalReadCase 'Cursor fehlt' $true $true 9 10 $true $false $false 1
Run-FinalReadCase 'Zeilenidentitaet fehlt' $true $true 9 10 $false $true $false 1
Run-FinalReadCase 'Ende nicht bewiesen' $true $false 9 10 $false $false $false 1
Run-FinalReadCase 'finaler Lesefehler' $true $false 9 10 $false $false $true 1
Run-FinalReadCase 'kein Cursor aktiviert' $false $false 0 10 $false $false $false 0
function Run-Observation([bool]$NoKeys,[string]$BlockerKind,[int]$HitPid,[int]$HitRoot,[bool]$ActiveEditor=$false,[bool]$CursorActivationFails=$false,[bool]$IdentityMissing=$false,[int]$TableCount=1) {
  [SW]::InputCalls=0; [SW]::Releases=0; [SW]::HitPid=$HitPid; [SW]::HitRoot=[IntPtr]$HitRoot
  $script:pointQueries=0; $script:raises=0; $script:captured=$null
  $hwnd=[IntPtr]111; $a=@{noKeys=$NoKeys}
  $proof=[pscustomobject]@{complete=$true;editorFree=$true;tableRootAid='Synthetic.Table';tableRootRid='10.1';heading='Synthetic';tableIdentity='Synthetic.Header';scopePrefix='';selectionMethod='';summaryIdentity='Synthetic.Sum';summaryValue='20,00';contentSignature='initial'}
  $proof.editorFree=-not $ActiveEditor
  $erst=[pscustomobject]@{ersteZelle=[pscustomobject]@{x=10;y=20;w=40;h=24};tabelleAnzahl=1;bindung=[pscustomobject]@{sumLabel='Summe'};navigationBinding=$proof}
  $erst.tabelleAnzahl=$TableCount
  $script:pointObservation=[pscustomobject]@{
    isBoundTarget=$CursorActivationFails; blockerKind=$BlockerKind; processName='SyntheticBlocker'; className='SyntheticWindow'
    boundWindow=111;boundPid=7;hitWindow=222;hitRoot=$HitRoot;hitPid=$HitPid
    point=[pscustomobject]@{x=30;y=32}
  }
  function Arg($Arguments,$Name,$Default=$null) { $Arguments[$Name] }
  function Show-SSEWindow($Window) { $script:raises++ }
  function Get-SSELastInputTick { 10 }
  function Test-SSELastInputUnchanged($Tick) { $Tick -eq 10 }
  function Test-SSEWindowIsLockScreen($Window) { $false }
  function Get-SSEInteractionWindowSet($ProcessId,$Window) { [pscustomobject]@{fingerprint='stable';windows=@([pscustomobject]@{role='main'})} }
  function Get-CurrentHeading($Window) { 'Synthetic' }
  function LiesZeilen($Window) { $erst }
  function Start-Sleep([int]$Milliseconds) { }
  function Get-SSEPointObstruction($Window,$X,$Y) {
    Same ([int64]$Window) 111 'Wrong bound window.'
    Same @($X,$Y) @(30,32) 'Wrong cell point.'
    $script:pointQueries++; $script:pointObservation
  }
  function Get-DirtyStateFast($Window) { $false }
  function Get-SSETableLiveInputState { [pscustomobject]@{ok=$true;editorClosed=$true} }
  function Get-LiveElement { throw 'Synthetic table anchor cannot be resolved.' }
  function Emit($Result) { $script:captured=$Result; throw 'SSE_TEST_CAPTURED_RESULT' }
  $kopf=@('Datum','N','Betrag')
  $echte=@(@('15.01','', '10,00'),@('15.01','', '10,00'))
  $rowDetails=@(
    [pscustomobject]@{rowIndex=0;typedValues=@('15.01',$false,'10,00');semanticsComplete=$true},
    [pscustomobject]@{rowIndex=1;typedValues=@('15.01',$true,'10,00');semanticsComplete=$true}
  )
  $sumLabel='Summe'; $summe='20,00'; $summen=@([pscustomobject]@{label='Summe';wert='20,00';vorkommen=1})
  $dirtyBefore=$false; $identityState=@{fehlend=$IdentityMissing}; $endProven=$false
  $schritte=0; $maxSchritte=100; $stapel=0; $stapelGroesse=1; $stapelKorrekturen=0
  . $activation
  . $completion
  try { . $finish } catch { if ($_.Exception.Message -cne 'SSE_TEST_CAPTURED_RESULT') { throw } }
  Same ([SW]::InputCalls) 0 'Blocked or explicit visible-only read attempted physical input.'
  Same $script:captured.zeilen $echte 'Partial rows changed, including duplicates.'
  Same $script:captured.rowDetails $rowDetails 'Typed checkbox observations were lost.'
  Same $script:captured.summe $summe 'Observed sum was lost.'
  Same $script:captured.vollstaendig $false 'Unproven end was reported complete.'
  Same $script:captured.steps 0 'Blocked read must not send navigation keys.'
  Same $script:captured.ungespeichertEingefuehrt $false 'Read introduced dirty state.'
  [pscustomobject]@{result=$script:captured;pointQueries=$script:pointQueries;raises=$script:raises;releases=[SW]::Releases}
}

foreach($case in @(
  [pscustomobject]@{kind='foreign-app';pid=8;root=222},
  [pscustomobject]@{kind='same-process-other-window';pid=7;root=222}
)) {
  $blocked=Run-Observation $false $case.kind $case.pid $case.root
  Same $blocked.result.kind 'obstructed' 'Blocked table activation must be reported as obstructed.'
  Same $blocked.result.ok $false 'A blocked full read must be a failed operation.'
  Same $blocked.result.stopKind 'obstructed' 'Stop cause was hidden as visible-only.'
  Same $blocked.result.obstruction $script:pointObservation 'Point obstruction evidence changed.'
  Same @($blocked.pointQueries,$blocked.raises,$blocked.releases) @(1,1,1) 'Activation or cleanup count differs.'
  Same @($blocked.result.cursorActivation.reason,$blocked.result.cursorActivation.exceptionType,
    $blocked.result.cursorActivation.exceptionMessage,$blocked.result.cursorActivation.errorRecord) @($null,$null,$null,$null) `
    'Point obstruction was replaced or obscured by an unrelated activation exception.'
}
$visible=Run-Observation $true 'foreign-app' 8 222
Same $visible.result.ok $true 'Explicit noKeys read stopped working.'
Same $visible.result.stopKind 'visible-only' 'Explicit noKeys read changed scope.'
Same @($visible.pointQueries,$visible.raises,$visible.releases) @(0,0,0) 'Explicit noKeys read touched the foreground.'
Same $visible.result.obstruction $null 'NoKeys result invented an obstruction.'
Same @($visible.result.cursorActivation.reason,$visible.result.cursorActivation.exceptionType,
  $visible.result.cursorActivation.exceptionMessage,$visible.result.cursorActivation.errorRecord) @($null,$null,$null,$null) `
  'Explicit noKeys read unexpectedly entered the activation catch.'
$unavailable=Run-Observation $false 'cursor-unavailable' 7 111 $false $true
Same $unavailable.result.ok $false 'A failed full cursor read was reported as success.'
Same $unavailable.result.kind 'cursor-unavailable' 'A failed full cursor read lost its failure kind.'
Same $unavailable.result.stopKind 'cursor-unavailable' 'A failed full cursor read lost its stop cause.'
Same $unavailable.result.cursorActivation.reason 'cursor-activation-exception' 'A failed full cursor read lost its reason.'
if ($unavailable.result.error -notlike 'Vollstaendiger Tabellenlauf*') {throw 'Full cursor failure has no explicit full-read error.'}
Same $unavailable.result.cursorActivation.exceptionMessage 'Synthetic table anchor cannot be resolved.' `
  'A failed full cursor read lost its precise activation diagnostic.'
Same @($unavailable.pointQueries,$unavailable.raises,$unavailable.releases) @(1,1,1) `
  'Cursor failure performed an unexpected activation or cleanup.'
$missingIdentity=Run-Observation $true 'identity-unavailable' 7 111 $false $false $true
Same $missingIdentity.result.ok $false 'An unbound row inventory was reported as success.'
Same $missingIdentity.result.kind 'row-identity-unavailable' 'An unbound inventory lost its failure kind.'
if ($missingIdentity.result.error -notlike 'Zeilenidentitaet des sichtbaren Teilbestands*') {
  throw 'Passive identity failure claimed an attempted full cursor read.'
}
Same @($missingIdentity.pointQueries,$missingIdentity.raises,$missingIdentity.releases) @(0,0,0) `
  'A passive identity failure attempted foreground input.'
$ambiguousIdentity=Run-Observation $false 'ambiguous-table' 7 111 $false $false $true 2
Same $ambiguousIdentity.result.ok $false 'Passive ambiguous-table inventory lost its identity failure.'
Same $ambiguousIdentity.result.kind 'row-identity-unavailable' 'Passive ambiguity hid a missing identity.'
Same $ambiguousIdentity.result.error $missingIdentity.result.error 'Passive ambiguity claimed an attempted cursor run.'
Same @($ambiguousIdentity.pointQueries,$ambiguousIdentity.raises,$ambiguousIdentity.releases) @(0,0,0) `
  'Passive ambiguous table attempted cursor activation.'

# Execute the real completion/finish slices for failures AFTER cursor steps.
# Intentional truncation must stay successful; a simultaneous proof failure
# has priority and must retain all already observed rows and typed values.
function Get-DirtyStateFast($Window) { $false }
function Emit($Result) { $script:captured=$Result;throw 'SSE_TEST_CAPTURED_RESULT' }
function Arg($Arguments,$Name,$Default=$null) { $Arguments[$Name] }
foreach ($scenario in @(
  [pscustomobject]@{name='bounded-partial';cursor=$false;identity=$false;steps=10;kind='max-rows';failureKind=$null;error=$null;hint='*bewusst als unvollstaendig*';ok=$true},
  [pscustomobject]@{name='cursor-after-steps';cursor=$true;identity=$false;steps=4;kind='cursor-unavailable';failureKind='cursor-unavailable';error='Vollstaendiger Tabellenlauf*';hint='*nicht sicher beweisbar*';ok=$false},
  [pscustomobject]@{name='identity-after-steps';cursor=$false;identity=$true;steps=4;kind='row-identity-unavailable';failureKind='row-identity-unavailable';error='Vollstaendiger Tabellenlauf*';hint='*nicht sicher beweisbar*';ok=$false},
  [pscustomobject]@{name='cursor-at-limit';cursor=$true;identity=$false;steps=10;kind='cursor-unavailable';failureKind='cursor-unavailable';error='Vollstaendiger Tabellenlauf*';hint='*nicht sicher beweisbar*';ok=$false},
  [pscustomobject]@{name='identity-at-limit';cursor=$false;identity=$true;steps=10;kind='row-identity-unavailable';failureKind='row-identity-unavailable';error='Vollstaendiger Tabellenlauf*';hint='*nicht sicher beweisbar*';ok=$false},
  [pscustomobject]@{name='both-at-limit';cursor=$true;identity=$true;steps=10;kind='row-identity-unavailable';failureKind='row-identity-unavailable';error='Vollstaendiger Tabellenlauf*';hint='*nicht sicher beweisbar*';ok=$false}
)) {
  $script:captured=$null;$hwnd=[IntPtr]111;$a=@{noKeys=$false}
  $geklickt=$true;$cursorUnavailable=$scenario.cursor;$identityState=@{fehlend=$scenario.identity}
  $endProven=$false;$schritte=$scenario.steps;$maxSchritte=10;$stapel=1;$stapelGroesse=1;$stapelKorrekturen=0
  $dirtyBefore=$false;$navigationState=[pscustomobject]@{failure=$null};$readNavigationGuard={param($Phase) $true}
  $erst=[pscustomobject]@{tabelleAnzahl=1;ersteZelle=[pscustomobject]@{};bindung=[pscustomobject]@{sumLabel='Summe'}}
  $kopf=@('Datum','N','Betrag');$echte=@(@('15.01','','10,00'),@('15.01','','10,00'))
  $rowDetails=@([pscustomobject]@{rowIndex=0;typedValues=@('15.01',$false,'10,00')},
    [pscustomobject]@{rowIndex=1;typedValues=@('15.01',$true,'10,00')})
  $summe='20,00';$summen=@([pscustomobject]@{label='Summe';wert=$summe;vorkommen=1})
  $cursorActivation=[pscustomobject]@{reason='observed-cursor-proof-failure'}
  . $completion
  try {. $finish} catch {if($_.Exception.Message -cne 'SSE_TEST_CAPTURED_RESULT'){throw}}
  Same $script:captured.ok $scenario.ok "$($scenario.name): incorrect success flag."
  Same $script:captured.stopKind $scenario.kind "$($scenario.name): incorrect stop cause."
  Same $script:captured.kind $scenario.failureKind "$($scenario.name): incorrect failure kind."
  Same $script:captured.steps $scenario.steps "$($scenario.name): lost traversed steps."
  Same $script:captured.zeilen $echte "$($scenario.name): lost observed duplicate rows."
  Same $script:captured.rowDetails $rowDetails "$($scenario.name): lost typed observations."
  Same $script:captured.summe $summe "$($scenario.name): lost observed sum."
  Same $script:captured.limitReached ($scenario.steps -eq 10) "$($scenario.name): lost limit evidence."
  Same $script:captured.vollstaendig $false "$($scenario.name): unproven inventory claimed completion."
  Same ([string]$script:captured.error -like [string]$scenario.error) $true "$($scenario.name): incorrect error wording."
  Same ($script:captured.hinweis -like $scenario.hint) $true "$($scenario.name): incorrect partial-read hint."
}
$activeBeforeFocus=Run-Observation $false 'active-editor' 7 111 $true
Same @($activeBeforeFocus.pointQueries,$activeBeforeFocus.raises) @(0,0) 'Reader touched focus or cell points before rejecting an active editor.'
Same $activeBeforeFocus.result.kind 'interference' 'An active editor was not a fail-closed cursor precondition.'
Same $activeBeforeFocus.result.navigationEvidence.reason 'active-or-unbound-table-editor' `
  'Active-editor rejection was replaced by a different failure.'
Same $activeBeforeFocus.result.navigationEvidence.phase 'before-focus' 'Active editor was rejected after taking focus.'
Same $activeBeforeFocus.result.cursorActivation.reason 'cursor-activation-exception' 'Active-editor catch reason was lost.'
Same $activeBeforeFocus.result.cursorActivation.exceptionType 'RuntimeException' 'Active-editor exception classification changed.'
Same $activeBeforeFocus.result.cursorActivation.exceptionMessage `
  'Tabellenleser darf keinen aktiven oder ungebundenen Zell-Editor durch Fokuswechsel beenden.' `
  'Diagnostic helper hid the actual active-editor guard failure.'
Same $activeBeforeFocus.result.cursorActivation.errorRecord.category 'OperationStopped' 'Active-editor ErrorRecord was not preserved.'

# The actual guard and key-loop blocks run with a synthetic SendKeys type;
# none of these checks import Win32 or send input to any desktop.
foreach ($mode in @('stable','input','foreground','windows','dirty','page','keyboard-or-summary','active-editor')) {
  $hwnd=[IntPtr]111; $a=@{noKeys=$true}; $dirtyBefore=$false
  [SW]::Foreground=111; [SyntheticCursorInput.SendKeys]::Calls=0
  $script:guardMode=$mode
  $erst=[pscustomobject]@{ersteZelle=$null;tabelleAnzahl=1;navigationBinding=[pscustomobject]@{heading='Synthetic';editorFree=$true;tableRootAid='Synthetic.Table';tableRootRid='10.1'}}
  function Get-SSELastInputTick {
    if ($script:guardMode -eq 'foreground' -and [SyntheticCursorInput.SendKeys]::Calls -gt 0) { [SW]::Foreground=222 }
    10 + [SyntheticCursorInput.SendKeys]::Calls
  }
  function Test-SSELastInputUnchanged($Tick) {
    $Tick -eq (Get-SSELastInputTick) -and -not ($script:guardMode -eq 'input' -and [SyntheticCursorInput.SendKeys]::Calls -gt 0)
  }
  function Get-SSEInteractionWindowSet($ProcessId,$Window) {
    [pscustomobject]@{fingerprint=$(if ($script:guardMode -eq 'windows' -and [SyntheticCursorInput.SendKeys]::Calls -gt 0) {'changed'} else {'stable'})}
  }
  function Get-CurrentHeading($Window) {
    if ($script:guardMode -eq 'page' -and [SyntheticCursorInput.SendKeys]::Calls -gt 0) { 'Changed' } else { 'Synthetic' }
  }
  function Get-DirtyStateFast($Window) { $script:guardMode -eq 'dirty' -and [SyntheticCursorInput.SendKeys]::Calls -gt 0 }
  function Set-SSEForegroundLeaseInputCheckpoint($Tick,$Point,[string]$Context) { }
  function Test-SSETableReadKeyboardTarget($Window,$ProcessId,$Snapshot) {
    $script:guardMode -ne 'active-editor' -and -not ($script:guardMode -eq 'keyboard-or-summary' -and [SyntheticCursorInput.SendKeys]::Calls -gt 0)
  }
  function Get-SSETableLiveInputState {
    [pscustomobject]@{ok=($script:guardMode -ne 'active-editor');editorClosed=($script:guardMode -ne 'active-editor')}
  }
  . $activation
  $navigationState.tick=10; $navigationState.windows=[pscustomobject]@{fingerprint='stable'}
  $navigationState.point=[pscustomobject]@{x=30;y=32}
  $success=& $sendTableNavigation '{DOWN}' 3 'synthetic-read-down'
  Same ([SyntheticCursorInput.SendKeys]::Calls) $(if ($mode -eq 'stable') {3} elseif ($mode -eq 'active-editor') {0} else {1}) "$mode`: guard did not stop before the next key."
  Same $success ($mode -eq 'stable') "$mode`: wrong navigation outcome."
  Same ([bool]$navigationState.failure) ($mode -ne 'stable') "$mode`: guard failure evidence missing."
}
$script:guardMode='active-editor'
foreach ($key in @('^{HOME}','{DOWN}','{UP}')) {
  [SyntheticCursorInput.SendKeys]::Calls=0
  Same (& $sendTableNavigation $key 1 'active-editor-before-key') $false "$key`: reader accepted an active editor."
  Same ([SyntheticCursorInput.SendKeys]::Calls) 0 "$key`: reader sent a cursor key into an active editor."
}
$proof=[pscustomobject]@{complete=$true;heading='Synthetic';tableIdentity='Synthetic.Header';scopePrefix='Synthetic.Scope';selectionMethod='aid';summaryIdentity='Synthetic.Sum';summaryValue='20,00';contentSignature='initial'}
$before=[pscustomobject]@{navigationBinding=$proof;tabelleAnzahl=1;error=$null}
foreach ($field in @('complete','heading','tableIdentity','scopePrefix','selectionMethod','summaryIdentity','summaryValue')) {
  $changedProof=$proof.PSObject.Copy()
  $changedProof.$field=$(if ($field -eq 'complete') {$false} else {'changed'})
  $after=[pscustomobject]@{navigationBinding=$changedProof;tabelleAnzahl=1;error=$null}
  Same (Test-SSETableReadSnapshotBinding $before $after) $false "$field`: changed binding was accepted."
}
$changedProof=$proof.PSObject.Copy(); $changedProof.contentSignature='different-viewport'
$after=[pscustomobject]@{navigationBinding=$changedProof;tabelleAnzahl=1;error=$null}
Same (Test-SSETableReadSnapshotBinding $before $after) $true 'A normal cursor viewport change was rejected.'
Same (Test-SSETableReadSnapshotBinding $before $after -BeforeNavigation) $false 'Focus acquisition silently changed rows before navigation.'
$keyboardFunction=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-SSETableReadKeyboardTarget'},$true))
Same $keyboardFunction.Count 1 'Exact keyboard-target helper is missing.'
. ([scriptblock]::Create($keyboardFunction[0].Extent.Text))
$WLK=[pscustomobject]@{}
$WLK | Add-Member -MemberType ScriptMethod -Name GetParent -Value { param($node) $node.parent }
foreach ($change in @('none','empty-value-pattern','different-value-pattern','header-aid','header-name','header-type','summary-aid','summary-value','summary-missing','root-missing')) {
  $table=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;AutomationId='Synthetic.Table';ControlType='Table'};parent=$null}
  $focused=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;AutomationId='Synthetic.Cell';HasKeyboardFocus=$true};parent=$table}
  $script:summaryNode=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;AutomationId='Synthetic.Sum';Name='20,00'}}
  $script:summaryNode | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value { param($pattern,$result) $false }
  $script:headerNode=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;AutomationId='Synthetic.Header';Name='Amount';ControlType='Header'}}
  $proof=[pscustomobject]@{tableRootAid='Synthetic.Table';summaryIdentity='Synthetic.Sum';summaryAid='Synthetic.Sum';summaryRid='synthetic-sum-rid';summaryValue='20,00';headers=@([pscustomobject]@{aid='Synthetic.Header';rid='synthetic-header-rid';name='Amount'})}
  switch ($change) {
    'empty-value-pattern' {
      $script:summaryNode | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Force -Value {
        param($pattern,$result) $result.Value=[pscustomobject]@{Current=[pscustomobject]@{Value=''}}; $true
      }
    }
    'different-value-pattern' {
      $script:summaryNode | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Force -Value {
        param($pattern,$result) $result.Value=[pscustomobject]@{Current=[pscustomobject]@{Value='21,00'}}; $true
      }
    }
    'table-aid' {$table.Current.AutomationId='Other.Table'}
    'table-type' {$table.Current.ControlType='Edit'}
    'focus-pid' {$focused.Current.ProcessId=8}
    'focus-flag' {$focused.Current.HasKeyboardFocus=$false}
    'header-aid' {$script:headerNode.Current.AutomationId='Other.Header'}
    'header-name' {$script:headerNode.Current.Name='Other'}
    'header-type' {$script:headerNode.Current.ControlType='Edit'}
    'summary-aid' {$script:summaryNode.Current.AutomationId='Other.Sum'}
    'summary-value' {$script:summaryNode.Current.Name='21,00'}
    'summary-missing' {$script:summaryNode=$null}
    'root-missing' {$proof.tableRootAid=''}
  }
  [System.Windows.Automation.AutomationElement]::FocusedElement=$focused
  function Get-SSETableLiveInputState { [pscustomobject]@{ok=$true;editorClosed=$true} }
  function Get-LiveElement($Window,$Rid,$Aid) {
    if ($Aid -ceq 'Synthetic.Header') { $script:headerNode } else { $script:summaryNode }
  }
  Same (Test-SSETableReadKeyboardTarget ([IntPtr]111) 7 ([pscustomobject]@{navigationBinding=$proof})) ($change -in @('none','empty-value-pattern')) `
    "$change`: exact focused table and summary binding returned the wrong outcome."
}
# Exercise the real final focus checkpoint without allowing any UIA read.
# Page/sum/dirty/editor proof belongs to the full guard before uncached bind.
foreach ($mode in @('stable','input','foreground','windows','pid')) {
  $script:focusCheckpointMode=$mode;$targetPid=$(if ($mode -eq 'pid') {8} else {7});$hwnd=[IntPtr]111
  [SW]::Foreground=$(if ($mode -eq 'foreground') {222} else {111})
  $navigationState=[pscustomobject]@{phase='';failure=$null;tick=10;windows=[pscustomobject]@{fingerprint='stable'}}
  function Get-SSELastInputTick { $(if ($script:focusCheckpointMode -eq 'input') {11} else {10}) }
  function Test-SSELastInputUnchanged($Tick) { $Tick -eq (Get-SSELastInputTick) }
  function Get-SSEInteractionWindowSet {
    [pscustomobject]@{fingerprint=$(if ($script:focusCheckpointMode -eq 'windows') {'changed'} else {'stable'})}
  }
  function Get-DirtyStateFast { throw 'Unexpected final focus UIA read.' }
  function Get-CurrentHeading { throw 'Unexpected final focus UIA read.' }
  function Get-SSETableLiveInputState { throw 'Unexpected final focus UIA walk.' }
  Same (& $readFocusCheckpoint 'synthetic-final-focus') ($mode -eq 'stable') "$mode`: wrong final focus checkpoint outcome."
  Same ([bool]$navigationState.failure) ($mode -ne 'stable') "$mode`: final focus boundary evidence missing."
}
Write-Output 'table-read-obstruction: PASS'
