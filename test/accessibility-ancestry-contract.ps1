$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$parseErrors)
if (@($parseErrors).Count) {throw 'Worker syntax is invalid.'}
foreach ($name in @('Get-UiaElementDescriptor','Get-SSEUiaOwnRootAncestry','Get-AccessibilityProbeData')) {
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($definition.Count -ne 1) {throw "Missing productive helper: $name"}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
Add-Type -TypeDefinition @'
using System;
public static class SW {
 public static uint GetWindowThreadProcessId(IntPtr hwnd,ref int pid){pid=hwnd==new IntPtr(111)?7:0;return 1;}
}
namespace System.Windows.Automation {
 public static class AutomationElement {
  public static object Root;
  public static object FromHandle(IntPtr hwnd){return Root;}
 }
 public sealed class ControlType {
  public string ProgrammaticName;
  ControlType(string name){ProgrammaticName="ControlType."+name;}
  public static ControlType Window=new ControlType("Window"),Pane=new ControlType("Pane"),
   Table=new ControlType("Table"),DataItem=new ControlType("DataItem"),Button=new ControlType("Button");
 }
}
'@
function New-Element([string]$Type,[string]$Rid,[string]$Aid,[int]$SyntheticPid=7,[int]$NativeHwnd=0) {
  $typeMap=@{Window=[System.Windows.Automation.ControlType]::Window;Pane=[System.Windows.Automation.ControlType]::Pane;
    Table=[System.Windows.Automation.ControlType]::Table;DataItem=[System.Windows.Automation.ControlType]::DataItem;
    Button=[System.Windows.Automation.ControlType]::Button}
  $element=[pscustomobject]@{rid=$Rid;parent=$null;children=@();Current=[pscustomobject]@{
    ProcessId=$SyntheticPid;NativeWindowHandle=$NativeHwnd;AutomationId=$Aid;ControlType=$typeMap[$Type];
    Name='Synthetic selected element';HelpText='';ItemStatus='';LocalizedControlType=$Type;
    IsOffscreen=$false;IsKeyboardFocusable=$true;HasKeyboardFocus=$false;
    BoundingRectangle=[pscustomobject]@{X=0;Y=0;Width=80;Height=24}}}
  $element | Add-Member ScriptMethod GetRuntimeId {$this.rid -split '\.'}
  $element
}
$AE=[System.Windows.Automation.AutomationElement]
$WLK=[pscustomobject]@{}
$WLK | Add-Member ScriptMethod GetParent {
  param($element)
  if ($script:mode -eq 'parent-error') {throw 'Synthetic parent unavailable'}
  $element.parent
}
$RAW=[pscustomobject]@{}
$RAW | Add-Member ScriptMethod GetFirstChild {param($element) @($element.children)[0]}
$RAW | Add-Member ScriptMethod GetNextSibling {param($element) $null}
foreach ($case in @('direct','embedded-window','foreign-root-pid','foreign-root-hwnd','foreign-target-pid',
                    'foreign-ancestor','cycle','depth-limit','no-parent','large-aid','missing-aid','parent-error')) {
  $script:mode=$case
  $root=New-Element 'Window' '1.1' 'Synthetic.Root' 7 111
  $engine=New-Element 'Window' '1.2' 'Synthetic.Root.Engine' 7 222
  $target=New-Element 'DataItem' '10.1' 'Synthetic.Root.Engine.Table'
  $target.parent=$root;$engine.parent=$root;$AE::Root=$root
  switch ($case) {
    'embedded-window' {$target.parent=$engine}
    'foreign-root-pid' {$root.Current.ProcessId=8}
    'foreign-root-hwnd' {$root.Current.NativeWindowHandle=222}
    'foreign-target-pid' {$target.Current.ProcessId=8;$target.Current.Name='Foreign secret name'}
    'foreign-ancestor' {
      $engine.Current.ProcessId=8;$engine.Current.AutomationId='Foreign secret AID';$engine.Current.Name='Foreign secret name'
      $target.parent=$engine
    }
    'cycle' {$target.parent=$engine;$engine.parent=$target}
    'depth-limit' {
      $parent=$root
      for ($depth=1;$depth -le 32;$depth++) {
        $next=New-Element 'Pane' "20.$depth" "Synthetic.Root.Depth.$depth";$next.parent=$parent;$parent=$next
      }
      $target.parent=$parent
    }
    'no-parent' {$target.parent=$null}
    'large-aid' {$target.Current.AutomationId='X'*2049}
    'missing-aid' {$target.Current.AutomationId=''}
  }
  $result=Get-SSEUiaOwnRootAncestry ([IntPtr]111) $target
  if ($result.bound -ne ($case -in @('direct','embedded-window')) -or $result.complete -ne $result.bound) {
    throw "$case`: own-root ancestry proof mismatch."
  }
  $expectedReason=switch ($case) {
    {$_ -in @('direct','embedded-window')} {'exact-bound-main-window';break}
    {$_ -in @('foreign-root-pid','foreign-root-hwnd')} {'own-root-unbound';break}
    {$_ -in @('foreign-target-pid','foreign-ancestor')} {'ancestor-process-mismatch';break}
    'cycle' {'ancestor-cycle';break}
    'depth-limit' {'ancestor-depth-limit';break}
    'no-parent' {'own-root-not-reached';break}
    'large-aid' {'ancestor-identity-size-limit';break}
    'missing-aid' {'ancestor-identity-unreadable';break}
    'parent-error' {'ancestor-read-error';break}
  }
  if ($result.stopReason -cne $expectedReason) {throw "$case`: ancestry stop reason mismatch."}
  if (@($result.nodes).Count -gt 32 -or @($result.nodes | Where-Object {$_.processId -ne 7}).Count) {
    throw "$case`: ancestry escaped its depth or process boundary."
  }
  foreach ($node in @($result.nodes)) {
    $fields=@($node.PSObject.Properties.Name | Sort-Object)
    if (($fields -join ',') -cne 'aid,depth,nativeWindowHandle,processId,rid,type') {throw 'Ancestor names or values were emitted.'}
  }
  if (($result | ConvertTo-Json -Depth 8 -Compress) -match 'Foreign secret') {throw 'Other-process metadata was emitted.'}
  if ($case -eq 'embedded-window' -and (@($result.nodes).Count -ne 3 -or
      $result.nodes[1].type -cne 'Window' -or $result.nodes[1].nativeWindowHandle -ne 222 -or
      $result.nodes[2].nativeWindowHandle -ne 111)) {throw 'Embedded UIA Window was hidden or mistaken for the bound main root.'}
}

# Run the actual descriptor/probe producers against these doubles only.
$script:mode='direct'
$root=New-Element 'Window' '1.1' 'Synthetic.Root' 7 111
$engine=New-Element 'Window' '1.2' 'Synthetic.Root.Engine' 7 222;$engine.parent=$root
$target=New-Element 'DataItem' '10.1' 'Synthetic.Root.Engine.Table';$target.parent=$engine
$child=New-Element 'Button' '10.2' 'Synthetic.Root.Engine.Table.Child' 7 333;$child.parent=$target
$target.children=@($child);$AE::Root=$root
function Get-LiveElement {param($Hwnd,$Rid) $target}
function Fail {param($Message,$Kind) throw $Message}
$node=[pscustomobject]@{rid='10.1';x=0;y=0;w=80;h=24}
$probe=Get-AccessibilityProbeData ([IntPtr]111) $node 6 120 $false $true $false
if ($probe.uia.processId -ne 7 -or $probe.uia.nativeWindowHandle -ne 0 -or
    -not $probe.uia.ownRootAncestry.bound -or @($probe.uia.ownRootAncestry.nodes).Count -ne 3) {
  throw 'Probe root dropped the own-root identity evidence.'
}
if (@($probe.rawDescendants).Count -ne 1 -or $probe.rawDescendants[0].processId -ne 7 -or
    $probe.rawDescendants[0].nativeWindowHandle -ne 333 -or $probe.rawTruncated) {
  throw 'Raw descriptors dropped PID/HWND or changed the bounded traversal.'
}
$missing=New-Element 'DataItem' '10.3' 'Synthetic.Unreadable'
$missing.Current.ProcessId=$null;$missing.Current.NativeWindowHandle=$null
$unknown=Get-UiaElementDescriptor $missing 0 $false
if ($null -ne $unknown.processId -or $null -ne $unknown.nativeWindowHandle) {throw 'Unknown identity metadata was reported as zero.'}
Write-Output 'accessibility-ancestry-contract: PASS (synthetic only; bounded own-root metadata; no focus or input)'
