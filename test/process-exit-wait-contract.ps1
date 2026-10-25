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
$outcomeDefinition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq 'Wait-SSECloseOutcome'
}, $true))
if ($outcomeDefinition.Count -ne 1) { throw 'Wait-SSECloseOutcome ist nicht eindeutig vorhanden.' }
$outcomeSource = $outcomeDefinition[0].Extent.Text
Invoke-Expression $pinSource
Invoke-Expression $waitSource
Invoke-Expression $outcomeSource

$nativeLoaderPath = Join-Path $root 'powershell\load-native.ps1'
. $nativeLoaderPath
$null = Import-SSENativeInterop

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Test-SSEDialogWindowCurrent($Window,[int]$TargetPid) {
  [bool]($Window -and [int]$Window.pid -eq $TargetPid -and -not $Window.vanished)
}

$fixtures = New-Object System.Collections.ArrayList
function Start-HiddenDelay([int]$Milliseconds) {
  $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $powershell
  $startInfo.Arguments = ('-NoLogo -NoProfile -NonInteractive -Command "' +
    '[Console]::WriteLine(''ready''); [Console]::Out.Flush(); ' +
    '[void][Console]::ReadLine(); Start-Sleep -Milliseconds ' + $Milliseconds + '"')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $process = [Diagnostics.Process]::Start($startInfo)
  $null = $fixtures.Add($process)
  # The kernel-wait deadline starts after the fixture is ready, rather than
  # including a competing cold PowerShell startup. Only the parent releases it.
  $ready = $process.StandardOutput.ReadLineAsync()
  Assert-True ($ready.Wait(30000)) 'Prozess-Fixture meldete ihre Bereitschaft nicht innerhalb des Startbudgets.'
  Assert-True ($ready.GetAwaiter().GetResult() -ceq 'ready') 'Prozess-Fixture meldete keine eindeutige Bereitschaft.'
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
  $delayed.StandardInput.WriteLine('release')
  $delayed.StandardInput.Flush()
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
  $disposed.StandardInput.WriteLine('release')
  $disposed.StandardInput.Flush()
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

  # Eigene echte Kernelhandles, aber ausschliesslich synthetische Inventare.
  # Jede lokale Funktion bleibt auf ihren separaten Testscope begrenzt.
  Assert-True ($outcomeSource.Contains('Get-DialogInventory $TargetPid -RejectHung')) 'Close-Readback erlaubt tiefe Lese bekannter Haenger.'
  & {
    $queries = New-Object Collections.ArrayList
    function Get-DialogInventory([int]$TargetPid) {
      $null = $queries.Add($TargetPid)
      [pscustomobject]@{ pid=$long.Id; hwnd=77; kind='qt-dialog'; fingerprint='synthetic-owned'; buttons=@([pscustomobject]@{name='Nein'}) }
    }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $outcome = Wait-SSECloseOutcome $longHandle $long.Id 20000
    Assert-True ($outcome.stillRunning -and $outcome.dialogs.Count -eq 1) 'Eigener neuer Dialog ging verloren.'
    Assert-True ($outcome.dialogs -is [object[]] -and @($outcome.dialogs[0].buttons).Count -eq 1) 'Einzeldialog verlor seine Arrayform.'
    Assert-True ($queries.Count -eq 1 -and $queries[0] -eq $long.Id) 'Dialoginventar ist nicht an die eigene PID gebunden.'
    Assert-True ($timer.ElapsedMilliseconds -lt 5000) 'Ein erkannter eigener Dialog wartete auf die lange Exitfrist.'
  }
  & {
    function Get-DialogInventory([int]$TargetPid) {
      Assert-True ($TargetPid -eq $long.Id) 'Fremde Inventarabfrage.'
      @([pscustomobject]@{pid=1;kind='qt-dialog'}, [pscustomobject]@{pid=$long.Id;kind='main'},
        [pscustomobject]@{pid=$long.Id;kind='tips'}, [pscustomobject]@{pid=$long.Id;kind='other'})
    }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $outcome = Wait-SSECloseOutcome $longHandle $long.Id 600
    Assert-True ($outcome.stillRunning -and $outcome.dialogs.Count -eq 0) 'Fremdes oder nichtmodales Fenster wurde als eigener Dialog gemeldet.'
    Assert-True ($timer.ElapsedMilliseconds -ge 600 -and $timer.ElapsedMilliseconds -lt 5000) 'Dialogloser Readback verlor sein begrenztes Kernel-Wait-Budget.'
  }
  & {
    $queries = New-Object Collections.ArrayList
    function Get-DialogInventory([int]$TargetPid) {
      Assert-True ($TargetPid -eq $long.Id) 'Fremde Inventarabfrage bei Lesefehler.'
      $null = $queries.Add($TargetPid)
      [pscustomobject]@{pid=$long.Id;kind='qt-dialog';fingerprint='partial-must-not-escape'}
      throw [InvalidOperationException]::new('Synthetic inventory failure with unpublishable message.')
    }
    $outcome = Wait-SSECloseOutcome $longHandle $long.Id 600
    Assert-True ($outcome.stillRunning -and $outcome.dialogs.Count -eq 0) 'Inventarfehler taeuschte Prozessende oder gelesene Dialogdaten vor.'
    Assert-True ($queries.Count -eq 1) 'Ein defektes optionales Dialoginventar wurde wiederholt abgefragt.'
    Assert-True ($outcome.inspectionError -ceq 'System.InvalidOperationException') 'Inventarfehler verlor seinen Typ oder gab rohe Meldungen weiter.'
  }
  & {
    $queries=New-Object Collections.ArrayList
    function Get-DialogInventory([int]$TargetPid,[switch]$RejectHung) {
      Assert-True ($TargetPid -eq $long.Id -and $RejectHung) 'Unlesbarer Descriptor verlor PID-/Haengerschutz.'
      $null=$queries.Add($TargetPid)
      [pscustomobject]@{pid=$long.Id;kind='other';msaaError='Synthetic.Type';uiaError=$null}
    }
    $outcome=Wait-SSECloseOutcome $longHandle $long.Id 600
    Assert-True ($outcome.stillRunning -and $outcome.dialogs.Count -eq 0 -and $queries.Count -eq 1) 'Unlesbarer fremdklassifizierter Descriptor wurde still als dialogfrei wiederholt.'
    Assert-True ($outcome.inspectionError -ceq 'System.InvalidOperationException') 'Verschluckter Descriptorfehler verlor den beobachteten Fehlerzustand.'
  }
  & {
    $queries=New-Object Collections.ArrayList
    function Get-DialogInventory([int]$TargetPid,[switch]$RejectHung) {
      Assert-True ($TargetPid -eq $long.Id -and $RejectHung) 'Vollstaendiger MSAA-Ersatz verlor die eigene PID.'
      $null=$queries.Add($TargetPid)
      if($queries.Count -eq 1){[pscustomobject]@{pid=$long.Id;hwnd=77;kind='other';uiaError='Synthetic.Type';msaaError=$null;msaaReadOk=$true};return}
      [pscustomobject]@{pid=$long.Id;hwnd=78;kind='qt-dialog';fingerprint='synthetic-after-msaa'}
    }
    $outcome=Wait-SSECloseOutcome $longHandle $long.Id 1500
    Assert-True ($queries.Count -eq 2 -and $outcome.dialogs.Count -eq 1 -and $null -eq $outcome.inspectionError) 'Vollstaendige unabhaengige MSAA-Lese wurde als Inventarfehler verriegelt.'
  }
  & {
    $queries=New-Object Collections.ArrayList
    function Get-DialogInventory([int]$TargetPid,[switch]$RejectHung) {
      Assert-True ($TargetPid -eq $long.Id -and $RejectHung) 'Verschwindendes Fenster verlor die eigene PID.'
      $null=$queries.Add($TargetPid)
      if($queries.Count -eq 1){[pscustomobject]@{pid=$long.Id;hwnd=77;kind='other';msaaError='Synthetic.Type';uiaError=$null;vanished=$true};return}
      [pscustomobject]@{pid=$long.Id;hwnd=78;kind='qt-dialog';fingerprint='synthetic-next';vanished=$false}
    }
    $outcome=Wait-SSECloseOutcome $longHandle $long.Id 5000
    Assert-True ($queries.Count -eq 2 -and $outcome.dialogs.Count -eq 1 -and $null -eq $outcome.inspectionError) 'Verschwundenes Nebenfenster unterdrueckte den spaeteren eigenen Dialog.'
  }
  & {
    $queries=New-Object Collections.ArrayList
    function Get-DialogInventory([int]$TargetPid,[switch]$RejectHung) {
      Assert-True ($TargetPid -eq $long.Id -and $RejectHung) 'Kurzer Haenger verlor die eigene PID.'
      $null=$queries.Add($TargetPid)
      if($queries.Count -eq 1){$failure=[InvalidOperationException]::new('Synthetic short hang.');$failure.Data['kind']='hung';throw $failure}
      [pscustomobject]@{pid=$long.Id;hwnd=78;kind='qt-dialog';fingerprint='synthetic-after-hang';vanished=$false}
    }
    $outcome=Wait-SSECloseOutcome $longHandle $long.Id 5000
    Assert-True ($queries.Count -eq 2 -and $outcome.dialogs.Count -eq 1 -and $null -eq $outcome.inspectionError) 'Kurzer Haenger unterdrueckte den spaeteren eigenen Dialog.'
  }
  & {
    $queries=New-Object Collections.ArrayList
    function Get-DialogInventory([int]$TargetPid,[switch]$RejectHung) {
      Assert-True ($TargetPid -eq $long.Id -and $RejectHung) 'Fortbestehender Haenger verlor die eigene PID.'
      $null=$queries.Add($TargetPid)
      $failure=[InvalidOperationException]::new('Synthetic persistent hang.');$failure.Data['kind']='hung';throw $failure
    }
    $outcome=Wait-SSECloseOutcome $longHandle $long.Id 600
    Assert-True ($outcome.stillRunning -and $outcome.dialogs.Count -eq 0 -and $queries.Count -ge 1 -and $outcome.inspectionKind -ceq 'hung') 'Fortbestehender Haenger verlor seine begrenzte und unterscheidbare Diagnose.'
  }
  & {
    $queries=New-Object Collections.ArrayList
    function Get-DialogInventory([int]$TargetPid,[switch]$RejectHung) {
      Assert-True ($TargetPid -eq $long.Id -and $RejectHung) 'Langsames Inventar verlor PID-/Haengerschutz.'
      $null=$queries.Add($TargetPid)
      Start-Sleep -Milliseconds 450
      @()
    }
    $outcome=Wait-SSECloseOutcome $longHandle $long.Id 600
    Assert-True ($outcome.stillRunning -and $queries.Count -eq 1) 'Nach waehrend einer Lese abgelaufener Frist begann eine weitere Inventarabfrage.'
  }
  & {
    $exitFixture = Start-HiddenDelay 0
    $exitHandle = Get-SSEPinnedProcessHandle $exitFixture
    function Get-DialogInventory([int]$TargetPid) {
      Assert-True ($TargetPid -eq $exitFixture.Id) 'Fremde Inventarabfrage beim Ende.'
      $exitFixture.StandardInput.WriteLine('release'); $exitFixture.StandardInput.Flush()
      Assert-True ($exitFixture.WaitForExit(5000)) 'Eigene Inventar-Exitfixture endete nicht.'
      [pscustomobject]@{pid=$exitFixture.Id;kind='qt-dialog';fingerprint='stale-after-exit'}
    }
    $outcome = Wait-SSECloseOutcome $exitHandle $exitFixture.Id 20000
    Assert-True (-not $outcome.stillRunning -and $outcome.dialogs.Count -eq 0) 'Veralteter Dialog ueberstimmte den gepinnten Prozess-Exit.'
  }
  & {
    $exitFixture = Start-HiddenDelay 0
    $exitHandle = Get-SSEPinnedProcessHandle $exitFixture
    function Get-DialogInventory([int]$TargetPid) {
      Assert-True ($TargetPid -eq $exitFixture.Id) 'Fremde Inventarabfrage beim fehlerhaften Ende.'
      $exitFixture.StandardInput.WriteLine('release'); $exitFixture.StandardInput.Flush()
      Assert-True ($exitFixture.WaitForExit(5000)) 'Eigene Fehler-Exitfixture endete nicht.'
      throw [InvalidOperationException]::new('Synthetic ended-window inventory error.')
    }
    $outcome = Wait-SSECloseOutcome $exitHandle $exitFixture.Id 20000
    Assert-True (-not $outcome.stillRunning -and $outcome.dialogs.Count -eq 0) 'Inventarfehler verbarg einen belegten Prozess-Exit.'
    Assert-True ($outcome.inspectionError -ceq 'System.InvalidOperationException') 'Diagnosetyp nach belegtem Exit fehlt.'
  }
  & {
    function Get-DialogInventory { throw 'Abgelaufene Frist darf kein Inventar mehr lesen.' }
    $outcome = Wait-SSECloseOutcome $longHandle $long.Id 0
    Assert-True ($outcome.stillRunning -and $outcome.dialogs.Count -eq 0) 'Abgelaufener Readback erfand ein Ergebnis.'
    $invalidPidRejected = $false
    try { $null = Wait-SSECloseOutcome $longHandle 0 20000 }
    catch [ArgumentOutOfRangeException] { $invalidPidRejected = $true }
    Assert-True $invalidPidRejected 'Eine ungefilterte PID0 wurde zur Dialoglese zugelassen.'
  }

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

  # Execute the production close tail with a modeled kernel signal. This
  # verifies the wait requested before termination, without actually waiting
  # twenty seconds or terminating a product process in an offline test.
  Assert-True ($closeBlock.Contains('$closeInventory = @(Get-DialogInventory $targetPid -RejectHung |') -and
    $closeBlock.Contains('Test-SSEDialogWindowCurrent $_ $targetPid')) 'Close liest vor der Mutation ein ungefiltertes, veraltetes oder bekannt haengendes Dialoginventar.'
  Assert-True ($outcomeSource -notmatch 'SendMessage|PostMessage|\.Invoke\(|Stop-Process|Get-LiveElement|Start-Sleep|Get-Process|\.WaitForExit\(') 'Close-Readback fuehrt eine Aktion oder neue PID-Aufloesung aus.'
  $tailStart = $closeBlock.IndexOf('$closeOutcome = $null')
  Assert-True ($tailStart -ge 0) 'Close exit policy is missing.'
  $tailText = $closeBlock.Substring($tailStart)
  $tailText = $tailText.Substring(0, $tailText.LastIndexOf('}'))
  $closeTail = [scriptblock]::Create($tailText)
  function Assert-CloseWaitPolicy([bool]$Force, [bool]$Hung, [bool]$InitiallyRunning, [int]$ExpectedWait) {
    $force = $Force; $hung = $Hung; $discard = $true
    $save = $false; $antwort = $null; $targetPid = 7
    $targetProcess = [pscustomobject]@{ identity='owned-process' }
    $targetProcessHandle = [pscustomobject]@{ identity='pinned-handle' }
    $state = [pscustomobject]@{ running=$InitiallyRunning; waits=(New-Object Collections.ArrayList); stops=0; outcomes=0; result=$null }
    function Wait-SSECloseOutcome($ProcessHandle, [int]$TargetPid, [int]$TimeoutMs) {
      Assert-True (-not $force -and -not $hung) 'Force/Hung rief eine Dialoglese auf.'
      Assert-True ([object]::ReferenceEquals($ProcessHandle, $targetProcessHandle)) 'Close outcome lost its pinned handle.'
      Assert-True ($TargetPid -eq 7 -and $TimeoutMs -eq 20000) 'Close outcome lost PID or bounded wait.'
      $state.outcomes++; $null = $state.waits.Add($TimeoutMs)
      [pscustomobject]@{stillRunning=$state.running; dialogs=@(); inspectionError=$null}
    }
    function Wait-SSEProcessExit($ProcessHandle, [int]$TimeoutMs) {
      Assert-True ([object]::ReferenceEquals($ProcessHandle, $targetProcessHandle)) 'Close wait lost the pinned handle.'
      $null = $state.waits.Add($TimeoutMs)
      $state.running
    }
    function Stop-Process($InputObject, [switch]$Force, $ErrorAction) {
      Assert-True ([object]::ReferenceEquals($InputObject, $targetProcess)) 'Close termination lost the owned process.'
      Assert-True $Force 'Close termination did not request force.'
      $state.stops++
      $state.running = $false
    }
    function Emit($Result) { $state.result = $Result }
    & $closeTail
    Assert-True ($state.waits[0] -eq $ExpectedWait) "Unexpected pre-termination wait: $($state.waits[0])."
    Assert-True ($state.result.ok -and -not $state.result.stillRunning) 'Close did not verify process exit.'
    $expectedStops = $(if ($InitiallyRunning) { 1 } else { 0 })
    Assert-True ($state.stops -eq $expectedStops) 'Close termination count changed.'
    Assert-True ($state.result.killed -eq $InitiallyRunning) 'Close reported an incorrect termination result.'
    $expectedOutcomes = $(if ($Force -or $Hung) { 0 } else { 1 })
    Assert-True ($state.outcomes -eq $expectedOutcomes) 'Close changed its regular/forced observation split.'
    if ($InitiallyRunning) {
      Assert-True ($state.result.note -match 'hart beendet') 'Forced close claimed a regular unchanged exit.'
      Assert-True (@($state.waits | Select-Object -Skip 1 | Where-Object { $_ -ne 5000 }).Count -eq 0) 'Termination lost its bounded exit verification.'
    }
  }
  Assert-CloseWaitPolicy $true $false $true 0
  Assert-CloseWaitPolicy $false $true $true 0
  Assert-CloseWaitPolicy $true $false $false 0
  Assert-CloseWaitPolicy $false $false $false 20000

  & {
    $force=$false; $hung=$false; $discard=$false; $save=$false; $antwort='Synthetic previous answer'; $targetPid=7
    $targetProcessHandle=[pscustomobject]@{identity='pinned-handle'}
    $state=[pscustomobject]@{emits=0;outcomes=0;result=$null}
    $sentinel=[OperationCanceledException]::new('Synthetic terminal Emit.')
    function Wait-SSECloseOutcome($ProcessHandle, [int]$TargetPid, [int]$TimeoutMs) {
      Assert-True ([object]::ReferenceEquals($ProcessHandle,$targetProcessHandle)) 'Dialog outcome lost the handle.'
      Assert-True ($TargetPid -eq 7 -and $TimeoutMs -eq 20000) 'Dialog outcome lost PID/deadline.'
      $state.outcomes++
      [pscustomobject]@{stillRunning=$true;inspectionError=$null;dialogs=@([pscustomobject]@{
        hwnd=77;title='Synthetic own dialog';kind='qt-dialog';buttons=@('Nein');texts=@('Synthetic question');fingerprint='synthetic';tree='must-not-leak'
      })}
    }
    function Wait-SSEProcessExit { throw 'Dialog outcome must not continue waiting.' }
    function Stop-Process { throw 'Regular dialog outcome must not terminate a process.' }
    function Emit($Result) { $state.emits++;$state.result=$Result;throw $sentinel }
    try { & $closeTail; throw 'Close tail did not reach a terminal Emit.' }
    catch { Assert-True ([object]::ReferenceEquals($_.Exception,$sentinel)) 'Close tail swallowed or replaced an unexpected failure.' }
    Assert-True ($state.emits -eq 1 -and $state.outcomes -eq 1) 'Dialog close performed repeated observation or emission.'
    Assert-True (-not $state.result.ok -and $state.result.kind -ceq 'dialog-open') 'Own modal was not reported as dialog-open.'
    Assert-True ($state.result.closeRequested -and $state.result.stillRunning -and -not $state.result.killed -and $state.result.pid -eq 7) 'Dialog close lost its actual attempted state.'
    Assert-True ($state.result.speichernAntwort -ceq $antwort -and -not $state.result.discardChanges) 'Dialog close lost existing answer/discard state.'
    Assert-True (($state.result.dialogs[0].PSObject.Properties.Name -join ',') -ceq 'hwnd,title,kind,buttons,texts,fingerprint') 'Dialog projection lost binding data or leaked raw tree.'
  }
  & {
    $force=$false; $hung=$false; $discard=$false; $save=$false; $antwort=$null; $targetPid=7
    $targetProcessHandle=[pscustomobject]@{identity='pinned-handle'}
    $state=[pscustomobject]@{emits=0;result=$null}
    $sentinel=[OperationCanceledException]::new('Synthetic terminal Emit.')
    function Wait-SSECloseOutcome($ProcessHandle, [int]$TargetPid, [int]$TimeoutMs) {
      Assert-True ([object]::ReferenceEquals($ProcessHandle,$targetProcessHandle)) 'Unresolved close lost its handle.'
      Assert-True ($TargetPid -eq 7 -and $TimeoutMs -eq 20000) 'Unresolved close lost PID/deadline.'
      [pscustomobject]@{stillRunning=$true;inspectionError='Synthetic.Type';dialogs=@()}
    }
    function Wait-SSEProcessExit($ProcessHandle, [int]$TimeoutMs) {
      Assert-True ([object]::ReferenceEquals($ProcessHandle,$targetProcessHandle) -and $TimeoutMs -eq 0) 'Unresolved close changed its final exact signal probe.'
      $true
    }
    function Stop-Process { throw 'Unresolved regular close must preserve the process.' }
    function Emit($Result) { $state.emits++;$state.result=$Result;throw $sentinel }
    try { & $closeTail; throw 'Close tail did not reach a terminal Emit.' }
    catch { Assert-True ([object]::ReferenceEquals($_.Exception,$sentinel)) 'Unresolved close replaced its actual failure.' }
    Assert-True ($state.emits -eq 1 -and -not $state.result.ok -and $state.result.stillRunning -and -not $state.result.killed) 'Unresolved regular close fabricated success or kill.'
    Assert-True ($state.result.kind -ceq 'postcondition-failed' -and $state.result.dialogInspectionError -ceq 'Synthetic.Type') 'Unresolved regular close lost failure/inspection diagnosis.'
    Assert-True ($state.result.error -ceq 'Programm laeuft nach dem Schliessversuch noch; Dialogzustand mit sse_ui_state pruefen.') 'Original unresolved-close error changed.'
  }

  $closeTokens=$null; $closeErrors=$null
  $closeAst=[Management.Automation.Language.Parser]::ParseInput(("switch ('close') {`n"+$closeBlock+"`n}"),[ref]$closeTokens,[ref]$closeErrors)
  Assert-True ($closeErrors.Count -eq 0) 'Der ausgeschnittene Close-Block besitzt Parserfehler.'
  $waitCalls = @($closeAst.FindAll({
    param($node)
    $node -is [Management.Automation.Language.CommandAst] -and
      $node.GetCommandName() -ceq 'Wait-SSEProcessExit'
  }, $true) | ForEach-Object { $_.Extent.Text.Trim() })
  Assert-True ($waitCalls.Count -eq 4) "Erwartet waren vier exakte Prozess-Waits, gefunden wurden $($waitCalls.Count)."
  Assert-True (@($waitCalls | Where-Object { $_ -notmatch '^Wait-SSEProcessExit \$targetProcessHandle ' }).Count -eq 0) 'Mindestens ein Close-Wait verwendet nicht den gepinnten Handle.'
  $outcomeWaitCalls = @($outcomeDefinition[0].FindAll({
    param($node)
    $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Wait-SSEProcessExit'
  },$true) | ForEach-Object {$_.Extent.Text.Trim()})
  Assert-True ($outcomeWaitCalls.Count -eq 2 -and @($outcomeWaitCalls | Where-Object {$_ -notmatch '^Wait-SSEProcessExit \$ProcessHandle '}).Count -eq 0) 'Dialog-Readback verwendet nicht ausschliesslich den identischen Kernelhandle.'
  Assert-True ([regex]::Matches($closeBlock,'Wait-SSECloseOutcome \$targetProcessHandle \$targetPid 20000').Count -eq 1) 'Regulaeres Close hat keinen einzelnen exakt gebundenen Outcome-Readback.'
  $allWaitCalls=@($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Wait-SSEProcessExit'
  },$true))
  Assert-True ($allWaitCalls.Count -eq ($waitCalls.Count+$outcomeWaitCalls.Count)) 'Ein Prozess-Wait liegt ausserhalb der beiden geprueften Bindungsscope.'
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
