param([string]$WorkerPath)
# Der echte click-Dispatcher und Klickhelper laufen nur gegen synthetische
# Grenzen. SW/Point enthalten weder P/Invoke noch Eingabe-/Fensterzugriffe.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
if (-not $WorkerPath) { $WorkerPath = Join-Path $PSScriptRoot '../powershell/sse-worker.ps1' }
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($WorkerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Der Worker konnte nicht geparst werden.' }
foreach ($name in @('Click-VerifiedPoint', 'Test-SSELastInputUnchanged',
  'Get-SSEUiaOwnRootAncestry', 'Get-SSEWizardWindowGeometry', 'Test-SSEWizardWindowGeometryEqual',
  'Get-SSEWizardNavigationFrame', 'Set-SSEWizardWindowPosition', 'Sync-SSEWizardNavigationFrame',
  'Test-SSEWizardNavigationFrameBeforeClick')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Die echte Funktion $name fehlt oder ist mehrdeutig." }
  Invoke-Expression $definition[0].Extent.Text
}
$clause = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true) |
  ForEach-Object { $_.Clauses } | Where-Object { $_.Item1.Extent.Text -ceq "'click'" })
if ($clause.Count -ne 1) { throw 'Der echte click-Dispatcher fehlt oder ist mehrdeutig.' }
$clickBody = [scriptblock]::Create((@($clause[0].Item2.Statements | ForEach-Object { $_.Extent.Text }) -join "`n"))
Add-Type -TypeDefinition @'
using System;
public static class SW {
 public struct RC { public int L,T,R,B; }
 public struct PT { public int X,Y; }
 public struct WP { public uint length,flags,showCmd; public PT minPosition,maxPosition; public RC normalPosition; }
 public sealed class PositionCall { public long Hwnd,After,Context; public int X,Y,CX,CY; public uint Flags; }
 public static long Foreground=111;
 public static ulong Tick=100;
 public static int MouseEvents;
 public static bool ThrowOnMouseUp;
 public static int ProcessId=7, Dpi=144, WindowLeft=0, WindowTop=0, WindowRight=1000, WindowBottom=800;
 public static bool WindowRectAvailable=true;
 public static bool WindowValid=true, PlacementAvailable=true, MonitorAvailable=true;
 public static int PlacementShowCmd=1, WorkLeft=0, WorkTop=0, WorkRight=1200, WorkBottom=900;
 public static long Monitor=55, ProcessEpoch=1000, RootHwnd=111;
 public static uint ThreadId=17;
 public static long DpiContext=12;
 public static int DpiEnterCalls,DpiRestoreCalls,DpiFailEnterOn=-1,DpiFailRestoreOn=-1;
 public static int DriftTickOnDpiEnter=-1,LoseForegroundOnDpiEnter=-1,ChangeEpochOnDpiEnter=-1;
 public static int PositionFailureOn=-1,PositionNoMoveOn=-1,DriftTickOnMove=-1,LoseForegroundOnMove=-1,ChangeEpochOnMove=-1;
 public static System.Collections.Generic.List<PositionCall> Positions=new System.Collections.Generic.List<PositionCall>();
 public static System.Collections.Generic.List<long> RestoredContexts=new System.Collections.Generic.List<long>();
 public static IntPtr GetForegroundWindow(){return new IntPtr(Foreground);}
 public static bool IsWindow(IntPtr hwnd){return WindowValid && hwnd.ToInt64()==111;}
 public static IntPtr GetAncestor(IntPtr hwnd,uint flags){return new IntPtr(RootHwnd);}
 public static uint GetCurrentThreadId(){return ThreadId;}
 public static uint GetWindowThreadProcessId(IntPtr hwnd,out int pid){pid=ProcessId;return 1;}
 public static uint GetDpiForWindow(IntPtr hwnd){return (uint)Dpi;}
 public static bool GetWindowRect(IntPtr hwnd,out RC r){r=new RC{L=WindowLeft,T=WindowTop,R=WindowRight,B=WindowBottom};return WindowRectAvailable;}
 public static bool GetWindowPlacement(IntPtr hwnd,ref WP p){p.showCmd=(uint)PlacementShowCmd;p.normalPosition=new RC{L=WindowLeft,T=WindowTop,R=WindowRight,B=WindowBottom};return PlacementAvailable;}
 public static long[] GetMonitorWorkArea(IntPtr hwnd){return MonitorAvailable?new long[]{Monitor,WorkLeft,WorkTop,WorkRight,WorkBottom}:null;}
 public static IntPtr EnterPhysicalDpiContext(){DpiEnterCalls++;if(DpiEnterCalls==DriftTickOnDpiEnter)Tick++;if(DpiEnterCalls==LoseForegroundOnDpiEnter)Foreground=999;if(DpiEnterCalls==ChangeEpochOnDpiEnter)ProcessEpoch++;if(DpiEnterCalls==DpiFailEnterOn)return IntPtr.Zero;var old=DpiContext;DpiContext=-4;return new IntPtr(old);}
 public static bool RestoreDpiContext(IntPtr previous){DpiRestoreCalls++;RestoredContexts.Add(previous.ToInt64());if(DpiRestoreCalls==DpiFailRestoreOn)return false;DpiContext=previous.ToInt64();return previous!=IntPtr.Zero;}
 public static bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int cx,int cy,uint flags){
  Positions.Add(new PositionCall{Hwnd=hwnd.ToInt64(),After=after.ToInt64(),X=x,Y=y,CX=cx,CY=cy,Flags=flags,Context=DpiContext});
  int call=Positions.Count;
  if(call==DriftTickOnMove)Tick++;if(call==LoseForegroundOnMove)Foreground=999;if(call==ChangeEpochOnMove)ProcessEpoch++;
  if(call==PositionFailureOn)return false;
  if(call!=PositionNoMoveOn){int w=WindowRight-WindowLeft,h=WindowBottom-WindowTop;WindowLeft=x;WindowTop=y;WindowRight=x+w;WindowBottom=y+h;}
  return true;
 }
 public static void mouse_event(int flags,int x,int y,int data,IntPtr extra){
  MouseEvents++; if(flags==4){Tick++;if(ThrowOnMouseUp)throw new InvalidOperationException("Synthetic mouse-up exception.");}
 }
}
public static class NavigationTestPoint {
 public static object Element, Root, LastPoint;
 public static int FromHandleCalls;
 public static bool DriftInput, DriftHandleInput;
 public static object FromHandle(IntPtr hwnd){FromHandleCalls++;if(DriftHandleInput)SW.Tick++;return Root;}
 public static object FromPoint(object point){LastPoint=point;if(DriftInput)SW.Tick++;return Element;}
}
'@
$script:AE = [NavigationTestPoint]
$WLK = [pscustomobject]@{}
$WLK | Add-Member ScriptMethod GetParent { param($Element) $Element.Parent }
$script:Scenarios = 0
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Arg($Object, [string]$Name, $Default = $null) {
  if ($Object.ContainsKey($Name)) { return $Object[$Name] }
  $Default
}
function Emit($Result) {
  $failure = [InvalidOperationException]::new('synthetic-result'); $failure.Data['result'] = $Result; throw $failure
}
function Fail([string]$Message, [string]$Kind, $Details = $null) {
  $script:FailCalls++
  Emit ([pscustomobject]@{ ok=$false; kind=$Kind; error=$Message; details=$Details })
}
function Get-SSEBoundedIntegerArg { param($Object,$Name,$Default,$Minimum,$Maximum) Arg $Object $Name $Default }
function Test-Versand { $false }
function Assert-SSEDestructiveAcknowledgement {}
function Resolve-SSEMainWindowDescriptor { param($Args,[switch]$RestoreMinimized) [pscustomobject]@{ hwnd=111 } }
function Test-Canary { [pscustomobject]@{ ok=$true; ms=1 } }
function Walk-Tree {
  param([IntPtr]$Hwnd,[int]$Limit,[switch]$WithValues)
  $script:WalkCalls++
  if ($script:WalkCalls -eq 1 -and $script:DriftDuringTree) { [SW]::Tick++ }
  [pscustomobject]@{ nodes=@($script:Node) }
}
function Get-CurrentHeading { param($Hwnd,$Tree,[switch]$CompactFallback) $(if ([SW]::MouseEvents -or $script:UiaInvokes) { $script:HeadingAfter } else { $script:HeadingBefore }) }
function Get-DirtyStateFast { $false }
function Get-DialogInventory { @() }
function Resolve-Nodes { param($Tree,$Args) $Tree.nodes }
function Get-SSEContainerChild { $null }
function Get-SSEMainWindowSelectors { [pscustomobject]@{ heading='Synthetic.heading' } }
function Get-LiveElement {
  param($Hwnd,$Rid,$Aid)
  if($script:DriftDuringLiveResolve){[SW]::Tick++}
  if($script:IsWizard) {
    if($Rid -ceq $script:Node.rid) { Invoke-SyntheticWizardProcessing; return $script:LiveElement }
    if($Rid -ceq $script:DocumentNode.rid) { return $script:DocumentElement }
    if($Rid -ceq $script:GuideNode.rid) { return $script:GuideElement }
  }
  $script:LiveElement
}
function Get-SSETablePreparationProcessEpoch { param([int]$ProcessId) [SW]::ProcessEpoch }
function Convert-ExactElementToNode {
  param($Element)
  if ($script:DriftDuringFreshRead) { [SW]::Tick++ }
  if ($null -eq $Element) { return $null }
  if ($null -ne $Element.PSObject.Properties['Node']) { return $Element.Node.PSObject.Copy() }
  $script:FreshNode
}
function Get-SSELastInputTick { $(if ($script:TickUnreadable) { $null } else { [SW]::Tick }) }
function Show-SSEWindow {
  param([IntPtr]$Hwnd)
  $script:ShowCalls++
  if ($script:ShowException) { throw $script:ShowException }
  if ($script:DriftDuringShow) { [SW]::Tick++ }
  if ($script:ShowCalls -ge $script:AcquireOnAttempt) { [SW]::Foreground=111 }
  [SW]::Foreground -eq 111
}
function Hide-SSETopmost {
  param([IntPtr]$Hwnd)
  $script:HideCalls++
  if($null -ne $script:RestoreForegroundOnHide){[SW]::Foreground=$script:RestoreForegroundOnHide}
}
function Exit-SSEForegroundLease {
  param($Hwnd,[switch]$Force,[switch]$PreserveForeground,[string]$Reason)
  $script:ExitLeaseCalls++; $script:ExitLeasePreserves=[bool]($Force -and $PreserveForeground)
}
function Get-SSEPointObstruction {
  param($Window,$X,$Y)
  $script:ObstructionCalls++
  if ($script:ObstructionCalls -eq $script:DriftAtObstruction) { [SW]::Tick++ }
  if ($script:ObstructionCalls -eq $script:ForegroundLossAtObstruction) { [SW]::Foreground=999 }
  $script:LastObstruction=[pscustomobject]@{
    isBoundTarget=$script:PointBound; blockerKind=$(if($script:PointBound){'none'}else{'foreign-app'})
    point=[pscustomobject]@{x=$X;y=$Y}; boundWindow=111; boundPid=7
    hitWindow=$(if($script:PointBound){111}else{999}); hitRoot=$(if($script:PointBound){111}else{999})
    hitPid=$(if($script:PointBound){7}else{8}); processName='Synthetic process'; className='Synthetic class'
    rootRect=[pscustomobject]@{x=[SW]::WindowLeft;y=[SW]::WindowTop;w=([SW]::WindowRight-[SW]::WindowLeft);h=([SW]::WindowBottom-[SW]::WindowTop)}; foregroundHwnd=[SW]::Foreground
  }
  $script:LastObstruction
}
function Set-SSECursorPoint {
  param($X,$Y,$OnFailure)
  $script:PointerMoves++; $script:LastPointer=[pscustomobject]@{x=$X;y=$Y}
  if ($script:BeforeMouseMutation) { & $script:BeforeMouseMutation }
}
function Assert-SSECursorPoint {
  if ($script:DriftDuringCursorProof) { [SW]::Tick++ }
  if ($script:ForegroundLossDuringCursorProof) { [SW]::Foreground=999 }
}
function Set-SSEForegroundLeaseInputCheckpoint {
  if ($script:DriftAfterClick) { [SW]::Tick++ }
}
function Start-Sleep {}
function Reset-Case {
  $script:SSE_ENGINE_MAJOR=31; $script:DESKTOP_NAME=''; $script:SSE_HEADING_NODE_AID=@{}
  $script:SSE_FOREGROUND_LEASE=[pscustomobject]@{ lastAcquireRaised=$false }
  [SW]::Foreground=111; [SW]::Tick=100; [SW]::MouseEvents=0; [SW]::ThrowOnMouseUp=$false
  [SW]::ProcessId=7; [SW]::Dpi=144; [SW]::WindowLeft=0; [SW]::WindowTop=0
  [SW]::WindowRight=1000; [SW]::WindowBottom=800; [SW]::WindowRectAvailable=$true
  [SW]::WindowValid=$true; [SW]::PlacementAvailable=$true; [SW]::MonitorAvailable=$true
  [SW]::PlacementShowCmd=1; [SW]::WorkLeft=0; [SW]::WorkTop=0; [SW]::WorkRight=1200; [SW]::WorkBottom=900
  [SW]::Monitor=55; [SW]::ProcessEpoch=1000; [SW]::RootHwnd=111; [SW]::ThreadId=17; [SW]::DpiContext=12
  [SW]::DpiEnterCalls=0; [SW]::DpiRestoreCalls=0; [SW]::DpiFailEnterOn=-1; [SW]::DpiFailRestoreOn=-1
  [SW]::DriftTickOnDpiEnter=-1; [SW]::LoseForegroundOnDpiEnter=-1; [SW]::ChangeEpochOnDpiEnter=-1
  [SW]::PositionFailureOn=-1; [SW]::PositionNoMoveOn=-1; [SW]::DriftTickOnMove=-1; [SW]::LoseForegroundOnMove=-1; [SW]::ChangeEpochOnMove=-1
  [SW]::Positions.Clear(); [SW]::RestoredContexts.Clear()
  [NavigationTestPoint]::Root=$null; [NavigationTestPoint]::LastPoint=$null; [NavigationTestPoint]::FromHandleCalls=0; [NavigationTestPoint]::DriftHandleInput=$false
  $script:WalkCalls=0; $script:ShowCalls=0; $script:HideCalls=0; $script:PointerMoves=0; $script:ObstructionCalls=0
  $script:UiaInvokes=0; $script:FailCalls=0; $script:ForegroundLossAtObstruction=-1; $script:DriftDuringCursorProof=$false; $script:ForegroundLossDuringCursorProof=$false
  $script:TickUnreadable=$false; $script:DriftDuringTree=$false; $script:DriftDuringFreshRead=$false; $script:DriftDuringLiveResolve=$false
  $script:DriftDuringShow=$false; $script:DriftAfterClick=$false; $script:DriftAtObstruction=-1
  $script:AcquireOnAttempt=1; $script:PointBound=$true; $script:ShowException=$null
  $script:LastObstruction=$null; $script:LastPointer=$null; $script:BeforeMouseMutation=$null; $script:RestoreForegroundOnHide=$null
  $script:IsWizard=$false; $script:RefreshFrameAction=$null; $script:ProcessMoveAfterReads=1; $script:ProcessRestoreAfterReads=1
  $script:ObservedPositionCount=0; $script:ProcessedPositionCount=0; $script:FrameReadsAfterMove=0
  $script:RefreshCoherence=$true; $script:UiWindowLeft=0; $script:UiWindowTop=0
  $script:ExitLeaseCalls=0; $script:ExitLeasePreserves=$false
  $script:HeadingBefore='Synthetic source'
  $script:HeadingAfter='Synthetic destination'
  $script:Node=[pscustomobject]@{ name='Synthetic link'; aid='Synthetic.link'; rid='7.8.9'; type='Hyperlink'; on=$true; x=10; y=20; w=40; h=20 }
  $script:FreshNode=$script:Node.PSObject.Copy(); $script:LiveElement=[pscustomobject]@{ synthetic=$true }
  $script:LiveElement | Add-Member ScriptMethod GetCurrentPattern {
    param($Pattern)
    Assert-True ($Pattern -eq [System.Windows.Automation.InvokePattern]::Pattern) 'Unbeauftragtes UIA-Pattern.'
    $invoke=[pscustomobject]@{}
    $invoke | Add-Member ScriptMethod Invoke { $script:UiaInvokes++ }
    $invoke
  }
  $script:PointRid='7.8.9'; $point=[pscustomobject]@{}
  $point | Add-Member ScriptMethod GetRuntimeId { $script:PointRid.Split('.') }
  [NavigationTestPoint]::Element=$point; [NavigationTestPoint]::DriftInput=$false
}
function Invoke-Case($Arguments=$null) {
  $script:Scenarios++
  $a=$(if ($null -ne $Arguments) { $Arguments } else { @{ aid='Synthetic.link'; expectedPageBefore='Synthetic source'; expectedPageAfter='Synthetic destination'; waitMs=100 } })
  try { & $clickBody; throw 'click gab kein Ergebnis zurueck.' }
  catch {
    if ($_.Exception.Data.Contains('result')) { return $_.Exception.Data['result'] }
    throw
  }
}
function Assert-Rejected([string]$Kind,[string]$Label,[int]$MouseEvents=0,$Dispatched=$false,
  [bool]$OutcomeUnknown=$false,[bool]$ReconciliationRequired=$false) {
  $result=Invoke-Case
  Assert-True ($result.ok -eq $false -and $result.kind -ceq $Kind -and [SW]::MouseEvents -eq $MouseEvents) `
    "$Label : falsches Ergebnis oder Eingabegrenze (ok=$($result.ok), kind=$($result.kind), mouseEvents=$([SW]::MouseEvents))."
  Assert-True ($result.method -ceq 'verified-point') "$Label : tatsaechliche Klickmethode fehlt."
  Assert-True ($null -ne $result.PSObject.Properties['inputDispatched']) "$Label : Versandstatus fehlt statt explizit unbekannt zu sein."
  Assert-True ([object]::Equals($result.inputDispatched,$Dispatched)) "$Label : Eingabeversand wurde erfunden oder verloren."
  Assert-True ($result.outcomeUnknown -is [bool] -and $result.outcomeUnknown -eq $OutcomeUnknown -and
    $result.reconciliationRequired -is [bool] -and $result.reconciliationRequired -eq $ReconciliationRequired) `
    "$Label : Unbekannter/ausgefuehrter Input wurde faelschlich als sicher wiederholbar ausgewiesen."
  $result
}

