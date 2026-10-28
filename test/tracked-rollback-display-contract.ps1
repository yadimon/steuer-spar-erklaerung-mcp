$ErrorActionPreference='Stop'
$Repo=Split-Path -Parent $PSScriptRoot
$WorkerPath=Join-Path $Repo 'powershell/sse-worker.ps1'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
. (Join-Path $Repo 'powershell/table-values.ps1')
$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($WorkerPath,[ref]$null,[ref]$errors)
if($errors.Count){throw 'Actual worker source parse failed'}
foreach($name in @('Arg','Get-SSETrackedDateParts','Test-SSETrackedValueEquivalent','Test-SSETrackedFieldValue','Test-KnownPageHeading','Test-SSELastInputUnchanged')){
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
 public void SetNameNull(){Current.Name=null;}
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
function New-DisplayNode {
 $name=$script:element.Current.Name
 if($script:fixture.normalizedTreeName){$name=($name -replace "`r|`n|`t",' ').Trim()}
 [pscustomobject]@{rid='42.7.101';aid='Form.Text';name=$name;val=$script:element.Pattern.Current.Value;type=$script:fixture.type;on=$true;x=10;y=10;w=100;h=20}
}
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
 if(($script:commits.Count -eq 1 -and $script:fixture.nullAfterName) -or
    ($script:commits.Count -eq 2 -and $script:fixture.nullVerifyName)){$script:element.SetNameNull()}
 $script:element
}
function Resolve-SSEFocuslessCommitPolicy {[pscustomobject]@{id='synthetic-focusless-provider'}}
function Get-SSEInteractionWindowSet {[pscustomobject]@{fingerprint='unchanged';windows=@()}}
function Get-SSELastInputTick {$script:inputTick}
function Close-TrackedResultWindow {$true}
function Get-DirtyStateFast {$true}
function Get-DirtyState {$true}
function Commit-TrackedValue($Hwnd,$Node,$Value,$ExpectedCurrent,$ValueKind,$InheritedInputEpoch){
 if($ValueKind -cne $script:fixture.valueKind){throw 'Actual handler did not forward the exact format contract to its commit provider'}
 if(-not $ExpectedCurrent.PSObject.Properties['raw'] -or -not $ExpectedCurrent.PSObject.Properties['name'] -or
    -not $ExpectedCurrent.PSObject.Properties['value']){throw 'Actual caller did not capture raw, Name and business expectation'}
 if($script:element.Pattern.Current.Value -cne $ExpectedCurrent.raw -or $script:element.Current.Name -cne $ExpectedCurrent.name){throw 'Actual caller lost its captured raw/Name pair'}
 $business=$(if($script:commits.Count -eq 0){$script:fixture.expectedBefore}elseif($script:fixture.PSObject.Properties['rollbackExpectedValue']){$script:fixture.rollbackExpectedValue}else{$script:fixture.requested})
 if($ExpectedCurrent.value -cne $business){throw 'Actual caller lost its original business expectation'}
 $step=$(if($script:commits.Count -eq 0){$script:fixture.forward}else{$script:fixture.reverse})
 if(-not $script:DESKTOP_NAME -and $script:commits.Count -gt 0 -and
    -not [object]::Equals($InheritedInputEpoch,$script:commits[0].inputAfter)){throw 'The actual rollback caller lost the forward commit checkpoint'}
 $inputBefore=$script:inputTick
 if(-not $script:DESKTOP_NAME){$script:inputTick+=3}
 $inputAfter=$(if($script:DESKTOP_NAME){$null}else{$script:inputTick})
 if($script:commits.Count -eq 0 -and $script:fixture.PSObject.Properties['forwardInputAfter']){$inputAfter=$script:fixture.forwardInputAfter}
 $entry=[pscustomobject]@{requested=$Value;expectedCurrent=$ExpectedCurrent.raw;method=$step.method;observedAfterRaw=$null;inputAfter=$inputAfter}
 $null=$script:commits.Add($entry)
 if(-not $step.preserve){
  $script:element.Pattern.Current.Value=[string]$Value
  if($script:fixture.type -ceq 'DataItem'){
   $script:element.Current.Name=$(if($script:fixture.valueKind -ceq 'date' -and $Value){([string]$Value).Substring(0,5)}else{[string]$Value})
  }
  else{$script:element.Current.Name=[string]$step.name}
 }
 if($step.forceRaw){$script:element.Pattern.Current.Value=[string]$step.raw}
 if($step.forceName){$script:element.Current.Name=[string]$step.name}
 $entry.observedAfterRaw=$script:element.Pattern.Current.Value
 if($script:SSE_TRACKED_PLAN_INPUT_CONTEXT -and $step.method -ceq 'verified-keyboard-replace' -and $null -ne $inputAfter){
  $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint=$inputAfter
 }
 [pscustomobject]@{method=$step.method;inputBefore=$inputBefore;inputAfter=$inputAfter;interference=[bool]$step.interference;inputInterference=[bool]$step.interference;details=[pscustomobject]@{mutationStarted=(-not $step.preserve)}}
}
function Commit-TrackedValueFocusless($Hwnd,$Node,$Value,$ExpectedCurrent,$ValueKind){Commit-TrackedValue $Hwnd $Node $Value $ExpectedCurrent $ValueKind}
function Invoke-DisplayCase($Fixture,[bool]$Known=$true){
 $script:fixture=$Fixture;$script:element=New-Object RollbackDisplayElement;$script:element.Pattern.Current.Value=$Fixture.raw;$script:element.Current.Name=$Fixture.name
 if($Fixture.nullBeforeValue){$script:element.SetNull()}
 if($Fixture.nullBeforeName){$script:element.SetNameNull()}
 $script:commits=New-Object Collections.ArrayList;$script:emitted=$null;$script:DESKTOP_NAME=$(if($Fixture.hidden){'synthetic'}else{''});$script:afterReadLost=$false
 $script:inputTick=1;$script:SSE_TRACKED_PLAN_INPUT_CONTEXT=$null
 if($Fixture.planInput){$script:SSE_TRACKED_PLAN_INPUT_CONTEXT=[pscustomobject]@{checkpoint=$script:inputTick}}
 $a=[pscustomobject]@{expectedBefore=$Fixture.expectedBefore;value=$Fixture.requested;expectedAfter=$Fixture.expectedAfter;trackResults=$false}
 if($Known){$a|Add-Member NoteProperty pageId 'fixture.page';$a|Add-Member NoteProperty fieldId 'field'}
 else{$a|Add-Member NoteProperty expectedPage 'Synthetic page';$a|Add-Member NoteProperty aid 'Form.Text';$a|Add-Member NoteProperty valueKind $Fixture.valueKind}
 try{& $operation;throw 'Actual operation emitted no result'}catch{if($_.Exception.Message -cne 'rollback-display-completed'){throw}}
 if(-not $script:emitted){throw 'Missing actual result'}
 $restoreInput=$(if($Fixture.PSObject.Properties['restoreInput']){$Fixture.restoreInput}else{$Fixture.raw})
 $expectedRequests=@(@($Fixture.requested,$restoreInput)|Select-Object -First $script:commits.Count)
 $expectedCurrents=@(@($Fixture.raw)+@($script:commits|Select-Object -SkipLast 1|ForEach-Object observedAfterRaw)|Select-Object -First $script:commits.Count)
 if((ConvertTo-Json -Compress -InputObject @($script:commits|ForEach-Object requested)) -cne
    (ConvertTo-Json -Compress -InputObject $expectedRequests)){throw 'Actual requested inputs differ from the explicit forward/original-raw sequence'}
 if((ConvertTo-Json -Compress -InputObject @($script:commits|ForEach-Object expectedCurrent)) -cne
    (ConvertTo-Json -Compress -InputObject $expectedCurrents)){throw 'Every input must retain the exact current raw precondition'}
 [pscustomobject]@{result=$script:emitted;commits=@($script:commits);raw=$script:element.Pattern.Current.Value;name=$script:element.Current.Name;checkpoint=$script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint}
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
$date.raw='';$date|Add-Member NoteProperty restoreInput '15.07'
$date.reverse.forceRaw=$true;$date.reverse.raw='';$date.reverse.forceName=$true;$date.reverse.name='15.07'
Assert-Restoration (Invoke-DisplayCase $date) $true 2 '' '15.07'
$date.reverse.forceRaw=$false
Assert-Restoration (Invoke-DisplayCase $date) $false 2 '15.07' '15.07'
$opaqueRestore=New-TextFixture '15.07';$opaqueRestore.type='DataItem';$opaqueRestore.valueKind='date'
$opaqueRestore.raw='opaque-date-value';$opaqueRestore.expectedBefore='15.07';$opaqueRestore.requested='16.07.2026'
$opaqueRestore|Add-Member NoteProperty restoreInput '15.07'
$opaqueRestore.reverse.forceRaw=$true;$opaqueRestore.reverse.raw='opaque-date-value'
$opaqueRestore.reverse.forceName=$true;$opaqueRestore.reverse.name='15.07'
Assert-Restoration (Invoke-DisplayCase $opaqueRestore) $true 2 'opaque-date-value' 'opaque-date-value'
$opaqueRestore|Add-Member NoteProperty hidden $true
$opaqueRestore.forward.method='verified-focusless-value-pattern-tab';$opaqueRestore.reverse.method='verified-focusless-value-pattern-tab'
Assert-Restoration (Invoke-DisplayCase $opaqueRestore) $true 2 'opaque-date-value' 'opaque-date-value' 'verified-focusless-value-pattern-tab'
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
$hidden=New-TextFixture '';$hidden|Add-Member NoteProperty hidden $true
$hidden.expectedAfter=$hidden.requested;$hidden.forward.method='verified-focusless-value-pattern-tab'
$hiddenForward=Invoke-DisplayCase $hidden
if(-not $hiddenForward.result.ok -or $hiddenForward.commits.Count -ne 1){throw 'Hidden handler lost the forwarded text kind'}
$hiddenDate=New-TextFixture '15.07';$hiddenDate|Add-Member NoteProperty hidden $true;$hiddenDate.type='DataItem';$hiddenDate.valueKind='date';$hiddenDate.raw='15.07.2026';$hiddenDate.expectedBefore='15.07.2026';$hiddenDate.requested='16.07.2026';$hiddenDate.forward.method='verified-focusless-value-pattern-tab';$hiddenDate.reverse.method='verified-focusless-value-pattern-tab'
Assert-Restoration (Invoke-DisplayCase $hiddenDate) $true 2 '15.07.2026' '15.07.2026' 'verified-focusless-value-pattern-tab'
$hiddenDate.raw='';$hiddenDate.expectedBefore='15.07';$hiddenDate|Add-Member NoteProperty restoreInput '15.07'
$hiddenDate.reverse.forceRaw=$true;$hiddenDate.reverse.raw='';$hiddenDate.reverse.forceName=$true;$hiddenDate.reverse.name='15.07'
Assert-Restoration (Invoke-DisplayCase $hiddenDate) $true 2 '' '15.07' 'verified-focusless-value-pattern-tab'
$ownedAfter=New-TextFixture '';$ownedAfter.forward.method='unproved-commit';$ownedAfter.forward.forceRaw=$true
$ownedAfter.forward.raw='Synthetic formatted';$ownedAfter.expectedAfter='Synthetic formatted'
$ownedAfter|Add-Member NoteProperty rollbackExpectedValue 'Synthetic formatted'
Assert-Restoration (Invoke-DisplayCase $ownedAfter) $true 2 'Test' 'Test'
$magnitude=New-TextFixture '';$magnitude.valueKind='currency';$magnitude.raw='1,000';$magnitude.expectedBefore='1.000'
$wrongMagnitude=Invoke-DisplayCase $magnitude
if($wrongMagnitude.result.kind -cne 'precondition-failed' -or $wrongMagnitude.commits.Count -ne 0){throw 'Currency formatting accepted a different magnitude before any input'}
$magnitude.type='DataItem';$magnitude.name='1.000'
$wrongDisplayedMagnitude=Invoke-DisplayCase $magnitude
if($wrongDisplayedMagnitude.result.kind -cne 'precondition-failed' -or $wrongDisplayedMagnitude.commits.Count -ne 0){throw 'DataItem Name overrode a contradictory readable currency raw value'}
$sameMagnitude=New-TextFixture '1000.00';$sameMagnitude.type='DataItem';$sameMagnitude.valueKind='currency';$sameMagnitude.raw='1.000,00';$sameMagnitude.expectedBefore='1000,00';$sameMagnitude.requested='2000,00';$sameMagnitude.expectedAfter='2000,00'
$formattedCurrency=Invoke-DisplayCase $sameMagnitude
if(-not $formattedCurrency.result.verified -or $formattedCurrency.commits.Count -ne 1){throw 'Agreeing numeric raw and Name formatting was rejected'}
$agreeingYear=New-TextFixture '15.07.26';$agreeingYear.type='DataItem';$agreeingYear.valueKind='date';$agreeingYear.raw='15.07.2026';$agreeingYear.expectedBefore='15.07';$agreeingYear.requested='16.07.2026';$agreeingYear.expectedAfter='16.07.2026'
$sameExplicitYears=Invoke-DisplayCase $agreeingYear
if(-not $sameExplicitYears.result.verified -or $sameExplicitYears.commits.Count -ne 1){throw 'Agreeing explicit years were rejected for a yearless precondition'}
$spaced=New-TextFixture '  Test  ';$spaced.type='DataItem';$spaced.raw='';$spaced.expectedBefore='  Test  '
$spaced.requested='  Synthetic New  ';$spaced.expectedAfter=$spaced.requested
$spaced.forward.forceRaw=$true;$spaced.forward.raw='';$spaced|Add-Member NoteProperty normalizedTreeName $true
foreach($known in @($true,$false)){
 $fullName=Invoke-DisplayCase $spaced $known
 if(-not $fullName.result.verified -or $fullName.commits.Count -ne 1 -or $fullName.result.feld.nachherAnzeige -cne $spaced.requested){throw 'A normalized tree Name replaced the fresh full DataItem value'}
}
$spaced.expectedAfter='Synthetic impossible postcondition';$spaced|Add-Member NoteProperty restoreInput '  Test  '
$spaced.reverse.forceRaw=$true;$spaced.reverse.raw='';$spaced.reverse.forceName=$true;$spaced.reverse.name='  Test  '
foreach($known in @($true,$false)){
 Assert-Restoration (Invoke-DisplayCase $spaced $known) $true 2 '' '  Test  '
}
$missingName=New-TextFixture '';$missingName|Add-Member NoteProperty nullBeforeName $true
$beforeNameMissing=Invoke-DisplayCase $missingName
if($beforeNameMissing.result.kind -cne 'no-value-pattern' -or $beforeNameMissing.commits.Count -ne 0){throw 'An unknown initial Name was converted into an empty snapshot'}
$missingName.nullBeforeName=$false;$missingName|Add-Member NoteProperty nullAfterName $true
$afterNameMissing=Invoke-DisplayCase $missingName
if($afterNameMissing.result.kind -cne 'interference' -or $afterNameMissing.commits.Count -ne 1 -or $afterNameMissing.result.rollback.versucht){throw 'An unknown after Name authorized another value input'}
$missingName.nullAfterName=$false;$missingName|Add-Member NoteProperty nullVerifyName $true
Assert-Restoration (Invoke-DisplayCase $missingName) $false 2 $null $null

$unknownProbe=New-TextFixture '';$unknownProbe.raw='';$unknownProbe.expectedBefore=''
$unknownProbe.forward.preserve=$true;$unknownProbe.forward.interference=$true;$unknownProbe.forward.method='interference-before-value'
$unknownProbe|Add-Member NoteProperty nullAfterName $true
$probeResult=Invoke-DisplayCase $unknownProbe
if($probeResult.result.kind -cne 'interference' -or $probeResult.result.feld.zustand -cne 'unknown' -or
 $null -ne $probeResult.result.feld.nachher -or $probeResult.commits.Count -ne 1 -or $probeResult.result.rollback.versucht){throw 'A null probe Name invented an unchanged empty value'}
$unknownCheckpoint=New-TextFixture '';$unknownCheckpoint|Add-Member NoteProperty forwardInputAfter $null
$unknownInput=Invoke-DisplayCase $unknownCheckpoint
if($unknownInput.result.kind -cne 'interference' -or $unknownInput.commits.Count -ne 1 -or $unknownInput.result.rollback.versucht){throw 'An unreadable physical forward checkpoint authorized a reverse write'}
$failedCommit=New-TextFixture '';$failedCommit.forward.method='failed'
$unownedInput=Invoke-DisplayCase $failedCommit
if($unownedInput.result.kind -cne 'interference' -or $unownedInput.commits.Count -ne 1 -or $unownedInput.result.rollback.versucht){throw 'A fresh observation from an unclassified failed commit authorized a reverse write'}
$ownedPlan=New-TextFixture '';$ownedPlan|Add-Member NoteProperty planInput $true
$ownInnerRollback=Invoke-DisplayCase $ownedPlan
Assert-Restoration $ownInnerRollback $true 2 'Test' 'Test'
if($ownInnerRollback.checkpoint -ne 7 -or $ownInnerRollback.result.inputGuard.nachher -ne 4){throw 'Inner rollback did not retain its last own checkpoint independently of forward telemetry'}
$ownedPlan.forward.method='native-input-unsettled'
$uncertainPlan=Invoke-DisplayCase $ownedPlan
if($uncertainPlan.result.kind -cne 'interference' -or $uncertainPlan.commits.Count -ne 1 -or $uncertainPlan.result.rollback.versucht -or $uncertainPlan.checkpoint -ne 1){throw 'An unverified partial plan commit was rebased and rolled back'}
Write-Output 'Tracked rollback display: forward Name matching, raw/name proof, missing-read refusal, rejected clear and third-value preservation passed.'
