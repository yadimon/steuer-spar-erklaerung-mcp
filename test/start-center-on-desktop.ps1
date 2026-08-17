param(
  [string]$ProfileId = '2025',
  [Parameter(Mandatory)][string]$Desktop,
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$desktopHandle = [IntPtr]::Zero
$jobHandle = [IntPtr]::Zero
$processHandle = [IntPtr]::Zero
$threadHandle = [IntPtr]::Zero
$mainHwnd = [IntPtr]::Zero
$ready = $false
$assignedToJob = $false
$exitCode = 1

try {
  if ($ProfileId -ne '2025' -or $Desktop -notmatch '^[A-Za-z0-9_-]{1,64}$') {
    throw 'Ungueltige Center-Testparameter.'
  }
  $profilePath = Join-Path $PSScriptRoot "..\profiles\$ProfileId\profile.json"
  $productProfile = [IO.File]::ReadAllText($profilePath, (New-Object Text.UTF8Encoding($false, $true))) | ConvertFrom-Json
  $centerExe = Join-Path $env:ProgramFiles (
    'Steuertipps\SteuerSparErklaerung\' + [string]$productProfile.executable.installationFolderName + '\SteuertippsCenter.exe'
  )
  if (-not (Test-Path -LiteralPath $centerExe -PathType Leaf) -or
      [IO.Path]::GetFileName($centerExe) -ine 'SteuertippsCenter.exe') {
    throw 'Profilierter Steuertipps-Center ist nicht installiert.'
  }
  $centerFile = Get-Item -LiteralPath $centerExe -Force -ErrorAction Stop
  $centerFileVersion = @([regex]::Matches([string]$centerFile.VersionInfo.FileVersion, '\d+') |
    ForEach-Object { $_.Value }) -join '.'
  if ($centerFile.VersionInfo.ProductName -cne 'SteuertippsCenter' -or
      $centerFileVersion -cne [string]$productProfile.verifiedBuild) {
    throw 'Installierter Steuertipps-Center passt nicht zum verifizierten Produktprofil.'
  }
  if (@(Get-Process -Name SteuertippsCenter -ErrorAction SilentlyContinue).Count) {
    throw 'Ein Steuertipps-Center laeuft bereits und wird nicht uebernommen.'
  }

  $nativeLoaderPath = Join-Path $PSScriptRoot '..\powershell\load-native.ps1'
  . $nativeLoaderPath
  $null = Import-SSENativeInterop -ForceSource:($env:SSE_MCP_FORCE_NATIVE_SOURCE -eq '1')

  $GENERIC_ALL = 0x10000000
  $existingDesktop = [DSK]::OpenDesktop($Desktop, 0, $false, $GENERIC_ALL)
  if ($existingDesktop -ne [IntPtr]::Zero) {
    [DSK]::CloseDesktop($existingDesktop) | Out-Null
    throw 'Der Center-Testdesktop existiert bereits und wird nicht uebernommen.'
  }
  $desktopHandle = [DSK]::CreateDesktop($Desktop, [IntPtr]::Zero, [IntPtr]::Zero, 0, $GENERIC_ALL, [IntPtr]::Zero)
  if ($desktopHandle -eq [IntPtr]::Zero) { throw 'Center-Testdesktop liess sich nicht anlegen.' }

  # Kill-on-close bindet den gesamten Center-Prozessbaum an diesen Launcher.
  # Auch bei einem abgebrochenen Node-Test bleibt damit kein fremder Prozess.
  $jobHandle = [DSK]::CreateJobObject([IntPtr]::Zero, $null)
  if ($jobHandle -eq [IntPtr]::Zero) { throw 'Center-Testjob liess sich nicht anlegen.' }
  $jobBasic = New-Object DSK+JOBOBJECT_BASIC_LIMIT_INFORMATION
  $jobBasic.LimitFlags = 0x00002000 # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  $jobInfo = New-Object DSK+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  $jobInfo.BasicLimitInformation = $jobBasic
  $jobInfoSize = [Runtime.InteropServices.Marshal]::SizeOf([type][DSK+JOBOBJECT_EXTENDED_LIMIT_INFORMATION])
  if (-not [DSK]::SetInformationJobObject($jobHandle, 9, [ref]$jobInfo, [uint32]$jobInfoSize)) {
    throw 'Center-Testjob liess sich nicht absichern.'
  }

  $startup = New-Object DSK+SI
  $startup.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][DSK+SI])
  $startup.desktop = "WinSta0\$Desktop"
  $command = New-Object Text.StringBuilder 2048
  $null = $command.Append('"' + $centerExe + '"')
  $processInfo = New-Object DSK+PI
  if (-not [DSK]::CreateProcess(
      $centerExe, $command, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0x00000004,
      [IntPtr]::Zero, (Split-Path $centerExe -Parent), [ref]$startup, [ref]$processInfo
    )) {
    throw 'Steuertipps-Center liess sich nicht auf dem Testdesktop starten.'
  }
  $processHandle = $processInfo.hProcess
  $threadHandle = $processInfo.hThread
  if (-not [DSK]::AssignProcessToJobObject($jobHandle, $processHandle)) {
    throw 'Steuertipps-Center liess sich nicht an den Testjob binden.'
  }
  $assignedToJob = $true
  if ([DSK]::ResumeThread($threadHandle) -eq [uint32]::MaxValue) {
    throw 'Center-Testthread liess sich nicht fortsetzen.'
  }
  [DSK]::CloseHandle($threadHandle) | Out-Null
  $threadHandle = [IntPtr]::Zero

  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(10, [Math]::Min(90, $TimeoutSec)))
  while ([DateTime]::UtcNow -lt $deadline -and $mainHwnd -eq [IntPtr]::Zero) {
    if ([DSK]::WaitForSingleObject($processHandle, 0) -eq 0) { throw 'Steuertipps-Center endete vor dem Hauptfenster.' }
    foreach ($window in @([DSK]::ListDesktopWindows($desktopHandle))) {
      $windowPid = 0
      [SW]::GetWindowThreadProcessId($window, [ref]$windowPid) | Out-Null
      if ([int]$windowPid -ne [int]$processInfo.pid -or -not [SW]::IsWindowVisible($window)) { continue }
      $rect = New-Object SW+RC
      [SW]::GetWindowRect($window, [ref]$rect) | Out-Null
      if (($rect.R - $rect.L) -ge 600 -and ($rect.B - $rect.T) -ge 400) {
        $mainHwnd = $window
        break
      }
    }
    if ($mainHwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
  }
  if ($mainHwnd -eq [IntPtr]::Zero) { throw 'Steuertipps-Center erzeugte kein gebundenes Hauptfenster.' }

  [Console]::Out.WriteLine((@{
    ok=$true; pid=[int]$processInfo.pid; hwnd=[int64]$mainHwnd; desktop=$Desktop
  } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  $ready = $true
  $null = [Console]::In.ReadLine()
  $exitCode = 0
} catch {
  if (-not $ready) {
    [Console]::Out.WriteLine((@{
      ok=$false; kind='center-test-launch'; error='Isolierter Steuertipps-Center konnte nicht sicher gestartet werden.'
    } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  }
} finally {
  if ($mainHwnd -ne [IntPtr]::Zero -and [SW]::IsWindow($mainHwnd)) {
    $sendResult = [IntPtr]::Zero
    [SW]::SendMessageTimeout($mainHwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 3000, [ref]$sendResult) | Out-Null
  }
  if ($processHandle -ne [IntPtr]::Zero) { [DSK]::WaitForSingleObject($processHandle, 3000) | Out-Null }
  # Vor erfolgreicher Jobzuordnung kann KILL_ON_JOB_CLOSE den suspendierten
  # Prozess noch nicht erfassen. In genau diesem Fehlerfenster am Handle
  # terminieren, bevor irgendein Eigentumsbeweis geschlossen wird.
  if ($processHandle -ne [IntPtr]::Zero -and -not $assignedToJob -and
      [DSK]::WaitForSingleObject($processHandle, 0) -ne 0) {
    [DSK]::TerminateProcess($processHandle, 1) | Out-Null
    [DSK]::WaitForSingleObject($processHandle, 5000) | Out-Null
  }
  # Das Schliessen des Jobs beendet nur den exakt hier gestarteten Prozessbaum.
  if ($jobHandle -ne [IntPtr]::Zero) { [DSK]::CloseHandle($jobHandle) | Out-Null }
  if ($processHandle -ne [IntPtr]::Zero) {
    [DSK]::WaitForSingleObject($processHandle, 5000) | Out-Null
    [DSK]::CloseHandle($processHandle) | Out-Null
  }
  if ($threadHandle -ne [IntPtr]::Zero) { [DSK]::CloseHandle($threadHandle) | Out-Null }
  if ($desktopHandle -ne [IntPtr]::Zero) { [DSK]::CloseDesktop($desktopHandle) | Out-Null }
}
exit $exitCode
