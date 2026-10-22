# Der schnelle Native-Pfad muss exakt dieselbe Unicode-Kommandozeile wie CIM
# liefern. Nur fehlgeschlagene Native-Abfragen duerfen auf die bestehende
# Win32_Process-Grenze zurueckfallen.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'powershell\load-native.ps1')
$load = Import-SSENativeInterop

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

# Der typisierte Delegate ruft die echte Produktionsfunktion auf, ohne dass
# die Testklasse eine Referenz auf die geladene Interop-Assembly benoetigt.
# Beide Handle-Stichproben und alle Reads laufen ohne PowerShell-Dispatch.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;

public sealed class SSECommandLineHandleBatch
{
    public uint Before;
    public uint After;
    public int NativeCalls;
    public int InjectedHandles;
    public int ClosedInjectedHandles;
    public long Growth { get { return (long)After - Before; } }
    public bool WithinBudget { get { return Growth <= SSECommandLineHandleContract.MaximumHandleGrowth; } }
}

public static class SSECommandLineHandleContract
{
    public const int MaximumHandleGrowth = 2;
    private const int BatchSize = 500;
    private const int InjectionInterval = 100;
    private const uint ProcessQueryLimitedInformation = 0x1000;

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessHandleCount(IntPtr process, out uint count);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    private static uint CountHandles(IntPtr process)
    {
        uint count;
        if (!GetProcessHandleCount(process, out count))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Handle-Anzahl konnte nicht gelesen werden.");
        return count;
    }

    public static SSECommandLineHandleBatch Measure(Func<int, string> read, int processId, string expected, bool injectHandles)
    {
        if (read == null) throw new ArgumentNullException("read");
        if (processId <= 0) throw new ArgumentOutOfRangeException("processId");
        if (expected == null) throw new ArgumentNullException("expected");
        var result = new SSECommandLineHandleBatch();
        var injected = new IntPtr[BatchSize / InjectionInterval];
        var cleanupErrors = new List<Exception>();
        Exception primaryError = null;
        // GetCurrentProcess liefert ein Pseudo-Handle, das nicht geschlossen wird.
        IntPtr observer = GetCurrentProcess();
        result.Before = CountHandles(observer);
        try
        {
            for (int iteration = 1; iteration <= BatchSize; iteration++)
            {
                string actual = read(processId);
                result.NativeCalls++;
                if (!string.Equals(actual, expected, StringComparison.Ordinal))
                    throw new InvalidOperationException("Native Wiederholungsabfrage " + iteration + " verlor die exakte Kommandozeile.");
                if (injectHandles && iteration % InjectionInterval == 0)
                {
                    IntPtr handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
                    if (handle == IntPtr.Zero)
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "Negativkontrolle konnte kein Prozess-Handle oeffnen.");
                    injected[result.InjectedHandles++] = handle;
                }
            }
            // Die fuenf Kontroll-Handles bleiben bis nach dieser Stichprobe offen.
            result.After = CountHandles(observer);
        }
        catch (Exception error)
        {
            primaryError = error;
        }
        finally
        {
            for (int index = 0; index < result.InjectedHandles; index++)
            {
                try
                {
                    if (!CloseHandle(injected[index]))
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "Negativkontrolle konnte ein eigenes Handle nicht schliessen.");
                    result.ClosedInjectedHandles++;
                }
                catch (Exception error) { cleanupErrors.Add(error); }
            }
        }
        if (cleanupErrors.Count != 0)
        {
            if (primaryError != null) cleanupErrors.Insert(0, primaryError);
            throw new AggregateException("Handle-Messung oder eigenes Handle-Cleanup fehlgeschlagen.", cleanupErrors);
        }
        if (primaryError != null) ExceptionDispatchInfo.Capture(primaryError).Throw();
        return result;
    }
}
'@
$nativeMethod = [SSEProcessCommandLine].GetMethod('TryGet', [type[]]@([int]))
$nativeReader = [Delegate]::CreateDelegate([Func[int,string]], $nativeMethod)

