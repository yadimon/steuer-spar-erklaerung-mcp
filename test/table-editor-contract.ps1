$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-combobox.ps1')
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$null)
function Assert-True($Value,[string]$Message) { if (-not $Value) { throw $Message } }
foreach ($name in @('Get-SSETableLiveInputState','Invoke-SSETableReadSemanticFocus','Complete-SSETableComboEditor')) {
  $functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  Assert-True ($functions.Count -eq 1) "Missing productive function: $name"
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
Add-Type -TypeDefinition @'
using System;
public static class SW {
  public static IntPtr GetForegroundWindow() { return new IntPtr(111); }
}
namespace System.Windows.Automation {
  public static class AutomationElement {
    public static object FocusedElement, Root;
    public static object FromHandle(IntPtr handle) { return Root; }
  }
  public class ElementNotAvailableException : Exception {}
  public static class SelectionPattern { public static object Pattern=new object(); }
  public static class SelectionItemPattern { public static object Pattern=new object(); }
  public static class ValuePattern { public static object Pattern=new object(); }
  public static class TogglePattern { public static object Pattern=new object(); }
  public static class ExpandCollapsePattern { public static object Pattern=new object(); }
  public static class ControlType {
    public static string Table="Table", DataGrid="DataGrid", DataItem="DataItem", ComboBox="ComboBox",
      Edit="Edit", Spinner="Spinner", List="List", ListItem="ListItem", Custom="Custom", Pane="Pane", Window="Window", Button="Button";
  }
}
'@
function New-Element([string]$Type,[string]$Rid,[string]$Aid,[int]$Y=100) {
  $element=[pscustomobject]@{rid=$Rid;parent=$null;children=@();selection=$null;valuePattern=$null;editorPatternType='';
    Current=[pscustomobject]@{ProcessId=7;AutomationId=$Aid;ControlType=$Type;HasKeyboardFocus=$true;IsEnabled=$true;IsKeyboardFocusable=$true;
      IsOffscreen=$false;NativeWindowHandle=111;
      BoundingRectangle=[pscustomobject]@{X=100;Y=$Y;Width=90;Height=24}}}
  $element | Add-Member -MemberType ScriptMethod -Name GetRuntimeId -Value { $this.rid -split '\.' }
  $element | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value {
    param($pattern,$result)
    if ($pattern -eq [System.Windows.Automation.ValuePattern]::Pattern) {
      if ($this.valuePattern) { $result.Value=$this.valuePattern;return $true };return $false
    }
    if ($pattern -eq [System.Windows.Automation.TogglePattern]::Pattern -or
        $pattern -eq [System.Windows.Automation.ExpandCollapsePattern]::Pattern) {
      return [bool](($this.editorPatternType -ceq 'toggle' -and $pattern -eq [System.Windows.Automation.TogglePattern]::Pattern) -or
        ($this.editorPatternType -ceq 'expand' -and $pattern -eq [System.Windows.Automation.ExpandCollapsePattern]::Pattern))
    }
    if ($this.selection -and $pattern -in @([System.Windows.Automation.SelectionPattern]::Pattern,[System.Windows.Automation.SelectionItemPattern]::Pattern)) {
      $result.Value=$this.selection; return $true
    }
    $false
  }
  $element | Add-Member -MemberType ScriptMethod -Name SetFocus -Value {
    $script:focusCalls++
    [System.Windows.Automation.AutomationElement]::FocusedElement=$this
    if ($script:commitMode -eq 'input') { $script:inputTick++ }
  }
  $element
}
$tableAid='Synthetic/.grpEmpf13b./.grpEmpf13b.Empf13b'
$table=New-Element 'Table' '10.1' $tableAid
$cell=New-Element 'DataItem' '10.2' $tableAid
$otherCell=New-Element 'DataItem' '10.3' $tableAid 130
$cell.parent=$table; $otherCell.parent=$table
$selectionCurrent=[pscustomobject]@{}
$selectionCurrent | Add-Member -MemberType ScriptMethod -Name GetSelection -Value { @($script:selectedElements) }
$table.selection=[pscustomobject]@{Current=$selectionCurrent}
$WLK=[pscustomobject]@{}
$WLK | Add-Member -MemberType ScriptMethod -Name GetParent -Value {param($element) $element.parent}
$WLK | Add-Member -MemberType ScriptMethod -Name GetFirstChild -Value {param($element) @($element.children)[0]}
$WLK | Add-Member -MemberType ScriptMethod -Name GetNextSibling -Value {
  param($element)
  if (-not $element.parent) { return $null }
  $siblings=@($element.parent.children)
  for ($index=0;$index -lt $siblings.Count;$index++) {
    if ([object]::ReferenceEquals($siblings[$index],$element)) {
      if ($index+1 -lt $siblings.Count) { return $siblings[$index+1] }
      return $null
    }
  }
}
$RAW=$WLK
$AE=[System.Windows.Automation.AutomationElement]
$rootNode=[pscustomobject]@{i=0;p=-1;type='Table';rid='10.1';aid=$tableAid;on=$true;x=100;y=100;w=600;h=100}
$cellNode=[pscustomobject]@{i=1;p=0;type='DataItem';rid='10.2';aid=$tableAid;on=$true;x=100;y=100;w=90;h=24}
$otherNode=[pscustomobject]@{i=2;p=0;type='DataItem';rid='10.3';aid=$tableAid;on=$true;x=100;y=130;w=90;h=24}
$stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0}
$baseline=[pscustomobject]@{nodes=@($rootNode,$cellNode,$otherNode);stats=$stats}
$script:elements=@{'10.1'=$table;'10.2'=$cell;'10.3'=$otherCell}
function Get-LiveElement($Hwnd,$Rid,$Aid) {
  $element=$script:elements[[string]$Rid]
  if ($element -and $element.Current.AutomationId -ceq $Aid) { $element }
}
function Get-UiSnapshot($Hwnd,$MaxNodes,$TimeoutSec,$MaxDepth,$RootElement) {
  Assert-True ($MaxNodes -eq 2048 -and $TimeoutSec -eq 5 -and $MaxDepth -eq 16 -and $RootElement.rid -ceq '10.1') 'Scoped walk lost its exact root or bounded limits.'
  $capture=$script:scopedTree.PSObject.Copy()
  $capture.nodes=@($script:scopedTree.nodes | Where-Object {$_.rid -cne '10.1'} | ForEach-Object {
    $copy=$_.PSObject.Copy();$copy.i=[int]$_.i-1;$copy.p=$(if ([int]$_.p -eq 0) {-1} else {[int]$_.p-1});$copy
  })
  $capture
}
foreach ($mode in @('table','cell','other-focus','unselected-cell','selection-empty','selection-multiple-rows','truncated','depth','cycle','error','wrong-root')) {
  $script:scopedTree=$baseline.PSObject.Copy();$script:scopedTree.stats=$stats.PSObject.Copy()
  $script:selectedElements=@($cell)
  $table.Current.AutomationId=$tableAid
  [System.Windows.Automation.AutomationElement]::FocusedElement=$table
  switch ($mode) {
    'cell' {[System.Windows.Automation.AutomationElement]::FocusedElement=$cell}
    'other-focus' {[System.Windows.Automation.AutomationElement]::FocusedElement=New-Element 'Pane' '10.9' $tableAid}
    'unselected-cell' {[System.Windows.Automation.AutomationElement]::FocusedElement=$otherCell}
    'selection-empty' {$script:selectedElements=@()}
    'selection-multiple-rows' {$script:selectedElements=@($cell,$otherCell)}
    'truncated' {$script:scopedTree.stats.truncated=$true}
    'depth' {$script:scopedTree.stats.depthLimited=$true}
    'cycle' {$script:scopedTree.stats.cyc=1}
    'error' {$script:scopedTree.stats.err=1}
    'wrong-root' {$table.Current.AutomationId='Other.Table'}
  }
  $result=Get-SSETableLiveInputState ([IntPtr]111) 7 $tableAid '10.1' -RequireKeyboard -RequireSelection
  Assert-True ($result.ok -eq ($mode -in @('table','cell'))) "$mode`: actual live-input helper accepted the wrong cursor/editor state."
}
$table.Current.AutomationId=$tableAid
foreach ($type in @('ComboBox','Edit','Spinner','List','ListItem','Custom')) {
  $editorNode=[pscustomobject]@{i=3;p=0;type=$type;rid='10.9';aid=$tableAid+'.Delegate';on=$true;x=100;y=100;w=90;h=24}
  $script:scopedTree=[pscustomobject]@{nodes=@($rootNode,$cellNode,$otherNode,$editorNode);stats=$stats}
  $editor=New-Element $type '10.9' ($tableAid+'.Delegate');$editor.parent=$table
  [System.Windows.Automation.AutomationElement]::FocusedElement=$editor
  $script:selectedElements=@($cell)
  Assert-True (-not (Get-SSETableLiveInputState ([IntPtr]111) 7 $tableAid '10.1' -RequireKeyboard -RequireSelection).ok) "$type`: editor descendant was permitted as a table keyboard target."
}
$externalEdit=[pscustomobject]@{i=3;p=-1;type='Edit';rid='20.1';aid='Synthetic.Summary';on=$true;x=100;y=300;w=90;h=24}
Assert-True (Get-SSETableSnapshotInputState ([pscustomobject]@{nodes=@($rootNode,$cellNode,$externalEdit);stats=$stats}) $tableAid '10.1').editorFree 'Summary outside the table was confused with its editor.'
$row=@(0..5 | ForEach-Object {[pscustomobject]@{i=1+$_;p=0;on=$true;type='DataItem';rid="10.$(2+$_)";aid=$tableAid;x=100+100*$_;y=100;w=90;h=24;
  name=@('','','','Sonst. Leistung EU','19','0,00')[$_];val=''}})
