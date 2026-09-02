<#
  Builds the public Win32/MSAA interop helper once for fast worker startup.
  The generated DLL contains no case data, paths, or machine-specific values.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Das veroeffentlichte Runtime-Ziel ist Windows PowerShell 5.1/.NET Framework.
# PowerShell Core kompiliert gegen eine andere .NET-Laufzeit; eine dort erzeugte
# DLL kann im Produkt-Worker nicht geladen werden. Der npm-Einstieg verwendet
# deshalb bewusst powershell.exe, und direkte Aufrufe muessen dasselbe tun.
if ($PSVersionTable.PSEdition -ne 'Desktop' -or
    $PSVersionTable.PSVersion.Major -ne 5 -or
    $PSVersionTable.PSVersion.Minor -lt 1) {
  throw 'Native helper must be built with Windows PowerShell 5.1. Use npm run build:native.'
}

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

function Get-SSEBytesSha256([byte[]]$Bytes) {
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try {
    ([BitConverter]::ToString($hashAlgorithm.ComputeHash($Bytes)) -replace '-', '').ToUpperInvariant()
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

function Get-SSENativeReferencedAssemblies {
  # Der Baumlauf im Helfer nutzt die UI-Automation-Typen. Der
  # .NET-Framework-Compiler findet sie NICHT ueber ihren blossen Namen, weil
  # sie nur im GAC liegen; deshalb werden sie geladen und mit vollem Pfad
  # referenziert. `dynamic` fuer MSAA/COM braucht zusaetzlich seinen Binder.
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase -ErrorAction Stop
  @(
    'Microsoft.CSharp.dll',
    [System.Windows.Automation.AutomationElement].Assembly.Location,
    [System.Windows.Automation.ControlType].Assembly.Location,
    [System.Windows.Rect].Assembly.Location
  )
}

function Assert-SSENativeAssemblySurface([Reflection.Assembly]$Assembly) {
  $required = @{
    DSK=@('CreateDesktop','OpenDesktop','EnumDesktopWindows','ListDesktopWindows','SetLastError',
      'CloseDesktop','SetThreadDesktop','GetThreadDesktop','GetCurrentThreadId','CloseHandle','TerminateProcess',
      'WaitForSingleObject','GetExitCodeProcess','CreateJobObject','SetInformationJobObject',
      'AssignProcessToJobObject','ResumeThread','CreateProcess')
    SW=@('PrintWindow','GetWindowRect','GetDlgItem','EnumWindows','EnumChildWindows','GetDlgCtrlID',
      'GetWindowThreadProcessId','GetWindowTextW','GetClassNameW','IsWindowVisible','IsWindow','IsWindowUnicode','IsHungAppWindow',
      'SetForegroundWindow','SendMessageTimeout','SendMessageTimeoutA','SendMessageTimeoutW','SetCursorPos','GetCursorPos','mouse_event','keybd_event',
      'WindowFromPoint','GetAncestor','ShowWindow','SetWindowPos','BringWindowToTop','ScreenToClient','PostMessage',
      'SendMessage','GetForegroundWindow','GetLastActivePopup','GetLastInputInfo','IsIconic','AttachThreadInput',
      'GetGUIThreadInfo','GetCurrentThreadId','SendUnicodeText')
    SSEWindowEnumerator=@('Describe')
    SSEProcessCommandLine=@('TryGet')
    SSEWindowNode=@()
    SSEAccessible=@('Describe','DescribePoint','DescribePointBasic','Invoke')
    SSEAccNode=@()
    SSEWorkerControllerLease=@('Acquire','ReleaseAndClose')
    SSEUiaTree=@('Describe')
    SSEUiaNode=@()
    SSEUiaScrollState=@()
    SSEUiaSnapshot=@()
  }
  $missingTypes = @()
  $missingMethods = @()
  foreach ($typeName in $required.Keys) {
    $type = $Assembly.GetType($typeName, $false)
    if (-not $type) {
      $missingTypes += $typeName
      continue
    }
    foreach ($methodName in $required[$typeName]) {
      if (-not $type.GetMethod($methodName)) {
        $missingMethods += "$typeName.$methodName"
      }
    }
  }
  if ($missingTypes.Count -or $missingMethods.Count) {
    throw "Native helper surface is incomplete. Types: $($missingTypes -join ', '); methods: $($missingMethods -join ', ')"
  }
}

function Get-SSEReusableNativeIntegrity(
  [string]$SourceHash,
  [string]$AssemblyPath,
  [string]$ManifestPath
) {
  try {
    if (-not (Test-Path -LiteralPath $AssemblyPath -PathType Leaf)) {
      throw 'Native helper assembly is missing.'
    }
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
      throw 'Native helper integrity manifest is missing.'
    }
    $manifestBytes = Read-SSEBoundedFileBytes $ManifestPath (1KB)
    $manifestText = [Text.UTF8Encoding]::new($false, $true).GetString($manifestBytes)
    $manifest = $manifestText | ConvertFrom-Json -ErrorAction Stop
    $properties = @($manifest.PSObject.Properties.Name)
    if ($manifest.schemaVersion -ne 1 -or $properties.Count -ne 3 -or
        'schemaVersion' -notin $properties -or 'sourceSha256' -notin $properties -or
        'dllSha256' -notin $properties) {
      throw 'Native helper integrity manifest does not match schema 1.'
    }
    $expectedSourceHash = ([string]$manifest.sourceSha256).ToUpperInvariant()
    $expectedDllHash = ([string]$manifest.dllSha256).ToUpperInvariant()
    if ($expectedSourceHash -notmatch '^[A-F0-9]{64}$' -or
        $expectedDllHash -notmatch '^[A-F0-9]{64}$' -or
        $expectedSourceHash -ne $SourceHash) {
      throw 'Native helper integrity manifest has invalid or stale hashes.'
    }
    $assemblyBytes = Read-SSEBoundedFileBytes $AssemblyPath (4MB)
    $actualDllHash = Get-SSEBytesSha256 $assemblyBytes
    if ($actualDllHash -ne $expectedDllHash) {
      throw 'Native helper assembly hash does not match the integrity manifest.'
    }
    $assembly = [Reflection.Assembly]::Load($assemblyBytes)
    Assert-SSENativeAssemblySurface $assembly
    [pscustomobject]@{ sourceSha256 = $expectedSourceHash; dllSha256 = $actualDllHash }
  } catch {
    Write-Verbose "Native helper cache miss: $($_.Exception.Message)"
    $null
  }
}

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Native source file is missing: $source"
}

