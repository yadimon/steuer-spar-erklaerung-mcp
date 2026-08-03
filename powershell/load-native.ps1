<# Shared, hash-bound loader for the public Win32/MSAA helper assembly. #>

function Get-SSENativeSourceSha256([string]$Path) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash([IO.File]::ReadAllBytes($Path))
    ([BitConverter]::ToString($hash) -replace '-', '').ToUpperInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Test-SSENativeSurface {
  $types = @('DSK','SW','SSEAccessible','SSEAccNode')
  foreach ($name in $types) {
    if (-not ($name -as [type])) { return $false }
  }
  $required = @{
    DSK=@('CreateDesktop','OpenDesktop','EnumDesktopWindows','CreateProcess','WaitForSingleObject',
      'CloseHandle','TerminateProcess','GetExitCodeProcess','CreateJobObject','SetInformationJobObject',
      'AssignProcessToJobObject','ResumeThread')
    SW=@('EnumWindows','GetWindowRect','GetWindowThreadProcessId','SendMessageTimeout','mouse_event','GetLastInputInfo')
    SSEAccessible=@('Describe','DescribePoint','Invoke')
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

  $sourceHash = Get-SSENativeSourceSha256 $sourcePath
  $expectedHash = $(if (Test-Path -LiteralPath $hashPath -PathType Leaf) {
    (Get-Content -Raw -LiteralPath $hashPath).Trim().ToUpperInvariant()
  } else { '' })
  $hashMatch = [bool]($expectedHash -and $expectedHash -eq $sourceHash)
  $dllError = $null

  if (-not $ForceSource) {
    if (-not (Test-Path -LiteralPath $assemblyPath -PathType Leaf)) {
      $dllError = 'Vorkompilierte Interop-DLL fehlt.'
    } elseif (-not $expectedHash) {
      $dllError = 'Quellhash-Sidecar der Interop-DLL fehlt.'
    } elseif (-not $hashMatch) {
      $dllError = "Interop-DLL ist veraltet: Quellhash $expectedHash, aktuell $sourceHash."
    } else {
      try {
        Add-Type -Path $assemblyPath -ErrorAction Stop
        if (-not (Test-SSENativeSurface)) {
          throw 'Interop-DLL exportiert nicht die vollstaendige erwartete Typ-/Methodenoberflaeche.'
        }
        $timer.Stop()
        return [pscustomobject]@{
          mode='precompiled-dll'; ms=$timer.ElapsedMilliseconds
          sourceHash=$sourceHash; expectedSourceHash=$expectedHash; hashMatch=$true
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
    sourceHash=$sourceHash; expectedSourceHash=$expectedHash; hashMatch=$hashMatch
    dllError=$dllError
  }
}
