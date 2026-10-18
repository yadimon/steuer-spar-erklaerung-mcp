# One preselected standard-UIA activation route. Never select or SetFocus
# before this transaction and never try another route after it is submitted.

function Test-SSETableNumberClickInterval($LastInput,[long]$Now,[long]$DoubleClickMs) {
  if ($null -eq $LastInput -or $LastInput -lt 0 -or $LastInput -gt 4294967295L -or
      $Now -lt 0 -or $Now -gt 4294967295L -or $DoubleClickMs -lt 1 -or $DoubleClickMs -gt 5000) {return $false}
  $age=($Now-[long]$LastInput+4294967296L)%4294967296L
  [bool]($age -gt $DoubleClickMs)
}

function Get-SSETableNumberClickCellProof {
  param([IntPtr]$Hwnd,[int]$ProcessId,$Tree,$Snapshot,[switch]$RequireUnselected,[int]$ExpectedRow=-1)
  $binding=$Snapshot.navigationBinding
  $state=Get-SSETableSnapshotInputState $Tree $binding.tableRootAid $binding.tableRootRid
  if (-not $state.ok -or -not $state.editorFree -or -not $Snapshot.cursorAnchorIsNumber -or
      -not $binding.complete -or -not $binding.editorFree -or [string]$Snapshot.kopf[0] -cnotmatch '^Nr\.?$') {
    throw 'Number-cell activation needs one complete editor-free numbered table.'
  }
  $headers=@($Tree.nodes | Where-Object {$_.p -eq $state.table.i -and $_.type -ceq 'Header' -and
    $_.on -and $_.w -gt 0 -and $_.h -gt 0 -and [string]$_.name} | Sort-Object x)
  if ($headers.Count -ne @($Snapshot.kopf).Count -or $headers.Count -lt 2 -or
      (@($headers.name) | ConvertTo-Json -Compress) -cne (@($Snapshot.kopf) | ConvertTo-Json -Compress)) {
    throw 'Number-cell headers are not uniquely bound.'
  }
  $cells=@($Tree.nodes | Where-Object {$_.p -eq $state.table.i -and $_.type -ceq 'DataItem' -and
    $_.aid -ceq $binding.tableRootAid -and $_.on -and $_.w -gt 0 -and $_.h -gt 0 -and $_.x -eq $headers[0].x} | Sort-Object y)
  $cell=$Snapshot.ersteZelle
  if (-not $cells.Count -or $cells[0].rid -cne $cell.rid -or
      @($cells | Where-Object {$_.y -eq $cells[0].y}).Count -ne 1 -or $cell.aid -cne $binding.tableRootAid -or
      $cell.w -lt 5 -or $cell.h -lt 5 -or $cell.x -ne $headers[0].x -or
      $cell.x+$cell.w -gt $headers[0].x+$headers[0].w -or
      $cell.x -lt $state.table.x -or $cell.y -lt $headers[0].y+$headers[0].h -or
      $cell.x+$cell.w -gt $state.table.x+$state.table.w -or $cell.y+$cell.h -gt $state.table.y+$state.table.h) {
    throw 'The first number cell is clipped, ambiguous or not the fixed initial anchor.'
  }
  $header=Get-LiveElement $Hwnd $headers[0].rid $headers[0].aid
  if (-not $header -or [int]$header.Current.ProcessId -ne $ProcessId -or
      $header.Current.ControlType -ne [System.Windows.Automation.ControlType]::Header -or
      ($header.GetRuntimeId() -join '.') -cne $headers[0].rid -or
      [string]$header.Current.AutomationId -cne $headers[0].aid -or [string]$header.Current.Name -cne $headers[0].name) {
    throw 'The exact current number header is unavailable.'
  }
  $headerBounds=$header.Current.BoundingRectangle
  if ($headerBounds.X -ne $headers[0].x -or $headerBounds.Y -ne $headers[0].y -or
      $headerBounds.Width -ne $headers[0].w -or $headerBounds.Height -ne $headers[0].h) {throw 'Number header bounds changed.'}
  $table=Get-SSETableReadUncachedElement $Hwnd $ProcessId $binding.tableRootRid $binding.tableRootAid 'Table'
  $resolved=Get-SSETableReadUncachedElement $Hwnd $ProcessId $cell.rid $cell.aid 'DataItem'
  if (-not $table.ok -or -not $resolved.ok) {throw 'The exact current number cell or table is unavailable.'}
  foreach ($pair in @(@($table.element,$state.table),@($resolved.element,$cell))) {
    $current=$pair[0].Current;$node=$pair[1];$bounds=$current.BoundingRectangle
    if ([int]$current.ProcessId -ne $ProcessId -or ($pair[0].GetRuntimeId() -join '.') -cne $node.rid -or
        [string]$current.AutomationId -cne $node.aid -or $current.IsEnabled -isnot [bool] -or -not $current.IsEnabled -or
        $current.IsOffscreen -isnot [bool] -or $current.IsOffscreen -or
        $bounds.X -ne $node.x -or $bounds.Y -ne $node.y -or $bounds.Width -ne $node.w -or $bounds.Height -ne $node.h) {
      throw 'Number-cell identity, visibility or bounds changed.'
    }
  }
  if ($table.element.Current.ControlType -notin @([System.Windows.Automation.ControlType]::Table,[System.Windows.Automation.ControlType]::DataGrid) -or
      $resolved.element.Current.ControlType -ne [System.Windows.Automation.ControlType]::DataItem -or
      [string]$resolved.element.Current.Name -cne [string]$cell.name) {throw 'Number-cell type or text changed.'}
  $gridObject=$null;$itemObject=$null;$selectionObject=$null;$forbidden=$null
  if (-not $resolved.element.TryGetCurrentPattern([System.Windows.Automation.GridItemPattern]::Pattern,[ref]$gridObject) -or
      -not $resolved.element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$itemObject) -or
      -not $table.element.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern,[ref]$selectionObject) -or
      $resolved.element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$forbidden) -or
      $resolved.element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$forbidden)) {
    throw 'Number-cell patterns are unknown or could toggle/expand data.'
  }
  $grid=$gridObject.Current;$item=$itemObject.Current
  foreach ($container in @($grid.ContainingGrid,$item.SelectionContainer)) {
    if (-not $container -or [int]$container.Current.ProcessId -ne $ProcessId -or
        $container.Current.ControlType -notin @([System.Windows.Automation.ControlType]::Table,[System.Windows.Automation.ControlType]::DataGrid) -or
        ($container.GetRuntimeId() -join '.') -cne $binding.tableRootRid -or
        [string]$container.Current.AutomationId -cne $binding.tableRootAid) {throw 'Number cell belongs to a different current table.'}
  }
  $selected=@($selectionObject.Current.GetSelection())
  if ($grid.Row -isnot [int] -or $grid.Row -lt 0 -or $grid.Row -ge 1000 -or
      ($ExpectedRow -ge 0 -and $grid.Row -ne $ExpectedRow) -or $grid.Column -ne 0 -or
      $grid.RowSpan -ne 1 -or $grid.ColumnSpan -ne 1 -or $item.IsSelected -isnot [bool] -or
      ($RequireUnselected -and ($item.IsSelected -or $selected.Count))) {
    throw 'The fixed first number cell has an unknown row, span or existing selection.'
  }
  [pscustomobject]@{node=$cell;element=$resolved.element;table=$table.element;row=$grid.Row;selected=@($selected)}
}

