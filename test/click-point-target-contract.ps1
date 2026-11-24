$ErrorActionPreference='Stop'
# Runs the real target selection of the physical click dispatcher. A screen
# coordinate carries no meaning by its sign: a window on a monitor left of or
# above the primary one has negative coordinates and is as clickable as any
# other. Whether the point belongs to the bound window is proven later, by the
# verified click itself. No desktop API is loaded here.
$worker=Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($worker,[ref]$null,[ref]$null)
$clause=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst]},$true) |
  ForEach-Object {$_.Clauses | Where-Object {$_.Item1.Extent.Text -ceq "'click_point'"} | ForEach-Object {$_.Item2}})
if ($clause.Count -ne 1) {throw 'Expected exactly one production physical click dispatcher.'}
$statements=@($clause[0].Statements)
$start=@(for($index=0;$index -lt $statements.Count;$index++) {
  if ($statements[$index].Extent.Text.StartsWith('$t = Walk-Tree')) {$index}
})
$end=@(for($index=0;$index -lt $statements.Count;$index++) {
  if ($statements[$index].Extent.Text.StartsWith('$py =')) {$index}
})
if ($start.Count -ne 1 -or $end.Count -ne 1 -or $end[0] -le $start[0]) {throw 'Target selection boundary is ambiguous.'}
$selection=[scriptblock]::Create(($statements[$start[0]..$end[0]].Extent.Text -join "`n"))
$argument=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Arg'},$true))
if ($argument.Count -ne 1) {throw 'Expected the real argument reader.'}
. ([scriptblock]::Create($argument[0].Extent.Text))

function Fail($Message,$Kind) {throw "$Kind`: $Message"}
function Walk-Tree {[pscustomobject]@{nodes=$script:candidates}}
function Resolve-Nodes {$script:candidates}
function Get-SSECheckerTreeItems {@()}
function Test-Versand {$false}
function Assert-SSEDestructiveAcknowledgement {}
function Select-Target($Candidates) {
  $script:candidates=@($Candidates)
  $hwnd=[IntPtr]7;$nm='Synthetic branch';$aid='';$checkerReadOnly=$false;$a=[pscustomobject]@{name='Synthetic branch'}
  . $selection
  [pscustomobject]@{node=$node;x=$px;y=$py}
}
function Get-Refusal($Candidates) {
  $refusal=$null
  try {$null=Select-Target $Candidates} catch {$refusal=$_.Exception.Message}
  $refusal
}
function New-Target([string]$Type,[string]$Name,[int]$X,[int]$Y,[int]$W,[int]$H) {
  [pscustomobject]@{type=$Type;name=$Name;aid='';rid='42.1';x=$X;y=$Y;w=$W;h=$H;on=$true}
}

$primary=Select-Target @(New-Target 'TreeItem' 'Synthetic branch' 120 300 260 22)
if ($primary.x -ne 170 -or $primary.y -ne 311) {throw 'A tree item on the primary monitor lost its label point.'}

$left=Select-Target @(New-Target 'TreeItem' 'Synthetic branch' -2400 300 260 22)
if ($left.node.x -ne -2400 -or $left.x -ne -2350 -or $left.y -ne 311) {
  throw 'A tree item on a monitor left of the primary one was not selected at its own label point.'
}

$above=Select-Target @(New-Target 'TreeItem' 'Synthetic branch' 120 -900 260 22)
if ($above.x -ne 170 -or $above.y -ne -889) {throw 'A tree item on a monitor above the primary one was not selected.'}

$link=Select-Target @(New-Target 'Hyperlink' 'Position erfassen' -2000 400 100 20)
if ($link.x -ne -1950 -or $link.y -ne 410) {throw 'A detail link on a monitor left of the primary one was not selected.'}

$flat=Get-Refusal @(New-Target 'TreeItem' 'Synthetic branch' -2400 300 0 22)
if ($flat -notlike 'blocked: *') {throw 'A tree item without a visible area became a physical target.'}

$button=Get-Refusal @(New-Target 'Button' 'Synthetic branch' -2400 300 260 22)
if ($button -notlike 'blocked: *') {throw 'A control outside the tree and detail-link policy became a physical target.'}

$foreignLink=Get-Refusal @(New-Target 'Hyperlink' 'Synthetic branch' 120 300 260 22)
if ($foreignLink -notlike 'blocked: *') {throw 'A link outside the detail-link policy became a physical target.'}

Write-Output 'click-point-target: tree items and detail links are selected on any monitor; area and control policy stay closed.'
