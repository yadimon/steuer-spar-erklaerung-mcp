$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'powershell\table-combobox.ps1')
. (Join-Path $root 'powershell\window-close.ps1')
. (Join-Path $root 'powershell\table-preparation.ps1')
$script:productionPreparationState=(Get-Command Get-SSETablePreparationState).ScriptBlock
function Get-SSETablePreparationState([IntPtr]$MainHwnd) {
  $result=& $script:productionPreparationState $MainHwnd
  if ($script:stateMutation) { & $script:stateMutation $result $script:walks }
  $result
}
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'powershell\sse-worker.ps1'),[ref]$null,[ref]$errors)
if ($errors.Count) {throw 'Worker source does not parse.'}
foreach ($name in @('Arg','Get-SSEBoundedIntegerArg','Get-SSETextSha256','Resolve-SSEClosableNonmodalWindowPolicy',
  'Test-SSESafeAuxiliaryDescriptor','Test-SSESystemOverlayDescriptor','Test-SSEWindowDecorationDescriptor','ConvertTo-Vergleichsform','Test-Versand')) {
  $definitions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($definitions.Count -ne 1) {throw "Production dependency $name is ambiguous."}
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
Add-Type -TypeDefinition @'
using System;
public static class SW {
 public static int Calls, MainPid=7, TipPid=7,ForegroundReads,OwnerReads,PidReads,ExistsReads;
 public static bool Closed, Timeout, ThrowDelivery, MainExists=true, ObserverExists=true;
 public static int ObserverPid=7;public static IntPtr ObserverOwner=new IntPtr(101);
 public static IntPtr Foreground=new IntPtr(101),Owner=new IntPtr(101);
 public static Action OnSend;
 public static IntPtr GetForegroundWindow(){ForegroundReads++;return Foreground;}
 public static IntPtr GetWindow(IntPtr hwnd,uint mode){OwnerReads++;return hwnd.ToInt64()==303?ObserverOwner:Owner;}
 public static uint GetWindowThreadProcessId(IntPtr hwnd,ref int processId){PidReads++;processId=hwnd.ToInt64()==101?MainPid:(hwnd.ToInt64()==303?ObserverPid:TipPid);return 1;}
 public static bool IsWindow(IntPtr hwnd){ExistsReads++;return hwnd.ToInt64()==101 ? MainExists : (hwnd.ToInt64()==303?ObserverExists:!Closed);}
 public static IntPtr SendMessageTimeout(IntPtr hwnd,uint message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,ref IntPtr result){
  if(hwnd.ToInt64()!=202)throw new InvalidOperationException("Only the Tips HWND may be closed");
  Calls++;Closed=true;if(OnSend!=null)OnSend();
  if(ThrowDelivery)throw new InvalidOperationException("Synthetic lost close result");
  return Timeout?IntPtr.Zero:new IntPtr(1);
 }
}
public static class DSK {
 public static bool Isolated=true;
 public static int IsolationReads;
 public static bool IsIsolatedWindowDesktop(IntPtr hwnd,string name) {
  IsolationReads++;
  if(hwnd.ToInt64()!=101 || name!="OwnSyntheticHidden")throw new InvalidOperationException("Wrong isolated preparation target.");
  return Isolated;
 }
}
namespace System.Windows.Automation {
 public static class ControlType {public static object Window=new object(),Edit=new object();}
 public static class WindowPattern {public static object Pattern=new object();}
 public static class AutomationElement {
  public static object Main,Tip,Observer;
  public static int MainReads,TipReads,ObserverReads;
  public static object FromHandle(IntPtr hwnd){if(hwnd.ToInt64()==101){MainReads++;return Main;}if(hwnd.ToInt64()==303){ObserverReads++;return Observer;}TipReads++;return Tip;}
 }
}
'@
$AE=[System.Windows.Automation.AutomationElement]
function Assert-True([bool]$Condition,[string]$Message) {if (-not $Condition) {throw $Message}}
function New-Window([long]$Handle,[string]$Title,[string]$Kind='tips') {
  [pscustomobject]@{hwnd=$Handle;pid=7;title=$Title;kind=$Kind;cls='Qt692QWindow';titleFingerprint=('A'*64);x=100;y=100;w=500;h=400;minimiert=$false;hung=$false}
}
function New-Root([long]$Handle,[string]$Aid,[string]$Rid,[string]$Name) {
  $element=[pscustomobject]@{
    rid=$Rid;pattern=[pscustomobject]@{Current=[pscustomobject]@{IsModal=$false}}
    Current=[pscustomobject]@{ProcessId=7;NativeWindowHandle=$Handle;AutomationId=$Aid;Name=$Name;ControlType=[System.Windows.Automation.ControlType]::Window;IsEnabled=$true}
  }
  $element | Add-Member ScriptMethod GetRuntimeId { $this.rid -split '\.' }
  $element | Add-Member ScriptMethod TryGetCurrentPattern {param($Pattern,$Result) $Result.Value=$this.pattern;[bool]$this.pattern}
  $element
}
function Get-SSEPageObjects { $script:catalog }
function Get-Windows {
  $script:windowReads++
  if ([SW]::Closed) {return @($script:afterWindows)}
  @($script:beforeWindows)
}
function Get-DialogInventory {
  $script:dialogReads++
  if (-not [SW]::Closed -and $script:beforeGuard) { & $script:beforeGuard }
  @(Get-Windows 'SSE')
}
function Get-SSETablePreparationProcessEpoch {
  $script:epochReads++
  if ($script:mode -ceq 'process-reused' -and $script:epochReads -gt 1) {return 124}
  $script:epochValue
}
function Get-SSELastInputTick { $script:tickReads++;$script:tick }
function Test-SSELastInputUnchanged($Expected) { $null -ne $script:tick -and $Expected -eq $script:tick }
function Walk-BoundTree {
    param([IntPtr]$Hwnd,[switch]$WithValues,[switch]$Strict)
    if ($Hwnd -eq [IntPtr]303) {
      Assert-True ($WithValues -and $Strict) 'Observer lost strict values binding.'
      $script:observerWalks++
      if ($script:observerThrows -eq $script:observerWalks) {throw 'Synthetic unreadable observer'}
      $observerCopy=$script:observerTree | ConvertTo-Json -Depth 10 -Compress | ConvertFrom-Json
      if ($script:onObserverWalk) { & $script:onObserverWalk $observerCopy $script:observerWalks }
      return $observerCopy
    }
    Assert-True ($Hwnd -eq [IntPtr]101 -and $WithValues -and $Strict) 'Preparation lost exact main, values or strict provider binding.'
  $script:walks++
  if ($script:mode -ceq 'guard-provider-throws' -and $script:walks -eq 2) {throw 'Synthetic unreadable provider'}
  if ($script:mode -ceq 'post-provider-throws' -and [SW]::Closed) {throw 'Synthetic unreadable provider'}
  if ($script:mode -ceq 'input-during-guard' -and $script:walks -eq 2) {$script:tick++}
  if ($script:mode -ceq 'owner-during-guard' -and $script:walks -eq 2) {[SW]::Owner=[IntPtr]999}
  if ($script:mode -ceq 'peer-during-guard' -and $script:walks -eq 2) {$script:beforeWindows+=New-Window 303 'Unknown' 'qt-dialog'}
  if ($script:mode -ceq 'peer-during-readback' -and [SW]::Closed) {$script:afterWindows+=New-Window 303 'Unknown' 'qt-dialog'}
  if ($script:mode -ceq 'root-during-readback' -and [SW]::Closed) {$AE::Main.rid='1.9'}
  $copy=$script:tree | ConvertTo-Json -Depth 10 -Compress | ConvertFrom-Json
  if ($script:geometrySettled -and $script:walks -ge 2) {$copy.nodes[0].h=601}
  if ($script:onWalk) { & $script:onWalk $copy $script:walks }
  if ($script:walks -eq 2 -and $script:guardNodeMutation) { & $script:guardNodeMutation $copy.nodes[2] }
  if ($script:mode -ceq 'value-before-guard' -and $script:walks -eq 2) {$copy.nodes[2].val='99,00'}
  if ($script:mode -ceq 'value-after-close' -and [SW]::Closed) {$copy.nodes[2].val='99,00'}
  if ($script:mode -ceq 'toggle-after-close' -and [SW]::Closed) {$copy.nodes[2].checked=$true}
  if ($script:mode -ceq 'selection-after-close' -and [SW]::Closed) {$copy.nodes[2].selected=$true}
  if ($script:mode -ceq 'truncated-after-close' -and [SW]::Closed) {$copy.stats.truncated=$true}
  $copy
}
function Get-DirtyStateFast {
  param([IntPtr]$Hwnd)
  Assert-True ($Hwnd -ne [IntPtr]303) 'Observer must not claim main dirty state.'
  if ($script:mode -ceq 'dirty-unknown') {return $null}
  if ($script:mode -ceq 'dirty-unknown-after' -and [SW]::Closed) {return $null}
  if ($script:mode -ceq 'dirty-after-close' -and [SW]::Closed) {return $true}
  if ($script:mode -ceq 'dirty-during-guard' -and $script:walks -eq 2) {return $true}
  $script:currentDirty
}
function Get-CurrentHeading {
  param([IntPtr]$Hwnd)
  Assert-True ($Hwnd -ne [IntPtr]303) 'Observer must not claim main heading.'
  if ($script:mode -ceq 'heading-unknown') {return $null}
  if ($script:mode -ceq 'heading-after-close' -and [SW]::Closed) {return 'Other page'}
  if ($script:mode -ceq 'heading-during-guard' -and $script:walks -eq 2) {return 'Other page'}
  $script:currentHeading
}
function Set-FinalTipModalReadAction([scriptblock]$Action) {
  $script:finalTipModalReadAction=$Action
  $AE::Tip.pattern | Add-Member ScriptProperty Current {
    if ($AE::TipReads -eq 2) { & $script:finalTipModalReadAction }
    [pscustomobject]@{IsModal=$false}
  } -Force
}
function Reset-Scenario {
  $script:DESKTOP_NAME=$null;$script:tickReads=0
  [DSK]::Isolated=$true;[DSK]::IsolationReads=0
  $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false
  $script:mode='';$script:tick=10;$script:walks=0;$script:windowReads=0;$script:dialogReads=0;$script:epochReads=0;$script:beforeGuard=$null;$script:guardNodeMutation=$null
  $script:geometrySettled=$false;$script:onWalk=$null;$script:stateMutation=$null;$script:epochValue=123
  $script:currentDirty=$false;$script:currentHeading='Synthetic table'
  $script:observerWalks=0;$script:onObserverWalk=$null;$script:observerThrows=-1;$script:observerTree=$null
  [SW]::ObserverExists=$true;[SW]::ObserverPid=7;[SW]::ObserverOwner=[IntPtr]101;$AE::ObserverReads=0;$AE::Observer=$null
  [SW]::Calls=0;[SW]::Closed=$false;[SW]::Timeout=$false;[SW]::ThrowDelivery=$false;[SW]::MainExists=$true
  [SW]::ForegroundReads=0;[SW]::OwnerReads=0;[SW]::PidReads=0;[SW]::ExistsReads=0
  [SW]::MainPid=7;[SW]::TipPid=7;[SW]::Foreground=[IntPtr]101;[SW]::Owner=[IntPtr]101;[SW]::OnSend=$null
  $AE::MainReads=0;$AE::TipReads=0
  $script:catalog=[pscustomobject]@{windows=[pscustomobject]@{taxTips=[pscustomobject]@{
    title='Steuer-Spar-Tipps';role='nonmodal-help-window';closePolicy='allow-exact-nonmodal-close'
    tablePreparationPolicy=[pscustomobject]@{mode='close-once-before-table-binding';automationId='SSE_Application.SteuerSparTipps-Dialog';owner='exact-bound-main';requireNonModal=$true}
  }}}
  $script:main=New-Window 101 'Synthetic case' 'main';$script:tip=New-Window 202 'Steuer-Spar-Tipps'
  $script:beforeWindows=@($script:main,$script:tip);$script:afterWindows=@($script:main)
  $AE::Main=New-Root 101 'Synthetic.Application' '1.1' 'Synthetic case'
  $AE::Tip=New-Root 202 'SSE_Application.SteuerSparTipps-Dialog' '1.2' 'Steuer-Spar-Tipps'
  $script:tree=[pscustomobject]@{
    stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0}
    nodes=@(
      [pscustomobject]@{i=0;p=-1;type='Pane';aid='Synthetic.Page';rid='2.1';name='Synthetic table';on=$true;x=10;y=10;w=800;h=600},
      [pscustomobject]@{i=1;p=0;type='Table';aid='Synthetic.Table';rid='2.2';on=$true;x=20;y=50;w=600;h=300},
      [pscustomobject]@{i=2;p=1;type='DataItem';aid='Synthetic.Table';rid='2.3';name='15,00';val='15,00';ro=$true;checked=$false;selected=$false;on=$true;x=20;y=50;w=100;h=25}
    )
  }
}
function Assert-Preparation([string]$Label,[bool]$ExpectedOk,[int]$ExpectedCalls,[bool]$ExpectedUnknown=$false) {
  $result=Invoke-SSETablePreparation ([IntPtr]101) 7
  Assert-True ($result.ok -eq $ExpectedOk -and [SW]::Calls -eq $ExpectedCalls) "$Label : $($result | ConvertTo-Json -Depth 6 -Compress); close count $([SW]::Calls)."
  if ($ExpectedOk) {
    Assert-True ($result.prepared -and $result.verified -and $result.windowId -ceq 'taxTips') "$Label did not prove exact preparation."
  } else {
    Assert-True ($result.kind -ceq 'table-preparation-failed' -and $result.retryable -is [bool] -and -not $result.retryable -and
      $result.outcomeUnknown -eq $ExpectedUnknown -and $result.preparationAttempted -eq ($ExpectedCalls -gt 0) -and
      $result.reconciliationRequired -eq $ExpectedUnknown) "$Label lost the terminal close outcome."
    Assert-True ([bool]$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS -eq $ExpectedUnknown) "$Label lost the outer foreground preservation boundary."
  }
  $result
}

