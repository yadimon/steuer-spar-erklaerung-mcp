$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$worker = [IO.File]::ReadAllText($workerPath)
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$functionNames = @(
  'Get-SSETextSha256',
  'Get-SSEPeerWindowSet',
  'Test-SSERecoveryPromptWindowCandidate',
  'Test-SSERecoveryPromptDescriptor',
  'Get-DialogDescriptor'
)
foreach ($functionName in $functionNames) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $functionName ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}

function Resolve-SSEClosableNonmodalWindowPolicy($Window) { $null }
$script:DIALOG_BUTTONS = @()

$minimizedMain = [pscustomobject]@{
  hwnd=101; pid=7; cls='Qt5152QWindowIcon'; title=('Musterfall - SteuerSparErkl' + [char]0x00E4 + 'rung 2025')
  titleFingerprint='A' * 64; x=-32000; y=-32000; w=160; h=30; hung=$false; minimiert=$true
}
$descriptor = Get-DialogDescriptor $minimizedMain ([IntPtr]::Zero)
if ($descriptor.kind -ne 'main' -or -not $descriptor.minimiert -or $descriptor.fingerprint) {
  throw 'Minimiertes SSE-Hauptfenster wird weiterhin als Dialog statt als main klassifiziert.'
}

$peer = [pscustomobject]@{
  hwnd=202; pid=7; cls='Qt5152QWindowIcon'; title='Steuer-Spar-Tipps'
  titleFingerprint='B' * 64; x=10; y=20; w=500; h=400; hung=$false; minimiert=$false
}
$before = Get-SSEPeerWindowSet @($minimizedMain, $peer) 7 ([IntPtr]101)
$targetChanged = $minimizedMain.PSObject.Copy()
$targetChanged.minimiert = $false; $targetChanged.x = 100; $targetChanged.w = 1200
$afterTargetRestore = Get-SSEPeerWindowSet @($targetChanged, $peer) 7 ([IntPtr]101)
if ($before.fingerprint -ne $afterTargetRestore.fingerprint -or $before.windows.Count -ne 1) {
  throw 'Zielzustand darf den ausschliesslich auf Peer-Fenster begrenzten Fingerprint nicht veraendern.'
}
$peerChanged = $peer.PSObject.Copy(); $peerChanged.titleFingerprint = 'C' * 64
$afterPeerChange = Get-SSEPeerWindowSet @($targetChanged, $peerChanged) 7 ([IntPtr]101)
if ($before.fingerprint -eq $afterPeerChange.fingerprint) {
  throw 'Eine Peer-Fensteraenderung muss den Restore-Readback-Fingerprint veraendern.'
}

$marker = "`n  'window_restore' {"
$start = $worker.IndexOf($marker, [StringComparison]::Ordinal)
if ($start -lt 0) { throw 'window_restore fehlt im Worker.' }
$next = $worker.IndexOf("`n  '", $start + $marker.Length, [StringComparison]::Ordinal)
$block = $worker.Substring($start, $(if ($next -ge 0) { $next - $start } else { $worker.Length - $start }))
foreach ($required in @(
  "Get-SSEBoundedIntegerArg `$a 'pid'",
  "Get-SSEBoundedIntegerArg `$a 'hwnd'",
  '$actualTitleFingerprint -ne $titleFingerprint',
  'Get-SSEMainWindowCandidates $beforeWindows',
  'Get-SSEPeerWindowSet $beforeWindows',
  'Get-SSEPeerWindowSet $afterWindows',
  '$peerWindowsUnchanged',
  '-not [bool]$afterTarget.minimiert',
  '[SW]::ShowWindow([IntPtr]$targetHwnd, 9)',
  "kind='postcondition-failed'"
)) {
  if (-not $block.Contains($required)) { throw "window_restore-Vertrag fehlt: $required" }
}
if ($block -match 'SendKeys|Click-VerifiedPoint|SetCursorPos|mouse_event|WM_CLOSE') {
  throw 'window_restore darf weder Tastatur/Maus/Koordinatenklick noch Fensterschliessen verwenden.'
}

Write-Output 'Window-Restore: minimiertes Hauptfenster, exakte Bindung und unveraenderte Peer-Fenster fail-closed verifiziert.'
