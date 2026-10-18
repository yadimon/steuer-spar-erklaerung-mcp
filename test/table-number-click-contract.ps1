$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-combobox.ps1')
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
. (Join-Path $PSScriptRoot '..\powershell\table-number-click.ps1')
function Assert-True([bool]$Condition,[string]$Message) {if (-not $Condition) {throw $Message}}
Add-Type -TypeDefinition @'
using System;
public sealed class SyntheticVisibleNode {public int i,p,x,y,w,h;public string rid,aid,type,name,val;public bool on;}
namespace System.Windows {public struct Point {public double X,Y;public Point(double x,double y){X=x;Y=y;}}}
public static class SW {
 public static int ProcessId=7,Dpi=96,DoubleClickMs=100;
 public static IntPtr Foreground=new IntPtr(111);
 public static int[] Origin=new int[]{0,0};
 public static IntPtr GetForegroundWindow(){return Foreground;}
 public static uint GetWindowThreadProcessId(IntPtr hwnd,ref int processId){processId=ProcessId;return 1;}
 public static uint GetDpiForWindow(IntPtr hwnd){return (uint)Dpi;}
 public static int[] GetPhysicalClientOrigin(IntPtr hwnd){return Origin;}
 public static uint GetDoubleClickTime(){return (uint)DoubleClickMs;}
}
namespace System.Windows.Automation {
 public sealed class ControlType {
  public string ProgrammaticName;private ControlType(string name){ProgrammaticName="ControlType."+name;}
  public static readonly ControlType Table=new ControlType("Table"),DataGrid=new ControlType("DataGrid"),DataItem=new ControlType("DataItem"),
   Header=new ControlType("Header"),Edit=new ControlType("Edit"),ComboBox=new ControlType("ComboBox"),Custom=new ControlType("Custom"),
   Document=new ControlType("Document"),Window=new ControlType("Window"),Button=new ControlType("Button"),Tree=new ControlType("Tree"),TreeItem=new ControlType("TreeItem");
 }
 public static class GridItemPattern {public static object Pattern="grid";}
 public static class SelectionItemPattern {public static object Pattern="item";}
 public static class SelectionPattern {public static object Pattern="selection";}
 public static class TogglePattern {public static object Pattern="toggle";}
 public static class ExpandCollapsePattern {public static object Pattern="expand";}
 public static class TextPattern {public static object Pattern="text";}
 public static class ValuePattern {public static object Pattern="value";}
 public static class AutomationElement {
  public static object FocusedElement,PointResult;
  public static int PointCalls;
  public static Func<System.Windows.Point,object> Hit;
  public static object FromPoint(System.Windows.Point point){PointCalls++;return Hit!=null?Hit(point):PointResult;}
 }
}
'@
$AE=[System.Windows.Automation.AutomationElement]
$tableAid='Synthetic.Table./.Tab'
function New-Element($Node,[string]$Type) {
  $controlType=[System.Windows.Automation.ControlType]::Table.GetType().GetField($Type).GetValue($null)
  $element=[pscustomobject]@{rid=$Node.rid;parent=$null;patterns=@{};Current=[pscustomobject]@{
    ProcessId=7;AutomationId=$Node.aid;ControlType=$controlType;Name=[string]$Node.name;IsEnabled=$true;IsOffscreen=$false;HasKeyboardFocus=$false
    NativeWindowHandle=0
    BoundingRectangle=[pscustomobject]@{X=$Node.x;Y=$Node.y;Width=$Node.w;Height=$Node.h}
  }}
  $element | Add-Member ScriptMethod GetRuntimeId { $this.rid -split '\.' }
  $element | Add-Member ScriptMethod TryGetCurrentPattern {param($Pattern,$Result)
    if ($Pattern -ceq 'text' -and $script:mode -ceq 'help-pattern-throws') {throw 'Synthetic unavailable text pattern'}
    if ($this.patterns.ContainsKey([string]$Pattern)) {$Result.Value=$this.patterns[[string]$Pattern];return $true}
    $false
  }
  $element | Add-Member ScriptMethod SetFocus {$script:focusCalls++;throw 'No SetFocus is allowed in number-cell activation.'}
  $element
}
function Get-SSETableReadUncachedElement {
  param($Hwnd,$ProcessId,$Rid,$Aid,$ExpectedType)
  $script:resolverCalls++
  if ($Rid -ceq $script:table.rid) {return [pscustomobject]@{ok=$true;element=$script:table}}
  if ($Rid -ceq $script:cell.rid) {return [pscustomobject]@{ok=$true;element=$script:cell}}
  if ($script:priorElements -and $script:priorElements.ContainsKey($Rid)) {return [pscustomobject]@{ok=$true;element=$script:priorElements[$Rid]}}
  throw 'Unexpected fresh element target.'
}
function Get-LiveElement { $script:header }
function Test-SSETableFocusedSource {
  param($Hwnd,$ProcessId,$Tree,$TableAid,$TableRid,$OwnedCell,$ExpectedSource,[ref]$PositionNameProof,[switch]$AllowPositionNameSource)
  $script:sourceProofCalls++
  if (-not $AllowPositionNameSource -or $Hwnd -ne [IntPtr]111 -or $ProcessId -ne 7 -or
      $TableAid -cne $script:tableAid -or $TableRid -cne '1.1' -or $script:mode -ceq 'source-unbound' -or
      $AE::FocusedElement -ne $script:source -or $script:sourceValue.Current.Value -cne 'Synthetic position') {return $false}
  if ($ExpectedSource -and ($ExpectedSource.rid -cne $script:source.rid -or $ExpectedSource.aid -cne $script:source.Current.AutomationId)) {return $false}
  $PositionNameProof.Value=[pscustomobject]@{valuePattern=$script:sourceValue;expectedValue='Synthetic position'}
  $true
}
function Get-SSETableNumberAnchorFocusProof {
  param($Hwnd,$ProcessId,$Tree,$TableAid,$TableRid,$Anchor,$Focused,$NumberModel,$NumberPolicy)
  $script:numberProofCalls++
  Assert-True ($null -eq $NumberModel -and $Anchor.rid -ceq $script:expectedClickRid -and $Tree.nodes.Count -ge 4 -and $NumberPolicy.tableName -ceq '/.Tab') 'Number click fabricated native flags, reused post-editor tree or changed clicked-cell authority.'
  if ($script:mode -cin @('other-row-editor','changed-editor','custom-editor','combo-editor','source-still-focused')) {return [pscustomobject]@{ok=$false}}
  [pscustomobject]@{ok=$true;ownedCell=$script:cellNode;row=[int]$script:cell.patterns.grid.Current.Row;valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value=[string]$script:cellNode.name}};expectedValue=[string]$script:cellNode.name}
}
function Get-SSETableLiveInputState {
  param($Hwnd,$ProcessId,$Aid,$Rid,[switch]$RequireKeyboard,[switch]$RequireSelection)
  Assert-True ($RequireKeyboard -and $RequireSelection) 'Final activation needs keyboard and selection together.'
  $ok=($script:editorClosed -and $AE::FocusedElement -eq $script:cell)
  [pscustomobject]@{ok=$ok;selectedRids=@($script:selection.items | ForEach-Object {$_.GetRuntimeId() -join '.'})}
}
function Get-SSELastInputTick {$script:tick}
function Test-SSELastInputUnchanged($Expected) {$null -ne $script:tick -and $Expected -eq $script:tick}
function Get-DirtyStateFast {$script:dirty}
function Get-SSEInteractionWindowSet {[pscustomobject]@{fingerprint=$script:windowFingerprint}}
function Get-SSEPointObstruction {
  param($Hwnd,$X,$Y)
  [pscustomobject]@{isBoundTarget=($script:mode -cne 'obstructed')}
}
function Start-Sleep {param([int]$Milliseconds) $script:waits+=@($Milliseconds)}
function Click-VerifiedPoint {
  param($Hwnd,$Node,$ExpectedInputTick,[switch]$RequireForeground,[int]$ForegroundAttempts,[string]$ExpectedRuntimeId,[scriptblock]$BeforeClickCheck,$BeforeClickBinding,[switch]$ThrowOnFailure)
  $script:clickHelperCalls++
  Assert-True ($Hwnd -eq [IntPtr]111 -and $Node.rid -ceq $script:expectedClickRid -and $RequireForeground -and
    $ForegroundAttempts -eq 1 -and $ExpectedRuntimeId -ceq $script:expectedClickRid -and $null -ne $BeforeClickBinding -and $ThrowOnFailure) 'Click lost exact cell/foreground/one-attempt or throwing-result authority.'
  if ($script:mode -ceq 'foreground-at-last-hook') {[SW]::Foreground=[IntPtr]999}
  if ($script:mode -ceq 'selection-at-last-hook') {$script:selection.items=@($script:cell)}
  if ($script:mode -ceq 'help-source-at-last-hook') {$AE::FocusedElement=$script:editor}
  if ($script:mode -ceq 'passive-source-late') {$AE::FocusedElement=$script:editor}
  if ($script:mode -ceq 'passive-selection-late-empty') {$script:selection.items=@()}
  if ($script:mode -ceq 'passive-selection-late-added') {$script:selection.items=@($script:cell);$script:item.Current.IsSelected=$true}
  if ($script:mode -ceq 'passive-selection-late-metadata') {$script:priorElements['1.5'].Current.Name='Changed selected value'}
  if ($script:mode -ceq 'passive-selection-late-set') {$script:selection.items=@($script:priorElements['1.5'],$script:priorElements['1.7'])}
  if ($script:mode -ceq 'passive-selection-order') {[array]::Reverse($script:selection.items)}
  if ($script:mode -ceq 'visible-earlier-at-last-hook') {$script:priorElements['1.9'].Current.BoundingRectangle.Y=145;$script:tree.nodes[-1].y=145}
  if ($script:mode -ceq 'visible-row-at-last-hook') {$script:priorElements['1.5'].patterns.grid.Current.Row=[int]2}
  if ($script:mode -ceq 'visible-bounds-at-last-hook') {$script:priorElements['1.5'].Current.BoundingRectangle.Width=39}
  if ($script:mode -ceq 'visible-header-at-last-hook') {$script:headerNode.h=90;$script:header.Current.BoundingRectangle.Height=90}
  if ($script:mode -ceq 'visible-same-center-resize') {$script:tree.nodes[5].y=171;$script:tree.nodes[5].h=28;$script:priorElements['1.5'].Current.BoundingRectangle.Y=171;$script:priorElements['1.5'].Current.BoundingRectangle.Height=28}
  if ($script:mode -ceq 'visible-inplace-name') {$script:tree.nodes[5].name='2';$script:tree.nodes[5].val='2';$script:priorElements['1.5'].Current.Name='2';$script:snapshot.zeilenMitIdentitaet[0].werte[0]='2';$script:snapshot.zeilenMitIdentitaet[0].semanticCells[0].value='2'}
  if (-not (& $BeforeClickCheck $Hwnd $BeforeClickBinding 120 $script:expectedClickY)) {throw 'Synthetic last click guard rejected.'}
  $script:cell=$BeforeClickBinding.proof.element;$script:cellNode=$BeforeClickBinding.proof.node;$script:item=$script:cell.patterns.item
  $script:clicks++
  $script:tick=([long][Environment]::TickCount -band 4294967295L)
  $script:selection.items=@($script:cell);$script:item.Current.IsSelected=$true
  if ($script:mode -cin @('whole-row','different-selected-row','duplicate-selected-column')) {$script:selection.items+=@($script:secondCell)}
  $script:cell.Current.HasKeyboardFocus=$true
  $script:editorClosed=$true;$AE::FocusedElement=$script:cell;$script:table.Current.HasKeyboardFocus=$true
  if ($script:mode -cin @('number-editor','visible-number-editor','editor-stays','table-unfocused-after-escape','other-row-editor','changed-editor','custom-editor','combo-editor')) {
    $script:editorClosed=$false;$AE::FocusedElement=$script:editor;$script:table.Current.HasKeyboardFocus=$false
  }
  if ($script:mode -ceq 'source-still-focused') {$AE::FocusedElement=$script:source;$script:table.Current.HasKeyboardFocus=$false}
  if ($script:mode -ceq 'table-unfocused') {$script:table.Current.HasKeyboardFocus=$false}
  if ($script:mode -ceq 'source-after-click') {$script:sourceValue.Current.Value='Changed position'}
  if ($script:mode -cin @('help-rematerialized-after-click','passive-rematerialized-after-click')) {$script:source.rid='2.9';$script:source.Current.IsEnabled=$false}
  if ($script:mode -ceq 'dirty-after-click') {$script:dirty=$true}
  if ($script:mode -ceq 'window-after-click') {$script:windowFingerprint='changed'}
  if ($script:mode -ceq 'dpi-after-click') {[SW]::Dpi=144}
  if ($script:mode -ceq 'origin-after-click') {[SW]::Origin=[int[]]@(5,5)}
  if ($script:mode -ceq 'click-result-lost') {throw 'Synthetic lost result after click.'}
  [pscustomobject]@{clickCount=1;inputTickAfterClick=$script:tick}
}
function Reset-Scenario {
  $script:mode='';$script:clicks=0;$script:clickHelperCalls=0;$script:escapes=0;$script:focusCalls=0;$script:selectCalls=0
  $script:sourceProofCalls=0;$script:numberProofCalls=0;$script:resolverCalls=0;$script:reads=0;$script:waits=@();$script:records=0
  $script:dirty=$false;$script:windowFingerprint='stable';$script:editorClosed=$true
  $script:priorElements=@{}
  $script:expectedClickRid='1.3';$script:expectedClickY=140
  $script:tick=(([long][Environment]::TickCount -band 4294967295L)+4294966296L)%4294967296L
  [SW]::ProcessId=7;[SW]::Dpi=96;[SW]::DoubleClickMs=100;[SW]::Foreground=[IntPtr]111;[SW]::Origin=[int[]]@(0,0)
  $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false
  $AE::PointCalls=0;$AE::Hit=$null
  $script:tableNode=[pscustomobject]@{i=0;p=-1;rid='1.1';aid=$tableAid;type='Table';on=$true;x=100;y=100;w=400;h=200}
  $script:headerNode=[pscustomobject]@{i=1;p=0;rid='1.2';aid=$tableAid+'.Header';type='Header';name='Nr.';on=$true;x=100;y=100;w=40;h=25}
  $script:cellNode=[pscustomobject]@{i=2;p=0;rid='1.3';aid=$tableAid;type='DataItem';name='1';val='1';on=$true;x=100;y=125;w=40;h=30}
  $secondHeader=[pscustomobject]@{i=3;p=0;rid='1.4';aid=$tableAid+'.Header2';type='Header';name='Datum';on=$true;x=140;y=100;w=100;h=25}
  $script:tree=[pscustomobject]@{stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0};nodes=@($script:tableNode,$script:headerNode,$script:cellNode,$secondHeader)}
  $script:snapshot=[pscustomobject]@{kopf=@('Nr.','Datum');cursorAnchorIsNumber=$true;ersteZelle=$script:cellNode;tabelleAnzahl=1;
    navigationBinding=[pscustomobject]@{complete=$true;editorFree=$true;heading='Synthetic table';tableIdentity='headers';tableRootAid=$tableAid;tableRootRid='1.1';
      scopePrefix='own';selectionMethod='sum';summaryIdentity='sum';summaryValue='15,00';contentSignature='same'}}
  $script:table=New-Element $script:tableNode 'Table';$script:cell=New-Element $script:cellNode 'DataItem';$script:header=New-Element $script:headerNode 'Header'
  $script:source=New-Element ([pscustomobject]@{rid='2.1';aid='Synthetic.PositionName';name='';x=100;y=50;w=150;h=20}) 'Edit'
  $script:source.Current.HasKeyboardFocus=$true
  $script:sourceValue=[pscustomobject]@{Current=[pscustomobject]@{Value='Synthetic position'}}
  $script:editor=New-Element ([pscustomobject]@{rid='3.1';aid=$tableAid+'.qt_scrollarea_viewport./.Tab.(1).BelegNr';name='';x=100;y=125;w=40;h=30}) 'Edit'
  $script:editor.Current.HasKeyboardFocus=$true
  $script:selection=[pscustomobject]@{items=@()}
  $script:selection | Add-Member ScriptMethod GetSelection { @($this.items) }
  $script:table.patterns.selection=[pscustomobject]@{Current=$script:selection}
  $script:item=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$false;SelectionContainer=$script:table}}
  $script:item | Add-Member ScriptMethod Select {$script:selectCalls++;throw 'No Select is allowed in number-cell activation.'}
  $script:cell.patterns.item=$script:item
  $script:cell.patterns.grid=[pscustomobject]@{Current=[pscustomobject]@{Row=0;Column=0;RowSpan=1;ColumnSpan=1;ContainingGrid=$script:table}}
  $AE::FocusedElement=$script:source;$AE::PointResult=$script:cell
  $script:callbacks=@{
    Guard={param($Phase)
      if ($script:mode -ceq 'guard-failed') {return $false}
      if ($script:mode -ceq 'input-before-submit' -and $Phase -ceq 'number-cell-route-selected') {$script:tick++;return $false}
      $true
    }
    ReadSnapshot={
      $script:reads++
      if ($script:mode -ceq 'provider-after-click' -and $script:clicks) {throw 'Synthetic unavailable after click'}
      $read=$script:snapshot | ConvertTo-Json -Depth 10 -Compress | ConvertFrom-Json
      if ($script:mode -ceq 'visible-original-rid-at-last-hook' -and $script:clickHelperCalls -gt 0) {
        $read.ersteZelle.rid='1.30';$replacement=$script:tree.nodes[2].PSObject.Copy();$replacement.rid='1.30';$script:tree.nodes[2]=$replacement
      }
      if ($script:mode -ceq 'values-after-click' -and $script:clicks) {$read.navigationBinding.contentSignature='changed'}
      if ($script:mode -ceq 'page-after-click' -and $script:clicks) {$read.navigationBinding.heading='Other page'}
      $read.navigationBinding.editorFree=$script:editorClosed
      $read
    }
    ReadTree={$script:tree}
    RecordInput={param($Tick,$Point) $script:records++;Assert-True ($Tick -eq $script:tick -and $Point.rid -ceq $script:expectedClickRid) 'Owned input checkpoint changed target.'}
    SendEscape={
      $script:escapes++;$script:tick=($script:tick+1)%4294967296L
      if ($script:mode -cne 'editor-stays') {$script:editorClosed=$true;$AE::FocusedElement=$script:cell;$script:table.Current.HasKeyboardFocus=$true}
      if ($script:mode -ceq 'table-unfocused-after-escape') {$script:table.Current.HasKeyboardFocus=$false}
    }
  }
}
function Invoke-Scenario([string]$Name,[bool]$ExpectedOk,[int]$Clicks,[int]$Escapes,[bool]$Unknown=$false) {
  $result=Invoke-SSETableReadNumberCellClick ([IntPtr]111) 7 $script:snapshot $script:tree $script:callbacks
  Assert-True ($result.ok -eq $ExpectedOk -and $script:clicks -eq $Clicks -and $script:escapes -eq $Escapes) "$Name : $($result | ConvertTo-Json -Depth 8 -Compress); clicks=$script:clicks escape=$script:escapes."
  Assert-True ($result.outcomeUnknown -eq $Unknown -and $result.reconciliationRequired -eq $Unknown -and
    $result.retryable -is [bool] -and -not $result.retryable -and $script:focusCalls -eq 0 -and $script:selectCalls -eq 0) "$Name : retry, focus or selection escaped the single route."
  if ($ExpectedOk) {Assert-True (-not $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS -and $result.physicalInputUsed -and $result.activationSubmitted) "$Name lost verified physical activation."}
  if ($Unknown) {Assert-True ($script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS -and $result.activationSubmitted) "$Name lost terminal preservation."}
  Assert-True ($result.physicalInputAttempted -eq ($script:clickHelperCalls -gt 0)) "$Name misreported whether physical input was attempted."
  if ($script:clickHelperCalls -eq 0) {Assert-True ($result.physicalInputUsed -is [bool] -and -not $result.physicalInputUsed) "$Name claimed physical input before submission."}
  if ($script:mode -cin @('foreground-at-last-hook','selection-at-last-hook','click-result-lost')) {
    Assert-True ($null -eq $result.physicalInputUsed) "$Name claimed actual input despite losing the helper result."
  }
  if ($script:clicks -eq 1 -and $script:mode -cne 'click-result-lost') {
    Assert-True ($result.physicalInputUsed -is [bool] -and $result.physicalInputUsed) "$Name lost its acknowledged physical click."
  }
  $result
}

