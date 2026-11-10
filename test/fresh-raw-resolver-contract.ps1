$ErrorActionPreference='Stop'
$native=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-native.cs'))
$start=$native.IndexOf('public sealed class SSEUiaFreshRawResult {',[StringComparison]::Ordinal)
$end=$native.IndexOf('public sealed class SSEUiaScrollState {',$start,[StringComparison]::Ordinal)
if ($start -lt 0 -or $end -le $start) {throw 'Compiled fresh RawView resolver is absent.'}
$resolver=$native.Substring($start,$end-$start)
if ($resolver -match 'Cached|CacheRequest|ControlView|FindAll|FindFirst|SetFocus|Select\(|Toggle\(') {
  throw 'Fresh identity resolution acquired a snapshot, subtree search, or action.'
}
# Compile the actual production resolver against a deterministic, typed UIA
# boundary. No desktop, installed product, cache, or prebuilt DLL participates.
$provider=@'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Windows.Automation;
namespace System.Windows.Automation {
  public sealed class ControlType {
    public static readonly ControlType Window=new ControlType(),Table=new ControlType(),DataGrid=new ControlType(),
      DataItem=new ControlType(),Button=new ControlType(),Pane=new ControlType(),Group=new ControlType();
  }
  public sealed class FakeRect {public double X,Y,Width=10,Height=10;}
  public sealed class AutomationElement {
    public static AutomationElement Root;
    public static int RootCalls,CurrentCalls,RidCalls,FirstCalls,SiblingCalls;
    public int[] Rid;public string Aid="cells";public int Pid=7,Hwnd=111;
    public bool Enabled=true,Offscreen,ThrowCurrent,ThrowRid,ThrowFirst,ThrowSibling,ThrowEnabled,ThrowParent;
    public int DelayRidAtCall,DelayRidMs,OwnRidCalls,EnabledCalls,FirstOwnCalls,OwnCurrentCalls;
    public Action OnCurrent;
    public ControlType Type=ControlType.DataItem;public FakeRect Bounds=new FakeRect();
    public AutomationElement Parent,SiblingOverride;public bool UseSiblingOverride;
    public List<AutomationElement> Children=new List<AutomationElement>();
    public static AutomationElement FromHandle(IntPtr hwnd){RootCalls++;return Root;}
    public struct AutomationElementInformation {
      readonly AutomationElement element;
      public AutomationElementInformation(AutomationElement value){element=value;}
      public int ProcessId{get{return element.Pid;}}
      public int NativeWindowHandle{get{return element.Hwnd;}}
      public ControlType ControlType{get{return element.Type;}}
      public string AutomationId{get{return element.Aid;}}
      public bool IsEnabled{get{element.EnabledCalls++;if(element.ThrowEnabled)throw new InvalidOperationException("provider");return element.Enabled;}}
      public bool IsOffscreen{get{return element.Offscreen;}}
      public FakeRect BoundingRectangle{get{return element.Bounds;}}
    }
    public AutomationElementInformation Current{get{
      CurrentCalls++;OwnCurrentCalls++;if(OnCurrent!=null)OnCurrent();if(ThrowCurrent)throw new InvalidOperationException("provider");return new AutomationElementInformation(this);
    }}
    public int[] GetRuntimeId(){
      RidCalls++;OwnRidCalls++;if(ThrowRid)throw new InvalidOperationException("provider");
      if(DelayRidAtCall==OwnRidCalls)Thread.Sleep(DelayRidMs);return Rid;
    }
    public static AutomationElement Reset(){
      RootCalls=CurrentCalls=RidCalls=FirstCalls=SiblingCalls=0;
      Root=new AutomationElement{Rid=new[]{1},Type=ControlType.Window,Aid="root"};return Root;
    }
    public static AutomationElement Add(AutomationElement parent,int id){
      var child=new AutomationElement{Rid=new[]{id},Parent=parent};parent.Children.Add(child);return child;
    }
  }
  public sealed class TreeWalker {
    public static readonly TreeWalker RawViewWalker=new TreeWalker();
    public AutomationElement GetParent(AutomationElement element){
      if(element.ThrowParent)throw new InvalidOperationException("provider");return element.Parent;
    }
    public AutomationElement GetFirstChild(AutomationElement element){
      AutomationElement.FirstCalls++;element.FirstOwnCalls++;
      if(element.ThrowFirst)throw new InvalidOperationException("provider");return element.Children.Count==0?null:element.Children[0];
    }
    public AutomationElement GetNextSibling(AutomationElement element){
      AutomationElement.SiblingCalls++;if(element.ThrowSibling)throw new InvalidOperationException("provider");
      if(element.UseSiblingOverride)return element.SiblingOverride;
      if(element.Parent==null)return null;var siblings=element.Parent.Children;int index=siblings.IndexOf(element);
      return index+1<siblings.Count?siblings[index+1]:null;
    }
  }
}
'@
Add-Type -TypeDefinition ($provider+$resolver)
$AE=[System.Windows.Automation.AutomationElement];$CT=[System.Windows.Automation.ControlType]
function Assert-Result($Result,[bool]$Ok,[string]$Reason) {
  if ($Result.Ok -ne $Ok -or ($Reason -and $Result.Reason -cne $Reason)) {
    throw "Fresh RawView outcome mismatch: wanted $Ok/$Reason, observed $($Result.Ok)/$($Result.Reason)."
  }
  if (-not $Ok -and ($Result.Element -or $Result.Elements.Count)) {throw 'Rejected proof disclosed actionable partial elements.'}
}
function Focus([string]$Rid='2',[string]$Aid='cells',[string]$Type='DataItem') {
  [SSEUiaFreshRaw]::Focus([IntPtr]111,7,$Rid,$Aid,$Type)
}
function Model([string[]]$Rids=@('2','3')) {[SSEUiaFreshRaw]::ModelCells([IntPtr]111,7,'cells',$Rids)}
foreach ($case in @('enabled','disabled','offscreen','zero-width','zero-height','wrong-aid','wrong-type','foreign-root-pid',
  'foreign-root-hwnd','foreign-root-type','foreign-target-pid','provider-current','provider-rid','provider-enabled','provider-first','provider-sibling')) {
  $root=$AE::Reset();$target=$AE::Add($root,2)
  switch($case) {
    'disabled' {$target.Enabled=$false}
    'offscreen' {$target.Offscreen=$true}
    'zero-width' {$target.Bounds.Width=0}
    'zero-height' {$target.Bounds.Height=0}
    'wrong-aid' {$target.Aid='other'}
    'wrong-type' {$target.Type=$CT::Pane}
    'foreign-root-pid' {$root.Pid=8}
    'foreign-root-hwnd' {$root.Hwnd=222}
    'foreign-root-type' {$root.Type=$CT::Pane}
    'foreign-target-pid' {$target.Pid=8}
    'provider-current' {$target.ThrowCurrent=$true}
    'provider-rid' {$target.ThrowRid=$true}
    'provider-enabled' {$target.ThrowEnabled=$true}
    'provider-first' {$root.ThrowFirst=$true}
    'provider-sibling' {$target.ThrowSibling=$true}
  }
  $reason=$(if($case -like 'provider-*') {'fresh-focus-walk-error'} elseif($case -ceq 'enabled') {'fresh-exact-focus-element'} else {'fresh-focus-element-unbound'})
  $result=Focus;Assert-Result $result ($case -ceq 'enabled') $reason
  if ($result.Ok -and (-not [object]::ReferenceEquals($result.Element,$target) -or $target.FirstOwnCalls)) {
    throw 'Exact match was replaced, cached, or expanded after success.'
  }
}
foreach($type in @('Table','DataGrid','Button')) {
  $root=$AE::Reset();$target=$AE::Add($root,2);$target.Type=$CT.GetField($type).GetValue($null)
  $expected=$(if($type -ceq 'Button') {'Button'} else {'Table'})
  Assert-Result (Focus '2' 'cells' $expected) $true 'fresh-exact-focus-element'
}
foreach($args in @(@('','cells','DataItem'),@('2','','DataItem'),@('2','cells','Window'))) {
  $null=$AE::Reset();Assert-Result (Focus @args) $false 'fresh-focus-element-unbound'
  if($AE::RootCalls) {throw 'Invalid identity dispatched a provider call.'}
}
foreach($case in @('disabled-passive','wrong-aid','wrong-type','offscreen','zero-width','foreign-pid','missing','partial-provider-error','disabled-getter-error')) {
  $root=$AE::Reset();$a=$AE::Add($root,2);$b=$AE::Add($root,3);$a.Enabled=$false
  switch($case) {
    'wrong-aid' {$a.Aid='other'}
    'wrong-type' {$a.Type=$CT::Table}
    'offscreen' {$a.Offscreen=$true}
    'zero-width' {$a.Bounds.Width=0}
    'foreign-pid' {$a.Pid=8}
    'missing' {$a.Rid=@(4)}
    'partial-provider-error' {$a.ThrowCurrent=$true}
    'disabled-getter-error' {$a.ThrowEnabled=$true}
  }
  $result=Model;Assert-Result $result ($case -ceq 'disabled-passive') ''
  if ($result.Ok -and ($result.Elements.Count -ne 2 -or $result.Elements['2'].Current.IsEnabled -or $a.EnabledCalls -lt 1)) {
    throw 'Passive disabled model cell lost its fresh typed metadata or exact identity.'
  }
  if (-not $result.Ok -and $result.FoundNodes -ne 1) {throw 'LIFO traversal or independent partial-result diagnostic changed.'}
}
foreach($rids in @(@(),@('2'),@('2','2'),@('2',''),@(1..101 | ForEach-Object {[string]$_}))) {
  $null=$AE::Reset();Assert-Result (Model $rids) $false ''
  if($AE::RootCalls) {throw 'Invalid requested model set dispatched a provider call.'}
}
foreach($case in @('foreign-subtree','owned-window-subtree')) {
  $root=$AE::Reset();$branch=$AE::Add($root,3);$target=$AE::Add($branch,2)
  if($case -ceq 'foreign-subtree') {$branch.Pid=8} else {$branch.Type=$CT::Window}
  Assert-Result (Focus) $false 'fresh-focus-element-unbound'
  if($branch.FirstOwnCalls -or $target.OwnRidCalls) {throw 'Excluded process/window subtree was entered.'}
}
foreach($case in @('missing-rid','duplicate-sibling','sibling-loop','global-cycle')) {
  $root=$AE::Reset();$branch=$AE::Add($root,3);$target=$AE::Add($branch,2)
  switch($case) {
    'missing-rid' {$branch.Rid=@()}
    'duplicate-sibling' {$duplicate=$AE::Add($root,3)}
    'sibling-loop' {$branch.UseSiblingOverride=$true;$branch.SiblingOverride=$branch}
    'global-cycle' {$branch.Rid=@(1)}
  }
  Assert-Result (Focus) $false 'fresh-focus-walk-cycle'
}
foreach($depth in @(16,17)) {
  $root=$AE::Reset();$last=$root
  for($level=1;$level -le $depth;$level++) {$last=$AE::Add($last,100+$level)}
  $last.Rid=@(2);$result=Focus
  Assert-Result $result ($depth -eq 16) $(if($depth -eq 16) {'fresh-exact-focus-element'} else {'fresh-focus-walk-depth'})
}
foreach($children in @(2047,2048)) {
  $root=$AE::Reset()
  for($index=0;$index -lt $children;$index++) {$last=$AE::Add($root,100+$index)}
  # First visited child is the last sibling. Root plus queued nodes share cap.
  $last.Rid=@(2);$result=Focus
  Assert-Result $result ($children -eq 2047) $(if($children -eq 2047) {'fresh-exact-focus-element'} else {'fresh-focus-walk-limited'})
  if($children -eq 2048 -and $result.VisitedNodes -ne 1) {throw 'Queued node limit was deferred until provider traversal.'}
}
$root=$AE::Reset();$target=$AE::Add($root,2);$later=$AE::Add($root,3)
$target.ThrowCurrent=$true;$later.Rid=@(2)
Assert-Result (Focus) $false 'fresh-focus-walk-cycle'
# An early exact match may return without claiming a complete global census.
$root=$AE::Reset();$unvisited=$AE::Add($root,3);$target=$AE::Add($root,2);$unvisited.ThrowCurrent=$true
Assert-Result (Focus) $true 'fresh-exact-focus-element'
if($unvisited.FirstOwnCalls) {throw 'Successful exact match scanned unrelated descendants.'}
# A slow provider call cannot be interrupted, but its returned focus candidate
# must still fail the final 5s guard before any caller acquires focus authority.
$root=$AE::Reset();$target=$AE::Add($root,2);$target.DelayRidAtCall=2;$target.DelayRidMs=5050
Assert-Result (Focus) $false 'fresh-focus-walk-limited'
$root=$AE::Reset();$target=$AE::Add($root,2);$target.DelayRidAtCall=1;$target.DelayRidMs=5050
Assert-Result (Focus) $false 'fresh-focus-walk-limited'
# Preserve the passive collector's established all-found boundary. Its caller
# independently proves every returned row property and the inherited epoch.
$root=$AE::Reset();$last=$AE::Add($root,2);$first=$AE::Add($root,3)
$last.DelayRidAtCall=2;$last.DelayRidMs=5050
Assert-Result (Model) $true 'fresh-exact-model-cells'
$AE::Root=$null;Assert-Result (Focus) $false 'fresh-focus-element-unbound'
# Exercise the actual PowerShell entry points, including diagnostic aggregation.
$workerAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Get-SSETableReadUncachedElement','Get-SSETableReadOnlyModelCells','Get-SSEGridReadUncachedTable')) {
  $definitions=@($workerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if($definitions.Count -ne 1) {throw 'Actual fresh resolver entry point is not unique.'}
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$RAW=[System.Windows.Automation.TreeWalker]::RawViewWalker
$script:SSE_TABLE_FRESH_RAW_TIMINGS=$null
$root=$AE::Reset();$a=$AE::Add($root,2);$b=$AE::Add($root,3);$a.Enabled=$false
$model=Get-SSETableReadOnlyModelCells ([IntPtr]111) 7 'cells' @('2','3')
if(-not $model.ok -or $model.elements.Count -ne 2 -or -not [object]::ReferenceEquals($model.elements['2'],$a)) {
  throw 'Actual model entry point lost the exact disabled passive cell.'
}
$focus=Get-SSETableReadUncachedElement ([IntPtr]111) 7 '2' 'cells' 'DataItem'
if($focus.ok -or $focus.element -or $focus.reason -cne 'fresh-focus-element-unbound') {
  throw 'Actual focus entry point accepted a disabled model cell.'
}
$a.Enabled=$true
$focus=Get-SSETableReadUncachedElement ([IntPtr]111) 7 '2' 'cells' 'DataItem'
if(-not $focus.ok -or -not [object]::ReferenceEquals($focus.element,$a)) {throw 'Actual focus entry point lost its fresh wrapper.'}
if($script:SSE_TABLE_FRESH_RAW_TIMINGS.Count -ne 2 -or $script:SSE_TABLE_FRESH_RAW_TIMINGS.focus.calls -ne 2 -or
    $script:SSE_TABLE_FRESH_RAW_TIMINGS.modelCells.calls -ne 1 -or $script:SSE_TABLE_FRESH_RAW_TIMINGS.focus.foundNodes -ne 1 -or
    $script:SSE_TABLE_FRESH_RAW_TIMINGS.modelCells.foundNodes -ne 2) {throw 'Actual helper timing aggregation lost or changed real calls.'}
foreach($timing in $script:SSE_TABLE_FRESH_RAW_TIMINGS.Values) {
  if($timing.elapsedMs -lt 0 -or $timing.visitedNodes -lt 1 -or
      (($timing.Keys | Sort-Object) -join ',') -cne 'calls,elapsedMs,foundNodes,implementation,remainingQueued,requestedNodes,visitedNodes') {
    throw 'Fresh resolver telemetry disclosed identity/value fields or lost bounded numeric measurements.'
  }
}
# Even broken observational state cannot replace a known successful binding.
$script:SSE_TABLE_FRESH_RAW_TIMINGS='unavailable'
$focus=Get-SSETableReadUncachedElement ([IntPtr]111) 7 '2' 'cells' 'DataItem'
if(-not $focus.ok -or -not [object]::ReferenceEquals($focus.element,$a)) {throw 'Telemetry failure replaced the original proof outcome.'}
Write-Output 'fresh-raw-resolver-contract: PASS (actual compiled RawView algorithm, strict identity/pruning/limits, passive disabled cells, no actions)'

function New-GridScopeFixture {
  $root=$AE::Reset()
  $form=$AE::Add($root,10);$form.Type=$CT::Group;$form.Aid='root.Form'
  $nav=$AE::Add($root,11);$nav.Aid='root.Navigation';$nav.ThrowFirst=$true
  $navChild=$AE::Add($nav,11);$navChild.Parent=$nav
  $table=$AE::Add($form,20);$table.Type=$CT::Table;$table.Aid='root.Form.Table'
  [pscustomobject]@{window=$root;form=$form;navigation=$nav;table=$table;
    binding=[pscustomobject]@{hwnd=[long]111;pid=7;windowRid='1';windowAid='root';rid='10';aid='root.Form';type='Group';rect=@(0.0,0.0,10.0,10.0)}}
}
function Grid($Fixture,[int]$BudgetMs=5000) {
  [SSEUiaFreshRaw]::GridTable([IntPtr]111,7,$Fixture.form,'10','root.Form','Group',0,0,10,10,'1','root','20','root.Form.Table',$BudgetMs)
}
$fixture=New-GridScopeFixture
$proof=Grid $fixture
Assert-Result $proof $true 'fresh-exact-grid-table'
if(-not [object]::ReferenceEquals($proof.Element,$fixture.table) -or $fixture.navigation.FirstOwnCalls -or $fixture.table.FirstOwnCalls) {
  throw 'Grid scope entered adjacent navigation or expanded the matched table.'
}
$fixture.table.Bounds.Width=23.5;$fixture.table.Bounds.X=1.25
Assert-Result (Grid $fixture) $true 'fresh-exact-grid-table'
# The established global resolver still fails on that adjacent provider. Its
# behavior is deliberately unchanged; Grid alone has the narrower authority.
Assert-Result (Focus '20' 'root.Form.Table' 'Table') $false ''
foreach($case in @('missing-window','foreign-window-pid','foreign-window-hwnd','wrong-window-rid','wrong-window-aid',
  'missing-root','root-rid','root-aid','root-type','root-pid','root-disabled','root-offscreen','root-bounds','root-nan',
  'root-parent','duplicate-root-aid','root-parent-error','table-rid','table-aid','table-type','table-pid','table-disabled',
  'table-offscreen','table-bounds','table-parent','duplicate-table-aid','provider-current','provider-first','provider-sibling','local-cycle')) {
  $fixture=New-GridScopeFixture
  switch($case) {
    'missing-window' {$AE::Root=$null}
    'foreign-window-pid' {$fixture.window.Pid=8}
    'foreign-window-hwnd' {$fixture.window.Hwnd=222}
    'wrong-window-rid' {$fixture.window.Rid=@(99)}
    'wrong-window-aid' {$fixture.window.Aid='other'}
    'missing-root' {$fixture.form=$null}
    'root-rid' {$fixture.form.Rid=@(99)}
    'root-aid' {$fixture.form.Aid='root.Other'}
    'root-type' {$fixture.form.Type=$CT::DataItem}
    'root-pid' {$fixture.form.Pid=8}
    'root-disabled' {$fixture.form.Enabled=$false}
    'root-offscreen' {$fixture.form.Offscreen=$true}
    'root-bounds' {$fixture.form.Bounds.Width=11}
    'root-nan' {$fixture.form.Bounds.X=[double]::NaN}
    'root-parent' {$fixture.form.Parent=$fixture.navigation}
    'duplicate-root-aid' {$duplicate=$AE::Add($fixture.window,12);$duplicate.Aid='root.Form'}
    'root-parent-error' {$fixture.form.ThrowParent=$true}
    'table-rid' {$fixture.table.Rid=@(99)}
    'table-aid' {$fixture.table.Aid='root.Form.Other'}
    'table-type' {$fixture.table.Type=$CT::DataItem}
    'table-pid' {$fixture.table.Pid=8}
    'table-disabled' {$fixture.table.Enabled=$false}
    'table-offscreen' {$fixture.table.Offscreen=$true}
    'table-bounds' {$fixture.table.Bounds.Width=0}
    'table-parent' {$fixture.table.Parent=$fixture.window}
    'duplicate-table-aid' {$duplicate=$AE::Add($fixture.form,21);$duplicate.Aid='root.Form.Table'}
    'provider-current' {$fixture.form.ThrowCurrent=$true}
    'provider-first' {$fixture.form.ThrowFirst=$true}
    'provider-sibling' {$fixture.table.ThrowSibling=$true}
    'local-cycle' {$branch=$AE::Add($fixture.form,21);$branch.Children.Add($branch)}
  }
  $proof=Grid $fixture
  Assert-Result $proof $false ''
  if($fixture.navigation.FirstOwnCalls){throw ('Grid rejection entered adjacent navigation: '+$case)}
}
foreach($case in @('root-drift','table-drift','raw-depth','raw-nodes','raw-time')) {
  $fixture=New-GridScopeFixture
  switch($case) {
    'root-drift' {$item=$fixture.form;$item.OnCurrent=[Action]({if($item.OwnCurrentCalls -eq 3){$item.Bounds.Width=11}}.GetNewClosure())}
    'table-drift' {$item=$fixture.table;$item.OnCurrent=[Action]({if($item.OwnCurrentCalls -eq 3){$item.Bounds.Width=11}}.GetNewClosure())}
    'raw-depth' {
      $fixture.form.Children.Clear();$parent=$fixture.form
      for($index=0;$index -lt 16;$index++){$parent=$AE::Add($parent,100+$index);$parent.Aid='root.Form.Level'+$index}
      $fixture.table=$AE::Add($parent,20);$fixture.table.Type=$CT::Table;$fixture.table.Aid='root.Form.Table'
    }
    'raw-nodes' {for($index=0;$index -lt 2048;$index++){$null=$AE::Add($fixture.form,100+$index)}}
    'raw-time' {$fixture.form.DelayRidAtCall=1;$fixture.form.DelayRidMs=5050}
  }
  Assert-Result (Grid $fixture) $false ''
  if($fixture.navigation.FirstOwnCalls){throw ('Bounded Grid proof entered adjacent navigation: '+$case)}
}
$fixture=New-GridScopeFixture;$fixture.form.DelayRidAtCall=1;$fixture.form.DelayRidMs=30
Assert-Result (Grid $fixture 10) $false 'fresh-grid-walk-limited'
# Exercise the actual private bridge with the same compiled C# proof. The
# PowerShell profile resolver is mocked, never attached to a real UIA surface.
function Arg($Object,$Name,$Default){if($Object.PSObject.Properties[$Name]){$Object.$Name}else{$Default}}
function Get-SSEPageObjects {[pscustomobject]@{windows=[pscustomobject]@{main=[pscustomobject]@{contentAutomationId='.Form'}}}}
function Find-ExactAutomationElement {param($Window,$Aid,[switch]$VisibleOnly)
  if($Window -ne [IntPtr]111 -or $Aid -cne '.Form' -or -not $VisibleOnly){throw 'Unbound profile root request.'}
  if($script:gridBridgeDelayMs -gt 0){Start-Sleep -Milliseconds $script:gridBridgeDelayMs};$script:gridBridgeRoot}
function Test-SSEElementIdentity {param($Element,$Rid,$Aid) $Element -and ($Element.GetRuntimeId() -join '.') -ceq $Rid -and $Element.Aid -ceq $Aid}
function Test-SSEElementVisible {param($Element) $Element.Enabled -and -not $Element.Offscreen}
function Test-SSEMainContentAncestry {param($Window,$Element,$Binding) $true}
$script:gridBridgeDelayMs=0
$fixture=New-GridScopeFixture;$script:gridBridgeRoot=$fixture.form
$proof=Get-SSEGridReadUncachedTable ([IntPtr]111) 7 $fixture.binding '20' 'root.Form.Table'
if(-not $proof.ok -or -not [object]::ReferenceEquals($proof.element,$fixture.table)){throw 'Actual Grid-only bridge lost its bound scoped table.'}
foreach($case in @('no-binding','window','pid','root-aid','root-rid','rectangle','table-aid','unknown-root')) {
  $fixture=New-GridScopeFixture;$script:gridBridgeRoot=$fixture.form;$binding=$fixture.binding;$aid='root.Form.Table'
  switch($case) {
    'no-binding' {$binding=$null}
    'window' {$binding.hwnd=222}
    'pid' {$binding.pid=8}
    'root-aid' {$binding.aid='root.Other'}
    'root-rid' {$binding.rid='99'}
    'rectangle' {$binding.rect[2]=11.0}
    'table-aid' {$aid='root.Other.Table'}
    'unknown-root' {$script:gridBridgeRoot=$null}
  }
  $proof=Get-SSEGridReadUncachedTable ([IntPtr]111) 7 $binding '20' $aid
  if($proof.ok -or $proof.element -or $fixture.navigation.FirstOwnCalls){throw ('Actual Grid bridge failed open: '+$case)}
}
$fixture=New-GridScopeFixture;$script:gridBridgeRoot=$fixture.form;$script:gridBridgeDelayMs=5050
$proof=Get-SSEGridReadUncachedTable ([IntPtr]111) 7 $fixture.binding '20' 'root.Form.Table'
if($proof.ok -or $proof.element -or $proof.reason -cne 'fresh-grid-walk-limited' -or $AE::RootCalls){
  throw 'A slow successful profile lookup acquired a fresh native budget or actionable late table.'
}
$script:gridBridgeDelayMs=0
Write-Output 'fresh-grid-raw-resolver-contract: PASS (actual scoped C#, exact Raw ancestry/siblings, no navigation descent, local guards/drift, private bridge)'
