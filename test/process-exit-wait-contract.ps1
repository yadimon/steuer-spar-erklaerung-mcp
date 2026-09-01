# Schliess-Readback bleibt an den bereits verifizierten Kernelprozess gebunden.
# Reine PID-Polls koennten nach einem Exit eine wiederverwendete PID beobachten
# und reagieren zudem nur im bisherigen 250-ms-Raster.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = [IO.File]::ReadAllText($workerPath)
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }
$pinDefinition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-SSEPinnedProcessHandle'
}, $true))
if ($pinDefinition.Count -ne 1) { throw 'Get-SSEPinnedProcessHandle ist nicht eindeutig vorhanden.' }
$pinSource = $pinDefinition[0].Extent.Text

$waitDefinition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Wait-SSEProcessExit'
}, $true))
if ($waitDefinition.Count -ne 1) { throw 'Wait-SSEProcessExit ist nicht eindeutig vorhanden.' }
$waitSource = $waitDefinition[0].Extent.Text
Invoke-Expression $pinSource
Invoke-Expression $waitSource

$nativeLoaderPath = Join-Path $root 'powershell\load-native.ps1'
. $nativeLoaderPath
$null = Import-SSENativeInterop

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$fixtures = New-Object System.Collections.ArrayList
function Start-HiddenDelay([int]$Milliseconds) {
  $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $powershell
  $startInfo.Arguments = "-NoLogo -NoProfile -NonInteractive -Command Start-Sleep -Milliseconds $Milliseconds"
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $process = [Diagnostics.Process]::Start($startInfo)
  $null = $fixtures.Add($process)
  $process
}

