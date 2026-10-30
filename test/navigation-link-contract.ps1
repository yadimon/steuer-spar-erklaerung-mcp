param([string]$WorkerPath)
# Der echte click-Dispatcher und Klickhelper laufen nur gegen synthetische
# Grenzen. SW/Point enthalten weder P/Invoke noch Eingabe-/Fensterzugriffe.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
if (-not $WorkerPath) { $WorkerPath = Join-Path $PSScriptRoot '../powershell/sse-worker.ps1' }
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($WorkerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Der Worker konnte nicht geparst werden.' }
foreach ($name in @('Click-VerifiedPoint', 'Test-SSELastInputUnchanged')) {
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
 public static long Foreground=111;
 public static ulong Tick=100;
 public static int MouseEvents;
 public static bool ThrowOnMouseUp;
 public static IntPtr GetForegroundWindow(){return new IntPtr(Foreground);}
 public static bool IsWindow(IntPtr hwnd){return hwnd.ToInt64()==111;}
 public static uint GetWindowThreadProcessId(IntPtr hwnd,out int pid){pid=7;return 1;}
 public static void mouse_event(int flags,int x,int y,int data,IntPtr extra){
  MouseEvents++; if(flags==4){Tick++;if(ThrowOnMouseUp)throw new InvalidOperationException("Synthetic mouse-up exception.");}
 }
}
public static class NavigationTestPoint {
 public static object Element;
 public static bool DriftInput;
 public static object FromPoint(object point){if(DriftInput)SW.Tick++;return Element;}
}
'@
$script:AE = [NavigationTestPoint]
$WLK = [pscustomobject]@{}
$WLK | Add-Member ScriptMethod GetParent { param($Element) $null }
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
function Get-CurrentHeading { param($Hwnd,$Tree,[switch]$CompactFallback) $(if ([SW]::MouseEvents -or $script:UiaInvokes) { $script:HeadingAfter } else { 'Synthetic source' }) }
function Get-DirtyStateFast { $false }
function Get-DialogInventory { @() }
function Resolve-Nodes { param($Tree,$Args) $Tree.nodes }
function Get-SSEContainerChild { $null }
function Get-SSEMainWindowSelectors { [pscustomobject]@{ heading='Synthetic.heading' } }
function Get-LiveElement { param($Hwnd,$Rid,$Aid) $script:LiveElement }
function Convert-ExactElementToNode {
  param($Element)
  if ($script:DriftDuringFreshRead) { [SW]::Tick++ }
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
function Hide-SSETopmost { param([IntPtr]$Hwnd) $script:HideCalls++ }
function Get-SSEPointObstruction {
  $script:ObstructionCalls++
  if ($script:ObstructionCalls -eq $script:DriftAtObstruction) { [SW]::Tick++ }
  if ($script:ObstructionCalls -eq $script:ForegroundLossAtObstruction) { [SW]::Foreground=999 }
  $script:LastObstruction=[pscustomobject]@{
    isBoundTarget=$script:PointBound; blockerKind=$(if($script:PointBound){'none'}else{'foreign-app'})
    point=[pscustomobject]@{x=30;y=30}; boundWindow=111; boundPid=7
    hitWindow=$(if($script:PointBound){111}else{999}); hitRoot=$(if($script:PointBound){111}else{999})
    hitPid=$(if($script:PointBound){7}else{8}); processName='Synthetic process'; className='Synthetic class'
    rootRect=[pscustomobject]@{x=0;y=0;w=100;h=100}; foregroundHwnd=[SW]::Foreground
  }
  $script:LastObstruction
}
function Set-SSECursorPoint { param($X,$Y,$OnFailure) $script:PointerMoves++ }
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
  $script:WalkCalls=0; $script:ShowCalls=0; $script:HideCalls=0; $script:PointerMoves=0; $script:ObstructionCalls=0
  $script:UiaInvokes=0; $script:FailCalls=0; $script:ForegroundLossAtObstruction=-1; $script:DriftDuringCursorProof=$false; $script:ForegroundLossDuringCursorProof=$false
  $script:TickUnreadable=$false; $script:DriftDuringTree=$false; $script:DriftDuringFreshRead=$false
  $script:DriftDuringShow=$false; $script:DriftAfterClick=$false; $script:DriftAtObstruction=-1
  $script:AcquireOnAttempt=1; $script:PointBound=$true; $script:ShowException=$null
  $script:LastObstruction=$null
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
function Invoke-Case {
  $script:Scenarios++
  $a=@{ aid='Synthetic.link'; expectedPageBefore='Synthetic source'; expectedPageAfter='Synthetic destination'; waitMs=100 }
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
$null=Assert-Rejected 'precondition-failed' 'Unlesbare Epoche'
Assert-True ($script:ShowCalls -eq 0 -and $script:PointerMoves -eq 0) 'Unlesbare Epoche hat Fokus oder Zeiger veraendert.'
Reset-Case; $script:DriftDuringTree=$true
$null=Assert-Rejected 'interference' 'Epoche waehrend Baumbindung'
Reset-Case; $script:DriftDuringFreshRead=$true
$null=Assert-Rejected 'interference' 'Epoche waehrend frischer Zielbindung'
Reset-Case; $script:DriftDuringShow=$true
$null=Assert-Rejected 'interference' 'Epoche bei Fokusuebernahme'
Reset-Case; [NavigationTestPoint]::DriftInput=$true
$null=Assert-Rejected 'interference' 'Epoche nach letztem Punkttreffer'
Reset-Case; $script:DriftAtObstruction=1
$null=Assert-Rejected 'interference' 'Epoche bei Verdeckungspruefung'
Reset-Case; $script:DriftAtObstruction=2
$null=Assert-Rejected 'interference' 'Epoche nach letzter Verdeckungspruefung vor MouseDown'
Assert-True ($script:HideCalls -ge 1) 'Spaete Verdeckungs-Epoche hat die Topmost-Lease nicht abgesenkt.'
Reset-Case; $script:ForegroundLossAtObstruction=2
$null=Assert-Rejected 'interference' 'Vordergrund nach letzter Verdeckungspruefung verloren'
Assert-True ($script:HideCalls -ge 1) 'Spaeter Vordergrundverlust bei der Verdeckungspruefung liess Topmost aktiv.'
Reset-Case; $script:DriftDuringCursorProof=$true
$null=Assert-Rejected 'interference' 'Epoche bei letzter Cursorpruefung verloren'
Assert-True ($script:HideCalls -ge 1) 'Spaeter Epochenverlust bei der Cursorpruefung liess Topmost aktiv.'
Reset-Case; $script:ForegroundLossDuringCursorProof=$true
$null=Assert-Rejected 'interference' 'Vordergrund bei letzter Cursorpruefung verloren'
Assert-True ($script:HideCalls -ge 1) 'Spaeter Vordergrundverlust bei der Cursorpruefung liess Topmost aktiv.'
Reset-Case; [SW]::Foreground=999; $script:AcquireOnAttempt=99
$null=Assert-Rejected 'interference' 'Dauerhaft verweigerter Vordergrund'
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
Write-Output "navigation-link: $script:Scenarios echte Dispatcher-/Klickhelper-Faelle fuer Epochen, Vordergrund, Identitaet, Einmalklick und Versanddiagnose bestanden."
