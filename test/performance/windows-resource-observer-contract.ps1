param([Parameter(Mandatory = $true)][string]$NodeExecutable)

$ErrorActionPreference = 'Stop'
$observerPath = Join-Path $PSScriptRoot 'windows-resource-observer.ps1'
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($observerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw 'Observer syntax is invalid.' }
$nativeSources = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.StringConstantExpressionAst] -and
    $node.Value.Contains('public static class SseLoadWindowObserver')
}, $true))
if ($nativeSources.Count -ne 1) { throw 'Observer native source is not unique.' }
Add-Type -TypeDefinition $nativeSources[0].Value
foreach ($name in @('Get-PathTextHash', 'Get-ProcessIdentity', 'Get-IdentityKey',
    'Get-ObservedProcess', 'Close-ObservedProcesses', 'Discover-OwnedProcesses', 'Measure-OwnedProcess', 'Measure-KnownOwnedProcesses')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definitions.Count -ne 1) { throw "Observer function is not unique: $name" }
  Invoke-Expression $definitions[0].Extent.Text
}

$script:BoundProcesses = @{}
$script:BoundIdentity = @{}
$script:DiscoveredBindings = @{}
$script:ForbidLookups = $false
$script:LookupCount = 0
$script:WindowCalls = 0
$script:WindowFailure = $false
$script:ExitDuringSample = $null
$script:DescendantOwned = $true
$script:MissingLookupPid = 0
function Get-Process {
  [CmdletBinding()]
  param([int]$Id)
  $script:LookupCount += 1
  if ($script:ForbidLookups) { throw 'A bound generation was looked up by PID again.' }
  if ($Id -eq $script:MissingLookupPid) { return $null }
  Microsoft.PowerShell.Management\Get-Process -Id $Id -ErrorAction SilentlyContinue
}
function Test-ObservedDescendant([int]$ProcessId) { return $script:DescendantOwned }
function Get-ObservedWindowCounts([int]$ProcessId) {
  $script:WindowCalls += 1
  if ($script:ExitDuringSample) {
    $script:ExitDuringSample.Kill()
    if (-not $script:ExitDuringSample.WaitForExit(5000)) { throw 'Owned child did not exit.' }
    throw [InvalidOperationException]::new('Getter raced with exit.')
  }
  if ($script:WindowFailure) { throw [InvalidOperationException]::new('Live getter failed.') }
  return @(0, 0, 0, 0, 1)
}
function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$parents = [Collections.Generic.Dictionary[int,int]]::new()
$parents[2] = 1; $parents[3] = 2
$births = [Collections.Generic.Dictionary[int,long]]::new()
$births[1] = 10; $births[2] = 20; $births[3] = 30
Assert-True ([SseLoadWindowObserver]::IsChronologicalDescendant(3,1,$parents,$births)) 'Valid nested ancestry was lost.'
Assert-True (-not [SseLoadWindowObserver]::IsChronologicalDescendant(1,1,$parents,$births)) 'Root was counted as its own child.'
$births[3] = 15
Assert-True (-not [SseLoadWindowObserver]::IsChronologicalDescendant(3,1,$parents,$births)) 'Reused intermediate parent PID was accepted.'
$births[3] = 30; $births[1] = 25
Assert-True (-not [SseLoadWindowObserver]::IsChronologicalDescendant(3,1,$parents,$births)) 'Reused root PID was accepted.'
$births[1] = 10; $births[2] = 10
Assert-True ([SseLoadWindowObserver]::IsChronologicalDescendant(3,1,$parents,$births)) 'Equal-resolution creation times were rejected.'
$births.Remove(2) | Out-Null
Assert-True (-not [SseLoadWindowObserver]::IsChronologicalDescendant(3,1,$parents,$births)) 'Missing parent birth was accepted.'
$births[2] = 20; $parents[2] = 3
Assert-True (-not [SseLoadWindowObserver]::IsChronologicalDescendant(3,1,$parents,$births)) 'Parent cycle was accepted.'
$parents[2] = 1

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SseObserverContractHandles {
    public static Func<int, System.Diagnostics.Process> ExitedLookup() {
        return pid => { throw new InvalidOperationException("Injected process lookup exit."); };
    }
    public static Func<int, System.Diagnostics.Process> MissingLookup() {
        return pid => { throw new ArgumentException("Injected process lookup disappearance."); };
    }
    public static System.Threading.Tasks.Task EndPinnedAfterDelay(IntPtr process) {
        return System.Threading.Tasks.Task.Run(() => {
            System.Threading.Thread.Sleep(10);
            if (!TerminateProcess(process, 0)) throw new System.ComponentModel.Win32Exception();
        });
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetHandleInformation(IntPtr handle, out uint flags);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
        public uint size; public string reserved; public string desktop; public string title;
        public uint x; public uint y; public uint xSize; public uint ySize;
        public uint xCountChars; public uint yCountChars; public uint fillAttribute; public uint flags;
        public ushort showWindow; public ushort reservedSize; public IntPtr reservedBytes;
        public IntPtr standardInput; public IntPtr standardOutput; public IntPtr standardError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
        public IntPtr process; public IntPtr thread; public uint processId; public uint threadId;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(string application, System.Text.StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags,
        IntPtr environment, string directory, ref STARTUPINFO startup, out PROCESS_INFORMATION information);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits {
        public long processTime; public long jobTime; public uint flags;
        public UIntPtr minWorkingSet; public UIntPtr maxWorkingSet; public uint activeProcesses;
        public UIntPtr affinity; public uint priorityClass; public uint schedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters {
        public ulong readOperations; public ulong writeOperations; public ulong otherOperations;
        public ulong readBytes; public ulong writeBytes; public ulong otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits {
        public BasicLimits basic; public IoCounters io;
        public UIntPtr processMemory; public UIntPtr jobMemory;
        public UIntPtr peakProcessMemory; public UIntPtr peakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int kind,
        ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool inside);

    public static IntPtr ContainParent(IntPtr process) {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try {
            var limits = new ExtendedLimits();
            limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))) ||
                !AssignProcessToJobObject(job, process)) throw new System.ComponentModel.Win32Exception();
            return job;
        }
        catch { CloseHandle(job); throw; }
    }
    public static bool InsideJob(IntPtr process, IntPtr job) {
        bool inside;
        if (!IsProcessInJob(process, job, out inside)) throw new System.ComponentModel.Win32Exception();
        return inside;
    }
    public static void CloseOwnedJob(IntPtr job) {
        if (!CloseHandle(job)) throw new System.ComponentModel.Win32Exception();
    }

    public static System.Diagnostics.Process StartSuspended(string executable) {
        var startup = new STARTUPINFO();
        startup.size = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
        PROCESS_INFORMATION information;
        const uint CREATE_SUSPENDED = 0x4, CREATE_NO_WINDOW = 0x08000000;
        if (!CreateProcess(executable, new System.Text.StringBuilder("\"" + executable + "\""),
            IntPtr.Zero, IntPtr.Zero, false, CREATE_SUSPENDED | CREATE_NO_WINDOW,
            IntPtr.Zero, null, ref startup, out information))
            throw new System.ComponentModel.Win32Exception();
        try {
            var process = System.Diagnostics.Process.GetProcessById((int)information.processId);
            try {
                if (process.Handle == IntPtr.Zero) throw new InvalidOperationException("Child handle unavailable.");
                return process;
            }
            catch { process.Dispose(); throw; }
        }
        catch { TerminateProcess(information.process, 1); throw; }
        finally { CloseHandle(information.thread); CloseHandle(information.process); }
    }
}
'@

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$scratch = [IO.Path]::GetFullPath((Join-Path $tempRoot ('sse-observer-contract-' + [Guid]::NewGuid().ToString('N'))))
$null = [IO.Directory]::CreateDirectory($scratch)
$childPath = Join-Path $scratch 'child.cjs'
[IO.File]::WriteAllText($childPath, @'
const fs = require('node:fs');
const readline = require('node:readline');
const retained = [];
readline.createInterface({input: process.stdin}).on('line', line => {
  if (line === 'grow') {
    retained.push(Buffer.alloc(64 * 1024 * 1024, 1));
    for (let i = 0; i < 128; i++) retained.push(fs.openSync(__filename, 'r'));
    process.stdout.write('grown\n');
  }
  if (line === 'exit-zero') process.exit(0);
  if (line === 'exit-special') process.exit(259);
});
process.stdout.write('ready\n');
'@)
$children = New-Object Collections.ArrayList
$ownedParentJob = [IntPtr]::Zero
function Start-OwnedChild {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $NodeExecutable
  $info.Arguments = '"' + $childPath + '"'
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $process = [Diagnostics.Process]::Start($info)
  $null = $children.Add($process)
  $ready = $process.StandardOutput.ReadLineAsync()
  Assert-True ($ready.Wait(10000) -and $ready.Result -eq 'ready') 'Owned child did not become ready.'
  return $process
}

try {
  $suspended = [SseObserverContractHandles]::StartSuspended($NodeExecutable)
  $null = $children.Add($suspended)
  Assert-True ([string]::IsNullOrEmpty([string]$suspended.Path)) 'Fixture did not expose pre-initialization module-path absence.'
  $suspendedIdentity = Get-ProcessIdentity $suspended
  Assert-True ($suspendedIdentity.imagePathTextSha256 -eq (Get-PathTextHash $NodeExecutable)) 'Suspended child lost its exact executable path.'
  Assert-True ($suspendedIdentity.imageNameLower -eq 'node') 'Suspended child lost its executable name.'
  $suspended.Kill()
  Assert-True ($suspended.WaitForExit(5000)) 'Suspended owned child did not exit.'
  $bindMethod = [SseLoadWindowObserver].GetMethod('BindDiscoveredProcess', [Reflection.BindingFlags]'NonPublic,Static')
  Assert-True ($null -ne $bindMethod) 'Discovery binding is not independently testable.'
  $bindingChild = Start-OwnedChild
  $bindingHandle = $bindingChild.Handle
  $bindingCreated = [long]$bindingChild.StartTime.ToFileTimeUtc()
  $bindIdMethod = [SseLoadWindowObserver].GetMethod('BindDiscoveredProcessId', [Reflection.BindingFlags]'NonPublic,Static')
  Assert-True ($null -ne $bindIdMethod) 'Lookup-before-binding race is not independently testable.'
  foreach ($lookup in @([SseObserverContractHandles]::ExitedLookup(), [SseObserverContractHandles]::MissingLookup())) {
    $lookupError = $null
    try { $null = $bindIdMethod.Invoke($null, [object[]]@($bindingChild.Id,$bindingCreated,$bindingHandle,$lookup)) }
    catch { $lookupError = $_.Exception.GetBaseException() }
    Assert-True (($lookupError -is [InvalidOperationException] -or $lookupError -is [ArgumentException]) -and -not $bindingChild.HasExited) 'Live lookup failure was hidden as an exit.'
  }
  $unboundLive = [Diagnostics.Process]::GetProcessById($bindingChild.Id)
  $liveBinding = $bindMethod.Invoke($null, [object[]]@($unboundLive,$bindingCreated,$bindingHandle))
  Assert-True ([object]::ReferenceEquals($liveBinding,$unboundLive) -and -not $liveBinding.HasExited) 'Live discovered generation was not retained.'
  $liveBinding.Dispose()
  $wrongBirth = [Diagnostics.Process]::GetProcessById($bindingChild.Id)
  $wrongBirthError = $null
  try { $null = $bindMethod.Invoke($null, [object[]]@($wrongBirth,($bindingCreated+1L),$bindingHandle)) }
  catch { $wrongBirthError = $_.Exception.GetBaseException() }
  Assert-True ($wrongBirthError -is [IO.InvalidDataException] -and -not $bindingChild.HasExited) 'Live generation mismatch was hidden as an exit.'
  $disposedLive = [Diagnostics.Process]::GetProcessById($bindingChild.Id)
  $disposedLive.Dispose()
  $liveGetterError = $null
  try { $null = $bindMethod.Invoke($null, [object[]]@($disposedLive,$bindingCreated,$bindingHandle)) }
  catch { $liveGetterError = $_.Exception.GetBaseException() }
  Assert-True ($liveGetterError -is [InvalidOperationException] -and -not $bindingChild.HasExited) 'A live managed getter error was hidden as an exit.'
  # GetProcessById has not opened the managed handle yet. End the exact child
  # before invoking the actual binding helper, while its kernel object is pinned.
  $unboundDead = [Diagnostics.Process]::GetProcessById($bindingChild.Id)
  $bindingChild.StandardInput.WriteLine('exit-zero')
  Assert-True ($bindingChild.WaitForExit(5000)) 'Binding fixture did not exit.'
  foreach ($lookup in @([SseObserverContractHandles]::ExitedLookup(), [SseObserverContractHandles]::MissingLookup())) {
    $deadLookup = $bindIdMethod.Invoke($null, [object[]]@($bindingChild.Id,$bindingCreated,$bindingHandle,$lookup))
    Assert-True ($null -eq $deadLookup) 'Pinned exit before managed process lookup stopped discovery.'
  }
  $deadBinding = $bindMethod.Invoke($null, [object[]]@($unboundDead,$bindingCreated,$bindingHandle))
  Assert-True ($null -eq $deadBinding) 'Exit before managed handle binding stopped discovery.'
  $specialChild = Start-OwnedChild
  $specialHandle = $specialChild.Handle
  $specialCreated = [long]$specialChild.StartTime.ToFileTimeUtc()
  $unboundSpecial = [Diagnostics.Process]::GetProcessById($specialChild.Id)
  $invalidProofProcess = [Diagnostics.Process]::GetProcessById($specialChild.Id)
  $specialChild.StandardInput.WriteLine('exit-special')
  Assert-True ($specialChild.WaitForExit(5000) -and $specialChild.ExitCode -eq 259) 'Special exit fixture did not retain its actual exit code.'
  $specialBinding = $bindMethod.Invoke($null, [object[]]@($unboundSpecial,$specialCreated,$specialHandle))
  Assert-True ($null -eq $specialBinding) 'Exit code equal to STILL_ACTIVE was mistaken for a live process.'
  $invalidProofProcess.Dispose()
  $invalidProofError = $null
  try { $null = $bindMethod.Invoke($null, [object[]]@($invalidProofProcess,$specialCreated,[IntPtr]::Zero)) }
  catch { $invalidProofError = $_.Exception.GetBaseException() }
  Assert-True ($invalidProofError -is [ComponentModel.Win32Exception]) 'Unverifiable discovery handle concealed an observation failure.'
  $pendingExitChild = Start-OwnedChild
  $pendingExitHandle = $pendingExitChild.Handle
  $pendingExitBirth = [long]$pendingExitChild.StartTime.ToFileTimeUtc()
  $pendingManaged = [Diagnostics.Process]::GetProcessById($pendingExitChild.Id)
  $pendingManaged.Dispose()
  $pendingTermination = [SseObserverContractHandles]::EndPinnedAfterDelay($pendingExitHandle)
  $pendingBinding = $bindMethod.Invoke($null, [object[]]@($pendingManaged,$pendingExitBirth,$pendingExitHandle))
  Assert-True ($pendingTermination.Wait(5000) -and $pendingExitChild.WaitForExit(5000) -and $null -eq $pendingBinding) 'Managed exit reporting before the pinned signal stopped discovery.'
  $child = Start-OwnedChild
  Assert-True ($child.Id -in [SseLoadWindowObserver]::Descendants($PID,0)) 'Actual owned child was not discovered.'
  Assert-True ($child.Id -notin [SseLoadWindowObserver]::Descendants($PID,$child.Id)) 'Excluded observer root was counted.'
  $entry = [pscustomobject]@{ pid = $child.Id; role = 'mcp-test'; expectedIdentity = (Get-ProcessIdentity $child) }
  Assert-True ($entry.expectedIdentity.imagePathTextSha256 -eq (Get-PathTextHash ([string]$child.Path))) 'Initialized path identity changed.'
  Assert-True ($entry.expectedIdentity.imageNameLower -eq $child.ProcessName.ToLowerInvariant()) 'Initialized image name changed.'
  $first = Measure-OwnedProcess $entry
  Assert-True ($first.alive -and -not $first.sampleError) 'Initial identity-bound sample failed.'
  $pinned = $script:BoundProcesses[[string]$child.Id]
  $retainedHandle = $pinned.Handle
  $script:ForbidLookups = $true
  $child.StandardInput.WriteLine('grow')
  $grown = $child.StandardOutput.ReadLineAsync()
  Assert-True ($grown.Wait(10000) -and $grown.Result -eq 'grown') 'Owned allocation did not complete.'
  $second = Measure-OwnedProcess $entry
  Assert-True ($second.alive -and -not $second.sampleError) 'Refreshed sample failed.'
  Assert-True ($second.workingSetBytes -ge $first.workingSetBytes + 32MB) 'Working set was not refreshed.'
  Assert-True ($second.privateBytes -ge $first.privateBytes + 32MB) 'Private memory was not refreshed.'
  Assert-True ($second.handleCount -ge $first.handleCount + 64) 'Handle count was not refreshed.'
  Assert-True ([object]::ReferenceEquals($pinned, $script:BoundProcesses[[string]$child.Id])) 'Bound object changed.'

  $windowFloor = $script:WindowCalls
  $wrongIdentity = [pscustomobject]@{
    creationTimeUtcTicks = '100000000000000000'; imageNameLower = $entry.expectedIdentity.imageNameLower
    imagePathTextSha256 = $entry.expectedIdentity.imagePathTextSha256
  }
  $wrong = Measure-OwnedProcess ([pscustomobject]@{pid=$child.Id;role='mcp-test';expectedIdentity=$wrongIdentity})
  Assert-True ($wrong.alive -and $wrong.sampleError -eq 'InvalidDataException') 'Stale registration was accepted.'
  Assert-True ($script:WindowCalls -eq $windowFloor) 'Stale registration reached metric getters.'
  $script:WindowFailure = $true
  $failure = Measure-OwnedProcess $entry
  Assert-True ($failure.alive -and $failure.sampleError -eq 'InvalidOperationException') 'Live getter failure was hidden.'
  $script:WindowFailure = $false

  $script:ForbidLookups = $false
  $other = Start-OwnedChild
  $descendant = [pscustomobject]@{pid=$other.Id;role='owned-descendant'}
  $script:DescendantOwned = $false
  $foreign = Measure-OwnedProcess $descendant
  Assert-True ($foreign.sampleError -eq 'InvalidDataException') 'Unconfirmed descendant ownership was accepted.'
  $script:DescendantOwned = $true
  $owned = Measure-OwnedProcess $descendant
  Assert-True ($owned.alive -and -not $owned.sampleError -and $owned.identity) 'Fresh descendant was not bound.'
  Assert-True ($owned.identity.creationTimeUtcTicks -ne $first.identity.creationTimeUtcTicks) 'Generations were conflated.'

  $script:ForbidLookups = $true
  $script:ExitDuringSample = $child
  $exited = Measure-OwnedProcess $entry
  Assert-True (-not $exited.alive -and -not $exited.sampleError) 'Getter/exit race was counted as a live error.'
  $script:ExitDuringSample = $null
  $lookupFloor = $script:LookupCount
  for ($i = 0; $i -lt 20; $i++) {
    $dead = Measure-OwnedProcess $entry
    Assert-True (-not $dead.alive -and -not $dead.sampleError) 'Exited generation became alive.'
  }
  Assert-True ($script:LookupCount -eq $lookupFloor) 'Exited generation was resolved by PID again.'

  $script:ForbidLookups = $false
  $newChild = Start-OwnedChild
  $script:MissingLookupPid = $newChild.Id
  $script:KnownOwned = [ordered]@{}
  $unboundKey = [string]$newChild.Id
  $script:KnownOwned[$unboundKey] = [pscustomobject]@{pid=$newChild.Id;role='owned-descendant'}
  $missing = @(Measure-KnownOwnedProcesses)
  Assert-True ($missing.Count -eq 1 -and $missing[0].alive -eq $false) 'Missing lookup lost its dead observation.'
  Assert-True (-not $script:KnownOwned.Contains($unboundKey)) 'Never-bound exited child retained PID ownership.'
  $script:MissingLookupPid = 0
  $script:ForbidLookups = $true
  $lookupFloor = $script:LookupCount
  Assert-True (@(Measure-KnownOwnedProcesses).Count -eq 0) 'Historical unbound PID was re-observed.'
  Assert-True ($script:LookupCount -eq $lookupFloor) 'Foreign future occupancy caused a historical PID lookup.'
  $script:ForbidLookups = $false
  $script:KnownOwned[$unboundKey] = [pscustomobject]@{pid=$newChild.Id;role='owned-descendant'}
  $rediscovered = @(Measure-KnownOwnedProcesses)
  Assert-True ($rediscovered.Count -eq 1 -and $rediscovered[0].alive -and
    -not $rediscovered[0].sampleError -and $rediscovered[0].identity) 'Fresh owned discovery was not measured.'
  $deadKey = [string]$child.Id
  $script:KnownOwned[$deadKey] = [pscustomobject]@{pid=$child.Id;role='owned-descendant'}
  $null = @(Measure-KnownOwnedProcesses)
  Assert-True ($script:KnownOwned.Contains($deadKey)) 'Bound exited generation was retired before handle cleanup.'
  $script:MissingLookupPid = 2147483000
  $registeredKey = [string]$script:MissingLookupPid
  $script:KnownOwned[$registeredKey] = [pscustomobject]@{pid=$script:MissingLookupPid;role='owned-descendant';expectedIdentity=$entry.expectedIdentity}
  $null = @(Measure-KnownOwnedProcesses)
  Assert-True ($script:KnownOwned.Contains($registeredKey)) 'Registered missing generation lost its expected identity.'
  $script:MissingLookupPid = 0
  $nestedPath = Join-Path $scratch 'nested-child.cjs'
  [IO.File]::WriteAllText($nestedPath, 'setInterval(() => {}, 1000);')
  $parentPath = Join-Path $scratch 'parent.cjs'
  [IO.File]::WriteAllText($parentPath, @'
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const readline = require('node:readline');
process.stdout.write('ready\n');
readline.createInterface({input: process.stdin}).on('line', line => {
  if (line === 'spawn') {
    const child = spawn(process.execPath, [join(__dirname, 'nested-child.cjs')], {stdio: 'ignore', windowsHide: true, detached: true});
    child.unref();
    process.stdout.write(String(child.pid) + '\n');
  } else process.exit(0);
});
'@)
  $parentInfo = New-Object Diagnostics.ProcessStartInfo
  $parentInfo.FileName = $NodeExecutable
  $parentInfo.Arguments = '"' + $parentPath + '"'
  $parentInfo.UseShellExecute = $false
  $parentInfo.CreateNoWindow = $true
  $parentInfo.RedirectStandardInput = $true
  $parentInfo.RedirectStandardOutput = $true
  $parent = [Diagnostics.Process]::Start($parentInfo)
  $null = $children.Add($parent)
  # The child is detached from Node's parent lifetime, but remains inside this
  # fixture job. The parent cannot spawn it before job assignment succeeds.
  $ownedParentJob = [SseObserverContractHandles]::ContainParent($parent.Handle)
  $parentReady = $parent.StandardOutput.ReadLineAsync()
  Assert-True ($parentReady.Wait(10000) -and $parentReady.Result -eq 'ready') 'Owned parent did not become ready.'
  Assert-True ([SseObserverContractHandles]::InsideJob($parent.Handle,$ownedParentJob)) 'Parent escaped its fixture job.'
  Assert-True (-not [SseObserverContractHandles]::InsideJob([IntPtr](-1),$ownedParentJob)) 'Fixture job included the contract owner.'
  $parent.StandardInput.WriteLine('spawn')
  $nestedPidRead = $parent.StandardOutput.ReadLineAsync()
  Assert-True ($nestedPidRead.Wait(10000)) 'Nested child PID was not returned.'
  $nestedPid = [int]$nestedPidRead.Result
  $nested = [Diagnostics.Process]::GetProcessById($nestedPid)
  $null = $children.Add($nested)
  Assert-True ([SseObserverContractHandles]::InsideJob($nested.Handle,$ownedParentJob)) 'Detached child escaped fixture cleanup ownership.'
  $RootPid = $PID
  Discover-OwnedProcesses 0
  $nestedKey = [string]$nestedPid
  Assert-True ($script:BoundProcesses.ContainsKey($nestedKey)) 'Initial discovery did not pin the child.'
  $discoveredProcess = $script:BoundProcesses[$nestedKey]
  $discoveryHandle = $discoveredProcess.Handle
  Assert-True ([object]::ReferenceEquals($discoveredProcess,$script:DiscoveredBindings[$nestedKey])) 'Discovery proof lost its exact process object.'
  $parent.StandardInput.WriteLine('exit')
  Assert-True ($parent.WaitForExit(5000)) 'Owned parent did not exit.'
  Assert-True (-not $nested.HasExited) 'Nested fixture did not survive its parent.'
  Assert-True ($nestedPid -notin [SseLoadWindowObserver]::Descendants($RootPid,0)) 'Fixture retained a discoverable parent edge.'
  $script:DescendantOwned = $false
  $script:ForbidLookups = $true
  $surviving = Measure-OwnedProcess $script:KnownOwned[$nestedKey]
  Assert-True ($surviving.alive -and -not $surviving.sampleError -and $surviving.identity) 'Parent exit invalidated an already pinned discovery.'
  Assert-True ([object]::ReferenceEquals($discoveredProcess,$script:BoundProcesses[$nestedKey])) 'Surviving child changed process bindings.'
  $script:ForbidLookups = $false
  $script:DescendantOwned = $true
  $flags = [uint32]0
  Assert-True ([SseObserverContractHandles]::GetHandleInformation($retainedHandle, [ref]$flags)) 'Handle was released before observation ended.'
  Close-ObservedProcesses
  Assert-True ($script:BoundProcesses.Count -eq 0) 'Observer retained process bindings after cleanup.'
  Assert-True (-not [SseObserverContractHandles]::GetHandleInformation($retainedHandle, [ref]$flags)) 'Cleanup did not close the retained handle.'
  Assert-True ($script:DiscoveredBindings.Count -eq 0) 'Cleanup retained discovery ownership proofs.'
  Assert-True (-not [SseObserverContractHandles]::GetHandleInformation($discoveryHandle,[ref]$flags)) 'Cleanup retained the discovery handle.'
  Close-ObservedProcesses
  '{"passed":true,"checks":54}'
}
finally {
  try {
    if ($ownedParentJob -ne [IntPtr]::Zero) {
      [SseObserverContractHandles]::CloseOwnedJob($ownedParentJob)
      if ($nested) { Assert-True ($nested.WaitForExit(5000)) 'Fixture job did not terminate its surviving child.' }
    }
  }
  finally {
    Close-ObservedProcesses
    foreach ($process in $children) {
      try { if (-not $process.HasExited) { $process.Kill(); $null = $process.WaitForExit(5000) } }
      finally { $process.Dispose() }
    }
    if (-not $scratch.StartsWith($tempRoot + 'sse-observer-contract-', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Owned scratch path escaped its temporary prefix.'
    }
    [IO.Directory]::Delete($scratch, $true)
  }
}
