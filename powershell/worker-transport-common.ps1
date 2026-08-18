<# Shared, PowerShell-5.1-compatible boundary for internal worker temp files. #>

function Resolve-SSEWorkerArgsFile([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $parent = [IO.Path]::GetDirectoryName($fullPath).TrimEnd('\')
  $name = [IO.Path]::GetFileName($fullPath)
  $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction SilentlyContinue
  if (-not $parent.Equals($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      $name -notmatch '^sse-args-[0-9a-fA-F]{32}\.json$' -or -not $item -or
      $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      $item.Length -gt 8MB) {
    throw 'ArgsFile muss eine regulaere interne SSE-Tempdatei bis 8 MiB sein.'
  }
  $fullPath
}

function Resolve-SSEWorkerOutputFile([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $parent = [IO.Path]::GetDirectoryName($fullPath).TrimEnd('\')
  $name = [IO.Path]::GetFileName($fullPath)
  if (-not $parent.Equals($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      $name -notmatch '^sse-out-[0-9a-fA-F]{32}\.json$' -or
      (Test-Path -LiteralPath $fullPath)) {
    throw 'OutFile muss eine neue interne SSE-Tempdatei sein.'
  }
  $fullPath
}

function Read-SSEBoundedUtf8File([string]$Path, [long]$MaxBytes) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.PSIsContainer) { throw 'Dateipfad ist keine regulaere Datei.' }
  if ($item.Length -gt $MaxBytes) { throw "Datei ist groesser als $MaxBytes Bytes." }
  $stream = $null
  $memory = $null
  try {
    $stream = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($stream.Length -gt $MaxBytes) { throw "Datei ist groesser als $MaxBytes Bytes." }
    $memory = New-Object IO.MemoryStream
    $buffer = New-Object byte[] 65536
    $total = 0L
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $total += $read
      if ($total -gt $MaxBytes) { throw "Datei ist groesser als $MaxBytes Bytes." }
      $memory.Write($buffer, 0, $read)
    }
    $strictUtf8 = New-Object Text.UTF8Encoding($false, $true)
    $strictUtf8.GetString($memory.ToArray())
  } finally {
    if ($memory) { $memory.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}
