$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-combobox.ps1')
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$parseErrors)
if (@($parseErrors).Count) {throw 'Worker syntax is invalid.'}
foreach ($name in @('Test-SSEExactProperties','Test-SSETableNumberPolicy','Get-SSETableExceptionDiagnostic','Get-SSETableNumberAnchorFocusProof','Test-SSETableFocusedSource','Invoke-SSETableFooterFocus',
  'Get-SSETableCursorNumberCellProof',
  'Get-SSETableNativePositionNumberAuthority','Get-SSETableNativePositionCheckpointProof','Invoke-SSETableNativePositionPreparation','Test-SSETableCursorPhaseEditorAuthority',
  'Get-SSETableLiveInputState','Test-SSETableReadNumberEditor','Test-SSETableReadKeyboardTarget',
  'Invoke-SSETableReadAnchorSelection','Test-SSETableReadHomeSnapshotSemantics',
  'Get-SSETextSha256','New-SSESnapshotNodeIndex','Get-SSESnapshotParentLineageKey','Get-SSESnapshotPrivateComparisonKey','Compare-SSESnapshotNodes')) {
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($definition.Count -ne 1) {throw 'Productive helper is absent.'}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
Add-Type -TypeDefinition @'
using System;
public static class SW {public static IntPtr GetForegroundWindow(){return new IntPtr(111);}}
namespace System.Windows.Forms {public static class SendKeys {public static int Calls;public static void SendWait(string key){Calls++;}}}
namespace System.Windows.Automation {
 public static class AutomationElement {
  public static object FocusedElement,Root;
  public static object FromHandle(IntPtr hwnd){return Root;}
 }
 public sealed class ControlType {
  public string ProgrammaticName;
  private ControlType(string name){ProgrammaticName="ControlType."+name;}
  public static readonly ControlType Table=new ControlType("Table"),DataGrid=new ControlType("DataGrid"),DataItem=new ControlType("DataItem"),
   Button=new ControlType("Button"),Tree=new ControlType("Tree"),TreeItem=new ControlType("TreeItem"),ComboBox=new ControlType("ComboBox"),
   Edit=new ControlType("Edit"),Window=new ControlType("Window"),Pane=new ControlType("Pane"),Custom=new ControlType("Custom"),Header=new ControlType("Header"),
   Spinner=new ControlType("Spinner"),List=new ControlType("List"),ListItem=new ControlType("ListItem");
 }
 public static class GridItemPattern {public static object Pattern=new object();}
 public static class ValuePattern {public static object Pattern=new object();}
 public static class SelectionPattern {public static object Pattern=new object();}
 public static class SelectionItemPattern {public static object Pattern=new object();}
 public static class TogglePattern {public static object Pattern=new object();}
}
'@
$AE=[System.Windows.Automation.AutomationElement]
$prefix='Synthetic.RedThreadContent.ClientFrameSSE'
$tableAid=$prefix+'.DialogUI./.Synthetic.Table'
$footerAid=$prefix+'.ClientFooterSSE.HoverButton'
$policy=[pscustomobject]@{id='main_footer_next_focus';controlType='Button';name='Weiter';automationIdSuffix='.RedThreadContent.ClientFrameSSE.ClientFooterSSE.HoverButton';action='SetFocus';policy='own-typed-table-editor-only'}
function New-Element($Node) {
  $controlType=[System.Windows.Automation.ControlType]::Table.GetType().GetField([string]$Node.type).GetValue($null)
  $element=[pscustomobject]@{rid=$Node.rid;parent=$null;children=@();gridItem=$null;valuePattern=$null;selection=$null;selectionItem=$null;toggle=$null;Current=[pscustomobject]@{ProcessId=7;ControlType=$controlType;
    Name=$Node.name;AutomationId=$Node.aid;HasKeyboardFocus=$true;IsKeyboardFocusable=$true;NativeWindowHandle=111;
    IsEnabled=$true;IsOffscreen=$false;BoundingRectangle=[pscustomobject]@{X=$Node.x;Y=$Node.y;Width=$Node.w;Height=$Node.h}}}
  $element | Add-Member ScriptMethod GetRuntimeId { $this.rid -split '\.' }
  $element | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern,$Result)
    if ($Pattern -eq [System.Windows.Automation.GridItemPattern]::Pattern -and $this.gridItem) {$Result.Value=$this.gridItem;return $true}
    if ($Pattern -eq [System.Windows.Automation.ValuePattern]::Pattern -and $this.valuePattern) {$Result.Value=$this.valuePattern;return $true}
    if ($Pattern -eq [System.Windows.Automation.SelectionPattern]::Pattern -and $this.selection) {$Result.Value=$this.selection;return $true}
    if ($Pattern -eq [System.Windows.Automation.SelectionItemPattern]::Pattern -and $this.selectionItem) {$Result.Value=$this.selectionItem;return $true}
    if ($Pattern -eq [System.Windows.Automation.TogglePattern]::Pattern -and $this.toggle) {$Result.Value=$this.toggle;return $true}
    $false
  }
  $element | Add-Member ScriptMethod SetFocus {
    $script:focusCalls++
    if ($script:mode -eq 'throw') {throw [InvalidOperationException]::new('Synthetic unavailable')}
    if ($script:mode -eq 'noop') {return}
    [System.Windows.Automation.AutomationElement]::FocusedElement=$this
    if ($script:mode -eq 'input') {$script:tick++}
  }
  $element
}
$tableNode=[pscustomobject]@{i=0;p=-1;type='Table';name='';aid=$tableAid;rid='10.1';on=$true;x=100;y=100;w=600;h=100}
$buttonNode=[pscustomobject]@{i=1;p=-1;type='Button';name='Weiter';aid=$footerAid;rid='10.2';on=$true;x=100;y=300;w=80;h=24}
$editorNode=[pscustomobject]@{i=2;p=0;type='Edit';name='';aid=$tableAid+'.Row.Kategorie';rid='10.3';on=$true;x=100;y=100;w=90;h=24}
$cell=[pscustomobject]@{type='DataItem';aid=$tableAid;x=100;y=100;w=90;h=24}
$stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0}
$root=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType=[System.Windows.Automation.ControlType]::Window;NativeWindowHandle=111};parent=$null}
$WLK=[pscustomobject]@{}
$WLK | Add-Member ScriptMethod GetParent {param($element) $element.parent}
function Get-SSEPageObjects {[pscustomobject]@{tableComboFocusOut=$policy;tablePositionNameFocusSource=$script:positionPolicy}}
function Get-CurrentHeading {if($script:homeHeading){$script:homeHeading}elseif($script:positionHeading){$script:positionHeading}else{'Synthetic page'}}
function Get-DirtyStateFast {$script:homeDirty}
function Get-SSEInteractionWindowSet {[pscustomobject]@{fingerprint=$(if($script:homeWindow){$script:homeWindow}else{'stable'})}}
function Test-SSELastInputUnchanged($Expected) {$Expected -eq $script:tick}
function Walk-BoundTree {
  param($Window,[switch]$WithValues)
  if ($Window -ne [IntPtr]111 -or -not $WithValues) {throw 'Fresh source snapshot lost its own root or values proof.'}
  $script:sourceSnapshotReads++
  $script:freshSourceTree
}
function Get-SSETableReadUncachedElement {
  param($Window,$ProcessId,$Rid,$Aid,$Type)
  if ($Type -ceq 'DataItem' -and $script:mode -like 'keyboard-number-*') {
    $script:keyboardNumberRawReads++
    if ($script:mode -ceq 'keyboard-number-stale-raw') {return [pscustomobject]@{ok=$false;element=$null;reason='synthetic-stale-number-anchor'}}
    if ($script:keyboardNumberRawReads -eq 2) {
      switch ($script:mode) {
        'keyboard-number-home-late-value' {$script:numberSource.valuePattern.Current.Value='changed'}
        'keyboard-number-home-late-readonly' {$script:numberSource.valuePattern.Current.IsReadOnly='false'}
        'keyboard-number-home-late-source' {$foreign=$script:numberSource.PSObject.Copy();$foreign.rid='30.98';$AE::FocusedElement=$foreign}
        'keyboard-number-home-late-focus' {$script:numberSource.Current.HasKeyboardFocus=$false}
        'keyboard-number-home-late-geometry' {$script:numberSource.Current.BoundingRectangle.X++}
        'keyboard-number-home-late-ancestry' {$script:numberSource.parent=$root}
        'keyboard-number-home-late-grid-row' {$script:numberAnchorLive.gridItem.Current.Row=[int]1}
        'keyboard-number-home-late-input' {$script:tick=11}
        'keyboard-number-home-late-window' {$script:homeWindow='changed'}
      }
    }
  }
  if ($Type -ceq 'DataItem' -and $script:currentNumberCells) {
    return [pscustomobject]@{ok=$script:currentNumberCells.ContainsKey($Rid);element=$script:currentNumberCells[$Rid];reason='synthetic-current-cell'}
  }
  if ($Type -ceq 'DataItem') {return [pscustomobject]@{ok=$true;element=$script:numberAnchorLive;reason='synthetic-exact-number-anchor'}}
  if ($Type -ceq 'Table') {return [pscustomobject]@{ok=$true;element=$script:table;reason='synthetic-exact-table'}}
  if ($script:mode -eq 'number-value-late') {$script:numberSource.valuePattern.Current.Value='Synthetic changed number'}
  if ($script:mode -eq 'position-name-late') {$script:positionSource.valuePattern.Current.Value='Synthetic changed position'}
  if ($script:mode -eq 'source-changed') {$AE::FocusedElement=New-Element $editorNode}
  if ($script:mode -eq 'source-type-changed') {$script:table.Current.ControlType=[System.Windows.Automation.ControlType]::Edit}
  if ($script:mode -eq 'fresh-unbound') {return [pscustomobject]@{ok=$false;reason='fresh-focus-walk-depth';element=$null}}
  if ($script:mode -eq 'fresh-throws') {throw [ArgumentException]::new('Synthetic lookup failure')}
  [pscustomobject]@{ok=$true;element=$script:button}
}
foreach ($case in @('success','owned-editor','duplicate','disabled','not-focusable','noop','throw','input','source-changed','source-type-changed','outside-editor','unknown-custom','foreign-root','foreign-pid','wrong-owned-cell','fresh-unbound','fresh-throws','input-before',
  'fresh-source-churn','fresh-source-value-changed','fresh-source-structure-changed','fresh-source-incomplete','source-missing','source-aid-different','source-name-changed','source-geometry-changed')) {
  $script:mode=$case;$script:focusCalls=0;$script:tick=10;$script:sourceSnapshotReads=0
  $tree=[pscustomobject]@{nodes=@($tableNode,$buttonNode);stats=$stats}
  $script:table=New-Element $tableNode;$script:table.parent=$root
  $script:button=New-Element $buttonNode;$script:button.parent=$root
  $AE::FocusedElement=$script:table;$owned=$null
  switch ($case) {
    'duplicate' {$tree.nodes+=@($buttonNode.PSObject.Copy())}
    'disabled' {$tree.nodes=@($tableNode,$buttonNode.PSObject.Copy());$tree.nodes[1].on=$false}
    'not-focusable' {$script:button.Current.IsKeyboardFocusable=$false}
    'owned-editor' {$tree.nodes+=@($editorNode);$editor=New-Element $editorNode;$editor.parent=$script:table;$AE::FocusedElement=$editor;$owned=$cell}
    'wrong-owned-cell' {$tree.nodes+=@($editorNode);$editor=New-Element $editorNode;$editor.parent=$script:table;$AE::FocusedElement=$editor;$owned=$cell.PSObject.Copy();$owned.x=300}
    'outside-editor' {$outside=$editorNode.PSObject.Copy();$outside.p=-1;$tree.nodes+=@($outside);$editor=New-Element $outside;$editor.parent=$root;$AE::FocusedElement=$editor}
    'unknown-custom' {$outside=$editorNode.PSObject.Copy();$outside.p=-1;$outside.type='Custom';$tree.nodes+=@($outside);$editor=New-Element $outside;$editor.parent=$root;$AE::FocusedElement=$editor}
    'foreign-root' {$script:table.parent=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType=[System.Windows.Automation.ControlType]::Window;NativeWindowHandle=222}}}
    'foreign-pid' {$script:table.Current.ProcessId=8}
    'input-before' {$script:tick=11}
    'fresh-source-churn' {
      $prior=$tableNode.PSObject.Copy();$prior.i=2;$prior.p=0;$prior.rid='10.4';$prior.type='DataItem';$prior.name='Synthetic passive source'
      $tree.nodes+=@($prior)
      $current=$prior.PSObject.Copy();$current.rid='10.5';$source=New-Element $current;$source.parent=$script:table;$AE::FocusedElement=$source
    }
    'source-missing' {$missing=$buttonNode.PSObject.Copy();$missing.rid='20.7';$missing.name='Synthetic private text';$source=New-Element $missing;$source.parent=$root;$AE::FocusedElement=$source}
    'source-aid-different' {$source=New-Element $tableNode;$source.Current.AutomationId='Synthetic.Other';$source.parent=$root;$AE::FocusedElement=$source}
    'source-name-changed' {$script:table.Current.Name='Synthetic changed name'}
    'source-geometry-changed' {$script:table.Current.BoundingRectangle.Width=590}
  }
  $script:freshSourceTree=$tree.PSObject.Copy();$script:freshSourceTree.nodes=@($tree.nodes | ForEach-Object {$_.PSObject.Copy()})
  $script:freshSourceTree.stats=$stats.PSObject.Copy()
  switch ($case) {
    'fresh-source-churn' {$script:freshSourceTree.nodes[2].rid='10.5'}
    'fresh-source-value-changed' {$script:freshSourceTree.nodes[0].name='Synthetic changed model'}
    'fresh-source-structure-changed' {$script:freshSourceTree.nodes[1].p=0}
    'fresh-source-incomplete' {$script:freshSourceTree.stats.truncated=$true}
  }
  if ($case -eq 'fresh-source-churn') {
    $staleReason=$null
    if (Test-SSETableFocusedSource ([IntPtr]111) 7 $tree $tableAid '10.1' $null $null ([ref]$staleReason)) {
      throw 'Stale caller snapshot incorrectly proved the rematerialized focused source.'
    }
    if ($staleReason -cne 'source-snapshot-node-not-unique') {throw 'Fixture did not reproduce the actual source uniqueness rejection.'}
  }
  $result=Invoke-SSETableFooterFocus ([IntPtr]111) 7 $tree $tableAid '10.1' 'Synthetic page' 10 'stable' $owned
  if ($result.ok -ne ($case -in @('success','owned-editor','fresh-source-churn'))) {throw "$case`: footer focus proof mismatch."}
  if ($script:sourceSnapshotReads -ne $(if ($case -in @('duplicate','disabled')) {0} else {1})) {throw "$case`: fresh source snapshot was retried or omitted."}
  $expectedCalls=$(if ($case -in @('success','owned-editor','fresh-source-churn','noop','throw','input')) {1} else {0})
  if ($script:focusCalls -ne $expectedCalls) {throw "$case`: unexpected focus count or retry."}
  if ($result.focusAttempted -ne [bool]$expectedCalls) {throw "$case`: focus attempt was not reported independently of success."}
  $expectedReason=switch ($case) {
    {$_ -in @('success','owned-editor','fresh-source-churn')} {'exact-profiled-footer-focus';break}
    {$_ -in @('fresh-source-value-changed','fresh-source-structure-changed','fresh-source-incomplete')} {'footer-source-snapshot-changed';break}
    {$_ -in @('duplicate','disabled')} {'profiled-footer-node-unbound';break}
    'not-focusable' {'footer-focus-capability-unbound';break}
    'noop' {'footer-final-focus-not-proven';break}
    {$_ -in @('throw','fresh-throws')} {'footer-focus-exception';break}
    'input' {'footer-after-focus-guard-changed';break}
    {$_ -in @('source-changed','source-type-changed')} {'footer-source-focus-changed';break}
    'fresh-unbound' {'fresh-footer-element-unbound';break}
    'input-before' {'footer-input-epoch-unbound';break}
    default {'footer-source-focus-unbound'}
  }
  if ($result.reason -cne $expectedReason) {throw "$case`: the first precise guard reason was lost."}
  if ($case -eq 'fresh-unbound' -and ($result.phase -cne 'fresh-footer-binding' -or $result.uncachedReason -cne 'fresh-focus-walk-depth')) {
    throw 'Fresh lookup reason or phase was lost.'
  }
  if ($case -eq 'throw' -and ($result.phase -cne 'focus-action' -or $result.exceptionType -cne 'InvalidOperationException')) {
    throw 'SetFocus exception type or phase was lost.'
  }
  if ($case -eq 'throw' -and ($result.exceptionMessage -cne 'Synthetic unavailable' -or -not $result.errorRecord.fullyQualifiedErrorId)) {
    throw 'SetFocus ErrorRecord classification or bounded message was lost.'
  }
  if ($case -eq 'fresh-throws' -and ($result.phase -cne 'fresh-footer-binding' -or $result.exceptionType -cne 'ArgumentException')) {
    throw 'Lookup exception was presented as a dispatched SetFocus failure.'
  }
  if ($case -eq 'foreign-root' -and $result.sourceReason -cne 'source-main-window-unbound') {throw 'Exact source-root reason was lost.'}
  if ($case -in @('outside-editor','unknown-custom','wrong-owned-cell') -and -not $result.sourceReason) {throw 'Source proof reason was lost.'}
  if ($case -in @('source-missing','source-aid-different')) {
    $expectedRidCount=$(if ($case -eq 'source-missing') {0} else {1})
    if ($result.sourceReason -cne 'source-snapshot-node-not-unique' -or $result.sourceEvidence.exactMatchCount -ne 0 -or
        $result.sourceEvidence.runtimeIdMatchCount -ne $expectedRidCount -or $result.sourceEvidence.focusedSource.processId -ne 7) {
      throw 'Missing/stale focused identity lost exact match-count evidence.'
    }
    if ($result.sourceEvidence.focusedSource.type -cne $(if ($case -eq 'source-missing') {'Button'} else {'Table'})) {
      throw 'ControlType class name replaced its actual ProgrammaticName in diagnostics.'
    }
    $safe=$result.sourceEvidence | ConvertTo-Json -Depth 4 -Compress
    if ($safe -match 'Synthetic private text|"name"|"value"|"val"') {throw 'Source diagnostic leaked field/window text.'}
  }
  if ($case -in @('source-name-changed','source-geometry-changed') -and $result.sourceReason -cne 'source-node-metadata-changed') {
    throw 'Fresh source node did not retain independent live name/geometry proof.'
  }
}
# Unknown active controls also reject passive native-release before lease import.
$script:table.Current.ProcessId=8
if (Test-SSETableFocusedSource ([IntPtr]111) 7 $tree $tableAid '10.1') {throw 'Foreign PID was accepted by passive release.'}
$script:table=New-Element $tableNode;$script:table.parent=$root;$AE::FocusedElement=$script:table
$tree=[pscustomobject]@{nodes=@($tableNode,$buttonNode);stats=$stats}
$differentSource=[pscustomobject]@{rid='10.3';aid=$tableAid+'.Unknown';type='Edit'}
if (Test-SSETableFocusedSource ([IntPtr]111) 7 $tree $tableAid '10.1' $null $differentSource) {
  throw 'Independent focused source read replaced the originally bound identity.'
}
# A live delegate may be absent from the complete bulk snapshot. Its authority
# comes from the exact native number anchor's GridItemPattern, not a guessed
# row index or a displayed number. These tests never load real UIA or a worker.
$RAW=[pscustomobject]@{}
$RAW | Add-Member ScriptMethod GetParent {param($element) $element.parent}
$numberTableAid=$prefix+'.DialogUI./.grpEmpf13b./.grpEmpf13b.Empf13b'
$numberEditorPrefix=$numberTableAid+'.qt_scrollarea_viewport./.grpEmpf13b.Empf13b.'
foreach ($case in @('number-blank','number-existing','number-fifth-row','number-current-second-row','number-current-dataitem','number-no-authority','number-wrong-type',
  'number-wrong-ordinal','number-category-editor','number-no-grid','number-wrong-column','number-wrong-grid',
  'number-foreign-grid','number-noninteger-row','number-out-of-range','number-wrong-ancestry','number-geometry',
  'number-anchor-geometry','number-anchor-model-changed','number-no-value','number-value-changed',
  'number-value-late','number-readonly-unknown','number-foreign-root','number-short-editor-path',
  'number-missing-column','number-hidden-column','number-extra-named-header','number-duplicate-current-cell',
  'number-clipped-current-cell','number-not-selected','number-selection-unreadable','number-selection-state-unknown',
  'number-native-writable-unchanged','number-native-readonly-unchanged','number-native-value-different',
  'number-native-edit-different','number-native-flags-different','number-native-wrong-target-row')) {
  $script:mode=$case;$script:focusCalls=0;$script:tick=10;$script:sourceSnapshotReads=0
  $numberTable=[pscustomobject]@{i=0;p=-1;type='Table';name='';aid=$numberTableAid;rid='30.1';on=$true;x=100;y=100;w=600;h=100}
  $numberFooter=$buttonNode.PSObject.Copy();$numberFooter.rid='30.2'
  $anchor=[pscustomobject]@{i=2;p=0;type='DataItem';name='';val='';aid=$numberTableAid;rid='30.10';on=$true;x=100;y=140;w=55;h=24}
  $headers=@(0..5 | ForEach-Object {[pscustomobject]@{i=3+$_;p=0;type='Header';name=$(if ($_ -eq 0) {'Nr.'} else {'Synthetic header'});
    aid=$numberTableAid+'.Header'+$_;rid='30.'+(20+$_);on=$true;x=100+100*$_;y=100;w=55;h=24}})
  $emptyHeaders=@(0..7 | ForEach-Object {[pscustomobject]@{i=9+$_;p=0;type='Header';name='';aid=$numberTableAid;
    rid='30.'+(40+$_);on=$true;x=$(if ($_ -lt 2) {-1} else {98});y=$(if ($_ -lt 2) {-1} else {140+24*($_-2)});
    w=$(if ($_ -lt 2) {0} else {2});h=$(if ($_ -lt 2) {0} else {24})}})
  $tree=[pscustomobject]@{nodes=@($numberTable,$numberFooter,$anchor)+$headers+$emptyHeaders;stats=$stats.PSObject.Copy()}
  $script:freshSourceTree=$tree.PSObject.Copy();$script:freshSourceTree.nodes=@($tree.nodes | ForEach-Object {$_.PSObject.Copy()})
  $script:table=New-Element $numberTable;$script:table.parent=$root
  $script:button=New-Element $numberFooter;$script:button.parent=$root
  $script:numberAnchorLive=New-Element $anchor;$script:numberAnchorLive.parent=$script:table
  $script:numberAnchorLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]0;Column=[int]0;ContainingGrid=$script:table}}
  $script:numberAnchorLive.selectionItem=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true}}
  $sourceNode=$anchor.PSObject.Copy();$sourceNode.type='Edit';$sourceNode.rid='30.99';$sourceNode.aid=$numberEditorPrefix+'(1).BelegNr'
  $script:numberSource=New-Element $sourceNode;$script:numberSource.parent=$script:table
  $script:numberSource.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value='';IsReadOnly=$false}}
  $script:numberSource.valuePattern | Add-Member ScriptMethod SetValue {throw 'Number values must never be written by cursor preparation.'}
  $AE::FocusedElement=$script:numberSource;$authority=$anchor
  $numberModel=$null;$expectedNumberRow=-1
  if ($case -like 'number-native-*') {
    $numberModel=@([pscustomobject]@{display='';edit='';flags=[int]35},[pscustomobject]@{display='';edit='';flags=[int]35})
    $expectedNumberRow=0
  }
  switch ($case) {
    'number-existing' {$anchor.name='17';$anchor.val='17';$script:numberAnchorLive.Current.Name='17';$script:numberSource.valuePattern.Current.Value='17';$script:freshSourceTree.nodes[2].name='17';$script:freshSourceTree.nodes[2].val='17'}
    'number-fifth-row' {$script:numberAnchorLive.gridItem.Current.Row=[int]4;$script:numberSource.Current.AutomationId=$numberEditorPrefix+'(5).BelegNr'}
    {$_ -in @('number-current-second-row','number-current-dataitem')} {
      $second=$anchor.PSObject.Copy();$second.i=18;$second.rid='30.11';$second.y=164
      $tree.nodes+=@($second);$script:freshSourceTree.nodes+=@($second.PSObject.Copy())
      $script:numberAnchorLive=New-Element $second;$script:numberAnchorLive.parent=$script:table
      $script:numberAnchorLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=[int]0;ContainingGrid=$script:table}}
      $script:numberAnchorLive.selectionItem=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true}}
      $script:numberSource.Current.AutomationId=$numberEditorPrefix+'(2).BelegNr';$script:numberSource.Current.BoundingRectangle.Y=164
      if ($case -eq 'number-current-dataitem') {$script:numberSource=$script:numberAnchorLive;$AE::FocusedElement=$script:numberSource}
    }
    'number-no-authority' {$authority=$null}
    'number-wrong-type' {$script:numberSource.Current.ControlType=[System.Windows.Automation.ControlType]::ComboBox}
    'number-wrong-ordinal' {$script:numberSource.Current.AutomationId=$numberEditorPrefix+'(2).BelegNr'}
    'number-category-editor' {$script:numberSource.Current.AutomationId=$numberEditorPrefix+'(1).Kategorie'}
    'number-short-editor-path' {$script:numberSource.Current.AutomationId=$numberTableAid+'.(1).BelegNr'}
    'number-missing-column' {$headers[0].name='';$script:freshSourceTree.nodes[3].name=''}
    'number-hidden-column' {$headers[0].on=$false;$script:freshSourceTree.nodes[3].on=$false}
    'number-extra-named-header' {
      $extra=$headers[1].PSObject.Copy();$extra.i=17;$extra.rid='30.88';$extra.x=700
      $tree.nodes+=@($extra);$script:freshSourceTree.nodes+=@($extra.PSObject.Copy())
    }
    'number-duplicate-current-cell' {
      $duplicate=$anchor.PSObject.Copy();$duplicate.i=18;$duplicate.rid='30.11'
      $tree.nodes+=@($duplicate);$script:freshSourceTree.nodes+=@($duplicate.PSObject.Copy())
    }
    'number-clipped-current-cell' {$numberTable.h=50;$script:freshSourceTree.nodes[0].h=50}
    'number-not-selected' {$script:numberAnchorLive.selectionItem.Current.IsSelected=$false}
    'number-selection-unreadable' {$script:numberAnchorLive.selectionItem=$null}
    'number-selection-state-unknown' {$script:numberAnchorLive.selectionItem.Current.IsSelected='false'}
    'number-no-grid' {$script:numberAnchorLive.gridItem=$null}
    'number-wrong-column' {$script:numberAnchorLive.gridItem.Current.Column=[int]1}
    'number-wrong-grid' {$other=New-Element $numberTable;$other.rid='30.777';$script:numberAnchorLive.gridItem.Current.ContainingGrid=$other}
    'number-foreign-grid' {$other=New-Element $numberTable;$other.Current.ProcessId=8;$script:numberAnchorLive.gridItem.Current.ContainingGrid=$other}
    'number-noninteger-row' {$script:numberAnchorLive.gridItem.Current.Row='0'}
    'number-out-of-range' {$script:numberAnchorLive.gridItem.Current.Row=[int]1000}
    'number-wrong-ancestry' {$other=New-Element $numberTable;$other.rid='30.777';$other.parent=$root;$script:numberSource.parent=$other}
    'number-geometry' {$script:numberSource.Current.BoundingRectangle.X=101}
    'number-anchor-geometry' {$script:numberAnchorLive.Current.BoundingRectangle.X=101}
    'number-anchor-model-changed' {$script:numberAnchorLive.Current.Name='Synthetic changed number'}
    'number-no-value' {$script:numberSource.valuePattern=$null}
    'number-value-changed' {$script:numberSource.valuePattern.Current.Value='17'}
    'number-readonly-unknown' {$script:numberSource.valuePattern.Current.IsReadOnly='false'}
    'number-foreign-root' {$script:table.parent=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType=[System.Windows.Automation.ControlType]::Window;NativeWindowHandle=222}}}
    'number-native-readonly-unchanged' {$script:numberSource.valuePattern.Current.IsReadOnly=$true}
    'number-native-value-different' {$numberModel[0].display='Different prior Nr'}
    'number-native-edit-different' {$numberModel[0].edit='Different prior edit'}
    'number-native-flags-different' {$numberModel[0].flags=[int]1}
    'number-native-wrong-target-row' {$expectedNumberRow=1}
  }
  $result=Invoke-SSETableFooterFocus ([IntPtr]111) 7 $tree $numberTableAid '30.1' 'Synthetic page' 10 'stable' $null $authority $numberModel `
    -RequireNumberEditor:($case -like 'number-native-*') -ExpectedNumberRow $expectedNumberRow
  $success=$case -in @('number-blank','number-existing','number-fifth-row','number-current-second-row','number-current-dataitem','number-not-selected',
    'number-native-writable-unchanged','number-native-readonly-unchanged')
  if ($result.ok -ne $success -or $script:focusCalls -ne [int]$success -or $result.focusAttempted -ne $success) {
    throw "$case`: exact unchanged number delegate proof mismatch: $($result | ConvertTo-Json -Depth 8 -Compress)"
  }
  if ($script:sourceSnapshotReads -ne 1) {throw "$case`: snapshot refresh was retried or omitted."}
  if ($success -and $result.currentNumberCell.rid -cne $script:numberAnchorLive.rid) {throw "$case`: current Nr. cell authority was replaced by the first row."}
  if ($case -eq 'number-value-late' -and $result.reason -cne 'footer-number-editor-value-changed') {throw 'Changed number value reached footer focus.'}
  if ($case -eq 'number-no-grid' -and $result.sourceEvidence.numberAnchorReason -cne 'number-anchor-grid-item-unbound') {throw 'Missing live GridItemPattern was hidden.'}
  if ($case -eq 'number-value-changed' -and $result.sourceEvidence.numberAnchorReason -cne 'number-anchor-editor-value-changed') {throw 'Changed model number was accepted.'}
  if ($case -eq 'number-foreign-root' -and $result.sourceReason -cne 'source-main-window-unbound') {throw 'Known editor bypassed exact main-window ancestry.'}
  if ($case -in @('number-missing-column','number-hidden-column','number-extra-named-header') -and
      $result.sourceEvidence.numberAnchorReason -cne 'number-anchor-column-header-unbound') {throw 'Invalid named column header proof was lost.'}
  if ($result.sourceEvidence) {
    $safe=$result.sourceEvidence | ConvertTo-Json -Depth 4 -Compress
    if ($safe -match 'Synthetic changed number|"name"|"value"|"val"') {throw 'Number-editor diagnostics leaked model text.'}
  }
}