try {
  # Windows PowerShell 5.1 gibt fuer beide Zustaende bei .SafeHandle still
  # $null zurueck. Der Produktionshelfer muss das ohne fremde/elevated
  # Prozesse deterministisch als nicht pinbar ablehnen.
  $unbound = [Diagnostics.Process]::new()
  try {
    Assert-True ($null -eq (Get-SSEPinnedProcessHandle $unbound)) 'Ein ungebundenes Process-Objekt wurde als gepinnt akzeptiert.'
  } finally {
    $unbound.Dispose()
  }
  Assert-True ($null -eq (Get-SSEPinnedProcessHandle $null)) 'Ein fehlendes Process-Objekt wurde als gepinnt akzeptiert.'

  $long = Start-HiddenDelay 3000
  $longHandle = Get-SSEPinnedProcessHandle $long
  Assert-True ($null -ne $longHandle -and -not $longHandle.IsInvalid -and -not $longHandle.IsClosed) 'Lebender Prozess liess sich nicht exakt pinnen.'
  Assert-True ([object]::ReferenceEquals($longHandle, $long.SafeHandle)) 'Der gehaltene Handle ist nicht derselbe Handle des Process-Objekts.'
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $negativeStillRuns = Wait-SSEProcessExit $longHandle -1
  $watch.Stop()
  Assert-True $negativeStillRuns 'Negativer Legacy-Timeout wurde nicht als Sofortprobe behandelt.'
  Assert-True ($watch.ElapsedMilliseconds -lt 1000) 'Timeout -1 wurde versehentlich zum unendlichen Wait.'
  Assert-True (Wait-SSEProcessExit $longHandle 0) 'Timeout 0 erkannte einen lebenden Prozess faelschlich als beendet.'
  Assert-True (Wait-SSEProcessExit $longHandle 100) 'Ein lebender Prozess wurde innerhalb seines kurzen Timeouts faelschlich als beendet gemeldet.'

  $delayed = Start-HiddenDelay 250
  $delayedHandle = Get-SSEPinnedProcessHandle $delayed
  Assert-True (-not (Wait-SSEProcessExit $delayedHandle 5000)) 'Ein waehrend des Waits endender Prozess blieb angeblich aktiv.'
  Assert-True (-not (Wait-SSEProcessExit $delayedHandle 0)) 'Ein bereits beendeter gepinnter Prozess wurde als aktiv gemeldet.'

  # Exakt die Produktionsfolge dynamisch belegen: Startobjekt nicht als
  # Abkuerzung verwenden, sondern per PID neu erfassen, dessen Handle vor der
  # Mutation pinnen, dasselbe Objekt killen und auf dasselbe Objekt warten.
  $started = Start-HiddenDelay 3000
  $reacquired = Get-Process -Id $started.Id -ErrorAction Stop
  $null = $fixtures.Add($reacquired)
  $reacquiredHandle = Get-SSEPinnedProcessHandle $reacquired
  Assert-True ($null -ne $reacquiredHandle) 'Das erneut per PID erfasste Process-Objekt liess sich nicht pinnen.'
  Stop-Process -InputObject $reacquired -Force -ErrorAction Stop
  Assert-True (-not (Wait-SSEProcessExit $reacquiredHandle 5000)) 'Get-Process/SafeHandle/Stop-Process blieb nicht an denselben Kernel-Handle gebunden.'

  $disposed = Start-HiddenDelay 100
  $disposedHandle = Get-SSEPinnedProcessHandle $disposed
  Assert-True (-not (Wait-SSEProcessExit $disposedHandle 5000)) 'Disposed-Fixture endete nicht kontrolliert.'
  $disposed.Dispose()
  Assert-True ($null -eq (Get-SSEPinnedProcessHandle $disposed)) 'Ein disposed Process-Objekt wurde erneut als pinbar akzeptiert.'
  $disposedFailedClosed = $false
  try { $null = Wait-SSEProcessExit $disposedHandle 0 }
  catch { $disposedFailedClosed = $true }
  Assert-True $disposedFailedClosed 'Ein geschlossener SafeHandle wurde als Erfolg statt fail-closed behandelt.'

  $invalidHandle = [Microsoft.Win32.SafeHandles.SafeProcessHandle]::new([IntPtr]::Zero, $false)
  try {
    $invalidFailedClosed = $false
    try { $null = Wait-SSEProcessExit $invalidHandle 0 }
    catch { $invalidFailedClosed = $true }
    Assert-True $invalidFailedClosed 'Ein ungueltiger SafeHandle wurde als Erfolg statt fail-closed behandelt.'
  } finally {
    $invalidHandle.Dispose()
  }
  # SafeHandle selbst betrachtet nur 0 und -1 als ungueltig. Der garantiert
  # nicht ausgerichtete Wert 3 erreicht deshalb deterministisch den nativen
  # WAIT_FAILED-Zweig, ohne einen fremden Prozess oeffnen zu muessen.
  $unusableNativeHandle = [Microsoft.Win32.SafeHandles.SafeProcessHandle]::new([IntPtr]3, $false)
  try {
    Assert-True (-not $unusableNativeHandle.IsInvalid) 'Die WAIT_FAILED-Fixture wurde bereits vom SafeHandle-Vorfilter abgewiesen.'
    $nativeWaitFailedClosed = $false
    try { $null = Wait-SSEProcessExit $unusableNativeHandle 0 }
    catch { $nativeWaitFailedClosed = $_.Exception.Message -match 'nicht beobachtet' }
    Assert-True $nativeWaitFailedClosed 'WAIT_FAILED wurde nicht als redigierter fail-closed Fehler gemeldet.'
  } finally {
    $unusableNativeHandle.Dispose()
  }
  $missingHandleFailedClosed = $false
  try { $null = Wait-SSEProcessExit $null 0 }
  catch { $missingHandleFailedClosed = $true }
  Assert-True $missingHandleFailedClosed 'Ein fehlender SafeHandle wurde als Erfolg statt fail-closed behandelt.'

  Assert-True ($pinSource -match '\$null -eq \$processHandle') 'Handle-Pinning prueft den stillen Null-Rueckgabepfad nicht.'
  Assert-True ($pinSource -match '\.IsInvalid' -and $pinSource -match '\.IsClosed') 'Handle-Pinning prueft Invalid/Closed nicht vollstaendig.'
  Assert-True ($waitSource -match '\[Microsoft\.Win32\.SafeHandles\.SafeProcessHandle\]\$ProcessHandle') 'Wait-SSEProcessExit akzeptiert nicht den gepinnten SafeHandle.'
  Assert-True ($waitSource -match '\[DSK\]::WaitForSingleObject\(') 'Wait-SSEProcessExit wartet nicht direkt auf das Kernel-Signal.'
  Assert-True ($waitSource -match 'DangerousAddRef' -and $waitSource -match 'DangerousRelease') 'Der native Wait haelt keine sichere Handle-Referenz.'
  Assert-True ($waitSource -match '\[uint32\]::MaxValue' -and $waitSource -match 'Win32Exception') 'WAIT_FAILED wird nicht explizit fail-closed behandelt.'
  Assert-True ($waitSource -match '(?s)default\s*\{\s*throw \[InvalidOperationException\]') 'Unerwartete Wait-Ergebnisse werden nicht explizit fail-closed behandelt.'
  Assert-True ($waitSource -match '\[Math\]::Max\(0, \$TimeoutMs\)') 'Negative Timeouts werden nicht sicher auf die Sofortprobe geklemmt.'
  Assert-True ($waitSource -notmatch 'Get-Process|Start-Sleep|\.WaitForExit\(') 'Wait-SSEProcessExit pollt oder faellt auf Process.WaitForExit zurueck.'

  $closeStart = $workerSource.IndexOf("`n  'close' {")
  $closeEnd = $workerSource.IndexOf("`n  'list_cases' {", $closeStart)
  Assert-True ($closeStart -ge 0 -and $closeEnd -gt $closeStart) 'Close-Block ist nicht eindeutig auffindbar.'
  $closeBlock = $workerSource.Substring($closeStart, $closeEnd - $closeStart)
  $pinIndex = $closeBlock.IndexOf('$targetProcessHandle = Get-SSEPinnedProcessHandle $targetProcess')
  Assert-True ($pinIndex -ge 0) 'Close pinnt den verifizierten Prozess-Handle nicht.'
  Assert-True ($pinIndex -lt $closeBlock.IndexOf('SendMessageTimeout')) 'Der Prozess-Handle wird erst nach der Schliessmutation gepinnt.'
  Assert-True ($pinIndex -lt $closeBlock.IndexOf('Stop-Process')) 'Der Prozess-Handle wird erst nach einem Kill gepinnt.'
  Assert-True ($closeBlock -match '\$null -eq \$targetProcessHandle') 'Close bricht bei einem nicht pinbaren Prozess nicht explizit ab.'
  Assert-True ($closeBlock -notmatch '\$targetProcess\.WaitForExit\(') 'Close kann nach der Mutation weiterhin per Process/PID neu oeffnen.'
  Assert-True ($closeBlock -notmatch '\$stillRunning\s*=\s*\[bool\]\(Get-Process') 'Der Sonderpfad prueft nach dem Kill weiterhin eine wiederverwendbare PID.'

  $waitCalls = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.CommandAst] -and
      $node.GetCommandName() -ceq 'Wait-SSEProcessExit'
  }, $true) | ForEach-Object { $_.Extent.Text.Trim() })
  Assert-True ($waitCalls.Count -eq 4) "Erwartet waren vier exakte Prozess-Waits, gefunden wurden $($waitCalls.Count)."
  Assert-True (@($waitCalls | Where-Object { $_ -notmatch '^Wait-SSEProcessExit \$targetProcessHandle ' }).Count -eq 0) 'Mindestens ein Close-Wait verwendet nicht den gepinnten Handle.'
} finally {
  foreach ($process in @($fixtures)) {
    try {
      if (-not $process.HasExited) {
        $process.Kill()
        $null = $process.WaitForExit(5000)
      }
    } catch { }
    try { $process.Dispose() } catch { }
  }
}

Write-Output 'Prozessende: Null-/Invalid-Pin abgelehnt, exakter Kernel-Handle-Wait, Timeoutklemme und fail-closed Fehler bestanden.'