Reset-Scenario
$script:beforeWindows=@($script:main)
$result=Invoke-SSETablePreparation ([IntPtr]101) 7
Assert-True ($result.ok -and -not $result.prepared -and [SW]::Calls -eq 0 -and $script:walks -eq 0 -and
  $AE::MainReads -eq 0 -and $AE::TipReads -eq 0 -and $script:epochReads -eq 0 -and $script:windowReads -eq 1) 'No-Tips fast path performed expensive bindings or actions.'
Reset-Scenario
$script:catalog.windows.taxTips.PSObject.Properties.Remove('tablePreparationPolicy')
$result=Invoke-SSETablePreparation ([IntPtr]101) 7
Assert-True ($result.ok -and -not $result.prepared -and [SW]::Calls -eq 0 -and $script:walks -eq 0 -and $script:windowReads -eq 0) 'Unapproved profile performed preparation.'
Reset-Scenario
[SW]::OnSend={
  Assert-True ([SW]::ForegroundReads -eq 3 -and [SW]::OwnerReads -eq 2 -and [SW]::PidReads -eq 3 -and [SW]::ExistsReads -eq 3) 'Successful guard diagnostics changed the original Win32 query counts.'
}
$result=Assert-Preparation 'Exact owned nonmodal Tips' $true 1
Assert-True ($script:walks -eq 3 -and $AE::MainReads -eq 3 -and $AE::TipReads -eq 2) 'Preparation did not obtain fresh before/dispatch/after main and exact Tips identities.'
Assert-True ($script:windowReads -eq 8 -and $script:dialogReads -eq 2 -and $script:epochReads -eq 5) 'Successful diagnostic path changed the original query counts.'
Assert-True ($null -eq $result.PSObject.Properties['nodes']) 'Private comparison evidence escaped the preparation result.'
Reset-Scenario
[SW]::Foreground=[IntPtr]202;[SW]::OnSend={[SW]::Foreground=[IntPtr]101}
$null=Assert-Preparation 'Closing foreground Tips returns to bound main' $true 1
Reset-Scenario
[SW]::Foreground=[IntPtr]999
$null=Assert-Preparation 'Unchanged independent foreground is preserved' $true 1

