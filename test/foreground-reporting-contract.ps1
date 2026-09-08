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
Write-Output 'OK: Focus reporting follows observed acquisition and preserves unspecified results.'
