$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'powershell/sse-worker.ps1'), [ref]$null, [ref]$errors)
if ($errors.Count) { throw 'Actual worker does not parse.' }
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
foreach ($name in @('ConvertTo-SSEReceiptManagerVatRate','Get-SSEReceiptManagerFieldValue',
  'Test-SSEReceiptManagerFieldValue','Get-SSEReceiptManagerLiveEditableField','Get-SSEReceiptManagerBoundFieldObservation',
  'Set-SSEReceiptManagerVatRateSelection','Wait-SSEReceiptManagerLiveFieldValue','Emit')) {
  $definitions = @($ast.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }.GetNewClosure(), $true))
  Assert-True ($definitions.Count -eq 1) 'Actual receipt helper is ambiguous.'
  Invoke-Expression $definitions[0].Extent.Text
}
$binding = [pscustomobject]@{name='vatRate';policy=[pscustomobject]@{valueKind='vat-rate';controlType='Edit';automationIdSuffix='.vat.QLineEdit'};
  node=[pscustomobject]@{rid='42.7.1';aid='synthetic.vat.QLineEdit';type='Edit';val='19 %';name='Synthetic VAT label';on=$true;w=80;h=20;ro=$false}}
function Get-LiveElement($Window, $Rid, $Aid) {
  $script:liveReads++
  $script:liveBinding
}
function Convert-ExactElementToNode($Element) { $Element.node }
function Commit-TrackedValue($Window, $Node, $Value, $Expected) {
  $script:commits.Add([pscustomobject]@{value=$Value;expected=$Expected;rid=$Node.rid;readOnly=$Node.ro}) | Out-Null
  $script:liveBinding.node.val = $Value
  [pscustomobject]@{method='verified-keyboard-replace';details=[pscustomobject]@{mutationStarted=$true};interference=$false;inputInterference=$false}
}
function New-LiveBinding($Raw, [string]$Rid='42.7.1', [bool]$ReadOnly=$false) {
  [pscustomobject]@{name=$binding.name;policy=$binding.policy;node=[pscustomobject]@{rid=$Rid;aid=$binding.node.aid;type='Edit';val=$Raw;name='Synthetic VAT label';on=$true;w=80;h=20;ro=$ReadOnly}}
}
foreach ($case in @(
  @{raw='19 %';expected='0 %';wanted='0 %';rid='42.7.1'},
  @{raw=$null;expected='0 %';wanted='0 %';rid='42.7.1'},
  @{raw='Synthetic VAT label';expected='0 %';wanted='0 %';rid='42.7.1'},
  @{raw='19 %';expected='7 %';wanted='0 %';rid='42.7.1'},
  @{raw='7 %';expected='7 %';wanted='19 %';rid='42.7.2'}
)) {
  $script:liveReads=0; $script:commits=New-Object Collections.ArrayList
  $script:liveBinding=New-LiveBinding $case.raw $case.rid
  $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 ([pscustomobject]@{nodes=@()}) ([pscustomobject]@{}) $binding $case.expected $case.wanted 1
  Assert-True (-not $result.ok -and -not $result.mutationStarted -and $result.method -ceq 'epoch-value-changed' -and
    $result.interference -and -not $result.inputInterference) 'An unproven live value or replacement binding authorized a no-op/write.'
  Assert-True ($script:liveReads -eq 1 -and $script:commits.Count -eq 0) 'A refused precondition performed or repeated a mutation.'
}
foreach ($raw in @('', '0 %', '0,00 %')) {
  $script:liveReads=0; $script:commits=New-Object Collections.ArrayList; $script:liveBinding=New-LiveBinding $raw '42.7.1' $true
  $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 ([pscustomobject]@{nodes=@()}) ([pscustomobject]@{}) $binding '0 %' '0 %' 1
  Assert-True ($result.ok -and $result.method -ceq 'noop-already-target' -and $result.after -ceq '0' -and -not $result.mutationStarted) 'Readable zero stopped being a fresh verified no-op.'
  Assert-True ($script:liveReads -eq 1 -and $script:commits.Count -eq 0) 'A valid no-op dispatched an edit.'
}
foreach ($raw in @('7 %', '7,00 %')) {
  $script:liveReads=0; $script:commits=New-Object Collections.ArrayList; $script:liveBinding=New-LiveBinding $raw
  $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 ([pscustomobject]@{nodes=@()}) ([pscustomobject]@{}) $binding '7 %' '0 %' 1
  Assert-True ($result.ok -and $result.mutationStarted -and $result.after -ceq '0') 'Known formatted VAT could not be cleared through the actual helper.'
  Assert-True ($script:commits.Count -eq 1 -and $script:commits[0].expected -ceq $raw -and
    $script:commits[0].value -ceq '' -and $script:commits[0].readOnly -eq $false) 'Clear did not retain its verified raw precondition on the writable fixture.'
}
$script:liveReads=0; $script:commits=New-Object Collections.ArrayList; $script:liveBinding=$null
$result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 ([pscustomobject]@{nodes=@()}) ([pscustomobject]@{}) $binding '0 %' '0 %' 1
Assert-True (-not $result.ok -and -not $result.mutationStarted -and $result.method -ceq 'epoch-value-changed' -and
  $result.interference -and -not $result.inputInterference -and $script:liveReads -eq 1 -and
  $script:commits.Count -eq 0 -and $result.error -ceq 'Exakt gebundenes Belegfeld ist nicht mehr lesbar.') 'A missing bound field became a successful no-op or lost its guard result.'
