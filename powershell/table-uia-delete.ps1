# The legacy visible deletion binds a model coordinate while every exposed
# cell stays unchanged. Runtime IDs and rectangles are observations, not row keys.

function Get-SSEUiaDeleteTableRoot {
  param($Tree,$Region,[string]$TableAid='')
  $stats=$Tree.stats
  if(-not $stats -or $stats.truncated -or $stats.depthLimited -or $stats.err -or $stats.cyc -or $stats.valErr -or
      (-not $TableAid -and (-not $Region.ok -or -not @($Region.cells).Count))){throw 'The complete summary-bound table tree is unavailable.'}
  $byIndex=@{};foreach($node in @($Tree.nodes)){
    if($byIndex.ContainsKey([int]$node.i)){throw 'The table tree repeats a node index.'}
    $byIndex[[int]$node.i]=$node
  }
  $roots=@{}
  if($TableAid -and -not @($Region.cells).Count){
    foreach($node in @($Tree.nodes|Where-Object{$_.type -cin @('Table','DataGrid') -and $_.aid -ceq $TableAid})){$roots[[string]$node.rid]=$node}
  }
  foreach($cell in @($Region.cells)){
    $probe=$cell;$found=$false;$seen=New-Object 'Collections.Generic.HashSet[int]'
    for($depth=0;$depth -lt 64 -and $probe;$depth++){
      if(-not $seen.Add([int]$probe.i)){throw 'The table ancestry contains a cycle.'}
      if($probe.type -cin @('Table','DataGrid')){$roots[[string]$probe.rid]=$probe;$found=$true;break}
      if(-not $byIndex.ContainsKey([int]$probe.p)){break}
      $probe=$byIndex[[int]$probe.p]
    }
    if(-not $found){throw 'A summary-bound cell has no exact table ancestor.'}
  }
  if($roots.Count -ne 1){throw 'The summary region does not identify exactly one table.'}
  $root=@($roots.Values)[0]
  if(-not $root.rid -or -not $root.aid -or ($TableAid -and $root.aid -cne $TableAid) -or
      @($Tree.nodes|Where-Object{$_.type -cin @('Table','DataGrid') -and $_.aid -ceq $root.aid}).Count -ne 1){
    throw 'The table automation identity is absent, changed or ambiguous.'
  }
  $root
}

function Test-SSEUiaDeleteEpoch {
  param($Binding)
  [bool]((& $Binding.guard) -and
    (Get-SSEInteractionWindowSet $Binding.processId $Binding.hwnd).fingerprint -ceq $Binding.transaction.windows.fingerprint -and
    (& $Binding.guard))
}

function Get-SSEUiaDeleteRawBound {
  param([int]$Rows,[int]$Columns)
  if($Rows -lt 0 -or $Rows -gt 1000 -or $Columns -lt 1 -or $Columns -gt 100){throw 'The complete deletion Grid dimensions exceed their bound.'}
  $Rows*($Columns+1)+$Columns+128
}

function Test-SSEUiaDeleteBudget {
  param([long]$ElapsedMs,[double]$LongestReadMs,[int]$RemainingReads,[double]$LongestRawMs=0)
  if($ElapsedMs -lt 0 -or $ElapsedMs -ge 60000 -or [double]::IsNaN($LongestReadMs) -or [double]::IsInfinity($LongestReadMs) -or
      $LongestReadMs -le 0 -or $RemainingReads -lt 1 -or $RemainingReads -gt 8 -or
      [double]::IsNaN($LongestRawMs) -or [double]::IsInfinity($LongestRawMs) -or $LongestRawMs -le 0 -or $LongestRawMs -ge 2500){return $false}
  [bool](60000-$ElapsedMs -ge [Math]::Ceiling($LongestReadMs)*$RemainingReads+5000)
}

function Test-SSEUiaDeleteRestoredDirty {
  param($Before,$AfterDelete,$AfterUndo)
  foreach($value in @($Before,$AfterDelete,$AfterUndo)){if($value -isnot [bool]){return $false}}
  [bool](($Before -eq $AfterUndo) -or (-not $Before -and $AfterDelete -and $AfterUndo))
}

