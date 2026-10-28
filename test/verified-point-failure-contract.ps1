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
 public static int MouseCalls,CloseSends;
 public static int CursorSets,CursorReads,CursorX,CursorY,CursorDriftRead;
 public static bool CursorSetAllowed=true,CursorReadAllowed=true;
 public struct PT {public int X,Y;}
 public static bool SetCursorPos(int x,int y){CursorSets++;if(!CursorSetAllowed)return false;CursorX=x;CursorY=y;return true;}
 public static bool GetCursorPos(out PT point){CursorReads++;point=new PT {X=CursorX+(CursorReads==CursorDriftRead?1:0),Y=CursorY};return CursorReadAllowed;}
 public static uint Tick=10;
 public static System.Collections.Generic.Dictionary<long,uint> Owners=new System.Collections.Generic.Dictionary<long,uint>{{111,7},{77,7},{88,8}};
 public static IntPtr GetForegroundWindow(){return new IntPtr(111);}
 public static bool IsWindow(IntPtr hwnd){return Owners.ContainsKey(hwnd.ToInt64());}
 public static uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid){Owners.TryGetValue(hwnd.ToInt64(),out pid);return pid==0?0u:1u;}
 public static void mouse_event(int flags,int x,int y,int data,IntPtr extra){MouseCalls++;if(flags==4)Tick++;}
 public static IntPtr SendMessageTimeout(IntPtr hwnd,int message,IntPtr w,IntPtr l,int flags,int timeout,out IntPtr result){CloseSends++;result=IntPtr.Zero;return new IntPtr(1);}
}
public static class SSEAccessible {
 public static long LastWindow;
 public static object DescribeDocumentHit(long hwnd,int x,int y){LastWindow=hwnd;throw new InvalidOperationException("Synthetic bound point read failure.");}
}
'@
function Fail($Message,$Kind,$Details) {$script:emitCalls++;throw 'SYNTHETIC_TERMINAL_EMIT'}
function Show-SSEWindow { $script:showCalls++ }
function Hide-SSETopmost([IntPtr]$Window) {
 if($Window -ne [IntPtr]111){throw 'Topmost cleanup lost its exact bound window'}
 $script:hiddenTopmost++
}
function Get-SSEPointObstruction { [pscustomobject]@{isBoundTarget=$true} }
function Get-SSELastInputTick {[SW]::Tick}
function Set-SSEForegroundLeaseInputCheckpoint {if($script:foreignAfterClick){[SW]::Tick++}}
function Assert-SSECursorPoint {}
$inputGuard=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-SSELastInputUnchanged'},$true))
if($inputGuard.Count -ne 1){throw 'Actual input guard missing'}
. ([scriptblock]::Create($inputGuard[0].Extent.Text))
function Set-SSECursorPoint { $script:pointerMoves++ }
function Start-Sleep { }
$script:SSE_FOREGROUND_LEASE=[pscustomobject]@{lastAcquireRaised=$false}
$script:showCalls=0;$script:emitCalls=0;$script:pointerMoves=0;[SW]::MouseCalls=0;[SW]::Tick=11;$caught=$null
try{Click-VerifiedPoint ([IntPtr]111) ([pscustomobject]@{x=10;y=10;w=20;h=20}) 10 -RequireForeground -ThrowOnFailure|Out-Null}catch{$caught=$_}
if(-not $caught -or $caught.Exception.Data['kind'] -cne 'interference' -or $caught.Exception.Data['inputDispatched'] -ne $false -or
   $script:showCalls -ne 0 -or $script:pointerMoves -ne 0 -or [SW]::MouseCalls -ne 0 -or $script:emitCalls -ne 0){throw 'Lost inherited input was discovered only after raising the click target or moving the pointer'}
