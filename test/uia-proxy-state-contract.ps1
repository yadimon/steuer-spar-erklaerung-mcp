$ErrorActionPreference = 'Stop'

# Haelt fest, wovon die proxyfreie UIA-Sicht des Workers abhaengt.
#
# Der verwaltete UIA-Client des .NET Framework laedt seine Client-Side-Proxies
# beim ersten Aufruf ueber einen Stack-Walk in ProxyManager.LoadDefaultProxies.
# Kommt dieser erste Aufruf aus einem PowerShell-Scriptblock, scheitert der
# Stack-Walk still, und die Proxies bleiben fuer den Rest des Prozesses aus.
# Kommt er aus kompiliertem Code, werden sie geladen - dann tragen Fenster mit
# Titelleiste einen TitleBar-Teilbaum, und native Dialoge zeigen die vollen
# Teilbaeume ihrer Win32-Steuerelemente. Saemtliche Ergebnisvertraege des
# Workers sind auf die proxyfreie Sicht festgezurrt.
#
# Der Vertrag hat deshalb drei Teile: (1) der native Baumlauf sieht nach einem
# vorangestellten PowerShell-Aufruf keine Titelleiste; (2) ohne diesen Aufruf
# saehe er sie - aendert sich das (etwa durch ein .NET-Update), muss die
# Entscheidung fuer oder gegen Proxies bewusst neu getroffen werden; (3) der
# Worker stellt den PowerShell-Aufruf dem nativen Lauf tatsaechlich voran.

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$nativeDll = Join-Path $PSScriptRoot '..\powershell\sse-native.dll'
Assert-True (Test-Path -LiteralPath $nativeDll -PathType Leaf) "Nativer Helfer fehlt: $nativeDll (npm run build:native)"
$workerPath = Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw

