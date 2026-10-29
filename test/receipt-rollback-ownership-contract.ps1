$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'powershell/sse-worker.ps1'),[ref]$null,[ref]$errors)
if($errors.Count){throw 'Actual worker does not parse.'}
function Assert-True($Value,[string]$Message){if(-not $Value){throw $Message}}
foreach($name in @('Get-SSEReceiptManagerState','Get-SSETextSha256','Resolve-SSEReceiptManagerEditableFieldNode','Get-SSEReceiptManagerFieldValue',
 'Test-SSEReceiptManagerFieldValue','ConvertTo-SSEReceiptManagerVatRate','Get-SSEReceiptManagerLiveEditableField',
 'Get-SSEReceiptManagerBoundFieldObservation','Set-SSEReceiptManagerVatRateSelection','Wait-SSEReceiptManagerLiveFieldValue','Fail','Emit')){
 $defs=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
 Assert-True ($defs.Count -eq 1) 'Actual helper is ambiguous.'
 Invoke-Expression $defs[0].Extent.Text
}
$sentinel=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$script:SSE_CAPTURE_SENTINEL'},$true))
Assert-True ($sentinel.Count -eq 1) 'Actual capture sentinel is ambiguous.'
Invoke-Expression $sentinel[0].Extent.Text
$script:T0=[Diagnostics.Stopwatch]::StartNew();$script:SSE_CAPTURE_OPERATION_RESULT=$true
$rollback=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.StartsWith('if ($failedField)') -and $n.Extent.Text.Contains('rollbackEntries')},$true))
$forward=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.ForEachStatementAst] -and $n.Variable.Extent.Text -ceq '$transaction' -and $n.Body.Extent.Text.Contains('$vatState = Get-SSEReceiptManagerState') -and $n.Body.Extent.Text.Contains('$commit = Commit-TrackedValue')},$true))
$finalValues=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.ForEachStatementAst] -and $n.Variable.Extent.Text -ceq '$transaction' -and
 $n.Body.Extent.Text.Contains('$valuesAfter[$transaction.name]') -and $n.Body.Extent.Text.Contains('Test-SSEReceiptManagerFieldValue')},$true))
