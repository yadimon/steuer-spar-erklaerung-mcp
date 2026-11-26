# Host-Stellvertreter fuer test/worker-prewarm-placement-contract.ps1.
#
# Ein frischer Prozess ohne ausdruecklichen Drosselzustand - so wie der
# API-Prozess, der seine Arbeiter startet. Er liest den eigenen Zustand, laesst
# einen Arbeiter-Stellvertreter laufen und liest den Zustand danach erneut. Der
# Zustand wird nicht vererbt; was sich aendert, hat also der Arbeiter bewirkt.
param(
  [Parameter(Mandatory)][string]$Root,
  [Parameter(Mandatory)][int]$ForeignProcessId
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SSEPowerThrottlingProbe
{
    [StructLayout(LayoutKind.Sequential)]
    private struct State { public uint Version, ControlMask, StateMask; }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessInformation(IntPtr process, int informationClass, ref State state, int size);

    // "lesbar:<ControlMask>/<StateMask>" des eigenen ausdruecklichen Zustands; ProcessPowerThrottling = 4.
    // Aeltere Systeme nehmen die Bitte an, kennen aber die Abfrage nicht: dann "nicht-lesbar".
    public static string Read()
    {
        var state = new State();
        state.Version = 1;
        if (!GetProcessInformation(GetCurrentProcess(), 4, ref state, Marshal.SizeOf(typeof(State))))
            return "nicht-lesbar";
        return "lesbar:" + state.ControlMask + "/" + state.StateMask;
    }
}
'@

$before = [SSEPowerThrottlingProbe]::Read()
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$start.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
  (Join-Path $PSScriptRoot 'power-throttling-worker.ps1') + '" -Root "' + $Root + '" -HostProcessId ' + $PID +
  ' -ForeignProcessId ' + $ForeignProcessId
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$worker = [Diagnostics.Process]::Start($start)
try {
  $workerErrors = $worker.StandardError.ReadToEndAsync()
  $workerOutput = $worker.StandardOutput.ReadToEnd()
  $worker.WaitForExit()
  if ($worker.ExitCode -ne 0) { throw "Arbeiter-Stellvertreter scheiterte: $($workerErrors.Result)" }
} finally {
  $worker.Dispose()
}
$after = [SSEPowerThrottlingProbe]::Read()

[Console]::Out.Write(([pscustomobject]@{
  before = $before
  worker = ($workerOutput | ConvertFrom-Json)
  after = $after
} | ConvertTo-Json -Compress -Depth 4))