Assert-True ($load.mode -in @('precompiled-dll', 'source-fallback', 'already-loaded')) `
  "Nativer Interop-Loader meldete einen unbekannten Modus '$($load.mode)'."

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$nonBmp = [char]::ConvertFromUtf32(0x1F9FE)
$unicodeArgument = "C:\Probe Folder\Steuerf$([char]0x00E4)lle $([char]0x00C4) $([char]0x00D6) $nonBmp.txt"
$processInfo = New-Object Diagnostics.ProcessStartInfo
$processInfo.FileName = $powershell
$processInfo.Arguments = '-NoLogo -NoProfile -NonInteractive -Command "& { param([string]$Probe) Start-Sleep -Seconds 30 } ''' + $unicodeArgument + '''"'
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$child = [Diagnostics.Process]::Start($processInfo)
try {
  $nativeCommandLine = [SSEProcessCommandLine]::TryGet($child.Id)
  Assert-True ($null -ne $nativeCommandLine) 'Der Native-Pfad konnte den harmlosen Kindprozess nicht lesen.'
  Assert-True ($nativeCommandLine.Contains($unicodeArgument)) 'Die native Kommandozeile verlor Unicode oder Leerzeichen.'

  # Vor CIM werden beide C#-Pfade samt P/Invokes aufgewarmt. Die eigentliche
  # Stichprobe enthaelt nur den typisierten Produktionsaufruf und den Vergleich.
  $null = [SSECommandLineHandleContract]::Measure($nativeReader, $child.Id, $nativeCommandLine, $false)
  $null = [SSECommandLineHandleContract]::Measure($nativeReader, $child.Id, $nativeCommandLine, $true)
  $nativeTimer = [Diagnostics.Stopwatch]::StartNew()
  $nativeBatch = [SSECommandLineHandleContract]::Measure($nativeReader, $child.Id, $nativeCommandLine, $false)
  $nativeTimer.Stop()
  Assert-True ($nativeBatch.NativeCalls -eq 500 -and $nativeBatch.WithinBudget) `
    "Native Wiederholungsabfragen liessen Prozess-Handles wachsen ($($nativeBatch.Before) -> $($nativeBatch.After))."

  # Dieselbe Grenze muss fuenf absichtlich bis zur Stichprobe offene Handles
  # erkennen. Measure schliesst jedes davon im finally und prueft das Ergebnis.
  $leakControl = [SSECommandLineHandleContract]::Measure($nativeReader, $child.Id, $nativeCommandLine, $true)
  Assert-True ($leakControl.NativeCalls -eq 500 -and
    $leakControl.InjectedHandles -eq 5 -and $leakControl.ClosedInjectedHandles -eq 5) `
    'Die Negativkontrolle hat nicht exakt fuenf eigene Prozess-Handles geoeffnet und geschlossen.'
  Assert-True (-not $leakControl.WithinBudget) `
    "Die unveraenderte Handle-Grenze erkannte fuenf offene Kontroll-Handles nicht ($($leakControl.Before) -> $($leakControl.After))."

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  $cimCommandLine = $null
  do {
    $cimCommandLine = [string](Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Id)" -ErrorAction Stop).CommandLine
    if (-not $cimCommandLine) { Start-Sleep -Milliseconds 25 }
  } while (-not $cimCommandLine -and [DateTime]::UtcNow -lt $deadline)
  Assert-True ([bool]$cimCommandLine) 'CIM lieferte fuer den harmlosen Kindprozess keine Kommandozeile.'
  Assert-True ($cimCommandLine.Contains($unicodeArgument)) 'Die Referenzkommandozeile verlor Unicode oder Leerzeichen.'
  Assert-True ($nativeCommandLine -ceq $cimCommandLine) 'Native- und CIM-Kommandozeile weichen byteinhaltlich ab.'

  $cimTimer = [Diagnostics.Stopwatch]::StartNew()
  foreach ($iteration in 1..3) {
    $null = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Id)" -ErrorAction Stop
  }
  $cimTimer.Stop()
} finally {
  if ($child -and -not $child.HasExited) { $child.Kill() }
  if ($child) {
    $child.WaitForExit()
    $child.Dispose()
  }
}

Assert-True ($null -eq [SSEProcessCommandLine]::TryGet(-1)) 'Negative PID blieb nicht null.'
Assert-True ($null -eq [SSEProcessCommandLine]::TryGet(2147483647)) 'Ungueltige PID blieb nicht null.'

# Die Produktionsfunktionen werden aus dem Worker extrahiert, damit die
# Fallback-Policy ohne Start einer SteuerSparErklaerung deterministisch bleibt.
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "Worker-Parserfehler: $($parseErrors[0].Message)" }
foreach ($name in @(
  'Get-CasePathFromCommandLineText',
  'Get-SSENativeProcessCommandLine',
  'Get-SSECommandLinesForProcessIds',
  'Get-CasePathFromCommandLine'
)) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  Assert-True ($definition.Count -eq 1) "Funktion $name ist nicht eindeutig vorhanden."
  Invoke-Expression $definition[0].Extent.Text
}

$script:NativeCalls = New-Object System.Collections.ArrayList
$script:CimCalls = New-Object System.Collections.ArrayList
$script:NativeResults = @{
  1001 = 'native command one'
  1002 = $null
  1003 = ''
}
function Get-SSENativeProcessCommandLine([int]$ProcessId) {
  $null = $script:NativeCalls.Add($ProcessId)
  if ($script:NativeResults.ContainsKey($ProcessId)) { return $script:NativeResults[$ProcessId] }
  $null
}
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter, $ErrorAction)
  $null = $script:CimCalls.Add($Filter)
  if ($Filter -eq 'ProcessId=1002') {
    return [pscustomobject]@{ ProcessId = 1002; CommandLine = 'cim command two' }
  }
  if ($Filter -eq 'ProcessId=1003') {
    return [pscustomobject]@{ ProcessId = 1003; CommandLine = 'cim command three' }
  }
  if ($Filter -eq 'ProcessId=2002') {
    return [pscustomobject]@{
      ProcessId = 2002
      CommandLine = '"C:\Program Files\SSE\SSE.exe" "C:\Cases\Unicode Fall.ESt2025"'
    }
  }
  if ($Filter -eq 'ProcessId=2004') {
    return [pscustomobject]@{
      ProcessId = 2004
      CommandLine = '"C:\Program Files\SSE\SSE.exe" "C:\Cases\Empty Native Fall.ESt2025"'
    }
  }
  $null
}
function Test-SSEProfileCaseFileName([string]$Path, [bool]$AllowFullPath) {
  $Path -match '\.ESt2025$'
}

