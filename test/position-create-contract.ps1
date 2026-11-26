$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'))
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
$workerFunctions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
. (Join-Path $PSScriptRoot '../powershell/structure-binding.ps1')
foreach ($name in @('Read-SSEPositionInventory','Read-PositionOverview','Assert-PositionRows','Read-NewPosition','Invoke-PositionButton',
  'Set-SSECursorPoint','Assert-SSECursorPoint')) {
  $functions = @($workerFunctions | Where-Object Name -CEQ $name)
  if ($functions.Count -ne 1) { throw "Funktionsvertrag fehlt: $name" }
  Invoke-Expression $functions[0].Extent.Text
}
function Assert-PositionEpoch {}
function Walk-Tree {
  if ($script:positionReadObservations -and $script:positionReadObservations.Count) {
    return $script:positionReadObservations.Dequeue()
  }
  $script:tree
}
function Get-CurrentHeading($Window,$Tree) {
  if ($Tree.heading) { return $Tree.heading }
  $script:heading
}
function Test-Canary { @{ok=$true} }
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
$guide = @{ type='Group'; aid='SSE.ClientFrameSSE.GuideViewer'; i=0; p=-1 }
$tree = @{ stats=@{ truncated=$false; err=0 }; nodes=@(
  $guide,
  @{ type='Hyperlink'; on=$true; aid=''; i=1; p=0; name=([string][char]187 + 'Example' + [char]171 + ' bearbeiten'); y=300 },
  @{ type='Hyperlink'; on=$true; aid=''; i=2; p=0; name=([string][char]187 + 'Example' + [char]171 + ' l' + [char]246 + 'schen'); y=300 },
  @{ type='Text'; on=$true; aid=''; i=3; p=0; name='100,00'; y=300 },
  @{ type='Custom'; on=$true; aid=''; i=4; p=0; name='100,00'; y=300 },
  @{ type='Hyperlink'; on=$true; aid=''; i=5; p=0; name='Weitere Position erfassen'; y=400 }
) }
$overview = Read-PositionOverview
if ($overview.createCaption -cne 'Weitere Position erfassen') { throw 'Gefuellte Uebersicht bindet nicht den weiteren Erfassungsbefehl.' }
Assert-PositionRows $overview.rows @(@{ name='Example'; net='100,00' })
Must-Fail { Assert-PositionRows $overview.rows @(@{ name='Example'; net='99,00' }) }
Must-Fail { Assert-PositionRows $overview.rows @() }
$namedNodes=@($tree.nodes)
$tree.nodes+=@(
  @{type='Hyperlink';on=$true;aid='';i=6;p=0;name=([string][char]187+'Synthetic draft'+[char]171+' erfassen');y=350},
  @{type='Text';on=$true;aid='';i=7;p=0;name='0,00';y=350}
)
$draftError='Die Uebersicht enthaelt eine unvollstaendige oder nicht lesbare Position; kein vollstaendiges Inventar.'
try { Read-PositionOverview | Out-Null; throw 'Teilbestand wurde akzeptiert.' } catch {
  if($_.Exception.Message -cne $draftError){throw}
}
$partialNodes=@($tree.nodes)
$operationSwitches=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.SwitchStatementAst]},$true))
$positionClauses=@($operationSwitches | ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Extent.Text -ceq "'positions'"})
if($positionClauses.Count -ne 1){throw 'Positionslese ist nicht eindeutig auffindbar.'}
$positionBody=$positionClauses[0].Item2.Extent.Text
$positionRead=[scriptblock]::Create($positionBody.Substring(1,$positionBody.Length-2))
function Invoke-FixturePositionRead {
  $state=[pscustomobject]@{result=$null};$sentinel=[OperationCanceledException]::new('Synthetic terminal Emit.')
  $a=[pscustomobject]@{aktion='list'}
  function Arg($Object,$Key,$Default=$null){if($Object.PSObject.Properties[$Key]){$Object.$Key}else{$Default}}
  function Resolve-SSEMainWindowDescriptor {[pscustomobject]@{hwnd=1}}
  function Emit($Result){$state.result=$Result;throw $sentinel}
  function Fail($Message,$Kind){Emit ([pscustomobject]@{ok=$false;kind=$Kind;error=$Message})}
  try{& $positionRead;throw 'Positionslese lieferte kein terminales Ergebnis.'}catch{if(-not[object]::ReferenceEquals($_.Exception,$sentinel)){throw}}
  $state.result
}
$partialResult=Invoke-FixturePositionRead
if($partialResult.ok -or $partialResult.kind -cne 'position-inventory-incomplete' -or $partialResult.error -cne $draftError){
  throw 'Tatsaechlicher Positionszweig verschweigt den generischen Teilbestand.'
}
foreach($validHeading in @($heading,('Betriebsausgaben: Eigene Positionen'))){
  $heading=$validHeading;$tree.nodes=$namedNodes
  $listed=Invoke-FixturePositionRead
  if(-not $listed.ok -or @($listed.positionen).Count -ne 1 -or $listed.positionen[0] -cne 'Example' -or
     $listed.anzahl -ne 1 -or $null -ne $listed.hinweis){throw 'Tatsaechlicher Positionszweig liest den gueltigen Bestand nicht vollstaendig.'}
}
$heading='Erl'+[char]246+'se Lieferungen/Leistungen'
$tree.nodes=$namedNodes
$providerFailure=@{stats=@{err=1;truncated=$false};nodes=$namedNodes}
$script:positionReadObservations=New-Object Collections.Queue
$script:positionReadObservations.Enqueue($providerFailure)
$script:positionReadObservations.Enqueue($tree)
$recovered=Invoke-FixturePositionRead
if(-not $recovered.ok -or $recovered.positionen[0] -cne 'Example' -or $script:positionReadObservations.Count){
  throw 'UIA observation error was not recovered with its own complete readback.'
}
$script:positionReadObservations.Enqueue($providerFailure)
$script:positionReadObservations.Enqueue(@{stats=$tree.stats;nodes=$namedNodes;heading='Betriebsausgaben: Eigene Positionen'})
$changed=Invoke-FixturePositionRead
if($changed.ok -or $changed.kind -cne 'position-inventory-incomplete' -or $script:positionReadObservations.Count){
  throw 'A retry accepted another page.'
}
$tree.nodes=@(
  $guide,
  @{type='Text';on=$true;aid='';i=1;p=0;name='Sie haben noch keine Angaben erfasst'},
  @{type='Hyperlink';on=$true;aid='';i=2;p=0;name='Position erfassen'}
)
$listed=Invoke-FixturePositionRead
if(-not $listed.ok -or @($listed.positionen).Count -ne 0 -or $listed.anzahl -ne 0 -or
   $listed.hinweis -cne 'Die vollstaendig gelesene Uebersicht enthaelt keine Positionen.'){
  throw 'Tatsaechlicher Positionszweig belegt den Leerbestand nicht.'
}
$tree.nodes=$partialNodes
$createClauses=@($operationSwitches | ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Extent.Text -ceq "'position_create'"})
if($createClauses.Count -ne 1){throw 'Positionsanlage ist nicht eindeutig auffindbar.'}
$createTries=@($createClauses[0].Item2.FindAll({param($node)
  $node -is [Management.Automation.Language.TryStatementAst] -and
  @($node.CatchClauses | Where-Object {$_.Body.Extent.Text.Contains("kind='position-create-incomplete'")}).Count -eq 1
},$true))
if($createTries.Count -ne 1){throw 'Tatsaechlicher Transaktionskoerper fehlt.'}
$createBody=[scriptblock]::Create($createTries[0].Extent.Text)
& {
  $state=[pscustomobject]@{result=$null;actions=0};$sentinel=[OperationCanceledException]::new('Synthetic terminal Emit.')
  $started=$false;$beforePositions=@();$afterPositions=@();$name='Must not be created'
  $expected=@([pscustomobject]@{name='Example';net='100,00'})
  function Invoke-PositionButton {$state.actions++;throw 'Unexpected mutation attempt.'}
  function Emit($Result){$state.result=$Result;throw $sentinel}
  try{& $createBody;throw 'Transaktion lieferte kein terminales Ergebnis.'}catch{if(-not[object]::ReferenceEquals($_.Exception,$sentinel)){throw}}
  if($state.actions -ne 0 -or $state.result.ok -or $state.result.kind -cne 'position-create-incomplete' -or
     $state.result.mutationStarted -or $state.result.cleanupRequired -or $state.result.rollback.attempted -or
     $state.result.error -cne $draftError){
    throw 'Ein versteckter Teilbestand erreichte die Mutation oder veraenderte den Fehlervertrag.'
  }
}
$tree.nodes=$namedNodes
$tree.stats.truncated = $true
Must-Fail { Read-PositionOverview }
$tree.stats.truncated = $false
$tree.nodes += @{ type='Text'; on=$true; aid=''; i=6; p=0; name='200,00'; y=300 }
Must-Fail { Read-PositionOverview }
$tree.nodes = @(
  $guide,
  @{ type='Text'; on=$true; aid=''; i=1; p=0; name='Sie haben noch keine Angaben erfasst' },
  @{ type='Hyperlink'; on=$true; aid='SSE.GuideViewer.Create'; i=2; p=0; name='Position erfassen' },
  @{ type='Button'; on=$true; aid=''; i=3; p=2; name='Position erfassen' }
)
$emptyOverview = Read-PositionOverview
if ($emptyOverview.rows.Count -ne 0 -or $emptyOverview.createCaption -cne 'Position erfassen') { throw 'Erste Position wurde nicht an die belegte leere Uebersicht gebunden.' }
$tree.nodes[1].on = $false
Must-Fail { Read-PositionOverview }
$tree.nodes[1].on = $true
$tree.nodes[2].name = 'Weitere Position erfassen'
Must-Fail { Read-PositionOverview }
$tree.nodes[2].name = 'Position erfassen'
$help=@{type='Group';aid='SSE.HelpViewer';i=10;p=-1}
$tree.nodes=@($help)+$tree.nodes
$tree.nodes[3].p = 10
Must-Fail { Read-PositionOverview }
$tree.nodes[3].p = 0
$tree.nodes += @{ type='Hyperlink'; on=$true; aid=''; i=4; p=0; name='Position erfassen' }
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