[SW]::Tick=10
foreach($throws in @($false,$true)) {
  $script:emitCalls=0;$script:pointerMoves=0;[SW]::MouseCalls=0;$caught=$null
  try {Click-VerifiedPoint ([IntPtr]111) ([pscustomobject]@{x=10;y=10;w=20;h=20}) 10 -RequireForeground -ForegroundAttempts 1 -BeforeClickCheck {$false} -ThrowOnFailure:$throws}
  catch {$caught=$_}
  if(-not $caught -or $script:pointerMoves -ne 1 -or [SW]::MouseCalls -ne 0){throw 'Failed last click proof changed physical action boundaries.'}
  if($throws) {
    if($script:emitCalls -ne 0 -or $caught.Exception.Data['kind'] -cne 'stale' -or $caught.Exception.Data['inputDispatched'] -ne $false){throw 'Transactional click failure emitted before its owner could reconcile or invented dispatched input.'}
  } else {
    if($script:emitCalls -ne 1 -or $caught.Exception.Message -cne 'SYNTHETIC_TERMINAL_EMIT'){throw 'Default physical click failure lost its existing terminal contract.'}
  }
}
Write-Output 'verified-point-failure: transaction owners can catch a failed post-pointer proof; default Fail/Emit behavior stays terminal.'
$script:foreignAfterClick=$true;$script:emitCalls=0;[SW]::MouseCalls=0;[SW]::Tick=10;$caught=$null
try{Click-VerifiedPoint ([IntPtr]111) ([pscustomobject]@{x=10;y=10;w=20;h=20}) 10 -RequireForeground -ThrowOnFailure|Out-Null}catch{$caught=$_}
if(-not $caught -or $caught.Exception.Data['kind'] -cne 'interference' -or $caught.Exception.Data['inputDispatched'] -ne $true -or [SW]::MouseCalls -ne 2 -or $script:emitCalls -ne 0){throw 'Post-click interference lost dispatched input evidence or replayed the click'}
$script:foreignAfterClick=$false;[SW]::Tick=10

$script:emitCalls=0;$script:pointerMoves=0;$script:hiddenTopmost=0;[SW]::MouseCalls=0;$caught=$null
try {Click-VerifiedPoint ([IntPtr]111) ([pscustomobject]@{x=10;y=10;w=20;h=20;source='msaa-point';name='Synthetic button'}) -RequireForeground -ThrowOnFailure}
catch {$caught=$_}
if(-not $caught -or $caught.Exception.Data['kind'] -cne 'stale' -or $script:emitCalls -ne 0 -or $script:hiddenTopmost -ne 1 -or
   $script:pointerMoves -ne 0 -or [SW]::MouseCalls -ne 0 -or [SSEAccessible]::LastWindow -ne 111){
 throw 'Throwing bound MSAA read lost stale/cleanup semantics or sent physical input.'
}
$script:emitCalls=0;$script:pointerMoves=0;$script:hiddenTopmost=0;[SW]::MouseCalls=0;$caught=$null
try {Click-VerifiedPoint ([IntPtr]111) ([pscustomobject]@{x=10;y=10;w=20;h=20;source='msaa-point';name='Synthetic button'}) -RequireForeground}
catch {$caught=$_}
if(-not $caught -or $caught.Exception.Message -cne 'SYNTHETIC_TERMINAL_EMIT' -or $script:emitCalls -ne 1 -or
   $script:hiddenTopmost -ne 1 -or $script:pointerMoves -ne 0 -or [SW]::MouseCalls -ne 0){
 throw 'Default bound MSAA failure bypassed terminal cleanup.'
}
Write-Output 'verified-point-failure: throwing bound MSAA reads are stale, remove topmost and send no input.'

