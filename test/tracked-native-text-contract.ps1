$ErrorActionPreference = 'Stop'

# Run the production commit against deterministic native/UIA boundaries. These
# types cannot send real input or operate a desktop window.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
namespace System.Windows.Automation {
  public sealed class ValueState { public bool IsReadOnly; public string Value; }
  public sealed class ValuePattern {
    public static readonly object Pattern = new object();
    public ValueState Current = new ValueState();
  }
  public sealed class AutomationElement { public static AutomationElement FocusedElement; }
}
namespace System.Windows.Forms {
  public static class SendKeys {
    public static void SendWait(string keys) {
      SW.Events.Add(keys); SW.Tick++;
      if (keys == "^a") SW.Selected=true;
      if (keys == "{BACKSPACE}") { SW.Value.Current.Value = ""; SW.Selected=false; }
    }
  }
}
public sealed class CommitRectangle { public double X=20, Y=30, Width=80, Height=20; }
public sealed class CommitControlType { public string ProgrammaticName = "ControlType.Edit"; }
public sealed class CommitCurrent {
  public CommitRectangle BoundingRectangle = new CommitRectangle();
  public bool HasKeyboardFocus = true;
  public string AutomationId = "bound-field";
  public CommitControlType ControlType = new CommitControlType();
}
public sealed class CommitTarget {
  public CommitCurrent Current = new CommitCurrent();
  public bool TryGetCurrentPattern(object pattern, out object value) { value=SW.Value; return true; }
  public void SetFocus() { }
  public int[] GetRuntimeId() { return new int[] { 7, 1 }; }
}
public static class SW {
  public struct PT { public int X, Y; }
  public static System.Windows.Automation.ValuePattern Value = new System.Windows.Automation.ValuePattern();
  public static List<string> Events = new List<string>();
  public static uint Tick = 1;
  public static IntPtr Foreground = new IntPtr(7);
  public static bool Valid = true, ForeignHit = false, Selected = false, QueuedModel = false;
  public static string Outcome = "success", LastText, Pending="";
  public static bool IsWindow(IntPtr hwnd) { return Valid; }
  public static IntPtr GetForegroundWindow() { return Foreground; }
  public static uint GetWindowThreadProcessId(IntPtr hwnd, out int pid) { pid=hwnd.ToInt64()==7?100:200; return 1; }
  public static IntPtr WindowFromPoint(PT point) { return new IntPtr(ForeignHit?8:7); }
  public static IntPtr GetAncestor(IntPtr hwnd, uint flags) { return hwnd; }
  public static bool SetCursorPos(int x, int y) { Events.Add("cursor"); return true; }
  public static void mouse_event(uint flags, uint x, uint y, uint data, IntPtr extra) { Events.Add("mouse"); }
  public static bool SendUnicodeText(string text) {
    Events.Add("unicode"); LastText+=text; Tick++;
    if (Selected) { Value.Current.Value=""; Pending=""; Selected=false; }
    if (QueuedModel && Outcome=="success") {
      for (int i=0;i<text.Length;i++) {
        if (char.IsHighSurrogate(text[i]) && i+1<text.Length && char.IsLowSurrogate(text[i+1])) {
          Value.Current.Value+=text.Substring(i,2); i++;
        } else { Pending+=text[i]; }
      }
    } else { Value.Current.Value+=Outcome=="success"?text:text.Substring(0,1); }
    if (Outcome=="throw") throw new InvalidOperationException("partial native failure");
    return Outcome=="success";
  }
  public static void FlushModel() { Value.Current.Value+=Pending; Pending=""; }
}
'@

$workerPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'powershell\sse-worker.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$null)
foreach ($name in @('Commit-TrackedValue','New-SSECommitResult','Send-SSETrackedLiteralText')) {
  $definition = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Ambiguous production function: $name" }
  Invoke-Expression $definition[0].Extent.Text
}

function Show-SSEWindow { param($Hwnd) $true }
function Get-LiveElement { param($Hwnd, $Rid, $Aid) $script:target }
function Get-SSELastInputTick { [SW]::Tick }
function Test-SSELastInputUnchanged {
  param($Expected)
  $script:guardChecks++
  ($script:failGuard -ne $script:guardChecks) -and $Expected -eq [SW]::Tick
}
function Set-SSEForegroundLeaseInputCheckpoint { param($Tick, $Point) $script:checkpoints.Add($Tick) }
function Complete-SSEPhysicalSection { param($Hwnd) $script:completed++ }
function Test-SSEScalarEqual { param($Left, $Right) [string]$Left -ceq [string]$Right }
function Start-Sleep { param($Milliseconds) $script:sleeps.Add([int]$Milliseconds); [SW]::FlushModel() }
function Get-SSEWindowClassName { param($Hwnd) 'foreign-test-window' }
function Get-SSEWindowTitleText { param($Hwnd) 'foreign-test-window' }
function Get-SSETextSha256 { param($Text) 'test-fingerprint' }

