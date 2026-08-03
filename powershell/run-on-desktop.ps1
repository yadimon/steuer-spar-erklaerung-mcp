<#
================================================================================
 run-on-desktop.ps1 - startet sse-worker.ps1 auf einem eigenen Desktop-Objekt
================================================================================
 WARUM: Ein Fenster auf einem eigenen Desktop kann auf dem sichtbaren Desktop
 nicht erscheinen. Damit laesst sich die SteuerSparErklaerung fernsteuern,
 ohne den Nutzer bei der Arbeit zu unterbrechen.

 WARUM SO UMSTAENDLICH: SetThreadDesktop nachtraeglich aufzurufen scheitert
 mit Fehler 170 (ERROR_BUSY), sobald der Thread schon ein Fenster besitzt -
 und PowerShell hat beim Start eines. Der Arbeiter muss deshalb GLEICH auf
 dem Zieldesktop geboren werden, ueber CreateProcess mit lpDesktop.

 Die Standardausgabe kommt ueber die Desktop-Grenze nicht zurueck, deshalb
 schreibt der Arbeiter sein JSON in eine Datei (-OutFile), die hier gelesen
 und weitergereicht wird.
================================================================================
#>
param(
  [Parameter(Mandatory)][string]$Op,
  [string]$B64 = '',
  [string]$Desktop = 'SSEAuto',
  [int]$TimeoutSec = 180
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

# Diese Werte werden normalerweise nur von der validierten Node-API erzeugt.
# Der Launcher bleibt trotzdem auch bei einem direkten Aufruf fail-closed,
# bevor er eine native Assembly laedt oder eine Kommandozeile zusammensetzt.
if ($Op -notmatch '^[A-Za-z0-9_-]{1,64}$') {
  Write-Output (@{ ok=$false; kind='bad-args'; error='Ungueltiger Worker-Operationsname.' } | ConvertTo-Json -Compress)
  exit 1
}
if ($B64 -and $B64 -notmatch '^[A-Za-z0-9+/]*={0,2}$') {
  Write-Output (@{ ok=$false; kind='bad-args'; error='Worker-Argument ist kein Base64-Text.' } | ConvertTo-Json -Compress)
  exit 1
}
if ($Desktop -notmatch '^[A-Za-z0-9_-]{1,64}$') {
  Write-Output (@{ ok=$false; kind='bad-args'; error='Ungueltiger Desktopname.' } | ConvertTo-Json -Compress)
  exit 1
}

$nativeLoaderPath = Join-Path $PSScriptRoot 'load-native.ps1'
if (-not (Test-Path -LiteralPath $nativeLoaderPath -PathType Leaf)) {
  Write-Output (@{ ok=$false; kind='worker-init'; error="Nativer Interop-Loader fehlt: $nativeLoaderPath" } | ConvertTo-Json -Compress)
  exit 1
}
. $nativeLoaderPath
try { $launcherNativeLoad = Import-SSENativeInterop -ForceSource:($env:SSE_MCP_FORCE_NATIVE_SOURCE -eq '1') }
catch {
  Write-Output (@{ ok=$false; kind='worker-init'; error="Nativer Launcher-Interop-Start scheiterte: $($_.Exception.Message)" } | ConvertTo-Json -Compress)
  exit 1
}

$worker = Join-Path $PSScriptRoot 'sse-worker.ps1'
$aus = Join-Path $env:TEMP ("sse-out-" + [Guid]::NewGuid().ToString('N') + ".json")
try {
$pwshExe = $(if ($env:SSE_POWERSHELL_EXE) { $env:SSE_POWERSHELL_EXE }
             else { "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" })
if (-not (Test-Path -LiteralPath $pwshExe -PathType Leaf) -or
    [IO.Path]::GetFileName($pwshExe) -ine 'powershell.exe') {
  Write-Output (@{ ok=$false; kind='worker-init'; error='Windows PowerShell wurde nicht gefunden.' } | ConvertTo-Json -Compress)
  exit 1
}

$cmd = New-Object Text.StringBuilder 4096
$null = $cmd.Append('"' + $pwshExe + '" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $worker + '"')
$null = $cmd.Append(' -Op "' + $Op + '"')
if ($B64) { $null = $cmd.Append(' -B64 "' + $B64 + '"') }
$null = $cmd.Append(' -OutFile "' + $aus + '"')

$si = New-Object DSK+SI
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][DSK+SI])
$si.desktop = "WinSta0\$Desktop"
$si.flags = 0x00000001      # STARTF_USESHOWWINDOW
$si.show  = 0               # SW_HIDE
$pi = New-Object DSK+PI
$job = [DSK]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) {
  $e = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Output (@{ ok = $false; kind = 'job'; error = "Worker-Jobobjekt liess sich nicht anlegen (Win32-Fehler $e)" } | ConvertTo-Json -Compress)
  exit 1
}
$jobBasic = New-Object DSK+JOBOBJECT_BASIC_LIMIT_INFORMATION
$jobBasic.LimitFlags = 0x00002000 # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
$jobInfo = New-Object DSK+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
$jobInfo.BasicLimitInformation = $jobBasic
$jobInfoSize = [Runtime.InteropServices.Marshal]::SizeOf([type][DSK+JOBOBJECT_EXTENDED_LIMIT_INFORMATION])
if (-not [DSK]::SetInformationJobObject($job, 9, [ref]$jobInfo, [uint32]$jobInfoSize)) {
  $e = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  [DSK]::CloseHandle($job) | Out-Null
  Write-Output (@{ ok = $false; kind = 'job'; error = "Worker-Jobobjekt liess sich nicht absichern (Win32-Fehler $e)" } | ConvertTo-Json -Compress)
  exit 1
}