function Get-SSEUiaDeleteRawEditors {
  param($Table,[int]$ProcessId,[scriptblock]$Guard,[int]$MaxNodes=102000)
  if($MaxNodes -lt 1 -or $MaxNodes -gt 102000){throw 'The editor observation bound is invalid.'}
  $watch=[Diagnostics.Stopwatch]::StartNew();$walker=[Windows.Automation.TreeWalker]::RawViewWalker
  $pending=New-Object Collections.Stack;$pending.Push([pscustomobject]@{element=$Table;depth=0})
  $seen=New-Object 'Collections.Generic.HashSet[string]';$editors=New-Object Collections.ArrayList
  while($pending.Count){
    if($seen.Count -ge $MaxNodes -or $watch.ElapsedMilliseconds -ge 5000 -or -not (& $Guard)){throw 'The bounded raw editor observation lost its epoch.'}
    $entry=$pending.Pop();$element=$entry.element;$current=$element.Current;$rid=$element.GetRuntimeId() -join '.'
    if([int]$current.ProcessId -ne $ProcessId -or -not $rid -or -not $seen.Add($rid)){throw 'The raw editor ancestry is foreign, cyclic or incomplete.'}
    $type=$current.ControlType;$bounds=$current.BoundingRectangle
    if($entry.depth -gt 0 -and $type -eq [Windows.Automation.ControlType]::Window){throw 'A different window entered the table subtree.'}
    if($type -in @([Windows.Automation.ControlType]::Edit,[Windows.Automation.ControlType]::ComboBox,[Windows.Automation.ControlType]::Spinner) -and
        -not $current.IsOffscreen -and -not $bounds.IsEmpty -and $bounds.Width -gt 0 -and $bounds.Height -gt 0){$null=$editors.Add($element)}
    if($type -in @([Windows.Automation.ControlType]::DataItem,[Windows.Automation.ControlType]::Header,[Windows.Automation.ControlType]::HeaderItem)){continue}
    $child=$walker.GetFirstChild($element);$siblings=0
    while($child){
      if($entry.depth -ge 16 -or ++$siblings -gt $MaxNodes -or $pending.Count+$seen.Count -ge $MaxNodes -or $watch.ElapsedMilliseconds -ge 5000 -or -not (& $Guard)){
        throw 'The raw table editor walk exceeded its bound.'
      }
      $pending.Push([pscustomobject]@{element=$child;depth=($entry.depth+1)});$child=$walker.GetNextSibling($child)
    }
  }
  # Qt can omit an active delegate from both downward views while exposing
  # its exact table through the focused element's raw parent chain.
  $focused=[Windows.Automation.AutomationElement]::FocusedElement
  if($focused -and [int]$focused.Current.ProcessId -eq $ProcessId -and
      $focused.Current.ControlType -in @([Windows.Automation.ControlType]::Edit,[Windows.Automation.ControlType]::ComboBox,[Windows.Automation.ControlType]::Spinner)){
    $focusRid=$focused.GetRuntimeId() -join '.';$probe=$focused;$parents=New-Object 'Collections.Generic.HashSet[string]'
    for($depth=0;$depth -lt 32 -and $probe;$depth++){
      if($watch.ElapsedMilliseconds -ge 5000 -or -not (& $Guard)){throw 'The raw focused-editor observation lost its epoch.'}
      $rid=$probe.GetRuntimeId() -join '.'
      if([int]$probe.Current.ProcessId -ne $ProcessId -or -not $rid -or -not $parents.Add($rid)){throw 'The focused editor has unproven raw ancestry.'}
      if($rid -ceq ($Table.GetRuntimeId() -join '.') -and [string]$probe.Current.AutomationId -ceq [string]$Table.Current.AutomationId){
        if($focusRid -cnotin @($editors|ForEach-Object{$_.GetRuntimeId() -join '.'})){$null=$editors.Add($focused)}
        break
      }
      if($probe.Current.ControlType -eq [Windows.Automation.ControlType]::Window){break}
      $probe=$walker.GetParent($probe)
    }
  }
  ,@($editors)
}

function Test-SSEUiaDeleteEditorAgreement {
  param($SnapshotState,$RawEditors,[switch]$AllowOwnEditor)
  if(-not $SnapshotState.ok -or @($RawEditors).Count -gt 1){return $false}
  if(-not $AllowOwnEditor){return [bool]($SnapshotState.editorFree -and @($RawEditors).Count -eq 0)}
  foreach($node in @($SnapshotState.editorNodes)){
    if(@($RawEditors|Where-Object{($_.GetRuntimeId() -join '.') -ceq $node.rid -and [string]$_.Current.AutomationId -ceq $node.aid}).Count -ne 1){return $false}
  }
  [bool]($SnapshotState.editorFree -or @($RawEditors).Count -eq 1)
}

