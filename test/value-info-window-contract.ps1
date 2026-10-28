# Der Weg zur Werte-Info entscheidet ueber den einzigen erlaubten Schreibweg
# fuer Steuerfelder. Er scheiterte schon zweimal an derselben PowerShell-Falle:
# einmal, weil ein einzelner Treffer als Objekt statt als Liste zurueckkam, und
# einmal, weil ein fuehrendes Komma die Liste zusammen mit dem @() der Aufrufer
# ein zweites Mal verpackte - dann meldete `.Count` auch ohne offenes Fenster
# eine Eins, und das vermeintliche Fenster war ein leeres Array mit hwnd 0.
# Beide Faelle sind hier festgenagelt.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-SSEValueInfoWindows'
}, $true))
if ($definition.Count -ne 1) { throw 'Get-SSEValueInfoWindows ist nicht eindeutig vorhanden.' }
Invoke-Expression $definition[0].Extent.Text

$script:WERTE_INFO_TITEL = 'Werte-Info: Werte vergleichen - Was wäre wenn'
$script:FensterStub = @()
function Get-Windows([string]$ProcName = 'SSE') { $script:FensterStub }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Fenster([int]$Pid_, [string]$Title, [int64]$Hwnd) {
  [pscustomobject]@{ hwnd = $Hwnd; pid = $Pid_; title = $Title; w = 640; h = 480 }
}

# Kein Fenster: die Aufrufer duerfen keine Eins sehen.
$script:FensterStub = @(Fenster 42 'Einkommensteuer 2025: irgendein Hauptfenster' 111)
$leer = @(Get-SSEValueInfoWindows 42)
Assert-True ($leer.Count -eq 0) "Ohne Werte-Info muss die Liste leer sein, war $($leer.Count)."

# Genau ein Fenster: ein echtes Fensterobjekt, kein verschachteltes Array.
$script:FensterStub = @(
  (Fenster 42 'Einkommensteuer 2025: irgendein Hauptfenster' 111),
  (Fenster 42 $script:WERTE_INFO_TITEL 222)
)
$eins = @(Get-SSEValueInfoWindows 42)
Assert-True ($eins.Count -eq 1) "Genau ein Treffer erwartet, waren $($eins.Count)."
Assert-True (-not ($eins[0] -is [System.Array])) 'Der Treffer darf kein verschachteltes Array sein.'
Assert-True ([int64]$eins[0].hwnd -eq 222) "hwnd muss 222 sein, war $([int64]$eins[0].hwnd)."

# Fremder Prozess zaehlt nicht mit.
$fremd = @(Get-SSEValueInfoWindows 43)
Assert-True ($fremd.Count -eq 0) 'Ein Fenster fremder PID darf nicht als Werte-Info gelten.'

# Zwei gleiche Fenster bleiben mehrdeutig und werden nicht stillschweigend eines.
$script:FensterStub = @(
  (Fenster 42 $script:WERTE_INFO_TITEL 222),
  (Fenster 42 $script:WERTE_INFO_TITEL 333)
)
$zwei = @(Get-SSEValueInfoWindows 42)
Assert-True ($zwei.Count -eq 2) "Zwei Treffer erwartet, waren $($zwei.Count)."

Write-Output 'Werte-Info-Fenstersuche: leer, eindeutig, fremde PID und mehrdeutig geprueft.'

