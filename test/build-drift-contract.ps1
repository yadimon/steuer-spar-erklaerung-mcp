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

Write-Output 'Build-Drift: alle Vertraege bestanden'