function Read-SSEUiaDeleteState {
  param($Binding,[switch]$AllowOwnEditor)
  $readWatch=[Diagnostics.Stopwatch]::StartNew()
  if(-not (Test-SSEUiaDeleteEpoch $Binding)){throw 'The deletion window or input epoch changed.'}
  $firstRead=Read-LabeledValue $Binding.hwnd $Binding.sumLabel $Binding.expectedBefore $Binding.sumOccurrence $Binding.summaryAid
  if((Get-CurrentHeading $Binding.hwnd $firstRead.tree) -cne $Binding.expectedPage -or -not $firstRead.selected -or -not $firstRead.selected.aid){
    throw 'The exact deletion page or summary is unavailable.'
  }
  $region=Get-SSETableRegion $firstRead.tree $Binding.hwnd $firstRead
  $root=Get-SSEUiaDeleteTableRoot $firstRead.tree $region $Binding.tableAid
  $state=Get-SSETableSnapshotInputState $firstRead.tree $root.aid $root.rid
  if(-not $state.ok -or (-not $AllowOwnEditor -and -not $state.editorFree)){throw 'The bound table has an editor or an incomplete snapshot.'}
  $dirty=Get-DirtyStateFast $Binding.hwnd
  if($dirty -isnot [bool]){throw 'The deletion dirty state is unavailable.'}
  $resolved=Get-SSETableReadUncachedElement $Binding.hwnd $Binding.processId $root.rid $root.aid $root.type
  if(-not $resolved.ok){throw 'The exact fresh deletion table is unavailable.'}
  $first=Read-SSEGridTableScan $resolved.element $Binding.processId $root.rid $root.aid 1000 $Binding.guard $Binding.watch 60000
  $second=Read-SSEGridTableScan $resolved.element $Binding.processId $root.rid $root.aid 1000 $Binding.guard $Binding.watch 60000
  $model=ConvertTo-SSEGridLogicalModel $first $second 1000 $Binding.processId $root.aid
  $rawBound=Get-SSEUiaDeleteRawBound $first.rows $first.columns
  $rawWatch=[Diagnostics.Stopwatch]::StartNew()
  $rawEditors=Get-SSEUiaDeleteRawEditors $resolved.element $Binding.processId $Binding.guard $rawBound
  $Binding.maxRawMs=[Math]::Max([double]$Binding.maxRawMs,[Math]::Max(1.0,$rawWatch.Elapsed.TotalMilliseconds))
  if(-not (Test-SSEUiaDeleteEditorAgreement $state $rawEditors -AllowOwnEditor:$AllowOwnEditor)){throw 'The exact table contains an unaccounted editor.'}
  $headers=@($first.headers|Where-Object{$_.visible})
  # Qt also exposes row headers as direct Header children. The raw Grid scan
  # already proves the cached column order; bind exactly those IDs here.
  $visible=@($firstRead.tree.nodes|Where-Object{$_.p -eq $root.i -and $_.type -cin @('Header','HeaderItem') -and $_.rid -cin @($headers.rid)}|Sort-Object x)
  if($headers.Count -ne $visible.Count){throw 'The observed Grid headers differ from the bound table.'}
  for($column=0;$column -lt $headers.Count;$column++){
    $header=$headers[$column];$node=$visible[$column]
    if($header.name -cne $node.name -or $header.rid -cne $node.rid -or $header.rect.empty -or
        [Math]::Abs($header.rect.x-$node.x) -gt 1 -or [Math]::Abs($header.rect.y-$node.y) -gt 1 -or
        [Math]::Abs($header.rect.width-$node.w) -gt 1 -or [Math]::Abs($header.rect.height-$node.h) -gt 1){
      throw 'A bound Grid header changed name, identity or geometry.'
    }
  }
  $lastRead=Read-LabeledValue $Binding.hwnd $Binding.sumLabel $Binding.expectedBefore $Binding.sumOccurrence ([string]$firstRead.selected.aid)
  $lastRegion=Get-SSETableRegion $lastRead.tree $Binding.hwnd $lastRead
  $lastRoot=Get-SSEUiaDeleteTableRoot $lastRead.tree $lastRegion $root.aid
  $lastState=Get-SSETableSnapshotInputState $lastRead.tree $lastRoot.aid $lastRoot.rid
  $rawWatch.Restart()
  $lastEditors=Get-SSEUiaDeleteRawEditors $resolved.element $Binding.processId $Binding.guard $rawBound
  $Binding.maxRawMs=[Math]::Max([double]$Binding.maxRawMs,[Math]::Max(1.0,$rawWatch.Elapsed.TotalMilliseconds))
  $editorIds=@($rawEditors|ForEach-Object{$_.GetRuntimeId() -join '.'}) -join '|'
  $lastEditorIds=@($lastEditors|ForEach-Object{$_.GetRuntimeId() -join '.'}) -join '|'
  if(-not (Test-SSEUiaDeleteEpoch $Binding) -or $lastRoot.rid -cne $root.rid -or -not $lastState.ok -or
      -not (Test-SSEUiaDeleteEditorAgreement $lastState $lastEditors -AllowOwnEditor:$AllowOwnEditor) -or $editorIds -cne $lastEditorIds -or
      (Get-CurrentHeading $Binding.hwnd $lastRead.tree) -cne $Binding.expectedPage -or
      $lastRead.selected.aid -cne $firstRead.selected.aid -or $lastRead.selected.rid -cne $firstRead.selected.rid -or
      -not (Test-SSEScalarEqual $lastRead.value $firstRead.value) -or (Get-DirtyStateFast $Binding.hwnd) -ne $dirty){
    throw 'The deletion model, summary, editor or dirty-state observation was unstable.'
  }
  $Binding.maxReadMs=[Math]::Max([double]$Binding.maxReadMs,[Math]::Max(1.0,$readWatch.Elapsed.TotalMilliseconds))
  [pscustomobject]@{model=$model;scan=$second;root=$lastRoot;table=$resolved.element;tree=$lastRead.tree;
    region=$lastRegion;summary=$lastRead.value;summaryAid=[string]$lastRead.selected.aid;dirty=$dirty;editors=@($lastEditors);inputState=$lastState}
}

function Get-SSEUiaDeleteCell {
  param($State,[int]$ProcessId,[int]$Row,[int]$Column)
  if($Row -lt 0 -or $Row -ge $State.scan.rows -or $Column -lt 0 -or $Column -ge $State.scan.columns){throw 'The target coordinate is outside the observed model.'}
  $grid=$null
  if(-not $State.table.TryGetCurrentPattern([Windows.Automation.GridPattern]::Pattern,[ref]$grid)){throw 'The target Grid pattern disappeared.'}
  $cell=$grid.GetItem($Row,$Column);$observed=$State.scan.cells[$Row*$State.scan.columns+$Column]
  $item=$null
  if(-not $cell -or [int]$cell.Current.ProcessId -ne $ProcessId -or $cell.Current.ControlType -ne [Windows.Automation.ControlType]::DataItem -or
      -not $cell.Current.IsEnabled -or ($cell.GetRuntimeId() -join '.') -cne $observed.rid -or
      ([string]$cell.Current.Name -replace "`r|`n|`t",' ').Trim() -cne ([string]$observed.name -replace "`r|`n|`t",' ').Trim() -or
      -not $cell.TryGetCurrentPattern([Windows.Automation.GridItemPattern]::Pattern,[ref]$item)){
    throw 'The fresh target cell differs from its complete model observation.'
  }
  $coordinate=$item.Current;$container=$coordinate.ContainingGrid
  if($coordinate.Row -ne $Row -or $coordinate.Column -ne $Column -or $coordinate.RowSpan -ne 1 -or $coordinate.ColumnSpan -ne 1 -or
      -not $container -or [int]$container.Current.ProcessId -ne $ProcessId -or
      ($container.GetRuntimeId() -join '.') -cne $State.root.rid -or [string]$container.Current.AutomationId -cne $State.root.aid){
    throw 'The fresh target has a different containing Grid or coordinate.'
  }
  $cell
}

