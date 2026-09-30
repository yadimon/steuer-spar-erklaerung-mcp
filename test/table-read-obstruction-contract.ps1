param([string]$WorkerPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'powershell\sse-worker.ps1'))
$ErrorActionPreference = 'Stop'
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($WorkerPath,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Worker cannot be parsed.' }
$clauses=@($ast.FindAll({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] },$true) |
  ForEach-Object { $_.Clauses } | Where-Object { $_.Item1.Extent.Text -ceq "'table_read'" })
if ($clauses.Count -ne 1) { throw 'Expected one real table_read dispatcher branch.' }
$statements=@($clauses[0].Item2.Statements)
function StatementIndex([string]$Prefix) {
  $matches=@(for($index=0;$index -lt $statements.Count;$index++) {
    if ($statements[$index].Extent.Text.StartsWith($Prefix,[StringComparison]::Ordinal)) { $index }
  })
  if ($matches.Count -ne 1) { throw ('Expected one statement: '+$Prefix) }
  [int]$matches[0]
}
$activationStart=StatementIndex '$geklickt ='
$stepsStart=StatementIndex '$schritte ='
$finishStart=StatementIndex '$dirtyAfter ='
$activation=[scriptblock]::Create(($statements[$activationStart..($stepsStart-1)].Extent.Text -join "`n"))
$completionNodes=@(
  $statements[(StatementIndex '$limitReached =')],
  $statements[(StatementIndex '$vollstaendig =')],
  $statements[(StatementIndex '$stopKind =')]
)
$completion=[scriptblock]::Create(($completionNodes.Extent.Text -join "`n"))
$finish=[scriptblock]::Create(($statements[$finishStart..($statements.Count-1)].Extent.Text -join "`n"))
$finalReadStart=StatementIndex '$vollstaendigerCursorbeweis ='
$limitStart=StatementIndex '$limitReached ='
if ($limitStart -le $finalReadStart) { throw 'Finaler Tabellenread steht nicht vor dem Abschlussbeweis.' }
$finalRead=[scriptblock]::Create(($statements[$finalReadStart..($limitStart-1)].Extent.Text -join "`n"))
$tableBranch=$clauses[0].Item2.Extent.Text
$lastAdd=$tableBranch.IndexOf('& $addSnapshotRows $snapshot',[StringComparison]::Ordinal)
$endProof=$tableBranch.IndexOf('$endProven = $true',[StringComparison]::Ordinal)
if ($lastAdd -lt 0 -or $endProof -le $lastAdd) {
  throw 'Der letzte Viewport muss vor dem Tabellen-Endbeweis aufgenommen werden.'
}

# No Win32 imports. These counters make any physical-input attempt a failure.
# The old activation block also runs against these doubles for the regression.
Add-Type -TypeDefinition @'
using System;
public static class SW {
  public struct PT { public int X; public int Y; }
  public static int InputCalls;
  public static int Releases;
  public static int HitPid;
  public static IntPtr HitRoot;
  public static IntPtr WindowFromPoint(PT point) { return new IntPtr(222); }
  public static IntPtr GetAncestor(IntPtr handle, int flags) { return HitRoot; }
  public static int GetWindowThreadProcessId(IntPtr handle, out int pid) {
    pid = handle.ToInt64() == 111 ? 7 : HitPid; return 1;
  }
  public static bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, int flags) {
    Releases++; return true;
  }
  public static bool SetCursorPos(int x, int y) { InputCalls++; throw new Exception("Unexpected physical input"); }
  public static void mouse_event(int flags, int x, int y, int data, IntPtr extra) {
    InputCalls++; throw new Exception("Unexpected physical input");
  }
}
'@
function Same($Actual,$Expected,[string]$Message) {
  if (($Actual | ConvertTo-Json -Depth 10 -Compress) -cne ($Expected | ConvertTo-Json -Depth 10 -Compress)) { throw $Message }
}
function Run-FinalReadCase([string]$Name,[bool]$Clicked,[bool]$EndProven,[int]$Steps,[int]$MaxSteps,
                           [bool]$CursorUnavailable,[bool]$IdentityMissing,[bool]$ReadError,[int]$ExpectedReads) {
  $script:finalReadCalls=0; $script:finalAdds=0; $script:finalReadError=$ReadError
  $hwnd=[IntPtr]111; $geklickt=$Clicked; $endProven=$EndProven
  $schritte=$Steps; $maxSchritte=$MaxSteps; $cursorUnavailable=$CursorUnavailable
  $identityState=[pscustomobject]@{ fehlend=$IdentityMissing }
  $addSnapshotRows={ param($snapshot) $script:finalAdds++ }
  function LiesZeilen($Window) {
    $script:finalReadCalls++
    [pscustomobject]@{ error=$(if ($script:finalReadError) { 'read failed' } else { $null }) }
  }
  . $finalRead
  Same $script:finalReadCalls $ExpectedReads "$Name`: falsche Anzahl finaler Viewport-Reads."
  Same $script:finalAdds $(if ($ReadError) { 0 } else { $ExpectedReads }) `
    "$Name`: finaler Viewport wurde trotz Lesefehler uebernommen oder trotz Erfolg verworfen."
}

