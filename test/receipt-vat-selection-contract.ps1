$ErrorActionPreference='Stop'
$repository=Split-Path $PSScriptRoot -Parent
function Assert-True($Value,[string]$Message){if(-not $Value){throw $Message}}
function Read-Ast([string]$Path){
  $errors=$null
  $value=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$null,[ref]$errors)
  Assert-True (-not $errors.Count) 'Actual source parse failed.'
  $value
}
$actualAst=Read-Ast (Join-Path $repository 'powershell/sse-worker.ps1')
$comboAst=Read-Ast (Join-Path $repository 'powershell/table-combobox.ps1')
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public static class VatSelectionFixture {
 public static string Mode,Value,Rid,ComboRid,OptionRid,Stage,Wanted;
 public static long MouseAt;
 public static uint Tick;
 public static bool Open,WindowAlive;
 public static int Owner,Reads,Pending;
 public static List<string> Events=new List<string>();
 public static void ClearValue(){Value=null;}
}
public static class SW {
 public static int MouseCalls;
 public static bool IsWindow(IntPtr window){return VatSelectionFixture.WindowAlive;}
 public static uint GetWindowThreadProcessId(IntPtr window,out int owner){owner=VatSelectionFixture.Owner;return 1;}
 public static IntPtr GetForegroundWindow(){return new IntPtr(8);}
 public static void mouse_event(int flags,int x,int y,int data,IntPtr extra){
  MouseCalls++;
  if(flags==4){VatSelectionFixture.Value=VatSelectionFixture.Wanted+" %";VatSelectionFixture.Tick=10;
   VatSelectionFixture.Open=false;VatSelectionFixture.Stage="point-dispatched";VatSelectionFixture.MouseAt=VatFixtureClock.Now;}
 }
}
namespace System.Windows {public sealed class Point {public Point(int x,int y){}}}
public sealed class VatPointElement {
 public int[] GetRuntimeId(){return new int[]{42,7,3};}
 public static VatPointElement FromPoint(object point){
  if(VatSelectionFixture.Mode=="real-point-callback-foreign")VatSelectionFixture.Value=VatSelectionFixture.Wanted=="7" ? "19 %":"7 %";
  return new VatPointElement();
 }
}
public sealed class VatFixtureClock {
 public static long Now;
 private long started;
 public static VatFixtureClock StartNew(){return new VatFixtureClock {started=Now};}
 public long ElapsedMilliseconds {get{return Now-started;}}
 public void Stop(){}
}
namespace System.Windows.Automation {
 public sealed class ExpandView {public string ExpandCollapseState {get{return VatSelectionFixture.Open ? "Expanded":"Collapsed";}}}
 public sealed class ExpandCollapsePattern {
  public static readonly object Pattern=new object();
  public ExpandView Current {get{return new ExpandView();}}
  public void Expand(){
   VatSelectionFixture.Events.Add("expand");VatSelectionFixture.Open=true;VatSelectionFixture.Stage="expanded";
   if(VatSelectionFixture.Mode=="expand-exception")throw new InvalidOperationException("Synthetic expansion failure");
  }
  public void Collapse(){
   VatSelectionFixture.Events.Add("collapse");
   if(VatSelectionFixture.Mode=="collapse-exception")throw new InvalidOperationException("Synthetic collapse failure");
   VatSelectionFixture.Open=VatSelectionFixture.Mode=="collapse-unconfirmed";
   if(VatSelectionFixture.Mode=="foreign-during-collapse")VatSelectionFixture.Value="7 %";
  }
 }
 public sealed class SelectionView {public bool IsSelected=true;public bool IsEnabled=true;}
 public sealed class SelectionItemPattern {
  public static readonly object Pattern=new object();
  public SelectionView Current=new SelectionView();
  public void Select(){
   VatSelectionFixture.Events.Add("select");VatSelectionFixture.Stage="selected";
   switch(VatSelectionFixture.Mode){
    case "semantic-success": VatSelectionFixture.Value=VatSelectionFixture.Wanted+" %";VatSelectionFixture.Open=false;break;
    case "semantic-open":
    case "target-reverted-before-collapse":
    case "collapse-exception":
    case "collapse-unconfirmed":
    case "foreign-during-collapse": VatSelectionFixture.Value=VatSelectionFixture.Wanted+" %";break;
    case "semantic-delayed": VatSelectionFixture.Pending=2;VatSelectionFixture.Open=false;break;
    case "popup-close-delayed-field": VatSelectionFixture.Pending=4;VatSelectionFixture.Open=false;break;
    case "foreign-after-select": VatSelectionFixture.Value="7 %";break;
    case "unknown-after-select": VatSelectionFixture.Value=null;break;
    case "replacement-after-select": VatSelectionFixture.Rid="42.7.9";break;
    case "combo-replacement-after-select": VatSelectionFixture.ComboRid="42.7.9";break;
    case "input-after-select": VatSelectionFixture.Tick=9;break;
    case "input-with-foreign": VatSelectionFixture.Tick=9;VatSelectionFixture.Value="7 %";break;
    case "selection-exception": throw new InvalidOperationException("Synthetic selection failure");
   }
  }
 }
}
public sealed class VatComboElement {
 public bool TryGetCurrentPattern(object pattern,out object value){value=new System.Windows.Automation.ExpandCollapsePattern();return Object.ReferenceEquals(pattern,System.Windows.Automation.ExpandCollapsePattern.Pattern);}
}
public sealed class VatOptionElement {
 public System.Windows.Automation.SelectionView Current=new System.Windows.Automation.SelectionView();
 public VatOptionElement(){if(VatSelectionFixture.Mode=="disabled-option")Current.IsEnabled=false;}
 public bool TryGetCurrentPattern(object pattern,out object value){
  if(VatSelectionFixture.Mode=="unsupported-option" || VatSelectionFixture.Mode=="unsupported-option-foreign"){
   value=null;if(VatSelectionFixture.Mode=="unsupported-option-foreign")VatSelectionFixture.Value="7 %";return false;
  }
  value=new System.Windows.Automation.SelectionItemPattern();return Object.ReferenceEquals(pattern,System.Windows.Automation.SelectionItemPattern.Pattern);
 }
}
'@
function Step-VatFixtureClock([int]$Milliseconds){[VatFixtureClock]::Now += $Milliseconds}
foreach($name in @('Get-SSEReceiptManagerFieldValue','Test-SSEReceiptManagerFieldValue','ConvertTo-SSEReceiptManagerVatRate',
 'Get-SSEReceiptManagerLiveEditableField','Get-SSEReceiptManagerBoundFieldObservation','Test-SSELastInputUnchanged','Emit','Fail')){
  $defs=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
  Assert-True ($defs.Count -eq 1) 'Actual source helper is ambiguous.'
  Invoke-Expression $defs[0].Extent.Text
}
foreach($name in @('Wait-SSEReceiptManagerLiveFieldValue','Test-SSEReceiptManagerVatContext','Set-SSEReceiptManagerVatRateSelection')){
  $defs=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
  Assert-True ($defs.Count -eq 1) 'Selection implementation helper is ambiguous.'
  Invoke-Expression ($defs[0].Extent.Text.Replace('[Diagnostics.Stopwatch]','[VatFixtureClock]').Replace('Start-Sleep -Milliseconds','Step-VatFixtureClock -Milliseconds'))
}
foreach($name in @('Get-SSETableComboSourceDiagnostics','Test-SSETableComboNodeDescendant')){
  $defs=@($comboAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
  Assert-True ($defs.Count -eq 1) 'Actual popup helper is ambiguous.'
  Invoke-Expression $defs[0].Extent.Text
}
$sentinel=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$script:SSE_CAPTURE_SENTINEL'},$true))
Assert-True ($sentinel.Count -eq 1) 'Actual capture sentinel ambiguous.'
Invoke-Expression $sentinel[0].Extent.Text
$script:T0=[Diagnostics.Stopwatch]::StartNew();$script:SSE_CAPTURE_OPERATION_RESULT=$true
$fieldPolicy=[pscustomobject]@{valueKind='vat-rate';controlType='Edit';automationIdSuffix='.vat.QLineEdit'}
function New-FieldNode($Value,[string]$Rid='42.7.1'){
 [pscustomobject]@{rid=$Rid;aid='synthetic.vat.QLineEdit';type='Edit';val=$Value;on=$true;x=10;y=10;w=80;h=20}
}
function New-OptionNode([string]$Rid='42.7.3'){
 [pscustomobject]@{rid=$Rid;aid='synthetic.option';type='ListItem';name=([VatSelectionFixture]::Wanted+' %');on=$true;x=20;y=40;w=80;h=20}
}
function Reset-Fixture([string]$Mode){
 [VatSelectionFixture]::Mode=$Mode;[VatSelectionFixture]::Value='0 %';[VatSelectionFixture]::Rid='42.7.1'
 [VatSelectionFixture]::ComboRid='42.7.2';[VatSelectionFixture]::OptionRid='42.7.3';[VatSelectionFixture]::Tick=1
 [VatSelectionFixture]::Open=$false;[VatSelectionFixture]::WindowAlive=$true;[VatSelectionFixture]::Owner=100
 [VatSelectionFixture]::Stage='initial';[VatSelectionFixture]::Reads=0;[VatSelectionFixture]::Pending=0;[VatSelectionFixture]::Events.Clear()
 [VatSelectionFixture]::Wanted='19';[VatSelectionFixture]::MouseAt=0;[SW]::MouseCalls=0
 [VatFixtureClock]::Now=0
 $script:combo=[pscustomobject]@{rid='42.7.2';aid='synthetic.vat';type='ComboBox';on=$true;x=10;y=10;w=80;h=20}
 $script:state=[pscustomobject]@{nodes=@($script:combo)}
 $script:binding=[pscustomobject]@{name='vatRate';policy=$fieldPolicy;node=(New-FieldNode '0 %')}
 $script:SSE_FOREGROUND_LEASE=[pscustomobject]@{watch=New-Object object;targetPid=100;rootHwnd=7;lastOwnedInputTick=1;
  lastAcquireRaised=$false;lastOwnedInputContext='synthetic-original';ownedCursorPoint=$null}
 $script:pointCalls=0;$script:pointDispatches=0;$script:sourceReads=0;$script:SSE_CAPTURED_OPERATION_RESULT=$null
}
function Get-SSELastInputTick{
 if([VatSelectionFixture]::Mode -ceq 'initial-input-unreadable'){return $null}
 if([VatSelectionFixture]::Mode -ceq 'real-point-post-input' -and [VatSelectionFixture]::Stage -ceq 'point-dispatched' -and
  [VatFixtureClock]::Now -ge ([VatSelectionFixture]::MouseAt+180)){[VatSelectionFixture]::Tick=11}
 [VatSelectionFixture]::Tick
}
function Get-LiveElement($Window,$Rid,$Aid){
 switch($Aid){
  'synthetic.vat.QLineEdit' {[pscustomobject]@{kind='field'}}
  'synthetic.vat' {New-Object VatComboElement}
  'synthetic.option' {New-Object VatOptionElement}
  default {throw 'Unexpected native binding.'}
 }
}
function Convert-ExactElementToNode($Element){
 if($Element -is [VatComboElement]){
  [pscustomobject]@{rid=[VatSelectionFixture]::ComboRid;aid='synthetic.vat';type='ComboBox';on=$true;x=10;y=10;w=80;h=20};return
 }
 if($Element -is [VatOptionElement]){
  if([VatSelectionFixture]::Mode -ceq 'real-point-callback-error' -and $script:cursorMoves -gt 0){throw [InvalidOperationException]::new('Synthetic callback native read error')}
  if([VatSelectionFixture]::Mode -ceq 'point-ordinary-error' -and $script:pointCalls -gt 0){throw [InvalidOperationException]::new('Synthetic callback native read error')}
  if([VatSelectionFixture]::Mode -ceq 'option-replacement-before-select'){New-OptionNode '42.7.9';return}
  $node=New-OptionNode ([VatSelectionFixture]::OptionRid);$node.on=$Element.Current.IsEnabled;$node;return
 }
 Assert-True ($Element.kind -ceq 'field') 'Unexpected native node conversion.'
 if([VatSelectionFixture]::Stage -ceq 'selected'){
  [VatSelectionFixture]::Reads++
  if([VatSelectionFixture]::Mode -ceq 'native-read-error'){throw 'Synthetic native field read error'}
  if([VatSelectionFixture]::Mode -ceq 'capture-read-error'){Emit ([pscustomobject]@{ok=$false;kind='synthetic-capture';error='Synthetic capture'})}
  if([VatSelectionFixture]::Mode -ceq 'target-reverted-before-collapse' -and [VatSelectionFixture]::Reads -gt 1){[VatSelectionFixture]::Value='0 %'}
  if([VatSelectionFixture]::Reads -eq 1){
   switch([VatSelectionFixture]::Mode){
    'transient-unknown' {New-FieldNode $null;return}
    'transient-foreign' {New-FieldNode '7 %';return}
    'transient-replacement' {New-FieldNode '0 %' '42.7.9';return}
   }
  }
  if([VatSelectionFixture]::Pending -gt 0){[VatSelectionFixture]::Pending--}
  elseif([VatSelectionFixture]::Mode -in @('semantic-delayed','popup-close-delayed-field')){[VatSelectionFixture]::Value=[VatSelectionFixture]::Wanted+' %'}
 }
 New-FieldNode ([VatSelectionFixture]::Value) ([VatSelectionFixture]::Rid)
}
function Get-Windows($Name){
 if([VatSelectionFixture]::Mode -ceq 'foreign-before-expand'){[VatSelectionFixture]::Value='7 %'}
 [pscustomobject]@{pid=100;hwnd=7}
}
function Get-SSETableComboPopupSources($ProcessId,$Window,$Before){
 $script:sourceReads++
 if([VatSelectionFixture]::Mode -ceq 'foreign-before-select'){[VatSelectionFixture]::Value='7 %'}
 $stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0}
 if([VatSelectionFixture]::Mode -ceq 'source-incomplete-before-select' -or
   ([VatSelectionFixture]::Mode -ceq 'source-incomplete-after-select' -and $script:sourceReads -gt 1)){$stats.truncated=$true}
 $source=8;$rid='42.7.3'
 if($script:sourceReads -gt 1){
  if([VatSelectionFixture]::Mode -ceq 'popup-replacement-after-select'){$source=9}
  if([VatSelectionFixture]::Mode -ceq 'option-replacement-after-select'){$rid='42.7.9'}
 }
 $nodes=@()
 if([VatSelectionFixture]::Open){$nodes=@(New-OptionNode $rid)}
 switch([VatSelectionFixture]::Mode){
  'missing-option' {$nodes=@()}
  'missing-option-foreign' {$nodes=@();[VatSelectionFixture]::Value='7 %'}
  'duplicate-option' {$nodes=@((New-OptionNode),(New-OptionNode '42.7.4'))}
 }
 [pscustomobject]@{hwnd=$source;isNewPopup=$true;tree=[pscustomobject]@{nodes=$nodes;stats=$stats}}
}
function Get-SSEPointObstruction($Window,$X,$Y){[pscustomobject]@{isBoundTarget=$true;boundPid=100}}
function New-PointFailure([string]$Message,$Dispatched){
 $failure=New-Object InvalidOperationException $Message
 if($null -ne $Dispatched){$failure.Data['inputDispatched']=[bool]$Dispatched}
 $failure.Data['kind']='synthetic-point-failure'
 $failure
}
function Click-VerifiedPoint($Window,$Node,$ExpectedInputTick,[switch]$RequireForeground,[string]$ExpectedRuntimeId,$BeforeClickCheck,$BeforeClickBinding,[switch]$ThrowOnFailure){
 $script:pointCalls++
 Assert-True ($ExpectedInputTick -eq 1 -and $RequireForeground -and $ThrowOnFailure -and $ExpectedRuntimeId -ceq '42.7.3' -and
  $null -ne $BeforeClickCheck -and $null -ne $BeforeClickBinding) 'Actual caller lost original input/option/callback/throwing authority.'
 switch([VatSelectionFixture]::Mode){
  'foreign-at-point' {[VatSelectionFixture]::Value='7 %'}
  'unreadable-at-point' {[VatSelectionFixture]::ClearValue()}
  'input-at-point' {[VatSelectionFixture]::Tick=9}
  'option-replacement-at-point' {[VatSelectionFixture]::OptionRid='42.7.9'}
  'lease-replaced-at-point' {$script:SSE_FOREGROUND_LEASE.watch=New-Object object}
  'point-no-dispatch-error' {throw (New-PointFailure 'Synthetic refused point' $false)}
 }
 if(-not (& $BeforeClickCheck $Window $BeforeClickBinding 60 50)){throw (New-PointFailure 'Synthetic last point refusal' $false)}
 $script:pointDispatches++
 [VatSelectionFixture]::Value=[VatSelectionFixture]::Wanted+' %';[VatSelectionFixture]::Tick=10;[VatSelectionFixture]::Open=$false
 $script:SSE_FOREGROUND_LEASE.lastOwnedInputTick=10
 if([VatSelectionFixture]::Mode -ceq 'point-unknown-error'){throw (New-PointFailure 'Synthetic point acknowledgment loss' $true)}
 if([VatSelectionFixture]::Mode -ceq 'point-post-input'){
  [VatSelectionFixture]::Tick=11
  $failure=New-PointFailure 'Synthetic post-dispatch input interference' $true
  $failure.Data['kind']='interference';throw $failure
 }
 [pscustomobject]@{x=60;y=50;clickCount=1;inputTickAfterClick=$(if([VatSelectionFixture]::Mode -ceq 'point-tick-missing'){$null}else{10})}
}
$negativeModes=@('foreign-after-select','unknown-after-select','replacement-after-select','combo-replacement-after-select','input-after-select','input-with-foreign',
 'selection-exception','expand-exception','foreign-before-expand','foreign-before-select','source-incomplete-before-select','source-incomplete-after-select',
 'popup-replacement-after-select','option-replacement-after-select','foreign-at-point','unreadable-at-point','input-at-point','option-replacement-at-point','lease-replaced-at-point',
 'point-no-dispatch-error','point-ordinary-error','point-unknown-error','point-tick-missing','point-post-input','transient-unknown','transient-foreign','transient-replacement','native-read-error','target-reverted-before-collapse','option-replacement-before-select',
 'missing-option-foreign','unsupported-option-foreign','disabled-option')