function Assert-SSEUiaDeleteSelection {
  param($State,[int]$ProcessId,[int]$Row,[int]$Column,[switch]$RequireUnselected,[switch]$SelectionOnly)
  $target=Get-SSEUiaDeleteCell $State $ProcessId $Row $Column
  $selection=$null
  if(-not $State.table.TryGetCurrentPattern([Windows.Automation.SelectionPattern]::Pattern,[ref]$selection)){throw 'The exact table exposes no verifiable selection.'}
  $selected=@($selection.Current.GetSelection())
  if($selected.Count -gt $State.scan.rows*$State.scan.columns){throw 'The selection exceeds the observed model.'}
  $targetSelected=$false;$identities=New-Object 'Collections.Generic.HashSet[string]'
  foreach($cell in $selected){
    $rid=$cell.GetRuntimeId() -join '.';$coordinate=Resolve-SSEGridCellCoordinate $State.scan $rid
    if(-not $coordinate -or -not $identities.Add($rid)){throw 'A selected cell is foreign, missing or repeated.'}
    $null=Get-SSEUiaDeleteCell $State $ProcessId $coordinate.row $coordinate.column
    if($RequireUnselected){if($coordinate.row -eq $Row){throw 'The target row is still selected before the click.'};continue}
    if($coordinate.row -ne $Row){throw 'Another model row is selected.'}
    if($coordinate.column -eq $Column){$targetSelected=$true}
  }
  if($RequireUnselected){return}
  if(-not $targetSelected){throw 'The exact target cell is not selected.'}
  if($SelectionOnly){return}
  $focus=[Windows.Automation.AutomationElement]::FocusedElement
  if(-not $focus -or [int]$focus.Current.ProcessId -ne $ProcessId -or -not $focus.Current.HasKeyboardFocus){throw 'The deletion keyboard focus is unavailable or foreign.'}
  $focusRid=$focus.GetRuntimeId() -join '.';$current=$null
  if($focus.Current.ControlType -eq [Windows.Automation.ControlType]::DataItem){
    $coordinate=Resolve-SSEGridCellCoordinate $State.scan $focusRid
    if($coordinate -and $coordinate.row -eq $Row){$current=Get-SSEUiaDeleteCell $State $ProcessId $Row $coordinate.column}
  } elseif($focus.Current.ControlType -in @([Windows.Automation.ControlType]::Table,[Windows.Automation.ControlType]::DataGrid) -and
      $focusRid -ceq $State.root.rid -and [string]$focus.Current.AutomationId -ceq $State.root.aid){
    $currentCells=@(for($columnIndex=0;$columnIndex -lt $State.scan.columns;$columnIndex++){
      $candidate=Get-SSEUiaDeleteCell $State $ProcessId $Row $columnIndex
      if($candidate.Current.HasKeyboardFocus){$candidate}
    })
    if($currentCells.Count -eq 1){$current=$currentCells[0]}
  }
  if(-not $current -or -not $current.Current.HasKeyboardFocus){throw 'The actual current model row is not the selected deletion row.'}
}

function Close-SSEUiaDeleteOwnEditor {
  param($Binding,$Before,$Clicked,[int]$Row,[int]$Column,[int]$RemovedRow=-1)
  $exactRemoval=[bool]($RemovedRow -ge 0 -and (Get-SSEGridDeleteOutcome $Before.model $Clicked.model $RemovedRow) -ceq 'deleted-exact')
  $unchanged=[bool]($Before.model.key -ceq $Clicked.model.key -and $Before.dirty -eq $Clicked.dirty -and (Test-SSEScalarEqual $Before.summary $Clicked.summary))
  if($Before.editors.Count -ne 0 -or $Clicked.editors.Count -ne 1 -or
      ($RemovedRow -ge 0 -and -not $exactRemoval) -or ($RemovedRow -lt 0 -and -not $unchanged) -or
      -not (Test-SSEUiaDeleteEditorAgreement $Before.inputState $Before.editors) -or
      -not (Test-SSEUiaDeleteEditorAgreement $Clicked.inputState $Clicked.editors -AllowOwnEditor)){
    throw 'An editor cancellation requires exactly one new editor and the unchanged complete model.'
  }
  $editor=$Clicked.editors[0];$current=$editor.Current;$focus=[Windows.Automation.AutomationElement]::FocusedElement
  $target=Get-SSEUiaDeleteCell $Clicked $Binding.processId $Row $Column;$bounds=$target.Current.BoundingRectangle
  $value=$null;$cell=$Clicked.scan.cells[$Row*$Clicked.scan.columns+$Column]
  if(-not $focus -or $current.ControlType -ne [Windows.Automation.ControlType]::Edit -or -not $current.HasKeyboardFocus -or
      [int]$current.ProcessId -ne $Binding.processId -or ($focus.GetRuntimeId() -join '.') -cne ($editor.GetRuntimeId() -join '.') -or
      $focus.Current.ControlType -ne [Windows.Automation.ControlType]::Edit -or
      -not ([string]$current.AutomationId).StartsWith($Clicked.root.aid+'.',[StringComparison]::Ordinal) -or
      [Math]::Abs($current.BoundingRectangle.X-$bounds.X) -gt 2 -or [Math]::Abs($current.BoundingRectangle.Y-$bounds.Y) -gt 2 -or
      [Math]::Abs($current.BoundingRectangle.Width-$bounds.Width) -gt 2 -or [Math]::Abs($current.BoundingRectangle.Height-$bounds.Height) -gt 2 -or
      -not $editor.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$value) -or
      $value.Current.IsReadOnly -isnot [bool] -or $value.Current.IsReadOnly -or [string]$value.Current.Value -cne [string]$cell.name -or
      -not $target.Current.HasKeyboardFocus -or $cell.semantic.type -cne 'text'){
    throw 'The new editor is not the exact unchanged own clicked cell.'
  }
  if(-not $exactRemoval){Assert-SSEUiaDeleteSelection $Clicked $Binding.processId $Row $Column -SelectionOnly}
  if(-not (Test-SSEUiaDeleteEpoch $Binding) -or [string]$value.Current.Value -cne [string]$cell.name -or
      ([Windows.Automation.AutomationElement]::FocusedElement.GetRuntimeId() -join '.') -cne ($editor.GetRuntimeId() -join '.')){
    throw 'The owned editor lost its final cancellation epoch.'
  }
  if(-not (Test-SSEUiaDeleteEpoch $Binding)){throw 'The input epoch changed during the final editor proof; no Escape was sent.'}
  [Windows.Forms.SendKeys]::SendWait('{ESC}')
  $Binding.transaction.epoch=Get-SSELastInputTick
  Set-SSEForegroundLeaseInputCheckpoint $Binding.transaction.epoch -Context 'uia-delete-cancel-own-editor'
  $closed=Read-SSEUiaDeleteState $Binding
  if($closed.model.key -cne $Clicked.model.key -or $closed.dirty -ne $Clicked.dirty -or
      -not (Test-SSEScalarEqual $closed.summary $Clicked.summary)){throw 'The complete model changed while cancelling the own editor.'}
  if(-not $exactRemoval){Assert-SSEUiaDeleteSelection $closed $Binding.processId $Row $Column}
  else {Assert-SSEUiaDeleteTableFocus $closed $Binding.processId}
  $closed
}