Assert-True (Test-SSETableNumberClickInterval 4294967200L 200 100) '32-bit wrapped input age rejected.'
Assert-True (-not (Test-SSETableNumberClickInterval 100 200 100)) 'Double-click boundary was accepted.'
Assert-True (-not (Test-SSETableNumberClickInterval 100 100 100)) 'Recent input was accepted.'
Assert-True (-not (Test-SSETableNumberClickInterval $null 100 100)) 'Unknown input age was accepted.'
Assert-True (-not (Test-SSETableNumberClickInterval 1 10000 0)) 'Unknown double-click setting was accepted.'
Reset-Scenario
$null=Invoke-Scenario 'Exact cell single click' $true 1 0
Assert-True ($AE::PointCalls -eq 10 -and $script:waits.Count -eq 1 -and $script:waits[0] -eq 200 -and $script:records -eq 1) 'Surface proof or bounded settled readback was omitted.'
Reset-Scenario
$script:cellNode.w=39;$script:cell.Current.BoundingRectangle.Width=39
$null=Invoke-Scenario 'Exact cell narrower than its containing number header' $true 1 0
Assert-True ($AE::PointCalls -eq 10 -and $script:clickHelperCalls -eq 1) 'Narrower number cell bypassed full direct surface proof or selected another route.'
Reset-Scenario
$script:mode='number-editor'
$null=Invoke-Scenario 'Exact clicked-row unchanged number editor gets one Escape' $true 1 1
Assert-True ($script:numberProofCalls -eq 1 -and $script:waits.Count -eq 2 -and $script:records -eq 2) 'Owned editor was not handled exactly once.'
Reset-Scenario
$script:mode='whole-row'
$secondNode=[pscustomobject]@{i=4;p=0;rid='1.5';aid=$tableAid;type='DataItem';name='01.01';on=$true;x=140;y=125;w=100;h=30}
$script:tree.nodes+=@($secondNode)
$script:secondCell=New-Element $secondNode 'DataItem'
$script:secondCell.patterns.grid=[pscustomobject]@{Current=[pscustomobject]@{Row=0;Column=1;RowSpan=1;ColumnSpan=1;ContainingGrid=$script:table}}
$null=Invoke-Scenario 'Whole selected row is freshly bound to same model row' $true 1 0
Reset-Scenario
$script:mode='whole-row'
$secondNode=[pscustomobject]@{i=4;p=0;rid='1.5';aid=$tableAid;type='DataItem';name='01.01';on=$true;x=140;y=125;w=100;h=30}
$script:tree.nodes+=@($secondNode);$script:secondCell=New-Element $secondNode 'DataItem'
$script:secondCell.patterns.grid=[pscustomobject]@{Current=[pscustomobject]@{Row=0;Column=6;RowSpan=1;ColumnSpan=1;ContainingGrid=$script:table}}
$null=Invoke-Scenario 'Hidden raw columns do not renumber visible selected cells' $true 1 0
foreach ($selectionMode in @('different-selected-row','duplicate-selected-column')) {
  Reset-Scenario;$script:mode=$selectionMode
  $secondNode=[pscustomobject]@{i=4;p=0;rid='1.5';aid=$tableAid;type='DataItem';name='01.01';on=$true;x=140;y=125;w=100;h=30}
  $script:tree.nodes+=@($secondNode);$script:secondCell=New-Element $secondNode 'DataItem'
  $script:secondCell.patterns.grid=[pscustomobject]@{Current=[pscustomobject]@{Row=0;Column=1;RowSpan=1;ColumnSpan=1;ContainingGrid=$script:table}}
  if ($selectionMode -ceq 'different-selected-row') {$script:secondCell.patterns.grid.Current.Row=1}
  if ($selectionMode -ceq 'duplicate-selected-column') {$script:secondCell.patterns.grid.Current.Column=0}
  $null=Invoke-Scenario $selectionMode $false 1 0 $true
}