# Exercise the real open/readiness/close helpers against an adapter whose
# window appears immediately but whose content can arrive in stages.
foreach ($name in @('Open-SSEPlanValueInfoWindow','Open-SSEValueInfoWindow','Open-TrackedResultWindow','Read-TrackedResultWindowComplete','Close-TrackedResultWindow')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "Missing helper $name."
  Invoke-Expression $definitions[0].Extent.Text
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @'
using System;
public static class SW {
  public static bool Open;
  public static bool CloseSucceeds;
  public static int CloseCalls;
  public static int InvokeCalls;
  public static bool PatternAvailable=true,PatternThrows=false;
  public static int InfoPid=42;
  public struct PT { public int X,Y; }
  public static bool GetCursorPos(out PT point) { point=new PT {X=10,Y=20};return true; }
  public static IntPtr GetForegroundWindow() { return new IntPtr(111); }
  public static bool IsWindow(IntPtr hwnd) { return hwnd.ToInt64()==111 || (hwnd.ToInt64()==222 && Open); }
  public static uint GetWindowThreadProcessId(IntPtr hwnd,out int pid) { pid=hwnd.ToInt64()==111?42:(IsWindow(hwnd)?InfoPid:0);return pid==0?0u:1u; }
  public static IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam,
    IntPtr lParam, uint flags, uint timeout, ref IntPtr result) {
    CloseCalls++;
    if (CloseSucceeds) Open = false;
    return new IntPtr(1);
  }
}
public sealed class ValueInfoInvokePattern {
  public Action Callback;
  public void Invoke() { SW.InvokeCalls++; Callback(); }
}
public sealed class ValueInfoInvokeElement {
  public sealed class State { public int ProcessId=42;public string AutomationId="hoverBtnMehrDetails";public object ControlType; }
  public State Current=new State();
  public int[] RuntimeIds=new int[] {42,7};
  public ValueInfoInvokePattern Pattern=new ValueInfoInvokePattern();
  public int[] GetRuntimeId() { return RuntimeIds; }
  public bool TryGetCurrentPattern(object id,out object pattern) {
    if(SW.PatternThrows)throw new InvalidOperationException("synthetic-pattern-read");
    pattern=SW.PatternAvailable?Pattern:null;return SW.PatternAvailable;
  }
}
'@
$script:buttonRid='42.7'
$script:invokeTick=999;$script:invokeWindowCount=1;$script:invokeThrows=$false;$script:rejectTickDelta=1;$script:rejectKind='interference'
function Walk-Tree {
  if($script:walkChangesTick){$script:inputTick++;$script:walkChangesTick=$false}
  [pscustomobject]@{ nodes=@([pscustomobject]@{ type='Button'; aid='hoverBtnMehrDetails'; rid=$script:buttonRid }) }
}
function Get-LiveElement {
  if($script:invokeAvailable){
    $element=New-Object ValueInfoInvokeElement
    $element.Current.ProcessId=$script:buttonProcessId
    $element.Current.ControlType=$script:buttonControlType
    $element.Current.AutomationId=$script:buttonAutomationId
    $element.RuntimeIds=$script:buttonRuntimeIds
    $element.Pattern.Callback=[Action]{
      $script:inputTick=$script:invokeTick
      $script:FensterStub=@(Fenster 42 'Main' 111);[SW]::Open=$false
      for($number=1;$number -le $script:invokeWindowCount;$number++){
        $script:FensterStub+=Fenster 42 $script:WERTE_INFO_TITEL (111+$number*111);[SW]::Open=$true
      }
      if($script:invokeThrows){throw [InvalidOperationException]::new('synthetic-invoke-after-dispatch')}
    }
    return $element
  }
  $null
}
function Get-SSELastInputTick {$script:inputTick}
$script:SSE_FOREGROUND_LEASE=[pscustomobject]@{watch=$null}
$script:leaseMarks=New-Object Collections.ArrayList
function Show-SSEWindow {
  $script:showCalls++;$script:SSE_FOREGROUND_LEASE.watch='fixture-lease'
  if($script:showChangesTick){$script:inputTick++;$script:showChangesTick=$false}
  $true
}
function Hide-SSETopmost { $script:hideCalls++ }
function Set-SSEForegroundLeaseInputCheckpoint($Tick,$Point,[string]$Context){$null=$script:leaseMarks.Add([pscustomobject]@{tick=$Tick;context=$Context})}
$inputGuard=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-SSELastInputUnchanged'},$true))
Assert-True ($inputGuard.Count -eq 1) 'Actual input comparison missing.'
Invoke-Expression $inputGuard[0].Extent.Text
function Click-VerifiedPoint {
  param($Window,$Node,$ExpectedInputTick=$null,[switch]$ThrowOnFailure,[switch]$RequireForeground,[string]$ExpectedRuntimeId='')
  $script:clickCalls++
  $script:clickExpectedInput=$ExpectedInputTick;$script:clickThrows=[bool]$ThrowOnFailure
  $script:clickForeground=[bool]$RequireForeground;$script:clickRid=$ExpectedRuntimeId
  if($script:throwClickSentinel){$script:SSE_CAPTURED_OPERATION_RESULT=$script:originalCaptured;throw [InvalidOperationException]::new($script:SSE_CAPTURE_SENTINEL)}
  if($script:rejectClick){
    $script:inputTick+=$script:rejectTickDelta
    $failure=[InvalidOperationException]::new('synthetic-input-epoch-lost')
    $failure.Data['kind']=$script:rejectKind;$failure.Data['inputDispatched']=$false;throw $failure
  }
  $script:FensterStub = @((Fenster 42 'Main' 111), (Fenster 42 $script:WERTE_INFO_TITEL 222))
  [SW]::Open=$true;$script:SSE_FOREGROUND_LEASE.watch='fixture-click-lease'
  $script:inputTick=17
  if($script:rejectAfterClick){
    $script:inputTick++
    $failure=[InvalidOperationException]::new('synthetic-input-after-click')
    $failure.Data['kind']='interference';$failure.Data['inputDispatched']=$true;throw $failure
  }
  [pscustomobject]@{inputTickAfterClick=17}
}
$script:Sleeps = New-Object Collections.ArrayList
function Start-Sleep([int]$Milliseconds) {
  $null = $script:Sleeps.Add($Milliseconds)
  $script:contextDuringReadiness=$(if($script:SSE_TRACKED_PLAN_INPUT_CONTEXT){$script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint}else{$null})
  if($script:openWindowOnSleep){
    $script:FensterStub+=Fenster 42 $script:WERTE_INFO_TITEL 222
    [SW]::Open=$true;$script:openWindowOnSleep=$false
  }
  if($script:changeTickOnSleep){$script:inputTick=$script:nextSleepTick;$script:changeTickOnSleep=$false}
}
$script:FensterStub = @(Fenster 42 'Main' 111)
$regular = Open-SSEValueInfoWindow ([IntPtr]111) 42
Assert-True ($regular.ok -and $regular.opened) 'Regular value-info open failed.'
Assert-True ($script:Sleeps.Contains(900)) 'Regular content-readiness delay changed.'

