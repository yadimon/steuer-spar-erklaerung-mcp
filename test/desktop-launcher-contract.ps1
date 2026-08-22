$ErrorActionPreference = 'Stop'

# Der Desktop-Launcher baut aus seinen Parametern eine PowerShell-Kommandozeile
# fuer einen Prozess auf einem anderen Desktop. Jeder Parameter, der ungeprueft
# dort hineinliefe, waere eine Befehlsinjektion. Diese Pruefungen sind deshalb
# kein Formalismus, sondern die Grenze selbst.
$desktopLauncher = Join-Path $PSScriptRoot '..\powershell\run-on-desktop.ps1'
$fremdeDatei = Join-Path $PSScriptRoot '..\powershell\worker-transport-common.ps1'

function Assert-BadArgs {
  param(
    [Parameter(Mandatory = $true)][string]$Beschreibung,
    [Parameter(Mandatory = $true)][hashtable]$Argumente
  )
  $ausgabe = & $desktopLauncher @Argumente 2>$null
  if ($LASTEXITCODE -ne 1) { throw "Desktop-Launcher hat $Beschreibung nicht abgewiesen." }
  if (($ausgabe | ConvertFrom-Json).kind -ne 'bad-args') {
    throw "Desktop-Launcher meldet fuer $Beschreibung nicht bad-args."
  }
}

Assert-BadArgs -Beschreibung 'einen injizierbaren Operationsnamen' `
  -Argumente @{ Op = 'health" -Command "Get-Process'; Desktop = 'SSEAuto' }
Assert-BadArgs -Beschreibung 'einen fremden/verschachtelten Desktopnamen' `
  -Argumente @{ Op = 'health'; Desktop = 'WinSta0\Default' }
Assert-BadArgs -Beschreibung 'ein injizierbares Base64-Argument' `
  -Argumente @{ Op = 'health'; B64 = 'e30=" -Command'; Desktop = 'SSEAuto' }
Assert-BadArgs -Beschreibung 'eine Argumentdatei ausserhalb des Temp-Roots' `
  -Argumente @{ Op = 'health'; ArgsFile = $fremdeDatei; Desktop = 'SSEAuto' }
Assert-BadArgs -Beschreibung 'B64 und ArgsFile gemeinsam' `
  -Argumente @{ Op = 'health'; B64 = 'e30='; ArgsFile = $fremdeDatei; Desktop = 'SSEAuto' }

$quelle = [IO.File]::ReadAllText([IO.Path]::GetFullPath($desktopLauncher), [Text.Encoding]::UTF8)
if (-not $quelle.Contains("`$cmd.Append(' -ArgsFile")) {
  throw 'Desktop-Launcher reicht die interne Argumentdatei nicht an den Worker weiter.'
}

Write-Output 'OK: Desktop-Launcher weist injizierbare Operation, Desktop, Base64 und fremde Argumentdateien ab.'