# (3) Quelltextbindung: Get-UiSnapshot ruft FromHandle aus PowerShell auf,
# bevor der native Lauf beginnt.
$snapshotStart = $workerSource.IndexOf('function Get-UiSnapshot {')
Assert-True ($snapshotStart -ge 0) 'Get-UiSnapshot fehlt im Worker.'
$snapshotBody = $workerSource.Substring($snapshotStart, [Math]::Min(6000, $workerSource.Length - $snapshotStart))
$powershellFirst = $snapshotBody.IndexOf('$null = $AE::FromHandle($hwnd)')
$nativeWalk = $snapshotBody.IndexOf('[SSEUiaTree]::Describe(')
Assert-True ($nativeWalk -ge 0) 'Get-UiSnapshot ruft den nativen Baumlauf nicht auf.'
Assert-True ($powershellFirst -ge 0 -and $powershellFirst -lt $nativeWalk) `
  'Get-UiSnapshot muss vor dem nativen Baumlauf einmal $AE::FromHandle aus PowerShell aufrufen; sonst laedt der UIA-Client Proxies und die Baeume aendern ihre Form.'

# Ein eigenes Fenster mit Titelleiste, ausserhalb des sichtbaren Bereichs.
# Die Kindprozesse lesen es per UIA; dafuer muss dieser Prozess Nachrichten
# pumpen, solange sie laufen.
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'SSE UIA-Proxy-Vertrag'
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point(-20000, -20000)
$form.Size = New-Object System.Drawing.Size(320, 200)
$form.ShowInTaskbar = $false
$form.Opacity = 0.01
$form.Show()
[System.Windows.Forms.Application]::DoEvents()
$hwnd = [int64]$form.Handle
Assert-True ($hwnd -ne 0) 'Testfenster hat kein Handle.'

$childScript = @'
param([int64]$Hwnd, [string]$Mode, [string]$Dll)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type -Path $Dll
if ($Mode -eq 'powershell-first') {
  $null = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
}
$snapshot = [SSEUiaTree]::Describe([IntPtr]$Hwnd, 400, 10000, 8, $false, $false)
$titleBars = @($snapshot.Nodes | Where-Object { $_.ControlType -eq 'TitleBar' }).Count
$proxies = @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetName().Name -eq 'UIAutomationClientsideProviders' }).Count
"$($snapshot.NodeCount);$titleBars;$proxies"
'@
$childPath = Join-Path $env:TEMP ('sse-uia-proxy-child-' + [guid]::NewGuid().ToString('N') + '.ps1')
[IO.File]::WriteAllText($childPath, $childScript, [Text.UTF8Encoding]::new($false))

# Die Ausgabe wird ueber Pipes gelesen, nicht ueber -RedirectStandardOutput in
# eine Datei: Start-Process haelt unter Windows PowerShell 5.1 das Handle der
# Umleitungsdatei bis zum naechsten Garbage-Collect offen, und das Loeschen der
# Datei scheiterte dadurch gelegentlich mit "wird von einem anderen Prozess
# verwendet". Waehrend das Kind laeuft, pumpt diese Schleife weiter Nachrichten
# fuer das Testfenster; die Leser laufen asynchron auf dem Threadpool.
function Invoke-Child([string]$Mode) {
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = 'powershell.exe'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Arguments = (@('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', ('"' + $childPath + '"'), '-Hwnd', $hwnd, '-Mode', $Mode, '-Dll', ('"' + $nativeDll + '"')) -join ' ')
  $process = [Diagnostics.Process]::Start($startInfo)
  $outputTask = $process.StandardOutput.ReadToEndAsync()
  $errorTask = $process.StandardError.ReadToEndAsync()
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not $process.HasExited) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 30
    if ([DateTime]::UtcNow -gt $deadline) { try { $process.Kill() } catch { }; throw "Kindprozess ($Mode) antwortete nicht innerhalb von 90 s." }
  }
  $process.WaitForExit()
  $raw = $outputTask.GetAwaiter().GetResult().Trim()
  $errorText = $errorTask.GetAwaiter().GetResult().Trim()
  $exitCode = $process.ExitCode
  $process.Dispose()
  Assert-True ($exitCode -eq 0) "Kindprozess ($Mode) endete mit Exit ${exitCode}: $raw $errorText"
  $parts = $raw.Split(';')
  Assert-True ($parts.Count -eq 3) "Kindprozess ($Mode) lieferte keine drei Werte: $raw"
  [pscustomobject]@{ nodes=[int]$parts[0]; titleBars=[int]$parts[1]; proxies=[int]$parts[2] }
}

try {
  $compiledFirst = Invoke-Child 'native-first'
  $powershellFirst = Invoke-Child 'powershell-first'
} finally {
  Remove-Item -LiteralPath $childPath -Force -ErrorAction SilentlyContinue
  $form.Close(); $form.Dispose()
}

# (2) Ohne vorangestellten PowerShell-Aufruf laedt der Client Proxies und
# zeigt die Titelleiste. Schlaegt das fehl, hat sich der UIA-Client geaendert.
Assert-True ($compiledFirst.proxies -eq 1) "Erster UIA-Aufruf aus kompiliertem Code lud keine Client-Side-Proxies mehr (Knoten=$($compiledFirst.nodes)). Die Proxy-Entscheidung des Workers muss neu bewertet werden."
Assert-True ($compiledFirst.titleBars -ge 1) "Mit geladenen Proxies fehlt die Titelleiste (Knoten=$($compiledFirst.nodes))."

# (1) Mit vorangestelltem PowerShell-Aufruf bleibt die Sicht proxyfrei.
Assert-True ($powershellFirst.proxies -eq 0) 'Nach einem ersten UIA-Aufruf aus PowerShell wurden trotzdem Client-Side-Proxies geladen; die Ergebnisvertraege des Workers gelten so nicht mehr.'
Assert-True ($powershellFirst.titleBars -eq 0) "Nach einem ersten UIA-Aufruf aus PowerShell erscheint eine Titelleiste im nativen Baumlauf (Knoten=$($powershellFirst.nodes))."
Assert-True ($powershellFirst.nodes -lt $compiledFirst.nodes) "Die proxyfreie Sicht ($($powershellFirst.nodes) Knoten) ist nicht kleiner als die Sicht mit Proxies ($($compiledFirst.nodes))."

Write-Output ("UIA-Proxy-Vertrag bestanden: kompiliert zuerst {0} Knoten/{1} Titelleiste(n), PowerShell zuerst {2} Knoten ohne Titelleiste" -f `
  $compiledFirst.nodes, $compiledFirst.titleBars, $powershellFirst.nodes)
