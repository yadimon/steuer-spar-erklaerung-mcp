$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Worker cannot be parsed.'}
$function=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Click-VerifiedPoint'},$true))
if($function.Count -ne 1){throw 'Expected one real physical click helper.'}
. ([scriptblock]::Create($function[0].Extent.Text))
Add-Type @'
using System;
public static class SW {
 public static int MouseCalls;
 public static IntPtr GetForegroundWindow(){return new IntPtr(111);}
 public static bool IsWindow(IntPtr hwnd){return true;}
 public static void mouse_event(int flags,int x,int y,int data,IntPtr extra){MouseCalls++;}
}
'@
function Fail($Message,$Kind,$Details) {$script:emitCalls++;throw 'SYNTHETIC_TERMINAL_EMIT'}
function Show-SSEWindow { }
function Hide-SSETopmost { }
function Get-SSEPointObstruction { [pscustomobject]@{isBoundTarget=$true} }
function Test-SSELastInputUnchanged { $true }
function Set-SSECursorPoint { $script:pointerMoves++ }
function Start-Sleep { }
$script:SSE_FOREGROUND_LEASE=[pscustomobject]@{lastAcquireRaised=$false}
foreach($throws in @($false,$true)) {
  $script:emitCalls=0;$script:pointerMoves=0;[SW]::MouseCalls=0;$caught=$null
  try {Click-VerifiedPoint ([IntPtr]111) ([pscustomobject]@{x=10;y=10;w=20;h=20}) 10 -RequireForeground -ForegroundAttempts 1 -BeforeClickCheck {$false} -ThrowOnFailure:$throws}
  catch {$caught=$_}
  if(-not $caught -or $script:pointerMoves -ne 1 -or [SW]::MouseCalls -ne 0){throw 'Failed last click proof changed physical action boundaries.'}
  if($throws) {
    if($script:emitCalls -ne 0 -or $caught.Exception.Data['kind'] -cne 'stale'){throw 'Transactional click failure emitted before its owner could reconcile.'}
  } else {
    if($script:emitCalls -ne 1 -or $caught.Exception.Message -cne 'SYNTHETIC_TERMINAL_EMIT'){throw 'Default physical click failure lost its existing terminal contract.'}
  }
}
Write-Output 'verified-point-failure: transaction owners can catch a failed post-pointer proof; default Fail/Emit behavior stays terminal.'
