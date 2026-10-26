$ErrorActionPreference='Stop'
$Repo=Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
. (Join-Path $Repo 'powershell/table-values.ps1')
$WorkerPath=Join-Path $Repo 'powershell/sse-worker.ps1'
$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($WorkerPath,[ref]$null,[ref]$errors)
if($errors.Count){throw 'Actual worker source parse failed'}
foreach($name in @('Arg','Get-SSETrackedDateParts','Test-SSETrackedValueEquivalent','Test-SSETrackedFieldValue','Test-KnownPageHeading')){
 $f=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true));if($f.Count -ne 1){throw 'Actual helper must be unique'}
 . ([scriptblock]::Create($f[0].Extent.Text))
}
$clauses=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.SwitchStatementAst]},$true)|ForEach-Object{$_.Clauses}|Where-Object{$_.Item1.Value -ceq 'tracked_set_value'})
if($clauses.Count -ne 1){throw 'Actual field operation must be unique'}
$body=$clauses[0].Item2.Extent.Text;$operation=[scriptblock]::Create($body.Substring(1,$body.Length-2))
# Only provider boundaries are stateful substitutes. No product modules, native
# window/input calls, real processes or controllers are used by this contract.
Add-Type @'
public sealed class RollbackDisplayValueState {public string Value;public bool IsReadOnly=false;}
public sealed class RollbackDisplayPattern {public RollbackDisplayValueState Current=new RollbackDisplayValueState();}
public sealed class RollbackDisplayElementState {public string Name;}
public sealed class RollbackDisplayElement {
 public RollbackDisplayPattern Pattern=new RollbackDisplayPattern();
 public RollbackDisplayElementState Current=new RollbackDisplayElementState();
 public bool TryGetCurrentPattern(object pattern,out object value){value=Pattern;return true;}
 public void SetNull(){Pattern.Current.Value=null;}
}
'@
function Fail($Message,$Kind='error'){Emit ([pscustomobject]@{ok=$false;kind=$Kind;error=$Message})}
function Emit($Result){$script:emitted=$Result;throw 'rollback-display-completed'}
function New-SSEPhaseLog {[pscustomobject]@{}}
function Complete-SSEPhase {}
function Get-SSEPhaseReport {[pscustomobject]@{}}
function Resolve-BoundWriteWindow {[pscustomobject]@{window=[pscustomobject]@{hwnd=7;pid=100};bindingMode='synthetic'}}
function Test-Canary {[pscustomobject]@{ok=$true;ms=0}}
function Get-DialogInventory {}
function Resolve-SSEPageObject {[pscustomobject]@{pageId='fixture.page';page=[pscustomobject]@{heading='Synthetic page'};field=[pscustomobject]@{label='Synthetic field';valueKind=$script:fixture.valueKind;controlType=$script:fixture.type;automationIdSuffix='Form.Text'}}}
function New-DisplayNode {[pscustomobject]@{rid='42.7.101';aid='Form.Text';name=$script:element.Current.Name;val=$script:element.Pattern.Current.Value;type=$script:fixture.type;on=$true;x=10;y=10;w=100;h=20}}
function Resolve-KnownFieldNode {New-DisplayNode}
function Resolve-TrackedFieldNode {New-DisplayNode}
function Walk-Tree {[pscustomobject]@{nodes=@(New-DisplayNode)}}
function Get-CurrentHeading {'Synthetic page'}
function Get-KnownPageState {[pscustomobject]@{heading='Synthetic page';epoch='synthetic';fields=@([pscustomobject]@{fieldId='field';present=$true;value=$script:element.Pattern.Current.Value})}}
function Get-LiveElement {
 if($script:commits.Count -eq 2 -and $script:fixture.missingVerify){return $null}
 if($script:commits.Count -eq 1 -and $script:fixture.missingAfterRead -and -not $script:afterReadLost){$script:afterReadLost=$true;return $null}
 if(($script:commits.Count -eq 1 -and $script:fixture.nullAfterValue) -or
    ($script:commits.Count -eq 2 -and $script:fixture.nullVerifyValue)){$script:element.SetNull()}
 $script:element
}
function Get-SSEInteractionWindowSet {[pscustomobject]@{fingerprint='unchanged';windows=@()}}
function Get-SSELastInputTick {$null}
function Close-TrackedResultWindow {$true}
function Get-DirtyStateFast {$true}
function Get-DirtyState {$true}
function Commit-TrackedValue($Hwnd,$Node,$Value,$ExpectedCurrent){
 if($script:element.Pattern.Current.Value -cne $ExpectedCurrent){throw 'Actual caller lost exact current value'}
 $step=$(if($script:commits.Count -eq 0){$script:fixture.forward}else{$script:fixture.reverse})
 $entry=[pscustomobject]@{requested=$Value;expectedCurrent=$ExpectedCurrent;method=$step.method;observedAfterRaw=$null}
 $null=$script:commits.Add($entry)
 if(-not $step.preserve){
  $script:element.Pattern.Current.Value=[string]$Value
  if($script:fixture.type -ceq 'DataItem'){$script:element.Current.Name=$(if($Value){([string]$Value).Substring(0,5)}else{''})}
  else{$script:element.Current.Name=[string]$step.name}
 }
 if($step.forceRaw){$script:element.Pattern.Current.Value=[string]$step.raw}
 if($step.forceName){$script:element.Current.Name=[string]$step.name}
 $entry.observedAfterRaw=$script:element.Pattern.Current.Value
 [pscustomobject]@{method=$step.method;inputBefore=$null;inputAfter=$null;interference=[bool]$step.interference;inputInterference=[bool]$step.interference;details=[pscustomobject]@{mutationStarted=(-not $step.preserve)}}
}
function Commit-TrackedValueFocusless {throw 'This contract does not use a hidden desktop'}
function Invoke-DisplayCase($Fixture,[bool]$Known=$true){
 $script:fixture=$Fixture;$script:element=New-Object RollbackDisplayElement;$script:element.Pattern.Current.Value=$Fixture.raw;$script:element.Current.Name=$Fixture.name
 if($Fixture.nullBeforeValue){$script:element.SetNull()}
 $script:commits=New-Object Collections.ArrayList;$script:emitted=$null;$script:DESKTOP_NAME='';$script:afterReadLost=$false
 $a=[pscustomobject]@{expectedBefore=$Fixture.expectedBefore;value=$Fixture.requested;expectedAfter=$Fixture.expectedAfter;trackResults=$false}
 if($Known){$a|Add-Member NoteProperty pageId 'fixture.page';$a|Add-Member NoteProperty fieldId 'field'}
 else{$a|Add-Member NoteProperty expectedPage 'Synthetic page';$a|Add-Member NoteProperty aid 'Form.Text';$a|Add-Member NoteProperty valueKind $Fixture.valueKind}
 try{& $operation;throw 'Actual operation emitted no result'}catch{if($_.Exception.Message -cne 'rollback-display-completed'){throw}}
 if(-not $script:emitted){throw 'Missing actual result'}
 $expectedRequests=@(@($Fixture.requested,$Fixture.raw)|Select-Object -First $script:commits.Count)
 $expectedCurrents=@(@($Fixture.raw)+@($script:commits|Select-Object -SkipLast 1|ForEach-Object observedAfterRaw)|Select-Object -First $script:commits.Count)
 if((ConvertTo-Json -Compress -InputObject @($script:commits|ForEach-Object requested)) -cne
    (ConvertTo-Json -Compress -InputObject $expectedRequests)){throw 'Actual requested inputs differ from the explicit forward/original-raw sequence'}
 if((ConvertTo-Json -Compress -InputObject @($script:commits|ForEach-Object expectedCurrent)) -cne
    (ConvertTo-Json -Compress -InputObject $expectedCurrents)){throw 'Every input must retain the exact current raw precondition'}
 [pscustomobject]@{result=$script:emitted;commits=@($script:commits);raw=$script:element.Pattern.Current.Value;name=$script:element.Current.Name}
}
function New-TextFixture([string]$Name){
 [pscustomobject]@{type='Edit';valueKind='text';raw='Test';name=$Name;expectedBefore='Test';requested='Synthetic New';expectedAfter='Synthetic impossible postcondition';missingVerify=$false;missingAfterRead=$false;nullBeforeValue=$false;nullAfterValue=$false;nullVerifyValue=$false;
  forward=[pscustomobject]@{raw='Synthetic New';name=$Name;method='verified-keyboard-replace';preserve=$false;forceRaw=$false;forceName=$false;interference=$false};
  reverse=[pscustomobject]@{raw='Test';name=$Name;method='verified-keyboard-replace';preserve=$false;forceRaw=$false;forceName=$false;interference=$false}}
}
function Assert-Restoration($Case,[bool]$Ok,[int]$Commits,$Raw,$Display,[string]$Method='verified-keyboard-replace'){
 if($Case.result.kind -cne 'postcondition-failed' -or $Case.result.rollback.ok -ne $Ok -or $Case.commits.Count -ne $Commits -or
  $Case.result.rollback.rawWert -cne $Raw -or $Case.result.rollback.wert -cne $Display -or $Case.result.rollback.methode -cne $Method){
  throw ('Actual rollback proof differs from the explicit scenario: '+($Case.result.rollback|ConvertTo-Json -Compress))
 }
}
$emptyName=Invoke-DisplayCase (New-TextFixture '')
Assert-Restoration $emptyName $true 2 'Test' 'Test'
$generic=Invoke-DisplayCase (New-TextFixture '') $false
Assert-Restoration $generic $true 2 'Test' 'Test'
$label=Invoke-DisplayCase (New-TextFixture 'Field label')
Assert-Restoration $label $true 2 'Test' 'Test'
$changed=New-TextFixture 'Field label';$changed.reverse.name='Changed label'
Assert-Restoration (Invoke-DisplayCase $changed) $false 2 'Test' 'Test'
$wrongRaw=New-TextFixture '';$wrongRaw.reverse.raw='Wrong restoration';$wrongRaw.reverse.forceRaw=$true
Assert-Restoration (Invoke-DisplayCase $wrongRaw) $false 2 'Wrong restoration' 'Wrong restoration'
$unproved=New-TextFixture '';$unproved.reverse.method='unproved-commit'
Assert-Restoration (Invoke-DisplayCase $unproved) $false 2 'Test' 'Test' 'unproved-commit'
$missing=New-TextFixture '';$missing.missingVerify=$true
Assert-Restoration (Invoke-DisplayCase $missing) $false 2 $null $null
$date=New-TextFixture '15.07';$date.type='DataItem';$date.valueKind='date';$date.raw='15.07.2026';$date.expectedBefore='15.07.2026';$date.requested='16.07.2026'
Assert-Restoration (Invoke-DisplayCase $date) $true 2 '15.07.2026' '15.07.2026'
$date.raw='';$date.reverse.name=''
Assert-Restoration (Invoke-DisplayCase $date) $false 2 '' ''
$unchanged=New-TextFixture '';$unchanged.forward.preserve=$true;$unchanged.forward.method='epoch-value-changed'
$noWrite=Invoke-DisplayCase $unchanged
Assert-Restoration $noWrite $true 1 'Test' 'Test' 'not-needed-value-unchanged'
if($noWrite.result.rollback.versucht){throw 'An unchanged original value must not trigger another input'}
$nameCase=New-TextFixture 'Field label';$nameCase.reverse.name='FIELDLABEL'
Assert-Restoration (Invoke-DisplayCase $nameCase) $false 2 'Test' 'Test'
$emptyMissing=New-TextFixture '';$emptyMissing.raw='';$emptyMissing.expectedBefore='';$emptyMissing.missingVerify=$true
Assert-Restoration (Invoke-DisplayCase $emptyMissing) $false 2 $null $null
$emptyAfter=New-TextFixture '';$emptyAfter.raw='';$emptyAfter.expectedBefore='';$emptyAfter.forward.preserve=$true;$emptyAfter.forward.method='epoch-value-changed';$emptyAfter.missingAfterRead=$true
$lostAfter=Invoke-DisplayCase $emptyAfter
if($lostAfter.result.kind -cne 'interference' -or $lostAfter.commits.Count -ne 1 -or $lostAfter.result.rollback.versucht){throw 'Absent after proof cannot establish an unchanged outcome or start another input'}
if($null -ne $lostAfter.result.feld.nachher){throw 'A missing after read invented a visible empty value'}
$clear=New-TextFixture '';$clear.requested='';$clear.expectedAfter='';$clear.missingAfterRead=$true
$clearReadLost=Invoke-DisplayCase $clear
Assert-Restoration $clearReadLost $true 2 'Test' 'Test'
if($null -ne $clearReadLost.result.feld.nachher){throw 'The lost clear read was presented as an observed empty value'}
$success=New-TextFixture '14.07';$success.type='DataItem';$success.valueKind='date';$success.raw='14.07.2026';$success.expectedBefore='14.07.2026';$success.requested='15.07.2026';$success.expectedAfter='15.07.2026';$success.forward.forceRaw=$true;$success.forward.raw='opaque-current-date'
$nameOnlySuccess=Invoke-DisplayCase $success
if(-not $nameOnlySuccess.result.ok -or -not $nameOnlySuccess.result.verified -or $nameOnlySuccess.commits.Count -ne 1 -or $nameOnlySuccess.result.feld.nachherAnzeige -cne '15.07'){throw 'A valid Name-based forward success or actual UIA Name output regressed'}
$foreignClear=New-TextFixture '';$foreignClear.requested='';$foreignClear.forward.forceRaw=$true;$foreignClear.forward.raw='Foreign'
$foreign=Invoke-DisplayCase $foreignClear
if($foreign.result.kind -cne 'interference' -or $foreign.commits.Count -ne 1 -or $foreign.result.rollback.versucht -or $foreign.raw -cne 'Foreign'){throw 'An empty Edit Name authorized overwriting a third raw value'}
$rejectedClear=New-TextFixture '';$rejectedClear.requested='';$rejectedClear.expectedAfter='';$rejectedClear.forward.forceRaw=$true;$rejectedClear.forward.raw='Test'
Assert-Restoration (Invoke-DisplayCase $rejectedClear) $true 1 'Test' 'Test' 'not-needed-value-unchanged'
$rawCase=New-TextFixture '';$rawCase.forward.forceRaw=$true;$rawCase.forward.raw='test'
$caseChanged=Invoke-DisplayCase $rawCase
if($caseChanged.result.kind -cne 'interference' -or $caseChanged.commits.Count -ne 1 -or $caseChanged.raw -cne 'test'){throw 'Case-only text change was treated as the restored original'}
$rawSpace=New-TextFixture '';$rawSpace.forward.forceRaw=$true;$rawSpace.forward.raw='T est'
$spaceChanged=Invoke-DisplayCase $rawSpace
if($spaceChanged.result.kind -cne 'interference' -or $spaceChanged.commits.Count -ne 1 -or $spaceChanged.raw -cne 'T est'){throw 'Whitespace-only text change was treated as the restored original'}
$editLabel=New-TextFixture 'Field label';$editLabel.raw='';$editLabel.expectedBefore='Field label'
$labelRefused=Invoke-DisplayCase $editLabel
if($labelRefused.result.kind -cne 'precondition-failed' -or $labelRefused.commits.Count -ne 0){throw 'An Edit label was accepted as its current field value'}
$emptyLabel=New-TextFixture 'Field label';$emptyLabel.raw='';$emptyLabel.expectedBefore='';$emptyLabel.forward.preserve=$true;$emptyLabel.forward.method='epoch-value-changed'
Assert-Restoration (Invoke-DisplayCase $emptyLabel) $true 1 '' '' 'not-needed-value-unchanged'
$displayedDate=New-TextFixture '15.07';$displayedDate.type='DataItem';$displayedDate.valueKind='date';$displayedDate.raw='';$displayedDate.expectedBefore=''
$notEmptyDate=Invoke-DisplayCase $displayedDate
if($notEmptyDate.result.kind -cne 'precondition-failed' -or $notEmptyDate.commits.Count -ne 0){throw 'An empty DataItem raw placeholder concealed its nonempty business display'}
if(Test-SSETrackedValueEquivalent 'test' 'Test'){throw 'The omitted format contract must retain exact text case'}
if(Test-SSETrackedValueEquivalent 'T est' 'Test' 'text'){throw 'Text comparison removed significant whitespace'}
if(-not (Test-SSETrackedValueEquivalent '1.000,00' '1000.00' 'currency')){throw 'The explicit currency format contract regressed'}
$nullClear=New-TextFixture '';$nullClear.requested='';$nullClear.expectedAfter='';$nullClear.nullAfterValue=$true
$nullAfter=Invoke-DisplayCase $nullClear
if($nullAfter.result.kind -cne 'interference' -or $nullAfter.commits.Count -ne 1 -or $null -ne $nullAfter.result.feld.nachher){
 throw ('A null provider value confirmed an empty clear or authorized another input: '+($nullAfter|ConvertTo-Json -Depth 8 -Compress))
}
$nullVerify=New-TextFixture '';$nullVerify.raw='';$nullVerify.expectedBefore='';$nullVerify.nullVerifyValue=$true
Assert-Restoration (Invoke-DisplayCase $nullVerify) $false 2 $null $null
$nullBefore=New-TextFixture '';$nullBefore.expectedBefore='';$nullBefore.nullBeforeValue=$true
$unreadableBefore=Invoke-DisplayCase $nullBefore
if($unreadableBefore.result.kind -cne 'no-value-pattern' -or $unreadableBefore.commits.Count -ne 0){throw 'A null original raw value authorized a write'}
if(Test-SSETrackedValueEquivalent '10.10' '10.1' 'date'){throw 'A date comparison used decimal equivalence for different months'}
if(Test-SSETrackedValueEquivalent '01.10' '1.1' 'date'){throw 'October and January were treated as the same date'}
if(Test-SSETrackedValueEquivalent '15,07' '15.07' 'date'){throw 'A comma number was treated as a dotted date'}
$mixedKind=New-TextFixture '';$mixedKind.valueKind='Text';$mixedKind.forward.forceRaw=$true;$mixedKind.forward.raw='test'
$invalidKind=Invoke-DisplayCase $mixedKind
if($invalidKind.result.kind -cne 'bad-args' -or $invalidKind.commits.Count -ne 0){throw 'Mixed-case valueKind bypassed exact text matching'}
$nullDate=New-TextFixture '15.07';$nullDate.type='DataItem';$nullDate.valueKind='date';$nullDate.raw='15.07.2026';$nullDate.expectedBefore='15.07.2026';$nullDate.requested='16.07.2026';$nullDate.expectedAfter='16.07.2026';$nullDate.nullAfterValue=$true
$unreadableDate=Invoke-DisplayCase $nullDate
if($unreadableDate.result.kind -cne 'interference' -or $unreadableDate.commits.Count -ne 1 -or $null -ne $unreadableDate.result.feld.nachher){throw 'A matching DataItem Name replaced a null after-value proof'}
$nullDate.forward.interference=$true;$nullDate.forward.method='interference-after-value'
$nullProbe=Invoke-DisplayCase $nullDate
if($nullProbe.result.kind -cne 'interference' -or $nullProbe.commits.Count -ne 1 -or $nullProbe.result.rollback.versucht -or
 $nullProbe.result.feld.zustand -cne 'unknown' -or $null -ne $nullProbe.result.feld.nachher){throw 'Interference probe promoted a null raw value to an observed business value'}