# Qt SelectionItem.Select leaves its native currentIndex untouched. Reproduce
# row2 focus / row1 selection, then prove exact current-cell selection aligns
# the two before the existing native focus transaction and verified HOME.
foreach ($case in @('selection-old-first','selection-current-second','selection-current-wrong-column','selection-current-wrong-grid',
  'selection-current-foreign-grid','selection-current-model-changed','selection-current-input-changed')) {
  $script:mode=$case;$script:tick=10;$script:selectionCalls=0;$script:selectedRid='30.10';$script:nativeCurrentRid='30.11'
  $first=$anchor.PSObject.Copy();$first.i=2;$first.rid='30.10';$first.y=140;$first.name='';$first.val=''
  $second=$first.PSObject.Copy();$second.i=18;$second.rid='30.11';$second.y=164
  $script:table=New-Element $numberTable;$script:table.parent=$root
  $script:table.Current.BoundingRectangle.Height=100
  $requested=$(if ($case -eq 'selection-old-first') {$null} else {$second})
  $selectedCell=$(if ($requested) {$second} else {$first})
  $script:numberAnchorLive=New-Element $selectedCell;$script:numberAnchorLive.parent=$script:table
  $script:numberAnchorLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=[int]0;ContainingGrid=$script:table}}
  $selection=[pscustomobject]@{owner=$script:numberAnchorLive;Current=[pscustomobject]@{IsSelected=$false;SelectionContainer=$script:table}}
  $selection | Add-Member ScriptMethod Select {$script:selectionCalls++;$script:selectedRid=$this.owner.rid;$this.Current.IsSelected=$true}
  $script:numberAnchorLive.selectionItem=$selection
  $snapshot=[pscustomobject]@{cursorAnchorIsNumber=$true;ersteZelle=$first;navigationBinding=[pscustomobject]@{
    editorFree=$true;tableRootAid=$numberTableAid;tableRootRid='30.1'}}
  switch ($case) {
    'selection-current-wrong-column' {$script:numberAnchorLive.gridItem.Current.Column=[int]1}
    'selection-current-wrong-grid' {$other=New-Element $numberTable;$other.rid='30.555';$script:numberAnchorLive.gridItem.Current.ContainingGrid=$other}
    'selection-current-foreign-grid' {$other=New-Element $numberTable;$other.Current.ProcessId=8;$script:numberAnchorLive.gridItem.Current.ContainingGrid=$other}
    'selection-current-model-changed' {$script:numberAnchorLive.Current.Name='Changed'}
    'selection-current-input-changed' {$script:tick=11}
  }
  $actual=Invoke-SSETableReadAnchorSelection ([IntPtr]111) 7 $snapshot 10 'stable' $requested
  $success=$case -in @('selection-old-first','selection-current-second')
  if ($actual -ne $success -or $script:selectionCalls -ne [int]$success) {throw "$case`: exact selection preparation guard failed or retried."}
  if ($case -eq 'selection-old-first' -and $script:selectedRid -ceq $script:nativeCurrentRid) {throw 'Fixture did not reproduce the real current/selection producer mismatch.'}
  if ($case -eq 'selection-current-second' -and $script:selectedRid -cne $script:nativeCurrentRid) {throw 'Corrected preparation still selected the first row.'}
  if ($script:nativeCurrentRid -cne '30.11') {throw 'Preparation wrote the native cursor instead of selecting its proved current Nr. cell.'}
}