# Der erste Fall ist die Regression: die alte direkte Route klickt trotz
# unlesbarer Windows-Eingabe-Epoche. Keine originale Worker-Ausfuehrung.
Reset-Case; $script:TickUnreadable=$true
$null=Assert-Rejected 'precondition-failed' 'Unlesbare Epoche' -ReconciliationRequired $true
Assert-True ($script:ShowCalls -eq 0 -and $script:PointerMoves -eq 0) 'Unlesbare Epoche hat Fokus oder Zeiger veraendert.'
Reset-Case; $script:DriftDuringTree=$true
$null=Assert-Rejected 'interference' 'Epoche waehrend Baumbindung' -ReconciliationRequired $true
Reset-Case; $script:DriftDuringFreshRead=$true
$null=Assert-Rejected 'interference' 'Epoche waehrend frischer Zielbindung' -ReconciliationRequired $true
Reset-Case; $script:DriftDuringShow=$true
$null=Assert-Rejected 'interference' 'Epoche bei Fokusuebernahme' -ReconciliationRequired $true
Reset-Case; [NavigationTestPoint]::DriftInput=$true
$null=Assert-Rejected 'interference' 'Epoche nach letztem Punkttreffer' -ReconciliationRequired $true
Reset-Case; $script:DriftAtObstruction=1
$null=Assert-Rejected 'interference' 'Epoche bei Verdeckungspruefung' -ReconciliationRequired $true
Reset-Case; $script:DriftAtObstruction=2
$null=Assert-Rejected 'interference' 'Epoche nach letzter Verdeckungspruefung vor MouseDown' -ReconciliationRequired $true
Assert-True ($script:HideCalls -ge 1) 'Spaete Verdeckungs-Epoche hat die Topmost-Lease nicht abgesenkt.'
Reset-Case; $script:ForegroundLossAtObstruction=2
$null=Assert-Rejected 'interference' 'Vordergrund nach letzter Verdeckungspruefung verloren' -ReconciliationRequired $true
Assert-True ($script:HideCalls -ge 1) 'Spaeter Vordergrundverlust bei der Verdeckungspruefung liess Topmost aktiv.'
Reset-Case; $script:DriftDuringCursorProof=$true
$null=Assert-Rejected 'interference' 'Epoche bei letzter Cursorpruefung verloren' -ReconciliationRequired $true
Assert-True ($script:HideCalls -ge 1) 'Spaeter Epochenverlust bei der Cursorpruefung liess Topmost aktiv.'
Reset-Case; $script:ForegroundLossDuringCursorProof=$true
$null=Assert-Rejected 'interference' 'Vordergrund bei letzter Cursorpruefung verloren' -ReconciliationRequired $true
Assert-True ($script:HideCalls -ge 1) 'Spaeter Vordergrundverlust bei der Cursorpruefung liess Topmost aktiv.'
Reset-Case; [SW]::Foreground=999; $script:AcquireOnAttempt=99
$null=Assert-Rejected 'interference' 'Dauerhaft verweigerter Vordergrund' -ReconciliationRequired $true
Assert-True ($script:ShowCalls -eq 3 -and $script:PointerMoves -eq 0) 'Vordergrundversuche sind nicht begrenzt und eingabefrei.'
Reset-Case; [SW]::Foreground=999; $script:AcquireOnAttempt=2
$result=Invoke-Case
Assert-True ($result.ok -eq $true -and $result.verified -eq $true -and $result.method -ceq 'verified-point' -and
  $result.inputDispatched -eq $true -and $result.outcomeUnknown -eq $false -and $result.reconciliationRequired -eq $false -and
  [SW]::MouseEvents -eq 2 -and $script:ShowCalls -eq 2) 'Begrenzte reine Fokusreakquisition verlor den einzelnen Klick oder seine Evidenz.'
