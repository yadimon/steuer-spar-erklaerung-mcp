$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'))
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
foreach ($name in @('Read-PositionOverview','Assert-PositionRows','Read-NewPosition','Invoke-PositionButton',
  'Set-SSECursorPoint','Assert-SSECursorPoint')) {
  $functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true))
  if ($functions.Count -ne 1) { throw "Funktionsvertrag fehlt: $name" }
  Invoke-Expression $functions[0].Extent.Text
}
function Assert-PositionEpoch {}
function Walk-Tree { $script:tree }
function Get-CurrentHeading { $script:heading }
function Read-LabeledValueFromTree { @{ value='0,00'; candidateCount=1 } }
function Test-SSEScalarEqual($left,$right) { $left -eq $right }
function Get-SSETableRegion { $script:region }
function Must-Fail([scriptblock]$Action) {
  $failed = $false
  try { & $Action | Out-Null } catch { $failed = $true }
  if (-not $failed) { throw 'Unsicherer Positionszustand wurde akzeptiert.' }
}
$hwnd = [IntPtr]1
$heading = 'Erl' + [char]246 + 'se Lieferungen/Leistungen'
$tree = @{ stats=@{ truncated=$false; err=0 }; nodes=@(
  @{ type='Hyperlink'; on=$true; aid='SSE.GuideViewer.Link'; name=([string][char]187 + 'Example' + [char]171 + ' bearbeiten'); y=300 },
  @{ type='Text'; on=$true; aid='SSE.GuideViewer.Amount'; name='100,00'; y=300 },
  @{ type='Custom'; on=$true; aid='SSE.GuideViewer.Amount'; name='100,00'; y=300 },
  @{ type='Hyperlink'; on=$true; aid='SSE.GuideViewer.Create'; name='Weitere Position erfassen'; y=400 }
) }
$overview = Read-PositionOverview
if ($overview.createCaption -cne 'Weitere Position erfassen') { throw 'Gefuellte Uebersicht bindet nicht den weiteren Erfassungsbefehl.' }
Assert-PositionRows $overview.rows @(@{ name='Example'; net='100,00' })
Must-Fail { Assert-PositionRows $overview.rows @(@{ name='Example'; net='99,00' }) }
Must-Fail { Assert-PositionRows $overview.rows @() }
$tree.stats.truncated = $true
Must-Fail { Read-PositionOverview }
$tree.stats.truncated = $false
$tree.nodes += @{ type='Text'; on=$true; aid='SSE.GuideViewer.Amount'; name='200,00'; y=300 }
Must-Fail { Read-PositionOverview }
$tree.nodes = @(
  @{ type='Text'; on=$true; aid='SSE.GuideViewer.Empty'; name='Sie haben noch keine Angaben erfasst' },
  @{ type='Hyperlink'; on=$true; aid='SSE.GuideViewer.Create'; name='Position erfassen' },
  @{ type='Button'; on=$true; aid='SSE.GuideViewer.Create.Button'; name='Position erfassen' }
)
$emptyOverview = Read-PositionOverview
if ($emptyOverview.rows.Count -ne 0 -or $emptyOverview.createCaption -cne 'Position erfassen') { throw 'Erste Position wurde nicht an die belegte leere Uebersicht gebunden.' }
$tree.nodes[0].on = $false
Must-Fail { Read-PositionOverview }
$tree.nodes[0].on = $true
$tree.nodes[1].name = 'Weitere Position erfassen'
Must-Fail { Read-PositionOverview }
$tree.nodes[1].name = 'Position erfassen'
$tree.nodes[1].aid = 'SSE.HelpViewer.Create'
Must-Fail { Read-PositionOverview }
$tree.nodes[1].aid = 'SSE.GuideViewer.Create'
$tree.nodes += @{ type='Hyperlink'; on=$true; aid='SSE.GuideViewer.Duplicate'; name='Position erfassen' }
Must-Fail { Read-PositionOverview }
$tree.nodes = @()
Must-Fail { Read-PositionOverview }
$heading = 'Einnahmen: New example'
$tree.nodes = @(
  @{ type='Edit'; aid='SSE.DialogUI.Field.Text'; val='New example'; ro=$false },
  @{ type='ComboBox'; aid='SSE.DialogUI.AuswahlUStSatz'; val='19' }
)
$region = @{ ok=$true; cells=@(@{ name='' },@{ name='0,00' }) }
$expected = @(@{ name='Example'; net='100,00' })
$null = Read-NewPosition 'New example' $true
Must-Fail { Read-NewPosition 'Other example' $true }
$tree.nodes[1].val = '7'
Must-Fail { Read-NewPosition 'New example' $true }
$tree.nodes[1].val = '19'
$region.cells += @{ name='Invoice already present' }
Must-Fail { Read-NewPosition 'New example' $true }
Write-Output 'Positionsanlage: exakte Inventare, eindeutige Summen, leere Tabelle, Name und Steuersatz geprueft.'
Add-Type @'
public static class SW {
  public struct PT { public int X,Y; }
  public static int Clicks, X, Y;
  public static bool CursorSetAccepted=true, CursorReadable=true, CursorDrift=false;
  public static bool SetCursorPos(int x,int y) { X=x; Y=y; return CursorSetAccepted; }
  public static bool GetCursorPos(out PT p) { p=new PT { X=X+(CursorDrift?1:0),Y=Y }; return CursorReadable; }
  public static void mouse_event(int f,int x,int y,int d,System.IntPtr p) { Clicks++; }
}
'@
function Fail { param($message,$kind) throw "$kind`: $message" }
function Show-SSEWindow { $true }
function Get-LiveElement { $script:live }
function Get-SSEPointObstruction { @{ isBoundTarget=$script:unobstructed } }
function Get-SSELastInputTick { 123 }
function Set-SSEForegroundLeaseInputCheckpoint {}
$targetPid = 42
$caption = 'Weitere Position erfassen'
$tree.nodes = @(@{ type='Hyperlink'; aid='SSE.GuideViewer.Create'; name=$caption; on=$true; x=10; y=20; rid='synthetic' })
$live = @{ Current=@{ ProcessId=42; Name=$caption; BoundingRectangle=@{ X=10; Y=20; Width=80; Height=30 } } }
$unobstructed = $true
Invoke-PositionButton $tree $caption
if ([SW]::Clicks -ne 2) { throw 'Gebundener Positionsbefehl muss genau einen Klick senden.' }
$unobstructed = $false
Must-Fail { Invoke-PositionButton $tree $caption }
$unobstructed = $true
$live.Current.ProcessId = 43
Must-Fail { Invoke-PositionButton $tree $caption }
$live.Current.ProcessId = 42
$live.Current.BoundingRectangle.X = 200
Must-Fail { Invoke-PositionButton $tree $caption }
if ([SW]::Clicks -ne 2) { throw 'Verdecktes, fremdes oder verschobenes Ziel wurde angeklickt.' }
$live.Current.BoundingRectangle.X = 10
$caption = 'Position erfassen'
$tree.nodes[0].name = $caption
$live.Current.Name = $caption
$started = $false
Invoke-PositionButton $tree $caption
if (-not $started -or [SW]::Clicks -ne 4) { throw 'Erster Erfassungsbefehl wurde wiederholt oder nicht als begonnene Mutation markiert.' }
foreach ($failure in @('set-denied','read-failed','drift')) {
  [SW]::CursorSetAccepted=($failure -ne 'set-denied')
  [SW]::CursorReadable=($failure -ne 'read-failed')
  [SW]::CursorDrift=($failure -eq 'drift')
  $started=$false
  Must-Fail { Invoke-PositionButton $tree $caption }
  if ($started -or [SW]::Clicks -ne 4) { throw 'Ein verweigerter oder verschobener Cursor begann eine Mutation.' }
}
[SW]::CursorSetAccepted=$true; [SW]::CursorReadable=$true; [SW]::CursorDrift=$false
Set-SSECursorPoint 10 20
[SW]::X=11
Must-Fail { Assert-SSECursorPoint 10 20 }
Write-Output 'Positionsbefehl: genau ein Klick, fremde PID, Ueberdeckung und Geometriedrift blockiert.'
