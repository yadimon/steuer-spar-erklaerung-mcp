# Kleiner Treiber, um sse-worker.ps1 von Hand aufzurufen
# Beispiel:  .\run.ps1 health
#            .\run.ps1 click @{name='Weiter'}
param(
  [Parameter(Mandatory)][string]$Op,
  [hashtable]$Args = @{},
  [switch]$Raw
)
$worker = Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$b64 = ''
if ($Args.Count) {
  $json = $Args | ConvertTo-Json -Depth 8 -Compress
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
}
$sw = [Diagnostics.Stopwatch]::StartNew()
$systemRoot = $(if ($env:SystemRoot) { $env:SystemRoot } else { $env:WINDIR })
$powerShell = Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$out = & $powerShell -NoLogo -NoProfile -File $worker -Op $Op -B64 $b64
$ms = $sw.ElapsedMilliseconds
if ($Raw) { $out; return }
try {
  $o = $out | ConvertFrom-Json
  "--- $Op  (Gesamtlaufzeit $ms ms, davon Arbeiter $($o.ms) ms) ---"
  $o | ConvertTo-Json -Depth 8
} catch {
  "ROHAUSGABE (kein JSON):"
  $out
}