# Preserve the exact conjunct of the combined keyboard/header/summary guard.
# The transient Edit stays absent from the complete bulk tree, as in Qt.
function Get-LiveElement($Window,$Rid,$Aid) {
  if ($script:mode -like 'keyboard-number-*') {
    if ($Rid -cin $script:keyboardHeaderRids) {$script:keyboardHeaderReads++}
    if ($Rid -ceq '30.90') {$script:keyboardSummaryReads++}
  }
  $element=$script:keyboardElements[[string]$Rid]
  if ($element -and $element.Current.AutomationId -ceq $Aid) {$element}
}
function Get-UiSnapshot($Window,$MaxNodes,$TimeoutSec,$MaxDepth,$RootElement) {
  if ($MaxNodes -ne 2048 -or $TimeoutSec -ne 5 -or $MaxDepth -ne 16 -or $RootElement.rid -cne '30.1') {
    throw 'Keyboard guard lost its bounded exact table walk.'
  }
  $script:keyboardWalks++
  if ($script:keyboardFocusAfterWalk) {$AE::FocusedElement=$script:keyboardFocusAfterWalk}
  if ($script:mode -ceq 'keyboard-number-late-value') {$script:numberSource.valuePattern.Current.Value='Synthetic changed number'}
  [pscustomobject]@{stats=$(if ($script:keyboardStats) {$script:keyboardStats} else {$stats});nodes=@($script:keyboardCells | ForEach-Object {
    $copy=$_.PSObject.Copy();$copy.i=[int]$_.i-1;$copy.p=-1;$copy
  })}
}
foreach ($case in @('keyboard-table','keyboard-cell','keyboard-transient-edit','keyboard-missing-cell',
  'keyboard-not-selected','keyboard-foreign-focus','keyboard-header','keyboard-summary-element','keyboard-summary-value')) {
  $script:table=New-Element $numberTable;$script:table.parent=$root
  $keyboardCell=$anchor.PSObject.Copy();$keyboardCell.i=1;$keyboardCell.p=0;$keyboardCell.name=''
  $script:keyboardCells=@($keyboardCell)
  $liveCell=New-Element $keyboardCell;$liveCell.parent=$script:table
  $selectedCurrent=[pscustomobject]@{}
  $selectedCurrent | Add-Member ScriptMethod GetSelection {@($script:keyboardSelected)}
  $script:table.selection=[pscustomobject]@{Current=$selectedCurrent};$script:keyboardSelected=@($liveCell)
  $header=$headers[0].PSObject.Copy();$header.name='Nr.'
  $headerElement=New-Element $header
  $summaryNode=[pscustomobject]@{type='Edit';name='12,34';rid='30.90';aid='Synthetic.Summary';x=100;y=300;w=90;h=24}
  $summaryElement=New-Element $summaryNode
  $script:keyboardElements=@{'30.1'=$script:table;'30.90'=$summaryElement}
  $script:keyboardElements[$header.rid]=$headerElement
  $snapshot=[pscustomobject]@{navigationBinding=[pscustomobject]@{tableRootAid=$numberTableAid;tableRootRid='30.1';
    headers=@($header);summaryIdentity='Synthetic summary';summaryRid='30.90';summaryAid='Synthetic.Summary';summaryValue='12,34'}}
  $AE::FocusedElement=$script:table
  switch ($case) {
    'keyboard-cell' {$AE::FocusedElement=$liveCell}
    'keyboard-transient-edit' {
      $transient=$keyboardCell.PSObject.Copy();$transient.type='Edit';$transient.rid='30.99';$transient.aid=$numberEditorPrefix+'(1).BelegNr'
      $focus=New-Element $transient;$focus.parent=$script:table;$AE::FocusedElement=$focus
    }
    'keyboard-missing-cell' {$focus=New-Element $keyboardCell;$focus.rid='30.99';$focus.parent=$script:table;$AE::FocusedElement=$focus}
    'keyboard-not-selected' {
      $extra=$keyboardCell.PSObject.Copy();$extra.i=2;$extra.rid='30.99';$script:keyboardCells+=@($extra)
      $focus=New-Element $extra;$focus.parent=$script:table;$AE::FocusedElement=$focus
    }
    'keyboard-foreign-focus' {$focus=New-Element $summaryNode;$focus.Current.ProcessId=8;$focus.Current.AutomationId='Synthetic other-app private aid';$AE::FocusedElement=$focus}
    'keyboard-header' {$headerElement.Current.Name='Changed'}
    'keyboard-summary-element' {$script:keyboardElements.Remove('30.90')}
    'keyboard-summary-value' {$summaryElement.Current.Name='56,78'}
  }
  $evidence=$null;$success=$case -in @('keyboard-table','keyboard-cell')
  $actual=Test-SSETableReadKeyboardTarget ([IntPtr]111) 7 $snapshot ([ref]$evidence)
  if ($actual -ne $success) {throw "$case`: diagnostics changed the original keyboard guard behavior."}
  $expectedReason=switch ($case) {
    {$_ -in @('keyboard-table','keyboard-cell')} {$null;break}
    {$_ -in @('keyboard-transient-edit','keyboard-missing-cell')} {'keyboard-focus-is-not-table-or-cell';break}
    'keyboard-not-selected' {'focused-cell-is-not-selected-cursor';break}
    'keyboard-foreign-focus' {'keyboard-focused-process-or-state-unbound';break}
    'keyboard-header' {'keyboard-column-header-unbound';break}
    'keyboard-summary-element' {'keyboard-summary-element-unbound';break}
    'keyboard-summary-value' {'keyboard-summary-value-changed';break}
  }
  if ($evidence.reason -cne $expectedReason) {throw "$case`: combined keyboard conjunct was masked: $($evidence.reason)"}
  if ($case -eq 'keyboard-transient-edit' -and ($evidence.liveInput.keyboardEvidence.focusedSource.type -cne 'Edit' -or
      $evidence.liveInput.keyboardEvidence.directCellCount -ne 0 -or $evidence.liveInput.keyboardEvidence.directTable)) {
    throw 'Actual transient editor metadata was replaced by its class name or a snapshot guess.'
  }
  if ($case -eq 'keyboard-not-selected' -and $evidence.liveInput.keyboardEvidence.focusedSelected -ne $false) {
    throw 'Keyboard focus and selection identity were collapsed into one guard.'
  }
  $safe=$evidence | ConvertTo-Json -Depth 8 -Compress
  if ($safe -match 'private aid|"name"|"value"|"val"|12,34|56,78') {throw 'Keyboard guard diagnostics exposed field values or foreign-app metadata.'}
}