$selectedRow=@($row | ForEach-Object {$copy=$_.PSObject.Copy();$copy.name=$_.name;$copy});$selectedRow[3].name='Sonst. Leistung Drittland'
$profile=[pscustomobject]@{known=$true;bindingOk=$true;automationIdSection='grpEmpf13b';aidBound=$true;aidFallback=$false;
  observedScopePrefix='Synthetic/.grpEmpf13b./.grpEmpf13b.';columns=@([pscustomobject]@{index=3;header='Kategorie';controlType='ComboBox';writePolicy='typed-selection-required'})}
$sum=[pscustomobject]@{value='12,34';selected=[pscustomobject]@{aid='Synthetic.Sum'}}
$initial=[pscustomobject]@{ok=$true;heading='Synthetic page';sumRead=$sum;rowCells=$row;tree=[pscustomobject]@{nodes=@($rootNode)+@($row);stats=$stats};
  region=[pscustomobject]@{ok=$true;scopePrefix=$profile.observedScopePrefix;cells=$row}}
$selected=$initial.PSObject.Copy();$selected.rowCells=$selectedRow;$selected.region=$initial.region.PSObject.Copy();$selected.region.cells=$selectedRow
$selected.tree=[pscustomobject]@{nodes=@($rootNode)+@($selectedRow);stats=$stats}
# Capture the synthetic selection's own popup and prior category model cell.
# Visible column 3 maps to model column 5; neither authority is public input.
$editorAid=$tableAid+'.qt_scrollarea_viewport./.grpEmpf13b.Empf13b.(1).Kategorie13b'
$ownPopup=[pscustomobject]@{ok=$true;kind='bound';list=[pscustomobject]@{type='List';rid='10.90';aid=$editorAid+'.QComboBoxListView'};
  target=[pscustomobject]@{type='ListItem';rid='10.91';name='Sonst. Leistung Drittland'};binding=[pscustomobject]@{
    automationIdSection='grpEmpf13b';cellAid=$tableAid;cellRid=$row[3].rid;listAid=$editorAid+'.QComboBoxListView';listRid='10.90'}}