foreach ($scenario in @(
  @{name='wrong policy';setup={$script:catalog.windows.taxTips.tablePreparationPolicy.mode='other'}},
  @{name='unknown modal policy';setup={$script:catalog.windows.taxTips.tablePreparationPolicy.requireNonModal='true'}},
  @{name='duplicate catalog title';setup={$script:catalog.windows | Add-Member NoteProperty other ([pscustomobject]@{title='Steuer-Spar-Tipps'})}},
  @{name='two Tips';setup={$script:beforeWindows+=New-Window 203 'Steuer-Spar-Tipps'}},
  @{name='unknown peer';setup={$script:beforeWindows+=New-Window 303 'Unknown dialog' 'qt-dialog'}},
  @{name='known Values-Info peer';setup={$script:beforeWindows+=New-Window 303 'Werte-Info: Vergleich' 'known-nonmodal'}},
  @{name='wrong owner';setup={[SW]::Owner=[IntPtr]999}},
  @{name='wrong Tips PID';setup={$AE::Tip.Current.ProcessId=8}},
  @{name='wrong root HWND';setup={$AE::Tip.Current.NativeWindowHandle=203}},
  @{name='wrong AID';setup={$AE::Tip.Current.AutomationId='Synthetic.Other'}},
  @{name='missing RID';setup={$AE::Tip.rid=''}},
  @{name='wrong type';setup={$AE::Tip.Current.ControlType=[System.Windows.Automation.ControlType]::Edit}},
  @{name='disabled root';setup={$AE::Tip.Current.IsEnabled=$false}},
  @{name='unknown enabled state';setup={$AE::Tip.Current.IsEnabled=$null}},
  @{name='wrong root title';setup={$AE::Tip.Current.Name='Other Tips'}},
  @{name='modal Tips';setup={$AE::Tip.pattern.Current.IsModal=$true}},
  @{name='unknown modal state';setup={$AE::Tip.pattern.Current.IsModal=$null}},
  @{name='unreadable modal state';setup={$AE::Tip.pattern.Current | Add-Member ScriptProperty IsModal {throw 'Synthetic unreadable modal property'} -Force}},
  @{name='missing WindowPattern';setup={$AE::Tip.pattern=$null}},
  @{name='unknown input';setup={$script:tick=$null}},
  @{name='unknown foreground';setup={[SW]::Foreground=[IntPtr]::Zero}},
  @{name='active table editor';setup={$script:tree.nodes[2].type='Edit'}},
  @{name='incomplete tree';setup={$script:tree.stats.truncated=$true}},
  @{name='missing completeness';setup={$script:tree.stats.PSObject.Properties.Remove('truncated')}},
  @{name='missing parent';setup={$script:tree.nodes[2].p=99}},
  @{name='duplicate node index';setup={$script:tree.nodes[2].i=1}},
  @{name='unreadable values';setup={$script:tree.stats.valErr=1}},
  @{name='unknown dirty';setup={$script:mode='dirty-unknown'}},
  @{name='unknown heading';setup={$script:mode='heading-unknown'}},
  @{name='input before dispatch';setup={$script:beforeGuard={$script:tick++}}},
  @{name='foreground before dispatch';setup={$script:beforeGuard={[SW]::Foreground=[IntPtr]999}}},
  @{name='owner before dispatch';setup={$script:beforeGuard={[SW]::Owner=[IntPtr]999}}},
  @{name='Tips RID before dispatch';setup={$script:beforeGuard={$AE::Tip.rid='1.9'}}},
  @{name='main RID before dispatch';setup={$script:beforeGuard={$AE::Main.rid='1.9'}}},
  @{name='new peer before dispatch';setup={$script:beforeGuard={$script:beforeWindows+=New-Window 303 'Unknown' 'qt-dialog'}}},
  @{name='input during guard';setup={$script:mode='input-during-guard'}},
  @{name='owner during guard snapshot';setup={$script:mode='owner-during-guard'}},
  @{name='peer during guard snapshot';setup={$script:mode='peer-during-guard'}},
  @{name='owner changes during final modal read';setup={Set-FinalTipModalReadAction {[SW]::Owner=[IntPtr]999}}},
  @{name='peer appears during final modal read';setup={Set-FinalTipModalReadAction {$script:beforeWindows+=New-Window 303 'Unknown' 'qt-dialog'}}},
  @{name='Tips HWND changes process during final modal read';setup={Set-FinalTipModalReadAction {[SW]::TipPid=8}}},
  @{name='Tips disappears during final modal read';setup={Set-FinalTipModalReadAction {[SW]::Closed=$true}}},
  @{name='value during guard';setup={$script:mode='value-before-guard'}},
  @{name='process reused';setup={$script:mode='process-reused'}},
  @{name='guard provider exception';setup={$script:mode='guard-provider-throws'}}
)) {
  Reset-Scenario
  & $scenario.setup
  $null=Assert-Preparation $scenario.name $false 0
}

