$ErrorActionPreference='Stop'
$repository=Split-Path $PSScriptRoot -Parent
# Reuse the exact public fixture's thin native boundaries; it executes no OS input.
. (Join-Path $repository 'test/receipt-vat-selection-contract.ps1')
Add-Type -TypeDefinition @'
namespace System.Windows.Automation {public sealed class TogglePattern {public static readonly object Pattern=new object();}}
'@
foreach($name in @('Read-SSEToggleState','New-SSECommitResult')){
 $definition=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
 Assert-True ($definition.Count -eq 1) 'Actual toggle/commit result helper ambiguous.'
 Invoke-Expression $definition[0].Extent.Text
}
$forward=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.ForEachStatementAst] -and
 $n.Variable.Extent.Text -ceq '$transaction' -and $n.Body.Extent.Text.Contains('$vatState = Get-SSEReceiptManagerState') -and
 $n.Body.Extent.Text.Contains('$commit = Commit-TrackedValue')},$true))
Assert-True ($forward.Count -eq 1) 'Actual forward transaction loop ambiguous.'
$script:checkboxNativeReads=0
function Get-LiveElement($Window,$Rid,$Aid){
 $node=$script:checkboxModel[$Aid]
 if($Aid -ceq 'synthetic.net'){
  $script:checkboxNativeReads++
  if([VatSelectionFixture]::Mode -ceq 'checkbox-binding-input-drift' -and $script:checkboxNativeReads -ge 2){
   $node=[pscustomobject]@{rid='42.7.99';aid='synthetic.net';type='CheckBox';checked=$false;on=$true;x=20;y=40;w=80;h=20}
   [VatSelectionFixture]::Tick=9
  }
 }
 if(-not $node){return $null}
 $element=[pscustomobject]@{node=$node}
 $element|Add-Member ScriptMethod TryGetCurrentPattern {
  param($Pattern,[ref]$Out)
  if(-not [Object]::ReferenceEquals($Pattern,[Windows.Automation.TogglePattern]::Pattern)){return $false}
  $state=$(if($this.node.checked -isnot [bool]){'Indeterminate'}elseif($this.node.checked){'On'}else{'Off'})
  $Out.Value=[pscustomobject]@{Current=[pscustomobject]@{ToggleState=$state}}
  return $true
 }
 $element
}
function Convert-ExactElementToNode($Element){$Element.node}
function Commit-TrackedValue($Window,$Node,$Wanted,$Expected,$Kind){
 $Node.val=$Wanted;$script:titleCommits++
 New-SSECommitResult 'verified-keyboard-replace' 1 2 ([pscustomobject]@{mutationStarted=$true})
}
function Get-SSEPointObstruction($Window,$X,$Y){
 [pscustomobject]@{isBoundTarget=([VatSelectionFixture]::Mode -cne 'checkbox-terminal-failure');boundPid=100;
 blockerKind='synthetic';processName='synthetic';className='synthetic';hitWindow=8;hitRoot=8;boundWindow=8;hitPid=100}
}
Add-Type -TypeDefinition @'
public sealed class ReceiptCheckboxPoint {
 public static string RuntimeId="42.7.12";
 public int[] GetRuntimeId(){return System.Array.ConvertAll(RuntimeId.Split('.'),int.Parse);}
 public static ReceiptCheckboxPoint FromPoint(object point){return new ReceiptCheckboxPoint();}
}
'@
$script:AE=[ReceiptCheckboxPoint]
$nativeGetLive=${function:Get-LiveElement}
function Get-LiveElement($Window,$Rid,$Aid){
 $element=& $nativeGetLive $Window $Rid $Aid
 if($Aid -ceq 'synthetic.net' -and $element){
  [ReceiptCheckboxPoint]::RuntimeId=[string]$element.node.rid
  if([SW]::MouseCalls -ge 2){$element.node.checked=-not $script:checkboxInitialBefore}
  if($script:checkboxNativeReads -ge 2){
   switch([VatSelectionFixture]::Mode){
    'checkbox-move-at-point' {$element.node.x=300}
    'checkbox-input-at-point' {[VatSelectionFixture]::Tick=9}
    'checkbox-value-at-point' {$element.node.checked=-not $script:checkboxInitialBefore}
    'checkbox-disabled-at-point' {$element.node.on=$false}
    'checkbox-indeterminate-at-point' {$element.node.checked=$null}
   }
  }
  if([VatSelectionFixture]::Mode -ceq 'checkbox-indeterminate-after-point' -and [SW]::MouseCalls -ge 2){$element.node.checked=$null}
  if([SW]::MouseCalls -ge 2){
   switch([VatSelectionFixture]::Mode){
    'checkbox-input-after-point' {[VatSelectionFixture]::Tick=11}
    'checkbox-checkpoint-after-point' {$script:SSE_FOREGROUND_LEASE.lastOwnedInputTick=11}
   }
  }
  if(([VatSelectionFixture]::Mode -ceq 'checkbox-capture' -and $script:checkboxNativeReads -ge 2) -or
    ([VatSelectionFixture]::Mode -ceq 'checkbox-capture-after-point' -and [SW]::MouseCalls -ge 2)){
   $script:checkboxCapturePayload=[pscustomobject]@{ok=$false;kind='synthetic-checkbox-capture';error='Synthetic checkbox capture'}
   Emit $script:checkboxCapturePayload
  }
 }
 $element
}
foreach($name in @('Test-SSEReceiptManagerInputContext','Set-SSEReceiptManagerBoolean')){
 $defs=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
 Assert-True ($defs.Count -eq 1) 'Actual Boolean helper ambiguous.'
 Invoke-Expression $defs[0].Extent.Text
}
function Reset-Checkbox([string]$Mode,[bool]$Before){
 Reset-Fixture $Mode
 $script:checkboxNativeReads=0;$script:cursorMoves=0;$script:checkboxInitialBefore=$Before
 $script:checkboxCapturePayload=$null
 [ReceiptCheckboxPoint]::RuntimeId='42.7.12'
 $script:checkboxModel=@{'synthetic.net'=[pscustomobject]@{rid='42.7.12';aid='synthetic.net';type='CheckBox';checked=$Before;on=$true;x=20;y=40;w=80;h=20}}
 $script:checkboxBinding=[pscustomobject]@{name='net';policy=[pscustomobject]@{valueKind='boolean';controlType='CheckBox'};node=$script:checkboxModel['synthetic.net']}
}
foreach($before in @($false,$true)){
 Reset-Checkbox 'checkbox-positive' $before
 $result=Set-SSEReceiptManagerBoolean ([IntPtr]8) 100 $checkboxBinding $before (-not $before) 1
 Assert-True ($result.ok -and $result.after -is [bool] -and $result.after -eq (-not $before) -and $result.mutationStarted -and
  $result.inputDispatched -eq $true -and [SW]::MouseCalls -eq 2 -and $null -eq $script:SSE_CAPTURED_OPERATION_RESULT) 'Actual checkbox actual-point success failed.'
 Reset-Checkbox 'checkbox-noop' $before
 $script:SSE_FOREGROUND_LEASE.watch=$null
 $result=Set-SSEReceiptManagerBoolean ([IntPtr]8) 100 $checkboxBinding $before $before 1
 Assert-True ($result.ok -and $result.after -is [bool] -and $result.after -eq $before -and -not $result.mutationStarted -and [SW]::MouseCalls -eq 0) 'Readable checkbox noop attempted an action.'
}
foreach($case in @(
 @{mode='checkbox-terminal-failure';dispatched=$false;mouse=0;mutation=$false},
 @{mode='checkbox-binding-input-drift';dispatched=$false;mouse=0;mutation=$false},
 @{mode='checkbox-move-at-point';dispatched=$false;mouse=0;mutation=$false},
 @{mode='checkbox-input-at-point';dispatched=$false;mouse=0;mutation=$false},
 @{mode='checkbox-value-at-point';dispatched=$false;mouse=0;mutation=$false},
 @{mode='checkbox-disabled-at-point';dispatched=$false;mouse=0;mutation=$false},
 @{mode='checkbox-indeterminate-at-point';dispatched=$false;mouse=0;mutation=$false},
 @{mode='checkbox-indeterminate-after-point';dispatched=$true;mouse=2;mutation=$true},
 @{mode='checkbox-input-after-point';dispatched=$true;mouse=2;mutation=$true},
 @{mode='checkbox-checkpoint-after-point';dispatched=$true;mouse=2;mutation=$true},
 @{mode='real-point-show-error';dispatched=$null;mouse=0;mutation=$true},
 @{mode='real-point-post-input';dispatched=$true;mouse=2;mutation=$true}
)){
 Reset-Checkbox $case.mode $false
 $result=Set-SSEReceiptManagerBoolean ([IntPtr]8) 100 $checkboxBinding $false $true 1
 Assert-True (-not $result.ok -and $result.interference -and $result.inputDispatched -eq $case.dispatched -and
  $result.mutationStarted -eq $case.mutation -and [SW]::MouseCalls -eq $case.mouse -and $null -eq $script:SSE_CAPTURED_OPERATION_RESULT) `
  "Actual checkbox '$($case.mode)' hid dispatch evidence or exited through Emit."
 if($case.mode -ceq 'checkbox-indeterminate-after-point'){Assert-True ($null -eq $result.after) 'Unknown Boolean readback became a known false.'}
}
foreach($wanted in @($false,$true)){
 Reset-Checkbox 'checkbox-indeterminate-before' $false
 $script:checkboxModel['synthetic.net'].checked=$null
 $result=Set-SSEReceiptManagerBoolean ([IntPtr]8) 100 $checkboxBinding $false $wanted 1
 Assert-True (-not $result.ok -and $null -eq $result.after -and -not $result.mutationStarted -and [SW]::MouseCalls -eq 0) 'Unknown Boolean before-value became a noop or false.'
}
foreach($case in @(@{mode='checkbox-capture';mouse=0},@{mode='checkbox-capture-after-point';mouse=2})){
 Reset-Checkbox $case.mode $false
 $caught=$null
 try{$null=Set-SSEReceiptManagerBoolean ([IntPtr]8) 100 $checkboxBinding $false $true 1}catch{$caught=$_.Exception.Message}
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $script:SSE_CAPTURED_OPERATION_RESULT.kind -ceq 'synthetic-checkbox-capture' -and
  [Object]::ReferenceEquals($script:checkboxCapturePayload,$script:SSE_CAPTURED_OPERATION_RESULT) -and [SW]::MouseCalls -eq $case.mouse) 'Actual checkbox wrapped actual capture or lost its payload.'
}
$forwardCandidate=$forward[0].Extent.Text
$reverse=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.IfStatementAst] -and
 $n.Extent.Text.StartsWith('if ($failedField)') -and $n.Extent.Text.Contains('rollbackEntries')},$true))
Assert-True ($reverse.Count -eq 1) 'Actual inverse aggregation block ambiguous.'
$reverseCandidate=$reverse[0].Extent.Text
function Reset-Transaction([string]$Mode,[switch]$Inverse){
 Reset-Checkbox $Mode ([bool]$Inverse)
 $script:titleCommits=0
 $script:checkboxModel['synthetic.title']=[pscustomobject]@{rid='42.7.11';aid='synthetic.title';type='Edit';val=$(if($Inverse){'new-title'}else{'old-title'});on=$true;x=10;y=10;w=80;h=20}
 $script:transactions=@(
  [pscustomobject]@{name='title';kind='text';before='old-title';requested='new-title';changed=[bool]$Inverse;
   binding=[pscustomobject]@{name='title';policy=[pscustomobject]@{valueKind='text';controlType='Edit'};node=$script:checkboxModel['synthetic.title']}},
  [pscustomobject]@{name='net';kind='boolean';before=$false;requested=$true;changed=[bool]$Inverse;binding=$checkboxBinding}
 )
 $script:toolHwnd=[IntPtr]8;$script:mainHwnd=[IntPtr]7;$script:targetPid=100;$script:waitMs=1;$script:policy=[pscustomobject]@{}
 $script:changedFields=New-Object Collections.ArrayList
 if($Inverse){$null=$script:changedFields.Add('title');$null=$script:changedFields.Add('net')}
 $script:failedField=$(if($Inverse){'note'}else{$null});$script:failedReason=$(if($Inverse){'Synthetic original failure'}else{$null})
 $script:uncertainFieldMutation=$false;$script:failedInputGuard=$false;$script:failedPointEvidence=$null
 $script:valuesBefore=@{title='old-title';net=$false};$script:requestedValues=@{title='new-title';net=$true}
 $script:expectedListFingerprint='A'*64;$script:detailFingerprintBefore='B'*64;$script:rowBefore=[pscustomobject]@{draft=$false};$script:selectionBinding=$null
}
foreach($parentCase in @(
 @{mode='checkbox-terminal-failure';dispatched=$false;mouse=0;pointError=$true},
 @{mode='checkbox-binding-input-drift';dispatched=$false;mouse=0;pointError=$false},
 @{mode='checkbox-input-at-point';dispatched=$false;mouse=0;pointError=$false},
 @{mode='real-point-post-input';dispatched=$true;mouse=2;pointError=$true},
 @{mode='real-point-show-error';dispatched=$null;mouse=0;pointError=$true}
)){
 $mode=$parentCase.mode
 Reset-Transaction $mode
 Invoke-Expression $forwardCandidate
 Assert-True ($failedField -ceq 'net' -and $failedInputGuard -and $changedFields.Count -eq 1 -and $titleCommits -eq 1 -and
  [SW]::MouseCalls -eq $parentCase.mouse -and $null -eq $script:SSE_CAPTURED_OPERATION_RESULT) 'Actual forward branch exited or lost the original owned title commit.'
 $caught=$null
 try{Invoke-Expression $reverseCandidate}catch{$caught=$_.Exception.Message}
 $aggregate=$script:SSE_CAPTURED_OPERATION_RESULT
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $aggregate.kind -ceq 'postcondition-failed' -and $aggregate.cleanupRequired -and
  $aggregate.changedFields.Count -eq 1 -and $null -ne $aggregate.failedPointEvidence -and $aggregate.failedPointEvidence.error -and
  $aggregate.failedPointEvidence.PSObject.Properties['inputDispatched'] -and $aggregate.failedPointEvidence.inputDispatched -eq $parentCase.dispatched -and
  $script:checkboxModel['synthetic.title'].val -ceq 'new-title' -and [SW]::MouseCalls -eq $parentCase.mouse) 'Actual forward failure lost its aggregate or performed a later inverse.'
 if($parentCase.pointError){
  Assert-True ($aggregate.failedPointEvidence.physicalCommit -and $aggregate.failedPointEvidence.physicalCommit.error -and
   $aggregate.failedPointEvidence.physicalCommit.PSObject.Properties['inputDispatched']) 'Actual forward point evidence disappeared behind nullable dispatch.'
 }
 Reset-Transaction $mode -Inverse
 $caught=$null
 try{Invoke-Expression $reverseCandidate}catch{$caught=$_.Exception.Message}
 $aggregate=$script:SSE_CAPTURED_OPERATION_RESULT
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $aggregate.cleanupRequired -and -not $aggregate.rollback.ok -and
  $aggregate.error.Contains('Synthetic original failure') -and $aggregate.rollback.fields[0].error -and
  $aggregate.rollback.fields[0].field -ceq 'net' -and $aggregate.rollback.fields[1].field -ceq 'title' -and
  $aggregate.rollback.fields[0].PSObject.Properties['pointInputDispatched'] -and
  $aggregate.rollback.fields[0].pointInputDispatched -eq $parentCase.dispatched -and
  $aggregate.rollback.fields[1].method -ceq 'not-attempted' -and $titleCommits -eq 0 -and [SW]::MouseCalls -eq $parentCase.mouse) 'Actual inverse Boolean failure erased its first cause or continued writing.'
 if($parentCase.pointError){
  Assert-True ($aggregate.rollback.fields[0].pointEvidence -and $aggregate.rollback.fields[0].pointEvidence.error -and
   $aggregate.rollback.fields[0].pointEvidence.PSObject.Properties['inputDispatched']) 'Actual inverse point evidence disappeared behind nullable dispatch.'
 }
}
Reset-Transaction 'checkbox-positive' -Inverse
$caught=$null
try{Invoke-Expression $reverseCandidate}catch{$caught=$_.Exception.Message}
$aggregate=$script:SSE_CAPTURED_OPERATION_RESULT
Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $aggregate.rollback.ok -and -not $aggregate.cleanupRequired -and
 $aggregate.error.Contains('Synthetic original failure') -and $script:checkboxModel['synthetic.title'].val -ceq 'old-title' -and
 $script:checkboxModel['synthetic.net'].checked -eq $false -and $titleCommits -eq 1 -and [SW]::MouseCalls -eq 2) 'Actual ordinary reverse no longer restores both own fields.'
Write-Output 'Receipt checkbox: actual physical producer, both directions, noops, original binding/input, dispatch/capture and forward/inverse aggregation passed.'
