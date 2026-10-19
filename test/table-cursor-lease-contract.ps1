$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-cursor-lease.ps1')
Add-Type -TypeDefinition @'
using System;
public static class SW {
 public static IntPtr Foreground=new IntPtr(111);
 public static int WindowPosCalls, CursorReadCalls, CursorMoveCalls;
 public struct PT {public int X,Y;}
 public static uint GetDpiForWindow(IntPtr h){return 96;}
 public static int[] GetPhysicalClientOrigin(IntPtr h){return new int[]{100,200};}
 public static bool GetCursorPos(ref PT point){CursorReadCalls++;point.X=9;point.Y=9;return true;}
 public static bool SetCursorPos(int x,int y){CursorMoveCalls++;return true;}
 public static bool IsWindow(IntPtr h){return h.ToInt64()==111||h.ToInt64()==222;}
 public static IntPtr GetForegroundWindow(){return Foreground;}
 public static uint GetWindowThreadProcessId(IntPtr h,ref int pid){pid=h.ToInt64()==111?7:8;return 1;}
 public static bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,int flags){
  WindowPosCalls++;if((flags & 0x10)==0)throw new InvalidOperationException("Lease revoke must not activate a window");return true;}
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
# Execute the actual shared phase preconditions and release/revocation branch.
# The live source proof remains false: revocation must not manufacture passive
# source authority or call the normal foreground/cursor restoration route.
$precondition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text.StartsWith('$null -eq $phaseInputBefore -or')},$true))
$inheritedGuard=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text.StartsWith('-not $inherited -or')},$true))
$releaseBranch=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$cursorPhase -cin @(''native-release'',''native-revoke-noop'',''native-step'') -or ($cursorPhase -ceq ''resume'' -and $cursorPlan.lease)'},$true))
if($precondition.Count -ne 1 -or $inheritedGuard.Count -ne 1 -or $releaseBranch.Count -ne 1){throw 'Actual revoke guards or release dispatcher are absent or ambiguous.'}
$releaseText=$releaseBranch[0].Extent.Text
$preserveAt=$releaseText.IndexOf("if (`$cursorPhase -ceq 'native-revoke-noop') {`$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=`$true}",[StringComparison]::Ordinal)
$importAt=$releaseText.IndexOf('Import-SSETableCursorLease',[StringComparison]::Ordinal)
if($preserveAt -lt 0 -or $importAt -le $preserveAt -or
    -not $releaseText.Contains('cursorLeaseRevoked=$true') -or
    -not $releaseText.Contains('Test-SSETableFocusedSource')){throw 'Revoke fencing or the normal source guard changed.'}
$reset=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and
  $node.Extent.Text -ceq '$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS = $false'},$true))
if($reset.Count -ne 1){throw 'The single-job worker no longer initializes its preserve flag explicitly.'}
. ([scriptblock]::Create('function Invoke-SyntheticNativeRelease {'+"`n"+$precondition[0].Extent.Text+"`n"+
  $inheritedGuard[0].Extent.Text+"`n"+$releaseBranch[0].Extent.Text+"`n"+'}'))
