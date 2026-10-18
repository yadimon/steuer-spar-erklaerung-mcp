$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'powershell\table-combobox.ps1')
. (Join-Path $root 'powershell\window-close.ps1')
. (Join-Path $root 'powershell\table-preparation.ps1')
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
 public static bool Closed, Timeout, ThrowDelivery, MainExists=true;
 public static IntPtr Foreground=new IntPtr(101),Owner=new IntPtr(101);
 public static Action OnSend;
 public static IntPtr GetForegroundWindow(){ForegroundReads++;return Foreground;}
 public static IntPtr GetWindow(IntPtr hwnd,uint mode){OwnerReads++;return Owner;}
 public static uint GetWindowThreadProcessId(IntPtr hwnd,ref int processId){PidReads++;processId=hwnd.ToInt64()==101?MainPid:TipPid;return 1;}
 public static bool IsWindow(IntPtr hwnd){ExistsReads++;return hwnd.ToInt64()==101 ? MainExists : !Closed;}
 public static IntPtr SendMessageTimeout(IntPtr hwnd,uint message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,ref IntPtr result){
  Calls++;Closed=true;if(OnSend!=null)OnSend();
  if(ThrowDelivery)throw new InvalidOperationException("Synthetic lost close result");
  return Timeout?IntPtr.Zero:new IntPtr(1);
 }
}
namespace System.Windows.Automation {
 public static class ControlType {public static object Window=new object(),Edit=new object();}
 public static class WindowPattern {public static object Pattern=new object();}
 public static class AutomationElement {
  public static object Main,Tip;
  public static int MainReads,TipReads;
  public static object FromHandle(IntPtr hwnd){if(hwnd.ToInt64()==101){MainReads++;return Main;}TipReads++;return Tip;}
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
  123
}
function Get-SSELastInputTick { $script:tick }
function Test-SSELastInputUnchanged($Expected) { $null -ne $script:tick -and $Expected -eq $script:tick }
function Walk-BoundTree {
    param([IntPtr]$Hwnd,[switch]$WithValues,[switch]$Strict)
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
  if ($script:walks -eq 2 -and $script:guardNodeMutation) { & $script:guardNodeMutation $copy.nodes[2] }
  if ($script:mode -ceq 'value-before-guard' -and $script:walks -eq 2) {$copy.nodes[2].val='99,00'}
  if ($script:mode -ceq 'value-after-close' -and [SW]::Closed) {$copy.nodes[2].val='99,00'}
  if ($script:mode -ceq 'toggle-after-close' -and [SW]::Closed) {$copy.nodes[2].checked=$true}
  if ($script:mode -ceq 'selection-after-close' -and [SW]::Closed) {$copy.nodes[2].selected=$true}
  if ($script:mode -ceq 'truncated-after-close' -and [SW]::Closed) {$copy.stats.truncated=$true}
  $copy
}
function Get-DirtyStateFast {
  if ($script:mode -ceq 'dirty-unknown') {return $null}
  if ($script:mode -ceq 'dirty-unknown-after' -and [SW]::Closed) {return $null}
  if ($script:mode -ceq 'dirty-after-close' -and [SW]::Closed) {return $true}
  if ($script:mode -ceq 'dirty-during-guard' -and $script:walks -eq 2) {return $true}
  $false
}
function Get-CurrentHeading {
  if ($script:mode -ceq 'heading-unknown') {return $null}
  if ($script:mode -ceq 'heading-after-close' -and [SW]::Closed) {return 'Other page'}
  if ($script:mode -ceq 'heading-during-guard' -and $script:walks -eq 2) {return 'Other page'}
  'Synthetic table'
}
function Set-FinalTipModalReadAction([scriptblock]$Action) {
  $script:finalTipModalReadAction=$Action
  $AE::Tip.pattern | Add-Member ScriptProperty Current {
    if ($AE::TipReads -eq 2) { & $script:finalTipModalReadAction }
    [pscustomobject]@{IsModal=$false}
  } -Force
}
function Reset-Scenario {
  $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false
  $script:mode='';$script:tick=10;$script:walks=0;$script:windowReads=0;$script:dialogReads=0;$script:epochReads=0;$script:beforeGuard=$null;$script:guardNodeMutation=$null
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
  @{category='runtime-id';mutate={param($node) $node.rid='PRIVATE-RUNTIME-ID'}},
  @{category='structure';mutate={param($node) $node.aid='PRIVATE-AUTOMATION-ID'}},
  @{category='content';mutate={param($node) $node.val='PRIVATE-CONTENT'}},
  @{category='selected';mutate={param($node) $node.selected=$true}},
  @{category='enabled';mutate={param($node) $node.on=$false}},
  @{category='geometry';mutate={param($node) $node.x=21}}
)) {
  Reset-Scenario
  $script:guardNodeMutation=$case.mutate
  $result=Assert-Preparation ('Fingerprint category ' + $case.category) $false 0
  $expected='Help-window close was not verified: Die private Fensterbindung hat sich vor WM_CLOSE geaendert. [preparation:guard-fingerprint-' + $case.category + ']'
  Assert-True ($result.error -ceq $expected) 'Mismatch diagnostics were not a fixed value-free category.'
  Assert-True ($script:walks -eq 2 -and $AE::MainReads -eq 1 -and $AE::TipReads -eq 1 -and
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
Write-Output 'Table preparation: explicit exact owned nonmodal Tips only; fresh complete state checks, zero-action fast path and one-attempt unknown outcomes verified.'
