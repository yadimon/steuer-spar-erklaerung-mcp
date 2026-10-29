$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'receipt-close-contract.ps1')
foreach($name in @('Resolve-SSEReceiptManagerEditableFieldNode','Get-SSEReceiptManagerDetailProjection',
 'Get-SSEReceiptManagerDetailBindingFingerprint','Get-SSEReceiptManagerEditableValues','ConvertFrom-SSEReceiptManagerDisplayValue',
 'Get-SSEReceiptManagerDetailIdentityTitle','Get-SSEReceiptManagerStableCellNames','Get-SSEReceiptManagerWindowSet')){
 $definition=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
 Assert-True ($definition.Count -eq 1) 'Actual final dependency ambiguous.'
 Invoke-Expression $definition[0].Extent.Text
}
$finalTries=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.TryStatementAst] -and
 $n.Body.Extent.Text.Contains('$finalPhase = ''detail-state''') -and $n.CatchClauses.Extent.Text.Contains('finalVerificationError')},$true))
Assert-True ($finalTries.Count -eq 1) 'Actual final verification block ambiguous.'
$actualSource=Get-Content -LiteralPath (Join-Path $repository 'powershell/sse-worker.ps1') -Raw
$start=$actualSource.IndexOf('    $detailClose = $null; $detailCloseError = $null; $finalReadFailure = $null')
Assert-True ($start -ge 0 -and $start -lt $finalTries[0].Extent.StartOffset) 'Actual final context initialization missing.'
$finalCandidate=$actualSource.Substring($start,$finalTries[0].Extent.EndOffset-$start)
$finalCandidate=$finalCandidate.Replace('[Diagnostics.Stopwatch]','[VatFixtureClock]').Replace('Start-Sleep -Milliseconds','Step-VatFixtureClock -Milliseconds')
$script:basePolicy=$policy
function New-FinalNodes([switch]$Before,[switch]$Closed){
 $title=$(if($Before){'old-title'}else{'new-title'})
 if(-not $Before -and [VatSelectionFixture]::Mode -in @('final-identity-state-unknown','final-identity-input','final-identity-checkpoint') -and
  [VatSelectionFixture]::Stage -ceq 'point-dispatched'){$title='old-title'}
 $nodes=@(New-ListNodes)
 $nodes[2].name='MEINE BELEGE (2)'
 $nodes+=@(
  [pscustomobject]@{rid='42.7.21';aid='synthetic.table';type='DataItem';name=$title;on=$true;x=0;y=50;w=100;h=20},
  [pscustomobject]@{rid='42.7.22';aid='synthetic.table';type='DataItem';name='doc-1';on=$true;x=100;y=50;w=100;h=20},
  [pscustomobject]@{rid='42.7.23';aid='synthetic.table';type='DataItem';name='neighbor';on=$true;x=0;y=80;w=100;h=20},
  [pscustomobject]@{rid='42.7.24';aid='synthetic.table';type='DataItem';name='doc-2';on=$true;x=100;y=80;w=100;h=20}
 )
 if(-not $Closed){
  $nodes+=New-CloseNode
  foreach($field in @('title','date','documentNumber','amount','vatRate','net','note')){
   $value=@{title=$title;date='01.01.2025';documentNumber='doc-1';amount='2.00';vatRate='19 %';note='synthetic-note'}[$field]
   $rid='42.7.'+(@{title=31;date=32;documentNumber=33;amount=34;vatRate=35;net=36;note=37}[$field])
   if($field -ceq 'title' -and -not $Before -and [VatSelectionFixture]::Mode -ceq 'final-replacement'){$rid='42.7.99'}
   $aid='synthetic.widget_detailPanel.'+$field
   if($field -ceq 'title' -and -not $Before -and [VatSelectionFixture]::Mode -ceq 'final-aid-replacement'){$aid='synthetic.other.widget_detailPanel.title'}
   if($field -ceq 'title' -and -not $Before -and [VatSelectionFixture]::Mode -ceq 'final-unreadable'){$value=$null}
   if($field -ceq 'note' -and -not $Before -and [VatSelectionFixture]::Mode -in @('final-multifield-positive','final-second-replacement')){
    $value='next-note'
    if([VatSelectionFixture]::Mode -ceq 'final-second-replacement'){$rid='42.7.99'}
   }
   $nodes+=[pscustomobject]@{rid=$rid;aid=$aid;type=$(if($field -ceq 'net'){'CheckBox'}else{'Edit'});
    name='';val=$value;checked=$(if($field -ceq 'net'){$false}else{$null});on=$true;x=0;y=120;w=100;h=20}
  }
 }
 if([VatSelectionFixture]::Mode -ceq 'final-title-only-grid'){
  foreach($node in $nodes){if($node.type -ceq 'DataItem' -and $node.x -eq 100){$node.name=''}}
 }
 $nodes
}
function Walk-Tree($Window,$MaxNodes,[switch]$WithValues){
 $closed=[VatSelectionFixture]::Stage -ceq 'point-dispatched'
 $nodes=@(New-FinalNodes -Closed:$closed)
 if($closed){$script:finalClosedReads++}
 switch([VatSelectionFixture]::Mode){
  'final-state-unknown' {$nodes=@()}
  'final-list-invalid' {$nodes[2].name='invalid-count'}
  'final-input-at-state' {[VatSelectionFixture]::Tick=9}
  'final-checkpoint-at-state' {$script:SSE_FOREGROUND_LEASE.lastOwnedInputTick=9}
  'final-input-after-close' {if($closed){[VatSelectionFixture]::Tick=11}}
  'final-identity-state-unknown' {if($script:finalClosedReads -ge 2){$nodes=@()}}
  'final-identity-input' {if($script:finalClosedReads -ge 2){[VatSelectionFixture]::Tick=11}}
  'final-identity-checkpoint' {if($script:finalClosedReads -ge 2){$script:SSE_FOREGROUND_LEASE.lastOwnedInputTick=11}}
  'final-state-exception' {throw [InvalidOperationException]::new('Synthetic final state error')}
  'final-capture-state' {
   $script:finalCapturePayload=[pscustomobject]@{ok=$false;kind='synthetic-final-state-capture';error='Synthetic final capture'}
   Emit $script:finalCapturePayload
  }
 }
 [pscustomobject]@{nodes=$nodes;stats=[pscustomobject]@{truncated=$false;err=0;cyc=0;depthLimited=$false}}
}
function Get-Windows($Filter){
 if([VatSelectionFixture]::Mode -ceq 'final-environment-exception'){throw [InvalidOperationException]::new('Synthetic window read error')}
 if([VatSelectionFixture]::Mode -ceq 'final-capture-environment'){
  $script:finalCapturePayload=[pscustomobject]@{ok=$false;kind='synthetic-final-environment-capture';error='Synthetic final environment capture'}
  Emit $script:finalCapturePayload
 }
 @()
}
function Get-DialogInventory($TargetPid){@()}
function Get-DirtyStateFast($Window){
 if([VatSelectionFixture]::Mode -ceq 'final-input-last-read'){[VatSelectionFixture]::Tick=11}
 $false
}
$closeLive=${function:Get-LiveElement}
function Get-LiveElement($Window,$Rid,$Aid){
 if([VatSelectionFixture]::Mode -ceq 'final-input-at-close' -and $script:closeNativeReads -ge 1){[VatSelectionFixture]::Tick=9}
 if([VatSelectionFixture]::Mode -ceq 'final-capture-close' -and $Aid -ceq 'synthetic.close'){
  $script:finalCloseCaptureAid=$Aid;$script:finalCloseCapturePhase=$finalPhase
  $script:finalCapturePayload=[pscustomobject]@{ok=$false;kind='synthetic-final-close-capture';error='Synthetic close capture'}
  Emit $script:finalCapturePayload
 }
 & $closeLive $Window $Rid $Aid
}
$closeObstruction=${function:Get-SSEPointObstruction}
function Get-SSEPointObstruction($Window,$X,$Y){
 $result=& $closeObstruction $Window $X $Y
 if([VatSelectionFixture]::Mode -ceq 'final-close-obstructed'){$result.isBoundTarget=$false}
 $result
}
function Reset-Final([string]$Mode){
 Reset-Fixture $Mode
 $script:cursorMoves=0;$script:closeNativeReads=0;$script:finalClosedReads=0;$script:finalCapturePayload=$null
 $script:finalCloseCaptureAid=$null;$script:finalCloseCapturePhase=$null
 $fields=[ordered]@{}
 foreach($field in @('title','date','documentNumber','amount','vatRate','net','note')){
  $fields[$field]=[pscustomobject]@{automationIdSuffix=('.'+$field);controlType=$(if($field -ceq 'net'){'CheckBox'}else{'Edit'});
   valueKind=$(if($field -ceq 'net'){'boolean'}elseif($field -ceq 'vatRate'){'vat-rate'}elseif($field -ceq 'date'){'date'}else{'text'})}
 }
 $script:policy=[pscustomobject]@{states=[pscustomobject]@{list=$basePolicy.states.list};actions=[pscustomobject]@{};
  list=$basePolicy.list;controls=[pscustomobject]@{detailClose=$basePolicy.controls.detailClose;editableFields=[pscustomobject]$fields}}
 $script:toolHwnd=[IntPtr]8;$script:mainHwnd=[IntPtr]7;$script:targetPid=100;$script:waitMs=200
 $originalState=[pscustomobject]@{window=8;state='list';nodes=@(New-FinalNodes -Before)}
 $script:listBefore=Get-SSEReceiptManagerListProjection $originalState $policy
 $script:rowBefore=$listBefore.rows[0]
 $originalField=Resolve-SSEReceiptManagerEditableFieldNode $originalState $policy 'title'
 $script:transactions=@([pscustomobject]@{name='title';kind='text';before='old-title';requested='new-title';changed=$true;binding=$originalField})
 $script:valuesBefore=[ordered]@{title='old-title'};$script:requestedValues=[ordered]@{title='new-title'}
 $script:changedFields=@('title');$script:expectedListFingerprint=$listBefore.listFingerprint
 $script:detailFingerprintBefore=Get-SSEReceiptManagerDetailBindingFingerprint $originalState $policy
 # Use an ordinary original read for the baseline window fingerprint.
 $savedMode=[VatSelectionFixture]::Mode;[VatSelectionFixture]::Mode='final-baseline'
 $script:windowSetBefore=Get-SSEReceiptManagerWindowSet $targetPid
 [VatSelectionFixture]::Mode=$savedMode
 $script:dirtyBefore=$false;$script:selectionBinding=[pscustomobject]@{inputTickAfterClick=1}
}
Reset-Final 'final-positive'
$caught=$null
try{Invoke-Expression $finalCandidate}catch{$caught=$_.Exception.Message}
$result=$script:SSE_CAPTURED_OPERATION_RESULT
Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $result.ok -and $result.verified -and $result.detailClosed -and
 $result.changedFields.Count -eq 1 -and $result.valuesAfter.title -ceq 'new-title' -and $result.otherRowsUnchanged -and
 $result.countUnchanged -and $result.detailCloseBinding.inputTickAfterClick -eq 10 -and [SW]::MouseCalls -eq 2) 'Actual final production block lost ordinary owned success.'