Assert-True ($rollback.Count -eq 1 -and $forward.Count -eq 1 -and $finalValues.Count -eq 1) 'Actual receipt transaction boundaries are ambiguous.'
$vatPolicy=[pscustomobject]@{automationIdSuffix='.vat.QLineEdit';controlType='Edit';valueKind='vat-rate'}
$titlePolicy=[pscustomobject]@{automationIdSuffix='.title.QLineEdit';controlType='Edit';valueKind='text'}
$notePolicy=[pscustomobject]@{automationIdSuffix='.note.QLineEdit';controlType='Edit';valueKind='text'}
$policy=[pscustomobject]@{controls=[pscustomobject]@{editableFields=[pscustomobject]@{vatRate=$vatPolicy;title=$titlePolicy;note=$notePolicy}}}
function New-Node($Raw,[string]$Rid='42.7.1',[string]$Aid='synthetic.vat.QLineEdit'){
 [pscustomobject]@{rid=$Rid;aid=$Aid;type='Edit';val=$Raw;on=$true;w=80;h=20;ro=$false}
}
function Reset-Fixture {
 $script:policy=[pscustomobject]@{states=[pscustomobject]@{detail=[pscustomobject]@{requiredAutomationIdSuffixes=@('.state.anchor')}};actions=[pscustomobject]@{};
  controls=[pscustomobject]@{editableFields=[pscustomobject]@{vatRate=$vatPolicy;title=$titlePolicy;note=$notePolicy}}}
 $script:freshAnchors=@(New-Node '' '42.7.8' 'synthetic.state.anchor')
 $script:model=@{'42.7.1'=(New-Node '19 %');'42.7.2'=(New-Node 'new-title' '42.7.2' 'synthetic.title.QLineEdit')}
 $script:freshNodes=@(New-Node '19 %')
 $script:commits=New-Object Collections.ArrayList
 $script:outcomes=New-Object Collections.Queue
 $script:stateReads=0
 $script:vat=[pscustomobject]@{name='vatRate';kind='vat-rate';before='0 %';requested='19 %';changed=$true;binding=[pscustomobject]@{name='vatRate';policy=$vatPolicy;node=$script:model['42.7.1']}}
 $script:title=[pscustomobject]@{name='title';kind='text';before='old-title';requested='new-title';changed=$true;binding=[pscustomobject]@{name='title';policy=$titlePolicy;node=$script:model['42.7.2']}}
}
function Get-LiveElement($Window,$Rid,$Aid){$script:model[$Rid]}
function Convert-ExactElementToNode($Element){$Element}
function Walk-Tree($Window,$MaxNodes,[switch]$WithValues){
 $script:stateReads++
 foreach($node in $script:freshNodes){$script:model[$node.rid]=$node}
 [pscustomobject]@{nodes=@($script:freshNodes)+@($script:freshAnchors);stats=[pscustomobject]@{synthetic=$true}}
}
# Only the physical commit is modeled. All readers, comparers, VAT helper,
# resolver, wait loop, failure capture and transaction branches are real.
function Commit-TrackedValue($Window,$Node,$Wanted,$Expected,$Kind){
 $script:commits.Add([pscustomobject]@{field=$Node.aid;wanted=$Wanted;expected=$Expected;kind=$Kind})|Out-Null
 Assert-True ($script:outcomes.Count -gt 0) 'An unplanned physical commit was attempted.'
 $next=$script:outcomes.Dequeue();$script:model[$Node.rid].val=$next.after
 [pscustomobject]@{method=$next.method;details=[pscustomobject]@{mutationStarted=$next.mutation};interference=$next.interference;inputInterference=$next.interference}
}
function Queue-Commit($After,[string]$Method='verified-keyboard-replace',[bool]$Interference=$false,[bool]$Mutation=$true){
 $script:outcomes.Enqueue([pscustomobject]@{after=$After;method=$Method;interference=$Interference;mutation=$Mutation})
}
function Invoke-ActualRollback($Items,[bool]$LostContext=$false,[bool]$Uncertain=$false,[string]$Reason='Synthetic original transaction failure'){
 $transactions=$Items;$failedField='vatRate';$failedReason=$Reason;$uncertainFieldMutation=$Uncertain;$failedInputGuard=$LostContext
 $toolHwnd=[IntPtr]7;$mainHwnd=[IntPtr]7;$targetPid=100;$waitMs=1
 $valuesBefore=[ordered]@{vatRate='0 %';title='old-title'};$requestedValues=[ordered]@{vatRate='19 %';title='new-title'};$changedFields=@($Items|Where-Object changed|ForEach-Object name)
 $script:T0=[Diagnostics.Stopwatch]::StartNew();$script:SSE_CAPTURE_OPERATION_RESULT=$true;$script:SSE_CAPTURED_OPERATION_RESULT=$null
 try{Invoke-Expression $rollback[0].Extent.Text;throw 'Actual failure result missing.'}
 catch{if($_.Exception.Message -cne $script:SSE_CAPTURE_SENTINEL){throw}}
 finally{$script:T0.Stop();$script:SSE_CAPTURE_OPERATION_RESULT=$true}
 $script:SSE_CAPTURED_OPERATION_RESULT
}
function Assert-OpenFailure($Result,[int]$Fields=2){
 Assert-True (-not $Result.ok -and $Result.kind -ceq 'postcondition-failed' -and -not $Result.verified -and
  $Result.cleanupRequired -and -not $Result.rollback.ok -and $Result.rollback.fields.Count -eq $Fields -and
  $Result.error.Contains('Synthetic original transaction failure')) 'First failure or unresolved rollback context was lost.'
}