$ownModelCell=[pscustomobject]@{ok=$true;tableAid=$tableAid;tableRid=$rootNode.rid;cellAid=$tableAid;cellRid=$row[3].rid;row=[int]0;column=[int]5}
foreach ($item in $selectedRow) { $script:elements[$item.rid]=New-Element 'DataItem' $item.rid $item.aid;$script:elements[$item.rid].parent=$table }
function Test-SSELastInputUnchanged($Tick) {$Tick -eq $script:inputTick}
function Get-SSEInteractionWindowSet { [pscustomobject]@{fingerprint='stable'} }
function Start-Sleep { }
function Read-SSETableComboCellState {
  $script:comboReads++
  if ($script:comboReads -eq 1) {$selected} else {$script:freshState}
}
function Get-SSETableComboCellValue($Element,$Cell) {$Cell.name}
function Get-SSEPageCheckerMessages { @() }
function Get-DirtyStateFast {$true}
$footerAid='Synthetic.RedThreadContent.ClientFrameSSE.ClientFooterSSE.HoverButton'
$footerNode=[pscustomobject]@{i=50;p=-1;type='Button';name='Weiter';rid='10.50';aid=$footerAid;on=$true;x=100;y=400;w=80;h=24}
$footerElement=New-Element 'Button' '10.50' $footerAid 400
$footerElement.Current | Add-Member NoteProperty Name 'Weiter'
function Resolve-SSETableFooterFocusNode { $footerNode }
function Get-SSEPageObjects {[pscustomobject]@{tableComboFocusOut=$null}}
function Invoke-SSETableFooterFocus {
  param($Window,$ProcessId,$Tree,$TableAid,$TableRid,$Page,$Tick,$Fingerprint,$OwnedCell,$TypedEditorAuthority)
  Assert-True ($TypedEditorAuthority.ok -and $TypedEditorAuthority.tableAid -ceq $tableAid -and
    $TypedEditorAuthority.tableRid -ceq $rootNode.rid -and $TypedEditorAuthority.editorAid -ceq $editorAid -and
    $TypedEditorAuthority.modelRow -eq 0 -and $TypedEditorAuthority.modelColumn -eq 5 -and
    $TypedEditorAuthority.columnIndex -eq 3 -and $TypedEditorAuthority.wanted -ceq 'Sonst. Leistung Drittland' -and
    $TypedEditorAuthority.cell.rid -ceq $selectedRow[3].rid -and @($TypedEditorAuthority.row).Count -eq 6) `
    'The completion helper lost its own popup/model-category authority before Footer.SetFocus.'
  if ($script:commitMode -eq 'footer-unbound') {
    return [pscustomobject]@{ok=$false;reason='fresh-footer-element-unbound';phase='fresh-footer-binding';focusAttempted=$false;
      sourceReason=$null;uncachedReason='fresh-focus-walk-depth';exceptionType=$null}
  }
  $footerElement.SetFocus()
  [pscustomobject]@{ok=$true;button=$footerNode;reason='exact-profiled-footer-focus';phase='after-focus';focusAttempted=$true;
    sourceReason=$null;uncachedReason=$null;exceptionType=$null}
}
foreach ($mode in @('committed','category-reverted','editor-remains','input','footer-unbound',
  'popup-missing','popup-foreign-root','model-row-mismatch','model-column-invalid','model-cell-rid-mismatch')) {
  $script:commitMode=$mode;$script:inputTick=10;$script:focusCalls=0;$script:comboReads=0
  $popup=$ownPopup | ConvertTo-Json -Depth 8 -Compress | ConvertFrom-Json
  $modelCell=$ownModelCell.PSObject.Copy()
  switch ($mode) {
    'popup-missing' {$popup=$null}
    'popup-foreign-root' {$popup.list.aid='Foreign.'+$popup.list.aid;$popup.binding.listAid=$popup.list.aid}
    'model-row-mismatch' {$modelCell.row=[int]1}
    'model-column-invalid' {$modelCell.column=[int]2}
    'model-cell-rid-mismatch' {$modelCell.cellRid='10.99'}
  }
  $script:freshState=$selected.PSObject.Copy();$script:freshState.region=$selected.region.PSObject.Copy()
  $freshRow=@($selectedRow | ForEach-Object {$_.PSObject.Copy()})
  if ($mode -eq 'category-reverted') {$freshRow[3].name='Sonst. Leistung EU'}
  $script:freshState.region.cells=$freshRow
  $script:freshState.tree=[pscustomobject]@{nodes=@($rootNode)+@($freshRow);stats=$stats}
  if ($mode -eq 'editor-remains') {
    $editorNode=[pscustomobject]@{i=7;p=0;type='ComboBox';rid='10.20';aid=$tableAid+'.Delegate';on=$true;x=400;y=100;w=90;h=24}
    $script:freshState.tree.nodes+=@($editorNode)
  }
  $script:scopedTree=$script:freshState.tree
  $result=Complete-SSETableComboEditor ([IntPtr]111) 7 $initial $selected $selectedRow $profile `
    'Sonst. Leistung EU' 'Sonst. Leistung Drittland' 3 'Synthetic page' 'Summe' 1 10 'stable' $popup $modelCell
  Assert-True ($result.ok -eq ($mode -eq 'committed') -and $result.editorClosed -eq ($mode -eq 'committed')) "$mode`: typed editor commit was not independently proven."
  $focusExpected=$mode -in @('committed','category-reverted','editor-remains','input')
  Assert-True ($script:focusCalls -eq [int]$focusExpected) "$mode`: commit did not preserve the single profiled Footer.SetFocus boundary."
  Assert-True ([bool]$result.footerFocus.focusAttempted -eq $focusExpected) "$mode`: editor result dropped the focus attempt proof."
  if ($mode -in @('popup-missing','popup-foreign-root','model-row-mismatch','model-column-invalid','model-cell-rid-mismatch')) {
    Assert-True ($result.reason -clike 'typed-editor-*-unbound' -and $null -eq $result.footerFocus) `
      "$mode`: rejected popup/model authority reached the focus boundary."
  }
  if ($mode -eq 'footer-unbound') {
    Assert-True ($result.reason -ceq 'profiled-footer-focus-not-proven: fresh-footer-element-unbound' -and
      $result.footerFocus.reason -ceq 'fresh-footer-element-unbound' -and $result.footerFocus.phase -ceq 'fresh-footer-binding' -and
      $result.footerFocus.uncachedReason -ceq 'fresh-focus-walk-depth') 'The editor wrapper hid the first footer failure.'
    $projection=Get-SSETableComboDiagnosticProjection ([pscustomobject]@{ok=$false;openEvidence=[pscustomobject]@{
      editorCommit=[pscustomobject]@{ok=$result.ok;editorClosed=$result.editorClosed;reason=$result.reason;footerFocus=$result.footerFocus}}})
    Assert-True ($projection.openEvidence.editorCommit.footerFocus.uncachedReason -ceq 'fresh-focus-walk-depth' -and
      $projection.openEvidence.editorCommit.footerFocus.focusAttempted -eq $false) 'The bounded projection hid the precise footer failure.'
  }
}
$projected=Get-SSETableComboDiagnosticProjection ([pscustomobject]@{popupClosed=$true})
Assert-True ($null -eq $projected.editorClosed) 'Popup closure was still presented as editor closure.'

