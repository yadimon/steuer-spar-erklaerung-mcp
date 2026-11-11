$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../powershell/structure-binding.ps1')
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Read-SSESearchRegion','Get-SSESearchTree')){
  $definitions=@($ast.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  },$true))
  if($definitions.Count -ne 1){throw "Missing production search reader: $name"}
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$activation=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-SSESearchActivationSnapshot'
},$true))[0]
$treeAssignments=@($activation.FindAll({param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$tree'
},$true))
if($treeAssignments.Count -ne 1 -or $treeAssignments[0].Right.Extent.Text -cne 'Get-SSESearchTree $Window'){
  throw 'The click binding still relies on a whole-window snapshot.'
}
function Assert($Condition,$Message){if(-not $Condition){throw $Message}}
function Node([int]$I,[int]$Parent,$Type,$Aid,$Name,$Prefix){
  @{i=$I;p=$Parent;d=0;type=$Type;aid=$Aid;name=$Name;rid=($Prefix+'.'+$I);
    x=100;y=220;w=500;h=30;on=$true}
}
function Part($Floating=$false,$WithoutTable=$false){
  $frame='Synthetic.Main.centralWidget.SearchSplitter.SearchFrameSSE'
  $rootAid=$(if($Floating){'Synthetic.Main.QWidget.SearchResultsView'}else{$frame})
  $prefix=$(if($Floating){'floating'}else{'frame'})
  $root=Node 0 -1 'Group' $rootAid '' ($prefix+'-root')
  $root.h=400
  if($Floating){
    $table=$rootAid+'.QStackedWidget.DialogSearchResultsTableView'
    $nodes=@((Node 0 -1 'Group' ($rootAid+'.QStackedWidget') '' $prefix),
      (Node 1 0 'Table' $table '' $prefix),(Node 2 1 'DataItem' $table 'Target page' $prefix))
    $nodes[1].h=150
  }else{
    $nodes=@((Node 0 -1 'Group' ($frame+'.QWidget') '' $prefix),
      (Node 1 0 'Edit' ($frame+'.QWidget.SearchSSE.QLineEdit') '' $prefix),
      (Node 2 -1 'Group' ($frame+'.QWidget') '' $prefix),
      (Node 3 2 'Button' ($frame+'.QWidget.HoverButton') 'Trefferliste aus-/einklappen' $prefix))
    if(-not $WithoutTable){
      $view=$frame+'.SearchResultsView';$table=$view+'.QStackedWidget.DialogSearchResultsTableView'
      $nodes+=Node 4 -1 'Group' $view '' $prefix
      $nodes+=Node 5 4 'Table' $table '' $prefix
      $nodes+=Node 6 5 'DataItem' $table 'Target page' $prefix
      $nodes[5].h=150
    }
  }
  [pscustomobject]@{root=$root;windowKey='synthetic-window';tree=[pscustomobject]@{nodes=$nodes;
    stats=[pscustomobject]@{n=$nodes.Count;truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0;scrollErr=0}}}
}
function Run($Frame,$Floating,$Mode='normal'){
  $script:regions=@{'.centralWidget.SearchSplitter.SearchFrameSSE'=$Frame;'.QWidget.SearchResultsView'=$Floating}
  $script:regionReads=New-Object Collections.ArrayList
  $script:nativeReads=0;$script:descriptions=0
  $binding=[pscustomobject]@{aid='Synthetic.Main';rid='42.4242';processId=123}
  function Walk-BoundTree {throw 'An unrelated help-window cycle must never be read for search.'}
  function Find-ExactAutomationElement {
    param($Window,$RelativeAutomationId,[switch]$VisibleOnly)
    Assert ($Window -eq 4242 -and $VisibleOnly) 'Search region lost its exact window/visibility request.'
    $null=$script:regionReads.Add($RelativeAutomationId)
    Assert ($script:regions.ContainsKey($RelativeAutomationId) -and $script:regions[$RelativeAutomationId]) 'Unexpected or missing search region.'
    [pscustomobject]@{part=$script:regions[$RelativeAutomationId]}
  }
  function Convert-ExactElementToNode($Element){
    $script:descriptions++;$copy=Copy-SSESearchSnapshotNode $Element.part.root
    if($Mode -ceq 'moved' -and $script:descriptions -eq 2){$copy.x++}
    $copy
  }
  function Test-SSEMainContentAncestry($Window,$Element,$WindowBinding){
    Assert ($Window -eq 4242 -and $WindowBinding.rid -ceq '42.4242' -and $WindowBinding.processId -eq 123) 'Search root lost the exact main-window ancestry request.'
    $Mode -cne 'foreign'
  }
  function Get-UiSnapshot {
    param($Window,$MaxNodes,$TimeoutSec,$MaxDepth,$RootElement)
    Assert ($Window -eq 4242 -and $RootElement -and $MaxNodes -eq 4000 -and $MaxDepth -eq 16) 'A whole-window or unbounded snapshot escaped the search scope.'
    $script:nativeReads++;$RootElement.part.tree
  }
  Get-SSESearchTree ([IntPtr]4242) -ReadRegion {param($aid) Read-SSESearchRegion ([IntPtr]4242) $aid $binding}
}
$inline=Run (Part) $null
Assert ($script:regionReads.Count -eq 1 -and $script:nativeReads -eq 1) 'An intact inline search read another region.'
Assert ((Get-SSESearchHitLayout $inline.nodes 'Target page').title -ceq 'Target page') 'Root insertion lost the inline title/query ancestry.'
$framePart=Part $false $true;$floatingPart=Part $true
$originalParts=@($framePart,$floatingPart)|ConvertTo-Json -Depth 12 -Compress
$floating=Run $framePart $floatingPart
Assert ($script:regionReads.Count -eq 2 -and $script:nativeReads -eq 2) 'The floating table was not bound as its own search region.'
Assert ((Get-SSESearchHitLayout $floating.nodes 'Target page').title -ceq 'Target page') 'Merging floating and inline roots lost the exact title.'
Assert (@($floating.nodes.i|Select-Object -Unique).Count -eq $floating.nodes.Count) 'Merged roots reused node indices.'
Assert ((@($framePart,$floatingPart)|ConvertTo-Json -Depth 12 -Compress) -ceq $originalParts) 'Remapping dictionary nodes mutated a native snapshot that is read again.'
foreach($failure in @('cycle','truncated','depth','count','parent','identity','duplicate-root','duplicate-table','foreign','moved')){
  $frame=Part;$other=Part $true
  switch($failure){
    'cycle' {$frame.tree.stats.cyc=1}
    'truncated' {$frame.tree.stats.truncated=$true}
    'depth' {$frame.tree.stats.depthLimited=$true}
    'count' {$frame.tree.stats.n++}
    'parent' {$frame.tree.nodes[0].p=0}
    'identity' {$frame.tree.nodes[0].rid=$frame.root.rid}
    'duplicate-root' {$frame=Part $false $true;$other.root.rid=$frame.root.rid}
    'duplicate-table' {
      $frame.tree.nodes+=Node 7 4 'Table' $frame.tree.nodes[5].aid '' 'frame'
      $frame.tree.stats.n++
    }
  }
  $failed=$false
  try{$null=Run $frame $other $failure}catch{$failed=$true}
  Assert $failed "An incomplete, foreign or moving own search region was accepted: $failure"
}
foreach($failure in @('window-key','budget')){
  $frame=Part $false $true;$other=Part $true;$limit=4000
  if($failure -ceq 'window-key'){$other.windowKey='different-own-window'}
  if($failure -ceq 'budget'){$limit=1}
  $failed=$false
  try{$null=Merge-SSESearchTreeParts @($frame,$other) -MaxNodes $limit}catch{$failed=$true}
  Assert $failed "Disjoint search observations were merged without their contract: $failure"
}
Write-Output 'Search scope: complete own inline/floating roots, unique parent indices and fail-closed own-region errors passed without reading unrelated windows.'