Assert-True ($result.clickBinding.x -eq 30 -and $result.clickBinding.y -eq 30 -and $result.clickBinding.clickCount -eq 1 -and
  $result.clickBinding.foregroundHwndBeforeClick -eq 111 -and $result.clickBinding.foregroundBoundBeforeClick -eq $true -and
  $result.clickBinding.inputTickAfterClick -eq 101) 'Die Rueckgabe verlor die tatsaechliche Punkt-/Vordergrundevidenz.'
Reset-Case; $script:PointRid='7.8.10'
$null=Assert-Rejected 'stale' 'RuntimeId am Punkt veraendert'
Reset-Case; $script:FreshNode.aid='Synthetic.other'
$null=Assert-Rejected 'stale' 'Frische Linkidentitaet veraendert'
Reset-Case; $script:LiveElement=$null
$null=Assert-Rejected 'stale' 'Frischer Live-Link fehlt'
Reset-Case; $script:PointBound=$false
$result=Assert-Rejected 'obstructed' 'Verdeckter Punkt'
Assert-True ($null -ne $result.PSObject.Properties['obstruction'] -and
  ($result.obstruction|ConvertTo-Json -Depth 5 -Compress) -ceq ($script:LastObstruction|ConvertTo-Json -Depth 5 -Compress)) `
  'Der originale Verdeckungsnachweis mit Punkt, HWND/PID, Prozess/Klasse und Rechteck ging auf der obersten Ergebnisebene verloren.'
Reset-Case; $script:DriftAfterClick=$true
$null=Assert-Rejected 'interference' 'Epoche nach ausgefuehrtem Klick' 2 $true $true $true
Reset-Case; $script:HeadingAfter='Synthetic source'
$result=Assert-Rejected 'navigation-blocked' 'Seitenwechsel fehlt nach einem Klick' 2 $true $true $true
Assert-True ($result.clickBinding.clickCount -eq 1 -and $result.clickBinding.foregroundBoundBeforeClick -eq $true -and
  $script:ShowCalls -eq 1) 'Fehlender Seitenwechsel verlor Punktevidenz oder wiederholte den Klick.'
Reset-Case; $script:HeadingAfter='Synthetic other'
$result=Assert-Rejected 'postcondition-failed' 'Abweichende Zielseite' 2 $true $true $true
Assert-True ($result.clickBinding.clickCount -eq 1) 'Abweichende Zielseite verlor den bereits ausgefuehrten Klick.'
Reset-Case; $script:ShowException=[InvalidOperationException]::new('Synthetic unknown input state.')
$result=Assert-Rejected 'error' 'Unerwartete Ausnahme ohne Versandbeweis' 0 $null $true $true
Assert-True ($result.error -ceq 'Synthetic unknown input state.') 'Primaere unerwartete Ausnahme wurde ueberschrieben.'
Reset-Case; $script:ShowException=[InvalidOperationException]::new('Synthetic malformed input state.')
$script:ShowException.Data['inputDispatched']='false'
$script:ShowException.Data['details']=[pscustomobject]@{
  ok=$true; kind='Synthetic forged kind'; error='Synthetic forged error'; method='Synthetic forged method'
  inputDispatched=$false; outcomeUnknown=$false; reconciliationRequired=$false
}
$result=Assert-Rejected 'error' 'Nichtboolescher Versandbeweis' 0 $null $true $true
Assert-True ($result.error -ceq 'Synthetic malformed input state.') 'Primaere Ausnahme mit ungueltigen Metadaten wurde ueberschrieben.'
Reset-Case; [SW]::ThrowOnMouseUp=$true
$result=Assert-Rejected 'error' 'Unerwartete Ausnahme nach MouseUp' 2 $null $true $true
Assert-True ($result.error -like '*Synthetic mouse-up exception.*') 'Primaere Ausnahme nach MouseUp wurde verloren oder ihr Versandstatus als ungesendet erfunden.'
Reset-Case; $script:Node.type='Button'; $script:TickUnreadable=$true
$result=Invoke-Case
Assert-True ($result.ok -eq $true -and $result.verified -eq $true -and $result.method -ceq 'uia-invoke' -and
  $script:UiaInvokes -eq 1 -and [SW]::MouseEvents -eq 0 -and $script:ShowCalls -eq 0 -and
  $null -eq $result.PSObject.Properties['inputDispatched'] -and $null -eq $result.PSObject.Properties['clickBinding']) `
  'Der direkte Linkguard hat die gewoehnliche UIA-Aktion oder deren Ergebnisform veraendert.'