# The real semantic focus helper runs against these UIA doubles only.
# No physical cell click, Win32 import, keyboard command or real worker exists.
# The actual compiled raw resolver is covered by fresh-raw-resolver-contract;
# this narrow boundary double retains the caller's action/rejection coupling.
function Get-SSETableReadUncachedElement {
  param([IntPtr]$Hwnd,[int]$ProcessId,[string]$Rid,[string]$Aid,[string]$ExpectedType)
  $reject=[pscustomobject]@{ok=$false;element=$null;reason='fresh-focus-element-unbound'}
  if($script:semanticFocusMode -ceq 'fresh-walk-cycle') {$reject.reason='fresh-focus-walk-cycle';return $reject}
  $root=[System.Windows.Automation.AutomationElement]::Root
  if($Hwnd -ne [IntPtr]111 -or $root.Current.ProcessId -ne $ProcessId -or
      $root.Current.NativeWindowHandle -ne [int64]$Hwnd) {return $reject}
  $element=$(if($ExpectedType -ceq 'Table') {$freshTable} else {$number})
  if($element.rid -cne $Rid -or $element.Current.AutomationId -cne $Aid -or
      $element.Current.ProcessId -ne $ProcessId -or $element.Current.ControlType -cne $ExpectedType -or
      -not $element.Current.IsEnabled -or $element.Current.IsOffscreen) {return $reject}
  [pscustomobject]@{ok=$true;element=$element;reason='synthetic-fresh-resolver-boundary'}
}
$number=$script:elements['10.2']
$number.parent=$table
$number.selection=[pscustomobject]@{Current=[pscustomobject]@{SelectionContainer=$table;IsSelected=$true}}
$table | Add-Member -Force -MemberType ScriptMethod -Name SetFocus -Value {
  $script:cachedFocusCalls++
  throw [System.Windows.Automation.ElementNotAvailableException]::new()
}
$freshTable=New-Element 'Table' '10.1' $tableAid
$freshTable | Add-Member -Force -MemberType ScriptMethod -Name SetFocus -Value {
  $script:tableFocusCalls++
  Assert-True ($script:refreshCalls -gt 0) 'Focus action preceded the post-selection whole snapshot.'
  if ($script:semanticFocusMode -eq 'table-unsupported') { throw [InvalidOperationException]::new('Focus action unsupported') }
  if ($script:semanticFocusMode -eq 'table-other-exception') { throw [ArgumentException]::new('Unknown focus failure') }
  if ($script:semanticFocusMode -in @('number','table-unavailable')) { throw [System.Windows.Automation.ElementNotAvailableException]::new() }
  [System.Windows.Automation.AutomationElement]::FocusedElement=$this
}
$number | Add-Member -Force -MemberType ScriptMethod -Name SetFocus -Value {
  $script:numberFocusCalls++
  if ($script:semanticFocusMode -eq 'number-unavailable') { throw [System.Windows.Automation.ElementNotAvailableException]::new() }
  if ($script:semanticFocusMode -eq 'number-noop') { return }
  [System.Windows.Automation.AutomationElement]::FocusedElement=$this
}
$focusProof=[pscustomobject]@{complete=$true;editorFree=$true;heading='Synthetic page';tableIdentity='Synthetic.Header';
  tableRootAid=$tableAid;tableRootRid='10.1';scopePrefix='Synthetic';selectionMethod='aid';summaryIdentity='Synthetic.Sum';
  summaryValue='12,34';contentSignature='unchanged'}