foreach ($scenario in @(
  @{name='delivery timeout';setup={[SW]::Timeout=$true}},
  @{name='lost delivery result';setup={[SW]::ThrowDelivery=$true}},
  @{name='value after close';setup={$script:mode='value-after-close'}},
  @{name='typed toggle after close';setup={$script:mode='toggle-after-close'}},
  @{name='selection after close';setup={$script:mode='selection-after-close'}},
  @{name='dirty after close';setup={$script:mode='dirty-after-close'}},
  @{name='unreadable dirty after close';setup={$script:mode='dirty-unknown-after'}},
  @{name='heading after close';setup={$script:mode='heading-after-close'}},
  @{name='incomplete post-state';setup={$script:mode='truncated-after-close'}},
  @{name='post provider exception';setup={$script:mode='post-provider-throws'}},
  @{name='input after close';setup={[SW]::OnSend={$script:tick++}}},
  @{name='foreground after close';setup={[SW]::OnSend={[SW]::Foreground=[IntPtr]999}}},
  @{name='main HWND reused';setup={[SW]::OnSend={[SW]::MainPid=8}}},
  @{name='main root replaced';setup={[SW]::OnSend={$AE::Main.rid='1.9'}}},
  @{name='peer during readback';setup={$script:mode='peer-during-readback'}},
  @{name='main root during readback';setup={$script:mode='root-during-readback'}},
  @{name='main disappears';setup={$script:afterWindows=@()}},
  @{name='main title changes';setup={$changed=$script:main.PSObject.Copy();$changed.title='Other case';$changed.titleFingerprint='B'*64;$script:afterWindows=@($changed)}},
  @{name='new modal peer';setup={$script:afterWindows+=New-Window 303 'Confirmation' 'qt-dialog'}}
)) {
  Reset-Scenario
  & $scenario.setup
  $null=Assert-Preparation $scenario.name $false 1 $true
}
Reset-Scenario
$script:mode='guard-provider-throws'
$result=Assert-Preparation 'No provider work after pre-close provider exception' $false 0
Assert-True ($script:walks -eq 2 -and $AE::MainReads -eq 1 -and $AE::TipReads -eq 1 -and $script:dialogReads -eq 1) 'Provider exception triggered cleanup queries or alternate action.'
Assert-True ($result.error.EndsWith('[preparation:guard-fresh-state]')) 'Provider exception lost the fixed dispatch phase.'
Reset-Scenario
$script:mode='post-provider-throws'
$null=Assert-Preparation 'No provider work after post-close provider exception' $false 1 $true
Assert-True ($script:walks -eq 3 -and $AE::MainReads -eq 2 -and $AE::TipReads -eq 2 -and $script:dialogReads -eq 2) 'Post-close provider exception triggered cleanup queries or replay.'

# Execute the actual guard for every scalar comparison category. The error
# carries only a fixed code, even when the differing provider field is private.
foreach ($case in @(
  @{category='runtime-id';phase='guard-fingerprint-runtime-id';walks=2;mutate={param($node) $node.rid='PRIVATE-RUNTIME-ID'}},
  @{category='structure';phase='guard-fingerprint-structure';walks=2;mutate={param($node) $node.aid='PRIVATE-AUTOMATION-ID'}},
  @{category='content';phase='guard-fingerprint-content';walks=2;mutate={param($node) $node.val='PRIVATE-CONTENT'}},
  @{category='selected';phase='guard-fingerprint-selected';walks=2;mutate={param($node) $node.selected=$true}},
  @{category='enabled';phase='guard-fingerprint-enabled';walks=2;mutate={param($node) $node.on=$false}},
  @{category='geometry';phase='guard-settled-fingerprint';walks=3;mutate={param($node) $node.x=21}}
)) {
  Reset-Scenario
  $script:guardNodeMutation=$case.mutate
  $result=Assert-Preparation ('Fingerprint category ' + $case.category) $false 0
  $expected='Help-window close was not verified: Die private Fensterbindung hat sich vor WM_CLOSE geaendert. [preparation:' + $case.phase + ']'
  Assert-True ($result.error -ceq $expected) 'Mismatch diagnostics were not a fixed value-free category.'
  Assert-True ($script:walks -eq $case.walks -and $AE::MainReads -eq 1 -and $AE::TipReads -eq 1 -and
    $script:dialogReads -eq 1 -and $script:windowReads -eq 3 -and $script:epochReads -eq 2) 'Fingerprint diagnostics performed additional provider or inventory work.'
  Assert-True ([SW]::ForegroundReads -eq 2 -and [SW]::OwnerReads -eq 1 -and [SW]::PidReads -eq 1 -and [SW]::ExistsReads -eq 1) 'Fingerprint diagnostics performed additional Win32 queries.'
  Assert-True ($null -eq $result.PSObject.Properties['nodes'] -and ($result | ConvertTo-Json -Depth 6 -Compress) -notmatch 'PRIVATE-') 'Private comparison evidence escaped into the public result.'
}

foreach ($case in @(
  @{phase='guard-environment-before';setup={$script:beforeGuard={$script:tick++}}},
  @{phase='guard-heading';setup={$script:mode='heading-during-guard'}},
  @{phase='guard-dirty';setup={$script:mode='dirty-during-guard'}},
  @{phase='guard-main-root';setup={$script:beforeGuard={$AE::Main.rid='1.9'}}},
  @{phase='guard-tip-root';setup={$script:beforeGuard={$AE::Tip.rid='1.9'}}},
  @{phase='guard-window-signature';setup={$script:mode='peer-during-guard'}},
  @{phase='guard-owner';setup={$script:mode='owner-during-guard'}},
  @{phase='guard-environment-after';setup={$script:mode='input-during-guard'}}
)) {
  Reset-Scenario
  & $case.setup
  $result=Assert-Preparation ('Dispatch phase ' + $case.phase) $false 0
  Assert-True ($result.error.EndsWith('[preparation:' + $case.phase + ']')) 'Dispatch failure lost its exact fixed phase.'
}

foreach ($case in @(
  @{name='WM_CLOSE timeout';setup={[SW]::Timeout=$true}},
  @{name='Close postcondition failure';setup={$script:afterWindows+=New-Window 303 'Unknown' 'qt-dialog'}}
)) {
  Reset-Scenario
  & $case.setup
  $result=Assert-Preparation $case.name $false 1 $true
  Assert-True ($result.error.EndsWith('[preparation:close-transaction]')) 'A verified guard was incorrectly blamed for a later close failure.'
}

