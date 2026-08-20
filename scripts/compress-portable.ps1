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

# Compress-Archive aus Windows PowerShell 5.1 (Microsoft.PowerShell.Archive 1.0.1.0)
# schreibt Eintragsnamen abhaengig vom Windows-Build mit '\' statt '/'. Das
# verletzt die ZIP-Spezifikation und wird von verify-portable-archive.ps1 zu
# Recht abgelehnt. Die Eintragsnamen werden deshalb selbst erzeugt; das Ergebnis
# ist auf jedem unterstuetzten Windows byteweise gleich aufgebaut.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$backslash = [char]92
$forwardSlash = [char]47
$root = $sourcePath.TrimEnd($backslash, $forwardSlash)
$rootName = [IO.Path]::GetFileName($root)
if ([string]::IsNullOrWhiteSpace($rootName)) {
  throw "Portable-Quellordner hat keinen verwendbaren Namen: $sourcePath"
}

$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force | Sort-Object -Property FullName)
if ($files.Count -lt 1) {
  throw "Portable-Quellordner enthaelt keine Dateien: $root"
}

try {
  $archive = [IO.Compression.ZipFile]::Open($destinationPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($root.Length).TrimStart($backslash, $forwardSlash)
      if ([string]::IsNullOrWhiteSpace($relative)) {
        throw "Portable-Datei liegt ausserhalb des Quellordners: $($file.FullName)"
      }
      $entryName = $rootName + $forwardSlash + $relative.Replace($backslash, $forwardSlash)
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $file.FullName,
        $entryName,
        [IO.Compression.CompressionLevel]::Optimal)
    }
  }
  finally {
    $archive.Dispose()
  }
}
catch {
  # Kein halbfertiges Release-Artefakt zuruecklassen; sonst blockiert die
  # Ziel-existiert-Pruefung jeden erneuten Versuch.
  if (Test-Path -LiteralPath $destinationPath) {
    Remove-Item -LiteralPath $destinationPath -Force -ErrorAction SilentlyContinue
  }
  throw
}
