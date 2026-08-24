param(
  [Parameter(Mandatory = $true)][string]$FixturePath,
  [Parameter(Mandatory = $true)][string]$MarkerPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\powershell\desktop-marker.ps1')

$strictUtf8 = New-Object Text.UTF8Encoding($false, $true)
$fixtures = [IO.File]::ReadAllText($FixturePath, $strictUtf8) | ConvertFrom-Json -ErrorAction Stop
$results = foreach ($fixture in @($fixtures)) {
  [IO.File]::WriteAllText($MarkerPath, [string]$fixture.text, $strictUtf8)
  try {
    Read-SSEDesktopMarker $MarkerPath | Out-Null
    [bool]$true
  } catch {
    [bool]$false
  }
}

[Console]::OutputEncoding = $strictUtf8
[Console]::Out.Write((ConvertTo-Json -InputObject @($results) -Compress))
