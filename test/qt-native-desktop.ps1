param(
    [Parameter(Mandatory=$true)][string]$PackageConfig,
    [Parameter(Mandatory=$true)][string]$Fixture,
    [Parameter(Mandatory=$true)][string]$QtBin,
    [string]$NodeExecutable = 'node'
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node = (Get-Command $NodeExecutable -CommandType Application).Source
$script = Join-Path $PSScriptRoot 'qt-native-integration.mjs'
$paths = @($PackageConfig,$Fixture,$QtBin,$node,$script)
foreach($path in $paths){
    if(-not [IO.Path]::IsPathRooted($path) -or $path.Contains('"') -or -not (Test-Path -LiteralPath $path)){
        throw 'Native test requires existing absolute paths without quote characters'
    }
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -Path (Join-Path $repository 'powershell\sse-native.dll')
$name = 'SSEQtNativeTest_' + $PID
$desktop = [DSK]::CreateDesktop($name,[IntPtr]::Zero,[IntPtr]::Zero,0,0x10000000,[IntPtr]::Zero)
if($desktop -eq [IntPtr]::Zero){throw 'Could not create the isolated Qt test desktop'}
$startup = New-Object DSK+SI
$startup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
$startup.desktop = 'winsta0\' + $name
$startup.flags = 1
$startup.show = 0
$processInfo = New-Object DSK+PI
$report = Join-Path ([IO.Path]::GetTempPath()) ('sse-qt-native-' + [Guid]::NewGuid().ToString('N') + '.json')
$command = [Text.StringBuilder]::new(('"{0}" "{1}" "{2}" "{3}" "{4}" "{5}" "{6}"' -f $node,$script,$PackageConfig,$Fixture,$QtBin,$name,$report))
try {
    if(-not [DSK]::CreateProcess($node,$command,[IntPtr]::Zero,[IntPtr]::Zero,$false,0x08000000,[IntPtr]::Zero,$repository,[ref]$startup,[ref]$processInfo)){
        throw 'Could not start the owned native integration test'
    }
    [DSK]::CloseHandle($processInfo.hThread) | Out-Null
    if([DSK]::WaitForSingleObject($processInfo.hProcess,55000) -eq 258){
        [DSK]::TerminateProcess($processInfo.hProcess,1) | Out-Null
        [DSK]::WaitForSingleObject($processInfo.hProcess,3000) | Out-Null
        throw 'Owned native integration test exceeded its deadline'
    }
    [uint32]$code = 0
    if(-not [DSK]::GetExitCodeProcess($processInfo.hProcess,[ref]$code)){throw 'Native test exit status unavailable'}
    if(-not (Test-Path -LiteralPath $report)){throw ('Native test produced no result; exit code ' + $code)}
    Get-Content -LiteralPath $report -Raw
    Write-Output ('Native Qt integration test exit code: ' + $code)
    exit $code
} finally {
    if($processInfo.hProcess -ne [IntPtr]::Zero){[DSK]::CloseHandle($processInfo.hProcess) | Out-Null}
    [DSK]::CloseDesktop($desktop) | Out-Null
    if(Test-Path -LiteralPath $report){Remove-Item -LiteralPath $report}
}
