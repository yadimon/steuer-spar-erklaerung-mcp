$ErrorActionPreference='Stop'
# Reuse the synthetic UIA fixture; it loads no real worker, desktop or transport.
. (Join-Path $PSScriptRoot 'table-footer-focus-contract.ps1')
foreach ($name in @('Get-SSETableComboModelCellProof','Get-SSETableTypedEditorFocusProof','Get-SSETableComboCellValue','Complete-SSETableComboEditor')) {
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($definition.Count -ne 1) {throw 'Productive typed editor completion helper must be unique.'}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
$categoryAid=$prefix+'.DialogUI./.grpEmpf13b./.grpEmpf13b.Empf13b'
$categoryProfile=[pscustomobject]@{known=$true;bindingOk=$true;automationIdSection='grpEmpf13b';aidFallback=$true;
  observedScopePrefix='';columns=@([pscustomobject]@{index=3;header='Kategorie';controlType='ComboBox';writePolicy='typed-selection-required'})}
$categoryWanted='Synthetic category B'
function Get-SSETableReadUncachedElement {
  param($Window,$ProcessId,$Rid,$Aid,$Type)
  if ($Type -ceq 'DataItem') {return [pscustomobject]@{ok=$true;element=$script:categoryLive}}
  if ($script:mode -ceq 'late-category-value') {$script:categoryCombo.valuePattern.Current.Value='Changed category'}
  if ($script:mode -ceq 'late-child-value') {$script:categoryEdit.valuePattern.Current.Value='Changed child'}
  if ($script:mode -ceq 'late-source') {$AE::FocusedElement=$script:foreignSource}
  if ($script:mode -ceq 'late-model-column') {$script:categoryLive.gridItem.Current.Column=[int]4}
  if ($script:mode -ceq 'late-model-row') {$script:categoryLive.gridItem.Current.Row=[int]1}
  [pscustomobject]@{ok=$true;element=$script:button}
}
foreach ($case in @('hidden-combo','hidden-child','visible-combo','visible-child','visible-combo-with-child',
  'snapshot-editor-geometry','snapshot-editor-name','hidden-model-column','no-model-proof','no-popup','wrong-popup-field','foreign-popup-root',
  'wrong-header','wrong-profile','wrong-row','wrong-column','foreign-grid','cell-model-changed','row-model-changed',
  'combo-value-changed','child-value-changed','value-unreadable','readonly-unknown','foreign-source','foreign-ancestor',
  'wrong-selector','nr-editor','clipped-cell','late-category-value','late-child-value','late-source','changed-input',
  'footer-noop','footer-throws','foreign-delegate','child-parent-value-unreadable','incomplete-tree',
  'passive-table-owned-editor','passive-table-foreign-editor','passive-cell-foreign-editor','late-model-column','late-model-row')) {
  $script:mode=$case;$script:tick=10;$script:focusCalls=0;$script:sourceSnapshotReads=0
  $categoryTableNode=[pscustomobject]@{i=0;p=-1;type='Table';name='';aid=$categoryAid;rid='40.1';on=$true;x=100;y=100;w=600;h=140}
  $footer=$buttonNode.PSObject.Copy();$footer.i=1;$footer.rid='40.2'
  $cells=@(0..5 | ForEach-Object {[pscustomobject]@{i=2+$_;p=0;type='DataItem';name=$(if ($_ -eq 3) {$categoryWanted} else {''});
    val=$(if ($_ -eq 3) {$categoryWanted} else {''});aid=$categoryAid;rid='40.'+(10+$_);on=$true;x=100+100*$_;y=150;w=100;h=24}})
  $headers=@(0..5 | ForEach-Object {[pscustomobject]@{i=8+$_;p=0;type='Header';name=$(if ($_ -eq 3) {'Kategorie'} else {'Synthetic header'});
    aid=$categoryAid+'.Header'+$_;rid='40.'+(20+$_);on=$true;x=100+100*$_;y=100;w=100;h=24}})
  $tree=[pscustomobject]@{nodes=@($categoryTableNode,$footer)+$cells+$headers;stats=$stats.PSObject.Copy()}
  $state=[pscustomobject]@{ok=$true;tree=$tree;rowCells=$cells;cell=$cells[3];region=[pscustomobject]@{ok=$true;scopePrefix='';cells=$cells}}
  $editorAid=$categoryAid+'.qt_scrollarea_viewport./.grpEmpf13b.Empf13b.(3).Kategorie13b'
  $popup=[pscustomobject]@{ok=$true;kind='bound';list=[pscustomobject]@{type='List';rid='40.90';aid=$editorAid+'.QComboBoxListView'};
    target=[pscustomobject]@{type='ListItem';rid='40.91';name=$categoryWanted};binding=[pscustomobject]@{
      automationIdSection='grpEmpf13b';cellAid=$categoryAid;cellRid=$cells[3].rid;listAid=$editorAid+'.QComboBoxListView';listRid='40.90'}}
  $script:table=New-Element $categoryTableNode;$script:table.parent=$root
  $script:button=New-Element $footer;$script:button.parent=$root
  $script:categoryLive=New-Element $cells[3];$script:categoryLive.parent=$script:table
  $script:categoryLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]2;Column=[int]5;ContainingGrid=$script:table}}
  $script:categoryLive.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value=$categoryWanted;IsReadOnly=$false}}
  if ($case -ceq 'hidden-model-column') {$script:categoryLive.gridItem.Current.Column=[int]7}
  $ownModelCell=Get-SSETableComboModelCellProof ([IntPtr]111) 7 $state $categoryProfile $categoryWanted
  if (-not $ownModelCell.ok) {throw 'The initial exact semantic category/model-cell proof failed.'}
  $comboNode=$cells[3].PSObject.Copy();$comboNode.i=14;$comboNode.type='ComboBox';$comboNode.rid='40.80';$comboNode.aid=$editorAid
  $script:categoryCombo=New-Element $comboNode;$script:categoryCombo.parent=$script:table
  $script:categoryCombo.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value=$categoryWanted;IsReadOnly=$false}}
  $editNode=$comboNode.PSObject.Copy();$editNode.i=15;$editNode.p=14;$editNode.type='Edit';$editNode.rid='40.81';$editNode.aid=$editorAid+'.QLineEdit'
  $script:categoryEdit=New-Element $editNode;$script:categoryEdit.parent=$script:categoryCombo
  $script:categoryEdit.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value=$categoryWanted;IsReadOnly=$false}}
  $foreignNode=$editNode.PSObject.Copy();$foreignNode.aid=$categoryAid+'.Unknown';$foreignNode.rid='40.99'
  $script:foreignSource=New-Element $foreignNode;$script:foreignSource.parent=$root
  $AE::FocusedElement=$(if ($case -in @('hidden-child','visible-child','child-value-changed','late-child-value')) {$script:categoryEdit} else {$script:categoryCombo})
  switch ($case) {
    'visible-combo' {$tree.nodes+=@($comboNode)}
    'visible-child' {$tree.nodes+=@($comboNode,$editNode)}
    'visible-combo-with-child' {$tree.nodes+=@($comboNode,$editNode)}
    'snapshot-editor-geometry' {$bad=$comboNode.PSObject.Copy();$bad.x++;$tree.nodes+=@($bad)}
    'snapshot-editor-name' {$bad=$comboNode.PSObject.Copy();$bad.name='Changed snapshot editor';$tree.nodes+=@($bad)}
    'no-popup' {$popup.ok=$false}
    'wrong-popup-field' {$popup.list.aid=$editorAid+'.Unknown.QComboBoxListView';$popup.binding.listAid=$popup.list.aid}
    'foreign-popup-root' {$popup.list.aid='Foreign.'+$popup.list.aid;$popup.binding.listAid=$popup.list.aid}
    'wrong-header' {$headers[3].name='Synthetic other field'}
    'wrong-profile' {$categoryProfile.columns[0].header='Synthetic other field'}
    'wrong-row' {$script:categoryLive.gridItem.Current.Row=[int]1}
    'wrong-column' {$script:categoryLive.gridItem.Current.Column=[int]4}
    'no-model-proof' {$ownModelCell=$null}
    'foreign-grid' {$other=New-Element $categoryTableNode;$other.Current.ProcessId=8;$script:categoryLive.gridItem.Current.ContainingGrid=$other}
    'cell-model-changed' {$script:categoryLive.valuePattern.Current.Value='Changed category'}
    'combo-value-changed' {$script:categoryCombo.valuePattern.Current.Value='Changed category'}
    'child-value-changed' {$script:categoryEdit.valuePattern.Current.Value='Changed child'}
    'value-unreadable' {$script:categoryCombo.valuePattern=$null}
    'readonly-unknown' {$script:categoryCombo.valuePattern.Current.IsReadOnly=$null}
    'child-parent-value-unreadable' {$AE::FocusedElement=$script:categoryEdit;$script:categoryCombo.valuePattern.Current.IsReadOnly=$null}
    'foreign-delegate' {
      $foreignSnapshot=$editNode.PSObject.Copy();$foreignSnapshot.i=16;$foreignSnapshot.p=0
      $foreignSnapshot.rid='40.99';$foreignSnapshot.aid=$categoryAid+'.Unknown';$tree.nodes+=@($foreignSnapshot)
    }
    'passive-table-owned-editor' {$tree.nodes+=@($comboNode);$AE::FocusedElement=$script:table}
    {$_ -in @('passive-table-foreign-editor','passive-cell-foreign-editor')} {
      $foreignSnapshot=$comboNode.PSObject.Copy();$foreignSnapshot.aid=$categoryAid+'.Unknown';$tree.nodes+=@($foreignSnapshot)
      $AE::FocusedElement=$(if ($case -ceq 'passive-cell-foreign-editor') {$script:categoryLive} else {$script:table})
    }
    'incomplete-tree' {$tree.stats.truncated=$true}
    'foreign-source' {$script:categoryCombo.Current.ProcessId=8}
    'foreign-ancestor' {$script:table.parent=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType=[System.Windows.Automation.ControlType]::Window;NativeWindowHandle=222}}}
    'wrong-selector' {$script:categoryCombo.Current.AutomationId=$editorAid+'.Other'}
    'nr-editor' {$script:categoryCombo.Current.ControlType=[System.Windows.Automation.ControlType]::Edit;$script:categoryCombo.Current.AutomationId=$categoryAid+'.(3).BelegNr'}
    'clipped-cell' {$categoryTableNode.h=60}
    'changed-input' {$script:tick=11}
    'footer-noop' {$script:button | Add-Member ScriptMethod SetFocus {$script:focusCalls++} -Force}
    'footer-throws' {$script:button | Add-Member ScriptMethod SetFocus {$script:focusCalls++;throw 'Synthetic focus failure'} -Force}
  }
  $authority=Resolve-SSETableComboEditorAuthority $state $cells $categoryProfile $popup $categoryWanted 3 $ownModelCell
  $categoryProfile.columns[0].header='Kategorie'
  if ($case -eq 'row-model-changed') {$authority.rowValues[2]='Changed other column'}
  $script:freshSourceTree=$tree.PSObject.Copy();$script:freshSourceTree.nodes=@($tree.nodes | ForEach-Object {$_.PSObject.Copy()})
  $script:freshSourceTree.stats=$stats.PSObject.Copy()
  $result=$(if ($authority.ok) {Invoke-SSETableFooterFocus ([IntPtr]111) 7 $tree $categoryAid '40.1' 'Synthetic page' 10 'stable' $cells[3] -TypedEditorAuthority $authority}
    else {[pscustomobject]@{ok=$false;focusAttempted=$false;reason=$authority.reason}})
  $success=$case -in @('hidden-combo','hidden-child','visible-combo','visible-child','visible-combo-with-child','hidden-model-column')
  if ($result.ok -ne $success) {throw "$case`: exact owned category editor proof failed: $($result | ConvertTo-Json -Depth 6 -Compress)"}
  $expectedCalls=[int]($success -or $case -in @('footer-noop','footer-throws'))
  if ($script:focusCalls -ne $expectedCalls -or $result.focusAttempted -ne [bool]$expectedCalls) {throw "$case`: an unproved editor was closed or focus retried."}
  if ($result.sourceEvidence -and ($result.sourceEvidence | ConvertTo-Json -Depth 5 -Compress) -match $categoryWanted) {throw 'Editor diagnostics leaked case values.'}
}