function Fail {param($Message,$Kind,$Metadata) $script:revokeRejections++;throw [InvalidOperationException]::new('synthetic-revoke-rejected')}
function Test-SSETableFocusedSource {$script:sourceProofCalls++;$false}
function Test-SSETableCursorPhaseEditorAuthority {$script:editorAuthority}
function Test-SSETableReadSnapshotBinding {param($Before,$After,[switch]$BeforeNavigation) $script:snapshotUnchanged}
function Get-SSEWindowTitleText {'Synthetic case'}
foreach($case in @('normal-unbound-source','revoke-unbound-source','input-changed','foreground-changed','nonce-invalid',
    'previous-identity-changed','root-changed','pid-changed','window-set-changed','dirty-changed','title-changed',
    'dpi-changed','origin-changed','snapshot-changed','editor-present','incomplete-snapshot','aux-window')) {
  . ([scriptblock]::Create($initializer[0].Extent.Text))
  $script:SSE_CURSOR_LEASE_HANDOVER=$null;$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false
  $script:tick=10;$script:restores=0;$script:sourceProofCalls=0;$script:revokeRejections=0
  $script:editorAuthority=$true;$script:snapshotUnchanged=$true;[SW]::Foreground=[IntPtr]111
  [SW]::WindowPosCalls=0;[SW]::CursorReadCalls=0;[SW]::CursorMoveCalls=0
  $hwnd=[IntPtr]111;$main=[pscustomobject]@{pid=7};$phaseInputBefore=10;$dirtyBefore=$true
  $cursorPhase=$(if($case -ceq 'normal-unbound-source'){'native-release'}else{'native-revoke-noop'})
  $candidate=$json | ConvertFrom-Json
  $candidate.previousCursor=[pscustomobject]@{x=1;y=2}
  $inherited=[pscustomobject]@{hwnd=111;pid=7;dirty=$true;windowTitle='Synthetic case';inputEpoch=10;
    windowFingerprint='Synthetic.Stable';dpi=96;clientOrigin=@(100,200);snapshot=[pscustomobject]@{}}
  $cursorPlan=[pscustomobject]@{binding=$inherited;lease=$candidate}
  $phaseWindows=[pscustomobject]@{fingerprint='Synthetic.Stable';windows=@([pscustomobject]@{role='main'})}
  $erst=[pscustomobject]@{navigationBinding=[pscustomobject]@{complete=$true;tableRootAid='Synthetic.Table';tableRootRid='42.1';editorFree=$true};
    cursorAnchorIsNumber=$true;tabelleAnzahl=1}
  $latestTableSnapshot=[pscustomobject]@{tree=$null}
  switch($case){
    'input-changed' {$script:tick=11}
    'foreground-changed' {[SW]::Foreground=[IntPtr]222}
    'nonce-invalid' {$candidate.nonce='invalid'}
    'previous-identity-changed' {$candidate.previous.class='OtherCaller'}
    'root-changed' {$inherited.hwnd=333}
    'pid-changed' {$inherited.pid=9}
    'window-set-changed' {$phaseWindows.fingerprint='Other.Set'}
    'dirty-changed' {$dirtyBefore=$false}
    'title-changed' {$inherited.windowTitle='Other title'}
    'dpi-changed' {$inherited.dpi=144}
    'origin-changed' {$inherited.clientOrigin=@(101,200)}
    'snapshot-changed' {$script:snapshotUnchanged=$false}
    'editor-present' {$script:editorAuthority=$false}
    'incomplete-snapshot' {$erst.navigationBinding.complete=$false}
    'aux-window' {$phaseWindows.windows+=,[pscustomobject]@{role='unknown'}}
  }
  $script:SSE_CAPTURED_OPERATION_RESULT=$null
  $script:SSE_FOREGROUND_LEASE.ownedCursorPoint=[pscustomobject]@{x=9;y=9}
  try {Invoke-SyntheticNativeRelease;throw 'Actual release branch did not terminate.'}
  catch {if($_.Exception.Message -cnotin @($script:SSE_CAPTURE_SENTINEL,'synthetic-revoke-rejected')){throw}}
  $success=$case -ceq 'revoke-unbound-source'
  if($success){
    $result=$script:SSE_CAPTURED_OPERATION_RESULT;$telemetry=$result.focusTelemetry
    if(-not $result.ok -or -not $result.cursorLeaseRevoked -or $result.cursorLeaseReleased -or $result.physicalInputUsed -or $result.steps -ne 0 -or
       -not $telemetry.releasedByEmit -or $telemetry.foregroundRestored -or $telemetry.cursorRestored -or
       $telemetry.restoreSkippedReason -cne 'cursor-source-not-proven-editor-free' -or
       $script:SSE_FOREGROUND_LEASE.watch -or $script:SSE_FOREGROUND_LEASE.depth -ne 0 -or [SW]::WindowPosCalls -ne 1){
      throw 'Actual no-op revocation did not release authority while preserving the current source.'
    }
  }elseif($script:revokeRejections -ne 1 -or $script:SSE_CAPTURED_OPERATION_RESULT -or
      $script:SSE_FOREGROUND_LEASE.watch -or [SW]::WindowPosCalls){throw "$case`: invalid revoke reached authority or window mutation."}
  if($script:sourceProofCalls -ne $(if($case -ceq 'normal-unbound-source'){1}else{0})){throw 'Normal source guard changed or revocation reused it.'}
  if($script:restores -or [SW]::CursorReadCalls -or [SW]::CursorMoveCalls){throw 'No-op revocation activated/restored a source or moved the cursor.'}
}
# A failure after successful import must still use the already installed fence.
# Exercise the productive Fail -> Emit -> Exit chain, not a synthetic cleanup.
$productiveFail=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -ceq 'Fail'},$true))
if($productiveFail.Count -ne 1){throw 'Productive Fail must remain unique.'}
. ([scriptblock]::Create($productiveFail[0].Extent.Text))
. ([scriptblock]::Create($initializer[0].Extent.Text))
$script:SSE_CURSOR_LEASE_HANDOVER=$null;$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true
$script:tick=10;$script:restores=0;[SW]::Foreground=[IntPtr]111
[SW]::WindowPosCalls=0;[SW]::CursorReadCalls=0;[SW]::CursorMoveCalls=0
$candidate=$json | ConvertFrom-Json;$script:SSE_CAPTURED_OPERATION_RESULT=$null
if(-not (Import-SSETableCursorLease ([IntPtr]111) 7 10 $candidate)){throw 'Post-import failure fixture could not import its exact lease.'}
try{Fail 'Synthetic failure after guarded import' 'interference';throw 'Productive Fail did not terminate.'}
catch{if($_.Exception.Message -cne $script:SSE_CAPTURE_SENTINEL){throw}}
$failed=$script:SSE_CAPTURED_OPERATION_RESULT
if($failed.ok -or -not $failed.focusTelemetry.releasedByEmit -or $failed.focusTelemetry.foregroundRestored -or
  $failed.focusTelemetry.restoreSkippedReason -cne 'cursor-source-not-proven-editor-free' -or
  $script:SSE_FOREGROUND_LEASE.watch -or $script:SSE_FOREGROUND_LEASE.depth -ne 0 -or
  $script:restores -or [SW]::CursorReadCalls -or [SW]::CursorMoveCalls -or [SW]::WindowPosCalls -ne 1){
  throw 'Productive post-import failure lost its no-restore fence.'
}
Write-Output 'table-cursor-lease-contract: PASS (actual imported lease Emit; guarded no-op revoke without focus or cursor input)'
