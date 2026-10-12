$ErrorActionPreference = 'Stop'

# Execute the production navigation scrolls against a boundary that cannot
# operate a real window or send desktop input.
Add-Type @'
using System;
public static class SW {
  public struct PT { public int X,Y; }
  public static int X=300,Y=400,MouseEvents;
  public static bool Accepted=true,Readable=true,Drift=false,Foreign=false;
  public static bool SetCursorPos(int x,int y) { if(Accepted) { X=x;Y=y; } return Accepted; }
  public static bool GetCursorPos(out PT p) { p=new PT { X=X+(Drift?1:0),Y=Y }; return Readable; }
  public static IntPtr WindowFromPoint(PT p) { return new IntPtr(Foreign?8:7); }
  public static IntPtr GetAncestor(IntPtr hwnd,int flag) { return hwnd; }
  public static int GetWindowThreadProcessId(IntPtr hwnd,out int pid) { pid=hwnd.ToInt64()==7?42:43;return 1; }
  public static void mouse_event(uint flags,uint x,uint y,uint data,IntPtr extra) { MouseEvents++; }
}
'@

$worker = Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($worker,[ref]$null,[ref]$null)
foreach ($name in @('Set-SSECursorPoint','Assert-SSECursorPoint')) {
  $definition = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  },$true))
  if ($definition.Count -ne 1) { throw "Ambiguous cursor function: $name" }
  Invoke-Expression $definition[0].Extent.Text
}
$operations = @{}
foreach ($name in @('tree_top','tree_scroll')) {
  $bodies = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.SwitchStatementAst]
  },$true) | ForEach-Object {
    foreach ($clause in $_.Clauses) {
      if ($clause.Item1 -is [Management.Automation.Language.StringConstantExpressionAst] -and
          $clause.Item1.Value -ceq $name) { $clause.Item2.Extent.Text }
    }
  })
  if ($bodies.Count -ne 1) { throw "Ambiguous production scroll: $name" }
  $operations[$name] = [scriptblock]::Create($bodies[0].Substring(1,$bodies[0].Length-2))
}

function Fail($Message,$Kind) { throw "$Kind`: $Message" }
function Emit($Result) { $script:result=$Result }
function Get-SSEBoundedIntegerArg($Arguments,$Name,$Default,$Min,$Max) { 3 }
function Arg($Arguments,$Name,$Default) { if ($Arguments.ContainsKey($Name)) { $Arguments[$Name] } else { $Default } }
function Resolve-SSEMainWindowDescriptor { @{ hwnd=7 } }
function Test-Canary { @{ ok=$true } }
function Walk-Tree { @{ nodes=@(@{ type='TreeItem';name='Synthetic';on=$true;x=20;y=30;w=160;h=30 }) } }
function Show-SSEWindow { $true }
function Hide-SSETopmost {}
function Get-SSELastInputTick { 123 }
function Set-SSEForegroundLeaseInputCheckpoint {}
function Start-Sleep($Milliseconds) {
  if ($script:driftDuringSettle -and $Milliseconds -eq 100) { [SW]::X++ }
}
function Reset-State {
  [SW]::X=300;[SW]::Y=400;[SW]::MouseEvents=0
  [SW]::Accepted=$true;[SW]::Readable=$true;[SW]::Drift=$false;[SW]::Foreign=$false
  $script:DESKTOP_NAME='';$script:a=@{ direction='down' };$script:result=$null
  $script:driftDuringSettle=$false
}

foreach ($name in @('tree_top','tree_scroll')) {
  Reset-State
  & $operations[$name]
  if ([SW]::MouseEvents -ne 3 -or $script:result.ok -ne $true) {
    throw "$name did not execute exactly the bounded, verified scroll."
  }
  foreach ($failure in @('denied','unreadable','drift','settle-drift','foreign','hidden')) {
    Reset-State
    switch ($failure) {
      'denied' { [SW]::Accepted=$false }
      'unreadable' { [SW]::Readable=$false }
      'drift' { [SW]::Drift=$true }
      'settle-drift' { $script:driftDuringSettle=$true }
      'foreign' { [SW]::Foreign=$true }
      'hidden' { $script:DESKTOP_NAME='synthetic-hidden' }
    }
    $failed=$false
    try { & $operations[$name] } catch { $failed=$true }
    if (-not $failed -or [SW]::MouseEvents -ne 0 -or $script:result) {
      throw "$name sent input or reported success with $failure cursor/window evidence."
    }
  }
}
Write-Output 'Cursor scroll contract: accepted point required; denial, unreadable position, drift and foreign windows stop before input.'