foreach ($scenario in @(
  @{name='unprofiled source';setup={$script:mode='source-unbound'}},
  @{name='changed source';setup={$script:sourceValue.Current.Value='Changed position'}},
  @{name='existing cursor';setup={$AE::FocusedElement=$script:cell;$script:selection.items=@($script:cell);$script:item.Current.IsSelected=$true}},
  @{name='existing number editor';setup={$AE::FocusedElement=$script:editor}},
  @{name='already selected target';setup={$script:item.Current.IsSelected=$true}},
  @{name='another selection';setup={$script:selection.items=@($script:cell)}},
  @{name='clipped top cell';setup={$script:cellNode.y=124}},
  @{name='clipped bottom cell';setup={$script:cellNode.h=200}},
  @{name='cell overflows number header';setup={$script:cellNode.w=41;$script:cell.Current.BoundingRectangle.Width=41}},
  @{name='narrower cell shifted from exact header start';setup={$script:cellNode.w=39;$script:cell.Current.BoundingRectangle.Width=39;$script:cellNode.x=101;$script:cell.Current.BoundingRectangle.X=101}},
  @{name='narrower cell clipped at top';setup={$script:cellNode.w=39;$script:cell.Current.BoundingRectangle.Width=39;$script:cellNode.y=124;$script:cell.Current.BoundingRectangle.Y=124}},
  @{name='narrower cell corner clipped';setup={$script:cellNode.w=39;$script:cell.Current.BoundingRectangle.Width=39;$AE::Hit={param($Point) if($Point.X -eq 138 -and $Point.Y -eq 154){return $script:header};$script:cell}}},
  @{name='wrong column';setup={$script:cell.patterns.grid.Current.Column=1}},
  @{name='spanned cell';setup={$script:cell.patterns.grid.Current.RowSpan=2}},
  @{name='wrong current name';setup={$script:cell.Current.Name='2'}},
  @{name='wrong current RID';setup={$script:cell.rid='9.9'}},
  @{name='wrong current PID';setup={$script:cell.Current.ProcessId=8}},
  @{name='wrong current AID';setup={$script:cell.Current.AutomationId='Other.Table'}},
  @{name='different current bounds';setup={$script:cell.Current.BoundingRectangle.Width=41}},
  @{name='toggle-capable number';setup={$script:cell.patterns.toggle=[pscustomobject]@{}}},
  @{name='expand-capable number';setup={$script:cell.patterns.expand=[pscustomobject]@{}}},
  @{name='different containing grid';setup={$other=$script:table.PSObject.Copy();$other.rid='9.9';$script:cell.patterns.grid.Current.ContainingGrid=$other}},
  @{name='hit is table';setup={$AE::PointResult=$script:table}},
  @{name='hit is header';setup={$AE::PointResult=$script:header}},
  @{name='hit is editor';setup={$AE::PointResult=$script:editor}},
  @{name='one corner clipped';setup={$AE::Hit={param($Point) if($Point.X -eq 100 -and $Point.Y -eq 125){return $script:header};$script:cell}}},
  @{name='obstructed point';setup={$script:mode='obstructed'}},
  @{name='recent input';setup={$script:tick=([long][Environment]::TickCount -band 4294967295L)}},
  @{name='unknown interval';setup={[SW]::DoubleClickMs=0}},
  @{name='unknown dirty';setup={$script:dirty=$null}},
  @{name='foreign foreground';setup={[SW]::Foreground=[IntPtr]999}},
  @{name='guard failed';setup={$script:mode='guard-failed'}},
  @{name='input before submission';setup={$script:mode='input-before-submit'}}
)) {
  Reset-Scenario
  & $scenario.setup
  $null=Invoke-Scenario $scenario.name $false 0 0
  Assert-True ($script:clickHelperCalls -eq 0) "$($scenario.name) moved the pointer before satisfying preconditions."
}

