$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$source=[IO.File]::ReadAllText((Join-Path $repo 'powershell/sse-worker.ps1'))
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$errors)
if($errors.Count){throw 'Worker source cannot be parsed'}
$clauses=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.SwitchStatementAst]},$true)|
 ForEach-Object{$_.Clauses}|Where-Object{$_.Item1 -is [Management.Automation.Language.StringConstantExpressionAst] -and $_.Item1.Value -ceq 'bulk_action'})
if($clauses.Count -ne 1){throw 'Actual bulk operation must be unique'}
$body=$clauses[0].Item2.Extent.Text
$operation=[scriptblock]::Create($body.Substring(1,$body.Length-2))
$tracked=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.SwitchStatementAst]},$true)|
 ForEach-Object{$_.Clauses}|Where-Object{$_.Item1 -is [Management.Automation.Language.StringConstantExpressionAst] -and $_.Item1.Value -ceq 'tracked_set_value'})
if($tracked.Count -ne 1){throw 'Actual tracked field operation must be unique'}
$emittedKinds=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
foreach($command in @($tracked[0].Item2.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst]},$true))){
 if($command.GetCommandName() -ceq 'Fail' -and $command.CommandElements.Count -ge 3 -and
  $command.CommandElements[-1] -is [Management.Automation.Language.StringConstantExpressionAst]){
  $null=$emittedKinds.Add([string]$command.CommandElements[-1].Value)
 }
}
foreach($table in @($tracked[0].Item2.FindAll({param($node)$node -is [Management.Automation.Language.HashtableAst]},$true))){
 foreach($pair in $table.KeyValuePairs){
  if($pair.Item1 -is [Management.Automation.Language.StringConstantExpressionAst] -and $pair.Item1.Value -ceq 'kind'){
   $pipeline=$pair.Item2
   if($pipeline -is [Management.Automation.Language.PipelineAst] -and $pipeline.PipelineElements.Count -eq 1 -and
    $pipeline.PipelineElements[0] -is [Management.Automation.Language.CommandExpressionAst] -and
    $pipeline.PipelineElements[0].Expression -is [Management.Automation.Language.StringConstantExpressionAst]){
    $null=$emittedKinds.Add([string]$pipeline.PipelineElements[0].Expression.Value)
   }
  }
 }
}
$allowlists=@($clauses[0].Item2.FindAll({param($node)
 $node -is [Management.Automation.Language.BinaryExpressionAst] -and [string]$node.Operator -ceq 'Cin' -and
 $node.Left.Extent.Text -ceq '[string]$Result.kind'
},$true)|ForEach-Object{
 $kinds=@($_.Right.FindAll({param($node)$node -is [Management.Automation.Language.StringConstantExpressionAst]},$true)|ForEach-Object Value)
 if($kinds -ccontains 'postcondition-failed'){[pscustomobject]@{kinds=$kinds}}
})
if($allowlists.Count -ne 1){throw 'Actual ordinary failure allowlist must be unique'}
foreach($kind in $allowlists[0].kinds){if(-not $emittedKinds.Contains($kind)){throw ('Allowed failure has no actual tracked field producer: '+$kind)}}
$firstKinds=@($clauses[0].Item2.FindAll({param($node)
 $node -is [Management.Automation.Language.BinaryExpressionAst] -and [string]$node.Operator -ceq 'Cin' -and
 $node.Left.Extent.Text -ceq '[string]$failedAction.result.kind'
},$true)|ForEach-Object{$_.Right.FindAll({param($node)$node -is [Management.Automation.Language.StringConstantExpressionAst]},$true)}|ForEach-Object Value)
if($firstKinds.Count -eq 0){throw 'The precise first-refusal set must be explicit'}
foreach($name in @('Resolve-BoundWriteWindow','Assert-SSEVerifiedBuildForOperation')){
 $helper=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
 if($helper.Count -ne 1){throw 'Actual first-refusal helper must be unique'}
 foreach($command in @($helper[0].Body.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst]},$true))){
  if($command.GetCommandName() -ceq 'Fail' -and $command.CommandElements.Count -ge 3 -and $command.CommandElements[-1] -is [Management.Automation.Language.StringConstantExpressionAst]){
   $null=$emittedKinds.Add([string]$command.CommandElements[-1].Value)
  }
 }
}
foreach($kind in $firstKinds){if(-not $emittedKinds.Contains($kind)){throw ('First-refusal kind has no actual producer: '+$kind)}}
$capture=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-SSECapturedOperation'},$true))
if($capture.Count -ne 1){throw 'Actual capture wrapper must be unique'}
$globalTraps=@($ast.EndBlock.Traps)
if($globalTraps.Count -ne 1){throw 'The actual global worker trap must be unique'}
$trapText=$globalTraps[0].Body.Extent.Text
$trapBody=[scriptblock]::Create($trapText.Substring(1,$trapText.Length-2))
& {
 function Emit($Result){$script:trapResult=$Result}
 $script:trapResult=$null
 try{throw 'synthetic-unhandled-child'}catch{& $trapBody}
 if(-not $script:trapResult -or $script:trapResult.ok -ne $false -or $script:trapResult.kind -cne 'worker-init' -or
  $script:trapResult.error -cne 'synthetic-unhandled-child' -or -not $script:trapResult.PSObject.Properties['position']){
  throw 'The actual worker trap no longer matches the structured executor regression'
 }
}
& {
 function Assert-SSEVerifiedBuildForOperation($Operation,$Arguments){}
 function Invoke-SSEWorkerOperation($Operation,$Arguments){throw 'synthetic-unhandled-child'}
 $script:SSE_INTERNAL_PLAN_OPERATIONS=@('tracked_set_value');$script:SSE_CAPTURE_OPERATION_RESULT=$false
 $script:SSE_CAPTURE_SENTINEL='synthetic-capture-sentinel'
 . ([scriptblock]::Create($capture[0].Extent.Text))
 try{Invoke-SSECapturedOperation 'tracked_set_value' ([pscustomobject]@{});throw 'The wrapper swallowed the child throw'}
 catch{if($_.Exception.Message -cne 'synthetic-unhandled-child'){throw}}
 if($script:SSE_CAPTURE_OPERATION_RESULT -or $null -ne $script:SSE_CAPTURED_OPERATION_RESULT){throw 'Capture cleanup did not finish after the unhandled child throw'}
}
# Provider boundaries only: the actual plan control flow is executed below.
# No production module is loaded and no window, process or input API is used.
foreach($name in @('Invoke-SSETrackedPlanOperation','Test-SSELastInputUnchanged')){
 $definition=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
 if($definition.Count -ne 1){throw ('Actual input ownership helper must be unique: '+$name)}
 . ([scriptblock]::Create($definition[0].Extent.Text))
}
function Arg($Object,[string]$Name,$Default=$null){$property=$Object.PSObject.Properties[$Name];if($property){$property.Value}else{$Default}}
function Get-SSEBoundedIntegerArg($Object,[string]$Name,$Default,$Minimum,$Maximum){Arg $Object $Name $Default}
function Get-SSEBoundedArrayArg($Object,[string]$Name,$Minimum,$Maximum){@(Arg $Object $Name)}
function Test-SSEExactProperties($Object,$Names){$true}
function Resolve-SSEPageObject($PageId,$FieldId){[pscustomobject]@{field=[pscustomobject]@{valueKind='text'}}}
function Test-SSETrackedValueEquivalent($Actual,$Expected,$Kind){$Actual -ceq $Expected}
function Fail($Message,$Kind){throw ('Unexpected fixture failure: '+$Kind)}
function Emit($Result){$script:captured=$Result}
$script:INIT_TIMINGS=[pscustomobject]@{fixture=$true}
function Get-SSELastInputTick{$script:inputTick}
function Register-OwnFixtureInput{
 if(-not $script:DESKTOP_NAME){
  $script:inputTick=[uint64](($script:inputTick+1)%4294967296)
  $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint=$script:inputTick
 }
}
function Invoke-SSECapturedOperation([string]$Operation,$Arguments){
 if($script:throwCaptured){throw 'synthetic-child-exception'}
 $null=$script:calls.Add([pscustomobject]@{operation=$Operation;fieldId=[string]$Arguments.fieldId;value=[string]$Arguments.value})
 if($Operation -ceq 'known_page_state'){
  if($script:scenario -cin @('foreign-final-read','foreign-restored-final-read')){$script:inputTick++}
  return [pscustomobject]@{ok=$true;onExpectedPage=$true;fields=@($script:fieldIds|ForEach-Object{
   [pscustomobject]@{fieldId=$_;present=$true;value=$script:values[$_]}
  })}
 }
 if($Operation -cne 'tracked_set_value'){throw 'Unexpected child operation'}
 $field=[string]$Arguments.fieldId
 if($script:values[$field] -cne [string]$Arguments.expectedBefore){throw 'Fixture must retain the live value precondition'}
 if([string]$Arguments.value -ceq ($field+'-old')){
  Register-OwnFixtureInput
  $script:values[$field]=[string]$Arguments.value
  if($script:scenario -ceq 'rollback-interference'){
   return [pscustomobject]@{ok=$false;verified=$false;kind='interference';error='Synthetic input during rollback.';
    inputGuard=[pscustomobject]@{eingriffErkannt=$true}}
  }
  if($script:scenario -ceq 'rollback-unverified'){
   return [pscustomobject]@{ok=$true;verified=$false;kind='postcondition-failed';error='Synthetic missing rollback proof.'}
  }
  if($script:scenario -ceq 'foreign-between-rollbacks'){$script:inputTick++}
  return [pscustomobject]@{ok=$true;verified=$true}
 }
 if($field -cne $script:failureField){
  Register-OwnFixtureInput
  $script:values[$field]=[string]$Arguments.value
  if($script:scenario -cin @('foreign-between-forward','foreign-wrapped-zero') -and $field -ceq 'first'){$script:inputTick++}
  if($script:scenario -ceq 'unreadable-between-forward' -and $field -ceq 'first'){$script:inputTick=$null}
  return [pscustomobject]@{ok=$true;verified=$true}
 }
 $failed=[pscustomobject]@{ok=$false;verified=$false;kind='postcondition-failed';error='Synthetic child failure.'}
 switch -CaseSensitive ($script:scenario){
  'ordinary-postcondition' {
   # A child committed and restored itself. Its public forward telemetry is
   # deliberately older than the last owned inner-rollback checkpoint.
   Register-OwnFixtureInput
   $forwardTick=$script:inputTick
   Register-OwnFixtureInput
   $failed|Add-Member NoteProperty rollback ([pscustomobject]@{versucht=$true;methode='verified-keyboard-replace';ok=$true})
   $failed|Add-Member NoteProperty inputGuard ([pscustomobject]@{nachher=$forwardTick;eingriffErkannt=$false})
   $failed|Add-Member NoteProperty fensterGuard ([pscustomobject]@{geaendert=$false})
  }
  'ordinary-precondition' {$failed.kind='precondition-failed'}
  'interference-kind' {$failed.kind='interference'}
  'interference-all-original' {$failed.kind='interference';$script:values.first='first-old'}
  'clean-first-refusal' {$failed.kind=$script:firstRefusalKind}
  'clean-first-foreign' {$failed.kind=$script:firstRefusalKind;$script:inputTick++}
  'missing-kind' {$failed.PSObject.Properties.Remove('kind')}
  'empty-kind' {$failed.kind=''}
  'unclassified-first' {$failed.kind='unclassified-child-failure'}
  'postcondition-unproved' {}
  'forward-unverified' {$failed.ok=$true}
  'child-restore-failed' {$failed|Add-Member NoteProperty rollback ([pscustomobject]@{versucht=$true;ok=$false})}
  'input-guard' {$failed|Add-Member NoteProperty inputGuard ([pscustomobject]@{eingriffErkannt=$true})}
  'window-guard' {$failed|Add-Member NoteProperty fensterGuard ([pscustomobject]@{geaendert=$true})}
  'child-refused-rollback' {$failed|Add-Member NoteProperty rollback ([pscustomobject]@{methode='not-attempted-after-interference'})}
  'unknown-outcome' {$failed|Add-Member NoteProperty outcomeUnknown $true}
  'cleanup-required' {$failed|Add-Member NoteProperty cleanupRequired $true}
  'stale-child' {$failed.kind='stale'}
  'unknown-kind' {$failed.kind='unrecognized-child-failure'}
  'rollback-interference' {$failed|Add-Member NoteProperty rollback ([pscustomobject]@{ok=$true})}
  'rollback-unverified' {$failed|Add-Member NoteProperty rollback ([pscustomobject]@{ok=$true})}
  'foreign-before-rollback' {$failed.kind='precondition-failed';$script:inputTick++}
  'foreign-between-rollbacks' {$failed.kind='precondition-failed'}
  'foreign-restored-final-read' {$failed.kind='precondition-failed'}
  default {throw 'Unknown test scenario'}
 }
 if($script:scenario -in @('interference-kind','input-guard','window-guard','child-refused-rollback','unknown-outcome','cleanup-required','stale-child','unknown-kind')){
  $script:values[$field]=[string]$Arguments.value
 }
 $failed
}
function Invoke-PlanFixture([string]$Scenario,[int]$SucceededBeforeFailure,[string]$FirstRefusalKind='case-mismatch',$InitialTick=1,[string]$Desktop=''){
 $script:firstRefusalKind=$FirstRefusalKind
 $script:scenario=$Scenario;$script:captured=$null;$script:calls=New-Object Collections.ArrayList
 $script:inputTick=$InitialTick;$script:DESKTOP_NAME=$Desktop
 $script:throwCaptured=$false
 $outerContext=[pscustomobject]@{fixture='outer'};$script:SSE_TRACKED_PLAN_INPUT_CONTEXT=$outerContext
 $script:fieldIds=@('first','second','third','fourth');$script:failureField=$script:fieldIds[$SucceededBeforeFailure]
 $script:values=@{};foreach($field in $script:fieldIds){$script:values[$field]=$field+'-old'}
 $actions=@($script:fieldIds|ForEach-Object{
  [pscustomobject]@{id=$_;operation='tracked_set_value';args=[pscustomobject]@{
   pageId='fixture.page';fieldId=$_;expectedBefore=($_+'-old');value=($_+'-new');expectedAfter=($_+'-new')
  }}
 })
 $a=[pscustomobject]@{schemaVersion=1;planKind='fill-fields';stopOnError=$true;rollback='best-effort';finalReadback=$true;
  actions=$actions;finalReadbackPlan=[pscustomobject]@{operation='known_page_state';args=[pscustomobject]@{pageId='fixture.page'}}}
 & $operation
 if(-not $script:captured){throw 'Actual bulk emitted no result'}
 if(-not [object]::ReferenceEquals($script:SSE_TRACKED_PLAN_INPUT_CONTEXT,$outerContext)){throw 'A child leaked its input context'}
 [pscustomobject]@{result=$script:captured;calls=@($script:calls);values=$script:values.Clone()}
}
function Assert-That([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
foreach($scenario in @('ordinary-postcondition','ordinary-precondition')){
 $case=Invoke-PlanFixture $scenario 1
 Assert-That ($case.calls.Count -eq 4) ($scenario+': ordinary guarded rollback must remain')
 Assert-That ($case.calls[2].fieldId -ceq 'first' -and $case.calls[2].value -ceq 'first-old') ($scenario+': wrong rollback target')
 Assert-That ($case.result.resultingState -ceq 'rolled-back-verified' -and $case.result.rollback.attempted) ($scenario+': ordinary restoration not proved')
 Assert-That ($case.result.skipped.Count -eq 2 -and $case.result.completed.Count -eq 1) ($scenario+': forward steps were not stopped')
}
$multi=Invoke-PlanFixture 'ordinary-postcondition' 2
Assert-That ($multi.calls.Count -eq 6 -and $multi.calls[3].fieldId -ceq 'second' -and $multi.calls[4].fieldId -ceq 'first') 'A proven multi-entry rollback must retain reverse order'
Assert-That ($multi.result.resultingState -ceq 'rolled-back-verified' -and $multi.result.rollback.entries.Count -eq 2 -and $multi.result.rollback.ok) 'Ordinary multiple-field restoration must still complete'
foreach($scenario in @('interference-kind','input-guard','window-guard','child-refused-rollback','unknown-outcome','cleanup-required','stale-child','unknown-kind','forward-unverified','child-restore-failed','postcondition-unproved')){
 $case=Invoke-PlanFixture $scenario 1
 Assert-That ($case.calls.Count -eq 3) ($scenario+': no new tracked write may follow lost context')
 Assert-That ($case.calls[2].operation -ceq 'known_page_state') ($scenario+': final passive readback must remain')
 Assert-That (-not $case.result.rollback.attempted -and $case.result.rollback.entries.Count -eq 0) ($scenario+': rollback must be explicitly unattempted')
 Assert-That ($case.result.rollback.skippedReason -ceq 'failed-action-lost-context') ($scenario+': refusal reason missing')
 Assert-That ($case.result.resultingState -ceq 'unknown' -and -not $case.result.verified -and $case.result.cleanupRequired) ($scenario+': uncertain result must require reconciliation')
 Assert-That ($case.values.first -ceq 'first-new') ($scenario+': completed own field was unexpectedly changed')
}
foreach($kind in $firstKinds){
 $cleanFirst=Invoke-PlanFixture 'clean-first-refusal' 0 $kind
 Assert-That ($cleanFirst.calls.Count -eq 2 -and $cleanFirst.result.resultingState -ceq 'unchanged') 'A precise first-action refusal needs no rollback or unknown state'
 Assert-That ($cleanFirst.result.kind -ceq $kind -and $cleanFirst.result.verified -and -not $cleanFirst.result.cleanupRequired) 'The original first-action failure must remain precise'
 Assert-That (-not $cleanFirst.result.rollback.PSObject.Properties['skippedReason']) 'No rollback was pending on the first clean refusal'
 $laterRefusal=Invoke-PlanFixture 'clean-first-refusal' 1 $kind
 Assert-That ($laterRefusal.calls.Count -eq 3 -and $laterRefusal.calls[2].operation -ceq 'known_page_state') 'A first-only refusal after a completed step must not start rollback input'
 Assert-That ($laterRefusal.result.rollback.skippedReason -ceq 'failed-action-lost-context' -and $laterRefusal.result.resultingState -ceq 'unknown') 'A later policy refusal must require reconciliation'
 Assert-That ($laterRefusal.values.first -ceq 'first-new') 'A later policy refusal changed a completed own field'
 $foreignFirst=Invoke-PlanFixture 'clean-first-foreign' 0 $kind
 Assert-That ($foreignFirst.calls.Count -eq 2 -and $foreignFirst.result.finalReadbackVerified -and $foreignFirst.result.failedAction.result.kind -ceq $kind) 'The first refusal or passive read was lost after foreign input'
 Assert-That ($foreignFirst.result.resultingState -ceq 'unknown' -and -not $foreignFirst.result.verified -and $foreignFirst.result.cleanupRequired -and -not $foreignFirst.result.rollback.attempted) 'A first refusal hid changed input ownership behind unchanged fields'
}
$lostFirst=Invoke-PlanFixture 'interference-kind' 0
Assert-That ($lostFirst.calls.Count -eq 2 -and $lostFirst.result.resultingState -ceq 'unknown') 'Explicit first-action interference must remain unknown'
$unprovedFirst=Invoke-PlanFixture 'forward-unverified' 0
Assert-That ($unprovedFirst.calls.Count -eq 2 -and $unprovedFirst.result.resultingState -ceq 'unknown') 'An unproved first forward result cannot establish a known stop'
foreach($scenario in @('missing-kind','empty-kind','unclassified-first','postcondition-unproved')){
 $case=Invoke-PlanFixture $scenario 0
 Assert-That ($case.calls.Count -eq 2 -and $case.result.resultingState -ceq 'unknown' -and -not $case.result.verified) ($scenario+': an unclassified first outcome must remain uncertain')
}
$original=Invoke-PlanFixture 'interference-all-original' 1
Assert-That ($original.result.finalReadbackVerified) 'The complete original values should be observed'
Assert-That ($original.calls.Count -eq 3 -and $original.result.resultingState -ceq 'unknown' -and -not $original.result.verified) 'Original visible values cannot erase acknowledged context loss'
foreach($scenario in @('rollback-interference','rollback-unverified')){
 $case=Invoke-PlanFixture $scenario 2
 Assert-That ($case.calls.Count -eq 5) ($scenario+': rollback chain must stop on its first unproved result')
 Assert-That ($case.calls[3].fieldId -ceq 'second' -and $case.calls[4].operation -ceq 'known_page_state') ($scenario+': another rollback write followed the failure')
 Assert-That ($case.result.rollback.entries.Count -eq 1 -and -not $case.result.rollback.ok) ($scenario+': failed rollback proof not retained')
 Assert-That ($case.result.rollback.skippedReason -ceq 'rollback-lost-context') ($scenario+': chain-stop reason missing')
 Assert-That ($case.result.resultingState -ceq 'unknown' -and $case.result.cleanupRequired) ($scenario+': partial rollback must remain uncertain')
 Assert-That ($case.values.first -ceq 'first-new') ($scenario+': later rollback target was changed')
}
foreach($scenario in @('foreign-between-forward','unreadable-between-forward','foreign-wrapped-zero')){
 $initialTick=$(if($scenario -ceq 'foreign-wrapped-zero'){[uint64]4294967295}else{1})
 $case=Invoke-PlanFixture $scenario 4 -InitialTick $initialTick
 Assert-That ($case.calls.Count -eq 2 -and $case.calls[1].operation -ceq 'known_page_state') ($scenario+': another child was dispatched after foreign input')
 Assert-That ($case.values.first -ceq 'first-new' -and $case.values.second -ceq 'second-old') ($scenario+': a later or reverse field changed')
 Assert-That ($case.result.failedIndex -eq 1 -and $case.result.skipped.Count -eq 2) ($scenario+': skipped actions are incorrect')
 Assert-That ($case.result.resultingState -ceq 'unknown' -and -not $case.result.ok -and $case.result.cleanupRequired) ($scenario+': context loss was hidden')
 Assert-That (-not $case.result.rollback.attempted) ($scenario+': rollback started after lost context')
}
$beforeRollback=Invoke-PlanFixture 'foreign-before-rollback' 1
Assert-That ($beforeRollback.calls.Count -eq 3 -and $beforeRollback.calls[2].operation -ceq 'known_page_state') 'A failed ordinary child must not rebase foreign input before parent rollback'
Assert-That ($beforeRollback.values.first -ceq 'first-new' -and $beforeRollback.result.resultingState -ceq 'unknown') 'The parent overwrote its completed field after losing ownership'
Assert-That (-not $beforeRollback.result.rollback.attempted -and $beforeRollback.result.rollback.skippedReason -ceq 'failed-action-lost-context') 'The parent started rollback after an ordinary child lost the input checkpoint'
$betweenRollbacks=Invoke-PlanFixture 'foreign-between-rollbacks' 2
Assert-That ($betweenRollbacks.calls.Count -eq 5 -and $betweenRollbacks.calls[3].fieldId -ceq 'second' -and $betweenRollbacks.calls[4].operation -ceq 'known_page_state') 'Foreign input between reverse steps did not stop the chain'
Assert-That ($betweenRollbacks.values.first -ceq 'first-new' -and $betweenRollbacks.values.second -ceq 'second-old' -and $betweenRollbacks.result.resultingState -ceq 'unknown') 'A reverse step rebased foreign input'
foreach($scenario in @('foreign-final-read','foreign-restored-final-read')){
 $succeeded=$(if($scenario -ceq 'foreign-final-read'){4}else{1})
 $case=Invoke-PlanFixture $scenario $succeeded
 Assert-That ($case.result.finalReadbackVerified -and -not $case.result.ok -and -not $case.result.verified -and $case.result.resultingState -ceq 'unknown') ($scenario+': matching values erased final input context loss')
}
foreach($tick in @(0,[uint64]4294967295)){
 $success=Invoke-PlanFixture 'all-success' 4 -InitialTick $tick
 Assert-That ($success.result.ok -and $success.result.resultingState -ceq 'completed-verified' -and $success.calls.Count -eq 5) 'A valid zero/wrapped own checkpoint prevented ordinary completion'
}
$unreadable=Invoke-PlanFixture 'all-success' 4 -InitialTick $null
Assert-That ($unreadable.calls.Count -eq 1 -and $unreadable.calls[0].operation -ceq 'known_page_state' -and $unreadable.result.resultingState -ceq 'unknown') 'An unreadable initial checkpoint dispatched a write'
$focusless=Invoke-PlanFixture 'all-success' 4 -InitialTick $null -Desktop 'synthetic-private-desktop'
Assert-That ($focusless.result.ok -and $focusless.calls.Count -eq 5) 'A nonphysical private-desktop plan acquired an active-desktop input guard'
$script:throwCaptured=$true;$script:inputTick=7
$outer=[pscustomobject]@{fixture='exception-outer'};$script:SSE_TRACKED_PLAN_INPUT_CONTEXT=$outer
$caught=$null
try{Invoke-SSETrackedPlanOperation ([pscustomobject]@{}) ([pscustomobject]@{checkpoint=7})|Out-Null}catch{$caught=$_}
Assert-That ($caught.Exception.Message -ceq 'synthetic-child-exception' -and [object]::ReferenceEquals($outer,$script:SSE_TRACKED_PLAN_INPUT_CONTEXT)) 'An unexpected child exception leaked or swallowed the scoped input context'
Write-Output 'Bulk-Unterbrechung: regulaere Ruecknahme, verlorener Kontext und begrenzter Rollback-Abbruch bestanden.'