$script:Sleeps.Clear()
$script:FensterStub = @(Fenster 42 'Main' 111)
$tracking = Open-TrackedResultWindow ([IntPtr]111)
Assert-True ($tracking.ok -and $tracking.opened) 'Tracked value-info open failed.'
Assert-True (-not $script:Sleeps.Contains(900)) 'Tracked open waits before its mandatory complete readback.'

# A preparatory own click belongs to the same field-plan epoch. Use the
# actual open helper, while the native click is a deterministic boundary.
$script:SSE_TRACKED_PLAN_INPUT_CONTEXT=[pscustomobject]@{checkpoint=0}
$script:inputTick=0
$script:invokeAvailable=$false;[SW]::InvokeCalls=0
$script:FensterStub=@(Fenster 42 'Main' 111);$script:clickCalls=0
$guarded=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
Assert-True ($guarded.ok -and $script:clickCalls -eq 1 -and $script:clickThrows -and $null -ne $script:clickExpectedInput -and $script:clickExpectedInput -eq 0) 'Tracked results lost a valid zero checkpoint before the preparatory click.'
Assert-True ($script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 17) 'The preparatory click did not transfer its returned own checkpoint.'
Assert-True ([SW]::InvokeCalls -eq 0 -and $script:clickForeground -and $script:clickRid -ceq '42.7') 'An unavailable Invoke was replaced by an unbound preparatory click.'
$script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint=0
$script:inputTick=0
$borrowedOpen=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
Assert-True ($borrowedOpen.ok -and -not $borrowedOpen.opened -and $script:clickCalls -eq 1 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) 'Reusing values info sent input or rebased the checkpoint.'
$script:FensterStub=@(Fenster 42 'Main' 111);$script:rejectClick=$true;$script:clickCalls=0;$script:inputTick=0
$refusedOpen=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
Assert-True (-not $refusedOpen.ok -and -not $refusedOpen.opened -and $script:clickCalls -eq 1 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) 'A refused preparatory click was retried or became owned input.'
Assert-True ($refusedOpen.kind -ceq 'interference' -and $refusedOpen.inputDispatched -eq $false -and $refusedOpen.inputGuard.eingriffErkannt) 'A pre-click input refusal lost its precise dispatch and guard evidence.'
$script:rejectClick=$false;$script:rejectAfterClick=$true;$script:inputTick=0;$script:clickCalls=0
$script:FensterStub=@(Fenster 42 'Main' 111)
$postClick=Open-TrackedResultWindow ([IntPtr]111)
Assert-True (-not $postClick.ok -and $postClick.kind -ceq 'interference' -and $null -eq $postClick.opened -and $postClick.inputDispatched -eq $true -and $postClick.cleanupRequired) 'Post-click failure invented a known unopened state.'
Assert-True ($script:clickCalls -eq 1 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0 -and $postClick.inputGuard.eingriffErkannt -and $script:FensterStub.Count -eq 2) 'Post-click interference was retried, rebased or closed an unproven window.'
function Assert-TrackingFailureResult($ExpectedTracking,[string]$ExpectedKind,[bool]$ExpectedUnknown){ & {
 param($ExpectedTracking,$ExpectedKind,$ExpectedUnknown)
 $tracked=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.SwitchStatementAst]},$true)|ForEach-Object{$_.Clauses}|Where-Object{$_.Item1.Value -ceq 'tracked_set_value'})
 Assert-True ($tracked.Count -eq 1) 'Actual field operation missing.'
 $failureBlock=@($tracked[0].Item2.FindAll({param($node)$node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -ceq '-not $tracking.ok'},$true))
 Assert-True ($failureBlock.Count -eq 1) 'Actual tracking refusal block missing.'
 $fail=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Fail'},$true))
 Assert-True ($fail.Count -eq 1) 'Actual failure result builder missing.'
 . ([scriptblock]::Create($fail[0].Extent.Text))
 $tracking=$ExpectedTracking;$script:trackingFailure=$null
 function Emit($Result){$script:trackingFailure=$Result;throw 'synthetic-tracking-result'}
 try{& ([scriptblock]::Create($failureBlock[0].Extent.Text));throw 'Actual caller did not stop'}catch{if($_.Exception.Message -cne 'synthetic-tracking-result'){throw}}
 Assert-True ($script:trackingFailure.kind -ceq $ExpectedKind -and ($script:trackingFailure.resultingState -ceq 'unknown') -eq $ExpectedUnknown -and [bool]$script:trackingFailure.cleanupRequired -eq $ExpectedUnknown) 'The actual child caller changed preparation failure or state certainty.'
 Assert-True ($script:trackingFailure.inputGuard.eingriffErkannt -eq $ExpectedTracking.inputGuard.eingriffErkannt) 'The actual child invented or hid an input-mark mismatch.'
 Assert-True ([object]::Equals($script:trackingFailure.valueInfo.opened,$ExpectedTracking.opened) -and [object]::Equals($script:trackingFailure.valueInfo.inputDispatched,$ExpectedTracking.inputDispatched)) 'The actual child lost the precise pre/post-click opening or dispatch evidence.'
 Assert-True ([object]::ReferenceEquals($script:trackingFailure.valueInfo.failure,$ExpectedTracking.failure) -and [object]::ReferenceEquals($script:trackingFailure.valueInfo.input,$ExpectedTracking.inputEvidence)) 'The actual caller replaced or omitted the original preparation cause or input evidence.'
} $ExpectedTracking $ExpectedKind $ExpectedUnknown }
foreach($trackingProbe in @($refusedOpen,$postClick)){ Assert-TrackingFailureResult $trackingProbe 'interference' $true }
$script:rejectAfterClick=$false
$script:rejectClick=$false;$script:buttonRid='';$script:clickCalls=0;[SW]::InvokeCalls=0;$script:inputTick=0
$script:FensterStub=@(Fenster 42 'Main' 111)
$missingRid=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
Assert-True (-not $missingRid.ok -and -not $missingRid.opened -and $script:clickCalls -eq 0 -and [SW]::InvokeCalls -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) 'A missing button identity caused an unbound click, an Invoke substitution or a fresh input baseline.'