# Exercise the actual two cursor helpers as well as the actual click. These
# pre-dispatch failures must remain catchable by their transaction owner;
# the default direct Fail/Emit behavior stays terminal.
& {
 foreach($name in @('Set-SSECursorPoint','Assert-SSECursorPoint')){
  $definition=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if($definition.Count -ne 1){throw 'Actual cursor helper missing'}
  . ([scriptblock]::Create($definition[0].Extent.Text))
 }
 foreach($scenario in @(
  [pscustomobject]@{name='set-refused';set=$false;read=$true;drift=0;reads=0},
  [pscustomobject]@{name='read-unavailable';set=$true;read=$false;drift=0;reads=1},
  [pscustomobject]@{name='initial-drift';set=$true;read=$true;drift=1;reads=1},
  [pscustomobject]@{name='final-drift';set=$true;read=$true;drift=2;reads=2}
 )){
  foreach($throws in @($false,$true)){
   [SW]::Tick=10;[SW]::MouseCalls=0;[SW]::CursorSets=0;[SW]::CursorReads=0
   [SW]::CursorSetAllowed=$scenario.set;[SW]::CursorReadAllowed=$scenario.read;[SW]::CursorDriftRead=$scenario.drift
   $script:emitCalls=0;$script:hiddenTopmost=0;$caught=$null
   try{Click-VerifiedPoint ([IntPtr]111) ([pscustomobject]@{x=10;y=10;w=20;h=20}) 10 -RequireForeground -ThrowOnFailure:$throws|Out-Null}catch{$caught=$_}
   if(-not$caught -or [SW]::MouseCalls -ne 0 -or [SW]::CursorSets -ne 1 -or [SW]::CursorReads -ne $scenario.reads){throw ('Actual cursor refusal crossed the dispatch boundary: '+$scenario.name)}
   if($throws){
    if($script:emitCalls -ne 0 -or $script:hiddenTopmost -ne 1 -or $caught.Exception.Data['kind'] -cne 'interference' -or $caught.Exception.Data['inputDispatched'] -ne $false){throw ('Actual cursor refusal escaped its owner or lost unsent evidence: '+$scenario.name)}
   }else{
    if($script:emitCalls -ne 1 -or $caught.Exception.Message -cne 'SYNTHETIC_TERMINAL_EMIT'){throw ('Default cursor refusal stopped being terminal: '+$scenario.name)}
   }
  }
 }
 foreach($helper in @('Set-SSECursorPoint','Assert-SSECursorPoint')){
  [SW]::CursorSetAllowed=$false;[SW]::CursorReadAllowed=$false
  [SW]::MouseCalls=0;$script:emitCalls=0;$script:returningCallbackCalls=0;$caught=$null
  try{
   & $helper 20 20 -OnFailure {$script:returningCallbackCalls++;return}
   [SW]::mouse_event(2,0,0,0,[IntPtr]::Zero)
  }catch{$caught=$_}
  if(-not$caught -or $caught.Exception.Message -cne 'SYNTHETIC_TERMINAL_EMIT' -or $script:emitCalls -ne 1 -or $script:returningCallbackCalls -ne 1 -or [SW]::MouseCalls -ne 0){throw ('Returning failure callback disabled the terminal cursor guard: '+$helper)}
 }
}
Write-Output 'verified-point-failure: actual cursor refusal/read/drift helpers preserve unsent transaction evidence and default terminal behavior.'