foreach ($scenarioMode in @('foreground-at-last-hook','selection-at-last-hook')) {
  Reset-Scenario;$script:mode=$scenarioMode
  $null=Invoke-Scenario $scenarioMode $false 0 0 $true
  Assert-True ($script:clickHelperCalls -eq 1) 'Rejected physical submission tried another route.'
}
foreach ($scenarioMode in @('other-row-editor','changed-editor','custom-editor','combo-editor','source-still-focused','table-unfocused',
  'source-after-click','dirty-after-click','window-after-click','dpi-after-click','origin-after-click','click-result-lost','values-after-click','page-after-click','provider-after-click')) {
  Reset-Scenario;$script:mode=$scenarioMode
  $null=Invoke-Scenario $scenarioMode $false 1 0 $true
  Assert-True ($script:clickHelperCalls -eq 1) "$scenarioMode dispatched a second physical route."
}
foreach ($scenarioMode in @('editor-stays','table-unfocused-after-escape')) {
  Reset-Scenario;$script:mode=$scenarioMode
  $null=Invoke-Scenario $scenarioMode $false 1 1 $true
  Assert-True ($script:clickHelperCalls -eq 1 -and $script:numberProofCalls -eq 1) "$scenarioMode retried click or Escape."
}
Write-Output 'Number-cell activation: exact profiled source, unselected fresh Grid cell, full direct surface, wrap-safe input age, one click/optional one proven Escape and actual table focus verified.'

