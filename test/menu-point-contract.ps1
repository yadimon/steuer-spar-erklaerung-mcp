$ErrorActionPreference='Stop'
$worker=Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($worker,[ref]$null,[ref]$parseErrors)
if($parseErrors.Count){throw 'Worker cannot be parsed.'}
foreach($name in @('Click-VerifiedPoint','Enter-SSEForegroundLease','Exit-SSEForegroundLease',
 'Set-SSEForegroundLeaseInputCheckpoint','Get-SSEInputEpochEvidence','Test-SSELastInputUnchanged',
 'Set-SSECursorPoint','Assert-SSECursorPoint','Hide-SSETopmost','Test-SSEMenuPointBinding')){
 $found=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
 if($found.Count -ne 1){throw ('Actual menu point helper is ambiguous: '+$name)}
 . ([scriptblock]::Create($found[0].Extent.Text))
}
foreach($name in @('Get-SSEMenuHoverPoints','Initialize-SSEMenuHover')){
 $found=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
 if($found.Count -ne 1){throw ('Actual menu hover helper is ambiguous: '+$name)}
 . ([scriptblock]::Create($found[0].Extent.Text))
}
$leaseInit=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$script:SSE_FOREGROUND_LEASE'},$true))
if($leaseInit.Count -ne 1){throw 'Actual foreground lease initializer is ambiguous.'}
$initializeLease=[scriptblock]::Create($leaseInit[0].Extent.Text)
Add-Type -AssemblyName WindowsBase
Add-Type @'
using System;
public static class SW {
 public struct PT {public int X,Y;}
 public static long Foreground=101;
 public static int CursorX=7,CursorY=9,MouseCalls,WindowPosCalls;
 public static uint Tick=37,PopupPid=55;
 public static bool PopupAlive=true,MainAlive=true,CorrectPoint=true,RedirectRoot;
 public static Action OnCursorRead,OnMouseUp,OnPointRead;
 public static Action OnHoverMessage,OnCursorMove;
 public static int HoverMessages,CursorMoves,DpiRestores,HeldKey,FinalPointReads;
 public static bool MessageTimeout,ClientConversionFailure,DpiRestoreFailure,DpiEnterFailure,DpiActive;
 public static uint GetDpiForWindow(IntPtr h){return 96;}
 public static short GetAsyncKeyState(int key){return (short)(key==HeldKey?-32768:0);}
 public static uint GetCurrentThreadId(){return 1;}
 public static IntPtr EnterPhysicalDpiContext(){if(DpiActive)throw new Exception("Nested DPI context");DpiActive=!DpiEnterFailure;return new IntPtr(DpiEnterFailure?0:12);}
 public static bool RestoreDpiContext(IntPtr previous){DpiRestores++;bool ok=DpiActive&&previous.ToInt64()==12&&!DpiRestoreFailure;if(ok)DpiActive=false;return ok;}
 public static bool ScreenToClient(IntPtr h,ref PT p){
  if(h.ToInt64()!=202||!DpiActive)throw new Exception("Client conversion outside bound physical context");
  p.X-=15;p.Y-=25;return !ClientConversionFailure;
 }
 public static IntPtr SendMessageTimeout(IntPtr h,uint message,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result){
  if(h.ToInt64()!=202||message!=0x0200||w!=IntPtr.Zero||flags!=2||timeout!=100||!DpiActive)throw new Exception("Unexpected hover message");
  int packed=unchecked((int)l.ToInt64());
  if((short)(packed&65535)!=CursorX-15||(short)(packed>>16)!=CursorY-25)throw new Exception("Hover message disagrees with actual client cursor");
  HoverMessages++;result=IntPtr.Zero;if(OnHoverMessage!=null)OnHoverMessage();return new IntPtr(MessageTimeout?0:1);
 }
 public static IntPtr GetForegroundWindow(){return new IntPtr(Foreground);}
 public static bool IsWindow(IntPtr h){return h.ToInt64()==101?MainAlive:h.ToInt64()==202&&PopupAlive;}
 public static uint GetWindowThreadProcessId(IntPtr h,out int pid){pid=IsWindow(h)?(h.ToInt64()==101?55:(int)PopupPid):0;return pid==0?0u:1u;}
 public static IntPtr GetAncestor(IntPtr h,int kind){return RedirectRoot&&h.ToInt64()==202?new IntPtr(101):h;}
 public static IntPtr GetWindow(IntPtr h,int kind){return IntPtr.Zero;}
 public static bool GetCursorPos(ref PT p){p.X=CursorX;p.Y=CursorY;if(OnCursorRead!=null)OnCursorRead();return true;}
 public static bool SetCursorPos(int x,int y){CursorMoves++;CursorX=x;CursorY=y;if(OnCursorMove!=null)OnCursorMove();return true;}
 public static bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,int flags){WindowPosCalls++;return true;}
 public static void mouse_event(int flags,int x,int y,int data,IntPtr extra){MouseCalls++;if(flags==4){Tick++;PopupAlive=false;if(OnMouseUp!=null)OnMouseUp();}}
}
public sealed class MenuPointElement {public int[] GetRuntimeId(){return SW.CorrectPoint?new int[]{4,7}:new int[]{4,8};}}
public static class MenuPointAE {public static MenuPointElement FromPoint(object p){if(SW.OnPointRead!=null)SW.OnPointRead();return new MenuPointElement();}}
'@
$script:AE=[MenuPointAE]
$WLK=[pscustomobject]@{}
$WLK|Add-Member ScriptMethod GetParent {param($Element) return $null}
function Get-SSELastInputTick {[SW]::Tick}
function Start-Sleep {param($Milliseconds) if($Milliseconds -eq 180 -and $script:foreignAfterInput){[SW]::Tick++}}
function Set-SSEForegroundWindowCore {param([IntPtr]$Hwnd,[switch]$Topmost) $script:activationCalls++;return $true}
function Show-SSEWindow {param([IntPtr]$Hwnd) $script:showCalls++;Enter-SSEForegroundLease $Hwnd}
function Test-SSEWindowIsLockScreen {return $false}
function Get-SSEWindowClassName([IntPtr]$Window){if($Window -eq [IntPtr]202){return $script:popupClass};return 'Qt692QWindowIcon'}
function Get-SSEMenuPopupWindows([int]$TargetPid){if($script:listedPopup -and [SW]::PopupAlive){[pscustomobject]@{hwnd=202;pid=55;cls=$script:popupClass}}}
function Get-SSEPointObstruction([IntPtr]$Window,[int]$X,[int]$Y){
 if($Window -ne [IntPtr]202){throw 'Popup hit proof was rebound to the main window.'}
 [pscustomobject]@{isBoundTarget=$script:unobstructed}
}
function Fail($Message,$Kind,$Details){throw ('Unexpected terminal Emit: '+$Kind+' '+$Message)}
function Reset-MenuPoint {
 & $initializeLease
 [SW]::Foreground=101;[SW]::CursorX=7;[SW]::CursorY=9;[SW]::MouseCalls=0;[SW]::WindowPosCalls=0
 [SW]::Tick=37;[SW]::PopupPid=55;[SW]::PopupAlive=$true;[SW]::MainAlive=$true;[SW]::CorrectPoint=$true;[SW]::RedirectRoot=$false
 [SW]::OnCursorRead=$null;[SW]::OnMouseUp=$null;[SW]::OnPointRead=$null
 [SW]::OnHoverMessage=$null;[SW]::OnCursorMove=$null;[SW]::HoverMessages=0;[SW]::CursorMoves=0;[SW]::DpiRestores=0;[SW]::HeldKey=0
 [SW]::MessageTimeout=$false;[SW]::ClientConversionFailure=$false;[SW]::DpiRestoreFailure=$false;[SW]::DpiEnterFailure=$false
 [SW]::DpiActive=$false
 [SW]::FinalPointReads=0
 $script:activationCalls=0;$script:showCalls=0;$script:popupClass='Qt692QWindowPopupDropShadowSaveBits'
 $script:listedPopup=$true;$script:unobstructed=$true
 $script:foreignAfterInput=$false
}
$node=[pscustomobject]@{x=20;y=30;w=100;h=20;rid='4.7';name='BelegManager';type='MenuItem';on=$true}
function Invoke-MenuPoint([scriptblock]$Before=$null){
 $binding=[pscustomobject]@{mainHwnd=101;processId=55;popupHwnd=202}
 $verify={param($Window,$Binding,$X,$Y) Test-SSEMenuPointBinding $Window $Binding}
 if($Before){$verify={param($Window,$Binding,$X,$Y) & $Before $Window $Binding $X $Y;Test-SSEMenuPointBinding $Window $Binding}}
 Click-VerifiedPoint ([IntPtr]202) $node 37 -ForegroundWindow ([IntPtr]101) -RequireForeground -ExpectedRuntimeId '4.7' -ThrowOnFailure -BeforeClickCheck $verify -BeforeClickBinding $binding
}
function Check-MenuPoint([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Assert-NoMenuActivation {
 Check-MenuPoint ($script:showCalls -eq 0 -and $script:activationCalls -eq 0 -and [SW]::WindowPosCalls -eq 0) 'An open menu or its main window was activated or raised.'
}
Reset-MenuPoint
$point=Invoke-MenuPoint
Check-MenuPoint ([SW]::MouseCalls -eq 2 -and $point.foregroundHwndBeforeClick -eq 101 -and $point.foregroundBoundBeforeClick) 'An ownerless same-process popup was not clicked exactly once under its bound main foreground.'
Check-MenuPoint ([SW]::HoverMessages -eq 10 -and [SW]::DpiRestores -eq 10 -and [SW]::CursorMoves -eq 10) 'The exact menu item was not prepared with ten bounded no-button moves before the single click.'
Assert-NoMenuActivation
Check-MenuPoint ($script:SSE_FOREGROUND_LEASE.depth -eq 0 -and $null -ne $script:SSE_FOREGROUND_LEASE.watch -and $script:SSE_FOREGROUND_LEASE.lastOwnedInputTick -eq 38) 'The click lost its original observational lease or its own input checkpoint.'
Exit-SSEForegroundLease -Force -Reason 'emit'
Check-MenuPoint ([SW]::CursorX -eq 7 -and [SW]::CursorY -eq 9 -and $script:SSE_FOREGROUND_LEASE.cursorRestored) 'The already-foreground popup path did not restore the original cursor after its own input.'
Assert-NoMenuActivation
Reset-MenuPoint
$ordinaryNode=$node
$node=[pscustomobject]@{x=-200;y=-100;w=100;h=20;rid='4.7';name='BelegManager';type='MenuItem';on=$true}
Invoke-MenuPoint|Out-Null
Check-MenuPoint ([SW]::HoverMessages -eq 10 -and [SW]::MouseCalls -eq 2 -and -not [SW]::DpiActive) 'Signed nonzero-origin client coordinates or physical DPI return were not preserved.'
Exit-SSEForegroundLease -Force -Reason 'emit';Assert-NoMenuActivation
$node=$ordinaryNode

foreach($dpi in @(96,120,144,192,288,768)){
 $wide=[pscustomobject]@{x=-5000;y=-300;w=500;h=40}
 $plan=@(Get-SSEMenuHoverPoints $wide $dpi)
 Check-MenuPoint ($plan.Count -eq 10 -and @($plan|ForEach-Object{$_.x}|Select-Object -Unique).Count -eq 10) 'Hover plan lost its ten distinct points.'
 Check-MenuPoint ($plan[9].x -eq -4750 -and $plan[9].y -eq -280 -and
  @($plan|Where-Object{$_.x -le -5000 -or $_.x -ge -4501 -or $_.y -ne -280}).Count -eq 0) 'Hover crossed an item boundary or changed its final click point.'
}
foreach($bad in @(
 @{node=[pscustomobject]@{x=0;y=0;w=20;h=20};dpi=96},
 @{node=[pscustomobject]@{x=0;y=0;w=100;h=2};dpi=96},
 @{node=[pscustomobject]@{x=0;y=0;w=100;h=20};dpi=0},
 @{node=[pscustomobject]@{x=0;y=0;w=100;h=20};dpi=769},
 @{node=[pscustomobject]@{x=0.5;y=0;w=100;h=20};dpi=96},
 @{node=[pscustomobject]@{x=[int]::MaxValue;y=0;w=100;h=20};dpi=96},
 @{node=[pscustomobject]@{x=0;y=0;w=100};dpi=96}
)){
 $caught=$null;try{Get-SSEMenuHoverPoints $bad.node $bad.dpi|Out-Null}catch{$caught=$_}
 Check-MenuPoint ($null -ne $caught) 'An unprovable menu hover geometry was accepted.'
}
foreach($case in @(
 @{name='held-mouse';setup={[SW]::HeldKey=1}},
 @{name='held-modifier';setup={[SW]::HeldKey=17}},
 @{name='message-timeout';setup={[SW]::MessageTimeout=$true}},
 @{name='hover-deadline';setup={[SW]::OnHoverMessage={[Threading.Thread]::Sleep(2550)}}},
 @{name='late-final-proof';messages=10;setup={[SW]::OnPointRead={if([SW]::HoverMessages -eq 10){[Threading.Thread]::Sleep(2550)}}}},
 @{name='late-dispatch-proof';messages=10;setup={[SW]::OnPointRead={if([SW]::HoverMessages -eq 10){[SW]::FinalPointReads++;if([SW]::FinalPointReads -eq 2){[Threading.Thread]::Sleep(2550)}}}}},
 @{name='conversion';setup={[SW]::ClientConversionFailure=$true}},
 @{name='dpi-enter';setup={[SW]::DpiEnterFailure=$true}},
 @{name='dpi-restore';setup={[SW]::DpiRestoreFailure=$true}},
 @{name='input-after-hover';setup={[SW]::OnHoverMessage={[SW]::Tick=38}}},
 @{name='foreground-after-hover';setup={[SW]::OnHoverMessage={[SW]::Foreground=999}}},
 @{name='popup-after-hover';setup={[SW]::OnHoverMessage={[SW]::PopupPid=56}}},
 @{name='rid-after-hover';setup={[SW]::OnHoverMessage={[SW]::CorrectPoint=$false}}},
 @{name='rid-before-first-message';setup={[SW]::OnCursorMove={if([SW]::CursorMoves -eq 1){[SW]::CorrectPoint=$false}}}},
 @{name='obstruction-before-first-message';setup={[SW]::OnCursorMove={if([SW]::CursorMoves -eq 1){$script:unobstructed=$false}}}},
 @{name='obstruction-after-hover';setup={[SW]::OnHoverMessage={$script:unobstructed=$false}}}
)){
 Reset-MenuPoint;& $case.setup;$caught=$null
 try{Invoke-MenuPoint|Out-Null}catch{$caught=$_}
 Check-MenuPoint ($null -ne $caught -and $caught.Exception.Data['inputDispatched'] -eq $false -and
  [SW]::MouseCalls -eq 0 -and [SW]::HoverMessages -le $(if($case.messages){$case.messages}else{1})) ('Hover failure dispatched or replayed a click: '+$case.name)
 Exit-SSEForegroundLease -Force -Reason 'emit';Assert-NoMenuActivation
 if($case.name -in @('hover-deadline','late-final-proof','late-dispatch-proof')){
  Check-MenuPoint ($caught.Exception.Data['kind'] -ceq 'precondition-failed' -and $script:SSE_FOREGROUND_LEASE.cursorRestored) 'A provider deadline was misreported as foreign input or lost its cursor return.'
 }
 if($case.name -ceq 'input-after-hover'){
  Check-MenuPoint ($script:SSE_FOREGROUND_LEASE.lastOwnedInputTick -eq 37 -and -not $script:SSE_FOREGROUND_LEASE.cursorRestored) 'Hover adopted foreign input or restored a cursor over it.'
 }
 if($case.name -ceq 'message-timeout'){
  Check-MenuPoint ($script:SSE_FOREGROUND_LEASE.cursorRestored -and [SW]::DpiRestores -eq 1) 'A pre-click message timeout lost the proven cursor or DPI return path.'
 }
 if($case.name -in @('rid-before-first-message','obstruction-before-first-message')){
  Check-MenuPoint ($script:SSE_FOREGROUND_LEASE.cursorRestored -and [SW]::CursorX -eq 7 -and [SW]::CursorY -eq 9 -and [SW]::HoverMessages -eq 0) 'A post-move target refusal stranded the cursor before the first hover message.'
 }
}

foreach($case in @(
 @{name='foreign-foreground';setup={[SW]::Foreground=999}},
 @{name='foreign-input';setup={[SW]::Tick=38}},
 @{name='foreign-popup';setup={[SW]::PopupPid=56}},
 @{name='dead-main';setup={[SW]::MainAlive=$false}},
 @{name='wrong-class';setup={$script:popupClass='Qt692QWindowToolSaveBits'}},
 @{name='unknown-class-suffix';setup={$script:popupClass='Qt692QWindowPopupDropShadowUnknown'}},
 @{name='missing-class-flag';setup={$script:popupClass='Qt692QWindowPopupDropShadow'}},
 @{name='wrong-root';setup={[SW]::RedirectRoot=$true}},
 @{name='missing-popup';setup={$script:listedPopup=$false}},
 @{name='obstructed';setup={$script:unobstructed=$false}},
 @{name='wrong-point';setup={[SW]::CorrectPoint=$false}},
 @{name='input-during-capture';setup={[SW]::OnCursorRead={[SW]::Tick=38}}},
 @{name='foreground-during-capture';setup={[SW]::OnCursorRead={[SW]::Foreground=999}}},
 @{name='unreadable-capture';setup={[SW]::OnCursorRead={throw 'Synthetic capture refusal'}}},
 @{name='input-during-point';setup={[SW]::OnPointRead={[SW]::Tick=38}}}
)){
 Reset-MenuPoint;& $case.setup;$caught=$null
 try{Invoke-MenuPoint|Out-Null}catch{$caught=$_}
 Check-MenuPoint ($null -ne $caught -and $caught.Exception.Data['inputDispatched'] -eq $false -and [SW]::MouseCalls -eq 0) ('An unsafe menu point crossed the dispatch boundary: '+$case.name)
 Exit-SSEForegroundLease -Force -Reason 'emit'
 Assert-NoMenuActivation
 if($case.name -ceq 'input-during-capture'){
  Check-MenuPoint ($script:SSE_FOREGROUND_LEASE.lastOwnedInputTick -eq 37 -and -not $script:SSE_FOREGROUND_LEASE.releaseInputEvidence.unchanged) 'Foreign input during observation was adopted as an owned epoch.'
 }
}
Reset-MenuPoint
$script:SSE_FOREGROUND_LEASE.watch=[Diagnostics.Stopwatch]::StartNew()
$script:SSE_FOREGROUND_LEASE.depth=2;$script:SSE_FOREGROUND_LEASE.lastAcquireRaised=$true
$heldWatch=$script:SSE_FOREGROUND_LEASE.watch;$caught=$null
try{Invoke-MenuPoint|Out-Null}catch{$caught=$_}
Check-MenuPoint ($null -ne $caught -and $caught.Exception.Data['inputDispatched'] -eq $false -and [SW]::MouseCalls -eq 0 -and
 [object]::ReferenceEquals($heldWatch,$script:SSE_FOREGROUND_LEASE.watch) -and $script:SSE_FOREGROUND_LEASE.depth -eq 2 -and
 $script:SSE_FOREGROUND_LEASE.lastAcquireRaised) 'An observational menu call adopted or modified an existing lease.'
Assert-NoMenuActivation
foreach($missing in @('tick','rid','foreground','check','binding','throw','double-click','prepare','msaa','same-window')){
 Reset-MenuPoint
 $arguments=@{Window=[IntPtr]202;Node=$node;ExpectedInputTick=37;ForegroundWindow=[IntPtr]101;RequireForeground=$true;
  ExpectedRuntimeId='4.7';ThrowOnFailure=$true;BeforeClickCheck={return $true};BeforeClickBinding=[pscustomobject]@{mainHwnd=101}}
 switch($missing){
  'tick'{$arguments.ExpectedInputTick=$null}
  'rid'{$arguments.ExpectedRuntimeId=''}
  'foreground'{$arguments.RequireForeground=$false}
  'check'{$arguments.BeforeClickCheck=$null}
  'binding'{$arguments.BeforeClickBinding=$null}
  'throw'{$arguments.ThrowOnFailure=$false}
  'double-click'{$arguments.ClickCount=2}
  'prepare'{$arguments.PrepareTarget={throw 'Preparation must not run'}}
  'msaa'{$arguments.Node=[pscustomobject]@{x=20;y=30;w=100;h=20;source='msaa-point'}}
  'same-window'{$arguments.ForegroundWindow=[IntPtr]202}
 }
 $caught=$null;try{Click-VerifiedPoint @arguments|Out-Null}catch{$caught=$_}
 Check-MenuPoint ($null -ne $caught -and [SW]::MouseCalls -eq 0 -and $null -eq $script:SSE_FOREGROUND_LEASE.watch) ('Incomplete popup authority was accepted: '+$missing)
 Assert-NoMenuActivation
}
Reset-MenuPoint
$throwingCheck={param($Window,$Binding,$X,$Y) if($null -ne $X){throw 'Synthetic unreadable final popup'}}
$caught=$null;try{Invoke-MenuPoint $throwingCheck|Out-Null}catch{$caught=$_}
Check-MenuPoint ($null -ne $caught -and $caught.Exception.Data['kind'] -ceq 'stale' -and $caught.Exception.Data['inputDispatched'] -eq $false -and [SW]::MouseCalls -eq 0) 'A throwing last popup proof lost its known-unsent state.'
Exit-SSEForegroundLease -Force -Reason 'emit';Assert-NoMenuActivation
foreach($change in @(
 {[SW]::Foreground=999}, {[SW]::PopupPid=56}, {$script:popupClass='Qt692QWindowToolSaveBits'}, {$script:listedPopup=$false}
)){
 Reset-MenuPoint;$caught=$null
 $before={param($Window,$Binding,$X,$Y) if($null -ne $X){& $change}}
 try{Invoke-MenuPoint $before|Out-Null}catch{$caught=$_}
 Check-MenuPoint ($null -ne $caught -and $caught.Exception.Data['inputDispatched'] -eq $false -and [SW]::MouseCalls -eq 0) 'Popup or foreground drift during the final proof was accepted.'
 Exit-SSEForegroundLease -Force -Reason 'emit';Assert-NoMenuActivation
}
Reset-MenuPoint
$script:foreignAfterInput=$true
$caught=$null
try{Invoke-MenuPoint|Out-Null}catch{$caught=$_}
Check-MenuPoint ($null -ne $caught -and $caught.Exception.Data['inputDispatched'] -eq $true -and [SW]::MouseCalls -eq 2) 'Post-click interference lost its dispatch evidence or replayed input.'
Exit-SSEForegroundLease -Force -Reason 'emit';Assert-NoMenuActivation

$calls=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Click-VerifiedPoint' -and
 @($n.CommandElements|Where-Object{$_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -ceq 'ForegroundWindow'}).Count -gt 0},$true))
