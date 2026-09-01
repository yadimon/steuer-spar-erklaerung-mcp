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
$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Wait-SSEProcessExit'
}, $true))
if ($definition.Count -ne 1) { throw 'Wait-SSEProcessExit ist nicht eindeutig vorhanden.' }
$waitSource = $definition[0].Extent.Text
Invoke-Expression $waitSource

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
  $null = $process.SafeHandle
  $null = $fixtures.Add($process)
  $process
}

try {
  $long = Start-HiddenDelay 3000
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $negativeStillRuns = Wait-SSEProcessExit $long -1
  $watch.Stop()
  Assert-True $negativeStillRuns 'Negativer Legacy-Timeout wurde nicht als Sofortprobe behandelt.'
  Assert-True ($watch.ElapsedMilliseconds -lt 1000) 'Timeout -1 wurde versehentlich zum unendlichen Wait.'
  Assert-True (Wait-SSEProcessExit $long 0) 'Timeout 0 erkannte einen lebenden Prozess faelschlich als beendet.'
  Assert-True (Wait-SSEProcessExit $long 100) 'Ein lebender Prozess wurde innerhalb seines kurzen Timeouts faelschlich als beendet gemeldet.'

  $delayed = Start-HiddenDelay 250
  Assert-True (-not (Wait-SSEProcessExit $delayed 5000)) 'Ein waehrend des Waits endender Prozess blieb angeblich aktiv.'
  Assert-True (-not (Wait-SSEProcessExit $delayed 0)) 'Ein bereits beendeter gepinnter Prozess wurde als aktiv gemeldet.'

  # Exakt die Produktionsfolge dynamisch belegen: Startobjekt nicht als
  # Abkuerzung verwenden, sondern per PID neu erfassen, dessen Handle vor der
  # Mutation pinnen, dasselbe Objekt killen und auf dasselbe Objekt warten.
  $started = Start-HiddenDelay 3000
  $reacquired = Get-Process -Id $started.Id -ErrorAction Stop
  $null = $fixtures.Add($reacquired)
  $null = $reacquired.SafeHandle
  Stop-Process -InputObject $reacquired -Force -ErrorAction Stop
  Assert-True (-not (Wait-SSEProcessExit $reacquired 5000)) 'Get-Process/SafeHandle/Stop-Process blieb nicht an dasselbe Prozessobjekt gebunden.'

  $disposed = Start-HiddenDelay 100
  Assert-True (-not (Wait-SSEProcessExit $disposed 5000)) 'Disposed-Fixture endete nicht kontrolliert.'
  $disposed.Dispose()
  $disposedFailedClosed = $false
  try { $null = Wait-SSEProcessExit $disposed 0 }
  catch { $disposedFailedClosed = $true }
  Assert-True $disposedFailedClosed 'Ein nicht mehr beobachtbarer Process wurde als Erfolg statt fail-closed behandelt.'

  Assert-True ($waitSource -match '\[Diagnostics\.Process\]\$Process') 'Wait-SSEProcessExit akzeptiert nicht den exakten Process.'
  Assert-True ($waitSource -match '\.WaitForExit\(') 'Wait-SSEProcessExit wartet nicht auf das Kernel-Signal.'
  Assert-True ($waitSource -match '\[Math\]::Max\(0, \$TimeoutMs\)') 'Negative Timeouts werden nicht sicher auf die Sofortprobe geklemmt.'
  Assert-True ($waitSource -notmatch 'Get-Process|Start-Sleep') 'Wait-SSEProcessExit pollt weiterhin per Cmdlet oder Sleep.'

  $closeStart = $workerSource.IndexOf("`n  'close' {")
  $closeEnd = $workerSource.IndexOf("`n  'list_cases' {", $closeStart)
  Assert-True ($closeStart -ge 0 -and $closeEnd -gt $closeStart) 'Close-Block ist nicht eindeutig auffindbar.'
  $closeBlock = $workerSource.Substring($closeStart, $closeEnd - $closeStart)
  $pinIndex = $closeBlock.IndexOf('$targetProcess.SafeHandle')
  Assert-True ($pinIndex -ge 0) 'Close pinnt den verifizierten Prozess-Handle nicht.'
  Assert-True ($pinIndex -lt $closeBlock.IndexOf('SendMessageTimeout')) 'Der Prozess-Handle wird erst nach der Schliessmutation gepinnt.'
  Assert-True ($pinIndex -lt $closeBlock.IndexOf('Stop-Process')) 'Der Prozess-Handle wird erst nach einem Kill gepinnt.'
  Assert-True ($closeBlock -notmatch '\$stillRunning\s*=\s*\[bool\]\(Get-Process') 'Der Sonderpfad prueft nach dem Kill weiterhin eine wiederverwendbare PID.'

  $waitCalls = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.CommandAst] -and
      $node.GetCommandName() -ceq 'Wait-SSEProcessExit'
  }, $true) | ForEach-Object { $_.Extent.Text.Trim() })
  Assert-True ($waitCalls.Count -eq 3) "Erwartet waren drei exakte Prozess-Waits, gefunden wurden $($waitCalls.Count)."
  Assert-True (@($waitCalls | Where-Object { $_ -notmatch '^Wait-SSEProcessExit \$targetProcess ' }).Count -eq 0) 'Mindestens ein Close-Wait verwendet weiterhin nur eine PID.'
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

Write-Output 'Prozessende: gepinnter Handle, signalgesteuerter Wait, Timeoutklemme und fail-closed Fehler bestanden.'