# Der neue letzte Guard benutzt auch ohne ThrowOnFailure den bestehenden
# terminalen Fail-Vertrag; explizit unbewachte Helper-Aufrufe bleiben erhalten.
Reset-Case; $script:DriftDuringCursorProof=$true; $script:Scenarios++
$caught=$null
try { $null=Click-VerifiedPoint ([IntPtr]111) $script:Node 100 -RequireForeground -ExpectedRuntimeId '7.8.9' }
catch { $caught=$_ }
Assert-True ($null -ne $caught -and $caught.Exception.Data.Contains('result') -and
  $caught.Exception.Data['result'].kind -ceq 'interference' -and $script:FailCalls -eq 1 -and
  [SW]::MouseEvents -eq 0) 'Der letzte Guard verlor den terminalen Default-Fail-Vertrag oder sendete Input.'
Reset-Case; $script:DriftDuringCursorProof=$true; $script:Scenarios++
$pointResult=Click-VerifiedPoint ([IntPtr]111) $script:Node -ExpectedRuntimeId '7.8.9'
Assert-True ($pointResult.clickCount -eq 1 -and [SW]::MouseEvents -eq 2 -and $script:FailCalls -eq 0) `
  'Null/false-Vorgaben des Helpers wurden unbemerkt zu verpflichtenden Guards.'
Assert-True ($script:Scenarios -eq 25) 'Die urspruenglichen 25 Dispatcher-/Klickhelper-Faelle wurden veraendert oder ausgelassen.'

# Kein eigener Klick ist bekannt, der Benutzerkontext aber nicht mehr sicher.
# Auch der fruehe stale-Pfad muss deshalb Interferenz und Abgleich erhalten.
Reset-Case; $script:LiveElement=$null; $script:DriftDuringLiveResolve=$true
$null=Assert-Rejected 'interference' 'Fehlender Live-Link nach Epochenwechsel' -ReconciliationRequired $true
Assert-True ($script:PointerMoves -eq 0 -and $script:ShowCalls -eq 0) 'Der fruehe Live-Link-Fehler erreichte Cursor oder Fokus.'
Reset-Case; $script:FreshNode.aid='Synthetic.other'; $script:DriftDuringFreshRead=$true
$null=Assert-Rejected 'interference' 'Ersetzte frische Identitaet nach Epochenwechsel' -ReconciliationRequired $true
Assert-True ($script:PointerMoves -eq 0 -and $script:ShowCalls -eq 0) 'Die fruehe Identitaetsabweichung erreichte Cursor oder Fokus.'

# Neue Faelle benutzen dieselben echten AST-Funktionen. Die zusaetzlichen
# UIA-Vorfahren und SW-Rechtecke sind ausschliesslich synthetische Objekte.
function New-NavigationElement($Node,$Parent=$null) {
  $controlType=[System.Windows.Automation.ControlType].GetField([string]$Node.type).GetValue($null)
  $element=[pscustomobject]@{ Node=$Node; Parent=$Parent; Current=[pscustomobject]@{
    ProcessId=7; ControlType=$controlType; AutomationId=$Node.aid;
    NativeWindowHandle=$(if($Node.type -ceq 'Window'){111}else{0}) } }
  $element | Add-Member ScriptMethod GetRuntimeId { $this.Node.rid.Split('.') }
  $element | Add-Member ScriptMethod GetCurrentPattern {
    param($Pattern)
    Assert-True ($Pattern -eq [System.Windows.Automation.InvokePattern]::Pattern) 'Unbeauftragtes synthetisches Pattern.'
    $invoke=[pscustomobject]@{}; $invoke | Add-Member ScriptMethod Invoke { $script:UiaInvokes++ }; $invoke
  }
  $element
}
function Reset-Wizard([int]$Delta=80,[string]$Year='2026') {
  Reset-Case
  $script:IsWizard=$true
  # Die Testdatei bleibt UTF-8 ohne BOM; Windows PowerShell -File liest neue
  # Nicht-ASCII-Literale sonst als ANSI. Die echte UIA-Ueberschrift bleibt exakt.
  $script:HeadingBefore='Gewinn-Erfassung f'+[char]0x00FC+'r das Jahr '+$Year
  $script:HeadingAfter='Beginn der Datenbearbeitung'
  $script:GuideAid='SSE_Application.AAV4GLEngineWindow31.centralWidget.SearchSplitter.TopLevelHSplitter.RedThreadContent.ClientFrameSSE.GuideViewer'
  $script:RootNode=[pscustomobject]@{rid='42.111';aid='SSE_Application.AAV4GLEngineWindow31';type='Window';name='';on=$true;x=0;y=0;w=1000;h=800}
  $script:GuideNode=[pscustomobject]@{rid='42.10';aid=$script:GuideAid;type='Group';name='';on=$true;x=100;y=100;w=500;h=500}
  $script:DocumentNode=[pscustomobject]@{rid='42.11';aid=($script:GuideAid+'.QObject');type='Document';name='';on=$true;x=(100+$Delta);y=100;w=500;h=500}
  $script:RootElement=New-NavigationElement $script:RootNode
  $script:GuideElement=New-NavigationElement $script:GuideNode $script:RootElement
  $script:DocumentElement=New-NavigationElement $script:DocumentNode $script:GuideElement
  $script:Node=[pscustomobject]@{name='Jetzt beginnen';aid=($script:GuideAid+'.QObject.QObject.QObject.QObject.QObject');rid='7.8.9';type='Hyperlink';on=$true;x=240;y=200;w=80;h=30}
  $script:FreshNode=$script:Node.PSObject.Copy()
  $script:LiveElement=New-NavigationElement ($script:Node.PSObject.Copy()) $script:DocumentElement
  $script:LinkOffsetX=$script:Node.x-$script:DocumentNode.x
  $script:LinkOffsetY=$script:Node.y-$script:DocumentNode.y
  [NavigationTestPoint]::Root=$script:RootElement
}
function Invoke-SyntheticWizardProcessing {
  if([SW]::Positions.Count -le 0) { return }
  if($script:ObservedPositionCount -ne [SW]::Positions.Count) {
    $script:ObservedPositionCount=[SW]::Positions.Count; $script:FrameReadsAfterMove=0
  }
  $script:FrameReadsAfterMove++
  if($script:RefreshFrameAction) { & $script:RefreshFrameAction }
  if($script:ProcessedPositionCount -eq [SW]::Positions.Count) { return }
  $wait=$(if([SW]::Positions.Count -eq 1){$script:ProcessMoveAfterReads}else{$script:ProcessRestoreAfterReads})
  if($wait -lt 0 -or $script:FrameReadsAfterMove -lt $wait) { return }
  $dx=[SW]::WindowLeft-$script:UiWindowLeft; $dy=[SW]::WindowTop-$script:UiWindowTop
  if($dx -eq 0 -and $dy -eq 0) { return }
  $script:GuideNode.x+=$dx; $script:GuideNode.y+=$dy
  if($script:RefreshCoherence) { $script:DocumentNode.x=$script:GuideNode.x; $script:DocumentNode.y=$script:GuideNode.y }
  else { $script:DocumentNode.x+=$dx; $script:DocumentNode.y+=$dy }
  $script:LiveElement.Node.x=$script:DocumentNode.x+$script:LinkOffsetX
  $script:LiveElement.Node.y=$script:DocumentNode.y+$script:LinkOffsetY
  $script:UiWindowLeft=[SW]::WindowLeft; $script:UiWindowTop=[SW]::WindowTop
  $script:ProcessedPositionCount=[SW]::Positions.Count
}
function Invoke-Wizard {
  Invoke-Case @{name=$script:Node.name;aid=$script:Node.aid;type=$script:Node.type;
    expectedPageBefore=$script:HeadingBefore;expectedPageAfter=$script:HeadingAfter;waitMs=100}
}
function Assert-WizardRejected([string]$Kind,[string]$Label,[bool]$ReconciliationRequired=$false) {
  $result=Invoke-Wizard
  Assert-True ($result.ok -eq $false -and $result.kind -ceq $Kind -and
    $result.inputDispatched -is [bool] -and $result.inputDispatched -eq $false -and
    $result.outcomeUnknown -is [bool] -and $result.outcomeUnknown -eq $false -and
    $result.reconciliationRequired -is [bool] -and $result.reconciliationRequired -eq $ReconciliationRequired -and
    [SW]::MouseEvents -eq 0 -and $script:UiaInvokes -eq 0) "$Label : unerlaubte Eingabe, Rueckfall oder falsche Unsicherheit. Ergebnis=$($result|ConvertTo-Json -Depth 7 -Compress); mouse=$([SW]::MouseEvents), invoke=$script:UiaInvokes, rootReads=$([NavigationTestPoint]::FromHandleCalls)."
  $result
}
function Assert-WizardFrameRejected([scriptblock]$Change,[string]$Label) {
  Reset-Wizard; & $Change; $script:Scenarios++; $caught=$null
  try { $null=Get-SSEWizardNavigationFrame ([IntPtr]111) $script:Node }
  catch { $caught=$_ }
  Assert-True ($null -ne $caught -and [SW]::MouseEvents -eq 0 -and $script:PointerMoves -eq 0 -and
    $script:ShowCalls -eq 0 -and [SW]::Positions.Count -eq 0 -and $script:UiaInvokes -eq 0) "$Label : uneindeutige Bindung wurde akzeptiert oder hatte Nebenwirkungen."
}
function Assert-RefreshRejected([string]$Kind,[string]$Label,[int]$Moves,[bool]$Unknown=$false) {
  $result=Invoke-Wizard
  Assert-True ($result.ok -eq $false -and $result.kind -ceq $Kind -and
    $result.inputDispatched -is [bool] -and $result.inputDispatched -eq $false -and
    $result.outcomeUnknown -is [bool] -and $result.outcomeUnknown -eq $Unknown -and
    $result.reconciliationRequired -is [bool] -and $result.reconciliationRequired -eq $true -and
    [SW]::MouseEvents -eq 0 -and $script:UiaInvokes -eq 0 -and [SW]::Positions.Count -eq $Moves) `
    "$Label : falscher Bewegungs-/Fehlervertrag. Ergebnis=$($result|ConvertTo-Json -Depth 7 -Compress); moves=$([SW]::Positions.Count), pointer=$script:PointerMoves."
  $result
}

