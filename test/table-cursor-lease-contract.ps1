$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-cursor-lease.ps1')
Add-Type -TypeDefinition @'
using System;
public static class SW {
 public static IntPtr Foreground=new IntPtr(111);
 public static bool IsWindow(IntPtr h){return h.ToInt64()==111||h.ToInt64()==222;}
 public static IntPtr GetForegroundWindow(){return Foreground;}
 public static uint GetWindowThreadProcessId(IntPtr h,ref int pid){pid=h.ToInt64()==111?7:8;return 1;}
 public static bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,int flags){return true;}
}
'@
function Get-Process {param($Id,$ErrorAction) [pscustomobject]@{StartTime=[datetime]'2025-01-01T00:00:00Z'}}
function Get-SSEWindowClassName {'SyntheticCaller'}
function Test-SSELastInputUnchanged($Expected) {$Expected -eq $script:tick}
function Exit-SSEForegroundLease {$script:exitCalls++;$script:SSE_FOREGROUND_LEASE.depth=0}
function New-Lease {
  [pscustomobject]@{watch=$null;depth=0;rootHwnd=0;targetPid=0;previousForeground=0;previousCursor=$null;
    lastOwnedInputTick=$null;lastOwnedInputContext=$null;acquisitions=0;raisedWindows=(New-Object Collections.ArrayList)}
}
$script:tick=10;$script:exitCalls=0;$script:SSE_FOREGROUND_LEASE=New-Lease
$lease=$script:SSE_FOREGROUND_LEASE
$lease.watch=[Diagnostics.Stopwatch]::StartNew();$lease.depth=1;$lease.rootHwnd=111;$lease.targetPid=7
$lease.previousForeground=222;$lease.lastOwnedInputTick=10
$handover=Publish-SSETableCursorLeaseHandover ([IntPtr]111) 7 10
if (-not $handover -or $script:exitCalls -ne 1 -or $handover.previous.start -isnot [string]) {throw 'Handover publication/string identity failed.'}
if ([decimal]$handover.previous.start -le [decimal]9007199254740991) {throw 'Fixture does not cover JSON precision boundary.'}
$json=$handover | ConvertTo-Json -Depth 5 -Compress
if (($json | ConvertFrom-Json).previous.start -cne $handover.previous.start) {throw 'Creation time lost JSON precision.'}
foreach ($case in @('success','input','foreground','nonce','root','pid','start','numeric-start','class')) {
  $candidate=$json | ConvertFrom-Json;$script:tick=10;[SW]::Foreground=[IntPtr]111
  $script:SSE_FOREGROUND_LEASE=New-Lease
  switch ($case) {
    'input' {$script:tick=11}
    'foreground' {[SW]::Foreground=[IntPtr]222}
    'nonce' {$candidate.nonce='unknown'}
    'root' {$candidate.rootHwnd=333}
    'pid' {$candidate.targetPid=9}
    'start' {$candidate.previous.start='133000000000000001'}
    'numeric-start' {$candidate.previous.start=[int64]123456789}
    'class' {$candidate.previous.class='Foreign'}
  }
  $ok=Import-SSETableCursorLease ([IntPtr]111) 7 10 $candidate
  if ($ok -ne ($case -eq 'success')) {throw "$case`: lease authority mismatch."}
  if (-not $ok -and $script:SSE_FOREGROUND_LEASE.watch) {throw 'Failed import installed restoration authority.'}
}
# This test only imports function definitions: no real Worker or native UIA.
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$parseErrors)
if (@($parseErrors).Count) {throw 'Worker PowerShell syntax failed.'}
$descriptor=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-UiaElementDescriptor'},$true))
. ([scriptblock]::Create($descriptor[0].Extent.Text))
foreach ($case in @('positive','negative','unknown','error')) {
  $current=[pscustomobject]@{ControlType=[pscustomobject]@{ProgrammaticName='ControlType.Button'};Name='Synthetic';AutomationId='Synthetic.Button';
    LocalizedControlType='button';IsOffscreen=$false;BoundingRectangle=[pscustomobject]@{X=1;Y=1;Width=10;Height=10};
    IsKeyboardFocusable=$true;HasKeyboardFocus=$true}
  if ($case -eq 'negative') {$current.IsKeyboardFocusable=$false;$current.HasKeyboardFocus=$false}
  if ($case -eq 'unknown') {$current.IsKeyboardFocusable=$null;$current.HasKeyboardFocus='unknown'}
  if ($case -eq 'error') {
    $current.PSObject.Properties.Remove('IsKeyboardFocusable');$current.PSObject.Properties.Remove('HasKeyboardFocus')
    $current | Add-Member ScriptProperty IsKeyboardFocusable {throw 'Synthetic unavailable'}
    $current | Add-Member ScriptProperty HasKeyboardFocus {throw 'Synthetic unavailable'}
  }
  $element=[pscustomobject]@{Current=$current};$element | Add-Member ScriptMethod GetRuntimeId {@(10,1)}
  $result=Get-UiaElementDescriptor $element 0 $false
  $expected=$(if ($case -eq 'positive') {$true} elseif ($case -eq 'negative') {$false} else {$null})
  if ($result.keyboardFocusable -cne $expected -or $result.hasKeyboardFocus -cne $expected) {throw "$case`: probe inferred unproven focus capability."}
}
# The actual import/Emit/release producer must satisfy the consumer's proof.
# All SW calls above and foreground restoration below are synthetic callbacks.
foreach ($name in @('Emit','Enter-SSEForegroundLease','Exit-SSEForegroundLease','Get-SSEForegroundLeaseTelemetry','Get-SSEInputEpochEvidence')) {
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq $name},$true))
  if ($definition.Count -ne 1) {throw "$name`: productive lease helper must be unique."}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