foreach($name in @('Test-SSEDialogWindowCurrent','Get-SSEDialogFollowupInventory')){
 $definition=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
 if($definition.Count -ne 1){throw 'Expected real dialog isolation helper missing.'}
 Invoke-Expression $definition[0].Extent.Text
}
if(-not(Test-SSEDialogWindowCurrent ([pscustomobject]@{pid=7;hwnd=77}) 7) -or
   (Test-SSEDialogWindowCurrent ([pscustomobject]@{pid=7;hwnd=88}) 7) -or
   (Test-SSEDialogWindowCurrent ([pscustomobject]@{pid=7;hwnd=99}) 7) -or
   (Test-SSEDialogWindowCurrent ([pscustomobject]@{pid=7;hwnd=0}) 7) -or
   (Test-SSEDialogWindowCurrent ([pscustomobject]@{pid=8;hwnd=88}) 7)){
 throw 'Live dialog ownership accepted a vanished/reused/foreign HWND or lost the target.'
}
& {
 $reads=New-Object Collections.ArrayList
 function Get-DialogDescriptor($Window,$MainHwnd) {
  if($Window.pid -ne 7 -or $Window.hwnd -ne 77 -or [int64]$MainHwnd -ne 111){throw 'Foreign or unbound descriptor read.'}
  $null=$reads.Add($Window.pid)
  [pscustomobject]@{pid=7;hwnd=77;cls='QtSynthetic';title='Synthetic own child';kind='qt-dialog';buttons=@();texts=@();fingerprint='synthetic';uiaReadOk=$true;uiaError=$null;msaaReadOk=$false;msaaError=$null;tree='must-not-leak'}
 }
 $windows=@([pscustomobject]@{pid=7;hwnd=77;hung=$false},[pscustomobject]@{pid=8;hwnd=88;hung=$true},
  [pscustomobject]@{pid=7;hwnd=88;hung=$true},[pscustomobject]@{pid=7;hwnd=99;hung=$false})
 $state=Get-SSEDialogFollowupInventory $windows @{} 7 ([IntPtr]111)
 if(-not$state.complete -or $reads.Count -ne 1 -or $state.dialogs.Count -ne 1 -or $state.dialogs[0].pid -ne 7 -or
    $state.dialogs[0].PSObject.Properties['tree'] -or $state.unreadableWindows.Count -ne 0){throw 'Followups mixed peer state or leaked an unprojected descriptor.'}
 $state=Get-SSEDialogFollowupInventory $windows @{([int64]77)=$true} 7 ([IntPtr]111)
 if(-not$state.complete -or $state.dialogs.Count -ne 0 -or $reads.Count -ne 1){throw 'An old window was read as a new followup.'}
}
& {
 function Get-DialogDescriptor {throw 'Known hung own child must not be deeply read.'}
 $state=Get-SSEDialogFollowupInventory @([pscustomobject]@{pid=7;hwnd=77;hung=$true}) @{} 7 ([IntPtr]111)
 if($state.complete -or $state.dialogs.Count -ne 0 -or $state.unreadableWindows.Count -ne 1){throw 'Known hung own followup was hidden or claimed complete.'}
}
& {
 function Get-DialogDescriptor($Window,$MainHwnd) {
  [pscustomobject]@{pid=7;hwnd=77;kind='qt-dialog';fingerprint=$null;msaaError='Synthetic.Type';uiaError=$null;msaaReadOk=$false}
 }
 $state=Get-SSEDialogFollowupInventory @([pscustomobject]@{pid=7;hwnd=77;hung=$false}) @{} 7 ([IntPtr]111)
 if($state.complete -or $state.dialogs.Count -ne 1 -or $state.unreadableWindows.Count -ne 1){throw 'A partial followup was lost, duplicated or claimed complete.'}
}
& {
 function Get-DialogDescriptor($Window,$MainHwnd) {
  $null=[SW]::Owners.Remove(77)
  [pscustomobject]@{pid=7;hwnd=77;kind='other';fingerprint=$null;msaaError='Synthetic.Type';uiaError=$null;msaaReadOk=$false}
 }
 $state=Get-SSEDialogFollowupInventory @([pscustomobject]@{pid=7;hwnd=77;hung=$false}) @{} 7 ([IntPtr]111)
 if(-not$state.complete -or $state.dialogs.Count -ne 0 -or $state.unreadableWindows.Count -ne 0){throw 'A vanished followup poisoned the current own state.'}
 [SW]::Owners[77]=7
}
Write-Output 'dialog-followups: live own HWNDs only, peer/hung/stale isolation, partial state and projected data verified.'

