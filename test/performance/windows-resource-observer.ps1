param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$RootPid,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$RegistryPath,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$StopPath,
  [Parameter(Mandatory = $true)][ValidateRange(20, 60000)][int]$IntervalMs
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class SseLoadWindowObserver
{
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowEnabled(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hwnd, uint command);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static bool Below(int processId, int rootId, Dictionary<int, int> parents)
    {
        var seen = new HashSet<int>();
        var current = processId;
        while (current > 0 && seen.Add(current))
        {
            int parent;
            if (!parents.TryGetValue(current, out parent)) return false;
            if (parent == rootId) return true;
            current = parent;
        }
        return false;
    }

    public static int[] Descendants(int rootProcessId, int excludedRootProcessId)
    {
        const uint TH32CS_SNAPPROCESS = 0x00000002;
        var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
        try
        {
            var parents = new Dictionary<int, int>();
            var entry = new PROCESSENTRY32();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            if (Process32First(snapshot, ref entry))
            {
                do
                {
                    parents[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                    entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                }
                while (Process32Next(snapshot, ref entry));
            }
            var result = new List<int>();
            foreach (var processId in parents.Keys)
            {
                if (!Below(processId, rootProcessId, parents)) continue;
                if (processId == excludedRootProcessId || Below(processId, excludedRootProcessId, parents)) continue;
                result.Add(processId);
            }
            result.Sort();
            return result.ToArray();
        }
        finally
        {
            CloseHandle(snapshot);
        }
    }

    public static int[] Counts(int expectedProcessId)
    {
        int total = 0;
        int visible = 0;
        int visibleEnabled = 0;
        int modalCandidate = 0;
        bool enumerated = EnumWindows(delegate(IntPtr hwnd, IntPtr state) {
            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            if (processId != (uint)expectedProcessId) return true;
            total++;
            if (IsWindowVisible(hwnd)) {
                visible++;
                if (IsWindowEnabled(hwnd)) visibleEnabled++;
                var owner = GetWindow(hwnd, 4);
                uint ownerProcessId;
                if (owner != IntPtr.Zero && GetWindowThreadProcessId(owner, out ownerProcessId) != 0 &&
                    ownerProcessId == processId) modalCandidate++;
            }
            return true;
        }, IntPtr.Zero);
        return new int[] { total, visible, visibleEnabled, modalCandidate, enumerated ? 1 : 0 };
    }
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

function Get-ProcessIdentity([Diagnostics.Process]$Process) {
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

function Get-IdentityKey($Identity) {
  "$($Identity.creationTimeUtcTicks)|$($Identity.imageNameLower)|$($Identity.imagePathTextSha256)"
}

function Read-Registry {
  $entries = [ordered]@{}
  if (-not (Test-Path -LiteralPath $RegistryPath -PathType Leaf)) { return @() }
  foreach ($line in @(Get-Content -LiteralPath $RegistryPath -Encoding UTF8 -ErrorAction Stop)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
      $entry = $line | ConvertFrom-Json -ErrorAction Stop
      $entryPid = [int]$entry.pid
      $role = [string]$entry.role
      if ($entryPid -lt 1 -or $role -notmatch '^[a-z][a-z0-9-]{0,31}$') { continue }
      $entries["$entryPid"] = [pscustomobject][ordered]@{ pid = $entryPid; role = $role }
    }
    catch {
      # appendFileSync writes one complete line; a partial final line is ignored
      # and becomes visible on the next sample instead of stopping observation.
    }
  }
  return @($entries.Values)
}

$script:KnownOwned = [ordered]@{}
$script:BoundIdentity = @{}

function Sample-Resources(
  [Diagnostics.Stopwatch]$Clock,
  [int]$Sequence,
  [double]$ScheduledMs,
  [int]$MissedIntervals
) {
  $captureStartedMs = $Clock.Elapsed.TotalMilliseconds
  $errors = 0
  $tracked = @()
  foreach ($entry in @(Read-Registry)) {
    $script:KnownOwned["$($entry.pid)"] = $entry
  }
  foreach ($descendantPid in @([SseLoadWindowObserver]::Descendants($RootPid, $PID))) {
    if (-not $script:KnownOwned.Contains("$descendantPid")) {
      $script:KnownOwned["$descendantPid"] = [pscustomobject][ordered]@{
        pid = [int]$descendantPid
        role = 'owned-descendant'
      }
    }
  }
  foreach ($entry in @($script:KnownOwned.Values)) {
    $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    if (-not $process) {
      $tracked += [pscustomobject][ordered]@{
        pid = $entry.pid
        role = $entry.role
        alive = $false
      }
      continue
    }
    try {
      $windows = [SseLoadWindowObserver]::Counts([int]$process.Id)
      if ($windows[4] -ne 1) { throw [InvalidOperationException]::new('EnumWindows failed.') }
      $identity = Get-ProcessIdentity $process
      $identityKey = Get-IdentityKey $identity
      $boundKey = "$($entry.pid)"
      if (-not $script:BoundIdentity.ContainsKey($boundKey)) {
        $script:BoundIdentity[$boundKey] = $identityKey
      }
      elseif ($script:BoundIdentity[$boundKey] -ne $identityKey) {
        throw [InvalidOperationException]::new('Registered process identity changed.')
      }
      $tracked += [pscustomobject][ordered]@{
        pid = [int]$process.Id
        role = $entry.role
        alive = $true
        identity = $identity
        cpuTotalMs = [math]::Round($process.TotalProcessorTime.TotalMilliseconds, 3)
        workingSetBytes = [int64]$process.WorkingSet64
        privateBytes = [int64]$process.PrivateMemorySize64
        handleCount = [int]$process.HandleCount
        windows = [pscustomobject][ordered]@{
          total = [int]$windows[0]
          visible = [int]$windows[1]
          visibleEnabled = [int]$windows[2]
          modalCandidates = [int]$windows[3]
        }
      }
    }
    catch {
      # A registered child can exit between Get-Process and a metric getter.
      # That is an expected lifecycle observation, not a telemetry failure.
      $stillAlive = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
      if ($stillAlive) {
        $errors += 1
        $tracked += [pscustomobject][ordered]@{
          pid = $entry.pid
          role = $entry.role
          alive = $true
          sampleError = $_.Exception.GetType().Name
        }
        $stillAlive.Dispose()
      }
      else {
        $tracked += [pscustomobject][ordered]@{
          pid = $entry.pid
          role = $entry.role
          alive = $false
        }
      }
    }
    finally {
      if ($process) { $process.Dispose() }
    }
  }
  $sse = @(Get-Process -Name 'SSE' -ErrorAction SilentlyContinue)
  foreach ($process in $sse) { $process.Dispose() }
  [pscustomobject][ordered]@{
    schemaVersion = 1
    type = 'windows-resource-sample'
    sequence = $Sequence
    monotonicMs = [math]::Round($Clock.Elapsed.TotalMilliseconds, 3)
    scheduledMs = [math]::Round($ScheduledMs, 3)
    captureStartedMs = [math]::Round($captureStartedMs, 3)
    captureDurationMs = [math]::Round($Clock.Elapsed.TotalMilliseconds - $captureStartedMs, 3)
    latenessMs = [math]::Round([math]::Max(0, $captureStartedMs - $ScheduledMs), 3)
    missedIntervals = $MissedIntervals
    desktopScope = 'current-process-window-station-default-enumwindows'
    tracked = $tracked
    sseProcessCount = $sse.Count
    sampleErrorCount = $errors
  }
}

$clock = [Diagnostics.Stopwatch]::StartNew()
$sequence = 0
$nextScheduledMs = 0.0
$missedIntervals = 0
$rootProcess = Get-Process -Id $RootPid -ErrorAction Stop
try { $rootIdentityKey = Get-IdentityKey (Get-ProcessIdentity $rootProcess) }
finally { $rootProcess.Dispose() }
try {
  while ($true) {
    $rootProcess = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
    if (-not $rootProcess) { break }
    try {
      if ((Get-IdentityKey (Get-ProcessIdentity $rootProcess)) -ne $rootIdentityKey) { break }
    }
    finally {
      $rootProcess.Dispose()
    }
    $sequence += 1
    Sample-Resources $clock $sequence $nextScheduledMs $missedIntervals | ConvertTo-Json -Compress -Depth 8
    if (Test-Path -LiteralPath $StopPath -PathType Leaf) { break }
    $nextScheduledMs += $IntervalMs
    $nowMs = $clock.Elapsed.TotalMilliseconds
    while ($nextScheduledMs -le $nowMs) {
      $nextScheduledMs += $IntervalMs
      $missedIntervals += 1
    }
    $remainingMs = [math]::Ceiling($nextScheduledMs - $clock.Elapsed.TotalMilliseconds)
    if ($remainingMs -gt 0) { Start-Sleep -Milliseconds $remainingMs }
  }
}
catch {
  [pscustomobject][ordered]@{
    schemaVersion = 1
    type = 'windows-resource-observer-error'
    sequence = $sequence
    monotonicMs = [math]::Round($clock.Elapsed.TotalMilliseconds, 3)
    errorName = $_.Exception.GetType().Name
  } | ConvertTo-Json -Compress
  exit 1
}
