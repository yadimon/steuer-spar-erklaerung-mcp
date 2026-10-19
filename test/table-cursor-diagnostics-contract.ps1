$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../powershell/table-combobox.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$parseErrors)
if (@($parseErrors).Count) {throw 'Worker syntax is invalid.'}
foreach ($helperName in @('Get-SSETableExceptionDiagnostic','Get-SSETextSha256','New-SSETablePositionPhaseDiagnostic')) {
  $helper=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq $helperName},$true))
  if ($helper.Count -ne 1) {throw 'Productive diagnostic helper is absent.'}
  . ([scriptblock]::Create($helper[0].Extent.Text))
}
$nativeIf=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$cursorPhase -cin @(''native-acquire'',''native-position-acquire'')'},$true))
if ($nativeIf.Count -ne 1) {throw 'Productive native cursor acquire branch is absent.'}
$activationTry=$nativeIf[0].Parent
while ($activationTry -and $activationTry -isnot [Management.Automation.Language.TryStatementAst]) {$activationTry=$activationTry.Parent}
if (-not $activationTry -or $activationTry.CatchClauses.Count -ne 1) {throw 'Productive activation catch is absent.'}
# Execute the actual branch and catch with synthetic callbacks only. Do not
# import the worker or its finally block, DLL, UIA, Win32, process or transport.
. ([scriptblock]::Create('function Invoke-SyntheticCursorAcquire {try {'+$nativeIf[0].Extent.Text+'} catch '+
  $activationTry.CatchClauses[0].Body.Extent.Text+'}'))
