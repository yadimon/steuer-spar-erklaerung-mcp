function Test-SSEDesktopMarkerName([string]$Name) {
  [bool]($Name -and $Name -cmatch '\A[A-Za-z0-9_-]{1,64}\z')
}

function Test-SSEDesktopMarkerExactProperties($Value, [string[]]$Expected) {
  if ($null -eq $Value -or $Value -isnot [pscustomobject]) { return $false }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  [bool]($actual.Count -eq $wanted.Count -and (Compare-Object $actual $wanted -CaseSensitive).Count -eq 0)
}

function Test-SSEDesktopPid($Value) {
  if ($Value -isnot [byte] -and $Value -isnot [uint16] -and $Value -isnot [uint32] -and
      $Value -isnot [uint64] -and $Value -isnot [sbyte] -and $Value -isnot [int16] -and
      $Value -isnot [int32] -and $Value -isnot [int64] -and $Value -isnot [single] -and
      $Value -isnot [double] -and $Value -isnot [decimal]) { return $false }
  try {
    $decimalValue = [decimal]$Value
    $pidValue = [uint64]$Value
    [bool]($decimalValue -eq [decimal]$pidValue -and $pidValue -ge 1 -and $pidValue -le [uint32]::MaxValue)
  } catch { $false }
}

function Read-SSEDesktopMarker([string]$Path) {
  $markerFile = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($markerFile.PSIsContainer -or $markerFile.Length -gt 4KB) {
    throw 'Desktop-Marker ist keine begrenzte regulaere Datei.'
  }
  $strictUtf8 = New-Object Text.UTF8Encoding($false, $true)
  $raw = ([IO.File]::ReadAllText($markerFile.FullName, $strictUtf8)).Trim()
  if (-not $raw) { throw 'Desktop-Marker ist leer.' }

  if (-not $raw.StartsWith('{')) {
    if (-not (Test-SSEDesktopMarkerName $raw)) { throw 'Desktop-Marker enthaelt keinen gueltigen Desktopnamen.' }
    return [pscustomobject]@{ schemaVersion=0; owner='sse'; name=$raw; pid=0 }
  }

  try { $marker = $raw | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'Desktop-Marker enthaelt kein gueltiges JSON.' }
  if ($null -eq $marker -or $marker -isnot [pscustomobject]) { throw 'Desktop-Marker ist kein Objekt.' }

  if (Test-SSEDesktopMarkerExactProperties $marker @('name','pid')) {
    if (-not (Test-SSEDesktopMarkerName ([string]$marker.name)) -or -not (Test-SSEDesktopPid $marker.pid)) {
      throw 'Desktop-Marker enthaelt ungueltige SSE-Eigentumsdaten.'
    }
    return [pscustomobject]@{ schemaVersion=0; owner='sse'; name=[string]$marker.name; pid=[uint32]$marker.pid }
  }

  if (-not (Test-SSEDesktopMarkerExactProperties $marker @('schemaVersion','owner','name','pid')) -or
      $marker.schemaVersion -isnot [int] -or [int]$marker.schemaVersion -ne 1 -or
      [string]$marker.owner -cnotin @('sse','center-test') -or
      -not (Test-SSEDesktopMarkerName ([string]$marker.name)) -or -not (Test-SSEDesktopPid $marker.pid)) {
    throw 'Desktop-Marker enthaelt keinen unterstuetzten exakten Vertrag.'
  }
  [pscustomobject]@{
    schemaVersion=1; owner=[string]$marker.owner; name=[string]$marker.name; pid=[uint32]$marker.pid
  }
}

function New-SSEDesktopMarkerJson([string]$Owner, [string]$Name, $ProcessId) {
  if ($Owner -cnotin @('sse','center-test') -or -not (Test-SSEDesktopMarkerName $Name) -or
      -not (Test-SSEDesktopPid $ProcessId)) {
    throw 'Desktop-Marker kann nicht aus ungueltigen Eigentumsdaten erzeugt werden.'
  }
  [ordered]@{
    schemaVersion=1; owner=$Owner; name=$Name; pid=[uint32]$ProcessId
  } | ConvertTo-Json -Compress
}

function Write-SSEDesktopMarkerExclusive([string]$Path, [string]$Owner, [string]$Name, $ProcessId) {
  $json = New-SSEDesktopMarkerJson $Owner $Name $ProcessId
  $utf8 = New-Object Text.UTF8Encoding($false, $true)
  $bytes = $utf8.GetBytes($json)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  Read-SSEDesktopMarker $Path
}

function Remove-SSEDesktopMarkerIfOwned(
  [string]$Path,
  [string]$ExpectedOwner,
  [string]$ExpectedName,
  $ExpectedProcessId
) {
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  try { $current = Read-SSEDesktopMarker $Path }
  catch { return $false }
  if ($current.owner -cne $ExpectedOwner -or $current.name -cne $ExpectedName -or
      [uint64]$current.pid -ne [uint64]$ExpectedProcessId) { return $false }
  try { Remove-Item -LiteralPath $Path -Force -ErrorAction Stop }
  catch { return $false }
  -not (Test-Path -LiteralPath $Path)
}