$initializer=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and
  $node.Left.Extent.Text -ceq '$script:SSE_FOREGROUND_LEASE'},$true))
if ($initializer.Count -ne 1) {throw 'Productive foreground lease initializer must be unique.'}
function Get-SSELastInputTick {$script:tick}
function Test-SSEWindowIsLockScreen {$false}
function Set-SSEForegroundWindowCore {param($Window) $script:restores++;[SW]::Foreground=$Window;$true}
$script:SSE_CAPTURE_OPERATION_RESULT=$true;$script:SSE_CAPTURE_SENTINEL='synthetic-lease-result';$script:T0=[Diagnostics.Stopwatch]::StartNew()
foreach ($case in @('resume','nested','failure','input-changed','previous-sse','changed-number-editor','other-editor')) {
  . ([scriptblock]::Create($initializer[0].Extent.Text))
  $script:SSE_CURSOR_LEASE_HANDOVER=$null;$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$case -in @('changed-number-editor','other-editor')
  $script:tick=10;$script:restores=0;[SW]::Foreground=[IntPtr]111
  $candidate=$json | ConvertFrom-Json
  if ($case -eq 'previous-sse') {$candidate.previous=Get-SSETableCursorPreviousWindowIdentity ([IntPtr]111)}
  if (-not (Import-SSETableCursorLease ([IntPtr]111) 7 10 $candidate)) {throw "$case`: synthetic import failed."}
  if ($case -eq 'nested' -and -not (Enter-SSEForegroundLease ([IntPtr]111))) {throw 'Nested imported lease failed.'}
  if ($case -eq 'input-changed') {$script:tick=11}
  $script:SSE_CAPTURED_OPERATION_RESULT=$null
  try {Emit ([pscustomobject]@{ok=$case -ne 'failure';steps=0});throw 'Emit did not stop at capture boundary.'}
  catch {if ($_.Exception.Message -cne $script:SSE_CAPTURE_SENTINEL) {throw}}
  $telemetry=$script:SSE_CAPTURED_OPERATION_RESULT.focusTelemetry
  if (-not $telemetry -or -not $telemetry.releasedByEmit -or $telemetry.releases -ne 1 -or
      $script:SSE_FOREGROUND_LEASE.watch -or $script:SSE_FOREGROUND_LEASE.depth -ne 0) {
    throw "$case`: actual Emit failed its imported-lease completion proof."
  }
  $expectedRestores=$(if ($case -in @('input-changed','previous-sse','changed-number-editor','other-editor')) {0} else {1})
  if ($script:restores -ne $expectedRestores) {throw "$case`: unsafe or missing previous-window restoration."}
  if ($case -eq 'input-changed' -and $telemetry.restoreSkippedReason -cne 'input-changed') {throw 'Changed input lost the restoration guard.'}
  if ($case -in @('changed-number-editor','other-editor') -and
      ($telemetry.foregroundRestored -or $telemetry.restoreSkippedReason -cne 'cursor-source-not-proven-editor-free' -or
       [SW]::Foreground -ne [IntPtr]111)) {throw 'Rejected editor was indirectly committed by a caller-window restore.'}
}
Write-Output 'table-cursor-lease-contract: PASS (synthetic authority/epoch/precision/probe; actual imported lease Emit completion)'
