[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('owner','keeper','event')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
$name = 'Local\SteuerSparErklaerungApi.SseWorkerController'

function Ready {
  [Console]::Out.WriteLine((@{ ready=$true; mode=$Mode; pid=$PID } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

if ($Mode -eq 'event') {
  $createdNew = $false
  $handle = [Threading.EventWaitHandle]::new(
    $false,
    [Threading.EventResetMode]::AutoReset,
    $name,
    [ref]$createdNew
  )
  try {
    Ready
    $null = [Console]::In.ReadLine()
  } finally {
    $handle.Dispose()
  }
  exit 0
}

$createdNew = $false
$mutex = [Threading.Mutex]::new($false, $name, [ref]$createdNew)
$owned = $false
try {
  if ($Mode -eq 'owner') {
    $owned = $mutex.WaitOne(0)
    if (-not $owned) { throw 'Test-Owner konnte den Produktionsmutex nicht erwerben.' }
  }
  Ready
  $command = [Console]::In.ReadLine()
  if ($owned -and $command -eq 'release') {
    $mutex.ReleaseMutex()
    $owned = $false
  }
} finally {
  if ($owned) {
    try { $mutex.ReleaseMutex() } catch { }
  }
  $mutex.Dispose()
}
