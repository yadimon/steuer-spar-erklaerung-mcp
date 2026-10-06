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
foreach ($functionName in @('Resolve-SSEBuildIdentityForOperation', 'Assert-SSEVerifiedBuildForOperation')) {
  $functionAst = $workerAst.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  Assert-True ($null -ne $functionAst) "Worker-Build-Drift-Funktion '$functionName' fehlt."
  Invoke-Expression $functionAst.Extent.Text
}

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
  $script:LastIdentityPath = $Path
  $script:StubIdentity
}
function Get-SSEProcessIdentities { @($script:RunningIdentities) }
function Fail([string]$Message, [string]$Kind) { throw "$Kind|$Message" }
$script:RunningIdentities = @()

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

$script:StubIdentity = [pscustomobject]@{ exists = $true; supported = $true; fileVersion = '30, 0, 140, 0'; reason = 'drifted' }
$script:RunningIdentities = @([pscustomobject]@{ supported=$true; path='D:\portable\Steuerjahr 2024\SSE.exe' })
$runningDrift = $null
try { Assert-SSEVerifiedBuildForOperation 'tracked_set_value' }
catch { $runningDrift = $_.Exception.Message }
Assert-True ($runningDrift -like 'build-drift|*') 'Laufende abweichende Installation muss vor Mutation fail-closed stoppen.'
Assert-True ($script:LastIdentityPath -eq 'D:\portable\Steuerjahr 2024\SSE.exe') `
  'Build-Drift muss den Pfad der laufenden Instanz statt des konfigurierten Defaults pruefen.'

$script:RunningIdentities = @(
  [pscustomobject]@{ supported=$true; path='D:\one\SSE.exe' },
  [pscustomobject]@{ supported=$true; path='D:\two\SSE.exe' }
)
$ambiguous = $null
try { Assert-SSEVerifiedBuildForOperation 'tracked_set_value' }
catch { $ambiguous = $_.Exception.Message }
Assert-True ($ambiguous -like 'build-identity-unverified|*') 'Mehrere laufende SSE-Instanzen duerfen ohne Bindung nicht den Default-Build verwenden.'

Add-Type -TypeDefinition @'
public static class SW {
  public static uint GetWindowThreadProcessId(System.IntPtr window, ref int processId) {
    processId = window.ToInt64() == 4242 ? 9002 : 9003;
    return 1;
  }
}
'@
function Get-Process {
  param([int]$Id, [string]$ErrorAction)
  if ($Id -eq 9001) { return [pscustomobject]@{ ProcessName='SSE'; Path='D:\one\SSE.exe' } }
  if ($Id -eq 9002) { return [pscustomobject]@{ ProcessName='SSE'; Path='D:\two\SSE.exe' } }
  [pscustomobject]@{ ProcessName='Other'; Path='D:\other\app.exe' }
}
$script:StubIdentity.fileVersion = '30, 0, 127, 0'
Assert-SSEVerifiedBuildForOperation 'tracked_set_value' ([pscustomobject]@{pid=9001})
Assert-True ($script:LastIdentityPath -ceq 'D:\one\SSE.exe') 'Explizite PID ging beim Weiterreichen an die Build-Pruefung verloren.'
Assert-SSEVerifiedBuildForOperation 'tracked_set_value' ([pscustomobject]@{hwnd=4242})
Assert-True ($script:LastIdentityPath -ceq 'D:\two\SSE.exe') 'Explizites HWND ging beim Weiterreichen an die Build-Pruefung verloren.'
$script:StubIdentity.fileVersion = '30, 0, 140, 0'
$boundDrift = $null
try { Assert-SSEVerifiedBuildForOperation 'tracked_set_value' ([pscustomobject]@{hwnd=4242}) }
catch { $boundDrift = $_.Exception.Message }
Assert-True ($boundDrift -like 'build-drift|*') 'Explizite Fensterbindung darf die Build-Drift-Pruefung nicht umgehen.'
$foreignWindow = $null
try { Assert-SSEVerifiedBuildForOperation 'tracked_set_value' ([pscustomobject]@{hwnd=4243}) }
catch { $foreignWindow = $_.Exception.Message }
Assert-True ($foreignWindow -like 'build-identity-unverified|*') 'Fremdes HWND wurde von der Build-Pruefung akzeptiert.'

Write-Output 'Build-Drift: alle Vertraege bestanden'