function Assert-SSEUiaDeleteTableFocus {
  param($State,[int]$ProcessId)
  $focus=[Windows.Automation.AutomationElement]::FocusedElement
  if(-not $focus -or [int]$focus.Current.ProcessId -ne $ProcessId -or -not $focus.Current.HasKeyboardFocus){throw 'The exact table keyboard focus is unavailable.'}
  $rid=$focus.GetRuntimeId() -join '.'
  if($focus.Current.ControlType -in @([Windows.Automation.ControlType]::Table,[Windows.Automation.ControlType]::DataGrid) -and
      $rid -ceq $State.root.rid -and [string]$focus.Current.AutomationId -ceq $State.root.aid){return}
  if($focus.Current.ControlType -eq [Windows.Automation.ControlType]::DataItem){
    $coordinate=Resolve-SSEGridCellCoordinate $State.scan $rid
    if($coordinate -and (Get-SSEUiaDeleteCell $State $ProcessId $coordinate.row $coordinate.column).Current.HasKeyboardFocus){return}
  }
  throw 'The actual keyboard focus cannot authorize a table shortcut.'
}

function Wait-SSEUiaDeleteRows {
  param($Binding,$State,[int]$ExpectedRows)
  $settle=[Diagnostics.Stopwatch]::StartNew();$grid=$null
  if(-not $State.table.TryGetCurrentPattern([Windows.Automation.GridPattern]::Pattern,[ref]$grid)){throw 'The deletion Grid disappeared while settling.'}
  do {
    if(-not (Test-SSEUiaDeleteEpoch $Binding)){throw 'The deletion epoch changed while settling.'}
    if([int]$grid.Current.RowCount -eq $ExpectedRows){return}
    Start-Sleep -Milliseconds 50
  } while($settle.ElapsedMilliseconds -lt 1500)
  # A deadline only ends polling. The following complete read decides whether
  # the command was ineffective, succeeded or has an unknown outcome.
}