# An owned Invoke is a preparation action, not an inherited-mark reset. Its
# immediate candidate remains local until a unique live window and unchanged
# candidate are both confirmed. The actual helper and comparison run here;
# only UIAutomation/native boundaries are deterministic.
function Reset-PlanOpenFixture {
  $script:SSE_TRACKED_PLAN_INPUT_CONTEXT=[pscustomobject]@{checkpoint=0}
  $script:SSE_FOREGROUND_LEASE=[pscustomobject]@{watch=$null}
  $script:inputTick=0;$script:invokeTick=999;$script:invokeWindowCount=1
  $script:invokeThrows=$false;$script:invokeAvailable=$true
  $script:rejectClick=$false;$script:rejectAfterClick=$false;$script:throwClickSentinel=$false
  $script:rejectTickDelta=1;$script:rejectKind='interference';$script:buttonRid='42.7'
  $script:buttonProcessId=42;$script:buttonRuntimeIds=@(42,7)
  $script:buttonAutomationId='hoverBtnMehrDetails';$script:buttonControlType=[Windows.Automation.ControlType]::Button
  $script:walkChangesTick=$false;$script:showChangesTick=$false
  $script:changeTickOnSleep=$false;$script:openWindowOnSleep=$false;$script:contextDuringReadiness=$null
  $script:showCalls=0;$script:hideCalls=0;$script:clickCalls=0
  $script:leaseMarks.Clear();$script:Sleeps.Clear()
  $script:FensterStub=@(Fenster 42 'Main' 111)
  [SW]::Open=$false;[SW]::InvokeCalls=0;[SW]::CloseCalls=0
  [SW]::PatternAvailable=$true;[SW]::PatternThrows=$false;[SW]::InfoPid=42
}
Reset-PlanOpenFixture
$ownedInvoke=Open-TrackedResultWindow ([IntPtr]111)
Assert-True ($ownedInvoke.ok -and $ownedInvoke.opened -and [SW]::InvokeCalls -eq 1 -and $script:clickCalls -eq 0) 'An available bound Invoke was replaced or repeated.'
Assert-True ($script:showCalls -eq 1 -and $script:hideCalls -eq 1 -and $script:contextDuringReadiness -eq 0) 'Invoke preparation lost the original foreground lease or adopted its candidate before readiness.'
Assert-True ($script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 999 -and $script:leaseMarks.Count -eq 1 -and $script:leaseMarks[0].tick -eq 999) 'The proven Invoke candidate did not advance both own checkpoints exactly once.'
Assert-True ($ownedInvoke.inputEvidence.method -ceq 'invoke' -and $ownedInvoke.inputEvidence.inputBefore -eq 0 -and $ownedInvoke.inputEvidence.candidate -eq 999 -and $null -ne $ownedInvoke.inputEvidence.invokeMs -and $ownedInvoke.inputEvidence.attribution -ceq 'undetermined') 'Invoke evidence claimed an event source or lost its actual action boundary.'

Reset-PlanOpenFixture
$script:invokeTick=0
$zeroInvoke=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
Assert-True ($zeroInvoke.ok -and $null -ne $zeroInvoke.inputEvidence.candidate -and $zeroInvoke.inputEvidence.candidate -eq 0 -and $script:leaseMarks.Count -eq 1 -and $script:leaseMarks[0].tick -eq 0) 'A valid zero post-Invoke candidate became unreadable.'

Reset-PlanOpenFixture
$script:invokeWindowCount=0;$script:openWindowOnSleep=$true
$delayedWindow=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
Assert-True ($delayedWindow.ok -and [SW]::InvokeCalls -eq 1 -and $script:clickCalls -eq 0 -and $script:contextDuringReadiness -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 999) 'A later confirmed window either lost or prematurely adopted its original candidate.'

