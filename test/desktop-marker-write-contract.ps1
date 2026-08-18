$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\powershell\desktop-marker.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$directory = Join-Path ([IO.Path]::GetTempPath()) ('sse-desktop-marker-write-' + [Guid]::NewGuid().ToString('N'))
$path = Join-Path $directory 'sse-mcp-desktop.txt'
$workerPath = Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
[IO.Directory]::CreateDirectory($directory) | Out-Null
try {
  Write-SSEDesktopMarkerExclusive $path 'sse' 'SSEAuto' 1234 | Out-Null
  $marker = Read-SSEDesktopMarker $path
  Assert-True ($marker.schemaVersion -eq 1 -and $marker.owner -eq 'sse' -and
    $marker.name -eq 'SSEAuto' -and $marker.pid -eq 1234) 'Versionierter Marker wurde nicht identisch gelesen.'

  $secondWriteFailed = $false
  try { Write-SSEDesktopMarkerExclusive $path 'sse' 'OtherDesktop' 5678 | Out-Null }
  catch { $secondWriteFailed = $true }
  Assert-True $secondWriteFailed 'Exklusives Schreiben hat einen vorhandenen Marker ueberschrieben.'
  Assert-True (-not (Remove-SSEDesktopMarkerIfOwned $path 'sse' 'OtherDesktop' 5678)) 'Fremder Marker wurde entfernt.'
  Assert-True (Test-Path -LiteralPath $path -PathType Leaf) 'Fremder Marker fehlt nach verweigertem Cleanup.'
  Assert-True (Remove-SSEDesktopMarkerIfOwned $path 'sse' 'SSEAuto' 1234) 'Eigener Marker wurde nicht entfernt.'
  Assert-True (-not (Test-Path -LiteralPath $path)) 'Eigener Marker blieb nach Cleanup bestehen.'

  [IO.File]::WriteAllText($path, '{broken', (New-Object Text.UTF8Encoding($false, $true)))
  Assert-True (-not (Remove-SSEDesktopMarkerIfOwned $path 'sse' 'SSEAuto' 1234)) 'Defekter Marker wurde entfernt.'
  Assert-True (Test-Path -LiteralPath $path -PathType Leaf) 'Defekter Marker muss zur manuellen Pruefung erhalten bleiben.'
} finally {
  if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
}

$workerSource = [IO.File]::ReadAllText($workerPath)
$powershellSources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\powershell') -Filter '*.ps1' -File |
  ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
$markerMutation = '(?is)(?:Set-Content|Out-File|New-Item|Move-Item|Remove-Item|WriteAllText|WriteAllBytes).{0,200}DESKTOP_MARKE|DESKTOP_MARKE.{0,200}(?:Set-Content|Out-File|New-Item|Move-Item|Remove-Item|WriteAllText|WriteAllBytes)'
Assert-True ($powershellSources -notmatch $markerMutation) 'Ein PowerShell-Pfad umgeht die eigentumsgebundenen Marker-Helfer.'
Assert-True (([regex]::Matches($workerSource, 'Write-SSEDesktopMarkerExclusive')).Count -ge 2) 'Start und Recovery schreiben nicht beide exklusiv.'
Assert-True (([regex]::Matches($workerSource, 'Remove-SSEDesktopMarkerIfOwned')).Count -ge 3) 'Stale-, Fehler- und Stop-Cleanup sind nicht alle eigentumsgebunden.'

[Console]::Out.WriteLine('Desktop-Marker-Schreibvertrag: CreateNew und eigentumsgebundener Cleanup bestanden')