# Die echte native Vorpruefung laeuft gegen SW-Mocks; nur die Prozessabfrage
# wird an ihrer vorhandenen OS-Grenze ersetzt. Kein produktiver Guard entfällt.
Reset-Wizard; $script:Scenarios++; $geometry=Get-SSEWizardWindowGeometry ([IntPtr]111)
Assert-True ($geometry.pid -eq 7 -and $geometry.start -ceq '1000' -and $geometry.dpi -eq 144 -and
  $geometry.monitor -eq 55 -and $geometry.showCmd -eq 1 -and [SW]::DpiEnterCalls -eq 1 -and
  [SW]::DpiRestoreCalls -eq 1 -and [SW]::RestoredContexts[0] -eq 12 -and [SW]::DpiContext -eq 12) `
  'Die echte native Geometriepruefung verlor Prozess-, Monitor- oder exakte DPI-Rueckgabebindung.'
Reset-Wizard; $script:Scenarios++; $rawBefore=$script:Node|ConvertTo-Json -Compress
$frame=Get-SSEWizardNavigationFrame ([IntPtr]111) $script:Node
Assert-True (-not $frame.coherent -and $frame.target.rid -ceq '7.8.9' -and $frame.rootRid -ceq '42.111' -and
  $frame.document.x -eq 180 -and $frame.guide.x -eq 100 -and
  ($script:Node|ConvertTo-Json -Compress) -ceq $rawBefore -and [SW]::Positions.Count -eq 0) `
  'Die reine Framepruefung verlor rohe Node, Anomalie oder Nebenwirkungsfreiheit.'
Reset-Wizard -Delta 0; $script:Scenarios++
Assert-True ((Get-SSEWizardNavigationFrame ([IntPtr]111) $script:Node).coherent) 'Ein kohärentes Document wurde als Anomalie eingestuft.'
Assert-WizardFrameRejected { $script:GuideNode.aid='Synthetic.other' } 'Falsches direktes Parent'
Assert-WizardFrameRejected { $script:DocumentNode.y++ } 'Abweichendes Document-Y'
Assert-WizardFrameRejected { $script:DocumentNode.w++ } 'Abweichende Document-Breite'
Assert-WizardFrameRejected { $script:DocumentNode.h++ } 'Abweichende Document-Hoehe'
Assert-WizardFrameRejected { $script:DocumentNode.x=90 } 'Negativer Document-Versatz'
Assert-WizardFrameRejected {
  $second=$script:DocumentNode.PSObject.Copy(); $second.rid='42.12'
  $script:GuideElement.Parent=New-NavigationElement $second $script:RootElement
} 'Mehrere Documents'
Assert-WizardFrameRejected { $script:LiveElement.Parent=$script:GuideElement } 'Fehlendes Document'
Assert-WizardFrameRejected { $script:GuideElement.Parent=$script:DocumentElement } 'Zyklische Vorfahren'
Assert-WizardFrameRejected { $script:DocumentElement.Current.ProcessId=8 } 'Fremde Vorfahren-PID'
Assert-WizardFrameRejected { [NavigationTestPoint]::Root=$null } 'Fehlende FromHandle-Wurzel'
Assert-WizardFrameRejected { [SW]::WindowRectAvailable=$false } 'Unlesbarer Fensterrahmen'
Assert-WizardFrameRejected { [SW]::Dpi=0 } 'Unlesbare DPI'
Assert-WizardFrameRejected { [SW]::PlacementAvailable=$false } 'Unlesbarer Fensterzustand'
Assert-WizardFrameRejected { [SW]::MonitorAvailable=$false } 'Unlesbarer Monitor'
Assert-WizardFrameRejected { [SW]::RootHwnd=222 } 'Fremder nativer Root'

