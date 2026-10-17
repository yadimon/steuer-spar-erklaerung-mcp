$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Worker cannot be parsed.'}
foreach($functionName in @('Get-UiSnapshot','Walk-BoundTree')) {
  $functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $functionName},$true))
  if($functions.Count -ne 1){throw "Expected one production $functionName function."}
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
Add-Type @'
using System;
public static class SyntheticRoot {
  public static bool ThrowRoot,MissingRoot;
  public static object FromHandle(IntPtr hwnd) {
    if(ThrowRoot) throw new Exception("Synthetic root provider failure");
    return MissingRoot ? null : new object();
  }
}
public static class SSEUiaTree {
  public static object Result;
  public static int WholeCalls, ScopedCalls;
  public static bool ThrowScoped;
  public static object Describe(IntPtr hwnd,int nodes,int ms,int depth,bool values,bool scroll) { WholeCalls++;return Result; }
  public static object DescribeElement(object root,int nodes,int ms,int depth,bool values,bool scroll) {
    ScopedCalls++;
    if(ThrowScoped) throw new Exception("Synthetic scoped provider failure");
    return Result;
  }
}
'@
$AE=[SyntheticRoot];$Op='synthetic-depth-proof'
function ConvertTo-SSESnapshotNodes($Nodes) { ,@($Nodes) }
function Walk-TreeLegacy { $script:legacyCalls++;throw 'Unexpected legacy read.' }
function Split-SSEWindowScope($Nodes) { [pscustomobject]@{own=@($Nodes);foreign=@()} }
foreach($limited in @($false,$true)) {
  foreach($scoped in @($false,$true)) {
    [SSEUiaTree]::WholeCalls=0;[SSEUiaTree]::ScopedCalls=0
    [SSEUiaTree]::Result=[pscustomobject]@{Nodes=@([pscustomobject]@{i=0;p=-1;type='Window'});
      NodeCount=1;WalkErrors=0;CycleHits=0;CycleRuntimeId='';Truncated=$false;
      DepthLimited=$limited;ValueErrors=0;ScrollErrors=0}
    $rootElement=$(if($scoped){[pscustomobject]@{identity='synthetic-root'}}else{$null})
    $snapshot=Get-UiSnapshot ([IntPtr]111) -RootElement $rootElement
    if($snapshot.stats.depthLimited -isnot [bool] -or $snapshot.stats.depthLimited -ne $limited){
      throw 'Snapshot omitted or changed the actual native depth-limit evidence.'
    }
    if([SSEUiaTree]::WholeCalls -ne [int](-not $scoped) -or [SSEUiaTree]::ScopedCalls -ne [int]$scoped){
      throw 'Snapshot changed its existing full/scoped dispatch.'
    }
  }
}
foreach($failure in @('none','root-provider','missing-root','scoped-provider')) {
  $script:legacyCalls=0;[SSEUiaTree]::WholeCalls=0;[SSEUiaTree]::ScopedCalls=0
  [SyntheticRoot]::ThrowRoot=$failure -ceq 'root-provider'
  [SyntheticRoot]::MissingRoot=$failure -ceq 'missing-root'
  [SSEUiaTree]::ThrowScoped=$failure -ceq 'scoped-provider'
  $caught=$null;$strictResult=$null
  try {$strictResult=Walk-BoundTree ([IntPtr]111) -WithValues -Strict} catch {$caught=$_}
  if($script:legacyCalls -ne 0 -or [SSEUiaTree]::WholeCalls -ne 0){throw "$failure`: strict preparation retried another provider route."}
  if($failure -ceq 'none') {
    if($caught -or -not $strictResult.stats.depthLimited -or [SSEUiaTree]::ScopedCalls -ne 1){throw 'Strict bound read lost scoped depth evidence.'}
  } else {
    if(-not $caught -or $strictResult){throw "$failure`: strict provider failure did not propagate."}
    $expectedScoped=[int]($failure -ceq 'scoped-provider')
    if([SSEUiaTree]::ScopedCalls -ne $expectedScoped){throw "$failure`: wrong strict provider call count."}
  }
}
Write-Output 'ui-snapshot-depth: whole-window and scoped reads preserve true and false native depth-limit evidence.'
Write-Output 'Strict bound snapshots never retry whole-window or legacy providers after root/scoped failure.'