Reset-PlanOpenFixture
$script:inputTick=1
$lostBeforeInvoke=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
Assert-True (-not $lostBeforeInvoke.ok -and $lostBeforeInvoke.kind -ceq 'interference' -and $lostBeforeInvoke.opened -eq $false -and $lostBeforeInvoke.inputDispatched -eq $false -and [SW]::InvokeCalls -eq 0 -and $script:clickCalls -eq 0 -and $script:showCalls -eq 0) 'Inherited input loss dispatched a preparation action or acquired focus.'

foreach($phase in @('tree','show')){
  Reset-PlanOpenFixture
  $script:walkChangesTick=$phase -ceq 'tree';$script:showChangesTick=$phase -ceq 'show'
  $lostPreparation=Open-TrackedResultWindow ([IntPtr]111)
  Assert-True (-not $lostPreparation.ok -and $lostPreparation.kind -ceq 'interference' -and $lostPreparation.opened -eq $false -and $lostPreparation.inputDispatched -eq $false -and $lostPreparation.inputGuard.eingriffErkannt -and [SW]::InvokeCalls -eq 0 -and $script:clickCalls -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) ('Input loss during preparation was adopted or dispatched: '+$phase)
  Assert-TrackingFailureResult $lostPreparation 'interference' $true
}
foreach($identity in @(
  [pscustomobject]@{name='pid';pid=43;rid=@(42,7);aid='hoverBtnMehrDetails';type=[Windows.Automation.ControlType]::Button},
  [pscustomobject]@{name='runtime-id';pid=42;rid=@(42,8);aid='hoverBtnMehrDetails';type=[Windows.Automation.ControlType]::Button},
  [pscustomobject]@{name='automation-id';pid=42;rid=@(42,7);aid='OtherSyntheticButton';type=[Windows.Automation.ControlType]::Button},
  [pscustomobject]@{name='control-type';pid=42;rid=@(42,7);aid='hoverBtnMehrDetails';type=[Windows.Automation.ControlType]::Edit}
)){
  Reset-PlanOpenFixture
  $script:buttonProcessId=$identity.pid;$script:buttonRuntimeIds=$identity.rid
  $script:buttonAutomationId=$identity.aid;$script:buttonControlType=$identity.type
  $reboundButton=Open-TrackedResultWindow ([IntPtr]111)
  Assert-True (-not $reboundButton.ok -and $reboundButton.kind -ceq 'precondition-failed' -and $reboundButton.opened -eq $false -and $reboundButton.inputDispatched -eq $false -and [SW]::InvokeCalls -eq 0 -and $script:clickCalls -eq 0 -and $script:showCalls -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) ('A changed live button identity dispatched or rebased preparation: '+$identity.name)
  Assert-TrackingFailureResult $reboundButton 'precondition-failed' $false
}
foreach($existingWindow in @(
  [pscustomobject]@{name='ambiguous';count=2;live=$true;pid=42;kind='precondition-failed'},
  [pscustomobject]@{name='stale';count=1;live=$false;pid=42;kind='interference'},
  [pscustomobject]@{name='native-owner-changed';count=1;live=$true;pid=43;kind='interference'}
)){
  Reset-PlanOpenFixture
  for($number=1;$number -le $existingWindow.count;$number++){$script:FensterStub+=Fenster 42 $script:WERTE_INFO_TITEL (111+$number*111)}
  [SW]::Open=$existingWindow.live;[SW]::InfoPid=$existingWindow.pid
  $unboundExisting=Open-TrackedResultWindow ([IntPtr]111)
  Assert-True (-not $unboundExisting.ok -and $unboundExisting.kind -ceq $existingWindow.kind -and $unboundExisting.opened -eq $false -and $unboundExisting.inputDispatched -eq $false -and [SW]::InvokeCalls -eq 0 -and $script:clickCalls -eq 0 -and $script:showCalls -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) ('An ambiguous or changed existing window dispatched preparation: '+$existingWindow.name)
  Assert-TrackingFailureResult $unboundExisting $existingWindow.kind ($existingWindow.kind -ceq 'interference')
}

foreach($scenario in @(
  [pscustomobject]@{name='throw-after-open';throws=$true;tick=999;windows=1;late=$false;pid=42},
  [pscustomobject]@{name='unreadable-candidate';throws=$false;tick=$null;windows=1;late=$false;pid=42},
  [pscustomobject]@{name='input-during-readiness';throws=$false;tick=999;windows=1;late=$true;pid=42},
  [pscustomobject]@{name='no-window';throws=$false;tick=999;windows=0;late=$false;pid=42},
  [pscustomobject]@{name='ambiguous-window';throws=$false;tick=999;windows=2;late=$false;pid=42},
  [pscustomobject]@{name='native-window-owner-changed';throws=$false;tick=999;windows=1;late=$false;pid=43}
)){
  Reset-PlanOpenFixture
  $script:invokeThrows=$scenario.throws;$script:invokeTick=$scenario.tick
  $script:invokeWindowCount=$scenario.windows;$script:changeTickOnSleep=$scenario.late
  $script:nextSleepTick=1000;[SW]::InfoPid=$scenario.pid
  $unproven=Open-TrackedResultWindow ([IntPtr]111)
  Assert-True (-not $unproven.ok -and $unproven.kind -ceq 'interference' -and $null -eq $unproven.opened -and $unproven.inputDispatched -eq $true -and $unproven.cleanupRequired) ('Unproven post-dispatch state was treated as unopened: '+$scenario.name)
  Assert-True ([SW]::InvokeCalls -eq 1 -and $script:clickCalls -eq 0 -and [SW]::CloseCalls -eq 0 -and $script:leaseMarks.Count -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) ('Unproven Invoke was retried, closed or adopted: '+$scenario.name)
  Assert-TrackingFailureResult $unproven 'interference' $true
}