# The regular keyboard proof rejects Edit only after its complete scoped walk.
# The standard Nr. path must keep the actual full selected-number proof while
# avoiding that doomed first walk. No accepted helper is replaced by a stub.
foreach ($case in @('keyboard-number-exact','keyboard-number-readonly','keyboard-number-table','keyboard-number-cell',
  'keyboard-number-private','keyboard-number-header','keyboard-number-summary','keyboard-number-policy',
  'keyboard-number-arbitrary-edit','keyboard-number-value','keyboard-number-late-value','keyboard-number-no-value',
  'keyboard-number-untyped-readonly','keyboard-number-stale-raw','keyboard-number-geometry','keyboard-number-model-name',
  'keyboard-number-anchor-geometry','keyboard-number-ordinal','keyboard-number-grid-row','keyboard-number-grid-column',
  'keyboard-number-grid-root','keyboard-number-foreign-focus','keyboard-number-unfocused','keyboard-number-ancestry',
  'keyboard-number-selection-empty','keyboard-number-selection-duplicate','keyboard-number-selection-other',
  'keyboard-number-no-selection-pattern','keyboard-number-duplicate-current-cell',
  'keyboard-number-current-incomplete','keyboard-number-current-errors','keyboard-number-snapshot-incomplete','keyboard-number-visible-editor',
  'keyboard-number-edit-to-cell','keyboard-number-edit-to-foreign','keyboard-number-table-to-edit','keyboard-number-hint-throws')) {
  $script:mode=$case;$script:focusCalls=0;$script:selectionCalls=0;$script:keyboardValueWrites=0;$script:keyboardToggles=0
  $script:keyboardWalks=0;$script:keyboardNumberRawReads=0;$script:keyboardFocusAfterWalk=$null;$script:currentNumberCells=$null
  $script:keyboardHeaderReads=0;$script:keyboardSummaryReads=0;$script:SSE_TABLE_NUMBER_EDITOR_REJECTION='synthetic-number-not-reached'
  [System.Windows.Forms.SendKeys]::Calls=0
  $numberTable=[pscustomobject]@{i=0;p=-1;type='Table';name='';aid=$numberTableAid;rid='30.1';on=$true;x=100;y=100;w=600;h=100}
  $headers=@(0..5 | ForEach-Object {[pscustomobject]@{i=1+$_;p=0;type='Header';name=$(if ($_ -eq 0) {'Nr.'} else {'Synthetic header'});
    aid=$numberTableAid+'.Header'+$_;rid='30.'+(20+$_);on=$true;x=100+100*$_;y=100;w=55;h=24}})
  $script:keyboardHeaderRids=@($headers.rid)
  $numberCell=[pscustomobject]@{i=7;p=0;type='DataItem';name='';val='';aid=$numberTableAid;rid='30.10';on=$true;x=100;y=140;w=55;h=24}
  $tree=[pscustomobject]@{nodes=@($numberTable)+$headers+@($numberCell);stats=$stats.PSObject.Copy()}
  $script:keyboardStats=$stats.PSObject.Copy();$script:keyboardCells=@($numberCell)
  $script:table=New-Element $numberTable;$script:table.parent=$root
  $script:numberAnchorLive=New-Element $numberCell;$script:numberAnchorLive.parent=$script:table
  $script:numberAnchorLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]0;Column=[int]0;ContainingGrid=$script:table}}
  $script:numberAnchorLive.selectionItem=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true}}
  $script:numberAnchorLive.selectionItem | Add-Member ScriptMethod Select {$script:selectionCalls++;$this.Current.IsSelected=$true}
  $selectedCurrent=[pscustomobject]@{};$selectedCurrent | Add-Member ScriptMethod GetSelection {@($script:keyboardSelected)}
  $script:table.selection=[pscustomobject]@{Current=$selectedCurrent};$script:keyboardSelected=@($script:numberAnchorLive)
  $editor=$numberCell.PSObject.Copy();$editor.i=8;$editor.type='Edit';$editor.rid='30.99';$editor.aid=$numberEditorPrefix+'(1).BelegNr'
  $script:numberSource=New-Element $editor;$script:numberSource.parent=$script:table
  $script:numberSource.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value='';IsReadOnly=$false}}
  $script:numberSource.valuePattern | Add-Member ScriptMethod SetValue {param($Value)$script:keyboardValueWrites++;$this.Current.Value=$Value}
  $script:numberSource.toggle=[pscustomobject]@{}
  $script:numberSource.toggle | Add-Member ScriptMethod Toggle {$script:keyboardToggles++}
  $summaryNode=[pscustomobject]@{type='Edit';name='12,34';rid='30.90';aid='Synthetic.Summary';x=100;y=300;w=90;h=24}
  $summaryElement=New-Element $summaryNode
  $script:keyboardElements=@{'30.1'=$script:table;'30.90'=$summaryElement}
  foreach ($header in $headers) {$script:keyboardElements[$header.rid]=New-Element $header}
  $snapshot=[pscustomobject]@{cursorAnchorIsNumber=$true;ersteZelle=$numberCell;kopf=@($headers.name);navigationBinding=[pscustomobject]@{
    complete=$true;editorFree=$true;tableRootAid=$numberTableAid;tableRootRid='30.1';headers=@($headers);
    summaryIdentity='Synthetic summary';summaryRid='30.90';summaryAid='Synthetic.Summary';summaryValue='12,34'}}
  $AE::FocusedElement=$script:numberSource;$proofTree=$tree
  switch ($case) {
    'keyboard-number-readonly' {$script:numberSource.valuePattern.Current.IsReadOnly=$true}
    'keyboard-number-table' {$AE::FocusedElement=$script:table}
    'keyboard-number-cell' {$AE::FocusedElement=$script:numberAnchorLive}
    'keyboard-number-private' {$proofTree=$null}
    'keyboard-number-header' {$script:keyboardElements[$headers[0].rid].Current.Name='Changed'}
    'keyboard-number-summary' {$summaryElement.Current.Name='56,78'}
    'keyboard-number-policy' {$snapshot.cursorAnchorIsNumber=$false}
    'keyboard-number-arbitrary-edit' {$script:numberSource.Current.AutomationId=$numberTableAid+'.UnknownEditor'}
    'keyboard-number-value' {$script:numberSource.valuePattern.Current.Value='Synthetic changed number'}
    'keyboard-number-no-value' {$script:numberSource.valuePattern=$null}
    'keyboard-number-untyped-readonly' {$script:numberSource.valuePattern.Current.IsReadOnly='false'}
    'keyboard-number-geometry' {$script:numberSource.Current.BoundingRectangle.X=101}
    'keyboard-number-model-name' {$script:numberAnchorLive.Current.Name='Synthetic changed number'}
    'keyboard-number-anchor-geometry' {$script:numberAnchorLive.Current.BoundingRectangle.X=101}
    'keyboard-number-ordinal' {$script:numberSource.Current.AutomationId=$numberEditorPrefix+'(2).BelegNr'}
    'keyboard-number-grid-row' {$script:numberAnchorLive.gridItem.Current.Row=[int]1}
    'keyboard-number-grid-column' {$script:numberAnchorLive.gridItem.Current.Column=[int]1}
    'keyboard-number-grid-root' {$other=New-Element $numberTable;$other.rid='30.555';$script:numberAnchorLive.gridItem.Current.ContainingGrid=$other}
    'keyboard-number-foreign-focus' {$script:numberSource.Current.ProcessId=8}
    'keyboard-number-unfocused' {$script:numberSource.Current.HasKeyboardFocus=$false}
    'keyboard-number-ancestry' {$script:numberSource.parent=$root}
    'keyboard-number-selection-empty' {$script:keyboardSelected=@()}
    'keyboard-number-selection-duplicate' {$script:keyboardSelected=@($script:numberAnchorLive,$script:numberAnchorLive)}
    'keyboard-number-selection-other' {
      $other=$numberCell.PSObject.Copy();$other.i=9;$other.rid='30.11';$other.x=200
      $script:keyboardCells+=@($other);$script:keyboardSelected=@((New-Element $other))
    }
    'keyboard-number-no-selection-pattern' {$script:table.selection=$null}
    'keyboard-number-duplicate-current-cell' {$duplicate=$numberCell.PSObject.Copy();$duplicate.i=9;$duplicate.rid='30.11';$tree.nodes+=@($duplicate)}
    'keyboard-number-current-incomplete' {$script:keyboardStats.truncated=$true}
    'keyboard-number-current-errors' {$script:keyboardStats.err=1}
    'keyboard-number-snapshot-incomplete' {$tree.stats.truncated=$true}
    'keyboard-number-visible-editor' {$script:keyboardCells+=@($editor)}
    'keyboard-number-edit-to-cell' {$script:keyboardFocusAfterWalk=$script:numberAnchorLive}
    'keyboard-number-edit-to-foreign' {$foreign=New-Element $editor;$foreign.Current.ProcessId=8;$script:keyboardFocusAfterWalk=$foreign}
    'keyboard-number-table-to-edit' {$AE::FocusedElement=$script:table;$script:keyboardFocusAfterWalk=$script:numberSource}
    'keyboard-number-hint-throws' {
      $script:keyboardHintReads=0
      $script:numberSource | Add-Member NoteProperty ActualCurrent $script:numberSource.Current
      $script:numberSource.PSObject.Properties.Remove('Current')
      $script:numberSource | Add-Member ScriptProperty Current {
        $script:keyboardHintReads++
        if ($script:keyboardHintReads -eq 1) {throw [InvalidOperationException]::new('Synthetic transient focus read')}
        $this.ActualCurrent
      }
    }
  }
  $evidence=$null
  $actual=Test-SSETableReadKeyboardTarget ([IntPtr]111) 7 $snapshot ([ref]$evidence) $proofTree
  $success=$case -in @('keyboard-number-exact','keyboard-number-readonly','keyboard-number-table','keyboard-number-cell','keyboard-number-table-to-edit','keyboard-number-hint-throws')
  if ($actual -ne $success) {throw "$case`: exact selected-number proof changed acceptance: $($evidence | ConvertTo-Json -Depth 8 -Compress)"}
  $expectedWalks=switch ($case) {
    {$_ -in @('keyboard-number-header','keyboard-number-summary','keyboard-number-policy')} {0;break}
    {$_ -in @('keyboard-number-table-to-edit','keyboard-number-hint-throws')} {2;break}
    default {1}
  }
  if ($script:keyboardWalks -ne $expectedWalks) {throw "$case`: scoped walk count $($script:keyboardWalks) instead of $expectedWalks; duplicate work or omitted live selection proof."}
  if ($case -in @('keyboard-number-exact','keyboard-number-readonly','keyboard-number-table-to-edit','keyboard-number-hint-throws') -and $script:keyboardNumberRawReads -ne 1) {
    throw "$case`: independent fresh RAW/Grid/value proof was omitted or retried."
  }
  if ($case -in @('keyboard-number-exact','keyboard-number-readonly') -and ($evidence.phase -cne 'owned-number-editor-binding' -or $null -ne $evidence.liveInput)) {
    throw 'Direct number proof fabricated a failed regular-read diagnostic.'
  }
  if ($case -eq 'keyboard-number-private' -and $script:keyboardNumberRawReads -ne 0) {throw 'Private/null-Tree phase entered the standard number-editor proof.'}
  $expectedHeaderReads=$(if ($case -eq 'keyboard-number-header') {1} else {6})
  $expectedSummaryReads=$(if ($case -eq 'keyboard-number-header') {0} else {1})
  if ($script:keyboardHeaderReads -ne $expectedHeaderReads -or $script:keyboardSummaryReads -ne $expectedSummaryReads) {
    throw "$case`: live header or summary binding was skipped or retried."
  }
  if ($case -in @('keyboard-number-table','keyboard-number-cell','keyboard-number-private','keyboard-number-header','keyboard-number-summary',
      'keyboard-number-foreign-focus','keyboard-number-unfocused') -and $script:SSE_TABLE_NUMBER_EDITOR_REJECTION -cne 'synthetic-number-not-reached') {
    throw "$case`: branch hint entered the number proof without its own focused Edit."
  }
  if ($case -in @('keyboard-number-foreign-focus','keyboard-number-unfocused') -and
      ($evidence.reason -cne 'keyboard-focused-process-or-state-unbound' -or -not $evidence.liveInput.keyboardEvidence.focusedSource)) {
    throw "$case`: the hint masked the ordinary process/focus rejection evidence."
  }
  if ($case -eq 'keyboard-number-hint-throws' -and ($script:keyboardHintReads -lt 2 -or $null -eq $evidence.liveInput)) {
    throw 'A transient hint-read failure replaced the independent ordinary proof.'
  }
  if ($case -in @('keyboard-number-edit-to-cell','keyboard-number-edit-to-foreign') -and
      ($evidence.reason -cne 'number-anchor-focused-type-unbound' -or $null -ne $evidence.liveInput)) {
    throw "$case`: changed focus fell through to ordinary acceptance or fabricated its diagnostic."
  }
  if ($script:focusCalls -ne 0 -or $script:selectionCalls -ne 0 -or $script:keyboardValueWrites -ne 0 -or
      $script:keyboardToggles -ne 0 -or [System.Windows.Forms.SendKeys]::Calls -ne 0) {throw "$case`: keyboard proof performed an input action."}
  $safe=$evidence | ConvertTo-Json -Depth 8 -Compress
  if ($safe -match 'Synthetic changed number|12,34|56,78|"name"|"value"|"val"') {throw 'Number keyboard diagnostics exposed field values.'}
}
$script:keyboardFocusAfterWalk=$null;$script:keyboardStats=$null

