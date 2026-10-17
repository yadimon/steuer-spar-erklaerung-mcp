$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker parse failed: $($errors[0].Message)" }
. (Join-Path $root 'powershell\load-native.ps1')
$null = Import-SSENativeInterop
foreach ($name in @('Arg','Resolve-Nodes','Resolve-Node','Resolve-TrackedFieldNode')) {
  $definitions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definitions.Count -ne 1) { throw "Ambiguous production function: $name" }
  Invoke-Expression $definitions[0].Extent.Text
}
$clauses = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst]
}, $true) | ForEach-Object { $_.Clauses } | Where-Object { $_.Item1.Value -ceq 'tracked_set_value' })
if ($clauses.Count -ne 1) { throw 'Actual tracked_set_value operation must be unique.' }
$body = $clauses[0].Item2.Extent.Text
$operation = [scriptblock]::Create($body.Substring(1, $body.Length - 2))

# Deterministic boundaries cannot operate a real window. The actual production
# resolver and tracked_set_value caller run until a counted fake commit.
Add-Type -TypeDefinition @'
using System;
public static class FieldResolutionCanary {
  public static int SetValueCalls, ToggleCalls, InvokeCalls;
  public static string LastRid;
  public static void Reset() { SetValueCalls=0;ToggleCalls=0;InvokeCalls=0;LastRid=null; }
}
public sealed class FieldResolutionValueState { public string Value="before";public bool IsReadOnly=false; }
public sealed class FieldResolutionPattern {
  public FieldResolutionValueState Current=new FieldResolutionValueState();
  public void SetValue(string value) { FieldResolutionCanary.SetValueCalls++;Current.Value=value; }
  public void Toggle() { FieldResolutionCanary.ToggleCalls++; }
  public void Invoke() { FieldResolutionCanary.InvokeCalls++; }
}
public sealed class FieldResolutionElement {
  public FieldResolutionPattern Value=new FieldResolutionPattern();
  public bool TryGetCurrentPattern(object pattern,out object value) { value=Value;return true; }
}
'@
function Fail($Message, $Kind='error') {
  $failure = New-Object InvalidOperationException ([string]$Message)
  $failure.Data['kind'] = $Kind
  throw $failure
}
function New-SSEPhaseLog { [pscustomobject]@{ phases=@() } }
function Complete-SSEPhase {}
function Resolve-BoundWriteWindow { [pscustomobject]@{ window=[pscustomobject]@{ hwnd=7;pid=100 };bindingMode='explicit' } }
function Test-Canary { [pscustomobject]@{ ok=$true;ms=0 } }
function Get-DialogInventory {}
function Walk-Tree { $script:fixture }
function Get-CurrentHeading { 'Synthetic page' }
function Get-ContentBounds { [pscustomobject]@{ minX=0;maxX=800 } }
function Get-CaptionMinX { 0 }
function Test-SSETrackedValueEquivalent($Actual, $Expected, $Kind) { [string]$Actual -ceq [string]$Expected }
function Get-LiveElement($Hwnd, $Rid, $Aid) { $script:elements[[string]$Rid] }
function Get-SSEInteractionWindowSet { [pscustomobject]@{ fingerprint='unchanged';windows=@() } }
function Commit-TrackedValue($Hwnd, $Node, $Value, $Before) {
  [FieldResolutionCanary]::LastRid = [string]$Node.rid
  $script:elements[[string]$Node.rid].Value.SetValue([string]$Value)
  Fail 'Counted synthetic commit reached.' 'commit-reached'
}
function Commit-TrackedValueFocusless { throw 'Hidden-desktop commit is forbidden in this test.' }

function New-FieldNode([string]$Rid, [string]$Aid, [string]$Name, [string]$Type='Edit', [int]$Parent=10, [int]$X=200, [int]$Y=60) {
  $node = New-Object SSEUiaNodeView
  $node.rid=$Rid;$node.aid=$Aid;$node.name=$Name;$node.type=$Type;$node.on=$true
  $node.p=$Parent;$node.x=$X;$node.y=$Y;$node.w=100;$node.h=20
  $node
}
function Invoke-CallerCase([string]$Name, [SSEUiaNodeView[]]$Nodes, $Selector, [string]$ExpectedKind, [string]$ExpectedRid='') {
  $script:fixture=[pscustomobject]@{ nodes=$Nodes }
  $script:elements=@{}
  foreach($node in $Nodes){$script:elements[$node.rid]=New-Object FieldResolutionElement}
  [FieldResolutionCanary]::Reset()
  $script:DESKTOP_NAME=''
  $a=[pscustomobject]@{ expectedPage='Synthetic page';expectedBefore='before';value='requested';expectedAfter='requested';trackResults=$false }
  foreach($property in $Selector.PSObject.Properties){$a | Add-Member NoteProperty $property.Name $property.Value}
  $caught=$null
  try { & $operation | Out-Null } catch { $caught=$_ }
  if(-not $caught -or $caught.Exception.Data['kind'] -cne $ExpectedKind){throw "$Name`: wrong caller result: $caught; SetValue=$([FieldResolutionCanary]::SetValueCalls), Toggle=$([FieldResolutionCanary]::ToggleCalls), Invoke=$([FieldResolutionCanary]::InvokeCalls)"}
  $expectedWrites=$(if($ExpectedKind -ceq 'commit-reached'){1}else{0})
  if([FieldResolutionCanary]::SetValueCalls -ne $expectedWrites -or
      [FieldResolutionCanary]::ToggleCalls -ne 0 -or [FieldResolutionCanary]::InvokeCalls -ne 0){
    throw "$Name`: ambiguous/rejected resolution dispatched a mutation. SetValue=$([FieldResolutionCanary]::SetValueCalls), Toggle=$([FieldResolutionCanary]::ToggleCalls), Invoke=$([FieldResolutionCanary]::InvokeCalls)"
  }
  $observedRid=[FieldResolutionCanary]::LastRid
  if([string]$observedRid -cne [string]$ExpectedRid){throw "$Name`: caller resolved another target ('$observedRid' instead of '$ExpectedRid')."}
  $script:cases++
}

