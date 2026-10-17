$ErrorActionPreference='Stop'
$workerPath=Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($workerPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Worker cannot be parsed.'}
$assignments=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
  $node.Left.Extent.Text -ceq '$readNavigationGuard'
},$true))
if($assignments.Count -ne 1){throw 'Expected one production navigation guard.'}
. ([scriptblock]::Create($assignments[0].Extent.Text))
Add-Type @'
using System;
public static class SW {
  public static IntPtr GetForegroundWindow() { return new IntPtr(111); }
  public static int GetWindowThreadProcessId(IntPtr hwnd,out int pid) { pid=7;return 1; }
  public static uint GetDpiForWindow(IntPtr hwnd) { return 96; }
}
'@
function Get-SSEInteractionWindowSet { [pscustomobject]@{fingerprint='same'} }
function Get-DirtyStateFast { $false }
function Get-CurrentHeading { 'Synthetic' }
function Get-SSELastInputTick { 10 }
function Test-SSELastInputUnchanged($Tick) { $Tick -eq 10 }
function Get-SSETableLiveInputState { [pscustomobject]@{ok=$true} }
function Test-SSETableReadKeyboardTarget {
  param($Window,$ProcessId,$Snapshot,[ref]$FailureEvidence,$Tree=$null)
  $script:keyboardChecks++
  $script:receivedTree=$Tree
  if($Window -ne [IntPtr]111 -or $ProcessId -ne 7 -or $Snapshot -ne $script:boundSnapshot){
    throw 'Navigation guard lost its target identity.'
  }
  # A known UIA Nr. delegate is insufficient for a private native model proof.
  if($script:focusedSource -ceq 'uia-number-editor') { return $null -ne $Tree }
  $true
}
$hwnd=[IntPtr]111;$targetPid=7;$dirtyBefore=$false
$tree=[pscustomobject]@{identity='synthetic-uia-tree'}
$latestTableSnapshot=[pscustomobject]@{tree=$tree}
$script:boundSnapshot=[pscustomobject]@{navigationBinding=[pscustomobject]@{
  editorFree=$true;heading='Synthetic';tableRootAid='Synthetic.Table';tableRootRid='1.1'
}}
$erst=$script:boundSnapshot
$cursorPlan=[pscustomobject]@{binding=[pscustomobject]@{dpi=96}}
foreach($phase in @('','native-acquire','native-position-acquire','activate','native-step','resume')) {
  foreach($source in @('bound-model-cursor','uia-number-editor')) {
    $cursorPhase=$phase;$script:focusedSource=$source
    $script:keyboardChecks=0;$script:receivedTree='not-called'
    $navigationState=[pscustomobject]@{phase='';failure=$null;tick=10;
      windows=[pscustomobject]@{fingerprint='same'};snapshot=$script:boundSnapshot}
    $accepted=& $readNavigationGuard 'synthetic-keyboard-boundary' -RequireKeyboard
    $expected=[bool](-not $phase -or $source -ceq 'bound-model-cursor')
    if($accepted -ne $expected -or $script:keyboardChecks -ne 1){
      throw "$phase / $source`: wrong keyboard proof domain or call count."
    }
    if($phase -and $null -ne $script:receivedTree){throw "$phase`: private cursor received the UIA-only Nr. editor proof."}
    if(-not $phase -and $script:receivedTree -ne $tree){throw 'Standard cursor lost its exact UIA tree.'}
    if([bool]$navigationState.failure -ne (-not $expected)){throw "$phase / $source`: missing failure evidence."}
  }
}
Write-Output 'table-read-keyboard-boundary: standard UIA Nr. proof cannot authorize private native cursor phases.'
