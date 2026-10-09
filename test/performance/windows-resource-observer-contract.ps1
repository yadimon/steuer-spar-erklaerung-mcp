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
    'Get-ObservedProcess', 'Close-ObservedProcesses', 'Measure-OwnedProcess', 'Measure-KnownOwnedProcesses')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definitions.Count -ne 1) { throw "Observer function is not unique: $name" }
  Invoke-Expression $definitions[0].Extent.Text
}

$script:BoundProcesses = @{}
$script:BoundIdentity = @{}
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
});
process.stdout.write('ready\n');
'@)
$children = New-Object Collections.ArrayList
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
  $flags = [uint32]0
  Assert-True ([SseObserverContractHandles]::GetHandleInformation($retainedHandle, [ref]$flags)) 'Handle was released before observation ended.'
  Close-ObservedProcesses
  Assert-True ($script:BoundProcesses.Count -eq 0) 'Observer retained process bindings after cleanup.'
  Assert-True (-not [SseObserverContractHandles]::GetHandleInformation($retainedHandle, [ref]$flags)) 'Cleanup did not close the retained handle.'
  Close-ObservedProcesses
  '{"passed":true,"checks":30}'
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