foreach($mode in $negativeModes){
 Reset-Fixture $mode
 $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 $state ([pscustomobject]@{}) $binding '0 %' '19 %' 1
 Assert-True (-not $result.ok -and $result.interference -and -not [VatSelectionFixture]::Events.Contains('collapse')) "Unsafe selection '$mode' returned success or collapsed."
 if($mode -notin @('point-unknown-error','point-tick-missing','point-post-input')){Assert-True ($script:pointDispatches -eq 0) "Unsafe selection '$mode' dispatched a point."}
 if($mode -in @('transient-unknown','transient-foreign','transient-replacement')){Assert-True ([VatSelectionFixture]::Reads -eq 1) 'A later read reopened lost ownership.'}
 if($mode -in @('foreign-before-expand','foreign-before-select','source-incomplete-before-select')){Assert-True (-not [VatSelectionFixture]::Events.Contains('select')) 'Selection ran after an early lost precondition.'}
 if($mode -ceq 'point-no-dispatch-error'){Assert-True ($result.physicalCommit.inputDispatched -eq $false) 'Known pre-dispatch refusal lost actual evidence.'}
 if($mode -ceq 'point-unknown-error'){Assert-True ($result.physicalCommit.inputDispatched -eq $true -and $null -eq $result.after) 'Lost point acknowledgment was turned into clean failure or stale success.'}
 if($mode -ceq 'point-post-input'){Assert-True ($result.physicalCommit.kind -ceq 'interference' -and $result.physicalCommit.inputDispatched -eq $true -and $null -eq $result.after) 'Actual post-dispatch error shape was not retained.'}
 if($mode -ceq 'point-ordinary-error'){Assert-True ($null -eq $result.physicalCommit.inputDispatched) 'Missing point evidence became a known no-dispatch result.'}
}
foreach($mode in @('collapse-exception','collapse-unconfirmed','foreign-during-collapse')){
 Reset-Fixture $mode
 $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 $state ([pscustomobject]@{}) $binding '0 %' '19 %' 1
 Assert-True (-not $result.ok -and $result.interference -and $result.mutationStarted -and
  @([VatSelectionFixture]::Events | Where-Object {$_ -ceq 'collapse'}).Count -eq 1 -and $script:pointDispatches -eq 0) 'Unconfirmed cleanup hid mutation or triggered another action.'
}
foreach($mode in @('semantic-success','semantic-open','semantic-delayed','popup-close-delayed-field','semantic-pending')){
 Reset-Fixture $mode
 $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 $state ([pscustomobject]@{}) $binding '0 %' '19 %' 1
 Assert-True ($result.ok -and $result.after -ceq '19' -and -not [VatSelectionFixture]::Open) "Safe selection '$mode' failed: $($result.error)"
 $expectedPoints=@{'semantic-success'=0;'semantic-open'=0;'semantic-delayed'=0;'popup-close-delayed-field'=0;'semantic-pending'=1}[$mode]
 Assert-True ($script:pointDispatches -eq $expectedPoints) "Safe selection '$mode' used wrong physical point count."
 if($mode -ceq 'semantic-open'){Assert-True (@([VatSelectionFixture]::Events | Where-Object {$_ -ceq 'collapse'}).Count -eq 1) 'Owned open popup was not closed exactly once.'}
}
foreach($mode in @('missing-option','duplicate-option','unsupported-option')){
 Reset-Fixture $mode
 $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 $state ([pscustomobject]@{}) $binding '0 %' '19 %' 1
 Assert-True (-not $result.ok -and -not $result.mutationStarted -and -not $result.interference -and
  @([VatSelectionFixture]::Events | Where-Object {$_ -ceq 'collapse'}).Count -eq 1 -and
  -not [VatSelectionFixture]::Events.Contains('select') -and $script:pointCalls -eq 0 -and
  [VatSelectionFixture]::Value -ceq '0 %' -and -not [VatSelectionFixture]::Open) 'Known unavailable selection lost its verified owned cleanup.'
}
foreach($mode in @('initial-lease-missing','initial-watch-missing','initial-lease-other-owner','initial-window-other-owner',
 'initial-window-closed','initial-input-unreadable','initial-input-changed','initial-checkpoint-missing','initial-combo-replaced')){
 Reset-Fixture $mode
 switch($mode){
  'initial-lease-missing' {$script:SSE_FOREGROUND_LEASE=$null}
  'initial-watch-missing' {$script:SSE_FOREGROUND_LEASE.watch=$null}
  'initial-lease-other-owner' {$script:SSE_FOREGROUND_LEASE.targetPid=101}
  'initial-window-other-owner' {[VatSelectionFixture]::Owner=101}
  'initial-window-closed' {[VatSelectionFixture]::WindowAlive=$false}
  'initial-input-changed' {[VatSelectionFixture]::Tick=9}
  'initial-checkpoint-missing' {$script:SSE_FOREGROUND_LEASE.lastOwnedInputTick=$null}
  'initial-combo-replaced' {[VatSelectionFixture]::ComboRid='42.7.9'}
 }
 $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 $state ([pscustomobject]@{}) $binding '0 %' '19 %' 1
 Assert-True (-not $result.ok -and $result.interference -and -not $result.mutationStarted -and
  [VatSelectionFixture]::Events.Count -eq 0 -and $script:pointCalls -eq 0) "Lost initial context '$mode' reached an action."
 if($mode -ceq 'initial-window-other-owner'){Assert-True (-not $result.inputInterference) 'Window loss invented input interference.'}
}
Reset-Fixture 'capture-read-error'
$caught=$null
try{$null=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 $state ([pscustomobject]@{}) $binding '0 %' '19 %' 1}catch{$caught=$_.Exception.Message}
Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $script:SSE_CAPTURED_OPERATION_RESULT.kind -ceq 'synthetic-capture' -and
 $script:pointDispatches -eq 0 -and -not [VatSelectionFixture]::Events.Contains('collapse')) 'Actual capture was wrapped or followed by an action.'