# The pure categorizer reads only the already projected private arrays. No
# command, provider call or further serialization belongs in that helper.
$prepAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'powershell\table-preparation.ps1'),[ref]$null,[ref]$errors)
Assert-True (-not $errors.Count) 'Preparation source does not parse.'
$difference=@($prepAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-SSETablePreparationDifferenceCategory'},$true))
Assert-True ($difference.Count -eq 1 -and @($difference[0].FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true)).Count -eq 0) 'Difference classification performs a new query or serialization.'
Reset-Scenario
$state=Get-SSETablePreparationState ([IntPtr]101)
Assert-True ($state.nodes.Count -eq 3 -and $state.fingerprint -match '^[A-F0-9]{64}$') 'Private evidence no longer preserves the original strict fingerprint.'
$same=Get-SSETablePreparationDifferenceCategory $state.nodes $state.nodes
Assert-True ($same -ceq 'unclassified') 'Equal evidence invented a difference category.'
$changed=@($state.nodes | ForEach-Object {$_.PSObject.Copy()})
$changed[2].value=$false
$state.nodes[2].value=$null
Assert-True ((Get-SSETablePreparationDifferenceCategory $state.nodes $changed) -ceq 'content') 'Null and false provider values were conflated.'
$changed[2].value=''
Assert-True ((Get-SSETablePreparationDifferenceCategory $state.nodes $changed) -ceq 'content') 'Null and empty provider values were conflated.'
Assert-True ((Get-SSETablePreparationDifferenceCategory $state.nodes @($changed[0])) -ceq 'structure') 'Different node counts lost structural classification.'
Reset-Scenario
$script:guardNodeMutation={param($node) $node.selected='false'}
$result=Assert-Preparation 'Untrusted selection scalar remains strictly rejected' $false 0
Assert-True ($result.error.EndsWith('[preparation:guard-fingerprint-selected]')) 'Unknown scalar type weakened the original hash comparison.'

Reset-Scenario
$script:geometrySettled=$true
[SW]::OnSend={
  Assert-True ($script:walks -eq 3 -and $AE::MainReads -eq 2 -and $AE::TipReads -eq 2 -and
    $script:windowReads -eq 4 -and $script:epochReads -eq 3) 'Settling did not use exactly one additional strict passive read before the original final proofs.'
  Assert-True ([SW]::ForegroundReads -eq 3 -and [SW]::OwnerReads -eq 2 -and [SW]::PidReads -eq 3 -and [SW]::ExistsReads -eq 3) 'Settling changed the original final Win32 query counts.'
}
$result=Assert-Preparation 'Geometry A-B-B-B accepts the settled post-close baseline' $true 1
Assert-True ($script:walks -eq 4 -and $AE::MainReads -eq 3 -and $AE::TipReads -eq 2 -and
  $script:windowReads -eq 8 -and $script:dialogReads -eq 2 -and $script:epochReads -eq 5) 'Stable geometry added queries beyond one passive snapshot.'