# Execute the actual completion helper. The fixture supplies only UIA/provider
# reads and focus callbacks, while the complete-row resolver and independent
# bounded live editor check remain the productive implementations.
function Read-SSETableComboCellState {
  param($Window,$ExpectedPage,$SumLabel,$SumOccurrence,$RowY,$ColumnIndex,$Profile)
  if ($Window -ne [IntPtr]111 -or $ExpectedPage -cne 'Synthetic page' -or $SumLabel -cne 'Synthetic sum' -or
      $SumOccurrence -ne 1 -or $RowY -ne 150 -or $ColumnIndex -ne 3 -or $Profile -ne $categoryProfile) {
    throw 'Completion lost its profiled page/summary/row/column binding.'
  }
  $script:completionReads++
  if ($script:completionReads -eq 1) {$script:completionSelected} else {$script:completionPost}
}
function Get-DirtyStateFast {param($Window) $true}
function Get-LiveElement($Window,$Rid,$Aid) {
  if ($Window -ne [IntPtr]111 -or $Aid -cne $categoryAid) {return $null}
  if ($Rid -ceq '40.1') {$script:table}
  elseif ($Rid -ceq $script:categoryLive.rid) {$script:categoryLive}
}
function Get-UiSnapshot($Window,$MaxNodes,$TimeoutSec,$MaxDepth,$RootElement) {
  if ($Window -ne [IntPtr]111 -or $MaxNodes -ne 2048 -or $TimeoutSec -ne 5 -or $MaxDepth -ne 16 -or
      $RootElement.rid -cne '40.1') {throw 'Completion lost the bounded independent exact table walk.'}
  $liveNodes=@($script:completionPost.tree.nodes | Where-Object {$_.p -eq 0} | ForEach-Object {
    $copy=$_.PSObject.Copy();$copy.i=[int]$_.i-1;$copy.p=-1;$copy
  })
  if ($script:mode -ceq 'live-editor-remains') {
    $editorCopy=$comboNode.PSObject.Copy();$editorCopy.i=99;$editorCopy.p=-1;$liveNodes+=@($editorCopy)
  }
  [pscustomobject]@{stats=$stats.PSObject.Copy();nodes=$liveNodes}
}
function Get-SSEPageCheckerMessages {param($Tree,$Window) @()}
foreach ($case in @('completion','snapshot-editor-remains','live-editor-remains','post-row-changed','post-sum-changed',
  'post-category-changed','post-window-changed','completion-source-unknown')) {
  $script:mode=$case;$script:tick=10;$script:focusCalls=0;$script:completionReads=0;$script:sourceSnapshotReads=0
  $tree.stats=$stats.PSObject.Copy();$tree.stats.truncated=$false
  $tree.nodes=@($categoryTableNode,$footer)+$cells+$headers
  $script:table=New-Element $categoryTableNode;$script:table.parent=$root
  $script:button=New-Element $footer;$script:button.parent=$root
  $script:categoryLive=New-Element $cells[3];$script:categoryLive.parent=$script:table
  $script:categoryLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]2;Column=[int]5;ContainingGrid=$script:table}}
  $script:categoryLive.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value=$categoryWanted;IsReadOnly=$false}}
  $script:categoryCombo=New-Element $comboNode;$script:categoryCombo.parent=$script:table
  $script:categoryCombo.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value=$categoryWanted;IsReadOnly=$false}}
  $AE::FocusedElement=$script:categoryCombo
  $popup.ok=$true
  $beforeCells=@($cells | ForEach-Object {$_.PSObject.Copy()});$beforeCells[3].name='Synthetic category A';$beforeCells[3].val='Synthetic category A'
  $initial=[pscustomobject]@{ok=$true;heading='Synthetic page';rowCells=$beforeCells;tree=[pscustomobject]@{
    nodes=@($categoryTableNode,$footer)+$beforeCells+$headers;stats=$stats.PSObject.Copy()};
    region=[pscustomobject]@{ok=$true;scopePrefix='';cells=$beforeCells};
    sumRead=[pscustomobject]@{selected=[pscustomobject]@{aid=$categoryAid+'.Sum'};value='0,00'}}
  $initial | Add-Member NoteProperty cell $beforeCells[3]
  $script:categoryLive.valuePattern.Current.Value='Synthetic category A'
  $ownModelCell=Get-SSETableComboModelCellProof ([IntPtr]111) 7 $initial $categoryProfile 'Synthetic category A'
  if (-not $ownModelCell.ok) {throw 'Initial complete-row model-column authority was not derived.'}
  $script:categoryLive.valuePattern.Current.Value=$categoryWanted
  $script:completionSelected=[pscustomobject]@{ok=$true;heading='Synthetic page';rowCells=$cells;tree=$tree;
    region=[pscustomobject]@{ok=$true;scopePrefix='';cells=$cells};sumRead=$initial.sumRead}
  $postCells=@($cells | ForEach-Object {$_.PSObject.Copy()})
  $script:completionPost=[pscustomobject]@{ok=$true;heading='Synthetic page';rowCells=$postCells;tree=[pscustomobject]@{
    nodes=@($categoryTableNode,$footer)+$postCells+$headers;stats=$stats.PSObject.Copy()};
    region=[pscustomobject]@{ok=$true;scopePrefix='';cells=$postCells};sumRead=$initial.sumRead}
  $script:freshSourceTree=$tree.PSObject.Copy();$script:freshSourceTree.nodes=@($tree.nodes | ForEach-Object {$_.PSObject.Copy()})
  switch ($case) {
    'snapshot-editor-remains' {$script:completionPost.tree.nodes+=@($comboNode)}
    'post-row-changed' {$postCells[2].name='Changed other column';$postCells[2].val='Changed other column'}
    'post-sum-changed' {$script:completionPost.sumRead=[pscustomobject]@{selected=$initial.sumRead.selected;value='1,00'}}
    'post-window-changed' {$script:completionPost.tree.nodes[1]=$footer.PSObject.Copy();$script:completionPost.tree.nodes[1].rid='40.999'}
    'completion-source-unknown' {$script:categoryCombo.Current.AutomationId=$categoryAid+'.Unknown'}
  }
  $script:button | Add-Member ScriptMethod SetFocus {
    $script:focusCalls++;[System.Windows.Automation.AutomationElement]::FocusedElement=$this
    if ($script:mode -ceq 'post-category-changed') {$script:categoryLive.valuePattern.Current.Value='Changed live category'}
  } -Force
  $result=Complete-SSETableComboEditor ([IntPtr]111) 7 $initial $script:completionSelected $cells $categoryProfile `
    'Synthetic category A' $categoryWanted 3 'Synthetic page' 'Synthetic sum' 1 10 'stable' $popup $ownModelCell
  $success=$case -ceq 'completion'
  if ($result.ok -ne $success -or $result.editorClosed -ne $success -or
      $script:focusCalls -ne [int]($case -cne 'completion-source-unknown')) {
    throw "$case`: complete wanted-row/editorfree proof failed: $($result | ConvertTo-Json -Depth 4 -Compress)"
  }
  if ($success -and @($result.row).Count -ne 6) {throw 'Successful completion lost its independent whole-row return.'}
}
Write-Output 'table-typed-editor-contract: PASS (own popup/grid/field/value proof, absent delegate, exact once focus, strict negative guards)'
