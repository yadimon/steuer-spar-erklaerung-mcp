$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'))
$operation = $source.IndexOf("  'table_delete' {")
$start = $source.IndexOf('    $targetElement = Get-LiveElement $hwnd $zelle.rid', $operation)
$end = $source.IndexOf('    $cellRect = ', $start)
if ($operation -lt 0 -or $start -lt $operation -or $end -le $start) {
  throw 'Live-Namenspruefung des Loeschvertrags nicht gefunden.'
}
$guard = [scriptblock]::Create($source.Substring($start, $end - $start))
Add-Type 'public static class SW { public static bool SetWindowPos(int h, object a, int x, int y, int w, int z, object flags) { return true; } }'
function Get-LiveElement { $script:element }
function Fail { param($message, $kind) throw "$kind`: $message" }
$hwnd = 1
$zelle = @{ rid = 'synthetic-row' }
$text = 'Invoice example'
foreach ($name in @('Invoice example', "Invoice example`n", "`tInvoice example`r`n", "Invoice`texample")) {
  $script:element = [pscustomobject]@{ Current = [pscustomobject]@{ Name = $name } }
  & $guard
}
foreach ($name in @('Different invoice', 'Invoice example extra', 'Invoice  example', '')) {
  $script:element = [pscustomobject]@{ Current = [pscustomobject]@{ Name = $name } }
  $blocked = $false
  try { & $guard } catch {
    if ($_.Exception.Message -notlike 'stale:*') { throw }
    $blocked = $true
  }
  if (-not $blocked) { throw "Falscher Live-Name wurde akzeptiert: '$name'" }
}
$script:element = $null
$blocked = $false
try { & $guard } catch {
  if ($_.Exception.Message -notlike 'stale:*') { throw }
  $blocked = $true
}
if (-not $blocked) { throw 'Fehlendes Live-Element wurde akzeptiert.' }
Write-Output 'Tabellen-Loeschvertrag: Qt-Leerraum normalisiert, andere und fehlende Ziele blockiert.'
