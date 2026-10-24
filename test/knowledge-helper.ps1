# Opt-in live-test census and normal close; never used by the API runtime.
param([ValidateSet('census','close')][string]$Mode='census',[string]$IdentityFile='')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot '../powershell/load-native.ps1')
$null=Import-SSENativeInterop
$script:hashes=@{}
function Describe-Process($Process) {
 $Process.Refresh()
 $path=[string]$Process.Path
 if(-not $script:hashes.ContainsKey($path)){
  $hasher=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($path)
  try{$script:hashes[$path]=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$stream.Dispose();$hasher.Dispose()}
 }
 [pscustomobject]@{pid=$Process.Id;hwnd=[int64]$Process.MainWindowHandle;title=$Process.MainWindowTitle;
  startedTicks=$Process.StartTime.ToUniversalTime().Ticks.ToString();path=$path;
  exeSha256=$script:hashes[$path];productVersion=(Get-Item -LiteralPath $path).VersionInfo.ProductVersion}
}
if($Mode -eq 'census'){
 $processes=@(Get-Process -Name SSE,SteuerBerater -ErrorAction SilentlyContinue)
 if($processes.Count -gt 64){foreach($process in $processes){$process.Dispose()};throw 'Live-test process census exceeds its limit.'}
 $records=@(foreach($process in $processes){try{Describe-Process $process}finally{$process.Dispose()}})
 ConvertTo-Json -InputObject $records -Depth 5 -Compress
 exit 0
}
$expected=Get-Content -Raw -LiteralPath $IdentityFile|ConvertFrom-Json
if($expected.ownershipProved -isnot [bool] -or -not $expected.ownershipProved -or
   $expected.ownershipKind -cne 'verified-windows-job' -or $expected.membership.member -ne $true -or
   $expected.membership.pid -ne $expected.pid -or $expected.pid -eq $PID -or
   [IO.Path]::GetFileName([string]$expected.path) -ine 'SteuerBerater.exe') {throw 'No exact job-bound helper cleanup authority.'}
$process=Get-Process -Id ([int]$expected.pid) -ErrorAction Stop
try{
 $current=Describe-Process $process
 $windowPid=[uint32]0;$null=[SW]::GetWindowThreadProcessId([IntPtr]$expected.hwnd,[ref]$windowPid)
 if($current.startedTicks -cne $expected.startedTicks -or $current.path -ine $expected.path -or
    $current.hwnd -ne $expected.hwnd -or $current.exeSha256 -cne $expected.exeSha256 -or
    $current.title -cne 'Steuerwissen' -or $windowPid -ne $expected.pid) {throw 'The exact helper lifetime/window changed.'}
 if(-not [SW]::PostMessage([IntPtr]$expected.hwnd,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Own WM_CLOSE was not accepted.'}
 if(-not $process.WaitForExit(20000)){throw 'Own helper did not close normally; no forced termination.'}
 @{normalExit=$true;pid=$expected.pid;killed=$false}|ConvertTo-Json -Compress
}finally{$process.Dispose()}