function Test-SSETableNumberClickDirectPoint {
  param([IntPtr]$Hwnd,[int]$ProcessId,$Cell,[int]$X,[int]$Y)
  $hit=$AE::FromPoint((New-Object Windows.Point($X,$Y)))
  if (-not $hit) {return $false}
  $current=$hit.Current;$bounds=$current.BoundingRectangle
  [bool]([int]$current.ProcessId -eq $ProcessId -and $current.ControlType -eq [System.Windows.Automation.ControlType]::DataItem -and
    $current.IsEnabled -is [bool] -and $current.IsEnabled -and $current.IsOffscreen -is [bool] -and -not $current.IsOffscreen -and
    ($hit.GetRuntimeId() -join '.') -ceq $Cell.rid -and [string]$current.AutomationId -ceq $Cell.aid -and
    [string]$current.Name -ceq [string]$Cell.name -and $bounds.X -eq $Cell.x -and $bounds.Y -eq $Cell.y -and
    $bounds.Width -eq $Cell.w -and $bounds.Height -eq $Cell.h -and (Get-SSEPointObstruction $Hwnd $X $Y).isBoundTarget)
}

function Get-SSETableNumberClickSelectedRow {
  param([int]$ProcessId,$Tree,$Snapshot,$Proof)
  $binding=$Snapshot.navigationBinding
  $rids=New-Object 'Collections.Generic.HashSet[string]'
  $columns=New-Object 'Collections.Generic.HashSet[int]'
  foreach ($selected in @($Proof.selected)) {
    if (-not $selected) {throw 'Selected number-row element is unreadable.'}
    $current=$selected.Current;$rid=$selected.GetRuntimeId() -join '.';$bounds=$current.BoundingRectangle
    $nodes=@($Tree.nodes | Where-Object {$_.type -ceq 'DataItem' -and $_.aid -ceq $binding.tableRootAid -and $_.rid -ceq $rid -and
      $_.y -eq $Proof.node.y -and $_.h -eq $Proof.node.h -and $_.on -and $_.w -gt 0})
    $gridObject=$null
    if ([int]$current.ProcessId -ne $ProcessId -or $current.ControlType -ne [System.Windows.Automation.ControlType]::DataItem -or
        [string]$current.AutomationId -cne $binding.tableRootAid -or -not $rid -or -not $rids.Add($rid) -or $nodes.Count -ne 1 -or
        $bounds.X -ne $nodes[0].x -or $bounds.Y -ne $nodes[0].y -or $bounds.Width -ne $nodes[0].w -or $bounds.Height -ne $nodes[0].h -or
        [string]$current.Name -cne [string]$nodes[0].name -or
        -not $selected.TryGetCurrentPattern([System.Windows.Automation.GridItemPattern]::Pattern,[ref]$gridObject)) {
      throw 'Selection is not bound to the exact visible clicked row.'
    }
    $grid=$gridObject.Current;$container=$grid.ContainingGrid
    # Raw Grid columns can have gaps when a model column is hidden. Exact
    # visible-node geometry and unique raw column numbers bind this row.
    if ($grid.Row -ne $Proof.row -or $grid.Column -isnot [int] -or $grid.Column -lt 0 -or $grid.Column -ge 100 -or
        $grid.RowSpan -ne 1 -or $grid.ColumnSpan -ne 1 -or -not $columns.Add($grid.Column) -or -not $container -or
        [int]$container.Current.ProcessId -ne $ProcessId -or ($container.GetRuntimeId() -join '.') -cne $binding.tableRootRid -or
        [string]$container.Current.AutomationId -cne $binding.tableRootAid) {throw 'Selection includes another row, span, column or table.'}
  }
  if (-not $rids.Count -or -not $rids.Contains([string]$Proof.node.rid)) {throw 'The clicked number cell is not in the selected row.'}
  @($rids | Sort-Object)
}

