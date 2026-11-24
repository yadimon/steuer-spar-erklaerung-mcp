# Arbeiter-Stellvertreter fuer test/worker-prewarm-placement-contract.ps1.
#
# Bittet den nativen Helfer dreimal, die Energiedrosselung eines Hostprozesses
# abzuwaehlen: fuer einen fremden lebenden Prozess, ohne gueltige Prozess-Id und
# fuer den tatsaechlichen Elternprozess. Nur die letzte Bitte darf gelingen; die
# Reihenfolge stellt sicher, dass eine faelschlich angenommene fruehere Bitte
# nicht vom Erfolg der letzten verdeckt wird.
param(
  [Parameter(Mandatory)][string]$Root,
  [Parameter(Mandatory)][int]$HostProcessId,
  [Parameter(Mandatory)][int]$ForeignProcessId
)
$ErrorActionPreference = 'Stop'

. (Join-Path $Root 'powershell\load-native.ps1')
$null = Import-SSENativeInterop
$foreign = [SW]::DisableHostPowerThrottling($ForeignProcessId)
$invalid = [SW]::DisableHostPowerThrottling(0)
$genuine = [SW]::DisableHostPowerThrottling($HostProcessId)
[Console]::Out.Write(([pscustomobject]@{ foreign = $foreign; invalid = $invalid; genuine = $genuine } | ConvertTo-Json -Compress))