$batch = Get-SSECommandLinesForProcessIds ([int[]]@(1002, 1001, 1001, 0, -7))
Assert-True ($script:NativeCalls.Count -eq 2) 'Doppelte oder ungueltige PIDs wurden nativ mehrfach beziehungsweise ueberhaupt abgefragt.'
Assert-True (@($script:NativeCalls | Sort-Object).Count -eq 2 -and
  @($script:NativeCalls | Sort-Object)[0] -eq 1001 -and @($script:NativeCalls | Sort-Object)[1] -eq 1002) `
  'Der Native-Batch fragte nicht exakt die eindeutigen positiven PIDs ab.'
Assert-True ($script:CimCalls.Count -eq 1 -and $script:CimCalls[0] -ceq 'ProcessId=1002') `
  'Der Batch-CIM-Fallback enthielt nicht exakt die fehlgeschlagene PID.'
Assert-True ($batch.Count -eq 2 -and $batch[1001] -ceq 'native command one' -and $batch[1002] -ceq 'cim command two') `
  'Native- und CIM-Batchergebnisse wurden nicht unveraendert zusammengefuehrt.'

$script:NativeCalls.Clear()
$script:CimCalls.Clear()
$emptyBatch = Get-SSECommandLinesForProcessIds ([int[]]@(1003))
Assert-True ($script:CimCalls.Count -eq 1 -and $script:CimCalls[0] -ceq 'ProcessId=1003' -and
  $emptyBatch[1003] -ceq 'cim command three') `
  'Leere Native-Kommandozeile unterdrueckte den CIM-Batch-Fallback.'

$script:NativeCalls.Clear()
$script:CimCalls.Clear()
$script:NativeResults[2001] = '"C:\Program Files\SSE\SSE.exe" "C:\Cases\Native Fall.ESt2025"'
$nativePath = Get-CasePathFromCommandLine 2001
Assert-True ($nativePath -ceq 'C:\Cases\Native Fall.ESt2025' -and $script:CimCalls.Count -eq 0) `
  'Erfolgreiche Einzelabfrage nutzte CIM oder veraenderte die Pfadauswertung.'

$script:NativeResults[2002] = $null
$cimPath = Get-CasePathFromCommandLine 2002
Assert-True ($cimPath -ceq 'C:\Cases\Unicode Fall.ESt2025' -and
  $script:CimCalls.Count -eq 1 -and $script:CimCalls[0] -ceq 'ProcessId=2002') `
  'Fehlgeschlagene Einzelabfrage behielt den exakten CIM-Fallback nicht bei.'

$script:NativeResults[2004] = ''
$emptyNativePath = Get-CasePathFromCommandLine 2004
Assert-True ($emptyNativePath -ceq 'C:\Cases\Empty Native Fall.ESt2025' -and
  $script:CimCalls.Count -eq 2 -and $script:CimCalls[1] -ceq 'ProcessId=2004') `
  'Leere Native-Kommandozeile unterdrueckte den CIM-Einzelfallback.'

$script:NativeResults[2003] = $null
$missingPath = Get-CasePathFromCommandLine 2003
Assert-True ($null -eq $missingPath) 'Fehlender Prozess verlor sein bestehendes null-Verhalten.'

$script:CimCalls.Clear()
function Get-SSENativeProcessCommandLine([int]$ProcessId) { throw 'deterministischer Native-Fehler' }
$thrownFallbackPath = Get-CasePathFromCommandLine 2002
Assert-True ($thrownFallbackPath -ceq 'C:\Cases\Unicode Fall.ESt2025' -and
  $script:CimCalls.Count -eq 1 -and $script:CimCalls[0] -ceq 'ProcessId=2002') `
  'Native-Ausnahme behielt den exakten CIM-Fallback nicht bei.'

$script:CimCalls.Clear()
$thrownBatch = Get-SSECommandLinesForProcessIds ([int[]]@(1002, 1002))
Assert-True ($script:CimCalls.Count -eq 1 -and $script:CimCalls[0] -ceq 'ProcessId=1002' -and
  $thrownBatch[1002] -ceq 'cim command two') `
  'Native-Ausnahme im Batch behielt weder Deduplizierung noch CIM-Fallback bei.'

$nativeMicroseconds = [Math]::Round(($nativeTimer.Elapsed.TotalMilliseconds * 1000) / 500, 1)
$cimMilliseconds = [Math]::Round($cimTimer.Elapsed.TotalMilliseconds / 3, 1)
Write-Output "OK: Native CommandLine Unicode-/Fallback-/Handle-Vertrag (native ~${nativeMicroseconds}us, CIM ~${cimMilliseconds}ms je Abfrage)."
