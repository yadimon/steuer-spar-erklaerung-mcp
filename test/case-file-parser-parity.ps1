param([Parameter(Mandatory = $true)][string]$ArgsFile)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'powershell\akad-parser.ps1')

$request = Get-Content -LiteralPath $ArgsFile -Raw -Encoding UTF8 | ConvertFrom-Json
$keys = @('FileType','VJahr','Steuernummer','FileSavedBy','ElsterTransferTime','MitElsterVersendetText')
$results = foreach ($path in @($request.paths)) {
  $parsed = @(Invoke-AkadParser -Paths @([string]$path))[0]
  $header = [ordered]@{}
  foreach ($key in $keys) {
    $entry = $parsed.meta.$key
    $header[$key] = $(if ($entry) { $entry.value } else { $null })
  }
  $transmitted = $(
    if ($parsed.PSObject.Properties['error'] -and $parsed.error) { 'unknown' }
    elseif (-not $parsed.PSObject.Properties['transmitted']) { 'unknown' }
    elseif ($parsed.transmitted -is [bool]) { [bool]$parsed.transmitted }
    elseif ([string]$parsed.transmitted -eq 'unknown') { 'unknown' }
    else { 'unknown' }
  )
  [pscustomobject][ordered]@{
    header = [pscustomobject]$header
    transmitted = $transmitted
    transmittedReason = $(if ($parsed.transmittedReason) {
      $parsed.transmittedReason
    } else { 'Uebermittlungsstatus nicht sicher lesbar' })
  }
}

ConvertTo-Json -InputObject @($results) -Depth 8 -Compress
