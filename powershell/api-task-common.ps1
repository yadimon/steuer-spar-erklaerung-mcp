function New-SseApiVbsContent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodePath,
    [Parameter(Mandatory = $true)]
    [string]$ApiMainPath,
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
  )

  $nodeCommand = '"' + $NodePath + '" "' + $ApiMainPath + '" --config "' + $ConfigPath + '"'
  $vbsCommand = $nodeCommand.Replace('"', '""')
  return 'CreateObject("WScript.Shell").Run "' + $vbsCommand + '", 0, True' + [Environment]::NewLine
}

function Write-SseApiVbsLauncher {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodePath,
    [Parameter(Mandatory = $true)]
    [string]$ApiMainPath,
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
  )

  $config = [IO.Path]::GetFullPath($ConfigPath)
  $parent = [IO.Path]::GetDirectoryName($config)
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "Launcher-Zielordner fehlt: $parent"
  }
  $encoding = New-Object Text.UTF8Encoding($false)
  $content = New-SseApiVbsContent -NodePath $NodePath -ApiMainPath $ApiMainPath -ConfigPath $config
  $bytes = $encoding.GetBytes($content)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $contentHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
  } finally {
    $sha.Dispose()
  }
  $path = Join-Path $parent "start-sse-api.$contentHash.hidden.vbs"
  $stream = $null
  $created = $false
  try {
    try {
      $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $created = $true
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush($true)
    } catch [IO.IOException] {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw }
      $existing = [IO.File]::ReadAllBytes($path)
      if ($existing.Length -ne $bytes.Length) {
        throw "Inhaltsadressierter Launcher ist nicht bytegleich: $path"
      }
      for ($index = 0; $index -lt $bytes.Length; $index++) {
        if ($existing[$index] -ne $bytes[$index]) {
          throw "Inhaltsadressierter Launcher ist nicht bytegleich: $path"
        }
      }
    }
  } catch {
    if ($created -and (Test-Path -LiteralPath $path -PathType Leaf)) {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
    throw
  } finally {
    if ($stream) { $stream.Dispose() }
  }
  return $path
}

function Resolve-SseNodePath {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $portable = Join-Path ([IO.Path]::GetFullPath($RepoRoot)) 'runtime\node.exe'
  if (Test-Path -LiteralPath $portable -PathType Leaf) { return $portable }
  $development = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($development -and $development.Source) { return $development.Source }
  throw 'Node-Laufzeit fehlt. In einem Release muss runtime\node.exe enthalten sein; node.exe im PATH ist nur fuer Entwickler erlaubt.'
}
