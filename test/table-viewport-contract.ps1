param([string]$WorkerPath=(Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-combobox.ps1')
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($WorkerPath,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Worker syntax failed.' }
foreach ($name in @('Get-SSETableReadViewportBounds','Test-SSETableReadViewportPoint','Find-SSETableReadViewportPoint')) {
  $functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($functions.Count -ne 1) { throw "Missing unique helper $name" }
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
# No real UIA, Win32, mouse or keyboard methods are imported.
Add-Type -TypeDefinition @'
namespace Windows { public class Point { public double X,Y; public Point(double x,double y) { X=x;Y=y; } } }
namespace System.Windows.Automation {
 public static class ControlType { public static string Table="Table",DataGrid="DataGrid"; }
}
public static class SyntheticHit {
 public static object Value; public static int Calls;
 public static object FromPoint(Windows.Point point) { Calls++;return Value; }
}
'@
$AE=[SyntheticHit]
function Get-SSEPointObstruction { [pscustomobject]@{isBoundTarget=$script:unobstructed} }
function Assert($Value,[string]$Message) { if (-not $Value) { throw $Message } }
function New-Node([int]$Index,[int]$Parent,[string]$Type,[int]$X,[int]$Y,[int]$Width,[int]$Height,[bool]$Enabled=$true) {
  [pscustomobject]@{i=$Index;p=$Parent;type=$Type;x=$X;y=$Y;w=$Width;h=$Height;on=$Enabled;
    rid="42.777.4.-$($Index+20)";aid=$(if ($Index -eq 0) {'Synthetic.Table'} else {"Synthetic.Table.$Index"})}
}
function New-Tree {
  [pscustomobject]@{stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0};nodes=@(
    (New-Node 0 -1 'Table' 100 100 300 200),
    (New-Node 1 0 'Header' 100 100 300 35),
    (New-Node 2 0 'DataItem' 104 140 286 32),
    (New-Node 3 0 'ScrollBar' 390 135 10 165 $false))}
}
function Reset-Hit {
  $script:unobstructed=$true
  $hit=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType='Table';AutomationId='Synthetic.Table';
    IsEnabled=$true;IsOffscreen=$false;BoundingRectangle=[pscustomobject]@{X=100;Y=100;Width=300;Height=200}};RuntimeId=@(42,777,4,-20)}
  $hit | Add-Member ScriptMethod GetRuntimeId { $this.RuntimeId }
  [SyntheticHit]::Value=$hit;[SyntheticHit]::Calls=0
}
$snapshot=[pscustomobject]@{navigationBinding=[pscustomobject]@{tableRootAid='Synthetic.Table';tableRootRid='42.777.4.-20'}}
$geometry=[pscustomobject]@{coordinateSpace='qt-native-screen';tableRect=@(0,0,200,133);viewportRect=@(2,24,194,106);
  nativeTableRect=@(100,100,300,200);nativeViewportRect=@(103,136,291,159)}
$tree=New-Tree;Reset-Hit
$bounds=Get-SSETableReadViewportBounds $tree $snapshot $geometry 144
Assert ($bounds -and $bounds.left -eq 103 -and $bounds.top -eq 136 -and $bounds.right -eq 394 -and $bounds.bottom -eq 295) 'Explicit native viewport mapping failed.'
Assert (Get-SSETableReadViewportBounds $tree $snapshot $geometry 144 @(100,100)) 'Exact inherited native client origin was rejected.'
Assert (-not (Get-SSETableReadViewportBounds $tree $snapshot $geometry 144 @(100))) 'Malformed inherited client origin was accepted.'
$moved=New-Tree;$moved.nodes[0].x+=20
Assert (-not (Get-SSETableReadViewportBounds $moved $snapshot $geometry 144 @(100,100))) 'Native table moved inside the unchanged client root before a key.'
$point=Find-SSETableReadViewportPoint 111 7 $tree $snapshot $bounds
Assert ($point -and $point.probeCount -le 64) 'A proved free viewport point was not found.'
Assert (Test-SSETableReadViewportPoint 111 7 $tree $snapshot $bounds $point.x $point.y) 'Exact direct Table point rejected.'
Assert (-not (Test-SSETableReadViewportPoint 111 7 $tree $snapshot $bounds 200 150)) 'Editable DataItem accepted.'
Assert (-not (Test-SSETableReadViewportPoint 111 7 $tree $snapshot $bounds 392 200)) 'Disabled scrollbar accepted.'

foreach ($kind in @('Header','HeaderItem','DataItem','ScrollBar','Button','Custom','Edit','ComboBox')) {
  $covered=New-Tree
  $covered.nodes+=New-Node 4 0 $kind 103 136 291 159 $false
  [SyntheticHit]::Calls=0
  Assert (-not (Find-SSETableReadViewportPoint 111 7 $covered $snapshot $bounds)) "Covered viewport accepted ($kind)."
  Assert ([SyntheticHit]::Calls -eq 0) 'Excluded bounds reached a hit test.'
}
foreach ($change in @(
  {param($t) $t.stats.truncated=$true},
  {param($t) $t.stats.depthLimited=$true},
  {param($t) $t.nodes[0].rid='wrong'},
  {param($t) $t.nodes[0].on=$false},
  {param($t) $t.nodes+=New-Node 4 0 'Edit' 120 200 100 20}
)) {
  $invalid=New-Tree;& $change $invalid
  Assert (-not (Get-SSETableReadViewportBounds $invalid $snapshot $geometry 144)) 'Invalid/editor tree accepted.'
}
Assert (Get-SSETableReadViewportBounds $tree $snapshot $geometry 120 @(100,100)) 'Windows DPI was incorrectly applied again to the explicit Qt native rectangle.'
Assert (-not (Get-SSETableReadViewportBounds $tree $snapshot $geometry 95)) 'Invalid window DPI accepted.'
foreach ($change in @(
  {param($g) $g.viewportRect[2]=201},
  {param($g) $g.nativeViewportRect[2]=301},
  {param($g) $g.nativeTableRect[0]+=20},
  {param($g) $g.nativeViewportRect[0]=102.5},
  {param($g) $g.coordinateSpace='qt-logical-screen'},
  {param($g) $g.PSObject.Properties.Remove('nativeTableRect')},
  {param($g) $g.PSObject.Properties.Remove('nativeViewportRect')}
)) {
  $invalidGeometry=$geometry | ConvertTo-Json -Depth 4 | ConvertFrom-Json
  & $change $invalidGeometry
  Assert (-not (Get-SSETableReadViewportBounds $tree $snapshot $invalidGeometry 144)) 'Foreign, missing or malformed producer geometry accepted.'
}

foreach ($change in @(
  {param($h) $h.Current.ControlType='DataItem'}, # Same Table ancestor must not suffice.
  {param($h) $h.Current.ProcessId=8},
  {param($h) $h.Current.AutomationId='Wrong.Table'},
  {param($h) $h.RuntimeId=@(42,777,4,-99)},
  {param($h) $h.Current.IsEnabled=$false},
  {param($h) $h.Current.IsOffscreen=$true},
  {param($h) $h.Current.BoundingRectangle.Width=299}
)) {
  Reset-Hit;& $change ([SyntheticHit]::Value)
  Assert (-not (Test-SSETableReadViewportPoint 111 7 $tree $snapshot $bounds 200 250)) 'Wrong direct hit accepted.'
}
Reset-Hit;$script:unobstructed=$false
Assert (-not (Test-SSETableReadViewportPoint 111 7 $tree $snapshot $bounds 200 250)) 'Foreign obstruction accepted.'
Write-Output 'table-viewport-contract: explicit native geometry/direct-hit/exclusions/no-space checks passed'