function Invoke-SSETableReadNumberCellClick {
  param([IntPtr]$Hwnd,[int]$ProcessId,$Snapshot,$Tree,[hashtable]$Callbacks)
  $result=[pscustomobject]@{ok=$false;method='verified-first-number-cell';phase='number-cell-precondition';reason='number-cell-unbound';
    exceptionType=$null;tableFocusable=$null;anchorFocusable=$null;snapshot=$Snapshot;
    physicalInputAttempted=$false;physicalInputUsed=$false;activationSubmitted=$false;escapeSubmitted=$false;outcomeUnknown=$false;reconciliationRequired=$false;retryable=$false}
  try {
    foreach ($name in @('Guard','ReadSnapshot','ReadTree','RecordInput','SendEscape')) {
      if (-not $Callbacks -or $Callbacks[$name] -isnot [scriptblock]) {throw 'Number-cell activation callbacks are incomplete.'}
    }
    if ($Hwnd -eq [IntPtr]::Zero -or $ProcessId -le 0 -or -not (& $Callbacks.Guard 'before-number-cell-proof')) {throw 'Number-cell activation binding is unavailable.'}
    $positionProof=$null
    if (-not (Test-SSETableFocusedSource $Hwnd $ProcessId $Tree $Snapshot.navigationBinding.tableRootAid `
        $Snapshot.navigationBinding.tableRootRid -PositionNameProof ([ref]$positionProof) -AllowPositionNameSource) -or
        -not $positionProof -or -not $positionProof.valuePattern -or $positionProof.expectedValue -isnot [string]) {
      throw 'Only the exact unchanged profiled position-name source permits this activation.'
    }
    $focused=$AE::FocusedElement
    if (-not $focused -or $focused.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit) {throw 'Number-cell activation source is not the profiled Edit.'}
    $source=[pscustomobject]@{rid=($focused.GetRuntimeId() -join '.');aid=[string]$focused.Current.AutomationId;type=$focused.Current.ControlType}
    $proof=Get-SSETableNumberClickCellProof $Hwnd $ProcessId $Tree $Snapshot -RequireUnselected
    $doubleClickMs=[long][SW]::GetDoubleClickTime()
    $input=Get-SSELastInputTick;$dirty=Get-DirtyStateFast $Hwnd
    $windows=Get-SSEInteractionWindowSet $ProcessId $Hwnd
    $dpi=[int][SW]::GetDpiForWindow($Hwnd);$origin=@([SW]::GetPhysicalClientOrigin($Hwnd))
    if ($null -eq $input -or $dirty -isnot [bool] -or -not $windows.fingerprint -or $dpi -lt 96 -or $dpi -gt 768 -or
        $origin.Count -ne 2 -or [SW]::GetForegroundWindow() -ne $Hwnd -or
        -not (Test-SSETableNumberClickInterval $input ([long][Environment]::TickCount -band 4294967295L) $doubleClickMs)) {
      throw 'Number-cell input, foreground, geometry or double-click interval is not safe.'
    }
    $numberClickState=[pscustomobject]@{hwnd=$Hwnd;pid=$ProcessId;snapshot=$Snapshot;tree=$Tree;proof=$proof;input=$input;
      dirty=$dirty;windows=$windows.fingerprint;dpi=$dpi;origin=($origin | ConvertTo-Json -Compress);doubleClickMs=$doubleClickMs;
      source=$source;positionProof=$positionProof;callbacks=$Callbacks}
    $context={
      $currentPid=0;$null=[SW]::GetWindowThreadProcessId($numberClickState.hwnd,[ref]$currentPid)
      $currentDirty=Get-DirtyStateFast $numberClickState.hwnd
      [bool]($currentPid -eq $numberClickState.pid -and [SW]::GetForegroundWindow() -eq $numberClickState.hwnd -and
        (Test-SSELastInputUnchanged $numberClickState.input) -and $currentDirty -is [bool] -and $currentDirty -eq $numberClickState.dirty -and
        (Get-SSEInteractionWindowSet $numberClickState.pid $numberClickState.hwnd).fingerprint -ceq $numberClickState.windows -and
        [int][SW]::GetDpiForWindow($numberClickState.hwnd) -eq $numberClickState.dpi -and
        (@([SW]::GetPhysicalClientOrigin($numberClickState.hwnd)) | ConvertTo-Json -Compress) -ceq $numberClickState.origin -and
        [string]$numberClickState.positionProof.valuePattern.Current.Value -ceq $numberClickState.positionProof.expectedValue)
    }
    $surfaceCheck={
      param($NumberCell)
      $centreX=[int]($NumberCell.x+$NumberCell.w/2);$centreY=[int]($NumberCell.y+$NumberCell.h/2)
      foreach ($point in @(@($NumberCell.x,$NumberCell.y),@(($NumberCell.x+$NumberCell.w-1),$NumberCell.y),
          @($NumberCell.x,($NumberCell.y+$NumberCell.h-1)),@(($NumberCell.x+$NumberCell.w-1),($NumberCell.y+$NumberCell.h-1)),@($centreX,$centreY))) {
        if (-not (Test-SSETableNumberClickDirectPoint $numberClickState.hwnd $numberClickState.pid $NumberCell $point[0] $point[1])) {return $false}
      }
      $true
    }
    $pointCheck={
      param($Window,$PointBinding,[int]$X,[int]$Y)
      if ($Window -ne $numberClickState.hwnd -or -not (& $context)) {return $false}
      $readback=& $numberClickState.callbacks.ReadSnapshot
      $freshTree=& $numberClickState.callbacks.ReadTree
      if (-not (Test-SSETableReadSnapshotBinding $numberClickState.snapshot $readback -BeforeNavigation) -or
          -not (& $numberClickState.callbacks.Guard 'before-number-cell-click')) {return $false}
      $freshPosition=$null
      if (-not (Test-SSETableFocusedSource $numberClickState.hwnd $numberClickState.pid $freshTree $readback.navigationBinding.tableRootAid `
          $readback.navigationBinding.tableRootRid -ExpectedSource $numberClickState.source -PositionNameProof ([ref]$freshPosition) -AllowPositionNameSource) -or
          -not $freshPosition -or $freshPosition.expectedValue -cne $numberClickState.positionProof.expectedValue) {return $false}
      $fresh=Get-SSETableNumberClickCellProof $numberClickState.hwnd $numberClickState.pid $freshTree $readback -RequireUnselected -ExpectedRow $numberClickState.proof.row
      if ($fresh.node.rid -cne $numberClickState.proof.node.rid -or
          $X -ne [int]($fresh.node.x+$fresh.node.w/2) -or $Y -ne [int]($fresh.node.y+$fresh.node.h/2)) {return $false}
      # Prove all rectangular cell corners as well as the actual centre. No
      # native viewport or model flags are inferred from these UIA observations.
      if (-not (& $surfaceCheck $fresh.node)) {return $false}
      [bool]((& $context) -and [long][SW]::GetDoubleClickTime() -eq $numberClickState.doubleClickMs -and
        (Test-SSETableNumberClickInterval $numberClickState.input ([long][Environment]::TickCount -band 4294967295L) $numberClickState.doubleClickMs))
    }
    if (-not (& $surfaceCheck $proof.node) -or -not (& $context) -or
        -not (& $Callbacks.Guard 'number-cell-route-selected')) {throw 'Number-cell activation changed or is not fully directly visible before submission.'}
    # Submission enters the existing physical click helper. It may move the
    # pointer before its last guard, so even a lost/rejected result is terminal.
    $result.phase='number-cell-click';$result.activationSubmitted=$true;$result.physicalInputAttempted=$true;$result.physicalInputUsed=$null
    $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$true
    $click=Click-VerifiedPoint $Hwnd $proof.node $input -RequireForeground -ForegroundAttempts 1 -ExpectedRuntimeId $proof.node.rid `
      -BeforeClickCheck $pointCheck -BeforeClickBinding $numberClickState -ThrowOnFailure
    if (-not $click -or $click.clickCount -ne 1 -or $null -eq $click.inputTickAfterClick) {throw 'Number-cell click result is unproved.'}
    $result.physicalInputUsed=$true
    $numberClickState.input=$click.inputTickAfterClick
    $null=& $Callbacks.RecordInput $numberClickState.input $proof.node
    Start-Sleep -Milliseconds ([int]$doubleClickMs+100)
    if (-not (& $context)) {throw 'Number-cell click changed source, dirty state, geometry, input or window context.'}
    $after=& $Callbacks.ReadSnapshot
    if (-not (Test-SSETableReadSnapshotBinding $Snapshot $after -BeforeNavigation)) {throw 'Number-cell click changed the bound page or table values.'}
    $result.snapshot=$after
    $current=Get-SSETableNumberClickCellProof $Hwnd $ProcessId $Tree $Snapshot -ExpectedRow $proof.row
    $selectedRids=@(Get-SSETableNumberClickSelectedRow $ProcessId $Tree $Snapshot $current)
    $focused=$AE::FocusedElement
    if ($focused -and $focused.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit) {
      $result.phase='number-cell-editor-proof'
      $binding=$Snapshot.navigationBinding;$split=$binding.tableRootAid.LastIndexOf('/.')
      if ($split -lt 0) {throw 'Exact number-editor policy is unavailable.'}
      $policy=[pscustomobject]@{tableName=$binding.tableRootAid.Substring($split);headers=@($Snapshot.kopf)}
      $editor=Get-SSETableNumberAnchorFocusProof $Hwnd $ProcessId $Tree $binding.tableRootAid $binding.tableRootRid $proof.node $focused $null -NumberPolicy $policy
      if (-not $editor.ok -or $editor.ownedCell.rid -cne $proof.node.rid -or
          [string]$editor.valuePattern.Current.Value -cne [string]$editor.expectedValue -or
          -not (& $context)) {throw 'Only the unchanged exact clicked-row number editor may receive Escape.'}
      $result.escapeSubmitted=$true
      $null=& $Callbacks.SendEscape
      $numberClickState.input=Get-SSELastInputTick
      if ($null -eq $numberClickState.input) {throw 'Number-editor Escape input checkpoint is unavailable.'}
      $null=& $Callbacks.RecordInput $numberClickState.input $proof.node
      Start-Sleep -Milliseconds 100
      if (-not (& $context)) {throw 'Number-editor Escape changed the transaction context.'}
      $after=& $Callbacks.ReadSnapshot
      if (-not (Test-SSETableReadSnapshotBinding $Snapshot $after -BeforeNavigation)) {throw 'Number-editor Escape changed page or table values.'}
      $result.snapshot=$after
    }
    $result.phase='number-cell-final-focus'
    $live=Get-SSETableLiveInputState $Hwnd $ProcessId $Snapshot.navigationBinding.tableRootAid $Snapshot.navigationBinding.tableRootRid -RequireKeyboard -RequireSelection
    $current=Get-SSETableNumberClickCellProof $Hwnd $ProcessId $Tree $Snapshot -ExpectedRow $proof.row
    $selectedRids=@(Get-SSETableNumberClickSelectedRow $ProcessId $Tree $Snapshot $current)
    $tableNow=Get-SSETableReadUncachedElement $Hwnd $ProcessId $Snapshot.navigationBinding.tableRootRid $Snapshot.navigationBinding.tableRootAid 'Table'
    if (-not $live.ok -or (@($live.selectedRids | Sort-Object) -join '|') -cne ($selectedRids -join '|') -or
        -not $tableNow.ok -or $tableNow.element.Current.HasKeyboardFocus -isnot [bool] -or -not $tableNow.element.Current.HasKeyboardFocus -or
        -not (& $context) -or -not (& $Callbacks.Guard 'number-cell-focus-proven')) {
      throw 'Actual editor-free table keyboard focus and exact clicked-row selection are unproved.'
    }
    $result.ok=$true;$result.reason='exact-first-number-cell-focus-verified'
    $script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false
  } catch {
    $result.reason=$_.Exception.Message;$result.exceptionType=$_.Exception.GetType().Name
    $result.outcomeUnknown=[bool]$result.activationSubmitted;$result.reconciliationRequired=[bool]$result.activationSubmitted
  }
  $result
}