$menuSwitch=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.SwitchStatementAst] -and
 @($n.Clauses|Where-Object{$_.Item1.Extent.Text -ceq "'menu_click'"}).Count -eq 1},$true))
Check-MenuPoint ($menuSwitch.Count -eq 1) 'Actual menu dispatcher is ambiguous.'
$menuExtent=@($menuSwitch[0].Clauses|Where-Object{$_.Item1.Extent.Text -ceq "'menu_click'"})[0].Item2.Extent
Check-MenuPoint ($calls.Count -eq 1 -and $calls[0].Extent.StartOffset -gt $menuExtent.StartOffset -and $calls[0].Extent.EndOffset -lt $menuExtent.EndOffset) 'The popup-only foreground contract spread to unrelated point callers.'
Reset-MenuPoint
[SW]::Tick=0
$zeroLease=Enter-SSEForegroundLease ([IntPtr]101) -ObserveOnly -ExpectedInputTick ([uint64]0)
Check-MenuPoint ($zeroLease -eq $true -and $script:SSE_FOREGROUND_LEASE.lastOwnedInputTick -eq 0) 'An observational lease rejected a valid zero epoch.'
Assert-NoMenuActivation
Exit-SSEForegroundLease -Force -Reason 'emit';Assert-NoMenuActivation
Reset-MenuPoint
$defaultLease=Enter-SSEForegroundLease ([IntPtr]101)
Check-MenuPoint ($defaultLease -eq $true -and $script:activationCalls -eq 1 -and $script:SSE_FOREGROUND_LEASE.raises -eq 1 -and
 $script:SSE_FOREGROUND_LEASE.raisedWindows.Contains([int64]101)) 'The default foreground acquisition lost its activation behavior.'
Exit-SSEForegroundLease -Force -Reason 'emit'
Write-Output 'Menu point: actual click/lease/cursor composition, ownerless popup, no activation, retained input and strict dispatch boundaries passed.'