foreach($raw in @('7 %',$null,'Synthetic VAT label')){
 Reset-Fixture;$script:freshNodes=@(New-Node $raw)
 $result=Invoke-ActualRollback @($title,$vat)
 Assert-OpenFailure $result
 Assert-True ($script:commits.Count -eq 0 -and $script:model['42.7.2'].val -ceq 'new-title' -and
  $result.rollback.fields[0].method -ceq 'epoch-value-changed') 'Fresh foreign/unknown VAT authorized an inverse or a following write.'
}
foreach($nodes in @(
 @{items=@()},
 @{items=@((New-Node '19 %'),(New-Node '19 %' '42.7.9'))},
 @{items=@(New-Node '19 %' '42.7.9')},
 @{items=@([pscustomobject]@{rid='42.7.1';aid='synthetic.vat.QLineEdit';type='Edit';val='19 %';on=$false;w=80;h=20})}
)){
 Reset-Fixture;$script:freshNodes=$nodes.items
 $result=Invoke-ActualRollback @($title,$vat)
 Assert-OpenFailure $result
 Assert-True ($script:commits.Count -eq 0 -and $result.rollback.fields[0].method -ceq 'field-binding-changed' -and
  [string]$result.rollback.fields[0].error) 'Missing/ambiguous/disabled/replaced fresh binding lost the aggregate result or allowed a write.'
}
foreach($outcome in @(
 @{after='19 %';method='interference-before-value';interference=$true;mutation=$false},
 @{after=$null;method='verified-keyboard-replace';interference=$false;mutation=$true}
)){
 Reset-Fixture;Queue-Commit $outcome.after $outcome.method $outcome.interference $outcome.mutation
 $result=Invoke-ActualRollback @($title,$vat)
 Assert-OpenFailure $result
 Assert-True ($script:commits.Count -eq 1 -and $script:model['42.7.2'].val -ceq 'new-title' -and
  -not $result.rollback.fields[0].ok -and $result.rollback.fields[1].method -ceq 'not-attempted') 'A failed or unknown inverse continued with the preceding title.'
}
foreach($case in @(@{raw='19 %';requested='19 %'},@{raw='19,00 %';requested='19 %'},@{raw='7,00 %';requested='7 %'})){
 Reset-Fixture;$vat.requested=$case.requested;$script:model['42.7.1'].val=$case.raw;$script:freshNodes=@(New-Node $case.raw)
 Queue-Commit '';Queue-Commit 'old-title'
 $result=Invoke-ActualRollback @($title,$vat)
 Assert-True ($result.rollback.ok -and -not $result.cleanupRequired -and $script:commits.Count -eq 2 -and
  $script:commits[0].expected -ceq $case.raw -and $script:commits[0].wanted -ceq '' -and
  $script:model['42.7.2'].val -ceq 'old-title') 'A proven owned formatted rate no longer permits one ordinary inverse per field.'
}
Reset-Fixture;$script:model['42.7.1'].val='';Queue-Commit 'old-title'
$result=Invoke-ActualRollback @($title,$vat)
Assert-True ($result.rollback.ok -and -not $result.cleanupRequired -and $script:commits.Count -eq 1 -and
 $result.rollback.fields[0].method -ceq 'verified-unchanged') 'A readable empty original zero dispatched a needless VAT inverse.'
Reset-Fixture;$script:model['42.7.1'].val='';$script:model['42.7.2'].val='old-title'
$result=Invoke-ActualRollback @($title,$vat) -LostContext $true
Assert-OpenFailure $result
Assert-True ($script:commits.Count -eq 0 -and @($result.rollback.fields|Where-Object {-not $_.ok}).Count -eq 0) 'Read-only original values erased previously lost context or caused another write.'
Reset-Fixture;$vat.changed=$false;Queue-Commit '';Queue-Commit 'old-title'
$result=Invoke-ActualRollback @($title,$vat) -Uncertain $true
Assert-True ($result.rollback.fields.Count -eq 2 -and $result.rollback.ok -and $script:commits.Count -eq 2) 'A begun uncertain field disappeared from ordinary rollback accounting.'

# Generic inverse refusals and unknown readbacks stop the same chain.
foreach($outcome in @(
 @{after='new-note';method='precondition-changed';mutation=$false},
 @{after=$null;method='verified-keyboard-replace';mutation=$true}
)){
 Reset-Fixture;$noteNode=New-Node 'new-note' '42.7.3' 'synthetic.note.QLineEdit';$script:model['42.7.3']=$noteNode
 $note=[pscustomobject]@{name='note';kind='text';before='old-note';requested='new-note';changed=$true;binding=[pscustomobject]@{name='note';policy=$notePolicy;node=$noteNode}}
 Queue-Commit $outcome.after $outcome.method $false $outcome.mutation
 $result=Invoke-ActualRollback @($title,$note)
 Assert-OpenFailure $result
 Assert-True ($script:commits.Count -eq 1 -and $script:model['42.7.2'].val -ceq 'new-title') 'A generic failed/unknown inverse permitted a later write.'
}

