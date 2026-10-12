$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($worker, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Worker cannot be parsed for foreground reporting.' }
$emit = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Emit'
}, $true))
if ($emit.Count -ne 1) { throw 'Worker Emit function must be unique.' }
Invoke-Expression $emit[0].Extent.Text

# Capture the real result boundary before serialization/process exit. No UI,
# foreground window, or tax application is used by this contract test.
$script:SSE_CAPTURE_OPERATION_RESULT = $true
$script:SSE_CAPTURE_SENTINEL = 'foreground-reporting-capture'
$script:T0 = [Diagnostics.Stopwatch]::StartNew()
function Exit-SSEForegroundLease { param([switch]$Force, [string]$Reason) $script:releaseReason = $Reason }
function Get-SSEForegroundLeaseTelemetry { $script:telemetry }
function Capture-Result($result, [int]$Acquisitions) {
  $script:telemetry = [pscustomobject]@{ acquisitions=$Acquisitions; raises=$Acquisitions }
  $script:releaseReason = $null
  $script:SSE_CAPTURED_OPERATION_RESULT = $null
  try { Emit $result; throw 'Emit failed to stop at the capture boundary.' }
  catch { if ($_.Exception.Message -ne $script:SSE_CAPTURE_SENTINEL) { throw } }
  if ($script:releaseReason -ne 'emit') { throw 'Foreground cleanup did not run before reporting.' }
  $script:SSE_CAPTURED_OPERATION_RESULT
}

$physical = Capture-Result ([pscustomobject]@{ok=$true;fokusfrei=$true}) 2
if ($physical.fokusfrei -ne $false -or $physical.focusTelemetry.acquisitions -ne 2) {
  throw 'Physical navigation was falsely reported as focus-free.'
}
$passive = Capture-Result ([pscustomobject]@{ok=$true;fokusfrei=$true}) 0
if ($passive.fokusfrei -ne $true -or $passive.PSObject.Properties['focusTelemetry']) {
  throw 'Passive navigation was incorrectly reported as acquiring focus.'
}
$alreadyPhysical = Capture-Result ([pscustomobject]@{ok=$true;fokusfrei=$false}) 1
if ($alreadyPhysical.fokusfrei -ne $false) { throw 'Physical navigation lost its explicit status.' }
$unspecified = Capture-Result ([pscustomobject]@{ok=$true}) 1
if ($unspecified.PSObject.Properties['fokusfrei']) { throw 'An unrelated result acquired a new focus-free claim.' }

# Exercise the real pure evidence formatter and pre-delete epoch predicate with
# supplied ticks. This does not invoke the worker or any Windows input API.
$evidenceFunction = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-SSEInputEpochEvidence'
}, $true))
if ($evidenceFunction.Count -ne 1) { throw 'Input evidence formatter must be unique.' }
Invoke-Expression $evidenceFunction[0].Extent.Text
$sameEpoch = Get-SSEInputEpochEvidence 100 100 'table-delete-exclusive-selection-click'
if (-not $sameEpoch.unchanged -or $sameEpoch.changed -or $sameEpoch.attribution -ne 'undetermined') {
  throw 'Unchanged input epoch was not reported without attribution.'
}
$changedEpoch = Get-SSEInputEpochEvidence 100 99 'table-delete-exclusive-selection-click'
if (-not $changedEpoch.changed -or $changedEpoch.unchanged -or $changedEpoch.baseline -ne 100 -or $changedEpoch.observed -ne 99) {
  throw 'A non-monotonic changed input tick lost its exact evidence.'
}
if ($changedEpoch.lastOwnAction -ne 'table-delete-exclusive-selection-click') { throw 'Own input context was lost.' }
$unknownEpoch = Get-SSEInputEpochEvidence $null 101 'foreground-lease-acquire'
if ($unknownEpoch.readable -or $unknownEpoch.unchanged -or $unknownEpoch.changed) {
  throw 'An unreadable input epoch was falsely classified as stable or changed.'
}
$epochPredicate = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -ceq '$preDeleteInputUnchanged'
}, $true))
if ($epochPredicate.Count -ne 1) { throw 'Pre-delete epoch predicate must be unique.' }
foreach ($scenario in @(
  [pscustomobject]@{ selected=100; before=100; after=100; allow=$true },
  [pscustomobject]@{ selected=100; before=101; after=101; allow=$false },
  [pscustomobject]@{ selected=100; before=100; after=101; allow=$false }
)) {
  $inputBaseline=$scenario.selected; $preDeleteInput=$scenario.before; $preDeleteInputAfter=$scenario.after
  Invoke-Expression $epochPredicate[0].Extent.Text
  if ($preDeleteInputUnchanged -ne $scenario.allow) { throw 'Input changed after selection or during read escaped the delete guard.' }
}
Write-Output 'OK: Focus reporting follows observed acquisition and preserves unspecified results.'
