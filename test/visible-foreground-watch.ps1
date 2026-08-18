param(
  [Parameter(Mandatory = $true)][int]$TargetProcessId,
  [Parameter(Mandatory = $true)][string]$ReadyPath,
  [Parameter(Mandatory = $true)][string]$StopPath,
  [string]$ForbiddenDesktopName = '',
  [int]$TimeoutMs = 240000,
  [int]$SampleMs = 10
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VisibleForegroundProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool GetUserObjectInformation(IntPtr handle, int index, System.Text.StringBuilder value, int length, out int needed);
  public static string InputDesktopName() {
    IntPtr desktop = OpenInputDesktop(0, false, 0x0001);
    if (desktop == IntPtr.Zero) return "<unavailable>";
    try {
      var value = new System.Text.StringBuilder(256);
      int needed;
      return GetUserObjectInformation(desktop, 2, value, 512, out needed) ? value.ToString() : "<unavailable>";
    } finally { CloseDesktop(desktop); }
  }
}
'@

$readyFull = [IO.Path]::GetFullPath($ReadyPath)
$stopFull = [IO.Path]::GetFullPath($StopPath)
$watch = [Diagnostics.Stopwatch]::StartNew()
$samples = 0
$targetSeen = $false
$targetHwnds = New-Object 'System.Collections.Generic.HashSet[long]'
$foregroundPids = New-Object 'System.Collections.Generic.HashSet[int]'
$inputDesktopBefore = [VisibleForegroundProbe]::InputDesktopName()

[IO.File]::WriteAllText($readyFull, 'ready', (New-Object Text.UTF8Encoding($false)))
while ($watch.ElapsedMilliseconds -lt $TimeoutMs -and -not (Test-Path -LiteralPath $stopFull -PathType Leaf)) {
  $hwnd = [VisibleForegroundProbe]::GetForegroundWindow()
  [uint32]$foregroundPid = 0
  if ($hwnd -ne [IntPtr]::Zero) {
    [VisibleForegroundProbe]::GetWindowThreadProcessId($hwnd, [ref]$foregroundPid) | Out-Null
  }
  $samples++
  if ($foregroundPid -gt 0) { $null = $foregroundPids.Add([int]$foregroundPid) }
  if ([int]$foregroundPid -eq $TargetProcessId) {
    $targetSeen = $true
    $null = $targetHwnds.Add([int64]$hwnd)
  }
  Start-Sleep -Milliseconds $SampleMs
}

[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$inputDesktopAfter = [VisibleForegroundProbe]::InputDesktopName()
[Console]::Out.Write((([pscustomobject]@{
  ok=$true
  targetProcessId=$TargetProcessId
  targetSeen=$targetSeen
  targetHwnds=@($targetHwnds)
  samples=$samples
  sampleMs=$SampleMs
  durationMs=[int64]$watch.ElapsedMilliseconds
  distinctForegroundPids=@($foregroundPids).Count
  inputDesktopBefore=$inputDesktopBefore
  inputDesktopAfter=$inputDesktopAfter
  forbiddenDesktopSeen=[bool]($ForbiddenDesktopName -and
    ($inputDesktopBefore -ceq $ForbiddenDesktopName -or $inputDesktopAfter -ceq $ForbiddenDesktopName))
  stoppedBySignal=(Test-Path -LiteralPath $stopFull -PathType Leaf)
}) | ConvertTo-Json -Compress))
