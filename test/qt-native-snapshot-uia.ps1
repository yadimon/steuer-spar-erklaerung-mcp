param([Parameter(Mandatory=$true)][long]$Hwnd, [Parameter(Mandatory=$true)][string]$OutputPath, [string]$Desktop)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -Path (Join-Path $PSScriptRoot '..\powershell\sse-native.dll')
if ($Desktop) {
    if ($Desktop -notmatch '^SSEQtNativeTest_[0-9]+$' -or $OutputPath.Contains('"') -or $PSCommandPath.Contains('"')) {
        throw 'Invalid owned UIA probe arguments'
    }
    $startup = New-Object DSK+SI
    $startup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
    $startup.desktop = 'winsta0\' + $Desktop
    $startup.flags = 1
    $startup.show = 0
    $processInfo = New-Object DSK+PI
    $executable = Join-Path $PSHOME 'powershell.exe'
    $command = [Text.StringBuilder]::new(('"{0}" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{1}" -Hwnd {2} -OutputPath "{3}"' -f
        $executable,$PSCommandPath,$Hwnd,$OutputPath))
    if (-not [DSK]::CreateProcess($executable,$command,[IntPtr]::Zero,[IntPtr]::Zero,$false,0x08000000,
        [IntPtr]::Zero,$PSScriptRoot,[ref]$startup,[ref]$processInfo)) { throw 'Could not launch the owned UIA probe' }
    [DSK]::CloseHandle($processInfo.hThread) | Out-Null
    try {
        if ([DSK]::WaitForSingleObject($processInfo.hProcess,28000) -eq 258) {
            [DSK]::TerminateProcess($processInfo.hProcess,1) | Out-Null
            throw 'Owned UIA probe exceeded its deadline'
        }
        [uint32]$code = 0
        if (-not [DSK]::GetExitCodeProcess($processInfo.hProcess,[ref]$code) -or $code -ne 0) { throw 'Owned UIA probe failed' }
    } finally { [DSK]::CloseHandle($processInfo.hProcess) | Out-Null }
    return
}
# Match the worker's proxy-free UIA initialization before entering compiled tree traversal.
$null = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
$snapshot = [SSEUiaTree]::Describe([IntPtr]$Hwnd,5000,25000,16,$true,$false)
$nodes = [SSEUiaTree]::ToViews($snapshot.Nodes,$null)
[IO.File]::WriteAllText($OutputPath,(ConvertTo-Json -InputObject @($nodes) -Depth 8),[Text.UTF8Encoding]::new($false))
$rectangle = New-Object SW+RC
if (-not [SW]::GetWindowRect([IntPtr]$Hwnd,[ref]$rectangle)) { throw 'Cannot read fixture window rectangle' }
$rect = @{ x=$rectangle.L; y=$rectangle.T; w=($rectangle.R-$rectangle.L); h=($rectangle.B-$rectangle.T) }
[IO.File]::WriteAllText(($OutputPath + '.window.json'),(ConvertTo-Json $rect),[Text.UTF8Encoding]::new($false))