Run-FinalReadCase 'vollstaendiger Endbeweis' $true $true 9 10 $false $false $false 0
Run-FinalReadCase 'max-rows' $true $true 10 10 $false $false $false 1
Run-FinalReadCase 'Cursor fehlt' $true $true 9 10 $true $false $false 1
Run-FinalReadCase 'Zeilenidentitaet fehlt' $true $true 9 10 $false $true $false 1
Run-FinalReadCase 'Ende nicht bewiesen' $true $false 9 10 $false $false $false 1
Run-FinalReadCase 'finaler Lesefehler' $true $false 9 10 $false $false $true 1
Run-FinalReadCase 'kein Cursor aktiviert' $false $false 0 10 $false $false $false 0
function Run-Observation([bool]$NoKeys,[string]$BlockerKind,[int]$HitPid,[int]$HitRoot) {
  [SW]::InputCalls=0; [SW]::Releases=0; [SW]::HitPid=$HitPid; [SW]::HitRoot=[IntPtr]$HitRoot
  $script:pointQueries=0; $script:raises=0; $script:captured=$null
  $hwnd=[IntPtr]111; $a=@{noKeys=$NoKeys}
  $erst=[pscustomobject]@{ersteZelle=[pscustomobject]@{x=10;y=20;w=40;h=24};tabelleAnzahl=1;bindung=[pscustomobject]@{sumLabel='Summe'}}
  $script:pointObservation=[pscustomobject]@{
    isBoundTarget=$false; blockerKind=$BlockerKind; processName='SyntheticBlocker'; className='SyntheticWindow'
    boundWindow=111;boundPid=7;hitWindow=222;hitRoot=$HitRoot;hitPid=$HitPid
    point=[pscustomobject]@{x=30;y=32}
  }
  function Arg($Arguments,$Name,$Default=$null) { $Arguments[$Name] }
  function Show-SSEWindow($Window) { $script:raises++ }
  function Start-Sleep([int]$Milliseconds) { }
  function Get-SSEPointObstruction($Window,$X,$Y) {
    Same ([int64]$Window) 111 'Wrong bound window.'
    Same @($X,$Y) @(30,32) 'Wrong cell point.'
    $script:pointQueries++; $script:pointObservation
  }
  function Get-DirtyStateFast($Window) { $false }
  function Emit($Result) { $script:captured=$Result; throw 'SSE_TEST_CAPTURED_RESULT' }
  $kopf=@('Datum','N','Betrag')
  $echte=@(@('15.01','', '10,00'),@('15.01','', '10,00'))
  $rowDetails=@(
    [pscustomobject]@{rowIndex=0;typedValues=@('15.01',$false,'10,00');semanticsComplete=$true},
    [pscustomobject]@{rowIndex=1;typedValues=@('15.01',$true,'10,00');semanticsComplete=$true}
  )
  $sumLabel='Summe'; $summe='20,00'; $summen=@([pscustomobject]@{label='Summe';wert='20,00';vorkommen=1})
  $dirtyBefore=$false; $identityState=@{fehlend=$false}; $endProven=$false
  $schritte=0; $maxSchritte=100; $stapel=0; $stapelGroesse=1; $stapelKorrekturen=0
  . $activation
  . $completion
  try { . $finish } catch { if ($_.Exception.Message -cne 'SSE_TEST_CAPTURED_RESULT') { throw } }
  Same ([SW]::InputCalls) 0 'Blocked or explicit visible-only read attempted physical input.'
  Same $script:captured.zeilen $echte 'Partial rows changed, including duplicates.'
  Same $script:captured.rowDetails $rowDetails 'Typed checkbox observations were lost.'
  Same $script:captured.summe $summe 'Observed sum was lost.'
  Same $script:captured.vollstaendig $false 'Unproven end was reported complete.'
  Same $script:captured.steps 0 'Blocked read must not send navigation keys.'
  Same $script:captured.ungespeichertEingefuehrt $false 'Read introduced dirty state.'
  [pscustomobject]@{result=$script:captured;pointQueries=$script:pointQueries;raises=$script:raises;releases=[SW]::Releases}
}

foreach($case in @(
  [pscustomobject]@{kind='foreign-app';pid=8;root=222},
  [pscustomobject]@{kind='same-process-other-window';pid=7;root=222}
)) {
  $blocked=Run-Observation $false $case.kind $case.pid $case.root
  Same $blocked.result.kind 'obstructed' 'Blocked table activation must be reported as obstructed.'
  Same $blocked.result.ok $false 'A blocked full read must be a failed operation.'
  Same $blocked.result.stopKind 'obstructed' 'Stop cause was hidden as visible-only.'
  Same $blocked.result.obstruction $script:pointObservation 'Point obstruction evidence changed.'
  Same @($blocked.pointQueries,$blocked.raises,$blocked.releases) @(1,1,1) 'Activation or cleanup count differs.'
}
$visible=Run-Observation $true 'foreign-app' 8 222
Same $visible.result.ok $true 'Explicit noKeys read stopped working.'
Same $visible.result.stopKind 'visible-only' 'Explicit noKeys read changed scope.'
Same @($visible.pointQueries,$visible.raises,$visible.releases) @(0,0,0) 'Explicit noKeys read touched the foreground.'
Same $visible.result.obstruction $null 'NoKeys result invented an obstruction.'
Write-Output 'table-read-obstruction: PASS'