$ok = [DSK]::CreateProcess($pwshExe, $cmd, [IntPtr]::Zero, [IntPtr]::Zero, $false,
        0x00000014, [IntPtr]::Zero, $PSScriptRoot, [ref]$si, [ref]$pi)   # CREATE_NEW_CONSOLE | CREATE_SUSPENDED
if (-not $ok) {
  $e = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  [DSK]::CloseHandle($job) | Out-Null
  Write-Output (@{ ok = $false; kind = 'launch'; error = "Arbeiter liess sich auf Desktop '$Desktop' nicht starten (Win32-Fehler $e)" } | ConvertTo-Json -Compress)
  exit 1
}
if (-not [DSK]::AssignProcessToJobObject($job, $pi.hProcess)) {
  $e = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  [DSK]::TerminateProcess($pi.hProcess, 1) | Out-Null
  [DSK]::WaitForSingleObject($pi.hProcess, 5000) | Out-Null
  [DSK]::CloseHandle($pi.hProcess) | Out-Null
  [DSK]::CloseHandle($pi.hThread) | Out-Null
  [DSK]::CloseHandle($job) | Out-Null
  Write-Output (@{ ok = $false; kind = 'job'; error = "Arbeiter liess sich nicht dem Kill-on-close-Job zuordnen (Win32-Fehler $e)" } | ConvertTo-Json -Compress)
  exit 1
}
if ([DSK]::ResumeThread($pi.hThread) -eq [uint32]::MaxValue) {
  $e = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  [DSK]::TerminateProcess($pi.hProcess, 1) | Out-Null
  [DSK]::WaitForSingleObject($pi.hProcess, 5000) | Out-Null
  [DSK]::CloseHandle($pi.hProcess) | Out-Null
  [DSK]::CloseHandle($pi.hThread) | Out-Null
  [DSK]::CloseHandle($job) | Out-Null
  Write-Output (@{ ok = $false; kind = 'launch'; error = "Worker-Thread liess sich nicht fortsetzen (Win32-Fehler $e)" } | ConvertTo-Json -Compress)
  exit 1
}

$rc = [DSK]::WaitForSingleObject($pi.hProcess, [uint32]($TimeoutSec * 1000))
if ($rc -ne 0) {
  [DSK]::TerminateProcess($pi.hProcess, 1) | Out-Null
  [DSK]::CloseHandle($job) | Out-Null
  [DSK]::WaitForSingleObject($pi.hProcess, 5000) | Out-Null
  [DSK]::CloseHandle($pi.hProcess) | Out-Null
  [DSK]::CloseHandle($pi.hThread) | Out-Null
  Write-Output (@{ ok = $false; kind = 'timeout'; error = "Arbeiter '$Op' ueberschritt $TimeoutSec s auf Desktop '$Desktop'" } | ConvertTo-Json -Compress)
  exit 1
}
$workerExit = [uint32]0
[DSK]::GetExitCodeProcess($pi.hProcess, [ref]$workerExit) | Out-Null
[DSK]::CloseHandle($job) | Out-Null
[DSK]::CloseHandle($pi.hProcess) | Out-Null
[DSK]::CloseHandle($pi.hThread) | Out-Null

if (Test-Path -LiteralPath $aus) {
  $txt = [IO.File]::ReadAllText($aus, [Text.Encoding]::UTF8)
  if ($txt.Trim()) { Write-Output $txt; exit 0 }
}
Write-Output (@{
  ok = $false; kind = 'empty'; workerExitCode = $workerExit
  error = "Arbeiter '$Op' lieferte keine Ausgabe (Desktop '$Desktop', Exit $workerExit)"
} | ConvertTo-Json -Compress)
exit 1
} finally {
  # Auch ein Timeout oder ein abgebrochener/teilweise schreibender Worker darf
  # keine Fall- oder Diagnoseantwort im globalen Temp-Ordner hinterlassen.
  if (Test-Path -LiteralPath $aus) {
    Remove-Item -LiteralPath $aus -Force -ErrorAction SilentlyContinue
  }
}
