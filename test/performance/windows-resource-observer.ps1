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

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit,
        out long kernel, out long user);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags,
        System.Text.StringBuilder imageName, ref uint size);

    public static string ImagePath(IntPtr process)
    {
        var imageName = new System.Text.StringBuilder(32768);
        uint size = (uint)imageName.Capacity;
        if (!QueryFullProcessImageName(process, 0, imageName, ref size))
            throw new System.ComponentModel.Win32Exception();
        return imageName.ToString();
    }

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

    public static bool IsChronologicalDescendant(int processId, int rootId,
        Dictionary<int, int> parents, Dictionary<int, long> creationTimes)
    {
        var seen = new HashSet<int>();
        var current = processId;
        while (current > 0 && seen.Add(current))
        {
            int parent;
            long childCreated, parentCreated;
            if (!parents.TryGetValue(current, out parent) ||
                !creationTimes.TryGetValue(current, out childCreated) ||
                !creationTimes.TryGetValue(parent, out parentCreated)) return false;
            // A surviving child keeps its original parent PID after that
            // parent exits. Reuse of that PID cannot create a new ancestry.
            if (parentCreated > childCreated) return false;
            if (parent == rootId) return true;
            current = parent;
        }
        return false;
    }

    private static bool ReadCreationTime(int processId, Dictionary<int, long> creationTimes)
    {
        if (creationTimes.ContainsKey(processId)) return true;
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        var process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)processId);
        if (process == IntPtr.Zero)
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 87) return false; // The snapshot member already exited.
            throw new System.ComponentModel.Win32Exception(error);
        }
        try
        {
            long created, exited, kernel, user;
            if (!GetProcessTimes(process, out created, out exited, out kernel, out user))
                throw new System.ComponentModel.Win32Exception();
            creationTimes[processId] = created;
            return true;
        }
        finally { CloseHandle(process); }
    }

    private static bool ChronologicalBelow(int processId, int rootId, Dictionary<int, int> parents,
        Dictionary<int, long> creationTimes)
    {
        if (!Below(processId, rootId, parents)) return false;
        var seen = new HashSet<int>();
        var current = processId;
        while (current > 0 && seen.Add(current))
        {
            if (!ReadCreationTime(current, creationTimes)) return false;
            if (current == rootId) break;
            int parent;
            if (!parents.TryGetValue(current, out parent)) return false;
            current = parent;
        }
        return IsChronologicalDescendant(processId, rootId, parents, creationTimes);
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
            var creationTimes = new Dictionary<int, long>();
            foreach (var processId in parents.Keys)
            {
                if (!ChronologicalBelow(processId, rootProcessId, parents, creationTimes)) continue;
                if (processId == excludedRootProcessId ||
                    ChronologicalBelow(processId, excludedRootProcessId, parents, creationTimes)) continue;
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
  # MainModule/Path may be absent until the child's loader initializes.
  # Query the executable image on the already retained kernel handle.
  $path = [SseLoadWindowObserver]::ImagePath($Process.Handle)
  $pathHash = Get-PathTextHash $path
  if (-not $pathHash) { throw [InvalidOperationException]::new('Process path identity unavailable.') }
  [pscustomobject][ordered]@{
    creationTimeUtcTicks = [string]([int64]$Process.StartTime.ToUniversalTime().Ticks)
    imageNameLower = ([IO.Path]::GetFileNameWithoutExtension($path)).ToLowerInvariant()
    imagePathTextSha256 = $pathHash
  }
}

function Get-IdentityKey($Identity) {
  "$($Identity.creationTimeUtcTicks)|$($Identity.imageNameLower)|$($Identity.imagePathTextSha256)"
}

function Get-ObservedProcess([int]$ProcessId) {
  $key = [string]$ProcessId
  if ($script:BoundProcesses.ContainsKey($key)) { return $script:BoundProcesses[$key] }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  try {
    # Keep the exact kernel object until observation ends. Its PID cannot be
    # recycled while this handle remains open, including after process exit.
    if ($process.Handle -eq [IntPtr]::Zero) {
      throw [InvalidOperationException]::new('Process handle unavailable.')
    }
    $script:BoundProcesses[$key] = $process
    return $process
  }
  catch {
    $process.Dispose()
    throw
  }
}

function Close-ObservedProcesses {
  foreach ($process in @($script:BoundProcesses.Values)) { $process.Dispose() }
  $script:BoundProcesses.Clear()
}

function Test-ObservedDescendant([int]$ProcessId) {
  return @([SseLoadWindowObserver]::Descendants($RootPid, $PID)) -contains $ProcessId
}

function Get-ObservedWindowCounts([int]$ProcessId) {
  return [SseLoadWindowObserver]::Counts($ProcessId)
}

function Measure-OwnedProcess($Entry) {
  $process = $null
  $identity = $null
  try {
    $process = Get-ObservedProcess ([int]$Entry.pid)
    if (-not $process -or $process.HasExited) {
      return [pscustomobject][ordered]@{ pid = $Entry.pid; role = $Entry.role; alive = $false }
    }
    $process.Refresh()
    $identity = Get-ProcessIdentity $process
    $identityKey = Get-IdentityKey $identity
    $boundKey = [string]$Entry.pid
    if ($Entry.expectedIdentity -and (Get-IdentityKey $Entry.expectedIdentity) -ne $identityKey) {
      throw [IO.InvalidDataException]::new('Registered process identity does not match.')
    }
    if (-not $script:BoundIdentity.ContainsKey($boundKey)) {
      if (-not $Entry.expectedIdentity -and -not (Test-ObservedDescendant ([int]$Entry.pid))) {
        throw [IO.InvalidDataException]::new('Descendant ownership changed before identity binding.')
      }
      $script:BoundIdentity[$boundKey] = $identityKey
    }
    elseif ($script:BoundIdentity[$boundKey] -ne $identityKey) {
      throw [IO.InvalidDataException]::new('Bound process identity changed.')
    }
    $windows = Get-ObservedWindowCounts ([int]$process.Id)
    if ($windows[4] -ne 1) { throw [InvalidOperationException]::new('EnumWindows failed.') }
    $sample = [pscustomobject][ordered]@{
      pid = [int]$process.Id
      role = $Entry.role
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
    # Metric getters may race with exit. Check the same pinned generation after
    # reading them rather than accepting data from a subsequent PID occupancy.
    if ($process.HasExited) {
      return [pscustomobject][ordered]@{ pid = $Entry.pid; role = $Entry.role; alive = $false }
    }
    return $sample
  }
  catch {
    $sampleError = $_.Exception.GetType().Name
    $exited = $false
    if ($process) {
      try { $exited = $process.HasExited } catch { $exited = $false }
    }
    if ($exited) {
      return [pscustomobject][ordered]@{ pid = $Entry.pid; role = $Entry.role; alive = $false }
    }
    return [pscustomobject][ordered]@{
      pid = $Entry.pid
      role = $Entry.role
      alive = $true
      identity = $identity
      sampleError = $sampleError
    }
  }
}

function Measure-KnownOwnedProcesses {
  foreach ($entry in @($script:KnownOwned.Values)) {
    $sample = Measure-OwnedProcess $entry
    if ($sample.alive -eq $false -and -not $sample.sampleError -and
        $entry.role -eq 'owned-descendant' -and -not $entry.expectedIdentity -and
        -not $script:BoundProcesses.ContainsKey([string]$entry.pid)) {
      # This child disappeared before a handle could bind its generation.
      # Keep its dead observation, but require fresh discovery for future PIDs.
      $script:KnownOwned.Remove([string]$entry.pid)
    }
    $sample
  }
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
      $expectedIdentity = $entry.identity
      if ($entryPid -eq $RootPid -and $role -eq 'runner') {
        $expectedIdentity = $script:RootIdentity
      }
      if (-not $expectedIdentity -or
          [string]$expectedIdentity.creationTimeUtcTicks -notmatch '^\d{10,20}$' -or
          [string]$expectedIdentity.imageNameLower -notmatch '^[a-z0-9._-]{1,128}$' -or
          [string]$expectedIdentity.imagePathTextSha256 -notmatch '^[A-F0-9]{64}$') { continue }
      $entries["$entryPid"] = [pscustomobject][ordered]@{
        pid = $entryPid; role = $role; expectedIdentity = $expectedIdentity
      }
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
$script:BoundProcesses = @{}

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
  $tracked = @(Measure-KnownOwnedProcesses)
  foreach ($sample in $tracked) { if ($sample.sampleError) { $errors += 1 } }
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
try {
  $rootProcess = Get-ObservedProcess $RootPid
  if (-not $rootProcess -or $rootProcess.HasExited) { throw [InvalidOperationException]::new('Root process exited.') }
  $script:RootIdentity = Get-ProcessIdentity $rootProcess
  $rootIdentityKey = Get-IdentityKey $script:RootIdentity
  while ($true) {
    if ($rootProcess.HasExited) { break }
    $rootProcess.Refresh()
    if ((Get-IdentityKey (Get-ProcessIdentity $rootProcess)) -ne $rootIdentityKey) { break }
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
finally {
  Close-ObservedProcesses
}
