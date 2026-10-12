# Server-private handover only. Public tools cannot provide this authority.
function Get-SSETableCursorPreviousWindowIdentity {
  param([IntPtr]$Window)
  if ($Window -eq [IntPtr]::Zero) {return [pscustomobject]@{hwnd=0;pid=0;start='0';class=''}}
  if (-not [SW]::IsWindow($Window)) {return $null}
  $windowPid=0;[SW]::GetWindowThreadProcessId($Window,[ref]$windowPid) | Out-Null
  try {
    $process=Get-Process -Id $windowPid -ErrorAction Stop
    [pscustomobject]@{hwnd=[int64]$Window;pid=$windowPid;
      start=$process.StartTime.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture);class=Get-SSEWindowClassName $Window}
  } catch {$null}
}

function Export-SSETableCursorLease {
  param([IntPtr]$Hwnd,[int]$ProcessId,$InputTick)
  $lease=$script:SSE_FOREGROUND_LEASE
  if (-not $lease.watch -or $lease.rootHwnd -ne [int64]$Hwnd -or $lease.targetPid -ne $ProcessId -or
      $null -eq $InputTick -or -not (Test-SSELastInputUnchanged $InputTick) -or
      [SW]::GetForegroundWindow() -ne $Hwnd -or $lease.lastOwnedInputTick -ne $InputTick) {return $null}
  $previous=Get-SSETableCursorPreviousWindowIdentity ([IntPtr][int64]$lease.previousForeground)
  if (-not $previous) {return $null}
  [pscustomobject]@{schemaVersion=1;nonce=[guid]::NewGuid().ToString();rootHwnd=[int64]$Hwnd;targetPid=$ProcessId;
    previous=$previous;previousCursor=$lease.previousCursor;inputEpoch=$InputTick}
}

function Import-SSETableCursorLease {
  param([IntPtr]$Hwnd,[int]$ProcessId,$InputTick,$Handover)
  $lease=$script:SSE_FOREGROUND_LEASE
  if ($lease.watch -or $Handover.schemaVersion -ne 1 -or
      [string]$Handover.nonce -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or
      $Handover.rootHwnd -ne [int64]$Hwnd -or $Handover.targetPid -ne $ProcessId -or
      $Handover.previous.start -isnot [string] -or $Handover.previous.start -cnotmatch '^(0|[1-9][0-9]{0,19})$' -or
      $null -eq $InputTick -or $Handover.inputEpoch -ne $InputTick -or
      -not (Test-SSELastInputUnchanged $InputTick) -or [SW]::GetForegroundWindow() -ne $Hwnd) {return $false}
  $previous=Get-SSETableCursorPreviousWindowIdentity ([IntPtr][int64]$Handover.previous.hwnd)
  if (-not $previous -or $previous.pid -ne $Handover.previous.pid -or
      $previous.start -cne $Handover.previous.start -or $previous.class -cne $Handover.previous.class) {return $false}
  $lease.depth=1;$lease.rootHwnd=[int64]$Hwnd;$lease.targetPid=$ProcessId
  $lease.previousForeground=[int64]$previous.hwnd;$lease.previousCursor=$Handover.previousCursor
  $lease.lastOwnedInputTick=$InputTick;$lease.lastOwnedInputContext='private-native-cursor-handover'
  $lease.acquisitions=1;$lease.watch=[Diagnostics.Stopwatch]::StartNew()
  $null=$lease.raisedWindows.Add([int64]$Hwnd)
  $true
}

function Publish-SSETableCursorLeaseHandover {
  param([IntPtr]$Hwnd,[int]$ProcessId,$InputTick)
  $handover=Export-SSETableCursorLease $Hwnd $ProcessId $InputTick
  if (-not $handover) {return $null}
  # Remove TOPMOST through the existing lease path before relinquishing the
  # worker. The API now owns final restoration; no target is reacquired here.
  Exit-SSEForegroundLease -Hwnd $Hwnd
  if (-not (Test-SSELastInputUnchanged $InputTick) -or [SW]::GetForegroundWindow() -ne $Hwnd) {return $null}
  $script:SSE_CURSOR_LEASE_HANDOVER=$handover
  $handover
}