foreach($patternReadThrows in @($false,$true)){
  Reset-PlanOpenFixture
  [SW]::PatternAvailable=$false;[SW]::PatternThrows=$patternReadThrows
  $noPattern=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
  Assert-True ($noPattern.ok -and [SW]::InvokeCalls -eq 0 -and $script:clickCalls -eq 1 -and $script:clickRid -ceq '42.7' -and $script:clickForeground -and $script:contextDuringReadiness -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 17) 'A pre-dispatch pattern failure lost the already supported guarded click or adopted its candidate too early.'
}

Reset-PlanOpenFixture
[SW]::PatternAvailable=$false;$script:rejectClick=$true;$script:rejectTickDelta=0;$script:rejectKind='interference'
$cleanRefusal=Open-TrackedResultWindow ([IntPtr]111)
Assert-True (-not $cleanRefusal.ok -and $cleanRefusal.kind -ceq 'precondition-failed' -and $cleanRefusal.opened -eq $false -and $cleanRefusal.inputDispatched -eq $false -and -not $cleanRefusal.cleanupRequired -and -not $cleanRefusal.inputGuard.eingriffErkannt) 'A known pre-dispatch refusal with intact input became an unknown mutation.'
Assert-True ($cleanRefusal.failure.kind -ceq 'interference' -and $cleanRefusal.failure.error -ceq 'synthetic-input-epoch-lost' -and $script:clickCalls -eq 1 -and [SW]::InvokeCalls -eq 0 -and $script:leaseMarks.Count -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) 'The clean preparation refusal lost its actual cause or was repeated.'
Assert-TrackingFailureResult $cleanRefusal 'precondition-failed' $false

# A captured structured operation result uses the actual sentinel contract.
# A values-info catch must never replace that object with a generic failure.
& {
  Reset-PlanOpenFixture
  $script:SSE_CAPTURE_SENTINEL='SSE_INTERNAL_OPERATION_RESULT_CAPTURED'
  $script:SSE_INTERNAL_PLAN_OPERATIONS=@('tracked_set_value')
  $script:SSE_CAPTURE_OPERATION_RESULT=$false
  $script:originalCaptured=[pscustomobject]@{ok=$false;kind='synthetic-original-capture';resultingState='unknown'}
  $script:throwClickSentinel=$true;[SW]::PatternAvailable=$false
  $capture=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-SSECapturedOperation'},$true))
  Assert-True ($capture.Count -eq 1) 'Actual capture dispatcher missing.'
  . ([scriptblock]::Create($capture[0].Extent.Text))
  function Assert-SSEVerifiedBuildForOperation {}
  function Invoke-SSEWorkerOperation { Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness }
  $captured=Invoke-SSECapturedOperation 'tracked_set_value' ([pscustomobject]@{})
  Assert-True ([object]::ReferenceEquals($captured,$script:originalCaptured) -and -not $script:SSE_CAPTURE_OPERATION_RESULT -and $null -eq $script:SSE_CAPTURED_OPERATION_RESULT -and $script:leaseMarks.Count -eq 0 -and $script:SSE_TRACKED_PLAN_INPUT_CONTEXT.checkpoint -eq 0) 'The preparation catch swallowed the captured result or leaked capture state.'
}
Reset-PlanOpenFixture
Write-Output 'Tracked preparation: owned Invoke, zero, local candidates, uncertain outcomes, guarded click, clean refusal and exact capture propagation passed.'
$script:buttonRid='42.7'
$script:rejectClick=$false;$script:SSE_TRACKED_PLAN_INPUT_CONTEXT=$null
$script:invokeAvailable=$true
$script:FensterStub=@(Fenster 42 'Main' 111);$script:clickCalls=0;[SW]::InvokeCalls=0
$legacyInvoke=Open-SSEValueInfoWindow ([IntPtr]111) 42 -DeferContentReadiness
Assert-True ($legacyInvoke.ok -and [SW]::InvokeCalls -eq 1 -and $script:clickCalls -eq 0 -and $null -eq $script:SSE_TRACKED_PLAN_INPUT_CONTEXT) 'Opening values info outside a physical plan lost its existing Invoke route.'
$script:invokeAvailable=$false