$script:cases=0
$duplicate=[SSEUiaNodeView[]]@(
  (New-FieldNode '42.7.4.101' 'Form.Amount' 'Amount'),
  (New-FieldNode '42.7.4.102' 'Form.Amount' 'Amount' 'Edit' 20)
)
Invoke-CallerCase 'duplicate exact AID' $duplicate ([pscustomobject]@{aid='Form.Amount'}) 'ambiguous'
Invoke-CallerCase 'duplicate name' $duplicate ([pscustomobject]@{name='Amount'}) 'ambiguous'
Invoke-CallerCase 'duplicate contains' $duplicate ([pscustomobject]@{name='mount';contains=$true}) 'ambiguous'
Invoke-CallerCase 'duplicate compound selectors' $duplicate ([pscustomobject]@{aid='.Amount';name='AMOUNT'}) 'ambiguous'
$suffix=[SSEUiaNodeView[]]@(
  (New-FieldNode '42.7.4.201' 'First.Amount' 'Amount'),
  (New-FieldNode '42.7.4.202' 'Second.Amount' 'Amount' 'DataItem' 20)
)
Invoke-CallerCase 'duplicate suffix and mixed editable roles' $suffix ([pscustomobject]@{aid='.Amount'}) 'ambiguous'
Invoke-CallerCase 'unique full AID' $suffix ([pscustomobject]@{aid='FIRST.AMOUNT'}) 'commit-reached' '42.7.4.201'
Invoke-CallerCase 'unique RID' $duplicate ([pscustomobject]@{rid='42.7.4.102'}) 'commit-reached' '42.7.4.102'
Invoke-CallerCase 'unique compound selector' $suffix ([pscustomobject]@{rid='42.7.4.202';aid='.Amount';name='AMOUNT';type='DataItem'}) 'commit-reached' '42.7.4.202'
Invoke-CallerCase 'inconsistent RID and AID' $suffix ([pscustomobject]@{rid='42.7.4.201';aid='Second.Amount'}) 'not-found'
Invoke-CallerCase 'stale RID' $suffix ([pscustomobject]@{rid='42.7.4.999'}) 'not-found'
$exactFirst=[SSEUiaNodeView[]]@(
  (New-FieldNode '42.7.4.301' 'Form.Amount' 'Amount'),
  (New-FieldNode '42.7.4.302' 'Other.Form.Amount' 'Amount' 'Edit' 20)
)
Invoke-CallerCase 'exact AID precedes suffix collision' $exactFirst ([pscustomobject]@{aid='Form.Amount'}) 'commit-reached' '42.7.4.301'
$oneSuffix=[SSEUiaNodeView[]]@(
  (New-FieldNode '42.7.4.401' 'Form.Amount' 'Amount'),
  (New-FieldNode '42.7.4.402' 'Form.Title' 'Title' 'Edit' 20)
)
Invoke-CallerCase 'unique suffix' $oneSuffix ([pscustomobject]@{aid='.Amount'}) 'commit-reached' '42.7.4.401'
$labelAndEdit=[SSEUiaNodeView[]]@(
  (New-FieldNode '42.7.4.501' 'Form.Caption' 'Amount' 'Text' 10 20),
  (New-FieldNode '42.7.4.502' 'Form.Amount' 'Amount' 'Edit' 10)
)
Invoke-CallerCase 'label plus its one matching edit is one business field' $labelAndEdit ([pscustomobject]@{name='Amount'}) 'commit-reached' '42.7.4.502'
$nested=[SSEUiaNodeView[]]@(
  (New-FieldNode '42.7.4.601' 'Form.Caption' 'Amount' 'Text' 10 20),
  (New-FieldNode '42.7.4.602' 'Form.Container.Amount' '' 'Edit' 20),
  (New-FieldNode '42.7.4.603' 'Form.Other' '' 'Edit' 30 200 100)
)
Invoke-CallerCase 'nested label keeps existing unique same-line mapping' $nested ([pscustomobject]@{name='Amount'}) 'commit-reached' '42.7.4.602'
$nonEditable=[SSEUiaNodeView[]]@(
  (New-FieldNode '42.7.4.701' 'Form.Target' 'Target' 'Button'),
  (New-FieldNode '42.7.4.702' 'Form.Target' 'Target' 'Edit' 20)
)
Invoke-CallerCase 'unsupported direct role is not silently upgraded to another target' $nonEditable ([pscustomobject]@{aid='Form.Target'}) 'bad-target'
Write-Output "Tracked field resolution: $script:cases actual caller cases; ambiguous selectors perform zero SetValue/Toggle/Invoke calls."
