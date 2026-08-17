$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\profile-verification.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$gleich = Get-SSEBuildDrift '30.0.127.0' '30, 0, 127, 0'
Assert-True (-not $gleich.drifted) 'Gleicher Build wurde als Drift gemeldet.'

$drift = Get-SSEBuildDrift '30.0.127.0' '30, 0, 140, 0'
Assert-True ($drift.drifted) 'Ein neuerer Build wurde nicht als Drift gemeldet.'
Assert-True ($drift.verified -eq '30.0.127.0') 'Verifizierter Build fehlt in der Meldung.'
Assert-True ($drift.current -eq '30.0.140.0') 'Aktueller Build wurde nicht normalisiert.'

$unbekannt = Get-SSEBuildDrift '' '30, 0, 127, 0'
Assert-True ($unbekannt.drifted) 'Ohne verifizierten Build muss Drift wahr sein.'

$workerPath = Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$tokens = $null
$parseErrors = $null
$workerAst = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) 'Worker muss fuer den Build-Drift-Vertrag syntaktisch gueltig sein.'
$guardAst = $workerAst.Find({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Assert-SSEVerifiedBuildForOperation'
}, $true)
Assert-True ($null -ne $guardAst) 'Worker-Build-Drift-Gate fehlt.'
Invoke-Expression $guardAst.Extent.Text

$buildDriftBlockedOps = @('tracked_set_value')
$script:SSE_DEFAULT_EXE = 'X:\synthetic\SSE.exe'
$script:SSE_PROFILE = [pscustomobject]@{ verifiedBuild = '30.0.127.0' }
$script:StubIdentity = [pscustomobject]@{
  exists = $true
  supported = $true
  fileVersion = '30, 0, 127, 0'
}
$script:IdentityProbeCount = 0
function Get-SSEExecutableIdentity([string]$Path) {
  $script:IdentityProbeCount++
  $script:StubIdentity
}
function Fail([string]$Message, [string]$Kind) { throw "$Kind|$Message" }

Assert-SSEVerifiedBuildForOperation 'health'
Assert-True ($script:IdentityProbeCount -eq 0) 'Read-only-Operation darf die Build-Drift-Gate nicht ausloesen.'
Assert-SSEVerifiedBuildForOperation 'tracked_set_value'
Assert-True ($script:IdentityProbeCount -eq 1) 'Mutationsoperation muss die installierte Identitaet pruefen.'

$script:StubIdentity.fileVersion = '30, 0, 140, 0'
$blocked = $null
try { Assert-SSEVerifiedBuildForOperation 'tracked_set_value' }
catch { $blocked = $_.Exception.Message }
Assert-True ($blocked -like 'build-drift|*') 'Abweichender Build muss als build-drift fail-closed stoppen.'
Assert-True ($blocked -match '30\.0\.127\.0' -and $blocked -match '30\.0\.140\.0') 'Driftfehler muss Soll- und Ist-Build nennen.'

$script:StubIdentity = [pscustomobject]@{ exists = $false; supported = $false; fileVersion = '' }
Assert-SSEVerifiedBuildForOperation 'tracked_set_value'

Write-Output 'Build-Drift: alle Vertraege bestanden'