$focusSnapshot=[pscustomobject]@{navigationBinding=$focusProof;tabelleAnzahl=1;error=$null;
  cursorAnchorIsNumber=$true;kopf=@('Nr.','Datum','Text','Betrag','%','Netto');ersteZelle=$selectedRow[0]}
$focusSnapshot.ersteZelle=$selectedRow[0].PSObject.Copy();$focusSnapshot.ersteZelle.name='7'
foreach ($mode in @('number','number-with-readonly','number-noop','table-only','table-unsupported','table-other-exception','table-not-focusable',
                    'table-unknown-capability','not-number','table-unavailable','number-unavailable',
                    'changed-content','changed-summary','input-before-number','editor','foreign-pid','wrong-aid',
                    'foreign-parent','foreign-selection-container','selection-not-selected','number-not-focusable','fresh-root-pid','fresh-root-hwnd',
                    'fresh-table-rid','fresh-table-aid','fresh-table-disabled','fresh-table-hidden','fresh-walk-cycle','focus-final-input',
                    'number-writable','number-readonly-unknown','number-value-mismatch','number-toggle','number-expand')) {
  $script:semanticFocusMode=$mode;$script:tableFocusCalls=0;$script:numberFocusCalls=0;$script:cachedFocusCalls=0;$script:refreshCalls=0
  $script:scopedTree=[pscustomobject]@{nodes=@($rootNode)+@($selectedRow);stats=$stats}
  $freshTable.rid='10.1';$freshTable.Current.AutomationId=$tableAid;$freshTable.Current.IsEnabled=$true;$freshTable.Current.IsOffscreen=$false
  $freshTable.Current.IsKeyboardFocusable=($mode -ne 'table-not-focusable')
  if ($mode -eq 'table-unknown-capability') {$freshTable.Current.IsKeyboardFocusable=$null}
  $number.Current.ProcessId=7;$number.Current.AutomationId=$tableAid;$number.Current.IsKeyboardFocusable=$true
  $number.parent=$freshTable;$number.selection.Current.SelectionContainer=$freshTable
  $number.selection.Current.IsSelected=$true;$number.valuePattern=$null;$number.editorPatternType=''
  $freshTable.children=@($number)
  $freshRoot=New-Element 'Window' '1.1' 'Synthetic.Root';$freshRoot.children=@($freshTable);$freshTable.parent=$freshRoot
  [System.Windows.Automation.AutomationElement]::Root=$freshRoot
  [System.Windows.Automation.AutomationElement]::FocusedElement=New-Element 'Pane' '10.99' 'Synthetic.OtherFocus'
  $script:freshFocusSnapshot=$focusSnapshot.PSObject.Copy()
  $script:freshFocusSnapshot.navigationBinding=$focusProof.PSObject.Copy()
  if ($mode.StartsWith('table-',[StringComparison]::Ordinal)) {
    $script:freshFocusSnapshot.cursorAnchorIsNumber=$false;$script:freshFocusSnapshot.kopf=@('Label','Datum','Text','Betrag','%','Netto')
  }
  switch ($mode) {
    'not-number' {$script:freshFocusSnapshot.cursorAnchorIsNumber=$false}
    'changed-content' {$script:freshFocusSnapshot.navigationBinding.contentSignature='changed'}
    'changed-summary' {$script:freshFocusSnapshot.navigationBinding.summaryValue='99,99'}
    'editor' {$script:scopedTree.nodes+=@([pscustomobject]@{i=7;p=0;type='Edit';rid='10.20';aid=$tableAid+'.Editor';on=$true;x=100;y=100;w=90;h=24})}
    'foreign-pid' {$number.Current.ProcessId=8}
    'wrong-aid' {$number.Current.AutomationId='Other.Table'}
    'foreign-parent' {$number.parent=New-Element 'Table' '20.1' 'Other.Table'}
    'foreign-selection-container' {$number.selection.Current.SelectionContainer=New-Element 'Table' '20.1' 'Other.Table'}
    'selection-not-selected' {$number.selection.Current.IsSelected=$false}
    'number-not-focusable' {$number.Current.IsKeyboardFocusable=$false}
    'fresh-root-pid' {$freshRoot.Current.ProcessId=8}
    'fresh-root-hwnd' {$freshRoot.Current.NativeWindowHandle=222}
    'fresh-table-rid' {$freshTable.rid='20.1'}
    'fresh-table-aid' {$freshTable.Current.AutomationId='Other.Table'}
    'fresh-table-disabled' {$freshTable.Current.IsEnabled=$false}
    'fresh-table-hidden' {$freshTable.Current.IsOffscreen=$true}
    'fresh-walk-cycle' {$freshRoot.children=@($freshTable,$freshTable)}
    'number-with-readonly' {$number.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{IsReadOnly=$true;Value='7'}}}
    'number-writable' {$number.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{IsReadOnly=$false;Value='7'}}}
    'number-readonly-unknown' {$number.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{IsReadOnly=$null;Value='7'}}}
    'number-value-mismatch' {$number.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{IsReadOnly=$true;Value='8'}}}
    'number-toggle' {$number.editorPatternType='toggle'}
    'number-expand' {$number.editorPatternType='expand'}
  }
  $guard={param($Phase) -not ($script:semanticFocusMode -eq 'input-before-number' -and $Phase -ceq 'before-number-anchor-rebind')}
  $checkpoint={param($Phase) $script:semanticFocusMode -ne 'focus-final-input'}
  $refresh={$script:refreshCalls++;$script:freshFocusSnapshot}
  $result=Invoke-SSETableReadSemanticFocus ([IntPtr]111) 7 $focusSnapshot $guard $refresh $checkpoint
  Assert-True ($result.ok -eq ($mode -in @('number','number-with-readonly','number-noop','table-only'))) "$mode`: semantic focus accepted an unsafe or unavailable anchor."
  Assert-True ($script:numberFocusCalls -eq $(if ($mode -in @('number','number-with-readonly','number-noop','number-unavailable')) {1} else {0})) "$mode`: number focus was not single, bounded and fail-closed."
  Assert-True ($script:tableFocusCalls -eq $(if ($mode -in @('table-only','table-unsupported','table-other-exception','table-unavailable')) {1} else {0})) "$mode`: table focus ignored explicit capability."
  Assert-True ($script:cachedFocusCalls -eq 0) "$mode`: a snapshot-cached table was focused."
  if ($mode -eq 'table-unavailable') {
    Assert-True ($result.exceptionType -ceq 'ElementNotAvailableException' -and $result.reason -ceq 'table-focus-failed') 'Unavailable focus was retried or hidden as unsupported.'
  }
  if ($mode -eq 'number-unavailable') {
    Assert-True ($result.exceptionType -ceq 'ElementNotAvailableException' -and $result.reason -ceq 'number-anchor-focus-failed') 'Unavailable number focus was retried or hidden.'
  }
  if ($mode -eq 'number-writable') {
    Assert-True ($result.reason -ceq 'number-anchor-writable-value-pattern') 'Writable anchor was hidden as a value mismatch.'
  }
  if ($mode -eq 'number-readonly-unknown') {
    Assert-True ($result.reason -ceq 'number-anchor-readonly-unavailable') 'Unknown readonly capability was hidden as a value mismatch.'
  }
  if ($mode -eq 'number-value-mismatch') {
    Assert-True ($result.reason -ceq 'number-anchor-value-mismatch') 'Changed anchor value was hidden as a capability failure.'
  }
  if ($mode -eq 'number-noop') {
    Assert-True (-not (Get-SSETableLiveInputState ([IntPtr]111) 7 $tableAid '10.1' -RequireKeyboard -RequireSelection).ok) `
      'A successful SetFocus no-op was accepted as actual cursor focus before HOME.'
  }
}
$number.Current.ProcessId=7;$number.Current.AutomationId=$tableAid;$number.parent=$table
Write-Output 'table-editor-contract: PASS (synthetic only, no desktop input)'