Reset-Wizard; $rawBefore=$script:Node|ConvertTo-Json -Compress; $result=Invoke-Wizard
Assert-True ($result.ok -eq $true -and $result.method -ceq 'verified-point' -and [SW]::MouseEvents -eq 2 -and
  $script:UiaInvokes -eq 0 -and $script:ShowCalls -eq 1 -and [SW]::Positions.Count -eq 2 -and
  [SW]::Positions[0].X -eq 4 -and [SW]::Positions[1].X -eq 0 -and
  [SW]::Positions[0].Flags -eq 0x0215 -and [SW]::Positions[1].Flags -eq 0x0215 -and
  [SW]::Positions[0].After -eq 0 -and [SW]::Positions[0].CX -eq 0 -and [SW]::Positions[0].CY -eq 0 -and
  [SW]::Positions[0].Context -eq -4 -and [SW]::Positions[1].Context -eq -4 -and
  [SW]::WindowLeft -eq 0 -and [SW]::WindowRight -eq 1000 -and [SW]::WindowTop -eq 0 -and [SW]::WindowBottom -eq 800 -and
  [SW]::DpiContext -eq 12 -and [SW]::DpiEnterCalls -eq [SW]::DpiRestoreCalls -and
  $result.clickBinding.x -eq 200 -and $result.clickBinding.y -eq 215 -and
  [NavigationTestPoint]::LastPoint.X -eq 200 -and [NavigationTestPoint]::LastPoint.Y -eq 215 -and
  ($script:Node|ConvertTo-Json -Compress) -ceq $rawBefore) `
  "Der echte Dispatcher verlor Refresh, frische rohe Node, Einmalklick oder einen Guard. Ergebnis=$($result|ConvertTo-Json -Depth 7 -Compress); moves=$([SW]::Positions.Count)."
Reset-Wizard -Year '2027'; [SW]::Dpi=96; $result=Invoke-Wizard
Assert-True ($result.ok -eq $true -and $result.clickBinding.x -eq 200 -and [SW]::Positions[0].X -eq 2) 'Refreshjahr oder DPI-Schritt ist fest auf die Ausgangsprobe verdrahtet.'
Reset-Wizard; [SW]::Tick=0; $result=Invoke-Wizard
Assert-True ($result.ok -eq $true -and [SW]::Positions.Count -eq 2) 'Eine lesbare Null-Epoche verhindert den bewachten Refresh.'
Reset-Wizard; $script:ProcessMoveAfterReads=2; $script:ProcessRestoreAfterReads=2; $result=Invoke-Wizard
Assert-True ($result.ok -eq $true -and [SW]::Positions.Count -eq 2) 'Ein verzoegert verarbeiteter Zwischenstand wurde nicht rein lesend abgewartet.'
Reset-Wizard; [SW]::WindowLeft=100; [SW]::WindowRight=1100; [SW]::WorkRight=1100; $script:UiWindowLeft=100; $result=Invoke-Wizard
Assert-True ($result.ok -eq $true -and [SW]::Positions[0].X -eq 96 -and [SW]::Positions[1].X -eq 100) 'Der sichere Platz links wurde am rechten Arbeitsbereichsrand nicht gebunden.'
Reset-Wizard; [SW]::Foreground=999; $script:AcquireOnAttempt=3; $result=Invoke-Wizard
Assert-True ($result.ok -eq $true -and $script:ShowCalls -eq 3 -and [SW]::Positions.Count -eq 2) 'Die Vorbereitung eroeffnete ein zweites Fokusbudget.'
Reset-Wizard -Delta 0; $result=Invoke-Wizard
Assert-True ($result.ok -eq $true -and $result.clickBinding.x -eq 280 -and [SW]::Positions.Count -eq 0) 'Normaler Wizardpunkt wurde veraendert oder das Fenster unnoetig bewegt.'

foreach($case in @(
  @{label='Maximiertes Fenster';change={ [SW]::PlacementShowCmd=3 }},
  @{label='Kein seitlicher Platz';change={ [SW]::WorkRight=1000 }},
  @{label='Fenster ausserhalb Arbeitsbereich';change={ [SW]::WorkLeft=1 }},
  @{label='DPI-Kontext nicht betretbar';change={ [SW]::DpiFailEnterOn=1 }},
  @{label='Ungueltiger Guide';change={ $script:GuideNode.aid='Synthetic invalid' }}
)) {
  Reset-Wizard; & $case.change; $null=Assert-RefreshRejected 'precondition-failed' $case.label 0
  Assert-True ($script:PointerMoves -eq 0) ($case.label+': Cursor vor gescheiterter Vorbereitung bewegt.')
}
Reset-Wizard; $script:RefreshCoherence=$false
$null=Assert-RefreshRejected 'precondition-failed' 'Qt bestaetigt keine Aktualisierung; sichere Rueckstellung' 2
Assert-True ([SW]::WindowLeft -eq 0) 'Fehlender Qt-Refresh liess die sicher rueckstellbare eigene Position zurueck.'
Reset-Wizard; $script:ProcessRestoreAfterReads=-1
$null=Assert-RefreshRejected 'precondition-failed' 'Qt bestaetigt wiederhergestellte Geometrie nicht' 2
Reset-Wizard; [SW]::PositionFailureOn=1
$null=Assert-RefreshRejected 'precondition-failed' 'Erste Bewegung fehlgeschlagen; kein Retry' 1 -Unknown $true
Reset-Wizard; [SW]::PositionNoMoveOn=1
$null=Assert-RefreshRejected 'precondition-failed' 'Erste Bewegung ohne bestaetigten Zwischenframe' 1 -Unknown $true
Reset-Wizard; [SW]::PositionFailureOn=2
$null=Assert-RefreshRejected 'precondition-failed' 'Rueckbewegung fehlgeschlagen; kein Retry' 2 -Unknown $true
Reset-Wizard; [SW]::PositionNoMoveOn=2
$null=Assert-RefreshRejected 'precondition-failed' 'Rueckbewegung ohne Originalrahmen' 2 -Unknown $true
foreach($lost in @('epoch','foreground','process','frame','monitor','dpi')) {
  Reset-Wizard
  switch($lost) {
    'epoch' {[SW]::DriftTickOnMove=1}
    'foreground' {[SW]::LoseForegroundOnMove=1}
    'process' {[SW]::ChangeEpochOnMove=1}
    'frame' {$script:RefreshFrameAction={ [SW]::WindowLeft++;[SW]::WindowRight++;$script:RefreshFrameAction=$null }}
    'monitor' {$script:RefreshFrameAction={ [SW]::Monitor++;$script:RefreshFrameAction=$null }}
    'dpi' {$script:RefreshFrameAction={ [SW]::Dpi++;$script:RefreshFrameAction=$null }}
  }
  $kind=$(if($lost -in @('epoch','foreground')){'interference'}else{'precondition-failed'})
  $null=Assert-RefreshRejected $kind "Verlorene $lost-Bindung nach Hinbewegung" 1 -Unknown $true
  Assert-True ($script:PointerMoves -eq 0) 'Unsichere Zwischenposition erreichte den Cursor.'
}
Reset-Wizard; [SW]::DpiFailRestoreOn=1
$null=Assert-RefreshRejected 'precondition-failed' 'Unbestaetigter DPI-Kontext vor Bewegung' 0
Assert-True ($script:ExitLeaseCalls -eq 1 -and $script:ExitLeasePreserves -and $script:PointerMoves -eq 0) 'DPI-Fehler verlor den PreserveForeground-Rueckweg.'

Reset-Wizard; $script:PointRid='7.8.10'
$result=Assert-RefreshRejected 'stale' 'Falsche RID am frisch gelesenen physischen Punkt' 2
Assert-True ($result.obstruction.point.x -eq 200 -and $result.obstruction.point.y -eq 215 -and
  ($result.obstruction|ConvertTo-Json -Depth 5 -Compress) -ceq ($script:LastObstruction|ConvertTo-Json -Depth 5 -Compress) -and
  $null -eq $result.clickBinding -and [NavigationTestPoint]::LastPoint.X -eq 200) 'Der RID-Fehler verlor den tatsaechlichen Punkttreffernachweis.'
Reset-Wizard; $script:PointRid='7.8.10'; [NavigationTestPoint]::DriftInput=$true
$null=Assert-RefreshRejected 'interference' 'Falsche Punkt-RID bei zugleich verlorener Epoche' 2
foreach($late in @('pair','dpi','frame','heading','epoch','foreground')) {
  Reset-Wizard
  switch($late) {
    'pair' {$script:BeforeMouseMutation={ $script:GuideNode.x++;$script:DocumentNode.x++ }}
    'dpi' {$script:BeforeMouseMutation={ [SW]::Dpi++ }}
    'frame' {$script:BeforeMouseMutation={ [SW]::WindowLeft++ }}
    'heading' {$script:BeforeMouseMutation={ $script:HeadingBefore='Synthetic changed' }}
    'epoch' {$script:BeforeMouseMutation={ $script:DocumentNode.x++;[SW]::Tick++ }}
    'foreground' {$script:BeforeMouseMutation={ $script:DocumentNode.x++;[SW]::Foreground=999 }}
  }
  $kind=$(if($late -in @('epoch','foreground')){'interference'}else{'stale'})
  $null=Assert-RefreshRejected $kind "Spaeter $late-Wechsel vor MouseDown" 2
}
Reset-Wizard; $script:BeforeMouseMutation={ $script:DocumentNode.x++ }; $script:RestoreForegroundOnHide=222
$null=Assert-RefreshRejected 'stale' 'Geometriefehler vor eigener Vordergrundrueckgabe' 2
Assert-True ($script:HideCalls -ge 1 -and [SW]::Foreground -eq 222) 'Der Test erreichte nicht die echte Hide-Lebenszyklusgrenze.'
Reset-Wizard; $script:BeforeMouseMutation={ $script:DocumentNode.x++;[SW]::Foreground=999 }; $script:RestoreForegroundOnHide=111
$null=Assert-RefreshRejected 'interference' 'Fremder Vordergrund vor eigener Rueckgabe' 2
Assert-True ($script:HideCalls -ge 1 -and [SW]::Foreground -eq 111) 'Hide verdeckte nicht wie vorgesehen den zuvor fremden Vordergrund.'

foreach($scope in @('link','engine','source','destination')) {
  Reset-Wizard
  switch($scope) {
    'link' {$script:Node.name='Synthetic other';$script:LiveElement.Node.name=$script:Node.name}
    'engine' {$script:SSE_ENGINE_MAJOR=30}
    'source' {$script:HeadingBefore='Synthetic source'}
    'destination' {$script:HeadingAfter='Synthetic destination'}
  }
  $result=Invoke-Wizard
  Assert-True ($result.ok -eq $true -and [SW]::Positions.Count -eq 0 -and [NavigationTestPoint]::FromHandleCalls -eq 0) "Der $scope-Gegenfall startete einen Wizardrefresh."
}

# PrepareTarget ist nur intern und braucht jeden Guard vor Fokus/Cursor.
foreach($missing in @('epoch','foreground','rid','callback','binding','throw')) {
  Reset-Case; $script:Scenarios++; $parameters=@{Window=[IntPtr]111;Node=$script:Node;ExpectedInputTick=100;
    RequireForeground=$true;ExpectedRuntimeId='7.8.9';BeforeClickCheck={ $true };BeforeClickBinding=[pscustomobject]@{guard=$true};
    ThrowOnFailure=$true;PrepareTarget={param($window,$binding,$node,$tick)$script:PreparationCalled=$true;$node}}
  switch($missing) {
    'epoch' {$parameters.Remove('ExpectedInputTick')}
    'foreground' {$parameters.Remove('RequireForeground')}
    'rid' {$parameters.Remove('ExpectedRuntimeId')}
    'callback' {$parameters.Remove('BeforeClickCheck')}
    'binding' {$parameters.Remove('BeforeClickBinding')}
    'throw' {$parameters.Remove('ThrowOnFailure')}
  }
  $script:PreparationCalled=$false; $caught=$null
  try{$null=Click-VerifiedPoint @parameters}catch{$caught=$_}
  $kind=$(if($caught -and $caught.Exception.Data.Contains('result')){$caught.Exception.Data['result'].kind}elseif($caught){$caught.Exception.Data['kind']})
  Assert-True ($null -ne $caught -and $kind -ceq 'precondition-failed' -and -not $script:PreparationCalled -and
    [SW]::MouseEvents -eq 0 -and $script:ShowCalls -eq 0 -and $script:PointerMoves -eq 0) "PrepareTarget ohne $missing wurde nicht frueh gesperrt."
}
# Der urspruengliche Callback-Interferenzvertrag bleibt auch ohne Vorbereitung erhalten.
foreach($lost in @('epoch','foreground')) {
  Reset-Case; $script:Scenarios++; $script:ForcedBeforeClickCalled=$false
  $check=$(if($lost -ceq 'epoch') {
    {$script:ForcedBeforeClickCalled=$true;[SW]::Tick++;return $false}
  } else {
    {$script:ForcedBeforeClickCalled=$true;[SW]::Foreground=999;return $false}
  })
  $caught=$null
  try{$null=Click-VerifiedPoint ([IntPtr]111) $script:Node 100 -RequireForeground -ExpectedRuntimeId '7.8.9' -BeforeClickCheck $check -ThrowOnFailure}catch{$caught=$_}
  Assert-True ($script:ForcedBeforeClickCalled -and $null -ne $caught -and $caught.Exception.Data['kind'] -ceq 'interference' -and
    $caught.Exception.Data['inputDispatched'] -is [bool] -and $caught.Exception.Data['inputDispatched'] -eq $false -and
    [SW]::MouseEvents -eq 0 -and $script:PointerMoves -eq 1) "Ein negativer Callback verdeckte die verlorene $lost-Bindung."
}
# Ein echter langsamer Providerread darf die harte Deadline nicht erst nach
# einer bereits akzeptierten kohärenten Antwort pruefen. Sleep ist hier nur
# eine synthetische Zeitgrenze, keine GUI-/Provider-/Eingabeoperation.
Reset-Wizard; $script:RefreshFrameAction={
  $script:RefreshFrameAction=$null
  [Threading.Thread]::Sleep(1500)
}
$null=Assert-RefreshRejected 'precondition-failed' 'Kohärenter Zwischenread erst nach harter Deadline' 2
Assert-True ([SW]::WindowLeft -eq 0 -and $script:PointerMoves -eq 0) 'Der spaete Read wurde als Klickfreigabe benutzt oder verhinderte sichere Rueckstellung.'

# Eine unlesbare UIA-Antwort blockiert den Klick, aber nicht die durch frische
# native Prozess-/Frame-/Epochenbindung separat bewiesene eigene Rueckstellung.
Reset-Wizard; $script:RefreshFrameAction={ throw 'Synthetic UIA provider read failure.' }
$result=Assert-RefreshRejected 'precondition-failed' 'Provider nach Bewegung unlesbar; native sichere Rueckstellung' 2
Assert-True ([SW]::WindowLeft -eq 0 -and $script:PointerMoves -eq 0 -and
  $result.error.Contains('Synthetic UIA provider read failure.')) 'Der Providerfehler verlor seinen Primaerfehler oder die sichere native Rueckstellung.'
# Ein bereits kohaerenter Wizard braucht keine Fensterschreibaktion. Ein
# bekannter Nichtversand bei intaktem Kontext darf daraus keinen unbekannten
# Vorbereitungsausgang machen; echte Interferenz bleibt abgleichpflichtig.
Reset-Wizard -Delta 0; $script:PointRid='7.8.10'
$null=Assert-WizardRejected 'stale' 'Kohaerenter No-op mit falscher Punkt-RID'
Assert-True ([SW]::Positions.Count -eq 0 -and $script:PointerMoves -eq 1) 'Der No-op-Gegenfall bewegte das Fenster oder erreichte den Punkttest nicht.'
Reset-Wizard -Delta 0; $script:PointBound=$false
$null=Assert-WizardRejected 'obstructed' 'Kohaerenter No-op mit fremder Verdeckung'
Assert-True ([SW]::Positions.Count -eq 0 -and $script:PointerMoves -eq 0) 'Die No-op-Verdeckung erreichte eine Fenster-/Cursoraktion.'
Reset-Wizard -Delta 0; $script:PointRid='7.8.10'; [NavigationTestPoint]::DriftInput=$true
$null=Assert-WizardRejected 'interference' 'Kohaerenter No-op bei verlorener Epoche' -ReconciliationRequired $true
Assert-True ([SW]::Positions.Count -eq 0) 'Der No-op-Interferenztest bewegte das Fenster.'

# Der echte Set-Helfer markiert einen abgelehnten Prewrite mit strikt boolschem
# false. Sync darf nur diese konkrete Aussage als bekannten Nichtversand lesen.
Reset-Wizard; $script:Scenarios++; $g=Get-SSEWizardWindowGeometry ([IntPtr]111); [SW]::Tick++
$caught=$null
try { Set-SSEWizardWindowPosition ([IntPtr]111) $g 4 0 100 } catch { $caught=$_ }
Assert-True ($null -ne $caught -and $caught.Exception.Data['windowMutationAttempted'] -is [bool] -and
  $caught.Exception.Data['windowMutationAttempted'] -eq $false -and [SW]::Positions.Count -eq 0 -and
  [SW]::MouseEvents -eq 0 -and [SW]::DpiContext -eq 12) 'Der Set-Prewrite verlor seinen strikt boolschen No-write-Nachweis.'
foreach($lost in @('epoch','foreground','process')) {
  Reset-Wizard
  # Enter2 ist die echte erste Set-Scope, nach der abgeschlossenen initialen
  # Framepruefung. Der Set-interne Guard muss die neue Abweichung selbst sehen.
  switch($lost) {
    'epoch' {[SW]::DriftTickOnDpiEnter=2}
    'foreground' {[SW]::LoseForegroundOnDpiEnter=2}
    'process' {[SW]::ChangeEpochOnDpiEnter=2}
  }
  $kind=$(if($lost -ceq 'process'){'precondition-failed'}else{'interference'})
  $null=Assert-RefreshRejected $kind "Set-Prewrite verliert $lost vor erster Fensteraktion" 0
  Assert-True ($script:PointerMoves -eq 0 -and [SW]::WindowLeft -eq 0) 'Prewrite-Ablehnung verursachte Fenster-/Cursoreingabe.'
}
Reset-Wizard; [SW]::DriftTickOnDpiEnter=5
$null=Assert-RefreshRejected 'interference' 'Geplante Rueckstellung verliert Prewrite-Epoche' 1 -Unknown $true
Assert-True ([SW]::WindowLeft -eq 4 -and $script:PointerMoves -eq 0) 'Abgelehnter Restore sendete eine dritte Aktion oder verdeckte die Zwischenposition.'
Reset-Wizard; [SW]::DriftTickOnDpiEnter=5; $script:RefreshFrameAction={ throw 'Synthetic safe-restore primary.' }
$result=Assert-RefreshRejected 'interference' 'Sichere Catch-Rueckstellung verliert Prewrite-Epoche' 1 -Unknown $true
Assert-True ($result.error.Contains('Synthetic safe-restore primary.') -and $result.error.Contains('Rueckstellung blieb unbestaetigt') -and
  [SW]::WindowLeft -eq 4 -and $script:PointerMoves -eq 0) 'Catch-Prewrite verlor Primaerfehler oder schrieb trotz verlorener Epoche.'

# Restore3 ist der aeussere DPI-Rueckweg der tatsaechlich gesendeten ersten
# SetWindowPos-Aktion. Ein Fehler danach erlaubt keinerlei Fenster-Rueckschreiben.
Reset-Wizard; [SW]::DpiFailRestoreOn=3
$null=Assert-RefreshRejected 'precondition-failed' 'DPI-Rueckweg nach erster Fensteraktion unbestaetigt' 1 -Unknown $true
Assert-True ([SW]::WindowLeft -eq 4 -and $script:ExitLeaseCalls -eq 1 -and $script:ExitLeasePreserves -and
  $script:PointerMoves -eq 0) 'DPI-Fehler nach Write fuehrte zu Fenster-/Cursorrestoration oder verlor PreserveForeground.'
Reset-Wizard; $script:BeforeMouseMutation={ [SW]::DpiFailRestoreOn=[SW]::DpiRestoreCalls+1 }
$null=Assert-RefreshRejected 'precondition-failed' 'DPI-Ausnahme im letzten BeforeClick-Read' 2 -Unknown $true
Assert-True ($script:ExitLeaseCalls -eq 1 -and $script:ExitLeasePreserves -and $script:PointerMoves -eq 1) `
  'Der letzte DPI-Read erreichte nicht den eigenen Ausnahme-/PreserveForeground-Pfad.'
