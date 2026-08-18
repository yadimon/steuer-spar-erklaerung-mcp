param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($Source)
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
  throw "Portable-Quellordner fehlt: $sourcePath"
}
if (Test-Path -LiteralPath $destinationPath) {
  throw "Portable-Ziel existiert bereits: $destinationPath"
}
Compress-Archive -LiteralPath $sourcePath -DestinationPath $destinationPath -CompressionLevel Optimal