Reset-Final 'final-title-only-grid'
$caught=$null
try{Invoke-Expression $finalCandidate}catch{$caught=$_.Exception.Message}
$result=$script:SSE_CAPTURED_OPERATION_RESULT
Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $result.ok -and $result.verified -and $result.otherRowsUnchanged -and
 $script:finalClosedReads -eq 1 -and [SW]::MouseCalls -eq 2) 'Existing complete title-only rebind failed or performed an unnecessary identity read.'
foreach($mode in @('final-multifield-positive','final-second-replacement')){
 Reset-Final $mode
 $originalState=[pscustomobject]@{nodes=@(New-FinalNodes -Before)}
 $noteBinding=Resolve-SSEReceiptManagerEditableFieldNode $originalState $policy 'note'
 $transactions+=[pscustomobject]@{name='note';kind='text';before='synthetic-note';requested='next-note';changed=$true;binding=$noteBinding}
 $valuesBefore.note='synthetic-note';$requestedValues.note='next-note';$changedFields=@('title','note')
 $caught=$null
 try{Invoke-Expression $finalCandidate}catch{$caught=$_.Exception.Message}
 $result=$script:SSE_CAPTURED_OPERATION_RESULT
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $result.changedFields.Count -eq 2 -and
  $result.changedFields[0] -ceq 'title' -and $result.changedFields[1] -ceq 'note' -and
  $result.valuesBefore.note -ceq 'synthetic-note' -and $result.requestedValues.note -ceq 'next-note' -and
  $result.valuesAfter.title -ceq 'new-title') 'Actual final multi-field aggregate lost a prior changed field.'
 if($mode -ceq 'final-multifield-positive'){
  Assert-True ($result.ok -and $result.valuesAfter.note -ceq 'next-note' -and $result.otherRowsUnchanged -and [SW]::MouseCalls -eq 2) 'Actual final multi-field owned success failed.'
 }else{
  Assert-True (-not $result.ok -and $result.cleanupRequired -and $null -eq $result.valuesAfter.note -and
   $result.offeneBedingungen -contains 'detail-values-mismatch' -and [SW]::MouseCalls -eq 0) 'Actual final second-field replacement was accepted or closed.'
 }
}
foreach($case in @(
 @{mode='final-state-unknown';mouse=0;phase='detail-state';kind='state-unknown'},
 @{mode='final-list-invalid';mouse=0;phase='detail-list';kind='profile-contract'},
 @{mode='final-input-at-state';mouse=0;phase='detail-state';kind=$null},
 @{mode='final-checkpoint-at-state';mouse=0;phase='detail-state';kind=$null},
 @{mode='final-state-exception';mouse=0;phase='detail-state';kind=$null},
 @{mode='final-close-obstructed';mouse=0;phase='detail-close';kind='obstructed';dispatched=$false},
 @{mode='real-point-show-error';mouse=0;phase='detail-close';kind=$null;dispatched=$null},
 @{mode='final-input-at-close';mouse=0;phase='detail-close';kind='interference';dispatched=$false},
 @{mode='final-input-after-close';mouse=2;phase='detail-close';kind='interference';dispatched=$true},
 @{mode='final-identity-state-unknown';mouse=2;phase='identity-state';kind='state-unknown'},
 @{mode='final-identity-input';mouse=2;phase='identity-list';kind=$null},
 @{mode='final-identity-checkpoint';mouse=2;phase='identity-list';kind=$null},
 @{mode='final-environment-exception';mouse=2;phase='environment-readback';kind=$null},
 @{mode='final-input-last-read';mouse=2;phase='environment-readback';kind=$null}
)){
 Reset-Final $case.mode
 $caught=$null
 try{Invoke-Expression $finalCandidate}catch{$caught=$_.Exception.Message}
 $result=$script:SSE_CAPTURED_OPERATION_RESULT
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $result -and -not $result.ok -and $result.cleanupRequired -and
  $result.kind -ceq 'postcondition-failed' -and $result.changedFields.Count -eq 1 -and $result.changedFields[0] -ceq 'title' -and
  $result.valuesBefore.title -ceq 'old-title' -and $result.requestedValues.title -ceq 'new-title' -and
  $result.finalVerificationError.phase -ceq $case.phase -and $result.finalVerificationError.kind -ceq $case.kind -and
  -not $result.rollback.attempted -and $null -eq $result.rollback.ok -and [SW]::MouseCalls -eq $case.mouse) "Actual final '$($case.mode)' lost mutations, first cause or stopped outcome."
 if($case.phase -ceq 'detail-close'){
  Assert-True ($result.detailCloseError -and $result.detailCloseError.error -and
   $result.detailCloseError.PSObject.Properties['inputDispatched'] -and
   $result.detailCloseError.inputDispatched -eq $case.dispatched) 'Close cause disappeared behind final aggregation.'
 }
 if($case.mode -in @('final-input-at-close','final-input-after-close')){
  Assert-True ($result.inputInterference -eq $true -and $result.detailCloseError.inputInterference -eq $true) 'Input loss disappeared between close and final aggregate.'
 }
 if($case.mode -in @('final-input-at-state','final-checkpoint-at-state','final-input-last-read','final-identity-input','final-identity-checkpoint')){
  Assert-True ($result.inputInterference -eq $true -and -not $result.detailCloseError) 'Final context input loss disappeared or became an invented close failure.'
 }
 if($case.mode -ceq 'real-point-show-error'){
  Assert-True ($result.detailCloseError.error -ceq 'Synthetic native foreground error') 'An actual unknown-dispatch native failure lost its original error.'
 }
}
foreach($mode in @('final-replacement','final-aid-replacement','final-unreadable')){
 Reset-Final $mode
 $caught=$null
 try{Invoke-Expression $finalCandidate}catch{$caught=$_.Exception.Message}
 $result=$script:SSE_CAPTURED_OPERATION_RESULT
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and -not $result.ok -and $result.cleanupRequired -and
  $null -eq $result.valuesAfter.title -and $result.offeneBedingungen -contains 'detail-values-mismatch' -and
  [SW]::MouseCalls -eq 0) 'Actual final loop accepted same-value replacement binding or closed it.'
}
foreach($mode in @('final-capture-state','final-capture-close','final-capture-environment')){
 Reset-Final $mode
 $caught=$null
 try{Invoke-Expression $finalCandidate}catch{$caught=$_.Exception.Message}
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $script:finalCapturePayload -and
  [Object]::ReferenceEquals($script:finalCapturePayload,$script:SSE_CAPTURED_OPERATION_RESULT)) 'Final verification wrapped or overwrote original captured result.'
 if($mode -ceq 'final-capture-close'){
  Assert-True ($script:finalCloseCaptureAid -ceq 'synthetic.close' -and $script:finalCloseCapturePhase -ceq 'detail-close' -and
   [SW]::MouseCalls -eq 0 -and -not $script:SSE_CAPTURED_OPERATION_RESULT.PSObject.Properties['detailCloseError']) 'Capture did not reach the original close callsite or was aggregated instead.'
 }
}
Write-Output 'Receipt final verification: actual production block, resolver/readers/state/list/close composition, native failures and original capture payloads passed.'
