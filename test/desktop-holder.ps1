<# Keeps one empty private desktop alive for worker-routing contracts. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[A-Za-z0-9_-]{1,64}$')]
  [string]$Name
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\powershell\load-native.ps1')
$null = Import-SSENativeInterop

$desktop = [DSK]::CreateDesktop(
  $Name,
  [IntPtr]::Zero,
  [IntPtr]::Zero,
  0,
  0x10000000,
  [IntPtr]::Zero
)
if ($desktop -eq [IntPtr]::Zero) {
  throw "Privater Testdesktop liess sich nicht anlegen (Fehler $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
}

try {
  [Console]::Out.WriteLine('{"ready":true}')
  [Console]::Out.Flush()
  # EOF beendet den Besitzer ebenfalls; ein abgebrochener Elternprozess laesst
  # damit weder Desktop-Handle noch dauerhaften Hilfsprozess zurueck.
  $null = [Console]::In.ReadLine()
} finally {
  [DSK]::CloseDesktop($desktop) | Out-Null
}