# Execute the actual forward body after a previously changed title prefix.
foreach($nodes in @(@{items=@()},@{items=@((New-Node '19 %'),(New-Node '19 %' '42.7.9'))},@{items=@(New-Node '7 %')},@{items=@(New-Node $null)},@{items=@(New-Node '19 %' '42.7.9')})){
 Reset-Fixture;$vat.changed=$false;$vat.before='19 %';$vat.requested='0 %';$script:freshNodes=$nodes.items
 $transactions=@($title,$vat);$failedField=$null;$failedReason=$null;$uncertainFieldMutation=$false;$failedInputGuard=$false
 $toolHwnd=[IntPtr]7;$targetPid=100;$waitMs=1;$changedFields=New-Object Collections.ArrayList
 Invoke-Expression ('foreach($transaction in @($vat))'+$forward[0].Body.Extent.Text)
 Assert-True ($failedField -ceq 'vatRate' -and $failedInputGuard -and $script:commits.Count -eq 0 -and [string]$failedReason) 'A fresh forward resolution refusal escaped its transaction or lost its guard.'
 $result=Invoke-ActualRollback $transactions -LostContext $failedInputGuard -Reason $failedReason
 Assert-True ($result.kind -ceq 'postcondition-failed' -and $result.cleanupRequired -and $result.error.Contains($failedReason) -and
  $script:commits.Count -eq 0 -and $script:model['42.7.2'].val -ceq 'new-title') 'Forward binding loss allowed rollback writes or lost its first reason.'
}
foreach($node in @((New-Node $null),(New-Node '7 %'),(New-Node '19 %' '42.7.9'))){
 Reset-Fixture;$script:model['42.7.1']=$node
 $result=Invoke-ActualRollback @($title,$vat)
 Assert-OpenFailure $result
 Assert-True ($script:stateReads -eq 0 -and $script:commits.Count -eq 0) 'An initial unknown/foreign/replaced binding authorized further resolution or an inverse.'
 $vat.changed=$false;$vat.before='19 %';$vat.requested='0 %'
 $transactions=@($vat);$failedField=$null;$failedReason=$null;$uncertainFieldMutation=$false;$failedInputGuard=$false
 $toolHwnd=[IntPtr]7;$targetPid=100;$waitMs=1;$changedFields=New-Object Collections.ArrayList
 Invoke-Expression $forward[0].Extent.Text
 Assert-True ($failedField -ceq 'vatRate' -and $failedInputGuard -and $script:stateReads -eq 0 -and $script:commits.Count -eq 0) 'An initial forward binding loss entered a later mutation stage.'
}
Reset-Fixture;$vat.changed=$false;$vat.before='7 %';$vat.requested='0 %';$script:model['42.7.1'].val='7,00 %';$script:freshNodes=@(New-Node '7,00 %')
$transactions=@($vat);$failedField=$null;$failedReason=$null;$uncertainFieldMutation=$false;$failedInputGuard=$false
$toolHwnd=[IntPtr]7;$targetPid=100;$waitMs=1;$changedFields=New-Object Collections.ArrayList;Queue-Commit ''
Invoke-Expression $forward[0].Extent.Text
Assert-True (-not $failedField -and $vat.changed -and $script:commits.Count -eq 1 -and
 $script:commits[0].expected -ceq '7,00 %') 'The actual forward loop no longer clears an owned formatted VAT value once.'