foreach ($case in @(
  @{name='Geometry keeps moving';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$tree.nodes[0].h=602}}},
  @{name='Geometry reverts to the original';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$tree.nodes[0].h=600}}},
  @{name='Fresh geometry and heading';walks=2;onWalk={param($tree,$walk) if ($walk -eq 2) {$script:currentHeading='Changed page'}}},
  @{name='Fresh geometry and dirty';walks=2;onWalk={param($tree,$walk) if ($walk -eq 2) {$script:currentDirty=$true}}},
  @{name='Fresh geometry and value';walks=2;onWalk={param($tree,$walk) if ($walk -eq 2) {$tree.nodes[2].val='Changed private value'}}},
  @{name='Fresh geometry and read-only';walks=2;onWalk={param($tree,$walk) if ($walk -eq 2) {$tree.nodes[2].ro=$false}}},
  @{name='Fresh geometry and toggle';walks=2;onWalk={param($tree,$walk) if ($walk -eq 2) {$tree.nodes[2].checked=$true}}},
  @{name='Fresh geometry and runtime identity';walks=2;onWalk={param($tree,$walk) if ($walk -eq 2) {$tree.nodes[2].rid='Changed.Runtime.Identity'}}},
  @{name='Fresh geometry and selection';walks=2;onWalk={param($tree,$walk) if ($walk -eq 2) {$tree.nodes[2].selected=$true}}},
  @{name='Fresh geometry and enabled';walks=2;onWalk={param($tree,$walk) if ($walk -eq 2) {$tree.nodes[2].on=$false}}},
  @{name='Settling changes value';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$tree.nodes[2].val='Changed private value'}}},
  @{name='Settling changes heading';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$script:currentHeading='Changed page'}}},
  @{name='Settling changes dirty';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$script:currentDirty=$true}}},
  @{name='Input during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$script:tick++}}},
  @{name='Process epoch during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$script:epochValue=124}}},
  @{name='Foreground during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {[SW]::Foreground=[IntPtr]999}}},
  @{name='Owner during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {[SW]::Owner=[IntPtr]999}}},
  @{name='Main PID during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {[SW]::MainPid=8}}},
  @{name='Tip PID during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {[SW]::TipPid=8}}},
  @{name='Main root during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$AE::Main.rid='Changed.Main.Root'}}},
  @{name='Tip root during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$AE::Tip.rid='Changed.Tip.Root'}}},
  @{name='Peer during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$script:beforeWindows+=New-Window 303 'Unknown' 'qt-dialog'}}},
  @{name='Outer rectangle during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$script:main.w++}}},
  @{name='Unreadable provider during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {throw 'Synthetic settling provider failure'}}},
  @{name='Incomplete snapshot during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$tree.stats.depthLimited=$true}}},
  @{name='Value error during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$tree.stats.valErr=1}}},
  @{name='Editor during settling';walks=3;onWalk={param($tree,$walk) if ($walk -eq 3) {$tree.nodes[2].type='Edit'}}}
)) {
  Reset-Scenario
  $script:geometrySettled=$true;$script:onWalk=$case.onWalk
  $null=Assert-Preparation $case.name $false 0
  Assert-True ($script:walks -eq $case.walks) ($case.name + ': a failed proof caused another snapshot or action.')
}

Reset-Scenario
$script:geometrySettled=$true
$script:tree.nodes+=[pscustomobject]@{i=3;p=0;type='Text';aid='Hidden';rid='2.4';name='Hidden private value';val='Original';on=$true;x=-1;y=-1;w=0;h=0}
$script:onWalk={param($tree,$walk) if ($walk -eq 2) {$tree.nodes[3].val='Changed'}}
$null=Assert-Preparation 'Hidden value change cannot authorize geometry settling' $false 0
Assert-True ($script:walks -eq 2) 'Hidden values were excluded from semantic authorization.'

foreach ($case in @(
  @{name='Post-close geometry drifts';onWalk={param($tree,$walk) if ($walk -eq 4) {$tree.nodes[0].h=602}}},
  @{name='Post-close geometry reverts';onWalk={param($tree,$walk) if ($walk -eq 4) {$tree.nodes[0].h=600}}},
  @{name='Post-close values drift';onWalk={param($tree,$walk) if ($walk -eq 4) {$tree.nodes[2].val='Changed'}}}
)) {
  Reset-Scenario
  $script:geometrySettled=$true;$script:onWalk=$case.onWalk
  $null=Assert-Preparation $case.name $false 1 $true
  Assert-True ($script:walks -eq 4) 'Post-close drift caused a replay or another settling read.'
}

foreach ($case in @(
  @{name='Missing original semantic proof';walks=2;mutate={param($state,$walk) if ($walk -eq 1) {$state.PSObject.Properties.Remove('semanticFingerprint')}}},
  @{name='Missing fresh semantic proof';walks=2;mutate={param($state,$walk) if ($walk -eq 2) {$state.PSObject.Properties.Remove('semanticFingerprint')}}},
  @{name='Both semantic proofs absent';walks=2;mutate={param($state,$walk) $state.PSObject.Properties.Remove('semanticFingerprint')}},
  @{name='Empty semantic proof';walks=2;mutate={param($state,$walk) $state.semanticFingerprint=''}},
  @{name='Null semantic proof';walks=2;mutate={param($state,$walk) $state.semanticFingerprint=$null}},
  @{name='Non-string semantic proof';walks=2;mutate={param($state,$walk) $state.semanticFingerprint=7}},
  @{name='Malformed semantic proof';walks=2;mutate={param($state,$walk) $state.semanticFingerprint='not-a-sha'}},
  @{name='Noncanonical semantic proof';walks=2;mutate={param($state,$walk) $state.semanticFingerprint=$state.semanticFingerprint.ToLowerInvariant()}},
  @{name='Missing settled semantic proof';walks=3;mutate={param($state,$walk) if ($walk -eq 3) {$state.PSObject.Properties.Remove('semanticFingerprint')}}},
  @{name='Malformed settled semantic proof';walks=3;mutate={param($state,$walk) if ($walk -eq 3) {$state.semanticFingerprint='not-a-sha'}}},
  @{name='Changed settled semantic proof';walks=3;mutate={param($state,$walk) if ($walk -eq 3) {$state.semanticFingerprint='A'*64}}}
)) {
  Reset-Scenario
  $script:geometrySettled=$true;$script:stateMutation=$case.mutate
  $null=Assert-Preparation $case.name $false 0
  Assert-True ($script:walks -eq $case.walks) ($case.name + ': invalid semantic authority triggered another read.')
}

Reset-Scenario
$state=Get-SSETablePreparationState ([IntPtr]101)
$semanticHash=Get-SSETablePreparationSemanticFingerprint $state.nodes
$state.nodes[0].h++
Assert-True ((Get-SSETablePreparationSemanticFingerprint $state.nodes) -ceq $semanticHash) 'Semantic fingerprint included geometry.'
$state.nodes[0] | Add-Member NoteProperty FutureSemanticProperty 'Original'
$futureHash=Get-SSETablePreparationSemanticFingerprint $state.nodes
Assert-True ($futureHash -cne $semanticHash) 'A future projected property was omitted from semantic proof.'
$state.nodes[0].FutureSemanticProperty='Changed'
Assert-True ((Get-SSETablePreparationSemanticFingerprint $state.nodes) -cne $futureHash) 'A future projected property value was omitted from semantic proof.'
Reset-Scenario
$script:geometrySettled=$true
$script:stateMutation={
  param($state,$walk)
  $state.nodes[0] | Add-Member NoteProperty FutureSemanticProperty ([int]($walk -gt 1))
  $state.fingerprint=Get-SSETextSha256 ($state.nodes | ConvertTo-Json -Depth 6 -Compress)
  $state.semanticFingerprint=Get-SSETablePreparationSemanticFingerprint $state.nodes
}
$result=Assert-Preparation 'Future projected semantic difference is rejected without classifier authorization' $false 0
Assert-True ($script:walks -eq 2 -and $result.error.EndsWith('[preparation:guard-fingerprint-geometry]')) 'Diagnostic geometry classification became semantic authority.'
Write-Output 'Table preparation: explicit exact owned nonmodal Tips only; fresh complete state checks, zero-action fast path and one-attempt unknown outcomes verified.'

# Direct actual-helper observer regression cases.
# No GUI, native controller or real product state is used by these cases.
function Enable-ResultObserver {
  $title='Werte-Info: Werte vergleichen - Was w' + [char]0x00e4 + 're wenn'
  $script:catalog.windows | Add-Member NoteProperty resultComparison ([pscustomobject]@{
    title=$title;role='nonmodal-result-window';closePolicy='allow-exact-nonmodal-close'
  })
  $script:observer=New-Window 303 $title 'known-nonmodal'
  $script:beforeWindows+= $script:observer
  $script:afterWindows+= $script:observer
  $AE::Observer=New-Root 303 'Synthetic.ResultWindow' '8.1' $title
  $script:observerTree=[pscustomobject]@{
    stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0}
    nodes=@(
      [pscustomobject]@{i=0;p=-1;type='Pane';aid='Synthetic.Result';rid='8.2';name='Comparison';on=$true;x=100;y=100;w=500;h=400},
      [pscustomobject]@{i=1;p=0;type='Text';aid='Synthetic.Result.Amount';rid='8.3';name='1,00';val='1,00';ro=$true;checked=$null;selected=$false;on=$true;x=110;y=130;w=100;h=25}
    )
  }
}
function Set-FinalObserverModalReadAction([scriptblock]$Action) {
  $script:finalObserverModalReadAction=$Action
  $AE::Observer.pattern | Add-Member ScriptProperty Current {
    if ($AE::ObserverReads -eq 2) { & $script:finalObserverModalReadAction }
    [pscustomobject]@{IsModal=$false}
  } -Force
}

Reset-Scenario
Enable-ResultObserver
$result=Assert-Preparation 'Exact passive result observer is retained' $true 1
Assert-True ($script:walks -eq 3 -and $script:observerWalks -eq 3 -and $AE::ObserverReads -eq 3) 'Observer requires exactly initial/final/preclose strict state and root bindings.'
Assert-True ([SW]::ObserverExists -and @($script:afterWindows).Count -eq 2 -and $null -eq $result.PSObject.Properties['observer']) 'Observer was closed or its private authority escaped.'

Reset-Scenario
Enable-ResultObserver
$script:beforeWindows=@($script:main,$script:observer)
$result=Invoke-SSETablePreparation ([IntPtr]101) 7
Assert-True ($result.ok -and -not $result.prepared -and [SW]::Calls -eq 0 -and $script:walks -eq 0 -and
  $script:observerWalks -eq 0 -and $AE::ObserverReads -eq 0 -and $script:windowReads -eq 1) 'No-Tips observer changed the fast path.'

Reset-Scenario
Enable-ResultObserver
[SW]::Foreground=[IntPtr]202
[SW]::OnSend={[SW]::Foreground=[IntPtr]101}
$null=Assert-Preparation 'Foreground Tips closes without touching observer' $true 1

foreach ($case in @(
  @{name='observer wrong exact title';setup={$script:observer.title='Werte-Info: Vergleich'}},
  @{name='observer missing policy';setup={$script:catalog.windows.PSObject.Properties.Remove('resultComparison')}},
  @{name='observer wrong role';setup={$script:catalog.windows.resultComparison.role='nonmodal-tool-window'}},
  @{name='observer wrong close policy';setup={$script:catalog.windows.resultComparison.closePolicy='other'}},
  @{name='observer duplicate catalog title';setup={$script:catalog.windows | Add-Member NoteProperty other ([pscustomobject]@{title=$script:observer.title})}},
  @{name='observer duplicate window';setup={$script:beforeWindows+=New-Window 304 $script:observer.title 'known-nonmodal'}},
  @{name='observer unknown extra window';setup={$script:beforeWindows+=New-Window 304 'Unknown' 'qt-dialog'}},
  @{name='observer wrong window class';setup={$script:observer.cls='OtherWindow'}},
  @{name='observer wrong owner';setup={[SW]::ObserverOwner=[IntPtr]999}},
  @{name='observer cannot be foreground';setup={[SW]::Foreground=[IntPtr]303}},
  @{name='observer root foreign PID';setup={$AE::Observer.Current.ProcessId=8}},
  @{name='observer root wrong HWND';setup={$AE::Observer.Current.NativeWindowHandle=304}},
  @{name='observer root missing AID';setup={$AE::Observer.Current.AutomationId=''}},
  @{name='observer root missing RID';setup={$AE::Observer.rid=''}},
  @{name='observer root wrong title';setup={$AE::Observer.Current.Name='Other comparison'}},
  @{name='observer root wrong type';setup={$AE::Observer.Current.ControlType=[System.Windows.Automation.ControlType]::Edit}},
  @{name='observer root disabled';setup={$AE::Observer.Current.IsEnabled=$false}},
  @{name='observer root unknown enabled';setup={$AE::Observer.Current.IsEnabled=$null}},
  @{name='observer missing WindowPattern';setup={$AE::Observer.pattern=$null}},
  @{name='observer modal';setup={$AE::Observer.pattern.Current.IsModal=$true}},
  @{name='observer unknown modal state';setup={$AE::Observer.pattern.Current.IsModal=$null}},
  @{name='observer unreadable modal state';setup={$AE::Observer.pattern.Current | Add-Member ScriptProperty IsModal {throw 'Synthetic observer modal failure'} -Force}},
  @{name='observer incomplete';setup={$script:observerTree.stats.truncated=$true}},
  @{name='observer unknown completeness';setup={$script:observerTree.stats.PSObject.Properties.Remove('truncated')}},
  @{name='observer value read error';setup={$script:observerTree.stats.valErr=1}},
  @{name='observer duplicate index';setup={$script:observerTree.nodes[1].i=0}},
  @{name='observer missing parent';setup={$script:observerTree.nodes[1].p=99}},
  @{name='observer provider throws initially';setup={$script:observerThrows=1}},
  @{name='observer provider throws before close';setup={$script:observerThrows=2}},
  @{name='observer late RID';setup={$script:beforeGuard={$AE::Observer.rid='8.9'}}},
  @{name='observer late AID';setup={$script:beforeGuard={$AE::Observer.Current.AutomationId='Other.Result'}}},
  @{name='observer late modal';setup={$script:beforeGuard={$AE::Observer.pattern.Current.IsModal=$true}}},
  @{name='observer late owner';setup={$script:beforeGuard={[SW]::ObserverOwner=[IntPtr]999}}},
  @{name='observer late PID';setup={$script:beforeGuard={[SW]::ObserverPid=8}}},
  @{name='observer owner changes during final modal read';setup={Set-FinalObserverModalReadAction {[SW]::ObserverOwner=[IntPtr]999}}},
  @{name='observer PID changes during final modal read';setup={Set-FinalObserverModalReadAction {[SW]::ObserverPid=8}}},
  @{name='observer disappears during final modal read';setup={Set-FinalObserverModalReadAction {[SW]::ObserverExists=$false}}},
  @{name='observer geometry changes during final modal read';setup={Set-FinalObserverModalReadAction {$script:observer.h++}}},
  @{name='observer peer appears during final modal read';setup={Set-FinalObserverModalReadAction {$script:beforeWindows+=New-Window 304 'Unknown' 'qt-dialog'}}},
  @{name='observer foreground changes during final modal read';setup={Set-FinalObserverModalReadAction {[SW]::Foreground=[IntPtr]303}}},
  @{name='observer input changes during final modal read';setup={Set-FinalObserverModalReadAction {$script:tick++}}},
  @{name='observer owner changes during final snapshot';setup={$script:onObserverWalk={param($t,$n) if($n -eq 2){[SW]::ObserverOwner=[IntPtr]999}}}},
  @{name='observer window changes during final snapshot';setup={$script:onObserverWalk={param($t,$n) if($n -eq 2){$script:observer.w++}}}},
  @{name='observer RID changes during final snapshot';setup={$script:onObserverWalk={param($t,$n) if($n -eq 2){$AE::Observer.rid='8.99'}}}},
  @{name='observer becomes modal during final snapshot';setup={$script:onObserverWalk={param($t,$n) if($n -eq 2){$AE::Observer.pattern.Current.IsModal=$true}}}},
  @{name='Tips root changes during observer snapshot';setup={$script:onObserverWalk={param($t,$n) if($n -eq 2){$AE::Tip.rid='1.99'}}}},
  @{name='observer disappears during root read';setup={$AE::Observer.pattern | Add-Member ScriptProperty Current {[SW]::ObserverExists=$false;[pscustomobject]@{IsModal=$false}} -Force}},
  @{name='observer late window geometry';setup={$script:beforeGuard={$script:observer.x++}}},
  @{name='observer replaced window';setup={$script:beforeGuard={$script:beforeWindows=@($script:main,$script:tip,(New-Window 304 $script:observer.title 'known-nonmodal'))}}}
)) {
  Reset-Scenario
  Enable-ResultObserver
  & $case.setup
  $null=Assert-Preparation $case.name $false 0
}

# Every projected observer field is strict: no geometry settling/retry is
# inherited from the main-window state, including values and checkbox states.
foreach ($case in @(
  @{name='identity';mutate={param($t) $t.nodes[1].rid='8.99'}},
  @{name='structure';mutate={param($t) $t.nodes[1].aid='Other.Amount'}},
  @{name='text';mutate={param($t) $t.nodes[1].name='2,00'}},
  @{name='value';mutate={param($t) $t.nodes[1].val='2,00'}},
  @{name='readOnly';mutate={param($t) $t.nodes[1].ro=$false}},
  @{name='checked';mutate={param($t) $t.nodes[1].checked=$true}},
  @{name='selected';mutate={param($t) $t.nodes[1].selected=$true}},
  @{name='enabled';mutate={param($t) $t.nodes[1].on=$false}},
  @{name='geometry';mutate={param($t) $t.nodes[1].h=26}},
  @{name='completeness';mutate={param($t) $t.stats.truncated=$true}}
)) {
  Reset-Scenario
  Enable-ResultObserver
  $script:observerMutation=$case.mutate
  $script:onObserverWalk={param($t,$n) if($n -eq 2){& $script:observerMutation $t}}
  $null=Assert-Preparation ('Observer '+$case.name+' before close') $false 0
  Assert-True ($script:observerWalks -eq 2) 'Observer drift authorized another snapshot or a retry.'

  Reset-Scenario
  Enable-ResultObserver
  $script:observerMutation=$case.mutate
  $script:onObserverWalk={param($t,$n) if($n -eq 3){& $script:observerMutation $t}}
  $null=Assert-Preparation ('Observer '+$case.name+' after close') $false 1 $true
  Assert-True ($script:observerWalks -eq 3) 'Observer post-close drift caused extra provider work.'
}

foreach ($case in @(
  @{name='observer root replaced after close';mutate={$AE::Observer.rid='8.99'}},
  @{name='observer owner changes after close';mutate={[SW]::ObserverOwner=[IntPtr]999}},
  @{name='observer PID changes after close';mutate={[SW]::ObserverPid=8}},
  @{name='observer disappears after close';mutate={[SW]::ObserverExists=$false}},
  @{name='observer becomes modal after close';mutate={$AE::Observer.pattern.Current.IsModal=$true}},
  @{name='observer window geometry changes after close';mutate={$script:observer.w++}},
  @{name='observer removed from inventory after close';mutate={$script:afterWindows=@($script:main)}},
  @{name='observer unknown new peer after close';mutate={$script:afterWindows+=New-Window 304 'Unknown' 'qt-dialog'}}
)) {
  Reset-Scenario
  Enable-ResultObserver
  [SW]::OnSend=$case.mutate
  $null=Assert-Preparation $case.name $false 1 $true
}
foreach ($case in @(
  @{name='observer owner during final post snapshot';mutate={[SW]::ObserverOwner=[IntPtr]999}},
  @{name='observer RID during final post snapshot';mutate={$AE::Observer.rid='8.99'}},
  @{name='observer modal during final post snapshot';mutate={$AE::Observer.pattern.Current.IsModal=$true}},
  @{name='observer inventory during final post snapshot';mutate={$script:observer.x++}},
  @{name='observer new peer during final post snapshot';mutate={$script:afterWindows+=New-Window 304 'Unknown' 'qt-dialog'}},
  @{name='observer input during final post snapshot';mutate={$script:tick++}},
  @{name='observer foreground during final post snapshot';mutate={[SW]::Foreground=[IntPtr]303}}
)) {
  Reset-Scenario
  Enable-ResultObserver
  $script:lateObserverMutation=$case.mutate
  $script:onObserverWalk={param($t,$n) if($n -eq 3){& $script:lateObserverMutation}}
  $null=Assert-Preparation $case.name $false 1 $true
  Assert-True ($script:observerWalks -eq 3) 'Final observer failure caused provider work or replay.'
}
Write-Output 'Table preparation observer: exact passive result peer, strict complete state, unchanged peers and one Tips close verified.'

function Reset-HiddenScenario {
  Reset-Scenario
  $script:DESKTOP_NAME='OwnSyntheticHidden'
  $script:tick=$null
  [SW]::Foreground=[IntPtr]::Zero
}
function Assert-NoVisibleInputEpoch {
  Assert-True ($script:tickReads -eq 0 -and [SW]::ForegroundReads -eq 0) `
    'Hidden preparation queried a visible input or foreground epoch.'
}
Reset-HiddenScenario
[SW]::OnSend={
  Assert-True ([DSK]::IsolationReads -eq 3 -and [SW]::OwnerReads -eq 2 -and
    [SW]::PidReads -eq 3 -and [SW]::ExistsReads -eq 3) 'Hidden dispatch dropped a final isolation, owner, PID or live-window proof.'
}
$null=Assert-Preparation 'isolated help close without a visible input epoch' $true 1
Assert-NoVisibleInputEpoch
Assert-True ($script:walks -eq 3 -and $script:epochReads -eq 5 -and [DSK]::IsolationReads -eq 5 -and
  $script:windowReads -eq 8 -and $script:dialogReads -eq 2 -and $AE::MainReads -eq 3 -and $AE::TipReads -eq 2) `
  'Isolated preparation lost its complete before, dispatch or post-close proofs.'

Reset-HiddenScenario
[DSK]::Isolated=$false;[SW]::Foreground=[IntPtr]999
$null=Assert-Preparation 'hidden label with a visible or mismatched desktop' $false 0
Assert-NoVisibleInputEpoch

foreach ($case in @(
  @{mode='process-reused';calls=0;unknown=$false},
  @{mode='value-before-guard';calls=0;unknown=$false},
  @{mode='owner-during-guard';calls=0;unknown=$false},
  @{mode='peer-during-guard';calls=0;unknown=$false},
  @{mode='value-after-close';calls=1;unknown=$true},
  @{mode='root-during-readback';calls=1;unknown=$true}
)) {
  Reset-HiddenScenario
  $script:mode=$case.mode
  $null=Assert-Preparation ('isolated '+$case.mode) $false $case.calls $case.unknown
  Assert-NoVisibleInputEpoch
}
foreach ($changedDesktop in @('OtherOwnHidden','')) {
  Reset-HiddenScenario
  $script:nextDesktop=$changedDesktop
  $script:beforeGuard={$script:DESKTOP_NAME=$script:nextDesktop}
  $result=Assert-Preparation 'isolated desktop authority changed before dispatch' $false 0
  Assert-True ($result.error -match '\[preparation:guard-environment-before\]$') 'Desktop change lost its exact pre-dispatch failure phase.'
  Assert-NoVisibleInputEpoch
}
foreach ($changedDesktop in @('OtherOwnHidden','')) {
  Reset-HiddenScenario
  $script:nextDesktop=$changedDesktop
  [SW]::OnSend={$script:DESKTOP_NAME=$script:nextDesktop}
  $result=Assert-Preparation 'isolated desktop authority changed after dispatch' $false 1 $true
  Assert-True ($result.error -match '\[preparation:after-close-environment\]$') 'Late desktop change lost its unknown close phase.'
  Assert-NoVisibleInputEpoch
}
Reset-HiddenScenario
[scriptblock]$script:beforeGuard={[DSK]::Isolated=$false}
$result=Assert-Preparation 'actual isolation lost before dispatch' $false 0
Assert-True ($result.error -match '\[preparation:guard-environment-before\]$') 'Early isolation loss lost its exact guard phase.'
Assert-NoVisibleInputEpoch
Reset-HiddenScenario
$script:onWalk={param($tree,$index) if ($index -eq 2) {[DSK]::Isolated=$false}}
$result=Assert-Preparation 'actual isolation lost during guard reads' $false 0
Assert-True ($result.error -match '\[preparation:guard-environment-after\]$') 'Isolation loss during provider reads escaped the final dispatch guard.'
Assert-NoVisibleInputEpoch
Reset-HiddenScenario
[SW]::OnSend={[DSK]::Isolated=$false}
$result=Assert-Preparation 'actual isolation lost after dispatch' $false 1 $true
Assert-True ($result.error -match '\[preparation:after-close-environment\]$') 'Late isolation loss lost its unknown close phase.'
Reset-HiddenScenario
Enable-ResultObserver
$null=Assert-Preparation 'isolated passive result observer' $true 1
Assert-True ($script:observerWalks -eq 3 -and $AE::ObserverReads -eq 3) 'Isolated observer lost its complete state or root proofs.'
Assert-NoVisibleInputEpoch
Reset-HiddenScenario
Enable-ResultObserver
[SW]::OnSend={[SW]::ObserverOwner=[IntPtr]999}
$null=Assert-Preparation 'isolated result observer owner changed after close' $false 1 $true
Assert-NoVisibleInputEpoch
Reset-Scenario
$script:tick=$null
$null=Assert-Preparation 'visible missing input epoch stays refused' $false 0
Reset-Scenario
[SW]::Foreground=[IntPtr]::Zero
$null=Assert-Preparation 'visible missing foreground stays refused' $false 0
Write-Output 'Table preparation isolation: no visible input dependency; owner, state, process and desktop authority remain mandatory.'