function Get-SSETableLiveInputState {
  param($Window,$ProcessId,$Aid,$Rid,[switch]$RequireKeyboard,[switch]$RequireSelection)
  $script:cursorReads++
  if ($script:mode -like 'passive-*') {
    $script:cursorRequests+=@([pscustomobject]@{keyboard=[bool]$RequireKeyboard;selection=[bool]$RequireSelection})
    $valid=$script:cursorReads -gt 1 -and $script:mode -cnotin @(
      'passive-missing-selection','passive-foreign-selection','passive-ambiguous-selection','passive-editor-active')
    return [pscustomobject]@{ok=$valid;selectedRids=$(if ($valid) {@('10.2')} else {@()});
      reason='selected-table-cursor-unbound';editorClosed=$valid;selectedCount=[int]$valid}
  }
  if ($cursorPhase -ceq 'native-position-acquire') {
    return [pscustomobject]@{ok=[bool](-not $RequireSelection -and $script:cursorReads -gt 1 -and $script:mode -ne 'position-passive-proof');selectedRids=@()}
  }
  [pscustomobject]@{ok=$(if ($script:cursorReads -eq 1) {$script:mode -eq 'existing-focus'} else {$script:mode -ne 'selected-proof'});
    selectedRids=@('10.2');reason='Synthetic keyboard proof';editorClosed=$true;focusedType='Edit';selectedCount=1;
    keyboardEvidence=[pscustomobject]@{focusedSource=[pscustomobject]@{type='Edit';processId=7;aid='Synthetic.Table.(2).BelegNr';rid='10.9'}}}
}
function Invoke-SSETableFooterFocus {
  param($Hwnd,$ProcessId,$Tree,$TableAid,$TableRid,$ExpectedPage,$InputBaseline,$WindowFingerprint,$OwnedCell,$NumberAnchor,$NumberModel,$NumberPolicy,[switch]$AllowPositionNameSource)
  if([bool]$AllowPositionNameSource -ne ($cursorPhase -ceq 'native-position-acquire')) {throw 'Position-name permission was omitted or granted to another cursor phase.'}
  $script:footerCalls++
  if ($script:mode -like 'passive-*') {
    $type=switch ($script:mode) {
      'passive-edit-source' {'Edit';break}
      'passive-document-source' {'Document';break}
      'passive-unknown-source' {'';break}
      default {'Button'}
    }
    return [pscustomobject]@{ok=[bool]($script:mode -cne 'passive-footer-rejected');phase='after-focus';
      reason='exact-profiled-footer-focus';focusAttempted=[bool]($script:mode -cne 'passive-footer-rejected');
      sourceReason=$null;uncachedReason=$null;exceptionType=$null;exceptionMessage=$null;errorRecord=$null;
      sourceEvidence=[pscustomobject]@{focusedSource=[pscustomobject]@{type=$type};exactMatchCount=1;runtimeIdMatchCount=1};
      currentNumberCell=$null}
  }
  if ($script:mode -cin @('position-document-source','position-missing-source')) {
    return [pscustomobject]@{ok=$false;phase='source-binding';reason='footer-source-focus-unbound';focusAttempted=$false;
      sourceReason=$(if ($script:mode -ceq 'position-document-source') {'source-control-type-unbound'} else {'source-live-focus-unbound'})}
  }
  [pscustomobject]@{ok=$script:mode -ne 'footer-proof';phase='source-binding';reason='footer-source-focus-unbound';
    focusAttempted=[bool]($script:mode -ne 'footer-proof');sourceReason='source-editor-or-owned-cell-unbound';uncachedReason=$null;
    exceptionType=$null;exceptionMessage=$null;errorRecord=$null;currentNumberCell=[pscustomobject]@{rid='10.3';type='DataItem'}}
}
function LiesZeilen {$focusedSnapshot}
function Test-SSETableReadSnapshotBinding {
  param($Before,$After,[switch]$BeforeNavigation)
  $script:snapshotProofs++
  -not (($script:mode -cin @('footer-snapshot','passive-snapshot') -and $script:snapshotProofs -eq 1) -or
        ($script:mode -eq 'selection-snapshot' -and $script:snapshotProofs -eq 2))
}
function Invoke-SSETableReadAnchorSelection {
  param($Window,$ProcessId,$Snapshot,$Tick,$Fingerprint,$CurrentNumberCell)
  if ($CurrentNumberCell.rid -cne '10.3') {throw 'Native preparation replaced the current-row proof with the first anchor.'}
  $script:anchorCalls++;$script:mode -ne 'anchor-proof'
}
function Set-SSEForegroundLeaseInputCheckpoint {$script:leaseCheckpoints++}
function Publish-SSETableCursorLeaseHandover {
  $script:leasePublications++
  if ($script:mode -cin @('lease-publication','passive-lease-publication')) {return $null}
  [pscustomobject]@{synthetic=$true}
}
function Emit {param($Payload) $script:emitted=$Payload}
$cursorPhase='native-acquire';$hwnd=[IntPtr]111;$targetPid=7
$focusedSnapshot=[pscustomobject]@{navigationBinding=[pscustomobject]@{tableRootAid='Synthetic.Table';tableRootRid='10.1';heading='Synthetic';editorFree=$true}}
$erst=$focusedSnapshot;$latestTableSnapshot=[pscustomobject]@{tree=$null}
$makeCursorBinding={param($Snapshot,$Tick) [pscustomobject]@{synthetic=$true;inputEpoch=$Tick}}
# Real after-Add state: a positively proved passive footer owns keyboard focus,
# while the table retains a valid selection. No Nr. source exists to Select.
# Exercise the actual dispatcher branch; callback doubles model only each proof
# boundary, never replace the branch with a successful acquire result.
foreach ($case in @('passive-button','passive-missing-selection','passive-foreign-selection','passive-ambiguous-selection',
  'passive-editor-active','passive-edit-source','passive-document-source','passive-unknown-source','passive-footer-rejected',
  'passive-snapshot','passive-guard','passive-handover-guard','passive-lease-checkpoint','passive-lease-publication')) {
  $script:mode=$case;$script:cursorReads=0;$script:cursorRequests=@();$script:footerCalls=0;$script:snapshotProofs=0;$script:anchorCalls=0
  $script:leaseCheckpoints=0;$script:leasePublications=0;$script:emitted=$null;$script:guardPhases=@()
  $physicalUsed=$false;$viewportClickSubmitted=$false
  $cursorActivation=[pscustomobject]@{method='none';phase='not-started';reason=$null;exceptionType=$null;
    tableFocusable=$null;anchorFocusable=$null;anchorVerified=$false;subphase=$null;exceptionMessage=$null;errorRecord=$null;footerFocus=$null}
  $navigationState=[pscustomobject]@{phase='fresh-focus-readback';snapshot=$focusedSnapshot;tick=10;
    windows=[pscustomobject]@{fingerprint='Synthetic.Stable'}}
  $readNavigationGuard={param($Phase)
    $navigationState.phase=$Phase;$script:guardPhases+=@($Phase)
    -not (($script:mode -ceq 'passive-guard' -and $Phase -ceq 'native-before-semantic-selection') -or
      ($script:mode -ceq 'passive-handover-guard' -and $Phase -ceq 'native-lease-handover'))
  }
  $readFocusCheckpoint={param($Phase) $navigationState.phase=$Phase;$script:mode -cne 'passive-lease-checkpoint'}
  Invoke-SyntheticCursorAcquire
  $success=$case -ceq 'passive-button'
  if (-not $script:emitted -or $script:emitted.ok -ne $success) {throw "$case`: passive existing selection was not preserved or rejected at its real boundary."}
  if ($script:footerCalls -ne 1 -or $script:anchorCalls -ne 0 -or $script:snapshotProofs -gt 1) {
    throw "$case`: passive acquisition selected a default first cell, replayed focus or fabricated a selection snapshot."
  }
  if ($script:emitted.steps -ne 0 -or $script:emitted.physicalInputUsed -or $script:emitted.physicalInputAttempted) {
    throw "$case`: passive acquisition issued cursor input."
  }
  if ($success) {
    if ($script:cursorReads -ne 2 -or -not $script:cursorRequests[1].selection -or $script:cursorRequests[1].keyboard -or
        $script:snapshotProofs -ne 1 -or $script:leaseCheckpoints -ne 1 -or $script:leasePublications -ne 1 -or
        ($script:emitted.selectedRids -join '|') -cne '10.2' -or
        ($script:guardPhases -join '|') -cne 'native-before-semantic-selection|native-lease-handover') {
      throw 'Passive acquire skipped a fresh selected-table, snapshot, navigation, epoch or publication proof.'
    }
  } else {
    if ($script:emitted.retryable -ne $false -or
        $script:emitted.outcomeUnknown -ne ($case -cne 'passive-footer-rejected') -or
        ($script:leasePublications -gt 0 -and $case -cne 'passive-lease-publication')) {
      throw "$case`: rejected passive acquire published authority, retried or lost its focus uncertainty."
    }
    if ($case -cin @('passive-missing-selection','passive-foreign-selection','passive-ambiguous-selection','passive-editor-active') -and
        ($script:cursorReads -ne 2 -or -not $script:cursorRequests[1].selection)) {
      throw "$case`: invalid selection did not reach the existing required-selection proof."
    }
  }
}
foreach ($case in @('existing-focus','selected-after-footer','footer-proof','footer-snapshot','selection-guard','anchor-proof',
                    'selection-snapshot','selected-proof','lease-checkpoint','lease-publication','position-document-source','position-missing-source')) {
  $script:mode=$case;$script:cursorReads=0;$script:footerCalls=0;$script:snapshotProofs=0;$script:anchorCalls=0
  $script:leaseCheckpoints=0;$script:leasePublications=0;$script:emitted=$null
  $physicalUsed=$false;$viewportClickSubmitted=$false
  $cursorActivation=[pscustomobject]@{method='none';phase='not-started';reason=$null;exceptionType=$null;
    tableFocusable=$null;anchorFocusable=$null;anchorVerified=$false;subphase=$null;exceptionMessage=$null;errorRecord=$null;footerFocus=$null}
  $navigationState=[pscustomobject]@{phase='fresh-focus-readback';snapshot=$focusedSnapshot;tick=10;
    windows=[pscustomobject]@{fingerprint='Synthetic.Stable'}}
  $readNavigationGuard={param($Phase) $navigationState.phase=$Phase;$script:mode -ne 'selection-guard'}
  $readFocusCheckpoint={param($Phase) $navigationState.phase=$Phase;$script:mode -ne 'lease-checkpoint'}
  Invoke-SyntheticCursorAcquire
  $success=$case -in @('existing-focus','selected-after-footer')
  $unattempted=$case -cin @('footer-proof','position-document-source','position-missing-source')
  if (-not $script:emitted -or $script:emitted.ok -ne $success) {throw "$case`: actual branch/catch proof mismatch."}
  if ($script:footerCalls -ne $(if ($case -eq 'existing-focus') {0} else {1})) {throw "$case`: footer callback retried or skipped."}
  if (-not $success) {
    if ($script:emitted.retryable -ne $false -or $script:emitted.steps -ne 0 -or $script:emitted.physicalInputUsed -or
        $script:emitted.physicalInputAttempted -or $script:emitted.outcomeUnknown -ne (-not $unattempted)) {throw "$case`: failed acquire changed its physical-input/no-retry or dispatched-focus contract."}
    $expectedSubphase=switch ($case) {
      {$_ -cin @('footer-proof','position-document-source','position-missing-source')} {'native-footer-focus';break}
      'footer-snapshot' {'native-footer-table-readback';break}
      {$_ -in @('selection-guard','anchor-proof')} {'native-semantic-selection-proof';break}
      'selection-snapshot' {'native-semantic-selection-table-readback';break}
      {$_ -in @('selected-proof','lease-checkpoint')} {'native-selected-cursor-proof';break}
      'lease-publication' {'native-lease-publication';break}
    }
    if ($cursorActivation.subphase -cne $expectedSubphase -or $cursorActivation.exceptionType -cne 'RuntimeException' -or
        -not $cursorActivation.exceptionMessage -or -not $cursorActivation.errorRecord.fullyQualifiedErrorId -or
        $cursorActivation.errorRecord.scriptLineNumber -le 0) {throw "$case`: precise throw subphase or ErrorRecord was lost."}
    $expectedSourceReason=switch($case) {
      'position-document-source' {'source-control-type-unbound';break}
      'position-missing-source' {'source-live-focus-unbound';break}
      default {'source-editor-or-owned-cell-unbound'}
    }
    if ($cursorActivation.footerFocus.sourceReason -cne $expectedSourceReason -or
        $cursorActivation.footerFocus.focusAttempted -ne (-not $unattempted)) {throw "$case`: nested footer proof was lost."}
  }
  if ($case -eq 'selection-guard' -and $script:anchorCalls -ne 0) {throw 'A failed guard still invoked the anchor selection.'}
  if ($case -eq 'selected-after-footer' -and ($script:anchorCalls -ne 1 -or $script:snapshotProofs -ne 2)) {
    throw 'A positively bound Nr. source no longer receives exactly one selection and its fresh readback.'
  }
  if ($unattempted -and ($script:snapshotProofs -ne 0 -or $script:leasePublications -ne 0)) {
    throw 'Ordinary cursor read followed an unavailable source with a snapshot, selection or lease delegation.'
  }
}
$cursorPhase='native-position-acquire'
foreach($case in @('position-empty-selection','position-document-source','position-missing-source','position-passive-proof',
  'footer-proof','footer-snapshot','lease-checkpoint','lease-publication')) {
  $script:mode=$case;$script:cursorReads=0;$script:footerCalls=0;$script:snapshotProofs=0;$script:anchorCalls=0
  $script:leaseCheckpoints=0;$script:leasePublications=0;$script:emitted=$null
  $physicalUsed=$false;$viewportClickSubmitted=$false
  $cursorActivation=[pscustomobject]@{method='none';phase='not-started';reason=$null;exceptionType=$null;
    tableFocusable=$null;anchorFocusable=$null;anchorVerified=$false;subphase=$null;exceptionMessage=$null;errorRecord=$null;footerFocus=$null}
  $navigationState=[pscustomobject]@{phase='fresh-focus-readback';snapshot=$focusedSnapshot;tick=10;
    windows=[pscustomobject]@{fingerprint='Synthetic.Stable'}}
  $readNavigationGuard={param($Phase) $navigationState.phase=$Phase;$true}
  $readFocusCheckpoint={param($Phase) $navigationState.phase=$Phase;$script:mode -ne 'lease-checkpoint'}
  Invoke-SyntheticCursorAcquire
  $success=$case -cin @('position-empty-selection','position-document-source','position-missing-source')
  if($script:emitted.ok -ne $success) {throw "$case`: position-only passive lease proof mismatch."}
  if($success -and ($script:emitted.activationSubmitted -isnot [bool] -or
      $script:emitted.physicalInputUsed -isnot [bool] -or $script:emitted.physicalInputUsed -or
      $script:emitted.steps -ne 0)) {throw 'Acquire no-action evidence was missing, inferred, mistyped or physically submitted.'}
  if($case -cin @('position-document-source','position-missing-source') -and
      $script:emitted.activationSubmitted -cne $false) {throw 'Unattempted source delegation omitted its explicit no-action acknowledgment.'}
  if($script:anchorCalls -ne 0 -or $script:footerCalls -ne 1) {throw "$case`: position acquisition selected an anchor or retried focus."}
  if($script:emitted.physicalInputUsed -or $script:emitted.steps -ne 0) {throw 'Position acquisition issued input before the broker target action.'}
  if($success -and @($script:emitted.selectedRids).Count) {throw 'An empty Qt selection was replaced by guessed UIA cell authority.'}
  if(-not $success -and $script:emitted.outcomeUnknown -ne ($case -cne 'footer-proof')) {throw "$case`: dispatched footer focus was reported as a known outcome."}
  if($case -cin @('position-document-source','position-missing-source') -and
      ($script:snapshotProofs -ne 0 -or $script:emitted.activationSubmitted -or $script:leasePublications -ne 1)) {
    throw 'Unattempted UIA source delegation changed focus or omitted its exact passive lease.'
  }
}
$unavailable=[pscustomobject]@{ok=$false;focusAttempted=$false;reason='footer-source-focus-unbound';sourceReason='source-control-type-unbound'}
if (Test-SSETableNativeFocusDelegation 'native-acquire' $unavailable) {throw 'Ordinary cursor read gained an unproven source bypass.'}
foreach ($invalid in @(
  @{ok=$false;focusAttempted=$true;reason='footer-source-focus-unbound';sourceReason='source-control-type-unbound'},
  @{ok=$false;focusAttempted=$false;reason='footer-source-focus-unbound';sourceReason='source-editor-or-owned-cell-unbound'},
  @{ok=$false;focusAttempted=$false;reason='footer-input-epoch-unbound';sourceReason='source-control-type-unbound'},
  @{ok=$false;reason='footer-source-focus-unbound';sourceReason='source-control-type-unbound'}
)) {
  if (Test-SSETableNativeFocusDelegation 'native-position-acquire' ([pscustomobject]$invalid)) {
    throw 'A dispatched/unsafe/stale/unknown footer result gained native source delegation.'
  }
}
$resumeIf=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$cursorPhase -ceq ''resume''' -and
  $node.Extent.Text.Contains('$resumeState=Get-SSETableLiveInputState')},$true))
if ($resumeIf.Count -ne 1) {throw 'Productive resume selection proof is absent.'}
. ([scriptblock]::Create('function Invoke-SyntheticCursorResume {try {'+$resumeIf[0].Extent.Text+'} catch '+
  $activationTry.CatchClauses[0].Body.Extent.Text+'; $cursorActivation}'))
$cursorPhase='resume'
foreach ($case in @('resume-valid','resume-live-proof','resume-selection-changed','resume-guard')) {
  $script:mode=$(if ($case -eq 'resume-live-proof') {'resume-live-proof'} else {'existing-focus'})
  $script:cursorReads=0;$script:emitted=$null
  $cursorPlan=[pscustomobject]@{selectedRids=@($(if ($case -eq 'resume-selection-changed') {'10.3'} else {'10.2'}))}
  $cursorActivation=[pscustomobject]@{method='none';phase='not-started';reason=$null;exceptionType=$null;
    tableFocusable=$null;anchorFocusable=$null;anchorVerified=$false;subphase=$null;exceptionMessage=$null;errorRecord=$null;footerFocus=$null}
  $navigationState=[pscustomobject]@{phase='fresh-focus-readback'}
  $readNavigationGuard={param($Phase,[switch]$RequireKeyboard) $navigationState.phase=$Phase;$case -ne 'resume-guard'}
  $resumeResult=Invoke-SyntheticCursorResume
  if ($case -eq 'resume-valid') {
    if ($script:emitted -or -not $resumeResult.anchorVerified -or $resumeResult.phase -cne 'resume') {
      throw 'Valid exact selection did not reach the unchanged resume path.'
    }
  } else {
    if (-not $script:emitted -or $script:emitted.ok -or $script:emitted.steps -ne 0 -or
        $script:emitted.retryable -ne $false -or $script:emitted.physicalInputAttempted -or
        $script:emitted.cursorActivation.subphase -cne 'resume-selection-proof' -or
        $script:emitted.cursorActivation.exceptionType -cne 'RuntimeException' -or
        -not $script:emitted.cursorActivation.exceptionMessage) {
      throw "$case`: rejected resume lost its actual activation diagnosis or fell through to a later failure."
    }
    $proof=$script:emitted.cursorActivation.resumeProof
    if (-not $proof -or $proof.liveInputOk -ne ($case -ne 'resume-live-proof') -or
        $proof.selectionIdentical -ne ($case -ne 'resume-selection-changed') -or
        $proof.liveInput.keyboardEvidence.focusedSource.type -cne 'Edit' -or
        $proof.expectedSelectionSignature -notmatch '^[a-f0-9]{64}$' -or
        $proof.observedSelectionSignature -notmatch '^[a-f0-9]{64}$') {throw "$case`: rejected resume conjuncts were lost."}
    if ($case -eq 'resume-guard') {
      if ($proof.navigationGuardPassed -ne $false) {throw 'Failed navigation guard was presented as a selection failure.'}
    } elseif ($null -ne $proof.navigationGuardPassed) {throw 'Short-circuited resume still ran the navigation guard.'}
    if (($proof | ConvertTo-Json -Depth 7 -Compress) -match '10\.2|10\.3|selectedRids|cursorLease|windowTitle') {
      throw 'Resume diagnostics exposed private selection/handover authority.'
    }
  }
}
$record=[Management.Automation.ErrorRecord]::new(
  [InvalidOperationException]::new('Synthetic provider failure at C:\private folder\case.bin'),
  'Synthetic.Provider.Error',[Management.Automation.ErrorCategory]::InvalidOperation,[pscustomobject]@{secret='Synthetic private case value'})
$diagnostic=Get-SSETableExceptionDiagnostic $record 'synthetic-proof'
$json=$diagnostic | ConvertTo-Json -Depth 5 -Compress
if ($diagnostic.exceptionType -cne 'InvalidOperationException' -or $diagnostic.exceptionMessage -notmatch '\[local-path\]' -or
    $diagnostic.errorRecord.fullyQualifiedErrorId -cne 'Synthetic.Provider.Error' -or $json -match 'private folder|case\.bin|secret|TargetObject|StackTrace') {
  throw 'Bounded ErrorRecord projection leaked its target/path or lost its classification.'
}
# Exercise the actual early rejection bodies before lease import. Their bounded
# diagnosis must survive the shared dispatcher checks as well as the target proof.
function Test-SSELastInputUnchanged {param($Tick) $Tick -eq 10}
function Fail {param($Message,$Kind,$Metadata) $script:phaseFailure=$Metadata}
$cursorPhase='native-position-checkpoint';$phaseInputBefore=11;$dirtyBefore=$true
$phaseWindows=[pscustomobject]@{fingerprint='current';windows=@([pscustomobject]@{role='main'})}
$inherited=[pscustomobject]@{inputEpoch=11;windowFingerprint='prior';dirty=$false;nonce='synthetic-private-authority'}
foreach($spec in @(
  @{condition='$null -eq $phaseInputBefore -or';reason='phase-precondition'},
  @{condition='-not $inherited -or';reason='inherited-context'}
)) {
  $branch=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
    $node.Clauses[0].Item1.Extent.Text.StartsWith($spec.condition)},$true))
  if($branch.Count -ne 1) {throw 'Actual shared checkpoint guard is absent or ambiguous.'}
  . ([scriptblock]::Create('function Invoke-SyntheticPhaseRejection '+$branch[0].Clauses[0].Item2.Extent.Text))
  $script:phaseFailure=$null;Invoke-SyntheticPhaseRejection
  $checkpoint=$script:phaseFailure.cursorActivation.positionCheckpoint
  if($checkpoint.reason -cne $spec.reason -or $checkpoint.inputEpoch -ne $false -or
      $null -ne $checkpoint.leaseImported -or $null -ne $checkpoint.leasePublished) {throw 'Early checkpoint drift lost its precise bounded cause.'}
  if($spec.reason -ceq 'inherited-context' -and ($checkpoint.windowSet -ne $false -or $checkpoint.dirtyState -ne $false)) {
    throw 'Inherited window or dirty-state drift lost its bounded outcome.'
  }
  if(($script:phaseFailure | ConvertTo-Json -Depth 6 -Compress) -match 'synthetic-private-authority|nonce|windowFingerprint') {
    throw 'Early checkpoint rejection exported private authority.'
  }
  $cursorPhase='native-release';$script:phaseFailure=$null;Invoke-SyntheticPhaseRejection
  if($script:phaseFailure) {throw 'Checkpoint diagnosis was attached to another cursor phase.'}
  $cursorPhase='native-position-checkpoint'
}
Write-Output 'table-cursor-diagnostics-contract: PASS (actual acquire/resume/catch/shared checkpoint guards; synthetic callbacks; precise failures; no input/retry)'