# The real state reader also has terminal Fail paths. Exercise its nonterminal
# mode through the same Walk-Tree boundary, rather than replacing the reader.
$oneState=[pscustomobject]@{detail=[pscustomobject]@{requiredAutomationIdSuffixes=@('.state.anchor')}}
foreach($case in @(
 @{anchors=@();states=$oneState;kind='state-unknown'},
 @{anchors=@((New-Node '' '42.7.8' 'synthetic.state.anchor'),(New-Node '' '42.7.9' 'synthetic.state.anchor'));states=$oneState;kind='state-unknown'},
 @{anchors=@(New-Node '' '42.7.8' 'synthetic.state.anchor');states=[pscustomobject]@{detail=[pscustomobject]@{requiredAutomationIdSuffixes=@()}};kind='profile-contract'},
 @{anchors=@(New-Node '' '42.7.8' 'synthetic.state.anchor');states=[pscustomobject]@{detail=[pscustomobject]@{requiredAutomationIdSuffixes=@('.state.anchor')};other=[pscustomobject]@{requiredAutomationIdSuffixes=@('.state.anchor')}};kind='state-unknown'}
)){
 Reset-Fixture;$script:freshAnchors=$case.anchors;$policy.states=$case.states
 $script:SSE_CAPTURED_OPERATION_RESULT=$null
 $stateRefusal=Get-SSEReceiptManagerState ([IntPtr]7) $policy -WithValues -ReturnFailure
 Assert-True ($stateRefusal.ok -eq $false -and $stateRefusal.kind -ceq $case.kind -and
  $null -eq $script:SSE_CAPTURED_OPERATION_RESULT) 'Actual state reader escaped nonterminal resolution.'
 $result=Invoke-ActualRollback @($title,$vat)
 Assert-OpenFailure $result
 Assert-True ($result.rollback.fields[0].method -ceq 'state-read-failed' -and
  $result.rollback.fields[1].method -ceq 'not-attempted' -and $script:commits.Count -eq 0) 'Actual state refusal lost the aggregate or continued the inverse chain.'
 $vat.changed=$false;$vat.before='19 %';$vat.requested='0 %'
 $transactions=@($title,$vat);$failedField=$null;$failedReason=$null;$uncertainFieldMutation=$false;$failedInputGuard=$false
 $toolHwnd=[IntPtr]7;$targetPid=100;$waitMs=1;$changedFields=New-Object Collections.ArrayList
 Invoke-Expression ('foreach($transaction in @($vat))'+$forward[0].Body.Extent.Text)
 Assert-True ($failedField -ceq 'vatRate' -and $failedInputGuard -and $failedReason -ceq $stateRefusal.error -and
  $script:commits.Count -eq 0) 'Actual forward state refusal escaped its transaction.'
 $script:SSE_CAPTURED_OPERATION_RESULT=$null;$caught=$null
 try{$null=Get-SSEReceiptManagerState ([IntPtr]7) $policy -WithValues}catch{$caught=$_.Exception.Message}
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $script:SSE_CAPTURED_OPERATION_RESULT.kind -ceq $case.kind) 'Default state reader no longer uses actual Fail/Emit.'
}

# Final evidence after mutation must stay structured when a field is missing.
$finalState=[pscustomobject]@{nodes=@()};$transactions=@($vat);$valuesAfter=[ordered]@{};$valuesMatch=$true
Invoke-Expression $finalValues[0].Extent.Text
Assert-True (-not $valuesMatch -and $null -eq $valuesAfter.vatRate) 'Final missing field exited instead of retaining an unknown value.'

foreach($case in @(@{field='unknown';kind='bad-args'},@{field='vatRate';kind='profile-contract'})){
 $state=[pscustomobject]@{nodes=@()};$script:SSE_CAPTURED_OPERATION_RESULT=$null
 $refusal=Resolve-SSEReceiptManagerEditableFieldNode $state $policy $case.field -ReturnFailure
 Assert-True (-not $refusal.ok -and $refusal.kind -ceq $case.kind -and $null -eq $refusal.node -and
  $null -eq $script:SSE_CAPTURED_OPERATION_RESULT) 'Explicit nonterminal resolution emitted or lost its refusal.'
 $script:T0=[Diagnostics.Stopwatch]::StartNew();$script:SSE_CAPTURE_OPERATION_RESULT=$true;$caught=$null
 try{$null=Resolve-SSEReceiptManagerEditableFieldNode $state $policy $case.field}catch{$caught=$_.Exception.Message}
 finally{$script:T0.Stop();$script:SSE_CAPTURE_OPERATION_RESULT=$true}
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $script:SSE_CAPTURED_OPERATION_RESULT.kind -ceq $case.kind) 'Default resolver stopped using the actual terminal Fail/Emit contract.'
}
Reset-Fixture
function Walk-Tree {throw 'Synthetic native state read failure'}
$nativeFailure=Invoke-ActualRollback @($title,$vat)
Assert-OpenFailure $nativeFailure
Assert-True ($nativeFailure.rollback.fields[0].method -ceq 'state-read-failed' -and
 $nativeFailure.rollback.fields[0].error -ceq 'Synthetic native state read failure' -and $script:commits.Count -eq 0) 'A native state error lost its aggregate diagnostics or permitted a following mutation.'