$workerSource=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'))
$answerStart=$workerSource.IndexOf("  'dialog_answer' {")
$readbackStart=$workerSource.IndexOf('    $recoveryBindingModeAfter = $null',$answerStart)
$readbackEnd=$workerSource.IndexOf('    $dirtyAfter =',$readbackStart)
if($readbackStart -le $answerStart -or $readbackEnd -le $readbackStart){throw 'Real recovery/followup readback chunk missing.'}
$readback=[scriptblock]::Create($workerSource.Substring($readbackStart,$readbackEnd-$readbackStart))
& {
 $trace=New-Object Collections.ArrayList
 $isRecoveryPrompt=$true;$recoveryFileLess=$false;$closed=$true;$buttonName='Nein';$method='synthetic'
 $dialog=[pscustomobject]@{pid=7;hwnd=77};$windowsAfter=@([pscustomobject]@{pid=7;hwnd=111;title='Synthetic own case'})
 $beforeHandles=@{};$mainBeforeHwnd=[IntPtr]111;$expectedCasePath='synthetic-case';$expectedCaseHash='synthetic-hash'
 $state=[pscustomobject]@{result=$null};$sentinel=[OperationCanceledException]::new('Synthetic terminal Emit.')
 function Get-SSEMainWindowCandidates($Windows){$Windows}
 function Test-CaseBinding {[pscustomobject]@{ok=$true;mode='exact-command-line'}}
 function Get-Sha256 {$null=$trace.Add('hash');'synthetic-hash'}
 function Get-SSEDialogFollowupInventory {$null=$trace.Add('followups');[pscustomobject]@{complete=$false;dialogs=@();unreadableWindows=@()}}
 function Emit($Result){$null=$trace.Add('emit');$state.result=$Result;throw $sentinel}
 try{& $readback;throw 'Missing terminal incomplete readback.'}catch{if(-not[object]::ReferenceEquals($_.Exception,$sentinel)){throw}}
 if(($trace -join ',') -cne 'hash,followups,emit' -or -not$state.result.caseHashUnchanged -or
    $state.result.caseBindingModeAfter -cne 'exact-command-line' -or $state.result.answered -cne 'Nein' -or $state.result.newDialogsComplete){
  throw 'Partial recovery answer lost its original-file hash/binding readback or action state.'
 }
}
& {
 $trace=New-Object Collections.ArrayList
 $isRecoveryPrompt=$true;$recoveryFileLess=$true;$closed=$true;$buttonName='Nein';$method='synthetic'
 $dialog=[pscustomobject]@{pid=7;hwnd=77};$windowsAfter=@([pscustomobject]@{pid=7;hwnd=111;title='Synthetic file-less start'})
 $beforeHandles=@{};$mainBeforeHwnd=[IntPtr]111
 $state=[pscustomobject]@{result=$null};$sentinel=[OperationCanceledException]::new('Synthetic terminal Emit.')
 function Get-SSEMainWindowCandidates($Windows){$Windows}
 function Test-CaseBinding {throw 'File-less recovery must not invent file binding.'}
 function Get-Sha256 {throw 'File-less recovery must not invent file reads.'}
 function Get-SSEDialogFollowupInventory {$null=$trace.Add('followups');[pscustomobject]@{complete=$false;dialogs=@();unreadableWindows=@()}}
 function Emit($Result){$null=$trace.Add('emit');$state.result=$Result;throw $sentinel}
 try{& $readback;throw 'Missing terminal file-less readback.'}catch{if(-not[object]::ReferenceEquals($_.Exception,$sentinel)){throw}}
 if(($trace -join ',') -cne 'followups,emit' -or $null -ne $state.result.caseHashUnchanged -or $state.result.caseBindingModeAfter -cne 'file-less-start'){
  throw 'File-less incomplete recovery falsely claimed a file hash or lost its mode.'
 }
}
Write-Output 'recovery-followups: hash/binding readback precedes incomplete own-window results; file-less mode stays explicit.'