# Dieselbe Auswahl mit der tatsaechlichen Klickfunktion verbinden. Nur die
# nativen Fenster-/Zeiger-/UIA-Grenzen und die Uhr bleiben modelliert.
foreach($name in @('Click-VerifiedPoint','Set-SSEForegroundLeaseInputCheckpoint')){
 $defs=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
 Assert-True ($defs.Count -eq 1) 'Actual physical producer or checkpoint ambiguous.'
 Invoke-Expression ($defs[0].Extent.Text.Replace('Start-Sleep -Milliseconds','Step-VatFixtureClock -Milliseconds'))
}
$script:AE=[VatPointElement]
function Show-SSEWindow {
 if([VatSelectionFixture]::Mode -ceq 'real-point-show-error'){throw [InvalidOperationException]::new('Synthetic native foreground error')}
}
function Hide-SSETopmost {}
function Set-SSECursorPoint { $script:cursorMoves++ }
function Assert-SSECursorPoint {}
foreach($wanted in @('7','19')){
 Reset-Fixture 'real-point-success';[VatSelectionFixture]::Wanted=$wanted;$script:cursorMoves=0
 $originalWatch=$script:SSE_FOREGROUND_LEASE.watch
 $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 $state ([pscustomobject]@{}) $binding '0 %' ($wanted+' %') 1
 Assert-True ($result.ok -and $result.after -ceq $wanted -and [SW]::MouseCalls -eq 2 -and
  $script:SSE_FOREGROUND_LEASE.lastOwnedInputTick -eq 10 -and [Object]::ReferenceEquals($originalWatch,$script:SSE_FOREGROUND_LEASE.watch) -and
  -not [VatSelectionFixture]::Events.Contains('collapse')) 'Actual point/checkpoint composition lost its one-click success or adopted another lease.'
}
foreach($wanted in @('7','19')){
 foreach($case in @(
 @{mode='real-point-callback-foreign';dispatched=$false;mouse=0;kind='stale'},
 @{mode='real-point-post-input';dispatched=$true;mouse=2;kind='interference'},
 @{mode='real-point-callback-error';dispatched=$null;mouse=0;kind=''},
 @{mode='real-point-show-error';dispatched=$null;mouse=0;kind=''}
)){
 Reset-Fixture $case.mode;[VatSelectionFixture]::Wanted=$wanted;$script:cursorMoves=0
 $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 $state ([pscustomobject]@{}) $binding '0 %' ($wanted+' %') 1
 Assert-True (-not $result.ok -and $result.interference -and $result.mutationStarted -and
  $result.physicalCommit.inputDispatched -eq $case.dispatched -and $result.physicalCommit.kind -ceq $case.kind -and
  [SW]::MouseCalls -eq $case.mouse -and $null -eq $result.after -and -not [VatSelectionFixture]::Events.Contains('collapse')) `
  "Actual point '$($case.mode)' for rate '$wanted' escaped its transaction or changed dispatch/capture evidence."
 }
}
Write-Output 'Receipt VAT selection: actual guards, transient loss, semantic success, real point/checkpoint composition and capture contracts passed.'