$script:Reads = New-Object Collections.Queue
function Read-TrackedResultWindow { $script:Reads.Dequeue() }
$script:Reads.Enqueue([pscustomobject]@{ ok=$false; rows=@() })
$script:Reads.Enqueue([pscustomobject]@{ ok=$false; rows=@('partial') })
$script:Reads.Enqueue([pscustomobject]@{ ok=$true; rows=@('complete') })
$complete = Read-TrackedResultWindowComplete $tracking.window
Assert-True ($complete.ok -and $complete.rows[0] -ceq 'complete') 'Partial result content was accepted.'
Assert-True ($script:Reads.Count -eq 0) 'Readiness did not re-read incomplete content.'
$script:Reads.Enqueue([pscustomobject]@{ ok=$false; rows=@('partial') })
$incomplete = Read-TrackedResultWindowComplete $tracking.window 0
Assert-True (-not $incomplete.ok) 'Incomplete content became successful at the deadline.'

[SW]::Open = $true; [SW]::CloseSucceeds = $true; [SW]::CloseCalls = 0
$script:Sleeps.Clear()
Assert-True (Close-TrackedResultWindow $tracking) 'Immediately closed tracked window remained open.'
Assert-True ([SW]::CloseCalls -eq 1 -and $script:Sleeps.Count -eq 0) 'Verified immediate close still slept or repeated the close mutation.'
[SW]::Open = $true; [SW]::CloseCalls = 0
$borrowed = [pscustomobject]@{ ok=$true; opened=$false; window=$tracking.window }
Assert-True (Close-TrackedResultWindow $borrowed) 'Borrowed window cleanup failed.'
Assert-True ([SW]::Open -and [SW]::CloseCalls -eq 0) 'Cleanup closed a window it did not open.'
[SW]::CloseSucceeds = $false
Assert-True (-not (Close-TrackedResultWindow $tracking)) 'Unclosed tracked window was reported as closed.'
Assert-True ([SW]::CloseCalls -eq 1) 'Close mutation was repeated while waiting for window disappearance.'

Write-Output 'Tracked results: deferred complete readback, partial/deadline rejection and owned close readiness passed.'

# An omitted optional filter must compare every result row. Exercise the
# actual transaction's argument conversion as well as the real comparator:
# PowerShell can otherwise turn a missing argument into one empty label.
. (Join-Path $root 'powershell/table-values.ps1')
foreach ($name in @('Arg', 'Compare-TrackedResultRows')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "Missing helper $name."
  Invoke-Expression $definitions[0].Extent.Text
}
$labelAssignments = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -ceq '$labels' -and $node.Right.Extent.Text.Contains("'resultLabels'")
}, $true))
Assert-True ($labelAssignments.Count -eq 1) 'Tracked result-label conversion is not unique.'
$resultBefore = [pscustomobject]@{ rows=@(
  [pscustomobject]@{ name='Refund'; aktuell='1.000,50' },
  [pscustomobject]@{ name='Tax'; aktuell='2.000,00' },
  [pscustomobject]@{ name='Unchanged'; aktuell='100,00' }
) }
$resultAfter = [pscustomobject]@{ rows=@(
  [pscustomobject]@{ name='Refund'; aktuell='1.500,75' },
  [pscustomobject]@{ name='Tax'; aktuell='1.500,00' },
  [pscustomobject]@{ name='Unchanged'; aktuell='100.00' }
) }
foreach ($a in @([pscustomobject]@{}, [pscustomobject]@{ resultLabels=$null }, [pscustomobject]@{ resultLabels=@() })) {
  Invoke-Expression $labelAssignments[0].Extent.Text
  Assert-True ($labels.Count -eq 0) 'Absent resultLabels became a nonempty filter.'
  $diff = @(Compare-TrackedResultRows $resultBefore $resultAfter $labels)
  Assert-True ($diff.Count -eq 2) 'Unfiltered result comparison lost changed currency rows.'
  Assert-True ($diff[0].name -ceq 'Refund' -and $diff[0].vorher -ceq '1.000,50' -and $diff[0].nachher -ceq '1.500,75') 'Result diff lost its actual before/after values.'
}
$a = [pscustomobject]@{ resultLabels=@('Tax') }
Invoke-Expression $labelAssignments[0].Extent.Text
$filtered = @(Compare-TrackedResultRows $resultBefore $resultAfter $labels)
Assert-True ($filtered.Count -eq 1 -and $filtered[0].name -ceq 'Tax') 'Explicit resultLabels did not restrict the comparison.'
$a = [pscustomobject]@{ resultLabels=@('Unchanged') }
Invoke-Expression $labelAssignments[0].Extent.Text
Assert-True (@(Compare-TrackedResultRows $resultBefore $resultAfter $labels).Count -eq 0) 'Equivalent result formatting produced a false change.'
Write-Output 'Tracked result diffs: absent/null/empty filters, changed currency rows and explicit filtering passed.'

