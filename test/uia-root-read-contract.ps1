$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Arg','Fail','Get-SSEMainWindowCandidates','Resolve-SSEMainWindowDescriptor',
  'Get-SSETextSha256','Get-SSEInteractionWindowSet','New-SSEUiStateRootContext','Get-SSEUiStateRootFailure','Get-UiSnapshot')){
  $definition=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
  if($definition.Count -ne 1){throw 'Productive UIA root helper not unique.'}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SyntheticRootAE {
  public static bool Fail=true; public static int Calls,FailAtCall;
  public static object FromHandle(IntPtr hwnd){Calls++;if(Fail || Calls==FailAtCall)throw new COMException("Synthetic UIA root failure",unchecked((int)0x80004005));return new object();}
}
public static class SSEUiaTree {
  public static int Calls; public static bool Fail; public static object Snapshot;
  public static object Describe(IntPtr hwnd,int nodes,int timeout,int depth,bool values,bool scroll){Calls++;if(Fail)throw new Exception("Synthetic bulk failure");return Snapshot;}
}
'@
$AE=[SyntheticRootAE];$Op='ui_state'
$script:window=[pscustomobject]@{hwnd=111;pid=7;title='Steuerprogramm';cls='SyntheticWindow';minimiert=$false;hung=$false;x=0;y=0;w=1200;h=800}
function Get-Windows {
  param($ProcessName)
  if($ProcessName -cne 'SSE'){throw 'Unbound window inventory.'}
  $script:inventoryCalls++
  if($script:throwInventoryAtCall -eq $script:inventoryCalls){throw 'Synthetic diagnostic inventory failure'}
  @($script:currentWindows)
}
function Emit {param($Result) $script:captured=$Result;throw 'root-result-captured'}
function Walk-TreeLegacy {$script:legacyCalls++;[pscustomobject]@{nodes=@('legacy');stats=[pscustomobject]@{}}}
function ConvertTo-SSESnapshotNodes {param($Nodes) $Nodes}
function Reset-RootFixture {
  $script:currentWindow=$script:window.PSObject.Copy();$script:captured=$null;$script:legacyCalls=0
  $script:currentWindows=@($script:currentWindow);$script:inventoryCalls=0;$script:throwInventoryAtCall=0
  $script:SSE_UI_STATE_ROOT_CONTEXT=New-SSEUiStateRootContext $script:window @($script:window)
  [SyntheticRootAE]::Fail=$true;[SyntheticRootAE]::Calls=0;[SyntheticRootAE]::FailAtCall=0;[SSEUiaTree]::Calls=0;[SSEUiaTree]::Fail=$false
}
function Invoke-RootProbe {
  try {$null=Get-UiSnapshot ([IntPtr]111)}catch{if($_.Exception.Message -ne 'root-result-captured'){return $_}}
  $null
}
Reset-RootFixture
$unexpected=Invoke-RootProbe
if($unexpected -or $script:captured.kind -cne 'uia-root-unavailable' -or $script:captured.operation -cne 'ui_state' -or
  $script:captured.phase -cne 'snapshot-root' -or $script:captured.hresult -cne '0x80004005' -or
  $script:captured.exceptionType -cne 'System.Runtime.InteropServices.COMException' -or
  $script:captured.pid -ne 7 -or $script:captured.hwnd -ne 111 -or $script:captured.windowAlive -ne $true -or
  $script:captured.windowStateChanged -ne $false -or $script:captured.outcomeUnknown -ne $false -or
  $script:captured.mutationStarted -ne $false -or [SyntheticRootAE]::Calls -ne 1 -or [SSEUiaTree]::Calls -ne 0 -or
  $script:legacyCalls -ne 0 -or $script:inventoryCalls -ne 2){throw 'Bound root failure lost its typed read-only proof or retried the poisoned client.'}
foreach($change in @(
  { $script:currentWindow.pid=8 }, { $script:currentWindow.title='Other start' },
  { $script:currentWindow.title='steuerprogramm' }, { $script:currentWindow.cls='OtherWindow' },
  { $script:currentWindow.minimiert=$true }, { $script:currentWindow.minimiert=$null },
  { $script:currentWindow.hung=$true }, { $script:currentWindow.hung=$null }
)){
  Reset-RootFixture; & $change; $failure=Invoke-RootProbe
  if(-not $failure -or $script:captured -or [SyntheticRootAE]::Calls -ne 1 -or $script:legacyCalls -ne 0){throw 'Unbound root failure acquired retry authority.'}
}
Reset-RootFixture;$Op='table_update';$fallback=Get-UiSnapshot ([IntPtr]111)
if($script:captured -or $fallback.stats.source -cne 'treewalker' -or $script:legacyCalls -ne 1){throw 'A write operation acquired read retry authority or lost its existing fallback.'}
$Op='ui_state';Reset-RootFixture
$childFallback=Get-UiSnapshot ([IntPtr]222)
if($script:captured -or $childFallback.stats.source -cne 'treewalker' -or $script:legacyCalls -ne 1){throw 'A dialog root was treated as the bound main root.'}
Reset-RootFixture
$minimized=$script:window.PSObject.Copy();$minimized.minimiert=$true
$script:SSE_UI_STATE_ROOT_CONTEXT=New-SSEUiStateRootContext $script:window @($minimized)
$null=Invoke-RootProbe
if($script:captured.windowStateChanged -ne $true){throw 'Window restoration was hidden from the retry consumer.'}
Reset-RootFixture;$script:currentWindows+=([pscustomobject]@{hwnd=112;pid=7;title='Unknown dialog';cls='SyntheticDialog';x=0;y=0;w=400;h=200})
$null=Invoke-RootProbe
if($script:captured.windowSetMainOnly -ne $false -or $script:captured.outcomeUnknown -ne $true -or
  $script:captured.processPreserved -ne $true -or $script:captured.retryable -ne $false){throw 'Unknown peer window allowed retry or destructive cleanup.'}
foreach($change in @(
  { $script:currentWindows=@() },
  { $script:currentWindow.hwnd=112 },
  { $script:currentWindows+=($script:currentWindow.PSObject.Copy()) },
  { $script:throwInventoryAtCall=1 },
  { $script:throwInventoryAtCall=2 }
)){
  Reset-RootFixture; & $change; $failure=Invoke-RootProbe
  if(-not $failure -or $script:captured -or $failure.Exception.Message -notlike '*Synthetic UIA root failure*' -or
    [SyntheticRootAE]::Calls -ne 1 -or $script:legacyCalls -ne 0){
    throw 'Missing or failed diagnostic inventory replaced the original UIA exception or emitted a new failure.'
  }
  $original=$failure.Exception.GetBaseException()
  if($original -isnot [Runtime.InteropServices.COMException] -or $original.HResult -ne -2147467259){
    throw 'Diagnostic failure changed the original COM exception identity or HRESULT.'
  }
}
if($null -ne (New-SSEUiStateRootContext $script:window @($script:window,$script:window))){throw 'Ambiguous original frame acquired root authority.'}
Reset-RootFixture;[SyntheticRootAE]::Fail=$false;[SSEUiaTree]::Fail=$true
$fallback=Get-UiSnapshot ([IntPtr]111)
if($fallback.stats.source -cne 'treewalker' -or $script:legacyCalls -ne 1 -or [SSEUiaTree]::Calls -ne 1){throw 'Non-root bulk failure lost its existing legacy snapshot boundary.'}
$legacyDefinition=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Walk-TreeLegacy'},$true))
if($legacyDefinition.Count -ne 1){throw 'Productive legacy snapshot missing.'}
. ([scriptblock]::Create($legacyDefinition[0].Extent.Text))
Reset-RootFixture;[SyntheticRootAE]::Fail=$false;[SyntheticRootAE]::FailAtCall=2;[SSEUiaTree]::Fail=$true
$unexpected=Invoke-RootProbe
if($unexpected -or $script:captured.kind -cne 'uia-root-unavailable' -or [SyntheticRootAE]::Calls -ne 2 -or
  [SSEUiaTree]::Calls -ne 1){throw 'Actual legacy root failure escaped its typed read-only boundary.'}
Reset-RootFixture;$script:SSE_UI_STATE_ROOT_CONTEXT=$null;$failure=Invoke-RootProbe
if(-not $failure -or $script:captured -or [SyntheticRootAE]::Calls -ne 2){throw 'Unbound read lost its existing legacy path or acquired retry authority.'}
Reset-RootFixture;$Op='table_update';$failure=Invoke-RootProbe
if(-not $failure -or $script:captured -or [SyntheticRootAE]::Calls -ne 2){throw 'Other operation root failure acquired read retry authority.'}
Write-Output 'UIA root read: typed same-frame ui_state failure, no poisoned-client retry, changed/write frames remain terminal.'
