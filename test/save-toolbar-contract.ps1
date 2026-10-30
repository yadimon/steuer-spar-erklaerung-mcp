# Fuehrt den unveraenderten save-Dispatcher mit synthetischen Datei-/UI-Grenzen
# aus. Keine Funktion dieses Tests startet Prozesse oder bedient ein Fenster.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell/sse-worker.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Get-SSESaveToolbarNode', 'Test-SSEImmutableSavedCaseIdentity')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $name ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}
$clause = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true) |
  ForEach-Object { $_.Clauses } | Where-Object { $_.Item1.Extent.Text -ceq "'save'" })
if ($clause.Count -ne 1) { throw 'Der echte save-Dispatcher fehlt oder ist mehrdeutig.' }
$saveBody = [scriptblock]::Create((@($clause[0].Item2.Statements | ForEach-Object { $_.Extent.Text }) -join "`n"))
$script:Scenarios = 0
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Arg($Object, [string]$Name, $Default = $null) {
  if ($Object.ContainsKey($Name)) { return $Object[$Name] }
  $Default
}
function Fail([string]$Message, [string]$Kind) {
  $error = [InvalidOperationException]::new($Message); $error.Data['kind'] = $Kind; throw $error
}
function Emit($Result) {
  $error = [InvalidOperationException]::new('synthetic-result'); $error.Data['result'] = $Result; throw $error
}
function Test-Path { param([string]$LiteralPath, [string]$PathType) $true }
function Resolve-SSEMainWindowDescriptor { param($Args, [switch]$RestoreMinimized) [pscustomobject]@{ hwnd=4242 } }
function Get-Windows { param([string]$Filter) [pscustomobject]@{ hwnd=4242; pid=4711 } }
function Test-CaseBinding { param($Window, [string]$Path) [pscustomobject]@{ ok=$true } }
function Get-Sha256 { param([string]$Path) $(if ($script:Invokes) { 'B' * 64 } else { 'A' * 64 }) }
function Get-Item { param([string]$LiteralPath) [pscustomobject]@{ LastWriteTimeUtc=[datetime]'2025-01-01T00:00:00Z' } }
function Get-CaseSummary {
  param([string]$Path)
  [pscustomobject]@{ transmitted=$false; header=[pscustomobject]@{
    FileType='GewErfass'; VJahr='2026'; Steuernummer=''; ElsterTransferTime=''; MitElsterVersendetText=''; FileSavedBy='31'
  } }
}
function Walk-Tree {
  param([IntPtr]$Hwnd, [int]$Limit)
  [pscustomobject]@{ nodes=$(if ($script:Invokes) { $script:AfterNodes } else { $script:BeforeNodes }) }
}
function ConvertTo-Vergleichsform([string]$Value) { $Value.ToLowerInvariant().Replace(' ', '') }
function Get-LiveElement {
  param([IntPtr]$Hwnd, [string]$Rid, [string]$Aid)
  $null = $script:LiveBindings.Add([pscustomobject]@{ hwnd=[int64]$Hwnd; rid=$Rid; aid=$Aid })
  $script:LiveElement
}
function Get-DialogInventory { @() }
function Wait-SSESaveButtonDisabled { param($SaveElement, [int]$TimeoutMs, [int]$ConfirmMs) $true }
function New-SaveNode([string]$Name = '', $Enabled = $true, [string]$Aid = 'App.MainToolBar.tb_sichern', [string]$Type = 'Button') {
  [pscustomobject]@{ type=$Type; name=$Name; aid=$Aid; rid='42.1.2'; on=$Enabled }
}
function Reset-Case {
  $script:Invokes = 0; $script:LiveBindings = New-Object System.Collections.ArrayList
  $script:BeforeNodes = @(New-SaveNode)
  $script:AfterNodes = @(New-SaveNode '' $false)
  $script:LiveElement = [pscustomobject]@{ Current=[pscustomobject]@{
    AutomationId='App.MainToolBar.tb_sichern'; ControlType=[pscustomobject]@{ ProgrammaticName='ControlType.Button' }; IsEnabled=$true
  }; RuntimeId=@(42,1,2) }
  $script:LiveElement | Add-Member -MemberType ScriptMethod -Name GetRuntimeId -Value { $this.RuntimeId }
  $script:LiveElement | Add-Member -MemberType ScriptMethod -Name GetCurrentPattern -Value {
    param($Pattern)
    Assert-True ($Pattern -eq [System.Windows.Automation.InvokePattern]::Pattern) 'Unbeauftragtes Pattern.'
    $invoke = [pscustomobject]@{}
    $invoke | Add-Member -MemberType ScriptMethod -Name Invoke -Value { $script:Invokes++ }
    $invoke
  }
}
function Invoke-SaveCase {
  $script:Scenarios++
  $a = @{ expectedPath=(Join-Path $root 'synthetic.GewErfass2026'); expectedHashBefore=('A' * 64) }
  try { & $saveBody; throw 'save gab kein Ergebnis zurueck.' }
  catch {
    if ($_.Exception.Data.Contains('result')) { return $_.Exception.Data['result'] }
    if ($_.Exception.Data.Contains('kind')) { return [pscustomobject]@{ ok=$false; kind=$_.Exception.Data['kind']; error=$_.Exception.Message } }
    throw
  }
}
function Assert-Rejected([string]$Kind, [string]$Label, [int]$ExpectedInvokes = 0) {
  $result = Invoke-SaveCase
  Assert-True ($result.ok -eq $false -and $result.kind -ceq $Kind -and $script:Invokes -eq $ExpectedInvokes) `
    "$Label : falsches Ergebnis oder unzulaessiger Schreibversuch ($($result | ConvertTo-Json -Compress), Invokes=$script:Invokes)."
}

# Name ist Darstellungsmetadatum; die Hauptsymbolleiste und RuntimeId binden.
foreach ($name in @('', 'Sichern', 'Speichern')) {
  Reset-Case; $script:BeforeNodes = @(New-SaveNode $name); $script:AfterNodes = @(New-SaveNode $name $false)
  $result = Invoke-SaveCase
  Assert-True ($result.ok -eq $true -and $result.saved -eq $true -and $result.verified -eq $true -and $script:Invokes -eq 1) 'Der gebundene Sichern-Schalter wurde nicht genau einmal verifiziert gespeichert.'
  Assert-True ($script:LiveBindings.Count -eq 1 -and $script:LiveBindings[0].hwnd -eq 4242 -and
    $script:LiveBindings[0].rid -ceq '42.1.2' -and $script:LiveBindings[0].aid -ceq 'App.MainToolBar.tb_sichern') 'Der Live-Schalter verlor seine exakte Fenster-/AID-/RuntimeId-Bindung.'
}
Reset-Case
$script:BeforeNodes = @((New-SaveNode), (New-SaveNode 'Sichern' $true 'App.OtherToolbar.tb_sichern'))
Assert-True ((Invoke-SaveCase).saved -eq $true -and $script:Invokes -eq 1) 'Ein fremder gleichnamiger Schalter verdraengte die Hauptsymbolleiste.'

foreach ($node in @(
  (New-SaveNode 'Sichern' $true 'App.OtherToolbar.tb_sichern'),
  (New-SaveNode 'Sichern' $true 'App.MainToolBar.tb_sichern.extra'),
  (New-SaveNode 'Sichern' $true 'App.MainToolBar.tb_sichern' 'MenuItem')
)) {
  Reset-Case; $script:BeforeNodes = @($node); Assert-Rejected 'not-found' 'Falsche Toolbar/Endung/Typ'
}
Reset-Case; $script:BeforeNodes = @(); Assert-Rejected 'not-found' 'Fehlender Schalter'
Reset-Case; $script:BeforeNodes = @((New-SaveNode), (New-SaveNode)); Assert-Rejected 'not-found' 'Mehrdeutige Hauptsymbolleiste'
foreach ($state in @($null, '', 'False', 0)) {
  Reset-Case; $script:BeforeNodes = @(New-SaveNode '' $state); Assert-Rejected 'unreadable' 'Unlesbarer Snapshot-Aktivierungszustand'
}
Reset-Case; $script:BeforeNodes = @(New-SaveNode '' $false); $script:LiveElement.Current.IsEnabled = $false
$result = Invoke-SaveCase
Assert-True ($result.ok -eq $true -and $result.saved -eq $false -and $result.noChanges -eq $true -and $result.verified -eq $true -and $script:Invokes -eq 0) 'Bestaetigt deaktiviertes Sichern verlor seinen No-op-Vertrag.'
Reset-Case; $script:BeforeNodes = @(New-SaveNode '' $false); Assert-Rejected 'stale' 'Aktivierung nach Snapshot'
Reset-Case; $script:LiveElement.Current.IsEnabled = $false; Assert-Rejected 'stale' 'Deaktivierung nach Snapshot'
Reset-Case; $script:LiveElement = $null; Assert-Rejected 'stale' 'Fehlendes Live-Element'
Reset-Case; $script:LiveElement.Current.AutomationId = 'App.OtherToolbar.tb_sichern'; Assert-Rejected 'stale' 'Geaenderte Live-AID'
Reset-Case; $script:LiveElement.Current.ControlType.ProgrammaticName = 'ControlType.MenuItem'; Assert-Rejected 'stale' 'Geaenderter Live-Typ'
Reset-Case; $script:LiveElement.RuntimeId = @(42,9,9); Assert-Rejected 'stale' 'Geaenderte RuntimeId'
Reset-Case; $script:BeforeNodes[0].rid = ''; Assert-Rejected 'stale' 'Fehlende Snapshot-RuntimeId'
foreach ($state in @($null, '', 'False', 0)) {
  Reset-Case; $script:LiveElement.Current.IsEnabled = $state; Assert-Rejected 'unreadable' 'Unlesbarer Live-Aktivierungszustand'
}
Reset-Case
$script:LiveElement | Add-Member -Force -MemberType ScriptProperty -Name Current -Value { throw 'synthetischer Lesefehler' }
Assert-Rejected 'stale' 'Fehlgeschlagene Live-Lesung'

# Nach bereits ausgefuehrtem Invoke braucht auch die neue Nachlesung dieselbe
# eindeutige Toolbar und einen echten boolschen Zustand. Kein zweiter Invoke.
foreach ($case in @(
  [pscustomobject]@{ nodes=@() },
  [pscustomobject]@{ nodes=@((New-SaveNode '' $false 'App.OtherToolbar.tb_sichern')) },
  [pscustomobject]@{ nodes=@((New-SaveNode '' $false), (New-SaveNode '' $false)) },
  [pscustomobject]@{ nodes=@((New-SaveNode '' $null)) },
  [pscustomobject]@{ nodes=@((New-SaveNode '' 'False')) },
  [pscustomobject]@{ nodes=@((New-SaveNode '' $true)) }
)) {
  Reset-Case; $script:AfterNodes = $case.nodes; Assert-Rejected 'postcondition-failed' 'Unbestaetigter Speicherabschluss' 1
}
Write-Output 'Sichern: echte Dispatcher-Abnahme fuer namenlose Toolbar, exakte Live-Bindung, No-op und konservative Fehl-/Nachlesepfade bestanden.'

# Auch normales close muss einen namenlosen Dirty-Schalter erkennen und einen
# fehlenden/unlesbaren Schalter als unbekannt behandeln. Das synthetische SW
# kann nur einen Zaehler erhoehen; es enthaelt keinen Windows-API-Aufruf.
Add-Type -TypeDefinition @'
using System;
public static class SW {
  public static int CloseCalls;
  public static IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam,
    uint flags, uint timeout, ref IntPtr result) { CloseCalls++; return new IntPtr(1); }
}
'@
$closeClause = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true) |
  ForEach-Object { $_.Clauses } | Where-Object { $_.Item1.Extent.Text -ceq "'close'" })
Assert-True ($closeClause.Count -eq 1) 'Der echte close-Dispatcher fehlt oder ist mehrdeutig.'
$closeBody = [scriptblock]::Create((@($closeClause[0].Item2.Statements | ForEach-Object { $_.Extent.Text }) -join "`n"))
function Get-SSEProcesses { [pscustomobject]@{ Id=4711 } }
function Get-Windows { param([string]$Filter) [pscustomobject]@{ hwnd=4242; pid=4711; w=1200; h=900; title='Synthetic case' } }
function Get-Process { param([int]$Id) [pscustomobject]@{ Id=4711 } }
function Get-SSEPinnedProcessHandle { param($Process) [pscustomobject]@{ synthetic=$true } }
function Test-SSEProcess { param($Process) $true }
function Get-SSEMainWindowCandidates { param($Windows) $Windows }
function Wait-SSECloseOutcome { param($Handle, [int]$ProcessId, [int]$TimeoutMs) [pscustomobject]@{ stillRunning=$false; dialogs=@() } }
function Wait-SSEProcessExit { param($Handle, [int]$TimeoutMs) $false }
function Stop-Process { throw 'Ein harter Stop ist in dieser Abnahme unzulaessig.' }
function Invoke-CloseCase([hashtable]$Extra = @{}) {
  $script:Scenarios++
  [SW]::CloseCalls = 0
  $a = @{ pid=4711 }
  foreach ($key in $Extra.Keys) { $a[$key] = $Extra[$key] }
  try { & $closeBody; throw 'close gab kein Ergebnis zurueck.' }
  catch {
    if ($_.Exception.Data.Contains('result')) { return $_.Exception.Data['result'] }
    if ($_.Exception.Data.Contains('kind')) { return [pscustomobject]@{ ok=$false; kind=$_.Exception.Data['kind']; error=$_.Exception.Message } }
    throw
  }
}
foreach ($name in @('', 'Sichern')) {
  Reset-Case; $script:BeforeNodes = @(New-SaveNode $name $true)
  $result = Invoke-CloseCase
  Assert-True ($result.ok -eq $false -and $result.kind -ceq 'confirmation-required' -and [SW]::CloseCalls -eq 0) 'close hat namenlose ungespeicherte Aenderungen nicht vor WM_CLOSE abgewiesen.'
  Reset-Case; $script:BeforeNodes = @(New-SaveNode $name $false)
  $result = Invoke-CloseCase
  Assert-True ($result.ok -eq $true -and $result.killed -eq $false -and $result.stillRunning -eq $false -and [SW]::CloseCalls -eq 1) 'close bestaetigte den lesbar sauberen Fall nicht mit genau einem regulaeren WM_CLOSE.'
}
foreach ($case in @(
  [pscustomobject]@{ nodes=@() },
  [pscustomobject]@{ nodes=@((New-SaveNode 'Sichern' $true 'App.OtherToolbar.tb_sichern')) },
  [pscustomobject]@{ nodes=@((New-SaveNode), (New-SaveNode)) },
  [pscustomobject]@{ nodes=@((New-SaveNode '' $null)) },
  [pscustomobject]@{ nodes=@((New-SaveNode '' 'False')) }
)) {
  Reset-Case; $script:BeforeNodes = $case.nodes
  $result = Invoke-CloseCase
  Assert-True ($result.ok -eq $false -and $result.kind -ceq 'state-unknown' -and [SW]::CloseCalls -eq 0) 'close deutete eine fehlende/uneindeutige/unlesbare Toolbar als gesichert um.'
}
Reset-Case
$result = Invoke-CloseCase @{ save=$true }
Assert-True ($result.ok -eq $false -and $result.kind -ceq 'confirmation-required' -and [SW]::CloseCalls -eq 0 -and $script:Invokes -eq 0) 'close(save=true) darf keinen eigenen Speicherweg oeffnen.'
Write-Output 'Schliessen: gleicher Toolbarvertrag, unbekannte Zustaende bleiben gesperrt; close(save=true) bleibt ohne Speicherversuch abgewiesen.'
Write-Output "Echte Dispatcher-Faelle: $script:Scenarios"