# The accepted Help source uses the actual production module and the actual
# worker source proof. Only provider boundaries are synthetic; no successful
# source/identity/version classifier is replaced by a test double.
$workerSource=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$workerErrors=$null;$workerAst=[Management.Automation.Language.Parser]::ParseInput($workerSource,[ref]$null,[ref]$workerErrors)
if ($workerErrors.Count) {throw 'Worker source must parse.'}
$definition=@($workerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-SSETableFocusedSource'},$true))
if ($definition.Count -ne 1) {throw 'The actual worker source proof must be unique.'}
. ([scriptblock]::Create($definition[0].Extent.Text))
$RAW=[pscustomobject]@{};$RAW | Add-Member ScriptMethod GetParent {param($Element) $Element.parent}
$WLK=$RAW
function Get-CurrentHeading {$script:snapshot.navigationBinding.heading}
function Get-SSEPageObjects {[pscustomobject]@{tableHelpDocumentFocusSource=$script:helpPolicy}}
function Get-SSETableNumberClickProviderModules {
  param([int]$ProcessId)
  Assert-True ($ProcessId -eq 7) 'Provider discovery escaped the bound process.'
  $script:providerReads++
  if ($script:mode -ceq 'help-provider-throws') {throw 'Synthetic inaccessible modules'}
  $records=@('Qt6Core.dll','Qt6WebEngineCore.dll','qwindows.dll' | ForEach-Object {
    [pscustomobject]@{name=$_;major=[int]6;minor=[int]9;build=[int]2;revision=[int]0}
  })
  if ($script:mode -ceq 'help-provider-unknown' -or ($script:mode -ceq 'help-provider-late' -and $script:providerReads -gt 1)) {$records[2].build=[int]3}
  if ($script:mode -ceq 'help-provider-missing') {$records=@($records[0],$records[1])}
  if ($script:mode -ceq 'help-provider-duplicate') {$records+=@($records[2])}
  if ($script:mode -ceq 'help-provider-untyped') {$records[2].major='6'}
  $records
}
$validProviderRecords=@('QT6CORE.DLL','qt6webenginecore.dll','QWINDOWS.DLL' | ForEach-Object {
  [pscustomobject]@{name=$_;major=[int]6;minor=[int]9;build=[int]2;revision=[int]0}
})
Assert-True (Test-SSETableNumberClickProviderVersion $validProviderRecords '6.9.2') 'Windows module-name case changed the exact provider version proof.'
Assert-True (-not (Test-SSETableNumberClickProviderVersion $validProviderRecords '6.9.20')) 'A version prefix was treated as an exact supported version.'
$duplicateProvider=@($validProviderRecords)+@($validProviderRecords[0].PSObject.Copy());$duplicateProvider[3].name='Qt6Core.dll'
Assert-True (-not (Test-SSETableNumberClickProviderVersion $duplicateProvider '6.9.2')) 'A differently cased duplicate loaded module was accepted.'
$revisionProvider=@($validProviderRecords | ForEach-Object {$_.PSObject.Copy()});$revisionProvider[0].revision=[int]1
Assert-True (-not (Test-SSETableNumberClickProviderVersion $revisionProvider '6.9.2')) 'A different provider revision was accepted.'
$buildProvider=@($validProviderRecords | ForEach-Object {$_.PSObject.Copy()});$buildProvider[0].build=[int]20
Assert-True (-not (Test-SSETableNumberClickProviderVersion $buildProvider '6.9.2')) 'A numeric build prefix was accepted.'
$unknownProvider=@($validProviderRecords | ForEach-Object {$_.PSObject.Copy()});$unknownProvider[0].revision=$null
Assert-True (-not (Test-SSETableNumberClickProviderVersion $unknownProvider '6.9.2')) 'An unknown provider revision was accepted.'
$untypedProvider=@($validProviderRecords | ForEach-Object {$_.PSObject.Copy()});$untypedProvider[0].revision='0'
Assert-True (-not (Test-SSETableNumberClickProviderVersion $untypedProvider '6.9.2')) 'A string provider revision was coerced into proof.'
foreach ($case in @('help-exact','help-rematerialized-after-click','help-no-policy','help-wrong-policy','help-provider-unknown','help-provider-missing',
  'help-provider-duplicate','help-provider-untyped','help-provider-throws','help-editable','help-pattern-throws','help-other-document',
  'help-wrong-root','help-duplicate','help-foreign-pid','help-foreign-window','help-unfocused','help-bounds',
  'help-active-table-editor','help-arbitrary-edit','help-source-at-last-hook','help-provider-late')) {
  $tableAid='Synthetic.Main.centralWidget.SearchSplitter.TopLevelHSplitter.RedThreadContent.ClientFrameSSE.DialogUI./.Bank.Tab'
  Reset-Scenario;$script:mode=$case;$script:providerReads=0
  $script:helpPolicy=[pscustomobject]@{id='library_help_document';controlType='Document';
    automationIdSuffix='.centralWidget.SearchSplitter.TopLevelHSplitter.LibraryFrameSSE.LibrarySplitterSSE.LibraryGroupWidgetSSE.QWidget.ExpandingButton.HelpWidgetSSE.HelpWidgetSSE.QObject';
    policy='passive-non-editable-help-document-only';providerQtVersion='6.9.2'}
  $sourceNode=[pscustomobject]@{i=4;p=-1;rid='2.1';aid=('Synthetic.Main'+$script:helpPolicy.automationIdSuffix);type='Document';name='';on=$true;x=600;y=100;w=150;h=200}
  $script:tree.nodes+=@($sourceNode)
  $script:source=New-Element $sourceNode 'Document';$script:source.Current.HasKeyboardFocus=$true
  # Qt offers ValuePattern even for this noneditable web root. Its false
  # IsReadOnly must neither authorize an arbitrary document nor reject the
  # separately proven, explicitly profiled noneditable Help source.
  $script:source.patterns.value=[pscustomobject]@{Current=[pscustomobject]@{Value='';IsReadOnly=$false}}
  $window=New-Element ([pscustomobject]@{rid='9.1';aid='Synthetic.Main';name='';x=0;y=0;w=900;h=700}) 'Window'
  $window.Current.NativeWindowHandle=111;$script:source.parent=$window
  $AE::FocusedElement=$script:source
  switch ($case) {
    'help-no-policy' {$script:helpPolicy=$null}
    'help-wrong-policy' {$script:helpPolicy.policy='any-document'}
    'help-editable' {$script:source.patterns.text=[pscustomobject]@{}}
    'help-other-document' {$sourceNode.aid+='Other';$script:source.Current.AutomationId=$sourceNode.aid}
    'help-wrong-root' {$window.Current.AutomationId='Another.Main'}
    'help-duplicate' {$duplicate=$sourceNode.PSObject.Copy();$duplicate.rid='2.2';$script:tree.nodes+=@($duplicate)}
    'help-foreign-pid' {$script:source.Current.ProcessId=8}
    'help-foreign-window' {$window.Current.NativeWindowHandle=222}
    'help-unfocused' {$script:source.Current.HasKeyboardFocus=$false}
    'help-bounds' {$script:source.Current.BoundingRectangle.Width=149}
    'help-active-table-editor' {$active=$script:cellNode.PSObject.Copy();$active.i=5;$active.type='Edit';$active.aid=$tableAid+'.(1).Betrag';$script:tree.nodes+=@($active)}
    'help-arbitrary-edit' {$sourceNode.type='Edit';$script:source.Current.ControlType=[System.Windows.Automation.ControlType]::Edit}
  }
  $late=$case -cin @('help-source-at-last-hook','help-provider-late')
  $expected=$case -cin @('help-exact','help-rematerialized-after-click')
  $result=Invoke-Scenario $case $expected ([int]$expected) 0 $late
  Assert-True ($script:clickHelperCalls -eq [int]($expected -or $late)) "$case bypassed or replayed the single submission boundary."
  Assert-True ($script:focusCalls -eq 0 -and $script:selectCalls -eq 0) "$case added another activation action."
}
Write-Output 'Number-cell Help source: actual source/transaction, exact own noneditable Help identity and loaded-provider versions, no generic Document authority.'

foreach ($case in @('passive-Button','passive-Table','passive-DataGrid','passive-DataItem','passive-Tree','passive-TreeItem',
  'passive-empty','passive-selected-target','passive-selection-order','passive-gapped-toggle','passive-limit','passive-duplicate','passive-too-many','passive-mixed-row',
  'passive-duplicate-column','passive-offscreen','passive-name','passive-bounds','passive-foreign-pid','passive-foreign-table',
  'passive-wrong-selection-container','passive-untyped-selected','passive-unselected-item','passive-target-inconsistent',
  'passive-span','passive-missing-node','passive-missing-pattern','passive-selection-late-empty','passive-selection-late-added',
  'passive-selection-late-metadata','passive-selection-late-set','passive-source-foreign-pid','passive-source-window',
  'passive-source-metadata','passive-source-unfocused','passive-source-edit','passive-source-custom','passive-source-document',
  'passive-source-late','passive-rematerialized-after-click')) {
  $tableAid='Synthetic.Table./.Tab';Reset-Scenario;$script:mode=$case;$script:providerReads=0;$script:helpPolicy=$null
  $type=$(if ($case -cmatch '^passive-(Table|DataGrid|DataItem|Button|Tree|TreeItem)$') {$Matches[1]} else {'Button'})
  $sourceNode=[pscustomobject]@{i=4;p=-1;rid='2.1';aid='Synthetic.Results.MoreDetails';type=$type;name='More details';on=$true;x=600;y=100;w=100;h=30}
  $script:source=New-Element $sourceNode $type;$script:source.Current.HasKeyboardFocus=$true
  $window=New-Element ([pscustomobject]@{rid='9.1';aid='Synthetic.Main';name='';x=0;y=0;w=900;h=700}) 'Window'
  $window.Current.NativeWindowHandle=111;$script:source.parent=$window;$AE::FocusedElement=$script:source
  $script:tree.nodes+=@($sourceNode)
  $oldNumber=[pscustomobject]@{i=5;p=0;rid='1.5';aid=$tableAid;type='DataItem';name='2';val='2';on=$true;x=100;y=170;w=40;h=30}
  $oldDate=[pscustomobject]@{i=6;p=0;rid='1.6';aid=$tableAid;type='DataItem';name='02.02';val='02.02';on=$true;x=140;y=170;w=100;h=30}
  $script:tree.nodes+=@($oldNumber,$oldDate)
  foreach ($node in @($oldNumber,$oldDate)) {
    $element=New-Element $node 'DataItem';$element.parent=$script:table
    $element.patterns.grid=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=$(if($node.rid -ceq '1.5'){[int]0}else{[int]1});RowSpan=[int]1;ColumnSpan=[int]1;ContainingGrid=$script:table}}
    $element.patterns.item=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true;SelectionContainer=$script:table}}
    $script:priorElements[$node.rid]=$element
  }
  $script:selection.items=@($script:priorElements['1.5'],$script:priorElements['1.6'])
  switch ($case) {
    'passive-empty' {$script:selection.items=@()}
    'passive-selected-target' {$script:selection.items=@($script:cell);$script:item.Current.IsSelected=$true}
    'passive-selection-late-added' {$script:selection.items=@()}
    'passive-duplicate' {$script:selection.items=@($script:priorElements['1.5'],$script:priorElements['1.5'])}
    {$_ -cin @('passive-limit','passive-too-many')} {
      $count=$(if ($case -ceq 'passive-limit') {32} else {33});$script:selection.items=@()
      $script:tree.nodes=@($script:tree.nodes|Where-Object {$_.i -lt 5})
      foreach ($column in @(0..($count-1))) {
        $node=[pscustomobject]@{i=5+$column;p=0;rid=('1.'+(100+$column));aid=$tableAid;type='DataItem';name='Synthetic selected';on=$true;x=100+10*$column;y=170;w=10;h=30}
        $element=New-Element $node 'DataItem';$element.parent=$script:table
        $element.patterns.grid=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=[int]$column;RowSpan=[int]1;ColumnSpan=[int]1;ContainingGrid=$script:table}}
        $element.patterns.item=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true;SelectionContainer=$script:table}}
        $script:tree.nodes+=@($node);$script:priorElements[$node.rid]=$element;$script:selection.items+=@($element)
      }
    }
    'passive-gapped-toggle' {$script:priorElements['1.6'].patterns.grid.Current.Column=[int]6;$script:priorElements['1.6'].patterns.toggle=[pscustomobject]@{}}
    'passive-mixed-row' {$script:priorElements['1.6'].patterns.grid.Current.Row=[int]2}
    'passive-duplicate-column' {$script:priorElements['1.6'].patterns.grid.Current.Column=[int]0}
    'passive-offscreen' {$script:priorElements['1.5'].Current.IsOffscreen=$true}
    'passive-name' {$script:priorElements['1.5'].Current.Name='Changed selected value'}
    'passive-bounds' {$script:priorElements['1.5'].Current.BoundingRectangle.Width=39}
    'passive-foreign-pid' {$script:priorElements['1.5'].Current.ProcessId=8}
    'passive-foreign-table' {$script:priorElements['1.5'].patterns.grid.Current.ContainingGrid=$window}
    'passive-wrong-selection-container' {$script:priorElements['1.5'].patterns.item.Current.SelectionContainer=$window}
    'passive-untyped-selected' {$script:priorElements['1.5'].patterns.item.Current.IsSelected='true'}
    'passive-unselected-item' {$script:priorElements['1.5'].patterns.item.Current.IsSelected=$false}
    'passive-target-inconsistent' {$script:item.Current.IsSelected=$true}
    'passive-span' {$script:priorElements['1.5'].patterns.grid.Current.RowSpan=[int]2}
    'passive-missing-node' {$script:tree.nodes=@($script:tree.nodes|Where-Object rid -cne '1.5')}
    'passive-missing-pattern' {$script:priorElements['1.5'].patterns.Remove('item')}
    'passive-selection-late-set' {
      $third=$oldDate.PSObject.Copy();$third.i=7;$third.rid='1.7';$third.x=240;$script:tree.nodes+=@($third)
      $element=New-Element $third 'DataItem';$element.parent=$script:table
      $element.patterns.grid=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=[int]2;RowSpan=[int]1;ColumnSpan=[int]1;ContainingGrid=$script:table}}
      $element.patterns.item=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true;SelectionContainer=$script:table}}
      $script:priorElements['1.7']=$element
    }
    'passive-source-foreign-pid' {$script:source.Current.ProcessId=8}
    'passive-source-window' {$window.Current.NativeWindowHandle=222}
    'passive-source-metadata' {$script:source.Current.Name='Changed source'}
    'passive-source-unfocused' {$script:source.Current.HasKeyboardFocus=$false}
    'passive-source-edit' {$sourceNode.type='Edit';$script:source.Current.ControlType=[System.Windows.Automation.ControlType]::Edit}
    'passive-source-custom' {$sourceNode.type='Custom';$script:source.Current.ControlType=[System.Windows.Automation.ControlType]::Custom}
    'passive-source-document' {$sourceNode.type='Document';$script:source.Current.ControlType=[System.Windows.Automation.ControlType]::Document}
  }
  $positive=$case -cin @('passive-Table','passive-DataGrid','passive-DataItem','passive-Button','passive-Tree','passive-TreeItem',
    'passive-empty','passive-selected-target','passive-selection-order','passive-gapped-toggle','passive-limit','passive-rematerialized-after-click')
  $late=$case -cin @('passive-selection-late-empty','passive-selection-late-added','passive-selection-late-metadata','passive-selection-late-set','passive-source-late')
  $result=Invoke-Scenario $case $positive ([int]$positive) 0 $late
  Assert-True ($script:clickHelperCalls -eq [int]($positive -or $late) -and $script:providerReads -eq 0) "$case changed the bounded route or inherited the Help-only Qt-version gate."
  if ($case -ceq 'passive-too-many') {Assert-True ($script:resolverCalls -eq 2) 'Over-limit selection did provider work before enforcing its bound.'}
}
Write-Output 'Number-cell passive source: actual unchanged source proof and strict fresh prior selection, revalidated exactly before one click.'

