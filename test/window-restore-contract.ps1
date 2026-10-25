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
  'Get-SSEWindowRestorePeerSet',
  'Resolve-SSEClosableNonmodalWindowPolicy',
  'Test-SSERecoveryPromptWindowCandidate',
  'Test-SSERecoveryPromptDescriptor',
  'Test-SSEUpdatePromptDescriptor',
  'Test-SSESystemOverlayDescriptor',
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

$script:restoreCatalog=Get-Content -LiteralPath (Join-Path $root 'profiles\2025\page-objects.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Get-SSEPageObjects { $script:restoreCatalog }
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

function Restore-Record($Window, [bool]$Visible=$true, [bool]$Enabled=$true, [int64]$Owner=0, [int64]$RootOwner=0) {
  $record=$Window.PSObject.Copy()
  foreach ($entry in @{
    visible=$Visible; enabled=$Enabled; ownerHwnd=$Owner; rootOwnerHwnd=$RootOwner
    placementKnown=$true; normalX=200; normalY=300; normalW=640; normalH=480
  }.GetEnumerator()) { $record | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force }
  $record
}
function Assert-RestorePeerFailure($BeforeInventory, $AfterInventory, [string]$Reason) {
  $beforeSet=Get-SSEWindowRestorePeerSet $BeforeInventory 7 ([IntPtr]101)
  $afterSet=Get-SSEWindowRestorePeerSet $AfterInventory 7 ([IntPtr]101) $BeforeInventory
  if ($beforeSet.complete -and $afterSet.complete -and $beforeSet.windows.Count -eq $afterSet.windows.Count -and
      $beforeSet.fingerprint -ceq $afterSet.fingerprint) { throw $Reason }
}
$mainInventory=Restore-Record $minimizedMain $true $true 0 101
$restoredInventory=Restore-Record $targetChanged $true $true 0 101
$hiddenTool=Restore-Record $peer $false $true 101 101
$hiddenTool.title=[string]$script:restoreCatalog.windows.resultComparison.title
$hiddenTool.titleFingerprint=Get-SSETextSha256 $hiddenTool.title
$hiddenTool.x=200; $hiddenTool.y=300; $hiddenTool.w=640; $hiddenTool.h=480
$shownTool=$hiddenTool.PSObject.Copy(); $shownTool.visible=$true
$restoreBefore=@($mainInventory,$hiddenTool)
$hiddenBeforeSet=Get-SSEWindowRestorePeerSet $restoreBefore 7 ([IntPtr]101)
$shownAfterSet=Get-SSEWindowRestorePeerSet @($restoredInventory,$shownTool) 7 ([IntPtr]101) $restoreBefore
if (-not $shownAfterSet.complete -or $hiddenBeforeSet.windows.Count -ne 1 -or $shownAfterSet.windows.Count -ne 1 -or
    $shownAfterSet.restoreTransitionCount -ne 1 -or $shownAfterSet.fingerprint -cne $hiddenBeforeSet.fingerprint) {
  throw 'Vorhandenes verborgenes Eigentümer-gebundenes Werte-Info-Fenster wurde als neuer Peer behandelt.'
}
$minimizedTool=$shownTool.PSObject.Copy(); $minimizedTool.minimiert=$true
$minimizedTool.x=-32000; $minimizedTool.y=-32000; $minimizedTool.w=160; $minimizedTool.h=30
$minimizedInventory=@($mainInventory,$minimizedTool)
$minimizedSet=Get-SSEWindowRestorePeerSet $minimizedInventory 7 ([IntPtr]101)
$minimizedAfterSet=Get-SSEWindowRestorePeerSet @($restoredInventory,$shownTool) 7 ([IntPtr]101) $minimizedInventory
if ($minimizedAfterSet.restoreTransitionCount -ne 1 -or $minimizedSet.fingerprint -cne $minimizedAfterSet.fingerprint) {
  throw 'Vorhandenes minimiertes Werkzeugfenster mit unveraenderter Normalposition wurde nicht gebunden.'
}
Assert-RestorePeerFailure @($mainInventory) @($restoredInventory,$shownTool) 'Ein neu entstandenes bekanntes Werkzeugfenster wurde blind freigegeben.'
Assert-RestorePeerFailure $restoreBefore @($restoredInventory) 'Ein verschwundener alter Peer wurde freigegeben.'
$unknownHidden=$hiddenTool.PSObject.Copy(); $unknownHidden.title='Synthetic unknown dialog'; $unknownHidden.titleFingerprint=Get-SSETextSha256 $unknownHidden.title
$unknownShown=$unknownHidden.PSObject.Copy(); $unknownShown.visible=$true
Assert-RestorePeerFailure @($mainInventory,$unknownHidden) @($restoredInventory,$unknownShown) 'Ein unbekanntes verborgenes Fenster durfte erscheinen.'
$unownedHidden=$hiddenTool.PSObject.Copy(); $unownedHidden.ownerHwnd=0; $unownedHidden.rootOwnerHwnd=$unownedHidden.hwnd
$unownedShown=$unownedHidden.PSObject.Copy(); $unownedShown.visible=$true
Assert-RestorePeerFailure @($mainInventory,$unownedHidden) @($restoredInventory,$unownedShown) 'Gleiche PID und bekannter Titel ersetzten die Eigentümerbindung.'
$wrongMainHidden=$hiddenTool.PSObject.Copy(); $wrongMainHidden.rootOwnerHwnd=303
$wrongMainShown=$wrongMainHidden.PSObject.Copy(); $wrongMainShown.visible=$true
Assert-RestorePeerFailure @($mainInventory,$wrongMainHidden) @($restoredInventory,$wrongMainShown) 'Werkzeugfenster eines anderen Hauptfensters wurde freigegeben.'
$ownerChanged=$shownTool.PSObject.Copy(); $ownerChanged.ownerHwnd=303
Assert-RestorePeerFailure $restoreBefore @($restoredInventory,$ownerChanged) 'Geaenderte Eigentümeridentitaet wurde ignoriert.'
$placementChanged=$shownTool.PSObject.Copy(); $placementChanged.normalW++
Assert-RestorePeerFailure $restoreBefore @($restoredInventory,$placementChanged) 'Geaenderte Normalposition wurde ignoriert.'
$placementUnknown=$shownTool.PSObject.Copy(); $placementUnknown.placementKnown=$false
Assert-RestorePeerFailure $restoreBefore @($restoredInventory,$placementUnknown) 'Nicht nachgewiesene Normalposition wurde ignoriert.'
$disabledShown=$shownTool.PSObject.Copy(); $disabledShown.enabled=$false
Assert-RestorePeerFailure $restoreBefore @($restoredInventory,$disabledShown) 'Deaktiviertes/modales Peerfenster wurde normalisiert.'
$classChanged=$shownTool.PSObject.Copy(); $classChanged.cls='#32770'
Assert-RestorePeerFailure $restoreBefore @($restoredInventory,$classChanged) 'Ein Modal-Dialogklassentausch wurde normalisiert.'
$titleChanged=$shownTool.PSObject.Copy(); $titleChanged.titleFingerprint='D' * 64
Assert-RestorePeerFailure $restoreBefore @($restoredInventory,$titleChanged) 'Geaenderte Peer-Titelidentitaet wurde normalisiert.'
$visibleMoved=$shownTool.PSObject.Copy(); $visibleMoved.x++
Assert-RestorePeerFailure @($mainInventory,$shownTool) @($restoredInventory,$visibleMoved) 'Ein bereits sichtbarer Peer durfte unerwartet bewegt werden.'
$missingOwner=$shownTool.PSObject.Copy(); $missingOwner.PSObject.Properties.Remove('ownerHwnd')
Assert-RestorePeerFailure $restoreBefore @($restoredInventory,$missingOwner) 'Unvollstaendiges Peerinventar wurde freigegeben.'
Assert-RestorePeerFailure $restoreBefore @($restoredInventory,$shownTool,$shownTool) 'Doppelte HWND-Identitaet wurde freigegeben.'

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
  'Get-SSEWindowRestorePeerSet $beforeWindows',
  'Get-SSEWindowRestorePeerSet $afterWindows',
  '$afterWindows = @(Get-SSEWindowRestoreInventory $targetPid)',
  '$beforeWindows = @(Get-SSEWindowRestoreInventory $targetPid)',
  '$afterTarget.enabled',
  '-not $targetBefore.enabled',
  '$peerWindowsUnchanged',
  '-not [bool]$afterTarget.minimiert',
  '[SW]::ShowWindow([IntPtr]$targetHwnd, 9)',
  "kind='postcondition-failed'"
)) {
  if (-not $block.Contains($required)) { throw "window_restore-Vertrag fehlt: $required" }
}

$native=[IO.File]::ReadAllText((Join-Path $root 'powershell\sse-native.cs'))
foreach ($required in @(
  'return DescribeCore(allowedProcessIds, false);',
  'return DescribeCore(allowedProcessIds, true);',
  'if (!includeHidden && !visible) return true;',
  'node.OwnerHwnd = SW.GetWindow(hwnd, 4).ToInt64();',
  'node.RootOwnerHwnd = SW.GetAncestor(hwnd, 3).ToInt64();',
  'node.PlacementKnown = SW.GetWindowPlacement(hwnd, ref placement);',
  'EnsureEnumerationCompleted(completed, nativeError, callbacksVisited, callbackFailure);'
)) { if (-not $native.Contains($required)) { throw "Vollstaendiger Restore-Inventarvertrag fehlt: $required" } }
if ($block -match 'SendKeys|Click-VerifiedPoint|SetCursorPos|mouse_event|WM_CLOSE') {
  throw 'window_restore darf weder Tastatur/Maus/Koordinatenklick noch Fensterschliessen verwenden.'
}

Write-Output 'Window-Restore: minimiertes Hauptfenster, exakte Bindung und unveraenderte Peer-Fenster fail-closed verifiziert.'
