param(
  [Parameter(Mandatory = $true)][ValidateSet('Inspect', 'Terminate')][string]$Mode,
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$TargetProcessId,
  [ValidatePattern('^\d{10,20}$')][string]$ExpectedCreationTimeUtcTicks,
  [ValidatePattern('^[a-z0-9._-]{1,128}$')][string]$ExpectedImageNameLower,
  [ValidatePattern('^[A-F0-9]{64}$')][string]$ExpectedImagePathTextSha256
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SseOwnedProcessNative
{
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool TerminateProcess(IntPtr processHandle, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
}
'@

function Get-PathTextHash([string]$Value) {
  if ([string]::IsNullOrEmpty($Value)) { return $null }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
  }
  finally {
    $sha.Dispose()
  }
}

function Get-BoundIdentity([Diagnostics.Process]$Process) {
  $path = $null
  try { $path = [string]$Process.Path } catch { $path = $null }
  $pathHash = Get-PathTextHash $path
  if (-not $pathHash) { throw [InvalidOperationException]::new('Process path identity unavailable.') }
  [pscustomobject][ordered]@{
    creationTimeUtcTicks = [string]([int64]$Process.StartTime.ToUniversalTime().Ticks)
    imageNameLower = ([string]$Process.ProcessName).ToLowerInvariant()
    imagePathTextSha256 = $pathHash
  }
}

$process = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
if (-not $process) {
  [pscustomobject][ordered]@{ outcome = 'not-running'; identity = $null } | ConvertTo-Json -Compress
  exit 0
}

try {
  # Open and retain the native handle before identity reads. Termination and
  # waiting below use only this handle, never a second lookup by PID.
  $boundHandle = $process.Handle
  if ($boundHandle -eq [IntPtr]::Zero) {
    throw [InvalidOperationException]::new('Native process handle unavailable.')
  }
  $identity = Get-BoundIdentity $process
  if ($Mode -eq 'Inspect') {
    [pscustomobject][ordered]@{ outcome = 'running'; identity = $identity } | ConvertTo-Json -Compress
    exit 0
  }

  if (-not $PSBoundParameters.ContainsKey('ExpectedCreationTimeUtcTicks') -or
      -not $PSBoundParameters.ContainsKey('ExpectedImageNameLower') -or
      -not $PSBoundParameters.ContainsKey('ExpectedImagePathTextSha256')) {
    throw [ArgumentException]::new('Terminate requires a complete immutable process identity.')
  }
  $matches = (
    $identity.creationTimeUtcTicks -eq $ExpectedCreationTimeUtcTicks -and
    $identity.imageNameLower -eq $ExpectedImageNameLower -and
    $identity.imagePathTextSha256 -eq $ExpectedImagePathTextSha256
  )
  if (-not $matches) {
    [pscustomobject][ordered]@{ outcome = 'identity-mismatch'; identity = $identity } | ConvertTo-Json -Compress
    exit 0
  }

  # The identity is checked after binding the exact handle terminated here.
  if (-not [SseOwnedProcessNative]::TerminateProcess($boundHandle, 1)) {
    throw [InvalidOperationException]::new('Identity-bound process termination failed.')
  }
  $waitResult = [SseOwnedProcessNative]::WaitForSingleObject($boundHandle, 5000)
  if ($waitResult -ne 0) {
    throw [TimeoutException]::new('Identity-bound process did not exit after termination.')
  }
  [pscustomobject][ordered]@{ outcome = 'terminated'; identity = $identity } | ConvertTo-Json -Compress
}
finally {
  $process.Dispose()
}