$closeStart=$workerSource.IndexOf("  'close' {")
$guardStart=$workerSource.IndexOf('      try { $closeInventory =',$closeStart)
$guardEnd=$workerSource.IndexOf('      $openDialogs =',$guardStart)
$sendStart=$workerSource.IndexOf('[SW]::SendMessageTimeout',$guardStart)
if($guardStart -le $closeStart -or $guardEnd -le $guardStart -or $sendStart -le $guardEnd){throw 'Pre-close inventory guard no longer precedes the close request.'}
$closeGuard=[scriptblock]::Create($workerSource.Substring($guardStart,$guardEnd-$guardStart))
foreach($failureKind in @('hung','generic')) {
 & {
  $targetPid=7;$state=[pscustomobject]@{result=$null;reads=0};[SW]::CloseSends=0
  $sentinel=[OperationCanceledException]::new('Synthetic terminal Emit.')
  function Get-DialogInventory([int]$TargetPid,[switch]$RejectHung){
   if($TargetPid -ne 7 -or -not$RejectHung){throw 'Close inventory lost its target/hung guard.'}
   $state.reads++;$failure=[InvalidOperationException]::new('Synthetic private provider failure.')
   $failure.Data['kind']=$failureKind;throw $failure
  }
  function Emit($Result){$state.result=$Result;throw $sentinel}
  try{& $closeGuard;throw 'Missing terminal pre-close failure.'}catch{if(-not[object]::ReferenceEquals($_.Exception,$sentinel)){throw}}
  $expectedKind=@{hung='hung';generic='state-unknown'}[$failureKind]
  if($state.reads -ne 1 -or [SW]::CloseSends -ne 0 -or $state.result.ok -or $state.result.kind -cne $expectedKind -or
     $state.result.closeRequested -ne $false -or $state.result.pid -ne 7 -or $state.result.dialogInspectionError -cne 'System.InvalidOperationException'){
   throw 'Pre-close failure lost its exact kind/action state or sent a close request.'
  }
 }
}
& {
 $targetPid=7
 function Get-DialogInventory {[pscustomobject]@{pid=7;hwnd=77;kind='other';uiaError='Synthetic.Type';msaaReadOk=$true}}
 function Emit {throw 'Complete alternative read must not block pre-close inventory.'}
 . $closeGuard
 if($closeInventory.Count -ne 1){throw 'Complete pre-close MSAA read disappeared.'}
}
Write-Output 'close-inventory: failures are terminal before a close request; a complete alternative read remains usable.'

$stillStart=$workerSource.IndexOf('    if (-not $closed -and -not ($allowsChildDialog',$answerStart)
$stillEnd=$workerSource.IndexOf('    if ($allowsChildDialog -and -not $closed)',$stillStart)
if($stillStart -le $answerStart -or $stillEnd -le $stillStart){throw 'Still-open answer readback chunk missing.'}
$stillOpen=[scriptblock]::Create($workerSource.Substring($stillStart,$stillEnd-$stillStart))
& {
 $closed=$false;$allowsChildDialog=$false;$newDialogs=@();$buttonName='Nein';$method='synthetic';$mainBeforeHwnd=[IntPtr]111
 $dialog=[pscustomobject]@{pid=7;hwnd=77};$windowsAfter=@([pscustomobject]@{pid=7;hwnd=77;hung=$false})
 $state=[pscustomobject]@{reads=0;result=$null};$sentinel=[OperationCanceledException]::new('Synthetic terminal Emit.')
 function Get-DialogDescriptor {
  $state.reads++;$null=[SW]::Owners.Remove(77)
  [pscustomobject]@{pid=7;hwnd=77;kind='qt-dialog';fingerprint='stale'}
 }
 function Emit($Result){$state.result=$Result;throw $sentinel}
 try{& $stillOpen;throw 'Missing terminal still-open readback.'}catch{if(-not[object]::ReferenceEquals($_.Exception,$sentinel)){throw}}
 finally{[SW]::Owners[77]=7}
 if($state.reads -ne 1 -or $state.result.ok -or $state.result.kind -cne 'postcondition-failed' -or $null -ne $state.result.dialog){
  throw 'Window disappearance during a still-open readback leaked stale dialog data or retried the read.'
 }
}
Write-Output 'dialog-answer: disappearance during the final read drops stale data without another read.'
