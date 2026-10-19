$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$parseErrors)
if (@($parseErrors).Count) {throw 'Worker syntax is invalid.'}
foreach ($name in @('Test-SSEExactProperties','Test-SSETableNativeCursorStepPlan','Invoke-SSETableNativeCursorStep','Get-SSETableExceptionDiagnostic','Get-SSETextSha256',
  'Get-SSETableNativePositionCheckpointProof','Invoke-SSETableNativePositionPreparation','Test-SSETableNumberPolicy')) {
  $definitions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($definitions.Count -ne 1) {throw 'Productive private step helper must be unique.'}
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
# No actual UIA, Win32, process, worker or transport is loaded.
Add-Type -TypeDefinition @'
namespace System.Windows.Automation {
 public static class AutomationElement {public static object FocusedElement;}
 public static class ControlType {public const string Edit="Edit",DataItem="DataItem",Table="Table";}
}
'@
$AE=[System.Windows.Automation.AutomationElement]
$aid='Synthetic.RedThreadContent.DialogUI./.grpEmpf13b.Empf13b'
$initial=[pscustomobject]@{tabelleAnzahl=1;error=$null;cursorAnchorIsNumber=$true;ersteZelle=[pscustomobject]@{rid='Synthetic.first'};
  navigationBinding=[pscustomobject]@{complete=$true;editorFree=$true;heading='Synthetic';tableIdentity='Synthetic.headers';
    tableRootAid=$aid;tableRootRid='10.1';scopePrefix='Synthetic';selectionMethod='synthetic';summaryIdentity='Synthetic.sum';
    summaryValue='30,00';contentSignature='initial'}}
$binding=[pscustomobject]@{inputEpoch=10;windowFingerprint='stable';dpi=96;clientOrigin=@(100,200)}
function Get-SSETableReadViewportBounds {
  param($Tree,$Snapshot,$Geometry,$Dpi,$ClientOrigin)
  if ($Dpi -ne 96 -or $Geometry.coordinateSpace -cne 'qt-native-screen' -or @($Geometry.nativeViewportRect).Count -ne 4 -or
      (@($ClientOrigin) -join ',') -cne '100,200') {
    throw 'Native viewport lost its private geometry/client-origin authority.'
  }
  if ($script:mode -eq 'viewport-unbound') {return $null}
  if ($script:mode -eq 'viewport-exception') {throw 'Synthetic private viewport failure'}
  [pscustomobject]@{left=100;top=124;right=700;bottom=200}
}
function Get-SSETableLiveInputState {
  param($Window,$ProcessId,$Aid,$Rid,[switch]$RequireKeyboard,[switch]$RequireSelection)
  if ($script:mode -like 'home-retained-*') {
    $script:liveSelectionRequests+=@([bool]$RequireSelection)
    $afterKey=$script:keys.Count -eq 1
    $beforeAlignment=$afterKey -and $script:selectCalls -eq 0
    $reason='exact-table-without-editor';$ok=$true;$closed=$true
    if ($afterKey -and $script:mode -ceq 'home-retained-root-unbound') {$ok=$false;$reason='live-table-unbound'}
    elseif ($afterKey -and $script:mode -ceq 'home-retained-editor-active') {$ok=$false;$closed=$false;$reason='active-table-editor'}
    elseif ($beforeAlignment -and $RequireSelection) {$ok=$false;$reason='selected-table-cursor-unbound'}
    elseif ($script:selectCalls -gt 0 -and $script:mode -ceq 'home-retained-post-selection-lost') {$ok=$false;$reason='selected-table-cursor-unbound'}
    $selected=$(if ($RequireSelection) {@('Synthetic.row.'+$(if ($beforeAlignment) {6} else {$script:currentRow}))} else {@()})
    return [pscustomobject]@{ok=$ok;selectedRids=$selected;selectedCount=$selected.Count;reason=$reason;
      editorClosed=$closed;focusedType='DataItem';keyboardEvidence=[pscustomobject]@{focusedSource=[pscustomobject]@{
        type='DataItem';processId=7;hasKeyboardFocus=$true};directCellCount=1}}
  }
  $selected=@('Synthetic.row.'+$script:currentRow)
  if ($script:mode -eq 'selection-count') {$selected=@()}
  if ($script:mode -eq 'stale-selection-rids') {$selected=@('Synthetic.rematerialized.'+$script:currentRow)}
  [pscustomobject]@{ok=$script:mode -ne 'live-selection-lost';selectedRids=$selected;selectedCount=$selected.Count;
    reason=$(if ($script:mode -eq 'live-selection-lost') {'selected-table-cursor-unbound'} else {'exact-table-without-editor'});
    editorClosed=$true;focusedType='DataItem';keyboardEvidence=[pscustomobject]@{
      focusedSource=[pscustomobject]@{type='DataItem';processId=7;hasKeyboardFocus=$true};directCellCount=1}}
}
function Get-SSETableCursorNumberCellProof {
  param($Window,$ProcessId,$Tree,$Snapshot,$Cell,$NumberModel,$ExpectedRow,[switch]$RequireSelected,$SelectedRids,$NumberPolicy,
    $ViewportBounds,[switch]$RequireContained)
  if (-not $ViewportBounds) {throw 'Current native number proof lost its real viewport.'}
  if ($script:mode -like 'home-retained-*') {$script:numberSelectionRequests+=@([bool]$RequireSelected)}
  $contained=$script:mode -ne 'initial-row-clipped' -and ($script:mode -ne 'clipped-row' -or $script:keys.Count -eq 0)
  $postKeyNumberLost=$script:keys.Count -gt 0 -and $script:mode -cin @('home-retained-wrong-grid','home-retained-model-changed')
  [pscustomobject]@{ok=[bool]($script:currentRow -eq $ExpectedRow -and $script:mode -ne 'number-cell-lost' -and -not $postKeyNumberLost -and (-not $RequireContained -or $contained));
    reason=$(if ($script:currentRow -ne $ExpectedRow) {'current-number-cell-grid-unbound'} elseif ($script:mode -eq 'number-cell-lost') {
      'current-number-cell-not-fresh'} elseif ($postKeyNumberLost) {$(if ($script:mode -ceq 'home-retained-wrong-grid') {
        'current-number-cell-grid-unbound'} else {'current-number-cell-prior-native-value-unbound'})}
      elseif ($RequireContained -and -not $contained) {'current-number-row-outside-native-viewport'} else {'exact-current-grid-number-cell'});
    row=$script:currentRow;column=0;cell=[pscustomobject]@{rid='Synthetic.row.'+$script:currentRow};
    rowFullyContained=$contained}
}
function Invoke-SSETableFooterFocus {
  param($Window,$ProcessId,$Tree,$TableAid,$TableRid,$Heading,$Tick,$Fingerprint,$OwnedCell,$NumberAnchor,$NumberModel,
    [switch]$RequireNumberEditor,[int]$ExpectedNumberRow=-1,$NumberPolicy)
  $script:footerCalls++
  if (-not $RequireNumberEditor -or $NumberModel.Count -ne $script:step.numberModel.Count -or $ExpectedNumberRow -ne $script:step.expectedRow) {
    throw 'Own-key editor closure lost exact prior native target/value authority.'
  }
  $safe=$script:mode -notin @('mutated-number','non-number-editor','wrong-target-row','footer-noop')
  if ($safe) {$script:focusCalls++;$AE::FocusedElement=[pscustomobject]@{Current=[pscustomobject]@{ControlType='Button'}}}
  [pscustomobject]@{ok=$safe;reason='synthetic-exact-unchanged-number';phase='before-focus';sourceReason=$null;
    sourceEvidence=$null;focusAttempted=$safe;currentNumberCell=$(if ($script:mode -ceq 'home-retained-no-current') {$null}
      else {[pscustomobject]@{rid='Synthetic.row.'+$script:currentRow}})}
}
function Invoke-SSETableReadAnchorSelection {$script:selectCalls++;$script:mode -ne 'selection-noop'}
$readSnapshot={
  $script:reads++
  $result=$initial.PSObject.Copy();$result.navigationBinding=$initial.navigationBinding.PSObject.Copy()
  $result.navigationBinding.contentSignature='after-own-key'
  if ($script:mode -cin @('foreign-epoch','home-retained-foreign-epoch') -and $script:reads -eq 1) {$script:tick++}
  if ($script:mode -eq 'summary-changed') {$result.navigationBinding.summaryValue='31,00'}
  if ($script:mode -eq 'closure-changed-model' -and $script:reads -ge 2) {$result.navigationBinding.contentSignature='mutated'}
  if ($script:mode -ceq 'home-retained-post-snapshot-changed' -and $script:reads -eq 3) {$result.navigationBinding.contentSignature='mutated'}
  $result
}
$guard={param($Phase,[switch]$RequireKeyboard) $script:tick -eq $script:ownTick -and $script:mode -ne 'before-key-guard'}
$checkpoint={param($Phase) $script:tick -eq $script:ownTick}
$send={
  param($Key)
  $script:keys+=@($Key)
  if ($script:mode -eq 'send-outcome-unknown') {throw 'Synthetic SendWait failed.'}
  $script:tick++;$script:currentRow=$script:step.expectedRow
  if ($script:mode -eq 'wrong-target-row') {$script:currentRow++}
  $AE::FocusedElement=[pscustomobject]@{Current=[pscustomobject]@{ControlType=$(if ($script:mode -cin @('no-delegate','home-retained-no-delegate')) {'DataItem'} else {'Edit'})}}
}
$ownInput={param($Tick) $script:ownTick=$Tick}
function Start-Sleep {
  param([int]$Milliseconds)
  if ($script:tick -ne $script:ownTick -or $script:keys.Count -ne 1) {throw 'Settle pause lost the one proven own-key epoch.'}
  $script:pauses+=@($Milliseconds)
  if ($script:mode -eq 'foreign-during-settle') {$script:tick++}
}
$publish={
  param($Tick) $script:publications++
  if ($script:mode -eq 'publication-failed') {return $null}
  [pscustomobject]@{nonce='00000000-0000-0000-0000-000000000004';inputEpoch=$Tick}
}
$makeBinding={param($Snapshot,$Tick) [pscustomobject]@{inputEpoch=$Tick;snapshot=$Snapshot}}
foreach ($case in @('home-retained-offscreen','home-retained-root-unbound','home-retained-editor-active','home-retained-wrong-grid',
  'home-retained-model-changed','home-retained-foreign-epoch','home-retained-no-current','home-retained-no-delegate','home-retained-post-selection-lost',
  'home-retained-post-snapshot-changed','home-delegate','down-delegate','no-delegate','clipped-row','before-key-guard','live-selection-lost','number-cell-lost',
  'stale-selection-rids','native-current-row-mismatch','foreign-before-key','initial-row-clipped','viewport-unbound','bad-viewport-schema',
  'missing-native-viewport','wrong-coordinate-space',
  'mutated-number','non-number-editor','wrong-target-row','footer-noop','foreign-epoch','summary-changed','closure-changed-model',
  'selection-noop','publication-failed','send-outcome-unknown','nonce-mismatch','bad-sequence','bad-native-flags','foreign-during-settle')) {
  $script:mode=$case;$script:keys=@();$script:reads=0;$script:footerCalls=0;$script:focusCalls=0;$script:selectCalls=0;$script:publications=0
  $script:tick=10;$script:ownTick=10;$script:currentRow=1;$script:pauses=@()
  $script:liveSelectionRequests=@();$script:numberSelectionRequests=@()
  $script:step=[pscustomobject]@{transactionNonce='00000000-0000-0000-0000-000000000001';stepNonce='00000000-0000-0000-0000-000000000002';
    parentLeaseNonce='00000000-0000-0000-0000-000000000003';sequence=[int]0;key='home';modelFingerprint=('a'*64);
    currentIndex=@([int]1,[int]0);expectedRow=[int]0;geometry=[pscustomobject]@{coordinateSpace='qt-native-screen';
      tableRect=@([int]0,[int]0,[int]600,[int]200);viewportRect=@([int]0,[int]24,[int]600,[int]176);
      nativeTableRect=@([int]100,[int]200,[int]600,[int]200);nativeViewportRect=@([int]100,[int]224,[int]600,[int]176)};
    numberModel=@(0..2 | ForEach-Object {[pscustomobject]@{display='';edit='';flags=[int]35}})}
  if ($case -like 'home-retained-*') {
    $script:currentRow=6;$script:step.currentIndex[0]=[int]6
    $script:step.numberModel=@(0..6 | ForEach-Object {[pscustomobject]@{display='';edit='';flags=[int]35}})
  }
  if ($case -eq 'down-delegate') {$script:step.sequence=[int]1;$script:step.key='down';$script:step.expectedRow=[int]2}
  if ($case -eq 'nonce-mismatch') {$script:step.parentLeaseNonce='00000000-0000-0000-0000-000000000009'}
  if ($case -eq 'bad-sequence') {$script:step.sequence=[int]1}
  if ($case -eq 'bad-native-flags') {$script:step.numberModel[0].flags=[int]1}
  if ($case -eq 'native-current-row-mismatch') {$script:step.currentIndex[0]=[int]2}
  if ($case -eq 'foreign-before-key') {$script:tick=11}
  if ($case -eq 'bad-viewport-schema') {$script:step.geometry.viewportRect[2]='Untrusted rectangle'}
  if ($case -eq 'missing-native-viewport') {$script:step.geometry.PSObject.Properties.Remove('nativeViewportRect')}
  if ($case -eq 'wrong-coordinate-space') {$script:step.geometry.coordinateSpace='qt-logical-screen'}
  $plan=[pscustomobject]@{binding=$binding;step=$script:step;lease=[pscustomobject]@{nonce='00000000-0000-0000-0000-000000000003'};
    selectedRids=@('Synthetic.row.'+$script:currentRow)}
  $AE::FocusedElement=[pscustomobject]@{Current=[pscustomobject]@{ControlType='DataItem'}}
  $result=Invoke-SSETableNativeCursorStep ([IntPtr]111) 7 $initial $plan $binding $readSnapshot {$null} $guard $checkpoint `
    $send {$script:tick} $ownInput $publish $makeBinding
  $success=$case -in @('home-retained-offscreen','home-delegate','down-delegate','no-delegate','clipped-row')
  if ($result.ok -ne $success) {throw "$case`: productive one-key helper result mismatch: $($result | ConvertTo-Json -Depth 6 -Compress)"}
  $noKey=$case -in @('before-key-guard','live-selection-lost','number-cell-lost','nonce-mismatch','bad-sequence','bad-native-flags',
    'stale-selection-rids','native-current-row-mismatch','foreign-before-key','initial-row-clipped','viewport-unbound','bad-viewport-schema',
    'missing-native-viewport','wrong-coordinate-space')
  if ($script:keys.Count -ne [int](-not $noKey)) {throw "$case`: own key was retried or issued before proof."}
  if ($noKey -and ($script:footerCalls -ne 0 -or $script:focusCalls -ne 0 -or $script:selectCalls -ne 0 -or
      $script:publications -ne 0 -or $script:ownTick -ne 10)) {throw 'Rejected resume altered focus, selection, epoch or lease authority.'}
  if ($case -in @('stale-selection-rids','native-current-row-mismatch','number-cell-lost','live-selection-lost')) {
    $proof=$result.cursorResumeProof
    if (-not $proof -or $proof.expectedSelectionCount -ne 1 -or $proof.observedSelectionCount -ne 1 -or
        @($proof.expectedCurrentIndex).Count -ne 2 -or $proof.expectedNumberFlags -ne 35 -or
        $proof.liveInput.keyboardEvidence.focusedSource.type -cne 'DataItem') {throw 'Rejected resume lost its bounded independent proofs.'}
    if ($case -eq 'stale-selection-rids' -and ($proof.sameSelection -or -not $proof.liveInputOk -or -not $proof.numberCell.ok -or
        $proof.expectedSelectionSignature -ceq $proof.observedSelectionSignature)) {throw 'Stale wrapper identity was confused with native grid failure.'}
    if ($case -eq 'native-current-row-mismatch' -and (-not $proof.sameSelection -or $proof.numberCell.ok -or
        $proof.numberCell.reason -cne 'current-number-cell-grid-unbound' -or $proof.numberCell.row -ne 1 -or
        $proof.expectedCurrentIndex[0] -ne 2)) {throw 'Native current-row mismatch was confused with stale selection identity.'}
    if ($case -eq 'number-cell-lost' -and (-not $proof.sameSelection -or $proof.numberCell.ok -or
        $proof.numberCell.reason -cne 'current-number-cell-not-fresh')) {throw 'Unbound current cell reason was discarded.'}
    if ($case -eq 'live-selection-lost' -and ($proof.liveInputOk -or $proof.sameSelection -or
        $proof.liveInput.reason -cne 'selected-table-cursor-unbound')) {throw 'Live selection rejection was discarded.'}
    $encoded=$proof | ConvertTo-Json -Depth 8 -Compress
    if ($encoded.Contains('Synthetic.row.') -or $encoded -match 'numberModel|display|edit\"|nonce|inputEpoch|windowTitle|value') {
      throw 'Resume diagnosis disclosed private row values, selection wrappers or lease authority.'
    }
  }
  $pauseExpected=-not $noKey -and $case -ne 'send-outcome-unknown'
  if ($script:pauses.Count -ne [int]$pauseExpected) {throw "$case`: processing pause was missing or repeated."}
  if ($pauseExpected -and $script:pauses[0] -ne $(if ($case -eq 'down-delegate') {160} else {350})) {throw 'HOME/DOWN settle delay changed.'}
  if ($case -in @('mutated-number','non-number-editor','wrong-target-row','foreign-epoch','foreign-during-settle') -and $script:focusCalls -ne 0) {
    throw 'Rejected editor was automatically closed.'
  }
  if ($case -eq 'foreign-during-settle' -and ($script:ownTick -ne 11 -or $script:publications -ne 0)) {
    throw 'Foreign input during settle was rebased or handed over.'
  }
  if ($success -and ($script:publications -ne 1 -or $result.cursorStep.parentLeaseNonce -cne $plan.lease.nonce -or
      $result.cursorStep.stepNonce -cne $plan.step.stepNonce -or $result.steps -ne 1)) {throw 'Successful step lost consumed-nonce/progress proof.'}
  if ($case -eq 'clipped-row' -and $result.cursorStep.rowFullyContained) {throw 'Clipped model row was promoted to a contained viewport row.'}
  if ($case -eq 'send-outcome-unknown' -and ($null -ne $result.physicalInputUsed -or
      -not $result.physicalInputAttempted -or -not $result.outcomeUnknown)) {throw 'Unknown SendWait outcome was reported as completed input.'}
  if ($case -like 'home-retained-*') {
    if (($script:keys -join '|') -cne '^{HOME}' -or $script:selectCalls -gt 1 -or $script:footerCalls -gt 1) {
      throw "$case`: retained-selection alignment replayed HOME, focus or Select."
    }
    $preSelectionFailure=$case -cin @('home-retained-root-unbound','home-retained-editor-active','home-retained-wrong-grid',
      'home-retained-model-changed','home-retained-foreign-epoch','home-retained-no-current','home-retained-no-delegate')
    if ($script:selectCalls -ne [int](-not $preSelectionFailure) -or
        $script:publications -ne [int]$success) {throw "$case`: unbound current Nr./root/editor/model/epoch authorized selection or publication."}
    if ($success -and (($script:liveSelectionRequests -join '|') -cne 'True|False|True' -or
        ($script:numberSelectionRequests -join '|') -cne 'True|False|True' -or $result.cursorStep.row -ne 0)) {
      throw 'Own HOME alignment omitted the fresh root/editor proof or final required selection/current-Nr. proof.'
    }
    if ($case -ceq 'home-retained-no-delegate' -and (($script:liveSelectionRequests -join '|') -cne 'True|True' -or
        $script:footerCalls -ne 0)) {throw 'Missing Nr. source weakened the original required-selection proof.'}
    if (-not $success -and (-not $result.outcomeUnknown -or -not $result.physicalInputUsed -or
        $result.steps -ne 1 -or $result.retryable -ne $false)) {throw 'Rejected own HOME lost its one-key unknown/no-replay evidence.'}
    if ($case -cin @('home-retained-root-unbound','home-retained-editor-active','home-retained-wrong-grid','home-retained-model-changed')) {
      $post=$result.cursorActivation.postKeyProof
      if (-not $post -or $post.liveInputOk -ne (-not ($case -cin @('home-retained-root-unbound','home-retained-editor-active'))) -or
          $post.editorClosed -ne ($case -cne 'home-retained-editor-active') -or $post.selectedCount -ne 0) {
        throw "$case`: actual post-key live-input rejection was discarded or mislabeled as the pre-HOME row6 proof."
      }
      if ($case -cin @('home-retained-root-unbound','home-retained-editor-active') -and $null -ne $post.numberCell) {
        throw 'A short-circuited post-key number proof reused the pre-HOME number result.'
      }
      if ($case -cin @('home-retained-wrong-grid','home-retained-model-changed') -and
          ($post.numberCell.ok -or $post.numberCell.row -ne 0 -or $post.numberCell.column -ne 0)) {
        throw 'A rejected post-key model/Grid proof lost the actual observed row0.'
      }
      if (($post | ConvertTo-Json -Depth 6 -Compress) -match 'Synthetic.row|selectedRids|numberModel|inputEpoch|nonce|display|edit"|windowTitle') {
        throw 'Post-key proof diagnostics exposed private row/lease/model authority.'
      }
    }
  }
}
$initial | Add-Member NoteProperty kopf @('Nr.','Datum','Text')
foreach ($case in @('valid','wrong-row','initial-row-clipped','live-selection-lost','selection-count','viewport-unbound','viewport-exception','bad-policy','bad-flags','extra-field')) {
  $script:mode=$case;$script:keys=@();$script:currentRow=1;$script:footerCalls=0;$script:focusCalls=0;$script:selectCalls=0;$script:publications=0
  $position=[pscustomobject]@{targetRow=[int]1;numberModel=$script:step.numberModel;geometry=$script:step.geometry;
    numberPolicy=[pscustomobject]@{tableName='/.grpEmpf13b.Empf13b';headers=@($initial.kopf)}}
  # Rebuild the immutable model independently of preceding negative step cases.
  $position.numberModel=@(0..2 | ForEach-Object {[pscustomobject]@{display='';edit='';flags=[int]35}})
  if ($case -eq 'wrong-row') {$position.targetRow=[int]2}
  if ($case -eq 'bad-policy') {$position.numberPolicy.tableName='/.Wrong.Table'}
  if ($case -eq 'bad-flags') {$position.numberModel[1].flags=[int]1}
  if ($case -eq 'extra-field') {$position | Add-Member NoteProperty freeKeys '{DOWN}'}
  $proof=Get-SSETableNativePositionCheckpointProof ([IntPtr]111) 7 $null $initial $position 96 @(100,200)
  if ($proof.ok -ne ($case -eq 'valid')) {throw "Native target checkpoint accepted an unbound row/selection/viewport/policy: $case"}
  $expectedReason=switch($case) {
    'valid' {'exact-native-position-current-selected-contained'}
    'wrong-row' {'current-number-cell-grid-unbound'}
    'initial-row-clipped' {'current-number-row-outside-native-viewport'}
    'live-selection-lost' {'native-position-checkpoint-live-input'}
    'selection-count' {'native-position-checkpoint-selection-count'}
    'viewport-unbound' {'native-position-checkpoint-viewport'}
    'viewport-exception' {'native-position-checkpoint-proof-exception'}
    default {'native-position-checkpoint-plan'}
  }
  if($proof.reason -cne $expectedReason) {throw "$case`: fixed checkpoint cause was lost."}
  if ($script:keys.Count -or $script:footerCalls -or $script:focusCalls -or $script:selectCalls -or $script:publications) {
    throw 'Passive target checkpoint performed input, closure, selection or handover before its exact proof.'
  }
}
function Get-SSETableNumberAnchorFocusProof {
  param($Window,$ProcessId,$Tree,$TableAid,$TableRid,$Anchor,$Focused,$NumberModel,$ExpectedRow,$NumberPolicy)
  [pscustomobject]@{ok=($script:mode -notin @('mutated-number','non-number-editor','wrong-target-row'));
    reason='synthetic-target-number-proof';ownedCell=[pscustomobject]@{rid='Synthetic.row.'+$script:currentRow}}
}
function Get-SSETableNativePositionNumberAuthority {
  param($Window,$ProcessId,$Tree,$Snapshot,$Position,$Binding)
  $number=Get-SSETableNumberAnchorFocusProof $Window $ProcessId $Tree '' '' $null $AE::FocusedElement $Position.numberModel $Position.targetRow $Position.numberPolicy
  $proof=Get-SSETableNativePositionCheckpointProof $Window $ProcessId $Tree $Snapshot $Position $Binding.dpi $Binding.clientOrigin $number.ownedCell -AllowPassiveFocus
  [pscustomobject]@{ok=($number.ok -and $proof.ok);reason='synthetic-target-authority'}
}
foreach ($case in @('valid','mutated-number','non-number-editor','wrong-target-row','initial-row-clipped','foreign-before-key','closure-changed-model')) {
  $script:mode=$case;$script:keys=@();$script:currentRow=1;$script:step.expectedRow=1
  $script:footerCalls=0;$script:focusCalls=0;$script:selectCalls=0;$script:publications=0;$script:tick=10;$script:ownTick=10
  $position=[pscustomobject]@{targetRow=[int]1;numberModel=@(0..2 | ForEach-Object {[pscustomobject]@{display='';edit='';flags=[int]35}});
    geometry=$script:step.geometry;numberPolicy=[pscustomobject]@{tableName='/.grpEmpf13b.Empf13b';headers=@($initial.kopf)}}
  $AE::FocusedElement=[pscustomobject]@{Current=[pscustomobject]@{ControlType='Edit'}}
  $preparedRead={
    $copy=$initial.PSObject.Copy();$copy.navigationBinding=$initial.navigationBinding.PSObject.Copy()
    if ($script:mode -eq 'closure-changed-model') {$copy.navigationBinding.contentSignature='changed'}
    $copy
  }
  if ($case -eq 'foreign-before-key') {$script:tick=11}
  $prepared=Invoke-SSETableNativePositionPreparation ([IntPtr]111) 7 $null $initial $position $binding $preparedRead {$null} $guard
  if ($prepared.ok -ne ($case -eq 'valid')) {throw "Fresh target Nr. preparation result mismatch: $case"}
  if ($case -in @('mutated-number','non-number-editor','wrong-target-row','initial-row-clipped','foreign-before-key') -and $script:focusCalls) {
    throw 'Unknown, changed, wrong-row, clipped or foreign-epoch editor was closed.'
  }
  if ($case -eq 'valid' -and ($script:focusCalls -ne 1 -or $script:footerCalls -ne 1)) {throw 'Exact unchanged target Nr. was not closed exactly once.'}
  if ($script:keys.Count -or $script:selectCalls -or $script:publications -or $script:tick -ne $(if ($case -eq 'foreign-before-key') {11} else {10})) {
    throw 'Target Nr. preparation synthesized input, rebased the epoch, selected a cell or published authority before the outer checkpoint.'
  }
}
Write-Output 'table-cursor-step-contract: PASS (actual helper; one own key, unchanged delegate, epoch, fresh progress, exact target preparation/checkpoint, bounded no replay)'