try {
  $sourceBytes = Read-SSEBoundedFileBytes $source (1MB)
  $sourceHash = Get-SSEBytesSha256 $sourceBytes
  $sourceText = [Text.UTF8Encoding]::new($false, $true).GetString($sourceBytes)
  $reusable = Get-SSEReusableNativeIntegrity $sourceHash $target $hashTarget
  if ($reusable) {
    Write-Output "Reused powershell/sse-native.dll (dll=$($reusable.dllSha256) source=$($reusable.sourceSha256))"
    return
  }
  $compile = @{
    TypeDefinition = $sourceText
    OutputAssembly = $temporary
    OutputType = 'Library'
    ErrorAction = 'Stop'
  }
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    # Windows PowerShell 5.1 nutzt den .NET-Framework-Compiler. Dieselbe so
    # erzeugte DLL kann auch unter PowerShell 7 laden.
    $compile.ReferencedAssemblies = Get-SSENativeReferencedAssemblies
  }
  Add-Type @compile
  if (-not (Test-Path -LiteralPath $temporary -PathType Leaf)) {
    throw 'Add-Type did not create the native helper assembly.'
  }
  $temporaryFile = Get-Item -LiteralPath $temporary -Force -ErrorAction Stop
  if ($temporaryFile.Length -gt 4MB) {
    throw "Native helper assembly is larger than 4194304 bytes: $($temporaryFile.Length)"
  }
  $assemblyBytes = Read-SSEBoundedFileBytes $temporary (4MB)
  $assembly = [Reflection.Assembly]::Load($assemblyBytes)
  Assert-SSENativeAssemblySurface $assembly

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
