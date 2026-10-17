$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-combobox.ps1')
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
. (Join-Path $PSScriptRoot '..\powershell\table-number-click.ps1')
function Assert-True([bool]$Condition,[string]$Message) {if (-not $Condition) {throw $Message}}
Add-Type -TypeDefinition @'
using System;
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
   Header=new ControlType("Header"),Edit=new ControlType("Edit"),ComboBox=new ControlType("ComboBox"),Custom=new ControlType("Custom");
 }
 public static class GridItemPattern {public static object Pattern="grid";}
 public static class SelectionItemPattern {public static object Pattern="item";}
 public static class SelectionPattern {public static object Pattern="selection";}
 public static class TogglePattern {public static object Pattern="toggle";}
 public static class ExpandCollapsePattern {public static object Pattern="expand";}
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
  $element=[pscustomobject]@{rid=$Node.rid;patterns=@{};Current=[pscustomobject]@{
    ProcessId=7;AutomationId=$Node.aid;ControlType=$controlType;Name=[string]$Node.name;IsEnabled=$true;IsOffscreen=$false;HasKeyboardFocus=$false
    BoundingRectangle=[pscustomobject]@{X=$Node.x;Y=$Node.y;Width=$Node.w;Height=$Node.h}
  }}
  $element | Add-Member ScriptMethod GetRuntimeId { $this.rid -split '\.' }
  $element | Add-Member ScriptMethod TryGetCurrentPattern {param($Pattern,$Result)
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
  Assert-True ($null -eq $NumberModel -and $Anchor.rid -ceq '1.3' -and $Tree.nodes.Count -ge 4 -and $NumberPolicy.tableName -ceq '/.Tab') 'Number click fabricated native flags, reused post-editor tree or changed clicked-cell authority.'
  if ($script:mode -cin @('other-row-editor','changed-editor','custom-editor','combo-editor','source-still-focused')) {return [pscustomobject]@{ok=$false}}
  [pscustomobject]@{ok=$true;ownedCell=$script:cellNode;valuePattern=[pscustomobject]@{Current=[pscustomobject]@{Value='1'}};expectedValue='1'}
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
  Assert-True ($Hwnd -eq [IntPtr]111 -and $Node.rid -ceq '1.3' -and $RequireForeground -and
    $ForegroundAttempts -eq 1 -and $ExpectedRuntimeId -ceq '1.3' -and $null -ne $BeforeClickBinding -and $ThrowOnFailure) 'Click lost exact cell/foreground/one-attempt or throwing-result authority.'
  if ($script:mode -ceq 'foreground-at-last-hook') {[SW]::Foreground=[IntPtr]999}
  if ($script:mode -ceq 'selection-at-last-hook') {$script:selection.items=@($script:cell)}
  if (-not (& $BeforeClickCheck $Hwnd $BeforeClickBinding 120 140)) {throw 'Synthetic last click guard rejected.'}
  $script:clicks++
  $script:tick=([long][Environment]::TickCount -band 4294967295L)
  $script:selection.items=@($script:cell);$script:item.Current.IsSelected=$true
  if ($script:mode -cin @('whole-row','different-selected-row','duplicate-selected-column')) {$script:selection.items+=@($script:secondCell)}
  $script:cell.Current.HasKeyboardFocus=$true
  $script:editorClosed=$true;$AE::FocusedElement=$script:cell;$script:table.Current.HasKeyboardFocus=$true
  if ($script:mode -cin @('number-editor','editor-stays','table-unfocused-after-escape','other-row-editor','changed-editor','custom-editor','combo-editor')) {
    $script:editorClosed=$false;$AE::FocusedElement=$script:editor;$script:table.Current.HasKeyboardFocus=$false
  }
  if ($script:mode -ceq 'source-still-focused') {$AE::FocusedElement=$script:source;$script:table.Current.HasKeyboardFocus=$false}
  if ($script:mode -ceq 'table-unfocused') {$script:table.Current.HasKeyboardFocus=$false}
  if ($script:mode -ceq 'source-after-click') {$script:sourceValue.Current.Value='Changed position'}
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
      if ($script:mode -ceq 'values-after-click' -and $script:clicks) {$read.navigationBinding.contentSignature='changed'}
      if ($script:mode -ceq 'page-after-click' -and $script:clicks) {$read.navigationBinding.heading='Other page'}
      $read.navigationBinding.editorFree=$script:editorClosed
      $read
    }
    ReadTree={$script:tree}
    RecordInput={param($Tick,$Point) $script:records++;Assert-True ($Tick -eq $script:tick -and $Point.rid -ceq '1.3') 'Owned input checkpoint changed target.'}
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