foreach ($case in @('visible-clipped-original','visible-number-editor','visible-no-full-cell','visible-empty-alternative',
  'visible-incomplete-row','visible-semantic-error','visible-wrong-row-identity','visible-duplicate-candidate',
  'visible-earlier-at-last-hook','visible-row-at-last-hook','visible-bounds-at-last-hook','visible-duplicate-row',
  'visible-original-spoof','visible-empty-no-next','visible-narrow-no-next','visible-text-semantic-mismatch','visible-boolean-off',
  'visible-boolean-indeterminate','visible-boolean-inconsistent','visible-boolean-on','visible-off-label-only','visible-indeterminate-label-only',
  'visible-duplicate-cell-rid','visible-wrong-column','visible-header-at-last-hook','visible-same-center-resize','visible-inplace-name','visible-original-rid-at-last-hook')) {
  $tableAid='Synthetic.RedThreadContent.ClientFrameSSE.DialogUI./.Tab'
  Reset-Scenario;$script:mode=$case;$script:helpPolicy=$null;$script:providerReads=0
  $script:expectedClickRid='1.5';$script:expectedClickY=185
  $script:cellNode.y=124;$script:cell.Current.BoundingRectangle.Y=124
  $sourceNode=[pscustomobject]@{i=4;p=-1;rid='2.1';aid='Synthetic.Results.MoreDetails';type='Button';name='More details';on=$true;x=600;y=100;w=100;h=30}
  $script:source=New-Element $sourceNode 'Button';$script:source.Current.HasKeyboardFocus=$true
  $window=New-Element ([pscustomobject]@{rid='9.1';aid='Synthetic.Main';name='';x=0;y=0;w=900;h=700}) 'Window'
  $window.Current.NativeWindowHandle=111;$script:source.parent=$window;$AE::FocusedElement=$script:source
  $candidate=[pscustomobject]@{i=5;p=0;rid='1.5';aid=$tableAid;type='DataItem';name='';val='';on=$true;x=100;y=170;w=40;h=30}
  if ($case -ceq 'visible-inplace-name') {
    $actualNode=New-Object SyntheticVisibleNode
    foreach ($property in @('i','p','rid','aid','type','name','val','on','x','y','w','h')) {$actualNode.$property=$candidate.$property}
    $candidate=$actualNode
  }
  $detail=[pscustomobject]@{i=6;p=0;rid='1.6';aid=$tableAid;type='DataItem';name='Synthetic row';val='Synthetic row';on=$true;x=140;y=170;w=100;h=30}
  $script:tree.nodes+=@($sourceNode,$candidate,$detail)
  foreach ($node in @($candidate,$detail)) {
    $element=New-Element $node 'DataItem';$element.parent=$script:table
    $element.patterns.grid=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]1;Column=$(if($node.rid -ceq '1.5'){[int]0}else{[int]1});RowSpan=[int]1;ColumnSpan=[int]1;ContainingGrid=$script:table}}
    $element.patterns.item=[pscustomobject]@{Current=[pscustomobject]@{IsSelected=$true;SelectionContainer=$script:table}}
    $script:priorElements[$node.rid]=$element
  }
  $script:selection.items=@($script:priorElements['1.5'],$script:priorElements['1.6'])
  $semantic=@([pscustomobject]@{type='text';value='';checkboxState=$null;ok=$true;error=$null},[pscustomobject]@{type='text';value='Synthetic row';checkboxState=$null;ok=$true;error=$null})
  $AE::PointResult=$script:priorElements['1.5']
  $script:snapshot | Add-Member NoteProperty zeilenMitIdentitaet @([pscustomobject]@{werte=@('','Synthetic row');identitaet='0=1.5|1=1.6';semanticCells=$semantic})
  switch ($case) {
    'visible-no-full-cell' {$candidate.h=300;$script:priorElements['1.5'].Current.BoundingRectangle.Height=300}
    'visible-empty-alternative' {$detail.name='0,00';$script:priorElements['1.6'].Current.Name='0,00';$script:snapshot.zeilenMitIdentitaet[0].werte[1]='0,00';$semantic[1].value='0,00'}
    'visible-incomplete-row' {$script:snapshot.zeilenMitIdentitaet[0].semanticCells=@($semantic[0])}
    'visible-semantic-error' {$semantic[1].ok=$false;$semantic[1].error='Synthetic missing semantic proof'}
    'visible-text-semantic-mismatch' {$semantic[1].value='Unmatched semantic value'}
    'visible-boolean-off' {$semantic[1].type='boolean';$semantic[1].value=$false;$semantic[1].checkboxState='Off'}
    'visible-boolean-indeterminate' {$semantic[1].type='boolean';$semantic[1].value=$null;$semantic[1].checkboxState='Indeterminate'}
    'visible-boolean-inconsistent' {$semantic[1].type='boolean';$semantic[1].value=$true;$semantic[1].checkboxState='Off'}
    'visible-boolean-on' {$semantic[1].type='boolean';$semantic[1].value=$true;$semantic[1].checkboxState='On'}
    'visible-off-label-only' {$semantic[1].type='boolean';$semantic[1].value=$false;$semantic[1].checkboxState='Off'}
    'visible-indeterminate-label-only' {$semantic[1].type='boolean';$semantic[1].value=$null;$semantic[1].checkboxState='Indeterminate'}
    'visible-duplicate-cell-rid' {$script:snapshot.zeilenMitIdentitaet[0].identitaet='0=1.5|1=1.5'}
    'visible-wrong-column' {$detail.x=110;$script:priorElements['1.6'].Current.BoundingRectangle.X=110}
    'visible-wrong-row-identity' {$script:snapshot.zeilenMitIdentitaet[0].identitaet='0=1.7|1=1.6'}
    'visible-duplicate-candidate' {$copy=$candidate.PSObject.Copy();$copy.i=7;$copy.rid='1.7';$script:tree.nodes+=@($copy)}
    'visible-duplicate-row' {$script:snapshot.zeilenMitIdentitaet+=@($script:snapshot.zeilenMitIdentitaet[0].PSObject.Copy())}
    'visible-original-spoof' {$script:snapshot.ersteZelle=$script:snapshot.ersteZelle.PSObject.Copy();$script:snapshot.ersteZelle.name='Different original'}
    'visible-same-center-resize' {$script:selection.items=@();$script:priorElements['1.5'].patterns.item.Current.IsSelected=$false;$script:priorElements['1.6'].patterns.item.Current.IsSelected=$false}
    {$_ -cin @('visible-empty-no-next','visible-narrow-no-next')} {
      if ($case -ceq 'visible-empty-no-next') {$detail.name='0,00';$script:priorElements['1.6'].Current.Name='0,00';$script:snapshot.zeilenMitIdentitaet[0].werte[1]='0,00';$semantic[1].value='0,00'}
      if ($case -ceq 'visible-narrow-no-next') {$candidate.w=4;$script:priorElements['1.5'].Current.BoundingRectangle.Width=4}
      $next=$candidate.PSObject.Copy();$next.i=7;$next.rid='1.9';$next.y=220
      $next.w=40
      $nextDetail=$detail.PSObject.Copy();$nextDetail.i=8;$nextDetail.rid='1.10';$nextDetail.y=220;$nextDetail.name='Synthetic later row'
      $script:tree.nodes+=@($next,$nextDetail)
      $script:snapshot.zeilenMitIdentitaet+=@([pscustomobject]@{werte=@('','Synthetic later row');identitaet='0=1.9|1=1.10';semanticCells=@(
        [pscustomobject]@{type='text';value='';checkboxState=$null;ok=$true;error=$null},
        [pscustomobject]@{type='text';value='Synthetic later row';checkboxState=$null;ok=$true;error=$null})})
    }
    'visible-earlier-at-last-hook' {
      $other=$candidate.PSObject.Copy();$other.i=7;$other.rid='1.9';$other.y=220;$script:tree.nodes+=@($other)
      $script:priorElements['1.9']=New-Element $other 'DataItem'
    }
  }
  if ($case -cin @('visible-boolean-off','visible-boolean-indeterminate')) {
    $extraHeader=$script:headerNode.PSObject.Copy();$extraHeader.i=7;$extraHeader.rid='1.7';$extraHeader.x=240;$extraHeader.name='Description';$extraHeader.w=100
    $extraCell=$detail.PSObject.Copy();$extraCell.i=8;$extraCell.rid='1.8';$extraCell.x=240;$extraCell.name='Synthetic content'
    $script:tree.nodes+=@($extraHeader,$extraCell);$script:snapshot.kopf+=@('Description')
    $script:snapshot.zeilenMitIdentitaet[0].werte+=@('Synthetic content');$script:snapshot.zeilenMitIdentitaet[0].identitaet+='|2=1.8'
    $script:snapshot.zeilenMitIdentitaet[0].semanticCells+=@([pscustomobject]@{type='text';value='Synthetic content';checkboxState=$null;ok=$true;error=$null})
  }
  if ($case -ceq 'visible-number-editor') {
    foreach ($name in @('Test-SSEExactProperties','Test-SSETableNumberPolicy','Get-SSETableNumberAnchorFocusProof')) {
      $actual=@($workerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
      Assert-True ($actual.Count -eq 1) 'Actual number editor proof must be unique.'
      . ([scriptblock]::Create($actual[0].Extent.Text))
    }
    $script:editor.Current.AutomationId=$tableAid+'.qt_scrollarea_viewport./.Tab.(2).BelegNr'
    $script:editor.Current.Name='';$script:editor.Current.BoundingRectangle.Y=170;$script:editor.parent=$script:table
    $script:editor.patterns.value=[pscustomobject]@{Current=[pscustomobject]@{Value='';IsReadOnly=$false}}
  }
  $positive=$case -cin @('visible-clipped-original','visible-number-editor','visible-boolean-off','visible-boolean-indeterminate','visible-boolean-on')
  $late=$case -cin @('visible-earlier-at-last-hook','visible-row-at-last-hook','visible-bounds-at-last-hook','visible-header-at-last-hook','visible-same-center-resize','visible-inplace-name','visible-original-rid-at-last-hook')
  $result=Invoke-Scenario $case $positive ([int]$positive) ([int]($case -ceq 'visible-number-editor')) $late
  Assert-True ($script:snapshot.ersteZelle.rid -ceq '1.3' -and $script:snapshot.ersteZelle.y -eq 124) "$case rewrote the original read anchor to fabricate an activation target."
  Assert-True ($script:clickHelperCalls -eq [int]($positive -or $late)) "$case changed or retried the planned visible target."
  if ($case -cin @('visible-empty-no-next','visible-narrow-no-next')) {
    Assert-True ($script:resolverCalls -eq 0) "$case skipped its fixed first candidate and inspected another provider target."
  }
}
Write-Output 'Number-cell activation: fixed fully visible alternative binds actual Grid row while the original read anchor remains unchanged.'
