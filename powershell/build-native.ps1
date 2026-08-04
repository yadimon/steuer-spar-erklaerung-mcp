<#
  Builds the public Win32/MSAA interop helper once for fast worker startup.
  The generated DLL contains no case data, paths, or machine-specific values.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'sse-native.cs'
$target = Join-Path $PSScriptRoot 'sse-native.dll'
$hashTarget = Join-Path $PSScriptRoot 'sse-native.sha256'
$temporary = Join-Path $PSScriptRoot ('.sse-native-' + [guid]::NewGuid().ToString('N') + '.dll')
$hashTemporary = Join-Path $PSScriptRoot ('.sse-native-' + [guid]::NewGuid().ToString('N') + '.sha256')
$replaceBackup = Join-Path $PSScriptRoot ('.sse-native-' + [guid]::NewGuid().ToString('N') + '.replace.dll')
$hashReplaceBackup = Join-Path $PSScriptRoot ('.sse-native-' + [guid]::NewGuid().ToString('N') + '.replace.sha256')

function Get-SSEFileSha256([string]$Path, [long]$MaxBytes) {
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($Path)
    try {
      if ($stream.Length -gt $MaxBytes) {
        throw "File is larger than $MaxBytes bytes: $($stream.Length)"
      }
      ([BitConverter]::ToString($hashAlgorithm.ComputeHash($stream)) -replace '-', '').ToUpperInvariant()
    }
    finally { $stream.Dispose() }
  } finally {
    $hashAlgorithm.Dispose()
  }
}

function Read-SSEBoundedFileBytes([string]$Path, [long]$MaxBytes) {
  $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($file.PSIsContainer -or $file.Length -gt $MaxBytes) {
    throw "File is larger than $MaxBytes bytes: $($file.Length)"
  }
  $stream = $null
  try {
    $stream = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($stream.Length -gt $MaxBytes) {
      throw "File is larger than $MaxBytes bytes: $($stream.Length)"
    }
    $bytes = New-Object byte[] ([int]$stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($read -eq 0) { throw 'File was truncated while being read.' }
      $offset += $read
    }
    ,$bytes
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Native source file is missing: $source"
}

try {
  $sourceBytes = Read-SSEBoundedFileBytes $source (1MB)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $sourceHash = ([BitConverter]::ToString($algorithm.ComputeHash($sourceBytes)) -replace '-', '').ToUpperInvariant() }
  finally { $algorithm.Dispose() }
  $sourceText = [Text.UTF8Encoding]::new($false, $true).GetString($sourceBytes)
  $compile = @{
    TypeDefinition = $sourceText
    OutputAssembly = $temporary
    OutputType = 'Library'
    ErrorAction = 'Stop'
  }
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    # Windows PowerShell 5.1 nutzt den .NET-Framework-Compiler. Der native
    # Helfer verwendet `dynamic` fuer MSAA/COM und braucht dessen Binder dort
    # explizit. Dieselbe so erzeugte DLL kann auch unter PowerShell 7 laden.
    $compile.ReferencedAssemblies = @('Microsoft.CSharp.dll')
  }
  Add-Type @compile
  if (-not (Test-Path -LiteralPath $temporary -PathType Leaf)) {
    throw 'Add-Type did not create the native helper assembly.'
  }
  $temporaryFile = Get-Item -LiteralPath $temporary -Force -ErrorAction Stop
  if ($temporaryFile.Length -gt 4MB) {
    throw "Native helper assembly is larger than 4194304 bytes: $($temporaryFile.Length)"
  }
  $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($temporary))
  $requiredTypes = @('DSK','SW','SSEAccNode','SSEAccessible')
  $actualTypes = @($assembly.GetTypes() | ForEach-Object { $_.FullName })
  $missingTypes = @($requiredTypes | Where-Object { $_ -notin $actualTypes })
  $requiredDskMethods = @('CreateDesktop','CreateProcess','GetExitCodeProcess','CreateJobObject',
    'SetInformationJobObject','AssignProcessToJobObject','ResumeThread')
  $dskType = $assembly.GetType('DSK', $false)
  $missingMethods = @($requiredDskMethods | Where-Object { -not $dskType -or -not $dskType.GetMethod($_) })
  $requiredSwMethods = @('GetLastInputInfo')
  $swType = $assembly.GetType('SW', $false)
  $missingSwMethods = @($requiredSwMethods | Where-Object { -not $swType -or -not $swType.GetMethod($_) })
  if ($missingTypes.Count -or $missingMethods.Count -or $missingSwMethods.Count) {
    throw "Native helper surface is incomplete. Types: $($missingTypes -join ', '); DSK methods: $($missingMethods -join ', '); SW methods: $($missingSwMethods -join ', ')"
  }

  $dllHash = Get-SSEFileSha256 $temporary (4MB)
  $integrityManifest = [ordered]@{
    schemaVersion = 1
    sourceSha256 = $sourceHash
    dllSha256 = $dllHash
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($hashTemporary, $integrityManifest + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    [IO.File]::Replace($temporary, $target, $replaceBackup)
  } else {
    [IO.File]::Move($temporary, $target)
  }
  # DLL und Sidecar koennen nicht als Paar atomar ersetzt werden. DLL zuerst:
  # im kurzen Zwischenzustand passt der alte Hash nicht und Worker fallen
  # sicher auf den Quelltext zurueck.
  if (Test-Path -LiteralPath $hashTarget -PathType Leaf) {
    [IO.File]::Replace($hashTemporary, $hashTarget, $hashReplaceBackup)
  } else {
    [IO.File]::Move($hashTemporary, $hashTarget)
  }
  $installedDllHash = Get-SSEFileSha256 $target (4MB)
  if ($installedDllHash -ne $dllHash) {
    throw "Installed native helper hash changed during replacement: expected $dllHash, received $installedDllHash"
  }
  Write-Output "Built powershell/sse-native.dll (dll=$dllHash source=$sourceHash)"
} finally {
  if (Test-Path -LiteralPath $temporary) {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $hashTemporary) {
    Remove-Item -LiteralPath $hashTemporary -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $replaceBackup) {
    Remove-Item -LiteralPath $replaceBackup -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $hashReplaceBackup) {
    Remove-Item -LiteralPath $hashReplaceBackup -Force -ErrorAction SilentlyContinue
  }
}