# A requested row may only appear after a calculation. An unmatched filter
# therefore cannot be rejected against the baseline before the write.
$newAfter = [pscustomobject]@{ rows=@([pscustomobject]@{ name='New tax'; aktuell='250,00' }) }
$newDiff = @(Compare-TrackedResultRows ([pscustomobject]@{ rows=@() }) $newAfter @('New tax'))
Assert-True ($newDiff.Count -eq 1 -and $null -eq $newDiff[0].vorher -and $newDiff[0].nachher -ceq '250,00') 'A requested newly calculated row was lost.'
Assert-True (@(Compare-TrackedResultRows $resultBefore $resultAfter @('Absent row')).Count -eq 0) 'An unmatched filter must not invent changed rows.'
$labelGuards = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
    $node.Extent.Text.Contains('$labels | Where-Object { [string]::IsNullOrWhiteSpace($_) }')
}, $true))
Assert-True ($labelGuards.Count -eq 1) 'Blank result-label guard is not unique.'
function Fail([string]$Message, [string]$Kind) { throw "$Kind`: $Message" }
foreach ($blank in @('', ' ', "`t`n")) {
  $a = [pscustomobject]@{ resultLabels=@($blank) }
  Invoke-Expression $labelAssignments[0].Extent.Text
  $rejected = $false
  try { Invoke-Expression $labelGuards[0].Extent.Text }
  catch { $rejected = $_.Exception.Message -like 'bad-args:*' }
  Assert-True $rejected 'The worker accepted a blank result label.'
}
$a = [pscustomobject]@{ resultLabels=@('New tax') }
Invoke-Expression $labelAssignments[0].Extent.Text
Invoke-Expression $labelGuards[0].Extent.Text

# Use the real parser: a whole-row prefix passes structural completeness.
# The transaction must still wait for consecutive identical content snapshots.
. (Join-Path $root 'powershell/structure-binding.ps1')
foreach ($name in @('Convert-SSEComparableNumber', 'Get-SSETextSha256', 'Read-ResultDetailsFromTree', 'Read-TrackedResultWindow')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "Missing helper $name."
  Invoke-Expression $definitions[0].Extent.Text
}
function Result-Tree([int]$RowCount, [string]$Tax = '2.000,00') {
  $nodes = New-Object Collections.ArrayList
  $null = $nodes.Add([pscustomobject]@{ i=0; p=-1; aid='obj_Wertetabelle'; type='Table' })
  foreach ($label in @('Name', 'Aktuell', 'Festgehalten', 'Differenz')) {
    $index = $nodes.Count
    $null = $nodes.Add([pscustomobject]@{ i=$index; p=0; type='Header'; name=$label; x=($index-1)*100; y=0; w=100; h=20 })
  }
  $rows = @(@('Refund', '1.000,50', '1.000,50', '0,00'), @('Tax', $Tax, $Tax, '0,00'))
  for ($row = 0; $row -lt $RowCount; $row++) {
    for ($column = 0; $column -lt 4; $column++) {
      $null = $nodes.Add([pscustomobject]@{ i=$nodes.Count; p=0; type='DataItem'; name=$rows[$row][$column]; x=$column*100; y=($row+1)*20; w=100; h=20 })
    }
  }
  [pscustomobject]@{ nodes=@($nodes); stats=[pscustomobject]@{ truncated=$false; cyc=$false } }
}
$prefix = Result-Tree 1
$full = Result-Tree 2
$changed = Result-Tree 2 '2.100,00'
$parsedPrefix = Read-ResultDetailsFromTree $prefix
Assert-True ($parsedPrefix.vollstaendig -and $parsedPrefix.anzahl -eq 1) 'The regression fixture must be a structurally complete prefix.'
$beforeAssignments = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -ceq '$resultBefore' -and $node.Right.Extent.Text.Contains('Read-TrackedResultWindowComplete')
}, $true))
Assert-True ($beforeAssignments.Count -eq 1) 'Transaction baseline readback is not unique.'
$script:Trees = New-Object Collections.Queue
function Walk-Tree { $script:Trees.Dequeue() }
[SW]::Open = $true
$tracking.opened = $true
foreach ($tree in @($prefix, $full, $full)) { $script:Trees.Enqueue($tree) }
Invoke-Expression $beforeAssignments[0].Extent.Text
Assert-True ($resultBefore.ok -and $resultBefore.rows.Count -eq 2 -and $script:Trees.Count -eq 0) 'The transaction accepted a growing whole-row prefix as its baseline.'
foreach ($tree in @($full, $changed, $changed)) { $script:Trees.Enqueue($tree) }
Invoke-Expression $beforeAssignments[0].Extent.Text
Assert-True ($resultBefore.ok -and $resultBefore.rows[1].aktuell -ceq '2.100,00' -and $script:Trees.Count -eq 0) 'Readiness checked row count without checking content stability.'
$script:Trees.Enqueue($prefix)
$unstable = Read-TrackedResultWindowComplete $tracking.window 0 -RequireStable
Assert-True (-not $unstable.ok -and -not $unstable.complete -and $unstable.error) 'An unproven baseline became successful at the deadline.'
$tracking.opened = $false
$script:Trees.Enqueue($full)
Invoke-Expression $beforeAssignments[0].Extent.Text
Assert-True ($resultBefore.ok -and $script:Trees.Count -eq 0) 'An already open complete result window unnecessarily required fresh-open stability.'
Write-Output 'Tracked baseline: real-parser prefixes, same-size content changes, deadline and borrowed-window readiness passed.'
