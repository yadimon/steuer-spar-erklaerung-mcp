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

function Get-SSEFileSha256([string]$Path) {
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($Path)
    try { ([BitConverter]::ToString($hashAlgorithm.ComputeHash($stream)) -replace '-', '').ToUpperInvariant() }
    finally { $stream.Dispose() }
  } finally {
    $hashAlgorithm.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Native source file is missing: $source"
}

try {
  $sourceBytes = [IO.File]::ReadAllBytes($source)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $sourceHash = ([BitConverter]::ToString($algorithm.ComputeHash($sourceBytes)) -replace '-', '').ToUpperInvariant() }
  finally { $algorithm.Dispose() }
  $sourceText = [Text.Encoding]::UTF8.GetString($sourceBytes)
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

  [IO.File]::WriteAllText($hashTemporary, $sourceHash + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
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
  $dllHash = Get-SSEFileSha256 $target
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