# HOME may move Qt's current index without moving its selected row. The old
# keyboard proof must reject that real distinction; only the planned, proven
# first-number-cell Select is allowed to align it. All acceptance helpers here
# are extracted from the production worker, with no accepted-result doubles.
foreach ($case in @('home-align','home-offscreen-old-selection','home-already-selected','home-readonly','home-table',
  'home-arbitrary-editor','home-value','home-grid-row','home-grid-column','home-unselected-unknown','home-foreign-focus',
  'home-unfocused','home-ancestry','home-incomplete','home-wrong-anchor','home-input','home-dirty','home-untyped-dirty','home-heading',
  'home-late-value','home-late-readonly','home-late-source','home-late-focus','home-late-geometry','home-late-ancestry','home-late-grid-row','home-late-input','home-late-window',
  'home-select-throws','home-select-noop','home-semantics-error','home-semantics-short','home-semantics-untyped-ok')) {
  $script:mode='keyboard-number-'+$case;$script:tick=10;$script:focusCalls=0;$script:selectionCalls=0
  $script:keyboardValueWrites=0;$script:keyboardToggles=0;$script:keyboardWalks=0;$script:keyboardNumberRawReads=0
  $script:keyboardFocusAfterWalk=$null;$script:currentNumberCells=$null;$script:homeDirty=$false;$script:homeHeading='Synthetic page';$script:homeWindow=$null
  $script:homeAttemptObserved=$false
  [System.Windows.Forms.SendKeys]::Calls=0
  $numberTable=[pscustomobject]@{i=0;p=-1;type='Table';name='';aid=$numberTableAid;rid='30.1';on=$true;x=100;y=100;w=600;h=160}
  $headers=@(0..5 | ForEach-Object {[pscustomobject]@{i=1+$_;p=0;type='Header';name=$(if ($_ -eq 0) {'Nr.'} else {'Synthetic header'});
    aid=$numberTableAid+'.Header'+$_;rid='30.'+(20+$_);on=$true;x=100+100*$_;y=100;w=55;h=24}})
  $script:keyboardHeaderRids=@($headers.rid)
  $numberCell=[pscustomobject]@{i=7;p=0;type='DataItem';name='';val='';aid=$numberTableAid;rid='30.10';on=$true;x=100;y=140;w=55;h=24}
  $oldCell=$numberCell.PSObject.Copy();$oldCell.i=8;$oldCell.rid='30.11';$oldCell.y=188
  $tree=[pscustomobject]@{nodes=@($numberTable)+$headers+@($numberCell,$oldCell);stats=$stats.PSObject.Copy()}
  $script:keyboardStats=$stats.PSObject.Copy();$script:keyboardCells=@($numberCell,$oldCell)
  $script:table=New-Element $numberTable;$script:table.parent=$root
  $script:numberAnchorLive=New-Element $numberCell;$script:numberAnchorLive.parent=$script:table
  $script:numberAnchorLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]0;Column=[int]0;ContainingGrid=$script:table}}
  $script:numberAnchorLive.selectionItem=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$false;SelectionContainer=$script:table}}
  $script:numberAnchorLive.selectionItem | Add-Member ScriptMethod Select {
    $script:selectionCalls++
    $script:homeAttemptObserved=$DispatchState.attempted
    if ($script:mode -ceq 'keyboard-number-home-select-throws') {throw 'Synthetic Select response lost'}
    if ($script:mode -ceq 'keyboard-number-home-select-noop') {return}
    $this.Current.IsSelected=$true;$script:keyboardSelected=@($script:numberAnchorLive)
  }
  $selectedCurrent=[pscustomobject]@{};$selectedCurrent | Add-Member ScriptMethod GetSelection {@($script:keyboardSelected)}
  $script:table.selection=[pscustomobject]@{Current=$selectedCurrent};$script:keyboardSelected=@((New-Element $oldCell))
  $editor=$numberCell.PSObject.Copy();$editor.i=9;$editor.type='Edit';$editor.rid='30.99';$editor.aid=$numberEditorPrefix+'(1).BelegNr'
  $script:numberSource=New-Element $editor;$script:numberSource.parent=$script:table
  $script:numberSource.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value='';IsReadOnly=$false}}
  $summaryNode=[pscustomobject]@{type='Edit';name='12,34';rid='30.90';aid='Synthetic.Summary';x=100;y=300;w=90;h=24}
  $script:keyboardElements=@{'30.1'=$script:table;'30.90'=(New-Element $summaryNode)}
  foreach ($header in $headers) {$script:keyboardElements[$header.rid]=New-Element $header}
  $semantic=@(0..5 | ForEach-Object {[pscustomobject]@{type='text';value='';checkboxState=$null;ok=$true;error=$null}})
  $snapshot=[pscustomobject]@{cursorAnchorIsNumber=$true;ersteZelle=$numberCell;kopf=@($headers.name);zeilen=@(,@('','','','','',''));
    zeilenMitIdentitaet=@([pscustomobject]@{semanticCells=$semantic});navigationBinding=[pscustomobject]@{
    complete=$true;editorFree=$true;heading='Synthetic page';tableRootAid=$numberTableAid;tableRootRid='30.1';headers=@($headers);
    summaryIdentity='Synthetic summary';summaryRid='30.90';summaryAid='Synthetic.Summary';summaryValue='12,34'}}
  $AE::FocusedElement=$script:numberSource
  switch ($case) {
    'home-offscreen-old-selection' {$script:keyboardCells=@($numberCell)}
    'home-already-selected' {$script:numberAnchorLive.selectionItem.Current.IsSelected=$true;$script:keyboardSelected=@($script:numberAnchorLive)}
    'home-readonly' {$script:numberSource.valuePattern.Current.IsReadOnly=$true}
    'home-table' {$AE::FocusedElement=$script:table}
    'home-arbitrary-editor' {$script:numberSource.Current.AutomationId='Synthetic.OtherEditor'}
    'home-value' {$script:numberSource.valuePattern.Current.Value='changed'}
    'home-grid-row' {$script:numberAnchorLive.gridItem.Current.Row=[int]1;$script:numberSource.Current.AutomationId=$numberEditorPrefix+'(2).BelegNr'}
    'home-grid-column' {$script:numberAnchorLive.gridItem.Current.Column=[int]1}
    'home-unselected-unknown' {$script:numberAnchorLive.selectionItem.Current.IsSelected='false'}
    'home-foreign-focus' {$script:numberSource.Current.ProcessId=8}
    'home-unfocused' {$script:numberSource.Current.HasKeyboardFocus=$false}
    'home-ancestry' {$script:numberSource.parent=$root}
    'home-incomplete' {$tree.stats.truncated=$true}
    'home-wrong-anchor' {$snapshot.ersteZelle=$oldCell}
  }
  $evidence=$null;$before=Test-SSETableReadKeyboardTarget ([IntPtr]111) 7 $snapshot ([ref]$evidence) $tree
  if ($before -ne ($case -in @('home-already-selected','home-table'))) {throw "$case`: the actual keyboard guard changed acceptance of current versus selected row."}
  if ($script:selectionCalls -ne 0) {throw 'The keyboard proof itself performed Select.'}
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-SSETableReadHomeSelection'},$true))
  if ($definition.Count -ne 1) {throw 'Planned HOME alignment helper is absent.'}
  . ([scriptblock]::Create($definition[0].Extent.Text))
  $script:keyboardWalks=0;$script:keyboardNumberRawReads=0
  switch ($case) {
    'home-input' {$script:tick=11}
    'home-dirty' {$script:homeDirty=$true}
    'home-untyped-dirty' {$script:homeDirty='False'}
    'home-heading' {$script:homeHeading='Changed page'}
    'home-semantics-error' {$semantic[0].ok=$false;$semantic[0].error='Synthetic semantic error'}
    'home-semantics-short' {$snapshot.zeilenMitIdentitaet[0].semanticCells=@($semantic[0])}
    'home-semantics-untyped-ok' {$semantic[0].ok='true'}
  }
  $outcome=Invoke-SSETableReadHomeSelection ([IntPtr]111) 7 $snapshot $tree 10 'stable' $false
  $succeeds=$case -in @('home-align','home-offscreen-old-selection','home-already-selected','home-readonly','home-table','home-select-noop')
  if ($outcome.ok -ne $succeeds) {throw "$case`: HOME source/dispatch proof returned $($outcome | ConvertTo-Json -Compress)"}
  $attempted=$case -in @('home-align','home-offscreen-old-selection','home-readonly','home-select-throws','home-select-noop')
  if ($outcome.attempted -ne $attempted -or $script:selectionCalls -ne [int]$attempted) {throw "$case`: Select was replayed, skipped or its attempted state was lost."}
  if ($script:homeAttemptObserved -ne $attempted) {throw "$case`: Select attempt was recorded after dispatch instead of before it."}
  if ($case -ceq 'home-already-selected' -and $script:keyboardNumberRawReads -ne 1) {throw 'Already-selected HOME repeated the source proof or attempted a post-action read.'}
  if ($script:keyboardWalks -ne 0 -or $script:focusCalls -ne 0 -or [System.Windows.Forms.SendKeys]::Calls -ne 0) {throw "$case`: planned alignment read the old selection or submitted unrelated input."}
  if ($AE::FocusedElement.rid -cne '30.99' -and $case -notin @('home-late-source','home-table')) {throw "$case`: Select changed the current editor identity."}
  if ($case -in @('home-align','home-offscreen-old-selection','home-readonly')) {
    $afterEvidence=$null
    if (-not (Test-SSETableReadKeyboardTarget ([IntPtr]111) 7 $snapshot ([ref]$afterEvidence) $tree)) {throw "$case`: actual complete selected keyboard proof did not accept the aligned row."}
  }
  if ($case -ceq 'home-select-noop') {
    $afterEvidence=$null
    if (Test-SSETableReadKeyboardTarget ([IntPtr]111) 7 $snapshot ([ref]$afterEvidence) $tree) {throw 'A Select without effect was accepted by the actual keyboard proof.'}
  }
}
$script:keyboardStats=$null;$script:homeHeading=$null;$script:homeDirty=$false;$script:homeWindow=$null