function Invoke-SSEUiaTableDelete {
  param([IntPtr]$Hwnd,[int]$ProcessId,$Arguments,[Diagnostics.Process]$Process)
  $transaction=[pscustomobject]@{started=$false;touched=$false;epoch=$null;foreground=[SW]::GetForegroundWindow();windows=$null;phase='initial'}
  $binding=[pscustomobject]@{hwnd=$Hwnd;processId=$ProcessId;sumLabel=[string](Arg $Arguments 'sumLabel');
    expectedPage=[string](Arg $Arguments 'expectedPage');expectedBefore=[string](Arg $Arguments 'expectedBefore');
    sumOccurrence=[int](Arg $Arguments 'sumOccurrence' 0);summaryAid='';tableAid='';watch=[Diagnostics.Stopwatch]::StartNew();maxReadMs=0.0;maxRawMs=0.0;guard=$null;transaction=$transaction}
  $expectedAfter=[string](Arg $Arguments 'expectedAfter');$text=[string](Arg $Arguments 'text');$targetRid=[string](Arg $Arguments 'targetRid')
  $transaction.epoch=Get-SSELastInputTick
  $transaction.windows=Get-SSEInteractionWindowSet $ProcessId $Hwnd
  $binding.guard={
    $windowPid=0
    [bool]($binding.watch.ElapsedMilliseconds -lt 60000 -and -not $Process.HasExited -and [SW]::IsWindow($Hwnd) -and
      [SW]::GetWindowThreadProcessId($Hwnd,[ref]$windowPid) -gt 0 -and $windowPid -eq $ProcessId -and
      (Test-SSELastInputUnchanged $transaction.epoch) -and [SW]::GetForegroundWindow() -eq $transaction.foreground)
  }.GetNewClosure()
  try {
    if($null -eq $transaction.epoch -or @($transaction.windows.windows|Where-Object{$_.role -cne 'main'}).Count){throw 'The deletion requires an exact unobstructed input epoch.'}
    $initial=Read-SSEUiaDeleteState $binding
    if(-not (Test-SSEScalarEqual $initial.summary $binding.expectedBefore)){throw 'The summary differs from the required precondition.'}
    $binding.summaryAid=$initial.summaryAid;$binding.tableAid=$initial.root.aid
    $matches=@($initial.scan.cells|Where-Object{
      ([string]$_.name -replace "`r|`n|`t",' ').Trim() -ceq $text -and (-not $targetRid -or $_.rid -ceq $targetRid)
    })
    if($matches.Count -ne 1){throw 'The complete Grid does not identify exactly one requested cell.'}
    $coordinate=Resolve-SSEGridCellCoordinate $initial.scan ([string]$matches[0].rid)
    if(-not $coordinate -or -not (Test-SSEGridRowUnique $initial.model $coordinate.row)){throw 'The requested model row is indistinguishable from another exposed row.'}
    $requestedCell=$initial.scan.cells[$coordinate.row*$initial.scan.columns+$coordinate.column]
    if(-not $initial.scan.headers[$coordinate.column].visible -or $requestedCell.semantic.type -cne 'text'){
      throw 'A deletion click requires a displayed text cell; hidden and toggle cells are not input targets.'
    }
    if(-not (Test-SSEUiaDeleteBudget $binding.watch.ElapsedMilliseconds $binding.maxReadMs 8 $binding.maxRawMs)){
      throw 'Fuer Vorbereitung und vollstaendigen Readback bleibt zu wenig Zeit; Loeschung nicht begonnen.'
    }
    $transaction.phase='activation'
    if(-not (& $binding.guard)){throw 'The activation input epoch changed.'}
    $transaction.touched=$true
    $null=Show-SSEWindow $Hwnd
    $transaction.foreground=$Hwnd
    # Show may move/restore the window, but must not hide an input or window-set change.
    if(-not (Test-SSELastInputUnchanged $transaction.epoch)){throw 'The input epoch changed while activating the deletion window.'}
    $activatedWindows=Get-SSEInteractionWindowSet $ProcessId $Hwnd
    if(@($activatedWindows.windows|Where-Object{$_.role -cne 'main'}).Count -or $activatedWindows.windows.Count -ne 1){throw 'A blocking window appeared during activation.'}
    $transaction.windows=$activatedWindows
    $active=Read-SSEUiaDeleteState $binding
    if($active.model.key -cne $initial.model.key -or $active.dirty -ne $initial.dirty -or
        -not (Test-SSEScalarEqual $active.summary $initial.summary)){throw 'The complete model changed while activating the window.'}
    $sourceReason=$null;$positionNameProof=$null
    if(-not (Test-SSETableFocusedSource $Hwnd $ProcessId $active.tree $active.root.aid $active.root.rid `
        -AllowPositionNameSource -FailureReason ([ref]$sourceReason) -PositionNameProof ([ref]$positionNameProof))){
      $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true
      throw 'The current focus is not a proven passive control; it must not be committed by a click.'
    }
    $target=Get-SSEUiaDeleteCell $active $ProcessId $coordinate.row $coordinate.column
    $selectionItem=$null
    if(-not $target.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$selectionItem)){throw 'The exact target has no exclusive selection pattern.'}
    $transaction.phase='selection'
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The selection epoch changed.'}
    if($selectionItem.Current.IsSelected){$selectionItem.RemoveFromSelection()}
    Assert-SSEUiaDeleteSelection $active $ProcessId $coordinate.row $coordinate.column -RequireUnselected
    # No earlier click in this request; wait out any previous click interval
    # while continuously proving the unchanged input epoch before this click.
    $clickWatch=[Diagnostics.Stopwatch]::StartNew()
    while($clickWatch.ElapsedMilliseconds -le [SW]::GetDoubleClickTime()){
      if(-not (& $binding.guard)){throw 'The pre-click input epoch changed.'}
      Start-Sleep -Milliseconds 25
    }
    $bounds=$target.Current.BoundingRectangle
    $tableBounds=$active.table.Current.BoundingRectangle
    $headerBottom=(@($active.scan.headers|Where-Object{$_.visible}|ForEach-Object{$_.rect.y+$_.rect.height})|Measure-Object -Maximum).Maximum
    if($target.Current.IsOffscreen -or $bounds.IsEmpty -or [double]::IsInfinity($bounds.X) -or [double]::IsInfinity($bounds.Y) -or $bounds.Width -le 0 -or $bounds.Height -le 0 -or
        $bounds.X -lt $tableBounds.X -or $bounds.Y -lt $headerBottom -or $bounds.X+$bounds.Width -gt $tableBounds.X+$tableBounds.Width -or
        $bounds.Y+$bounds.Height -gt $tableBounds.Y+$tableBounds.Height){throw 'The exact target is clipped, offscreen or outside the displayed table body.'}
    $x=[int]($bounds.X+$bounds.Width/2);$y=[int]($bounds.Y+$bounds.Height/2)
    $rectangle=New-Object SW+RC
    if(-not [SW]::GetWindowRect($Hwnd,[ref]$rectangle) -or $x -lt $rectangle.L -or $x -ge $rectangle.R -or $y -lt $rectangle.T -or $y -ge $rectangle.B -or
        -not (Get-SSEPointObstruction $Hwnd $x $y).isBoundTarget){throw 'The target point is outside or obstructed in the bound window.'}
    foreach($modifier in @(0x10,0x11,0x12)){
      if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The input epoch changed before releasing an own modifier.'}
      [SW]::keybd_event($modifier,0,0x0002,[IntPtr]::Zero)
      $transaction.epoch=Get-SSELastInputTick
      Set-SSEForegroundLeaseInputCheckpoint $transaction.epoch -Context 'uia-delete-modifier-up'
    }
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The cursor epoch changed.'}
    Set-SSECursorPoint $x $y
    $transaction.epoch=Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $transaction.epoch ([pscustomobject]@{x=$x;y=$y}) 'uia-delete-cursor'
    Assert-SSECursorPoint $x $y
    Assert-SSEUiaDeleteSelection $active $ProcessId $coordinate.row $coordinate.column -RequireUnselected
    if(-not (Test-SSEUiaDeleteEpoch $binding) -or -not (Get-SSEPointObstruction $Hwnd $x $y).isBoundTarget){throw 'The exact target point lost its input binding.'}
    $sourceReason=$null;$positionNameProof=$null
    if(-not (Test-SSETableFocusedSource $Hwnd $ProcessId $active.tree $active.root.aid $active.root.rid `
        -AllowPositionNameSource -FailureReason ([ref]$sourceReason) -PositionNameProof ([ref]$positionNameProof))){
      $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true
      throw 'The exact passive or unchanged profiled source changed before the click.'
    }
    $hit=[Windows.Automation.AutomationElement]::FromPoint((New-Object Windows.Point($x,$y)))
    if(-not $hit -or [int]$hit.Current.ProcessId -ne $ProcessId -or $hit.Current.ControlType -ne [Windows.Automation.ControlType]::DataItem -or
        ($hit.GetRuntimeId() -join '.') -cne ($target.GetRuntimeId() -join '.')){throw 'The physical point does not hit the exact bound text cell.'}
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The input epoch changed during the final point proof.'}
    Assert-SSECursorPoint $x $y
    if(-not (& $binding.guard)){throw 'The final click input epoch changed.'}
    [SW]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero);[SW]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
    $transaction.epoch=Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $transaction.epoch ([pscustomobject]@{x=$x;y=$y}) 'uia-delete-unselected-click'
    if(-not (& $binding.guard)){throw 'The click lost its window or input epoch.'}
    # Observe after Qt's delayed edit trigger as well as after mouse release.
    $editWatch=[Diagnostics.Stopwatch]::StartNew()
    while($editWatch.ElapsedMilliseconds -le [SW]::GetDoubleClickTime()){
      if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The own click lost its editor-observation epoch.'}
      Start-Sleep -Milliseconds 25
    }
    $clicked=Read-SSEUiaDeleteState $binding -AllowOwnEditor
    if($clicked.model.key -cne $initial.model.key -or $clicked.dirty -ne $initial.dirty -or
        -not (Test-SSEScalarEqual $clicked.summary $initial.summary)){throw 'The complete model changed during the target click.'}
    if($clicked.editors.Count){$clicked=Close-SSEUiaDeleteOwnEditor $binding $active $clicked $coordinate.row $coordinate.column}
    $target=Get-SSEUiaDeleteCell $clicked $ProcessId $coordinate.row $coordinate.column
    $selectionItem=$null
    if(-not $target.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$selectionItem)){throw 'The clicked exact target lost its selection pattern.'}
    $selectionItem.Select()
    $preDelete=Read-SSEUiaDeleteState $binding
    if($preDelete.model.key -cne $initial.model.key -or $preDelete.dirty -ne $initial.dirty -or
        -not (Test-SSEScalarEqual $preDelete.summary $initial.summary)){throw 'The complete model changed before the delete shortcut.'}
    Assert-SSEUiaDeleteSelection $preDelete $ProcessId $coordinate.row $coordinate.column
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The final deletion epoch changed.'}
    Assert-SSEUiaDeleteSelection $preDelete $ProcessId $coordinate.row $coordinate.column
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The input epoch changed during the final selection proof.'}
    if(-not (Test-SSEUiaDeleteBudget $binding.watch.ElapsedMilliseconds $binding.maxReadMs 4 $binding.maxRawMs)){
      return [pscustomobject]@{ok=$false;verified=$false;kind='uia-delete-budget';
        error='Fuer Nachlesen und gegebenenfalls einmaliges Undo bleibt zu wenig Zeit; ausgelesene Werte unveraendert, Loeschung nicht begonnen.';
        mutationStarted=$false;outcomeUnknown=$false;resultingState='unchanged';reconciliationRequired=$false;retryable=$false;
        geloescht=$false;nochVorhanden=$true}
    }
    if(-not (& $binding.guard)){throw 'The delete dispatch input epoch changed.'}
    $transaction.phase='delete';$transaction.started=$true
    [Windows.Forms.SendKeys]::SendWait('^+{DEL}')
    $transaction.epoch=Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $transaction.epoch ([pscustomobject]@{x=$x;y=$y}) 'uia-delete-shortcut'
    Wait-SSEUiaDeleteRows $binding $preDelete ($initial.model.rows-1)
    $after=Read-SSEUiaDeleteState $binding -AllowOwnEditor
    $outcome=Get-SSEGridDeleteOutcome $initial.model $after.model $coordinate.row
    if($after.editors.Count){
      if($outcome -cne 'deleted-exact'){throw 'An unproven removal cannot authorize cancellation of a post-delete editor.'}
      # The shortcut can start a new delegate on the next current cell. Bind
      # that cell by the actual unique current Grid coordinate, never by text.
      $editorBounds=$after.editors[0].Current.BoundingRectangle
      $currentCells=@($after.tree.nodes|Where-Object{$_.type -ceq 'DataItem' -and $_.p -eq $after.root.i -and
        [Math]::Abs($_.x-$editorBounds.X) -le 2 -and [Math]::Abs($_.y-$editorBounds.Y) -le 2 -and
        [Math]::Abs($_.w-$editorBounds.Width) -le 2 -and [Math]::Abs($_.h-$editorBounds.Height) -le 2})
      if($currentCells.Count -ne 1){throw 'The post-delete editor has no unique observed current cell.'}
      $currentCoordinate=Resolve-SSEGridCellCoordinate $after.scan ([string]$currentCells[0].rid)
      if(-not $currentCoordinate){throw 'The post-delete editor is outside the complete Grid observation.'}
      $after=Close-SSEUiaDeleteOwnEditor $binding $preDelete $after $currentCoordinate.row $currentCoordinate.column -RemovedRow $coordinate.row
    }
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The post-delete input or window epoch changed.'}
    Assert-SSEUiaDeleteTableFocus $after $ProcessId
    $proof=[pscustomobject]@{schemaVersion=1;method='uia-grid-logical-model';outcome=$outcome;removedRow=$coordinate.row;
      rowsBefore=$initial.model.rows;rowsAfter=$after.model.rows;beforeFingerprint=$initial.model.fingerprint;afterFingerprint=$after.model.fingerprint;
      inputEpoch=$transaction.epoch;dirtyBefore=$initial.dirty;dirtyAfter=$after.dirty;dirtyAfterDelete=$after.dirty}
    $result=[ordered]@{ok=$false;verified=$false;target=$text;expectedPage=$binding.expectedPage;page=$binding.expectedPage;
      sumLabel=$binding.sumLabel;before=$initial.summary;after=$after.summary;expectedBefore=$binding.expectedBefore;expectedAfter=$expectedAfter;
      mutationStarted=$true;outcomeUnknown=$false;retryable=$false;geloescht=$false;nochVorhanden=$true;mutationPostProof=$proof}
    if($outcome -ceq 'deleted-exact' -and (Test-SSEScalarEqual $after.summary $expectedAfter)){
      $result.ok=$true;$result.verified=$true;$result.geloescht=$true;$result.nochVorhanden=$false
      return [pscustomobject]$result
    }
    if($outcome -ceq 'unchanged' -and $after.dirty -eq $initial.dirty -and (Test-SSEScalarEqual $after.summary $initial.summary)){
      throw 'Keine Entfernung beobachtet; die Verarbeitung des Befehls ist nicht quittiert. Zustand frisch abgleichen, nicht automatisch wiederholen.'
    }
    if($outcome -cne 'deleted-exact'){throw 'The full post-delete model does not prove exactly the requested removal; no undo was sent.'}
    # Only our exact one-row removal can authorize one undo. Re-read it under
    # the original post-shortcut epoch immediately before dispatching undo.
    $transaction.phase='undo-proof'
    $undoReady=Read-SSEUiaDeleteState $binding
    if($undoReady.model.key -cne $after.model.key -or $undoReady.dirty -ne $after.dirty -or
        -not (Test-SSEScalarEqual $undoReady.summary $after.summary) -or -not (& $binding.guard)){throw 'The single owned removal changed before undo; no undo was sent.'}
    Assert-SSEUiaDeleteTableFocus $undoReady $ProcessId
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The final undo epoch changed.'}
    Assert-SSEUiaDeleteTableFocus $undoReady $ProcessId
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The input epoch changed during the final undo focus proof.'}
    $transaction.phase='undo'
    [Windows.Forms.SendKeys]::SendWait('^z')
    $transaction.epoch=Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $transaction.epoch ([pscustomobject]@{x=$x;y=$y}) 'uia-delete-undo'
    Wait-SSEUiaDeleteRows $binding $undoReady $initial.model.rows
    $restored=Read-SSEUiaDeleteState $binding
    if((Get-SSEGridDeleteOutcome $initial.model $restored.model $coordinate.row) -cne 'unchanged' -or
        -not (Test-SSEUiaDeleteRestoredDirty $initial.dirty $after.dirty $restored.dirty) -or
        -not (Test-SSEScalarEqual $restored.summary $initial.summary)){throw 'The original exposed model, summary or explained dirty-state transition was not proved.'}
    Assert-SSEUiaDeleteTableFocus $restored $ProcessId
    if(-not (Test-SSEUiaDeleteEpoch $binding)){throw 'The restored frame lost its final keyboard or input context.'}
    $proof.outcome='restored';$proof.rowsAfter=$restored.model.rows;$proof.afterFingerprint=$restored.model.fingerprint
    $proof.inputEpoch=$transaction.epoch;$proof.dirtyAfter=$restored.dirty
    $result.ungespeichertVorher=$initial.dirty;$result.ungespeichertNachher=$restored.dirty
    $result.dirtyStateUnchanged=[bool]($initial.dirty -eq $restored.dirty)
    $result.kind='postcondition-failed';$result.error=$(if($result.dirtyStateUnchanged){
      'Die erwartete Nachsumme stimmt nicht; ausgelesene Tabellenwerte und Summe wurden wiederhergestellt, die Aenderungsmarkierung ist unveraendert.'
    }else{
      'Die erwartete Nachsumme stimmt nicht; ausgelesene Tabellenwerte und Summe wurden wiederhergestellt. Die Aenderungsmarkierung bleibt nach dem Undo gesetzt (vorher nicht gesetzt).'
    })
    $result.resultingState='restored';$result.rolledBack=$true;$result.rollbackAttempted=$true;$result.rollbackValue=$restored.summary
    return [pscustomobject]$result
  } catch {
    if($script:SSE_CAPTURE_OPERATION_RESULT -and $_.Exception.Message -ceq $script:SSE_CAPTURE_SENTINEL){throw}
    if($transaction.touched){$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true}
    $clean=[bool](-not $transaction.touched -and -not $transaction.started)
    [pscustomobject]@{ok=$false;verified=$false;kind='uia-delete-unproven';error=$_.Exception.Message;phase=$transaction.phase;
      mutationStarted=$transaction.started;outcomeUnknown=(-not $clean);resultingState=$(if($clean){'unchanged'}else{'unknown'});
      reconciliationRequired=(-not $clean);retryable=$false;geloescht=$null;nochVorhanden=$null;
      rollbackAttempted=($transaction.phase -ceq 'undo');rolledBack=$null}
  }
}