$opaqueProbe=New-TextFixture '15.07';$opaqueProbe.type='DataItem';$opaqueProbe.valueKind='date';$opaqueProbe.raw='15.07.2026';$opaqueProbe.expectedBefore='15.07.2026';$opaqueProbe.requested='16.07.2026';$opaqueProbe.expectedAfter='16.07.2026';$opaqueProbe.forward.forceRaw=$true;$opaqueProbe.forward.raw='opaque-date-value';$opaqueProbe.forward.interference=$true;$opaqueProbe.forward.method='interference-after-value'
$visibleRequested=Invoke-DisplayCase $opaqueProbe
if($visibleRequested.result.kind -cne 'interference' -or $visibleRequested.commits.Count -ne 1 -or $visibleRequested.result.rollback.versucht -or
 $visibleRequested.result.feld.zustand -cne 'requested-value-visible'){throw 'Interference probe ignored the supported DataItem display representation'}
$wrongYear=New-TextFixture '15.07';$wrongYear.type='DataItem';$wrongYear.valueKind='date';$wrongYear.raw='15.07.2025';$wrongYear.expectedBefore='15.07.2026'
$yearRefused=Invoke-DisplayCase $wrongYear
if($yearRefused.result.kind -cne 'precondition-failed' -or $yearRefused.commits.Count -ne 0){throw 'A yearless display overrode a contradictory explicit raw year'}
$wrongYear.raw='15.07';$wrongYear.name='15.07.2025'
$nameYearRefused=Invoke-DisplayCase $wrongYear
if($nameYearRefused.result.kind -cne 'precondition-failed' -or $nameYearRefused.commits.Count -ne 0){throw 'A yearless raw value concealed a contradictory displayed year'}
$contradictoryYear=New-TextFixture '15.07.2025';$contradictoryYear.type='DataItem';$contradictoryYear.valueKind='date';$contradictoryYear.raw='15.07.2026';$contradictoryYear.expectedBefore='15.07'
$yearlessRefused=Invoke-DisplayCase $contradictoryYear
if($yearlessRefused.result.kind -cne 'precondition-failed' -or $yearlessRefused.commits.Count -ne 0){throw 'A yearless expected value concealed contradictory explicit raw and Name years'}
$opaqueProbe.raw='opaque-date-value'
$genericOpaque=Invoke-DisplayCase $opaqueProbe $false
if($genericOpaque.result.kind -cne 'interference' -or $genericOpaque.commits.Count -ne 1 -or $genericOpaque.result.rollback.versucht -or
 $genericOpaque.result.feld.zustand -cne 'requested-value-visible'){throw 'Generic probe used a cached DataItem Name with stable opaque raw'}
$opaqueProbe.raw='';$opaqueProbe.forward.raw=''
$genericEmpty=Invoke-DisplayCase $opaqueProbe $false
if($genericEmpty.result.kind -cne 'interference' -or $genericEmpty.commits.Count -ne 1 -or $genericEmpty.result.rollback.versucht -or
 $genericEmpty.result.feld.zustand -cne 'requested-value-visible' -or $genericEmpty.result.feld.nachher -cne '16.07'){throw 'Generic probe used a cached DataItem Name with empty raw'}
$opaqueProbe.forward.forceName=$true;$opaqueProbe.forward.name='17.07'
$genericDifferent=Invoke-DisplayCase $opaqueProbe $false
if($genericDifferent.result.kind -cne 'interference' -or $genericDifferent.commits.Count -ne 1 -or $genericDifferent.result.rollback.versucht -or
 $genericDifferent.result.feld.zustand -cne 'different-value-visible' -or $genericDifferent.result.feld.nachher -cne '17.07'){throw 'Generic probe concealed a different live DataItem Name'}
Write-Output 'Tracked rollback display: forward Name matching, raw/name proof, missing-read refusal, rejected clear and third-value preservation passed.'