$title.changed=$false;$script:model['42.7.2'].val='old-title'
$vat.changed=$false;$vat.before='19 %';$vat.requested='0 %'
$noteNode=New-Node 'old-note' '42.7.3' 'synthetic.note.QLineEdit';$script:model['42.7.3']=$noteNode
$note=[pscustomobject]@{name='note';kind='text';before='old-note';requested='new-note';changed=$false;binding=[pscustomobject]@{name='note';policy=$notePolicy;node=$noteNode}}
$transactions=@($title,$vat,$note);$failedField=$null;$failedReason=$null;$uncertainFieldMutation=$false;$failedInputGuard=$false
$toolHwnd=[IntPtr]7;$targetPid=100;$waitMs=1;$changedFields=New-Object Collections.ArrayList
Queue-Commit 'new-title'
Invoke-Expression $forward[0].Extent.Text
Assert-True ($failedField -ceq 'vatRate' -and $failedInputGuard -and $failedReason -ceq 'Synthetic native state read failure' -and
 $title.changed -and -not $note.changed -and $script:model['42.7.3'].val -ceq 'old-note' -and $script:commits.Count -eq 1) 'A full forward loop lost its native failure or wrote a following field.'
$nativeAggregate=Invoke-ActualRollback $transactions -LostContext $failedInputGuard -Reason $failedReason
Assert-True ($nativeAggregate.kind -ceq 'postcondition-failed' -and $nativeAggregate.cleanupRequired -and -not $nativeAggregate.rollback.ok -and
 $nativeAggregate.error.Contains('Synthetic native state read failure') -and $script:commits.Count -eq 1) 'Full forward native failure lost its first cause or authorized a reverse write.'
Reset-Fixture;$script:captureFixture=[pscustomobject]@{ok=$false;kind='synthetic-captured-state';error='Synthetic captured state'}
function Walk-Tree {Emit $script:captureFixture}
$captured=Invoke-ActualRollback @($title,$vat)
Assert-True ([object]::ReferenceEquals($captured,$script:captureFixture) -and $script:commits.Count -eq 0) 'Actual captured Emit result was swallowed, replaced or followed by a mutation.'
Assert-True (-not $captured.ok -and $captured.kind -ceq 'synthetic-captured-state' -and $captured.error -ceq 'Synthetic captured state') 'Captured operation fields were changed beyond standard Emit metadata.'
$vat.changed=$false;$vat.before='19 %';$vat.requested='0 %'
$transactions=@($vat);$failedField=$null;$failedReason=$null;$uncertainFieldMutation=$false;$failedInputGuard=$false
$toolHwnd=[IntPtr]7;$targetPid=100;$waitMs=1;$changedFields=New-Object Collections.ArrayList
$script:T0=[Diagnostics.Stopwatch]::StartNew();$script:SSE_CAPTURE_OPERATION_RESULT=$true;$script:SSE_CAPTURED_OPERATION_RESULT=$null;$captureError=$null
try{Invoke-Expression $forward[0].Extent.Text}catch{$captureError=$_.Exception.Message}
finally{$script:T0.Stop();$script:SSE_CAPTURE_OPERATION_RESULT=$true}
Assert-True ($captureError -ceq $script:SSE_CAPTURE_SENTINEL -and
 [object]::ReferenceEquals($script:SSE_CAPTURED_OPERATION_RESULT,$script:captureFixture) -and
 $script:commits.Count -eq 0) 'The forward native-state catch replaced the actual captured Emit result.'
Assert-True (-not $script:SSE_CAPTURED_OPERATION_RESULT.ok -and $script:SSE_CAPTURED_OPERATION_RESULT.kind -ceq 'synthetic-captured-state' -and
 $script:SSE_CAPTURED_OPERATION_RESULT.error -ceq 'Synthetic captured state') 'Forward capture changed the original operation fields.'
Write-Output 'Receipt rollback: actual forward/reverse ownership, nonterminal resolution, monotonic context loss, ordinary inverses and capture contracts passed.'
