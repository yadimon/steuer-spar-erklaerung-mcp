<# Shared, hash-bound loader for the public Win32/MSAA helper assembly. #>

function Get-SSENativeSha256([string]$Path, [long]$MaxBytes) {
  $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($file.PSIsContainer -or $file.Length -gt $MaxBytes) {
    throw "Native Integritaetsdatei ist groesser als $MaxBytes Bytes: $($file.Length)"
  }
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($file.FullName)
    try {
      if ($stream.Length -gt $MaxBytes) {
        throw "Native Integritaetsdatei ist groesser als $MaxBytes Bytes: $($stream.Length)"
      }
      $hash = $algorithm.ComputeHash($stream)
      ([BitConverter]::ToString($hash) -replace '-', '').ToUpperInvariant()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $algorithm.Dispose()
  }
}

function Read-SSENativeBoundedUtf8([string]$Path, [long]$MaxBytes) {
  $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($file.PSIsContainer -or $file.Length -gt $MaxBytes) {
    throw "Native Integritaetsdatei ist groesser als $MaxBytes Bytes: $($file.Length)"
  }
  $stream = $null
  try {
    $stream = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($stream.Length -gt $MaxBytes) {
      throw "Native Integritaetsdatei ist groesser als $MaxBytes Bytes: $($stream.Length)"
    }
    $bytes = New-Object byte[] ([int]$stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($read -eq 0) { throw 'Native Integritaetsdatei wurde waehrend des Lesens verkuerzt.' }
      $offset += $read
    }
    [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}

function Test-SSENativeSurface {
  $types = @(
    'DSK','SW','SSEWindowNode','SSEWindowEnumerator','SSEProcessCommandLine',
    'SSEAccessible','SSEAccNode','SSEWorkerControllerLease'
  )
  foreach ($name in $types) {
    if (-not ($name -as [type])) { return $false }
  }
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
    SSEAccessible=@('Describe','DescribePoint','Invoke')
    SSEWorkerControllerLease=@('Acquire','ReleaseAndClose')
  }
  foreach ($typeName in $required.Keys) {
    $type = $typeName -as [type]
    foreach ($method in $required[$typeName]) {
      if (-not $type.GetMethod($method)) { return $false }
    }
  }
  return $true
}

function Import-SSENativeInterop {
  [CmdletBinding()]
  param([switch]$ForceSource)

  $timer = [Diagnostics.Stopwatch]::StartNew()
  if (Test-SSENativeSurface) {
    $timer.Stop()
    return [pscustomobject]@{ mode='already-loaded'; ms=$timer.ElapsedMilliseconds; hashMatch=$null }
  }

  $sourcePath = Join-Path $PSScriptRoot 'sse-native.cs'
  $assemblyPath = Join-Path $PSScriptRoot 'sse-native.dll'
  $hashPath = Join-Path $PSScriptRoot 'sse-native.sha256'
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Nativer Interop-Quelltext fehlt: $sourcePath"
  }

  $sourceHash = Get-SSENativeSha256 $sourcePath (1MB)
  $dllHash = ''
  $dllReadError = $null
  if (Test-Path -LiteralPath $assemblyPath -PathType Leaf) {
    try { $dllHash = Get-SSENativeSha256 $assemblyPath (4MB) }
    catch { $dllReadError = $_.Exception.Message }
  }
  $expectedSourceHash = ''
  $expectedDllHash = ''
  $manifestError = $null
  if (Test-Path -LiteralPath $hashPath -PathType Leaf) {
    try {
      $manifestFile = Get-Item -LiteralPath $hashPath -Force -ErrorAction Stop
      if ($manifestFile.PSIsContainer -or $manifestFile.Length -gt 1KB) {
        throw 'Interop-Integritaetsmanifest ist kein kleines regulaeres Dokument.'
      }
      $manifestText = Read-SSENativeBoundedUtf8 $hashPath 1KB
      $manifest = $manifestText | ConvertFrom-Json -ErrorAction Stop
      $manifestProperties = @($manifest.PSObject.Properties.Name)
      if ($manifest.schemaVersion -ne 1 -or $manifestProperties.Count -ne 3 -or
          'schemaVersion' -notin $manifestProperties -or 'sourceSha256' -notin $manifestProperties -or
          'dllSha256' -notin $manifestProperties) {
        throw 'Interop-Integritaetsmanifest hat nicht Schema 1.'
      }
      $expectedSourceHash = ([string]$manifest.sourceSha256).ToUpperInvariant()
      $expectedDllHash = ([string]$manifest.dllSha256).ToUpperInvariant()
      if ($expectedSourceHash -notmatch '^[A-F0-9]{64}$' -or $expectedDllHash -notmatch '^[A-F0-9]{64}$') {
        throw 'Interop-Integritaetsmanifest enthaelt keinen gueltigen SHA256.'
      }
    } catch {
      $manifestError = $_.Exception.Message
    }
  } else {
    $manifestError = 'Integritaetsmanifest der Interop-DLL fehlt.'
  }
  $hashMatch = [bool]($expectedSourceHash -and $expectedSourceHash -eq $sourceHash)
  $dllHashMatch = [bool]($expectedDllHash -and $expectedDllHash -eq $dllHash)
  $dllError = $null

  if (-not $ForceSource) {
    if (-not (Test-Path -LiteralPath $assemblyPath -PathType Leaf)) {
      $dllError = 'Vorkompilierte Interop-DLL fehlt.'
    } elseif ($dllReadError) {
      $dllError = $dllReadError
    } elseif ($manifestError) {
      $dllError = $manifestError
    } elseif (-not $hashMatch) {
      $dllError = "Interop-DLL ist veraltet: Quellhash $expectedSourceHash, aktuell $sourceHash."
    } elseif (-not $dllHashMatch) {
      $dllError = "Interop-DLL-Hash stimmt nicht: erwartet $expectedDllHash, aktuell $dllHash."
    } else {
      try {
        Add-Type -Path $assemblyPath -ErrorAction Stop
        if (-not (Test-SSENativeSurface)) {
          throw 'Interop-DLL exportiert nicht die vollstaendige erwartete Typ-/Methodenoberflaeche.'
        }
        $timer.Stop()
        return [pscustomobject]@{
          mode='precompiled-dll'; ms=$timer.ElapsedMilliseconds
          sourceHash=$sourceHash; expectedSourceHash=$expectedSourceHash; hashMatch=$true
          dllHash=$dllHash; expectedDllHash=$expectedDllHash; dllHashMatch=$true
          dllError=$null
        }
      } catch {
        $dllError = $_.Exception.Message
        if ('DSK' -as [type]) {
          throw "Interop-DLL wurde geladen, ist aber inkompatibel und kann in diesem Prozess nicht ersetzt werden: $dllError"
        }
      }
    }
  } else {
    $dllError = 'Source-Fallback wurde fuer den Regressionstest erzwungen.'
  }

  $sourceLoad = @{ Path=$sourcePath; ErrorAction='Stop' }
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    $sourceLoad.ReferencedAssemblies = @('Microsoft.CSharp.dll')
  }
  Add-Type @sourceLoad
  if (-not (Test-SSENativeSurface)) {
    throw 'Interop-Quelltext exportiert nicht die vollstaendige erwartete Typ-/Methodenoberflaeche.'
  }
  $timer.Stop()
  [pscustomobject]@{
    mode='source-fallback'; ms=$timer.ElapsedMilliseconds
    sourceHash=$sourceHash; expectedSourceHash=$expectedSourceHash; hashMatch=$hashMatch
    dllHash=$dllHash; expectedDllHash=$expectedDllHash; dllHashMatch=$dllHashMatch
    dllError=$dllError
  }
}