foreach ($invalid in @('aid','type','on','w','h')) {
  $script:liveReads=0; $script:commits=New-Object Collections.ArrayList; $script:liveBinding=New-LiveBinding '0 %'
  $script:liveBinding.node.$invalid=@{aid='synthetic.foreign';type='Text';on=$false;w=0;h=0}[$invalid]
  $result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 ([pscustomobject]@{nodes=@()}) ([pscustomobject]@{}) $binding '0 %' '0 %' 1
  Assert-True (-not $result.ok -and $result.interference -and $result.method -ceq 'epoch-value-changed' -and
    -not $result.mutationStarted -and $script:liveReads -eq 1 -and $script:commits.Count -eq 0) 'The actual live getter accepted invalid native field evidence.'
}
# Even a readable empty replacement must not prove the original field's clear.
$script:liveBinding=New-LiveBinding '' '42.7.2'
$readback=Wait-SSEReceiptManagerLiveFieldValue ([IntPtr]7) $binding '' 'vat-rate' 1
Assert-True (-not $readback.ok -and $null -eq $readback.value -and $null -eq $readback.resolved) 'Replacement field falsely verified the original clear.'
$script:liveReads=0; $script:commits=New-Object Collections.ArrayList; $script:liveBinding=New-LiveBinding '7 %'
function Commit-TrackedValue($Window, $Node, $Value, $Expected) {
  $script:commits.Add([pscustomobject]@{value=$Value;expected=$Expected;rid=$Node.rid}) | Out-Null
  $script:liveBinding=New-LiveBinding '' '42.7.2'
  [pscustomobject]@{method='verified-keyboard-replace';details=[pscustomobject]@{mutationStarted=$true};interference=$false;inputInterference=$false}
}
$result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 ([pscustomobject]@{nodes=@()}) ([pscustomobject]@{}) $binding '7 %' '0 %' 1
Assert-True (-not $result.ok -and $result.mutationStarted -and $null -eq $result.after -and
  $script:commits.Count -eq 1 -and $script:liveReads -ge 2) 'A replaced post-clear field hid an uncertain mutation or authorized a repeated clear.'
$script:liveReads=0; $script:commits=New-Object Collections.ArrayList
function Get-LiveElement { $script:liveReads++; throw 'Synthetic bound read unavailable' }
$result=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 ([pscustomobject]@{nodes=@()}) ([pscustomobject]@{}) $binding '0 %' '0 %' 1
Assert-True (-not $result.ok -and -not $result.mutationStarted -and $result.error -ceq 'Synthetic bound read unavailable' -and
  $result.method -ceq 'epoch-value-changed' -and $result.interference -and -not $result.inputInterference -and
  $script:liveReads -eq 1 -and $script:commits.Count -eq 0) 'Native read failure was lost, became a no-op or lost its guard contract.'
$sentinel=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$script:SSE_CAPTURE_SENTINEL'
}, $true))
Assert-True ($sentinel.Count -eq 1) 'Actual capture sentinel assignment is ambiguous.'
Invoke-Expression $sentinel[0].Extent.Text
$script:T0=[Diagnostics.Stopwatch]::StartNew()
$script:SSE_CAPTURE_OPERATION_RESULT=$true
$script:SSE_CAPTURED_OPERATION_RESULT=$null
$script:capturedFixture=[pscustomobject]@{ok=$false;kind='synthetic-source-capture';error='Synthetic capture'}
function Get-LiveElement { Emit $script:capturedFixture }
$captureError=$null
try { $null=Set-SSEReceiptManagerVatRateSelection ([IntPtr]7) 100 ([pscustomobject]@{nodes=@()}) ([pscustomobject]@{}) $binding '0 %' '0 %' 1 }
catch { $captureError=$_.Exception.Message }
Assert-True ($captureError -ceq $script:SSE_CAPTURE_SENTINEL -and
  [object]::ReferenceEquals($script:SSE_CAPTURED_OPERATION_RESULT,$script:capturedFixture)) 'Actual Emit capture was swallowed or replaced by a refusal.'
$script:SSE_CAPTURED_OPERATION_RESULT=$null
$captureError=$null
try { $null=Wait-SSEReceiptManagerLiveFieldValue ([IntPtr]7) $binding '' 'vat-rate' 1 }
catch { $captureError=$_.Exception.Message }
Assert-True ($captureError -ceq $script:SSE_CAPTURE_SENTINEL -and
  [object]::ReferenceEquals($script:SSE_CAPTURED_OPERATION_RESULT,$script:capturedFixture)) 'Actual wait-loop Emit capture was swallowed or replaced by a timeout.'
$script:SSE_CAPTURE_OPERATION_RESULT=$false
$script:SSE_CAPTURED_OPERATION_RESULT=$null
$script:T0.Stop()
Write-Output 'VAT preconditions: actual bound reads, stale/unknown/replaced targets, readable zero and one exact raw clear passed.'