# The actual compiled RawView boundary and worker wrappers are exercised by
# fresh-raw-resolver-contract.ps1. These tests retain the caller's independent
# source, semantic focus, lease and no-action-after-rejection proofs.
# The broker can focus the table itself. Bind its one selected Nr. GridItem
# rather than treating table focus as a missing cell or guessing a row number.
foreach ($case in @('current-dataitem','current-table','current-table-ambiguous','current-wrong-grid-row','current-not-selected',
  'current-native-value-changed','current-foreign-grid','current-non-number-source','current-last-row-clipped',
  'current-header-layout','current-header-bottom-overlap','current-wrong-grid-column','current-wrong-grid-rid','current-wrong-grid-aid',
  'current-wrong-parent','current-disabled-number','current-foreign-cell-pid','current-pattern-unavailable','current-outside-viewport',
  'current-incomplete-row','current-missing-viewport','current-edv-seven-column','current-selection-pattern-unavailable',
  'current-untyped-grid-column','current-duplicate-metadata')) {
  $script:mode=$case;$script:tick=10
  $columns=$(if ($case -eq 'current-edv-seven-column') {7} else {6})
  $activeNumberAid=$(if ($columns -eq 7) {$prefix+'.DialogUI./.EDVKOsten.Tab'} else {$numberTableAid})
  $numberPolicy=$(if ($columns -eq 7) {[pscustomobject]@{tableName='/.EDVKOsten.Tab';headers=@('Nr.','Datum','Bezeichnung','Betrag','N','%','Netto')}} else {$null})
  $numberTable=[pscustomobject]@{i=0;p=-1;type='Table';name='';aid=$activeNumberAid;rid='30.1';on=$true;x=100;y=100;w=100*$columns;h=100}
  $headers=@(0..($columns-1) | ForEach-Object {[pscustomobject]@{i=1+$_;p=0;type='Header';name=$(if ($numberPolicy) {$numberPolicy.headers[$_]} elseif ($_ -eq 0) {'Nr.'} else {'Synthetic header'});
    aid=$activeNumberAid+'.Header'+$_;rid='30.'+(20+$_);on=$true;x=100+100*$_;y=100;w=55;h=24}})
  $row=@(0..($columns-1) | ForEach-Object {[pscustomobject]@{i=$columns+1+$_;p=0;type='DataItem';name='';val='';aid=$activeNumberAid;
    rid='30.'+(60+$_);on=$true;x=100+100*$_;y=164;w=55;h=24}})
  $tree=[pscustomobject]@{nodes=@($numberTable)+$headers+$row;stats=$stats.PSObject.Copy()}
  $script:table=New-Element $numberTable;$script:table.parent=$root
  $script:numberAnchorLive=New-Element $row[0];$script:numberAnchorLive.parent=$script:table
  $script:numberAnchorLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=[int]0;ContainingGrid=$script:table}}
  $script:numberAnchorLive.selectionItem=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true}}
  $AE::FocusedElement=$(if ($case -like 'current-table*') {$script:table} else {$script:numberAnchorLive})
  $selected=@($row.rid)
  $numberModel=@([pscustomobject]@{display='';edit='';flags=[int]35},[pscustomobject]@{display='';edit='';flags=[int]35})
  $snapshot=[pscustomobject]@{cursorAnchorIsNumber=$true;navigationBinding=[pscustomobject]@{
    editorFree=$true;tableRootAid=$activeNumberAid;tableRootRid='30.1'}}
  $viewport=[pscustomobject]@{table=$numberTable;left=100;top=124;right=100+100*$columns;bottom=200}
  switch ($case) {
    'current-table-ambiguous' {$copy=$row[0].PSObject.Copy();$copy.i=13;$copy.rid='30.99';$tree.nodes+=@($copy);$selected+=@($copy.rid)}
    'current-wrong-grid-row' {$script:numberAnchorLive.gridItem.Current.Row=[int]0}
    'current-not-selected' {$script:numberAnchorLive.selectionItem.Current.IsSelected=$false}
    'current-native-value-changed' {$numberModel[1].edit='Changed prior native Nr'}
    'current-foreign-grid' {$other=New-Element $numberTable;$other.Current.ProcessId=8;$script:numberAnchorLive.gridItem.Current.ContainingGrid=$other}
    'current-non-number-source' {$script:numberAnchorLive.Current.ControlType=[System.Windows.Automation.ControlType]::Edit}
    'current-last-row-clipped' {$numberTable.h=80}
    'current-header-layout' {$headers[0].x=102;$headers[0].w=51}
    'current-header-bottom-overlap' {$headers[0].h=65;$viewport.top=164}
    'current-wrong-grid-column' {$script:numberAnchorLive.gridItem.Current.Column=[int]1}
    'current-wrong-grid-rid' {$other=New-Element $numberTable;$other.rid='30.99';$script:numberAnchorLive.gridItem.Current.ContainingGrid=$other}
    'current-wrong-grid-aid' {$other=New-Element $numberTable;$other.Current.AutomationId='Synthetic.Other';$script:numberAnchorLive.gridItem.Current.ContainingGrid=$other}
    'current-wrong-parent' {$row[0].p=99}
    'current-disabled-number' {$row[0].on=$false}
    'current-foreign-cell-pid' {$script:numberAnchorLive.Current.ProcessId=8}
    'current-pattern-unavailable' {$script:numberAnchorLive.gridItem=$null}
    'current-outside-viewport' {$viewport.top=170}
    'current-incomplete-row' {$tree.nodes=@($tree.nodes | Where-Object {$_.rid -cne $row[5].rid})}
    'current-missing-viewport' {$viewport=$null}
    'current-edv-seven-column' {$row[6].on=$false}
    'current-selection-pattern-unavailable' {$script:numberAnchorLive.selectionItem=$null}
    'current-untyped-grid-column' {$script:numberAnchorLive.gridItem.Current.Column='0'}
    'current-duplicate-metadata' {$duplicate=$row[0].PSObject.Copy();$duplicate.i=99;$tree.nodes+=@($duplicate)}
  }
  if ($case -eq 'current-last-row-clipped') {$viewport.bottom=180}
  $script:currentNumberCells=@{}
  for ($column=0;$column -lt $row.Count;$column++) {
    $item=New-Element $row[$column];$item.parent=$script:table
    $item.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=[int]$column;ContainingGrid=$script:table}}
    $item.selectionItem=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true}}
    $script:currentNumberCells[$row[$column].rid]=$item
  }
  $script:currentNumberCells[$row[0].rid]=$script:numberAnchorLive
  if ($case -eq 'current-table-ambiguous') {
    $other=New-Element $copy;$other.gridItem=$script:numberAnchorLive.gridItem;$other.selectionItem=$script:numberAnchorLive.selectionItem
    $script:currentNumberCells[$copy.rid]=$other
  }
  $result=Get-SSETableCursorNumberCellProof ([IntPtr]111) 7 $tree $snapshot $null $numberModel 1 -RequireSelected -SelectedRids $selected `
    -ViewportBounds $viewport -RequireContained:($case -ne 'current-last-row-clipped') -NumberPolicy $numberPolicy
  $success=$case -in @('current-dataitem','current-table','current-last-row-clipped','current-header-layout','current-header-bottom-overlap','current-edv-seven-column')
  if ($result.ok -ne $success) {throw "$case`: exact current native/grid selection proof mismatch: $($result | ConvertTo-Json -Depth 4 -Compress)"}
  $expectedReason=switch ($case) {
    'current-table-ambiguous' {'current-number-focused-node-not-unique'}
    'current-wrong-grid-row' {'current-number-cell-grid-unbound'}
    'current-not-selected' {'current-number-cell-not-selected'}
    'current-native-value-changed' {'current-number-cell-prior-native-value-unbound'}
    'current-foreign-grid' {'current-number-cell-grid-unbound'}
    'current-non-number-source' {'current-number-focused-type-unbound'}
    'current-wrong-grid-column' {'current-number-cell-grid-unbound'}
    'current-wrong-grid-rid' {'current-number-cell-grid-unbound'}
    'current-wrong-grid-aid' {'current-number-cell-grid-unbound'}
    'current-wrong-parent' {'current-number-cell-metadata-unbound'}
    'current-disabled-number' {'current-number-cell-metadata-unbound'}
    'current-foreign-cell-pid' {'current-number-focused-source-unbound'}
    'current-pattern-unavailable' {'current-number-cell-pattern-unbound'}
    'current-outside-viewport' {'current-number-row-outside-native-viewport'}
    'current-incomplete-row' {'current-number-row-outside-native-viewport'}
    'current-missing-viewport' {'current-number-native-viewport-unbound'}
    'current-selection-pattern-unavailable' {'current-number-cell-pattern-unbound'}
    'current-untyped-grid-column' {'current-number-cell-grid-unbound'}
    'current-duplicate-metadata' {'current-number-focused-node-not-unique'}
    default {'exact-current-grid-number-cell'}
  }
  if ($result.reason -cne $expectedReason) {throw "$case`: precise current number proof rejection was discarded."}
  if ($case -eq 'current-wrong-grid-row' -and ($result.row -ne 0 -or $result.column -ne 0)) {
    throw 'Rejected live GridItem coordinates were replaced by the requested model row.'
  }
  if ($case -eq 'current-last-row-clipped' -and $result.rowFullyContained) {throw 'Clipped last row was accepted as a fully visible end.'}
  if ($success -and $case -ne 'current-last-row-clipped' -and -not $result.rowFullyContained) {throw 'Complete six-column contained row was lost.'}
  if ($case -eq 'current-header-layout' -and ($result.metadataEvidence.headerXEqual -or $result.metadataEvidence.headerWidthEqual)) {
    throw 'Header geometry replaced the independently proven actual GridItem index.'
  }
  if ($case -eq 'current-header-bottom-overlap' -and $result.metadataEvidence.belowHeader) {throw 'Native viewport was guessed from header height.'}
  if ($case -eq 'current-pattern-unavailable' -and ($result.metadataEvidence.gridPatternAvailable -or
      $null -ne $result.metadataEvidence.selectionPatternAvailable)) {throw 'Unsupported GridItem was hidden by a guessed column.'}
  if ($case -eq 'current-selection-pattern-unavailable' -and (-not $result.metadataEvidence.gridPatternAvailable -or
      $result.metadataEvidence.selectionPatternAvailable)) {throw 'Missing selection pattern was confused with missing GridItem.'}
  $safe=$result.metadataEvidence | ConvertTo-Json -Depth 5 -Compress
  if ($safe -match 'name|val|edit|numberModel|nonce|inputEpoch') {throw 'Current cell metadata diagnostics disclosed values or lease authority.'}
}
$script:currentNumberCells=$null
function Get-SSETableReadViewportBounds {
  param($Tree,$Snapshot,$Geometry,$Dpi,$ClientOrigin)
  if ($Geometry.coordinateSpace -cne 'qt-native-screen' -or $Dpi -ne 96) {return $null}
  [pscustomobject]@{table=$Tree.nodes[0];left=100;top=124;right=700;bottom=200}
}
foreach ($case in @('pending-visible','pending-transient','pending-other-editor','pending-changed-value','pending-wrong-row',
  'pending-wrong-selection','pending-foreign-epoch','pending-missing-profile')) {
  $script:mode=$case;$script:tick=10;$script:focusCalls=0;$script:sourceSnapshotReads=0
  $numberTable=[pscustomobject]@{i=0;p=-1;type='Table';name='';aid=$numberTableAid;rid='30.1';on=$true;x=100;y=100;w=600;h=100}
  $headers=@(0..5 | ForEach-Object {[pscustomobject]@{i=1+$_;p=0;type='Header';name=$(if ($_ -eq 0) {'Nr.'} else {'Synthetic header'});
    aid=$numberTableAid+'.Header'+$_;rid='30.'+(20+$_);on=$true;x=100+100*$_;y=100;w=55;h=24}})
  $row=@(0..5 | ForEach-Object {[pscustomobject]@{i=7+$_;p=0;type='DataItem';name='';val='';aid=$numberTableAid;
    rid='30.'+(60+$_);on=$true;x=100+100*$_;y=164;w=55;h=24}})
  $pending=$row[0].PSObject.Copy();$pending.i=31;$pending.type='Edit';$pending.rid='30.99';$pending.aid=$numberEditorPrefix+'(2).BelegNr'
  $numberFooter=$buttonNode.PSObject.Copy();$numberFooter.i=30;$numberFooter.rid='30.2'
  $tree=[pscustomobject]@{nodes=@($numberTable)+$headers+$row+@($numberFooter);stats=$stats.PSObject.Copy()}
  if ($case -ne 'pending-transient') {$tree.nodes+=@($pending)}
  if ($case -eq 'pending-other-editor') {$other=$pending.PSObject.Copy();$other.i=32;$other.rid='30.98';$other.aid=$numberTableAid+'.Unknown';$tree.nodes+=@($other)}
  $script:table=New-Element $numberTable;$script:table.parent=$root
  $script:button=New-Element $numberFooter;$script:button.parent=$root
  $script:numberAnchorLive=New-Element $row[0];$script:numberAnchorLive.parent=$script:table
  $script:numberAnchorLive.gridItem=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=[int]0;ContainingGrid=$script:table}}
  $script:numberAnchorLive.selectionItem=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true}}
  $selectedCurrent=[pscustomobject]@{};$selectedCurrent | Add-Member ScriptMethod GetSelection {@($script:keyboardSelected)}
  $script:table.selection=[pscustomobject]@{Current=$selectedCurrent};$script:keyboardSelected=@($script:numberAnchorLive)
  if ($case -eq 'pending-wrong-selection') {$script:keyboardSelected=@()}
  $script:keyboardElements=@{'30.1'=$script:table};$script:keyboardCells=@($row)
  if ($case -ne 'pending-transient') {$script:keyboardCells+=@($pending)}
  $script:numberSource=New-Element $pending;$script:numberSource.parent=$script:table
  $script:numberSource.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value='';IsReadOnly=$false}}
  $AE::FocusedElement=$script:numberSource
  if ($case -eq 'pending-changed-value') {$script:numberSource.valuePattern.Current.Value='changed'}
  if ($case -eq 'pending-wrong-row') {$script:numberAnchorLive.gridItem.Current.Row=[int]0}
  $snapshot=[pscustomobject]@{cursorAnchorIsNumber=$true;ersteZelle=$row[0];kopf=@($headers.name);tabelleAnzahl=1;error=$null;
    navigationBinding=[pscustomobject]@{complete=$true;editorFree=($case -eq 'pending-transient');heading='Synthetic page';tableIdentity='exact';
      tableRootAid=$numberTableAid;tableRootRid='30.1';scopePrefix='Synthetic';selectionMethod='synthetic';summaryIdentity='Synthetic.sum';summaryValue='10';contentSignature='same'}}
  $binding=[pscustomobject]@{inputEpoch=10;windowFingerprint='stable';dpi=96;clientOrigin=@(0,0)}
  $position=[pscustomobject]@{targetRow=[int]1;numberModel=@(0..1 | ForEach-Object {[pscustomobject]@{display='';edit='';flags=[int]35}});
    numberPolicy=[pscustomobject]@{tableName='/.grpEmpf13b.Empf13b';headers=@($headers.name)};geometry=[pscustomobject]@{coordinateSpace='qt-native-screen'}}
  if ($case -eq 'pending-missing-profile') {$position.numberPolicy=$null}
  $plan=[pscustomobject]@{binding=$binding;position=$position}
  $accepted=Test-SSETableCursorPhaseEditorAuthority 'native-position-prepare' ([IntPtr]111) 7 $tree $snapshot $plan
  $success=$case -in @('pending-visible','pending-transient','pending-foreign-epoch')
  if ($accepted -ne $success) {throw "Real phase editor authority mismatch: $case"}
  if ($case -eq 'pending-visible' -and (Test-SSETableCursorPhaseEditorAuthority 'native-step' ([IntPtr]111) 7 $tree $snapshot $plan)) {
    throw 'Known editor preparation was improperly extended to ordinary cursor phases.'
  }
  $script:freshSourceTree=$tree
  $readClosed={
    $script:keyboardCells=@($row)
    $script:closedTree=$tree.PSObject.Copy();$script:closedTree.nodes=@($tree.nodes | Where-Object {$_.type -cne 'Edit'})
    $copy=$snapshot.PSObject.Copy();$copy.navigationBinding=$snapshot.navigationBinding.PSObject.Copy();$copy.navigationBinding.editorFree=$true;$copy
  }
  if ($case -eq 'pending-foreign-epoch') {$script:tick=11}
  $prepared=Invoke-SSETableNativePositionPreparation ([IntPtr]111) 7 $tree $snapshot $position $binding $readClosed {$script:closedTree} {Test-SSELastInputUnchanged 10}
  $closed=$case -in @('pending-visible','pending-transient')
  if ($prepared.ok -ne $closed -or $script:focusCalls -ne [int]$closed) {throw "Exact visible/transient Nr. closure or zero-focus rejection mismatch: $case $($prepared.reason)"}
}
$positionProfile=(Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\profiles\2025\page-objects.json') -Raw | ConvertFrom-Json).tablePositionNameFocusSource
foreach($case in @('position-name-success','position-name-late','position-name-live-value','position-name-readonly',
  'position-name-wrong-heading','position-name-wrong-table','position-name-wrong-prefix','position-name-duplicate',
  'position-name-active-editor','position-name-no-profile','position-name-wrong-profile','position-name-wrong-header',
  'position-name-foreign-pid','position-name-foreign-window','position-name-no-authority')) {
  $script:mode=$case;$script:focusCalls=0;$script:tick=10;$script:sourceSnapshotReads=0
  $script:positionHeading='Einnahmen: Synthetic commissions';$script:positionPolicy=$positionProfile.PSObject.Copy()
  $tableNode=$tableNode.PSObject.Copy();$tableNode.aid='Synthetic'+$positionProfile.tableAutomationIdSuffix
  $positionTableAid=$tableNode.aid
  $script:table=New-Element $tableNode;$script:table.parent=$root
  $script:button=New-Element $buttonNode;$script:button.parent=$root
  $source=[pscustomobject]@{i=20;p=-1;rid='42.777.4.-200';aid='Synthetic'+$positionProfile.automationIdSuffix;
    type='Edit';name='Position';on=$true;x=100;y=40;w=300;h=24;val='Synthetic commissions';ro=$false}
  $script:positionSource=New-Element $source;$script:positionSource.parent=$root
  $script:positionSource.valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value=$source.val;IsReadOnly=$false}}
  $headers=@(for($column=0;$column -lt 6;$column++) {[pscustomobject]@{i=30+$column;p=$tableNode.i;rid="42.777.4.-$($column+210)";
    aid=$positionTableAid;type='Header';name=$positionProfile.headers[$column];on=$true;x=100+90*$column;y=80;w=90;h=24}})
  $rowHeader=[pscustomobject]@{i=40;p=$tableNode.i;rid='42.777.4.-250';aid=$positionTableAid;type='Header';name='';on=$true;x=99;y=104;w=2;h=24}
  $tree=[pscustomobject]@{nodes=@($tableNode,$buttonNode,$source)+$headers+@($rowHeader);stats=$stats}
  switch($case) {
    'position-name-live-value' {$script:positionSource.valuePattern.Current.Value='Uncommitted change'}
    'position-name-readonly' {$source.ro=$true;$script:positionSource.valuePattern.Current.IsReadOnly=$true}
    'position-name-wrong-heading' {$script:positionHeading='Other page: Synthetic commissions'}
    'position-name-wrong-table' {$positionTableAid+='Other';$tableNode.aid=$positionTableAid;$script:table.Current.AutomationId=$positionTableAid}
    'position-name-wrong-prefix' {$source.aid='Other'+$positionProfile.automationIdSuffix;$script:positionSource.Current.AutomationId=$source.aid}
    'position-name-duplicate' {$duplicate=$source.PSObject.Copy();$duplicate.rid='42.777.4.-300';$tree.nodes+=@($duplicate)}
    'position-name-active-editor' {$active=$editorNode.PSObject.Copy();$active.aid=$positionTableAid+'.(1).Betrag';$tree.nodes+=@($active)}
    'position-name-no-profile' {$script:positionPolicy=$null}
    'position-name-wrong-profile' {$script:positionPolicy.policy='allow-any-edit'}
    'position-name-wrong-header' {$headers[0].name='Other column'}
    'position-name-foreign-pid' {$script:positionSource.Current.ProcessId=8}
    'position-name-foreign-window' {$script:positionSource.parent=[pscustomobject]@{Current=[pscustomobject]@{
      ProcessId=7;ControlType=[System.Windows.Automation.ControlType]::Window;NativeWindowHandle=222}}}
  }
  $script:freshSourceTree=$tree;$AE::FocusedElement=$script:positionSource
  $result=Invoke-SSETableFooterFocus ([IntPtr]111) 7 $tree $positionTableAid $tableNode.rid $script:positionHeading 10 'stable' $null `
    -AllowPositionNameSource:($case -cne 'position-name-no-authority')
  if($result.ok -ne ($case -ceq 'position-name-success')) {throw "$case`: exact unchanged position-name proof mismatch: $($result.reason)"}
  if($script:focusCalls -ne [int]($case -ceq 'position-name-success')) {throw "$case`: unproven source caused focus or replay."}
  if($case -ceq 'position-name-late' -and $result.reason -cne 'footer-position-name-value-changed') {throw 'Late position-name change was not caught before focus.'}
}
$script:positionHeading=$null;$script:positionPolicy=$null
Write-Output 'table-footer-focus-contract: PASS (pure synthetic focus-only/owned-delegate/no-retry/precise-failure-proof)'
