$ErrorActionPreference='Stop'
$repository=Split-Path $PSScriptRoot -Parent
. (Join-Path $repository 'test/receipt-vat-selection-contract.ps1')
foreach($name in @('Get-SSEReceiptManagerState','Get-SSETextSha256','Get-SSEReceiptManagerListProjection','Close-SSEReceiptManagerDetailView')){
 $definition=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name}.GetNewClosure(),$true))
 Assert-True ($definition.Count -eq 1) 'Actual state helper ambiguous.'
 Invoke-Expression ($definition[0].Extent.Text.Replace('[Diagnostics.Stopwatch]','[VatFixtureClock]').Replace('Start-Sleep -Milliseconds','Step-VatFixtureClock -Milliseconds'))
}

Add-Type -TypeDefinition @'
public sealed class ReceiptClosePoint {
 public static int PointId=13;
 public int[] GetRuntimeId(){return new int[]{42,7,PointId};}
 public static ReceiptClosePoint FromPoint(object point){return new ReceiptClosePoint();}
}
namespace System.Windows.Automation {
 public sealed class GridView {public int RowCount=2;public int ColumnCount=2;}
 public sealed class GridPattern {
  public static readonly object Pattern=new object();
  public GridView Current=new GridView();
  public object GetItem(int row,int column){throw new System.InvalidOperationException("Mismatching grid must not be read");}
 }
}
public sealed class ReceiptTableElement {
 public bool TryGetCurrentPattern(object pattern,out object value){
  value=new System.Windows.Automation.GridPattern();
  return System.Object.ReferenceEquals(pattern,System.Windows.Automation.GridPattern.Pattern);
 }
}
'@
$script:AE=[ReceiptClosePoint]
$policy=[pscustomobject]@{
 states=[pscustomobject]@{detail=[pscustomobject]@{requiredAutomationIdSuffixes=@('.detail.anchor')};list=[pscustomobject]@{requiredAutomationIdSuffixes=@('.list.anchor')}}
 actions=[pscustomobject]@{}
 controls=[pscustomobject]@{detailClose=[pscustomobject]@{automationIdSuffix='.close';expectedName='synthetic-close'}}
 list=[pscustomobject]@{tableAutomationIdSuffix='.table';countLabelAutomationIdSuffixes=@('.count');documentNumberColumn=1;draftMarker='(draft)';searchAutomationIdSuffix='.search'}
}
function New-CloseNode{
 [pscustomobject]@{rid='42.7.13';aid='synthetic.close';type='Button';name='synthetic-close';on=$true;x=20;y=40;w=80;h=20}
}
function New-ListNodes{
 @([pscustomobject]@{rid='42.7.15';aid='synthetic.list.anchor';type='Pane';name='synthetic-list';on=$true;x=0;y=0;w=100;h=20},
 [pscustomobject]@{rid='42.7.16';aid='synthetic.table';type='Table';name='';on=$true;x=0;y=30;w=200;h=100},
 [pscustomobject]@{rid='42.7.17';aid='synthetic.count';type='Text';name='MEINE BELEGE (0)';on=$true;x=0;y=0;w=100;h=20})
}
function Walk-Tree($Window,$MaxNodes,[switch]$WithValues){
 $nodes=@($script:closeNode,$script:detailAnchor)
 if([VatSelectionFixture]::Stage -ceq 'point-dispatched'){
  $script:closeStateReads++
  $nodes=@(New-ListNodes)
  switch([VatSelectionFixture]::Mode){
   'close-stays-open' {$nodes=@($script:closeNode,$script:detailAnchor)}
   'close-state-unknown' {$nodes=@()}
   'close-state-delayed' {if($script:closeStateReads -eq 1){$nodes=@()}}
   'close-delayed-incomplete' {if($script:closeStateReads -eq 1){$nodes=@()}else{$nodes[2].name='MEINE BELEGE (1)'}}
   'close-delayed-with-close' {if($script:closeStateReads -eq 1){$nodes=@()}else{$nodes+=New-CloseNode}}
   'close-state-input' {[VatSelectionFixture]::Tick=11}
   'close-state-checkpoint' {$script:SSE_FOREGROUND_LEASE.lastOwnedInputTick=11}
   'close-state-lease' {$script:SSE_FOREGROUND_LEASE.watch=New-Object object}
   'close-state-exception' {throw [InvalidOperationException]::new('Synthetic state provider failure')}
   'close-state-capture' {
    $script:closeCapturePayload=[pscustomobject]@{ok=$false;kind='synthetic-close-state-capture';error='Synthetic state capture'}
    Emit $script:closeCapturePayload
   }
   'close-list-invalid' {$nodes[2].name='invalid-count'}
   'close-list-incomplete' {$nodes[2].name='MEINE BELEGE (1)'}
   'close-list-with-close' {$nodes+=New-CloseNode}
   'close-disabled-remains' {$node=New-CloseNode;$node.on=$false;$nodes+=$node}
   'close-unknown-enabled' {$node=New-CloseNode;$node.on=$null;$nodes+=$node}
   'close-disabled-delayed' {if($script:closeStateReads -eq 1){$node=New-CloseNode;$node.on=$false;$nodes+=$node}}
  }
 }
 [pscustomobject]@{nodes=$nodes;stats=[pscustomobject]@{truncated=$false;err=0;cyc=0;depthLimited=$false}}
}
function Get-LiveElement($Window,$Rid,$Aid){
 if($Aid -ceq 'synthetic.table'){return New-Object ReceiptTableElement}
 $script:closeNativeReads++
 $node=New-CloseNode
 if($script:closeNativeReads -ge 2){
  switch([VatSelectionFixture]::Mode){
   'close-rid-at-point' {$node.rid='42.7.99'}
   'close-aid-at-point' {$node.aid='synthetic.other'}
   'close-name-at-point' {$node.name='other'}
   'close-disabled-at-point' {$node.on=$false}
   'close-moved-at-point' {$node.x=300}
   'close-input-at-point' {[VatSelectionFixture]::Tick=9}
   'close-capture-at-point' {
    $script:closeCapturePayload=[pscustomobject]@{ok=$false;kind='synthetic-close-point-capture';error='Synthetic close point capture'}
    Emit $script:closeCapturePayload
   }
  }
 }
 $node
}
function Convert-ExactElementToNode($Element){$Element}
function Reset-Close([string]$Mode){
 Reset-Fixture $Mode
 [ReceiptClosePoint]::PointId=$(if($Mode -ceq 'close-foreign-point-rid'){99}else{13})
 $script:closeNode=New-CloseNode
 $script:detailAnchor=[pscustomobject]@{rid='42.7.14';aid='synthetic.detail.anchor';type='Pane';name='synthetic-detail';on=$true;x=0;y=0;w=100;h=20}
 $script:closeNativeReads=0;$script:closeStateReads=0;$script:closeCapturePayload=$null;$script:cursorMoves=0
 $script:initialCloseState=Get-SSEReceiptManagerState ([IntPtr]8) $policy -WithValues
 Assert-True ($initialCloseState.state -ceq 'detail') 'Original actual state must be valid.'
}
foreach($mode in @('close-success','close-state-delayed','close-disabled-delayed')){
 Reset-Close $mode
 $result=Close-SSEReceiptManagerDetailView ([IntPtr]8) $initialCloseState $policy 200
 Assert-True ($result -and $result.state.state -ceq 'list' -and $result.list.rowsComplete -and
  $result.clickBinding.inputTickAfterClick -eq 10 -and $script:SSE_FOREGROUND_LEASE.lastOwnedInputTick -eq 10 -and
  [SW]::MouseCalls -eq 2 -and $null -eq $script:SSE_CAPTURED_OPERATION_RESULT) 'Actual owned close/list/checkpoint composition failed.'
 if($mode -ceq 'close-disabled-delayed'){Assert-True ($script:closeStateReads -eq 2) 'Visible disabled close control was mistaken for completed closing.'}
}
foreach($case in @(
 @{mode='close-initial-input';mouse=0;dispatched=$false;kind='interference'},
 @{mode='close-rid-at-point';mouse=0;dispatched=$false;kind='stale'},
 @{mode='close-foreign-point-rid';mouse=0;dispatched=$false;kind='stale'},
 @{mode='close-aid-at-point';mouse=0;dispatched=$false;kind='stale'},
 @{mode='close-name-at-point';mouse=0;dispatched=$false;kind='stale'},
 @{mode='close-disabled-at-point';mouse=0;dispatched=$false;kind='stale'},
 @{mode='close-moved-at-point';mouse=0;dispatched=$false;kind='stale'},
 @{mode='close-input-at-point';mouse=0;dispatched=$false;kind='interference'},
 @{mode='real-point-show-error';mouse=0;dispatched=$null;kind=$null},
 @{mode='real-point-post-input';mouse=2;dispatched=$true;kind='interference'},
 @{mode='close-state-unknown';mouse=2;dispatched=$true;kind='state-unknown'},
 @{mode='close-stays-open';mouse=2;dispatched=$true;kind='detail-close-pending'},
 @{mode='close-state-input';mouse=2;dispatched=$true;kind='interference'},
 @{mode='close-state-checkpoint';mouse=2;dispatched=$true;kind='interference'},
 @{mode='close-state-lease';mouse=2;dispatched=$true;kind='interference'},
 @{mode='close-state-exception';mouse=2;dispatched=$true;kind='state-read-failed'},
 @{mode='close-list-invalid';mouse=2;dispatched=$true;kind='profile-contract'},
 @{mode='close-list-incomplete';mouse=2;dispatched=$true;kind='postcondition-failed'},
 @{mode='close-list-with-close';mouse=2;dispatched=$true;kind='postcondition-failed'},
 @{mode='close-disabled-remains';mouse=2;dispatched=$true;kind='postcondition-failed'},
 @{mode='close-unknown-enabled';mouse=2;dispatched=$true;kind='postcondition-failed'},
 @{mode='close-delayed-incomplete';mouse=2;dispatched=$true;kind='postcondition-failed'},
 @{mode='close-delayed-with-close';mouse=2;dispatched=$true;kind='postcondition-failed'}
)){
 Reset-Close $case.mode
 if($case.mode -ceq 'close-initial-input'){[VatSelectionFixture]::Tick=9}
 $caught=$null
 try{$null=Close-SSEReceiptManagerDetailView ([IntPtr]8) $initialCloseState $policy 200}catch{$caught=$_.Exception}
 Assert-True ($caught -and $caught.Message -cne $script:SSE_CAPTURE_SENTINEL -and $caught.Data['inputDispatched'] -eq $case.dispatched -and
  $caught.Data['kind'] -ceq $case.kind -and [SW]::MouseCalls -eq $case.mouse -and $null -eq $script:SSE_CAPTURED_OPERATION_RESULT) "Unsafe close '$($case.mode)' lost point evidence or exited terminally."
 Assert-True ([VatFixtureClock]::Now -le 480) 'Close polling exceeded the common read deadline.'
 $expectedInputLoss=$case.mode -in @('close-initial-input','close-input-at-point','close-state-input','close-state-checkpoint')
 Assert-True ($caught.Data['inputInterference'] -eq $expectedInputLoss) 'Observed context input loss disappeared behind close failure.'
}
foreach($case in @(@{mode='close-capture-at-point';mouse=0},@{mode='close-state-capture';mouse=2})){
 Reset-Close $case.mode
 $caught=$null
 try{$null=Close-SSEReceiptManagerDetailView ([IntPtr]8) $initialCloseState $policy 200}catch{$caught=$_.Exception.Message}
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and [Object]::ReferenceEquals($script:closeCapturePayload,$script:SSE_CAPTURED_OPERATION_RESULT) -and
  [SW]::MouseCalls -eq $case.mouse) 'Actual close swallowed or replaced actual Emit capture.'
}
foreach($case in @(
 @{mode='list-wrong-state';kind='precondition-failed'},
 @{mode='list-table-missing';kind='profile-contract'},
 @{mode='list-count-duplicate';kind='profile-contract'},
 @{mode='list-count-invalid';kind='profile-contract'},
 @{mode='list-row-id-missing';kind='profile-contract'}
)){
 Reset-Fixture $case.mode
 $state=[pscustomobject]@{window=8;state='list';nodes=@(New-ListNodes)}
 switch($case.mode){
  'list-wrong-state' {$state.state='detail'}
  'list-table-missing' {$state.nodes=@($state.nodes|Where-Object type -CNE 'Table')}
  'list-count-duplicate' {$state.nodes+=$state.nodes[2]}
  'list-count-invalid' {$state.nodes[2].name='invalid-count'}
  'list-row-id-missing' {
   $state.nodes[2].name='MEINE BELEGE (1)'
   $state.nodes+=[pscustomobject]@{rid='';aid='synthetic.table';type='DataItem';name='synthetic-row';on=$true;x=0;y=50;w=80;h=20}
  }
 }
 $result=Get-SSEReceiptManagerListProjection $state $policy -ReturnFailure
 Assert-True ($result -and $result.ok -eq $false -and $result.kind -ceq $case.kind -and $result.error -and
  $null -eq $script:SSE_CAPTURED_OPERATION_RESULT) 'Actual nonterminal list failure escaped its caller.'
 $caught=$null
 try{$null=Get-SSEReceiptManagerListProjection $state $policy}catch{$caught=$_.Exception.Message}
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $script:SSE_CAPTURED_OPERATION_RESULT.kind -ceq $result.kind -and
  $script:SSE_CAPTURED_OPERATION_RESULT.error -ceq $result.error) 'Default terminal list contract changed.'
}
$ordinaryCloseLive=${function:Get-LiveElement}
function Get-LiveElement($Window,$Rid,$Aid){
 if($Aid -ceq 'synthetic.table' -and [VatSelectionFixture]::Mode -ceq 'list-grid-capture'){
  $script:closeCapturePayload=[pscustomobject]@{ok=$false;kind='synthetic-grid-capture';error='Synthetic native grid capture'}
  Emit $script:closeCapturePayload
 }
 & $ordinaryCloseLive $Window $Rid $Aid
}
Reset-Fixture 'list-grid-capture'
$state=[pscustomobject]@{window=8;state='list';nodes=@(New-ListNodes)}
$state.nodes[2].name='MEINE BELEGE (1)'
$caught=$null
try{$null=Get-SSEReceiptManagerListProjection $state $policy -ReturnFailure}catch{$caught=$_.Exception.Message}
Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and $script:closeCapturePayload -and
 [Object]::ReferenceEquals($script:closeCapturePayload,$script:SSE_CAPTURED_OPERATION_RESULT)) 'Actual grid projection catch swallowed captured operation.'
$closeCallers=@($actualAst.FindAll({param($n)$n -is [Management.Automation.Language.TryStatementAst] -and
 $n.Body.Extent.Text.Contains('Close-SSEReceiptManagerDetailView')},$true))
Assert-True ($closeCallers.Count -eq 5) 'Actual close capture caller inventory changed.'
foreach($caller in $closeCallers){
 Reset-Fixture 'close-caller-capture'
 $payload=[pscustomobject]@{ok=$false;kind='synthetic-close-caller-capture';error='Synthetic original operation result'}
 $body=$caller.CatchClauses[0].Body.Extent.Text
 $caught=$null
 try{Invoke-Expression ('try { Emit $payload } catch '+$body)}catch{$caught=$_.Exception.Message}
 Assert-True ($caught -ceq $script:SSE_CAPTURE_SENTINEL -and [Object]::ReferenceEquals($payload,$script:SSE_CAPTURED_OPERATION_RESULT) -and
  [SW]::MouseCalls -eq 0) 'Actual close caller swallowed or replaced an original captured result.'
}
Write-Output 'Receipt close: actual state/list/point/checkpoint, pending read deadline, foreign context and real capture tests passed without product input.'