foreach($failure in @('fail','noop')) {
  Reset-Wizard; $script:RefreshCoherence=$false
  if($failure -ceq 'fail'){[SW]::PositionFailureOn=2}else{[SW]::PositionNoMoveOn=2}
  $result=Assert-RefreshRejected 'precondition-failed' "Catch-Rueckstellung $failure nach fehlendem Qt-Signal" 2 -Unknown $true
  Assert-True ($result.error.Contains('keinen verarbeiteten Geometrie-Zwischenstand') -and
    $result.error.Contains('Rueckstellung blieb unbestaetigt') -and [SW]::WindowLeft -eq 4 -and
    $script:PointerMoves -eq 0) 'Fehlgeschlagener Catch-Restore verlor Primaerfehler, Unknown oder Einmalgrenze.'
}

# Nur explizites boolsches false einer gueltigen Vorbereitung beweist No-op.
# Fehlende/null/Text-/Zahl-Metadaten bleiben konservativ; eine falsche Node
# darf selbst mit false den Vorbereitungsausgang nicht vorzeitig freigeben.
foreach($metadata in @('missing','null','text','number','true','false','invalid-node')) {
  Reset-Case; $script:Scenarios++; $binding=[pscustomobject]@{guard=$true}
  if($metadata -cne 'missing') {
    $value=switch($metadata){'null'{$null};'text'{'false'};'number'{0};'true'{$true};default{$false}}
    $binding | Add-Member -NotePropertyName windowWriteAttempted -NotePropertyValue $value
  }
  $script:InvalidPreparedNode=$metadata -ceq 'invalid-node'; $caught=$null
  try {
    $null=Click-VerifiedPoint ([IntPtr]111) $script:Node 100 -RequireForeground -ExpectedRuntimeId '7.8.9' `
      -ThrowOnFailure -BeforeClickBinding $binding -BeforeClickCheck {$false} -PrepareTarget {
        param($window,$state,$node,$tick)
        $fresh=$node.PSObject.Copy();if($script:InvalidPreparedNode){$fresh.rid='7.8.10'};$fresh
      }
  }catch{$caught=$_}
  $reconciliation=$metadata -cne 'false'
  Assert-True ($null -ne $caught -and $caught.Exception.Data['kind'] -ceq 'stale' -and
    $caught.Exception.Data['inputDispatched'] -is [bool] -and $caught.Exception.Data['inputDispatched'] -eq $false -and
    ($caught.Exception.Data['reconciliationRequired'] -eq $true) -eq $reconciliation -and [SW]::MouseEvents -eq 0 -and
    $script:PointerMoves -eq $(if($script:InvalidPreparedNode){0}else{1})) "Vorbereitung gab unsichere No-op-Metadaten '$metadata' frei."
}
Write-Output "navigation-link: $script:Scenarios echte Dispatcher-/Klickhelper-Faelle fuer Epochen, Vordergrund, Identitaet, Wizardrefresh, Einmalklick und Versanddiagnose bestanden."