function Reset-TestState {
  $script:DESKTOP_NAME = ''
  $script:target = New-Object CommitTarget
  $script:node = [pscustomobject]@{ rid='7.1'; aid='bound-field'; x=20; y=30; w=80; h=20 }
  [SW]::Value.Current.Value = 'before'; [SW]::Value.Current.IsReadOnly = $false
  [SW]::Events.Clear(); [SW]::LastText=$null; [SW]::Tick=1
  [SW]::Foreground=[IntPtr]7; [SW]::Valid=$true; [SW]::ForeignHit=$false; [SW]::Outcome='success'
  [SW]::Selected=$false; [SW]::QueuedModel=$false; [SW]::Pending=''
  $script:guardChecks=0; $script:failGuard=0; $script:completed=0
  $script:sleeps = New-Object 'System.Collections.Generic.List[int]'
  $script:checkpoints = New-Object 'System.Collections.Generic.List[uint32]'
}
function Assert-True { param($Condition, $Message) if (-not $Condition) { throw $Message } }

$unicode = -join [char[]]@(0x00e4,0x00d6,0x00df,0x20ac,0x0395,0x03bb,0x03bb,0x0423,0x043a,0x0440,0xd83d,0xde80)
foreach ($text in @('literal +^%~(){}[]', '15.01.2025', '12,34')) {
  Reset-TestState
  $result = Commit-TrackedValue ([IntPtr]7) $script:node $text 'before'
  Assert-True ($result.method -ceq 'verified-keyboard-replace') "Commit failed: $text"
  Assert-True ([SW]::LastText -ceq $text -and [SW]::Value.Current.Value -ceq $text) 'Literal text changed in transport.'
  Assert-True (([SW]::Events -join '|') -ceq '^a|unicode|{TAB}') 'Input was replayed or committed out of order.'
  Assert-True ($result.details.mutationStarted -and $result.details.settledEarly) 'Fresh readback or mutation state missing.'
  Assert-True ($script:completed -eq 1 -and $script:checkpoints.Count -ge 3) 'Physical section/checkpoint ownership changed.'
  Assert-True (($script:sleeps -join ',') -ceq '60,40,60,50') 'Existing guard/settle waits changed.'
}

foreach ($text in @($unicode, ('prefix ' + $unicode + ' suffix'))) {
  Reset-TestState; [SW]::QueuedModel=$true
  $result = Commit-TrackedValue ([IntPtr]7) $script:node $text 'before'
  Assert-True ($result.method -ceq 'verified-keyboard-replace' -and $result.details.settledEarly) 'Queued Unicode input did not settle.'
  Assert-True ([SW]::LastText -ceq $text -and [SW]::Value.Current.Value -ceq $text) 'A synchronous surrogate overtook its queued prefix.'
  Assert-True ([SW]::Events[0] -ceq '^a' -and [SW]::Events[[SW]::Events.Count-1] -ceq '{TAB}') 'Unicode input was committed out of order.'
}

Reset-TestState
$result = Commit-TrackedValue ([IntPtr]7) $script:node '' 'before'
Assert-True ($result.method -ceq 'verified-keyboard-replace' -and [SW]::Value.Current.Value -ceq '') 'Empty text was not deleted and committed.'
Assert-True (([SW]::Events -join '|') -ceq '^a|{BACKSPACE}|{TAB}') 'Empty text must not invoke Unicode transport.'

foreach ($outcome in @('incomplete','throw')) {
  Reset-TestState; [SW]::Outcome=$outcome
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  $expected = $(if ($outcome -ceq 'throw') { 'failed' } else { 'native-input-incomplete' })
  Assert-True ($result.method -ceq $expected -and $result.details.mutationStarted) 'Partial native input was hidden.'
  Assert-True ([SW]::Value.Current.Value -ceq 'r') 'Partial failure fixture did not mutate.'
  Assert-True (([SW]::Events -join '|') -ceq '^a|unicode') 'Unknown native input must not be replayed or followed by TAB.'
  Assert-True ($script:completed -eq 1) 'Failed native transport left its physical section open.'
}

foreach ($guard in @(1,2,3,4)) {
  Reset-TestState; $script:failGuard=$guard
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  Assert-True ($result.interference -and -not [SW]::Events.Contains('unicode')) 'A failed input guard allowed native text.'
  Assert-True ($script:completed -eq 1) 'Failed guard left its physical section open.'
}
foreach ($guard in @(5,6)) {
  Reset-TestState; $script:failGuard=$guard
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  Assert-True ($result.interference -and $result.details.mutationStarted) 'Interference after input lost mutation uncertainty.'
  Assert-True (@([SW]::Events | Where-Object { $_ -ceq 'unicode' }).Count -eq 1) 'Interference replayed text.'
}

foreach ($precondition in @('readonly','changed-value','moved','stale','foreign-hit','wrong-focus','hidden')) {
  Reset-TestState
  switch ($precondition) {
    'readonly' { [SW]::Value.Current.IsReadOnly=$true }
    'changed-value' { [SW]::Value.Current.Value='other' }
    'moved' { $script:target.Current.BoundingRectangle.X=50 }
    'stale' { [SW]::Valid=$false }
    'foreign-hit' { [SW]::ForeignHit=$true }
    'wrong-focus' { $script:target.Current.HasKeyboardFocus=$false }
    'hidden' { $script:DESKTOP_NAME='hidden' }
  }
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  Assert-True ($result.method -cne 'verified-keyboard-replace' -and -not [SW]::Events.Contains('unicode')) "Unsafe native input: $precondition"
}
# Exercise the real receipt failure/rollback blocks, including a transport that
# wrote only a prefix. No rollback may replace an unknown or interfered value.
$failedCommit = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text.Contains('[string]$commit.method') -and
  $node.Extent.Text.Contains('Feldcommit meldete')
}, $true))
$rollback = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Extent.Text.StartsWith('if ($failedField)') -and
  $node.Extent.Text.Contains('cleanupRequired')
}, $true))
Assert-True ($failedCommit.Count -eq 1 -and $rollback.Count -eq 1) 'Receipt rollback production blocks are ambiguous.'
function Get-SSEReceiptManagerLiveEditableField { param($Hwnd, $Binding) $Binding }
function Get-SSEReceiptManagerFieldValue { param($Resolved) [SW]::Value.Current.Value }
function Test-SSEReceiptManagerFieldValue { param($Actual, $Expected, $Kind) [string]$Actual -ceq [string]$Expected }
function Wait-SSEReceiptManagerLiveFieldValue {
  param($Hwnd, $Resolved, $Expected, $Kind, $WaitMs)
  [pscustomobject]@{ ok=([SW]::Value.Current.Value -ceq [string]$Expected) }
}
function Emit { param($Result) $script:emitted=$Result; throw 'receipt-test-emitted' }

foreach ($scenario in @(
  @{ value='r'; interference=$false; cleanup=$true; writes=0 },
  @{ value='external'; interference=$false; cleanup=$true; writes=0 },
  @{ value='before'; interference=$false; cleanup=$false; writes=0 },
  @{ value='requested'; interference=$false; cleanup=$false; writes=1 },
  @{ value='requested'; interference=$true; cleanup=$true; writes=0 }
)) {
  Reset-TestState; [SW]::Value.Current.Value=$scenario.value
  $transactions = @([pscustomobject]@{
    name='title'; kind='text'; before='before'; requested='requested'; changed=$false
    binding=[pscustomobject]@{ node=$script:node }
  })
  $failedField=$null; $failedReason=$null; $uncertainFieldMutation=$false; $failedInputGuard=$false
  $commit = [pscustomobject]@{
    method='native-input-incomplete'; interference=$scenario.interference
    details=[pscustomobject]@{ mutationStarted=$true }
  }
  foreach ($transaction in $transactions) {
    Invoke-Expression $failedCommit[0].Extent.Text
    throw 'Failed native commit did not stop the field transaction.'
  }
  Assert-True ($failedField -ceq 'title' -and $uncertainFieldMutation) 'Failed field was omitted from rollback accounting.'
  $toolHwnd=[IntPtr]7; $mainHwnd=[IntPtr]7; $targetPid=100; $waitMs=3500
  $valuesBefore=[ordered]@{ title='before' }; $requestedValues=[ordered]@{ title='requested' }
  $changedFields=@(); $script:emitted=$null
  try { Invoke-Expression $rollback[0].Extent.Text } catch {
    if ($_.Exception.Message -cne 'receipt-test-emitted') { throw }
  }
  Assert-True ($script:emitted -and -not $script:emitted.verified) 'Partial transport emitted success.'
  Assert-True ($script:emitted.cleanupRequired -eq $scenario.cleanup) 'Partial input cleanup status is inaccurate.'
  Assert-True ($script:emitted.rollback.fields.Count -eq 1) 'Failed field was not independently accounted for.'
  Assert-True (@([SW]::Events | Where-Object { $_ -ceq 'unicode' }).Count -eq $scenario.writes) 'Unsafe rollback wrote an unknown/interfered field.'
}
Write-Output 'Tracked native text: literal transport, readback, guards, partial failures and receipt rollback passed.'
